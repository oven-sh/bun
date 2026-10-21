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
use core::sync::atomic::AtomicBool;

use crate::cli::command::{ContextData, HotReload};
use crate::cli::run_command::{Run, RunCommand};
use crate::dns_jsc::Order as DnsOrder;
use bun_alloc::Arena;
use bun_core::EncodedSlice;
use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject};
use bun_options_types::context::{Debugger as DebuggerFlag, RuntimeOptions};

// `repl.rs` is a sibling file with no other consumers; declare it as a child
// module here so `Repl` resolves without touching `cli/mod.rs`.
#[path = "repl.rs"]
mod repl;
use repl::Repl;

use crate::Command;
use crate::cli::Arguments;

/// This process is `bun repl`. Set before argv is parsed, because the REPL parses with the flag
/// table of `bun run`: `--help` and `process.execArgv` ask which of the two it is.
pub(crate) static IS_REPL: AtomicBool = AtomicBool::new(false);

pub(crate) struct ReplCommand;

impl ReplCommand {
    #[cold]
    pub(crate) fn exec(ctx: Command::Context<'_>) -> Result<(), crate::Error> {
        Self::check_flags(ctx);

        // Initialize the REPL
        let mut repl = Repl::init();
        // `defer repl.deinit()` → handled by Drop

        // Boot the JavaScript VM for the REPL
        Self::boot_repl_vm(ctx, &mut repl)
    }

    /// Places every flag that `bun run` keeps until after argument parsing. The REPL applies it,
    /// or it has no effect without an entry file, or the REPL cannot do what it asks and says so.
    /// The pattern names every field of `RuntimeOptions`: a new one does not compile until it has
    /// a place here.
    fn check_flags(ctx: &ContextData) {
        let RuntimeOptions {
            // `boot_repl_vm` applies these.
            smol: _,
            debugger: _,
            dns_result_order: _,
            preconnect: _,
            experimental_http2_fetch: _,
            experimental_http3_fetch: _,
            eval: _,
            // `ReplRunner::start` applies these.
            cpu_prof: _,
            heap_prof: _,
            expose_gc: _,
            redis_preconnect: _,
            sql_preconnect: _,
            // `console.log` reads it from the context.
            console_depth: _,
            // No effect without an entry file. `--check` is not for what is typed here, as under
            // `bun --interactive`.
            check: _,
            if_present: _,
            interactive: _,
            preserve_symlinks_main: _,
            cron_title,
            // `Arguments::parse` takes it with `cron_title` only.
            cron_period: _,
        } = &ctx.runtime_options;

        if ctx.debug.watch_flag {
            Self::refuse("has no entry file to watch", "--watch", &[b"--watch"]);
        }
        if ctx.debug.hot_reload != HotReload::None {
            Self::refuse("has no entry file to reload", "--hot", &[b"--hot"]);
        }
        const NO_SCRIPTS: &str = "does not run package.json scripts";
        if !ctx.filters.is_empty() {
            Self::refuse(NO_SCRIPTS, "--filter", &[b"--filter", b"-F"]);
        }
        if ctx.workspaces {
            Self::refuse(NO_SCRIPTS, "--workspaces", &[b"--workspaces"]);
        }
        if ctx.parallel {
            Self::refuse(NO_SCRIPTS, "--parallel", &[b"--parallel"]);
        }
        if ctx.sequential {
            Self::refuse(NO_SCRIPTS, "--sequential", &[b"--sequential"]);
        }
        if !cron_title.is_empty() {
            Self::refuse(
                "has no entry file to run as a cron job",
                "--cron-title and --cron-period",
                &[b"--cron-title"],
            );
        }
    }

    /// `flag` asks for what a REPL cannot do. That is an error, so that no session runs without
    /// something its command line asked for. `spellings`: how `flag` looks in argv.
    #[cold]
    fn refuse(why: &str, flag: &str, spellings: &[&[u8]]) -> ! {
        // The words of `BUN_OPTIONS` are in argv, between argv[0] and what was typed.
        let argv = bun_core::argv().as_slice();
        let args = argv.get(1..).unwrap_or_default();
        let (from_env, typed) = args.split_at(bun_core::bun_options_argc().min(args.len()));
        let has_flag = |args: &[&bun_core::ZStr]| {
            args.iter().any(|arg| {
                spellings.iter().any(|spelling| {
                    let rest = arg.as_bytes().strip_prefix(*spelling);
                    rest.is_some_and(|rest| matches!(rest, [] | [b'=', ..]))
                })
            })
        };
        let place = if !has_flag(typed) && has_flag(from_env) {
            " from BUN_OPTIONS"
        } else {
            ""
        };
        bun_core::pretty_errorln!(
            "<r><red>error<r>: \"bun repl\" {}. Remove {}{}.",
            why,
            flag,
            place
        );
        Output::flush();
        Global::exit(1);
    }

    /// The flags of `bun run` that `--help` leaves out: `check_flags` refuses them, or they have no
    /// effect without an entry file or a package.json script.
    const NOT_IN_HELP: &'static [&'static [u8]] = &[
        b"watch",
        b"watch-kill-signal",
        b"hot",
        b"no-clear-screen",
        b"filter",
        b"workspaces",
        b"parallel",
        b"sequential",
        b"no-exit-on-error",
        b"elide-lines",
        b"cron-title",
        b"cron-period",
        b"check",
        b"interactive",
        b"if-present",
        b"silent",
        b"shell",
        b"bun",
        b"preserve-symlinks-main",
    ];

    #[cold]
    pub(crate) fn print_help() {
        bun_core::pretty!(
            "\
<b>Usage<r>: <b><green>bun repl<r> <cyan>[flags]<r>
  Start an interactive JavaScript and TypeScript session

<b>Flags:<r>"
        );
        let flags: Vec<_> = Arguments::RUN_PARAMS
            .iter()
            .filter(|param| {
                !param
                    .names
                    .long
                    .is_some_and(|name| Self::NOT_IN_HELP.contains(&name))
            })
            .copied()
            .collect();
        bun_clap::simple_help(&flags);
        bun_core::pretty!(
            "\n\n\
<b>Examples:<r>
  <d>Start a session<r>
  <b><green>bun repl<r>

  <d>Evaluate a script as the REPL does, then exit<r>
  <b><green>bun repl<r> <cyan>-e<r> <blue>\"const x: number = 42; console.log(x)\"<r>

  <d>Print the result of a script<r>
  <b><green>bun repl<r> <cyan>-p<r> <blue>\"{{ a: 1, b: 2 }}\"<r>

Full documentation is available at <magenta>https://bun.com/docs/runtime/repl<r>
"
        );
        Output::flush();
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

        // Only a flag starts a debugger here. The variables that editors export to every process
        // of their terminals do not (`ignore_debugger_env`).
        let has_inspect_flag = !matches!(ctx.runtime_options.debugger, DebuggerFlag::Unspecified);

        // Initialize the VM. `InitOptions` has no allocator field (the VM does
        // not take a caller-provided allocator in the Rust port; `vm.arena` is
        // set below).
        let vm: *mut VirtualMachine = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            transform_options: core::mem::take(&mut ctx.args),
            debugger: core::mem::take(&mut ctx.runtime_options.debugger),
            ignore_debugger_env: !has_inspect_flag,
            log: core::ptr::NonNull::new(ctx.log),
            global_cache: ctx.debug.global_cache,
            smol: ctx.runtime_options.smol,
            mini_mode: ctx.runtime_options.smol,
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
            // `vm.dns_result_order` is a `u8` (see VirtualMachine.rs); set
            // post-init like run_command.rs since InitOptions doesn't carry it.
            (*vm).dns_result_order = dns_order as u8;
        }
        // There is no per-VM allocator handle; the `vm.arena` assignment itself happens below
        // ReplRunner construction to avoid a move-after-borrow.

        // Configure bundler options
        RunCommand::wire_transpiler_from_ctx(b, ctx);
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

        RunCommand::store_experimental_fetch_flags(ctx);
        RunCommand::do_preconnect(&ctx.runtime_options.preconnect);

        // `process._eval`: `child_process.fork()` takes it out of the `execArgv` it hands on.
        if !ctx.runtime_options.eval.script.is_empty() {
            VirtualMachine::get()
                .as_mut()
                .module_loader
                .interactive_eval_script = Some(ctx.runtime_options.eval.script.clone());
        }

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
            // ctx is the process-global ContextData; extend the borrow past the
            // local reborrow lifetime via raw ptr (the runner never outlives
            // ctx — global_exit() is `!`).
            eval_script: {
                let ptr: *const [u8] = &raw const *ctx.runtime_options.eval.script;
                // SAFETY: ctx.runtime_options.eval.script lives in the process-global
                // ContextData; the raw-ptr reborrow is sound because the runner never
                // outlives it — hold_api_lock returns into global_exit() (`!`).
                unsafe { &*ptr }
            },
            eval_and_print: ctx.runtime_options.eval.eval_and_print,
            ctx,
        };
        // vm.arena stores a *mut Arena pointing at runner.arena;
        // lifetime is the holdAPILock scope (globalExit() never returns so the frame never
        // unwinds). Assigned AFTER moving `arena` into `runner` — assigning from the pre-move
        // local would dangle.
        // SAFETY: vm is valid for process lifetime (see above); runner.arena is pinned on this
        // stack frame for the holdAPILock scope and global_exit() (`!`) prevents unwind past it.
        unsafe { (*vm).arena = NonNull::new(&raw mut runner.arena) };

        // `bun_jsc::opaque_wrap` requires a type implementing `FnTyped<Ctx>`;
        // rather than depend on that upstream trait, write the trivial thunk locally.
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

/// Runs the REPL within the VM's API lock
// Split lifetimes — `'a` is the stack borrow of the runner/repl,
// `'r` is the (effectively process-lifetime) VM/global references stored in
// `Repl<'r>`. Tying them as `&'a mut Repl<'a>` makes the borrow invariant and
// outlive the local, tripping the borrow checker against `Drop for Repl`.
struct ReplRunner<'a, 'r> {
    repl: &'a mut Repl<'r>,
    vm: *mut VirtualMachine,
    arena: Arena,
    eval_script: &'a [u8],
    eval_and_print: bool,
    ctx: &'a ContextData,
}

impl<'a, 'r> ReplRunner<'a, 'r> {
    fn start(this: &mut ReplRunner<'a, 'r>) {
        let _ = this.vm;
        let vm = VirtualMachine::get().as_mut();

        // As in `Run::start`: the profiles cover everything from here on.
        let flags = &this.ctx.runtime_options;
        if flags.cpu_prof.enabled {
            Run::start_cpu_profiler(vm, this.ctx);
        }
        if flags.heap_prof.enabled {
            Run::configure_heap_profiler(vm, this.ctx);
        }

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
                bun_core::pretty_errorln!("<r><red>REPL error: {}<r>", err.name());
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
                let _ = vm.global().set_time_zone(&EncodedSlice::from_bytes(tz));
            }
        }

        self.apply_run_flags(vm);
        Ok(())
    }

    /// What `bun run` does between taking the API lock and loading its first module, in the
    /// order of `Run::start` and `VirtualMachine::reload_entry_point`.
    fn apply_run_flags(&self, vm: &mut VirtualMachine) {
        let flags = &self.ctx.runtime_options;
        if flags.expose_gc {
            Run::expose_gc(vm);
        }
        if flags.redis_preconnect {
            Run::redis_preconnect(vm);
        }
        if flags.sql_preconnect {
            Run::sql_preconnect(vm);
        }
        // `--inspect-wait` and `--inspect-brk` block here. A client that connects meanwhile
        // finds the globals of the REPL in place.
        let _ = vm.ensure_debugger(true);
        vm.pre_execution_bootstrap();
    }
}

// Local extern declarations for C++ exports the bun_jsc wrappers don't expose yet.
unsafe extern "C" {
    fn Bun__ExposeNodeModuleGlobals(global: *const JSGlobalObject);
}

use bun_bundler::options::EnvBehavior;
