//! Every occurrence of a name that refers to something: ESLint's `Reference`s.
//!
//! What is derived here: whether each is read or written, the scope it is in, what it resolves to,
//! and all of it grouped by variable and by scope.

use super::scopes::{self, Cursor, NONE, ScopeTree, Step};
use super::variables::{TYPE, VALUE, Variables};
use super::{ReferenceFlags, ScopeKind};
use crate::ast::File;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Parent, PatParent};
use bun_sema::hir::{self, ExprId, ExprKind, PatKind, PropKind, StmtKind, TypeNodeKind, UnOp};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// Where a reference is written.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum ReferenceSite {
    /// An identifier that is an expression.
    Expr(ExprId),
    /// The name of a declaration that gives it a value.
    Pat(hir::PatId),
    /// The first name of the entity name of a type reference.
    TypeName(hir::TypeNodeId),
    /// The `x` of `x is T`.
    Predicate(hir::TypeNodeId),
    /// The `a` of `import x = a.b`.
    ImportEquals(hir::ImportEqualsId),
    /// The `a` of `export { a }`.
    ExportSpec(hir::ExportSpecId),
    /// The `N` of `export as namespace N`.
    ExportAsNamespace(hir::StmtId),
    /// The tag `A-b`, or a part of the tag `a:b`, which the HIR stores as a string. The tag `this`.
    JsxName(ExprId),
    /// The name of the first declaration of the variable at this index, for the use that JSX makes
    /// of `React`.
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
    /// Indices into `all` in the order ESLint makes the references. Empty if that is the source
    /// order.
    visiting_order: Vec<u32>,
    /// Indices into `all`, variable by variable, in that order. After the last variable: what
    /// resolves to nothing.
    by_variable: Vec<u32>,
    /// For each variable, where its references start in `by_variable`. Two more than there are
    /// variables.
    variable_starts: Vec<u32>,
    /// For each variable: `HAS_READ`, `HAS_WRITE`, `HAS_MODIFYING_WRITE`.
    marks: Vec<u32>,
    /// For each expression that is an identifier, the index in `Variables::list` of the value that the
    /// name stands for where it is written.
    of_expr: Vec<u32>,
    /// Indices into `all`, scope by scope, in that order, and where those of each scope start.
    /// Computed on demand.
    by_scope: OnceCell<(Vec<u32>, Vec<u32>)>,
    scope_count: usize,
    /// What resolves to nothing, by name and then in that order. Computed on demand.
    unresolved_by_name: OnceCell<Vec<u32>>,
}

const READ: ReferenceFlags = ReferenceFlags::READ.union(ReferenceFlags::VALUE);
const WRITE: ReferenceFlags = ReferenceFlags::WRITE.union(ReferenceFlags::VALUE);

/// How an identifier that is an expression is used.
enum Access {
    Read,
    /// `a += value`, `a++`
    ReadWrite(ExprId),
    /// The values that are assigned to it are listed, in the order of ESLint's references. Where
    /// the pattern that it is part of starts.
    Write(u32),
}

/// Some reference to the variable reads it.
pub(crate) const HAS_READ: u32 = 1 << 29;
/// Some reference writes it.
pub(crate) const HAS_WRITE: u32 = 1 << 30;
/// Some reference writes it, other than its declaration.
pub(crate) const HAS_MODIFYING_WRITE: u32 = 1 << 31;
const COUNT: u32 = HAS_READ - 1;

struct Collector<'f, 'a> {
    file: &'f File<'a>,
    is_javascript: bool,
    /// All but the identifiers that are expressions.
    found: Vec<RawReference>,
}

/// What each name stands for at a position that goes through the file.
struct Visible<'t> {
    tree: &'t ScopeTree,
    variables: &'t Variables,
    /// For each `Variable::slot`: the variable of the innermost scope around the position that declares
    /// the name.
    innermost: Vec<u32>,
    /// For each variable of a scope around the position: what `innermost` had before.
    hidden: Vec<u32>,
    /// For each scope: the position is in a part of it that is evaluated in the scope around it.
    is_suspended: Vec<bool>,
    suspended: u32,
}

impl Visible<'_> {
    #[inline(never)]
    fn take(&mut self, step: Step) {
        match step {
            // `WithScope#__close` leaves every reference to the scope around it.
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

    /// `Variables::resolve` for a reference at `pos`, which is the position.
    #[inline(always)]
    fn resolve(&self, name: Atom, pos: u32, wants: u8) -> u32 {
        let mut index = self.innermost[self.variables.slot_of(name)];
        while let Some(it) = self.variables.list.get(index as usize) {
            if it.flags & wants != 0
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

/// Takes the references in source order, and finds the scope that each is in and what it resolves
/// to.
struct Resolver<'t> {
    variables: &'t Variables,
    visible: Visible<'t>,
    /// Ranges of the text in which nothing is a reference.
    unvisited: &'t [(u32, u32)],
    cursor: Cursor<'t>,
    all: Vec<RawReference>,
    /// `References::of_expr`
    of_expr: Vec<u32>,
    /// How many resolve to each variable, at the index after that of the variable. The last: to
    /// nothing. In the highest bits: `HAS_READ`, `HAS_WRITE`, `HAS_MODIFYING_WRITE`.
    counts: Vec<u32>,
    /// There are no `unvisited`.
    is_plain: bool,
    /// Those of `all` that are not visited where they are: the index, and the position that it is
    /// visited at.
    moved: Vec<(u32, u32)>,
    /// The last position among `moved`.
    last_moved_to: u32,
    /// So far the references are visited in the order of `all`.
    is_visiting_order: bool,
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
            of_expr: vec![NONE; file.hir.exprs.len()],
            counts: vec![0; variables.list.len() + 2],
            moved: Vec::new(),
            last_moved_to: 0,
            is_visiting_order: true,
            is_plain: scopes::is_javascript_mode(file) || tree.unvisited.is_empty(),
        }
    }

    /// The scope that what is written at `pos` belongs to. `pos` is not less than in the call before.
    #[inline(always)]
    fn go_to(&mut self, pos: u32) -> u32 {
        let visible = &mut self.visible;
        self.cursor.seek_by_steps(pos, |step| visible.take(step))
    }

    /// For an identifier that is an expression and no reference.
    fn add_name(&mut self, id: ExprId, pos: u32, name: Atom) {
        self.go_to(pos);
        if let Some(slot) = self.of_expr.get_mut(id.idx()) {
            *slot = self.visible.resolve(name, pos, VALUE);
        }
    }

    /// `add` for an identifier that is an expression and is read.
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

    /// The same where there is nothing `unvisited`.
    #[inline(always)]
    fn add_simple_read(&mut self, id: ExprId, pos: u32, name: Atom) {
        if pos < self.last_moved_to {
            self.is_visiting_order = false;
        }
        let from = self.go_to(pos);
        let variable = self.visible.resolve(name, pos, VALUE);
        let count = &mut self.counts[(variable as usize).min(self.variables.list.len()) + 1];
        *count = (*count + 1) | HAS_READ;
        if let Some(slot) = self.of_expr.get_mut(id.idx()) {
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

    /// `it.from`: see `Collector::push_write`.
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
        let last_visit = match self.moved.last() {
            Some(&(index, visit)) if index as usize + 1 == self.all.len() => visit,
            _ => self.all.last().map_or(0, |it| it.pos),
        };
        self.is_visiting_order &= it.from >= last_visit;
        if it.from != it.pos {
            self.moved.push((self.all.len() as u32, it.from));
            self.last_moved_to = self.last_moved_to.max(it.from);
        }
        it.from = self.go_to(it.pos);
        let wants = u8::from(it.flags.contains(ReferenceFlags::VALUE)) * VALUE
            + u8::from(it.flags.contains(ReferenceFlags::TYPE)) * TYPE;
        it.variable = match it.site {
            ReferenceSite::Declaration(index) => {
                it.from = self.variables.list[index as usize].scope;
                self.variables
                    .resolve(self.visible.tree, it.from, it.name, it.pos, wants)
                    .unwrap_or(NONE)
            }
            _ => self.visible.resolve(it.name, it.pos, wants),
        };
        if let ReferenceSite::Expr(e) = it.site
            && let Some(slot) = self.of_expr.get_mut(e.idx())
        {
            *slot = if wants == VALUE {
                it.variable
            } else {
                self.visible.resolve(it.name, it.pos, VALUE)
            };
        }
        self.count(&it);
        self.all.push(it);
    }
}

/// What `Collector::identifier` keeps from one identifier to the next.
struct Merge<'t> {
    into: Resolver<'t>,
    /// How many of `Collector::found` have been passed on.
    passed: usize,
    /// Where the next of them is.
    next_found: u32,
    /// Where the last identifier is.
    last: u32,
    /// Up to here from `last` there is no JSDoc comment of a JavaScript file.
    next_jsdoc: u32,
    /// Up to this expression from the last identifier none is the operand of a `typeof` in a type.
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

    /// `Referencer.visitPattern` makes the references of all the names of a pattern before it
    /// visits the defaults and the computed keys in it. `at`: where the name is, and the position
    /// that it is visited at. That is kept in `from` until the references are in order.
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

    /// `/** @type {T} */ (e)` in JavaScript is `e` in parentheses to ESLint.
    fn without_casts(&self, mut e: ExprId) -> ExprId {
        while self.file.is_javascript()
            && let Some(ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. }) =
                self.file.hir.exprs.get(e.idx()).map(|it| it.kind)
        {
            e = expr;
        }
        e
    }

    /// The right side, if the expression statement `s` is the left side of a `for`-`in` or a
    /// `for`-`of`.
    fn iterated_by(&self, s: hir::StmtId) -> Option<ExprId> {
        let Some(&Parent::Stmt(owner)) = self.file.bound.stmt_parent.get(s.idx()) else {
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
        // `a!`, `a as T`, `<T>a` and `a satisfies T` since the last part of a pattern.
        let (mut wrappers, mut has_satisfies) = (0, false);
        // A bit for each of `values`: the assignment can be one of its own. Any can be a default
        // in a pattern.
        let mut is_assignment = 0u32;
        // What each of `values` is assigned to.
        let mut targets: SmallVec<[ExprId; 4]> = SmallVec::new();
        let mut iterated = None;
        loop {
            match bound.expr_parent.get(at.idx()) {
                Some(&Parent::Expr(parent)) => {
                    match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                        Some(ExprKind::Assign {
                            op: None,
                            target,
                            value,
                        }) if target == at => {
                            // typescript-estree makes no pattern of a literal in parentheses.
                            let is_literal_in_parentheses = !self.is_javascript
                                && matches!(
                                    hir.exprs.get(at.idx()).map(|it| it.kind),
                                    Some(ExprKind::Array(_) | ExprKind::Object(_))
                                )
                                && hir.parens.binary_search_by_key(&at.0, |it| it.0.0).is_ok();
                            // `visitExpressionTarget` looks through one.
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
                Some(&Parent::Prop(p)) => {
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
                Some(&Parent::Stmt(s)) => {
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
        let start = pattern
            .and_then(|it| hir.exprs.get(it.idx()))
            .map_or(0, |it| it.pos);
        // The values so far are innermost first. All but the outermost are defaults, which ESLint
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
        Access::Write(start)
    }

    /// Whether `at` is `e`, or `e` in what `visitExpressionTarget` looks through.
    fn is_identifier(&self, at: ExprId, e: ExprId) -> bool {
        at == e
            || matches!(
                self.file.hir.exprs.get(at.idx()).map(|it| it.kind),
                Some(ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr)) if expr == e
            )
    }

    /// The closing tags, which `eslint-scope` does not visit. Sorted.
    fn unvisited_tags(&self) -> Vec<ExprId> {
        let hir = &self.file.hir;
        let mut skipped: Vec<ExprId> = Vec::new();
        if self.is_javascript {
            for jsx in hir.jsx {
                let mut at = jsx.close_tag;
                while let Some(ExprKind::Dot { obj, .. }) =
                    hir.exprs.get(at.idx()).map(|it| it.kind)
                {
                    at = obj;
                }
                skipped.push(at);
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
                && !matches!(
                    file.bound.expr_parent.get(id.idx()),
                    None | Some(Parent::None)
                )
                && name != known::empty
                && !(file.has_synthetic_nodes() && file.is_in_jsdoc(e.pos))
            {
                self.push(ReferenceSite::Expr(id), e.pos, name, READ, ExprId::NONE);
            }
        }
    }

    /// Passes on those of `found` that are before `pos`.
    #[inline(never)]
    fn pass_on_before(&self, pos: u32, merge: &mut Merge) {
        while let Some(before) = self.found.get(merge.passed)
            && before.pos < pos
        {
            merge.into.add(*before);
            merge.passed += 1;
        }
        merge.next_found = self.found.get(merge.passed).map_or(u32::MAX, |it| it.pos);
    }

    /// Whether what is around an identifier is enough to tell that it is a reference that reads a
    /// value.
    #[inline(never)]
    fn is_only_read(&self, id: ExprId) -> bool {
        let (hir, bound) = (&self.file.hir, &self.file.bound);
        match bound.expr_parent.get(id.idx()) {
            Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
                None | Some(ExprKind::Jsx(_)) => false,
                Some(ExprKind::Assign { target, .. }) => target != id,
                Some(ExprKind::Unary { op, .. }) => !matches!(
                    op,
                    UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                ),
                Some(kind) if can_be_part_of_target(kind) => {
                    match bound.expr_parent.get(parent.idx()) {
                        Some(&Parent::Expr(around)) => hir
                            .exprs
                            .get(around.idx())
                            .is_some_and(|it| !can_be_part_of_target(it.kind)),
                        None | Some(Parent::None | Parent::Prop(_) | Parent::Stmt(_)) => false,
                        Some(_) => true,
                    }
                }
                Some(_) => true,
            },
            Some(&Parent::Stmt(s)) => !matches!(
                hir.stmts.get(s.idx()).map(|it| it.kind),
                None | Some(
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) | StmtKind::Expr(_)
                )
            ),
            // The value of a property of an object literal that is an argument, is returned, or
            // is what a variable is initialized with. The value of an attribute.
            Some(&Parent::Prop(p)) => {
                let owner = bound
                    .prop_owner
                    .get(p.idx())
                    .copied()
                    .unwrap_or(ExprId::NONE);
                match bound.expr_parent.get(owner.idx()) {
                    Some(&Parent::Expr(around)) => matches!(
                        hir.exprs.get(around.idx()).map(|it| it.kind),
                        Some(ExprKind::Call(_) | ExprKind::New(_) | ExprKind::Jsx(_))
                    ),
                    Some(&Parent::Stmt(s)) => matches!(
                        hir.stmts.get(s.idx()).map(|it| it.kind),
                        Some(StmtKind::Return(_))
                    ),
                    Some(Parent::VarInit(_) | Parent::FnBody(_) | Parent::MemberInit(_)) => true,
                    _ => false,
                }
            }
            None | Some(Parent::None) => false,
            Some(_) => true,
        }
    }

    /// Passes on the references that the identifier `e` is, after those of `found`, which is
    /// sorted, that are before it. `false`, and nothing is done: it is before the last identifier.
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
        let access = match bound.expr_parent.get(id.idx()) {
            None | Some(Parent::None) => return true,
            Some(&Parent::Expr(parent)) => match hir.exprs.get(parent.idx()).map(|it| it.kind) {
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
            Some(Parent::Prop(_)) => self.access(id, &mut merge.values),
            Some(&Parent::Stmt(s)) => match hir.stmts.get(s.idx()).map(|it| it.kind) {
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
            Access::Write(start) => {
                for &value in &merge.values {
                    merge
                        .into
                        .add(self.make(site, (e.pos, start), name, WRITE, value));
                }
            }
        }
        true
    }

    /// All the references, in source order and resolved. `found` is sorted.
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
                exprs.len() / 3 + self.found.len(),
            ),
            passed: 0,
            next_found: self.found.first().map_or(u32::MAX, |it| it.pos),
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
        // The parser stores nearly every file in source order.
        let with_parent = exprs.iter().zip(self.file.bound.expr_parent);
        let is_in_order = with_parent.enumerate().all(|(i, (e, parent))| {
            let ExprKind::Ident(name) = e.kind else {
                return true;
            };
            let id = ExprId(i as u32);
            // In most places nothing but a value that is read can be.
            let is_only_read = match *parent {
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
        });
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
        for after in self.found.get(merge.passed..).unwrap_or_default() {
            merge.into.add(*after);
        }
        merge.into
    }

    /// `Referencer.VariableDeclaration`, `visitFunction`, `CatchClause`: a declaration writes the
    /// values that it gives to its names.
    fn patterns(&mut self, tree: &ScopeTree) {
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
            let mut at = hir::PatId(i as u32);
            let root = loop {
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
                at = outer;
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
                            bound.stmt_parent.get(statement.idx()),
                            Some(Parent::FnBody(_) | Parent::File)
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
                        .of_fn
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
            // `visitForIn` visits the declaration first, and then its names once more.
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
                        let flags = ReferenceFlags::READ | ReferenceFlags::TYPE;
                        self.push(
                            ReferenceSite::TypeName(id),
                            first.pos(),
                            first.text,
                            flags,
                            ExprId::NONE,
                        );
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
        self.found[start..].sort_unstable_by_key(|it| it.pos);
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

    /// `visitJSXElement`, for the tags that are not expressions outside JSX.
    fn jsx_names(&mut self) {
        let file = self.file;
        let start = self.found.len();
        for jsx in file.hir.jsx {
            // `eslint-scope` does not visit closing elements.
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
                    // `eslint-scope` takes a name with a namespace for no component.
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
        self.found[start..].sort_unstable_by_key(|it| it.pos);
    }

    /// `ExportVisitor`
    fn export_specifiers(&mut self) {
        let hir = &self.file.hir;
        for (i, spec) in hir.export_specs.iter().enumerate() {
            let Some(export) = hir.exports.get(spec.export.idx()) else {
                continue;
            };
            let is_bound = matches!(
                self.file.bound.stmt_parent.get(export.stmt.idx()),
                Some(parent) if *parent != Parent::None
            );
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
                        && !matches!(file.bound.expr_parent.get(*i), None | Some(Parent::None))
                })
                .map(|(_, e)| e.pos)
                .collect();
            elements.sort_unstable();
            let found = elements.iter().find_map(|&pos| {
                let mut scope = tree.scope_at(pos);
                while let Some(data) = tree.scopes.get(scope as usize) {
                    if let Some(index) = variables.get(scope, name) {
                        return Some(index);
                    }
                    scope = data.parent;
                }
                None
            });
            if let Some(index) = found {
                let pos = variables.list[index as usize].first_pos;
                self.push(
                    ReferenceSite::Declaration(index),
                    pos,
                    name,
                    READ,
                    ExprId::NONE,
                );
            }
        }
    }
}

/// Whether what is directly in an expression of this kind can be what an assignment writes to.
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

/// The groups of `all` by `key`: the indices group by group, and where each group starts.
/// `counts`: how many are in each group, at the index after its key. Within a group they are in
/// `order`, which is empty if that is the order of `all`.
fn group_by(
    all: &[RawReference],
    order: &[u32],
    mut counts: Vec<u32>,
    key: impl Fn(&RawReference) -> usize,
) -> (Vec<u32>, Vec<u32>) {
    for i in 1..counts.len() {
        counts[i] += counts[i - 1];
    }
    let mut next = counts.clone();
    let mut indices = vec![0u32; all.len()];
    let mut place = |i: usize| {
        let slot = &mut next[key(&all[i])];
        indices[*slot as usize] = i as u32;
        *slot += 1;
    };
    match order.is_empty() {
        true => (0..all.len()).for_each(&mut place),
        false => order.iter().for_each(|&i| place(i as usize)),
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
            found: Vec::with_capacity(hir.pats.len() / 2 + hir.types.len() / 2),
        };
        collector.patterns(tree);
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
        // Each part is nearly in order already. References at the same place keep their order.
        collector.found.sort_by_key(|it| it.pos);
        // More would not fit beside the marks in `Resolver::counts`.
        if hir.exprs.len() + collector.found.len() >= COUNT as usize {
            collector.found.clear();
        }
        let Resolver {
            all,
            of_expr,
            mut counts,
            moved,
            is_visiting_order,
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
            visiting_order.sort_by_key(|&it| visits[it as usize]);
        }

        let unresolved = variables.list.len();
        let variable_of = |it: &RawReference| (it.variable as usize).min(unresolved);
        let (by_variable, variable_starts) = group_by(&all, &visiting_order, counts, variable_of);
        References {
            all,
            visiting_order,
            by_variable,
            variable_starts,
            marks,
            of_expr,
            by_scope: OnceCell::new(),
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

    /// The references to the variable at `index` of `Variables::list`.
    #[inline]
    pub(crate) fn of_variable(&self, index: u32) -> &[u32] {
        Self::group(
            &self.by_variable,
            &self.variable_starts,
            index as usize,
            index as usize,
        )
    }

    /// The index in `Variables::list` of the value that the identifier `e` stands for.
    #[inline]
    pub(crate) fn of_expr(&self, e: ExprId) -> Option<u32> {
        self.of_expr.get(e.idx()).copied().filter(|it| *it != NONE)
    }

    /// Indices into `all` in the order ESLint makes the references. Empty if that is the order of
    /// `all`.
    #[inline]
    pub(crate) fn visiting_order(&self) -> &[u32] {
        &self.visiting_order
    }

    /// Whether the variable at `index` of `Variables::list` has one of `marks`.
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

    /// The references to `name` that resolve to nothing.
    pub(crate) fn unresolved_named(&self, name: Atom) -> &[u32] {
        let sorted = self.unresolved_by_name.get_or_init(|| {
            let mut sorted = self.unresolved().to_vec();
            sorted.sort_by_key(|&it| self.all[it as usize].name.0);
            sorted
        });
        let start = sorted.partition_point(|&it| self.all[it as usize].name.0 < name.0);
        let len = sorted[start..].partition_point(|&it| self.all[it as usize].name == name);
        &sorted[start..start + len]
    }

    /// The references that are written in the scopes `first..=last`.
    #[inline]
    pub(crate) fn in_scopes(&self, first: u32, last: u32) -> &[u32] {
        let compute = || {
            let mut counts = vec![0u32; self.scope_count + 1];
            self.all
                .iter()
                .for_each(|it| counts[it.from as usize + 1] += 1);
            group_by(&self.all, &self.visiting_order, counts, |it| {
                it.from as usize
            })
        };
        let (by_scope, starts) = self.by_scope.get_or_init(compute);
        Self::group(by_scope, starts, first as usize, last as usize)
    }

    /// The first reference that is written at `pos`.
    pub(crate) fn at(&self, pos: u32) -> Option<&RawReference> {
        self.all
            .get(self.all.partition_point(|it| it.pos < pos))
            .filter(|it| it.pos == pos)
    }
}
