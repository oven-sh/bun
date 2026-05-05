use core::cmp::Ordering;

use bun_js_parser::ast::{self as js_ast, E, Expr, ExprData, ExprTag, Op, Symbol};
use bun_js_parser::{
    fold_string_addition, float_to_int32, ExprIn, JSXTransformType, NewParser_, Prefill,
    SideEffects, StringAdditionKind,
};
use bun_logger as logger;

// PORT NOTE: The Zig `CreateBinaryExpressionVisitor(comptime ts, comptime jsx, comptime scan_only) type`
// returned an anonymous namespace struct whose only public item was `BinaryExpressionVisitor`.
// In Rust the outer wrapper is flattened away: `BinaryExpressionVisitor` carries the const
// generics directly, and `P` is a module-level type alias parameterized the same way.
// Phase B diff readers should map:
//   Zig: CreateBinaryExpressionVisitor(TS, JSX, SCAN).BinaryExpressionVisitor
//   Rust: BinaryExpressionVisitor<'arena, TS, JSX, SCAN>

type P<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    NewParser_<TYPESCRIPT, JSX, SCAN_ONLY>;

/// Try to optimize "typeof x === 'undefined'" to "typeof x > 'u'" or similar
/// Returns the optimized expression if successful, None otherwise
fn try_optimize_typeof_undefined<
    const TYPESCRIPT: bool,
    const JSX: JSXTransformType,
    const SCAN_ONLY: bool,
>(
    e_: &mut E::Binary,
    p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
    replacement_op: js_ast::Op::Code,
) -> Option<Expr> {
    // Check if this is a typeof comparison with "undefined"
    let (typeof_expr, string_expr, flip_comparison) = 'exprs: {
        // Try left side as typeof, right side as string
        if let ExprData::EUnary(unary) = &e_.left.data {
            if unary.op == Op::Code::UnTypeof {
                if let ExprData::EString(s) = &e_.right.data {
                    if s.eql_comptime(b"undefined") {
                        break 'exprs (e_.left, e_.right, false);
                    }
                }
                return None;
            }
        }

        // Try right side as typeof, left side as string
        if let ExprData::EUnary(unary) = &e_.right.data {
            if unary.op == Op::Code::UnTypeof {
                if let ExprData::EString(s) = &e_.left.data {
                    if s.eql_comptime(b"undefined") {
                        break 'exprs (e_.right, e_.left, true);
                    }
                }
                return None;
            }
        }

        return None;
    };

    // Create new string with "u"
    let u_string = p.new_expr(E::String { data: b"u".into() }, string_expr.loc);

    // Create the optimized comparison
    let left = if flip_comparison { u_string } else { typeof_expr };
    let right = if flip_comparison { typeof_expr } else { u_string };

    Some(p.new_expr(
        E::Binary {
            left,
            right,
            op: replacement_op,
        },
        e_.left.loc,
    ))
}

pub struct BinaryExpressionVisitor<
    'arena,
    const TYPESCRIPT: bool,
    const JSX: JSXTransformType,
    const SCAN_ONLY: bool,
> {
    pub e: &'arena mut E::Binary,
    pub loc: logger::Loc,
    // PORT NOTE: Zig field name `in` is a Rust keyword; renamed to `in_`.
    pub in_: ExprIn,

    /// Input for visiting the left child
    pub left_in: ExprIn,

    /// "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
    pub is_stmt_expr: bool, // = false (set by caller / Default)
}

impl<'arena, const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool>
    BinaryExpressionVisitor<'arena, TYPESCRIPT, JSX, SCAN_ONLY>
{
    pub fn visit_right_and_finish(
        v: &mut Self,
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
    ) -> Expr {
        let e_ = &mut *v.e;
        // PORT NOTE: reshaped for borrowck — Zig compared `e_ == p.call_target.e_binary` (ptr eq).
        let is_call_target = matches!(p.call_target, ExprData::EBinary(ptr) if core::ptr::eq(ptr, e_));
        // const is_stmt_expr = @as(Expr.Tag, p.stmt_expr_value) == .e_binary and expr.data.e_binary == p.stmt_expr_value.e_binary;
        let was_anonymous_named_expr = e_.right.is_anonymous_named();
        let prev_decorator_class_name = p.decorator_class_name;

        // Propagate name for anonymous decorated class expressions in assignments
        if e_.op == Op::Code::BinAssign && was_anonymous_named_expr {
            if let ExprData::EClass(class) = &e_.right.data {
                if class.should_lower_standard_decorators {
                    if let ExprData::EIdentifier(ident) = &e_.left.data {
                        p.decorator_class_name = p.load_name_from_ref(ident.ref_);
                    }
                }
            }
        }

        // Mark the control flow as dead if the branch is never taken
        match e_.op {
            Op::Code::BinLogicalOr => {
                let side_effects = SideEffects::to_boolean(p, &e_.left.data);
                if side_effects.ok && side_effects.value {
                    // "true || dead"
                    let old = p.is_control_flow_dead;
                    p.is_control_flow_dead = true;
                    e_.right = p.visit_expr(e_.right);
                    p.is_control_flow_dead = old;
                } else {
                    e_.right = p.visit_expr(e_.right);
                }
            }
            Op::Code::BinLogicalAnd => {
                let side_effects = SideEffects::to_boolean(p, &e_.left.data);
                if side_effects.ok && !side_effects.value {
                    // "false && dead"
                    let old = p.is_control_flow_dead;
                    p.is_control_flow_dead = true;
                    e_.right = p.visit_expr(e_.right);
                    p.is_control_flow_dead = old;
                } else {
                    e_.right = p.visit_expr(e_.right);
                }
            }
            Op::Code::BinNullishCoalescing => {
                let side_effects = SideEffects::to_null_or_undefined(p, &e_.left.data);
                if side_effects.ok && !side_effects.value {
                    // "notNullOrUndefined ?? dead"
                    let old = p.is_control_flow_dead;
                    p.is_control_flow_dead = true;
                    e_.right = p.visit_expr(e_.right);
                    p.is_control_flow_dead = old;
                } else {
                    e_.right = p.visit_expr(e_.right);
                }
            }
            _ => {
                e_.right = p.visit_expr(e_.right);
            }
        }
        p.decorator_class_name = prev_decorator_class_name;

        // Always put constants on the right for equality comparisons to help
        // reduce the number of cases we have to check during pattern matching. We
        // can only reorder expressions that do not have any side effects.
        match e_.op {
            Op::Code::BinLooseEq
            | Op::Code::BinLooseNe
            | Op::Code::BinStrictEq
            | Op::Code::BinStrictNe => {
                if SideEffects::is_primitive_to_reorder(&e_.left.data)
                    && !SideEffects::is_primitive_to_reorder(&e_.right.data)
                {
                    let _left = e_.left;
                    let _right = e_.right;
                    e_.left = _right;
                    e_.right = _left;
                }
            }
            _ => {}
        }

        match e_.op {
            Op::Code::BinComma => {
                // "(1, 2)" => "2"
                // "(sideEffects(), 2)" => "(sideEffects(), 2)"
                // "(0, this.fn)" => "this.fn"
                // "(0, this.fn)()" => "(0, this.fn)()"
                if p.options.features.minify_syntax {
                    if let Some(simplified_left) = SideEffects::simplify_unused_expr(p, e_.left) {
                        if simplified_left.is_empty() {
                            return e_.right;
                        }
                        e_.left = simplified_left;
                    } else {
                        // The left operand has no side effects, but we need to preserve
                        // the comma operator semantics when used as a call target
                        if is_call_target && e_.right.has_value_for_this_in_call() {
                            // Keep the comma expression to strip "this" binding
                            e_.left = Expr { data: Prefill::Data::ZERO, loc: e_.left.loc };
                        } else {
                            return e_.right;
                        }
                    }
                }
            }
            Op::Code::BinLooseEq => {
                let equality = e_.left.data.eql(&e_.right.data, p, js_ast::EqlMode::Loose);
                if equality.ok {
                    if equality.is_require_main_and_module {
                        p.ignore_usage_of_runtime_require();
                        p.ignore_usage(p.module_ref);
                        return p.value_for_import_meta_main(false, v.loc);
                    }

                    return p.new_expr(E::Boolean { value: equality.equal }, v.loc);
                }

                if p.options.features.minify_syntax {
                    // "typeof x == 'undefined'" => "typeof x > 'u'"
                    if let Some(optimized) =
                        try_optimize_typeof_undefined(e_, p, Op::Code::BinGt)
                    {
                        return optimized;
                    }

                    // "x == void 0" => "x == null"
                    if matches!(e_.left.data, ExprData::EUndefined(_)) {
                        e_.left.data = ExprData::ENull(E::Null {});
                    } else if matches!(e_.right.data, ExprData::EUndefined(_)) {
                        e_.right.data = ExprData::ENull(E::Null {});
                    }
                }

                // const after_op_loc = locAfterOp(e_.);
                // TODO: warn about equality check
                // TODO: warn about typeof string
            }
            Op::Code::BinStrictEq => {
                let equality = e_.left.data.eql(&e_.right.data, p, js_ast::EqlMode::Strict);
                if equality.ok {
                    if equality.is_require_main_and_module {
                        p.ignore_usage(p.module_ref);
                        p.ignore_usage_of_runtime_require();
                        return p.value_for_import_meta_main(false, v.loc);
                    }

                    return p.new_expr(E::Boolean { value: equality.equal }, v.loc);
                }

                if p.options.features.minify_syntax {
                    // "typeof x === 'undefined'" => "typeof x > 'u'"
                    if let Some(optimized) =
                        try_optimize_typeof_undefined(e_, p, Op::Code::BinGt)
                    {
                        return optimized;
                    }
                }

                // const after_op_loc = locAfterOp(e_.);
                // TODO: warn about equality check
                // TODO: warn about typeof string
            }
            Op::Code::BinLooseNe => {
                let equality = e_.left.data.eql(&e_.right.data, p, js_ast::EqlMode::Loose);
                if equality.ok {
                    if equality.is_require_main_and_module {
                        p.ignore_usage(p.module_ref);
                        p.ignore_usage_of_runtime_require();
                        return p.value_for_import_meta_main(true, v.loc);
                    }

                    return p.new_expr(E::Boolean { value: !equality.equal }, v.loc);
                }
                if p.options.features.minify_syntax {
                    // "typeof x != 'undefined'" => "typeof x < 'u'"
                    if let Some(optimized) =
                        try_optimize_typeof_undefined(e_, p, Op::Code::BinLt)
                    {
                        return optimized;
                    }
                }

                // const after_op_loc = locAfterOp(e_.);
                // TODO: warn about equality check
                // TODO: warn about typeof string

                // "x != void 0" => "x != null"
                if matches!(e_.right.data, ExprData::EUndefined(_)) {
                    e_.right = p.new_expr(E::Null {}, e_.right.loc);
                }
            }
            Op::Code::BinStrictNe => {
                let equality = e_.left.data.eql(&e_.right.data, p, js_ast::EqlMode::Strict);
                if equality.ok {
                    if equality.is_require_main_and_module {
                        p.ignore_usage(p.module_ref);
                        p.ignore_usage_of_runtime_require();
                        return p.value_for_import_meta_main(true, v.loc);
                    }

                    return p.new_expr(E::Boolean { value: !equality.equal }, v.loc);
                }

                if p.options.features.minify_syntax {
                    // "typeof x !== 'undefined'" => "typeof x < 'u'"
                    if let Some(optimized) =
                        try_optimize_typeof_undefined(e_, p, Op::Code::BinLt)
                    {
                        return optimized;
                    }
                }
            }
            Op::Code::BinNullishCoalescing => {
                let null_or_undefined = SideEffects::to_null_or_undefined(p, &e_.left.data);
                if null_or_undefined.ok {
                    if !null_or_undefined.value {
                        return e_.left;
                    } else if null_or_undefined.side_effects == SideEffects::NoSideEffects {
                        // "(null ?? fn)()" => "fn()"
                        // "(null ?? this.fn)" => "this.fn"
                        // "(null ?? this.fn)()" => "(0, this.fn)()"
                        if is_call_target && e_.right.has_value_for_this_in_call() {
                            return Expr::join_with_comma(
                                Expr {
                                    data: ExprData::ENumber(E::Number { value: 0.0 }),
                                    loc: e_.left.loc,
                                },
                                e_.right,
                                p.allocator,
                            );
                        }

                        return e_.right;
                    }
                }
            }
            Op::Code::BinLogicalOr => {
                let side_effects = SideEffects::to_boolean(p, &e_.left.data);
                if side_effects.ok && side_effects.value {
                    return e_.left;
                } else if side_effects.ok && side_effects.side_effects == SideEffects::NoSideEffects {
                    // "(0 || fn)()" => "fn()"
                    // "(0 || this.fn)" => "this.fn"
                    // "(0 || this.fn)()" => "(0, this.fn)()"
                    if is_call_target && e_.right.has_value_for_this_in_call() {
                        return Expr::join_with_comma(
                            Expr { data: Prefill::Data::ZERO, loc: e_.left.loc },
                            e_.right,
                            p.allocator,
                        );
                    }

                    return e_.right;
                }
            }
            Op::Code::BinLogicalAnd => {
                let side_effects = SideEffects::to_boolean(p, &e_.left.data);
                if side_effects.ok {
                    if !side_effects.value {
                        return e_.left;
                    } else if side_effects.side_effects == SideEffects::NoSideEffects {
                        // "(1 && fn)()" => "fn()"
                        // "(1 && this.fn)" => "this.fn"
                        // "(1 && this.fn)()" => "(0, this.fn)()"
                        if is_call_target && e_.right.has_value_for_this_in_call() {
                            return Expr::join_with_comma(
                                Expr { data: Prefill::Data::ZERO, loc: e_.left.loc },
                                e_.right,
                                p.allocator,
                            );
                        }

                        return e_.right;
                    }
                }
            }
            Op::Code::BinAdd => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(E::Number { value: vals[0] + vals[1] }, v.loc);
                    }

                    // "'abc' + 'xyz'" => "'abcxyz'"
                    if let Some(res) = fold_string_addition(
                        e_.left,
                        e_.right,
                        p.allocator,
                        StringAdditionKind::Normal,
                    ) {
                        return res;
                    }

                    // "(x + 'abc') + 'xyz'" => "'abcxyz'"
                    if let Some(left) = e_.left.data.as_e_binary() {
                        if left.op == Op::Code::BinAdd {
                            if let Some(result) = fold_string_addition(
                                left.right,
                                e_.right,
                                p.allocator,
                                StringAdditionKind::NestedLeft,
                            ) {
                                return p.new_expr(
                                    E::Binary {
                                        left: left.left,
                                        right: result,
                                        op: Op::Code::BinAdd,
                                    },
                                    e_.left.loc,
                                );
                            }
                        }
                    }
                }
            }
            Op::Code::BinSub => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(E::Number { value: vals[0] - vals[1] }, v.loc);
                    }
                }
            }
            Op::Code::BinMul => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(E::Number { value: vals[0] * vals[1] }, v.loc);
                    }
                }
            }
            Op::Code::BinDiv => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(E::Number { value: vals[0] / vals[1] }, v.loc);
                    }
                }
            }
            Op::Code::BinRem => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        // TODO(port): move to <area>_sys
                        unsafe extern "C" {
                            fn fmod(x: f64, y: f64) -> f64;
                        }
                        return p.new_expr(
                            // Use libc fmod here to be consistent with what JavaScriptCore does
                            // https://github.com/oven-sh/WebKit/blob/7a0b13626e5db69aa5a32d037431d381df5dfb61/Source/JavaScriptCore/runtime/MathCommon.cpp#L574-L597
                            // PORT NOTE: Zig had a non-native fallback to std.math.mod; Rust targets are always native.
                            E::Number {
                                // SAFETY: libc fmod is pure on finite/NaN inputs; matches JSC behavior.
                                value: unsafe { fmod(vals[0], vals[1]) },
                            },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinPow => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(
                            // TODO(b0): math arrives from move-in (was bun_jsc::math → js_parser)
                            E::Number { value: crate::math::pow(vals[0], vals[1]) },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinShl => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        let left = float_to_int32(vals[0]);
                        let right: u8 =
                            u8::try_from((float_to_int32(vals[1]) as u32) % 32).unwrap();
                        let result: i32 = left.wrapping_shl(right as u32);
                        return p.new_expr(E::Number { value: result as f64 }, v.loc);
                    }
                }
            }
            Op::Code::BinShr => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        let left = float_to_int32(vals[0]);
                        let right: u8 =
                            u8::try_from((float_to_int32(vals[1]) as u32) % 32).unwrap();
                        // std.math.shr on i32 is arithmetic shift right
                        let result: i32 = left.wrapping_shr(right as u32);
                        return p.new_expr(E::Number { value: result as f64 }, v.loc);
                    }
                }
            }
            Op::Code::BinUShr => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        let left: u32 = float_to_int32(vals[0]) as u32;
                        let right: u8 =
                            u8::try_from((float_to_int32(vals[1]) as u32) % 32).unwrap();
                        let result: u32 = left.wrapping_shr(right as u32);
                        return p.new_expr(E::Number { value: result as f64 }, v.loc);
                    }
                }
            }
            Op::Code::BinBitwiseAnd => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(
                            E::Number {
                                value: (float_to_int32(vals[0]) & float_to_int32(vals[1])) as f64,
                            },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinBitwiseOr => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(
                            E::Number {
                                value: (float_to_int32(vals[0]) | float_to_int32(vals[1])) as f64,
                            },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinBitwiseXor => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) = Expr::extract_numeric_values(&e_.left.data, &e_.right.data) {
                        return p.new_expr(
                            E::Number {
                                value: (float_to_int32(vals[0]) ^ float_to_int32(vals[1])) as f64,
                            },
                            v.loc,
                        );
                    }
                }
            }

            Op::Code::BinLt => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) =
                        Expr::extract_numeric_values_in_safe_range(&e_.left.data, &e_.right.data)
                    {
                        return p.new_expr(E::Boolean { value: vals[0] < vals[1] }, v.loc);
                    }
                    if let Some(vals) =
                        Expr::extract_string_values(&e_.left.data, &e_.right.data, p.allocator)
                    {
                        return p.new_expr(
                            E::Boolean { value: vals[0].order(&vals[1]) == Ordering::Less },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinGt => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) =
                        Expr::extract_numeric_values_in_safe_range(&e_.left.data, &e_.right.data)
                    {
                        return p.new_expr(E::Boolean { value: vals[0] > vals[1] }, v.loc);
                    }
                    if let Some(vals) =
                        Expr::extract_string_values(&e_.left.data, &e_.right.data, p.allocator)
                    {
                        return p.new_expr(
                            E::Boolean { value: vals[0].order(&vals[1]) == Ordering::Greater },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinLe => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) =
                        Expr::extract_numeric_values_in_safe_range(&e_.left.data, &e_.right.data)
                    {
                        return p.new_expr(E::Boolean { value: vals[0] <= vals[1] }, v.loc);
                    }
                    if let Some(vals) =
                        Expr::extract_string_values(&e_.left.data, &e_.right.data, p.allocator)
                    {
                        return p.new_expr(
                            E::Boolean {
                                value: match vals[0].order(&vals[1]) {
                                    Ordering::Equal | Ordering::Less => true,
                                    Ordering::Greater => false,
                                },
                            },
                            v.loc,
                        );
                    }
                }
            }
            Op::Code::BinGe => {
                if p.should_fold_typescript_constant_expressions {
                    if let Some(vals) =
                        Expr::extract_numeric_values_in_safe_range(&e_.left.data, &e_.right.data)
                    {
                        return p.new_expr(E::Boolean { value: vals[0] >= vals[1] }, v.loc);
                    }
                    if let Some(vals) =
                        Expr::extract_string_values(&e_.left.data, &e_.right.data, p.allocator)
                    {
                        return p.new_expr(
                            E::Boolean {
                                value: match vals[0].order(&vals[1]) {
                                    Ordering::Equal | Ordering::Greater => true,
                                    Ordering::Less => false,
                                },
                            },
                            v.loc,
                        );
                    }
                }
            }

            // ---------------------------------------------------------------------------------------------------
            Op::Code::BinAssign => {
                // Optionally preserve the name
                if let ExprData::EIdentifier(ident) = &e_.left.data {
                    let ref_ = ident.ref_;
                    // PORT NOTE: reshaped for borrowck — captured ref_ before borrowing p.symbols.
                    e_.right = p.maybe_keep_expr_symbol_name(
                        e_.right,
                        &p.symbols[ref_.inner_index()].original_name,
                        was_anonymous_named_expr,
                    );
                }
            }
            Op::Code::BinNullishCoalescingAssign | Op::Code::BinLogicalOrAssign => {
                // Special case `{}.field ??= value` to minify to `value`
                // This optimization is specifically to target this pattern in HMR:
                //    `import.meta.hot.data.etc ??= init()`
                if let Some(dot) = e_.left.data.as_e_dot() {
                    if let Some(obj) = dot.target.data.as_e_object() {
                        if obj.properties.len() == 0 {
                            if dot.name != b"__proto__" {
                                return e_.right;
                            }
                        }
                    }
                }
            }
            _ => {}
        }

        Expr { loc: v.loc, data: ExprData::EBinary(e_) }
    }

    pub fn check_and_prepare(
        v: &mut Self,
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
    ) -> Option<Expr> {
        let e_ = &mut *v.e;
        match &e_.left.data {
            // Special-case private identifiers
            ExprData::EPrivateIdentifier(_private) => {
                if e_.op == Op::Code::BinIn {
                    let mut private = *_private;
                    let name = p.load_name_from_ref(private.ref_);
                    let result = p.find_symbol(e_.left.loc, name).expect("unreachable");
                    private.ref_ = result.ref_;

                    // Unlike regular identifiers, there are no unbound private identifiers
                    let kind: Symbol::Kind = p.symbols[result.ref_.inner_index()].kind;
                    if !Symbol::is_kind_private(kind) {
                        let r = logger::Range {
                            loc: e_.left.loc,
                            len: i32::try_from(name.len()).unwrap(),
                        };
                        p.log
                            .add_range_error_fmt(
                                p.source,
                                r,
                                p.allocator,
                                format_args!(
                                    "Private name \"{}\" must be declared in an enclosing class",
                                    bstr::BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    }

                    e_.right = p.visit_expr(e_.right);
                    e_.left = Expr {
                        data: ExprData::EPrivateIdentifier(private),
                        loc: e_.left.loc,
                    };

                    // privateSymbolNeedsToBeLowered
                    return Some(Expr { loc: v.loc, data: ExprData::EBinary(e_) });
                }
            }
            _ => {}
        }

        v.is_stmt_expr =
            matches!(p.stmt_expr_value, ExprData::EBinary(ptr) if core::ptr::eq(ptr, e_));

        v.left_in = ExprIn {
            assign_target: e_.op.binary_assign_target(),
            ..ExprIn::default()
        };

        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/visitBinaryExpression.zig (598 lines)
//   confidence: medium
//   todos:      1
//   notes:      Outer CreateBinaryExpressionVisitor wrapper flattened into const-generic struct; ExprData variant accessors (as_e_binary/as_e_dot/as_e_object), EqlMode, StringAdditionKind, Prefill::Data::ZERO, and Op::Code path assumed — Phase B fixes imports. `in` field renamed `in_`. Returning ExprData::EBinary(e_) re-borrows the arena ref; verify lifetime in Phase B.
// ──────────────────────────────────────────────────────────────────────────
