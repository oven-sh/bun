use core::cmp::Reverse;
use core::mem::{replace, take};
use core::ops::Range;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, Bound, Decl, Parent, SymbolId};
use bun_sema::check::aot::FunctionRef;
use bun_sema::fold::Decision;
use bun_sema::hir::{
    self, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, ImportEqualsId,
    MemberKey, MemberKind, ModifierKind, PatId, PatKind, PropKey, StmtId, StmtKind, UnOp,
    VarDeclId, VarKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::{ThisPositions, evaluates_own_this};
use bun_sema::program::{CodeAnswer, FileId, Files, Sym};
use bun_sema::resolve::DeclaredSideEffects;
use bun_sema::util::SharedSort;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::removable::Removable;
use crate::builtins::resolve::{ModuleObjectOwner, ModuleObjectUse};
use crate::ir::generated::ModuleRequestKind;
use crate::ir::{InParallel, for_each_mut};
use crate::load::Sources;
use crate::load::named_loads::gives_unknown_name_to_imported_loader;
use crate::load::sources::{SourceKind, parsed_source};
use crate::lower::LeftOutDeclarations;
use crate::modules::{
    Candidates, ExportBinding, ExportLookup, ExportUse, ImportBinding, Member, ModuleExport,
    ModuleGraph, ModuleRef, ModuleRequest, Shape, Site, SiteAnswer, SyntheticExportId, View,
};
use crate::options::RemovableOptions;

pub(crate) struct ProgramReachInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub sources: &'a Sources,
    pub graph: &'a ModuleGraph,
    pub removable: RemovableOptions,
}

pub(super) const TOP_LEVEL: u32 = 0;

// Where code of a unit is written. A piece may lie in another one: what is written in both belongs to the inner one.
struct Piece {
    written_at: Range<u32>,
    unit: u32,
    enclosing: Option<u32>,
}

#[derive(Copy, Clone)]
enum Interest {
    Unit(u32),
    Binding(Sym),
    // The function is called on the object of the module.
    CalledBinding(Sym, ModuleRef),
    Evaluation(ModuleRef),
    // A call that evaluates the module where it stands.
    Require {
        referrer: ModuleRef,
        target: ModuleRef,
    },
    // What an import or export statement of the file asks for.
    Request(ModuleRef),
    // `export *` from a file whose package says that nothing is lost without it.
    Star(FileId),
    // The object of the module comes to the file through others, under a name.
    HandedOnNamespace(ModuleRef),
    // The loader looks for the name in the export table of the file, if that file is part of the program.
    RequiredName(FileId, Atom),
    Export(ModuleRef, Atom),
    CalledExport(ModuleRef, Atom),
    EveryExport(ModuleRef),
    // A name that the body of a CommonJS module stores under, and the module that it is read from, which may have it from the other one.
    Name(SyntheticExportId, ModuleRef),
    CalledName(SyntheticExportId, ModuleRef),
    // A mention of an object of the loader that stands for a module.
    ModuleObject(ModuleObjectOwner, ModuleObjectUse),
    // A loader is given a name that the build does not know.
    LoadByUnknownName,
}

// What of a unit that is not reached the program does without.
#[derive(Copy, Clone)]
enum Part {
    // The declaration runs, with functions that throw.
    Bodies,
    Declarator(VarDeclId),
    Class(ClassId),
    Statement(StmtId),
    // The body of a module that is written inside the file, by its index among the modules of the file.
    InnerModule(u32),
}

// A module whose body is code of the file.
struct ModuleUnits {
    module: ModuleRef,
    // The region of its body.
    body: u32,
    // `exports.name = value` as a statement of the body: the units, by the name.
    stores: FxHashMap<Atom, SmallVec<[u32; 1]>>,
    // The units that do something only for somebody who looks at the exports object.
    parts_of_object: Vec<u32>,
    is_every_export_reached: bool,
}

impl ModuleUnits {
    fn new(module: ModuleRef, body: u32) -> ModuleUnits {
        ModuleUnits {
            module,
            body,
            stores: FxHashMap::default(),
            parts_of_object: Vec::new(),
            is_every_export_reached: false,
        }
    }
}

// The regions of a file: the code at its top level, then its units.
#[derive(Default)]
struct FileUnits {
    functions: Vec<SmallVec<[FnId; 1]>>,
    parts: Vec<Part>,
    // By unit: the region that the unit is written in.
    regions_around: Vec<u32>,
    unit_of_symbol: FxHashMap<SymbolId, u32>,
    unit_of_function: FxHashMap<FnId, u32>,
    unit_of_class: FxHashMap<ClassId, u32>,
    unit_of_inner_name: FxHashMap<SymbolId, u32>,
    interests: Vec<Vec<Interest>>,
    star_targets: Vec<FileId>,
    // The files that a call in this one loads.
    loaded_by_calls: Vec<FileId>,
    is_region_reached: Vec<bool>,
    // The file itself, then the modules that are written inside it.
    modules: Vec<ModuleUnits>,
    inner_modules: FxHashMap<FnId, u32>,
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
                    _ => None,
                }
            }
            BindingInitializer::Class(class) => self.unit_of_class.get(&class),
            _ => None,
        };
        unit.copied()
    }

    // The module whose body the region is.
    fn find_module_with_body(&self, region: u32) -> Option<usize> {
        match region.checked_sub(1).map(|unit| self.parts[unit as usize]) {
            None => Some(0),
            Some(Part::InnerModule(index)) => Some(index as usize),
            Some(Part::Bodies | Part::Declarator(_) | Part::Class(_) | Part::Statement(_)) => None,
        }
    }
}

fn module_of_view(view: View) -> ModuleRef {
    match view {
        View::Namespace(module) | View::Exports(module) => module,
    }
}

// A face evaluates the file and shows what the file exports.
fn module_with_code(module: ModuleRef) -> ModuleRef {
    match module {
        ModuleRef::Face(file) => ModuleRef::File(file),
        _ => module,
    }
}

// The module that the statement names which imports the symbol.
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

// The parent of an expression, past `as`, `satisfies` and `!` around it, and the outermost of those.
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
    // The calls that evaluate a module where they stand.
    sites: Vec<(ExprId, ModuleRef)>,
    // While units are collected: the region that they are written in, and the module whose body it is.
    region: u32,
    module: u32,
}

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
        }
    }

    fn expressions(&self) -> impl Iterator<Item = ExprId> + use<> {
        (0..self.hir.exprs.len() as u32).map(ExprId)
    }

    fn is_stable(&self, symbol: SymbolId) -> bool {
        !symbol.is_none() && self.bound.is_stable_binding(symbol)
    }

    fn add_unit(&mut self, part: Part, functions: SmallVec<[FnId; 1]>) -> u32 {
        let unit = self.units.functions.len() as u32;
        self.units.functions.push(functions);
        self.units.parts.push(part);
        self.units.regions_around.push(self.region);
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

    // A name that two declarations share (an enum in two pieces, a class with a namespace) is made by all of them together.
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

    // `false`: something stores to one of the names.
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
        let mut names = SmallVec::new();
        let is_part = !node.init.is_none()
            && !node.flags.contains(Flags::AMBIENT)
            && removable.declaration(declaration)
            && self.collect_stable_names(node.pat, &mut names);
        if is_part {
            self.add_part(
                Part::Declarator(declaration),
                node.loc.pos..node.loc.end,
                &names,
            );
        }
        is_part
    }

    fn add_class_part(&mut self, class: ClassId, written_at: Range<u32>) {
        let hir = self.hir;
        let names = [
            self.bound.declared_symbol(Decl::Class(class)),
            self.bound.inner_class_symbol(class),
        ];
        let names: SmallVec<[SymbolId; 2]> =
            names.into_iter().filter(|name| !name.is_none()).collect();
        let unit = self.add_part(Part::Class(class), written_at, &names);
        let members = hir[class].members.iter().map(|member| hir[member].func);
        let functions =
            members.filter(|&function| !function.is_none() && hir::has_body(&hir[function]));
        self.units.functions[unit as usize] = functions.collect();
    }

    fn add_statement_part(&mut self, statement: StmtId) {
        let written_at = self.hir[statement].loc;
        let written_at = written_at.pos..written_at.end;
        let name = match self.hir[statement].kind {
            StmtKind::Enum(declared) => self.bound.declared_symbol(Decl::Enum(declared)),
            StmtKind::ExportDefault(_) => self.bound.declared_symbol(Decl::ExportExpr(statement)),
            // An expression statement declares nothing, so nothing reaches it.
            _ => {
                self.add_part(Part::Statement(statement), written_at, &[]);
                return;
            }
        };
        if self.is_name_of_one_part(name) {
            self.add_part(Part::Statement(statement), written_at, &[name]);
        }
    }

    // A statement that has no code as long as the module has no exports object: the definition of a name that stands for another one, the mark of an ES module.
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

    // Whether the node stores under a name of the module whose body is scanned, and does nothing else.
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
            // Nobody reads the name.
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
    ) -> bool {
        let hir = self.hir;
        let mut expression = hir.skip_type_assertions(expression);
        // `Object.defineProperty(exports, "name", { value })`
        if let ExprKind::Call(call) = hir[expression].kind {
            let mut described = hir.ids(hir[call].args).skip(1);
            return self.add_stored_name(expression, names)
                && described.all(|operand| removable.expression(operand));
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
        has_store && removable.expression(expression)
    }

    // `exports.a = exports.b = value` is a part like `var a = value`: it is there for whoever reads one of the names.
    fn add_export_store_part(&mut self, removable: &Removable<'_, '_>, statement: StmtId) {
        let StmtKind::Expr(expression) = self.hir[statement].kind else {
            return;
        };
        let mut names = SmallVec::new();
        if !self.collect_stored_names(removable, expression, &mut names) {
            return;
        }
        let written_at = self.hir[statement].loc;
        let unit = self.add_part(
            Part::Statement(statement),
            written_at.pos..written_at.end,
            &[],
        );
        let module = &mut self.units.modules[self.module as usize];
        if names.is_empty() {
            module.parts_of_object.push(unit);
        }
        for name in names {
            module.stores.entry(name).or_default().push(unit);
        }
    }

    // What runs when the class is defined stays with the code around it: the class it extends, a computed key.
    fn add_class_unit(&mut self, class: ClassId) {
        let hir = self.hir;
        let unit = self.units.functions.len() as u32;
        let mut functions = SmallVec::new();
        let mut pieces = Vec::new();
        for member in hir[class].members.iter() {
            let member = &hir[member];
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
            if has_function && !matches!(member.key, PropKey::Computed(_)) {
                functions.push(member.func);
                pieces.push(Piece {
                    written_at: member.loc.pos..member.loc.end,
                    unit,
                    enclosing: None,
                });
            }
        }
        if functions.is_empty() {
            return;
        }
        let inner_name = self.bound.inner_class_symbol(class);
        if !inner_name.is_none() {
            self.units.unit_of_inner_name.insert(inner_name, unit);
        }
        self.units.unit_of_class.insert(class, unit);
        self.add_unit(Part::Bodies, functions);
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

    // The units among the statements of a body: of the file, or of a module that is written inside it.
    fn collect_units_of(
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
                    if is_one_part && removable.is_some_and(|it| it.class(class)) {
                        let written_at = hir[statement].loc;
                        self.add_class_part(class, written_at.pos..written_at.end);
                    } else if !has_decorators {
                        self.add_class_unit(class);
                    }
                }
                StmtKind::Expr(_) | StmtKind::Enum(_) | StmtKind::ExportDefault(_) => {
                    if removable.is_some_and(|it| it.statement(statement)) {
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
            self.collect_units_of(statements, removable, has_decorators);
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
        // Text that is evaluated in a scope of the file names what it likes.
        if !bound.runtime.eval_scopes().is_empty() {
            return;
        }
        // A decorator is handed the class or its prototype, wherever in the class it stands.
        let mut modifiers = hir.modifiers.iter();
        let has_decorators = modifiers.any(|it| matches!(it.kind, ModifierKind::Decorator(_)));
        let removable = Removable::new(self.input.files, self.file, self.input.removable);
        let removable = removable.map(|it| it.with_modules(self.input.graph, self.file));
        let removable = removable.as_ref();
        self.collect_units_of(hir.body, removable, has_decorators);
        for &callback in self.input.graph.inner_modules(self.file) {
            self.add_inner_module(callback, removable, has_decorators);
        }
        self.link_pieces();
    }

    fn region_of(&self, position: u32) -> u32 {
        let following = self
            .pieces
            .partition_point(|piece| piece.written_at.start <= position);
        let mut candidate = following.checked_sub(1);
        while let Some(piece) = candidate.map(|index| &self.pieces[index]) {
            if position < piece.written_at.end {
                return piece.unit + 1;
            }
            candidate = piece.enclosing.map(|index| index as usize);
        }
        TOP_LEVEL
    }

    // The module whose body, or a function in it, the region is code of.
    fn module_at(&self, mut region: u32) -> ModuleRef {
        while region != TOP_LEVEL {
            if let Some(index) = self.units.find_module_with_body(region) {
                return self.units.modules[index].module;
            }
            region = self.units.regions_around[region as usize - 1];
        }
        ModuleRef::File(self.file)
    }

    fn add_interest(&mut self, position: u32, interest: Interest) {
        let region = self.region_of(position);
        self.units.interests[region as usize].push(interest);
    }

    // The parent of an expression, past the type assertions around it, and the outermost of those.
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

    // `member = value`: nothing is read.
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

    // The member of the object of a module that is read where `holder` evaluates to the object.
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
            // The function finds the object, and so every other member, in `this`.
            Some((member, name)) if self.is_called(member) => Interest::CalledExport(module, name),
            Some((_, name)) => Interest::Export(module, name),
            None => Interest::EveryExport(module),
        }
    }

    // `(await import(x)).name` and `const { name } = await import(x)`: the names that the object is read by, and `then`, which `await` reads.
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
        interests.push(Interest::Export(module, known::then));
        true
    }

    // Whether the expression is the object of a member access that is bound to a variable, so that nothing looks at the object.
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
            ImportBinding::Variable(defined) => Some(Interest::Binding(defined)),
            ImportBinding::Namespace { module, .. } => Some(match reference {
                Some(reference) => self.interest_in_module_object(module, reference),
                None => Interest::EveryExport(module),
            }),
            ImportBinding::NamespaceRead { module, name } => Some(Interest::Export(module, name)),
            ImportBinding::Synthetic(export) | ImportBinding::CapturedBuiltin { export, .. } => {
                let owner = self.input.graph.synthetic_export(export).module;
                Some(Interest::Name(export, imported_from.unwrap_or(owner)))
            }
            // The member says what it reads.
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

    fn interest_in_symbol(&self, symbol: SymbolId, reference: Option<ExprId>) -> Option<Interest> {
        // A name that stands for a module holds nothing.
        if let Some(view) = self.input.graph.holder(self.file, symbol) {
            return match reference {
                Some(_) => None,
                None => Some(Interest::EveryExport(module_of_view(view))),
            };
        }
        match self.input.graph.import_binding(self.file, symbol) {
            ImportBinding::Local => {
                let unit = self.units.find_unit(self.hir, self.bound, symbol)?;
                Some(Interest::Unit(unit))
            }
            binding => {
                self.interest_in_import(binding, reference, self.find_module_imported_from(symbol))
            }
        }
    }

    fn add_references(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        let decisions = &self.input.files.analysis(self.file).decisions;
        for reference in self.expressions() {
            if !matches!(hir[reference].kind, ExprKind::Ident(_)) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            let is_evaluated = bound.is_evaluated_ident(reference)
                && !decisions.is_dead_expr(reference)
                && !bound.is_in_type_query(reference);
            if !is_evaluated {
                continue;
            }
            if let Some(interest) = self.interest_in_symbol(symbol, Some(reference)) {
                self.add_interest(hir[reference].pos, interest);
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
        }
        // A name that is imported from a CommonJS file is looked for when the graph is linked, whether or not something refers to it.
        for &(symbol, binding) in self.input.graph.import_bindings(self.file) {
            if let ImportBinding::Synthetic(_) = binding
                && let Some(ModuleRef::File(exporter)) = self.find_module_imported_from(symbol)
                && self.input.graph.has_record(exporter)
                && !self.input.graph.has_no_side_effects(exporter)
                && let Some(interest) = self.interest_in_symbol(symbol, None)
            {
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
        // Text that is evaluated in a scope of the file names what the file imports.
        if !bound.runtime.eval_scopes().is_empty() {
            for &(symbol, _) in self.input.graph.import_bindings(self.file) {
                if let Some(interest) = self.interest_in_symbol(symbol, None) {
                    self.units.interests[TOP_LEVEL as usize].push(interest);
                }
            }
        }
        // `import a = b.c`: the name at the root is no expression.
        for import in (0..hir.import_equals.len() as u32).map(ImportEqualsId) {
            if let Binding::Symbol(symbol) = bound.entity_root_binding(import)
                && let Some(interest) = self.interest_in_symbol(symbol, None)
            {
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
        // The factory of a JSX element, and a class that the metadata of a decorator names.
        for reference in bound.runtime.implicit_references() {
            if let Binding::Symbol(symbol) = reference.binding
                && let Some(interest) = self.interest_in_symbol(symbol, None)
            {
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
        for &(_, binding) in self.input.graph.jsx_bindings(self.file) {
            if let Some(interest) = self.interest_in_import(binding, None, None) {
                self.units.interests[TOP_LEVEL as usize].push(interest);
            }
        }
    }

    // The module whose object the access is written on, where that is another one than the module that has the variable.
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

    // `exports.name`, `required.name`: a member that is bound to a variable asks for what is stored there.
    fn add_members(&mut self) {
        let (hir, graph) = (self.hir, self.input.graph);
        let decisions = &self.input.files.analysis(self.file).decisions;
        for access in self.expressions() {
            let is_access = matches!(
                hir[access].kind,
                ExprKind::Dot { .. } | ExprKind::Index { .. }
            );
            if !is_access || decisions.is_dead_expr(access) {
                continue;
            }
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
                Some(Member::Binding(defined)) => match self.is_called(access) {
                    true => {
                        let owner = ModuleRef::File(defined.file);
                        let accessed = self.find_accessed_module(access).unwrap_or(owner);
                        Interest::CalledBinding(defined, accessed)
                    }
                    false => Interest::Binding(defined),
                },
                Some(Member::Undefined | Member::Marker(_) | Member::OnObject) | None => continue,
            };
            self.add_interest(hir[access].pos, interest);
        }
    }

    // A module that is evaluated evaluates what it imports, but for a file whose package says that nothing is lost without it.
    fn add_requests(&mut self) {
        let graph = self.input.graph;
        for request in graph.requests(self.file) {
            // A call of `require` asks where it stands, if it is reached.
            if request.kind == ModuleRequestKind::Require {
                continue;
            }
            let is_asked_for_nothing = match request.target {
                ModuleRef::File(target) | ModuleRef::Face(target) => {
                    graph.has_record(target) && graph.has_no_side_effects(target)
                }
                ModuleRef::Inner { .. } | ModuleRef::Check(_) => false,
                ModuleRef::Runtime(_) | ModuleRef::External { .. } => true,
            };
            if !is_asked_for_nothing {
                self.units.interests[TOP_LEVEL as usize].push(Interest::Request(request.target));
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
        }
        // A file that the host loads for a call in this one, as for a worker.
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

    // `const { a, b: c = d } = require("./module")` reads the names once.
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

    // A call of `require` evaluates its target whatever the package of the target says of its side effects.
    fn add_sites(&mut self) {
        let graph = self.input.graph;
        for (call, target) in take(&mut self.sites) {
            let region = self.region_of(self.hir[call].pos);
            let referrer = self.module_at(region);
            // What a bundler's `init_x()` gives is `undefined`.
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

    fn add_loads_by_unknown_names(&mut self) {
        let files = self.input.files;
        let source = parsed_source(files, self.file);
        let positions = source.map_or(&[][..], |source| &source.unknown_names_at);
        for &position in positions {
            self.add_interest(position, Interest::LoadByUnknownName);
        }
        if source.is_none_or(|source| source.builtins.loads_unknown_modules())
            || gives_unknown_name_to_imported_loader(files, self.file)
        {
            self.units.interests[TOP_LEVEL as usize].push(Interest::LoadByUnknownName);
        }
    }

    fn add_loads(&mut self) {
        let graph = self.input.graph;
        let analysis = self.input.files.analysis(self.file);
        for site in analysis.import_sites {
            let (call, is_object_followed) = match site.kind {
                // The bindings that these create are followed where they are referred to.
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
                // A path that is asked for is there to be loaded.
                ImportSiteKind::ImportCall(call)
                | ImportSiteKind::GetBuiltinModule(call)
                | ImportSiteKind::RequireResolve(call)
                | ImportSiteKind::ImportMetaResolve(call) => (Some(call), false),
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
                            // The loader reads these two off an ES module to find what `require` answers.
                            let atoms = &self.input.files.atoms;
                            let names = [Some(known::__esModule), atoms.lookup(b"module.exports")];
                            for name in names.into_iter().flatten() {
                                if let ExportLookup::Found(_) =
                                    graph.find_export(target, name, atoms)
                                {
                                    self.units.interests[region]
                                        .push(Interest::Export(target, name));
                                }
                            }
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
                    // A call of `require` evaluates whichever of them the specifier names, so the requests for them stay.
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
                }
                // As in a bundle, only an entry point answers to a name that the build does not know.
                Some(
                    SiteAnswer::Computed(Candidates::All)
                    | SiteAnswer::Failed(_)
                    | SiteAnswer::Erased,
                )
                | None => {}
            }
        }
    }

    // Whether the folder has put a constant in the place of something that the expression is written in.
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

    // The ways to objects that stand for modules, each found by a read that names it and that resolves by binding.
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
    }

    fn scan(mut self) -> FileUnits {
        self.find_sites();
        self.collect_units();
        let region_count = self.units.functions.len() + 1;
        self.units.interests = vec![Vec::new(); region_count];
        self.units.is_region_reached = vec![false; region_count];
        self.add_references();
        self.add_members();
        self.add_requests();
        self.add_sites();
        self.add_holders();
        self.add_loads();
        self.add_loads_by_unknown_names();
        self.add_module_objects();
        self.units.this_positions = ThisPositions::of(self.hir);
        self.units
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum HandedOn {
    Variable(Sym),
    Namespace(ModuleRef),
}

impl HandedOn {
    fn of(binding: ExportBinding) -> Option<HandedOn> {
        match binding {
            ExportBinding::Variable(defined) => Some(HandedOn::Variable(defined)),
            ExportBinding::Namespace { module, .. } => {
                Some(HandedOn::Namespace(module_with_code(module)))
            }
            ExportBinding::Synthetic(_) | ExportBinding::Indirect { .. } => None,
        }
    }
}

// A file that exports a binding of another file, or the object of a module.
#[derive(Copy, Clone)]
struct Exporter {
    file: FileId,
    is_by_star: bool,
}

struct Walk<'a, 's> {
    input: &'a ProgramReachInput<'a, 's>,
    files: Vec<Option<FileUnits>>,
    exporters: FxHashMap<HandedOn, SmallVec<[Exporter; 2]>>,
    is_barrel: Vec<bool>,
    is_run_by_call: Vec<bool>,
    names_awaiting_exporter: FxHashMap<FileId, Vec<Atom>>,
    followed_imports: FxHashSet<(FileId, HandedOn)>,
    names_read_from_objects: FxHashSet<(FileId, Atom)>,
    bound_variables: FxHashSet<Sym>,
    // What `reach_binding` returned.
    reached_bindings: FxHashMap<Sym, bool>,
    pending: Vec<(FileId, u32)>,
    // By a module: the CommonJS modules whose own text hands on names of it, by a star, by a name that stands for one of its names, or by `module.exports = require(..)`.
    takers: FxHashMap<ModuleRef, SmallVec<[ModuleRef; 2]>>,
    // The modules whose object somebody was found to look at, until what follows from that is followed.
    newly_looked_at: Vec<ModuleRef>,
    // The modules whose object of the loader a read that the build resolved can come to, in the order in which they were found.
    modules_with_objects: Vec<ModuleRef>,
    has_module_object: FxHashSet<ModuleRef>,
    // Those from which `children` and `parent` have not been followed yet.
    newly_handed_out: Vec<ModuleRef>,
    // Whether reached code reads `children`, and `parent` for more than a test, of such an object.
    follows_children: bool,
    follows_parents: bool,
    // The files that only test their own `module.parent`. There is one to find where the files that require them have objects.
    tests_own_parent: FxHashSet<ModuleRef>,
    // The files in which reached code names a way from one such object to another.
    files_naming_ways: Vec<ModuleRef>,
    required: FxHashSet<(ModuleRef, ModuleRef)>,
    // By a module: the modules that have a call of `require` for it. Made when something asks.
    requirers: Option<FxHashMap<ModuleRef, Vec<ModuleRef>>>,
    reaches_load_by_unknown_name: bool,
}

impl<'a, 's> Walk<'a, 's> {
    fn new(input: &'a ProgramReachInput<'a, 's>, in_parallel: InParallel<'_>) -> Walk<'a, 's> {
        let compiled = input.files.compiled_files().iter().copied();
        let mut scans: Vec<(FileId, Option<FileUnits>)> = compiled
            .filter(|&file| input.sources.kind(file) == SourceKind::Program)
            .map(|file| (file, None))
            .collect();
        for_each_mut(&mut scans, in_parallel, &|(file, units)| {
            *units = Some(FileScan::new(input, *file).scan());
        });
        let mut files: Vec<Option<FileUnits>> =
            (0..input.files.modules.len()).map(|_| None).collect();
        let mut exporters: FxHashMap<HandedOn, SmallVec<[Exporter; 2]>> = FxHashMap::default();
        let mut takers: FxHashMap<ModuleRef, SmallVec<[ModuleRef; 2]>> = FxHashMap::default();
        for (file, units) in scans {
            for taker in units.iter().flat_map(|units| &units.modules) {
                for &source in input.graph.name_sources(taker.module) {
                    takers
                        .entry(module_with_code(source))
                        .or_default()
                        .push(taker.module);
                }
            }
            files[file.idx()] = units;
            for export in input.graph.exports(file) {
                if let Some(handed_on) = HandedOn::of(export.binding)
                    && !matches!(handed_on, HandedOn::Variable(defined) if defined.file == file)
                {
                    exporters.entry(handed_on).or_default().push(Exporter {
                        file,
                        is_by_star: export.is_from_star_export,
                    });
                }
            }
        }
        let is_barrel = find_barrels(input, &files);
        let is_run_by_call = find_files_run_by_calls(input, &files);
        Walk {
            input,
            files,
            exporters,
            is_barrel,
            is_run_by_call,
            names_awaiting_exporter: FxHashMap::default(),
            followed_imports: FxHashSet::default(),
            names_read_from_objects: FxHashSet::default(),
            bound_variables: FxHashSet::default(),
            reached_bindings: FxHashMap::default(),
            pending: Vec::new(),
            takers,
            newly_looked_at: Vec::new(),
            modules_with_objects: Vec::new(),
            has_module_object: FxHashSet::default(),
            newly_handed_out: Vec::new(),
            follows_children: false,
            follows_parents: false,
            tests_own_parent: FxHashSet::default(),
            files_naming_ways: Vec::new(),
            required: FxHashSet::default(),
            requirers: None,
            reaches_load_by_unknown_name: false,
        }
    }

    // What a body declares is there once the body has run, and the body of a module inside a file once the file has.
    fn reach_region(&mut self, file: FileId, region: u32) {
        let Some(units) = &mut self.files[file.idx()] else {
            return;
        };
        let mut region = region;
        while !replace(&mut units.is_region_reached[region as usize], true) {
            self.pending.push((file, region));
            if region == TOP_LEVEL {
                break;
            }
            region = units.regions_around[region as usize - 1];
        }
    }

    // The file that holds the code of the module, and the index of the module among those of the file.
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

    fn evaluate(&mut self, module: ModuleRef) {
        match (self.find_module(module), module) {
            (Some(found), _) => {
                let body = self.module_units(found).body;
                self.reach_region(found.0, body);
            }
            // A file without units.
            (None, ModuleRef::Inner { file, .. }) => self.reach_region(file, TOP_LEVEL),
            (None, _) => {}
        }
    }

    // A CommonJS module of the program that the loader has no part in: what it exports is what its body stores.
    fn has_stored_names(&self, module: ModuleRef) -> bool {
        match module {
            ModuleRef::File(_) | ModuleRef::Inner { .. } => match self.input.graph.shape(module) {
                Shape::Names | Shape::Value => true,
                Shape::EsModule | Shape::AsToday => false,
            },
            _ => false,
        }
    }

    // The files through which `importer` gets the binding.
    fn reach_files_between(&mut self, importer: FileId, handed_on: HandedOn) {
        if matches!(handed_on, HandedOn::Variable(defined) if defined.file == importer)
            || !self.exporters.contains_key(&handed_on)
            || !self.followed_imports.insert((importer, handed_on))
        {
            return;
        }
        let graph = self.input.graph;
        let exporters = self.exporters[&handed_on].clone();
        for request in graph.requests(importer) {
            let ModuleRef::File(target) = request.target else {
                continue;
            };
            for exporter in exporters.iter().filter(|exporter| exporter.file == target) {
                if !exporter.is_by_star
                    || !graph.has_no_side_effects(target)
                    || self.is_run_by_call[target.idx()]
                {
                    self.evaluate(request.target);
                }
                self.reach_files_between(target, handed_on);
            }
        }
    }

    // Whether the file only asks for the other one to hand on names of it, none of which has been asked for so far.
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
            let exporters = self
                .exporters
                .get(&HandedOn::Variable(defined))
                .into_iter()
                .flatten();
            defined.file == target || exporters.clone().any(|exporter| exporter.file == target)
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

    fn reach_exporter(&mut self, module: ModuleRef, binding: ExportBinding) {
        let (ModuleRef::File(file), Some(handed_on)) = (module, HandedOn::of(binding)) else {
            return;
        };
        let is_run_by_call = self.is_run_by_call[file.idx()];
        let mut exporters = self.exporters.get(&handed_on).into_iter().flatten();
        if exporters
            .any(|exporter| exporter.file == file && (!exporter.is_by_star || is_run_by_call))
        {
            self.evaluate(module);
        }
        self.reach_files_between(file, handed_on);
    }

    fn reads_this(&self, file: FileId, function: FnId) -> bool {
        let (hir, bound) = (self.input.files.hir(file), self.input.files.bound(file));
        if hir.runtime_function_kind(function) == FnKind::Arrow {
            return false;
        }
        bound.fns[function.idx()].contains_this
            || match &self.files[file.idx()] {
                Some(units) => units.this_positions.evaluates_own_this(hir, function),
                None => evaluates_own_this(hir, function),
            }
    }

    // Whether what the binding holds, when it is called as a member of an object, can look at that object.
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

    // Each of these says whether what it reached can look at the object that it is called on.
    fn reach_binding(&mut self, defined: Sym) -> bool {
        if let Some(&can_read_this) = self.reached_bindings.get(&defined) {
            return can_read_this;
        }
        let can_read_this = self.reach_new_binding(defined);
        self.reached_bindings.insert(defined, can_read_this);
        can_read_this
    }

    fn reach_new_binding(&mut self, defined: Sym) -> bool {
        let Sym { file, id } = defined;
        match self.input.graph.import_binding(file, id) {
            ImportBinding::Local => {}
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
                if let Some(module) = find_module_imported_from(self.input, file, id) {
                    self.evaluate(module);
                }
                return self.reach_name(export);
            }
            ImportBinding::Exports { module } => {
                self.reach_every_export(module);
                return true;
            }
            _ => return true,
        }
        let files = self.input.files;
        let unit = self.files[file.idx()]
            .as_ref()
            .and_then(|units| units.find_unit(files.hir(file), files.bound(file), id));
        self.bound_variables.insert(defined);
        self.reach_region(file, unit.map_or(TOP_LEVEL, |unit| unit + 1));
        self.can_read_this(defined)
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

    // The statements of the body that store under the name.
    fn reach_stored_name(&mut self, module: ModuleRef, name: Atom) -> bool {
        self.evaluate(module);
        if let ModuleRef::File(file) = module {
            self.names_read_from_objects.insert((file, name));
        }
        if let Some(found) = self.find_module(module) {
            let units = self
                .module_units(found)
                .stores
                .get(&name)
                .cloned()
                .unwrap_or_default();
            for unit in units {
                self.reach_region(found.0, unit + 1);
            }
        }
        !self.input.graph.ignores_this(module, name)
    }

    fn reach_name(&mut self, export: SyntheticExportId) -> bool {
        let export = *self.input.graph.synthetic_export(export);
        if self.has_stored_names(export.module) {
            return self.reach_stored_name(export.module, export.name);
        }
        self.evaluate(export.module);
        true
    }

    // A name of a CommonJS module that no expression is bound for: a key of a pattern, a member of a namespace object.
    fn reach_named_member(&mut self, module: ModuleRef, name: Atom) -> bool {
        self.evaluate(module);
        match self.input.graph.member_named(module, name) {
            Some(Member::Variable(export) | Member::Copy(export)) => self.reach_name(export),
            Some(Member::Binding(defined)) => self.reach_binding(defined),
            Some(Member::OnObject) => {
                self.look_at(module);
                false
            }
            Some(Member::Undefined | Member::Marker(_)) | None => false,
        }
    }

    fn reach_export(&mut self, module: ModuleRef, name: Atom) -> bool {
        let module = module_with_code(module);
        if let ModuleRef::File(file) = module {
            self.names_read_from_objects.insert((file, name));
        }
        if self.has_stored_names(module) {
            return self.reach_named_member(module, name);
        }
        match self
            .input
            .graph
            .find_export(module, name, &self.input.files.atoms)
        {
            ExportLookup::Found(binding) => {
                self.reach_exporter(module, binding);
                self.reach_export_binding(binding)
            }
            ExportLookup::Unknown => {
                self.reach_every_export(module);
                false
            }
            // The read asks the object of the module, which answers that it has no such name.
            ExportLookup::Absent => {
                self.evaluate(module);
                false
            }
        }
    }

    // Somebody looks at the object that shows what the module exports. It says nothing of whether the module is evaluated.
    fn look_at(&mut self, module: ModuleRef) {
        let module = module_with_code(module);
        let Some((file, index)) = self.find_module(module) else {
            return;
        };
        let units = self.files[file.idx()]
            .as_mut()
            .expect("a module of a scanned file");
        if !replace(&mut units.modules[index].is_every_export_reached, true) {
            self.newly_looked_at.push(module);
        }
    }

    fn reach_every_export(&mut self, module: ModuleRef) {
        self.evaluate(module);
        self.look_at(module);
    }

    // All that the object of an evaluated module shows.
    fn reach_what_object_shows(&mut self, (file, index): (FileId, usize)) {
        let graph = self.input.graph;
        let shown = self.module_units((file, index));
        let module = shown.module;
        let stores = shown.stores.values().flatten();
        let units: Vec<u32> = stores.chain(&shown.parts_of_object).copied().collect();
        for unit in units {
            self.reach_region(file, unit + 1);
        }
        // With an object of its own the module takes the names from the objects of the others.
        for &source in graph.name_sources(module) {
            self.reach_every_export(source);
        }
        if index != 0 {
            return;
        }
        for export in graph.exports(file) {
            if let Some(handed_on) = HandedOn::of(export.binding) {
                self.reach_files_between(file, handed_on);
            }
            self.reach_export_binding(export.binding);
        }
        // The names of these are known when they have run.
        for request in graph.requests(file) {
            if request.is_dynamic_star_export {
                self.reach_every_export(request.target);
            }
        }
    }

    fn is_body_reached(&self, found: (FileId, usize)) -> bool {
        let units = self.files[found.0.idx()]
            .as_ref()
            .expect("a module of a scanned file");
        units.is_region_reached[units.modules[found.1].body as usize]
    }

    // A name that stands for a name of a module with an object is a property like any other, so whoever takes names from such a module has an object too.
    fn follow_look(&mut self, module: ModuleRef) {
        if self.has_stored_names(module) {
            for taker in self.takers.get(&module).cloned().unwrap_or_default() {
                self.look_at(taker);
            }
        }
        if let Some(found) = self.find_module(module)
            && self.is_body_reached(found)
        {
            return self.reach_what_object_shows(found);
        }
        // The graph gives an object to all that such a module takes names from, whether or not the module runs.
        let graph = self.input.graph;
        for &source in graph.name_sources(module) {
            self.look_at(source);
        }
    }

    fn enter_body(&mut self, found: (FileId, usize)) {
        if found.1 == 0 {
            for name in self
                .names_awaiting_exporter
                .remove(&found.0)
                .unwrap_or_default()
            {
                self.reach_export(ModuleRef::File(found.0), name);
            }
        }
        let entered = self.module_units(found);
        let (module, is_looked_at) = (entered.module, entered.is_every_export_reached);
        if is_looked_at {
            self.reach_what_object_shows(found);
        } else if self.has_stored_names(module) && self.input.graph.shape(module) == Shape::Value {
            self.look_at(module);
        }
    }

    fn keep_module_object(&mut self, module: ModuleRef) {
        if self.find_module(module).is_some() && self.has_module_object.insert(module) {
            self.modules_with_objects.push(module);
            self.newly_handed_out.push(module);
            // Its `exports` shows the object.
            self.look_at(module);
        }
    }

    fn find_required_modules(&self, module: ModuleRef) -> Vec<ModuleRef> {
        let requests = self.input.graph.requests_of(module).iter();
        let required = requests.filter(|request| request.kind == ModuleRequestKind::Require);
        let mut found: Vec<ModuleRef> = required
            .map(|request| module_with_code(request.target))
            .collect();
        // A require under a name that the build cannot follow finds an entry point.
        if self.requires_under_computed_name(module) {
            let entry_points = self.input.sources.entry_points();
            found.extend(
                entry_points
                    .iter()
                    .map(|entry_point| ModuleRef::File(entry_point.file)),
            );
        }
        found
    }

    fn requires_under_computed_name(&self, module: ModuleRef) -> bool {
        let ModuleRef::File(file) = module else {
            return false;
        };
        self.input
            .files
            .analysis(file)
            .import_sites
            .iter()
            .any(|site| {
                matches!(
                    site.kind,
                    ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_)
                ) && matches!(
                    self.input.graph.find_site_answer(file, site.kind),
                    Some(SiteAnswer::Computed(_))
                )
            })
    }

    fn find_requirers(&mut self, module: ModuleRef) -> Vec<ModuleRef> {
        if self.requirers.is_none() {
            let mut requirers: FxHashMap<ModuleRef, Vec<ModuleRef>> = FxHashMap::default();
            for requirer in self.files.iter().flatten().flat_map(|units| &units.modules) {
                for target in self.find_required_modules(requirer.module) {
                    requirers.entry(target).or_default().push(requirer.module);
                }
            }
            self.requirers = Some(requirers);
        }
        let requirers = self
            .requirers
            .as_ref()
            .and_then(|requirers| requirers.get(&module));
        requirers.cloned().unwrap_or_default()
    }

    // Which object a read of `children` or `parent` is made on is not followed: every object that is handed out may be the one.
    fn follow_module_object(&mut self, module: ModuleRef) {
        if self.follows_children {
            for required in self.find_required_modules(module) {
                self.keep_module_object(required);
            }
        }
        if self.follows_parents || self.tests_own_parent.contains(&module) {
            for requirer in self.find_requirers(module) {
                self.keep_module_object(requirer);
            }
        }
    }

    fn reach_module_object(
        &mut self,
        file: FileId,
        owner: ModuleObjectOwner,
        object_use: ModuleObjectUse,
    ) {
        let follows = match object_use {
            // The record of the module answers these.
            ModuleObjectUse::Field(_) => return,
            // The host answers whether there is such an object, and it answers undefined in a program that names no way.
            ModuleObjectUse::Tested => return self.files_naming_ways.push(ModuleRef::File(file)),
            ModuleObjectUse::Object => None,
            ModuleObjectUse::ParentTested if owner == ModuleObjectOwner::OwnFile => {
                let own = ModuleRef::File(file);
                if self.tests_own_parent.insert(own) && self.has_module_object.contains(&own) {
                    self.newly_handed_out.push(own);
                }
                None
            }
            ModuleObjectUse::ParentTested | ModuleObjectUse::Parent => {
                Some(&mut self.follows_parents)
            }
            ModuleObjectUse::Children => Some(&mut self.follows_children),
        };
        if follows.is_some_and(|follows| !replace(follows, true)) {
            self.newly_handed_out.clone_from(&self.modules_with_objects);
        }
        if object_use != ModuleObjectUse::Object || owner == ModuleObjectOwner::EntryPoint {
            self.files_naming_ways.push(ModuleRef::File(file));
        }
        match owner {
            ModuleObjectOwner::OwnFile => self.keep_module_object(ModuleRef::File(file)),
            ModuleObjectOwner::EntryPoint => {
                for entry_point in self.input.sources.entry_points() {
                    self.keep_module_object(ModuleRef::File(entry_point.file));
                }
            }
            // Whatever led to the object has been counted.
            ModuleObjectOwner::Related => {}
        }
    }

    fn follow(&mut self, file: FileId, interest: Interest) {
        match interest {
            Interest::Unit(unit) => self.reach_region(file, unit + 1),
            Interest::LoadByUnknownName => self.reaches_load_by_unknown_name = true,
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
                self.required.insert((referrer, target));
                self.evaluate(target);
            }
            Interest::Request(module) => {
                if !self.is_request_waiting(file, module) {
                    self.evaluate(module);
                }
            }
            Interest::Star(target) => {
                if self.is_run_by_call[target.idx()] {
                    self.evaluate(ModuleRef::File(target));
                }
            }
            Interest::HandedOnNamespace(module) => {
                self.reach_files_between(file, HandedOn::Namespace(module));
            }
            Interest::RequiredName(exporter, name) => {
                let module = ModuleRef::File(exporter);
                if self
                    .find_module(module)
                    .is_some_and(|found| self.is_body_reached(found))
                {
                    self.reach_export(module, name);
                } else {
                    self.names_awaiting_exporter
                        .entry(exporter)
                        .or_default()
                        .push(name);
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
                self.reach_name(export);
            }
            Interest::CalledName(export, accessed) => {
                self.evaluate(accessed);
                let is_stored =
                    self.has_stored_names(self.input.graph.synthetic_export(export).module);
                if self.reach_name(export) && is_stored {
                    self.reach_every_export(accessed);
                }
            }
            Interest::ModuleObject(owner, object_use) => {
                self.reach_module_object(file, owner, object_use);
            }
        }
    }

    fn run(&mut self) {
        for entry_point in self.input.sources.entry_points() {
            self.reach_every_export(ModuleRef::File(entry_point.file));
        }
        loop {
            if let Some((file, region)) = self.pending.pop() {
                let units = self.files[file.idx()]
                    .as_mut()
                    .expect("a region of a scanned file");
                let body_of = units.find_module_with_body(region);
                for interest in take(&mut units.interests[region as usize]) {
                    self.follow(file, interest);
                }
                if let Some(index) = body_of {
                    self.enter_body((file, index));
                }
            } else if let Some(module) = self.newly_looked_at.pop() {
                self.follow_look(module);
            } else if let Some(module) = self.newly_handed_out.pop() {
                self.follow_module_object(module);
            } else {
                break;
            }
        }
    }
}

// The decisions of the bundler (src/bundler/barrel_imports.rs): a barrel is a file of a package with `"sideEffects": false`, no entry point, that defines none of the names it exports, and that no file exports with `export *`.
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

// In a bundle a file that `require()` or `import()` loads, and all that it asks for, is a function: a used import and every `export *` call it whatever "sideEffects" says.
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
    // In a file that is evaluated. Each keeps its name and throws.
    pub functions: FxHashSet<FunctionRef>,
    pub declarations: LeftOutDeclarations,
    // In order.
    pub files: Vec<FileId>,
    // The files, in order, of whose exports only some are read from the object of the module, and those.
    files_read_by_name: Vec<FileId>,
    names_read_from_objects: FxHashSet<(FileId, Atom)>,
    bound_variables: FxHashSet<Sym>,
    // No code that stays gives a loader a name that the build does not know.
    pub holds_every_load_by_unknown_name: bool,
}

impl LeftOutCode {
    /// The same code under the numbers that another program gives the files.
    pub(crate) fn in_other_program(
        &self,
        file_of: &dyn Fn(FileId) -> Option<FileId>,
    ) -> LeftOutCode {
        let mut files: Vec<FileId> = self
            .files
            .iter()
            .filter_map(|&file| file_of(file))
            .collect();
        files.sort_unstable();
        let mut files_read_by_name: Vec<FileId> = (self.files_read_by_name.iter())
            .filter_map(|&file| file_of(file))
            .collect();
        files_read_by_name.sort_unstable();
        LeftOutCode {
            functions: (self.functions.iter())
                .filter_map(|&function| {
                    Some(FunctionRef {
                        file: file_of(function.file)?,
                        ..function
                    })
                })
                .collect(),
            declarations: self.declarations.in_other_program(file_of),
            files,
            files_read_by_name,
            names_read_from_objects: (self.names_read_from_objects.iter())
                .filter_map(|&(file, name)| Some((file_of(file)?, name)))
                .collect(),
            bound_variables: (self.bound_variables.iter())
                .filter_map(|&symbol| {
                    Some(Sym {
                        file: file_of(symbol.file)?,
                        ..symbol
                    })
                })
                .collect(),
            holds_every_load_by_unknown_name: self.holds_every_load_by_unknown_name,
        }
    }

    // An import by a name is bound to the variable and asks nothing of the object of the module.
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

// What the code that is reached does with the modules that are evaluated.
#[derive(Default)]
pub(crate) struct ReachedModules {
    // Somebody looks at the object that shows what the module exports: the exports object, or the namespace object.
    pub looked_at: Vec<ModuleRef>,
    // A read that the build resolved hands out the object of the loader that stands for the module.
    pub with_module_objects: Vec<ModuleRef>,
    // Code that is reached in the file names `children` or `parent` of such an object, or `require.main` or `process.mainModule` for more than a test or a field that is a constant.
    pub naming_ways: Vec<ModuleRef>,
    // Modules that are written inside a file and that nothing calls.
    pub left_out_inner_modules: Vec<ModuleRef>,
    required: FxHashSet<(ModuleRef, ModuleRef)>,
}

impl ReachedModules {
    // A request that stands for calls of `require` goes with the last of them.
    pub(crate) fn keeps_request(&self, referrer: ModuleRef, request: &ModuleRequest) -> bool {
        request.kind != ModuleRequestKind::Require
            || self.required.contains(&(referrer, request.target))
    }
}

// A literal text that is evaluated is compiled like a file. It goes with the file that evaluates it, which may be such a text.
fn leave_out_texts_of_left_out_files(sources: &Sources, files: &mut Vec<FileId>) {
    loop {
        let is_left_out = |file: FileId| files.binary_search(&file).is_ok();
        let texts = sources.evaluated_texts();
        let mut found: Vec<FileId> = texts
            .filter(|&(evaluator, text)| is_left_out(evaluator) && !is_left_out(text))
            .map(|(_, text)| text)
            .collect();
        if found.is_empty() {
            return;
        }
        files.append(&mut found);
        files.sort_unstable();
        files.dedup();
    }
}

// What of the program nothing that it can run refers to, found the way a bundler finds it: by bindings, never by what a value is.
pub(crate) fn find_left_out_code(
    input: &ProgramReachInput<'_, '_>,
    in_parallel: InParallel<'_>,
) -> (LeftOutCode, ReachedModules) {
    let mut walk = Walk::new(input, in_parallel);
    walk.run();
    let mut left_out = LeftOutCode::default();
    let mut reached_modules = ReachedModules::default();
    for (index, units) in walk.files.iter().enumerate() {
        let Some(units) = units else {
            continue;
        };
        let file = FileId(index as u32);
        if !units.is_region_reached[TOP_LEVEL as usize] {
            left_out.files.push(file);
            let inner_modules = units.modules[1..].iter().map(|module| module.module);
            reached_modules.left_out_inner_modules.extend(inner_modules);
            continue;
        }
        if !units.modules[0].is_every_export_reached {
            left_out.files_read_by_name.push(file);
        }
        for module in &units.modules {
            if !units.is_region_reached[module.body as usize] {
                reached_modules.left_out_inner_modules.push(module.module);
            } else if module.is_every_export_reached {
                reached_modules.looked_at.push(module.module);
            }
        }
        let reached = units.is_region_reached[1..].iter();
        for ((functions, &part), &is_reached) in
            units.functions.iter().zip(&units.parts).zip(reached)
        {
            if is_reached {
                continue;
            }
            let functions = functions.iter();
            left_out
                .functions
                .extend(functions.map(|&function| FunctionRef { file, function }));
            let declarations = &mut left_out.declarations;
            match part {
                Part::Bodies | Part::InnerModule(_) => {}
                Part::Declarator(declarator) => declarations.leave_out_declarator(file, declarator),
                Part::Class(class) => declarations.leave_out_class(file, class),
                Part::Statement(statement) => {
                    declarations.leave_out_statement(file, input.files.hir(file), statement);
                }
            }
        }
    }
    leave_out_texts_of_left_out_files(input.sources, &mut left_out.files);
    let is_evaluated = |module: &ModuleRef| {
        walk.find_module(*module)
            .is_some_and(|found| walk.is_body_reached(found))
    };
    reached_modules.with_module_objects = walk
        .modules_with_objects
        .iter()
        .copied()
        .filter(is_evaluated)
        .collect();
    reached_modules.required = take(&mut walk.required);
    reached_modules.naming_ways = take(&mut walk.files_naming_ways);
    left_out.names_read_from_objects = walk.names_read_from_objects;
    left_out.bound_variables = walk.bound_variables;
    let loads_outside_units = |&file: &FileId| {
        walk.files[file.idx()].is_none()
            && parsed_source(input.files, file).is_none_or(|source| {
                source.loads_by_unknown_name || !source.unknown_names_at.is_empty()
            })
    };
    left_out.holds_every_load_by_unknown_name = !walk.reaches_load_by_unknown_name
        && !input.files.compiled_files().iter().any(loads_outside_units);
    (left_out, reached_modules)
}
