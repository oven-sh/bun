use bun_spawn_types::{ProcessExitContext, ProcessId, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessExitKind {
    Subprocess,
    LifecycleScript,
    SecurityScan,
    Shell,
    FilterRunHandle,
    MultiRunHandle,
    TestParallelWorker,
    CronRegister,
    CronRemove,
    ChromeProcess,
    HostProcess,
    SyncWindows,
}

#[derive(Debug)]
pub enum ProcessExit {
    Subprocess(SubprocessExit),
    LifecycleScript(LifecycleScriptExit),
    SecurityScan(SecurityScanExit),
    Shell(ShellSubprocessExit),
    FilterRunHandle(FilterRunExit),
    MultiRunHandle(MultiRunExit),
    TestParallelWorker(TestParallelWorkerExit),
    CronRegister(CronRegisterExit),
    CronRemove(CronRemoveExit),
    ChromeProcess(ChromeProcessExit),
    HostProcess(HostProcessExit),
    SyncWindows(SyncWindowsExit),
}

impl ProcessExit {
    #[inline]
    pub const fn kind(&self) -> ProcessExitKind {
        match self {
            Self::Subprocess(_) => ProcessExitKind::Subprocess,
            Self::LifecycleScript(_) => ProcessExitKind::LifecycleScript,
            Self::SecurityScan(_) => ProcessExitKind::SecurityScan,
            Self::Shell(_) => ProcessExitKind::Shell,
            Self::FilterRunHandle(_) => ProcessExitKind::FilterRunHandle,
            Self::MultiRunHandle(_) => ProcessExitKind::MultiRunHandle,
            Self::TestParallelWorker(_) => ProcessExitKind::TestParallelWorker,
            Self::CronRegister(_) => ProcessExitKind::CronRegister,
            Self::CronRemove(_) => ProcessExitKind::CronRemove,
            Self::ChromeProcess(_) => ProcessExitKind::ChromeProcess,
            Self::HostProcess(_) => ProcessExitKind::HostProcess,
            Self::SyncWindows(_) => ProcessExitKind::SyncWindows,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        match self {
            Self::Subprocess(exit) => exit.on_process_exit(ctx),
            Self::LifecycleScript(exit) => exit.on_process_exit(ctx),
            Self::SecurityScan(exit) => exit.on_process_exit(ctx),
            Self::Shell(exit) => exit.on_process_exit(ctx),
            Self::FilterRunHandle(exit) => exit.on_process_exit(ctx),
            Self::MultiRunHandle(exit) => exit.on_process_exit(ctx),
            Self::TestParallelWorker(exit) => exit.on_process_exit(ctx),
            Self::CronRegister(exit) => exit.on_process_exit(ctx),
            Self::CronRemove(exit) => exit.on_process_exit(ctx),
            Self::ChromeProcess(exit) => exit.on_process_exit(ctx),
            Self::HostProcess(exit) => exit.on_process_exit(ctx),
            Self::SyncWindows(exit) => exit.on_process_exit(ctx),
        }
    }
}

#[derive(Debug, Default)]
pub struct SubprocessExit {
    pub status: Status,
    pub rusage_captured: bool,
    pub vm_notified: bool,
}

impl SubprocessExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        ctx.process.set_status(ctx.status.clone());
        self.status = ctx.status;
        self.rusage_captured = true;
        self.vm_notified = true;
    }
}

#[derive(Debug)]
pub struct LifecycleScriptExit {
    pub process_id: ProcessId,
    pub status: Status,
    pub process_matched: bool,
    pub remaining_fds: i8,
    pub task_completed: bool,
}

impl LifecycleScriptExit {
    #[inline]
    pub fn new(process_id: ProcessId, remaining_fds: i8) -> Self {
        Self {
            process_id,
            status: Status::Running,
            process_matched: false,
            remaining_fds,
            task_completed: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        self.process_matched = ctx.process_id() == self.process_id;
        if self.process_matched {
            ctx.process.set_status(ctx.status.clone());
            self.status = ctx.status;
            self.remaining_fds = self.remaining_fds.saturating_sub(1);
            self.task_completed = self.remaining_fds == 0;
        }
    }
}

#[derive(Debug, Default)]
pub struct SecurityScanExit {
    pub status: Status,
    pub ipc_drained: bool,
    pub result_ready: bool,
}

impl SecurityScanExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        ctx.process.set_status(ctx.status.clone());
        self.status = ctx.status;
        self.ipc_drained = true;
        self.result_ready = true;
    }
}

#[derive(Debug, Default)]
pub struct ShellSubprocessExit {
    pub status: Status,
    pub stdout_done: bool,
    pub stderr_done: bool,
    pub command_notified: bool,
}

impl ShellSubprocessExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        ctx.process.set_status(ctx.status.clone());
        self.status = ctx.status;
        self.stdout_done = true;
        self.stderr_done = true;
        self.command_notified = true;
    }
}

#[derive(Debug, Default)]
pub struct FilterRunExit {
    pub status: Status,
    pub end_time_recorded: bool,
    pub state_notified: bool,
}

impl FilterRunExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        run_handle_exit(
            ctx,
            &mut self.status,
            &mut self.end_time_recorded,
            &mut self.state_notified,
        );
    }
}

#[derive(Debug, Default)]
pub struct MultiRunExit {
    pub status: Status,
    pub end_time_recorded: bool,
    pub state_notified: bool,
}

impl MultiRunExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        run_handle_exit(
            ctx,
            &mut self.status,
            &mut self.end_time_recorded,
            &mut self.state_notified,
        );
    }
}

#[inline]
fn run_handle_exit(
    ctx: ProcessExitContext<'_>,
    status: &mut Status,
    end_time_recorded: &mut bool,
    state_notified: &mut bool,
) {
    ctx.process.set_status(ctx.status.clone());
    *status = ctx.status;
    *end_time_recorded = true;
    *state_notified = true;
}

#[derive(Debug, Default)]
pub struct TestParallelWorkerExit {
    pub status: Status,
    pub coordinator_notified: bool,
    pub worker_slot_reaped: bool,
}

impl TestParallelWorkerExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        ctx.process.set_status(ctx.status.clone());
        self.status = ctx.status;
        self.coordinator_notified = true;
        self.worker_slot_reaped = true;
    }
}

#[derive(Debug)]
pub struct CronRegisterExit {
    job: CronJobExit,
}

impl CronRegisterExit {
    #[inline]
    pub fn new(process_id: ProcessId, remaining_fds: i8) -> Self {
        Self {
            job: CronJobExit::new(process_id, remaining_fds),
        }
    }

    #[inline]
    pub const fn job(&self) -> &CronJobExit {
        &self.job
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        self.job.on_process_exit(ctx);
    }
}

#[derive(Debug)]
pub struct CronRemoveExit {
    job: CronJobExit,
}

impl CronRemoveExit {
    #[inline]
    pub fn new(process_id: ProcessId, remaining_fds: i8) -> Self {
        Self {
            job: CronJobExit::new(process_id, remaining_fds),
        }
    }

    #[inline]
    pub const fn job(&self) -> &CronJobExit {
        &self.job
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        self.job.on_process_exit(ctx);
    }
}

#[derive(Debug)]
pub struct CronJobExit {
    pub process_id: ProcessId,
    pub status: Status,
    pub remaining_fds: i8,
    pub finished: bool,
}

impl CronJobExit {
    #[inline]
    pub fn new(process_id: ProcessId, remaining_fds: i8) -> Self {
        Self {
            process_id,
            status: Status::Running,
            remaining_fds,
            finished: false,
        }
    }

    #[inline]
    fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        if ctx.process_id() == self.process_id {
            ctx.process.set_status(ctx.status.clone());
            self.status = ctx.status;
            self.remaining_fds = self.remaining_fds.saturating_sub(1);
            self.finished = self.remaining_fds == 0;
        }
    }
}

#[derive(Debug)]
pub struct ChromeProcessExit {
    pub process_id: ProcessId,
    pub died_signal: Option<u8>,
    pub singleton_cleared: bool,
}

impl ChromeProcessExit {
    #[inline]
    pub const fn new(process_id: ProcessId) -> Self {
        Self {
            process_id,
            died_signal: None,
            singleton_cleared: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        webview_exit(
            ctx,
            self.process_id,
            &mut self.died_signal,
            &mut self.singleton_cleared,
        );
    }
}

#[derive(Debug)]
pub struct HostProcessExit {
    pub process_id: ProcessId,
    pub died_signal: Option<u8>,
    pub singleton_cleared: bool,
}

impl HostProcessExit {
    #[inline]
    pub const fn new(process_id: ProcessId) -> Self {
        Self {
            process_id,
            died_signal: None,
            singleton_cleared: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        webview_exit(
            ctx,
            self.process_id,
            &mut self.died_signal,
            &mut self.singleton_cleared,
        );
    }
}

#[inline]
fn webview_exit(
    ctx: ProcessExitContext<'_>,
    expected: ProcessId,
    died_signal: &mut Option<u8>,
    singleton_cleared: &mut bool,
) {
    if ctx.process_id() == expected {
        ctx.process.set_status(ctx.status.clone());
        *died_signal = ctx.status.signal_code().map(|signal| signal as u8);
        ctx.process.drop_process_ref();
        *singleton_cleared = true;
    }
}

#[derive(Debug, Default)]
pub struct SyncWindowsExit {
    pub status: Status,
    pub waiter_notified: bool,
}

impl SyncWindowsExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: ProcessExitContext<'_>) {
        ctx.process.set_status(ctx.status.clone());
        self.status = ctx.status;
        self.waiter_notified = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_spawn_types::{Exited, ProcessExitState, rusage_zeroed};

    #[test]
    fn dispatches_through_the_closed_enum() {
        let mut process = ProcessExitState::new(ProcessId::new(7));
        let rusage = rusage_zeroed();
        let mut exit = ProcessExit::Shell(ShellSubprocessExit::default());

        exit.on_process_exit(ProcessExitContext::new(
            &mut process,
            Status::Exited(Exited { code: 3, signal: 0 }),
            &rusage,
        ));

        assert_eq!(exit.kind(), ProcessExitKind::Shell);
        assert_eq!(process.status().exit_code(), Some(3));
        match exit {
            ProcessExit::Shell(shell) => {
                assert_eq!(shell.status.exit_code(), Some(3));
                assert!(shell.stdout_done);
                assert!(shell.stderr_done);
                assert!(shell.command_notified);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn webview_exit_keeps_process_lifetime_typed() {
        let mut process = ProcessExitState::new(ProcessId::new(11));
        let rusage = rusage_zeroed();
        let mut exit = ProcessExit::ChromeProcess(ChromeProcessExit::new(process.id()));

        exit.on_process_exit(ProcessExitContext::new(
            &mut process,
            Status::Signaled(9),
            &rusage,
        ));

        assert_eq!(
            process.status().signal_code().map(|signal| signal as u8),
            Some(9)
        );
        assert_eq!(process.ref_drops(), 1);
        match exit {
            ProcessExit::ChromeProcess(chrome) => {
                assert_eq!(chrome.died_signal, Some(9));
                assert!(chrome.singleton_cleared);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn process_identity_guards_owner_specific_state() {
        let mut process = ProcessExitState::new(ProcessId::new(1));
        let rusage = rusage_zeroed();
        let mut exit = ProcessExit::LifecycleScript(LifecycleScriptExit::new(ProcessId::new(2), 1));

        exit.on_process_exit(ProcessExitContext::new(
            &mut process,
            Status::Exited(Exited { code: 0, signal: 0 }),
            &rusage,
        ));

        assert!(matches!(process.status(), Status::Running));
        match exit {
            ProcessExit::LifecycleScript(lifecycle) => {
                assert!(!lifecycle.process_matched);
                assert!(!lifecycle.task_completed);
                assert!(matches!(lifecycle.status, Status::Running));
            }
            _ => unreachable!(),
        }
    }
}
