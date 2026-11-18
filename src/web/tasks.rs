//! The tasks of the pages and of what hosts them, and the frames in between. One [`Tasks`] for each thread.

use core::any::Any;
use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::collections::VecDeque;

use bun_io::JsKeepAlive;
use bun_jsc::strong::Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ui::later;
use bun_ui::queue::frame_interval;
use smallvec::SmallVec;

unsafe extern "Rust" {
    /// [`__bun_web_pump`] is to be called like the callback of `setImmediate()`.
    safe fn __bun_web_queue_pump(vm: &VirtualMachine);
    /// What has come since the event loop last asked.
    safe fn __bun_web_handle_input(vm: &VirtualMachine);
}

unsafe extern "C" {
    /// Those go through the event loop, and are as urgent as visible tasks.
    safe fn Bun__hasLocalMessages() -> bool;
    safe fn Bun__exchangeAsyncContext(global: &JSGlobalObject, context: JSValue) -> JSValue;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Blocking,
    Visible,
    /// What would run in another process.
    Host,
    Background,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TaskId {
    index: u32,
    generation: u32,
}

impl TaskId {
    const GENERATIONS: u32 = 1 << 21;
}

type Steps = dyn FnOnce(&JSGlobalObject, &[JSValue]) -> JsResult<()>;

/// What a task does with its realm and its values. An exception is reported to the realm.
pub enum Work {
    /// Calls the first value with the others, even if the realm has stopped.
    Call,
    Once(Box<Steps>),
    Function(fn(&JSGlobalObject, u64, &[JSValue]) -> JsResult<()>, u64),
}

struct Root {
    value: JSValue,
    _strong: Option<Strong>,
}

impl Root {
    fn new(global: &JSGlobalObject, value: JSValue) -> Root {
        Root {
            value,
            _strong: value.is_cell().then(|| Strong::create(value, global)),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    Free,
    Queued,
    /// At that index of the heap of timers.
    Waiting(u32),
    Running,
}

struct Task {
    generation: u32,
    place: Place,
    is_canceled: bool,
    order: u64,
    time: f64,
    /// 0 unless it repeats.
    interval: f64,
    realm: *const JSGlobalObject,
    work: Work,
    /// The realm, then the values.
    roots: Vec<Root>,
}

/// How long input waits for tasks.
const BUSY_INTERVAL: f64 = 50.0;
const BUSY_INTERVAL_AT_LAUNCH: f64 = 200.0;
const LAUNCH_DURATION: f64 = 3000.0;
const SLICE: f64 = 4.0;
const HURRY_DURATION: f64 = 200.0;
pub const HURRIED_FRAMES: u8 = 10;
/// Timers that are longer than that fire together with others.
const PRECISE_DELAY: f64 = 64.0;
/// From the epoch, so that what a program does 10, 30 or 60 times a second by the clock is not put off.
const TIMER_ALIGNMENT: f64 = 100.0 / 12.0;
const LONGEST_IDLE_PERIOD: f64 = 50.0;

struct State {
    tasks: Vec<Task>,
    free: Vec<u32>,
    queues: [VecDeque<u32>; 4],
    timers: Vec<u32>,
    /// What wants a frame.
    stale: Vec<(Strong, &'static Canvas)>,
    after_microtasks: Vec<Strong>,
    next_order: u64,
    is_pump_queued: bool,
    /// A script of a page is waiting, so only the host goes on.
    is_suspended: bool,
    has_had_input: bool,
    hurried_frames_left: u8,
    scrolls_until: f64,
    stale_since: f64,
    /// The frame waits for what its first callbacks have left to a task.
    was_put_off: bool,
    has_to_ask_display: bool,
    last_frame: f64,
    hurry_until: f64,
    /// When the first task of the host since the last frame ran.
    busy_since: Option<f64>,
    alarm_time: f64,
    alarm: Option<later::Timer>,
    keep_alive: JsKeepAlive,
}

pub struct Canvas {
    pub is_awaited: fn(JSValue) -> bool,
    pub render: fn(&JSGlobalObject, JSValue, may_wait: bool),
    pub ask_display: fn(JSValue),
}

enum FrameIsDue {
    No,
    Yes,
    IfAwaited,
}

impl State {
    fn first(&self, priority: Priority) -> Option<&Task> {
        let &index = self.queues[priority as usize].front()?;
        Some(&self.tasks[index as usize])
    }

    fn has(&self, priority: Priority) -> bool {
        !self.queues[priority as usize].is_empty()
    }

    fn has_tasks(&self) -> bool {
        self.queues.iter().any(|queue| !queue.is_empty())
    }

    fn shift(&mut self, priority: Priority) -> Option<u32> {
        self.queues[priority as usize].pop_front()
    }

    fn take_order(&mut self) -> u64 {
        self.next_order += 1;
        self.next_order
    }

    fn create(&mut self, realm: &JSGlobalObject, work: Work, values: &[JSValue]) -> TaskId {
        let order = self.take_order();
        let index = self.free.pop().unwrap_or_else(|| {
            self.tasks.push(Task {
                generation: 0,
                place: Place::Free,
                is_canceled: false,
                order: 0,
                time: 0.0,
                interval: 0.0,
                realm,
                work: Work::Call,
                roots: Vec::new(),
            });
            (self.tasks.len() - 1) as u32
        });
        let task = &mut self.tasks[index as usize];
        task.place = Place::Queued;
        task.is_canceled = false;
        task.order = order;
        task.interval = 0.0;
        task.realm = realm;
        task.work = work;
        task.roots.push(Root::new(realm, realm.to_js_value()));
        (task.roots).extend(values.iter().map(|&value| Root::new(realm, value)));
        TaskId {
            index,
            generation: task.generation,
        }
    }

    fn release(&mut self, index: u32) {
        let task = &mut self.tasks[index as usize];
        task.generation = (task.generation + 1) % TaskId::GENERATIONS;
        task.place = Place::Free;
        task.roots.clear();
        self.free.push(index);
    }

    /// The result is to be dropped once the state is no longer borrowed.
    fn cancel(&mut self, index: u32) -> Work {
        let task = &mut self.tasks[index as usize];
        let work = core::mem::replace(&mut task.work, Work::Call);
        task.is_canceled = true;
        task.roots.clear();
        if let Place::Waiting(at) = task.place {
            self.remove_timer(at);
            self.release(index);
        }
        work
    }

    fn is_before(&self, first: u32, second: u32) -> bool {
        let (first, second) = (&self.tasks[first as usize], &self.tasks[second as usize]);
        first.time < second.time || (first.time == second.time && first.order < second.order)
    }

    fn put_timer(&mut self, at: usize, index: u32) {
        self.timers[at] = index;
        self.tasks[index as usize].place = Place::Waiting(at as u32);
    }

    fn settle(&mut self, index: u32, mut at: usize) {
        while at > 0 {
            let parent = (at - 1) / 2;
            if !self.is_before(index, self.timers[parent]) {
                break;
            }
            self.put_timer(at, self.timers[parent]);
            at = parent;
        }
        loop {
            let mut child = at * 2 + 1;
            if child >= self.timers.len() {
                break;
            }
            if child + 1 < self.timers.len()
                && self.is_before(self.timers[child + 1], self.timers[child])
            {
                child += 1;
            }
            if !self.is_before(self.timers[child], index) {
                break;
            }
            self.put_timer(at, self.timers[child]);
            at = child;
        }
        self.put_timer(at, index);
    }

    fn remove_timer(&mut self, at: u32) {
        if let Some(last) = self.timers.pop()
            && (at as usize) < self.timers.len()
        {
            self.settle(last, at as usize);
        }
    }

    fn first_deadline(&self) -> Option<f64> {
        Some(self.tasks[*self.timers.first()? as usize].time)
    }

    /// The host is still answering what the page has asked for, so a frame would soon be out of date.
    fn is_host_busy(&self, now: f64) -> bool {
        if now <= self.hurry_until || now <= self.scrolls_until {
            return false;
        }
        let Some(busy_since) = self.busy_since else {
            return self.has(Priority::Host);
        };
        let interval = match now < LAUNCH_DURATION && !self.has_had_input {
            true => BUSY_INTERVAL_AT_LAUNCH,
            false => BUSY_INTERVAL,
        };
        (self.has(Priority::Host) || self.has(Priority::Visible)) && now - busy_since < interval
    }

    fn is_frame_due(&self, now: f64) -> FrameIsDue {
        if self.stale.is_empty() || self.is_suspended || self.is_host_busy(now) {
            return FrameIsDue::No;
        }
        let since_last = now - self.last_frame;
        if self.has(Priority::Blocking) || self.has(Priority::Visible) || Bun__hasLocalMessages() {
            let since_input = now - (self.hurry_until - HURRY_DURATION);
            return if since_last < frame_interval() {
                FrameIsDue::No
            } else if now - self.stale_since >= frame_interval() {
                FrameIsDue::Yes
            } else if (frame_interval()..HURRY_DURATION).contains(&since_input)
                && self.hurried_frames_left > 0
                && !self.was_put_off
            {
                FrameIsDue::IfAwaited
            } else {
                FrameIsDue::No
            };
        }
        if since_last > frame_interval() + 1.0 {
            FrameIsDue::Yes
        } else if self.hurried_frames_left == 0 || now > self.hurry_until {
            FrameIsDue::No
        } else {
            FrameIsDue::IfAwaited
        }
    }

    fn next_task(&mut self, now: f64) -> Option<u32> {
        use Priority::*;
        if self.is_suspended {
            return self.shift(Host);
        }
        if self.has(Blocking) {
            return self.shift(Blocking);
        }
        if self.has(Host) && now > self.hurry_until {
            self.busy_since.get_or_insert(now);
            return self.shift(Host);
        }
        let Some(visible) = self.first(Visible) else {
            if !self.stale.is_empty() && Bun__hasLocalMessages() {
                return None;
            }
            if self.has(Host) {
                return self.shift(Host);
            }
            return match self.has(Background) && !Bun__hasLocalMessages() {
                true => self.shift(Background),
                false => None,
            };
        };
        match self.first(Host) {
            Some(host) if self.stale.is_empty() && host.order < visible.order => self.shift(Host),
            _ => self.shift(Visible),
        }
    }
}

struct Tasks(RefCell<State>);

impl Default for Tasks {
    fn default() -> Tasks {
        Tasks(RefCell::new(State {
            tasks: Vec::new(),
            free: Vec::new(),
            queues: Default::default(),
            timers: Vec::new(),
            stale: Vec::new(),
            after_microtasks: Vec::new(),
            next_order: 0,
            is_pump_queued: false,
            is_suspended: false,
            has_had_input: false,
            hurried_frames_left: 0,
            scrolls_until: 0.0,
            stale_since: 0.0,
            was_put_off: false,
            has_to_ask_display: false,
            last_frame: 0.0,
            hurry_until: 0.0,
            busy_since: None,
            alarm_time: f64::INFINITY,
            alarm: None,
            keep_alive: JsKeepAlive::default(),
        }))
    }
}

thread_local! {
    static TASKS: Cell<*mut Tasks> = const { Cell::new(core::ptr::null_mut()) };
}

fn tasks_of(vm: &VirtualMachine) -> &Tasks {
    extern "C" fn destroy(tasks: *mut c_void) {
        TASKS.set(core::ptr::null_mut());
        // SAFETY: made below. No script is running, so nothing borrows it.
        drop(unsafe { bun_core::heap::take(tasks.cast::<Tasks>()) });
    }
    if TASKS.get().is_null() {
        TASKS.set(bun_core::heap::into_raw(Box::default()));
        // SAFETY: `destroy` takes the box that was just made.
        unsafe { (vm.rare_data()).push_cleanup_hook(vm.global(), TASKS.get().cast(), destroy) };
    }
    // SAFETY: it lasts until the VM of this thread is torn down.
    unsafe { &*TASKS.get() }
}

#[unsafe(no_mangle)]
fn __bun_web_pump(vm: &VirtualMachine) {
    tasks_of(vm).pump(vm);
}

fn now(vm: &VirtualMachine) -> f64 {
    vm.origin_timer.elapsed().as_secs_f64() * 1000.0
}

fn report(realm: &JSGlobalObject, result: JsResult<()>) -> Result<(), bun_jsc::Stopped> {
    result.or_else(|error| bun_jsc::task::report_error_or_terminate(realm, error))
}

fn queue_pump(state: &mut State, vm: &VirtualMachine) {
    if !core::mem::replace(&mut state.is_pump_queued, true) {
        __bun_web_queue_pump(vm);
    }
}

fn set_alarm(state: &mut State, vm: &VirtualMachine, time: f64) {
    state.alarm_time = time;
    state.alarm = Some(later::after((time - now(vm)).ceil(), |global| {
        tasks_of(global.bun_vm()).ring(global.bun_vm());
        Ok(())
    }));
    state.keep_alive.ref_(bun_io::js_vm_ctx());
}

fn stop_alarm_if_idle(state: &mut State) {
    if state.timers.is_empty() {
        state.alarm_time = f64::INFINITY;
        state.alarm = None;
        state.keep_alive.unref(bun_io::js_vm_ctx());
    }
}

fn add_timer(state: &mut State, vm: &VirtualMachine, index: u32, delay: f64) {
    let mut time = now(vm) + delay;
    if delay > PRECISE_DELAY {
        let origin = bun_jsc::virtual_machine_exports::read_origin_timer_start(vm) % 100.0;
        time = ((origin + time - 0.5) / TIMER_ALIGNMENT).ceil() * TIMER_ALIGNMENT - origin;
    }
    state.tasks[index as usize].time = time;
    state.timers.push(index);
    state.settle(index, state.timers.len() - 1);
    if time < state.alarm_time {
        set_alarm(state, vm, time);
    }
}

fn with_state<R>(global: &JSGlobalObject, f: impl FnOnce(&mut State, &VirtualMachine) -> R) -> R {
    let vm = global.bun_vm();
    f(&mut tasks_of(vm).0.borrow_mut(), vm)
}

thread_local! {
    /// While tasks are running.
    static DISCARDED: RefCell<Option<Vec<Box<dyn Any>>>> = const { RefCell::new(None) };
}

/// Drops what takes long to drop, once that holds up no task.
pub fn discard(it: Box<dyn Any>) {
    let mut it = Some(it);
    // It is gone by the time the heap of a thread that ends is swept.
    let _ = DISCARDED.try_with(|later| {
        if let Some(later) = &mut *later.borrow_mut() {
            later.extend(it.take());
        }
    });
}

pub fn post(realm: &JSGlobalObject, priority: Priority, work: Work, values: &[JSValue]) -> TaskId {
    with_state(realm, |state, vm| {
        let id = state.create(realm, work, values);
        state.queues[priority as usize].push_back(id.index);
        queue_pump(state, vm);
        id
    })
}

/// `delay` is in milliseconds. [`Work::Once`] cannot repeat.
pub fn post_delayed(
    realm: &JSGlobalObject,
    delay: f64,
    repeats: bool,
    work: Work,
    values: &[JSValue],
) -> TaskId {
    if delay <= 0.0 && !repeats {
        return post(realm, Priority::Visible, work, values);
    }
    debug_assert!(!repeats || !matches!(work, Work::Once(_)));
    with_state(realm, |state, vm| {
        let delay = delay.max(1.0);
        let id = state.create(realm, work, values);
        if repeats {
            state.tasks[id.index as usize].interval = delay;
        }
        add_timer(state, vm, id.index, delay);
        id
    })
}

/// Does nothing if the task has run.
pub fn cancel(global: &JSGlobalObject, id: TaskId) {
    with_state(global, |state, _| {
        let task = state.tasks.get(id.index as usize)?;
        if task.generation != id.generation || task.place == Place::Free {
            return None;
        }
        let work = state.cancel(id.index);
        stop_alarm_if_idle(state);
        Some(work)
    });
}

/// From the next time on.
pub(crate) fn set_interval(global: &JSGlobalObject, id: TaskId, interval: f64) {
    with_state(global, |state, _| {
        let task = &mut state.tasks[id.index as usize];
        if task.generation == id.generation {
            task.interval = interval;
        }
    });
}

pub(crate) fn cancel_tasks_of(realm: &JSGlobalObject) {
    with_state(realm, |state, _| {
        let mut canceled = Vec::new();
        for index in 0..state.tasks.len() {
            let task = &state.tasks[index];
            let stops = task.place == Place::Running || !matches!(task.work, Work::Call);
            if core::ptr::eq(task.realm, realm) && task.place != Place::Free && stops {
                canceled.push(state.cancel(index as u32));
            }
        }
        stop_alarm_if_idle(state);
        canceled
    });
}

/// Those that have `subject` for their first value.
pub fn cancel_delayed_tasks_about(realm: &JSGlobalObject, subject: JSValue) {
    with_state(realm, |state, _| {
        let is_about = |it: &Task| it.roots.get(1).is_some_and(|it| it.value == subject);
        let mut found = state.timers.clone();
        found.retain(|it| is_about(&state.tasks[*it as usize]));
        let canceled: Vec<Work> = found.into_iter().map(|it| state.cancel(it)).collect();
        stop_alarm_if_idle(state);
        canceled
    });
}

pub fn set_suspended(global: &JSGlobalObject, is_suspended: bool) {
    with_state(global, |state, vm| {
        state.is_suspended = is_suspended;
        queue_pump(state, vm);
    });
}

pub fn is_suspended(global: &JSGlobalObject) -> bool {
    with_state(global, |state, _| state.is_suspended)
}

pub fn wants_frame(global: &JSGlobalObject, canvas: JSValue, steps: &'static Canvas) {
    with_state(global, |state, vm| {
        if state.stale.iter().any(|it| it.0.get() == canvas) {
            return queue_pump(state, vm);
        }
        if state.stale.is_empty() {
            state.stale_since = now(vm);
        }
        state.stale.push((Strong::create(canvas, global), steps));
        queue_pump(state, vm);
    });
}

pub fn wants_no_frame(global: &JSGlobalObject, canvas: JSValue) {
    with_state(global, |state, _| {
        state.stale.retain(|it| it.0.get() != canvas);
    });
}

/// Whether a frame would probably be rendered before the display can answer.
pub fn is_between_frames(global: &JSGlobalObject) -> bool {
    with_state(global, |state, vm| {
        let is_so = now(vm) - state.last_frame > frame_interval() + 1.0;
        state.has_to_ask_display |= is_so;
        is_so
    })
}

pub fn has_ready_tasks(global: &JSGlobalObject) -> bool {
    with_state(global, |state, _| {
        state.has(Priority::Blocking) || state.has(Priority::Visible) || Bun__hasLocalMessages()
    })
}

pub fn begins_frame(global: &JSGlobalObject, canvas: JSValue) {
    with_state(global, |state, vm| {
        state.last_frame = now(vm);
        state.busy_since = None;
        state.stale.retain(|it| it.0.get() != canvas);
    });
}

pub fn can_frame_wait(global: &JSGlobalObject) -> bool {
    with_state(global, |state, vm| state.is_host_busy(now(vm)))
}

pub fn scrolls(global: &JSGlobalObject) {
    with_state(global, |state, vm| {
        state.scrolls_until = now(vm) + HURRY_DURATION;
    });
}

/// For what the user has just done: the frames that follow from it do not wait for the display.
pub fn hurry(global: &JSGlobalObject, is_input: bool) {
    with_state(global, |state, vm| {
        let now = now(vm);
        state.has_had_input |= is_input;
        if state.has_had_input || now >= LAUNCH_DURATION {
            state.hurry_until = now + HURRY_DURATION;
            state.hurried_frames_left = HURRIED_FRAMES;
        }
    });
}

/// How many milliseconds it takes until something else is to be done.
pub fn idle_time(global: &JSGlobalObject) -> f64 {
    with_state(global, |state, vm| {
        let now = now(vm);
        let until_timer = (state.first_deadline()).map_or(LONGEST_IDLE_PERIOD, |time| {
            (time - now).min(LONGEST_IDLE_PERIOD)
        });
        match state.stale.is_empty() {
            true => until_timer,
            false => until_timer.min(state.last_frame + frame_interval() - 2.0 - now),
        }
    })
}

pub fn render(global: &JSGlobalObject) {
    render_stale(global, false);
}

fn render_stale(global: &JSGlobalObject, may_wait: bool) {
    for (canvas, steps) in with_state(global, |state, _| core::mem::take(&mut state.stale)) {
        (steps.render)(global, canvas.get(), may_wait);
    }
}

pub fn after_microtasks(global: &JSGlobalObject, callback: JSValue) {
    with_state(global, |state, vm| {
        (state.after_microtasks).push(Strong::create(callback, global));
        queue_pump(state, vm);
    });
}

pub fn finish_checkpoint(global: &JSGlobalObject) {
    for callback in with_state(global, |state, _| {
        core::mem::take(&mut state.after_microtasks)
    }) {
        let result = callback.get().call(global, JSValue::UNDEFINED, &[]);
        if report(global, result.map(drop)).is_err() {
            break;
        }
    }
}

impl Tasks {
    fn takes_hurried_frame(&self) -> bool {
        let state = &mut *self.0.borrow_mut();
        let is_awaited =
            (state.stale.iter()).any(|(canvas, steps)| (steps.is_awaited)(canvas.get()));
        state.hurried_frames_left -= u8::from(is_awaited);
        is_awaited
    }

    fn run(&self, vm: &VirtualMachine, index: u32) {
        let (realm, work, roots) = {
            let state = &mut *self.0.borrow_mut();
            if state.tasks[index as usize].is_canceled {
                return state.release(index);
            }
            // A dialog runs the event loop inside of the task.
            if state.has_tasks() {
                queue_pump(state, vm);
            }
            let task = &mut state.tasks[index as usize];
            task.place = Place::Running;
            let work = core::mem::replace(&mut task.work, Work::Call);
            (task.realm, work, core::mem::take(&mut task.roots))
        };
        // SAFETY: `roots` keeps it alive.
        let realm = unsafe { &*realm };
        let values: SmallVec<[JSValue; 6]> = roots[1..].iter().map(|root| root.value).collect();
        let (result, again) = match work {
            Work::Call => {
                let result = match values.split_first() {
                    Some((it, rest)) if it.is_callable() => {
                        it.call(realm, JSValue::UNDEFINED, rest).map(drop)
                    }
                    _ => Ok(()),
                };
                (result, Work::Call)
            }
            Work::Once(steps) => (steps(realm, &values), Work::Call),
            Work::Function(function, word) => (function(realm, word, &values), work),
        };
        let _ = report(realm, result);

        let state = &mut *self.0.borrow_mut();
        let task = &mut state.tasks[index as usize];
        task.roots = roots;
        let interval = task.interval;
        if interval == 0.0 || task.is_canceled {
            return state.release(index);
        }
        task.work = again;
        add_timer(state, vm, index, interval);
    }

    fn pump(&self, vm: &VirtualMachine) {
        let global = vm.global();
        let _entered = vm.event_loop().enter_scope();
        let context = Bun__exchangeAsyncContext(global, JSValue::UNDEFINED);
        let outer = DISCARDED.replace(Some(Vec::new()));
        self.run_slice(vm);
        Bun__exchangeAsyncContext(global, context);
        drop(DISCARDED.replace(outer));
        let state = &mut *self.0.borrow_mut();
        let has_waited = !state.is_pump_queued || now(vm) - state.stale_since >= SLICE;
        if state.has_to_ask_display && has_waited {
            state.has_to_ask_display = false;
            (state.stale.iter()).for_each(|(canvas, steps)| (steps.ask_display)(canvas.get()));
        }
    }

    fn run_slice(&self, vm: &VirtualMachine) {
        let global = vm.global();
        finish_checkpoint(global);
        let start = now(vm);
        let mut time = start;
        self.0.borrow_mut().is_pump_queued = false;
        while time - start < SLICE {
            if !vm.script_allowed() {
                return;
            }
            if !self.0.borrow().is_suspended {
                __bun_web_handle_input(vm);
            }
            let frame = self.0.borrow().is_frame_due(time);
            let renders = match frame {
                FrameIsDue::No => false,
                FrameIsDue::Yes => true,
                FrameIsDue::IfAwaited => self.takes_hurried_frame(),
            };
            if renders {
                render_stale(global, true);
            } else {
                let next = self.0.borrow_mut().next_task(time);
                let Some(index) = next else {
                    let state = &mut *self.0.borrow_mut();
                    if (!state.stale.is_empty() || state.has_tasks()) && Bun__hasLocalMessages() {
                        queue_pump(state, vm);
                    }
                    return;
                };
                self.run(vm, index);
            }
            vm.drain_microtasks();
            finish_checkpoint(global);
            let before = core::mem::replace(&mut time, now(vm));
            let state = &mut *self.0.borrow_mut();
            state.was_put_off = renders;
            if time - before > BUSY_INTERVAL && !state.has_had_input && time < LAUNCH_DURATION {
                state.busy_since = None;
            }
        }
        queue_pump(&mut self.0.borrow_mut(), vm);
    }

    fn ring(&self, vm: &VirtualMachine) {
        {
            let state = &mut *self.0.borrow_mut();
            let now = now(vm);
            while state.first_deadline().is_some_and(|time| time <= now) {
                let index = state.timers[0];
                state.remove_timer(0);
                let order = state.take_order();
                let task = &mut state.tasks[index as usize];
                task.place = Place::Queued;
                task.order = order;
                state.queues[Priority::Visible as usize].push_back(index);
            }
            match state.first_deadline() {
                Some(time) => set_alarm(state, vm, time),
                None => stop_alarm_if_idle(state),
            }
        }
        self.pump(vm);
    }
}
