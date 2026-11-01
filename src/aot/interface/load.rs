#[path = "../load/source_provider.rs"]
pub mod source_provider;

pub(crate) mod data_modules {
    pub(crate) use crate::linked::bun_aot_parse_json as parse_json;
}

pub(crate) mod loaders {
    pub(crate) use crate::module_keys::loader_name;
}
