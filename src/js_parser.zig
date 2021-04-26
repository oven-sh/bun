const std = @import("std");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const importRecord = @import("import_record.zig");
const js_ast = @import("js_ast.zig");
const options = @import("options.zig");
const alloc = @import("alloc.zig");

const fs = @import("fs.zig");
usingnamespace @import("strings.zig");
usingnamespace @import("ast/base.zig");
usingnamespace js_ast.G;

const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;

const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const assert = std.debug.assert;

const Ref = js_ast.Ref;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const T = js_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;
const locModuleScope = logger.Loc.Empty;

const ExprOrLetStmt = struct {
    stmt_or_expr: js_ast.StmtOrExpr,
    decls: []G.Decl = &([_]G.Decl{}),
};

const ExprIn = struct {
    // This tells us if there are optional chain expressions (EDot, EIndex, or
    // ECall) that are chained on to this expression. Because of the way the AST
    // works, chaining expressions on to this expression means they are our
    // parent expressions.
    //
    // Some examples:
    //
    //   a?.b.c  // EDot
    //   a?.b[c] // EIndex
    //   a?.b()  // ECall
    //
    // Note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainStart. That means it's the start of a new chain, so
    // it's not considered part of this one.
    //
    // Some examples:
    //
    //   a?.b?.c   // EDot
    //   a?.b?.[c] // EIndex
    //   a?.b?.()  // ECall
    //
    // Also note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainNone. That means it's outside parentheses, which
    // means it's no longer part of the chain.
    //
    // Some examples:
    //
    //   (a?.b).c  // EDot
    //   (a?.b)[c] // EIndex
    //   (a?.b)()  // ECall
    //
    has_chain_parent: bool = false,

    // If our parent is an ECall node with an OptionalChain value of
    // OptionalChainStart, then we will need to store the value for the "this" of
    // that call somewhere if the current expression is an optional chain that
    // ends in a property access. That's because the value for "this" will be
    // used twice: once for the inner optional chain and once for the outer
    // optional chain.
    //
    // Example:
    //
    //   // Original
    //   a?.b?.();
    //
    //   // Lowered
    //   var _a;
    //   (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.call(a);
    //
    // In the example above we need to store "a" as the value for "this" so we
    // can substitute it back in when we call "_a" if "_a" is indeed present.
    // See also "thisArgFunc" and "thisArgWrapFunc" in "exprOut".
    store_this_arg_for_parent_optional_chain: bool = false,

    // Certain substitutions of identifiers are disallowed for assignment targets.
    // For example, we shouldn't transform "undefined = 1" into "void 0 = 1". This
    // isn't something real-world code would do but it matters for conformance
    // tests.
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,
};

const ExprOut = struct {
    // True if the child node is an optional chain node (EDot, EIndex, or ECall
    // with an IsOptionalChain value of true)
    child_contains_optional_chain: bool = false,
};

const Tup = std.meta.Tuple;

// This function exists to tie all of these checks together in one place
fn isEvalOrArguments(name: string) bool {
    return strings.eql(name, "eval") or strings.eql(name, "arguments");
}

const PrependTempRefsOpts = struct {
    fn_body_loc: ?logger.Loc = null,
    kind: StmtsKind = StmtsKind.none,
};

pub const StmtsKind = enum {
    none,
    loop_body,
    fn_body,
};

fn notimpl() noreturn {
    std.debug.panic("Not implemented yet!!", .{});
}

fn lexerpanic() noreturn {
    std.debug.panic("LexerPanic", .{});
}

fn fail() noreturn {
    std.debug.panic("Something went wrong :cry;", .{});
}

const ExprBindingTuple = struct { expr: ?ExprNodeIndex = null, binding: ?Binding = null, override_expr: ?ExprNodeIndex = null };

const TempRef = struct {
    ref: Ref,
    value: ?Expr = null,
};

const ImportNamespaceCallOrConstruct = struct {
    ref: js_ast.Ref,
    is_construct: bool = false,
};

const ThenCatchChain = struct {
    next_target: js_ast.E,
    has_multiple_args: bool = false,
    has_catch: bool = false,
};

const ParsedPath = struct { loc: logger.Loc, text: string };

const StrictModeFeature = enum {
    with_statement,
    delete_bare_name,
    for_in_var_init,
    eval_or_arguments,
    reserved_word,
    legacy_octal_literal,
    legacy_octal_escape,
    if_else_function_stmt,
};

const SymbolMergeResult = enum {
    forbidden,
    replace_with_new,
    overwrite_with_new,
    keep_existing,
    become_private_get_set_pair,
    become_private_static_get_set_pair,
};

const Map = std.AutoHashMap;

const List = std.ArrayList;
const LocList = List(logger.Loc);
const StmtList = List(Stmt);

const SymbolUseMap = Map(js_ast.Ref, js_ast.Symbol.Use);
const StringRefMap = std.StringHashMap(js_ast.Ref);
const StringBoolMap = std.StringHashMap(bool);
const RefBoolMap = Map(js_ast.Ref, bool);
const RefRefMap = Map(js_ast.Ref, js_ast.Ref);
const ImportRecord = importRecord.ImportRecord;
const Flags = js_ast.Flags;
const ScopeOrder = struct {
    loc: logger.Loc,
    scope: *js_ast.Scope,
};

const ParenExprOpts = struct {
    async_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    force_arrow_fn: bool = false,
};

// This is function-specific information used during parsing. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataParse = struct {
    async_range: ?logger.Range = null,
    allow_await: bool = false,
    allow_yield: bool = false,
    allow_super_call: bool = false,
    is_top_level: bool = false,
    is_constructor: bool = false,
    is_typescript_declare: bool = false,
    arrow_arg_errors: ?DeferredArrowArgErrors = null,

    // In TypeScript, forward declarations of functions have no bodies
    allow_missing_body_for_type_script: bool = false,

    // Allow TypeScript decorators in function arguments
    allow_ts_decorators: bool = false,

    pub fn i() FnOrArrowDataParse {
        return FnOrArrowDataParse{ .allow_await = false };
    }
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataVisit = struct {
    super_index_ref: ?*js_ast.Ref = null,

    is_arrow: bool = false,
    is_async: bool = false,
    is_inside_loop: bool = false,
    is_inside_switch: bool = false,
    is_outside_fn_or_arrow: bool = false,

    // This is used to silence unresolvable imports due to "require" calls inside
    // a try/catch statement. The assumption is that the try/catch statement is
    // there to handle the case where the reference to "require" crashes.
    try_body_count: i32 = 0,
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions (but not
// nested arrow functions).
const FnOnlyDataVisit = struct {
    // This is a reference to the magic "arguments" variable that exists inside
    // functions in JavaScript. It will be non-nil inside functions and nil
    // otherwise.
    arguments_ref: ?js_ast.Ref = null,

    // Arrow functions don't capture the value of "this" and "arguments". Instead,
    // the values are inherited from the surrounding context. If arrow functions
    // are turned into regular functions due to lowering, we will need to generate
    // local variables to capture these values so they are preserved correctly.
    this_capture_ref: ?js_ast.Ref = null,
    arguments_capture_ref: ?js_ast.Ref = null,

    // Inside a static class property initializer, "this" expressions should be
    // replaced with the class name.
    this_class_static_ref: ?js_ast.Ref = null,

    // If we're inside an async arrow function and async functions are not
    // supported, then we will have to convert that arrow function to a generator
    // function. That means references to "arguments" inside the arrow function
    // will have to reference a captured variable instead of the real variable.
    is_inside_async_arrow_fn: bool = false,

    // If false, the value for "this" is the top-level module scope "this" value.
    // That means it's "undefined" for ECMAScript modules and "exports" for
    // CommonJS modules. We track this information so that we can substitute the
    // correct value for these top-level "this" references at compile time instead
    // of passing the "this" expression through to the output and leaving the
    // interpretation up to the run-time behavior of the generated code.
    //
    // If true, the value for "this" is nested inside something (either a function
    // or a class declaration). That means the top-level module scope "this" value
    // has been shadowed and is now inaccessible.
    is_this_nested: bool = false,
};

// Due to ES6 destructuring patterns, there are many cases where it's
// impossible to distinguish between an array or object literal and a
// destructuring assignment until we hit the "=" operator later on.
// This object defers errors about being in one state or the other
// until we discover which state we're in.
const DeferredErrors = struct {
    // These are errors for expressions
    invalid_expr_default_value: ?logger.Range = null,
    invalid_expr_after_question: ?logger.Range = null,
    array_spread_feature: ?logger.Range = null,

    pub fn isEmpty(self: *DeferredErrors) bool {
        return self.invalid_expr_default_value == null and self.invalid_expr_after_question == null and self.array_spread_feature == null;
    }

    pub fn mergeInto(self: *DeferredErrors, to: *DeferredErrors) void {
        if (self.invalid_expr_default_value) |inv| {
            to.invalid_expr_default_value = inv;
        }

        if (self.invalid_expr_after_question) |inv| {
            to.invalid_expr_after_question = inv;
        }

        if (self.array_spread_feature) |inv| {
            to.array_spread_feature = inv;
        }
    }

    var None = DeferredErrors{
        .invalid_expr_default_value = null,
        .invalid_expr_after_question = null,
        .array_spread_feature = null,
    };
};

const ImportClause = struct {
    items: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
};

const ModuleType = enum { esm };

const PropertyOpts = struct {
    async_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    is_generator: bool = false,

    // Class-related options
    is_static: bool = false,
    is_class: bool = false,
    class_has_extends: bool = false,
    allow_ts_decorators: bool = false,
    ts_decorators: []Expr = &[_]Expr{},
};

pub const Parser = struct {
    options: Options,
    lexer: js_lexer.Lexer,
    log: *logger.Log,
    source: logger.Source,
    allocator: *std.mem.Allocator,
    p: ?*P,

    pub const Result = struct { ast: js_ast.Ast, ok: bool = false };

    pub const Options = struct {
        jsx: options.JSX,
        ts: bool = true,
        ascii_only: bool = true,
        keep_names: bool = true,
        mangle_syntax: bool = false,
        mange_identifiers: bool = false,
        omit_runtime_for_tests: bool = false,
        ignore_dce_annotations: bool = true,
        preserve_unused_imports_ts: bool = false,
        use_define_for_class_fields: bool = false,
        suppress_warnings_about_weird_code: bool = true,
        moduleType: ModuleType = ModuleType.esm,
    };

    pub fn parse(self: *Parser) !Result {
        if (self.p == null) {
            self.p = try P.init(self.allocator, self.log, self.source, self.lexer, self.options);
        }

        var result: Result = undefined;

        if (self.p) |p| {
            // Parse the file in the first pass, but do not bind symbols
            var opts = ParseStatementOptions{ .is_module_scope = true };
            const stmts = try p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts);
            try p.prepareForVisitPass();

            // ESM is always strict mode. I don't think we need this.
            // // Strip off a leading "use strict" directive when not bundling
            // var directive = "";

            // Insert a variable for "import.meta" at the top of the file if it was used.
            // We don't need to worry about "use strict" directives because this only
            // happens when bundling, in which case we are flatting the module scopes of
            // all modules together anyway so such directives are meaningless.
            if (!p.import_meta_ref.isNull()) {
                // heap so it lives beyond this function call
                var decls = try p.allocator.alloc(G.Decl, 1);
                decls[0] = Decl{ .binding = p.b(B.Identifier{
                    .ref = p.import_meta_ref,
                }, logger.Loc.Empty), .value = p.e(E.Object{}, logger.Loc.Empty) };
                var importMetaStatement = p.s(S.Local{
                    .kind = .k_const,
                    .decls = decls,
                }, logger.Loc.Empty);
            }

            var parts = try List(js_ast.Part).initCapacity(p.allocator, 1);
            try p.appendPart(parts, stmts);

            // Pop the module scope to apply the "ContainsDirectEval" rules
            p.popScope();

            result = p.toAST(parts);
            result.source_map_comment = p.lexer.source_mapping_url;
        }

        return result;
    }

    pub fn init(transform: options.TransformOptions, log: *logger.Log, source: *logger.Source, allocator: *std.mem.Allocator) !Parser {
        const lexer = try js_lexer.Lexer.init(log, source, allocator);
        return Parser{
            .options = Options{
                .ts = transform.ts,
                .jsx = options.JSX{
                    .parse = true,
                    .factory = transform.jsx_factory,
                    .fragment = transform.jsx_fragment,
                },
            },
            .allocator = allocator,
            .lexer = lexer,
            .source = source.*,
            .log = log,
            .p = null,
        };
    }
};

const FindSymbolResult = struct {
    ref: Ref,
    declare_loc: ?logger.Loc = null,
    is_inside_with_scope: bool = false,
};
const ExportClauseResult = struct { clauses: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}), is_single_line: bool = false };

const DeferredTsDecorators = struct {
    values: []js_ast.Expr,

    // If this turns out to be a "declare class" statement, we need to undo the
    // scopes that were potentially pushed while parsing the decorator arguments.
    scope_index: usize,
};

const LexicalDecl = enum(u8) { forbid, allow_all, allow_fn_inside_if, allow_fn_inside_label };

const ParseClassOptions = struct {
    ts_decorators: []Expr = &[_]Expr{},
    allow_ts_decorators: bool = false,
    is_type_script_declare: bool = false,
};

const ParseStatementOptions = struct {
    ts_decorators: ?DeferredTsDecorators = null,
    lexical_decl: LexicalDecl = .forbid,
    is_module_scope: bool = false,
    is_namespace_scope: bool = false,
    is_export: bool = false,
    is_name_optional: bool = false, // For "export default" pseudo-statements,
    is_typescript_declare: bool = false,
};

// P is for Parser!
const P = struct {
    allocator: *std.mem.Allocator,
    options: Parser.Options,
    log: *logger.Log,
    source: logger.Source,
    lexer: js_lexer.Lexer,
    allow_in: bool = false,
    allow_private_identifiers: bool = false,
    has_top_level_return: bool = false,
    latest_return_had_semicolon: bool = false,
    has_import_meta: bool = false,
    has_es_module_syntax: bool = false,
    top_level_await_keyword: logger.Range,
    fn_or_arrow_data_parse: FnOrArrowDataParse,
    fn_or_arrow_data_visit: FnOrArrowDataVisit,
    fn_only_data_visit: FnOnlyDataVisit,
    allocated_names: List(string),
    latest_arrow_arg_loc: logger.Loc = logger.Loc.Empty,
    forbid_suffix_after_as_loc: logger.Loc = logger.Loc.Empty,
    current_scope: *js_ast.Scope = null,
    scopes_for_current_part: List(*js_ast.Scope),
    symbols: List(js_ast.Symbol),
    ts_use_counts: List(u32),
    exports_ref: js_ast.Ref = js_ast.Ref.None,
    require_ref: js_ast.Ref = js_ast.Ref.None,
    module_ref: js_ast.Ref = js_ast.Ref.None,
    import_meta_ref: js_ast.Ref = js_ast.Ref.None,
    promise_ref: ?js_ast.Ref = null,

    data: js_ast.AstData,

    injected_define_symbols: []js_ast.Ref,
    symbol_uses: SymbolUseMap,
    declared_symbols: List(js_ast.DeclaredSymbol),
    runtime_imports: StringRefMap,
    duplicate_case_checker: void,
    non_bmp_identifiers: StringBoolMap,
    legacy_octal_literals: void,
    // legacy_octal_literals:      map[js_ast.E]logger.Range,

    // For strict mode handling
    hoistedRefForSloppyModeBlockFn: void,

    // For lowering private methods
    weak_map_ref: ?js_ast.Ref,
    weak_set_ref: ?js_ast.Ref,
    private_getters: RefRefMap,
    private_setters: RefRefMap,

    // These are for TypeScript
    should_fold_numeric_constants: bool = false,
    emitted_namespace_vars: RefBoolMap,
    is_exported_inside_namespace: RefRefMap,
    known_enum_values: Map(js_ast.Ref, std.StringHashMap(f64)),
    local_type_names: StringBoolMap,

    // This is the reference to the generated function argument for the namespace,
    // which is different than the reference to the namespace itself:
    //
    //   namespace ns {
    //   }
    //
    // The code above is transformed into something like this:
    //
    //   var ns1;
    //   (function(ns2) {
    //   })(ns1 or (ns1 = {}));
    //
    // This variable is "ns2" not "ns1". It is only used during the second
    // "visit" pass.
    enclosing_namespace_arg_ref: ?js_ast.Ref = null,

    // Imports (both ES6 and CommonJS) are tracked at the top level
    import_records: List(ImportRecord),
    import_records_for_current_part: List(u32),
    export_star_import_records: List(u32),

    // These are for handling ES6 imports and exports
    es6_import_keyword: logger.Range = logger.Range.None,
    es6_export_keyword: logger.Range = logger.Range.None,
    enclosing_class_keyword: logger.Range = logger.Range.None,
    import_items_for_namespace: Map(js_ast.Ref, std.StringHashMap(js_ast.LocRef)),
    is_import_item: RefBoolMap,
    named_imports: Map(js_ast.Ref, js_ast.NamedImport),
    named_exports: std.StringHashMap(js_ast.NamedExport),
    top_level_symbol_to_parts: Map(js_ast.Ref, List(u32)),
    import_namespace_cc_map: Map(ImportNamespaceCallOrConstruct, bool),

    // The parser does two passes and we need to pass the scope tree information
    // from the first pass to the second pass. That's done by tracking the calls
    // to pushScopeForParsePass() and popScope() during the first pass in
    // scopesInOrder.
    //
    // Then, when the second pass calls pushScopeForVisitPass() and popScope(),
    // we consume entries from scopesInOrder and make sure they are in the same
    // order. This way the second pass can efficiently use the same scope tree
    // as the first pass without having to attach the scope tree to the AST.
    //
    // We need to split this into two passes because the pass that declares the
    // symbols must be separate from the pass that binds identifiers to declared
    // symbols to handle declaring a hoisted "var" symbol in a nested scope and
    // binding a name to it in a parent or sibling scope.
    scopes_in_order: List(ScopeOrder),

    // These properties are for the visit pass, which runs after the parse pass.
    // The visit pass binds identifiers to declared symbols, does constant
    // folding, substitutes compile-time variable definitions, and lowers certain
    // syntactic constructs as appropriate.
    stmt_expr_value: js_ast.E,
    call_target: js_ast.E,
    delete_target: js_ast.E,
    loop_body: js_ast.S,
    module_scope: *js_ast.Scope = undefined,
    is_control_flow_dead: bool = false,

    // Inside a TypeScript namespace, an "export declare" statement can be used
    // to cause a namespace to be emitted even though it has no other observable
    // effect. This flag is used to implement this feature.
    //
    // Specifically, namespaces should be generated for all of the following
    // namespaces below except for "f", which should not be generated:
    //
    //   namespace a { export declare const a }
    //   namespace b { export declare let [[b]] }
    //   namespace c { export declare function c() }
    //   namespace d { export declare class d {} }
    //   namespace e { export declare enum e {} }
    //   namespace f { export declare namespace f {} }
    //
    // The TypeScript compiler compiles this into the following code (notice "f"
    // is missing):
    //
    //   var a; (function (a_1) {})(a or (a = {}));
    //   var b; (function (b_1) {})(b or (b = {}));
    //   var c; (function (c_1) {})(c or (c = {}));
    //   var d; (function (d_1) {})(d or (d = {}));
    //   var e; (function (e_1) {})(e or (e = {}));
    //
    // Note that this should not be implemented by declaring symbols for "export
    // declare" statements because the TypeScript compiler doesn't generate any
    // code for these statements, so these statements are actually references to
    // global variables. There is one exception, which is that local variables
    // *should* be declared as symbols because they are replaced with. This seems
    // like very arbitrary behavior but it's what the TypeScript compiler does,
    // so we try to match it.
    //
    // Specifically, in the following code below "a" and "b" should be declared
    // and should be substituted with "ns.a" and "ns.b" but the other symbols
    // shouldn't. References to the other symbols actually refer to global
    // variables instead of to symbols that are exported from the namespace.
    // This is the case as of TypeScript 4.3. I assume this is a TypeScript bug:
    //
    //   namespace ns {
    //     export declare const a
    //     export declare let [[b]]
    //     export declare function c()
    //     export declare class d { }
    //     export declare enum e { }
    //     console.log(a, b, c, d, e)
    //   }
    //
    // The TypeScript compiler compiles this into the following code:
    //
    //   var ns;
    //   (function (ns) {
    //       console.log(ns.a, ns.b, c, d, e);
    //   })(ns or (ns = {}));
    //
    // Relevant issue: https://github.com/evanw/esbuild/issues/1158
    has_non_local_export_declare_inside_namespace: bool = false,

    // This helps recognize the "await import()" pattern. When this is present,
    // warnings about non-string import paths will be omitted inside try blocks.
    await_target: ?js_ast.E = null,

    // This helps recognize the "import().catch()" pattern. We also try to avoid
    // warning about this just like the "try { await import() }" pattern.
    then_catch_chain: ThenCatchChain,

    // Temporary variables used for lowering
    temp_refs_to_declare: List(TempRef),
    temp_ref_count: i32 = 0,

    // When bundling, hoisted top-level local variables declared with "var" in
    // nested scopes are moved up to be declared in the top-level scope instead.
    // The old "var" statements are turned into regular assignments instead. This
    // makes it easier to quickly scan the top-level statements for "var" locals
    // with the guarantee that all will be found.
    relocated_top_level_vars: List(js_ast.LocRef),

    // ArrowFunction is a special case in the grammar. Although it appears to be
    // a PrimaryExpression, it's actually an AssignmentExpression. This means if
    // a AssignmentExpression ends up producing an ArrowFunction then nothing can
    // come after it other than the comma operator, since the comma operator is
    // the only thing above AssignmentExpression under the Expression rule:
    //
    //   AssignmentExpression:
    //     ArrowFunction
    //     ConditionalExpression
    //     LeftHandSideExpression = AssignmentExpression
    //     LeftHandSideExpression AssignmentOperator AssignmentExpression
    //
    //   Expression:
    //     AssignmentExpression
    //     Expression , AssignmentExpression
    //
    after_arrow_body_loc: logger.Loc = logger.Loc.Empty,

    pub fn s(p: *P, t: anytype, loc: logger.Loc) Stmt {
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Stmt.init(t, loc);
        } else {
            return Stmt.alloc(p.allocator, t, loc);
        }
    }
    pub fn e(p: *P, t: anytype, loc: logger.Loc) Expr {
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Expr.init(t, loc);
        } else {
            return Expr.alloc(p.allocator, t, loc);
        }
    }

    pub fn b(p: *P, t: anytype, loc: logger.Loc) Binding {
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Binding.init(t, loc);
        } else {
            return Binding.alloc(p.allocator, t, loc);
        }
    }

    pub fn deinit(parser: *P) void {
        parser.allocated_names.deinit();
        parser.scopes_for_current_part.deinit();
        parser.symbols.deinit();
        parser.ts_use_counts.deinit();
        parser.declared_symbols.deinit();
        parser.known_enum_values.deinit();
        parser.import_records.deinit();
        parser.import_records_for_current_part.deinit();
        parser.export_star_import_records.deinit();
        parser.import_items_for_namespace.deinit();
        parser.named_imports.deinit();
        parser.top_level_symbol_to_parts.deinit();
        parser.import_namespace_cc_map.deinit();
        parser.scopes_in_order.deinit();
        parser.temp_refs_to_declare.deinit();
        parser.relocated_top_level_vars.deinit();
    }

    pub fn findSymbol(p: *P, loc: logger.Loc, name: string) !FindSymbolResult {
        var ref: Ref = undefined;
        var declare_loc: logger.Loc = undefined;
        var is_inside_with_scope = false;
        var did_forbid_argumen = false;
        var scope = p.current_scope;

        while (true) {

            // Track if we're inside a "with" statement body
            if (scope.kind == .with) {
                is_inside_with_scope = true;
            }

            // Forbid referencing "arguments" inside class bodies
            if (scope.forbid_arguments and strings.eql(name, "arguments") and !did_forbid_argumen) {
                const r = js_lexer.rangeOfIdentifier(&p.source, loc);
                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot access \"{s}\" here", .{name}) catch unreachable;
                did_forbid_argumen = true;
            }

            // Is the symbol a member of this scope?
            if (scope.members.get(name)) |member| {
                ref = member.ref;
                declare_loc = member.loc;
                break;
            }

            if (scope.parent) |parent| {
                scope = parent;
            } else {
                // Allocate an "unbound" symbol
                p.checkForNonBMPCodePoint(loc, name);
                ref = try p.newSymbol(.unbound, name);
                declare_loc = loc;
                try p.module_scope.members.put(name, js_ast.Scope.Member{ .ref = ref, .loc = logger.Loc.Empty });
                break;
            }
        }

        // If we had to pass through a "with" statement body to get to the symbol
        // declaration, then this reference could potentially also refer to a
        // property on the target object of the "with" statement. We must not rename
        // it or we risk changing the behavior of the code.
        if (is_inside_with_scope) {
            p.symbols.items[ref.inner_index].must_not_be_renamed = true;
        }

        // Track how many times we've referenced this symbol
        p.recordUsage(&ref);
        return FindSymbolResult{
            .ref = ref,
            .declare_loc = declare_loc,
            .is_inside_with_scope = is_inside_with_scope,
        };
    }

    pub fn recordUsage(p: *P, ref: *js_ast.Ref) void {
        // The use count stored in the symbol is used for generating symbol names
        // during minification. These counts shouldn't include references inside dead
        // code regions since those will be culled.
        if (!p.is_control_flow_dead) {
            p.symbols.items[ref.inner_index].use_count_estimate += 1;
            var use = p.symbol_uses.get(ref.*) orelse unreachable;
            use.count_estimate += 1;
            p.symbol_uses.put(ref.*, use) catch unreachable;
        }

        // The correctness of TypeScript-to-JavaScript conversion relies on accurate
        // symbol use counts for the whole file, including dead code regions. This is
        // tracked separately in a parser-only data structure.
        if (p.options.ts) {
            p.ts_use_counts.items[ref.inner_index] += 1;
        }
    }

    pub fn findSymbolHelper(self: *P, loc: logger.Loc, name: string) ?js_ast.Ref {
        if (self.findSymbol(loc, name)) |sym| {
            return sym.ref;
        }

        return null;
    }

    pub fn symbolForDefineHelper(self: *P, i: usize) ?js_ast.Ref {
        if (self.injected_define_symbols.items.len > i) {
            return self.injected_define_symbols.items[i];
        }

        return null;
    }

    pub fn logArrowArgErrors(p: *P, errors: *DeferredArrowArgErrors) void {
        if (errors.invalid_expr_await.len > 0) {
            var r = errors.invalid_expr_await;
            p.log.addRangeError(p.source, r, "Cannot use an \"await\" expression here") catch unreachable;
        }

        if (errors.invalid_expr_yield.len > 0) {
            var r = errors.invalid_expr_yield;
            p.log.addRangeError(p.source, r, "Cannot use a \"yield\" expression here") catch unreachable;
        }
    }

    pub fn keyNameForError(p: *P, key: js_ast.Expr) string {
        switch (key.data) {
            .e_string => {
                return p.lexer.raw();
            },
            .e_private_identifier => {
                return p.lexer.raw();
                // return p.loadNameFromRef()
            },
            else => {
                return "property";
            },
        }
    }

    pub fn canMergeSymbols(p: *P, scope: *js_ast.Scope, existing: Symbol.Kind, new: Symbol.Kind) SymbolMergeResult {
        if (existing == .unbound) {
            return .replace_with_new;
        }

        // In TypeScript, imports are allowed to silently collide with symbols within
        // the module. Presumably this is because the imports may be type-only:
        //
        //   import {Foo} from 'bar'
        //   class Foo {}
        //
        if (p.options.ts and existing == .import) {
            return .replace_with_new;
        }

        // "enum Foo {} enum Foo {}"
        // "namespace Foo { ... } enum Foo {}"
        if (new == .ts_enum and (existing == .ts_enum or existing == .ts_namespace)) {
            return .replace_with_new;
        }

        // "namespace Foo { ... } namespace Foo { ... }"
        // "function Foo() {} namespace Foo { ... }"
        // "enum Foo {} namespace Foo { ... }"
        if (new == .ts_namespace) {
            switch (existing) {
                .ts_namespace, .hoisted_function, .generator_or_async_function, .ts_enum, .class => {
                    return .keep_existing;
                },
                else => {},
            }
        }

        // "var foo; var foo;"
        // "var foo; function foo() {}"
        // "function foo() {} var foo;"
        // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
        if (Symbol.isKindHoistedOrFunction(new) and Symbol.isKindHoistedOrFunction(existing) and (scope.kind == .entry or scope.kind == .function_body or
            (Symbol.isKindHoisted(new) and Symbol.isKindHoisted(existing))))
        {
            return .keep_existing;
        }

        // "get #foo() {} set #foo() {}"
        // "set #foo() {} get #foo() {}"
        if ((existing == .private_get and new == .private_set) or
            (existing == .private_set and new == .private_get))
        {
            return .become_private_get_set_pair;
        }
        if ((existing == .private_static_get and new == .private_static_set) or
            (existing == .private_static_set and new == .private_static_get))
        {
            return .become_private_static_get_set_pair;
        }

        // "try {} catch (e) { var e }"
        if (existing == .catch_identifier and new == .hoisted) {
            return .replace_with_new;
        }

        // "function() { var arguments }"
        if (existing == .arguments and new == .hoisted) {
            return .keep_existing;
        }

        // "function() { let arguments }"
        if (existing == .arguments and new != .hoisted) {
            return .overwrite_with_new;
        }

        return .forbidden;
    }

    pub fn prepareForVisitPass(p: *P) !void {
        try p.pushScopeForVisitPass(js_ast.Scope.Kind.entry, locModuleScope);
        p.fn_or_arrow_data_visit.is_outside_fn_or_arrow = true;
        p.module_scope = p.current_scope;
        p.has_es_module_syntax = p.es6_import_keyword.len > 0 or p.es6_export_keyword.len > 0 or p.top_level_await_keyword.len > 0;

        // ECMAScript modules are always interpreted as strict mode. This has to be
        // done before "hoistSymbols" because strict mode can alter hoisting (!).
        if (p.es6_import_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_import);
        } else if (p.es6_export_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_export);
        } else if (p.top_level_await_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_top_level_await);
        }

        p.hoistSymbols(p.module_scope);
    }

    pub fn hoistSymbols(p: *P, scope: *js_ast.Scope) void {
        if (!scope.kindStopsHoisting()) {
            var iter = scope.members.iterator();
            nextMember: while (iter.next()) |res| {
                var symbol = p.symbols.items[res.value.ref.inner_index];
                if (!symbol.isHoisted()) {
                    continue :nextMember;
                }
            }
        }
    }

    pub fn unshiftScopeOrder(self: *P) !ScopeOrder {
        if (self.scopes_in_order.items.len == 0) {
            var scope = try js_ast.Scope.initPtr(self.allocator);
            return ScopeOrder{
                .scope = scope,
                .loc = logger.Loc.Empty,
            };
        } else {
            return self.scopes_in_order.orderedRemove(0);
        }
    }

    pub fn pushScopeForVisitPass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !void {
        var order = try p.unshiftScopeOrder();

        // Sanity-check that the scopes generated by the first and second passes match
        if (!order.loc.eql(loc) or order.scope.kind != kind) {
            std.debug.panic("Expected scope ({s}, {d}) in {s}, found scope ({s}, {d})", .{ kind, loc.start, p.source.path.pretty, order.scope.kind, order.loc.start });
        }

        p.current_scope = order.scope;

        try p.scopes_for_current_part.append(order.scope);
    }

    pub fn pushScopeForParsePass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !usize {
        var parent = p.current_scope;
        var scope = try js_ast.Scope.initPtr(p.allocator);
        scope.kind = kind;
        scope.parent = parent;

        scope.label_ref = null;

        var i = parent.children.items.len;

        try parent.children.append(scope);
        scope.strict_mode = parent.strict_mode;
        p.current_scope = scope;

        // Enforce that scope locations are strictly increasing to help catch bugs
        // where the pushed scopes are mistmatched between the first and second passes
        if (p.scopes_in_order.items.len > 0) {
            const prev_start = p.scopes_in_order.items[p.scopes_in_order.items.len - 1].loc.start;
            if (prev_start >= loc.start) {
                std.debug.panic("Scope location {d} must be greater than {d}", .{ loc.start, prev_start });
            }
        }

        // Copy down function arguments into the function body scope. That way we get
        // errors if a statement in the function body tries to re-declare any of the
        // arguments.
        if (kind == js_ast.Scope.Kind.function_body) {
            if (parent.kind != js_ast.Scope.Kind.function_args) {
                std.debug.panic("Internal error", .{});
            }

            var iter = scope.parent.?.members.iterator();
            while (iter.next()) |entry| {
                // 	// Don't copy down the optional function expression name. Re-declaring
                // 	// the name of a function expression is allowed.
                const adjacent_symbols = p.symbols.items[entry.value.ref.inner_index];
                if (adjacent_symbols.kind != .hoisted_function) {
                    try scope.members.put(entry.key, entry.value);
                }
            }
        }

        return i;
    }

    // Note: do not write to "p.log" in this function. Any errors due to conversion
    // from expression to binding should be written to "invalidLog" instead. That
    // way we can potentially keep this as an expression if it turns out it's not
    // needed as a binding after all.
    pub fn convertExprToBinding(p: *P, expr: ExprNodeIndex, invalid_loc: *LocList) ?Binding {
        switch (expr.data) {
            .e_missing => {
                return p.b(B.Missing{}, expr.loc);
            },
            .e_identifier => |ex| {
                return p.b(B.Identifier{ .ref = ex.ref }, expr.loc);
            },
            .e_array => |ex| {
                if (ex.comma_after_spread) |spread| {
                    invalid_loc.append(spread) catch unreachable;
                }

                if (ex.is_parenthesized) {
                    invalid_loc.append(p.source.rangeOfOperatorBefore(expr.loc, "(").loc) catch unreachable;
                }

                // p.markSyntaxFeature(Destructing)
                var items = List(js_ast.ArrayBinding).init(p.allocator);
                for (items.items) |item| {
                    var is_spread = true;
                    switch (item.default_value.?.data) {
                        .e_identifier => {},
                        else => {
                            // nested rest binding
                            // p.markSyntaxFeature(compat.NestedRestBinding, p.source.RangeOfOperatorAfter(item.Loc, "["))
                        },
                    }
                    var _expr = expr;
                    const res = p.convertExprToBindingAndInitializer(&_expr, invalid_loc, is_spread);
                    assert(res.binding != null);
                    items.append(js_ast.ArrayBinding{ .binding = res.binding orelse unreachable, .default_value = res.override_expr }) catch unreachable;
                }

                return p.b(B.Array{
                    .items = items.toOwnedSlice(),
                    .has_spread = ex.comma_after_spread != null,
                    .is_single_line = ex.is_single_line,
                }, expr.loc);
            },
            .e_object => |ex| {
                if (ex.comma_after_spread) |sp| {
                    invalid_loc.append(sp) catch unreachable;
                }

                if (ex.is_parenthesized) {
                    invalid_loc.append(p.source.rangeOfOperatorBefore(expr.loc, "(").loc) catch unreachable;
                }
                // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                var properties = List(B.Property).init(p.allocator);
                for (ex.properties) |item| {
                    if (item.flags.is_method or item.kind == .get or item.kind == .set) {
                        invalid_loc.append(item.key.?.loc) catch unreachable;
                        continue;
                    }
                    var value = &(item.value orelse unreachable);
                    const tup = p.convertExprToBindingAndInitializer(value, invalid_loc, false);
                    const initializer = tup.expr orelse item.initializer;

                    properties.append(B.Property{
                        .flags = Flags.Property{
                            .is_spread = item.kind == .spread,
                            .is_computed = item.flags.is_computed,
                        },

                        .key = item.key orelse std.debug.panic("Internal error: Expected {s} to have a key.", .{item}),
                        .value = tup.binding orelse std.debug.panic("Internal error: Expected {s} to have a binding.", .{tup}),
                        .default_value = initializer,
                    }) catch unreachable;
                }

                return p.b(B.Object{
                    .properties = properties.toOwnedSlice(),
                    .is_single_line = ex.is_single_line,
                }, expr.loc);
            },
            else => {
                invalid_loc.append(expr.loc) catch unreachable;
                return null;
            },
        }

        return null;
    }

    pub fn convertExprToBindingAndInitializer(p: *P, expr: *ExprNodeIndex, invalid_log: *LocList, is_spread: bool) ExprBindingTuple {
        var initializer: ?ExprNodeIndex = null;
        var override: ?ExprNodeIndex = null;
        // zig syntax is sometimes painful
        switch (expr.*.data) {
            .e_binary => |bin| {
                if (bin.op == .bin_assign) {
                    initializer = bin.right;
                    override = bin.left;
                }
            },
            else => {},
        }

        var bind = p.convertExprToBinding(expr.*, invalid_log);
        if (initializer) |initial| {
            const equalsRange = p.source.rangeOfOperatorBefore(initial.loc, "=");
            if (is_spread) {
                p.log.addRangeError(p.source, equalsRange, "A rest argument cannot have a default initializer") catch unreachable;
            } else {
                // p.markSyntaxFeature();
            }
        }

        return ExprBindingTuple{ .binding = bind, .expr = initializer };
    }

    pub fn forbidLexicalDecl(p: *P, loc: logger.Loc) !void {
        try p.log.addRangeError(p.source, p.lexer.range(), "Cannot use a declaration in a single-statement context");
    }

    pub fn logExprErrors(p: *P, errors: *DeferredErrors) void {
        if (errors.invalid_expr_default_value) |r| {
            p.log.addRangeError(
                p.source,
                r,
                "Unexpected \"=\"",
            ) catch unreachable;
        }

        if (errors.invalid_expr_after_question) |r| {
            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Unexpected {s}", .{p.source.contents[r.loc.i()..r.endI()]}) catch unreachable;
        }

        // if (errors.array_spread_feature) |err| {
        //     p.markSyntaxFeature(compat.ArraySpread, errors.arraySpreadFeature)
        // }
    }

    pub fn parseFnStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, asyncRange: ?logger.Range) !Stmt {
        const isGenerator = p.lexer.token == T.t_asterisk;
        const isAsync = asyncRange != null;

        //     if isGenerator {
        //     p.markSyntaxFeature(compat.Generator, p.lexer.Range())
        //     p.lexer.Next()
        // } else if isAsync {
        //     p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        // }

        switch (opts.lexical_decl) {
            .forbid => {
                try p.forbidLexicalDecl(loc);
            },

            // Allow certain function statements in certain single-statement contexts
            .allow_fn_inside_if, .allow_fn_inside_label => {
                if (opts.is_typescript_declare or isGenerator or isAsync) {
                    try p.forbidLexicalDecl(loc);
                }
            },
            else => {},
        }

        var name: ?js_ast.LocRef = null;
        var nameText: string = undefined;

        // The name is optional for "export default function() {}" pseudo-statements
        if (!opts.is_name_optional or p.lexer.token == T.t_identifier) {
            var nameLoc = p.lexer.loc();
            nameText = p.lexer.identifier;
            p.lexer.expect(T.t_identifier);
            name = js_ast.LocRef{
                .loc = nameLoc,
                .ref = null,
            };
        }

        // Even anonymous functions can have TypeScript type parameters
        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }

        // Introduce a fake block scope for function declarations inside if statements
        var ifStmtScopeIndex: usize = 0;
        var hasIfScope = opts.lexical_decl == .allow_fn_inside_if;
        if (hasIfScope) {
            ifStmtScopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.block, loc);
        }

        var scopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.function_args, p.lexer.loc());
        var func = p.parseFn(name, FnOrArrowDataParse{
            .async_range = asyncRange,
            .allow_await = isAsync,
            .allow_yield = isGenerator,
            .is_typescript_declare = opts.is_typescript_declare,

            // Only allow omitting the body if we're parsing TypeScript
            .allow_missing_body_for_type_script = p.options.ts,
        });

        // Don't output anything if it's just a forward declaration of a function
        if (opts.is_typescript_declare or func.body == null) {
            p.popAndDiscardScope(scopeIndex);
        }

        func.flags.is_export = opts.is_export;

        return p.s(S.Function{
            .func = func,
        }, func.open_parens_loc);
    }

    pub fn popAndDiscardScope(p: *P, scope_index: usize) void {
        // Move up to the parent scope
        var to_discard = p.current_scope;
        var parent = to_discard.parent orelse unreachable;

        p.current_scope = parent;

        // Truncate the scope order where we started to pretend we never saw this scope
        p.scopes_in_order.shrinkRetainingCapacity(scope_index);

        var children = parent.children;
        // Remove the last child from the parent scope
        var last = children.items.len - 1;
        if (children.items[last] != to_discard) {
            std.debug.panic("Internal error", .{});
        }

        _ = children.popOrNull();
    }

    pub fn parseFn(p: *P, name: ?js_ast.LocRef, opts: FnOrArrowDataParse) G.Fn {
        // if data.allowAwait and data.allowYield {
        // 	p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
        // }

        var func = G.Fn{
            .name = name,
            .flags = Flags.Function{
                .has_rest_arg = false,
                .is_async = opts.allow_await,
                .is_generator = opts.allow_yield,
            },

            .arguments_ref = null,
            .open_parens_loc = p.lexer.loc(),
        };
        p.lexer.expect(T.t_open_paren);

        // Await and yield are not allowed in function arguments
        var old_fn_or_arrow_data = opts;
        p.fn_or_arrow_data_parse.allow_await = false;
        p.fn_or_arrow_data_parse.allow_yield = false;

        // If "super()" is allowed in the body, it's allowed in the arguments
        p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;

        while (p.lexer.token != T.t_close_paren) {
            // Skip over "this" type annotations
            if (p.options.ts and p.lexer.token == T.t_this) {
                p.lexer.next();
                if (p.lexer.token == T.t_colon) {
                    p.lexer.next();
                    p.skipTypescriptType(js_ast.Op.Level.lowest);
                }
                if (p.lexer.token != T.t_comma) {
                    break;
                }

                p.lexer.next();
                continue;
            }
        }

        var ts_decorators: []ExprNodeIndex = undefined;
        if (opts.allow_ts_decorators) {
            ts_decorators = p.parseTypeScriptDecorators();
        }

        if (!func.flags.has_rest_arg and p.lexer.token == T.t_dot_dot_dot) {
            // p.markSyntaxFeature
            p.lexer.next();
            func.flags.has_rest_arg = true;
        }

        var is_typescript_ctor_field = false;
        var is_identifier = p.lexer.token == T.t_identifier;
        // TODO: parseFn
        // var arg = p.parseBinding();

        return func;
    }

    // pub fn parseBinding(p: *P)

    // TODO:
    pub fn parseTypeScriptDecorators(p: *P) []ExprNodeIndex {
        notimpl();
    }

    // TODO:
    pub fn skipTypescriptType(p: *P, level: js_ast.Op.Level) void {
        notimpl();
    }

    // TODO:
    pub fn skipTypescriptTypeParameters(p: *P) void {
        notimpl();
    }

    fn createDefaultName(p: *P, loc: logger.Loc) !js_ast.LocRef {
        var identifier = try std.fmt.allocPrint(p.allocator, "{s}_default", .{p.source.identifier_name});

        const name = js_ast.LocRef{ .loc = loc, .ref = try p.newSymbol(Symbol.Kind.other, identifier) };

        var scope = p.current_scope;

        try scope.generated.append(name.ref orelse unreachable);

        return name;
    }

    pub fn newSymbol(p: *P, kind: Symbol.Kind, identifier: string) !js_ast.Ref {
        var ref = js_ast.Ref{
            .source_index = @intCast(Ref.Int, p.source.index),
            .inner_index = @intCast(Ref.Int, p.symbols.items.len),
        };

        try p.symbols.append(Symbol{
            .kind = kind,
            .original_name = identifier,
            .link = null,
        });

        if (p.options.ts) {
            try p.ts_use_counts.append(0);
        }

        return ref;
    }

    pub fn parseLabelName(p: *P) !?js_ast.LocRef {
        if (p.lexer.token != .t_identifier or p.lexer.has_newline_before) {
            return null;
        }

        const name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(p.lexer.identifier) };
        p.lexer.next();
        return name;
    }

    pub fn parseClassStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) Stmt {
        var name: ?js_ast.LocRef = null;
        var class_keyword = p.lexer.range();
        if (p.lexer.token == .t_class) {
            //marksyntaxfeature
            p.lexer.next();
        } else {
            p.lexer.expected(.t_class);
        }

        var is_identifier = p.lexer.token == .t_identifier;
        var is_strict_modereserved_word = is_identifier and js_lexer.StrictModeReservedWords.has(p.lexer.identifier);

        if (!opts.is_name_optional or (is_identifier and !is_strict_modereserved_word)) {
            var name_loc = p.lexer.loc();
            var name_text = p.lexer.identifier;
            if (is_strict_modereserved_word) {
                p.lexer.unexpected();
            }

            p.lexer.expect(.t_identifier);
            name = LocRef{ .loc = name_loc, .ref = null };
            if (!opts.is_typescript_declare) {
                (name orelse unreachable).ref = p.declareSymbol(.class, name_loc, name_text) catch unreachable;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }
        var class_opts = ParseClassOptions{
            .allow_ts_decorators = true,
            .is_type_script_declare = opts.is_typescript_declare,
        };
        if (opts.ts_decorators) |dec| {
            class_opts.ts_decorators = dec.values;
        }

        var scope_index = p.pushScopeForParsePass(.class_name, loc) catch unreachable;
        var class = p.parseClass(class_keyword, name, class_opts);

        if (opts.is_typescript_declare) {
            p.popAndDiscardScope(scope_index);
            if (opts.is_namespace_scope and opts.is_export) {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return p.s(S.TypeScript{}, loc);
        }

        p.popScope();
        return p.s(S.Class{
            .class = class,
            .is_export = opts.is_export,
        }, loc);
    }

    pub fn parseStmt(p: *P, opts: *ParseStatementOptions) !Stmt {
        var loc = p.lexer.loc();

        switch (p.lexer.token) {
            js_lexer.T.t_semicolon => {
                p.lexer.next();
                return Stmt.empty();
            },

            js_lexer.T.t_export => {
                var previousExportKeyword = p.es6_export_keyword;
                if (opts.is_module_scope) {
                    p.es6_export_keyword = p.lexer.range();
                } else if (!opts.is_namespace_scope) {
                    p.lexer.unexpected();
                }
                p.lexer.next();

                // TypeScript decorators only work on class declarations
                // "@decorator export class Foo {}"
                // "@decorator export abstract class Foo {}"
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                // "@decorator export declare class Foo {}"
                // "@decorator export declare abstract class Foo {}"
                if (opts.ts_decorators != null and p.lexer.token != js_lexer.T.t_class and p.lexer.token != js_lexer.T.t_default and !p.lexer.isContextualKeyword("abstract") and !p.lexer.isContextualKeyword("declare")) {
                    p.lexer.expected(js_lexer.T.t_class);
                }

                switch (p.lexer.token) {
                    T.t_class, T.t_const, T.t_function, T.t_var => {
                        opts.is_export = true;
                        return p.parseStmt(opts);
                    },

                    T.t_import => {
                        // "export import foo = bar"
                        if (p.options.ts and (opts.is_module_scope or opts.is_namespace_scope)) {
                            opts.is_export = true;
                            return p.parseStmt(opts);
                        }

                        p.lexer.unexpected();
                    },

                    T.t_enum => {
                        if (!p.options.ts) {
                            p.lexer.unexpected();
                        }

                        opts.is_export = true;
                        return p.parseStmt(opts);
                    },

                    T.t_identifier => {
                        if (p.lexer.isContextualKeyword("let")) {
                            opts.is_export = true;
                            return p.parseStmt(opts);
                        }

                        if (opts.is_typescript_declare and p.lexer.isContextualKeyword("as")) {
                            // "export as namespace ns;"
                            p.lexer.next();
                            p.lexer.expectContextualKeyword("namespace");
                            p.lexer.expect(T.t_identifier);
                            p.lexer.expectOrInsertSemicolon();

                            return p.s(S.TypeScript{}, loc);
                        }

                        if (p.lexer.isContextualKeyword("async")) {
                            var asyncRange = p.lexer.range();
                            p.lexer.next();
                            if (p.lexer.has_newline_before) {
                                try p.log.addRangeError(p.source, asyncRange, "Unexpected newline after \"async\"");
                            }

                            p.lexer.expect(T.t_function);
                            opts.is_export = true;
                            return try p.parseFnStmt(loc, opts, asyncRange);
                        }

                        if (p.options.ts) {
                            notimpl();

                            // switch (p.lexer.identifier) {
                            //     "type" => {
                            //         // "export type foo = ..."
                            //         const typeRange = p.lexer.range();
                            //         if (p.lexer.has_newline_before) {
                            //             p.lexer.addError(p.source, typeRange.end(), "Unexpected newline after \"type\"");
                            //             return;
                            //         }

                            //     },
                            // }
                        }

                        p.lexer.unexpected();
                        lexerpanic();
                    },

                    T.t_default => {
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                            lexerpanic();
                        }

                        var defaultLoc = p.lexer.loc();
                        p.lexer.next();

                        // TypeScript decorators only work on class declarations
                        // "@decorator export default class Foo {}"
                        // "@decorator export default abstract class Foo {}"
                        if (opts.ts_decorators != null and p.lexer.token != T.t_class and !p.lexer.isContextualKeyword("abstract")) {
                            p.lexer.expected(T.t_class);
                        }

                        if (p.lexer.isContextualKeyword("async")) {
                            var async_range = p.lexer.range();
                            p.lexer.next();
                            var defaultName: js_ast.LocRef = undefined;
                            if (p.lexer.token == T.t_function and !p.lexer.has_newline_before) {
                                p.lexer.next();
                                var stmtOpts = ParseStatementOptions{
                                    .is_name_optional = true,
                                    .lexical_decl = .allow_all,
                                };
                                var stmt = try p.parseFnStmt(loc, &stmtOpts, async_range);
                                if (@as(Stmt.Tag, stmt.data) == .s_type_script) {
                                    // This was just a type annotation
                                    return stmt;
                                }

                                if (stmt.data.s_function.func.name) |name| {
                                    defaultName = js_ast.LocRef{ .loc = defaultLoc, .ref = name.ref };
                                } else {
                                    defaultName = try p.createDefaultName(defaultLoc);
                                }
                                // this is probably a panic
                                var value = js_ast.StmtOrExpr{ .stmt = stmt };
                                return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                            }

                            defaultName = try createDefaultName(p, loc);

                            var expr = p.parseSuffix(try p.parseAsyncPrefixExpr(async_range, Level.comma), Level.comma, null, Expr.EFlags.none);
                            p.lexer.expectOrInsertSemicolon();
                            // this is probably a panic
                            var value = js_ast.StmtOrExpr{ .expr = expr };
                            return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                        }

                        if (p.lexer.token == .t_function or p.lexer.token == .t_class or p.lexer.isContextualKeyword("interface")) {
                            var _opts = ParseStatementOptions{
                                .ts_decorators = opts.ts_decorators,
                                .is_name_optional = true,
                                .lexical_decl = .allow_all,
                            };
                            var stmt = p.parseStmt(&_opts) catch unreachable;

                            var default_name: js_ast.LocRef = undefined;

                            switch (stmt.data) {
                                // This was just a type annotation
                                .s_type_script => {
                                    return stmt;
                                },

                                .s_function => |func_container| {
                                    if (func_container.func.name) |name| {
                                        default_name = LocRef{ .loc = defaultLoc, .ref = name.ref };
                                    } else {}
                                },
                                .s_class => |class| {
                                    if (class.class.class_name) |name| {
                                        default_name = LocRef{ .loc = defaultLoc, .ref = name.ref };
                                    } else {}
                                },
                                else => {
                                    std.debug.panic("Internal error: unexpected stmt {s}", .{stmt});
                                },
                            }

                            return p.s(
                                S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } },
                                loc,
                            );
                        }

                        const is_identifier = p.lexer.token == .t_identifier;
                        const name = p.lexer.identifier;
                        var expr = p.parseExpr(.comma);

                        // Handle the default export of an abstract class in TypeScript
                        if (p.options.ts and is_identifier and (p.lexer.token == .t_class or opts.ts_decorators != null) and strings.eql(name, "abstract")) {
                            switch (expr.data) {
                                .e_identifier => |ident| {
                                    var stmtOpts = ParseStatementOptions{
                                        .ts_decorators = opts.ts_decorators,
                                        .is_name_optional = true,
                                    };
                                    const stmt: Stmt = p.parseClassStmt(loc, &stmtOpts);

                                    // Use the statement name if present, since it's a better name
                                    var default_name: LocRef = undefined;
                                    switch (stmt.data) {
                                        .s_class => |class| {
                                            var ref: Ref = undefined;
                                            var picked = false;
                                            if (class.class.class_name) |loc_ref| {
                                                if (loc_ref.ref) |_ref| {
                                                    ref = _ref;
                                                    picked = true;
                                                }
                                            }

                                            if (!picked) {
                                                ref = (createDefaultName(p, defaultLoc) catch unreachable).ref orelse unreachable;
                                            }
                                            default_name = LocRef{ .loc = defaultLoc, .ref = ref };
                                        },
                                        else => {
                                            default_name = createDefaultName(p, defaultLoc) catch unreachable;
                                        },
                                    }

                                    return p.s(S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } }, loc);
                                },
                                else => {
                                    std.debug.panic("internal error: unexpected", .{});
                                },
                            }
                        }

                        p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportDefault{ .default_name = createDefaultName(p, loc) catch unreachable, .value = js_ast.StmtOrExpr{ .expr = expr } }, loc);
                    },
                    T.t_asterisk => {
                        if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                        }

                        p.lexer.next();
                        var namespace_ref: js_ast.Ref = undefined;
                        var alias: ?js_ast.G.ExportStarAlias = null;
                        var path_loc: logger.Loc = undefined;
                        var path_text: string = undefined;

                        if (p.lexer.isContextualKeyword("as")) {
                            // "export * as ns from 'path'"
                            const name = p.lexer.identifier;
                            namespace_ref = p.storeNameInRef(name) catch unreachable;
                            alias = G.ExportStarAlias{ .loc = p.lexer.loc(), .original_name = name };
                            if (!p.lexer.isIdentifierOrKeyword()) {
                                p.lexer.expect(.t_identifier);
                            }
                            p.checkForNonBMPCodePoint((alias orelse unreachable).loc, name);
                            p.lexer.next();
                            p.lexer.expectContextualKeyword("from");
                            const parsedPath = p.parsePath();
                            path_loc = parsedPath.loc;
                            path_text = parsedPath.text;
                        } else {
                            // "export * from 'path'"
                            p.lexer.expectContextualKeyword("from");
                            const parsedPath = p.parsePath();
                            path_loc = parsedPath.loc;
                            path_text = parsedPath.text;
                            var path_name = fs.PathName.init(strings.append(p.allocator, path_text, "_star") catch unreachable);
                            namespace_ref = p.storeNameInRef(path_name.nonUniqueNameString(p.allocator) catch unreachable) catch unreachable;
                        }

                        var import_record_index = p.addImportRecord(ImportKind.stmt, path_loc, path_text);
                        p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportStar{
                            .namespace_ref = namespace_ref,
                            .alias = alias,
                            .import_record_index = import_record_index,
                        }, loc);
                    },
                    T.t_open_brace => {
                        if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                        }

                        const export_clause = try p.parseExportClause();
                        if (p.lexer.isContextualKeyword("from")) {
                            p.lexer.expectContextualKeyword("from");
                            const parsedPath = p.parsePath();
                            const import_record_index = p.addImportRecord(.stmt, parsedPath.loc, parsedPath.text);
                            var path_name = fs.PathName.init(strings.append(p.allocator, "import_", parsedPath.text) catch unreachable);
                            const namespace_ref = p.storeNameInRef(path_name.nonUniqueNameString(p.allocator) catch unreachable) catch unreachable;
                            p.lexer.expectOrInsertSemicolon();
                            return p.s(S.ExportFrom{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line, .namespace_ref = namespace_ref, .import_record_index = import_record_index }, loc);
                        }
                        p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportClause{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line }, loc);
                    },
                    T.t_equals => {
                        // "export = value;"

                        p.es6_export_keyword = previousExportKeyword; // This wasn't an ESM export statement after all
                        if (p.options.ts) {
                            p.lexer.next();
                            var value = p.parseExpr(.lowest);
                            p.lexer.expectOrInsertSemicolon();
                            return p.s(S.ExportEquals{ .value = value }, loc);
                        }
                        p.lexer.unexpected();
                        return Stmt.empty();
                    },
                    else => {
                        p.lexer.unexpected();
                        return Stmt.empty();
                    },
                }
            },

            .t_function => {
                p.lexer.next();
                return p.parseFnStmt(loc, opts, null);
            },
            .t_enum => {
                if (!p.options.ts) {
                    p.lexer.unexpected();
                }
                return p.parseTypescriptEnumStmt(loc, opts);
            },
            .t_at => {
                // Parse decorators before class statements, which are potentially exported
                if (p.options.ts) {
                    const scope_index = p.scopes_in_order.items.len;
                    const ts_decorators = p.parseTypeScriptDecorators();

                    // If this turns out to be a "declare class" statement, we need to undo the
                    // scopes that were potentially pushed while parsing the decorator arguments.
                    // That can look like any one of the following:
                    //
                    //   "@decorator declare class Foo {}"
                    //   "@decorator declare abstract class Foo {}"
                    //   "@decorator export declare class Foo {}"
                    //   "@decorator export declare abstract class Foo {}"
                    //
                    opts.ts_decorators = DeferredTsDecorators{
                        .values = ts_decorators,
                        .scope_index = scope_index,
                    };

                    // "@decorator class Foo {}"
                    // "@decorator abstract class Foo {}"
                    // "@decorator declare class Foo {}"
                    // "@decorator declare abstract class Foo {}"
                    // "@decorator export class Foo {}"
                    // "@decorator export abstract class Foo {}"
                    // "@decorator export declare class Foo {}"
                    // "@decorator export declare abstract class Foo {}"
                    // "@decorator export default class Foo {}"
                    // "@decorator export default abstract class Foo {}"
                    if (p.lexer.token != .t_class and p.lexer.token != .t_export and !p.lexer.isContextualKeyword("abstract") and !p.lexer.isContextualKeyword("declare")) {
                        p.lexer.expected(.t_class);
                    }

                    return p.parseStmt(opts);
                }
                notimpl();
            },
            .t_class => {
                if (opts.lexical_decl != .allow_all) {
                    try p.forbidLexicalDecl(loc);
                }

                return p.parseClassStmt(loc, opts);
            },
            .t_var => {
                p.lexer.next();
                const decls = p.parseAndDeclareDecls(.hoisted, opts);
                p.lexer.expectOrInsertSemicolon();
                return p.s(S.Local{ .kind = .k_var, .decls = decls, .is_export = opts.is_export }, loc);
            },
            .t_const => {
                if (opts.lexical_decl != .allow_all) {
                    try p.forbidLexicalDecl(loc);
                }
                // p.markSyntaxFeature(compat.Const, p.lexer.Range())

                p.lexer.next();

                if (p.options.ts and p.lexer.token == T.t_enum) {
                    return p.parseTypescriptEnumStmt(loc, opts);
                }

                const decls = p.parseAndDeclareDecls(.cconst, opts);
                p.lexer.expectOrInsertSemicolon();

                if (!opts.is_typescript_declare) {
                    try p.requireInitializers(decls);
                }

                return p.s(S.Local{ .kind = .k_const, .decls = decls, .is_export = opts.is_export }, loc);
            },
            .t_if => {
                p.lexer.next();
                p.lexer.expect(.t_open_paren);
                const test_ = p.parseExpr(.lowest);
                p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{
                    .lexical_decl = .allow_fn_inside_if,
                };
                const yes = p.parseStmt(&stmtOpts) catch unreachable;
                var no: ?Stmt = null;
                if (p.lexer.token == .t_else) {
                    p.lexer.next();
                    stmtOpts = ParseStatementOptions{
                        .lexical_decl = .allow_fn_inside_if,
                    };
                    no = p.parseStmt(&stmtOpts) catch unreachable;
                }

                return p.s(S.If{
                    .test_ = test_,
                    .yes = yes,
                    .no = no,
                }, loc);
            },
            .t_do => {
                p.lexer.next();
                var stmtOpts = ParseStatementOptions{};
                const body = p.parseStmt(&stmtOpts) catch unreachable;
                p.lexer.expect(.t_while);
                p.lexer.expect(.t_open_paren);
                const test_ = p.parseExpr(.lowest);
                p.lexer.expect(.t_close_paren);

                // This is a weird corner case where automatic semicolon insertion applies
                // even without a newline present
                if (p.lexer.token == .t_semicolon) {
                    p.lexer.next();
                }
                return p.s(S.DoWhile{ .body = body, .test_ = test_ }, loc);
            },
            .t_while => {
                p.lexer.next();

                p.lexer.expect(.t_open_paren);
                const test_ = p.parseExpr(.lowest);
                const body_loc = p.lexer.loc();
                p.lexer.expect(.t_close_paren);

                var stmtOpts = ParseStatementOptions{};

                // Push a scope so we make sure to prevent any bare identifiers referenced
                // within the body from being renamed. Renaming them might change the
                // semantics of the code.
                _ = try p.pushScopeForParsePass(.with, body_loc);
                const body = p.parseStmt(&stmtOpts) catch unreachable;
                p.popScope();

                return p.s(S.With{ .body = body, .value = test_, .body_loc = body_loc }, loc);
            },
            .t_with => {
                p.lexer.next();
                p.lexer.expect(.t_open_paren);
                const test_ = p.parseExpr(.lowest);
                const body_loc = p.lexer.loc();
                p.lexer.expect(.t_close_paren);
            },
            .t_switch => {
                p.lexer.next();

                p.lexer.expect(.t_open_paren);
                const test_ = p.parseExpr(.lowest);
                p.lexer.expect(.t_close_paren);

                const body_loc = p.lexer.loc();
                _ = try p.pushScopeForParsePass(.block, body_loc);
                defer p.popScope();

                p.lexer.expect(.t_open_brace);
                var cases = List(js_ast.Case).init(p.allocator);
                var foundDefault = false;
                var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                var value: ?js_ast.Expr = null;
                while (p.lexer.token != .t_close_brace) {
                    var body = List(js_ast.Stmt).init(p.allocator);
                    value = null;
                    if (p.lexer.token == .t_default) {
                        if (foundDefault) {
                            try p.log.addRangeError(p.source, p.lexer.range(), "Multiple default clauses are not allowed");
                            fail();
                        }

                        foundDefault = true;
                        p.lexer.next();
                        p.lexer.expect(.t_colon);
                    } else {
                        p.lexer.expect(.t_case);
                        value = p.parseExpr(.lowest);
                        p.lexer.expect(.t_colon);
                    }

                    caseBody: while (true) {
                        switch (p.lexer.token) {
                            .t_close_brace, .t_case, .t_default => {
                                break :caseBody;
                            },
                            else => {
                                stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                                try body.append(p.parseStmt(&stmtOpts) catch unreachable);
                            },
                        }
                    }
                    try cases.append(js_ast.Case{ .value = value, .body = body.toOwnedSlice(), .loc = logger.Loc.Empty });
                }
                p.lexer.expect(.t_close_brace);
                return p.s(S.Switch{ .test_ = test_, .body_loc = body_loc, .cases = cases.toOwnedSlice() }, loc);
            },
            .t_try => {
                p.lexer.next();
                const body_loc = p.lexer.loc();
                p.lexer.expect(.t_open_brace);
                _ = try p.pushScopeForParsePass(.block, loc);
                var stmtOpts = ParseStatementOptions{};
                const body = p.parseStmtsUpTo(.t_close_brace, &stmtOpts) catch unreachable;
                p.popScope();
                p.lexer.next();

                var catch_: ?js_ast.Catch = null;
                var finally: ?js_ast.Finally = null;

                if (p.lexer.token == .t_catch) {
                    const catch_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, catch_loc);
                    p.lexer.next();
                    var binding: ?js_ast.Binding = null;

                    // The catch binding is optional, and can be omitted
                    // jarred: TIL!
                    if (p.lexer.token != .t_open_brace) {
                        p.lexer.expect(.t_open_paren);
                        const value = p.parseBinding();

                        // Skip over types
                        if (p.options.ts and p.lexer.token == .t_colon) {
                            p.lexer.expect(.t_colon);
                            p.skipTypescriptType(.lowest);
                        }

                        p.lexer.expect(.t_close_paren);

                        // Bare identifiers are a special case
                        var kind = Symbol.Kind.other;
                        switch (value.data) {
                            .b_identifier => {
                                kind = .catch_identifier;
                            },
                            else => {},
                        }
                        stmtOpts = ParseStatementOptions{};
                        try p.declareBinding(kind, value, &stmtOpts);
                    }

                    p.lexer.expect(.t_open_brace);
                    stmtOpts = ParseStatementOptions{};
                    const stmts = p.parseStmtsUpTo(.t_close_brace, &stmtOpts) catch unreachable;
                    p.lexer.next();
                    catch_ = js_ast.Catch{
                        .loc = catch_loc,
                        .binding = binding,
                        .body = stmts,
                    };
                    p.popScope();
                }

                if (p.lexer.token == .t_finally or catch_ == null) {
                    const finally_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, finally_loc);
                    p.lexer.expect(.t_finally);
                    p.lexer.expect(.t_open_brace);
                    stmtOpts = ParseStatementOptions{};
                    const stmts = p.parseStmtsUpTo(.t_close_brace, &stmtOpts) catch unreachable;
                    p.lexer.next();
                    finally = js_ast.Finally{ .loc = finally_loc, .stmts = stmts };
                    p.popScope();
                }

                return p.s(
                    S.Try{ .body_loc = body_loc, .body = body, .catch_ = catch_, .finally = finally },
                    loc,
                );
            },
            .t_for => {
                _ = try p.pushScopeForParsePass(.block, loc);
                defer p.popScope();

                p.lexer.next();

                // "for await (let x of y) {}"
                var isForAwait = p.lexer.isContextualKeyword("await");
                if (isForAwait) {
                    const await_range = p.lexer.range();
                    if (!p.fn_or_arrow_data_parse.allow_await) {
                        try p.log.addRangeError(p.source, await_range, "Cannot use \"await\" outside an async function");
                        isForAwait = false;
                    } else {
                        // TODO: improve error handling here
                        //         		didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                        // if p.fnOrArrowDataParse.isTopLevel && !didGenerateError {
                        // 	p.topLevelAwaitKeyword = awaitRange
                        // 	p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                        // }
                    }
                    p.lexer.next();
                }

                p.lexer.expect(.t_open_paren);

                var init_: ?Stmt = null;
                var test_: ?Expr = null;
                var update: ?Expr = null;

                // "in" expressions aren't allowed here
                p.allow_in = false;

                var bad_let_range: ?logger.Range = null;
                if (p.lexer.isContextualKeyword("let")) {
                    bad_let_range = p.lexer.range();
                }

                var decls: []G.Decl = &([_]G.Decl{});
                var init_loc = p.lexer.loc();
                var is_var = false;
                switch (p.lexer.token) {
                    // for (var )
                    .t_var => {
                        is_var = true;
                        p.lexer.next();
                        var stmtOpts = ParseStatementOptions{};
                        decls = p.parseAndDeclareDecls(.hoisted, &stmtOpts);
                        init_ = p.s(S.Local{ .kind = .k_const, .decls = decls }, init_loc);
                    },
                    // for (const )
                    .t_const => {
                        p.lexer.next();
                        var stmtOpts = ParseStatementOptions{};
                        decls = p.parseAndDeclareDecls(.cconst, &stmtOpts);
                        init_ = p.s(S.Local{ .kind = .k_const, .decls = decls }, init_loc);
                    },
                    // for (;)
                    .t_semicolon => {},
                    else => {
                        var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };

                        const res = try p.parseExprOrLetStmt(&stmtOpts);
                        switch (res.stmt_or_expr) {
                            .stmt => |stmt| {
                                bad_let_range = null;
                                init_ = stmt;
                            },
                            .expr => |expr| {
                                init_ = p.s(S.SExpr{
                                    .value = expr,
                                }, init_loc);
                            },
                        }
                    },
                }

                // "in" expressions are allowed again
                p.allow_in = true;

                // Detect for-of loops
                if (p.lexer.isContextualKeyword("of") or isForAwait) {
                    if (bad_let_range) |r| {
                        try p.log.addRangeError(p.source, r, "\"let\" must be wrapped in parentheses to be used as an expression here");
                        fail();
                    }

                    if (isForAwait and !p.lexer.isContextualKeyword("of")) {
                        if (init_) |init_stmt| {
                            p.lexer.expectedString("\"of\"");
                        } else {
                            p.lexer.unexpected();
                        }
                    }

                    try p.forbidInitializers(decls, "of", false);
                    p.lexer.next();
                    const value = p.parseExpr(.comma);
                    p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{};
                    const body = p.parseStmt(&stmtOpts) catch unreachable;
                    return p.s(S.ForOf{ .is_await = isForAwait, .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                }

                // Detect for-in loops
                if (p.lexer.token == .t_in) {
                    try p.forbidInitializers(decls, "in", false);
                    p.lexer.next();
                    const value = p.parseExpr(.comma);
                    p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{};
                    const body = p.parseStmt(&stmtOpts) catch unreachable;
                    return p.s(S.ForIn{ .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                }

                // Only require "const" statement initializers when we know we're a normal for loop
                if (init_) |init_stmt| {
                    switch (init_stmt.data) {
                        .s_local => |local| {
                            if (local.kind == .k_const) {
                                try p.requireInitializers(decls);
                            }
                        },
                        else => {},
                    }
                }

                p.lexer.expect(.t_semicolon);
                if (p.lexer.token != .t_semicolon) {
                    test_ = p.parseExpr(.lowest);
                }

                p.lexer.expect(.t_semicolon);

                if (p.lexer.token != .t_close_paren) {
                    update = p.parseExpr(.lowest);
                }

                var stmtOpts = ParseStatementOptions{};
                const body = p.parseStmt(&stmtOpts) catch unreachable;
                return p.s(
                    S.For{ .init = init_, .test_ = test_, .update = update, .body = body },
                    loc,
                );
            },
            .t_import => {
                const previous_import_keyword = p.es6_import_keyword;
                p.es6_import_keyword = p.lexer.range();
                p.lexer.next();
                var stmt: S.Import = S.Import{
                    .namespace_ref = undefined,
                    .import_record_index = std.math.maxInt(u32),
                };
                var was_originally_bare_import = false;

                // "export import foo = bar"
                if ((opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) and p.lexer.token != .t_identifier) {
                    p.lexer.expected(.t_identifier);
                }

                switch (p.lexer.token) {
                    // "import('path')"
                    // "import.meta"
                    .t_open_paren, .t_dot => {
                        p.es6_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                        const expr = p.parseSuffix(p.parseImportExpr(loc, .lowest), .lowest, null, Expr.EFlags.none);
                        p.lexer.expectOrInsertSemicolon();
                        return p.s(S.SExpr{
                            .value = expr,
                        }, loc);
                    },
                    .t_string_literal, .t_no_substitution_template_literal => {
                        // "import 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                            fail();
                        }
                        was_originally_bare_import = true;
                    },
                    .t_asterisk => {
                        // "import * as ns from 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                            fail();
                        }

                        p.lexer.next();
                        p.lexer.expectContextualKeyword("as");
                        stmt = S.Import{
                            .namespace_ref = try p.storeNameInRef(p.lexer.identifier),
                            .star_name_loc = p.lexer.loc(),
                            .import_record_index = std.math.maxInt(u32),
                        };
                        p.lexer.expect(.t_identifier);
                        p.lexer.expectContextualKeyword("from");
                    },
                    .t_open_brace => {
                        // "import * as ns from 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            p.lexer.unexpected();
                            fail();
                        }
                        var importClause = try p.parseImportClause();
                        stmt = S.Import{ .namespace_ref = undefined, .import_record_index = std.math.maxInt(u32), .items = importClause.items, .is_single_line = importClause.is_single_line };
                        p.lexer.expectContextualKeyword("from");
                    },
                    .t_identifier => {
                        // "import defaultItem from 'path'"
                        // "import foo = bar"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope)) {
                            p.lexer.unexpected();
                            fail();
                        }

                        const default_name = p.lexer.identifier;
                        stmt = S.Import{ .namespace_ref = undefined, .import_record_index = std.math.maxInt(u32), .default_name = LocRef{
                            .loc = p.lexer.loc(),
                            .ref = try p.storeNameInRef(default_name),
                        } };
                        p.lexer.next();

                        if (p.options.ts) {
                            // Skip over type-only imports
                            if (strings.eql(default_name, "type")) {
                                switch (p.lexer.token) {
                                    .t_identifier => {
                                        if (!strings.eql(p.lexer.identifier, "from")) {
                                            // "import type foo from 'bar';"
                                            p.lexer.next();
                                            p.lexer.expectContextualKeyword("from");
                                            _ = p.parsePath();
                                            p.lexer.expectOrInsertSemicolon();
                                            return p.s(S.TypeScript{}, loc);
                                        }
                                    },
                                    .t_asterisk => {
                                        // "import type * as foo from 'bar';"
                                        p.lexer.next();
                                        p.lexer.expectContextualKeyword("as");
                                        p.lexer.expect(.t_identifier);
                                        p.lexer.expectContextualKeyword("from");
                                        _ = p.parsePath();
                                        p.lexer.expectOrInsertSemicolon();
                                        return p.s(S.TypeScript{}, loc);
                                    },

                                    .t_open_brace => {
                                        // "import type {foo} from 'bar';"
                                        _ = try p.parseImportClause();
                                        p.lexer.expectContextualKeyword("from");
                                        _ = p.parsePath();
                                        p.lexer.expectOrInsertSemicolon();
                                        return p.s(S.TypeScript{}, loc);
                                    },
                                    else => {},
                                }
                            }

                            // Parse TypeScript import assignment statements
                            p.es6_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                            return p.parseTypeScriptImportEqualsStmt(loc, opts, logger.Loc.Empty, default_name);
                        }

                        if (p.lexer.token == .t_comma) {
                            p.lexer.next();

                            switch (p.lexer.token) {
                                // "import defaultItem, * as ns from 'path'"
                                .t_asterisk => {
                                    p.lexer.next();
                                    p.lexer.expectContextualKeyword("as");
                                    stmt.namespace_ref = try p.storeNameInRef(p.lexer.identifier);
                                    stmt.star_name_loc = p.lexer.loc();
                                    p.lexer.expect(.t_identifier);
                                },
                                // "import defaultItem, {item1, item2} from 'path'"
                                .t_open_brace => {
                                    const importClause = try p.parseImportClause();
                                    stmt.items = importClause.items;
                                    stmt.is_single_line = importClause.is_single_line;
                                },
                                else => {
                                    p.lexer.unexpected();
                                },
                            }

                            p.lexer.expectContextualKeyword("from");
                        }
                    },
                    else => {
                        p.lexer.unexpected();
                        fail();
                    },
                }

                const path = p.parsePath();
                stmt.import_record_index = p.addImportRecord(.stmt, path.loc, path.text);
                p.import_records.items[stmt.import_record_index].was_originally_bare_import = was_originally_bare_import;
                p.lexer.expectOrInsertSemicolon();

                if (stmt.star_name_loc) |star| {
                    stmt.namespace_ref = try p.declareSymbol(.import, star, p.loadNameFromRef(stmt.namespace_ref));
                } else {
                    var path_name = fs.PathName.init(strings.append(p.allocator, "import_", path.text) catch unreachable);
                    const name = try path_name.nonUniqueNameString(p.allocator);
                    stmt.namespace_ref = try p.newSymbol(.other, name);
                    var scope: *Scope = p.current_scope;
                    try scope.generated.append(stmt.namespace_ref);
                }

                var item_refs = std.StringHashMap(LocRef).init(p.allocator);

                // Link the default item to the namespace
                if (stmt.default_name) |*name_loc| {
                    const name = p.loadNameFromRef(name_loc.ref orelse unreachable);
                    const ref = try p.declareSymbol(.import, name_loc.loc, name);
                    try p.is_import_item.put(ref, true);
                    name_loc.ref = ref;
                }

                if (stmt.items.len > 0) {
                    try item_refs.ensureCapacity(@intCast(u32, stmt.items.len));
                    for (stmt.items) |*item| {
                        const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                        const ref = try p.declareSymbol(.import, item.name.loc, name);
                        p.checkForNonBMPCodePoint(item.alias_loc, item.alias);
                        try p.is_import_item.put(ref, true);
                        item.name.ref = ref;
                        item_refs.putAssumeCapacity(item.alias, LocRef{ .loc = item.name.loc, .ref = ref });
                    }
                }

                // Track the items for this namespace
                try p.import_items_for_namespace.put(stmt.namespace_ref, item_refs);
                return p.s(stmt, loc);
            },
            .t_break => {
                p.lexer.next();
                const name = try p.parseLabelName();
                p.lexer.expectOrInsertSemicolon();
                return p.s(S.Break{ .label = name }, loc);
            },
            .t_continue => {
                p.lexer.next();
                const name = try p.parseLabelName();
                p.lexer.expectOrInsertSemicolon();
                return p.s(S.Continue{ .label = name }, loc);
            },
            .t_return => {
                p.lexer.next();
                var value: ?Expr = null;
                if ((p.lexer.token != .t_semicolon and
                    !p.lexer.has_newline_before and
                    p.lexer.token != .t_close_brace and
                    p.lexer.token != .t_end_of_file))
                {
                    value = p.parseExpr(.lowest);
                }
                p.latest_return_had_semicolon = p.lexer.token == .t_semicolon;
                p.lexer.expectOrInsertSemicolon();

                return p.s(S.Return{ .value = value }, loc);
            },
            .t_throw => {
                p.lexer.next();
                if (p.lexer.has_newline_before) {
                    try p.log.addError(p.source, logger.Loc{
                        .start = loc.start + 5,
                    }, "Unexpected newline after \"throw\"");
                    fail();
                }
                const expr = p.parseExpr(.lowest);
                p.lexer.expectOrInsertSemicolon();
                return p.s(S.Throw{ .value = expr }, loc);
            },
            .t_debugger => {
                p.lexer.next();
                p.lexer.expectOrInsertSemicolon();
                return p.s(S.Debugger{}, loc);
            },
            .t_open_brace => {
                _ = try p.pushScopeForParsePass(.block, loc);
                defer p.popScope();
                p.lexer.next();
                var stmtOpts = ParseStatementOptions{};
                const stmts = p.parseStmtsUpTo(.t_close_brace, &stmtOpts) catch unreachable;
                p.lexer.next();
                return p.s(S.Block{
                    .stmts = stmts,
                }, loc);
            },

            else => {
                const is_identifier = p.lexer.token == .t_identifier;
                const name = p.lexer.identifier;
                var emiss = E.Missing{};
                // Parse either an async function, an async expression, or a normal expression
                var expr: Expr = Expr{ .loc = loc, .data = Expr.Data{ .e_missing = &emiss } };
                if (is_identifier and strings.eql(p.lexer.raw(), "async")) {
                    var async_range = p.lexer.range();
                    p.lexer.next();
                    if (p.lexer.token == .t_function and !p.lexer.has_newline_before) {
                        p.lexer.next();
                        return try p.parseFnStmt(async_range.loc, opts, async_range);
                    }

                    expr = p.parseSuffix(try p.parseAsyncPrefixExpr(async_range, .lowest), .lowest, null, Expr.EFlags.none);
                } else {
                    const exprOrLet = try p.parseExprOrLetStmt(opts);
                    switch (exprOrLet.stmt_or_expr) {
                        .stmt => |stmt| {
                            p.lexer.expectOrInsertSemicolon();
                            return stmt;
                        },
                        else => {},
                    }
                }

                if (is_identifier) {
                    switch (expr.data) {
                        .e_identifier => |ident| {
                            if (p.lexer.token == .t_colon and opts.ts_decorators == null) {
                                _ = try p.pushScopeForParsePass(.label, loc);
                                defer p.popScope();

                                // Parse a labeled statement
                                p.lexer.next();

                                const _name = LocRef{ .loc = expr.loc, .ref = ident.ref };
                                var nestedOpts = ParseStatementOptions{};

                                switch (opts.lexical_decl) {
                                    .allow_all, .allow_fn_inside_label => {
                                        nestedOpts.lexical_decl = .allow_fn_inside_label;
                                    },
                                    else => {},
                                }
                                var stmt = p.parseStmt(&nestedOpts) catch unreachable;
                                return p.s(S.Label{ .name = _name, .stmt = stmt }, loc);
                            }
                        },
                        else => {},
                    }

                    if (p.options.ts) {
                        if (js_lexer.TypescriptStmtKeyword.List.get(name)) |ts_stmt| {
                            switch (ts_stmt) {
                                .ts_stmt_type => {
                                    if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
                                        // "type Foo = any"
                                        var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };
                                        p.skipTypescriptTypeStmt(&stmtOpts);
                                        return p.s(S.TypeScript{}, loc);
                                    }
                                },
                                .ts_stmt_namespace, .ts_stmt_module => {
                                    // "namespace Foo {}"
                                    // "module Foo {}"
                                    // "declare module 'fs' {}"
                                    // "declare module 'fs';"
                                    if (((opts.is_module_scope or opts.is_namespace_scope) and (p.lexer.token == .t_identifier or
                                        (p.lexer.token == .t_string_literal and opts.is_typescript_declare))))
                                    {
                                        return p.parseTypescriptNamespaceTmt(loc, opts);
                                    }
                                },
                                .ts_stmt_interface => {
                                    // "interface Foo {}"
                                    var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };

                                    p.skipTypeScriptInterfaceStmt(&stmtOpts);
                                    return p.s(S.TypeScript{}, loc);
                                },
                                .ts_stmt_abstract => {
                                    if (p.lexer.token == .t_class or opts.ts_decorators != null) {
                                        return p.parseClassStmt(loc, opts);
                                    }
                                },
                                .ts_stmt_global => {
                                    // "declare module 'fs' { global { namespace NodeJS {} } }"
                                    if (opts.is_namespace_scope and opts.is_typescript_declare and p.lexer.token == .t_open_brace) {
                                        p.lexer.next();
                                        _ = p.parseStmtsUpTo(.t_close_brace, opts) catch unreachable;
                                        p.lexer.next();
                                        return p.s(S.TypeScript{}, loc);
                                    }
                                },
                                .ts_stmt_declare => {
                                    opts.lexical_decl = .allow_all;
                                    opts.is_typescript_declare = true;

                                    // "@decorator declare class Foo {}"
                                    // "@decorator declare abstract class Foo {}"
                                    if (opts.ts_decorators != null and p.lexer.token != .t_class and !p.lexer.isContextualKeyword("abstract")) {
                                        p.lexer.expected(.t_class);
                                    }

                                    // "declare global { ... }"
                                    if (p.lexer.isContextualKeyword("global")) {
                                        p.lexer.next();
                                        p.lexer.expect(.t_open_brace);
                                        _ = p.parseStmtsUpTo(.t_close_brace, opts) catch unreachable;
                                        p.lexer.next();
                                        return p.s(S.TypeScript{}, loc);
                                    }

                                    // "declare const x: any"
                                    const stmt = p.parseStmt(opts) catch unreachable;
                                    if (opts.ts_decorators) |decs| {
                                        p.discardScopesUpTo(decs.scope_index);
                                    }

                                    // Unlike almost all uses of "declare", statements that use
                                    // "export declare" with "var/let/const" inside a namespace affect
                                    // code generation. They cause any declared bindings to be
                                    // considered exports of the namespace. Identifier references to
                                    // those names must be converted into property accesses off the
                                    // namespace object:
                                    //
                                    //   namespace ns {
                                    //     export declare const x
                                    //     export function y() { return x }
                                    //   }
                                    //
                                    //   (ns as any).x = 1
                                    //   console.log(ns.y())
                                    //
                                    // In this example, "return x" must be replaced with "return ns.x".
                                    // This is handled by replacing each "export declare" statement
                                    // inside a namespace with an "export var" statement containing all
                                    // of the declared bindings. That "export var" statement will later
                                    // cause identifiers to be transformed into property accesses.
                                    if (opts.is_namespace_scope and opts.is_export) {
                                        var decls: []G.Decl = &([_]G.Decl{});
                                        switch (stmt.data) {
                                            .s_local => |local| {
                                                var _decls = try List(G.Decl).initCapacity(p.allocator, local.decls.len);
                                                for (local.decls) |decl| {
                                                    try extractDeclsForBinding(decl.binding, &_decls);
                                                }
                                                decls = _decls.toOwnedSlice();
                                            },
                                            else => {},
                                        }

                                        if (decls.len > 0) {
                                            return p.s(S.Local{
                                                .kind = .k_var,
                                                .is_export = true,
                                                .decls = decls,
                                            }, loc);
                                        }
                                    }

                                    return p.s(S.TypeScript{}, loc);
                                },
                            }
                        }
                    }
                }

                p.lexer.expectOrInsertSemicolon();
                return p.s(S.SExpr{ .value = expr }, loc);
            },
        }

        return js_ast.Stmt.empty();
    }

    pub fn discardScopesUpTo(p: *P, scope_index: usize) void {
        // Remove any direct children from their parent
        var scope = p.current_scope;
        var children = scope.children;
        for (p.scopes_in_order.items[scope_index..]) |child| {
            if (child.scope.parent == p.current_scope) {
                var i: usize = children.items.len - 1;
                while (i >= 0) {
                    if (children.items[i] == child.scope) {
                        _ = children.orderedRemove(i);
                        break;
                    }
                    i -= 1;
                }
            }
        }

        // Truncate the scope order where we started to pretend we never saw this scope
        p.scopes_in_order.shrinkAndFree(scope_index);
    }

    pub fn skipTypescriptTypeStmt(p: *P, opts: *ParseStatementOptions) void {
        notimpl();
    }

    pub fn parseTypescriptNamespaceTmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) Stmt {
        notimpl();
    }

    pub fn skipTypeScriptInterfaceStmt(p: *P, opts: *ParseStatementOptions) void {
        notimpl();
    }

    pub fn parseTypeScriptImportEqualsStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, default_name_loc: logger.Loc, default_name: string) Stmt {
        notimpl();
    }

    pub fn parseClauseAlias(p: *P, kind: string) !string {
        const loc = p.lexer.loc();

        // The alias may now be a string (see https://github.com/tc39/ecma262/pull/2154)
        if (p.lexer.token == .t_string_literal) {
            if (p.lexer.utf16ToStringWithValidation(p.lexer.string_literal)) |alias| {
                return alias;
            } else |err| {
                const r = p.source.rangeOfString(loc);
                // TODO: improve error message
                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Invalid {s} alias because it contains an unpaired Unicode surrogate (like emoji)", .{kind});
                return p.source.textForRange(r);
            }
        }

        // The alias may be a keyword
        if (!p.lexer.isIdentifierOrKeyword()) {
            p.lexer.expect(.t_identifier);
        }

        const alias = p.lexer.identifier;
        p.checkForNonBMPCodePoint(loc, alias);
        return alias;
    }

    pub fn parseImportClause(
        p: *P,
    ) !ImportClause {
        var items = List(js_ast.ClauseItem).init(p.allocator);
        p.lexer.expect(.t_open_brace);
        var is_single_line = !p.lexer.has_newline_before;

        while (p.lexer.token != .t_close_brace) {
            // The alias may be a keyword;
            const isIdentifier = p.lexer.token == .t_identifier;
            const alias_loc = p.lexer.loc();
            const alias = try p.parseClauseAlias("import");
            var name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(alias) };
            var original_name = alias;
            p.lexer.next();

            if (p.lexer.isContextualKeyword("as")) {
                p.lexer.next();
                original_name = p.lexer.identifier;
                name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(alias) };
                p.lexer.expect(.t_identifier);
            } else if (!isIdentifier) {
                // An import where the name is a keyword must have an alias
                p.lexer.expectedString("\"as\"");
            }

            // Reject forbidden names
            if (isEvalOrArguments(original_name)) {
                const r = js_lexer.rangeOfIdentifier(&p.source, name.loc);
                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use \"{s}\" as an identifier here", .{original_name});
            }

            try items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            });

            if (p.lexer.token != .t_comma) {
                break;
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }

            p.lexer.next();

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }

        p.lexer.expect(.t_close_brace);
        return ImportClause{ .items = items.toOwnedSlice(), .is_single_line = is_single_line };
    }

    pub fn forbidInitializers(p: *P, decls: []G.Decl, loop_type: string, is_var: bool) !void {
        if (decls.len > 1) {
            try p.log.addErrorFmt(p.source, decls[0].binding.loc, p.allocator, "for-{s} loops must have a single declaration", .{loop_type});
        } else if (decls.len == 1) {
            if (decls[0].value) |value| {
                if (is_var) {

                    // This is a weird special case. Initializers are allowed in "var"
                    // statements with identifier bindings.
                    return;
                }

                try p.log.addErrorFmt(p.source, value.loc, p.allocator, "for-{s} loop variables cannot have an initializer", .{loop_type});
            }
        }
    }

    pub fn parseExprOrLetStmt(p: *P, opts: *ParseStatementOptions) !ExprOrLetStmt {
        var let_range = p.lexer.range();
        var raw = p.lexer.raw();

        if (p.lexer.token != .t_identifier or !strings.eql(raw, "let")) {
            return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = p.parseExpr(.lowest) } };
        }

        p.lexer.next();

        switch (p.lexer.token) {
            .t_identifier, .t_open_bracket, .t_open_brace => {
                if (opts.lexical_decl == .allow_all or !p.lexer.has_newline_before or p.lexer.token == .t_open_bracket) {
                    if (opts.lexical_decl != .allow_all) {
                        try p.forbidLexicalDecl(let_range.loc);
                    }

                    const decls = p.parseAndDeclareDecls(.other, opts);
                    return ExprOrLetStmt{
                        .stmt_or_expr = js_ast.StmtOrExpr{
                            .stmt = p.s(S.Local{
                                .kind = .k_let,
                                .decls = decls,
                                .is_export = opts.is_export,
                            }, let_range.loc),
                        },
                        .decls = decls,
                    };
                }
            },
            else => {},
        }

        const ref = p.storeNameInRef(raw) catch unreachable;
        const expr = p.e(E.Identifier{ .ref = ref }, let_range.loc);
        return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = p.parseExpr(.lowest) } };
    }

    pub fn requireInitializers(p: *P, decls: []G.Decl) !void {
        for (decls) |decl| {
            if (decl.value) |val| {
                switch (decl.binding.data) {
                    .b_identifier => |ident| {
                        const r = js_lexer.rangeOfIdentifier(&p.source, decl.binding.loc);
                        try p.log.addRangeErrorFmt(p.source, r, p.allocator, "The constant \"{s}\" must be initialized", .{p.symbols.items[ident.ref.inner_index].original_name});
                        return;
                    },
                    else => {},
                }
            }

            try p.log.addError(p.source, decl.binding.loc, "This constant must be initialized");
        }
    }

    pub fn parseBinding(p: *P) Binding {
        var loc = p.lexer.loc();

        switch (p.lexer.token) {
            .t_identifier => {
                const name = p.lexer.identifier;
                if ((p.fn_or_arrow_data_parse.allow_await and strings.eql(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield and strings.eql(name, "yield"))) {
                    // TODO: add fmt to addRangeError
                    p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"yield\" or \"await\" here.") catch unreachable;
                }

                const ref = p.storeNameInRef(name) catch unreachable;
                p.lexer.next();
                return p.b(B.Identifier{ .ref = ref }, loc);
            },
            .t_open_bracket => {
                p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var items = List(js_ast.ArrayBinding).init(p.allocator);
                var has_spread = false;

                // "in" expressions are allowed
                var old_allow_in = p.allow_in;
                p.allow_in = true;
                while (p.lexer.token != .t_close_bracket) {
                    if (p.lexer.token == .t_comma) {
                        items.append(js_ast.ArrayBinding{
                            .binding = p.b(
                                B.Missing{},
                                p.lexer.loc(),
                            ),
                        }) catch unreachable;
                    } else {
                        if (p.lexer.token == .t_dot_dot_dot) {
                            p.lexer.next();
                            has_spread = true;

                            // This was a bug in the ES2015 spec that was fixed in ES2016
                            if (p.lexer.token != .t_identifier) {
                                // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())

                            }
                        }

                        const binding = p.parseBinding();

                        var default_value: ?Expr = null;
                        if (!has_spread and p.lexer.token == .t_equals) {
                            p.lexer.next();
                            default_value = p.parseExpr(.comma);
                        }

                        items.append(js_ast.ArrayBinding{ .binding = binding, .default_value = default_value }) catch unreachable;

                        // Commas after spread elements are not allowed
                        if (has_spread and p.lexer.token == .t_comma) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                            fail();
                        }
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }
                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                p.lexer.expect(.t_close_bracket);
                return p.b(B.Array{
                    .items = items.toOwnedSlice(),
                    .has_spread = has_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_open_brace => {
                // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                p.lexer.next();
                var is_single_line = false;
                var properties = List(js_ast.B.Property).init(p.allocator);

                // "in" expressions are allowed
                var old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_brace) {
                    var property = p.parsePropertyBinding();
                    properties.append(property) catch unreachable;

                    // Commas after spread elements are not allowed
                    if (property.flags.is_spread and p.lexer.token == .t_comma) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                        fail();
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    p.lexer.next();
                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                p.lexer.expect(.t_close_brace);

                return p.b(B.Object{
                    .properties = properties.toOwnedSlice(),
                    .is_single_line = is_single_line,
                }, loc);
            },
            else => {},
        }

        p.lexer.expect(.t_identifier);
        return p.b(B.Missing{}, loc);
    }

    pub fn parsePropertyBinding(p: *P) B.Property {
        var key: js_ast.Expr = undefined;
        var is_computed = false;

        switch (p.lexer.token) {
            .t_dot_dot_dot => {
                p.lexer.next();
                const value = p.b(B.Identifier{
                    .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable,
                }, p.lexer.loc());
                p.lexer.expect(.t_identifier);
                return B.Property{
                    // This "key" diverges from esbuild, but is due to Go always having a zero value.
                    .key = p.e(E.Missing{}, logger.Loc.Empty),

                    .flags = Flags.Property{ .is_spread = true },
                    .value = value,
                };
            },
            .t_numeric_literal => {
                key = p.e(E.Number{
                    .value = p.lexer.number,
                }, p.lexer.loc());
                // check for legacy octal literal
                p.lexer.next();
            },
            .t_string_literal => {
                key = p.parseStringLiteral();
            },
            .t_big_integer_literal => {
                key = p.e(E.BigInt{
                    .value = p.lexer.identifier,
                }, p.lexer.loc());
                // p.markSyntaxFeature(compat.BigInt, p.lexer.Range())
                p.lexer.next();
            },
            .t_open_bracket => {
                is_computed = true;
                p.lexer.next();
                key = p.parseExpr(.comma);
                p.lexer.expect(.t_close_bracket);
            },
            else => {
                const name = p.lexer.identifier;
                const loc = p.lexer.loc();

                if (!p.lexer.isIdentifierOrKeyword()) {
                    p.lexer.expect(.t_identifier);
                }

                p.lexer.next();

                key = p.e(E.String{
                    .value = p.lexer.stringToUTF16(name),
                }, loc);

                if (p.lexer.token != .t_colon and p.lexer.token != .t_open_paren) {
                    const ref = p.storeNameInRef(name) catch unreachable;
                    const value = p.b(B.Identifier{ .ref = ref }, loc);
                    var default_value: ?Expr = null;
                    if (p.lexer.token == .t_equals) {
                        p.lexer.next();
                        default_value = p.parseExpr(.comma);
                    }

                    return B.Property{
                        .key = key,
                        .value = value,
                        .default_value = default_value,
                    };
                }
            },
        }

        p.lexer.expect(.t_colon);
        const value = p.parseBinding();

        var default_value: ?Expr = null;
        if (p.lexer.token == .t_equals) {
            p.lexer.next();
            default_value = p.parseExpr(.comma);
        }

        return B.Property{
            .flags = Flags.Property{
                .is_computed = is_computed,
            },
            .key = key,
            .value = value,
            .default_value = default_value,
        };
    }

    pub fn parseAndDeclareDecls(p: *P, kind: Symbol.Kind, opts: *ParseStatementOptions) []G.Decl {
        var decls = List(G.Decl).initCapacity(p.allocator, 1) catch unreachable;

        while (true) {
            // Forbid "let let" and "const let" but not "var let"
            if ((kind == .other or kind == .cconst) and p.lexer.isContextualKeyword("let")) {
                p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"let\" as an identifier here") catch unreachable;
            }

            var value: ?js_ast.Expr = null;
            var local = p.parseBinding();
            p.declareBinding(kind, local, opts) catch unreachable;

            // Skip over types
            if (p.options.ts) {
                // "let foo!"
                var is_definite_assignment_assertion = p.lexer.token == .t_exclamation;
                if (is_definite_assignment_assertion) {
                    p.lexer.next();
                }

                // "let foo: number"
                if (is_definite_assignment_assertion or p.lexer.token == .t_colon) {
                    p.lexer.expect(.t_colon);
                    p.skipTypescriptType(.lowest);
                }
            }

            if (p.lexer.token == .t_equals) {
                p.lexer.next();
                value = p.parseExpr(.comma);
            }

            decls.append(G.Decl{
                .binding = local,
                .value = value,
            }) catch unreachable;

            if (p.lexer.token != .t_comma) {
                break;
            }
            p.lexer.next();
        }

        return decls.toOwnedSlice();
    }

    pub fn parseTypescriptEnumStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) Stmt {
        notimpl();
        // return Stmt.empty();
    }

    pub fn parseExportClause(p: *P) !ExportClauseResult {
        var items = List(js_ast.ClauseItem).initCapacity(p.allocator, 1) catch unreachable;
        var first_keyword_item_loc = logger.Loc{};
        p.lexer.expect(.t_open_brace);
        var is_single_line = !p.lexer.has_newline_before;

        while (p.lexer.token != .t_close_brace) {
            var alias = try p.parseClauseAlias("export");
            var alias_loc = p.lexer.loc();

            var name = LocRef{
                .loc = alias_loc,
                .ref = p.storeNameInRef(alias) catch unreachable,
            };
            var original_name = alias;

            // The name can actually be a keyword if we're really an "export from"
            // statement. However, we won't know until later. Allow keywords as
            // identifiers for now and throw an error later if there's no "from".
            //
            //   // This is fine
            //   export { default } from 'path'
            //
            //   // This is a syntax error
            //   export { default }
            //
            if (p.lexer.token != .t_identifier) {
                if (!p.lexer.isIdentifierOrKeyword()) {
                    p.lexer.expect(.t_identifier);
                }
                if (first_keyword_item_loc.start == 0) {
                    first_keyword_item_loc = p.lexer.loc();
                }
            }

            p.checkForNonBMPCodePoint(alias_loc, alias);
            p.lexer.next();

            if (p.lexer.isContextualKeyword("as")) {
                p.lexer.next();
                alias = try p.parseClauseAlias("export");
                alias_loc = p.lexer.loc();

                p.lexer.next();
            }

            items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            }) catch unreachable;

            // we're done if there's no comma
            if (p.lexer.token != .t_comma) {
                break;
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
            p.lexer.next();
            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }
        p.lexer.expect(.t_close_brace);

        // Throw an error here if we found a keyword earlier and this isn't an
        // "export from" statement after all
        if (first_keyword_item_loc.start != 0 and !p.lexer.isContextualKeyword("from")) {
            const r = js_lexer.rangeOfIdentifier(&p.source, first_keyword_item_loc);
            p.lexer.addRangeError(r, "Expected identifier but found \"{s}\"", .{p.source.textForRange(r)}, true);
        }

        return ExportClauseResult{
            .clauses = items.toOwnedSlice(),
            .is_single_line = is_single_line,
        };
    }

    pub fn parsePath(p: *P) ParsedPath {
        var path = ParsedPath{
            .loc = p.lexer.loc(),
            .text = p.lexer.utf16ToString(p.lexer.string_literal),
        };

        if (p.lexer.token == .t_no_substitution_template_literal) {
            p.lexer.next();
        } else {
            p.lexer.expect(.t_string_literal);
        }

        return path;
    }

    // TODO:
    pub fn checkForNonBMPCodePoint(p: *P, loc: logger.Loc, name: string) void {}

    pub fn parseStmtsUpTo(p: *P, eend: js_lexer.T, opts: *ParseStatementOptions) ![]Stmt {
        var stmts = try StmtList.initCapacity(p.allocator, 1);

        var returnWithoutSemicolonStart: i32 = -1;
        opts.lexical_decl = .allow_all;
        var isDirectivePrologue = true;

        run: while (true) {
            for (p.lexer.comments_to_preserve_before.items) |comment| {
                try stmts.append(p.s(S.Comment{
                    .text = comment.text,
                }, p.lexer.loc()));
            }

            if (p.lexer.token == .t_end_of_file) {
                break :run;
            }

            var stmt = p.parseStmt(opts) catch break :run;

            // Skip TypeScript types entirely
            if (p.options.ts) {
                switch (stmt.data) {
                    .s_type_script => {
                        continue;
                    },
                    else => {},
                }
            }

            // Parse one or more directives at the beginning
            if (isDirectivePrologue) {
                isDirectivePrologue = false;
                switch (stmt.data) {
                    .s_expr => |expr| {
                        switch (expr.value.data) {
                            .e_string => |str| {
                                if (!str.prefer_template) {
                                    stmt.data = Stmt.Data{
                                        .s_directive = p.m(S.Directive{
                                            .value = str.value,
                                            // .legacy_octal_loc = str.legacy_octal_loc,
                                        }),
                                    };
                                    isDirectivePrologue = true;

                                    if (strings.eqlUtf16("use strict", str.value)) {
                                        // Track "use strict" directives
                                        p.current_scope.strict_mode = .explicit_strict_mode;
                                    } else if (strings.eqlUtf16("use asm", str.value)) {
                                        stmt.data = Stmt.Data{ .s_empty = p.m(S.Empty{}) };
                                    }
                                }
                            },
                            else => {},
                        }
                    },
                    else => {},
                }
            }

            try stmts.append(stmt);

            // Warn about ASI and return statements. Here's an example of code with
            // this problem: https://github.com/rollup/rollup/issues/3729
            if (!p.options.suppress_warnings_about_weird_code) {
                var needsCheck = true;
                switch (stmt.data) {
                    .s_return => |ret| {
                        if (ret.value == null and !p.latest_return_had_semicolon) {
                            returnWithoutSemicolonStart = stmt.loc.start;
                            needsCheck = false;
                        }
                    },
                    else => {},
                }

                if (needsCheck and returnWithoutSemicolonStart != -1) {
                    switch (stmt.data) {
                        .s_expr => |exp| {
                            try p.log.addWarning(
                                p.source,
                                logger.Loc{ .start = returnWithoutSemicolonStart + 6 },
                                "The following expression is not returned because of an automatically-inserted semicolon",
                            );
                        },
                        else => {},
                    }

                    returnWithoutSemicolonStart = -1;
                }
            }
        }

        return stmts.toOwnedSlice();
    }

    pub fn markStrictModeFeature(p: *P, feature: StrictModeFeature, r: logger.Range, detail: string) !void {
        var text: string = undefined;
        var can_be_transformed = false;
        switch (feature) {
            .with_statement => {
                text = "With statements";
            },
            .delete_bare_name => {
                text = "\"delete\" of a bare identifier";
            },
            .for_in_var_init => {
                text = "Variable initializers within for-in loops";
                can_be_transformed = true;
            },
            .eval_or_arguments => {
                text = try std.fmt.allocPrint(p.allocator, "Declarations with the name {s}", .{detail});
            },
            .reserved_word => {
                text = try std.fmt.allocPrint(p.allocator, "{s} is a reserved word and", .{detail});
            },
            .legacy_octal_literal => {
                text = "Legacy octal literals";
            },
            .legacy_octal_escape => {
                text = "Legacy octal escape sequences";
            },
            .if_else_function_stmt => {
                text = "Function declarations inside if statements";
            },
            // else => {
            //     text = "This feature";
            // },
        }

        var scope = p.current_scope;
        if (p.isStrictMode()) {
            var why: string = "";
            var notes: []logger.Data = undefined;
            var where: logger.Range = undefined;
            switch (scope.strict_mode) {
                .implicit_strict_mode_import => {
                    where = p.es6_import_keyword;
                },
                .implicit_strict_mode_export => {
                    where = p.es6_export_keyword;
                },
                .implicit_strict_mode_top_level_await => {
                    where = p.top_level_await_keyword;
                },
                .implicit_strict_mode_class => {
                    why = "All code inside a class is implicitly in strict mode";
                    where = p.enclosing_class_keyword;
                },
                else => {},
            }
            if (why.len == 0) {
                why = try std.fmt.allocPrint(p.allocator, "This file is implicitly in strict mode because of the \"{s}\" keyword here", .{p.source.textForRange(where)});
            }

            try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used in strict mode", .{text}), &([_]logger.Data{logger.rangeData(p.source, where, why)}));
        } else if (!can_be_transformed and p.isStrictModeOutputFormat()) {
            try p.log.addRangeError(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used with \"esm\" due to strict mode", .{text}));
        }
    }

    pub fn isStrictMode(p: *P) bool {
        return p.current_scope.strict_mode != .sloppy_mode;
    }

    pub fn isStrictModeOutputFormat(p: *P) bool {
        return true;
    }

    pub fn declareSymbol(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string) !Ref {
        // p.checkForNonBMPCodePoint(loc, name)

        // Forbid declaring a symbol with a reserved word in strict mode
        if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
            try p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(&p.source, loc), name);
        }

        // Allocate a new symbol
        var ref = try p.newSymbol(kind, name);

        const scope = p.current_scope;
        if (scope.members.get(name)) |existing| {
            var symbol: Symbol = p.symbols.items[@intCast(usize, existing.ref.inner_index)];

            switch (p.canMergeSymbols(scope, symbol.kind, kind)) {
                .forbidden => {
                    const r = js_lexer.rangeOfIdentifier(&p.source, loc);
                    var notes: []logger.Data = undefined;
                    notes = &([_]logger.Data{logger.rangeData(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} has already been declared", .{name}))});
                    try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} was originally declared here", .{name}), notes);
                    return existing.ref;
                },
                .keep_existing => {
                    ref = existing.ref;
                },
                .replace_with_new => {
                    symbol.link = ref;
                },
                .become_private_get_set_pair => {
                    ref = existing.ref;
                    symbol.kind = .private_get_set_pair;
                },
                .become_private_static_get_set_pair => {
                    ref = existing.ref;
                    symbol.kind = .private_static_get_set_pair;
                },

                .overwrite_with_new => {},
                // else => unreachable,
            }
        }

        try scope.members.put(name, js_ast.Scope.Member{ .ref = ref, .loc = loc });
        return ref;
    }

    pub fn parseFnExpr(p: *P, loc: logger.Loc, is_async: bool, async_range: logger.Range) !Expr {
        p.lexer.next();
        const is_generator = p.lexer.token == T.t_asterisk;
        if (is_generator) {
            // p.markSyntaxFeature()
            p.lexer.next();
        } else if (is_async) {
            // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        }

        var name: ?js_ast.LocRef = null;

        _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
        defer p.popScope();

        if (p.lexer.token == .t_identifier) {
            name = js_ast.LocRef{
                .loc = loc,
                .ref = null,
            };

            if (p.lexer.identifier.len > 0 and !strings.eql(p.lexer.identifier, "arguments")) {
                (name orelse unreachable).ref = try p.declareSymbol(.hoisted_function, (name orelse unreachable).loc, p.lexer.identifier);
            } else {
                (name orelse unreachable).ref = try p.newSymbol(.hoisted_function, p.lexer.identifier);
            }
            p.lexer.next();
        }

        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }

        var func = p.parseFn(name, FnOrArrowDataParse{
            .async_range = async_range,
            .allow_await = is_async,
            .allow_yield = is_generator,
        });

        return p.e(js_ast.E.Function{
            .func = func,
        }, loc);
    }

    pub fn parseFnBody(p: *P, data: *FnOrArrowDataParse) !G.FnBody {
        var oldFnOrArrowData = p.fn_or_arrow_data_parse;
        var oldAllowIn = p.allow_in;
        p.fn_or_arrow_data_parse = data.*;
        p.allow_in = true;

        const loc = p.lexer.loc();
        _ = try p.pushScopeForParsePass(Scope.Kind.function_body, p.lexer.loc());
        defer p.popScope();

        p.lexer.expect(.t_open_brace);
        var opts = ParseStatementOptions{};
        const stmts = p.parseStmtsUpTo(.t_close_brace, &opts) catch unreachable;
        p.lexer.next();

        p.allow_in = oldAllowIn;
        p.fn_or_arrow_data_parse = oldFnOrArrowData;
        return G.FnBody{ .loc = loc, .stmts = stmts };
    }

    pub fn parseArrowBody(p: *P, args: []js_ast.G.Arg, data: *FnOrArrowDataParse) !E.Arrow {
        var arrow_loc = p.lexer.loc();

        // Newlines are not allowed before "=>"
        if (p.lexer.has_newline_before) {
            try p.log.addRangeError(p.source, p.lexer.range(), "Unexpected newline before \"=>\"");
            fail();
        }

        p.lexer.expect(T.t_equals_greater_than);

        for (args) |arg| {
            var opts = ParseStatementOptions{};
            try p.declareBinding(Symbol.Kind.hoisted, arg.binding, &opts);
        }

        data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;
        if (p.lexer.token == .t_open_brace) {
            var body = try p.parseFnBody(data);
            p.after_arrow_body_loc = p.lexer.loc();
            return E.Arrow{ .args = args, .body = body };
        }

        _ = try p.pushScopeForParsePass(Scope.Kind.function_body, arrow_loc);
        defer p.popScope();

        var old_fn_or_arrow_data = p.fn_or_arrow_data_parse;
        p.fn_or_arrow_data_parse = data.*;

        var expr = p.parseExpr(Level.comma);
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;
        var stmts = try p.allocator.alloc(Stmt, 1);
        stmts[0] = p.s(S.Return{ .value = expr }, arrow_loc);

        return E.Arrow{ .args = args, .prefer_expr = true, .body = G.FnBody{ .loc = arrow_loc, .stmts = stmts } };
    }

    pub fn declareBinding(p: *P, kind: Symbol.Kind, binding: BindingNodeIndex, opts: *ParseStatementOptions) !void {
        switch (binding.data) {
            .b_identifier => |bind| {
                if (!opts.is_typescript_declare or (opts.is_namespace_scope and opts.is_export)) {
                    bind.ref = try p.declareSymbol(kind, binding.loc, p.loadNameFromRef(bind.ref));
                }
            },
            .b_missing => |*bind| {},

            .b_array => |bind| {
                for (bind.items) |item| {
                    p.declareBinding(kind, item.binding, opts) catch unreachable;
                }
            },

            .b_object => |bind| {
                for (bind.properties) |*prop| {
                    const value = prop.value;
                    p.declareBinding(kind, value, opts) catch unreachable;
                }
            },

            else => {
                // @compileError("Missing binding type");
            },
        }
    }

    // Saves us from allocating a slice to the heap
    pub fn parseArrowBodySingleArg(p: *P, arg: G.Arg, data: anytype) !E.Arrow {
        switch (@TypeOf(data)) {
            FnOrArrowDataParse => {
                var args = [_]G.Arg{arg};

                var d = data;

                return p.parseArrowBody(args[0..], &d);
            },
            *FnOrArrowDataParse => {
                var args = [_]G.Arg{arg};
                return p.parseArrowBody(args[0..], data);
            },
            else => unreachable,
        }
    }

    // This is where the allocate memory to the heap for AST objects.
    // This is a short name to keep the code more readable.
    // It also swallows errors, but I think that's correct here.
    // We can handle errors via the log.
    // We'll have to deal with @wasmHeapGrow or whatever that thing is.
    pub fn mm(self: *P, comptime ast_object_type: type, instance: anytype) callconv(.Inline) *ast_object_type {
        var obj = self.allocator.create(ast_object_type) catch unreachable;
        obj.* = instance;
        return obj;
    }

    // mmmm memmory allocation
    pub fn m(self: *P, kind: anytype) callconv(.Inline) *@TypeOf(kind) {
        return self.mm(@TypeOf(kind), kind);
    }

    // The name is temporarily stored in the ref until the scope traversal pass
    // happens, at which point a symbol will be generated and the ref will point
    // to the symbol instead.
    //
    // The scope traversal pass will reconstruct the name using one of two methods.
    // In the common case, the name is a slice of the file itself. In that case we
    // can just store the slice and not need to allocate any extra memory. In the
    // rare case, the name is an externally-allocated string. In that case we store
    // an index to the string and use that index during the scope traversal pass.
    pub fn storeNameInRef(p: *P, name: string) !js_ast.Ref {
        // jarred: honestly, this is kind of magic to me
        // but I think I think I understand it.
        // the strings are slices.
        // "name" is just a different place in p.source.contents's buffer
        // Instead of copying a shit ton of strings everywhere
        // we can just say "yeah this is really over here at inner_index"
        // .source_index being null is used to identify was this allocated or is just in the orignial thing.
        // you could never do this in JavaScript!!
        const ptr0 = @ptrToInt(name.ptr);
        const ptr1 = @ptrToInt(p.source.contents.ptr);

        // Is the data in "name" a subset of the data in "p.source.Contents"?
        if (ptr0 >= ptr1 and ptr0 + name.len < p.source.contents.len) {
            // std.debug.print("storeNameInRef fast path", .{});
            // The name is a slice of the file contents, so we can just reference it by
            // length and don't have to allocate anything. This is the common case.
            //
            // It's stored as a negative value so we'll crash if we try to use it. That
            // way we'll catch cases where we've forgotten to call loadNameFromRef().
            // The length is the negative part because we know it's non-zero.
            return js_ast.Ref{ .source_index = @intCast(Ref.Int, ptr0), .inner_index = (@intCast(Ref.Int, name.len) + @intCast(Ref.Int, ptr0)) };
        } else {
            // std.debug.print("storeNameInRef slow path", .{});
            // The name is some memory allocated elsewhere. This is either an inline
            // string constant in the parser or an identifier with escape sequences
            // in the source code, which is very unusual. Stash it away for later.
            // This uses allocations but it should hopefully be very uncommon.

            // allocated_names is lazily allocated
            if (p.allocated_names.capacity > 0) {
                const inner_index = @intCast(Ref.Int, p.allocated_names.items.len);
                try p.allocated_names.append(name);
                return js_ast.Ref{ .source_index = std.math.maxInt(Ref.Int), .inner_index = inner_index };
            } else {
                p.allocated_names = try @TypeOf(p.allocated_names).initCapacity(p.allocator, 1);
                p.allocated_names.appendAssumeCapacity(name);
                return js_ast.Ref{ .source_index = std.math.maxInt(Ref.Int), .inner_index = 0 };
            }

            // p.allocatedNames = append(p.allocatedNames, name)
            // return ref
        }
    }

    pub fn loadNameFromRef(p: *P, ref: js_ast.Ref) string {
        if (!ref.isSourceNull()) {
            if (ref.source_index == 0x80000000) {
                return p.allocated_names.items[ref.inner_index];
            }

            if (std.builtin.mode != std.builtin.Mode.ReleaseFast) {
                assert(ref.inner_index - ref.source_index > 0);
            }

            return p.source.contents[ref.inner_index .. ref.inner_index - ref.source_index];
        } else {
            std.debug.panic("Internal error: invalid symbol reference. {s}", .{ref});
        }
    }

    // This parses an expression. This assumes we've already parsed the "async"
    // keyword and are currently looking at the following token.
    pub fn parseAsyncPrefixExpr(p: *P, async_range: logger.Range, level: Level) !Expr {
        // "async function() {}"
        if (!p.lexer.has_newline_before and p.lexer.token == T.t_function) {
            return try p.parseFnExpr(async_range.loc, true, async_range);
        }

        // Check the precedence level to avoid parsing an arrow function in
        // "new async () => {}". This also avoids parsing "new async()" as
        // "new (async())()" instead.
        if (!p.lexer.has_newline_before and level.lt(.member)) {
            switch (p.lexer.token) {
                // "async => {}"
                .t_equals_greater_than => {
                    const arg = G.Arg{ .binding = p.b(
                        B.Identifier{
                            .ref = try p.storeNameInRef("async"),
                        },
                        async_range.loc,
                    ) };
                    _ = p.pushScopeForParsePass(.function_args, async_range.loc) catch unreachable;
                    defer p.popScope();
                    var arrow_body = try p.parseArrowBodySingleArg(arg, FnOrArrowDataParse{});
                    return p.e(arrow_body, async_range.loc);
                },
                // "async x => {}"
                .t_identifier => {
                    // p.markLoweredSyntaxFeature();
                    const ref = try p.storeNameInRef(p.lexer.identifier);
                    var arg = G.Arg{ .binding = p.b(B.Identifier{
                        .ref = ref,
                    }, p.lexer.loc()) };
                    p.lexer.next();

                    _ = try p.pushScopeForParsePass(.function_args, async_range.loc);
                    defer p.popScope();

                    var arrowBody = try p.parseArrowBodySingleArg(arg, FnOrArrowDataParse{
                        .allow_await = true,
                    });
                    arrowBody.is_async = true;
                    return p.e(arrowBody, async_range.loc);
                },

                // "async()"
                // "async () => {}"
                .t_open_paren => {
                    p.lexer.next();
                    return p.parseParenExpr(async_range.loc, ParenExprOpts{ .is_async = true, .async_range = async_range });
                },

                // "async<T>()"
                // "async <T>() => {}"
                .t_less_than => {
                    if (p.options.ts and p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                        p.lexer.next();
                        return p.parseParenExpr(async_range.loc, ParenExprOpts{ .is_async = true, .async_range = async_range });
                    }
                },

                else => {},
            }
        }

        // "async"
        // "async + 1"
        return p.e(
            E.Identifier{ .ref = try p.storeNameInRef("async") },
            async_range.loc,
        );
    }

    pub fn trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking(self: *P) bool {
        notimpl();
    }

    pub fn parseExprOrBindings(p: *P, level: Level, errors: ?*DeferredErrors) Expr {
        return p.parseExprCommon(level, errors, Expr.EFlags.none);
    }

    pub fn parseExpr(p: *P, level: Level) Expr {
        return p.parseExprCommon(level, null, Expr.EFlags.none);
    }

    pub fn parseExprWithFlags(p: *P, level: Level, flags: Expr.EFlags) Expr {
        return p.parseExprCommon(level, null, flags);
    }

    pub fn parseExprCommon(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) Expr {
        const had_pure_comment_before = p.lexer.has_pure_comment_before and !p.options.ignore_dce_annotations;
        var expr = p.parsePrefix(level, errors, flags);

        // There is no formal spec for "__PURE__" comments but from reverse-
        // engineering, it looks like they apply to the next CallExpression or
        // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
        // to the expression "a().b()".

        if (had_pure_comment_before and level.lt(.call)) {
            expr = p.parseSuffix(expr, @intToEnum(Level, @enumToInt(Level.call) - 1), errors, flags);
            switch (expr.data) {
                .e_call => |ex| {
                    ex.can_be_unwrapped_if_unused = true;
                },
                .e_new => |ex| {
                    ex.can_be_unwrapped_if_unused = true;
                },
                else => {},
            }
        }

        return p.parseSuffix(expr, level, errors, flags);
    }

    pub fn addImportRecord(p: *P, kind: ImportKind, loc: logger.Loc, name: string) u32 {
        var index = p.import_records.items.len;
        const record = ImportRecord{
            .kind = kind,
            .range = p.source.rangeOfString(loc),
            .path = fs.Path.init(name),
        };
        p.import_records.append(record) catch unreachable;
        return @intCast(u32, index);
    }

    pub fn popScope(p: *P) void {
        const current_scope = p.current_scope;
        // We cannot rename anything inside a scope containing a direct eval() call
        if (current_scope.contains_direct_eval) {
            var iter = current_scope.members.iterator();
            while (iter.next()) |member| {

                // Using direct eval when bundling is not a good idea in general because
                // esbuild must assume that it can potentially reach anything in any of
                // the containing scopes. We try to make it work but this isn't possible
                // in some cases.
                //
                // For example, symbols imported using an ESM import are a live binding
                // to the underlying symbol in another file. This is emulated during
                // scope hoisting by erasing the ESM import and just referencing the
                // underlying symbol in the flattened bundle directly. However, that
                // symbol may have a different name which could break uses of direct
                // eval:
                //
                //   // Before bundling
                //   import { foo as bar } from './foo.js'
                //   console.log(eval('bar'))
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   console.log(eval('bar'))
                //
                // There really isn't any way to fix this. You can't just rename "foo" to
                // "bar" in the example above because there may be a third bundled file
                // that also contains direct eval and imports the same symbol with a
                // different conflicting import alias. And there is no way to store a
                // live binding to the underlying symbol in a variable with the import's
                // name so that direct eval can access it:
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   const bar = /* cannot express a live binding to "foo" here */
                //   console.log(eval('bar'))
                //
                // Technically a "with" statement could potentially make this work (with
                // a big hit to performance), but they are deprecated and are unavailable
                // in strict mode. This is a non-starter since all ESM code is strict mode.
                //
                // So while we still try to obey the requirement that all symbol names are
                // pinned when direct eval is present, we make an exception for top-level
                // symbols in an ESM file when bundling is enabled. We make no guarantee
                // that "eval" will be able to reach these symbols and we allow them to be
                // renamed or removed by tree shaking.
                // if (p.currentScope.parent == null and p.has_es_module_syntax) {
                //     continue;
                // }

                p.symbols.items[member.value.ref.inner_index].must_not_be_renamed = true;
            }
        }

        p.current_scope = current_scope.parent orelse std.debug.panic("Internal error: attempted to call popScope() on the topmost scope", .{});
    }

    pub fn markExprAsParenthesized(p: *P, expr: *Expr) void {
        switch (expr.data) {
            .e_array => |ex| {
                ex.is_parenthesized = true;
            },
            .e_object => |ex| {
                ex.is_parenthesized = true;
            },
            else => {
                return;
            },
        }
    }

    pub fn parseYieldExpr(p: *P, loc: logger.Loc) Expr {
        // Parse a yield-from expression, which yields from an iterator
        const isStar = p.lexer.token == T.t_asterisk;

        if (isStar) {
            if (p.lexer.has_newline_before) {
                p.lexer.unexpected();
            }
            p.lexer.next();
        }

        var value: ?ExprNodeIndex = null;
        switch (p.lexer.token) {
            .t_close_brace, .t_close_paren, .t_colon, .t_comma, .t_semicolon => {},
            else => {
                if (isStar or !p.lexer.has_newline_before) {
                    value = p.parseExpr(.yield);
                }
            },
        }

        return p.e(E.Yield{
            .value = value,
            .is_star = isStar,
        }, loc);
    }

    pub fn parseProperty(p: *P, kind: Property.Kind, opts: *PropertyOpts, errors: ?*DeferredErrors) ?G.Property {
        var key: Expr = undefined;
        var key_range = p.lexer.range();
        var is_computed = false;

        switch (p.lexer.token) {
            .t_numeric_literal => {
                key = p.e(E.Number{
                    .value = p.lexer.number,
                }, p.lexer.loc());
                // p.checkForLegacyOctalLiteral()
                p.lexer.next();
            },
            .t_string_literal => {
                key = p.parseStringLiteral();
            },
            .t_big_integer_literal => {
                key = p.e(E.BigInt{ .value = p.lexer.identifier }, p.lexer.loc());
                // markSyntaxFeature
                p.lexer.next();
            },
            .t_private_identifier => {
                if (!opts.is_class or opts.ts_decorators.len > 0) {
                    p.lexer.expected(.t_identifier);
                }

                key = p.e(E.PrivateIdentifier{ .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable }, p.lexer.loc());
                p.lexer.next();
            },
            .t_open_bracket => {
                is_computed = true;
                // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                p.lexer.next();
                const wasIdentifier = p.lexer.token == .t_identifier;
                const expr = p.parseExpr(.comma);

                // Handle index signatures
                if (p.options.ts and p.lexer.token == .t_colon and wasIdentifier and opts.is_class) {
                    switch (expr.data) {
                        .e_identifier => |ident| {
                            p.lexer.next();
                            p.skipTypescriptType(.lowest);
                            p.lexer.expect(.t_close_bracket);
                            p.lexer.expect(.t_colon);
                            p.skipTypescriptType(.lowest);
                            p.lexer.expectOrInsertSemicolon();

                            // Skip this property entirely
                            return null;
                        },
                        else => {},
                    }
                }

                p.lexer.expect(.t_close_brace);
                key = expr;
            },
            .t_asterisk => {
                if (kind != .normal or opts.is_generator) {
                    p.lexer.unexpected();
                }

                p.lexer.next();
                opts.is_generator = true;
                return p.parseProperty(.normal, opts, errors);
            },

            else => {
                const name = p.lexer.identifier;
                const raw = p.lexer.raw();
                const name_range = p.lexer.range();

                if (!p.lexer.isIdentifierOrKeyword()) {
                    p.lexer.expect(.t_identifier);
                }

                p.lexer.next();

                // Support contextual keywords
                if (kind == .normal and !opts.is_generator) {
                    // Does the following token look like a key?
                    var couldBeModifierKeyword = p.lexer.isIdentifierOrKeyword();
                    if (!couldBeModifierKeyword) {
                        switch (p.lexer.token) {
                            .t_open_bracket, .t_numeric_literal, .t_string_literal, .t_asterisk, .t_private_identifier => {
                                couldBeModifierKeyword = true;
                            },
                            else => {},
                        }
                    }

                    // If so, check for a modifier keyword
                    if (couldBeModifierKeyword) {
                        // TODO: micro-optimization, use a smaller list for non-typescript files.
                        if (js_lexer.PropertyModifierKeyword.List.get(name)) |keyword| {
                            switch (keyword) {
                                .p_get => {
                                    if (!opts.is_async and strings.eql(raw, name)) {
                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return p.parseProperty(.get, opts, null);
                                    }
                                },

                                .p_set => {
                                    if (!opts.is_async and strings.eql(raw, name)) {
                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return p.parseProperty(.set, opts, null);
                                    }
                                },
                                .p_async => {
                                    if (!opts.is_async and strings.eql(raw, name)) {
                                        opts.is_async = true;
                                        opts.async_range = name_range;

                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return p.parseProperty(kind, opts, null);
                                    }
                                },
                                .p_static => {
                                    if (!opts.is_static and !opts.is_async and !opts.is_class and strings.eql(raw, name)) {
                                        opts.is_static = true;
                                        return p.parseProperty(kind, opts, null);
                                    }
                                },
                                .p_private, .p_protected, .p_public, .p_readonly, .p_abstract, .p_declare, .p_override => {
                                    // Skip over TypeScript keywords
                                    if (opts.is_class and p.options.ts and strings.eql(raw, name)) {
                                        return p.parseProperty(kind, opts, null);
                                    }
                                },
                            }
                        }
                    }
                }

                key = p.e(E.String{
                    .value = p.lexer.stringToUTF16(name),
                }, name_range.loc);

                // Parse a shorthand property
                if (!opts.is_class and kind == .normal and p.lexer.token != .t_colon and p.lexer.token != .t_open_paren and p.lexer.token != .t_less_than and !opts.is_generator and !js_lexer.Keywords.has(name)) {
                    if ((p.fn_or_arrow_data_parse.allow_await and strings.eql(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield and strings.eql(name, "yield"))) {
                        // TODO: add fmt to addRangeError
                        p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" or \"await\" here.") catch unreachable;
                    }

                    const ref = p.storeNameInRef(name) catch unreachable;
                    const value = p.e(E.Identifier{ .ref = ref }, key.loc);

                    // Destructuring patterns have an optional default value
                    var initializer: ?Expr = null;
                    if (errors != null and p.lexer.token == .t_equals) {
                        (errors orelse unreachable).invalid_expr_default_value = p.lexer.range();
                        p.lexer.next();
                        initializer = p.parseExpr(.comma);
                    }

                    return G.Property{
                        .kind = kind,
                        .key = key,
                        .value = value,
                        .initializer = initializer,
                        .flags = Flags.Property{ .was_shorthand = true },
                    };
                }
            },
        }

        if (p.options.ts) {
            // "class X { foo?: number }"
            // "class X { foo!: number }"
            if (opts.is_class and (p.lexer.token == .t_question or p.lexer.token == .t_exclamation)) {
                p.lexer.next();
            }

            // "class X { foo?<T>(): T }"
            // "const x = { foo<T>(): T {} }"
            p.skipTypescriptTypeParameters();
        }

        // Parse a class field with an optional initial value
        if (opts.is_class and kind == .normal and !opts.is_async and !opts.is_generator and p.lexer.token != .t_open_paren) {
            var initializer: ?Expr = null;

            // Forbid the names "constructor" and "prototype" in some cases
            if (!is_computed) {
                switch (key.data) {
                    .e_string => |str| {
                        if (std.mem.eql(u16, str.value, std.unicode.utf8ToUtf16LeStringLiteral("constructor")) or (opts.is_static and std.mem.eql(u16, str.value, std.unicode.utf8ToUtf16LeStringLiteral("prototype")))) {
                            // TODO: fmt error message to include string value.
                            p.log.addRangeError(p.source, key_range, "Invalid field name") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            // Skip over types
            if (p.options.ts and p.lexer.token == .t_colon) {
                p.lexer.next();
                p.skipTypescriptType(.lowest);
            }

            if (p.lexer.token == .t_equals) {
                p.lexer.next();
                initializer = p.parseExpr(.comma);
            }

            // Special-case private identifiers
            switch (key.data) {
                .e_private_identifier => |private| {
                    const name = p.loadNameFromRef(private.ref);
                    if (strings.eql(name, "#constructor")) {
                        p.log.addRangeError(p.source, key_range, "Invalid field name \"#constructor\"") catch unreachable;
                    }

                    var declare: js_ast.Symbol.Kind = undefined;
                    if (opts.is_static) {
                        declare = .private_static_field;
                    } else {
                        declare = .private_field;
                    }
                    private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                },
                else => {},
            }

            p.lexer.expectOrInsertSemicolon();

            return G.Property{
                .ts_decorators = opts.ts_decorators,
                .kind = kind,
                .flags = Flags.Property{
                    .is_computed = is_computed,
                    .is_static = opts.is_static,
                },
                .key = key,
                .initializer = initializer,
            };
        }

        // Parse a method expression
        if (p.lexer.token == .t_open_paren or kind != .normal or opts.is_class or opts.is_async or opts.is_generator) {
            if (p.lexer.token == .t_open_paren and kind != .get and kind != .set) {
                // markSyntaxFeature object extensions
            }

            const loc = p.lexer.loc();
            const scope_index = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
            var is_constructor = false;

            // Forbid the names "constructor" and "prototype" in some cases
            if (opts.is_class and !is_computed) {
                switch (key.data) {
                    .e_string => |str| {
                        if (!opts.is_static and strings.eqlUtf16("constructor", str.value)) {
                            if (kind == .get) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a getter") catch unreachable;
                            } else if (kind == .set) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a setter") catch unreachable;
                            } else if (opts.is_async) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be an async function") catch unreachable;
                            } else if (opts.is_generator) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a generator function") catch unreachable;
                            } else {
                                is_constructor = true;
                            }
                        } else if (opts.is_static and strings.eqlUtf16("prototype", str.value)) {
                            p.log.addRangeError(p.source, key_range, "Invalid static method name \"prototype\"") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            var func = p.parseFn(null, FnOrArrowDataParse{
                .async_range = opts.async_range,
                .allow_await = opts.is_async,
                .allow_yield = opts.is_generator,
                .allow_super_call = opts.class_has_extends and is_constructor,
                .allow_ts_decorators = opts.allow_ts_decorators,
                .is_constructor = is_constructor,

                // Only allow omitting the body if we're parsing TypeScript class
                .allow_missing_body_for_type_script = p.options.ts and opts.is_class,
            });

            // "class Foo { foo(): void; foo(): void {} }"
            if (func.body == null) {
                // Skip this property entirely
                p.popAndDiscardScope(scope_index);
                return null;
            }

            p.popScope();
            func.flags.is_unique_formal_parameters = true;
            const value = p.e(E.Function{ .func = func }, loc);

            // Enforce argument rules for accessors
            switch (kind) {
                .get => {
                    if (func.args.len > 0) {
                        const r = js_lexer.rangeOfIdentifier(&p.source, func.args[0].binding.loc);
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Getter {s} must have zero arguments", .{p.keyNameForError(key)}) catch unreachable;
                    }
                },
                .set => {
                    if (func.args.len != 1) {
                        var r = js_lexer.rangeOfIdentifier(&p.source, func.args[0].binding.loc);
                        if (func.args.len > 1) {
                            r = js_lexer.rangeOfIdentifier(&p.source, func.args[1].binding.loc);
                        }
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Setter {s} must have exactly 1 argument", .{p.keyNameForError(key)}) catch unreachable;
                    }
                },
                else => {},
            }

            // Special-case private identifiers
            switch (key.data) {
                .e_private_identifier => |private| {
                    var declare: Symbol.Kind = undefined;
                    var suffix: string = undefined;
                    switch (kind) {
                        .get => {
                            if (opts.is_static) {
                                declare = .private_static_get;
                            } else {
                                declare = .private_get;
                            }
                            suffix = "_get";
                        },
                        .set => {
                            if (opts.is_static) {
                                declare = .private_static_set;
                            } else {
                                declare = .private_set;
                            }
                            suffix = "_set";
                        },
                        else => {
                            if (opts.is_static) {
                                declare = .private_static_method;
                            } else {
                                declare = .private_method;
                            }
                            suffix = "_fn";
                        },
                    }

                    const name = p.loadNameFromRef(private.ref);
                    if (strings.eql(name, "#constructor")) {
                        p.log.addRangeError(p.source, key_range, "Invalid method name \"#constructor\"") catch unreachable;
                    }
                    private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                },
                else => {},
            }

            return G.Property{
                .ts_decorators = opts.ts_decorators,
                .kind = kind,
                .flags = Flags.Property{
                    .is_computed = is_computed,
                    .is_method = true,
                    .is_static = opts.is_static,
                },
                .key = key,
                .value = value,
            };
        }

        p.lexer.expect(.t_colon);

        const value = p.parseExprOrBindings(.comma, errors);

        return G.Property{
            .ts_decorators = &[_]Expr{},
            .kind = kind,
            .flags = Flags.Property{
                .is_computed = is_computed,
            },
            .key = key,
            .value = value,
        };
    }

    // By the time we call this, the identifier and type parameters have already
    // been parsed. We need to start parsing from the "extends" clause.
    pub fn parseClass(p: *P, class_keyword: logger.Range, name: ?js_ast.LocRef, class_opts: ParseClassOptions) G.Class {
        var extends: ?Expr = null;

        if (p.lexer.token == .t_extends) {
            p.lexer.next();
            extends = p.parseExpr(.new);
        }

        // TypeScript's type argument parser inside expressions backtracks if the
        // first token after the end of the type parameter list is "{", so the
        // parsed expression above will have backtracked if there are any type
        // arguments. This means we have to re-parse for any type arguments here.
        // This seems kind of wasteful to me but it's what the official compiler
        // does and it probably doesn't have that high of a performance overhead
        // because "extends" clauses aren't that frequent, so it should be ok.
        if (p.options.ts) {
            p.skipTypeScriptTypeArguments(false); // isInsideJSXElement
        }

        if (p.options.ts and p.lexer.isContextualKeyword("implements")) {
            p.lexer.next();

            while (true) {
                p.skipTypescriptType(.lowest);
                if (p.lexer.token != .t_comma) {
                    break;
                }
                p.lexer.next();
            }
        }

        var body_loc = p.lexer.loc();
        p.lexer.expect(T.t_open_brace);
        var properties = List(G.Property).init(p.allocator);

        // Allow "in" and private fields inside class bodies
        const old_allow_in = p.allow_in;
        const old_allow_private_identifiers = p.allow_private_identifiers;
        p.allow_in = true;
        p.allow_private_identifiers = true;

        // A scope is needed for private identifiers
        const scopeIndex = p.pushScopeForParsePass(.class_body, body_loc) catch unreachable;

        var opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };

        while (p.lexer.token != .t_close_brace) {
            if (p.lexer.token == .t_semicolon) {
                p.lexer.next();
                continue;
            }

            // Parse decorators for this property
            const first_decorator_loc = p.lexer.loc();
            if (opts.allow_ts_decorators) {
                opts.ts_decorators = p.parseTypeScriptDecorators();
            } else {
                opts.ts_decorators = &[_]Expr{};
            }

            // This property may turn out to be a type in TypeScript, which should be ignored
            if (p.parseProperty(.normal, &opts, null)) |property| {
                properties.append(property) catch unreachable;

                // Forbid decorators on class constructors
                if (opts.ts_decorators.len > 0) {
                    switch ((property.key orelse std.debug.panic("Internal error: Expected property {s} to have a key.", .{property})).data) {
                        .e_string => |str| {
                            if (strings.eqlUtf16("constructor", str.value)) {
                                p.log.addError(p.source, first_decorator_loc, "TypeScript does not allow decorators on class constructors") catch unreachable;
                            }
                        },
                        else => {},
                    }
                }
            }
        }

        if (class_opts.is_type_script_declare) {
            p.popAndDiscardScope(scopeIndex);
        } else {
            p.popScope();
        }

        p.allow_in = old_allow_in;
        p.allow_private_identifiers = old_allow_private_identifiers;

        return G.Class{
            .class_name = name,
            .extends = extends,
            .ts_decorators = class_opts.ts_decorators,
            .class_keyword = class_keyword,
            .body_loc = body_loc,
            .properties = properties.toOwnedSlice(),
        };
    }

    pub fn skipTypeScriptTypeArguments(p: *P, isInsideJSXElement: bool) void {
        notimpl();
    }

    pub fn parseTemplateParts(p: *P, include_raw: bool) std.meta.Tuple(&[_]type{ []E.TemplatePart, logger.Loc }) {
        var parts = List(E.TemplatePart).initCapacity(p.allocator, 1) catch unreachable;
        // Allow "in" inside template literals
        var oldAllowIn = p.allow_in;
        p.allow_in = true;
        var legacy_octal_loc = logger.Loc.Empty;

        parseTemplatePart: while (true) {
            p.lexer.next();
            var value = p.parseExpr(.lowest);
            var tail_loc = p.lexer.loc();
            p.lexer.rescanCloseBraceAsTemplateToken();
            var tail = p.lexer.string_literal;
            var tail_raw: string = "";

            if (include_raw) {
                tail_raw = p.lexer.rawTemplateContents();
            } else if (p.lexer.legacy_octal_loc.start > tail_loc.start) {
                legacy_octal_loc = p.lexer.legacy_octal_loc;
            }

            parts.append(E.TemplatePart{
                .value = value,
                .tail_loc = tail_loc,
                .tail = tail,
                .tail_raw = tail_raw,
            }) catch unreachable;

            if (p.lexer.token == .t_template_tail) {
                p.lexer.next();
                break :parseTemplatePart;
            }
            std.debug.assert(p.lexer.token != .t_end_of_file);
        }

        p.allow_in = oldAllowIn;

        return .{ .@"0" = parts.toOwnedSlice(), .@"1" = legacy_octal_loc };
    }

    // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
    pub fn parseStringLiteral(p: *P) Expr {
        var legacy_octal_loc: logger.Loc = logger.Loc.Empty;
        var loc = p.lexer.loc();
        if (p.lexer.legacy_octal_loc.start > loc.start) {
            legacy_octal_loc = p.lexer.legacy_octal_loc;
        }

        const expr = p.e(E.String{
            .value = p.lexer.string_literal,
            .legacy_octal_loc = legacy_octal_loc,
            .prefer_template = p.lexer.token == .t_no_substitution_template_literal,
        }, loc);
        p.lexer.next();
        return expr;
    }

    pub fn parseCallArgs(p: *P) []Expr {
        // Allow "in" inside call arguments
        const old_allow_in = p.allow_in;
        p.allow_in = true;

        var args = List(Expr).init(p.allocator);
        p.lexer.expect(.t_open_paren);

        while (p.lexer.token != .t_close_paren) {
            const loc = p.lexer.loc();
            const is_spread = p.lexer.token == .t_dot_dot_dot;
            if (is_spread) {
                // p.mark_syntax_feature(compat.rest_argument, p.lexer.range());
                p.lexer.next();
            }
            var arg = p.parseExpr(.comma);
            if (is_spread) {
                arg = p.e(E.Spread{ .value = arg }, loc);
            }
            args.append(arg) catch unreachable;
            if (p.lexer.token != .t_comma) {
                break;
            }
            p.lexer.next();
        }

        p.lexer.expect(.t_close_paren);
        p.allow_in = old_allow_in;
        return args.toOwnedSlice();
    }

    pub fn parseSuffix(p: *P, left: Expr, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) Expr {
        return _parseSuffix(p, left, level, errors orelse &DeferredErrors.None, flags);
    }
    pub fn _parseSuffix(p: *P, _left: Expr, level: Level, errors: *DeferredErrors, flags: Expr.EFlags) Expr {
        var expr: Expr = undefined;
        var left = _left;
        var loc = p.lexer.loc();
        var optional_chain: ?js_ast.OptionalChain = null;

        while (true) {
            if (p.lexer.loc().start == p.after_arrow_body_loc.start) {
                while (true) {
                    switch (p.lexer.token) {
                        .t_comma => {
                            if (level.gte(.comma)) {
                                return left;
                            }

                            p.lexer.next();
                            left = p.e(E.Binary{
                                .op = .bin_comma,
                                .left = left,
                                .right = p.parseExpr(.comma),
                            }, left.loc);
                        },
                        else => {
                            return left;
                        },
                    }
                }
            }

            // Stop now if this token is forbidden to follow a TypeScript "as" cast
            if (p.lexer.loc().start == p.forbid_suffix_after_as_loc.start) {
                return left;
            }

            // Reset the optional chain flag by default. That way we won't accidentally
            // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
            var old_optional_chain = optional_chain;
            optional_chain = null;

            switch (p.lexer.token) {
                .t_dot => {
                    p.lexer.next();
                    if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                        // "a.#b"
                        // "a?.b.#c"
                        switch (left.data) {
                            .e_super => {
                                p.lexer.expected(.t_identifier);
                            },
                            else => {},
                        }

                        var name = p.lexer.identifier;
                        var name_loc = p.lexer.loc();
                        p.lexer.next();
                        const ref = p.storeNameInRef(name) catch unreachable;
                        left = p.e(E.Index{
                            .target = left,
                            .index = p.e(
                                E.PrivateIdentifier{
                                    .ref = ref,
                                },
                                name_loc,
                            ),
                            .optional_chain = old_optional_chain,
                        }, left.loc);
                    } else {
                        // "a.b"
                        // "a?.b.c"
                        if (!p.lexer.isIdentifierOrKeyword()) {
                            p.lexer.expect(.t_identifier);
                        }

                        var name = p.lexer.identifier;
                        var name_loc = p.lexer.loc();
                        p.lexer.next();

                        left = p.e(E.Dot{ .target = left, .name = name, .name_loc = name_loc, .optional_chain = old_optional_chain }, left.loc);
                    }

                    optional_chain = old_optional_chain;
                },
                .t_question_dot => {
                    p.lexer.next();
                    var optional_start = js_ast.OptionalChain.start;

                    // TODO: Remove unnecessary optional chains
                    //                     		if p.options.mangleSyntax {
                    // 	if isNullOrUndefined, _, ok := toNullOrUndefinedWithSideEffects(left.Data); ok and !isNullOrUndefined {
                    // 		optionalStart = js_ast.OptionalChainNone
                    // 	}
                    // }

                    switch (p.lexer.token) {
                        .t_open_bracket => {
                            // "a?.[b]"
                            p.lexer.next();

                            // allow "in" inside the brackets;
                            const old_allow_in = p.allow_in;
                            p.allow_in = true;

                            const index = p.parseExpr(.lowest);

                            p.allow_in = old_allow_in;

                            p.lexer.expect(.t_close_bracket);
                            left = p.e(
                                E.Index{ .target = left, .index = index, .optional_chain = optional_start },
                                left.loc,
                            );
                        },

                        .t_open_paren => {
                            // "a?.()"
                            if (level.gte(.call)) {
                                return left;
                            }

                            left = p.e(E.Call{
                                .target = left,
                                .args = p.parseCallArgs(),
                                .optional_chain = optional_start,
                            }, left.loc);
                        },
                        .t_less_than => {
                            // "a?.<T>()"
                            if (!p.options.ts) {
                                p.lexer.expected(.t_identifier);
                            }

                            p.skipTypeScriptTypeArguments(false);
                            if (p.lexer.token != .t_open_paren) {
                                p.lexer.expected(.t_open_paren);
                            }

                            if (level.gte(.call)) {
                                return left;
                            }

                            left = p.e(
                                E.Call{ .target = left, .args = p.parseCallArgs(), .optional_chain = optional_start },
                                left.loc,
                            );
                        },
                        else => {
                            if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                                // "a?.#b"
                                const name = p.lexer.identifier;
                                const name_loc = p.lexer.loc();
                                p.lexer.next();
                                const ref = p.storeNameInRef(name) catch unreachable;
                                left = p.e(E.Index{
                                    .target = left,
                                    .index = p.e(
                                        E.PrivateIdentifier{
                                            .ref = ref,
                                        },
                                        name_loc,
                                    ),
                                    .optional_chain = optional_start,
                                }, left.loc);
                            } else {
                                // "a?.b"
                                if (!p.lexer.isIdentifierOrKeyword()) {
                                    p.lexer.expect(.t_identifier);
                                }
                                const name = p.lexer.identifier;
                                const name_loc = p.lexer.loc();
                                p.lexer.next();

                                left = p.e(E.Dot{
                                    .target = left,
                                    .name = name,
                                    .name_loc = name_loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            }
                        },
                    }

                    // Only continue if we have started
                    if (optional_start == .start) {
                        optional_start = .ccontinue;
                    }
                },
                .t_no_substitution_template_literal => {
                    if (old_optional_chain != null) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                    const head = p.lexer.string_literal;
                    const head_raw = p.lexer.rawTemplateContents();
                    p.lexer.next();
                    left = p.e(E.Template{
                        .tag = left,
                        .head = head,
                        .head_raw = head_raw,
                        .legacy_octal_loc = logger.Loc.Empty,
                    }, left.loc);
                },
                .t_template_head => {
                    if (old_optional_chain != null) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                    const head = p.lexer.string_literal;
                    const head_raw = p.lexer.rawTemplateContents();
                    const partsGroup = p.parseTemplateParts(true);
                    p.lexer.next();
                    const tag = left;
                    left = p.e(E.Template{ .tag = tag, .head = head, .head_raw = head_raw, .parts = partsGroup.@"0" }, left.loc);
                },
                .t_open_bracket => {
                    // When parsing a decorator, ignore EIndex expressions since they may be
                    // part of a computed property:
                    //
                    //   class Foo {
                    //     @foo ['computed']() {}
                    //   }
                    //
                    // This matches the behavior of the TypeScript compiler.
                    if (flags != .ts_decorator) {
                        return left;
                    }

                    p.lexer.next();

                    // Allow "in" inside the brackets
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    const index = p.parseExpr(.lowest);

                    p.allow_in = old_allow_in;

                    p.lexer.expect(.t_close_bracket);

                    left = p.e(E.Index{
                        .target = left,
                        .index = index,
                        .optional_chain = old_optional_chain,
                    }, left.loc);
                    optional_chain = old_optional_chain;
                },
                .t_open_paren => {
                    if (level.gte(.call)) {
                        return left;
                    }

                    left = p.e(
                        E.Call{
                            .target = left,
                            .args = p.parseCallArgs(),
                            .optional_chain = old_optional_chain,
                        },
                        left.loc,
                    );
                    optional_chain = old_optional_chain;
                },
                .t_question => {
                    if (level.gte(.conditional)) {
                        return left;
                    }
                    p.lexer.next();

                    // Stop now if we're parsing one of these:
                    // "(a?) => {}"
                    // "(a?: b) => {}"
                    // "(a?, b?) => {}"
                    if (p.options.ts and left.loc.start == p.latest_arrow_arg_loc.start and (p.lexer.token == .t_colon or
                        p.lexer.token == .t_close_paren or p.lexer.token == .t_comma))
                    {
                        if (errors.isEmpty()) {
                            p.lexer.unexpected();
                        }
                        errors.invalid_expr_after_question = p.lexer.range();
                        return left;
                    }

                    // Allow "in" in between "?" and ":"
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    const yes = p.parseExpr(.comma);

                    p.allow_in = old_allow_in;
                    p.lexer.expect(.t_colon);
                    const no = p.parseExpr(.comma);

                    left = p.e(E.If{
                        .test_ = left,
                        .yes = yes,
                        .no = no,
                    }, left.loc);
                },
                .t_exclamation => {
                    // Skip over TypeScript non-null assertions
                    if (p.lexer.has_newline_before) {
                        return left;
                    }

                    if (!p.options.ts) {
                        p.lexer.unexpected();
                    }

                    if (level.gte(.postfix)) {
                        return left;
                    }

                    p.lexer.next();
                    optional_chain = old_optional_chain;
                },
                .t_minus_minus => {
                    if (p.lexer.has_newline_before or level.gte(.postfix)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Unary{ .op = .un_post_dec, .value = left }, left.loc);
                },
                .t_plus_plus => {
                    if (p.lexer.has_newline_before or level.gte(.postfix)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Unary{ .op = .un_post_inc, .value = left }, left.loc);
                },
                .t_comma => {
                    if (level.gte(.comma)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_comma, .left = left, .right = p.parseExpr(.comma) }, left.loc);
                },
                .t_plus => {
                    if (level.gte(.add)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_add, .left = left, .right = p.parseExpr(.add) }, left.loc);
                },
                .t_plus_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_add_assign, .left = left, .right = p.parseExpr(@intToEnum(Op.Level, @enumToInt(Op.Level.assign) - 1)) }, left.loc);
                },
                .t_minus => {
                    if (level.gte(.add)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_sub, .left = left, .right = p.parseExpr(.add) }, left.loc);
                },
                .t_minus_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_sub_assign, .left = left, .right = p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                },
                .t_asterisk => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_mul, .left = left, .right = p.parseExpr(.multiply) }, left.loc);
                },
                .t_asterisk_asterisk => {
                    if (level.gte(.exponentiation)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_pow, .left = left, .right = p.parseExpr(Op.Level.exponentiation.sub(1)) }, left.loc);
                },
                .t_asterisk_asterisk_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_pow_assign, .left = left, .right = p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                },
                .t_asterisk_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_mul_assign, .left = left, .right = p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                },
                .t_percent => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_rem, .left = left, .right = p.parseExpr(Op.Level.multiply) }, left.loc);
                },
                .t_percent_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_rem_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_slash => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_div, .left = left, .right = p.parseExpr(Level.multiply) }, left.loc);
                },
                .t_slash_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_div_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_loose_eq, .left = left, .right = p.parseExpr(Level.equals) }, left.loc);
                },
                .t_exclamation_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_loose_ne, .left = left, .right = p.parseExpr(Level.equals) }, left.loc);
                },
                .t_equals_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_strict_eq, .left = left, .right = p.parseExpr(Level.equals) }, left.loc);
                },
                .t_exclamation_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_strict_ne, .left = left, .right = p.parseExpr(Level.equals) }, left.loc);
                },
                .t_less_than => {
                    // TypeScript allows type arguments to be specified with angle brackets
                    // inside an expression. Unlike in other languages, this unfortunately
                    // appears to require backtracking to parse.
                    if (p.options.ts and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                        optional_chain = old_optional_chain;
                        continue;
                    }

                    if (level.gte(.compare)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_lt, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                .t_less_than_equals => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_le, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                .t_greater_than => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_gt, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                .t_greater_than_equals => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_ge, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                .t_less_than_less_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl, .left = left, .right = p.parseExpr(.shift) }, left.loc);
                },
                .t_less_than_less_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_greater_than_greater_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shr, .left = left, .right = p.parseExpr(.shift) }, left.loc);
                },
                .t_greater_than_greater_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_greater_than_greater_than_greater_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_u_shr, .left = left, .right = p.parseExpr(.shift) }, left.loc);
                },
                .t_greater_than_greater_than_greater_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_u_shr_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_question_question => {
                    if (level.gte(.nullish_coalescing)) {
                        return left;
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_nullish_coalescing, .left = left, .right = p.parseExpr(.nullish_coalescing) }, left.loc);
                },
                .t_question_question_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_nullish_coalescing_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_bar_bar => {
                    if (level.gte(.logical_or)) {
                        return left;
                    }

                    // Prevent "||" inside "??" from the right
                    if (level.eql(.nullish_coalescing)) {
                        p.lexer.unexpected();
                    }

                    p.lexer.next();
                    const right = p.parseExpr(.logical_or);
                    left = p.e(E.Binary{ .op = Op.Code.bin_logical_or, .left = left, .right = right }, left.loc);

                    if (level.lt(.nullish_coalescing)) {
                        left = p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                        if (p.lexer.token == .t_question_question) {
                            p.lexer.unexpected();
                        }
                    }
                },
                .t_bar_bar_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_or_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_ampersand_ampersand => {
                    if (level.gte(.logical_and)) {
                        return left;
                    }

                    // Prevent "&&" inside "??" from the right
                    if (level.eql(.nullish_coalescing)) {
                        p.lexer.unexpected();
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_and, .left = left, .right = p.parseExpr(.logical_and) }, left.loc);

                    // Prevent "&&" inside "??" from the left
                    if (level.lt(.nullish_coalescing)) {
                        left = p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                        if (p.lexer.token == .t_question_question) {
                            p.lexer.unexpected();
                        }
                    }
                },
                .t_ampersand_ampersand_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_and_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_bar => {
                    if (level.gte(.bitwise_or)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_or, .left = left, .right = p.parseExpr(.bitwise_or) }, left.loc);
                },
                .t_bar_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_or_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_ampersand => {
                    if (level.gte(.bitwise_and)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_and, .left = left, .right = p.parseExpr(.bitwise_and) }, left.loc);
                },
                .t_ampersand_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_caret => {
                    if (level.gte(.bitwise_xor)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_xor, .left = left, .right = p.parseExpr(.bitwise_xor) }, left.loc);
                },
                .t_caret_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_xor_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    p.lexer.next();

                    left = p.e(E.Binary{ .op = .bin_assign, .left = left, .right = p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_in => {
                    if (level.gte(.compare) or !p.allow_in) {
                        return left;
                    }

                    // Warn about "!a in b" instead of "!(a in b)"
                    switch (left.data) {
                        .e_unary => |unary| {
                            if (unary.op == .un_not) {
                                // TODO:
                                // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                            }
                        },
                        else => {},
                    }

                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_in, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                .t_instanceof => {
                    if (level.gte(.compare)) {
                        return left;
                    }

                    // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
                    // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
                    if (!p.options.suppress_warnings_about_weird_code) {
                        switch (left.data) {
                            .e_unary => |unary| {
                                if (unary.op == .un_not) {
                                    // TODO:
                                    // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                                }
                            },
                            else => {},
                        }
                    }
                    p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_instanceof, .left = left, .right = p.parseExpr(.compare) }, left.loc);
                },
                else => {
                    // Handle the TypeScript "as" operator
                    if (p.options.ts and level.lt(.compare) and !p.lexer.has_newline_before and p.lexer.isContextualKeyword("as")) {
                        p.lexer.next();
                        p.skipTypescriptType(.lowest);

                        // These tokens are not allowed to follow a cast expression. This isn't
                        // an outright error because it may be on a new line, in which case it's
                        // the start of a new expression when it's after a cast:
                        //
                        //   x = y as z
                        //   (something);
                        //
                        switch (p.lexer.token) {
                            .t_plus_plus,
                            .t_minus_minus,
                            .t_no_substitution_template_literal,
                            .t_template_head,
                            .t_open_paren,
                            .t_open_bracket,
                            .t_question_dot,
                            => {
                                p.forbid_suffix_after_as_loc = p.lexer.loc();
                                return left;
                            },
                            else => {},
                        }

                        if (p.lexer.token.isAssign()) {
                            p.forbid_suffix_after_as_loc = p.lexer.loc();
                            return left;
                        }
                        continue;
                    }

                    return left;
                },
            }
        }
    }
    pub fn _parsePrefix(p: *P, level: Level, errors: *DeferredErrors, flags: Expr.EFlags) Expr {
        const loc = p.lexer.loc();
        const l = @enumToInt(level);

        switch (p.lexer.token) {
            .t_super => {
                const superRange = p.lexer.range();
                p.lexer.next();

                switch (p.lexer.token) {
                    .t_open_paren => {
                        if (l < @enumToInt(Level.call) and p.fn_or_arrow_data_parse.allow_super_call) {
                            return p.e(E.Super{}, loc);
                        }
                    },
                    .t_dot, .t_open_bracket => {
                        return p.e(E.Super{}, loc);
                    },
                    else => {},
                }

                p.log.addRangeError(p.source, superRange, "Unexpected \"super\"") catch unreachable;
                return p.e(E.Super{}, loc);
            },
            .t_open_paren => {
                p.lexer.next();

                // Arrow functions aren't allowed in the middle of expressions
                if (l > @enumToInt(Level.assign)) {
                    const oldAllowIn = p.allow_in;
                    p.allow_in = true;

                    var value = p.parseExpr(Level.lowest);
                    p.markExprAsParenthesized(&value);
                    p.lexer.expect(.t_close_paren);
                    p.allow_in = oldAllowIn;
                    return value;
                }

                return p.parseParenExpr(loc, ParenExprOpts{}) catch unreachable;
            },
            .t_false => {
                p.lexer.next();
                return p.e(E.Boolean{ .value = false }, loc);
            },
            .t_true => {
                p.lexer.next();
                return p.e(E.Boolean{ .value = true }, loc);
            },
            .t_null => {
                p.lexer.next();
                return p.e(E.Null{}, loc);
            },
            .t_this => {
                p.lexer.next();
                return p.e(E.This{}, loc);
            },
            .t_identifier => {
                const name = p.lexer.identifier;
                const name_range = p.lexer.range();
                const raw = p.lexer.raw();
                p.lexer.next();

                // Handle async and await expressions
                if (name.len == 5) {
                    if (strings.eql(name, "async")) {
                        if (strings.eql(raw, "async")) {
                            return p.parseAsyncPrefixExpr(name_range, level) catch unreachable;
                        }
                    } else if (strings.eql(name, "await")) {
                        if (p.fn_or_arrow_data_parse.allow_await) {
                            if (!strings.eql(raw, "await")) {
                                p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be escaped.") catch unreachable;
                            } else {
                                if (p.fn_or_arrow_data_parse.is_top_level) {
                                    p.top_level_await_keyword = name_range;
                                    // p.markSyntaxFeature()
                                }

                                if (p.fn_or_arrow_data_parse.arrow_arg_errors) |*err| {
                                    err.invalid_expr_await = name_range;
                                } else {
                                    p.fn_or_arrow_data_parse.arrow_arg_errors = DeferredArrowArgErrors{ .invalid_expr_await = name_range };
                                }

                                var value = p.parseExpr(.prefix);
                                if (p.lexer.token == T.t_asterisk_asterisk) {
                                    p.lexer.unexpected();
                                }

                                return p.e(E.Await{ .value = value }, loc);
                            }
                        }
                    } else if (strings.eql(name, "yield")) {
                        if (p.fn_or_arrow_data_parse.allow_yield) {
                            if (strings.eql(raw, "yield")) {
                                p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be escaped") catch unreachable;
                            } else {
                                if (l > @enumToInt(Level.assign)) {
                                    p.log.addRangeError(p.source, name_range, "Cannot use a \"yield\" here without parentheses") catch unreachable;
                                }

                                if (p.fn_or_arrow_data_parse.arrow_arg_errors) |*err| {
                                    err.invalid_expr_yield = name_range;
                                }

                                return p.parseYieldExpr(loc);
                            }
                        } else if (!p.lexer.has_newline_before) {
                            // Try to gracefully recover if "yield" is used in the wrong place

                            switch (p.lexer.token) {
                                .t_null, .t_identifier, .t_false, .t_true, .t_numeric_literal, .t_big_integer_literal, .t_string_literal => {
                                    p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" outside a generator function") catch unreachable;
                                },
                                else => {},
                            }
                        }
                    }

                    // Handle the start of an arrow expression
                    if (p.lexer.token == .t_equals_greater_than) {
                        const ref = p.storeNameInRef(name) catch unreachable;
                        var args = p.allocator.alloc(Arg, 1) catch unreachable;
                        args[0] = Arg{ .binding = p.b(B.Identifier{
                            .ref = ref,
                        }, loc) };

                        _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
                        defer p.popScope();
                        return p.e(p.parseArrowBody(args, p.m(FnOrArrowDataParse{})) catch unreachable, loc);
                    }

                    const ref = p.storeNameInRef(name) catch unreachable;

                    return p.e(E.Identifier{
                        .ref = ref,
                    }, loc);
                }
            },
            .t_string_literal, .t_no_substitution_template_literal => {
                return p.parseStringLiteral();
            },
            .t_template_head => {
                var legacy_octal_loc = logger.Loc.Empty;
                var head = p.lexer.string_literal;
                var head_raw = p.lexer.raw();
                if (p.lexer.legacy_octal_loc.start > loc.start) {
                    legacy_octal_loc = p.lexer.legacy_octal_loc;
                }

                var resp = p.parseTemplateParts(false);
                const parts: []E.TemplatePart = resp.@"0";
                const tail_legacy_octal_loc: logger.Loc = resp.@"1";
                if (tail_legacy_octal_loc.start > 0) {
                    legacy_octal_loc = tail_legacy_octal_loc;
                }
                // Check if TemplateLiteral is unsupported. We don't care for this product.`
                // if ()

                return p.e(E.Template{ .head = head, .parts = parts, .legacy_octal_loc = legacy_octal_loc, .head_raw = head_raw }, loc);
            },
            .t_numeric_literal => {
                const value = p.e(E.Number{ .value = p.lexer.number }, loc);
                // p.checkForLegacyOctalLiteral()
                p.lexer.next();
                return value;
            },
            .t_big_integer_literal => {
                const value = p.lexer.identifier;
                // markSyntaxFeature bigInt
                p.lexer.next();
                return p.e(E.BigInt{ .value = value }, loc);
            },
            .t_slash, .t_slash_equals => {
                p.lexer.scanRegExp();
                const value = p.lexer.raw();
                p.lexer.next();
                return p.e(E.RegExp{ .value = value }, loc);
            },
            .t_void => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{
                    .op = .un_void,
                    .value = value,
                }, loc);
            },
            .t_typeof => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_typeof, .value = value }, loc);
            },
            .t_delete => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }
                // TODO: add error deleting private identifier
                // const private = value.data.e_private_identifier;
                // if (private) |private| {
                //     const name = p.loadNameFromRef(private.ref);
                //     p.log.addRangeError(index.loc, )
                // }

                return p.e(E.Unary{ .op = .un_delete, .value = value }, loc);
            },
            .t_plus => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_pos, .value = value }, loc);
            },
            .t_minus => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_neg, .value = value }, loc);
            },
            .t_tilde => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_cpl, .value = value }, loc);
            },
            .t_exclamation => {
                p.lexer.next();
                const value = p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_not, .value = value }, loc);
            },
            .t_minus_minus => {
                p.lexer.next();
                return p.e(E.Unary{ .op = .un_pre_dec, .value = p.parseExpr(.prefix) }, loc);
            },
            .t_plus_plus => {
                p.lexer.next();
                return p.e(E.Unary{ .op = .un_pre_inc, .value = p.parseExpr(.prefix) }, loc);
            },
            .t_function => {
                return p.parseFnExpr(loc, false, logger.Range.None) catch unreachable;
            },
            .t_class => {
                const classKeyword = p.lexer.range();
                // markSyntaxFEatuer class
                p.lexer.next();
                var name: ?js_ast.LocRef = null;

                _ = p.pushScopeForParsePass(.class_name, loc) catch unreachable;

                // Parse an optional class name
                if (p.lexer.token == .t_identifier and !js_lexer.StrictModeReservedWords.has(p.lexer.identifier)) {
                    name = js_ast.LocRef{ .loc = p.lexer.loc(), .ref = p.newSymbol(.other, p.lexer.identifier) catch unreachable };
                    p.lexer.next();
                }

                // Even anonymous classes can have TypeScript type parameters
                if (p.options.ts) {
                    p.skipTypescriptTypeParameters();
                }

                const class = p.parseClass(classKeyword, name, ParseClassOptions{});
                p.popScope();
                return p.e(class, loc);
            },
            .t_new => {
                p.lexer.next();

                // Special-case the weird "new.target" expression here

                const target = p.parseExprWithFlags(.member, flags);
                var args: []Expr = &([_]Expr{});

                if (p.options.ts) {
                    // Skip over TypeScript non-null assertions
                    if (p.lexer.token == .t_exclamation and !p.lexer.has_newline_before) {
                        p.lexer.next();
                    }

                    // Skip over TypeScript type arguments here if there are any
                    if (p.lexer.token == .t_less_than) {
                        _ = p.trySkipTypeScriptTypeArgumentsWithBacktracking();
                    }
                }

                if (p.lexer.token == .t_open_paren) {
                    args = p.parseCallArgs();
                }

                return p.e(E.New{
                    .target = target,
                    .args = args,
                }, loc);
            },
            .t_open_bracket => {
                p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var items = List(Expr).init(p.allocator);
                var self_errors = DeferredErrors{};
                var comma_after_spread = logger.Loc{};

                // Allow "in" inside arrays
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_bracket) {
                    switch (p.lexer.token) {
                        .t_comma => {
                            items.append(p.e(E.Missing{}, p.lexer.loc())) catch unreachable;
                        },
                        .t_dot_dot_dot => {
                            // this might be wrong.
                            errors.array_spread_feature = p.lexer.range();

                            const dots_loc = p.lexer.loc();
                            p.lexer.next();
                            items.append(
                                p.parseExprOrBindings(.comma, &self_errors),
                            ) catch unreachable;
                        },
                        else => {
                            items.append(
                                p.parseExprOrBindings(.comma, &self_errors),
                            ) catch unreachable;
                        },
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }

                p.lexer.expect(.t_close_bracket);
                p.allow_in = old_allow_in;

                if (p.willNeedBindingPattern()) {} else if (errors.isEmpty()) {
                    // Is this an expression?
                    p.logExprErrors(&self_errors);
                } else {
                    // In this case, we can't distinguish between the two yet
                    self_errors.mergeInto(errors);
                }
                return p.e(E.Array{
                    .items = items.toOwnedSlice(),
                    .comma_after_spread = comma_after_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_open_brace => {
                p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var properties = List(G.Property).init(p.allocator);
                var self_errors = DeferredErrors{};
                var comma_after_spread = logger.Loc{};

                // Allow "in" inside object literals
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_brace and p.lexer.token != .t_end_of_file) {
                    if (p.lexer.token == .t_dot_dot_dot) {
                        p.lexer.next();
                        properties.append(G.Property{ .kind = .spread, .value = p.parseExpr(.comma) }) catch unreachable;

                        // Commas are not allowed here when destructuring
                        if (p.lexer.token == .t_comma) {
                            comma_after_spread = p.lexer.loc();
                        }
                    } else {
                        // This property may turn out to be a type in TypeScript, which should be ignored
                        var propertyOpts = PropertyOpts{};
                        if (p.parseProperty(.normal, &propertyOpts, &self_errors)) |prop| {
                            properties.append(prop) catch unreachable;
                        }
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }

                p.lexer.expect(.t_close_brace);
                p.allow_in = old_allow_in;

                if (p.willNeedBindingPattern()) {} else if (errors.isEmpty()) {
                    // Is this an expression?
                    p.logExprErrors(&self_errors);
                } else {
                    // In this case, we can't distinguish between the two yet
                    self_errors.mergeInto(errors);
                }
                return p.e(E.Object{
                    .properties = properties.toOwnedSlice(),
                    .comma_after_spread = comma_after_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_less_than => {
                // This is a very complicated and highly ambiguous area of TypeScript
                // syntax. Many similar-looking things are overloaded.
                //
                // TS:
                //
                //   A type cast:
                //     <A>(x)
                //     <[]>(x)
                //     <A[]>(x)
                //
                //   An arrow function with type parameters:
                //     <A>(x) => {}
                //     <A, B>(x) => {}
                //     <A = B>(x) => {}
                //     <A extends B>(x) => {}
                //
                // TSX:
                //
                //   A JSX element:
                //     <A>(x) => {}</A>
                //     <A extends>(x) => {}</A>
                //     <A extends={false}>(x) => {}</A>
                //
                //   An arrow function with type parameters:
                //     <A, B>(x) => {}
                //     <A extends B>(x) => {}
                //
                //   A syntax error:
                //     <[]>(x)
                //     <A[]>(x)
                //     <A>(x) => {}
                //     <A = B>(x) => {}
                if (p.options.ts and p.options.jsx.parse) {
                    var oldLexer = p.lexer;

                    p.lexer.next();
                    // Look ahead to see if this should be an arrow function instead
                    var is_ts_arrow_fn = false;

                    if (p.lexer.token == .t_identifier) {
                        p.lexer.next();
                        if (p.lexer.token == .t_comma) {
                            is_ts_arrow_fn = true;
                        } else if (p.lexer.token == .t_extends) {
                            p.lexer.next();
                            is_ts_arrow_fn = p.lexer.token != .t_equals and p.lexer.token != .t_greater_than;
                        }
                    }

                    // Restore the lexer
                    p.lexer = oldLexer;

                    if (is_ts_arrow_fn) {
                        p.skipTypescriptTypeParameters();
                        p.lexer.expect(.t_open_paren);
                        return p.parseParenExpr(loc, ParenExprOpts{ .force_arrow_fn = true }) catch unreachable;
                    }
                }

                if (p.options.jsx.parse) {
                    notimpl();
                }

                if (p.options.ts) {
                    notimpl();
                }

                p.lexer.unexpected();
                return p.e(E.Missing{}, logger.Loc.Empty);
            },
            .t_import => {
                p.lexer.next();
                return p.parseImportExpr(loc, level);
            },
            else => {
                p.lexer.unexpected();
                return p.e(E.Missing{}, logger.Loc.Empty);
            },
        }

        return p.e(E.Missing{}, logger.Loc.Empty);
    }

    // Note: The caller has already parsed the "import" keyword
    pub fn parseImportExpr(p: *P, loc: logger.Loc, level: Level) Expr {
        // Parse an "import.meta" expression
        if (p.lexer.token == .t_dot) {
            p.es6_import_keyword = js_lexer.rangeOfIdentifier(&p.source, loc);
            p.lexer.next();
            if (p.lexer.isContextualKeyword("meta")) {
                const r = p.lexer.range();
                p.lexer.next();
                p.has_import_meta = true;
                return p.e(E.ImportMeta{}, loc);
            } else {
                p.lexer.expectedString("\"meta\"");
            }
        }

        if (level.gt(.call)) {
            const r = js_lexer.rangeOfIdentifier(&p.source, loc);
            p.log.addRangeError(p.source, r, "Cannot use an \"import\" expression here without parentheses") catch unreachable;
        }
        // allow "in" inside call arguments;
        var old_allow_in = p.allow_in;
        p.allow_in = true;

        p.lexer.preserve_all_comments_before = true;
        p.lexer.expect(.t_open_paren);
        const comments = p.lexer.comments_to_preserve_before.toOwnedSlice();
        p.lexer.preserve_all_comments_before = false;

        const value = p.parseExpr(.comma);
        p.lexer.expect(.t_close_paren);

        p.allow_in = old_allow_in;
        return p.e(E.Import{ .expr = value, .leading_interior_comments = comments, .import_record_index = 0 }, loc);
    }

    pub fn parseJSXElement(loc: logger.Loc) Expr {
        // Parse the tag
        //var startRange, startText, startTag := p.parseJSXTag();÷
        notimpl();
        return p.e(E.Missing{}, logger.Loc.Empty);
    }

    pub fn willNeedBindingPattern(p: *P) bool {
        switch (p.lexer.token) {
            .t_equals => {
                // "[a] = b;"
                return true;
            },
            .t_in => {
                // "for ([a] in b) {}"
                return !p.allow_in;
            },
            .t_identifier => {
                // "for ([a] of b) {}"
                return p.allow_in and p.lexer.isContextualKeyword("of");
            },
            else => {
                return false;
            },
        }
    }

    pub fn trySkipTypeScriptTypeArgumentsWithBacktracking(p: *P) bool {
        notimpl();
        // return false;
    }
    pub fn parsePrefix(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) Expr {
        return p._parsePrefix(level, errors orelse &DeferredErrors.None, flags);
    }

    pub fn appendPart(p: *P, parts: List(js_ast.Part), stmts: []Stmt) !void {
        p.symbol_uses = SymbolUseMap.init(p.allocator);
        p.declared_symbols.deinit();
        p.import_records_for_current_part.deinit();
        p.scopes_for_current_part.deinit();
        var opts = PrependTempRefsOpts{};
        var partStmts = List(Stmt).fromOwnedSlice(p.allocator, stmts);
        try p.visitStmtsAndPrependTempRefs(&partStmts, &opts);

        // Insert any relocated variable statements now
        if (p.relocated_top_level_vars.items.len > 0) {
            var already_declared = RefBoolMap.init(p.allocator);

            // Follow links because "var" declarations may be merged due to hoisting

            // while (true) {
            //     const link = p.symbols.items[local.ref.inner_index].link;
            // }
        }
        // TODO: here
    }

    pub fn visitStmtsAndPrependTempRefs(p: *P, stmts: *List(Stmt), opts: *PrependTempRefsOpts) !void {
        var old_temp_refs = p.temp_refs_to_declare;
        var old_temp_ref_count = p.temp_ref_count;
        p.temp_refs_to_declare.deinit();
        p.temp_refs_to_declare = @TypeOf(p.temp_refs_to_declare).init(p.allocator);
        p.temp_ref_count = 0;

        try p.visitStmts(stmts, opts.kind);

        // Prepend values for "this" and "arguments"
        if (opts.fn_body_loc != null) {
            // Capture "this"
            if (p.fn_only_data_visit.this_capture_ref) |ref| {
                try p.temp_refs_to_declare.append(TempRef{
                    .ref = ref,
                    .value = p.e(E.This{}, opts.fn_body_loc orelse std.debug.panic("Internal error: Expected opts.fn_body_loc to exist", .{})),
                });
            }
        }
    }

    pub fn recordDeclaredSymbol(p: *P, ref: Ref) !void {
        try p.declared_symbols.append(js_ast.DeclaredSymbol{
            .ref = ref,
            .is_top_level = p.current_scope == p.module_scope,
        });
    }

    pub fn visitExpr(p: *P, expr: Expr) Expr {
        return p.visitExprInOut(expr, ExprIn{});
    }

    pub fn valueForThis(p: *P, loc: logger.Loc) ?Expr {
        // Substitute "this" if we're inside a static class property initializer
        if (p.fn_only_data_visit.this_class_static_ref) |*ref| {
            p.recordUsage(ref);
            return p.e(E.Identifier{ .ref = ref.* }, loc);
        }

        // oroigianlly was !=- modepassthrough
        if (!p.fn_only_data_visit.is_this_nested) {
            if (p.has_es_module_syntax) {
                // In an ES6 module, "this" is supposed to be undefined. Instead of
                // doing this at runtime using "fn.call(undefined)", we do it at
                // compile time using expression substitution here.
                return p.e(E.Undefined{}, loc);
            } else {
                // In a CommonJS module, "this" is supposed to be the same as "exports".
                // Instead of doing this at runtime using "fn.call(module.exports)", we
                // do it at compile time using expression substitution here.
                p.recordUsage(&p.exports_ref);
                return p.e(E.Identifier{ .ref = p.exports_ref }, loc);
            }
        }

        return null;
    }

    pub fn visitExprInOut(p: *P, expr: Expr, in: ExprIn) Expr {
        switch (expr.data) {
            .e_null, .e_super, .e_boolean, .e_big_int, .e_reg_exp, .e_new_target, .e_undefined => {},
            .e_string => |e_| {
                // If you're using this, you're probably not using 0-prefixed legacy octal notation
                // if e.LegacyOctalLoc.Start > 0 {
            },
            .e_number => |e_| {
                // idc about legacy octal loc
            },
            .e_this => |e_| {
                if (p.valueForThis(expr.loc)) |exp| {
                    return exp;
                }

                //         		// Capture "this" inside arrow functions that will be lowered into normal
                // // function expressions for older language environments
                // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
                // 	return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
                // }
            },
            .e_import_meta => |exp| {},
            .e_spread => |exp| {
                return p.visitExpr(exp.value);
            },
            .e_identifier => |e_| {},
            .e_private_identifier => |e_| {},
            .e_jsx_element => |e_| {},
            .e_template => |e_| {},
            .e_binary => |e_| {},
            .e_index => |e_| {},
            .e_unary => |e_| {},
            .e_dot => |e_| {},
            .e_if => |e_| {},
            .e_await => |e_| {},
            .e_yield => |e_| {},
            .e_array => |e_| {},
            .e_object => |e_| {},
            .e_import => |e_| {},
            .e_call => |e_| {},
            .e_new => |e_| {},
            .e_arrow => |e_| {},
            .e_function => |e_| {},
            .e_class => |e_| {},
            else => {},
        }
        return expr;
    }

    pub fn visitAndAppendStmt(p: *P, stmts: *List(Stmt), stmt: *Stmt) !void {
        switch (stmt.data) {
            // These don't contain anything to traverse

            .s_debugger, .s_empty, .s_comment => {},
            .s_type_script => |data| {
                // Erase TypeScript constructs from the output completely
                return;
            },
            .s_directive => |data| {
                //         	if p.isStrictMode() && s.LegacyOctalLoc.Start > 0 {
                // 	p.markStrictModeFeature(legacyOctalEscape, p.source.RangeOfLegacyOctalEscape(s.LegacyOctalLoc), "")
                // }
                return;
            },
            .s_import => |data| {
                try p.recordDeclaredSymbol(data.namespace_ref);

                if (data.default_name) |default_name| {
                    try p.recordDeclaredSymbol(default_name.ref orelse unreachable);
                }

                if (data.items.len > 0) {
                    for (data.items) |*item| {
                        try p.recordDeclaredSymbol(item.name.ref orelse unreachable);
                    }
                }
            },
            .s_export_clause => |data| {
                // "export {foo}"
                var end: usize = 0;
                for (data.items) |*item| {
                    const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                    const symbol = try p.findSymbol(item.alias_loc, name);
                    const ref = symbol.ref;

                    if (p.symbols.items[ref.inner_index].kind == .unbound) {
                        // Silently strip exports of non-local symbols in TypeScript, since
                        // those likely correspond to type-only exports. But report exports of
                        // non-local symbols as errors in JavaScript.
                        if (!p.options.ts) {
                            const r = js_lexer.rangeOfIdentifier(&p.source, item.name.loc);
                            try p.log.addRangeErrorFmt(p.source, r, p.allocator, "\"{s}\" is not declared in this file", .{name});
                            continue;
                        }
                        continue;
                    }

                    item.name.ref = ref;
                    data.items[end] = item.*;
                    end += 1;
                }
                // esbuild: "Note: do not remove empty export statements since TypeScript uses them as module markers"
                // jarred: does that mean we can remove them here, since we're not bundling for production?
                data.items = data.items[0..end];
            },
            .s_export_from => |data| {
                // "export {foo} from 'path'"
                const name = p.loadNameFromRef(data.namespace_ref);
                data.namespace_ref = try p.newSymbol(.other, name);
                try p.current_scope.generated.append(data.namespace_ref);
                try p.recordDeclaredSymbol(data.namespace_ref);

                // This is a re-export and the symbols created here are used to reference
                for (data.items) |*item| {
                    const _name = p.loadNameFromRef(item.name.ref orelse unreachable);
                    const ref = try p.newSymbol(.other, _name);
                    try p.current_scope.generated.append(data.namespace_ref);
                    try p.recordDeclaredSymbol(data.namespace_ref);
                    item.name.ref = ref;
                }
            },
            .s_export_star => |data| {
                // "export {foo} from 'path'"
                const name = p.loadNameFromRef(data.namespace_ref);
                data.namespace_ref = try p.newSymbol(.other, name);
                try p.current_scope.generated.append(data.namespace_ref);
                try p.recordDeclaredSymbol(data.namespace_ref);

                // "export * as ns from 'path'"
                if (data.alias) |alias| {
                    // "import * as ns from 'path'"
                    // "export {ns}"

                    // jarred: For now, just always do this transform.
                    // because Safari doesn't support it and I've seen cases where this breaks
                    // TODO: backport unsupportedJSFeatures map
                    p.recordUsage(&data.namespace_ref);
                    try stmts.ensureCapacity(stmts.items.len + 2);
                    stmts.appendAssumeCapacity(p.s(S.Import{ .namespace_ref = data.namespace_ref, .star_name_loc = alias.loc, .import_record_index = data.import_record_index }, stmt.loc));

                    var items = try List(js_ast.ClauseItem).initCapacity(p.allocator, 1);
                    items.appendAssumeCapacity(js_ast.ClauseItem{ .alias = alias.original_name, .original_name = alias.original_name, .alias_loc = alias.loc, .name = LocRef{ .loc = alias.loc, .ref = data.namespace_ref } });
                    stmts.appendAssumeCapacity(p.s(S.ExportClause{ .items = items.toOwnedSlice(), .is_single_line = true }, stmt.loc));
                }
            },
            .s_export_default => |data| {
                try p.recordDeclaredSymbol(data.default_name.ref orelse unreachable);

                switch (data.value) {
                    .expr => |*expr| {
                        const was_anonymous_named_expr = expr.isAnonymousNamed();
                        // data.value.expr = p.m(p.visitExpr(expr.*));

                        // // Optionally preserve the name
                        // data.value.expr = p.maybeKeepExprSymbolName(expr, "default", was_anonymous_named_expr);

                        // // Discard type-only export default statements
                        // if (p.options.ts) {
                        //     switch (expr.data) {
                        //         .e_identifier => |ident| {
                        //             const symbol = p.symbols.items[ident.ref.inner_index];
                        //             if (symbol.kind == .unbound) {
                        //                 if (p.local_type_names.get(symbol.original_name)) |local_type| {
                        //                     if (local_type.value) {
                        //                         return;
                        //                     }
                        //                 }
                        //             }
                        //         },
                        //         else => {},
                        //     }
                        // }
                    },

                    .stmt => |st| {},
                }
            },
            .s_export_equals => |data| {},
            .s_break => |data| {},
            .s_continue => |data| {},
            .s_label => |data| {},
            .s_local => |data| {},
            .s_expr => |data| {},
            .s_throw => |data| {},
            .s_return => |data| {},
            .s_block => |data| {},
            .s_with => |data| {},
            .s_while => |data| {},
            .s_do_while => |data| {},
            .s_if => |data| {},
            .s_for => |data| {},
            .s_for_in => |data| {},
            .s_for_of => |data| {},
            .s_try => |data| {},
            .s_switch => |data| {},
            .s_function => |data| {},
            .s_class => |data| {},
            .s_enum => |data| {},
            .s_namespace => |data| {},
            else => {},
        }

        // if we get this far, it stays
        try stmts.append(stmt.*);
    }

    fn visitStmts(p: *P, stmts: *List(Stmt), kind: StmtsKind) !void {
        // Save the current control-flow liveness. This represents if we are
        // currently inside an "if (false) { ... }" block.
        var old_is_control_flow_dead = p.is_control_flow_dead;

        // visit all statements first
        var visited = try List(Stmt).initCapacity(p.allocator, stmts.items.len);
        var before = List(Stmt).init(p.allocator);
        var after = List(Stmt).init(p.allocator);
        for (stmts.items) |*stmt| {
            switch (stmt.data) {
                .s_export_equals => {
                    // TypeScript "export = value;" becomes "module.exports = value;". This
                    // must happen at the end after everything is parsed because TypeScript
                    // moves this statement to the end when it generates code.
                    try p.visitAndAppendStmt(&after, stmt);
                    continue;
                },
                .s_function => |data| {
                    // Manually hoist block-level function declarations to preserve semantics.
                    // This is only done for function declarations that are not generators
                    // or async functions, since this is a backwards-compatibility hack from
                    // Annex B of the JavaScript standard.
                    if (!p.current_scope.kindStopsHoisting() and p.symbols.items[data.func.name.?.ref.?.inner_index].kind == .hoisted_function) {
                        try p.visitAndAppendStmt(&before, stmt);
                        continue;
                    }
                },
                else => {},
            }
            try p.visitAndAppendStmt(&visited, stmt);
        }
    }

    fn extractDeclsForBinding(binding: Binding, decls: *List(G.Decl)) !void {
        switch (binding.data) {
            .b_property, .b_missing => {},
            .b_identifier => {
                try decls.append(G.Decl{ .binding = binding });
            },
            .b_array => |arr| {
                for (arr.items) |item| {
                    extractDeclsForBinding(item.binding, decls) catch unreachable;
                }
            },
            .b_object => |obj| {
                for (obj.properties) |prop| {
                    extractDeclsForBinding(prop.value, decls) catch unreachable;
                }
            },
        }
    }

    // This assumes that the open parenthesis has already been parsed by the caller
    pub fn parseParenExpr(p: *P, loc: logger.Loc, opts: ParenExprOpts) !Expr {
        var items_list = try List(Expr).initCapacity(p.allocator, 1);
        var errors = DeferredErrors{};
        var arrowArgErrors = DeferredArrowArgErrors{};
        var spread_range = logger.Range{};
        var type_colon_range = logger.Range{};
        var comma_after_spread = logger.Loc{};

        // Push a scope assuming this is an arrow function. It may not be, in which
        // case we'll need to roll this change back. This has to be done ahead of
        // parsing the arguments instead of later on when we hit the "=>" token and
        // we know it's an arrow function because the arguments may have default
        // values that introduce new scopes and declare new symbols. If this is an
        // arrow function, then those new scopes will need to be parented under the
        // scope of the arrow function itself.
        const scopeIndex = p.pushScopeForParsePass(.function_args, loc);

        // Allow "in" inside parentheses
        var oldAllowIn = p.allow_in;
        p.allow_in = true;

        // Forbid "await" and "yield", but only for arrow functions
        var old_fn_or_arrow_data = p.fn_or_arrow_data_parse;
        p.fn_or_arrow_data_parse.arrow_arg_errors = arrowArgErrors;

        // Scan over the comma-separated arguments or expressions
        while (p.lexer.token != .t_close_paren) {
            const item_loc = p.lexer.loc();
            const is_spread = p.lexer.token == .t_dot_dot_dot;

            if (is_spread) {
                spread_range = p.lexer.range();
                // p.markSyntaxFeature()
                p.lexer.next();
            }

            // We don't know yet whether these are arguments or expressions, so parse
            p.latest_arrow_arg_loc = p.lexer.loc();

            var item = p.parseExprOrBindings(.comma, &errors);

            if (is_spread) {
                item = p.e(E.Spread{ .value = item }, loc);
            }

            // Skip over types
            if (p.options.ts and p.lexer.token == .t_colon) {
                type_colon_range = p.lexer.range();
                p.lexer.next();
                p.skipTypescriptType(.lowest);
            }

            if (p.options.ts and p.lexer.token == .t_equals and !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())) {
                p.lexer.next();
                var expr = p.parseExpr(.comma);
                item = item.assign(&expr, p.allocator);
            }

            items_list.append(item) catch unreachable;

            if (p.lexer.token != .t_comma) {
                break;
            }

            // Spread arguments must come last. If there's a spread argument followed
            if (is_spread) {
                comma_after_spread = p.lexer.loc();
            }

            // Eat the comma token
            p.lexer.next();
        }
        var items = items_list.toOwnedSlice();

        // The parenthetical construct must end with a close parenthesis
        p.lexer.expect(.t_close_paren);

        // Restore "in" operator status before we parse the arrow function body
        p.allow_in = oldAllowIn;

        // Also restore "await" and "yield" expression errors
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // Are these arguments to an arrow function?
        if (p.lexer.token == .t_equals_greater_than or opts.force_arrow_fn or (p.options.ts and p.lexer.token == .t_colon)) {
            var invalidLog = List(logger.Loc).init(p.allocator);
            var args = List(G.Arg).init(p.allocator);

            if (opts.is_async) {
                // markl,oweredsyntaxpoksdpokasd
            }

            // First, try converting the expressions to bindings
            for (items) |*_item| {
                var item = _item;
                var is_spread = false;
                switch (item.data) {
                    .e_spread => |v| {
                        is_spread = true;
                        item = &v.value;
                    },
                    else => {},
                }

                const tuple = p.convertExprToBindingAndInitializer(item, &invalidLog, is_spread);
                assert(tuple.binding != null);
                // double allocations
                args.append(G.Arg{
                    .binding = tuple.binding orelse unreachable,
                    .default = tuple.expr,
                }) catch unreachable;
            }

            // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
            // function. The ":" after the ")" may be a return type annotation, so we
            // attempt to convert the expressions to bindings first before deciding
            // whether this is an arrow function, and only pick an arrow function if
            // there were no conversion errors.
            if (p.lexer.token == .t_equals_greater_than or (invalidLog.items.len == 0 and (p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking() or opts.force_arrow_fn))) {
                if (comma_after_spread.start > 0) {
                    p.log.addRangeError(p.source, logger.Range{ .loc = comma_after_spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
                }
                p.logArrowArgErrors(&arrowArgErrors);
            }
        }

        return p.e(E.Missing{}, loc);
    }

    pub fn init(allocator: *std.mem.Allocator, log: *logger.Log, source: logger.Source, lexer: js_lexer.Lexer, opts: Parser.Options) !*P {
        var parser = try allocator.create(P);
        parser.allocated_names = @TypeOf(parser.allocated_names).init(allocator);
        parser.scopes_for_current_part = @TypeOf(parser.scopes_for_current_part).init(allocator);
        parser.symbols = @TypeOf(parser.symbols).init(allocator);
        parser.ts_use_counts = @TypeOf(parser.ts_use_counts).init(allocator);
        parser.declared_symbols = @TypeOf(parser.declared_symbols).init(allocator);
        parser.known_enum_values = @TypeOf(parser.known_enum_values).init(allocator);
        parser.import_records = @TypeOf(parser.import_records).init(allocator);
        parser.import_records_for_current_part = @TypeOf(parser.import_records_for_current_part).init(allocator);
        parser.export_star_import_records = @TypeOf(parser.export_star_import_records).init(allocator);
        parser.import_items_for_namespace = @TypeOf(parser.import_items_for_namespace).init(allocator);
        parser.named_imports = @TypeOf(parser.named_imports).init(allocator);
        parser.top_level_symbol_to_parts = @TypeOf(parser.top_level_symbol_to_parts).init(allocator);
        parser.import_namespace_cc_map = @TypeOf(parser.import_namespace_cc_map).init(allocator);
        parser.scopes_in_order = @TypeOf(parser.scopes_in_order).init(allocator);
        parser.temp_refs_to_declare = @TypeOf(parser.temp_refs_to_declare).init(allocator);
        parser.relocated_top_level_vars = @TypeOf(parser.relocated_top_level_vars).init(allocator);
        parser.log = log;
        parser.allocator = allocator;
        parser.options = opts;
        parser.source = source;
        parser.lexer = lexer;
        parser.data = js_ast.AstData.init(allocator);

        return parser;
    }
};

// The "await" and "yield" expressions are never allowed in argument lists but
// may or may not be allowed otherwise depending on the details of the enclosing
// function or module. This needs to be handled when parsing an arrow function
// argument list because we don't know if these expressions are not allowed until
// we reach the "=>" token (or discover the absence of one).
//
// Specifically, for await:
//
//   // This is ok
//   async function foo() { (x = await y) }
//
//   // This is an error
//   async function foo() { (x = await y) => {} }
//
// And for yield:
//
//   // This is ok
//   function* foo() { (x = yield y) }
//
//   // This is an error
//   function* foo() { (x = yield y) => {} }
//
const DeferredArrowArgErrors = struct {
    invalid_expr_await: logger.Range = logger.Range.None,
    invalid_expr_yield: logger.Range = logger.Range.None,
};

test "js_parser.init" {
    try alloc.setup(std.heap.page_allocator);

    const entryPointName = "/bacon/hello.js";
    const code = "for (let i = 0; i < 100; i++) { console.log(\"hi\");\n}";
    var parser = try Parser.init(try options.TransformOptions.initUncached(alloc.dynamic, entryPointName, code), alloc.dynamic);
    const res = try parser.parse();
}
