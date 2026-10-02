//! Small things, each with a rule of its own: 2698, 2358 2359, 2491, 2414 2427 2431 2457, 2432, 1344.
//!
//! Follows `isValidSpreadType`, `checkInstanceOfExpression` with `resolveInstanceofExpression`, `checkForInStatement`,
//! `checkTypeNameIsReserved` and `checkEnumDeclaration` of TypeScript 7.0.2's checker.go, and `checkStrictModeLabeledStatement` of
//! its binder.go.

use super::*;
use crate::bind::{Decl, Parent, PatParent, ScopeKind};

impl Checker<'_> {
    /// `checkVarDeclaredNamesNotShadowed`: 2481, a `var` cannot get past a `let` or a `const` of the same name on its way up.
    fn check_vars_not_shadowed(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &(pat, written_in) in &bound.hoisted_vars {
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let own = bound.pat_symbol[pat.idx()];
            let mut scope = written_in;
            while scope.is_some() && matches!(bound.scopes[scope.idx()].kind, ScopeKind::Block) {
                let found = bound
                    .lookup(bound.scopes[scope.idx()].locals, name)
                    .filter(|&s| bound.symbols[s.idx()].flags.intersects(SymFlags::VARIABLE));
                if let Some(found) = found {
                    let is_lexical = found != own
                        && bound.symbols[found.idx()].decls.iter().any(|&d| {
                            let Decl::Var(mut root) = d else { return false };
                            loop {
                                match bound.pat_parent[root.idx()] {
                                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                                        root = outer
                                    }
                                    // What `catch` binds does not count.
                                    PatParent::Var(d) => {
                                        let stmt = bound.var_stmt[d.idx()];
                                        return hir[d].kind != VarKind::Var
                                            && stmt.is_some()
                                            && matches!(hir[stmt].kind, StmtKind::Var(_));
                                    }
                                    _ => return false,
                                }
                            }
                        });
                    if is_lexical {
                        let name = Arg::Atom(name);
                        self.error_at((file, hir[pat].pos, 0), 2481, &[name, name]);
                    }
                    break;
                }
                scope = bound.scopes[scope.idx()].parent;
            }
        }
    }

    pub(super) fn check_small_things(&mut self, file: FileId) {
        self.check_vars_not_shadowed(file);
    }

    /// `checkTestingKnownTruthyCallableOrAwaitableOrEnumMemberType`: 2774 2801 2845
    pub(super) fn check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
        &mut self,
        file: FileId,
        cond_expr: ExprId,
        body: Parent,
    ) {
        if self.p.files.options.strict_null_checks {
            self.check_known_truthy_types(file, cond_expr, cond_expr, body);
        }
    }

    /// From `checkBinaryLikeExpression`, of `e`, which is `left && ..`, `left || ..` or `left ?? ..`.
    pub(super) fn check_testing_known_truthy_left_operand(
        &mut self,
        file: FileId,
        e: ExprId,
        is_and: bool,
        left: ExprId,
    ) {
        if !self.p.files.options.strict_null_checks {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Out of the chain it is part of.
        let mut parent = bound.expr_parent[e.idx()];
        while let Parent::Expr(p) = parent
            && matches!(
                hir[p].kind,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
            )
        {
            parent = bound.expr_parent[p.idx()];
        }
        let body = match parent {
            Parent::Stmt(s) if s.is_some() => match hir[s].kind {
                StmtKind::If { yes, .. } => Some(Parent::Stmt(yes)),
                _ => None,
            },
            _ => None,
        };
        if is_and || body.is_some() {
            self.check_known_truthy_types(file, left, left, body.unwrap_or(Parent::None));
        }
    }

    /// `checkTestingKnownTruthyTypes`. `whole`: the condition that was first asked about, whose type is `condType`.
    fn check_known_truthy_types(
        &mut self,
        file: FileId,
        test: ExprId,
        whole: ExprId,
        body: Parent,
    ) {
        let hir = self.hir(file);
        let mut test = test;
        self.check_known_truthy_type(file, test, whole, body);
        while let ExprKind::Binary {
            op: BinOp::Or | BinOp::Nullish,
            left,
            ..
        } = hir[test].kind
        {
            test = left;
            self.check_known_truthy_type(file, test, whole, body);
        }
    }

    /// `checkTestingKnownTruthyType`
    fn check_known_truthy_type(&mut self, file: FileId, test: ExprId, whole: ExprId, body: Parent) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_logical = |e: ExprId| {
            matches!(
                hir[e].kind,
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
            )
        };
        let location = match hir[test].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } => right,
            _ => test,
        };
        if is_logical(location) {
            return self.check_known_truthy_types(file, location, whole, body);
        }
        // Only a right operand is judged by its own type: anything else by that of the whole condition.
        let judged_by = if location == test { whole } else { location };
        let ty = self.type_of_expr(file, judged_by);
        let start = self.start_inside_parentheses(file, location);
        // A member of an enum is what it is.
        if let (TypeData::EnumLit { value, .. }, ExprKind::Dot { obj, .. }) =
            (self.data(ty), hir[location].kind)
            && self.is_resolved_to_an_enum(file, obj)
        {
            // `evaluator.IsTruthy`
            let is_truthy = match *value {
                EnumValue::String(text) => !self.files().atoms.bytes(text).is_empty(),
                EnumValue::Number(bits) => {
                    let number = f64::from_bits(bits);
                    number != 0.0 && !number.is_nan()
                }
            };
            let end = self.end_inside_parentheses(file, location);
            self.error_at(
                (file, start, end),
                2845,
                &[Arg::Text(&is_truthy.to_string())],
            );
            return;
        }
        // `isPropertyExpressionCast`
        if matches!(hir[location].kind, ExprKind::Dot { obj, .. } if matches!(hir[obj].kind, ExprKind::As { .. } | ExprKind::AsConst(_)))
            || !self.can_be_truthy(ty)
        {
            return;
        }
        // `getAwaitedTypeOfPromise(t) != nil`
        let is_promise = self
            .thenable_value(ty)
            .and_then(|promised| self.awaited_or_none(promised))
            .is_some();
        if self.signatures(ty, false).is_empty() && !is_promise {
            return;
        }
        let is_named = matches!(
            hir[location].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. }
        );
        if !is_named && !is_promise {
            return;
        }
        // An optional method or property that is narrowed here is tested for good reason.
        let is_used = is_named && {
            let mut used = false;
            // To the right of it in a chain of `&&`, which parentheses end.
            let mut chain = if is_parenthesized(self.hir(file), test) {
                Parent::None
            } else {
                bound.expr_parent[test.idx()]
            };
            while let Parent::Expr(p) = chain
                && let ExprKind::Binary {
                    op: BinOp::And,
                    right,
                    ..
                } = hir[p].kind
            {
                used |= self.is_mentioned_within(file, location, test, Parent::Expr(right), true);
                chain = if is_parenthesized(self.hir(file), p) {
                    Parent::None
                } else {
                    bound.expr_parent[p.idx()]
                };
            }
            used || !matches!(body, Parent::None)
                && self.is_mentioned_within(file, location, test, body, false)
        };
        if !is_used {
            let at = (file, start, self.end_inside_parentheses(file, location));
            if is_promise {
                // `getTypeNameForErrorDisplay`: two types that read the same are both written with qualified names.
                let name = self.type_names_for_error_display(ty, ty).0;
                // `errorAndMaybeSuggestAwait`
                self.error_at(at, 2801, &[Arg::Text(&name)])
                    .add_related_info(Reported::bare(at, 2773));
            } else {
                self.error_at(at, 2774, &[]);
            }
        }
    }

    /// `getResolvedSymbolOrNil(e).Flags&SymbolFlagsEnum`: whether the name `e`, or the name after the dot in it, was found to mean an
    /// enum. What is imported was found to mean the import.
    fn is_resolved_to_an_enum(&mut self, file: FileId, e: ExprId) -> bool {
        if is_parenthesized(self.hir(file), e) {
            return false;
        }
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => self
                .symbol_of_identifier(file, e, name)
                .is_some_and(|s| self.files().flags(s).intersects(SymFlags::ENUM)),
            ExprKind::Dot { obj, name, .. } => {
                let of = self.type_of_expr(file, obj);
                let of = self.apparent_type(of);
                self.prop_of(of, name).is_some_and(|(prop, _)| matches!(prop.source, PropSource::Symbol(s) if self.files().flags(s).intersects(SymFlags::ENUM)))
            }
            _ => false,
        }
    }

    /// `isSymbolUsedInConditionBody`, `isSymbolUsedInBinaryExpressionChain`: whether what `tested` names is named again inside
    /// `container`. `by_name_alone`: on whatever it may be.
    fn is_mentioned_within(
        &mut self,
        file: FileId,
        tested: ExprId,
        test: ExprId,
        container: Parent,
        by_name_alone: bool,
    ) -> bool {
        let hir = self.hir(file);
        // `IsIdentifier`: only those are looked at, and a private name is not one.
        let is_looked_at = match hir[tested].kind {
            ExprKind::Dot { name, .. } => !self.is_private_name(name),
            ExprKind::Ident(_) => true,
            _ => false,
        };
        // The name of an `a.b` is a child of it.
        let is_access = |e: ExprId| matches!(hir[e].kind, ExprKind::Dot { .. });
        is_looked_at
            && (matches!(container, Parent::Expr(e) if is_access(e) && self.is_mention_of(file, tested, test, e, by_name_alone))
                || self.is_mentioned_below(file, tested, test, hir.node(container), by_name_alone))
    }

    /// `node.ForEachChild(visit)`
    fn is_mentioned_below(
        &mut self,
        file: FileId,
        tested: ExprId,
        test: ExprId,
        node: Node,
        by_name_alone: bool,
    ) -> bool {
        let hir = self.hir(file);
        !self.is_stack_low()
            && hir.for_each_child(node, &mut |child| {
                matches!(hir.data(child), NodeData::Expr(e) if self.is_mention_of(file, tested, test, e, by_name_alone))
                    || self.is_mentioned_below(file, tested, test, child, by_name_alone)
            })
    }

    /// `visit`, of the name `child`, or of the `a.b` whose name it is.
    fn is_mention_of(
        &mut self,
        file: FileId,
        tested: ExprId,
        test: ExprId,
        child: ExprId,
        by_name_alone: bool,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let same_variable = |a: ExprId, b: ExprId| matches!((hir[a].kind, hir[b].kind), (ExprKind::Ident(x), ExprKind::Ident(y)) if x == y && bound.expr_symbol[a.idx()] == bound.expr_symbol[b.idx()]);
        let may_be_the_same = same_variable(tested, child)
            || matches!((hir[tested].kind, hir[child].kind), (ExprKind::Dot { name: x, .. }, ExprKind::Dot { name: y, .. }) if x == y);
        if child == tested
            || !may_be_the_same
            // `getSymbolAtLocation`: the name in `{ name }` is that of the property.
            || matches!(bound.expr_parent[child.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
            || !self.same_property(file, tested, child)
        {
            return false;
        }
        if by_name_alone || matches!(hir[test].kind, ExprKind::Ident(_)) {
            return true;
        }
        let (ExprKind::Dot { obj: mut a, .. }, ExprKind::Dot { obj: mut b, .. }) =
            (hir[tested].kind, hir[child].kind)
        else {
            // `IsBinaryExpression(testedNode.Parent)`: a name that is an operand of the test. In parentheses it is not one, and
            // nothing is like it.
            return !is_parenthesized(hir, tested);
        };
        // On the same thing, written the same way.
        while !is_parenthesized(hir, a) && !is_parenthesized(hir, b) {
            match (hir[a].kind, hir[b].kind) {
                (ExprKind::Ident(_), ExprKind::Ident(_)) => return same_variable(a, b),
                (ExprKind::This, ExprKind::This) => return true,
                (
                    ExprKind::Dot {
                        obj: x, name: n, ..
                    },
                    ExprKind::Dot {
                        obj: y, name: m, ..
                    },
                ) if n == m && self.same_property(file, a, b) => (a, b) = (x, y),
                (ExprKind::Call(x), ExprKind::Call(y)) => (a, b) = (hir[x].callee, hir[y].callee),
                _ => break,
            }
        }
        false
    }

    /// `getSymbolAtLocation` of the name in `a.name`: what declares the property that is found. `None`: it cannot be told.
    fn property_found(&mut self, file: FileId, e: ExprId) -> Option<PropSource> {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[e].kind else {
            return None;
        };
        let ty = self.type_of_expr(file, obj);
        let ty = self.non_nullable(ty);
        let ty = self.apparent_type(ty);
        self.prop_of(ty, name).map(|(prop, _)| prop.source)
    }

    /// Whether `a.name` and `b.name` find one property. What cannot be told counts as one.
    fn same_property(&mut self, file: FileId, a: ExprId, b: ExprId) -> bool {
        match (self.property_found(file, a), self.property_found(file, b)) {
            (Some(x), Some(y)) => x == y,
            _ => true,
        }
    }

    /// `isValidSpreadType`
    pub(super) fn is_valid_spread_type(&mut self, ty: TypeId) -> bool {
        // `getBaseConstraintOrType`
        let ty = self.map_type(ty, |c, m| c.base_constraint_if_any(m, 0).unwrap_or(m));
        // `removeDefinitelyFalsyTypes`: what is sure to be falsy spreads nothing.
        let ty = self.remove_definitely_falsy(ty);
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().all(|&p| self.is_valid_spread_type(p))
            }
            // `TypeFlagsInstantiableNonPrimitive` has no `keyof T`.
            TypeData::Keyof(_) => false,
            _ => {
                self.is_any(ty)
                    || ty == TypeId::OBJECT
                    || self.is_object_type(ty)
                    || self.is_deferred(ty)
            }
        }
    }

    /// `getBaseConstraintOfType`. `None`: there is none, which is not `unknown`. What extends nothing may turn out to be an object,
    /// what extends `unknown` can be anything at all.
    fn base_constraint_if_any(&mut self, ty: TypeId, depth: u32) -> Option<TypeId> {
        match self.data(ty) {
            TypeData::TypeParam(..) => {
                // Round in circles.
                if depth > 16 {
                    return None;
                }
                let constraint = self.constraint_of_type_param(ty)?;
                self.base_constraint_if_any(constraint, depth + 1)
            }
            // `computeBaseConstraint`: of the members that have one.
            TypeData::Intersection(parts) => {
                let mut constraints = Vec::with_capacity(parts.len());
                for &part in parts.iter() {
                    constraints.extend(self.base_constraint_if_any(part, depth + 1));
                }
                if constraints.is_empty() {
                    None
                } else {
                    Some(self.intersection(&constraints))
                }
            }
            // All of them have to have one.
            TypeData::Union(parts) => {
                let mut constraints = Vec::with_capacity(parts.len());
                for &part in parts.iter() {
                    constraints.push(self.base_constraint_if_any(part, depth + 1)?);
                }
                Some(self.union(&constraints))
            }
            _ if self.is_deferred(ty) => {
                let constraint = self.base_constraint(ty);
                if constraint != TypeId::UNKNOWN {
                    return Some(constraint);
                }
                // Only of `T[K]` is it told apart whether there is none or it is `unknown`. `computeBaseConstraint`: both parts have
                // one, and the one has something under the other.
                let TypeData::IndexedAccess {
                    obj,
                    index,
                    undefined,
                } = *self.data(ty)
                else {
                    return None;
                };
                if depth > 16 {
                    return None;
                }
                let base_object = self.base_constraint_if_any(obj, depth + 1)?;
                let base_index = self.base_constraint_if_any(index, depth + 1)?;
                let access =
                    self.indexed_access_flagged(base_object, base_index, undefined, None)?;
                self.base_constraint_if_any(access, depth + 1)
            }
            _ => Some(ty),
        }
    }

    /// `checkObjectLiteral`, `createJsxAttributesTypeFromAttributesProperty`: 2698, of the spread `p` in `owner`.
    pub(super) fn check_spread(&mut self, file: FileId, owner: ExprId, p: PropId) {
        let hir = self.hir(file);
        let prop = &hir[p];
        if prop.value.is_none() || self.is_assignment_target(file, owner) {
            return;
        }
        let ty = self.type_of_expr(file, prop.value);
        let ty = self.reduced(ty);
        if self.is_valid_spread_type(ty) {
            return;
        }
        // In JSX it is what is spread that is pointed at, in an object literal the dots.
        let start = if matches!(hir[owner].kind, ExprKind::Jsx(_)) {
            self.error_start_of(file, prop.value)
        } else {
            let value = self.start_of(file, prop.value);
            let before = hir
                .text
                .get(..value as usize)
                .unwrap_or_default()
                .trim_ascii_end();
            if before.ends_with(b"...") {
                before.len() as u32 - 3
            } else {
                value.saturating_sub(3)
            }
        };
        let end = if matches!(hir[owner].kind, ExprKind::Jsx(_)) {
            self.error_end_of(file, prop.value)
        } else {
            self.end_of_expr(file, prop.value)
        };
        self.error_at((file, start, end), 2698, &[]);
    }

    /// `allTypesAssignableToKind(ty, TypeFlagsPrimitive)`
    pub(super) fn is_all_assignable_to_primitives(&mut self, ty: TypeId) -> bool {
        const KINDS: [TypeId; 8] = [
            TypeId::NUMBER,
            TypeId::BIGINT,
            TypeId::STRING,
            TypeId::BOOLEAN,
            TypeId::VOID,
            TypeId::NULL,
            TypeId::UNDEFINED,
            TypeId::SYMBOL,
        ];
        match self.data(ty) {
            TypeData::Union(parts) => parts
                .iter()
                .all(|&p| self.is_all_assignable_to_primitives(p)),
            _ => self.is_primitive(ty) || KINDS.iter().any(|&kind| self.is_assignable(ty, kind)),
        }
    }

    /// The end of `checkEnumDeclaration`: 2432. "Only perform this check once per symbol": at its first declaration.
    pub(super) fn check_first_members_of_enum_declarations(&mut self, file: FileId, e: EnumId) {
        let symbol = self.bound(file).enum_symbol[e.idx()];
        if symbol.is_none() {
            return;
        }
        let declarations = self.files().decls(self.files().sym(file, symbol));
        let enums = declarations.into_iter().filter_map(|(f, d)| match d {
            Decl::Enum(e) => Some((f, e)),
            _ => None,
        });
        let enums: smallvec::SmallVec<[(FileId, EnumId); 2]> = enums.collect();
        if enums.len() < 2 || enums[0] != (file, e) {
            return;
        }
        let mut seen_enum_missing_initial_initializer = false;
        for (f, e) in enums {
            if let Some(first) = self.hir(f)[e].members.iter().next()
                && self.hir(f)[first].init.is_none()
            {
                if seen_enum_missing_initial_initializer {
                    self.error(f, self.hir(f).name(self.hir(f).node(first)), 2432, &[]);
                }
                seen_enum_missing_initial_initializer = true;
            }
        }
    }
}
