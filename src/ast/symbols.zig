pub fn Template(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const jsx_transform_type = P.jsx_transform_type;
        const allow_macros = P.allow_macros;
        const BinaryExpressionVisitor = P.BinaryExpressionVisitor;
        const is_typescript_enabled = P.is_typescript_enabled;
        const createDefaultName = P.createDefaultName;
        const track_symbol_usage_during_parse_pass = P.track_symbol_usage_during_parse_pass;
        const extractDeclsForBinding = P.extractDeclsForBinding;
        const is_jsx_enabled = P.is_jsx_enabled;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;
        const LowerUsingDeclarationsContext = P.LowerUsingDeclarationsContext;
        const isSimpleParameterList = P.isSimpleParameterList;

        pub fn findSymbol(noalias p: *P, loc: logger.Loc, name: string) !FindSymbolResult {
            return findSymbolWithRecordUsage(p, loc, name, true);
        }

        pub fn findSymbolWithRecordUsage(noalias p: *P, loc: logger.Loc, name: string, comptime record_usage: bool) !FindSymbolResult {
            var declare_loc: logger.Loc = logger.Loc.Empty;
            var is_inside_with_scope = false;
            // This function can show up in profiling.
            // That's part of why we do this.
            // Instead of rehashing `name` for every scope, we do it just once.
            const hash = Scope.getMemberHash(name);
            const allocator = p.allocator;

            const ref: Ref = brk: {
                var current: ?*Scope = p.current_scope;

                var did_forbid_arguments = false;

                while (current) |scope| : (current = current.?.parent) {
                    // Track if we're inside a "with" statement body
                    if (scope.kind == .with) {
                        is_inside_with_scope = true;
                    }

                    // Forbid referencing "arguments" inside class bodies
                    if (scope.forbid_arguments and !did_forbid_arguments and strings.eqlComptime(name, "arguments")) {
                        const r = js_lexer.rangeOfIdentifier(p.source, loc);
                        p.log.addRangeErrorFmt(p.source, r, allocator, "Cannot access \"{s}\" here", .{name}) catch unreachable;
                        did_forbid_arguments = true;
                    }

                    // Is the symbol a member of this scope?
                    if (scope.getMemberWithHash(name, hash)) |member| {
                        declare_loc = member.loc;
                        break :brk member.ref;
                    }

                    // Is the symbol a member of this scope's TypeScript namespace?
                    if (scope.ts_namespace) |ts_namespace| {
                        if (ts_namespace.exported_members.get(name)) |member| {
                            if (member.data.isEnum() == ts_namespace.is_enum_scope) {
                                declare_loc = member.loc;
                                // If this is an identifier from a sibling TypeScript namespace, then we're
                                // going to have to generate a property access instead of a simple reference.
                                // Lazily-generate an identifier that represents this property access.
                                const gop = try ts_namespace.property_accesses.getOrPut(p.allocator, name);
                                if (!gop.found_existing) {
                                    const ref = try p.newSymbol(.other, name);
                                    gop.value_ptr.* = ref;
                                    p.symbols.items[ref.inner_index].namespace_alias = .{
                                        .namespace_ref = ts_namespace.arg_ref,
                                        .alias = name,
                                    };
                                    break :brk ref;
                                }
                                break :brk gop.value_ptr.*;
                            }
                        }
                    }
                }

                // Allocate an "unbound" symbol
                p.checkForNonBMPCodePoint(loc, name);
                if (comptime !record_usage) {
                    return FindSymbolResult{
                        .ref = Ref.None,
                        .declare_loc = loc,
                        .is_inside_with_scope = is_inside_with_scope,
                    };
                }

                const gpe = p.module_scope.getOrPutMemberWithHash(allocator, name, hash) catch unreachable;

                // I don't think this happens?
                if (gpe.found_existing) {
                    const existing = gpe.value_ptr.*;
                    declare_loc = existing.loc;
                    break :brk existing.ref;
                }

                const _ref = p.newSymbol(.unbound, name) catch unreachable;

                gpe.key_ptr.* = name;
                gpe.value_ptr.* = js_ast.Scope.Member{ .ref = _ref, .loc = loc };

                declare_loc = loc;

                break :brk _ref;
            };

            // If we had to pass through a "with" statement body to get to the symbol
            // declaration, then this reference could potentially also refer to a
            // property on the target object of the "with" statement. We must not rename
            // it or we risk changing the behavior of the code.
            if (is_inside_with_scope) {
                p.symbols.items[ref.innerIndex()].must_not_be_renamed = true;
            }

            // Track how many times we've referenced this symbol
            if (comptime record_usage) p.recordUsage(ref);

            return FindSymbolResult{
                .ref = ref,
                .declare_loc = declare_loc,
                .is_inside_with_scope = is_inside_with_scope,
            };
        }
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
