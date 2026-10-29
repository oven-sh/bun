//! A `const` that a file exports holds one value from the moment it is initialized. Where folding the exporting file finds that value, the files that
//! import the name are folded with it, so a branch that it decides loads nothing. What such a file exports in turn may then be a constant too.

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
    /// The build does not follow the name to what it holds.
    Unknown,
    /// The way to the name leads through a file without side effects that nobody asks for anything.
    NotLoaded,
    Missing,
    /// Two `export *` of a file give the name two meanings, so nobody can import it and no namespace object has it.
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

/// What one look at the names leaves for the next, which asks only where an answer can have changed.
#[derive(Default)]
pub(super) struct NamesLookedUp {
    /// The files that were parsed or folded since.
    pub(super) parsed_since: Vec<u32>,
    /// For a file, the files that read a variable of it under a name.
    readers: FxHashMap<u32, Vec<u32>>,
    is_reader: FxHashSet<(u32, u32)>,
    replacements: FxHashMap<u32, u32>,
    file_count_of_replacements: usize,
}

/// The `export *` statements of a file that pass names on, and behind which of them a name can be found.
#[derive(Default)]
struct Stars {
    /// In their order, each with whether the build fails to see every name behind it.
    statements: Vec<(StmtId, bool)>,
    /// For a name that a file behind a statement exports, twice the index of the first such statement, and one more where a later one may have it too.
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
    resolved: FxHashMap<(u32, Atom), Option<Export>>,
    /// By file. Every thread computes the same value for a file.
    stars: &'w [OnceLock<Arc<Stars>>],
    files_with_stars_in_progress: Vec<u32>,
    first_targets_of_sites: RefCell<FxHashMap<u32, Vec<u32>>>,
    /// The files whose variables the names of the file in hand lead to.
    files_read: Vec<u32>,
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

    /// The names for which `resolve` finds something other than `Missing` in the file. `None`: any name may be one.
    fn names_found_in(&mut self, file: u32) -> Option<Vec<Atom>> {
        let files = self.files;
        let parsed = files[file as usize].parsed.as_ref()?;
        let (hir, bound) = (&parsed.parse.hir, &parsed.parse.bound);
        let is_module = parsed.code.analyzed.analysis.module_format == ModuleFormat::Esm;
        if !is_module || hir.has_errors {
            return None;
        }
        // In a circle of `export *` a name that nobody exports is unknown.
        let stars = self.stars_of(file)?;
        if !stars.sees_every_name() {
            return None;
        }
        let own = bound.table(bound.symbol(bound.file_symbol).exports);
        let own = own.iter().map(|entry| entry.0);
        Some(own.chain(stars.first_with_name.keys().copied()).collect())
    }

    /// `None`: the statements of the file are being looked at.
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
        for statement in hir.ids(hir.body) {
            let StmtKind::ExportStar {
                alias,
                type_only: false,
                ..
            } = hir[statement].kind
            else {
                continue;
            };
            if alias.is_some() {
                continue;
            }
            let index = stars.statements.len() as u32;
            let target = self.target_of_site(file, ImportSiteKind::ExportStar(statement));
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
        // Behind every other statement the name is missing.
        let Some(stars) = self.stars_of(file) else {
            return Export::Unknown;
        };
        let first_with_name = stars.first_with_name.get(&name).copied();
        let mut found = Export::Missing;
        for (index, &(statement, has_any_name)) in (0..).zip(&stars.statements) {
            let has_name = first_with_name
                .is_some_and(|first| index == first / 2 || first % 2 == 1 && index > first / 2);
            if !has_any_name && !has_name {
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

    /// `ResolveExport`
    fn resolve(&mut self, file: u32, name: Atom) -> Export {
        match self.resolved.get(&(file, name)) {
            Some(&Some(export)) => return export,
            // The name is passed round in a circle.
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
            Export::Variable {
                value: Some(value), ..
            } => value,
            // Nobody asks because what the value decides left no other read.
            Export::NotLoaded => {
                let mut known = self.files[file as usize].imported_constants.iter();
                return known.find(|constant| constant.name == name).copied();
            }
            // What a namespace object answers for a name that its module does not export is the object's affair: the host keeps names above it.
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

/// Each folding knows more than the one before, so there are few. Behind this many a file is folded as if it stood alone.
const MOST_FOLDINGS_OF_ONE_FILE: u32 = 64;

const FILES_OF_ONE_SHARE: usize = 128;

pub(super) fn fold_files_that_import_constants_again<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    state: &mut WalkState<'_, 'r>,
) -> bool {
    let mut looked_up = std::mem::take(&mut state.names_looked_up);
    let parsed = std::mem::take(&mut looked_up.parsed_since);
    // Which file runs in place of which hangs on the files that are there.
    let mut asks_every_file = false;
    if looked_up.file_count_of_replacements != state.files.len() {
        let replacements = find_files_required_in_place_of_others(context, state);
        asks_every_file = replacements != looked_up.replacements;
        looked_up.replacements = replacements;
        looked_up.file_count_of_replacements = state.files.len();
    }
    let mut asked: Vec<u32> = match asks_every_file {
        true => (0..state.files.len() as u32).collect(),
        false => {
            let readers = parsed.iter().filter_map(|file| looked_up.readers.get(file));
            readers.flatten().chain(&parsed).copied().collect()
        }
    };
    asked.shared_sort_unstable();
    asked.dedup();
    let stars: Vec<OnceLock<Arc<Stars>>> = state.files.iter().map(|_| OnceLock::new()).collect();
    let look_up = |share: &[u32]| {
        let mut exports = Exports {
            files: &state.files,
            replacements: &looked_up.replacements,
            resolved: FxHashMap::default(),
            stars: &stars,
            files_with_stars_in_progress: Vec::new(),
            first_targets_of_sites: RefCell::default(),
            files_read: Vec::new(),
        };
        let mut importers: Vec<(u32, Vec<ImportedConstant>)> = Vec::new();
        let mut reads: Vec<(u32, u32)> = Vec::new();
        for &index in share {
            let file = &state.files[index as usize];
            let names = imported_names(file).iter();
            let names = names.filter(|_| file.foldings_with_constants < MOST_FOLDINGS_OF_ONE_FILE);
            let found: Vec<ImportedConstant> = names
                .filter_map(|&name| exports.find_constant(index, name))
                .collect();
            reads.extend(exports.files_read.drain(..).map(|read| (read, index)));
            if !are_same(&found, &file.imported_constants) {
                importers.push((index, found));
            }
        }
        (importers, reads)
    };
    // The share size doesn't depend on the thread count, so every machine gets the same result.
    let shares: Vec<&[u32]> = asked.chunks(FILES_OF_ONE_SHARE).collect();
    let answers: Vec<Guarded<_>> = shares.iter().map(|_| Guarded::new(None)).collect();
    context.host.parallel(shares.len(), &|share| {
        *answers[share].lock() = Some(look_up(shares[share]));
    });
    let mut importers: Vec<(u32, Vec<ImportedConstant>)> = Vec::new();
    let mut reads: Vec<(u32, u32)> = Vec::new();
    for mut answer in answers {
        let answer = answer.get_mut().take();
        let (importers_of_share, reads_of_share) = answer.expect("every share was looked up");
        importers.extend(importers_of_share);
        reads.extend(reads_of_share);
    }
    for (read, reader) in reads {
        if looked_up.is_reader.insert((read, reader)) {
            looked_up.readers.entry(read).or_default().push(reader);
        }
    }
    state.names_looked_up = looked_up;
    let has_importers = !importers.is_empty();
    for (index, found) in importers {
        let file = &mut state.files[index as usize];
        file.imported_constants = found;
        file.foldings_with_constants += 1;
        fold_parsed_file_again(state, index);
    }
    has_importers
}
