//! The program, and what it is told when it starts.

use super::ast::STRINGS;
use super::wire;
use crate::estree::{Field, NodeType};
use bun_core::printer::json_stringify;
use rustc_hash::FxHashMap;

/// The part of the program that the script which runs a configuration file has too.
pub const ESLINT_PATCH: &str = include_str!("worker/eslint_patch.js");

/// The program: the names of its parts in `worker/`, and what is in them. They share one scope.
pub const PROGRAM: &[(&str, &str)] = &[
    ("eslint_patch.js", ESLINT_PATCH),
    ("paths.js", include_str!("worker/paths.js")),
    ("ast.js", include_str!("worker/ast.js")),
    ("scope.js", include_str!("worker/scope.js")),
    ("processor.js", include_str!("worker/processor.js")),
    ("eslint.js", include_str!("worker/eslint.js")),
    ("prettier.js", include_str!("worker/prettier.js")),
    ("main.js", include_str!("worker/main.js")),
];

/// `{ cwd, measures, strings, types }`. `measures`: whether the program is to say what it loads. `types`: for each [`NodeType`] `[name, [[field, flags], ..]]`, where the
/// flags are 1 for a visitor key, 2 for what only typescript-estree has, 4 for what only espree has,
/// 8 for what is not enumerable.
/// `with_types`: the last two are there.
pub(super) fn write_start(cwd: &[u8], measures: bool, with_types: bool, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"cwd\":");
    json_stringify(cwd, out);
    out.extend_from_slice(if measures {
        b",\"measures\":true"
    } else {
        b",\"measures\":false"
    });
    if !with_types {
        out.push(b'}');
        return;
    }
    out.extend_from_slice(b",\"strings\":[");
    for (i, string) in STRINGS.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        json_stringify(string.as_bytes(), out);
    }
    out.extend_from_slice(b"],\"types\":[");
    for (i, node_type) in NodeType::ALL.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"[\"");
        out.extend_from_slice(node_type.name().as_bytes());
        out.extend_from_slice(b"\",[");
        for (i, entry) in node_type.fields().iter().enumerate() {
            let flags = u8::from(entry.is_child)
                | u8::from(entry.is_typescript_only) << 1
                | u8::from(entry.is_espree_only) << 2
                | u8::from(entry.is_hidden) << 3;
            if i > 0 {
                out.push(b',');
            }
            out.extend_from_slice(b"[\"");
            out.extend_from_slice(entry.field.name().as_bytes());
            out.extend_from_slice(b"\",");
            out.extend_from_slice(if flags >= 10 { b"1" } else { b"" });
            out.push(b'0' + flags % 10);
            out.push(b']');
        }
        out.extend_from_slice(b"]]");
    }
    out.extend_from_slice(b"]}");
}

/// What is in a property of a node, if it isn't a field: the number of a field is below these.
const TYPE: u32 = 0xF0;
const START: u32 = 0xF1;
const END: u32 = 0xF2;
const RANGE: u32 = 0xF3;
const PARENT: u32 = 0xF4;

/// Names, each once, one after the other.
#[derive(Default)]
struct Names {
    bytes: Vec<u8>,
    known: FxHashMap<&'static str, u32>,
}

impl Names {
    /// Where `name` starts, above its length in the low 8 bits.
    fn add(&mut self, name: &'static str) -> u32 {
        *self.known.entry(name).or_insert_with(|| {
            let start = self.bytes.len() as u32;
            self.bytes.extend_from_slice(name.as_bytes());
            start << 8 | name.len() as u32
        })
    }
}

/// A node doesn't have the field at all if there is nothing to say, where the others are `undefined`: rules ask whether a `Literal`
/// has a `regex`. espree also leaves out the `directive` of a statement that is none.
fn can_be_left_out(node_type: NodeType, field: Field, is_espree: bool) -> bool {
    matches!(
        (node_type, field),
        (NodeType::Literal, Field::Regex | Field::Bigint)
            | (NodeType::JSXText, Field::Bigint)
            | (NodeType::TSModuleDeclaration, Field::Body)
    ) || (is_espree && field == Field::Directive)
}

/// For src/jsc/bindings/LintNodes.cpp: which properties the nodes of each type have, in which order.
///
/// Words: how many types there are, how many of [`STRINGS`], how many words come before the names. Then for each type its name, and
/// for typescript-estree and for espree: how many fields `ast.rs` writes for a node, a bit for each field that is a visitor key, a bit
/// for each field that can be left out, how many properties there are, then a name and what is in it for each property. Then
/// [`STRINGS`]. Then the bytes of the names. A name is where it starts in these, above its length in the low 8 bits.
pub(super) fn write_layouts(out: &mut Vec<u8>) {
    let mut names = Names::default();
    let mut words = vec![NodeType::ALL.len() as u32, STRINGS.len() as u32, 0];
    for &node_type in NodeType::ALL {
        words.push(names.add(node_type.name()));
        for is_espree in [false, true] {
            let fields = node_type.fields().iter().filter(|it| {
                !it.is_hidden
                    && !(if is_espree {
                        it.is_typescript_only
                    } else {
                        it.is_espree_only
                    })
            });
            let (mut count, mut children, mut left_out) = (0, 0, 0);
            let mut properties = vec![names.add("type"), TYPE];
            for it in fields {
                children |= u32::from(it.is_child) << count;
                left_out |= u32::from(can_be_left_out(node_type, it.field, is_espree)) << count;
                properties.extend_from_slice(&[names.add(it.field.name()), count]);
                count += 1;
            }
            for (name, what) in [
                ("start", START),
                ("end", END),
                ("range", RANGE),
                ("parent", PARENT),
            ] {
                properties.extend_from_slice(&[names.add(name), what]);
            }
            words.extend_from_slice(&[count, children, left_out, properties.len() as u32 / 2]);
            words.extend_from_slice(&properties);
        }
    }
    words.extend(STRINGS.iter().map(|it| names.add(it)));
    words[2] = words.len() as u32;
    wire::words(out, &words);
    out.extend_from_slice(&names.bytes);
}
