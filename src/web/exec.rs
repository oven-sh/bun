//! Futures that run on the event loop of a JS thread.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::future::{Future, poll_fn};
use core::mem::ManuallyDrop;
use core::pin::{Pin, pin};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use core::task::{Context, Poll, Waker};
use core::time::Duration;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use std::sync::Arc;
use std::task::Wake;
use std::thread::ThreadId;

use bun_collections::HashMap;
use bun_event_loop::EventLoopTimer::{OwnedTimer, State as TimerState, Tag as TimerTag};
use bun_event_loop::{BoxedTask, ContextId, Task, TaskTag, task_tag};
use bun_io::JsKeepAlive;
use bun_jsc::bindgen::{self, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, LoopKind, Strong, VmHandle};
use bun_threading::work_pool::WorkPool;
use bun_threading::{Futex, Guarded};

use crate::generated_bindgen::exec::{Bun__Web__onFulfilled, Bun__Web__onRejected};
use crate::tasks;

pub type LocalFuture<'a, T> = Pin<Box<dyn Future<Output = T> + 'a>>;

/// A JS thread, as any thread may name it.
#[derive(Clone)]
pub struct Thread {
    vm: VmHandle,
    id: ThreadId,
}

impl Thread {
    pub fn current() -> Thread {
        Thread {
            vm: VirtualMachine::get().handle(),
            id: std::thread::current().id(),
        }
    }

    pub fn is_current(&self) -> bool {
        self.id == std::thread::current().id()
    }

    fn queue(&self, task: WebTask) {
        let task = Box::new(task);
        if self.is_current() && !self.vm.closed() {
            return VirtualMachine::get()
                .event_loop()
                .enqueue_task(Task::from_boxed(task));
        }
        drop(self.vm.post(LoopKind::Regular, task));
    }

    /// Runs `steps` there, later.
    pub fn post(&self, steps: impl FnOnce() + Send + 'static) {
        self.queue(WebTask::Call(Box::new(steps)));
    }

    /// Runs `steps` there, at once if that is here.
    pub fn run(&self, steps: impl FnOnce() + Send + 'static) {
        if self.is_current() {
            steps()
        } else {
            self.post(steps)
        }
    }

    /// Runs what `start` makes there. `None` if the thread has ended.
    pub async fn call<T: Send + 'static, F: Future<Output = T> + 'static>(
        &self,
        start: impl FnOnce() -> F + Send + 'static,
    ) -> Option<T> {
        if self.is_current() {
            return Some(start().await);
        }
        let (sender, receiver) = oneshot();
        self.post(move || {
            spawn(async move {
                if let Either::First(value) = race(start(), sender.closed()).await {
                    sender.send(value);
                }
            });
        });
        receiver.await
    }
}

pub enum WebTask {
    Poll(Arc<Wakeup>),
    Call(Box<dyn FnOnce() + Send>),
}

impl BoxedTask for WebTask {
    const TAG: TaskTag = task_tag::WebTask;

    fn release_unrun(self: Box<Self>) {}

    fn context(&self) -> ContextId {
        ContextId::NONE
    }
}

impl WebTask {
    pub fn run(self) {
        match self {
            WebTask::Poll(wakeup) => poll(wakeup.task),
            WebTask::Call(steps) => steps(),
        }
    }
}

pub struct Wakeup {
    task: u64,
    thread: Thread,
    is_queued: AtomicBool,
}

impl Wake for Wakeup {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }

    fn wake_by_ref(self: &Arc<Self>) {
        if !self.is_queued.swap(true, Ordering::AcqRel) {
            self.thread.queue(WebTask::Poll(Arc::clone(self)));
        }
    }
}

struct Spawned {
    future: LocalFuture<'static, ()>,
    wakeup: Arc<Wakeup>,
    _keep_alive: Option<JsKeepAlive>,
}

enum Slot {
    Waiting(Spawned),
    Running { was_woken: bool },
}

struct Reaction {
    outcome: Cell<Option<Result<Strong, Strong>>>,
    task: u64,
    waker: Cell<Option<Waker>>,
}

#[derive(Default)]
struct Executor {
    tasks: HashMap<u64, Slot>,
    reactions: BTreeMap<u64, Rc<Reaction>>,
    last_id: u64,
}

static EXECUTOR: bun_ui::Lasting<ManuallyDrop<RefCell<Executor>>> = bun_ui::Lasting::empty();

thread_local! {
    static RUNNING: Cell<u64> = const { Cell::new(0) };
}

fn with_executor<R>(steps: impl FnOnce(&mut Executor) -> R) -> R {
    EXECUTOR.with(|it| steps(&mut it.borrow_mut()))
}

/// Before the VM of this thread is destroyed.
pub fn at_exit(steps: extern "C" fn(*mut c_void)) {
    let vm = VirtualMachine::get();
    // SAFETY: a safe function takes any argument.
    unsafe {
        vm.rare_data()
            .push_cleanup_hook(vm.global(), core::ptr::null_mut(), steps);
    }
}

fn next_id() -> u64 {
    extern "C" fn drop_everything(_: *mut c_void) {
        let (tasks, reactions) = with_executor(|it| {
            (
                core::mem::take(&mut it.tasks),
                core::mem::take(&mut it.reactions),
            )
        });
        drop((tasks, reactions));
    }
    with_executor(|it| {
        if it.last_id == 0 {
            at_exit(drop_everything);
        }
        it.last_id += 1;
        it.last_id
    })
}

fn run(task: u64, mut spawned: Spawned) {
    let waker = Waker::from(Arc::clone(&spawned.wakeup));
    loop {
        with_executor(|it| it.tasks.insert(task, Slot::Running { was_woken: false }));
        spawned.wakeup.is_queued.store(false, Ordering::Release);
        let outer = RUNNING.replace(task);
        let is_done = spawned
            .future
            .as_mut()
            .poll(&mut Context::from_waker(&waker))
            .is_ready();
        RUNNING.set(outer);
        match with_executor(|it| it.tasks.remove(&task)) {
            Some(Slot::Running { was_woken: true }) if !is_done => {}
            Some(_) if !is_done => {
                with_executor(|it| it.tasks.insert(task, Slot::Waiting(spawned)));
                return;
            }
            _ => return,
        }
    }
}

fn poll(task: u64) {
    let slot = with_executor(|it| {
        Some(core::mem::replace(
            it.tasks.get_mut(&task)?,
            Slot::Running { was_woken: true },
        ))
    });
    if let Some(Slot::Waiting(spawned)) = slot {
        run(task, spawned);
    }
}

fn start(future: LocalFuture<'static, ()>, keep_alive: Option<JsKeepAlive>) {
    let task = next_id();
    let wakeup = Arc::new(Wakeup {
        task,
        thread: Thread::current(),
        is_queued: AtomicBool::new(false),
    });
    run(
        task,
        Spawned {
            future,
            wakeup,
            _keep_alive: keep_alive,
        },
    );
}

/// Runs it up to where it first waits before it returns.
pub fn spawn(future: impl Future<Output = ()> + 'static) {
    start(Box::pin(future), Some(JsKeepAlive::active()));
}

/// The program does not wait for it to end.
pub fn spawn_background(future: impl Future<Output = ()> + 'static) {
    start(Box::pin(future), None);
}

/// For a worker: nothing else runs on this thread meanwhile. `None` if the time is up or the worker is terminated.
pub fn park_until<T>(future: impl Future<Output = T>, timeout: Option<Duration>) -> Option<T> {
    struct Parked(AtomicU32);
    impl Wake for Parked {
        fn wake(self: Arc<Self>) {
            self.0.store(1, Ordering::Release);
            Futex::wake(&self.0, 1);
        }
    }
    let (parked, started) = (
        Arc::new(Parked(AtomicU32::new(0))),
        std::time::Instant::now(),
    );
    let waker = Waker::from(Arc::clone(&parked));
    let mut future = pin!(future);
    let outer = RUNNING.replace(0);
    let result = loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut Context::from_waker(&waker)) {
            break Some(value);
        }
        let left = timeout.map_or(Duration::MAX, |it| it.saturating_sub(started.elapsed()));
        if left.is_zero() || !VirtualMachine::get().script_allowed() {
            break None;
        }
        let _ = Futex::wait(
            &parked.0,
            0,
            Some(left.min(Duration::from_millis(50)).as_nanos() as u64),
        );
        parked.0.store(0, Ordering::Release);
    };
    RUNNING.set(outer);
    result
}

/// Runs the event loop, but no script of a page, until `future` is ready. `None` if the process ends.
pub fn block_pages<T: 'static>(
    global: &JSGlobalObject,
    future: impl Future<Output = T> + 'static,
) -> Option<T> {
    let result = Rc::new(Cell::new(None));
    let slot = Rc::clone(&result);
    let promise = with_js(|cx| {
        crate::streams::promise_for(cx, future, move |_, it| {
            slot.set(Some(it));
            Ok(JsLocal::UNDEFINED)
        })
        .to_js()
    });
    let was_suspended = tasks::is_suspended(global);
    tasks::set_suspended(global, true);
    crate::realm::set_paused(true);
    if let Some(promise) = promise.as_any_promise() {
        let wait = || _ = global.bun_vm().wait_for_promise(promise);
        match crate::remote::is_page_process() {
            true => bun_ui::queue::without_events(crate::remote::runs_no_script, wait),
            false => wait(),
        }
    }
    crate::realm::set_paused(was_suspended);
    tasks::set_suspended(global, was_suspended);
    result.take()
}

pub enum Either<A, B> {
    First(A),
    Second(B),
}

pub async fn race<A, B>(
    first: impl Future<Output = A>,
    second: impl Future<Output = B>,
) -> Either<A, B> {
    let (mut first, mut second) = (pin!(first), pin!(second));
    poll_fn(|cx| {
        if let Poll::Ready(value) = first.as_mut().poll(cx) {
            return Poll::Ready(Either::First(value));
        }
        second.as_mut().poll(cx).map(Either::Second)
    })
    .await
}

/// Runs them side by side, until one fails.
pub async fn try_all<T, E>(
    futures: Vec<impl Future<Output = core::result::Result<T, E>>>,
) -> core::result::Result<Vec<T>, E> {
    let mut all: Vec<_> = futures.into_iter().map(|it| (Box::pin(it), None)).collect();
    poll_fn(|cx| {
        for (future, value) in all.iter_mut().filter(|it| it.1.is_none()) {
            if let Poll::Ready(result) = future.as_mut().poll(cx) {
                *value = Some(result?);
            }
        }
        if all.iter().any(|it| it.1.is_none()) {
            return Poll::Pending;
        }
        Poll::Ready(Ok(all.drain(..).filter_map(|it| it.1).collect()))
    })
    .await
}

/// Not before who has started it is done with what it is doing.
pub async fn never_at_once<T>(future: impl Future<Output = T>) -> T {
    let (mut future, mut is_first, mut early) = (pin!(future), true, None);
    poll_fn(|cx| {
        let polled = early
            .take()
            .map_or_else(|| future.as_mut().poll(cx), Poll::Ready);
        match (polled, core::mem::take(&mut is_first)) {
            (Poll::Ready(value), true) => {
                early = Some(value);
                cx.waker().wake_by_ref();
                Poll::Pending
            }
            (polled, _) => polled,
        }
    })
    .await
}

/// Who waits for a change of what it is part of.
#[derive(Default)]
pub struct Waiter(Option<Waker>);

impl Waiter {
    pub fn pending<T>(&mut self, cx: &Context<'_>) -> Poll<T> {
        match &mut self.0 {
            Some(waker) => waker.clone_from(cx.waker()),
            None => self.0 = Some(cx.waker().clone()),
        }
        Poll::Pending
    }

    pub fn is_waiting(&self) -> bool {
        self.0.is_some()
    }

    pub fn wake(&mut self) {
        if let Some(waker) = self.0.take() {
            waker.wake();
        }
    }
}

struct Channel<T> {
    value: Option<T>,
    is_closed: bool,
    receiver: Waiter,
    sender: Waiter,
}

pub struct Sender<T>(Arc<Guarded<Channel<T>>>);
pub struct Receiver<T>(Arc<Guarded<Channel<T>>>);

pub fn oneshot<T>() -> (Sender<T>, Receiver<T>) {
    let channel = Channel {
        value: None,
        is_closed: false,
        receiver: Waiter::default(),
        sender: Waiter::default(),
    };
    let channel = Arc::new(Guarded::new(channel));
    (Sender(Arc::clone(&channel)), Receiver(channel))
}

impl<T> Receiver<T> {
    pub fn ready(value: T) -> Receiver<T> {
        let (sender, receiver) = oneshot();
        sender.send(value);
        receiver
    }
}

impl<T> Sender<T> {
    pub fn send(self, value: T) {
        self.0.lock().value = Some(value);
    }

    pub fn is_closed(&self) -> bool {
        self.0.lock().is_closed
    }

    /// When nobody wants the value any more.
    pub async fn closed(&self) {
        poll_fn(|cx| {
            let mut channel = self.0.lock();
            if channel.is_closed {
                Poll::Ready(())
            } else {
                channel.sender.pending(cx)
            }
        })
        .await;
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        let mut channel = self.0.lock();
        channel.is_closed = true;
        channel.receiver.wake();
    }
}

impl<T> Future for Receiver<T> {
    type Output = Option<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        let mut channel = self.0.lock();
        if channel.is_closed {
            Poll::Ready(channel.value.take())
        } else {
            channel.receiver.pending(cx)
        }
    }
}

impl<T> Drop for Receiver<T> {
    fn drop(&mut self) {
        let mut channel = self.0.lock();
        channel.is_closed = true;
        channel.sender.wake();
    }
}

struct Outcome<T> {
    value: Option<T>,
    wakers: Vec<Waker>,
}

/// A result that several may wait for.
pub struct Shared<T>(Rc<RefCell<Outcome<T>>>);

impl<T> Clone for Shared<T> {
    fn clone(&self) -> Self {
        Shared(Rc::clone(&self.0))
    }
}

impl<T: 'static> Shared<T> {
    pub fn spawn(future: impl Future<Output = T> + 'static) -> Shared<T> {
        let shared = Shared(Rc::new(RefCell::new(Outcome {
            value: None,
            wakers: Vec::new(),
        })));
        let outcome = Rc::clone(&shared.0);
        spawn(async move {
            let value = future.await;
            let mut outcome = outcome.borrow_mut();
            outcome.value = Some(value);
            outcome.wakers.drain(..).for_each(Waker::wake);
        });
        shared
    }
}

impl<T: Clone> Future for Shared<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let mut outcome = self.0.borrow_mut();
        if outcome.value.is_none() {
            outcome.wakers.push(cx.waker().clone());
        }
        outcome.value.clone().map_or(Poll::Pending, Poll::Ready)
    }
}

/// Up to where it first waits on this thread, and then on the thread pool.
pub(crate) fn detach(future: impl Future<Output = ()> + Send + 'static) {
    Detached::start(future, None);
}

struct Detached {
    future: Guarded<Option<Pin<Box<dyn Future<Output = ()> + Send>>>>,
    line: Option<Arc<Line>>,
}

impl Detached {
    fn start(future: impl Future<Output = ()> + Send + 'static, line: Option<Arc<Line>>) {
        let future = Guarded::new(Some(Box::pin(future) as _));
        Arc::new(Detached { future, line }).poll();
    }

    fn poll(self: Arc<Self>) {
        let (waker, mut future) = (Waker::from(Arc::clone(&self)), self.future.lock());
        future.take_if(|it| {
            it.as_mut()
                .poll(&mut Context::from_waker(&waker))
                .is_ready()
        });
    }
}

impl Wake for Detached {
    fn wake(self: Arc<Self>) {
        match self.line.clone() {
            Some(line) => line.join(self),
            None => bun_core::handle_oom(WorkPool::go(self, Detached::poll)),
        }
    }
}

/// What is detached here goes on in the order in which it is woken.
#[derive(Default)]
pub(crate) struct Line(Guarded<Option<VecDeque<Arc<Detached>>>>);

impl Line {
    pub(crate) fn detach(self: &Arc<Self>, future: impl Future<Output = ()> + Send + 'static) {
        Detached::start(future, Some(Arc::clone(self)));
    }

    fn join(self: Arc<Self>, it: Arc<Detached>) {
        let mut waiting = self.0.lock();
        let is_served = waiting.is_some();
        waiting.get_or_insert_default().push_back(it);
        drop(waiting);
        if !is_served {
            bun_core::handle_oom(WorkPool::go(self, Line::serve));
        }
    }

    fn serve(self: Arc<Self>) {
        loop {
            let mut waiting = self.0.lock();
            let Some(next) = waiting.as_mut().and_then(VecDeque::pop_front) else {
                return *waiting = None;
            };
            drop(waiting);
            next.poll();
        }
    }
}

/// On the thread pool. It starts at once, and ends whether or not somebody waits.
pub fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Receiver<T> {
    let (sender, receiver) = oneshot();
    let job: Box<dyn FnOnce() + Send> = Box::new(move || sender.send(work()));
    bun_core::handle_oom(WorkPool::go(job, |job| job()));
    receiver
}

#[repr(C)]
pub struct Alarm {
    pub timer: OwnedTimer,
    waiter: RefCell<Waiter>,
}

impl Alarm {
    pub fn fire(&self) {
        self.timer.state.set(TimerState::FIRED);
        self.waiter.take().wake();
    }
}

pub async fn sleep(duration: Duration) {
    let alarm = Box::new(Alarm {
        timer: OwnedTimer::init_paused(TimerTag::WebAlarm),
        waiter: RefCell::default(),
    });
    let now = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
    alarm.timer.next.set(
        now.add_ms(
            i64::try_from(duration.as_millis())
                .unwrap_or(i64::MAX)
                .min(1 << 40),
        ),
    );
    let whole: *const Alarm = &raw const *alarm;
    // SAFETY: it does not move, and is unlinked when it is dropped.
    unsafe { VirtualMachine::get().timer_insert(OwnedTimer::node(&raw const (*whole).timer)) };
    poll_fn(|cx| {
        if alarm.timer.state.get() == TimerState::FIRED {
            Poll::Ready(())
        } else {
            alarm.waiter.borrow_mut().pending(cx)
        }
    })
    .await;
}

/// In the realm of `global`, from a future or a task.
pub fn with_realm<R>(
    global: &JSGlobalObject,
    steps: impl for<'a> FnOnce(&mut JsScope<'a>) -> R,
) -> R {
    // SAFETY: futures and tasks are run by the event loop, or by a host function that may run script.
    unsafe { JsScope::with(core::ptr::from_ref(global).cast_mut(), steps) }
}

/// Keeps a global object alive.
pub struct Realm(Strong);

impl Realm {
    pub fn of(cx: &mut JsScope<'_>) -> Realm {
        let global = cx.global();
        Realm(Strong::create(global.to_js_value(), global))
    }

    pub fn enter<R>(&self, steps: impl for<'a> FnOnce(&mut JsScope<'a>) -> R) -> R {
        with_realm(
            JSGlobalObject::opaque_ref(self.0.get().encoded() as *const JSGlobalObject),
            steps,
        )
    }
}

/// In the main realm of this thread.
pub fn with_js<R>(steps: impl for<'a> FnOnce(&mut JsScope<'a>) -> R) -> R {
    with_realm(VirtualMachine::get().global(), steps)
}

/// What was thrown.
pub fn caught<'a>(cx: &mut JsScope<'a>, error: bindgen::Error<'a>) -> JsLocal<'a> {
    let global = cx.global();
    let value = global.take_error(error.into_js_error(global));
    JsLocal::new(&cx.heap, value)
}

/// As an uncaught exception.
pub fn report<'a>(cx: &mut JsScope<'a>, result: bindgen::Result<'a, ()>) {
    if let Err(error) = result {
        let global = cx.global();
        let _ = bun_jsc::task::report_error_or_terminate(global, error.into_js_error(global));
    }
}

/// `await value`, without a turn for what has a result already.
pub struct Settled {
    id: u64,
    reaction: Rc<Reaction>,
}

pub fn settled<'a>(cx: &mut JsScope<'a>, value: JsLocal<'a>) -> Settled {
    use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
    let (global, value) = (cx.global(), value.to_js());
    let outcome = match value
        .as_any_promise()
        .map(|it| it.unwrap(global.vm(), UnwrapMode::MarkHandled))
    {
        None => Some(Ok(Strong::create(value, global))),
        Some(Unwrapped::Fulfilled(value)) => Some(Ok(Strong::create(value, global))),
        Some(Unwrapped::Rejected(reason)) => Some(Err(Strong::create(reason, global))),
        Some(Unwrapped::Pending) => None,
    };
    let id = if outcome.is_none() { next_id() } else { 0 };
    let reaction = Rc::new(Reaction {
        outcome: outcome.into(),
        task: RUNNING.get(),
        waker: Cell::new(None),
    });
    if id != 0 {
        with_executor(|it| it.reactions.insert(id, Rc::clone(&reaction)));
        value.then2(
            global,
            JSValue::js_number(id as f64),
            Bun__Web__onFulfilled,
            Bun__Web__onRejected,
        );
    }
    Settled { id, reaction }
}

impl Future for Settled {
    type Output = Result<Strong, Strong>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if let Some(outcome) = self.reaction.outcome.take() {
            return Poll::Ready(outcome);
        }
        let is_where_it_was_made = self.reaction.task != 0 && self.reaction.task == RUNNING.get();
        self.reaction
            .waker
            .set((!is_where_it_was_made).then(|| cx.waker().clone()));
        Poll::Pending
    }
}

impl Drop for Settled {
    fn drop(&mut self) {
        if self.id != 0 {
            with_executor(|it| it.reactions.remove(&self.id));
        }
    }
}

fn react(id: JsLocal<'_>, outcome: Result<Strong, Strong>) {
    let Some(reaction) = with_executor(|it| it.reactions.remove(&(id.to_js().as_number() as u64)))
    else {
        return;
    };
    reaction.outcome.set(Some(outcome));
    match reaction.waker.take() {
        Some(waker) => waker.wake(),
        None => poll(reaction.task),
    }
}

pub(crate) fn on_fulfilled<'a>(cx: &mut JsScope<'a>, value: JsLocal<'a>, id: JsLocal<'a>) {
    react(id, Ok(Strong::create(value.to_js(), cx.global())));
}

pub(crate) fn on_rejected<'a>(cx: &mut JsScope<'a>, reason: JsLocal<'a>, id: JsLocal<'a>) {
    react(id, Err(Strong::create(reason.to_js(), cx.global())));
}
