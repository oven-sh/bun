//! Values that do not fit where they are put: 2322 and what stands in for it.
//!
//! Three things decide what is reported. Where a value has to fit: an annotated variable, an assignment, a `return`, a
//! default. How far in the complaint can be taken: to the property of an object literal, the element of an array literal or
//! the body of an arrow function that is to blame. And what is said: that something is missing, that something is too much,
//! or just that it does not fit.

use super::errors::{Diagnostic, is_close};
use super::relate::{Excess, Relation};
use super::*;
use crate::bind::{FnOwner, Parent};

/// `getImpliedConstraint`: reduces `[X] extends [Y]` to `X extends Y`, repeatedly. In tsgo's AST an element with a name, a `?` or a
/// `...` is not a tuple type node, so unwrapping stops there. A plain type node is returned as an element without any of those.
fn unwrap_unary_tuples(
    hir: &hir::File,
    check: TypeNodeId,
    extends: TypeNodeId,
) -> (TupleElem, TupleElem) {
    let plain = |ty: TypeNodeId| TupleElem {
        ty,
        name: Atom::NONE,
        optional: false,
        rest: false,
    };
    let is_plain =
        |elem: &TupleElem| elem.ty.is_some() && elem.name.is_none() && !elem.optional && !elem.rest;
    let (mut check, mut extends) = (plain(check), plain(extends));
    while is_plain(&check)
        && is_plain(&extends)
        && let (TypeNodeKind::Tuple(a), TypeNodeKind::Tuple(b)) =
            (hir[check.ty].kind, hir[extends.ty].kind)
        && a.len() == 1
        && b.len() == 1
    {
        check = hir[a.at(0)];
        extends = hir[b.at(0)];
    }
    (check, extends)
}

/// `covariant` in `getConditionalFlowTypeOfType`, from `node` up to `ancestor`: a parameter on the way turns it around.
fn is_covariant_below(
    hir: &hir::File,
    parents: &[TypeNodeId],
    mut node: TypeNodeId,
    ancestor: TypeNodeId,
) -> bool {
    let mut covariant = true;
    while node != ancestor {
        let parent = parents[node.idx()];
        let of_fn = |f: FnId| {
            hir[f].this_ty(hir) == node || hir[f].params.iter().any(|p| hir[p].ty == node)
        };
        covariant ^= match hir[parent].kind {
            TypeNodeKind::Fn(f) => of_fn(f),
            TypeNodeKind::Object(members) => members
                .iter()
                .any(|m| hir[m].func.is_some() && of_fn(hir[m].func)),
            _ => false,
        };
        node = parent;
    }
    covariant
}

/// What `checkTypeRelatedToEx` was given where it reports an error.
#[derive(Copy, Clone)]
struct RelationError {
    source: TypeId,
    target: TypeId,
    relation: Relation,
    /// The code of `headMessage`. For none, what `reportRelationError` says then: 2322, or 2678 under the comparable relation.
    head: u32,
    /// Whether `source`, and whether `target`, is written as an alias that is not the name it is compared under.
    named_otherwise: (bool, bool),
}

/// Where the type that something is held against is written out.
#[derive(Copy, Clone)]
enum Written {
    Nowhere,
    At(FileId, TypeNodeId),
    /// Where the variable or parameter that the expression names is annotated, if it is.
    AnnotationOf(ExprId),
}

impl Checker<'_> {
    pub(super) fn check_assignments(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        let bound = self.bound(file);
        let strict = self.p.files.options.strict_null_checks;
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            if decl.ty.is_none() || decl.init.is_none() || bound.var_stmt[d].is_none() {
                continue;
            }
            // An initializer in a `for`-`in` is an error already.
            if matches!(bound.stmt_parent[bound.var_stmt[d].idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForIn { .. }))
            {
                continue;
            }
            // Of what such a pattern is given all that is asked is that it is there.
            if strict && Self::pattern_binds_nothing(hir, decl.pat) {
                continue;
            }
            // `isInAmbientOrTypeNode`: the initializer of an ambient binding pattern is a grammar error and is not compared.
            if decl.flags.contains(Flags::AMBIENT)
                && matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_))
            {
                continue;
            }
            let target = self.type_from_node(file, decl.ty);
            let source = self.type_of_expr(file, decl.init);
            // `getESSymbolLikeTypeForNode`, `isValidESSymbolDeclaration`: of a `const` with a name, in a statement of its own.
            let stmt = bound.var_stmt[d];
            let source = match hir[decl.pat].kind {
                PatKind::Ident(name)
                    if decl.kind == VarKind::Const
                        && matches!(hir[stmt].kind, StmtKind::Var(_))
                        && !matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::For { init, .. } if init == stmt))
                        && self.is_symbol_or_symbol_for_call(file, decl.init) =>
                {
                    self.unique_symbol_of_variable(file, decl.pat, name)
                }
                _ => source,
            };
            self.check_assignable_to(
                file,
                source,
                target,
                Written::At(file, decl.ty),
                |c| {
                    let end = c.end_if_explained(|c| c.end_of_pat(file, decl.pat));
                    (hir[decl.pat].pos, end)
                },
                decl.init,
                false,
                2322,
                out,
            );
        }
        for p in 0..hir.params.len() {
            let param = &hir.params[p];
            if param.default.is_none() || bound.param_fn[p].is_none() {
                continue;
            }
            // `checkVariableLikeDeclaration`: where the function has no body a default is an error, and no more is said of it.
            if matches!(hir[bound.param_fn[p]].body, FnBody::None) {
                continue;
            }
            if strict && Self::pattern_binds_nothing(hir, param.pat) {
                continue;
            }
            let target = self.param_default_target(file, ParamId(p as u32));
            let source = self.type_of_expr(file, param.default);
            let written = if param.ty.is_some() {
                Written::At(file, param.ty)
            } else {
                Written::Nowhere
            };
            self.check_assignable_to(
                file,
                source,
                target,
                written,
                |c| {
                    let end = c.end_if_explained(|c| c.end_of_param(file, ParamId(p as u32)));
                    (param.pos.min(hir[param.pat].pos), end)
                },
                param.default,
                false,
                2322,
                out,
            );
        }
        // The defaults in a pattern, against what the pattern takes apart says they stand in for.
        for i in 0..hir.pats.len() {
            let has_defaults = match hir.pats[i].kind {
                PatKind::Object(props) => props.iter().any(|p| hir[p].default.is_some()),
                PatKind::Array(elems) => elems.iter().any(|e| hir[e].default.is_some()),
                _ => false,
            };
            if !has_defaults
                || matches!(bound.pat_parent[i], crate::bind::PatParent::None)
                || self.is_in_parameter_without_body(file, PatId(i as u32))
            {
                continue;
            }
            let defaults: Vec<(PatId, ExprId)> = match hir.pats[i].kind {
                PatKind::Object(props) => props
                    .iter()
                    .map(|p| (hir[p].value, hir[p].default))
                    .collect(),
                PatKind::Array(elems) => {
                    elems.iter().map(|e| (hir[e].pat, hir[e].default)).collect()
                }
                _ => continue,
            };
            let is_ambient = self
                .var_decl_of_pat(file, PatId(i as u32))
                .is_some_and(|d| hir[d].flags.contains(Flags::AMBIENT));
            for (pat, default) in defaults {
                // `isInAmbientOrTypeNode`: the default of a nested binding pattern in an ambient declaration is not compared.
                if is_ambient && matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
                    continue;
                }
                if default.is_some()
                    && !matches!(hir[pat].kind, PatKind::Missing)
                    && !(strict && Self::pattern_binds_nothing(hir, pat))
                {
                    let target = self.type_of_pat(file, pat);
                    let source = self.type_of_expr(file, default);
                    self.check_assignable_to(
                        file,
                        source,
                        target,
                        Written::Nowhere,
                        |c| {
                            let end = c.end_if_explained(|c| c.end_of_pat(file, pat));
                            (hir[pat].pos, end)
                        },
                        default,
                        false,
                        2322,
                        out,
                    );
                }
            }
        }
        // `checkPropertyAssignment`, `checkShorthandPropertyAssignment`: the value is held against the type of the `@type` tag.
        for &(owner, node) in &hir.jsdoc_types {
            let JsDocTypeOwner::Prop(p) = owner else {
                continue;
            };
            let (value, literal) = (hir[p].value, bound.prop_owner[p.idx()]);
            // `checkDestructuringAssignment` does not get there.
            if value.is_none() || literal.is_none() || self.is_assignment_target(file, literal) {
                continue;
            }
            let target = self.type_from_node(file, node);
            let source = self.type_of_expr(file, value);
            // `checkExpressionForMutableLocation`, where `target` is what is expected.
            let source = if self.in_const_context(file, value) {
                self.regular(source)
            } else if matches!(hir[value].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                source
            } else {
                self.widen_literal_for_context(source, Some(target))
            };
            self.check_assignable_to(
                file,
                source,
                target,
                Written::At(file, node),
                |c| {
                    let end = c.end_if_explained(|c| c.end_of_prop(file, p));
                    (hir[p].pos, end)
                },
                value,
                false,
                2322,
                out,
            );
        }
        self.check_assertions(file, out);
        self.check_literals_against_patterns(file, out);
        self.check_redeclared_variables(file, out);
        self.check_type_argument_constraints(file, out);
        self.check_mapped_type_keys(file, out);
        // `checkExportAssignment`: what is exported is held against the type of its `@type` tag.
        for &(owner, node) in &hir.jsdoc_types {
            let JsDocTypeOwner::Export(s) = owner else {
                continue;
            };
            let (StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)) = hir[s].kind else {
                continue;
            };
            if e.is_none() || bound.is_unchecked(e.idx()) {
                continue;
            }
            let target = self.type_from_node(file, node);
            let source = self.type_of_expr(file, e);
            self.check_assignable_to(
                file,
                source,
                target,
                Written::At(file, node),
                |c| {
                    let end = c.end_if_explained(|c| c.end_of_expr(file, e));
                    (c.start_of(file, e), end)
                },
                e,
                false,
                2322,
                out,
            );
        }
        for m in 0..hir.members.len() {
            let member = &hir.members[m];
            if member.kind != MemberKind::Property || member.ty.is_none() || member.init.is_none() {
                continue;
            }
            let declared = self.type_from_node(file, member.ty);
            let source = self.type_of_expr(file, member.init);
            // `getTypeOfSymbol`: `addOptionalityEx(declaredType, isProperty, isOptional)`, which is not the written type.
            // `getTypeOfAccessors` takes the annotation of an `accessor` field as it is.
            let is_optional = strict
                && member.flags.contains(Flags::OPTIONAL)
                && !member.flags.contains(Flags::ACCESSOR);
            let target = if is_optional {
                self.optional_property(declared)
            } else {
                declared
            };
            let written = if is_optional {
                Written::Nowhere
            } else {
                Written::At(file, member.ty)
            };
            self.check_assignable_to(
                file,
                source,
                target,
                written,
                |c| {
                    let end =
                        c.end_if_explained(|c| c.end_of_member_name(file, MemberId(m as u32)));
                    (member.pos, end)
                },
                member.init,
                false,
                2322,
                out,
            );
        }
        let by_kind = self.exprs_by_kind(file);
        for &assignment in by_kind.of(ExprTag::Assign) {
            let i = assignment.idx();
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir.exprs[i].kind
            else {
                continue;
            };
            if bound.is_unchecked(i) {
                continue;
            }
            // `checkReferenceExpression`: what is asserted of a reference is a reference too.
            let mut reference = target;
            while let ExprKind::NonNull(inner)
            | ExprKind::As { expr: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner) = hir[reference].kind
            {
                reference = inner;
            }
            match hir[reference].kind {
                ExprKind::Ident(_) => {}
                // Of `a?.b = x` it is only said that it cannot be.
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }
                    if chain == Chain::No => {}
                _ => continue,
            }
            // `[a = 1] = x`: a default, not an assignment.
            if self.is_assignment_target(file, ExprId(i as u32)) {
                continue;
            }
            // `{ a = 1 }` that is no assignment target (1312): `checkObjectLiteral` checks the initializer and not the name.
            if matches!(bound.expr_parent[i], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
            {
                continue;
            }
            // `checkIdentifier`: in a function `arguments` is its arguments object, whatever else goes by the name further out.
            let is_arguments = bound.is_arguments_object(reference);
            // `checkExpression(left)`: what cannot be written to has the error type, and anything goes into that.
            let left = self.type_of_expr(file, target);
            if self.is_error_type(left) {
                continue;
            }
            let wanted = if reference != target {
                // What it is asserted to be.
                let asserted = self.type_of_expr(file, target);
                if self.is_uncertain(file, target) {
                    continue;
                }
                asserted
            } else if is_arguments {
                // `IArguments`. In the initializer of a property it is an error, and what is in error can be anything.
                self.type_of_expr(file, target)
            } else {
                self.declared_type_of_reference(file, target)
            };
            let source = self.type_of_expr(file, value);
            // `checkAssignmentOperator`: `undefined` assigned to a CommonJS export with more than one declaration is not checked. The
            // declarations counted are those of the symbol the left side resolves to.
            if source.is_undefined()
                && let crate::bind::JsDeclarationKind::ExportsProperty(name) =
                    crate::bind::assignment_declaration_kind(hir, ExprId(i as u32))
                && let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[target].kind
            {
                let object = self.type_of_expr(file, obj);
                let object = self.apparent_type(object);
                if let Some((prop, _)) = self.prop_of(object, name)
                    && let PropSource::Symbol(sym) = prop.source
                    && self.files().decls(sym).len() > 1
                {
                    continue;
                }
            }
            self.check_assignable_to(
                file,
                source,
                wanted,
                Written::AnnotationOf(target),
                |c| {
                    let end = c.end_if_explained(|c| c.end_of_expr(file, target));
                    (c.start_of(file, target), end)
                },
                value,
                false,
                2322,
                out,
            );
        }
        for f in 0..hir.fns.len() {
            let func = &hir.fns[f];
            if matches!(func.body, FnBody::None) {
                continue;
            }
            if matches!(func.kind, FnKind::Constructor | FnKind::Setter) {
                let instance = match (func.kind, bound.fns[f].owner) {
                    (FnKind::Constructor, FnOwner::Member(m)) => {
                        match bound.member_owner[m.idx()] {
                            crate::bind::MemberOwner::Class(c) => {
                                let sym = self.files().sym(file, bound.class_symbol[c.idx()]);
                                Some(self.declared_type(sym))
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                };
                for s in bound.ids(bound.fns[f].returns) {
                    let StmtKind::Return(e) = hir[s].kind else {
                        continue;
                    };
                    if e.is_none() {
                        continue;
                    }
                    match instance {
                        // What a constructor returns takes the place of the instance.
                        Some(instance) => {
                            let ty = self.type_of_expr(file, e);
                            if !self.check_assignable(file, ty, instance, hir[s].pos, e, 2322, out)
                            {
                                out.push(Diagnostic {
                                    start: hir[s].pos,
                                    code: 2409,
                                });
                            }
                        }
                        None if func.kind == FnKind::Setter => out.push(Diagnostic {
                            start: hir[s].pos,
                            code: 2408,
                        }),
                        None => {}
                    }
                }
                continue;
            }
            // `getReturnTypeFromAnnotation`: a getter that says nothing goes by what its setter takes, any other function by the
            // signature of its `@type` tag.
            let declared = if func.ret.is_some() {
                self.type_from_node(file, func.ret)
            } else {
                let implied = if func.kind == FnKind::Getter {
                    self.annotated_setter_type(file, FnId(f as u32))
                } else {
                    self.return_type_of_full_signature(file, FnId(f as u32))
                };
                let Some(implied) = implied else {
                    continue;
                };
                implied
            };
            let is_async = func.flags.contains(Flags::ASYNC);
            // `unwrapReturnType`
            let wanted = if func.flags.contains(Flags::GENERATOR) {
                // `IterationUseAsyncGeneratorReturnType`: `[Symbol.iterator]` says nothing of what an async generator returns.
                if is_async {
                    let apparent = self.apparent_type(declared);
                    if self
                        .type_of_property(apparent, known::sym_async_iterator)
                        .is_none()
                        && self.type_of_property(apparent, known::next).is_none()
                    {
                        continue;
                    }
                }
                match self.iteration_types(declared, is_async) {
                    // Where awaiting it is an error, what is declared is what is wanted.
                    Some(t) if is_async => {
                        let returned =
                            self.map_type(t.returned, |c, m| c.awaited_argument(m).unwrap_or(m));
                        self.awaited_no_alias(returned).unwrap_or(declared)
                    }
                    Some(t) => t.returned,
                    // In error, and anything goes into that.
                    None => continue,
                }
            } else if is_async {
                self.awaited_no_alias(declared).unwrap_or(TypeId::ERROR)
            } else {
                declared
            };
            match func.body {
                FnBody::Expr(body) => self.check_returned(file, body, wanted, is_async, None, out),
                _ => {
                    for s in bound.ids(bound.fns[f].returns) {
                        let StmtKind::Return(e) = hir[s].kind else {
                            continue;
                        };
                        if e.is_some() {
                            self.check_returned(file, e, wanted, is_async, Some(hir[s].pos), out);
                        } else if self.p.files.options.strict_null_checks || declared.is_never() {
                            // `checkReturnStatement`: `undefined`, which without strictNullChecks nothing refuses but `never`.
                            self.check_assignable(
                                file,
                                TypeId::UNDEFINED,
                                wanted,
                                hir[s].pos,
                                ExprId::NONE,
                                2322,
                                out,
                            );
                        }
                    }
                }
            }
        }
    }

    /// Whether `pat` is, or is part of, a parameter of a function without a body.
    fn is_in_parameter_without_body(&self, file: FileId, mut pat: PatId) -> bool {
        use crate::bind::PatParent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Param(p) => {
                    let func = bound.param_fn[p.idx()];
                    return func.is_some() && matches!(hir[func].body, FnBody::None);
                }
                PatParent::Var(_) | PatParent::None => return false,
            }
        }
    }

    /// The type `checkVariableLikeDeclaration` compares the default of parameter `p` with.
    fn param_default_target(&mut self, file: FileId, p: ParamId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let param = &hir[p];
        let is_optional = param.flags.contains(Flags::OPTIONAL);
        if param.ty.is_some() {
            let declared = self.type_from_node(file, param.ty);
            // `addOptionalityEx`: a `?` adds `undefined`. A default alone does not.
            return if is_optional {
                self.optional(declared)
            } else {
                declared
            };
        }
        // Resolving the parameter also resolves the enclosing call, whose signature `open_contextual_signature` reads.
        let resolved = self.type_of_param(file, p);
        let func = bound.param_fn[p.idx()];
        // `HasContextSensitiveParameters`: a function with type parameters gets no contextual parameter types.
        if !matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_))
            || !hir[func].type_params.is_empty()
        {
            return resolved;
        }
        // A binding pattern is compared with `getWidenedTypeForVariableLikeDeclaration`, not with the type of a symbol.
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` checks the parameters the first time the function is checked, so
        // `getContextuallyTypedParameterType` sees the callee's signature before its type arguments are inferred. The adjustments of
        // `assignContextualParameterTypes` and `assignParameterType` only reach the symbol's type.
        let index = (p.0 - hir[func].params.start) as usize;
        let expected = match self.open_contextual_signature(file, func) {
            Some(open) => {
                let params = self.sig_params(open);
                self.param_type_at(&params, index)
            }
            None => self.contextual_param_type(file, func, index),
        };
        match expected {
            Some(ty) if is_optional => self.optional(ty),
            Some(ty) => ty,
            None => resolved,
        }
    }

    /// `needCheckWidenedType` of `checkVariableLikeDeclaration`: a pattern none of whose elements has a name.
    fn pattern_binds_nothing(hir: &hir::File, pat: PatId) -> bool {
        match hir[pat].kind {
            PatKind::Object(props) => props.is_empty(),
            PatKind::Array(elems) => elems
                .iter()
                .all(|e| matches!(hir[hir[e].pat].kind, PatKind::Missing)),
            _ => false,
        }
    }

    /// `getAnnotatedAccessorType` of the setter that is one symbol with the getter `getter`: what that says it takes.
    pub(super) fn annotated_setter_type(&mut self, file: FileId, getter: FnId) -> Option<TypeId> {
        let setter = self.sibling_accessor(file, getter, FnKind::Setter)?;
        let hir = self.hir(file);
        let p = hir[setter].params.iter().next()?;
        hir[p]
            .ty
            .is_some()
            .then(|| self.type_from_node(file, hir[p].ty))
    }

    /// `checkAssertionDeferred`: 2352, `x as T` where neither is anything like the other, or what is said in its place.
    fn check_assertions(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let by_kind = self.exprs_by_kind(file);
        for &assertion in by_kind.of(ExprTag::As) {
            let i = assertion.idx();
            let ExprKind::As { expr, ty } = hir.exprs[i].kind else {
                continue;
            };
            if bound.is_unchecked(i) {
                continue;
            }
            let given = self.type_of_expr(file, expr);
            let target = self.type_from_node(file, ty);
            if !self.is_known(given) || !self.is_known(target) || self.is_uncertain(file, expr) {
                continue;
            }
            let given = self.base_of_literal(given);
            let widened = self.widened(given);
            if self.is_comparable(target, widened) {
                continue;
            }
            let given = self.regular_type_of_object_literal(given);
            if !self.is_known(given) || self.is_comparable(given, target) {
                continue;
            }
            // A type that is made from a JSDoc tag is the error node.
            let (at, end) = if hir.is_in_jsdoc(hir[ty].pos) {
                (hir[ty].pos, self.end_of_type_node(file, ty))
            } else {
                (
                    self.start_inside_parentheses(file, ExprId(i as u32)),
                    self.end_inside_parentheses(file, ExprId(i as u32)),
                )
            };
            let error = RelationError {
                source: given,
                target,
                relation: Relation::Comparable,
                head: 2352,
                named_otherwise: (false, false),
            };
            let excess = self.excess_within(given, target, Relation::Comparable, at, end, 2352, 0);
            let said = match excess {
                Some(excess) => {
                    self.explain_head_over_excess(excess, at, end, error);
                    excess
                }
                None => {
                    // `tryElaborateArrayLikeErrors`: on top of that nothing is said.
                    let (given, target) = (self.force(given), self.force(target));
                    let target = if self.is_object_type(given) {
                        self.without_nullable_alternatives(target)
                    } else {
                        target
                    };
                    let loses_readonly = self.is_readonly_array_or_tuple(given)
                        && self.is_mutable_array_or_tuple(target);
                    let code = if loses_readonly { 4104 } else { 2352 };
                    self.explain_relation_error(at, end, code, error.target, error);
                    Diagnostic { start: at, code }
                }
            };
            if self.explains {
                let written = [
                    (self.annotation_of_reference(file, expr), given),
                    (Some((file, ty)), target),
                ];
                for (node, named) in written {
                    if let Some((of, node)) = node
                        && let Some(alias) = self.alias_name_as_written(of, node, named)
                    {
                        let written_out = self.type_to_string(named);
                        self.explain_renamed(said.start, said.code, &written_out, &alias);
                    }
                }
            }
            out.push(said);
        }
    }

    /// `getRegularTypeOfObjectLiteral`: an object literal, and those its properties hold, as ordinary object types. Those in a list or
    /// among alternatives stay as they are written.
    pub(super) fn regular_type_of_object_literal(&mut self, ty: TypeId) -> TypeId {
        if !self.is_object_literal_type(ty) {
            return ty;
        }
        let Some(members) = self.members(ty) else {
            return ty;
        };
        let mut shape = Shape::default();
        for prop in &members.shape().props {
            let held = self.type_of_prop(prop, members.mapper);
            let held = self.regular_type_of_object_literal(held);
            shape.props.push(Prop {
                name: prop.name,
                flags: prop.flags,
                source: Self::copy_of(held, &[prop], true),
                mapper: MapperId::IDENTITY,
            });
        }
        for info in &members.shape().index {
            let value = self.instantiate(info.value, members.mapper);
            shape.index.push(IndexInfo { value, ..*info });
        }
        self.synth(shape)
    }

    /// `checkObjectLiteral`, `contextualTypeHasPattern`: what a pattern takes apart may only have what the pattern takes out of it.
    /// 2353.
    fn check_literals_against_patterns(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_pattern =
            |pat: PatId| matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_));
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            if decl.ty.is_none()
                && decl.init.is_some()
                && bound.var_stmt[d].is_some()
                && is_pattern(decl.pat)
            {
                self.check_literals_expected_by_pattern(file, decl.init, out);
            }
        }
        for p in 0..hir.params.len() {
            let param = &hir.params[p];
            let func = bound.param_fn[p];
            if param.ty.is_none()
                && param.default.is_some()
                && is_pattern(param.pat)
                && func.is_some()
                && !matches!(hir[func].body, FnBody::None)
            {
                self.check_literals_expected_by_pattern(file, param.default, out);
            }
        }
        // The default of an element that is a pattern itself.
        for i in 0..hir.pats.len() {
            let defaults: Vec<(PatId, ExprId)> = match hir.pats[i].kind {
                PatKind::Object(props) => props
                    .iter()
                    .map(|p| (hir[p].value, hir[p].default))
                    .filter(|d| d.1.is_some() && is_pattern(d.0))
                    .collect(),
                PatKind::Array(elems) => elems
                    .iter()
                    .map(|e| (hir[e].pat, hir[e].default))
                    .filter(|d| d.1.is_some() && is_pattern(d.0))
                    .collect(),
                _ => continue,
            };
            if defaults.is_empty()
                || matches!(bound.pat_parent[i], crate::bind::PatParent::None)
                || self.is_in_parameter_without_body(file, PatId(i as u32))
            {
                continue;
            }
            let is_whole_implied = self.is_initializer_expected_by_pattern(file, PatId(i as u32));
            // What is taken apart comes first in saying what a default stands in for. Where that is not known, nothing is said.
            let taken_apart = self.type_of_pat(file, PatId(i as u32));
            let is_known = self.is_known(taken_apart);
            for (pat, default) in defaults {
                if is_known {
                    self.check_literals_expected_by_pattern(file, default, out);
                }
                // `getTypeFromBindingElement`: for what the whole pattern implies, it is looked at as what its own pattern implies.
                if is_whole_implied
                    && let Some(implied) = self.context_implied_by_pattern(file, pat)
                {
                    self.contextual.push((file, default, implied));
                    self.check_literals_expected_by_pattern(file, default, out);
                    self.contextual.pop();
                }
            }
        }
        // `getContextualTypeForAssignmentExpression`: what is assigned to a pattern is expected to be what the pattern is.
        let by_kind = self.exprs_by_kind(file);
        for &assignment in by_kind.of(ExprTag::Assign) {
            let i = assignment.idx();
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir.exprs[i].kind
            else {
                continue;
            };
            if bound.is_unchecked(i)
                || !matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
            {
                continue;
            }
            let expected = self.type_of_expr(file, target);
            self.contextual.push((file, value, expected));
            self.check_literals_expected_by_pattern(file, value, out);
            self.contextual.pop();
        }
    }

    /// Whether what the whole of the pattern that `pat` is part of implies is worked out, as what its initializer is expected to be
    /// (`getContextualTypeForInitializerExpression`): nothing else says what that is, and it is a literal, which asks.
    fn is_initializer_expected_by_pattern(&mut self, file: FileId, mut pat: PatId) -> bool {
        use crate::bind::PatParent;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_literal = |e: ExprId| {
            e.is_some() && matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_))
        };
        loop {
            match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return hir[d].ty.is_none() && is_literal(hir[d].init),
                PatParent::Param(p) => {
                    let func = bound.param_fn[p.idx()];
                    return hir[p].ty.is_none()
                        && is_literal(hir[p].default)
                        && func.is_some()
                        && self
                            .contextual_param_type(
                                file,
                                func,
                                (p.0 - hir[func].params.start) as usize,
                            )
                            .is_none();
                }
                PatParent::None => return false,
            }
        }
    }

    /// The object literals in `e` that what is expected of `e` comes down to as it is (`getContextualType`): through literals, `?:`,
    /// `&&`, `,` and the left of `||` and `??`, and into a function that is called on the spot. What a call infers from what is
    /// expected of it is widened (`getCovariantInference`) and no pattern any more.
    fn check_literals_expected_by_pattern(
        &mut self,
        file: FileId,
        e: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        if e.is_none() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Object(props) => {
                self.check_literal_against_pattern(file, e, props, out);
                for p in props.iter() {
                    if matches!(hir[p].kind, PropKind::Init | PropKind::Spread) {
                        self.check_literals_expected_by_pattern(file, hir[p].value, out);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.check_literals_expected_by_pattern(file, item, out);
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.check_literals_expected_by_pattern(file, yes, out);
                self.check_literals_expected_by_pattern(file, no, out);
            }
            ExprKind::Binary {
                op: BinOp::And | BinOp::Comma,
                right: x,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left: x,
                ..
            }
            | ExprKind::NonNull(x)
            | ExprKind::AsConst(x) => self.check_literals_expected_by_pattern(file, x, out),
            // `getContextualReturnType`, `GetImmediatelyInvokedFunctionExpression`
            ExprKind::Call(c) => {
                let ExprKind::Fn(func) = hir[hir[c].callee].kind else {
                    return;
                };
                match hir[func].body {
                    FnBody::Expr(body) => self.check_literals_expected_by_pattern(file, body, out),
                    _ => {
                        for s in bound.ids(bound.fns[func.idx()].returns) {
                            if let StmtKind::Return(returned) = hir[s].kind {
                                self.check_literals_expected_by_pattern(file, returned, out);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// The literal `e`, if what is expected of it is what a pattern implies.
    fn check_literal_against_pattern(
        &mut self,
        file: FileId,
        e: ExprId,
        props: Span<PropId>,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(file);
        let Some(context) = self.contextual_type_for_object_literal(file, e) else {
            return;
        };
        // `Some(false)`: made from a pattern all of whose names are known.
        if self.pattern_of_type(context) != Some(false) {
            return;
        }
        let Some(members) = self.members(context) else {
            return;
        };
        // A rest element takes whatever there is.
        if members
            .shape()
            .index
            .iter()
            .any(|info| info.key == TypeId::STRING)
        {
            return;
        }
        for p in props.iter() {
            let prop = &hir[p];
            if !matches!(
                prop.kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            ) {
                continue;
            }
            let Ok(name) = self.symbol_name_of_literal_member(file, prop.key) else {
                continue;
            };
            // `getPropertyOfType`: what every object has counts.
            if !name.is_some_and(|name| self.property_of_type(&members, name).is_some()) {
                out.push(Diagnostic {
                    start: prop.pos,
                    code: 2353,
                });
                let end = self.end_of_prop_name(file, p);
                self.explain_to(prop.pos, end, 2353, |c| {
                    vec![
                        c.source_text(file, prop.pos, end),
                        c.type_to_string(context),
                    ]
                });
            }
        }
    }

    /// The name of the symbol of a member of an object literal (`getSymbolOfDeclaration`): a name as it is written, a literal between
    /// brackets (`getDeclarationName`), what `a` or `a.b` between brackets comes to if that is known without running anything
    /// (`isLateBindableName`). `Ok(None)`: whatever else is worked out is no name. `Err`: it cannot be told.
    fn symbol_name_of_literal_member(
        &mut self,
        file: FileId,
        key: PropKey,
    ) -> Result<Option<Atom>, ()> {
        let hir = self.hir(file);
        let k = match key {
            PropKey::Computed(k) => k,
            PropKey::None => return Err(()),
            PropKey::Name(name) | PropKey::Private(name) => return Ok(Some(name)),
        };
        if is_parenthesized(hir, k) {
            return Ok(None);
        }
        match hir[k].kind {
            ExprKind::String(_) | ExprKind::Number(_) => return Ok(self.member_name(file, key)),
            ExprKind::Template { exprs, .. } if exprs.is_empty() => {
                return Ok(self.member_name(file, key));
            }
            // `IsSignedNumericLiteral`: the sign stays, be it a `+`.
            ExprKind::Unary {
                op: op @ (UnOp::Plus | UnOp::Minus),
                operand,
            } if !is_parenthesized(hir, operand) => {
                let ExprKind::Number(n) = hir[operand].kind else {
                    return Ok(None);
                };
                let digits = self.number_name(hir.numbers[n as usize]);
                let text = format!(
                    "{}{}",
                    if op == UnOp::Plus { '+' } else { '-' },
                    self.files().atoms.text(digits)
                );
                return Ok(Some(self.files().atoms.intern_str(&text)));
            }
            _ => {}
        }
        // `isLateBindableAST`
        if !is_entity_name_expression(hir, k) {
            return Ok(None);
        }
        let ty = self.type_of_expr(file, k);
        if !self.is_known(ty) || self.is_uncertain(file, k) {
            return Err(());
        }
        Ok(self.member_name(file, key))
    }

    /// `checkVariableLikeDeclaration`, of a declaration that is not the first of its symbol: 2403, `var x: A` and later `var x: B`.
    fn check_redeclared_variables(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        use crate::bind::{Decl, SymbolId};
        let bound = self.bound(file);
        for i in 0..bound.symbols.len() {
            let symbol = &bound.symbols[i];
            if !symbol.flags.intersects(SymFlags::FUNCTION_SCOPED_VARIABLE)
                || symbol.decls.len() < 2 && !symbol.flags.contains(SymFlags::MERGED)
            {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            // What declares no value shares the name freely, and is never `symbol.ValueDeclaration`.
            let is_value_module = self.files().flags(sym).contains(SymFlags::VALUE_MODULE);
            let mut decls = self.files().decls(sym);
            decls.retain(|d| {
                !matches!(
                    d.1,
                    Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_)
                ) && (is_value_module || !matches!(d.1, Decl::Module(_)))
                    && (!matches!(d.1, Decl::Var(_) | Decl::Param(_))
                        || self.is_symbol_of_declaration(sym, *d))
            });
            // Only among variables: with any other value the name is taken twice, which is said elsewhere.
            if decls.len() < 2
                || !decls
                    .iter()
                    .all(|d| matches!(d.1, Decl::Var(_) | Decl::Param(_)))
            {
                continue;
            }
            // The type of `symbol.ValueDeclaration`. `Some(None)`: there is one, and nothing is held against it.
            let mut first_type: Option<Option<TypeId>> = None;
            let mut value_declaration = (file, PatId::NONE);
            for &(of, decl) in &decls {
                let (Decl::Var(pat) | Decl::Param(pat)) = decl else {
                    continue;
                };
                let written = self.var_decl_of_pat(of, pat);
                // `declareSymbolEx`: `let` and `const` share a name with nothing. Whichever comes second gets a symbol of its own.
                let is_var = written.is_none_or(|d| self.hir(of)[d].kind == VarKind::Var);
                let Some(first) = first_type else {
                    let ty = if is_var {
                        let ty = self.type_of_pat(of, pat);
                        self.convert_auto_to_any(ty)
                    } else {
                        TypeId::UNRESOLVED
                    };
                    first_type = Some((self.is_known(ty) && !self.is_error_type(ty)).then_some(ty));
                    value_declaration = (of, pat);
                    continue;
                };
                let Some(declared) = first else { continue };
                // A second parameter of the name is a name taken twice.
                if !is_var || !matches!(decl, Decl::Var(_)) || of != file {
                    continue;
                }
                let here = self.type_of_pat(of, pat);
                let here = self.convert_auto_to_any(here);
                if !self.is_known(here)
                    || self.is_error_type(here)
                    || self.is_identical(declared, here)
                {
                    continue;
                }
                let start = self.hir(of)[pat].pos;
                out.push(Diagnostic { start, code: 2403 });
                let end = self.end_of_pat(of, pat);
                self.explain_to(start, end, 2403, |c| {
                    vec![
                        c.source_text(of, start, end),
                        c.type_to_string(declared),
                        c.type_to_string(here),
                    ]
                });
                let (first_of, first_name) = value_declaration;
                self.relate(start, 2403, |c| {
                    // `GetErrorRangeForNode`: all of a parameter, the name of anything else.
                    let at = match c.bound(first_of).pat_parent[first_name.idx()] {
                        crate::bind::PatParent::Param(p) => (
                            first_of,
                            c.hir(first_of)[p].pos,
                            c.end_of_param(first_of, p),
                        ),
                        _ => c.place_of_token(first_of, c.hir(first_of)[first_name].pos),
                    };
                    vec![super::explain::Related {
                        at: Some(at),
                        code: 6203,
                        args: vec![c.source_text(of, start, end)],
                    }]
                });
            }
        }
    }

    /// `symbol.ValueDeclaration` of the symbol the name `pat` declares. `declareSymbolEx` merges a `var` with the `var`s and the
    /// parameter of that name. Any other redeclaration gets a symbol of its own.
    pub(super) fn value_declaration_of_variable_name(
        &self,
        file: FileId,
        pat: PatId,
    ) -> (FileId, PatId) {
        use crate::bind::Decl;
        let own = (file, pat);
        let id = self.bound(file).pat_symbol[pat.idx()];
        let Some(written) = self.var_decl_of_pat(file, pat) else {
            return own;
        };
        if id.is_none() || self.hir(file)[written].kind != VarKind::Var {
            return own;
        }
        let sym = self.files().sym(file, id);
        let is_value_module = self.files().flags(sym).contains(SymFlags::VALUE_MODULE);
        let mut first = None;
        for (of, decl) in self.files().decls(sym) {
            match decl {
                Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) => {}
                Decl::Module(_) if !is_value_module => {}
                Decl::Var(name) | Decl::Param(name) => {
                    let other = self.var_decl_of_pat(of, name);
                    if other.is_some_and(|d| self.hir(of)[d].kind != VarKind::Var) {
                        return own;
                    }
                    if first.is_none() && self.is_symbol_of_declaration(sym, (of, decl)) {
                        first = Some((of, name));
                    }
                }
                _ => return own,
            }
        }
        first.unwrap_or(own)
    }

    /// The declaration `pat` is the name of, or a part of the name of. `None` for a parameter.
    fn var_decl_of_pat(&self, file: FileId, mut pat: PatId) -> Option<VarDeclId> {
        use crate::bind::PatParent;
        loop {
            match self.bound(file).pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                PatParent::Var(d) => return Some(d),
                PatParent::Param(_) | PatParent::None => return None,
            }
        }
    }

    /// `getSymbolOfDeclaration(declaration) == sym`. The local symbol of a module or a namespace also lists what is exported under its
    /// name, which adds no value to it and is never its `ValueDeclaration`.
    fn is_symbol_of_declaration(
        &self,
        sym: Sym,
        (file, decl): (FileId, crate::bind::Decl),
    ) -> bool {
        let own = self.bound(file).symbol_of_declaration(decl);
        own.is_some() && self.files().sym(file, own) == sym
    }

    /// `getTypeFromImportTypeNode`: the symbol `import("spec").A.B` names as a type. `None` if the module or a name is not found.
    fn import_type_symbol(
        &self,
        file: FileId,
        spec: Atom,
        name: IdList<Atom>,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        let (hir, files) = (self.hir(file), self.files());
        let module = files.module_of_specifier_as(file, spec, files.mode_of_import(file, mode))?;
        let mut sym = files.module_value(module);
        for (k, part) in hir.ids(name).enumerate() {
            let wanted = if k + 1 == name.len() {
                SymFlags::TYPE
            } else {
                SymFlags::NAMESPACE
            };
            let member = files.namespace_member(sym, part)?;
            sym = files
                .resolve_alias_as(member, wanted)
                .filter(|&next| files.flags(next).intersects(wanted))?;
        }
        Some(sym)
    }

    /// `checkTypeArgumentConstraints`, of the type arguments of a type reference: 2344, or what says more.
    fn check_type_argument_constraints(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.types.len() {
            let scope = bound.type_scope[i];
            if bound.is_unchecked_type(i) {
                continue;
            }
            let (args, sym) = match hir.types[i].kind {
                TypeNodeKind::Ref { name, args } => {
                    let mut names = [Atom::NONE; 8];
                    // No symbol is recorded for `Object<K, V>` in a JSDoc comment.
                    if args.is_empty()
                        || name.len() > names.len()
                        || self.is_jsdoc_object_with_arguments(file, TypeNodeId(i as u32))
                    {
                        continue;
                    }
                    for (slot, part) in names.iter_mut().zip(hir.ids(name)) {
                        *slot = part;
                    }
                    let Some(sym) = self.files().resolve_entity(
                        file,
                        scope,
                        &names[..name.len()],
                        SymFlags::TYPE,
                    ) else {
                        continue;
                    };
                    let Some(sym) = self.files().resolve_alias_if_needed(sym) else {
                        continue;
                    };
                    (args, sym)
                }
                // `checkImportType`: `import("m").A<T>` is held to the same.
                TypeNodeKind::Import {
                    spec,
                    name,
                    args,
                    is_typeof: false,
                    mode,
                } if !args.is_empty() => {
                    let Some(sym) = self.import_type_symbol(file, spec, name, mode) else {
                        continue;
                    };
                    (args, sym)
                }
                _ => continue,
            };
            let (least, most) = self.type_argument_arity(sym);
            if args.len() < least || args.len() > most {
                continue;
            }
            let params = self.type_params_of_symbol(sym);
            if params.len() != most
                || !params
                    .iter()
                    .any(|&p| self.constraint_of_type_param(p).is_some())
            {
                continue;
            }
            // `checkTypeReferenceOrImport`
            let referenced = self.type_from_node(file, TypeNodeId(i as u32));
            let referenced = self.force(referenced);
            if self.is_error_type(referenced) {
                continue;
            }
            let given = self.types_from_nodes(file, args);
            let filled = self.fill_type_args(&params, &given);
            let mapper = self.mapper_from(&params, &filled);
            for (k, node) in hir.ids(args).enumerate() {
                let Some(constraint) = self.constraint_of_type_param(params[k]) else {
                    continue;
                };
                // What is inferred where a constraint holds is inferred to satisfy it.
                if matches!(hir[node].kind, TypeNodeKind::Infer(_)) {
                    continue;
                }
                let constraint = self.instantiate(constraint, mapper);
                let argument = filled[k];
                if !self.is_known(argument) || !self.is_known(constraint) {
                    continue;
                }
                let fits = self.compare_if_certain(|c| c.is_assignable(argument, constraint));
                if fits != Some(false) {
                    continue;
                }
                let (at, end) = (hir[node].pos, self.end_of_type_node(file, node));
                self.report_not_assignable_with_end(argument, constraint, at, end, 2344, out);
                break;
            }
        }
        // `checkClassLikeDeclaration`: those of `extends Base<Args>`, against each way to make a `Base` that takes as many.
        for c in 0..hir.classes.len() {
            let class = &hir.classes[c];
            if class.extends.is_none()
                || class.extends_args.is_empty()
                || bound.class_symbol[c].is_none()
                || bound.is_unchecked(class.extends.idx())
            {
                continue;
            }
            let sym = self.files().sym(file, bound.class_symbol[c]);
            if self.base_types(sym).is_empty() {
                continue;
            }
            let constructor = self.base_constructor_type_of_class(sym);
            if !self.is_known(constructor) || self.is_uncertain(file, class.extends) {
                continue;
            }
            // `getConstructorsForTypeArguments`
            let apparent = self.apparent_type(constructor);
            let given = self.types_from_nodes(file, class.extends_args);
            'signatures: for sig in self.signatures(apparent, true) {
                let params = self.sig_type_params(sig);
                // `getMinTypeArgumentCount`
                let least = (0..params.len())
                    .rev()
                    .find(|&i| self.default_of_type_param(params[i]).is_none())
                    .map_or(0, |i| i + 1);
                if given.len() < least || given.len() > params.len() {
                    continue;
                }
                let outer = self
                    .sig_decl(sig)
                    .map_or(MapperId::IDENTITY, |(_, _, mapper)| mapper);
                let filled = self.fill_sig_type_args(sig, &params, &given);
                let mapper = self.mapper_from(&params, &filled);
                for k in 0..params.len() {
                    let Some(mut constraint) = self.constraint_of_type_param(params[k]) else {
                        continue;
                    };
                    // What it mentions of what the signature was found in. A fresh parameter comes with that filled in.
                    if matches!(*self.data(params[k]), TypeData::TypeParam(_, _, around) if around == MapperId::IDENTITY)
                    {
                        constraint = self.instantiate(constraint, outer);
                    }
                    let constraint = self.instantiate(constraint, mapper);
                    let argument = filled[k];
                    if !self.is_known(argument)
                        || !self.is_known(constraint)
                        || self.compare_if_certain(|c| c.is_assignable(argument, constraint))
                            != Some(false)
                    {
                        continue;
                    }
                    // A default that does not do is not written here: there is nowhere to say so.
                    if k < given.len() {
                        let node: TypeNodeId = hir.id_at(class.extends_args, k);
                        let (at, end) = (hir[node].pos, self.end_of_type_node(file, node));
                        self.report_not_assignable_with_end(
                            argument, constraint, at, end, 2344, out,
                        );
                    }
                    break 'signatures;
                }
            }
        }
    }

    /// `checkMappedType`: what is mapped over, or what it is renamed to, has to be a key. 2322.
    fn check_mapped_type_keys(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let keys = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
        for t in 0..hir.types.len() {
            let TypeNodeKind::Mapped(m) = hir.types[t].kind else {
                continue;
            };
            if bound.is_unchecked_type(t) {
                continue;
            }
            let (at, ty) = if hir[m].name_ty.is_some() {
                (hir[m].name_ty, self.type_from_node(file, hir[m].name_ty))
            } else {
                // `getConstraintTypeFromMappedType`: one that goes round in a circle is in error, which is said elsewhere.
                let param = self.type_param(file, hir[m].param);
                let Some(constraint) = self.constraint_of_type_param(param) else {
                    continue;
                };
                (hir[hir[m].param].constraint, constraint)
            };
            if at.is_none() || !self.is_known(ty) {
                continue;
            }
            let fits = self.compare_if_certain(|c| c.is_assignable(ty, keys));
            if fits == Some(false) {
                let (start, end) = (hir[at].pos, self.end_of_type_node(file, at));
                out.push(Diagnostic { start, code: 2322 });
                let error = RelationError {
                    source: ty,
                    target: keys,
                    relation: Relation::Assignable,
                    head: 2322,
                    named_otherwise: (false, false),
                };
                self.explain_relation_error(start, end, 2322, keys, error);
            }
        }
    }

    /// The result of `compare`. `None` if a comparison inside it was cut short (nesting depth, native stack, time): its result is unknown.
    fn compare_if_certain(&mut self, compare: impl FnOnce(&mut Self) -> bool) -> Option<bool> {
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let result = compare(self);
        let is_certain = !self.relation_gave_up && !self.timed_out();
        self.relation_gave_up |= gave_up_before;
        is_certain.then_some(result)
    }

    /// What each type is written directly in, of the types of a file. `NONE` for those that are in no other type.
    pub(super) fn type_node_parents(
        hir: &hir::File,
        bound: &crate::bind::Bound,
    ) -> Vec<TypeNodeId> {
        let mut parents = vec![TypeNodeId::NONE; hir.types.len()];
        let mut set = |child: TypeNodeId, parent: TypeNodeId| {
            if child.is_some() {
                parents[child.idx()] = parent;
            }
        };
        for (i, t) in hir.types.iter().enumerate() {
            let me = TypeNodeId(i as u32);
            match t.kind {
                TypeNodeKind::Ref { args, .. }
                | TypeNodeKind::Typeof { args, .. }
                | TypeNodeKind::Import { args, .. } => hir.ids(args).for_each(|a| set(a, me)),
                TypeNodeKind::Template { types, .. }
                | TypeNodeKind::Union(types)
                | TypeNodeKind::Intersection(types) => hir.ids(types).for_each(|a| set(a, me)),
                TypeNodeKind::Array(x)
                | TypeNodeKind::Keyof(x)
                | TypeNodeKind::Readonly(x)
                | TypeNodeKind::Predicate { ty: x, .. } => set(x, me),
                TypeNodeKind::Tuple(elems) => elems.iter().for_each(|e| set(hir[e].ty, me)),
                TypeNodeKind::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => [check, extends, yes, no]
                    .into_iter()
                    .for_each(|x| set(x, me)),
                TypeNodeKind::IndexedAccess { obj, index } => {
                    [obj, index].into_iter().for_each(|x| set(x, me))
                }
                TypeNodeKind::Mapped(m) => {
                    set(hir[m].name_ty, me);
                    set(hir[m].ty, me);
                    set(hir[hir[m].param].constraint, me);
                }
                TypeNodeKind::Infer(p) => set(hir[p].constraint, me),
                _ => {}
            }
        }
        // What a function type or a type literal is made of.
        let of_fn = |f: FnId, me: TypeNodeId, parents: &mut Vec<TypeNodeId>| {
            let func = &hir[f];
            for x in func
                .params
                .iter()
                .map(|p| hir[p].ty)
                .chain([func.ret, func.this_ty(hir)])
            {
                if x.is_some() {
                    parents[x.idx()] = me;
                }
            }
            for p in func.type_params.iter() {
                for x in [hir[p].constraint, hir[p].default] {
                    if x.is_some() {
                        parents[x.idx()] = me;
                    }
                }
            }
        };
        for (i, t) in hir.types.iter().enumerate() {
            let me = TypeNodeId(i as u32);
            match t.kind {
                TypeNodeKind::Fn(f) => of_fn(f, me, &mut parents),
                TypeNodeKind::Object(members) => {
                    for m in members.iter() {
                        if hir[m].ty.is_some() {
                            parents[hir[m].ty.idx()] = me;
                        }
                        if hir[m].func.is_some() {
                            of_fn(hir[m].func, me, &mut parents);
                        }
                    }
                }
                _ => {}
            }
        }
        let _ = bound;
        parents
    }

    /// `getConditionalFlowTypeOfType`
    pub(super) fn conditional_flow_type_of_type(
        &mut self,
        file: FileId,
        ty: TypeId,
        mut node: TypeNodeId,
    ) -> TypeId {
        let parents = self.type_parents(file);
        if parents.is_empty() {
            return ty;
        }
        let hir = self.hir(file);
        let is_variable = self.is_type_variable(ty);
        let mut constraints: Vec<TypeId> = Vec::new();
        let written_at = node;
        loop {
            let parent = parents[node.idx()];
            if parent.is_none() {
                break;
            }
            if let TypeNodeKind::Cond {
                check,
                extends,
                yes,
                ..
            } = hir[parent].kind
                && yes == node
                && (is_variable || is_covariant_below(hir, &parents, written_at, parent))
                && let Some(constraint) = self.implied_constraint(file, ty, check, extends)
            {
                constraints.push(constraint);
            }
            if is_variable
                && let TypeNodeKind::Mapped(m) = hir[parent].kind
                && ty == self.type_param(file, hir[m].param)
                && let Some((_, constraint)) = self.mapped_key_flow_constraint(file, parent, node)
            {
                constraints.push(constraint);
            }
            node = parent;
        }
        if constraints.is_empty() {
            return ty;
        }
        let constraint = self.intersection(&constraints);
        self.substitution_type(ty, constraint)
    }

    /// The mapped type arm of `getConditionalFlowTypeOfType`. If `node` is the template `X` of the mapped type `parent`, written
    /// `{ [K in keyof T]: X }` without an `as` clause, and the constraint of `T` is arrays and tuples only, returns `K` and the
    /// constraint `number | `${number}`` that `K` has inside `X`.
    fn mapped_key_flow_constraint(
        &mut self,
        file: FileId,
        parent: TypeNodeId,
        node: TypeNodeId,
    ) -> Option<(TypeId, TypeId)> {
        let hir = self.hir(file);
        let TypeNodeKind::Mapped(m) = hir[parent].kind else {
            return None;
        };
        if hir[m].ty != node || hir[m].name_ty.is_some() {
            return None;
        }
        let Some((source, true)) = self.mapped_modifiers_source(file, parent) else {
            return None;
        };
        let source = self.actual_type_variable(source);
        let constraint = self.constraint_of_type_param(source)?;
        // `everyType` applies the predicate to `never` itself, which has no parts.
        if constraint.is_never()
            || !self
                .parts(constraint)
                .iter()
                .all(|&t| self.is_array_or_tuple(t))
        {
            return None;
        }
        let numeric_string = self.template_type(&[known::empty, known::empty], &[TypeId::NUMBER]);
        let index = self.union(&[TypeId::NUMBER, numeric_string]);
        Some((self.type_param(file, hir[m].param), index))
    }

    /// `getImpliedConstraint`
    pub(super) fn implied_constraint(
        &mut self,
        file: FileId,
        ty: TypeId,
        check: TypeNodeId,
        extends: TypeNodeId,
    ) -> Option<TypeId> {
        let (check, extends) = unwrap_unary_tuples(self.hir(file), check, extends);
        let checked = self.type_from_tuple_element(file, check);
        (self.actual_type_variable(checked) == self.actual_type_variable(ty))
            .then(|| self.type_from_tuple_element(file, extends))
    }

    /// `getTypeFromTypeNode` of a tuple element: `getTypeFromOptionalTypeNode`, `getTypeFromRestTypeNode`,
    /// `getTypeFromNamedTupleTypeNode`.
    fn type_from_tuple_element(&mut self, file: FileId, elem: TupleElem) -> TypeId {
        if elem.rest {
            let element = array_element_type_node(self.hir(file), elem.ty).unwrap_or(elem.ty);
            return self.type_from_node(file, element);
        }
        let ty = self.type_from_node(file, elem.ty);
        if elem.optional {
            self.optional_property(ty)
        } else {
            ty
        }
    }

    /// `IsJSDocTypeAssertion`: where the parenthesis opens that a `@type` tag makes a type assertion of, if `e` is that assertion.
    /// `getEffectiveCheckNode` stops at it (`OEKExcludeJSDocTypeAssertion`).
    pub(super) fn start_of_jsdoc_type_assertion(&self, file: FileId, e: ExprId) -> Option<u32> {
        let hir = self.hir(file);
        let ExprKind::As { ty, .. } = hir[e].kind else {
            return None;
        };
        let pos = hir[ty].pos;
        let after = hir
            .jsdoc_comments
            .partition_point(|comment| comment.0 <= pos);
        let &(_, comment_end) = hir.jsdoc_comments.get(after.checked_sub(1)?)?;
        if pos >= comment_end {
            return None;
        }
        let open = self.skip_trivia_from(file, comment_end);
        (hir.text.get(open as usize) == Some(&b'(')).then_some(open)
    }

    /// `statement`: where the `return` starts, which is where the complaint goes unless it is about one arm of `c ? a : b`.
    fn check_returned(
        &mut self,
        file: FileId,
        e: ExprId,
        wanted: TypeId,
        is_async: bool,
        statement: Option<u32>,
        out: &mut Vec<Diagnostic>,
    ) {
        if let ExprKind::Cond { yes, no, .. } = self.hir(file)[e].kind {
            self.check_returned(file, yes, wanted, is_async, None, out);
            self.check_returned(file, no, wanted, is_async, None, out);
            return;
        }
        let ty = self.type_of_expr(file, e);
        if self.is_uncertain(file, e) {
            return;
        }
        // `checkAwaitedType`, `withAlias` false
        let ty = if is_async {
            self.awaited_no_alias(ty).unwrap_or(TypeId::ERROR)
        } else {
            ty
        };
        // `getEffectiveCheckNode`
        let mut e = e;
        while let ExprKind::Satisfies { expr, .. } = self.hir(file)[e].kind {
            e = expr;
        }
        self.check_assignable_to(
            file,
            ty,
            wanted,
            Written::Nowhere,
            // Of a `return` statement it is the keyword that is pointed at.
            |c| match statement {
                Some(at) => (at, 0),
                None => match c.start_of_jsdoc_type_assertion(file, e) {
                    Some(open) => (
                        open,
                        c.end_if_explained(|c| c.end_of_bracket_at(file, open)),
                    ),
                    None => (
                        c.start_inside_parentheses(file, e),
                        c.end_if_explained(|c| c.error_end_inside_parentheses(file, e)),
                    ),
                },
            },
            e,
            true,
            2322,
            out,
        );
    }

    /// Complains unless `source`, the type of `e` if there is an `e`, fits `target`. `at`: where, if not further in.
    /// `head`: what to say if there is nothing more telling to say.
    pub(super) fn check_assignable(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        e: ExprId,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        self.check_assignable_to(
            file,
            source,
            target,
            Written::Nowhere,
            |_| (at, 0),
            e,
            false,
            head,
            out,
        )
    }

    /// The same. `end`: where the node that starts at `at` ends.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn check_assignable_with_end(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        e: ExprId,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        self.check_assignable_to(
            file,
            source,
            target,
            Written::Nowhere,
            |_| (at, end),
            e,
            false,
            head,
            out,
        )
    }

    /// The same. `end` is only asked where the node ends once there is something to complain of.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn check_assignable_with_end_from(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: impl FnOnce(&Self) -> u32,
        e: ExprId,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        self.check_assignable_to(
            file,
            source,
            target,
            Written::Nowhere,
            |c| (at, end(c)),
            e,
            false,
            head,
            out,
        )
    }

    /// `end()`, if where errors end is going to be read.
    fn end_if_explained(&self, end: impl FnOnce(&Self) -> u32) -> u32 {
        if self.explains { end(self) } else { 0 }
    }

    /// `written`: where `target` is written out, if it is. `is_effective`: the parentheses around `e` are no part of it.
    /// `place`: where to complain if not further in, and where the node that starts there ends (`0`: with the token there). It is
    /// only asked once there is something to complain of.
    #[allow(clippy::too_many_arguments)]
    #[inline]
    fn check_assignable_to(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        written: Written,
        place: impl FnOnce(&Self) -> (u32, u32),
        e: ExprId,
        is_effective: bool,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let Some(is_too_complex) = self.finds_unassignable(file, source, target, written, e) else {
            return true;
        };
        let (at, end) = place(&*self);
        let said_before = out.len();
        self.report_unassignable(
            file,
            source,
            target,
            written,
            (at, end),
            e,
            is_effective,
            is_too_complex,
            head,
            out,
        );
        if self.explains
            && let [said] = out[said_before..]
            && said.start == at
        {
            self.explain_aliases_as_written(file, said, (e, source), (written, target));
        }
        false
    }

    /// `None`: `source` fits `target`, or there is no telling. Otherwise there is something to complain of, and it is said whether
    /// that is that the comparison got too complex.
    fn finds_unassignable(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        written: Written,
        e: ExprId,
    ) -> Option<bool> {
        if !self.is_known(source) || !self.is_known(target) {
            return None;
        }
        self.relation_too_complex = false;
        let fits = self.compare_if_certain(|c| c.is_assignable(source, target));
        let is_too_complex = std::mem::take(&mut self.relation_too_complex) && !self.timed_out();
        match fits {
            Some(true) => {
                if !self.is_refused_by_hosting_alias(file, written, e, source, target) {
                    return None;
                }
            }
            // Cut short for another reason than complexity: the result is unknown. tsgo's own depth limit (2321) is among those.
            None if !is_too_complex => return None,
            _ => {}
        }
        if e.is_some() && self.is_uncertain(file, e) {
            return None;
        }
        Some(is_too_complex)
    }

    /// What `check_assignable_to` says once `finds_unassignable` has found something to complain of.
    #[allow(clippy::too_many_arguments)]
    fn report_unassignable(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        written: Written,
        (at, end): (u32, u32),
        e: ExprId,
        is_effective: bool,
        is_too_complex: bool,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        // `checkTypeRelatedToEx`: an overflow is reported instead of the relation error. The pair is not compared again to elaborate.
        if is_too_complex {
            out.push(Diagnostic {
                start: at,
                code: 2859,
            });
            self.explain_to(at, end, 2859, |c| {
                vec![c.type_to_string(source), c.type_to_string(target)]
            });
            // `isTypeRelatedTo` has come upon it before, with no node to report it on but `c.currentNode`: the assignment.
            if e.is_some()
                && let Parent::Expr(whole) = self.bound(file).expr_parent[e.idx()]
                && whole.is_some()
                && matches!(self.hir(file)[whole].kind, ExprKind::Assign { value, .. } if value == e)
            {
                let start = self.start_inside_parentheses(file, whole);
                let end = self.end_inside_parentheses(file, whole);
                out.push(Diagnostic { start, code: 2859 });
                self.explain_to(start, end, 2859, |c| {
                    vec![c.type_to_string(source), c.type_to_string(target)]
                });
            }
            return;
        }
        if e.is_none() || !self.elaborate_from(file, e, is_effective, source, target, head, out) {
            let given = if e.is_some() {
                self.annotation_of_reference(file, e)
            } else {
                None
            };
            let written = self.written_at(file, written);
            let named_otherwise = (
                self.is_named_otherwise(given, source),
                self.is_named_otherwise(written, target),
            );
            let said = out.len();
            self.report_not_assignable_as(source, target, at, end, head, named_otherwise, out);
            if self.explains
                && let Some(&said) = out.get(said)
            {
                // The union a type alias stands for is no enum, though it has all the members of one (`TypeFlagsEnumLiteral`): as
                // of any union, what is wrong with the first member that does not fit is said (`eachTypeRelatedToType`).
                if named_otherwise.0 && self.is_whole_enum(source) {
                    let (gave_up, too_complex) = (self.relation_gave_up, self.relation_too_complex);
                    let unfit = self
                        .parts(source)
                        .iter()
                        .copied()
                        .find(|&member| !self.is_assignable(member, target));
                    self.relation_gave_up = gave_up;
                    self.relation_too_complex = too_complex;
                    if let Some(unfit) = unfit {
                        self.explain_chain(said.start, said.code, |c| {
                            c.assignability_lines(unfit, target, 1)
                        });
                    }
                }
                let sides = [
                    (named_otherwise.0, given, source),
                    (named_otherwise.1, written, target),
                ];
                for (is_named_otherwise, node, ty) in sides {
                    if is_named_otherwise
                        && let Some((of, node)) = node
                        && let Some(alias) = self.alias_written_at(of, node)
                    {
                        let (from, to) = (self.type_to_string(ty), self.type_to_string(alias));
                        self.explain_first_line_renamed(said.start, said.code, &from, &to);
                    }
                }
            }
        }
    }

    /// `Type.alias` of what is written at `node`, a reference to a type alias that `is_named_otherwise` holds for, as a type that
    /// goes by it.
    fn alias_written_at(&mut self, mut file: FileId, mut node: TypeNodeId) -> Option<TypeId> {
        use crate::bind::Decl;
        let resolve = |c: &Self, file: FileId, node: TypeNodeId| {
            let TypeNodeKind::Ref { name, .. } = c.hir(file)[node].kind else {
                return None;
            };
            let names: Vec<Atom> = c.hir(file).ids(name).collect();
            c.files()
                .resolve_entity(
                    file,
                    c.bound(file).type_scope[node.idx()],
                    &names,
                    SymFlags::TYPE,
                )
                .and_then(|s| c.files().resolve_alias_if_needed(s))
        };
        for _ in 0..16 {
            let sym = resolve(self, file, node)?;
            let mut decls = self.files().decls(sym).into_iter();
            let (of, alias) = decls.find_map(|(of, decl)| match decl {
                Decl::Alias(alias) => Some((of, alias)),
                _ => None,
            })?;
            // All it says is the name of an alias without type parameters: it is what that alias is.
            let body = self.hir(of)[alias].ty;
            if body.is_some()
                && let Some(inner) = resolve(self, of, body)
                && self.files().flags(inner).contains(SymFlags::TYPE_ALIAS)
                && !self
                    .files()
                    .flags(inner)
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                && self.type_params_of_symbol(inner).is_empty()
            {
                (file, node) = (of, body);
                continue;
            }
            let TypeNodeKind::Ref { args, .. } = self.hir(file)[node].kind else {
                return None;
            };
            let params = self.type_params_of_symbol(sym);
            let args = self.types_from_nodes(file, args);
            if args.len() > params.len() {
                return None;
            }
            let args = self.fill_type_args(&params, &args);
            return Some(self.intern(TypeData::LazyAlias {
                sym,
                args: args.into(),
            }));
        }
        None
    }

    fn written_at(&self, file: FileId, written: Written) -> Option<(FileId, TypeNodeId)> {
        match written {
            Written::Nowhere => None,
            Written::At(of, node) => Some((of, node)),
            Written::AnnotationOf(e) => self.annotation_of_reference(file, e),
        }
    }

    /// The alias probe of `structuredTypeRelatedToWorker`, where `target` and the variable `e` are both annotated with instantiations
    /// of one `hosting_alias`: whether its variances say that `source` is not related to `target`.
    fn is_refused_by_hosting_alias(
        &mut self,
        file: FileId,
        written: Written,
        e: ExprId,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if e.is_none() || !self.may_have_hosting_alias(target) {
            return false;
        }
        let written = self.written_at(file, written);
        let Some((alias, targets)) = self.hosting_alias(written, target) else {
            return false;
        };
        let given = self.annotation_of_reference(file, e);
        let Some((same, sources)) = self.hosting_alias(given, source) else {
            return false;
        };
        same == alias
            && self.compare_if_certain(|c| {
                c.alias_arguments_related(alias, &sources, &targets) == Some(false)
            }) == Some(true)
    }

    /// The kinds of type `hosting_alias` has something for.
    fn may_have_hosting_alias(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Anon { .. } | TypeData::Fns { .. } | TypeData::Cond { .. }
        )
    }

    /// `getTypeFromTypeAliasReference`: `Type.alias` of the object or conditional type `ty`, written at `written` as `A<..>`, where
    /// the body of the generic alias `A` is a reference to another generic alias. That reference is instantiated under `A`
    /// (`getAliasSymbolForTypeNode`), and `alias_of` only knows the innermost alias.
    fn hosting_alias(
        &mut self,
        written: Option<(FileId, TypeNodeId)>,
        ty: TypeId,
    ) -> Option<(Sym, Vec<TypeId>)> {
        use crate::bind::ScopeKind;
        let (file, node) = written?;
        if !self.may_have_hosting_alias(ty) {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let TypeNodeKind::Ref { name, args } = hir[node].kind else {
            return None;
        };
        let scope = bound.type_scope[node.idx()];
        if args.is_empty() || scope.is_none() {
            return None;
        }
        // Narrowed, it is no longer what is written.
        if self.type_from_node(file, node) != ty {
            return None;
        }
        let names: Vec<Atom> = hir.ids(name).collect();
        let host = self
            .files()
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .and_then(|s| self.files().resolve_alias_if_needed(s))?;
        let (of, alias) = self.generic_alias_declaration(host)?;
        let (hir, bound) = (self.hir(of), self.bound(of));
        let body = hir[alias].ty;
        if body.is_none() {
            return None;
        }
        let TypeNodeKind::Ref {
            name: hosted,
            args: hosted_args,
        } = hir[body].kind
        else {
            return None;
        };
        let scope = bound.type_scope[body.idx()];
        if hosted_args.is_empty() || scope.is_none() {
            return None;
        }
        let names: Vec<Atom> = hir.ids(hosted).collect();
        let hosted = self
            .files()
            .resolve_entity(of, scope, &names, SymFlags::TYPE)
            .and_then(|s| self.files().resolve_alias_if_needed(s))?;
        self.generic_alias_declaration(hosted)?;
        // `getConditionalType`, `getObjectTypeInstantiation`: only an instantiation of the body of the hosted alias gets the alias.
        if self.alias_of(ty)?.0 != hosted {
            return None;
        }
        // `instantiateMappedType`: an instantiation of a homomorphic mapped type keeps the alias of the mapped type.
        if let Some((mapped_in, mapped, _)) = self.mapped_origin(ty) {
            let param = self.type_param(mapped_in, self.mapped_decl(mapped_in, mapped).param);
            if let Some(constraint) = self.constraint_of_type_param(param)
                && matches!(self.data(constraint), TypeData::Keyof(_))
            {
                return None;
            }
        }
        // `isLocalTypeAlias`: an alias declared in a function does not host a reference to a top-level alias.
        let mut around = bound.alias_scope[alias.idx()];
        while around.is_some() {
            let s = &bound.scopes[around.idx()];
            if matches!(s.kind, ScopeKind::Fn(_)) {
                return None;
            }
            around = s.parent;
        }
        let params = self.type_params_of_symbol(host);
        let args = self.types_from_nodes(file, args);
        if args.len() > params.len() {
            return None;
        }
        Some((host, self.fill_type_args(&params, &args)))
    }

    /// Has what was noted of the error `said`, that `given.1`, the type of `given.0`, does not fit `wanted.1`, go by `Type.alias` where
    /// the printer cannot tell it.
    fn explain_aliases_as_written(
        &mut self,
        file: FileId,
        said: Diagnostic,
        given: (ExprId, TypeId),
        wanted: (Written, TypeId),
    ) {
        let annotation = if given.0.is_some() {
            self.annotation_of_reference(file, given.0)
        } else {
            None
        };
        let sides = [
            (annotation, given.1, false),
            (self.written_at(file, wanted.0), wanted.1, true),
        ];
        let mut names = Vec::new();
        for (written, ty, writing) in sides {
            // `getNormalizedUnionOrIntersectionType` makes an intersection anew, without alias.
            let compared = self.normalized(ty, writing);
            if compared != ty && self.is_intersection(ty) && self.is_intersection(compared) {
                names.push((
                    self.type_to_string(compared),
                    self.type_to_string_written_out(compared),
                ));
            }
            let Some((of, node)) = written else {
                continue;
            };
            // Narrowed, it is no longer what is written.
            let there = self.type_from_node(of, node);
            if self.force(there) == self.force(ty) {
                self.aliases_as_written(of, node, MapperId::IDENTITY, 0, &mut names);
            }
        }
        for (printed, alias) in names {
            self.explain_renamed(said.start, said.code, &printed, &alias);
        }
    }

    /// `getTypeFromTypeAliasReference`, `instantiateTypeWithAlias`. For the reference to a generic type alias at `node`, and for those
    /// its body is made of: what the printer calls the type and what `Type.alias` calls it, if the body is a reference to another
    /// generic alias, a union or an intersection. `mapper`: what the type parameters around `node` stand for.
    fn aliases_as_written(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        mapper: MapperId,
        depth: u32,
        names: &mut Vec<(String, String)>,
    ) {
        if node.is_none() || depth > 4 {
            return;
        }
        let hir = self.hir(file);
        if let TypeNodeKind::Union(members) | TypeNodeKind::Intersection(members) = hir[node].kind {
            for member in hir.ids(members) {
                self.aliases_as_written(file, member, mapper, depth + 1, names);
            }
            return;
        }
        let Some((sym, arguments)) = self.deferrable_alias_reference(file, node) else {
            return;
        };
        let Some((of, alias)) = self.generic_alias_declaration(sym) else {
            return;
        };
        let body = self.hir(of)[alias].ty;
        if body.is_none() {
            return;
        }
        let declared = self.type_from_node(file, node);
        let ty = self.instantiate(declared, mapper);
        let ty = self.force(ty);
        let params = self.local_type_params_of_symbol(sym);
        let mut given = self.types_from_nodes(file, arguments);
        for argument in &mut given {
            *argument = self.instantiate(*argument, mapper);
        }
        let given = self.fill_type_args(&params, &given);
        let is_named = match self.hir(of)[body].kind {
            TypeNodeKind::Union(_) | TypeNodeKind::Intersection(_) => {
                ty != TypeId::BOOLEAN && self.is_union_or_intersection(ty) && self.reduced(ty) == ty
            }
            TypeNodeKind::Ref { .. } => self.is_hosted_by(of, alias, ty),
            _ => false,
        };
        if is_named {
            // The printer names one of these by its alias.
            let named = self.intern(TypeData::LazyAlias {
                sym,
                args: given.clone().into(),
            });
            let (printed, named) = (self.type_to_string(ty), self.type_to_string(named));
            if printed != named {
                names.push((printed, named));
            }
        }
        let inner = self.mapper_from(&params, &given);
        self.aliases_as_written(of, body, inner, depth + 1, names);
    }

    /// `getTypeFromTypeAliasReference`: whether `ty`, which comes of the generic type alias declared as `alias` of `file`, whose body
    /// is a reference to another generic alias, has the former for its `Type.alias`.
    fn is_hosted_by(&mut self, file: FileId, alias: AliasId, ty: TypeId) -> bool {
        use crate::bind::ScopeKind;
        if !self.may_have_hosting_alias(ty) {
            return false;
        }
        if let Some(host) = self.hosting_alias_declaration(ty) {
            return host == (file, alias);
        }
        // The alias at the end of the references: the one `alias_of` knows.
        let (mut of, mut body) = (file, self.hir(file)[alias].ty);
        let mut innermost = None;
        for _ in 0..8 {
            let Some((hosted, _)) = self.deferrable_alias_reference(of, body) else {
                break;
            };
            let Some((next, declaration)) = self.generic_alias_declaration(hosted) else {
                break;
            };
            innermost = Some(hosted);
            (of, body) = (next, self.hir(next)[declaration].ty);
        }
        if innermost.is_none() || self.alias_of(ty).map(|found| found.0) != innermost {
            return false;
        }
        // `instantiateMappedType`: an instantiation of a homomorphic mapped type keeps the alias of the mapped type.
        if let Some((mapped_in, mapped, _)) = self.mapped_origin(ty) {
            let param = self.type_param(mapped_in, self.mapped_decl(mapped_in, mapped).param);
            if let Some(constraint) = self.constraint_of_type_param(param)
                && matches!(self.data(constraint), TypeData::Keyof(_))
            {
                return false;
            }
        }
        // `isLocalTypeAlias`: an alias declared in a function does not host a reference to a top-level alias.
        let bound = self.bound(file);
        let mut around = bound.alias_scope[alias.idx()];
        while around.is_some() {
            let scope = &bound.scopes[around.idx()];
            if matches!(scope.kind, ScopeKind::Fn(_)) {
                return false;
            }
            around = scope.parent;
        }
        true
    }

    /// The declaration of `sym`, if it is a type alias with type parameters and no class or interface as well.
    fn generic_alias_declaration(&self, sym: Sym) -> Option<(FileId, AliasId)> {
        use crate::bind::Decl;
        let flags = self.files().flags(sym);
        if !flags.contains(SymFlags::TYPE_ALIAS)
            || flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            return None;
        }
        self.files()
            .decls(sym)
            .into_iter()
            .find_map(|(file, decl)| match decl {
                Decl::Alias(alias) if !self.hir(file)[alias].type_params.is_empty() => {
                    Some((file, alias))
                }
                _ => None,
            })
    }

    /// How `typeToString` names the union or intersection `ty` that is written at `node` as `A<..>`, where the body of the generic
    /// type alias `A` is a union or an intersection: `getTypeAliasInstantiation` gives it `A<..>` for `Type.alias`. `None`: it is
    /// not written so, or the printer has a name for it.
    pub(super) fn alias_name_as_written(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        ty: TypeId,
    ) -> Option<String> {
        let forced = self.force(ty);
        if !matches!(
            self.data(forced),
            TypeData::Union(_) | TypeData::Intersection(_)
        ) || self.reduced(forced) != forced
            || self.alias_for_display(forced).is_some()
        {
            return None;
        }
        let (sym, arguments) = self.deferrable_alias_reference(file, node)?;
        if arguments.is_empty() {
            return None;
        }
        let (of, alias) = self.generic_alias_declaration(sym)?;
        let body = self.hir(of)[alias].ty;
        if body.is_none()
            || !matches!(
                self.hir(of)[body].kind,
                TypeNodeKind::Union(_) | TypeNodeKind::Intersection(_)
            )
        {
            return None;
        }
        // Narrowed, it is no longer what is written.
        let written = self.type_from_node(file, node);
        if self.force(written) != forced {
            return None;
        }
        let hir = self.hir(file);
        let nodes: Vec<TypeNodeId> = hir.ids(arguments).collect();
        let given = self.types_from_nodes(file, arguments);
        let params = self.local_type_params_of_symbol(sym);
        let mut names = Vec::with_capacity(params.len());
        for (i, argument) in self.fill_type_args(&params, &given).into_iter().enumerate() {
            // `getAliasSymbolForTypeNode`: a union or an intersection that is written out there has no alias.
            let is_written_out = nodes.get(i).is_some_and(|&n| {
                matches!(
                    hir[n].kind,
                    TypeNodeKind::Union(_) | TypeNodeKind::Intersection(_)
                )
            });
            names.push(if is_written_out {
                self.type_to_string_written_out(argument)
            } else {
                self.type_to_string(argument)
            });
        }
        Some(format!(
            "{}<{}>",
            self.symbol_to_string(sym),
            names.join(", ")
        ))
    }

    /// Where the type of the variable or parameter that `e` names is written.
    fn annotation_of_reference(&self, file: FileId, e: ExprId) -> Option<(FileId, TypeNodeId)> {
        use crate::bind::{Decl, PatParent};
        let ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return None;
        };
        let sym = self.symbol_of_identifier(file, e, name)?;
        let files = self.files();
        let (of, pat) = files.parts(sym).iter().find_map(|&part| {
            files
                .symbol(part)
                .decls
                .iter()
                .find_map(|&decl| match decl {
                    Decl::Var(pat) | Decl::Param(pat) => Some((part.file, pat)),
                    _ => None,
                })
        })?;
        let ty = match self.bound(of).pat_parent[pat.idx()] {
            PatParent::Var(d) => self.hir(of)[d].ty,
            PatParent::Param(p) => self.hir(of)[p].ty,
            _ => return None,
        };
        ty.is_some().then_some((of, ty))
    }

    /// Whether `ty` goes by the name of an alias where it is written, at `written`, and is compared under another.
    fn is_named_otherwise(&mut self, written: Option<(FileId, TypeNodeId)>, ty: TypeId) -> bool {
        let Some((file, node)) = written else {
            return false;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
            return false;
        };
        let scope = bound.type_scope[node.idx()];
        if scope.is_none() {
            return false;
        }
        // Narrowed, or with `undefined` added for being optional, it is no longer what is written.
        let there = self.type_from_node(file, node);
        if self.force(there) != self.force(ty) {
            return false;
        }
        let names: Vec<Atom> = hir.ids(name).collect();
        let sym = self
            .files()
            .resolve_entity(file, scope, &names, SymFlags::TYPE)
            .and_then(|s| self.files().resolve_alias_if_needed(s));
        sym.is_some_and(|sym| self.is_alias_of_reference(sym, ty))
    }

    /// Whether the type alias `sym`, which stands for `ty`, gives its name to a type that is compared under another
    /// (`getNormalizedType`): all it says is a reference with type arguments to a class or an interface, an array or a tuple
    /// (`isDeferredTypeReferenceNode`), or a union, of which it is the members that are compared.
    fn is_alias_of_reference(&mut self, mut sym: Sym, ty: TypeId) -> bool {
        use crate::bind::Decl;
        // An alias for such an alias is one too.
        for _ in 0..16 {
            let found = self
                .files()
                .decls(sym)
                .into_iter()
                .find_map(|(file, decl)| match decl {
                    Decl::Alias(alias) => Some((file, alias)),
                    _ => None,
                });
            let Some((file, alias)) = found else {
                return false;
            };
            let (hir, bound) = (self.hir(file), self.bound(file));
            // `getAliasSymbolForTypeNode` looks through `readonly`.
            let mut body = hir[alias].ty;
            loop {
                if body.is_none() {
                    return false;
                }
                match hir[body].kind {
                    TypeNodeKind::Readonly(inner) => body = inner,
                    _ => break,
                }
            }
            match hir[body].kind {
                TypeNodeKind::Array(_) => return true,
                // `[]` is one type whoever writes it, and what is spread into a tuple decides what becomes of the tuple.
                TypeNodeKind::Tuple(elems) => {
                    return !elems.is_empty()
                        && !elems.iter().any(|e| {
                            hir[e].rest && array_element_type_node(hir, hir[e].ty).is_none()
                        });
                }
                // `getIndexedAccessTypeOrUndefined` makes the union of what the keys give with the alias.
                TypeNodeKind::Union(_) | TypeNodeKind::IndexedAccess { .. } => {
                    return self.is_union(ty);
                }
                TypeNodeKind::Ref { name, .. } => {
                    let names: Vec<Atom> = hir.ids(name).collect();
                    let next = self
                        .files()
                        .resolve_entity(file, bound.type_scope[body.idx()], &names, SymFlags::TYPE)
                        .and_then(|s| self.files().resolve_alias_if_needed(s));
                    let Some(next) = next else { return false };
                    if self
                        .files()
                        .flags(next)
                        .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                    {
                        return !self.type_params_of_symbol(next).is_empty();
                    }
                    sym = next;
                }
                _ => return false,
            }
        }
        false
    }

    /// `getJsxPropsTypeFromClassType`: whether `target`, which the attributes `source` are held against, is what the alias
    /// `JSX.IntrinsicClassAttributes` stands for.
    fn is_aliased_jsx_class_attributes(&mut self, source: TypeId, target: TypeId) -> bool {
        let TypeData::Ref { target: wanted, .. } = *self.data(target) else {
            return false;
        };
        if !matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes)
        {
            return false;
        }
        let Some(file) = self.checking else {
            return false;
        };
        let Some(ns) = self.jsx_namespace(file) else {
            return false;
        };
        let member = self
            .files()
            .namespace_member(ns, known::IntrinsicClassAttributes)
            .and_then(|m| self.files().resolve_alias_if_needed(m));
        let Some(member) = member else { return false };
        if !self.is_alias_of_reference(member, target) {
            return false;
        }
        let declared = self.declared_type(member);
        matches!(*self.data(declared), TypeData::Ref { target: aliased, .. } if aliased == wanted)
    }

    // ───────────────────────────── further in ─────────────────────────────

    /// `elaborateError`: takes the complaint that `e`, of type `source`, does not fit `target` to the part of `e` that is to blame.
    pub(super) fn elaborate(
        &mut self,
        file: FileId,
        e: ExprId,
        source: TypeId,
        target: TypeId,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        self.elaborate_from(file, e, false, source, target, head, out)
    }

    /// `is_effective`: `e` is what `getEffectiveCheckNode` leaves, so the parentheses around it are no part of it.
    #[allow(clippy::too_many_arguments)]
    fn elaborate_from(
        &mut self,
        file: FileId,
        e: ExprId,
        is_effective: bool,
        source: TypeId,
        target: TypeId,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let hir = self.hir(file);
        // `isOrHasGenericConditional`
        let is_conditional = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Cond { .. });
        if is_conditional(self, target)
            || matches!(self.data(target), TypeData::Intersection(parts) if parts.iter().any(|&p| is_conditional(self, p)))
        {
            return false;
        }
        // `elaborateDidYouMeanToCallOrConstruct`: calling it would have done.
        for construct in [true, false] {
            for sig in self.signatures(source, construct) {
                let returned = self.sig_return(sig);
                if !self.is_any(returned)
                    && !returned.is_never()
                    && self.is_known(returned)
                    && self.is_assignable(returned, target)
                {
                    let (at, end) = if is_effective {
                        (
                            self.start_inside_parentheses(file, e),
                            self.error_end_inside_parentheses(file, e),
                        )
                    } else {
                        (self.start_of(file, e), self.error_end_of(file, e))
                    };
                    let said = out.len();
                    self.report_not_assignable_with_end(source, target, at, end, head, out);
                    if let Some(&d) = out.get(said) {
                        self.relate(d.start, d.code, |_| {
                            vec![super::explain::Related {
                                at: Some((file, at, end)),
                                code: if construct { 6213 } else { 6212 },
                                args: Vec::new(),
                            }]
                        });
                    }
                    return true;
                }
            }
        }
        match hir[e].kind {
            // `x as const`. `<const>x` is not gone into.
            ExprKind::AsConst(inner) => {
                let before = hir
                    .text
                    .get(..self.start_of(file, inner) as usize)
                    .unwrap_or_default()
                    .trim_ascii_end();
                let is_prefix = before
                    .strip_suffix(b">")
                    .is_some_and(|b| b.trim_ascii_end().ends_with(b"const"));
                !is_prefix && self.elaborate(file, inner, source, target, head, out)
            }
            ExprKind::Assign {
                op: None, value, ..
            } => self.elaborate(file, value, source, target, head, out),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.elaborate(file, right, source, target, head, out),
            ExprKind::Object(props) => self.elaborate_object(file, props, source, target, out),
            ExprKind::Array(items) => self.elaborate_array(file, items, source, target, out),
            ExprKind::Fn(func) if hir[func].kind == FnKind::Arrow => {
                self.elaborate_arrow(file, func, source, target, out)
            }
            _ => false,
        }
    }

    fn is_primitive_or_never(&self, ty: TypeId) -> bool {
        ty.is_never() || self.is_primitive(ty)
    }

    /// `elaborateObjectLiteral`
    fn elaborate_object(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        source: TypeId,
        target: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        if self.is_primitive_or_never(target) {
            return false;
        }
        let hir = self.hir(file);
        let mut reported = false;
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                continue;
            }
            let Some(name) = self.member_name(file, prop.key) else {
                continue;
            };
            let (next, head) = match prop.kind {
                PropKind::Init => (
                    prop.value,
                    if matches!(prop.key, PropKey::Computed(_)) {
                        2418
                    } else {
                        2322
                    },
                ),
                _ => (ExprId::NONE, 2322),
            };
            let end = self.end_of_prop_name(file, p);
            reported |= self.elaborate_element_with_end(
                file, source, target, prop.pos, end, next, name, head, out,
            );
        }
        reported
    }

    /// `elaborateArrayLiteral`
    fn elaborate_array(
        &mut self,
        file: FileId,
        items: IdList<ExprId>,
        source: TypeId,
        target: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        if self.is_primitive_or_never(target) {
            return false;
        }
        let hir = self.hir(file);
        // It is looked at as the tuple of what is written in it.
        let source = if self.is_tuple(source) {
            source
        } else {
            match self.forced_tuple(file, items, false) {
                Some(tuple) if self.is_tuple(tuple) => tuple,
                // `[...xs]` is a list however it is looked at.
                _ => return false,
            }
        };
        // What is laid out like a tuple says nothing of the places it has no property for. Not asked of a union, where the index
        // signature of one member stands in for the property of another (`createUnionOrIntersectionProperty`).
        let (is_laid_out, apparent) = (
            !self.is_union(target) && self.is_tuple_like(target),
            self.apparent_type(target),
        );
        let mut reported = false;
        for (i, item) in hir.ids(items).enumerate() {
            let name = self.number_name(i as f64);
            if matches!(hir[item].kind, ExprKind::Missing)
                || is_laid_out && self.prop_of(apparent, name).is_none()
            {
                continue;
            }
            let mut check_node = item;
            while let ExprKind::Satisfies { expr, .. } = hir[check_node].kind {
                check_node = expr;
            }
            let at = self.start_inside_parentheses(file, check_node);
            let end = self.error_end_inside_parentheses(file, check_node);
            reported |= self.elaborate_element_from(
                file, source, target, at, end, check_node, true, name, 2322, out,
            );
        }
        reported
    }

    /// `checkArrayLiteral` with `CheckModeForceTuple`: the literal as the tuple of what is written in it. `None`: it cannot be told.
    /// `is_spread`: it is spread into another literal, so nothing is expected of what is in it.
    fn forced_tuple(
        &mut self,
        file: FileId,
        items: IdList<ExprId>,
        is_spread: bool,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let (mut elems, mut flags) = (
            Vec::with_capacity(items.len()),
            Vec::with_capacity(items.len()),
        );
        for item in hir.ids(items) {
            match hir[item].kind {
                ExprKind::Spread(inner) => {
                    // What is spread is looked at in the same way.
                    let spread = match hir[inner].kind {
                        ExprKind::Array(inner_items) => {
                            self.forced_tuple(file, inner_items, true)?
                        }
                        _ => self.type_of_expr(file, inner),
                    };
                    if !self.is_known(spread) || self.is_uncertain(file, inner) {
                        return None;
                    }
                    if self.is_array_like(spread) {
                        elems.push(spread);
                        flags.push(ElemFlags::VARIADIC);
                    } else {
                        // `checkIteratedTypeOrElementType`
                        let element = self.iterated_type(spread, false);
                        if !self.is_known(element) {
                            return None;
                        }
                        elems.push(element);
                        flags.push(ElemFlags::REST);
                    }
                }
                // The mode goes down with the elements.
                ExprKind::Array(inner_items) if !self.in_const_context(file, item) => {
                    elems.push(self.forced_tuple(file, inner_items, is_spread)?);
                    flags.push(ElemFlags::REQUIRED);
                }
                _ => {
                    // `checkExpressionForMutableLocation`: a literal stays one only where one is expected.
                    let ty = self.type_of_expr(file, item);
                    elems.push(if is_spread {
                        self.widen_literal_for_context(ty, None)
                    } else if self.in_const_context(file, item) {
                        self.regular(ty)
                    } else if matches!(hir[item].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                        ty
                    } else {
                        let expected = self.contextual_type(file, item);
                        self.widen_literal_for_context(ty, expected)
                    });
                    flags.push(ElemFlags::REQUIRED);
                }
            }
        }
        Some(self.normalized_tuple(&elems, &flags, false))
    }

    /// `getIndexedAccessTypeOrUndefined` with `AccessFlagsNone`, by the name of a property or an element
    /// (`getLiteralTypeFromProperty`).
    fn indexed_access_by_name(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        // From the name of a symbol there is no way back to the symbol.
        if self.files().atoms.is_symbol_name(name) {
            return self.type_of_property(ty, name);
        }
        // `isNumericLiteralName`: what a number is spelled as.
        let key = match self.files().atoms.text(name).parse::<f64>() {
            Ok(n) if self.number_name(n) == name => self.number_literal(n, false),
            _ => self.string_literal(name, false),
        };
        self.indexed_access_if_any(ty, key, false)
    }

    /// `elaborateElement`: the property or the element is written from `at` to `end`, `next` is its value if it has one to go into.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn elaborate_element_with_end(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        next: ExprId,
        name: Atom,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        self.elaborate_element_from(file, source, target, at, end, next, false, name, head, out)
    }

    /// `is_effective`: `next` is what `getEffectiveCheckNode` leaves, so the parentheses around it are no part of it.
    #[allow(clippy::too_many_arguments)]
    fn elaborate_element_from(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        next: ExprId,
        is_effective: bool,
        name: Atom,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        // What a property of something generic is has to wait: nothing to go into.
        if self.is_generic_object_type(target) {
            return false;
        }
        // `getBestMatchIndexedAccessTypeOrUndefined`
        let wanted = match self.indexed_access_by_name(target, name) {
            Some(wanted) => wanted,
            None if self.is_union(target) => {
                let Some(best) = self.best_matching_type(source, target) else {
                    return false;
                };
                let Some(wanted) = self.indexed_access_by_name(best, name) else {
                    return false;
                };
                wanted
            }
            None => return false,
        };
        if matches!(self.data(wanted), TypeData::IndexedAccess { .. }) {
            return false;
        }
        let Some(given) = self.indexed_access_by_name(source, name) else {
            return false;
        };
        if !self.is_known(wanted) || !self.is_known(given) || self.is_assignable(given, wanted) {
            return false;
        }
        if next.is_some() && self.elaborate_from(file, next, is_effective, given, wanted, 2322, out)
        {
            return true;
        }
        // `checkExpressionForMutableLocationWithContextualType`: what is written there, as it is where `given` is expected.
        let given = if next.is_some() {
            let written = match self.hir(file)[next].kind {
                // `checkSpreadExpression`
                ExprKind::Spread(inner) => {
                    let spread = self.type_of_expr(file, inner);
                    self.iterated_type(spread, false)
                }
                _ => self.type_of_expr(file, next),
            };
            let specific = if self.in_const_context(file, next) {
                self.regular(written)
            } else if matches!(
                self.hir(file)[next].kind,
                ExprKind::As { .. } | ExprKind::AsConst(_)
            ) {
                written
            } else {
                self.widen_literal_for_context(written, Some(given))
            };
            if !self.is_known(specific)
                || self.is_uncertain(file, next)
                || self.is_assignable(specific, wanted)
            {
                given
            } else {
                specific
            }
        } else {
            given
        };
        let apparent = self.apparent_type(target);
        let target_is_optional = self
            .prop_of(apparent, name)
            .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL));
        if target_is_optional && self.is_exact_optional_property_mismatch(given, target, name) {
            out.push(Diagnostic {
                start: at,
                code: 2412,
            });
            self.explain_to(at, end, 2412, |c| {
                vec![c.type_to_string(given), c.type_to_string(wanted)]
            });
            let said = Diagnostic {
                start: at,
                code: 2412,
            };
            self.relate_expected_property(Some(said), target, name);
            return true;
        }
        // What may be left out is not held to be `undefined`.
        let wanted = if target_is_optional && self.p.files.options.exact_optional_property_types {
            self.without_undefined(wanted)
        } else {
            wanted
        };
        let said = out.len();
        self.report_not_assignable_with_end(given, wanted, at, end, head, out);
        self.relate_expected_property(out.get(said).copied(), target, name);
        true
    }

    /// `isExactOptionalPropertyMismatch`, under exactOptionalPropertyTypes: `given` may be `undefined`, and the property `name` of
    /// `target`, which may be left out, is not written to take that (`containsMissingType`).
    fn is_exact_optional_property_mismatch(
        &mut self,
        given: TypeId,
        target: TypeId,
        name: Atom,
    ) -> bool {
        self.p.files.options.exact_optional_property_types
            && self.some_type(given, |_, m| m.is_undefined())
            && super::errors_x_operators::exact_optional_write_type(self, target, name)
                .is_some_and(|written| !self.some_type(written, |_, m| m.is_undefined()))
    }

    /// `getExactOptionalUnassignableProperties`, whether there are any.
    pub(super) fn has_exact_optional_unassignable_properties(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if !self.p.files.options.exact_optional_property_types
            || self.is_tuple(source) && self.is_tuple(target)
        {
            return false;
        }
        let Some(wanted) = self.members(target) else {
            return false;
        };
        for prop in &wanted.shape().props {
            if prop.flags.contains(PropFlags::OPTIONAL)
                && let Some(given) = self.type_of_property(source, prop.name)
                && self.is_exact_optional_property_mismatch(given, target, prop.name)
            {
                return true;
            }
        }
        false
    }

    /// `getBestMatchingType`: the member of the union `target` that `source` is most likely meant for.
    pub(super) fn best_matching_type(&mut self, source: TypeId, target: TypeId) -> Option<TypeId> {
        if let Some(found) = self.matching_discriminant_type(source, target) {
            return Some(found);
        }
        // In the order `CompareTypes` keeps them in: which comes first, or last, decides.
        let parts = self.parts(target);
        // `findMatchingTypeReferenceOrTypeAliasReference`
        if let TypeData::Ref { target: declared, .. } = *self.data(source)
            && let Some(&same) = parts.iter().find(|&&t| matches!(*self.data(t), TypeData::Ref { target: other, .. } if other == declared))
        {
            return Some(same);
        }
        // Tuples that are laid out alike are references to one type.
        if let TypeData::Tuple { flags, readonly, .. } = self.data(source)
            && let Some(&same) = parts.iter().find(|&&t| matches!(self.data(t), TypeData::Tuple { flags: f, readonly: r, .. } if f == flags && r == readonly))
        {
            return Some(same);
        }
        // `findBestTypeForObjectLiteral`
        if self.is_object_literal_type(source)
            && parts.iter().any(|&t| self.is_array_like(t))
            && let Some(other) = parts.iter().copied().find(|&t| !self.is_array_like(t))
        {
            return Some(other);
        }
        // `findBestTypeForInvokable`
        for construct in [false, true] {
            if !self.signatures(source, construct).is_empty()
                && let Some(callable) = parts
                    .iter()
                    .copied()
                    .find(|&t| !self.signatures(t, construct).is_empty())
            {
                return Some(callable);
            }
        }
        // `findMostOverlappyType`. `keyof T` is a primitive that waits (`TypeFlagsInstantiablePrimitive`).
        let is_primitive =
            |c: &Self, t: TypeId| c.is_primitive(t) || matches!(c.data(t), TypeData::Keyof(_));
        if is_primitive(self, source) {
            return None;
        }
        let source_keys = self.keyof(source);
        let (mut best, mut matching) = (None, 0);
        for &t in parts {
            if is_primitive(self, t) {
                continue;
            }
            let target_keys = self.keyof(t);
            let overlap = self.intersection(&[source_keys, target_keys]);
            // The very same keys.
            if matches!(self.data(overlap), TypeData::Keyof(_)) {
                return Some(t);
            }
            let length = if self.is_union(overlap) {
                self.parts(overlap)
                    .iter()
                    .filter(|&&m| self.is_unit(m))
                    .count()
            } else if self.is_unit(overlap) {
                1
            } else {
                continue;
            };
            // Of equals the last.
            if length >= matching {
                best = Some(t);
                matching = length;
            }
        }
        best
    }

    fn elaborate_arrow(
        &mut self,
        file: FileId,
        func: FnId,
        source: TypeId,
        target: TypeId,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let hir = self.hir(file);
        let FnBody::Expr(body) = hir[func].body else {
            return false;
        };
        if hir[func].params.iter().any(|p| hir[p].ty.is_some()) {
            return false;
        }
        let Some(sig) = self.single_call_signature(source, false) else {
            return false;
        };
        let wanted = self.signatures(target, false);
        if wanted.is_empty() {
            return false;
        }
        let given = self.sig_return(sig);
        let mut all = TypeId::NEVER;
        for w in wanted {
            let returned = self.sig_return(w);
            all = self.union(&[all, returned]);
        }
        if !self.is_known(given) || !self.is_known(all) || self.is_assignable(given, all) {
            return false;
        }
        if !self.elaborate(file, body, given, all, 2322, out) {
            let (at, end) = (self.start_of(file, body), self.error_end_of(file, body));
            let said = out.len();
            self.report_not_assignable_with_end(given, all, at, end, 2322, out);
            if let Some(&said) = out.get(said) {
                self.relate(said.start, said.code, |c| {
                    c.where_expected_return_type_comes_from(file, func, given, target, all)
                });
            }
        }
        true
    }

    /// The end of `elaborateArrowFunction`. `given`: what the arrow function `func` returns. `wanted`: what the signatures of
    /// `target` return.
    fn where_expected_return_type_comes_from(
        &mut self,
        file: FileId,
        func: FnId,
        given: TypeId,
        target: TypeId,
        wanted: TypeId,
    ) -> Vec<super::explain::Related> {
        let mut related = Vec::new();
        if let Some(signature) = self.first_declaration_of_type_symbol(target) {
            related.push(super::explain::Related {
                at: Some(signature),
                code: 6502,
                args: Vec::new(),
            });
        }
        if !self.hir(file)[func].flags.contains(Flags::ASYNC)
            && self.type_of_property(given, known::then).is_none()
        {
            // What is compared here says nothing about the comparison that is being reported.
            let (gave_up, too_complex) = (self.relation_gave_up, self.relation_too_complex);
            // `createPromiseType`
            let unwrapped = self.map_type(given, |c, m| c.awaited_argument(m).unwrap_or(m));
            let awaited = self.awaited_no_alias(unwrapped).unwrap_or(TypeId::UNKNOWN);
            let promise = self.promise_of(awaited);
            let is_meant_to_be_async = self.is_assignable(promise, wanted);
            self.relation_gave_up = gave_up;
            self.relation_too_complex = too_complex;
            if is_meant_to_be_async {
                let (start, end) = self.error_range_of_fn(file, func);
                related.push(super::explain::Related {
                    at: Some((file, start, end)),
                    code: 1356,
                    args: Vec::new(),
                });
            }
        }
        related
    }

    // ───────────────────────────── what is said ─────────────────────────────

    /// `source` does not fit `target`: says why, in as far as the reason lies at the surface.
    pub(super) fn report_not_assignable(
        &mut self,
        source: TypeId,
        target: TypeId,
        at: u32,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        self.report_not_assignable_as(source, target, at, 0, head, (false, false), out);
    }

    /// The same. `end`: where the node that starts at `at` ends.
    pub(super) fn report_not_assignable_with_end(
        &mut self,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        self.report_not_assignable_as(source, target, at, end, head, (false, false), out);
    }

    /// `named_otherwise`: whether `source`, and whether `target`, is written as an alias that is not the name it is compared under.
    #[allow(clippy::too_many_arguments)]
    fn report_not_assignable_as(
        &mut self,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        head: u32,
        named_otherwise: (bool, bool),
        out: &mut Vec<Diagnostic>,
    ) {
        // `isRelatedToEx`: all that is said is said of `getNormalizedType` of the two. A substitution type has no alias to go by.
        let source = match *self.data(source) {
            TypeData::Substitution { base, constraint } => {
                self.substitution_intersection(base, constraint)
            }
            _ => source,
        };
        let target = match *self.data(target) {
            TypeData::Substitution { base, .. } => base,
            _ => target,
        };
        let error = RelationError {
            source,
            target,
            // 2678 is what `reportRelationError` says without a head message under the comparable relation.
            relation: if head == 2678 {
                Relation::Comparable
            } else {
                Relation::Assignable
            },
            head,
            named_otherwise,
        };
        self.trace_pair(head, at, source, target);
        if std::env::var_os("BUN_SEMA_EXPLAIN").is_some() {
            let why = self.explain_not_assignable(source, target);
            let path = self
                .checking
                .map_or("", |f| self.files().module(f).path.as_str());
            eprintln!("WHY {head} at {at} {why} IN {path}");
            if std::env::var("BUN_SEMA_RETRACE").is_ok_and(|p| p == at.to_string()) {
                self.retracing = true;
                let again = self.is_assignable(source, target);
                self.retracing = false;
                eprintln!("RETRACED at {at}: {again}");
            }
        }
        // Too much.
        if matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes)
        {
            // Of attributes it is worded otherwise, and `head` goes on top. The complaint moves to an attribute and to nothing else.
            if let Some(excess) = self.excess_property(source, target, Relation::Assignable) {
                let (start, end) = match excess {
                    Excess::Unknown(
                        Prop {
                            source: PropSource::Literal(file, p),
                            ..
                        },
                        _,
                    ) => (self.hir(file)[p].pos, self.end_of_jsx_attr_name(file, p)),
                    _ => (at, end),
                };
                out.push(Diagnostic { start, code: head });
                self.explain_relation_error(start, end, head, target, error);
                return;
            }
        } else if let Some(excess) =
            self.excess_within(source, target, Relation::Assignable, at, end, head, 0)
        {
            out.push(excess);
            self.explain_head_over_excess(excess, at, end, error);
            return;
        }
        let (code, said_of) = self.head_of_relation_error(
            source,
            target,
            head,
            named_otherwise.0 || named_otherwise.1,
        );
        out.push(Diagnostic { start: at, code });
        self.explain_relation_error(at, end, code, said_of, error);
    }

    /// What `excess_within` found is noted where it is found, unless `error.head` ended up on top of it.
    /// `at`, `end`: the node the complaint was on to begin with.
    fn explain_head_over_excess(
        &mut self,
        excess: Diagnostic,
        at: u32,
        end: u32,
        error: RelationError,
    ) {
        if excess.code != error.head {
            return;
        }
        let end = if excess.start == at {
            end
        } else {
            self.checking
                .map_or(0, |file| self.end_of_name_at(file, excess.start))
        };
        self.explain_relation_error(excess.start, end, excess.code, error.target, error);
    }

    /// Notes the message of the relation error reported from `start` to `end`. `code`: what stands first in it. `said_of`: the target
    /// that is about, `error.target` or a part of it.
    fn explain_relation_error(
        &mut self,
        start: u32,
        end: u32,
        code: u32,
        said_of: TypeId,
        error: RelationError,
    ) {
        let RelationError {
            source,
            target,
            relation,
            head,
            named_otherwise,
        } = error;
        let named_otherwise = (named_otherwise.0, named_otherwise.1 && said_of == target);
        self.explain_to(start, end, code, |c| {
            // What is compared for the sake of the message says nothing about the comparison that is being reported.
            let (gave_up, too_complex) = (c.relation_gave_up, c.relation_too_complex);
            let arguments = c.relation_error_arguments(code, source, said_of, named_otherwise);
            c.relation_gave_up = gave_up;
            c.relation_too_complex = too_complex;
            arguments
        });
        if !self.explains {
            return;
        }
        let (mut lines, related) =
            self.relation_lines_with_related(source, target, relation, Some(head), 0);
        // Nothing is said under these.
        if !matches!(code, 2741 | 2739 | 2740 | 4104 | 2559 | 2560) {
            let starts_with_head = lines.first().is_some_and(|first| {
                first.code == code
                    || first.code == head
                    || matches!(first.code, 2719 | 2375 | 2379 | 2820)
            });
            if starts_with_head {
                lines.remove(0);
            } else {
                for line in &mut lines {
                    line.level += 1;
                }
            }
            self.explain_chain(start, code, |_| lines);
        }
        self.relate(start, code, |_| related);
    }

    /// The arguments of the message `code` that stands first in the error for `source` not being related to `target`.
    fn relation_error_arguments(
        &mut self,
        code: u32,
        source: TypeId,
        target: TypeId,
        named_otherwise: (bool, bool),
    ) -> Vec<String> {
        let compared = self.compared_in_place_of(source, target);
        // `reportErrorResults`: what has an alias, or is compared as its only base, is named as it is given.
        let is_named_as_given = |c: &mut Self, ty: TypeId, is_named_otherwise: bool| {
            is_named_otherwise
                || c.alias_for_display(ty).is_some()
                || c.has_single_base_for_non_augmenting_subtype(ty)
        };
        let source = if is_named_as_given(self, source, named_otherwise.0) {
            source
        } else {
            compared.0
        };
        let target = if is_named_as_given(self, target, named_otherwise.1) {
            target
        } else {
            compared.1
        };
        match code {
            // `isRelatedToEx`, `tryElaborateArrayLikeErrors`
            2559 | 2560 | 4104 => vec![self.type_to_string(source), self.type_to_string(target)],
            // `reportUnmatchedProperty`
            2741 | 2739 | 2740 => {
                let (source_name, target_name) = self.type_names_for_error_display(source, target);
                let missing = self.unmatched_properties(compared.0, compared.1);
                let listed = if code == 2740 { 4 } else { missing.len() };
                let names: Vec<String> = missing
                    .iter()
                    .take(listed)
                    .map(|prop| self.prop_to_string(prop))
                    .collect();
                let names = names.join(", ");
                match code {
                    2741 => vec![names, source_name, target_name],
                    2739 => vec![source_name, target_name, names],
                    _ => vec![
                        source_name,
                        target_name,
                        names,
                        missing.len().saturating_sub(4).to_string(),
                    ],
                }
            }
            // `reportRelationError`
            _ => {
                let (source_name, target_name) = self.relation_error_names(source, target);
                let mut arguments = vec![source_name, target_name];
                if code == 2820
                    && let Some(suggested) =
                        self.closest_string_literal_type(compared.0, compared.1)
                {
                    arguments.push(self.type_to_string(suggested));
                }
                arguments
            }
        }
    }

    /// What `isRelatedToEx` compares in place of `source` and `target`: `getNormalizedType` of each, and `X` for a target
    /// `X | null | undefined` if `source` is never `null` or `undefined`.
    fn compared_in_place_of(&mut self, source: TypeId, target: TypeId) -> (TypeId, TypeId) {
        let (source, target) = (self.force(source), self.force(target));
        let (source, target) = (self.regular(source), self.regular(target));
        // `getNormalizedType` simplifies until nothing changes.
        let simplify = |c: &mut Self, mut t: TypeId, writing: bool| loop {
            let simpler = c.simplified(t, writing);
            if simpler == t {
                break t;
            }
            t = simpler;
        };
        let (source, target) = (simplify(self, source, false), simplify(self, target, true));
        let has_primitive_flag =
            self.is_primitive(source) || source == TypeId::BOOLEAN || self.is_whole_enum(source);
        // `TypeFlagsDefinitelyNonNullable`
        if has_primitive_flag && !self.is_nullish(source)
            || self.is_object_type(source)
            || source == TypeId::OBJECT
        {
            (source, self.without_nullable_alternatives(target))
        } else {
            (source, target)
        }
    }

    /// Whether `ty` is the union of all the members of an enum.
    fn is_whole_enum(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) => match *self.data(parts[0]) {
                TypeData::EnumLit { member, .. } | TypeData::Enum { symbol: member, .. } => {
                    self.enum_type_of_member(member) == ty
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// How `reportRelationError` names the two: `generalizedSourceType` and `targetType`.
    fn relation_error_names(&mut self, source: TypeId, target: TypeId) -> (String, String) {
        let (source_name, target_name) = self.type_names_for_error_display(source, target);
        // `isLiteralType`
        if !target.is_never()
            && self.every_type(source, |c, member| c.is_unit(member))
            && !self.could_have_top_level_singleton_types(target, 0)
        {
            let generalized = self.base_of_literal(source);
            return (
                self.type_to_string_fully_qualified(generalized),
                target_name,
            );
        }
        (source_name, target_name)
    }

    /// `typeCouldHaveTopLevelSingletonTypes`
    fn could_have_top_level_singleton_types(&mut self, ty: TypeId, depth: u32) -> bool {
        let ty = self.force(ty);
        if ty == TypeId::BOOLEAN || depth > 32 {
            return false;
        }
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(ty) {
            return parts
                .iter()
                .any(|&part| self.could_have_top_level_singleton_types(part, depth + 1));
        }
        let is_pattern = matches!(
            self.data(ty),
            TypeData::Template { .. } | TypeData::StringMapping { .. }
        );
        // `TypeFlagsInstantiable`
        if (is_pattern || self.is_deferred(ty))
            && let Some(constraint) = self.constraint_of(ty)
            && constraint != ty
        {
            return self.could_have_top_level_singleton_types(constraint, depth + 1);
        }
        is_pattern || self.is_unit(ty)
    }

    /// `getUnmatchedProperties`: the properties `target` requires that `source` does not have.
    fn unmatched_properties(&mut self, source: TypeId, target: TypeId) -> Vec<Prop> {
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return Vec::new();
        };
        let mut missing = Vec::new();
        for tp in &tm.shape().props {
            if !self.is_static_private_name(tp)
                && !tp.flags.contains(PropFlags::OPTIONAL)
                && self.property_of_type(&sm, tp.name).is_none()
            {
                missing.push(tp.clone());
            }
        }
        missing
    }

    /// `getSuggestedTypeForNonexistentStringLiteralType`
    fn closest_string_literal_type(&self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let TypeData::StringLit { value, .. } = *self.data(source) else {
            return None;
        };
        let text = self.files().atoms.bytes(value);
        // In the order `CompareTypes` keeps them in: of those that are as close, the first.
        self.parts(target)
            .iter()
            .copied()
            .filter_map(|part| match *self.data(part) {
                TypeData::StringLit { value: other, .. } => {
                    let other = self.files().atoms.bytes(other);
                    is_close(text, other).then(|| (part, edit_distance(text, other)))
                }
                _ => None,
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|closest| closest.0)
    }

    /// Where `isRelatedToEx`, reporting, comes upon a property that is too much in an object literal (`hasExcessProperties`), if that
    /// is what `source` not being related to `target` comes down to. From there on the complaint is at the name of the property
    /// (`r.errorNode`). It is 2353 or 2561 as long as only `reportRelationError` and `Types_of_property_0_are_incompatible` would go
    /// on top, which then are not said. Once anything else is, `head` ends up on top.
    /// `at`, `end`: the node the complaint is on to begin with.
    #[allow(clippy::too_many_arguments)]
    fn excess_within(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        at: u32,
        end: u32,
        head: u32,
        depth: u32,
    ) -> Option<Diagnostic> {
        if depth > 32 || !self.is_known(source) || !self.is_known(target) {
            return None;
        }
        let (source, mut target) = (self.force(source), self.force(target));
        if self.is_object_type(source) {
            target = self.without_nullable_alternatives(target);
        }
        if self.is_object_literal_type(source) {
            match self.excess_property(source, target, relation) {
                Some(Excess::Unknown(prop, in_type)) => {
                    return Some(self.excess_property_error(&prop, in_type, at, end));
                }
                // No more is looked at than what the property holds.
                Some(Excess::Mismatch(given, wanted)) => {
                    let further_in =
                        self.excess_within(given, wanted, relation, at, end, head, depth + 1);
                    return Some(further_in.unwrap_or(Diagnostic {
                        start: at,
                        code: head,
                    }));
                }
                None => {}
            }
        }
        // `someTypeRelatedToType` reports on the last of the alternatives, `eachTypeRelatedToType` on the first that is not related.
        if self.is_union(source) {
            let parts = self.parts(source);
            let part = if relation == Relation::Comparable {
                parts.last().copied()?
            } else {
                parts
                    .iter()
                    .copied()
                    .find(|&part| !self.related(part, target, relation))?
            };
            return self.excess_within(part, target, relation, at, end, head, depth + 1);
        }
        if !self.is_object_type(source) {
            return None;
        }
        // `typeRelatedToSomeType`: against the alternative it is most likely meant for, as a regular type.
        if self.is_union(target) {
            let best = self.best_matching_type(source, target)?;
            let regular = self.regular_type_of_object_literal(source);
            return self.excess_within(regular, best, relation, at, end, head, depth + 1);
        }
        match self.data(target) {
            // `typeRelatedToEachType`, where nothing is too much (`IntersectionStateTarget`): what is wrong there is said first.
            // `structuredTypeRelatedTo` then goes through the properties of the whole.
            TypeData::Intersection(parts) => {
                let plain = self.regular_object(source);
                if self.is_generic_object_type(target)
                    || !parts
                        .iter()
                        .all(|&part| self.related(plain, part, relation))
                {
                    return None;
                }
            }
            _ if !self.is_object_type(target) => return None,
            _ => {}
        }
        // Two arrays of a kind go by their type arguments (`typeArgumentsRelatedTo`), other lists by what is found under a number.
        // What can only be read lacks what it takes to be written to, which is what is said of it.
        if let Some(wanted) = self.array_element(target) {
            let given = match self.data(source) {
                TypeData::Tuple { elems, flags, .. } => self.tuple_element_union(elems, flags),
                _ => self.array_element(source)?,
            };
            if self.is_readonly_array_or_tuple(source) && self.is_mutable_array_or_tuple(target) {
                return None;
            }
            return self.excess_within(given, wanted, relation, at, end, head, depth + 1);
        }
        // `propertiesRelatedTo`, of a list and a tuple: up to the first element that is not related.
        if let TypeData::Tuple {
            elems: target_elems,
            flags: target_flags,
            readonly: target_readonly,
        } = self.data(target)
        {
            let one_element;
            let (source_elems, source_flags): (&[TypeId], &[ElemFlags]) = match self.data(source) {
                TypeData::Tuple { elems, flags, .. } => (elems, flags),
                _ => {
                    one_element = [self.array_element(source)?];
                    (&one_element, &[ElemFlags::REST])
                }
            };
            if !*target_readonly && self.is_readonly_array_or_tuple(source) {
                return None;
            }
            let variable = ElemFlags::REST | ElemFlags::VARIADIC;
            let target_has_rest_element = target_flags.iter().any(|f| f.intersects(variable));
            let is_required =
                |f: &&ElemFlags| f.intersects(ElemFlags::REQUIRED | ElemFlags::VARIADIC);
            let (source_arity, target_arity) = (source_elems.len(), target_elems.len());
            let source_rest = source_flags.iter().any(|f| f.contains(ElemFlags::REST));
            let source_min_length = if self.is_tuple(source) {
                source_flags.iter().filter(is_required).count()
            } else {
                0
            };
            let target_min_length = target_flags.iter().filter(is_required).count();
            // Of lengths that do not go together something else is said.
            if !source_rest && source_arity < target_min_length
                || !target_has_rest_element
                    && (target_arity < source_min_length
                        || source_rest
                        || target_arity < source_arity)
            {
                return None;
            }
            let is_rest = |f: &ElemFlags| f.contains(ElemFlags::REST);
            let target_start_count = target_flags
                .iter()
                .position(is_rest)
                .unwrap_or(target_arity);
            let target_end_count = target_flags
                .iter()
                .rev()
                .position(is_rest)
                .unwrap_or(target_arity);
            for source_position in 0..source_arity {
                let source_flag = source_flags[source_position];
                let source_position_from_end = source_arity - 1 - source_position;
                let target_position = if target_has_rest_element
                    && source_position >= target_start_count
                {
                    (target_arity - 1).checked_sub(source_position_from_end.min(target_end_count))
                } else {
                    Some(source_position)
                };
                let target_position =
                    target_position.filter(|&position| position < target_arity)?;
                let target_flag = target_flags[target_position];
                // So it is of kinds of elements that do not go together.
                if target_flag.contains(ElemFlags::VARIADIC)
                    && !source_flag.contains(ElemFlags::VARIADIC)
                    || source_flag.contains(ElemFlags::VARIADIC)
                        && !target_flag.intersects(variable)
                    || target_flag.contains(ElemFlags::REQUIRED)
                        && !source_flag.contains(ElemFlags::REQUIRED)
                {
                    return None;
                }
                let given = self.remove_missing_type(
                    source_elems[source_position],
                    (source_flag & target_flag).contains(ElemFlags::OPTIONAL),
                );
                let wanted = if source_flag.contains(ElemFlags::VARIADIC)
                    && target_flag.contains(ElemFlags::REST)
                {
                    self.array_of(target_elems[target_position])
                } else {
                    self.remove_missing_type(
                        target_elems[target_position],
                        target_flag.contains(ElemFlags::OPTIONAL),
                    )
                };
                if self.related(given, wanted, relation) {
                    continue;
                }
                let found =
                    self.excess_within(given, wanted, relation, at, end, head, depth + 1)?;
                // Where either has more than one element, which one it is is said on top.
                let names_position = target_arity > 1 || source_arity > 1;
                return Some(if names_position {
                    Diagnostic {
                        start: found.start,
                        code: head,
                    }
                } else {
                    found
                });
            }
            return None;
        }
        // `propertiesRelatedTo`: of what is missing (`getUnmatchedProperty`), and of what the type of an object literal has no room
        // for, something else is said. Otherwise up to the first property of `target` that is not related.
        let (sm, tm) = (self.members(source)?, self.members(target)?);
        for tp in &tm.shape().props {
            if !tp.flags.contains(PropFlags::OPTIONAL)
                && self.property_of_type(&sm, tp.name).is_none()
            {
                return None;
            }
        }
        if self.is_object_literal_type(target)
            && sm
                .shape()
                .props
                .iter()
                .any(|sp| tm.resolved.prop(sp.name).is_none())
        {
            return None;
        }
        for tp in &tm.shape().props {
            let Some((sp, mapper)) = self.property_of_type(&sm, tp.name) else {
                continue;
            };
            let (given, wanted) = (
                self.type_of_prop_as_read(&sp, mapper),
                self.type_of_prop_as_read(tp, tm.mapper),
            );
            if !self.related(given, wanted, relation) {
                return self.excess_within(given, wanted, relation, at, end, head, depth + 1);
            }
            // `propertyRelatedTo`: it may be left out where it may not.
            if relation != Relation::Comparable
                && sp.flags.contains(PropFlags::OPTIONAL)
                && !tp.flags.contains(PropFlags::OPTIONAL)
                && !matches!(tp.source, PropSource::Symbol(_))
            {
                return None;
            }
        }
        // `signaturesRelatedTo` comes next, and of what it finds something else is said. Against an intersection only an object
        // literal as written goes on to the index signatures (`structuredTypeRelatedTo`).
        if !tm.shape().call.is_empty()
            || !tm.shape().construct.is_empty()
            || self.is_generic_mapped_type(source)
            || self.is_intersection(target) && !self.is_object_literal_type(source)
        {
            return None;
        }
        // `indexSignaturesRelatedTo`: up to the first index signature of `target` that is not related. What is said of it goes on top.
        let target_has_string_index = tm.shape().index.iter().any(|i| i.key == TypeId::STRING);
        for info in &tm.shape().index {
            let wanted = self.instantiate(info.value, tm.mapper);
            if target_has_string_index && self.is_any(wanted) {
                continue;
            }
            // `typeRelatedToIndexInfo`
            let unfit = match self.applicable_index_info(&sm, info.key, None) {
                Some(given) => (!self.related(given, wanted, relation)).then_some(given),
                None if self.is_object_type_with_inferable_index(source) => {
                    self.first_member_unfit_for_index_signature(&sm, info.key, wanted, relation)
                }
                None => return None,
            };
            if let Some(given) = unfit {
                let found =
                    self.excess_within(given, wanted, relation, at, end, head, depth + 1)?;
                return Some(Diagnostic {
                    start: found.start,
                    code: head,
                });
            }
        }
        None
    }

    /// `membersRelatedToIndexer`: what the first of the members `sm` holds that is not related to `wanted`, which is what an index
    /// signature for `key` gives.
    fn first_member_unfit_for_index_signature(
        &mut self,
        sm: &Members,
        key: TypeId,
        wanted: TypeId,
        relation: Relation,
    ) -> Option<TypeId> {
        for prop in &sm.shape().props {
            if !self.is_name_applicable_to_index(prop.name, key) {
                continue;
            }
            let declared = self.type_of_prop_as_read(prop, sm.mapper);
            let given = if self.p.files.options.exact_optional_property_types
                || declared.is_undefined()
                || key == TypeId::NUMBER
                || !prop.flags.contains(PropFlags::OPTIONAL)
            {
                declared
            } else {
                self.without_undefined(declared)
            };
            if !self.related(given, wanted, relation) {
                return Some(given);
            }
        }
        for info in &sm.shape().index {
            // `isApplicableIndexType`
            let applies = info.key == key
                || key == TypeId::STRING && info.key != TypeId::SYMBOL
                || key == TypeId::NUMBER && self.is_numeric_string_type(info.key)
                || self.is_assignable(info.key, key);
            if applies {
                let given = self.instantiate(info.value, sm.mapper);
                if !self.related(given, wanted, relation) {
                    return Some(given);
                }
            }
        }
        None
    }

    /// 2353, or 2561 where it looks like a slip of the pen: `in_type` has no room for the property `prop` of an object literal
    /// (`hasExcessProperties`). It is said at the name of the property, or on the node from `at` to `end` if that is not written in
    /// the file at hand.
    fn excess_property_error(
        &mut self,
        prop: &Prop,
        in_type: TypeId,
        at: u32,
        end: u32,
    ) -> Diagnostic {
        let (start, end, is_identifier) = match prop.source {
            PropSource::Literal(file, p) if self.checking.is_none_or(|checked| checked == file) => {
                let (hir, written) = (self.hir(file), &self.hir(file)[p]);
                // A name written as a string or a number is not taken for a slip of the pen.
                let is_literal = matches!(
                    hir.text.get(written.pos as usize),
                    Some(b'"' | b'\'' | b'.' | b'0'..=b'9')
                );
                (
                    written.pos,
                    self.end_of_prop_name(file, p),
                    matches!(written.key, PropKey::Name(_)) && !is_literal,
                )
            }
            _ => (at, end, false),
        };
        let mut suggestions: Vec<Atom> = Vec::new();
        if is_identifier {
            // `getSuggestionForNonexistentProperty`, among the properties of `errorTarget`: of a union, those all its members have.
            let text = self.files().atoms.bytes(prop.name);
            let error_target = self.filter(in_type, |c, m| c.is_excess_property_check_target(m));
            for &part in self.parts(error_target) {
                let Some(members) = self.members(part) else {
                    break;
                };
                let close: Vec<Atom> = members
                    .shape()
                    .props
                    .iter()
                    .map(|p| p.name)
                    .filter(|&name| is_close(text, self.files().atoms.bytes(name)))
                    .collect();
                for name in close {
                    if part == error_target || self.type_of_property(error_target, name).is_some() {
                        suggestions.push(name);
                    }
                }
                // `getPropertiesOfUnionOrIntersectionType`: no further than the first member without index signatures.
                if !suggestions.is_empty() || members.shape().index.is_empty() {
                    break;
                }
            }
        }
        let code = if suggestions.is_empty() { 2353 } else { 2561 };
        self.explain_to(start, end, code, |c| {
            let error_target = c.filter(in_type, |c, m| c.is_excess_property_check_target(m));
            let mut arguments = vec![c.prop_to_string(prop), c.type_to_string(error_target)];
            // `GetSpellingSuggestion`: of those that are as close, the one declared first.
            let text = c.files().atoms.bytes(prop.name);
            let distance = |name: Atom| edit_distance(text, c.files().atoms.bytes(name));
            if let Some(&suggested) = suggestions
                .iter()
                .min_by(|&&a, &&b| distance(a).total_cmp(&distance(b)))
            {
                arguments.push(c.atom_text(suggested));
            }
            arguments
        });
        Diagnostic { start, code }
    }

    /// `isRelatedToEx`: what is never `null` or `undefined` is held against `X | null | undefined` as against `X`.
    fn without_nullable_alternatives(&mut self, target: TypeId) -> TypeId {
        let is_nullable = |t: TypeId| t.is_null() || t.is_undefined();
        match self.parts(target) {
            [a, only] if is_nullable(*a) && !is_nullable(*only) => self.force(*only),
            [a, b, only] if is_nullable(*a) && is_nullable(*b) && !is_nullable(*only) => {
                self.force(*only)
            }
            _ => target,
        }
    }

    /// A `readonly` tuple or a `ReadonlyArray`.
    fn is_readonly_array_or_tuple(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Tuple { readonly: true, .. })
            || self.is_global_ref(ty, known::ReadonlyArray).is_some()
    }

    /// What is said first of `source` not fitting `target`, where `head` would be said for lack of anything better: the part of
    /// `isRelatedToEx`, `reportErrorResults` and `reportRelationError` that decides on it.
    /// `named_otherwise`: one of the two is written as an alias that is not the name it is compared under.
    /// With it comes the target it is said of: `target`, or the part of `target` that `source` is held against where it is said.
    fn head_of_relation_error(
        &mut self,
        source: TypeId,
        target: TypeId,
        head: u32,
        named_otherwise: bool,
    ) -> (u32, TypeId) {
        let said_of = target;
        let (source, target) = (self.force(source), self.force(target));
        let (source, target) = (self.regular(source), self.regular(target));
        // `reportErrorResults`: the head names the two as they are given, what is missing is said of what they are compared as.
        let names_differ = named_otherwise
            || self.has_single_base_for_non_augmenting_subtype(source)
            || self.has_single_base_for_non_augmenting_subtype(target)
            || self.is_aliased_jsx_class_attributes(source, target);
        // `TypeFlagsPrimitive`, which `boolean` and an enum have though they are unions.
        let is_whole_enum = self.is_whole_enum(source);
        let has_primitive_flag =
            self.is_primitive(source) || source == TypeId::BOOLEAN || is_whole_enum;
        // `TypeFlagsDefinitelyNonNullable`
        let is_definitely_non_nullable = has_primitive_flag && !self.is_nullish(source)
            || self.is_object_type(source)
            || source == TypeId::OBJECT;
        let target = if is_definitely_non_nullable {
            self.without_nullable_alternatives(target)
        } else {
            target
        };
        let is_object_or_intersection = |c: &Self, t: TypeId| {
            c.is_object_type(t) || matches!(c.data(t), TypeData::Intersection(_))
        };
        // Nothing in common with a type all of whose properties are optional. That is all that is said.
        if (has_primitive_flag || is_object_or_intersection(self, source))
            && self.is_global_ref(source, known::Object).is_none()
            && is_object_or_intersection(self, target)
            && self.is_weak_type(target)
        {
            // What an enum has is what its members have.
            let holder = if is_whole_enum {
                self.parts(source)[0]
            } else {
                source
            };
            let apparent = self.apparent_type(holder);
            let has_something = self.members(apparent).is_some_and(|m| {
                let s = m.shape();
                !(s.props.is_empty() && s.call.is_empty() && s.construct.is_empty())
            });
            if has_something && !self.has_common_properties(holder, target) {
                for construct in [false, true] {
                    if let Some(&first) = self.signatures(source, construct).first() {
                        let returned = self.sig_return(first);
                        if self.is_assignable(returned, target) {
                            return (2560, said_of);
                        }
                    }
                }
                return (2559, said_of);
            }
        }
        // `reportErrorResults`: of attributes that do not fit `JSX.IntrinsicAttributes & ..` no more is said than what is wrong with
        // the first part they do not fit (`typeRelatedToEachType`).
        if let (TypeData::Synth(shape), TypeData::Intersection(parts)) =
            (self.data(source), self.data(target))
            && shape.literal == Literalness::JsxAttributes
            && let Some(file) = self.checking
            && let (Some(a), Some(b)) = (
                self.jsx_type(file, known::IntrinsicAttributes),
                self.jsx_type(file, known::IntrinsicClassAttributes),
            )
            && (parts.contains(&a) || parts.contains(&b))
        {
            // `IntersectionStateTarget`: part by part nothing is too much, and to have nothing in common is no fault.
            let plain = self.synth(Shape {
                literal: Literalness::No,
                ..(**shape).clone()
            });
            for &part in parts.iter() {
                if !self.is_assignable(plain, part)
                    && (!self.is_weak_type(part) || self.has_common_properties(plain, part))
                {
                    return self.head_of_relation_error(source, part, 2322, false);
                }
            }
        }
        // `isConversionOrInterfaceImplementationMessage`
        let gives_way = !matches!(head, 2352 | 2420 | 2720 | 2787 | 2788 | 2789);
        if (self.is_object_type(source) || self.is_intersection_of_objects(source))
            && self.is_object_type(target)
        {
            // `tryElaborateArrayLikeErrors`
            if self.is_readonly_array_or_tuple(source) && self.is_mutable_array_or_tuple(target) {
                return (4104, said_of);
            }
            // Of `Object` something else is said in between.
            if gives_way
                && !names_differ
                && self.is_global_ref(source, known::Object).is_none()
                && let Some(code) = self.why_not_assignable_at_the_surface(source, target)
            {
                return (code, said_of);
            }
        }
        if head == 2322 {
            // Two types that go by one name.
            if source != target
                && let (Some(a), Some(b)) = (
                    self.fully_qualified_name(source),
                    self.fully_qualified_name(target),
                )
                && a == b
            {
                return (2719, said_of);
            }
            if self.has_exact_optional_unassignable_properties(source, target) {
                return (2375, said_of);
            }
            // `getSuggestedTypeForNonexistentStringLiteralType`
            if let TypeData::StringLit { value, .. } = *self.data(source)
                && self.is_union(target)
            {
                let text = self.files().atoms.bytes(value);
                let is_misspelt = self.parts(target).iter().any(|&t| match *self.data(t) {
                    TypeData::StringLit { value: other, .. } => {
                        is_close(text, self.files().atoms.bytes(other))
                    }
                    _ => false,
                });
                if is_misspelt {
                    return (2820, said_of);
                }
            }
        } else if head == 2345 && self.has_exact_optional_unassignable_properties(source, target) {
            return (2379, said_of);
        }
        (head, said_of)
    }

    /// `getSingleBaseForNonAugmentingSubtype`, whether there is one: a class or an interface that extends one type and adds nothing
    /// to it. It is compared as that type.
    pub(super) fn has_single_base_for_non_augmenting_subtype(&mut self, ty: TypeId) -> bool {
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return false;
        };
        self.is_non_augmenting_declaration(target)
            && self.base_types(target).len() == 1
            && self.is_declared_as_reference(target, 0)
    }

    /// What `getSingleBaseForNonAugmentingSubtype` tells from the declarations of the class or interface `target`: the symbol has no
    /// members, and what a class extends is written as a plain name.
    pub(super) fn is_non_augmenting_declaration(&self, target: Sym) -> bool {
        use crate::bind::Decl;
        for (file, decl) in self.files().decls(target) {
            let hir = self.hir(file);
            match decl {
                Decl::Class(c) => {
                    let class = &hir[c];
                    // `getMembersOfSymbol`: type parameters, the constructor, whatever is not static.
                    if !class.type_params.is_empty()
                        || class.members.iter().any(|m| {
                            !hir[m].flags.contains(Flags::STATIC)
                                && hir[m].kind != MemberKind::StaticBlock
                        })
                    {
                        return false;
                    }
                    // Only a plain name is sure not to lead back to the class.
                    if class.extends.is_some()
                        && (!matches!(
                            hir[class.extends].kind,
                            ExprKind::Ident(_) | ExprKind::Dot { .. }
                        ) || is_parenthesized(hir, class.extends))
                    {
                        return false;
                    }
                }
                Decl::Interface(i)
                    if !hir[i].type_params.is_empty() || !hir[i].members.is_empty() =>
                {
                    return false;
                }
                _ => {}
            }
        }
        true
    }

    /// Whether `getTypeWithThisArgument` makes another type of `ty`: a reference with a `this` type to fill in, or an intersection
    /// with such a member.
    pub(super) fn takes_this_argument(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { target, .. } => self.is_declared_as_reference(*target, 0),
            TypeData::Tuple { .. } => true,
            TypeData::Intersection(parts) => {
                parts.iter().any(|&part| self.takes_this_argument(part))
            }
            _ => false,
        }
    }

    /// Whether the declared type of the class or interface `sym` is a type reference, one with a `this` type
    /// (`getDeclaredTypeOfClassOrInterface`): all are but the interfaces without type parameters, their own or from around them,
    /// that are sure not to mention `this` (`isThislessInterface`).
    fn is_declared_as_reference(&mut self, sym: Sym, depth: u32) -> bool {
        use crate::bind::{Decl, ScopeKind};
        if depth > 32 || self.files().flags(sym).contains(SymFlags::CLASS) {
            return true;
        }
        for (file, decl) in self.files().decls(sym) {
            let Decl::Interface(i) = decl else { continue };
            let (hir, bound) = (self.hir(file), self.bound(file));
            if !hir[i].type_params.is_empty() {
                return true;
            }
            let own = bound.interface_scope[i.idx()];
            if own.is_none() {
                continue;
            }
            let around = self.outer_type_params(file, bound.scopes[own.idx()].parent);
            if around
                .iter()
                .any(|&p| matches!(self.data(p), TypeData::TypeParam(..)))
            {
                return true;
            }
            // `NodeFlagsContainsThis`
            for (t, node) in hir.types.iter().enumerate() {
                let is_this = match node.kind {
                    TypeNodeKind::Keyword(Keyword::This) => true,
                    TypeNodeKind::Predicate { param, .. } => param == known::this,
                    _ => false,
                };
                let mut scope = bound.type_scope[t];
                while is_this && scope.is_some() {
                    if scope == own {
                        return true;
                    }
                    scope = bound.scopes[scope.idx()].parent;
                }
            }
            // What it extends has to be an interface that is none itself.
            for node in hir.ids(hir[i].extends) {
                let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                    continue;
                };
                let names: Vec<Atom> = hir.ids(name).collect();
                let base = self
                    .files()
                    .resolve_entity(file, bound.type_scope[node.idx()], &names, SymFlags::TYPE)
                    .and_then(|s| self.files().resolve_alias_if_needed(s));
                if !base.is_some_and(|b| {
                    self.files().flags(b).contains(SymFlags::INTERFACE)
                        && !self.is_declared_as_reference(b, depth + 1)
                }) {
                    return true;
                }
            }
        }
        false
    }

    /// An intersection that is its own apparent type: nothing in it but object types. What it lacks is said of it by name.
    fn is_intersection_of_objects(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Intersection(parts) if parts.iter().all(|&p| self.is_object_type(p)))
    }

    /// What `typeToString` says with `UseFullyQualifiedType` of a type that has no more to it than a name: the names from the
    /// inside out, and the file if it is a module that exports the outermost.
    fn fully_qualified_name(&self, ty: TypeId) -> Option<(Vec<Atom>, Option<FileId>)> {
        use crate::bind::Decl;
        let named = match *self.data(ty) {
            TypeData::TypeParam(file, tp, _) => {
                return Some((vec![self.hir(file)[tp].name], None));
            }
            TypeData::Ref { target, ref args } if args.is_empty() => target,
            _ => self.non_generic_alias_of(ty)?,
        };
        let files = self.files();
        let (mut sym, mut names) = (named, Vec::new());
        loop {
            let symbol = files.symbol(sym);
            // `import("./a").T`
            if symbol.decls.contains(&Decl::File) {
                return Some((names, Some(sym.file)));
            }
            names.push(symbol.name);
            let Some(parent) = files.parent_of_symbol(sym) else {
                return Some((names, None));
            };
            sym = parent;
        }
    }

    /// 2741, 2739, 2740: `target` requires properties that `source` does not have.
    fn why_not_assignable_at_the_surface(&mut self, source: TypeId, target: TypeId) -> Option<u32> {
        if !(self.is_object_type(source) || self.is_intersection_of_objects(source))
            || !self.is_object_type(target)
            || self.is_deferred(source)
            || self.is_deferred(target)
        {
            return None;
        }
        // `structuredTypeRelatedToWorker` compares the apparent type. Where that is another type (of a mapped type over what can only
        // be arrays or tuples), it is the one said to lack something, and the head, which names `source`, stays (`chainArgsMatch`).
        if self.apparent_type(source) != source {
            return None;
        }
        // Between lists it is the elements that are looked at.
        if self.is_tuple(target) && self.is_array_or_tuple(source) {
            return None;
        }
        let (sm, tm) = (self.members(source)?, self.members(target)?);
        // `getUnmatchedProperties`
        let mut missing = 0;
        for tp in &tm.shape().props {
            // `isStaticPrivateIdentifierProperty`
            let is_static_private = matches!(&tp.source, PropSource::Members(decls) if decls.first().is_some_and(|&(file, m)| {
                let member = &self.hir(file)[m];
                matches!(member.key, PropKey::Private(_)) && member.flags.contains(Flags::STATIC)
            }));
            if !is_static_private
                && !tp.flags.contains(PropFlags::OPTIONAL)
                && self.property_of_type(&sm, tp.name).is_none()
            {
                // `reportUnmatchedProperty`: something else is said, under the head.
                if missing == 0 && self.declares_private_name_written_alike(source, &sm, tp.name) {
                    return None;
                }
                missing += 1;
            }
        }
        // `tryElaborateArrayLikeErrors`: several are only listed where that helps.
        if missing > 1 {
            let lists_them = if self.is_tuple(source) {
                self.is_array_or_tuple(target)
            } else if self.is_tuple(target) {
                self.is_array(source)
            } else {
                true
            };
            if !lists_them {
                return None;
            }
        }
        // A function that lacks what an object has is told that it is not that kind of thing.
        let s = sm.shape();
        if missing > 0 && s.props.is_empty() && !(s.call.is_empty() && s.construct.is_empty()) {
            let t = tm.shape();
            if !((!t.call.is_empty() && !s.call.is_empty())
                || (!t.construct.is_empty() && !s.construct.is_empty()))
            {
                return None;
            }
        }
        match missing {
            0 => None,
            1 => Some(2741),
            2..=5 => Some(2739),
            _ => Some(2740),
        }
    }

    /// Whether `name` is a `#x` and the class that `source`, whose members are `members`, is an instance of declares a `#x` itself:
    /// two members that are written alike.
    fn declares_private_name_written_alike(
        &self,
        source: TypeId,
        members: &Members,
        name: Atom,
    ) -> bool {
        use crate::bind::MemberOwner;
        // The name as it is written, without what tells the `#x` of one class from that of another.
        fn written(text: &[u8]) -> &[u8] {
            &text[..text.iter().position(|&b| b == b'@').unwrap_or(text.len())]
        }
        let TypeData::Ref { target: class, .. } = *self.data(source) else {
            return false;
        };
        let text = self.files().atoms.bytes(name);
        if text.first() != Some(&b'#') || !self.files().flags(class).contains(SymFlags::CLASS) {
            return false;
        }
        members.shape().props.iter().any(|p| {
            written(self.files().atoms.bytes(p.name)) == written(text)
                && matches!(&p.source, PropSource::Members(decls) if decls.iter().any(|&(file, m)| {
                    let bound = self.bound(file);
                    matches!(bound.member_owner[m.idx()], MemberOwner::Class(c) if self.files().sym(file, bound.class_symbol[c.idx()]) == class)
                }))
        })
    }
}

// ───────────────────────────── why ─────────────────────────────

impl Checker<'_> {
    /// Where, going in from the outside, `source` stops fitting `target`: the way there, and the two types at the end of it.
    /// Made for reading, not for speed: it is asked once an error is about to be shown.
    pub fn explain_not_assignable(&mut self, source: TypeId, target: TypeId) -> String {
        let mut path = String::new();
        self.explaining.clear();
        let (s, t) = self.descend_to_the_reason(source, target, &mut path, 0);
        let leaf = |c: &mut Self, ty: TypeId| match c.data(ty) {
            TypeData::StringLit { value, .. } => format!("{:?}", c.files().atoms.text(*value)),
            TypeData::BoolLit { value, .. } => value.to_string(),
            _ => crate::describe::Describer::new(c).describe(ty),
        };
        let kind = |c: &Self, ty: TypeId| {
            let text = format!("{:?}", c.data(ty));
            text[..text.find([' ', '(', '{']).unwrap_or(text.len())].to_owned()
        };
        let kinds = (kind(self, s), kind(self, t));
        let (s, t) = (leaf(self, s), leaf(self, t));
        format!("{path}: {s} to {t} [{} to {}]", kinds.0, kinds.1)
    }

    /// Whether `s` does not fit `t` only because a pair that is being explained does not: no reason, but a consequence.
    fn leads_back(&mut self, s: TypeId, t: TypeId) -> bool {
        let mark = self.explaining.len();
        let mut scratch = String::new();
        let end = self.descend_to_the_reason(s, t, &mut scratch, 6);
        let back = self.explaining[..mark].contains(&end);
        self.explaining.truncate(mark);
        back
    }

    fn descend_to_the_reason(
        &mut self,
        s: TypeId,
        t: TypeId,
        path: &mut String,
        depth: u32,
    ) -> (TypeId, TypeId) {
        use std::fmt::Write;
        if depth > 12 {
            return (s, t);
        }
        let (s, t) = (self.force(s), self.force(t));
        if self.explaining.contains(&(s, t)) {
            return (s, t);
        }
        self.explaining.push((s, t));
        if let TypeData::Union(parts) = self.data(s).clone() {
            for part in parts.iter().copied() {
                if !self.is_assignable(part, t) {
                    path.push_str("|one of them|");
                    return self.descend_to_the_reason(part, t, path, depth + 1);
                }
            }
            return (s, t);
        }
        if let TypeData::Union(parts) = self.data(t).clone() {
            // The member it is meant for: the one what tells them apart points to, or else the one it has most in common with.
            let mut best = None;
            let mut best_score = -1i32;
            if let Some(sm) = self.members(s) {
                for part in parts.iter().copied() {
                    if !self.is_object_type(part) {
                        continue;
                    }
                    let mut score = 0;
                    for sp in sm.shape().props.clone() {
                        let Some(wanted) = self.type_of_property(part, sp.name) else {
                            continue;
                        };
                        score += 1;
                        if self.is_discriminant_property(t, sp.name) {
                            let given = self.type_of_prop(&sp, sm.mapper);
                            score += if self.is_assignable(given, wanted) {
                                100
                            } else {
                                -100
                            };
                        }
                    }
                    if score > best_score {
                        best_score = score;
                        best = Some(part);
                    }
                }
            }
            return match best {
                Some(part) => {
                    path.push_str("|the member meant|");
                    self.descend_to_the_reason(s, part, path, depth + 1)
                }
                None => (s, t),
            };
        }
        if let (Some(a), Some(b)) = (self.array_element(s), self.array_element(t)) {
            path.push_str("[]");
            return self.descend_to_the_reason(a, b, path, depth + 1);
        }
        if let (
            TypeData::Ref {
                target: st,
                args: sa,
            },
            TypeData::Ref {
                target: tt,
                args: ta,
            },
        ) = (self.data(s).clone(), self.data(t).clone())
            && st == tt
        {
            for (i, (&a, &b)) in sa.iter().zip(ta.iter()).enumerate() {
                if !self.is_assignable(a, b) && !self.leads_back(a, b) {
                    let _ = write!(path, "<{i}>");
                    return self.descend_to_the_reason(a, b, path, depth + 1);
                }
            }
        }
        // All that the members of an intersection have, together.
        if matches!(self.data(s), TypeData::Intersection(_))
            && self.is_object_type(t)
            && let Some(tm) = self.members(t)
        {
            for tp in tm.shape().props.clone() {
                let name = self.files().atoms.text(tp.name).into_owned();
                let wanted = self.type_of_prop(&tp, tm.mapper);
                match self.type_of_property(s, tp.name) {
                    None if !tp.flags.contains(PropFlags::OPTIONAL) => {
                        let _ = write!(path, "&.{name} is missing");
                        return (s, t);
                    }
                    Some(given) if !self.is_assignable(given, wanted) => {
                        let _ = write!(path, "&.{name}");
                        return self.descend_to_the_reason(given, wanted, path, depth + 1);
                    }
                    _ => {}
                }
            }
            path.push_str("&nothing found");
            return (s, t);
        }
        if !self.is_object_type(s) || !self.is_object_type(t) {
            return (s, t);
        }
        let (Some(sm), Some(tm)) = (self.members(s), self.members(t)) else {
            return (s, t);
        };
        if depth == 0 && std::env::var_os("BUN_SEMA_EXPLAIN_ALL").is_some() {
            for tp in tm.shape().props.clone() {
                if let Some(sp) = sm.resolved.prop(tp.name).cloned() {
                    let (given, wanted) = (
                        self.type_of_prop(&sp, sm.mapper),
                        self.type_of_prop(&tp, tm.mapper),
                    );
                    if !self.is_assignable(given, wanted) {
                        let mut d = crate::describe::Describer::new(self);
                        let (a, b) = (d.describe(given), d.describe(wanted));
                        eprintln!(
                            "  FAILS .{}: {a:.110} TO {b:.110}",
                            self.files().atoms.text(tp.name)
                        );
                    }
                }
            }
        }
        for tp in tm.shape().props.clone() {
            let name = self.files().atoms.text(tp.name).into_owned();
            let Some(sp) = sm.resolved.prop(tp.name).cloned() else {
                if !tp.flags.contains(PropFlags::OPTIONAL) {
                    let _ = write!(path, ".{name} is missing");
                    return (s, t);
                }
                continue;
            };
            let (given, wanted) = (
                self.type_of_prop(&sp, sm.mapper),
                self.type_of_prop(&tp, tm.mapper),
            );
            if !self.is_assignable(given, wanted) && !self.leads_back(given, wanted) {
                let _ = write!(path, ".{name}");
                return self.descend_to_the_reason(given, wanted, path, depth + 1);
            }
            if sp.flags.contains(PropFlags::OPTIONAL) && !tp.flags.contains(PropFlags::OPTIONAL) {
                let _ = write!(path, ".{name} is optional");
                return (s, t);
            }
        }
        if let (&[a], &[b]) = (&sm.shape().call[..], &tm.shape().call[..]) {
            let (a, b) = (
                self.instantiate_sig(a, sm.mapper),
                self.instantiate_sig(b, tm.mapper),
            );
            let (ar, br) = (self.sig_return(a), self.sig_return(b));
            if br != TypeId::VOID && !self.is_assignable(ar, br) {
                path.push_str("()");
                return self.descend_to_the_reason(ar, br, path, depth + 1);
            }
            let (ap, bp) = (self.sig_params(a), self.sig_params(b));
            for i in 0..ap.len().min(bp.len()) {
                if !self.is_assignable(bp[i].ty, ap[i].ty)
                    && !self.is_assignable(ap[i].ty, bp[i].ty)
                {
                    let _ = write!(path, "(parameter {i})");
                    return self.descend_to_the_reason(bp[i].ty, ap[i].ty, path, depth + 1);
                }
            }
        }
        (s, t)
    }
}
