//! <https://html.spec.whatwg.org/#event-handler-idl-attributes>

use bun_alloc::WTFStringImplStruct;
use bun_jsc::JSGlobalObject;
use bun_jsc::bindgen::JsLocal;

use super::listeners::Is;
use super::*;
use crate::api::loading::allows_handler_attribute;
use crate::generated_bindgen::attributes::{
    Handler, HandlerOfWindow, js_ClipboardHandlers, js_DocumentAndElementEventHandlers,
    js_GlobalEventHandlers, js_WindowEventHandlers, js_WindowReflectingHandlers,
};

unsafe extern "C" {
    /// `texts`: the name, the parameters, the body, the URL and the base URL. `scopes`: from the outside in.
    safe fn Bun__DesktopRealm__compileHandler(
        realm: &JSGlobalObject,
        texts: &[&WTFStringImplStruct; 5],
        scopes: &[JSValue; 3],
    ) -> JSValue;
}

fn event_of(attribute: &WTFStringImplStruct) -> Atom {
    event_named(attribute.latin1_slice())
}

fn event_named(attribute: &[u8]) -> Atom {
    Atom::from_latin1(match &attribute["on".len()..] {
        b"begin" => b"beginEvent",
        b"end" => b"endEvent",
        b"repeat" => b"repeatEvent",
        b"webkitanimationend" => b"webkitAnimationEnd",
        b"webkitanimationiteration" => b"webkitAnimationIteration",
        b"webkitanimationstart" => b"webkitAnimationStart",
        b"webkittransitionend" => b"webkitTransitionEnd",
        name => name,
    })
}

const OF_ELEMENTS: [&[&str]; 4] = [
    &js_GlobalEventHandlers::NAMES,
    &js_DocumentAndElementEventHandlers::NAMES,
    &js_ClipboardHandlers::NAMES,
    &["onfocusin", "onfocusout"],
];
const OF_ANIMATIONS: [&str; 3] = ["onbegin", "onend", "onrepeat"];
const WITHOUT_EFFECT: [&str; 7] = [
    "onencrypted",
    "onfullscreenchange",
    "onfullscreenerror",
    "onsearch",
    "onwaitingforkey",
    "onwebkitfullscreenchange",
    "onwebkitfullscreenerror",
];

/// Of any element.
pub(crate) fn is_handler_attribute(name: &Atom) -> bool {
    let name = name.as_utf8();
    name.starts_with("on")
        && OF_ELEMENTS
            .into_iter()
            .chain([
                &js_WindowEventHandlers::NAMES[..],
                &OF_ANIMATIONS,
                &WITHOUT_EFFECT,
            ])
            .any(|it| it.binary_search(&&*name).is_ok())
}

fn is_for_window(element: &Element, attribute: &str) -> bool {
    let is_among = |names: &[&str]| names.binary_search(&attribute).is_ok();
    match element.kind() {
        Kind::SvgSvg => is_among(&js_WindowEventHandlers::NAMES),
        Kind::Body | Kind::FrameSet => {
            is_among(&js_WindowEventHandlers::NAMES)
                || is_among(&js_WindowReflectingHandlers::NAMES)
        }
        _ => false,
    }
}

fn is_for_element(element: &Element, attribute: &str) -> bool {
    OF_ELEMENTS
        .iter()
        .any(|it| it.binary_search(&attribute).is_ok())
        || element.kind().is_svg() && OF_ANIMATIONS.contains(&attribute)
}

/// <https://html.spec.whatwg.org/#event-handler-content-attributes>
pub(crate) fn handler_attribute_changed<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    attribute: &Atom,
    value: Option<&DomString>,
) {
    let (name, window) = (attribute.as_utf8(), element.doc().window());
    let target: Option<&EventTarget> = match is_for_window(element, &name) {
        true => window.map(|it| &**it),
        false => is_for_element(element, &name).then_some(element),
    };
    let Some(target) = target else { return };
    if value.is_some_and(|it| !allows_handler_attribute(cx, element, it)) {
        return;
    }
    let source = value.map_or(JSValue::NULL, |it| {
        let parts = [
            it.to_js(&cx.heap).to_js(),
            attribute.to_js(&cx.heap).to_js(),
            element.to_js(),
            window.map_or(JSValue::NULL, |it| it.to_js()),
        ];
        List::from_fn(&cx.heap, parts.len() as u32, |at| parts[at as usize]).to_js()
    });
    target.put_handler(
        &cx.heap,
        &event_named(name.as_bytes()),
        Is::HANDLER | Is::UNCOMPILED,
        source,
    );
}

/// Of what `handler_attribute_changed` has kept. `None` if it is to be tried again.
pub(super) fn compile<'a>(
    cx: Cx<'_, 'a>,
    target: &'a EventTarget,
    source: JSValue,
) -> Option<JSValue> {
    let [body, attribute, element, allowed_by] =
        [0, 1, 2, 3].map(|it| List::from_value(source).get(it));
    let element = Element::from_js(&cx.heap, element)?;
    let (doc, is_for_window) = (element.doc(), target.as_window().is_some());
    let window = doc.window()?;
    let body =
        DomString::from_js_string(&cx.heap, JsLocal::new(&cx.heap, body).as_string()?).ok()?;
    if allowed_by != window.to_js() && !allows_handler_attribute(cx, element, &body) {
        return Some(JSValue::NULL);
    }
    if !doc.runs_scripts() {
        return Some(JSValue::NULL);
    }
    let attribute =
        DomString::from_js_string(&cx.heap, JsLocal::new(&cx.heap, attribute).as_string()?).ok()?;
    let parameters = match element.kind().is_svg() {
        true => DomString::from("evt"),
        false if is_for_window && attribute.eq_str("onerror") => {
            DomString::from("event, source, lineno, colno, error")
        }
        false => Atom::from(atom!("event")).to_dom_string(),
    };
    let scopes = match is_for_window && element.kind().is_html() {
        true => [JSValue::UNDEFINED; 3],
        false => [
            doc.to_js(),
            crate::api::forms::form_owner(element)
                .filter(|_| crate::api::forms::is_listed(element) || element.is_html(atom!("img")))
                .map_or(JSValue::UNDEFINED, |it| it.to_js()),
            element.to_js(),
        ],
    };
    let (texts, realm) = (
        [attribute, parameters, body, doc.url(), doc.base_url()],
        global_of(window.realm(&cx.heap)),
    );
    let compiled = bun_jsc::call_zero_is_throw(realm, || {
        Bun__DesktopRealm__compileHandler(realm, &texts.each_ref().map(DomString::as_impl), &scopes)
    });
    Some(compiled.unwrap_or_else(|error| {
        script::report(cx, Some(window), error);
        JSValue::NULL
    }))
}

impl Handler {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: &WTFStringImplStruct) -> JSValue {
        self.handler(cx, &event_of(name))
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
        value: JsLocal<'a>,
    ) {
        self.set_handler(&cx.heap, &event_of(name), value.to_js());
    }
}

impl HandlerOfWindow {
    pub(crate) fn get<'a>(&'a self, cx: Cx<'_, 'a>, name: &WTFStringImplStruct) -> JSValue {
        self.doc()
            .window()
            .map_or(JSValue::NULL, |it| it.handler(cx, &event_of(name)))
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
        value: JsLocal<'a>,
    ) {
        if let Some(window) = self.doc().window() {
            window.set_handler(&cx.heap, &event_of(name), value.to_js());
        }
    }
}
