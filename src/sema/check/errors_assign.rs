//! Values that do not fit where they are put: 2322 and what stands in for it.
//!
//! Three things decide what is reported. Where a value has to fit: an annotated variable, an assignment, a `return`, a
//! default. How far in the complaint can be taken: to the property of an object literal, the element of an array literal or
//! the body of an arrow function that is to blame. And what is said: that something is missing, that something is too much,
//! or just that it does not fit.

use super::errors::Diagnostic;
use super::explain_relation::RelationDiagnostic;
use super::relate::Relation;
use super::related::Place;
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
        self.check_mapped_type_keys(file);
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
                            let at = Some(self.place_of_token(file, hir[s].pos));
                            if !self.is_uncertain(file, e)
                                && !self.check_type_assignable_to_and_optionally_elaborate(
                                    ty,
                                    instance,
                                    at,
                                    Some((file, e)),
                                    None,
                                    None,
                                )
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
            let comparable = Relation::Comparable;
            let Some(said) = self.report_unrelated(
                given,
                target,
                comparable,
                (at, end),
                2352,
                false,
                false,
                out,
            ) else {
                continue;
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
        }
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
    fn check_mapped_type_keys(&mut self, file: FileId) {
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
                let place = (file, hir[at].pos, self.end_of_type_node(file, at));
                self.check_type_assignable_to(ty, keys, Some(place), None);
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
        if let Some((host, _)) = self.stored_alias(ty) {
            let symbol = self.bound(file).alias_symbol[alias.idx()];
            return *host == self.files().sym(file, symbol);
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

    /// `checkTypeAssignableToAndOptionallyElaborate`. `expr`: as it is written, with the parentheses around it.
    pub(super) fn check_type_assignable_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        expr: Option<(FileId, ExprId)>,
        head_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        match self.is_type_related_to_if_told(source, target, Relation::Assignable) {
            Some(true) => return true,
            Some(false) if error_node.is_none() => return false,
            Some(false) => {
                let output = diagnostic_output.as_deref_mut();
                if let Some((file, e)) = expr
                    && self.elaborate_error(file, e, false, source, target, head_message, output)
                {
                    return false;
                }
            }
            // The overflow is reported instead of the relation error. The pair is not compared again to elaborate.
            None => {}
        }
        self.check_type_assignable_to_ex(
            source,
            target,
            error_node,
            head_message,
            diagnostic_output,
        )
    }

    /// What went to a `diagnosticOutput`, for who still has an `out`.
    fn put_out(&mut self, reported: Vec<Reported>, out: &mut Vec<Diagnostic>) {
        for diagnostic in reported {
            out.push(Diagnostic {
                start: diagnostic.start,
                code: diagnostic.code,
            });
            if self.explains {
                self.notes.borrow_mut().push(diagnostic.into());
            }
        }
    }

    /// `elaborateError`, for who still has an `out`.
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
        let (head, mut diags) = (Some(head), Vec::new());
        let is_elaborated = self.elaborate_error(
            file,
            e,
            is_effective,
            source,
            target,
            head,
            Some(&mut diags),
        );
        self.put_out(diags, out);
        is_elaborated
    }

    /// `elaborateError`: takes the complaint that `e`, of type `source`, does not fit `target` to the part of `e` that is to blame.
    /// `is_effective`: `e` is what `getEffectiveCheckNode` leaves, so the parentheses around it are no part of it.
    #[allow(clippy::too_many_arguments)]
    fn elaborate_error(
        &mut self,
        file: FileId,
        e: ExprId,
        is_effective: bool,
        source: TypeId,
        target: TypeId,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
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
            let mut would_do = false;
            for sig in self.signatures(source, construct) {
                let returned = self.sig_return(sig);
                if !self.is_any(returned)
                    && !returned.is_never()
                    && self.is_known(returned)
                    && self.is_assignable(returned, target)
                {
                    would_do = true;
                    break;
                }
            }
            if !would_do {
                continue;
            }
            let at = if is_effective {
                (
                    file,
                    self.start_inside_parentheses(file, e),
                    self.error_end_inside_parentheses(file, e),
                )
            } else {
                (file, self.start_of(file, e), self.error_end_of(file, e))
            };
            let mut diags = Vec::new();
            let output = Some(&mut diags);
            if !self.check_type_assignable_to_ex(source, target, Some(at), head_message, output)
                && let Some(mut diagnostic) = diags.pop()
            {
                let code = if construct { 6213 } else { 6212 };
                diagnostic.add_related_info(self.new_diagnostic(at, code, &[]));
                self.report_diagnostic(diagnostic, diagnostic_output);
                return true;
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
                !is_prefix
                    && self.elaborate_error(
                        file,
                        inner,
                        false,
                        source,
                        target,
                        head_message,
                        diagnostic_output,
                    )
            }
            ExprKind::Assign {
                op: None, value, ..
            } => self.elaborate_error(
                file,
                value,
                false,
                source,
                target,
                head_message,
                diagnostic_output,
            ),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.elaborate_error(
                file,
                right,
                false,
                source,
                target,
                head_message,
                diagnostic_output,
            ),
            ExprKind::Object(props) => {
                self.elaborate_object_literal(file, props, source, target, diagnostic_output)
            }
            ExprKind::Array(items) => {
                self.elaborate_array_literal(file, items, source, target, diagnostic_output)
            }
            ExprKind::Fn(func) if hir[func].kind == FnKind::Arrow => {
                self.elaborate_arrow_function(file, func, source, target, diagnostic_output)
            }
            _ => false,
        }
    }

    fn is_primitive_or_never(&self, ty: TypeId) -> bool {
        ty.is_never() || self.is_primitive(ty)
    }

    /// `elaborateObjectLiteral`
    fn elaborate_object_literal(
        &mut self,
        file: FileId,
        props: Span<PropId>,
        source: TypeId,
        target: TypeId,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
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
            let (next, message) = match prop.kind {
                PropKind::Init => (
                    prop.value,
                    matches!(prop.key, PropKey::Computed(_)).then_some(2418),
                ),
                _ => (ExprId::NONE, None),
            };
            let at = (file, prop.pos, self.end_of_prop_name(file, p));
            let output = diagnostic_output.as_deref_mut();
            reported |=
                self.elaborate_element(source, target, at, next, false, name, message, output);
        }
        reported
    }

    /// `elaborateArrayLiteral`
    fn elaborate_array_literal(
        &mut self,
        file: FileId,
        items: IdList<ExprId>,
        source: TypeId,
        target: TypeId,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
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
            let at = (
                file,
                self.start_inside_parentheses(file, check_node),
                self.error_end_inside_parentheses(file, check_node),
            );
            let output = diagnostic_output.as_deref_mut();
            reported |=
                self.elaborate_element(source, target, at, check_node, true, name, None, output);
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

    /// `elaborateElement`, for who still has an `out`.
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
        let (at, head, mut diags) = ((file, at, end), Some(head), Vec::new());
        let is_elaborated = self.elaborate_element(
            source,
            target,
            at,
            next,
            false,
            name,
            head,
            Some(&mut diags),
        );
        self.put_out(diags, out);
        is_elaborated
    }

    /// `elaborateElement`: the property or the element is written at `prop`, `next` is its value if it has one to go into.
    /// `is_effective`: `next` is what `getEffectiveCheckNode` leaves, so the parentheses around it are no part of it.
    #[allow(clippy::too_many_arguments)]
    fn elaborate_element(
        &mut self,
        source: TypeId,
        target: TypeId,
        prop: Place,
        next: ExprId,
        is_effective: bool,
        name: Atom,
        error_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let file = prop.0;
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
        let output = diagnostic_output.as_deref_mut();
        if next.is_some()
            && self.elaborate_error(file, next, is_effective, given, wanted, None, output)
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
        let mut diags = Vec::new();
        if target_is_optional && self.is_exact_optional_property_mismatch(given, target, name) {
            diags.push(self.new_diagnostic(prop, 2412, &[Arg::Type(given), Arg::Type(wanted)]));
        } else {
            // What may be left out is not held to be `undefined`.
            let wanted = if target_is_optional && self.p.files.options.exact_optional_property_types
            {
                self.without_undefined(wanted)
            } else {
                wanted
            };
            let output = Some(&mut diags);
            self.check_type_assignable_to_ex(given, wanted, Some(prop), error_message, output);
        }
        let Some(mut diagnostic) = diags.pop() else {
            return false;
        };
        let related = self.expected_property(target, name);
        diagnostic
            .related_information
            .extend(related.and_then(super::explain::Related::into_reported));
        self.report_diagnostic(diagnostic, diagnostic_output);
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

    /// `elaborateArrowFunction`
    fn elaborate_arrow_function(
        &mut self,
        file: FileId,
        func: FnId,
        source: TypeId,
        target: TypeId,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
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
        let output = diagnostic_output.as_deref_mut();
        if self.elaborate_error(file, body, false, given, all, None, output) {
            return true;
        }
        let at = (
            file,
            self.start_of(file, body),
            self.error_end_of(file, body),
        );
        let mut diags = Vec::new();
        self.check_type_assignable_to_ex(given, all, Some(at), None, Some(&mut diags));
        let Some(mut diagnostic) = diags.pop() else {
            return false;
        };
        let related = self.where_expected_return_type_comes_from(file, func, given, target, all);
        let related = related.into_iter();
        diagnostic
            .related_information
            .extend(related.filter_map(super::explain::Related::into_reported));
        self.report_diagnostic(diagnostic, diagnostic_output);
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

    /// `checkTypeAssignableTo(source, target, errorNode, headMessage)`, of two that are not assignable and that tsgo has not compared
    /// before (`Relater::is_only_run`). `at`: where `errorNode`, a name, starts.
    pub(super) fn report_not_assignable_in_one_run(
        &mut self,
        source: TypeId,
        target: TypeId,
        at: u32,
        head: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        let assignable = Relation::Assignable;
        self.report_unrelated(source, target, assignable, (at, 0), head, false, true, out);
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
        // 2678 is what `reportRelationError` says without a head message under the comparable relation.
        let relation = if head == 2678 {
            Relation::Comparable
        } else {
            Relation::Assignable
        };
        let is_named_otherwise = named_otherwise.0
            || named_otherwise.1
            || self.is_aliased_jsx_class_attributes(source, target);
        self.report_unrelated(
            source,
            target,
            relation,
            (at, end),
            head,
            is_named_otherwise,
            false,
            out,
        );
    }

    /// `checkTypeRelatedToEx(source, target, relation, errorNode, headMessage)`, of two types that the caller has found not to be
    /// related: reports what it reports, and gives that back. `place`: from where to where `errorNode` goes. `is_only_run`: see
    /// `Relater::is_only_run`.
    #[allow(clippy::too_many_arguments)]
    fn report_unrelated(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        place: (u32, u32),
        head: u32,
        is_named_otherwise: bool,
        is_only_run: bool,
        out: &mut Vec<Diagnostic>,
    ) -> Option<Diagnostic> {
        let place = (self.checking?, place.0, place.1);
        let (is_related, diagnostic) = self.relation_diagnostic(
            source,
            target,
            relation,
            place,
            Some(head),
            is_named_otherwise,
            is_only_run,
        );
        let diagnostic = match diagnostic {
            // It is not the relation that the caller goes by (`is_refused_by_hosting_alias`): there are no reasons to give.
            None if is_related && self.related(source, target, relation) => {
                self.relation_error_without_reasons(source, target, relation, place, head)
            }
            diagnostic => diagnostic?,
        };
        let RelationDiagnostic {
            at: (_, start, end),
            mut lines,
            related,
        } = diagnostic;
        if lines.is_empty() {
            return None;
        }
        let first = lines.remove(0);
        let said = Diagnostic {
            start,
            code: first.code,
        };
        out.push(said);
        self.note(start, end, said.code, first.args);
        self.explain_chain(start, said.code, |_| lines);
        self.relate(start, said.code, |_| related);
        Some(said)
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
