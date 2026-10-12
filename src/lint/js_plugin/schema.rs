//! The program, and what it is told when it starts.

use bun_core::printer::json_stringify;

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

/// `{ cwd, measures }`. `measures`: whether the program is to say what it loads.
pub(super) fn write_start(cwd: &[u8], measures: bool, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"cwd\":");
    json_stringify(cwd, out);
    out.extend_from_slice(if measures {
        b",\"measures\":true}"
    } else {
        b",\"measures\":false}"
    });
}
