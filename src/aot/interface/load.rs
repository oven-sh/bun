#[path = "../load/source_provider.rs"]
pub mod source_provider;

/// The compiler's copy of the packages that declare Bun's types: their type root and files. `None` without the compiler.
pub use crate::linked::bun_aot_carried_bun_types as carried_bun_types;

pub(crate) mod data_modules {
    pub(crate) use crate::linked::bun_aot_parse_json as parse_json;
}

pub(crate) mod loaders {
    pub(crate) use crate::module_keys::loader_name;
}
