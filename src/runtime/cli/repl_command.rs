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

use core::ffi::c_char;

use bun_alloc::Arena;
use bun_core::{Global, Output};
use bun_jsc::{self as jsc, JSGlobalObject, VirtualMachine};
use bun_js_parser as js_ast;
use bun_runtime::api::dns::Resolver as DNSResolver;
use bun_str::ZigString;

use crate::repl::Repl;
use crate::{Arguments, Command};

pub struct ReplCommand;

impl ReplCommand {
    #[cold]
    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set

        // Initialize the REPL
        let mut repl = Repl::init();
        // `defer repl.deinit()` → handled by Drop

        // Boot the JavaScript VM for the REPL
        Self::boot_repl_vm(ctx, &mut repl)
    }

    fn boot_repl_vm(ctx: Command::Context, repl: &mut Repl) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Load bunfig if not already loaded
        if !ctx.debug.loaded_bunfig {
            Arguments::load_config_path(true, b"bunfig.toml", &ctx, Command::Tag::RunCommand)?;
        }

        // Initialize JSC
        jsc::initialize(true); // true for eval mode

        js_ast::Expr::Data::Store::create();
        js_ast::Stmt::Data::Store::create();
        // TODO(port): arena is threaded into VirtualMachine (vm.arena / vm.allocator). Non-AST
        // crate would normally drop MimallocArena, but VM init protocol requires it. Note
        // `bun_alloc::Arena` is bumpalo-backed and NOT semantically `bun.allocators.MimallocArena`
        // (mi_heap wrapper) — Phase B should either have bun_jsc::VirtualMachine own its arena
        // internally (drop the param) or expose a distinct `bun_alloc::MimallocArena` type.
        let arena = Arena::init();

        // Create a virtual path for REPL evaluation
        let repl_path: &'static [u8] = b"[repl]";

        // Initialize the VM
        let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            // TODO(port): allocator field — VM owns arena allocator; see note above
            log: ctx.log,
            args: ctx.args,
            store_fd: false,
            smol: ctx.runtime_options.smol,
            eval: true,
            debugger: ctx.runtime_options.debugger,
            dns_result_order: DNSResolver::Order::from_string_or_die(
                ctx.runtime_options.dns_result_order,
            ),
            is_main_thread: true,
        })?;

        let b = &mut vm.transpiler;
        vm.preload = ctx.preloads;
        vm.argv = ctx.passthrough;
        // TODO(port): vm.allocator = vm.arena.allocator(); — allocator threading dropped in Rust
        // (vm.arena assignment moved below ReplRunner construction to avoid move-after-borrow)

        // Configure bundler options
        b.options.install = ctx.install;
        b.resolver.opts.install = ctx.install;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        // TODO(port): exact enum type for offline_mode_setting (Online/Offline/Latest)
        b.resolver.opts.prefer_offline_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineModeSetting::Online)
                == OfflineModeSetting::Offline;
        b.resolver.opts.prefer_latest_install =
            ctx.debug.offline_mode_setting.unwrap_or(OfflineModeSetting::Online)
                == OfflineModeSetting::Latest;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.prefer_offline_install = b.resolver.opts.prefer_offline_install;
        b.options.prefer_latest_install = b.resolver.opts.prefer_latest_install;
        b.resolver.env_loader = b.env;
        b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
        b.options.dead_code_elimination = false; // REPL needs all code

        if let Err(_) = b.configure_defines() {
            Self::dump_build_error(vm);
            Global::exit(1);
        }

        bun_http::AsyncHTTP::load_env(vm.log, b.env);
        vm.load_extra_env_and_source_code_printer();

        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        // Store VM reference in REPL (safe - no JS allocation)
        repl.vm = vm;
        repl.global = vm.global;

        // Create the ReplRunner and execute within the API lock
        // NOTE: JS-allocating operations like ExposeNodeModuleGlobals must
        // be done inside the API lock callback, not before
        let mut runner = ReplRunner {
            repl,
            vm,
            arena,
            entry_path: repl_path,
            eval_script: ctx.runtime_options.eval.script,
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
        };
        // TODO(port): @constCast(&arena) — vm.arena stores a *mut Arena pointing at runner.arena;
        // lifetime is the holdAPILock scope (globalExit() never returns so the frame never unwinds).
        // Assigned AFTER moving `arena` into `runner` — assigning from the pre-move local would
        // dangle. Model as raw ptr until VM arena ownership is decided in Phase B.
        vm.arena = &mut runner.arena as *mut Arena;

        // TODO(port): jsc.OpaqueWrap(ReplRunner, ReplRunner.start) — comptime fn-ptr wrapper that
        // produces an `extern "C" fn(*mut c_void)` thunk. Needs a Rust equivalent macro/generic
        // in bun_jsc (e.g. `opaque_wrap::<T>(T::start)`).
        let callback = jsc::opaque_wrap::<ReplRunner>(ReplRunner::start);
        vm.global.vm().hold_api_lock(&mut runner, callback);
        Ok(())
    }

    fn dump_build_error(vm: &VirtualMachine) {
        Output::flush();
        let writer = Output::error_writer_buffered();
        // defer Output.flush() → scopeguard
        let _flush = scopeguard::guard((), |_| Output::flush());
        let _ = vm.log.print(writer);
    }
}

/// Runs the REPL within the VM's API lock
struct ReplRunner<'a> {
    repl: &'a mut Repl,
    vm: &'a VirtualMachine,
    arena: Arena,
    entry_path: &'static [u8],
    eval_script: &'a [u8],
    eval_and_print: bool,
}

impl<'a> ReplRunner<'a> {
    pub fn start(this: &mut ReplRunner<'a>) {
        let vm = this.vm;

        // Set up the REPL environment (now inside API lock)
        if let Err(_) = this.setup_repl_environment() {
            // setupGlobalRequire threw a JS exception — surface it and exit
            if let Some(exception) = vm.global.try_take_exception() {
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
            if let Err(err) = this.repl.run_with_vm(vm) {
                // TODO(port): Output.prettyErrorln color-tag formatting macro
                Output::pretty_errorln(format_args!("<r><red>REPL error: {}<r>", err.name()));
            }
        }

        // Clean up
        vm.on_exit();
        vm.global_exit();
    }

    fn setup_repl_environment(this: &mut ReplRunner<'a>) -> bun_jsc::JsResult<()> {
        let vm = this.vm;

        // Expose Node.js module globals (__dirname, __filename, require, etc.)
        // This must be done inside the API lock as it allocates JS objects
        // SAFETY: vm.global is a valid JSGlobalObject pointer for the duration of the API lock.
        unsafe {
            Bun__ExposeNodeModuleGlobals(vm.global);
        }

        // Set up require(), module, __filename, __dirname relative to cwd
        let cwd = vm.transpiler.fs.top_level_dir_without_trailing_slash();
        // SAFETY: cwd is a valid byte slice; FFI fn reads exactly `len` bytes.
        unsafe {
            Bun__REPL__setupGlobalRequire(vm.global, cwd.as_ptr() as *const c_char, cwd.len())?;
        }

        // Set timezone if specified
        if let Some(tz) = vm.transpiler.env.get(b"TZ") {
            if !tz.is_empty() {
                let _ = vm.global.set_time_zone(&ZigString::init(tz));
            }
        }

        vm.transpiler.env.load_tracy();
        Ok(())
    }
}

// TODO(port): move to bun_jsc_sys (or wherever bun.cpp externs land)
unsafe extern "C" {
    fn Bun__ExposeNodeModuleGlobals(global: *const JSGlobalObject);
    // TODO(port): Zig signature returns `bun.JSError!void` across FFI — actual C ABI is likely
    // `bool`/`void` with exception on VM. Verify against bindings and adjust JsResult conversion.
    fn Bun__REPL__setupGlobalRequire(
        global: *const JSGlobalObject,
        cwd_ptr: *const c_char,
        cwd_len: usize,
    ) -> bun_jsc::JsResult<()>;
}

// TODO(port): these enum types live in bun_bundler::options / bun_cli — import the real ones in
// Phase B. Placeholders here so control flow reads correctly.
use bun_bundler::options::{EnvBehavior, OfflineModeSetting};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/repl_command.zig (191 lines)
//   confidence: medium
//   todos:      12
//   notes:      Arena/allocator threading into VirtualMachine (bun_alloc::Arena ≠ MimallocArena) and OpaqueWrap callback shim need Phase-B design; vm.arena ptr assigned post-move into ReplRunner to avoid dangling; FFI return type for Bun__REPL__setupGlobalRequire needs verification.
// ──────────────────────────────────────────────────────────────────────────
