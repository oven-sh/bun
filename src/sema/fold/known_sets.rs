use super::inputs::LinkForm;
use super::{
    Constant, Decision, Decisions, DefineRoot, DefineValue, FoldInputs, FoldedValue,
    RuntimeValueKind, StoredByMocks, apply_binary, apply_template, apply_unary,
};
use crate::atom::{Atom, Interner, known};
use crate::bind::{
    Binding, BindingKind, BindingStability, Bound, Decl, Parent, PatParent, SymbolId,
};
use crate::hir::{
    BinOp, Branches, Chain, ExportSpecId, ExprId, ExprKind, File, Flags, IdList, ImportEqualsId,
    MemberKey, NodeData, StmtKind, UnOp,
};
use crate::util::{FxHashMap, PositionSet};
use smallvec::{SmallVec, smallvec};
use std::cell::OnceCell;

pub(super) const MOST_VALUES_IN_A_KNOWN_SET: usize = 32;

type Values = SmallVec<[Constant; 4]>;

#[derive(Copy, Clone)]
enum Found {
    NotLookedAt,
    InProgress,
    Unknown,
    Values { first: u32, count: u32 },
}

#[derive(Copy, Clone)]
enum Source {
    Unknown,
    Initializer(ExprId),
    Element { list: ExprId, walked: ExprId },
}

enum Origin {
    Initializer(ExprId),
    ElementOf(ExprId),
}

#[derive(Copy, Clone)]
enum Asked {
    Value(ExprId),
    Elements(ExprId),
}

impl Asked {
    fn expression(self) -> ExprId {
        match self {
            Asked::Value(e) | Asked::Elements(e) => e,
        }
    }
}

#[derive(Copy, Clone)]
enum Part {
    Unknown,
    Constant(Constant),
    Asked(Asked),
}

#[derive(Default)]
struct Parts {
    values: Vec<Constant>,
    ends: Vec<usize>,
}

impl Parts {
    fn push(&mut self, values: &[Constant]) {
        self.values.extend_from_slice(values);
        self.ends.push(self.values.len());
    }
}

#[derive(Default)]
pub(super) struct ListHolders {
    handed_on: OnceCell<PositionSet>,
    named_without_expression: OnceCell<PositionSet>,
}

fn name_of_method(
    inputs: &FoldInputs<'_>,
    atoms: &Interner<'_>,
    class: &[u8],
    method: &[u8],
) -> Option<Atom> {
    let method = atoms.intern(method);
    let mut path = inputs.root(DefineRoot::Global(atoms.intern(class)))?;
    for name in [atoms.intern(b"prototype"), method] {
        path = inputs.child(path, name, LinkForm::DOT)?;
    }
    let is_function = matches!(
        inputs.value_of(path)?,
        DefineValue::RuntimeValue(RuntimeValueKind::Function)
    );
    is_function.then_some(method)
}

pub(super) fn name_of_join(inputs: &FoldInputs<'_>, atoms: &Interner<'_>) -> Option<Atom> {
    name_of_method(inputs, atoms, b"Array", b"join")
}

pub(super) fn name_of_split(inputs: &FoldInputs<'_>, atoms: &Interner<'_>) -> Option<Atom> {
    name_of_method(inputs, atoms, b"String", b"split")
}

pub(super) fn name_of_replace(inputs: &FoldInputs<'_>, atoms: &Interner<'_>) -> Option<Atom> {
    name_of_method(inputs, atoms, b"RegExp", b"exec")?;
    name_of_method(inputs, atoms, b"String", b"replace")
}

pub(super) fn is_prototype_of_patterns_locked(
    inputs: &FoldInputs<'_>,
    atoms: &Interner<'_>,
) -> bool {
    name_of_method(inputs, atoms, b"RegExp", b"exec").is_some()
}

fn kind_at(hir: &File<'_>, e: ExprId) -> Option<ExprKind> {
    hir.exprs.get(e.idx()).map(|node| node.kind)
}

pub(crate) fn outermost_cast(hir: &File<'_>, bound: &Bound<'_>, mut e: ExprId) -> ExprId {
    while let Parent::Expr(above) = bound.parent_of_expr(e)
        && hir.type_assertion_operand(above).is_some()
    {
        e = above;
    }
    e
}

fn is_only_read<'s>(hir: &File<'s>, bound: &Bound<'s>, access: ExprId) -> bool {
    let access = outermost_cast(hir, bound, access);
    if bound.get_assignment_target(hir, access).is_some() {
        return false;
    }
    let Parent::Expr(user) = bound.parent_of_expr(access) else {
        return true;
    };
    match kind_at(hir, user) {
        Some(
            ExprKind::Unary {
                op: UnOp::Delete, ..
            }
            | ExprKind::TaggedTemplate(_),
        )
        | None => false,
        Some(ExprKind::Call(call)) => hir[call].callee != access,
        Some(_) => true,
    }
}

fn is_called<'s>(hir: &File<'s>, bound: &Bound<'s>, access: ExprId) -> bool {
    let callee = outermost_cast(hir, bound, access);
    let Parent::Expr(user) = bound.parent_of_expr(callee) else {
        return false;
    };
    matches!(kind_at(hir, user), Some(ExprKind::Call(call)) if hir[call].callee == callee && hir[call].chain == Chain::No)
}

fn leaves_list_as_written<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    join: Option<Atom>,
    mention: ExprId,
) -> bool {
    let list = outermost_cast(hir, bound, mention);
    match bound.parent_of_expr(list) {
        Parent::Stmt(walk) => hir.stmts.get(walk.idx()).is_some_and(|walk| {
            matches!(walk.kind, StmtKind::ForOf { expr, is_await: false, .. } if expr == list)
        }),
        Parent::Expr(access) => match kind_at(hir, access) {
            Some(ExprKind::Index { obj, .. }) => obj == list && is_only_read(hir, bound, access),
            Some(ExprKind::Dot { obj, .. }) if obj != list => false,
            Some(ExprKind::Dot { chain, .. }) => match hir.member_key(access) {
                Some((_, MemberKey::Name(name))) if name == known::length => {
                    is_only_read(hir, bound, access)
                }
                Some((_, MemberKey::Name(name))) => {
                    join == Some(name) && chain == Chain::No && is_called(hir, bound, access)
                }
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}

impl ListHolders {
    pub(super) fn is_reached_without_mention<'s>(
        &self,
        hir: &File<'s>,
        bound: &Bound<'s>,
        variable: SymbolId,
    ) -> bool {
        let named = self.named_without_expression.get_or_init(|| {
            let specifiers = (0..hir.export_specs.len() as u32).map(ExportSpecId);
            let entity_names = (0..hir.import_equals.len() as u32).map(ImportEqualsId);
            let implicit = bound.runtime.implicit_references().iter();
            let bindings = (specifiers.map(|it| bound.exported_binding(it)))
                .chain(entity_names.map(|it| bound.entity_root_binding(it)))
                .chain(implicit.map(|it| it.binding));
            let mut named = PositionSet::new(bound.symbols.len());
            for binding in bindings {
                if let Binding::Symbol(symbol) = binding {
                    named.insert(symbol.idx());
                }
            }
            named
        });
        let mut declarations = bound.symbol(variable).decls.iter();
        named.contains(variable.idx())
            || declarations.any(|&it| bound.modifier_flags(hir, it).contains(Flags::EXPORT))
    }

    pub(super) fn is_handed_on<'s>(
        &self,
        hir: &File<'s>,
        bound: &Bound<'s>,
        join: impl FnOnce() -> Option<Atom>,
        is_dead: impl Fn(ExprId) -> bool,
        holder: SymbolId,
    ) -> bool {
        let handed_on = self.handed_on.get_or_init(|| {
            let join = join();
            let mut handed_on = PositionSet::new(bound.symbols.len());
            for (mention, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
                if matches!(node.kind, ExprKind::Ident(_))
                    && let Binding::Symbol(variable) = bound.binding(mention)
                    && !handed_on.contains(variable.idx())
                    && bound.is_evaluated_ident(mention)
                    && !is_dead(mention)
                    && !leaves_list_as_written(hir, bound, join, mention)
                {
                    handed_on.insert(variable.idx());
                }
            }
            handed_on
        });
        handed_on.contains(holder.idx())
    }
}

pub struct KnownSets<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    decisions: &'a Decisions<'s>,
    inputs: &'a FoldInputs<'s>,
    atoms: &'a Interner<'s>,
    found: FxHashMap<ExprId, Found>,
    sources: FxHashMap<SymbolId, Source>,
    values: Vec<Constant>,
    waiting: Vec<Asked>,
    holders: ListHolders,
}

fn combines_values(kind: ExprKind) -> bool {
    match kind {
        ExprKind::Cond { .. } => true,
        ExprKind::Template { exprs } => !exprs.is_empty(),
        ExprKind::Binary { op, .. } => {
            matches!(op, BinOp::Add | BinOp::And | BinOp::Or | BinOp::Nullish)
        }
        _ => false,
    }
}

fn is_same_value(left: Constant, right: Constant) -> bool {
    match (left, right) {
        (Constant::Number(left), Constant::Number(right)) => {
            left.to_bits() == right.to_bits() || left.is_nan() && right.is_nan()
        }
        _ => left == right,
    }
}

fn add_distinct(values: &mut Vec<Constant>, first: usize, value: Constant) -> Option<()> {
    if values[first..].iter().any(|&it| is_same_value(it, value)) {
        return Some(());
    }
    if values.len() - first == MOST_VALUES_IN_A_KNOWN_SET {
        return None;
    }
    values.push(value);
    Some(())
}

impl<'a, 's> KnownSets<'a, 's> {
    pub fn new(
        hir: &'a File<'s>,
        bound: &'a Bound<'s>,
        decisions: &'a Decisions<'s>,
        atoms: &'a Interner<'s>,
    ) -> KnownSets<'a, 's> {
        KnownSets {
            hir,
            bound,
            decisions,
            inputs: &decisions.folded_with,
            atoms,
            found: FxHashMap::default(),
            sources: FxHashMap::default(),
            values: Vec::new(),
            waiting: Vec::new(),
            holders: ListHolders::default(),
        }
    }

    pub fn of(&mut self, e: ExprId) -> &[Constant] {
        let may_have_set = |kind| matches!(kind, ExprKind::Ident(_)) || combines_values(kind);
        let is_asked = self.kind_of(e).is_some_and(may_have_set)
            && self.bound.parent_of_expr(e) != Parent::None
            && !self.decisions.is_dead_expr(e)
            && !self.is_joined_by_parent(e);
        if is_asked
            && let Part::Asked(asked) = self.part(e)
            && let Found::Values { first, count } = self.find(asked)
        {
            return &self.values[first as usize..][..count as usize];
        }
        &[]
    }

    fn is_joined_by_parent(&self, e: ExprId) -> bool {
        let Parent::Expr(above) = self.bound.parent_of_expr(e) else {
            return false;
        };
        match (self.kind_of(above), self.kind_of(e)) {
            (
                Some(ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    ..
                }),
                Some(ExprKind::Binary { op: BinOp::Add, .. }),
            ) => left == e,
            (Some(ExprKind::TaggedTemplate(call)), Some(ExprKind::Template { .. })) => {
                self.hir.template_of(call) == e
            }
            _ => false,
        }
    }

    fn kind_of(&self, e: ExprId) -> Option<ExprKind> {
        self.hir.exprs.get(e.idx()).map(|node| node.kind)
    }

    fn constant_of(&self, e: ExprId) -> Option<Constant> {
        match self.decisions.constant(self.hir, e) {
            FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
                Some(constant)
            }
            FoldedValue::Unknown => None,
        }
    }

    fn is_followed(&self, written: ExprId) -> bool {
        let kind = self.kind_of(self.hir.skip_type_assertions(written));
        kind.is_some_and(|kind| matches!(kind, ExprKind::Ident(_)) || combines_values(kind))
    }

    fn part(&mut self, written: ExprId) -> Part {
        let e = self.hir.skip_type_assertions(written);
        if let Some(constant) = self.constant_of(e) {
            return Part::Constant(constant);
        }
        match self.kind_of(e) {
            Some(ExprKind::Ident(_)) => match self.source_of_read(e) {
                Source::Initializer(value) => match self.constant_of(value) {
                    Some(constant) => Part::Constant(constant),
                    None => Part::Asked(Asked::Value(e)),
                },
                Source::Element { .. } => Part::Asked(Asked::Value(e)),
                Source::Unknown => Part::Unknown,
            },
            Some(kind) if combines_values(kind) => Part::Asked(Asked::Value(e)),
            _ => Part::Unknown,
        }
    }

    fn part_of_source(&mut self, source: Source) -> Part {
        match source {
            Source::Initializer(value) => self.part(value),
            Source::Element { list, .. } => Part::Asked(Asked::Elements(list)),
            Source::Unknown => Part::Unknown,
        }
    }

    fn is_plain_read(&self, name: ExprId) -> bool {
        let bound = self.bound;
        bound.is_evaluated_ident(name)
            && !bound.is_store_target(name)
            && bound.dynamic_lookup_scope(NodeData::Expr(name)).is_none()
    }

    fn source_of_read(&mut self, read: ExprId) -> Source {
        let Binding::Symbol(variable) = self.bound.binding(read) else {
            return Source::Unknown;
        };
        if !self.is_plain_read(read) {
            return Source::Unknown;
        }
        match self.source_of(variable) {
            source @ Source::Initializer(value) if value < read => source,
            source @ Source::Element { walked, .. } if walked < read => source,
            _ => Source::Unknown,
        }
    }

    fn source_of(&mut self, variable: SymbolId) -> Source {
        if let Some(&source) = self.sources.get(&variable) {
            return source;
        }
        let source = self.find_source(variable);
        self.sources.insert(variable, source);
        source
    }

    fn find_source(&self, variable: SymbolId) -> Source {
        match self.find_origin(variable) {
            Some(Origin::Initializer(value))
                if self.constant_of(value).is_some() || self.is_followed(value) =>
            {
                Source::Initializer(value)
            }
            Some(Origin::ElementOf(walked)) => match self.find_iterated_list(walked) {
                Some(list) => Source::Element { list, walked },
                None => Source::Unknown,
            },
            Some(Origin::Initializer(_)) | None => Source::Unknown,
        }
    }

    fn find_origin(&self, variable: SymbolId) -> Option<Origin> {
        let (hir, bound) = (self.hir, self.bound);
        let holds_one_value = matches!(
            bound.binding_kind(variable),
            BindingKind::Const | BindingKind::Let
        ) && bound.binding_stability(variable) == BindingStability::Stable
            && !bound.is_visible_to_eval(variable)
            && !self.is_stored_by_mocks(variable);
        if !holds_one_value {
            return None;
        }
        let Some(Decl::Var(name)) = bound.initializing_declaration(variable) else {
            return None;
        };
        let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
            return None;
        };
        let statement = bound.var_stmt[declaration.idx()];
        let above = match bound.parent_of_stmt(statement) {
            Parent::Stmt(above) => hir.stmts.get(above.idx()).map(|above| above.kind),
            _ => None,
        };
        match above {
            Some(StmtKind::ForOf {
                left,
                expr,
                is_await,
                ..
            }) if left == statement => (!is_await).then_some(Origin::ElementOf(expr)),
            Some(StmtKind::ForIn { left, .. }) if left == statement => None,
            _ => hir[declaration].init.some().map(Origin::Initializer),
        }
    }

    fn is_stored_by_mocks(&self, variable: SymbolId) -> bool {
        match self.inputs.stored_by_mocks {
            StoredByMocks::Nothing => false,
            StoredByMocks::Variables(variables) => variables.binary_search(&variable).is_ok(),
            StoredByMocks::EveryExport => self.is_reached_without_mention(variable),
        }
    }

    fn is_reached_without_mention(&self, variable: SymbolId) -> bool {
        self.holders
            .is_reached_without_mention(self.hir, self.bound, variable)
    }

    fn find_iterated_list(&self, walked: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let written = hir.skip_type_assertions(walked);
        if matches!(self.kind_of(written), Some(ExprKind::Array(_))) {
            return Some(written);
        }
        let (Some(ExprKind::Ident(_)), Binding::Symbol(holder)) =
            (self.kind_of(written), bound.binding(written))
        else {
            return None;
        };
        let Some(Origin::Initializer(value)) = self.find_origin(holder) else {
            return None;
        };
        let list = hir.skip_type_assertions(value);
        let stays_as_written = matches!(self.kind_of(list), Some(ExprKind::Array(_)))
            && bound.binding_kind(holder) == BindingKind::Const
            && self.is_plain_read(written)
            && value < written
            && !self.is_reached_without_mention(holder)
            && !self.is_handed_on(holder);
        stays_as_written.then_some(list)
    }

    fn is_handed_on(&self, holder: SymbolId) -> bool {
        self.holders.is_handed_on(
            self.hir,
            self.bound,
            || name_of_join(self.inputs, self.atoms),
            |mention| self.decisions.is_dead_expr(mention),
            holder,
        )
    }

    fn found_for(&self, asked: Asked) -> Found {
        let found = self.found.get(&asked.expression());
        found.copied().unwrap_or(Found::NotLookedAt)
    }

    fn find(&mut self, asked: Asked) -> Found {
        self.waiting.push(asked);
        while let Some(&top) = self.waiting.last() {
            let at = top.expression();
            match self.found_for(top) {
                Found::NotLookedAt => {
                    self.found.insert(at, Found::InProgress);
                    if self.push_parts(top).is_none() {
                        self.found.insert(at, Found::Unknown);
                    }
                }
                Found::InProgress => {
                    self.waiting.pop();
                    let joined = self.join_parts(top);
                    self.found.insert(at, joined);
                }
                Found::Unknown | Found::Values { .. } => {
                    self.waiting.pop();
                }
            }
        }
        self.found_for(asked)
    }

    fn push(&mut self, part: Part) -> Option<()> {
        let Part::Asked(asked) = part else {
            return matches!(part, Part::Constant(_)).then_some(());
        };
        match self.found_for(asked) {
            Found::NotLookedAt => {
                self.waiting.push(asked);
                Some(())
            }
            Found::Values { .. } => Some(()),
            Found::InProgress | Found::Unknown => None,
        }
    }

    fn push_operand(&mut self, written: ExprId) -> Option<()> {
        let part = self.part(written);
        self.push(part)
    }

    fn push_parts(&mut self, asked: Asked) -> Option<()> {
        let (hir, decisions) = (self.hir, self.decisions);
        let e = match asked {
            Asked::Elements(list) => {
                let ExprKind::Array(items) = hir[list].kind else {
                    return None;
                };
                return hir.ids(items).try_for_each(|item| self.push_operand(item));
            }
            Asked::Value(e) => e,
        };
        match hir[e].kind {
            _ if !matches!(decisions.decision(e), Decision::Unknown) => None,
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                let mut live = [yes, no]
                    .into_iter()
                    .filter(|&it| !decisions.is_dead_expr(it));
                live.try_for_each(|branch| self.push_operand(branch))
            }
            ExprKind::Binary { op: BinOp::Add, .. } => {
                let mut leftmost = e;
                while let ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } = hir[leftmost].kind
                {
                    self.push_operand(right)?;
                    leftmost = left;
                }
                self.push_operand(leftmost)
            }
            ExprKind::Binary { left, right, .. } => {
                self.push_operand(left)?;
                if !decisions.is_dead_expr(right) {
                    let _ = self.push_operand(right);
                }
                Some(())
            }
            ExprKind::Template { exprs } => {
                (hir.ids(exprs)).try_for_each(|substitution| self.push_operand(substitution))
            }
            ExprKind::Ident(_) => {
                let source = self.source_of_read(e);
                let given = self.part_of_source(source);
                self.push(given)
            }
            _ => None,
        }
    }

    fn join_parts(&mut self, asked: Asked) -> Found {
        if let Asked::Value(read) = asked
            && matches!(self.hir[read].kind, ExprKind::Ident(_))
        {
            return self.find_values_of_read(read);
        }
        let first = self.values.len();
        if self.add_values_of(asked, first).is_none() || self.values.len() == first {
            self.values.truncate(first);
            return Found::Unknown;
        }
        Found::Values {
            first: first as u32,
            count: (self.values.len() - first) as u32,
        }
    }

    fn find_values_of_read(&mut self, read: ExprId) -> Found {
        let source = self.source_of_read(read);
        match self.part_of_source(source) {
            Part::Constant(constant) => {
                self.values.push(constant);
                Found::Values {
                    first: (self.values.len() - 1) as u32,
                    count: 1,
                }
            }
            Part::Asked(given) => match self.found_for(given) {
                found @ Found::Values { .. } => found,
                Found::NotLookedAt | Found::InProgress | Found::Unknown => Found::Unknown,
            },
            Part::Unknown => Found::Unknown,
        }
    }

    fn values_of(&mut self, written: ExprId) -> Option<Values> {
        let asked = match self.part(written) {
            Part::Unknown => return None,
            Part::Constant(constant) => return Some(smallvec![constant]),
            Part::Asked(asked) => asked,
        };
        match self.found_for(asked) {
            Found::Values { first, count } => {
                let values = &self.values[first as usize..][..count as usize];
                Some(SmallVec::from_slice(values))
            }
            Found::NotLookedAt | Found::InProgress | Found::Unknown => None,
        }
    }

    fn add_values_of_part(&mut self, written: ExprId, first: usize) -> Option<()> {
        let mut values = self.values_of(written)?.into_iter();
        values.try_for_each(|value| add_distinct(&mut self.values, first, value))
    }

    fn add_values_of(&mut self, asked: Asked, first: usize) -> Option<()> {
        let (hir, decisions) = (self.hir, self.decisions);
        let e = match asked {
            Asked::Elements(list) => {
                let ExprKind::Array(items) = hir[list].kind else {
                    return None;
                };
                return (hir.ids(items)).try_for_each(|item| self.add_values_of_part(item, first));
            }
            Asked::Value(e) => e,
        };
        match hir[e].kind {
            ExprKind::Cond { branches, .. } => {
                let Branches { yes, no } = hir.branches(branches);
                let mut live = [yes, no]
                    .into_iter()
                    .filter(|&it| !decisions.is_dead_expr(it));
                live.try_for_each(|branch| self.add_values_of_part(branch, first))
            }
            ExprKind::Binary { op: BinOp::Add, .. } => self.add_sums(e, first),
            ExprKind::Binary { op, left, right } => {
                self.add_results_of_choice(op, left, right, first)
            }
            ExprKind::Template { exprs } => self.add_texts(exprs, first),
            _ => None,
        }
    }

    fn is_truthy(&self, value: Constant) -> Option<bool> {
        match apply_unary(self.atoms, UnOp::Not, value)? {
            Constant::Boolean(is_falsy) => Some(!is_falsy),
            _ => None,
        }
    }

    fn add_results_of_choice(
        &mut self,
        op: BinOp,
        left: ExprId,
        right: ExprId,
        first: usize,
    ) -> Option<()> {
        let mut goes_on_to_right = false;
        for value in self.values_of(left)? {
            let is_result = match op {
                BinOp::Or => self.is_truthy(value)?,
                BinOp::And => !self.is_truthy(value)?,
                BinOp::Nullish => !matches!(value, Constant::Undefined | Constant::Null),
                _ => return None,
            };
            match is_result {
                true => add_distinct(&mut self.values, first, value)?,
                false => goes_on_to_right = true,
            }
        }
        match goes_on_to_right && !self.decisions.is_dead_expr(right) {
            true => self.add_values_of_part(right, first),
            false => Some(()),
        }
    }

    fn add_sums(&mut self, outermost: ExprId, first: usize) -> Option<()> {
        let hir = self.hir;
        let mut addends = Vec::new();
        let mut leftmost = outermost;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = hir[leftmost].kind
        {
            addends.push(right);
            leftmost = left;
        }
        addends.push(leftmost);
        let mut parts = Parts::default();
        for &addend in addends.iter().rev() {
            parts.push(&self.values_of(addend)?);
        }
        self.add_joined(&parts, first)
    }

    fn add_texts(&mut self, substitutions: IdList<ExprId>, first: usize) -> Option<()> {
        let hir = self.hir;
        let mut texts = hir.ids(hir.template_texts(substitutions));
        let mut parts = Parts::default();
        parts.push(&[Constant::String(texts.next()?)]);
        for (substitution, text) in hir.ids(substitutions).zip(texts) {
            parts.push(&self.values_of(substitution)?);
            parts.push(&[Constant::String(text)]);
        }
        self.add_joined(&parts, first)
    }

    fn add_joined(&mut self, parts: &Parts, first: usize) -> Option<()> {
        let mut begin = *parts.ends.first()?;
        let mut joined = parts.values[..begin].to_vec();
        let mut longer = Vec::new();
        let mut ends = parts.ends[1..].iter().copied().peekable();
        while let Some(mut end) = ends.next() {
            let is_run = end - begin == 1;
            while is_run && let Some(next) = ends.next_if(|&next| next - end == 1) {
                end = next;
            }
            let next = &parts.values[begin..end];
            let step = if is_run { next.len() } else { 1 };
            for &start in &joined {
                for tail in next.chunks(step) {
                    add_distinct(&mut longer, 0, self.append(start, tail)?)?;
                }
            }
            std::mem::swap(&mut joined, &mut longer);
            longer.clear();
            begin = end;
        }
        let mut joined = joined.into_iter();
        joined.try_for_each(|value| add_distinct(&mut self.values, first, value))
    }

    fn append(&self, mut start: Constant, mut run: &[Constant]) -> Option<Constant> {
        let max_string_bytes = self.inputs.max_string_bytes();
        while let Some((&next, rest)) = run.split_first() {
            if let Constant::String(text) = start {
                let mut texts = vec![known::empty; run.len() + 1];
                texts[0] = text;
                return apply_template(self.atoms, &texts, run, max_string_bytes);
            }
            start = apply_binary(self.atoms, BinOp::Add, [start, next], max_string_bytes)?;
            run = rest;
        }
        Some(start)
    }
}

#[cfg(test)]
mod tests;
