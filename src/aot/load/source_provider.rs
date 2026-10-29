#[cfg(test)]
#[path = "source_provider/tests.rs"]
mod tests;

use crate::diagnostic_codes::Code;
use crate::diagnostics::log_diagnostic;
use crate::load::data_modules::parse_json;
use crate::load::loaders::loader_name;
use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{ASTMemoryAllocator, ImportKind, Loader, Loc, Log, Source};
use bun_js_parser::{Define, Parser, ParserOptions};
use bun_options_types::jsx;
use bun_react_compiler::{Observer, observe};
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::resolve::{
    FileSearch, FoundCode, Host, JsxRuntime, JsxSettings, TranspileSettings, find_file_plainly,
};
use bun_sema::session::Arena;
use std::borrow::Cow;

#[derive(Debug)]
pub struct Failed;

#[derive(Copy, Clone)]
pub struct ModuleName<'a> {
    pub namespace: &'a [u8],
    pub path: &'a [u8],
}

pub struct ResolveRequest<'a> {
    pub specifier: &'a [u8],
    pub importer: ModuleName<'a>,
    pub kind: ImportKind,
}

pub enum Resolution {
    NotHandled,
    Module { namespace: Vec<u8>, path: Vec<u8> },
    External { specifier: Vec<u8> },
}

pub struct LoadRequest<'a> {
    pub module: ModuleName<'a>,
    pub default_loader: Loader,
    pub read_file: &'a dyn Fn() -> Option<Cow<'static, [u8]>>,
}

pub enum Loaded {
    Source {
        contents: Cow<'static, [u8]>,
        loader: Loader,
        is_from_plugin: bool,
    },
    Deferred,
    NotFound,
}

impl Loaded {
    pub fn from_file(file: Option<Cow<'static, [u8]>>, default_loader: Loader) -> Loaded {
        match file {
            Some(contents) => Loaded::Source {
                contents,
                loader: default_loader,
                is_from_plugin: false,
            },
            None => Loaded::NotFound,
        }
    }
}

pub struct DeferredLoad {
    pub namespace: Vec<u8>,
    pub path: Vec<u8>,
    pub answer: Result<Loaded, Failed>,
}

pub struct SourceFile<'a> {
    pub path: &'a [u8],
    pub contents: &'a [u8],
    pub loader: Loader,
}

pub struct MacroCall<'a, 's> {
    pub importer: &'a [u8],
    /// Where the call starts in the source of the importer.
    pub position: u32,
    pub macro_path: &'a [u8],
    pub export_name: &'a [u8],
    pub arguments: &'a [&'s DataValue<'s>],
}

pub struct ComponentFile<'a> {
    pub module: ModuleName<'a>,
    pub contents: &'a [u8],
    pub loader: Loader,
    pub mode: ReactCompilerMode,
    pub settings: &'a TranspileSettings,
    pub is_entry_point: bool,
    /// Some import has attributes, so it may be `with { type: "macro" }`.
    pub can_import_macros: bool,
}

pub trait SourceProvider: Sync {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s>;

    /// The `Define` of the transpiler: what the build puts in place of names, as `fold_options` lists it.
    fn define(&self) -> Option<&Define> {
        None
    }

    /// The flags for which `feature()` of "bun:bundle" answers true, as `fold_options` lists them.
    fn enabled_features(&self) -> Vec<&[u8]> {
        Vec::new()
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed>;

    /// Which file runs for an import that no plugin has resolved.
    fn find_file(&self, host: &dyn Host, search: &FileSearch<'_>) -> FoundCode {
        find_file_plainly(host, search)
    }

    fn has_resolve_plugins(&self) -> bool {
        true
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed>;

    fn has_load_plugin(&self, _module: ModuleName<'_>) -> bool {
        true
    }

    /// What a `data:` URL holds. `None` for any other specifier, and for a URL that cannot be decoded.
    fn decode_data_url(&self, _url: &[u8]) -> Option<Vec<u8>> {
        None
    }

    /// How the run time reads the text of `new Blob(parts, { type })` as a module.
    fn loader_of_blob(&self, _type: Option<&[u8]>) -> Option<Loader> {
        None
    }

    /// The `href` of `new URL(text, base)`. `None`: the constructor throws.
    fn write_url(&self, _text: &[u8], _base: Option<&[u8]>) -> Option<Vec<u8>> {
        None
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad>;

    /// True if the embedded path of a `file` loader module does not depend on its contents.
    fn asset_paths_ignore_contents(&self) -> bool {
        false
    }

    /// Replaces the contents of a file that `parse_data` embedded with empty contents.
    fn set_embedded_contents(&self, _file: &SourceFile<'_>, _log: &mut Log) -> Result<(), Failed> {
        Ok(())
    }

    fn clear_embedded_files(&self) {}

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed>;

    fn run_macro<'s>(
        &self,
        _call: &MacroCall<'_, 's>,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        Err(report_unsupported(log, b"macros without the bundler"))
    }

    /// Parses `file` with the parser options of `bun build` and the React Compiler enabled, and reports each compiled
    /// function to `observer`. Returns false if the file has an error.
    fn compile_components(&self, file: &ComponentFile<'_>, observer: &mut dyn Observer) -> bool {
        compile_components_without_bundler(file, self.define(), observer)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        if pages.is_empty() {
            return Ok(Vec::new());
        }
        Err(report_unsupported(log, b"HTML pages without the bundler"))
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed>;
}

pub fn apply_jsx_settings(pragma: &mut jsx::Pragma, settings: &JsxSettings) {
    let members = |path: &[Vec<u8>]| -> Box<[Box<[u8]>]> {
        path.iter().map(|member| Box::from(&member[..])).collect()
    };
    pragma.runtime = match settings.runtime {
        JsxRuntime::Classic => jsx::Runtime::Classic,
        JsxRuntime::Automatic => jsx::Runtime::Automatic,
    };
    pragma.development = settings.is_development;
    if !settings.factory.is_empty() {
        pragma.factory = members(&settings.factory).into();
    }
    if !settings.fragment.is_empty() {
        pragma.fragment = members(&settings.fragment).into();
    }
    pragma.package_name = Cow::Owned(settings.import_source.clone());
    pragma.classic_import_source = pragma.package_name.clone();
    pragma.set_import_source();
}

pub fn compile_components_without_bundler(
    file: &ComponentFile<'_>,
    define: Option<&Define>,
    observer: &mut dyn Observer,
) -> bool {
    let arena = Arena::new();
    let mut store = ASTMemoryAllocator::borrowing(&arena);
    let _scope = store.enter();
    let source = Source::init_path_string(file.module.path, file.contents);
    let mut pragma = jsx::Pragma::default();
    apply_jsx_settings(&mut pragma, &file.settings.jsx);
    let mut options = ParserOptions::init(pragma, file.loader);
    options.bundle = true;
    options.warn_about_unbundled_modules = false;
    options.tree_shaking = true;
    options.is_entry_point = file.is_entry_point;
    options.import_meta_main_value = Some(file.is_entry_point);
    options.use_define_for_class_fields = file.settings.use_define_for_class_fields != Some(false);
    let has_legacy_decorators =
        file.settings.experimental_decorators || file.settings.emits_decorator_metadata;
    let features = &mut options.features;
    features.react_compiler = file.mode;
    features.emit_decorator_metadata = file.settings.emits_decorator_metadata;
    features.standard_decorators = !file.loader.is_typescript() || !has_legacy_decorators;
    features.allow_runtime = true;
    features.auto_import_jsx = true;
    features.trim_unused_imports = file.loader.is_typescript();
    features.no_macros = true;
    features.top_level_await = true;
    features.dead_code_elimination = true;
    let default_define;
    let define = match define {
        Some(define) => define,
        None => {
            default_define = Define::with_pure_globals(false, true);
            &*default_define
        }
    };
    let mut log = Log::init();
    let parsed = observe(observer, || {
        Parser::init(options, &mut log, &source, define, &arena).and_then(|parser| parser.parse())
    });
    parsed.is_ok() && !log.has_errors()
}

pub struct WithoutServices;

fn report_unsupported(log: &mut Log, feature: &[u8]) -> Failed {
    log_diagnostic(log, Code::UnsupportedOption, &[feature]);
    Failed
}

impl SourceProvider for WithoutServices {
    fn fold_options<'s>(
        &self,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        _log: &mut Log,
    ) -> FoldOptions<'s> {
        FoldOptions::default()
    }

    fn resolve(&self, _request: &ResolveRequest<'_>, _log: &mut Log) -> Result<Resolution, Failed> {
        Ok(Resolution::NotHandled)
    }

    fn has_resolve_plugins(&self) -> bool {
        false
    }

    fn load(&self, request: &LoadRequest<'_>, _log: &mut Log) -> Result<Loaded, Failed> {
        let file = (request.read_file)();
        Ok(Loaded::from_file(file, request.default_loader))
    }

    fn has_load_plugin(&self, _module: ModuleName<'_>) -> bool {
        false
    }

    fn finish_deferred_loads(&self, _log: &mut Log) -> Vec<DeferredLoad> {
        Vec::new()
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        match file.loader {
            Loader::Json | Loader::Jsonc => match parse_json(file.contents, arena, atoms) {
                Some(default) => Ok(DataModule::Value {
                    default,
                    exports_keys: true,
                }),
                None => {
                    let path = BStr::new(file.path);
                    log.add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!("\"{path}\" is not valid JSON"),
                    );
                    Err(Failed)
                }
            },
            Loader::Text => {
                #[allow(clippy::disallowed_methods)]
                // a JavaScript string holds no ill-formed UTF-8
                let text = String::from_utf8_lossy(file.contents);
                Ok(DataModule::Value {
                    default: arena.alloc(DataValue::String(atoms.intern(text.as_bytes()))),
                    exports_keys: false,
                })
            }
            _ => {
                let name = loader_name(file.loader);
                let feature = format!("the \"{name}\" loader without the bundler");
                Err(report_unsupported(log, feature.as_bytes()))
            }
        }
    }

    fn check_embedded_files(&self, _log: &mut Log) -> Result<(), Failed> {
        Ok(())
    }
}
