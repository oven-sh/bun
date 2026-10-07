//! Iteration and destructuring: 2488 2504 2493, 2405 2407, 2339 2537 2538 and 2341 2445 2446 for
//! the properties a destructuring assignment reads, 2531 2532 2533 2571 for a pattern that
//! destructures nothing, and 2322 where the destructured value is assigned.
//!
//! Follows `checkForOfStatement`, `checkForInStatement`, `getIteratedTypeOrElementType`,
//! `checkDestructuringAssignment` with its callees, `checkVariableLikeDeclaration` for binding
//! patterns, `checkYieldExpression`, and `checkSignatureDeclaration` for the return type annotation
//! of a generator, of TypeScript 7.0.2's checker.go.

use super::errors_access::PropertyAccess;
use super::errors_operators::{start_of_dots_before, start_of_equals_before, why_no_reference};
use super::mapped::AccessNode;
use super::symbols::IterationUse;
use super::*;
use crate::bind::{Parent, PatParent};

impl Checker<'_, '_> {
    /// `checkRightHandSideOfForOf`
    pub(super) fn check_right_hand_side_of_for_of(
        &mut self,
        file: FileId,
        expr: ExprId,
        is_await: bool,
    ) -> TypeId {
        let usage = if is_await {
            IterationUse::ForAwaitOf
        } else {
            IterationUse::ForOf
        };
        let input_type = self.type_of_expr(file, expr);
        let input_type = self.check_non_null_type(file, expr, input_type);
        // `checkIteratedTypeOrElementType`
        if self.is_any(input_type) {
            return input_type;
        }
        let error_node = Some(self.span_of_parenthesized_expr(file, expr));
        self.iterated_type_or_element_type(usage, input_type, TypeId::UNDEFINED, error_node)
            .unwrap_or(TypeId::ANY)
    }

    /// `checkForOfStatement`, where the expression `var_expr` takes the place of a declaration.
    pub(super) fn check_for_of_initializer(
        &mut self,
        file: FileId,
        var_expr: ExprId,
        expr: ExprId,
        is_await: bool,
    ) {
        let iterated_type = self.check_right_hand_side_of_for_of(file, expr, is_await);
        if self.is_assignment_pattern(file, var_expr) {
            return self.check_destructuring_assignment(file, var_expr, iterated_type);
        }
        let left_type = self.type_of_expr(file, var_expr);
        self.check_reference_expression(file, var_expr, 2487, 2781);
        let error_node = Some(self.error_range_of(file, var_expr));
        self.check_type_assignable_to_and_optionally_elaborate(
            iterated_type,
            left_type,
            error_node,
            Some((file, expr)),
            false,
            None,
            None,
        );
    }

    /// `checkForInStatement`: 2405 2406 2780 2407. `left`: the initializer before `in`.
    pub(super) fn check_for_in_statement(&mut self, file: FileId, left: StmtId, expr: ExprId) {
        let right_type = self.type_of_expr(file, expr);
        let right_type = self.non_nullable_type_if_needed(right_type);
        // An unparenthesized literal is a pattern, which is a different error: 2491.
        if let StmtKind::Expr(var_expr) = self.hir(file)[left].kind
            && !self.is_assignment_pattern(file, var_expr)
        {
            let left_type = self.type_of_expr(file, var_expr);
            let keys = self.index_type_or_string(right_type);
            if !self.is_assignable(keys, left_type) {
                self.error_at(self.error_range_of(file, var_expr), 2405, &[]);
            } else {
                // "run check only former check succeeded to avoid cascading errors"
                self.check_reference_expression(file, var_expr, 2406, 2780);
            }
        }
        // `isTypeAssignableToKind(rightType, NonPrimitive | InstantiableNonPrimitive)`. Without strictNullChecks `null` and
        // `undefined` are assignable to `object`.
        let is_object =
            self.flags(right_type) & (tf::NON_PRIMITIVE | tf::INSTANTIABLE_NON_PRIMITIVE) != 0
                || self.is_assignable(right_type, TypeId::OBJECT);
        if right_type.is_never() || !is_object {
            self.error_at(
                self.error_range_of(file, expr),
                2407,
                &[Arg::Type(right_type)],
            );
        }
    }

    pub(super) fn check_iteration(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let index = self.exprs_by_kind(file);
        // `f(...x)`, `import(...x)`. `checkArrayLiteral` reports for `[...x]`.
        for &e in index.of(ExprTag::Spread) {
            let ExprKind::Spread(inner) = hir[e].kind else {
                continue;
            };
            if matches!(bound.expr_parent[e.idx()], Parent::Expr(p) if matches!(hir[p].kind, ExprKind::Call(_) | ExprKind::New(_) | ExprKind::ImportCall { .. }))
                && !self.is_definite_assignment_target(file, e)
            {
                let actual = self.type_of_expr(file, inner);
                if !self.is_spread_of_array_like(file, e, actual) {
                    let error_node = self.span_of_parenthesized_expr(file, inner);
                    self.check_iterated(
                        IterationUse::Spread,
                        actual,
                        TypeId::UNDEFINED,
                        error_node,
                    );
                }
            }
        }
    }

    /// `getIndexTypeOrString`: the string keys of `ty`, or `string` if it has none.
    fn index_type_or_string(&mut self, ty: TypeId) -> TypeId {
        let keys = self.keyof(ty);
        let index_type = self.get_extract_string_type(keys);
        if index_type.is_never() {
            TypeId::STRING
        } else {
            index_type
        }
    }

    /// Whether the assignment target `e` is a pattern: an unparenthesized array or object literal.
    /// Parenthesized, it is an ordinary expression.
    fn is_assignment_pattern(&self, file: FileId, e: ExprId) -> bool {
        matches!(
            self.hir(file)[e].kind,
            ExprKind::Array(_) | ExprKind::Object(_)
        ) && !is_parenthesized(self.hir(file), e)
    }

    /// The type computation of `checkSpreadExpression`. `actual`: the type of the spread operand.
    /// `never` where it is not requested: `checkArrayLiteral` and `getSpreadArgumentType` check the
    /// operand instead.
    pub(super) fn type_of_spread_expression(
        &mut self,
        file: FileId,
        spread: ExprId,
        actual: TypeId,
    ) -> TypeId {
        if self.is_spread_of_array_like(file, spread, actual) {
            return TypeId::NEVER;
        }
        self.iterated_type_or_element_type(IterationUse::Spread, actual, TypeId::UNDEFINED, None)
            .unwrap_or(TypeId::ERROR)
    }

    /// Whether `isArrayLikeType` exempts `spread`, whose operand has type `actual`, from
    /// `checkIteratedTypeOrElementType`: an array-like type is used as is. `never` is array-like,
    /// and is not iterable.
    /// `reported`: the errors of the file so far.
    fn is_spread_of_array_like(&mut self, file: FileId, spread: ExprId, actual: TypeId) -> bool {
        let Parent::Expr(parent) = self.bound(file).expr_parent[spread.idx()] else {
            return false;
        };
        // `checkArrayLiteral`, `getSpreadArgumentType`
        let asks = matches!(self.hir(file)[parent].kind, ExprKind::Array(_))
            || !self.is_array_or_tuple(actual)
                && self.is_spread_left_to_rest_parameter(file, parent, spread);
        asks && self.is_array_like(actual)
    }

    /// `getSignatureApplicabilityError`, `inferTypeArguments`: whether the argument `spread` of
    /// `call` is one of those that are not checked individually, because a rest parameter that is
    /// not a plain array collects them.
    fn is_spread_left_to_rest_parameter(
        &mut self,
        file: FileId,
        call: ExprId,
        spread: ExprId,
    ) -> bool {
        let hir = self.hir(file);
        let (ExprKind::Call(id) | ExprKind::New(id)) = hir[call].kind else {
            return false;
        };
        let Some(sig) = self.resolved_signature(file, call).sig else {
            return false;
        };
        let params = self.sig_params(sig);
        if self.non_array_rest_type(&params).is_none() {
            return false;
        }
        // `getEffectiveCallArguments`: a spread tuple counts as its elements.
        let mut before = 0;
        for a in hir.ids(hir[id].args) {
            if a == spread {
                break;
            }
            self.each_effective_arg(file, a, |_| before += 1);
        }
        if before + 1 < self.parameter_count(&params) {
            return false;
        }
        // `getCandidateForOverloadFailure`, `resolveUntypedCall`: in a call that fails to resolve
        // every argument is checked individually after all. The errors of the call have already
        // been reported.
        let (start, end) = (self.start_of(file, call), self.end_of_expr(file, call));
        !self
            .reported
            .iter()
            .any(|d| (start..end).contains(&d.start))
    }

    /// `checkIteratedTypeOrElementType`. `None`: it is not iterable, or unknown.
    fn check_iterated(
        &mut self,
        usage: IterationUse,
        actual: TypeId,
        sent: TypeId,
        error_node: (FileId, u32, u32),
    ) -> Option<TypeId> {
        if self.is_any(actual) {
            return Some(actual);
        }
        let iterated = self.iterated_type_or_element_type(usage, actual, sent, Some(error_node))?;
        // Without `Iterable` the iterated type is not inspected.
        (self.global_type_of_arity(known::Iterable, 3).is_some()).then_some(iterated)
    }

    /// `checkDestructuringAssignment`
    pub(super) fn check_destructuring_assignment(
        &mut self,
        file: FileId,
        node: ExprId,
        mut source_type: TypeId,
    ) {
        let hir = self.hir(file);
        let mut target = node;
        // A default. Parenthesized, it is not one.
        if let ExprKind::Assign {
            op: None,
            target: left,
            value,
        } = hir[node].kind
            && !is_parenthesized(hir, node)
        {
            // `checkBinaryExpression`. Errors in `left` as a reference are reported with the
            // operators.
            let initializer = self.type_of_expr(file, value);
            if self.is_assignment_pattern(file, left) {
                self.check_destructuring_assignment(file, left, initializer);
            } else if why_no_reference(hir, left, 2364, 2779).is_none() {
                let left_type = self.type_of_expr(file, left);
                let error_node = Some(self.error_range_of(file, left));
                let right = Some((file, value));
                let head_message = self.exact_optional_head_message(file, left, initializer);
                self.check_type_assignable_to_and_optionally_elaborate(
                    initializer,
                    left_type,
                    error_node,
                    right,
                    false,
                    head_message,
                    None,
                );
            }
            // The default of `{ a = d }` removes `undefined` from the source type only if it cannot
            // be `undefined` itself.
            let is_shorthand = matches!(self.bound(file).expr_parent[node.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand);
            if self.p.files.options.strict_null_checks
                && !(is_shorthand && self.is_possibly_undefined(initializer))
            {
                source_type = self.type_with_ne_undefined(source_type);
            }
            target = left;
        }
        match hir[target].kind {
            ExprKind::Object(_) if !is_parenthesized(hir, target) => {
                self.check_object_literal_assignment(file, target, source_type)
            }
            ExprKind::Array(_) if !is_parenthesized(hir, target) => {
                self.check_array_literal_assignment(file, target, source_type)
            }
            _ => self.check_reference_assignment(file, target, source_type),
        }
    }

    /// `GetErrorRangeForNode`
    fn error_range_of(&self, file: FileId, e: ExprId) -> (FileId, u32, u32) {
        (
            file,
            self.error_start_of(file, e),
            self.error_end_of(file, e),
        )
    }

    /// `hasDefaultValue`
    fn has_default_value(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(hir[e].kind, ExprKind::Assign { op: None, .. }) && !is_parenthesized(hir, e)
    }

    /// `checkObjectLiteralAssignment`
    fn check_object_literal_assignment(&mut self, file: FileId, node: ExprId, source_type: TypeId) {
        let ExprKind::Object(properties) = self.hir(file)[node].kind else {
            return;
        };
        if properties.is_empty() {
            if self.p.files.options.strict_null_checks {
                self.check_non_null_type(file, node, source_type);
            }
            return;
        }
        for property in properties.iter() {
            self.check_object_literal_destructuring_property_assignment(
                file,
                node,
                source_type,
                property,
                properties,
            );
        }
    }

    /// `checkObjectLiteralDestructuringPropertyAssignment`
    fn check_object_literal_destructuring_property_assignment(
        &mut self,
        file: FileId,
        node: ExprId,
        object_literal_type: TypeId,
        p: PropId,
        all_properties: Span<PropId>,
    ) {
        let hir = self.hir(file);
        let property = &hir[p];
        if property.value.is_none() {
            return;
        }
        if property.kind == PropKind::Spread {
            if p.0 + 1 < all_properties.start + all_properties.len() as u32 {
                let start =
                    start_of_dots_before(self, file, property.value).unwrap_or(property.pos);
                self.error_at((file, start, self.end_of_prop(file, p)), 2462, &[]);
                return;
            }
            // A name that is not numeric omits the property of that name and no other. Any other
            // name omits by its type.
            let (mut names, mut keys) = (Vec::new(), Vec::new());
            for other in all_properties
                .iter()
                .filter(|&other| hir[other].kind != PropKind::Spread)
            {
                let (key, name_kind) = (hir[other].key, hir[other].name_kind);
                match key {
                    PropKey::Name(name) if !self.is_numeric_name(name) => names.push(name),
                    _ => keys.extend(self.literal_type_from_property_name(file, key, name_kind)),
                }
            }
            let keys = self.union(&keys);
            let rest = self.rest_of_object(object_literal_type, &names, keys, None);
            // `checkGrammarForDisallowedTrailingComma`
            let end = self.end_of_prop(file, p);
            self.grammar_error_on_token_after(file, end, b',', 1013);
            return self.check_destructuring_assignment(file, property.value, rest);
        }
        if !matches!(property.kind, PropKind::Init | PropKind::Shorthand) {
            self.error(file, p, 1136, &[]);
            // Nothing in it is checked, unless `checkObjectLiteral` comes to the pattern, for the
            // contextual type of the right side. That defers every method and accessor.
            if self.task.file == Some(file) && !self.is_deferred_node.contains(&property.value) {
                self.unvisited_exprs.push((property.start, property.value));
            }
            return;
        }
        let Some(expr_type) =
            self.literal_type_from_property_name(file, property.key, property.name_kind)
        else {
            return;
        };
        if let Some(text) = self.property_name_of_type(expr_type)
            && self
                .get_property_of_type(object_literal_type, text)
                .is_some()
        {
            let name = (file, property.pos, self.end_of_prop_name(file, p));
            let at = Parent::Expr(node);
            self.check_property_accessibility_at_location(
                file,
                hir.node(p),
                at,
                PropertyAccess {
                    is_super: false,
                    writing: true,
                },
                object_literal_type,
                text,
                Some(&|_| name),
            );
        }
        // `getIndexNodeForAccessExpression`: for `[k]`, the expression in the brackets. `["a"]` is
        // stored as the name `a`.
        let name = match property.key {
            PropKey::Computed(k) => self.error_range_of(file, k),
            _ => {
                let mut at = property.pos;
                if hir.text.get(at as usize) == Some(&b'[') {
                    let inside = &hir.text[at as usize + 1..];
                    at += 1 + (inside.len() - inside.trim_ascii_start().len()) as u32;
                }
                (file, at, self.end_of_name_at(file, at))
            }
        };
        let mut access_flags = AccessFlags::EXPRESSION_POSITION;
        access_flags.set(
            AccessFlags::ALLOW_MISSING,
            self.has_default_value(file, property.value),
        );
        let element_type = self
            .indexed_access_of_binding_element(
                object_literal_type,
                expr_type,
                access_flags,
                AccessNode::Name(name),
            )
            .unwrap_or(TypeId::ERROR);
        let ty = self.narrow_destructured_assignment(file, property.value, element_type);
        self.check_destructuring_assignment(file, property.value, ty)
    }

    /// `checkArrayLiteralAssignment`
    fn check_array_literal_assignment(&mut self, file: FileId, node: ExprId, source_type: TypeId) {
        let hir = self.hir(file);
        let ExprKind::Array(elements) = hir[node].kind else {
            return;
        };
        let error_node = (file, hir[node].pos, self.end_of_expr(file, node));
        let usage = IterationUse::Destructuring;
        let in_bounds_type = if self.is_any(source_type) {
            source_type
        } else {
            self.iterated_type_or_element_type(
                usage,
                source_type,
                TypeId::UNDEFINED,
                Some(error_node),
            )
            .unwrap_or(TypeId::ERROR)
        };
        // `IterationUsePossiblyOutOfBounds`
        let possibly_out_of_bounds_type = if self.p.files.options.no_unchecked_indexed_access {
            self.optional(in_bounds_type)
        } else {
            in_bounds_type
        };
        for (index, element) in hir.ids(elements).enumerate() {
            let is_last = index + 1 == elements.len();
            let element_type = match hir[element].kind {
                ExprKind::Spread(_) => in_bounds_type,
                _ => possibly_out_of_bounds_type,
            };
            self.check_array_literal_destructuring_element_assignment(
                file,
                source_type,
                (index, is_last),
                element,
                element_type,
            );
        }
    }

    /// `checkArrayLiteralDestructuringElementAssignment`
    fn check_array_literal_destructuring_element_assignment(
        &mut self,
        file: FileId,
        source_type: TypeId,
        (element_index, is_last): (usize, bool),
        element: ExprId,
        element_type: TypeId,
    ) {
        let hir = self.hir(file);
        match hir[element].kind {
            ExprKind::Missing => {}
            ExprKind::Spread(_) if !is_last => {
                self.error_at(
                    (file, hir[element].pos, self.end_of_expr(file, element)),
                    2462,
                    &[],
                );
            }
            ExprKind::Spread(rest_expression) => {
                if let ExprKind::Assign {
                    op: None, value, ..
                } = hir[rest_expression].kind
                    && !is_parenthesized(hir, rest_expression)
                {
                    if let Some(start) = start_of_equals_before(self, file, value) {
                        self.error_at((file, start, start + 1), 1186, &[]);
                    }
                    return;
                }
                // `checkGrammarForDisallowedTrailingComma`
                let end = self.end_of_expr(file, element);
                self.grammar_error_on_token_after(file, end, b',', 1013);
                let ty = if self.every_type(source_type, |c, t| c.is_tuple(t)) {
                    self.element_of_destructured(source_type, element_index, true, None)
                } else {
                    self.array_of(element_type)
                };
                self.check_destructuring_assignment(file, rest_expression, ty)
            }
            _ if self.is_array_like(source_type) => {
                let index_type = self.number_literal(element_index as f64, false);
                let has_default_value = self.has_default_value(file, element);
                let mut access_flags = AccessFlags::EXPRESSION_POSITION;
                access_flags.set(AccessFlags::ALLOW_MISSING, has_default_value);
                let at = (
                    file,
                    self.start_of(file, element),
                    self.end_of_expr(file, element),
                );
                let mut assigned_type = self
                    .indexed_access_of_binding_element(
                        source_type,
                        index_type,
                        access_flags,
                        AccessNode::Name(at),
                    )
                    .unwrap_or(TypeId::ERROR);
                if has_default_value {
                    assigned_type = self.type_with_ne_undefined(assigned_type);
                }
                let ty = self.narrow_destructured_assignment(file, element, assigned_type);
                self.check_destructuring_assignment(file, element, ty)
            }
            _ => self.check_destructuring_assignment(file, element, element_type),
        }
    }

    /// `checkReferenceAssignment`
    fn check_reference_assignment(&mut self, file: FileId, target: ExprId, source_type: TypeId) {
        let target_type = self.type_of_expr(file, target);
        // `IsSpreadAssignment(target.Parent)`
        let is_rest = matches!(self.bound(file).expr_parent[target.idx()], Parent::Prop(p) if self.hir(file)[p].kind == PropKind::Spread);
        let (message, optional_message) = if is_rest { (2701, 2778) } else { (2364, 2779) };
        if self.check_reference_expression(file, target, message, optional_message) {
            let error_node = Some(self.error_range_of(file, target));
            self.check_type_assignable_to(source_type, target_type, error_node, None);
        }
    }

    /// `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` is about to call
    /// `checkSignatureDeclaration` for `func`, and `getContextualSignature` returns `contextual`.
    pub(super) fn note_contextual_signature_at_check(
        &mut self,
        file: FileId,
        func: FnId,
        contextual: SigId,
    ) {
        let hir = self.hir(file);
        let mut parameters = hir[func].params.iter();
        if parameters.any(|p| Self::is_pattern_without_names(hir, hir[p].pat)) {
            self.contextual_signatures_at_check
                .push(((file, func), contextual));
        }
    }

    /// `checkVariableLikeDeclaration`, "For a binding pattern, validate the initializer and exit",
    /// where `needCheckWidenedType`: no element of `pat` has a name, so no element requests the
    /// destructured type.
    pub(super) fn check_empty_binding_pattern(&mut self, file: FileId, pat: PatId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !Self::is_pattern_without_names(hir, pat) {
            return;
        }
        let (node, mut initializer) = match bound.pat_parent[pat.idx()] {
            PatParent::None => return,
            PatParent::Var(d) => (hir.node(d), hir[d].init),
            PatParent::Param(q) => (hir.node(q), hir[q].default),
            PatParent::Prop(_, prop) => (hir.node(prop), hir[prop].default),
            PatParent::Elem(_, elem) => (hir.node(elem), hir[elem].default),
        };
        let root = bound.pat_parent[root_pattern(bound, pat).idx()];
        // An initializer in a function without a body is 2371, and nothing else is reported.
        if let PatParent::Param(q) = root
            && initializer.is_some()
            && matches!(hir[bound.param_fn[q.idx()]].body, FnBody::None)
        {
            return;
        }
        if hir.is_in_ambient_or_type_node(node) {
            return;
        }
        // "Don't validate for-in initializer as it is already an error"
        if hir.kind(hir.parent(hir.parent(node))) == Kind::ForInStatement {
            initializer = ExprId::NONE;
        }
        let (start, end) = self.get_error_range_for_node(file, node);
        let error_node = (file, start, end);
        let strict = self.p.files.options.strict_null_checks;
        if strict && initializer.is_some() {
            let initializer_type = self.type_of_expr(file, initializer);
            self.check_non_null_non_void_type(initializer_type, error_node);
        }
        // `getContextuallyTypedParameterType`
        let mut contextually_typed = None;
        if let PatParent::Param(q) = bound.pat_parent[pat.idx()]
            && hir[q].ty.is_none()
        {
            let func = bound.param_fn[q.idx()];
            let index = (q.0 - hir[func].params.start) as usize;
            if self
                .param_type_of_full_signature(file, func, index)
                .is_none()
            {
                contextually_typed = self.contextual_param_type(file, func, index);
            }
            // `contextuallyCheckFunctionExpressionOrObjectLiteralMethod` checks the parameters
            // while `getContextualSignature` still returns the signature that the inference
            // context then instantiates.
            if contextually_typed.is_some() && self.iife_param_type(file, func, index).is_none() {
                let mut noted = self.contextual_signatures_at_check.iter();
                match noted.rfind(|it| it.0 == (file, func)).map(|it| it.1) {
                    Some(sig) => {
                        contextually_typed = self.contextual_param_type_in(file, func, index, sig);
                    }
                    // Another task has checked the function. Only the instantiated signature is
                    // stored.
                    None => {
                        let assigned = self.assigned_contextual_signature(file, func);
                        let is_as_declared = assigned.is_some_and(|sig| {
                            matches!(*self.types().sig(sig), SigData::Decl { mapper, .. }
                                if !self.is_instantiating(mapper))
                        });
                        if !is_as_declared {
                            return;
                        }
                    }
                }
            }
            if hir[q].flags.contains(Flags::OPTIONAL) {
                contextually_typed = contextually_typed.map(|ty| self.optional(ty));
            }
        }
        // `getWidenedTypeForVariableLikeDeclaration`. An annotated type is not widened.
        let mut widened_type = match contextually_typed {
            Some(ty) => ty,
            None => self.type_of_pat(file, pat),
        };
        let is_annotated = match root {
            PatParent::Var(d) => hir[d].ty.is_some(),
            PatParent::Param(q) => hir[q].ty.is_some(),
            _ => return,
        };
        if !is_annotated {
            widened_type = self.get_widened_type(widened_type);
        }
        if matches!(hir[pat].kind, PatKind::Array(_)) {
            let usage = IterationUse::Destructuring;
            self.check_iterated(usage, widened_type, TypeId::UNDEFINED, error_node);
        } else if strict {
            self.check_non_null_non_void_type(widened_type, error_node);
        }
    }

    /// `checkNonNullNonVoidType` for a declaration, which is not an entity name.
    fn check_non_null_non_void_type(&mut self, ty: TypeId, error_node: (FileId, u32, u32)) {
        use super::flow::NonNullError;
        let non_null_type = self.check_non_null_type_with_reporter(ty, |c, error| {
            let code = match error {
                NonNullError::IsUnknown => 2571,
                NonNullError::IsPossibly {
                    undefined: true,
                    null: true,
                } => 2533,
                NonNullError::IsPossibly {
                    undefined: true, ..
                } => 2532,
                NonNullError::IsPossibly { .. } => 2531,
            };
            c.error_at(error_node, code, &[]);
        });
        if non_null_type == TypeId::VOID {
            self.error_at(error_node, 2532, &[]);
        }
    }
}
