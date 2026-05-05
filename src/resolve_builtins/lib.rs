#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): gated — Phase-A draft body preserved on disk; un-gate in B-2.
// Blockers: bun_bundler::options (crate doesn't build), bun_str::{ZStr,zstr!} missing,
// bun_options_types::import_record::ImportRecord::Tag missing, inherent `static` in impl (E0658).
#[cfg(any())]
#[path = "HardcodedModule.rs"]
pub mod HardcodedModule;

#[cfg(not(any()))]
pub mod HardcodedModule {
    //! Stub surface for B-1. Real impl gated above.
    // TODO(b1): bun_bundler::options::Target missing — local stub.
    // TODO(b1): bun_str::ZStr / zstr! missing — local stub.
    // TODO(b1): bun_options_types::import_record::ImportRecord::Tag missing.

    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct HardcodedModule(());

    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub struct Alias(());

    #[derive(Copy, Clone, Default)]
    pub struct Cfg {
        pub rewrite_jest_for_tests: bool,
    }

    /// Stub for `options::Target` param until bun_bundler compiles.
    pub type Target = ();

    impl Alias {
        pub fn has(_name: &[u8], _target: Target, _cfg: Cfg) -> bool {
            todo!("b1-stub: HardcodedModule::Alias::has")
        }
        pub fn get(_name: &[u8], _target: Target, _cfg: Cfg) -> Option<Alias> {
            todo!("b1-stub: HardcodedModule::Alias::get")
        }
    }
}
