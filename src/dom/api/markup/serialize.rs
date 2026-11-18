//! <https://html.spec.whatwg.org/#serialising-html-fragments>

use bun_core::strings;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};
use bun_markup::Text as Buffer;
use bun_markup::escape::{Escape, push_escaped};
use smallvec::SmallVec;

use super::with_buffer;
use crate::api::core::{NodeFlags as F, *};
use crate::api::cssom;
use crate::document::Document;
use crate::generated_bindgen::canvas::HTMLCanvasElement;
use crate::generated_bindgen::forms::{HTMLInputElement, HTMLOptionElement, HTMLTextAreaElement};
use crate::generated_bindgen::markup::GetHTMLOptions;
use crate::tree::{self, Data, Namespace, NodeId, Step, Walk};

pub(super) fn is_void(tag: Known) -> bool {
    matches!(
        tag,
        atom!("area")
            | atom!("base")
            | atom!("basefont")
            | atom!("bgsound")
            | atom!("br")
            | atom!("col")
            | atom!("embed")
            | atom!("frame")
            | atom!("hr")
            | atom!("img")
            | atom!("input")
            | atom!("keygen")
            | atom!("link")
            | atom!("meta")
            | atom!("param")
            | atom!("source")
            | atom!("track")
            | atom!("wbr")
    )
}

pub(super) fn has_raw_text(of_doc: &Node, html_tag: Known) -> bool {
    match html_tag {
        atom!("style")
        | atom!("script")
        | atom!("xmp")
        | atom!("iframe")
        | atom!("noembed")
        | atom!("noframes")
        | atom!("plaintext") => true,
        atom!("noscript") => of_doc.doc().is(DocFlags::HAS_PAGE),
        _ => false,
    }
}

#[inline]
pub(super) fn push_tag_name(out: &mut Buffer, element: &tree::Element) {
    if element.namespace == Namespace::Other
        && let Some(prefix) = element.space.as_ref().and_then(|it| it.prefix.as_ref())
    {
        out.push(prefix.chars());
        out.push_byte(b':');
    }
    out.push(element.local.chars());
}

#[cold]
fn push_attribute_prefix(out: &mut Buffer, space: &tree::Space, local: &Atom) {
    match (&space.ns, &space.prefix) {
        (Ns::Xml, _) => out.push_str("xml:"),
        (Ns::Xmlns, _) if *local == atom!("xmlns") => {}
        (Ns::Xmlns, _) => out.push_str("xmlns:"),
        (Ns::XLink, _) => out.push_str("xlink:"),
        (_, Some(prefix)) => {
            out.push(prefix.chars());
            out.push_byte(b':');
        }
        (_, None) => {}
    }
}

#[inline]
pub(super) fn push_value(out: &mut Buffer, value: &DomString) {
    out.push_str("=\"");
    push_escaped(out, value.chars(), Escape::HtmlAttribute);
    out.push_byte(b'"');
}

#[inline]
pub(super) fn push_attribute(out: &mut Buffer, attribute: &tree::Attribute, value: &DomString) {
    out.push_byte(b' ');
    if let Some(space) = &attribute.space {
        push_attribute_prefix(out, space, &attribute.local);
    }
    out.push(attribute.local.chars());
    push_value(out, value);
}

#[inline(always)]
pub(super) fn push_text(out: &mut Buffer, text: &DomString, is_raw: bool) {
    if is_raw {
        out.push(text.chars())
    } else {
        push_escaped(out, text.chars(), Escape::HtmlText)
    }
}

pub(super) fn push_comment(out: &mut Buffer, data: &DomString) {
    ["<!--".into(), data.chars(), "-->".into()]
        .into_iter()
        .for_each(|it| out.push(it));
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Content {
    #[default]
    Markup,
    RawText,
    Void,
}

/// A start tag in the output.
#[derive(Clone, Copy, Default)]
struct Written {
    start: u32,
    len: u32,
    name_len: u32,
    content: Content,
}

const RECENT_BITS: u32 = 8;
const ELEMENTS_BEFORE_RECALLING: u32 = 16;

struct Writer<'c, 'r, 'a> {
    cx: &'c mut JsScope<'a>,
    shadow_roots: Option<&'r GetHTMLOptions<'a>>,
    out: Buffer,
    elements: u32,
    /// By the address of shared attributes, and the local name.
    recent: Vec<((usize, usize), Written)>,
}

impl<'c, 'r, 'a> Writer<'c, 'r, 'a> {
    fn new(
        cx: &'c mut JsScope<'a>,
        shadow_roots: Option<&'r GetHTMLOptions<'a>>,
        out: Buffer,
    ) -> Self {
        Writer {
            cx,
            shadow_roots,
            out,
            elements: 0,
            recent: Vec::new(),
        }
    }

    #[inline]
    fn data(&mut self, node: &'a Node, is_raw: bool) {
        let out = &mut self.out;
        if let Some(text) = node.as_text() {
            return text.with_data(|it| push_text(out, it, is_raw));
        }
        node.with_inert(|it| match node.kind() {
            Kind::Comment => push_comment(out, &it.data),
            Kind::Doctype => ["<!DOCTYPE ".into(), it.name.local.chars(), ">".into()]
                .into_iter()
                .for_each(|it| out.push(it)),
            _ => [
                "<?".into(),
                it.name.local.chars(),
                " ".into(),
                it.data.chars(),
                "?>".into(),
            ]
            .into_iter()
            .for_each(|it| out.push(it)),
        });
    }

    fn write_start_tag(
        &mut self,
        engine: &Document,
        id: NodeId,
        element: &tree::Element,
        of_doc: &Node,
        is: Option<Atom>,
    ) -> Written {
        let out = &mut self.out;
        let start = out.len();
        out.push_byte(b'<');
        push_tag_name(out, element);
        let tag = if element.namespace == Namespace::Html {
            element.local.known()
        } else {
            Known::Other
        };
        let name_len = out.len() - start - 1;
        if let Some(is) = is {
            out.push_str(" is");
            push_value(out, &is.to_dom_string());
        }
        for it in element.attributes.iter().filter(|it| it.is_visible()) {
            engine.script_value(id, it, |value| push_attribute(out, it, value));
        }
        out.push_byte(b'>');
        let content = match tag {
            _ if is_void(tag) => Content::Void,
            _ if has_raw_text(of_doc, tag) => Content::RawText,
            _ => Content::Markup,
        };
        Written {
            start: start as u32,
            len: (out.len() - start) as u32,
            name_len: name_len as u32,
            content,
        }
    }

    #[inline]
    fn start_tag(&mut self, element: &'a Element) -> Written {
        if element.has(F::STYLE_DIRTY) {
            // What runs now may free an address, for others to have.
            self.recent.fill(Default::default());
            element.flush_style(self.cx);
        }
        let is = element
            .is_value()
            .filter(|_| !element.has_attr(atom!("is")));
        element
            .arena()
            .read(|engine| self.start_tag_of(engine, element.id(), element, is))
    }

    /// `is`: the value that no attribute has.
    #[inline(always)]
    fn start_tag_of(
        &mut self,
        engine: &Document,
        id: NodeId,
        of_doc: &Node,
        is: Option<Atom>,
    ) -> Written {
        let Some(element) = engine.tree.element(id) else {
            return Written::default();
        };
        let shared = match &element.attributes {
            _ if element.namespace != Namespace::Html
                || element.local == atom!("noscript")
                || is.is_some() =>
            {
                return self.write_start_tag(engine, id, element, of_doc, is);
            }
            tree::Attributes::Shared(shared) => (shared.as_ptr().addr(), element.local.identity()),
            tree::Attributes::Own(own) if own.is_empty() => (1, element.local.identity()),
            _ => return self.write_start_tag(engine, id, element, of_doc, is),
        };
        let slot = (shared.0 ^ shared.1).wrapping_mul(0x9e37_79b9_7f4a_7c15)
            >> (usize::BITS - RECENT_BITS);
        match self.recent.get(slot) {
            Some((known, written)) if *known == shared => {
                let written = *written;
                self.out
                    .repeat(written.start as usize..(written.start + written.len) as usize);
                written
            }
            _ => self.write_and_note(engine, id, element, of_doc, shared, slot),
        }
    }

    fn write_and_note(
        &mut self,
        engine: &Document,
        id: NodeId,
        element: &tree::Element,
        of_doc: &Node,
        shared: (usize, usize),
        slot: usize,
    ) -> Written {
        match self.recent.get(slot) {
            Some(_) => {}
            None if self.elements < ELEMENTS_BEFORE_RECALLING => self.elements += 1,
            None => self.recent.resize(1 << RECENT_BITS, Default::default()),
        }
        let written = self.write_start_tag(engine, id, element, of_doc, None);
        if let Some(slot) = self.recent.get_mut(slot) {
            *slot = (shared, written);
        }
        written
    }

    #[inline(always)]
    fn end_tag(
        &mut self,
        Written {
            start, name_len, ..
        }: Written,
    ) {
        self.out
            .push_end_tag(start as usize + 1..(start + 1 + name_len) as usize);
    }

    fn serialized_shadow_root(&self, host: &'a Node) -> Option<&'a ShadowRoot> {
        let (wanted, root) = (self.shadow_roots?, host.as_element()?.shadow_root()?);
        ((wanted.serializable_shadow_roots && root.is(ShadowFlags::SERIALIZABLE))
            || wanted.shadow_roots.iter().any(|it| core::ptr::eq(it, root)))
        .then_some(root)
    }

    fn start_shadow_root(&mut self, root: &'a ShadowRoot) {
        let has_own_registry = custom::has_own_registry(root);
        let out = &mut self.out;
        out.push_str("<template shadowrootmode=");
        out.push_str(if root.is(ShadowFlags::CLOSED) {
            "\"closed\""
        } else {
            "\"open\""
        });
        for (flag, attribute) in [
            (
                ShadowFlags::DELEGATES_FOCUS,
                " shadowrootdelegatesfocus=\"\"",
            ),
            (ShadowFlags::SERIALIZABLE, " shadowrootserializable=\"\""),
            (
                ShadowFlags::MANUAL_SLOTS,
                " shadowrootslotassignment=\"manual\"",
            ),
            (ShadowFlags::CLONABLE, " shadowrootclonable=\"\""),
        ] {
            if root.is(flag) {
                out.push_str(attribute);
            }
        }
        if let Some(target) = root.reference_target() {
            out.push_str(" shadowrootreferencetarget");
            push_value(out, &target);
        }
        out.push_str(if has_own_registry {
            " shadowrootcustomelementregistry=\"\">"
        } else {
            ">"
        });
    }

    /// The parent of what follows the start tag.
    #[inline]
    fn enter(&mut self, node: &'a Node) -> &'a Node {
        if node.has(F::HOST)
            && let Some(root) = self.serialized_shadow_root(node)
        {
            self.start_shadow_root(root);
            return root;
        }
        match node.as_element() {
            Some(template) if node.kind() == Kind::Template => template.contents(self.cx),
            _ => node,
        }
    }

    /// Children that are bare are written at once.
    #[inline]
    fn first_to_write(&mut self, parent: &'a Node, is_raw: bool) -> Option<&'a Node> {
        if parent.has(F::HAS_BARE_CHILDREN) {
            parent
                .arena()
                .read(|engine| self.bare_children(engine, parent, is_raw && parent.is_element()));
        }
        parent.first_object()
    }

    fn bare_children(&mut self, engine: &Document, top: &'a Node, is_top_raw: bool) {
        let (tree, mut is_raw) = (&engine.tree, is_top_raw);
        if let Some(Data::Text(only)) = tree.only_text_in(top.id()).map(|it| &tree[it].data) {
            return push_text(&mut self.out, only.string(), is_raw);
        }
        let (mut walk, mut open) = (
            Walk::below(tree, top.id()),
            SmallVec::<[Written; 32]>::new(),
        );
        while let Some(step) = walk.step(tree) {
            match step {
                Step::Visit(id) => match &tree[id].data {
                    Data::Text(text) => push_text(&mut self.out, text.string(), is_raw),
                    Data::Inert(comment) => push_comment(&mut self.out, &comment.data),
                    _ => {}
                },
                Step::Enter(id) => {
                    let written = self.start_tag_of(engine, id, top, None);
                    if written.content == Content::Void {
                        walk.skip(tree);
                        continue;
                    }
                    if let Some(Data::Text(only)) = tree.only_text_in(id).map(|it| &tree[it].data) {
                        push_text(
                            &mut self.out,
                            only.string(),
                            written.content == Content::RawText,
                        );
                    } else if tree.has_children(id) {
                        open.push(written);
                        is_raw = written.content == Content::RawText;
                        continue;
                    }
                    walk.skip(tree);
                    self.end_tag(written);
                }
                Step::Leave => {
                    open.pop().into_iter().for_each(|it| self.end_tag(it));
                    is_raw = open
                        .last()
                        .map_or(is_top_raw, |it| it.content == Content::RawText);
                }
            }
        }
    }

    fn children(&mut self, top: &'a Node) {
        let is_top_raw = has_raw_text(top, top.html_tag());
        let mut open = SmallVec::<[Written; 32]>::new();
        let (mut parent, mut is_raw) = (self.enter(top), is_top_raw);
        let mut next = self.first_to_write(parent, is_raw);
        loop {
            while let Some(node) = next {
                next = node.next_sibling();
                node.prefetch_after();
                node.read(|tree, id| tree.prefetch_after(id));
                let Some(element) = node.as_element() else {
                    self.data(node, is_raw && parent.is_element());
                    continue;
                };
                let written = self.start_tag(element);
                if written.content != Content::Void {
                    open.push(written);
                    (parent, is_raw) = (self.enter(node), written.content == Content::RawText);
                    next = self.first_to_write(parent, is_raw);
                }
            }
            let Some(element) = parent
                .as_element()
                .or_else(|| parent.edge_node(Edge::Host)?.as_element())
                .filter(|_| parent != top)
            else {
                return;
            };
            if parent.has(F::SHADOW_ROOT) {
                self.out.push_str("</template>");
                (parent, next) = (element, element.first_child());
                continue;
            }
            let (Some(written), Some(outer)) = (open.pop(), element.parent()) else {
                return;
            };
            self.end_tag(written);
            (parent, next) = (outer, element.next_sibling());
            is_raw = open
                .last()
                .map_or(is_top_raw, |it| it.content == Content::RawText);
        }
    }
}

enum OnPaper<'a> {
    Write(&'a Node),
    End(Written),
    EndScope(&'a Node),
}

fn push_rules(out: &mut Buffer, rules: &[u8]) {
    out.push(
        DomString::from_utf8(&bun_ui::protocol::Text::lossy(
            &strings::split(rules, b"</")
                .collect::<Vec<_>>()
                .join(&b"<\\/"[..]),
        ))
        .chars(),
    );
}

impl<'a> Writer<'_, '_, 'a> {
    /// Returns what is to be between the tags, if it is not the children.
    fn start_tag_on_paper(
        &mut self,
        element: &'a Element,
        of_frames: Sources<'_>,
    ) -> bindgen::Result<'a, (Written, Option<DomString>)> {
        let (value, heap, mut state) = (
            element.to_js(),
            JsHeap::from_global(element.doc().global()),
            Vec::new(),
        );
        let (mut written, mut text) = (
            Written {
                start: self.out.len() as u32,
                ..Default::default()
            },
            None,
        );
        if let Some(canvas) = HTMLCanvasElement::from_js(heap, value) {
            let picture = canvas.to_data_url(
                self.cx,
                b"image/png",
                JsLocal::new(heap, JSValue::UNDEFINED),
            );
            let picture = picture.or_else(|error| self.cx.catch(error).map(|_| Vec::new()))?;
            state.push((atom!("src"), Some(DomString::from_latin1(&picture))));
            self.out.push_str("<img");
            written.content = Content::Void;
        } else {
            self.out.push_byte(b'<');
            match element.html_tag() {
                atom!("plaintext") | atom!("xmp") => self.out.push_str("pre"),
                _ => element.with(|it| push_tag_name(&mut self.out, it)),
            }
            written.name_len = self.out.len() as u32 - written.start - 1;
            written.content = if is_void(element.html_tag()) {
                Content::Void
            } else {
                Content::Markup
            };
        }
        let flag = |is_on: bool| is_on.then(DomString::default);
        if let Some(input) = HTMLInputElement::from_js(heap, value) {
            let shown = match input.get_type() {
                atom!("password") => {
                    DomString::from_latin1(&vec![b'*'; input.get_value().len() as usize])
                }
                _ => input.get_value(),
            };
            state.extend([
                (atom!("checked"), flag(input.get_checked())),
                (
                    atom!("value"),
                    (element.has_attr(atom!("value")) || !input.get_value().is_empty())
                        .then_some(shown),
                ),
            ]);
        } else if let Some(option) = HTMLOptionElement::from_js(heap, value) {
            state.push((atom!("selected"), flag(option.get_selected())));
        } else if let Some(area) = HTMLTextAreaElement::from_js(heap, value) {
            text = Some(area.get_value());
        } else if element.html_tag() == atom!("iframe") {
            let [url, markup] = of_frames.map(|all| {
                all.iter()
                    .find(|it| it.0 == element.id())
                    .map(|it| it.1.clone())
            });
            state.extend([
                (atom!("src"), url),
                (atom!("srcdoc"), markup),
                (atom!("sandbox"), None),
                (atom!("csp"), None),
            ]);
            text = Some(DomString::default());
        }
        // The referrer says which document a request is for.
        state.push((atom!("referrerpolicy"), None));
        element.flush_style(self.cx);
        let (out, is_refused) = (&mut self.out, element.with(|it| it.is_style_refused));
        element.for_each_attr(|attribute, value| {
            let is_style = attribute.local.chars().is_ignoring_case(b"style");
            if !(is_style
                && (is_refused || attribute.space.is_some() || attribute.local != atom!("style")))
                && !state.iter().any(|it| attribute.local == it.0)
            {
                push_attribute(out, attribute, value);
            }
        });
        for (name, value) in state.iter().filter_map(|it| Some((it.0, it.1.as_ref()?))) {
            out.push_byte(b' ');
            out.push(Atom::from(name).chars());
            push_value(out, value);
        }
        out.push_byte(b'>');
        Ok((written, text))
    }

    fn for_paper(&mut self, doc: &'a Doc, of_frames: Sources<'_>) -> bindgen::Result<'a, ()> {
        let (heap, mut steps) = (
            JsHeap::from_global(doc.global()),
            vec![OnPaper::EndScope(doc)],
        );
        steps.extend(doc.document_element().map(|it| OnPaper::Write(it)));
        while let Some(step) = steps.pop() {
            let node = match step {
                OnPaper::Write(node) => node,
                OnPaper::End(written) => {
                    self.end_tag(written);
                    continue;
                }
                OnPaper::EndScope(scope) => {
                    self.out.push_str("<style>");
                    push_rules(&mut self.out, &cssom::rules_without_markup(heap, scope));
                    self.out.push_str(if scope.has(F::SHADOW_ROOT) {
                        "</style></template>"
                    } else {
                        "</style>"
                    });
                    continue;
                }
            };
            steps.extend(
                node.next_sibling()
                    .filter(|_| node.parent() != Some(doc))
                    .map(OnPaper::Write),
            );
            let Some(element) = node.as_element() else {
                node.as_text()
                    .into_iter()
                    .for_each(|_| self.data(node, false));
                continue;
            };
            // Whatever the namespace is, as the parser may come to another one.
            let is_named = |names: &[&[u8]]| {
                element.with(|it| {
                    names
                        .iter()
                        .any(|name| it.local.chars().is_ignoring_case(name))
                })
            };
            let is_style = is_named(&[b"style"]);
            if is_named(&[
                b"base",
                b"meta",
                b"noembed",
                b"noframes",
                b"noscript",
                b"script",
                b"template",
            ]) || (is_style
                && cssom::sheet_of(heap, element).is_none_or(|it| it.get_disabled(self.cx)))
            {
                continue;
            }
            let (written, text) = self.start_tag_on_paper(element, of_frames)?;
            if written.content == Content::Void {
                continue;
            }
            steps.push(OnPaper::End(written));
            match text {
                Some(text) => {
                    self.out.push_byte(b'\n');
                    push_escaped(&mut self.out, text.chars(), Escape::HtmlText);
                }
                None if element.html_tag() == atom!("style") => push_rules(
                    &mut self.out,
                    element.child_text_content().to_utf8().as_bytes(),
                ),
                None => steps.extend(element.first_child().map(OnPaper::Write)),
            }
            if let Some(root) = element.shadow_root().filter(|it| !it.has(F::USER_AGENT)) {
                self.out.push_str("<template shadowrootmode=open>");
                steps.push(OnPaper::EndScope(root));
                steps.extend(root.first_child().map(OnPaper::Write));
            }
        }
        Ok(())
    }
}

/// `src` and `srcdoc` of frames.
type Sources<'s> = [&'s [(NodeId, DomString)]; 2];

/// What is shown, for a browser that runs no scripts and refuses no styles.
#[cold]
pub(super) fn for_paper<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    of_frames: Sources<'_>,
) -> bindgen::Result<'a, DomString> {
    let mut writer = Writer::new(cx, None, Buffer::with_capacity(0));
    writer.out.push_str(if doc.quirks() {
        "<meta charset=utf-8><base href"
    } else {
        "<!DOCTYPE html><meta charset=utf-8><base href"
    });
    push_value(&mut writer.out, &doc.base_url());
    writer.out.push_byte(b'>');
    writer.for_paper(doc, of_frames)?;
    Ok(DomString::from_chars(writer.out.chars()))
}

pub(super) fn inner_html<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    shadow_roots: Option<&GetHTMLOptions<'a>>,
) -> DomString {
    with_buffer(|out| {
        let mut writer = Writer::new(cx, shadow_roots, out);
        if !is_void(node.html_tag()) {
            writer.children(node);
        }
        writer.out
    })
}

pub(super) fn outer_html<'a>(cx: &mut JsScope<'a>, node: &'a Node) -> DomString {
    with_buffer(|out| {
        let mut writer = Writer::new(cx, None, out);
        let Some(element) = node.as_element() else {
            writer.data(
                node,
                node.parent()
                    .is_some_and(|it| has_raw_text(it, it.html_tag())),
            );
            return writer.out;
        };
        let written = writer.start_tag(element);
        if written.content != Content::Void {
            writer.children(node);
            writer.end_tag(written);
        }
        writer.out
    })
}
