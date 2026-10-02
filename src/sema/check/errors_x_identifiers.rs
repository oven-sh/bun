//! What a name or `this` comes to where it is written, and what a declaration is left with for a type:
//! 2815, 7005, 7041,
//! 7018 7025 7055 (and 7006 7008 7010 7011 7019 where `null` and `undefined` widen), 2700, 2842.
//!
//! Follows `checkIdentifier`, `checkThisExpression`, `getBindingElementTypeFromParentType`,
//! `checkUnusedRenamedBindingElements`, `widenTypeForVariableLikeDeclaration`, `reportErrorsFromWidening`,
//! `reportWideningErrorsInType` and `reportImplicitAny` of TypeScript 7.0.2's checker.go.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeKind};

impl Checker<'_> {
    pub(super) fn check_x_identifiers(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let options = &self.p.files.options;
        let (strict, no_implicit_any) = (options.strict_null_checks, options.no_implicit_any);
        let mut pass = Pass {
            c: self,
            out,
            file,
            hir,
            bound,
            strict,
            no_implicit_any,
            type_parents: None,
        };
        // Of the checks below, only `widenTypeForVariableLikeDeclaration` (7005) runs on a declaration file.
        if hir.kind == FileKind::Declaration {
            pass.check_variables_without_a_type();
            return;
        }
        pass.check_identifiers();
        pass.check_this_expressions();
        pass.check_variables_without_a_type();
        pass.check_widening();
        pass.check_rest_elements();
        pass.check_renamed_binding_elements();
    }
}

/// One file being gone over.
struct Pass<'c, 'p> {
    c: &'c mut Checker<'p>,
    out: &'c mut Vec<Diagnostic>,
    file: FileId,
    hir: &'p hir::File,
    bound: &'p Bound,
    /// `strictNullChecks`
    strict: bool,
    no_implicit_any: bool,
    /// What each type is written directly in. Worked out when first asked for.
    type_parents: Option<Vec<TypeNodeId>>,
}

/// What an expression is written in, as far out as is asked: the nodes of TypeScript's tree that the checks here tell apart.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Node {
    Expr(ExprId),
    Stmt(StmtId),
    /// The body of a function.
    Body(FnId),
    /// The parameters of a function.
    Params(FnId),
    /// Anything with parameters, or a static block, as a whole: its name and its decorators are directly in it.
    Fn(FnId),
    /// The initializer of a property of a class.
    Initializer(MemberId),
    /// The declaration of a property of a class.
    Property(MemberId),
    Class(ClassId),
    Enum(EnumId),
    Module(ModuleId),
    File,
    /// The binder does not say.
    Lost,
}

// ───────────────────────────── the way out ─────────────────────────────

impl Pass<'_, '_> {
    /// Nothing is said of the body of a `with` statement, which `checkWithStatement` does not look at.
    fn report(&mut self, start: u32, code: u32) {
        if !self.hir.is_in_with(start) {
            self.out.push(Diagnostic { start, code });
        }
    }

    fn is_bound(&self, e: ExprId) -> bool {
        !self.bound.is_unchecked(e.idx())
    }

    /// Whether `node` is the expression of a decorator.
    fn is_decorator(&self, node: Node) -> bool {
        matches!(node, Node::Expr(x) if matches!(self.bound.expr_parent[x.idx()], Parent::Decorator(..)))
    }

    /// The variable declaration or the parameter the pattern `pat` is part of.
    fn around_pattern(&self, mut pat: PatId) -> Node {
        loop {
            match self.bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return self.around_variable(d),
                PatParent::Param(p) => return Node::Params(self.bound.param_fn[p.idx()]),
                PatParent::None => return Node::Lost,
            }
        }
    }

    fn around_variable(&self, d: VarDeclId) -> Node {
        let stmt = self.bound.var_stmt[d.idx()];
        if stmt.is_some() {
            Node::Stmt(stmt)
        } else {
            Node::Lost
        }
    }

    fn member_or_its_function(&self, m: MemberId) -> Node {
        if !matches!(self.bound.member_owner[m.idx()], MemberOwner::Class(_)) {
            return Node::Lost;
        }
        let member = &self.hir[m];
        if member.func.is_some() {
            Node::Fn(member.func)
        } else {
            Node::Property(m)
        }
    }

    /// The node `slot` is a place in.
    fn node_of(&self, slot: Parent) -> Node {
        let (hir, bound) = (self.hir, self.bound);
        match slot {
            Parent::None => Node::Lost,
            Parent::Expr(x) if x.is_some() => Node::Expr(x),
            Parent::Stmt(s) if s.is_some() => Node::Stmt(s),
            Parent::Expr(_) | Parent::Stmt(_) => Node::Lost,
            Parent::VarInit(d) => self.around_variable(d),
            Parent::ParamDefault(p) => Node::Params(bound.param_fn[p.idx()]),
            Parent::PatPropDefault(p) => self.around_pattern(hir[p].value),
            Parent::PatElemDefault(p) => self.around_pattern(hir[p].pat),
            Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                Node::Expr(bound.prop_owner[p.idx()])
            }
            Parent::Prop(_) => Node::Lost,
            Parent::PropKey(_, p) => Node::Expr(bound.prop_owner[p.idx()]),
            Parent::PatKey(p) => self.around_pattern(hir[p].value),
            Parent::MemberKey(m) => self.member_or_its_function(m),
            Parent::MethodKey(p) => match hir[hir[p].value].kind {
                ExprKind::Fn(f) => Node::Fn(f),
                _ => Node::Lost,
            },
            Parent::MemberInit(m) => Node::Initializer(m),
            Parent::FnBody(f) => Node::Body(f),
            Parent::EnumInit(m) => Node::Enum(bound.enum_member_owner[m.idx()]),
            Parent::Case(c) => Node::Stmt(bound.case_stmt[c.idx()]),
            Parent::ClassExtends(c) | Parent::Decorator(c, DecoratorOwner::Class(_)) => {
                Node::Class(c)
            }
            Parent::Decorator(_, DecoratorOwner::Member(m)) => self.member_or_its_function(m),
            Parent::Decorator(_, DecoratorOwner::Param(p)) => Node::Fn(bound.param_fn[p.idx()]),
            Parent::Module(m) => Node::Module(m),
            Parent::File => Node::File,
        }
    }

    /// What `node` is directly in.
    fn parent(&self, node: Node) -> Node {
        let (hir, bound) = (self.hir, self.bound);
        let of_member = |m: MemberId| match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => Node::Class(c),
            _ => Node::Lost,
        };
        match node {
            Node::Expr(e) => self.node_of(bound.expr_parent[e.idx()]),
            Node::Stmt(s) => self.node_of(bound.stmt_parent[s.idx()]),
            Node::Body(f) | Node::Params(f) => Node::Fn(f),
            Node::Fn(f) => match bound.fns[f.idx()].owner {
                FnOwner::Expr(e) => self.parent(Node::Expr(e)),
                FnOwner::Stmt(s) => self.parent(Node::Stmt(s)),
                FnOwner::Member(m) => of_member(m),
                FnOwner::Type(_) | FnOwner::None => Node::Lost,
            },
            Node::Initializer(m) => Node::Property(m),
            Node::Property(m) => of_member(m),
            Node::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Expr(e) => self.parent(Node::Expr(e)),
                ClassOwner::Stmt(s) => self.parent(Node::Stmt(s)),
            },
            Node::Enum(en) => self.parent(Node::Stmt(hir[en].stmt)),
            Node::Module(_) | Node::File | Node::Lost => Node::Lost,
        }
    }
}

// ───────────────────────────── `arguments` and `this` ─────────────────────────────

impl Pass<'_, '_> {
    /// `checkIdentifier`: 2815. Where no declaration is what `arguments` means: the binder has those.
    fn check_identifiers(&mut self) {
        let bound = self.bound;
        let free = bound.free_idents.iter().map(|f| f.0);
        for e in bound.arguments_objects.iter().copied().chain(free) {
            if matches!(self.hir[e].kind, ExprKind::Ident(known::arguments))
                && self.is_bound(e)
                && self.is_arguments_in_initializer(e)
            {
                self.report(self.hir[e].pos, 2815);
            }
        }
    }

    /// Whether the `arguments` at `e` is that of a function, and `isInPropertyInitializerOrClassStaticBlock` says yes, arrow functions
    /// not counting. Only the block of a function ends the search: its parameters are as good as outside of it.
    fn is_arguments_in_initializer(&self, e: ExprId) -> bool {
        if self.bound.is_in_type_query(e) {
            return false;
        }
        let mut node = Node::Expr(e);
        let mut is_inside = None;
        let mut is_provided = false;
        loop {
            let below = node;
            node = self.parent(node);
            match node {
                Node::Property(_) => {
                    is_inside.get_or_insert(true);
                }
                Node::Body(f)
                    if !matches!(self.hir[f].kind, FnKind::Arrow | FnKind::StaticBlock) =>
                {
                    is_inside.get_or_insert(false);
                }
                Node::Fn(f) => match self.hir[f].kind {
                    FnKind::StaticBlock => {
                        is_inside.get_or_insert(true);
                    }
                    // The names in a decorator are looked up from the class.
                    FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor => {
                        is_provided |= !self.is_decorator(below);
                    }
                    _ => {}
                },
                Node::Module(_) | Node::File | Node::Lost => return false,
                _ => {}
            }
            match is_inside {
                Some(false) => return false,
                Some(true) if is_provided => return true,
                _ => {}
            }
        }
    }

    /// The `typeof` in a type that `e` is the operand of, or part of it.
    fn type_query_of(&self, e: ExprId) -> Option<TypeNodeId> {
        let mut top = e;
        while let Parent::Expr(x) = self.bound.expr_parent[top.idx()]
            && x.is_some()
        {
            top = x;
        }
        let node = self
            .hir
            .types
            .iter()
            .position(|t| matches!(t.kind, TypeNodeKind::Typeof { expr, .. } if expr == top))?;
        Some(TypeNodeId(node as u32))
    }

    /// `global_this`, of a `this` in the operand of a `typeof` in a type. The binder puts the operand in the function, namespace or file
    /// around: it is the scopes and the types around that tell what is in between.
    fn global_this_in_type_query(&mut self, e: ExprId) -> Option<bool> {
        let (hir, bound) = (self.hir, self.bound);
        let node = self.type_query_of(e)?;
        // The members of a type literal have a `this` of their own.
        let parents = self
            .type_parents
            .get_or_insert_with(|| Checker::type_node_parents(hir, bound));
        let mut at = parents[node.idx()];
        while at.is_some() {
            if matches!(hir[at].kind, TypeNodeKind::Object(_)) {
                return None;
            }
            at = parents[at.idx()];
        }
        let mut is_captured = false;
        let mut scope = bound.type_scope[node.idx()];
        while scope.is_some() {
            match bound.scopes[scope.idx()].kind {
                ScopeKind::File => return Some(is_captured),
                ScopeKind::Fn(f) => match hir[f].kind {
                    FnKind::Arrow => is_captured = true,
                    // `getThisContainer` goes past a function type.
                    FnKind::FunctionType | FnKind::ConstructorType => {}
                    _ => return None,
                },
                ScopeKind::Class(_)
                | ScopeKind::Interface(_)
                | ScopeKind::Module(_)
                | ScopeKind::Enum(_) => return None,
                _ => {}
            }
            scope = bound.scopes[scope.idx()].parent;
        }
        None
    }

    /// Whether the `this` at `e` is `globalThis`, and if so whether an arrow function is on the way there: what `checkThisExpression`
    /// finds for a container and `tryGetThisTypeAtEx` makes of it.
    fn global_this(&mut self, e: ExprId) -> Option<bool> {
        if self.hir.has_module_syntax {
            return None;
        }
        if self.bound.is_in_type_query(e) {
            return self.global_this_in_type_query(e);
        }
        let mut is_captured = false;
        let mut node = Node::Expr(e);
        loop {
            let below = node;
            node = self.parent(node);
            match node {
                Node::Fn(f) if below == Node::Body(f) || below == Node::Params(f) => {
                    if self.hir[f].kind != FnKind::Arrow {
                        return None;
                    }
                    is_captured = true;
                }
                // The computed name of a method of an object literal is not in the method.
                Node::Fn(f) if matches!(self.bound.fns[f.idx()].owner, FnOwner::Expr(_)) => {}
                // A decorator is applied outside of the class.
                Node::Fn(_) | Node::Property(_) if self.is_decorator(below) => {}
                Node::Fn(_) | Node::Property(_) | Node::Enum(_) | Node::Module(_) | Node::Lost => {
                    return None;
                }
                Node::File => return Some(is_captured),
                _ => {}
            }
        }
    }

    /// `checkThisExpression`: 7041.
    fn check_this_expressions(&mut self) {
        // In a module no `this` is `globalThis`.
        if !self.c.p.files.options.no_implicit_this || self.c.files().module(self.file).is_module()
        {
            return;
        }
        let by_kind = self.c.exprs_by_kind(self.file);
        for &e in by_kind.of(ExprTag::This) {
            if self.is_bound(e) && self.global_this(e) == Some(true) {
                self.report(self.hir[e].pos, 7041);
            }
        }
    }
}

// ───────────────────────────── declarations that are left with `any` ─────────────────────────────

/// What the type of an expression has of the `null` and `undefined` that widen to `any` (`ObjectFlagsContainsWideningType`), as far as
/// the way it is written tells. There are none under `strictNullChecks`.
enum Widening {
    No,
    /// `nullWideningType`, `undefinedWideningType`
    Nullish,
    /// An array or a tuple, and what its type arguments have.
    Elements(Vec<Widening>),
    /// An object literal in which something was written that has some: where each of its properties that still does is written.
    Object(Vec<(u32, Widening)>),
    /// It cannot be told.
    Unknown,
}

impl Widening {
    fn is_unknown(&self) -> bool {
        match self {
            Widening::Unknown => true,
            Widening::Elements(args) => args.iter().any(Widening::is_unknown),
            Widening::Object(props) => props.iter().any(|p| p.1.is_unknown()),
            _ => false,
        }
    }

    fn contains_widening_type(&self) -> bool {
        match self {
            Widening::Nullish | Widening::Object(_) => true,
            Widening::Elements(args) => args.iter().any(Widening::contains_widening_type),
            _ => false,
        }
    }
}

impl Pass<'_, '_> {
    /// The name bound by `d`, if `d` binds a plain identifier without a type annotation, is `symbol.ValueDeclaration` (the only
    /// declaration `getTypeOfVariableOrParameterOrPropertyWorker` reports errors for) and is not auto-typed.
    fn untyped_variable(&mut self, d: VarDeclId) -> Option<PatId> {
        let (hir, bound) = (self.hir, self.bound);
        let decl = &hir[d];
        let stmt = bound.var_stmt[d.idx()];
        if !matches!(hir[decl.pat].kind, PatKind::Ident(_))
            || decl.ty.is_some()
            || stmt.is_none()
            || !matches!(hir[stmt].kind, StmtKind::Var(_))
            || matches!(bound.stmt_parent[stmt.idx()], Parent::None)
            || self.c.declares_loop_variable(self.file, stmt)
        {
            return None;
        }
        let own = (self.file, decl.pat);
        if bound.pat_symbol[decl.pat.idx()].is_none()
            || self.c.value_declaration_of_variable_name(own.0, own.1) != own
        {
            return None;
        }
        let declared = self.c.type_of_pat(own.0, own.1);
        (!self.c.is_automatic_type(declared)).then_some(decl.pat)
    }

    /// `widenTypeForVariableLikeDeclaration`, of a variable of which nothing at all is said: 7005.
    fn check_variables_without_a_type(&mut self) {
        if !self.no_implicit_any {
            return;
        }
        for d in 0..self.hir.var_decls.len() {
            if self.hir.var_decls[d].init.is_none()
                && let Some(pat) = self.untyped_variable(VarDeclId(d as u32))
            {
                let (file, start) = (self.file, self.hir[pat].pos);
                self.report(start, 7005);
                self.c.explain(start, 7005, |c| {
                    vec![c.declaration_name_at(file, start), "any".to_owned()]
                });
            }
        }
    }

    /// Notes what `reportImplicitAny` and `reportWideningErrorsInType` say of a declaration that takes its type from the expression
    /// `from`. `name`: where its name is written.
    fn explain_implicit_any(&mut self, start: u32, end: u32, code: u32, name: u32, from: ExprId) {
        let file = self.file;
        self.c.explain_to(start, end, code, |c| {
            let ty = c.type_of_expr(file, from);
            let ty = c.widened(ty);
            vec![c.declaration_name_at(file, name), c.type_to_string(ty)]
        });
    }

    /// `reportErrorsFromWidening`, wherever a type is taken from an expression: 7018, or else 7005, 7006 7019, 7008, 7010 7011, 7025 7055.
    fn check_widening(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        if !self.no_implicit_any || self.strict {
            return;
        }
        for d in 0..hir.var_decls.len() {
            let init = hir.var_decls[d].init;
            if init.is_some()
                && let Some(pat) = self.untyped_variable(VarDeclId(d as u32))
            {
                let widening = self.widening_of(init);
                let start = hir[pat].pos;
                if self.report_errors_from_widening(&widening, start, 7005) {
                    self.explain_implicit_any(start, 0, 7005, start, init);
                }
            }
        }
        for m in 0..hir.members.len() {
            let member = &hir.members[m];
            if member.kind == MemberKind::Property
                && member.ty.is_none()
                && member.init.is_some()
                && matches!(bound.member_owner[m], MemberOwner::Class(_))
            {
                let widening = self.widening_of(member.init);
                if self.report_errors_from_widening(&widening, member.pos, 7008) {
                    let end = self.c.end_of_name_at(self.file, member.pos);
                    self.explain_implicit_any(member.pos, end, 7008, member.pos, member.init);
                }
            }
        }
        for f in 0..hir.fns.len() {
            let owner = bound.fns[f].owner;
            if matches!(owner, FnOwner::None) {
                continue;
            }
            let func = FnId(f as u32);
            // `getReturnTypeOfFullSignature`, `getParameterTypeOfFullSignature`
            if self.c.full_signature(self.file, func).is_some() {
                continue;
            }
            // What is expected of a function expression comes before what its parameters default to.
            let is_context_known = match owner {
                FnOwner::Expr(e) => self.c.is_context_known(self.file, e),
                _ => true,
            };
            if !is_context_known {
                continue;
            }
            for (index, p) in hir.fns[f].params.iter().enumerate() {
                let param = &hir[p];
                if param.ty.is_some()
                    || param.default.is_none()
                    || !matches!(hir[param.pat].kind, PatKind::Ident(_))
                    || matches!(owner, FnOwner::Expr(_))
                        && self
                            .c
                            .contextual_param_type(self.file, func, index)
                            .is_some()
                {
                    continue;
                }
                let widening = self.widening_of(param.default);
                let code = if param.flags.contains(Flags::REST) {
                    7019
                } else {
                    7006
                };
                if self.report_errors_from_widening(&widening, param.pos, code) {
                    let end = self.c.end_of_param(self.file, p);
                    let name = hir[param.pat].pos;
                    self.explain_implicit_any(param.pos, end, code, name, param.default);
                }
            }
            self.check_widening_of_results(func);
        }
    }

    /// Whether the getter `func` goes with a setter that says what it takes.
    fn has_annotated_setter(&self, func: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let is_annotated = |setter: FnId| {
            setter.is_some()
                && hir[setter]
                    .params
                    .iter()
                    .next()
                    .is_some_and(|p| hir[p].ty.is_some())
        };
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => {
                let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                    return false;
                };
                hir[c].members.iter().any(|x| {
                    hir[x].kind == MemberKind::Setter
                        && hir[x].key == hir[m].key
                        && hir[x].flags.contains(Flags::STATIC)
                            == hir[m].flags.contains(Flags::STATIC)
                        && is_annotated(hir[x].func)
                })
            }
            FnOwner::Expr(e) => {
                let Parent::Prop(p) = bound.expr_parent[e.idx()] else {
                    return false;
                };
                let ExprKind::Object(props) = hir[bound.prop_owner[p.idx()]].kind else {
                    return false;
                };
                props.iter().any(|x| {
                    hir[x].kind == PropKind::Setter
                        && hir[x].key == hir[p].key
                        && hir[x].value.is_some()
                        && matches!(hir[hir[x].value].kind, ExprKind::Fn(setter) if is_annotated(setter))
                })
            }
            _ => false,
        }
    }

    /// `checkAndAggregateReturnExpressionTypes`: whether `e`, which `func` returns, is a bare call of `func` itself, which says nothing of
    /// what it returns.
    fn is_call_of_itself(&self, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut call = e;
        if hir[func].flags.contains(Flags::ASYNC)
            && let ExprKind::Await(awaited) = hir[call].kind
        {
            call = awaited;
        }
        let ExprKind::Call(c) = hir[call].kind else {
            return false;
        };
        let callee = hir[c].callee;
        let symbol = bound.expr_symbol[callee.idx()];
        if !matches!(hir[callee].kind, ExprKind::Ident(_))
            || is_parenthesized(self.hir, callee)
            || symbol.is_none()
        {
            return false;
        }
        if bound.fn_symbol[func.idx()] == symbol {
            return true;
        }
        // A function expression by the name of the variable it is given to, if that holds nothing else (`isConstantReference`).
        let FnOwner::Expr(owner) = bound.fns[func.idx()].owner else {
            return false;
        };
        let s = &bound.symbols[symbol.idx()];
        let Some(&Decl::Var(pat)) = s.decls.first() else {
            return false;
        };
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow)
            && hir[d].init == owner
            && hir[d].ty.is_none()
            && (s.flags.contains(SymFlags::CONST)
                || !s.flags.contains(SymFlags::ASSIGNED) && self.is_mutable_local(d))
    }

    /// `isMutableLocalVariableDeclaration`
    fn is_mutable_local(&self, d: VarDeclId) -> bool {
        let decl = &self.hir[d];
        let stmt = self.bound.var_stmt[d.idx()];
        decl.kind == VarKind::Let
            && !decl.flags.contains(Flags::EXPORT)
            && !(matches!(self.bound.stmt_parent[stmt.idx()], Parent::File)
                && !self.c.files().module(self.file).is_module())
    }

    /// The call and its argument that what is expected of `e` is taken from: `e` itself, or a literal or the like that `e` is in.
    fn argument_around(&self, mut e: ExprId) -> Option<(ExprId, ExprId)> {
        let (hir, bound) = (self.hir, self.bound);
        loop {
            match bound.expr_parent[e.idx()] {
                Parent::Prop(p) if bound.prop_owner[p.idx()].is_some() => {
                    e = bound.prop_owner[p.idx()]
                }
                Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                    ExprKind::Call(c) | ExprKind::New(c) => {
                        return (hir[c].callee != e).then_some((parent, e));
                    }
                    ExprKind::Array(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::AsConst(_) => e = parent,
                    _ => return None,
                },
                _ => return None,
            }
        }
    }

    /// What the parameter that `arg` is given for in `call` is declared as, if what is called has type parameters that are left to be
    /// worked out from the arguments.
    fn declared_parameter_type(&mut self, call: ExprId, arg: ExprId) -> Option<TypeId> {
        let hir = self.hir;
        let (ExprKind::Call(c) | ExprKind::New(c)) = hir[call].kind else {
            return None;
        };
        if !hir[c].type_args.is_empty() {
            return None;
        }
        let index = hir.ids(hir[c].args).position(|a| a == arg)?;
        if hir
            .ids(hir[c].args)
            .take(index)
            .any(|a| matches!(hir[a].kind, ExprKind::Spread(_)))
        {
            return None;
        }
        let (file, func, _) = self
            .c
            .resolve_call(self.file, call)
            .sig
            .and_then(|sig| self.c.sig_decl(sig))?;
        let callee = self.c.type_of_expr(self.file, hir[c].callee);
        let callee = self.c.non_nullable(callee);
        for sig in self
            .c
            .signatures(callee, matches!(hir[call].kind, ExprKind::New(_)))
        {
            if !self.c.sig_type_params(sig).is_empty()
                && self
                    .c
                    .sig_decl(sig)
                    .is_some_and(|d| (d.0, d.1) == (file, func))
            {
                let params = self.c.sig_params(sig);
                return self.c.param_type_at(&params, index);
            }
        }
        None
    }

    /// What the signature expected of `func` returns (`getContextualSignatureForFunctionLikeDeclaration`). In an argument it is what the
    /// parameter is declared as that counts: `instantiateContextualType` fills in what is a type parameter itself, not what mentions one.
    fn contextual_return_type(&mut self, func: FnId) -> Option<TypeId> {
        let declared = match self.bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => self
                .argument_around(e)
                .and_then(|(call, arg)| Some((arg, self.declared_parameter_type(call, arg)?))),
            _ => None,
        };
        if let Some((arg, ty)) = declared {
            self.c.contextual.push((self.file, arg, ty));
        }
        let sig = self.c.contextual_signature(self.file, func);
        if declared.is_some() {
            self.c.contextual.pop();
        }
        sig.map(|sig| self.c.sig_return(sig))
    }

    /// The part of `getReturnTypeFromBody` that reports what widens in what `func` yields and returns.
    fn check_widening_of_results(&mut self, func: FnId) {
        let (hir, bound) = (self.hir, self.bound);
        let f = &hir[func];
        let owner = bound.fns[func.idx()].owner;
        if f.ret.is_some()
            || !matches!(
                f.kind,
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter
            )
        {
            return;
        }
        // `getTypeOfAccessors`, `getReturnTypeFromAnnotation`: a getter gives what its setter says it takes, and its body is not asked.
        if f.kind == FnKind::Getter && self.has_annotated_setter(func) {
            return;
        }
        let returned = match f.body {
            FnBody::None => return,
            FnBody::Expr(body) => self.widening_of(body),
            FnBody::Block(_) => {
                let mut returned = Vec::new();
                for s in bound.ids(bound.fns[func.idx()].returns) {
                    if let StmtKind::Return(e) = hir[s].kind
                        && e.is_some()
                        && !self.is_call_of_itself(func, e)
                    {
                        returned.push((self.widening_of(e), e));
                    }
                }
                self.union_of_widenings(returned)
            }
        };
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let is_async = f.flags.contains(Flags::ASYNC);
        let mut yielded = Vec::new();
        if is_generator {
            for y in bound.ids(bound.fns[func.idx()].yields) {
                let ExprKind::Yield { value, star } = hir[y].kind else {
                    continue;
                };
                yielded.push(if value.is_none() {
                    (Widening::Nullish, ExprId::NONE)
                } else if star {
                    (self.widening_of_what_is_spread(value), ExprId::NONE)
                } else {
                    (self.widening_of(value), value)
                });
            }
        }
        let yielded = self.union_of_widenings(yielded);
        if !returned.contains_widening_type() && !yielded.contains_widening_type() {
            return;
        }
        // `reportImplicitAny`: at the name, of which a function expression may have none but that of what it is given to.
        let (start, is_named) = match (f.kind, owner) {
            (FnKind::Method | FnKind::Getter, FnOwner::Member(m)) => (hir[m].pos, true),
            (FnKind::Method | FnKind::Getter, _) => (f.name_pos, true),
            (FnKind::Decl | FnKind::Expr, _) if f.name.is_some() => (f.name_pos, true),
            (FnKind::Expr, FnOwner::Expr(e)) => (
                self.bound.get_assigned_name(self.hir, e).unwrap_or(f.pos),
                false,
            ),
            (FnKind::Arrow, _) => (f.pos, false),
            _ => return,
        };
        // `shouldReportErrorsFromWideningWithContextualSignature`. What `next` is given is what is expected of the `yield`s, which comes
        // of annotations: there is nothing in it to widen.
        let expected = self.contextual_return_type(func);
        let iteration = expected
            .filter(|_| is_generator)
            .and_then(|ty| self.c.iteration_types(ty, is_async));
        let reports_yield = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.yielded)),
        };
        let reports_return = match expected {
            None => true,
            Some(ty) => {
                let ty = if is_generator {
                    iteration.map_or(ty, |t| t.returned)
                } else if is_async {
                    self.c.awaited(ty)
                } else {
                    ty
                };
                self.c.is_generic(ty)
            }
        };
        for (reports, widening, code, is_yield) in [
            (
                reports_yield,
                &yielded,
                if is_named { 7055 } else { 7025 },
                true,
            ),
            (
                reports_return,
                &returned,
                if is_named { 7010 } else { 7011 },
                false,
            ),
        ] {
            if !reports || !self.report_errors_from_widening(widening, start, code) {
                continue;
            }
            // `GetErrorRangeForNode`
            let file = self.file;
            let end = match (f.kind, owner) {
                (FnKind::Arrow, FnOwner::Expr(e)) => self.c.error_end_inside_parentheses(file, e),
                // The first token of a function expression that nothing names.
                (FnKind::Expr, _) if start == f.pos => 0,
                _ => self.c.end_of_name_at(file, start),
            };
            self.c.explain_to(start, end, code, |c| {
                let sig = c.sig_of_fn(file, func);
                let result = c.sig_return(sig);
                let ty = if is_generator {
                    c.iteration_types(result, is_async)
                        .map_or(TypeId::ANY, |types| {
                            if is_yield {
                                types.yielded
                            } else {
                                types.returned
                            }
                        })
                } else if is_async {
                    c.awaited(result)
                } else {
                    result
                };
                let ty = c.type_to_string(ty);
                if is_named {
                    vec![c.source_text(file, start, end), ty]
                } else {
                    vec![ty]
                }
            });
        }
    }

    /// `reportErrorsFromWidening`. `start`, `code`: what `reportImplicitAny` says of the declaration if there is nothing in the type
    /// to point at. Whether it did say that.
    fn report_errors_from_widening(&mut self, widening: &Widening, start: u32, code: u32) -> bool {
        let is_reported = !widening.is_unknown()
            && widening.contains_widening_type()
            && !self.report_widening_errors_in_type(widening);
        if is_reported {
            self.report(start, code);
        }
        is_reported
    }

    /// `reportWideningErrorsInType`: 7018
    fn report_widening_errors_in_type(&mut self, widening: &Widening) -> bool {
        let mut is_reported = false;
        match widening {
            Widening::Elements(args) => {
                for arg in args {
                    is_reported = is_reported || self.report_widening_errors_in_type(arg);
                }
            }
            Widening::Object(props) => {
                for (start, prop) in props {
                    is_reported = self.report_widening_errors_in_type(prop);
                    if !is_reported {
                        self.report(*start, 7018);
                        if let Some(p) = self.hir.props.iter().position(|p| p.pos == *start) {
                            let p = PropId(p as u32);
                            let end = self.c.end_of_prop(self.file, p);
                            self.explain_implicit_any(*start, end, 7018, *start, self.hir[p].value);
                        }
                        is_reported = true;
                    }
                }
            }
            _ => {}
        }
        is_reported
    }

    /// What the elements of `e` have, which is gone through by `...e` or `yield* e`.
    fn widening_of_what_is_spread(&mut self, e: ExprId) -> Widening {
        match self.widening_of(e) {
            Widening::No => Widening::No,
            Widening::Elements(mut args) if args.len() == 1 => args.remove(0),
            _ => Widening::Unknown,
        }
    }

    fn widening_of(&mut self, e: ExprId) -> Widening {
        let hir = self.hir;
        if self.c.is_stack_low() {
            return Widening::Unknown;
        }
        match hir[e].kind {
            ExprKind::Null | ExprKind::Missing | ExprKind::Unary { op: UnOp::Void, .. } => {
                Widening::Nullish
            }
            ExprKind::Ident(name) => {
                let symbol = self.bound.expr_symbol[e.idx()];
                if symbol.is_none() {
                    if name == known::undefined {
                        Widening::Nullish
                    } else {
                        Widening::No
                    }
                } else {
                    let declared = self.c.type_of_symbol(self.c.files().sym(self.file, symbol));
                    if self.c.is_automatic_type(declared) {
                        // It is whatever was last assigned to it.
                        Widening::Unknown
                    } else {
                        Widening::No
                    }
                }
            }
            ExprKind::NonNull(x)
            | ExprKind::AsConst(x)
            | ExprKind::Await(x)
            | ExprKind::Satisfies { expr: x, .. } => self.widening_of(x),
            ExprKind::Binary {
                op: BinOp::Comma,
                right: x,
                ..
            }
            | ExprKind::Assign {
                op: None, value: x, ..
            } => self.widening_of(x),
            ExprKind::Spread(x) => self.widening_of_what_is_spread(x),
            ExprKind::Cond { yes, no, .. } => {
                let branches = vec![(self.widening_of(yes), yes), (self.widening_of(no), no)];
                self.union_of_widenings(branches)
            }
            ExprKind::Array(items) => {
                let ty = self.c.type_of_expr(self.file, e);
                let is_tuple = self.c.is_tuple(ty);
                let mut elements = Vec::with_capacity(items.len());
                for item in hir.ids(items) {
                    elements.push((self.widening_of(item), item));
                }
                if is_tuple {
                    return Widening::Elements(elements.into_iter().map(|x| x.0).collect());
                }
                // Nothing in it: an array of `undefined`.
                if elements.is_empty() {
                    return Widening::Elements(vec![Widening::Nullish]);
                }
                match self.union_of_widenings(elements) {
                    Widening::No => Widening::No,
                    Widening::Unknown => Widening::Unknown,
                    element => Widening::Elements(vec![element]),
                }
            }
            ExprKind::Object(props) => self.widening_of_object(props),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            }
            | ExprKind::Assign {
                op: Some(BinOp::And | BinOp::Or | BinOp::Nullish),
                target: left,
                value: right,
            } => match (self.widening_of(left), self.widening_of(right)) {
                (Widening::No, Widening::No) => Widening::No,
                _ => Widening::Unknown,
            },
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                match self.widening_of(obj) {
                    Widening::No => Widening::No,
                    _ => Widening::Unknown,
                }
            }
            _ => Widening::No,
        }
    }

    /// What a union, reduced to what is no subtype of anything else in it, has: `null` and `undefined` go where there is anything
    /// else. Each with the expression it is the type of, if there is one.
    fn union_of_widenings(&mut self, members: Vec<(Widening, ExprId)>) -> Widening {
        let mut structured = None;
        let mut plain = Vec::new();
        let mut has_nullish = false;
        for (widening, e) in members {
            match widening {
                Widening::Unknown => return Widening::Unknown,
                Widening::Nullish => has_nullish = true,
                Widening::No => plain.push(e),
                // Which of two would be left, or both, is a matter of what is in them.
                _ if structured.is_some() => return Widening::Unknown,
                _ => structured = Some(widening),
            }
        }
        let Some(structured) = structured else {
            return if plain.is_empty() && has_nullish {
                Widening::Nullish
            } else {
                Widening::No
            };
        };
        // A primitive has nothing to do with an object.
        for e in plain {
            if e.is_none() {
                return Widening::Unknown;
            }
            let ty = self.c.type_of_expr(self.file, e);
            if !self.c.is_known(ty) || !self.c.every_type(ty, |c, m| c.is_primitive(m)) {
                return Widening::Unknown;
            }
        }
        structured
    }

    /// `getSpreadType`: whether spreading a `part` after a property `name` that is `null` or `undefined` leaves nothing of that.
    /// `is_partial`: all the properties of `part` may be left out.
    fn overrides(&mut self, part: TypeId, name: Atom, is_partial: bool) -> bool {
        let Some((prop, mapper)) = self.c.prop_of(part, name) else {
            return false;
        };
        // What is private or protected is not spread, and what was there by the name goes with it.
        if prop
            .flags
            .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
        {
            return !is_partial;
        }
        // `isSpreadableProperty`: nor are the methods and accessors of a class.
        if prop
            .flags
            .intersects(PropFlags::METHOD | PropFlags::ACCESSOR | PropFlags::WRITE_ONLY)
            && let PropSource::Members(members) = &prop.source
            && members.iter().any(|&(file, m)| {
                matches!(
                    self.c.bound(file).member_owner[m.idx()],
                    MemberOwner::Class(_)
                )
            })
        {
            return false;
        }
        if !is_partial && !prop.flags.contains(PropFlags::OPTIONAL) {
            return true;
        }
        // What may be left out is put together with what was there.
        let ty = self.c.type_of_prop(&prop, mapper);
        !self.c.remove_missing_or_undefined_type(ty).is_never()
    }

    fn widening_of_object(&mut self, props: Span<PropId>) -> Widening {
        let hir = self.hir;
        // What is written that has some: which property it is, its name, where it is, what it has.
        let mut found: Vec<(usize, Atom, u32, Widening)> = Vec::new();
        let mut is_flagged = false;
        // What is spread: after which property, what it may be, and whether all its properties may be left out.
        let mut spreads: Vec<(usize, Vec<TypeId>, bool)> = Vec::new();
        for (i, p) in props.iter().enumerate() {
            let prop = &hir[p];
            if prop.value.is_none() {
                continue;
            }
            if prop.kind == PropKind::Spread {
                let ty = self.c.type_of_expr(self.file, prop.value);
                if !self.c.is_known(ty) {
                    return Widening::Unknown;
                }
                // With `any` in it, it is `any`.
                if self.c.is_any(ty) {
                    return Widening::No;
                }
                // Nothing that could be spread: an error, and what is in error has nothing to widen.
                let truthy = self.c.remove_definitely_falsy(ty);
                if truthy.is_never() {
                    return Widening::No;
                }
                let mut parts = self.c.parts(truthy).to_vec();
                // `false` and the like spread nothing.
                if truthy != ty {
                    parts.push(TypeId::EMPTY_OBJECT);
                }
                spreads.push((i, parts, false));
                continue;
            }
            // A later property of the same name takes the place of an earlier one.
            let name = self.c.member_name(self.file, prop.key);
            if let Some(name) = name {
                found.retain(|x| x.1 != name);
            }
            if !matches!(prop.kind, PropKind::Init | PropKind::Shorthand) {
                continue;
            }
            let widening = self.widening_of(prop.value);
            if widening.is_unknown() {
                return Widening::Unknown;
            }
            if widening.contains_widening_type() {
                is_flagged = true;
                // Under a name that is worked out it goes into an index signature, where there is nothing to point at.
                if let Some(name) = name {
                    found.push((i, name, prop.pos, widening));
                }
            }
        }
        if !is_flagged {
            return Widening::No;
        }
        // With something in it that is yet to be known it is an intersection, which is not looked into.
        for (_, parts, _) in &spreads {
            for &part in parts {
                if self.c.is_generic_object_type(part) {
                    return Widening::Object(Vec::new());
                }
                if !self.c.is_object_type(part) {
                    return Widening::Unknown;
                }
            }
        }
        // `tryMergeUnionOfObjectTypeAndEmptyObject`: a union with no more than one member that has anything in it is that member, all
        // of whose properties may be left out.
        for (_, parts, is_partial) in &mut spreads {
            if parts.len() > 1 {
                let mut full = Vec::new();
                for &part in parts.iter() {
                    if !self.c.is_empty_object_type(part) {
                        full.push(part);
                    }
                }
                if full.len() <= 1 {
                    (*parts, *is_partial) = (full, true);
                }
            }
        }
        spreads.retain(|s| !s.1.is_empty());
        // It is one object for each choice of what is spread. The first that has something to report is reported: which that is
        // makes no difference if they all have the same.
        let choices: usize = spreads.iter().map(|s| s.1.len()).product();
        if choices > 16 {
            return Widening::Unknown;
        }
        let mut surviving: Option<Vec<usize>> = None;
        for choice in 0..choices {
            let mut rest = choice;
            let mut chosen = Vec::with_capacity(spreads.len());
            for (after, parts, is_partial) in &spreads {
                chosen.push((*after, parts[rest % parts.len()], *is_partial));
                rest /= parts.len();
            }
            let mut left = Vec::new();
            for (k, x) in found.iter().enumerate() {
                let mut is_overridden = false;
                for &(after, part, is_partial) in &chosen {
                    is_overridden |= after > x.0 && self.overrides(part, x.1, is_partial);
                }
                if !is_overridden {
                    left.push(k);
                }
            }
            if left.is_empty() {
                continue;
            }
            if surviving.as_ref().is_some_and(|others| *others != left) {
                return Widening::Unknown;
            }
            surviving = Some(left);
        }
        let surviving = surviving.unwrap_or_default();
        Widening::Object(
            found
                .into_iter()
                .enumerate()
                .filter(|(k, _)| surviving.contains(k))
                .map(|(_, x)| (x.2, x.3))
                .collect(),
        )
    }

    // ───────────────────────────── patterns ─────────────────────────────

    /// `isValidSpreadType`
    fn is_valid_spread_type(&mut self, ty: TypeId) -> bool {
        let ty = self
            .c
            .map_type(ty, |c, m| c.base_constraint_of(m).unwrap_or(m));
        let ty = self.c.remove_definitely_falsy(ty);
        match self.c.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().all(|&p| self.is_valid_spread_type(p))
            }
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Substitution { .. } => true,
            _ => self.c.is_any(ty) || ty == TypeId::OBJECT || self.c.is_object_type(ty),
        }
    }

    /// `getBindingElementTypeFromParentType`: 2700, `...rest` of what is no object.
    fn check_rest_elements(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for p in 0..hir.pats.len() {
            let PatKind::Object(props) = hir.pats[p].kind else {
                continue;
            };
            if matches!(bound.pat_parent[p], PatParent::None) {
                continue;
            }
            let Some(rest) = props.iter().find(|&x| hir[x].is_rest) else {
                continue;
            };
            let given = self.c.type_of_pat(self.file, PatId(p as u32));
            if !self.c.is_known(given) || self.c.is_any(given) {
                continue;
            }
            let given = self.c.reduced(given);
            if given == TypeId::UNKNOWN || !self.is_valid_spread_type(given) {
                self.report(hir[hir[rest].value].pos, 2700);
            }
        }
    }

    /// `checkUnusedRenamedBindingElements`: 2842. In `({ a: string }) => void`, `string` is a name nobody can use.
    fn check_renamed_binding_elements(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        // `{ a }` has no property name.
        let is_renamed = |prop: &PatProp| {
            !prop.is_rest
                && matches!(hir[prop.value].kind, PatKind::Ident(_))
                && hir[prop.value].pos != prop.pos
        };
        // `NodeIsMissing(body)`
        let is_body_missing = |func: &Func| {
            matches!(func.body, FnBody::None) && !func.flags.contains(Flags::BODY_DROPPED)
        };
        for prop in hir.pat_props.iter().filter(|prop| is_renamed(prop)) {
            let Node::Params(f) = self.around_pattern(prop.value) else {
                continue;
            };
            if !is_body_missing(&hir[f]) || matches!(bound.fns[f.idx()].owner, FnOwner::None) {
                continue;
            }
            let symbol = bound.pat_symbol[prop.value.idx()];
            if symbol.is_some() && !bound.expr_symbol.contains(&symbol) {
                let (file, start, property) = (self.file, hir[prop.value].pos, prop.pos);
                self.report(start, 2842);
                let is_missing = matches!(hir[prop.value].kind, PatKind::Ident(name) if self.c.files().atoms.bytes(name).is_empty());
                let end = if is_missing {
                    super::explain::NO_LENGTH
                } else {
                    0
                };
                self.c.explain_to(start, end, 2842, |c| {
                    let name = if is_missing {
                        "(Missing)".to_owned()
                    } else {
                        c.declaration_name_at(file, start)
                    };
                    vec![name, c.declaration_name_at(file, property)]
                });
                // `WalkUpBindingElementsAndPatterns`
                let mut outermost = prop.value;
                while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
                    bound.pat_parent[outermost.idx()]
                {
                    outermost = outer;
                }
                if let PatParent::Param(param) = bound.pat_parent[outermost.idx()]
                    && hir[param].ty.is_none()
                {
                    self.c.relate(start, 2842, |c| {
                        let end = c.end_of_param(file, param);
                        vec![super::explain::Related {
                            at: Some((file, end, end)),
                            code: 2843,
                            args: vec![c.declaration_name_at(file, property)],
                        }]
                    });
                }
            }
        }
        if !self.no_implicit_any {
            return;
        }
        // `checkVariableLikeDeclaration` returns before it asks for the type of a renamed element. 7031 comes from
        // `getTypeFromBindingPattern`, which only runs once the type of the parameter is asked for: by another element of the
        // pattern, by a call, or by a comparison with another signature.
        for (i, func) in hir.fns.iter().enumerate() {
            if func.kind != FnKind::Decl || !is_body_missing(func) {
                continue;
            }
            let mut cached = None;
            for p in func.params.iter() {
                let PatKind::Object(props) = hir[hir[p].pat].kind else {
                    continue;
                };
                if !props.iter().all(|q| is_renamed(&hir[q])) {
                    continue;
                }
                let symbol = bound.fn_symbol[i];
                let is_unused = *cached.get_or_insert_with(|| {
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && !bound.expr_symbol.contains(&symbol)
                });
                if is_unused {
                    self.out.retain(|d| {
                        d.code != 7031 || !props.iter().any(|q| hir[hir[q].value].pos == d.start)
                    });
                }
            }
        }
    }
}
