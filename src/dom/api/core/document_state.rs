//! What a document knows besides its tree.

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{JsHeap, JsScope};
use bun_web::encoding::Encoding;

use super::url::Url;
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadyState {
    Loading,
    Interactive,
    Complete,
}

struct State {
    url: RefCell<DomString>,
    base_url: RefCell<DomString>,
    /// What an `about:blank` document inherits.
    inherited_base_url: RefCell<Option<DomString>>,
    content_type: RefCell<DomString>,
    /// `None` for UTF-8.
    legacy_encoding: RefCell<Option<DomString>>,
    last_modified: RefCell<Option<DomString>>,
    ready_state: Cell<ReadyState>,
}

impl Default for State {
    fn default() -> State {
        let blank = Atom::of(atom!("about:blank")).to_dom_string();
        State {
            url: blank.clone().into(),
            base_url: blank.into(),
            inherited_base_url: None.into(),
            content_type: Atom::of(atom!("text/html")).to_dom_string().into(),
            legacy_encoding: None.into(),
            last_modified: None.into(),
            ready_state: ReadyState::Complete.into(),
        }
    }
}

macro_rules! texts {
    ($($get:ident $set:ident: $type:ty;)*) => {
        $(pub(crate) fn $get(&self) -> $type {
            self.extra::<State>().$get.borrow().clone()
        }

        pub(crate) fn $set(&self, value: $type) {
            self.extra::<State>().$get.replace(value);
        })*
    };
}

impl Doc {
    texts! {
        url set_url: DomString;
        base_url set_base_url: DomString;
        inherited_base_url set_inherited_base_url: Option<DomString>;
        legacy_encoding set_legacy_encoding: Option<DomString>;
        last_modified set_last_modified: Option<DomString>;
    }

    pub(crate) fn encoding(&self) -> Encoding {
        self.legacy_encoding()
            .and_then(|it| Encoding::for_label(it.to_utf8().as_bytes()))
            .unwrap_or_default()
    }

    /// <https://html.spec.whatwg.org/#fallback-base-url>
    pub(crate) fn fallback_base_url(&self) -> DomString {
        self.inherited_base_url().unwrap_or_else(|| self.url())
    }

    pub(crate) fn content_type(&self) -> DomString {
        self.extra::<State>().content_type.borrow().clone()
    }

    pub(crate) fn set_content_type(&self, content_type: DomString) {
        self.set_doc_flags(
            DocFlags::IS_XHTML,
            content_type.eq_str("application/xhtml+xml"),
        );
        self.extra::<State>().content_type.replace(content_type);
    }

    pub(crate) fn ready_state(&self) -> ReadyState {
        self.extra::<State>().ready_state.get()
    }

    /// It fires nothing.
    pub(crate) fn set_ready_state(&self, state: ReadyState) {
        self.extra::<State>().ready_state.set(state);
    }

    pub(crate) fn current_script(&self) -> Option<&Node> {
        self.edge_node(Edge::CurrentScript)
    }

    pub(crate) fn set_current_script(&self, heap: &JsHeap<'_>, script: Option<&Node>) {
        match script {
            Some(script) => self.set_edge(heap, Edge::CurrentScript, script.to_js()),
            None => self.clear_edge(heap, Edge::CurrentScript),
        }
    }

    /// <https://html.spec.whatwg.org/#encoding-parsing-a-url>
    pub(crate) fn parse_url<'a>(&'a self, cx: &mut JsScope<'a>, url: &DomString) -> Option<Url> {
        let state = self.extra::<State>();
        if state.legacy_encoding.borrow().is_some() && url.ascii().is_none() {
            return page::parse_url_in_legacy_encoding(self, url).map(Url::from_href);
        }
        Url::parse(&cx.heap, url, Some(&state.base_url.borrow()))
    }

    fn svg_root(&self) -> Option<&Element> {
        self.document_element()
            .filter(|it| it.kind() == Kind::SvgSvg)
    }

    fn title_element(&self) -> Option<&Element> {
        match self.svg_root() {
            Some(root) => root
                .element_children()
                .find(|it| it.kind() == Kind::SvgTitle),
            None => self
                .objects_with_tag(atom!("title"))
                .find(|it| it.kind() == Kind::Title),
        }
    }

    pub(crate) fn title(&self) -> DomString {
        let text = self
            .title_element()
            .map(|it| it.child_text_content())
            .unwrap_or_default();
        let mut title = StringBuilder::with_capacity(text.len() as usize);
        for word in text.tokens() {
            if !title.is_empty() {
                title.push_unit(0x20);
            }
            title.push(&word);
        }
        title.finish()
    }

    pub(crate) fn set_title<'a>(&'a self, cx: &mut JsScope<'a>, title: DomString) {
        let Some(root) = self
            .document_element()
            .filter(|it| it.kind() == Kind::SvgSvg || it.kind().is_html())
        else {
            return;
        };
        let element = match (self.title_element(), self.svg_root(), self.head()) {
            (Some(element), ..) => element,
            (None, Some(_), _) => {
                let made = self.create_plain(
                    &cx.heap,
                    QualName::parsed(Ns::Svg, None, atom!("title").into()),
                );
                insert(cx, made, root, root.first_child(), Observers::Notify);
                made
            }
            (None, None, Some(head)) => {
                let made = self.create_html(&cx.heap, atom!("title"));
                insert(cx, made, head, None, Observers::Notify);
                made
            }
            (None, None, None) => return,
        };
        super::metadata::set_title(cx, self, element, title);
    }
}
