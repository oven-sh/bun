//! Small independent checks: 2698, 2358 2359, 2491, 2414 2427 2431 2457, 2432 2473, 1344.
//!
//! Follows `isValidSpreadType`, `checkInstanceOfExpression` with `resolveInstanceofExpression`,
//! `checkForInStatement`, `checkTypeNameIsReserved` and `checkEnumDeclaration` of TypeScript
//! 7.0.2's checker.go, and `checkStrictModeLabeledStatement` of its binder.go.

use super::*;
use crate::bind::{
    Decl, Parent, PatParent, ScopeKind, SymbolId, is_module_exports_inside_parentheses,
};

/// What `getSymbolAtLocation` returns.
#[derive(PartialEq, Eq)]
pub(super) enum SymbolAtLocation<'p> {
    /// `getMergedSymbol` of a symbol of the binder.
    Symbol(Sym),
    /// A property that has no symbol of the binder. The properties of a mapped type have one
    /// source.
    Property(&'p PropSource<'p>, Atom),
    /// `IndexInfo.indexSymbol` of the index signature of that type.
    Index(TypeId, (FileId, MemberId)),
    /// `findApplicableIndexInfo` makes another `IndexInfo` every time that several apply, so this
    /// one is the same as no other.
    IndexOfSeveral,
    /// `signature.thisParameter` of that function.
    ThisParameter(FileId, FnId),
    /// `__object`, `__type`, `__function`: the symbol that only that node declares.
    Anonymous(FileId, Node),
}

/// `a == b`
fn is_same_symbol<'p>(a: &Option<SymbolAtLocation<'p>>, b: &Option<SymbolAtLocation<'p>>) -> bool {
    a == b && !matches!(a, Some(SymbolAtLocation::IndexOfSeveral))
}

impl<'p> Checker<'p, '_> {
    /// `checkVarDeclaredNamesNotShadowed`: 2481, a `var` cannot be hoisted past a `let` or a
    /// `const` of the same name.
    fn check_vars_not_shadowed(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &(pat, written_in) in &bound.hoisted_vars {
            let PatKind::Ident(name) = hir[pat].kind else {
                continue;
            };
            let own = bound.pat_symbol[pat.idx()];
            let mut scope = written_in;
            // `namesShareScope`: in the body of a function, a module or a file.
            while scope.is_some()
                && match bound.scopes[scope.idx()].kind {
                    ScopeKind::Block => true,
                    // A `ClassStaticBlockDeclaration` is not function-like.
                    ScopeKind::Fn(f) => hir[f].kind == FnKind::StaticBlock,
                    _ => false,
                }
            {
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
                                    // A `catch` binding does not count.
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

    pub(super) fn check_misc(&mut self, file: FileId) {
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
            let body = match body {
                Parent::Expr(e) => self.hir(file).child(e),
                body => self.hir(file).node(body),
            };
            self.check_known_truthy_types(file, cond_expr, cond_expr, body);
        }
    }

    /// From `checkBinaryLikeExpression`, for `e`, which is `left && ..`, `left || ..` or `left ??
    /// ..`.
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
        // Walks up out of the chain it is part of.
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
                StmtKind::If { yes, .. } => Some(hir.node(yes)),
                _ => None,
            },
            _ => None,
        };
        if is_and || body.is_some() {
            self.check_known_truthy_types(file, left, left, body.unwrap_or(Node::NONE));
        }
    }

    /// `checkTestingKnownTruthyTypes`. `whole`: the condition the check was first called with,
    /// whose type is `condType`.
    fn check_known_truthy_types(&mut self, file: FileId, test: ExprId, whole: ExprId, body: Node) {
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
    fn check_known_truthy_type(&mut self, file: FileId, test: ExprId, whole: ExprId, body: Node) {
        let hir = self.hir(file);
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
        if is_module_exports_inside_parentheses(hir, location) {
            return;
        }
        if is_logical(location) {
            return self.check_known_truthy_types(file, location, whole, body);
        }
        // Only a right operand is tested by its own type. Anything else uses the type of the whole
        // condition.
        let judged_by = if location == test { whole } else { location };
        let ty = self.type_of_expr(file, judged_by);
        let start = self.start_inside_parentheses(file, location);
        // An enum member has a constant value.
        if let (TypeData::EnumLit { value, .. }, ExprKind::Dot { obj, .. }) =
            (self.data(ty), hir[location].kind)
            && self.is_resolved_to_an_enum(file, obj)
        {
            // `evaluator.IsTruthy`
            let is_truthy = match *value {
                EnumValue::String(text) => !self.atoms().bytes(text).is_empty(),
                EnumValue::Number(bits) => {
                    let number = f64::from_bits(bits);
                    number != 0.0 && !number.is_nan()
                }
            };
            let end = self.end_inside_parentheses(file, location);
            self.error_at(
                (file, start, end),
                2845,
                &[Arg::Text(if is_truthy { "true" } else { "false" })],
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
        let (cond_expr, location_node) = (hir.node(test), hir.node(location));
        let tested_node = match hir.kind(location_node) {
            Kind::Identifier => location_node,
            Kind::PropertyAccessExpression => hir.name(location_node),
            _ => Node::NONE,
        };
        let tested_symbol = self.get_symbol_at_location(file, tested_node);
        if tested_symbol.is_none() && !is_promise {
            return;
        }
        let (chain, target) = (hir.parent(cond_expr), Some((cond_expr, tested_node)));
        let is_used = tested_symbol.is_some()
            && (self.is_symbol_used_in_binary_expression_chain(file, chain, &tested_symbol)
                || body.is_some() && self.is_symbol_used_below(file, body, &tested_symbol, target));
        if !is_used {
            let at = (file, start, self.end_inside_parentheses(file, location));
            if is_promise {
                // `getTypeNameForErrorDisplay`: two types that print identically are both printed
                // with qualified names.
                let name = self.type_names_for_error_display(ty, ty).0;
                // `errorAndMaybeSuggestAwait`
                self.error_at(at, 2801, &[Arg::Bytes(&name)])
                    .add_related_info(Reported::bare(at, 2773));
            } else {
                self.error_at(at, 2774, &[]);
            }
        }
    }

    /// `getResolvedSymbolOrNil(e).Flags&SymbolFlagsEnum`: whether the name `e`, or the name after
    /// its dot, resolved to an enum. An imported name resolved to the import alias.
    fn is_resolved_to_an_enum(&mut self, file: FileId, e: ExprId) -> bool {
        if is_parenthesized(self.hir(file), e) {
            return false;
        }
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => {
                // `declareModuleMember`: where an exported declaration is in scope its name
                // resolves to a local symbol, which has `SymbolFlagsExportValue` and no other flag.
                // `expr_symbol` has its `ExportSymbol`. A name found among the exports of an enclosing
                // namespace, declared in another block of it, resolves to that symbol itself.
                let bound = self.bound(file);
                let recorded = bound.expr_symbol[e.idx()];
                if recorded.is_some() {
                    let mut scope = self.enclosing_scope_of_expr(file, e);
                    while scope.is_some() {
                        if bound.export_symbol_of_local(scope, name) == recorded {
                            return false;
                        }
                        scope = bound.scopes[scope.idx()].parent;
                    }
                }
                self.symbol_of_identifier(file, e, name)
                    .is_some_and(|s| self.files().flags(s).intersects(SymFlags::ENUM))
            }
            ExprKind::Dot { obj, name, .. } => {
                let of = self.type_of_expr(file, obj);
                let of = self.apparent_type(of);
                self.prop_ref(of, name).is_some_and(|(prop, _)| matches!(prop.source, PropSource::Symbol(s) if self.files().flags(s).intersects(SymFlags::ENUM)))
            }
            _ => false,
        }
    }

    /// `isSymbolUsedInBinaryExpressionChain`
    fn is_symbol_used_in_binary_expression_chain(
        &mut self,
        file: FileId,
        mut node: Node,
        tested_symbol: &Option<SymbolAtLocation<'p>>,
    ) -> bool {
        let hir = self.hir(file);
        while let NodeData::Expr(e) = hir.data(node)
            && let ExprKind::Binary {
                op: BinOp::And,
                right,
                ..
            } = hir[e].kind
        {
            if self.is_symbol_used_below(file, hir.child(right), tested_symbol, None) {
                return true;
            }
            node = hir.parent(node);
        }
        false
    }

    /// `node.ForEachChild(visit)`, for the `visit` of `isSymbolUsedInBinaryExpressionChain`, and
    /// with `target`, which is `expr` and `testedNode`, for that of `isSymbolUsedInConditionBody`.
    fn is_symbol_used_below(
        &mut self,
        file: FileId,
        node: Node,
        tested_symbol: &Option<SymbolAtLocation<'p>>,
        target: Option<(Node, Node)>,
    ) -> bool {
        let hir = self.hir(file);
        !self.is_stack_low()
            && hir.for_each_child(node, &mut |child| {
                if hir.kind(child) != Kind::Identifier {
                    return self.is_symbol_used_below(file, child, tested_symbol, target);
                }
                let child_symbol = self.get_symbol_at_location(file, child);
                is_same_symbol(&child_symbol, tested_symbol)
                    && target.is_none_or(|(expr, tested_node)| {
                        self.is_called_on_same_target(file, expr, tested_node, child)
                    })
            })
    }

    /// The rest of the `visit` of `isSymbolUsedInConditionBody`, for a `childNode` that has the
    /// tested symbol.
    fn is_called_on_same_target(
        &mut self,
        file: FileId,
        expr: Node,
        tested_node: Node,
        child_node: Node,
    ) -> bool {
        let hir = self.hir(file);
        let mut tested_expression = hir.parent(tested_node);
        if hir.kind(expr) == Kind::Identifier
            || hir.kind(tested_node) == Kind::Identifier
                && hir.kind(tested_expression) == Kind::BinaryExpression
        {
            return true;
        }
        let mut child_expression = hir.parent(child_node);
        while tested_expression.is_some() && child_expression.is_some() {
            match (hir.kind(tested_expression), hir.kind(child_expression)) {
                (Kind::Identifier, Kind::Identifier) | (Kind::ThisKeyword, Kind::ThisKeyword) => {
                    return self.have_same_symbol(file, tested_expression, child_expression);
                }
                (Kind::PropertyAccessExpression, Kind::PropertyAccessExpression) => {
                    let (tested, child) = (hir.name(tested_expression), hir.name(child_expression));
                    if !self.have_same_symbol(file, tested, child) {
                        return false;
                    }
                }
                (Kind::CallExpression, Kind::CallExpression) => {}
                _ => return false,
            }
            tested_expression = hir.expression(tested_expression);
            child_expression = hir.expression(child_expression);
        }
        false
    }

    /// `getSymbolAtLocation(a) == getSymbolAtLocation(b)`
    fn have_same_symbol(&mut self, file: FileId, a: Node, b: Node) -> bool {
        let a = self.get_symbol_at_location(file, a);
        is_same_symbol(&a, &self.get_symbol_at_location(file, b))
    }

    /// `getSymbolAtLocation` for an identifier or a `this`. The name of a member, of a property of
    /// an object literal, of a label or of a declared type, and the right side of a qualified name
    /// in a type reference, have a symbol that no tested expression has: `None`.
    fn get_symbol_at_location(&mut self, file: FileId, node: Node) -> Option<SymbolAtLocation<'p>> {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if node.is_none() || hir.is_in_with(hir.start(node)) {
            return None;
        }
        let parent = hir.parent(node);
        if hir.is_declaration_name(node) {
            // `getSymbolOfDeclaration(parent)`
            let declared = match (hir.data(node), hir.kind(parent)) {
                (NodeData::Pat(name), _) => bound.pat_symbol[name.idx()],
                (_, Kind::FunctionDeclaration | Kind::FunctionExpression) => {
                    bound.fn_symbol[hir.function_of(parent).idx()]
                }
                (_, Kind::ClassDeclaration | Kind::ClassExpression) => {
                    bound.class_symbol[hir.class_of(parent).idx()]
                }
                _ => SymbolId::NONE,
            };
            return Some(SymbolAtLocation::Symbol(files.sym(file, declared.some()?)));
        }
        match hir.data(node) {
            NodeData::Expr(e) => match hir[e].kind {
                // `getSymbolOfNameOrPropertyAccessExpression`
                ExprKind::Ident(name) => {
                    let symbol = self.resolve_identifier(file, e, name, true).ok()??;
                    Some(SymbolAtLocation::Symbol(files.canonical(symbol)))
                }
                ExprKind::This => {
                    let container = hir.get_this_container(node, false, false);
                    if hir.kind(container).is_function_like()
                        && let Some(function) = hir.function_of(container).some()
                    {
                        let signature = self.sig_of_fn(file, function);
                        if self.sig_this_parameter(signature).is_some() {
                            return Some(SymbolAtLocation::ThisParameter(file, function));
                        }
                    }
                    let ty = self.type_of_expr(file, e);
                    self.symbol_of_type(ty)
                }
                _ => None,
            },
            // `IsRightSideOfQualifiedNameOrPropertyAccess`: `links.resolvedSymbol` of the access.
            NodeData::Part(Part::Name, access) => match hir.data(access) {
                NodeData::Expr(e) => self.symbol_at_name(file, e),
                _ => None,
            },
            // `{ name: local }`: the property of the type of the pattern.
            NodeData::Part(Part::PropertyName, element) => {
                let NodeData::PatProp(p) = hir.data(element) else {
                    return None;
                };
                let (PropKey::Name(name), PatParent::Prop(pattern, _)) =
                    (hir[p].key, bound.pat_parent[hir[p].value.idx()])
                else {
                    return None;
                };
                let ty = self.type_of_pat(file, pattern);
                self.symbol_of_property(ty, name)
            }
            // `isTypeReferenceIdentifier`
            NodeData::Name(name) if hir.name(parent) != node => {
                let mut reference = parent;
                while hir.kind(reference) == Kind::QualifiedName {
                    reference = hir.parent(reference);
                }
                let NodeData::Type(ty) = hir.data(reference) else {
                    return None;
                };
                if hir.kind(reference) != Kind::TypeReference {
                    return None;
                }
                let meaning = if reference == parent {
                    SymFlags::TYPE
                } else {
                    SymFlags::NAMESPACE
                };
                let scope = bound.type_scope[ty.idx()];
                let symbol = files.resolve_name(file, scope, hir[name].text, meaning)?;
                Some(SymbolAtLocation::Symbol(files.canonical(symbol)))
            }
            _ => None,
        }
    }

    /// `t.symbol`
    pub(super) fn symbol_of_type(&self, ty: TypeId) -> Option<SymbolAtLocation<'p>> {
        let files = self.files();
        Some(match *self.data(ty) {
            TypeData::ThisParam(symbol) | TypeData::Enum { symbol, .. } => {
                SymbolAtLocation::Symbol(symbol)
            }
            TypeData::Ref { target, .. } => SymbolAtLocation::Symbol(target),
            TypeData::EnumLit { member, .. } => SymbolAtLocation::Symbol(member),
            TypeData::TypeParam(file, parameter, _) => {
                let symbol = self.bound(file).type_param_symbol[parameter.idx()].some()?;
                SymbolAtLocation::Symbol(files.sym(file, symbol))
            }
            TypeData::Anon { origin, .. } => match origin {
                Origin::ClassStatic(symbol)
                | Origin::Function(symbol)
                | Origin::EnumObject(symbol)
                | Origin::Module(symbol)
                | Origin::Namespace { module: symbol, .. } => SymbolAtLocation::Symbol(symbol),
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    SymbolAtLocation::Anonymous(file, self.hir(file).node(e))
                }
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                    SymbolAtLocation::Anonymous(file, self.hir(file).node(node))
                }
                Origin::GlobalThis => SymbolAtLocation::Symbol(files.global_this_symbol),
            },
            TypeData::Fns { ref decls, .. } => {
                let &(file, function) = decls.first()?;
                SymbolAtLocation::Anonymous(file, self.hir(file).node(function))
            }
            _ => return None,
        })
    }

    /// `getPropertyOfType(ty, name)`
    fn symbol_of_property(&mut self, ty: TypeId, name: Atom) -> Option<SymbolAtLocation<'p>> {
        let (prop, _) = self.get_property_of_type(ty, name)?;
        Some(match prop.source {
            PropSource::Symbol(symbol) => SymbolAtLocation::Symbol(self.files().canonical(symbol)),
            ref source => SymbolAtLocation::Property(source, name),
        })
    }

    /// `links.resolvedSymbol` of the property access or the qualified name `e`, as
    /// `getSymbolOfNameOrPropertyAccessExpression` leaves it.
    fn symbol_at_name(&mut self, file: FileId, e: ExprId) -> Option<SymbolAtLocation<'p>> {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[e].kind else {
            return None;
        };
        let receiver = self.type_of_expr(file, obj);
        let ty = self.non_nullable(receiver);
        if let Some(property) = self.symbol_of_property(ty, name) {
            return Some(property);
        }
        // `getApplicableIndexSymbol`: there is one only if an index signature is declared.
        let ty = self.reduced(receiver);
        let ty = self.apparent_type(ty);
        let members = self.members(ty)?;
        let info = self.applicable_index_info_for_name(&members, name)?;
        if let Some(declaration) = info.declaration {
            return Some(SymbolAtLocation::Index(ty, declaration));
        }
        let key_type = self.string_literal(name, false);
        let is_declared = members.shape().index.iter().any(|info| {
            info.declaration.is_some() && self.is_applicable_index_type(key_type, info.key)
        });
        is_declared.then_some(SymbolAtLocation::IndexOfSeveral)
    }

    /// `isValidSpreadType`
    pub(super) fn is_valid_spread_type(&mut self, ty: TypeId) -> bool {
        let ty = self.map_type(ty, |c, m| c.base_constraint_or_type(m));
        // `removeDefinitelyFalsyTypes`: a definitely falsy value spreads no properties.
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

    /// `checkObjectLiteral`, `createJsxAttributesTypeFromAttributesProperty`: 2698 for the spread
    /// `p` in `owner`. For an assignment target `type_of_object_literal` reports it.
    pub(super) fn check_spread(&mut self, file: FileId, owner: ExprId, p: PropId) {
        let hir = self.hir(file);
        let prop = &hir[p];
        if prop.value.is_none() || self.is_definite_assignment_target(file, owner) {
            return;
        }
        let ty = self.type_of_expr(file, prop.value);
        let ty = self.reduced(ty);
        if self.is_valid_spread_type(ty) {
            return;
        }
        // JSX reports on the spread expression, an object literal on the whole `SpreadAssignment`.
        if matches!(hir[owner].kind, ExprKind::Jsx(_)) {
            self.error_at(self.span_of_parenthesized_expr(file, prop.value), 2698, &[]);
        } else {
            self.error(file, p, 2698, &[]);
        }
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

    /// The end of `checkEnumDeclaration`: 2473, 2432.
    pub(super) fn check_first_members_of_enum_declarations(&mut self, file: FileId, e: EnumId) {
        let symbol = self.bound(file).enum_symbol[e.idx()];
        if symbol.is_none() {
            return;
        }
        let files = self.files();
        let enum_symbol = files.sym(file, symbol);
        let declarations = files.decls(enum_symbol);
        let enums = declarations.into_iter().filter_map(|(f, d)| match d {
            Decl::Enum(e) => Some((f, e)),
            _ => None,
        });
        let enums: smallvec::SmallVec<[(FileId, EnumId); 2]> = enums.collect();
        if enums.len() < 2 {
            return;
        }
        // "Only perform this check once per symbol": where `getSymbolOfDeclaration` first answers
        // it. The local symbol of an exported declaration lists that declaration too.
        let first_checked = enums
            .iter()
            .find(|&&(f, e)| files.sym(f, self.bound(f).enum_symbol[e.idx()]) == enum_symbol);
        if first_checked != Some(&(file, e)) {
            return;
        }
        let enum_is_const = self.hir(file)[e].flags.contains(Flags::CONST);
        for &(f, e) in &enums {
            if self.hir(f)[e].flags.contains(Flags::CONST) != enum_is_const {
                self.error(f, self.hir(f).name(self.hir(f).node(e)), 2473, &[]);
            }
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
