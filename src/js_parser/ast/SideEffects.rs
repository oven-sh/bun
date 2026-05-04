use bun_js_parser::ast::{self, Binding, BindingData, E, Expr, ExprData, G, Op, Stmt, StmtData};
use bun_alloc::Arena as Bump; // bumpalo::Bump re-export
// TODO(port): narrow these imports once crate layout is fixed in Phase B

#[repr(u8)] // Zig: enum(u1) — Rust has no u1 repr; u8 is the smallest
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SideEffects {
    CouldHaveSideEffects,
    NoSideEffects,
}

#[derive(Clone, Copy, Debug)]
pub struct Result {
    pub side_effects: SideEffects,
    pub ok: bool,
    pub value: bool,
}

impl Default for Result {
    fn default() -> Self {
        Self {
            side_effects: SideEffects::CouldHaveSideEffects,
            ok: false,
            value: false,
        }
    }
}

#[derive(Clone, Copy)]
pub struct BinaryExpressionSimplifyVisitor {
    // ARENA: points into the AST store (see LIFETIMES.tsv)
    pub bin: *const E::Binary,
}

impl SideEffects {
    pub fn can_change_strict_to_loose(lhs: &ExprData, rhs: &ExprData) -> bool {
        let left = lhs.known_primitive();
        let right = rhs.known_primitive();
        left == right && left != ast::KnownPrimitive::Unknown && left != ast::KnownPrimitive::Mixed
    }

    pub fn simplify_boolean<P>(p: &P, expr: Expr) -> Expr {
        if !p.options().features.dead_code_elimination {
            return expr;
        }

        let mut result: Expr = expr;
        Self::_simplify_boolean(p, &mut result);
        result
    }

    fn _simplify_boolean<P>(p: &P, expr: &mut Expr) {
        loop {
            match &mut expr.data {
                ExprData::EUnary(e) => {
                    if e.op == Op::UnNot {
                        // "!!a" => "a"
                        if let ExprData::EUnary(inner) = &e.value.data {
                            if inner.op == Op::UnNot {
                                // TODO(port): verify ExprData::EUnary payload is &mut/arena-ref so this reassign is sound
                                *expr = inner.value;
                                continue;
                            }
                        }

                        Self::_simplify_boolean(p, &mut e.value);
                    }
                }
                ExprData::EBinary(e) => {
                    match e.op {
                        Op::BinLogicalAnd => {
                            let effects = SideEffects::to_boolean(p, &e.right.data);
                            if effects.ok && effects.value && effects.side_effects == SideEffects::NoSideEffects {
                                // "if (anything && truthyNoSideEffects)" => "if (anything)"
                                *expr = e.left;
                                continue;
                            }
                        }
                        Op::BinLogicalOr => {
                            let effects = SideEffects::to_boolean(p, &e.right.data);
                            if effects.ok && !effects.value && effects.side_effects == SideEffects::NoSideEffects {
                                // "if (anything || falsyNoSideEffects)" => "if (anything)"
                                *expr = e.left;
                                continue;
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
            break;
        }
    }

    // Re-exports of ExprData methods (Zig: `pub const toNumber = Expr.Data.toNumber;`)
    #[inline(always)]
    pub fn to_number(data: &ExprData) -> Option<f64> {
        data.to_number()
    }
    #[inline(always)]
    pub fn typeof_(data: &ExprData) -> Option<&'static [u8]> {
        data.to_typeof()
    }

    pub fn is_primitive_to_reorder(data: &ExprData) -> bool {
        matches!(
            data,
            ExprData::ENull
                | ExprData::EUndefined
                | ExprData::EString(_)
                | ExprData::EBoolean(_)
                | ExprData::EBranchBoolean(_)
                | ExprData::ENumber(_)
                | ExprData::EBigInt(_)
                | ExprData::EInlinedEnum(_)
                | ExprData::ERequireMain
        )
    }

    pub fn simplify_unused_expr<P>(p: &mut P, mut expr: Expr) -> Option<Expr> {
        if !p.options().features.dead_code_elimination {
            return Some(expr);
        }
        match &mut expr.data {
            ExprData::ENull
            | ExprData::EUndefined
            | ExprData::EMissing
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EThis
            | ExprData::ERegExp(_)
            | ExprData::EFunction(_)
            | ExprData::EArrow(_)
            | ExprData::EImportMeta
            | ExprData::EInlinedEnum(_) => return None,

            ExprData::EDot(dot) => {
                if dot.can_be_removed_if_unused {
                    return None;
                }
            }
            ExprData::EIdentifier(ident) => {
                if ident.must_keep_due_to_with_stmt {
                    return Some(expr);
                }

                if ident.can_be_removed_if_unused
                    || p.symbols()[ident.ref_.inner_index()].kind != ast::SymbolKind::Unbound
                {
                    return None;
                }
            }
            ExprData::EIf(ternary) => {
                ternary.yes = Self::simplify_unused_expr(p, ternary.yes).unwrap_or_else(|| ternary.yes.to_empty());
                ternary.no = Self::simplify_unused_expr(p, ternary.no).unwrap_or_else(|| ternary.no.to_empty());

                // "foo() ? 1 : 2" => "foo()"
                if ternary.yes.is_empty() && ternary.no.is_empty() {
                    return Self::simplify_unused_expr(p, ternary.test_);
                }

                // "foo() ? 1 : bar()" => "foo() || bar()"
                if ternary.yes.is_empty() {
                    return Some(Expr::join_with_left_associative_op(
                        Op::BinLogicalOr,
                        ternary.test_,
                        ternary.no,
                        p.allocator(),
                    ));
                }

                // "foo() ? bar() : 2" => "foo() && bar()"
                if ternary.no.is_empty() {
                    return Some(Expr::join_with_left_associative_op(
                        Op::BinLogicalAnd,
                        ternary.test_,
                        ternary.yes,
                        p.allocator(),
                    ));
                }
            }
            ExprData::EUnary(un) => {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                match un.op {
                    Op::UnVoid | Op::UnNot => {
                        return Self::simplify_unused_expr(p, un.value);
                    }
                    Op::UnTypeof => {
                        // "typeof x" must not be transformed into if "x" since doing so could
                        // cause an exception to be thrown. Instead we can just remove it since
                        // "typeof x" is special-cased in the standard to never throw.
                        if matches!(un.value.data, ExprData::EIdentifier(_))
                            && un.flags.was_originally_typeof_identifier
                        {
                            return None;
                        }

                        return Self::simplify_unused_expr(p, un.value);
                    }

                    _ => {}
                }
            }

            // Zig: `inline .e_call, .e_new => |call|` — written out per variant.
            ExprData::ECall(call) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if call.can_be_unwrapped_if_unused != ast::CanBeUnwrapped::Never {
                    if call.args.len() > 0 {
                        let joined = Expr::join_all_with_comma_callback(
                            call.args.slice(),
                            p,
                            Self::simplify_unused_expr,
                            p.allocator(),
                        );
                        if let Some(j) = &joined {
                            if call.can_be_unwrapped_if_unused == ast::CanBeUnwrapped::IfUnusedAndToStringSafe {
                                // PERF(port): @branchHint(.unlikely)
                                // For now, only support this for 1 argument.
                                if j.data.is_safe_to_string() {
                                    return None;
                                }
                            }
                        }
                        return joined;
                    } else {
                        return None;
                    }
                }
            }
            ExprData::ENew(call) => {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if call.can_be_unwrapped_if_unused != ast::CanBeUnwrapped::Never {
                    if call.args.len() > 0 {
                        let joined = Expr::join_all_with_comma_callback(
                            call.args.slice(),
                            p,
                            Self::simplify_unused_expr,
                            p.allocator(),
                        );
                        if let Some(j) = &joined {
                            if call.can_be_unwrapped_if_unused == ast::CanBeUnwrapped::IfUnusedAndToStringSafe {
                                // PERF(port): @branchHint(.unlikely)
                                // For now, only support this for 1 argument.
                                if j.data.is_safe_to_string() {
                                    return None;
                                }
                            }
                        }
                        return joined;
                    } else {
                        return None;
                    }
                }
            }

            ExprData::EBinary(bin) => {
                match bin.op {
                    // These operators must not have any type conversions that can execute code
                    // such as "toString" or "valueOf". They must also never throw any exceptions.
                    Op::BinStrictEq | Op::BinStrictNe | Op::BinComma => {
                        return Self::simplify_unused_binary_comma_expr(p, expr);
                    }

                    // We can simplify "==" and "!=" even though they can call "toString" and/or
                    // "valueOf" if we can statically determine that the types of both sides are
                    // primitives. In that case there won't be any chance for user-defined
                    // "toString" and/or "valueOf" to be called.
                    Op::BinLooseEq
                    | Op::BinLooseNe
                    | Op::BinLt
                    | Op::BinGt
                    | Op::BinLe
                    | Op::BinGe => {
                        if Self::is_primitive_with_side_effects(&bin.left.data)
                            && Self::is_primitive_with_side_effects(&bin.right.data)
                        {
                            let left_simplified = Self::simplify_unused_expr(p, bin.left);
                            let right_simplified = Self::simplify_unused_expr(p, bin.right);

                            // If both sides would be removed entirely, we can return null to remove the whole expression
                            if left_simplified.is_none() && right_simplified.is_none() {
                                return None;
                            }

                            // Otherwise, preserve at least the structure
                            return Some(Expr::join_with_comma(
                                left_simplified.unwrap_or_else(|| bin.left.to_empty()),
                                right_simplified.unwrap_or_else(|| bin.right.to_empty()),
                                p.allocator(),
                            ));
                        }

                        match bin.op {
                            Op::BinLooseEq | Op::BinLooseNe => {
                                // If one side is a number and the other side is a known primitive with side effects,
                                // the number can be printed as `0` since the result being unused doesn't matter,
                                // we only care to invoke the coercion.
                                // We only do this optimization if the other side is a known primitive with side effects
                                // to avoid corrupting shared nodes when the other side is an undefined identifier
                                if matches!(bin.left.data, ExprData::ENumber(_)) {
                                    bin.left.data = ExprData::ENumber(E::Number { value: 0.0 });
                                } else if matches!(bin.right.data, ExprData::ENumber(_)) {
                                    bin.right.data = ExprData::ENumber(E::Number { value: 0.0 });
                                }
                            }
                            _ => {}
                        }
                    }

                    Op::BinLogicalAnd | Op::BinLogicalOr | Op::BinNullishCoalescing => {
                        bin.right = Self::simplify_unused_expr(p, bin.right).unwrap_or_else(|| bin.right.to_empty());
                        // Preserve short-circuit behavior: the left expression is only unused if
                        // the right expression can be completely removed. Otherwise, the left
                        // expression is important for the branch.

                        if bin.right.is_empty() {
                            return Self::simplify_unused_expr(p, bin.left);
                        }
                    }

                    _ => {}
                }
            }

            ExprData::EObject(_) => {
                // Objects with "..." spread expressions can't be unwrapped because the
                // "..." triggers code evaluation via getters. In that case, just trim
                // the other items instead and leave the object expression there.
                // PORT NOTE: reshaped for borrowck — index-based loops to allow in-place mutation.
                // TODO(port): verify G::Property is Copy in the arena model
                let e_object = expr.data.e_object_mut();
                let properties_slice = e_object.properties.slice_mut();
                let mut end: usize = 0;
                let len = properties_slice.len();
                for outer in 0..len {
                    end = 0;
                    if properties_slice[outer].kind == G::PropertyKind::Spread {
                        // Spread properties must always be evaluated
                        for j in 0..len {
                            let mut prop = properties_slice[j];
                            if prop.kind != G::PropertyKind::Spread {
                                let value = Self::simplify_unused_expr(p, prop.value.unwrap());
                                if let Some(value) = value {
                                    prop.value = Some(value);
                                } else if !prop.flags.contains(G::PropertyFlags::IS_COMPUTED) {
                                    continue;
                                } else {
                                    prop.value = Some(p.new_expr(E::Number { value: 0.0 }, prop.value.unwrap().loc));
                                }
                            }

                            properties_slice[end] = prop;
                            end += 1;
                        }

                        let trimmed = &properties_slice[0..end];
                        e_object.properties = G::Property::List::from_borrowed_slice_dangerous(trimmed);
                        return Some(expr);
                    }
                }

                let mut result = Expr::init(E::Missing {}, expr.loc);

                // Otherwise, the object can be completely removed. We only need to keep any
                // object properties with side effects. Apply this simplification recursively.
                for i in 0..len {
                    let prop = properties_slice[i];
                    if prop.flags.contains(G::PropertyFlags::IS_COMPUTED) {
                        // Make sure "ToString" is still evaluated on the key
                        result = result.join_with_comma(
                            p.new_expr(
                                E::Binary {
                                    op: Op::BinAdd,
                                    left: prop.key.unwrap(),
                                    right: p.new_expr(E::String::default(), prop.key.unwrap().loc),
                                },
                                prop.key.unwrap().loc,
                            ),
                            p.allocator(),
                        );
                    }
                    result = result.join_with_comma(
                        Self::simplify_unused_expr(p, prop.value.unwrap())
                            .unwrap_or_else(|| prop.value.unwrap().to_empty()),
                        p.allocator(),
                    );
                }

                if result.is_missing() {
                    return None;
                }

                return Some(result);
            }
            ExprData::EArray(_) => {
                // PORT NOTE: reshaped for borrowck — index-based loops to allow in-place mutation.
                let e_array = expr.data.e_array_mut();
                let items = e_array.items.slice_mut();
                let len = items.len();

                for outer in 0..len {
                    if matches!(items[outer].data, ExprData::ESpread(_)) {
                        let mut end: usize = 0;
                        for j in 0..len {
                            if !matches!(items[j].data, ExprData::EMissing) {
                                items[end] = items[j];
                                end += 1;
                            }
                        }
                        e_array.items.shrink_retaining_capacity(end);
                        return Some(expr);
                    }
                }

                // Otherwise, the array can be completely removed. We only need to keep any
                // array items with side effects. Apply this simplification recursively.
                return Expr::join_all_with_comma_callback(
                    items,
                    p,
                    Self::simplify_unused_expr,
                    p.allocator(),
                );
            }

            _ => {}
        }

        Some(expr)
    }

    ///
    fn simplify_unused_binary_comma_expr<P>(p: &mut P, expr: Expr) -> Option<Expr> {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(expr.data, ExprData::EBinary(_)));
            // SAFETY: asserted above
            let bin = expr.data.e_binary();
            debug_assert!(matches!(
                bin.op,
                Op::BinStrictEq | Op::BinStrictNe | Op::BinComma
            ));
        }
        // PORT NOTE: reshaped for borrowck — re-borrow p.binary_expression_simplify_stack at
        // each access instead of holding a long-lived &mut across simplify_unused_expr(p, ..).
        let stack_bottom = p.binary_expression_simplify_stack().len();

        let root_bin: *const E::Binary = expr.data.e_binary();
        p.binary_expression_simplify_stack()
            .push(BinaryExpressionSimplifyVisitor { bin: root_bin });

        // Build stack up of expressions
        // SAFETY: root_bin points into AST arena store, outlives this fn.
        let mut left: Expr = unsafe { (*root_bin).left };
        loop {
            let left_bin = match &left.data {
                ExprData::EBinary(b) => *b as *const E::Binary,
                _ => break,
            };
            // SAFETY: left_bin points into AST arena store.
            match unsafe { (*left_bin).op } {
                Op::BinStrictEq | Op::BinStrictNe | Op::BinComma => {
                    p.binary_expression_simplify_stack()
                        .push(BinaryExpressionSimplifyVisitor { bin: left_bin });
                    // SAFETY: same as above
                    left = unsafe { (*left_bin).left };
                }
                _ => break,
            }
        }

        // Ride the stack downwards
        let mut i = p.binary_expression_simplify_stack().len();
        let mut result = Self::simplify_unused_expr(p, left).unwrap_or(Expr::EMPTY);
        while i > stack_bottom {
            i -= 1;
            let top = p.binary_expression_simplify_stack()[i];
            // SAFETY: top.bin points into AST arena store, outlives this fn.
            let right = unsafe { (*top.bin).right };
            let visited_right = Self::simplify_unused_expr(p, right).unwrap_or(Expr::EMPTY);
            result = result.join_with_comma(visited_right, p.allocator());
        }

        // Zig: `defer stack.shrinkRetainingCapacity(stack_bottom);`
        p.binary_expression_simplify_stack().truncate(stack_bottom);

        if result.is_missing() {
            None
        } else {
            Some(result)
        }
    }

    fn find_identifiers<'bump>(binding: Binding, decls: &mut bumpalo::collections::Vec<'bump, G::Decl>) {
        match &binding.data {
            BindingData::BIdentifier(_) => {
                decls.push(G::Decl { binding, ..Default::default() });
            }
            BindingData::BArray(array) => {
                for item in array.items.iter() {
                    Self::find_identifiers(item.binding, decls);
                }
            }
            BindingData::BObject(obj) => {
                for item in obj.properties.iter() {
                    Self::find_identifiers(item.value, decls);
                }
            }
            _ => {}
        }
    }

    fn should_keep_stmts_in_dead_control_flow(stmts: &[Stmt], bump: &Bump) -> bool {
        for child in stmts {
            if Self::should_keep_stmt_in_dead_control_flow(*child, bump) {
                return true;
            }
        }
        false
    }

    /// If this is in a dead branch, then we want to trim as much dead code as we
    /// can. Everything can be trimmed except for hoisted declarations ("var" and
    /// "function"), which affect the parent scope. For example:
    ///
    ///   function foo() {
    ///     if (false) { var x; }
    ///     x = 1;
    ///   }
    ///
    /// We can't trim the entire branch as dead or calling foo() will incorrectly
    /// assign to a global variable instead.
    ///
    /// Caller is expected to first check `p.options.dead_code_elimination` so we only check it once.
    pub fn should_keep_stmt_in_dead_control_flow(stmt: Stmt, bump: &Bump) -> bool {
        match &stmt.data {
            // Omit these statements entirely
            StmtData::SEmpty
            | StmtData::SExpr(_)
            | StmtData::SThrow(_)
            | StmtData::SReturn(_)
            | StmtData::SBreak(_)
            | StmtData::SContinue(_)
            | StmtData::SClass(_)
            | StmtData::SDebugger => false,

            StmtData::SLocal(local) => {
                if local.kind != ast::LocalKind::KVar {
                    // Omit these statements entirely
                    return false;
                }

                // Omit everything except the identifiers

                // common case: single var foo = blah, don't need to allocate
                if local.decls.len() == 1
                    && matches!(local.decls.ptr()[0].binding.data, BindingData::BIdentifier(_))
                {
                    let prev = local.decls.ptr()[0];
                    // TODO(port): mutating through shared StmtData payload — verify mutability in Rust AST model
                    stmt.data.s_local_mut().decls.ptr_mut()[0] = G::Decl { binding: prev.binding, ..Default::default() };
                    return true;
                }

                let mut decls = bumpalo::collections::Vec::with_capacity_in(local.decls.len(), bump);
                for decl in local.decls.slice() {
                    Self::find_identifiers(decl.binding, &mut decls);
                }

                // TODO(port): G::Decl::List::move_from_list — port BabyList::moveFromList semantics
                local.decls = G::Decl::List::move_from_vec(decls, bump);
                true
            }

            StmtData::SBlock(block) => {
                Self::should_keep_stmts_in_dead_control_flow(&block.stmts, bump)
            }

            StmtData::STry(try_stmt) => {
                if Self::should_keep_stmts_in_dead_control_flow(&try_stmt.body, bump) {
                    return true;
                }

                if let Some(catch_stmt) = &try_stmt.catch_ {
                    if Self::should_keep_stmts_in_dead_control_flow(&catch_stmt.body, bump) {
                        return true;
                    }
                }

                if let Some(finally_stmt) = &try_stmt.finally {
                    if Self::should_keep_stmts_in_dead_control_flow(&finally_stmt.stmts, bump) {
                        return true;
                    }
                }

                false
            }

            StmtData::SIf(if_) => {
                if Self::should_keep_stmt_in_dead_control_flow(if_.yes, bump) {
                    return true;
                }

                let Some(no) = if_.no else { return false };

                Self::should_keep_stmt_in_dead_control_flow(no, bump)
            }

            StmtData::SWhile(s_while) => {
                Self::should_keep_stmt_in_dead_control_flow(s_while.body, bump)
            }

            StmtData::SDoWhile(s_do_while) => {
                Self::should_keep_stmt_in_dead_control_flow(s_do_while.body, bump)
            }

            StmtData::SFor(for_) => {
                if let Some(init_) = for_.init {
                    if Self::should_keep_stmt_in_dead_control_flow(init_, bump) {
                        return true;
                    }
                }

                Self::should_keep_stmt_in_dead_control_flow(for_.body, bump)
            }

            StmtData::SForIn(for_) => {
                Self::should_keep_stmt_in_dead_control_flow(for_.init, bump)
                    || Self::should_keep_stmt_in_dead_control_flow(for_.body, bump)
            }

            StmtData::SForOf(for_) => {
                Self::should_keep_stmt_in_dead_control_flow(for_.init, bump)
                    || Self::should_keep_stmt_in_dead_control_flow(for_.body, bump)
            }

            StmtData::SLabel(label) => {
                Self::should_keep_stmt_in_dead_control_flow(label.stmt, bump)
            }

            _ => true,
        }
    }

    // Returns true if this expression is known to result in a primitive value (i.e.
    // null, undefined, boolean, number, bigint, or string), even if the expression
    // cannot be removed due to side effects.
    pub fn is_primitive_with_side_effects(data: &ExprData) -> bool {
        match data {
            ExprData::ENull
            | ExprData::EUndefined
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EInlinedEnum(_) => {
                return true;
            }
            ExprData::EUnary(e) => {
                match e.op {
                    // number or bigint
                    Op::UnPos
                    | Op::UnNeg
                    | Op::UnCpl
                    | Op::UnPreDec
                    | Op::UnPreInc
                    | Op::UnPostDec
                    | Op::UnPostInc
                    // boolean
                    | Op::UnNot
                    | Op::UnDelete
                    // undefined
                    | Op::UnVoid
                    // string
                    | Op::UnTypeof => {
                        return true;
                    }
                    _ => {}
                }
            }
            ExprData::EBinary(e) => {
                match e.op {
                    // boolean
                    Op::BinLt
                    | Op::BinLe
                    | Op::BinGt
                    | Op::BinGe
                    | Op::BinIn
                    | Op::BinInstanceof
                    | Op::BinLooseEq
                    | Op::BinLooseNe
                    | Op::BinStrictEq
                    | Op::BinStrictNe
                    // string, number, or bigint
                    | Op::BinAdd
                    | Op::BinAddAssign
                    // number or bigint
                    | Op::BinSub
                    | Op::BinMul
                    | Op::BinDiv
                    | Op::BinRem
                    | Op::BinPow
                    | Op::BinSubAssign
                    | Op::BinMulAssign
                    | Op::BinDivAssign
                    | Op::BinRemAssign
                    | Op::BinPowAssign
                    | Op::BinShl
                    | Op::BinShr
                    | Op::BinUShr
                    | Op::BinShlAssign
                    | Op::BinShrAssign
                    | Op::BinUShrAssign
                    | Op::BinBitwiseOr
                    | Op::BinBitwiseAnd
                    | Op::BinBitwiseXor
                    | Op::BinBitwiseOrAssign
                    | Op::BinBitwiseAndAssign
                    | Op::BinBitwiseXorAssign => {
                        return true;
                    }

                    // These always return one of the arguments unmodified
                    Op::BinLogicalAnd
                    | Op::BinLogicalOr
                    | Op::BinNullishCoalescing
                    | Op::BinLogicalAndAssign
                    | Op::BinLogicalOrAssign
                    | Op::BinNullishCoalescingAssign => {
                        return Self::is_primitive_with_side_effects(&e.left.data)
                            && Self::is_primitive_with_side_effects(&e.right.data);
                    }
                    Op::BinComma => {
                        return Self::is_primitive_with_side_effects(&e.right.data);
                    }
                    _ => {}
                }
            }
            ExprData::EIf(e) => {
                return Self::is_primitive_with_side_effects(&e.yes.data)
                    && Self::is_primitive_with_side_effects(&e.no.data);
            }
            _ => {}
        }
        false
    }

    // Re-export (Zig: `pub const toTypeOf = Expr.Data.typeof;`)
    #[inline(always)]
    pub fn to_type_of(data: &ExprData) -> Option<&'static [u8]> {
        data.typeof_()
    }

    pub fn to_null_or_undefined<P>(p: &P, exp: &ExprData) -> Result {
        if !p.options().features.dead_code_elimination {
            // value should not be read if ok is false, all existing calls to this function already adhere to this
            return Result { ok: false, value: false, side_effects: SideEffects::CouldHaveSideEffects };
        }
        match exp {
            // Never null or undefined
            ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EString(_)
            | ExprData::ERegExp(_)
            | ExprData::EFunction(_)
            | ExprData::EArrow(_)
            | ExprData::EBigInt(_) => {
                return Result { value: false, side_effects: SideEffects::NoSideEffects, ok: true };
            }

            ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EClass(_) => {
                return Result { value: false, side_effects: SideEffects::CouldHaveSideEffects, ok: true };
            }

            // always a null or undefined
            ExprData::ENull | ExprData::EUndefined => {
                return Result { value: true, side_effects: SideEffects::NoSideEffects, ok: true };
            }

            ExprData::EUnary(e) => {
                match e.op {
                    // Always number or bigint
                    Op::UnPos
                    | Op::UnNeg
                    | Op::UnCpl
                    | Op::UnPreDec
                    | Op::UnPreInc
                    | Op::UnPostDec
                    | Op::UnPostInc

                    // Always boolean
                    | Op::UnNot
                    | Op::UnTypeof
                    | Op::UnDelete => {
                        return Result { ok: true, value: false, side_effects: SideEffects::CouldHaveSideEffects };
                    }

                    // Always undefined
                    Op::UnVoid => {
                        return Result { value: true, side_effects: SideEffects::CouldHaveSideEffects, ok: true };
                    }

                    _ => {}
                }
            }

            ExprData::EBinary(e) => {
                match e.op {
                    // always string or number or bigint
                    Op::BinAdd
                    | Op::BinAddAssign
                    // always number or bigint
                    | Op::BinSub
                    | Op::BinMul
                    | Op::BinDiv
                    | Op::BinRem
                    | Op::BinPow
                    | Op::BinSubAssign
                    | Op::BinMulAssign
                    | Op::BinDivAssign
                    | Op::BinRemAssign
                    | Op::BinPowAssign
                    | Op::BinShl
                    | Op::BinShr
                    | Op::BinUShr
                    | Op::BinShlAssign
                    | Op::BinShrAssign
                    | Op::BinUShrAssign
                    | Op::BinBitwiseOr
                    | Op::BinBitwiseAnd
                    | Op::BinBitwiseXor
                    | Op::BinBitwiseOrAssign
                    | Op::BinBitwiseAndAssign
                    | Op::BinBitwiseXorAssign
                    // always boolean
                    | Op::BinLt
                    | Op::BinLe
                    | Op::BinGt
                    | Op::BinGe
                    | Op::BinIn
                    | Op::BinInstanceof
                    | Op::BinLooseEq
                    | Op::BinLooseNe
                    | Op::BinStrictEq
                    | Op::BinStrictNe => {
                        return Result { ok: true, value: false, side_effects: SideEffects::CouldHaveSideEffects };
                    }

                    Op::BinComma => {
                        let res = Self::to_null_or_undefined(p, &e.right.data);
                        if res.ok {
                            return Result { ok: true, value: res.value, side_effects: SideEffects::CouldHaveSideEffects };
                        }
                    }
                    _ => {}
                }
            }
            ExprData::EInlinedEnum(inlined) => {
                return Self::to_null_or_undefined(p, &inlined.value.data);
            }
            _ => {}
        }

        Result { ok: false, value: false, side_effects: SideEffects::CouldHaveSideEffects }
    }

    pub fn to_boolean<P>(p: &P, exp: &ExprData) -> Result {
        // Only do this check once.
        if !p.options().features.dead_code_elimination {
            // value should not be read if ok is false, all existing calls to this function already adhere to this
            return Result { ok: false, value: false, side_effects: SideEffects::CouldHaveSideEffects };
        }

        Self::to_boolean_without_dce_check(exp)
    }

    // Avoid passing through *P
    // This is a very recursive function.
    fn to_boolean_without_dce_check(exp: &ExprData) -> Result {
        match exp {
            ExprData::ENull | ExprData::EUndefined => {
                return Result { ok: true, value: false, side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EBoolean(e) => {
                return Result { ok: true, value: e.value, side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EBranchBoolean(e) => {
                return Result { ok: true, value: e.value, side_effects: SideEffects::NoSideEffects };
            }
            ExprData::ENumber(e) => {
                return Result { ok: true, value: e.value != 0.0 && !e.value.is_nan(), side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EBigInt(e) => {
                return Result { ok: true, value: e.value != b"0", side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EString(e) => {
                return Result { ok: true, value: e.is_present(), side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EFunction(_) | ExprData::EArrow(_) | ExprData::ERegExp(_) => {
                return Result { ok: true, value: true, side_effects: SideEffects::NoSideEffects };
            }
            ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EClass(_) => {
                return Result { ok: true, value: true, side_effects: SideEffects::CouldHaveSideEffects };
            }
            ExprData::EUnary(e_) => {
                match e_.op {
                    Op::UnVoid => {
                        return Result { ok: true, value: false, side_effects: SideEffects::CouldHaveSideEffects };
                    }
                    Op::UnTypeof => {
                        // Never an empty string

                        return Result { ok: true, value: true, side_effects: SideEffects::CouldHaveSideEffects };
                    }
                    Op::UnNot => {
                        let result = Self::to_boolean_without_dce_check(&e_.value.data);
                        if result.ok {
                            return Result { ok: true, value: !result.value, side_effects: result.side_effects };
                        }
                    }
                    _ => {}
                }
            }
            ExprData::EBinary(e_) => {
                match e_.op {
                    Op::BinLogicalOr => {
                        // "anything || truthy" is truthy
                        let result = Self::to_boolean_without_dce_check(&e_.right.data);
                        if result.value && result.ok {
                            return Result { ok: true, value: true, side_effects: SideEffects::CouldHaveSideEffects };
                        }
                    }
                    Op::BinLogicalAnd => {
                        // "anything && falsy" is falsy
                        let result = Self::to_boolean_without_dce_check(&e_.right.data);
                        if !result.value && result.ok {
                            return Result { ok: true, value: false, side_effects: SideEffects::CouldHaveSideEffects };
                        }
                    }
                    Op::BinComma => {
                        // "anything, truthy/falsy" is truthy/falsy
                        let mut result = Self::to_boolean_without_dce_check(&e_.right.data);
                        if result.ok {
                            result.side_effects = SideEffects::CouldHaveSideEffects;
                            return result;
                        }
                    }
                    Op::BinGt => {
                        if let Some(left_num) = e_.left.data.to_finite_number() {
                            if let Some(right_num) = e_.right.data.to_finite_number() {
                                return Result { ok: true, value: left_num > right_num, side_effects: SideEffects::NoSideEffects };
                            }
                        }
                    }
                    Op::BinLt => {
                        if let Some(left_num) = e_.left.data.to_finite_number() {
                            if let Some(right_num) = e_.right.data.to_finite_number() {
                                return Result { ok: true, value: left_num < right_num, side_effects: SideEffects::NoSideEffects };
                            }
                        }
                    }
                    Op::BinLe => {
                        if let Some(left_num) = e_.left.data.to_finite_number() {
                            if let Some(right_num) = e_.right.data.to_finite_number() {
                                return Result { ok: true, value: left_num <= right_num, side_effects: SideEffects::NoSideEffects };
                            }
                        }
                    }
                    Op::BinGe => {
                        if let Some(left_num) = e_.left.data.to_finite_number() {
                            if let Some(right_num) = e_.right.data.to_finite_number() {
                                return Result { ok: true, value: left_num >= right_num, side_effects: SideEffects::NoSideEffects };
                            }
                        }
                    }
                    _ => {}
                }
            }
            ExprData::EInlinedEnum(inlined) => {
                return Self::to_boolean_without_dce_check(&inlined.value.data);
            }
            ExprData::ESpecial(special) => match special {
                ast::ESpecial::ModuleExports
                | ast::ESpecial::ResolvedSpecifierString
                | ast::ESpecial::HotData => {}
                ast::ESpecial::HotAccept
                | ast::ESpecial::HotAcceptVisited
                | ast::ESpecial::HotEnabled => {
                    return Result { ok: true, value: true, side_effects: SideEffects::NoSideEffects };
                }
                ast::ESpecial::HotDisabled => {
                    return Result { ok: true, value: false, side_effects: SideEffects::NoSideEffects };
                }
            },
            _ => {}
        }

        Result { ok: false, value: false, side_effects: SideEffects::CouldHaveSideEffects }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/SideEffects.zig (915 lines)
//   confidence: medium
//   todos:      5
//   notes:      `p: anytype` → unbounded `<P>`; ExprData/StmtData variant names + payload mutability (arena refs) need Phase-B reconciliation; e_object/e_array reshaped to index loops for borrowck; find_identifiers/decls now bumpalo-backed per §Allocators
// ──────────────────────────────────────────────────────────────────────────
