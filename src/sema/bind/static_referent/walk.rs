use super::stored_by_calls::find_value_stored_in_exports_by_call;
use super::{
    LinkedBinding, LoadedValue, MemberAssignment, MemberStores, NamespaceReferent,
    ReferentCertainty, ReferentContext, ResolvedReferent, StaticReferent, UnknownReferent,
};
use crate::atom::{Atom, known};
use crate::bind::decorator_metadata::has_decorators;
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, CommonJsVariable, Decl,
    InitialState, Parent, PatParent, SymbolId,
};
use crate::check::aot::{ClassRef, FunctionRef};
use crate::hir::*;
use crate::import_sites::is_free_common_js;
use crate::program::{FileId, Sym};
use bun_sort_by_number::{SortByNumber, number_of_pair};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::hash::Hash;
use std::marker::PhantomData;

#[derive(Copy, Clone)]
enum DeclaredValue {
    Function(FnId),
    Class(ClassId),
}

#[derive(Copy, Clone)]
struct ExportStore {
    node: ExprId,
    target: ExprId,
    value: Option<ExprId>,
}

enum Step<B, M> {
    Expression(FileId, ExprId),
    Symbol(Sym),
    Linked(LinkedBinding<B, M>),
    Found(StaticReferent<B, M>),
}

type StepOf<'s, C> = Step<<C as ReferentContext<'s>>::Builtin, <C as ReferentContext<'s>>::Module>;

fn unknown<B, M>(reason: UnknownReferent) -> Step<B, M> {
    Step::Found(StaticReferent::Unknown(reason))
}

pub(super) fn find_only_returned_value(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<ExprId> {
    if hir[function]
        .flags
        .intersects(Flags::ASYNC | Flags::GENERATOR)
    {
        return None;
    }
    let mut returns = bound.ids(bound.fns[function.idx()].returns);
    let (Some(statement), None) = (returns.next(), returns.next()) else {
        return None;
    };
    match hir[statement].kind {
        StmtKind::Return(value)
            if value.is_some() && bound.parent_of_stmt(statement) == Parent::FnBody(function) =>
        {
            Some(value)
        }
        _ => None,
    }
}

fn find_index_of_returned_parameter(
    hir: &File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<usize> {
    let mut returned = hir.skip_type_assertions(find_only_returned_value(hir, bound, function)?);
    while let ExprKind::Binary {
        op: BinOp::Comma,
        right,
        ..
    } = hir[returned].kind
    {
        returned = hir.skip_type_assertions(right);
    }
    let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
        (hir[returned].kind, bound.binding(returned))
    else {
        return None;
    };
    let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let written = &hir[parameter];
    let is_plain_name = matches!(hir[pattern].kind, PatKind::Ident(_))
        && written.default.is_none()
        && !written.flags.contains(Flags::REST);
    if !is_plain_name
        || bound.param_fn[parameter.idx()] != function
        || !bound.is_stable_binding(symbol)
    {
        return None;
    }
    hir[function].params.iter().position(|it| it == parameter)
}

pub(super) fn find_place_of_plain_parameter(
    hir: &File<'_>,
    bound: &Bound<'_>,
    id: SymbolId,
) -> Option<(FnId, usize)> {
    let &[Decl::Param(pattern)] = bound.symbol(id).decls else {
        return None;
    };
    let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    let written = &hir[parameter];
    let is_plain_name = matches!(hir[pattern].kind, PatKind::Ident(_))
        && written.default.is_none()
        && !written.flags.contains(Flags::REST);
    let function = bound.param_fn[parameter.idx()];
    if !is_plain_name || function == FnId::NONE {
        return None;
    }
    let index = hir[function].params.iter().position(|it| it == parameter)?;
    Some((function, index))
}

fn find_value_of_only_store(
    hir: &File<'_>,
    bound: &Bound<'_>,
    id: SymbolId,
    is_dead_store: &dyn Fn(ExprId) -> bool,
) -> Option<ExprId> {
    let &[Decl::Var(pattern)] = bound.symbol(id).decls else {
        return None;
    };
    let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else {
        return None;
    };
    if hir[declaration].init.is_some() || bound.is_visible_to_eval(id) {
        return None;
    }
    let mut stores = bound.stores_to(id).iter();
    let mut stores = stores.by_ref().filter(|store| !is_dead_store(store.target));
    let (Some(store), None) = (stores.next(), stores.next()) else {
        return None;
    };
    let Parent::Expr(around) = bound.parent_of_expr(store.target) else {
        return None;
    };
    match hir.exprs.get(around.idx()).map(|node| node.kind) {
        Some(ExprKind::Assign {
            op: None,
            target,
            value,
        }) if target == store.target => Some(value),
        _ => None,
    }
}

fn find_argument_of_only_call(hir: &File<'_>, bound: &Bound<'_>, id: SymbolId) -> Option<ExprId> {
    let (function, index) = find_place_of_plain_parameter(hir, bound, id)?;
    let call = bound.get_immediately_invoked_function_expression(hir, function)?;
    if bound.finds_itself(hir, function) {
        return None;
    }
    find_argument_at(hir, call, index)
}

pub(super) fn find_argument_at(hir: &File<'_>, call: CallId, index: usize) -> Option<ExprId> {
    let mut arguments = hir.ids(hir[call].args).take(index + 1);
    if arguments
        .clone()
        .any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
    {
        return None;
    }
    arguments.nth(index)
}

fn reads_module_exports(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    match hir.member_key(expr) {
        Some((object, MemberKey::Name(name))) => {
            name == known::exports
                && is_free_common_js(hir, bound, object, CommonJsVariable::Module)
        }
        Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => false,
    }
}

pub(super) fn reads_exports_object(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    is_free_common_js(hir, bound, expr, CommonJsVariable::Exports)
        || reads_module_exports(hir, bound, expr)
}

fn find_assignment(hir: &File<'_>, node: ExprId) -> Option<ExportStore> {
    let ExprKind::Assign {
        op: None,
        target,
        value,
    } = hir[node].kind
    else {
        return None;
    };
    Some(ExportStore {
        node,
        target,
        value: Some(value),
    })
}

type FindExportStore = fn(&File<'_>, &Bound<'_>, Decl) -> Option<ExportStore>;

fn find_store_of_whole(
    hir: &File<'_>,
    bound: &Bound<'_>,
    declaration: Decl,
) -> Option<ExportStore> {
    let Decl::ModuleExports(node) = declaration else {
        return None;
    };
    find_assignment(hir, node).filter(|store| reads_module_exports(hir, bound, store.target))
}

fn find_store_of_property(
    hir: &File<'_>,
    bound: &Bound<'_>,
    declaration: Decl,
) -> Option<ExportStore> {
    let Decl::ExportsProperty(node) = declaration else {
        return None;
    };
    if let ExprKind::Call(call) = hir[node].kind {
        let object = hir.ids(hir[call].args).next()?;
        let definition = ExportStore {
            node,
            target: node,
            value: None,
        };
        return reads_exports_object(hir, bound, object).then_some(definition);
    }
    let store = find_assignment(hir, node)?;
    let (object, _) = hir.member_key(store.target)?;
    reads_exports_object(hir, bound, object).then_some(store)
}

fn find_statement_around(bound: &Bound<'_>, parent: Parent) -> Option<StmtId> {
    match parent {
        Parent::Stmt(statement) => statement.some(),
        Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()].some(),
        Parent::Case(case) => bound.case_stmt[case.idx()].some(),
        _ => None,
    }
}

fn is_evaluated_by_file_body(hir: &File<'_>, bound: &Bound<'_>, mut expr: ExprId) -> bool {
    let mut parent = bound.parent_of_expr(expr);
    while let Parent::Expr(outer) = parent {
        let is_assigned_value = matches!(
            hir.exprs.get(outer.idx()).map(|node| node.kind),
            Some(ExprKind::Assign { op: None, value, .. }) if value == expr
        );
        if !is_assigned_value {
            return false;
        }
        expr = outer;
        parent = bound.parent_of_expr(expr);
    }
    find_statement_around(bound, parent).is_some_and(|statement| {
        matches!(hir[statement].kind, StmtKind::Expr(_) | StmtKind::Var(_))
            && bound.parent_of_stmt(statement) == Parent::File
    })
}

fn find_value_unless_this_of_file_has_one(
    hir: &File<'_>,
    bound: &Bound<'_>,
    expr: ExprId,
) -> Option<ExprId> {
    let ExprKind::Binary {
        op: BinOp::Or,
        left,
        right: value,
    } = hir[expr].kind
    else {
        return None;
    };
    let ExprKind::Binary {
        op: BinOp::And,
        left,
        right,
    } = hir[hir.skip_type_assertions(left)].kind
    else {
        return None;
    };
    let is_this = |it: ExprId| matches!(hir[hir.skip_type_assertions(it)].kind, ExprKind::This);
    let reads_this = matches!(
        hir.member_key(hir.skip_type_assertions(right)),
        Some((object, MemberKey::Name(_))) if is_this(object)
    );
    (is_this(left) && reads_this && is_evaluated_by_file_body(hir, bound, expr)).then_some(value)
}

fn find_symbol_named_by(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> Option<SymbolId> {
    let expr = hir.skip_type_assertions(expr);
    match (hir[expr].kind, bound.binding(expr)) {
        (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
        _ => None,
    }
}

pub(super) fn index_member_stores<'s, C: ReferentContext<'s>>(
    context: &C,
    file: FileId,
) -> MemberStores {
    let (hir, bound) = (context.hir(file), context.bound(file));
    let mut stores = MemberStores::default();
    if !bound.runtime.is_computed() {
        return stores;
    }
    for node in (0..hir.exprs.len() as u32).map(ExprId) {
        match hir[node].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                if let Some((object, MemberKey::Name(name))) = hir.member_key(target)
                    && let Some(holder) = find_symbol_named_by(hir, bound, object)
                    && is_evaluated_by_file_body(hir, bound, node)
                {
                    stores.assignments.push(MemberAssignment {
                        holder,
                        name,
                        target,
                        value,
                    });
                }
            }
            ExprKind::Call(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let builtin = context.builtin_of_expression(file, callee);
                let target = builtin.and_then(|it| context.find_target_of_copied_properties(it));
                if let Some(target) = target
                    && let Some(argument) = hir.ids(hir[call].args).nth(target as usize)
                    && let Some(holder) = find_symbol_named_by(hir, bound, argument)
                    && is_evaluated_by_file_body(hir, bound, node)
                {
                    stores.copies.push((holder, call));
                }
            }
            _ => {}
        }
    }
    (stores.assignments).sort_by_u64(|it| number_of_pair(it.holder.0, it.name.0));
    stores.copies.sort_by_u32(|it| it.0.0);
    stores
}

fn is_in_catch_clause(hir: &File<'_>, bound: &Bound<'_>, expr: ExprId) -> bool {
    let mut parent = bound.parent_of_expr(expr);
    while let Parent::Expr(outer) = parent {
        parent = bound.parent_of_expr(outer);
    }
    let mut statement = find_statement_around(bound, parent);
    while let Some(inner) = statement {
        statement = find_statement_around(bound, bound.parent_of_stmt(inner));
        let is_handler = statement.is_some_and(
            |outer| matches!(hir[outer].kind, StmtKind::Try { handler, .. } if handler == inner),
        );
        if is_handler {
            return true;
        }
    }
    false
}

fn find_deciding_store(
    hir: &File<'_>,
    bound: &Bound<'_>,
    stores: &[ExportStore],
) -> Result<ExportStore, UnknownReferent> {
    let Some(&last) = stores.iter().max_by_key(|store| hir[store.node].pos) else {
        return Err(UnknownReferent::MissingMember);
    };
    if is_evaluated_by_file_body(hir, bound, last.node) {
        return Ok(last);
    }
    let mut usual_stores = stores
        .iter()
        .filter(|store| !is_in_catch_clause(hir, bound, store.node));
    match (usual_stores.next(), usual_stores.next()) {
        (Some(&only), None) => Ok(only),
        (None, _) if stores.len() == 1 => Ok(last),
        (Some(_), Some(_)) | (None, _) => {
            let unstable = BindingStability::NotInitializedOnce;
            Err(UnknownReferent::UnstableBinding(unstable))
        }
    }
}

struct Trail<T> {
    items: SmallVec<[T; 8]>,
    first_seen: usize,
    places: Option<FxHashMap<T, SmallVec<[u32; 1]>>>,
}

#[derive(Copy, Clone)]
struct PlaceInTrail {
    len: usize,
    first_seen: usize,
}

impl<T: Copy + Eq + Hash> Trail<T> {
    const LONG: usize = 32;

    fn new() -> Self {
        Trail {
            items: SmallVec::new(),
            first_seen: 0,
            places: None,
        }
    }

    fn seen(&self) -> &[T] {
        &self.items[self.first_seen..]
    }

    fn last_place_of(&self, item: T) -> Option<usize> {
        match &self.places {
            Some(places) => {
                let place = *places.get(&item)?.last()? as usize;
                (place >= self.first_seen).then_some(place)
            }
            None => {
                let place = self.seen().iter().rposition(|&it| it == item)?;
                Some(self.first_seen + place)
            }
        }
    }

    fn contains(&self, item: T) -> bool {
        self.last_place_of(item).is_some()
    }

    fn push(&mut self, item: T) {
        let place = self.items.len() as u32;
        self.items.push(item);
        match &mut self.places {
            Some(places) => places.entry(item).or_default().push(place),
            None if self.items.len() > Self::LONG => {
                let mut places = FxHashMap::<T, SmallVec<[u32; 1]>>::default();
                for (place, &item) in self.items.iter().enumerate() {
                    places.entry(item).or_default().push(place as u32);
                }
                self.places = Some(places);
            }
            None => {}
        }
    }

    fn forget(&mut self) {
        self.first_seen = self.items.len();
    }

    fn place(&self) -> PlaceInTrail {
        PlaceInTrail {
            len: self.items.len(),
            first_seen: self.first_seen,
        }
    }

    fn go_back_to(&mut self, place: PlaceInTrail) {
        while self.items.len() > place.len {
            let Some(item) = self.items.pop() else { break };
            let Some(places) = &mut self.places else {
                continue;
            };
            if let Some(places_of_item) = places.get_mut(&item) {
                places_of_item.pop();
                if places_of_item.is_empty() {
                    places.remove(&item);
                }
            }
        }
        self.first_seen = place.first_seen;
    }
}

pub(super) struct ReferentWalk<'c, 's, C: ReferentContext<'s>> {
    context: &'c C,
    visited: Trail<Sym>,
    pending_members: SmallVec<[Atom; 4]>,
    entered_callees: Trail<FunctionRef>,
    entered_calls: SmallVec<[(FileId, CallId); 2]>,
    open_calls: Trail<(FileId, CallId)>,
    followed_stores: Trail<(FileId, ExprId)>,
    certainty: ReferentCertainty,
    follows_stored_members: bool,
    session: PhantomData<&'s ()>,
}

impl<'c, 's, C: ReferentContext<'s>> ReferentWalk<'c, 's, C> {
    pub(super) fn new(context: &'c C) -> Self {
        ReferentWalk {
            context,
            visited: Trail::new(),
            pending_members: SmallVec::new(),
            entered_callees: Trail::new(),
            entered_calls: SmallVec::new(),
            open_calls: Trail::new(),
            followed_stores: Trail::new(),
            certainty: ReferentCertainty::Proven,
            follows_stored_members: false,
            session: PhantomData,
        }
    }

    pub(super) fn resolve_export(
        mut self,
        file: FileId,
        name: Atom,
        member: Option<Atom>,
    ) -> ResolvedReferent<C::Builtin, C::Module> {
        self.follows_stored_members = true;
        self.pending_members.extend(member);
        let step = self.step_export(file, name);
        self.run(step)
    }

    pub(super) fn resolve_expression(
        mut self,
        file: FileId,
        expr: ExprId,
    ) -> ResolvedReferent<C::Builtin, C::Module> {
        self.run(Step::Expression(file, expr))
    }

    pub(super) fn resolve_symbol(mut self, symbol: Sym) -> ResolvedReferent<C::Builtin, C::Module> {
        self.run(Step::Symbol(symbol))
    }

    fn run(&mut self, mut step: StepOf<'s, C>) -> ResolvedReferent<C::Builtin, C::Module> {
        loop {
            step = match step {
                Step::Expression(file, expr) => self.step_expression(file, expr),
                Step::Symbol(symbol) => self.step_symbol(symbol),
                Step::Linked(LinkedBinding::Binding(symbol)) => Step::Symbol(symbol),
                Step::Linked(LinkedBinding::Namespace(module)) => {
                    Step::Found(StaticReferent::Namespace(NamespaceReferent::Module(module)))
                }
                Step::Linked(LinkedBinding::Builtin(builtin)) => {
                    Step::Found(StaticReferent::Builtin(builtin))
                }
                Step::Linked(LinkedBinding::ExportOfCommonJs { file, name }) => {
                    self.step_export_of_common_js(file, name)
                }
                Step::Linked(LinkedBinding::Unknown) => unknown(UnknownReferent::UnlinkedImport),
                Step::Found(referent) => match self.pending_members.pop() {
                    Some(name) => self.step_member(referent, name),
                    None => {
                        return ResolvedReferent {
                            referent,
                            certainty: self.certainty,
                        };
                    }
                },
            };
        }
    }

    fn branch_off<R>(&mut self, walk_on: impl FnOnce(&mut Self) -> R) -> R {
        let visited = self.visited.place();
        let entered_callees = self.entered_callees.place();
        let open_calls = self.open_calls.place();
        let followed_stores = self.followed_stores.place();
        let pending_members = self.pending_members.clone();
        let (certainty, follows_stored_members) = (self.certainty, self.follows_stored_members);
        let result = walk_on(self);
        self.visited.go_back_to(visited);
        self.entered_callees.go_back_to(entered_callees);
        self.entered_calls.truncate(entered_callees.len);
        self.open_calls.go_back_to(open_calls);
        self.followed_stores.go_back_to(followed_stores);
        self.pending_members = pending_members;
        (self.certainty, self.follows_stored_members) = (certainty, follows_stored_members);
        result
    }

    fn resolve_from_here(
        &mut self,
        file: FileId,
        expr: ExprId,
    ) -> ResolvedReferent<C::Builtin, C::Module> {
        self.branch_off(|walk| walk.run(Step::Expression(file, expr)))
    }

    fn step_export_of_common_js(&mut self, file: FileId, name: Option<Atom>) -> StepOf<'s, C> {
        self.certainty = ReferentCertainty::Expected;
        match name {
            Some(known::default) => {
                let marked = self.branch_off(|marked| {
                    marked.pending_members.push(known::default);
                    let step = marked.step_module_exports(file);
                    marked.run(step).referent
                });
                match marked {
                    StaticReferent::Unknown(_) => self.step_module_exports(file),
                    found => {
                        self.pending_members.clear();
                        Step::Found(found)
                    }
                }
            }
            Some(name) => {
                self.pending_members.push(name);
                self.step_module_exports(file)
            }
            None => self.step_module_exports(file),
        }
    }

    fn step_into_call(&mut self, callee: FunctionRef, file: FileId, call: CallId) -> StepOf<'s, C> {
        let context = self.context;
        if self.entered_callees.contains(callee) {
            return unknown(UnknownReferent::Cycle);
        }
        let (hir, bound) = (context.hir(callee.file), context.bound(callee.file));
        match find_only_returned_value(hir, bound, callee.function) {
            Some(value) => {
                self.certainty = ReferentCertainty::Expected;
                self.entered_callees.push(callee);
                self.entered_calls.push((file, call));
                Step::Expression(callee.file, value)
            }
            None => unknown(UnknownReferent::NotAReference),
        }
    }

    fn find_argument_of_entered_call(&self, parameter: Sym) -> Option<(FileId, ExprId)> {
        let (hir, bound) = (
            self.context.hir(parameter.file),
            self.context.bound(parameter.file),
        );
        let (function, index) = find_place_of_plain_parameter(hir, bound, parameter.id)?;
        let callee = FunctionRef {
            file: parameter.file,
            function,
        };
        let (file, call) = self.entered_calls[self.entered_callees.last_place_of(callee)?];
        let argument = find_argument_at(self.context.hir(file), call, index)?;
        Some((file, argument))
    }

    fn visit(&mut self, symbol: Sym) -> bool {
        let is_first_visit = !self.visited.contains(symbol);
        if is_first_visit {
            self.visited.push(symbol);
        }
        is_first_visit
    }

    fn step_expression(&mut self, file: FileId, expr: ExprId) -> StepOf<'s, C> {
        let context = self.context;
        let hir = context.hir(file);
        let expr = hir.skip_type_assertions(expr);
        if reads_module_exports(hir, context.bound(file), expr) {
            return self.step_module_exports(file);
        }
        if let Some(builtin) = context.builtin_of_expression(file, expr) {
            return Step::Found(StaticReferent::Builtin(builtin));
        }
        match hir[expr].kind {
            ExprKind::Ident(_) => self.step_identifier(file, expr),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => Step::Expression(file, right),
            ExprKind::Cond { branches, .. } => {
                let branches = hir.branches(branches);
                let yes = self.resolve_from_here(file, branches.yes).referent;
                let no = self.resolve_from_here(file, branches.no).referent;
                let name_one_thing = match (&yes, &no) {
                    (StaticReferent::Function(yes), StaticReferent::Function(no)) => yes == no,
                    (StaticReferent::Class(yes), StaticReferent::Class(no)) => yes == no,
                    _ => false,
                };
                if name_one_thing {
                    self.certainty = ReferentCertainty::Expected;
                    self.pending_members.clear();
                    Step::Found(yes)
                } else {
                    unknown(UnknownReferent::NotAReference)
                }
            }
            ExprKind::Class(class) => self.class_step(file, class),
            ExprKind::Fn(function) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            ExprKind::Dot {
                chain: Chain::No, ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => match hir.member_key(expr) {
                Some((object, MemberKey::Name(name))) => {
                    self.pending_members.push(name);
                    Step::Expression(file, object)
                }
                Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
                    unknown(UnknownReferent::NotAReference)
                }
            },
            ExprKind::Assign {
                op: None, value, ..
            } => Step::Expression(file, value),
            ExprKind::Object(properties) => self.step_object_literal(file, properties),
            ExprKind::Binary { op: BinOp::Or, .. } => {
                match find_value_unless_this_of_file_has_one(hir, context.bound(file), expr) {
                    Some(value) => {
                        self.certainty = ReferentCertainty::Expected;
                        Step::Expression(file, value)
                    }
                    None => unknown(UnknownReferent::NotAReference),
                }
            }
            ExprKind::Call(site) => match context.loaded_value(file, expr) {
                Some(loaded) => self.step_loaded_value(loaded),
                None => match hir[hir.skip_type_assertions(hir[site].callee)].kind {
                    ExprKind::Fn(function) => {
                        match find_only_returned_value(hir, context.bound(file), function) {
                            Some(value) => Step::Expression(file, value),
                            None => unknown(UnknownReferent::NotAReference),
                        }
                    }
                    _ => self.step_call_that_returns_its_argument(file, site),
                },
            },
            _ => unknown(UnknownReferent::NotAReference),
        }
    }

    fn step_call_that_returns_its_argument(&mut self, file: FileId, site: CallId) -> StepOf<'s, C> {
        let context = self.context;
        let hir = context.hir(file);
        if self.open_calls.contains((file, site)) {
            return unknown(UnknownReferent::Cycle);
        }
        self.open_calls.push((file, site));
        let callee = self.branch_off(|walk_to_callee| {
            walk_to_callee.pending_members.clear();
            walk_to_callee.certainty = ReferentCertainty::Proven;
            walk_to_callee.run(Step::Expression(file, hir[site].callee))
        });
        let StaticReferent::Function(callee) = callee.referent else {
            return unknown(UnknownReferent::NotAReference);
        };
        let (hir_of_callee, bound_of_callee) =
            (context.hir(callee.file), context.bound(callee.file));
        let index =
            find_index_of_returned_parameter(hir_of_callee, bound_of_callee, callee.function);
        let Some(index) = index else {
            return self.step_into_call(callee, file, site);
        };
        let mut arguments = hir.ids(hir[site].args).take(index + 1);
        if arguments
            .clone()
            .any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
        {
            return unknown(UnknownReferent::NotAReference);
        }
        match arguments.nth(index) {
            Some(argument) => {
                self.certainty = ReferentCertainty::Expected;
                Step::Expression(file, argument)
            }
            None => unknown(UnknownReferent::NotAReference),
        }
    }

    fn step_identifier(&self, file: FileId, ident: ExprId) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        if bound.dynamic_lookup_scope(NodeData::Expr(ident)).is_some() {
            return unknown(UnknownReferent::DynamicScope);
        }
        self.binding_step(file, bound.binding(ident))
    }

    fn binding_step(&self, file: FileId, binding: Binding) -> StepOf<'s, C> {
        match binding {
            Binding::Symbol(id) => Step::Symbol(Sym { file, id }),
            Binding::Arguments(_) | Binding::CommonJs(_) => unknown(UnknownReferent::NotAReference),
            Binding::Free => unknown(UnknownReferent::FreeName),
        }
    }

    fn class_step(&self, file: FileId, class: ClassId) -> StepOf<'s, C> {
        let hir = self.context.hir(file);
        if has_decorators(hir, hir[class].modifiers) {
            return unknown(UnknownReferent::DecoratedClass);
        }
        Step::Found(StaticReferent::Class(ClassRef { file, class }))
    }

    fn step_object_literal(&mut self, file: FileId, properties: Span<PropId>) -> StepOf<'s, C> {
        let Some(name) = self.pending_members.pop() else {
            return unknown(UnknownReferent::NotAReference);
        };
        if name == known::__proto__ {
            return unknown(UnknownReferent::MemberOfValue);
        }
        let context = self.context;
        let hir = context.hir(file);
        let mut value = None;
        for property in properties.iter() {
            let holds_value = match hir[property].kind {
                PropKind::Init | PropKind::Shorthand | PropKind::Method => true,
                PropKind::Getter | PropKind::Setter | PropKind::Spread => false,
            };
            match hir.runtime_property_key(property) {
                PropKey::Name(key) if key != name => {}
                PropKey::Private(_) => {}
                PropKey::Name(_) if holds_value => value = Some(hir[property].value),
                PropKey::Name(_) | PropKey::None | PropKey::Computed(_) => value = None,
            }
        }
        self.certainty = ReferentCertainty::Expected;
        match value {
            Some(value) => Step::Expression(file, value),
            None if self.follows_stored_members || context.member_stores(file).is_some() => {
                self.step_stored_member(name)
            }
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_loaded_value(&mut self, loaded: LoadedValue<C::Module>) -> StepOf<'s, C> {
        self.certainty = ReferentCertainty::Expected;
        match loaded {
            LoadedValue::Namespace(module) => Step::Linked(LinkedBinding::Namespace(module)),
            LoadedValue::DefaultExport(file) => self.step_default_export(file),
            LoadedValue::ModuleExports(file) => self.step_module_exports(file),
        }
    }

    fn step_default_export(&mut self, file: FileId) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        let exports = bound.symbol(bound.file_symbol).exports;
        if !bound.runtime.is_computed() || bound.lookup(exports, known::default).is_some() {
            return self.step_export(file, known::default);
        }
        let listed = self
            .pending_members
            .last()
            .and_then(|&name| bound.lookup(exports, name));
        match listed.map(|member| bound.symbol(member).decls) {
            Some(&[Decl::ExportSpec(specifier)]) => {
                self.pending_members.pop();
                self.binding_step(file, bound.exported_binding(specifier))
            }
            Some(_) | None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_export(&self, file: FileId, name: Atom) -> StepOf<'s, C> {
        let bound = self.context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        match bound.lookup(bound.symbol(bound.file_symbol).exports, name) {
            Some(id) => Step::Symbol(Sym { file, id }),
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn live_export_stores(
        &self,
        exported: Sym,
        find_store: FindExportStore,
    ) -> SmallVec<[ExportStore; 4]> {
        let Sym { file, id } = exported;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let declarations = bound.symbol(id).decls.iter();
        declarations
            .filter_map(|&declaration| find_store(hir, bound, declaration))
            .filter(|store| !context.is_dead_store(file, store.target))
            .collect()
    }

    fn step_module_exports(&mut self, file: FileId) -> StepOf<'s, C> {
        let context = self.context;
        let bound = context.bound(file);
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        let exports = bound.symbol(bound.file_symbol).exports;
        let next_member = self.pending_members.last().copied();
        if let Some(id) = next_member.and_then(|name| bound.lookup(exports, name)) {
            let property = Sym { file, id };
            let stores = self.live_export_stores(property, find_store_of_property);
            if !stores.is_empty() {
                self.pending_members.pop();
                return self.step_export_stores(property, &stores);
            }
        }
        let whole = bound.lookup(exports, known::export_equals);
        let whole = whole.map(|id| Sym { file, id });
        let stores = whole.map(|whole| self.live_export_stores(whole, find_store_of_whole));
        if let (Some(whole), Some(stores)) = (whole, &stores)
            && !stores.is_empty()
        {
            return self.step_export_stores(whole, stores);
        }
        let stored_by_call = next_member
            .and_then(|name| find_value_stored_in_exports_by_call(context.hir(file), bound, name));
        match (stored_by_call, whole, next_member) {
            (Some(value), ..) => {
                self.pending_members.pop();
                Step::Expression(file, value)
            }
            (None, Some(whole), _) => self.step_export_stores(whole, &[]),
            (None, None, None) => unknown(UnknownReferent::NotAReference),
            (None, None, Some(_)) => unknown(UnknownReferent::MissingMember),
        }
    }

    fn step_export_stores(&mut self, exported: Sym, stores: &[ExportStore]) -> StepOf<'s, C> {
        if !self.visit(exported) {
            return unknown(UnknownReferent::Cycle);
        }
        let file = exported.file;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let store = match find_deciding_store(hir, bound, stores) {
            Ok(store) => store,
            Err(reason) => return unknown(reason),
        };
        if let Parent::VarInit(declaration) = bound.parent_of_expr(store.node)
            && matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_))
        {
            let id = bound.pat_symbol[hir[declaration].pat.idx()];
            if bound.is_stable_binding(id) {
                self.visit(Sym { file, id });
            }
        }
        match store.value {
            Some(value) => Step::Expression(file, value),
            None => unknown(UnknownReferent::OpaqueInitializer),
        }
    }

    fn step_symbol(&mut self, symbol: Sym) -> StepOf<'s, C> {
        if !self.visit(symbol) {
            return unknown(UnknownReferent::Cycle);
        }
        let Sym { file, id } = symbol;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        if !bound.runtime.is_computed() {
            return unknown(UnknownReferent::NotCompiled);
        }
        let is_dead_store = |target: ExprId| context.is_dead_store(file, target);
        match bound.binding_stability_ignoring(id, &is_dead_store) {
            BindingStability::Stable => {}
            BindingStability::Linked => return Step::Linked(context.linked_binding(file, id)),
            unstable @ (BindingStability::NoBinding
            | BindingStability::Stored
            | BindingStability::NotInitializedOnce
            | BindingStability::VisibleToEval
            | BindingStability::MappedArgument
            | BindingStability::ContainerMember) => {
                return match find_value_of_only_store(hir, bound, id, &is_dead_store) {
                    Some(value) => {
                        self.certainty = ReferentCertainty::Expected;
                        Step::Expression(file, value)
                    }
                    None => unknown(UnknownReferent::UnstableBinding(unstable)),
                };
            }
        }
        if bound.initial_state(id) == InitialState::Undefined {
            self.certainty = ReferentCertainty::Expected;
        }
        match bound.binding_initializer(hir, id) {
            BindingInitializer::Class(class) => self.class_step(file, class),
            BindingInitializer::Function(function) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            BindingInitializer::Namespace(_) | BindingInitializer::Enum(_) => {
                let id = bound.export_symbol_of_value_symbol_if_exported(id);
                let container = NamespaceReferent::Declared(Sym { file, id });
                Step::Found(StaticReferent::Namespace(container))
            }
            BindingInitializer::Expression(value) => Step::Expression(file, value),
            BindingInitializer::PatternProperty { source, path } => {
                self.pending_members.extend(path.iter().rev().copied());
                Step::Expression(file, source)
            }
            BindingInitializer::EntityName(import) => self.step_entity_name(file, import),
            BindingInitializer::Import => Step::Linked(context.linked_binding(file, id)),
            BindingInitializer::Opaque if bound.binding_kind(id) == BindingKind::Parameter => {
                let passed = self.find_argument_of_entered_call(symbol);
                let only = || Some((file, find_argument_of_only_call(hir, bound, id)?));
                match passed.or_else(only) {
                    Some((file, argument)) => Step::Expression(file, argument),
                    None => unknown(UnknownReferent::OpaqueInitializer),
                }
            }
            BindingInitializer::Opaque => unknown(UnknownReferent::OpaqueInitializer),
        }
    }

    fn step_entity_name(&mut self, file: FileId, import: ImportEqualsId) -> StepOf<'s, C> {
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let ImportEqualsTarget::Entity(names) = hir[import].target else {
            return unknown(UnknownReferent::OpaqueInitializer);
        };
        self.pending_members.extend(hir.texts(names).skip(1).rev());
        self.binding_step(file, bound.entity_root_binding(import))
    }

    fn step_member(
        &mut self,
        referent: StaticReferent<C::Builtin, C::Module>,
        name: Atom,
    ) -> StepOf<'s, C> {
        match referent {
            StaticReferent::Namespace(NamespaceReferent::Module(module)) => {
                Step::Linked(self.context.module_export(module, name))
            }
            StaticReferent::Namespace(NamespaceReferent::Declared(container)) => {
                self.step_declared_member(container, name)
            }
            StaticReferent::Builtin(holder) => match self.context.builtin_member(holder, name) {
                Some(member) => {
                    self.certainty = ReferentCertainty::Expected;
                    Step::Found(StaticReferent::Builtin(member))
                }
                None => unknown(UnknownReferent::MemberOfValue),
            },
            StaticReferent::Class(_) | StaticReferent::Function(_) => {
                match self.follows_stored_members {
                    true => self.step_stored_member(name),
                    false => unknown(UnknownReferent::MemberOfValue),
                }
            }
            StaticReferent::Unknown(reason) => unknown(reason),
        }
    }

    fn step_stored_member(&mut self, name: Atom) -> StepOf<'s, C> {
        let mut stored = None;
        for &holder in self.visited.seen() {
            for value in self.values_stored_in_member(holder, name) {
                if stored.replace((holder.file, value)).is_some() {
                    let unstable = BindingStability::NotInitializedOnce;
                    return unknown(UnknownReferent::UnstableBinding(unstable));
                }
            }
        }
        self.certainty = ReferentCertainty::Expected;
        self.visited.forget();
        match stored {
            Some(store) if self.followed_stores.contains(store) => unknown(UnknownReferent::Cycle),
            Some((file, value)) => {
                self.followed_stores.push((file, value));
                Step::Expression(file, value)
            }
            None => unknown(UnknownReferent::MissingMember),
        }
    }

    fn values_stored_in_member(&self, holder: Sym, name: Atom) -> SmallVec<[ExprId; 2]> {
        let context = self.context;
        let file = holder.file;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let names_holder = |expr: ExprId| {
            let expr = hir.skip_type_assertions(expr);
            matches!(hir[expr].kind, ExprKind::Ident(_))
                && bound.binding(expr) == Binding::Symbol(holder.id)
        };
        let mut values = SmallVec::new();
        if let Some(stores) = context.member_stores(file) {
            let key = (holder.id.idx(), name.0);
            let assignments = &stores.assignments;
            let start = assignments.partition_point(|it| (it.holder.idx(), it.name.0) < key);
            let stored = assignments[start..]
                .iter()
                .take_while(|it| (it.holder.idx(), it.name.0) == key);
            values.extend(
                stored
                    .filter(|it| !context.is_dead_store(file, it.target))
                    .map(|it| it.value),
            );
            let start = (stores.copies).partition_point(|it| it.0.idx() < holder.id.idx());
            let copies = stores.copies[start..]
                .iter()
                .take_while(|it| it.0 == holder.id);
            values.extend(
                copies.filter_map(|it| self.find_copied_property(file, it.1, name, &names_holder)),
            );
            return values;
        }
        for node in (0..hir.exprs.len() as u32).map(ExprId) {
            let value = match hir[node].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } => match hir.member_key(target) {
                    Some((object, MemberKey::Name(key))) if key == name && names_holder(object) => {
                        (!context.is_dead_store(file, target)).then_some(value)
                    }
                    _ => None,
                },
                ExprKind::Call(call) => self.find_copied_property(file, call, name, &names_holder),
                _ => None,
            };
            if let Some(value) = value
                && is_evaluated_by_file_body(hir, bound, node)
            {
                values.push(value);
            }
        }
        values
    }

    fn find_copied_property(
        &self,
        file: FileId,
        call: CallId,
        name: Atom,
        names_holder: &dyn Fn(ExprId) -> bool,
    ) -> Option<ExprId> {
        let context = self.context;
        let hir = context.hir(file);
        let callee = hir.skip_type_assertions(hir[call].callee);
        let builtin = context.builtin_of_expression(file, callee)?;
        let target = context.find_target_of_copied_properties(builtin)? as usize;
        let mut arguments = hir.ids(hir[call].args).skip(target);
        if !names_holder(arguments.next()?) {
            return None;
        }
        let mut value = None;
        for source in arguments {
            let ExprKind::Object(properties) = hir[hir.skip_type_assertions(source)].kind else {
                continue;
            };
            for property in properties.iter() {
                let holds_value = matches!(
                    hir[property].kind,
                    PropKind::Init | PropKind::Shorthand | PropKind::Method
                );
                if holds_value && hir.runtime_property_key(property) == PropKey::Name(name) {
                    value = Some(hir[property].value);
                }
            }
        }
        value
    }

    fn step_declared_member(&mut self, container: Sym, name: Atom) -> StepOf<'s, C> {
        let file = container.file;
        let context = self.context;
        let (hir, bound) = (context.hir(file), context.bound(file));
        let Some(member) = bound.lookup(bound.symbol(container.id).exports, name) else {
            return unknown(UnknownReferent::MissingMember);
        };
        self.certainty = ReferentCertainty::Expected;
        let mut value = None;
        let mut has_container = false;
        for &decl in bound.symbol(member).decls {
            if bound.modifier_flags(hir, decl).contains(Flags::AMBIENT) {
                continue;
            }
            match decl {
                Decl::Fn(function) if has_body(&hir[function]) => {
                    value = value.or(Some(DeclaredValue::Function(function)));
                }
                Decl::Class(class) => value = value.or(Some(DeclaredValue::Class(class))),
                Decl::Module(_) | Decl::Enum(_) => has_container = true,
                Decl::Fn(_) | Decl::Interface(_) | Decl::Alias(_) => {}
                _ => {
                    let unstable = BindingStability::ContainerMember;
                    return unknown(UnknownReferent::UnstableBinding(unstable));
                }
            }
        }
        match value {
            Some(DeclaredValue::Function(function)) => {
                Step::Found(StaticReferent::Function(FunctionRef { file, function }))
            }
            Some(DeclaredValue::Class(class)) => self.class_step(file, class),
            None if has_container => {
                let container = NamespaceReferent::Declared(Sym { file, id: member });
                Step::Found(StaticReferent::Namespace(container))
            }
            None => unknown(UnknownReferent::MissingMember),
        }
    }
}
