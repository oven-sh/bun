use core::cell::RefCell;
use core::cmp::Reverse;
use core::hash::{BuildHasher, Hash};
use core::mem::{replace, take};
use core::ops::Range;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::strings::{last_index_of, split};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, Decl, FunctionFlags, Parent, PrivateNameId, SymbolId,
};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::Decision;
use bun_sema::hir::{
    self, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, ImportEqualsId,
    MemberKey, MemberKind, ModifierKind, NodeData, PatId, PatKind, PropKey, StmtId, StmtKind, UnOp,
    VarDeclId, VarKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::{ThisPositions, evaluates_own_this};
use bun_sema::program::{CodeAnswer, FileId, Files, Sym};
use bun_sema::resolve::DeclaredSideEffects;
use bun_sema::util::{ShardedMap, SharedSort};
use bun_sort_by_number::{SortByNumber, number_of_pair};
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::removable::{ClassChecks, Removable};
use crate::builtins::RuntimeModule;
use crate::builtins::resolve::{ModuleField, ModuleObjectOwner, ModuleObjectUse};
use crate::builtins::table::{self, BuiltinId, MemberLookup};
use crate::ir::generated::{ImportPhase, ModuleRequestKind};
use crate::ir::{InParallel, drop_each, for_each_mut};
use crate::known_helpers::{self, Helper, KnownHelpers, resolve_callee};
use crate::link::{Beside, run_steps_beside};
use crate::load::Sources;
use crate::load::react_compiler::POSITION;
use crate::load::sources::{ParsedSource, SourceKind, parsed_source};
use crate::lower::LeftOutDeclarations;
use crate::modules::{
    Candidates, ExportBinding, ExportLookup, ExportUse, ImportBinding, KnownMemberValues,
    KnownObjects, Member, ModuleExport, ModuleGraph, ModuleKind, ModuleRef, ModuleRequest,
    RequiredName, Shape, Site, SiteAnswer, SyntheticExportId, Validity, View, directory_of,
    is_enum,
};
use crate::options::RemovableOptions;
use crate::statistics::{Stage, StepClock};

mod elements;
#[cfg(test)]
mod function_tests;
mod functions;
#[cfg(test)]
mod tests;

pub(crate) struct ProgramReachInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub sources: &'a Sources,
    pub graph: &'a ModuleGraph,
    pub known_helpers: &'a KnownHelpers,
    pub removable: RemovableOptions,
    pub counts_executions: bool,
    pub any_file_is_named_at_run_time: bool,
    pub files_are_named_out_of_sight: bool,
    pub admits_inspector: bool,
    pub isolates_code_from_disk: bool,
    pub mocks_any_module: bool,
    pub files_started_by_runner: &'a [FileId],
    pub starts_of_workers: &'a [(FileId, ExprId, FileId)],
    pub beside: Beside<'a>,
}

impl<'a, 's> ProgramReachInput<'a, 's> {
    fn known_objects(&self, known: &'a KnownMemberValues) -> KnownObjects<'a, 's> {
        KnownObjects::new(self.files, self.graph, known)
    }
}

pub(super) const TOP_LEVEL: u32 = 0;

struct Piece {
    written_at: Range<u32>,
    unit: u32,
    enclosing: Option<u32>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Interest {
    Unit(u32),
    Binding(Sym),
    TestedBinding(Sym),
    CalledBinding(Sym, ModuleRef),
    Evaluation(ModuleRef),
    Require {
        referrer: ModuleRef,
        target: ModuleRef,
    },
    AnswerOfLoader(ModuleRef),
    Request(ModuleRef),
    Star(FileId),
    UsedImport(FileId),
    HandedOnNamespace(ModuleRef),
    RequiredName(FileId, Atom),
    Export(ModuleRef, Atom),
    CalledExport(ModuleRef, Atom),
    EveryExport(ModuleRef),
    Name(SyntheticExportId, ModuleRef),
    CalledName(SyntheticExportId, ModuleRef),
    LinkedName(SyntheticExportId, ModuleRef),
    ModuleObject(ModuleObjectOwner, ModuleObjectUse),
    EntryOfModuleCache,
    DeletionFromModuleCache(ExprId),
    StoreIntoModuleCache(ExprId),
    ModuleCacheHandedOn(ExprId),
    LoadByUnknownName,
    NameReadFromLoadByUnknownName(Atom),
    LoadOfIsolatedCode,
    FileSpelled(FileId),
    FileLeftToLoader(FileId),
    FileThatComputedNameMayAskFor(FileId),
    KnownMember(Sym),
    KnownVariable(Sym),
    Lookup(Sym),
    HandedOnObject(Sym),
    Piece(u32),
    StoreOfLoaderFunction(Option<(ExprId, LoaderHook)>),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(crate) enum LoaderHook {
    ResolveFilename,
    Require,
}

impl LoaderHook {
    fn find(builtin: BuiltinId) -> Option<LoaderHook> {
        let builtin = table::canonical_id(builtin);
        if builtin == BuiltinId::NodeModule_resolveFilename {
            return Some(LoaderHook::ResolveFilename);
        }
        (builtin == BuiltinId::NodeModulePrototypeRequire).then_some(LoaderHook::Require)
    }

    pub(crate) fn name(self) -> &'static [u8] {
        match self {
            LoaderHook::ResolveFilename => b"Module._resolveFilename",
            LoaderHook::Require => b"Module.prototype.require",
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) struct ReplacedLoaderHook {
    pub file: FileId,
    pub assignment: ExprId,
    pub hook: LoaderHook,
}

fn is_loader_function(builtin: BuiltinId) -> bool {
    let builtin = table::canonical_id(builtin);
    let holder = table::entry(builtin).holder.map(table::canonical_id);
    builtin == BuiltinId::NodeModulePrototypeRequire || holder == Some(BuiltinId::NodeModule)
}

#[derive(Copy, Clone)]
enum Part {
    Bodies,
    Declarator(VarDeclId),
    Class(ClassId),
    Statement(StmtId),
    InnerModule(u32),
}

struct ModuleUnits {
    module: ModuleRef,
    body: u32,
    stores: FxHashMap<Atom, SmallVec<[u32; 1]>>,
    parts_of_object: Vec<u32>,
    is_every_export_reached: AtomicBool,
    is_object_shown: AtomicBool,
}

impl ModuleUnits {
    fn new(module: ModuleRef, body: u32) -> ModuleUnits {
        ModuleUnits {
            module,
            body,
            stores: FxHashMap::default(),
            parts_of_object: Vec::new(),
            is_every_export_reached: AtomicBool::new(false),
            is_object_shown: AtomicBool::new(false),
        }
    }
}

struct Unit {
    functions: SmallVec<[FnId; 1]>,
    part: Part,
    region_around: u32,
    class_checks: Option<(ClassId, ClassChecks)>,
    is_class: bool,
    may_test_instances_itself: bool,
}

#[derive(Default)]
struct FileUnits {
    units: Vec<Unit>,
    unit_of_symbol: FxHashMap<SymbolId, u32>,
    unit_of_function: FxHashMap<FnId, u32>,
    unit_of_class: FxHashMap<ClassId, u32>,
    unit_of_inner_name: FxHashMap<SymbolId, u32>,
    enum_of_unit: FxHashMap<u32, SymbolId>,
    interests: Vec<Vec<Interest>>,
    star_targets: Vec<FileId>,
    statements_with_elements: Vec<(u32, ModuleRef)>,
    loaded_by_calls: Vec<FileId>,
    is_region_reached: Vec<AtomicBool>,
    modules: Vec<ModuleUnits>,
    inner_modules: FxHashMap<FnId, u32>,
    keeps_module_object: AtomicBool,
    has_object_made_by_require: AtomicBool,
    this_positions: ThisPositions,
}

impl FileUnits {
    fn find_unit(&self, hir: &hir::File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> Option<u32> {
        let named = self
            .unit_of_symbol
            .get(&symbol)
            .or_else(|| self.unit_of_inner_name.get(&symbol));
        if let Some(&unit) = named {
            return Some(unit);
        }
        let unit = match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(function) => self.unit_of_function.get(&function),
            BindingInitializer::Expression(initializer) => {
                match hir[hir.skip_type_assertions(initializer)].kind {
                    ExprKind::Fn(function) => self.unit_of_function.get(&function),
                    ExprKind::Class(class) => self.unit_of_class.get(&class),
                    _ => None,
                }
            }
            BindingInitializer::Class(class) => self.unit_of_class.get(&class),
            _ => None,
        };
        unit.copied()
    }

    fn find_module_with_body(&self, region: u32) -> Option<usize> {
        match region
            .checked_sub(1)
            .map(|unit| self.units[unit as usize].part)
        {
            None => Some(0),
            Some(Part::InnerModule(index)) => Some(index as usize),
            Some(Part::Bodies | Part::Declarator(_) | Part::Class(_) | Part::Statement(_)) => None,
        }
    }
}

fn find_class_in_variable(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    variable: SymbolId,
) -> Option<ClassId> {
    match bound.binding_initializer(hir, variable) {
        BindingInitializer::Class(class) => Some(class),
        BindingInitializer::Expression(initializer) => {
            match hir[hir.skip_type_assertions(initializer)].kind {
                ExprKind::Class(class) => Some(class),
                _ => None,
            }
        }
        _ => None,
    }
}

fn may_test_instances_itself(hir: &hir::File<'_>, class: ClassId) -> bool {
    let mut members = hir[class].members.iter().map(|member| &hir[member]);
    !hir[class].extends.is_none()
        || members.any(|member| {
            member.flags.contains(Flags::STATIC) && matches!(member.key, PropKey::Computed(_))
        })
}

fn module_of_view(view: View) -> ModuleRef {
    match view {
        View::Namespace(module) | View::Exports(module) => module,
    }
}

fn module_with_code(module: ModuleRef) -> ModuleRef {
    match module {
        ModuleRef::Face(file) => ModuleRef::File(file),
        _ => module,
    }
}

fn find_module_imported_from(
    input: &ProgramReachInput<'_, '_>,
    file: FileId,
    symbol: SymbolId,
) -> Option<ModuleRef> {
    let import = match *input.files.bound(file).symbol(symbol).decls {
        [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => import,
        [Decl::ImportSpec(specifier)] => input.files.hir(file)[specifier].import,
        _ => return None,
    };
    match input
        .graph
        .find_site_answer(file, ImportSiteKind::Import(import))
    {
        Some(SiteAnswer::Module(module)) => Some(module),
        _ => None,
    }
}

pub(super) fn is_only_read(hir: &hir::File<'_>, bound: &Bound<'_>, member: ExprId) -> bool {
    let Parent::Expr(parent) = bound.parent_of_expr(member) else {
        return true;
    };
    match hir[parent].kind {
        ExprKind::Assign { target, .. } => target != member,
        ExprKind::Unary { op, .. } => match op {
            UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => false,
            UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof | UnOp::Void => true,
        },
        _ => true,
    }
}

pub(super) fn find_parent_past_casts(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    mut node: ExprId,
) -> (ExprId, Parent) {
    loop {
        match bound.parent_of_expr(node) {
            Parent::Expr(parent)
                if matches!(
                    hir[parent].kind,
                    ExprKind::As { .. }
                        | ExprKind::Satisfies { .. }
                        | ExprKind::AsConst(_)
                        | ExprKind::NonNull(_)
                ) =>
            {
                node = parent;
            }
            parent => return (node, parent),
        }
    }
}

struct FileScan<'a, 's> {
    input: &'a ProgramReachInput<'a, 's>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    units: FileUnits,
    pieces: Vec<Piece>,
    sites: Vec<(ExprId, ModuleRef)>,
    region: u32,
    module: u32,
    known_members: KnownMemberValues,
    units_reached_together: Vec<(u32, u32)>,
    units_placed_by_text: Vec<(u32, u32)>,
    units_of_private_names: FxHashMap<PrivateNameId, u32>,
    units_of_references: RefCell<Vec<u32>>,
}

const UNIT_NOT_ASKED: u32 = u32::MAX;
const NO_UNIT: u32 = u32::MAX - 1;
const MOST_COMPARED_ONE_BY_ONE: usize = 16;

impl<'a, 's> FileScan<'a, 's> {
    fn new(input: &'a ProgramReachInput<'a, 's>, file: FileId) -> FileScan<'a, 's> {
        let mut units = FileUnits::default();
        units
            .modules
            .push(ModuleUnits::new(ModuleRef::File(file), TOP_LEVEL));
        FileScan {
            input,
            file,
            hir: input.files.hir(file),
            bound: input.files.bound(file),
            units,
            pieces: Vec::new(),
            sites: Vec::new(),
            region: TOP_LEVEL,
            module: 0,
            known_members: KnownMemberValues::default(),
            units_reached_together: Vec::new(),
            units_placed_by_text: Vec::new(),
            units_of_private_names: FxHashMap::default(),
            units_of_references: RefCell::new(Vec::new()),
        }
    }

    fn find_unit_of_reference(&self, symbol: SymbolId) -> Option<u32> {
        let mut found = self.units_of_references.borrow_mut();
        if found.len() <= symbol.idx() {
            found.resize(symbol.idx() + 1, UNIT_NOT_ASKED);
        }
        let known = &mut found[symbol.idx()];
        if *known == UNIT_NOT_ASKED {
            let unit = self.units.find_unit(self.hir, self.bound, symbol);
            *known = unit.unwrap_or(NO_UNIT);
        }
        (*known != NO_UNIT).then_some(*known)
    }

    fn expressions(&self) -> impl Iterator<Item = ExprId> + use<> {
        (0..self.hir.exprs.len() as u32).map(ExprId)
    }

    fn is_stable(&self, symbol: SymbolId) -> bool {
        !symbol.is_none() && self.bound.is_stable_binding(symbol)
    }

    fn add_unit(&mut self, part: Part, functions: SmallVec<[FnId; 1]>) -> u32 {
        let unit = self.units.units.len() as u32;
        self.units.units.push(Unit {
            functions,
            part,
            region_around: self.region,
            class_checks: None,
            is_class: false,
            may_test_instances_itself: false,
        });
        unit
    }

    fn add_piece(&mut self, written_at: Range<u32>, unit: u32) {
        self.pieces.push(Piece {
            written_at,
            unit,
            enclosing: None,
        });
    }

    fn add_function_unit(&mut self, function: FnId, written_at: Range<u32>) {
        let unit = self.add_unit(Part::Bodies, smallvec![function]);
        self.units.unit_of_function.insert(function, unit);
        self.add_piece(written_at, unit);
    }

    fn is_name_of_one_part(&self, symbol: SymbolId) -> bool {
        if !self.is_stable(symbol) {
            return false;
        }
        let declared = self.bound.symbol(symbol);
        let exported = declared.export_symbol;
        declared.decls.len() == 1
            && (exported.is_none() || self.bound.symbol(exported).decls.len() == 1)
    }

    fn add_part(&mut self, part: Part, written_at: Range<u32>, symbols: &[SymbolId]) -> u32 {
        let unit = self.add_unit(part, SmallVec::new());
        self.add_piece(written_at, unit);
        for &symbol in symbols {
            self.units.unit_of_symbol.insert(symbol, unit);
        }
        unit
    }

    fn add_part_with_class_checks(
        &mut self,
        part: Part,
        written_at: Range<u32>,
        symbols: &[SymbolId],
        class: ClassId,
        checks: ClassChecks,
    ) -> u32 {
        let hir = self.hir;
        let heritage = checks.heritage.then_some(hir[class].extends);
        let keys = checks
            .keys
            .iter()
            .filter_map(|&member| match hir[member].key {
                PropKey::Computed(key) => Some(key),
                PropKey::None | PropKey::Name(_) | PropKey::Private(_) => None,
            });
        let unit = self.add_unit(part, SmallVec::new());
        let mut start = written_at.start;
        for evaluated in heritage.into_iter().chain(keys) {
            self.add_piece(start..hir[evaluated].pos, unit);
            start = hir[evaluated].end;
        }
        self.add_piece(start..written_at.end, unit);
        for &symbol in symbols {
            self.units.unit_of_symbol.insert(symbol, unit);
        }
        self.units.units[unit as usize].class_checks = Some((class, checks));
        unit
    }

    fn collect_stable_names(&self, pattern: PatId, names: &mut SmallVec<[SymbolId; 2]>) -> bool {
        let hir = self.hir;
        match hir[pattern].kind {
            PatKind::Missing => true,
            PatKind::Ident(_) => match self.bound.initialized_binding(pattern) {
                Binding::Symbol(symbol) if self.is_name_of_one_part(symbol) => {
                    names.push(symbol);
                    true
                }
                _ => false,
            },
            PatKind::Object(properties) => {
                let mut values = properties.iter().map(|property| hir[property].value);
                values.all(|value| self.collect_stable_names(value, names))
            }
            PatKind::Array(elements) => {
                let mut patterns = elements.iter().map(|element| hir[element].pat);
                patterns.all(|pattern| self.collect_stable_names(pattern, names))
            }
        }
    }

    fn add_declarator_part(
        &mut self,
        removable: &Removable<'_, '_>,
        declaration: VarDeclId,
    ) -> bool {
        let node = &self.hir[declaration];
        if node.init.is_none() || node.flags.contains(Flags::AMBIENT) {
            return false;
        }
        let class_checks = match removable.declaration(declaration) {
            true => None,
            false => {
                let class = removable.find_class_of_declaration(declaration);
                let checks = class.and_then(|class| removable.find_class_checks(class));
                match class.zip(checks) {
                    Some(class_checks) => Some(class_checks),
                    None => return false,
                }
            }
        };
        let mut names = SmallVec::new();
        if !self.collect_stable_names(node.pat, &mut names) {
            return false;
        }
        let (part, written_at) = (Part::Declarator(declaration), node.loc.pos..node.loc.end);
        match class_checks {
            Some((class, checks)) => {
                self.add_part_with_class_checks(part, written_at, &names, class, checks)
            }
            None => self.add_part(part, written_at, &names),
        };
        true
    }

    fn add_class_part(&mut self, class: ClassId, written_at: Range<u32>, checks: ClassChecks) {
        let hir = self.hir;
        let names = [
            self.bound.declared_symbol(Decl::Class(class)),
            self.bound.inner_class_symbol(class),
        ];
        let names: SmallVec<[SymbolId; 2]> =
            names.into_iter().filter(|name| !name.is_none()).collect();
        let part = Part::Class(class);
        let unit = match checks.is_empty() {
            true => self.add_part(part, written_at, &names),
            false => self.add_part_with_class_checks(part, written_at, &names, class, checks),
        };
        let members = hir[class].members.iter().map(|member| hir[member].func);
        let functions =
            members.filter(|&function| !function.is_none() && hir::has_body(&hir[function]));
        self.units.units[unit as usize].functions = functions.collect();
    }

    fn add_statement_part(&mut self, statement: StmtId) {
        let written_at = self.hir[statement].loc;
        let written_at = written_at.pos..written_at.end;
        let name = match self.hir[statement].kind {
            StmtKind::Enum(declared) => self.bound.declared_symbol(Decl::Enum(declared)),
            StmtKind::ExportDefault(_) => self.bound.declared_symbol(Decl::ExportExpr(statement)),
            _ => {
                self.add_part(Part::Statement(statement), written_at, &[]);
                return;
            }
        };
        let is_enum = matches!(self.hir[statement].kind, StmtKind::Enum(_));
        if self.is_name_of_one_part(name) {
            let unit = self.add_part(Part::Statement(statement), written_at, &[name]);
            if is_enum {
                self.units.enum_of_unit.insert(unit, name);
            }
        } else if self.is_name_of_enums_alone(name) {
            let unit = self.add_part(Part::Statement(statement), written_at, &[]);
            self.units.enum_of_unit.insert(unit, name);
            match self.units.unit_of_symbol.get(&name) {
                Some(&first) => self.units_reached_together.push((first, unit)),
                None => {
                    self.units.unit_of_symbol.insert(name, unit);
                }
            }
        }
    }

    fn is_name_of_enums_alone(&self, symbol: SymbolId) -> bool {
        if !self.is_stable(symbol) {
            return false;
        }
        let has_enums_alone = |symbol: SymbolId| {
            let mut declarations = self.bound.symbol(symbol).decls.iter();
            declarations.all(|declaration| matches!(declaration, Decl::Enum(_)))
        };
        let exported = self.bound.symbol(symbol).export_symbol;
        has_enums_alone(symbol) && (exported.is_none() || has_enums_alone(exported))
    }

    fn add_part_of_object(&mut self, statement: StmtId) {
        let written_at = self.hir[statement].loc;
        let unit = self.add_part(
            Part::Statement(statement),
            written_at.pos..written_at.end,
            &[],
        );
        self.units.modules[self.module as usize]
            .parts_of_object
            .push(unit);
    }

    fn add_stored_name(&self, node: ExprId, names: &mut SmallVec<[Atom; 1]>) -> bool {
        let graph = self.input.graph;
        match graph.member(self.file, node) {
            Some(Member::Variable(export)) => {
                let export = graph.synthetic_export(export);
                let is_own = export.module == self.units.modules[self.module as usize].module;
                if is_own {
                    names.push(export.name);
                }
                is_own
            }
            Some(Member::Undefined) => true,
            Some(Member::Copy(_) | Member::Binding(_) | Member::Marker(_) | Member::OnObject)
            | None => false,
        }
    }

    fn collect_stored_names(
        &self,
        removable: &Removable<'_, '_>,
        expression: ExprId,
        names: &mut SmallVec<[Atom; 1]>,
        class_checks: &mut Option<(ClassId, ClassChecks)>,
    ) -> bool {
        let hir = self.hir;
        let mut expression = hir.skip_type_assertions(expression);
        if let ExprKind::Call(call) = hir[expression].kind {
            let mut described = hir.ids(hir[call].args).skip(1);
            return self.add_stored_name(expression, names)
                && described.all(|operand| removable.stored_value(operand));
        }
        let mut has_store = false;
        while let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[expression].kind
        {
            if !self.add_stored_name(hir.skip_type_assertions(target), names) {
                return false;
            }
            has_store = true;
            expression = hir.skip_type_assertions(value);
        }
        if !has_store || removable.stored_value(expression) {
            return has_store;
        }
        let ExprKind::Class(class) = hir[expression].kind else {
            return false;
        };
        *class_checks = removable
            .find_class_checks(class)
            .map(|checks| (class, checks));
        class_checks.is_some()
    }

    fn add_export_store_part(&mut self, removable: &Removable<'_, '_>, statement: StmtId) {
        let StmtKind::Expr(expression) = self.hir[statement].kind else {
            return;
        };
        let (mut names, mut class_checks) = (SmallVec::new(), None);
        if !self.collect_stored_names(removable, expression, &mut names, &mut class_checks) {
            return;
        }
        let written_at = self.hir[statement].loc;
        let (part, written_at) = (Part::Statement(statement), written_at.pos..written_at.end);
        let unit = match class_checks {
            Some((class, checks)) => {
                self.add_part_with_class_checks(part, written_at, &[], class, checks)
            }
            None => self.add_part(part, written_at, &[]),
        };
        let module = &mut self.units.modules[self.module as usize];
        if names.is_empty() {
            module.parts_of_object.push(unit);
        }
        for name in names {
            module.stores.entry(name).or_default().push(unit);
        }
    }

    fn add_class_unit(&mut self, class: ClassId) {
        let hir = self.hir;
        let unit = self.units.units.len() as u32;
        let mut functions = SmallVec::new();
        let mut pieces = Vec::new();
        for id in hir[class].members.iter() {
            let member = &hir[id];
            let has_function = match member.kind {
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => {
                    !member.func.is_none() && hir::has_body(&hir[member.func])
                }
                MemberKind::StaticBlock => return,
                MemberKind::Property if member.flags.contains(Flags::STATIC) => return,
                _ => false,
            };
            if has_function
                && !matches!(member.key, PropKey::Computed(_))
                && self.find_private_name_of_function(id).is_none()
            {
                functions.push(member.func);
                pieces.push(Piece {
                    written_at: member.loc.pos..member.loc.end,
                    unit,
                    enclosing: None,
                });
            }
        }
        let inner_name = self.bound.inner_class_symbol(class);
        if !inner_name.is_none() {
            self.units.unit_of_inner_name.insert(inner_name, unit);
        }
        self.units.unit_of_class.insert(class, unit);
        self.add_unit(Part::Bodies, functions);
        self.units.units[unit as usize].is_class = true;
        self.units.units[unit as usize].may_test_instances_itself =
            may_test_instances_itself(hir, class);
        self.pieces.extend(pieces);
    }

    fn add_function_constant(&mut self, declaration: VarDeclId) {
        let hir = self.hir;
        let node = &hir[declaration];
        if node.init.is_none() || node.flags.contains(Flags::AMBIENT) {
            return;
        }
        let initializer = hir.skip_type_assertions(node.init);
        let ExprKind::Fn(function) = hir[initializer].kind else {
            return;
        };
        let is_constant =
            node.kind == VarKind::Const && matches!(hir[node.pat].kind, PatKind::Ident(_));
        let is_stable = match self.bound.initialized_binding(node.pat) {
            Binding::Symbol(symbol) => self.is_stable(symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        };
        if is_constant && is_stable {
            self.add_function_unit(function, hir[initializer].pos..hir[initializer].end);
        }
    }

    fn collect_units_among_statements(
        &mut self,
        statements: IdList<StmtId>,
        removable: Option<&Removable<'_, '_>>,
        has_decorators: bool,
    ) {
        let (hir, bound) = (self.hir, self.bound);
        let decisions = &self.input.files.analysis(self.file).decisions;
        for statement in hir.ids(statements) {
            if decisions.is_dead_stmt(statement) {
                continue;
            }
            if self.input.graph.erased(self.file, statement) {
                self.add_part_of_object(statement);
                continue;
            }
            match hir[statement].kind {
                StmtKind::Fn(function) => {
                    let func = &hir[function];
                    let has_code = hir::has_body(func) && !func.flags.contains(Flags::AMBIENT);
                    if has_code && self.is_stable(bound.declared_symbol(Decl::Fn(function))) {
                        let written_at = hir[statement].loc;
                        self.add_function_unit(function, written_at.pos..written_at.end);
                    }
                }
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        let is_part =
                            removable.is_some_and(|it| self.add_declarator_part(it, declaration));
                        if !is_part {
                            self.add_function_constant(declaration);
                        }
                    }
                }
                StmtKind::Class(class) => {
                    let is_ambient = hir[class].flags.contains(Flags::AMBIENT);
                    if is_ambient || !self.is_stable(bound.declared_symbol(Decl::Class(class))) {
                        continue;
                    }
                    let is_one_part =
                        self.is_name_of_one_part(bound.declared_symbol(Decl::Class(class)));
                    let checks = removable.and_then(|it| it.find_class_checks(class));
                    if let (true, Some(checks)) = (is_one_part, checks) {
                        let written_at = hir[statement].loc;
                        self.add_class_part(class, written_at.pos..written_at.end, checks);
                    } else if !has_decorators {
                        self.add_class_unit(class);
                    }
                }
                StmtKind::Expr(_) | StmtKind::Enum(_) | StmtKind::ExportDefault(_) => {
                    let members = self.input.known_objects(&self.known_members);
                    let (is_enum_known_whole, may_run_setter) = match hir[statement].kind {
                        StmtKind::Enum(it) => (
                            members.knows_every_member(self.file, it),
                            members.stores_under_name_laid_on_object_prototype(self.file, it),
                        ),
                        _ => (false, false),
                    };
                    let is_removable = |it: &Removable<'_, '_>| {
                        !may_run_setter && (is_enum_known_whole || it.statement(statement))
                    };
                    if removable.is_some_and(is_removable) {
                        self.add_statement_part(statement);
                    } else if let Some(removable) = removable {
                        self.add_export_store_part(removable, statement);
                    }
                }
                _ => {}
            }
        }
    }

    fn add_inner_module(
        &mut self,
        callback: FnId,
        removable: Option<&Removable<'_, '_>>,
        has_decorators: bool,
    ) {
        let hir = self.hir;
        let written_at = match hir[callback].body {
            FnBody::Block(statements) => {
                let mut locations = hir.ids(statements).map(|statement| hir[statement].loc);
                let first = locations.next();
                let last = locations.next_back().or(first);
                first.zip(last).map(|(first, last)| first.pos..last.end)
            }
            FnBody::Expr(value) => Some(hir[value].pos..hir[value].end),
            FnBody::None => None,
        };
        let index = self.units.modules.len() as u32;
        let unit = self.add_unit(Part::InnerModule(index), smallvec![callback]);
        if let Some(written_at) = written_at {
            self.add_piece(written_at, unit);
        }
        let module = ModuleRef::Inner {
            file: self.file,
            callback,
        };
        self.units.modules.push(ModuleUnits::new(module, unit + 1));
        self.units.inner_modules.insert(callback, index);
        if let FnBody::Block(statements) = hir[callback].body {
            (self.region, self.module) = (unit + 1, index);
            self.collect_units_among_statements(statements, removable, has_decorators);
            (self.region, self.module) = (TOP_LEVEL, 0);
        }
    }

    fn link_pieces(&mut self) {
        let pieces = &mut self.pieces;
        pieces.shared_sort_unstable_by_key(|piece| {
            (piece.written_at.start, Reverse(piece.written_at.end))
        });
        let mut open: Vec<u32> = Vec::new();
        for index in 0..pieces.len() {
            let start = pieces[index].written_at.start;
            while open
                .last()
                .is_some_and(|&outer| pieces[outer as usize].written_at.end <= start)
            {
                open.pop();
            }
            pieces[index].enclosing = open.last().copied();
            open.push(index as u32);
        }
    }

    fn collect_units(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        if !bound.runtime.eval_scopes().is_empty() {
            return;
        }
        let mut modifiers = hir.modifiers.iter();
        let has_decorators = modifiers.any(|it| matches!(it.kind, ModifierKind::Decorator(_)));
        let is_counted =
            self.input.counts_executions && self.input.sources.is_in_coverage_report(self.file);
        let removable = Removable::new(self.input.files, self.file, self.input.removable);
        let removable = removable.filter(|_| !is_counted);
        let removable = removable.map(|it| it.with_modules(self.input.graph, self.file));
        let removable = removable.as_ref();
        self.collect_units_among_statements(hir.body, removable, has_decorators);
        for &callback in self.input.graph.inner_modules(self.file) {
            self.add_inner_module(callback, removable, has_decorators);
        }
        self.collect_function_units(has_decorators);
        self.link_pieces();
        self.place_units();
    }

    fn region_of(&self, position: u32) -> u32 {
        self.region_outside(position, None)
    }

    fn region_outside(&self, position: u32, unit: Option<u32>) -> u32 {
        if position == POSITION {
            return TOP_LEVEL;
        }
        let following = self
            .pieces
            .partition_point(|piece| piece.written_at.start <= position);
        let mut candidate = following.checked_sub(1);
        while let Some(piece) = candidate.map(|index| &self.pieces[index]) {
            if position < piece.written_at.end && Some(piece.unit) != unit {
                return piece.unit + 1;
            }
            candidate = piece.enclosing.map(|index| index as usize);
        }
        TOP_LEVEL
    }

    fn module_at(&self, mut region: u32) -> ModuleRef {
        while region != TOP_LEVEL {
            if let Some(index) = self.units.find_module_with_body(region) {
                return self.units.modules[index].module;
            }
            region = self.units.units[region as usize - 1].region_around;
        }
        ModuleRef::File(self.file)
    }

    fn add_interest(&mut self, position: u32, interest: Interest) {
        let mut region = self.region_of(position);
        if self.keeps_declaration_of_file(interest) {
            region = self.region_below_body(region);
        }
        self.units.interests[region as usize].push(interest);
    }

    fn find_parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let mut outermost = expression;
        loop {
            match self.bound.parent_of_expr(outermost) {
                Parent::Expr(parent)
                    if self.hir.type_assertion_operand(parent) == Some(outermost) =>
                {
                    outermost = parent;
                }
                parent => return (outermost, parent),
            }
        }
    }

    fn is_only_read(&self, member: ExprId) -> bool {
        is_only_read(self.hir, self.bound, member)
    }

    fn is_plain_store(&self, member: ExprId) -> bool {
        let Parent::Expr(parent) = self.bound.parent_of_expr(member) else {
            return false;
        };
        matches!(self.hir[parent].kind, ExprKind::Assign { op: None, target, .. } if target == member)
    }

    fn is_called(&self, callee: ExprId) -> bool {
        let hir = self.hir;
        let mut node = callee;
        loop {
            let Parent::Expr(parent) = self.bound.parent_of_expr(node) else {
                return false;
            };
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => node = parent,
                ExprKind::Call(call) => return hir[call].callee == node,
                ExprKind::TaggedTemplate(template) => return hir[template].callee == node,
                _ => return false,
            }
        }
    }

    fn find_member_read_from(&self, holder: ExprId) -> Option<(ExprId, Atom)> {
        let hir = self.hir;
        let mut node = holder;
        loop {
            let Parent::Expr(parent) = self.bound.parent_of_expr(node) else {
                return None;
            };
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => node = parent,
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    return match hir.member_key(parent) {
                        Some((object, MemberKey::Name(name)))
                            if object == node && self.is_only_read(parent) =>
                        {
                            Some((parent, name))
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    fn interest_in_module_object(&self, module: ModuleRef, holder: ExprId) -> Interest {
        match self.find_member_read_from(holder) {
            Some((member, name)) if self.is_called(member) => Interest::CalledExport(module, name),
            Some((_, name)) => Interest::Export(module, name),
            None => Interest::EveryExport(module),
        }
    }

    fn add_names_read_from_awaited_import(
        &self,
        module: ModuleRef,
        call: ExprId,
        interests: &mut Vec<Interest>,
    ) -> bool {
        let hir = self.hir;
        let Parent::Expr(awaited) = self.bound.parent_of_expr(call) else {
            return false;
        };
        if !matches!(hir[awaited].kind, ExprKind::Await(_)) {
            return false;
        }
        let first = interests.len();
        match (
            self.find_member_read_from(awaited),
            self.bound.parent_of_expr(awaited),
        ) {
            (Some(_), _) => interests.push(self.interest_in_module_object(module, awaited)),
            (None, Parent::VarInit(declaration)) => {
                let PatKind::Object(properties) = hir[hir[declaration].pat].kind else {
                    return false;
                };
                for property in properties.iter() {
                    match hir[property].key {
                        PropKey::Name(name) if !hir[property].is_rest => {
                            interests.push(Interest::Export(module, name));
                        }
                        _ => {
                            interests.truncate(first);
                            return false;
                        }
                    }
                }
            }
            (None, _) => return false,
        }
        interests.push(Interest::CalledExport(module, known::then));
        true
    }

    fn is_object_of_bound_member(&self, object: ExprId) -> bool {
        let (object, Parent::Expr(access)) = self.find_parent(object) else {
            return false;
        };
        let is_object = self
            .hir
            .member_key(access)
            .is_some_and(|(accessed, _)| accessed == object);
        let member = self.input.graph.member(self.file, access);
        is_object && member.is_some_and(|member| member != Member::OnObject)
    }

    fn interest_in_import(
        &self,
        binding: ImportBinding,
        reference: Option<ExprId>,
        imported_from: Option<ModuleRef>,
    ) -> Option<Interest> {
        match binding {
            ImportBinding::Variable(defined) => Some(match reference {
                Some(reference)
                    if self.is_only_compared(reference, || {
                        let files = self.input.files;
                        let (hir, bound) = (files.hir(defined.file), files.bound(defined.file));
                        find_class_in_variable(hir, bound, defined.id)
                            .is_some_and(|class| may_test_instances_itself(hir, class))
                    }) =>
                {
                    Interest::TestedBinding(defined)
                }
                Some(_) | None => Interest::Binding(defined),
            }),
            ImportBinding::Namespace { module, .. } => Some(match reference {
                Some(reference) => self.interest_in_module_object(module, reference),
                None => Interest::EveryExport(module),
            }),
            ImportBinding::NamespaceRead { module, name } => Some(Interest::Export(module, name)),
            ImportBinding::Synthetic(export) | ImportBinding::CapturedBuiltin { export, .. } => {
                let owner = self.input.graph.synthetic_export(export).module;
                Some(Interest::Name(export, imported_from.unwrap_or(owner)))
            }
            ImportBinding::Exports { module } => Some(match reference {
                Some(reference) if self.is_object_of_bound_member(reference) => {
                    Interest::Evaluation(module)
                }
                Some(_) | None => Interest::EveryExport(module),
            }),
            _ => None,
        }
    }

    fn find_module_imported_from(&self, symbol: SymbolId) -> Option<ModuleRef> {
        find_module_imported_from(self.input, self.file, symbol)
    }

    fn find_use_of_import(&self, symbol: SymbolId) -> Option<Interest> {
        let module = self.find_module_imported_from(symbol)?;
        find_quiet_file(self.input.graph, module).map(Interest::UsedImport)
    }

    fn find_file_between(
        &self,
        binding: ImportBinding,
        read_off: Option<ModuleRef>,
    ) -> Option<FileId> {
        let ImportBinding::Namespace {
            module: ModuleRef::File(target),
            phase: ImportPhase::Evaluation,
        } = binding
        else {
            return None;
        };
        match read_off? {
            ModuleRef::File(holder)
                if holder != target && self.input.graph.holds_mock_in_variable(target) =>
            {
                Some(holder)
            }
            _ => None,
        }
    }

    fn find_name_read_off_file_between(
        &self,
        symbol: SymbolId,
        binding: ImportBinding,
    ) -> Option<(FileId, Atom)> {
        if !matches!(binding, ImportBinding::Namespace { .. }) {
            return None;
        }
        let holder = self.find_file_between(binding, self.find_module_imported_from(symbol))?;
        let name = match *self.bound.symbol(symbol).decls {
            [Decl::ImportSpec(specifier)] => self.hir[specifier].imported,
            [Decl::ImportDefault(_)] => known::default,
            _ => return None,
        };
        Some((holder, name))
    }

    fn interest_in_symbol(&self, symbol: SymbolId, reference: Option<ExprId>) -> Option<Interest> {
        let binding = self.input.graph.import_binding(self.file, symbol);
        self.interest_in_symbol_bound_as(symbol, binding, reference)
    }

    fn interest_in_symbol_bound_as(
        &self,
        symbol: SymbolId,
        binding: ImportBinding,
        reference: Option<ExprId>,
    ) -> Option<Interest> {
        if let Some(view) = self.input.graph.holder(self.file, symbol) {
            return match reference {
                Some(_) => None,
                None => Some(Interest::EveryExport(module_of_view(view))),
            };
        }
        match binding {
            ImportBinding::Local => {
                let unit = match reference {
                    Some(_) => self.find_unit_of_reference(symbol)?,
                    None => self.units.find_unit(self.hir, self.bound, symbol)?,
                };
                let unit_named = &self.units.units[unit as usize];
                let is_only_compared = unit_named.is_class
                    && reference.is_some_and(|reference| {
                        self.is_only_compared(reference, || unit_named.may_test_instances_itself)
                    });
                (!is_only_compared).then_some(Interest::Unit(unit))
            }
            binding => {
                self.interest_in_import(binding, reference, self.find_module_imported_from(symbol))
            }
        }
    }

    fn find_data_variable(&self, symbol: SymbolId) -> Option<Sym> {
        let members = self.input.known_objects(&self.known_members);
        let named = Sym {
            file: self.file,
            id: symbol,
        };
        let (variable, _) = members.find_data_variable(named)?;
        Some(variable)
    }

    fn interest_in_known_object(&self, holder: ExprId) -> Option<Option<Interest>> {
        let hir = self.hir;
        let members = self.input.known_objects(&self.known_members);
        let mut link = holder;
        while let (outermost, Parent::Expr(access)) = self.find_parent(link)
            && (hir.member_key(access)).is_some_and(|(object, _)| object == outermost)
        {
            if let Some(read) = members.find_data_read(self.file, access) {
                return Some(Some(Interest::KnownMember(read.object)));
            }
            link = access;
        }
        let (outermost, Parent::Expr(access)) = self.find_parent(holder) else {
            return (members.find_lookup(self.file, holder))
                .map(|enumeration| Some(Interest::Lookup(enumeration)));
        };
        let is_object = (hir.member_key(access)).is_some_and(|(object, _)| object == outermost);
        if is_object && let Some(read) = members.find_read(self.file, access) {
            return Some(match read.validity {
                Validity::Always => None,
                Validity::WhileObjectIsNotHandedOn => Some(Interest::KnownMember(read.object)),
            });
        }
        if let Some(enumeration) = members.find_lookup(self.file, holder) {
            return Some(Some(Interest::Lookup(enumeration)));
        }
        match is_object && members.find_enum(self.file, access).is_some() {
            true => self.interest_in_known_object(access),
            false => None,
        }
    }

    fn interest_in_member_of_plain_name(&self, holder: ExprId) -> Option<Option<Interest>> {
        let (outermost, Parent::Expr(access)) = self.find_parent(holder) else {
            return None;
        };
        if !(self.hir.member_key(access)).is_some_and(|(object, _)| object == outermost) {
            return None;
        }
        let members = self.input.known_objects(&self.known_members);
        match members.find_enum(self.file, access).is_some() {
            true => self.interest_in_known_object(access),
            false => None,
        }
    }

    fn add_name_that_is_no_expression(&mut self, symbol: SymbolId) {
        let interests = &mut self.units.interests[TOP_LEVEL as usize];
        if is_enum(self.bound, symbol) {
            interests.push(Interest::HandedOnObject(Sym {
                file: self.file,
                id: symbol,
            }));
        }
        let use_of_import = self.find_use_of_import(symbol);
        let interest = self.interest_in_symbol(symbol, None);
        self.units.interests[TOP_LEVEL as usize].extend(use_of_import.into_iter().chain(interest));
    }

    fn add_references(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        let decisions = &self.input.files.analysis(self.file).decisions;
        let graph = self.input.graph;
        let quiet_files = graph
            .requests(self.file)
            .iter()
            .filter_map(|request| find_quiet_file(graph, request.target));
        let imports_quiet_file = quiet_files.clone().next().is_some();
        let imports = graph.import_bindings(self.file);
        let has_enums = !hir.enums.is_empty();
        let names_known_objects = has_enums || graph.kind(self.file) == ModuleKind::Data;
        for reference in self.expressions() {
            if !matches!(hir[reference].kind, ExprKind::Ident(_))
                || !bound.is_evaluated_ident(reference)
                || decisions.is_dead_expr(reference)
            {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            if bound.is_in_type_query(reference) {
                continue;
            }
            if let Parent::Expr(parent) = bound.parent_of_expr(reference)
                && let Some(read) = decisions.length_of_named_text(hir, parent)
                && read.name == reference
                && !read.name_runs_for_its_check
                && !self.is_called(parent)
            {
                continue;
            }
            if imports_quiet_file && let Some(interest) = self.find_use_of_import(symbol) {
                self.add_interest(hir[reference].pos, interest);
            }
            let binding = match (imports.first(), imports.last()) {
                (Some(first), Some(last)) if first.0 <= symbol && symbol <= last.0 => {
                    graph.import_binding(self.file, symbol)
                }
                _ => ImportBinding::Local,
            };
            let is_plain_name = !names_known_objects && matches!(binding, ImportBinding::Local);
            if !is_plain_name && let Some(variable) = self.find_data_variable(symbol) {
                self.add_interest(hir[reference].pos, Interest::KnownVariable(variable));
                continue;
            }
            let known = match is_plain_name {
                true => self.interest_in_member_of_plain_name(reference),
                false => self.interest_in_known_object(reference),
            };
            if let Some(interest) = known {
                if let Some(interest) = interest {
                    self.add_interest(hir[reference].pos, interest);
                }
                continue;
            }
            if has_enums && is_enum(bound, symbol) {
                let enumeration = Sym {
                    file: self.file,
                    id: symbol,
                };
                self.add_interest(hir[reference].pos, Interest::HandedOnObject(enumeration));
            }
            if let Some(interest) =
                self.interest_in_symbol_bound_as(symbol, binding, Some(reference))
            {
                match self.split_interest_of_heritage(reference, interest) {
                    Some((extending, needed_by_definition)) => {
                        self.units.interests[extending as usize + 1].push(interest);
                        if let Some(needed) = needed_by_definition {
                            self.add_interest(hir[reference].pos, needed);
                        }
                    }
                    None => self.add_interest(hir[reference].pos, interest),
                }
                if let Interest::Export(module, _)
                | Interest::CalledExport(module, _)
                | Interest::EveryExport(module) = interest
                    && let Some(imported_from) = self.find_module_imported_from(symbol)
                    && module_with_code(imported_from) != module_with_code(module)
                {
                    let handed_on = Interest::HandedOnNamespace(module_with_code(module));
                    self.add_interest(hir[reference].pos, handed_on);
                }
            }
            if let Some((holder, name)) = self.find_name_read_off_file_between(symbol, binding) {
                let read = Interest::Export(ModuleRef::File(holder), name);
                self.add_interest(hir[reference].pos, read);
            }
        }
        for &(symbol, binding) in self.input.graph.import_bindings(self.file) {
            if let ImportBinding::Synthetic(_) = binding
                && let Some(ModuleRef::File(exporter)) = self.find_module_imported_from(symbol)
                && self.input.graph.has_record(exporter)
                && !self.input.graph.has_no_side_effects(exporter)
                && let Some(Interest::Name(export, accessed)) =
                    self.interest_in_symbol(symbol, None)
            {
                let interest = Interest::LinkedName(export, accessed);
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
        if !bound.runtime.eval_scopes().is_empty() {
            for &(symbol, _) in self.input.graph.import_bindings(self.file) {
                if let Some(interest) = self.interest_in_symbol(symbol, None) {
                    self.units.interests[TOP_LEVEL as usize].push(interest);
                }
            }
            self.units.interests[TOP_LEVEL as usize].extend(quiet_files.map(Interest::UsedImport));
        }
        for import in (0..hir.import_equals.len() as u32).map(ImportEqualsId) {
            if let Binding::Symbol(symbol) = bound.entity_root_binding(import) {
                self.add_name_that_is_no_expression(symbol);
            }
        }
        for reference in bound.runtime.implicit_references() {
            if let Binding::Symbol(symbol) = reference.binding {
                self.add_name_that_is_no_expression(symbol);
            }
        }
    }

    fn find_accessed_module(&self, access: ExprId) -> Option<ModuleRef> {
        let graph = self.input.graph;
        let (object, _) = self.hir.member_key(access)?;
        let object = self.hir.skip_type_assertions(object);
        match self.hir[object].kind {
            ExprKind::Ident(_) => match self.bound.binding(object) {
                Binding::Symbol(symbol) => {
                    let held = graph.holder(self.file, symbol).map(module_of_view);
                    held.or_else(|| self.find_module_imported_from(symbol))
                }
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            },
            ExprKind::Call(_) => match graph.site(self.file, object) {
                Some(Site::Evaluate { target, .. }) => Some(target),
                Some(Site::AsToday) | None => None,
            },
            _ => None,
        }
    }

    fn add_members(&mut self) {
        let (hir, graph) = (self.hir, self.input.graph);
        let decisions = &self.input.files.analysis(self.file).decisions;
        for access in self.expressions() {
            match hir[access].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. }
                    if !decisions.is_dead_expr(access) => {}
                _ => continue,
            }
            self.add_private_name_of_access(access);
            let interest = match graph.member(self.file, access) {
                Some(Member::Variable(export) | Member::Copy(export)) => {
                    if self.is_plain_store(access) {
                        continue;
                    }
                    let owner = graph.synthetic_export(export).module;
                    let accessed = self.find_accessed_module(access).unwrap_or(owner);
                    match self.is_called(access) {
                        true => Interest::CalledName(export, accessed),
                        false => Interest::Name(export, accessed),
                    }
                }
                Some(Member::Binding(_))
                    if let Some(interest) = self.interest_in_known_object(access) =>
                {
                    match interest {
                        Some(interest) => interest,
                        None => continue,
                    }
                }
                Some(Member::Binding(defined)) => match self.is_called(access) {
                    true => {
                        let owner = ModuleRef::File(defined.file);
                        let accessed = self.find_accessed_module(access).unwrap_or(owner);
                        Interest::CalledBinding(defined, accessed)
                    }
                    false => Interest::Binding(defined),
                },
                Some(Member::Undefined | Member::Marker(_) | Member::OnObject) => continue,
                None => match (
                    graph.member_binding(self.file, access),
                    self.find_accessed_module(access),
                ) {
                    (
                        Some(
                            ImportBinding::Synthetic(export)
                            | ImportBinding::CapturedBuiltin { export, .. },
                        ),
                        Some(accessed),
                    ) if graph.shape(accessed) == Shape::EsModule => match self.is_called(access) {
                        true => Interest::CalledName(export, accessed),
                        false => Interest::Name(export, accessed),
                    },
                    (
                        Some(
                            binding @ (ImportBinding::Namespace { .. }
                            | ImportBinding::NamespaceRead { .. }
                            | ImportBinding::Exports { .. }),
                        ),
                        accessed,
                    ) => {
                        if let (ImportBinding::Namespace { module, .. }, Some(accessed)) =
                            (binding, accessed)
                            && module_with_code(accessed) != module_with_code(module)
                        {
                            let handed_on = Interest::HandedOnNamespace(module_with_code(module));
                            self.add_interest(hir[access].pos, handed_on);
                        }
                        let written_on = graph.find_module_accessed(self.file, access);
                        if let Some(holder) = self.find_file_between(binding, written_on)
                            && let Some((_, MemberKey::Name(name))) = hir.member_key(access)
                        {
                            let read = Interest::Export(ModuleRef::File(holder), name);
                            self.add_interest(hir[access].pos, read);
                        }
                        match binding {
                            ImportBinding::Namespace { module, .. }
                                if self.is_object_of_bound_member(access) =>
                            {
                                Interest::Evaluation(module)
                            }
                            _ => match self.interest_in_import(binding, Some(access), accessed) {
                                Some(interest) => interest,
                                None => continue,
                            },
                        }
                    }
                    _ => continue,
                },
            };
            self.add_interest(hir[access].pos, interest);
        }
    }

    fn has_found(&self, required: &RequiredName) -> bool {
        let graph = self.input.graph;
        let has_record = matches!(required.module, ModuleRef::File(file) if graph.has_record(file));
        required.is_found_unless_mocked
            || (has_record
                && graph.lists_export(required.module, required.name, &self.input.files.atoms))
    }

    fn add_requests(&mut self) {
        let graph = self.input.graph;
        let started_by_runner = self.input.files_started_by_runner;
        let is_started_by_runner = started_by_runner.binary_search(&self.file).is_ok();
        let keeps_every_file = is_started_by_runner || graph.load_failure(self.file).is_some();
        for request in graph.requests(self.file) {
            if request.kind == ModuleRequestKind::Require {
                continue;
            }
            if request.phase == ImportPhase::Defer {
                self.add_file_loaded_by_call(request.target);
            }
            let is_file = matches!(request.target, ModuleRef::File(_) | ModuleRef::Face(_));
            if (keeps_every_file && is_file) || runs_when_imported(graph, request.target) {
                self.units.interests[TOP_LEVEL as usize].push(Interest::Request(request.target));
            }
        }
        let folders = graph.folders_of_databases();
        let mut entry_points = self.input.sources.entry_points().iter();
        if !folders.is_empty() && entry_points.any(|entry_point| entry_point.file == self.file) {
            for &folder in folders {
                let folder = ModuleRef::File(folder);
                self.add_file_loaded_by_call(folder);
                self.units.interests[TOP_LEVEL as usize].push(Interest::Evaluation(folder));
            }
        }
        for site in self.input.files.analysis(self.file).import_sites {
            if let ImportSiteKind::ExportStar(_) = site.kind
                && let Some(SiteAnswer::Module(ModuleRef::File(target))) =
                    graph.find_site_answer(self.file, site.kind)
            {
                self.units.star_targets.push(target);
                if graph.has_record(target) && graph.has_no_side_effects(target) {
                    self.units.interests[TOP_LEVEL as usize].push(Interest::Star(target));
                }
            }
        }
        for required in graph.required_names(self.file) {
            if let ModuleRef::File(exporter) = required.module {
                let interest = Interest::RequiredName(exporter, required.name);
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
            if !self.has_found(required) {
                let interest = Interest::Request(required.module);
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
        for &(exporter, name) in graph.names_searched_behind_stars(self.file) {
            let interest = Interest::RequiredName(exporter, name);
            self.units.interests[TOP_LEVEL as usize].push(interest);
        }
        let implied = self
            .input
            .files
            .compiled(self.file)
            .map_or(&[][..], |it| it.implied_answers);
        for answer in implied {
            if let CodeAnswer::File(target) = *answer {
                let interest = Interest::EveryExport(ModuleRef::File(target));
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
    }

    fn add_starts_of_workers(&mut self) {
        let (file, starts) = (self.file, self.input.starts_of_workers);
        let starts = &starts[starts.partition_point(|start| start.0 < file)..];
        let decisions = &self.input.files.analysis(file).decisions;
        for &(_, at, entry_point) in starts.iter().take_while(|start| start.0 == file) {
            if !decisions.is_dead_expr(at) {
                let interest = Interest::EveryExport(ModuleRef::File(entry_point));
                self.add_interest(self.hir[at].pos, interest);
            }
        }
    }

    fn find_sites(&mut self) {
        let decisions = &self.input.files.analysis(self.file).decisions;
        for call in self.expressions() {
            if !matches!(self.hir[call].kind, ExprKind::Call(_)) || decisions.is_dead_expr(call) {
                continue;
            }
            if let Some(Site::Evaluate { target, .. }) = self.input.graph.site(self.file, call) {
                self.sites.push((call, target));
            }
        }
    }

    fn find_names_read_by_pattern(&self, call: ExprId) -> SmallVec<[Atom; 4]> {
        let hir = self.hir;
        let (_, Parent::VarInit(declaration)) = self.find_parent(call) else {
            return SmallVec::new();
        };
        let PatKind::Object(properties) = hir[hir[declaration].pat].kind else {
            return SmallVec::new();
        };
        let keys = properties.iter().map(|property| hir[property].key);
        keys.filter_map(|key| match key {
            PropKey::Name(name) => Some(name),
            _ => None,
        })
        .collect()
    }

    fn add_file_loaded_by_call(&mut self, target: ModuleRef) {
        if let ModuleRef::File(target) | ModuleRef::Face(target) = target {
            self.units.loaded_by_calls.push(target);
        }
    }

    fn add_sites(&mut self) {
        let graph = self.input.graph;
        for (call, target) in take(&mut self.sites) {
            let region = self.region_of(self.hir[call].pos);
            let referrer = self.module_at(region);
            let gives_object = !matches!(target, ModuleRef::Inner { .. })
                || graph.shape(target) != Shape::EsModule;
            let is_read_as_value = gives_object && graph.is_site_read_as_value(self.file, call);
            let names = match is_read_as_value {
                true => None,
                false => Some(self.find_names_read_by_pattern(call)),
            };
            self.add_file_loaded_by_call(target);
            let interests = &mut self.units.interests[region as usize];
            interests.push(Interest::Require { referrer, target });
            match names {
                Some(names) => {
                    interests.extend(names.into_iter().map(|name| Interest::Export(target, name)));
                }
                None => interests.push(Interest::EveryExport(target)),
            }
        }
    }

    fn add_holders(&mut self) {
        for holder in self.input.graph.holders(self.file) {
            if !holder.is_needed_as_value {
                continue;
            }
            let interest = Interest::EveryExport(module_of_view(holder.view));
            match holder.call.is_none() {
                true => self.units.interests[TOP_LEVEL as usize].push(interest),
                false => self.add_interest(self.hir[holder.call].pos, interest),
            }
        }
    }

    fn find_names_read_from_load(&self, call: ExprId) -> Option<SmallVec<[Atom; 4]>> {
        let hir = self.hir;
        let (holder, is_awaited) = match self.bound.parent_of_expr(call) {
            Parent::Expr(awaited) if matches!(hir[awaited].kind, ExprKind::Await(_)) => {
                (awaited, true)
            }
            _ => (call, false),
        };
        let mut names = SmallVec::new();
        if is_awaited {
            names.push(known::then);
        }
        if let Some((member, name)) = self.find_member_read_from(holder) {
            if self.is_called(member) {
                return None;
            }
            names.push(name);
            return Some(names);
        }
        let Parent::VarInit(declaration) = self.bound.parent_of_expr(holder) else {
            return None;
        };
        let PatKind::Object(properties) = hir[hir[declaration].pat].kind else {
            return None;
        };
        for property in properties.iter() {
            match hir[property].key {
                PropKey::Name(name) if !hir[property].is_rest => names.push(name),
                _ => return None,
            }
        }
        (!names.is_empty()).then_some(names)
    }

    fn find_live_site(&self, index: u32) -> Option<(Option<ExprId>, usize)> {
        let analysis = self.input.files.analysis(self.file);
        let call = analysis.import_sites[index as usize].kind.call();
        if call.is_some_and(|call| analysis.decisions.is_dead_expr(call)) {
            return None;
        }
        let region = call.map_or(TOP_LEVEL, |call| self.region_of(self.hir[call].pos));
        Some((call, region as usize))
    }

    fn add_loads_by_unknown_names(&mut self) {
        let Some(source) = parsed_source(self.input.files, self.file) else {
            self.units.interests[TOP_LEVEL as usize].push(Interest::LoadByUnknownName);
            return;
        };
        let names = &source.contents.names;
        for &site in &names.unknown_names_at {
            let Some((call, region)) = self.find_live_site(site) else {
                continue;
            };
            let names_read = call.and_then(|call| self.find_names_read_from_load(call));
            let interests = &mut self.units.interests[region];
            match names_read {
                Some(names_read) => {
                    let names_read = names_read.into_iter();
                    interests.extend(names_read.map(Interest::NameReadFromLoadByUnknownName));
                }
                None => interests.push(Interest::LoadByUnknownName),
            }
        }
        let load_of_missing_file = match self.input.isolates_code_from_disk {
            true => Interest::LoadOfIsolatedCode,
            false => Interest::LoadByUnknownName,
        };
        for &site in &names.files_missing_at_build_at {
            if let Some((_, region)) = self.find_live_site(site) {
                self.units.interests[region].push(load_of_missing_file);
            }
        }
        let has_no_place = names.loads_by_unknown_name && names.unknown_names_at.is_empty();
        if source.builtins.loads_unknown_modules() || has_no_place {
            self.units.interests[TOP_LEVEL as usize].push(Interest::LoadByUnknownName);
        }
    }

    fn add_loads(&mut self) {
        let graph = self.input.graph;
        let analysis = self.input.files.analysis(self.file);
        for site in analysis.import_sites {
            let (call, is_object_followed) = match site.kind {
                ImportSiteKind::ImportEquals(declaration) => {
                    let site = graph.import_equals_site(self.file, declaration);
                    if let Some(Site::Evaluate { target, .. }) = site {
                        self.add_file_loaded_by_call(target);
                        let referrer = ModuleRef::File(self.file);
                        let name = self.bound.declared_symbol(Decl::ImportEquals(declaration));
                        let interests = &mut self.units.interests[TOP_LEVEL as usize];
                        interests.push(Interest::Require { referrer, target });
                        if graph.holder(self.file, name).is_none() {
                            interests.push(Interest::EveryExport(target));
                        }
                        continue;
                    }
                    (None, false)
                }
                ImportSiteKind::MockModule(call) => {
                    if analysis.decisions.is_dead_expr(call) {
                        continue;
                    }
                    let interests = self.region_of(self.hir[call].pos) as usize;
                    let interests = &mut self.units.interests[interests];
                    match graph.find_site_answer(self.file, site.kind) {
                        Some(SiteAnswer::Module(target)) => {
                            interests.push(Interest::EveryExport(target));
                        }
                        Some(SiteAnswer::Computed(_)) => {
                            let files = self.input.files.compiled_files().iter();
                            let modules = files.map(|&file| ModuleRef::File(file));
                            interests.extend(modules.map(Interest::EveryExport));
                        }
                        Some(SiteAnswer::Failed(_) | SiteAnswer::Erased) | None => {}
                    }
                    continue;
                }
                ImportSiteKind::ImportCall(call)
                | ImportSiteKind::GetBuiltinModule(call)
                | ImportSiteKind::RequireResolve(call)
                | ImportSiteKind::ImportMetaResolve(call)
                | ImportSiteKind::ImportByTestRunner(call)
                | ImportSiteKind::RequireByTestRunner(call) => (Some(call), false),
                ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                    if let Some(Site::Evaluate { .. }) = graph.site(self.file, call) {
                        continue;
                    }
                    (Some(call), true)
                }
                _ => continue,
            };
            if call.is_some_and(|call| analysis.decisions.is_dead_expr(call)) {
                continue;
            }
            let region = call.map_or(TOP_LEVEL, |call| self.region_of(self.hir[call].pos)) as usize;
            match graph.find_site_answer(self.file, site.kind) {
                Some(SiteAnswer::Module(target)) => {
                    self.add_file_loaded_by_call(target);
                    self.units.interests[region].push(Interest::Evaluation(target));
                    if let ImportSiteKind::ImportCall(call) = site.kind {
                        let mut interests = take(&mut self.units.interests[region]);
                        let is_read_by_names =
                            self.add_names_read_from_awaited_import(target, call, &mut interests);
                        self.units.interests[region] = interests;
                        if is_read_by_names {
                            continue;
                        }
                    }
                    let interest = match call {
                        Some(call) if is_object_followed => {
                            self.units.interests[region].push(Interest::AnswerOfLoader(target));
                            self.interest_in_module_object(target, call)
                        }
                        Some(_) | None => Interest::EveryExport(target),
                    };
                    self.units.interests[region].push(interest);
                }
                Some(SiteAnswer::Computed(Candidates::Modules(candidates))) => {
                    for candidate in candidates {
                        self.add_file_loaded_by_call(candidate.module);
                    }
                    if is_object_followed {
                        let referrer = self.module_at(region as u32);
                        let required = candidates.iter().map(|it| Interest::Require {
                            referrer,
                            target: it.module,
                        });
                        self.units.interests[region].extend(required);
                    }
                    let exports = candidates.iter().map(|it| Interest::EveryExport(it.module));
                    self.units.interests[region].extend(exports);
                    let left_to_loader = candidates.iter().filter_map(|it| match it.module {
                        ModuleRef::File(file) if it.is_left_to_loader => {
                            Some(Interest::FileLeftToLoader(file))
                        }
                        _ => None,
                    });
                    self.units.interests[region].extend(left_to_loader);
                    if !matches!(site.kind, ImportSiteKind::ImportCall(_)) {
                        let asked_for = candidates.iter().filter_map(|it| match it.module {
                            ModuleRef::File(file) if !it.is_left_to_loader => {
                                Some(Interest::FileThatComputedNameMayAskFor(file))
                            }
                            _ => None,
                        });
                        self.units.interests[region].extend(asked_for);
                    }
                }
                Some(
                    SiteAnswer::Computed(Candidates::All)
                    | SiteAnswer::Failed(_)
                    | SiteAnswer::Erased,
                )
                | None => {}
            }
        }
    }

    fn is_folded_away(&self, expression: ExprId) -> bool {
        let decisions = &self.input.files.analysis(self.file).decisions;
        let mut node = expression;
        loop {
            match decisions.decision(node) {
                Decision::Constant(_) | Decision::Data(_) => return true,
                Decision::Unknown | Decision::GlobalPath(_) | Decision::DeferredData => {}
            }
            let Parent::Expr(parent) = self.bound.parent_of_expr(node) else {
                return false;
            };
            node = parent;
        }
    }

    fn add_module_objects(&mut self) {
        let Some(source) = parsed_source(self.input.files, self.file) else {
            return;
        };
        for mention in source.builtins.module_object_mentions() {
            let interest = Interest::ModuleObject(mention.owner, mention.object_use);
            if mention.expr.is_none() {
                self.units.interests[TOP_LEVEL as usize].push(interest);
            } else if !self.is_folded_away(mention.expr) {
                self.add_interest(self.hir[mention.expr].pos, interest);
            }
        }
        for &entry in source.builtins.entries_deleted_from_module_cache() {
            let interest = Interest::DeletionFromModuleCache(entry);
            self.add_interest(self.hir[entry].pos, interest);
        }
        for &entry in source.builtins.entries_stored_in_module_cache() {
            let interest = Interest::StoreIntoModuleCache(entry);
            self.add_interest(self.hir[entry].pos, interest);
        }
        for &place in source.builtins.places_that_hand_module_cache_on() {
            let interest = Interest::ModuleCacheHandedOn(place);
            self.add_interest(self.hir[place].pos, interest);
        }
        let only_reads_entries = source.builtins.keys_taken_out_of_module_cache().is_empty()
            && !source.builtins.loses_sight_of_module_cache();
        if source.builtins.reaches_module_cache()
            && (self.input.graph.lists_files_in_cache() || !only_reads_entries)
        {
            self.units.interests[TOP_LEVEL as usize].push(Interest::EntryOfModuleCache);
        }
    }

    fn skip_variables(&self, expression: ExprId, seen: &mut SmallVec<[SymbolId; 4]>) -> ExprId {
        let (hir, bound) = (self.hir, self.bound);
        let mut current = hir.skip_type_assertions(expression);
        loop {
            if !matches!(hir[current].kind, ExprKind::Ident(_))
                || bound
                    .dynamic_lookup_scope(NodeData::Expr(current))
                    .is_some()
            {
                return current;
            }
            let Binding::Symbol(symbol) = bound.binding(current) else {
                return current;
            };
            let BindingInitializer::Expression(initializer) =
                bound.binding_initializer(hir, symbol)
            else {
                return current;
            };
            if seen.contains(&symbol) {
                return current;
            }
            seen.push(symbol);
            current = hir.skip_type_assertions(initializer);
        }
    }

    fn find_value_shown_as_default(
        &self,
        object: ExprId,
        seen: &mut SmallVec<[SymbolId; 4]>,
    ) -> Option<ExprId> {
        let hir = self.hir;
        let ExprKind::Call(call) = hir[self.skip_variables(object, seen)].kind else {
            return None;
        };
        let helpers = self.input.known_helpers;
        let input = known_helpers::ResolveInput {
            files: self.input.files,
            modules: self.input.graph,
            helpers,
        };
        let callee = resolve_callee(&input, self.file, hir[call].callee)?;
        match callee.helper(helpers)? {
            Helper::ToEsModule | Helper::ImportStar | Helper::ImportDefault => {
                hir.ids(hir[call].args).next()
            }
            _ => None,
        }
    }

    fn find_builtin_behind(
        &self,
        source: &ParsedSource,
        expression: ExprId,
        seen: &mut SmallVec<[SymbolId; 4]>,
    ) -> Option<BuiltinId> {
        let hir = self.hir;
        let written = hir.skip_type_assertions(expression);
        if let Some(builtin) = source.builtins.builtin_of_expression(written) {
            return Some(builtin);
        }
        let held = self.skip_variables(written, seen);
        if let Some(builtin) = source.builtins.builtin_of_expression(held) {
            return Some(builtin);
        }
        let (object, MemberKey::Name(name)) = hir.member_key(held)? else {
            return None;
        };
        if name == known::default
            && let Some(value) = self.find_value_shown_as_default(object, seen)
        {
            return self.find_builtin_behind(source, value, seen);
        }
        let holder = table::canonical_id(self.find_builtin_behind(source, object, seen)?);
        let name = table::find_name(self.input.files.atoms.bytes(name))?;
        match table::member(holder, name) {
            MemberLookup::Found(member) => Some(member),
            MemberLookup::Unknown | MemberLookup::Absent => None,
        }
    }

    fn add_stores_of_loader_functions(&mut self) {
        let (files, hir) = (self.input.files, self.hir);
        let Some(source) = parsed_source(files, self.file) else {
            return;
        };
        let decisions = &files.analysis(self.file).decisions;
        for &table in source.builtins.tables_of_loaders_written() {
            if !decisions.is_dead_expr(table) && !self.is_folded_away(table) {
                self.add_interest(hir[table].pos, Interest::StoreOfLoaderFunction(None));
            }
        }
        let mut mentioned = source.builtins.mentioned().iter();
        if !mentioned.any(|&builtin| table::canonical_id(builtin) == BuiltinId::NodeModule) {
            return;
        }
        for expression in self.expressions() {
            let ExprKind::Assign { target, .. } = hir[expression].kind else {
                continue;
            };
            if decisions.is_dead_expr(expression) {
                continue;
            }
            let stored = self.find_builtin_behind(source, target, &mut SmallVec::new());
            if let Some(stored) = stored.filter(|&stored| is_loader_function(stored))
                && !self.is_folded_away(expression)
            {
                let replaced = LoaderHook::find(stored).map(|hook| (expression, hook));
                let interest = Interest::StoreOfLoaderFunction(replaced);
                self.add_interest(hir[expression].pos, interest);
            }
        }
    }

    fn add_files_spelled(&mut self) {
        for text in self.input.graph.texts_that_spell_files_in(self.file) {
            self.add_interest(self.hir[text.text].pos, Interest::FileSpelled(text.spelled));
        }
    }

    fn scan(mut self, asks_what_files_spell: bool) -> FileUnits {
        let jsx_takes_this = self.input.files.analysis(self.file).jsx_takes_this();
        self.units.this_positions = ThisPositions::of(self.hir, jsx_takes_this);
        self.find_sites();
        self.collect_units();
        let region_count = self.units.units.len() + 1;
        self.units.interests = vec![Vec::new(); region_count];
        self.units.is_region_reached = (0..region_count).map(|_| AtomicBool::new(false)).collect();
        for (first, second) in take(&mut self.units_reached_together) {
            self.units.interests[first as usize + 1].push(Interest::Piece(second));
        }
        self.add_references();
        self.add_members();
        self.add_requests();
        self.add_sites();
        self.add_holders();
        self.add_loads();
        self.add_loads_by_unknown_names();
        if asks_what_files_spell {
            self.add_files_spelled();
        }
        self.add_starts_of_workers();
        self.add_module_objects();
        self.add_stores_of_loader_functions();
        self.add_imports_of_elements();
        self.drop_repeated_interests();
        self.units
    }

    fn drop_repeated_interests(&mut self) {
        let mut seen: FxHashSet<Interest> = FxHashSet::default();
        for interests in &mut self.units.interests {
            if interests.len() < 2 {
                continue;
            }
            if interests.len() <= MOST_COMPARED_ONE_BY_ONE {
                let mut kept = 0;
                for at in 0..interests.len() {
                    let interest = interests[at];
                    if !interests[..kept].contains(&interest) {
                        interests[kept] = interest;
                        kept += 1;
                    }
                }
                interests.truncate(kept);
                continue;
            }
            seen.clear();
            interests.retain(|&interest| seen.insert(interest));
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum HandedOn {
    Variable(Sym),
    Name(SyntheticExportId),
    Namespace(ModuleRef),
}

impl HandedOn {
    fn of(binding: ExportBinding) -> HandedOn {
        match binding {
            ExportBinding::Variable(defined) => HandedOn::Variable(defined),
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                HandedOn::Namespace(module_with_code(module))
            }
            ExportBinding::Synthetic(export) => HandedOn::Name(export),
        }
    }
}

fn runs_when_imported(graph: &ModuleGraph, module: ModuleRef) -> bool {
    match module {
        ModuleRef::File(file) | ModuleRef::Face(file) => {
            !graph.has_record(file) || !graph.has_no_side_effects(file)
        }
        ModuleRef::Inner { .. } | ModuleRef::Check(_) => true,
        ModuleRef::Runtime(_) | ModuleRef::External { .. } => false,
    }
}

fn find_quiet_file(graph: &ModuleGraph, module: ModuleRef) -> Option<FileId> {
    match module {
        ModuleRef::File(file) | ModuleRef::Face(file) if !runs_when_imported(graph, module) => {
            Some(file)
        }
        _ => None,
    }
}

#[derive(Copy, Clone)]
struct Exporter {
    file: FileId,
    is_by_star: bool,
}

fn find_exporter(exporters: &[Exporter], file: FileId) -> Option<Exporter> {
    let position = exporters.binary_search_by_key(&file, |exporter| exporter.file);
    position.ok().map(|position| exporters[position])
}

fn set_mark(mark: &AtomicBool) -> bool {
    !mark.load(Ordering::SeqCst) && !mark.swap(true, Ordering::SeqCst)
}

fn is_marked(mark: &AtomicBool) -> bool {
    mark.load(Ordering::SeqCst)
}

struct SharedSet<K>(ShardedMap<K, AtomicBool>);

impl<K> Default for SharedSet<K> {
    fn default() -> SharedSet<K> {
        SharedSet(ShardedMap::default())
    }
}

impl<K: Hash + Eq> SharedSet<K> {
    fn insert(&self, key: K) -> bool {
        if self.0.get_ref(&key).is_some() {
            return false;
        }
        let is_taken = self.0.insert_ref(key, AtomicBool::new(false));
        !is_taken.swap(true, Ordering::Relaxed)
    }

    fn contains(&self, key: &K) -> bool {
        self.0.get_ref(key).is_some()
    }
}

#[derive(Copy, Clone)]
enum Step {
    Enter(FileId, u32),
    FollowLook(ModuleRef),
}

const FEWEST_STEPS_OF_A_ROUND: usize = if cfg!(test) { 2 } else { 512 };
const FEWEST_STEPS_OF_A_TASK: usize = if cfg!(test) { 1 } else { 16 };
const TASKS_OF_A_LARGE_ROUND: usize = 4096;

#[derive(Default)]
struct Found {
    steps: Vec<Step>,
    names_awaiting_exporter: Vec<(FileId, Atom)>,
    members_read: Vec<(Sym, FileId)>,
    loads_by_unknown_names: Vec<(FileId, Option<Atom>)>,
    files_spelled: Vec<(FileId, FileId)>,
    files_left_to_loader: Vec<FileId>,
    loads_isolated_code: bool,
    files_naming_ways: Vec<FileId>,
    replaced_loader_hooks: Vec<ReplacedLoaderHook>,
    deletions_from_module_cache: Vec<(FileId, ExprId)>,
    stores_into_module_cache: Vec<(FileId, ExprId)>,
    places_that_hand_module_cache_on: Vec<(FileId, ExprId)>,
    stores_loader_function: bool,
    files_that_computed_names_may_ask_for: Vec<FileId>,
    readers_of_built_in_modules: Vec<(FileId, RuntimeModule)>,
}

impl Found {
    fn append(&mut self, mut other: Found) {
        self.names_awaiting_exporter
            .append(&mut other.names_awaiting_exporter);
        self.members_read.append(&mut other.members_read);
        self.loads_by_unknown_names
            .append(&mut other.loads_by_unknown_names);
        self.files_spelled.append(&mut other.files_spelled);
        self.files_left_to_loader
            .append(&mut other.files_left_to_loader);
        self.loads_isolated_code |= other.loads_isolated_code;
        self.files_naming_ways.append(&mut other.files_naming_ways);
        self.replaced_loader_hooks
            .append(&mut other.replaced_loader_hooks);
        self.deletions_from_module_cache
            .append(&mut other.deletions_from_module_cache);
        self.stores_into_module_cache
            .append(&mut other.stores_into_module_cache);
        self.places_that_hand_module_cache_on
            .append(&mut other.places_that_hand_module_cache_on);
        self.stores_loader_function |= other.stores_loader_function;
        self.files_that_computed_names_may_ask_for
            .append(&mut other.files_that_computed_names_may_ask_for);
        self.readers_of_built_in_modules
            .append(&mut other.readers_of_built_in_modules);
    }

    fn holds_what_waits(&self) -> bool {
        !self.names_awaiting_exporter.is_empty()
            || !self.members_read.is_empty()
            || !self.loads_by_unknown_names.is_empty()
            || !self.files_spelled.is_empty()
            || !self.files_left_to_loader.is_empty()
            || (self.stores_loader_function
                && !self.files_that_computed_names_may_ask_for.is_empty())
    }
}

struct Walk<'a, 's> {
    input: &'a ProgramReachInput<'a, 's>,
    files: Vec<Option<FileUnits>>,
    exporters: FxHashMap<HandedOn, SmallVec<[Exporter; 2]>>,
    is_barrel: Vec<bool>,
    is_run_by_call: Vec<bool>,
    waits_for_call: Vec<bool>,
    takers: FxHashMap<ModuleRef, SmallVec<[ModuleRef; 2]>>,
    commonjs_file_may_be_main: bool,
    any_file_may_be_main: bool,
    every_file_has_module_object: bool,
    run_by_statements: SharedSet<(FileId, FileId)>,
    followed_imports: SharedSet<(FileId, HandedOn)>,
    names_looked_for: SharedSet<(FileId, Atom)>,
    names_read_from_objects: SharedSet<(FileId, Atom)>,
    names_asked_of_stars: SharedSet<(FileId, Atom)>,
    bound_variables: SharedSet<Sym>,
    reached_bindings: ShardedMap<Sym, bool>,
    keeps_every_module_object: AtomicBool,
    required: SharedSet<(ModuleRef, ModuleRef)>,
    objects_handed_on: SharedSet<Sym>,
    members_read: SharedSet<(Sym, FileId)>,
    names_awaiting_exporter: FxHashMap<FileId, Vec<Atom>>,
    files_reading_members: FxHashMap<Sym, SmallVec<[FileId; 2]>>,
    enums_relying_on: FxHashMap<Sym, SmallVec<[Sym; 2]>>,
}

#[derive(Default)]
struct LoadsByUnknownNames<'a> {
    is_any_reached: bool,
    packages: FxHashSet<&'a [u8]>,
    files_named_at_run_time: Option<FilesNamedAtRunTime<'a>>,
    files_spelled: Vec<(FileId, FileId)>,
    looks_at_every_export: bool,
    names_read: Vec<Atom>,
    files_found: Vec<FileId>,
    is_found: FxHashSet<FileId>,
}

struct Reacher<'w, 'a, 's> {
    walk: &'w Walk<'a, 's>,
    found: &'w mut Found,
}

impl<'a, 's> Walk<'a, 's> {
    fn new(input: &'a ProgramReachInput<'a, 's>, in_parallel: InParallel<'_>) -> Walk<'a, 's> {
        let compiled = input.files.compiled_files().iter().copied();
        let mut scans: Vec<(FileId, Option<FileUnits>)> = compiled
            .filter(|&file| input.sources.kind(file) == SourceKind::Program)
            .map(|file| (file, None))
            .collect();
        let mut steps = StepClock::new(Stage::BindModules);
        let mut largest_first: Vec<&mut (FileId, Option<FileUnits>)> = scans.iter_mut().collect();
        largest_first.sort_by_u64(|scan| {
            let size = input.files.hir(scan.0).exprs.len() as u32;
            number_of_pair(u32::MAX - size, scan.0.idx() as u32)
        });
        let asks_what_files_spell = asks_what_files_spell(input);
        for_each_mut(&mut largest_first, in_parallel, &|scan| {
            let file_scan = FileScan::new(input, scan.0);
            scan.1 = Some(file_scan.scan(asks_what_files_spell));
        });
        steps.end("reach: scan files");
        let mut files: Vec<Option<FileUnits>> =
            (0..input.files.modules.len()).map(|_| None).collect();
        let scanned_files: Vec<FileId> = scans.iter().map(|&(file, _)| file).collect();
        for (file, units) in scans {
            files[file.idx()] = units;
        }
        let ((is_barrel, is_run_by_call), (exporters, takers)) = run_steps_beside(
            input.beside,
            &mut steps,
            ["reach: barrels, files run by calls", "who hands on what"],
            || {
                (
                    find_barrels(input, &files),
                    find_files_run_by_calls(input, &files),
                )
            },
            || find_who_hands_on_what(input, &files, &scanned_files),
        );
        let waits_for_call = (0..)
            .map(FileId)
            .zip(&is_run_by_call)
            .map(|(file, &is_run_by_call)| {
                is_run_by_call && find_quiet_file(input.graph, ModuleRef::File(file)).is_some()
            })
            .collect();
        let mut entry_points = input.sources.entry_points().iter();
        let mut sources = (input.files.compiled_files().iter())
            .filter_map(|&file| parsed_source(input.files, file));
        let any_file_may_be_main =
            sources.any(|source| source.builtins.may_store_path_of_main_module());
        let commonjs_file_may_be_main = any_file_may_be_main
            || entry_points
                .any(|entry_point| input.graph.kind(entry_point.file) == ModuleKind::CommonJs);
        let every_file_has_module_object = input.graph.lists_files_in_cache();
        Walk {
            input,
            files,
            exporters,
            is_barrel,
            is_run_by_call,
            waits_for_call,
            takers,
            commonjs_file_may_be_main,
            any_file_may_be_main,
            every_file_has_module_object,
            run_by_statements: SharedSet::default(),
            followed_imports: SharedSet::default(),
            names_looked_for: SharedSet::default(),
            names_read_from_objects: SharedSet::default(),
            names_asked_of_stars: SharedSet::default(),
            bound_variables: SharedSet::default(),
            reached_bindings: ShardedMap::default(),
            keeps_every_module_object: AtomicBool::new(false),
            required: SharedSet::default(),
            objects_handed_on: SharedSet::default(),
            members_read: SharedSet::default(),
            names_awaiting_exporter: FxHashMap::default(),
            files_reading_members: FxHashMap::default(),
            enums_relying_on: FxHashMap::default(),
        }
    }

    fn find_module(&self, module: ModuleRef) -> Option<(FileId, usize)> {
        let (file, callback) = match module {
            ModuleRef::File(file) | ModuleRef::Face(file) => (file, None),
            ModuleRef::Inner { file, callback } => (file, Some(callback)),
            ModuleRef::Check(_) | ModuleRef::Runtime(_) | ModuleRef::External { .. } => {
                return None;
            }
        };
        let units = self.files[file.idx()].as_ref()?;
        let index = match callback {
            Some(callback) => *units.inner_modules.get(&callback)? as usize,
            None => 0,
        };
        Some((file, index))
    }

    fn module_units(&self, (file, index): (FileId, usize)) -> &ModuleUnits {
        let units = self.files[file.idx()]
            .as_ref()
            .expect("a module of a scanned file");
        &units.modules[index]
    }

    fn has_stored_names(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(_) | ModuleRef::Inner { .. } => match self.input.graph.shape(module) {
                Shape::Names | Shape::Value => true,
                Shape::EsModule | Shape::AsToday => false,
            },
            _ => false,
        }
    }

    fn is_request_waiting(&self, file: FileId, target: ModuleRef) -> bool {
        let ModuleRef::File(target) = target else {
            return false;
        };
        let is_star_target = |units: &FileUnits| units.star_targets.contains(&target);
        if !self.is_barrel[file.idx()]
            || self.files[file.idx()].as_ref().is_some_and(is_star_target)
        {
            return false;
        }
        let comes_from_target = |defined: Sym| {
            let exporters = self.exporters.get(&HandedOn::Variable(defined));
            defined.file == target
                || exporters.is_some_and(|exporters| find_exporter(exporters, target).is_some())
        };
        let own_exports = self
            .input
            .graph
            .exports(file)
            .iter()
            .filter(|it| !it.is_from_star_export);
        own_exports.clone().any(|export| match export.binding {
            ExportBinding::Variable(defined) => comes_from_target(defined),
            ExportBinding::Namespace { module, .. } | ExportBinding::Indirect { module, .. } => {
                module == ModuleRef::File(target)
            }
            ExportBinding::Synthetic(export) => {
                self.input.graph.synthetic_export(export).module == ModuleRef::File(target)
            }
        })
    }

    fn reads_this(&self, file: FileId, function: FnId) -> bool {
        let (hir, bound) = (self.input.files.hir(file), self.input.files.bound(file));
        if hir.runtime_function_kind(function) == FnKind::Arrow {
            return false;
        }
        bound.fns[function.idx()].contains_this
            || bound
                .function_flags(function)
                .contains(FunctionFlags::HAS_DIRECT_EVAL)
            || match &self.files[file.idx()] {
                Some(units) => units.this_positions.evaluates_own_this(hir, function),
                None => {
                    let jsx_takes_this = self.input.files.analysis(file).jsx_takes_this();
                    evaluates_own_this(hir, function, jsx_takes_this)
                }
            }
    }

    fn can_read_this(&self, defined: Sym) -> bool {
        let Sym { file, id } = defined;
        let (hir, bound) = (self.input.files.hir(file), self.input.files.bound(file));
        if !bound.is_stable_binding(id) {
            return true;
        }
        match bound.binding_initializer(hir, id) {
            BindingInitializer::Function(function) => self.reads_this(file, function),
            BindingInitializer::Expression(initializer) => {
                match hir[hir.skip_type_assertions(initializer)].kind {
                    ExprKind::Fn(function) => self.reads_this(file, function),
                    ExprKind::Class(_) => false,
                    _ => true,
                }
            }
            BindingInitializer::Class(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_) => false,
            _ => true,
        }
    }

    fn is_body_reached(&self, found: (FileId, usize)) -> bool {
        let units = self.files[found.0.idx()]
            .as_ref()
            .expect("a module of a scanned file");
        is_marked(&units.is_region_reached[units.modules[found.1].body as usize])
    }

    fn find_commonjs_main(&self) -> Option<FileId> {
        let entry_points = self.input.sources.entry_points();
        self.input.graph.find_commonjs_main(entry_points)
    }

    fn may_have_module_object(&self, file: FileId, units: &FileUnits) -> bool {
        self.every_file_has_module_object
            || self.input.graph.shape(ModuleRef::File(file)) != Shape::EsModule
            || is_marked(&units.has_object_made_by_require)
    }

    fn loads_by_unknown_name_outside_units(&self, file: FileId) -> bool {
        self.files[file.idx()].is_none()
            && parsed_source(self.input.files, file).is_none_or(|source| {
                let names = &source.contents.names;
                names.loads_by_unknown_name
                    || source.builtins.loads_unknown_modules()
                    || !names.unknown_names_at.is_empty()
                    || (!self.input.isolates_code_from_disk
                        && !names.files_missing_at_build_at.is_empty())
            })
    }

    fn loads_isolated_code_outside_units(&self, file: FileId) -> bool {
        self.input.isolates_code_from_disk
            && self.files[file.idx()].is_none()
            && parsed_source(self.input.files, file)
                .is_some_and(|source| !source.contents.names.files_missing_at_build_at.is_empty())
    }

    fn note_enums_relied_on(&mut self, found: &mut Found, enumeration: Sym) {
        if !is_enum(self.input.files.bound(enumeration.file), enumeration.id) {
            return;
        }
        let known = KnownMemberValues::default();
        let relied_on = (self.input.known_objects(&known)).enums_relied_on(enumeration);
        let is_handed_on = |other: &Sym| self.objects_handed_on.contains(other);
        if relied_on.iter().any(is_handed_on) {
            let mut reacher = Reacher {
                walk: &*self,
                found,
            };
            reacher.hand_on_object(enumeration);
            return;
        }
        for other in relied_on {
            let relying = self.enums_relying_on.entry(other).or_default();
            relying.push(enumeration);
        }
    }

    fn keep_what_waits(&mut self, found: &mut Found, loads: &mut LoadsByUnknownNames<'a>) {
        while found.holds_what_waits() {
            for (exporter, name) in take(&mut found.names_awaiting_exporter) {
                if self.is_body_reached((exporter, 0)) {
                    let mut reacher = Reacher {
                        walk: &*self,
                        found: &mut *found,
                    };
                    reacher.reach_export(ModuleRef::File(exporter), name);
                } else {
                    self.names_awaiting_exporter
                        .entry(exporter)
                        .or_default()
                        .push(name);
                }
            }
            for (enumeration, file) in take(&mut found.members_read) {
                let is_met_before = self.objects_handed_on.contains(&enumeration)
                    || self.files_reading_members.contains_key(&enumeration);
                if !is_met_before {
                    self.note_enums_relied_on(found, enumeration);
                }
                if self.objects_handed_on.contains(&enumeration) {
                    let mut reacher = Reacher {
                        walk: &*self,
                        found: &mut *found,
                    };
                    reacher.follow(file, Interest::Binding(enumeration));
                } else {
                    let readers = self.files_reading_members.entry(enumeration).or_default();
                    readers.push(file);
                }
            }
            for (file, name_read) in take(&mut found.loads_by_unknown_names) {
                let mut reacher = Reacher {
                    walk: &*self,
                    found: &mut *found,
                };
                loads.is_any_reached = true;
                loads.hand_on_files_found(&mut reacher, file, name_read);
            }
            for (file, spelled) in take(&mut found.files_spelled) {
                let mut reacher = Reacher {
                    walk: &*self,
                    found: &mut *found,
                };
                loads.note_file_spelled(&mut reacher, file, spelled);
            }
            for file in take(&mut found.files_left_to_loader) {
                let mut reacher = Reacher {
                    walk: &*self,
                    found: &mut *found,
                };
                loads.take_file_found(&mut reacher, file);
            }
            if found.stores_loader_function {
                for file in take(&mut found.files_that_computed_names_may_ask_for) {
                    let mut reacher = Reacher {
                        walk: &*self,
                        found: &mut *found,
                    };
                    loads.take_file_found(&mut reacher, file);
                }
            }
        }
    }

    fn reach_where_the_program_starts(
        &self,
        found: &mut Found,
        loads: &mut LoadsByUnknownNames<'a>,
    ) {
        let input = self.input;
        let mut reacher = Reacher { walk: self, found };
        if input.files_are_named_out_of_sight {
            for file in input.graph.importers_of_uncompiled_code() {
                loads.hand_on_files_found(&mut reacher, file, None);
            }
        }
        if input.admits_inspector
            && let Some(&entry_point) = input.files.entry_points().first()
        {
            loads.hand_on_files_found(&mut reacher, entry_point, None);
        }
        for &file in input.files.compiled_files() {
            if self.loads_by_unknown_name_outside_units(file) {
                loads.hand_on_files_found(&mut reacher, file, None);
            }
            let module = ModuleRef::File(file);
            if input.mocks_any_module || input.graph.is_every_export_asked_for(module) {
                reacher.reach_every_export(module);
            }
        }
        let files = input.files.compiled_files().iter();
        let is_read_by_evaluated_text = files
            .filter_map(|&file| parsed_source(input.files, file))
            .any(|source| source.builtins.mentions_evaluator());
        if is_read_by_evaluated_text || input.graph.runs_code_out_of_sight() {
            reacher.hand_on_data_objects();
        }
        let is_read_by_code_from_disk = !input.files_started_by_runner.is_empty();
        let mut waits_for_start: Vec<FileId> = Vec::new();
        for &(file, _, entry_point) in input.starts_of_workers {
            match self.files[file.idx()].is_some() {
                true => waits_for_start.push(entry_point),
                false => reacher.reach_every_export(ModuleRef::File(entry_point)),
            }
        }
        for entry_point in input.sources.entry_points() {
            if !waits_for_start.contains(&entry_point.file) {
                reacher.reach_every_export(ModuleRef::File(entry_point.file));
            }
            if is_read_by_code_from_disk || is_read_by_evaluated_text {
                let owner = ModuleObjectOwner::EntryPoint;
                reacher.reach_module_object(entry_point.file, owner, ModuleObjectUse::HandedOn);
            }
        }
    }

    fn run_round(
        &self,
        lists: &[Vec<Step>],
        found: &mut Found,
        in_parallel: InParallel<'_>,
    ) -> Vec<Vec<Step>> {
        let count: usize = lists.iter().map(Vec::len).sum();
        let steps_of_a_task = FEWEST_STEPS_OF_A_TASK.max(count / TASKS_OF_A_LARGE_ROUND);
        let mut tasks: Vec<(&[Step], Found)> = lists
            .iter()
            .flat_map(|steps| steps.chunks(steps_of_a_task))
            .map(|steps| (steps, Found::default()))
            .collect();
        for_each_mut(&mut tasks, in_parallel, &|(steps, found)| {
            let mut reacher = Reacher { walk: self, found };
            for &step in steps.iter() {
                reacher.take_step(step);
            }
        });
        let mut found_lists = Vec::new();
        for (_, mut found_by_task) in tasks {
            if !found_by_task.steps.is_empty() {
                found_lists.push(take(&mut found_by_task.steps));
            }
            found.append(found_by_task);
        }
        found_lists
    }

    fn run(&mut self, in_parallel: InParallel<'_>) -> (Found, LoadsByUnknownNames<'a>, [usize; 3]) {
        let (mut found, mut loads) = (Found::default(), LoadsByUnknownNames::default());
        let [mut rounds, mut steps_of_rounds, mut other_steps] = [0; 3];
        let mut lists: Vec<Vec<Step>> = Vec::new();
        self.reach_where_the_program_starts(&mut found, &mut loads);
        loop {
            self.keep_what_waits(&mut found, &mut loads);
            let count = found.steps.len() + lists.iter().map(Vec::len).sum::<usize>();
            if count >= FEWEST_STEPS_OF_A_ROUND {
                rounds += 1;
                steps_of_rounds += count;
                lists.push(take(&mut found.steps));
                lists = self.run_round(&lists, &mut found, in_parallel);
            } else if !lists.is_empty() {
                found.steps.extend(lists.drain(..).flatten());
            } else if let Some(step) = found.steps.pop() {
                other_steps += 1;
                let mut reacher = Reacher {
                    walk: &*self,
                    found: &mut found,
                };
                reacher.take_step(step);
            } else {
                return (found, loads, [rounds, steps_of_rounds, other_steps]);
            }
        }
    }
}

impl<'a> LoadsByUnknownNames<'a> {
    fn hand_on_files_found(
        &mut self,
        reacher: &mut Reacher<'_, 'a, '_>,
        loading: FileId,
        name_read: Option<Atom>,
    ) {
        let input = reacher.walk.input;
        let package = package_of(input.files.module(loading).file_name());
        let is_first = self.packages.is_empty();
        let is_new_package = self.packages.insert(package);
        if is_first {
            reacher.hand_on_data_objects();
        }
        match name_read {
            Some(name) if !input.any_file_is_named_at_run_time => {
                if !self.names_read.contains(&name) {
                    self.names_read.push(name);
                    if !self.looks_at_every_export {
                        for &file in &self.files_found {
                            reacher.reach_name_read_from_load(ModuleRef::File(file), name);
                        }
                    }
                }
            }
            _ => {
                if !replace(&mut self.looks_at_every_export, true) {
                    for &file in &self.files_found {
                        reacher.reach_every_export(ModuleRef::File(file));
                    }
                }
            }
        }
        if !is_new_package || (!is_first && input.any_file_is_named_at_run_time) {
            return;
        }
        let found = match input.any_file_is_named_at_run_time {
            true => {
                let is_code = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Program;
                let code_files = input.files.compiled_files().iter().filter(is_code);
                code_files.copied().collect()
            }
            false => {
                assert!(
                    asks_what_files_spell(input),
                    "a load by a name that the build does not know, and no file was asked what it spells"
                );
                let spelled_before = &mut self.files_spelled;
                let named = self.files_named_at_run_time.get_or_insert_with(|| {
                    let mut named = FilesNamedAtRunTime::new(input);
                    for (file, spelled) in take(spelled_before) {
                        named.note_spelled(input, file, spelled);
                    }
                    named
                });
                named.find(package)
            }
        };
        for file in found {
            self.take_file_found(reacher, file);
        }
    }

    fn take_file_found(&mut self, reacher: &mut Reacher<'_, 'a, '_>, file: FileId) {
        if !self.is_found.insert(file) {
            return;
        }
        self.files_found.push(file);
        let module = ModuleRef::File(file);
        reacher.evaluate(module);
        reacher.reach_answer_of_loader(module);
        if self.looks_at_every_export {
            reacher.reach_every_export(module);
        } else {
            for &name in &self.names_read {
                reacher.reach_name_read_from_load(module, name);
            }
        }
    }

    fn note_file_spelled(
        &mut self,
        reacher: &mut Reacher<'_, 'a, '_>,
        file: FileId,
        spelled: FileId,
    ) {
        match &mut self.files_named_at_run_time {
            Some(named) => {
                if named.note_spelled(reacher.walk.input, file, spelled) {
                    self.take_file_found(reacher, spelled);
                }
            }
            None => self.files_spelled.push((file, spelled)),
        }
    }
}

impl Reacher<'_, '_, '_> {
    fn take_step(&mut self, step: Step) {
        match step {
            Step::Enter(file, region) => self.enter_region(file, region),
            Step::FollowLook(module) => self.follow_look(module),
        }
    }

    fn enter_region(&mut self, file: FileId, region: u32) {
        let walk = self.walk;
        let units = walk.files[file.idx()]
            .as_ref()
            .expect("a region of a scanned file");
        for &interest in &units.interests[region as usize] {
            self.follow(file, interest);
        }
        if let Some(index) = units.find_module_with_body(region) {
            self.enter_body((file, index));
        }
    }

    fn reach_region(&mut self, file: FileId, region: u32) {
        let walk = self.walk;
        let units = walk.files[file.idx()].as_ref();
        let unit = region.checked_sub(1);
        let enumeration = units
            .zip(unit)
            .and_then(|(units, unit)| units.enum_of_unit.get(&unit));
        if let Some(&id) = enumeration {
            self.hand_on_object(Sym { file, id });
        }
        self.run_region(file, region);
    }

    fn run_region(&mut self, file: FileId, region: u32) {
        let walk = self.walk;
        let Some(units) = &walk.files[file.idx()] else {
            return;
        };
        let mut region = region;
        while set_mark(&units.is_region_reached[region as usize]) {
            self.found.steps.push(Step::Enter(file, region));
            if region == TOP_LEVEL {
                break;
            }
            region = units.units[region as usize - 1].region_around;
        }
    }

    fn evaluate(&mut self, module: ModuleRef) {
        let walk = self.walk;
        match (walk.find_module(module), module) {
            (Some(found), _) => {
                let body = walk.module_units(found).body;
                self.reach_region(found.0, body);
            }
            (None, ModuleRef::Inner { file, .. }) => self.reach_region(file, TOP_LEVEL),
            (None, _) => {}
        }
    }

    fn note_statement_runs(&self, importer: FileId, module: ModuleRef) {
        if let ModuleRef::File(target) | ModuleRef::Face(target) = module
            && self.walk.waits_for_call[target.idx()]
        {
            self.walk.run_by_statements.insert((importer, target));
        }
    }

    fn reach_files_between(&mut self, importer: FileId, handed_on: HandedOn) {
        let walk = self.walk;
        let graph = walk.input.graph;
        let definer = match handed_on {
            HandedOn::Variable(defined) => ModuleRef::File(defined.file),
            HandedOn::Name(export) => graph.synthetic_export(export).module,
            HandedOn::Namespace(module) => module,
        };
        self.note_statement_runs(importer, definer);
        if matches!(handed_on, HandedOn::Variable(defined) if defined.file == importer) {
            return;
        }
        let Some(exporters) = walk.exporters.get(&handed_on) else {
            return;
        };
        if !walk.followed_imports.insert((importer, handed_on)) {
            return;
        }
        let mut is_led_by_statement = find_exporter(exporters, importer).is_some();
        for request in graph.requests(importer) {
            let (ModuleRef::File(target) | ModuleRef::Face(target)) = request.target else {
                continue;
            };
            if let Some(exporter) = find_exporter(exporters, target) {
                is_led_by_statement |= request.kind == ModuleRequestKind::Import;
                if !exporter.is_by_star
                    || !graph.has_no_side_effects(target)
                    || walk.is_run_by_call[target.idx()]
                {
                    self.note_statement_runs(importer, request.target);
                    self.evaluate(request.target);
                } else {
                    self.reach_imports_of_skipped_file(target);
                }
                self.reach_files_between(target, handed_on);
            }
        }
        if let ModuleRef::Runtime(module) = definer
            && is_led_by_statement
            && graph.kind(importer) != ModuleKind::CommonJs
        {
            let readers = &mut self.found.readers_of_built_in_modules;
            readers.push((importer, module));
        }
    }

    fn reach_files_behind_file_read_from(
        &mut self,
        accessed: ModuleRef,
        export: SyntheticExportId,
    ) {
        if let ModuleRef::File(accessed) | ModuleRef::Face(accessed) = accessed {
            self.reach_files_between(accessed, HandedOn::Name(export));
        }
    }

    fn reach_imports_of_skipped_file(&mut self, file: FileId) {
        let graph = self.walk.input.graph;
        for request in graph.requests(file) {
            if request.kind != ModuleRequestKind::Require
                && runs_when_imported(graph, request.target)
            {
                self.evaluate(request.target);
            }
        }
    }

    fn reach_exporter(&mut self, module: ModuleRef, binding: ExportBinding) {
        let ModuleRef::File(file) = module else {
            return;
        };
        let walk = self.walk;
        let handed_on = HandedOn::of(binding);
        let is_run_by_call = walk.is_run_by_call[file.idx()];
        let exporters = walk.exporters.get(&handed_on);
        let exporter = exporters.and_then(|exporters| find_exporter(exporters, file));
        if exporter.is_some_and(|exporter| !exporter.is_by_star || is_run_by_call) {
            self.evaluate(module);
        }
        self.reach_files_between(file, handed_on);
    }

    fn hand_on_object(&mut self, enumeration: Sym) {
        let walk = self.walk;
        let known = KnownMemberValues::default();
        let members = walk.input.known_objects(&known);
        let enumeration = match members.find_data_object_shared_by(enumeration) {
            Some(object) => object,
            None if is_enum(walk.input.files.bound(enumeration.file), enumeration.id) => {
                enumeration
            }
            None => return,
        };
        if !walk.objects_handed_on.insert(enumeration) {
            return;
        }
        let readers = walk.files_reading_members.get(&enumeration);
        for &reader in readers.into_iter().flatten() {
            self.follow(reader, Interest::Binding(enumeration));
        }
        let relying = walk.enums_relying_on.get(&enumeration);
        for &relying in relying.into_iter().flatten() {
            self.hand_on_object(relying);
        }
    }

    fn hand_on_data_objects(&mut self) {
        let input = self.walk.input;
        let known = KnownMemberValues::default();
        let members = input.known_objects(&known);
        for &file in input.files.compiled_files() {
            if let Some(object) = members.find_data_object(file) {
                self.hand_on_object(object);
            }
        }
    }

    fn reach_name_read_from_load(&mut self, module: ModuleRef, name: Atom) {
        if self.walk.has_stored_names(module_with_code(module)) {
            self.reach_every_export(module);
        } else {
            self.reach_export(module, name);
        }
    }

    fn look_up_in(&mut self, enumeration: Sym) {
        let Sym { file, id } = enumeration;
        let walk = self.walk;
        let files = walk.input.files;
        let unit = walk.files[file.idx()]
            .as_ref()
            .and_then(|units| units.find_unit(files.hir(file), files.bound(file), id));
        walk.bound_variables.insert(enumeration);
        self.run_region(file, unit.map_or(TOP_LEVEL, |unit| unit + 1));
    }

    fn reach_binding(&mut self, defined: Sym) -> bool {
        if let Some(&can_read_this) = self.walk.reached_bindings.get_ref(&defined) {
            return can_read_this;
        }
        self.hand_on_object(defined);
        let can_read_this = self.reach_new_binding(defined);
        self.walk
            .reached_bindings
            .insert_ref(defined, can_read_this);
        can_read_this
    }

    fn reach_new_binding(&mut self, defined: Sym) -> bool {
        let Sym { file, id } = defined;
        let walk = self.walk;
        if walk.files[file.idx()].is_some()
            && let Some(module) = find_module_imported_from(walk.input, file, id)
        {
            self.note_statement_runs(file, module);
        }
        match walk.input.graph.import_binding(file, id) {
            ImportBinding::Local
            | ImportBinding::Builtin(_)
            | ImportBinding::BuiltinMember { .. } => {}
            ImportBinding::Variable(elsewhere) if elsewhere != defined => {
                self.evaluate(ModuleRef::File(file));
                self.reach_files_between(file, HandedOn::Variable(elsewhere));
                return self.reach_binding(elsewhere);
            }
            ImportBinding::Namespace { module, .. } => {
                self.reach_every_export(module);
                return false;
            }
            ImportBinding::NamespaceRead { module, name } => {
                return self.reach_export(module, name);
            }
            ImportBinding::Synthetic(export) => {
                self.evaluate(ModuleRef::File(file));
                if let Some(module) = find_module_imported_from(walk.input, file, id) {
                    self.evaluate(module);
                }
                self.reach_files_between(file, HandedOn::Name(export));
                return self.reach_name(export);
            }
            ImportBinding::Exports { module } => {
                self.reach_every_export(module);
                return true;
            }
            _ => return true,
        }
        let files = walk.input.files;
        let unit = walk.files[file.idx()]
            .as_ref()
            .and_then(|units| units.find_unit(files.hir(file), files.bound(file), id));
        walk.bound_variables.insert(defined);
        self.reach_region(file, unit.map_or(TOP_LEVEL, |unit| unit + 1));
        walk.can_read_this(defined)
    }

    fn reach_tested_binding(&mut self, defined: Sym) {
        let Sym { file, id } = defined;
        let walk = self.walk;
        let files = walk.input.files;
        let defining_region = match walk.input.graph.import_binding(file, id) {
            ImportBinding::Local => walk.files[file.idx()].as_ref().and_then(|units| {
                let unit = units.find_unit(files.hir(file), files.bound(file), id)?;
                let unit = &units.units[unit as usize];
                unit.is_class.then_some(unit.region_around)
            }),
            _ => None,
        };
        match defining_region {
            Some(region) => {
                walk.bound_variables.insert(defined);
                self.reach_region(file, region);
            }
            None => {
                self.reach_binding(defined);
            }
        }
    }

    fn reach_export_binding(&mut self, binding: ExportBinding) -> bool {
        match binding {
            ExportBinding::Variable(defined) => self.reach_binding(defined),
            ExportBinding::Indirect { module, name } => self.reach_export(module, name),
            ExportBinding::Namespace { module, .. } => {
                self.reach_every_export(module);
                false
            }
            ExportBinding::Synthetic(export) => self.reach_name(export),
        }
    }

    fn reach_stored_name(&mut self, module: ModuleRef, name: Atom) -> bool {
        let walk = self.walk;
        self.evaluate(module);
        if let ModuleRef::File(file) = module {
            walk.names_read_from_objects.insert((file, name));
        }
        if let Some(found) = walk.find_module(module) {
            let units = walk.module_units(found).stores.get(&name);
            for &unit in units.into_iter().flatten() {
                self.reach_region(found.0, unit + 1);
            }
        }
        !walk.input.graph.ignores_this(module, name)
    }

    fn reach_files_behind(&mut self, module: ModuleRef, member: Member) {
        let (ModuleRef::File(file) | ModuleRef::Face(file) | ModuleRef::Inner { file, .. }) =
            module
        else {
            return;
        };
        match member {
            Member::Variable(export) | Member::Copy(export) => {
                self.reach_files_between(file, HandedOn::Name(export));
            }
            Member::Binding(defined) => {
                self.reach_files_between(file, HandedOn::Variable(defined));
            }
            Member::Undefined | Member::Marker(_) | Member::OnObject => {}
        }
    }

    fn reach_name(&mut self, export: SyntheticExportId) -> bool {
        let graph = self.walk.input.graph;
        let export = *graph.synthetic_export(export);
        if !self.walk.has_stored_names(export.module) {
            self.evaluate(export.module);
            return true;
        }
        let can_read_this = self.reach_stored_name(export.module, export.name);
        let commonjs = graph.commonjs();
        let returned = commonjs.member_behind_getter(export.module, export.name);
        if let Some(returned) = returned {
            self.reach_files_behind(export.module, returned);
        }
        match returned {
            Some(Member::Variable(returned)) => self.reach_name(returned),
            Some(Member::Binding(returned)) => self.reach_binding(returned),
            _ => can_read_this,
        }
    }

    fn reach_named_member(&mut self, module: ModuleRef, name: Atom) -> bool {
        self.evaluate(module);
        let graph = self.walk.input.graph;
        let member = graph.member_named(module, name);
        let member = member.or_else(|| graph.commonjs().member_named(module, name));
        if let Some(member) = member {
            self.reach_files_behind(module, member);
        }
        match member {
            Some(Member::Variable(export) | Member::Copy(export)) => self.reach_name(export),
            Some(Member::Binding(defined)) => self.reach_binding(defined),
            Some(Member::OnObject) => {
                self.look_at(module);
                false
            }
            Some(Member::Undefined | Member::Marker(_)) | None => false,
        }
    }

    fn read_name_from_files_that_hand_it_on(&self, file: FileId, name: Atom) {
        let walk = self.walk;
        let graph = walk.input.graph;
        let (mut file, mut name) = (file, name);
        while let Some((source, listed)) = graph.find_what_hands_on_names(file, name) {
            let ModuleRef::File(source) = source else {
                return;
            };
            if !walk.names_read_from_objects.insert((source, listed)) {
                return;
            }
            (file, name) = (source, listed);
        }
        for &(_, star) in graph.unlisted_stars_that_bring(file, name) {
            walk.names_read_from_objects.insert((star, name));
        }
        if !graph.is_brought_by_star(file, name) {
            return;
        }
        for &source in graph.files_named_by_stars(file) {
            if graph.lists_export(ModuleRef::File(source), name, &walk.input.files.atoms)
                && walk.names_read_from_objects.insert((source, name))
            {
                self.read_name_from_files_that_hand_it_on(source, name);
            }
        }
    }

    fn reach_export(&mut self, module: ModuleRef, name: Atom) -> bool {
        let walk = self.walk;
        let module = module_with_code(module);
        if let ModuleRef::File(file) = module
            && walk.names_read_from_objects.insert((file, name))
        {
            self.read_name_from_files_that_hand_it_on(file, name);
        }
        if walk.has_stored_names(module) {
            return self.reach_named_member(module, name);
        }
        match (walk.input.graph).find_export(module, name, &walk.input.files.atoms) {
            ExportLookup::Found(binding) => {
                if let (ExportBinding::Synthetic(copy), ModuleRef::File(file)) = (binding, module)
                    && walk.input.graph.commonjs().may_stay_empty(copy)
                    && let Some(units) = &walk.files[file.idx()]
                    && !units.star_targets.is_empty()
                    && walk.names_asked_of_stars.insert((file, name))
                {
                    self.evaluate(module);
                    for &target in &units.star_targets {
                        self.evaluate(ModuleRef::File(target));
                        self.reach_export(ModuleRef::File(target), name);
                    }
                }
                self.reach_exporter(module, binding);
                self.reach_export_binding(binding)
            }
            ExportLookup::Unknown => {
                self.reach_every_export(module);
                false
            }
            ExportLookup::Absent => {
                self.evaluate(module);
                false
            }
        }
    }

    fn look_at(&mut self, module: ModuleRef) {
        let walk = self.walk;
        let module = module_with_code(module);
        let Some(found) = walk.find_module(module) else {
            return;
        };
        if set_mark(&walk.module_units(found).is_every_export_reached) {
            self.found.steps.push(Step::FollowLook(module));
        }
    }

    fn reach_every_export(&mut self, module: ModuleRef) {
        self.evaluate(module);
        self.look_at_all_of(module);
    }

    fn look_at_all_of(&mut self, module: ModuleRef) {
        self.look_at(module);
        let walk = self.walk;
        if let ModuleRef::File(file) = module_with_code(module)
            && walk.files[file.idx()].is_none()
            && walk.input.graph.has_record(file)
        {
            for export in walk.input.graph.exports(file) {
                if let ExportBinding::Variable(variable) = export.binding {
                    self.hand_on_object(variable);
                }
            }
        }
    }

    fn reach_what_object_shows(&mut self, (file, index): (FileId, usize)) {
        let walk = self.walk;
        let graph = walk.input.graph;
        let shown = walk.module_units((file, index));
        if !set_mark(&shown.is_object_shown) {
            return;
        }
        let module = shown.module;
        let stores = shown.stores.values().flatten();
        for &unit in stores.chain(&shown.parts_of_object) {
            self.reach_region(file, unit + 1);
        }
        for &source in graph.name_sources(module) {
            self.reach_every_export(source);
        }
        if index != 0 {
            return;
        }
        for export in graph.exports(file) {
            self.read_name_from_files_that_hand_it_on(file, export.name);
            self.reach_files_between(file, HandedOn::of(export.binding));
            self.reach_export_binding(export.binding);
        }
        for request in graph.requests(file) {
            if request.is_dynamic_star_export {
                self.reach_every_export(request.target);
            }
        }
    }

    fn follow_look(&mut self, module: ModuleRef) {
        let walk = self.walk;
        if walk.has_stored_names(module) {
            for &taker in walk.takers.get(&module).into_iter().flatten() {
                self.look_at(taker);
            }
        }
        if let Some(found) = walk.find_module(module)
            && walk.is_body_reached(found)
        {
            return self.reach_what_object_shows(found);
        }
        for &source in walk.input.graph.name_sources(module) {
            self.look_at(source);
        }
    }

    fn enter_body(&mut self, found: (FileId, usize)) {
        let walk = self.walk;
        if found.1 == 0 {
            let awaited = walk.names_awaiting_exporter.get(&found.0);
            for &name in awaited.into_iter().flatten() {
                self.reach_export(ModuleRef::File(found.0), name);
            }
        }
        let entered = walk.module_units(found);
        let module = entered.module;
        if is_marked(&entered.is_every_export_reached) {
            self.reach_what_object_shows(found);
        } else if walk.has_stored_names(module) && walk.input.graph.shape(module) == Shape::Value {
            self.look_at(module);
        }
    }

    fn keep_module_object(&mut self, file: FileId) {
        let walk = self.walk;
        let units = walk.files[file.idx()].as_ref().expect("a scanned file");
        if set_mark(&units.keeps_module_object) {
            self.look_at(ModuleRef::File(file));
        }
    }

    fn keep_every_module_object(&mut self, file: FileId) {
        self.found.files_naming_ways.push(file);
        let walk = self.walk;
        if !set_mark(&walk.keeps_every_module_object) {
            return;
        }
        for (file, units) in (0..).map(FileId).zip(&walk.files) {
            if let Some(units) = units
                && walk.may_have_module_object(file, units)
            {
                self.look_at(ModuleRef::File(file));
            }
        }
        self.hand_on_data_objects();
    }

    fn note_answer_of_require(&mut self, referrer: ModuleRef, target: ModuleRef) {
        let walk = self.walk;
        if walk.any_file_may_be_main || walk.input.graph.shape(referrer) != Shape::EsModule {
            self.give_module_object(target);
        }
    }

    fn give_module_object(&mut self, module: ModuleRef) {
        let walk = self.walk;
        if let ModuleRef::File(file) | ModuleRef::Face(file) = module
            && let Some(units) = &walk.files[file.idx()]
            && set_mark(&units.has_object_made_by_require)
            && is_marked(&walk.keeps_every_module_object)
        {
            self.look_at(ModuleRef::File(file));
        }
    }

    fn reach_answer_of_loader(&mut self, module: ModuleRef) {
        self.give_module_object(module);
        let input = self.walk.input;
        let atoms = &input.files.atoms;
        let names = [Some(known::__esModule), atoms.lookup(b"module.exports")];
        for name in names.into_iter().flatten() {
            if let ExportLookup::Found(_) = input.graph.find_export(module, name, atoms) {
                self.reach_export(module, name);
            }
        }
    }

    fn reach_module_object(
        &mut self,
        file: FileId,
        owner: ModuleObjectOwner,
        object_use: ModuleObjectUse,
    ) {
        if owner == ModuleObjectOwner::EntryPoint && !self.walk.commonjs_file_may_be_main {
            return;
        }
        match (owner, object_use) {
            (_, ModuleObjectUse::Tested) => self.found.files_naming_ways.push(file),
            (ModuleObjectOwner::EntryPoint, _)
            | (
                _,
                ModuleObjectUse::ParentTested
                | ModuleObjectUse::Parent
                | ModuleObjectUse::Children
                | ModuleObjectUse::HandedOn
                | ModuleObjectUse::HolderHandedOn,
            ) => self.keep_every_module_object(file),
            (_, ModuleObjectUse::Field(ModuleField::Id))
                if self.walk.find_commonjs_main().is_none() =>
            {
                self.found.files_naming_ways.push(file);
            }
            (_, ModuleObjectUse::Field(_)) => {}
            (ModuleObjectOwner::OwnFile, ModuleObjectUse::Object) => self.keep_module_object(file),
            (ModuleObjectOwner::Related, ModuleObjectUse::Object) => {}
        }
    }

    fn follow(&mut self, file: FileId, interest: Interest) {
        let walk = self.walk;
        match interest {
            Interest::Unit(unit) => self.reach_region(file, unit + 1),
            Interest::Piece(unit) => self.run_region(file, unit + 1),
            Interest::LoadByUnknownName => self.found.loads_by_unknown_names.push((file, None)),
            Interest::NameReadFromLoadByUnknownName(name) => {
                self.found.loads_by_unknown_names.push((file, Some(name)));
            }
            Interest::LoadOfIsolatedCode => self.found.loads_isolated_code = true,
            Interest::FileSpelled(spelled) => self.found.files_spelled.push((file, spelled)),
            Interest::FileLeftToLoader(found) => self.found.files_left_to_loader.push(found),
            Interest::FileThatComputedNameMayAskFor(found) => {
                (self.found.files_that_computed_names_may_ask_for).push(found);
            }
            Interest::TestedBinding(defined) => {
                self.reach_files_between(file, HandedOn::Variable(defined));
                self.reach_tested_binding(defined);
            }
            Interest::KnownVariable(variable) => {
                self.reach_files_between(file, HandedOn::Variable(variable));
            }
            Interest::KnownMember(enumeration) => {
                self.reach_files_between(file, HandedOn::Variable(enumeration));
                if walk.input.graph.kind(enumeration.file) != ModuleKind::Data {
                    self.evaluate(ModuleRef::File(enumeration.file));
                }
                if walk.objects_handed_on.contains(&enumeration) {
                    self.follow(file, Interest::Binding(enumeration));
                } else if walk.members_read.insert((enumeration, file)) {
                    self.found.members_read.push((enumeration, file));
                }
            }
            Interest::Lookup(enumeration) => {
                self.reach_files_between(file, HandedOn::Variable(enumeration));
                self.look_up_in(enumeration);
            }
            Interest::HandedOnObject(enumeration) => self.hand_on_object(enumeration),
            Interest::Binding(defined) => {
                self.reach_files_between(file, HandedOn::Variable(defined));
                self.reach_binding(defined);
            }
            Interest::CalledBinding(defined, accessed) => {
                self.reach_files_between(file, HandedOn::Variable(defined));
                if self.reach_binding(defined) {
                    self.reach_every_export(accessed);
                }
            }
            Interest::Evaluation(module) => self.evaluate(module),
            Interest::Require { referrer, target } => {
                walk.required.insert((referrer, target));
                self.evaluate(target);
                self.note_answer_of_require(referrer, target);
            }
            Interest::AnswerOfLoader(target) => self.reach_answer_of_loader(target),
            Interest::Request(module) => {
                if !walk.is_request_waiting(file, module) {
                    self.note_statement_runs(file, module);
                    self.evaluate(module);
                }
            }
            Interest::Star(target) => {
                if walk.is_run_by_call[target.idx()] {
                    self.note_statement_runs(file, ModuleRef::File(target));
                    self.evaluate(ModuleRef::File(target));
                }
            }
            Interest::UsedImport(target) => self.note_statement_runs(file, ModuleRef::File(target)),
            Interest::HandedOnNamespace(module) => {
                self.reach_files_between(file, HandedOn::Namespace(module));
            }
            Interest::RequiredName(exporter, name) => {
                let module = ModuleRef::File(exporter);
                if let Some(found) = walk.find_module(module)
                    && walk.names_looked_for.insert((exporter, name))
                {
                    if walk.is_body_reached(found) {
                        self.reach_export(module, name);
                    } else {
                        self.found.names_awaiting_exporter.push((exporter, name));
                    }
                }
            }
            Interest::Export(module, name) => {
                self.reach_export(module, name);
            }
            Interest::CalledExport(module, name) => {
                if self.reach_export(module, name) {
                    self.reach_every_export(module);
                }
            }
            Interest::EveryExport(module) => self.reach_every_export(module),
            Interest::Name(export, accessed) => {
                self.evaluate(accessed);
                self.reach_files_behind_file_read_from(accessed, export);
                self.reach_files_between(file, HandedOn::Name(export));
                self.reach_name(export);
            }
            Interest::LinkedName(export, accessed) => {
                self.evaluate(accessed);
                self.reach_name(export);
            }
            Interest::CalledName(export, accessed) => {
                self.evaluate(accessed);
                self.reach_files_behind_file_read_from(accessed, export);
                self.reach_files_between(file, HandedOn::Name(export));
                let is_stored =
                    walk.has_stored_names(walk.input.graph.synthetic_export(export).module);
                if self.reach_name(export) && is_stored {
                    self.reach_every_export(accessed);
                }
            }
            Interest::ModuleObject(owner, object_use) => {
                self.reach_module_object(file, owner, object_use);
            }
            Interest::EntryOfModuleCache => self.keep_every_module_object(file),
            Interest::DeletionFromModuleCache(entry) => {
                self.found.deletions_from_module_cache.push((file, entry));
            }
            Interest::StoreIntoModuleCache(entry) => {
                self.found.stores_into_module_cache.push((file, entry));
            }
            Interest::ModuleCacheHandedOn(place) => {
                (self.found.places_that_hand_module_cache_on).push((file, place));
            }
            Interest::StoreOfLoaderFunction(replaced) => {
                self.keep_every_module_object(file);
                self.found.stores_loader_function = true;
                if let Some((assignment, hook)) = replaced {
                    let replaced = ReplacedLoaderHook {
                        file,
                        assignment,
                        hook,
                    };
                    self.found.replaced_loader_hooks.push(replaced);
                }
            }
        }
    }
}

pub(super) fn package_of(path: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"/node_modules/";
    let Some(at) = last_index_of(path, FOLDER) else {
        return b"";
    };
    let name = at + FOLDER.len();
    let parts = if path.get(name) == Some(&b'@') { 2 } else { 1 };
    let slashes = (name..path.len()).filter(|&index| path[index] == b'/');
    &path[..slashes.take(parts).last().unwrap_or(path.len())]
}

pub(crate) fn find_root_folders_spelled(
    files: &Files<'_>,
    sources: &Sources,
    root_directory: &[u8],
    in_parallel: InParallel<'_>,
) -> Vec<u8> {
    let root_directory = root_directory.strip_suffix(b"/").unwrap_or(root_directory);
    let folders_of_root: Vec<&[u8]> = split(root_directory, b"/").collect();
    let compiled_files = files.compiled_files().iter();
    let mut counts: Vec<(FileId, usize)> = compiled_files.map(|&file| (file, 0)).collect();
    for_each_mut(&mut counts, in_parallel, &|(file, count)| {
        if sources.kind(*file) == SourceKind::Program {
            *count = count_root_folders_spelled(files, *file, root_directory, &folders_of_root);
        }
    });
    let most = counts.into_iter().map(|(_, count)| count).max();
    folders_of_root[folders_of_root.len() - most.unwrap_or(0)..].join(&b"/"[..])
}

fn count_root_folders_spelled(
    files: &Files<'_>,
    file: FileId,
    root_directory: &[u8],
    folders_of_root: &[&[u8]],
) -> usize {
    let directory = directory_of(files.module(file).file_name());
    let Some(below_root) = directory.strip_prefix(root_directory) else {
        return 0;
    };
    let depth = split(below_root, b"/")
        .filter(|part| !part.is_empty())
        .count();
    let mut most = 0;
    for expression in &files.hir(file).exprs {
        let ExprKind::String(text) = expression.kind else {
            continue;
        };
        let text = files.atoms.bytes(text);
        if !text.starts_with(b"../") {
            continue;
        }
        let parts: Vec<&[u8]> = split(text, b"/").collect();
        let ups = parts.iter().take_while(|part| **part == b"..").count();
        let Some(above) = ups.checked_sub(depth).filter(|&above| above > most) else {
            continue;
        };
        let Some(start) = folders_of_root.len().checked_sub(above) else {
            continue;
        };
        if parts.len() > ups + above && parts[ups..ups + above] == folders_of_root[start..] {
            most = above;
        }
    }
    most
}

struct FilesNamedAtRunTime<'a> {
    numbers_of_packages: FxHashMap<&'a [u8], u32>,
    files_spelled: Vec<Vec<FileId>>,
    files_beside: Vec<Vec<u32>>,
    packages_beside: Vec<SmallVec<[u32; 8]>>,
    is_asked: Vec<bool>,
}

impl<'a> FilesNamedAtRunTime<'a> {
    fn new(input: &'a ProgramReachInput<'a, '_>) -> FilesNamedAtRunTime<'a> {
        let files = input.files;
        let is_code = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Program;
        let code_files = || files.compiled_files().iter().filter(is_code).copied();
        let mut numbers_of_packages: FxHashMap<&[u8], u32> = FxHashMap::default();
        let mut package_by_file = vec![u32::MAX; files.modules.len()];
        let mut number_of = |file: FileId| {
            let number = &mut package_by_file[file.idx()];
            if *number == u32::MAX {
                let next = numbers_of_packages.len() as u32;
                let package = package_of(files.module(file).file_name());
                *number = *numbers_of_packages.entry(package).or_insert(next);
            }
            *number
        };
        let mut files_beside: Vec<Vec<u32>> = Vec::new();
        let mut packages_beside: Vec<SmallVec<[u32; 8]>> = Vec::new();
        for file in code_files() {
            let mut touched: SmallVec<[u32; 8]> = SmallVec::new();
            touched.push(number_of(file));
            for request in input.graph.requests(file) {
                if let ModuleRef::File(target) | ModuleRef::Face(target) = request.target {
                    touched.push(number_of(target));
                }
            }
            touched.sort_unstable();
            touched.dedup();
            let count = *touched.last().expect("its own") as usize + 1;
            if files_beside.len() < count {
                files_beside.resize_with(count, Vec::new);
            }
            for &package in &touched {
                files_beside[package as usize].push(packages_beside.len() as u32);
            }
            packages_beside.push(touched);
        }
        FilesNamedAtRunTime {
            numbers_of_packages,
            is_asked: vec![false; files_beside.len()],
            files_spelled: vec![Vec::new(); files_beside.len()],
            files_beside,
            packages_beside,
        }
    }

    fn note_spelled(
        &mut self,
        input: &ProgramReachInput<'_, '_>,
        file: FileId,
        spelled: FileId,
    ) -> bool {
        let package = package_of(input.files.module(file).file_name());
        let number = self.numbers_of_packages[package] as usize;
        if !self.is_asked[number] {
            self.files_spelled[number].push(spelled);
        }
        self.is_asked[number]
    }

    fn find(&mut self, package: &[u8]) -> Vec<FileId> {
        let number = self.numbers_of_packages.get(package);
        let Some(beside) = number.and_then(|&number| self.files_beside.get_mut(number as usize))
        else {
            return Vec::new();
        };
        let mut found = Vec::new();
        for beside in take(beside) {
            for neighbor in take(&mut self.packages_beside[beside as usize]) {
                if replace(&mut self.is_asked[neighbor as usize], true) {
                    continue;
                }
                found.append(&mut self.files_spelled[neighbor as usize]);
            }
        }
        found.sort_unstable();
        found.dedup();
        found
    }
}

fn asks_what_files_spell(input: &ProgramReachInput<'_, '_>) -> bool {
    !input.any_file_is_named_at_run_time && input.graph.knows_texts_that_spell_files()
}

fn find_who_hands_on_what(
    input: &ProgramReachInput<'_, '_>,
    files: &[Option<FileUnits>],
    scanned_files: &[FileId],
) -> (
    FxHashMap<HandedOn, SmallVec<[Exporter; 2]>>,
    FxHashMap<ModuleRef, SmallVec<[ModuleRef; 2]>>,
) {
    let mut exporters: FxHashMap<HandedOn, SmallVec<[Exporter; 2]>> = FxHashMap::default();
    let mut takers: FxHashMap<ModuleRef, SmallVec<[ModuleRef; 2]>> = FxHashMap::default();
    for &file in scanned_files {
        for taker in files[file.idx()].iter().flat_map(|units| &units.modules) {
            for &source in input.graph.name_sources(taker.module) {
                takers
                    .entry(module_with_code(source))
                    .or_default()
                    .push(taker.module);
            }
        }
        for export in input.graph.exports(file) {
            let handed_on = HandedOn::of(export.binding);
            if matches!(handed_on, HandedOn::Variable(defined) if defined.file == file) {
                continue;
            }
            let is_by_star = export.is_from_star_export;
            let behind = match export.binding {
                ExportBinding::Synthetic(shown) => {
                    let shown = input.graph.synthetic_export(shown);
                    let commonjs = input.graph.commonjs();
                    commonjs.member_behind_getter(shown.module, shown.name)
                }
                _ => None,
            };
            let behind = match behind {
                Some(Member::Variable(returned)) => Some(HandedOn::Name(returned)),
                _ => None,
            };
            for handed_on in [Some(handed_on), behind].into_iter().flatten() {
                let exporters = exporters.entry(handed_on).or_default();
                match exporters.last_mut().filter(|last| last.file == file) {
                    Some(last) => last.is_by_star &= is_by_star,
                    None => exporters.push(Exporter { file, is_by_star }),
                }
            }
        }
    }
    let sort_by_file = |exporters: &mut SmallVec<[Exporter; 2]>| {
        exporters.shared_sort_unstable_by_key(|exporter| exporter.file);
    };
    exporters.values_mut().for_each(sort_by_file);
    let mut added: FxHashMap<(HandedOn, FileId), bool> = FxHashMap::default();
    let mut add_exporter = |handed_on: HandedOn, exporter: Exporter| {
        let listed = exporters.get(&handed_on);
        let is_listed = listed.is_some_and(|it| find_exporter(it, exporter.file).is_some());
        let is_new = !is_listed && !added.contains_key(&(handed_on, exporter.file));
        if is_new {
            added.insert((handed_on, exporter.file), exporter.is_by_star);
        }
        is_new
    };
    let mut handed_on_by_commonjs: Vec<(FileId, HandedOn)> = Vec::new();
    for (module, member) in input.graph.commonjs().names_bound_elsewhere() {
        let handed_on = match member {
            Member::Variable(export) => HandedOn::Name(export),
            Member::Binding(defined) => HandedOn::Variable(defined),
            Member::Copy(_) | Member::Undefined | Member::Marker(_) | Member::OnObject => {
                continue;
            }
        };
        let is_by_star = false;
        if let ModuleRef::File(file) = module
            && !matches!(handed_on, HandedOn::Variable(defined) if defined.file == file)
            && add_exporter(handed_on, Exporter { file, is_by_star })
        {
            handed_on_by_commonjs.push((file, handed_on));
        }
    }
    let own_names = (0..)
        .map(SyntheticExportId)
        .zip(input.graph.synthetic_exports());
    handed_on_by_commonjs.extend(own_names.filter_map(|(id, export)| match export.module {
        ModuleRef::File(file) if export.name != known::default => Some((file, HandedOn::Name(id))),
        _ => None,
    }));
    if !handed_on_by_commonjs.is_empty() {
        let mut takers_by_star: FxHashMap<FileId, SmallVec<[FileId; 2]>> = FxHashMap::default();
        let scanned_files = (0..).map(FileId).zip(files);
        for (taker, _) in scanned_files.filter(|(_, units)| units.is_some()) {
            for request in input.graph.requests(taker) {
                if let ModuleRef::File(target) | ModuleRef::Face(target) = request.target
                    && request.is_dynamic_star_export
                {
                    takers_by_star.entry(target).or_default().push(taker);
                }
            }
        }
        while let Some((file, handed_on)) = handed_on_by_commonjs.pop() {
            for &file in takers_by_star.get(&file).into_iter().flatten() {
                let is_by_star = true;
                if add_exporter(handed_on, Exporter { file, is_by_star }) {
                    handed_on_by_commonjs.push((file, handed_on));
                }
            }
        }
    }
    let mut grown: FxHashSet<HandedOn> = FxHashSet::default();
    for ((handed_on, file), is_by_star) in added {
        let exporters = exporters.entry(handed_on).or_default();
        exporters.push(Exporter { file, is_by_star });
        grown.insert(handed_on);
    }
    for handed_on in grown {
        exporters.get_mut(&handed_on).map(sort_by_file);
    }
    (exporters, takers)
}

fn find_barrels(input: &ProgramReachInput<'_, '_>, files: &[Option<FileUnits>]) -> Vec<bool> {
    let graph = input.graph;
    let hands_on_all_it_exports = |file: FileId| {
        let mut own_exports = graph
            .exports(file)
            .iter()
            .filter(|it| !it.is_from_star_export);
        !graph.requests(file).is_empty()
            && !graph.exports(file).is_empty()
            && own_exports.all(|export| match export.binding {
                ExportBinding::Variable(defined) => defined.file != file,
                _ => true,
            })
    };
    let scanned_files = (0..).map(FileId).zip(files);
    let mut is_barrel: Vec<bool> = scanned_files
        .map(|(file, units)| {
            units.is_some()
                && graph.has_record(file)
                && graph.has_no_side_effects(file)
                && matches!(
                    input.files.declared_side_effects(file),
                    DeclaredSideEffects::None
                )
                && hands_on_all_it_exports(file)
        })
        .collect();
    for entry_point in input.sources.entry_points() {
        is_barrel[entry_point.file.idx()] = false;
    }
    for units in files.iter().flatten() {
        for target in &units.star_targets {
            is_barrel[target.idx()] = false;
        }
    }
    is_barrel
}

fn find_files_run_by_calls(
    input: &ProgramReachInput<'_, '_>,
    files: &[Option<FileUnits>],
) -> Vec<bool> {
    let mut is_run_by_call = vec![false; files.len()];
    let called = files
        .iter()
        .flatten()
        .flat_map(|units| &units.loaded_by_calls);
    let mut pending: Vec<FileId> = called.copied().collect();
    while let Some(file) = pending.pop() {
        if files[file.idx()].is_none() || replace(&mut is_run_by_call[file.idx()], true) {
            continue;
        }
        for request in input.graph.requests(file) {
            if let ModuleRef::File(target) | ModuleRef::Face(target) = request.target {
                pending.push(target);
            }
        }
    }
    is_run_by_call
}

#[derive(Default)]
pub(crate) struct LeftOutCode {
    pub functions: FxHashSet<FunctionRef>,
    pub declarations: LeftOutDeclarations,
    pub files: Vec<FileId>,
    files_read_by_name: Vec<FileId>,
    names_read_from_objects: SharedSet<(FileId, Atom)>,
    bound_variables: SharedSet<Sym>,
    pub holds_every_load_by_unknown_name: bool,
}

impl LeftOutCode {
    pub(crate) fn find_export_use(&self, file: FileId, export: &ModuleExport) -> ExportUse {
        if self.files_read_by_name.binary_search(&file).is_err()
            || self.names_read_from_objects.contains(&(file, export.name))
        {
            return ExportUse::ReadFromObject;
        }
        match export.binding {
            ExportBinding::Variable(defined)
                if defined.file == file && self.bound_variables.contains(&defined) =>
            {
                ExportUse::Bound
            }
            _ => ExportUse::None,
        }
    }
}

#[derive(Default)]
pub(crate) struct ReachedModules {
    pub looked_at: Vec<ModuleRef>,
    pub with_module_objects: Vec<ModuleRef>,
    pub naming_ways: Vec<ModuleRef>,
    pub found_by_name: Vec<ModuleRef>,
    pub data_found_by_name: Vec<ModuleRef>,
    pub left_out_inner_modules: Vec<ModuleRef>,
    pub readers_of_built_in_modules: Vec<(FileId, ModuleRef)>,
    pub replaced_loader_hooks: Vec<ReplacedLoaderHook>,
    pub deletions_from_module_cache: Vec<(FileId, ExprId)>,
    pub stores_into_module_cache: Vec<(FileId, ExprId)>,
    pub places_that_hand_module_cache_on: Vec<(FileId, ExprId)>,
    pub stores_loader_function: bool,
    required: SharedSet<(ModuleRef, ModuleRef)>,
    left_to_calls: FxHashSet<(FileId, FileId)>,
    left_with_elements: FxHashSet<(FileId, ModuleRef)>,
}

impl ReachedModules {
    pub(crate) fn keeps_request(&self, referrer: ModuleRef, request: &ModuleRequest) -> bool {
        if request.kind == ModuleRequestKind::Require {
            return self.required.contains(&(referrer, request.target));
        }
        if let ModuleRef::File(importer) = referrer
            && (self.left_with_elements).contains(&(importer, request.target))
        {
            return false;
        }
        let (ModuleRef::File(importer), ModuleRef::File(target) | ModuleRef::Face(target)) =
            (referrer, request.target)
        else {
            return true;
        };
        request.is_dynamic_star_export
            || request.phase == ImportPhase::Defer
            || !self.left_to_calls.contains(&(importer, target))
    }
}

fn fingerprint(
    input: &ProgramReachInput<'_, '_>,
    left_out: &LeftOutCode,
    reached: &ReachedModules,
    in_parallel: InParallel<'_>,
) -> u64 {
    const FILES_OF_A_TASK: usize = 256;
    let files = input.files;
    let mut paths = vec![0u64; files.modules.len()];
    let mut tasks: Vec<(usize, &mut [u64])> =
        paths.chunks_mut(FILES_OF_A_TASK).enumerate().collect();
    for_each_mut(&mut tasks, in_parallel, &|(task, paths)| {
        let first = *task * FILES_OF_A_TASK;
        for (file, path) in (first..).zip(paths.iter_mut()) {
            *path = FxBuildHasher.hash_one(files.module(FileId(file as u32)).file_name());
        }
    });
    drop(tasks);
    let path_of = |file: FileId| paths[file.idx()];
    let hash_of =
        |kind: u8, file: FileId, rest: u64| FxBuildHasher.hash_one((kind, path_of(file), rest));
    let mut sum = 0u64;
    let mut add = |kind: u8, file: FileId, rest: u64| {
        sum = sum.wrapping_add(hash_of(kind, file, rest));
    };
    for function in &left_out.functions {
        add(0, function.file, function.function.idx() as u64);
    }
    for &file in &left_out.files {
        add(1, file, 0);
    }
    for &file in &left_out.files_read_by_name {
        add(2, file, 0);
    }
    let lists = [
        &reached.looked_at,
        &reached.with_module_objects,
        &reached.naming_ways,
        &reached.found_by_name,
        &reached.data_found_by_name,
        &reached.left_out_inner_modules,
    ];
    for (kind, list) in (3u8..).zip(lists) {
        for &module in list {
            match module {
                ModuleRef::File(file) => add(kind, file, 0),
                ModuleRef::Inner { file, callback } => add(kind, file, 1 + callback.idx() as u64),
                _ => unreachable!("the walk lists files and the modules inside them"),
            }
        }
    }
    for replaced in &reached.replaced_loader_hooks {
        add(9, replaced.file, u64::from(replaced.assignment.0));
    }
    for &(file, entry) in &reached.deletions_from_module_cache {
        add(10, file, u64::from(entry.0));
    }
    for &(file, entry) in &reached.stores_into_module_cache {
        add(11, file, u64::from(entry.0));
    }
    for &(file, place) in &reached.places_that_hand_module_cache_on {
        add(16, file, u64::from(place.0));
    }
    for &(file, module) in &reached.readers_of_built_in_modules {
        add(15, file, FxBuildHasher.hash_one(module));
    }
    let mut sums: Vec<(&[FileId], u64)> = (files.compiled_files().chunks(FILES_OF_A_TASK))
        .map(|files| (files, 0))
        .collect();
    for_each_mut(&mut sums, in_parallel, &|(files_of_task, sum)| {
        for &file in files_of_task.iter() {
            if input.sources.kind(file) != SourceKind::Program {
                continue;
            }
            for export in input.graph.exports(file) {
                let name = FxBuildHasher.hash_one(files.atoms.bytes(export.name));
                let kind = 10 + left_out.find_export_use(file, export) as u8;
                *sum = sum.wrapping_add(hash_of(kind, file, name));
            }
            for (index, request) in input.graph.requests(file).iter().enumerate() {
                let is_kept = reached.keeps_request(ModuleRef::File(file), request);
                *sum = sum.wrapping_add(hash_of(13 + u8::from(is_kept), file, index as u64));
            }
        }
    });
    let of_files = sums.iter().map(|&(_, sum)| sum);
    of_files
        .fold(sum, u64::wrapping_add)
        .wrapping_add(left_out.declarations.fingerprint(&path_of))
        .wrapping_add(u64::from(left_out.holds_every_load_by_unknown_name))
}

pub(crate) fn find_left_out_code(
    input: &ProgramReachInput<'_, '_>,
    in_parallel: InParallel<'_>,
) -> (LeftOutCode, ReachedModules) {
    let mut walk = Walk::new(input, in_parallel);
    let mut steps = StepClock::new(Stage::BindModules);
    let (found, loads, [rounds, steps_of_rounds, other_steps]) = walk.run(in_parallel);
    let loads_isolated_code = found.loads_isolated_code;
    steps.end("reach: walk");
    steps.end_with(|| {
        format!(
            "reach: the walk took {steps_of_rounds} steps in {rounds} rounds, {other_steps} between them"
        )
    });
    let mut left_out = LeftOutCode::default();
    let mut reached_modules = ReachedModules::default();
    for (index, units) in walk.files.iter().enumerate() {
        let Some(units) = units else {
            continue;
        };
        let file = FileId(index as u32);
        for request in input.graph.requests(file) {
            if let ModuleRef::File(target) | ModuleRef::Face(target) = request.target
                && walk.waits_for_call[target.idx()]
                && !walk.run_by_statements.contains(&(file, target))
            {
                reached_modules.left_to_calls.insert((file, target));
            }
        }
        if !is_marked(&units.is_region_reached[TOP_LEVEL as usize]) {
            left_out.files.push(file);
            let inner_modules = units.modules[1..].iter().map(|module| module.module);
            reached_modules.left_out_inner_modules.extend(inner_modules);
            continue;
        }
        for &(_, target) in &units.statements_with_elements {
            let is_reached = |region: u32| is_marked(&units.is_region_reached[region as usize]);
            let mut holding = (units.statements_with_elements.iter()).filter(|it| it.1 == target);
            let runs_at_first_import_that_stays = match target {
                ModuleRef::File(it) | ModuleRef::Face(it) => {
                    input.graph.kind(it) == ModuleKind::CommonJs || walk.is_run_by_call[it.idx()]
                }
                _ => true,
            };
            if runs_at_first_import_that_stays
                && !holding.any(|&(statement, _)| is_reached(statement))
            {
                reached_modules.left_with_elements.insert((file, target));
            }
        }
        if !is_marked(&units.modules[0].is_every_export_reached) {
            left_out.files_read_by_name.push(file);
        }
        for module in &units.modules {
            if !is_marked(&units.is_region_reached[module.body as usize]) {
                reached_modules.left_out_inner_modules.push(module.module);
            } else if is_marked(&module.is_every_export_reached) {
                reached_modules.looked_at.push(module.module);
            }
        }
        if (is_marked(&walk.keeps_every_module_object) && walk.may_have_module_object(file, units))
            || is_marked(&units.keeps_module_object)
        {
            let with_module_objects = &mut reached_modules.with_module_objects;
            with_module_objects.push(ModuleRef::File(file));
        }
        let reached = units.is_region_reached[1..].iter();
        for (unit, is_reached) in units.units.iter().zip(reached) {
            if is_marked(is_reached) {
                continue;
            }
            let functions = unit.functions.iter();
            left_out
                .functions
                .extend(functions.map(|&function| FunctionRef { file, function }));
            let declarations = &mut left_out.declarations;
            if let Some((class, checks)) = &unit.class_checks {
                declarations.leave_out_class(file, *class);
                if checks.heritage {
                    declarations.keep_heritage_check(file, *class);
                }
                for &member in &checks.keys {
                    declarations.keep_key_conversion(file, member);
                }
            }
            match unit.part {
                Part::Bodies | Part::InnerModule(_) => {}
                Part::Declarator(declarator) => declarations.leave_out_declarator(file, declarator),
                Part::Class(class) => declarations.leave_out_class(file, class),
                Part::Statement(statement) => {
                    declarations.leave_out_statement(file, input.files.hir(file), statement);
                }
            }
        }
    }
    let in_order = |mut files: Vec<FileId>| -> Vec<ModuleRef> {
        files.sort_unstable();
        files.dedup();
        files.into_iter().map(ModuleRef::File).collect()
    };
    reached_modules.naming_ways = in_order(found.files_naming_ways);
    reached_modules.found_by_name = in_order(loads.files_found);
    reached_modules.replaced_loader_hooks = found.replaced_loader_hooks;
    reached_modules.stores_loader_function = found.stores_loader_function;
    let mut readers = found.readers_of_built_in_modules;
    readers.sort_unstable_by_key(|&(file, module)| (file, module.registry_id()));
    readers.dedup();
    let readers = readers.into_iter();
    reached_modules.readers_of_built_in_modules = readers
        .map(|(file, module)| (file, ModuleRef::Runtime(module)))
        .collect();
    reached_modules.deletions_from_module_cache = found.deletions_from_module_cache;
    reached_modules
        .deletions_from_module_cache
        .sort_unstable_by_key(|&(file, entry)| (file, entry.0));
    reached_modules.deletions_from_module_cache.dedup();
    reached_modules.stores_into_module_cache = found.stores_into_module_cache;
    reached_modules
        .stores_into_module_cache
        .sort_unstable_by_key(|&(file, entry)| (file, entry.0));
    reached_modules.stores_into_module_cache.dedup();
    reached_modules.places_that_hand_module_cache_on = found.places_that_hand_module_cache_on;
    reached_modules
        .places_that_hand_module_cache_on
        .sort_unstable_by_key(|&(file, place)| (file, place.0));
    reached_modules.places_that_hand_module_cache_on.dedup();
    reached_modules
        .replaced_loader_hooks
        .sort_unstable_by_key(|replaced| (replaced.file, replaced.assignment.0));
    if !loads.packages.is_empty() {
        let is_data = |&&file: &&FileId| input.sources.kind(file) == SourceKind::Data;
        let data_files = input.files.compiled_files().iter().filter(is_data);
        reached_modules.data_found_by_name =
            data_files.map(|&file| ModuleRef::File(file)).collect();
    }
    for enumeration in walk.files_reading_members.keys() {
        if !walk.objects_handed_on.contains(enumeration) {
            let declarations = &mut left_out.declarations;
            declarations.note_object_never_handed_on(enumeration.file, enumeration.id);
        }
    }
    let known = KnownMemberValues::default();
    let members = input.known_objects(&known);
    for &file in input.files.compiled_files() {
        if let Some(object) = members.find_data_object(file)
            && !walk.objects_handed_on.contains(&object)
        {
            let declarations = &mut left_out.declarations;
            declarations.note_object_never_handed_on(file, object.id);
            for (variable, declarator) in members.data_variables(file) {
                if walk.reached_bindings.get_ref(&variable).is_none() {
                    declarations.leave_out_declarator(file, declarator);
                }
            }
        }
    }
    let loads_outside_units = |&file: &FileId| {
        walk.loads_by_unknown_name_outside_units(file)
            || walk.loads_isolated_code_outside_units(file)
    };
    left_out.holds_every_load_by_unknown_name = !loads.is_any_reached
        && !loads_isolated_code
        && !input.files.compiled_files().iter().any(loads_outside_units);
    steps.end("reach: list what is left out");
    steps.end_with(|| {
        let scanned = walk.files.iter().flatten();
        format!(
            "reach: {} units",
            scanned.map(|units| units.units.len()).sum::<usize>()
        )
    });
    drop_each(take(&mut walk.files), in_parallel);
    steps.end("reach: drop the scans");
    left_out.names_read_from_objects = walk.names_read_from_objects;
    left_out.bound_variables = walk.bound_variables;
    reached_modules.required = walk.required;
    steps.end_with(|| {
        format!(
            "reach: {} files and {} functions are left out; the same number where the same is left out: {:016x}",
            left_out.files.len(),
            left_out.functions.len(),
            fingerprint(input, &left_out, &reached_modules, in_parallel)
        )
    });
    (left_out, reached_modules)
}
