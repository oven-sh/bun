use std::sync::OnceLock;

use bun_ast::Target;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, Decl, FnOwner, Parent, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue, MadeByCall};
use bun_sema::hir::{
    BinOp, Branches, CallId, ExprId, ExprKind, File, FnId, FnKind, ImportId, PropKind, StmtKind,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, ends_in_call_that_reads_frame_of_caller,
    find_names_exported_for, find_parameter_named, find_values_of_parameter, find_written_arms,
    is_name_read_by_transpiler, is_name_written_out,
};
use bun_sema::program::{CodeAnswer, CodeView, FileId, Files};
use bun_sema::resolve::{
    CodeFailure, CodeResolution, ComputedResolution, ExternalKind, FinishedFile, SiteResolution,
};
use bun_sema::util::{FxHashMap, SharedSort};
use smallvec::{SmallVec, smallvec};

use super::entry_points::is_relative_path;
use super::scan::{ContentsScan, ScanInput};
use super::worker_entries::is_url_with_code;
use crate::builtins::{BuiltinId, KeyOfModuleCache, ResolvedBuiltins, RuntimeModule, table};
use crate::load::is_in_node_modules;
use crate::load::loader_aliases::{
    LoaderAlias, resolve_exported_loader_alias, resolve_loader_alias,
};
use crate::load::runtime_modules::RuntimeResolution;
use crate::load::sources::{parsed_source, parsed_source_in};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct NamedModule {
    pub argument: ExprId,
    pub name: Atom,
    pub module: RuntimeModule,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct LoadUnderParameter {
    pub property: Atom,
    pub place: u32,
    pub requires: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct TextPassedToProperty {
    pub property: Atom,
    pub place: u32,
    pub text: Atom,
}

#[derive(Default)]
pub(crate) struct NamedLoads {
    pub modules: Vec<NamedModule>,
    pub passed_to_imports: Vec<(SymbolId, NamedModule)>,
    pub imports_given_unknown_names: Vec<SymbolId>,
    through_imported_loaders: OnceLock<LoadsThroughImportedLoaders>,
    pub passed_for_parameters: Vec<RuntimeModule>,
    pub written_as_values: Vec<RuntimeModule>,
    pub loads_by_unknown_name: bool,
    pub loads_by_path_alone: bool,
    pub loads_by_unknown_path: bool,
    pub may_go_to_loader_of_host: bool,
    pub unknown_names_at: Vec<u32>,
    pub sought_from_unknown_folders: Vec<(Atom, bool)>,
    pub written_arms_of_unknown_names: Vec<(Atom, bool)>,
    pub files_missing_at_build_at: Vec<u32>,
    pub data_missing_at_build_at: Vec<u32>,
    pub under_parameters: Vec<LoadUnderParameter>,
    pub texts_passed_to_properties: Vec<TextPassedToProperty>,
}

struct LoadsThroughImportedLoaders {
    modules: Vec<NamedModule>,
    gives_unknown_name: bool,
}

impl NamedLoads {
    pub(crate) fn all_modules(&self) -> &[NamedModule] {
        match self.through_imported_loaders.get() {
            Some(found) => &found.modules,
            None => &self.modules,
        }
    }
}

pub(crate) fn names_plugin(files: &dyn CodeView<'_>) -> bool {
    let mut compiled = files.compiled_files().iter();
    compiled.any(|&file| {
        parsed_source_in(files, file).is_some_and(|source| source.builtins.names_plugin())
    })
}

pub(crate) fn mentions_plugin(files: &dyn CodeView<'_>) -> bool {
    let mut compiled = files.compiled_files().iter();
    compiled.any(|&file| {
        parsed_source_in(files, file).is_some_and(|source| {
            let mut mentioned = source.builtins.mentioned().iter();
            mentioned.any(|&id| table::is_plugin(id))
        })
    })
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum PathAlone {
    ByItsStart,
    ByTestOfWholePath,
}

const NAMES_OF_TEST_RUNNERS: [&[u8]; 2] = [b"@jest/globals", b"vitest"];

fn may_library_module_begin_with(start: &[u8]) -> bool {
    let names = BUN_ALIASES.iter().copied().flatten().map(|entry| entry.0);
    let mut names = names.chain(NAMES_OF_TEST_RUNNERS);
    names.any(|name| name.starts_with(start))
}

pub(crate) fn find_why_resolver_takes_name_for_path(
    analysis: &FileAnalysis<'_>,
    atoms: &Interner<'_>,
    name: ExprId,
) -> Option<PathAlone> {
    let decisions = &analysis.decisions;
    let made_by_call = decisions.find_what_call_made(name);
    match (made_by_call, decisions.specifier(name)) {
        (Some(MadeByCall::WholePath), _) => Some(PathAlone::ByTestOfWholePath),
        (Some(MadeByCall::Part), _) => None,
        (None, _) if decisions.is_path_from_own_directory(name) => Some(PathAlone::ByItsStart),
        (None, ImportSpecifier::Pattern { prefix, .. }) => {
            let start = atoms.bytes(prefix);
            let may_be_name =
                start.is_empty() || start.starts_with(b"#") || may_library_module_begin_with(start);
            (!may_be_name).then_some(PathAlone::ByItsStart)
        }
        (None, _) => None,
    }
}

fn answers_for_names_itself(builtins: &ResolvedBuiltins) -> bool {
    builtins.names_plugin() || builtins.stores_loader_functions()
}

pub(crate) fn does_some_file_answer_for_names(files: &Files<'_>) -> bool {
    let mut compiled = files.compiled_files().iter();
    compiled.any(|&file| {
        parsed_source(files, file).is_none_or(|it| answers_for_names_itself(&it.builtins))
    })
}

pub(crate) fn is_followed_further_than_bundler(
    files: &dyn CodeView<'_>,
    file: FileId,
    site: &ImportSite,
) -> bool {
    let loads = matches!(
        site.kind,
        ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
    );
    if !loads {
        return false;
    }
    let (hir, bound) = (files.hir(file), files.bound(file));
    let decisions = &files.analysis(file).decisions;
    !is_name_written_out(hir, site.specifier_node)
        || !is_name_read_by_transpiler(hir, bound, decisions, site.kind)
}

pub(crate) fn find_files_followed_further_than_bundler(files: &dyn CodeView<'_>) -> Vec<Vec<u8>> {
    let mut found: Vec<Vec<u8>> = Vec::new();
    if !names_plugin(files) {
        return found;
    }
    for &file in files.compiled_files() {
        let Some((answers, _)) = files.answers(file) else {
            continue;
        };
        for (site, answer) in files.analysis(file).import_sites.iter().zip(answers) {
            if !is_followed_further_than_bundler(files, file, site) {
                continue;
            }
            if let CodeAnswer::File(target) = *answer {
                found.push(files.file_name(target).to_vec());
            }
        }
    }
    found.shared_sort_unstable();
    found.dedup();
    found
}

pub(crate) fn modules_named_in(named: &[NamedModule], argument: ExprId) -> &[NamedModule] {
    let first = named.partition_point(|it| it.argument < argument);
    let count = named[first..].partition_point(|it| it.argument == argument);
    &named[first..first + count]
}

fn sort_modules(modules: &mut Vec<RuntimeModule>) {
    modules.shared_sort_unstable_by_key(|module| module.registry_id());
    modules.dedup();
}

fn sort_named_modules(named: &mut Vec<NamedModule>, atoms: &Interner<'_>) {
    let key = |it: &NamedModule| (it.argument, it.module.registry_id());
    named.shared_sort_unstable_by(|left, right| {
        let by_name = || atoms.bytes(left.name).cmp(atoms.bytes(right.name));
        key(left).cmp(&key(right)).then_with(by_name)
    });
    named.dedup();
}

pub(crate) fn find_library_modules_that_unknown_names_may_stand_for(
    application: &Files<'_>,
) -> Vec<RuntimeModule> {
    let mut modules: Vec<RuntimeModule> = Vec::new();
    let mut written: Vec<RuntimeModule> = Vec::new();
    let mut loads_by_unknown_name = false;
    let (mut loads_by_path_alone, mut is_answered_otherwise) = (false, false);
    for &file in application.compiled_files() {
        let source = parsed_source(application, file);
        loads_by_unknown_name = loads_by_unknown_name
            || source.is_none_or(|source| source.contents.names.loads_by_unknown_name)
            || resolve_loads_through_imported_loaders(application, file);
        let Some(source) = source else {
            continue;
        };
        loads_by_path_alone |= source.contents.names.loads_by_path_alone;
        is_answered_otherwise |= answers_for_names_itself(&source.builtins);
        modules.extend(&source.library_modules_named_in_text_left_to_run_time);
        modules.extend(&source.contents.names.passed_for_parameters);
        written.extend(&source.contents.names.written_as_values);
    }
    if loads_by_unknown_name || (loads_by_path_alone && is_answered_otherwise) {
        modules.append(&mut written);
    }
    sort_modules(&mut modules);
    modules
}

pub(crate) fn find_entry_that_require_looks_for(name: &[u8]) -> Option<(&[u8], RuntimeModule)> {
    let path = Alias::get(name, Target::Bun, Cfg::default())?
        .path
        .as_bytes();
    let key = match path.starts_with(b"node:") {
        true => name,
        false => path,
    };
    let module = table::module_by_specifier(path)?;
    (!key.starts_with(b"node:") && module != RuntimeModule::Bun).then_some((key, module))
}

pub(crate) fn find_module_looked_up_in_cache(name: &[u8]) -> Option<RuntimeModule> {
    find_entry_that_require_looks_for(name).map(|entry| entry.1)
}

pub(crate) fn find_library_modules_stored_in_cache(
    files: &Files<'_>,
    file: FileId,
) -> Vec<RuntimeModule> {
    let Some(source) = parsed_source(files, file) else {
        return Vec::new();
    };
    let analysis = files.analysis(file);
    let mut spelled: SmallVec<[Atom; 4]> = SmallVec::new();
    for &key in source.builtins.keys_taken_out_of_module_cache() {
        match key {
            KeyOfModuleCache::Text(text) => spelled.push(text),
            KeyOfModuleCache::Computed(key) => {
                let texts = analysis.find_key_stored_in_cache(key);
                let texts = texts.map_or(&[][..], |texts| analysis.alternatives_of(texts));
                spelled.extend(texts.iter().filter_map(|text| match *text {
                    ImportSpecifier::Constant(text) => Some(text),
                    _ => None,
                }));
            }
        }
    }
    let stored = spelled.into_iter().filter_map(|key| {
        let key = files.atoms.bytes(key);
        find_entry_that_require_looks_for(key).filter(|entry| entry.0 == key)
    });
    stored.map(|entry| entry.1).collect()
}

fn find_import_of(files: &Files<'_>, file: FileId, symbol: SymbolId) -> Option<(ImportId, Atom)> {
    let hir = files.hir(file);
    let mut declarations = files.bound(file).symbol(symbol).decls.iter();
    declarations.find_map(|&declaration| match declaration {
        Decl::ImportSpec(specifier) => {
            let specifier = hir[specifier];
            (!specifier.type_only).then_some((specifier.import, specifier.imported))
        }
        Decl::ImportDefault(import) => Some((import, known::default)),
        _ => None,
    })
}

fn imports_loader(files: &Files<'_>, mut file: FileId, mut symbol: SymbolId) -> bool {
    let mut followed: SmallVec<[(FileId, SymbolId); 4]> = SmallVec::new();
    while !followed.contains(&(file, symbol)) {
        followed.push((file, symbol));
        let Some((import, export_name)) = find_import_of(files, file, symbol) else {
            return false;
        };
        let kind = ImportSiteKind::Import(import);
        let site = files.analysis(file).import_site_index(kind);
        let answer = site.and_then(|site| files.compiled(file)?.code_answers.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return false;
        };
        if files.compiled(exporter).is_none() {
            return false;
        }
        let decisions = &files.analysis(exporter).decisions;
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        match resolve_exported_loader_alias(hir, bound, decisions, export_name) {
            Some(LoaderAlias::Local) => return true,
            Some(LoaderAlias::Import(next)) => (file, symbol) = (exporter, next),
            None => return false,
        }
    }
    false
}

pub(crate) fn resolve_loads_through_imported_loaders(files: &Files<'_>, file: FileId) -> bool {
    let Some(source) = parsed_source(files, file) else {
        return false;
    };
    let names = &source.contents.names;
    if names.passed_to_imports.is_empty() && names.imports_given_unknown_names.is_empty() {
        return false;
    }
    let found = names.through_imported_loaders.get_or_init(|| {
        let mut loaders: FxHashMap<SymbolId, bool> = FxHashMap::default();
        let mut is_loader = |callee: SymbolId| {
            let is_loader = loaders.entry(callee);
            *is_loader.or_insert_with(|| imports_loader(files, file, callee))
        };
        let mut modules = names.modules.clone();
        for &(callee, module) in &names.passed_to_imports {
            if is_loader(callee) {
                modules.push(module);
            }
        }
        sort_named_modules(&mut modules, &files.atoms);
        let mut given_unknown_names = names.imports_given_unknown_names.iter();
        LoadsThroughImportedLoaders {
            modules,
            gives_unknown_name: given_unknown_names.any(|&callee| is_loader(callee)),
        }
    });
    found.gives_unknown_name
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum LoadArgument {
    ModuleOrPath,
    LibraryModule,
}

fn load_argument_of(kind: ImportSiteKind) -> Option<LoadArgument> {
    match kind {
        ImportSiteKind::ImportCall(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_)
        | ImportSiteKind::ImportByTestRunner(_)
        | ImportSiteKind::RequireByTestRunner(_) => Some(LoadArgument::ModuleOrPath),
        ImportSiteKind::GetBuiltinModule(_) => Some(LoadArgument::LibraryModule),
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_)
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::MockModule(_) => None,
    }
}

fn find_module(input: &ScanInput<'_>, atoms: &Interner<'_>, name: Atom) -> Option<RuntimeModule> {
    match input.runtime_modules.resolve_module(atoms.bytes(name), b"") {
        Some(RuntimeResolution::Module(module)) => RuntimeModule::from_registry_id(module.0),
        Some(RuntimeResolution::HostValue) | None => None,
    }
}

fn is_path_that_program_may_write(importer: &[u8], specifier: &[u8]) -> bool {
    (specifier.starts_with(b"./") || specifier.starts_with(b"../") || specifier.starts_with(b"/"))
        && !is_in_node_modules(importer)
}

fn may_find_file_later(input: &ScanInput<'_>, site: &ImportSite) -> bool {
    match site.kind {
        ImportSiteKind::ImportCall(_)
        | ImportSiteKind::Require(_)
        | ImportSiteKind::ImportMetaRequire(_) => site.specifier_node.is_some(),
        ImportSiteKind::Import(_)
        | ImportSiteKind::ExportFrom(_)
        | ImportSiteKind::ExportStar(_) => input.runs_tests,
        ImportSiteKind::JsxRuntime
        | ImportSiteKind::JsxPackage
        | ImportSiteKind::ImportEquals(_)
        | ImportSiteKind::RequireResolve(_)
        | ImportSiteKind::ImportMetaResolve(_)
        | ImportSiteKind::GetBuiltinModule(_)
        | ImportSiteKind::MockModule(_)
        | ImportSiteKind::ImportByTestRunner(_)
        | ImportSiteKind::RequireByTestRunner(_) => false,
    }
}

fn names_file_missing_at_build(
    request: &FinishedFile<'_, '_>,
    input: &ScanInput<'_>,
    site: &ImportSite,
    resolution: SiteResolution<'_>,
) -> bool {
    let (analysis, atoms) = (request.analysis, request.atoms);
    if !may_find_file_later(input, site) {
        return false;
    }
    let may_be_written = |specifier: &ImportSpecifier| {
        matches!(*specifier, ImportSpecifier::Constant(text)
            if is_path_that_program_may_write(request.path, atoms.bytes(text))
                && !(input.is_data)(atoms.bytes(text)))
    };
    match resolution {
        SiteResolution::Constant(CodeResolution::External {
            specifier,
            kind: ExternalKind::UncompiledCode,
        }) => {
            bun_paths::is_absolute(specifier)
                && !bun_core::strings::contains_char(specifier, b'?')
                && !(input.is_data)(specifier)
                && !(input.is_file)(specifier)
        }
        SiteResolution::Constant(CodeResolution::NotFound(CodeFailure::ModuleNotFound)) => {
            may_be_written(&site.specifier)
        }
        SiteResolution::Computed(ComputedResolution::Candidates { spellings, .. }) => {
            let is_spelled = |specifier: &ImportSpecifier| {
                matches!(*specifier, ImportSpecifier::Constant(text)
                    if spellings.binary_search_by(|it| it.text.cmp(atoms.bytes(text))).is_ok())
            };
            let mut alternatives = analysis.alternatives_of(&site.specifier).iter();
            alternatives.any(|it| may_be_written(it) && !is_spelled(it))
        }
        SiteResolution::Constant(_) | SiteResolution::Computed(_) => false,
    }
}

fn names_data_missing_at_build(
    request: &FinishedFile<'_, '_>,
    input: &ScanInput<'_>,
    site: &ImportSite,
    resolution: SiteResolution<'_>,
) -> bool {
    let atoms = request.atoms;
    let not_found = CodeResolution::NotFound(CodeFailure::ModuleNotFound);
    resolution == SiteResolution::Constant(not_found)
        && may_find_file_later(input, site)
        && matches!(site.specifier, ImportSpecifier::Constant(text)
            if is_path_that_program_may_write(request.path, atoms.bytes(text))
                && (input.is_data)(atoms.bytes(text)))
}

fn constant_text(request: &FinishedFile<'_, '_>, expression: ExprId) -> Option<Atom> {
    match request.analysis.decisions.constant(request.hir, expression) {
        FoldedValue::Constant(Constant::String(text))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => Some(text),
        FoldedValue::Constant(_)
        | FoldedValue::ConstantOutsideDeadZone(_)
        | FoldedValue::Unknown => None,
    }
}

fn is_left_operand_of_sum(request: &FinishedFile<'_, '_>, expression: ExprId) -> bool {
    let Parent::Expr(above) = request.bound.parent_of_expr(expression) else {
        return false;
    };
    let kind = request.hir[above].kind;
    matches!(kind, ExprKind::Binary { op: BinOp::Add, left, .. } if left == expression)
}

pub(super) fn is_part_of_longer_text(request: &FinishedFile<'_, '_>, expression: ExprId) -> bool {
    let Parent::Expr(above) = request.bound.parent_of_expr(expression) else {
        return false;
    };
    matches!(
        request.hir[above].kind,
        ExprKind::Binary { op: BinOp::Add, .. } | ExprKind::Template { .. }
    )
}

pub(super) fn is_made_of_texts(request: &FinishedFile<'_, '_>, expression: ExprId) -> bool {
    match request.hir[expression].kind {
        ExprKind::String(_) | ExprKind::Template { .. } => true,
        ExprKind::Binary { op: BinOp::Add, .. } => constant_text(request, expression).is_some(),
        _ => false,
    }
}

fn find_whole_text(request: &FinishedFile<'_, '_>, part: ExprId, text: Atom) -> (ExprId, Atom) {
    let (hir, bound) = (request.hir, request.bound);
    let mut whole = (part, text);
    let mut reached = part;
    while let Parent::Expr(above) = bound.parent_of_expr(reached) {
        let last_made_of_texts = match hir[above].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => match is_made_of_texts(request, right) {
                true => Some(right),
                false => Some(left),
            },
            ExprKind::Template { exprs } => {
                hir.ids(exprs).rfind(|&it| is_made_of_texts(request, it))
            }
            _ => break,
        };
        if last_made_of_texts != Some(reached) {
            break;
        }
        match constant_text(request, above) {
            Some(text) => whole = (above, text),
            None if matches!(hir[above].kind, ExprKind::Binary { .. })
                && is_left_operand_of_sum(request, above) => {}
            None => break,
        }
        reached = above;
    }
    whole
}

fn is_fully_known_load_argument(
    analysis: &FileAnalysis<'_>,
    call: ExprId,
    argument: ExprId,
) -> bool {
    let Some(index) = analysis.import_site_of_call(call) else {
        return false;
    };
    let site = &analysis.import_sites[index];
    let is_constant = |it: &ImportSpecifier| matches!(it, ImportSpecifier::Constant(_));
    site.specifier_node == argument
        && !site.is_host_value
        && load_argument_of(site.kind).is_some()
        && (analysis.alternatives_of(&site.specifier).iter()).all(is_constant)
}

pub(super) fn is_written_as_value(request: &FinishedFile<'_, '_>, mut expression: ExprId) -> bool {
    let (hir, bound) = (request.hir, request.bound);
    loop {
        let above = match bound.parent_of_expr(expression) {
            Parent::Expr(above) => above,
            Parent::Stmt(statement) => {
                return matches!(
                    hir[statement].kind,
                    StmtKind::Return(_)
                        | StmtKind::Throw(_)
                        | StmtKind::ExportDefault(_)
                        | StmtKind::ExportAssign(_)
                );
            }
            Parent::VarInit(_)
            | Parent::ParamDefault(_)
            | Parent::PatPropDefault(_)
            | Parent::PatElemDefault(_)
            | Parent::Prop(_)
            | Parent::MemberInit(_)
            | Parent::FnBody(_)
            | Parent::EnumInit(_) => return true,
            Parent::None
            | Parent::File
            | Parent::PropKey(_)
            | Parent::PatKey(_)
            | Parent::MemberKey(_)
            | Parent::MethodKey(_)
            | Parent::Case(_)
            | Parent::ClassExtends(_)
            | Parent::ClassDecorator(_)
            | Parent::MemberDecorator(_)
            | Parent::ParamDecorator(_)
            | Parent::Module(_) => return false,
        };
        match hir[above].kind {
            ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_) => expression = above,
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                ..
            } if left == expression => return false,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                ..
            } => expression = above,
            ExprKind::Cond { test, .. } if test == expression => return false,
            ExprKind::Cond { .. } => expression = above,
            ExprKind::Unary { .. } => return false,
            ExprKind::Binary { op: BinOp::Add, .. } | ExprKind::Template { .. }
                if constant_text(request, above).is_none() =>
            {
                return true;
            }
            ExprKind::Binary { .. } | ExprKind::Template { .. } => return false,
            ExprKind::Index { index, .. } if index == expression => return false,
            ExprKind::Dot { obj, .. } if obj != expression => return false,
            ExprKind::Call(_) | ExprKind::ImportCall { .. }
                if is_fully_known_load_argument(request.analysis, above, expression) =>
            {
                return false;
            }
            _ => return true,
        }
    }
}

fn find_property_written_for(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<Atom> {
    let kind = hir.runtime_function_kind(function);
    let value = match (kind, bound.fns[function.idx()].owner) {
        (FnKind::Method, FnOwner::Member(member)) => return hir[member].key.name(),
        (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(value)) => value,
        _ => return None,
    };
    match bound.parent_of_expr(value) {
        Parent::Prop(property) if hir[property].kind != PropKind::Spread => {
            hir[property].key.name()
        }
        Parent::MemberInit(member) => hir[member].key.name(),
        Parent::Expr(above) => match hir[above].kind {
            ExprKind::Assign {
                op: None,
                target,
                value: assigned,
            } if assigned == value => match hir[hir.skip_type_assertions(target)].kind {
                ExprKind::Dot { name, .. } => Some(name),
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }
}

fn find_loads_under_parameter(
    request: &FinishedFile<'_, '_>,
    site: &ImportSite,
) -> SmallVec<[LoadUnderParameter; 2]> {
    let (hir, bound) = (request.hir, request.bound);
    let requires = matches!(
        site.kind,
        ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_)
    );
    let loads = requires || matches!(site.kind, ImportSiteKind::ImportCall(_));
    if !loads || site.specifier != ImportSpecifier::Unknown {
        return SmallVec::new();
    }
    let name = hir.skip_type_assertions(site.specifier_node);
    let Some((function, place)) = find_parameter_named(hir, bound, name) else {
        return SmallVec::new();
    };
    let find_written = |written: Atom| -> Vec<ExprId> {
        let all = (0..hir.exprs.len() as u32).map(ExprId);
        all.filter(|&it| matches!(hir[it].kind, ExprKind::Ident(name) if name == written))
            .collect()
    };
    let mut properties = find_names_exported_for(hir, bound, function, &find_written);
    if let Some(property) = find_property_written_for(hir, bound, function)
        && !properties.contains(&property)
    {
        properties.push(property);
    }
    let properties = properties.into_iter();
    properties
        .map(|property| LoadUnderParameter {
            property,
            place: place as u32,
            requires,
        })
        .collect()
}

fn find_property_called(hir: &File<'_>, bound: &Bound<'_>, callee: ExprId) -> Option<Atom> {
    let mut callee = hir.skip_type_assertions(callee);
    if let ExprKind::Binary {
        op: BinOp::Comma,
        right,
        ..
    } = hir[callee].kind
    {
        callee = hir.skip_type_assertions(right);
    }
    match (hir[callee].kind, bound.binding(callee)) {
        (ExprKind::Dot { name, .. }, _) => Some(name),
        (ExprKind::Ident(_), Binding::Symbol(symbol)) => {
            let mut declarations = bound.symbol(symbol).decls.iter();
            declarations.find_map(|&declaration| match declaration {
                Decl::ImportSpec(specifier) => Some(hir[specifier].imported),
                Decl::ImportDefault(_) => Some(known::default),
                _ => None,
            })
        }
        _ => None,
    }
}

fn add_names_in(
    scan: &mut ContentsScan<'_, '_>,
    argument: ExprId,
    follows_parameters: bool,
) -> bool {
    let (request, input) = (scan.request, scan.input);
    let (hir, bound, atoms) = (request.hir, request.bound, request.atoms);
    let decisions = &request.analysis.decisions;
    let names = &mut scan.found.names;
    let mut has_unknown_name = false;
    let mut followed: SmallVec<[SymbolId; 2]> = SmallVec::new();
    let mut pending: SmallVec<[(ExprId, bool); 4]> = smallvec![(argument, false)];
    while let Some((expression, is_passed)) = pending.pop() {
        let expression = hir.skip_type_assertions(expression);
        if decisions.is_dead_expr(expression) {
            continue;
        }
        match decisions.constant(hir, expression) {
            FoldedValue::Constant(Constant::String(name))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(name)) => {
                let module = find_module(input, atoms, name);
                if is_passed {
                    names.passed_for_parameters.extend(module);
                    continue;
                }
                names.modules.extend(module.map(|module| NamedModule {
                    argument,
                    name,
                    module,
                }));
            }
            FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => {}
            FoldedValue::Unknown => match (hir[expression].kind, bound.binding(expression)) {
                (ExprKind::Cond { branches, .. }, _) => {
                    let Branches { yes, no } = hir.branches(branches);
                    pending.extend([(yes, is_passed), (no, is_passed)]);
                }
                (ExprKind::Ident(_), Binding::Symbol(parameter))
                    if follows_parameters && followed.contains(&parameter) => {}
                (ExprKind::Ident(_), Binding::Symbol(parameter)) if follows_parameters => {
                    followed.push(parameter);
                    match find_values_of_parameter(hir, bound, decisions, expression) {
                        Some(values) => pending.extend(values.iter().map(|&it| (it, true))),
                        None => has_unknown_name = true,
                    }
                }
                _ => has_unknown_name = true,
            },
        }
    }
    has_unknown_name
}

fn find_name_sought_from_unknown_folder(
    request: &FinishedFile<'_, '_>,
    site: &ImportSite,
) -> Option<(Atom, bool)> {
    let (call, requires) = match site.kind {
        ImportSiteKind::ImportByTestRunner(call) => (call, false),
        ImportSiteKind::RequireByTestRunner(call) => (call, true),
        _ => return None,
    };
    let ImportSpecifier::Constant(name) = site.specifier else {
        return None;
    };
    let keeps_frame = ends_in_call_that_reads_frame_of_caller(request.hir, request.bound, call);
    (is_relative_path(request.atoms.bytes(name)) && !keeps_frame).then_some((name, requires))
}

impl ContentsScan<'_, '_> {
    pub(super) fn look_at_site(&mut self, index: usize) {
        let (request, input) = (self.request, self.input);
        let (analysis, atoms) = (request.analysis, request.atoms);
        let names = &mut self.found.names;
        let site = &analysis.import_sites[index];
        let call = site.kind.call();
        if call.is_some_and(|call| analysis.decisions.is_dead_expr(call)) {
            return;
        }
        names.may_go_to_loader_of_host |= !matches!(
            request.resolutions[index],
            SiteResolution::Constant(
                CodeResolution::File(_) | CodeResolution::HostModule(_) | CodeResolution::Erased
            )
        );
        if input.loads_code_from_disk {
            let resolution = request.resolutions[index];
            if names_file_missing_at_build(request, input, site, resolution) {
                names.files_missing_at_build_at.push(index as u32);
            }
            if names_data_missing_at_build(request, input, site, resolution) {
                names.data_missing_at_build_at.push(index as u32);
            }
        }
        let Some(argument_kind) = load_argument_of(site.kind) else {
            return;
        };
        if site.specifier_node.is_none() {
            return;
        }
        let is_choice = matches!(site.specifier, ImportSpecifier::OneOf(_));
        let mut is_known = true;
        let mut may_name_library_module = false;
        for &alternative in analysis.alternatives_of(&site.specifier) {
            match alternative {
                ImportSpecifier::Constant(name) => {
                    if is_choice && let Some(module) = find_module(input, atoms, name) {
                        names.modules.push(NamedModule {
                            argument: site.specifier_node,
                            name,
                            module,
                        });
                    }
                }
                ImportSpecifier::Pattern { prefix, suffix } => {
                    is_known = false;
                    let (prefix, suffix) = (atoms.bytes(prefix), atoms.bytes(suffix));
                    let fitting = input.runtime_modules.find_modules(prefix, suffix);
                    may_name_library_module |= !fitting.is_empty();
                }
                ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {
                    is_known = false;
                    may_name_library_module = true;
                }
            }
        }
        (names.sought_from_unknown_folders)
            .extend(find_name_sought_from_unknown_folder(request, site));
        if is_known {
            return;
        }
        let name = site.specifier_node;
        let is_path_alone = find_why_resolver_takes_name_for_path(analysis, atoms, name).is_some();
        names.unknown_names_at.push(index as u32);
        names.loads_by_unknown_name |= may_name_library_module && !is_path_alone;
        names.loads_by_path_alone |= is_path_alone;
        names.loads_by_unknown_path |= argument_kind == LoadArgument::ModuleOrPath;
        (names.under_parameters).extend(find_loads_under_parameter(request, site));
        let requires = !matches!(site.kind, ImportSiteKind::ImportCall(_));
        let arms = find_written_arms(request.hir, request.bound, &analysis.decisions, site);
        (names.written_arms_of_unknown_names).extend(arms.iter().map(|&arm| (arm, requires)));
    }

    fn look_at_texts_passed(&mut self, call: CallId) {
        let request = self.request;
        let (hir, bound) = (request.hir, request.bound);
        let Some(property) = find_property_called(hir, bound, hir[call].callee) else {
            return;
        };
        let is_spread = |it: &ExprId| matches!(hir[*it].kind, ExprKind::Spread(_));
        let arguments = hir.ids(hir[call].args).take_while(|it| !is_spread(it));
        for (place, argument) in arguments.enumerate() {
            let Some(text) = constant_text(request, hir.skip_type_assertions(argument)) else {
                continue;
            };
            let passed = &mut self.found.names.texts_passed_to_properties;
            passed.push(TextPassedToProperty {
                property,
                place: place as u32,
                text,
            });
        }
    }

    pub(super) fn look_at_call(&mut self, expression: ExprId, call: CallId) {
        let request = self.request;
        let (hir, bound, analysis) = (request.hir, request.bound, request.analysis);
        if bound.parent_of_expr(expression) == Parent::None
            || analysis.import_site_of_call(expression).is_some()
        {
            return;
        }
        self.look_at_texts_passed(call);
        let Some(argument) = hir.ids(hir[call].args).next() else {
            return;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        if self.builtins.builtin_of_expression(callee) == Some(BuiltinId::ProcessGetBuiltinModule) {
            let has_unknown_name = add_names_in(self, argument, true);
            self.found.names.loads_by_unknown_name |= has_unknown_name;
            return;
        }
        match resolve_loader_alias(hir, bound, &analysis.decisions, callee) {
            Some(LoaderAlias::Local) => {
                let has_unknown_name = add_names_in(self, argument, true);
                self.found.names.loads_by_unknown_name |= has_unknown_name;
                self.found.names.loads_by_unknown_path |= has_unknown_name;
            }
            Some(LoaderAlias::Import(symbol)) => {
                let first_new = self.found.names.modules.len();
                let has_unknown_name = add_names_in(self, argument, false);
                let names = &mut self.found.names;
                if has_unknown_name {
                    names.imports_given_unknown_names.push(symbol);
                }
                let named = names.modules.drain(first_new..);
                (names.passed_to_imports).extend(named.map(|module| (symbol, module)));
            }
            None => {}
        }
    }

    pub(super) fn look_at_text(&mut self, expression: ExprId, text: Atom) {
        let request = self.request;
        let (expression, text) = find_whole_text(request, expression, text);
        if is_url_with_code(request.atoms.bytes(text)) {
            if !is_part_of_longer_text(request, expression)
                && is_written_as_value(request, expression)
            {
                self.found.urls_with_code.push(text);
            }
            return;
        }
        self.look_at_relative_path(expression, text);
        let Some(module) = find_module(self.input, request.atoms, text) else {
            return;
        };
        let written = &mut self.found.names.written_as_values;
        if !written.contains(&module) && is_written_as_value(request, expression) {
            written.push(module);
        }
    }

    pub(super) fn look_at_text_in_data(&mut self, text: Atom) {
        let module = find_module(self.input, self.request.atoms, text);
        self.found.names.written_as_values.extend(module);
    }

    pub(super) fn finish_names(&mut self) {
        let (request, builtins, input) = (self.request, self.builtins, self.input);
        let atoms = request.atoms;
        let names = &mut self.found.names;
        names.loads_by_unknown_name |= builtins.loads_unknown_modules();
        names.loads_by_unknown_path |=
            builtins.hands_on_loader_of_paths() || !names.files_missing_at_build_at.is_empty();
        for &(name, _) in request.analysis.names_out_of_data_files {
            let module = find_module(input, atoms, name);
            names.written_as_values.extend(module);
        }
        sort_named_modules(&mut names.modules, atoms);
        sort_modules(&mut names.written_as_values);
        sort_modules(&mut names.passed_for_parameters);
        names.imports_given_unknown_names.shared_sort_unstable();
        names.imports_given_unknown_names.dedup();
        for sites in [
            &mut names.unknown_names_at,
            &mut names.files_missing_at_build_at,
            &mut names.data_missing_at_build_at,
        ] {
            sites.shared_sort_unstable();
            sites.dedup();
        }
    }
}
