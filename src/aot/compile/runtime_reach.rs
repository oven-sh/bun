use core::mem::{replace, take};
use core::ops::Range;
use std::sync::{Arc, OnceLock};

use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, Decl, FnOwner, FunctionFlags, Parent, SymbolId,
};
use bun_sema::check::aot::FunctionRef;
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{
    self, CallId, ClassId, ExprId, ExprKind, Flags, FnId, FnKind, MemberKey, MemberKind,
    ModifierKind, PatId, PatKind, PropKey, PropKind, StmtKind, VarDeclId, VarKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::evaluates_own_this;
use bun_sema::program::{CodeAnswer, FileId, Files};
use bun_sema::util::SharedSort;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};

use super::program_reach::{TOP_LEVEL, find_parent_past_casts, is_only_read};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self};
use crate::builtins::{
    BuiltinNames, FileFacts, ImportTargets, Intrinsic, Platforms, ResolveInput, Resolved,
    RuntimeFunction, RuntimeModule, RuntimeUses, SourceDialect, resolve_within,
};
use crate::ir::{InParallel, for_each_mut};
use crate::load::Sources;
use crate::load::contents::load_names::find_library_modules_that_unknown_names_may_stand_for;
use crate::load::runtime_roots::uses_of_what_start_reads;
use crate::load::sources::{ParsedSource, SourceKind, parsed_source};
use crate::lower::{LeftOutDeclarations, collect_library_functions};
use crate::modules::{Candidates, ModuleGraph, ModuleRef, SiteAnswer};

#[cfg(test)]
mod known_regions_tests;
mod while_loading;
pub(crate) use while_loading::{LoadInput, ReachWhileLoading};

#[derive(Copy, Clone)]
pub(crate) struct LibraryTree<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub source: Option<&'a ParsedSource>,
}

pub(crate) enum SiteTarget {
    Module(ModuleRef),
    OneOf(Vec<ModuleRef>),
    AnyModule,
    Nothing,
}

pub(crate) trait Library<'s>: Sync {
    fn file_count(&self) -> usize;
    fn code_files(&self) -> &[FileId];
    fn atoms(&self) -> &Interner<'s>;
    fn tree(&self, file: FileId) -> Option<LibraryTree<'_, 's>>;
    fn version(&self, file: FileId) -> u32;
    fn kind(&self, file: FileId) -> SourceKind;
    fn find_site_target(&self, file: FileId, site: ImportSiteKind) -> Option<SiteTarget>;
    fn find_module_file(&self, module: RuntimeModule) -> Option<FileId>;
    fn find_function_file(&self, function: RuntimeFunction) -> Option<FileId>;
    fn runtime_module(&self, file: FileId) -> Option<RuntimeModule>;
    fn runtime_function(&self, file: FileId, export_name: &[u8]) -> Option<RuntimeFunction>;
}

pub(crate) struct LoadedLibrary<'a, 's> {
    pub files: &'a Files<'s>,
    pub sources: &'a Sources,
    pub graph: &'a ModuleGraph,
}

impl<'s> Library<'s> for LoadedLibrary<'_, 's> {
    fn file_count(&self) -> usize {
        self.files.modules.len()
    }

    fn code_files(&self) -> &[FileId] {
        self.files.compiled_files()
    }

    fn atoms(&self) -> &Interner<'s> {
        &self.files.atoms
    }

    fn tree(&self, file: FileId) -> Option<LibraryTree<'_, 's>> {
        Some(LibraryTree {
            hir: self.files.hir(file),
            bound: self.files.bound(file),
            analysis: self.files.analysis(file),
            source: parsed_source(self.files, file),
        })
    }

    fn version(&self, _file: FileId) -> u32 {
        0
    }

    fn kind(&self, file: FileId) -> SourceKind {
        self.sources.kind(file)
    }

    fn find_site_target(&self, file: FileId, site: ImportSiteKind) -> Option<SiteTarget> {
        Some(match self.graph.find_site_answer(file, site)? {
            SiteAnswer::Module(target) => SiteTarget::Module(target),
            SiteAnswer::Computed(Candidates::All) => SiteTarget::AnyModule,
            SiteAnswer::Computed(Candidates::Modules(candidates)) => {
                SiteTarget::OneOf(candidates.iter().map(|it| it.module).collect())
            }
            SiteAnswer::Failed(_) | SiteAnswer::Erased => SiteTarget::Nothing,
        })
    }

    fn find_module_file(&self, module: RuntimeModule) -> Option<FileId> {
        self.sources.runtime_module_file(module)
    }

    fn find_function_file(&self, _function: RuntimeFunction) -> Option<FileId> {
        None
    }

    fn runtime_module(&self, file: FileId) -> Option<RuntimeModule> {
        self.graph.runtime_module(file)
    }

    fn runtime_function(&self, file: FileId, export_name: &[u8]) -> Option<RuntimeFunction> {
        self.sources.runtime_function(file, export_name)
    }
}

#[derive(Copy, Clone)]
pub(crate) enum Application<'a, 's> {
    Bound {
        files: &'a Files<'s>,
        graph: &'a ModuleGraph,
    },
    Asks(&'a RuntimeUses),
}

pub(crate) struct ReachInput<'a, 's> {
    pub application: Application<'a, 's>,
    pub library: &'a dyn Library<'s>,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub used_at_start: &'a [BuiltinId],
    pub holds_what_unseen_code_finds: bool,
    pub can_load_code_at_run_time: bool,
    pub uses_of_kept_code: Option<&'a UsesOfKeptCode>,
}

pub(crate) type UsesOfKeptCode = FxHashMap<FileId, RuntimeUses>;

pub(crate) struct KeptCodeInput<'a, 's> {
    pub application: &'a Files<'s>,
    pub graph: &'a ModuleGraph,
    pub left_out_functions: &'a FxHashSet<FunctionRef>,
    pub left_out_declarations: &'a LeftOutDeclarations,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub replaced: &'a [u32],
    pub runs_tests: bool,
}

fn find_texts_left_out(input: &KeptCodeInput<'_, '_>) -> FxHashMap<FileId, Vec<Range<u32>>> {
    let mut texts: FxHashMap<FileId, Vec<Range<u32>>> = FxHashMap::default();
    for &FunctionRef { file, function } in input.left_out_functions {
        let hir = input.application.hir(file);
        let end = match input.application.bound(file).fns[function.idx()].owner {
            FnOwner::Expr(expression) => hir[expression].end,
            FnOwner::Stmt(statement) => hir[statement].loc.end,
            FnOwner::Member(member) => hir[member].loc.end,
            FnOwner::Type(_) | FnOwner::None => continue,
        };
        let mut modifiers =
            (hir[function].params.iter()).flat_map(|it| hir.param_modifiers(it).iter());
        if modifiers.any(|it| matches!(hir[it].kind, ModifierKind::Decorator(_))) {
            continue;
        }
        let start = match hir[function].kind {
            FnKind::Arrow => hir[function].text_start,
            _ => hir[function].anchor,
        };
        texts.entry(file).or_default().push(start..end);
    }
    for (file, declarator) in input.left_out_declarations.declarators_left_out() {
        let hir = input.application.hir(file);
        let kind = hir[declarator].kind;
        if !matches!(kind, VarKind::Var | VarKind::Let | VarKind::Const) {
            continue;
        }
        let Some(initializer) = hir[declarator].init.some() else {
            continue;
        };
        if !matches!(hir[initializer].kind, ExprKind::Class(_)) {
            let text = hir[initializer].pos..hir[initializer].end;
            texts.entry(file).or_default().push(text);
        }
    }
    texts
}

fn find_texts_kept(mut left_out: Vec<Range<u32>>) -> Vec<Range<u32>> {
    left_out.shared_sort_unstable_by_key(|text| (text.start, text.end));
    let mut kept = Vec::with_capacity(left_out.len() + 1);
    let mut start = 0;
    for text in left_out {
        if start < text.start {
            kept.push(start..text.start);
        }
        start = start.max(text.end);
    }
    kept.push(start..u32::MAX);
    kept
}

fn resolve_kept_code(
    input: &KeptCodeInput<'_, '_>,
    file: FileId,
    source: &ParsedSource,
    kept: &[Range<u32>],
) -> RuntimeUses {
    let application = input.application;
    let analysis = application.analysis(file);
    let answers = application
        .compiled(file)
        .map_or(&[][..], |it| it.code_answers);
    let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = analysis
        .import_sites
        .iter()
        .zip(answers)
        .map(|(site, answer)| {
            let module = match *answer {
                CodeAnswer::HostModule(id) => RuntimeModule::from_registry_id(id.0),
                _ => None,
            };
            (site.kind, module)
        })
        .collect();
    targets.shared_sort_unstable_by_key(|target| target.0);
    let resolve_input = ResolveInput {
        hir: application.hir(file),
        bound: application.bound(file),
        decisions: &analysis.decisions,
        atoms: &application.atoms,
        module_format: analysis.module_format,
        targets: &ImportTargets::new(&targets),
        names: input.names,
        platform: input.platform,
        dialect: SourceDialect::Program,
        replaced: input.replaced,
        runs_tests: input.runs_tests,
        holds_language: false,
        is_text_asked: true,
    };
    let resolved = resolve_within(&resolve_input, kept, &FileFacts::new(&resolve_input));
    if source.builtins.is_told_that_hooks_of_instanceof_may_exist() {
        resolved.note_that_hooks_of_instanceof_may_exist();
    }
    if source.builtins.is_told_that_tests_lay_names_above() {
        resolved.note_that_tests_lay_names_above();
    }
    resolved.uses().clone()
}

pub(crate) fn find_uses_of_kept_code(input: &KeptCodeInput<'_, '_>) -> Option<UsesOfKeptCode> {
    let application = input.application;
    let asking = application.compiled_files().iter().copied();
    let asking = asking.filter(|&file| !asks_nothing_of_library(application, input.graph, file));
    let asking = asking.filter_map(|file| Some((file, parsed_source(application, file)?)));
    let (letting_in, others): (Vec<_>, Vec<_>) =
        asking.partition(|(_, source)| source.builtins.uses().lets_in_what_nobody_names);
    let mut left_out = find_texts_left_out(input);
    if letting_in.is_empty() || !(letting_in.iter()).all(|(file, _)| left_out.contains_key(file)) {
        return None;
    }
    let mut found = UsesOfKeptCode::default();
    for (file, source) in letting_in.into_iter().chain(others) {
        let kept = find_texts_kept(left_out.remove(&file).unwrap_or_default());
        let uses = resolve_kept_code(input, file, source, &kept);
        if uses.lets_in_what_nobody_names {
            return None;
        }
        found.insert(file, uses);
    }
    Some(found)
}

pub(crate) struct ReachedRuntimeCode {
    is_file_reached: Vec<bool>,
    pub left_out_functions: FxHashSet<FunctionRef>,
}

impl ReachedRuntimeCode {
    pub(crate) fn is_file_reached(&self, file: FileId) -> bool {
        self.is_file_reached[file.idx()]
    }
}

#[derive(Clone)]
struct Unit {
    functions: SmallVec<[FnId; 1]>,
    id: Option<RuntimeFunction>,
}

#[derive(Clone)]
struct Piece {
    written_at: Range<u32>,
    unit: u32,
}

#[derive(Copy, Clone)]
enum Interest {
    Unit(u32),
    Evaluation(ModuleRef),
    Export(FileId, Atom),
    EveryExport(ModuleRef),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SymbolClass {
    Unit(u32),
    ExportObject(FileId),
    Export(FileId, Atom),
    Other,
}

enum HolderUse {
    Member(Atom),
    Initializer(VarDeclId),
    NothingRead,
    Other,
}

#[derive(Clone)]
struct FileUnits {
    is_library: bool,
    units: Vec<Unit>,
    pieces: Vec<Piece>,
    interests: Vec<Vec<Interest>>,
    sites: Vec<Vec<ImportSiteKind>>,
    named_exports: Vec<(Atom, Interest)>,
    is_region_reached: Vec<bool>,
    is_every_export_reached: bool,
}

impl FileUnits {
    fn without_code() -> FileUnits {
        FileUnits {
            is_library: false,
            units: Vec::new(),
            pieces: Vec::new(),
            interests: vec![Vec::new()],
            sites: vec![Vec::new()],
            named_exports: Vec::new(),
            is_region_reached: vec![false],
            is_every_export_reached: false,
        }
    }
}

struct FileScan<'a, 's> {
    input: &'a ReachInput<'a, 's>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    source: Option<&'a ParsedSource>,
    units: Vec<Unit>,
    pieces: Vec<Piece>,
    unit_of_function: FxHashMap<FnId, u32>,
    unit_of_class: FxHashMap<ClassId, u32>,
    classes: FxHashMap<SymbolId, SymbolClass>,
    export_object: Option<ExportObject>,
    exported_functions: Vec<(Atom, u32)>,
    names_of_exported_bindings: FxHashMap<ExprId, Atom>,
}

#[derive(Copy, Clone)]
struct ExportObject {
    literal: ExprId,
    binding: Option<(SymbolId, ExprId)>,
}

impl<'a, 's> FileScan<'a, 's> {
    fn new(
        input: &'a ReachInput<'a, 's>,
        file: FileId,
        tree: LibraryTree<'a, 's>,
    ) -> FileScan<'a, 's> {
        FileScan {
            input,
            file,
            hir: tree.hir,
            bound: tree.bound,
            analysis: tree.analysis,
            source: tree.source,
            units: Vec::new(),
            pieces: Vec::new(),
            unit_of_function: FxHashMap::default(),
            unit_of_class: FxHashMap::default(),
            classes: FxHashMap::default(),
            export_object: None,
            exported_functions: Vec::new(),
            names_of_exported_bindings: FxHashMap::default(),
        }
    }

    fn add_unit(&mut self, function: FnId, written_at: Range<u32>, id: Option<RuntimeFunction>) {
        let unit = self.units.len() as u32;
        self.unit_of_function.insert(function, unit);
        self.pieces.push(Piece { written_at, unit });
        self.units.push(Unit {
            functions: smallvec![function],
            id,
        });
    }

    fn add_class_unit(&mut self, class: ClassId) {
        let hir = self.hir;
        let unit = self.units.len() as u32;
        let mut functions = SmallVec::new();
        for member in hir[class].members.iter() {
            let member = &hir[member];
            let has_function = match member.kind {
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => {
                    !member.func.is_none() && hir::has_body(&hir[member.func])
                }
                _ => false,
            };
            let has_plain_key = !matches!(member.key, PropKey::Computed(_));
            let mut modifiers = member.modifiers.iter();
            let is_decorated =
                modifiers.any(|it| matches!(hir[it].kind, ModifierKind::Decorator(_)));
            if has_function && has_plain_key && !is_decorated {
                functions.push(member.func);
                let written_at = member.loc.pos..member.loc.end;
                self.pieces.push(Piece { written_at, unit });
            }
        }
        if functions.is_empty() {
            return;
        }
        self.unit_of_class.insert(class, unit);
        self.units.push(Unit {
            functions,
            id: None,
        });
    }

    fn collect_library_units(&mut self) {
        let library = self.input.library;
        let Some(source) = self.source else {
            return;
        };
        let (hir, atoms) = (self.hir, library.atoms());
        for (function, written_at) in
            collect_library_functions(hir, self.analysis, atoms, &source.builtins)
        {
            let func = &hir[function];
            let is_named_export = func.flags.contains(Flags::EXPORT) && !func.name.is_none();
            let export_name = is_named_export.then(|| atoms.bytes(func.name));
            let id = export_name.and_then(|name| library.runtime_function(self.file, name));
            self.add_unit(function, written_at, id);
        }
    }

    fn is_stable(&self, binding: Binding) -> bool {
        match binding {
            Binding::Symbol(symbol) => self.bound.is_stable_binding(symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        }
    }

    fn collect_module_units(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        if !bound.runtime.eval_scopes().is_empty() {
            return;
        }
        self.export_object = self.find_export_object();
        self.add_exported_functions();
        let is_plain_declaration = |flags: Flags, declaration: Decl| {
            let symbol = bound.declared_symbol(declaration);
            !flags.intersects(Flags::AMBIENT | Flags::EXPORT | Flags::DEFAULT)
                && !symbol.is_none()
                && bound.is_stable_binding(symbol)
        };
        for statement in hir.ids(hir.body) {
            if self.analysis.decisions.is_dead_stmt(statement) {
                continue;
            }
            match hir[statement].kind {
                StmtKind::Fn(function) => {
                    let func = &hir[function];
                    if hir::has_body(func) && is_plain_declaration(func.flags, Decl::Fn(function)) {
                        let written_at = hir[statement].loc;
                        self.add_unit(function, written_at.pos..written_at.end, None);
                    }
                }
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        self.add_function_constant(declaration);
                    }
                }
                StmtKind::Class(class) => {
                    if is_plain_declaration(hir[class].flags, Decl::Class(class)) {
                        self.add_class_unit(class);
                    }
                }
                _ => {}
            }
        }
        self.add_statements_that_set_up_units();
    }

    fn find_unit_behind(&mut self, object: ExprId) -> Option<u32> {
        let hir = self.hir;
        let mut object = hir.skip_type_assertions(object);
        if let Some((holder, MemberKey::Name(name))) = hir.member_key(object)
            && name == known::prototype
        {
            object = hir.skip_type_assertions(holder);
        }
        if !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let Binding::Symbol(symbol) = self.bound.binding(object) else {
            return None;
        };
        match self.classify_symbol(symbol) {
            SymbolClass::Unit(unit) => Some(unit),
            SymbolClass::ExportObject(_) | SymbolClass::Export(..) | SymbolClass::Other => None,
        }
    }

    fn is_evaluated_without_calls(
        &self,
        expression: ExprId,
        functions: &mut SmallVec<[FnId; 4]>,
    ) -> bool {
        let hir = self.hir;
        let is_name =
            |it: ExprId| matches!(hir[hir.skip_type_assertions(it)].kind, ExprKind::Ident(_));
        let expression = hir.skip_type_assertions(expression);
        match hir[expression].kind {
            ExprKind::Fn(function) => {
                functions.push(function);
                true
            }
            ExprKind::Ident(_)
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Dot { .. } => matches!(
                hir.member_key(expression),
                Some((object, MemberKey::Name(name))) if name == known::prototype && is_name(object)
            ),
            ExprKind::Object(properties) => properties.iter().all(|property| {
                let property = &hir[property];
                let has_plain_key = match property.key {
                    PropKey::Name(_) => true,
                    PropKey::Computed(key) => is_name(key),
                    PropKey::None | PropKey::Private(_) => false,
                };
                has_plain_key
                    && property.kind != PropKind::Spread
                    && self.is_evaluated_without_calls(property.value, functions)
            }),
            _ => false,
        }
    }

    fn find_called_builtin(&self, callee: ExprId) -> Option<BuiltinId> {
        let source = self.source?;
        match source.builtins.of_expr(callee)? {
            Resolved::Intrinsic(Intrinsic::PrivateGlobal) => {
                let ExprKind::Ident(spelling) = self.hir[callee].kind else {
                    return None;
                };
                let name = self.input.names.get_private(spelling)?;
                table::own_member(BuiltinId::PrivateGlobals, name)
            }
            Resolved::Intrinsic(Intrinsic::PrivateName) => {
                let (holder, MemberKey::Name(spelling)) = self.hir.member_key(callee)? else {
                    return None;
                };
                let holder = self.hir.skip_type_assertions(holder);
                let holder = source.builtins.builtin_of_expression(holder)?;
                table::own_member(holder, self.input.names.get_private(spelling)?)
            }
            Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_) => {
                source.builtins.builtin_of_expression(callee)
            }
        }
    }

    fn find_unit_that_is_set_up(
        &mut self,
        expression: ExprId,
        functions: &mut SmallVec<[FnId; 4]>,
    ) -> Option<u32> {
        let hir = self.hir;
        match hir[expression].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                let (object, key) = hir.member_key(target)?;
                let has_plain_key = match key {
                    MemberKey::Name(_) => true,
                    MemberKey::Computed(key) => {
                        matches!(hir[hir.skip_type_assertions(key)].kind, ExprKind::Ident(_))
                    }
                    MemberKey::PrivateName(_) => false,
                };
                let unit = self.find_unit_behind(object)?;
                (has_plain_key && self.is_evaluated_without_calls(value, functions)).then_some(unit)
            }
            ExprKind::Call(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let builtin = self.find_called_builtin(callee)?;
                let sets_up_first_operand = matches!(
                    table::canonical_id(builtin),
                    BuiltinId::ObjectDefineProperty
                        | BuiltinId::ObjectDefineProperties
                        | BuiltinId::ObjectSetPrototypeOf
                        | BuiltinId::PrivateGlobalsToClass
                );
                let mut operands = hir.ids(hir[call].args);
                let unit = self.find_unit_behind(operands.next()?)?;
                let is_plain = operands.all(|it| self.is_evaluated_without_calls(it, functions));
                (sets_up_first_operand && is_plain).then_some(unit)
            }
            _ => None,
        }
    }

    fn add_statements_that_set_up_units(&mut self) {
        let hir = self.hir;
        for statement in hir.ids(hir.body) {
            let StmtKind::Expr(expression) = hir[statement].kind else {
                continue;
            };
            if self.analysis.decisions.is_dead_stmt(statement) {
                continue;
            }
            let mut functions = SmallVec::new();
            let Some(unit) = self.find_unit_that_is_set_up(expression, &mut functions) else {
                continue;
            };
            let written_at = hir[statement].loc;
            self.pieces.push(Piece {
                written_at: written_at.pos..written_at.end,
                unit,
            });
            for function in functions {
                self.unit_of_function.insert(function, unit);
                self.units[unit as usize].functions.push(function);
            }
        }
    }

    fn add_function_constant(&mut self, declaration: VarDeclId) {
        let hir = self.hir;
        let node = &hir[declaration];
        if node.init.is_none() {
            return;
        }
        let initializer = hir.skip_type_assertions(node.init);
        let ExprKind::Fn(function) = hir[initializer].kind else {
            return;
        };
        let is_plain_name = matches!(hir[node.pat].kind, PatKind::Ident(_))
            && !node.flags.intersects(Flags::AMBIENT | Flags::EXPORT);
        if is_plain_name && self.is_stable(self.bound.initialized_binding(node.pat)) {
            let written_at = hir[initializer].pos..hir[initializer].end;
            self.add_unit(function, written_at, None);
        }
    }

    fn find_export_object(&self) -> Option<ExportObject> {
        let hir = self.hir;
        let mut statements = hir.ids(hir.body);
        let exported = statements.find_map(|statement| match hir[statement].kind {
            StmtKind::ExportDefault(exported) => Some(hir.skip_type_assertions(exported)),
            _ => None,
        })?;
        if matches!(hir[exported].kind, ExprKind::Object(_)) {
            return Some(ExportObject {
                literal: exported,
                binding: None,
            });
        }
        let Binding::Symbol(symbol) = self.bound.binding(exported) else {
            return None;
        };
        if !self.bound.is_stable_binding(symbol) {
            return None;
        }
        let BindingInitializer::Expression(initializer) =
            self.bound.binding_initializer(hir, symbol)
        else {
            return None;
        };
        let literal = hir.skip_type_assertions(initializer);
        matches!(hir[literal].kind, ExprKind::Object(_)).then_some(ExportObject {
            literal,
            binding: Some((symbol, exported)),
        })
    }

    fn add_exported_functions(&mut self) {
        let hir = self.hir;
        let Some(ExprKind::Object(properties)) = self.export_object.map(|it| hir[it.literal].kind)
        else {
            return;
        };
        for property in properties.iter() {
            let property = &hir[property];
            if property.value.is_none() {
                continue;
            }
            let value = hir.skip_type_assertions(property.value);
            match (property.key, hir[value].kind, property.kind) {
                (PropKey::Name(name), ExprKind::Fn(function), _) => {
                    self.exported_functions
                        .push((name, self.units.len() as u32));
                    self.add_unit(function, hir[value].pos..hir[value].end, None);
                }
                (PropKey::Name(name), ExprKind::Ident(_), PropKind::Init | PropKind::Shorthand) => {
                    self.names_of_exported_bindings.insert(value, name);
                }
                _ => {}
            }
        }
    }

    fn region_of(&self, position: u32) -> u32 {
        let following = self
            .pieces
            .partition_point(|piece| piece.written_at.start <= position);
        match following.checked_sub(1).map(|index| &self.pieces[index]) {
            Some(piece) if position < piece.written_at.end => piece.unit + 1,
            Some(_) | None => TOP_LEVEL,
        }
    }

    fn find_loaded_file(&self, call: ExprId) -> Option<FileId> {
        let sites = [
            ImportSiteKind::Require(call),
            ImportSiteKind::ImportMetaRequire(call),
            ImportSiteKind::GetBuiltinModule(call),
        ];
        let library = self.input.library;
        let mut answers = sites
            .into_iter()
            .filter_map(|site| library.find_site_target(self.file, site));
        match answers.next()? {
            SiteTarget::Module(
                ModuleRef::File(target)
                | ModuleRef::Inner { file: target, .. }
                | ModuleRef::Face(target)
                | ModuleRef::Check(target),
            ) => Some(target),
            SiteTarget::Module(ModuleRef::Runtime(_) | ModuleRef::External { .. })
            | SiteTarget::OneOf(_)
            | SiteTarget::AnyModule
            | SiteTarget::Nothing => None,
        }
    }

    fn classify_symbol(&mut self, symbol: SymbolId) -> SymbolClass {
        if let Some(&class) = self.classes.get(&symbol) {
            return class;
        }
        let class = self.compute_symbol_class(symbol);
        self.classes.insert(symbol, class);
        class
    }

    fn compute_symbol_class(&self, symbol: SymbolId) -> SymbolClass {
        let hir = self.hir;
        let exported = self.export_object.and_then(|it| it.binding);
        if exported.is_some_and(|it| it.0 == symbol) {
            return SymbolClass::ExportObject(self.file);
        }
        if !self.bound.is_stable_binding(symbol) {
            return SymbolClass::Other;
        }
        let unit_of = |function: FnId| match self.unit_of_function.get(&function) {
            Some(&unit) => SymbolClass::Unit(unit),
            None => SymbolClass::Other,
        };
        match self.bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(function) => unit_of(function),
            BindingInitializer::Expression(initializer) => {
                let initializer = hir.skip_type_assertions(initializer);
                match hir[initializer].kind {
                    ExprKind::Fn(function) => unit_of(function),
                    _ => match self.find_loaded_file(initializer) {
                        Some(target) => SymbolClass::ExportObject(target),
                        None => SymbolClass::Other,
                    },
                }
            }
            BindingInitializer::PatternProperty { source, path } => {
                let target = self.find_loaded_file(hir.skip_type_assertions(source));
                match (target, path.first()) {
                    (Some(target), Some(&name)) => SymbolClass::Export(target, name),
                    (Some(_) | None, _) => SymbolClass::Other,
                }
            }
            BindingInitializer::Class(class) => match self.unit_of_class.get(&class) {
                Some(&unit) => SymbolClass::Unit(unit),
                None => SymbolClass::Other,
            },
            _ => SymbolClass::Other,
        }
    }

    fn classify_holder_use(&self, holder: ExprId) -> HolderUse {
        let (hir, bound) = (self.hir, self.bound);
        let (holder, parent) = find_parent_past_casts(hir, bound, holder);
        let parent = match parent {
            Parent::Expr(parent) => parent,
            Parent::VarInit(declaration) => return HolderUse::Initializer(declaration),
            Parent::Stmt(statement) if matches!(hir[statement].kind, StmtKind::Expr(_)) => {
                return HolderUse::NothingRead;
            }
            _ => return HolderUse::Other,
        };
        match (hir[parent].kind, hir.member_key(parent)) {
            (_, Some((object, MemberKey::Name(name))))
                if object == holder && is_only_read(hir, bound, parent) =>
            {
                HolderUse::Member(name)
            }
            (ExprKind::Call(call), _) if self.is_only_looked_at(call, holder) => {
                HolderUse::NothingRead
            }
            _ => HolderUse::Other,
        }
    }

    fn is_only_looked_at(&self, call: CallId, operand: ExprId) -> bool {
        let hir = self.hir;
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = self.find_called_builtin(callee);
        hir.ids(hir[call].args).next() == Some(operand)
            && matches!(
                builtin.map(table::canonical_id),
                Some(
                    BuiltinId::ObjectDefineProperty
                        | BuiltinId::ObjectDefineProperties
                        | BuiltinId::ReflectDefineProperty
                        | BuiltinId::ObjectKeys
                        | BuiltinId::ObjectGetOwnPropertyNames
                        | BuiltinId::ReflectOwnKeys
                )
            )
    }

    fn is_function_only_looked_at(&self, reference: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let call = match bound.parent_of_expr(reference) {
            Parent::Stmt(statement) => {
                return matches!(hir[statement].kind, StmtKind::If { test, .. } if test == reference);
            }
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Call(call) if hir[call].callee != reference => call,
                _ => return false,
            },
            _ => return false,
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let Binding::Symbol(called) = bound.binding(callee) else {
            return false;
        };
        let BindingInitializer::Function(function) = bound.binding_initializer(hir, called) else {
            return false;
        };
        let flags = bound.function_flags(function);
        let uses_arguments = flags.contains(FunctionFlags::USES_ARGUMENTS);
        let mut operands = hir.ids(hir[call].args);
        let has_spread = operands.any(|it| matches!(hir[it].kind, ExprKind::Spread(_)));
        if !bound.is_stable_binding(called) || uses_arguments || has_spread {
            return false;
        }
        let Some(index) = hir.ids(hir[call].args).position(|it| it == reference) else {
            return false;
        };
        let Some(parameter) = hir[function].params.iter().nth(index) else {
            return false;
        };
        let parameter = &hir[parameter];
        let symbol = bound.declared_symbol(Decl::Param(parameter.pat));
        if !matches!(hir[parameter.pat].kind, PatKind::Ident(_)) || !bound.is_stable_binding(symbol)
        {
            return false;
        }
        let mut reads = (0..hir.exprs.len() as u32).map(ExprId).filter(|&it| {
            matches!(hir[it].kind, ExprKind::Ident(_))
                && bound.binding(it) == Binding::Symbol(symbol)
        });
        reads.all(|read| match bound.parent_of_expr(read) {
            Parent::Expr(parent) => {
                matches!(hir[parent].kind, ExprKind::Call(call) if self.is_only_looked_at(call, read))
            }
            _ => false,
        })
    }

    fn is_followed_by_references(&mut self, name: PatId) -> bool {
        match self.bound.initialized_binding(name) {
            Binding::Symbol(symbol) => self.classify_symbol(symbol) != SymbolClass::Other,
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
        }
    }

    fn add_initialized_names(
        &mut self,
        declaration: VarDeclId,
        target: FileId,
        interests: &mut Vec<Interest>,
    ) {
        let hir = self.hir;
        let pattern = hir[declaration].pat;
        let every_export = Interest::EveryExport(ModuleRef::File(target));
        match hir[pattern].kind {
            PatKind::Ident(_) if self.is_followed_by_references(pattern) => {}
            PatKind::Object(properties) => {
                for property in properties.iter() {
                    let property = &hir[property];
                    match property.key {
                        PropKey::Name(name) if !property.is_rest => {
                            let is_name = matches!(hir[property.value].kind, PatKind::Ident(_));
                            if !(is_name && self.is_followed_by_references(property.value)) {
                                interests.push(Interest::Export(target, name));
                            }
                        }
                        _ => interests.push(every_export),
                    }
                }
            }
            _ => interests.push(every_export),
        }
    }

    fn add_site(&mut self, site: ImportSiteKind, interests: &mut Vec<Interest>) {
        let target = match self.input.library.find_site_target(self.file, site) {
            Some(SiteTarget::Module(target)) => target,
            Some(SiteTarget::OneOf(candidates)) => {
                interests.extend(candidates.into_iter().map(Interest::EveryExport));
                return;
            }
            Some(SiteTarget::AnyModule | SiteTarget::Nothing) | None => return,
        };
        let loaded = match site {
            ImportSiteKind::Require(call)
            | ImportSiteKind::ImportMetaRequire(call)
            | ImportSiteKind::GetBuiltinModule(call) => Some(call),
            _ => None,
        };
        let (Some(call), ModuleRef::File(file)) = (loaded, target) else {
            interests.push(Interest::EveryExport(target));
            return;
        };
        interests.push(Interest::Evaluation(target));
        match self.classify_holder_use(call) {
            HolderUse::Member(name) => interests.push(Interest::Export(file, name)),
            HolderUse::Initializer(declaration) => {
                self.add_initialized_names(declaration, file, interests);
            }
            HolderUse::NothingRead => {}
            HolderUse::Other => interests.push(Interest::EveryExport(target)),
        }
    }

    fn add_named_exports(&mut self, named_exports: &mut Vec<(Atom, Interest)>) {
        let (hir, bound) = (self.hir, self.bound);
        for statement in hir.ids(hir.body) {
            let StmtKind::ExportNamed(export) = hir[statement].kind else {
                continue;
            };
            let clause = &hir[export];
            if clause.has_module_specifier || clause.type_only {
                continue;
            }
            for item in clause.items.iter() {
                let Binding::Symbol(symbol) = bound.exported_binding(item) else {
                    continue;
                };
                let interest = match self.classify_symbol(symbol) {
                    SymbolClass::Other => Interest::Evaluation(ModuleRef::File(self.file)),
                    SymbolClass::Unit(unit) => Interest::Unit(unit),
                    SymbolClass::Export(target, name) => Interest::Export(target, name),
                    SymbolClass::ExportObject(target) => {
                        Interest::EveryExport(ModuleRef::File(target))
                    }
                };
                named_exports.push((hir[item].exported, interest));
            }
        }
    }

    fn add_names_made_by_evaluation(&self, named_exports: &mut Vec<(Atom, Interest)>) {
        let hir = self.hir;
        let Some(ExprKind::Object(properties)) = self.export_object.map(|it| hir[it.literal].kind)
        else {
            return;
        };
        let mut listed: FxHashSet<Atom> = named_exports.iter().map(|export| export.0).collect();
        for property in properties.iter() {
            if let PropKey::Name(name) = hir[property].key
                && listed.insert(name)
            {
                named_exports.push((name, Interest::Evaluation(ModuleRef::File(self.file))));
            }
        }
    }

    fn scan(mut self) -> FileUnits {
        let is_library = match self.input.library.kind(self.file) {
            SourceKind::RuntimeFunctions => {
                self.collect_library_units();
                true
            }
            SourceKind::RuntimeModule(_) => {
                self.collect_module_units();
                false
            }
            _ => return FileUnits::without_code(),
        };
        self.pieces
            .shared_sort_unstable_by_key(|piece| piece.written_at.start);
        let region_count = self.units.len() + 1;
        let mut interests: Vec<Vec<Interest>> = vec![Vec::new(); region_count];
        let mut sites: Vec<Vec<ImportSiteKind>> = vec![Vec::new(); region_count];
        let mut named_exports = Vec::new();

        let (hir, bound) = (self.hir, self.bound);
        for reference in (0..hir.exprs.len() as u32).map(ExprId) {
            if !matches!(hir[reference].kind, ExprKind::Ident(_)) {
                continue;
            }
            let Binding::Symbol(symbol) = bound.binding(reference) else {
                continue;
            };
            let is_evaluated = bound.is_evaluated_ident(reference)
                && !self.analysis.decisions.is_dead_expr(reference)
                && !bound.is_in_type_query(reference);
            let is_export = |it: ExportObject| it.binding.is_some_and(|it| it.1 == reference);
            if !is_evaluated || self.export_object.is_some_and(is_export) {
                continue;
            }
            let interest = match self.classify_symbol(symbol) {
                SymbolClass::Other => continue,
                SymbolClass::Unit(_) if self.is_function_only_looked_at(reference) => continue,
                SymbolClass::Unit(unit) => Interest::Unit(unit),
                SymbolClass::Export(target, name) => Interest::Export(target, name),
                SymbolClass::ExportObject(target) => match self.classify_holder_use(reference) {
                    HolderUse::Member(name) => Interest::Export(target, name),
                    HolderUse::NothingRead => continue,
                    HolderUse::Initializer(declaration) => {
                        let region = self.region_of(hir[reference].pos) as usize;
                        self.add_initialized_names(declaration, target, &mut interests[region]);
                        continue;
                    }
                    HolderUse::Other => Interest::EveryExport(ModuleRef::File(target)),
                },
            };
            match self.names_of_exported_bindings.get(&reference) {
                Some(&name) => named_exports.push((name, interest)),
                None => interests[self.region_of(hir[reference].pos) as usize].push(interest),
            }
        }
        if !is_library {
            self.add_named_exports(&mut named_exports);
        }
        let exported_functions = self.exported_functions.iter();
        named_exports.extend(exported_functions.map(|&(name, unit)| (name, Interest::Unit(unit))));
        self.add_names_made_by_evaluation(&mut named_exports);
        let analysis = self.analysis;
        for site in analysis.import_sites {
            let region = match site.kind.call() {
                Some(call) if analysis.decisions.is_dead_expr(call) => continue,
                Some(call) => self.region_of(hir[call].pos),
                None => TOP_LEVEL,
            };
            sites[region as usize].push(site.kind);
            self.add_site(site.kind, &mut interests[region as usize]);
        }
        FileUnits {
            is_library,
            units: self.units,
            pieces: self.pieces,
            interests,
            sites,
            named_exports,
            is_region_reached: vec![false; region_count],
            is_every_export_reached: false,
        }
    }
}

struct KnownFile {
    version: u32,
    units: FileUnits,
    uses: Vec<Option<RuntimeUses>>,
    facts: Arc<OnceLock<FileFacts>>,
}

#[derive(Default)]
pub(crate) struct KnownRegions {
    files: FxHashMap<FileId, KnownFile>,
}

impl KnownRegions {
    fn forget_files_laid_again(&mut self, version_of: &dyn Fn(FileId) -> u32) {
        self.files
            .retain(|&file, known| known.version == version_of(file));
    }

    fn renumbered(self, find: &dyn Fn(FileId) -> Option<FileId>) -> KnownRegions {
        let find_module = |module: ModuleRef| match module {
            ModuleRef::File(file) => find(file).map(ModuleRef::File),
            _ => Some(module),
        };
        let renumber = |interest: Interest| match interest {
            Interest::Unit(_) => Some(interest),
            Interest::Evaluation(module) => find_module(module).map(Interest::Evaluation),
            Interest::Export(file, name) => find(file).map(|file| Interest::Export(file, name)),
            Interest::EveryExport(module) => find_module(module).map(Interest::EveryExport),
        };
        let files = self.files.into_iter().filter_map(|(file, mut known)| {
            let file = find(file)?;
            let evaluation = Interest::Evaluation(ModuleRef::File(file));
            for interests in &mut known.units.interests {
                *interests = interests.iter().filter_map(|&it| renumber(it)).collect();
            }
            for (_, interest) in &mut known.units.named_exports {
                *interest = renumber(*interest).unwrap_or(evaluation);
            }
            known.version = 0;
            Some((file, known))
        });
        KnownRegions {
            files: files.collect(),
        }
    }
}

struct Walk<'a, 's> {
    input: &'a ReachInput<'a, 's>,
    known: Option<&'a mut KnownRegions>,
    files: Vec<Option<Box<FileUnits>>>,
    facts: Vec<Option<Arc<OnceLock<FileFacts>>>>,
    function_by_id: FxHashMap<RuntimeFunction, (FileId, u32)>,
    is_file_reached: Vec<bool>,
    reads_imports_by_name: bool,
    pending: Vec<(FileId, u32)>,
    notes_imports: bool,
    asking_file: Option<FileId>,
    imports: Vec<(FileId, FileId)>,
}

struct RegionText {
    file: FileId,
    region: u32,
    ranges: Vec<Range<u32>>,
    targets: Vec<(ImportSiteKind, Option<RuntimeModule>)>,
}

fn never_runs(graph: &ModuleGraph, file: FileId) -> bool {
    graph.is_left_out(ModuleRef::File(file)) && !graph.is_placeholder(file)
}

fn asks_nothing_of_library(application: &Files<'_>, graph: &ModuleGraph, file: FileId) -> bool {
    never_runs(graph, file)
        && application.compiled(file).is_some_and(|compiled| {
            let mut answers = compiled.code_answers.iter();
            answers.all(|answer| matches!(answer, CodeAnswer::File(_) | CodeAnswer::Erased))
        })
}

pub(super) fn loads_modules_by_computed_names(
    application: &Files<'_>,
    graph: &ModuleGraph,
) -> bool {
    let files = application.compiled_files().iter();
    let mut files = files.filter(|&&file| !never_runs(graph, file));
    files.any(|&file| {
        let analysis = application.analysis(file);
        !graph.has_record(file)
            || parsed_source(application, file).is_none_or(|it| it.builtins.loads_unknown_modules())
            || analysis.import_sites.iter().any(|site| {
                matches!(
                    graph.find_site_answer(file, site.kind),
                    Some(SiteAnswer::Computed(candidates))
                        if !candidates.hold_every_name(analysis, &site.specifier)
                            && (graph)
                                .find_why_name_is_path_alone(application, file, site.specifier_node)
                                .is_none()
                )
            })
    })
}

pub(crate) fn find_reached_runtime_code(
    input: &ReachInput<'_, '_>,
    mut known: Option<KnownRegions>,
    in_parallel: InParallel<'_>,
) -> ReachedRuntimeCode {
    let mut walk = Walk::new(input, known.as_mut());
    walk.run(in_parallel);
    walk.finish()
}

impl<'a, 's> Walk<'a, 's> {
    fn new(input: &'a ReachInput<'a, 's>, known: Option<&'a mut KnownRegions>) -> Walk<'a, 's> {
        let file_count = input.library.file_count();
        let mut walk = Walk {
            input,
            known,
            files: (0..file_count).map(|_| None).collect(),
            facts: vec![None; file_count],
            function_by_id: FxHashMap::default(),
            is_file_reached: vec![false; file_count],
            reads_imports_by_name: false,
            pending: Vec::new(),
            notes_imports: false,
            asking_file: None,
            imports: Vec::new(),
        };
        for &file in input.library.code_files() {
            if input.library.kind(file) != SourceKind::RuntimeFunctions {
                continue;
            }
            let numbered = (0u32..).zip(&walk.units_of(file).units);
            let ids = numbered.filter_map(|(index, unit)| Some((unit.id?, (file, index))));
            let ids: Vec<(RuntimeFunction, (FileId, u32))> = ids.collect();
            walk.function_by_id.extend(ids);
        }
        walk
    }

    fn run(&mut self, in_parallel: InParallel<'_>) {
        self.reach_roots();
        while !self.pending.is_empty() {
            self.visit_pending_regions(in_parallel);
        }
    }

    fn scan(&mut self, file: FileId) -> FileUnits {
        let input = self.input;
        let Some(tree) = input.library.tree(file) else {
            return FileUnits::without_code();
        };
        let Some(known) = &mut self.known else {
            self.facts[file.idx()] = Some(Arc::default());
            return FileScan::new(input, file, tree).scan();
        };
        let version = input.library.version(file);
        if known
            .files
            .get(&file)
            .is_none_or(|it| it.version != version)
        {
            let units = FileScan::new(input, file, tree).scan();
            let known_file = KnownFile {
                version,
                uses: vec![None; units.interests.len()],
                units,
                facts: Arc::default(),
            };
            known.files.insert(file, known_file);
        }
        let known_file = &known.files[&file];
        self.facts[file.idx()] = Some(Arc::clone(&known_file.facts));
        known_file.units.clone()
    }

    fn units_of(&mut self, file: FileId) -> &mut FileUnits {
        if self.files[file.idx()].is_none() {
            let units = self.scan(file);
            self.files[file.idx()] = Some(Box::new(units));
        }
        self.files[file.idx()]
            .as_mut()
            .expect("the file was scanned")
    }

    fn note_import(&mut self, imported: Option<FileId>) {
        if let (Some(importer), Some(imported)) = (self.asking_file, imported) {
            self.imports.push((importer, imported));
        }
    }

    fn reach_uses(&mut self, uses: &RuntimeUses) {
        if self.notes_imports {
            for &module in &uses.modules {
                self.note_import(self.input.library.find_module_file(module));
            }
            for &function in &uses.functions {
                self.note_import(self.input.library.find_function_file(function));
            }
        }
        for &module in &uses.modules {
            self.evaluate(ModuleRef::Runtime(module));
        }
        for &module in &uses.modules_read_whole {
            self.reach_every_export(ModuleRef::Runtime(module));
        }
        for &(module, name) in &uses.exports_read {
            self.reach_exports_named(ModuleRef::Runtime(module), &[name]);
        }
        for &function in &uses.functions {
            self.reach_function(function);
        }
    }

    fn reach_named_imports(
        &mut self,
        application: &Files<'_>,
        graph: &ModuleGraph,
        file: FileId,
    ) -> SmallVec<[RuntimeModule; 4]> {
        let mut read_by_name: SmallVec<[RuntimeModule; 4]> = SmallVec::new();
        let mut read_whole: SmallVec<[RuntimeModule; 4]> = SmallVec::new();
        if !self.reads_imports_by_name {
            return read_by_name;
        }
        let hir = application.hir(file);
        for site in application.analysis(file).import_sites {
            let Some(SiteAnswer::Module(ModuleRef::Runtime(module))) =
                graph.find_site_answer(file, site.kind)
            else {
                continue;
            };
            let names: Option<SmallVec<[&str; 8]>> = match site.kind {
                ImportSiteKind::Import(import)
                    if hir[import].default.is_none()
                        && hir[import].namespace.is_none()
                        && hir[import].named.iter().any(|it| !hir[it].type_only) =>
                {
                    let read = hir[import].named.iter().filter(|&it| !hir[it].type_only);
                    read.map(|it| {
                        core::str::from_utf8(application.atoms.bytes(hir[it].imported)).ok()
                    })
                    .collect()
                }
                ImportSiteKind::ExportFrom(export)
                    if !hir[export].type_only
                        && hir[export].items.iter().any(|it| !hir[it].type_only) =>
                {
                    let read = hir[export].items.iter().filter(|&it| !hir[it].type_only);
                    read.map(|it| core::str::from_utf8(application.atoms.bytes(hir[it].local)).ok())
                        .collect()
                }
                _ => None,
            };
            match names {
                Some(mut names) => {
                    names.sort_unstable();
                    names.dedup();
                    self.reach_exports_named(ModuleRef::Runtime(module), &names);
                    read_by_name.push(module);
                }
                None => read_whole.push(module),
            }
        }
        read_by_name.retain(|module| !read_whole.contains(module));
        read_by_name
    }

    fn reach_roots(&mut self) {
        self.reads_imports_by_name = match self.input.application {
            Application::Bound { files, graph } => !loads_modules_by_computed_names(files, graph),
            Application::Asks(_) => false,
        };
        if self.input.holds_what_unseen_code_finds || self.input.can_load_code_at_run_time {
            self.reach_uses(&RuntimeUses::of_unseen_code(self.input.platform));
        }
        match self.input.application {
            Application::Bound { files, graph } => self.reach_what_application_asks(files, graph),
            Application::Asks(uses) => self.reach_uses(uses),
        }
        if self.input.can_load_code_at_run_time
            && let Some(threads) = table::module_by_specifier(b"node:worker_threads")
        {
            self.evaluate(ModuleRef::Runtime(threads));
        }
        for &file in self.input.library.code_files() {
            if self.input.library.kind(file) != SourceKind::RuntimeFunctions {
                continue;
            }
            let mut units = self.units_of(file).units.iter();
            if !units.any(|unit| unit.id.is_some()) {
                self.reach_units(file, |_| true);
            }
        }
    }

    fn reach_what_application_asks(&mut self, application: &Files<'_>, graph: &ModuleGraph) {
        let input = self.input;
        let used_at_start = uses_of_what_start_reads(input.used_at_start, input.platform);
        self.reach_uses(&used_at_start);
        let files = application.compiled_files().iter();
        let mut asks = used_at_start.asks;
        let mut bound_by_no_site: Vec<RuntimeModule> = Vec::new();
        for &file in files.filter(|&&file| !asks_nothing_of_library(application, graph, file)) {
            let read_by_name = self.reach_named_imports(application, graph, file);
            let compiled = application.compiled(file);
            let answers = compiled.map_or(&[][..], |it| it.code_answers);
            for answer in answers {
                if let CodeAnswer::HostModule(id) = *answer
                    && let Some(module) = RuntimeModule::from_registry_id(id.0)
                    && !read_by_name.contains(&module)
                {
                    self.reach_every_export(ModuleRef::Runtime(module));
                }
            }
            if let Some(source) = parsed_source(application, file) {
                let of_kept_code = input.uses_of_kept_code.and_then(|it| it.get(&file));
                let uses = of_kept_code.unwrap_or_else(|| source.builtins.uses());
                self.reach_uses(uses);
                asks.add(&uses.asks);
                for named in source.named_modules() {
                    self.reach_every_export(ModuleRef::Runtime(named.module));
                    bound_by_no_site.push(named.module);
                }
            }
        }
        if !(self.input.holds_what_unseen_code_finds || self.input.can_load_code_at_run_time) {
            self.reach_uses(&RuntimeUses::of_asks(&asks, self.input.platform));
        }
        for module in find_library_modules_that_unknown_names_may_stand_for(application) {
            self.reach_every_export(ModuleRef::Runtime(module));
            bound_by_no_site.push(module);
        }
        let platform = self.input.platform;
        self.reach_uses(&RuntimeUses::of_native_modules_handed_out(
            &bound_by_no_site,
            platform,
        ));
    }

    fn find_file(&self, module: ModuleRef) -> Option<FileId> {
        match module {
            ModuleRef::File(file)
            | ModuleRef::Inner { file, .. }
            | ModuleRef::Face(file)
            | ModuleRef::Check(file) => Some(file),
            ModuleRef::Runtime(module) => self.input.library.find_module_file(module),
            ModuleRef::External { .. } => None,
        }
    }

    fn is_public_module(&self, file: FileId) -> bool {
        let module = self.input.library.runtime_module(file);
        module.is_some_and(|it| {
            table::module_data(it)
                .flags
                .contains(table::ModuleFlags::IS_PUBLIC)
        })
    }

    fn reach_region(&mut self, file: FileId, region: u32) -> bool {
        let units = self.units_of(file);
        if replace(&mut units.is_region_reached[region as usize], true) {
            return false;
        }
        self.pending.push((file, region));
        let is_first_of_file = !replace(&mut self.is_file_reached[file.idx()], true);
        if region == TOP_LEVEL && !self.reads_imports_by_name && self.is_public_module(file) {
            self.reach_every_export(ModuleRef::File(file));
        }
        if is_first_of_file && self.input.can_load_code_at_run_time {
            self.reach_units(file, |_| true);
        }
        is_first_of_file
    }

    fn reach_units(&mut self, file: FileId, is_wanted: impl Fn(&Unit) -> bool) {
        for unit in 0..self.units_of(file).units.len() {
            if is_wanted(&self.units_of(file).units[unit]) {
                self.reach_unit(file, unit as u32);
            }
        }
    }

    fn reach_unit(&mut self, file: FileId, unit: u32) {
        let is_first_of_file = self.reach_region(file, unit + 1);
        if !self.units_of(file).is_library {
            self.reach_region(file, TOP_LEVEL);
            return;
        }
        if is_first_of_file {
            self.reach_units(file, |unit| unit.id.is_none());
        }
    }

    fn reach_function(&mut self, function: RuntimeFunction) {
        if let Some((file, unit)) = self.function_by_id.remove(&function) {
            self.reach_unit(file, unit);
        }
    }

    fn evaluate(&mut self, module: ModuleRef) {
        let Some(file) = self.find_file(module) else {
            return;
        };
        if self.units_of(file).is_library {
            return self.reach_units(file, |_| true);
        }
        self.reach_region(file, TOP_LEVEL);
    }

    fn reads_this(&self, file: FileId, function: FnId) -> bool {
        let tree = self.input.library.tree(file);
        tree.is_some_and(|LibraryTree { hir, bound, .. }| {
            hir.runtime_function_kind(function) != FnKind::Arrow
                && (bound.fns[function.idx()].contains_this
                    || evaluates_own_this(hir, function, false))
        })
    }

    fn reach_export(&mut self, file: FileId, name: Atom) {
        self.evaluate(ModuleRef::File(file));
        let units = self.units_of(file);
        let exports = units.named_exports.iter().filter(|export| export.0 == name);
        let interests: SmallVec<[Interest; 2]> = exports.map(|export| export.1).collect();
        for interest in interests {
            if let Interest::Unit(unit) = interest
                && let &[function] = &self.units_of(file).units[unit as usize].functions[..]
                && self.reads_this(file, function)
            {
                self.reach_every_export(ModuleRef::File(file));
            }
            self.follow(file, interest);
        }
    }

    fn reach_exports_named(&mut self, module: ModuleRef, names: &[&str]) {
        let Some(file) = self.find_file(module) else {
            return;
        };
        let input = self.input;
        let atoms = input.library.atoms();
        let is_read = |name: Atom| names.iter().any(|it| atoms.bytes(name) == it.as_bytes());
        let mut read_exports: SmallVec<[Atom; 2]> = SmallVec::new();
        for &(name, _) in &self.units_of(file).named_exports {
            if is_read(name) && !read_exports.contains(&name) {
                read_exports.push(name);
            }
        }
        if read_exports.len() != names.len() {
            self.reach_every_export(module);
            return;
        }
        for name in read_exports {
            self.reach_export(file, name);
        }
    }

    fn reach_every_export(&mut self, module: ModuleRef) {
        self.evaluate(module);
        let Some(file) = self.find_file(module) else {
            return;
        };
        let units = self.units_of(file);
        if replace(&mut units.is_every_export_reached, true) {
            return;
        }
        for (_, interest) in take(&mut units.named_exports) {
            self.follow(file, interest);
        }
    }

    fn follow(&mut self, file: FileId, interest: Interest) {
        match interest {
            Interest::Unit(unit) => self.reach_unit(file, unit),
            Interest::Evaluation(module) => self.evaluate(module),
            Interest::Export(target, name) => self.reach_export(target, name),
            Interest::EveryExport(module) => self.reach_every_export(module),
        }
    }

    fn find_target_module(&self, file: FileId, site: ImportSiteKind) -> Option<RuntimeModule> {
        match self.input.library.find_site_target(file, site)? {
            SiteTarget::Module(
                ModuleRef::File(target) | ModuleRef::Face(target) | ModuleRef::Check(target),
            ) => self.input.library.runtime_module(target),
            SiteTarget::Module(ModuleRef::Runtime(module)) => Some(module),
            _ => None,
        }
    }

    fn visit_pending_regions(&mut self, in_parallel: InParallel<'_>) {
        let pending = take(&mut self.pending).into_iter();
        let texts = pending.filter_map(|(file, region)| self.enter_region(file, region));
        let texts: Vec<RegionText> = texts.collect();
        let mut regions: Vec<(RegionText, Option<RuntimeUses>)> = texts
            .into_iter()
            .map(|text| {
                let known = self.known.as_ref().and_then(|it| it.files.get(&text.file));
                let uses = known.and_then(|it| it.uses[text.region as usize].clone());
                (text, uses)
            })
            .collect();
        let input = self.input;
        let (library, names, platform) = (input.library, input.names, input.platform);
        let holds_language = input.holds_what_unseen_code_finds || input.can_load_code_at_run_time;
        let facts = &self.facts;
        for_each_mut(&mut regions, in_parallel, &|(text, uses)| {
            let Some(LibraryTree {
                hir,
                bound,
                analysis,
                ..
            }) = library.tree(text.file).filter(|_| uses.is_none())
            else {
                return;
            };
            let input = ResolveInput {
                hir,
                bound,
                decisions: &analysis.decisions,
                atoms: library.atoms(),
                module_format: analysis.module_format,
                targets: &ImportTargets::new(&text.targets),
                names,
                platform,
                dialect: SourceDialect::Runtime,
                replaced: &[],
                runs_tests: false,
                holds_language,
                is_text_asked: !holds_language,
            };
            let facts = facts[text.file.idx()]
                .as_ref()
                .expect("the file was scanned");
            let facts = facts.get_or_init(|| FileFacts::new(&input));
            *uses = Some(resolve_within(&input, &text.ranges, facts).into_uses());
        });
        for (text, uses) in regions {
            let uses = uses.unwrap_or_default();
            self.asking_file = Some(text.file);
            self.reach_uses(&uses);
            self.asking_file = None;
            let known = self.known.as_mut();
            if let Some(known) = known.and_then(|it| it.files.get_mut(&text.file)) {
                known.uses[text.region as usize] = Some(uses);
            }
        }
    }

    fn note_imports_of_site(&mut self, file: FileId, site: ImportSiteKind) {
        if !self.notes_imports {
            return;
        }
        let targets = match self.input.library.find_site_target(file, site) {
            Some(SiteTarget::Module(target)) => vec![target],
            Some(SiteTarget::OneOf(targets)) => targets,
            Some(SiteTarget::AnyModule | SiteTarget::Nothing) | None => Vec::new(),
        };
        for target in targets {
            if let Some(target) = self.find_file(target) {
                self.imports.push((file, target));
            }
        }
    }

    fn enter_region(&mut self, file: FileId, region: u32) -> Option<RegionText> {
        let units = self.units_of(file);
        let interests = take(&mut units.interests[region as usize]);
        let sites = take(&mut units.sites[region as usize]);
        let ranges: Vec<Range<u32>> = match region.checked_sub(1) {
            Some(unit) => {
                let pieces = units.pieces.iter().filter(|piece| piece.unit == unit);
                pieces.map(|piece| piece.written_at.clone()).collect()
            }
            None => {
                let mut ranges = Vec::with_capacity(units.pieces.len() + 1);
                let mut start = 0;
                for piece in &units.pieces {
                    ranges.push(start..piece.written_at.start);
                    start = piece.written_at.end;
                }
                ranges.push(start..u32::MAX);
                ranges
            }
        };
        for interest in interests {
            self.follow(file, interest);
        }
        for &site in &sites {
            self.note_imports_of_site(file, site);
        }
        self.input.library.tree(file)?.source?;
        let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
            .iter()
            .map(|&site| (site, self.find_target_module(file, site)))
            .collect();
        targets.shared_sort_unstable_by_key(|target| target.0);
        Some(RegionText {
            file,
            region,
            ranges,
            targets,
        })
    }

    fn finish(self) -> ReachedRuntimeCode {
        let mut left_out_functions = FxHashSet::default();
        for (index, units) in self.files.iter().enumerate() {
            let Some(units) = units else {
                continue;
            };
            let file = FileId(index as u32);
            for (unit, &is_reached) in units.units.iter().zip(&units.is_region_reached[1..]) {
                if !is_reached {
                    let functions = unit.functions.iter();
                    left_out_functions
                        .extend(functions.map(|&function| FunctionRef { file, function }));
                }
            }
        }
        ReachedRuntimeCode {
            is_file_reached: self.is_file_reached,
            left_out_functions,
        }
    }
}
