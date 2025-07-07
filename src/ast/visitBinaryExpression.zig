pub fn CreateBinaryExpressionVisitor(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const jsx_transform_type = P.jsx_transform_type;
        const allow_macros = P.allow_macros;
        const is_typescript_enabled = P.is_typescript_enabled;
        const createDefaultName = P.createDefaultName;
        const track_symbol_usage_during_parse_pass = P.track_symbol_usage_during_parse_pass;
        const extractDeclsForBinding = P.extractDeclsForBinding;
        const is_jsx_enabled = P.is_jsx_enabled;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;
        const LowerUsingDeclarationsContext = P.LowerUsingDeclarationsContext;
        const isSimpleParameterList = P.isSimpleParameterList;

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
                        if (p.options.features.minify_syntax) {
                            e_.left = SideEffects.simplifyUnusedExpr(p, e_.left) orelse return e_.right;
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
                                const fmod = @extern(*const fn (f64, f64) callconv(.C) f64, .{ .name = "fmod" });
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
                                return p.newExpr(E.Number{ .value = JSC.math.pow(vals[0], vals[1]) }, v.loc);
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

// @sortImports @noRemoveUnused

const Define = @import("../defines.zig").Define;
const DefineData = @import("../defines.zig").DefineData;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const ImportRecord = bun.ImportRecord;
const JSC = bun.JSC;
const Output = bun.Output;
const assert = bun.assert;
const logger = bun.logger;
const string = bun.string;
const strings = bun.strings;

const js_ast = bun.JSAst;
const B = js_ast.B;
const Binding = js_ast.Binding;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const BindingNodeList = js_ast.BindingNodeList;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Scope = js_ast.Scope;
const Stmt = js_ast.Stmt;
const StmtNodeIndex = js_ast.StmtNodeIndex;
const StmtNodeList = js_ast.StmtNodeList;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Arg = G.Arg;
const Decl = G.Decl;
const Property = G.Property;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const SymbolPropertyUseMap = js_ast.Part.SymbolPropertyUseMap;
const SymbolUseMap = js_ast.Part.SymbolUseMap;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const AsyncPrefixExpression = js_parser.AsyncPrefixExpression;
const AwaitOrYield = js_parser.AwaitOrYield;
const ConvertESMExportsForHmr = js_parser.ConvertESMExportsForHmr;
const DeferredArrowArgErrors = js_parser.DeferredArrowArgErrors;
const DeferredErrors = js_parser.DeferredErrors;
const DeferredImportNamespace = js_parser.DeferredImportNamespace;
const DeferredTsDecorators = js_parser.DeferredTsDecorators;
const ExprBindingTuple = js_parser.ExprBindingTuple;
const ExprIn = js_parser.ExprIn;
const ExprListLoc = js_parser.ExprListLoc;
const ExprOrLetStmt = js_parser.ExprOrLetStmt;
const ExpressionTransposer = js_parser.ExpressionTransposer;
const FindLabelSymbolResult = js_parser.FindLabelSymbolResult;
const FindSymbolResult = js_parser.FindSymbolResult;
const FnOnlyDataVisit = js_parser.FnOnlyDataVisit;
const FnOrArrowDataParse = js_parser.FnOrArrowDataParse;
const FnOrArrowDataVisit = js_parser.FnOrArrowDataVisit;
const FunctionKind = js_parser.FunctionKind;
const IdentifierOpts = js_parser.IdentifierOpts;
const ImportItemForNamespaceMap = js_parser.ImportItemForNamespaceMap;
const ImportKind = js_parser.ImportKind;
const ImportNamespaceCallOrConstruct = js_parser.ImportNamespaceCallOrConstruct;
const ImportScanner = js_parser.ImportScanner;
const InvalidLoc = js_parser.InvalidLoc;
const JSXImport = js_parser.JSXImport;
const JSXTransformType = js_parser.JSXTransformType;
const Jest = js_parser.Jest;
const KnownGlobal = js_parser.KnownGlobal;
const LocList = js_parser.LocList;
const MacroState = js_parser.MacroState;
const ParenExprOpts = js_parser.ParenExprOpts;
const ParseBindingOptions = js_parser.ParseBindingOptions;
const ParseClassOptions = js_parser.ParseClassOptions;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const ParsedPath = js_parser.ParsedPath;
const Parser = js_parser.Parser;
const Prefill = js_parser.Prefill;
const PrependTempRefsOpts = js_parser.PrependTempRefsOpts;
const PropertyOpts = js_parser.PropertyOpts;
const ReactRefresh = js_parser.ReactRefresh;
const Ref = js_parser.Ref;
const RefMap = js_parser.RefMap;
const RefRefMap = js_parser.RefRefMap;
const RelocateVars = js_parser.RelocateVars;
const RuntimeFeatures = js_parser.RuntimeFeatures;
const RuntimeImports = js_parser.RuntimeImports;
const ScanPassResult = js_parser.ScanPassResult;
const ScopeOrder = js_parser.ScopeOrder;
const ScopeOrderList = js_parser.ScopeOrderList;
const SideEffects = js_parser.SideEffects;
const StmtList = js_parser.StmtList;
const StmtsKind = js_parser.StmtsKind;
const StrictModeFeature = js_parser.StrictModeFeature;
const StringBoolMap = js_parser.StringBoolMap;
const StringVoidMap = js_parser.StringVoidMap;
const Substitution = js_parser.Substitution;
const TempRef = js_parser.TempRef;
const ThenCatchChain = js_parser.ThenCatchChain;
const TransposeState = js_parser.TransposeState;
const TypeParameterFlag = js_parser.TypeParameterFlag;
const TypeScript = js_parser.TypeScript;
const VisitArgsOpts = js_parser.VisitArgsOpts;
const WrapMode = js_parser.WrapMode;
const arguments_str = js_parser.arguments_str;
const exports_string_name = js_parser.exports_string_name;
const floatToInt32 = js_parser.floatToInt32;
const foldStringAddition = js_parser.foldStringAddition;
const fs = js_parser.fs;
const generatedSymbolName = js_parser.generatedSymbolName;
const isEvalOrArguments = js_parser.isEvalOrArguments;
const locModuleScope = js_parser.locModuleScope;
const options = js_parser.options;
const renamer = js_parser.renamer;
const statementCaresAboutScope = js_parser.statementCaresAboutScope;

const std = @import("std");
const AutoHashMap = std.AutoHashMap;
const List = std.ArrayListUnmanaged;
const ListManaged = std.ArrayList;
const Map = std.AutoHashMapUnmanaged;
const Allocator = std.mem.Allocator;
