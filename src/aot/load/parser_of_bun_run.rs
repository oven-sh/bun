//! The parser of `bun run`, for a test that compares what the build decides about a text with what `bun run` decides.

use bun_ast::Loader;
use bun_js_parser::ParserOptions;
use bun_options_types::bundle_enums::ModuleType;

/// The options that `Transpiler::parse` gives the parser for a file that `bun run` loads. `module_type` is what the
/// module loader takes from the name of the file and from the `package.json` above it.
pub(super) fn parser_options_of_bun_run(
    loader: Loader,
    module_type: ModuleType,
) -> ParserOptions<'static> {
    let mut options = ParserOptions::init(Default::default(), loader);
    options.tree_shaking = true;
    options.warn_about_unbundled_modules = false;
    options.module_type = module_type;
    let features = &mut options.features;
    features.top_level_await = true;
    features.no_macros = true;
    features.inlining = true;
    features.minify_syntax = true;
    features.trim_unused_imports = loader.is_typescript();
    features.commonjs_at_runtime = true;
    features.lower_using = false;
    features.ascii_only = true;
    features.standard_decorators = true;
    // `bun run` reports a legacy octal number or escape in strict code. Only the snapshot reader of `bun test` sets this.
    features.allow_legacy_octals = false;
    options
}
