//! For the tests that compare the tree with mdast-util-from-markdown's. Only debug and canary builds call it.

use crate::Dialect;
use crate::document::{Document, Mdast, Node};
use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_format::markdown::ast::{Align, Kind, ReferenceType};
use bun_lint::json;
use bun_lint::options::Json;
use std::io::Write as _;

fn push_field(name: &str, value: Option<&[u8]>, out: &mut Vec<u8>) {
    if let Some(value) = value {
        let _ = write!(out, " {name}=");
        json_stringify(value, out);
    }
}

fn push_node(node: Node<'_>, depth: usize, out: &mut Vec<u8>) {
    let Some(raw) = node.raw() else {
        return;
    };
    out.extend(std::iter::repeat_n(b' ', depth));
    let _ = write!(out, "{} {}-{}", node.type_name(), raw.start, raw.end);
    let kind = node.kind();
    if kind == Kind::Heading {
        let _ = write!(out, " depth={}", node.depth());
    }
    if kind == Kind::Code {
        push_field("lang", node.lang(), out);
    }
    if matches!(kind, Kind::Code | Kind::Math) {
        push_field("meta", node.meta(), out);
    }
    push_field("value", node.value(), out);
    if matches!(kind, Kind::Link | Kind::Image | Kind::Definition) {
        push_field("url", Some(node.url()), out);
        push_field("title", node.title(), out);
    }
    if matches!(kind, Kind::Image | Kind::ImageReference) {
        push_field("alt", Some(node.alt()), out);
    }
    let has_label = matches!(
        kind,
        Kind::Definition
            | Kind::LinkReference
            | Kind::ImageReference
            | Kind::FootnoteDefinition
            | Kind::FootnoteReference
    );
    if has_label {
        push_field("identifier", Some(node.identifier()), out);
        push_field("label", Some(node.label()), out);
    }
    if matches!(kind, Kind::LinkReference | Kind::ImageReference) {
        let name = match raw.reference_type {
            ReferenceType::Shortcut => "shortcut",
            ReferenceType::Collapsed => "collapsed",
            ReferenceType::Full => "full",
        };
        let _ = write!(out, " referenceType=\"{name}\"");
    }
    if kind == Kind::List {
        let _ = write!(out, " ordered={}", raw.ordered);
        if raw.ordered {
            let _ = write!(out, " start={}", raw.number);
        }
    }
    if matches!(kind, Kind::List | Kind::ListItem) {
        let _ = write!(out, " spread={}", raw.spread);
    }
    if kind == Kind::ListItem && raw.checked > 0 {
        let _ = write!(out, " checked={}", raw.checked == 2);
    }
    if kind == Kind::Table {
        let names: Vec<&str> = (node.aligns().iter())
            .map(|align| match align {
                Align::None => "null",
                Align::Left => "\"left\"",
                Align::Center => "\"center\"",
                Align::Right => "\"right\"",
            })
            .collect();
        let _ = write!(out, " align=[{}]", names.join(","));
    }
    out.push(b'\n');
}

/// Prints the tree of `document`, one line per node.
fn push_tree(document: &Document<'_>, out: &mut Vec<u8>) {
    let (mut node, mut depth) = (document.root(), 0);
    loop {
        push_node(node, depth, out);
        if let Some(child) = node.first_child() {
            (node, depth) = (child, depth + 1);
            continue;
        }
        loop {
            if let Some(next) = node.next() {
                node = next;
                break;
            }
            match node.parent() {
                Some(parent) => (node, depth) = (parent, depth - 1),
                None => return,
            }
        }
    }
}

/// `input` has one line of JSON per case: `{ id, text, language, languageOptions }`. Returns `### id` and then the tree
/// for each case, one line per node.
pub fn trees(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let lines = strings::split(input, b"\n").filter(|line| !line.is_empty());
    for case in lines.filter_map(json::parse) {
        let string = |key: &[u8]| case.get(key).and_then(Json::as_str).unwrap_or_default();
        let (text, name) = (string(b"text"), string(b"language"));
        out.extend_from_slice(b"### ");
        out.extend_from_slice(string(b"id"));
        out.push(b'\n');
        let null = Json::Null;
        let options = case.get(b"languageOptions").unwrap_or(&null);
        let dialect = Dialect::new(name.strip_prefix(b"markdown/").unwrap_or(name), options);
        match dialect.ok().and_then(|it| Mdast::parse(text, it)) {
            Some(mdast) => push_tree(&Document::new(&mdast, text), &mut out),
            None => out.extend_from_slice(b"REFUSED\n"),
        }
    }
    out
}
