//! <https://html.spec.whatwg.org/#form-submission-algorithm>, from where it has the entries.

use bun_web::encoding::{self, Encoding, new_multipart_boundary};

use super::navigate::{Options, Post, Source, is_self, without_dangling_markup};
use super::*;
use crate::api::forms::form_data;

pub(crate) struct Submission<'a> {
    pub(crate) submitter: &'a Element,
    pub(crate) data: JSValue,
    pub(crate) is_post: bool,
    pub(crate) is_from_method: bool,
    pub(crate) action: DomString,
    pub(crate) enctype: DomString,
    pub(crate) target: DomString,
}

struct Plan {
    /// It is only compared, and the task holds the form.
    form: JSValue,
    target: DomString,
    serial: u32,
}

#[derive(Default)]
pub(super) struct Planned {
    plans: RefCell<Vec<Plan>>,
    last: Cell<u32>,
}

impl Planned {
    pub(super) fn cancel(&self) {
        self.plans.take();
    }

    pub(super) fn forget(&self, target: &DomString) {
        self.plans.borrow_mut().retain(|it| {
            it.target != *target && !(is_self(&it.target.to_utf8()) && is_self(&target.to_utf8()))
        });
    }
}

pub(crate) fn encoding_of_form(form: &Element) -> Encoding {
    let of_document = form
        .doc()
        .legacy_encoding()
        .and_then(|it| Encoding::for_label(it.to_utf8().as_bytes()))
        .unwrap_or_default();
    of_document.for_form(
        form.attr(atom!("accept-charset"))
            .as_ref()
            .map(DomString::to_utf8)
            .as_ref()
            .map(|it| it.as_bytes()),
    )
}

/// And its type.
fn encode(fields: &[form_data::Field], enctype: &str, encoding: Encoding) -> (Vec<u8>, String) {
    let entries = fields.iter().map(|it| encoding::Entry {
        name: &it.name,
        value: &it.value,
        file_type: it.file.as_ref().map(|it| &it.mime[..]),
    });
    match enctype {
        "multipart/form-data" => {
            let boundary = new_multipart_boundary();
            let ((text, gaps), mut body, mut at) =
                (encoding.multipart(entries, &boundary), Vec::new(), 0);
            for (gap, file) in gaps
                .into_iter()
                .zip(fields.iter().filter_map(|it| it.file.as_ref()))
            {
                body.extend_from_slice(&text[at..gap]);
                file.data
                    .read_now()
                    .into_iter()
                    .for_each(|it| body.extend_from_slice(&it));
                at = gap;
            }
            body.extend_from_slice(&text[at..]);
            (body, format!("{enctype}; boundary={}", lossy(&boundary)))
        }
        "text/plain" => (encoding.plain_text(entries), enctype.into()),
        _ => (
            encoding.url_encoded(entries),
            "application/x-www-form-urlencoded".into(),
        ),
    }
}

pub(crate) fn plan_form_navigation<'a>(cx: &mut Cx<'a>, form: &'a Element, it: Submission<'a>) {
    use crate::api::core::url::{Part, Url};
    let Some(window) = form.doc().window().and_then(|it| it.downcast::<Window>()) else {
        return;
    };
    let url = if it.action.is_empty() {
        Some(Url::from_href(form.doc().url()))
    } else {
        form.doc().parse_url(cx, &it.action)
    };
    let Some(mut url) =
        url.filter(|it| window.host().allows_form(it.href().to_utf8().into_owned()) != Some(false))
    else {
        return;
    };
    let (mut body, mut content_type) = (JSValue::UNDEFINED, None);
    if !url.part(Part::Protocol).eq_str("javascript:") {
        let (bytes, kind) = encode(
            &form_data::fields(it.data),
            &if it.is_post {
                it.enctype.to_utf8()
            } else {
                "".into()
            },
            encoding_of_form(form),
        );
        if !it.is_post {
            url = url.with_part(
                Part::Search,
                &DomString::concat(&[&"?".into(), &DomString::from_latin1(&bytes)]),
            );
        } else if let Ok(bytes) = cx.heap.create_buffer(&bytes) {
            (body, content_type) = (bytes.to_js(), Some(kind));
        }
    }
    let (planned, is_by_user, replaces) = (
        &History::of(&cx.heap, window).planned,
        window.has_activation(),
        !window.is_in(Phase::COMPLETELY_LOADED),
    );
    let (serial, target) = (planned.last.get() + 1, without_dangling_markup(it.target));
    planned.last.set(serial);
    planned
        .plans
        .borrow_mut()
        .retain(|plan| plan.form != form.to_js() || it.is_from_method && plan.target != target);
    planned.plans.borrow_mut().push(Plan {
        form: form.to_js(),
        target: target.clone(),
        serial,
    });
    if is_self(&target.to_utf8()) {
        window.set_phase(Phase::ABOUT_TO_SUBMIT, true);
    }
    queue_task(
        window,
        [form.to_js(), it.submitter.to_js(), it.data, body],
        move |cx, window, [form, submitter, form_data, body]| {
            window.set_phase(Phase::ABOUT_TO_SUBMIT, false);
            let history = History::of(&cx.heap, window);
            if history
                .planned
                .plans
                .borrow_mut()
                .extract_if(.., |it| it.serial == serial)
                .count()
                == 0
            {
                return;
            }
            let post = content_type.map(|content_type| Post {
                form_data,
                body,
                content_type,
            });
            let mut options = Options {
                source: Source::Form,
                element: Element::from_value(submitter),
                is_by_user,
                replace_in: replaces.then_some(window),
                post,
                ..Default::default()
            };
            Element::from_value(form)
                .into_iter()
                .for_each(|it| options.follow_rel(it));
            history.navigate(cx, &url.href().to_utf8(), options, &target.to_utf8());
        },
    );
}
