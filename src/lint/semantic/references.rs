//! Every occurrence of a name that refers to something: ESLint's `Reference`s.
//!
//! This derives whether each one is read or written, the scope it's in and what it resolves to, and
//! groups all of them by variable and by scope.

use super::order;
use super::scopes::{self, Cursor, NONE, ScopeTree, Step};
use super::variables::{DeepPatterns, TYPE, VALUE, Variables};
use super::{ReferenceFlags, ScopeKind};
use crate::ast::File;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Parent, PatParent};
use bun_sema::hir::{self, ExprId, ExprKind, PatKind, PropKind, StmtKind, TypeNodeKind, UnOp};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// Where a reference appears in the syntax.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReferenceSite {
    /// An identifier expression.
    Expr(ExprId),
    /// The name of a declaration that gives it a value.
    Pat(hir::PatId),
    /// The first name in a type reference's entity name.
    TypeName(hir::TypeNodeId),
    /// The `x` of `x is T`.
    Predicate(hir::TypeNodeId),
    /// The `a` of `import x = a.b`.
    ImportEquals(hir::ImportEqualsId),
    /// The `a` of `export { a }`.
    ExportSpec(hir::ExportSpecId),
    /// The `N` of `export as namespace N`.
    ExportAsNamespace(hir::StmtId),
    /// The tag `A-b`, or part of the tag `a:b`, which the HIR stores as a string. Also the tag `this`.
    JsxName(ExprId),
    /// The name in the first declaration of the variable at this index, for JSX's implicit use of `React`.
    Declaration(u32),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct RawReference {
    pub(crate) site: ReferenceSite,
    pub(crate) pos: u32,
    pub(crate) name: Atom,
    /// An index into `Variables::list`.
    pub(crate) variable: u32,
    /// ESLint's `reference.from`.
    pub(crate) from: u32,
    /// ESLint's `reference.writeExpr`.
    pub(crate) write: ExprId,
    pub(crate) flags: ReferenceFlags,
}

pub(crate) struct References {
    /// In source order.
    pub(crate) all: Vec<RawReference>,
    /// Indices into `all`, with each destructuring pattern's names before everything else in it.
    /// Empty if that's the same as source order.
    visiting_order: Vec<u32>,
    /// The references in `all` that aren't visited at their source position: the index, and the
    /// position it's visited at.
    moved: Vec<(u32, u32)>,
    /// Indices into `all` in the order the scope manager creates the references. `None` means the
    /// same as `visiting_order`. Computed on demand.
    in_creation_order: OnceCell<Option<Vec<u32>>>,
    /// Indices into `all`, variable by variable, in `visiting_order` order. The unresolved
    /// references come after the last variable.
    by_variable: Vec<u32>,
    /// For each variable, the start of its references in `by_variable`. It has two more entries
    /// than there are variables.
    variable_starts: Vec<u32>,
    /// For each variable: `HAS_READ`, `HAS_WRITE`, `HAS_MODIFYING_WRITE`.
    marks: Vec<u32>,
    /// For each identifier expression, the index in `Variables::list` of the value that the name
    /// resolves to at that position.
    expr_variables: Vec<u32>,
    /// Indices into `all`, scope by scope, in `in_creation_order` order, and the start of each scope's
    /// references. Computed on demand.
    by_scope: OnceCell<(Vec<u32>, Vec<u32>)>,
    /// The same in `visiting_order` order, used as long as nothing has requested `by_scope`.
    by_scope_in_some_order: OnceCell<(Vec<u32>, Vec<u32>)>,
    scope_count: usize,
    /// The unresolved references, by name and then in that order. Computed on demand.
    unresolved_by_name: OnceCell<Vec<u32>>,
}

const READ: ReferenceFlags = ReferenceFlags::READ.union(ReferenceFlags::VALUE);
const WRITE: ReferenceFlags = ReferenceFlags::WRITE.union(ReferenceFlags::VALUE);

/// How an identifier expression is used.
enum Access {
    Read,
    /// `a += value`, `a++`
    ReadWrite(ExprId),
    /// The assigned values are written to `access`'s `values` argument, in the order of ESLint's references.
    Write {
        /// The start of the array or object it's destructured from, or its own start if there is none.
        start: u32,
        /// True if `PatternVisitor` visits it.
        is_in_pattern: bool,
    },
}

/// Some reference to the variable reads it.
pub(crate) const HAS_READ: u32 = 1 << 29;
/// Some reference writes it.
pub(crate) const HAS_WRITE: u32 = 1 << 30;
/// Some reference writes it, other than its declaration.
pub(crate) const HAS_MODIFYING_WRITE: u32 = 1 << 31;
const COUNT: u32 = HAS_READ - 1;

/// Sorts by position. References at the same position keep their order. The sort runs on numbers
/// that pack each one's position and list index, because that `u64` sort is already compiled for
/// other lists.
#[inline(never)]
fn sort_by_pos(found: &mut [RawReference]) {
    if found.is_sorted_by_key(|it| it.pos) {
        return;
    }
    let keys = found.iter().zip(0u64..);
    let mut keys: Vec<u64> = keys.map(|(it, at)| u64::from(it.pos) << 32 | at).collect();
    keys.sort();
    let sorted: Vec<RawReference> = (keys.iter())
        .filter_map(|&key| found.get(key as u32 as usize).copied())
        .collect();
    found.copy_from_slice(&sorted);
}

/// Sorts numbers that are each close to their final position, with an insertion sort. If that turns
/// out to take many moves, it falls back to the standard library's sort.
pub(super) fn sort_nearly_sorted(numbers: &mut [u64]) {
    let mut moves = 0;
    for at in 1..numbers.len() {
        let (number, mut to) = (numbers[at], at);
        while to > 0 && numbers[to - 1] > number {
            numbers[to] = numbers[to - 1];
            to -= 1;
        }
        numbers[to] = number;
        moves += at - to;
        if moves > 8 * numbers.len() {
            return numbers.sort();
        }
    }
    debug_assert!(numbers.is_sorted());
}

struct Collector<'f, 'a> {
    file: &'f File<'a>,
    is_javascript: bool,
    /// Everything except identifier expressions and `type_names`.
    found: Vec<RawReference>,
    /// The type references: the position of the first name, then the `TypeNodeId`.
    type_names: Vec<u64>,
}

/// Tracks what each name resolves to at a position that advances through the file.
struct Visible<'t> {
    tree: &'t ScopeTree,
    variables: &'t Variables,
    /// For each `Variable::slot`: the variable in the innermost scope enclosing the position that
    /// declares the name.
    innermost: Vec<u32>,
    /// For each variable of a scope enclosing the position: the previous value of `innermost`.
    hidden: Vec<u32>,
    /// For each scope: true if the position is in a part of it that's evaluated in the enclosing scope.
    is_suspended: Vec<bool>,
    suspended: u32,
}

impl Visible<'_> {
    #[inline]
    fn take(&mut self, step: Step) {
        match step {
            // Half of the scopes declare nothing.
            Step::Enter(scope) | Step::Leave(scope)
                if self.variables.range_of_scope(scope).is_empty() => {}
            _ => self.take_effective_step(step),
        }
    }

    #[inline(never)]
    fn take_effective_step(&mut self, step: Step) {
        match step {
            // `WithScope#__close` passes every reference on to the enclosing scope.
            Step::Enter(scope) | Step::Leave(scope)
                if self
                    .tree
                    .scopes
                    .get(scope as usize)
                    .is_none_or(|it| it.kind == ScopeKind::With) => {}
            Step::Enter(scope) => {
                let range = self.variables.range_of_scope(scope);
                let here = self.variables.list.get(range.clone()).unwrap_or_default();
                for ((index, variable), hidden) in
                    range.clone().zip(here).zip(&mut self.hidden[range])
                {
                    *hidden = std::mem::replace(
                        &mut self.innermost[variable.slot as usize],
                        index as u32,
                    );
                }
            }
            Step::Leave(scope) => {
                let range = self.variables.range_of_scope(scope);
                let here = self.variables.list.get(range.clone()).unwrap_or_default();
                for (variable, &hidden) in here.iter().zip(&self.hidden[range]) {
                    self.innermost[variable.slot as usize] = hidden;
                }
            }
            Step::Suspend(scope) => {
                self.is_suspended[scope as usize] = true;
                self.suspended += 1;
            }
            Step::Resume(scope) => {
                self.is_suspended[scope as usize] = false;
                self.suspended -= 1;
            }
        }
    }

    /// `Variables::resolve` for a reference at `pos`, which must be the current position.
    #[inline(always)]
    fn resolve(&self, name: Atom, pos: u32, wanted_flags: u8) -> u32 {
        let mut index = self.innermost[self.variables.slot_of(name)];
        while let Some(it) = self.variables.list.get(index as usize) {
            if it.flags & wanted_flags != 0
                && !(pos < it.body_start
                    && (it.first_pos >= it.body_start || Variables::is_implicit(it)))
                && (self.suspended == 0 || !self.is_suspended[it.scope as usize])
            {
                break;
            }
            index = self.hidden[index as usize];
        }
        index
    }
}

/// Takes the references in source order and finds each one's scope and what it resolves to.
struct Resolver<'t> {
    variables: &'t Variables,
    visible: Visible<'t>,
    /// Text ranges in which nothing is a reference.
    unvisited: &'t [(u32, u32)],
    cursor: Cursor<'t>,
    all: Vec<RawReference>,
    /// `References::expr_variables`
    expr_variables: Vec<u32>,
    /// The number of references that resolve to each variable, at the variable's index plus one.
    /// The last entry counts the unresolved ones. The highest bits are `HAS_READ`, `HAS_WRITE`,
    /// `HAS_MODIFYING_WRITE`.
    counts: Vec<u32>,
    /// True if `unvisited` is empty.
    is_plain: bool,
    /// The references in `all` that aren't visited at their source position: the index, and the
    /// position it's visited at.
    moved: Vec<(u32, u32)>,
    /// The highest position in `moved`.
    last_moved_to: u32,
    /// True if the references so far are visited in `all`'s order.
    is_visiting_order: bool,
    /// Like `moved`, for the ones that only `References::in_creation_order` moves.
    moved_on_demand: Vec<(u32, u32)>,
}

impl<'t> Resolver<'t> {
    fn new(
        file: &'t File,
        tree: &'t ScopeTree,
        variables: &'t Variables,
        capacity: usize,
    ) -> Resolver<'t> {
        Resolver {
            variables,
            visible: Visible {
                tree,
                variables,
                innermost: vec![NONE; variables.slot_count()],
                hidden: vec![NONE; variables.list.len()],
                is_suspended: vec![false; tree.scopes.len()],
                suspended: 0,
            },
            unvisited: if scopes::is_javascript_mode(file) {
                &[]
            } else {
                &tree.unvisited
            },
            cursor: tree.cursor(),
            all: Vec::with_capacity(capacity),
            expr_variables: vec![NONE; file.hir.exprs.len()],
            counts: vec![0; variables.list.len() + 2],
            moved: Vec::new(),
            last_moved_to: 0,
            is_visiting_order: true,
            moved_on_demand: Vec::new(),
            is_plain: scopes::is_javascript_mode(file) || tree.unvisited.is_empty(),
        }
    }

    /// The scope that the text at `pos` belongs to. `pos` must not be lower than in the previous call.
    #[inline(always)]
    fn go_to(&mut self, pos: u32) -> u32 {
        let visible = &mut self.visible;
        self.cursor.seek_by_steps(pos, |step| visible.take(step))
    }

    /// For an identifier expression that isn't a reference.
    fn add_name(&mut self, id: ExprId, pos: u32, name: Atom) {
        self.go_to(pos);
        if let Some(slot) = self.expr_variables.get_mut(id.idx()) {
            *slot = self.visible.resolve(name, pos, VALUE);
        }
    }

    /// `add` for an identifier expression that's read.
    #[inline]
    fn add_read(&mut self, id: ExprId, pos: u32, name: Atom) {
        if self.is_plain {
            return self.add_simple_read(id, pos, name);
        }
        self.add(RawReference {
            site: ReferenceSite::Expr(id),
            pos,
            name,
            variable: NONE,
            from: pos,
            write: ExprId::NONE,
            flags: READ,
        });
    }

    /// Same, if `unvisited` is empty.
    #[inline(always)]
    fn add_simple_read(&mut self, id: ExprId, pos: u32, name: Atom) {
        if pos < self.last_moved_to {
            self.is_visiting_order = false;
        }
        let from = self.go_to(pos);
        let variable = self.visible.resolve(name, pos, VALUE);
        let count = &mut self.counts[(variable as usize).min(self.variables.list.len()) + 1];
        *count = (*count + 1) | HAS_READ;
        if let Some(slot) = self.expr_variables.get_mut(id.idx()) {
            *slot = variable;
        }
        self.all.push(RawReference {
            site: ReferenceSite::Expr(id),
            pos,
            name,
            variable,
            from,
            write: ExprId::NONE,
            flags: READ,
        });
    }

    /// `add` for the first name of the type reference `id`.
    fn add_type_name(&mut self, id: hir::TypeNodeId, pos: u32, name: Atom) {
        if !self.unvisited.is_empty()
            && self
                .unvisited
                .iter()
                .any(|range| (range.0..range.1).contains(&pos))
        {
            return;
        }
        self.is_visiting_order &= pos >= self.last_moved_to;
        let from = self.go_to(pos);
        let variable = self.visible.resolve(name, pos, TYPE);
        let count = &mut self.counts[(variable as usize).min(self.variables.list.len()) + 1];
        *count = (*count + 1) | HAS_READ;
        self.all.push(RawReference {
            site: ReferenceSite::TypeName(id),
            pos,
            name,
            variable,
            from,
            write: ExprId::NONE,
            flags: ReferenceFlags::READ | ReferenceFlags::TYPE,
        });
    }

    #[inline(always)]
    fn count(&mut self, it: &RawReference) {
        let is_modifying =
            it.flags.contains(ReferenceFlags::WRITE) && !it.flags.contains(ReferenceFlags::INIT);
        let marks = (u32::from(it.flags.contains(ReferenceFlags::READ)) * HAS_READ)
            | (u32::from(it.flags.contains(ReferenceFlags::WRITE)) * HAS_WRITE)
            | (u32::from(is_modifying) * HAS_MODIFYING_WRITE);
        let count = &mut self.counts[(it.variable as usize).min(self.variables.list.len()) + 1];
        *count = (*count + 1) | marks;
    }

    /// For `it.from`, see `Collector::push_write`.
    #[inline(never)]
    fn add(&mut self, mut it: RawReference) {
        if !self.unvisited.is_empty()
            && self
                .unvisited
                .iter()
                .any(|range| (range.0..range.1).contains(&it.pos))
        {
            return;
        }
        if it.from == it.pos {
            self.is_visiting_order &= it.pos >= self.last_moved_to;
        } else if matches!(it.site, ReferenceSite::Declaration(_)) {
            self.is_visiting_order &= it.pos >= self.last_moved_to;
            self.moved_on_demand.push((self.all.len() as u32, it.from));
        } else {
            let last_visit = match self.moved.last() {
                Some(&(index, visit)) if index as usize + 1 == self.all.len() => visit,
                _ => self.all.last().map_or(0, |it| it.pos),
            };
            self.is_visiting_order &= it.from >= last_visit;
            self.moved.push((self.all.len() as u32, it.from));
            self.last_moved_to = self.last_moved_to.max(it.from);
        }
        it.from = self.go_to(it.pos);
        let wanted_flags = u8::from(it.flags.contains(ReferenceFlags::VALUE)) * VALUE
            + u8::from(it.flags.contains(ReferenceFlags::TYPE)) * TYPE;
        it.variable = match it.site {
            ReferenceSite::Declaration(index) => {
                it.from = self.variables.list[index as usize].scope;
                self.variables
                    .resolve(self.visible.tree, it.from, it.name, it.pos, wanted_flags)
                    .unwrap_or(NONE)
            }
            _ => self.visible.resolve(it.name, it.pos, wanted_flags),
        };
        if let ReferenceSite::Expr(e) = it.site
            && let Some(slot) = self.expr_variables.get_mut(e.idx())
        {
            *slot = if wanted_flags == VALUE {
                it.variable
            } else {
                self.visible.resolve(it.name, it.pos, VALUE)
            };
        }
        self.count(&it);
        self.all.push(it);
    }
}

/// The state that `Collector::identifier` carries from one identifier to the next.
struct Merge<'t> {
    into: Resolver<'t>,
    /// The number of entries in `Collector::found` and `Collector::type_names` passed on so far.
    passed: usize,
    passed_type_names: usize,
    /// The position of the next one.
    next_found: u32,
    /// The position of the last identifier.
    last: u32,
    /// There's no JSDoc comment of a JavaScript file between `last` and this position.
    next_jsdoc: u32,
    /// No expression between the last identifier and this one is the operand of a `typeof` in a type.
    next_operand: u32,
    values: SmallVec<[ExprId; 4]>,
}

impl<'f> Collector<'f, '_> {
    fn push(
        &mut self,
        site: ReferenceSite,
        pos: u32,
        name: Atom,
        flags: ReferenceFlags,
        write: ExprId,
    ) {
        self.push_write(site, (pos, pos), name, flags, write);
    }

    /// `Referencer.visitPattern` creates the references for all of a pattern's names before it
    /// visits the defaults and computed keys in it. `at` is the name's position and the position
    /// it's visited at. The latter is stored in `from` until the references are sorted.
    fn push_write(
        &mut self,
        site: ReferenceSite,
        at: (u32, u32),
        name: Atom,
        flags: ReferenceFlags,
        write: ExprId,
    ) {
        let made = self.make(site, at, name, flags, write);
        self.found.push(made);
    }

    #[inline]
    fn make(
        &self,
        site: ReferenceSite,
        at: (u32, u32),
        name: Atom,
        flags: ReferenceFlags,
        write: ExprId,
    ) -> RawReference {
        RawReference {
            site,
            pos: at.0,
            name,
            variable: NONE,
            from: at.1,
            write: if write.is_some() {
                self.without_casts(write)
            } else {
                write
            },
            flags,
        }
    }

    /// To ESLint, `/** @type {T} */ (e)` in JavaScript is just `e` in parentheses.
    fn without_casts(&self, mut e: ExprId) -> ExprId {
        while self.file.is_javascript()
            && let Some(ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. }) =
                self.file.hir.exprs.get(e.idx()).map(|it| it.kind)
        {
            e = expr;
        }
        e
    }

    /// The right side, if the expression statement `s` is the left side of a `for`-`in` or
    /// `for`-`of`.
    fn iterated_by(&self, s: hir::StmtId) -> Option<ExprId> {
        let Parent::Stmt(owner) = self.file.bound.parent_of_stmt(s) else {
            return None;
        };
        match self.file.hir.stmts.get(owner.idx())?.kind {
            StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. }
                if left == s =>
            {
                Some(expr)
            }
            _ => None,
        }
    }

    /// `Referencer.AssignmentExpression`, `UpdateExpression`, `visitForIn` and `PatternVisitor`,
    /// seen from the identifier `e`.
    fn access(&self, e: ExprId, values: &mut SmallVec<[ExprId; 4]>) -> Access {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        values.clear();
        let mut at = e;
        // The number of `a!`, `a as T`, `<T>a` and `a satisfies T` wrappers since the last part of a pattern.
        let (mut wrappers, mut has_satisfies) = (0, false);
        // One bit per entry in `values`: set if it can be a standalone assignment. Any of them can
        // be a default in a pattern.
        let mut is_assignment = 0u32;
        // The target of each entry in `values`.
        let mut targets: SmallVec<[ExprId; 4]> = SmallVec::new();
        let mut iterated = None;
        loop {
            match bound.parent_of_expr(at) {
                Parent::Expr(parent) => {
                    match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                        Some(ExprKind::Assign {
                            op: None,
                            target,
                            value,
                        }) if target == at => {
                            // typescript-estree doesn't turn a parenthesized literal into a pattern.
                            let is_literal_in_parentheses = !self.is_javascript
                                && matches!(
                                    hir.exprs.get(at.idx()).map(|it| it.kind),
                                    Some(ExprKind::Array(_) | ExprKind::Object(_))
                                )
                                && hir.parens.binary_search_by_key(&at.0, |it| it.0.0).is_ok();
                            // `visitExpressionTarget` looks through one wrapper.
                            if wrappers <= 1
                                && !has_satisfies
                                && !is_literal_in_parentheses
                                && values.len() < 32
                            {
                                is_assignment |= 1 << values.len();
                            }
                            values.push(value);
                            targets.push(at);
                            (at, wrappers, has_satisfies) = (parent, 0, false);
                        }
                        Some(ExprKind::Assign {
                            op: Some(_),
                            target,
                            value,
                        }) if target == at && values.is_empty() && self.is_identifier(at, e) => {
                            return Access::ReadWrite(value);
                        }
                        Some(ExprKind::Unary {
                            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                            ..
                        }) if values.is_empty() && self.is_identifier(at, e) => {
                            return Access::ReadWrite(ExprId::NONE);
                        }
                        Some(ExprKind::Array(_) | ExprKind::Spread(_)) => {
                            (at, wrappers, has_satisfies) = (parent, 0, false)
                        }
                        Some(ExprKind::As { .. } | ExprKind::Satisfies { .. })
                            if self.file.is_javascript() =>
                        {
                            at = parent
                        }
                        Some(ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_)) => {
                            (at, wrappers) = (parent, wrappers + 1);
                        }
                        Some(ExprKind::Satisfies { .. }) => {
                            (at, wrappers, has_satisfies) = (parent, wrappers + 1, true);
                        }
                        _ => break,
                    }
                }
                Parent::Prop(p) => {
                    let owner = bound
                        .prop_owner
                        .get(p.idx())
                        .copied()
                        .unwrap_or(ExprId::NONE);
                    let is_part_of_pattern = matches!(
                        hir.props.get(p.idx()).map(|it| it.kind),
                        Some(PropKind::Init | PropKind::Shorthand | PropKind::Spread)
                    ) && matches!(
                        hir.exprs.get(owner.idx()).map(|it| it.kind),
                        Some(ExprKind::Object(_))
                    );
                    if !is_part_of_pattern {
                        break;
                    }
                    (at, wrappers, has_satisfies) = (owner, 0, false);
                }
                Parent::Stmt(s) => {
                    iterated = self.iterated_by(s);
                    break;
                }
                _ => break,
            }
        }
        while iterated.is_none()
            && let Some(last) = values.len().checked_sub(1)
            && (last >= 32 || is_assignment & (1 << last) == 0)
        {
            values.pop();
            targets.pop();
        }
        let pattern = if iterated.is_some() {
            Some(&at)
        } else {
            targets.last()
        };
        let literal = pattern
            .and_then(|it| hir.exprs.get(it.idx()))
            .filter(|it| matches!(it.kind, ExprKind::Array(_) | ExprKind::Object(_)));
        let start = literal
            .or_else(|| hir.exprs.get(e.idx()))
            .map_or(0, |it| it.pos);
        let is_in_pattern = literal.is_some() || iterated.is_some();
        // So far the values are innermost first. All but the outermost are defaults, which ESLint
        // lists outermost first, before the value itself.
        match (iterated, values.len()) {
            (Some(iterated), _) => {
                values.reverse();
                values.push(iterated);
            }
            (None, 0) => return Access::Read,
            (None, len) => {
                values[..len - 1].reverse();
            }
        }
        Access::Write {
            start,
            is_in_pattern,
        }
    }

    /// True if `at` is `e`, or `e` inside a wrapper that `visitExpressionTarget` looks through.
    fn is_identifier(&self, at: ExprId, e: ExprId) -> bool {
        at == e
            || matches!(
                self.file.hir.exprs.get(at.idx()).map(|it| it.kind),
                Some(ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr)) if expr == e
            )
    }

    /// The closing tags, which `eslint-scope` doesn't visit. Before ESLint 10 it doesn't visit any tags. Sorted.
    fn unvisited_tags(&self) -> Vec<ExprId> {
        let hir = &self.file.hir;
        let mut skipped: Vec<ExprId> = Vec::new();
        if self.is_javascript && !self.file.has_oxc_scopes() {
            let skips_opening_tags = self.file.language().eslint_major < 10;
            for jsx in hir.jsx {
                let tags = [Some(jsx.close_tag), skips_opening_tags.then_some(jsx.tag)];
                for mut at in tags.into_iter().flatten() {
                    while let Some(ExprKind::Dot { obj, .. }) =
                        hir.exprs.get(at.idx()).map(|it| it.kind)
                    {
                        at = obj;
                    }
                    skipped.push(at);
                }
            }
            skipped.sort_unstable();
        }
        skipped
    }

    /// The names in the operands of `typeof` in types. The parser stores them after the rest.
    fn type_query_operands(&mut self) {
        let file = self.file;
        for &id in file.bound.type_query_operands {
            if let Some(e) = file.hir.exprs.get(id.idx())
                && let ExprKind::Ident(name) = e.kind
                && !matches!(file.bound.parent_of_expr(id), Parent::None)
                && name != known::empty
                && !(file.has_synthetic_nodes() && file.is_in_jsdoc(e.pos))
            {
                self.push(ReferenceSite::Expr(id), e.pos, name, READ, ExprId::NONE);
            }
        }
    }

    /// The positions of the first entries in `found` and `type_names` that haven't been passed on.
    #[inline]
    fn next_found(&self, merge: &Merge) -> (u32, u32) {
        let (found, type_name) = (
            self.found.get(merge.passed),
            self.type_names.get(merge.passed_type_names),
        );
        (
            found.map_or(u32::MAX, |it| it.pos),
            type_name.map_or(u32::MAX, |it| (it >> 32) as u32),
        )
    }

    /// Passes on the entries of `found` and `type_names` before `pos`, in source order.
    #[inline(never)]
    fn pass_on_before(&self, pos: u32, merge: &mut Merge) {
        let hir = &self.file.hir;
        loop {
            let (found, type_name) = self.next_found(merge);
            merge.next_found = found.min(type_name);
            if merge.next_found >= pos {
                return;
            }
            if found <= type_name {
                if let Some(before) = self.found.get(merge.passed) {
                    merge.into.add(*before);
                }
                merge.passed += 1;
                continue;
            }
            let id = (self.type_names.get(merge.passed_type_names))
                .map_or(hir::TypeNodeId::NONE, |&it| hir::TypeNodeId(it as u32));
            if let Some(TypeNodeKind::Ref { name, .. }) = hir.types.get(id.idx()).map(|it| it.kind)
                && let Some(first) = hir.names.get(name.start as usize)
            {
                merge.into.add_type_name(id, type_name, first.text);
            }
            merge.passed_type_names += 1;
        }
    }

    /// True if an identifier's surroundings are enough to tell that it's a reference that reads a
    /// value.
    #[inline(never)]
    fn is_only_read(&self, id: ExprId) -> bool {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        match bound.parent_of_expr(id) {
            Parent::Expr(parent) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                None | Some(ExprKind::Jsx(_)) => false,
                Some(ExprKind::Assign { target, .. }) => target != id,
                Some(ExprKind::Unary { op, .. }) => !matches!(
                    op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                ),
                Some(kind) if can_be_part_of_target(kind) => match bound.parent_of_expr(parent) {
                    Parent::Expr(grandparent) => hir
                        .exprs
                        .get(grandparent.idx())
                        .is_some_and(|it| !can_be_part_of_target(it.kind)),
                    Parent::None | Parent::Prop(_) | Parent::Stmt(_) => false,
                    _ => true,
                },
                Some(_) => true,
            },
            Parent::Stmt(s) => !matches!(
                hir.stmts.get(s.idx()).map(|it| it.kind),
                None | Some(
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) | StmtKind::Expr(_)
                )
            ),
            // The value of a property in an object literal that's an argument, a return value or a
            // variable's initializer. Or an attribute's value.
            Parent::Prop(p) => {
                let owner = bound
                    .prop_owner
                    .get(p.idx())
                    .copied()
                    .unwrap_or(ExprId::NONE);
                match bound.parent_of_expr(owner) {
                    Parent::Expr(owner_parent) => matches!(
                        hir.exprs.get(owner_parent.idx()).map(|it| it.kind),
                        Some(ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Jsx(_))
                    ),
                    Parent::Stmt(s) => matches!(
                        hir.stmts.get(s.idx()).map(|it| it.kind),
                        Some(StmtKind::Return(_))
                    ),
                    Parent::VarInit(_) | Parent::FnBody(_) | Parent::MemberInit(_) => true,
                    _ => false,
                }
            }
            Parent::None => false,
            _ => true,
        }
    }

    /// Passes on the references for the identifier `e`, after the entries of `found` (which is
    /// sorted) that come before it. Returns false without doing anything if it's before the last
    /// identifier.
    #[inline(never)]
    fn identifier(
        &self,
        id: ExprId,
        e: &hir::Expr,
        name: Atom,
        skipped: &[ExprId],
        merge: &mut Merge,
    ) -> bool {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let (mut flags, mut is_reference) = (READ, true);
        let access = match bound.parent_of_expr(id) {
            Parent::None => return true,
            Parent::Expr(parent) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                Some(
                    ExprKind::Assign { .. }
                    | ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        ..
                    }
                    | ExprKind::Array(_)
                    | ExprKind::Spread(_)
                    | ExprKind::As { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::NonNull(_)
                    | ExprKind::Satisfies { .. },
                ) => self.access(id, &mut merge.values),
                Some(ExprKind::Jsx(jsx)) => {
                    let is_tag = hir
                        .jsx
                        .get(jsx.idx())
                        .is_some_and(|it| it.tag == id || it.close_tag == id);
                    is_reference = !is_tag || is_component_name(file.atoms.bytes(name));
                    Access::Read
                }
                _ => Access::Read,
            },
            Parent::Prop(_) => self.access(id, &mut merge.values),
            Parent::Stmt(s) => match hir.stmts.get(s.idx()).map(|it| it.kind) {
                // "this could be a type or a variable"
                Some(StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_))
                    if !self.is_javascript =>
                {
                    flags |= ReferenceFlags::TYPE;
                    Access::Read
                }
                Some(StmtKind::Expr(_)) => self.access(id, &mut merge.values),
                _ => Access::Read,
            },
            _ => Access::Read,
        };
        let operands = bound.type_query_operands;
        if id.0 >= merge.next_operand {
            merge.next_operand = operands
                .get(operands.partition_point(|it| it.0 <= id.0))
                .map_or(u32::MAX, |it| it.0);
        }
        is_reference &= skipped.is_empty() || skipped.binary_search(&id).is_err();
        if name == known::empty
            || (!operands.is_empty() && operands.binary_search(&id).is_ok())
            || (file.has_synthetic_nodes() && file.is_in_jsdoc(e.pos))
        {
            return true;
        }
        if e.pos < merge.last {
            return false;
        }
        if e.pos >= merge.next_jsdoc {
            let comments = hir.jsdoc_comments;
            merge.next_jsdoc = comments
                .get(comments.partition_point(|it| it.0 <= e.pos))
                .map_or(u32::MAX, |it| it.0);
        }
        merge.last = e.pos;
        self.pass_on_before(e.pos, merge);
        if !is_reference {
            merge.into.add_name(id, e.pos, name);
            return true;
        }
        let (site, here) = (ReferenceSite::Expr(id), (e.pos, e.pos));
        match access {
            Access::Read if flags == READ => merge.into.add_read(id, e.pos, name),
            Access::Read => merge
                .into
                .add(self.make(site, here, name, flags, ExprId::NONE)),
            Access::ReadWrite(value) => {
                merge
                    .into
                    .add(self.make(site, here, name, READ | WRITE, value))
            }
            Access::Write { start, .. } => {
                for &value in &merge.values {
                    merge
                        .into
                        .add(self.make(site, (e.pos, start), name, WRITE, value));
                }
            }
        }
        true
    }

    /// Returns all the references, in source order and resolved. `found` must be sorted.
    fn merge<'t>(&self, tree: &'t ScopeTree, variables: &'t Variables) -> Resolver<'t>
    where
        'f: 't,
    {
        let exprs = self.file.hir.exprs;
        let exprs = if exprs.len() < COUNT as usize {
            exprs
        } else {
            &[]
        };
        let skipped = self.unvisited_tags();
        let start = || Merge {
            into: Resolver::new(
                self.file,
                tree,
                variables,
                exprs.len() / 3 + self.found.len() + self.type_names.len(),
            ),
            passed: 0,
            passed_type_names: 0,
            // Before the first of them.
            next_found: 0,
            last: 0,
            next_jsdoc: self
                .file
                .hir
                .jsdoc_comments
                .first()
                .map_or(u32::MAX, |it| it.0),
            next_operand: self
                .file
                .bound
                .type_query_operands
                .first()
                .map_or(u32::MAX, |it| it.0),
            values: SmallVec::new(),
        };
        let mut merge = start();
        let is_simple = merge.into.is_plain && skipped.is_empty();
        // Which expressions are identifiers, if the binder recorded the kinds.
        const IDENT: u8 = 2 * hir::ExprTag::Ident as u8;
        let (kinds, bound) = (self.file.bound.expr_kinds, &self.file.bound);
        // They're already grouped if the groups are built from these kinds. Where the binder didn't
        // record them, any expression could be one.
        let is_grouped =
            self.file.uses_binder_expr_kinds() && exprs.len() == self.file.hir.exprs.len();
        let not_grouped: Vec<u32> = match is_grouped {
            true => Vec::new(),
            false => (0..exprs.len() as u32)
                .filter(|&i| kinds.get(i as usize).is_none_or(|kind| *kind == IDENT))
                .collect(),
        };
        let identifiers = match is_grouped {
            true => self.file.exprs_of(hir::ExprTag::Ident),
            false => &not_grouped[..],
        };
        debug_assert!(
            !is_grouped
                || (identifiers.iter().copied()).eq((0u32..)
                    .zip(kinds)
                    .filter(|it| *it.1 == IDENT)
                    .map(|it| it.0))
        );
        // Returns false if the expression at `i` is an identifier that comes before the previous one.
        let take = |i: usize| {
            let Some(e) = exprs.get(i) else {
                return true;
            };
            let ExprKind::Ident(name) = e.kind else {
                return true;
            };
            let id = ExprId(i as u32);
            // In most positions an identifier can only be a value that's read.
            let is_only_read = match bound.parent_of_expr(id) {
                Parent::Expr(parent) => exprs.get(parent.idx()).is_some_and(|it| {
                    !can_be_part_of_target(it.kind)
                        && !matches!(it.kind, ExprKind::Unary { .. } | ExprKind::Jsx(_))
                }),
                Parent::None | Parent::Prop(_) | Parent::Stmt(_) => false,
                _ => true,
            };
            if is_simple
                && (merge.last..merge.next_jsdoc).contains(&e.pos)
                && id.0 < merge.next_operand
                && name != known::empty
                && (is_only_read || self.is_only_read(id))
            {
                if merge.next_found < e.pos {
                    self.pass_on_before(e.pos, &mut merge);
                }
                merge.last = e.pos;
                merge.into.add_simple_read(id, e.pos, name);
                return true;
            }
            self.identifier(id, e, name, &skipped, &mut merge)
        };
        // The parser stores nearly every file in source order.
        let is_in_order = identifiers.iter().map(|&i| i as usize).all(take);
        if !is_in_order {
            merge = start();
            let identifiers = exprs
                .iter()
                .enumerate()
                .filter(|it| matches!(it.1.kind, ExprKind::Ident(_)));
            let mut in_order: Vec<u64> = identifiers
                .map(|(i, e)| u64::from(e.pos) << 32 | i as u64)
                .collect();
            in_order.sort();
            for key in in_order {
                if let Some(e) = exprs.get(key as u32 as usize)
                    && let ExprKind::Ident(name) = e.kind
                {
                    self.identifier(ExprId(key as u32), e, name, &skipped, &mut merge);
                }
            }
        }
        self.pass_on_before(u32::MAX, &mut merge);
        merge.into
    }

    /// `Referencer.VariableDeclaration`, `visitFunction`, `CatchClause`: a declaration writes the
    /// values it gives to its names.
    fn patterns(&mut self, tree: &ScopeTree, deep_patterns: &DeepPatterns) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let mut values: SmallVec<[ExprId; 4]> = SmallVec::new();
        for (i, pat) in hir.pats.iter().enumerate() {
            let PatKind::Ident(name) = pat.kind else {
                continue;
            };
            // Nothing is written to a plain parameter.
            if let Some(&PatParent::Param(p)) = bound.pat_parent.get(i)
                && hir
                    .params
                    .get(p.idx())
                    .is_some_and(|it| it.default.is_none())
            {
                continue;
            }
            values.clear();
            // Innermost first.
            let (mut at, mut steps) = (hir::PatId(i as u32), 0);
            let root = loop {
                // Nothing up to there has a default value.
                if steps >= DeepPatterns::PLAIN_STEPS
                    && let Some(above) = deep_patterns.get(at)
                {
                    at = above.with_default.some().unwrap_or(above.top);
                }
                let (outer, default) = match bound.pat_parent.get(at.idx()) {
                    Some(&PatParent::Prop(outer, p)) => {
                        (outer, hir.pat_props.get(p.idx()).map(|it| it.default))
                    }
                    Some(&PatParent::Elem(outer, e)) => {
                        (outer, hir.pat_elems.get(e.idx()).map(|it| it.default))
                    }
                    Some(&root) => break root,
                    None => break PatParent::None,
                };
                values.extend(default.filter(|it| it.is_some()));
                (at, steps) = (outer, steps + 1);
            };
            let mut last = ExprId::NONE;
            match root {
                PatParent::Var(d) => {
                    let Some(declaration) = hir.var_decls.get(d.idx()) else {
                        continue;
                    };
                    values.reverse();
                    values.extend(declaration.init.some());
                    if let Some(&statement) = bound.var_stmt.get(d.idx())
                        && !matches!(
                            bound.parent_of_stmt(statement),
                            Parent::FnBody(_) | Parent::File
                        )
                    {
                        last = self.iterated_by(statement).unwrap_or(ExprId::NONE);
                    }
                }
                PatParent::Param(p) => {
                    let function = bound
                        .param_fn
                        .get(p.idx())
                        .copied()
                        .unwrap_or(hir::FnId::NONE);
                    let scope = tree
                        .scope_of_fn
                        .get(function.idx())
                        .and_then(|&it| tree.scopes.get(it as usize));
                    if scope.is_none_or(|it| it.kind != ScopeKind::Function) {
                        continue;
                    }
                    // typescript-estree drops the initializer of a rest parameter, which is an error.
                    let param = hir
                        .params
                        .get(p.idx())
                        .filter(|it| !it.flags.contains(hir::Flags::REST));
                    values.extend(param.and_then(|it| it.default.some()));
                    values.reverse();
                }
                _ => continue,
            }
            if file.has_synthetic_nodes() && file.is_in_jsdoc(pat.pos) {
                continue;
            }
            let (site, flags) = (
                ReferenceSite::Pat(hir::PatId(i as u32)),
                WRITE | ReferenceFlags::INIT,
            );
            let (start, end) = hir
                .pats
                .get(at.idx())
                .map_or((pat.pos, pat.pos), |it| (it.pos, it.end));
            for &value in &values {
                self.push_write(site, (pat.pos, start), name, flags, value);
            }
            // `visitForIn` visits the declaration first, and then its names again.
            if last.is_some() {
                self.push_write(site, (pat.pos, end.max(pat.pos)), name, flags, last);
            }
        }
    }

    /// `TypeVisitor`
    fn types(&mut self, tree: &ScopeTree) {
        let file = self.file;
        let (hir, bound) = (&file.hir, &file.bound);
        let start = self.found.len();
        for (i, ty) in hir.types.iter().enumerate() {
            let id = hir::TypeNodeId(i as u32);
            match ty.kind {
                _ if file.has_synthetic_nodes() && file.is_in_jsdoc(ty.pos) => {}
                TypeNodeKind::Ref { name, .. }
                    if bound.type_scope.get(i).is_some_and(|it| it.is_some()) =>
                {
                    if let Some(first) = hir
                        .names
                        .get(name.start as usize)
                        .filter(|_| !name.is_empty())
                    {
                        self.type_names
                            .push(u64::from(first.pos()) << 32 | i as u64);
                    }
                }
                TypeNodeKind::Predicate { param, asserts, .. }
                    if param != known::this
                        && bound.type_scope.get(i).is_some_and(|it| it.is_some()) =>
                {
                    let pos = match asserts {
                        true => {
                            crate::tokens::skip_trivia(hir.text, ty.pos + "asserts".len() as u32)
                        }
                        false => ty.pos,
                    };
                    self.push(ReferenceSite::Predicate(id), pos, param, READ, ExprId::NONE);
                }
                _ => {}
            }
        }
        // A type is stored after its parts.
        sort_by_pos(&mut self.found[start..]);
        sort_nearly_sorted(&mut self.type_names);
        for &id in &tree.namespace_exports {
            if let Some(stmt) = hir.stmts.get(id.idx())
                && let StmtKind::ExportAsNamespace(name) = stmt.kind
            {
                let mut pos = stmt.start;
                for keyword in ["export", "as", "namespace"] {
                    pos = crate::tokens::skip_trivia(hir.text, pos + keyword.len() as u32);
                }
                self.push(
                    ReferenceSite::ExportAsNamespace(id),
                    pos,
                    name,
                    READ,
                    ExprId::NONE,
                );
            }
        }
        for (i, import) in hir.import_equals.iter().enumerate() {
            if let hir::ImportEqualsTarget::Entity(names) = import.target
                && let Some(first) = hir
                    .names
                    .get(names.start as usize)
                    .filter(|_| !names.is_empty())
            {
                let site = ReferenceSite::ImportEquals(hir::ImportEqualsId(i as u32));
                self.push(site, first.pos(), first.text, READ, ExprId::NONE);
            }
        }
    }

    /// `visitJSXElement`, for the tags that aren't expressions outside JSX.
    fn jsx_names(&mut self) {
        let file = self.file;
        // `eslint-scope` supports them since ESLint 10.
        if self.is_javascript && file.language().eslint_major < 10 {
            return;
        }
        let start = self.found.len();
        for jsx in file.hir.jsx {
            // `eslint-scope` doesn't visit closing elements.
            let tags = [
                Some(jsx.tag),
                (!self.is_javascript).then_some(jsx.close_tag),
            ];
            for tag in tags.into_iter().flatten() {
                let (name, pos) = match file.hir.exprs.get(tag.idx()) {
                    Some(hir::Expr {
                        kind: ExprKind::String(name),
                        pos,
                        ..
                    }) => (name, pos),
                    // "the only case we want to visit a lower-cased component has its name as "this""
                    Some(hir::Expr {
                        kind: ExprKind::This,
                        pos,
                        ..
                    }) if !self.is_javascript => {
                        self.push(
                            ReferenceSite::JsxName(tag),
                            *pos,
                            known::this,
                            READ,
                            ExprId::NONE,
                        );
                        continue;
                    }
                    _ => continue,
                };
                let text = file.atoms.bytes(*name);
                match bun_core::strings::index_of_char_usize(text, b':') {
                    // `eslint-scope` doesn't treat a namespaced name as a component.
                    Some(_) if self.is_javascript => {}
                    Some(colon) => {
                        let parts = [(0, &text[..colon]), (colon + 1, &text[colon + 1..])];
                        for (offset, part) in parts {
                            let part = file.atoms.intern(part);
                            self.push(
                                ReferenceSite::JsxName(tag),
                                pos + offset as u32,
                                part,
                                READ,
                                ExprId::NONE,
                            );
                        }
                    }
                    None if is_component_name(text) => {
                        self.push(ReferenceSite::JsxName(tag), *pos, *name, READ, ExprId::NONE);
                    }
                    None => {}
                }
            }
        }
        sort_by_pos(&mut self.found[start..]);
    }

    /// `ExportVisitor`
    fn export_specifiers(&mut self) {
        let hir = &self.file.hir;
        for (i, spec) in hir.export_specs.iter().enumerate() {
            let Some(export) = hir.exports.get(spec.export.idx()) else {
                continue;
            };
            let is_bound = self.file.bound.parent_of_stmt(export.stmt) != Parent::None;
            // The name can be a string only before `from`.
            if export.has_module_specifier || !is_bound || spec.local.is_none() {
                continue;
            }
            let flags = match (self.is_javascript, export.type_only || spec.type_only) {
                (true, _) => READ,
                (false, true) => ReferenceFlags::READ | ReferenceFlags::TYPE,
                (false, false) => READ | ReferenceFlags::TYPE,
            };
            let site = ReferenceSite::ExportSpec(hir::ExportSpecId(i as u32));
            self.push(site, spec.local_pos, spec.local, flags, ExprId::NONE);
        }
    }

    /// `Referencer.referenceJsxPragma`, `referenceJsxFragment`: "Searches for a variable named
    /// "name" in the upper scopes and adds a pseudo-reference from itself to itself".
    fn jsx_pragmas(&mut self, tree: &ScopeTree, variables: &Variables) {
        let file = self.file;
        let language = file.language();
        let names = [
            (&language.jsx_pragma, false),
            (&language.jsx_fragment_name, true),
        ];
        for (name, only_fragments) in names {
            let Some(name) = name else {
                continue;
            };
            let name = file.atoms.intern(name);
            let mut elements: Vec<u32> = (file.hir.exprs.iter().enumerate())
                .filter(|(i, e)| {
                    matches!(e.kind, ExprKind::Jsx(jsx)
                        if !only_fragments || file.hir.jsx.get(jsx.idx()).is_some_and(|it| it.tag.is_none()))
                        && !matches!(file.bound.parent_of_expr(hir::ExprId(*i as u32)), Parent::None)
                })
                .map(|(_, e)| e.pos)
                .collect();
            elements.sort_unstable();
            // A class's name is declared before its decorators are visited, even though they come
            // before it in the source.
            let classes = file.hir.classes.iter().filter(|it| it.name == name);
            let mut decorators: Vec<(u32, u32)> =
                classes.map(|it| (it.start, it.name_pos)).collect();
            decorators.sort_unstable();
            let is_in_decorators = |pos: u32| {
                let after = decorators.partition_point(|it| it.0 <= pos);
                let class = after.checked_sub(1).and_then(|at| decorators.get(at));
                class.is_some_and(|it| pos < it.1)
            };
            // `Some(None)` is the variable that a class declaration has for its name in its own scope.
            let found = elements.iter().find_map(|&pos| {
                let mut scope = tree.scope_at(pos);
                while let Some(data) = tree.scopes.get(scope as usize) {
                    // It's in its scope's `set` from the point where the Referencer has visited its declaration.
                    let declared = |index: &u32| {
                        variables.list[*index as usize].first_pos < pos || is_in_decorators(pos)
                    };
                    let variable = variables.get(scope, name);
                    if let Some(index) = variable.filter(declared) {
                        return Some(Some((index, pos)));
                    }
                    if variable.is_none()
                        && let scopes::Block::Class(class) = data.block
                        && let Some(class) = file.hir.classes.get(class.idx())
                        && class.name == name
                    {
                        return Some(None);
                    }
                    scope = data.parent;
                }
                None
            });
            if let Some(Some((index, element))) = found {
                let pos = variables.list[index as usize].first_pos;
                self.push_write(
                    ReferenceSite::Declaration(index),
                    (pos, element),
                    name,
                    READ,
                    ExprId::NONE,
                );
            }
        }
    }
}

/// True if `PatternVisitor` visits `e`, i.e. a destructuring pattern, a `for`-`in` or a `for`-`of`
/// assigns to it.
pub(super) fn is_in_pattern(file: &File, e: ExprId) -> bool {
    let collector = Collector {
        file,
        is_javascript: scopes::is_javascript_mode(file),
        found: Vec::new(),
        type_names: Vec::new(),
    };
    matches!(
        collector.access(e, &mut SmallVec::new()),
        Access::Write {
            is_in_pattern: true,
            ..
        }
    )
}

/// True if a direct child of an expression of this kind can be an assignment target.
#[inline(always)]
fn can_be_part_of_target(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Assign { .. }
            | ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            }
            | ExprKind::Array(_)
            | ExprKind::Spread(_)
            | ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Satisfies { .. }
    )
}

/// `name[0].toUpperCase() === name[0]`
fn is_component_name(name: &[u8]) -> bool {
    match name.first() {
        Some(first) if first.is_ascii() => !first.is_ascii_lowercase(),
        _ => match bstr::ByteSlice::chars(name).next() {
            Some(first) => first.to_uppercase().eq([first]),
            None => false,
        },
    }
}

/// The key that `group_by` groups by.
#[derive(Copy, Clone)]
enum Key {
    /// `RawReference::variable`, or this value if it's unresolved.
    Variable(usize),
    /// `RawReference::from`
    Scope,
}

/// Groups `all` by `key`. Returns the indices group by group, and the start of each group. `counts`
/// has the size of each group, at the index after its key. Within a group they're in `order`, which
/// is empty to mean `all`'s order.
fn group_by(
    all: &[RawReference],
    order: &[u32],
    mut counts: Vec<u32>,
    key: Key,
) -> (Vec<u32>, Vec<u32>) {
    for i in 1..counts.len() {
        counts[i] += counts[i - 1];
    }
    let mut next = counts.clone();
    let mut indices = vec![0u32; all.len()];
    let key = |it: &RawReference| match key {
        Key::Variable(unresolved) => (it.variable as usize).min(unresolved),
        Key::Scope => it.from as usize,
    };
    let mut push_to_group = |i: u32, it: &RawReference| {
        let slot = &mut next[key(it)];
        indices[*slot as usize] = i;
        *slot += 1;
    };
    match order.is_empty() {
        true => (0..).zip(all).for_each(|(i, it)| push_to_group(i, it)),
        false => order
            .iter()
            .for_each(|&i| push_to_group(i, &all[i as usize])),
    }
    (indices, counts)
}

impl References {
    pub(crate) fn new<'a>(
        file: &'a File<'a>,
        tree: &ScopeTree,
        variables: &Variables,
    ) -> References {
        let hir = &file.hir;
        let is_javascript = scopes::is_javascript_mode(file);
        let mut collector = Collector {
            file,
            is_javascript,
            found: Vec::with_capacity(hir.pats.len() / 2),
            type_names: Vec::with_capacity(hir.types.len() / 2),
        };
        collector.patterns(tree, &variables.deep_patterns);
        collector.type_query_operands();
        collector.export_specifiers();
        if !hir.jsx.is_empty() {
            collector.jsx_names();
        }
        if !is_javascript {
            collector.types(tree);
            if !hir.jsx.is_empty() {
                collector.jsx_pragmas(tree, variables);
            }
        }
        // Each part is already nearly sorted. References at the same position keep their order.
        sort_by_pos(&mut collector.found);
        // More wouldn't fit next to the marks in `Resolver::counts`.
        let found = collector.found.len() + collector.type_names.len();
        if hir.exprs.len() + found >= COUNT as usize {
            collector.found.clear();
            collector.type_names.clear();
        }
        let Resolver {
            all,
            expr_variables,
            mut counts,
            mut moved,
            is_visiting_order,
            moved_on_demand,
            ..
        } = collector.merge(tree, variables);
        let marks = counts.iter().skip(1).map(|it| it & !COUNT).collect();
        counts.iter_mut().for_each(|it| *it &= COUNT);
        let mut visiting_order: Vec<u32> = Vec::new();
        if !is_visiting_order {
            let mut visits: Vec<u32> = all.iter().map(|it| it.pos).collect();
            moved
                .iter()
                .for_each(|&(index, visit)| visits[index as usize] = visit);
            visiting_order.extend(0..all.len() as u32);
            crate::utils::sort::sort_indices(&mut visiting_order, &mut |a, b| {
                visits[a as usize].cmp(&visits[b as usize])
            });
        }

        moved.extend(moved_on_demand);

        let key = Key::Variable(variables.list.len());
        let (by_variable, variable_starts) = group_by(&all, &visiting_order, counts, key);
        References {
            all,
            visiting_order,
            moved,
            in_creation_order: OnceCell::new(),
            by_variable,
            variable_starts,
            marks,
            expr_variables,
            by_scope: OnceCell::new(),
            by_scope_in_some_order: OnceCell::new(),
            scope_count: tree.scopes.len(),
            unresolved_by_name: OnceCell::new(),
        }
    }

    fn group<'t>(indices: &'t [u32], starts: &[u32], from: usize, to: usize) -> &'t [u32] {
        match (starts.get(from), starts.get(to + 1)) {
            (Some(&start), Some(&end)) => indices
                .get(start as usize..end as usize)
                .unwrap_or_default(),
            _ => &[],
        }
    }

    /// The references to the variable at `index` in `Variables::list`.
    #[inline]
    pub(crate) fn of_variable(&self, index: u32) -> &[u32] {
        Self::group(
            &self.by_variable,
            &self.variable_starts,
            index as usize,
            index as usize,
        )
    }

    /// The index in `Variables::list` of the value that the identifier `e` resolves to.
    #[inline]
    pub(crate) fn variable_of_expr(&self, e: ExprId) -> Option<u32> {
        self.expr_variables
            .get(e.idx())
            .copied()
            .filter(|it| *it != NONE)
    }

    /// Indices into `all`, with each destructuring pattern's names before everything else in it.
    /// Empty if that's `all`'s order.
    #[inline]
    pub(crate) fn visiting_order(&self) -> &[u32] {
        &self.visiting_order
    }

    /// Indices into `all` in the order the scope manager creates the references. Empty if that's `all`'s order.
    pub(crate) fn in_creation_order<'a>(&self, file: &'a File<'a>) -> &[u32] {
        let made = self
            .in_creation_order
            .get_or_init(|| order::in_creation_order(file, &self.all, &self.moved));
        made.as_deref().unwrap_or(&self.visiting_order)
    }

    /// True if the variable at `index` in `Variables::list` has one of `marks`.
    #[inline]
    pub(crate) fn has_mark(&self, index: u32, marks: u32) -> bool {
        self.marks
            .get(index as usize)
            .is_some_and(|it| it & marks != 0)
    }

    #[inline]
    pub(crate) fn unresolved(&self) -> &[u32] {
        let last = self.variable_starts.len().saturating_sub(2);
        Self::group(&self.by_variable, &self.variable_starts, last, last)
    }

    /// The unresolved references to `name`.
    pub(crate) fn unresolved_named(&self, name: Atom) -> &[u32] {
        let sorted = self.unresolved_by_name.get_or_init(|| {
            // The name and the list index are packed into one number. That way references with the
            // same name keep their order, and this `u64` sort is already compiled for other lists.
            let unresolved = self.unresolved();
            let keys = unresolved.iter().enumerate();
            let keys =
                keys.map(|(at, &it)| (u64::from(self.all[it as usize].name.0) << 32) | at as u64);
            let mut keys: Vec<u64> = keys.collect();
            keys.sort();
            keys.iter()
                .map(|&key| unresolved[key as u32 as usize])
                .collect()
        });
        let start = sorted.partition_point(|&it| self.all[it as usize].name.0 < name.0);
        let len = sorted[start..].partition_point(|&it| self.all[it as usize].name == name);
        &sorted[start..start + len]
    }

    /// `by_scope`, in `order`.
    fn group_by_scope(&self, order: &[u32]) -> (Vec<u32>, Vec<u32>) {
        let mut counts = vec![0u32; self.scope_count + 1];
        self.all
            .iter()
            .for_each(|it| counts[it.from as usize + 1] += 1);
        group_by(&self.all, order, counts, Key::Scope)
    }

    /// The references in the scopes `first..=last`, with each scope's in creation order.
    #[inline]
    pub(crate) fn in_scopes<'a>(&self, file: &'a File<'a>, first: u32, last: u32) -> &[u32] {
        let (by_scope, starts) = self
            .by_scope
            .get_or_init(|| self.group_by_scope(self.in_creation_order(file)));
        Self::group(by_scope, starts, first as usize, last as usize)
    }

    /// Same, for callers that don't care about the order, which then isn't computed.
    #[inline]
    pub(crate) fn in_scopes_in_some_order(&self, first: u32, last: u32) -> &[u32] {
        let (by_scope, starts) = match self.by_scope.get() {
            Some(made) => made,
            None => self
                .by_scope_in_some_order
                .get_or_init(|| self.group_by_scope(&self.visiting_order)),
        };
        Self::group(by_scope, starts, first as usize, last as usize)
    }

    /// Same, in `visiting_order` order, regardless of what else has been requested.
    #[inline]
    pub(crate) fn in_scope_as_visited(&self, scope: u32) -> &[u32] {
        let (by_scope, starts) = self
            .by_scope_in_some_order
            .get_or_init(|| self.group_by_scope(&self.visiting_order));
        Self::group(by_scope, starts, scope as usize, scope as usize)
    }

    /// The first reference at `pos`.
    pub(crate) fn at(&self, pos: u32) -> Option<&RawReference> {
        self.all
            .get(self.all.partition_point(|it| it.pos < pos))
            .filter(|it| it.pos == pos)
    }
}
