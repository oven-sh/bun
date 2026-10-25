use super::{BoundBuild, LoadedBuild};
use crate::engine::FunctionReportRecord;
use crate::ir::Id;
use crate::ir::generated::ModuleRequestKind;
use crate::link::{ProgramModule, ProgramNames};
use crate::load::sources::parsed_source;
use crate::load::{EntryPointKind, ProgramFile, ProjectId, SourceKind, Sources};
use crate::module_list::{
    DataType, ImportTarget, ModuleFormat, ModuleImport, ModuleImportKind, ModuleInput, ModuleList,
};
use crate::modules::{Candidates, ModuleGraph, ModuleKind, ModuleRef, SiteAnswer};
use bun_ast::{Loader, Target};
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner};
use bun_sema::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};

pub(super) struct ListedModules {
    pub list: ModuleList,
    /// For each module of the program, the position in `list.inputs` of the file that holds its text.
    input_of_module: Vec<Option<u32>>,
}

struct Collector<'a, 's> {
    files: &'a Files<'s>,
    sources: &'a Sources,
    graph: &'a ModuleGraph,
    atoms: &'a Interner<'s>,
    aliases: Cfg,
    input_of_file: Vec<Option<u32>>,
}

pub(super) fn collect_module_list(
    loaded: &LoadedBuild<'_, '_>,
    bound: &BoundBuild<'_>,
    modules: &[ProgramModule],
    runs_tests: bool,
) -> ListedModules {
    let application = loaded.project(ProjectId::Application);
    let files = application.loaded.files();
    let sources = &application.sources;
    let listed_file = |module: &ProgramModule| match module.file()? {
        ProgramFile {
            project: ProjectId::Application,
            file,
        } if matches!(sources.kind(file), SourceKind::Program | SourceKind::Data) => Some(file),
        _ => None,
    };

    let mut input_of_file: Vec<Option<u32>> = vec![None; files.modules.len()];
    let mut listed_files: Vec<FileId> = Vec::new();
    for file in modules.iter().filter_map(listed_file) {
        let input = &mut input_of_file[file.idx()];
        if input.is_none() {
            *input = Some(listed_files.len() as u32);
            listed_files.push(file);
        }
    }
    let input_of_module = modules
        .iter()
        .map(|module| input_of_file[listed_file(module)?.idx()])
        .collect();

    let collector = Collector {
        files,
        sources,
        graph: &bound.projects.application.graph,
        atoms: &loaded.atoms,
        aliases: Cfg {
            rewrite_jest_for_tests: runs_tests,
        },
        input_of_file,
    };
    let mut entry_points = sources.entry_points().iter();
    let main = entry_points
        .find(|it| it.kind == EntryPointKind::Main)
        .map(|it| it.file);
    let list = ModuleList {
        inputs: listed_files
            .iter()
            .map(|&file| collector.describe(file))
            .collect(),
        entry_point: main.and_then(|file| collector.input_of_file[file.idx()]),
        exports: main.map_or_else(Vec::new, |file| collector.export_names(file)),
    };
    ListedModules {
        list,
        input_of_module,
    }
}

impl ListedModules {
    pub(super) fn count_code(&mut self, functions: &[FunctionReportRecord], names: &ProgramNames) {
        for record in functions {
            let module = record
                .source_id()
                .and_then(|function| names.function_module(function));
            let input = module.and_then(|module| *self.input_of_module.get(module.index())?);
            if let Some(input) = input {
                self.list.inputs[input as usize].code_byte_count += u64::from(record.code_bytes);
            }
        }
    }
}

impl Collector<'_, '_> {
    fn describe(&self, file: FileId) -> ModuleInput {
        let compiled = self.files.compiled(file);
        let sites = compiled.map_or(&[][..], |compiled| compiled.analysis.import_sites);
        let mut imports = Vec::new();
        for site in sites {
            self.add_imports(file, site, &mut imports);
        }
        self.add_requests_passed_on(file, &mut imports);
        ModuleInput {
            path: self.path(file),
            byte_count: self.sources.byte_count(file),
            format: self.format(file),
            imports,
            code_byte_count: 0,
        }
    }

    fn path(&self, file: FileId) -> Vec<u8> {
        let plugin_module =
            parsed_source(self.files, file).and_then(|source| source.plugin_module.as_ref());
        match plugin_module {
            Some(name) => [&name.namespace[..], b":", &name.path[..]].concat(),
            None => self.sources.module_paths(file).display_path.to_vec(),
        }
    }

    fn format(&self, file: FileId) -> Option<ModuleFormat> {
        match self.sources.loader(file) {
            Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx => {
                match self.graph.has_record(file).then(|| self.graph.kind(file))? {
                    ModuleKind::SourceText => Some(ModuleFormat::Esm),
                    ModuleKind::CommonJs => Some(ModuleFormat::Cjs),
                    _ => None,
                }
            }
            Loader::Json => Some(ModuleFormat::Json),
            Loader::Css => Some(ModuleFormat::Css),
            _ => None,
        }
    }

    fn export_names(&self, file: FileId) -> Vec<Vec<u8>> {
        if !self.graph.has_record(file) {
            return Vec::new();
        }
        let exports = self.graph.exports(file).iter();
        let mut names: Vec<Vec<u8>> = exports
            .map(|export| self.atoms.bytes(export.name).to_vec())
            .collect();
        names.sort_unstable();
        names.dedup();
        names
    }

    fn add_imports(&self, file: FileId, site: &ImportSite, imports: &mut Vec<ModuleImport>) {
        let Some(kind) = import_kind(site.kind) else {
            return;
        };
        let written = match site.specifier {
            ImportSpecifier::Constant(specifier) => Some(specifier),
            ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => None,
        };
        match self.graph.find_site_answer(file, site.kind) {
            Some(SiteAnswer::Module(module)) => {
                if let Some(written) = written {
                    imports.extend(self.import_of(kind, module, written));
                }
            }
            Some(SiteAnswer::Computed(Candidates::Modules(spelled))) => {
                imports.extend(
                    spelled
                        .iter()
                        .filter_map(|it| self.import_of(kind, it.module, it.spelling)),
                );
            }
            Some(SiteAnswer::Failed(_)) => {
                if let Some(written) = written {
                    let specifier = self.atoms.bytes(written);
                    imports.push(external_import(kind, specifier.to_vec(), specifier));
                }
            }
            Some(SiteAnswer::Computed(Candidates::All) | SiteAnswer::Erased) | None => {}
        }
    }

    /// A file that only hands on what others export is left out of the program, and whoever imports it asks for those others itself.
    fn add_requests_passed_on(&self, file: FileId, imports: &mut Vec<ModuleImport>) {
        if !self.graph.has_record(file) {
            return;
        }
        for request in self.graph.requests(file) {
            let kind = match request.kind {
                ModuleRequestKind::Import => ModuleImportKind::ImportStatement,
                ModuleRequestKind::Require => ModuleImportKind::RequireCall,
            };
            let Some(import) = self.import_of_file(kind, request.target, b"") else {
                continue;
            };
            if !imports.iter().any(|listed| listed.target == import.target) {
                imports.push(import);
            }
        }
    }

    /// As the bundler names a built-in module: without `node:`, but for a module that has no other name.
    fn builtin_path(&self, specifier: &[u8]) -> Vec<u8> {
        let alias = Alias::get(specifier, Target::Bun, self.aliases);
        match specifier.strip_prefix(b"node:") {
            Some(bare) if !alias.is_some_and(|alias| alias.node_only_prefix) => bare.to_vec(),
            _ => specifier.to_vec(),
        }
    }

    /// `None`: the program does not hold the module, so nothing loads it there.
    fn import_of(
        &self,
        kind: ModuleImportKind,
        module: ModuleRef,
        written: Atom,
    ) -> Option<ModuleImport> {
        let original = self.atoms.bytes(written);
        match module {
            ModuleRef::Runtime(_) => {
                Some(external_import(kind, self.builtin_path(original), original))
            }
            ModuleRef::External { specifier, .. } => {
                let path = self.atoms.bytes(specifier).to_vec();
                Some(external_import(kind, path, original))
            }
            _ => self.import_of_file(kind, module, original),
        }
    }

    fn import_of_file(
        &self,
        kind: ModuleImportKind,
        module: ModuleRef,
        original: &[u8],
    ) -> Option<ModuleImport> {
        let target = match module {
            ModuleRef::File(target)
            | ModuleRef::Inner { file: target, .. }
            | ModuleRef::Face(target)
            | ModuleRef::Check(target) => target,
            ModuleRef::Runtime(_) | ModuleRef::External { .. } => return None,
        };
        let loader = self.sources.loader(target);
        Some(ModuleImport {
            target: ImportTarget::Input(self.input_of_file[target.idx()]?),
            kind: match loader {
                Loader::Html => ModuleImportKind::HtmlManifest,
                _ => kind,
            },
            original: original.to_vec(),
            data_type: match loader {
                Loader::Json => Some(DataType::Json),
                Loader::Toml => Some(DataType::Toml),
                Loader::Text => Some(DataType::Text),
                _ => None,
            },
        })
    }
}

fn external_import(kind: ModuleImportKind, path: Vec<u8>, original: &[u8]) -> ModuleImport {
    ModuleImport {
        target: ImportTarget::External(path),
        kind,
        original: original.to_vec(),
        data_type: None,
    }
}

fn import_kind(site: ImportSiteKind) -> Option<ModuleImportKind> {
    Some(match site {
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => ModuleImportKind::ImportStatement,
        ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_) => ModuleImportKind::RequireCall,
        ImportSiteKind::ImportCall(_) => ModuleImportKind::DynamicImport,
        ImportSiteKind::RequireResolve(_) | ImportSiteKind::ImportMetaResolve(_) => {
            ModuleImportKind::RequireResolve
        }
        ImportSiteKind::GetBuiltinModule(_) => return None,
    })
}
