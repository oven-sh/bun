//! https://html.spec.whatwg.org/#the-form-element

use super::button::is_submit_button;
use super::*;
use crate::api::core::url::Url;
use crate::api::history;
use crate::api::ui::activation::{self, Click};
use crate::api::ui::dialog;
use crate::api::uievents::{FormDataEvent, SubmitEvent};
use crate::generated_bindgen::forms::HTMLFormElement;
use crate::generated_bindgen::html::HTMLElement;

#[derive(Default)]
struct FormState {
    is_constructing_entry_list: Cell<bool>,
    is_firing_submission_events: Cell<bool>,
    is_locked_for_reset: Cell<bool>,
}

/// https://html.spec.whatwg.org/#implicit-submission
pub(super) fn submit_implicitly<'a>(cx: &mut Cx<'a>, control: &'a Element) {
    let Some(form) = form_owner(control) else {
        return;
    };
    if let Some(button) = controls_of(form).find(|it| is_submit_button(it)) {
        activation::click(cx, button, Trusted::Yes, Click::default());
    } else if controls_of(form)
        .filter(|it| input_type(it).is_some_and(InputType::is_typed))
        .nth(1)
        .is_none()
    {
        submit(cx, form, None, false);
    }
}

pub(super) fn reset_form<'a>(cx: &mut Cx<'a>, form: &'a Element) {
    let lock = &form.extra::<FormState>().is_locked_for_reset;
    if lock.replace(true) {
        return;
    }
    if fire(
        cx,
        form,
        atom!("reset"),
        EventInit {
            cancelable: true,
            ..BUBBLES
        },
    ) {
        Refs::collect(&cx.heap, controls_of(form))
            .iter()
            .for_each(|it| reset(cx, it));
    }
    lock.set(false);
}

fn append_entries<'a>(
    cx: &mut Cx<'a>,
    data: JSValue,
    control: &'a Element,
    submitter: Option<&'a Element>,
    encoding: &str,
) {
    let name = control.attr(atom!("name")).unwrap_or_default();
    let (kind, is_submitter) = (input_type(control), Some(control) == submitter);
    let append = |cx: &mut Cx<'a>, name: &DomString, value: &DomString| {
        form_data::append_text(&cx.heap, data, name, value)
    };
    if kind == Some(InputType::Image) {
        for (axis, value) in ["x", "y"]
            .into_iter()
            .zip(Input::new(control).coordinate())
            .filter(|_| is_submitter)
        {
            let dot = if name.is_empty() { "" } else { "." };
            append(
                cx,
                &DomString::concat(&[&name, &dot.into(), &axis.into()]),
                &value.to_string().as_str().into(),
            );
        }
        return;
    }
    if is_form_associated_custom(control) {
        if let Some(it) = control.edge(Edge::SubmissionValue) {
            form_data::append(&cx.heap, data, &name, it);
        }
        return;
    }
    if name.is_empty() {
        return;
    }
    match (control.html_tag(), kind) {
        (_, Some(kind))
            if kind.is_button() && !is_submitter
                || kind.is_checkable() && !Input::new(control).is_checked() =>
        {
            return;
        }
        (_, Some(InputType::File)) => {
            let mut files = Input::new(control).selected_files().peekable();
            if files.peek().is_none() {
                form_data::append(
                    control.doc().heap(&cx.heap),
                    data,
                    &name,
                    JSValue::UNDEFINED,
                );
            }
            files.for_each(|it| form_data::append(&cx.heap, data, &name, it));
        }
        (_, Some(InputType::Hidden)) if name.eq_ignore_ascii_case("_charset_") => {
            append(cx, &name, &encoding.into())
        }
        (_, Some(_)) => append(cx, &name, &Input::new(control).value()),
        (atom!("button"), _) if is_submitter => {
            append(cx, &name, &control.attr(atom!("value")).unwrap_or_default())
        }
        (atom!("select"), _) => Select::new(control)
            .selected()
            .filter(|it| !is_disabled(it))
            .for_each(|it| append(cx, &name, &option::value(it))),
        (atom!("textarea"), _) => {
            let value = textarea::submitted_value(cx, control);
            append(cx, &name, &value);
        }
        _ => {}
    }
    let has_directionality = kind.map_or_else(
        || control.is_html(atom!("textarea")),
        InputType::has_directionality,
    );
    if let Some(dirname) = control
        .attr(atom!("dirname"))
        .filter(|it| has_directionality && !it.is_empty())
    {
        let direction = if control.matches(cx, b":dir(rtl)").unwrap_or(false) {
            "rtl"
        } else {
            "ltr"
        };
        append(cx, &dirname, &direction.into());
    }
}

/// https://html.spec.whatwg.org/#constructing-the-form-data-set
pub(crate) fn construct_entry_list<'a>(
    cx: &mut Cx<'a>,
    data: JSValue,
    form: &'a Element,
    submitter: Option<&'a Element>,
    encoding: &str,
) -> Result<(), Refusal> {
    let is_constructing = &form.extra::<FormState>().is_constructing_entry_list;
    if submitter.is_some_and(|it| form_owner(it) != Some(form)) {
        return Err((
            DomError::NotFoundError,
            "The specified element is not owned by this form element.",
        ));
    }
    if is_constructing.replace(true) {
        return Err((
            DomError::InvalidStateError,
            "The form is constructing its entry list.",
        ));
    }
    let submittable = controls_of(form)
        .filter(|it| !is_disabled(it) && it.closest_html(atom!("datalist")).is_none());
    Refs::collect(&cx.heap, submittable)
        .iter()
        .for_each(|it| append_entries(cx, data, it, submitter, encoding));
    let event = FormDataEvent::new(&cx.heap, form.doc(), data);
    dispatch(cx, form, event);
    is_constructing.set(false);
    Ok(())
}

fn fire_submission_events<'a>(
    cx: &mut Cx<'a>,
    form: &'a Element,
    button: Option<&'a Element>,
    validates: bool,
) -> bool {
    let controls = Refs::collect(&cx.heap, controls_of(form));
    for it in controls.iter() {
        control(it).was_edited.set(true);
        dirty(cx, it);
    }
    (!validates || validity::validate(cx, controls.iter(), true)) && {
        let event = SubmitEvent::new(
            &cx.heap,
            form.doc(),
            atom!("submit"),
            EventInit {
                cancelable: true,
                ..BUBBLES
            },
            button,
        );
        dispatch(cx, form, event)
    }
}

/// https://html.spec.whatwg.org/#form-submission-algorithm
pub(super) fn submit<'a>(
    cx: &mut Cx<'a>,
    form: &'a Element,
    button: Option<&'a Element>,
    is_from_method: bool,
) {
    let state = form.extra::<FormState>();
    let is_sandboxed = || {
        form.doc()
            .last_window()
            .is_some_and(|it| it.host().is_sandboxed("allow-forms".into()))
    };
    if !form.is_connected() || state.is_constructing_entry_list.get() || is_sandboxed() {
        return;
    }
    let setting = |of_button: Known, of_form: Known| {
        button
            .and_then(|it| it.attr(of_button))
            .or_else(|| form.attr(of_form))
    };
    if !is_from_method {
        if state.is_firing_submission_events.replace(true) {
            return;
        }
        let proceeds = fire_submission_events(
            cx,
            form,
            button,
            setting(atom!("formnovalidate"), atom!("novalidate")).is_none(),
        );
        state.is_firing_submission_events.set(false);
        if !proceeds || !form.is_connected() {
            return;
        }
    }
    let method = setting(atom!("formmethod"), atom!("method")).unwrap_or_default();
    if method.eq_ignore_ascii_case("dialog") {
        let result = button.and_then(|it| {
            match Input::of(it)
                .filter(|it| it.kind() == InputType::Image)
                .map(Input::coordinate)
            {
                Some([x, y]) => Some(format!("{x},{y}").as_str().into()),
                None => it.attr(atom!("value")),
            }
        });
        if let Some(it) = form.closest_html(atom!("dialog")) {
            dialog::close(cx, it, result, None);
        }
        return;
    }
    let (data, encoding) = (
        form_data::create(form.doc().heap(&cx.heap)),
        history::encoding_of_form(form).name(),
    );
    if construct_entry_list(cx, data, form, button, encoding).is_err() || !form.is_connected() {
        return;
    }
    history::plan_form_navigation(
        cx,
        form,
        history::Submission {
            submitter: button.unwrap_or(form),
            data,
            is_post: method.eq_ignore_ascii_case("post"),
            is_from_method,
            action: setting(atom!("formaction"), atom!("action")).unwrap_or_default(),
            enctype: setting(atom!("formenctype"), atom!("enctype"))
                .unwrap_or_default()
                .to_ascii_lowercase(),
            target: setting(atom!("formtarget"), atom!("target"))
                .or_else(|| history::target_of_base(form.doc()))
                .unwrap_or_default(),
        },
    );
}

pub(super) fn action<'a>(cx: &mut Cx<'a>, element: &'a Element, attribute: Known) -> DomString {
    match element.attr(attribute).filter(|it| !it.is_empty()) {
        Some(value) => element
            .doc()
            .parse_url(cx, &value)
            .map_or(value, Url::into_href),
        None => element.doc().url(),
    }
}

pub(super) fn checked_submitter<'a>(
    heap: &JsHeap<'a>,
    form: &Element,
    submitter: Option<&'a HTMLElement>,
) -> bindgen::Result<'a, Option<&'a Element>> {
    match submitter {
        Some(it) if !is_submit_button(it) => Err(heap.type_error(format_args!(
            "The specified element is not a submit button."
        ))),
        Some(it) if form_owner(it) != Some(form) => Err(dom_error(
            heap,
            DomError::NotFoundError,
            "The specified element is not owned by this form element.",
        )),
        _ => Ok(submitter.map(|it| &**it)),
    }
}

impl HTMLFormElement {
    pub(crate) fn get_action<'a>(&'a self, cx: &mut Cx<'a>) -> DomString {
        action(cx, self, atom!("action"))
    }

    pub(crate) fn set_action<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("action"), value);
    }

    pub(crate) fn submit<'a>(&'a self, cx: &mut Cx<'a>) {
        submit(cx, self, None, true);
    }

    pub(crate) fn request_submit<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        submitter: Option<&'a HTMLElement>,
    ) -> bindgen::Result<'a, ()> {
        let submitter = checked_submitter(&cx.heap, self, submitter)?;
        submit(cx, self, submitter, false);
        Ok(())
    }

    pub(crate) fn reset<'a>(&'a self, cx: &mut Cx<'a>) {
        reset_form(cx, self);
    }

    pub(crate) fn check_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        validity::validate(cx, controls_of(self), false)
    }

    pub(crate) fn report_validity<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        validity::validate(cx, controls_of(self), true)
    }
}

pub(crate) static STEPS: Steps = Steps {
    post_connection: Some(inserted),
    ..Steps::NONE
};
