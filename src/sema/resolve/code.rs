use super::*;
use crate::import_sites::ImportSiteKind;
use crate::program::HostModuleId;

mod computed;
mod config;
mod declarations;
mod manifest;
#[cfg(test)]
pub(super) mod memory_host;
mod options;
mod search;
#[cfg(test)]
mod tests;

pub use self::config::{JsxRuntime, JsxSettings, TranspileSettings};
pub use self::options::{AOT_CONDITION, CodeOptions, ExtensionOrders};
pub use self::search::find_file_plainly;

use self::config::ConfigCaches;
use self::manifest::CodeManifest;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeImportKind {
    EntryPoint,
    Import,
    Require,
}

impl CodeImportKind {
    pub fn from_site(kind: ImportSiteKind) -> CodeImportKind {
        match kind {
            ImportSiteKind::ImportEquals(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::GetBuiltinModule(_)
            | ImportSiteKind::RequireByTestRunner(_) => CodeImportKind::Require,
            _ => CodeImportKind::Import,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeImportForm {
    Static,
    Dynamic,
    ResolveOnly,
    Macro,
    WrittenByHost,
}

impl CodeImportForm {
    pub fn from_site(kind: ImportSiteKind) -> CodeImportForm {
        match kind {
            ImportSiteKind::ImportCall(_) | ImportSiteKind::ImportByTestRunner(_) => {
                CodeImportForm::Dynamic
            }
            ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaResolve(_)
            | ImportSiteKind::MockModule(_) => CodeImportForm::ResolveOnly,
            _ => CodeImportForm::Static,
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct CodeRequest<'a> {
    pub specifier: &'a [u8],
    pub importer: &'a [u8],
    pub directory: &'a [u8],
    pub kind: CodeImportKind,
    pub form: CodeImportForm,
}

#[derive(Copy, Clone, Debug)]
pub struct ComputedCodeRequest<'a> {
    pub prefix: &'a [u8],
    pub suffix: &'a [u8],
    pub importer: &'a [u8],
    pub directory: &'a [u8],
    pub kind: CodeImportKind,
    pub form: CodeImportForm,
    pub site: SiteOfComputedLoad<'a>,
}

#[derive(Copy, Clone, Default, Debug)]
pub struct SiteOfComputedLoad<'a> {
    pub folder: &'a [u8],
    pub type_attribute: Option<&'a [u8]>,
    pub opens_database: bool,
    pub starts_at_own_folder: bool,
    pub is_written_in_load: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeFailure {
    ModuleNotFound,
    PackageNotFound,
    BuiltinModuleNotFound,
    PackagePathNotExported,
    PackageImportNotDefined,
    InvalidModuleSpecifier,
    InvalidPackageTarget,
    InvalidPackageConfiguration,
    UnsupportedDirectoryImport,
    QueryString,
}

impl CodeFailure {
    pub fn is_refusal_of_package_json(self) -> bool {
        match self {
            CodeFailure::PackagePathNotExported
            | CodeFailure::PackageImportNotDefined
            | CodeFailure::InvalidModuleSpecifier
            | CodeFailure::InvalidPackageTarget
            | CodeFailure::InvalidPackageConfiguration
            | CodeFailure::UnsupportedDirectoryImport => true,
            CodeFailure::ModuleNotFound
            | CodeFailure::PackageNotFound
            | CodeFailure::BuiltinModuleNotFound
            | CodeFailure::QueryString => false,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ExternalKind {
    UncompiledCode,
    HostValue,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CodeFile<'h> {
    pub path: &'h [u8],
    pub host_module: Option<HostModuleId>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CodeResolution<'h> {
    File(CodeFile<'h>),
    HostModule(HostModuleId),
    External {
        specifier: &'h [u8],
        kind: ExternalKind,
    },
    Erased,
    NotFound(CodeFailure),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ComputedUnknown {
    NoPattern,
    NoConstantPrefix,
    PackageImports,
    ConfigPaths,
    ExternalCandidate,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ComputedCandidate<'h> {
    File(CodeFile<'h>),
    HostModule(HostModuleId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ComputedSpelling<'h> {
    pub text: &'h [u8],
    pub candidate: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ComputedResolution<'h> {
    Candidates {
        candidates: &'h [ComputedCandidate<'h>],
        spellings: &'h [ComputedSpelling<'h>],
    },
    All {
        cause: ComputedUnknown,
        host_modules: &'h [ComputedCandidate<'h>],
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SiteResolution<'h> {
    Constant(CodeResolution<'h>),
    Computed(ComputedResolution<'h>),
}

pub(super) struct CodeState<'h> {
    host: &'h dyn CodeHost,
    options: &'h CodeOptions,
    resolutions: Memo<&'h [u8], CodeResolution<'h>>,
    manifests: Memo<&'h [u8], Option<&'h CodeManifest<'h>>>,
    required_files: bun_threading::Guarded<FxHashMap<&'h [u8], &'h [u8]>>,
    files_found_with_side_effects: bun_threading::Guarded<FxHashSet<&'h [u8]>>,
    configs: ConfigCaches<'h>,
}

impl<'h> Resolver<'h> {
    pub fn for_compile(
        session: &'h Session,
        host: &'h dyn CodeHost,
        options: &'h Options,
        code: &'h CodeOptions,
    ) -> Resolver<'h> {
        let caches = Caches {
            manifest_texts: Some(Memo::new(false)),
            ..Caches::new(false)
        };
        let state = CodeState {
            host,
            options: code,
            resolutions: Memo::new(false),
            manifests: Memo::new(false),
            required_files: Default::default(),
            files_found_with_side_effects: Default::default(),
            configs: ConfigCaches::new(false),
        };
        Resolver {
            caches: std::sync::Arc::new(caches),
            code: Some(Box::new(state)),
            ..Self::with_tables(session, host, options, false)
        }
    }

    fn code_state(&self) -> &CodeState<'h> {
        self.code
            .as_deref()
            .expect("the code question needs `Resolver::for_compile`")
    }

    #[cfg(test)]
    fn file_required_in_place_of(&self, path: &[u8]) -> Option<&'h [u8]> {
        let required_files = self.code_state().required_files.lock();
        required_files.get(path).copied()
    }

    pub fn files_required_in_place_of_others(&self) -> Vec<(&'h [u8], &'h [u8])> {
        let required_files = self.code_state().required_files.lock();
        let entries = required_files.iter();
        entries
            .map(|(&imported, &required)| (imported, required))
            .collect()
    }

    pub fn is_found_with_side_effects(&self, path: &[u8]) -> bool {
        let files = self.code_state().files_found_with_side_effects.lock();
        files.contains(path)
    }

    fn code_options(&self) -> &'h CodeOptions {
        self.code_state().options
    }

    fn code_host(&self) -> &'h dyn CodeHost {
        self.code_state().host
    }

    fn config_caches(&self) -> &ConfigCaches<'h> {
        &self.code_state().configs
    }

    pub(super) fn read_manifest_text(&self, path: &[u8]) -> Option<Cow<'h, [u8]>> {
        let Some(texts) = &self.caches.manifest_texts else {
            return self.host.read(path);
        };
        if let Some(&known) = texts.get_ref(path) {
            return known.map(Cow::Borrowed);
        }
        let text = self.host.read(path).map(|text| self.keep(&text));
        let stored = *texts.insert_ref(self.keep(path), text);
        stored.map(Cow::Borrowed)
    }
}

pub fn is_typescript_file_name(path: &[u8]) -> bool {
    matches!(
        ScriptKind::from_file_name(path),
        Some(ScriptKind::Ts | ScriptKind::Tsx)
    )
}

fn get_first<'j>(json: &'j Json, key: &[u8]) -> Option<&'j Json> {
    let entry = json.as_object()?.iter().find(|entry| entry.0 == key)?;
    Some(&entry.1)
}
