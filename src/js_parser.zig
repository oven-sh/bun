const std = @import("std");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const importRecord = @import("import_record.zig");
const js_ast = @import("js_ast.zig");
const options = @import("options.zig");
const alloc = @import("alloc.zig");
usingnamespace @import("strings.zig");

usingnamespace js_ast.G;
const S = js_ast.S;
const B = js_ast.B;
const T = js_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const locModuleScope = logger.Loc.Empty;

const TempRef = struct {
    ref: js_ast.Ref,
    value: *js_ast.Expr,
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

const Map = std.AutoHashMap;

const List = std.ArrayList;

const SymbolUseMap = Map(js_ast.Ref, js_ast.Symbol.Use);
const StringRefMap = std.StringHashMap(js_ast.Ref);
const StringBoolMap = std.StringHashMap(bool);
const RefBoolMap = Map(js_ast.Ref, bool);
const RefRefMap = Map(js_ast.Ref, js_ast.Ref);
const ImportRecord = importRecord.ImportRecord;
const ScopeOrder = struct {
    loc: logger.Loc,
    scope: *js_ast.Scope,
};

// This is function-specific information used during parsing. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataParse = struct {
    async_range: logger.Range,
    arrow_arg_errors: void,
    allow_await: bool = false,
    allow_yield: bool = false,
    allow_super_call: bool = false,
    is_top_level: bool = false,
    is_constructor: bool = false,
    is_type_script_declare: bool = false,

    // In TypeScript, forward declarations of functions have no bodies
    allow_missing_body_for_type_script: bool = false,

    // Allow TypeScript decorators in function arguments
    allow_ts_decorators: bool = false,
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataVisit = struct {
    super_index_ref: *js_ast.Ref,

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
    arguments_ref: *js_ast.Ref,

    // Arrow functions don't capture the value of "this" and "arguments". Instead,
    // the values are inherited from the surrounding context. If arrow functions
    // are turned into regular functions due to lowering, we will need to generate
    // local variables to capture these values so they are preserved correctly.
    this_capture_ref: *js_ast.Ref,
    arguments_capture_ref: *js_ast.Ref,

    // Inside a static class property initializer, "this" expressions should be
    // replaced with the class name.
    this_class_static_ref: *js_ast.Ref,

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

const ModuleType = enum { esm };

const PropertyOpts = struct {
    async_range: ?logger.Range,
    is_async: bool = false,
    is_generator: bool = false,

    // Class-related options
    is_static: bool = false,
    is_class: bool = false,
    class_has_extends: bool = false,
    allow_ts_decorators: bool = false,
    ts_decorators: []js_ast.Expr,
};

pub const Parser = struct {
    options: Options,
    lexer: js_lexer.Lexer,
    log: logger.Log,
    source: logger.Source,
    allocator: *std.mem.Allocator,
    p: ?*P,

    pub const Result = struct { ast: js_ast.Ast, ok: bool = false };

    pub const Options = struct {
        jsx: options.JSX,
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
        }

        return result;
    }

    pub fn init(transform: options.TransformOptions, allocator: *std.mem.Allocator) !Parser {
        const log = logger.Log{ .msgs = List(logger.Msg).init(allocator) };
        const source = logger.Source.initFile(transform.entry_point, allocator);
        const lexer = try js_lexer.Lexer.init(log, source, allocator);
        return Parser{
            .options = Options{
                .jsx = options.JSX{
                    .parse = true,
                    .factory = transform.jsx_factory,
                    .fragment = transform.jsx_fragment,
                },
            },
            .allocator = allocator,
            .lexer = lexer,
            .source = source,
            .log = log,
            .p = null,
        };
    }
};

const DeferredTsDecorators = struct { values: []js_ast.Expr,

// If this turns out to be a "declare class" statement, we need to undo the
// scopes that were potentially pushed while parsing the decorator arguments.
scopeIndex: usize };

const LexicalDecl = enum(u8) { forbid, allow_all, allow_fn_inside_if, allow_fn_inside_label };

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
    log: logger.Log,
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
    current_scope: *js_ast.Scope,
    scopes_for_current_part: List(*js_ast.Scope),
    symbols: List(js_ast.Symbol),
    ts_use_counts: List(u32),
    exports_ref: js_ast.Ref = js_ast.Ref.None,
    require_ref: js_ast.Ref = js_ast.Ref.None,
    module_ref: js_ast.Ref = js_ast.Ref.None,
    import_meta_ref: js_ast.Ref = js_ast.Ref.None,
    promise_ref: ?js_ast.Ref = null,

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
    //   })(ns1 || (ns1 = {}));
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
    //   var a; (function (a_1) {})(a || (a = {}));
    //   var b; (function (b_1) {})(b || (b = {}));
    //   var c; (function (c_1) {})(c || (c = {}));
    //   var d; (function (d_1) {})(d || (d = {}));
    //   var e; (function (e_1) {})(e || (e = {}));
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
    //   })(ns || (ns = {}));
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

    pub fn findSymbol(self: *P, loc: logger.Loc, name: string) ?js_ast.Symbol {
        return null;
    }

    pub fn recordUsage(self: *P, ref: *js_ast.Ref) void {
        // The use count stored in the symbol is used for generating symbol names
        // during minification. These counts shouldn't include references inside dead
        // code regions since those will be culled.
        if (!p.is_control_flow_dead) {
            p.symbols[ref.InnerIndex].use_count_estimate += 1;
            var use = p.symbolUses[ref];
            use.count_estimate += 1;
            p.symbolUses.put(ref, use);
        }

        // The correctness of TypeScript-to-JavaScript conversion relies on accurate
        // symbol use counts for the whole file, including dead code regions. This is
        // tracked separately in a parser-only data structure.
        if (p.options.ts.parse) {
            p.tsUseCounts.items[ref.inner_index] += 1;
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

    pub fn keyNameForError(p: *P, key: js_ast.Expr) string {
        switch (key.data) {
            js_ast.E.String => {
                return p.lexer.raw();
            },
            js_ast.E.PrivateIdentifier => {
                return p.lexer.raw();
                // return p.loadNameFromRef()
            },
            else => {
                return "property";
            },
        }
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

    pub fn pushScopeForParsePass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !int {
        var parent = p.current_scope;
        var scope = js_ast.Scope.initPtr(p.allocator);
        scope.kind = kind;
        scope.parent = parent;

        scope.label_ref = null;

        if (parent) |_parent| {
            try _parent.children.append(scope);
            scope.strict_mode = _parent.strict_mode;
        }
        p.current_scope = scope;

        // Enforce that scope locations are strictly increasing to help catch bugs
        // where the pushed scopes are mistmatched between the first and second passes
        if (p.scopes_in_order.items.len > 0) {
            const prev_start = p.scopes_in_order.items[p.scopes_in_order.items.len - 1].loc.start;
            if (prev_start >= loc.start) {
                std.debug.panic("Scope location {i} must be greater than {i}", .{ loc.start, prev_start });
            }
        }

        // Copy down function arguments into the function body scope. That way we get
        // errors if a statement in the function body tries to re-declare any of the
        // arguments.
        if (kind == js_ast.ScopeFunctionBody) {
            if (scope.parent.kind != js_ast.ScopeFunctionArgs) {
                std.debug.panic("Internal error");
            }

            // for name, member := range scope.parent.members {
            // 	// Don't copy down the optional function expression name. Re-declaring
            // 	// the name of a function expression is allowed.
            // 	kind := p.symbols[member.Ref.InnerIndex].Kind
            // 	if kind != js_ast.SymbolHoistedFunction {
            // 		scope.Members[name] = member
            // 	}
            // }
        }
    }

    pub fn parseStmt(p: *P, opts: *ParseStatementOptions) js_ast.Stmt {
        var loc = p.lexer.loc();
        var stmt: js_ast.Stmt = undefined;

        switch (p.lexer.token) {
            js_lexer.T.t_semicolon => {
                p.lexer.next();
                return js_ast.Stmt.init(js_ast.S.Empty{}, loc);
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
            },

            else => {},
        }

        return stmt;
    }

    pub fn parseStmtsUpTo(p: *P, eend: js_lexer.T, opts: *ParseStatementOptions) ![]js_ast.Stmt {
        var stmts = List(js_ast.Stmt).init(p.allocator);
        try stmts.ensureCapacity(1);

        var returnWithoutSemicolonStart: i32 = -1;
        opts.lexical_decl = .allow_all;
        var isDirectivePrologue = true;

        run: while (true) {
            if (p.lexer.comments_to_preserve_before) |comments| {
                for (comments) |comment| {
                    try stmts.append(Stmt.init(S.Comment{
                        .text = comment.text,
                    }, p.lexer.loc()));
                }
            }

            if (p.lexer.token == .t_end_of_file) {
                break :run;
            }

            var stmt = p.parseStmt(opts);
        }

        return stmts.toOwnedSlice();
    }

    pub fn init(allocator: *std.mem.Allocator, log: logger.Log, source: logger.Source, lexer: js_lexer.Lexer, opts: Parser.Options) !*P {
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

        return parser;
    }
};

test "js_parser.init" {
    try alloc.setup(std.heap.page_allocator);

    const entryPointName = "/bacon/hello.js";
    const code = "for (let i = 0; i < 100; i++) { console.log(\"hi\");\n}";
    var parser = try Parser.init(try options.TransformOptions.initUncached(alloc.dynamic, entryPointName, code), alloc.dynamic);
    const res = try parser.parse();
}
