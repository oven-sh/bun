use crate::closed_dispatch::{
    OwnerToken, SecurityScanReaderState, SubprocessPipeReaderState, TerminalReaderState,
};
pub use bun_install_types::{
    LifecycleScriptExit, LifecycleScriptExitAction, SecurityScanExit, SecurityScanExitAction,
};
use bun_spawn_types::{ProcessExitContext, ProcessIdentity, Status};

#[derive(Debug)]
pub enum SubprocessOwner {}
#[derive(Debug)]
pub enum ShellSubprocessOwner {}
#[derive(Debug)]
pub enum FilterRunHandleOwner {}
#[derive(Debug)]
pub enum MultiRunHandleOwner {}
#[derive(Debug)]
pub enum TestParallelWorkerOwner {}
#[derive(Debug)]
pub enum CronRegisterOwner {}
#[derive(Debug)]
pub enum CronRemoveOwner {}
#[derive(Debug)]
pub enum ChromeProcessOwner {}
#[derive(Debug)]
pub enum HostProcessOwner {}

#[derive(Clone, Debug)]
pub struct ProcessStatusUpdate {
    pub process: ProcessIdentity,
    pub status: Status,
}

#[derive(Clone, Debug)]
pub enum ProcessExitEffect {
    Updated {
        status: ProcessStatusUpdate,
    },
    Subprocess {
        status: ProcessStatusUpdate,
        action: SubprocessExitAction,
    },
    LifecycleScript {
        status: ProcessStatusUpdate,
        action: LifecycleScriptExitAction,
    },
    SecurityScan {
        status: ProcessStatusUpdate,
        action: SecurityScanExitAction,
    },
    Cron {
        status: ProcessStatusUpdate,
        action: CronExitAction,
    },
    Webview {
        status: ProcessStatusUpdate,
        action: WebviewExitAction,
    },
    IgnoredWrongProcess,
}

impl ProcessExitEffect {
    #[inline]
    pub const fn status_update(&self) -> Option<&ProcessStatusUpdate> {
        match self {
            Self::Updated { status }
            | Self::Subprocess { status, .. }
            | Self::LifecycleScript { status, .. }
            | Self::SecurityScan { status, .. }
            | Self::Cron { status, .. }
            | Self::Webview { status, .. } => Some(status),
            Self::IgnoredWrongProcess => None,
        }
    }
}

#[inline]
fn status_update(ctx: &ProcessExitContext<'_>) -> ProcessStatusUpdate {
    ProcessStatusUpdate {
        process: ctx.process_identity(),
        status: ctx.status.clone(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubprocessExitAction {
    NotifyVm {
        owner: OwnerToken<SubprocessOwner>,
        terminal: Option<OwnerToken<TerminalReaderState>>,
        pipe_reader: Option<OwnerToken<SubprocessPipeReaderState>>,
        drain_microtasks: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronExitAction {
    WrongProcess,
    Pending,
    RegisterMaybeFinished {
        owner: OwnerToken<CronRegisterOwner>,
    },
    RemoveMaybeFinished {
        owner: OwnerToken<CronRemoveOwner>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebviewExitAction {
    WrongProcess,
    ClearSingleton {
        owner: OwnerToken<ChromeProcessOwner>,
        signal: Option<u8>,
        drop_process_ref: bool,
    },
}

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

#[derive(Debug, Default)]
pub enum ProcessExitState {
    #[default]
    Empty,
    Handler(ProcessExit),
}

impl ProcessExitState {
    #[inline]
    pub const fn new(handler: ProcessExit) -> Self {
        Self::Handler(handler)
    }

    #[inline]
    pub const fn is_empty(&self) -> bool {
        matches!(self, Self::Empty)
    }

    #[inline]
    pub fn set(&mut self, handler: ProcessExit) {
        *self = Self::Handler(handler);
    }

    #[inline]
    pub fn clear(&mut self) {
        *self = Self::Empty;
    }

    #[inline]
    pub fn take(&mut self) -> Self {
        core::mem::take(self)
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> Option<ProcessExitEffect> {
        match self {
            Self::Empty => None,
            Self::Handler(exit) => Some(exit.on_process_exit(ctx)),
        }
    }
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
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        match self {
            Self::Subprocess(exit) => exit.on_process_exit(ctx),
            Self::LifecycleScript(exit) => lifecycle_exit(exit.on_process_exit(ctx), ctx),
            Self::SecurityScan(exit) => security_scan_exit(exit.on_process_exit(ctx), ctx),
            Self::Shell(exit) => exit.on_process_exit(ctx),
            Self::FilterRunHandle(exit) => exit.on_process_exit(ctx),
            Self::MultiRunHandle(exit) => exit.on_process_exit(ctx),
            Self::TestParallelWorker(exit) => exit.on_process_exit(ctx),
            Self::CronRegister(exit) => cron_exit(exit.on_process_exit(ctx), ctx),
            Self::CronRemove(exit) => cron_exit(exit.on_process_exit(ctx), ctx),
            Self::ChromeProcess(exit) => webview_exit_effect(exit.on_process_exit(ctx), ctx),
            Self::HostProcess(exit) => webview_exit_effect(exit.on_process_exit(ctx), ctx),
            Self::SyncWindows(exit) => exit.on_process_exit(ctx),
        }
    }
}

#[inline]
fn lifecycle_exit(
    action: LifecycleScriptExitAction,
    ctx: &ProcessExitContext<'_>,
) -> ProcessExitEffect {
    match action {
        LifecycleScriptExitAction::WrongProcess => ProcessExitEffect::IgnoredWrongProcess,
        action => ProcessExitEffect::LifecycleScript {
            status: status_update(ctx),
            action,
        },
    }
}

#[inline]
fn security_scan_exit(
    action: SecurityScanExitAction,
    ctx: &ProcessExitContext<'_>,
) -> ProcessExitEffect {
    match action {
        SecurityScanExitAction::WrongProcess => ProcessExitEffect::IgnoredWrongProcess,
        action => ProcessExitEffect::SecurityScan {
            status: status_update(ctx),
            action,
        },
    }
}

#[inline]
fn cron_exit(action: CronExitAction, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
    match action {
        CronExitAction::WrongProcess => ProcessExitEffect::IgnoredWrongProcess,
        action => ProcessExitEffect::Cron {
            status: status_update(ctx),
            action,
        },
    }
}

#[inline]
fn webview_exit_effect(
    action: WebviewExitAction,
    ctx: &ProcessExitContext<'_>,
) -> ProcessExitEffect {
    match action {
        WebviewExitAction::WrongProcess => ProcessExitEffect::IgnoredWrongProcess,
        action => ProcessExitEffect::Webview {
            status: status_update(ctx),
            action,
        },
    }
}

#[derive(Debug)]
pub struct SubprocessExit {
    pub owner: OwnerToken<SubprocessOwner>,
    pub process: ProcessIdentity,
    pub terminal: Option<OwnerToken<TerminalReaderState>>,
    pub pipe_reader: Option<OwnerToken<SubprocessPipeReaderState>>,
    pub status: Status,
    pub rusage_captured: bool,
}

impl SubprocessExit {
    #[inline]
    pub const fn new(owner: OwnerToken<SubprocessOwner>, process: ProcessIdentity) -> Self {
        Self {
            owner,
            process,
            terminal: None,
            pipe_reader: None,
            status: Status::Running,
            rusage_captured: false,
        }
    }

    #[inline]
    pub fn with_terminal(mut self, terminal: OwnerToken<TerminalReaderState>) -> Self {
        self.terminal = Some(terminal);
        self
    }

    #[inline]
    pub fn with_pipe_reader(mut self, pipe_reader: OwnerToken<SubprocessPipeReaderState>) -> Self {
        self.pipe_reader = Some(pipe_reader);
        self
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        if ctx.process_identity() != self.process {
            return ProcessExitEffect::IgnoredWrongProcess;
        }

        self.status = ctx.status.clone();
        self.rusage_captured = true;
        ProcessExitEffect::Subprocess {
            status: status_update(ctx),
            action: SubprocessExitAction::NotifyVm {
                owner: self.owner,
                terminal: self.terminal,
                pipe_reader: self.pipe_reader,
                drain_microtasks: true,
            },
        }
    }
}

#[inline]
fn updated_effect(ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
    ProcessExitEffect::Updated {
        status: status_update(ctx),
    }
}

#[inline]
fn set_status_from_exit(state: &mut Status, ctx: &ProcessExitContext<'_>) {
    *state = ctx.status.clone();
}

#[derive(Debug)]
pub struct ShellSubprocessExit {
    pub owner: OwnerToken<ShellSubprocessOwner>,
    pub status: Status,
    pub stdout_done: bool,
    pub stderr_done: bool,
}

impl ShellSubprocessExit {
    #[inline]
    pub const fn new(owner: OwnerToken<ShellSubprocessOwner>) -> Self {
        Self {
            owner,
            status: Status::Running,
            stdout_done: false,
            stderr_done: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        set_status_from_exit(&mut self.status, ctx);
        self.stdout_done = true;
        self.stderr_done = true;
        updated_effect(ctx)
    }
}

#[derive(Debug)]
pub struct FilterRunExit {
    pub owner: OwnerToken<FilterRunHandleOwner>,
    pub status: Status,
    pub end_time_recorded: bool,
}

impl FilterRunExit {
    #[inline]
    pub const fn new(owner: OwnerToken<FilterRunHandleOwner>) -> Self {
        Self {
            owner,
            status: Status::Running,
            end_time_recorded: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        run_handle_exit(ctx, &mut self.status, &mut self.end_time_recorded)
    }
}

#[derive(Debug)]
pub struct MultiRunExit {
    pub owner: OwnerToken<MultiRunHandleOwner>,
    pub status: Status,
    pub end_time_recorded: bool,
}

impl MultiRunExit {
    #[inline]
    pub const fn new(owner: OwnerToken<MultiRunHandleOwner>) -> Self {
        Self {
            owner,
            status: Status::Running,
            end_time_recorded: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        run_handle_exit(ctx, &mut self.status, &mut self.end_time_recorded)
    }
}

#[inline]
fn run_handle_exit(
    ctx: &ProcessExitContext<'_>,
    status: &mut Status,
    end_time_recorded: &mut bool,
) -> ProcessExitEffect {
    set_status_from_exit(status, ctx);
    *end_time_recorded = true;
    updated_effect(ctx)
}

#[derive(Debug)]
pub struct TestParallelWorkerExit {
    pub owner: OwnerToken<TestParallelWorkerOwner>,
    pub status: Status,
    pub coordinator_notified: bool,
}

impl TestParallelWorkerExit {
    #[inline]
    pub const fn new(owner: OwnerToken<TestParallelWorkerOwner>) -> Self {
        Self {
            owner,
            status: Status::Running,
            coordinator_notified: false,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        set_status_from_exit(&mut self.status, ctx);
        self.coordinator_notified = true;
        updated_effect(ctx)
    }
}

#[derive(Debug)]
pub struct CronRegisterExit {
    job: CronJobExit<CronRegisterOwner>,
}

impl CronRegisterExit {
    #[inline]
    pub const fn new(
        owner: OwnerToken<CronRegisterOwner>,
        process: ProcessIdentity,
        remaining_fds: i8,
    ) -> Self {
        Self {
            job: CronJobExit::new(owner, process, remaining_fds),
        }
    }

    #[inline]
    pub const fn job(&self) -> &CronJobExit<CronRegisterOwner> {
        &self.job
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> CronExitAction {
        match self.job.record_reader_done() {
            CronJobProgress::WrongProcess => CronExitAction::WrongProcess,
            CronJobProgress::Pending => CronExitAction::Pending,
            CronJobProgress::MaybeFinished => CronExitAction::RegisterMaybeFinished {
                owner: self.job.owner,
            },
        }
    }

    #[inline]
    fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> CronExitAction {
        match self.job.on_process_exit(ctx) {
            CronJobProgress::WrongProcess => CronExitAction::WrongProcess,
            CronJobProgress::Pending => CronExitAction::Pending,
            CronJobProgress::MaybeFinished => CronExitAction::RegisterMaybeFinished {
                owner: self.job.owner,
            },
        }
    }
}

#[derive(Debug)]
pub struct CronRemoveExit {
    job: CronJobExit<CronRemoveOwner>,
}

impl CronRemoveExit {
    #[inline]
    pub const fn new(
        owner: OwnerToken<CronRemoveOwner>,
        process: ProcessIdentity,
        remaining_fds: i8,
    ) -> Self {
        Self {
            job: CronJobExit::new(owner, process, remaining_fds),
        }
    }

    #[inline]
    pub const fn job(&self) -> &CronJobExit<CronRemoveOwner> {
        &self.job
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> CronExitAction {
        match self.job.record_reader_done() {
            CronJobProgress::WrongProcess => CronExitAction::WrongProcess,
            CronJobProgress::Pending => CronExitAction::Pending,
            CronJobProgress::MaybeFinished => CronExitAction::RemoveMaybeFinished {
                owner: self.job.owner,
            },
        }
    }

    #[inline]
    fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> CronExitAction {
        match self.job.on_process_exit(ctx) {
            CronJobProgress::WrongProcess => CronExitAction::WrongProcess,
            CronJobProgress::Pending => CronExitAction::Pending,
            CronJobProgress::MaybeFinished => CronExitAction::RemoveMaybeFinished {
                owner: self.job.owner,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CronJobProgress {
    WrongProcess,
    Pending,
    MaybeFinished,
}

#[derive(Debug)]
pub struct CronJobExit<T> {
    pub owner: OwnerToken<T>,
    pub process: ProcessIdentity,
    pub exit_status: Option<Status>,
    pub has_called_process_exit: bool,
    pub remaining_fds: i8,
}

impl<T> CronJobExit<T> {
    #[inline]
    pub const fn new(owner: OwnerToken<T>, process: ProcessIdentity, remaining_fds: i8) -> Self {
        Self {
            owner,
            process,
            exit_status: None,
            has_called_process_exit: false,
            remaining_fds,
        }
    }

    #[inline]
    fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> CronJobProgress {
        if ctx.process_identity() != self.process {
            return CronJobProgress::WrongProcess;
        }

        self.has_called_process_exit = true;
        self.exit_status = Some(ctx.status.clone());
        self.maybe_finished()
    }

    #[inline]
    fn record_reader_done(&mut self) -> CronJobProgress {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds = self.remaining_fds.saturating_sub(1);
        self.maybe_finished()
    }

    #[inline]
    fn maybe_finished(&self) -> CronJobProgress {
        if self.has_called_process_exit && self.remaining_fds == 0 {
            CronJobProgress::MaybeFinished
        } else {
            CronJobProgress::Pending
        }
    }
}

#[derive(Debug)]
pub struct ChromeProcessExit {
    pub owner: OwnerToken<ChromeProcessOwner>,
    pub process: ProcessIdentity,
    pub died_signal: Option<u8>,
}

impl ChromeProcessExit {
    #[inline]
    pub const fn new(owner: OwnerToken<ChromeProcessOwner>, process: ProcessIdentity) -> Self {
        Self {
            owner,
            process,
            died_signal: None,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> WebviewExitAction {
        webview_exit(ctx, self.process, self.owner, &mut self.died_signal)
    }
}

#[derive(Debug)]
pub struct HostProcessExit {
    pub owner: OwnerToken<HostProcessOwner>,
    pub process: ProcessIdentity,
    pub chrome_owner: OwnerToken<ChromeProcessOwner>,
    pub died_signal: Option<u8>,
}

impl HostProcessExit {
    #[inline]
    pub const fn new(
        owner: OwnerToken<HostProcessOwner>,
        chrome_owner: OwnerToken<ChromeProcessOwner>,
        process: ProcessIdentity,
    ) -> Self {
        Self {
            owner,
            chrome_owner,
            process,
            died_signal: None,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> WebviewExitAction {
        webview_exit(ctx, self.process, self.chrome_owner, &mut self.died_signal)
    }
}

#[inline]
fn webview_exit(
    ctx: &ProcessExitContext<'_>,
    expected: ProcessIdentity,
    owner: OwnerToken<ChromeProcessOwner>,
    died_signal: &mut Option<u8>,
) -> WebviewExitAction {
    if ctx.process_identity() != expected {
        return WebviewExitAction::WrongProcess;
    }

    *died_signal = ctx.status.signal_code().map(|signal| signal as u8);
    WebviewExitAction::ClearSingleton {
        owner,
        signal: *died_signal,
        drop_process_ref: true,
    }
}

#[derive(Debug, Default)]
pub struct SyncWindowsExit {
    pub status: Status,
    pub waiter_notified: bool,
}

impl SyncWindowsExit {
    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitEffect {
        set_status_from_exit(&mut self.status, ctx);
        self.waiter_notified = true;
        updated_effect(ctx)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeProcessExitAction {
    NotifySubprocessVm(SubprocessExitAction),
    FinishCron(CronExitAction),
    CloseSecurityScanIpc(OwnerToken<SecurityScanReaderState>),
    ClearWebviewSingleton(WebviewExitAction),
    None,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_spawn_types::{Exited, rusage_zeroed};

    fn process_identity(id: usize) -> ProcessIdentity {
        ProcessIdentity::from_usize(id).unwrap()
    }

    fn owner<T>(id: usize) -> OwnerToken<T> {
        OwnerToken::from_usize(id).unwrap()
    }

    #[test]
    fn subprocess_exit_returns_a_jsc_action_instead_of_calling_jsc_in_types() {
        // Subprocess is the process-exit/JSC hard case: the type crate can
        // capture exit state and rusage readiness, but notifying the VM and
        // draining microtasks must stay in bun_runtime. The returned action is
        // the high crate's to-do list, not work performed below the cycle.
        let process = process_identity(7);
        let rusage = rusage_zeroed();
        let mut exit = ProcessExitState::new(ProcessExit::Subprocess(
            SubprocessExit::new(owner(70), process)
                .with_terminal(owner(71))
                .with_pipe_reader(owner(72)),
        ));

        let effect = exit.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 3, signal: 0 }),
            &rusage,
        ));

        match effect {
            Some(ProcessExitEffect::Subprocess { status, action }) => {
                assert_eq!(status.process, process);
                assert_eq!(status.status.exit_code(), Some(3));
                assert_eq!(
                    action,
                    SubprocessExitAction::NotifyVm {
                        owner: owner(70),
                        terminal: Some(owner(71)),
                        pipe_reader: Some(owner(72)),
                        drain_microtasks: true,
                    }
                );
            }
            other => panic!("unexpected effect: {other:?}"),
        }
    }

    #[test]
    fn lifecycle_and_security_scan_keep_install_state_below_runtime() {
        // Lifecycle/security scan are sibling-domain state machines. Their
        // counters and process-matching rules can live in bun_install_types,
        // but package-manager and IPC effects still come back as actions.
        let process = process_identity(10);
        let rusage = rusage_zeroed();
        let mut lifecycle = ProcessExit::LifecycleScript(LifecycleScriptExit::new(process, 1));

        match lifecycle.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 0, signal: 0 }),
            &rusage,
        )) {
            ProcessExitEffect::LifecycleScript { status, action } => {
                assert_eq!(status.process, process);
                assert_eq!(action, LifecycleScriptExitAction::Pending);
            }
            other => panic!("unexpected effect: {other:?}"),
        }
    }

    #[test]
    fn cron_register_and_remove_preserve_owner_consuming_completion_order() {
        // Cron jobs prove the readiness-gate shape: process exit and reader
        // completion can arrive in either order, and the type crate should
        // remember enough state to return exactly one typed completion action.
        let process = process_identity(20);
        let rusage = rusage_zeroed();
        let mut register = ProcessExit::CronRegister(CronRegisterExit::new(owner(200), process, 1));

        match register.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 0, signal: 0 }),
            &rusage,
        )) {
            ProcessExitEffect::Cron { status, action } => {
                assert_eq!(status.process, process);
                assert_eq!(action, CronExitAction::Pending);
            }
            other => panic!("unexpected effect: {other:?}"),
        }

        match &mut register {
            ProcessExit::CronRegister(register) => {
                assert_eq!(
                    register.record_reader_done(),
                    CronExitAction::RegisterMaybeFinished { owner: owner(200) }
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn webview_exit_keeps_ref_drop_as_a_process_capability_and_returns_high_action() {
        // Webview exit needs process status, signal capture, singleton cleanup,
        // and a process-ref drop. The type crate records the signal and asks
        // for the ref drop; it never receives a mutable Process reference.
        let process = process_identity(30);
        let rusage = rusage_zeroed();
        let mut exit = ProcessExit::ChromeProcess(ChromeProcessExit::new(owner(300), process));

        match exit.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Signaled(9),
            &rusage,
        )) {
            ProcessExitEffect::Webview { status, action } => {
                assert_eq!(status.process, process);
                assert_eq!(
                    action,
                    WebviewExitAction::ClearSingleton {
                        owner: owner(300),
                        signal: Some(9),
                        drop_process_ref: true,
                    }
                );
            }
            other => panic!("unexpected effect: {other:?}"),
        }
    }
}
