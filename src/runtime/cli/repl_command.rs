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

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::dns_jsc::Order as DnsOrder;
use bun_alloc::Arena;
use bun_core::ZigString;
use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject};

// `repl.rs` is a sibling file with no other consumers; declare it as a child
// module here so `Repl` resolves without touching `cli/mod.rs`.
#[path = "repl.rs"]
mod repl;
use repl::Repl;

use crate::Command;
use crate::cli::Arguments;

pub(crate) struct ReplCommand;

impl ReplCommand {
    #[cold]
    pub(crate) fn exec(ctx: Command::Context<'_>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set

        // Initialize the REPL
        let mut repl = Repl::init();
        // `defer repl.deinit()` → handled by Drop

        // Boot the JavaScript VM for the REPL
        Self::boot_repl_vm(ctx, &mut repl)
    }

    fn boot_repl_vm<'r>(
        ctx: Command::Context<'_>,
        repl: &mut Repl<'r>,
    ) -> Result<(), bun_core::Error> {
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

        bun_ast::initialize_store();
        let arena = Arena::new();

        // Validate DNS result order (InitOptions doesn't carry it yet — see TODO below).
        let _dns_order = DnsOrder::from_string(&ctx.runtime_options.dns_result_order)
            .unwrap_or_else(|| {
                Output::pretty_errorln("<r><red>error<r><d>:<r> Invalid DNS result order.");
                Global::exit(1);
            });

        // Initialize the VM
        // TODO(port): `jsc::VirtualMachineInitOptions` still lacks `store_fd` /
        // `eval` / `dns_result_order` (wired post-init below where applicable).
        let vm: *mut VirtualMachine = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            // TODO(port): allocator field — VM owns arena allocator; see note above
            transform_options: core::mem::take(&mut ctx.args),
            debugger: core::mem::take(&mut ctx.runtime_options.debugger),
            log: core::ptr::NonNull::new(ctx.log),
            smol: ctx.runtime_options.smol,
            eval_mode: true,
            is_main_thread: true,
            ..Default::default()
        })?;

        // SAFETY: vm is a freshly heap-allocated VirtualMachine valid for process lifetime.
        let b = unsafe { &mut (*vm).transpiler };
        // SAFETY: vm valid as above; preload/argv are disjoint from `b`'s transpiler borrow.
        unsafe {
            (*vm).preload = core::mem::take(&mut ctx.preloads);
            (*vm).argv = core::mem::take(&mut ctx.passthrough);
        }
        // TODO(port): vm.allocator = vm.arena.arena(); — allocator threading dropped in Rust
        // (vm.arena assignment moved below ReplRunner construction to avoid move-after-borrow)

        let install_ptr = ctx.install.as_deref().map(core::ptr::NonNull::from);
        b.options.install = install_ptr;
        b.resolver.opts.install = install_ptr;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        b.resolver.opts.prefer_offline_install = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online)
            == OfflineMode::Offline;
        let prefer_latest = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online)
            == OfflineMode::Latest;
        // TODO(port): blocked_on: bun_resolver::options::BundleOptions::prefer_latest_install —
        // resolver's forward-decl stub lacks this field; assign directly to b.options below.
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = prefer_latest;
        b.resolver.env_loader = NonNull::new(b.env);
        b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
        b.options.dead_code_elimination = false; // REPL needs all code

        if b.configure_defines().is_err() {
            Self::dump_build_error(VirtualMachine::get());
            Global::exit(1);
        }

        bun_http::async_http::load_env(VirtualMachine::get().log_mut().unwrap(), b.env());
        VirtualMachine::get()
            .as_mut()
            .load_extra_env_and_source_code_printer();

        VirtualMachine::get().as_mut().is_main_thread = true;
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

        // Store VM reference in REPL (safe - no JS allocation)
        repl.vm = Some(VirtualMachine::get());
        repl.global = Some(VirtualMachine::get().global());

        // Create the ReplRunner and execute within the API lock
        // NOTE: JS-allocating operations like ExposeNodeModuleGlobals must
        // be done inside the API lock callback, not before
        let mut runner = ReplRunner {
            repl,
            vm,
            arena,
            // PORT NOTE: ctx is the process-global ContextData; extend the
            // borrow past the local reborrow lifetime via raw ptr (the runner
            // never outlives ctx — global_exit() is `!`).
            eval_script: {
                let ptr: *const [u8] = &raw const *ctx.runtime_options.eval.script;
                // SAFETY: ctx.runtime_options.eval.script lives in the process-global
                // ContextData; the raw-ptr reborrow is sound because the runner never
                // outlives it — hold_api_lock returns into global_exit() (`!`).
                unsafe { &*ptr }
            },
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
        };
        // TODO(port): @constCast(&arena) — vm.arena stores a *mut Arena pointing at runner.arena;
        // lifetime is the holdAPILock scope (globalExit() never returns so the frame never unwinds).
        // Assigned AFTER moving `arena` into `runner` — assigning from the pre-move local would
        // dangle. Model as raw ptr until VM arena ownership is decided.
        // SAFETY: vm is valid for process lifetime (see above); runner.arena is pinned on this
        // stack frame for the holdAPILock scope and global_exit() (`!`) prevents unwind past it.
        unsafe { (*vm).arena = NonNull::new(&raw mut runner.arena) };

        extern "C" fn repl_runner_thunk(ctx: *mut c_void) {
            // SAFETY: caller passes `&mut ReplRunner` cast to *mut c_void.
            let runner = unsafe { bun_ptr::callback_ctx::<ReplRunner<'_, '_>>(ctx) };
            ReplRunner::start(runner);
        }
        // SAFETY: vm.global is valid; runner is pinned on stack for the lock duration.
        #[allow(deprecated)]
        unsafe {
            (&*(*vm).global)
                .vm()
                .hold_api_lock((&raw mut runner).cast::<c_void>(), repl_runner_thunk);
        }
        Ok(())
    }

    fn dump_build_error(vm: &VirtualMachine) {
        Output::flush();
        let writer = Output::error_writer_buffered();
        // defer Output.flush()
        let _flush = Output::flush_guard();
        if let Some(log) = vm.log {
            // SAFETY: log is a valid NonNull<Log> for the VM lifetime.
            // `Log::print` accepts `*mut io::Writer` (IntoLogWrite is impl'd for the raw ptr,
            // not the &mut), so coerce the `&mut Writer` from `error_writer_buffered`.
            let _ = unsafe {
                (*log.as_ptr()).print(std::ptr::from_mut::<bun_core::io::Writer>(writer))
            };
        }
    }
}

struct ReplRunner<'a, 'r> {
    repl: &'a mut Repl<'r>,
    vm: *mut VirtualMachine,
    arena: Arena,
    eval_script: &'a [u8],
    eval_and_print: bool,
}

impl<'a, 'r> ReplRunner<'a, 'r> {
    pub(crate) fn start(this: &mut ReplRunner<'a, 'r>) {
        let _ = this.vm;
        let vm = VirtualMachine::get().as_mut();

        // Set up the REPL environment (now inside API lock)
        if this.setup_repl_environment().is_err() {
            // setupGlobalRequire threw a JS exception — surface it and exit
            if let Some(exception) = vm.global().try_take_exception() {
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
            if let Err(err) = this.repl.run_with_vm(Some(VirtualMachine::get())) {
                // TODO(port): Output.prettyErrorln color-tag formatting macro
                Output::pretty_errorln(format_args!("<r><red>REPL error: {}<r>", err.name()));
            }
        }

        // Clean up
        vm.on_exit();
        vm.global_exit();
    }

    fn setup_repl_environment(&mut self) -> bun_jsc::JsResult<()> {
        let vm = VirtualMachine::get().as_mut();

        // Expose Node.js module globals (__dirname, __filename, require, etc.)
        // This must be done inside the API lock as it allocates JS objects
        // SAFETY: vm.global is a valid JSGlobalObject pointer for the duration of the API lock.
        unsafe {
            Bun__ExposeNodeModuleGlobals(vm.global);
        }

        // Set up require(), module, __filename, __dirname relative to cwd
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
        // SAFETY: cwd is a valid byte slice; FFI fn reads exactly `len` bytes.
        // C++ is `[[ZIG_EXPORT(check_slow)]]` → use the generated `bun_jsc::cpp` wrapper,
        // which opens a `TopExceptionScope` before the call (post-hoc `has_exception()`
        // would assert under `BUN_JSC_validateExceptionChecks=1`).
        unsafe {
            bun_jsc::cpp::Bun__REPL__setupGlobalRequire(&*vm.global, cwd.as_ptr(), cwd.len())?;
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
    fn JSGlobalObject__setTimeZone(
        global: *const JSGlobalObject,
        time_zone: *const ZigString,
    ) -> bool;
}

use bun_bundler::options::EnvBehavior;
use bun_options_types::offline_mode::OfflineMode;

// ported from: src/cli/repl_command.zig
