//! `bun fuzzilli`: Fuzzilli's REPRL child (googleprojectzero/fuzzilli, Targets/README.md).

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
    use bun_core::{EncodedSlice, Global, Output};
    use bun_jsc::JSValue;
    use bun_jsc::virtual_machine::{InitOptions, VirtualMachine};
    use bun_options_types::schema::api;
    use bun_sys::{self as sys, Fd, File};

    use crate::cli::Command::ContextData;
    use crate::cli::run_command::RunCommand;

    unsafe extern "C" {
        safe fn Bun__REPRL__resetCoverage();
    }

    const CONTROL_READ_FD: Fd = Fd::from_native(100);
    const CONTROL_WRITE_FD: Fd = Fd::from_native(101);
    const DATA_READ_FD: Fd = Fd::from_native(102);

    /// libreprl's `REPRL_MAX_DATA_SIZE`.
    const MAX_PROGRAM_SIZE: u64 = 16 << 20;

    /// Per program, whose loop may never end by itself. Fuzzilli's own timeout is 2500 ms.
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

        let time_zone: &[u8] = vm.env_loader().get(b"TZ").unwrap_or(b"");
        if !time_zone.is_empty() {
            let _ = vm
                .global()
                .set_time_zone(&EncodedSlice::from_bytes(time_zone));
        }
        // Programs are separated by the `bun test --isolate` reset.
        let _ = vm.test_isolation_state.time_zone.set(Box::from(time_zone));
        vm.enable_test_isolation();

        let _api_lock = vm.global().vm().get_api_lock();
        serve(vm)
    }

    /// Handshake, then one program per `exec` until the control pipe closes.
    fn serve(vm: &VirtualMachine) -> ! {
        prepare_global(vm);

        let control_in = File::borrow(&CONTROL_READ_FD);
        let control_out = File::borrow(&CONTROL_WRITE_FD);
        let data_in = File::borrow(&DATA_READ_FD);

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

        let mut program: Vec<u8> = Vec::new();
        loop {
            let mut command = [0u8; 4];
            match control_in.read_all(&mut command) {
                // The fuzzer closed the control pipe: this child is done.
                Ok(0) => break,
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

            let ok = execute(vm, &program);

            // The fuzzer reads the program's output once it has the status.
            Output::flush();
            let status: u32 = if ok { 0 } else { 1 << 8 };
            if control_out.write_all(&status.to_le_bytes()).is_err() {
                protocol_error(format_args!("could not write the status"));
            }
            Bun__REPRL__resetCoverage();
        }

        vm.exit_handler.exit_code.set(0);
        vm.on_exit();
        vm.global_exit()
    }

    /// Runs one program, then resets the VM for the next. Returns success.
    fn execute(vm: &VirtualMachine, source: &[u8]) -> bool {
        let mut ok = evaluate(vm, source);

        run_event_loop(vm);
        let _ = vm.global().handle_rejected_promises();
        crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
        // Uncaught errors and unhandled rejections fail it too, like `bun <file>`.
        if vm.unhandled_error_counter.get() > 0 {
            ok = false;
        }
        vm.exit_handler.exit_code.set(0);

        vm.swap_global_for_test_isolation();
        prepare_global(vm);

        ok
    }

    /// Runs `source` as global code and prints what it throws. Returns whether it threw nothing.
    fn evaluate(vm: &VirtualMachine, source: &[u8]) -> bool {
        let mut exception = JSValue::ZERO;
        // SAFETY: `vm.global` is the live global; `source` and `exception` outlive the call.
        let ok = unsafe {
            bun_jsc::cpp::Bun__REPRL__evaluate(
                vm.global.get(),
                source.as_ptr(),
                source.len(),
                &raw mut exception,
            )
        };
        if !ok {
            vm.run_error_handler(exception, None);
        }
        ok
    }

    /// The program's microtasks, timers and I/O, for at most `EVENT_LOOP_BUDGET_MS`.
    fn run_event_loop(vm: &VirtualMachine) {
        let deadline = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .add_ms(EVENT_LOOP_BUDGET_MS);

        vm.tick();
        while vm.is_event_loop_alive() {
            let now = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
            if !deadline.greater(&now) {
                return;
            }
            let remaining = deadline.duration(&now);
            crate::jsc_hooks::auto_tick_active_with_max_wait(vm, Some(&remaining));
            vm.tick();
        }
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
        evaluate(vm, PRELUDE);
    }

    #[cold]
    fn protocol_error(message: core::fmt::Arguments<'_>) -> ! {
        Output::flush();
        bun_core::pretty_errorln!("<r><red>error<r>: [REPRL] {}", message);
        Global::exit(1);
    }
}
