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

use core::ptr::NonNull;

use crate::dns_jsc::Order as DnsOrder;
use bun_core::EncodedSlice;
use bun_core::{Global, Output};
use bun_jsc as jsc;
use bun_jsc::virtual_machine::VirtualMachine;

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
    pub(crate) fn exec(ctx: Command::Context<'_>) -> Result<(), crate::Error> {
        // Initialize the REPL
        let mut repl = Repl::init();
        // `defer repl.deinit()` → handled by Drop

        // Boot the JavaScript VM for the REPL
        Self::boot_repl_vm(ctx, &mut repl)
    }

    fn boot_repl_vm<'r>(
        ctx: Command::Context<'_>,
        repl: &mut Repl<'r>,
    ) -> Result<(), crate::Error> {
        // Load bunfig if not already loaded
        if !ctx.debug.loaded_bunfig {
            Arguments::load_config_path(
                Command::Tag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        jsc::initialize(jsc::InitializeOptions {
            eval_mode: true,
            ..Default::default()
        });

        bun_ast::initialize_store();

        // Validate DNS result order before VM init; wired onto the VM
        // post-init below, like run_command.rs.
        let dns_order = DnsOrder::from_string(&ctx.runtime_options.dns_result_order)
            .unwrap_or_else(|| {
                bun_core::pretty_errorln!("<r><red>error<r><d>:<r> Invalid DNS result order.");
                Global::exit(1);
            });

        let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            transform_options: core::mem::take(&mut ctx.args),
            argv: core::mem::take(&mut ctx.passthrough).leak(),
            debugger: core::mem::take(&mut ctx.runtime_options.debugger),
            log: core::ptr::NonNull::new(ctx.log),
            global_cache: ctx.debug.global_cache,
            smol: ctx.runtime_options.smol,
            eval_mode: true,
            is_main_thread: true,
            ..Default::default()
        })?;

        vm.preload.set(core::mem::take(&mut ctx.preloads));
        vm.dns_result_order.set(dns_order as u8);

        // Configure bundler options
        // `BundleOptions.install` is `Option<NonNull<_>>` so no
        // lifetime-extension cast is needed.
        let install_ptr = ctx.install.as_deref().map(core::ptr::NonNull::from);
        let offline = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online);
        let configured = vm.transpiler.with_mut(|b| {
            b.options.install = install_ptr;
            b.resolver.opts.install = install_ptr;
            b.resolver.opts.install_preference = offline;
            b.options.install_preference = offline;
            b.resolver.env_loader = NonNull::new(b.env);
            b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
            b.options.dead_code_elimination = false; // REPL needs all code
            b.configure_defines()
        });
        if configured.is_err() {
            Self::dump_build_error(vm);
            Global::exit(1);
        }

        bun_http::async_http::load_env(vm.log_mut().unwrap(), vm.transpiler.get().env());
        vm.load_extra_env_and_source_code_printer();

        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

        // Store VM reference in REPL (safe - no JS allocation)
        repl.vm = Some(vm);
        let global = vm.global();
        repl.global = Some(global);

        // Create the ReplRunner and execute within the API lock
        // NOTE: JS-allocating operations like ExposeNodeModuleGlobals must
        // be done under the API lock, not before
        let mut runner = ReplRunner {
            repl,
            eval_script: ctx.runtime_options.eval.script,
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
        };

        let _api_lock = global.vm().get_api_lock();
        ReplRunner::start(&mut runner)
    }

    fn dump_build_error(vm: &VirtualMachine) {
        Output::flush();
        let writer = Output::error_writer_buffered();
        let _flush = Output::flush_guard();
        if let Some(log) = vm.log.get() {
            // SAFETY: log is a valid NonNull<Log> for the VM lifetime.
            // `Log::print` accepts `*mut io::Writer` (IntoLogWrite is impl'd for the raw ptr,
            // not the &mut), so coerce the `&mut Writer` from `error_writer_buffered`.
            let _ = unsafe {
                (*log.as_ptr()).print(std::ptr::from_mut::<bun_core::io::Writer>(writer))
            };
        }
    }
}

/// Runs the REPL within the VM's API lock
// Split lifetimes — `'a` is the stack borrow of the runner/repl,
// `'r` is the (effectively process-lifetime) VM/global references stored in
// `Repl<'r>`. Tying them as `&'a mut Repl<'a>` makes the borrow invariant and
// outlive the local, tripping the borrow checker against `Drop for Repl`.
struct ReplRunner<'a, 'r> {
    repl: &'a mut Repl<'r>,
    eval_script: &'a [u8],
    eval_and_print: bool,
}

impl<'a, 'r> ReplRunner<'a, 'r> {
    fn start(this: &mut ReplRunner<'a, 'r>) -> ! {
        let vm = VirtualMachine::get();

        // Set up the REPL environment (now inside API lock)
        if this.setup_repl_environment().is_err() {
            // setupGlobalRequire threw a JS exception — surface it and exit
            if let Some(exception) = vm.global().try_take_exception() {
                vm.print_error_like_object_to_console(exception);
            }
            vm.exit_handler.exit_code.set(1);
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
                vm.exit_handler.exit_code.set(1);
            } else {
                // Fire process.on("beforeExit") and re-drain as needed
                // (matches bun -e / Node.js semantics).
                vm.on_before_exit();
            }
        } else {
            // Interactive: run the REPL loop
            if let Err(err) = this.repl.run_with_vm(Some(VirtualMachine::get())) {
                bun_core::pretty_errorln!("<r><red>REPL error: {}<r>", err.name());
            }
        }

        // Clean up
        vm.on_exit();
        vm.global_exit()
    }

    fn setup_repl_environment(&mut self) -> bun_jsc::JsResult<()> {
        let vm = VirtualMachine::get();
        let global = vm.global();

        // Expose Node.js module globals (__dirname, __filename, require, etc.)
        // This must be done inside the API lock as it allocates JS objects
        bun_jsc::cpp::Bun__ExposeNodeModuleGlobals(global);

        // Set up require(), module, __filename, __dirname relative to cwd
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
        // SAFETY: cwd is a valid byte slice; FFI fn reads exactly `len` bytes.
        // C++ is `[[ZIG_EXPORT(check_slow)]]` → use the generated `bun_jsc::cpp` wrapper,
        // which opens a `TopExceptionScope` before the call (post-hoc `has_exception()`
        // would assert under `BUN_JSC_validateExceptionChecks=1`).
        unsafe {
            bun_jsc::cpp::Bun__REPL__setupGlobalRequire(global, cwd.as_ptr(), cwd.len())?;
        }

        // Set timezone if specified
        // SAFETY: transpiler.env is a valid *mut Loader set during VM init.
        if let Some(tz) = unsafe { (*vm.transpiler.get().env).get(b"TZ") } {
            if !tz.is_empty() {
                let _ = global.set_time_zone(&EncodedSlice::from_bytes(tz));
            }
        }

        Ok(())
    }
}

use bun_bundler::options::EnvBehavior;
use bun_options_types::offline_mode::OfflineMode;
