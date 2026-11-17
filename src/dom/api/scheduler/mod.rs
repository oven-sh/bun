//! <https://wicg.github.io/scheduling-apis/>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{
    Callable, CallbackBody, JsHeap, JsInterface, JsList, JsLocal, JsScope, Result,
};
use bun_jsc::{
    AbortSignal, JSGlobalObject, JSObject, JSPromise, JSValue, JsResult, Weak, call_zero_is_throw,
};
use bun_web::realm::Realm;
use bun_web::tasks::{self, Priority, Work};

use crate::api::core::{Atom, DomError, List, atom, dom_error, global_of};
use crate::api::events::{self, Event, EventInit, Trusted, WindowTarget};
use crate::generated_bindgen::scheduler::*;

type Cx<'r, 'a> = &'r mut JsScope<'a>;
type Signal<'a> = JsLocal<'a, AbortSignal>;

unsafe extern "C" {
    safe fn Bun__DOM__createAbortController(
        global: &JSGlobalObject,
        new_target: JSValue,
        behind: JSValue,
    ) -> JSValue;
    safe fn Bun__DOM__signalOfController(global: &JSGlobalObject, controller: JSValue) -> JSValue;
    safe fn Bun__DOM__putBehindSignal(
        global: &JSGlobalObject,
        signal: JSValue,
        prototype: JSValue,
        behind: JSValue,
    );
    safe fn Bun__DOM__behindSignal(global: &JSGlobalObject, signal: JSValue) -> JSValue;
    safe fn Bun__DOM__priorityChangeHandler(signal: JSValue) -> JSValue;
    safe fn Bun__DOM__setPriorityChangeHandler(signal: JSValue, handler: JSValue);
    safe fn Bun__DOM__dispatchToSignal(global: &JSGlobalObject, signal: JSValue, event: JSValue);
    safe fn Bun__DOM__hearsOfPriorityChanges(signal: JSValue) -> bool;
}

pub(crate) struct TaskSignal {
    priority: Cell<TaskPriority>,
    is_fixed: bool,
    is_changing: Cell<bool>,
    dependents: RefCell<Vec<Weak<()>>>,
}

impl TaskSignal {
    fn new<'a>(
        heap: &JsHeap<'a>,
        signal: JSValue,
        priority: TaskPriority,
        is_fixed: bool,
    ) -> &'a TaskSignal {
        let made = TaskSignal {
            priority: priority.into(),
            is_fixed,
            is_changing: false.into(),
            dependents: Default::default(),
        };
        let made = js_TaskSignal::create(heap, made);
        js_TaskSignal::set_signal(made, signal);
        Bun__DOM__putBehindSignal(
            global_of(heap),
            signal,
            js_TaskSignal::CLASS.prototype(heap),
            made.to_js(),
        );
        made
    }

    fn behind<'a>(heap: &JsHeap<'a>, signal: JSValue) -> Option<&'a TaskSignal> {
        TaskSignal::from_js(heap, Bun__DOM__behindSignal(global_of(heap), signal))
    }

    fn signal(&self) -> JSValue {
        js_TaskSignal::signal(self).expect("set when it is made")
    }

    /// <https://wicg.github.io/scheduling-apis/#create-a-dependent-task-signal>
    pub(crate) fn any<'a>(
        cx: Cx<'_, 'a>,
        signals: JsList<'a, JsLocal<'a, JSObject>>,
        init: &TaskSignalAnyInit<'a>,
    ) -> Result<'a, JSValue> {
        let heap = &cx.heap;
        let (priority, source) = match init.priority {
            None => (TaskPriority::UserVisible, None),
            Some(PriorityOrSignal::Priority(it)) => (it, None),
            Some(PriorityOrSignal::Signal(it)) => {
                let other = TaskSignal::behind(heap, it.to_js()).ok_or_else(|| {
                    heap.type_error(format_args!("The priority is not a 'TaskSignal'."))
                })?;
                (
                    other.priority.get(),
                    (!other.is_fixed).then(|| js_TaskSignal::source(other).unwrap_or(other)),
                )
            }
        };
        let signals: Vec<Signal<'a>> = signals
            .iter()
            .filter_map(|it| JsLocal::new(heap, it.to_js()).as_abort_signal())
            .collect();
        let made = TaskSignal::new(
            heap,
            heap.create_dependent_signal(&signals).to_js(),
            priority,
            source.is_none(),
        );
        if let Some(source) = source {
            js_TaskSignal::set_source(made, Some(source));
            let mut dependents = source.dependents.borrow_mut();
            if dependents.len() == dependents.capacity() {
                dependents.retain(|it| it.get().is_some());
            }
            dependents.push(Weak::create_passive(made.to_js(), global_of(heap)));
        }
        Ok(made.signal())
    }

    pub(crate) fn get_priority(&self) -> TaskPriority {
        self.priority.get()
    }

    pub(crate) fn get_onprioritychange(&self, _: &JsHeap<'_>) -> JSValue {
        Bun__DOM__priorityChangeHandler(self.signal())
    }

    pub(crate) fn set_onprioritychange<'a>(&'a self, _: &JsHeap<'a>, handler: JsLocal<'a>) {
        Bun__DOM__setPriorityChangeHandler(self.signal(), handler.to_js());
    }

    fn is_followed_by<'a>(&'a self, heap: &JsHeap<'a>, scheduler: &'a Scheduler) {
        let all = js_TaskSignal::schedulers(self).map_or_else(|| List::new(heap), List::from_value);
        if !all.contains(scheduler.to_js()) {
            all.push(heap, scheduler.to_js());
            js_TaskSignal::set_schedulers(self, all.to_js());
        }
    }

    /// <https://wicg.github.io/scheduling-apis/#tasksignal-signal-priority-change>
    fn change_priority<'a>(&'a self, cx: Cx<'_, 'a>, priority: TaskPriority) -> Result<'a, ()> {
        if self.is_changing.get() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "The priority is already changing.",
            ));
        }
        let previous_priority = self.priority.replace(priority);
        if previous_priority == priority {
            return Ok(());
        }
        self.is_changing.set(true);
        let schedulers = js_TaskSignal::schedulers(self)
            .map(List::from_value)
            .into_iter()
            .flat_map(List::values);
        schedulers
            .filter_map(|it| Scheduler::from_js(&cx.heap, it))
            .for_each(|it| it.move_tasks(&cx.heap, self, previous_priority));
        if Bun__DOM__hearsOfPriorityChanges(self.signal()) {
            let base = Event::base(atom!("prioritychange"), EventInit::default(), Trusted::Yes);
            let event = js_TaskPriorityChangeEvent::create(
                self.realm(&cx.heap),
                TaskPriorityChangeEvent {
                    base,
                    previous_priority,
                },
            );
            let global = cx.global();
            if bun_jsc::from_js_host_call_generic(global, || {
                Bun__DOM__dispatchToSignal(global, self.signal(), event.to_js())
            })
            .is_err()
            {
                global.clear_exception_except_termination();
            }
        }
        let dependents = List::new(&cx.heap);
        self.dependents
            .borrow()
            .iter()
            .filter_map(Weak::get)
            .for_each(|it| dependents.push(&cx.heap, it));
        for dependent in dependents.values() {
            TaskSignal::from_js(&cx.heap, dependent).map(|it| it.change_priority(cx, priority));
        }
        self.is_changing.set(false);
        Ok(())
    }
}

impl TaskController {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        new_target: JsLocal<'a, JSObject>,
        init: &TaskControllerInit,
    ) -> Result<'a, JSValue> {
        let (made, global) = (
            js_TaskController::create(&cx.heap, Default::default()),
            cx.global(),
        );
        let controller = call_zero_is_throw(global, || {
            Bun__DOM__createAbortController(global, new_target.to_js(), made.to_js())
        })?;
        let signal = Bun__DOM__signalOfController(global, controller);
        js_TaskController::set_signal(
            made,
            Some(TaskSignal::new(&cx.heap, signal, init.priority, false)),
        );
        Ok(controller)
    }

    pub(crate) fn set_priority<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        priority: TaskPriority,
    ) -> Result<'a, ()> {
        js_TaskController::signal(self)
            .expect("set when it is made")
            .change_priority(cx, priority)
    }
}

#[repr(C)]
pub(crate) struct TaskPriorityChangeEvent {
    pub(crate) base: Event,
    previous_priority: TaskPriority,
}

impl TaskPriorityChangeEvent {
    pub(crate) fn constructor(kind: Atom, init: &TaskPriorityChangeEventInit) -> Self {
        let base = Event::base(
            kind,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        Self {
            base,
            previous_priority: init.previous_priority,
        }
    }

    pub(crate) fn get_previous_priority(&self) -> TaskPriority {
        self.previous_priority
    }
}

pub(crate) struct ScheduledTask {
    /// Unless it has a source.
    priority: TaskPriority,
    order: Cell<u64>,
    abort_algorithm: Cell<u32>,
}

impl ScheduledTask {
    fn priority(&self) -> TaskPriority {
        js_ScheduledTask::source(self).map_or(self.priority, TaskSignal::get_priority)
    }

    fn signal<'a>(&'a self, heap: &JsHeap<'a>) -> Option<Signal<'a>> {
        JsLocal::new(heap, js_ScheduledTask::signal(self)?).as_abort_signal()
    }

    fn promise<'a>(&'a self, heap: &JsHeap<'a>) -> JsLocal<'a, JSPromise> {
        js_ScheduledTask::promise(self)
            .and_then(|it| JsLocal::new(heap, it).as_promise())
            .expect("set when it is made")
    }

    fn queue(&self) -> Queue {
        Queue::of(self.priority(), js_ScheduledTask::callback(self).is_none())
    }
}

/// A continuation goes before the tasks of the same priority.
#[derive(Clone, Copy)]
struct Queue(u32);

impl Queue {
    const COUNT: u32 = 6;

    fn of(priority: TaskPriority, is_continuation: bool) -> Queue {
        Queue(priority as u32 * 2 + u32::from(!is_continuation))
    }
}

#[derive(Default)]
pub(crate) struct Scheduler {
    next_order: Cell<u64>,
}

fn run_next(global: &JSGlobalObject, queue: u64, values: &[JSValue]) -> JsResult<()> {
    events::from_event_loop(global, values[0], |cx, _: &WindowTarget| {
        let Some(scheduler) = Scheduler::from_js(&cx.heap, values[1]) else {
            return;
        };
        match tasks::is_suspended(cx.global()) {
            true => scheduler.take_turn(&cx.heap, Queue(queue as u32)),
            false => scheduler.run_next(cx, Queue(queue as u32)),
        }
    });
    Ok(())
}

fn enqueue_delayed(global: &JSGlobalObject, _: u64, values: &[JSValue]) -> JsResult<()> {
    events::from_event_loop(global, values[0], |cx, _: &WindowTarget| {
        if let Some((scheduler, task)) =
            Scheduler::from_js(&cx.heap, values[1]).zip(ScheduledTask::from_js(&cx.heap, values[2]))
        {
            scheduler.enqueue(&cx.heap, task);
        }
    });
    Ok(())
}

impl Scheduler {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, scope: &'a WindowTarget) -> &'a Scheduler {
        let heap = scope.realm(heap);
        let made = js_Scheduler::create(heap, Default::default());
        js_Scheduler::set_scope(made, Some(scope));
        js_Scheduler::set_ends(
            made,
            List::from_fn(heap, Queue::COUNT * 2, |_| JSValue::UNDEFINED).to_js(),
        );
        made
    }

    fn scope(&self) -> &WindowTarget {
        js_Scheduler::scope(self).expect("set when it is made")
    }

    fn ends(&self) -> List<'_> {
        List::from_value(js_Scheduler::ends(self).expect("set when it is made"))
    }

    fn is_stopped(&self, heap: &JsHeap<'_>) -> bool {
        Realm::of(global_of(self.realm(heap))).is_some_and(Realm::is_stopped)
    }

    fn append<'a>(&'a self, heap: &JsHeap<'a>, queue: Queue, task: &'a ScheduledTask) {
        match ScheduledTask::from_js(heap, self.ends().get(queue.0 * 2 + 1)) {
            Some(last) => js_ScheduledTask::set_next(last, Some(task)),
            None => self.ends().set(heap, queue.0 * 2, task.to_js()),
        }
        self.ends().set(heap, queue.0 * 2 + 1, task.to_js());
    }

    fn first<'a>(&'a self, heap: &JsHeap<'a>, queue: Queue) -> Option<&'a ScheduledTask> {
        ScheduledTask::from_js(heap, self.ends().get(queue.0 * 2))
    }

    fn take_first<'a>(&'a self, heap: &JsHeap<'a>, queue: Queue) -> Option<&'a ScheduledTask> {
        let first = self.first(heap, queue)?;
        match js_ScheduledTask::next(first) {
            Some(next) => self.ends().set(heap, queue.0 * 2, next.to_js()),
            None => {
                (0..2).for_each(|end| self.ends().set(heap, queue.0 * 2 + end, JSValue::UNDEFINED))
            }
        }
        js_ScheduledTask::set_next(first, None);
        Some(first)
    }

    /// For whichever task is then the first with the priority of `queue`.
    fn take_turn<'a>(&'a self, heap: &JsHeap<'a>, queue: Queue) {
        if !self.is_stopped(heap) {
            let priority =
                [Priority::Blocking, Priority::Visible, Priority::Background][queue.0 as usize / 2];
            tasks::post(
                global_of(self.realm(heap)),
                priority,
                Work::Function(run_next, queue.0.into()),
                &[self.scope().to_js(), self.to_js()],
            );
        }
    }

    fn enqueue<'a>(&'a self, heap: &JsHeap<'a>, task: &'a ScheduledTask) {
        task.order
            .set(self.next_order.replace(self.next_order.get() + 1));
        js_ScheduledTask::source(task)
            .into_iter()
            .for_each(|it| it.is_followed_by(heap, self));
        self.append(heap, task.queue(), task);
        self.take_turn(heap, task.queue());
    }

    fn move_tasks<'a>(&'a self, heap: &JsHeap<'a>, source: &'a TaskSignal, previous: TaskPriority) {
        for is_continuation in [true, false] {
            let [from, to] =
                [previous, source.get_priority()].map(|it| Queue::of(it, is_continuation));
            let all = List::new(heap);
            while let Some(task) = [self.first(heap, from), self.first(heap, to)]
                .into_iter()
                .zip([from, to])
                .filter_map(|it| Some((it.0?, it.1)))
                .min_by_key(|it| it.0.order.get())
            {
                self.take_first(heap, task.1);
                all.push(heap, task.0.to_js());
            }
            for task in all
                .values()
                .filter_map(|it| ScheduledTask::from_js(heap, it))
            {
                self.append(heap, task.queue(), task);
                if js_ScheduledTask::source(task).is_some_and(|it| core::ptr::eq(it, source)) {
                    self.take_turn(heap, to);
                }
            }
        }
    }

    fn run_next<'a>(&'a self, cx: Cx<'_, 'a>, queue: Queue) {
        let Some(task) = self
            .take_first(&cx.heap, Queue(queue.0 & !1))
            .or_else(|| self.take_first(&cx.heap, Queue(queue.0 | 1)))
        else {
            return;
        };
        let (promise, signal) = (task.promise(&cx.heap), task.signal(&cx.heap));
        if signal.is_some_and(Signal::is_aborted) {
            return;
        }
        if signal.is_some() || task.priority != TaskPriority::UserVisible {
            let forget: CallbackBody = |cx, [scheduler, _], _, _| {
                Scheduler::from_js(&cx.heap, scheduler.to_js())
                    .into_iter()
                    .for_each(|it| js_Scheduler::set_current(it, None));
                Ok(JSValue::UNDEFINED)
            };
            js_Scheduler::set_current(self, Some(task));
            let forget = cx
                .heap
                .create_callback(forget, [self.to_js(), JSValue::UNDEFINED], 0);
            tasks::after_microtasks(cx.global(), forget.to_js());
        }
        events::calling_scripts(cx, |cx, _| {
            _ = match js_ScheduledTask::callback(task).map_or(Ok(JSValue::UNDEFINED), |it| {
                it.call(cx.global(), JSValue::UNDEFINED, &[])
            }) {
                Ok(result) => promise.resolve(cx, result),
                Err(error) => match cx.global().take_error(error) {
                    exception if exception.is_termination_exception() => Ok(()),
                    exception => promise.reject(cx, exception),
                },
            };
        });
        signal
            .into_iter()
            .for_each(|it| it.remove_algorithm(task.abort_algorithm.get()));
    }

    fn schedule<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        (priority, source, signal): (TaskPriority, Option<&'a TaskSignal>, Option<Signal<'a>>),
        callback: Option<JsLocal<'a, Callable>>,
        delay: u64,
    ) -> Result<'a, JSValue> {
        let promise = cx.heap.create_promise();
        if let Some(signal) = signal.filter(|it| it.is_aborted()) {
            let reason = signal.reason(&cx.heap);
            return promise.reject(cx, reason).map(|()| promise.to_js());
        }
        if self.is_stopped(&cx.heap) || self.scope().is_disposed() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The current window is detached.",
            ));
        }
        let task = js_ScheduledTask::create(
            &cx.heap,
            ScheduledTask {
                priority,
                order: 0.into(),
                abort_algorithm: 0.into(),
            },
        );
        js_ScheduledTask::set_promise(task, promise.to_js());
        js_ScheduledTask::set_source(task, source);
        callback
            .into_iter()
            .for_each(|it| js_ScheduledTask::set_callback(task, it.to_js()));
        if let Some(signal) = signal {
            let reject: CallbackBody = |cx, [promise, _], _, reason| {
                promise
                    .as_promise()
                    .expect("a promise")
                    .reject(cx, reason[0].to_js())
                    .map(|()| JSValue::UNDEFINED)
            };
            let reject = cx
                .heap
                .create_callback(reject, [promise.to_js(), JSValue::UNDEFINED], 0);
            js_ScheduledTask::set_signal(task, signal.to_js());
            task.abort_algorithm.set(signal.add_algorithm(cx, reject));
        }
        if delay == 0 {
            self.enqueue(&cx.heap, task);
        } else {
            let values = [self.scope().to_js(), self.to_js(), task.to_js()];
            tasks::post_delayed(
                global_of(self.realm(&cx.heap)),
                delay.min(i32::MAX as u64) as f64,
                false,
                Work::Function(enqueue_delayed, 0),
                &values,
            );
        }
        Ok(promise.to_js())
    }

    pub(crate) fn post_task<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        callback: JsLocal<'a, Callable>,
        options: &SchedulerPostTaskOptions<'a>,
    ) -> Result<'a, JSValue> {
        let signal = options
            .signal
            .and_then(|it| JsLocal::new(&cx.heap, it.to_js()).as_abort_signal());
        let source = signal
            .filter(|_| options.priority.is_none())
            .and_then(|it| TaskSignal::behind(&cx.heap, it.to_js()));
        self.schedule(
            cx,
            (
                options.priority.unwrap_or(TaskPriority::UserVisible),
                source,
                signal,
            ),
            Some(callback),
            options.delay,
        )
    }

    pub(crate) fn yield_to_others<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let inherited = js_Scheduler::current(self).map(|it| {
            (
                it.priority,
                js_ScheduledTask::source(it),
                it.signal(&cx.heap),
            )
        });
        self.schedule(
            cx,
            inherited.unwrap_or((TaskPriority::UserVisible, None, None)),
            None,
            0,
        )
    }
}
