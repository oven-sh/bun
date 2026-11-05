//! What the text of one CommonJS file says of its exports.

use super::{CommonJsInput, find_literal_exported_under_name};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::{ModuleObjectOwner, ModuleObjectUse};
use crate::known_helpers::Quiet;
use crate::load::sources::parsed_source;
use crate::modules::order::FileText;
use crate::modules::{InnerModule, ModuleRef};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    AssignmentTarget, Binding, Bound, CodeUnit, CommonJsVariable, FnOwner, Parent, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, BinOp, CallId, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, MemberKey, PropKey,
    PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use core::cmp::Reverse;
use std::cell::OnceCell;

/// `statement` holds the store, and every run of the body passes the store.
/// `StmtId::NONE`: a function, a branch or a loop stores, so that a run of the body may end without the name.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum StoredName {
    /// `exports.n = v`, `module.exports.n = v`, a key of `module.exports = { n: v }`. `value` is what stands behind the `=` or the key.
    /// `value` is `ExprId::NONE` where a call defines `__esModule`: as `true` if `statement` is set, otherwise only the run knows what the name reads.
    Value {
        name: Atom,
        statement: StmtId,
        value: ExprId,
    },
    /// `Object.defineProperty(exports, "n", { enumerable, get })`, `__export(exports, { n: () => v })`, `__createBinding`
    Getter {
        name: Atom,
        statement: StmtId,
        getter: ExprId,
        is_enumerable: bool,
    },
    /// `__exportStar(require(K), exports)`, `__reExport`, `Object.assign(exports, require(K))`
    AllOf { statement: StmtId, site: u32 },
}

impl StoredName {
    pub(super) fn name(&self) -> Option<Atom> {
        match *self {
            StoredName::Value { name, .. } | StoredName::Getter { name, .. } => Some(name),
            StoredName::AllOf { .. } => None,
        }
    }

    pub(super) fn statement(&self) -> StmtId {
        match *self {
            StoredName::Value { statement, .. }
            | StoredName::Getter { statement, .. }
            | StoredName::AllOf { statement, .. } => statement,
        }
    }
}

/// When `object_escapes` is set, `names` may be incomplete and the other fields carry no information.
#[derive(Debug)]
pub(super) struct ExportsSummary {
    /// One entry for each store, in the order in which the body makes them; stores that a run may skip come last.
    /// A name that is listed twice is created by its first entry and holds what the last store to run left there.
    /// `__esModule` is listed like any other name, whether a store or a call defines it.
    /// `exports.n = void 0` in front of the one getter of `n` is left out: nobody sees it.
    pub names: Vec<StoredName>,
    /// `__esModule`: Some(true) stored in the body ahead of every load, Some(false) never stored, None otherwise.
    pub marker: Option<bool>,
    /// `exports`, `module.exports` or `module` goes somewhere as a value, is enumerated, deleted from, updated in place or stored
    /// under a computed key, or `this` of the body is used for more than `this && this.n` in front of all that runs.
    pub object_escapes: bool,
    pub module_object_escapes: bool,
    /// `module.exports = v`, once, where every run of the body passes it, with `v` nothing that `names` spells out.
    pub replaced_by: Option<ExprId>,
    /// Once for each `E.n` that is read or called, where the object would be `this`. In the order of the nodes.
    pub names_read_by_own_text: Vec<Atom>,
    /// Of an inner module: its text names the `exports` of the file around it, on which getters may stand by the time that the callback runs.
    pub names_exports_of_file: bool,
}

impl ExportsSummary {
    fn with_room_for(mentions: usize) -> ExportsSummary {
        ExportsSummary {
            names: Vec::with_capacity(mentions),
            marker: Some(false),
            object_escapes: false,
            module_object_escapes: false,
            replaced_by: None,
            names_read_by_own_text: Vec::new(),
            names_exports_of_file: false,
        }
    }

    fn of_unknown_text() -> ExportsSummary {
        ExportsSummary {
            marker: None,
            object_escapes: true,
            module_object_escapes: true,
            ..ExportsSummary::with_room_for(0)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mention {
    /// The name `exports`: the object that the module was born with.
    ExportsName,
    /// Written `module.exports`: what the module has there at that time.
    ModuleExports,
    /// A name that holds either, `(0, exports)`, a member of a name that holds `module`.
    AnotherSpelling,
}

#[derive(Copy, Clone)]
enum TextNode {
    Expression(ExprId),
    Statement(StmtId),
}

enum OwnerOfThis {
    Body,
    Function(FnId),
    /// A field of a class, a namespace, an enum.
    Other,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum OriginKind {
    /// `E.n = v`
    Store,
    /// A key of `module.exports = { .. }`
    Literal,
    /// A call that `look_at_call` understands.
    Call,
}

/// The node that makes an entry of `names`.
#[derive(Copy, Clone)]
struct Origin {
    start: u32,
    end: u32,
    kind: OriginKind,
}

/// `module.exports = value`, `export = value`
#[derive(Copy, Clone)]
struct Replacement {
    node: ExprId,
    value: ExprId,
    statement: StmtId,
    is_whole_statement: bool,
}

/// `target = value`
struct Assignment {
    assignment: ExprId,
    value: ExprId,
}

// `Quiet::runs_nothing` for the head in which `exports` must still be empty: no call qualifies, not even a definition on `exports`.
fn is_call_that_runs_nothing(_: CallId) -> bool {
    false
}

pub(super) struct SummaryWalk<'a, 'b, 's> {
    pub(super) input: &'a CommonJsInput<'a, 'b, 's>,
    pub(super) file: FileId,
    /// The callback that is the body of the module, whose parameters name what it exports. `None`: the file is the module.
    pub(super) inner: Option<&'a InnerModule>,
    pub(super) summary: ExportsSummary,
    atoms: &'a Interner<'s>,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    text: FileText<'a, 's>,
    is_half: bool,
    /// Parallel to `summary.names` until those are sorted.
    origins: Vec<Origin>,
    replacement: Option<Replacement>,
    replacement_count: u32,
    /// `exports = module.exports = v`
    renames_exports: bool,
    mentions_original_exports: bool,
    understood_calls: Vec<CallId>,
    methods_with_super: Vec<FnId>,
    first_return: OnceCell<u32>,
    end_of_head: OnceCell<u32>,
    /// Of an inner module: where the first load in the text of the callback stands.
    first_load_in_callback: u32,
    /// Of a module that may be seen half evaluated: where the first statement of the body starts that runs more than the calls of `understood_calls`, or stores anywhere.
    end_of_head_with_definitions: u32,
}

pub(super) fn summarize_file(input: &CommonJsInput<'_, '_, '_>, file: FileId) -> ExportsSummary {
    let Some(source) = parsed_source(input.bind.files, file) else {
        return ExportsSummary::of_unknown_text();
    };
    let bound = input.bind.files.bound(file);
    let is_exports_or_module = |entry: &&(ExprId, Binding)| {
        matches!(
            entry.1,
            Binding::CommonJs(CommonJsVariable::Exports | CommonJsVariable::Module)
        )
    };
    let identifiers = bound.ident_bindings().iter();
    let mentions = identifiers.filter(is_exports_or_module).count();
    let mut walk = SummaryWalk::new(input, file, None, &source.builtins, mentions);
    walk.look_at_names_of_wrapper();
    walk.look_at_module_object();
    walk.look_at_expressions();
    walk.finish()
}

/// `exports` and `module.exports`, as the parameters of the callback name them. The second parameter occurs only as `module.exports`.
pub(super) fn names_exports_of_inner_module(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    inner: &InnerModule,
    expression: ExprId,
) -> bool {
    let symbol_of = |name: ExprId| match (hir[name].kind, bound.binding(name)) {
        (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
        _ => None,
    };
    if let Some(symbol) = symbol_of(expression) {
        return inner.exports_parameter == Some(symbol);
    }
    let object = hir.member_key(expression).map(|(object, _)| object);
    let object = object.and_then(|object| symbol_of(hir.skip_type_assertions(object)));
    object.is_some() && inner.module_parameter == object
}

// The text of the callback, which an expression owns.
fn find_range_of_callback(hir: &hir::File<'_>, bound: &Bound<'_>, callback: FnId) -> (u32, u32) {
    match bound.fns[callback.idx()].owner {
        FnOwner::Expr(written) => (hir[written].pos, hir[written].end),
        FnOwner::None | FnOwner::Stmt(_) | FnOwner::Member(_) | FnOwner::Type(_) => (0, u32::MAX),
    }
}

/// What the text of each of the callbacks says of the exports of its module, in the order of `inner_modules`, which is that of the text.
/// One loop over the names of the file serves all of them.
pub(super) fn summarize_inner_modules<'a>(
    input: &'a CommonJsInput<'a, '_, '_>,
    file: FileId,
    inner_modules: &[&'a InnerModule],
) -> Vec<ExportsSummary> {
    let files = input.bind.files;
    let Some(source) = parsed_source(files, file) else {
        let unknown = inner_modules.iter();
        return unknown.map(|_| ExportsSummary::of_unknown_text()).collect();
    };
    let (hir, bound, analysis) = (files.hir(file), files.bound(file), files.analysis(file));
    let decisions = &analysis.decisions;
    let sites = analysis.import_sites.iter();
    let loads = sites.filter_map(|site| site.kind.call());
    let loads = loads.chain(input.modules.wrapped.calls_in(file).map(|(call, _)| call));
    let loads = loads.filter(|&call| !decisions.is_dead_expr(call));
    let mut loads: Vec<u32> = loads.map(|call| hir[call].pos).collect();
    loads.shared_sort_unstable();
    let mut ranges: Vec<(u32, u32)> = Vec::with_capacity(inner_modules.len());
    let mut parameters: Vec<(SymbolId, u32)> = Vec::with_capacity(2 * inner_modules.len());
    let mut walks: Vec<SummaryWalk<'a, '_, '_>> = Vec::with_capacity(inner_modules.len());
    for (&inner, index) in inner_modules.iter().zip(0u32..) {
        let (start, end) = find_range_of_callback(hir, bound, inner.callback);
        ranges.push((start, end));
        let named = [inner.exports_parameter, inner.module_parameter];
        parameters.extend(named.into_iter().flatten().map(|symbol| (symbol, index)));
        let mut walk = SummaryWalk::new(input, file, Some(inner), &source.builtins, 0);
        let first_load = loads.get(loads.partition_point(|&load| load < start));
        let first_load = first_load.copied().filter(|&load| load < end);
        walk.first_load_in_callback = first_load.unwrap_or(u32::MAX);
        // Under `with` the run decides what a name means.
        if !hir.with_bodies.is_empty() {
            walk.let_everything_escape();
        }
        walks.push(walk);
    }
    parameters.shared_sort_unstable();
    debug_assert!(ranges.is_sorted());
    for name in (0..hir.exprs.len() as u32).map(ExprId) {
        if !bound.is_evaluated_ident(name) {
            continue;
        }
        match bound.binding(name) {
            Binding::Symbol(symbol) => {
                if let Ok(at) = parameters.binary_search_by_key(&symbol, |entry| entry.0) {
                    walks[parameters[at].1 as usize].look_at_parameter(name, symbol);
                }
            }
            Binding::CommonJs(CommonJsVariable::Exports) => {
                let position = hir[name].pos;
                let behind = ranges.partition_point(|range| range.0 <= position);
                if behind > 0 && position < ranges[behind - 1].1 {
                    walks[behind - 1].summary.names_exports_of_file = true;
                }
            }
            Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => {}
        }
    }
    walks.into_iter().map(SummaryWalk::finish).collect()
}

impl<'a, 'b, 's> SummaryWalk<'a, 'b, 's> {
    fn new(
        input: &'a CommonJsInput<'a, 'b, 's>,
        file: FileId,
        inner: Option<&'a InnerModule>,
        builtins: &'a ResolvedBuiltins,
        mentions: usize,
    ) -> SummaryWalk<'a, 'b, 's> {
        let files = input.bind.files;
        let bound = files.bound(file);
        let module = match inner {
            Some(inner) => ModuleRef::Inner {
                file,
                callback: inner.callback,
            },
            None => ModuleRef::File(file),
        };
        SummaryWalk {
            input,
            file,
            inner,
            summary: ExportsSummary::with_room_for(mentions),
            atoms: &files.atoms,
            hir: files.hir(file),
            bound,
            analysis: files.analysis(file),
            builtins,
            text: FileText::new(files, &input.modules.wrapped, file),
            is_half: (input.half)(module),
            origins: Vec::with_capacity(mentions),
            replacement: None,
            replacement_count: 0,
            renames_exports: false,
            mentions_original_exports: false,
            understood_calls: Vec::new(),
            methods_with_super: Vec::new(),
            first_return: OnceCell::new(),
            end_of_head: OnceCell::new(),
            first_load_in_callback: u32::MAX,
            end_of_head_with_definitions: 0,
        }
    }

    fn decisions(&self) -> &'a Decisions<'s> {
        &self.analysis.decisions
    }

    fn quiet(&self) -> Quiet<'a, 's> {
        Quiet {
            atoms: self.atoms,
            hir: self.hir,
            bound: self.bound,
            decisions: self.decisions(),
            builtins: self.builtins,
            allows_reads_of_open_globals: false,
            runs_nothing: &is_call_that_runs_nothing,
        }
    }

    // Where the first statement of the body starts that is not quiet.
    fn find_end_of_head(&self, quiet: &Quiet<'_, '_>) -> u32 {
        let Some(inner) = self.inner else {
            return quiet.find_end_of_head();
        };
        match self.hir[inner.callback].body {
            FnBody::Block(statements) if !self.summary.names_exports_of_file => {
                quiet.find_end_of_head_in(statements)
            }
            FnBody::Block(_) | FnBody::Expr(_) | FnBody::None => 0,
        }
    }

    /// Where the first statement of the body starts that runs anything or stores anywhere.
    fn end_of_head(&self) -> u32 {
        *self
            .end_of_head
            .get_or_init(|| self.find_end_of_head(&self.quiet()))
    }

    fn first_return(&self) -> u32 {
        *self.first_return.get_or_init(|| {
            let (bound, decisions) = (self.bound, self.decisions());
            if let Some(inner) = self.inner {
                let returns = bound.ids(bound.fns[inner.callback.idx()].returns);
                let live = returns.filter(|&statement: &StmtId| !decisions.is_dead_stmt(statement));
                let starts = live.map(|statement| self.hir[statement].start);
                return starts.min().unwrap_or(u32::MAX);
            }
            let statements = self.hir.stmts.iter().zip((0u32..).map(StmtId));
            let returns = statements.filter(|&(statement, id)| {
                let scope = bound.scope_of_stmt(id);
                matches!(statement.kind, StmtKind::Return(_))
                    && !decisions.is_dead_stmt(id)
                    && scope.is_some()
                    && bound.code_unit(scope) == CodeUnit::File
            });
            let starts = returns.map(|(statement, _)| statement.start);
            starts.min().unwrap_or(u32::MAX)
        })
    }

    fn first_load(&self) -> u32 {
        if self.inner.is_some() {
            return self.first_load_in_callback;
        }
        let (hir, decisions) = (self.hir, self.decisions());
        let sites = self.analysis.import_sites.iter();
        let positions = sites.filter_map(|site| match (site.kind.call(), site.kind) {
            (Some(call), _) => (!decisions.is_dead_expr(call)).then(|| hir[call].pos),
            (None, ImportSiteKind::ImportEquals(declaration)) => {
                Some(hir[hir[declaration].stmt].start)
            }
            // The body asks for it at its head.
            (None, _) => Some(0),
        });
        positions.min().unwrap_or(u32::MAX)
    }

    /// The parent of an expression, past the type assertions around it.
    fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let mut outermost = expression;
        loop {
            match self.bound.parent_of_expr(outermost) {
                Parent::Expr(user) if self.hir.type_assertion_operand(user) == Some(outermost) => {
                    outermost = user;
                }
                parent => return (outermost, parent),
            }
        }
    }

    fn constant(&self, expression: ExprId) -> Option<Constant> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.decisions().constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(constant),
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
        }
    }

    fn find_truthiness(&self, expression: ExprId) -> Option<bool> {
        if self.decisions().is_truthy_without_effects(expression) {
            return Some(true);
        }
        match self.constant(expression)? {
            Constant::Boolean(flag) => Some(flag),
            Constant::Number(number) => Some(number != 0.0 && !number.is_nan()),
            Constant::String(text) => Some(!self.atoms.bytes(text).is_empty()),
            Constant::Undefined | Constant::Null => Some(false),
            Constant::BigInt(_) => None,
        }
    }

    // `void 0`, also behind `exports.b =`.
    fn is_undefined(&self, mut value: ExprId) -> bool {
        loop {
            value = self.hir.skip_type_assertions(value);
            if self.constant(value) == Some(Constant::Undefined) {
                return true;
            }
            match self.hir[value].kind {
                ExprKind::Assign {
                    op: None,
                    value: stored,
                    ..
                } => value = stored,
                _ => return false,
            }
        }
    }

    fn can_be_variable(&self, name: Atom) -> bool {
        self.input.bind.is_plain_name(name)
    }

    fn name_of_key(&self, key: MemberKey) -> Option<Atom> {
        match key {
            MemberKey::Name(name) => Some(name),
            MemberKey::Computed(computed) => match self.constant(computed)? {
                Constant::String(name) => Some(name),
                _ => None,
            },
            MemberKey::PrivateName(_) => None,
        }
    }

    fn is_evaluated(&self, expression: ExprId) -> bool {
        let is_unevaluated_name = matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && !self.bound.is_evaluated_ident(expression);
        !is_unevaluated_name
            && !self.decisions().is_dead_expr(expression)
            && self.bound.parent_of_expr(expression) != Parent::None
            && !self.bound.is_in_type_query(expression)
    }

    fn is_expression_statement(&self, expression: ExprId) -> bool {
        matches!(self.parent(expression).1, Parent::Stmt(statement)
            if matches!(self.hir[statement].kind, StmtKind::Expr(_)))
    }

    fn always_evaluates(&self, user: ExprId, operand: ExprId) -> bool {
        let suspends_or_chooses = matches!(
            self.hir[user].kind,
            ExprKind::Yield { .. } | ExprKind::Await(_) | ExprKind::Jsx(_)
        );
        !suspends_or_chooses && self.text.always_evaluates(user, operand)
    }

    // Folding has decided the test, so that the arm runs whenever the `if` does.
    fn is_decided_arm(&self, conditional: StmtId, arm: StmtId) -> bool {
        let StmtKind::If { test, yes, no } = self.hir[conditional].kind else {
            return false;
        };
        match self.find_truthiness(test) {
            Some(true) => arm == yes,
            Some(false) => arm == no,
            None => false,
        }
    }

    /// The statement that holds the expression, where every run of the body passes the expression: it is in no function, branch, loop or `try`, and behind no `return`.
    fn find_statement_in_every_run(&self, expression: ExprId) -> Option<StmtId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut holder = StmtId::NONE;
        let mut node = TextNode::Expression(expression);
        loop {
            node = match node {
                TextNode::Expression(operand) => match bound.parent_of_expr(operand) {
                    Parent::Expr(user) if user.is_some() => {
                        if !self.always_evaluates(user, operand) {
                            return None;
                        }
                        TextNode::Expression(user)
                    }
                    Parent::Prop(property) | Parent::PropKey(property) => {
                        TextNode::Expression(bound.prop_owner[property.idx()])
                    }
                    Parent::VarInit(declaration) => {
                        TextNode::Statement(bound.var_stmt[declaration.idx()])
                    }
                    Parent::Stmt(user) if user.is_some() => match hir[user].kind {
                        StmtKind::Expr(_)
                        | StmtKind::Throw(_)
                        | StmtKind::ExportAssign(_)
                        | StmtKind::If { .. }
                        | StmtKind::Switch { .. } => TextNode::Statement(user),
                        _ => return None,
                    },
                    _ => return None,
                },
                TextNode::Statement(statement) => {
                    if holder.is_none() {
                        holder = statement;
                    }
                    match bound.parent_of_stmt(statement) {
                        Parent::File if self.inner.is_none() => break,
                        Parent::FnBody(function)
                            if self.inner.is_some_and(|inner| inner.callback == function) =>
                        {
                            break;
                        }
                        Parent::Stmt(user) if user.is_some() => match hir[user].kind {
                            StmtKind::Block(_) => TextNode::Statement(user),
                            _ if self.is_decided_arm(user, statement) => TextNode::Statement(user),
                            _ => return None,
                        },
                        _ => return None,
                    }
                }
            };
        }
        (hir[expression].pos < self.first_return()).then_some(holder)
    }

    /// `target = value`: the assignment and the value.
    fn find_assignment(&self, target: ExprId) -> Option<Assignment> {
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
                Some(Assignment {
                    assignment: user,
                    value,
                })
            }
            _ => None,
        }
    }

    fn let_everything_escape(&mut self) {
        self.summary.object_escapes = true;
        self.summary.module_object_escapes = true;
    }

    // The file needs its five wrapper parameters as real parameters (`arguments`, `with`, direct `eval`, a redeclared or reassigned parameter), or it reads `exports` or `module` where no expression names them.
    fn look_at_names_of_wrapper(&mut self) {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions());
        let mut evals = bound.runtime.eval_scopes().iter();
        let mut is_out_of_sight = bound.file_uses_arguments()
            || !bound.runtime.redeclared_commonjs_variables().is_empty()
            || !hir.with_bodies.is_empty()
            || evals.any(|&(call, _)| !decisions.is_dead_expr(call));
        for &(target, _) in bound.runtime.unbound_name_stores() {
            if decisions.is_dead_expr(target) {
                continue;
            }
            match bound.binding(target) {
                Binding::CommonJs(CommonJsVariable::Exports)
                    if self.builtins.is_stored_with_module_exports(target) =>
                {
                    self.renames_exports = true;
                }
                Binding::CommonJs(_) => is_out_of_sight = true,
                Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => {}
            }
        }
        for binding in self.analysis.bindings_read_without_expression(hir, bound) {
            is_out_of_sight |= matches!(
                binding,
                Binding::CommonJs(CommonJsVariable::Exports | CommonJsVariable::Module)
            );
        }
        if is_out_of_sight {
            self.let_everything_escape();
        }
    }

    fn is_only_compared(&self, expression: ExprId) -> bool {
        matches!(self.parent(expression).1, Parent::Expr(user) if user.is_some() && matches!(
            self.hir[user].kind,
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                ..
            }
        ))
    }

    fn look_at_module_object(&mut self) {
        let mut mentions = self.builtins.module_object_mentions().iter();
        let escapes = mentions.any(|mention| {
            mention.owner == ModuleObjectOwner::OwnFile
                && match mention.object_use {
                    ModuleObjectUse::HandedOn | ModuleObjectUse::HolderHandedOn => true,
                    ModuleObjectUse::Object => !self.is_only_compared(mention.expr),
                    ModuleObjectUse::Field(_)
                    | ModuleObjectUse::Tested
                    | ModuleObjectUse::ParentTested
                    | ModuleObjectUse::Parent
                    | ModuleObjectUse::Children => false,
                }
        });
        if escapes {
            self.let_everything_escape();
        }
    }

    fn is_module_variable(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Module)
    }

    fn find_mention(&self, expression: ExprId) -> Option<Mention> {
        let kind = self.hir[expression].kind;
        if let Some(inner) = self.inner {
            let names = names_exports_of_inner_module(self.hir, self.bound, inner, expression);
            return names.then_some(match kind {
                ExprKind::Ident(_) => Mention::ExportsName,
                _ => Mention::ModuleExports,
            });
        }
        if matches!(kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
        {
            return Some(Mention::ExportsName);
        }
        if self.builtins.builtin_of_expression(expression) != Some(BuiltinId::ModuleObjectExports) {
            return None;
        }
        match kind {
            ExprKind::Dot {
                obj,
                chain: Chain::No,
                ..
            }
            | ExprKind::Index {
                obj,
                chain: Chain::No,
                ..
            } if self.is_module_variable(obj) => Some(Mention::ModuleExports),
            _ => Some(Mention::AnotherSpelling),
        }
    }

    fn look_at_expressions(&mut self) {
        let hir = self.hir;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            match hir[expression].kind {
                ExprKind::This | ExprKind::Super => self.look_at_this(expression),
                ExprKind::Ident(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => self.look_at_name(expression),
                _ => {}
            }
        }
        for statement in hir.ids(hir.body) {
            // `export = e` of TypeScript is the statement `module.exports = e`.
            if let StmtKind::ExportAssign(value) = hir[statement].kind
                && !self.decisions().is_dead_stmt(statement)
            {
                let statement = self.find_statement_in_every_run(value);
                self.replacement_count += 1;
                self.replacement = Some(Replacement {
                    node: value,
                    value,
                    statement: statement.unwrap_or(StmtId::NONE),
                    is_whole_statement: true,
                });
            }
        }
    }

    // A name that is bound to a parameter of the callback.
    fn look_at_parameter(&mut self, name: ExprId, parameter: SymbolId) {
        if !self.is_evaluated(name) {
            return;
        }
        if self
            .inner
            .is_some_and(|inner| inner.exports_parameter == Some(parameter))
        {
            return self.look_at_mention(name, Mention::ExportsName);
        }
        // It occurs only as `module.exports`.
        match self.parent(name) {
            (_, Parent::Expr(member)) if member.is_some() => {
                self.look_at_mention(member, Mention::ModuleExports);
            }
            _ => self.let_everything_escape(),
        }
    }

    // `super` in a method looks above the literal, however the method is called.
    fn may_name_super(&self, function: FnId) -> bool {
        match self.inner {
            Some(_) => {
                self.hir[function].kind == FnKind::Method
                    && self.input.modules.wrapped.names_super(self.file)
            }
            None => self.methods_with_super.contains(&function),
        }
    }

    fn look_at_name(&mut self, expression: ExprId) {
        let mention = self.find_mention(expression);
        // The table of built-ins does not say what the name holds.
        let is_unknown_module = mention.is_none()
            && self.is_module_variable(expression)
            && self.builtins.of_expr(expression).is_none();
        if (mention.is_none() && !is_unknown_module) || !self.is_evaluated(expression) {
            return;
        }
        match mention {
            Some(Mention::AnotherSpelling) => self.summary.object_escapes = true,
            Some(mention) => self.look_at_mention(expression, mention),
            None => self.let_everything_escape(),
        }
    }

    // The code whose `this` the expression sees: arrow functions have none of their own. Where the text does not say, the body.
    fn find_owner_of_this(&self, expression: ExprId) -> OwnerOfThis {
        let (hir, bound) = (self.hir, self.bound);
        let mut node = TextNode::Expression(expression);
        loop {
            let parent = match node {
                TextNode::Expression(expression) => bound.parent_of_expr(expression),
                TextNode::Statement(statement) => bound.parent_of_stmt(statement),
            };
            let function = match parent {
                Parent::Expr(user) => {
                    node = TextNode::Expression(user);
                    continue;
                }
                Parent::Stmt(user) => {
                    node = TextNode::Statement(user);
                    continue;
                }
                Parent::VarInit(declaration) => {
                    node = TextNode::Statement(bound.var_stmt[declaration.idx()]);
                    continue;
                }
                Parent::Case(case) => {
                    node = TextNode::Statement(bound.case_stmt[case.idx()]);
                    continue;
                }
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => {
                    node = TextNode::Expression(bound.prop_owner[property.idx()]);
                    continue;
                }
                Parent::FnBody(function) => function,
                Parent::ParamDefault(parameter) => bound.param_fn[parameter.idx()],
                Parent::MemberInit(_) | Parent::EnumInit(_) | Parent::Module(_) => {
                    return OwnerOfThis::Other;
                }
                _ => return OwnerOfThis::Body,
            };
            match (hir[function].kind, bound.fns[function.idx()].owner) {
                (FnKind::Arrow, FnOwner::Expr(written)) => node = TextNode::Expression(written),
                (FnKind::Arrow, _) => return OwnerOfThis::Body,
                _ => return OwnerOfThis::Function(function),
            }
        }
    }

    fn reads_plain_name_of_this(&self, member: ExprId) -> bool {
        let hir = self.hir;
        let member = hir.skip_type_assertions(member);
        let (ExprKind::Dot {
            chain: Chain::No, ..
        }
        | ExprKind::Index {
            chain: Chain::No, ..
        }) = hir[member].kind
        else {
            return false;
        };
        match hir.member_key(member) {
            Some((object, MemberKey::Name(name))) => {
                matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::This)
                    && self.can_be_variable(name)
            }
            _ => false,
        }
    }

    // `this && this.n` while nothing has run: the object is as it was made, so the whole is `undefined`, as it is where `this` is no object.
    fn is_in_test_of_untouched_object(&self, this: ExprId) -> bool {
        let hir = self.hir;
        if !self.quiet().is_this_of_file(this) || hir[this].pos >= self.end_of_head() {
            return false;
        }
        let (mut operand, mut parent) = self.parent(this);
        if let Parent::Expr(member) = parent
            && hir.member_key(member).is_some_and(|it| it.0 == operand)
        {
            (operand, parent) = self.parent(member);
        }
        let Parent::Expr(test) = parent else {
            return false;
        };
        let ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } = hir[test].kind
        else {
            return false;
        };
        (operand == left || operand == right)
            && matches!(hir[hir.skip_type_assertions(left)].kind, ExprKind::This)
            && self.reads_plain_name_of_this(right)
    }

    fn look_at_this(&mut self, expression: ExprId) {
        if !self.is_evaluated(expression) {
            return;
        }
        let is_super = matches!(self.hir[expression].kind, ExprKind::Super);
        match self.find_owner_of_this(expression) {
            OwnerOfThis::Function(function) => {
                let owner = self.bound.fns[function.idx()].owner;
                if is_super && matches!(owner, FnOwner::Expr(_)) {
                    self.methods_with_super.push(function);
                }
            }
            OwnerOfThis::Other => {}
            // `bun run` replaces the `this` of a file that has ES module syntax with `undefined`.
            OwnerOfThis::Body if self.analysis.has_esm_syntax => {}
            OwnerOfThis::Body => {
                if !self.is_in_test_of_untouched_object(expression) {
                    self.summary.object_escapes = true;
                }
            }
        }
    }

    fn look_at_mention(&mut self, mention: ExprId, kind: Mention) {
        let (outermost, parent) = self.parent(mention);
        if self
            .bound
            .get_assignment_target(self.hir, outermost)
            .is_some()
        {
            // The binder lists the stores to the name.
            if kind == Mention::ModuleExports {
                self.add_replacement(mention);
            }
            return;
        }
        self.mentions_original_exports |= kind == Mention::ExportsName;
        // The lowering puts `true` in the place of every mention that is left.
        let is_followed = match parent {
            Parent::Expr(user) if user.is_some() => self.look_at_user(outermost, user),
            Parent::Stmt(user) if user.is_some() => {
                matches!(self.hir[user].kind, StmtKind::If { .. } | StmtKind::Expr(_))
            }
            _ => false,
        };
        self.summary.object_escapes |= !is_followed;
    }

    // True if the expression around a mention is a member access, a test whose result is the same for every object, or a call that `look_at_call` understands.
    fn look_at_user(&mut self, mention: ExprId, user: ExprId) -> bool {
        match self.hir[user].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == mention => {
                self.look_at_access(user)
            }
            // An object is true: `exports && e` is `e`.
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
                self.constant(if left == mention { right } else { left }),
                Some(Constant::Undefined | Constant::Null)
            ),
            ExprKind::Unary { op: UnOp::Not, .. } => true,
            // The fold has the answer, and nothing evaluates the operand.
            ExprKind::Unary {
                op: UnOp::Typeof, ..
            } => self.constant(user).is_some(),
            ExprKind::Cond { test, .. } => test == mention,
            ExprKind::Call(call) if self.hir[call].callee != mention => {
                self.look_at_call_with_mention(user, call, mention)
            }
            _ => false,
        }
    }

    // `E.n`. False: only the object says what the access comes to.
    fn look_at_access(&mut self, access: ExprId) -> bool {
        let hir = self.hir;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[access].kind else {
            return false;
        };
        let key = hir.member_key(access);
        let name = key.and_then(|(_, key)| self.name_of_key(key));
        let is_plain = |&name: &Atom| chain == Chain::No && self.can_be_variable(name);
        let Some(name) = name.filter(is_plain) else {
            return false;
        };
        let (outermost, parent) = self.parent(access);
        match self.bound.get_assignment_target(hir, outermost) {
            Some(AssignmentTarget::Assign(None)) => {
                // `None`: a part of a pattern.
                let Some(Assignment { assignment, value }) = self.find_assignment(access) else {
                    return false;
                };
                let statement = self.find_statement_in_every_run(assignment);
                self.summary.names.push(StoredName::Value {
                    name,
                    statement: statement.unwrap_or(StmtId::NONE),
                    value,
                });
                self.note_origin_of_new_names(assignment, OriginKind::Store);
                true
            }
            Some(
                AssignmentTarget::Assign(Some(_))
                | AssignmentTarget::Unary
                | AssignmentTarget::ForInOrOf,
            ) => false,
            None => {
                let is_deleted = matches!(parent, Parent::Expr(user) if user.is_some() && matches!(
                    hir[user].kind,
                    ExprKind::Unary {
                        op: UnOp::Delete,
                        ..
                    }
                ));
                if !is_deleted {
                    self.summary.names_read_by_own_text.push(name);
                }
                !is_deleted
            }
        }
    }

    fn note_origin_of_new_names(&mut self, node: ExprId, kind: OriginKind) {
        let origin = Origin {
            start: self.hir[node].pos,
            end: self.hir[node].end,
            kind,
        };
        self.origins.resize(self.summary.names.len(), origin);
    }

    // `module.exports = e`. What it makes of the module shows once every mention is seen.
    fn add_replacement(&mut self, target: ExprId) {
        self.replacement_count += 1;
        // `None`: a compound assignment, or a part of a pattern.
        let Some(Assignment { assignment, value }) = self.find_assignment(target) else {
            self.summary.object_escapes = true;
            return;
        };
        let statement = self.find_statement_in_every_run(assignment);
        self.replacement = Some(Replacement {
            node: assignment,
            value,
            statement: statement.unwrap_or(StmtId::NONE),
            is_whole_statement: self.is_expression_statement(assignment),
        });
    }

    // Most of these calls return the object, so the value of the call must be unused.
    fn look_at_call_with_mention(&mut self, node: ExprId, call: CallId, mention: ExprId) -> bool {
        let hir = self.hir;
        let arguments = hir.ids(hir[call].args);
        let mut earlier = arguments.take_while(|&argument: &ExprId| argument != mention);
        // The call was judged at its first mention, and that verdict stands.
        if earlier.any(|argument| {
            let argument = hir.skip_type_assertions(argument);
            matches!(
                self.find_mention(argument),
                Some(Mention::ExportsName | Mention::ModuleExports)
            )
        }) {
            return true;
        }
        match self.find_statement_in_every_run(node) {
            Some(statement) if self.is_expression_statement(node) => {
                self.ask_about_call(statement, node)
            }
            _ => false,
        }
    }

    fn ask_about_call(&mut self, statement: StmtId, call: ExprId) -> bool {
        let (count, marker) = (self.summary.names.len(), self.summary.marker);
        let is_understood = self.look_at_call(statement, call);
        let marker_of_call = core::mem::replace(&mut self.summary.marker, marker);
        if !is_understood {
            self.summary.names.truncate(count);
            return false;
        }
        if marker_of_call != marker {
            let is_true = marker_of_call == Some(true);
            // Every helper that defines the flag does so ahead of the names that it defines.
            self.summary.names.insert(
                count,
                StoredName::Value {
                    name: known::__esModule,
                    statement: if is_true { statement } else { StmtId::NONE },
                    value: ExprId::NONE,
                },
            );
        }
        self.note_origin_of_new_names(call, OriginKind::Call);
        if let ExprKind::Call(id) = self.hir[call].kind {
            self.understood_calls.push(id);
        }
        true
    }

    // `{ a, b: e, c() {} }`: the literal takes the place of the object that the module was born with, which nobody has seen.
    fn add_names_of_literal(&mut self, replacement: Replacement, literal: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let is_plain = properties.iter().all(|id| {
            let property = hir[id];
            let needs_literal = matches!(hir[property.value].kind, ExprKind::Fn(method)
                if self.may_name_super(method));
            matches!(hir.runtime_property_key(id), PropKey::Name(name) if self.can_be_variable(name))
                && matches!(
                    property.kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                )
                && !needs_literal
        });
        if !is_plain {
            return false;
        }
        self.summary.names.reserve_exact(properties.len());
        for id in properties.iter() {
            if let PropKey::Name(name) = hir.runtime_property_key(id) {
                self.summary.names.push(StoredName::Value {
                    name,
                    statement: replacement.statement,
                    value: hir[id].value,
                });
            }
        }
        self.note_origin_of_new_names(replacement.node, OriginKind::Literal);
        true
    }

    fn finish_replacement(&mut self) {
        let Some(replacement) = self.replacement else {
            return;
        };
        if self.replacement_count != 1 || replacement.statement.is_none() {
            self.summary.object_escapes = true;
            return;
        }
        let end = self.hir[replacement.node].end;
        let mut entries = self.summary.names.iter().zip(&self.origins);
        // What is stored in front of the statement, or by a function that runs in front of it, lands on the first object. So does what `exports` names behind it.
        let uses_only_the_new_object = replacement.is_whole_statement
            && !self.renames_exports
            && !self.mentions_original_exports
            && entries.all(|(entry, origin)| entry.statement().is_some() && origin.start >= end);
        let value = self.hir.skip_type_assertions(replacement.value);
        let named = find_literal_exported_under_name(self.hir, self.bound, value);
        let value = named.map_or(value, |(literal, _)| literal);
        let is_spelled_out = uses_only_the_new_object
            && match self.hir[value].kind {
                // Whoever has required the module in a cycle holds the first object.
                ExprKind::Object(_) => {
                    !self.is_half && self.add_names_of_literal(replacement, value)
                }
                // `check_names_visible_mid_evaluation` asks whether anybody can have required it by then.
                ExprKind::Call(_) => self.ask_about_call(replacement.statement, value),
                _ => false,
            };
        if !is_spelled_out {
            self.summary.replaced_by = Some(replacement.value);
        }
    }

    // A definition takes no store, and a getter none but `undefined` in front of it: TypeScript stores `void 0` under every name first.
    // A name that stands for another is there from the start, the property only from its definition on, so the text itself may not read it.
    fn check_names_that_calls_define(&mut self) {
        let origins = &self.origins;
        if !origins.iter().any(|origin| origin.kind == OriginKind::Call) {
            return;
        }
        let is_call = |entry: &&(u32, u32)| origins[entry.1 as usize].kind == OriginKind::Call;
        let names = &self.summary.names;
        let numbered = names.iter().zip(0u32..);
        let mut by_name: Vec<(u32, u32)> = numbered
            .filter_map(|(entry, index)| Some((u32::from(entry.name()?), index)))
            .collect();
        by_name.shared_sort_unstable();
        let mut is_cleared = vec![false; names.len()];
        let mut names_of_getters: Vec<u32> = Vec::new();
        let mut is_refused = false;
        for entries in by_name.chunk_by(|a, b| a.0 == b.0) {
            let Some(&(name, definition)) = entries.iter().find(is_call) else {
                continue;
            };
            let is_getter = matches!(names[definition as usize], StoredName::Getter { .. });
            if is_getter {
                names_of_getters.push(name);
            }
            let start = origins[definition as usize].start;
            for &(_, index) in entries.iter().filter(|entry| entry.1 != definition) {
                let origin = origins[index as usize];
                // A key of the literal does not count: it was not listed yet when `look_at_call` read the descriptor, and a descriptor without `enumerable` leaves an existing property enumerable.
                let is_cleared_before = is_getter
                    && origin.kind == OriginKind::Store
                    && origin.end <= start
                    && matches!(names[index as usize], StoredName::Value { statement, value, .. }
                        if statement.is_some() && self.is_undefined(value));
                is_cleared[index as usize] = is_cleared_before;
                is_refused |= !is_cleared_before;
            }
        }
        let mut reads = self.summary.names_read_by_own_text.iter();
        is_refused |= reads.any(|&name| names_of_getters.binary_search(&u32::from(name)).is_ok());
        if is_refused {
            self.summary.object_escapes = true;
            return;
        }
        let mut kept = is_cleared.iter().map(|&is_cleared| !is_cleared);
        self.summary.names.retain(|_| kept.next() == Some(true));
        let mut kept = is_cleared.iter().map(|&is_cleared| !is_cleared);
        self.origins.retain(|_| kept.next() == Some(true));
    }

    // `__export(all, { n: () => n })`: the call that gets the literal in which the getter is written.
    fn find_call_with_literal_around(&self, getter: ExprId) -> Option<CallId> {
        let Parent::Prop(property) = self.bound.parent_of_expr(getter) else {
            return None;
        };
        let (_, Parent::Expr(user)) = self.parent(self.bound.prop_owner[property.idx()]) else {
            return None;
        };
        match self.hir[user.some()?].kind {
            ExprKind::Call(call) => Some(call),
            _ => None,
        }
    }

    // Whoever finds the module half evaluated finds a name that stands for another only from its definition on.
    // A definition on the object that the module was born with runs the built-in, or the helper that calls it, and no more. So does one on the object that `__toCommonJS` copies, which nobody else has.
    fn check_names_visible_mid_evaluation(&mut self) {
        if !self.is_half {
            return;
        }
        // `module.exports = __toCommonJS(all)`: no literal is spelled out for such a module.
        let copy = self
            .replacement
            .filter(|_| self.summary.replaced_by.is_none());
        let copy = copy.and_then(|replacement| replacement.statement.some());
        let entries = self.summary.names.iter();
        let mut calls_on_copied_object: Vec<CallId> = entries
            .filter_map(|entry| match *entry {
                StoredName::Getter {
                    statement, getter, ..
                } if Some(statement) == copy => self.find_call_with_literal_around(getter),
                StoredName::Value { .. } | StoredName::Getter { .. } | StoredName::AllOf { .. } => {
                    None
                }
            })
            .collect();
        // The getters of one literal stand side by side.
        calls_on_copied_object.dedup();
        self.understood_calls.append(&mut calls_on_copied_object);
        self.understood_calls.shared_sort_unstable();
        let is_understood = |call: CallId| self.understood_calls.binary_search(&call).is_ok();
        let quiet = Quiet {
            runs_nothing: &is_understood,
            ..self.quiet()
        };
        let end_of_head = self.find_end_of_head(&quiet);
        let mut entries = self.summary.names.iter();
        let is_seen_too_early = entries.any(|entry| match *entry {
            StoredName::Getter { statement, .. } | StoredName::AllOf { statement, .. } => {
                statement.is_none()
                    || (Some(statement) != copy && self.hir[statement].start >= end_of_head)
            }
            StoredName::Value { .. } => false,
        });
        // The store runs the helper and no more. Whoever has required the module in front of it holds the first object.
        let is_copied_too_late =
            copy.is_some_and(|statement| self.hir[statement].start > end_of_head);
        self.summary.object_escapes |= is_seen_too_early || is_copied_too_late;
        self.end_of_head_with_definitions = end_of_head;
    }

    // `exports.a = exports.b = v` stores `b` first.
    fn sort_names(&mut self) {
        type Place = (bool, u32, Reverse<u32>, u32);
        let entries = self.summary.names.iter().zip(&self.origins).zip(0u32..);
        let mut placed: Vec<(Place, StoredName)> = entries
            .map(|((&entry, origin), index)| {
                let may_be_skipped = entry.statement().is_none();
                let place = (may_be_skipped, origin.end, Reverse(origin.start), index);
                (place, entry)
            })
            .collect();
        if placed.is_sorted_by_key(|entry| entry.0) {
            return;
        }
        placed.shared_sort_unstable_by_key(|entry| entry.0);
        for (slot, (_, entry)) in self.summary.names.iter_mut().zip(placed) {
            *slot = entry;
        }
    }

    // Nobody loads anything, and so nobody comes back to look at the module, until the statement has run.
    fn is_ahead_of_every_load(&self, statement: StmtId) -> bool {
        let statement = self.hir[statement];
        statement.loc.end <= self.first_load()
            && (!self.is_half || statement.start <= self.end_of_head_with_definitions)
    }

    fn find_marker(&self) -> Option<bool> {
        let summary = &self.summary;
        if summary.object_escapes || summary.module_object_escapes || summary.replaced_by.is_some()
        {
            return None;
        }
        let mut stores = summary.names.iter().filter_map(|entry| match *entry {
            StoredName::Value {
                name,
                statement,
                value,
            } if name == known::__esModule => {
                let is_true = match value.some() {
                    Some(value) => self.constant(value) == Some(Constant::Boolean(true)),
                    None => statement.is_some(),
                };
                Some((statement, is_true))
            }
            StoredName::Getter { name, .. } if name == known::__esModule => {
                Some((StmtId::NONE, false))
            }
            StoredName::Value { .. } | StoredName::Getter { .. } | StoredName::AllOf { .. } => None,
        });
        let Some((statement, is_true)) = stores.next() else {
            // The names of another module may have one among them.
            let mut entries = summary.names.iter();
            let takes_unknown_names = entries.any(|it| matches!(it, StoredName::AllOf { .. }));
            return (!takes_unknown_names).then_some(false);
        };
        let is_known = stores.next().is_none()
            && is_true
            && statement.is_some()
            && self.is_ahead_of_every_load(statement);
        is_known.then_some(true)
    }

    fn finish(mut self) -> ExportsSummary {
        self.finish_replacement();
        self.check_names_that_calls_define();
        self.check_names_visible_mid_evaluation();
        self.sort_names();
        self.summary.object_escapes |= self.summary.module_object_escapes;
        self.summary.marker = self.find_marker();
        self.summary
    }
}
