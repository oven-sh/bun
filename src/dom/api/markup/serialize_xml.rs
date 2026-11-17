//! <https://w3c.github.io/DOM-Parsing/#dfn-xml-serialization>

use bun_jsc::bindgen::{self, JsScope};
use bun_markup::escape::{Escape, push_escaped};
use bun_markup::names::{has_only_xml_characters, is_ncname};
use bun_markup::{Chars, Text as Buffer};

use super::serialize::is_void;
use crate::api::core::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WellFormed {
    Required,
    Optional,
}

struct Open {
    name: Buffer,
    /// What to go back to.
    inherited: Ns,
    prefixes: usize,
}

struct Writer {
    out: Buffer,
    is_well_formed: bool,
    next_prefix: u32,
    /// The latest for a prefix counts.
    prefixes: Vec<(Atom, Ns)>,
    inherited: Ns,
    open: Vec<Open>,
}

fn ns_of(uri: &DomString) -> Ns {
    Ns::from_uri(Some(&Atom::from_string(uri)))
}

fn is_default_declaration(name: &QualName) -> bool {
    name.prefix.is_none() && name.local == atom!("xmlns")
}

impl Writer {
    fn new() -> Writer {
        let prefixes = vec![(atom!("xml").into(), Ns::Xml)];
        Writer {
            out: Buffer::default(),
            is_well_formed: true,
            next_prefix: 1,
            prefixes,
            inherited: Ns::None,
            open: Vec::new(),
        }
    }

    fn require(&mut self, holds: bool) {
        self.is_well_formed &= holds;
    }

    fn push_all(&mut self, parts: &[Chars<'_>]) {
        parts.iter().for_each(|it| self.out.push(*it));
    }

    fn escaped_value(&mut self, value: Chars<'_>) {
        self.require(has_only_xml_characters(value));
        push_escaped(&mut self.out, value, Escape::XmlAttribute);
    }

    fn attribute(&mut self, prefix: Option<&Atom>, local: &Atom, value: Chars<'_>) {
        self.out.push_byte(b' ');
        if let Some(prefix) = prefix {
            self.push_all(&[prefix.chars(), ":".into()]);
        }
        self.push_all(&[local.chars(), "=\"".into()]);
        self.escaped_value(value);
        self.out.push_byte(b'"');
    }

    fn declare(&mut self, prefix: Option<&Atom>, ns: &Ns) {
        let (xmlns, uri) = (Atom::from(atom!("xmlns")), ns.uri().unwrap_or(Atom::EMPTY));
        match prefix {
            Some(prefix) => self.attribute(Some(&xmlns), prefix, uri.chars()),
            None => self.attribute(None, &xmlns, uri.chars()),
        }
    }

    fn bound_to(&self, prefix: &Atom) -> Option<&Ns> {
        self.prefixes
            .iter()
            .rfind(|it| it.0 == *prefix)
            .map(|it| &it.1)
    }

    fn prefix_for(&self, ns: &Ns, preferred: Option<&Atom>) -> Option<Atom> {
        let is_bound = |prefix: &&Atom| *ns != Ns::None && self.bound_to(prefix) == Some(ns);
        preferred
            .filter(is_bound)
            .or_else(|| self.prefixes.iter().rev().map(|it| &it.0).find(is_bound))
            .cloned()
    }

    fn generate_prefix(&mut self, ns: &Ns, declared: &[(Atom, Ns)]) -> Atom {
        loop {
            let prefix = Atom::new(&format!("ns{}", self.next_prefix));
            self.next_prefix += 1;
            if declared.iter().all(|it| it.0 != prefix) {
                self.prefixes.push((prefix.clone(), ns.clone()));
                return prefix;
            }
        }
    }

    /// Whether children and an end tag follow.
    fn start_tag(&mut self, element: &Element) -> bool {
        let (attributes, outer_prefixes, outer_ns) =
            (element.attrs(), self.prefixes.len(), self.inherited.clone());
        let mut local_default = None;
        for (name, value) in &attributes {
            if is_default_declaration(name) {
                local_default = Some(value);
            } else if name.ns == Ns::Xmlns {
                let ns = ns_of(value);
                if ns != Ns::Xml && self.bound_to(&name.local) != Some(&ns) {
                    self.prefixes.push((name.local.clone(), ns));
                }
            }
        }
        let declared = self.prefixes[outer_prefixes..].to_vec();
        let default_ns = local_default.map(ns_of);

        let QualName { ns, prefix, local } = element.qual_name();
        let has_xmlns_prefix = prefix.as_ref().is_some_and(|it| *it == atom!("xmlns"));
        self.require(is_ncname(local.chars()) && !has_xmlns_prefix);
        let (mut written_prefix, mut declares, mut ignores_default) = (None, false, false);
        if outer_ns == ns {
            ignores_default = default_ns.as_ref() != Some(&ns);
            written_prefix = (ns == Ns::Xml).then(|| atom!("xml").into());
        } else {
            let is_local_default = ns != Ns::None && default_ns.as_ref() == Some(&ns);
            let candidate = match &prefix {
                _ if has_xmlns_prefix => prefix.clone(),
                None if is_local_default => None,
                _ => self.prefix_for(&ns, prefix.as_ref()),
            };
            if candidate.is_none() && prefix.is_none() {
                (declares, ignores_default) = (!is_local_default, !is_local_default);
                self.inherited = ns.clone();
            } else {
                declares = candidate.is_none();
                written_prefix = candidate.or_else(|| {
                    let prefix = prefix?;
                    if declared.iter().any(|it| it.0 == prefix) {
                        return Some(self.generate_prefix(&ns, &declared));
                    }
                    self.prefixes.push((prefix.clone(), ns.clone()));
                    Some(prefix)
                });
                if let Some(default_ns) = default_ns.clone().filter(|it| *it != Ns::Xml) {
                    self.inherited = default_ns;
                }
            }
        }

        let mut name = Buffer::default();
        if let Some(prefix) = &written_prefix {
            name.push(prefix.chars());
            name.push_byte(b':');
        }
        name.push(local.chars());
        self.push_all(&["<".into(), name.chars()]);
        if declares {
            self.declare(written_prefix.as_ref(), &ns);
        }
        for (name, value) in &attributes {
            let prefix = if is_default_declaration(name) {
                if ignores_default || default_ns == Some(Ns::Xml) {
                    continue;
                }
                None
            } else if name.ns == Ns::Xmlns {
                if !declared.contains(&(name.local.clone(), ns_of(value))) {
                    continue;
                }
                Some(atom!("xmlns").into())
            } else if name.ns == Ns::None {
                None
            } else {
                Some(
                    self.prefix_for(&name.ns, name.prefix.as_ref())
                        .unwrap_or_else(|| {
                            let prefix = match name
                                .prefix
                                .as_ref()
                                .filter(|it| self.bound_to(it).is_none())
                            {
                                Some(given) => {
                                    self.prefixes.push((given.clone(), name.ns.clone()));
                                    given.clone()
                                }
                                None => self.generate_prefix(&name.ns, &declared),
                            };
                            self.declare(Some(&prefix), &name.ns);
                            prefix
                        }),
                )
            };
            self.require(
                is_ncname(name.local.chars())
                    && !(name.ns == Ns::None && name.local == atom!("xmlns")),
            );
            self.attribute(prefix.as_ref(), &name.local, value.chars());
        }

        let is_empty =
            element.first_child().is_none() && (ns != Ns::Html || is_void(local.known()));
        if is_empty {
            self.out.push_str(if ns == Ns::Html { " />" } else { "/>" });
            self.prefixes.truncate(outer_prefixes);
            self.inherited = outer_ns;
        } else {
            self.out.push_byte(b'>');
            self.open.push(Open {
                name,
                inherited: outer_ns,
                prefixes: outer_prefixes,
            });
        }
        !is_empty
    }

    fn end_tag(&mut self) {
        let Some(open) = self.open.pop() else { return };
        self.push_all(&["</".into(), open.name.chars(), ">".into()]);
        self.prefixes.truncate(open.prefixes);
        self.inherited = open.inherited;
    }

    fn leaf(&mut self, node: &Node) {
        if let Some(attr) = node.downcast::<Attr>() {
            return self.escaped_value(attr.value().chars());
        }
        if let Some(text) = node.as_text() {
            return text.with_data(|it| {
                self.require(has_only_xml_characters(it.chars()));
                match node.kind() {
                    Kind::CData => self.push_all(&["<![CDATA[".into(), it.chars(), "]]>".into()]),
                    _ => push_escaped(&mut self.out, it.chars(), Escape::XmlText),
                }
            });
        }
        node.with_inert(|it| {
            let (name, data) = (it.name.local.chars(), it.data.chars());
            match node.kind() {
                Kind::Comment => {
                    self.require(
                        has_only_xml_characters(data)
                            && !data.contains_ascii(b"--")
                            && !data.ends_with(b"-"),
                    );
                    self.push_all(&["<!--".into(), data, "-->".into()]);
                }
                Kind::Instruction => {
                    self.require(has_only_xml_characters(data) && !data.contains_ascii(b"?>"));
                    self.require(!name.contains(b':') && !name.is_ignoring_case(b"xml"));
                    self.push_all(&["<?".into(), name, " ".into(), data, "?>".into()]);
                }
                _ => {
                    self.push_all(&["<!DOCTYPE ".into(), name]);
                    if !data.is_empty() {
                        self.push_all(&[" PUBLIC \"".into(), data, "\"".into()]);
                    } else if !it.system_id.is_empty() {
                        self.out.push_str(" SYSTEM");
                    }
                    if !it.system_id.is_empty() {
                        self.push_all(&[" \"".into(), it.system_id.chars(), "\"".into()]);
                    }
                    self.out.push_byte(b'>');
                }
            }
        });
    }

    fn children<'a>(&mut self, cx: &mut JsScope<'a>, top: &'a Node) {
        let (top, depth) = (
            top.as_element().map_or(top, |it| it.contents(cx)),
            self.open.len(),
        );
        let (mut parent, mut next) = (top, top.first_child());
        loop {
            while let Some(node) = next {
                next = node.next_sibling();
                let Some(element) = node.as_element() else {
                    self.leaf(node);
                    continue;
                };
                element.flush_style(cx);
                if self.start_tag(element) {
                    parent = element.contents(cx);
                    next = parent.first_child();
                }
            }
            if self.open.len() == depth {
                return;
            }
            self.end_tag();
            let closed = if parent.is_element() {
                Some(parent)
            } else {
                parent.edge_node(Edge::Host)
            };
            let Some((closed, outer)) = closed.and_then(|it| Some((it, it.parent()?))) else {
                return;
            };
            (parent, next) = (outer, closed.next_sibling());
        }
    }

    fn finish<'a>(
        self,
        cx: &mut JsScope<'a>,
        well_formed: WellFormed,
    ) -> bindgen::Result<'a, DomString> {
        if !self.is_well_formed && well_formed == WellFormed::Required {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The node cannot be serialized as well-formed XML.",
            ));
        }
        Ok(DomString::from_chars(self.out.chars()))
    }
}

pub(crate) fn inner_xml<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
) -> bindgen::Result<'a, DomString> {
    let mut writer = Writer::new();
    writer.children(cx, node);
    writer.finish(cx, WellFormed::Required)
}

pub(crate) fn outer_xml<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    well_formed: WellFormed,
) -> bindgen::Result<'a, DomString> {
    let mut writer = Writer::new();
    if let Some(element) = node.as_element() {
        element.flush_style(cx);
        if writer.start_tag(element) {
            writer.children(cx, node);
            writer.end_tag();
        }
    } else if node.kind().is_document() || node.as_fragment().is_some() {
        writer.children(cx, node);
    } else {
        writer.leaf(node);
    }
    writer.finish(cx, well_formed)
}
