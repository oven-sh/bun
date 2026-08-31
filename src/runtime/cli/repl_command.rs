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
use bun_alloc::Arena;
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
        // The arena is threaded into VirtualMachine (vm.arena). `bun_alloc::Arena`
        // is `MimallocArena` (a per-heap mimalloc wrapper).
        let arena = Arena::new();

        // Validate DNS result order before VM init; wired onto the VM
        // post-init below, like run_command.rs.
        let dns_order = DnsOrder::from_string(&ctx.runtime_options.dns_result_order)
            .unwrap_or_else(|| {
                bun_core::pretty_errorln!("<r><red>error<r><d>:<r> Invalid DNS result order.");
                Global::exit(1);
            });

        // Initialize the VM. `InitOptions` has no allocator field (the VM does
        // not take a caller-provided allocator in the Rust port; `vm.arena` is
        // set below).
        VirtualMachine::init(jsc::VirtualMachineInitOptions {
            transform_options: core::mem::take(&mut ctx.args),
            debugger: core::mem::take(&mut ctx.runtime_options.debugger),
            log: core::ptr::NonNull::new(ctx.log_ptr()),
            smol: ctx.runtime_options.smol,
            eval_mode: true,
            is_main_thread: true,
            ..Default::default()
        })?;
        // `init` installed the freshly-boxed VM as this thread's singleton.
        let vm: &'static mut VirtualMachine = VirtualMachine::get_mut();

        vm.preload = core::mem::take(&mut ctx.preloads);
        vm.argv = core::mem::take(&mut ctx.passthrough);
        // `vm.dns_result_order` is a `u8` (see VirtualMachine.rs); set
        // post-init like run_command.rs since InitOptions doesn't carry it.
        vm.dns_result_order = dns_order as u8;
        // There is no per-VM allocator handle; the `vm.arena` assignment itself happens below
        // ReplRunner construction to avoid a move-after-borrow.

        // Configure bundler options
        // `BundleOptions.install` is `Option<NonNull<_>>` so no
        // lifetime-extension cast is needed.
        let b = &mut vm.transpiler;
        let install_ptr = ctx.install.as_deref().map(core::ptr::NonNull::from);
        b.options.install = install_ptr;
        b.resolver.opts.install = install_ptr;
        b.resolver.opts.global_cache = ctx.debug.global_cache;
        let offline = ctx
            .debug
            .offline_mode_setting
            .unwrap_or(OfflineMode::Online);
        b.resolver.opts.install_preference = offline;
        b.options.global_cache = b.resolver.opts.global_cache;
        b.options.install_preference = offline;
        b.resolver.env_loader = NonNull::new(b.env);
        b.options.env.behavior = EnvBehavior::LoadAllWithoutInlining;
        b.options.dead_code_elimination = false; // REPL needs all code

        if b.configure_defines().is_err() {
            Self::dump_build_error(vm);
            Global::exit(1);
        }

        bun_http::async_http::load_env(vm.log_mut().unwrap(), vm.transpiler.env());
        vm.load_extra_env_and_source_code_printer();

        vm.is_main_thread = true;
        bun_jsc::virtual_machine::IS_MAIN_THREAD_VM.set(true);

        // Store VM reference in REPL (safe - no JS allocation)
        repl.vm = Some(VirtualMachine::get());
        repl.global = Some(VirtualMachine::get().global());

        // Create the ReplRunner and execute within the API lock
        // NOTE: JS-allocating operations like ExposeNodeModuleGlobals must
        // be done inside the API lock callback, not before
        let mut runner = ReplRunner {
            repl,
            arena,
            // ctx is the process-global ContextData; the runner lives on this frame.
            eval_script: &ctx.runtime_options.eval.script,
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
        };
        // vm.arena points at runner.arena; lifetime is the API-lock scope
        // (globalExit() never returns so the frame never unwinds). Assigned AFTER
        // moving `arena` into `runner` — assigning from the pre-move local would dangle.
        vm.arena = NonNull::new(&raw mut runner.arena);

        vm.run_with_api_lock_mut(|vm| ReplRunner::start(&mut runner, vm));
        Ok(())
    }

    fn dump_build_error(vm: &VirtualMachine) {
        Output::flush();
        let writer = Output::error_writer_buffered();
        let _flush = Output::flush_guard();
        if let Some(log) = vm.log_ref() {
            // `Log::print` accepts `*mut io::Writer` (IntoLogWrite is impl'd for the raw ptr,
            // not the &mut), so coerce the `&mut Writer` from `error_writer_buffered`.
            let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(writer));
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
    arena: Arena,
    eval_script: &'a [u8],
    eval_and_print: bool,
}

impl<'a, 'r> ReplRunner<'a, 'r> {
    fn start(this: &mut ReplRunner<'a, 'r>, vm: &mut VirtualMachine) {
        // Set up the REPL environment (now inside API lock)
        if this.setup_repl_environment(vm).is_err() {
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
                bun_core::pretty_errorln!("<r><red>REPL error: {}<r>", err.name());
            }
        }

        // Clean up
        vm.on_exit();
        vm.global_exit();
    }

    fn setup_repl_environment(&mut self, vm: &mut VirtualMachine) -> bun_jsc::JsResult<()> {
        // Expose Node.js module globals (__dirname, __filename, require, etc.)
        // This must be done inside the API lock as it allocates JS objects
        vm.global().expose_node_module_globals();

        // Set up require(), module, __filename, __dirname relative to cwd
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
        // C++ is `[[ZIG_EXPORT(check_slow)]]` → the generated `bun_jsc::cpp` wrapper
        // opens a `TopExceptionScope` before the call (post-hoc `has_exception()`
        // would assert under `BUN_JSC_validateExceptionChecks=1`).
        vm.global().repl_setup_global_require(cwd)?;

        // Set timezone if specified
        if let Some(tz) = vm.transpiler.env().get(b"TZ") {
            if !tz.is_empty() {
                let _ = vm.global().set_time_zone(&EncodedSlice::from_bytes(tz));
            }
        }

        Ok(())
    }
}

use bun_bundler::options::EnvBehavior;
use bun_options_types::offline_mode::OfflineMode;
