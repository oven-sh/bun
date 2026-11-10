#[path = "../load/source_provider.rs"]
pub mod source_provider;

/// The packages that declare Bun's types, as the compiler carries them for a program whose project has not installed them:
/// the type root that they lie below, and each file with its text. `None` in a Bun without the compiler.
pub use crate::linked::bun_aot_carried_bun_types as carried_bun_types;

pub(crate) mod data_modules {
    pub(crate) use crate::linked::bun_aot_parse_json as parse_json;
}

pub(crate) mod loaders {
    pub(crate) use crate::module_keys::loader_name;
}
