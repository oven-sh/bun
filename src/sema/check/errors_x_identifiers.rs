//! What a name or `this` comes to where it is written, and what a declaration is left with for a type:
//! 2815, 7005, 7041,
//! 7025 7055 (and 7010 7011 where `null` and `undefined` widen), 2700, 2842.
//!
//! Follows `checkIdentifier`, `checkThisExpression`, `getBindingElementTypeFromParentType`,
//! `checkUnusedRenamedBindingElements`, `widenTypeForVariableLikeDeclaration`, `reportErrorsFromWidening` and `reportImplicitAny` of
//! TypeScript 7.0.2's checker.go.

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

    /// `reportErrorsFromWidening`, of what the functions yield and return: 7018, or else 7010 7011, 7025 7055.
    fn check_widening(&mut self) {
        let bound = self.bound;
        if !self.no_implicit_any || self.strict {
            return;
        }
        for f in 0..self.hir.fns.len() {
            // What is expected of a function expression says whether it is reported.
            let is_context_known = match bound.fns[f].owner {
                FnOwner::None => false,
                FnOwner::Expr(e) => self.c.is_context_known(self.file, e),
                _ => true,
            };
            if is_context_known {
                self.check_widening_of_results(FnId(f as u32));
            }
        }
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
        // `yieldType`, `returnType`, `nextType`
        let mut unwidened = [None; 3];
        self.c
            .return_type_from_body(self.file, func, &mut unwidened);
        if !unwidened
            .iter()
            .flatten()
            .any(|&ty| self.c.contains_widening_type(ty, 0))
        {
            return;
        }
        let is_generator = f.flags.contains(Flags::GENERATOR);
        let is_async = f.flags.contains(Flags::ASYNC);
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
        // `shouldReportErrorsFromWideningWithContextualSignature`
        let expected = self.contextual_return_type(func);
        let iteration = expected
            .filter(|_| is_generator)
            .and_then(|ty| self.c.iteration_types(ty, is_async));
        let reports_yield = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.yielded)),
        };
        let reports_next = match expected {
            None => true,
            Some(_) => iteration.is_some_and(|t| self.c.is_generic(t.next)),
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
        let of_return = if is_named { 7010 } else { 7011 };
        for (reports, ty, code) in [
            (
                reports_yield,
                unwidened[0],
                if is_named { 7055 } else { 7025 },
            ),
            (reports_return, unwidened[1], of_return),
            (reports_next, unwidened[2], of_return),
        ] {
            let Some(ty) = ty else { continue };
            if !reports || !self.c.report_errors_from_widening(ty) {
                continue;
            }
            self.report(start, code);
            // `GetErrorRangeForNode`
            let file = self.file;
            let end = match (f.kind, owner) {
                (FnKind::Arrow, FnOwner::Expr(e)) => self.c.error_end_inside_parentheses(file, e),
                // The first token of a function expression that nothing names.
                (FnKind::Expr, _) if start == f.pos => 0,
                _ => self.c.end_of_name_at(file, start),
            };
            self.c.explain_to(start, end, code, |c| {
                let ty = c.regular_object(ty);
                let ty = c.type_to_string(ty);
                if is_named {
                    vec![c.source_text(file, start, end), ty]
                } else {
                    vec![ty]
                }
            });
        }
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
