//! The virtual ESTree of a file as JSON: a loop over the table of `bun_lint::estree`.
//!
//! What differs from `JSON.stringify` of what the parsers return:
//! - A field whose value is `undefined` is left out, as it is there.
//! - The `value` of a regular expression or a `bigint` literal is `null`. `regex` and `bigint` say
//!   what it is.
//! - There are no `loc`, `start`, `end`, `tokens` and `comments`.

use bun_core::strings::Utf16OffsetTable;
use bun_lint::ast::File;
use bun_lint::estree_for_tests::{Nodes, VNode, Value};
use std::io::Write as _;

/// What is being written.
enum Frame<'a> {
    /// A node, and the index of its next field.
    Node(VNode<'a>, usize),
    List(Nodes<'a>),
}

struct Writer<'a, 'o> {
    out: &'o mut Vec<u8>,
    offsets: Utf16OffsetTable,
    open: Vec<Frame<'a>>,
}

/// Appends the ESTree of `file` to `out`. Each node has `type` and `range`, in UTF-16 code units.
pub(crate) fn write_json<'a>(file: &'a File<'a>, out: &mut Vec<u8>) {
    let mut writer = Writer {
        out,
        offsets: Utf16OffsetTable::new(file.text()),
        open: Vec::new(),
    };
    writer.start_node(VNode::program(file));
    writer.run();
}

impl<'a> Writer<'a, '_> {
    fn start_node(&mut self, node: VNode<'a>) {
        let span = node.span();
        let (start, end) = (
            self.offsets.to_utf16(span.start),
            self.offsets.to_utf16(span.end),
        );
        let _ = write!(
            self.out,
            "{{\"type\":\"{}\",\"range\":[{start},{end}]",
            node.node_type().name()
        );
        self.open.push(Frame::Node(node, 0));
    }

    fn run(&mut self) {
        while let Some(frame) = self.open.last_mut() {
            match frame {
                Frame::Node(node, next) => {
                    let node = *node;
                    let Some(entry) = node.node_type().fields().get(*next) else {
                        self.out.push(b'}');
                        self.open.pop();
                        continue;
                    };
                    *next += 1;
                    let value = (entry.get)(node);
                    if matches!(value, Value::Undefined)
                        || entry.is_hidden
                        || !entry.is_in(node.dialect())
                    {
                        continue;
                    }
                    let _ = write!(self.out, ",\"{}\":", entry.field.name());
                    self.value(&value);
                }
                Frame::List(list) => {
                    let Some(element) = list.next() else {
                        self.out.push(b']');
                        self.open.pop();
                        continue;
                    };
                    if self.out.last() != Some(&b'[') {
                        self.out.push(b',');
                    }
                    self.value(&element.into());
                }
            }
        }
    }

    fn value(&mut self, value: &Value<'a>) {
        match *value {
            Value::Undefined | Value::Null | Value::Regex { .. } | Value::BigInt(_) => {
                self.out.extend_from_slice(b"null");
            }
            Value::Bool(value) => {
                self.out
                    .extend_from_slice(if value { b"true" } else { b"false" })
            }
            // What JSON has no number for is `null`, as for `JSON.stringify`.
            Value::Number(value) if !value.is_finite() => self.out.extend_from_slice(b"null"),
            Value::Number(value) => {
                let _ = write!(self.out, "{value:?}");
            }
            Value::Str(value) => self.string(value),
            Value::Object(object) => {
                self.out.push(b'{');
                for (i, (name, value)) in object.entries().into_iter().enumerate() {
                    let _ = write!(self.out, "{}\"{name}\":", if i > 0 { "," } else { "" });
                    self.value(&value);
                }
                self.out.push(b'}');
            }
            Value::Node(node) => self.start_node(node),
            Value::Nodes(list) => {
                self.out.push(b'[');
                self.open.push(Frame::List(list));
            }
        }
    }

    fn string(&mut self, value: &[u8]) {
        bun_core::printer::json_stringify(value, self.out);
    }
}
