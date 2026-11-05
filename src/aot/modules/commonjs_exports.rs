mod faces;
mod helper_calls;
mod summary;
#[cfg(test)]
mod tests;

use self::faces::Faces;
pub(super) use self::faces::collect_seen_namespaces;
use self::summary::{ExportsSummary, StoredName, summarize_file, summarize_inner_modules};
use super::bindings::SyntheticExportId;
use super::exports::{ExportTables, Resolution};
use super::graph::find;
use super::imports::{FileImports, PendingBinding};
use super::interop::{ModuleKind, SyntheticExportRule};
use super::module_set::ModuleSet;
use super::namespace_members::find_outermost_type_assertion;
use super::order::{FileText, SitePosition};
use super::plan::{Member, Shape};
use super::requests::{FileScan, ScannedSite, Scans};
use super::synthetic_exports::SyntheticExports;
use super::wrapped::{InnerModule, InnerModuleKind, WrappedModules};
use super::{BindInput, DescribedPart, ModuleRef, WrittenDescriptor, find_library_files};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::{
    ModuleObjectOwner, ModuleObjectUse, redeclares_what_wrapper_hands_in,
};
use crate::ir::for_each_mut;
use crate::known_helpers::{Helper, Quiet, Shape as HelperShape};
use crate::load::SourceKind;
use crate::load::sources::parsed_source;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    AssignmentTarget, Binding, BindingInitializer, BindingKind, Bound, CodeUnit, CommonJsVariable,
    Decl, FnOwner, FunctionFlags, Parent, PatParent, ScopeKind, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, CallId, Chain, ExportSpecId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind,
    MemberKey, NodeData, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ThisPositions;
use bun_sema::program::{FileId, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use std::cell::OnceCell;

pub(super) struct CommonJsInput<'a, 'b, 's> {
    pub bind: &'a BindInput<'b, 's>,
    pub scans: &'a Scans,
    pub modules: &'a ModuleSet,
    pub half: &'a (dyn Fn(ModuleRef) -> bool + Sync),
    pub half_at_link: &'a (dyn Fn(ModuleRef) -> bool + Sync),
    pub is_prefix_root: &'a (dyn Fn(FileId) -> bool + Sync),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::modules) enum AliasTarget {
    Member { module: ModuleRef, name: Atom },
    Binding(Sym),
}

#[derive(Copy, Clone, Debug)]
pub(in crate::modules) struct Getter {
    pub target: AliasTarget,
    pub is_seen_unfilled: bool,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::modules) struct NameEntry {
    pub name: Atom,
    pub getter: Option<Getter>,
    pub created_at: u32,
    pub is_enumerable: bool,
}

pub(in crate::modules) fn is_listed_for_importers(
    is_enumerable: bool,
    is_accessor: bool,
    lists_only_enumerable_names: bool,
) -> bool {
    is_enumerable || !(is_accessor || lists_only_enumerable_names)
}

pub(in crate::modules) struct ModuleEntries {
    pub module: ModuleRef,
    pub has_names: bool,
    pub knows_all_names: bool,
    pub lists_only_enumerable_names: bool,
    pub runs_in_place: bool,
    pub is_half: bool,
    pub is_replaced_late: bool,
    pub exports_ordinary_object: bool,
    pub marker: Option<bool>,
    pub names: Vec<NameEntry>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct CommonJsImport {
    pub importer: FileId,
    pub exporter: FileId,
    pub name: Atom,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum StoredValue {
    Undefined,
    IgnoresThis,
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum AccessKind {
    Read,
    Store(StoredValue),
    Update,
    Choice(StoredValue),
    Call,
}

#[derive(Copy, Clone, Debug)]
struct Access {
    node: ExprId,
    name: Atom,
    kind: AccessKind,
}

#[derive(Copy, Clone, Debug)]
struct Creation {
    name: Atom,
    node: ExprId,
    value: StoredValue,
    value_node: ExprId,
    position: SitePosition,
    is_enumerable: bool,
    is_read_only: bool,
    is_fixed: bool,
    start: u32,
    end: u32,
}

impl Creation {
    fn is_in_order(&self) -> bool {
        self.position == SitePosition::InOrder
    }
}

#[derive(Copy, Clone, Debug)]
struct Alias {
    name: Atom,
    target: AliasTarget,
    node: ExprId,
    value: StoredValue,
    is_enumerable: bool,
    is_seen_unfilled: bool,
    start: u32,
    returned_start: u32,
}

#[derive(Copy, Clone, Debug)]
struct OwnAccess {
    node: ExprId,
    name: Atom,
    is_store_only: bool,
    says_marker: bool,
    stores_nothing: bool,
}

fn range_of<T>(sorted: &[T], name: Atom, name_of: impl Fn(&T) -> Atom) -> &[T] {
    let start = sorted.partition_point(|it| name_of(it).0 < name.0);
    let count = sorted[start..].partition_point(|it| name_of(it) == name);
    &sorted[start..start + count]
}

struct ModuleText {
    file: FileId,
    inner: Option<FnId>,
    is_half: bool,
    has_names: bool,
    own_accesses: Vec<OwnAccess>,
    creations: Vec<Creation>,
    aliases: Vec<Alias>,
    defined_values: Vec<(ExprId, Atom)>,
    marker_nodes: Vec<ExprId>,
    erased: Vec<StmtId>,
    evaluated_at_store: Option<StmtId>,
    names_read: Vec<Atom>,
    names_called: Vec<Atom>,
    marker: Option<bool>,
    is_marker_fixed: bool,
    is_marker_ignored_by_imports: bool,
    runs_in_place: bool,
    names_hidden_from_loops: Vec<Atom>,
    needs_wrapped_body: bool,
    uses_module_object: bool,
    is_replaced_late: bool,
    exports_ordinary_object: bool,
}

impl ModuleText {
    fn module(&self) -> ModuleRef {
        match self.inner {
            Some(callback) => ModuleRef::Inner {
                file: self.file,
                callback,
            },
            None => ModuleRef::File(self.file),
        }
    }

    fn creations_of(&self, name: Atom) -> &[Creation] {
        range_of(&self.creations, name, |it| it.name)
    }

    fn alias_of(&self, name: Atom) -> Option<&Alias> {
        range_of(&self.aliases, name, |it| it.name).first()
    }

    fn always_creates(&self, name: Atom) -> bool {
        self.creations_of(name).iter().any(Creation::is_in_order) || self.alias_of(name).is_some()
    }

    fn lists_only_enumerable_names(&self) -> bool {
        !self.aliases.is_empty() && !self.is_marker_ignored_by_imports && self.marker != Some(false)
    }

    fn always_lists(&self, name: Atom) -> bool {
        let (is_enumerable, is_accessor) = match (self.alias_of(name), self.creations_of(name)) {
            (Some(alias), _) => (alias.is_enumerable, true),
            (None, [first, ..]) => (first.is_enumerable, false),
            (None, []) => return false,
        };
        self.always_creates(name)
            && is_listed_for_importers(
                is_enumerable,
                is_accessor,
                self.lists_only_enumerable_names(),
            )
    }

    fn is_always_found_by_statements(&self, name: Atom) -> bool {
        match self.runs_in_place {
            true => self.always_lists(name),
            false => self.always_creates(name),
        }
    }

    fn may_look_at_this_under(&self, name: Atom) -> bool {
        let is_unknown = |value: StoredValue| value == StoredValue::Unknown;
        match self.alias_of(name) {
            Some(alias) => {
                !matches!(alias.target, AliasTarget::Binding(_)) || is_unknown(alias.value)
            }
            None => self
                .creations_of(name)
                .iter()
                .any(|it| is_unknown(it.value)),
        }
    }

    fn knows_all_names(&self) -> bool {
        let mut creations = self.creations.iter();
        self.has_names && creations.all(|creation| self.always_creates(creation.name))
    }
}

struct Text<'a, 's> {
    file: FileId,
    atoms: &'a Interner<'s>,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    decisions: &'a Decisions<'s>,
    builtins: &'a ResolvedBuiltins,
    bind: &'a BindInput<'a, 's>,
    places: FileText<'a, 's>,
    this_positions: OnceCell<ThisPositions>,
    names_super: OnceCell<bool>,
}

#[derive(Copy, Clone)]
enum Node {
    Expression(ExprId),
    Statement(StmtId),
    Function(FnId),
}

impl<'a, 's> Text<'a, 's> {
    fn new(
        bind: &'a BindInput<'a, 's>,
        wrapped: &'a WrappedModules,
        file: FileId,
    ) -> Option<Text<'a, 's>> {
        let files = bind.files;
        let analysis = files.analysis(file);
        Some(Text {
            file,
            atoms: &files.atoms,
            hir: files.hir(file),
            bound: files.bound(file),
            analysis,
            decisions: &analysis.decisions,
            builtins: &parsed_source(files, file)?.builtins,
            bind,
            places: FileText::new(files, wrapped, file),
            this_positions: OnceCell::new(),
            names_super: OnceCell::new(),
        })
    }

    fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let outermost = find_outermost_type_assertion(self.hir, self.bound, expression);
        (outermost, self.bound.parent_of_expr(outermost))
    }

    fn statement_of(&self, expression: ExprId) -> Option<StmtId> {
        match self.parent(expression).1 {
            Parent::Stmt(statement) if matches!(self.hir[statement].kind, StmtKind::Expr(_)) => {
                Some(statement)
            }
            _ => None,
        }
    }

    fn constant(&self, expression: ExprId) -> Option<Constant> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.decisions.constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(constant),
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
        }
    }

    fn is_plain_name(&self, name: Atom) -> bool {
        self.bind.is_plain_name(name)
    }

    fn plain_constant_name(&self, key: ExprId) -> Option<Atom> {
        match self.constant(key)? {
            Constant::String(name) if self.is_plain_name(name) => Some(name),
            _ => None,
        }
    }

    fn plain_name_of_key(&self, key: MemberKey) -> Option<Atom> {
        match key {
            MemberKey::Name(name) => Some(name).filter(|&name| self.is_plain_name(name)),
            MemberKey::Computed(computed) => self.plain_constant_name(computed),
            MemberKey::PrivateName(_) => None,
        }
    }

    fn is_deleted(&self, access: ExprId) -> bool {
        matches!(self.parent(access), (_, Parent::Expr(user))
            if matches!(self.hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }))
    }

    fn defines_property(&self, callee: ExprId) -> bool {
        let callee = self.hir.skip_type_assertions(callee);
        matches!(
            self.builtins.builtin_of_expression(callee),
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty)
        )
    }

    fn find_assignment(&self, target: ExprId) -> Option<(ExprId, ExprId)> {
        let (target, Parent::Expr(user)) = self.parent(target) else {
            return None;
        };
        match self.hir[user].kind {
            ExprKind::Assign {
                op: None,
                target: assigned,
                value,
            } if assigned == target
                && self.bound.get_assignment_target(self.hir, user).is_none() =>
            {
                Some((user, value))
            }
            _ => None,
        }
    }

    fn find_right_side(&self, target: ExprId) -> Option<ExprId> {
        let Parent::Expr(user) = self.bound.parent_of_expr(target) else {
            return None;
        };
        match self.hir[user].kind {
            ExprKind::Assign {
                target: assigned,
                value,
                ..
            } if assigned == target => Some(value),
            _ => None,
        }
    }

    fn find_access(&self, object: ExprId) -> Option<Access> {
        let (object, Parent::Expr(node)) = self.parent(object) else {
            return None;
        };
        let (accessed, key) = self.hir.member_key(node)?;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = self.hir[node].kind
        else {
            return None;
        };
        if accessed != object || chain != Chain::No {
            return None;
        }
        let name = self.plain_name_of_key(key)?;
        let (outermost, parent) = self.parent(node);
        if let Some(target) = self.bound.get_assignment_target(self.hir, outermost) {
            let kind = match (target, self.find_assignment(node)) {
                (AssignmentTarget::Assign(None), Some((_, value))) => {
                    AccessKind::Store(self.classify_value(value, 0))
                }
                (AssignmentTarget::Assign(None) | AssignmentTarget::ForInOrOf, _) => {
                    AccessKind::Store(StoredValue::Unknown)
                }
                (AssignmentTarget::Assign(Some(BinOp::And | BinOp::Or | BinOp::Nullish)), _) => {
                    let stored = self.find_right_side(outermost);
                    let stored = stored.map(|value| self.classify_value(value, 0));
                    AccessKind::Choice(stored.unwrap_or(StoredValue::Unknown))
                }
                (AssignmentTarget::Assign(Some(_)) | AssignmentTarget::Unary, _) => {
                    AccessKind::Update
                }
            };
            return Some(Access { node, name, kind });
        }
        let kind = match parent {
            Parent::Expr(user) => match self.hir[user].kind {
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call)
                    if self.hir[call].callee == outermost =>
                {
                    AccessKind::Call
                }
                ExprKind::Unary {
                    op: UnOp::Delete, ..
                } => return None,
                _ => AccessKind::Read,
            },
            _ => AccessKind::Read,
        };
        Some(Access { node, name, kind })
    }

    fn only_reads_or_tests(&self, object: ExprId) -> bool {
        let hir = self.hir;
        let (object, parent) = self.parent(object);
        match parent {
            Parent::VarInit(declaration) => {
                matches!(hir[hir[declaration].pat].kind, PatKind::Object(_))
            }
            Parent::Stmt(user) => match hir[user].kind {
                StmtKind::Expr(_) => true,
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::For { test, .. } => test == object,
                _ => false,
            },
            Parent::Expr(user) if user.is_some() => match hir[user].kind {
                ExprKind::Unary { op, .. } => matches!(op, UnOp::Not | UnOp::Typeof | UnOp::Void),
                ExprKind::Cond { test, .. } => test == object,
                ExprKind::Binary { op, left, .. } => match op {
                    BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => true,
                    BinOp::And => left == object,
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        }
    }

    fn classify_function(&self, function: FnId) -> StoredValue {
        let hir = self.hir;
        let kind = hir[function].kind;
        let flags = self.bound.function_flags(function);
        let reads_this = || {
            let positions = self.this_positions.get_or_init(|| ThisPositions::of(hir));
            positions.evaluates_own_this(hir, function)
        };
        let may_name_super = || {
            let is_super = |it: &hir::Expr| matches!(it.kind, ExprKind::Super);
            !matches!(kind, FnKind::Decl | FnKind::Expr)
                && *self
                    .names_super
                    .get_or_init(|| hir.exprs.iter().any(is_super))
        };
        let ignores_this = kind == FnKind::Arrow
            || (!flags.contains(FunctionFlags::HAS_DIRECT_EVAL)
                && !reads_this()
                && !may_name_super());
        match ignores_this {
            true => StoredValue::IgnoresThis,
            false => StoredValue::Unknown,
        }
    }

    fn classify_name(&self, name: ExprId, names_followed: u32) -> StoredValue {
        const MAX_NAMES_FOLLOWED: u32 = 8;
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return StoredValue::Unknown;
        };
        if names_followed == MAX_NAMES_FOLLOWED || !self.bound.is_stable_binding(symbol) {
            return StoredValue::Unknown;
        }
        match self.bound.binding_initializer(self.hir, symbol) {
            BindingInitializer::Function(function) => self.classify_function(function),
            BindingInitializer::Class(_) => StoredValue::IgnoresThis,
            BindingInitializer::Expression(value) => self.classify_value(value, names_followed + 1),
            _ => StoredValue::Unknown,
        }
    }

    fn classify_value(&self, value: ExprId, names_followed: u32) -> StoredValue {
        let value = self.hir.skip_type_assertions(value);
        match self.constant(value) {
            Some(Constant::Undefined) => return StoredValue::Undefined,
            Some(_) => return StoredValue::IgnoresThis,
            None => {}
        }
        match self.hir[value].kind {
            ExprKind::Assign {
                op: None, value, ..
            } => self.classify_value(value, names_followed),
            ExprKind::Fn(function) => self.classify_function(function),
            ExprKind::Ident(_) => self.classify_name(value, names_followed),
            ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. } => StoredValue::IgnoresThis,
            _ => StoredValue::Unknown,
        }
    }

    fn always_evaluates(&self, user: ExprId, operand: ExprId) -> bool {
        match self.hir[user].kind {
            ExprKind::Yield { .. } | ExprKind::Await(_) | ExprKind::Jsx(_) => false,
            _ => self.places.always_evaluates(user, operand),
        }
    }

    fn climb(&self, expression: ExprId, callback: Option<FnId>) -> Option<(SitePosition, bool)> {
        let (hir, bound) = (self.hir, self.bound);
        let mut position = SitePosition::InOrder;
        let mut has_own_this = false;
        let mut node = Node::Expression(expression);
        loop {
            if has_own_this && position == SitePosition::Late {
                return Some((position, has_own_this));
            }
            node = match node {
                Node::Expression(child) => match bound.parent_of_expr(child) {
                    Parent::Expr(user) if user.is_some() => {
                        if !self.always_evaluates(user, child) {
                            position = position.max(SitePosition::Sometimes);
                        }
                        Node::Expression(user)
                    }
                    Parent::Prop(property)
                    | Parent::PropKey(property)
                    | Parent::MethodKey(property) => {
                        Node::Expression(bound.prop_owner[property.idx()])
                    }
                    Parent::VarInit(declaration) => {
                        Node::Statement(bound.var_stmt[declaration.idx()])
                    }
                    Parent::Stmt(user) => {
                        let always_runs = matches!(
                            hir[user].kind,
                            StmtKind::Expr(_)
                                | StmtKind::Throw(_)
                                | StmtKind::ExportAssign(_)
                                | StmtKind::If { .. }
                                | StmtKind::Switch { .. }
                        );
                        if !always_runs {
                            position = position.max(SitePosition::Sometimes);
                        }
                        Node::Statement(user)
                    }
                    Parent::FnBody(function) => Node::Function(function),
                    Parent::ParamDefault(parameter) => {
                        position = position.max(SitePosition::Sometimes);
                        Node::Function(bound.param_fn[parameter.idx()])
                    }
                    Parent::MemberInit(_) => return Some((SitePosition::Late, true)),
                    Parent::File => return Some((position, has_own_this)),
                    _ => return has_own_this.then_some((SitePosition::Late, true)),
                },
                Node::Statement(child) => match bound.parent_of_stmt(child) {
                    Parent::File => return Some((position, has_own_this)),
                    Parent::FnBody(function) => Node::Function(function),
                    Parent::Stmt(user) => {
                        if !matches!(hir[user].kind, StmtKind::Block(_)) {
                            position = position.max(SitePosition::Sometimes);
                        }
                        Node::Statement(user)
                    }
                    _ => return has_own_this.then_some((SitePosition::Late, true)),
                },
                Node::Function(function) if callback == Some(function) => {
                    return Some((position, has_own_this));
                }
                Node::Function(function) => {
                    has_own_this |= hir[function].kind != FnKind::Arrow;
                    match bound.fns[function.idx()].owner {
                        FnOwner::Expr(written) => {
                            position = match self.places.is_called_where_written(function) {
                                true => position.max(SitePosition::Sometimes),
                                false => SitePosition::Late,
                            };
                            Node::Expression(written)
                        }
                        FnOwner::Stmt(statement) => {
                            position = SitePosition::Late;
                            Node::Statement(statement)
                        }
                        FnOwner::Member(_) => return Some((SitePosition::Late, true)),
                        FnOwner::None | FnOwner::Type(_) => {
                            return has_own_this.then_some((SitePosition::Late, true));
                        }
                    }
                }
            };
        }
    }

    fn find_first_return(&self, callback: Option<FnId>) -> u32 {
        let (hir, bound) = (self.hir, self.bound);
        if let Some(callback) = callback {
            let returns = bound.ids(bound.fns[callback.idx()].returns);
            let live = returns.filter(|&it: &StmtId| !self.decisions.is_dead_stmt(it));
            return live.map(|it| hir[it].start).min().unwrap_or(u32::MAX);
        }
        let statements = (0..hir.stmts.len() as u32).map(StmtId);
        let is_of_file = |statement: StmtId| {
            let scope = bound.scope_of_stmt(statement);
            scope.is_some() && bound.code_unit(scope) == CodeUnit::File
        };
        let returns = statements.filter(|&statement| {
            matches!(hir[statement].kind, StmtKind::Return(_))
                && !self.decisions.is_dead_stmt(statement)
                && is_of_file(statement)
        });
        let first = returns.map(|statement| hir[statement].start).min();
        first.unwrap_or(u32::MAX)
    }

    fn position_in(&self, body: BodyOfModule, expression: ExprId) -> SitePosition {
        match self.climb(expression, body.callback) {
            Some((SitePosition::InOrder, _)) if self.hir[expression].pos >= body.first_return => {
                SitePosition::Sometimes
            }
            Some((position, _)) => position,
            None => SitePosition::Late,
        }
    }
}

#[derive(Copy, Clone)]
struct BodyOfModule {
    callback: Option<FnId>,
    first_return: u32,
}

fn needs_wrapped_body(text: &Text<'_, '_>) -> bool {
    let (bound, decisions) = (text.bound, text.decisions);
    let mut evals = bound.runtime.eval_scopes().iter();
    let mut scopes = bound.scopes.iter();
    let mut stores = bound.runtime.unbound_name_stores().iter();
    bound.file_uses_arguments()
        || redeclares_what_wrapper_hands_in(text.hir, bound)
        || evals.any(|&(call, _)| !decisions.is_dead_expr(call))
        || scopes.any(|scope| matches!(scope.kind, ScopeKind::With(_)))
        || stores.any(|&(target, _)| match bound.binding(target) {
            _ if decisions.is_dead_expr(target) => false,
            Binding::CommonJs(CommonJsVariable::Exports) => {
                !text.builtins.is_stored_with_module_exports(target)
            }
            Binding::CommonJs(
                CommonJsVariable::Require
                | CommonJsVariable::Module
                | CommonJsVariable::Filename
                | CommonJsVariable::Dirname,
            ) => true,
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => false,
        })
}

fn find_holder_declared_with(text: &Text<'_, '_>, value: ExprId) -> Option<SymbolId> {
    let (hir, bound) = (text.hir, text.bound);
    let Parent::VarInit(declaration) = text.parent(value).1 else {
        return None;
    };
    let pattern = hir[declaration].pat;
    if !matches!(hir[pattern].kind, PatKind::Ident(_))
        || hir[declaration].flags.contains(Flags::EXPORT)
        || bound.dynamic_lookup_scope(NodeData::Pat(pattern)).is_some()
    {
        return None;
    }
    let holder = bound.declared_symbol(Decl::Var(pattern)).some()?;
    (!bound.is_visible_to_eval(holder)).then_some(holder)
}

fn find_call_of_helper_with_argument(
    text: &Text<'_, '_>,
    argument: ExprId,
) -> Option<(ExprId, usize)> {
    let hir = text.hir;
    let (argument, Parent::Expr(user)) = text.parent(argument) else {
        return None;
    };
    let ExprKind::Call(call) = hir[user.some()?].kind else {
        return None;
    };
    let call = hir[call];
    if call.chain != Chain::No
        || call.args.len() == 0
        || hir.id_at::<ExprId>(call.args, 0) != argument
    {
        return None;
    }
    let helpers = text.bind.known_helpers;
    let known = helpers.certain_callee(text.bind.files, text.file, call.callee)?;
    matches!(
        known.shape.helper(),
        Helper::ToEsModule | Helper::ImportStar | Helper::ImportDefault
    )
    .then_some((user, call.args.len()))
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Held {
    Object,
    Default,
    Namespace,
    Answer,
    AnswerPastMarker,
}

#[derive(Default)]
struct TakenObjects {
    required: Vec<ModuleRef>,
    imported: Vec<ModuleRef>,
    defaults: Vec<ModuleRef>,
    called: Vec<(ModuleRef, Atom)>,
    names_way_to_module_objects: bool,
}

impl TakenObjects {
    fn take(&mut self, held: Held, module: ModuleRef) {
        match held {
            Held::Object | Held::Answer | Held::AnswerPastMarker => self.required.push(module),
            Held::Namespace => self.imported.push(module),
            Held::Default => self.defaults.push(module),
        }
    }

    fn look_at_use(&mut self, text: &Text<'_, '_>, used: ExprId, held: Held, module: ModuleRef) {
        let Some(access) = text.find_access(used) else {
            if !text.only_reads_or_tests(used) {
                self.take(held, module);
            }
            return;
        };
        let shown_as_default = match held {
            Held::Namespace | Held::Answer => Some(Held::Default),
            Held::AnswerPastMarker => Some(Held::Object),
            Held::Object | Held::Default => None,
        };
        match (
            access.kind,
            shown_as_default.filter(|_| access.name == known::default),
        ) {
            (AccessKind::Read, Some(shown)) => self.look_at_use(text, access.node, shown, module),
            (AccessKind::Read, None) => {}
            _ if access.name == known::__esModule => self.take(held, module),
            (AccessKind::Call, _) => self.called.push((module, access.name)),
            (AccessKind::Store(stored) | AccessKind::Choice(stored), _) => {
                if stored == StoredValue::Unknown {
                    self.take(held, module);
                }
            }
            (AccessKind::Update, _) => {}
        }
    }

    fn look_at_answer(
        &mut self,
        text: &Text<'_, '_>,
        call: ExprId,
        module: ModuleRef,
        holders: &mut Vec<(SymbolId, Held, ModuleRef)>,
    ) {
        let (answer, held) = match find_call_of_helper_with_argument(text, call) {
            Some((answer, 1)) => (answer, Held::Answer),
            Some((answer, _)) => (answer, Held::AnswerPastMarker),
            None => (call, Held::Object),
        };
        match find_holder_declared_with(text, answer) {
            Some(holder) => holders.push((holder, held, module)),
            None => self.look_at_use(text, answer, held, module),
        }
    }
}

fn find_taken_objects(
    text: &Text<'_, '_>,
    scan: &FileScan,
    commonjs_file_may_be_main: bool,
    find_open_marker: &dyn Fn(ModuleRef) -> Option<bool>,
) -> TakenObjects {
    let (hir, bound, decisions) = (text.hir, text.bound, text.decisions);
    let mut taken = TakenObjects::default();
    let mentions = text.builtins.module_object_mentions().iter();
    let mut mentions = mentions.map(|mention| (mention.owner, mention.object_use));
    taken.names_way_to_module_objects = mentions.any(|mention| match mention {
        (ModuleObjectOwner::EntryPoint, _) if !commonjs_file_may_be_main => false,
        (_, ModuleObjectUse::Tested) => false,
        (ModuleObjectOwner::EntryPoint, _) => true,
        (_, object_use) => matches!(
            object_use,
            ModuleObjectUse::Parent
                | ModuleObjectUse::Children
                | ModuleObjectUse::HandedOn
                | ModuleObjectUse::HolderHandedOn
        ),
    });
    taken.names_way_to_module_objects |=
        text.bind.runs_tests && text.builtins.reaches_module_cache();
    let mut holders = Vec::new();
    let mut distinct_candidates: Option<Vec<ModuleRef>> = None;
    for (site, answer) in text.analysis.import_sites.iter().zip(&scan.sites) {
        let modules = match answer {
            ScannedSite::Module(module) => core::slice::from_ref(module),
            ScannedSite::Candidates(_) => &distinct_candidates.get_or_insert_with(|| {
                let mut seen = FxHashSet::default();
                let candidates = scan.candidates.iter().copied();
                candidates.filter(|module| seen.insert(*module)).collect()
            })[..],
            ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => continue,
        };
        for &module in modules {
            let Some(is_commonjs) = find_open_marker(module) else {
                continue;
            };
            let mut hold = |declaration: Decl, held: Held| {
                let holder = bound.declared_symbol(declaration);
                match holder.is_some() && !bound.is_visible_to_eval(holder) {
                    true => holders.push((holder, held, module)),
                    false => taken.take(held, module),
                }
            };
            match site.kind {
                ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                    if !decisions.is_dead_expr(call) {
                        taken.look_at_answer(text, call, module, &mut holders);
                    }
                }
                ImportSiteKind::RequireByTestRunner(_) => taken.take(Held::Object, module),
                ImportSiteKind::ImportEquals(declaration) => {
                    if hir[declaration].flags.contains(Flags::EXPORT) {
                        taken.take(Held::Object, module);
                    } else if !decisions.is_dead_stmt(hir[declaration].stmt) {
                        hold(Decl::ImportEquals(declaration), Held::Object);
                    }
                }
                _ if !is_commonjs => {}
                ImportSiteKind::ImportCall(_) | ImportSiteKind::ImportByTestRunner(_) => {
                    taken.take(Held::Namespace, module);
                }
                ImportSiteKind::Import(import) => {
                    if hir[import].default.is_some() {
                        hold(Decl::ImportDefault(import), Held::Default);
                    }
                    if hir[import].namespace.is_some() {
                        hold(Decl::ImportNamespace(import), Held::Namespace);
                    }
                    for name in hir[import].named.iter() {
                        if hir[name].imported == known::default {
                            hold(Decl::ImportSpec(name), Held::Default);
                        }
                    }
                }
                ImportSiteKind::ExportFrom(export) => {
                    let mut names = hir[export].items.iter();
                    if names.any(|name| hir[name].local == known::default) {
                        taken.take(Held::Default, module);
                    }
                }
                ImportSiteKind::ExportStar(statement) => {
                    if matches!(hir[statement].kind, StmtKind::ExportStar { alias, .. } if alias.is_some())
                    {
                        taken.take(Held::Namespace, module);
                    }
                }
                _ => {}
            }
        }
    }
    for (call, module) in text.places.calls_of_inner_commonjs_modules() {
        if find_open_marker(module).is_some() {
            taken.look_at_answer(text, call, module, &mut holders);
        }
    }
    if holders.is_empty() {
        return taken;
    }
    holders.shared_sort_by_key(|holder| holder.0);
    let held_by = |binding: Binding| {
        let name = match binding {
            Binding::Symbol(name) => name,
            _ => SymbolId::NONE,
        };
        let first = holders.partition_point(|holder| holder.0 < name);
        holders[first..]
            .iter()
            .take_while(move |holder| holder.0 == name)
    };
    for reference in (0..hir.exprs.len() as u32).map(ExprId) {
        if !bound.is_evaluated_ident(reference) {
            continue;
        }
        for &(_, held, module) in held_by(bound.binding(reference)) {
            if !decisions.is_dead_expr(reference) && !bound.is_in_type_query(reference) {
                taken.look_at_use(text, reference, held, module);
            }
        }
    }
    let exported = (0..hir.export_specs.len() as u32).map(ExportSpecId);
    let exported = exported.map(|name| bound.exported_binding(name));
    for binding in exported.chain(text.analysis.bindings_read_without_expression(hir, bound)) {
        for &(_, held, module) in held_by(binding) {
            taken.take(held, module);
        }
    }
    taken
}

#[derive(Copy, Clone)]
struct Mention {
    node: ExprId,
    is_module_exports: bool,
}

pub(crate) fn find_literal_exported_under_name(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    value: ExprId,
) -> Option<(ExprId, StmtId)> {
    let value = hir.skip_type_assertions(value);
    let ExprKind::Ident(_) = hir[value].kind else {
        return None;
    };
    let Binding::Symbol(symbol) = bound.binding(value) else {
        return None;
    };
    if !bound.is_stable_binding(symbol) || bound.is_visible_to_eval(symbol) {
        return None;
    }
    let Some(Decl::Var(name)) = bound.initializing_declaration(symbol) else {
        return None;
    };
    let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
        return None;
    };
    let literal = hir.skip_type_assertions(hir[declaration].init.some()?);
    let ExprKind::Object(_) = hir[literal].kind else {
        return None;
    };
    let declared_at = bound.var_stmt[declaration.idx()];
    let StmtKind::Var(declarations) = hir[declared_at].kind else {
        return None;
    };
    if declarations.len != 1 {
        return None;
    }
    let statements = hir.ids::<StmtId>(hir.body);
    let mut statements = statements.skip_while(|&statement| statement != declared_at);
    statements.next()?;
    let StmtKind::Expr(store) = hir[statements.next()?].kind else {
        return None;
    };
    let ExprKind::Assign {
        op: None,
        value: stored,
        ..
    } = hir[hir.skip_type_assertions(store)].kind
    else {
        return None;
    };
    if hir.skip_type_assertions(stored) != value {
        return None;
    }
    let mentions = (0..hir.exprs.len() as u32).map(ExprId).filter(|&mention| {
        matches!(hir[mention].kind, ExprKind::Ident(_))
            && matches!(bound.binding(mention), Binding::Symbol(named) if named == symbol)
    });
    (mentions.count() == 1).then_some((literal, declared_at))
}

#[derive(Copy, Clone)]
struct Replacement {
    node: ExprId,
    position: SitePosition,
    literal: Option<ExprId>,
    declared_at: Option<StmtId>,
    stores_ordinary_object: bool,
}

struct Scan<'t, 'a, 's> {
    text: &'t Text<'a, 's>,
    sites: &'t [ScannedSite],
    summary: &'t ExportsSummary,
    certain_helper: &'t dyn Fn(ExprId) -> Option<HelperShape>,
    body: BodyOfModule,
    found: ModuleText,
    accesses: Vec<Access>,
    mentions: Vec<Mention>,
    replacements: Vec<Replacement>,
    marking_calls: Vec<ExprId>,
    quiet_head: OnceCell<u32>,
}

impl Scan<'_, '_, '_> {
    fn position_of(&self, expression: ExprId) -> SitePosition {
        self.text.position_in(self.body, expression)
    }

    fn is_statement_in_order(&self, expression: ExprId) -> bool {
        self.text.statement_of(expression).is_some()
            && self.position_of(expression) == SitePosition::InOrder
    }

    fn module_of_call(&self, call: ExprId) -> Option<ModuleRef> {
        let text = self.text;
        let ExprKind::Call(id) = text.hir[call].kind else {
            return None;
        };
        if self.body.callback.is_some()
            && let Some(inner) = text.places.find_inner_commonjs_module_of_call(call)
        {
            return Some(inner);
        }
        let callee = text.hir.skip_type_assertions(text.hir[id].callee);
        if text.hir[id].chain != Chain::No
            || !text.places.is_free(callee, CommonJsVariable::Require)
            || text.places.may_replace_require()
        {
            return None;
        }
        let site = text.analysis.import_site_of_call(call)?;
        match (text.analysis.import_sites[site].kind, &self.sites[site]) {
            (ImportSiteKind::Require(_), &ScannedSite::Module(module)) => Some(module),
            _ => None,
        }
    }

    fn find_required_module(&self, name: ExprId) -> Option<(ModuleRef, ExprId)> {
        let text = self.text;
        let Binding::Symbol(symbol) = text.bound.binding(name) else {
            return None;
        };
        if !text.bound.is_stable_binding(symbol) {
            return None;
        }
        let site = match text.bound.binding_initializer(text.hir, symbol) {
            BindingInitializer::Expression(value) => text.hir.skip_type_assertions(value),
            _ => return None,
        };
        Some((self.module_of_call(site)?, site))
    }

    fn create(&self, name: Atom, node: ExprId, value_node: ExprId, value: StoredValue) -> Creation {
        Creation {
            name,
            node,
            value,
            value_node,
            position: self.position_of(node),
            is_enumerable: true,
            is_read_only: false,
            is_fixed: false,
            start: self.text.hir[node].pos,
            end: self.text.hir[node].end,
        }
    }

    fn add_access(&mut self, access: Access) {
        self.accesses.push(access);
        let Access { node, name, kind } = access;
        let creation = match kind {
            AccessKind::Store(value) => {
                let assignment = self.text.find_assignment(node);
                let (node, value_node) = assignment.unwrap_or((node, ExprId::NONE));
                self.create(name, node, value_node, value)
            }
            AccessKind::Update => self.create(name, node, ExprId::NONE, StoredValue::IgnoresThis),
            AccessKind::Choice(value) => {
                let creation = self.create(name, node, ExprId::NONE, value);
                Creation {
                    position: creation.position.max(SitePosition::Sometimes),
                    ..creation
                }
            }
            AccessKind::Read | AccessKind::Call => return,
        };
        self.found.creations.push(creation);
    }

    fn find_returned_expression(&self, getter: ExprId) -> Option<ExprId> {
        let hir = self.text.hir;
        let ExprKind::Fn(function) = hir[hir.skip_type_assertions(getter)].kind else {
            return None;
        };
        let function = hir[function];
        if !function.params.is_empty() || function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return None;
        }
        match function.body {
            FnBody::Expr(returned) => Some(returned),
            FnBody::Block(statements) if statements.len() == 1 => {
                match hir[hir.id_at::<StmtId>(statements, 0)].kind {
                    StmtKind::Return(returned) => returned.some(),
                    _ => None,
                }
            }
            FnBody::Block(_) | FnBody::None => None,
        }
    }

    fn find_binding_alias(&self, returned: ExprId) -> Option<AliasTarget> {
        let (text, file) = (self.text, self.text.file);
        let Binding::Symbol(id) = text.bound.binding(returned) else {
            return None;
        };
        let is_declared_at_top = self.body.callback.is_none()
            && text.bound.symbol_scope(id) == text.bound.top_scope(text.hir, CodeUnit::File);
        let has_variable = matches!(
            text.bound.binding_kind(id),
            BindingKind::Var
                | BindingKind::Let
                | BindingKind::Const
                | BindingKind::Class
                | BindingKind::Function
        );
        (is_declared_at_top && has_variable && text.bound.has_runtime_value(id))
            .then_some(AliasTarget::Binding(Sym { file, id }))
    }

    fn find_alias_target(
        &self,
        returned: ExprId,
        definition: ExprId,
        is_read_behind_body: bool,
    ) -> Option<AliasTarget> {
        let text = self.text;
        let hir = text.hir;
        let returned = hir.skip_type_assertions(returned);
        if matches!(hir[returned].kind, ExprKind::Ident(_)) {
            return self.find_binding_alias(returned);
        }
        let (object, key) = hir.member_key(returned)?;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[returned].kind
        else {
            return None;
        };
        let name = text.plain_name_of_key(key)?;
        let object = hir.skip_type_assertions(object);
        if chain != Chain::No || !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let (module, site) = self.find_required_module(object)?;
        let is_loaded_before = self.position_of(site) == SitePosition::InOrder
            && (is_read_behind_body || hir[site].end <= hir[definition].pos);
        is_loaded_before.then_some(AliasTarget::Member { module, name })
    }

    fn add_alias(
        &mut self,
        name: Atom,
        target: AliasTarget,
        node: ExprId,
        returned: ExprId,
        is_enumerable: bool,
    ) {
        self.found.aliases.push(Alias {
            name,
            target,
            node,
            value: match target {
                AliasTarget::Binding(_) => self.text.classify_value(returned, 0),
                AliasTarget::Member { .. } => StoredValue::Unknown,
            },
            is_enumerable,
            is_seen_unfilled: false,
            start: self.text.hir[node].pos,
            returned_start: self.text.hir[returned].pos,
        });
    }

    fn add_definition(&mut self, object: ExprId, call_node: ExprId) -> Option<()> {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Call(call) = hir[call_node].kind else {
            return None;
        };
        let call = hir[call];
        if !text.defines_property(call.callee)
            || call.args.len() != 3
            || hir.id_at::<ExprId>(call.args, 0) != object
            || !self.is_statement_in_order(call_node)
        {
            return None;
        }
        let name = text.plain_constant_name(hir.id_at(call.args, 1))?;
        let descriptor = hir.id_at(call.args, 2);
        let written = WrittenDescriptor::read(hir, text.decisions, descriptor)?;
        let is_enumerable = written.is_enumerable == Some(true);
        let is_method = |value: ExprId| matches!(hir[value].kind, ExprKind::Fn(function) if hir[function].kind == FnKind::Method);
        match written.part {
            DescribedPart::Data {
                value: Some(value),
                is_writable,
            } if !is_method(value) => {
                let creation = self.create(name, call_node, value, text.classify_value(value, 0));
                self.found.creations.push(Creation {
                    is_enumerable,
                    is_read_only: is_writable != Some(true),
                    is_fixed: is_writable != Some(true) && written.is_configurable != Some(true),
                    ..creation
                });
                self.found.defined_values.push((call_node, name));
            }
            DescribedPart::Accessor {
                getter: Some(getter),
                setter: None,
            } => {
                let returned = self.find_returned_expression(getter)?;
                let target = self.find_alias_target(returned, call_node, false)?;
                self.add_alias(name, target, call_node, returned, is_enumerable);
                self.found.erased.extend(text.statement_of(call_node));
            }
            DescribedPart::Data { .. } | DescribedPart::Accessor { .. } => return None,
        }
        Some(())
    }

    fn add_names_of_helper(
        &mut self,
        written_at: StmtId,
        definition: ExprId,
        is_read_behind_body: bool,
    ) -> Option<()> {
        let text = self.text;
        let mut aliases = Vec::new();
        let mut marks_module = false;
        for stored in &self.summary.names {
            match *stored {
                StoredName::Getter {
                    name,
                    statement,
                    getter,
                    is_enumerable,
                    ..
                } if statement == written_at => {
                    let returned = self.find_returned_expression(getter)?;
                    let target =
                        self.find_alias_target(returned, definition, is_read_behind_body)?;
                    aliases.push((name, target, returned, is_enumerable));
                }
                StoredName::Value {
                    name,
                    statement,
                    value,
                } if statement == written_at && name == known::__esModule && value.is_none() => {
                    marks_module = true;
                }
                StoredName::Value { statement, .. } | StoredName::AllOf { statement, .. }
                    if statement == written_at =>
                {
                    return None;
                }
                StoredName::Value { .. } | StoredName::Getter { .. } | StoredName::AllOf { .. } => {
                }
            }
        }
        if (aliases.is_empty() && !marks_module)
            || !aliases.iter().all(|it| text.is_plain_name(it.0))
        {
            return None;
        }
        for (name, target, returned, is_enumerable) in aliases {
            self.add_alias(name, target, definition, returned, is_enumerable);
        }
        if marks_module {
            let ignored = StoredValue::IgnoresThis;
            let creation = self.create(known::__esModule, definition, ExprId::NONE, ignored);
            self.found.creations.push(Creation {
                is_enumerable: false,
                is_read_only: true,
                is_fixed: !matches!(text.hir[definition].kind, ExprKind::Call(call) if text.defines_property(text.hir[call].callee)),
                ..creation
            });
            self.marking_calls.push(definition);
        }
        self.found.erased.push(written_at);
        Some(())
    }

    fn add_definitions_of_helper(&mut self, call_node: ExprId) -> Option<()> {
        let text = self.text;
        let written_at = text.statement_of(call_node)?;
        if !matches!(text.hir[call_node].kind, ExprKind::Call(_))
            || self.position_of(call_node) != SitePosition::InOrder
        {
            return None;
        }
        self.add_names_of_helper(written_at, call_node, false)
    }

    fn find_statement_around_literal(&self, getter: ExprId) -> Option<StmtId> {
        let text = self.text;
        let Parent::Prop(property) = text.bound.parent_of_expr(getter) else {
            return None;
        };
        match text.parent(text.bound.prop_owner[property.idx()]).1 {
            Parent::Expr(call) if call.is_some() => text.statement_of(call),
            _ => None,
        }
    }

    fn add_copy(&mut self, replacement: Replacement) -> bool {
        let Some(written_at) = self.text.statement_of(replacement.node) else {
            return false;
        };
        let is_read_behind_body = !self.found.is_half && self.accesses.is_empty();
        let added = self.add_names_of_helper(written_at, replacement.node, is_read_behind_body);
        if added.is_none() {
            return false;
        }
        let getters = self
            .summary
            .names
            .iter()
            .filter_map(|stored| match *stored {
                StoredName::Getter {
                    statement, getter, ..
                } if statement == written_at => Some(getter),
                _ => None,
            });
        let filled_at = getters.filter_map(|getter| self.find_statement_around_literal(getter));
        let filled_at: Vec<StmtId> = filled_at.collect();
        self.found.erased.extend(filled_at);
        true
    }

    fn is_asked_as_some_object(&self, mention: ExprId, user: ExprId) -> bool {
        let text = self.text;
        match text.hir[user].kind {
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } => left == mention,
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                left,
                right,
            } => matches!(
                text.constant(if left == mention { right } else { left }),
                Some(Constant::Undefined | Constant::Null)
            ),
            ExprKind::Unary { op: UnOp::Not, .. } => true,
            ExprKind::Unary {
                op: UnOp::Typeof, ..
            } => text.constant(user).is_some(),
            ExprKind::Cond { test, .. } => test == mention,
            _ => false,
        }
    }

    fn add_replacement(&mut self, node: ExprId, value: Option<ExprId>, is_statement: bool) {
        let hir = self.text.hir;
        let value = value.map(|value| hir.skip_type_assertions(value));
        let kind = value.map(|value| hir[value].kind);
        let named = value.filter(|_| is_statement);
        let named = named.and_then(|it| find_literal_exported_under_name(hir, self.text.bound, it));
        self.replacements.push(Replacement {
            node,
            position: self.position_of(node),
            literal: match named {
                Some((literal, _)) => Some(literal),
                None => value.filter(|_| is_statement && matches!(kind, Some(ExprKind::Object(_)))),
            },
            declared_at: named.map(|(_, declared_at)| declared_at),
            stores_ordinary_object: value.is_some_and(|it| self.makes_ordinary_object(it, 0)),
        });
    }

    fn makes_ordinary_object(&self, value: ExprId, names_followed: u32) -> bool {
        const MAX_NAMES_FOLLOWED: u32 = 8;
        let (hir, bound) = (self.text.hir, self.text.bound);
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Object(_) | ExprKind::Array(_) => true,
            ExprKind::Assign {
                op: None, value, ..
            } => self.makes_ordinary_object(value, names_followed),
            ExprKind::Call(call) => {
                hir[call].chain == Chain::No
                    && (self.certain_helper)(hir[call].callee)
                        == Some(HelperShape::ToCommonJsCopiesOntoNewMarkedObject)
            }
            ExprKind::Ident(_) if names_followed < MAX_NAMES_FOLLOWED => {
                let Binding::Symbol(symbol) = bound.binding(value) else {
                    return false;
                };
                bound.is_stable_binding(symbol)
                    && match bound.binding_initializer(hir, symbol) {
                        BindingInitializer::Function(_) | BindingInitializer::Class(_) => true,
                        BindingInitializer::Expression(held) => {
                            self.makes_ordinary_object(held, names_followed + 1)
                        }
                        _ => false,
                    }
            }
            _ => false,
        }
    }

    fn look_at_object(&mut self, object: ExprId, is_module_exports: bool) {
        let text = self.text;
        let mention = Mention {
            node: object,
            is_module_exports,
        };
        if let Some(access) = text.find_access(object) {
            self.mentions.push(mention);
            return self.add_access(access);
        }
        let (outermost, parent) = text.parent(object);
        if text
            .bound
            .get_assignment_target(text.hir, outermost)
            .is_some()
        {
            if !is_module_exports {
                self.found.has_names = false;
                return;
            }
            return match text.find_assignment(object) {
                Some((assignment, value)) => {
                    let is_statement = text.statement_of(assignment).is_some();
                    self.add_replacement(assignment, Some(value), is_statement);
                }
                None => self.add_replacement(object, None, false),
            };
        }
        self.mentions.push(mention);
        self.found.has_names &= match parent {
            Parent::Expr(user) => {
                self.is_asked_as_some_object(outermost, user)
                    || self.add_definition(outermost, user).is_some()
                    || self.add_definitions_of_helper(user).is_some()
            }
            Parent::Stmt(user) => matches!(text.hir[user].kind, StmtKind::If { .. }),
            _ => false,
        };
    }

    fn is_compared_or_tested(&self, expression: ExprId) -> bool {
        let (_, Parent::Expr(user)) = self.text.parent(expression) else {
            return false;
        };
        match self.text.hir[user].kind {
            ExprKind::Binary { op, .. } => matches!(
                op,
                BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq
            ),
            ExprKind::Unary { op, .. } => matches!(op, UnOp::Typeof | UnOp::Not),
            _ => false,
        }
    }

    fn look_at_module_name(&mut self, name: ExprId) {
        let text = self.text;
        if let (outermost, Parent::Expr(user)) = text.parent(name)
            && text
                .hir
                .member_key(user)
                .is_some_and(|it| it.0 == outermost)
            && !text.is_deleted(user)
        {
            match text.builtins.builtin_of_expression(user) {
                Some(BuiltinId::ModuleObjectExports) => return self.look_at_object(user, true),
                Some(_) => return,
                None => {}
            }
        }
        if !self.is_compared_or_tested(name) {
            self.found.uses_module_object = true;
            self.found.has_names = false;
        }
    }

    fn add_literal(&mut self, literal: ExprId) -> bool {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let mut creations = Vec::with_capacity(properties.len());
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return false;
            };
            let is_plain = matches!(
                property.kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            );
            let value = text.classify_value(property.value, 0);
            let needs_literal = property.kind == PropKind::Method && value == StoredValue::Unknown;
            if !is_plain || needs_literal || !text.is_plain_name(name) {
                return false;
            }
            creations.push(Creation {
                name,
                node: property.value,
                value,
                value_node: property.value,
                position: SitePosition::InOrder,
                is_enumerable: true,
                is_read_only: false,
                is_fixed: false,
                start: property.start,
                end: property.end,
            });
        }
        self.found.creations.extend(creations);
        true
    }

    fn apply_replacement(&mut self) -> bool {
        let text = self.text;
        let [replacement] = self.replacements[..] else {
            return false;
        };
        let end = text.hir[replacement.node].end;
        let names_new_value =
            |mention: &Mention| mention.is_module_exports && text.hir[mention.node].pos >= end;
        let mut creations = self.found.creations.iter();
        let is_seen_alone = replacement.position == SitePosition::InOrder
            && self.mentions.iter().all(names_new_value)
            && creations.all(|it| it.position != SitePosition::Late)
            && !self.found.is_half;
        is_seen_alone
            && match replacement.literal {
                Some(literal) => {
                    let is_added = self.add_literal(literal);
                    if is_added {
                        self.found.evaluated_at_store = replacement.declared_at;
                    }
                    is_added
                }
                None => self.add_copy(replacement),
            }
    }

    fn find_stores_that_fill(&mut self) {
        let (text, body, accesses) = (self.text, self.body, &self.accesses);
        let creations = self.found.creations.iter_mut();
        for creation in creations.filter(|it| it.position == SitePosition::Sometimes) {
            let (store, Parent::Expr(choice)) = text.parent(creation.node) else {
                continue;
            };
            let ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } = text.hir[choice].kind
            else {
                continue;
            };
            let left = text.hir.skip_type_assertions(left);
            let mut of_name = range_of(accesses, creation.name, |it| it.name).iter();
            if right == store
                && of_name.any(|it| it.node == left && it.kind == AccessKind::Read)
                && text.position_in(body, choice) == SitePosition::InOrder
            {
                creation.position = SitePosition::InOrder;
            }
        }
    }

    fn find_first_loud_statement(
        &self,
        is_quiet_too: &dyn Fn(&Quiet<'_, '_>, StmtId) -> bool,
    ) -> u32 {
        let (text, found) = (self.text, &self.found);
        let call_of = |node: ExprId| match text.hir[node].kind {
            ExprKind::Call(call) => Some(call),
            _ => None,
        };
        let aliases = found.aliases.iter().map(|alias| alias.node);
        let values = found.defined_values.iter().map(|it| it.0);
        let definitions = aliases
            .chain(values)
            .chain(self.marking_calls.iter().copied());
        let definitions: FxHashSet<CallId> = definitions.filter_map(call_of).collect();
        let is_definition = |call: CallId| definitions.contains(&call);
        let quiet = Quiet {
            atoms: text.atoms,
            hir: text.hir,
            bound: text.bound,
            decisions: text.decisions,
            builtins: text.builtins,
            allows_reads_of_open_globals: false,
            runs_nothing: &is_definition,
        };
        let statements = match self.body.callback.map(|callback| text.hir[callback].body) {
            None => text.hir.body,
            Some(FnBody::Block(statements)) if !self.summary.names_exports_of_file => statements,
            Some(FnBody::Block(_) | FnBody::Expr(_) | FnBody::None) => return 0,
        };
        let mut statements = text.hir.ids(statements);
        let loud = statements.find(|&statement: &StmtId| {
            !quiet.is_quiet_statement(statement) && !is_quiet_too(&quiet, statement)
        });
        loud.map_or(u32::MAX, |statement| text.hir[statement].start)
    }

    fn runs_nothing_else_in_front_of(&self, position: u32) -> bool {
        let find = || self.find_first_loud_statement(&|_, _| false);
        position <= *self.quiet_head.get_or_init(find)
    }

    fn find_first_loud_statement_but_own_stores(&self) -> u32 {
        let hir = self.text.hir;
        let stores = self.found.creations.iter().filter(|it| it.is_in_order());
        let stored_values: FxHashMap<ExprId, ExprId> =
            stores.map(|it| (it.node, it.value_node)).collect();
        self.find_first_loud_statement(&|quiet, statement| {
            let StmtKind::Expr(mut value) = hir[statement].kind else {
                return false;
            };
            while let Some(&stored) = stored_values.get(&hir.skip_type_assertions(value)) {
                if stored.is_none() {
                    return false;
                }
                if quiet.is_quiet_expression(stored) {
                    return true;
                }
                value = stored;
            }
            false
        })
    }

    fn runs_nothing_else(&self) -> bool {
        self.replacements.is_empty() && self.find_first_loud_statement_but_own_stores() == u32::MAX
    }

    fn find_stores_of_nothing(&self) -> FxHashSet<ExprId> {
        let (text, found) = (self.text, &self.found);
        let stores_undefined =
            |access: &&Access| access.kind == AccessKind::Store(StoredValue::Undefined);
        let mut candidates = self.accesses.iter().filter(stores_undefined).peekable();
        if !found.has_names || !self.replacements.is_empty() || candidates.peek().is_none() {
            return FxHashSet::default();
        }
        let quiet_head = self.find_first_loud_statement_but_own_stores();
        let is_first_at_head = |access: &&Access| {
            let first = found.creations_of(access.name).first();
            let assignment = text.find_assignment(access.node);
            first
                .zip(assignment)
                .is_some_and(|(first, (assignment, _))| {
                    first.node == assignment && first.is_in_order() && first.end <= quiet_head
                })
        };
        let stores = candidates.filter(is_first_at_head);
        stores.map(|access| access.node).collect()
    }

    fn is_filled_first(&self, symbol: SymbolId) -> bool {
        let hir = self.text.hir;
        let filled_at = match self.text.bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(_) => return true,
            BindingInitializer::Expression(value) => hir[value].end,
            BindingInitializer::PatternProperty { source, .. } => hir[source].end,
            _ => return false,
        };
        self.runs_nothing_else_in_front_of(filled_at)
    }

    fn check_definitions(&mut self) {
        let (text, body, found) = (self.text, self.body, &self.found);
        let is_read_before = |alias: &Alias| {
            let of_name = range_of(&self.accesses, alias.name, |it| it.name).iter();
            let mut reads = of_name.filter(|it| !matches!(it.kind, AccessKind::Store(_)));
            reads.any(|read| {
                text.hir[read.node].pos < alias.start
                    || text.position_in(body, read.node) == SitePosition::Late
            })
        };
        let is_refused = |alias: &Alias| {
            let is_cleared_before = |creation: &Creation| {
                creation.value == StoredValue::Undefined
                    && creation.is_in_order()
                    && !creation.is_read_only
                    && creation.end <= alias.start
            };
            range_of(&found.aliases, alias.name, |it| it.name).len() != 1
                || !found.creations_of(alias.name).iter().all(is_cleared_before)
                || is_read_before(alias)
        };
        let is_stored_again = |creation: &Creation| {
            let mut creations = found.creations_of(creation.name).iter();
            creation.is_read_only && creations.any(|it| it.node != creation.node)
        };
        let last = found.aliases.iter().max_by_key(|alias| alias.start);
        if found.aliases.iter().any(is_refused)
            || found.creations.iter().any(is_stored_again)
            || (found.is_half
                && last.is_some_and(|alias| !self.runs_nothing_else_in_front_of(alias.start)))
        {
            self.found.has_names = false;
            return;
        }
        let is_seen_unfilled = |alias: &Alias| match alias.target {
            AliasTarget::Binding(symbol) => found.is_half && !self.is_filled_first(symbol.id),
            AliasTarget::Member { .. } => false,
        };
        let seen_unfilled: Vec<bool> = found.aliases.iter().map(is_seen_unfilled).collect();
        let ModuleText {
            creations, aliases, ..
        } = &mut self.found;
        creations.retain(|creation| range_of(&aliases[..], creation.name, |it| it.name).is_empty());
        for (alias, is_seen_unfilled) in aliases.iter_mut().zip(seen_unfilled) {
            alias.is_seen_unfilled = is_seen_unfilled;
        }
    }

    fn find_marker(&mut self) {
        let (text, body, found) = (self.text, self.body, &self.found);
        let creations = found.creations_of(known::__esModule).to_vec();
        let is_true = |value: ExprId| {
            value.some().and_then(|value| text.constant(value)) == Some(Constant::Boolean(true))
        };
        let is_marked_by_call = |creation: &Creation| self.marking_calls.contains(&creation.node);
        let is_read_before = |creation: &Creation| {
            let of_name = range_of(&self.accesses, known::__esModule, |it| it.name).iter();
            let mut reads = of_name.filter(|it| !matches!(it.kind, AccessKind::Store(_)));
            reads.any(|read| {
                text.hir[read.node].pos < creation.start
                    || text.position_in(body, read.node) == SitePosition::Late
            })
        };
        let written = match &creations[..] {
            _ if found.alias_of(known::__esModule).is_some() => None,
            [] => Some(false),
            [creation] => (creation.is_in_order()
                && (is_true(creation.value_node) || is_marked_by_call(creation))
                && text.statement_of(creation.node).is_some()
                && !is_read_before(creation)
                && (!found.is_half || self.runs_nothing_else_in_front_of(creation.start)))
            .then_some(true),
            _ => None,
        };
        let marker = written.filter(|_| written == self.summary.marker);
        let is_defined_without_store = creations.iter().any(is_marked_by_call)
            || (written == Some(false) && self.summary.marker != Some(false));
        if is_defined_without_store && marker != Some(true) {
            self.found.has_names = false;
            return;
        }
        let found = &mut self.found;
        found.marker = marker;
        if let (Some(true), [creation]) = (marker, &creations[..]) {
            found.is_marker_fixed = creation.is_fixed;
            found.marker_nodes.push(creation.node);
            found.erased.extend(text.statement_of(creation.node));
            found.creations.retain(|it| it.name != known::__esModule);
            found.defined_values.retain(|it| it.1 != known::__esModule);
        }
    }

    fn collect_own_accesses(&mut self, stores_of_nothing: &FxHashSet<ExprId>) {
        let found = &mut self.found;
        let accesses = self.accesses.iter().map(|access| OwnAccess {
            node: access.node,
            name: access.name,
            is_store_only: matches!(access.kind, AccessKind::Store(_)),
            says_marker: false,
            stores_nothing: stores_of_nothing.contains(&access.node),
        });
        let stores = found.defined_values.iter().map(|&it| (it.0, it.1, false));
        let markers = found.marker_nodes.iter();
        let markers = markers.map(|&node| (node, known::__esModule, true));
        let stores = stores.chain(markers);
        let stores = stores.map(|(node, name, says_marker)| OwnAccess {
            node,
            name,
            is_store_only: true,
            says_marker,
            stores_nothing: false,
        });
        found.own_accesses = accesses.chain(stores).collect();
        found
            .own_accesses
            .shared_sort_unstable_by_key(|access| access.node);
        let reads = self.accesses.iter();
        let reads = reads.filter(|access| !matches!(access.kind, AccessKind::Store(_)));
        found.names_read = reads.map(|access| access.name).collect();
        found
            .names_read
            .extend_from_slice(&self.summary.names_read_by_own_text);
        let calls = self.accesses.iter();
        let calls = calls.filter(|access| access.kind == AccessKind::Call);
        found.names_called = calls.map(|access| access.name).collect();
    }

    fn finish(mut self) -> ModuleText {
        if !self.replacements.is_empty() {
            self.found.has_names = self.found.has_names && self.apply_replacement();
        }
        self.found
            .creations
            .shared_sort_by_key(|it| (it.name.0, it.start));
        self.found
            .aliases
            .shared_sort_by_key(|it| (it.name.0, it.start));
        self.accesses.shared_sort_by_key(|it| it.name.0);
        let found = &self.found;
        let knows =
            |name: Atom| !found.creations_of(name).is_empty() || found.alias_of(name).is_some();
        let knows_every_name = self.summary.names.iter().all(|stored| match *stored {
            StoredName::Value { name, .. } | StoredName::Getter { name, .. } => knows(name),
            StoredName::AllOf { .. } => false,
        });
        self.found.has_names &= knows_every_name;
        self.find_stores_that_fill();
        let mut replacements = self.replacements.iter();
        self.found.is_replaced_late = self.found.uses_module_object
            || replacements.any(|it| it.position == SitePosition::Late);
        let mut replacements = self.replacements.iter();
        self.found.exports_ordinary_object = !self.found.uses_module_object
            && !self.found.needs_wrapped_body
            && replacements.all(|it| it.stores_ordinary_object);
        self.found.is_half = self.found.is_half && !self.runs_nothing_else();
        let stores_of_nothing = self.find_stores_of_nothing();
        if self.found.has_names {
            self.check_definitions();
        }
        if self.found.has_names {
            self.find_marker();
        }
        if self.found.has_names {
            self.collect_own_accesses(&stores_of_nothing);
        }
        let mut found = self.found;
        found.erased.sort_unstable();
        found.erased.dedup();
        let values = found.creations.iter().filter(|it| !it.is_enumerable);
        let getters = found.aliases.iter().filter(|it| !it.is_enumerable);
        let hidden = values.map(|it| it.name).chain(getters.map(|it| it.name));
        found.names_hidden_from_loops = hidden.collect();
        found
            .names_hidden_from_loops
            .sort_unstable_by_key(|name| name.0);
        found.names_hidden_from_loops.dedup();
        if !found.has_names {
            found.creations = Vec::new();
            found.aliases = Vec::new();
            found.erased = Vec::new();
            found.evaluated_at_store = None;
            found.defined_values = Vec::new();
            found.marker = None;
        }
        found
    }
}

fn begin_scan<'t, 'a, 's>(
    text: &'t Text<'a, 's>,
    sites: &'t [ScannedSite],
    summary: &'t ExportsSummary,
    certain_helper: &'t dyn Fn(ExprId) -> Option<HelperShape>,
    callback: Option<FnId>,
    is_half: bool,
) -> Scan<'t, 'a, 's> {
    Scan {
        text,
        sites,
        summary,
        certain_helper,
        body: BodyOfModule {
            callback,
            first_return: text.find_first_return(callback),
        },
        found: ModuleText {
            file: text.file,
            inner: callback,
            is_half,
            has_names: !summary.object_escapes
                && !summary.module_object_escapes
                && summary.replaced_by.is_none(),
            own_accesses: Vec::new(),
            creations: Vec::new(),
            aliases: Vec::new(),
            defined_values: Vec::new(),
            marker_nodes: Vec::new(),
            erased: Vec::new(),
            evaluated_at_store: None,
            names_read: Vec::new(),
            names_called: Vec::new(),
            marker: None,
            is_marker_fixed: false,
            is_marker_ignored_by_imports: false,
            runs_in_place: false,
            names_hidden_from_loops: Vec::new(),
            needs_wrapped_body: false,
            uses_module_object: summary.module_object_escapes,
            is_replaced_late: false,
            exports_ordinary_object: false,
        },
        accesses: Vec::new(),
        mentions: Vec::new(),
        replacements: Vec::new(),
        marking_calls: Vec::new(),
        quiet_head: OnceCell::new(),
    }
}

fn scan_texts_of_inner_modules(
    text: &Text<'_, '_>,
    sites: &[ScannedSite],
    inner_modules: &[&InnerModule],
    summaries: &[ExportsSummary],
    certain_helper: &dyn Fn(ExprId) -> Option<HelperShape>,
    half: &dyn Fn(ModuleRef) -> bool,
) -> Vec<ModuleText> {
    let mut parameters: Vec<(SymbolId, u32)> = Vec::with_capacity(2 * inner_modules.len());
    let mut scans = Vec::with_capacity(inner_modules.len());
    for ((&inner, summary), index) in inner_modules.iter().zip(summaries).zip(0u32..) {
        let named = [inner.exports_parameter, inner.module_parameter];
        parameters.extend(named.into_iter().flatten().map(|symbol| (symbol, index)));
        let is_half = half(ModuleRef::Inner {
            file: text.file,
            callback: inner.callback,
        });
        let callback = Some(inner.callback);
        scans.push(begin_scan(
            text,
            sites,
            summary,
            certain_helper,
            callback,
            is_half,
        ));
    }
    parameters.shared_sort_unstable();
    for name in (0..text.hir.exprs.len() as u32).map(ExprId) {
        if !text.bound.is_evaluated_ident(name) || text.decisions.is_dead_expr(name) {
            continue;
        }
        let Binding::Symbol(symbol) = text.bound.binding(name) else {
            continue;
        };
        let Ok(at) = parameters.binary_search_by_key(&symbol, |entry| entry.0) else {
            continue;
        };
        let index = parameters[at].1 as usize;
        if inner_modules[index].exports_parameter == Some(symbol) {
            scans[index].look_at_object(name, false);
            continue;
        }
        match text.parent(name) {
            (_, Parent::Expr(member)) if member.is_some() => {
                scans[index].look_at_object(member, true);
            }
            _ => scans[index].found.has_names = false,
        }
    }
    scans.into_iter().map(Scan::finish).collect()
}

fn scan_own_text(
    text: &Text<'_, '_>,
    sites: &[ScannedSite],
    summary: &ExportsSummary,
    certain_helper: &dyn Fn(ExprId) -> Option<HelperShape>,
    is_half: bool,
    is_entry_point: bool,
    runs_again: bool,
) -> ModuleText {
    let (hir, bound, decisions) = (text.hir, text.bound, text.decisions);
    let needs_wrapped_body = needs_wrapped_body(text);
    let mut scan = begin_scan(text, sites, summary, certain_helper, None, is_half);
    scan.found.has_names &= !needs_wrapped_body && !is_entry_point && !runs_again;
    scan.found.needs_wrapped_body = needs_wrapped_body;
    for &(name, binding) in bound.ident_bindings() {
        if decisions.is_dead_expr(name) {
            continue;
        }
        match binding {
            Binding::CommonJs(CommonJsVariable::Exports) => scan.look_at_object(name, false),
            Binding::CommonJs(CommonJsVariable::Module) => scan.look_at_module_name(name),
            Binding::CommonJs(
                CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
            )
            | Binding::Symbol(_)
            | Binding::Arguments(_)
            | Binding::Free => {}
        }
    }
    if scan.found.has_names && !text.analysis.has_esm_syntax {
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            if !matches!(hir[expression].kind, ExprKind::This) || decisions.is_dead_expr(expression)
            {
                continue;
            }
            match text.climb(expression, None) {
                Some((_, false)) => scan.look_at_object(expression, false),
                Some((_, true)) => {}
                None => scan.found.has_names = false,
            }
        }
    }
    for binding in text.analysis.bindings_read_without_expression(hir, bound) {
        match binding {
            Binding::CommonJs(CommonJsVariable::Exports) => scan.found.has_names = false,
            Binding::CommonJs(CommonJsVariable::Module) => {
                scan.found.uses_module_object = true;
                scan.found.has_names = false;
            }
            _ => {}
        }
    }
    if !hir.is_js {
        for statement in (hir.ids(hir.body)).chain(bound.export_assignments_in_namespaces(hir)) {
            let statement: StmtId = statement;
            if let StmtKind::ExportAssign(value) = hir[statement].kind {
                scan.add_replacement(value, Some(value), true);
            }
        }
    }
    scan.finish()
}

#[derive(Default)]
struct ModuleIndex {
    files: Vec<u32>,
    inner_modules: Vec<((FileId, FnId), u32)>,
}

impl ModuleIndex {
    #[inline]
    fn find(&self, module: ModuleRef) -> Option<usize> {
        match module {
            ModuleRef::File(file) => {
                let number = *self.files.get(file.idx())?;
                (number != u32::MAX).then_some(number as usize)
            }
            ModuleRef::Inner { file, callback } => {
                find(&self.inner_modules, (file, callback)).map(|number| number as usize)
            }
            _ => None,
        }
    }
}

pub(super) struct CommonJsTexts {
    modules: Vec<ModuleText>,
    index: ModuleIndex,
    stored_markers: Vec<ModuleRef>,
}

pub(super) fn scan_commonjs_modules(input: &CommonJsInput<'_, '_, '_>) -> CommonJsTexts {
    let (bind, scans, modules) = (input.bind, input.scans, input.modules);
    let (files, sources) = (bind.files, bind.sources);
    let is_library = find_library_files(bind);
    let mut is_entry_point = vec![false; files.modules.len()];
    for entry_point in sources.entry_points() {
        is_entry_point[entry_point.file.idx()] = true;
    }
    let is_commonjs =
        |file: FileId| modules.interop(ModuleRef::File(file)).kind == ModuleKind::CommonJs;
    let mut parsed = modules.compiled_files.iter();
    let commonjs_file_may_be_main = sources.entry_points().iter().any(|it| is_commonjs(it.file))
        || parsed.any(|&file| {
            parsed_source(files, file)
                .is_some_and(|source| source.builtins.may_store_path_of_main_module())
        });
    let compiled_files = modules.compiled_files.iter();
    let mut scanned: Vec<(FileId, Vec<ModuleText>)> =
        compiled_files.map(|&file| (file, Vec::new())).collect();
    for_each_mut(&mut scanned, bind.in_parallel, &|(file, found)| {
        let file = *file;
        let Some(text) = Text::new(bind, &modules.wrapped, file) else {
            return;
        };
        let scan = scans.of(file);
        let certain_helper = |callee: ExprId| {
            let known = bind.known_helpers.certain_callee(files, file, callee)?;
            Some(known.shape)
        };
        let inner_modules = modules.wrapped.of_file(file).iter();
        let inner_modules: Vec<&InnerModule> = inner_modules
            .filter(|inner| inner.kind == InnerModuleKind::CommonJs)
            .collect();
        let mut inner_texts = Vec::new();
        if !inner_modules.is_empty() {
            let summaries = summarize_inner_modules(input, file, &inner_modules);
            inner_texts = scan_texts_of_inner_modules(
                &text,
                &scan.sites,
                &inner_modules,
                &summaries,
                &certain_helper,
                input.half,
            );
        }
        let module = ModuleRef::File(file);
        let interop = modules.interop(module);
        if interop.kind != ModuleKind::CommonJs
            || sources.kind(file) != SourceKind::Program
            || is_library[file.idx()]
        {
            *found = inner_texts;
            return;
        }
        let summary = summarize_file(input, file);
        let is_half = (input.half)(module);
        let own_text = scan_own_text(
            &text,
            &scan.sites,
            &summary,
            &certain_helper,
            is_half,
            is_entry_point[file.idx()],
            modules.runs_again(file),
        );
        found.push(ModuleText {
            is_marker_ignored_by_imports: interop.export_rule
                == SyntheticExportRule::CommonJsIgnoringAnnotation,
            runs_in_place: bind.runs_in_place,
            ..own_text
        });
        found.append(&mut inner_texts);
    });
    let mut texts = CommonJsTexts {
        modules: Vec::new(),
        index: ModuleIndex {
            files: vec![u32::MAX; files.modules.len()],
            inner_modules: Vec::new(),
        },
        stored_markers: Vec::new(),
    };
    for (file, found) in scanned {
        for found in found {
            let number = texts.modules.len() as u32;
            match found.inner {
                Some(callback) => texts.index.inner_modules.push(((file, callback), number)),
                None => texts.index.files[file.idx()] = number,
            }
            texts.modules.push(found);
        }
    }
    let inner_modules = &mut texts.index.inner_modules;
    inner_modules.shared_sort_unstable_by_key(|entry| entry.0);
    let find_open_marker_of = |module: ModuleRef| match modules.interop(module).kind {
        ModuleKind::CommonJs => {
            let text = &texts.modules[texts.index.find(module)?];
            (text.marker.is_some() && !text.is_marker_fixed).then_some(true)
        }
        ModuleKind::SourceText => Some(false),
        _ => None,
    };
    let find_open_marker = |module: ModuleRef| {
        find_open_marker_of(module).or_else(|| find_open_marker_of(modules.module_behind(module)))
    };
    let program_files = modules
        .compiled_files
        .iter()
        .filter(|file| sources.kind(**file) == SourceKind::Program && !is_library[file.idx()]);
    let mut taken_in_files: Vec<(FileId, TakenObjects)> = program_files
        .map(|&file| (file, TakenObjects::default()))
        .collect();
    for_each_mut(&mut taken_in_files, bind.in_parallel, &|(file, taken)| {
        if let Some(text) = Text::new(bind, &modules.wrapped, *file) {
            let scan = scans.of(*file);
            *taken = find_taken_objects(&text, scan, commonjs_file_may_be_main, &find_open_marker);
        }
    });
    let mut all_taken = TakenObjects::default();
    for (_, mut taken) in taken_in_files {
        all_taken.required.append(&mut taken.required);
        all_taken.imported.append(&mut taken.imported);
        all_taken.defaults.append(&mut taken.defaults);
        all_taken.called.append(&mut taken.called);
        all_taken.names_way_to_module_objects |= taken.names_way_to_module_objects;
    }
    texts.forget_markers_that_may_change(modules, &all_taken);
    texts
}

impl CommonJsTexts {
    fn forget_markers_that_may_change(&mut self, modules: &ModuleSet, taken: &TakenObjects) {
        let text_of = |module: ModuleRef| Some(&self.modules[self.index.find(module)?]);
        let lacks_marker =
            |module: &ModuleRef| text_of(*module).is_some_and(|text| text.marker != Some(true));
        let own_calls = self.modules.iter().flat_map(|text| {
            let calls = text.names_called.iter();
            calls.map(|&name| (text.module(), name))
        });
        let calls = taken.called.iter().copied().chain(own_calls);
        let handed_over = calls.filter(|&(module, name)| {
            text_of(module).is_some_and(|text| text.may_look_at_this_under(name))
        });
        let changed = taken.required.iter().chain(&taken.imported).copied();
        let changed = changed.chain(taken.defaults.iter().copied().filter(lacks_marker));
        let changed = changed.chain(handed_over.map(|(module, _)| module));
        let changed: Vec<ModuleRef> = changed.collect();
        let mut is_listed = FxHashSet::default();
        for module in changed {
            for module in [module, modules.module_behind(module)] {
                if let Some(number) = self.index.find(module) {
                    let text = &mut self.modules[number];
                    if text.marker.is_none() || text.is_marker_fixed {
                        continue;
                    }
                    text.marker = None;
                }
                if is_listed.insert(module) {
                    self.stored_markers.push(module);
                }
            }
        }
        if taken.names_way_to_module_objects {
            for text in self.modules.iter_mut().filter(|text| !text.is_marker_fixed) {
                text.marker = None;
            }
        }
    }

    pub(super) fn marker(&self, module: ModuleRef) -> Option<bool> {
        self.modules[self.index.find(module)?].marker
    }

    pub(super) fn markers_stored_from_outside(&self) -> Vec<ModuleRef> {
        self.stored_markers.clone()
    }

    pub(super) fn entries(&self) -> Vec<ModuleEntries> {
        self.modules.iter().map(create_entries).collect()
    }

    pub(super) fn may_end_without(&self, module: ModuleRef, name: Atom) -> bool {
        let text = self.index.find(module).map(|number| &self.modules[number]);
        text.is_some_and(|text| {
            text.is_half || !text.has_names || !text.is_always_found_by_statements(name)
        })
    }

    pub(super) fn names_read_by_own_text(&self) -> impl Iterator<Item = (ModuleRef, Atom)> + '_ {
        let texts = self.modules.iter().filter(|text| text.has_names);
        texts.flat_map(|text| text.names_read.iter().map(|&name| (text.module(), name)))
    }
}

fn create_entries(text: &ModuleText) -> ModuleEntries {
    let mut names: Vec<((u32, u32), NameEntry)> = Vec::new();
    for creation in &text.creations {
        let created_at = match creation.is_in_order() {
            true => creation.end,
            false => u32::MAX,
        };
        match names.last_mut().filter(|it| it.1.name == creation.name) {
            Some((_, entry)) => entry.created_at = entry.created_at.min(created_at),
            None => names.push((
                (creation.start, creation.start),
                NameEntry {
                    name: creation.name,
                    getter: None,
                    created_at,
                    is_enumerable: creation.is_enumerable,
                },
            )),
        }
    }
    names.extend(text.aliases.iter().map(|alias| {
        let entry = NameEntry {
            name: alias.name,
            getter: Some(Getter {
                target: alias.target,
                is_seen_unfilled: alias.is_seen_unfilled,
            }),
            created_at: alias.start,
            is_enumerable: alias.is_enumerable,
        };
        ((alias.start, alias.returned_start), entry)
    }));
    names.shared_sort_by_key(|it| it.0);
    ModuleEntries {
        module: text.module(),
        has_names: text.has_names,
        knows_all_names: text.knows_all_names(),
        lists_only_enumerable_names: text.lists_only_enumerable_names(),
        runs_in_place: text.runs_in_place,
        is_half: text.is_half,
        is_replaced_late: text.is_replaced_late,
        exports_ordinary_object: text.exports_ordinary_object,
        marker: match text.is_marker_ignored_by_imports {
            true => Some(false),
            false => text.marker,
        },
        names: names.into_iter().map(|it| it.1).collect(),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Target {
    Name(ModuleRef, Atom),
    Binding(Sym),
    Nothing,
}

#[derive(Default)]
pub struct CommonJsExports {
    modules: Vec<ModuleText>,
    index: ModuleIndex,
    accesses_of_inner_modules: Vec<((FileId, ExprId), u32)>,
    statements_of_inner_modules: Vec<((FileId, StmtId), u32)>,
    has_object: Vec<bool>,
    dependents: Vec<Vec<ModuleRef>>,
    name_sources: Vec<Vec<ModuleRef>>,
    ids: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    names_by_id: Vec<Option<(ModuleRef, Atom)>>,
    targets: FxHashMap<(ModuleRef, Atom), Target>,
    copied_names: FxHashMap<(ModuleRef, Atom), bool>,
    stored_by_other_files: FxHashMap<(ModuleRef, Atom), bool>,
    exported_bindings: Vec<Sym>,
    faces: Faces,
}

impl CommonJsExports {
    pub(super) fn finish(
        input: &CommonJsInput<'_, '_, '_>,
        texts: CommonJsTexts,
        tables: &ExportTables,
        imports: &[FileImports],
        synthetic: &SyntheticExports,
    ) -> CommonJsExports {
        let CommonJsTexts {
            modules,
            index,
            stored_markers,
        } = texts;
        let mut exports = CommonJsExports {
            has_object: vec![false; modules.len()],
            dependents: vec![Vec::new(); modules.len()],
            name_sources: vec![Vec::new(); modules.len()],
            index,
            ..CommonJsExports::default()
        };
        for (id, export) in synthetic.iter() {
            let key = (export.module, export.name);
            let is_own = exports.number_of(export.module).is_some();
            debug_assert_eq!(id.0 as usize, exports.names_by_id.len());
            exports.names_by_id.push(is_own.then_some(key));
            if is_own {
                exports.ids.insert(key, id);
            }
        }
        let mut looked_at = stored_markers;
        for (number, text) in modules.iter().enumerate() {
            if !exports.bind_names_of_module(input.modules, tables, number, text) {
                looked_at.push(text.module());
            }
            if text.inner.is_some() {
                let (file, number) = (text.file, number as u32);
                let accesses = text.own_accesses.iter();
                let accesses = accesses.map(|access| ((file, access.node), number));
                exports.accesses_of_inner_modules.extend(accesses);
                let statements = text.erased.iter();
                let statements = statements.map(|&statement| ((file, statement), number));
                exports.statements_of_inner_modules.extend(statements);
            }
        }
        let accesses = &mut exports.accesses_of_inner_modules;
        accesses.shared_sort_unstable_by_key(|entry| entry.0);
        let statements = &mut exports.statements_of_inner_modules;
        statements.shared_sort_unstable_by_key(|entry| entry.0);
        exports.modules = modules;
        exports.exported_bindings.sort_unstable();
        exports.exported_bindings.dedup();
        for module in looked_at {
            exports.look_at(module);
        }
        exports.add_stores_of_other_files(input, imports);
        exports.look_at_modules_whose_getters_read_copies();
        exports.look_at_modules_that_call_through_their_object();
        exports.look_at_modules_whose_object_importers_see(input, tables, imports);
        let mut faces = Faces::new(input, tables, imports);
        faces.decide(&exports);
        exports.faces = faces;
        exports
    }

    fn add_name_source(&mut self, number: usize, taker: ModuleRef, source: ModuleRef) {
        if self.name_sources[number].contains(&source) {
            return;
        }
        self.name_sources[number].push(source);
        if let Some(source) = self.number_of(source) {
            self.dependents[source].push(taker);
        }
    }

    fn bind_names_of_module(
        &mut self,
        modules: &ModuleSet,
        tables: &ExportTables,
        number: usize,
        text: &ModuleText,
    ) -> bool {
        let module = text.module();
        let mut is_bound = true;
        for alias in &text.aliases {
            if let AliasTarget::Member { module: source, .. } = alias.target {
                self.add_name_source(number, module, source);
            }
            let resolved = tables.resolve_required(modules, module, alias.name);
            let target = match resolved.resolution {
                Resolution::Synthetic { module, name } => Target::Name(module, name),
                Resolution::Variable(symbol) => Target::Binding(symbol),
                _ => Target::Nothing,
            };
            if target == Target::Name(module, alias.name) {
                is_bound = false;
                continue;
            }
            self.targets.insert((module, alias.name), target);
            if let Target::Name(owner, _) = target {
                self.add_name_source(number, module, owner);
            }
            if tables.commonjs.is_copied(module, alias.name) {
                let is_copy_of_name = tables.commonjs.is_copy_of_name(module, alias.name);
                self.copied_names
                    .insert((module, alias.name), is_copy_of_name);
            }
            if let Target::Binding(symbol) = target {
                self.exported_bindings.push(symbol);
            }
        }
        is_bound
    }

    fn add_stores_of_other_files(
        &mut self,
        input: &CommonJsInput<'_, '_, '_>,
        imports: &[FileImports],
    ) {
        let files = input.bind.files;
        let mut looked_at = Vec::new();
        for (&file, file_imports) in input.modules.compiled_files.iter().zip(imports) {
            let (hir, bound) = (files.hir(file), files.bound(file));
            let mut text = None;
            let members = file_imports.members.iter().zip(&file_imports.accessed);
            for (&(member, binding), &(_, accessed)) in members {
                let PendingBinding::Synthetic { module, name } = binding else {
                    continue;
                };
                let Some(own_text) = self.text_of(module) else {
                    continue;
                };
                let outermost = find_outermost_type_assertion(hir, bound, member);
                if bound.get_assignment_target(hir, outermost).is_none() {
                    continue;
                }
                if accessed.module != module {
                    looked_at.push(accessed.module);
                }
                if own_text.creations_of(name).iter().any(|it| it.is_read_only) {
                    looked_at.push(module);
                }
                let text =
                    text.get_or_insert_with(|| Text::new(input.bind, &input.modules.wrapped, file));
                let stored = text.as_ref().and_then(|text| {
                    let (_, value) = text.find_assignment(member)?;
                    Some(text.classify_value(value, 0))
                });
                let ignores_this = stored.is_some_and(|stored| stored != StoredValue::Unknown);
                let stored = self.stored_by_other_files.entry((module, name));
                *stored.or_insert(true) &= ignores_this;
            }
        }
        for module in looked_at {
            self.look_at(module);
        }
    }

    fn is_read_off_another_kind_of_module(&self, mut module: ModuleRef, mut name: Atom) -> bool {
        for _ in 0..=self.modules.len() {
            let alias = self.text_of(module).and_then(|text| text.alias_of(name));
            let Some(AliasTarget::Member {
                module: source,
                name: name_there,
            }) = alias.map(|alias| alias.target)
            else {
                return false;
            };
            if self.number_of(source).is_none() {
                return true;
            }
            (module, name) = (source, name_there);
        }
        true
    }

    fn look_at_modules_whose_getters_read_copies(&mut self) {
        let reads_copy = |(&(module, name), &target): (&(ModuleRef, Atom), &Target)| match target {
            Target::Name(owner, owner_name) => {
                !self.is_import_bound_to_variable(owner, owner_name)
                    && self.is_read_off_another_kind_of_module(module, name)
            }
            Target::Binding(_) | Target::Nothing => false,
        };
        let names = self.targets.iter().filter(|&entry| reads_copy(entry));
        let modules: Vec<ModuleRef> = names.map(|(&(module, _), _)| module).collect();
        for module in modules {
            self.look_at(module);
        }
    }

    fn look_at_modules_that_call_through_their_object(&mut self) {
        let hands_object_over = |text: &&ModuleText| {
            let mut calls = text.names_called.iter();
            text.has_names && calls.any(|&name| !self.ignores_this(text.module(), name))
        };
        let texts = self.modules.iter().filter(hands_object_over);
        let modules: Vec<ModuleRef> = texts.map(ModuleText::module).collect();
        for module in modules {
            self.look_at(module);
        }
    }

    pub(super) fn has_default_of_its_own(&self, module: ModuleRef) -> bool {
        let text = self.text_of(module);
        self.marker_for_imports(module) == Some(true)
            && text.is_some_and(|text| text.always_lists(known::default))
    }

    fn look_at_modules_whose_object_importers_see(
        &mut self,
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) {
        let is_half_when = |module: ModuleRef, linked: ModuleRef| {
            self.text_of(module).is_some_and(|text| text.is_half) && (input.half_at_link)(linked)
        };
        let is_half = |module: ModuleRef| is_half_when(module, module);
        let mut modules = Vec::new();
        let mut asked_for_default = Vec::new();
        let mut add_imported_name = |binding: PendingBinding, named: Option<ModuleRef>| {
            let PendingBinding::Synthetic { module, name } = binding else {
                return;
            };
            if name == known::default {
                asked_for_default.push(module);
                asked_for_default.extend(named);
            }
            if named.is_some_and(|named| is_half(module) || is_half_when(module, named)) {
                modules.push(module);
            }
        };
        for file_imports in imports {
            for &(_, binding) in &file_imports.bindings {
                add_imported_name(binding, None);
            }
            let members = file_imports.members.iter().zip(&file_imports.accessed);
            for (&(_, binding), &(_, accessed)) in members {
                if accessed.is_imported {
                    add_imported_name(binding, Some(accessed.module));
                }
            }
            for jsx in &file_imports.jsx {
                if jsx.exporter.is_some() {
                    add_imported_name(jsx.binding, jsx.exporter);
                }
            }
        }
        for &file in &input.modules.record_files {
            for &(_, resolved) in tables.names(file) {
                if let Resolution::Synthetic { module, name } = resolved.resolution
                    && name == known::default
                {
                    asked_for_default.push(module);
                }
            }
        }
        let seen = collect_seen_namespaces(input.modules, tables, imports);
        let seen = seen.into_iter().map(ModuleRef::File);
        asked_for_default.extend(seen.clone());
        let shows_object =
            |module: &ModuleRef| !self.has_default_of_its_own(*module) || is_half(*module);
        modules.extend(asked_for_default.into_iter().filter(shows_object));
        let says_all_names = |module: ModuleRef| {
            self.text_of(module)
                .is_some_and(ModuleText::knows_all_names)
        };
        modules.extend(seen.filter(|&module| !says_all_names(module)));
        let absent_names = tables.absent_commonjs_names.iter();
        let absent_names = absent_names.map(|&(imported, _)| imported);
        for imported in absent_names.chain(tables.dropped_commonjs_names.iter().copied()) {
            let exporter = ModuleRef::File(imported.exporter);
            let owner = self.owner_of(exporter, imported.name);
            modules.push(owner.map_or(exporter, |owner| owner.0));
        }
        for module in modules {
            self.look_at(module);
        }
    }

    #[inline]
    fn number_of(&self, module: ModuleRef) -> Option<usize> {
        self.index.find(module)
    }

    fn text_of(&self, module: ModuleRef) -> Option<&ModuleText> {
        Some(&self.modules[self.number_of(module)?])
    }

    pub fn look_at(&mut self, module: ModuleRef) {
        let mut pending = vec![module];
        let mut fallen = Vec::new();
        while let Some(module) = pending.pop() {
            let Some(number) = self.number_of(module) else {
                continue;
            };
            if core::mem::replace(&mut self.has_object[number], true) {
                continue;
            }
            fallen.push(module);
            pending.extend_from_slice(&self.dependents[number]);
            pending.extend_from_slice(&self.name_sources[number]);
        }
        if fallen.is_empty() {
            return;
        }
        let mut faces = core::mem::take(&mut self.faces);
        for module in fallen {
            faces.decide_behind(self, module);
        }
        self.faces = faces;
    }

    pub(super) fn call_through_namespace(&mut self, module: ModuleRef, name: Atom) {
        let is_stored_by_name = self.has_names(module)
            && (name != known::default || self.has_default_of_its_own(module));
        if !is_stored_by_name || !self.ignores_this(module, name) {
            self.see_namespace(module);
        }
    }

    fn see_namespace(&mut self, module: ModuleRef) {
        let ModuleRef::File(file) = module else {
            return;
        };
        if self.number_of(module).is_none() {
            return;
        }
        self.look_at(module);
        let mut faces = core::mem::take(&mut self.faces);
        faces.see_namespace(self, file);
        self.faces = faces;
    }

    pub fn shape(&self, module: ModuleRef) -> Shape {
        let number = self.number_of(module);
        match number.map(|number| self.keeps_names(number)) {
            None => Shape::AsToday,
            Some(true) => Shape::Names,
            Some(false) => Shape::Value,
        }
    }

    pub fn has_names(&self, module: ModuleRef) -> bool {
        self.number_of(module)
            .is_some_and(|number| self.keeps_names(number))
    }

    fn keeps_names(&self, number: usize) -> bool {
        self.modules[number].has_names && !self.has_object[number]
    }

    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.number_of(module)
            .map_or(&[], |number| &self.name_sources[number][..])
    }

    pub fn names_bound_elsewhere(&self) -> impl Iterator<Item = (ModuleRef, Member)> + '_ {
        let names = self.modules.iter().flat_map(|text| {
            let aliases = text.aliases.iter();
            aliases.map(|alias| (text.module(), alias.name))
        });
        names.filter_map(|(module, name)| {
            let target = match self.copied_names.get(&(module, name)) {
                Some(true) => self.targets[&(module, name)],
                _ => self.imported_target(module, name),
            };
            let member = match target {
                Target::Name(owner, _) if owner == module => return None,
                Target::Name(owner, owner_name) => {
                    Member::Variable(*self.ids.get(&(owner, owner_name))?)
                }
                Target::Binding(symbol) => Member::Binding(symbol),
                Target::Nothing => return None,
            };
            Some((module, member))
        })
    }

    fn imported_target(&self, module: ModuleRef, name: Atom) -> Target {
        match self.targets.get(&(module, name)) {
            Some(&target) if !self.copied_names.contains_key(&(module, name)) => target,
            Some(_) | None => Target::Name(module, name),
        }
    }

    fn owner_of(&self, module: ModuleRef, name: Atom) -> Option<(ModuleRef, Atom)> {
        self.text_of(module)?;
        match self.imported_target(module, name) {
            Target::Name(owner, owner_name) => Some((owner, owner_name)),
            Target::Binding(_) | Target::Nothing => None,
        }
    }

    pub fn member_named(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        let number = self.number_of(module)?;
        if !self.keeps_names(number) {
            return Some(Member::OnObject);
        }
        if name == known::__esModule {
            match self.modules[number].marker {
                Some(false) if !self.stored_by_other_files.contains_key(&(module, name)) => {
                    return Some(Member::Marker(false));
                }
                Some(true) => return Some(Member::Marker(true)),
                Some(false) | None => {}
            }
        }
        let target = self.targets.get(&(module, name)).copied();
        match target.unwrap_or(Target::Name(module, name)) {
            Target::Name(owner, owner_name) => {
                Some(Member::Variable(*self.ids.get(&(owner, owner_name))?))
            }
            Target::Binding(symbol) => Some(Member::Binding(symbol)),
            Target::Nothing => Some(Member::Undefined),
        }
    }

    #[inline]
    pub fn own_member(&self, file: FileId, access: ExprId) -> Option<Member> {
        let number = self.find_module_of_access(file, access)?;
        self.own_member_in(number, access)
    }

    fn own_member_in(&self, number: usize, access: ExprId) -> Option<Member> {
        let entry = self.find_own_access_in(number, access)?;
        let text = &self.modules[number];
        if !self.keeps_names(number) {
            return Some(Member::OnObject);
        }
        if entry.says_marker {
            return Some(Member::Marker(true));
        }
        if entry.is_store_only && text.alias_of(entry.name).is_some() {
            return Some(Member::Undefined);
        }
        let member = self.member_named(text.module(), entry.name);
        Some(member.unwrap_or(Member::Undefined))
    }

    #[inline]
    fn find_module_of_access(&self, file: FileId, access: ExprId) -> Option<usize> {
        let of_inner_modules = &self.accesses_of_inner_modules;
        let inner_module = match of_inner_modules.is_empty() {
            true => None,
            false => find(of_inner_modules, (file, access)),
        };
        match inner_module {
            Some(number) => Some(number as usize),
            None => self.number_of(ModuleRef::File(file)),
        }
    }

    fn find_own_access_in(&self, number: usize, access: ExprId) -> Option<OwnAccess> {
        let accesses = &self.modules[number].own_accesses;
        let at = accesses.binary_search_by_key(&access, |it| it.node);
        Some(accesses[at.ok()?])
    }

    fn find_own_access(&self, file: FileId, access: ExprId) -> Option<(usize, OwnAccess)> {
        let number = self.find_module_of_access(file, access)?;
        Some((number, self.find_own_access_in(number, access)?))
    }

    pub fn module_of_store_of_nothing(&self, file: FileId, access: ExprId) -> Option<ModuleRef> {
        let (number, entry) = self.find_own_access(file, access)?;
        let stores_nothing = entry.stores_nothing && self.keeps_names(number);
        stores_nothing.then(|| self.modules[number].module())
    }

    fn name_of_variable(&self, variable: SyntheticExportId) -> Option<(ModuleRef, Atom)> {
        self.names_by_id.get(variable.0 as usize).copied().flatten()
    }

    pub fn required_member(&self, accessed: ModuleRef, variable: SyntheticExportId) -> Member {
        match self.name_of_variable(variable) {
            Some((owner, name)) if self.has_names(accessed) => {
                let member = self.member_behind_getter(owner, name);
                member.unwrap_or(Member::Variable(variable))
            }
            Some(_) | None => Member::OnObject,
        }
    }

    pub fn member_behind_getter(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        match self.targets.contains_key(&(module, name)) {
            true => self.member_named(module, name),
            false => None,
        }
    }

    pub fn is_left_out_by_capture_of_executable(&self, module: ModuleRef, name: Atom) -> bool {
        self.text_of(module).is_some_and(|text| {
            let hidden = &text.names_hidden_from_loops;
            !text.runs_in_place && hidden.binary_search_by_key(&name.0, |it| it.0).is_ok()
        })
    }

    pub fn is_getter_that_no_loop_sees(&self, module: ModuleRef, name: Atom) -> bool {
        let alias = self.text_of(module).and_then(|text| text.alias_of(name));
        alias.is_some_and(|alias| !alias.is_enumerable)
    }

    pub fn imported_member(&self, variable: SyntheticExportId) -> Member {
        match self.name_of_variable(variable) {
            Some((owner, name)) if self.is_import_bound_to_variable(owner, name) => {
                let behind = self.member_behind_getter(owner, name);
                behind.unwrap_or(Member::Variable(variable))
            }
            _ => Member::Copy(variable),
        }
    }

    fn is_import_bound_to_variable(&self, owner: ModuleRef, name: Atom) -> bool {
        (name != known::default || self.marker_for_imports(owner) == Some(true))
            && self.settled(owner, name)
    }

    #[inline]
    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        if !self.statements_of_inner_modules.is_empty()
            && let Some(number) = find(&self.statements_of_inner_modules, (file, statement))
        {
            return self.keeps_names(number as usize);
        }
        self.number_of(ModuleRef::File(file))
            .is_some_and(|number| self.is_erased_in(number, statement))
    }

    fn is_erased_in(&self, number: usize, statement: StmtId) -> bool {
        self.keeps_names(number)
            && self.modules[number]
                .erased
                .binary_search(&statement)
                .is_ok()
    }

    #[inline]
    pub fn is_evaluated_at_store(&self, file: FileId, statement: StmtId) -> bool {
        self.number_of(ModuleRef::File(file)).is_some_and(|number| {
            self.keeps_names(number) && self.modules[number].evaluated_at_store == Some(statement)
        })
    }

    pub fn is_exported_binding(&self, file: FileId, symbol: SymbolId) -> bool {
        let binding = Sym { file, id: symbol };
        self.exported_bindings.binary_search(&binding).is_ok()
    }

    pub fn settled(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(text) = self.text_of(module) else {
            return false;
        };
        if self.copied_names.get(&(module, name)) == Some(&true)
            && let Some(&Target::Name(owner, owner_name)) = self.targets.get(&(module, name))
        {
            return self.has_names(module) && self.settled(owner, owner_name);
        }
        let creations = text.creations_of(name);
        self.has_names(module)
            && !text.is_half
            && !self.targets.contains_key(&(module, name))
            && !self.stored_by_other_files.contains_key(&(module, name))
            && creations.iter().any(Creation::is_in_order)
            && creations.iter().all(|it| it.position != SitePosition::Late)
    }

    pub fn ignores_this(&self, module: ModuleRef, name: Atom) -> bool {
        let (mut module, mut name) = (module, name);
        for _ in 0..=self.modules.len() {
            let Some(text) = self.text_of(module) else {
                return false;
            };
            if !text.has_names || self.stored_by_other_files.get(&(module, name)) == Some(&false) {
                return false;
            }
            let alias = text.alias_of(name);
            if let Some(alias) = alias
                && matches!(alias.target, AliasTarget::Binding(_))
            {
                return alias.value != StoredValue::Unknown;
            }
            match self.targets.get(&(module, name)) {
                Some(&Target::Name(owner, owner_name)) => (module, name) = (owner, owner_name),
                Some(Target::Binding(_)) => return false,
                Some(Target::Nothing) => return true,
                None if alias.is_some() => return false,
                None => {
                    let mut creations = text.creations_of(name).iter();
                    return creations.all(|it| it.value != StoredValue::Unknown);
                }
            }
        }
        false
    }

    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        let key = (module, known::__esModule);
        let marker = self.text_of(module)?.marker;
        marker.filter(|_| !self.stored_by_other_files.contains_key(&key))
    }

    pub fn marker_for_imports(&self, module: ModuleRef) -> Option<bool> {
        match self.text_of(module)?.is_marker_ignored_by_imports {
            true => Some(false),
            false => self.marker(module),
        }
    }

    pub fn needs_wrapped_body(&self, module: ModuleRef) -> bool {
        self.text_of(module)
            .is_some_and(|text| text.needs_wrapped_body)
    }

    pub fn uses_module_object(&self, module: ModuleRef) -> bool {
        self.text_of(module)
            .is_some_and(|text| text.uses_module_object)
    }
}
