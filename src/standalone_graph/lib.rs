#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): gated — Phase-A draft body depends on bun_bundler (does not compile),
// bun_str, bun_sourcemap, bun_webcore, bun_schema (not in deps). Un-gate in B-2.
#[cfg(any())]
pub mod StandaloneModuleGraph;

// Minimal stub surface so downstream `use bun_standalone_graph::...` resolves.
#[cfg(not(any()))]
pub mod StandaloneModuleGraph {
    /// Opaque stub. Real impl gated above.
    pub struct StandaloneModuleGraph(());

    impl StandaloneModuleGraph {
        pub fn get() -> Option<&'static mut StandaloneModuleGraph> {
            todo!("b1 stub: StandaloneModuleGraph::get")
        }
    }

    /// Opaque stub for embedded file entry.
    pub struct File(());

    #[cfg(not(windows))]
    pub const BASE_PATH: &str = "/$bunfs/";
    #[cfg(windows)]
    pub const BASE_PATH: &str = "B:\\~BUN\\";

    pub fn is_bun_standalone_file_path(_str: &[u8]) -> bool {
        todo!("b1 stub")
    }
}
