//! `bun-lint regex ..`, driven by the scripts in test/cli/lint/oracle/regex.
//!
//! Every subcommand reads a file of requests, one per line, and prints one line of JSON for each. The
//! fields of a request are separated by tabs. A string is written as the hexadecimal UTF-16 code
//! units of the JavaScript string, four digits each, so that lone surrogates survive.
//!
//! - `parse <file>`: `literal|pattern|visit  strict  ecmaVersion  source  [flags]`. The AST of regexpp,
//!   with absolute paths for `parent`, `resolved` and `references`, or `{"error": {message, index}}`.
//! - `exec <file>`: `pattern  flags  text  lastIndex`. `{"error"}`, `null`, `"limit"`, or `{"indices": [[start, end] | null, ..],
//!   "groups": {name: [start, end] | null}}` as with the `d` flag.
//! - `ops <file>`: `op  pattern  flags  text  [replacement]`, where `op` is `test`, `search`, `match`, `matchAll`, `replace` or
//!   `split`. The result of the JavaScript method, with `matchAll` as the list of the lists of indices.
//! - `charset <file>`: `pattern  flags`. The characters `c` for which `^(?:pattern)$` matches the string of only `c`, as
//!   `"first-last first-last .."` in hexadecimal.
//! - `bench <file> <repeat>`: requests as for `exec`. Compiles each once, and prints the time of `repeat` searches.

use bun_lint::regex::ast::{Assertion, CharacterSet, INFINITY, Kind, Node, NodeId, Nodes, Reference, Visitor};
use bun_lint::regex::{self, Ast, Captures, Mode, Options, Regex, SyntaxError};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write as _;

fn units(hex: &str) -> Vec<u16> {
    hex.as_bytes()
        .chunks(4)
        .filter_map(|digits| u16::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok())
        .collect()
}

/// WTF-8.
fn bytes(units: &[u16]) -> Vec<u8> {
    let mut out = Vec::new();
    for unit in char::decode_utf16(units.iter().copied()) {
        match unit {
            Ok(c) => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
            Err(lone) => {
                let cp = lone.unpaired_surrogate();
                out.extend_from_slice(&[
                    0xE0 | (cp >> 12) as u8,
                    0x80 | ((cp >> 6) & 0x3F) as u8,
                    0x80 | (cp & 0x3F) as u8,
                ]);
            }
        }
    }
    out
}

fn quote_units(out: &mut String, units: &[u16]) {
    out.push('"');
    for unit in units {
        match *unit {
            0x22 => out.push_str("\\\""),
            0x5C => out.push_str("\\\\"),
            0x20..=0x7E => out.push(*unit as u8 as char),
            _ => write!(out, "\\u{unit:04x}").unwrap(),
        }
    }
    out.push('"');
}

fn quote(out: &mut String, text: &[u8]) {
    quote_units(out, &String::from_utf8_lossy(text).encode_utf16().collect::<Vec<_>>());
}

fn error(out: &mut String, error: &SyntaxError) {
    out.push_str("{\"error\":{\"message\":");
    quote(out, error.message.as_bytes());
    write!(out, ",\"index\":{}}}}}", error.index).unwrap();
}

struct Dump<'a> {
    units: &'a [u16],
    paths: HashMap<NodeId, String>,
    out: String,
}

impl<'a> Dump<'a> {
    fn children(node: Node<'a>) -> Vec<(String, Node<'a>)> {
        let mut all = Vec::new();
        let mut list = |name: &str, nodes: Nodes<'a>| {
            all.extend(nodes.iter().enumerate().map(|(i, node)| (format!("{name}/{i}"), node)));
        };
        match node.kind() {
            Kind::Pattern { alternatives }
            | Kind::CapturingGroup { alternatives, .. }
            | Kind::ClassStringDisjunction { alternatives }
            | Kind::Assertion(
                Assertion::Lookahead { alternatives, .. } | Assertion::Lookbehind { alternatives, .. },
            ) => list("alternatives", alternatives),
            Kind::Alternative { elements }
            | Kind::CharacterClass { elements, .. }
            | Kind::StringAlternative { elements } => list("elements", elements),
            Kind::Group { modifiers, alternatives } => {
                list("alternatives", alternatives);
                all.extend(modifiers.map(|node| ("modifiers".to_owned(), node)));
            }
            Kind::RegExpLiteral { pattern, flags } => {
                all.extend([("pattern".to_owned(), pattern), ("flags".to_owned(), flags)]);
            }
            Kind::Quantifier { element, .. } => all.push(("element".to_owned(), element)),
            Kind::CharacterClassRange { min, max } => {
                all.extend([("min".to_owned(), min), ("max".to_owned(), max)]);
            }
            Kind::ExpressionCharacterClass { expression, .. } => {
                all.push(("expression".to_owned(), expression));
            }
            Kind::ClassIntersection { left, right } | Kind::ClassSubtraction { left, right } => {
                all.extend([("left".to_owned(), left), ("right".to_owned(), right)]);
            }
            Kind::Modifiers { add, remove } => {
                all.push(("add".to_owned(), add));
                all.extend(remove.map(|node| ("remove".to_owned(), node)));
            }
            _ => {}
        }
        all
    }

    fn locate(&mut self, node: Node<'a>, path: String) {
        for (name, child) in Self::children(node) {
            self.locate(child, format!("{path}/{name}"));
        }
        self.paths.insert(node.id(), path);
    }

    fn path(&mut self, node: Node<'a>) {
        let path = self.paths.get(&node.id()).cloned().unwrap_or_else(|| "?".to_owned());
        quote(&mut self.out, path.as_bytes());
    }

    fn list(&mut self, name: &str, nodes: Nodes<'a>, by_path: bool) {
        write!(self.out, ",\"{name}\":[").unwrap();
        for (i, node) in nodes.iter().enumerate() {
            if i > 0 {
                self.out.push(',');
            }
            if by_path { self.path(node) } else { self.node(node) }
        }
        self.out.push(']');
    }

    fn field(&mut self, name: &str, node: Option<Node<'a>>) {
        write!(self.out, ",\"{name}\":").unwrap();
        match node {
            Some(node) => self.node(node),
            None => self.out.push_str("null"),
        }
    }

    fn text(&mut self, name: &str, text: Option<&[u8]>) {
        write!(self.out, ",\"{name}\":").unwrap();
        match text {
            Some(text) => quote(&mut self.out, text),
            None => self.out.push_str("null"),
        }
    }

    fn node(&mut self, node: Node<'a>) {
        let (start, end) = (node.utf16_start(), node.utf16_end());
        write!(self.out, "{{\"type\":\"{}\",\"parent\":", node.ty().name()).unwrap();
        match node.parent() {
            Some(parent) => self.path(parent),
            None => self.out.push_str("null"),
        }
        write!(self.out, ",\"start\":{start},\"end\":{end},\"raw\":").unwrap();
        quote_units(&mut self.out, &self.units[start as usize..end as usize]);
        match node.kind() {
            Kind::RegExpLiteral { pattern, flags } => {
                self.field("pattern", Some(pattern));
                self.field("flags", Some(flags));
            }
            Kind::Pattern { alternatives } | Kind::ClassStringDisjunction { alternatives } => {
                self.list("alternatives", alternatives, false);
            }
            Kind::Alternative { elements } | Kind::StringAlternative { elements } => {
                self.list("elements", elements, false);
            }
            Kind::Group { modifiers, alternatives } => {
                self.field("modifiers", modifiers);
                self.list("alternatives", alternatives, false);
            }
            Kind::CapturingGroup { name, alternatives, references } => {
                self.text("name", name);
                self.list("alternatives", alternatives, false);
                self.list("references", references, true);
            }
            Kind::Assertion(Assertion::Start) => self.out.push_str(",\"kind\":\"start\""),
            Kind::Assertion(Assertion::End) => self.out.push_str(",\"kind\":\"end\""),
            Kind::Assertion(Assertion::Word { negate }) => {
                write!(self.out, ",\"kind\":\"word\",\"negate\":{negate}").unwrap();
            }
            Kind::Assertion(Assertion::Lookahead { negate, alternatives }) => {
                write!(self.out, ",\"kind\":\"lookahead\",\"negate\":{negate}").unwrap();
                self.list("alternatives", alternatives, false);
            }
            Kind::Assertion(Assertion::Lookbehind { negate, alternatives }) => {
                write!(self.out, ",\"kind\":\"lookbehind\",\"negate\":{negate}").unwrap();
                self.list("alternatives", alternatives, false);
            }
            Kind::Quantifier { min, max, greedy, element } => {
                write!(self.out, ",\"min\":{min},\"max\":").unwrap();
                if max == INFINITY {
                    self.out.push_str("\"$$Infinity\"");
                } else {
                    write!(self.out, "{max}").unwrap();
                }
                write!(self.out, ",\"greedy\":{greedy}").unwrap();
                self.field("element", Some(element));
            }
            Kind::CharacterClass { unicode_sets, negate, elements } => {
                write!(self.out, ",\"unicodeSets\":{unicode_sets},\"negate\":{negate}").unwrap();
                self.list("elements", elements, false);
            }
            Kind::CharacterClassRange { min, max } => {
                self.field("min", Some(min));
                self.field("max", Some(max));
            }
            Kind::CharacterSet(CharacterSet::Any) => self.out.push_str(",\"kind\":\"any\""),
            Kind::CharacterSet(CharacterSet::Digit { negate }) => {
                write!(self.out, ",\"kind\":\"digit\",\"negate\":{negate}").unwrap();
            }
            Kind::CharacterSet(CharacterSet::Space { negate }) => {
                write!(self.out, ",\"kind\":\"space\",\"negate\":{negate}").unwrap();
            }
            Kind::CharacterSet(CharacterSet::Word { negate }) => {
                write!(self.out, ",\"kind\":\"word\",\"negate\":{negate}").unwrap();
            }
            Kind::CharacterSet(CharacterSet::Property { key, value, negate, strings }) => {
                write!(self.out, ",\"kind\":\"property\",\"strings\":{strings}").unwrap();
                self.text("key", Some(key));
                self.text("value", value);
                write!(self.out, ",\"negate\":{negate}").unwrap();
            }
            Kind::ExpressionCharacterClass { negate, expression } => {
                write!(self.out, ",\"negate\":{negate}").unwrap();
                self.field("expression", Some(expression));
            }
            Kind::ClassIntersection { left, right } | Kind::ClassSubtraction { left, right } => {
                self.field("left", Some(left));
                self.field("right", Some(right));
            }
            Kind::Character { value } => write!(self.out, ",\"value\":{value}").unwrap(),
            Kind::Backreference { reference, ambiguous, resolved } => {
                match reference {
                    Reference::Number(number) => write!(self.out, ",\"ref\":{number}").unwrap(),
                    Reference::Name(name) => self.text("ref", Some(name)),
                }
                write!(self.out, ",\"ambiguous\":{ambiguous}").unwrap();
                match resolved.first() {
                    Some(group) if !ambiguous => {
                        self.out.push_str(",\"resolved\":");
                        self.path(group);
                    }
                    _ => self.list("resolved", resolved, true),
                }
            }
            Kind::Modifiers { add, remove } => {
                self.field("add", Some(add));
                self.field("remove", remove);
            }
            Kind::ModifierFlags(flags) => write!(
                self.out,
                ",\"ignoreCase\":{},\"multiline\":{},\"dotAll\":{}",
                flags.ignore_case, flags.multiline, flags.dot_all
            )
            .unwrap(),
            Kind::Flags(flags) => write!(
                self.out,
                ",\"global\":{},\"ignoreCase\":{},\"multiline\":{},\"unicode\":{},\"sticky\":{},\"dotAll\":{},\"hasIndices\":{},\"unicodeSets\":{}",
                flags.global,
                flags.ignore_case,
                flags.multiline,
                flags.unicode,
                flags.sticky,
                flags.dot_all,
                flags.has_indices,
                flags.unicode_sets
            )
            .unwrap(),
        }
        self.out.push('}');
    }
}

struct History<'a> {
    units: &'a [u16],
    out: String,
}

impl History<'_> {
    fn add(&mut self, what: &str, node: Node<'_>) {
        if !self.out.is_empty() {
            self.out.push(',');
        }
        let mut text: Vec<u16> = format!("{what}:{}:", node.ty().name()).encode_utf16().collect();
        text.extend_from_slice(&self.units[node.utf16_start() as usize..node.utf16_end() as usize]);
        quote_units(&mut self.out, &text);
    }
}

impl<'a> Visitor<'a> for History<'_> {
    fn enter(&mut self, node: Node<'a>) {
        self.add("enter", node);
    }

    fn leave(&mut self, node: Node<'a>) {
        self.add("leave", node);
    }
}

fn parse(line: &str) -> String {
    let fields: Vec<&str> = line.split('\t').collect();
    let [kind, strict, version, source, rest @ ..] = &fields[..] else {
        return "null".to_owned();
    };
    let options = Options { strict: *strict == "1", ecma_version: version.parse().unwrap_or(2025) };
    let units = units(source);
    let source = bytes(&units);
    let ast: Result<Ast<'_>, SyntaxError> = if *kind == "pattern" {
        let flags = rest.first().map(|flags| bytes(&self::units(flags))).unwrap_or_default();
        regex::parse_pattern(&source, Mode::of_flags(&flags), options)
    } else {
        regex::parse_literal(&source, options)
    };
    let mut out = String::new();
    match ast {
        Err(it) => error(&mut out, &it),
        Ok(ast) if *kind == "visit" => {
            let mut history = History { units: &units, out: String::new() };
            ast.root().visit(&mut history);
            write!(out, "[{}]", history.out).unwrap();
        }
        Ok(ast) => {
            let mut dump = Dump { units: &units, paths: HashMap::new(), out: String::new() };
            dump.locate(ast.root(), String::new());
            dump.node(ast.root());
            write!(out, "{{\"ast\":{}}}", dump.out).unwrap();
        }
    }
    out
}

fn range(out: &mut String, text: &[u8], found: Option<regex::Match<'_>>) {
    match found {
        Some(m) => write!(
            out,
            "[{},{}]",
            regex::utf16_index(text, m.start()),
            regex::utf16_index(text, m.end())
        )
        .unwrap(),
        None => out.push_str("null"),
    }
}

fn indices(out: &mut String, text: &[u8], captures: &Captures<'_, '_>) {
    out.push('[');
    for i in 0..captures.len() {
        if i > 0 {
            out.push(',');
        }
        range(out, text, captures.get(i));
    }
    out.push(']');
}

fn compile(out: &mut String, pattern: &str, flags: &str) -> Option<Regex> {
    match Regex::from_bytes(&bytes(&units(pattern)), &bytes(&units(flags))) {
        Ok(regex) => Some(regex),
        Err(it) => {
            error(out, &it);
            None
        }
    }
}

fn exec(line: &str) -> String {
    let fields: Vec<&str> = line.split('\t').collect();
    let [pattern, flags, text, last_index] = &fields[..] else { return "null".to_owned() };
    let mut out = String::new();
    let Some(regex) = compile(&mut out, pattern, flags) else { return out };
    let text = bytes(&units(text));
    let start = regex::byte_offset(&text, last_index.parse().unwrap_or(0));
    match regex.try_exec_at(&text, start) {
        Err(_) => out.push_str("\"limit\""),
        Ok(None) => out.push_str("null"),
        Ok(Some(captures)) => {
            out.push_str("{\"indices\":");
            indices(&mut out, &text, &captures);
            out.push_str(",\"groups\":{");
            for (i, name) in regex.group_names().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                quote(&mut out, name);
                out.push(':');
                range(&mut out, &text, captures.name(name));
            }
            out.push_str("}}");
        }
    }
    out
}

fn list<'a>(out: &mut String, items: impl Iterator<Item = &'a [u8]>) {
    out.push('[');
    for (i, item) in items.enumerate() {
        if i > 0 {
            out.push(',');
        }
        quote(out, item);
    }
    out.push(']');
}

fn ops(line: &str) -> String {
    let fields: Vec<&str> = line.split('\t').collect();
    let [op, pattern, flags, text, rest @ ..] = &fields[..] else { return "null".to_owned() };
    let mut out = String::new();
    let Some(regex) = compile(&mut out, pattern, flags) else { return out };
    let text = bytes(&units(text));
    match *op {
        "test" => write!(out, "{}", regex.test(&text)).unwrap(),
        "search" => match regex.search(&text) {
            Some(at) => write!(out, "{}", regex::utf16_index(&text, at)).unwrap(),
            None => out.push_str("-1"),
        },
        "match" => list(&mut out, regex.find_iter(&text).map(|m| m.as_bytes())),
        "matchAll" => {
            out.push('[');
            for (i, captures) in regex.exec_iter(&text).enumerate() {
                if i > 0 {
                    out.push(',');
                }
                indices(&mut out, &text, &captures);
            }
            out.push(']');
        }
        "replace" => {
            let replacement = bytes(&units(rest.first().copied().unwrap_or_default()));
            quote(&mut out, &regex.replace(&text, &replacement));
        }
        "split" => list(&mut out, regex.split(&text).into_iter()),
        _ => out.push_str("null"),
    }
    out
}

fn charset(line: &str) -> String {
    let fields: Vec<&str> = line.split('\t').collect();
    let [pattern, flags] = &fields[..] else { return "null".to_owned() };
    let mut source = b"^(?:".to_vec();
    source.extend_from_slice(&bytes(&units(pattern)));
    source.extend_from_slice(b")$");
    let flags = bytes(&units(flags));
    let mut out = String::new();
    let regex = match Regex::from_bytes(&source, &flags) {
        Ok(regex) => regex,
        Err(it) => {
            error(&mut out, &it);
            return out;
        }
    };
    let limit = if regex.flags().unicode || regex.flags().unicode_sets { 0x10FFFF } else { 0xFFFF };
    let mut start = None;
    out.push('"');
    for cp in 0..=limit + 1 {
        let text = match char::from_u32(cp) {
            Some(c) => c.to_string().into_bytes(),
            None => bytes(&[cp as u16]),
        };
        let inside = cp <= limit && regex.test(&text);
        match (inside, start) {
            (true, None) => start = Some(cp),
            (false, Some(first)) => {
                if out.len() > 1 {
                    out.push(' ');
                }
                write!(out, "{first:x}-{:x}", cp - 1).unwrap();
                start = None;
            }
            _ => {}
        }
    }
    out.push('"');
    out
}

fn bench(requests: &str, repeat: usize) {
    let mut total = std::time::Duration::ZERO;
    for line in requests.lines() {
        let fields: Vec<&str> = line.split('\t').collect();
        let [pattern, flags, text, ..] = &fields[..] else { continue };
        let started = std::time::Instant::now();
        let Some(regex) = compile(&mut String::new(), pattern, flags) else { continue };
        let compiled = started.elapsed();
        let text = bytes(&units(text));
        let started = std::time::Instant::now();
        let mut found = 0;
        for _ in 0..repeat {
            found += usize::from(std::hint::black_box(&regex).test(std::hint::black_box(&text)));
        }
        let elapsed = started.elapsed();
        total += elapsed;
        println!(
            "{:>9.1} ns/test  {:>7.1} us compile  {}  /{}/{} on {} bytes",
            elapsed.as_nanos() as f64 / repeat as f64,
            compiled.as_nanos() as f64 / 1000.0,
            if found > 0 { "match   " } else { "no match" },
            String::from_utf8_lossy(regex.source()),
            String::from_utf8_lossy(&bytes(&units(flags))),
            text.len(),
        );
    }
    println!("total {total:?}");
}

pub(crate) fn run(args: &[String]) {
    let (Some(command), Some(path)) = (args.first(), args.get(1)) else {
        eprintln!("usage: bun-lint regex parse|exec|ops|bench <requests>");
        return;
    };
    let requests = std::fs::read_to_string(path).unwrap_or_default();
    if command == "bench" {
        return bench(&requests, args.get(2).and_then(|n| n.parse().ok()).unwrap_or(1000));
    }
    let stdout = std::io::stdout();
    let mut stdout = std::io::BufWriter::new(stdout.lock());
    for line in requests.lines() {
        let answer = match command.as_str() {
            "parse" => parse(line),
            "exec" => exec(line),
            "ops" => ops(line),
            "charset" => charset(line),
            _ => "null".to_owned(),
        };
        writeln!(stdout, "{answer}").unwrap();
    }
}
