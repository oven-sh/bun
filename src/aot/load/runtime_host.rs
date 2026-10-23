#[cfg(test)]
mod tests;

use std::borrow::Cow;

use bstr::BStr;
use bun_sema::atom::Interner;
use bun_sema::program::HostLoader;
use bun_sema::resolve::{
    CodeHost, CodeImportKind, CodeParseRequest, CodeRead, CodeRequest, ExternalKind, FinishedFile,
    Host, HostPayload, HostResolution, LoaderRequest, ModuleDetection, ParsedCode, ScriptKind,
};
use bun_sema::session::Arena;
use bun_sema_driver::host::{Disk, to_native};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use bun_threading::Guarded;

use crate::builtins::{BuiltinNames, Platforms};
use crate::diagnostics::LoadMessages;
use crate::load::builtin_uses::{self, BuiltinUseInput};
use crate::load::disk_delegation::{
    delegate_host_services_to_disk, delegate_runtime_config_parsers_to_disk,
};
use crate::load::is_host_path;
use crate::load::loaders::{BY_NAME, loader_by_name};
use crate::load::runtime_modules::{RuntimeFileKind, RuntimeModules, RuntimeResolution};
use crate::load::sources::{ParsedSource, SourceKind, parsed_source_mut};

pub(crate) struct RuntimeHostInput<'a> {
    pub disk: &'a Disk,
    pub runtime_modules: &'a RuntimeModules,
    pub builtin_names: &'a BuiltinNames,
    pub platform: Platforms,
    pub messages: &'a LoadMessages,
}

pub(crate) struct RuntimeHost<'a> {
    disk: &'a Disk,
    input: RuntimeHostInput<'a>,
    unreadable: Guarded<Vec<Vec<u8>>>,
}

impl<'a> RuntimeHost<'a> {
    pub(crate) fn new(input: RuntimeHostInput<'a>) -> RuntimeHost<'a> {
        RuntimeHost {
            disk: input.disk,
            input,
            unreadable: Guarded::new(Vec::new()),
        }
    }
}

impl RuntimeHost<'_> {
    fn record_unreadable(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.unreadable.lock().push(path.to_vec());
        Cow::default()
    }

    fn resolve_module(&self, specifier: &[u8], importer: &[u8]) -> HostResolution {
        let runtime_modules = self.input.runtime_modules;
        match runtime_modules.resolve_module(specifier, importer) {
            Some(RuntimeResolution::Module(id)) => runtime_modules.module_resolution(id),
            Some(RuntimeResolution::HostValue) => HostResolution::External {
                specifier: specifier.to_vec(),
                kind: ExternalKind::HostValue,
            },
            None => HostResolution::Unclaimed,
        }
    }

    fn source_kind(&self, path: &[u8]) -> SourceKind {
        match self.input.runtime_modules.file_kind(path) {
            Some(RuntimeFileKind::Module(module)) => SourceKind::RuntimeModule(module),
            Some(RuntimeFileKind::Functions) => SourceKind::RuntimeFunctions,
            Some(RuntimeFileKind::Declarations) => SourceKind::TypesOnly,
            Some(RuntimeFileKind::Configuration) | None => {
                let path = BStr::new(to_native(path));
                let message = format!("{path} was loaded as code");
                (self.input.messages).report_internal_error(message.into_bytes());
                SourceKind::TypesOnly
            }
        }
    }
}

impl Host for RuntimeHost<'_> {
    delegate_host_services_to_disk!(disk);

    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        match is_host_path(path) {
            true => self.input.runtime_modules.read(path),
            false => self.disk.read(path),
        }
    }

    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        if !is_host_path(path) {
            return self.disk.read_source(path);
        }
        let text = self.input.runtime_modules.read(path);
        text.unwrap_or_else(|| self.record_unreadable(path))
    }

    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        let mut paths = std::mem::take(&mut *self.unreadable.lock());
        paths.extend(self.disk.take_unreadable());
        paths
    }

    fn is_file(&self, path: &[u8]) -> bool {
        match is_host_path(path) {
            true => self.input.runtime_modules.file_kind(path).is_some(),
            false => self.disk.is_file(path),
        }
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        match is_host_path(path) {
            true => self.input.runtime_modules.is_directory(path),
            false => self.disk.is_dir(path),
        }
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match is_host_path(path) {
            true => path.to_vec(),
            false => self.disk.realpath(path),
        }
    }

    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let (mut names, directories) = self.entries(path);
        names.extend(directories);
        names
    }

    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        match is_host_path(path) {
            true => self.input.runtime_modules.entries(path).unwrap_or_default(),
            false => self.disk.entries(path),
        }
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }
}

impl CodeHost for RuntimeHost<'_> {
    delegate_runtime_config_parsers_to_disk!(disk);

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        match request.kind {
            CodeImportKind::EntryPoint => HostResolution::Unclaimed,
            CodeImportKind::Import | CodeImportKind::Require => {
                self.resolve_module(request.specifier, request.importer)
            }
        }
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        self.resolve_module(specifier, b"")
    }

    fn loader_of(&self, _request: &LoaderRequest<'_>) -> HostLoader {
        BY_NAME
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        CodeRead::Text(self.read_source(path))
    }

    fn hoists_top_level_variables(&self, path: &[u8]) -> bool {
        let kind = self.input.runtime_modules.file_kind(path);
        matches!(kind, Some(RuntimeFileKind::Module(_)))
    }

    fn is_library_file(&self, path: &[u8]) -> bool {
        match self.input.runtime_modules.file_kind(path) {
            Some(RuntimeFileKind::Functions) => true,
            Some(
                RuntimeFileKind::Module(_)
                | RuntimeFileKind::Declarations
                | RuntimeFileKind::Configuration,
            )
            | None => false,
        }
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        let path = request.path;
        let compile_options = CompileParseOptions {
            path,
            script_kind: None,
            experimental_decorators: request.options.experimental_decorators,
            every_file_is_a_module: request.options.module_detection == ModuleDetection::Force,
            reads_jsdoc: request.reads_jsdoc,
            keeps_function_directives: false,
        };
        let source = ParsedSource::new(self.source_kind(path), loader_by_name(path));
        ParsedCode {
            hir: parse_for_compile(arena, &compile_options, text, atoms),
            host_values: &[],
            payload: Some(Box::new(source)),
        }
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let input = BuiltinUseInput {
            names: self.input.builtin_names,
            platform: self.input.platform,
        };
        let source = parsed_source_mut(payload);
        builtin_uses::finish_runtime_file(&input, self.input.runtime_modules, request, source)
    }
}
