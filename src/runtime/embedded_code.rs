//! The Rust half of `Bun::isEmbeddedCode`: the JavaScript in this executable that is outside the builtins section.

use crate::jsc_hooks::{
    SQLITE_MODULE_SOURCE, SQLITE_MODULE_SOURCE_HOT, SQLITE_MODULE_SOURCE_STANDALONE,
    WASI_RUNNER_SOURCE, runtime_state,
};

/// The modules whose source is a `static` in Bun.
fn static_module_sources() -> [&'static [u8]; 4] {
    [
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

/// Whether `source` is all of a module's source.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__isEmbeddedModule(source: *const u8, source_len: usize) -> bool {
    let source = core::ptr::slice_from_raw_parts(source, source_len);
    if bun_standalone_graph::Graph::get_ref()
        .is_some_and(|graph| graph.find_javascript_module_by_address(source).is_some())
    {
        return true;
    }
    let state = runtime_state();
    // SAFETY: this thread's `RuntimeState`, which only this thread writes.
    let is_bun_main = !state.is_null()
        && core::ptr::eq(
            unsafe { (*state).entry_point_source_code.byte_slice() },
            source,
        );
    is_bun_main
        || static_module_sources()
            .iter()
            .any(|&known| core::ptr::eq(known, source))
}
