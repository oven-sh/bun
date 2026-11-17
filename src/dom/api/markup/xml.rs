//! <https://html.spec.whatwg.org/multipage/xhtml.html#parsing-xhtml-documents>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsScope};
use bun_markup::Chars;
use bun_markup::html::{Stop, entities};
use bun_markup::names::split_qname;
use bun_parsers::xml::{Handler, XML};

use super::parser::DocumentParser;
use super::pending;
use super::sink::registry_for_child;
use crate::api::core::steps::Has;
use crate::api::core::*;
use crate::api::loading::{self, ScriptFate};
use crate::api::support::*;

const MAX_DEPTH: usize = 5000;

enum Token {
    Doctype(Atom, DomString, DomString),
    Start(DomString, Vec<(DomString, DomString)>),
    End,
    Text(DomString),
    Cdata(DomString),
    Comment(DomString),
    Instruction(Atom, DomString),
}

#[derive(Default)]
struct Tokens(Vec<Token>);

fn string(units: &[u16]) -> DomString {
    DomString::from_chars(Chars::Utf16(units))
}

impl Handler for Tokens {
    fn doctype(&mut self, name: &[u16], public_id: &[u16], system_id: &[u16]) {
        self.0.push(Token::Doctype(
            Atom::from_chars(Chars::Utf16(name)),
            string(public_id),
            string(system_id),
        ));
    }

    fn begin_element(&mut self, name: &[u16]) {
        self.0.push(Token::Start(string(name), Vec::new()));
    }

    fn attribute(&mut self, name: &[u16], value: &[u16]) {
        if let Some(Token::Start(_, attributes)) = self.0.last_mut() {
            attributes.push((string(name), string(value)));
        }
    }

    fn end_element(&mut self) {
        self.0.push(Token::End);
    }

    fn text(&mut self, text: &[u16]) {
        self.0.push(Token::Text(string(text)));
    }

    fn cdata(&mut self, text: &[u16]) {
        self.0.push(Token::Cdata(string(text)));
    }

    fn comment(&mut self, text: &[u16]) {
        self.0.push(Token::Comment(string(text)));
    }

    fn instruction(&mut self, target: &[u16], data: &[u16]) {
        self.0.push(Token::Instruction(
            Atom::from_chars(Chars::Utf16(target)),
            string(data),
        ));
    }
}

/// Up to the first error, which comes with them.
fn tokenize(units: &[u16]) -> (Vec<Token>, Option<String>) {
    let (arena, mut log, file) = (
        bun_alloc::Arena::default(),
        bun_ast::Log::init(),
        bun_ast::Source::init_empty_file(b"document.xml"),
    );
    let mut tokens = Tokens::default();
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
    (tokens.0, result.err().map(|_| message()))
}

struct Open {
    element: JSValue,
    /// How many were declared outside of it.
    namespaces: usize,
}

pub(super) struct Builder {
    tokens: std::vec::IntoIter<Token>,
    error: Option<String>,
    root: JSValue,
    context: Option<JSValue>,
    starts_scripts: bool,
    open: Vec<Open>,
    namespaces: Vec<(Option<Atom>, Ns)>,
}

type Malformed = String;

fn well_formed_units(source: &DomString) -> Vec<u16> {
    let mut units: Vec<u16> = source.units().collect();
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

fn split(name: &DomString) -> Result<(Option<Atom>, Atom), Malformed> {
    let (prefix, local) = split_qname(name.chars())
        .ok_or_else(|| format!("The name {} is not valid", name.to_utf8()))?;
    Ok((prefix.map(Atom::from_chars), Atom::from_chars(local)))
}

fn node<'a>(cell: JSValue) -> &'a Node {
    // SAFETY: nothing is collected while the builder runs, or else `DocumentParser::keep` holds it.
    unsafe { Node::from_cell(cell) }
}

impl Builder {
    pub(super) fn for_document(source: &DomString, doc: &Doc) -> Builder {
        let units = well_formed_units(source);
        let (tokens, error) = tokenize(units.strip_prefix(&[0xfeff]).unwrap_or(&units));
        Builder {
            tokens: tokens.into_iter(),
            error,
            root: doc.to_js(),
            context: None,
            starts_scripts: false,
            open: Vec::new(),
            namespaces: Vec::new(),
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
        let (mut tokens, error) = tokenize(&units);
        tokens.pop();
        let mut tokens = tokens.into_iter();
        tokens.next();
        Builder {
            tokens,
            error,
            root: root.to_js(),
            context: Some(context.to_js()),
            starts_scripts,
            open: Vec::new(),
            namespaces: Vec::new(),
        }
    }

    fn resolve(&self, prefix: Option<&Atom>) -> Result<Ns, Malformed> {
        let declared = self
            .namespaces
            .iter()
            .rfind(|it| it.0.as_ref() == prefix)
            .map(|it| it.1.clone());
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
        name: &DomString,
        attributes: Vec<(DomString, DomString)>,
    ) -> Result<(QualName, Vec<(QualName, DomString)>), Malformed> {
        let mut resolved = Vec::with_capacity(attributes.len());
        for (name, value) in attributes {
            let (prefix, local) = split(&name)?;
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
                    return Err(format!("The declaration {} is not valid", name.to_utf8()));
                }
                self.namespaces
                    .push((prefix.is_some().then(|| local.clone()), ns));
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
        let (prefix, local) = split(name)?;
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

    fn start<'a>(
        &mut self,
        cx: &mut JsScope<'a>,
        name: &DomString,
        attributes: Vec<(DomString, DomString)>,
        loader: Option<&'a DocumentParser>,
    ) -> Result<(), Malformed> {
        if self.open.len() == MAX_DEPTH {
            return Err("Excessive depth in document".into());
        }
        let namespaces = self.namespaces.len();
        let (name, attributes) = self.resolve_names(name, attributes)?;
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
            pending::before_constructing(cx, parent, &name.local, is.as_ref());
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
        while let Some(token) = self.tokens.next() {
            let parent = self.parent(cx);
            let (doc, heap) = (parent.doc(), &cx.heap);
            let leaf = match token {
                Token::Start(name, attributes) => {
                    self.start(cx, &name, attributes, loader)?;
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
                Token::Text(data) => &***doc.create_text(heap, data),
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
    without_collecting(cx, |cx| Builder::for_document(source, doc).build(cx, None)).map(drop)
}

pub(super) fn parse_fragment<'a>(
    cx: &mut JsScope<'a>,
    context: &'a Element,
    source: &DomString,
    starts_scripts: bool,
) -> bindgen::Result<'a, &'a Node> {
    let fragment = context.contents(cx).doc().create_fragment(&cx.heap);
    match without_collecting(cx, |cx| {
        Builder::for_fragment(source, fragment, context, starts_scripts).build(cx, None)
    }) {
        Ok(_) => Ok(fragment),
        Err(message) => Err(dom_error(&cx.heap, DomError::SyntaxError, &message)),
    }
}
