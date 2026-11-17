//! https://svgwg.org/specs/animations/#DOMInterfaces

use core::cell::Cell;

use bun_core::strings::split_once_char;
use bun_jsc::bindgen::{self, JsLocal, JsScope};
use bun_jsc::{DOMExceptionCode, JSValue};

use super::syntax::split;
use crate::api::core::steps::Steps;
use crate::api::core::{Atom, Edge, Element, Node, Ns, atom};
use crate::api::core::{Doc, ReadyState};
use crate::api::events::now;
use crate::api::graphics::Failure;
use crate::api::interim::{add_listener, remove_listener, resolve};
use crate::document::Document;
use crate::generated_bindgen::svg::{SVGAnimationElement, SVGSVGElement};
use crate::smil::Instance;
use crate::tree::NodeId;
use crate::values::text;

thread_local! {
    static HAS_TOLD_TIME: Cell<bool> = const { Cell::new(false) };
}

/// Time stands still while a script runs.
fn time_of_task<'a>(cx: &mut JsScope<'a>, document: &'a Doc) -> Option<f64> {
    let window = document.window().filter(|_| !HAS_TOLD_TIME.replace(true))?;
    let forget = cx.heap.create_callback(
        |_, _, _, _| Ok((HAS_TOLD_TIME.set(false), JSValue::UNDEFINED).1),
        [JSValue::UNDEFINED; 2],
        0,
    );
    cx.heap.queue_microtask(forget, JSValue::UNDEFINED);
    Some(now() - window.time_origin())
}

#[optimize(size)]
fn inspect<'a, R: Default>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    run: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    super::elements::prepare(element);
    let now = time_of_task(cx, element.doc());
    element.synced_engine(cx, |document, id| {
        now.into_iter().for_each(|it| document.smil.set_time(it));
        run(document, id)
    })
}

#[optimize(size)]
fn control<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    run: impl FnOnce(&mut Document, NodeId),
) {
    inspect(cx, element, run);
    element.doc().invalidate(cx);
}

impl SVGSVGElement {
    pub(crate) fn pause_animations<'a>(&'a self, cx: &mut JsScope<'a>) {
        control(cx, self, |document, id| document.pause_smil(id, true));
    }

    pub(crate) fn unpause_animations<'a>(&'a self, cx: &mut JsScope<'a>) {
        control(cx, self, |document, id| document.pause_smil(id, false));
    }

    pub(crate) fn animations_paused<'a>(&'a self, cx: &mut JsScope<'a>) -> bool {
        inspect(cx, self, Document::is_smil_paused)
    }

    pub(crate) fn get_current_time<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        inspect(cx, self, Document::smil_time) as f32
    }

    pub(crate) fn set_current_time<'a>(&'a self, cx: &mut JsScope<'a>, seconds: f32) {
        control(cx, self, |document, id| {
            document.seek_smil(id, seconds.max(0.0).into())
        });
    }
}

#[optimize(size)]
fn target_of<'a>(cx: &mut JsScope<'a>, element: &'a Element) -> Option<&'a Element> {
    let (scope, href) = (
        element.scope()?,
        super::href(element).filter(|it| !it.is_empty()),
    );
    let target = match href {
        Some(href) => {
            let (url, own) = (resolve(cx, element.doc(), &href)?, element.doc().url());
            let (url, own) = (url.to_utf8(), own.to_utf8());
            let (_, fragment) = split_once_char(url.as_bytes(), b'#').filter(|it| {
                href.unit(0) == u16::from(b'#') || Some(text(it.0)) == split(&own, "#").next()
            })?;
            scope.element_by_id(&Atom::new(text(&crate::svg::percent_decoded(fragment))))
        }
        None => element.parent_element(),
    };
    target.filter(|it| it.ns() == Ns::Svg)
}

impl SVGAnimationElement {
    pub(crate) fn get_target_element<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a Element> {
        target_of(cx, self)
    }

    pub(crate) fn get_start_time<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<f32, Failure> {
        let [time, ..] = inspect(cx, self, Document::smil_times);
        if time == f64::INFINITY {
            Err(Failure::invalid_state("No current interval."))
        } else {
            Ok(time as f32)
        }
    }

    pub(crate) fn get_current_time<'a>(&'a self, cx: &mut JsScope<'a>) -> f32 {
        inspect(cx, self, Document::smil_times)[1] as f32
    }

    pub(crate) fn get_simple_duration<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<f32, Failure> {
        match inspect(cx, self, Document::smil_times)[2] {
            f64::INFINITY => Err(Failure::Dom(
                DOMExceptionCode::NotSupportedError,
                "No simple duration defined.",
            )),
            time => Ok(time as f32),
        }
    }

    pub(crate) fn begin_element<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.begin_element_at(cx, 0.0);
    }

    pub(crate) fn begin_element_at<'a>(&'a self, cx: &mut JsScope<'a>, offset: f32) {
        control(cx, self, |document, id| {
            document.add_smil_instance(id, Instance::Begin, offset.into())
        });
    }

    pub(crate) fn end_element<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.end_element_at(cx, 0.0);
    }

    pub(crate) fn end_element_at<'a>(&'a self, cx: &mut JsScope<'a>, offset: f32) {
        control(cx, self, |document, id| {
            document.add_smil_instance(id, Instance::End, offset.into())
        });
    }
}

/// https://svgwg.org/specs/animations/#EventValueSyntax
struct EventValue {
    id: Option<String>,
    event: String,
    offset: f64,
}

/// Up to the first character that is not escaped and ends it, without the backslashes.
fn unescaped(source: &str, ends: impl Fn(char) -> bool) -> (String, &str) {
    let (mut name, mut characters) = (String::new(), source.char_indices());
    while let Some((at, character)) = characters.next() {
        match character {
            '\\' => name.extend(characters.next().map(|it| it.1)),
            _ if ends(character) => return (name, &source[at..]),
            _ => name.push(character),
        }
    }
    (name, "")
}

impl EventValue {
    #[optimize(size)]
    fn parse(source: &str) -> Option<EventValue> {
        let source = source.trim_ascii();
        let (id, after_id) = unescaped(source, |it| it == '.');
        let with_id = after_id
            .strip_prefix('.')
            .and_then(|rest| EventValue::after_id(Some(id), rest));
        let value = with_id.or_else(|| EventValue::after_id(None, source))?;
        let is_other = value.event.starts_with(|it: char| it.is_ascii_digit())
            || value.event == "indefinite"
            || value.event.starts_with("repeat(");
        let is_about_id = |id: &String| {
            !id.bytes().all(|it| it.is_ascii_digit()) && !matches!(&*value.event, "begin" | "end")
        };
        (!is_other && value.id.as_ref().is_none_or(is_about_id)).then_some(value)
    }

    #[optimize(size)]
    fn after_id(id: Option<String>, source: &str) -> Option<EventValue> {
        let (event, rest) = unescaped(source, |it| {
            matches!(it, '+' | '-' | '.') || it.is_ascii_whitespace()
        });
        let offset = match rest.trim_ascii_start().split_at_checked(1) {
            None => 0.0,
            Some((sign @ ("+" | "-"), clock)) => {
                let clock = clock.trim_ascii_start();
                let (amount, unit) = clock.split_at(
                    clock
                        .bytes()
                        .take_while(|it| it.is_ascii_digit() || *it == b'.')
                        .count(),
                );
                let seconds = [
                    ("", 1.0),
                    ("s", 1.0),
                    ("ms", 0.001),
                    ("min", 60.0),
                    ("h", 3600.0),
                ]
                .into_iter()
                .find(|it| it.0 == unit)?
                .1;
                amount.parse::<f64>().ok()? * if sign == "-" { -seconds } else { seconds }
            }
            _ => return None,
        };
        (!event.is_empty()).then_some(EventValue { id, event, offset })
    }
}

#[optimize(size)]
fn add_instance<'a>(
    cx: &mut JsScope<'a>,
    [element, ends]: [JsLocal<'a>; 2],
    offset: u64,
    _: &[JsLocal<'a>],
) -> bindgen::Result<'a, JSValue> {
    if let Some(element) = Node::from_js(&cx.heap, element.to_js()).and_then(Node::as_element) {
        control(cx, element, |document, id| {
            document.add_smil_instance(
                id,
                if ends.to_js().to_boolean() {
                    Instance::EndIfActive
                } else {
                    Instance::Begin
                },
                f64::from_bits(offset),
            )
        });
    }
    Ok(JSValue::UNDEFINED)
}

/// The edge has a target, a type and a callback for each listener.
#[optimize(size)]
fn listen<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    let listeners = element.edge_list(&cx.heap, Edge::SmilListeners);
    for at in (0..listeners.len()).step_by(3) {
        if let Some(target) = Node::from_js(&cx.heap, listeners.get(at)) {
            remove_listener(cx, target, listeners.get(at + 1), listeners.get(at + 2));
        }
    }
    listeners.clear(&cx.heap);
    let Some(scope) = element.scope().filter(|_| element.is_rendered()) else {
        return;
    };
    for (attribute, ends) in [(atom!("begin"), false), (atom!("end"), true)] {
        let values = element.with_attr(attribute, |it| {
            split(it, ";")
                .filter_map(EventValue::parse)
                .collect::<Vec<_>>()
        });
        for value in values.into_iter().flatten() {
            let base = match &value.id {
                Some(id) => scope.element_by_id(&Atom::new(id)),
                None => target_of(cx, element),
            };
            let Some(base) = base else { continue };
            let event = Atom::new(&value.event).to_js(&cx.heap).to_js();
            let callback = cx
                .heap
                .create_callback(
                    add_instance,
                    [element.to_js(), JSValue::js_boolean(ends)],
                    value.offset.to_bits(),
                )
                .to_js();
            [base.to_js(), event, callback]
                .into_iter()
                .for_each(|it| listeners.push(&cx.heap, it));
            add_listener(cx, base, event, callback, false);
        }
    }
}

fn listen_when_parsed<'a>(
    cx: &mut JsScope<'a>,
    [element, _]: [JsLocal<'a>; 2],
    _: u64,
    _: &[JsLocal<'a>],
) -> bindgen::Result<'a, JSValue> {
    Node::from_js(&cx.heap, element.to_js())
        .and_then(Node::as_element)
        .into_iter()
        .for_each(|it| listen(cx, it));
    Ok(JSValue::UNDEFINED)
}

pub(crate) static ANIMATION_STEPS: Steps = Steps {
    post_connection: Some(|cx, element, _| {
        if element.doc().ready_state() != ReadyState::Loading {
            return listen(cx, element);
        }
        let callback = cx
            .heap
            .create_callback(listen_when_parsed, [element.to_js(), JSValue::UNDEFINED], 0)
            .to_js();
        let event = Atom::from(atom!("readystatechange"))
            .to_js(&cx.heap)
            .to_js();
        add_listener(cx, element.doc(), event, callback, true);
    }),
    removed: Some(|cx, element, _, _| listen(cx, element)),
    attribute_changed: Some(|cx, element, change| {
        let matters = matches!(
            change.name.local.known(),
            atom!("begin") | atom!("end") | atom!("href")
        );
        if matters && element.doc().ready_state() != ReadyState::Loading {
            listen(cx, element);
        }
    }),
    ..Steps::NONE
};
