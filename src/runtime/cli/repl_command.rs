//! Bun REPL Command - Native Rust REPL with full TUI support
//!
//! This is the entry point for `bun repl` which provides an interactive
//! JavaScript REPL with:
//! - Syntax highlighting using QuickAndDirtySyntaxHighlighter
//! - Full line editing with Emacs-style keybindings
//! - Persistent history
//! - Tab completion
//! - Multi-line input support
//! - REPL commands (.help, .exit, .clear, .load, .save, .editor)

use core::ffi::{c_char, c_void};
use core::ptr::NonNull;

use bun_alloc::Arena;
use bun_core::{Global, Output};
use bun_jsc::{self as jsc, JSGlobalObject};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_js_parser as js_ast;
use crate::dns_jsc::Order as DnsOrder;
use bun_str::ZigString;

// `repl.rs` is a sibling file with no other consumers; declare it as a child
// module here so `Repl` resolves without touching `cli/mod.rs`.
#[path = "repl.rs"]
mod repl;
use repl::Repl;

use crate::cli::Arguments;
use crate::Command;

pub struct ReplCommand;

impl ReplCommand {
    #[cold]
    pub fn exec(ctx: Command::Context<'_>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set

        // Initialize the REPL
        let mut repl = Repl::init();
        // `defer repl.deinit()` → handled by Drop

        // Boot the JavaScript VM for the REPL
        Self::boot_repl_vm(ctx, &mut repl)
    }

    fn boot_repl_vm<'r>(ctx: Command::Context<'_>, repl: &mut Repl<'r>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Load bunfig if not already loaded
        if !ctx.debug.loaded_bunfig {
            Arguments::load_config_path(
                Command::Tag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        // Initialize JSC
        jsc::initialize(true); // true for eval mode

        js_ast::ast::expr::data::Store::create();
        js_ast::ast::stmt::data::Store::create();
        // TODO(port): arena is threaded into VirtualMachine (vm.arena / vm.allocator). Non-AST
        // crate would normally drop MimallocArena, but VM init protocol requires it. Note
        // `bun_alloc::Arena` is bumpalo-backed and NOT semantically `bun.allocators.MimallocArena`
        // (mi_heap wrapper) — Phase B should either have bun_jsc::VirtualMachine own its arena
        // internally (drop the param) or expose a distinct `bun_alloc::MimallocArena` type.
        let arena = Arena::new();

        // Create a virtual path for REPL evaluation
        let repl_path: &'static [u8] = b"[repl]";

        // Validate DNS result order (InitOptions doesn't carry it yet — see TODO below).
        let _dns_order = DnsOrder::from_string(&ctx.runtime_options.dns_result_order)
            .unwrap_or_else(|| {
                Output::pretty_errorln("<r><red>error<r><d>:<r> Invalid DNS result order.");
                Global::exit(1);
            });

        // Initialize the VM
        // TODO(port): `jsc::VirtualMachineInitOptions` is currently a stub missing
        // `log` / `args: TransformOptions` / `store_fd` / `eval` / `debugger` /
        // `dns_result_order` — wire these once the upstream struct grows them.
        let vm: *mut VirtualMachine = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            // TODO(port): allocator field — VM owns arena allocator; see note above
            args: Vec::new(), // TODO(port): ctx.args is TransformOptions; InitOptions wants Vec<String>
            graph: core::ptr::null_mut(),
            smol: ctx.runtime_options.smol,
            eval_mode: true,
            is_main_thread: true,
        })?;

        // SAFETY: vm is a freshly heap-allocated VirtualMachine valid for process lifetime.
        let b = unsafe { &mut (*vm).transpiler };
        unsafe {
            (*vm).preload = core::mem::take(&mut ctx.preloads);
            (*vm).argv = core::mem::take(&mut ctx.passthrough);
        }
        // TODO(port): vm.allocator = vm.arena.allocator(); — allocator threading dropped in Rust
        // (vm.arena assignment moved below ReplRunner construction to avoid move-after-borrow)

        // Configure bundler options
        // PORT NOTE: ctx.install is Option<Box<BunInstall>>; bundler opts hold
        // Option<&'static BunInstall>. ctx is the process-global ContextData so
        // the borrow is effectively 'static — extend via raw ptr.
        let install_ref = ctx
            .install
            .as_deref()
            .map(|p| unsafe { &*(p as *const _) });
        b.options.install = install_ref;
        // PORT NOTE: resolver's stub `BundleOptions.install` is `*const ()` (forward-decl
        // to break the bun_install dep cycle) — erase the type here.
        b.resolver.opts.install =
            install_ref.map_or(core::ptr::null(), |p| p as *const _ as *const ());
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Offline;
        let prefer_latest =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineMode::Online) == OfflineMode::Latest;
        // TODO(port): blocked_on: bun_resolver::options::BundleOptions::prefer_latest_install —
        // resolver's forward-decl stub lacks this field; assign directly to b.options below.
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = prefer_latest;
        b.resolver.env_loader = NonNull::new(b.env);
        b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
        b.options.dead_code_elimination = false; // REPL needs all code

        if let Err(_) = b.configure_defines() {
            Self::dump_build_error(unsafe { &*vm });
            Global::exit(1);
        }

        // SAFETY: vm.log is set by VirtualMachine::init; b.env is a valid Loader.
        bun_http::async_http::load_env(
            unsafe { (*vm).log.unwrap().as_mut() },
            unsafe { &*b.env },
        );
        unsafe { (&mut *vm).load_extra_env_and_source_code_printer() };

        unsafe { (*vm).is_main_thread = true };
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.with(|c| c.set(true));

        // Store VM reference in REPL (safe - no JS allocation)
        // SAFETY: vm/global outlive the REPL (process-lifetime).
        repl.vm = Some(unsafe { &*vm });
        repl.global = Some(unsafe { &*(*vm).global });

        // Create the ReplRunner and execute within the API lock
        // NOTE: JS-allocating operations like ExposeNodeModuleGlobals must
        // be done inside the API lock callback, not before
        let mut runner = ReplRunner {
            repl,
            vm,
            arena,
            entry_path: repl_path,
            // PORT NOTE: ctx is the process-global ContextData; extend the
            // borrow past the local reborrow lifetime via raw ptr (the runner
            // never outlives ctx — global_exit() is `!`).
            eval_script: unsafe { &*(&*ctx.runtime_options.eval.script as *const [u8]) },
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
        };
        // TODO(port): @constCast(&arena) — vm.arena stores a *mut Arena pointing at runner.arena;
        // lifetime is the holdAPILock scope (globalExit() never returns so the frame never unwinds).
        // Assigned AFTER moving `arena` into `runner` — assigning from the pre-move local would
        // dangle. Model as raw ptr until VM arena ownership is decided in Phase B.
        unsafe { (*vm).arena = NonNull::new(&mut runner.arena) };

        // PORT NOTE: jsc.OpaqueWrap(ReplRunner, ReplRunner.start) — comptime fn-ptr wrapper that
        // produces an `extern "C" fn(*mut c_void)` thunk. `bun_jsc::opaque_wrap` requires a
        // type implementing `FnTyped<Ctx>`; rather than depend on that upstream trait, write
        // the trivial thunk locally.
        extern "C" fn repl_runner_thunk(ctx: *mut c_void) {
            // SAFETY: caller passes `&mut ReplRunner` cast to *mut c_void.
            let runner = unsafe { &mut *(ctx as *mut ReplRunner<'_, '_>) };
            ReplRunner::start(runner);
        }
        // SAFETY: vm.global is valid; runner is pinned on stack for the lock duration.
        #[allow(deprecated)]
        unsafe {
            (&*(*vm).global)
                .vm()
                .hold_api_lock((&mut runner) as *mut ReplRunner<'_, '_> as *mut c_void, repl_runner_thunk);
        }
        Ok(())
    }

    fn dump_build_error(vm: &VirtualMachine) {
        Output::flush();
        let writer = Output::error_writer_buffered();
        // defer Output.flush() → scopeguard
        let _flush = scopeguard::guard((), |_| Output::flush());
        if let Some(log) = vm.log {
            // SAFETY: log is a valid NonNull<Log> for the VM lifetime.
            // `Log::print` accepts `*mut io::Writer` (IntoLogWrite is impl'd for the raw ptr,
            // not the &mut), so coerce the `&'static mut Writer` from `error_writer_buffered`.
            let _ = unsafe { (*log.as_ptr()).print(writer as *mut bun_core::io::Writer) };
        }
    }
}

/// Runs the REPL within the VM's API lock
// PORT NOTE: split lifetimes — `'a` is the stack borrow of the runner/repl,
// `'r` is the (effectively process-lifetime) VM/global references stored in
// `Repl<'r>`. Tying them as `&'a mut Repl<'a>` makes the borrow invariant and
// outlive the local, tripping the borrow checker against `Drop for Repl`.
struct ReplRunner<'a, 'r> {
    repl: &'a mut Repl<'r>,
    vm: *mut VirtualMachine,
    arena: Arena,
    entry_path: &'static [u8],
    eval_script: &'a [u8],
    eval_and_print: bool,
}

impl<'a, 'r> ReplRunner<'a, 'r> {
    pub fn start(this: &mut ReplRunner<'a, 'r>) {
        let vm_ptr = this.vm;
        // SAFETY: vm_ptr is a valid heap-allocated VirtualMachine for the API-lock scope.
        let vm = unsafe { &mut *vm_ptr };

        // Set up the REPL environment (now inside API lock)
        if let Err(_) = this.setup_repl_environment() {
            // setupGlobalRequire threw a JS exception — surface it and exit
            // SAFETY: vm.global is valid for the API-lock scope.
            if let Some(exception) = unsafe { (*vm.global).try_take_exception() } {
                vm.print_error_like_object_to_console(exception);
            }
            vm.exit_handler.exit_code = 1;
            vm.on_exit();
            vm.global_exit();
        }

        if !this.eval_script.is_empty() || this.eval_and_print {
            // Non-interactive: evaluate the -e/--eval or -p/--print script,
            // drain the event loop, and exit
            let had_error = this.repl.eval_script(this.eval_script, this.eval_and_print);
            Output::flush();
            if had_error {
                // Only overwrite on error so `process.exitCode = N` in the
                // script is preserved on success.
                vm.exit_handler.exit_code = 1;
            } else {
                // Fire process.on("beforeExit") and re-drain as needed
                // (matches bun -e / Node.js semantics).
                vm.on_before_exit();
            }
        } else {
            // Interactive: run the REPL loop
            if let Err(err) = this.repl.run_with_vm(Some(unsafe { &*vm_ptr })) {
                // TODO(port): Output.prettyErrorln color-tag formatting macro
                Output::pretty_errorln(format_args!("<r><red>REPL error: {}<r>", err.name()));
            }
        }

        // Clean up
        vm.on_exit();
        vm.global_exit();
    }

    fn setup_repl_environment(&mut self) -> bun_jsc::JsResult<()> {
        // SAFETY: self.vm is valid for the API-lock scope.
        let vm = unsafe { &mut *self.vm };

        // Expose Node.js module globals (__dirname, __filename, require, etc.)
        // This must be done inside the API lock as it allocates JS objects
        // SAFETY: vm.global is a valid JSGlobalObject pointer for the duration of the API lock.
        unsafe {
            Bun__ExposeNodeModuleGlobals(vm.global);
        }

        // Set up require(), module, __filename, __dirname relative to cwd
        // SAFETY: transpiler.fs is a valid *mut FileSystem set during VM init.
        // PORT NOTE: `bun_resolver::fs::FileSystem` (the inline stub re-exported as
        // `bun_bundler::bun_fs`) doesn't expose `top_level_dir_without_trailing_slash()`
        // yet — inline the trivial trailing-sep strip here.
        let cwd = unsafe {
            let tld = (*vm.transpiler.fs).top_level_dir;
            if tld.len() > 1 && tld[tld.len() - 1] == bun_paths::SEP {
                &tld[..tld.len() - 1]
            } else {
                tld
            }
        };
        // SAFETY: cwd is a valid byte slice; FFI fn reads exactly `len` bytes.
        unsafe {
            Bun__REPL__setupGlobalRequire(vm.global, cwd.as_ptr() as *const c_char, cwd.len())?;
        }

        // Set timezone if specified
        // SAFETY: transpiler.env is a valid *mut Loader set during VM init.
        if let Some(tz) = unsafe { (*vm.transpiler.env).get(b"TZ") } {
            if !tz.is_empty() {
                // SAFETY: vm.global is valid; ZigString borrows `tz` for the FFI call duration.
                // PORT NOTE: `JSGlobalObject::set_time_zone` isn't exposed on the Rust
                // wrapper yet — call the underlying C++ export directly.
                let _ = unsafe { JSGlobalObject__setTimeZone(vm.global, &ZigString::init(tz)) };
            }
        }

        // SAFETY: transpiler.env is valid.
        unsafe { (*vm.transpiler.env).load_tracy() };
        Ok(())
    }
}

// TODO(port): move to bun_jsc_sys (or wherever bun.cpp externs land)
unsafe extern "C" {
    fn Bun__ExposeNodeModuleGlobals(global: *const JSGlobalObject);
    // Local shim for `JSGlobalObject::setTimeZone` (ZigGlobalObject.cpp) until
    // bun_jsc grows a wrapper.
    fn JSGlobalObject__setTimeZone(global: *const JSGlobalObject, time_zone: *const ZigString) -> bool;
    // TODO(port): Zig signature returns `bun.JSError!void` across FFI — actual C ABI is likely
    // `bool`/`void` with exception on VM. Verify against bindings and adjust JsResult conversion.
    fn Bun__REPL__setupGlobalRequire(
        global: *const JSGlobalObject,
        cwd_ptr: *const c_char,
        cwd_len: usize,
    ) -> bun_jsc::JsResult<()>;
}

use bun_bundler::options::EnvBehavior;
use bun_options_types::OfflineMode::OfflineMode;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/repl_command.zig (191 lines)
//   confidence: medium
//   todos:      12
//   notes:      Arena/allocator threading into VirtualMachine (bun_alloc::Arena ≠ MimallocArena) and OpaqueWrap callback shim need Phase-B design; vm.arena ptr assigned post-move into ReplRunner to avoid dangling; FFI return type for Bun__REPL__setupGlobalRequire needs verification.
// ──────────────────────────────────────────────────────────────────────────
