//! <https://w3c.github.io/trusted-types/dist/spec/>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSString, JSValue};
use bun_web::client::Client;
use bun_web::realm::Realm;
use bun_web::url::Url;
use smallvec::SmallVec;

use crate::api::core::*;
use crate::api::events::is_handler_attribute;
use crate::generated_bindgen::trusted::{
    TrustedHTML, TrustedMembers, TrustedScript, TrustedScriptURL, TrustedTypePolicyOptions,
    js_TrustedHTML, js_TrustedScript, js_TrustedScriptURL, js_TrustedTypePolicy as js_Policy,
    js_TrustedTypePolicyFactory as js_Factory,
};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

/// By a realm of this thread.
#[thread_local]
static IS_REQUIRED: Cell<bool> = Cell::new(false);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Trusted {
    Html,
    Script,
    ScriptUrl,
}

#[repr(C)]
pub(crate) struct TrustedString(DomString, bun_jsc::bindgen::Interior);

impl TrustedMembers {
    pub(crate) fn text(&self) -> &DomString {
        let TrustedString(text, _) = &**self;
        text
    }
}

impl Trusted {
    fn name(self) -> &'static str {
        match self {
            Trusted::Html => "TrustedHTML",
            Trusted::Script => "TrustedScript",
            Trusted::ScriptUrl => "TrustedScriptURL",
        }
    }

    fn create<'a>(self, heap: &JsHeap<'a>, text: DomString) -> &'a TrustedString {
        match self {
            Trusted::Html => js_TrustedHTML::create(heap, TrustedString(text, Default::default())),
            Trusted::Script => {
                js_TrustedScript::create(heap, TrustedString(text, Default::default()))
            }
            Trusted::ScriptUrl => {
                js_TrustedScriptURL::create(heap, TrustedString(text, Default::default()))
            }
        }
    }

    fn text_of<'a>(self, heap: &JsHeap<'a>, value: JSValue) -> Option<&'a DomString> {
        let it = TrustedString::from_js(heap, value)?;
        let is_one = match self {
            Trusted::Html => it.is_a::<TrustedHTML>(),
            Trusted::Script => it.is_a::<TrustedScript>(),
            Trusted::ScriptUrl => it.is_a::<TrustedScriptURL>(),
        };
        is_one.then_some(&it.0)
    }

    fn stringify<'a>(self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, DomString> {
        let text = DomString::from_js(cx, value)?;
        Ok(if self == Trusted::ScriptUrl {
            text.into_well_formed()
        } else {
            text
        })
    }

    /// <https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-compliant-string-algorithm>
    #[inline]
    pub(crate) fn string_in_realm_of<'a>(
        self,
        cx: Cx<'_, 'a>,
        object: &'a impl JsInterface,
        value: JsLocal<'a>,
        sink: &str,
    ) -> Result<'a, DomString> {
        if let Some(text) = self.text_of(&cx.heap, value.to_js()) {
            return Ok(text.clone());
        }
        let text = self.stringify(cx, value)?;
        self.check(cx, object, text, sink)
    }

    #[inline]
    pub(crate) fn string_for<'a>(
        self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        value: JsLocal<'a>,
        sink: &str,
    ) -> Result<'a, DomString> {
        self.string_in_realm_of(cx, node.doc(), value, sink)
    }

    /// `[LegacyNullToEmptyString]`
    #[inline]
    pub(crate) fn string_or_empty_for<'a>(
        self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        value: JsLocal<'a>,
        sink: &str,
    ) -> Result<'a, DomString> {
        let value = if value.to_js().is_null() {
            Atom::EMPTY.to_js(&cx.heap).as_value()
        } else {
            value
        };
        self.string_for(cx, node, value, sink)
    }

    #[inline]
    pub(crate) fn check<'a>(
        self,
        cx: Cx<'_, 'a>,
        object: &'a impl JsInterface,
        text: DomString,
        sink: &str,
    ) -> Result<'a, DomString> {
        match IS_REQUIRED
            .get()
            .then(|| Factory::if_required(object.realm(&cx.heap)))
            .flatten()
        {
            Some(factory) => factory.convert(cx, self, text, sink, None),
            None => Ok(text),
        }
    }
}

/// `sink` is empty for an event handler.
fn attribute_sink(
    element_ns: &Ns,
    tag: Known,
    ns: &Ns,
    name: &Atom,
) -> Option<(Trusted, &'static str)> {
    Some(match (element_ns, tag, ns, name.known()) {
        (Ns::Html, atom!("iframe"), Ns::None, atom!("srcdoc")) => {
            (Trusted::Html, "HTMLIFrameElement srcdoc")
        }
        (Ns::Html, atom!("script"), Ns::None, atom!("src")) => {
            (Trusted::ScriptUrl, "HTMLScriptElement src")
        }
        (Ns::Html, atom!("embed"), Ns::None, atom!("src")) => {
            (Trusted::ScriptUrl, "HTMLEmbedElement src")
        }
        (Ns::Html, atom!("object"), Ns::None, atom!("data")) => {
            (Trusted::ScriptUrl, "HTMLObjectElement data")
        }
        (Ns::Html, atom!("object"), Ns::None, atom!("codebase")) => {
            (Trusted::ScriptUrl, "HTMLObjectElement codebase")
        }
        (Ns::Svg, atom!("script"), Ns::None | Ns::XLink, atom!("href")) => {
            (Trusted::ScriptUrl, "SVGScriptElement href")
        }
        (Ns::Html | Ns::Svg | Ns::MathMl, _, Ns::None, _) if is_handler_attribute(name) => {
            (Trusted::Script, "")
        }
        _ => return None,
    })
}

#[cold]
fn check_attribute<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    name: &QualName,
    value: JsLocal<'a>,
) -> Result<'a, DomString> {
    match attribute_sink(&element.ns(), element.tag(), &name.ns, &name.local) {
        Some((kind, "")) => kind.string_for(
            cx,
            element,
            value,
            &format!("Element {}", name.local.as_utf8()),
        ),
        Some((kind, sink)) => kind.string_for(cx, element, value, sink),
        None => match TrustedString::from_js(&cx.heap, value.to_js()) {
            Some(it) => Ok(it.0.clone()),
            None => DomString::from_js(cx, value),
        },
    }
}

impl Element {
    /// <https://w3c.github.io/trusted-types/dist/spec/#validate-attribute-mutation>
    #[inline]
    pub(crate) fn compliant_attribute_value<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &QualName,
        value: JsLocal<'a>,
    ) -> Result<'a, DomString> {
        match value.as_string().filter(|_| !IS_REQUIRED.get()) {
            Some(value) => DomString::from_js_string(&cx.heap, value),
            None => check_attribute(cx, self, name, value),
        }
    }

    pub(crate) fn compliant_attribute_text<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &QualName,
        text: DomString,
    ) -> Result<'a, DomString> {
        if !IS_REQUIRED.get() {
            return Ok(text);
        }
        let value = text.to_js(&cx.heap).as_value();
        check_attribute(cx, self, name, value)
    }
}

impl Doc {
    /// <https://html.spec.whatwg.org/#document-write-steps>
    pub(crate) fn text_to_write<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        texts: &[JsLocal<'a>],
        end: &str,
        sink: &str,
    ) -> Result<'a, DomString> {
        let (mut all, mut is_trusted) = (StringBuilder::default(), true);
        for it in texts {
            match Trusted::Html.text_of(&cx.heap, it.to_js()) {
                Some(text) => all.push(text),
                None => {
                    is_trusted = false;
                    all.push(&DomString::from_js(cx, *it)?);
                }
            }
        }
        let all = if is_trusted {
            all.finish()
        } else {
            Trusted::Html.check(cx, self, all.finish(), sink)?
        };
        Ok(if end.is_empty() {
            all
        } else {
            DomString::concat(&[&all, &end.into()])
        })
    }
}

/// <https://w3c.github.io/trusted-types/dist/spec/#require-trusted-types-for-pre-navigation-check>
pub(crate) fn source_of_javascript_url<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    source: DomString,
) -> Option<DomString> {
    const SINK: &str = "Location href";
    let Some(factory) = Factory::if_required(doc.realm(&cx.heap)) else {
        return Some(source);
    };
    let converted = factory
        .apply_default_policy(cx, Trusted::Script, &source, SINK)
        .map_err(|it| cx.catch(it))
        .ok()
        .flatten();
    let converted = converted
        .filter(|it| Url::parse(&[b"javascript:", it.to_utf8().as_bytes()].concat()).is_some());
    converted.or_else(|| {
        factory
            .is_allowed(&cx.heap, |it| {
                it.allows_string_for(SINK.as_bytes(), source.to_utf8().as_bytes())
            })
            .then_some(source)
    })
}

// ───────────────────────────── policies ─────────────────────────────

#[repr(C)]
pub(crate) struct Policy {
    name: DomString,
    _interior: bun_jsc::bindgen::Interior,
}

impl Policy {
    fn callback(&self, kind: Trusted) -> Option<JSValue> {
        match kind {
            Trusted::Html => js_Policy::create_html(self),
            Trusted::Script => js_Policy::create_script(self),
            Trusted::ScriptUrl => js_Policy::create_script_url(self),
        }
    }

    /// <https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-policy-value-algorithm>
    fn value<'a>(
        cx: Cx<'_, 'a>,
        kind: Trusted,
        callback: JSValue,
        arguments: &[JSValue],
    ) -> Result<'a, Option<DomString>> {
        let result = callback.call(cx.global(), JSValue::UNDEFINED, arguments)?;
        if result.is_undefined_or_null() {
            return Ok(None);
        }
        let result = JsLocal::new(&cx.heap, result);
        kind.stringify(cx, result).map(Some)
    }

    fn create<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: Trusted,
        input: JsLocal<'a, JSString>,
        rest: &[JsLocal<'a>],
    ) -> Result<'a, &'a TrustedString> {
        let Some(callback) = self.callback(kind) else {
            let (name, member) = (self.name.to_utf8(), &kind.name()["Trusted".len()..]);
            return Err(cx.heap.type_error(format_args!(
                "Policy {name}'s TrustedTypePolicyOptions did not specify 'create{member}'."
            )));
        };
        let arguments: SmallVec<[_; 4]> = core::iter::once(input.to_js())
            .chain(rest.iter().map(|it| it.to_js()))
            .collect();
        let text = Policy::value(cx, kind, callback, &arguments)?.unwrap_or_default();
        Ok(kind.create(self.realm(&cx.heap), text))
    }

    pub(crate) fn get_name(&self) -> &DomString {
        &self.name
    }

    pub(crate) fn create_html<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        input: JsLocal<'a, JSString>,
        rest: &[JsLocal<'a>],
    ) -> Result<'a, &'a TrustedString> {
        self.create(cx, Trusted::Html, input, rest)
    }

    pub(crate) fn create_script<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        input: JsLocal<'a, JSString>,
        rest: &[JsLocal<'a>],
    ) -> Result<'a, &'a TrustedString> {
        self.create(cx, Trusted::Script, input, rest)
    }

    pub(crate) fn create_script_url<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        input: JsLocal<'a, JSString>,
        rest: &[JsLocal<'a>],
    ) -> Result<'a, &'a TrustedString> {
        self.create(cx, Trusted::ScriptUrl, input, rest)
    }
}

#[derive(Default)]
#[repr(C)]
pub(crate) struct Factory {
    names: RefCell<Vec<DomString>>,
    is_required: Cell<bool>,
}

fn html_if_empty(ns: Option<&Atom>) -> Ns {
    ns.filter(|it| !it.is_empty())
        .map_or(Ns::Html, |it| Ns::from_uri(Some(it)))
}

impl Factory {
    fn if_required<'a>(realm: &JsHeap<'a>) -> Option<&'a Factory> {
        Factory::of_realm(realm).filter(|it| it.is_required.get())
    }

    pub(crate) fn for_realm<'a>(heap: &JsHeap<'a>) -> &'a Factory {
        Factory::of_realm(heap).unwrap_or_else(|| {
            let made = js_Factory::create(heap, Factory::default());
            made.set_of_realm(heap);
            made
        })
    }

    fn is_allowed(&self, heap: &JsHeap<'_>, ask: impl FnOnce(&Client) -> bool) -> bool {
        Realm::of(global_of(self.realm(heap)))
            .and_then(Realm::client)
            .is_none_or(|it| ask(&it))
    }

    fn apply_default_policy<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: Trusted,
        text: &DomString,
        sink: &str,
    ) -> Result<'a, Option<DomString>> {
        let Some(callback) = js_Factory::default_policy(self).and_then(|it| it.callback(kind))
        else {
            return Ok(None);
        };
        let arguments = [
            text.to_js(&cx.heap).to_js(),
            DomString::from(kind.name()).to_js(&cx.heap).to_js(),
            DomString::from(sink).to_js(&cx.heap).to_js(),
        ];
        Policy::value(cx, kind, callback, &arguments)
    }

    #[cold]
    fn convert<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: Trusted,
        text: DomString,
        sink: &str,
        sample: Option<&DomString>,
    ) -> Result<'a, DomString> {
        if let Some(converted) = self.apply_default_policy(cx, kind, &text, sink)? {
            return Ok(converted);
        }
        if self.is_allowed(&cx.heap, |it| {
            it.allows_string_for(
                sink.as_bytes(),
                sample.unwrap_or(&text).to_utf8().as_bytes(),
            )
        }) {
            return Ok(text);
        }
        Err(cx.heap.type_error(format_args!(
            "This document requires '{}' assignment.",
            kind.name()
        )))
    }

    pub(crate) fn create_policy<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: DomString,
        options: &TrustedTypePolicyOptions<'a>,
    ) -> Result<'a, &'a Policy> {
        let (is_taken, is_default) = (self.names.borrow().contains(&name), name.eq_str("default"));
        if !self.is_allowed(&cx.heap, |it| {
            it.allows_type_policy(name.to_utf8().as_bytes(), is_taken)
        }) || (is_default && is_taken)
        {
            return Err(cx
                .heap
                .type_error(format_args!("Policy \"{}\" disallowed.", name.to_utf8())));
        }
        self.names.borrow_mut().push(name.clone());
        let policy = js_Policy::create(
            self.realm(&cx.heap),
            Policy {
                name,
                _interior: Default::default(),
            },
        );
        js_Policy::set_create_html(
            policy,
            options.create_html.map_or(JSValue::ZERO, JsLocal::to_js),
        );
        js_Policy::set_create_script(
            policy,
            options.create_script.map_or(JSValue::ZERO, JsLocal::to_js),
        );
        js_Policy::set_create_script_url(
            policy,
            options
                .create_script_url
                .map_or(JSValue::ZERO, JsLocal::to_js),
        );
        if is_default {
            js_Factory::set_default_policy(self, Some(policy));
        }
        Ok(policy)
    }

    pub(crate) fn is_html(&self, _: &JsHeap<'_>, value: JsLocal<'_>) -> bool {
        TrustedHTML::is(value.to_js())
    }

    pub(crate) fn is_script(&self, _: &JsHeap<'_>, value: JsLocal<'_>) -> bool {
        TrustedScript::is(value.to_js())
    }

    pub(crate) fn is_script_url(&self, _: &JsHeap<'_>, value: JsLocal<'_>) -> bool {
        TrustedScriptURL::is(value.to_js())
    }

    pub(crate) fn get_empty_html<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TrustedString {
        Trusted::Html.create(self.realm(heap), DomString::default())
    }

    pub(crate) fn get_empty_script<'a>(&'a self, heap: &JsHeap<'a>) -> &'a TrustedString {
        Trusted::Script.create(self.realm(heap), DomString::default())
    }

    pub(crate) fn get_attribute_type(
        &self,
        tag: &Atom,
        attribute: &Atom,
        element_ns: Option<&Atom>,
        ns: Option<&Atom>,
    ) -> Option<&'static [u8]> {
        let ns = Ns::from_uri(ns.filter(|it| !it.is_empty()));
        attribute_sink(
            &html_if_empty(element_ns),
            tag.to_ascii_lowercase().known(),
            &ns,
            &attribute.to_ascii_lowercase(),
        )
        .map(|it| it.0.name().as_bytes())
    }

    pub(crate) fn get_property_type(
        &self,
        tag: &Atom,
        property: &Atom,
        element_ns: Option<&Atom>,
    ) -> Option<&'static [u8]> {
        let tag = if html_if_empty(element_ns) == Ns::Html {
            tag.to_ascii_lowercase().known()
        } else {
            Known::Other
        };
        let kind = match (tag, &*property.as_utf8()) {
            (_, "innerHTML" | "outerHTML") | (atom!("iframe"), "srcdoc") => Trusted::Html,
            (atom!("script"), "innerText" | "text" | "textContent") => Trusted::Script,
            (atom!("script") | atom!("embed"), "src") | (atom!("object"), "data" | "codeBase") => {
                Trusted::ScriptUrl
            }
            _ => return None,
        };
        Some(kind.name().as_bytes())
    }
}

/// <https://w3c.github.io/webappsec-csp/#can-compile-strings>. `parts` are the arguments of a function constructor.
fn may_compile<'a>(
    cx: Cx<'_, 'a>,
    code: &DomString,
    parts: Option<&[JSValue]>,
) -> Result<'a, bool> {
    let Some(factory) = Factory::if_required(&cx.heap) else {
        return Ok(true);
    };
    if factory.is_allowed(&cx.heap, |it| it.policies().csp.allows_trusted_types_eval())
        || parts.is_some_and(|it| it.iter().all(|it| TrustedScript::is(*it)))
    {
        return Ok(true);
    }
    let after_name = |_| {
        let at = code
            .units()
            .position(|it| it == u16::from(b'('))
            .unwrap_or(0) as u32;
        code.substring(at, code.len() - at)
    };
    let sample = parts.map(after_name);
    match factory.convert(
        cx,
        Trusted::Script,
        code.clone(),
        if parts.is_some() { "Function" } else { "eval" },
        sample.as_ref(),
    ) {
        Ok(converted) => Ok(converted == *code),
        Err(error) => cx.catch(error).map(|_| false),
    }
}

/// # Safety
/// `parts` is null, or there are `count` of them.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__DOM__mayCompile(
    global: &JSGlobalObject,
    code: JSValue,
    parts: *const JSValue,
    count: usize,
    is_function: bool,
) -> bool {
    let check = |cx: Cx<'_, '_>| {
        // SAFETY: per the contract.
        let parts = is_function.then(|| unsafe { bun_core::ffi::slice(parts, count) });
        let result = DomString::from_js(cx, JsLocal::new(&cx.heap, code)).and_then(|code| {
            Ok(may_compile(cx, &code, parts)?
                && Realm::of(global).is_none_or(|it| it.allows_eval(code.to_utf8().as_bytes())))
        });
        result
            .map_err(|it| it.into_js_error(global))
            .unwrap_or(false)
    };
    // SAFETY: a script is calling.
    unsafe { JsScope::with(global.as_mut_ptr(), check) }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__textOfTrustedScript(global: &JSGlobalObject, value: JSValue) -> JSValue {
    let heap = JsHeap::from_global(global);
    Trusted::Script
        .text_of(heap, value)
        .map_or(JSValue::UNDEFINED, |it| it.to_js(heap).to_js())
}

#[unsafe(no_mangle)]
fn __bun_dom_apply_policy(realm: &JSGlobalObject, is_for_new_document: bool) {
    apply_policy(JsHeap::from_global(realm), is_for_new_document);
}

/// What the Content Security Policy says about strings that become code.
pub(crate) fn apply_policy(heap: &JsHeap<'_>, is_for_new_document: bool) {
    if Realm::of(global_of(heap)).is_some_and(|it| it.apply_policy(is_for_new_document)) {
        require_trusted_types(heap);
    } else if is_for_new_document {
        Factory::of_realm(heap).inspect(|it| it.is_required.set(false));
    }
}

fn require_trusted_types(heap: &JsHeap<'_>) {
    Factory::for_realm(heap).is_required.set(true);
    IS_REQUIRED.set(true);
}
