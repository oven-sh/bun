//! What happens around a call to a script.

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsError, JsResult, Strong};
use bun_web::tasks::{self, Priority, Work};
use smallvec::SmallVec;

use super::*;

/// No script is running, so that microtasks run after each callback.
#[thread_local]
static IS_AT_TOP_LEVEL: Cell<bool> = Cell::new(false);

thread_local! {
    static AFTER_MICROTASKS: RefCell<Vec<Strong>> = const { RefCell::new(Vec::new()) };
}

/// In milliseconds, from when the thread has started to run JavaScript.
#[inline]
pub(crate) fn now() -> f64 {
    bun_jsc::virtual_machine_exports::read_origin_timer(VirtualMachine::get()) as f64 / 1e6
}

#[thread_local]
static TIME_OF_INPUT: Cell<Option<f64>> = Cell::new(None);

/// While it lives, the events that the user causes have the time stamp of what the user did.
pub(crate) struct HandlingInput(Option<f64>);

impl HandlingInput {
    pub(crate) fn begin() -> HandlingInput {
        HandlingInput(TIME_OF_INPUT.replace(Some(now())))
    }
}

impl Drop for HandlingInput {
    fn drop(&mut self) {
        TIME_OF_INPUT.set(self.0);
    }
}

#[inline]
pub(super) fn time_of_input() -> Option<f64> {
    TIME_OF_INPUT.get()
}

#[inline]
pub(super) fn is_at_top_level() -> bool {
    IS_AT_TOP_LEVEL.get()
}

#[inline]
pub(crate) fn swap_top_level(is_at_top_level: bool) -> bool {
    IS_AT_TOP_LEVEL.replace(is_at_top_level)
}

pub(crate) fn after_microtasks(cx: Cx<'_, '_>, run: JSValue) {
    AFTER_MICROTASKS.with_borrow_mut(|it| it.push(Strong::create(run, cx.global())));
}

pub(crate) fn drain_microtasks(cx: Cx<'_, '_>) {
    cx.global().bun_vm().drain_microtasks();
    if !AFTER_MICROTASKS.with_borrow(Vec::is_empty) {
        for run in AFTER_MICROTASKS.take() {
            if let Err(error) = run.get().call(cx.global(), JSValue::UNDEFINED, &[]) {
                report(cx, None, error);
            }
        }
    }
}

/// `run` is told whether it has to drain the microtasks after what it calls.
#[inline]
pub(crate) fn calling_scripts<'a>(cx: Cx<'_, 'a>, run: impl FnOnce(Cx<'_, 'a>, bool)) {
    let was_at_top_level = swap_top_level(false);
    run(cx, was_at_top_level);
    swap_top_level(was_at_top_level);
}

pub(crate) fn microtask_checkpoint(cx: Cx<'_, '_>) {
    calling_scripts(cx, |cx, drains| {
        if drains {
            drain_microtasks(cx);
        }
    });
}

/// <https://html.spec.whatwg.org/#report-an-exception>
#[cold]
pub(crate) fn report<'a>(cx: Cx<'_, 'a>, window: Option<&'a WindowTarget>, error: JsError) {
    let exception = cx.global().take_error(error);
    if !exception.is_termination_exception() {
        pending::report(cx, window, exception);
    }
}

/// To the window of `culprit`, a function.
#[cold]
pub(crate) fn report_for(cx: Cx<'_, '_>, culprit: JSValue, error: JsError) {
    let window = WindowTarget::of_callback(&cx.heap, culprit);
    report(cx, window, error);
}

pub(crate) fn report_exception_to<'a>(
    cx: Cx<'_, 'a>,
    window: &'a WindowTarget,
    exception: JSValue,
) {
    window.report_exception(cx, exception, Some(JSValue::ZERO), b"");
}

/// <https://webidl.spec.whatwg.org/#call-a-user-objects-operation>. `None` if there are no other realms.
pub(crate) fn call_operation_in_its_realm<'a>(
    cx: Cx<'_, 'a>,
    object: JSValue,
    name: &str,
    argument: JSValue,
) -> Option<JsResult<JSValue>> {
    let window = super::window::has_frames()
        .then(|| WindowTarget::of_callback(&cx.heap, object))
        .flatten()?;
    let global = global_of(window.realm(&cx.heap));
    let call = || {
        if window.is_removed_frame() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The provided callback is no longer runnable.",
            )
            .into_js_error(global));
        }
        if object.is_callable() {
            return object.call(global, JSValue::UNDEFINED, &[argument]);
        }
        match object.get(global, name)?.filter(|it| it.is_callable()) {
            Some(method) => method.call(global, object, &[argument]),
            None => Err(global.throw_type_error(format_args!("{name} is not a function"))),
        }
    };
    Some(call())
}

/// What it throws is reported.
pub(crate) fn call_back<'a>(
    cx: Cx<'_, 'a>,
    window: Option<&'a WindowTarget>,
    callback: JSValue,
    this: JSValue,
    arguments: &[JSValue],
) {
    calling_scripts(cx, |cx, drains| {
        if let Err(error) = callback.call(cx.global(), this, arguments) {
            report(
                cx,
                WindowTarget::of_callback(&cx.heap, callback).or(window),
                error,
            );
        }
        if drains {
            drain_microtasks(cx);
        }
    });
}

/// <https://html.spec.whatwg.org/#clean-up-after-running-script>
pub(crate) fn run_script<'a>(cx: Cx<'_, 'a>, run: impl FnOnce(Cx<'_, 'a>)) {
    calling_scripts(cx, |cx, drains| {
        run(cx);
        if drains {
            drain_microtasks(cx);
        }
    });
}

/// No script is running.
pub(crate) fn as_task<'a, R>(cx: Cx<'_, 'a>, run: impl FnOnce(Cx<'_, 'a>) -> R) -> R {
    let was_at_top_level = swap_top_level(true);
    let result = run(cx);
    swap_top_level(was_at_top_level);
    result
}

/// For a task. Nothing happens if `window` has been disposed of.
pub(crate) fn from_event_loop<T: JsInterface>(
    global: &JSGlobalObject,
    window: JSValue,
    run: impl for<'a> FnOnce(Cx<'_, 'a>, &'a T),
) {
    let enter = |cx: Cx<'_, '_>| {
        let Some(given) = T::from_js(&cx.heap, window).filter(|_| {
            WindowTarget::from_js(&cx.heap, window).is_some_and(|it| !it.is_disposed())
        }) else {
            return;
        };
        as_task(cx, |cx| run(cx, given));
    };
    // SAFETY: the event loop is calling.
    unsafe { JsScope::with(global.as_mut_ptr(), enter) }
}

type Steps = dyn for<'a> FnOnce(Cx<'_, 'a>, &[JSValue]) -> bindgen::Result<'a, ()>;

/// The first of the values is the window.
fn run_steps(global: &JSGlobalObject, values: &[JSValue], steps: Box<Steps>) -> JsResult<()> {
    let enter = |cx: Cx<'_, '_>| {
        let window = WindowTarget::from_js(&cx.heap, values[0]);
        let run = |cx: Cx<'_, '_>| {
            if let Err(error) = steps(cx, &values[1..]) {
                let (error, window) = (
                    error.into_js_error(cx.global()),
                    WindowTarget::from_js(&cx.heap, values[0]),
                );
                report(cx, window, error);
            }
        };
        match window {
            Some(window) if window.is_disposed() => {}
            _ => as_task(cx, run),
        }
    };
    // SAFETY: the event loop is calling.
    unsafe { JsScope::with(global.as_mut_ptr(), enter) };
    Ok(())
}

/// For the window of the document, or else that of its realm.
pub(crate) fn queue_task_for(doc: &Doc, values: &[JSValue], steps: Box<Steps>) {
    let window = doc
        .window()
        .or_else(|| WindowTarget::of_realm(JsHeap::from_global(doc.global())));
    let values: SmallVec<[_; 8]> =
        core::iter::once(window.map_or(JSValue::UNDEFINED, |it| it.to_js()))
            .chain(values.iter().copied())
            .collect();
    tasks::post(
        doc.global(),
        Priority::Visible,
        Work::Once(Box::new(|global, values| run_steps(global, values, steps))),
        &values,
    );
}

/// As long as the document has a window. It does not keep the process alive.
pub(crate) fn queue_task_after(
    doc: &Doc,
    milliseconds: f64,
    values: &[JSValue],
    steps: Box<Steps>,
) {
    if doc.window().is_none() {
        return;
    }
    let heap = JsHeap::from_global(doc.global());
    let kept = List::from_fn(heap, values.len() as u32 + 1, |at| {
        if at == 0 {
            doc.to_js()
        } else {
            values[at as usize - 1]
        }
    });
    let kept = crate::api::realm::hold(heap, Strong::create(kept.to_js(), doc.global()));
    let queue = move |_: &JSGlobalObject| {
        let Some(kept) = kept.take() else {
            return Ok(());
        };
        let kept: SmallVec<[_; 8]> = List::from_value(kept.get()).values().collect();
        // SAFETY: what was put there.
        let doc = unsafe { Doc::from_js_unchecked(kept[0]) };
        if doc.window().is_some() {
            queue_task_for(doc, &kept[1..], steps);
        }
        Ok(())
    };
    bun_ui::later::after(milliseconds, queue).detach();
}
