#![allow(unused_imports, unused_variables, dead_code, unused_mut)]
#![warn(unused_must_use)]
use crate::p::P;
use bun_alloc::Arena as Bump;
use bun_ast::e::CallUnwrap;
use bun_ast::symbol;
use bun_ast::{self, Binding, E, Expr, ExprData, G, Op, Stmt, StmtData, StoreRef};
use bun_collections::VecExt;

// PORT NOTE: round-E un-gate. SideEffects in Zig is an enum with associated fns that
// take `p: anytype`. Round-E converts the unbounded `<P>` generic to concrete
// `P<'a, TS, SCAN>`. Method bodies gated; the `Result` type and enum surface are real.

#[repr(u8)] // Zig: enum(u1) — Rust has no u1 repr; u8 is the smallest
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum SideEffects {
    #[default]
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
        left == right
            && left != bun_ast::expr::PrimitiveType::Unknown
            && left != bun_ast::expr::PrimitiveType::Mixed
    }

    pub fn simplify_boolean<'a, const TS: bool, const SCAN: bool>(
        p: &P<'a, TS, SCAN>,
        expr: Expr,
    ) -> Expr {
        if !p.options.features.dead_code_elimination {
            return expr;
        }
        let mut result: Expr = expr;
        Self::_simplify_boolean(p, &mut result);
        result
    }

    fn _simplify_boolean<'a, const TS: bool, const SCAN: bool>(
        p: &P<'a, TS, SCAN>,
        expr: &mut Expr,
    ) {
        loop {
            match &mut expr.data {
                ExprData::EUnary(e) => {
                    if e.op == Op::Code::UnNot {
                        // "!!a" => "a"
                        if let ExprData::EUnary(inner) = &e.value.data {
                            if inner.op == Op::Code::UnNot {
                                *expr = inner.value;
                                continue;
                            }
                        }
                        Self::_simplify_boolean(p, &mut e.value);
                    }
                }
                ExprData::EBinary(e) => match e.op {
                    Op::Code::BinLogicalAnd => {
                        let effects = SideEffects::to_boolean(p, &e.right.data);
                        if effects.ok
                            && effects.value
                            && effects.side_effects == SideEffects::NoSideEffects
                        {
                            // "if (anything && truthyNoSideEffects)" => "if (anything)"
                            *expr = e.left;
                            continue;
                        }
                    }
                    Op::Code::BinLogicalOr => {
                        let effects = SideEffects::to_boolean(p, &e.right.data);
                        if effects.ok
                            && !effects.value
                            && effects.side_effects == SideEffects::NoSideEffects
                        {
                            // "if (anything || falsyNoSideEffects)" => "if (anything)"
                            *expr = e.left;
                            continue;
                        }
                    }
                    _ => {}
                },
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
    #[inline(always)]
    pub fn to_type_of(data: &ExprData) -> Option<&'static [u8]> {
        data.to_typeof()
    }

    pub fn is_primitive_to_reorder(data: &ExprData) -> bool {
        matches!(
            data,
            ExprData::ENull(_)
                | ExprData::EUndefined(_)
                | ExprData::EString(_)
                | ExprData::EBoolean(_)
                | ExprData::EBranchBoolean(_)
                | ExprData::ENumber(_)
                | ExprData::EBigInt(_)
                | ExprData::EInlinedEnum(_)
                | ExprData::ERequireMain
        )
    }

    pub fn simplify_unused_expr<'a, const TS: bool, const SCAN: bool>(
        p: &mut P<'a, TS, SCAN>,
        expr: Expr,
    ) -> Option<Expr> {
        if !p.options.features.dead_code_elimination {
            return Some(expr);
        }
        // PORT NOTE: `Expr`/`ExprData`/`StoreRef<_>` are all `Copy`. We match on
        // `expr.data` *by value* so `expr` itself is never borrowed across a
        // recursive `simplify_unused_expr(p, ..)` call. Mutations to boxed
        // payloads write through `StoreRef::DerefMut` into the arena, so they
        // persist even though the `StoreRef` binding is a local copy.
        match expr.data {
            ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EMissing(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EThis(_)
            | ExprData::ERegExp(_)
            | ExprData::EFunction(_)
            | ExprData::EArrow(_)
            | ExprData::EImportMeta(_)
            | ExprData::EInlinedEnum(_) => return None,

            ExprData::EDot(dot) => {
                if dot.can_be_removed_if_unused {
                    return None;
                }
            }
            ExprData::EIdentifier(ident) => {
                if ident.must_keep_due_to_with_stmt() {
                    return Some(expr);
                }

                if ident.can_be_removed_if_unused()
                    || p.symbols[ident.ref_.inner_index() as usize].kind != symbol::Kind::Unbound
                {
                    return None;
                }
            }
            ExprData::EIf(mut ternary) => {
                let yes = ternary.yes;
                ternary.yes = Self::simplify_unused_expr(p, yes).unwrap_or_else(|| yes.to_empty());
                let no = ternary.no;
                ternary.no = Self::simplify_unused_expr(p, no).unwrap_or_else(|| no.to_empty());

                // "foo() ? 1 : 2" => "foo()"
                if ternary.yes.is_empty() && ternary.no.is_empty() {
                    return Self::simplify_unused_expr(p, ternary.test_);
                }

                // "foo() ? 1 : bar()" => "foo() || bar()"
                if ternary.yes.is_empty() {
                    return Some(Expr::join_with_left_associative_op(
                        Op::Code::BinLogicalOr,
                        ternary.test_,
                        ternary.no,
                    ));
                }

                // "foo() ? bar() : 2" => "foo() && bar()"
                if ternary.no.is_empty() {
                    return Some(Expr::join_with_left_associative_op(
                        Op::Code::BinLogicalAnd,
                        ternary.test_,
                        ternary.yes,
                    ));
                }
            }
            ExprData::EUnary(un) => {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                match un.op {
                    Op::Code::UnVoid | Op::Code::UnNot => {
                        return Self::simplify_unused_expr(p, un.value);
                    }
                    Op::Code::UnTypeof => {
                        // "typeof x" must not be transformed into if "x" since doing so could
                        // cause an exception to be thrown. Instead we can just remove it since
                        // "typeof x" is special-cased in the standard to never throw.
                        if matches!(un.value.data, ExprData::EIdentifier(_))
                            && un
                                .flags
                                .contains(E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER)
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
                if call.can_be_unwrapped_if_unused != CallUnwrap::Never {
                    if call.args.len_u32() > 0 {
                        let joined = Self::join_all_simplified(p, &call.args);
                        if let Some(j) = &joined {
                            if call.can_be_unwrapped_if_unused
                                == CallUnwrap::IfUnusedAndToStringSafe
                            {
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
                if call.can_be_unwrapped_if_unused != CallUnwrap::Never {
                    if call.args.len_u32() > 0 {
                        let joined = Self::join_all_simplified(p, &call.args);
                        if let Some(j) = &joined {
                            if call.can_be_unwrapped_if_unused
                                == CallUnwrap::IfUnusedAndToStringSafe
                            {
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

            ExprData::EBinary(mut bin) => {
                match bin.op {
                    // These operators must not have any type conversions that can execute code
                    // such as "toString" or "valueOf". They must also never throw any exceptions.
                    Op::Code::BinStrictEq | Op::Code::BinStrictNe | Op::Code::BinComma => {
                        return Self::simplify_unused_binary_comma_expr(p, expr);
                    }

                    // We can simplify "==" and "!=" even though they can call "toString" and/or
                    // "valueOf" if we can statically determine that the types of both sides are
                    // primitives. In that case there won't be any chance for user-defined
                    // "toString" and/or "valueOf" to be called.
                    Op::Code::BinLooseEq
                    | Op::Code::BinLooseNe
                    | Op::Code::BinLt
                    | Op::Code::BinGt
                    | Op::Code::BinLe
                    | Op::Code::BinGe => {
                        if Self::is_primitive_with_side_effects(&bin.left.data)
                            && Self::is_primitive_with_side_effects(&bin.right.data)
                        {
                            let left = bin.left;
                            let right = bin.right;
                            let left_simplified = Self::simplify_unused_expr(p, left);
                            let right_simplified = Self::simplify_unused_expr(p, right);

                            // If both sides would be removed entirely, we can return null to remove the whole expression
                            if left_simplified.is_none() && right_simplified.is_none() {
                                return None;
                            }

                            // Otherwise, preserve at least the structure
                            return Some(Expr::join_with_comma(
                                left_simplified.unwrap_or_else(|| left.to_empty()),
                                right_simplified.unwrap_or_else(|| right.to_empty()),
                            ));
                        }

                        match bin.op {
                            Op::Code::BinLooseEq | Op::Code::BinLooseNe => {
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

                    Op::Code::BinLogicalAnd
                    | Op::Code::BinLogicalOr
                    | Op::Code::BinNullishCoalescing => {
                        let right = bin.right;
                        bin.right = Self::simplify_unused_expr(p, right)
                            .unwrap_or_else(|| right.to_empty());
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

            ExprData::EObject(mut e_object) => {
                // Objects with "..." spread expressions can't be unwrapped because the
                // "..." triggers code evaluation via getters. In that case, just trim
                // the other items instead and leave the object expression there.
                let len = e_object.properties.len_u32() as usize;
                let mut has_spread = false;
                for i in 0..len {
                    if e_object.properties.at(i).kind == G::PropertyKind::Spread {
                        has_spread = true;
                        break;
                    }
                }
                if has_spread {
                    // Spread properties must always be evaluated
                    let mut end: usize = 0;
                    for j in 0..len {
                        let kind = e_object.properties.at(j).kind;
                        if kind != G::PropertyKind::Spread {
                            let prev_value = e_object.properties.at(j).value.unwrap();
                            let is_computed = e_object
                                .properties
                                .at(j)
                                .flags
                                .contains(bun_ast::flags::Property::IsComputed);
                            let value = Self::simplify_unused_expr(p, prev_value);
                            if let Some(value) = value {
                                e_object.properties.mut_(j).value = Some(value);
                            } else if !is_computed {
                                continue;
                            } else {
                                let zero = p.new_expr(E::Number { value: 0.0 }, prev_value.loc);
                                e_object.properties.mut_(j).value = Some(zero);
                            }
                        }

                        // PORT NOTE: G::Property is not Copy (Vec ts_decorators
                        // field). The Zig spec does an in-place struct copy; here we
                        // swap so the kept property lands at `end` without cloning.
                        e_object.properties.slice_mut().swap(end, j);
                        end += 1;
                    }
                    e_object.properties.shrink_retaining_capacity(end);
                    return Some(expr);
                }

                let mut result = Expr {
                    data: ExprData::EMissing(E::Missing {}),
                    loc: expr.loc,
                };

                // Otherwise, the object can be completely removed. We only need to keep any
                // object properties with side effects. Apply this simplification recursively.
                for i in 0..len {
                    let flags = e_object.properties.at(i).flags;
                    let key = e_object.properties.at(i).key;
                    let value = e_object.properties.at(i).value;
                    if flags.contains(bun_ast::flags::Property::IsComputed) {
                        // Make sure "ToString" is still evaluated on the key
                        let key_expr = key.unwrap();
                        let right = p.new_expr(E::String::default(), key_expr.loc);
                        let bin = p.new_expr(
                            E::Binary {
                                op: Op::Code::BinAdd,
                                left: key_expr,
                                right,
                            },
                            key_expr.loc,
                        );
                        result = Expr::join_with_comma(result, bin);
                    }
                    let v = value.unwrap();
                    result = Expr::join_with_comma(
                        result,
                        Self::simplify_unused_expr(p, v).unwrap_or_else(|| v.to_empty()),
                    );
                }

                if result.is_missing() {
                    return None;
                }

                return Some(result);
            }
            ExprData::EArray(mut arr) => {
                let len = arr.items.len_u32() as usize;

                // Arrays with "..." spread expressions can't be unwrapped because the
                // "..." triggers code evaluation via iterators. In that case, just trim
                // the missing items instead and leave the array expression there.
                let mut has_spread = false;
                for i in 0..len {
                    if matches!(arr.items.at(i).data, ExprData::ESpread(_)) {
                        has_spread = true;
                        break;
                    }
                }
                if has_spread {
                    let items = arr.items.slice_mut();
                    let mut end: usize = 0;
                    for j in 0..len {
                        if !matches!(items[j].data, ExprData::EMissing(_)) {
                            items[end] = items[j];
                            end += 1;
                        }
                    }
                    arr.items.shrink_retaining_capacity(end);
                    return Some(expr);
                }

                // Otherwise, the array can be completely removed. We only need to keep any
                // array items with side effects. Apply this simplification recursively.
                return Self::join_all_simplified(p, &arr.items);
            }

            _ => {}
        }

        Some(expr)
    }

    /// Inline equivalent of `Expr::join_all_with_comma_callback(slice, p, simplify_unused_expr, _)`.
    /// Hand-rolled because that helper takes `fn(&C, _)` and we need `&mut P` for the
    /// recursive `simplify_unused_expr` call.
    fn join_all_simplified<'a, const TS: bool, const SCAN: bool>(
        p: &mut P<'a, TS, SCAN>,
        items: &[Expr],
    ) -> Option<Expr> {
        let len = items.len();
        if len == 0 {
            return None;
        }
        let mut result = Expr {
            data: ExprData::EMissing(E::Missing {}),
            loc: items[0].loc,
        };
        for i in 0..len {
            // Copy the Expr out of the arena slice before recursing so the borrow
            // of `items` is released across the `&mut P` call.
            let item: Expr = items[i];
            let simplified = Self::simplify_unused_expr(p, item).unwrap_or(Expr {
                data: ExprData::EMissing(E::Missing {}),
                loc: item.loc,
            });
            result = Expr::join_with_comma(result, simplified);
        }
        if result.is_missing() {
            None
        } else {
            Some(result)
        }
    }

    ///
    fn simplify_unused_binary_comma_expr<'a, const TS: bool, const SCAN: bool>(
        p: &mut P<'a, TS, SCAN>,
        expr: Expr,
    ) -> Option<Expr> {
        let ExprData::EBinary(root_bin) = expr.data else {
            if cfg!(debug_assertions) {
                unreachable!("simplify_unused_binary_comma_expr: not e_binary");
            }
            return Some(expr);
        };
        debug_assert!(matches!(
            root_bin.op,
            Op::Code::BinStrictEq | Op::Code::BinStrictNe | Op::Code::BinComma
        ));

        // PORT NOTE: Zig threads `p.binary_expression_simplify_stack` (a reusable
        // ArrayList on `P`) to avoid per-call allocation. The Rust `P` field is
        // currently `ListManaged<'a, ()>` (placeholder element type — see P.rs:537),
        // so until that's reshaped to `BinaryExpressionSimplifyVisitor` we use a
        // local Vec. Same iteration order; only the arena differs.
        let mut stack: Vec<StoreRef<E::Binary>> = Vec::with_capacity(8);
        stack.push(root_bin);

        // Build stack up of expressions
        let mut left: Expr = root_bin.left;
        while let ExprData::EBinary(left_bin) = left.data {
            match left_bin.op {
                Op::Code::BinStrictEq | Op::Code::BinStrictNe | Op::Code::BinComma => {
                    stack.push(left_bin);
                    left = left_bin.left;
                }
                _ => break,
            }
        }

        // Ride the stack downwards
        let mut i = stack.len();
        let mut result = Self::simplify_unused_expr(p, left).unwrap_or(Expr::EMPTY);
        while i > 0 {
            i -= 1;
            let top = stack[i];
            let right = top.right;
            let visited_right = Self::simplify_unused_expr(p, right).unwrap_or(Expr::EMPTY);
            result = Expr::join_with_comma(result, visited_right);
        }

        if result.is_missing() {
            None
        } else {
            Some(result)
        }
    }

    fn find_identifiers(binding: Binding, decls: &mut Vec<G::Decl>) {
        match binding.data {
            bun_ast::binding::Data::BIdentifier(_) => {
                decls.push(G::Decl {
                    binding,
                    value: None,
                });
            }
            bun_ast::binding::Data::BArray(array) => {
                for item in array.items.slice() {
                    Self::find_identifiers(item.binding, decls);
                }
            }
            bun_ast::binding::Data::BObject(obj) => {
                for item in obj.properties.slice() {
                    Self::find_identifiers(item.value, decls);
                }
            }
            _ => {}
        }
    }

    fn should_keep_stmts_in_dead_control_flow(stmts: bun_ast::StmtNodeList, bump: &Bump) -> bool {
        for child in stmts.slice() {
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
        match stmt.data {
            // Omit these statements entirely
            StmtData::SEmpty(_)
            | StmtData::SExpr(_)
            | StmtData::SThrow(_)
            | StmtData::SReturn(_)
            | StmtData::SBreak(_)
            | StmtData::SContinue(_)
            | StmtData::SClass(_)
            | StmtData::SDebugger(_) => false,

            StmtData::SLocal(mut local) => {
                if local.kind != bun_ast::S::Kind::KVar {
                    // Omit these statements entirely
                    return false;
                }

                // Omit everything except the identifiers

                // common case: single var foo = blah, don't need to allocate
                if local.decls.len_u32() == 1
                    && matches!(
                        local.decls.at(0).binding.data,
                        bun_ast::binding::Data::BIdentifier(_)
                    )
                {
                    let prev_binding = local.decls.at(0).binding;
                    *local.decls.mut_(0) = G::Decl {
                        binding: prev_binding,
                        value: None,
                    };
                    return true;
                }

                let mut decls: Vec<G::Decl> = Vec::with_capacity(local.decls.len_u32() as usize);
                for i in 0..(local.decls.len_u32() as usize) {
                    let binding = local.decls.at(i).binding;
                    Self::find_identifiers(binding, &mut decls);
                }

                local.decls = G::DeclList::move_from_list(decls);
                true
            }

            StmtData::SBlock(block) => {
                Self::should_keep_stmts_in_dead_control_flow(block.stmts, bump)
            }

            StmtData::STry(try_stmt) => {
                if Self::should_keep_stmts_in_dead_control_flow(try_stmt.body, bump) {
                    return true;
                }
                if let Some(catch_stmt) = &try_stmt.catch_ {
                    if Self::should_keep_stmts_in_dead_control_flow(catch_stmt.body, bump) {
                        return true;
                    }
                }
                if let Some(finally_stmt) = &try_stmt.finally {
                    if Self::should_keep_stmts_in_dead_control_flow(finally_stmt.stmts, bump) {
                        return true;
                    }
                }
                false
            }

            StmtData::SIf(if_) => {
                if Self::should_keep_stmt_in_dead_control_flow(if_.yes, bump) {
                    return true;
                }
                match if_.no {
                    Some(no) => Self::should_keep_stmt_in_dead_control_flow(no, bump),
                    None => false,
                }
            }

            StmtData::SWhile(while_) => {
                Self::should_keep_stmt_in_dead_control_flow(while_.body, bump)
            }

            StmtData::SDoWhile(do_while) => {
                Self::should_keep_stmt_in_dead_control_flow(do_while.body, bump)
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

    pub fn is_primitive_with_side_effects(data: &ExprData) -> bool {
        match data {
            ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EInlinedEnum(_) => true,
            ExprData::EUnary(e) => matches!(
                e.op,
                // number or bigint
                Op::Code::UnPos | Op::Code::UnNeg | Op::Code::UnCpl
                | Op::Code::UnPreDec | Op::Code::UnPreInc
                | Op::Code::UnPostDec | Op::Code::UnPostInc
                // boolean
                | Op::Code::UnNot | Op::Code::UnDelete
                // undefined
                | Op::Code::UnVoid
                // string
                | Op::Code::UnTypeof
            ),
            ExprData::EBinary(e) => match e.op {
                // boolean
                Op::Code::BinStrictEq | Op::Code::BinStrictNe | Op::Code::BinLooseEq
                | Op::Code::BinLooseNe | Op::Code::BinLt | Op::Code::BinGt
                | Op::Code::BinLe | Op::Code::BinGe | Op::Code::BinInstanceof
                | Op::Code::BinIn
                // string, number, or bigint
                | Op::Code::BinAdd | Op::Code::BinAddAssign
                // number or bigint
                | Op::Code::BinSub | Op::Code::BinMul | Op::Code::BinDiv
                | Op::Code::BinRem | Op::Code::BinPow
                | Op::Code::BinSubAssign | Op::Code::BinMulAssign | Op::Code::BinDivAssign
                | Op::Code::BinRemAssign | Op::Code::BinPowAssign
                | Op::Code::BinShl | Op::Code::BinShr | Op::Code::BinUShr
                | Op::Code::BinShlAssign | Op::Code::BinShrAssign | Op::Code::BinUShrAssign
                | Op::Code::BinBitwiseOr | Op::Code::BinBitwiseAnd | Op::Code::BinBitwiseXor
                | Op::Code::BinBitwiseOrAssign | Op::Code::BinBitwiseAndAssign
                | Op::Code::BinBitwiseXorAssign => true,
                // These always return one of the arguments unmodified
                Op::Code::BinLogicalAnd | Op::Code::BinLogicalOr | Op::Code::BinNullishCoalescing
                | Op::Code::BinLogicalAndAssign | Op::Code::BinLogicalOrAssign
                | Op::Code::BinNullishCoalescingAssign => {
                    Self::is_primitive_with_side_effects(&e.left.data)
                        && Self::is_primitive_with_side_effects(&e.right.data)
                }
                Op::Code::BinComma => {
                    Self::is_primitive_with_side_effects(&e.right.data)
                }
                _ => false,
            },
            ExprData::EIf(e) => {
                Self::is_primitive_with_side_effects(&e.yes.data)
                    && Self::is_primitive_with_side_effects(&e.no.data)
            }
            _ => false,
        }
    }

    pub fn to_null_or_undefined<'a, const TS: bool, const SCAN: bool>(
        p: &P<'a, TS, SCAN>,
        exp: &ExprData,
    ) -> Result {
        if !p.options.features.dead_code_elimination {
            // value should not be read if ok is false, all existing calls already adhere to this
            return Result {
                ok: false,
                value: false,
                side_effects: SideEffects::CouldHaveSideEffects,
            };
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
            | ExprData::EBigInt(_) => Result {
                value: false,
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EClass(_) => Result {
                value: false,
                side_effects: SideEffects::CouldHaveSideEffects,
                ok: true,
            },
            // Always null or undefined
            ExprData::ENull(_) | ExprData::EUndefined(_) => Result {
                value: true,
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EUnary(e) => match e.op {
                // Always number or bigint
                Op::Code::UnPos | Op::Code::UnNeg | Op::Code::UnCpl
                | Op::Code::UnPreDec | Op::Code::UnPreInc
                | Op::Code::UnPostDec | Op::Code::UnPostInc
                // Always boolean
                | Op::Code::UnNot | Op::Code::UnTypeof | Op::Code::UnDelete => {
                    Result { value: false, side_effects: SideEffects::CouldHaveSideEffects, ok: true }
                }
                // Always undefined
                Op::Code::UnVoid => {
                    Result { value: true, side_effects: SideEffects::CouldHaveSideEffects, ok: true }
                }
                _ => Result::default(),
            },
            ExprData::EBinary(e) => match e.op {
                // always string or number or bigint
                Op::Code::BinAdd | Op::Code::BinAddAssign
                // always number or bigint
                | Op::Code::BinSub | Op::Code::BinMul | Op::Code::BinDiv
                | Op::Code::BinRem | Op::Code::BinPow
                | Op::Code::BinSubAssign | Op::Code::BinMulAssign | Op::Code::BinDivAssign
                | Op::Code::BinRemAssign | Op::Code::BinPowAssign
                | Op::Code::BinShl | Op::Code::BinShr | Op::Code::BinUShr
                | Op::Code::BinShlAssign | Op::Code::BinShrAssign | Op::Code::BinUShrAssign
                | Op::Code::BinBitwiseOr | Op::Code::BinBitwiseAnd | Op::Code::BinBitwiseXor
                | Op::Code::BinBitwiseOrAssign | Op::Code::BinBitwiseAndAssign
                | Op::Code::BinBitwiseXorAssign
                // always boolean
                | Op::Code::BinStrictEq | Op::Code::BinStrictNe | Op::Code::BinLooseEq
                | Op::Code::BinLooseNe | Op::Code::BinLt | Op::Code::BinGt
                | Op::Code::BinLe | Op::Code::BinGe | Op::Code::BinInstanceof
                | Op::Code::BinIn => {
                    Result { ok: true, value: false, side_effects: SideEffects::CouldHaveSideEffects }
                }
                Op::Code::BinComma => {
                    let res = Self::to_null_or_undefined(p, &e.right.data);
                    if res.ok {
                        Result { value: res.value, side_effects: SideEffects::CouldHaveSideEffects, ok: true }
                    } else {
                        Result::default()
                    }
                }
                _ => Result::default(),
            },
            ExprData::EInlinedEnum(e) => Self::to_null_or_undefined(p, &e.value.data),
            _ => Result::default(),
        }
    }

    pub fn to_boolean<'a, const TS: bool, const SCAN: bool>(
        p: &P<'a, TS, SCAN>,
        exp: &ExprData,
    ) -> Result {
        if !p.options.features.dead_code_elimination {
            return Result::default();
        }
        match exp {
            ExprData::ENull(_) | ExprData::EUndefined(_) => Result {
                value: false,
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EBoolean(e) | ExprData::EBranchBoolean(e) => Result {
                value: e.value,
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::ENumber(e) => Result {
                value: e.value != 0.0 && !e.value.is_nan(),
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EBigInt(e) => {
                let v = e.value.slice();
                Result {
                    value: !bun_core::eql_comptime(v, b"0"),
                    side_effects: SideEffects::NoSideEffects,
                    ok: true,
                }
            }
            ExprData::EString(e) => Result {
                // Zig: `e.isPresent()` — open-coded to dodge an ambiguous inherent
                // `len()` while E.rs's duplicate `impl EString` blocks are being merged.
                value: e.rope_len > 0 || !e.data.is_empty(),
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EFunction(_) | ExprData::EArrow(_) | ExprData::ERegExp(_) => Result {
                value: true,
                side_effects: SideEffects::NoSideEffects,
                ok: true,
            },
            ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EClass(_) => Result {
                value: true,
                side_effects: SideEffects::CouldHaveSideEffects,
                ok: true,
            },
            ExprData::EUnary(e) => match e.op {
                Op::Code::UnVoid => Result {
                    value: false,
                    side_effects: SideEffects::CouldHaveSideEffects,
                    ok: true,
                },
                Op::Code::UnTypeof => {
                    // Never an empty string
                    Result {
                        value: true,
                        side_effects: SideEffects::CouldHaveSideEffects,
                        ok: true,
                    }
                }
                Op::Code::UnNot => {
                    let res = Self::to_boolean(p, &e.value.data);
                    if res.ok {
                        Result {
                            value: !res.value,
                            side_effects: res.side_effects,
                            ok: true,
                        }
                    } else {
                        Result::default()
                    }
                }
                _ => Result::default(),
            },
            ExprData::EBinary(e) => match e.op {
                Op::Code::BinLogicalOr => {
                    let res = Self::to_boolean(p, &e.right.data);
                    if res.ok && res.value {
                        Result {
                            value: true,
                            side_effects: SideEffects::CouldHaveSideEffects,
                            ok: true,
                        }
                    } else {
                        Result::default()
                    }
                }
                Op::Code::BinLogicalAnd => {
                    let res = Self::to_boolean(p, &e.right.data);
                    if res.ok && !res.value {
                        Result {
                            value: false,
                            side_effects: SideEffects::CouldHaveSideEffects,
                            ok: true,
                        }
                    } else {
                        Result::default()
                    }
                }
                Op::Code::BinComma => {
                    let res = Self::to_boolean(p, &e.right.data);
                    if res.ok {
                        Result {
                            value: res.value,
                            side_effects: SideEffects::CouldHaveSideEffects,
                            ok: true,
                        }
                    } else {
                        Result::default()
                    }
                }
                Op::Code::BinGt => {
                    if let Some(left_num) = e.left.data.to_finite_number() {
                        if let Some(right_num) = e.right.data.to_finite_number() {
                            return Result {
                                ok: true,
                                value: left_num > right_num,
                                side_effects: SideEffects::NoSideEffects,
                            };
                        }
                    }
                    Result::default()
                }
                Op::Code::BinLt => {
                    if let Some(left_num) = e.left.data.to_finite_number() {
                        if let Some(right_num) = e.right.data.to_finite_number() {
                            return Result {
                                ok: true,
                                value: left_num < right_num,
                                side_effects: SideEffects::NoSideEffects,
                            };
                        }
                    }
                    Result::default()
                }
                Op::Code::BinLe => {
                    if let Some(left_num) = e.left.data.to_finite_number() {
                        if let Some(right_num) = e.right.data.to_finite_number() {
                            return Result {
                                ok: true,
                                value: left_num <= right_num,
                                side_effects: SideEffects::NoSideEffects,
                            };
                        }
                    }
                    Result::default()
                }
                Op::Code::BinGe => {
                    if let Some(left_num) = e.left.data.to_finite_number() {
                        if let Some(right_num) = e.right.data.to_finite_number() {
                            return Result {
                                ok: true,
                                value: left_num >= right_num,
                                side_effects: SideEffects::NoSideEffects,
                            };
                        }
                    }
                    Result::default()
                }
                _ => Result::default(),
            },
            ExprData::EInlinedEnum(e) => Self::to_boolean(p, &e.value.data),
            ExprData::ESpecial(special) => match special {
                E::Special::ModuleExports
                | E::Special::ResolvedSpecifierString(_)
                | E::Special::HotData => Result::default(),
                E::Special::HotAccept | E::Special::HotAcceptVisited | E::Special::HotEnabled => {
                    Result {
                        ok: true,
                        value: true,
                        side_effects: SideEffects::NoSideEffects,
                    }
                }
                E::Special::HotDisabled => Result {
                    ok: true,
                    value: false,
                    side_effects: SideEffects::NoSideEffects,
                },
            },
            _ => Result::default(),
        }
    }
}

// ported from: src/js_parser/ast/SideEffects.zig
