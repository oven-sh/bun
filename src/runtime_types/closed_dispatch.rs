use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;
use core::num::NonZeroUsize;

use bun_spawn_types::ProcessIdentity;

pub struct OwnerToken<T> {
    id: NonZeroUsize,
    _marker: PhantomData<fn() -> T>,
}

impl<T> OwnerToken<T> {
    #[inline]
    pub const fn from_nonzero(id: NonZeroUsize) -> Self {
        Self {
            id,
            _marker: PhantomData,
        }
    }

    #[inline]
    pub const fn from_usize(id: usize) -> Option<Self> {
        match NonZeroUsize::new(id) {
            Some(id) => Some(Self::from_nonzero(id)),
            None => None,
        }
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.id.get()
    }
}

impl<T> Copy for OwnerToken<T> {}

impl<T> Clone for OwnerToken<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> PartialEq for OwnerToken<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl<T> Eq for OwnerToken<T> {}

impl<T> Hash for OwnerToken<T> {
    #[inline]
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl<T> fmt::Debug for OwnerToken<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("OwnerToken").field(&self.id).finish()
    }
}

pub enum JsEventLoopOwner {}
pub enum ShellRmTaskState {}
pub enum ReadFileTaskState {}
pub enum ArchiveExtractTaskState {}
pub enum CppTaskState {}
pub enum JscDeferredWorkTaskState {}
pub enum ImmediateTaskState {}
pub enum WtfTimerState {}
pub enum ProcessPollState {}
pub enum FileSinkPollState {}
pub enum RuntimeStaticPipeWriterState {}
pub enum ShellStaticPipeWriterState {}
pub enum SecurityScanStaticPipeWriterState {}
pub enum DnsResolverState {}
pub enum GetAddrInfoRequestState {}
pub enum ShellBufferedWriterState {}
pub enum SubprocessPipeReaderState {}
pub enum ShellPipeReaderState {}
pub enum TerminalReaderState {}
pub enum CronRegisterReaderState {}
pub enum CronRemoveReaderState {}
pub enum LifecycleScriptReaderState {}
pub enum SecurityScanReaderState {}
pub enum ReadFilePollState {}
pub enum WriteFilePollState {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeTask {
    ShellRm(ShellRmTask),
    ReadFile(ReadFileTask),
    ArchiveExtract(ArchiveExtractTask),
    Cpp(CppTask),
    JscDeferredWork(JscDeferredWorkTask),
    JscTimer(JscTimerTask),
    Concurrent(ConcurrentRuntimeTask),
    PosixSignal(PosixSignalTask),
    NativePromiseDeferredDeref(NativePromiseDeferredDerefTask),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellRmTask {
    pub state: OwnerToken<ShellRmTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadFileTask {
    pub state: OwnerToken<ReadFileTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ArchiveExtractTask {
    pub state: OwnerToken<ArchiveExtractTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CppTask {
    pub state: OwnerToken<CppTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JscDeferredWorkTask {
    pub state: OwnerToken<JscDeferredWorkTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JscTimerTask {
    Immediate(ImmediateTask),
    WtfTimer(WtfTimerTask),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImmediateTask {
    pub state: OwnerToken<ImmediateTaskState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WtfTimerTask {
    pub state: OwnerToken<WtfTimerState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConcurrentTaskDeinit {
    AutoDelete,
    Manual,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConcurrentTaskOwner {
    ShellRm(OwnerToken<ShellRmTaskState>),
    ReadFile(OwnerToken<ReadFileTaskState>),
    ArchiveExtract(OwnerToken<ArchiveExtractTaskState>),
    Cpp(OwnerToken<CppTaskState>),
    JscDeferredWork(OwnerToken<JscDeferredWorkTaskState>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConcurrentRuntimeTask {
    pub owner: ConcurrentTaskOwner,
    pub deinit: ConcurrentTaskDeinit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PosixSignalTask {
    pub signal: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativePromiseDeferredDerefTask {
    pub index: usize,
}

#[derive(Default, Debug)]
pub struct RuntimeTaskQueue {
    tasks: Vec<RuntimeTask>,
}

impl RuntimeTaskQueue {
    #[inline]
    pub fn push(&mut self, task: impl Into<RuntimeTask>) {
        self.tasks.push(task.into());
    }

    #[inline]
    pub fn pop(&mut self) -> Option<RuntimeTask> {
        self.tasks.pop()
    }

    #[inline]
    pub fn drain_ready(&mut self) -> impl Iterator<Item = RuntimeTask> + '_ {
        core::iter::from_fn(|| self.pop())
    }
}

impl From<ShellRmTask> for RuntimeTask {
    #[inline]
    fn from(task: ShellRmTask) -> Self {
        Self::ShellRm(task)
    }
}

impl From<ReadFileTask> for RuntimeTask {
    #[inline]
    fn from(task: ReadFileTask) -> Self {
        Self::ReadFile(task)
    }
}

impl From<ArchiveExtractTask> for RuntimeTask {
    #[inline]
    fn from(task: ArchiveExtractTask) -> Self {
        Self::ArchiveExtract(task)
    }
}

impl From<CppTask> for RuntimeTask {
    #[inline]
    fn from(task: CppTask) -> Self {
        Self::Cpp(task)
    }
}

impl From<JscDeferredWorkTask> for RuntimeTask {
    #[inline]
    fn from(task: JscDeferredWorkTask) -> Self {
        Self::JscDeferredWork(task)
    }
}

impl From<JscTimerTask> for RuntimeTask {
    #[inline]
    fn from(task: JscTimerTask) -> Self {
        Self::JscTimer(task)
    }
}

impl From<ConcurrentRuntimeTask> for RuntimeTask {
    #[inline]
    fn from(task: ConcurrentRuntimeTask) -> Self {
        Self::Concurrent(task)
    }
}

impl From<PosixSignalTask> for RuntimeTask {
    #[inline]
    fn from(task: PosixSignalTask) -> Self {
        Self::PosixSignal(task)
    }
}

impl From<NativePromiseDeferredDerefTask> for RuntimeTask {
    #[inline]
    fn from(task: NativePromiseDeferredDerefTask) -> Self {
        Self::NativePromiseDeferredDeref(task)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeTaskResult {
    Continue,
    DrainMicrotasks,
    Terminated,
}

pub trait RuntimeTaskHost {
    fn enter_jsc(&mut self, event_loop: OwnerToken<JsEventLoopOwner>);
    fn run_shell_rm(&mut self, task: ShellRmTask) -> RuntimeTaskResult;
    fn run_read_file(&mut self, task: ReadFileTask) -> RuntimeTaskResult;
    fn run_archive_extract(&mut self, task: ArchiveExtractTask) -> RuntimeTaskResult;
    fn run_cpp_task(&mut self, task: CppTask) -> RuntimeTaskResult;
    fn run_jsc_deferred_work(&mut self, task: JscDeferredWorkTask) -> RuntimeTaskResult;
    fn run_jsc_timer(&mut self, task: JscTimerTask) -> RuntimeTaskResult;
    fn run_concurrent_task(&mut self, task: ConcurrentRuntimeTask) -> RuntimeTaskResult;
    fn run_posix_signal(&mut self, task: PosixSignalTask) -> RuntimeTaskResult;
    fn deref_native_promise(&mut self, task: NativePromiseDeferredDerefTask) -> RuntimeTaskResult;
    fn drain_microtasks(&mut self, event_loop: OwnerToken<JsEventLoopOwner>);
    fn exit_jsc(&mut self, event_loop: OwnerToken<JsEventLoopOwner>);
}

#[derive(Debug, Default)]
pub struct RuntimeTaskDispatcher {
    pub event_loop: Option<OwnerToken<JsEventLoopOwner>>,
}

impl RuntimeTaskDispatcher {
    #[inline]
    pub const fn new(event_loop: OwnerToken<JsEventLoopOwner>) -> Self {
        Self {
            event_loop: Some(event_loop),
        }
    }

    pub fn drain<H: RuntimeTaskHost>(
        &mut self,
        queue: &mut RuntimeTaskQueue,
        host: &mut H,
    ) -> RuntimeTaskResult {
        let Some(event_loop) = self.event_loop else {
            return RuntimeTaskResult::Terminated;
        };

        host.enter_jsc(event_loop);
        let mut result = RuntimeTaskResult::Continue;
        for task in queue.drain_ready() {
            result = match task {
                RuntimeTask::ShellRm(task) => host.run_shell_rm(task),
                RuntimeTask::ReadFile(task) => host.run_read_file(task),
                RuntimeTask::ArchiveExtract(task) => host.run_archive_extract(task),
                RuntimeTask::Cpp(task) => host.run_cpp_task(task),
                RuntimeTask::JscDeferredWork(task) => host.run_jsc_deferred_work(task),
                RuntimeTask::JscTimer(task) => host.run_jsc_timer(task),
                RuntimeTask::Concurrent(task) => host.run_concurrent_task(task),
                RuntimeTask::PosixSignal(task) => host.run_posix_signal(task),
                RuntimeTask::NativePromiseDeferredDeref(task) => host.deref_native_promise(task),
            };

            match result {
                RuntimeTaskResult::Continue => {}
                RuntimeTaskResult::DrainMicrotasks => host.drain_microtasks(event_loop),
                RuntimeTaskResult::Terminated => break,
            }
        }
        host.exit_jsc(event_loop);
        result
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilePollOwner {
    Process(ProcessPollOwner),
    FileSink(FileSinkPollOwner),
    RuntimeStaticPipeWriter(RuntimeStaticPipeWriterOwner),
    ShellStaticPipeWriter(ShellStaticPipeWriterOwner),
    SecurityScanStaticPipeWriter(SecurityScanStaticPipeWriterOwner),
    DnsResolver(DnsResolverOwner),
    GetAddrInfoRequest(GetAddrInfoRequestOwner),
    ShellBufferedWriter(ShellBufferedWriterOwner),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessPollOwner {
    pub process: ProcessIdentity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileSinkPollOwner {
    pub owner: OwnerToken<FileSinkPollState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RuntimeStaticPipeWriterOwner {
    pub owner: OwnerToken<RuntimeStaticPipeWriterState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellStaticPipeWriterOwner {
    pub owner: OwnerToken<ShellStaticPipeWriterState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecurityScanStaticPipeWriterOwner {
    pub owner: OwnerToken<SecurityScanStaticPipeWriterState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DnsResolverOwner {
    pub owner: OwnerToken<DnsResolverState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GetAddrInfoRequestOwner {
    pub owner: OwnerToken<GetAddrInfoRequestState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellBufferedWriterOwner {
    pub owner: OwnerToken<ShellBufferedWriterState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FilePollEvent {
    pub size_or_offset: i64,
    pub hup: bool,
}

#[derive(Default, Debug)]
pub struct FilePollState {
    owner: Option<FilePollOwner>,
}

impl FilePollState {
    #[inline]
    pub fn set_owner(&mut self, owner: FilePollOwner) {
        self.owner = Some(owner);
    }

    #[inline]
    pub fn clear_owner(&mut self) {
        self.owner = None;
    }

    #[inline]
    pub const fn owner(&self) -> Option<FilePollOwner> {
        self.owner
    }
}

pub trait FilePollHost {
    fn on_process_poll(&mut self, owner: ProcessPollOwner, event: FilePollEvent);
    fn on_file_sink_poll(&mut self, owner: FileSinkPollOwner, event: FilePollEvent);
    fn on_runtime_writer_poll(&mut self, owner: RuntimeStaticPipeWriterOwner, event: FilePollEvent);
    fn on_shell_writer_poll(&mut self, owner: ShellStaticPipeWriterOwner, event: FilePollEvent);
    fn on_security_scan_writer_poll(
        &mut self,
        owner: SecurityScanStaticPipeWriterOwner,
        event: FilePollEvent,
    );
    fn on_dns_poll(&mut self, owner: DnsResolverOwner, event: FilePollEvent);
    fn on_getaddrinfo_change(&mut self, owner: GetAddrInfoRequestOwner, event: FilePollEvent);
    fn on_shell_buffered_writer_poll(
        &mut self,
        owner: ShellBufferedWriterOwner,
        event: FilePollEvent,
    );
}

pub fn dispatch_file_poll<H: FilePollHost>(
    state: FilePollState,
    event: FilePollEvent,
    host: &mut H,
) {
    let Some(owner) = state.owner() else {
        return;
    };

    match owner {
        FilePollOwner::Process(owner) => host.on_process_poll(owner, event),
        FilePollOwner::FileSink(owner) => host.on_file_sink_poll(owner, event),
        FilePollOwner::RuntimeStaticPipeWriter(owner) => host.on_runtime_writer_poll(owner, event),
        FilePollOwner::ShellStaticPipeWriter(owner) => host.on_shell_writer_poll(owner, event),
        FilePollOwner::SecurityScanStaticPipeWriter(owner) => {
            host.on_security_scan_writer_poll(owner, event)
        }
        FilePollOwner::DnsResolver(owner) => host.on_dns_poll(owner, event),
        FilePollOwner::GetAddrInfoRequest(owner) => host.on_getaddrinfo_change(owner, event),
        FilePollOwner::ShellBufferedWriter(owner) => {
            host.on_shell_buffered_writer_poll(owner, event)
        }
    }
}

#[repr(u16)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PollableKind {
    Empty = 0,
    ReadFile = 1,
    WriteFile = 2,
}

pub trait PollableVariant {
    const KIND: PollableKind;
}

pub enum ReadFilePollable {}
pub enum WriteFilePollable {}

impl PollableVariant for ReadFilePollable {
    const KIND: PollableKind = PollableKind::ReadFile;
}

impl PollableVariant for WriteFilePollable {
    const KIND: PollableKind = PollableKind::WriteFile;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PollableToken(u64);

pub const POLLABLE_ADDR_BITS: u32 = 49;
pub const POLLABLE_ADDR_MASK: u64 = (1u64 << POLLABLE_ADDR_BITS) - 1;

impl PollableToken {
    #[inline]
    pub fn encode<T: PollableVariant>(poll: OwnerToken<T>) -> Self {
        let addr = poll.get() as u64;
        debug_assert_eq!(addr & !POLLABLE_ADDR_MASK, 0);
        Self((addr & POLLABLE_ADDR_MASK) | ((T::KIND as u64) << POLLABLE_ADDR_BITS))
    }

    #[inline]
    pub const fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    #[inline]
    pub const fn as_u64(self) -> u64 {
        self.0
    }

    #[inline]
    pub const fn owner_addr(self) -> usize {
        (self.0 & POLLABLE_ADDR_MASK) as usize
    }

    #[inline]
    pub fn kind_checked(self) -> Option<PollableKind> {
        match (self.0 >> POLLABLE_ADDR_BITS) as u16 {
            0 => Some(PollableKind::Empty),
            1 => Some(PollableKind::ReadFile),
            2 => Some(PollableKind::WriteFile),
            _ => None,
        }
    }

    #[inline]
    pub fn kind(self) -> PollableKind {
        self.kind_checked().unwrap_or(PollableKind::Empty)
    }

    #[inline]
    pub fn decode(self) -> PollableOwner {
        let Some(id) = NonZeroUsize::new((self.0 & POLLABLE_ADDR_MASK) as usize) else {
            return PollableOwner::Empty;
        };

        match self.kind() {
            PollableKind::Empty => PollableOwner::Empty,
            PollableKind::ReadFile => PollableOwner::ReadFile(ReadFilePollOwner {
                poll: OwnerToken::from_nonzero(id),
            }),
            PollableKind::WriteFile => PollableOwner::WriteFile(WriteFilePollOwner {
                poll: OwnerToken::from_nonzero(id),
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PollableOwner {
    Empty,
    ReadFile(ReadFilePollOwner),
    WriteFile(WriteFilePollOwner),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReadFilePollOwner {
    pub poll: OwnerToken<ReadFilePollable>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WriteFilePollOwner {
    pub poll: OwnerToken<WriteFilePollable>,
}

pub trait PollableHost {
    fn on_read_file_ready(&mut self, owner: ReadFilePollOwner);
    fn on_write_file_ready(&mut self, owner: WriteFilePollOwner);
    fn on_empty_pollable(&mut self);
}

pub fn dispatch_pollable<H: PollableHost>(token: PollableToken, host: &mut H) {
    match token.decode() {
        PollableOwner::Empty => host.on_empty_pollable(),
        PollableOwner::ReadFile(owner) => host.on_read_file_ready(owner),
        PollableOwner::WriteFile(owner) => host.on_write_file_ready(owner),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BufferedReaderParent {
    SubprocessPipeReader(SubprocessPipeReaderOwner),
    ShellPipeReader(ShellPipeReaderOwner),
    Terminal(TerminalReaderOwner),
    CronRegister(CronRegisterReaderOwner),
    CronRemove(CronRemoveReaderOwner),
    LifecycleScript(LifecycleScriptReaderOwner),
    SecurityScan(SecurityScanReaderOwner),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SubprocessPipeReaderOwner {
    pub owner: OwnerToken<SubprocessPipeReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShellPipeReaderOwner {
    pub owner: OwnerToken<ShellPipeReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalReaderOwner {
    pub owner: OwnerToken<TerminalReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CronRegisterReaderOwner {
    pub owner: OwnerToken<CronRegisterReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CronRemoveReaderOwner {
    pub owner: OwnerToken<CronRemoveReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LifecycleScriptReaderOwner {
    pub owner: OwnerToken<LifecycleScriptReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecurityScanReaderOwner {
    pub owner: OwnerToken<SecurityScanReaderState>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReaderEvent {
    Chunk { len: usize, has_more: bool },
    Done,
    Error(i32),
    MaxBufferOverflow,
}

pub trait BufferedReaderHost {
    fn on_subprocess_reader(&mut self, owner: SubprocessPipeReaderOwner, event: ReaderEvent);
    fn on_shell_reader(&mut self, owner: ShellPipeReaderOwner, event: ReaderEvent);
    fn on_terminal_reader(&mut self, owner: TerminalReaderOwner, event: ReaderEvent);
    fn on_cron_register_reader(&mut self, owner: CronRegisterReaderOwner, event: ReaderEvent);
    fn on_cron_remove_reader(&mut self, owner: CronRemoveReaderOwner, event: ReaderEvent);
    fn on_lifecycle_reader(&mut self, owner: LifecycleScriptReaderOwner, event: ReaderEvent);
    fn on_security_scan_reader(&mut self, owner: SecurityScanReaderOwner, event: ReaderEvent);
}

pub fn dispatch_buffered_reader<H: BufferedReaderHost>(
    parent: BufferedReaderParent,
    event: ReaderEvent,
    host: &mut H,
) {
    match parent {
        BufferedReaderParent::SubprocessPipeReader(owner) => {
            host.on_subprocess_reader(owner, event)
        }
        BufferedReaderParent::ShellPipeReader(owner) => host.on_shell_reader(owner, event),
        BufferedReaderParent::Terminal(owner) => host.on_terminal_reader(owner, event),
        BufferedReaderParent::CronRegister(owner) => host.on_cron_register_reader(owner, event),
        BufferedReaderParent::CronRemove(owner) => host.on_cron_remove_reader(owner, event),
        BufferedReaderParent::LifecycleScript(owner) => host.on_lifecycle_reader(owner, event),
        BufferedReaderParent::SecurityScan(owner) => host.on_security_scan_reader(owner, event),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner<T>(id: usize) -> OwnerToken<T> {
        OwnerToken::from_usize(id).unwrap()
    }

    #[derive(Default)]
    struct TaskTrace {
        events: Vec<&'static str>,
    }

    impl RuntimeTaskHost for TaskTrace {
        fn enter_jsc(&mut self, _event_loop: OwnerToken<JsEventLoopOwner>) {
            self.events.push("enter_jsc");
        }

        fn run_shell_rm(&mut self, _task: ShellRmTask) -> RuntimeTaskResult {
            self.events.push("shell_rm");
            RuntimeTaskResult::Continue
        }

        fn run_read_file(&mut self, _task: ReadFileTask) -> RuntimeTaskResult {
            self.events.push("read_file");
            RuntimeTaskResult::DrainMicrotasks
        }

        fn run_archive_extract(&mut self, _task: ArchiveExtractTask) -> RuntimeTaskResult {
            self.events.push("archive_extract");
            RuntimeTaskResult::Terminated
        }

        fn run_cpp_task(&mut self, _task: CppTask) -> RuntimeTaskResult {
            self.events.push("cpp_task");
            RuntimeTaskResult::Continue
        }

        fn run_jsc_deferred_work(&mut self, _task: JscDeferredWorkTask) -> RuntimeTaskResult {
            self.events.push("jsc_deferred_work");
            RuntimeTaskResult::DrainMicrotasks
        }

        fn run_jsc_timer(&mut self, task: JscTimerTask) -> RuntimeTaskResult {
            match task {
                JscTimerTask::Immediate(_) => self.events.push("immediate"),
                JscTimerTask::WtfTimer(_) => self.events.push("wtf_timer"),
            }
            RuntimeTaskResult::Continue
        }

        fn run_concurrent_task(&mut self, task: ConcurrentRuntimeTask) -> RuntimeTaskResult {
            assert_eq!(task.deinit, ConcurrentTaskDeinit::AutoDelete);
            match task.owner {
                ConcurrentTaskOwner::ReadFile(_) => self.events.push("concurrent_read_file"),
                _ => self.events.push("concurrent_other"),
            }
            RuntimeTaskResult::Continue
        }

        fn run_posix_signal(&mut self, task: PosixSignalTask) -> RuntimeTaskResult {
            assert_eq!(task.signal, 2);
            self.events.push("posix_signal");
            RuntimeTaskResult::Continue
        }

        fn deref_native_promise(
            &mut self,
            task: NativePromiseDeferredDerefTask,
        ) -> RuntimeTaskResult {
            assert_eq!(task.index, 42);
            self.events.push("native_promise_deref");
            RuntimeTaskResult::Continue
        }

        fn drain_microtasks(&mut self, _event_loop: OwnerToken<JsEventLoopOwner>) {
            self.events.push("drain_microtasks");
        }

        fn exit_jsc(&mut self, _event_loop: OwnerToken<JsEventLoopOwner>) {
            self.events.push("exit_jsc");
        }
    }

    #[test]
    fn runtime_tasks_keep_the_jsc_handoff_in_the_high_dispatcher() {
        // This is the event-loop hard case: the queue can carry ordinary
        // pointer-shaped work, opaque JSC/C++ work, timer wakeups, concurrent
        // auto-delete ownership, and the two non-pointer payloads that used to
        // be shoved through pointer storage. The type crate only stores the
        // closed shape; the host is where JSC entry, C++ dispatch, promise
        // deref, auto-delete, and microtask draining happen.
        let mut queue = RuntimeTaskQueue::default();
        queue.push(ArchiveExtractTask { state: owner(3) });
        queue.push(JscDeferredWorkTask { state: owner(6) });
        queue.push(JscTimerTask::WtfTimer(WtfTimerTask { state: owner(8) }));
        queue.push(ConcurrentRuntimeTask {
            owner: ConcurrentTaskOwner::ReadFile(owner(7)),
            deinit: ConcurrentTaskDeinit::AutoDelete,
        });
        queue.push(CppTask { state: owner(5) });
        queue.push(NativePromiseDeferredDerefTask { index: 42 });
        queue.push(PosixSignalTask { signal: 2 });
        queue.push(JscTimerTask::Immediate(ImmediateTask { state: owner(9) }));
        queue.push(ReadFileTask { state: owner(2) });
        queue.push(ShellRmTask { state: owner(1) });

        let mut dispatcher = RuntimeTaskDispatcher::new(owner(99));
        let mut trace = TaskTrace::default();

        assert_eq!(
            dispatcher.drain(&mut queue, &mut trace),
            RuntimeTaskResult::Terminated
        );
        assert_eq!(
            trace.events,
            [
                "enter_jsc",
                "shell_rm",
                "read_file",
                "drain_microtasks",
                "immediate",
                "posix_signal",
                "native_promise_deref",
                "cpp_task",
                "concurrent_read_file",
                "wtf_timer",
                "jsc_deferred_work",
                "drain_microtasks",
                "archive_extract",
                "exit_jsc"
            ]
        );
    }

    #[derive(Default)]
    struct IoTrace {
        events: Vec<&'static str>,
    }

    impl FilePollHost for IoTrace {
        fn on_process_poll(&mut self, _owner: ProcessPollOwner, _event: FilePollEvent) {
            self.events.push("process");
        }

        fn on_file_sink_poll(&mut self, _owner: FileSinkPollOwner, _event: FilePollEvent) {
            self.events.push("file_sink");
        }

        fn on_runtime_writer_poll(
            &mut self,
            _owner: RuntimeStaticPipeWriterOwner,
            _event: FilePollEvent,
        ) {
            self.events.push("runtime_writer");
        }

        fn on_shell_writer_poll(
            &mut self,
            _owner: ShellStaticPipeWriterOwner,
            _event: FilePollEvent,
        ) {
            self.events.push("shell_writer");
        }

        fn on_security_scan_writer_poll(
            &mut self,
            _owner: SecurityScanStaticPipeWriterOwner,
            _event: FilePollEvent,
        ) {
            self.events.push("security_scan_writer");
        }

        fn on_dns_poll(&mut self, _owner: DnsResolverOwner, _event: FilePollEvent) {
            self.events.push("dns");
        }

        fn on_getaddrinfo_change(
            &mut self,
            _owner: GetAddrInfoRequestOwner,
            _event: FilePollEvent,
        ) {
            self.events.push("getaddrinfo");
        }

        fn on_shell_buffered_writer_poll(
            &mut self,
            _owner: ShellBufferedWriterOwner,
            _event: FilePollEvent,
        ) {
            self.events.push("shell_buffered_writer");
        }
    }

    #[test]
    fn file_poll_owner_ties_the_poll_kind_to_the_owner_type() {
        // FilePoll is not a kernel-token problem; it is a Bun-owned owner
        // relationship. This test checks that the owner relationship is a
        // closed enum and that the concrete effect stays in the high host.
        let mut poll = FilePollState::default();
        poll.set_owner(FilePollOwner::SecurityScanStaticPipeWriter(
            SecurityScanStaticPipeWriterOwner { owner: owner(40) },
        ));

        let mut trace = IoTrace::default();
        dispatch_file_poll(
            poll,
            FilePollEvent {
                size_or_offset: 7,
                hup: true,
            },
            &mut trace,
        );

        assert_eq!(trace.events, ["security_scan_writer"]);
    }

    #[derive(Default)]
    struct PollableTrace {
        events: Vec<&'static str>,
    }

    impl PollableHost for PollableTrace {
        fn on_read_file_ready(&mut self, _owner: ReadFilePollOwner) {
            self.events.push("read_file_ready");
        }

        fn on_write_file_ready(&mut self, _owner: WriteFilePollOwner) {
            self.events.push("write_file_ready");
        }

        fn on_empty_pollable(&mut self) {
            self.events.push("empty");
        }
    }

    #[test]
    fn pollable_keeps_the_kernel_u64_but_decodes_to_typed_owners() {
        // Pollable is the opposite boundary: epoll/kqueue forces one u64. The
        // production path still has to pack a token for the kernel, but the
        // first operation after the kernel callback decodes it into a typed
        // owner instead of letting raw tag+address leak through every caller.
        let token = PollableToken::encode::<ReadFilePollable>(owner(0x1200));
        assert_eq!(token.kind(), PollableKind::ReadFile);

        let mut trace = PollableTrace::default();
        dispatch_pollable(token, &mut trace);

        assert_eq!(trace.events, ["read_file_ready"]);
    }

    #[derive(Default)]
    struct ReaderTrace {
        events: Vec<&'static str>,
    }

    impl BufferedReaderHost for ReaderTrace {
        fn on_subprocess_reader(&mut self, _owner: SubprocessPipeReaderOwner, _event: ReaderEvent) {
            self.events.push("subprocess");
        }

        fn on_shell_reader(&mut self, _owner: ShellPipeReaderOwner, _event: ReaderEvent) {
            self.events.push("shell");
        }

        fn on_terminal_reader(&mut self, _owner: TerminalReaderOwner, _event: ReaderEvent) {
            self.events.push("terminal");
        }

        fn on_cron_register_reader(
            &mut self,
            _owner: CronRegisterReaderOwner,
            _event: ReaderEvent,
        ) {
            self.events.push("cron_register");
        }

        fn on_cron_remove_reader(&mut self, _owner: CronRemoveReaderOwner, _event: ReaderEvent) {
            self.events.push("cron_remove");
        }

        fn on_lifecycle_reader(&mut self, _owner: LifecycleScriptReaderOwner, _event: ReaderEvent) {
            self.events.push("lifecycle");
        }

        fn on_security_scan_reader(
            &mut self,
            _owner: SecurityScanReaderOwner,
            _event: ReaderEvent,
        ) {
            self.events.push("security_scan");
        }
    }

    #[test]
    fn buffered_reader_parent_covers_install_cron_and_jsc_reader_families() {
        // BufferedReader parents span runtime, install, shell, cron, and JSC
        // surfaces. The proof here is not a fake "reader callback" body; it is
        // that the parent relationship can be represented as one closed shape
        // while chunk/error/done behavior remains in the owning crate.
        let mut trace = ReaderTrace::default();
        dispatch_buffered_reader(
            BufferedReaderParent::SubprocessPipeReader(SubprocessPipeReaderOwner {
                owner: owner(1),
            }),
            ReaderEvent::Chunk {
                len: 64,
                has_more: true,
            },
            &mut trace,
        );
        dispatch_buffered_reader(
            BufferedReaderParent::LifecycleScript(LifecycleScriptReaderOwner { owner: owner(2) }),
            ReaderEvent::Done,
            &mut trace,
        );
        dispatch_buffered_reader(
            BufferedReaderParent::SecurityScan(SecurityScanReaderOwner { owner: owner(3) }),
            ReaderEvent::Error(5),
            &mut trace,
        );
        dispatch_buffered_reader(
            BufferedReaderParent::CronRegister(CronRegisterReaderOwner { owner: owner(4) }),
            ReaderEvent::Done,
            &mut trace,
        );

        assert_eq!(
            trace.events,
            ["subprocess", "lifecycle", "security_scan", "cron_register"]
        );
    }
}
