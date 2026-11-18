//! <https://html.spec.whatwg.org/multipage/xhtml.html#parsing-xhtml-documents>

use core::cell::RefCell;
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsScope};
use bun_markup::Chars;
use bun_markup::html::{Sink as _, Stop, entities};
use bun_markup::names::split_qname;
use bun_parsers::xml::{Handler, XML};

use super::parser::DocumentParser;
use super::sink::{Client, Recent, Sink, registry_for_child};
use crate::api::core::steps::Has;
use crate::api::core::*;
use crate::api::loading::{self, ScriptFate};
use crate::api::support::*;
use crate::name::Map;
use crate::tree::Likeness;

const MAX_DEPTH: usize = 5000;
const MAX_ATTRIBUTES: usize = 4096;

enum Token {
    Doctype(Atom, DomString, DomString),
    /// With the number of attributes.
    Start(Rc<Written>, usize),
    End,
    Text(StoredText),
    Cdata(DomString),
    Comment(DomString),
    Instruction(Atom, DomString),
}

/// A name.
struct Written {
    units: Box<[u16]>,
    /// The prefix and the local name.
    parts: Option<(Option<Atom>, Atom)>,
    /// As that of an attribute, it means nothing to an element without steps.
    is_plain: bool,
    last: RefCell<Option<Likeness>>,
}

impl Written {
    fn new(units: &[u16]) -> Rc<Written> {
        let parts = split_qname(Chars::Utf16(units))
            .map(|(prefix, local)| (prefix.map(Atom::from_chars), Atom::from_chars(local)));
        let is_special = |it: &Atom| {
            bare::needs_object(it)
                || matches!(
                    it.known(),
                    atom!("xmlns") | atom!("is") | atom!("customelementregistry") | atom!("style")
                )
        };
        let is_plain = matches!(&parts, Some((None, local)) if !is_special(local));
        Rc::new(Written {
            units: units.into(),
            parts,
            is_plain,
            last: RefCell::default(),
        })
    }

    fn split(&self) -> Result<(Option<Atom>, Atom), Malformed> {
        self.parts.clone().ok_or_else(|| {
            format!(
                "The name {} is not valid",
                String::from_utf16_lossy(&self.units)
            )
        })
    }
}

type Attribute = (Rc<Written>, StoredText);

struct Tokens {
    all: Vec<Token>,
    attributes: Vec<Attribute>,
    names: [Option<Rc<Written>>; 256],
    recent: Box<Recent>,
}

impl Tokens {
    #[inline]
    fn name(&mut self, units: &[u16]) -> Rc<Written> {
        let hash = [0, units.len() / 2, units.len().saturating_sub(1)]
            .into_iter()
            .fold(units.len(), |all, it| {
                all * 31 + usize::from(units.get(it).copied().unwrap_or(0))
            });
        match &mut self.names[hash % 256] {
            Some(known) if *known.units == *units => Rc::clone(known),
            slot => Rc::clone(slot.insert(Written::new(units))),
        }
    }
}

fn string(units: &[u16]) -> DomString {
    DomString::from_chars(Chars::Utf16(units))
}

impl Handler for Tokens {
    fn doctype(&mut self, name: &[u16], public_id: &[u16], system_id: &[u16]) {
        self.all.push(Token::Doctype(
            Atom::from_chars(Chars::Utf16(name)),
            string(public_id),
            string(system_id),
        ));
    }

    fn begin_element(&mut self, name: &[u16]) {
        let name = self.name(name);
        self.all.push(Token::Start(name, 0));
    }

    fn attribute(&mut self, name: &[u16], value: &[u16]) {
        let attribute = (self.name(name), self.recent.text(Chars::Utf16(value)));
        if let Some(Token::Start(_, count)) = self.all.last_mut() {
            *count += 1;
            self.attributes.push(attribute);
        }
    }

    fn end_element(&mut self) {
        self.all.push(Token::End);
    }

    fn text(&mut self, text: &[u16]) {
        self.all
            .push(Token::Text(self.recent.text(Chars::Utf16(text))));
    }

    fn cdata(&mut self, text: &[u16]) {
        self.all.push(Token::Cdata(string(text)));
    }

    fn comment(&mut self, text: &[u16]) {
        self.all.push(Token::Comment(string(text)));
    }

    fn instruction(&mut self, target: &[u16], data: &[u16]) {
        self.all.push(Token::Instruction(
            Atom::from_chars(Chars::Utf16(target)),
            string(data),
        ));
    }
}

/// Up to the first error, which comes with them.
fn tokenize(units: &[u16], doc: &Doc) -> (Vec<Token>, Vec<Attribute>, Option<String>) {
    let (arena, mut log, file) = (
        bun_alloc::Arena::default(),
        bun_ast::Log::init(),
        bun_ast::Source::init_empty_file(b"document.xml"),
    );
    let recent = doc.arena().recent_markup.take().unwrap_or_else(Recent::new);
    let mut tokens = Tokens {
        all: Vec::with_capacity(units.len() / 32),
        attributes: Vec::with_capacity(units.len() / 32),
        names: [const { None }; _],
        recent,
    };
    let result = XML::parse_into(
        &file,
        units,
        &mut log,
        &arena,
        entities::named_reference::<u8>,
        &mut tokens,
    );
    let message = || {
        log.msgs
            .first()
            .map_or("Excessive depth in document", |it| {
                crate::values::text(&it.data.text)
            })
            .to_owned()
    };
    doc.arena().recent_markup.set(Some(tokens.recent));
    doc.arena()
        .write(|engine| engine.tree.expect(tokens.all.len()));
    (
        tokens.all,
        tokens.attributes,
        result.err().map(|_| message()),
    )
}

struct Open {
    element: JSValue,
    /// How many were declared outside of it.
    namespaces: usize,
}

pub(super) struct Builder {
    tokens: std::vec::IntoIter<Token>,
    attributes: std::vec::IntoIter<Attribute>,
    error: Option<String>,
    root: JSValue,
    context: Option<JSValue>,
    starts_scripts: bool,
    open: Vec<Open>,
    namespaces: Namespaces,
}

#[derive(Default)]
struct Namespaces {
    default: Option<Ns>,
    by_prefix: Map<Atom, Ns>,
    /// With what they stood for before.
    declared: Vec<(Option<Atom>, Option<Ns>)>,
}

impl Namespaces {
    fn len(&self) -> usize {
        self.declared.len()
    }

    #[inline]
    fn get(&self, prefix: Option<&Atom>) -> Option<&Ns> {
        prefix.map_or(self.default.as_ref(), |it| self.by_prefix.get(it))
    }

    fn replace(&mut self, prefix: Option<&Atom>, ns: Option<Ns>) -> Option<Ns> {
        match (prefix, ns) {
            (None, ns) => core::mem::replace(&mut self.default, ns),
            (Some(prefix), Some(ns)) => self.by_prefix.insert(prefix.clone(), ns),
            (Some(prefix), None) => self.by_prefix.remove(prefix),
        }
    }

    fn declare(&mut self, prefix: Option<Atom>, ns: Ns) {
        let before = self.replace(prefix.as_ref(), Some(ns));
        self.declared.push((prefix, before));
    }

    fn truncate(&mut self, len: usize) {
        while self.len() > len
            && let Some((prefix, before)) = self.declared.pop()
        {
            self.replace(prefix.as_ref(), before);
        }
    }
}

type Malformed = String;

fn well_formed_units(source: &DomString) -> Vec<u16> {
    let mut units = match source.chars() {
        Chars::Latin1(narrow) => return narrow.iter().map(|it| u16::from(*it)).collect(),
        Chars::Utf16(wide) => wide.to_vec(),
    };
    let mut at = 0;
    while let Some(unit) = units.get(at) {
        match (unit, units.get(at + 1)) {
            (0xd800..0xdc00, Some(0xdc00..0xe000)) => at += 1,
            (0xd800..0xe000, _) => units[at] = 0xfffd,
            _ => {}
        }
        at += 1;
    }
    units
}

fn node<'a>(cell: JSValue) -> &'a Node {
    // SAFETY: nothing is collected while the builder runs, or else `DocumentParser::keep` holds it.
    unsafe { Node::from_cell(cell) }
}

impl Builder {
    pub(super) fn for_document(source: &DomString, doc: &Doc) -> Builder {
        let units = well_formed_units(source);
        let (tokens, attributes, error) =
            tokenize(units.strip_prefix(&[0xfeff]).unwrap_or(&units), doc);
        Builder {
            tokens: tokens.into_iter(),
            attributes: attributes.into_iter(),
            error,
            root: doc.to_js(),
            context: None,
            starts_scripts: false,
            open: Vec::new(),
            namespaces: Namespaces::default(),
        }
    }

    fn for_fragment(
        source: &DomString,
        root: &Node,
        context: &Element,
        starts_scripts: bool,
    ) -> Builder {
        let units: Vec<u16> = "<a>"
            .encode_utf16()
            .chain(well_formed_units(source))
            .chain("</a>".encode_utf16())
            .collect();
        let (mut tokens, attributes, error) = tokenize(&units, root.doc());
        tokens.pop();
        let mut tokens = tokens.into_iter();
        tokens.next();
        Builder {
            tokens,
            attributes: attributes.into_iter(),
            error,
            root: root.to_js(),
            context: Some(context.to_js()),
            starts_scripts,
            open: Vec::new(),
            namespaces: Namespaces::default(),
        }
    }

    fn resolve(&self, prefix: Option<&Atom>) -> Result<Ns, Malformed> {
        let declared = self.namespaces.get(prefix).cloned();
        let found = declared
            .or_else(|| Some(node(self.context?).locate_namespace(prefix)))
            .unwrap_or(Ns::None);
        match prefix {
            Some(prefix) if *prefix == atom!("xml") => Ok(Ns::Xml),
            Some(prefix) if found == Ns::None || *prefix == atom!("xmlns") => Err(format!(
                "Namespace prefix {} is not defined",
                prefix.as_utf8()
            )),
            _ => Ok(found),
        }
    }

    fn resolve_names(
        &mut self,
        name: &Written,
        count: usize,
    ) -> Result<(QualName, Vec<(QualName, DomString)>), Malformed> {
        let mut resolved = Vec::with_capacity(count);
        for (name, value) in self.attributes.by_ref().take(count) {
            let ((prefix, local), value) = (name.split()?, value.string().clone());
            let declares = prefix.as_ref().unwrap_or(&local).known() == atom!("xmlns");
            if declares {
                let ns = Ns::from_uri(Some(&Atom::from_string(&value)));
                let is_wrong = match prefix {
                    Some(_) => {
                        local == atom!("xmlns")
                            || ns == Ns::None
                            || (local == atom!("xml")) != (ns == Ns::Xml)
                    }
                    None => false,
                };
                if is_wrong || prefix.is_some() && ns == Ns::Xmlns {
                    return Err(format!(
                        "The declaration {} is not valid",
                        String::from_utf16_lossy(&name.units)
                    ));
                }
                self.namespaces
                    .declare(prefix.is_some().then(|| local.clone()), ns);
            }
            resolved.push((
                QualName::parsed(if declares { Ns::Xmlns } else { Ns::None }, prefix, local),
                value,
            ));
        }
        for index in 0..resolved.len() {
            let (before, [(name, _), ..]) = resolved.split_at_mut(index) else {
                break;
            };
            if name.prefix.is_some() && name.ns == Ns::None {
                *name = QualName::parsed(
                    self.resolve(name.prefix.as_ref())?,
                    name.prefix.take(),
                    name.local.clone(),
                );
                if before
                    .iter()
                    .any(|it| it.0.ns == name.ns && it.0.local == name.local)
                {
                    return Err(format!("Attribute {} is redefined", name.local.as_utf8()));
                }
            }
        }
        let (prefix, local) = name.split()?;
        Ok((
            QualName::parsed(self.resolve(prefix.as_ref())?, prefix, local),
            resolved,
        ))
    }

    fn parent<'a>(&self, cx: &mut JsScope<'a>) -> &'a Node {
        let parent = node(self.open.last().map_or(self.root, |it| it.element));
        parent.as_element().map_or(parent, |it| it.contents(cx))
    }

    fn append<'a>(cx: &mut JsScope<'a>, child: &'a Node, parent: &'a Node) {
        if parent.takes_plain_append(child) {
            append_detached(parent, child);
        } else if child.parent().is_none()
            && ensure_pre_insert_validity(&cx.heap, child, parent, None, Validity::Inserting)
                .is_ok()
        {
            insert(cx, child, parent, None, Observers::Notify);
        }
    }

    fn start_quietly(
        &mut self,
        sink: &mut Sink<'_, '_>,
        parent: JSValue,
        name: &Written,
        count: usize,
    ) -> Option<()> {
        let (prefix, local) = name.parts.as_ref()?;
        let attributes = &self.attributes.as_slice()[..count];
        (self.open.len() < MAX_DEPTH
            && count <= MAX_ATTRIBUTES
            && attributes.iter().all(|it| it.0.is_plain))
        .then_some(())?;
        let qualified = QualName::parsed(
            self.resolve(prefix.as_ref()).ok()?,
            prefix.clone(),
            local.clone(),
        );
        let attributes = attributes
            .iter()
            .filter_map(|it| Some((&it.0.parts.as_ref()?.1, &it.1)));
        let element = sink.append_named_quietly(
            parent,
            qualified,
            attributes,
            count,
            &mut name.last.borrow_mut(),
        )?;
        self.attributes.by_ref().take(count).for_each(drop);
        self.open.push(Open {
            element,
            namespaces: self.namespaces.len(),
        });
        Some(())
    }

    /// False if it takes objects, which the open elements have then.
    fn append_quietly(&mut self, sink: &mut Sink<'_, '_>, token: &Token) -> bool {
        let parent = match self.open.last() {
            Some(it) if !sink.is_pinned(it.element) => it.element,
            _ => self.parent(sink.cx).to_js(),
        };
        let is_done = match token {
            Token::Start(name, count) => self.start_quietly(sink, parent, name, *count).is_some(),
            Token::End if !sink.is_pinned(parent) => self.open.pop().is_some(),
            Token::Text(data) => sink.append_stored_quietly(data, parent),
            Token::Comment(data) => sink.append_comment_quietly(data.chars(), parent),
            _ => false,
        };
        if !is_done {
            for it in self.open.iter_mut().rev() {
                if sink.is_pinned(it.element) {
                    break;
                }
                it.element = sink.pin(it.element);
            }
            sink.publish();
        }
        is_done
    }

    fn start<'a>(
        &mut self,
        cx: &mut JsScope<'a>,
        name: &Written,
        count: usize,
        loader: Option<&'a DocumentParser>,
    ) -> Result<(), Malformed> {
        if self.open.len() == MAX_DEPTH {
            return Err("Excessive depth in document".into());
        }
        if count > MAX_ATTRIBUTES {
            return Err("An element has too many attributes".into());
        }
        let namespaces = self.namespaces.len();
        let (name, attributes) = self.resolve_names(name, count)?;
        let find = |known: Known| {
            attributes
                .iter()
                .find(|it| it.0.ns == Ns::None && it.0.local == known)
                .map(|it| &it.1)
        };
        let (parent, is) = (self.parent(cx), find(atom!("is")).map(Atom::from_string));
        let doc = parent.doc();
        if loader.is_some()
            && name.ns == Ns::Html
            && (is.is_some() || is_valid_custom_element_name(&name.local))
        {
            super::before_constructing(cx, parent, &name.local, is.as_ref());
        }
        let context = self
            .context
            .map(node)
            .filter(|it| self.open.is_empty() && it.doc() == doc);
        let registry = registry_for_child(
            context.or(Some(parent)),
            find(atom!("customelementregistry")).is_some(),
        );
        let synchronous = if loader.is_some() {
            Synchronous::Yes
        } else {
            Synchronous::No
        };
        let is_script = name.local == atom!("script") && matches!(name.ns, Ns::Html | Ns::Svg);
        let element = doc.create_element(cx, name, is.as_ref(), synchronous, registry);
        if is_script {
            let fate = match loader {
                Some(_) => ScriptFate::ParserInserted,
                None if self.starts_scripts => ScriptFate::RunsWhenConnected,
                None => ScriptFate::AlreadyStarted,
            };
            loading::script_created(&cx.heap, element, element.doc(), fate, (0, 0), false);
        }
        element.append_attributes(cx, attributes.into_iter());
        self.open.push(Open {
            element: element.to_js(),
            namespaces,
        });
        let Some(loader) = loader else {
            Builder::append(cx, element, parent);
            return Ok(());
        };
        loader.keep(&cx.heap, element);
        loader.set_inserting(true);
        Builder::append(cx, element, parent);
        loader.set_inserting(false);
        custom::react_now(cx);
        Ok(())
    }

    /// Up to the end of a script of `loader`.
    fn build<'a>(
        &mut self,
        cx: &mut JsScope<'a>,
        loader: Option<&'a DocumentParser>,
    ) -> Result<Option<JSValue>, Malformed> {
        let mut sink = Sink::new(cx, node(self.root).doc(), Client::Inert);
        while let Some(token) = self.tokens.next() {
            if loader.is_none() && self.append_quietly(&mut sink, &token) {
                continue;
            }
            let cx = &mut *sink.cx;
            let parent = self.parent(cx);
            let (doc, heap) = (parent.doc(), &cx.heap);
            let leaf = match token {
                Token::Start(name, count) => {
                    self.start(cx, &name, count, loader)?;
                    continue;
                }
                Token::End => {
                    let Some(closed) = self.open.pop() else {
                        continue;
                    };
                    self.namespaces.truncate(closed.namespaces);
                    let element = node(closed.element);
                    let is_script = matches!(element.kind(), Kind::Script | Kind::SvgScript);
                    if (loader.is_some() || is_script)
                        && element.steps().contains(Has::FINISHED_PARSING)
                    {
                        seams::finished_parsing(cx, element);
                    }
                    if loader.is_some() && is_script {
                        return Ok(Some(closed.element));
                    }
                    continue;
                }
                Token::Text(data) => &***doc.create_text(heap, data.string().clone()),
                Token::Cdata(data) => &***doc.create_cdata(heap, data),
                Token::Comment(data) => doc.create_comment(heap, data),
                Token::Instruction(target, data) => doc.create_pi(heap, target, data),
                Token::Doctype(name, public_id, system_id) => {
                    doc.create_doctype(heap, name, public_id, system_id)
                }
            };
            Builder::append(cx, leaf, parent);
        }
        self.error.take().map_or(Ok(None), Err)
    }

    pub(super) fn load<'a>(
        &mut self,
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        loader: &'a DocumentParser,
    ) -> Stop<JSValue> {
        match self.build(cx, Some(loader)) {
            Ok(Some(script)) => Stop::Script(script),
            Ok(None) => Stop::Finished,
            Err(message) => {
                report_error(cx, doc, &message);
                Stop::Finished
            }
        }
    }
}

pub(super) fn report_error<'a>(cx: &mut JsScope<'a>, doc: &'a Doc, message: &str) {
    let report = doc.create_plain(&cx.heap, QualName::html(Atom::new("parsererror")));
    let text = doc.create_text(&cx.heap, message.into());
    insert(cx, text, report, None, Observers::Notify);
    let root = doc.document_element().unwrap_or_else(|| {
        let (html, body) = (
            doc.create_html(&cx.heap, atom!("html")),
            doc.create_html(&cx.heap, atom!("body")),
        );
        insert(cx, html, doc, None, Observers::Notify);
        insert(cx, body, html, None, Observers::Notify);
        body
    });
    insert(cx, report, root, root.first_child(), Observers::Notify);
}

/// The error tells why it is not well-formed.
pub(crate) fn parse_document<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    source: &DomString,
) -> Result<(), String> {
    let result = without_collecting(cx, |cx| Builder::for_document(source, doc).build(cx, None));
    doc.report_bare(cx);
    result.map(drop)
}

pub(super) fn parse_fragment<'a>(
    cx: &mut JsScope<'a>,
    context: &'a Element,
    source: &DomString,
    starts_scripts: bool,
) -> bindgen::Result<'a, &'a Node> {
    let fragment = context.contents(cx).doc().create_fragment(&cx.heap);
    let result = without_collecting(cx, |cx| {
        Builder::for_fragment(source, fragment, context, starts_scripts).build(cx, None)
    });
    fragment.doc().report_bare(cx);
    match result {
        Ok(_) => Ok(fragment),
        Err(message) => Err(dom_error(&cx.heap, DomError::SyntaxError, &message)),
    }
}
