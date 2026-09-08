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
    use core::ptr::NonNull;

    use bun_core::{EncodedSlice, Global, Output};
    use bun_jsc::JSValue;
    use bun_jsc::virtual_machine::{InitOptions, VirtualMachine};
    use bun_options_types::schema::api;
    use bun_sys::{self as sys, Fd, File};

    use crate::cli::Command::ContextData;
    use crate::cli::run_command::RunCommand;

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

        let vm_ptr = VirtualMachine::init(InitOptions {
            transform_options: ctx.args.clone(),
            log: NonNull::new(ctx.log),
            smol: ctx.runtime_options.smol,
            mini_mode: ctx.runtime_options.smol,
            is_main_thread: true,
            ..Default::default()
        })?;
        // SAFETY: `init` returns the unique freshly-boxed VM on this thread.
        let vm = unsafe { &mut *vm_ptr };
        vm.argv = core::mem::take(&mut ctx.passthrough);

        let defines_ok = {
            let b = &mut vm.transpiler;
            RunCommand::wire_transpiler_from_ctx(b, ctx);
            b.options.env.behavior = api::DotEnvBehavior::LoadAllWithoutInlining;
            b.configure_defines().is_ok()
        };
        if !defines_ok {
            crate::run_main::fail_with_build_error(vm);
        }
        // SAFETY: `vm.log` is set in `init`.
        bun_http::async_http::load_env(unsafe { vm.log.unwrap().as_mut() }, vm.env_loader());
        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        // Programs are separated by the `bun test --isolate` reset.
        vm.test_isolation_enabled = true;
        vm.auto_killer.enable();
        let time_zone: &[u8] = vm.env_loader().get(b"TZ").unwrap_or(b"");
        if !time_zone.is_empty() {
            let _ = vm
                .global()
                .set_time_zone(&EncodedSlice::from_bytes(time_zone));
        }
        vm.test_isolation_state.time_zone = Some(Box::from(time_zone));
        vm.test_isolation_state.proxy_env = Some(bun_jsc::rare_data::ProxyEnvSnapshot::capture(
            &vm.env_loader().map,
        ));
        vm.test_isolation_state.synthetic_allocation_limit =
            Some(bun_jsc::virtual_machine::synthetic_allocation_limit());

        let _api_lock = vm.global().vm().get_api_lock();
        serve(vm)
    }

    /// Handshake, then one program per `exec` until the control pipe closes.
    fn serve(vm: &mut VirtualMachine) -> ! {
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
            bun_jsc::cpp::Bun__REPRL__resetCoverage();
        }

        vm.exit_handler.exit_code = 0;
        vm.on_exit();
        vm.global_exit();
    }

    /// Runs one program, then resets the VM for the next. Returns success.
    fn execute(vm: &mut VirtualMachine, source: &[u8]) -> bool {
        let mut exception = JSValue::ZERO;
        // SAFETY: `vm.global` is the live global; `source` outlives the call.
        let mut ok = unsafe {
            bun_jsc::cpp::Bun__REPRL__evaluate(
                vm.global,
                source.as_ptr(),
                source.len(),
                &raw mut exception,
            )
        };
        if !ok {
            vm.run_error_handler(exception, None);
        }

        run_event_loop(vm);
        let _ = vm.global().handle_rejected_promises();
        crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
        // Uncaught errors and unhandled rejections fail it too, like `bun <file>`.
        if vm.unhandled_error_counter > 0 {
            ok = false;
        }
        vm.exit_handler.exit_code = 0;

        vm.swap_global_for_test_isolation();
        prepare_global(vm);

        ok
    }

    /// The program's microtasks, timers and I/O, for at most `EVENT_LOOP_BUDGET_MS`.
    fn run_event_loop(vm: &mut VirtualMachine) {
        let deadline = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .add_ms(EVENT_LOOP_BUDGET_MS);

        vm.tick();
        while vm.is_event_loop_alive() {
            let now = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
            if !deadline.greater(&now) {
                return;
            }
            let remaining = deadline.duration(&now);
            // SAFETY: `vm` is the live main-thread VM.
            unsafe {
                crate::jsc_hooks::auto_tick_active_with_max_wait(
                    core::ptr::from_mut(vm),
                    Some(&remaining),
                )
            };
            vm.tick();
        }
    }

    /// `require`, `module`, `__filename`, `__dirname` and the prelude.
    fn prepare_global(vm: &mut VirtualMachine) {
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
        let mut exception = JSValue::ZERO;
        // SAFETY: as in `execute`.
        if !unsafe {
            bun_jsc::cpp::Bun__REPRL__evaluate(
                vm.global,
                PRELUDE.as_ptr(),
                PRELUDE.len(),
                &raw mut exception,
            )
        } {
            vm.run_error_handler(exception, None);
        }
    }

    #[cold]
    fn protocol_error(message: core::fmt::Arguments<'_>) -> ! {
        Output::flush();
        bun_core::pretty_errorln!("<r><red>error<r>: [REPRL] {}", message);
        Global::exit(1);
    }
}
