// The JavaScript step against typescript-go 89d5d5b: an input is a source (testdata/*.js.txt) with the tree that a producer builds of TypeScript's parse of it before the step (testdata/*.tree, printed like the goldens), and its golden is what upstream's parser prints for the same source (testdata/*.tsgo.txt).
use crate::ast::stable::Arena;
use crate::ast::{
    Ast, Def, File, FileBuilder, Frozen, IdAllocator, Kind, MemberValue, NodeFlags, NodeId,
    NodeListId, NodeSink, Open, SlotType, SourceFileData, TokenFlags,
};
use crate::core::{ScriptKind, new_text_range};
use crate::diagnostics::{self, MessageId};
use crate::importer::javascript::{
    JavaScriptFile, ParseDiagnostic, convert_javascript_file, jsdoc, merge_reparse_diagnostics,
};
use crate::stringutil::util::utf8;
use std::collections::BTreeSet;
use std::fmt::Write as _;

fn parse_int(text: &[u8]) -> Option<i64> {
    let (negative, digits) = match text.split_first() {
        Some((b'-', rest)) => (true, rest),
        _ => (false, text),
    };
    if digits.is_empty() {
        return None;
    }
    let mut value: i64 = 0;
    for digit in digits {
        if !digit.is_ascii_digit() {
            return None;
        }
        value = value
            .checked_mul(10)?
            .checked_add(i64::from(digit - b'0'))?;
    }
    Some(if negative { -value } else { value })
}

fn parse_hex(text: &[u8]) -> Option<u32> {
    let digits = text.strip_prefix(b"0x")?;
    let mut value: u32 = 0;
    for digit in digits {
        value = value
            .checked_mul(16)?
            .checked_add((*digit as char).to_digit(16)?)?;
    }
    Some(value)
}

// The text up to `byte` and the text after it.
fn cut(text: &[u8], byte: u8) -> Option<(&[u8], &[u8])> {
    let at = text.iter().position(|b| *b == byte)?;
    Some((text.get(..at)?, text.get(at + 1..)?))
}

// `[pos,end)` at the start of a text, and the text after it.
fn parse_range(text: &[u8]) -> Option<(i32, i32, &[u8])> {
    let (pos, rest) = cut(text.strip_prefix(b"[")?, b',')?;
    let (end, rest) = cut(rest, b')')?;
    Some((parse_int(pos)? as i32, parse_int(end)? as i32, rest))
}

// strconv.Unquote of a string that strconv.QuoteToASCII made, and the text after its closing quote.
fn unquote(text: &[u8]) -> Option<(Vec<u8>, &[u8])> {
    let mut rest = text.strip_prefix(b"\"")?;
    let mut out = Vec::new();
    loop {
        let (first, after) = rest.split_first()?;
        rest = after;
        match first {
            b'"' => return Some((out, rest)),
            b'\\' => {
                let (escape, after) = rest.split_first()?;
                rest = after;
                let digits = match escape {
                    b'x' => 2,
                    b'u' => 4,
                    b'U' => 8,
                    _ => 0,
                };
                if digits == 0 {
                    out.push(match escape {
                        b'a' => 0x07,
                        b'b' => 0x08,
                        b'f' => 0x0c,
                        b'n' => b'\n',
                        b'r' => b'\r',
                        b't' => b'\t',
                        b'v' => 0x0b,
                        other => *other,
                    });
                    continue;
                }
                let mut value: u32 = 0;
                for digit in rest.get(..digits)? {
                    value = value * 16 + (*digit as char).to_digit(16)?;
                }
                rest = rest.get(digits..)?;
                if *escape == b'x' {
                    out.push(value as u8);
                } else {
                    utf8::append_rune(&mut out, value);
                }
            }
            other => out.push(*other),
        }
    }
}

// strconv.QuoteToASCII
fn quote_to_ascii(text: &[u8], out: &mut String) {
    out.push('"');
    let mut rest = text;
    while let Some(&first) = rest.first() {
        let (rune, size) = utf8::decode_rune_in_string(rest);
        let size = size.max(1);
        match first {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            0x07 => out.push_str("\\a"),
            0x08 => out.push_str("\\b"),
            0x0c => out.push_str("\\f"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            0x0b => out.push_str("\\v"),
            0x20..=0x7e => out.push(first as char),
            0x00..=0x1f | 0x7f => {
                let _ = write!(out, "\\x{first:02x}");
            }
            _ if rune == utf8::RUNE_ERROR && size == 1 => {
                let _ = write!(out, "\\x{first:02x}");
            }
            _ if rune < 0x10000 => {
                let _ = write!(out, "\\u{rune:04x}");
            }
            _ => {
                let _ = write!(out, "\\U{rune:08x}");
            }
        }
        rest = rest.get(size..).unwrap_or(&[]);
    }
    out.push('"');
}

// Reads a tree in the form that the Go probe prints into a builder.
struct Loader<'t, 'b> {
    b: &'b mut FileBuilder,
    lines: Vec<&'t [u8]>,
    at: usize,
    // The JSDoc nodes by their ranges: a comment that two hosts hold is printed once and marked SHARED where it comes again.
    comments: Vec<(i32, i32, NodeId)>,
}

fn indent_of(line: &[u8]) -> usize {
    line.iter().take_while(|byte| **byte == b' ').count()
}

impl<'t> Loader<'t, '_> {
    fn peek(&self) -> Option<(usize, &'t [u8])> {
        let line = *self.lines.get(self.at)?;
        let indent = indent_of(line);
        Some((indent, line.get(indent..)?))
    }

    // A kind of the probe, or a kind that only TypeScript has and that a producer maps.
    fn kind_of(name: &[u8]) -> Result<Kind, String> {
        let name = name.strip_prefix(b"Kind").unwrap_or(name);
        Kind::from_name(name)
            .or_else(|| jsdoc::kind_of_typescript_kind(name))
            .ok_or_else(|| format!("no kind {}", name.escape_ascii()))
    }

    // The scalar members that the line of a node names after its flags.
    fn scalars(&mut self, node: NodeId, def: Def, mut rest: &[u8]) -> Result<(), String> {
        let info = def.info();
        while !rest.is_empty() {
            let name_len = rest
                .iter()
                .position(|byte| *byte == b'=' || *byte == b' ')
                .unwrap_or(rest.len());
            let (member, after) = rest.split_at(name_len);
            let ty = info
                .slot_index(member)
                .and_then(|index| info.slots.get(index))
                .map(|slot| slot.ty);
            let set = match (ty, after.strip_prefix(b"=")) {
                (Some(SlotType::Bool), None) => {
                    rest = after;
                    self.b.set_member(node, member, MemberValue::Bool(true))
                }
                (Some(SlotType::Text), Some(value)) => {
                    let (text, after) = unquote(value).ok_or("a text is not quoted")?;
                    rest = after;
                    self.b.set_member(node, member, MemberValue::Text(&text))
                }
                (Some(ty @ (SlotType::Kind | SlotType::TokenFlags)), Some(value)) => {
                    let word_len = value
                        .iter()
                        .position(|byte| *byte == b' ')
                        .unwrap_or(value.len());
                    let (word, after) = value.split_at(word_len);
                    rest = after;
                    if ty == SlotType::Kind {
                        let kind = Self::kind_of(word)?;
                        self.b.set_member(node, member, MemberValue::Kind(kind))
                    } else {
                        let bits = parse_hex(word).ok_or("token flags are no number")?;
                        let flags = TokenFlags::from_bits(bits as i32);
                        self.b
                            .set_member(node, member, MemberValue::TokenFlags(flags))
                    }
                }
                _ => false,
            };
            if !set {
                return Err(format!(
                    "{}.{} is not set",
                    info.name,
                    member.escape_ascii()
                ));
            }
            rest = rest.strip_prefix(b" ").unwrap_or(rest);
        }
        Ok(())
    }

    // The node of the line at `self.at`, with everything under it.
    fn node(&mut self, in_modifiers: bool) -> Result<NodeId, String> {
        let (indent, line) = self.peek().ok_or("a node line is missing")?;
        self.at += 1;
        let (label, rest) = cut(line, b' ').ok_or("a node line has no label")?;
        let (kind_name, rest) = cut(rest, b' ').ok_or("a node line has no kind")?;
        let kind = Self::kind_of(kind_name)?;
        let (pos, end, rest) = parse_range(rest).ok_or("a node line has no range")?;
        let rest = rest
            .strip_prefix(b" f=")
            .ok_or("a node line has no flags")?;
        let (flags, mut rest) = cut(rest, b' ').unwrap_or((rest, &[]));
        let flags = NodeFlags::from_bits(parse_hex(flags).ok_or("flags are no number")?);
        if let Some(after) = rest.strip_prefix(b"parent=") {
            rest = cut(after, b' ').map_or(&b""[..], |(_, rest)| rest);
        }
        if rest == b"SHARED" {
            let shared = self
                .comments
                .iter()
                .rev()
                .find(|comment| comment.0 == pos && comment.1 == end);
            return shared
                .map(|comment| comment.2)
                .ok_or_else(|| String::from("a shared node was not printed before"));
        }
        let (main, second) = Def::of_kind(kind);
        let is_token = in_modifiers || label.ends_with(b"Token:") || label.ends_with(b"Modifier:");
        let def = if is_token && second != Def::None {
            second
        } else {
            main
        };
        let node = self.b.new_node_by_def(def, kind);
        self.b.set_loc(node, new_text_range(pos, end));
        self.scalars(node, def, rest)?;
        let info = def.info();
        let mut js_doc: Vec<NodeId> = Vec::new();
        while let Some((child_indent, line)) = self.peek() {
            if child_indent <= indent {
                break;
            }
            let (label, rest) = cut(line, b' ').unwrap_or((line, &[]));
            if label == b".jsdoc:" {
                js_doc.push(self.node(false)?);
                continue;
            }
            let Some(member) = label.strip_prefix(b".").and_then(|l| l.strip_suffix(b":")) else {
                // The flags of a modifier list: the builder computes them.
                self.at += 1;
                continue;
            };
            let Some(list) = rest.strip_prefix(b"list ") else {
                let child = self.node(false)?;
                if !self.b.set_member(node, member, MemberValue::Node(child)) {
                    return Err(format!(
                        "{}.{} holds no node",
                        info.name,
                        member.escape_ascii()
                    ));
                }
                continue;
            };
            self.at += 1;
            let member = member.strip_suffix(b"(raw)").unwrap_or(member);
            let (list_pos, list_end, _) = parse_range(list).ok_or("a list line has no range")?;
            let is_modifiers = info
                .slot_index(member)
                .and_then(|index| info.slots.get(index))
                .is_some_and(|slot| slot.ty == SlotType::ModifierList);
            let mut items: Vec<NodeId> = Vec::new();
            while self
                .peek()
                .is_some_and(|(item_indent, _)| item_indent > child_indent)
            {
                items.push(self.node(is_modifiers)?);
            }
            let list = if is_modifiers {
                self.b.new_modifier_list(&items).as_node_list()
            } else {
                self.b.new_node_list(&items)
            };
            self.b
                .set_list_loc(list, new_text_range(list_pos, list_end));
            if !self.b.set_member(node, member, MemberValue::List(list)) {
                return Err(format!(
                    "{}.{} holds no list",
                    info.name,
                    member.escape_ascii()
                ));
            }
        }
        if !js_doc.is_empty() {
            self.b.attach_jsdoc(node, &js_doc);
        }
        self.b.set_flags(node, flags);
        if kind == Kind::JSDoc {
            self.comments.push((pos, end, node));
        }
        Ok(node)
    }
}

// The lines of a text from its root node to the end of the tree.
fn tree_of(text: &[u8]) -> Vec<&[u8]> {
    text.split(|byte| *byte == b'\n')
        .skip_while(|line| !line.starts_with(b"root "))
        .take_while(|line| line.starts_with(b"root ") || line.starts_with(b" "))
        .collect()
}

pub(crate) fn load_tree(b: &mut FileBuilder, text: &[u8]) -> Result<NodeId, String> {
    let mut loader = Loader {
        b,
        lines: tree_of(text),
        at: 0,
        comments: Vec::new(),
    };
    loader.node(false)
}

struct Dumper<'a> {
    a: Ast<'a>,
    out: String,
    seen: BTreeSet<NodeId>,
}

impl Dumper<'_> {
    fn list(&mut self, label: &str, raw: bool, list: NodeListId, parent: NodeId, indent: usize) {
        let loc = self.a.list_loc(list);
        let nodes = self.a.nodes(list);
        let nodes = nodes.as_slice();
        let (pos, end) = if raw {
            (-1, -1)
        } else {
            (loc.pos(), loc.end())
        };
        let raw = if raw { "(raw)" } else { "" };
        let _ = writeln!(
            self.out,
            "{:indent$}.{label}{raw}: list [{pos},{end}) n={}",
            "",
            nodes.len()
        );
        for node in nodes {
            self.node("-", *node, parent, indent + 2);
        }
    }

    // One node as the Go probe prints it: the scalar members on its line, then the node and list members, each group in the byte order of the names, then the JSDoc of the node.
    fn node(&mut self, label: &str, node: NodeId, parent: NodeId, indent: usize) {
        let a = self.a;
        let _ = write!(
            self.out,
            "{:indent$}{label} {} [{},{}) f={:#x}",
            "",
            a.kind(node).string(),
            a.pos(node),
            a.end(node),
            a.flags(node).bits()
        );
        let actual = a.parent(node);
        if actual != parent {
            if actual.is_nil() {
                self.out.push_str(" parent=nil");
            } else {
                let _ = write!(
                    self.out,
                    " parent={}[{},{})",
                    a.kind(actual).string(),
                    a.pos(actual),
                    a.end(actual)
                );
            }
        }
        if !self.seen.insert(node) {
            self.out.push_str(" SHARED\n");
            return;
        }
        let Some((def, data)) = a.data_any(node) else {
            self.out.push('\n');
            return;
        };
        if a.kind(node) == Kind::SourceFile {
            self.out.push('\n');
            let view = a.as_source_file(node);
            self.list("Statements", false, view.statements, node, indent + 2);
            self.node(".EndOfFileToken:", view.end_of_file_token, node, indent + 2);
            return;
        }
        let mut members: Vec<(usize, &str, SlotType)> = def
            .info()
            .slots
            .iter()
            .enumerate()
            .map(|(index, slot)| (index, slot.name, slot.ty))
            .collect();
        members.sort_by(|left, right| left.1.as_bytes().cmp(right.1.as_bytes()));
        for (index, name, ty) in &members {
            match ty {
                SlotType::Kind => {
                    let _ = write!(self.out, " {name}={}", data.kind(*index).string());
                }
                SlotType::TokenFlags => {
                    let _ = write!(self.out, " {name}={:#x}", data.token_flags(*index).bits());
                }
                SlotType::Text => {
                    let _ = write!(self.out, " {name}=");
                    quote_to_ascii(data.text(*index), &mut self.out);
                }
                SlotType::Bool if data.bool(*index) => {
                    let _ = write!(self.out, " {name}");
                }
                _ => {}
            }
        }
        self.out.push('\n');
        for (index, name, ty) in &members {
            match ty {
                SlotType::Node if !data.node(*index).is_nil() => {
                    let label = format!(".{name}:");
                    self.node(&label, data.node(*index), node, indent + 2);
                }
                SlotType::NodeList if !data.list(*index).is_nil() => {
                    self.list(name, false, data.list(*index), node, indent + 2);
                }
                SlotType::RawNodeList if !data.list(*index).is_nil() => {
                    self.list(name, true, data.list(*index), node, indent + 2);
                }
                SlotType::ModifierList if !data.list(*index).is_nil() => {
                    let flags = a.modifier_list_flags(data.modifiers(*index));
                    let _ = writeln!(
                        self.out,
                        "{:indent$}.{name}.flags={:#x}",
                        "",
                        flags.bits(),
                        indent = indent + 2
                    );
                    self.list(name, false, data.list(*index), node, indent + 2);
                }
                _ => {}
            }
        }
        for comment in a.jsdoc(node).as_slice() {
            self.node(".jsdoc:", *comment, node, indent + 2);
        }
    }
}

pub(crate) fn dump(file: &File, ids: &IdAllocator) -> String {
    let arena = Arena::new();
    let open = Open::new(&arena, ids);
    let Ok(frozen) = Frozen::of_files(&[file]) else {
        return String::from("the file has no page table\n");
    };
    let mut dumper = Dumper {
        a: Ast::new(&frozen, &open),
        out: String::new(),
        seen: BTreeSet::new(),
    };
    dumper.node("root", file.source_file.root, NodeId::NIL, 0);
    dumper.out
}

// What the step made of one input.
pub(crate) struct Outcome {
    pub(crate) tree: String,
    pub(crate) js: JavaScriptFile,
    // The statement that makes the file a module, as the Go probe prints a node: `<nil>` when there is none.
    pub(crate) module_indicator: String,
    // The number of internal diagnostics of the builder and of `finish`.
    pub(crate) fault_count: u32,
}

// Loads the tree `before`, runs the step when `step` is set, freezes the file and prints it.
pub(crate) fn run(source: &[u8], before: &[u8], step: bool) -> Result<Outcome, String> {
    let ids = IdAllocator::new();
    let mut builder = FileBuilder::new(source);
    let root = load_tree(&mut builder, before)?;
    let js = if step {
        convert_javascript_file(&mut builder, root)
    } else {
        JavaScriptFile {
            reparsed_clones: Vec::new(),
            reparse_diagnostics: Vec::new(),
            js_diagnostics: Vec::new(),
            external_module_indicator_statement: NodeId::NIL,
        }
    };
    let statement = js.external_module_indicator_statement;
    let module_indicator = if statement.is_nil() {
        String::from("<nil>")
    } else {
        let loc = builder.loc(statement);
        let kind = builder.kind(statement).string();
        format!("{kind}[{},{})", loc.pos(), loc.end())
    };
    let data = SourceFileData {
        script_kind: ScriptKind::JS,
        reparsed_clones: js.reparsed_clones.clone(),
        ..SourceFileData::default()
    };
    let file = builder
        .finish(root, data, &ids)
        .ok_or("the builder did not finish")?;
    Ok(Outcome {
        tree: dump(&file, &ids),
        js,
        module_indicator,
        fault_count: file.fault_count(),
    })
}

const CODES: &[(MessageId, u32)] = &[
    (diagnostics::IDENTIFIER_EXPECTED, 1003),
    (diagnostics::DECORATORS_ARE_NOT_VALID_HERE, 1206),
    (diagnostics::DECORATOR_USED_BEFORE_EXPORT_HERE, 1486),
    (diagnostics::X_IMPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES, 8002),
    (diagnostics::X_EXPORT_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES, 8003),
    (
        diagnostics::TYPE_PARAMETER_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8004,
    ),
    (
        diagnostics::X_IMPLEMENTS_CLAUSES_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8005,
    ),
    (
        diagnostics::X_0_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8006,
    ),
    (
        diagnostics::TYPE_ALIASES_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8008,
    ),
    (
        diagnostics::THE_0_MODIFIER_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8009,
    ),
    (
        diagnostics::TYPE_ANNOTATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8010,
    ),
    (
        diagnostics::TYPE_ARGUMENTS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8011,
    ),
    (
        diagnostics::PARAMETER_MODIFIERS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8012,
    ),
    (
        diagnostics::NON_NULL_ASSERTIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8013,
    ),
    (
        diagnostics::TYPE_ASSERTION_EXPRESSIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8016,
    ),
    (
        diagnostics::SIGNATURE_DECLARATIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8017,
    ),
    (
        diagnostics::TYPE_SATISFACTION_EXPRESSIONS_CAN_ONLY_BE_USED_IN_TYPESCRIPT_FILES,
        8037,
    ),
    (
        diagnostics::DECORATORS_MAY_NOT_APPEAR_AFTER_EXPORT_OR_EXPORT_DEFAULT_IF_THEY_ALSO_APPEAR_BEFORE_EXPORT,
        8038,
    ),
];

// The diagnostics as the Go probe prints them, up to the code: `label [pos,end) TS1234`.
pub(crate) fn diagnostic_lines(label: &str, diagnostics: &[ParseDiagnostic]) -> Vec<String> {
    let line = |label: &str, diagnostic: &ParseDiagnostic| {
        let code = CODES
            .iter()
            .find(|entry| entry.0 == diagnostic.message)
            .map_or(0, |entry| entry.1);
        let loc = diagnostic.loc;
        format!("{label} [{},{}) TS{code}", loc.pos(), loc.end())
    };
    let related = format!("{label}.related");
    let mut lines = Vec::new();
    for diagnostic in diagnostics {
        lines.push(line(label, diagnostic));
        for information in &diagnostic.related_information {
            lines.push(line(&related, information));
        }
    }
    lines
}

// The lines of a golden with this label, cut after the code.
pub(crate) fn golden_diagnostic_lines(golden: &[u8], label: &[u8]) -> Vec<String> {
    let mut lines = Vec::new();
    for line in golden.split(|byte| *byte == b'\n') {
        let is_labelled = line
            .strip_prefix(label)
            .is_some_and(|rest| rest.starts_with(b" [") || rest.starts_with(b".related ["));
        if !is_labelled {
            continue;
        }
        let code_at = line
            .iter()
            .position(|byte| *byte == b')')
            .map_or(line.len(), |at| at + 4);
        let digits = line
            .get(code_at..)
            .unwrap_or(&[])
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        let cut = line.get(..code_at + digits).unwrap_or(line);
        lines.push(cut.escape_ascii().to_string());
    }
    lines
}

// What a line of the head of a golden has after this label.
fn golden_header<'t>(golden: &'t [u8], label: &[u8]) -> &'t [u8] {
    golden
        .split(|byte| *byte == b'\n')
        .find_map(|line| line.strip_prefix(label))
        .unwrap_or(&[])
}

macro_rules! case {
    ($name:literal) => {
        (
            $name,
            include_bytes!(concat!("testdata/", $name, ".txt")).as_slice(),
            include_bytes!(concat!("testdata/", $name, ".tree")).as_slice(),
            include_bytes!(concat!("testdata/", $name, ".tsgo.txt")).as_slice(),
        )
    };
}

// Inputs that together take every branch of the reparser and every diagnostic of checkJSSyntax.
const CASES: &[(&str, &[u8], &[u8], &[u8])] = &[
    case!("hosted.js"),
    case!("unhosted.js"),
    case!("classes.js"),
    case!("signatures.js"),
    case!("literals.js"),
    case!("jssyntax.js"),
    case!("shapes.js"),
];

fn assert_same_lines(name: &str, actual: &str, expected: &[&[u8]]) {
    let actual: Vec<&[u8]> = actual.as_bytes().split(|byte| *byte == b'\n').collect();
    for (at, line) in expected.iter().enumerate() {
        let printed = actual.get(at).copied().unwrap_or(&[]);
        assert_eq!(
            printed.escape_ascii().to_string(),
            line.escape_ascii().to_string(),
            "{name}: line {}",
            at + 1
        );
    }
    // The printed tree ends with a line break, so its last line is empty.
    assert_eq!(actual.len(), expected.len() + 1, "{name}: lines");
}

#[test]
fn the_printer_prints_what_the_loader_read() {
    // shapes.js has a kind that only TypeScript has: the loader reads it as the kind of the reference.
    for (name, source, before, _) in CASES.iter().filter(|case| case.0 != "shapes.js") {
        let outcome = match run(source, before, false) {
            Ok(outcome) => outcome,
            Err(error) => panic!("{name}: {error}"),
        };
        assert_same_lines(name, &outcome.tree, &tree_of(before));
        assert_eq!(outcome.fault_count, 0, "{name}");
    }
}

#[test]
fn the_step_builds_the_tree_of_the_reference() {
    for (name, source, before, golden) in CASES {
        let outcome = match run(source, before, true) {
            Ok(outcome) => outcome,
            Err(error) => panic!("{name}: {error}"),
        };
        assert_same_lines(name, &outcome.tree, &tree_of(golden));
        assert_eq!(outcome.fault_count, 0, "{name}");
        assert_eq!(
            outcome
                .module_indicator
                .as_bytes()
                .escape_ascii()
                .to_string(),
            golden_header(golden, b"externalModuleIndicator ")
                .escape_ascii()
                .to_string(),
            "{name}"
        );
        let counts = golden_header(golden, b"counts ");
        let clones = format!("reparsedClones={}", outcome.js.reparsed_clones.len());
        assert!(counts.ends_with(clones.as_bytes()), "{name}: {clones}");
        assert_eq!(
            diagnostic_lines("jsDiagnostic", &outcome.js.js_diagnostics),
            golden_diagnostic_lines(golden, b"jsDiagnostic"),
            "{name}"
        );
        let mut parse_diagnostics = Vec::new();
        merge_reparse_diagnostics(&mut parse_diagnostics, outcome.js.reparse_diagnostics);
        assert_eq!(
            diagnostic_lines("diagnostic", &parse_diagnostics),
            golden_diagnostic_lines(golden, b"diagnostic"),
            "{name}"
        );
    }
}

#[test]
fn the_shapes_of_the_jsdoc_nodes_are_given_once() {
    for (name, source, before, _) in CASES {
        let mut builder = FileBuilder::new(source);
        let root = match load_tree(&mut builder, before) {
            Ok(root) => root,
            Err(error) => panic!("{name}: {error}"),
        };
        jsdoc::convert_jsdoc_shapes(&mut builder, root);
        let nodes = builder.node_count();
        jsdoc::convert_jsdoc_shapes(&mut builder, root);
        assert_eq!(builder.node_count(), nodes, "{name}");
    }
}

#[test]
fn a_reparse_diagnostic_goes_among_the_parse_diagnostics_by_position() {
    let at = |pos: i32| ParseDiagnostic {
        message: diagnostics::IDENTIFIER_EXPECTED,
        loc: new_text_range(pos, pos + 1),
        args: Vec::new(),
        related_information: Vec::new(),
    };
    let mut parse_diagnostics = vec![at(2), at(9), at(20)];
    merge_reparse_diagnostics(&mut parse_diagnostics, vec![at(12), at(9), at(0), at(30)]);
    let positions: Vec<i32> = parse_diagnostics.iter().map(|d| d.loc.pos()).collect();
    assert_eq!(positions, [0, 2, 9, 12, 20, 30]);
}

#[test]
fn a_property_of_typescript_maps_to_a_member_that_exists() {
    for (kind, property, member) in [
        (Kind::JSDocAugmentsTag, &b"class"[..], "ClassName"),
        (Kind::JSDocImplementsTag, b"class", "ClassName"),
        (Kind::JSDocTypedefTag, b"fullName", "name"),
        (Kind::JSDocCallbackTag, b"fullName", "name"),
        (Kind::JSDocSeeTag, b"name", "NameExpression"),
        (
            Kind::JSDocTypeLiteral,
            b"jsDocPropertyTags",
            "JSDocPropertyTags",
        ),
        (Kind::TypeParameter, b"default", "DefaultType"),
    ] {
        assert_eq!(
            jsdoc::member_of_typescript_property(kind, property),
            jsdoc::JsDocMember::Renamed(member)
        );
        let info = Def::of_kind(kind).0.info();
        assert!(info.slot_index(member.as_bytes()).is_some(), "{member}");
    }
    assert_eq!(
        jsdoc::member_of_typescript_property(Kind::JSDocTypedefTag, b"name"),
        jsdoc::JsDocMember::Dropped
    );
    assert_eq!(
        jsdoc::member_of_typescript_property(Kind::JSDocTypeTag, b"typeExpression"),
        jsdoc::JsDocMember::Same
    );
    assert_eq!(
        jsdoc::kind_of_typescript_kind(b"JSDocEnumTag"),
        Some(Kind::JSDocUnknownTag)
    );
    assert_eq!(jsdoc::kind_of_typescript_kind(b"JSDocTypeTag"), None);
}
