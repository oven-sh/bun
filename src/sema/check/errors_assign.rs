//! Assignability errors: 2322 and the codes that replace it.
//!
//! Three things decide what is reported. The assignment site: an annotated variable, an assignment,
//! a `return`, a default. How far the error is elaborated: to the offending property of an object
//! literal, element of an array literal or body of an arrow function. And the message: that
//! something is missing, that something is in excess, or only that the type is not assignable.

use super::explain::NOWHERE;
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
        start: hir[ty].pos,
        end: hir[ty].end,
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

impl Checker<'_> {
    pub(super) fn check_assignments(&mut self, file: FileId) {
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `checkPropertyAssignment`, `checkShorthandPropertyAssignment`: the value is checked
        // against the type of the `@type` tag.
        for &(owner, node) in &hir.jsdoc_types {
            let JsDocTypeOwner::Prop(p) = owner else {
                continue;
            };
            let (value, literal) = (hir[p].value, bound.prop_owner[p.idx()]);
            // `checkDestructuringAssignment` does not reach it.
            if value.is_none()
                || literal.is_none()
                || self.is_definite_assignment_target(file, literal)
            {
                continue;
            }
            let target = self.type_from_node(file, node);
            let source = self.type_of_expr(file, value);
            // `checkExpressionForMutableLocation`, with `target` as the contextual type.
            let source = if self.is_const_context(file, value) {
                self.regular(source)
            } else if matches!(hir[value].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                source
            } else {
                self.widen_literal_for_context(source, Some(target))
            };
            let at = (file, hir[p].pos, self.end_of_prop(file, p));
            self.check_type_assignable_to_and_optionally_elaborate(
                source,
                target,
                Some(at),
                Some((file, value)),
                false,
                None,
                None,
            );
        }
        self.check_literals_against_patterns(file);
        // `checkExportAssignment`: the exported expression is checked against the type of its
        // `@type` tag.
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
            let at = (file, self.start_of(file, e), self.end_of_expr(file, e));
            self.check_initializer(file, e, target, at);
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
            // `checkReferenceExpression`: an assertion on a reference is a reference too.
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
                // For `a?.b = x` only the invalid target is reported.
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }
                    if chain == Chain::No => {}
                _ => continue,
            }
            // `[a = 1] = x`: a default, not an assignment.
            if self.is_definite_assignment_target(file, ExprId(i as u32)) {
                continue;
            }
            // `{ a = 1 }` that is not an assignment target (1312): `checkObjectLiteral` checks the
            // initializer and not the name.
            if matches!(bound.expr_parent[i], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
            {
                continue;
            }
            // `checkExpression(left)`: an invalid assignment target has the error type, to which
            // anything is assignable.
            let left = self.type_of_expr(file, target);
            if self.is_error_type(left) {
                continue;
            }
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
            self.check_assignable_with_end(
                file,
                source,
                left,
                self.start_of(file, target),
                self.end_of_expr(file, target),
                value,
                2322,
            );
        }
    }

    /// `c.checkTypeAssignableToAndOptionallyElaborate(c.checkExpressionCached(initializer), t, node, initializer, nil, nil)`
    fn check_initializer(&mut self, file: FileId, initializer: ExprId, t: TypeId, node: Place) {
        let source = self.type_of_expr(file, initializer);
        let expr = Some((file, initializer));
        self.check_type_assignable_to_and_optionally_elaborate(
            source,
            t,
            Some(node),
            expr,
            false,
            None,
            None,
        );
    }

    /// `checkVariableLikeDeclaration` for a variable, starting at "validate the initializer".
    pub(super) fn check_variable_initializer(&mut self, file: FileId, d: VarDeclId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let strict = self.p.files.options.strict_null_checks;
        let decl = &hir[d];
        if decl.ty.is_none()
            && decl.init.is_some()
            && bound.var_stmt[d.idx()].is_some()
            && matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_))
        {
            self.check_literals_expected_by_pattern(file, decl.init);
        }
        if decl.ty.is_none() || decl.init.is_none() || bound.var_stmt[d.idx()].is_none() {
            return;
        }
        // An initializer in a `for`-`in` is an error already.
        if matches!(bound.stmt_parent[bound.var_stmt[d.idx()].idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForIn { .. }))
        {
            return;
        }
        // The only requirement on the initializer of such a pattern is that it is not nullish.
        if strict && Self::is_pattern_without_names(hir, decl.pat) {
            return;
        }
        // `isInAmbientOrTypeNode`: the initializer of an ambient binding pattern is a grammar error and is not compared.
        if decl.flags.contains(Flags::AMBIENT)
            && matches!(hir[decl.pat].kind, PatKind::Object(_) | PatKind::Array(_))
        {
            return;
        }
        let target = self.type_from_node(file, decl.ty);
        let source = self.type_of_expr(file, decl.init);
        // `getESSymbolLikeTypeForNode`, `isValidESSymbolDeclaration`: for a `const` with an
        // identifier name, in a statement of its own.
        let stmt = bound.var_stmt[d.idx()];
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
        let at = (file, hir[decl.pat].pos, self.end_of_pat(file, decl.pat));
        self.check_type_assignable_to_and_optionally_elaborate(
            source,
            target,
            Some(at),
            Some((file, decl.init)),
            false,
            None,
            None,
        );
    }

    /// The same for a parameter.
    pub(super) fn check_parameter_initializer(&mut self, file: FileId, p: ParamId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let strict = self.p.files.options.strict_null_checks;
        let param = &hir[p];
        if param.default.is_none() || bound.param_fn[p.idx()].is_none() {
            return;
        }
        // `checkVariableLikeDeclaration`: in a function without a body a default is an error, and
        // nothing else is reported for it.
        if matches!(hir[bound.param_fn[p.idx()]].body, FnBody::None) {
            return;
        }
        if param.ty.is_none()
            && matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_))
        {
            self.check_literals_expected_by_pattern(file, param.default);
        }
        if strict && Self::is_pattern_without_names(hir, param.pat) {
            return;
        }
        let target = self.param_default_target(file, p);
        let at = (
            file,
            param.pos.min(hir[param.pat].pos),
            self.end_of_param(file, p),
        );
        self.check_initializer(file, param.default, target, at);
    }

    /// The same for a binding element: `pat` with its `default`, which is checked against the
    /// element's type in the destructured type.
    pub(super) fn check_binding_element_initializer(
        &mut self,
        file: FileId,
        pat: PatId,
        default: ExprId,
    ) {
        if default.is_none() || self.is_in_parameter_without_body(file, pat) {
            return;
        }
        let hir = self.hir(file);
        // The default of an element that is a pattern itself.
        if matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
            let is_whole_implied = self.is_initializer_expected_by_pattern(file, pat);
            self.check_literals_expected_by_pattern(file, default);
            // `getTypeFromBindingElement`: for the type implied by the whole pattern, the default
            // is checked with the type implied by its own pattern as its contextual type.
            if is_whole_implied && let Some(implied) = self.context_implied_by_pattern(file, pat) {
                self.contextual.push((file, default, implied));
                self.check_literals_expected_by_pattern(file, default);
                self.contextual.pop();
            }
        }
        let strict = self.p.files.options.strict_null_checks;
        let is_ambient = self
            .var_decl_of_pat(file, pat)
            .is_some_and(|d| hir[d].flags.contains(Flags::AMBIENT));
        // `isInAmbientOrTypeNode`: the default of a nested binding pattern in an ambient declaration is not compared.
        if is_ambient && matches!(hir[pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
            return;
        }
        if default.is_some()
            && !matches!(hir[pat].kind, PatKind::Missing)
            && !(strict && Self::is_pattern_without_names(hir, pat))
        {
            let target = self.type_of_pat(file, pat);
            let at = (file, hir[pat].pos, self.end_of_pat(file, pat));
            self.check_initializer(file, default, target, at);
        }
    }

    /// The same for a class property.
    pub(super) fn check_property_initializer(&mut self, file: FileId, m: MemberId) {
        let hir = self.hir(file);
        let strict = self.p.files.options.strict_null_checks;
        let member = &hir[m];
        if member.kind != MemberKind::Property || member.ty.is_none() || member.init.is_none() {
            return;
        }
        let declared = self.type_from_node(file, member.ty);
        // `getTypeOfSymbol`: `addOptionalityEx(declaredType, isProperty, isOptional)`, which is not
        // the annotated type.
        // `getTypeOfAccessors` uses the annotation of an `accessor` field unchanged.
        let is_optional = strict
            && member.flags.contains(Flags::OPTIONAL)
            && !member.flags.contains(Flags::ACCESSOR);
        let target = if is_optional {
            self.optional_property(declared)
        } else {
            declared
        };
        let at = (file, member.name_pos, self.end_of_member_name(file, m));
        self.check_initializer(file, member.init, target, at);
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
        match self.contextual_param_type(file, func, index) {
            Some(ty) if is_optional => self.optional(ty),
            Some(ty) => ty,
            None => resolved,
        }
    }

    /// `needCheckWidenedType` of `checkVariableLikeDeclaration`: a pattern none of whose elements has a name.
    pub(super) fn is_pattern_without_names(hir: &hir::File, pat: PatId) -> bool {
        match hir[pat].kind {
            PatKind::Object(props) => props.is_empty(),
            PatKind::Array(elems) => elems
                .iter()
                .all(|e| matches!(hir[hir[e].pat].kind, PatKind::Missing)),
            _ => false,
        }
    }

    /// `getAnnotatedAccessorType` of the setter that shares its symbol with the getter `getter`:
    /// the annotated type of its parameter.
    pub(super) fn annotated_setter_type(&mut self, file: FileId, getter: FnId) -> Option<TypeId> {
        let setter = self.sibling_accessor(file, getter, FnKind::Setter)?;
        let hir = self.hir(file);
        let p = hir[setter].params.iter().next()?;
        hir[p]
            .ty
            .is_some()
            .then(|| self.type_from_node(file, hir[p].ty))
    }

    /// `checkAssertionDeferred`: reports 2352 for `x as T` when neither type is comparable to the other.
    pub(super) fn check_assertion_deferred(
        &mut self,
        file: FileId,
        e: ExprId,
        expr: ExprId,
        ty: TypeNodeId,
    ) {
        let hir = self.hir(file);
        let actual = self.type_of_expr(file, expr);
        let target = self.type_from_node(file, ty);
        let actual = self.base_of_literal(actual);
        let widened = self.widened(actual);
        if self.is_comparable(target, widened) {
            return;
        }
        let actual = self.regular_type_of_object_literal(actual);
        if self.is_comparable(actual, target) {
            return;
        }
        // For a JSDoc type assertion the error node is the type node.
        let (at, end) = if hir.is_in_jsdoc(hir[ty].pos) {
            (hir[ty].pos, self.end_of_type_node(file, ty))
        } else {
            (
                self.start_inside_parentheses(file, e),
                self.end_inside_parentheses(file, e),
            )
        };
        self.check_type_comparable_to(actual, target, Some((file, at, end)), Some(2352));
    }

    /// `checkObjectLiteral`, `contextualTypeHasPattern`: reports 2353 for a property of an object literal that the destructuring pattern
    /// it is assigned to does not bind.
    fn check_literals_against_patterns(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `getContextualTypeForAssignmentExpression`: the contextual type of the right-hand side is the type of the destructuring pattern.
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
            self.check_literals_expected_by_pattern(file, value);
        }
    }

    /// Whether the type implied by the whole pattern that contains `pat` is computed as the
    /// contextual type of its initializer (`getContextualTypeForInitializerExpression`): no other
    /// contextual type exists, and the initializer is a literal, which requests one.
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

    /// The object literals in `e` that receive the contextual type of `e` unchanged
    /// (`getContextualType`): through literals, `?:`, `&&`, `,` and the left operand of `||` and
    /// `??`, and into an immediately invoked function. A type that a call infers from its
    /// contextual type is widened (`getCovariantInference`) and is no longer a pattern type.
    fn check_literals_expected_by_pattern(&mut self, file: FileId, e: ExprId) {
        if e.is_none() {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Object(props) => {
                self.check_literal_against_pattern(file, e, props);
                for p in props.iter() {
                    if matches!(hir[p].kind, PropKind::Init | PropKind::Spread) {
                        self.check_literals_expected_by_pattern(file, hir[p].value);
                    }
                }
            }
            ExprKind::Array(items) => {
                for item in hir.ids(items) {
                    self.check_literals_expected_by_pattern(file, item);
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                self.check_literals_expected_by_pattern(file, yes);
                self.check_literals_expected_by_pattern(file, no);
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
            | ExprKind::AsConst(x) => self.check_literals_expected_by_pattern(file, x),
            // `getContextualReturnType`, `GetImmediatelyInvokedFunctionExpression`
            ExprKind::Call(c) => {
                let ExprKind::Fn(func) = hir[hir[c].callee].kind else {
                    return;
                };
                match hir[func].body {
                    FnBody::Expr(body) => self.check_literals_expected_by_pattern(file, body),
                    _ => {
                        for s in bound.ids(bound.fns[func.idx()].returns) {
                            if let StmtKind::Return(returned) = hir[s].kind {
                                self.check_literals_expected_by_pattern(file, returned);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// Checks the literal `e`, if its contextual type is the type implied by a pattern.
    fn check_literal_against_pattern(&mut self, file: FileId, e: ExprId, props: Span<PropId>) {
        let hir = self.hir(file);
        let Some(context) = self.apparent_type_of_contextual_type(file, e, ContextFlags::empty())
        else {
            return;
        };
        // `Some(false)`: created from a pattern all of whose names are known.
        if self.pattern_of_type(context) != Some(false) {
            return;
        }
        let Some(members) = self.members(context) else {
            return;
        };
        // A rest element accepts any property.
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
            // `getPropertyOfType`: the properties common to all objects are included.
            if !name.is_some_and(|name| self.property_of_type(&members, name).is_some()) {
                let end = self.end_of_prop_name(file, p);
                self.error_at(
                    (file, prop.pos, end),
                    2353,
                    &[
                        Arg::Bytes(&self.source_text(file, prop.pos, end)),
                        Arg::Type(context),
                    ],
                );
            }
        }
    }

    /// The symbol name of a member of an object literal (`getSymbolOfDeclaration`): a plain name, a
    /// literal in brackets (`getDeclarationName`), or the value of `a` or `a.b` in brackets if it
    /// is statically known (`isLateBindableName`). `Ok(None)`: any other computed key is not a
    /// name. `Err`: unknown.
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
            // `IsSignedNumericLiteral`: the sign is preserved, even a `+`.
            ExprKind::Unary {
                op: op @ (UnOp::Plus | UnOp::Minus),
                operand,
            } if !is_parenthesized(hir, operand) => {
                let ExprKind::Number(n) = hir[operand].kind else {
                    return Ok(None);
                };
                let digits = self.number_name(hir.numbers[n as usize]);
                let sign: &[u8] = if op == UnOp::Plus { b"+" } else { b"-" };
                let text = cat!(sign, self.atoms().bytes(digits));
                return Ok(Some(self.atoms().intern(&text)));
            }
            _ => {}
        }
        // `isLateBindableAST`
        if !is_entity_name_expression(hir, k) {
            return Ok(None);
        }
        Ok(self.member_name(file, key))
    }

    /// `symbol.ValueDeclaration` of the symbol the name `pat` declares.
    pub(super) fn value_declaration_of_variable_name(
        &self,
        file: FileId,
        pat: PatId,
    ) -> (FileId, PatId) {
        use crate::bind::Decl;
        let id = self.bound(file).pat_symbol[pat.idx()];
        if id.is_none() {
            return (file, pat);
        }
        match self.files().value_declaration(self.files().sym(file, id)) {
            Some((of, Decl::Var(name) | Decl::Param(name))) => (of, name),
            _ => (file, pat),
        }
    }

    /// The variable declaration whose name is `pat` or contains `pat`. `None` for a parameter.
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

    /// `checkTypeReferenceOrImport`
    pub(super) fn check_type_reference_or_import(&mut self, file: FileId, node: TypeNodeId) {
        let hir = self.hir(file);
        let referenced = self.type_from_node(file, node);
        // `getTypeParametersForTypeReferenceOrImport`
        let (args, sym) = match hir[node].kind {
            TypeNodeKind::Ref { name, args } if !args.is_empty() => {
                if self
                    .get_intended_type_from_jsdoc_type_reference(file, node)
                    .is_some()
                {
                    return;
                }
                let names: smallvec::SmallVec<[Atom; 4]> = hir.texts(name).collect();
                let scope = self.bound(file).type_scope[node.idx()];
                let found = self
                    .files()
                    .resolve_entity(file, scope, &names, SymFlags::TYPE);
                (
                    args,
                    found.and_then(|sym| self.files().resolve_alias_if_needed(sym)),
                )
            }
            TypeNodeKind::Import {
                args,
                is_typeof: false,
                ..
            } if !args.is_empty() => {
                let symbol = self.resolve_import_type(file, node, false);
                (args, symbol.and_then(|it| self.resolve_symbol(it).symbol()))
            }
            _ => return,
        };
        if let Some(sym) = sym
            && !self.is_error_type(referenced)
        {
            let type_parameters = self.type_params_of_symbol(sym);
            self.check_type_argument_constraints(file, args, &type_parameters);
        }
    }

    /// `checkTypeArgumentConstraints`: 2344, or a more specific error.
    fn check_type_argument_constraints(
        &mut self,
        file: FileId,
        nodes: IdList<TypeNodeId>,
        type_parameters: &[TypeId],
    ) {
        if !type_parameters
            .iter()
            .any(|&p| self.constraint_of_type_param(p).is_some())
        {
            return;
        }
        let hir = self.hir(file);
        // `getEffectiveTypeArguments`
        let actual = self.types_from_nodes(file, nodes);
        let type_arguments = self.fill_type_args(type_parameters, &actual);
        let mapper = self.mapper_from(type_parameters, &type_arguments);
        for (i, node) in hir.ids(nodes).enumerate().take(type_parameters.len()) {
            let Some(constraint) = self.constraint_of_type_param(type_parameters[i]) else {
                continue;
            };
            // An `infer` type in a constrained position is inferred to satisfy the constraint.
            if matches!(hir[node].kind, TypeNodeKind::Infer(_)) {
                continue;
            }
            let constraint = self.instantiate(constraint, mapper);
            // The end of the node is read from the source text, so only for an error.
            if !self.is_assignable(type_arguments[i], constraint) {
                let error_node = (file, hir[node].pos, self.end_of_type_node(file, node));
                self.check_type_assignable_to(
                    type_arguments[i],
                    constraint,
                    Some(error_node),
                    Some(2344),
                );
                return;
            }
        }
    }

    /// `checkClassLikeDeclaration`: the type arguments of `extends Base<Args>`, checked against
    /// each construct signature of `Base` that accepts that many.
    pub(super) fn check_type_arguments_of_base(&mut self, file: FileId, class: ClassId, sym: Sym) {
        let hir = self.hir(file);
        let nodes = hir[class].extends_args;
        if nodes.is_empty() || self.base_types(sym).is_empty() {
            return;
        }
        let constructor = self.base_constructor_type_of_class(sym);
        let apparent = self.apparent_type(constructor);
        let actual = self.types_from_nodes(file, nodes);
        // `getConstructorsForTypeArguments`
        for sig in self.signatures(apparent, true) {
            let type_parameters = self.sig_type_params(sig);
            if actual.len() < self.min_type_argument_count(&type_parameters)
                || actual.len() > type_parameters.len()
            {
                continue;
            }
            if let Ok(Some((i, argument, constraint))) =
                self.failing_type_argument(sig, &type_parameters, &actual)
            {
                let node: TypeNodeId = hir.id_at(nodes, i);
                let error_node = (file, hir[node].pos, self.end_of_type_node(file, node));
                self.check_type_assignable_to(argument, constraint, Some(error_node), Some(2344));
                return;
            }
        }
    }

    /// `checkMappedType`: the constraint type, or else the name type, must be a key type. 2322.
    pub(super) fn check_mapped_type_keys(&mut self, file: FileId, m: MappedId) {
        let hir = self.hir(file);
        let (at, ty) = if hir[m].name_ty.is_some() {
            (hir[m].name_ty, self.type_from_node(file, hir[m].name_ty))
        } else {
            // `getConstraintTypeFromMappedType`: a circular constraint is an error, which is
            // reported elsewhere.
            let param = self.type_param(file, hir[m].param);
            let Some(constraint) = self.constraint_of_type_param(param) else {
                return;
            };
            (hir[hir[m].param].constraint, constraint)
        };
        let keys = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
        if at.is_some() && !self.is_assignable(ty, keys) {
            let error_node = (file, hir[at].pos, self.end_of_type_node(file, at));
            self.check_type_assignable_to(ty, keys, Some(error_node), None);
        }
    }

    /// The type node that contains `node`: `node.Parent`, skipping a parameter, a member, a type
    /// parameter, a named element.
    /// `NONE`: no type node contains it.
    pub(super) fn type_node_parent(hir: &hir::File, node: TypeNodeId) -> TypeNodeId {
        let mut above = hir.parent(hir.node(node));
        loop {
            match hir.data(above) {
                NodeData::Type(parent) => return parent,
                NodeData::Param(_)
                | NodeData::Member(_)
                | NodeData::TypeParam(_)
                | NodeData::TupleElem(_)
                | NodeData::Part(..) => above = hir.parent(above),
                _ => return TypeNodeId::NONE,
            }
        }
    }

    /// `getConditionalFlowTypeOfType`
    pub(super) fn conditional_flow_type_of_type(
        &mut self,
        file: FileId,
        ty: TypeId,
        mut node: TypeNodeId,
    ) -> TypeId {
        if !self.has_conditional_or_mapped_type(file) {
            return ty;
        }
        let hir = self.hir(file);
        let is_variable = self.is_type_variable(ty);
        let mut constraints: Vec<TypeId> = Vec::new();
        let (mut above, mut covariant) = (hir.parent(hir.node(node)), true);
        loop {
            let parent = match hir.data(above) {
                NodeData::Type(parent) => parent,
                NodeData::Stmt(_) | NodeData::File | NodeData::None => break,
                data => {
                    covariant ^= matches!(data, NodeData::Param(_));
                    above = hir.parent(above);
                    continue;
                }
            };
            if let TypeNodeKind::Cond {
                check,
                extends,
                yes,
                ..
            } = hir[parent].kind
                && yes == node
                && (is_variable || covariant)
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
            (node, above) = (parent, hir.parent(above));
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

    /// `IsJSDocTypeAssertion`: the parenthesized expression that a `@type` tag turns into a type
    /// assertion, if `e` is that assertion.
    /// `getEffectiveCheckNode` stops at it (`OEKExcludeJSDocTypeAssertion`).
    pub(super) fn range_of_jsdoc_type_assertion(
        &self,
        file: FileId,
        e: ExprId,
    ) -> Option<(u32, u32)> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::As { ty, .. } if hir.is_in_jsdoc(hir[ty].pos) => {
                hir::parentheses_around(hir, e).first().map(|p| (p.1, p.2))
            }
            _ => None,
        }
    }

    /// `checkReturnStatement` for the `return e` at `s` in `container`: 2408, 2409, or the returned
    /// type is not assignable.
    pub(super) fn check_return_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        container: FnId,
        e: ExprId,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `GetErrorRangeForNode`: the keyword.
        let node = (file, hir[s].start, hir[s].start + b"return".len() as u32);
        if e.is_none() && !self.p.files.options.strict_null_checks {
            let returned = self.return_type_of_fn(file, container);
            if !returned.is_never() {
                if hir[container].kind != FnKind::Constructor
                    && self.p.files.options.no_implicit_returns
                    && !self
                        .is_unwrapped_return_type_undefined_void_or_any(file, container, returned)
                {
                    self.error_at(node, 7030, &[]);
                }
                return;
            }
        }
        match hir[container].kind {
            FnKind::Setter => {
                if e.is_some() {
                    self.error_at(node, 2408, &[]);
                }
            }
            // The value a constructor returns replaces the instance.
            FnKind::Constructor => {
                if e.is_some()
                    && let FnOwner::Member(m) = bound.fns[container.idx()].owner
                    && let crate::bind::MemberOwner::Class(c) = bound.member_owner[m.idx()]
                {
                    let sym = self.files().sym(file, bound.class_symbol[c.idx()]);
                    let instance = self.declared_type(sym);
                    let ty = self.type_of_expr(file, e);
                    if !self.check_type_assignable_to_and_optionally_elaborate(
                        ty,
                        instance,
                        Some(node),
                        Some((file, e)),
                        false,
                        None,
                        None,
                    ) {
                        self.error_at(node, 2409, &[]);
                    }
                }
            }
            _ => {
                let Some(declared) = self.return_type_from_annotation(file, container) else {
                    return;
                };
                // `undefined`, which without strictNullChecks is assignable to everything but
                // `never`.
                if e.is_some() || self.p.files.options.strict_null_checks || declared.is_never() {
                    let expected = self.unwrap_return_type(file, container, declared);
                    self.check_return_expression(file, container, expected, node, true, e, false);
                }
            }
        }
    }

    /// `checkFunctionExpressionOrObjectLiteralMethodDeferred` for a function whose body is the
    /// expression `body`.
    pub(super) fn check_returned_body(&mut self, file: FileId, container: FnId, body: ExprId) {
        if let Some(declared) = self.return_type_from_annotation(file, container) {
            let expected = self.unwrap_return_type(file, container, declared);
            let node = (
                file,
                self.start_of(file, body),
                self.end_of_expr(file, body),
            );
            self.check_return_expression(file, container, expected, node, false, body, false);
        }
    }

    /// `getReturnTypeFromAnnotation`: a getter without an annotation uses its setter's parameter
    /// type, any other function the signature of its `@type` tag.
    fn return_type_from_annotation(&mut self, file: FileId, f: FnId) -> Option<TypeId> {
        let func = &self.hir(file)[f];
        if func.ret.is_some() {
            Some(self.type_from_node(file, func.ret))
        } else if func.kind == FnKind::Getter {
            self.annotated_setter_type(file, f)
        } else {
            self.return_type_of_full_signature(file, f)
        }
    }

    /// `unwrapReturnType` of the declared return type of `f`. Where there is nothing to unwrap the
    /// result is the error type, to which anything is assignable.
    pub(super) fn unwrap_return_type(&mut self, file: FileId, f: FnId, declared: TypeId) -> TypeId {
        let flags = self.hir(file)[f].flags;
        let is_async = flags.contains(Flags::ASYNC);
        if !flags.contains(Flags::GENERATOR) {
            return if is_async {
                self.awaited_no_alias(declared).unwrap_or(TypeId::ERROR)
            } else {
                declared
            };
        }
        // `IterationUseAsyncGeneratorReturnType`: `[Symbol.iterator]` is not consulted for the
        // return type of an async generator.
        if is_async {
            let apparent = self.apparent_type(declared);
            if self
                .type_of_property(apparent, known::sym_async_iterator)
                .is_none()
                && self.type_of_property(apparent, known::next).is_none()
            {
                return TypeId::ERROR;
            }
        }
        match self.iteration_types(declared, is_async) {
            // Where awaiting it is an error, the declared type is used.
            Some(t) if is_async => {
                let returned = self.map_type(t.returned, |c, m| c.awaited_argument(m).unwrap_or(m));
                self.awaited_no_alias(returned).unwrap_or(declared)
            }
            Some(t) => t.returned,
            None => TypeId::ERROR,
        }
    }

    /// `checkReturnExpression`. `node`: the `return` statement, or the expression body. `e`: `NONE`
    /// where nothing is returned.
    #[allow(clippy::too_many_arguments)]
    fn check_return_expression(
        &mut self,
        file: FileId,
        container: FnId,
        expected: TypeId,
        node: Place,
        in_return_statement: bool,
        e: ExprId,
        in_conditional_expression: bool,
    ) {
        let hir = self.hir(file);
        if e.is_none() {
            self.check_type_assignable_to(TypeId::UNDEFINED, expected, Some(node), None);
            return;
        }
        if let ExprKind::Cond { yes, no, .. } = hir[e].kind {
            for arm in [yes, no] {
                self.check_return_expression(
                    file,
                    container,
                    expected,
                    node,
                    in_return_statement,
                    arm,
                    true,
                );
            }
            return;
        }
        let ty = self.type_of_expr(file, e);
        let ty = if hir[container].flags.contains(Flags::ASYNC) {
            self.check_awaited_type(ty, false, node, 1058)
        } else {
            ty
        };
        // `getEffectiveCheckNode`
        let mut e = e;
        while let ExprKind::Satisfies { expr, .. } = hir[e].kind {
            e = expr;
        }
        let error_node = if in_return_statement && !in_conditional_expression {
            node
        } else if let Some((open, end)) = self.range_of_jsdoc_type_assertion(file, e) {
            (file, open, end)
        } else {
            (
                file,
                self.start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            )
        };
        self.check_type_assignable_to_and_optionally_elaborate(
            ty,
            expected,
            Some(error_node),
            Some((file, e)),
            true,
            None,
            None,
        );
    }

    /// `checkTypeAssignableToAndOptionallyElaborate` for a caller that reads back the reported
    /// diagnostics.
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
    ) -> bool {
        let (at, expr, mut diags) = ((file, at, end), e.some().map(|e| (file, e)), Vec::new());
        let head = Some(head).filter(|&head| head != 2322);
        let output = Some(&mut diags);
        let is_assignable = self.check_type_assignable_to_and_optionally_elaborate(
            source,
            target,
            Some(at),
            expr,
            false,
            head,
            output,
        );
        self.put_out(diags);
        is_assignable
    }

    // ───────────────────────────── further in ─────────────────────────────

    /// `checkTypeAssignableToAndOptionallyElaborate`. `is_effective`: `expr` is the result of
    /// `getEffectiveCheckNode`, so its enclosing parentheses are not part of it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn check_type_assignable_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        expr: Option<(FileId, ExprId)>,
        is_effective: bool,
        head_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let is_related = self.try_is_type_related_to(source, target, Relation::Assignable, false);
        match is_related {
            Ok(true) => return true,
            Ok(false) if error_node.is_none() => return false,
            Ok(false) => {
                let output = diagnostic_output.as_deref_mut();
                if let Some((file, e)) = expr
                    && self.elaborate_error(
                        file,
                        e,
                        is_effective,
                        source,
                        target,
                        head_message,
                        output,
                    )
                {
                    return false;
                }
            }
            // The overflow is reported instead of the relation error. The pair is not compared again to elaborate.
            Err(_) => {}
        }
        let output = diagnostic_output.as_deref_mut();
        let is_assignable =
            self.check_type_assignable_to_ex(source, target, error_node, head_message, output);
        // `isTypeRelatedTo` already hit the overflow, with no node to report it on but
        // `c.currentNode`: the assignment.
        if let Err(code) = is_related
            && let Some((file, e)) = expr
            && let Parent::Expr(whole) = self.bound(file).expr_parent[e.idx()]
            && whole.is_some()
            && matches!(self.hir(file)[whole].kind, ExprKind::Assign { value, .. } if value == e)
        {
            let start = self.start_inside_parentheses(file, whole);
            let at = (file, start, self.end_inside_parentheses(file, whole));
            let diagnostic = self.new_diagnostic(at, code, &[Arg::Type(source), Arg::Type(target)]);
            self.report_diagnostic(diagnostic, diagnostic_output);
        }
        is_assignable
    }

    /// The diagnostics collected in a `diagnosticOutput`.
    fn put_out(&mut self, reported: Vec<Reported>) {
        self.reported.extend(reported);
    }

    /// `elaborateError`: moves the error that `e`, of type `source`, is not assignable to `target`
    /// to the offending part of `e`.
    /// `is_effective`: `e` is the result of `getEffectiveCheckNode`, so its enclosing parentheses
    /// are not part of it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn elaborate_error(
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
        // `elaborateDidYouMeanToCallOrConstruct`: the result of calling it is assignable.
        for construct in [true, false] {
            let mut would_do = false;
            for sig in self.signatures(source, construct) {
                let returned = self.sig_return(sig);
                if !self.is_any(returned)
                    && !returned.is_never()
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
        let next = match hir[e].kind {
            // `x as const` is elaborated through its operand. `<const>x` is not.
            ExprKind::AsConst(inner) if hir.kind(hir.node(e)) == Kind::AsExpression => inner,
            ExprKind::Assign {
                op: None,
                value: right,
                ..
            }
            | ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => right,
            ExprKind::Object(props) => {
                return self.elaborate_object_literal(
                    file,
                    props,
                    source,
                    target,
                    diagnostic_output,
                );
            }
            ExprKind::Array(items) => {
                return self.elaborate_array_literal(
                    file,
                    items,
                    source,
                    target,
                    diagnostic_output,
                );
            }
            ExprKind::Fn(func) if hir[func].kind == FnKind::Arrow => {
                return self.elaborate_arrow_function(
                    file,
                    func,
                    source,
                    target,
                    diagnostic_output,
                );
            }
            _ => return false,
        };
        self.elaborate_error(
            file,
            next,
            false,
            source,
            target,
            head_message,
            diagnostic_output,
        )
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
        // It is checked as the tuple of its elements.
        let source = if self.is_tuple(source) {
            source
        } else {
            match self.forced_tuple(file, items, false) {
                Some(tuple) if self.is_tuple(tuple) => tuple,
                // `[...xs]` is an array type even when checked as a tuple.
                _ => return false,
            }
        };
        // A tuple-like type does not constrain the indexes it has no property for. Not checked for
        // a union, where the index signature of one member substitutes for the property of another
        // (`createUnionOrIntersectionProperty`).
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

    /// `checkArrayLiteral` with `CheckModeForceTuple`: the literal as the tuple of its elements.
    /// `None`: unknown.
    /// `is_spread`: it is spread into another literal, so its elements have no contextual type.
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
                    // The spread operand is checked in the same mode.
                    let spread = match hir[inner].kind {
                        ExprKind::Array(inner_items) => {
                            self.forced_tuple(file, inner_items, true)?
                        }
                        _ => self.type_of_expr(file, inner),
                    };
                    if self.is_array_like(spread) {
                        elems.push(spread);
                        flags.push(ElemFlags::VARIADIC);
                    } else {
                        // `checkIteratedTypeOrElementType`
                        let element = self.iterated_type(spread, false);
                        elems.push(element);
                        flags.push(ElemFlags::REST);
                    }
                }
                // The check mode propagates to the elements.
                ExprKind::Array(inner_items) if !self.is_const_context(file, item) => {
                    elems.push(self.forced_tuple(file, inner_items, is_spread)?);
                    flags.push(ElemFlags::REQUIRED);
                }
                _ => {
                    // `checkExpressionForMutableLocation`: a literal type is preserved only where
                    // the contextual type expects one.
                    let ty = self.type_of_expr(file, item);
                    elems.push(if is_spread {
                        self.widen_literal_for_context(ty, None)
                    } else if self.is_const_context(file, item) {
                        self.regular(ty)
                    } else if matches!(hir[item].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
                        ty
                    } else {
                        let expected = self.contextual_type(file, item, ContextFlags::empty());
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
        // The symbol cannot be recovered from a symbol name.
        if self.atoms().is_symbol_name(name) {
            return self.type_of_property(ty, name);
        }
        // `isNumericLiteralName`: a name that is the string form of a number.
        let key = match crate::atom::parse_number(self.atoms().bytes(name)) {
            Some(n) if self.number_name(n) == name => self.number_literal(n, false),
            _ => self.string_literal(name, false),
        };
        self.indexed_access_if_any(ty, key, false)
    }

    /// `elaborateElement`: the property or the element is at `prop`, `next` is its value if it has
    /// one to elaborate into.
    /// `is_effective`: `next` is the result of `getEffectiveCheckNode`, so its enclosing
    /// parentheses are not part of it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn elaborate_element(
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
        // The property type of a generic object type is deferred: there is nothing to elaborate
        // into.
        if self.is_generic_object_type(target) {
            return false;
        }
        // `getBestMatchIndexedAccessTypeOrUndefined`
        let expected = match self.indexed_access_by_name(target, name) {
            Some(expected) => expected,
            None if self.is_union(target) => {
                let Some(best) = self.best_matching_type(source, target) else {
                    return false;
                };
                let Some(expected) = self.indexed_access_by_name(best, name) else {
                    return false;
                };
                expected
            }
            None => return false,
        };
        if matches!(self.data(expected), TypeData::IndexedAccess { .. }) {
            return false;
        }
        let Some(actual) = self.indexed_access_by_name(source, name) else {
            return false;
        };
        if self.is_assignable(actual, expected) {
            return false;
        }
        let output = diagnostic_output.as_deref_mut();
        if next.is_some()
            && self.elaborate_error(file, next, is_effective, actual, expected, None, output)
        {
            return true;
        }
        // `checkExpressionForMutableLocationWithContextualType`: the type of the expression there,
        // checked with `actual` as its contextual type.
        let actual = if next.is_some() {
            let written = match self.hir(file)[next].kind {
                // `checkSpreadExpression`
                ExprKind::Spread(inner) => {
                    let spread = self.type_of_expr(file, inner);
                    self.iterated_type(spread, false)
                }
                _ => self.type_of_expr(file, next),
            };
            let specific = if self.is_const_context(file, next) {
                self.regular(written)
            } else if matches!(
                self.hir(file)[next].kind,
                ExprKind::As { .. } | ExprKind::AsConst(_)
            ) {
                written
            } else {
                self.widen_literal_for_context(written, Some(actual))
            };
            if self.is_assignable(specific, expected) {
                actual
            } else {
                specific
            }
        } else {
            actual
        };
        let apparent = self.apparent_type(target);
        let target_is_optional = self
            .prop_of(apparent, name)
            .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL));
        let mut diags = Vec::new();
        if target_is_optional && self.is_exact_optional_property_mismatch(actual, target, name) {
            diags.push(self.new_diagnostic(prop, 2412, &[Arg::Type(actual), Arg::Type(expected)]));
        } else {
            // An optional property is not treated as including `undefined`.
            let expected =
                if target_is_optional && self.p.files.options.exact_optional_property_types {
                    self.without_undefined(expected)
                } else {
                    expected
                };
            let output = Some(&mut diags);
            self.check_type_assignable_to_ex(actual, expected, Some(prop), error_message, output);
        }
        let Some(mut diagnostic) = diags.pop() else {
            return false;
        };
        let related = self.expected_property(target, name);
        diagnostic
            .related_information
            .extend(related.filter(|related| related.file != NOWHERE.0));
        self.report_diagnostic(diagnostic, diagnostic_output);
        true
    }

    /// `isExactOptionalPropertyMismatch`, under exactOptionalPropertyTypes: `actual` may be
    /// `undefined`, and the optional property `name` of `target` is not declared to accept it
    /// (`containsMissingType`).
    fn is_exact_optional_property_mismatch(
        &mut self,
        actual: TypeId,
        target: TypeId,
        name: Atom,
    ) -> bool {
        self.p.files.options.exact_optional_property_types
            && self.some_type(actual, |_, m| m.is_undefined())
            && super::errors_operators::exact_optional_write_type(self, target, name)
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
        for prop in &self.properties_of_type(target) {
            if prop.flags.contains(PropFlags::OPTIONAL)
                && let Some(actual) = self.type_of_property(source, prop.name)
                && self.is_exact_optional_property_mismatch(actual, target, prop.name)
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
        // In `CompareTypes` order: ties are decided by which comes first, or last.
        let parts = self.parts(target);
        // `findMatchingTypeReferenceOrTypeAliasReference`
        if let TypeData::Ref { target: declared, .. } = *self.data(source)
            && let Some(&same) = parts.iter().find(|&&t| matches!(*self.data(t), TypeData::Ref { target: other, .. } if other == declared))
        {
            return Some(same);
        }
        // Tuples with the same shape are references to the same target type.
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
        // `findMostOverlappyType`. `keyof T` is an instantiable primitive
        // (`TypeFlagsInstantiablePrimitive`).
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
            // Among equal matches the last wins.
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
        let expected = self.signatures(target, false);
        if expected.is_empty() {
            return false;
        }
        let actual = self.sig_return(sig);
        let mut all = TypeId::NEVER;
        for w in expected {
            let returned = self.sig_return(w);
            all = self.union(&[all, returned]);
        }
        if self.is_assignable(actual, all) {
            return false;
        }
        let output = diagnostic_output.as_deref_mut();
        if self.elaborate_error(file, body, false, actual, all, None, output) {
            return true;
        }
        let at = (
            file,
            self.start_of(file, body),
            self.error_end_of(file, body),
        );
        let mut diags = Vec::new();
        self.check_type_assignable_to_ex(actual, all, Some(at), None, Some(&mut diags));
        let Some(mut diagnostic) = diags.pop() else {
            return false;
        };
        let related = self.related_info_for_expected_return_type(file, func, actual, target, all);
        let related = related.into_iter();
        diagnostic
            .related_information
            .extend(related.filter(|related| related.file != NOWHERE.0));
        self.report_diagnostic(diagnostic, diagnostic_output);
        true
    }

    /// The end of `elaborateArrowFunction`. `actual`: the return type of the arrow function `func`.
    /// `expected`: the return type of the signatures of `target`.
    fn related_info_for_expected_return_type(
        &mut self,
        file: FileId,
        func: FnId,
        actual: TypeId,
        target: TypeId,
        expected: TypeId,
    ) -> Vec<Reported> {
        let mut related = Vec::new();
        if let Some(signature) = self.first_declaration_of_type_symbol(target) {
            related.push(Reported::bare(signature, 6502));
        }
        if !self.hir(file)[func].flags.contains(Flags::ASYNC)
            && self.type_of_property(actual, known::then).is_none()
        {
            // The comparisons made here are independent of the comparison being reported.
            let too_complex = self.relation_too_complex;
            // `createPromiseType`
            let unwrapped = self.map_type(actual, |c, m| c.awaited_argument(m).unwrap_or(m));
            let awaited = self.awaited_no_alias(unwrapped).unwrap_or(TypeId::UNKNOWN);
            let promise = self.promise_of(awaited);
            let is_intended_to_be_async = self.is_assignable(promise, expected);
            self.relation_too_complex = too_complex;
            if is_intended_to_be_async {
                let (start, end) = self.error_range_of_fn(file, func);
                related.push(Reported::bare((file, start, end), 1356));
            }
        }
        related
    }

    // ───────────────────────────── diagnostics ─────────────────────────────

    /// `checkTypeRelatedToEx(source, target, relation, errorNode, headMessage)` for two types that
    /// the caller has found not to be related: reports the same diagnostic and returns it. `at`,
    /// `end`: the span of `errorNode` in `file`.
    pub(super) fn report_not_assignable_with_end(
        &mut self,
        file: FileId,
        source: TypeId,
        target: TypeId,
        at: u32,
        end: u32,
        head: u32,
    ) -> Option<(u32, u32)> {
        // 2678 is what `reportRelationError` reports without a head message under the comparable
        // relation.
        let relation = if head == 2678 {
            Relation::Comparable
        } else {
            Relation::Assignable
        };
        let place = (file, at, end);
        let (is_related, diagnostic) =
            self.relation_diagnostic(source, target, relation, place, Some(head));
        let diagnostic = match diagnostic {
            // The caller used a different relation: there is no elaboration to give.
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
        let code = first.code;
        let mut diagnostic = Reported::new((file, start, end), code, first.args);
        super::explain::add_lines(&mut diagnostic.message_chain, lines);
        diagnostic.related_information = related;
        self.add_diagnostic(diagnostic);
        Some((start, code))
    }

    /// The conditions of `getSingleBaseForNonAugmentingSubtype` that depend only on the
    /// declarations of the class or interface `target`: the symbol has no members, and the
    /// expression a class extends is a plain identifier.
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
                    // Only a plain identifier is guaranteed not to refer back to the class.
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

    /// Whether `getTypeWithThisArgument` changes `ty`: a reference with a `this` type to
    /// instantiate, or an intersection with such a member.
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

    /// Whether the declared type of the class or interface `sym` is a type reference, one with a
    /// `this` type (`getDeclaredTypeOfClassOrInterface`): all are, except interfaces without type
    /// parameters, own or outer, that are guaranteed not to reference `this`
    /// (`isThislessInterface`).
    pub(super) fn is_declared_as_reference(&mut self, sym: Sym, depth: u32) -> bool {
        use crate::bind::Decl;
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
            // Its base types must be interfaces that are themselves not declared as references.
            for node in hir.ids(hir[i].extends) {
                let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                    continue;
                };
                let names: Vec<Atom> = hir.texts(name).collect();
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
