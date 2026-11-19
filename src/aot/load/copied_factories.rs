mod copier;

use bun_core::StackCheck;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, ClassOwner, CodeUnit, Decl, FnOwner, FunctionFlags, Parent,
    ScopeId, ScopeKind, SymbolId,
};
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    BinOp, CallId, Chain, ClassId, CopiedFactory, ExprId, ExprKind, File, FileBuilder, Flags,
    FnBody, FnId, FnKind, MemberKey, NodeData, PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp,
    end_of_expr,
};
use bun_sema::resolve::TreeChange;
use bun_sema::session::Arena;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::cell::OnceCell;

use self::copier::FunctionCopier;
use crate::load::react_compiler::module_items::finish_file;

#[derive(Clone, PartialEq, Eq, Hash)]
struct Place {
    root: SymbolId,
    names: SmallVec<[Atom; 4]>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Created {
    Function(FnId),
    Class(ClassId),
}

#[derive(Copy, Clone)]
struct CalledFactory {
    sequence: ExprId,
    call: CallId,
    factory: FnId,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct CallScope {
    innermost: ScopeId,
    of_statement: ScopeId,
}

struct Finder<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
    expressions: OnceCell<Vec<(u32, u32)>>,
    appended: OnceCell<FxHashMap<(ScopeId, Atom), SmallVec<[SymbolId; 1]>>>,
}

impl Finder<'_, '_> {
    fn find_place(&self, mut expression: ExprId) -> Option<Place> {
        let (hir, bound) = (self.hir, self.bound);
        let mut names = SmallVec::new();
        loop {
            expression = hir.skip_type_assertions(expression);
            match hir.member_key(expression) {
                Some((_, MemberKey::Name(known::prototype | known::__proto__))) => return None,
                Some((object, MemberKey::Name(name))) => {
                    names.push(name);
                    expression = object;
                }
                Some(_) => return None,
                None => break,
            }
        }
        match (hir[expression].kind, bound.binding(expression)) {
            (ExprKind::Ident(_), Binding::Symbol(root)) => Some(Place { root, names }),
            _ => None,
        }
    }

    fn find_holder(&self, expression: ExprId) -> Option<Place> {
        let (hir, bound) = (self.hir, self.bound);
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        let mut value = bound.outermost_type_assertion(hir, expression);
        loop {
            match bound.parent_of_expr(value) {
                Parent::VarInit(declaration) => {
                    let pattern = hir[declaration].pat;
                    if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
                        return None;
                    }
                    let root = bound.declared_symbol(Decl::Var(pattern)).some()?;
                    return Some(Place { root, names });
                }
                Parent::Prop(property) => {
                    let PropKey::Name(name) = hir.runtime_property_key(property) else {
                        return None;
                    };
                    let literal = bound.prop_owner[property.idx()];
                    let is_value = matches!(hir[property].kind, PropKind::Init | PropKind::Method);
                    if !is_value || !matches!(hir[literal].kind, ExprKind::Object(_)) {
                        return None;
                    }
                    names.push(name);
                    value = bound.outermost_type_assertion(hir, literal);
                }
                Parent::Expr(parent) => match hir[parent.some()?].kind {
                    ExprKind::Assign {
                        op: None,
                        target,
                        value: stored,
                    } if stored == value => {
                        let mut place = self.find_place(target)?;
                        names.extend(place.names);
                        place.names = names;
                        return Some(place);
                    }
                    _ => return None,
                },
                _ => return None,
            }
        }
    }

    fn find_created_by_value(&self, factory: FnId, value: ExprId) -> Option<Created> {
        let (hir, bound) = (self.hir, self.bound);
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Fn(function) => self.created_constructor(function),
            ExprKind::Class(class) => Some(Created::Class(class)),
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(value) else {
                    return None;
                };
                let unit = bound.code_unit(bound.symbol_scope(symbol));
                if unit != CodeUnit::Function(factory) || !bound.is_stable_binding(symbol) {
                    return None;
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Function(function) => self.created_constructor(function),
                    BindingInitializer::Class(class) => Some(Created::Class(class)),
                    BindingInitializer::Expression(value) => {
                        match hir[hir.skip_type_assertions(value)].kind {
                            ExprKind::Fn(function) => self.created_constructor(function),
                            ExprKind::Class(class) => Some(Created::Class(class)),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn created_constructor(&self, function: FnId) -> Option<Created> {
        let written = &self.hir[function];
        let is_constructor = matches!(written.kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
            && !written.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        is_constructor.then_some(Created::Function(function))
    }

    fn expressions_within(&self, start: u32, end: u32) -> impl Iterator<Item = ExprId> + '_ {
        let all = self.expressions.get_or_init(|| {
            let expressions = self.hir.exprs.iter().enumerate();
            let mut all: Vec<(u32, u32)> = expressions
                .map(|(index, it)| (it.pos, index as u32))
                .collect();
            all.sort_unstable();
            all
        });
        let first = all.partition_point(|it| it.0 < start);
        let found = all[first..].iter().take_while(move |it| it.0 < end);
        found.map(|it| ExprId(it.1))
    }

    fn captures_from(&self, factory: FnId, function: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some((start, end)) = find_text(hir, bound, function) else {
            return false;
        };
        let (outer, inner) = (
            bound.fns[factory.idx()].scope,
            bound.fns[function.idx()].scope,
        );
        self.expressions_within(start, end).any(|expression| {
            let Binding::Symbol(symbol) = bound.binding(expression) else {
                return false;
            };
            let declaring = bound.symbol_scope(symbol);
            matches!(hir[expression].kind, ExprKind::Ident(_))
                && self.is_inside(declaring, outer)
                && !self.is_inside(declaring, inner)
        })
    }

    fn is_iteration_callback(&self, callback: ExprId) -> bool {
        let hir = self.hir;
        let Parent::Expr(parent) = self.bound.parent_of_expr(callback) else {
            return false;
        };
        let Some(parent) = parent.some() else {
            return false;
        };
        let ExprKind::Call(call) = hir[parent].kind else {
            return false;
        };
        let ExprKind::Dot { name, .. } = hir[hir[call].callee].kind else {
            return false;
        };
        matches!(
            self.atoms.bytes(name),
            b"every"
                | b"filter"
                | b"find"
                | b"findIndex"
                | b"findLast"
                | b"flatMap"
                | b"forEach"
                | b"map"
                | b"reduce"
                | b"reduceRight"
                | b"some"
                | b"sort"
        )
    }

    fn is_literal(&self, expression: ExprId) -> bool {
        match self.hir[expression].kind {
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_) => true,
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => matches!(self.hir[operand].kind, ExprKind::Number(_)),
            _ => false,
        }
    }

    fn can_be_literal(&self, read: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        match bound.parent_of_expr(read) {
            Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => hir[call].callee != read,
                ExprKind::Binary { .. } | ExprKind::Index { .. } | ExprKind::Cond { .. } => true,
                ExprKind::Unary { op, .. } => {
                    matches!(
                        op,
                        UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot | UnOp::Typeof
                    )
                }
                ExprKind::Assign { target, .. } => target != read,
                _ => false,
            },
            Parent::FnBody(_) | Parent::VarInit(_) | Parent::Stmt(_) => true,
            _ => false,
        }
    }

    fn find_literals(&self, it: &CalledFactory) -> FxHashMap<ExprId, ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let mut values: FxHashMap<SymbolId, ExprId> = FxHashMap::default();
        let arguments = hir.ids(hir[it.call].args);
        for (param, argument) in hir[it.factory].params.iter().zip(arguments) {
            let argument: ExprId = argument;
            let (pat, flags) = (hir[param].pat, hir[param].flags);
            if matches!(hir[argument].kind, ExprKind::Spread(_)) || flags.contains(Flags::REST) {
                break;
            }
            let argument = hir.skip_type_assertions(argument);
            if matches!(hir[pat].kind, PatKind::Ident(_))
                && self.is_literal(argument)
                && let Some(symbol) = bound.declared_symbol(Decl::Param(pat)).some()
                && bound.is_stable_binding(symbol)
            {
                values.insert(symbol, argument);
            }
        }
        let Some((start, end)) = find_text(hir, bound, it.factory) else {
            return FxHashMap::default();
        };
        if values.is_empty() {
            return FxHashMap::default();
        }
        let literal_at = |read: ExprId| match (hir[read].kind, bound.binding(read)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) if self.can_be_literal(read) => {
                Some((read, *values.get(&symbol)?))
            }
            _ => None,
        };
        self.expressions_within(start, end)
            .filter_map(literal_at)
            .collect()
    }

    fn is_in_loop(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut parent = bound.parent_of_expr(expression);
        loop {
            parent = match parent {
                Parent::Expr(above) if above.is_some() => bound.parent_of_expr(above),
                Parent::VarInit(declaration) => {
                    let Some(statement) = bound.var_stmt[declaration.idx()].some() else {
                        return false;
                    };
                    bound.parent_of_stmt(statement)
                }
                Parent::Prop(property) | Parent::PropKey(property) => {
                    let Some(literal) = bound.prop_owner[property.idx()].some() else {
                        return false;
                    };
                    bound.parent_of_expr(literal)
                }
                Parent::Stmt(statement) if statement.is_some() => match hir[statement].kind {
                    StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. } => return true,
                    _ => bound.parent_of_stmt(statement),
                },
                Parent::FnBody(function) => {
                    let FnOwner::Expr(callback) = bound.fns[function.idx()].owner else {
                        return false;
                    };
                    if self.is_iteration_callback(callback) {
                        return true;
                    }
                    if !bound.is_called_only_where_written(hir, function) {
                        return false;
                    }
                    bound.parent_of_expr(callback)
                }
                _ => return false,
            };
        }
    }

    fn find_final_holder(&self, sequence: ExprId, sequences: &FxHashSet<ExprId>) -> Option<Place> {
        let (hir, bound) = (self.hir, self.bound);
        let mut value = sequence;
        loop {
            if let Some(holder) = self.find_holder(value) {
                return Some(holder);
            }
            match bound.parent_of_expr(bound.outermost_type_assertion(hir, value)) {
                Parent::Expr(call) if sequences.contains(&call) => value = call,
                _ => return None,
            }
        }
    }

    fn find_places_called_in_loops(&self, places: &FxHashSet<Place>) -> FxHashSet<Place> {
        let hir = self.hir;
        let mut found = FxHashSet::default();
        for (index, expression) in hir.exprs.iter().enumerate() {
            if let ExprKind::Call(call) = expression.kind
                && let Some(place) = self.find_place(hir[call].callee)
                && places.contains(&place)
                && !found.contains(&place)
                && self.is_in_loop(ExprId(index as u32))
            {
                found.insert(place);
            }
        }
        found
    }

    fn find_created(&self, factory: FnId) -> Option<Created> {
        let (hir, bound) = (self.hir, self.bound);
        let written = &hir[factory];
        if !matches!(
            written.kind,
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method
        ) || written
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT | Flags::REPLACED_BODY)
        {
            return None;
        }
        match written.body {
            FnBody::None => None,
            FnBody::Expr(value) => self.find_created_by_value(factory, value),
            FnBody::Block(_) => {
                let mut created: Option<Created> = None;
                for statement in bound.ids(bound.fns[factory.idx()].returns) {
                    let statement: StmtId = statement;
                    let StmtKind::Return(value) = hir[statement].kind else {
                        return None;
                    };
                    let found = self.find_created_by_value(factory, value.some()?)?;
                    if created.is_some_and(|it| it != found) {
                        return None;
                    }
                    created = Some(found);
                }
                created
            }
        }
    }

    fn find_last_declaration(&self, symbol: SymbolId) -> Option<FnId> {
        let mut declarations = self.bound.symbol(symbol).decls.iter().rev();
        declarations.find_map(|&declaration| match declaration {
            Decl::Fn(function) if !matches!(self.hir[function].body, FnBody::None) => {
                Some(function)
            }
            _ => None,
        })
    }

    fn find_called_factory(&self, stored: &[FnId], call: ExprId) -> Option<FnId> {
        let hir = self.hir;
        let before = stored.partition_point(|&factory| hir[factory].start < hir[call].pos);
        let called = stored[..before].last().or_else(|| stored.last());
        called.copied()
    }

    fn find_named_symbols(&self) -> FxHashSet<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let expressions = (0..hir.exprs.len() as u32).map(ExprId);
        let names = expressions.filter(|&it| matches!(hir[it].kind, ExprKind::Ident(_)));
        names
            .filter_map(|name| match bound.binding(name) {
                Binding::Symbol(symbol) => Some(symbol),
                _ => None,
            })
            .collect()
    }

    fn find_only_name(&self, function: FnId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = match bound.fns[function.idx()].owner {
            FnOwner::Stmt(_) => bound.declared_symbol(Decl::Fn(function)).some()?,
            FnOwner::Expr(expression) => {
                let value = bound.outermost_type_assertion(hir, expression);
                let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
                    return None;
                };
                let pattern = hir[declaration].pat;
                if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
                    return None;
                }
                bound.declared_symbol(Decl::Var(pattern)).some()?
            }
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => return None,
        };
        let declared = bound.symbol(symbol);
        let annex_b_functions = bound.runtime.annex_b_functions();
        let has_other_names = declared.parent.is_some()
            || declared.export_symbol.is_some()
            || bound.is_visible_to_eval(symbol)
            || bound.is_named_by_export(symbol)
            || bound.runtime.is_named_implicitly(symbol)
            || annex_b_functions.iter().any(|it| it.function == function);
        (!has_other_names).then_some(symbol)
    }

    fn is_in_unnamed_function(&self, factory: FnId, named: &FxHashSet<SymbolId>) -> bool {
        let bound = self.bound;
        let mut inner = factory;
        loop {
            let around = bound.scopes[bound.fns[inner.idx()].scope.idx()].parent;
            let CodeUnit::Function(outer) = bound.code_unit(around) else {
                return false;
            };
            if (self.find_only_name(outer)).is_some_and(|symbol| !named.contains(&symbol)) {
                return true;
            }
            inner = outer;
        }
    }

    fn find_place_of_factory(&self, factory: FnId) -> Option<Place> {
        match self.bound.fns[factory.idx()].owner {
            FnOwner::Stmt(_) => {
                let root = self.bound.declared_symbol(Decl::Fn(factory)).some()?;
                let is_last = self.find_last_declaration(root) == Some(factory);
                is_last.then(|| Place {
                    root,
                    names: SmallVec::new(),
                })
            }
            FnOwner::Expr(expression) => self.find_holder(expression),
            FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
        }
    }

    fn find_scope_evaluated_once(&self, expression: ExprId) -> Option<CallScope> {
        enum Node {
            Expression(ExprId),
            Statement(StmtId),
        }
        let (hir, bound) = (self.hir, self.bound);
        let mut innermost: Option<ScopeId> = None;
        let mut of_statement: Option<ScopeId> = None;
        let mut node = Node::Expression(expression);
        loop {
            let parent = match node {
                Node::Expression(expression) => bound.parent_of_expr(expression),
                Node::Statement(statement) => {
                    let scope = bound.scope_of_stmt(statement);
                    innermost.get_or_insert(scope);
                    of_statement.get_or_insert(scope);
                    bound.parent_of_stmt(statement)
                }
            };
            node = match parent {
                Parent::File => {
                    return Some(CallScope {
                        innermost: innermost?,
                        of_statement: of_statement?,
                    });
                }
                Parent::Expr(parent) => Node::Expression(parent.some()?),
                Parent::VarInit(declaration) => {
                    Node::Statement(bound.var_stmt[declaration.idx()].some()?)
                }
                Parent::Prop(property) | Parent::PropKey(property) => {
                    Node::Expression(bound.prop_owner[property.idx()].some()?)
                }
                Parent::ClassExtends(class) => {
                    innermost.get_or_insert_with(|| bound.class_scope[class.idx()]);
                    match bound.class_owner[class.idx()] {
                        ClassOwner::Stmt(statement) => Node::Statement(statement.some()?),
                        ClassOwner::Expr(expression) => Node::Expression(expression),
                    }
                }
                Parent::Stmt(statement) => match hir[statement.some()?].kind {
                    StmtKind::For { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::While { .. }
                    | StmtKind::DoWhile { .. }
                    | StmtKind::With { .. } => return None,
                    _ => Node::Statement(statement),
                },
                Parent::FnBody(function) => {
                    let runs_later = hir[function]
                        .flags
                        .intersects(Flags::ASYNC | Flags::GENERATOR);
                    if runs_later || !bound.is_called_only_where_written(hir, function) {
                        return None;
                    }
                    let FnOwner::Expr(callee) = bound.fns[function.idx()].owner else {
                        return None;
                    };
                    innermost.get_or_insert_with(|| bound.fns[function.idx()].scope);
                    Node::Expression(callee)
                }
                _ => return None,
            };
        }
    }

    fn is_inside(&self, scope: ScopeId, outer: ScopeId) -> bool {
        self.scopes_around(scope).any(|it| it == outer)
    }

    fn scopes_around(&self, scope: ScopeId) -> impl Iterator<Item = ScopeId> + '_ {
        let bound = self.bound;
        let parent_of = move |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
        std::iter::successors(scope.some(), parent_of)
    }

    fn find_constructed_places(&self) -> FxHashSet<Place> {
        let (hir, bound) = (self.hir, self.bound);
        let mut places = FxHashSet::default();
        for expression in hir.exprs.iter() {
            let constructor = match expression.kind {
                ExprKind::New(call) => hir[call].callee,
                ExprKind::Binary {
                    op: BinOp::Instanceof,
                    right,
                    ..
                } => right,
                ExprKind::Dot {
                    obj,
                    name: known::prototype,
                    ..
                } => obj,
                _ => continue,
            };
            places.extend(self.find_place(constructor));
        }
        for (index, class) in hir.classes.iter().enumerate() {
            if bound.class_scope[index].is_some()
                && let Some(extends) = class.extends.some()
            {
                places.extend(self.find_place(extends));
            }
        }
        places
    }

    fn find_texts_with_own_this(
        &self,
        factory: FnId,
        start: u32,
        end: u32,
    ) -> SmallVec<[(u32, u32); 8]> {
        let (hir, bound) = (self.hir, self.bound);
        let is_inside = |pos: u32| (start..end).contains(&pos);
        let functions = hir.fns.iter().enumerate().filter_map(|(index, function)| {
            let is_other = index != factory.idx() && function.kind != FnKind::Arrow;
            if !is_other || !is_inside(function.start) {
                return None;
            }
            let (start, end) = find_text(hir, bound, FnId(index as u32))?;
            let key = match bound.fns[index].owner {
                FnOwner::Member(member) => hir[member].key,
                FnOwner::Expr(expression) => match bound.parent_of_expr(expression) {
                    Parent::Prop(property) => hir[property].key,
                    _ => PropKey::None,
                },
                FnOwner::None | FnOwner::Stmt(_) | FnOwner::Type(_) => PropKey::None,
            };
            match key {
                PropKey::Computed(key) => Some((start.max(end_of_expr(hir, key)), end)),
                PropKey::None | PropKey::Name(_) | PropKey::Private(_) => Some((start, end)),
            }
        });
        let fields = hir.members.iter().filter_map(|member| {
            let value = member.init.some()?;
            let start = hir[value].pos;
            is_inside(start).then(|| (start, end_of_expr(hir, value)))
        });
        functions.chain(fields).collect()
    }

    fn can_be_copied_into(&self, factory: FnId, call: CallScope) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some((start, end)) = find_text(hir, bound, factory) else {
            return false;
        };
        let scope = call.innermost;
        let own_scope = bound.fns[factory.idx()].scope;
        let is_inside = |pos: u32| (start..end).contains(&pos);
        let is_strict_around = bound.is_strict_scope(call.of_statement);
        if hir[factory].is_strict != is_strict_around
            || (hir[factory].kind != FnKind::Arrow && bound.finds_itself(hir, factory))
            || hir.bigint_names.iter().any(|it| is_inside(it.0))
            || hir.decorators.iter().any(|it| is_inside(hir[it.1].pos))
            || (hir.functions_written_by_loader.iter()).any(|it| is_inside(hir[it.function].start))
            || (0..hir.fns.len() as u32).map(FnId).any(|function| {
                let flags = bound.function_flags(function);
                flags.contains(FunctionFlags::HAS_DIRECT_EVAL) && is_inside(hir[function].start)
            })
            || hir
                .known_evaluations
                .iter()
                .any(|it| is_inside(hir[hir[it.call].callee].pos))
            || self.has_names_of_evals(own_scope, scope)
        {
            return false;
        }
        let with_own_this = self.find_texts_with_own_this(factory, start, end);
        let is_lexical = |pos: u32| !with_own_this.iter().any(|it| (it.0..it.1).contains(&pos));
        let is_arrow = hir[factory].kind == FnKind::Arrow;
        for id in self.expressions_within(start, end) {
            let expression = &hir[id];
            let means_the_same = match expression.kind {
                ExprKind::Ident(name) => match bound.binding(id) {
                    _ if (bound.dynamic_lookup_scope(NodeData::Expr(id)))
                        .is_some_and(|hiding| !self.is_inside(scope, hiding)) =>
                    {
                        false
                    }
                    Binding::Symbol(symbol) => {
                        self.is_inside(bound.symbol_scope(symbol), own_scope)
                            || self.is_found_from(scope, name, Some(symbol))
                    }
                    Binding::Free => self.is_found_from(scope, name, None),
                    Binding::Arguments(CodeUnit::Function(function)) => {
                        function != factory && is_inside(hir[function].start)
                    }
                    Binding::Arguments(CodeUnit::File | CodeUnit::FieldInitializer(_))
                    | Binding::CommonJs(_) => false,
                },
                ExprKind::This | ExprKind::NewTarget(_) => !is_arrow || !is_lexical(expression.pos),
                ExprKind::Super => !is_lexical(expression.pos),
                ExprKind::PrivateIdentifier(_) => self.is_private_name_declared_in(id, start, end),
                ExprKind::Dot { .. } => match hir.member_key(id) {
                    Some((_, MemberKey::PrivateName(_))) => {
                        self.is_private_name_declared_in(id, start, end)
                    }
                    _ => true,
                },
                ExprKind::Await(_) | ExprKind::Yield { .. } => true,
                ExprKind::Missing
                | ExprKind::Null
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex { .. }
                | ExprKind::Template { .. }
                | ExprKind::Array(_)
                | ExprKind::Object(_)
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Unary { .. }
                | ExprKind::Binary { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Cond { .. }
                | ExprKind::Spread(_)
                | ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. } => true,
                ExprKind::TaggedTemplate(_)
                | ExprKind::Jsx(_)
                | ExprKind::JsxText(_)
                | ExprKind::ImportCall { .. }
                | ExprKind::ImportMeta => false,
            };
            if !means_the_same {
                return false;
            }
        }
        true
    }

    fn is_private_name_declared_in(&self, reference: ExprId, start: u32, end: u32) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some(name) = bound.private_name_of_reference(reference) else {
            return false;
        };
        (start..end).contains(&hir[bound.private_name(name).class].start)
    }

    fn has_names_of_evals(&self, own_scope: ScopeId, scope: ScopeId) -> bool {
        let bound = self.bound;
        let mut around_call = self.scopes_around(scope);
        around_call.any(|around| match bound.scopes[around.idx()].kind {
            ScopeKind::Fn(function) => {
                let flags = bound.function_flags(function);
                flags.contains(FunctionFlags::HAS_DIRECT_EVAL)
                    && !bound.is_strict_scope(around)
                    && !self.is_inside(own_scope, around)
            }
            _ => false,
        })
    }

    fn find_appended(&self, scope: ScopeId, name: Atom) -> &[SymbolId] {
        let bound = self.bound;
        let all = self.appended.get_or_init(|| {
            let mut all: FxHashMap<(ScopeId, Atom), SmallVec<[SymbolId; 1]>> = FxHashMap::default();
            for (index, symbol) in bound.symbols.iter().enumerate() {
                let id = SymbolId(index as u32);
                if bound.is_appended_symbol(id) {
                    all.entry((bound.symbol_scope(id), symbol.name))
                        .or_default()
                        .push(id);
                }
            }
            all
        });
        all.get(&(scope, name)).map_or(&[][..], |it| &it[..])
    }

    fn is_found_from(&self, scope: ScopeId, name: Atom, symbol: Option<SymbolId>) -> bool {
        let bound = self.bound;
        let declaring = symbol.map(|it| bound.symbol_scope(it));
        for around in self.scopes_around(scope) {
            let appended = self.find_appended(around, name);
            if Some(around) == declaring {
                return appended.is_empty() || symbol.is_some_and(|it| appended.contains(&it));
            }
            if !appended.is_empty()
                || bound
                    .lookup(bound.scopes[around.idx()].locals, name)
                    .is_some()
            {
                return false;
            }
        }
        declaring.is_none()
    }
}

fn find_text(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> Option<(u32, u32)> {
    let end = match bound.fns[function.idx()].owner {
        FnOwner::Expr(expression) => end_of_expr(hir, expression),
        FnOwner::Stmt(statement) => hir[statement].loc.end,
        FnOwner::Member(member) => hir[member].loc.end,
        FnOwner::None | FnOwner::Type(_) => return None,
    };
    Some((hir[function].start, end))
}

fn find_called_factories<'s>(
    atoms: &Interner<'s>,
    hir: &File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'s>,
) -> Vec<(CalledFactory, FxHashMap<ExprId, ExprId>)> {
    let finder = Finder {
        hir,
        bound,
        atoms,
        expressions: OnceCell::new(),
        appended: OnceCell::new(),
    };
    let mut factories: FxHashMap<Place, SmallVec<[FnId; 1]>> = FxHashMap::default();
    let mut created: FxHashMap<FnId, Created> = FxHashMap::default();
    for function in (0..hir.fns.len() as u32).map(FnId) {
        if !decisions.is_dead_function(function)
            && let Some(it) = finder.find_created(function)
            && let Some(place) = finder.find_place_of_factory(function)
        {
            factories.entry(place).or_default().push(function);
            created.insert(function, it);
        }
    }
    let mut named: Option<FxHashSet<SymbolId>> = None;
    for stored in factories.values_mut().filter(|stored| stored.len() > 1) {
        let named = named.get_or_insert_with(|| finder.find_named_symbols());
        stored.retain(|&mut factory| !finder.is_in_unnamed_function(factory, named));
        stored.sort_unstable_by_key(|&factory| hir[factory].start);
    }
    if factories.is_empty() {
        return Vec::new();
    }
    let mut called: Vec<(CalledFactory, CallScope)> = Vec::new();
    for (index, expression) in hir.exprs.iter().enumerate() {
        if let ExprKind::Call(call) = expression.kind
            && hir[call].chain == Chain::No
            && let Some(place) = finder.find_place(hir[call].callee)
            && let Some(stored) = factories.get(&place)
            && let sequence = ExprId(index as u32)
            && let Some(factory) = finder.find_called_factory(stored, sequence)
            && let Some(scope) = finder.find_scope_evaluated_once(sequence)
        {
            let called_factory = CalledFactory {
                sequence,
                call,
                factory,
            };
            called.push((called_factory, scope));
        }
    }
    if called.is_empty() {
        return Vec::new();
    }
    let constructed = finder.find_constructed_places();
    let sequences: FxHashSet<ExprId> = called.iter().map(|it| it.0.sequence).collect();
    let final_holders: FxHashMap<ExprId, Place> = called
        .iter()
        .filter_map(|(it, _)| {
            Some((
                it.sequence,
                finder.find_final_holder(it.sequence, &sequences)?,
            ))
        })
        .collect();
    let called_in_loops =
        finder.find_places_called_in_loops(&final_holders.values().cloned().collect());
    let mut uses_passed: FxHashMap<FnId, bool> = FxHashMap::default();
    called.retain(|(it, _)| match created[&it.factory] {
        Created::Class(_) => true,
        Created::Function(function) => {
            let holder = finder.find_holder(it.sequence);
            holder.is_some_and(|holder| constructed.contains(&holder))
                || (final_holders.get(&it.sequence)).is_some_and(|it| called_in_loops.contains(it))
                    && *uses_passed
                        .entry(it.factory)
                        .or_insert_with(|| finder.captures_from(it.factory, function))
        }
    });
    let mut calls: FxHashMap<FnId, u32> = FxHashMap::default();
    for (it, _) in &called {
        *calls.entry(it.factory).or_default() += 1;
    }
    let is_only_constructor = |it: &CalledFactory| {
        hir.member_key(hir.skip_type_assertions(hir[it.call].callee))
            .is_some()
            && matches!(created[&it.factory], Created::Function(_))
            && (finder.find_holder(it.sequence)).is_some_and(|holder| constructed.contains(&holder))
    };
    let is_passed_literal = |it: &CalledFactory| {
        let Created::Function(function) = created[&it.factory] else {
            return false;
        };
        find_text(hir, bound, function).is_some_and(|(start, end)| {
            let literals = finder.find_literals(it);
            literals
                .keys()
                .any(|&read| (start..end).contains(&hir[read].pos))
        })
    };
    let mut can_be_copied: FxHashMap<(FnId, CallScope), bool> = FxHashMap::default();
    called.retain(|(it, scope)| {
        (calls[&it.factory] > 1 || is_only_constructor(it) || is_passed_literal(it))
            && *can_be_copied
                .entry((it.factory, *scope))
                .or_insert_with(|| finder.can_be_copied_into(it.factory, *scope))
    });
    let with_literals = |(it, _): (CalledFactory, CallScope)| {
        let literals = finder.find_literals(&it);
        (it, literals)
    };
    called.into_iter().map(with_literals).collect()
}

pub(crate) fn copy_factories<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'s>,
) -> TreeChange {
    if !hir.copied_factories.is_empty()
        || hir.has_errors
        || hir.ran_out_of_stack
        || !hir.with_bodies.is_empty()
        || !bound.runtime.is_computed()
    {
        return TreeChange::Unchanged;
    }
    let called = find_called_factories(atoms, hir, bound, decisions);
    if called.is_empty() {
        return TreeChange::Unchanged;
    }
    let mut file = FileBuilder::from_file(hir);
    let written_end = hir.written_text_end();
    let stack = StackCheck::init();
    let mut copies: Vec<CopiedFactory> = Vec::new();
    for (called_factory, literals) in called {
        let CalledFactory {
            sequence,
            call,
            factory,
        } = called_factory;
        let Some((written_start, end)) = find_text(hir, bound, factory) else {
            continue;
        };
        let text = &hir.text[written_start as usize..end as usize];
        let start = file.text.len() as u32 + 1;
        let source = file.text.to_mut();
        source.push(b'\n');
        source.extend_from_slice(text);
        source.push(b'\n');
        let mut copier = FunctionCopier {
            file: &mut file,
            distance: start - written_start,
            literals: &literals,
            stack: &stack,
        };
        let Ok(copy) = copier.function_expression(factory) else {
            return TreeChange::Unchanged;
        };
        let end = start + text.len() as u32;
        let function = file.expr(ExprKind::Fn(copy), start, end);
        let written = file[sequence];
        let right = file.expr(written.kind, written.pos, written.end);
        file[sequence].kind = ExprKind::Binary {
            op: BinOp::Comma,
            left: function,
            right,
        };
        copies.push(CopiedFactory {
            sequence,
            call,
            function,
            factory,
            start,
            end,
            written_start,
        });
    }
    file.copied_factories = copies;
    file.source_len = written_end;
    *hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
