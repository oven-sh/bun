use std::io::Write as _;

use crate::cron_parser::CronExpression;
use bun_core::{ZBox as ZString, ZStr};
use bun_io_types::keep_alive::KeepAliveHandle;
use bun_io_types::reader::BufferedReaderHandle;
use bun_jsc_types::{GlobalRef, JSPromiseStrongHandle};
use bun_spawn_types::process_exit::{
    ProcessExitContext, ProcessExitReadiness, ProcessExitReadinessAction, ProcessHandle,
    ProcessIdentity,
};
use bun_spawn_types::Status;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRegisterState {
    ReadingCrontab,
    InstallingCrontab,
    WritingPlist,
    BootingOut,
    Bootstrapping,
    Done,
    Failed,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRemoveState {
    ReadingCrontab,
    InstallingCrontab,
    BootingOut,
    Done,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronProcessCompletion {
    Pending,
    Finish,
    Advance,
}

pub struct CronRegisterJobState {
    pub keep_alive: Option<KeepAliveHandle>,
    pub global: GlobalRef,
    pub promise: JSPromiseStrongHandle,
    pub bun_exe: &'static ZStr,
    pub abs_path: ZString,
    pub schedule: ZString,
    pub title: ZString,
    pub parsed_cron: CronExpression,
    pub phase: CronRegisterState,
    pub process: ProcessState,
    pub tmp_path: Option<ZString>,
}

impl CronRegisterJobState {
    #[inline]
    pub fn new(
        global: GlobalRef,
        promise: JSPromiseStrongHandle,
        bun_exe: &'static ZStr,
        abs_path: ZString,
        schedule: ZString,
        title: ZString,
        parsed_cron: CronExpression,
    ) -> Self {
        Self {
            keep_alive: None,
            global,
            promise,
            bun_exe,
            abs_path,
            schedule,
            title,
            parsed_cron,
            phase: CronRegisterState::ReadingCrontab,
            process: ProcessState::new(),
            tmp_path: None,
        }
    }

    #[inline]
    pub fn set_error(&mut self, args: core::fmt::Arguments<'_>) {
        self.process.set_error(args);
    }

    #[inline]
    pub fn record_keep_alive(&mut self, keep_alive: KeepAliveHandle) {
        self.keep_alive = Some(keep_alive);
    }

    #[inline]
    pub fn take_keep_alive(&mut self) -> Option<KeepAliveHandle> {
        self.keep_alive.take()
    }

    #[inline]
    pub fn on_ready_process_status(
        &mut self,
        status: Status,
        stderr_output: &[u8],
    ) -> CronProcessCompletion {
        match status {
            Status::Exited(exited) => {
                if exited.code != 0
                    && !(self.phase == CronRegisterState::ReadingCrontab && exited.code == 1)
                    && self.phase != CronRegisterState::BootingOut
                {
                    #[cfg(windows)]
                    {
                        // On Windows, detect the SID resolution error and provide
                        // a clear message instead of the raw schtasks output.
                        if self.phase == CronRegisterState::InstallingCrontab
                            && contains_subslice(
                                stderr_output,
                                b"No mapping between account names",
                            )
                        {
                            self.set_error(format_args!(
                                "Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. \
                                 This typically happens on headless servers or CI where the process runs under a service account. \
                                 To fix this, either run Bun as a regular user account, or create the scheduled task manually with: \
                                 schtasks /create /xml <file> /tn <name> /ru SYSTEM /f"
                            ));
                            return CronProcessCompletion::Finish;
                        }
                    }
                    if !stderr_output.is_empty() {
                        self.process.set_error_bytes(stderr_output);
                    } else {
                        self.set_error(format_args!(
                            "Process exited with code {}",
                            exited.code
                        ));
                    }
                    return CronProcessCompletion::Finish;
                }
            }
            Status::Signaled(sig) => {
                if self.phase != CronRegisterState::BootingOut {
                    self.set_error(format_args!("Process killed by signal {}", sig as i32));
                    return CronProcessCompletion::Finish;
                }
            }
            Status::Err(err) => {
                self.set_error(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                return CronProcessCompletion::Finish;
            }
            Status::Running => return CronProcessCompletion::Pending,
        }

        CronProcessCompletion::Advance
    }
}

pub struct CronRemoveJobState {
    pub keep_alive: Option<KeepAliveHandle>,
    pub global: GlobalRef,
    pub promise: JSPromiseStrongHandle,
    pub title: ZString,
    pub phase: CronRemoveState,
    pub process: ProcessState,
    pub tmp_path: Option<ZString>,
}

impl CronRemoveJobState {
    #[inline]
    pub fn new(global: GlobalRef, promise: JSPromiseStrongHandle, title: ZString) -> Self {
        Self {
            keep_alive: None,
            global,
            promise,
            title,
            phase: CronRemoveState::ReadingCrontab,
            process: ProcessState::new(),
            tmp_path: None,
        }
    }

    #[inline]
    pub fn set_error(&mut self, args: core::fmt::Arguments<'_>) {
        self.process.set_error(args);
    }

    #[inline]
    pub fn record_keep_alive(&mut self, keep_alive: KeepAliveHandle) {
        self.keep_alive = Some(keep_alive);
    }

    #[inline]
    pub fn take_keep_alive(&mut self) -> Option<KeepAliveHandle> {
        self.keep_alive.take()
    }

    #[inline]
    pub fn on_ready_process_status(
        &mut self,
        status: Status,
        stderr_output: &[u8],
    ) -> CronProcessCompletion {
        match status {
            Status::Exited(exited) => {
                let is_acceptable_nonzero =
                    (self.phase == CronRemoveState::ReadingCrontab && exited.code == 1)
                        || self.phase == CronRemoveState::BootingOut
                        // On Windows, schtasks /delete exits non-zero when the task doesn't exist;
                        // removal of a non-existent job should resolve without error.
                        || (cfg!(windows) && self.phase == CronRemoveState::InstallingCrontab);
                if exited.code != 0 && !is_acceptable_nonzero {
                    if !stderr_output.is_empty() {
                        self.process.set_error_bytes(stderr_output);
                    } else {
                        self.set_error(format_args!(
                            "Process exited with code {}",
                            exited.code
                        ));
                    }
                    return CronProcessCompletion::Finish;
                }
            }
            Status::Signaled(sig) => {
                if self.phase != CronRemoveState::BootingOut {
                    self.set_error(format_args!("Process killed by signal {}", sig as i32));
                    return CronProcessCompletion::Finish;
                }
            }
            Status::Err(err) => {
                self.set_error(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                return CronProcessCompletion::Finish;
            }
            Status::Running => return CronProcessCompletion::Pending,
        }

        CronProcessCompletion::Advance
    }
}

#[derive(Debug)]
pub struct ProcessState {
    pub pending_output_fds: i8,
    pub process_handle: Option<ProcessHandle>,
    pub stdout_reader: Option<BufferedReaderHandle>,
    pub stderr_reader: Option<BufferedReaderHandle>,
    pub exit_state: Option<ProcessExitReadiness>,
    pub err_msg: Option<Vec<u8>>,
}

impl ProcessState {
    #[inline]
    pub const fn new() -> Self {
        Self {
            pending_output_fds: 0,
            process_handle: None,
            stdout_reader: None,
            stderr_reader: None,
            exit_state: None,
            err_msg: None,
        }
    }

    #[inline]
    pub fn reset_for_spawn(&mut self) {
        self.exit_state = None;
        self.pending_output_fds = 0;
        self.process_handle = None;
        self.stdout_reader = None;
        self.stderr_reader = None;
    }

    #[inline]
    pub fn initialize_exit_state(&mut self, process: ProcessIdentity) {
        self.exit_state = Some(ProcessExitReadiness::new(
            process,
            self.pending_output_fds,
        ));
    }

    #[inline]
    pub fn initialize_exit_state_from_handle(&mut self, process: ProcessHandle) {
        self.process_handle = Some(process);
        self.initialize_exit_state(process.identity());
    }

    #[inline]
    pub fn matches_process_handle(&self, process: ProcessHandle) -> bool {
        self.process_handle == Some(process)
    }

    #[inline]
    pub fn take_process_handle(&mut self) -> Option<ProcessHandle> {
        self.process_handle.take()
    }

    #[inline]
    pub fn record_stdout_reader(&mut self, reader: BufferedReaderHandle) {
        self.stdout_reader = Some(reader);
    }

    #[inline]
    pub fn record_stderr_reader(&mut self, reader: BufferedReaderHandle) {
        self.stderr_reader = Some(reader);
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> ProcessExitReadinessAction {
        if let Some(exit_state) = self.exit_state.as_mut() {
            exit_state.record_reader_done()
        } else {
            debug_assert!(self.pending_output_fds > 0);
            self.pending_output_fds = self.pending_output_fds.saturating_sub(1);
            ProcessExitReadinessAction::Pending
        }
    }

    #[inline]
    pub fn record_reader_error(&mut self, name: &'static str) -> ProcessExitReadinessAction {
        let action = self.record_reader_done();
        self.set_error(format_args!("Failed to read process output: {}", name));
        action
    }

    #[inline]
    pub fn set_error(&mut self, args: core::fmt::Arguments<'_>) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg = Some(msg);
        }
    }

    #[inline]
    pub fn set_error_bytes(&mut self, bytes: &[u8]) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = write!(&mut msg, "{}", bstr::BStr::new(bytes));
            self.err_msg = Some(msg);
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitReadinessAction {
        if self.exit_state.is_none() {
            self.initialize_exit_state(ctx.process_identity());
        }

        self.exit_state
            .as_mut()
            .expect("exit state initialized above")
            .on_process_exit(ctx)
    }

    #[inline]
    pub fn is_ready(&self) -> bool {
        self.exit_state
            .as_ref()
            .is_some_and(ProcessExitReadiness::is_ready)
    }

    #[inline]
    pub fn take_exit_status(&mut self) -> Option<Status> {
        self.exit_state
            .as_mut()
            .and_then(|exit_state| exit_state.exit_status.take())
    }
}

#[cfg(windows)]
#[inline]
fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    haystack.windows(needle.len()).any(|window| window == needle)
}

impl Default for ProcessState {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_spawn_types::{Exited, rusage_zeroed};

    static TEST_GLOBAL: () = ();

    fn test_global() -> GlobalRef {
        GlobalRef::new(&TEST_GLOBAL)
    }

    fn test_promise() -> JSPromiseStrongHandle {
        JSPromiseStrongHandle::empty()
    }

    #[test]
    fn cron_states_keep_zig_tag_shape() {
        assert_eq!(core::mem::size_of::<CronRegisterState>(), 1);
        assert_eq!(core::mem::size_of::<CronRemoveState>(), 1);
        assert_ne!(
            CronRegisterState::ReadingCrontab,
            CronRegisterState::InstallingCrontab
        );
        assert_ne!(
            CronRemoveState::ReadingCrontab,
            CronRemoveState::InstallingCrontab
        );
    }

    #[test]
    fn cron_job_state_owns_data_shape_and_process_reducer() {
        let expr = CronExpression {
            minutes: 1,
            hours: 1,
            days: 1 << 1,
            months: 1 << 1,
            weekdays: 1,
            days_is_wildcard: false,
            weekdays_is_wildcard: false,
        };
        let mut register = CronRegisterJobState::new(
            test_global(),
            test_promise(),
            ZStr::from_static(b"bun\0"),
            ZString::from_bytes(b"/tmp/job.js"),
            ZString::from_bytes(b"* * * * *"),
            ZString::from_bytes(b"title"),
            expr,
        );
        register.process.pending_output_fds = 1;
        let action = register.process.record_reader_error("EIO");
        assert_eq!(action, ProcessExitReadinessAction::Pending);
        assert_eq!(
            register.process.err_msg.as_deref(),
            Some("Failed to read process output: EIO".as_bytes())
        );

        let remove = CronRemoveJobState::new(
            test_global(),
            test_promise(),
            ZString::from_bytes(b"title"),
        );
        assert_eq!(remove.phase, CronRemoveState::ReadingCrontab);
        assert_eq!(remove.title.as_bytes(), b"title");
    }

    fn cron_expr() -> CronExpression {
        CronExpression {
            minutes: 1,
            hours: 1,
            days: 1 << 1,
            months: 1 << 1,
            weekdays: 1,
            days_is_wildcard: false,
            weekdays_is_wildcard: false,
        }
    }

    #[test]
    fn cron_register_ready_status_decides_finish_vs_advance() {
        // This is the cron state-machine half of the ProcessExit split: once
        // process output has drained, the type crate decides whether the owner
        // should finish or advance to the next spawn. Promise resolution and
        // spawning remain runtime effects.
        let mut register = CronRegisterJobState::new(
            test_global(),
            test_promise(),
            ZStr::from_static(b"bun\0"),
            ZString::from_bytes(b"/tmp/job.js"),
            ZString::from_bytes(b"* * * * *"),
            ZString::from_bytes(b"title"),
            cron_expr(),
        );

        assert_eq!(
            register.on_ready_process_status(
                Status::Exited(Exited { code: 1, signal: 0 }),
                b"ignored",
            ),
            CronProcessCompletion::Advance
        );
        assert!(register.process.err_msg.is_none());

        register.phase = CronRegisterState::InstallingCrontab;
        assert_eq!(
            register.on_ready_process_status(
                Status::Exited(Exited { code: 2, signal: 0 }),
                b"crontab stderr",
            ),
            CronProcessCompletion::Finish
        );
        assert_eq!(register.process.err_msg.as_deref(), Some(&b"crontab stderr"[..]));
    }

    #[test]
    fn cron_remove_ready_status_preserves_nonexistent_job_success() {
        // Removal treats missing jobs as success in the same phases as the
        // runtime owner code did. The type crate owns that decision now; the
        // caller still performs the actual promise/global effects.
        let mut remove = CronRemoveJobState::new(
            test_global(),
            test_promise(),
            ZString::from_bytes(b"title"),
        );
        assert_eq!(
            remove.on_ready_process_status(
                Status::Exited(Exited { code: 1, signal: 0 }),
                b"ignored",
            ),
            CronProcessCompletion::Advance
        );
        assert!(remove.process.err_msg.is_none());

        remove.phase = CronRemoveState::InstallingCrontab;
        assert_eq!(
            remove.on_ready_process_status(
                Status::Exited(Exited { code: 2, signal: 0 }),
                b"delete failed",
            ),
            if cfg!(windows) {
                CronProcessCompletion::Advance
            } else {
                CronProcessCompletion::Finish
            }
        );
        if cfg!(windows) {
            assert!(remove.process.err_msg.is_none());
        } else {
            assert_eq!(remove.process.err_msg.as_deref(), Some(&b"delete failed"[..]));
        }
    }

    #[test]
    fn process_state_accepts_reader_before_process_exit() {
        let process = ProcessIdentity::from_usize(10).unwrap();
        let process_handle = ProcessHandle::from_usize(process.get()).unwrap();
        let rusage = rusage_zeroed();
        let mut state = ProcessState::new();

        state.pending_output_fds = 1;
        state.initialize_exit_state_from_handle(process_handle);
        assert!(state.matches_process_handle(process_handle));
        assert_eq!(
            state.record_reader_done(),
            ProcessExitReadinessAction::Pending
        );
        assert_eq!(
            state.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            ProcessExitReadinessAction::Ready
        );
        assert!(state.is_ready());
        assert_eq!(
            state.take_exit_status().and_then(|status| status.exit_code()),
            Some(0)
        );
    }

    #[test]
    fn process_state_records_lower_handles_and_resets_them() {
        let mut process = 0u8;
        let mut stdout = 0u8;
        let mut stderr = 0u8;

        let process = ProcessHandle::from_ptr(core::ptr::from_mut(&mut process)).unwrap();
        let stdout = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stdout)).unwrap();
        let stderr = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stderr)).unwrap();

        let mut state = ProcessState::new();
        state.initialize_exit_state_from_handle(process);
        state.record_stdout_reader(stdout);
        state.record_stderr_reader(stderr);

        assert_eq!(state.process_handle, Some(process));
        assert_eq!(state.stdout_reader, Some(stdout));
        assert_eq!(state.stderr_reader, Some(stderr));
        assert!(state.matches_process_handle(process));

        state.reset_for_spawn();

        assert_eq!(state.process_handle, None);
        assert_eq!(state.stdout_reader, None);
        assert_eq!(state.stderr_reader, None);
    }
}
