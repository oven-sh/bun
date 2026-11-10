#[cfg(test)]
#[path = "source_provider/tests.rs"]
mod tests;

use crate::compile::{EntryPointPaths, FolderPaths};
use crate::diagnostic_codes::Code;
use crate::diagnostics::log_diagnostic;
use crate::load::data_modules::parse_json;
use crate::load::loaders::loader_name;
use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{ASTMemoryAllocator, ImportKind, Loader, Loc, Log, Msg, Source};
use bun_js_parser::{
    Define, ExpandedImportMetaGlob, ImportMetaGlobHost, Parser, ParserOptions,
    record_import_meta_globs,
};
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

#[derive(Debug)]
pub enum DataFailure {
    InvalidText,
    Build,
}

impl From<Failed> for DataFailure {
    fn from(_: Failed) -> DataFailure {
        DataFailure::Build
    }
}

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

pub struct ComponentFile<'a> {
    pub module: ModuleName<'a>,
    pub contents: &'a [u8],
    pub loader: Loader,
    pub mode: ReactCompilerMode,
    pub settings: &'a TranspileSettings,
    pub is_entry_point: bool,
}

pub struct PathsOfProgram<'a> {
    pub entry_points: &'a [EntryPointPaths],
    pub folders: &'a [FolderPaths],
    pub program_files: &'a [EntryPointPaths],
}

pub struct RefusedText<'a> {
    pub path: &'a [u8],
    pub is_syntax_error: bool,
    pub message: &'a [u8],
    pub line: i32,
    pub column: i32,
    pub offset: usize,
    pub length: usize,
}

pub trait SourceProvider: Sync {
    fn work_beside_engine(&self, _paths: &PathsOfProgram<'_>) {}

    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s>;

    fn define(&self) -> Option<&Define> {
        None
    }

    fn outfile(&self) -> Option<&[u8]> {
        None
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed>;

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

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad>;

    fn decode_data_url(&self, _url: &[u8]) -> Option<Vec<u8>> {
        None
    }

    fn loader_of_blob(&self, _type: Option<&[u8]>) -> Option<Loader> {
        None
    }

    fn write_url(&self, _text: &[u8], _base: Option<&[u8]>) -> Option<Vec<u8>> {
        None
    }

    fn asset_paths_ignore_contents(&self) -> bool {
        false
    }

    fn set_embedded_contents(&self, _file: &SourceFile<'_>, _log: &mut Log) -> Result<(), Failed> {
        Ok(())
    }

    fn keep_where_text_is_refused(&self, _refused: &RefusedText<'_>) {}

    fn keep_bytes_of_data_file(&self, _source_path: &[u8]) {}

    fn keep_path_of_code_that_file_system_sees(&self, _source_path: &[u8]) {}

    fn embeds_assets(&self) -> bool {
        false
    }

    fn highest_asset_level(&self) -> usize {
        0
    }

    fn is_embeddable_only_by_asset(&self, _source_path: &[u8]) -> bool {
        false
    }

    fn is_embedding_undecided(&self, _source_path: &[u8]) -> bool {
        false
    }

    fn warn_if_not_embedded(&self, _source_path: &[u8], _warning: Msg) {}

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure>;

    fn bundle_pages(&self, pages: &[&[u8]], log: &mut Log) -> Result<Vec<Vec<u8>>, Failed> {
        match pages.is_empty() {
            true => Ok(Vec::new()),
            false => Err(report_unsupported(
                log,
                b"an import of an HTML page without the bundler",
            )),
        }
    }

    fn compile_components(&self, file: &ComponentFile<'_>, observer: &mut dyn Observer) -> bool {
        compile_components_without_bundler(file, self.define(), observer)
    }

    fn expand_globs(&self, file: &ComponentFile<'_>) -> Vec<ExpandedImportMetaGlob> {
        expand_globs_without_bundler(file, self.define())
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed>;
}

pub fn is_short_blank_text(text: &[u8]) -> bool {
    text.len() < 33 && text.iter().all(|byte| matches!(byte, b'\n' | b'\r' | b' '))
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
    observe(observer, || parse_without_bundler(file, define, None))
}

pub fn expand_globs_without_bundler(
    file: &ComponentFile<'_>,
    define: Option<&Define>,
) -> Vec<ExpandedImportMetaGlob> {
    // SAFETY: the function reads neither the pointer nor the slices.
    let host = unsafe { ImportMetaGlobHost::new(std::ptr::null_mut(), |_, _, _| None) };
    let mut expanded = Vec::new();
    record_import_meta_globs(&mut expanded, || {
        parse_without_bundler(file, define, Some(host))
    });
    expanded
}

fn parse_without_bundler(
    file: &ComponentFile<'_>,
    define: Option<&Define>,
    glob_host: Option<ImportMetaGlobHost>,
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
    options.import_meta_glob = glob_host;
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
    let parsed =
        Parser::init(options, &mut log, &source, define, &arena).and_then(|parser| parser.parse());
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
    ) -> Result<DataModule<'s>, DataFailure> {
        match file.loader {
            Loader::Json | Loader::Jsonc if file.contents.iter().all(u8::is_ascii_whitespace) => {
                Ok(DataModule::Value {
                    default: &DataValue::Object(&[]),
                    exports_keys: true,
                })
            }
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
                    Err(DataFailure::InvalidText)
                }
            },
            Loader::Text => {
                #[allow(clippy::disallowed_methods)]
                let text = String::from_utf8_lossy(file.contents);
                Ok(DataModule::Value {
                    default: arena.alloc(DataValue::String(atoms.intern(text.as_bytes()))),
                    exports_keys: false,
                })
            }
            _ => {
                let name = loader_name(file.loader);
                let feature = format!("the \"{name}\" loader without the bundler");
                Err(report_unsupported(log, feature.as_bytes()).into())
            }
        }
    }

    fn check_embedded_files(&self, _log: &mut Log) -> Result<(), Failed> {
        Ok(())
    }
}
