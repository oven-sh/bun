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
