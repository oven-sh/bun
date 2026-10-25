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
use crate::module_format::DeclaredModuleType;
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

    /// Which file runs for an import that nothing has claimed.
    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
        find_file_plainly(self, search)
    }

    fn resolve_runtime_module(&self, _specifier: &[u8]) -> HostResolution {
        HostResolution::Unclaimed
    }

    /// The directory that the imports of a file are resolved from, and whose `tsconfig.json` says how the file is transpiled.
    fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        Cow::Borrowed(dirname::<Posix>(path))
    }

    fn find_runtime_modules(&self, _prefix: &[u8], _suffix: &[u8]) -> Vec<HostResolution> {
        Vec::new()
    }

    fn compiler_declarations(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }

    /// Declaration files that rest on `@types/bun`, for where it is installed.
    fn declarations_beside_bun_types(&self, _are_installed: bool) -> Vec<Vec<u8>> {
        Vec::new()
    }

    /// The declaration file that stands in for `@types/bun` where it is not installed.
    fn declarations_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        None
    }

    /// Where the host has `@types/bun` itself, for where it is not installed. It comes before `declarations_in_place_of_bun_types`.
    fn type_root_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        None
    }

    fn loader_of(&self, _request: &LoaderRequest<'_>) -> HostLoader {
        HostLoader::default()
    }

    /// False if `loader` makes a module out of the file without reading it as code: an asset, a text, data. What such a module exports is all that an importer sees of the file.
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

    /// True if `parse_code` produces the same module for `path` whatever its contents are, as for an embedded asset.
    fn can_read_in_background(&self, _path: &[u8], _loader: HostLoader) -> bool {
        false
    }

    /// Called once every other file is read.
    fn start_background_reads(&self, _paths: &[&[u8]]) -> bool {
        false
    }

    /// True if whoever made the host calls `read_in_background` after the load, in place of the load.
    fn reads_in_background_after_load(&self) -> bool {
        false
    }

    fn read_in_background(&self, _path: &[u8]) {}

    fn is_plugin_source(&self, _path: &[u8]) -> bool {
        false
    }

    /// `Some` once `read_code` has answered JavaScript for a TypeScript file: the loader of what runs. The file is still what its importers see as types, `read_source` answers its own text, and nobody has held the one against the other.
    fn loader_of_code_in_place_of_typed_file(&self, _path: &[u8]) -> Option<HostLoader> {
        None
    }

    fn is_library_file(&self, _path: &[u8]) -> bool {
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
}

const _: fn(&dyn CodeHost) -> &dyn Host = |host| host;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EnclosingPackage<'a> {
    pub directory: &'a [u8],
    pub name: &'a [u8],
    pub version: &'a [u8],
}

impl EnclosingPackage<'_> {
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
    /// Whether an import of a package takes "module" where the package has "main" too.
    pub prefers_module_field: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum FoundCode {
    File {
        path: Vec<u8>,
        /// The file that `require` of the same package finds, where "module" named `path`.
        required: Option<Vec<u8>>,
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
    pub type_attribute: Option<&'a [u8]>,
    pub embed_attribute: Option<&'a [u8]>,
    pub settings: &'a TranspileSettings,
    pub declared_module_type: DeclaredModuleType,
}

#[derive(Copy, Clone)]
pub struct CodeParseRequest<'a> {
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

pub struct TransformRequest<'a, 's> {
    pub path: &'a [u8],
    pub hir: &'a mut File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub settings: &'a TranspileSettings,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TreeChange {
    Unchanged,
    Changed,
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
