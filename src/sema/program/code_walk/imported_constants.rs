use super::*;
use crate::bind::{Binding, BindingInitializer, BindingKind};
use crate::fold::{Constant, FoldedValue};
use crate::hir::ExprFlags;
use crate::module_format::ModuleFormat;
use crate::resolve::{CodeResolution, SiteResolution};
use std::cell::RefCell;
use std::sync::Arc;

#[derive(Copy, Clone, PartialEq, Debug)]
enum Export {
    Unknown,
    NotLoaded,
    Missing,
    Ambiguous,
    Variable {
        file: u32,
        symbol: SymbolId,
        value: Option<Constant>,
    },
    Namespace(u32),
}

impl Export {
    fn is_same_binding(self, other: Export) -> bool {
        match (self, other) {
            (
                Export::Variable { file, symbol, .. },
                Export::Variable {
                    file: other_file,
                    symbol: other_symbol,
                    ..
                },
            ) => file == other_file && symbol == other_symbol,
            (Export::Namespace(file), Export::Namespace(other_file)) => file == other_file,
            _ => false,
        }
    }
}

#[derive(Default)]
pub(super) struct NamesLookedUp {
    parsed_since: Vec<u32>,
    mocking_since: Vec<u32>,
    with_shared_types_since: Vec<u32>,
    readers: Vec<(u32, u32)>,
    reader_count_without_repeats: usize,
    replacements: FxHashMap<u32, u32>,
    file_count_of_replacements: usize,
    mocked: FxHashSet<u32>,
    mocked_variables: FxHashSet<(u32, SymbolId)>,
    mocks_any_file: bool,
    forms_of_shared_types: FxHashMap<Vec<u8>, Vec<u32>>,
    forms_that_share_a_module: FxHashSet<u32>,
}

impl NamesLookedUp {
    pub(super) fn mocks_any_file(&self) -> bool {
        self.mocks_any_file
    }

    pub(super) fn note_parsed_file(&mut self, file: u32, parsed: &ParsedCodeFile<'_, '_>) {
        self.parsed_since.push(file);
        let mut sites = parsed.code.analyzed.analysis.import_sites.iter();
        if sites.any(|site| matches!(site.kind, ImportSiteKind::MockModule(_))) {
            self.mocking_since.push(file);
        }
        if parsed
            .code
            .targets
            .iter()
            .any(|it| it.has_type_of_shared_kind)
        {
            self.with_shared_types_since.push(file);
        }
    }

    fn drop_repeated_readers(&mut self) {
        if self.reader_count_without_repeats == 0 {
            self.reader_count_without_repeats = self.readers.len();
        } else if self.readers.len() > 2 * self.reader_count_without_repeats {
            self.readers.shared_sort_unstable();
            self.readers.dedup();
            self.reader_count_without_repeats = self.readers.len();
        }
    }
}

#[derive(Default)]
struct Stars {
    statements: Vec<(StmtId, bool)>,
    first_with_name: FxHashMap<Atom, u32>,
}

impl Stars {
    fn sees_every_name(&self) -> bool {
        self.statements.iter().all(|statement| !statement.1)
    }
}

struct Exports<'w, 's, 'r> {
    files: &'w [WalkedFile<'s, 'r>],
    replacements: &'w FxHashMap<u32, u32>,
    mocked: &'w FxHashSet<u32>,
    mocked_variables: &'w FxHashSet<(u32, SymbolId)>,
    mocks_any_file: bool,
    forms_that_share_a_module: &'w FxHashSet<u32>,
    resolved: FxHashMap<(u32, Atom), Option<Export>>,
    stars: &'w [OnceLock<Arc<Stars>>],
    files_with_stars_in_progress: Vec<u32>,
    first_targets_of_sites: RefCell<FxHashMap<u32, Vec<u32>>>,
    files_read: Vec<u32>,
}

impl<'w, 's, 'r> Exports<'w, 's, 'r> {
    fn new(
        files: &'w [WalkedFile<'s, 'r>],
        looked_up: &'w NamesLookedUp,
        stars: &'w [OnceLock<Arc<Stars>>],
    ) -> Self {
        Exports {
            files,
            replacements: &looked_up.replacements,
            mocked: &looked_up.mocked,
            mocked_variables: &looked_up.mocked_variables,
            mocks_any_file: looked_up.mocks_any_file,
            forms_that_share_a_module: &looked_up.forms_that_share_a_module,
            resolved: FxHashMap::default(),
            stars,
            files_with_stars_in_progress: Vec::new(),
            first_targets_of_sites: RefCell::default(),
            files_read: Vec::new(),
        }
    }
}

impl<'s> Exports<'_, 's, '_> {
    fn loaded_target(&self, target: u32) -> Option<u32> {
        (target != NOT_LOADED).then(|| *self.replacements.get(&target).unwrap_or(&target))
    }

    fn target_of_site(&self, file: u32, site: ImportSiteKind) -> Result<u32, Export> {
        let walked = &self.files[file as usize];
        let code = walked.parsed.as_ref().map(|it| &it.code);
        let code = code.ok_or(Export::Unknown)?;
        let site = code.analyzed.analysis.import_site_index(site);
        let site = site.ok_or(Export::Unknown)?;
        let SiteResolution::Constant(CodeResolution::File(_)) = code.resolutions[site] else {
            return Err(Export::Unknown);
        };
        let mut first_targets = self.first_targets_of_sites.borrow_mut();
        let first_targets = first_targets.entry(file).or_insert_with(|| {
            let counts = code
                .resolutions
                .iter()
                .map(|&it| files_of(it).count() as u32);
            let sum = |next: &mut u32, count: u32| Some(std::mem::replace(next, *next + count));
            counts.scan(0, sum).collect()
        });
        let target = walked.targets[first_targets[site] as usize];
        self.loaded_target(target).ok_or(Export::NotLoaded)
    }

    fn resolve_in_target(&mut self, file: u32, site: ImportSiteKind, name: Atom) -> Export {
        match self.target_of_site(file, site) {
            Ok(target) => self.resolve(target, name),
            Err(unresolved) => unresolved,
        }
    }

    fn namespace_of_target(&self, file: u32, site: ImportSiteKind) -> Export {
        match self.target_of_site(file, site) {
            Ok(target) => Export::Namespace(target),
            Err(unresolved) => unresolved,
        }
    }

    fn resolve_variable(&mut self, file: u32, symbol: SymbolId) -> Export {
        let files = self.files;
        let Some(parsed) = &files[file as usize].parsed else {
            return Export::Unknown;
        };
        let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
        if bound.binding_kind(symbol) == BindingKind::Import {
            let mut declarations = bound.symbol(symbol).decls.iter();
            return match declarations.find(|it| !is_type_declaration(**it)) {
                Some(&Decl::ImportSpec(spec)) if !hir[spec].type_only => {
                    let site = ImportSiteKind::Import(hir[spec].import);
                    self.resolve_in_target(file, site, hir[spec].imported)
                }
                Some(&Decl::ImportDefault(import)) => {
                    self.resolve_in_target(file, ImportSiteKind::Import(import), known::default)
                }
                Some(&Decl::ImportNamespace(import)) if !hir[import].is_deferred => {
                    self.namespace_of_target(file, ImportSiteKind::Import(import))
                }
                _ => Export::Unknown,
            };
        }
        let is_constant =
            bound.binding_kind(symbol) == BindingKind::Const && bound.is_stable_binding(symbol);
        let value = match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(initializer) if is_constant => {
                value_of(parsed, initializer)
            }
            _ => None,
        };
        Export::Variable {
            file,
            symbol,
            value,
        }
    }

    fn resolve_own(&mut self, file: u32, export: SymbolId) -> Export {
        let files = self.files;
        let Some(parsed) = &files[file as usize].parsed else {
            return Export::Unknown;
        };
        let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
        let declarations = bound.symbol(export).decls.iter();
        let mut values = declarations.filter(|it| !is_type_declaration(**it));
        let (Some(&declaration), None) = (values.next(), values.next()) else {
            return Export::Unknown;
        };
        match declaration {
            Decl::Var(_) | Decl::Fn(_) | Decl::Class(_) => {
                self.resolve_variable(file, bound.declared_symbol(declaration))
            }
            Decl::ExportSpec(spec) => {
                let item = hir[spec];
                let statement = hir[item.export];
                if item.type_only || statement.type_only {
                    return Export::Unknown;
                }
                if statement.has_module_specifier {
                    let site = ImportSiteKind::ExportFrom(item.export);
                    return self.resolve_in_target(file, site, item.local);
                }
                match bound.exported_binding(spec) {
                    Binding::Symbol(local) => self.resolve_variable(file, local),
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => Export::Unknown,
                }
            }
            Decl::ExportStarAs(statement) => {
                self.namespace_of_target(file, ImportSiteKind::ExportStar(statement))
            }
            Decl::ExportExpr(statement) => match hir[statement].kind {
                StmtKind::ExportDefault(value) if bound.exports_value(statement) => {
                    Export::Variable {
                        file,
                        symbol: export,
                        value: value_of(parsed, value),
                    }
                }
                _ => Export::Unknown,
            },
            _ => Export::Unknown,
        }
    }

    fn stars_of_file_with_known_names(&mut self, file: u32) -> Option<Arc<Stars>> {
        let parsed = self.files[file as usize].parsed.as_ref()?;
        let is_module = parsed.code.analyzed.analysis.module_format == ModuleFormat::Esm;
        if !is_module || parsed.parse.hir.has_errors {
            return None;
        }
        self.stars_of(file).filter(|stars| stars.sees_every_name())
    }

    fn names_found_in(&mut self, mut file: u32) -> Option<Vec<Atom>> {
        let files = self.files;
        let mut names = Vec::new();
        loop {
            let stars = self.stars_of_file_with_known_names(file)?;
            let bound = &files[file as usize].parsed.as_ref()?.parse.bound;
            let own = bound.table(bound.symbol(bound.file_symbol).exports);
            names.extend(own.iter().map(|entry| entry.0));
            let [(only, _)] = stars.statements[..] else {
                names.extend(stars.first_with_name.keys().copied());
                return Some(names);
            };
            file = self
                .target_of_site(file, ImportSiteKind::ExportStar(only))
                .ok()?;
        }
    }

    fn stars_of(&mut self, file: u32) -> Option<Arc<Stars>> {
        if let Some(known) = self.stars[file as usize].get() {
            return Some(Arc::clone(known));
        }
        if self.files_with_stars_in_progress.contains(&file) {
            return None;
        }
        let files = self.files;
        let Some(parsed) = &files[file as usize].parsed else {
            return Some(Arc::default());
        };
        self.files_with_stars_in_progress.push(file);
        let hir = &parsed.parse.hir;
        let mut stars = Stars::default();
        let passes_names_on = |statement: &StmtId| matches!(hir[*statement].kind, StmtKind::ExportStar { alias, type_only: false, .. } if alias.is_none());
        let statements: Vec<StmtId> = hir.ids(hir.body).filter(passes_names_on).collect();
        for (index, &statement) in (0..).zip(&statements) {
            let target = self.target_of_site(file, ImportSiteKind::ExportStar(statement));
            if statements.len() == 1 {
                let behind = target
                    .ok()
                    .and_then(|it| self.stars_of_file_with_known_names(it));
                stars.statements.push((statement, behind.is_none()));
                break;
            }
            let names = target.ok().and_then(|target| self.names_found_in(target));
            stars.statements.push((statement, names.is_none()));
            for name in names.unwrap_or_default() {
                let first = stars.first_with_name.entry(name).or_insert(index * 2);
                if *first / 2 != index {
                    *first |= 1;
                }
            }
        }
        self.files_with_stars_in_progress.pop();
        let stars = self.stars[file as usize].get_or_init(|| Arc::new(stars));
        Some(Arc::clone(stars))
    }

    fn resolve_through_stars(&mut self, file: u32, name: Atom) -> Export {
        if self.files[file as usize].parsed.is_none() {
            return Export::Unknown;
        }
        let Some(stars) = self.stars_of(file) else {
            return Export::Unknown;
        };
        let first_with_name = stars.first_with_name.get(&name).copied();
        let mut found = Export::Missing;
        for (index, &(statement, has_any_name)) in (0..).zip(&stars.statements) {
            let has_name = first_with_name
                .is_some_and(|first| index == first / 2 || first % 2 == 1 && index > first / 2);
            if !has_any_name && !has_name && stars.statements.len() != 1 {
                continue;
            }
            let site = ImportSiteKind::ExportStar(statement);
            match self.resolve_in_target(file, site, name) {
                Export::Missing => {}
                passed_on @ (Export::Unknown | Export::NotLoaded | Export::Ambiguous) => {
                    return passed_on;
                }
                passed_on if found == Export::Missing => found = passed_on,
                passed_on if found.is_same_binding(passed_on) => {}
                _ => return Export::Ambiguous,
            }
        }
        found
    }

    fn resolve(&mut self, file: u32, name: Atom) -> Export {
        match self.resolved.get(&(file, name)) {
            Some(&Some(export)) => return export,
            Some(None) => return Export::Unknown,
            None => {}
        }
        self.resolved.insert((file, name), None);
        let export = self.resolve_anew(file, name);
        self.resolved.insert((file, name), Some(export));
        export
    }

    fn resolve_anew(&mut self, file: u32, name: Atom) -> Export {
        let files = self.files;
        let Some(parsed) = &files[file as usize].parsed else {
            return Export::Unknown;
        };
        let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
        let is_module = parsed.code.analyzed.analysis.module_format == ModuleFormat::Esm;
        if !is_module || hir.has_errors {
            return Export::Unknown;
        }
        let exports = bound.symbol(bound.file_symbol).exports;
        match bound.lookup(exports, name) {
            Some(export) => self.resolve_own(file, export),
            None if name == known::default => Export::Missing,
            None => self.resolve_through_stars(file, name),
        }
    }

    fn is_mocked(&self, file: u32, symbol: SymbolId) -> bool {
        self.mocks_any_file
            || self.mocked.contains(&file)
            || self.mocked_variables.contains(&(file, symbol))
    }

    fn find_variables_exported_again(&mut self, file: u32) -> Option<Vec<(u32, SymbolId)>> {
        let parsed = self.files[file as usize].parsed.as_ref();
        let format = parsed.map(|it| it.code.analyzed.analysis.module_format);
        if format != Some(ModuleFormat::Esm) {
            return Some(Vec::new());
        }
        let names = self.names_found_in(file)?;
        let exports = names.into_iter().map(|name| self.resolve(file, name));
        Some(
            exports
                .filter_map(|export| match export {
                    Export::Variable {
                        file: origin,
                        symbol,
                        ..
                    } if origin != file => Some((origin, symbol)),
                    _ => None,
                })
                .collect(),
        )
    }

    fn find_constant(&mut self, file: u32, name: ImportedName) -> Option<ImportedConstant> {
        let site = ImportSiteKind::Import(name.import);
        let holder = match name.export.is_some() {
            true => self.resolve_in_target(file, site, name.export),
            false => self.namespace_of_target(file, site),
        };
        let read = match (holder, name.member.is_some()) {
            (Export::Namespace(namespace), true) => self.resolve(namespace, name.member),
            (Export::NotLoaded, true) => Export::NotLoaded,
            (_, true) => return None,
            (holder, false) => holder,
        };
        if let Export::Variable { file: read, .. } = read {
            self.files_read.push(read);
        }
        let value = match read {
            Export::Variable { file, symbol, .. } if self.is_mocked(file, symbol) => return None,
            Export::Variable { file, .. } if self.forms_that_share_a_module.contains(&file) => {
                return None;
            }
            Export::Variable {
                value: Some(value), ..
            } => value,
            Export::NotLoaded => {
                let mut known = self.files[file as usize].imported_constants.iter();
                return known.find(|constant| constant.name == name).copied();
            }
            Export::Missing
            | Export::Ambiguous
            | Export::Variable { value: None, .. }
            | Export::Namespace(_)
            | Export::Unknown => return None,
        };
        Some(ImportedConstant { name, value })
    }
}

fn is_type_declaration(declaration: Decl) -> bool {
    matches!(declaration, Decl::Interface(_) | Decl::Alias(_))
}

fn value_of(parsed: &ParsedCodeFile<'_, '_>, e: ExprId) -> Option<Constant> {
    let hir = &parsed.parse.hir;
    if hir.expr_flags(e).contains(ExprFlags::RESOLVED_AT_RUNTIME) {
        return None;
    }
    let decisions = &parsed.code.analyzed.analysis.decisions;
    match decisions.constant(hir, e) {
        FoldedValue::Constant(value) | FoldedValue::ConstantOutsideDeadZone(value) => Some(value),
        FoldedValue::Unknown => None,
    }
}

fn is_same_value(value: Constant, other: Constant) -> bool {
    match (value, other) {
        (Constant::Number(number), Constant::Number(other)) => number.to_bits() == other.to_bits(),
        _ => value == other,
    }
}

fn are_same(constants: &[ImportedConstant], others: &[ImportedConstant]) -> bool {
    constants.len() == others.len()
        && constants.iter().zip(others).all(|(constant, other)| {
            constant.name == other.name && is_same_value(constant.value, other.value)
        })
}

fn imported_names<'w>(file: &'w WalkedFile<'_, '_>) -> &'w [ImportedName] {
    let analysis = file.parsed.as_ref().map(|it| &it.code.analyzed.analysis);
    match analysis {
        Some(analysis) if analysis.module_format == ModuleFormat::Esm => analysis.imported_names,
        Some(_) | None => &[],
    }
}

fn mocks_unknown_path(file: &WalkedFile<'_, '_>) -> bool {
    let Some(code) = file.parsed.as_ref().map(|it| &it.code) else {
        return false;
    };
    let sites = code.analyzed.analysis.import_sites.iter();
    let mut sites = sites.zip(code.resolutions.iter());
    sites.any(|(site, resolution)| {
        matches!(site.kind, ImportSiteKind::MockModule(_))
            && matches!(resolution, SiteResolution::Computed(_))
    })
}

fn find_mocked_files(exports: &Exports<'_, '_, '_>, files: &[u32]) -> Vec<u32> {
    let mut mocked = Vec::new();
    for &file in files {
        let parsed = exports.files[file as usize].parsed.as_ref();
        let sites = parsed.map_or(&[][..], |it| it.code.analyzed.analysis.import_sites);
        let mocks = sites.iter().map(|site| site.kind);
        let mocks = mocks.filter(|kind| matches!(kind, ImportSiteKind::MockModule(_)));
        mocked.extend(mocks.filter_map(|kind| exports.target_of_site(file, kind).ok()));
    }
    mocked
}

fn find_forms_of_mocked_files(
    files: &[WalkedFile<'_, '_>],
    mocked_before: &FxHashSet<u32>,
    mocked: &[u32],
    parsed: &[u32],
) -> Vec<u32> {
    let path_of = |file: u32| files[file as usize].target.key.path;
    let is_form = |&file: &u32| files[file as usize].target.has_loader_attribute;
    let mut forms = Vec::new();
    if !mocked.is_empty() {
        let all_forms = (0..files.len() as u32).filter(is_form);
        forms.extend(
            all_forms.filter(|&form| mocked.iter().any(|&it| path_of(it) == path_of(form))),
        );
    }
    if !mocked_before.is_empty() {
        let parsed_forms = parsed.iter().copied().filter(is_form);
        forms.extend(
            parsed_forms
                .filter(|&form| mocked_before.iter().any(|&it| path_of(it) == path_of(form))),
        );
    }
    forms
}

fn find_forms_that_share_a_module(
    files: &[WalkedFile<'_, '_>],
    looked_up: &mut NamesLookedUp,
    parsed: &[u32],
) -> Vec<u32> {
    let NamesLookedUp {
        forms_of_shared_types,
        forms_that_share_a_module,
        ..
    } = looked_up;
    let mut found = Vec::new();
    for &importer in parsed {
        let importer = &files[importer as usize];
        for (target, &form) in importer.code_targets().iter().zip(&importer.targets) {
            if !target.has_type_of_shared_kind || form == NOT_LOADED {
                continue;
            }
            let forms = match forms_of_shared_types.get_mut(target.key.path) {
                Some(forms) => forms,
                None => forms_of_shared_types
                    .entry(target.key.path.to_vec())
                    .or_default(),
            };
            if forms.contains(&form) {
                continue;
            }
            forms.push(form);
            if forms.len() > 1 {
                let forms = forms.iter().copied();
                found.extend(forms.filter(|&it| forms_that_share_a_module.insert(it)));
            }
        }
    }
    found
}

fn find_files_stored_by_mocks<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    files: &[WalkedFile<'s, '_>],
    mocks_every_file: bool,
    mocked: &[u32],
    mut variables: Vec<(u32, SymbolId)>,
) -> Vec<(u32, StoredByMocks<'s>)> {
    let has_every_export =
        |file: &u32| files[*file as usize].stored_by_mocks == StoredByMocks::EveryExport;
    let mut whole: Vec<u32> = match mocks_every_file {
        true => (0..files.len() as u32).collect(),
        false => mocked.to_vec(),
    };
    whole.retain(|file| !has_every_export(file));
    variables.retain(|(file, _)| !has_every_export(file) && !whole.contains(file));
    variables.sort_unstable();
    let whole = whole.into_iter();
    let mut found: Vec<_> = whole.map(|it| (it, StoredByMocks::EveryExport)).collect();
    for of_file in variables.chunk_by(|variable, next| variable.0 == next.0) {
        let file = of_file[0].0;
        let known = match files[file as usize].stored_by_mocks {
            StoredByMocks::Variables(known) => known,
            StoredByMocks::Nothing | StoredByMocks::EveryExport => &[],
        };
        let mut all: Vec<SymbolId> = known.to_vec();
        all.extend(of_file.iter().map(|variable| variable.1));
        all.sort_unstable();
        all.dedup();
        let all = slice_in(&all, context.session.arena());
        found.push((file, StoredByMocks::Variables(all)));
    }
    found
}

const MOST_FOLDINGS_OF_ONE_FILE: u32 = 64;

const FILES_OF_ONE_SHARE: usize = 128;

pub(super) fn fold_files_that_import_constants_again<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    state: &mut WalkState<'s, 'r>,
) -> bool {
    let mut looked_up = std::mem::take(&mut state.names_looked_up);
    looked_up.mocks_any_file |= context.inputs.code.mocks_any_file;
    let mut parsed = std::mem::take(&mut looked_up.parsed_since);
    let mocking = std::mem::take(&mut looked_up.mocking_since);
    let with_shared_types = std::mem::take(&mut looked_up.with_shared_types_since);
    let parsed_count = parsed.len();
    let forms = find_forms_that_share_a_module(&state.files, &mut looked_up, &with_shared_types);
    parsed.extend(forms);
    let mut asks_every_file = false;
    if looked_up.file_count_of_replacements != state.files.len() {
        let replacements = find_files_required_in_place_of_others(context, state);
        asks_every_file = replacements != looked_up.replacements;
        looked_up.replacements = replacements;
        looked_up.file_count_of_replacements = state.files.len();
    }
    let stars: Vec<OnceLock<Arc<Stars>>> = state.files.iter().map(|_| OnceLock::new()).collect();
    let may_mock: Vec<u32> = (mocking.iter().chain(&parsed[parsed_count..]))
        .copied()
        .collect();
    let mocked = find_mocked_files(&Exports::new(&state.files, &looked_up, &stars), &may_mock);
    let forms = find_forms_of_mocked_files(&state.files, &looked_up.mocked, &mocked, &parsed);
    let mocked = mocked.into_iter().chain(forms);
    let newly_mocked: Vec<u32> = mocked.filter(|&it| looked_up.mocked.insert(it)).collect();
    parsed.extend(&newly_mocked);
    let mut exports = Exports::new(&state.files, &looked_up, &stars);
    let mut mocked: Vec<u32> = looked_up.mocked.iter().copied().collect();
    mocked.shared_sort_unstable();
    let exported_again: Vec<_> = mocked
        .into_iter()
        .map(|file| exports.find_variables_exported_again(file))
        .collect();
    drop(exports);
    let sees_every_name = exported_again.iter().all(Option::is_some);
    let mut newly_mocked_variables = Vec::new();
    for variable in exported_again.into_iter().flatten().flatten() {
        if looked_up.mocked_variables.insert(variable) {
            parsed.push(variable.0);
            newly_mocked_variables.push(variable);
        }
    }
    let may_mock = mocking.iter().chain(&parsed[parsed_count..]);
    let mut files = may_mock.map(|&it| &state.files[it as usize]);
    let mut mocks_every_file_from_now = false;
    if !looked_up.mocks_any_file && (!sees_every_name || files.any(mocks_unknown_path)) {
        looked_up.mocks_any_file = true;
        asks_every_file = true;
        mocks_every_file_from_now = true;
    }
    let stored_by_mocks = find_files_stored_by_mocks(
        context,
        &state.files,
        mocks_every_file_from_now,
        &newly_mocked,
        newly_mocked_variables,
    );
    let mut asked: Vec<u32> = match asks_every_file {
        true => (0..state.files.len() as u32).collect(),
        false => {
            let mut is_parsed = vec![false; state.files.len()];
            for &file in &parsed {
                is_parsed[file as usize] = true;
            }
            let readers = looked_up.readers.iter();
            let readers = readers.filter(|pair| is_parsed[pair.0 as usize]);
            let readers = readers.map(|pair| pair.1);
            readers.chain(parsed.iter().copied()).collect()
        }
    };
    asked.shared_sort_unstable();
    asked.dedup();
    let look_up = |share: &[u32]| {
        let mut exports = Exports::new(&state.files, &looked_up, &stars);
        let mut importers: Vec<(u32, Vec<ImportedConstant>)> = Vec::new();
        let mut reads: Vec<(u32, u32)> = Vec::new();
        for &index in share {
            let file = &state.files[index as usize];
            let names = imported_names(file).iter();
            let names = names.filter(|_| file.foldings_with_constants < MOST_FOLDINGS_OF_ONE_FILE);
            let found: Vec<ImportedConstant> = names
                .filter_map(|&name| exports.find_constant(index, name))
                .collect();
            exports.files_read.shared_sort_unstable();
            exports.files_read.dedup();
            reads.extend(exports.files_read.drain(..).map(|read| (read, index)));
            if !are_same(&found, &file.imported_constants) {
                importers.push((index, found));
            }
        }
        (importers, reads)
    };
    let shares: Vec<&[u32]> = asked.chunks(FILES_OF_ONE_SHARE).collect();
    let answers: Vec<Guarded<_>> = shares.iter().map(|_| Guarded::new(None)).collect();
    context.host.parallel(shares.len(), &|share| {
        *answers[share].lock() = Some(look_up(shares[share]));
    });
    let mut importers: Vec<(u32, Vec<ImportedConstant>)> = Vec::new();
    for mut answer in answers {
        let answer = answer.get_mut().take();
        let (importers_of_share, reads_of_share) = answer.expect("every share was looked up");
        importers.extend(importers_of_share);
        looked_up.readers.extend(reads_of_share);
    }
    looked_up.drop_repeated_readers();
    state.names_looked_up = looked_up;
    let mut folded_again: Vec<u32> = Vec::new();
    for (index, found) in importers {
        let file = &mut state.files[index as usize];
        file.imported_constants = found;
        file.foldings_with_constants += 1;
        folded_again.push(index);
    }
    for (index, stored) in stored_by_mocks {
        let file = &mut state.files[index as usize];
        file.stored_by_mocks = stored;
        if file.parsed.is_some() {
            folded_again.push(index);
        }
    }
    folded_again.shared_sort_unstable();
    folded_again.dedup();
    for &index in &folded_again {
        fold_parsed_file_again(state, index);
    }
    !folded_again.is_empty()
}
