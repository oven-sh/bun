use super::{
    CodeFailure, CodeImportKind, CodeRequest, ExternalKind, Host, ParseOptions, SiteResolution,
    TranspileSettings, find_file_plainly,
};
use crate::atom::Interner;
use crate::bind::Bound;
use crate::file_analysis::FileAnalysis;
use crate::hir::{ExprId, File};
use crate::hir_from_data::HostValue;
use crate::json::Json;
use crate::module_format::{DeclaredModuleType, ModuleFormat};
use crate::program::{HostLoader, HostModuleId};
use crate::session::Arena;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use std::any::Any;
use std::borrow::Cow;

pub type HostPayload = Box<dyn Any + Send + Sync>;

pub trait CodeHost: Host {
    fn parse_runtime_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        self.parse_package_json(arena, text)
    }

    fn parse_runtime_tsconfig(&self, _arena: &Arena, _text: &[u8]) -> Option<Json> {
        None
    }

    fn resolve_code(&self, _request: &CodeRequest<'_>) -> HostResolution {
        HostResolution::Unclaimed
    }

    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
        find_file_plainly(self, search)
    }

    fn resolve_runtime_module(&self, _specifier: &[u8]) -> HostResolution {
        HostResolution::Unclaimed
    }

    fn is_name_for_transpiler_alone(&self, _specifier: &[u8]) -> bool {
        false
    }

    fn leaves_to_run_time(&self, _path: &[u8]) -> bool {
        false
    }

    fn leaves_packages_outside(&self) -> bool {
        false
    }

    fn kind_of_file_missing_at_build(&self) -> Option<ExternalKind> {
        None
    }

    fn create_file_from_data_url(&self, _url: &[u8], _type_attribute: &[u8]) -> Option<Vec<u8>> {
        None
    }

    fn create_file_of_database(&self, _specifier: &[u8]) -> Option<Vec<u8>> {
        None
    }

    fn holds_modules_with_queries(&self) -> bool {
        false
    }

    fn add_module_with_query(
        &self,
        _path: &[u8],
        _query: &[u8],
        _kind: CodeImportKind,
    ) -> Option<Vec<u8>> {
        None
    }

    fn file_of_module<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        path
    }

    fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        Cow::Borrowed(dirname::<Posix>(path))
    }

    fn is_given_in_memory(&self, _path: &[u8]) -> bool {
        false
    }

    fn directory_of_dynamic_imports<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        self.directory_of(path)
    }

    fn find_runtime_modules(&self, _prefix: &[u8], _suffix: &[u8]) -> Vec<HostResolution> {
        Vec::new()
    }

    fn compiler_declarations(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn declarations_beside_bun_types(&self, _are_installed: bool) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn declarations_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        None
    }

    fn type_root_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        None
    }

    fn errors_with_bun_types(&self) -> Option<&[(Vec<u8>, u32)]> {
        None
    }

    fn loader_of(&self, _request: &LoaderRequest<'_>) -> HostLoader {
        HostLoader::default()
    }

    fn loads_as_code(&self, _path: &[u8], _loader: HostLoader) -> bool {
        true
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        CodeRead::Text(self.read_source(path))
    }

    fn is_read_by_plugin(&self, _path: &[u8]) -> bool {
        false
    }

    fn finish_deferred_reads(&self) -> Vec<(Vec<u8>, Cow<'static, [u8]>)> {
        Vec::new()
    }

    fn can_read_in_background(&self, _path: &[u8], _loader: HostLoader) -> bool {
        false
    }

    fn start_background_reads(&self, _paths: &[&[u8]]) -> bool {
        false
    }

    fn reads_in_background_after_load(&self) -> bool {
        false
    }

    fn read_in_background(&self, _path: &[u8]) {}

    fn is_plugin_source(&self, _path: &[u8]) -> bool {
        false
    }

    fn loader_of_code_in_place_of_typed_file(&self, _path: &[u8]) -> Option<HostLoader> {
        None
    }

    fn is_library_file(&self, _path: &[u8]) -> bool {
        false
    }

    fn may_any_file_become_main_module(&self) -> bool {
        false
    }

    fn is_seen_only_by_name(&self, _path: &[u8]) -> bool {
        false
    }

    fn object_prototype_takes_names(&self) -> bool {
        false
    }

    fn hoists_top_level_variables(&self, _path: &[u8]) -> bool {
        false
    }

    fn is_evaluated_text(&self, _path: &[u8]) -> bool {
        false
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        ParsedCode {
            hir: self.parse(arena, request.path, text, atoms, request.options),
            host_values: &[],
            payload: None,
        }
    }

    fn run_macros<'s>(
        &self,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        _request: &MacroRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> &'s [(ExprId, HostValue<'s>)] {
        &[]
    }

    fn transform_tree_before_binding<'s>(
        &self,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        _request: &mut EarlyTransformRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> bool {
        false
    }

    fn transform_tree<'s>(
        &self,
        _arena: &'s Arena,
        _atoms: &Interner<'s>,
        _request: &mut TransformRequest<'_, 's>,
        _payload: &mut Option<HostPayload>,
    ) -> TreeChange {
        TreeChange::Unchanged
    }

    fn finish_file(
        &self,
        _request: &FinishedFile<'_, '_>,
        _payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        Vec::new()
    }

    fn follows_imports_on_request(&self) -> bool {
        false
    }

    fn choose_imports_to_follow(&self, _files: &[ParsedFile<'_, '_>]) -> Vec<(u32, Vec<u8>)> {
        Vec::new()
    }
}

const _: fn(&dyn CodeHost) -> &dyn Host = |host| host;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EnclosingPackage<'a> {
    pub directory: &'a [u8],
    pub name: &'a [u8],
    pub version: &'a [u8],
}

impl EnclosingPackage<'_> {
    #[cfg(test)]
    pub fn relative_path<'p>(&self, path: &'p [u8]) -> &'p [u8] {
        let relative = path.strip_prefix(self.directory).unwrap_or(path);
        relative.strip_prefix(b"/").unwrap_or(relative)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DeclaredSideEffects<'a> {
    Unspecified,
    None,
    Listed {
        directory: &'a [u8],
        entries: &'a [&'a [u8]],
    },
}

#[derive(Debug)]
pub enum CodeRead {
    Text(Cow<'static, [u8]>),
    Deferred,
}

#[derive(Copy, Clone, Debug)]
pub struct FileSearch<'a> {
    pub directory: &'a [u8],
    pub specifier: &'a [u8],
    pub kind: CodeImportKind,
    pub prefers_module_field: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum FoundCode {
    File {
        path: Vec<u8>,
        required: Option<Vec<u8>>,
        links_followed: bool,
    },
    External(Vec<u8>),
    NotFound(CodeFailure),
}

impl FoundCode {
    pub fn not_found() -> FoundCode {
        FoundCode::NotFound(CodeFailure::ModuleNotFound)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum HostResolution {
    Unclaimed,
    Path(Vec<u8>),
    ModuleSource {
        module: HostModuleId,
        path: Vec<u8>,
    },
    Module(HostModuleId),
    External {
        specifier: Vec<u8>,
        kind: ExternalKind,
    },
    Erased,
}

#[derive(Copy, Clone)]
pub struct LoaderRequest<'a> {
    pub path: &'a [u8],
    pub kind: CodeImportKind,
    pub is_linked_by_bundler: bool,
    pub type_attribute: Option<&'a [u8]>,
    pub embed_attribute: Option<&'a [u8]>,
    pub settings: &'a TranspileSettings,
    pub declared_module_type: DeclaredModuleType,
}

#[derive(Copy, Clone)]
pub struct CodeParseRequest<'a> {
    pub package_module_type: DeclaredModuleType,
    pub path: &'a [u8],
    pub loader: HostLoader,
    pub options: ParseOptions,
    pub reads_jsdoc: bool,
    pub settings: &'a TranspileSettings,
    pub declared_module_type: DeclaredModuleType,
}

pub struct ParsedCode<'s> {
    pub hir: File<'s>,
    pub host_values: &'s [(ExprId, HostValue<'s>)],
    pub payload: Option<HostPayload>,
}

pub struct MacroRequest<'a, 's> {
    pub importer: &'a [u8],
    pub hir: &'a File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub resolve: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
}

pub struct EarlyTransformRequest<'a, 's> {
    pub path: &'a [u8],
    pub hir: &'a mut File<'s>,
    pub module_format: ModuleFormat,
    pub takes_import_statements: bool,
    pub settings: &'a TranspileSettings,
    pub import_meta_main: Option<bool>,
}

pub struct TransformRequest<'a, 's> {
    pub path: &'a [u8],
    pub hir: &'a mut File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub settings: &'a TranspileSettings,
    pub import_meta_main: Option<bool>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TreeChange {
    Unchanged,
    Changed,
    ChangedAndUnfinished,
}

pub struct FinishedFile<'a, 's> {
    pub path: &'a [u8],
    pub loader: HostLoader,
    pub hir: &'a File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub atoms: &'a Interner<'s>,
    pub resolutions: &'a [SiteResolution<'a>],
}

pub struct ParsedFile<'a, 's> {
    pub file: FinishedFile<'a, 's>,
    pub payload: Option<&'a HostPayload>,
    pub version: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg_attr(miri, ignore)]
    fn relative_path_starts_below_package_directory() {
        let package = EnclosingPackage {
            directory: b"/app/node_modules/dep",
            name: b"dep",
            version: b"1.0.0",
        };
        let path = b"/app/node_modules/dep/lib/index.js";
        assert_eq!(package.relative_path(path), b"lib/index.js");
    }

    #[test]
    fn relative_path_below_root_directory() {
        let package = EnclosingPackage {
            directory: b"/",
            name: b"root",
            version: b"1.0.0",
        };
        assert_eq!(package.relative_path(b"/index.js"), b"index.js");
    }
}
