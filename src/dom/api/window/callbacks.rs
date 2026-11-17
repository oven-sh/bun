//! <https://html.spec.whatwg.org/#animation-frames> and <https://w3c.github.io/requestidlecallback/>

use bun_jsc::JsResult;
use bun_web::tasks::{self, Priority, Work};

use super::*;

/// The callbacks are in a list of the window, in the same order.
struct Waiting<T> {
    entries: RefCell<Vec<(u32, T)>>,
    last_handle: Cell<u32>,
    /// What is done with is `undefined` meanwhile.
    is_running: Cell<bool>,
}

impl<T> Default for Waiting<T> {
    fn default() -> Self {
        Waiting {
            entries: Default::default(),
            last_handle: 0.into(),
            is_running: false.into(),
        }
    }
}

impl<T: Copy> Waiting<T> {
    fn is_empty(&self) -> bool {
        self.entries.borrow().is_empty()
    }

    fn add<'a>(
        &self,
        heap: &JsHeap<'a>,
        callbacks: List<'a>,
        callback: JsLocal<'a, Callable>,
        about: T,
    ) -> u32 {
        let handle = self.last_handle.get() + 1;
        self.last_handle.set(handle);
        callbacks.push(heap, callback.to_js());
        self.entries.borrow_mut().push((handle, about));
        handle
    }

    fn cancel<'a>(&self, heap: &JsHeap<'a>, callbacks: List<'a>, handle: u32) {
        let mut entries = self.entries.borrow_mut();
        let Ok(at) = entries.binary_search_by_key(&handle, |it| it.0) else {
            return;
        };
        if self.is_running.get() {
            callbacks.set(heap, at as u32, JSValue::UNDEFINED);
        } else {
            entries.remove(at);
            callbacks.remove_range(heap, at as u32, 1);
        }
    }

    /// Those that are added meanwhile go on waiting.
    fn run<'a>(
        &self,
        cx: Cx<'_, 'a>,
        callbacks: List<'a>,
        is_due: impl Fn(T) -> bool,
        mut run: impl FnMut(Cx<'_, 'a>, JSValue, T),
    ) {
        if self.is_running.replace(true) {
            return;
        }
        for at in 0..callbacks.len() {
            let (callback, about) = (callbacks.get(at), self.entries.borrow()[at as usize].1);
            if !callback.is_undefined() && is_due(about) {
                callbacks.set(&cx.heap, at, JSValue::UNDEFINED);
                run(cx, callback, about);
            }
        }
        let (mut from, mut to) = (0, 0);
        self.entries.borrow_mut().retain(|_| {
            let callback = callbacks.get(from);
            from += 1;
            if !callback.is_undefined() {
                callbacks.set(&cx.heap, to, callback);
                to += 1;
            }
            !callback.is_undefined()
        });
        callbacks.remove_range(&cx.heap, to, from - to);
        self.is_running.set(false);
    }
}

pub(super) fn list<'a>(
    heap: &JsHeap<'a>,
    held: Option<JSValue>,
    hold: impl FnOnce(JSValue),
) -> List<'a> {
    held.map(List::from_value).unwrap_or_else(|| {
        let made = List::new(heap);
        hold(made.to_js());
        made
    })
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum FramePhase {
    /// As a task would.
    BeforeEvents,
    AfterEvents,
}

/// How many callbacks in a row have each requested the next one.
type Generation = u8;

const OF_LOOP: Generation = tasks::HURRIED_FRAMES;

#[derive(Default)]
pub(super) struct Frames {
    waiting: Waiting<(FramePhase, Generation)>,
    next_generation: Cell<Generation>,
}

impl Window {
    fn frame_callbacks<'a>(&'a self, heap: &JsHeap<'a>) -> List<'a> {
        list(heap, js_DomWindow::frame_callbacks(self), |it| {
            js_DomWindow::set_frame_callbacks(self, it)
        })
    }

    pub(crate) fn request_animation_frame<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        callback: JsLocal<'a, Callable>,
        phase: JsLocal<'a>,
    ) -> u32 {
        let is_early = phase.as_string().is_some_and(|it| {
            DomString::from_js_string(&cx.heap, it).is_ok_and(|it| it.eq_str("before-events"))
        });
        let phase = if is_early {
            FramePhase::BeforeEvents
        } else {
            FramePhase::AfterEvents
        };
        let handle = self.frames.waiting.add(
            &cx.heap,
            self.frame_callbacks(&cx.heap),
            callback,
            (phase, self.frames.next_generation.get()),
        );
        self.keep_frame_timer_alive(&cx.heap);
        match is_early {
            true => self.schedule_early_callbacks(cx),
            false => self.document().invalidate(cx),
        }
        handle
    }

    pub(crate) fn cancel_animation_frame<'a>(&'a self, heap: &JsHeap<'a>, handle: u32) {
        self.frames
            .waiting
            .cancel(heap, self.frame_callbacks(heap), handle);
        self.frame_callback_was_canceled(heap);
    }

    pub(crate) fn has_frame_callbacks(&self) -> bool {
        !self.frames.waiting.is_empty()
    }

    /// Those of a loop only wait for time to pass.
    pub(super) fn has_awaited_frame_callbacks(&self) -> bool {
        self.frames
            .waiting
            .entries
            .borrow()
            .iter()
            .any(|it| it.1.1 < OF_LOOP)
    }

    pub(super) fn has_callbacks_of(&self, phase: FramePhase) -> bool {
        self.frames
            .waiting
            .entries
            .borrow()
            .iter()
            .any(|it| it.1.0 == phase)
    }

    /// Whether there were any.
    pub(super) fn run_early_frame_callbacks<'a>(&'a self, cx: Cx<'_, 'a>, time: f64) -> bool {
        let has_any = self.has_callbacks_of(FramePhase::BeforeEvents);
        if has_any {
            self.run_frame_callbacks(cx, FramePhase::BeforeEvents, time);
        }
        has_any
    }

    /// `time` is relative to the time origin.
    pub(crate) fn run_frame_callbacks<'a>(&'a self, cx: Cx<'_, 'a>, phase: FramePhase, time: f64) {
        if self.has_frame_callbacks() {
            let is_due = |it: (_, _)| phase == FramePhase::AfterEvents || it.0 == phase;
            let callbacks = self.frame_callbacks(&cx.heap);
            self.frames
                .waiting
                .run(cx, callbacks, is_due, |cx, callback, (_, generation)| {
                    self.frames
                        .next_generation
                        .set(generation.saturating_add(1));
                    events::call_back(
                        cx,
                        Some(self),
                        callback,
                        self.window(),
                        &[JSValue::js_number(time)],
                    );
                    self.frames.next_generation.set(0);
                });
        }
    }
}

#[derive(Default)]
pub(super) struct Idle {
    /// With when they have waited for too long.
    waiting: Waiting<f64>,
    is_scheduled: Cell<bool>,
}

pub(crate) struct IdleDeadline {
    end: f64,
    did_timeout: bool,
}

impl IdleDeadline {
    pub(crate) fn time_remaining(&self) -> f64 {
        (self.end - events::now()).max(0.0)
    }

    pub(crate) fn get_did_timeout(&self) -> bool {
        self.did_timeout
    }
}

const PAUSE_BETWEEN_IDLE_PERIODS: f64 = 2.0;

fn start_idle_period(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    events::from_event_loop::<Window>(global, window[0], |cx, window| {
        window.run_idle_callbacks(cx)
    });
    Ok(())
}

fn await_idle_period(global: &JSGlobalObject, _: u64, window: &[JSValue]) -> JsResult<()> {
    tasks::post(
        global,
        Priority::Background,
        Work::Function(start_idle_period, 0),
        window,
    );
    Ok(())
}

impl Window {
    fn idle_callbacks<'a>(&'a self, heap: &JsHeap<'a>) -> List<'a> {
        list(heap, js_DomWindow::idle_callbacks(self), |it| {
            js_DomWindow::set_idle_callbacks(self, it)
        })
    }

    pub(crate) fn request_idle_callback<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        callback: JsLocal<'a, Callable>,
        options: &IdleRequestOptions,
    ) -> u32 {
        let latest = if options.timeout == 0 {
            f64::INFINITY
        } else {
            events::now() + f64::from(options.timeout)
        };
        let handle = self
            .idle
            .waiting
            .add(heap, self.idle_callbacks(heap), callback, latest);
        if !self.idle.is_scheduled.replace(true) {
            tasks::post(
                global_of(self.realm(heap)),
                Priority::Background,
                Work::Function(start_idle_period, 0),
                &[self.to_js()],
            );
        }
        handle
    }

    pub(crate) fn cancel_idle_callback<'a>(&'a self, heap: &JsHeap<'a>, handle: u32) {
        self.idle
            .waiting
            .cancel(heap, self.idle_callbacks(heap), handle);
    }

    fn run_idle_callbacks<'a>(&'a self, cx: Cx<'_, 'a>) {
        let start = events::now();
        let end = start + tasks::idle_time(cx.global());
        self.idle.is_scheduled.set(false);
        let callbacks = self.idle_callbacks(&cx.heap);
        self.idle.waiting.run(
            cx,
            callbacks,
            |latest| latest <= start || events::now() < end,
            |cx, callback, latest| {
                let did_timeout = latest <= start;
                let deadline = IdleDeadline {
                    end: if did_timeout { start } else { end },
                    did_timeout,
                };
                let deadline = js_IdleDeadline::create(self.realm(&cx.heap), deadline).to_js();
                events::call_back(cx, Some(self), callback, self.window(), &[deadline]);
            },
        );
        if !self.idle.waiting.is_empty() && !self.idle.is_scheduled.replace(true) {
            let delay = (end - events::now()).max(0.0) + PAUSE_BETWEEN_IDLE_PERIODS;
            tasks::post_delayed(
                cx.global(),
                delay,
                false,
                Work::Function(await_idle_period, 0),
                &[self.to_js()],
            );
        }
    }
}
