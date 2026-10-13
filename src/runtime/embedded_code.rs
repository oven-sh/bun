//! Which JavaScript outside the builtins section is part of this executable. `Bun::isEmbeddedCode` asks.

use bun_bundler::entry_points::{MAIN_SOURCE, MAIN_SOURCE_WITH_HOT_RELOAD};

use crate::jsc_hooks::{
    SQLITE_MODULE_SOURCE, SQLITE_MODULE_SOURCE_HOT, SQLITE_MODULE_SOURCE_STANDALONE,
    WASI_RUNNER_SOURCE,
};

/// The modules Bun has the text of itself. All ASCII.
fn own_module_texts() -> [&'static [u8]; 7] {
    [
        MAIN_SOURCE.as_bytes(),
        MAIN_SOURCE_WITH_HOT_RELOAD.as_bytes(),
        SQLITE_MODULE_SOURCE,
        SQLITE_MODULE_SOURCE_HOT,
        SQLITE_MODULE_SOURCE_STANDALONE,
        WASI_RUNNER_SOURCE,
        bun_ast::runtime::Runtime::source_code(),
    ]
}

/// One of `own_module_texts` as a source the engine reads where it is: a text is known by its address, so a copy is not it.
pub(crate) fn own_module_source(text: &'static [u8]) -> bun_core::String {
    debug_assert!(
        own_module_texts()
            .iter()
            .any(|&own| core::ptr::eq(own, text))
    );
    debug_assert!(text.is_ascii());
    bun_core::String::create_static_external(text, true)
}

/// Whether `source` is all of a module's text and `bytecode`, unless it is empty, what the executable has for that module.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__isEmbeddedModule(
    source: *const u8,
    source_len: usize,
    bytecode: *const u8,
    bytecode_len: usize,
    bytecode_entry_offset: usize,
) -> bool {
    let source = core::ptr::slice_from_raw_parts(source, source_len);
    if own_module_texts()
        .iter()
        .any(|&own| core::ptr::eq(own, source))
    {
        return bytecode_len == 0;
    }
    let Some(file) =
        bun_standalone_graph::Graph::get_ref().and_then(|graph| graph.script_at(source))
    else {
        return false;
    };
    bytecode_len == 0
        || (core::ptr::eq(
            file.bytecode.cast_const(),
            core::ptr::slice_from_raw_parts(bytecode, bytecode_len),
        ) && file.bytecode_entry_offset as usize == bytecode_entry_offset)
}
