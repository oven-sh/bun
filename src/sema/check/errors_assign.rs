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
/// `...` is not a tuple type node, and neither is a `ParenthesizedType`, so unwrapping stops there. A plain type node is returned as an
/// element without any of those. `conditional`: the node that `check` and `extends` are parts of.
fn unwrap_unary_tuples(
    hir: &hir::File,
    conditional: TypeNodeId,
    check: TypeNodeId,
    extends: TypeNodeId,
) -> (TupleElem, TupleElem) {
    let plain = |ty: TypeNodeId| TupleElem {
        ty,
        written: ty,
        member_type: TupleMemberType::Plain,
        name: Atom::NONE,
        optional: false,
        rest: false,
        has_dots: false,
        start: hir[ty].pos,
        end: hir[ty].end,
    };
    // Whether `elem`, a part of `parent`, is just a type node.
    let is_plain = |elem: &TupleElem, parent: TypeNodeId| {
        elem.ty.is_some()
            && elem.name.is_none()
            && !elem.optional
            && !elem.rest
            && super::spans::Spans::of(hir)
                .parens_before(hir[parent].pos as usize, hir[elem.ty].pos as usize)
                .next()
                .is_none()
    };
    let (mut check, mut extends) = (plain(check), plain(extends));
    let (mut parent_of_check, mut parent_of_extends) = (conditional, conditional);
    while is_plain(&check, parent_of_check)
        && is_plain(&extends, parent_of_extends)
        && let (TypeNodeKind::Tuple(a), TypeNodeKind::Tuple(b)) =
            (hir[check.ty].kind, hir[extends.ty].kind)
        && a.len() == 1
        && b.len() == 1
    {
        (parent_of_check, parent_of_extends) = (check.ty, extends.ty);
        check = hir[a.at(0)];
        extends = hir[b.at(0)];
    }
    (check, extends)
}

/// `inReturnStatement` of `checkReturnExpression`: its `node` is a `return` statement and not the
/// expression body of a function.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum InReturnStatement {
    No,
    Yes,
}

/// `inConditionalExpression` of `checkReturnExpression`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum InConditionalExpression {
    No,
    Yes,
}

impl Checker<'_, '_> {
    pub(super) fn check_assignments(&mut self, file: FileId) {
        let hir = self.hir(file);
        let bound = self.bound(file);
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
            let at = self.span_of_parenthesized_expr(file, e);
            self.check_initializer(file, e, target, at);
        }
        let by_kind = self.exprs_by_kind(file);
        self.check_assignments_among(file, by_kind.of(ExprTag::Assign), None);
    }

    /// `checkAssignmentOperator` for those of `assignments` that are `target = value`: the
    /// comparison. `check_plain_assignment` has the reference check.
    /// `right_type`: `checkExpression(right)`, where the caller has it.
    pub(super) fn check_assignments_among(
        &mut self,
        file: FileId,
        assignments: &[ExprId],
        right_type: Option<TypeId>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &assignment in assignments {
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
            // `checkReferenceExpression`: only the invalid target is reported.
            if super::errors_operators::why_no_reference(hir, target, 2364, 2779).is_some() {
                continue;
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
            let source = match right_type {
                Some(right_type) => right_type,
                None => self.type_of_expr(file, value),
            };
            // `checkAssignmentOperator`: `undefined` assigned to a CommonJS export with more than one declaration is not checked. The
            // declarations counted are those of the symbol the left side resolves to.
            if source.is_undefined()
                && let crate::bind::JsDeclarationKind::ExportsProperty(name) =
                    crate::bind::assignment_declaration_kind(hir, ExprId(i as u32))
                && let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[target].kind
            {
                let object = self.type_of_expr(file, obj);
                let object = self.apparent_type(object);
                if let Some((prop, _)) = self.prop_ref(object, name)
                    && let PropSource::Symbol(sym) = prop.source
                    && self.files().decls(sym).len() > 1
                {
                    continue;
                }
            }
            let head = self.exact_optional_head_message(file, target, source);
            self.check_assignable_with_end(
                file,
                source,
                left,
                self.start_of(file, target),
                self.end_of_expr(file, target),
                value,
                head.unwrap_or(2322),
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
        let stmt = bound.var_stmt[d.idx()];
        if decl.init.is_none() || stmt.is_none() {
            return;
        }
        // FOR SPEED: without an annotation the type of the variable is the widened type of the
        // initializer, except in a `for`-`of`, where it is the type of the elements.
        if decl.ty.is_none()
            && !matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForOf { left, .. } if left == stmt))
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
        let target = self.type_of_pat(file, decl.pat);
        let target = self.convert_auto_to_any(target);
        let source = self.type_of_expr(file, decl.init);
        // `getESSymbolLikeTypeForNode`, `isValidESSymbolDeclaration`: for a `const` with an
        // identifier name, in a statement of its own.
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
                self.push_contextual_type(file, default, Some(implied), false);
                self.check_literals_expected_by_pattern(file, default);
                self.pop_contextual_type();
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
        if member.kind != MemberKind::Property || member.init.is_none() {
            return;
        }
        // `bindClassLikeDeclaration`: a static `prototype` is a declaration of the `prototype`
        // symbol of the class, whose type is `getTypeOfPrototypeProperty` whatever the annotation.
        if member.flags.contains(Flags::STATIC)
            && !member.flags.contains(Flags::ACCESSOR)
            && member.key == PropKey::Name(known::prototype)
            && let crate::bind::MemberOwner::Class(c) = self.bound(file).member_owner[m.idx()]
        {
            let symbol = self.symbol_of_member(file, m);
            let own = Some((file, crate::bind::Decl::Member(m)));
            let class = self.class_sym(file, c);
            let constructor = self.type_of_symbol(class);
            if self.files().value_declaration(symbol) == own
                && let Some(target) = self.type_of_property(constructor, known::prototype)
            {
                let at = (file, member.name_pos, self.end_of_member_name(file, m));
                self.check_initializer(file, member.init, target, at);
            }
            return;
        }
        // The initializer of `symbol.ValueDeclaration` is compared with `getTypeOfSymbol`, which is
        // `getTypeOfAccessors` for a property that shares its symbol with accessors.
        if self.bound(file).member_symbol[m.idx()].is_some() {
            let symbol = self.symbol_of_member(file, m);
            let flags = self.files().flags(symbol);
            let own = Some((file, crate::bind::Decl::Member(m)));
            if flags.contains(SymFlags::PROPERTY)
                && flags.intersects(SymFlags::ACCESSOR)
                && self.files().value_declaration(symbol) == own
            {
                let target = self.type_of_symbol(symbol);
                let at = (file, member.name_pos, self.end_of_member_name(file, m));
                self.check_initializer(file, member.init, target, at);
                return;
            }
        }
        if member.ty.is_none() {
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
        let resolved = self.type_of_pat(file, param.pat);
        let func = bound.param_fn[p.idx()];
        if !matches!(hir[param.pat].kind, PatKind::Object(_) | PatKind::Array(_)) {
            return resolved;
        }
        // A binding pattern is compared with `getWidenedTypeForVariableLikeDeclaration`, not with the type of a symbol.
        // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` checks the parameters the first time the function is checked, so
        // `getContextuallyTypedParameterType` sees the callee's signature before its type arguments are inferred. The adjustments of
        // `assignContextualParameterTypes` and `assignParameterType` only reach the symbol's type.
        let index = (p.0 - hir[func].params.start) as usize;
        let Some(ty) = self.contextual_param_type(file, func, index) else {
            return resolved;
        };
        let ty = if is_optional { self.optional(ty) } else { ty };
        self.widened_for_declaration(ty, None)
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
        let (file, setter) = self.sibling_accessor(file, getter, FnKind::Setter)?;
        let hir = self.hir(file);
        let node = hir[setter].effective_set_accessor_type_annotation_node(hir);
        node.is_some().then(|| self.type_from_node(file, node))
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
        let asserted = self.type_from_node(file, ty);
        let actual = self.base_of_literal(actual);
        let widened = self.widened(actual);
        if self.is_comparable(asserted, widened) {
            return;
        }
        let actual = self.regular_type_of_object_literal(actual);
        if self.is_comparable(actual, asserted) {
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
        self.check_type_comparable_to(actual, asserted, Some((file, at, end)), Some(2352));
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
            if prop.key == PropKey::None {
                continue;
            }
            // `getSymbolOfDeclaration`
            let name = self.declared_member_name(file, prop.key);
            // `getPropertyOfType`: the properties common to all objects are included.
            if !name.is_some_and(|name| self.property_in_type(context, &members, name).is_some()) {
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

    /// FOR SPEED: `check_type_reference_or_import` has run for `node` since `check_file` began, has
    /// reported nothing, and has read nothing provisional. A type node in an expression is checked
    /// by `look_at_type_node` and again by the walk.
    #[inline]
    fn is_type_reference_checked(&self, file: FileId, node: TypeNodeId) -> bool {
        let (of, bits) = &self.checked_type_references;
        *of == Some(file)
            && (bits.get(node.idx() / 64)).is_some_and(|word| word >> (node.idx() % 64) & 1 != 0)
    }

    fn note_type_reference_checked(&mut self, file: FileId, node: TypeNodeId) {
        if self.task.file != Some(file) {
            return;
        }
        let (of, bits) = &mut self.checked_type_references;
        if *of != Some(file) {
            *of = Some(file);
            bits.clear();
        }
        let at = node.idx() / 64;
        if bits.len() <= at {
            bits.resize(at + 1, 0);
        }
        bits[at] |= 1 << (node.idx() % 64);
    }

    /// `checkTypeReferenceOrImport`
    pub(super) fn check_type_reference_or_import(&mut self, file: FileId, node: TypeNodeId) {
        if self.is_type_reference_checked(file, node) {
            return;
        }
        let before = (self.reported.len(), self.taints, self.non_cacheable_mark());
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
                // `getResolvedSymbolOrNil`
                let scope = self.bound(file).type_scope[node.idx()];
                (
                    args,
                    self.resolve_type_reference_name(file, scope, name, true),
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
            self.check_type_argument_constraints(file, args, &type_parameters, None);
        }
        if before == (self.reported.len(), self.taints, self.non_cacheable_mark())
            && self.serialization_level == 0
        {
            self.note_type_reference_checked(file, node);
        }
    }

    /// `checkTypeArgumentConstraints`: 2344, or a more specific error. `sig`: the signature that
    /// has `type_parameters`, see `mapper_around_sig`. `None` for those of a type.
    fn check_type_argument_constraints(
        &mut self,
        file: FileId,
        nodes: IdList<TypeNodeId>,
        type_parameters: &[TypeId],
        sig: Option<SigId>,
    ) -> bool {
        let hir = self.hir(file);
        let outer = sig.map_or(MapperId::IDENTITY, |sig| self.mapper_around_sig(sig));
        let mut effective: Option<(Vec<TypeId>, MapperId)> = None;
        let mut result = true;
        for (i, &type_parameter) in type_parameters.iter().enumerate() {
            let Some(constraint) = self.constraint_of_type_param(type_parameter) else {
                continue;
            };
            if !result {
                continue;
            }
            let (type_arguments, mapper) = effective.get_or_insert_with(|| {
                // `getEffectiveTypeArguments`
                let actual = self.types_from_nodes(file, nodes);
                let filled = match sig {
                    Some(sig) => {
                        self.fill_sig_type_args_as(sig, type_parameters, &actual, hir.is_js)
                    }
                    None => self.fill_type_args_as(type_parameters, &actual, hir.is_js),
                };
                let mapper = self.mapper_from(type_parameters, &filled);
                (filled, mapper)
            });
            let (argument, mapper) = (type_arguments[i], *mapper);
            let constraint = self.filled_in_around(type_parameter, constraint, outer);
            let constraint = self.instantiate(constraint, mapper);
            // A default has no node, and nothing is reported for it.
            let error_node = (i < nodes.len()).then(|| {
                let node: TypeNodeId = hir.id_at(nodes, i);
                let start = start_of_type(hir, node);
                (file, start, self.end_of_type_node_from(file, node, start))
            });
            result = self.check_type_assignable_to(argument, constraint, error_node, Some(2344));
        }
        result
    }

    /// `checkClassLikeDeclaration`: the type arguments of `extends Base<Args>`, checked against
    /// each construct signature of `Base` that accepts that many.
    pub(super) fn check_type_arguments_of_base(&mut self, file: FileId, class: ClassId, sym: Sym) {
        let nodes = self.hir(file)[class].extends_args;
        if nodes.is_empty() || self.base_types(sym).is_empty() {
            return;
        }
        let constructor = self.base_constructor_type_of_class(sym);
        let apparent = self.apparent_type(constructor);
        // `getConstructorsForTypeArguments`
        for sig in self.signatures(apparent, true) {
            let type_parameters = self.sig_type_params(sig);
            if nodes.len() < self.min_type_argument_count(&type_parameters)
                || nodes.len() > type_parameters.len()
            {
                continue;
            }
            if !self.check_type_argument_constraints(file, nodes, &type_parameters, Some(sig)) {
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
            // `getConstraintTypeFromMappedType`: the error type, if the constraint is circular.
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
                && let Some(constraint) = self.implied_constraint(file, ty, parent, check, extends)
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

    /// `getImpliedConstraint` for `CheckType` and `ExtendsType` of the node `conditional`.
    fn implied_constraint(
        &mut self,
        file: FileId,
        ty: TypeId,
        conditional: TypeNodeId,
        check: TypeNodeId,
        extends: TypeNodeId,
    ) -> Option<TypeId> {
        let (check, extends) = unwrap_unary_tuples(self.hir(file), conditional, check, extends);
        let checked = self.type_from_tuple_element(file, check);
        (self.actual_type_variable(checked) == self.actual_type_variable(ty))
            .then(|| self.type_from_tuple_element(file, extends))
    }

    /// `getTypeFromTypeNode` of a tuple element: `getTypeFromOptionalTypeNode`, `getTypeFromRestTypeNode`,
    /// `getTypeFromNamedTupleTypeNode`.
    pub(super) fn type_from_tuple_element(&mut self, file: FileId, elem: TupleElem) -> TypeId {
        if elem.has_dots {
            let element = super::errors_type_nodes::rest_element_type_node(self.hir(file), &elem);
            return self.type_from_node(file, element.unwrap_or(elem.ty));
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

    /// `GetErrorRangeForNode` for `e`, the result of `getEffectiveCheckNode`: its enclosing
    /// parentheses are not part of it, except those of a JSDoc type assertion.
    pub(super) fn place_of_effective_check_node(&self, file: FileId, e: ExprId) -> Place {
        match self.range_of_jsdoc_type_assertion(file, e) {
            Some((open, end)) => (file, open, end),
            None => self.place_of_expr(file, e),
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
                    self.check_return_expression(
                        file,
                        container,
                        expected,
                        node,
                        InReturnStatement::Yes,
                        e,
                        InConditionalExpression::No,
                    );
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
            self.check_return_expression(
                file,
                container,
                expected,
                node,
                InReturnStatement::No,
                body,
                InConditionalExpression::No,
            );
        }
    }

    /// `getReturnTypeFromAnnotation`: a constructor is to return an instance of its class. A getter
    /// without an annotation uses its setter's parameter type, any other function the signature of
    /// its `@type` tag.
    pub(super) fn return_type_from_annotation(&mut self, file: FileId, f: FnId) -> Option<TypeId> {
        let func = &self.hir(file)[f];
        if func.kind == FnKind::Constructor
            && let FnOwner::Member(m) = self.bound(file).fns[f.idx()].owner
            && let crate::bind::MemberOwner::Class(class) = self.bound(file).member_owner[m.idx()]
        {
            let sym = self.class_sym(file, class);
            return Some(self.declared_type(sym));
        }
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
    fn check_return_expression(
        &mut self,
        file: FileId,
        container: FnId,
        expected: TypeId,
        node: Place,
        in_return_statement: InReturnStatement,
        e: ExprId,
        in_conditional_expression: InConditionalExpression,
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
                    InConditionalExpression::Yes,
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
        let e = self.effective_check_node(file, e);
        let error_node = if in_return_statement == InReturnStatement::Yes
            && in_conditional_expression == InConditionalExpression::No
        {
            node
        } else {
            self.place_of_effective_check_node(file, e)
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
    pub(super) fn check_type_assignable_to_and_optionally_elaborate(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        expr: Option<(FileId, ExprId)>,
        is_effective: bool,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let is_outermost = self.begin_comparison(error_node);
        let is_assignable = self.check_type_assignable_to_and_optionally_elaborate_worker(
            source,
            target,
            error_node,
            expr,
            is_effective,
            head_message,
            diagnostic_output,
        );
        self.end_comparison(is_outermost);
        is_assignable
    }

    fn check_type_assignable_to_and_optionally_elaborate_worker(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        expr: Option<(FileId, ExprId)>,
        is_effective: bool,
        head_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let relation = Relation::Assignable;
        let is_related = self.try_is_type_related_to(source, target, relation, false);
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
    pub(super) fn elaborate_error(
        &mut self,
        file: FileId,
        e: ExprId,
        is_effective: bool,
        source: TypeId,
        target: TypeId,
        head_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let hir = self.hir(file);
        if self.is_or_has_generic_conditional(target) {
            return false;
        }
        let node = if is_effective {
            self.place_of_effective_check_node(file, e)
        } else {
            self.span_of_parenthesized_expr(file, e)
        };
        let output = diagnostic_output.as_deref_mut();
        if self.elaborate_did_you_mean_to_call_or_construct(
            node,
            source,
            target,
            head_message,
            output,
        ) {
            return true;
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
                    e,
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

    /// `elaborateDidYouMeanToCallOrConstruct`, for `SignatureKindConstruct` and then for
    /// `SignatureKindCall`: the result of calling `node` is assignable.
    pub(super) fn elaborate_did_you_mean_to_call_or_construct(
        &mut self,
        node: Place,
        source: TypeId,
        target: TypeId,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
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
            let mut diags = Vec::new();
            let output = Some(&mut diags);
            if !self.check_type_assignable_to_ex(source, target, Some(node), head_message, output)
                && let Some(mut diagnostic) = diags.pop()
            {
                let code = if construct { 6213 } else { 6212 };
                diagnostic.add_related_info(self.new_diagnostic(node, code, &[]));
                self.report_diagnostic(diagnostic, diagnostic_output);
                return true;
            }
        }
        false
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
        if self.flags(target) & (tf::PRIMITIVE | tf::NEVER) != 0 {
            return false;
        }
        let hir = self.hir(file);
        let mut reported = false;
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                continue;
            }
            // `getLiteralTypeFromProperty(.., TypeFlagsStringOrNumberLiteralOrUnique)`
            let name_type = self.literal_type_from_property_name(file, prop.key, prop.name_kind);
            let Some(name_type) = name_type.filter(|&it| self.property_name_of_type(it).is_some())
            else {
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
                self.elaborate_element(source, target, at, next, false, name_type, message, output);
        }
        reported
    }

    /// `elaborateArrayLiteral`
    fn elaborate_array_literal(
        &mut self,
        file: FileId,
        node: ExprId,
        items: IdList<ExprId>,
        mut source: TypeId,
        target: TypeId,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        if self.flags(target) & (tf::PRIMITIVE | tf::NEVER) != 0 {
            return false;
        }
        let hir = self.hir(file);
        if !self.is_tuple_like(source) {
            // The mode reaches the arrays in it, also through the object literals in it.
            let mode = CheckMode::FORCE_TUPLE;
            source = self.check_expression_with_contextual_type(file, node, target, None, mode);
            // `[...xs]` is an array type even when checked as a tuple.
            if !self.is_tuple_like(source) {
                return false;
            }
        }
        // A tuple-like type does not constrain the indexes it has no property for.
        let is_tuple_like = self.is_tuple_like(target);
        let mut reported = false;
        for (i, item) in hir.ids(items).enumerate() {
            let (name, name_type) = (
                self.number_name(i as f64),
                self.number_literal(i as f64, false),
            );
            if matches!(hir[item].kind, ExprKind::Missing)
                || is_tuple_like && self.get_property_of_type(target, name).is_none()
            {
                continue;
            }
            let check_node = self.effective_check_node(file, item);
            let at = self.place_of_effective_check_node(file, check_node);
            let output = diagnostic_output.as_deref_mut();
            reported |= self.elaborate_element(
                source, target, at, check_node, true, name_type, None, output,
            );
        }
        reported
    }

    /// `elaborateElement`: the property or the element is at `prop`, `next` is its value if it has
    /// one to elaborate into.
    /// `is_effective`: `next` is the result of `getEffectiveCheckNode`, so its enclosing
    /// parentheses are not part of it.
    pub(super) fn elaborate_element(
        &mut self,
        source: TypeId,
        target: TypeId,
        prop: Place,
        next: ExprId,
        is_effective: bool,
        name_type: TypeId,
        error_message: Option<u32>,
        mut diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let file = prop.0;
        // `getPropertyNameFromIndex`: every caller passes a type that names a property.
        let Some(name) = self.property_name_of_type(name_type) else {
            return false;
        };
        let Some(mut target_prop_type) =
            self.get_best_match_indexed_access_type_or_undefined(source, target, name_type)
        else {
            return false;
        };
        // "Don't elaborate on indexes on generic variables"
        if matches!(self.data(target_prop_type), TypeData::IndexedAccess { .. }) {
            return false;
        }
        let Some(mut source_prop_type) = self.indexed_access_if_any(source, name_type, false)
        else {
            return false;
        };
        if self.is_assignable(source_prop_type, target_prop_type) {
            return false;
        }
        let output = diagnostic_output.as_deref_mut();
        if next.is_some()
            && self.elaborate_error(
                file,
                next,
                is_effective,
                source_prop_type,
                target_prop_type,
                None,
                output,
            )
        {
            return true;
        }
        let specific_source = if next.is_some() {
            self.check_expression_for_mutable_location_with_contextual_type(
                file,
                next,
                source_prop_type,
            )
        } else {
            source_prop_type
        };
        let mut diags = Vec::new();
        if self.is_exact_optional_property_mismatch(specific_source, target_prop_type) {
            let args = [Arg::Type(specific_source), Arg::Type(target_prop_type)];
            diags.push(self.new_diagnostic(prop, 2412, &args));
        } else {
            let is_optional = |c: &mut Self, ty: TypeId| {
                c.get_property_of_type(ty, name)
                    .is_some_and(|(p, _)| p.flags.contains(PropFlags::OPTIONAL))
            };
            let target_is_optional = is_optional(self, target);
            let source_is_optional = is_optional(self, source);
            target_prop_type = self.remove_missing_type(target_prop_type, target_is_optional);
            source_prop_type = self
                .remove_missing_type(source_prop_type, target_is_optional && source_is_optional);
            let is_related = self.check_type_assignable_to_ex(
                specific_source,
                target_prop_type,
                Some(prop),
                error_message,
                Some(&mut diags),
            );
            if is_related && specific_source != source_prop_type {
                self.check_type_assignable_to_ex(
                    source_prop_type,
                    target_prop_type,
                    Some(prop),
                    error_message,
                    Some(&mut diags),
                );
            }
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

    /// `checkExpressionForMutableLocationWithContextualType`
    pub(super) fn check_expression_for_mutable_location_with_contextual_type(
        &mut self,
        file: FileId,
        next: ExprId,
        source_prop_type: TypeId,
    ) -> TypeId {
        let kind = self.hir(file)[next].kind;
        let ty = match kind {
            // `checkSpreadExpression`
            ExprKind::Spread(inner) => {
                let spread = self.type_of_expr(file, inner);
                self.iterated_type_of_spread(spread)
            }
            _ => {
                let mode = CheckMode::empty();
                self.check_expression_with_contextual_type(file, next, source_prop_type, None, mode)
            }
        };
        if self.is_const_context(file, next) {
            self.regular(ty)
        } else if matches!(kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
            ty
        } else {
            self.widen_literal_for_context(ty, Some(source_prop_type))
        }
    }

    /// `isExactOptionalPropertyMismatch`. Only exactOptionalPropertyTypes has a missing type.
    pub(super) fn is_exact_optional_property_mismatch(
        &self,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        self.maybe_type_of_kind(source, |_, t| t.is_undefined())
            && self.contains_missing_type(target)
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
        for prop in self.properties_of_type(target) {
            if let Some(of_source) = self.type_of_property_of_type(source, prop.name)
                && let Some(of_target) = self.type_of_property_of_type(target, prop.name)
                && self.is_exact_optional_property_mismatch(of_source, of_target)
            {
                return true;
            }
        }
        false
    }

    /// `getBestMatchingType`: the member of the union `target` that `source` is most likely meant for.
    /// `is_related_to`: `isRelatedTo`, as "is not `TernaryFalse`".
    pub(super) fn best_matching_type(
        &mut self,
        source: TypeId,
        target: TypeId,
        is_related_to: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> bool,
    ) -> Option<TypeId> {
        if let Some(found) = self.find_matching_discriminant_type(source, target, is_related_to) {
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
        // Anonymous types that are instantiations of one alias.
        if self.is_anonymous_object_type(source)
            && let Some(alias) = self.alias_symbol_of_type(source)
            && let Some(&same) = parts.iter().find(|&&t| {
                self.is_anonymous_object_type(t) && self.alias_symbol_of_type(t) == Some(alias)
            })
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
        // `findMostOverlappyType`. `TypeFlagsPrimitive` has the rest of
        // `TypeFlagsInstantiablePrimitive`.
        let is_primitive = |c: &Self, t: TypeId| c.flags(t) & (tf::PRIMITIVE | tf::INDEX) != 0;
        if is_primitive(self, source) {
            return None;
        }
        // `getIndexType(source)` is not asked for a union of primitive types.
        let mut source_keys = None;
        let (mut best, mut matching) = (None, 0);
        for &t in parts {
            if is_primitive(self, t) {
                continue;
            }
            let source_keys = *source_keys.get_or_insert_with(|| self.keyof(source));
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
        let Some(sig) = self.single_call_signature(source) else {
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
            self.error_start_of(file, body),
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
            let promise = self.promise_of(actual);
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

    /// Whether `getTypeWithThisArgument` changes `ty`: a reference with a `this` type to
    /// instantiate, or an intersection with such a member.
    pub(super) fn takes_this_argument(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Ref { target, .. } => self.has_this_type(*target),
            TypeData::Tuple { .. } => true,
            TypeData::Intersection(parts) => {
                parts.iter().any(|&part| self.takes_this_argument(part))
            }
            _ => false,
        }
    }
}
