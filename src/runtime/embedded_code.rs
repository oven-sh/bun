//! The Rust half of `Bun::isEmbeddedCode`: the JavaScript in this executable that is outside the builtins section.

use bun_bundler::entry_points::{BUN_MAIN_SOURCE, BUN_MAIN_SOURCE_HOT};

use crate::jsc_hooks::{
    SQLITE_MODULE_SOURCE, SQLITE_MODULE_SOURCE_HOT, SQLITE_MODULE_SOURCE_STANDALONE,
    WASI_RUNNER_SOURCE,
};

/// The modules whose source is a `static` in Bun.
fn static_module_sources() -> [&'static [u8]; 6] {
    [
        BUN_MAIN_SOURCE,
        BUN_MAIN_SOURCE_HOT,
        SQLITE_MODULE_SOURCE,
        SQLITE_MODULE_SOURCE_HOT,
        SQLITE_MODULE_SOURCE_STANDALONE,
        WASI_RUNNER_SOURCE,
    ]
}

/// A `ResolvedSource::source_code` that the engine reads in place: embedded code is known by its address, so a copy is not embedded.
pub(crate) fn static_source_code(source: &'static [u8]) -> bun_core::String {
    debug_assert!(
        static_module_sources()
            .iter()
            .any(|&known| core::ptr::eq(known, source))
    );
    bun_core::String::create_static_external(source, true)
}

/// Whether `source` is all of a module's source and `bytecode`, unless it is empty, what the executable has for that module.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__isEmbeddedModule(
    source: *const u8,
    source_len: usize,
    bytecode: *const u8,
    bytecode_len: usize,
    bytecode_entry_offset: usize,
) -> bool {
    let source = core::ptr::slice_from_raw_parts(source, source_len);
    if let Some(file) = bun_standalone_graph::Graph::get_ref()
        .and_then(|graph| graph.find_javascript_module_by_address(source))
    {
        return bytecode_len == 0
            || (core::ptr::eq(
                file.bytecode.cast_const(),
                core::ptr::slice_from_raw_parts(bytecode, bytecode_len),
            ) && file.bytecode_entry_offset as usize == bytecode_entry_offset);
    }
    bytecode_len == 0
        && static_module_sources()
            .iter()
            .any(|&known| core::ptr::eq(known, source))
}
