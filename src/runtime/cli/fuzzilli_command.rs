//! `bun fuzzilli`: the REPRL child that Fuzzilli's `bun` profile starts (oven-sh/fuzzilli, BunProfile.swift).

use bun_core::{Environment, Global};

use crate::Command;

pub(crate) struct FuzzilliCommand;

impl FuzzilliCommand {
    #[cold]
    pub(crate) fn exec(ctx: Command::Context) -> Result<(), crate::Error> {
        if !Environment::ENABLE_FUZZILLI_REPRL {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: Fuzzilli mode is not enabled in this build"
            );
            Global::exit(1);
        }

        #[cfg(not(unix))]
        {
            let _ = ctx;
            bun_core::pretty_errorln!(
                "<r><red>error<r>: Fuzzilli mode is only supported on POSIX systems"
            );
            Global::exit(1);
        }

        #[cfg(unix)]
        reprl::run(ctx)
    }
}

#[cfg(unix)]
mod reprl {
    use bun_core::{Global, Output};
    use bun_jsc::JSValue;
    use bun_jsc::virtual_machine::{InitOptions, VirtualMachine};
    use bun_options_types::schema::api;
    use bun_sys::{self as sys, Fd, File};

    use crate::cli::Arguments;
    use crate::cli::Command::{ContextData, Tag};
    use crate::cli::run_command::RunCommand;

    unsafe extern "C" {
        safe fn Bun__REPRL__resetCoverage();
    }

    const CONTROL_READ_FD: Fd = Fd::from_native(100);
    const CONTROL_WRITE_FD: Fd = Fd::from_native(101);
    const DATA_READ_FD: Fd = Fd::from_native(102);

    /// libreprl's `REPRL_MAX_DATA_SIZE`.
    const MAX_PROGRAM_SIZE: u64 = 16 << 20;

    /// For the event loop of a program, and again for what the reset leaves in flight. Fuzzilli's own timeout is 2500 ms.
    const EVENT_LOOP_BUDGET_MS: i64 = 250;

    /// Runs first on every global. A real `process.execve` replaces the child.
    const PRELUDE: &[u8] = b"process.execve = () => {};";

    pub(super) fn run(ctx: &mut ContextData) -> Result<(), crate::Error> {
        if sys::fstat(CONTROL_READ_FD).is_err() {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: REPRL_CRFD (fd {}) is not available. Run Bun under Fuzzilli.",
                CONTROL_READ_FD.native()
            );
            bun_core::pretty_errorln!(
                "<r><d>Example: fuzzilli --profile=bun /path/to/bun fuzzilli<r>"
            );
            Global::exit(1);
        }

        if !ctx.debug.loaded_bunfig {
            Arguments::load_config_path(
                Tag::RunCommand,
                true,
                bun_core::zstr!("bunfig.toml"),
                ctx,
            )?;
        }

        bun_jsc::initialize(bun_jsc::InitializeOptions::default());
        bun_ast::initialize_store();

        let options = InitOptions {
            transform_options: ctx.args.clone(),
            argv: core::mem::take(&mut ctx.passthrough).leak(),
            smol: ctx.runtime_options.smol,
            mini_mode: ctx.runtime_options.smol,
            is_main_thread: true,
            ..Default::default()
        };
        let vm = VirtualMachine::init(ctx.log, options)?;
        vm.preload.set(core::mem::take(&mut ctx.preloads));

        let defines_ok = vm.transpiler.with_mut(|b| {
            RunCommand::wire_transpiler_from_ctx(b, ctx);
            b.options.env.behavior = api::DotEnvBehavior::LoadAllWithoutInlining;
            b.configure_defines().is_ok()
        });
        if !defines_ok {
            crate::run_main::fail_with_build_error(vm);
        }
        if let Some(log) = vm.log_mut() {
            bun_http::async_http::load_env(log, vm.env_loader());
        }
        vm.load_extra_env();
        VirtualMachine::set_is_main_thread_vm(true);
        // No main module loads here: every module that a program loads is an import.
        vm.has_loaded.set(true);

        // Programs are separated by the `bun test --isolate` reset.
        let time_zone: &[u8] = vm.env_loader().get(b"TZ").unwrap_or(b"");
        let _ = vm.test_isolation_state.time_zone.set(Box::from(time_zone));
        vm.enable_test_isolation();

        let _api_lock = vm.jsc_vm().get_api_lock();
        serve(vm)
    }

    /// A reset, then `HELO` or the status of the last program, then the next program, until the control pipe closes.
    fn serve(vm: &VirtualMachine) -> ! {
        let mut program: Vec<u8> = Vec::new();
        let mut passed: Option<bool> = None;
        loop {
            match (passed, reset(vm)) {
                (None, Ok(())) => handshake(),
                (None, Err(why)) => {
                    bun_core::pretty_errorln!("<r><red>error<r>: [REPRL] could not start: {}", why);
                    exit(vm, 1)
                }
                (Some(ok), ready) => report(vm, ok, ready),
            }
            if !read_program(&mut program) {
                break;
            }
            passed = Some(run_program(vm, &program));
        }
        exit(vm, 0)
    }

    fn handshake() {
        let control_in = File::borrow(&CONTROL_READ_FD);
        let control_out = File::borrow(&CONTROL_WRITE_FD);
        if control_out.write_all(b"HELO").is_err() {
            protocol_error(format_args!("could not write HELO"));
        }
        let mut helo = [0u8; 4];
        if !matches!(control_in.read_all(&mut helo), Ok(4)) || helo != *b"HELO" {
            protocol_error(format_args!(
                "expected HELO, got {:?}",
                bstr::BStr::new(&helo)
            ));
        }
    }

    /// Reads the next program. Returns false when the fuzzer has closed the control pipe.
    fn read_program(program: &mut Vec<u8>) -> bool {
        let control_in = File::borrow(&CONTROL_READ_FD);
        let data_in = File::borrow(&DATA_READ_FD);
        let mut command = [0u8; 4];
        match control_in.read_all(&mut command) {
            Ok(0) => return false,
            Ok(4) if command == *b"exec" => {}
            _ => protocol_error(format_args!(
                "expected exec, got {:?}",
                bstr::BStr::new(&command)
            )),
        }
        let mut size = [0u8; 8];
        if !matches!(control_in.read_all(&mut size), Ok(8)) {
            protocol_error(format_args!("could not read the program size"));
        }
        let size = u64::from_le_bytes(size);
        if size > MAX_PROGRAM_SIZE {
            protocol_error(format_args!("program size {} is too large", size));
        }
        let size = size as usize;
        program.resize(size, 0);
        if !matches!(data_in.read_all(&mut program[..size]), Ok(n) if n == size) {
            protocol_error(format_args!("could not read {} program bytes", size));
        }
        true
    }

    /// Writes the status of a program. A child that cannot run another program ends here.
    fn report(vm: &VirtualMachine, ok: bool, ready: Result<(), &'static str>) {
        // The fuzzer reads the program's output once it has the status.
        Output::flush();
        if let Err(why) = ready {
            // libreprl takes the exit code of a child that leaves here as the status, and starts a new child.
            bun_core::pretty_errorln!("[REPRL] {}: this child ends", why);
            exit(vm, if ok { 0 } else { 1 });
        }
        let status: u32 = if ok { 0 } else { 1 << 8 };
        let control_out = File::borrow(&CONTROL_WRITE_FD);
        if control_out.write_all(&status.to_le_bytes()).is_err() {
            protocol_error(format_args!("could not write the status"));
        }
        Bun__REPRL__resetCoverage();
    }

    fn exit(vm: &VirtualMachine, code: u8) -> ! {
        Output::flush();
        vm.exit_handler.exit_code.set(code);
        vm.on_exit();
        vm.global_exit()
    }

    /// Runs one program and its event loop. Like `bun <file>`, an uncaught error or an unhandled rejection fails it.
    fn run_program(vm: &VirtualMachine, source: &[u8]) -> bool {
        if let Some(thrown) = evaluate(vm, source) {
            let _ = vm.uncaught_exception(vm.global(), thrown, false);
        }
        run_event_loop(vm);
        let _ = vm.global().handle_rejected_promises();
        vm.unhandled_error_counter.get() == 0
    }

    /// Retires the current realm and makes the global of the next program. `Err` says why this child cannot run it.
    fn reset(vm: &VirtualMachine) -> Result<(), &'static str> {
        crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
        vm.swap_global_for_test_isolation();
        vm.exit_handler.exit_code.set(0);
        prepare_global(vm);
        // Nothing of the next program exists yet: what holds the loop now, or throws, is what the reset could not stop.
        if !run_event_loop(vm) || vm.unhandled_error_counter.get() != 0 {
            return Err("work of the program outlived the reset");
        }
        if !load_preloads(vm) {
            return Err("a preload failed");
        }
        Ok(())
    }

    /// Runs the preloads of bunfig.toml on the new global, as `bun test --isolate` runs them for each file. False: one failed.
    fn load_preloads(vm: &VirtualMachine) -> bool {
        if vm.preload.get().is_empty() {
            return true;
        }
        let rejected = match crate::jsc_hooks::load_preloads(vm) {
            Ok(rejected) => rejected,
            Err(_) => {
                if let Some(log) = vm.log_mut() {
                    let _ = log.print(Output::error_writer());
                    log.msgs.clear();
                }
                return false;
            }
        };
        if !rejected.is_null() {
            // SAFETY: the module loader returned this promise just now, and nothing ran since that could collect it.
            let promise = unsafe { &mut *rejected };
            let reason = promise.result(vm.jsc_vm());
            promise.set_handled();
            let _ = vm.uncaught_exception(vm.global(), reason, true);
        }
        vm.set_pending_internal_promise(None);
        if !rejected.is_null() {
            return false;
        }
        // What a preload throws in a microtask, or rejects and does not handle, is its failure and not the program's.
        vm.drain_microtasks();
        let _ = vm.global().handle_rejected_promises();
        vm.unhandled_error_counter.get() == 0
    }

    /// Runs `source` as global code. Returns what it threw.
    fn evaluate(vm: &VirtualMachine, source: &[u8]) -> Option<JSValue> {
        let directory = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
        let mut thrown = JSValue::ZERO;
        // SAFETY: `vm.global` is the live global; the slices and `thrown` outlive the call.
        let ok = unsafe {
            bun_jsc::cpp::Bun__REPRL__evaluate(
                vm.global.get(),
                source.as_ptr(),
                source.len(),
                directory.as_ptr(),
                directory.len(),
                &raw mut thrown,
            )
        };
        (!ok).then_some(thrown)
    }

    /// Runs the loop until nothing holds it. The budget caps each wait, not a callback or a microtask drain. Returns whether the loop ended.
    fn run_event_loop(vm: &VirtualMachine) -> bool {
        let deadline = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .add_ms(EVENT_LOOP_BUDGET_MS);

        vm.tick();
        while vm.is_event_loop_alive() {
            let now = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
            if !deadline.greater(&now) {
                return false;
            }
            let remaining = deadline.duration(&now);
            crate::jsc_hooks::auto_tick_active_with_max_wait(vm, Some(&remaining));
            vm.tick();
        }
        true
    }

    /// `require`, `module`, `__filename`, `__dirname` and the prelude.
    fn prepare_global(vm: &VirtualMachine) {
        let global = vm.global();
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
        // SAFETY: `cwd` outlives the call.
        if unsafe { bun_jsc::cpp::Bun__REPL__setupGlobalRequire(global, cwd.as_ptr(), cwd.len()) }
            .is_err()
        {
            if let Some(exception) = global.try_take_exception() {
                vm.run_error_handler(exception, None);
            }
        }
        if let Some(thrown) = evaluate(vm, PRELUDE) {
            vm.run_error_handler(thrown, None);
        }
    }

    #[cold]
    fn protocol_error(message: core::fmt::Arguments<'_>) -> ! {
        Output::flush();
        bun_core::pretty_errorln!("<r><red>error<r>: [REPRL] {}", message);
        Global::exit(1);
    }
}
