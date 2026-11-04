//! What the CommonJS modules of the program export.

mod faces;
mod helper_calls;
mod summary;
#[cfg(test)]
mod tests;

pub(super) use self::faces::collect_seen_namespaces;
use self::faces::Faces;
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
use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinNames, ResolvedBuiltins, table};
use crate::ir::for_each_mut;
use crate::known_helpers::{Quiet, Shape as HelperShape};
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
    self, BinOp, CallId, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, MemberKey, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ThisPositions;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use std::cell::OnceCell;

pub(super) struct CommonJsInput<'a, 'b, 's> {
    pub bind: &'a BindInput<'b, 's>,
    pub scans: &'a Scans,
    pub modules: &'a ModuleSet,
    /// Somebody may look at the module while its body runs.
    pub half: &'a (dyn Fn(ModuleRef) -> bool + Sync),
    /// An ES module that asks for the module may be linked while its body runs.
    pub half_at_link: &'a (dyn Fn(ModuleRef) -> bool + Sync),
    /// An ES module that something other than an import starts. Only such a module has a check.
    pub is_prefix_root: &'a (dyn Fn(FileId) -> bool + Sync),
}

/// What a name stands for that has no variable of its own.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::modules) enum AliasTarget {
    /// What another module has under a name.
    Member { module: ModuleRef, name: Atom },
    /// A binding of the top level of the file.
    Binding(Sym),
}

#[derive(Copy, Clone, Debug)]
pub(in crate::modules) struct NameEntry {
    pub name: Atom,
    /// `None`: the module has a variable for it.
    pub target: Option<AliasTarget>,
    /// Where the body has created it for sure. `u32::MAX`: some run of the body may end without it.
    pub created_at: u32,
    pub is_enumerable: bool,
    /// The link may come in front of what fills the binding that the name stands for.
    pub is_seen_unfilled: bool,
}

pub(in crate::modules) struct ModuleEntries {
    pub module: ModuleRef,
    pub has_names: bool,
    pub knows_all_names: bool,
    pub is_half: bool,
    pub is_replaced_late: bool,
    /// `ModuleText::exports_ordinary_object`
    pub exports_ordinary_object: bool,
    pub marker: Option<bool>,
    /// In the order of the text.
    pub names: Vec<NameEntry>,
}

/// A name that an ES module imports of a CommonJS file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct CommonJsImport {
    pub importer: FileId,
    /// The file that the import names, or the one whose names the ES module that it names hands on.
    pub exporter: FileId,
    pub name: Atom,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum StoredValue {
    Undefined,
    /// A function that does not look at its `this`, or nothing that can be called.
    IgnoresThis,
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum AccessKind {
    Read,
    Store(StoredValue),
    /// `op=`, `++`, `--`: a read and a store of a number, a string or a big integer.
    Update,
    /// `||=`, `&&=`, `??=`: a read, and a store on some runs.
    Choice(StoredValue),
    /// The object would be `this`.
    Call,
}

#[derive(Copy, Clone, Debug)]
struct Access {
    node: ExprId,
    name: Atom,
    kind: AccessKind,
}

/// A place that gives the module a name.
#[derive(Copy, Clone, Debug)]
struct Creation {
    name: Atom,
    /// The assignment, the call of `Object.defineProperty` or of a helper, or the value of a property of a literal.
    node: ExprId,
    value: StoredValue,
    value_node: ExprId,
    position: SitePosition,
    is_enumerable: bool,
    is_read_only: bool,
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
    /// The call that defines it, or the store to `module.exports` of what a helper has defined it on.
    node: ExprId,
    /// What a binding holds.
    value: StoredValue,
    is_enumerable: bool,
    is_seen_unfilled: bool,
    start: u32,
    /// Where what its getter returns is written. One call defines its names in that order.
    returned_start: u32,
}

/// A member access on the exports of the module in its own text, or a call that is one store.
#[derive(Copy, Clone, Debug)]
struct OwnAccess {
    node: ExprId,
    name: Atom,
    is_store_only: bool,
    says_marker: bool,
    /// A store of `undefined` in the first run of the body, under a name that nothing has been stored under yet.
    stores_nothing: bool,
}

fn range_of<T>(sorted: &[T], name: Atom, name_of: impl Fn(&T) -> Atom) -> &[T] {
    let start = sorted.partition_point(|it| name_of(it).0 < name.0);
    let count = sorted[start..].partition_point(|it| name_of(it) == name);
    &sorted[start..start + count]
}

/// What the text of a CommonJS module says of its exports.
struct ModuleText {
    /// The file that the module is written in.
    file: FileId,
    /// The callback of `__commonJS(cb)` that is the body of the module. `None`: the file is.
    inner: Option<FnId>,
    /// Somebody may look at the module while its body runs.
    is_half: bool,
    /// No use of the object in the text of the module: a variable for each name. Otherwise one variable holds `module.exports`.
    has_names: bool,
    /// By node.
    own_accesses: Vec<OwnAccess>,
    /// By name, and under a name in the order of the text.
    creations: Vec<Creation>,
    /// By name.
    aliases: Vec<Alias>,
    /// The calls of `Object.defineProperty` that are one store, with the name.
    defined_values: Vec<(ExprId, Atom)>,
    /// The calls and stores that only say that the module has an `__esModule`.
    marker_nodes: Vec<ExprId>,
    /// Ascending.
    erased: Vec<StmtId>,
    names_read: Vec<Atom>,
    names_called: Vec<Atom>,
    /// What `__esModule` reads. `false`: the text never gives the module one. `true`: once, in order, a true constant. `None`: only the run knows.
    marker: Option<bool>,
    /// The package of the file says `"type": "module"`: to an ES importer the `default` of the file is its value, whatever `__esModule` reads.
    is_marker_ignored_by_imports: bool,
    needs_wrapped_body: bool,
    uses_module_object: bool,
    /// Something may store to `module.exports` once the body has ended.
    is_replaced_late: bool,
    /// Whatever `require` of the module answers is the object that the module was born with or one that the text makes: a function, a class, a literal. No trap runs on it.
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

    /// Whoever finds the body run to its end finds the name.
    fn always_creates(&self, name: Atom) -> bool {
        self.creations_of(name).iter().any(Creation::is_in_order) || self.alias_of(name).is_some()
    }

    /// Whoever lists the names of the object once the body has run to its end finds the name: a getter that is not enumerable is passed over.
    fn always_lists(&self, name: Atom) -> bool {
        match self.alias_of(name) {
            Some(alias) => alias.is_enumerable,
            None => self.always_creates(name),
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
    builtin_names: &'a BuiltinNames,
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
        files: &'a Files<'s>,
        wrapped: &'a WrappedModules,
        builtin_names: &'a BuiltinNames,
        file: FileId,
    ) -> Option<Text<'a, 's>> {
        let analysis = files.analysis(file);
        Some(Text {
            file,
            atoms: &files.atoms,
            hir: files.hir(file),
            bound: files.bound(file),
            analysis,
            decisions: &analysis.decisions,
            builtins: &parsed_source(files, file)?.builtins,
            builtin_names,
            places: FileText::new(files, wrapped, file),
            this_positions: OnceCell::new(),
            names_super: OnceCell::new(),
        })
    }

    /// The parent of an expression, past the type assertions around it.
    fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let outermost = find_outermost_type_assertion(self.hir, self.bound, expression);
        (outermost, self.bound.parent_of_expr(outermost))
    }

    /// The statement that the expression is, and nothing else.
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

    // An object finds the other names without having them, or keeps what is stored under them elsewhere.
    fn is_plain_name(&self, name: Atom) -> bool {
        let is_index = self.atoms.bytes(name).first().is_some_and(u8::is_ascii_digit);
        let is_inherited = self
            .builtin_names
            .get(name)
            .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
        !is_index && !is_inherited && name != known::__proto__
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

    /// `target = value`: the assignment and the value.
    fn find_assignment(&self, target: ExprId) -> Option<(ExprId, ExprId)> {
        let (target, Parent::Expr(user)) = self.parent(target) else {
            return None;
        };
        match self.hir[user].kind {
            // In a pattern `target = value` is a default, and what is stored comes from elsewhere.
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

    // `target op= value`
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

    /// The access to a member of `object` that `object` is written in.
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
                // A part of a pattern, or the head of a loop.
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

    fn classify_function(&self, function: FnId) -> StoredValue {
        let hir = self.hir;
        let kind = hir[function].kind;
        let flags = self.bound.function_flags(function);
        let reads_this = || {
            let positions = self.this_positions.get_or_init(|| ThisPositions::of(hir));
            positions.evaluates_own_this(hir, function)
        };
        // `super` looks above the object that the method is written in, however the method is called.
        let may_name_super = || {
            let is_super = |it: &hir::Expr| matches!(it.kind, ExprKind::Super);
            !matches!(kind, FnKind::Decl | FnKind::Expr)
                && *self.names_super.get_or_init(|| hir.exprs.iter().any(is_super))
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
        // `var a = b; var b = a`: each stands for the other.
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
            BindingInitializer::Expression(value) => {
                self.classify_value(value, names_followed + 1)
            }
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

    // Whether `user` evaluates its operand whenever it is evaluated itself, and goes on at once.
    fn always_evaluates(&self, user: ExprId, operand: ExprId) -> bool {
        match self.hir[user].kind {
            ExprKind::Yield { .. } | ExprKind::Await(_) | ExprKind::Jsx(_) => false,
            _ => self.places.always_evaluates(user, operand),
        }
    }

    // How a run of the body comes to the expression, but for a `return` in front of it, and whether a function around it has a `this` of its own.
    // The body is that of the file, or `callback`. `None`: the text says neither.
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

    /// `InOrder`: every run of the body passes the expression. `Sometimes`: nothing but a run of the body gets to it. `Late`: a function may get to it once the body has ended.
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

/// The code that runs when a module is evaluated.
#[derive(Copy, Clone)]
struct BodyOfModule {
    /// `None`: the file.
    callback: Option<FnId>,
    /// `Text::find_first_return`
    first_return: u32,
}

// The same test as the lowering's, which then makes a function of five parameters of the text: no name of such a file is a variable.
fn needs_wrapped_body(text: &Text<'_, '_>) -> bool {
    let (bound, decisions) = (text.bound, text.decisions);
    let mut evals = bound.runtime.eval_scopes().iter();
    let mut scopes = bound.scopes.iter();
    let mut stores = bound.runtime.unbound_name_stores().iter();
    bound.file_uses_arguments()
        || !bound.runtime.redeclared_commonjs_variables().is_empty()
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

// `const k = value`
fn find_name_declared_with(text: &Text<'_, '_>, value: ExprId) -> Option<Decl> {
    let hir = text.hir;
    match text.parent(value).1 {
        Parent::VarInit(declaration)
            if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_)) =>
        {
            Some(Decl::Var(hir[declaration].pat))
        }
        _ => None,
    }
}

// `f(argument)`
fn find_call_with_argument(text: &Text<'_, '_>, argument: ExprId) -> Option<ExprId> {
    let hir = text.hir;
    let (argument, Parent::Expr(user)) = text.parent(argument) else {
        return None;
    };
    let ExprKind::Call(call) = hir[user.some()?].kind else {
        return None;
    };
    let mut arguments = hir.ids(hir[call].args);
    arguments
        .any(|written: ExprId| written == argument)
        .then_some(user)
}

// `const k = require(K)`, `const k = f(require(K))`, `import k = require(K)`, `import k from K` and `import * as k from K`: the name, and the module whose exports it may hold. By name.
// A name that may hold something else too only makes one more marker unknown.
fn find_names_that_hold_exports(
    text: &Text<'_, '_>,
    sites: &[ScannedSite],
) -> Vec<(SymbolId, ModuleRef)> {
    let (hir, bound, decisions) = (text.hir, text.bound, text.decisions);
    let mut holders = Vec::new();
    for (site, answer) in text.analysis.import_sites.iter().zip(sites) {
        let &ScannedSite::Module(module) = answer else {
            continue;
        };
        let declarations = match site.kind {
            ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                if decisions.is_dead_expr(call) {
                    continue;
                }
                // `__importDefault` and `__importStar` answer a marked module as it is.
                let handed_on =
                    || find_name_declared_with(text, find_call_with_argument(text, call)?);
                [find_name_declared_with(text, call).or_else(handed_on), None]
            }
            ImportSiteKind::ImportEquals(declaration)
                if !decisions.is_dead_stmt(hir[declaration].stmt) =>
            {
                [Some(Decl::ImportEquals(declaration)), None]
            }
            ImportSiteKind::Import(import) => {
                let (default, namespace) = (hir[import].default, hir[import].namespace);
                [
                    default.is_some().then_some(Decl::ImportDefault(import)),
                    namespace.is_some().then_some(Decl::ImportNamespace(import)),
                ]
            }
            _ => continue,
        };
        for declaration in declarations.into_iter().flatten() {
            let holder = bound.declared_symbol(declaration);
            if holder.is_some() {
                holders.push((holder, module));
            }
        }
    }
    for (call, module) in text.places.calls_of_inner_commonjs_modules() {
        let handed_on = || find_name_declared_with(text, find_call_with_argument(text, call)?);
        let declaration = find_name_declared_with(text, call).or_else(handed_on);
        let holder = declaration.map(|declaration| bound.declared_symbol(declaration));
        holders.extend(holder.filter(|it| it.is_some()).map(|it| (it, module)));
    }
    holders.shared_sort_by_key(|holder| holder.0);
    holders
}

// The object that the expression stores `__esModule` on, deletes it from or defines it on.
fn find_object_whose_marker_changes(text: &Text<'_, '_>, expression: ExprId) -> Option<ExprId> {
    let (hir, bound) = (text.hir, text.bound);
    let is_marker = |key: ExprId| text.constant(key) == Some(Constant::String(known::__esModule));
    match hir[expression].kind {
        ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            let (object, key) = hir.member_key(expression)?;
            let names_marker = match key {
                MemberKey::Name(name) => name == known::__esModule,
                MemberKey::Computed(computed) => is_marker(computed),
                MemberKey::PrivateName(_) => false,
            };
            let changes = names_marker
                && (bound.get_assignment_target(hir, text.parent(expression).0).is_some()
                    || text.is_deleted(expression));
            changes.then_some(object)
        }
        ExprKind::Call(definition) => {
            let definition = hir[definition];
            let defines = definition.args.len() >= 2
                && is_marker(hir.id_at(definition.args, 1))
                && text.defines_property(definition.callee);
            defines.then(|| hir.id_at(definition.args, 0))
        }
        _ => None,
    }
}

// The modules whose exports the file gets hold of. A site whose specifier is computed answers with one of the candidates.
fn find_loaded_modules<'a>(
    text: &'a Text<'_, '_>,
    scan: &'a FileScan,
) -> impl Iterator<Item = ModuleRef> + 'a {
    let answers = text.analysis.import_sites.iter().zip(&scan.sites);
    let spelled = answers.filter_map(|(site, answer)| match (site.kind, answer) {
        (
            ImportSiteKind::Import(_)
            | ImportSiteKind::ImportEquals(_)
            | ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_),
            &ScannedSite::Module(module),
        ) => Some(module),
        _ => None,
    });
    let inner_modules = text.places.inner_commonjs_modules().map(|inner| inner.0);
    spelled
        .chain(scan.candidates.iter().copied())
        .chain(inner_modules)
}

// `require(K).__esModule = v`, `delete require(K).__esModule` and `Object.defineProperty(require(K), "__esModule", d)`, also through a name that holds what `K` exports: only the run knows what the name reads on `K` from then on.
// A name of which the text does not say what it holds may hold the exports of any module that the file loads. `require(c ? K : L)` answers with one of the candidates.
fn find_markers_stored_on_other_modules(text: &Text<'_, '_>, scan: &FileScan) -> Vec<ModuleRef> {
    let (hir, bound, analysis) = (text.hir, text.bound, text.analysis);
    let mut stored = Vec::new();
    let answers_module = |site: &ScannedSite| matches!(site, ScannedSite::Module(_));
    let has_inner_modules = text.places.inner_commonjs_modules().next().is_some();
    if !scan.sites.iter().any(answers_module) && scan.candidates.is_empty() && !has_inner_modules {
        return stored;
    }
    // What a callback does to its own `exports` its own text says.
    let own_exports = text.places.inner_commonjs_modules();
    let mut own_exports: Vec<SymbolId> = own_exports.filter_map(|inner| inner.1).collect();
    own_exports.shared_sort_unstable();
    let holders = find_names_that_hold_exports(text, &scan.sites);
    let mut may_be_any_loaded_module = false;
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        let Some(object) = find_object_whose_marker_changes(text, expression) else {
            continue;
        };
        if text.decisions.is_dead_expr(expression) {
            continue;
        }
        let object = hir.skip_type_assertions(object);
        match hir[object].kind {
            ExprKind::Ident(_) => {
                let Binding::Symbol(name) = bound.binding(object) else {
                    continue;
                };
                if own_exports.binary_search(&name).is_ok() {
                    continue;
                }
                let first = holders.partition_point(|holder| holder.0 < name);
                let held = holders[first..].iter().take_while(|holder| holder.0 == name);
                let count = stored.len();
                stored.extend(held.map(|holder| holder.1));
                // `let k; k = require(K)`, `const k = c ? require(K) : require(L)`, a parameter. A name that holds a literal, a function or a class holds no module.
                let holds_those_alone = stored.len() != count && bound.is_stable_binding(name);
                may_be_any_loaded_module |=
                    !holds_those_alone && text.classify_name(object, 0) == StoredValue::Unknown;
            }
            ExprKind::Call(_) => {
                stored.extend(text.places.find_inner_commonjs_module_of_call(object));
                let Some(site) = analysis.import_site_of_call(object) else {
                    continue;
                };
                let requires = matches!(
                    analysis.import_sites[site].kind,
                    ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_)
                );
                match scan.sites[site] {
                    _ if !requires => {}
                    ScannedSite::Module(module) => stored.push(module),
                    ScannedSite::Candidates(_) => stored.extend_from_slice(&scan.candidates),
                    ScannedSite::AllModules | ScannedSite::Unresolved | ScannedSite::Erased => {}
                }
            }
            _ => {}
        }
    }
    if may_be_any_loaded_module {
        stored.extend(find_loaded_modules(text, scan));
    }
    stored
}

#[derive(Copy, Clone)]
struct Mention {
    node: ExprId,
    /// Written `module.exports`: what the module has there at that time. Otherwise the object that the module was born with.
    is_module_exports: bool,
}

/// `const keys = { .. }; module.exports = keys;`: the literal, and the statement that declares the name. The name stands nowhere else and the store is the next statement of the file:
/// nothing runs between the two, so whoever evaluates the literal at the store does what the text does.
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

// `module.exports = e`
#[derive(Copy, Clone)]
struct Replacement {
    node: ExprId,
    position: SitePosition,
    /// `{ a, b: e, c() {} }`, where a statement does nothing but store that.
    literal: Option<ExprId>,
    /// `const keys = { .. };` in front of `module.exports = keys;`: the statement, which goes where the literal gives the module its names.
    declared_at: Option<StmtId>,
    /// A function, a class, a literal or what a helper makes new: an object on which no trap runs.
    stores_ordinary_object: bool,
}

struct Scan<'t, 'a, 's> {
    text: &'t Text<'a, 's>,
    sites: &'t [ScannedSite],
    summary: &'t ExportsSummary,
    /// The helper of a compiler that a callee is whenever the call runs.
    certain_helper: &'t dyn Fn(ExprId) -> Option<HelperShape>,
    body: BodyOfModule,
    found: ModuleText,
    accesses: Vec<Access>,
    mentions: Vec<Mention>,
    replacements: Vec<Replacement>,
    /// The nodes of the creations of `__esModule` that store nothing: a helper defines the flag as `true`.
    marking_calls: Vec<ExprId>,
    /// Where the first statement of the body starts that runs code other than that of the body itself.
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

    // Only a plain call of the name `require` answers with the module for sure, and only in a file that cannot put something else under the name. So does `require_x()` of a bundle.
    fn module_of_call(&self, call: ExprId) -> Option<ModuleRef> {
        let text = self.text;
        let ExprKind::Call(id) = text.hir[call].kind else {
            return None;
        };
        // An ES importer of a file takes copies through faces, which only files have: no name of a file stands for a name of an inner module.
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

    // A name that holds `require(K)` and nothing else: the module, and the call that evaluates it.
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
            start: self.text.hir[node].pos,
            end: self.text.hir[node].end,
        }
    }

    fn add_access(&mut self, access: Access) {
        self.accesses.push(access);
        let Access { node, name, kind } = access;
        let creation = match kind {
            AccessKind::Store(value) => {
                // The value is evaluated before the store.
                let assignment = self.text.find_assignment(node);
                let (node, value_node) = assignment.unwrap_or((node, ExprId::NONE));
                self.create(name, node, value_node, value)
            }
            // Nothing that can be called.
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

    // A binding that the body of the file declares at its top. It has a variable, which every file can read.
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

    // What a getter stands for that does nothing but return `returned`.
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
        // A call that is written in the getter runs when the getter does.
        let object = hir.skip_type_assertions(object);
        if chain != Chain::No || !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let (module, site) = self.find_required_module(object)?;
        // The name holds the module from its `require` on, and a read in front of that throws.
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

    // `Object.defineProperty(exports, "name", { .. })` as a statement that every run of the body passes.
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

    // What the summary has read off the helper that the statement calls. The statement has no code where all that the helper does is define getters that stand for something, and the flag.
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
                ..creation
            });
            self.marking_calls.push(definition);
        }
        self.found.erased.push(written_at);
        Some(())
    }

    // A call of a helper with the object among its arguments, as a statement that every run of the body passes.
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

    // The statement that hands a helper the literal in which the getter is written.
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

    // `__export(all, { n: () => n }); module.exports = __toCommonJS(all);`: the summary lists each name at the statement that stores, with the function of the literal, and has seen that nobody but the helpers gets `all`.
    fn add_copy(&mut self, replacement: Replacement) -> bool {
        let Some(written_at) = self.text.statement_of(replacement.node) else {
            return false;
        };
        // Nobody else sees the module until its body has ended, and the body itself reads none of its names.
        let is_read_behind_body = !self.found.is_half && self.accesses.is_empty();
        let added = self.add_names_of_helper(written_at, replacement.node, is_read_behind_body);
        if added.is_none() {
            return false;
        }
        let getters = self.summary.names.iter().filter_map(|stored| match *stored {
            StoredName::Getter {
                statement, getter, ..
            } if statement == written_at => Some(getter),
            _ => None,
        });
        // Nobody sees `all` but through the copy.
        let filled_at = getters.filter_map(|getter| self.find_statement_around_literal(getter));
        let filled_at: Vec<StmtId> = filled_at.collect();
        self.found.erased.extend(filled_at);
        true
    }

    // Whether the expression around a mention only asks what every object answers alike. The lowering puts `true` in the place of such a mention.
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
            // The fold has the answer, and nothing evaluates the operand.
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
        let named =
            named.and_then(|it| find_literal_exported_under_name(hir, self.text.bound, it));
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

    // Whether the value is a function, a class, a literal or the new object of `__toCommonJS(..)`, or a name that holds one and nothing else.
    fn makes_ordinary_object(&self, value: ExprId, names_followed: u32) -> bool {
        // `var a = b; var b = a`: each stands for the other.
        const MAX_NAMES_FOLLOWED: u32 = 8;
        let (hir, bound) = (self.text.hir, self.text.bound);
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Object(_) | ExprKind::Array(_) => true,
            // `module.exports = exports = e`
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
        if text.bound.get_assignment_target(text.hir, outermost).is_some() {
            // Nobody knows what the name `exports` holds from a store on.
            if !is_module_exports {
                self.found.has_names = false;
                return;
            }
            return match text.find_assignment(object) {
                Some((assignment, value)) => {
                    let is_statement = text.statement_of(assignment).is_some();
                    self.add_replacement(assignment, Some(value), is_statement);
                }
                // A compound assignment, or a part of a pattern.
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

    // `module` of the file. A member that the table of built-ins knows hands out neither the object nor what it exports.
    fn look_at_module_name(&mut self, name: ExprId) {
        let text = self.text;
        if let (outermost, Parent::Expr(user)) = text.parent(name)
            && text.hir.member_key(user).is_some_and(|it| it.0 == outermost)
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

    // `module.exports = { a, b: e, c() {} }`: the literal takes the place of the object that the module was born with, which nobody has seen.
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
                start: property.start,
                end: property.end,
            });
        }
        self.found.creations.extend(creations);
        true
    }

    // What one store to `module.exports` makes of the module. `false`: one variable holds the value, and that is all.
    fn apply_replacement(&mut self) -> bool {
        let text = self.text;
        let [replacement] = self.replacements[..] else {
            return false;
        };
        let end = text.hir[replacement.node].end;
        // In front of the store every mention is one of the first object, also in a function that is written there. So is what a function stores that is called in front of it.
        let names_new_value =
            |mention: &Mention| mention.is_module_exports && text.hir[mention.node].pos >= end;
        let mut creations = self.found.creations.iter();
        // Whoever has required the module in a cycle holds the first object.
        let is_seen_alone = replacement.position == SitePosition::InOrder
            && self.mentions.iter().all(names_new_value)
            && creations.all(|it| it.position != SitePosition::Late)
            && !self.found.is_half;
        is_seen_alone
            && match replacement.literal {
                Some(literal) => {
                    let is_added = self.add_literal(literal);
                    if is_added {
                        self.found.erased.extend(replacement.declared_at);
                    }
                    is_added
                }
                None => self.add_copy(replacement),
            }
    }

    // `E.n || (E.n = v)` and `E.n ?? (E.n = v)`: whichever way the choice goes, the name is there behind it.
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

    // Where the first statement of the body starts that is not quiet: an accessor, a conversion or an iterator runs code as a call does.
    fn find_first_loud_statement(
        &self,
        is_quiet_too: &dyn Fn(&Quiet<'_, '_>, StmtId) -> bool,
    ) -> u32 {
        let (text, found) = (self.text, &self.found);
        let call_of = |node: ExprId| match text.hir[node].kind {
            ExprKind::Call(call) => Some(call),
            _ => None,
        };
        // A definition on the object that the module was born with runs the built-in, or the helper that calls it, and no more.
        let aliases = found.aliases.iter().map(|alias| alias.node);
        let values = found.defined_values.iter().map(|it| it.0);
        let definitions = aliases.chain(values).chain(self.marking_calls.iter().copied());
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
            // `Quiet` takes the `exports` of the file to be untouched.
            Some(FnBody::Block(statements)) if !self.summary.names_exports_of_file => statements,
            Some(FnBody::Block(_) | FnBody::Expr(_) | FnBody::None) => return 0,
        };
        let mut statements = text.hir.ids(statements);
        let loud = statements.find(|&statement: &StmtId| {
            !quiet.is_quiet_statement(statement) && !is_quiet_too(&quiet, statement)
        });
        loud.map_or(u32::MAX, |statement| text.hir[statement].start)
    }

    // Whether no code but that of the body itself runs until the body gets to the position.
    fn runs_nothing_else_in_front_of(&self, position: u32) -> bool {
        let find = || self.find_first_loud_statement(&|_, _| false);
        position <= *self.quiet_head.get_or_init(find)
    }

    // A store of its own to the object that the module was born with gives the object a property and runs nothing.
    fn find_first_loud_statement_but_own_stores(&self) -> u32 {
        let hir = self.text.hir;
        let stores = self.found.creations.iter().filter(|it| it.is_in_order());
        let stored_values: FxHashMap<ExprId, ExprId> =
            stores.map(|it| (it.node, it.value_node)).collect();
        self.find_first_loud_statement(&|quiet, statement| {
            let StmtKind::Expr(mut value) = hir[statement].kind else {
                return false;
            };
            // `exports.a = exports.b = v`
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

    // Nobody finds a module half evaluated whose body does no more than store under its own names.
    fn runs_nothing_else(&self) -> bool {
        self.replacements.is_empty() && self.find_first_loud_statement_but_own_stores() == u32::MAX
    }

    // `exports.n = void 0` in front of everything else, as TypeScript writes it under every name that the file exports.
    // The variable of the name is born undefined, and no code has run by then that could have stored into it: the store leaves it as it is.
    // So the store that follows is the only one, and whether a read comes behind it is asked of that one.
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
            first.zip(assignment).is_some_and(|(first, (assignment, _))| {
                first.node == assignment && first.is_in_order() && first.end <= quiet_head
            })
        };
        let stores = candidates.filter(is_first_at_head);
        stores.map(|access| access.node).collect()
    }

    // Whether the binding holds its value by the time that any code but that of the body itself runs.
    fn is_filled_first(&self, symbol: SymbolId) -> bool {
        let hir = self.text.hir;
        let filled_at = match self.text.bound.binding_initializer(hir, symbol) {
            // The body starts with its function declarations made.
            BindingInitializer::Function(_) => return true,
            BindingInitializer::Expression(value) => hir[value].end,
            BindingInitializer::PatternProperty { source, .. } => hir[source].end,
            _ => return false,
        };
        self.runs_nothing_else_in_front_of(filled_at)
    }

    // A definition takes no store, and a getter none but `undefined` in front of it: TypeScript stores `void 0` under every name first.
    fn check_definitions(&mut self) {
        let (text, body, found) = (self.text, self.body, &self.found);
        // The property is there from its definition on. A function may run in front of that.
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
        // A name that stands for another is there from the start, the property only from its definition on.
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
        // Nobody sees what is stored under a name that a getter is defined for behind the store.
        let ModuleText {
            creations, aliases, ..
        } = &mut self.found;
        creations.retain(|creation| range_of(&aliases[..], creation.name, |it| it.name).is_empty());
        for (alias, is_seen_unfilled) in aliases.iter_mut().zip(seen_unfilled) {
            alias.is_seen_unfilled = is_seen_unfilled;
        }
    }

    // `exports.__esModule = true`, `Object.defineProperty(exports, "__esModule", { value: true })` and a helper that defines the flag: once, in order, the constant `true`. What the summary does not say too, only the run knows.
    fn find_marker(&mut self) {
        let (text, body, found) = (self.text, self.body, &self.found);
        let creations = found.creations_of(known::__esModule).to_vec();
        let is_true = |value: ExprId| {
            value.some().and_then(|value| text.constant(value)) == Some(Constant::Boolean(true))
        };
        let is_marked_by_call = |creation: &Creation| self.marking_calls.contains(&creation.node);
        // The flag is there from that statement on. A function may run in front of it.
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
                // Whoever finds the module half evaluated in front of that statement finds no marker.
                && (!found.is_half || self.runs_nothing_else_in_front_of(creation.start)))
            .then_some(true),
            _ => None,
        };
        let marker = written.filter(|_| written == self.summary.marker);
        // Such a call stores nothing under a name, so the flag that it defines is a constant or a property of the object. So is a flag that the summary alone has seen defined.
        let is_defined_without_store = creations.iter().any(is_marked_by_call)
            || (written == Some(false) && self.summary.marker != Some(false));
        if is_defined_without_store && marker != Some(true) {
            self.found.has_names = false;
            return;
        }
        let found = &mut self.found;
        found.marker = marker;
        if let (Some(true), [creation]) = (marker, &creations[..]) {
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
        // A store that the summary has seen and this scan has not goes to an object.
        let found = &self.found;
        let knows = |name: Atom| !found.creations_of(name).is_empty() || found.alias_of(name).is_some();
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
        // While every creation and every definition is still listed.
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
        if !found.has_names {
            found.creations = Vec::new();
            found.aliases = Vec::new();
            found.erased = Vec::new();
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
            names_read: Vec::new(),
            names_called: Vec::new(),
            marker: None,
            is_marker_ignored_by_imports: false,
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

/// What the text of each callback says of the exports of its module, in the order of `inner_modules`. One loop over the names of the file serves all of them.
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
        // It occurs only as `module.exports`.
        match text.parent(name) {
            (_, Parent::Expr(member)) if member.is_some() => {
                scans[index].look_at_object(member, true);
            }
            _ => scans[index].found.has_names = false,
        }
    }
    scans.into_iter().map(Scan::finish).collect()
}

/// What the text of a CommonJS file says of its exports. The summary says where the object goes; the nodes that the lowering asks about are found here, and a mention that is none of the forms below leaves the module its object.
fn scan_own_text(
    text: &Text<'_, '_>,
    sites: &[ScannedSite],
    summary: &ExportsSummary,
    certain_helper: &dyn Fn(ExprId) -> Option<HelperShape>,
    is_half: bool,
    is_entry_point: bool,
) -> ModuleText {
    let (hir, bound, decisions) = (text.hir, text.bound, text.decisions);
    let needs_wrapped_body = needs_wrapped_body(text);
    let mut scan = begin_scan(text, sites, summary, certain_helper, None, is_half);
    // The host may ask what an entry point exports.
    scan.found.has_names &= !needs_wrapped_body && !is_entry_point;
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
    // With ES module syntax in the file its `this` is `undefined`.
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
    // Such a read takes the object, and the names behind it from the object.
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
        for statement in hir.ids(hir.body) {
            // `export = e` of TypeScript is the statement `module.exports = e`.
            let statement: StmtId = statement;
            if let StmtKind::ExportAssign(value) = hir[statement].kind {
                scan.add_replacement(value, Some(value), true);
            }
        }
    }
    scan.finish()
}

/// The places of the modules in a list of their texts.
#[derive(Default)]
struct ModuleIndex {
    /// By file: the place, or `u32::MAX`.
    files: Vec<u32>,
    /// Ascending.
    inner_modules: Vec<((FileId, FnId), u32)>,
}

impl ModuleIndex {
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

/// What the text of each CommonJS module of the program says of its exports.
pub(super) struct CommonJsTexts {
    /// In the order of the files, and behind each file the inner modules that are written in it.
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
    let compiled_files = modules.compiled_files.iter();
    let mut scanned: Vec<(FileId, Vec<ModuleText>, Vec<ModuleRef>)> = compiled_files
        .map(|&file| (file, Vec::new(), Vec::new()))
        .collect();
    for_each_mut(&mut scanned, bind.in_parallel, &|(
        file,
        found,
        stored_markers,
    )| {
        let file = *file;
        let Some(text) = Text::new(files, &modules.wrapped, bind.builtin_names, file) else {
            return;
        };
        let scan = scans.of(file);
        *stored_markers = find_markers_stored_on_other_modules(&text, scan);
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
        );
        found.push(ModuleText {
            is_marker_ignored_by_imports: interop.export_rule
                == SyntheticExportRule::CommonJsIgnoringAnnotation,
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
    let mut is_listed = FxHashSet::default();
    for (file, found, stored_markers) in scanned {
        for module in stored_markers {
            // What a test file does to a module that the loader links for it, it does to the compiled file.
            for module in [module, modules.module_behind(module)] {
                if is_listed.insert(module) {
                    texts.stored_markers.push(module);
                }
            }
        }
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
    for &module in &texts.stored_markers {
        if let Some(number) = texts.index.find(module) {
            texts.modules[number].marker = None;
        }
    }
    texts
}

impl CommonJsTexts {
    /// What `__esModule` reads on the module, as far as the text of the program says it.
    pub(super) fn marker(&self, module: ModuleRef) -> Option<bool> {
        self.modules[self.index.find(module)?].marker
    }

    /// The modules, of whichever kind, on which another file stores `__esModule`: only the run knows what it reads there.
    pub(super) fn markers_stored_from_outside(&self) -> Vec<ModuleRef> {
        self.stored_markers.clone()
    }

    pub(super) fn entries(&self) -> Vec<ModuleEntries> {
        self.modules.iter().map(create_entries).collect()
    }

    /// The names that the text of a module itself reads, calls or updates.
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
        // Those of one name stand side by side, the first of the text in front.
        match names.last_mut().filter(|it| it.1.name == creation.name) {
            Some((_, entry)) => entry.created_at = entry.created_at.min(created_at),
            None => names.push((
                (creation.start, creation.start),
                NameEntry {
                    name: creation.name,
                    target: None,
                    created_at,
                    is_enumerable: creation.is_enumerable,
                    is_seen_unfilled: false,
                },
            )),
        }
    }
    names.extend(text.aliases.iter().map(|alias| {
        let entry = NameEntry {
            name: alias.name,
            target: Some(alias.target),
            created_at: alias.start,
            is_enumerable: alias.is_enumerable,
            is_seen_unfilled: alias.is_seen_unfilled,
        };
        ((alias.start, alias.returned_start), entry)
    }));
    names.shared_sort_by_key(|it| it.0);
    ModuleEntries {
        module: text.module(),
        has_names: text.has_names,
        knows_all_names: text.knows_all_names(),
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

/// What a name comes to that has no variable in its own module.
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
    /// The nodes of `ModuleText::own_accesses` of the inner modules, each with the place of its module. Ascending.
    accesses_of_inner_modules: Vec<((FileId, ExprId), u32)>,
    /// The same of `ModuleText::erased`.
    statements_of_inner_modules: Vec<((FileId, StmtId), u32)>,
    /// By module: somebody looks at its object, or a name of it leads to something that has no variable.
    has_object: Vec<bool>,
    /// By module: those with a name that stands for a name of it.
    dependents: Vec<Vec<ModuleRef>>,
    /// By module: those that a name of it stands for a name of.
    name_sources: Vec<Vec<ModuleRef>>,
    ids: FxHashMap<(ModuleRef, Atom), SyntheticExportId>,
    /// By number: the module that has the variable, and the name. Of CommonJS modules of the program alone.
    names_by_id: Vec<Option<(ModuleRef, Atom)>>,
    targets: FxHashMap<(ModuleRef, Atom), Target>,
    /// Of those, the names that an ES importer has a copy of: it holds what the getter answered when the file was linked.
    copied_names: FxHashSet<(ModuleRef, Atom)>,
    /// The names that other files store, and whether all that they store ignores `this`.
    stored_by_other_files: FxHashMap<(ModuleRef, Atom), bool>,
    /// Ascending.
    exported_bindings: Vec<Sym>,
    faces: Faces,
}

impl CommonJsExports {
    /// Called once the files are bound and the names have their numbers.
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

    // `false`: a name of the module stands for something that has no variable, so the module keeps its object.
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
            // The export tables have found nothing behind the getter.
            if target == Target::Name(module, alias.name) {
                is_bound = false;
                continue;
            }
            self.targets.insert((module, alias.name), target);
            // ES modules may hand the name on between the module that the getter names and the one that has it.
            if let Target::Name(owner, _) = target {
                self.add_name_source(number, module, owner);
            }
            if tables.commonjs.is_copied(module, alias.name) {
                self.copied_names.insert((module, alias.name));
            }
            if let Target::Binding(symbol) = target {
                self.exported_bindings.push(symbol);
            }
        }
        is_bound
    }

    // `R.N = v` in another file. The name is no longer stored by its own body alone, and what is stored may look at `this`.
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
                // A getter takes no store.
                if accessed.module != module {
                    looked_at.push(accessed.module);
                }
                // Nor does a definition that is not writable: the object refuses the store, or throws.
                if own_text.creations_of(name).iter().any(|it| it.is_read_only) {
                    looked_at.push(module);
                }
                let text =
                    text.get_or_insert_with(|| {
                        Text::new(files, &input.modules.wrapped, input.bind.builtin_names, file)
                    });
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

    // Whether the getter of the name, or one that it leads to, reads off a module that is no CommonJS module of the program.
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

    // An ES module that hands on a name of a CommonJS module holds what the name was at the link. A getter that reads it there stands for no variable unless the two cannot be told apart.
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

    // `exports.f()` hands the object over as `this`.
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

    // An ES module gets the object itself as `default`, unless the module has the marker and a `default` of its own.
    fn look_at_modules_whose_object_importers_see(
        &mut self,
        input: &CommonJsInput<'_, '_, '_>,
        tables: &ExportTables,
        imports: &[FileImports],
    ) {
        // The link may come while the body runs, and only the object says what the module has then.
        let is_half_when = |module: ModuleRef, linked: ModuleRef| {
            self.text_of(module).is_some_and(|text| text.is_half) && (input.half_at_link)(linked)
        };
        let is_half = |module: ModuleRef| is_half_when(module, module);
        let mut modules = Vec::new();
        // Those of which somebody is bound to the name `default`: an import that is `module.exports` for sure is bound to the exports as a whole.
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
            // `ns.default` is the object itself unless the module has a `default` of its own.
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
        // Only the object lists the names of a module whose text does not say all of them.
        let says_all_names =
            |module: ModuleRef| self.text_of(module).is_some_and(ModuleText::knows_all_names);
        modules.extend(seen.filter(|&module| !says_all_names(module)));
        // Whether the module has a name by the time the copy is taken: a variable cannot say that it is absent, the object can.
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

    fn number_of(&self, module: ModuleRef) -> Option<usize> {
        self.index.find(module)
    }

    fn text_of(&self, module: ModuleRef) -> Option<&ModuleText> {
        Some(&self.modules[self.number_of(module)?])
    }

    /// The object of the module is a value somewhere: the module is `Value`, and with it every module whose names stand for names of it.
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
            // With an object of its own the module defines its getters, which read the objects of the others.
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

    /// `ns.name()` hands the namespace object over as `this`. Called once it is known which modules have an object.
    pub(super) fn call_through_namespace(&mut self, module: ModuleRef, name: Atom) {
        // Whoever has the object may store anything under the name, and without a `default` of its own it is the value of the module that is called.
        let is_stored_by_name = self.has_names(module)
            && (name != known::default || self.has_default_of_its_own(module));
        if !is_stored_by_name || !self.ignores_this(module, name) {
            self.see_namespace(module);
        }
    }

    // The namespace object shows `module.exports` as `default`, and only the object says which names it has.
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

    /// `AsToday`: no CommonJS module of the program.
    pub fn shape(&self, module: ModuleRef) -> Shape {
        let number = self.number_of(module);
        match number.map(|number| self.keeps_names(number)) {
            None => Shape::AsToday,
            Some(true) => Shape::Names,
            Some(false) => Shape::Value,
        }
    }

    /// The names of the module are variables: it has no object.
    pub fn has_names(&self, module: ModuleRef) -> bool {
        self.number_of(module)
            .is_some_and(|number| self.keeps_names(number))
    }

    fn keeps_names(&self, number: usize) -> bool {
        self.modules[number].has_names && !self.has_object[number]
    }

    /// The modules that a name of the module stands for a name of.
    pub fn name_sources(&self, module: ModuleRef) -> &[ModuleRef] {
        self.number_of(module)
            .map_or(&[], |number| &self.name_sources[number][..])
    }

    /// The names that an import is bound past, to a name of another module or to a binding: each with the module that has the name.
    pub fn names_bound_elsewhere(&self) -> impl Iterator<Item = (ModuleRef, Member)> + '_ {
        let names = self.modules.iter().flat_map(|text| {
            let aliases = text.aliases.iter();
            aliases.map(|alias| (text.module(), alias.name))
        });
        names.filter_map(|(module, name)| {
            let member = match self.imported_target(module, name) {
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
            Some(&target) if !self.copied_names.contains(&(module, name)) => target,
            Some(_) | None => Target::Name(module, name),
        }
    }

    // The module that has the name which an import is bound to, and the name that it has there.
    fn owner_of(&self, module: ModuleRef, name: Atom) -> Option<(ModuleRef, Atom)> {
        self.text_of(module)?;
        match self.imported_target(module, name) {
            Target::Name(owner, owner_name) => Some((owner, owner_name)),
            Target::Binding(_) | Target::Nothing => None,
        }
    }

    /// What the module has under a name, for whoever required it.
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

    /// `access` is a `Dot` or an `Index` on the exports of the module that the file is, a call of `Object.defineProperty` that is one store, or what says that the module has an `__esModule`.
    pub fn own_member(&self, file: FileId, access: ExprId) -> Option<Member> {
        let (number, entry) = self.find_own_access(file, access)?;
        let text = &self.modules[number];
        if !self.keeps_names(number) {
            return Some(Member::OnObject);
        }
        if entry.says_marker {
            return Some(Member::Marker(true));
        }
        // Nobody sees what is stored under a name that a getter is defined for behind the store.
        if entry.is_store_only && text.alias_of(entry.name).is_some() {
            return Some(Member::Undefined);
        }
        let member = self.member_named(text.module(), entry.name);
        Some(member.unwrap_or(Member::Undefined))
    }

    // The place of the module among `modules`, and the entry of its `own_accesses`.
    fn find_own_access(&self, file: FileId, access: ExprId) -> Option<(usize, OwnAccess)> {
        let number = match find(&self.accesses_of_inner_modules, (file, access)) {
            Some(number) => number as usize,
            None => self.number_of(ModuleRef::File(file))?,
        };
        let accesses = &self.modules[number].own_accesses;
        let at = accesses.binary_search_by_key(&access, |it| it.node);
        Some((number, accesses[at.ok()?]))
    }

    /// The module whose body stores `undefined` there, at its head, under a name of its own that is a variable. In the first run of the body the variable holds that already.
    pub fn module_of_store_of_nothing(&self, file: FileId, access: ExprId) -> Option<ModuleRef> {
        let (number, entry) = self.find_own_access(file, access)?;
        let stores_nothing = entry.stores_nothing && self.keeps_names(number);
        stores_nothing.then(|| self.modules[number].module())
    }

    fn name_of_variable(&self, variable: SyntheticExportId) -> Option<(ModuleRef, Atom)> {
        self.names_by_id.get(variable.0 as usize).copied().flatten()
    }

    /// `R.N`, where the access is bound to a variable, and the source of a copy.
    pub fn required_member(&self, accessed: ModuleRef, variable: SyntheticExportId) -> Member {
        match self.name_of_variable(variable) {
            Some((owner, name)) if self.has_names(accessed) => {
                let member = self.member_behind_getter(owner, name);
                member.unwrap_or(Member::Variable(variable))
            }
            Some(_) | None => Member::OnObject,
        }
    }

    /// What the getter of the name returns. `None`: the name stands for nothing else.
    pub fn member_behind_getter(&self, module: ModuleRef, name: Atom) -> Option<Member> {
        match self.targets.contains_key(&(module, name)) {
            true => self.member_named(module, name),
            false => None,
        }
    }

    /// `ns.N` and `import { N }`: what the module had when it was linked.
    pub fn imported_member(&self, variable: SyntheticExportId) -> Member {
        match self.name_of_variable(variable) {
            Some((owner, name)) if self.is_import_bound_to_variable(owner, name) => {
                Member::Variable(variable)
            }
            _ => Member::Copy(variable),
        }
    }

    // Without the marker `default` is the value of the module.
    fn is_import_bound_to_variable(&self, owner: ModuleRef, name: Atom) -> bool {
        (name != known::default || self.marker_for_imports(owner) == Some(true))
            && self.settled(owner, name)
    }

    /// The statement has no code.
    pub fn erased(&self, file: FileId, statement: StmtId) -> bool {
        if let Some(number) = find(&self.statements_of_inner_modules, (file, statement)) {
            return self.keeps_names(number as usize);
        }
        self.number_of(ModuleRef::File(file)).is_some_and(|number| {
            self.keeps_names(number)
                && self.modules[number].erased.binary_search(&statement).is_ok()
        })
    }

    /// A binding of the top of a file that a name of a CommonJS module stands for. Imports of the name are bound to it whether or not the module has an object, so it is a variable.
    pub fn is_exported_binding(&self, file: FileId, symbol: SymbolId) -> bool {
        let binding = Sym { file, id: symbol };
        self.exported_bindings.binary_search(&binding).is_ok()
    }

    /// Every run of the body stores the name, nothing stores it once the body has ended, and nobody sees the module half evaluated: then what an importer took at the link and what the variable holds cannot be told apart.
    pub fn settled(&self, module: ModuleRef, name: Atom) -> bool {
        let Some(text) = self.text_of(module) else {
            return false;
        };
        let creations = text.creations_of(name);
        self.has_names(module)
            && !text.is_half
            && !self.targets.contains_key(&(module, name))
            && !self.stored_by_other_files.contains_key(&(module, name))
            && creations.iter().any(Creation::is_in_order)
            && creations.iter().all(|it| it.position != SitePosition::Late)
    }

    /// Every value that is stored under the name, by binding, ignores `this`.
    pub fn ignores_this(&self, module: ModuleRef, name: Atom) -> bool {
        let (mut module, mut name) = (module, name);
        // A cycle of names that stand for one another has no end to ask.
        for _ in 0..=self.modules.len() {
            let Some(text) = self.text_of(module) else {
                return false;
            };
            // The text says what is stored only where every store names what it stores under.
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
                // The build does not know what the getter returns.
                None if alias.is_some() => return false,
                None => {
                    let mut creations = text.creations_of(name).iter();
                    return creations.all(|it| it.value != StoredValue::Unknown);
                }
            }
        }
        false
    }

    /// What `__esModule` reads on the module. `None`: only the run knows.
    pub fn marker(&self, module: ModuleRef) -> Option<bool> {
        let key = (module, known::__esModule);
        let marker = self.text_of(module)?.marker;
        marker.filter(|_| !self.stored_by_other_files.contains_key(&key))
    }

    /// What `__esModule` says to an ES importer: with `true` the `default` of the module is its member of that name, if it has one.
    pub fn marker_for_imports(&self, module: ModuleRef) -> Option<bool> {
        match self.text_of(module)?.is_marker_ignored_by_imports {
            true => Some(false),
            false => self.marker(module),
        }
    }

    /// The text stores to one of the five names, names `arguments` at the top, or shows its scope to `eval` or `with`: the body only calls the function of five parameters that the text is.
    pub fn needs_wrapped_body(&self, module: ModuleRef) -> bool {
        self.text_of(module)
            .is_some_and(|text| text.needs_wrapped_body)
    }

    /// `module` goes somewhere as a value.
    pub fn uses_module_object(&self, module: ModuleRef) -> bool {
        self.text_of(module)
            .is_some_and(|text| text.uses_module_object)
    }
}
