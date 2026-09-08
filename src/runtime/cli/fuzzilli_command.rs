//! `bun fuzzilli`: the REPRL (read-eval-print-reset-loop) child process that
//! the Fuzzilli fuzzer drives (https://github.com/googleprojectzero/fuzzilli,
//! Targets/README.md). The fuzzer passes four descriptors:
//!
//! - 100: control, fuzzer → child. `"HELO"` once, then per program `"exec"`
//!   followed by the program length as a little-endian u64.
//! - 101: control, child → fuzzer. `"HELO"` once, then per program a
//!   little-endian u32 status (`exit_code << 8`, the low byte is a signal).
//! - 102: program source, fuzzer → child.
//! - 103: `fuzzilli('FUZZILLI_PRINT', value)` output, child → fuzzer.
//!
//! Every program runs on a fresh global object on the same `JSC::VM`, the way
//! JavaScriptCore's `jsc` shell and V8's `d8` run Fuzzilli programs, so that
//! nothing a program does to its globals or builtins can change how a later
//! program behaves.

use bun_core::{Environment, Global};

use crate::Command;

pub(crate) struct FuzzilliCommand;

impl FuzzilliCommand {
    #[cold]
    pub(crate) fn exec(ctx: Command::Context) -> Result<(), crate::Error> {
        // The dispatch site (`cli/mod.rs`) already gates on
        // `ENABLE_FUZZILLI_REPRL`; bail loudly if a caller ever invokes it anyway.
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

    /// How long the event loop of one program may run. Fuzzilli's own timeout
    /// for a whole program is 2500 ms (`Sources/Fuzzilli/Profiles/BunProfile.swift`).
    const EVENT_LOOP_BUDGET_MS: i64 = 250;

    /// Evaluated on every fresh global before its program. `process.execve`
    /// replaces the process image on success, which would end the REPRL child.
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

        // The reset between programs is the `bun test --isolate` file-boundary
        // reset: stop the program's handles and subprocesses, swap in a fresh
        // global, and put VM-level state a program can reach back to startup.
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

        let mut session = Session {
            vm: vm_ptr,
            program: Vec::new(),
        };
        // SAFETY: `vm_ptr` is the process-lifetime VM; `session` is the sole
        // mutator inside the lock and `run` never returns.
        unsafe { (*vm_ptr).run_with_api_lock::<_, ()>(|| session.run()) };
        unreachable!();
    }

    struct Session {
        vm: *mut VirtualMachine,
        program: Vec<u8>,
    }

    impl Session {
        fn vm(&self) -> &'static mut VirtualMachine {
            // SAFETY: the boxed main-thread VM lives for the rest of the process
            // and is only touched from this thread.
            unsafe { &mut *self.vm }
        }

        fn run(&mut self) -> ! {
            self.prepare_global();

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
                self.program.resize(size, 0);
                if !matches!(data_in.read_all(&mut self.program[..size]), Ok(n) if n == size) {
                    protocol_error(format_args!("could not read {} program bytes", size));
                }

                let program = core::mem::take(&mut self.program);
                let ok = self.execute(&program);
                self.program = program;

                // stdout and stderr are regular files under Fuzzilli; everything the
                // program printed has to land before the fuzzer reads the status.
                Output::flush();
                let status: u32 = if ok { 0 } else { 1 << 8 };
                if control_out.write_all(&status.to_le_bytes()).is_err() {
                    protocol_error(format_args!("could not write the status"));
                }
                bun_jsc::cpp::Bun__REPRL__resetCoverage();
            }

            let vm = self.vm();
            vm.exit_handler.exit_code = 0;
            vm.on_exit();
            vm.global_exit();
        }

        /// Runs one program, gives its asynchronous work a bounded amount of
        /// time, then resets the VM for the next program. Returns whether the
        /// program succeeded.
        fn execute(&mut self, source: &[u8]) -> bool {
            let vm = self.vm();

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

            self.run_event_loop();
            let _ = vm.global().handle_rejected_promises();
            crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
            // An uncaught exception or unhandled rejection outside the
            // synchronous part fails the program too, as it would fail `bun <file>`.
            if vm.unhandled_error_counter > 0 {
                ok = false;
            }
            vm.exit_handler.exit_code = 0;

            vm.swap_global_for_test_isolation();
            self.prepare_global();

            ok
        }

        /// Runs the program's microtasks, timers and I/O, for at most
        /// `EVENT_LOOP_BUDGET_MS`.
        ///
        /// The budget exists because the loop of a fuzzed program need not
        /// ever end: a program that leaves a server, a listener or an interval
        /// behind keeps it alive, and `bun <file>` would not exit either. The
        /// fuzzer's own timeout would then kill the child, which costs its
        /// whole timeout and a respawn. So give the program's asynchronous
        /// work a fixed slice instead, then report the status and reset. The
        /// reset stops whatever is still running.
        fn run_event_loop(&mut self) {
            let vm = self.vm();
            let deadline = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
                .add_ms(EVENT_LOOP_BUDGET_MS);

            vm.tick();
            while vm.is_event_loop_alive() {
                let now = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
                if !deadline.greater(&now) {
                    return;
                }
                let remaining = deadline.duration(&now);
                // SAFETY: `self.vm` is the live main-thread VM; `remaining` is
                // a stack local that outlives the call.
                unsafe {
                    crate::jsc_hooks::auto_tick_active_with_max_wait(self.vm, Some(&remaining))
                };
                vm.tick();
            }
        }

        /// `require`, `module`, `__filename`, `__dirname` and the prelude, on
        /// the global the next program will run on.
        fn prepare_global(&mut self) {
            let vm = self.vm();
            let global = vm.global();
            let cwd = bun_resolver::fs::FileSystem::get().top_level_dir_without_trailing_slash();
            // SAFETY: `cwd` is valid for the call; the wrapper opens its own exception scope.
            if unsafe {
                bun_jsc::cpp::Bun__REPL__setupGlobalRequire(global, cwd.as_ptr(), cwd.len())
            }
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
    }

    #[cold]
    fn protocol_error(message: core::fmt::Arguments<'_>) -> ! {
        Output::flush();
        bun_core::pretty_errorln!("<r><red>error<r>: [REPRL] {}", message);
        Global::exit(1);
    }
}
