//! The parser of `bun run`, for a test that compares what the build decides about a text with what `bun run` decides.

use bun_ast::Loader;
use bun_js_parser::ParserOptions;
use bun_options_types::bundle_enums::ModuleType;

/// What the module loader gives the parser for a file that `bun run` loads (`Transpiler::parse`). `module_type` is what the name of the file and its package.json say.
pub(super) fn parser_options_of_bun_run(
    loader: Loader,
    module_type: ModuleType,
) -> ParserOptions<'static> {
    let mut options = ParserOptions::init(Default::default(), loader);
    options.tree_shaking = true;
    options.warn_about_unbundled_modules = false;
    options.module_type = module_type;
    options.features.top_level_await = true;
    options.features.no_macros = true;
    options.features.inlining = true;
    options.features.minify_syntax = true;
    options.features.trim_unused_imports = loader.is_typescript();
    options.features.commonjs_at_runtime = true;
    options.features.standard_decorators = !loader.is_typescript();
    options.features.lower_using = false;
    options.features.ascii_only = true;
    options
}
