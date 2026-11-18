//! What is outside: the window system, the frames around, and tasks.

use bun_jsc::{JSObject, JSPromise, Strong};
use bun_ui::protocol::{
    Command, Cursor, Dragged, InputField, Reply, Request, SurfaceCommand, SystemRequest, Text,
};

use super::prelude::*;
use crate::abi::Rect;
use crate::api::cssom;
use crate::api::editing::input_method::Surroundings;
use crate::api::events::from_event_loop;
pub(crate) use crate::api::events::now;
use crate::api::frames;
use crate::api::markup;
use crate::api::transfer::{DataTransfer, DropEffect};
use crate::api::window::Window;
use crate::drag_image::DragImage;
use crate::generated_bindgen::interaction::js_UiJob;

fn number(value: impl Into<f64>) -> JSValue {
    JSValue::js_number(value.into())
}

fn to_string(cx: &Cx<'_>, value: JSValue) -> Option<DomString> {
    DomString::from_js_string(&cx.heap, JsLocal::new(&cx.heap, value).as_string()?).ok()
}

// ───────────────────────────── windows ─────────────────────────────

pub(crate) fn window(doc: &Doc) -> Option<JSValue> {
    doc.window().map(WindowTarget::window)
}

pub(crate) fn current_document<'a>(heap: &JsHeap<'a>) -> Option<&'a Doc> {
    WindowTarget::of_realm(heap)?.doc()
}

pub(crate) fn is_window(heap: &JsHeap<'_>, value: JSValue) -> bool {
    WindowTarget::of(heap, value).is_some()
}

pub(crate) fn is_sandboxed(ui: &Ui, missing_flag: &str) -> bool {
    ui.doc()
        .last_window()
        .is_some_and(|it| it.host().is_sandboxed(missing_flag.into()))
}

pub(crate) fn allows_feature(ui: &Ui, feature: bun_web::permissions_policy::Feature) -> bool {
    ui.doc()
        .last_window()
        .is_none_or(|it| it.host().allows_feature(feature) != Some(false))
}

/// Or one around it has.
pub(crate) fn has_target_element(ui: &Ui) -> bool {
    [ui].into_iter()
        .chain(frames::above(ui))
        .any(|it| crate::api::history::has_target(it.doc()))
}

/// One that nothing listens to.
pub(crate) fn count_event<'a>(cx: &mut Cx<'a>, ui: &'a Ui, name: Known) {
    crate::api::performance::count_event(&cx.heap, ui.doc(), name);
}

// ───────────────────────────── the system ─────────────────────────────

pub(crate) fn set_fullscreen<'a>(cx: &mut Cx<'a>, ui: &'a Ui, on: bool) {
    match ui.container() {
        Some(container) => container.fullscreen(cx, on),
        None => ui
            .doc()
            .last_window()
            .into_iter()
            .for_each(|it| it.host().set_fullscreen(on)),
    }
}

/// That of the window at the top.
fn tell_surface(ui: &Ui, command: SurfaceCommand) {
    let id = Window::of(frames::above(ui).last().unwrap_or(ui).doc()).map_or(0, Window::surface);
    if let Some(system) = bun_ui::loaded().filter(|_| id != 0) {
        (system.tell)(Command::Surface { id, command });
    }
}

pub(crate) fn set_cursor(ui: &Ui, cursor: &'static str) {
    ui.doc()
        .window()
        .into_iter()
        .for_each(|it| it.host().cursor_changed(cursor.into()));
    tell_surface(ui, SurfaceCommand::Cursor(Cursor::named(cursor.as_bytes())));
}

pub(crate) fn key_handled() {
    if let Some(system) = bun_ui::loaded() {
        (system.tell)(Command::KeyWasHandled);
    }
}

pub(crate) fn set_input_method(ui: &Ui, around: &Surroundings, caret: Rect) {
    let ([left, top], zoom) = (
        layout::narrow(frames::offset_in_top(ui)),
        layout::zoom(ui.doc()) as f32,
    );
    let [x, y, width, height] =
        [caret.x + left, caret.y + top, caret.width, caret.height].map(|it| it * zoom);
    let caret = bun_ui::Rect {
        x,
        y,
        width,
        height,
    };
    let field = InputField {
        text: around.text.units().collect(),
        selection: around.selection,
        composing: around.composing.into(),
        caret,
        is_out_of_date: bun_ui::queue::are_edits_waiting(),
    };
    tell_surface(ui, SurfaceCommand::Field(Some(field).into()));
}

pub(crate) fn disable_input_method(ui: &Ui, is_for_password: bool) {
    tell_surface(
        ui,
        if is_for_password {
            SurfaceCommand::PasswordField
        } else {
            SurfaceCommand::Field(None.into())
        },
    );
}

pub(crate) fn begin_drag(ui: &Ui, data: &DataTransfer, (image, area): DragImage) {
    let urls = data.stored("text/uri-list");
    let urls = urls.to_utf8();
    let url = bun_core::strings::tokenize_any(urls.as_bytes(), b"\r\n")
        .find(|it| it.starts_with(b"https://") || it.starts_with(b"http://"));
    let [text, html] =
        ["text/plain", "text/html"].map(|it| Text::from(&*data.stored(it).to_utf8()));
    let [copies, links] =
        [DropEffect::Copy, DropEffect::Link].map(|it| data.effect_allowed().allows(it));
    let [x, y, width, height] = area.to_array().map(|it| it * layout::zoom(ui.doc()) as f32);
    let area = bun_ui::Rect {
        x,
        y,
        width,
        height,
    };
    tell_surface(
        ui,
        SurfaceCommand::BeginDrag(Dragged {
            image,
            area,
            text,
            html,
            url: Text::lossy(url.unwrap_or_default()),
            copies,
            links,
        }),
    );
}

pub(crate) fn checks_spelling(ui: &Ui) -> bool {
    ui.doc()
        .last_window()
        .is_some_and(|it| it.host().checks_spelling())
}

/// Nothing happens with the reply if the window is gone by then.
fn ask_system<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    value: JSValue,
    request: SystemRequest,
    answered: Box<dyn for<'b> FnOnce(&mut Cx<'b>, &'b Window, JSValue, Reply)>,
) {
    let Some(window) = ui.doc().window() else {
        return;
    };
    let kept = [window.to_js(), value].map(|it| Strong::create(it, cx.global()));
    let asked = bun_ui::queue::request(
        cx.global(),
        Request::System(request),
        move |global, reply| {
            from_event_loop(global, kept[0].get(), |cx, window: &Window| {
                answered(cx, window, kept[1].get(), reply)
            });
            Ok(())
        },
    );
    bun_web::exec::report(cx, asked.map_err(Into::into));
}

pub(crate) fn check_spelling<'a>(cx: &mut Cx<'a>, ui: &'a Ui, node: &'a Node, text: DomString) {
    ask_system(
        cx,
        ui,
        node.to_js(),
        SystemRequest::CheckSpelling(text.units().collect()),
        Box::new(move |cx, _, node, reply| {
            if let (Some(node), Reply::Misspelled(words)) = (Node::from_value(node), reply) {
                Ui::of(node.doc()).into_iter().for_each(|ui| {
                    _ = crate::api::editing::spelling::found(cx, ui, node, &text, &words)
                });
            }
        }),
    );
}

pub(crate) fn guess_spelling<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    word: String,
    guessed: impl FnOnce(&Window, Vec<String>) + 'static,
) {
    ask_system(
        cx,
        ui,
        JSValue::UNDEFINED,
        SystemRequest::GuessSpelling(word.into()),
        Box::new(|_, window, _, reply| match reply {
            Reply::Guesses(words) => {
                guessed(window, words.iter().map(|it| it.to_string()).collect())
            }
            _ => guessed(window, Vec::new()),
        }),
    );
}

pub(crate) fn pick_files<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    input: &'a Element,
    is_multiple: bool,
    is_directory: bool,
    accept: &DomString,
) {
    let Some(window) = ui.doc().window() else {
        return;
    };
    let accept = bun_core::strings::tokenize_any(accept.to_utf8().as_bytes(), b", \t\n\x0c\r")
        .map(|it| crate::values::text(it).into())
        .collect();
    let input = Strong::create(input.to_js(), cx.global());
    window.host().pick_files(
        bun_web::host::FileChoice {
            is_multiple,
            is_directory,
            accept,
        },
        move |_, paths| {
            let Some(input) = Element::from_value(input.get()) else {
                return;
            };
            crate::api::on_behalf::queue_task(input.doc(), &[input.to_js()], move |cx, values| {
                Element::from_value(values[0]).into_iter().for_each(|it| {
                    crate::api::forms::entry::paths_picked(
                        cx,
                        it,
                        paths.as_deref().unwrap_or_default(),
                    )
                });
                Ok(())
            });
        },
    );
}

pub(crate) fn type_of_file(file: JSValue) -> Option<DomString> {
    let blob = file.as_class_ref::<bun_jsc::webcore_types::Blob>()?;
    blob.is_jsdom_file
        .get()
        .then(|| DomString::from_latin1(blob.content_type.get().given()))
}

pub(crate) fn time_of_day() -> f64 {
    bun_core::time::milli_timestamp() as f64
}

// ───────────────────────────── later ─────────────────────────────

const JOB_ARGUMENTS: usize = 6;

pub(crate) struct UiJob(
    Box<dyn for<'a> Fn(&mut Cx<'a>, [JSValue; JOB_ARGUMENTS])>,
    bun_jsc::bindgen::Interior,
);

type Run<const N: usize> = for<'a> fn(&mut Cx<'a>, [JSValue; N]);

impl UiJob {
    fn new<const N: usize>(heap: &JsHeap<'_>, arguments: [JSValue; N], run: Run<N>) -> JSValue {
        const { assert!(N <= JOB_ARGUMENTS) };
        let job = js_UiJob::create(
            heap,
            UiJob(
                Box::new(move |cx, all| run(cx, core::array::from_fn(|it| all[it]))),
                Default::default(),
            ),
        );
        let setters = [
            js_UiJob::set_first,
            js_UiJob::set_second,
            js_UiJob::set_third,
            js_UiJob::set_fourth,
            js_UiJob::set_fifth,
            js_UiJob::set_sixth,
        ];
        setters
            .into_iter()
            .zip(arguments)
            .for_each(|(set, value)| set(job, value));
        job.to_js()
    }

    pub(crate) fn call_instance<'a>(&'a self, cx: &mut Cx<'a>) {
        let getters = [
            js_UiJob::first,
            js_UiJob::second,
            js_UiJob::third,
            js_UiJob::fourth,
            js_UiJob::fifth,
            js_UiJob::sixth,
        ];
        (self.0)(cx, getters.map(|get| get(self).unwrap_or_default()));
    }
}

fn run_job<'a>(cx: &mut Cx<'a>, job: &[JSValue]) -> bindgen::Result<'a, ()> {
    UiJob::from_js(&cx.heap, job[0])
        .into_iter()
        .for_each(|it| it.call_instance(cx));
    Ok(())
}

pub(crate) fn queue_task<'a, const N: usize>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    arguments: [JSValue; N],
    run: Run<N>,
) {
    crate::api::events::queue_task_for(
        doc,
        &[UiJob::new(&cx.heap, arguments, run)],
        Box::new(run_job),
    );
}

/// One of the two runs in a task, once the app has decided.
pub(crate) fn ask_permission<'a, const N: usize>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    name: &str,
    arguments: [JSValue; N],
    granted: Run<N>,
    denied: Run<N>,
) {
    let Some(window) = ui.doc().window() else {
        return queue_task(cx, ui.doc(), arguments, denied);
    };
    let held = [
        ui.doc().to_js(),
        UiJob::new(&cx.heap, arguments, granted),
        UiJob::new(&cx.heap, arguments, denied),
    ]
    .map(|it| Strong::create(it, cx.global()));
    let held = crate::api::realm::realm_of(ui.doc().realm(&cx.heap)).hold(held);
    window.host().permission(name.into(), move |_, state| {
        let Some([doc, granted, denied]) = held.take() else {
            return;
        };
        let job = if state == "granted" { granted } else { denied };
        Doc::from_value(doc.get())
            .into_iter()
            .for_each(|it| crate::api::events::queue_task_for(it, &[job.get()], Box::new(run_job)));
    });
}

pub(crate) fn queue_before_frame<'a, const N: usize>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    arguments: [JSValue; N],
    run: Run<N>,
) {
    let job = UiJob::new(&cx.heap, arguments, run);
    let window = doc
        .window()
        .or_else(|| WindowTarget::of_realm(&cx.heap))
        .and_then(|it| it.downcast::<Window>());
    window
        .into_iter()
        .for_each(|it| it.queue_before_frame(&cx.heap, job));
}

pub(crate) fn queue_microtask<'a, const N: usize>(
    cx: &mut Cx<'a>,
    arguments: [JSValue; N],
    run: Run<N>,
) {
    let job = UiJob::new(&cx.heap, arguments, run);
    cx.global().queue_microtask(job, &[]);
}

pub(crate) fn set_timeout<'a, const N: usize>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    delay: f64,
    arguments: [JSValue; N],
    run: Run<N>,
) {
    crate::api::events::queue_task_after(
        ui.doc(),
        delay,
        &[UiJob::new(&cx.heap, arguments, run)],
        Box::new(run_job),
    );
}

/// One that bubbles.
pub(crate) fn queue_event<'a>(cx: &mut Cx<'a>, doc: &'a Doc, name: Known) {
    queue_task(
        cx,
        doc,
        [doc.to_js(), number(name as u16)],
        |cx, [doc, name]| {
            Doc::from_value(doc)
                .map(|it| fire(cx, it, Known::from_index(name.as_number() as u16), BUBBLES));
        },
    );
}

pub(crate) fn on_abort<'a>(
    cx: &mut Cx<'a>,
    signal: JsLocal<'a, JSObject>,
    argument: JSValue,
    run: Run<1>,
) {
    let job = JsLocal::new(&cx.heap, UiJob::new(&cx.heap, [argument], run)).as_callable();
    signal
        .as_value()
        .as_abort_signal()
        .zip(job)
        .into_iter()
        .for_each(|(signal, job)| _ = signal.add_algorithm(cx, job));
}

pub(crate) fn call_back_soon(heap: &JsHeap<'_>, callback: JSValue, argument: JSValue) {
    crate::api::realm::queue_task(heap, [callback, argument], |cx, [callback, argument]| {
        crate::api::events::call_back(
            cx,
            None,
            callback.to_js(),
            JSValue::UNDEFINED,
            &[argument.to_js()],
        )
    });
}

pub(crate) fn new_promise(heap: &JsHeap<'_>) -> JSValue {
    JSPromise::create(global_of(heap)).to_js()
}

pub(crate) fn settle<'a>(cx: &mut Cx<'a>, promise: JSValue, result: bindgen::Result<'a, ()>) {
    let Some(promise) = promise.as_promise() else {
        return;
    };
    // SAFETY: the caller's value holds it.
    let promise = unsafe { &mut *promise };
    let global = cx.global();
    let settled = match result {
        Ok(()) => promise.resolve(global, JSValue::UNDEFINED),
        Err(error) => promise.reject(global, Err(error.into_js_error(global))),
    };
    if settled.is_err() {
        global.clear_exception_except_termination();
    }
}

// ───────────────────────────── documents ─────────────────────────────

/// That of the program, whatever the page is told about the languages of the user.
pub(crate) fn locale(doc: &Doc) -> String {
    doc.window()
        .and_then(|it| it.host().locale())
        .unwrap_or_else(|| "en-US".into())
}

pub(crate) fn parse_fragment<'a>(
    cx: &mut Cx<'a>,
    context: &'a Element,
    markup: &DomString,
) -> Option<&'a Node> {
    let fragment = markup::parse_fragment(cx, context, markup, context, Default::default());
    fragment
        .inspect_err(|_| _ = cx.global().clear_exception_except_termination())
        .ok()
}

pub(crate) fn serialize<'a>(cx: &mut Cx<'a>, node: &'a Node) -> DomString {
    let markup = if node.is_element() {
        markup::serialize_outer(cx, node)
    } else {
        markup::serialize_inner(cx, node)
    };
    markup
        .inspect_err(|_| _ = cx.global().clear_exception_except_termination())
        .unwrap_or_default()
}

pub(crate) fn inline_style<'a>(cx: &mut Cx<'a>, element: &'a Element, property: &str) -> String {
    let value = cssom::inline_style(&cx.heap, element).get_property_value(cx, property.as_bytes());
    to_string(cx, value.to_js()).map_or_else(String::new, |it| it.to_utf8().into_owned())
}

pub(crate) fn set_style<'a>(cx: &mut Cx<'a>, element: &'a Element, property: &str, value: &str) {
    _ = cssom::inline_style(&cx.heap, element).set_property(
        cx,
        property.as_bytes(),
        value.as_bytes(),
        b"",
    );
}

pub(crate) fn styled_properties<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Vec<String> {
    let style = cssom::inline_style(&cx.heap, element);
    (0..style.get_length(cx))
        .map(|it| crate::values::text(&style.item(cx, it)).to_owned())
        .collect()
}

// ───────────────────────────── custom elements ─────────────────────────────
