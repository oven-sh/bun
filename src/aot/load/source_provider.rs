#[cfg(test)]
#[path = "source_provider/tests.rs"]
mod tests;

use crate::diagnostic_codes::Code;
use crate::diagnostics::log_diagnostic;
use crate::load::data_modules::parse_json;
use crate::load::loaders::loader_name;
use bstr::BStr;
use bun_ast::{ImportKind, Loader, Loc, Log};
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::resolve::{FileSearch, FoundCode, Host, find_file_plainly};
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
    pub macro_path: &'a [u8],
    pub export_name: &'a [u8],
    pub arguments: &'a [&'s DataValue<'s>],
}

pub trait SourceProvider: Sync {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s>;

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
