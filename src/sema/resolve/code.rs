use super::*;
use crate::import_sites::ImportSiteKind;
use crate::program::HostModuleId;

mod computed;
mod config;
mod exports;
mod files;
mod manifest;
mod options;
mod packages;
mod search;
mod typed_versions;

pub use self::config::{JsxRuntime, JsxSettings, TranspileSettings};
pub use self::options::{CodeOptions, ExtensionOrders};

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
            | ImportSiteKind::GetBuiltinModule(_) => CodeImportKind::Require,
            _ => CodeImportKind::Import,
        }
    }
}

/// How an import is written. It changes nothing about what is found: a host tells its plugins.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum CodeImportForm {
    Static,
    Dynamic,
    ResolveOnly,
    Macro,
}

impl CodeImportForm {
    pub fn from_site(kind: ImportSiteKind) -> CodeImportForm {
        match kind {
            ImportSiteKind::ImportCall(_) => CodeImportForm::Dynamic,
            ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaResolve(_) => {
                CodeImportForm::ResolveOnly
            }
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

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ExternalKind {
    UncompiledCode,
    HostValue,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypedVersionOrigin {
    Package,
    Host,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct TypedVersionFile<'h> {
    pub path: &'h [u8],
    pub origin: TypedVersionOrigin,
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
    IncompletePackageName,
    PackageImports,
    ConfigPaths,
    ExternalCandidate,
    TooManyCandidates,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ComputedCandidate<'h> {
    File(CodeFile<'h>),
    HostModule(HostModuleId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ComputedSpelling<'h> {
    pub text: &'h [u8],
    /// An index into the candidates.
    pub candidate: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ComputedResolution<'h> {
    Candidates {
        candidates: &'h [ComputedCandidate<'h>],
        /// Ascending by text, each text once. A candidate the host names has no spelling.
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

#[derive(Copy, Clone)]
struct CodeSearch<'a> {
    kind: CodeImportKind,
    extensions: &'a [Vec<u8>],
    uses_typed_condition: bool,
}

#[derive(PartialEq, Eq, Debug)]
enum SearchResult {
    File(Vec<u8>),
    Claimed(HostResolution),
    NotFound(CodeFailure),
}

pub(super) struct CodeState<'h> {
    host: &'h dyn CodeHost,
    options: &'h CodeOptions,
    resolutions: Memo<&'h [u8], CodeResolution<'h>>,
    manifests: Memo<&'h [u8], Option<&'h CodeManifest<'h>>>,
    typed_versions: Memo<&'h [u8], Option<TypedVersionFile<'h>>>,
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
            typed_versions: Memo::new(false),
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
