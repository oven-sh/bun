//! What document.bind.ts declares.

use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSObject, JSString, JSValue};

use super::{NodeFlags as F, *};
use crate::api::loading;
use crate::generated_bindgen::document::{
    BodyColor, DOMImplementation, DocumentMembers, SubtreeOrOptions, js_DOMImplementation,
    js_FragmentDirective,
};

unsafe extern "C" {
    safe fn Bun__DOM__inherit(global: &JSGlobalObject, object: JSValue, prototype: JSValue);
}

type Str<'a> = JsLocal<'a, JSString>;
type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

impl Doc {
    pub(crate) fn new_xml_document<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: Kind,
        content_type: &str,
    ) -> &'a Doc {
        let doc = self.new_windowless(cx, kind);
        doc.set_doc_flags(DocFlags::IS_XML, true);
        doc.set_content_type(content_type.into());
        doc
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        new_target: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        let prototype = if new_target.to_js() == Doc::interface_object(&cx.heap) {
            None
        } else {
            new_target.to_js().get(cx.global(), "prototype")?
        };
        let doc =
            seams::current_document(cx)?.new_xml_document(cx, Kind::Document, "application/xml");
        if let Some(prototype) = prototype.filter(|it| it.is_object()) {
            Bun__DOM__inherit(cx.global(), doc.to_js(), prototype);
        }
        Ok(doc.to_js())
    }
}

fn fulfilled_with<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, JSValue> {
    let promise = cx.heap.create_promise();
    promise.resolve(cx, value)?;
    Ok(promise.to_js())
}

impl DOMImplementation {
    fn doc(&self) -> &Doc {
        js_DOMImplementation::document(self).expect("set when it is made")
    }

    pub(crate) fn create_document_type<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Atom,
        public_id: DomString,
        system_id: DomString,
    ) -> Result<'a, &'a Node> {
        if name
            .to_dom_string()
            .units()
            .any(|it| it == 0 || it == u16::from(b'>') || is_ascii_whitespace(it))
        {
            return Err(dom_error(
                heap,
                DomError::InvalidCharacterError,
                "The name is not valid.",
            ));
        }
        Ok(self.doc().create_doctype(heap, name, public_id, system_id))
    }

    pub(crate) fn create_document<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        name: Str<'a>,
        doctype: Option<&'a DocumentType>,
    ) -> Result<'a, &'a Doc> {
        let content_type = match Ns::from_uri(
            ns.map(|it| Atom::from_js_string(&cx.heap, it))
                .transpose()?
                .as_ref(),
        ) {
            Ns::Html => "application/xhtml+xml",
            Ns::Svg => "image/svg+xml",
            _ => "application/xml",
        };
        let doc = self
            .doc()
            .new_xml_document(cx, Kind::XmlDocument, content_type);
        let root = if DomString::from_js_string(&cx.heap, name)?.is_empty() {
            None
        } else {
            Some(doc.create_element_ns(cx, ns, name, JsLocal::UNDEFINED)?)
        };
        for child in [doctype.map(|it| &**it), root.map(|it| &**it)]
            .into_iter()
            .flatten()
        {
            append(cx, child, doc)?;
        }
        Ok(doc)
    }

    pub(crate) fn create_html_document<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        title: Option<DomString>,
    ) -> &'a Doc {
        let doc = self.doc().new_windowless(cx, Kind::HtmlDocument);
        let [html, head, body] =
            [atom!("html"), atom!("head"), atom!("body")].map(|it| doc.create_html(&cx.heap, it));
        if let Some(title) = title {
            let element = doc.create_html(&cx.heap, atom!("title"));
            insert(
                cx,
                doc.create_text(&cx.heap, title),
                element,
                None,
                Observers::Suppress,
            );
            insert(cx, element, head, None, Observers::Suppress);
        }
        insert(cx, head, html, None, Observers::Suppress);
        insert(cx, body, html, None, Observers::Suppress);
        insert(
            cx,
            doc.create_doctype(
                &cx.heap,
                atom!("html").into(),
                DomString::default(),
                DomString::default(),
            ),
            doc,
            None,
            Observers::Suppress,
        );
        insert(cx, html, doc, None, Observers::Suppress);
        doc
    }

    pub(crate) fn has_feature(&self) -> bool {
        true
    }
}

impl BodyColor {
    fn body_element(&self) -> Option<&Element> {
        self.body().filter(|it| it.kind() == Kind::Body)
    }

    pub(crate) fn get(&self, attribute: Known) -> DomString {
        self.body_element()
            .and_then(|it| it.attr(attribute))
            .unwrap_or_default()
    }

    pub(crate) fn set<'a>(&'a self, cx: Cx<'_, 'a>, attribute: Known, value: DomString) {
        if let Some(body) = self.body_element() {
            body.set_attr(cx, attribute, value);
        }
    }
}

fn is_xml_name(name: &Atom) -> bool {
    let name = name.to_dom_string();
    let mut characters = char::decode_utf16(name.units()).map(|it| it.map_or(0, u32::from));
    characters
        .next()
        .is_some_and(bun_parsers::xml::is_name_start_char)
        && characters.all(bun_parsers::xml::is_name_char)
}

impl ReadyState {
    pub(crate) fn name(self) -> Atom {
        Atom::of(match self {
            ReadyState::Loading => atom!("loading"),
            ReadyState::Interactive => atom!("interactive"),
            ReadyState::Complete => atom!("complete"),
        })
    }
}

impl DocumentMembers {
    pub(crate) fn get_implementation<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::Implementation, || {
            let made = js_DOMImplementation::create(self.realm(heap), Default::default());
            js_DOMImplementation::set_document(made, Some(self));
            made.to_js()
        })
    }

    pub(crate) fn get_url(&self) -> DomString {
        self.url()
    }

    pub(crate) fn get_compat_mode(&self) -> Atom {
        Atom::new(if self.quirks() {
            "BackCompat"
        } else {
            "CSS1Compat"
        })
    }

    pub(crate) fn get_character_set(&self) -> DomString {
        page::encoding_of(self).name().into()
    }

    pub(crate) fn get_content_type(&self) -> DomString {
        self.content_type()
    }

    pub(crate) fn create_processing_instruction<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        target: Atom,
        data: DomString,
    ) -> Result<'a, &'a Node> {
        if !is_xml_name(&target) {
            return Err(dom_error(
                heap,
                DomError::InvalidCharacterError,
                "The target is not a valid name.",
            ));
        }
        if bun_core::strings::contains(data.to_utf8().as_bytes(), b"?>") {
            return Err(dom_error(
                heap,
                DomError::InvalidCharacterError,
                "The data contains '?>'.",
            ));
        }
        Ok(self.create_pi(heap, target, data))
    }

    pub(crate) fn import_node<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        options: SubtreeOrOptions<'a>,
    ) -> Result<'a, &'a Node> {
        if node.kind().is_document() || node.has(F::SHADOW_ROOT) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "This node may not be imported.",
            ));
        }
        let (subtree, registry) = match options {
            SubtreeOrOptions::Subtree(subtree) => (subtree, None),
            SubtreeOrOptions::Options(options) => {
                (!options.self_only, options.custom_element_registry)
            }
        };
        let registry = custom::registry_option(
            &cx.heap,
            registry.map_or(JSValue::UNDEFINED, JsLocal::to_js),
            self,
        )?;
        clone_node(cx, node, self, subtree, None, registry)
    }

    pub(crate) fn adopt_node<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a, &'a Node> {
        if node.kind().is_document() {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "A document may not be adopted.",
            ));
        }
        if node.has(F::SHADOW_ROOT) {
            return Err(dom_error(
                &cx.heap,
                DomError::HierarchyRequestError,
                "A shadow root may not be adopted.",
            ));
        }
        if let Some((attr, owner)) = node
            .downcast::<Attr>()
            .and_then(|it| Some((it, it.owner()?)))
        {
            owner.remove_attr_node(cx, Some(attr))?;
        }
        adopt(cx, node, self);
        Ok(node)
    }

    pub(crate) fn get_location<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        Ok(crate::api::window::Window::of(self)
            .map_or(JSValue::NULL, |it| it.get_location(&cx.heap).to_js()))
    }

    pub(crate) fn get_domain<'a>(&'a self, _: Cx<'_, 'a>) -> Result<'a, DomString> {
        Ok(DomString::from_latin1(&page::domain(self)))
    }

    pub(crate) fn set_domain<'a>(&'a self, cx: Cx<'_, 'a>, value: &[u8]) -> Result<'a> {
        page::set_domain(cx, self, value)
    }

    pub(crate) fn get_referrer<'a>(&'a self, heap: &JsHeap<'a>) -> DomString {
        page::referrer(heap, self)
    }

    pub(crate) fn get_cookie<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, DomString> {
        page::cookie(&cx.heap, self)
    }

    pub(crate) fn set_cookie<'a>(&'a self, cx: Cx<'_, 'a>, value: &[u8]) -> Result<'a> {
        page::set_cookie(&cx.heap, self, value)
    }

    pub(crate) fn get_last_modified<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, DomString> {
        let global = cx.global();
        let given = self
            .last_modified()
            .map(|it| {
                bun_jsc::bun_string_jsc::parse_date(
                    &bun_core::String::clone_utf8(it.to_utf8().as_bytes()),
                    global,
                )
            })
            .transpose()?;
        let time = given
            .filter(|it| !it.is_nan())
            .unwrap_or_else(|| bun_core::time::milli_timestamp() as f64);
        let it = global.ms_to_gregorian_date_time(time);
        Ok(format!(
            "{:02}/{:02}/{:04} {:02}:{:02}:{:02}",
            it.month, it.day, it.year, it.hour, it.minute, it.second
        )
        .as_str()
        .into())
    }

    pub(crate) fn get_ready_state(&self) -> Atom {
        self.ready_state().name()
    }

    pub(crate) fn get_title(&self) -> DomString {
        self.title()
    }

    pub(crate) fn set_title<'a>(&'a self, cx: Cx<'_, 'a>, title: DomString) {
        Doc::set_title(self, cx, title);
    }

    fn html_element(&self) -> Option<&Element> {
        self.document_element().filter(|it| it.kind() == Kind::Html)
    }

    pub(crate) fn get_dir(&self) -> Atom {
        let keyword = |value: &DomString| {
            [atom!("ltr"), atom!("rtl"), atom!("auto")]
                .into_iter()
                .find(|it| value.eq_ignore_ascii_case(it.as_str()))
        };
        self.html_element()
            .and_then(|it| it.with_attr_string(atom!("dir"), keyword))
            .flatten()
            .map_or(Atom::EMPTY, Atom::from)
    }

    pub(crate) fn set_dir<'a>(&'a self, cx: Cx<'_, 'a>, value: DomString) {
        if let Some(html) = self.html_element() {
            html.set_attr(cx, atom!("dir"), value);
        }
    }

    pub(crate) fn get_current_script(&self) -> Option<&Node> {
        self.current_script()
    }

    pub(crate) fn open<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        _: Option<Str<'a>>,
        _: Option<Str<'a>>,
    ) -> Result<'a, &'a Doc> {
        loading::open(cx, self)?;
        Ok(self)
    }

    pub(crate) fn open_window<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        url: Str<'a>,
        name: Str<'a>,
        features: Str<'a>,
    ) -> Result<'a, JSValue> {
        let Some(window) = crate::api::window::Window::of(self).filter(|it| !it.is_disposed())
        else {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidAccessError,
                "The document has no window.",
            ));
        };
        let [url, name, features] =
            [url, name, features].map(|it| DomString::from_js_string(&cx.heap, it));
        window.open(cx, &url?, &name?, &features?)
    }

    pub(crate) fn close<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        loading::close(cx, self)
    }

    fn write_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        texts: &[JsLocal<'a>],
        end: &str,
        sink: &str,
    ) -> Result<'a> {
        let all = self.text_to_write(cx, texts, end, sink)?;
        loading::write(cx, self, &all)
    }

    pub(crate) fn write<'a>(&'a self, cx: Cx<'_, 'a>, texts: &[JsLocal<'a>]) -> Result<'a> {
        self.write_with(cx, texts, "", "Document write")
    }

    pub(crate) fn writeln<'a>(&'a self, cx: Cx<'_, 'a>, texts: &[JsLocal<'a>]) -> Result<'a> {
        self.write_with(cx, texts, "\n", "Document writeln")
    }

    pub(crate) fn get_default_view(&self, _: &JsHeap<'_>) -> JSValue {
        self.window().map_or(JSValue::NULL, |it| it.window())
    }

    pub(crate) fn create_event<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        interface: &[u8],
    ) -> Result<'a, JSValue> {
        crate::api::events::create_event(cx, self, interface)
    }

    pub(crate) fn has_storage_access<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        fulfilled_with(cx, JSValue::TRUE)
    }

    pub(crate) fn request_storage_access<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        fulfilled_with(cx, JSValue::UNDEFINED)
    }

    pub(crate) fn get_hidden(&self) -> bool {
        !crate::api::window::Window::shows(self)
    }

    pub(crate) fn get_visibility_state(&self) -> Atom {
        Atom::of(if self.get_hidden() {
            atom!("hidden")
        } else {
            atom!("visible")
        })
    }

    pub(crate) fn get_never(&self) -> bool {
        false
    }

    pub(crate) fn get_fragment_directive<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::FragmentDirective, || {
            js_FragmentDirective::create(self.realm(heap), Default::default()).to_js()
        })
    }

    pub(crate) fn get_root_element(&self) -> Option<&Element> {
        self.document_element()
            .filter(|it| it.kind() == Kind::SvgSvg)
    }

    pub(crate) fn do_nothing(&self) {}
}
