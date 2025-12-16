pub fn CreateBinaryExpressionVisitor(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);

        /// Try to optimize "typeof x === 'undefined'" to "typeof x > 'u'" or similar
        /// Returns the optimized expression if successful, null otherwise
        fn tryOptimizeTypeofUndefined(e_: *E.Binary, p: *P, replacement_op: js_ast.Op.Code) ?Expr {
            // Check if this is a typeof comparison with "undefined"
            const typeof_expr, const string_expr, const flip_comparison = exprs: {
                // Try left side as typeof, right side as string
                if (e_.left.data == .e_unary and e_.left.data.e_unary.op == .un_typeof) {
                    if (e_.right.data == .e_string and
                        e_.right.data.e_string.eqlComptime("undefined"))
                    {
                        break :exprs .{ e_.left, e_.right, false };
                    }

                    return null;
                }

                // Try right side as typeof, left side as string
                if (e_.right.data == .e_unary and e_.right.data.e_unary.op == .un_typeof) {
                    if (e_.left.data == .e_string and
                        e_.left.data.e_string.eqlComptime("undefined"))
                    {
                        break :exprs .{ e_.right, e_.left, true };
                    }

                    return null;
                }

                return null;
            };

            // Create new string with "u"
            const u_string = p.newExpr(E.String{ .data = "u" }, string_expr.loc);

            // Create the optimized comparison
            const left = if (flip_comparison) u_string else typeof_expr;
            const right = if (flip_comparison) typeof_expr else u_string;

            return p.newExpr(E.Binary{
                .left = left,
                .right = right,
                .op = replacement_op,
            }, e_.left.loc);
        }

        pub const BinaryExpressionVisitor = struct {
            e: *E.Binary,
            loc: logger.Loc,
            in: ExprIn,

            /// Input for visiting the left child
            left_in: ExprIn,

            /// "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
            is_stmt_expr: bool = false,

            pub fn visitRightAndFinish(
                v: *BinaryExpressionVisitor,
                p: *P,
            ) Expr {
                var e_ = v.e;
                const is_call_target = @as(Expr.Tag, p.call_target) == .e_binary and e_ == p.call_target.e_binary;
                // const is_stmt_expr = @as(Expr.Tag, p.stmt_expr_value) == .e_binary and expr.data.e_binary == p.stmt_expr_value.e_binary;
                const was_anonymous_named_expr = e_.right.isAnonymousNamed();

                // Mark the control flow as dead if the branch is never taken
                switch (e_.op) {
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            // "true || dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and !side_effects.value) {
                            // "false && dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_nullish_coalescing => {
                        const side_effects = SideEffects.toNullOrUndefined(p, e_.left.data);
                        if (side_effects.ok and !side_effects.value) {
                            // "notNullOrUndefined ?? dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    else => {
                        e_.right = p.visitExpr(e_.right);
                    },
                }

                // Always put constants on the right for equality comparisons to help
                // reduce the number of cases we have to check during pattern matching. We
                // can only reorder expressions that do not have any side effects.
                switch (e_.op) {
                    .bin_loose_eq, .bin_loose_ne, .bin_strict_eq, .bin_strict_ne => {
                        if (SideEffects.isPrimitiveToReorder(e_.left.data) and !SideEffects.isPrimitiveToReorder(e_.right.data)) {
                            const _left = e_.left;
                            const _right = e_.right;
                            e_.left = _right;
                            e_.right = _left;
                        }
                    },
                    else => {},
                }

                switch (e_.op) {
                    .bin_comma => {
                        // "(1, 2)" => "2"
                        // "(sideEffects(), 2)" => "(sideEffects(), 2)"
                        // "(0, this.fn)" => "this.fn"
                        // "(0, this.fn)()" => "(0, this.fn)()"
                        if (p.options.features.minify_syntax) {
                            if (SideEffects.simplifyUnusedExpr(p, e_.left)) |simplified_left| {
                                if (simplified_left.isEmpty()) {
                                    return e_.right;
                                }
                                e_.left = simplified_left;
                            } else {
                                // The left operand has no side effects, but we need to preserve
                                // the comma operator semantics when used as a call target
                                if (is_call_target and e_.right.hasValueForThisInCall()) {
                                    // Keep the comma expression to strip "this" binding
                                    e_.left = Expr{ .data = Prefill.Data.Zero, .loc = e_.left.loc };
                                } else {
                                    return e_.right;
                                }
                            }
                        }
                    },
                    .bin_loose_eq => {
                        const equality = e_.left.data.eql(e_.right.data, p, .loose);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsageOfRuntimeRequire();
                                p.ignoreUsage(p.module_ref);
                                return p.valueForImportMetaMain(false, v.loc);
                            }

                            return p.newExpr(
                                E.Boolean{ .value = equality.equal },
                                v.loc,
                            );
                        }

                        if (p.options.features.minify_syntax) {
                            // "typeof x == 'undefined'" => "typeof x > 'u'"
                            if (tryOptimizeTypeofUndefined(e_, p, .bin_gt)) |optimized| {
                                return optimized;
                            }

                            // "x == void 0" => "x == null"
                            if (e_.left.data == .e_undefined) {
                                e_.left.data = .{ .e_null = E.Null{} };
                            } else if (e_.right.data == .e_undefined) {
                                e_.right.data = .{ .e_null = E.Null{} };
                            }
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                    },
                    .bin_strict_eq => {
                        const equality = e_.left.data.eql(e_.right.data, p, .strict);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(false, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = equality.equal }, v.loc);
                        }

                        if (p.options.features.minify_syntax) {
                            // "typeof x === 'undefined'" => "typeof x > 'u'"
                            if (tryOptimizeTypeofUndefined(e_, p, .bin_gt)) |optimized| {
                                return optimized;
                            }
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string
                    },
                    .bin_loose_ne => {
                        const equality = e_.left.data.eql(e_.right.data, p, .loose);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(true, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = !equality.equal }, v.loc);
                        }
                        if (p.options.features.minify_syntax) {
                            // "typeof x != 'undefined'" => "typeof x < 'u'"
                            if (tryOptimizeTypeofUndefined(e_, p, .bin_lt)) |optimized| {
                                return optimized;
                            }
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                        // "x != void 0" => "x != null"
                        if (@as(Expr.Tag, e_.right.data) == .e_undefined) {
                            e_.right = p.newExpr(E.Null{}, e_.right.loc);
                        }
                    },
                    .bin_strict_ne => {
                        const equality = e_.left.data.eql(e_.right.data, p, .strict);
                        if (equality.ok) {
                            if (equality.is_require_main_and_module) {
                                p.ignoreUsage(p.module_ref);
                                p.ignoreUsageOfRuntimeRequire();
                                return p.valueForImportMetaMain(true, v.loc);
                            }

                            return p.newExpr(E.Boolean{ .value = !equality.equal }, v.loc);
                        }

                        if (p.options.features.minify_syntax) {
                            // "typeof x !== 'undefined'" => "typeof x < 'u'"
                            if (tryOptimizeTypeofUndefined(e_, p, .bin_lt)) |optimized| {
                                return optimized;
                            }
                        }
                    },
                    .bin_nullish_coalescing => {
                        const nullorUndefined = SideEffects.toNullOrUndefined(p, e_.left.data);
                        if (nullorUndefined.ok) {
                            if (!nullorUndefined.value) {
                                return e_.left;
                            } else if (nullorUndefined.side_effects == .no_side_effects) {
                                // "(null ?? fn)()" => "fn()"
                                // "(null ?? this.fn)" => "this.fn"
                                // "(null ?? this.fn)()" => "(0, this.fn)()"
                                if (is_call_target and e_.right.hasValueForThisInCall()) {
                                    return Expr.joinWithComma(Expr{ .data = .{ .e_number = .{ .value = 0.0 } }, .loc = e_.left.loc }, e_.right, p.allocator);
                                }

                                return e_.right;
                            }
                        }
                    },
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            return e_.left;
                        } else if (side_effects.ok and side_effects.side_effects == .no_side_effects) {
                            // "(0 || fn)()" => "fn()"
                            // "(0 || this.fn)" => "this.fn"
                            // "(0 || this.fn)()" => "(0, this.fn)()"
                            if (is_call_target and e_.right.hasValueForThisInCall()) {
                                return Expr.joinWithComma(Expr{ .data = Prefill.Data.Zero, .loc = e_.left.loc }, e_.right, p.allocator);
                            }

                            return e_.right;
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(p, e_.left.data);
                        if (side_effects.ok) {
                            if (!side_effects.value) {
                                return e_.left;
                            } else if (side_effects.side_effects == .no_side_effects) {
                                // "(1 && fn)()" => "fn()"
                                // "(1 && this.fn)" => "this.fn"
                                // "(1 && this.fn)()" => "(0, this.fn)()"
                                if (is_call_target and e_.right.hasValueForThisInCall()) {
                                    return Expr.joinWithComma(Expr{ .data = Prefill.Data.Zero, .loc = e_.left.loc }, e_.right, p.allocator);
                                }

                                return e_.right;
                            }
                        }
                    },
                    .bin_add => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] + vals[1] }, v.loc);
                            }

                            // "'abc' + 'xyz'" => "'abcxyz'"
                            if (foldStringAddition(e_.left, e_.right, p.allocator, .normal)) |res| {
                                return res;
                            }

                            // "(x + 'abc') + 'xyz'" => "'abcxyz'"
                            if (e_.left.data.as(.e_binary)) |left| {
                                if (left.op == .bin_add) {
                                    if (foldStringAddition(left.right, e_.right, p.allocator, .nested_left)) |result| {
                                        return p.newExpr(E.Binary{
                                            .left = left.left,
                                            .right = result,
                                            .op = .bin_add,
                                        }, e_.left.loc);
                                    }
                                }
                            }
                        }
                    },
                    .bin_sub => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] - vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_mul => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] * vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_div => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = vals[0] / vals[1] }, v.loc);
                            }
                        }
                    },
                    .bin_rem => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const fmod = @extern(*const fn (f64, f64) callconv(.c) f64, .{ .name = "fmod" });
                                return p.newExpr(
                                    // Use libc fmod here to be consistent with what JavaScriptCore does
                                    // https://github.com/oven-sh/WebKit/blob/7a0b13626e5db69aa5a32d037431d381df5dfb61/Source/JavaScriptCore/runtime/MathCommon.cpp#L574-L597
                                    E.Number{ .value = if (comptime Environment.isNative) fmod(vals[0], vals[1]) else std.math.mod(f64, vals[0], vals[1]) catch 0 },
                                    v.loc,
                                );
                            }
                        }
                    },
                    .bin_pow => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{ .value = jsc.math.pow(vals[0], vals[1]) }, v.loc);
                            }
                        }
                    },
                    .bin_shl => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left = floatToInt32(vals[0]);
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: i32 = @bitCast(std.math.shl(i32, left, right));
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_shr => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left = floatToInt32(vals[0]);
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: i32 = @bitCast(std.math.shr(i32, left, right));
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_u_shr => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                const left: u32 = @bitCast(floatToInt32(vals[0]));
                                const right: u8 = @intCast(@as(u32, @bitCast(floatToInt32(vals[1]))) % 32);
                                const result: u32 = std.math.shr(u32, left, right);
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt(result),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_and => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) & floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_or => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) | floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },
                    .bin_bitwise_xor => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Number{
                                    .value = @floatFromInt((floatToInt32(vals[0]) ^ floatToInt32(vals[1]))),
                                }, v.loc);
                            }
                        }
                    },

                    .bin_lt => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValuesInSafeRange(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0] < vals[1],
                                }, v.loc);
                            }
                            if (Expr.extractStringValues(e_.left.data, e_.right.data, p.allocator)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0].order(vals[1]) == .lt,
                                }, v.loc);
                            }
                        }
                    },
                    .bin_gt => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValuesInSafeRange(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0] > vals[1],
                                }, v.loc);
                            }
                            if (Expr.extractStringValues(e_.left.data, e_.right.data, p.allocator)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0].order(vals[1]) == .gt,
                                }, v.loc);
                            }
                        }
                    },
                    .bin_le => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValuesInSafeRange(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0] <= vals[1],
                                }, v.loc);
                            }
                            if (Expr.extractStringValues(e_.left.data, e_.right.data, p.allocator)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = switch (vals[0].order(vals[1])) {
                                        .eq, .lt => true,
                                        .gt => false,
                                    },
                                }, v.loc);
                            }
                        }
                    },
                    .bin_ge => {
                        if (p.should_fold_typescript_constant_expressions) {
                            if (Expr.extractNumericValuesInSafeRange(e_.left.data, e_.right.data)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = vals[0] >= vals[1],
                                }, v.loc);
                            }
                            if (Expr.extractStringValues(e_.left.data, e_.right.data, p.allocator)) |vals| {
                                return p.newExpr(E.Boolean{
                                    .value = switch (vals[0].order(vals[1])) {
                                        .eq, .gt => true,
                                        .lt => false,
                                    },
                                }, v.loc);
                            }
                        }
                    },

                    // ---------------------------------------------------------------------------------------------------
                    .bin_assign => {
                        // Optionally preserve the name
                        if (e_.left.data == .e_identifier) {
                            e_.right = p.maybeKeepExprSymbolName(e_.right, p.symbols.items[e_.left.data.e_identifier.ref.innerIndex()].original_name, was_anonymous_named_expr);
                        }
                    },
                    .bin_nullish_coalescing_assign, .bin_logical_or_assign => {
                        // Special case `{}.field ??= value` to minify to `value`
                        // This optimization is specifically to target this pattern in HMR:
                        //    `import.meta.hot.data.etc ??= init()`
                        if (e_.left.data.as(.e_dot)) |dot| {
                            if (dot.target.data.as(.e_object)) |obj| {
                                if (obj.properties.len == 0) {
                                    if (!bun.strings.eqlComptime(dot.name, "__proto__"))
                                        return e_.right;
                                }
                            }
                        }
                    },
                    else => {},
                }

                return Expr{ .loc = v.loc, .data = .{ .e_binary = e_ } };
            }

            pub fn checkAndPrepare(v: *BinaryExpressionVisitor, p: *P) ?Expr {
                var e_ = v.e;
                switch (e_.left.data) {
                    // Special-case private identifiers
                    .e_private_identifier => |_private| {
                        if (e_.op == .bin_in) {
                            var private = _private;
                            const name = p.loadNameFromRef(private.ref);
                            const result = p.findSymbol(e_.left.loc, name) catch unreachable;
                            private.ref = result.ref;

                            // Unlike regular identifiers, there are no unbound private identifiers
                            const kind: Symbol.Kind = p.symbols.items[result.ref.innerIndex()].kind;
                            if (!Symbol.isKindPrivate(kind)) {
                                const r = logger.Range{ .loc = e_.left.loc, .len = @as(i32, @intCast(name.len)) };
                                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                            }

                            e_.right = p.visitExpr(e_.right);
                            e_.left = .{ .data = .{ .e_private_identifier = private }, .loc = e_.left.loc };

                            // privateSymbolNeedsToBeLowered
                            return Expr{ .loc = v.loc, .data = .{ .e_binary = e_ } };
                        }
                    },
                    else => {},
                }

                v.is_stmt_expr = p.stmt_expr_value == .e_binary and p.stmt_expr_value.e_binary == e_;

                v.left_in = ExprIn{
                    .assign_target = e_.op.binaryAssignTarget(),
                };

                return null;
            }
        };
    };
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const Symbol = js_ast.Symbol;

const js_parser = bun.js_parser;
const ExprIn = js_parser.ExprIn;
const JSXTransformType = js_parser.JSXTransformType;
const Prefill = js_parser.Prefill;
const SideEffects = js_parser.SideEffects;
const floatToInt32 = js_parser.floatToInt32;
const foldStringAddition = js_parser.foldStringAddition;
const options = js_parser.options;
