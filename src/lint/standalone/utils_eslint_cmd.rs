//! `bun-lint utils-eslint dump <cases.jsonl>`: what `utils::eslint_utils` says about every node of
//! each case, one line a case, to compare with `test/cli/lint/oracle/utils-eslint/dump.ts`.
//!
//! A case is `{ id, filename, code, sourceType, ecmaVersion, jsx, names }`. A line of the output is
//! `{ "id": .., "facts": ["name|type|start|end|value", ..] }`, or `{ "id": .., "error": true }` if
//! the code does not parse.

use bun_lint::ast::{Expr, ExprKind, File, Node, StmtKind};
use bun_lint::language::{Global, LanguageOptions, SourceType};
use bun_lint::options::{Json, Object};
use bun_lint::utils::eslint_utils::{
    HasSideEffectOptions, IteratorKind, Mode, PropertyKey, ReferenceKind, ReferenceTracker, StaticSymbol, StaticValue,
    TraceMap, TrackedReference, get_function_head_location, get_function_name_with_kind, get_property_name,
    get_static_value, get_string_if_constant, has_side_effect, is_parenthesized_times,
};
use bun_lint::utils::{self, text};
use std::fmt::Write;

/// `text` in quotes, with everything but printable ASCII as `\uXXXX`, a UTF-16 code unit each.
fn quote(text: &[u8], out: &mut String) {
    out.push('"');
    let mut at = 0;
    while let Some(&first) = text.get(at) {
        let next = |i: usize| text.get(at + i).map_or(0, |&byte| u32::from(byte & 0x3F));
        let (c, len) = match first {
            0..0x80 => (u32::from(first), 1),
            0x80..0xE0 => (u32::from(first & 0x1F) << 6 | next(1), 2),
            0xE0..0xF0 => (u32::from(first & 0x0F) << 12 | next(1) << 6 | next(2), 3),
            _ => (u32::from(first & 0x07) << 18 | next(1) << 12 | next(2) << 6 | next(3), 4),
        };
        at += len;
        match c {
            0x20 | 0x21 | 0x23..=0x5B | 0x5D..=0x7E => out.push(c as u8 as char),
            0x10000.. => {
                let c = c - 0x10000;
                _ = write!(out, "\\u{:04x}\\u{:04x}", 0xD800 | c >> 10, 0xDC00 | c & 0x3FF);
            }
            _ => _ = write!(out, "\\u{c:04x}"),
        }
    }
    out.push('"');
}

fn quoted(text: Option<impl AsRef<[u8]>>) -> String {
    let mut out = String::new();
    match text {
        Some(text) => quote(text.as_ref(), &mut out),
        None => out.push_str("none"),
    }
    out
}

fn show_symbol(symbol: &StaticSymbol<'_>, out: &mut String) {
    match symbol {
        StaticSymbol::WellKnown(name) => _ = write!(out, "@@Symbol.{name}"),
        StaticSymbol::Registered(key) => {
            out.push_str("Symbol.for(");
            quote(key, out);
            out.push(')');
        }
    }
}

fn show_all<T>(items: &[T], out: &mut String, mut show: impl FnMut(&T, &mut String)) {
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        show(item, out);
    }
}

fn show(value: &StaticValue<'_>, out: &mut String) {
    match value {
        StaticValue::Undefined => out.push_str("undefined"),
        StaticValue::Null => out.push_str("null"),
        StaticValue::Bool(b) => _ = write!(out, "{b}"),
        StaticValue::Number(n) if *n == 0.0 && n.is_sign_negative() => out.push_str("-0"),
        StaticValue::Number(n) => out.push_str(&String::from_utf8_lossy(&text::number_to_string(*n))),
        StaticValue::String(text) => quote(text, out),
        StaticValue::BigInt(n) => _ = write!(out, "{n}n"),
        StaticValue::Symbol(symbol) => show_symbol(symbol, out),
        StaticValue::Regex { pattern, flags } => {
            out.push('/');
            quote(pattern, out);
            out.push('/');
            out.push_str(&String::from_utf8_lossy(flags));
        }
        StaticValue::Hole => out.push_str("<hole>"),
        StaticValue::Array(items) => {
            out.push('[');
            show_all(items, out, show);
            out.push(']');
        }
        StaticValue::Object(properties) => {
            out.push('{');
            show_all(properties, out, |(key, value), out| {
                match key {
                    PropertyKey::String(name) => quote(name, out),
                    PropertyKey::Symbol(symbol) => show_symbol(symbol, out),
                }
                out.push(':');
                show(value, out);
            });
            out.push('}');
        }
        StaticValue::Map(entries) => {
            out.push_str("Map{");
            show_all(entries, out, |(key, value), out| {
                show(key, out);
                out.push_str("=>");
                show(value, out);
            });
            out.push('}');
        }
        StaticValue::Set(items) => {
            out.push_str("Set{");
            show_all(items, out, show);
            out.push('}');
        }
        StaticValue::Iterator(kind, items) => {
            out.push_str(match kind {
                IteratorKind::Array => "ArrayIterator[",
                IteratorKind::Map => "MapIterator[",
                IteratorKind::Set => "SetIterator[",
            });
            show_all(items, out, show);
            out.push(']');
        }
        StaticValue::Builtin(builtin) => out.push_str(builtin.name()),
    }
}

fn shown(value: Option<StaticValue<'_>>) -> String {
    let mut out = String::new();
    match value {
        Some(value) => show(&value, &mut out),
        None => out.push_str("none"),
    }
    out
}

struct Facts<'a> {
    file: &'a File<'a>,
    out: Vec<String>,
}

impl<'a> Facts<'a> {
    fn add(&mut self, name: &str, node: Node<'a>, value: impl std::fmt::Display) {
        let span = utils::estree_span(node);
        let kind = utils::estree_type_name(node);
        self.out.push(format!("{name}|{kind}|{}|{}|{value}", span.start, span.end));
    }

    fn common(&mut self, node: Node<'a>) {
        let effects: String = (0..4)
            .map(|bits| {
                let options = HasSideEffectOptions {
                    consider_getters: bits & 1 != 0,
                    consider_implicit_type_conversion: bits & 2 != 0,
                };
                if has_side_effect(node, options) { '1' } else { '0' }
            })
            .collect();
        self.add("sideEffect", node, effects);
        let parentheses: String =
            (1..=3).map(|times| if is_parenthesized_times(times, node) { '1' } else { '0' }).collect();
        self.add("parenthesized", node, parentheses);
    }

    fn property_name(&mut self, node: Node<'a>) {
        let scope = self.file.scope();
        let names = format!(
            "{} {}",
            quoted(get_property_name(node, Some(scope))),
            quoted(get_property_name(node, None))
        );
        self.add("propertyName", node, names);
    }

    fn expr(&mut self, e: Expr<'a>) {
        let node = Node::Expr(e);
        // What ESTree has no node for, and what it has another kind of node for.
        if e.is_missing()
            || (matches!(e.kind(), ExprKind::Binary { .. }) && utils::sequence_root(e) != e)
            || matches!(e.kind(), ExprKind::Fn(_) | ExprKind::Class(_))
        {
            return;
        }
        let scope = self.file.scope();
        self.add("static", node, shown(get_static_value(e, Some(scope))));
        self.add("staticNoScope", node, shown(get_static_value(e, None)));
        self.add("string", node, quoted(get_string_if_constant(e, Some(scope))));
        self.common(node);
        if matches!(e.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. }) {
            self.property_name(node);
        }
    }

    fn visit(&mut self, node: Node<'a>) {
        match node {
            Node::File(_) => {}
            Node::Expr(e) => self.expr(e),
            Node::Func(func) => {
                self.common(node);
                let head = get_function_head_location(func);
                self.add("functionHead", node, format!("{}-{}", head.start, head.end));
                let names = format!(
                    "{} / {}",
                    String::from_utf8_lossy(&get_function_name_with_kind(func, false)),
                    String::from_utf8_lossy(&get_function_name_with_kind(func, true))
                );
                self.add("functionName", node, names);
            }
            Node::Prop(_) | Node::PatProp(_) | Node::Member(_) => {
                self.common(node);
                self.property_name(node);
            }
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Fn(_) | StmtKind::Class(_)) => {}
            _ => self.common(node),
        }
        node.for_each_child(|child| self.visit(child));
    }

    fn track(&mut self, name: &str, references: Vec<TrackedReference<'a, '_, ()>>) {
        let mut found: Vec<(String, Vec<String>)> = Vec::new();
        for reference in references {
            let kind = match reference.kind {
                ReferenceKind::Read => "read",
                ReferenceKind::Call => "call",
                ReferenceKind::Construct => "construct",
            };
            let is_default_specifier = reference.span != reference.node.span()
                && matches!(reference.node.as_stmt().map(|it| it.kind()), Some(StmtKind::Import(_)));
            let (ty, span) = match is_default_specifier {
                true => ("ImportDefaultSpecifier", reference.span),
                false => (utils::estree_type_name(reference.node), utils::estree_span(reference.node)),
            };
            let key = format!("{ty}|{}|{}", span.start, span.end);
            let value = format!("{kind} {}", reference.path.join("."));
            match found.iter_mut().find(|it| it.0 == key) {
                Some(entry) => entry.1.push(value),
                None => found.push((key, vec![value])),
            }
        }
        for (key, mut all) in found {
            all.sort();
            self.out.push(format!("{name}|{key}|{}", all.join(", ")));
        }
    }
}

/// Every name, with every kind of use, and `next` as its members.
fn level<'m>(names: &[&'m str], next: &'m [(&'m str, TraceMap<'m, ()>)]) -> Vec<(&'m str, TraceMap<'m, ()>)> {
    names.iter().map(|&name| (name, TraceMap::new(next).read(()).call(()).construct(()))).collect()
}

fn dump(case: Object<'_>) -> String {
    let id = case.number("id").unwrap_or(-1.0);
    let names = case.strings("names");
    let mut globals: Vec<(Box<[u8]>, Global)> =
        names.iter().map(|name| (name.as_bytes().into(), Global::Readonly)).collect();
    globals.sort_by(|a, b| a.0.cmp(&b.0));
    let language = LanguageOptions {
        source_type: match case.str("sourceType") {
            Some("script") => SourceType::Script,
            Some("commonjs") => SourceType::CommonJs,
            _ => SourceType::Module,
        },
        ecma_version: case.number("ecmaVersion").map_or(LanguageOptions::LATEST_ECMA_VERSION, |it| it as u32),
        globals,
        ..LanguageOptions::default()
    };
    let code = case.get("code").and_then(Json::as_str).unwrap_or_default();
    crate::with_file(case.str("filename").unwrap_or("file.js"), code, &language, |file| {
        if file.has_parse_errors() {
            return format!("{{\"id\":{id},\"error\":true}}");
        }
        let mut facts = Facts {
            file,
            out: Vec::new(),
        };
        facts.visit(Node::File(file));

        let third = level(&names, &[]);
        let second = level(&names, &third);
        let first = level(&names, &second);
        let modules: Vec<_> = first.iter().map(|&(name, map)| (name, map.esm())).collect();
        let (map, esm) = (TraceMap::new(&first), TraceMap::new(&modules));
        let tracker = ReferenceTracker::new(file);
        facts.track("trackGlobal", tracker.iterate_global_references(&map));
        facts.track("trackCjs", tracker.iterate_cjs_references(&map));
        facts.track("trackEsmStrict", tracker.iterate_esm_references(&map));
        facts.track("trackEsmLegacy", tracker.with_mode(Mode::Legacy).iterate_esm_references(&map));
        facts.track("trackEsm", tracker.iterate_esm_references(&esm));

        let mut line = format!("{{\"id\":{id},\"facts\":[");
        for (i, fact) in facts.out.iter().enumerate() {
            if i > 0 {
                line.push(',');
            }
            line.push_str(&String::from_utf8_lossy(&text::json_stringify(fact.as_bytes())));
        }
        line.push_str("]}");
        line
    })
}

pub(crate) fn run(args: &[String]) {
    let (Some("dump"), Some(path)) = (args.first().map(String::as_str), args.get(1)) else {
        println!("usage: bun-lint utils-eslint dump <cases.jsonl>");
        return;
    };
    let Ok(input) = std::fs::read(path) else {
        println!("cannot read {path}");
        return;
    };
    for line in input.split(|&c| c == b'\n').filter(|line| !line.is_empty()) {
        if let Some(json) = bun_lint::json::parse(line) {
            println!("{}", dump(Object::of(Some(&json))));
        }
    }
}
