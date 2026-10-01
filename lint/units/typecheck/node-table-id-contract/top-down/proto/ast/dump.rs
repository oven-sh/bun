// Prints a tree in the text form of the Go probe that dumped the reference's own trees
// (ts-dump-and-test-importer/groundtruth/dumpast/main.go), so that a digest of the lines can be compared.
use crate::ast::ast_generated::{Def, SlotType, layout};
use crate::ast::context::Ast;
use crate::ast::flags_generated::NodeFlags;
use crate::ast::kind_generated::Kind;
use crate::ids::{ModifierListId, NodeId, NodeListId};
use std::io::Write;

pub struct Dump<'a, 's> {
    a: Ast<'a>,
    no_jsdoc: bool,
    line: Vec<u8>,
    sink: &'s mut dyn FnMut(&[u8]),
    pub nodes: u32,
}

#[derive(Clone, Copy)]
enum Label {
    Root,
    Element,
    Field(&'static str),
    JSDoc,
}

// What is left to print. The printer keeps its own stack: a tree can be deeper than the thread's stack allows.
#[derive(Clone, Copy)]
enum Item {
    Node(Label, NodeId, NodeId, usize),
    List(&'static str, bool, NodeListId, NodeId, usize),
    ModifierFlags(&'static str, ModifierListId, usize),
}

// strconv.QuoteToASCII
pub fn quote_to_ascii(text: &[u8], out: &mut Vec<u8>) {
    out.push(b'"');
    let mut rest = text;
    while let Some(&first) = rest.first() {
        let (rune, width) = decode_rune(rest);
        rest = rest.get(width..).unwrap_or(&[]);
        if width == 1 && rune == 0xFFFD {
            let _ = write!(out, "\\x{first:02x}");
            continue;
        }
        match rune {
            0x22 | 0x5C => {
                out.push(b'\\');
                out.push(rune as u8);
            }
            0x20..=0x7E => out.push(rune as u8),
            0x07 => out.extend_from_slice(b"\\a"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            0x0A => out.extend_from_slice(b"\\n"),
            0x0D => out.extend_from_slice(b"\\r"),
            0x09 => out.extend_from_slice(b"\\t"),
            0x0B => out.extend_from_slice(b"\\v"),
            r if r < 0x20 || r == 0x7F => {
                let _ = write!(out, "\\x{r:02x}");
            }
            r if r < 0x10000 => {
                let _ = write!(out, "\\u{r:04x}");
            }
            r => {
                let _ = write!(out, "\\U{r:08x}");
            }
        }
    }
    out.push(b'"');
}

// utf8.DecodeRune: (0xFFFD, 1) for a byte that starts no valid sequence.
fn decode_rune(bytes: &[u8]) -> (u32, usize) {
    let Some(&first) = bytes.first() else {
        return (0xFFFD, 0);
    };
    if first < 0x80 {
        return (u32::from(first), 1);
    }
    let width = match first {
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => return (0xFFFD, 1),
    };
    match bytes.get(..width).map(std::str::from_utf8) {
        Some(Ok(text)) => match text.chars().next() {
            Some(ch) => (u32::from(ch), width),
            None => (0xFFFD, 1),
        },
        _ => (0xFFFD, 1),
    }
}

impl<'a, 's> Dump<'a, 's> {
    pub fn new(a: Ast<'a>, no_jsdoc: bool, sink: &'s mut dyn FnMut(&[u8])) -> Self {
        Self {
            a,
            no_jsdoc,
            line: Vec::new(),
            sink,
            nodes: 0,
        }
    }
    fn flush(&mut self) {
        (self.sink)(&self.line);
        self.line.clear();
    }
    fn pad(&mut self, indent: usize) {
        self.line.resize(self.line.len() + indent, b' ');
    }
    pub fn tree(&mut self, root: NodeId) {
        let mut stack = vec![Item::Node(Label::Root, root, NodeId::NIL, 0)];
        let mut next: Vec<Item> = Vec::new();
        while let Some(item) = stack.pop() {
            next.clear();
            match item {
                Item::Node(label, node, parent, indent) => {
                    self.node(label, node, parent, indent, &mut next)
                }
                Item::List(name, raw, list, parent, indent) => {
                    self.list(name, raw, list, parent, indent, &mut next)
                }
                Item::ModifierFlags(name, list, indent) => {
                    self.pad(indent);
                    let _ = write!(
                        self.line,
                        ".{}.flags={:#x}",
                        name,
                        self.a.list_modifier_flags(list).bits()
                    );
                    self.flush();
                }
            }
            stack.extend(next.iter().rev());
        }
    }
    fn list(
        &mut self,
        label: &str,
        raw: bool,
        list: NodeListId,
        parent: NodeId,
        indent: usize,
        next: &mut Vec<Item>,
    ) {
        let a = self.a;
        let nodes = a.list_nodes(list);
        let loc = a.list_loc(list);
        self.pad(indent);
        let _ = write!(
            self.line,
            ".{}{}: list [{},{}) n={}",
            label,
            if raw { "(raw)" } else { "" },
            loc.pos(),
            loc.end(),
            nodes.len()
        );
        self.flush();
        next.extend(
            nodes
                .iter()
                .map(|child| Item::Node(Label::Element, child, parent, indent + 2)),
        );
    }
    fn node(
        &mut self,
        label: Label,
        node: NodeId,
        parent: NodeId,
        indent: usize,
        next: &mut Vec<Item>,
    ) {
        let a = self.a;
        self.pad(indent);
        match label {
            Label::Root => self.line.extend_from_slice(b"root"),
            Label::Element => self.line.push(b'-'),
            Label::JSDoc => self.line.extend_from_slice(b".jsdoc:"),
            Label::Field(name) => {
                let _ = write!(self.line, ".{name}:");
            }
        }
        if node.is_nil() {
            self.line.extend_from_slice(b" <nil>");
            self.flush();
            return;
        }
        self.nodes += 1;
        let kind = node.kind(a);
        let loc = node.loc(a);
        let _ = write!(
            self.line,
            " {} [{},{}) f={:#x}",
            kind.string(),
            loc.pos(),
            loc.end(),
            node.flags(a).bits()
        );
        let actual = node.parent(a);
        if actual != parent {
            if actual.is_nil() {
                self.line.extend_from_slice(b" parent=nil");
            } else {
                let ploc = actual.loc(a);
                let _ = write!(
                    self.line,
                    " parent={}[{},{})",
                    actual.kind(a).string(),
                    ploc.pos(),
                    ploc.end()
                );
            }
        }
        let (def, slots) = a.slots_any(node);
        let mut fields: Vec<(&'static str, SlotType, u32)> = Vec::new();
        if kind != Kind::SourceFile {
            for (field, value) in layout(def).slots.iter().zip(slots.iter()) {
                match field.ty {
                    SlotType::Node
                    | SlotType::NodeList
                    | SlotType::ModifierList
                    | SlotType::RawNodeList
                    | SlotType::Kind
                    | SlotType::TokenFlags
                    | SlotType::Text
                    | SlotType::Bool => fields.push((field.name, field.ty, *value)),
                    _ => {}
                }
            }
        }
        fields.sort_by(|x, y| x.0.as_bytes().cmp(y.0.as_bytes()));
        for &(name, ty, value) in &fields {
            match ty {
                SlotType::Kind => {
                    let _ = write!(
                        self.line,
                        " {}={}",
                        name,
                        Kind::from_u16(value as u16).string()
                    );
                }
                SlotType::TokenFlags => {
                    let _ = write!(self.line, " {name}={value:#x}");
                }
                SlotType::Text => {
                    let _ = write!(self.line, " {name}=");
                    quote_to_ascii(a.node_text(node, value), &mut self.line);
                }
                SlotType::Bool if value != 0 => {
                    let _ = write!(self.line, " {name}");
                }
                _ => {}
            }
        }
        self.flush();
        if def == Def::SourceFile {
            let file = node.as_source_file(a);
            next.push(Item::List(
                "Statements",
                false,
                file.statements,
                node,
                indent + 2,
            ));
            next.push(Item::Node(
                Label::Field("EndOfFileToken"),
                file.end_of_file_token,
                node,
                indent + 2,
            ));
        }
        for &(name, ty, value) in &fields {
            if value == 0 {
                continue;
            }
            match ty {
                SlotType::Node => next.push(Item::Node(
                    Label::Field(name),
                    NodeId(value),
                    node,
                    indent + 2,
                )),
                SlotType::NodeList => {
                    next.push(Item::List(name, false, NodeListId(value), node, indent + 2))
                }
                SlotType::RawNodeList => {
                    next.push(Item::List(name, true, NodeListId(value), node, indent + 2))
                }
                SlotType::ModifierList => {
                    next.push(Item::ModifierFlags(name, ModifierListId(value), indent + 2));
                    next.push(Item::List(name, false, NodeListId(value), node, indent + 2));
                }
                _ => {}
            }
        }
        if !self.no_jsdoc && node.flags(a).intersects(NodeFlags::HAS_JSDOC) {
            next.extend(
                node.jsdoc(a)
                    .iter()
                    .map(|doc| Item::Node(Label::JSDoc, doc, node, indent + 2)),
            );
        }
    }
}

// FNV-1a 64 over the lines, each followed by a line feed, as the golden digests are made.
pub fn tree_digest(a: Ast<'_>, root: NodeId, no_jsdoc: bool) -> (u64, u32) {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut sink = |line: &[u8]| {
        for &b in line.iter().chain(std::iter::once(&b'\n')) {
            hash ^= u64::from(b);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let mut dump = Dump::new(a, no_jsdoc, &mut sink);
    dump.tree(root);
    let nodes = dump.nodes;
    (hash, nodes)
}
