//! The program, and what it is told when it starts.

use super::ast::STRINGS;
use crate::estree::NodeType;
use bun_core::printer::json_stringify;

/// The part of the program that the script which runs a configuration file has too.
pub const ESLINT_PATCH: &str = include_str!("worker/eslint_patch.js");

/// The program: the names of its parts in `worker/`, and what is in them. They share one scope.
pub const PROGRAM: &[(&str, &str)] = &[
    ("eslint_patch.js", ESLINT_PATCH),
    ("paths.js", include_str!("worker/paths.js")),
    ("ast.js", include_str!("worker/ast.js")),
    ("tokens.js", include_str!("worker/tokens.js")),
    ("scope.js", include_str!("worker/scope.js")),
    ("source_code.js", include_str!("worker/source_code.js")),
    ("report.js", include_str!("worker/report.js")),
    ("code_path.js", include_str!("worker/code_path.js")),
    ("processor.js", include_str!("worker/processor.js")),
    ("eslint.js", include_str!("worker/eslint.js")),
    ("prettier.js", include_str!("worker/prettier.js")),
    ("main.js", include_str!("worker/main.js")),
];

/// `{ cwd, measures, strings, types }`. `measures`: whether the program is to say what it loads. `types`: for each [`NodeType`] `[name, [[field, flags], ..]]`, where the
/// flags are 1 for a visitor key, 2 for what only typescript-estree has, 4 for what only espree has,
/// 8 for what is not enumerable.
pub(super) fn write_start(cwd: &[u8], measures: bool, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"cwd\":");
    json_stringify(cwd, out);
    out.extend_from_slice(if measures {
        b",\"measures\":true"
    } else {
        b",\"measures\":false"
    });
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
