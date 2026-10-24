#[path = "../load/source_provider.rs"]
pub mod source_provider;

pub(crate) mod data_modules {
    pub(crate) use crate::linked::bun_aot_parse_json as parse_json;
}

pub(crate) mod loaders {
    use bun_ast::Loader;

    pub(crate) fn loader_name(loader: Loader) -> &'static str {
        loader.into()
    }
}
