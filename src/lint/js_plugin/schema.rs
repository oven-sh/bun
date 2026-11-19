//! The program and its startup data.

use bun_core::printer::json_stringify;
use bun_core::strings;

/// The part of the program that the config file script also needs.
pub fn eslint_patch() -> &'static [u8] {
    bun_zstd::embed_compressed!(
        "src/lint/js_plugin/worker/eslint_patch.js",
        include_bytes!("worker/eslint_patch.js")
    )
}

/// The program, in parts that share one scope. Release builds embed it compressed and inflate it once per process.
pub fn program() -> impl Iterator<Item = &'static [u8]> {
    // `emitCompressedEmbeds` in scripts/build/codegen.ts lists the same files in the same order.
    let rest = bun_zstd::embed_compressed!(
        "lint/plugin-host.js",
        concat!(
            include_str!("worker/paths.js"),
            "\0",
            include_str!("worker/ast.js"),
            "\0",
            include_str!("worker/scope.js"),
            "\0",
            include_str!("worker/processor.js"),
            "\0",
            include_str!("worker/eslint.js"),
            "\0",
            include_str!("worker/prettier.js"),
            "\0",
            include_str!("worker/main.js"),
        )
        .as_bytes()
    );
    core::iter::once(eslint_patch()).chain(strings::split(rest, b"\0"))
}

/// Writes `{ cwd, measures }`. `measures` tells the program to report what it loads.
pub(super) fn write_start(cwd: &[u8], measures: bool, out: &mut Vec<u8>) {
    out.extend_from_slice(b"{\"cwd\":");
    json_stringify(cwd, out);
    out.extend_from_slice(if measures {
        b",\"measures\":true}"
    } else {
        b",\"measures\":false}"
    });
}
