pub const std = @import("std");
pub const logger = @import("./logger.zig");
pub const js_lexer = @import("./js_lexer.zig");
pub const importRecord = @import("./import_record.zig");
pub const js_ast = @import("./js_ast.zig");
pub const options = @import("./options.zig");
pub const js_printer = @import("./js_printer.zig");
pub const renamer = @import("./renamer.zig");
const _runtime = @import("./runtime.zig");
pub const RuntimeImports = _runtime.Runtime.Imports;
pub const RuntimeFeatures = _runtime.Runtime.Features;
pub const RuntimeNames = _runtime.Runtime.Names;
pub const fs = @import("./fs.zig");
const _hash_map = @import("./hash_map.zig");
const bun = @import("./global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = @import("./string_mutable.zig").MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const G = js_ast.G;
const Define = @import("./defines.zig").Define;
const DefineData = @import("./defines.zig").DefineData;
const FeatureFlags = @import("./feature_flags.zig");
pub const isPackagePath = @import("./resolver/resolver.zig").isPackagePath;
pub const ImportKind = importRecord.ImportKind;
pub const BindingNodeIndex = js_ast.BindingNodeIndex;
const Decl = G.Decl;
const Property = G.Property;
const Arg = G.Arg;
const Allocator = std.mem.Allocator;
pub const StmtNodeIndex = js_ast.StmtNodeIndex;
pub const ExprNodeIndex = js_ast.ExprNodeIndex;
pub const ExprNodeList = js_ast.ExprNodeList;
pub const StmtNodeList = js_ast.StmtNodeList;
pub const BindingNodeList = js_ast.BindingNodeList;
const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
const JSC = @import("javascript_core");

fn _disabledAssert(_: bool) void {
    if (!Environment.allow_assert) @compileLog("assert is missing an if (Environment.allow_assert)");
    unreachable;
}

const assert = if (Environment.allow_assert) std.debug.assert else _disabledAssert;
const ExprListLoc = struct {
    list: ExprNodeList,
    loc: logger.Loc,
};
pub const LocRef = js_ast.LocRef;
pub const S = js_ast.S;
pub const B = js_ast.B;
pub const T = js_lexer.T;
pub const E = js_ast.E;
pub const Stmt = js_ast.Stmt;
pub const Expr = js_ast.Expr;
pub const Binding = js_ast.Binding;
pub const Symbol = js_ast.Symbol;
pub const Level = js_ast.Op.Level;
pub const Op = js_ast.Op;
pub const Scope = js_ast.Scope;
pub const locModuleScope = logger.Loc{ .start = -100 };
const Ref = @import("./ast/base.zig").Ref;

pub const StringHashMap = _hash_map.StringHashMap;
pub const AutoHashMap = _hash_map.AutoHashMap;
const StringHashMapUnamanged = _hash_map.StringHashMapUnamanged;
const ObjectPool = @import("./pool.zig").ObjectPool;
const NodeFallbackModules = @import("./node_fallbacks.zig");
// Dear reader,
// There are some things you should know about this file to make it easier for humans to read
// "P" is the internal parts of the parser
// "p.e" allocates a new Expr
// "p.b" allocates a new Binding
// "p.s" allocates a new Stmt
// We do it this way so if we want to refactor how these are allocated in the future, we only have to modify one function to change it everywhere
// Everything in JavaScript is either an Expression, a Binding, or a Statement.
//   Expression:  foo(1)
//    Statement:  let a = 1;
//      Binding:  a
// While the names for Expr, Binding, and Stmt are directly copied from esbuild, those were likely inspired by Go's parser.
// which is another example of a very fast parser.

const ScopeOrderList = std.ArrayListUnmanaged(?ScopeOrder);

const JSXFactoryName = "JSX";
const JSXAutomaticName = "jsx_module";
// kept as a static reference
const exports_string_name: string = "exports";
const MacroRefs = std.AutoArrayHashMap(Ref, u32);

pub const AllocatedNamesPool = ObjectPool(
    std.ArrayList(string),
    struct {
        pub fn init(allocator: std.mem.Allocator) anyerror!std.ArrayList(string) {
            return std.ArrayList(string).init(allocator);
        }
    }.init,
    true,
    4,
);

fn foldStringAddition(lhs: Expr, rhs: Expr) ?Expr {
    switch (lhs.data) {
        .e_string => |left| {
            if (rhs.data == .e_string and left.isUTF8() and rhs.data.e_string.isUTF8()) {
                lhs.data.e_string.push(rhs.data.e_string);
                return lhs;
            }
        },
        .e_binary => |bin| {

            // 123 + "bar" + "baz"
            if (bin.op == .bin_add) {
                if (foldStringAddition(bin.right, rhs)) |out| {
                    return Expr.init(E.Binary, E.Binary{ .op = bin.op, .left = bin.left, .right = out }, lhs.loc);
                }
            }
        },
        else => {},
    }

    return null;
}

// If we are currently in a hoisted child of the module scope, relocate these
// declarations to the top level and return an equivalent assignment statement.
// Make sure to check that the declaration kind is "var" before calling this.
// And make sure to check that the returned statement is not the zero value.
//
// This is done to make some transformations non-destructive
// Without relocating vars to the top level, simplifying this:
// if (false) var foo = 1;
// to nothing is unsafe
// Because "foo" was defined. And now it's not.
pub const RelocateVars = struct {
    pub const Mode = enum { normal, for_in_or_for_of };

    stmt: ?Stmt = null,
    ok: bool = false,
};

const VisitArgsOpts = struct {
    body: []Stmt = &([_]Stmt{}),
    has_rest_arg: bool = false,

    // This is true if the function is an arrow function or a method
    is_unique_formal_parameters: bool = false,
};

const BunJSX = struct {
    pub threadlocal var bun_jsx_identifier: E.Identifier = undefined;
};
pub fn ExpressionTransposer(
    comptime Kontext: type,
    visitor: fn (ptr: *Kontext, arg: Expr, state: anytype) Expr,
) type {
    return struct {
        pub const Context = Kontext;
        pub const This = @This();
        context: *Context,

        pub fn init(c: *Context) This {
            return This{
                .context = c,
            };
        }

        pub fn maybeTransposeIf(self: *This, arg: Expr, state: anytype) Expr {
            switch (arg.data) {
                .e_if => |ex| {
                    ex.yes = self.maybeTransposeIf(ex.yes, state);
                    ex.no = self.maybeTransposeIf(ex.no, state);
                    return arg;
                },
                else => {
                    return visitor(self.context, arg, state);
                },
            }
        }
    };
}

pub fn locAfterOp(e: E.Binary) logger.Loc {
    if (e.left.loc.start < e.right.loc.start) {
        return e.right.loc;
    } else {
        // handle the case when we have transposed the operands
        return e.left.loc;
    }
}
const ExportsStringName = "exports";

const TransposeState = struct {
    is_await_target: bool = false,
    is_then_catch_target: bool = false,
    loc: logger.Loc,
};

var true_args = &[_]Expr{
    .{
        .data = .{ .e_boolean = .{ .value = true } },
        .loc = logger.Loc.Empty,
    },
};

const JSXTag = struct {
    pub const TagType = enum { fragment, tag };
    pub const Data = union(TagType) {
        fragment: u8,
        tag: Expr,

        pub fn asExpr(d: *const Data) ?ExprNodeIndex {
            switch (d.*) {
                .tag => |tag| {
                    return tag;
                },
                else => {
                    return null;
                },
            }
        }
    };
    data: Data,
    range: logger.Range,
    name: string = "",

    pub fn parse(comptime P: type, p: *P) anyerror!JSXTag {
        const loc = p.lexer.loc();

        // A missing tag is a fragment
        if (p.lexer.token == .t_greater_than) {
            return JSXTag{
                .range = logger.Range{ .loc = loc, .len = 0 },
                .data = Data{ .fragment = 1 },
                .name = "",
            };
        }

        // The tag is an identifier
        var name = p.lexer.identifier;
        var tag_range = p.lexer.range();
        try p.lexer.expectInsideJSXElement(.t_identifier);

        // Certain identifiers are strings
        // <div
        // <button
        // <Hello-:Button
        if (strings.containsComptime(name, "-:") or (p.lexer.token != .t_dot and name[0] >= 'a' and name[0] <= 'z')) {
            return JSXTag{
                .data = Data{ .tag = p.e(E.String{
                    .data = name,
                }, loc) },
                .range = tag_range,
            };
        }

        // Otherwise, this is an identifier
        // <Button>
        var tag = p.e(E.Identifier{ .ref = try p.storeNameInRef(name) }, loc);

        // Parse a member expression chain
        // <Button.Red>
        while (p.lexer.token == .t_dot) {
            try p.lexer.nextInsideJSXElement();
            const member_range = p.lexer.range();
            const member = p.lexer.identifier;
            try p.lexer.expectInsideJSXElement(.t_identifier);

            if (strings.indexOfChar(member, '-')) |index| {
                try p.log.addError(p.source, logger.Loc{ .start = member_range.loc.start + @intCast(i32, index) }, "Unexpected \"-\"");
                return error.SyntaxError;
            }

            var _name = try p.allocator.alloc(u8, name.len + 1 + member.len);
            std.mem.copy(u8, _name, name);
            _name[name.len] = '.';
            std.mem.copy(u8, _name[name.len + 1 .. _name.len], member);
            name = _name;
            tag_range.len = member_range.loc.start + member_range.len - tag_range.loc.start;
            tag = p.e(E.Dot{ .target = tag, .name = member, .name_loc = member_range.loc }, loc);
        }

        return JSXTag{ .data = Data{ .tag = tag }, .range = tag_range, .name = name };
    }
};

pub const TypeScript = struct {
    // This function is taken from the official TypeScript compiler source code:
    // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
    pub fn canFollowTypeArgumentsInExpression(token: js_lexer.T) bool {
        switch (token) {
            // These are the only tokens can legally follow a type argument list. So we
            // definitely want to treat them as type arg lists.
            .t_open_paren, // foo<x>(
            .t_no_substitution_template_literal, // foo<T> `...`
            // foo<T> `...${100}...`
            .t_template_head,
            => {
                return true;
            },
            // These cases can't legally follow a type arg list. However, they're not
            // legal expressions either. The user is probably in the middle of a
            // generic type. So treat it as such.
            .t_dot, // foo<x>.
            .t_close_paren, // foo<x>)
            .t_close_bracket, // foo<x>]
            .t_colon, // foo<x>:
            .t_semicolon, // foo<x>;
            .t_question, // foo<x>?
            .t_equals_equals, // foo<x> ==
            .t_equals_equals_equals, // foo<x> ===
            .t_exclamation_equals, // foo<x> !=
            .t_exclamation_equals_equals, // foo<x> !==
            .t_ampersand_ampersand, // foo<x> &&
            .t_bar_bar, // foo<x> ||
            .t_question_question, // foo<x> ??
            .t_caret, // foo<x> ^
            .t_ampersand, // foo<x> &
            .t_bar, // foo<x> |
            .t_close_brace, // foo<x> }
            .t_end_of_file, // foo<x>
            => {
                return true;
            },

            // We don't want to treat these as type arguments. Otherwise we'll parse
            // this as an invocation expression. Instead, we want to parse out the
            // expression in isolation from the type arguments.
            .t_comma, // foo<x>,
            .t_open_brace, // foo<x> {
            => {
                return false;
            },
            else => {
                // Anything else treat as an expression
                return false;
            },
        }
    }
    pub const Identifier = struct {
        pub const StmtIdentifier = enum {
            s_type,

            s_namespace,

            s_abstract,

            s_module,

            s_interface,

            s_declare,
        };
        pub fn forStr(str: string) ?StmtIdentifier {
            switch (str.len) {
                "type".len => return if (strings.eqlComptimeIgnoreLen(str, "type"))
                    .s_type
                else
                    null,
                "interface".len => {
                    if (strings.eqlComptime(str, "interface")) {
                        return .s_interface;
                    } else if (strings.eqlComptime(str, "namespace")) {
                        return .s_namespace;
                    } else {
                        return null;
                    }
                },
                "abstract".len => {
                    if (strings.eqlComptime(str, "abstract")) {
                        return .s_abstract;
                    } else {
                        return null;
                    }
                },
                "declare".len => {
                    if (strings.eqlComptime(str, "declare")) {
                        return .s_declare;
                    } else {
                        return null;
                    }
                },
                "module".len => {
                    if (strings.eqlComptime(str, "module")) {
                        return .s_module;
                    } else {
                        return null;
                    }
                },
                else => return null,
            }
        }
        pub const IMap = ComptimeStringMap(Kind, .{
            .{ "unique", .unique },
            .{ "abstract", .abstract },
            .{ "asserts", .asserts },
            .{ "keyof", .prefix },
            .{ "readonly", .prefix },
            .{ "infer", .prefix },
            .{ "any", .primitive },
            .{ "never", .primitive },
            .{ "unknown", .primitive },
            .{ "undefined", .primitive },
            .{ "object", .primitive },
            .{ "number", .primitive },
            .{ "string", .primitive },
            .{ "boolean", .primitive },
            .{ "bigint", .primitive },
            .{ "symbol", .primitive },
        });
        pub const Kind = enum {
            normal,
            unique,
            abstract,
            asserts,
            prefix,
            primitive,
        };
    };

    pub const SkipTypeOptions = struct {
        is_return_type: bool = false,
    };
};

// We must prevent collisions from generated names.
// We want to avoid adding a pass over all the symbols in the file.
// To do that:
// For every generated symbol, we reserve two backup symbol names
// If any usages of the preferred ref, we swap original_name with the backup
// If any usages of the backup ref, we swap original_name with the internal
// We *assume* the internal name is never used.
// In practice, it is possible. But, the internal names are so crazy long you'd have to be deliberately trying to use them.
const GeneratedSymbol = @import("./runtime.zig").Runtime.GeneratedSymbol;

pub const ImportScanner = struct {
    stmts: []Stmt = &([_]Stmt{}),

    kept_import_equals: bool = false,
    removed_import_equals: bool = false,
    pub fn scan(comptime P: type, p: *P, stmts: []Stmt, will_transform_to_common_js: bool) !ImportScanner {
        var scanner = ImportScanner{};
        var stmts_end: usize = 0;
        const allocator = p.allocator;
        const is_typescript_enabled: bool = comptime P.parser_features.typescript;

        for (stmts) |_stmt| {
            // zls needs the hint, it seems.
            var stmt: Stmt = _stmt;
            switch (stmt.data) {
                .s_import => |st__| {
                    var st = st__.*;
                    defer {
                        st__.* = st;
                    }

                    var record: *ImportRecord = &p.import_records.items[st.import_record_index];

                    if (record.path.isMacro()) {
                        record.is_unused = true;
                        record.path.is_disabled = true;
                        continue;
                    }

                    // The official TypeScript compiler always removes unused imported
                    // symbols. However, we deliberately deviate from the official
                    // TypeScript compiler's behavior doing this in a specific scenario:
                    // we are not bundling, symbol renaming is off, and the tsconfig.json
                    // "importsNotUsedAsValues" setting is present and is not set to
                    // "remove".
                    //
                    // This exists to support the use case of compiling partial modules for
                    // compile-to-JavaScript languages such as Svelte. These languages try
                    // to reference imports in ways that are impossible for esbuild to know
                    // about when esbuild is only given a partial module to compile. Here
                    // is an example of some Svelte code that might use esbuild to convert
                    // TypeScript to JavaScript:
                    //
                    //   <script lang="ts">
                    //     import Counter from './Counter.svelte';
                    //     export let name: string = 'world';
                    //   </script>
                    //   <main>
                    //     <h1>Hello {name}!</h1>
                    //     <Counter />
                    //   </main>
                    //
                    // Tools that use esbuild to compile TypeScript code inside a Svelte
                    // file like this only give esbuild the contents of the <script> tag.
                    // These tools work around this missing import problem when using the
                    // official TypeScript compiler by hacking the TypeScript AST to
                    // remove the "unused import" flags. This isn't possible in esbuild
                    // because esbuild deliberately does not expose an AST manipulation
                    // API for performance reasons.
                    //
                    // We deviate from the TypeScript compiler's behavior in this specific
                    // case because doing so is useful for these compile-to-JavaScript
                    // languages and is benign in other cases. The rationale is as follows:
                    //
                    //   * If "importsNotUsedAsValues" is absent or set to "remove", then
                    //     we don't know if these imports are values or types. It's not
                    //     safe to keep them because if they are types, the missing imports
                    //     will cause run-time failures because there will be no matching
                    //     exports. It's only safe keep imports if "importsNotUsedAsValues"
                    //     is set to "preserve" or "error" because then we can assume that
                    //     none of the imports are types (since the TypeScript compiler
                    //     would generate an error in that case).
                    //
                    //   * If we're bundling, then we know we aren't being used to compile
                    //     a partial module. The parser is seeing the entire code for the
                    //     module so it's safe to remove unused imports. And also we don't
                    //     want the linker to generate errors about missing imports if the
                    //     imported file is also in the bundle.
                    //
                    //   * If identifier minification is enabled, then using esbuild as a
                    //     partial-module transform library wouldn't work anyway because
                    //     the names wouldn't match. And that means we're minifying so the
                    //     user is expecting the output to be as small as possible. So we
                    //     should omit unused imports.
                    //
                    var did_remove_star_loc = false;
                    const keep_unused_imports = !p.options.features.trim_unused_imports;

                    // TypeScript always trims unused imports. This is important for
                    // correctness since some imports might be fake (only in the type
                    // system and used for type-only imports).
                    if (!keep_unused_imports) {
                        var found_imports = false;
                        var is_unused_in_typescript = true;

                        if (st.default_name) |default_name| {
                            found_imports = true;
                            const symbol = p.symbols.items[default_name.ref.?.innerIndex()];

                            // TypeScript has a separate definition of unused
                            if (is_typescript_enabled and p.ts_use_counts.items[default_name.ref.?.innerIndex()] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                st.default_name = null;
                            }
                        }

                        // Remove the star import if it's unused
                        if (st.star_name_loc) |_| {
                            found_imports = true;
                            const symbol = p.symbols.items[st.namespace_ref.innerIndex()];

                            // TypeScript has a separate definition of unused
                            if (is_typescript_enabled and p.ts_use_counts.items[st.namespace_ref.innerIndex()] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                // Make sure we don't remove this if it was used for a property
                                // access while bundling
                                var has_any = false;

                                if (p.import_items_for_namespace.get(st.namespace_ref)) |entry| {
                                    if (entry.count() > 0) {
                                        has_any = true;
                                        break;
                                    }
                                }

                                if (!has_any) {
                                    st.star_name_loc = null;
                                    did_remove_star_loc = true;
                                }
                            }
                        }

                        // Remove items if they are unused
                        if (st.items.len > 0) {
                            found_imports = true;
                            var items_end: usize = 0;
                            var i: usize = 0;
                            while (i < st.items.len) : (i += 1) {
                                const item = st.items[i];
                                const ref = item.name.ref.?;
                                const symbol: Symbol = p.symbols.items[ref.innerIndex()];

                                // TypeScript has a separate definition of unused
                                if (is_typescript_enabled and p.ts_use_counts.items[ref.innerIndex()] != 0) {
                                    is_unused_in_typescript = false;
                                }

                                // Remove the symbol if it's never used outside a dead code region
                                if (symbol.use_count_estimate != 0) {
                                    st.items[items_end] = item;
                                    items_end += 1;
                                }
                            }

                            st.items = st.items[0..items_end];
                        }

                        // -- Original Comment --
                        // Omit this statement if we're parsing TypeScript and all imports are
                        // unused. Note that this is distinct from the case where there were
                        // no imports at all (e.g. "import 'foo'"). In that case we want to keep
                        // the statement because the user is clearly trying to import the module
                        // for side effects.
                        //
                        // This culling is important for correctness when parsing TypeScript
                        // because a) the TypeScript compiler does ths and we want to match it
                        // and b) this may be a fake module that only exists in the type system
                        // and doesn't actually exist in reality.
                        //
                        // We do not want to do this culling in JavaScript though because the
                        // module may have side effects even if all imports are unused.
                        // -- Original Comment --

                        // jarred: I think, in this project, we want this behavior, even in JavaScript.
                        // I think this would be a big performance improvement.
                        // The less you import, the less code you transpile.
                        // Side-effect imports are nearly always done through identifier-less imports
                        // e.g. `import 'fancy-stylesheet-thing/style.css';`
                        // This is a breaking change though. We can make it an option with some guardrail
                        // so maybe if it errors, it shows a suggestion "retry without trimming unused imports"
                        if ((is_typescript_enabled and found_imports and is_unused_in_typescript and !p.options.preserve_unused_imports_ts) or
                            (!is_typescript_enabled and p.options.features.trim_unused_imports and found_imports and st.star_name_loc == null and st.items.len == 0 and st.default_name == null))
                        {
                            // internal imports are presumed to be always used
                            // require statements cannot be stripped
                            if (!record.is_internal and !record.was_originally_require) {
                                record.is_unused = true;
                                continue;
                            }
                        }
                    }

                    const namespace_ref = st.namespace_ref;
                    const convert_star_to_clause = !p.options.enable_bundling and !p.options.can_import_from_bundle and p.symbols.items[namespace_ref.innerIndex()].use_count_estimate == 0;

                    if (convert_star_to_clause and !keep_unused_imports) {
                        st.star_name_loc = null;
                    }

                    record.contains_default_alias = record.contains_default_alias or st.default_name != null;

                    const existing_items: ImportItemForNamespaceMap = p.import_items_for_namespace.get(namespace_ref) orelse
                        ImportItemForNamespaceMap.init(allocator);

                    // ESM requires live bindings
                    // CommonJS does not require live bindings
                    // We load ESM in browsers & in Bun.js
                    // We have to simulate live bindings for cases where the code is bundled
                    // We do not know at this stage whether or not the import statement is bundled
                    // This keeps track of the `namespace_alias` incase, at printing time, we determine that we should print it with the namespace
                    for (st.items) |item| {
                        const is_default = strings.eqlComptime(item.alias, "default");
                        record.contains_default_alias = record.contains_default_alias or is_default;

                        const name: LocRef = item.name;
                        const name_ref = name.ref.?;

                        try p.named_imports.put(name_ref, js_ast.NamedImport{
                            .alias = item.alias,
                            .alias_loc = name.loc,
                            .namespace_ref = namespace_ref,
                            .import_record_index = st.import_record_index,
                        });

                        // Make sure the printer prints this as a property access
                        var symbol: *Symbol = &p.symbols.items[name_ref.innerIndex()];

                        symbol.namespace_alias = G.NamespaceAlias{
                            .namespace_ref = namespace_ref,
                            .alias = item.alias,
                            .import_record_index = st.import_record_index,
                            .was_originally_property_access = st.star_name_loc != null and existing_items.contains(symbol.original_name),
                        };
                    }

                    try p.import_records_for_current_part.append(allocator, st.import_record_index);

                    if (st.star_name_loc != null) {
                        record.contains_import_star = true;
                    }

                    if (record.was_originally_require) {
                        var symbol = &p.symbols.items[namespace_ref.innerIndex()];
                        symbol.namespace_alias = G.NamespaceAlias{
                            .namespace_ref = namespace_ref,
                            .alias = "",
                            .import_record_index = st.import_record_index,
                            .was_originally_property_access = false,
                        };
                    }
                },

                .s_function => |st| {
                    if (st.func.flags.contains(.is_export)) {
                        if (st.func.name) |name| {
                            const original_name = p.symbols.items[name.ref.?.innerIndex()].original_name;
                            try p.recordExport(name.loc, original_name, name.ref.?);

                            if (p.options.features.hot_module_reloading) {
                                st.func.flags.remove(.is_export);
                            }
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.func.open_parens_loc, .len = 2 }, "Exported functions must have a name");
                        }
                    }
                },
                .s_class => |st| {
                    if (st.is_export) {
                        if (st.class.class_name) |name| {
                            try p.recordExport(name.loc, p.symbols.items[name.ref.?.innerIndex()].original_name, name.ref.?);

                            if (p.options.features.hot_module_reloading) {
                                st.is_export = false;
                            }
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.class.body_loc, .len = 0 }, "Exported classes must have a name");
                        }
                    }
                },
                .s_local => |st| {
                    if (st.is_export) {
                        for (st.decls) |decl| {
                            p.recordExportedBinding(decl.binding);
                        }
                    }

                    // Remove unused import-equals statements, since those likely
                    // correspond to types instead of values
                    if (st.was_ts_import_equals and !st.is_export and st.decls.len > 0) {
                        var decl = st.decls[0];

                        // Skip to the underlying reference
                        var value = decl.value;
                        if (decl.value != null) {
                            while (true) {
                                if (@as(Expr.Tag, value.?.data) == .e_dot) {
                                    value = value.?.data.e_dot.target;
                                } else {
                                    break;
                                }
                            }
                        }

                        // Is this an identifier reference and not a require() call?
                        if (value) |val| {
                            if (@as(Expr.Tag, val.data) == .e_identifier) {
                                // Is this import statement unused?
                                if (@as(Binding.Tag, decl.binding.data) == .b_identifier and p.symbols.items[decl.binding.data.b_identifier.ref.innerIndex()].use_count_estimate == 0) {
                                    p.ignoreUsage(val.data.e_identifier.ref);

                                    scanner.removed_import_equals = true;
                                    continue;
                                } else {
                                    scanner.kept_import_equals = true;
                                }
                            }
                        }
                    }

                    // We must do this at the end to not mess up import =
                    if (p.options.features.hot_module_reloading and st.is_export) {
                        st.is_export = false;
                    }
                },
                .s_export_default => |st| {
                    // This is defer'd so that we still record export default for identifiers
                    defer {
                        if (st.default_name.ref) |ref| {
                            p.recordExport(st.default_name.loc, "default", ref) catch {};
                        }
                    }

                    // Rewrite this export to be:
                    // exports.default =
                    // But only if it's anonymous
                    if (p.options.features.hot_module_reloading) {

                        // export default can be:
                        // - an expression
                        // - a function
                        // - a class
                        // it cannot be a declaration!
                        // we want to avoid adding a new name
                        // but we must remove the export default clause.
                        transform_export_default_when_its_anonymous: {
                            switch (st.value) {
                                .expr => |ex| {
                                    switch (ex.data) {
                                        .e_identifier => {
                                            continue;
                                        },
                                        .e_import_identifier => |import_ident| {
                                            st.default_name.ref = import_ident.ref;
                                            continue;
                                        },
                                        .e_function => |func| {
                                            if (func.func.name) |name_ref| {
                                                if (name_ref.ref != null) {
                                                    stmt = p.s(S.Function{ .func = func.func }, ex.loc);
                                                    st.default_name.ref = name_ref.ref.?;
                                                    break :transform_export_default_when_its_anonymous;
                                                }
                                            }
                                        },
                                        .e_class => |class| {
                                            if (class.class_name) |name_ref| {
                                                if (name_ref.ref != null) {
                                                    stmt = p.s(
                                                        S.Class{
                                                            .class = class.*,
                                                        },
                                                        ex.loc,
                                                    );
                                                    st.default_name.ref = name_ref.ref.?;
                                                    break :transform_export_default_when_its_anonymous;
                                                }
                                            }
                                        },
                                        else => {},
                                    }
                                    var decls = try allocator.alloc(G.Decl, 1);
                                    decls[0] = G.Decl{ .binding = p.b(B.Identifier{ .ref = st.default_name.ref.? }, stmt.loc), .value = ex };

                                    stmt = p.s(S.Local{
                                        .decls = decls,
                                        .kind = S.Local.Kind.k_var,
                                        .is_export = false,
                                    }, ex.loc);
                                },
                                .stmt => |class_or_func| {
                                    switch (class_or_func.data) {
                                        .s_function => |func| {
                                            if (func.func.name) |name_ref| {
                                                if (name_ref.ref != null) {
                                                    stmt = class_or_func;
                                                    st.default_name.ref = name_ref.ref.?;
                                                    break :transform_export_default_when_its_anonymous;
                                                }
                                            }

                                            var decls = try allocator.alloc(G.Decl, 1);
                                            decls[0] = G.Decl{ .binding = p.b(B.Identifier{ .ref = st.default_name.ref.? }, stmt.loc), .value = p.e(E.Function{ .func = func.func }, stmt.loc) };

                                            stmt = p.s(S.Local{
                                                .decls = decls,
                                                .kind = S.Local.Kind.k_var,
                                                .is_export = false,
                                            }, stmt.loc);
                                        },
                                        .s_class => |class| {
                                            if (class.class.class_name) |name_ref| {
                                                if (name_ref.ref != null) {
                                                    stmt = class_or_func;
                                                    st.default_name.ref = name_ref.ref.?;
                                                    break :transform_export_default_when_its_anonymous;
                                                }
                                            }

                                            var decls = try allocator.alloc(G.Decl, 1);
                                            decls[0] = G.Decl{
                                                .binding = p.b(B.Identifier{ .ref = st.default_name.ref.? }, stmt.loc),
                                                .value = p.e(E.Class{
                                                    .class_keyword = class.class.class_keyword,
                                                    .ts_decorators = class.class.ts_decorators,
                                                    .class_name = class.class.class_name,
                                                    .extends = class.class.extends,
                                                    .body_loc = class.class.body_loc,
                                                    .properties = class.class.properties,
                                                    .close_brace_loc = class.class.close_brace_loc,
                                                }, stmt.loc),
                                            };

                                            stmt = p.s(S.Local{
                                                .decls = decls,
                                                .kind = S.Local.Kind.k_var,
                                                .is_export = false,
                                            }, stmt.loc);
                                        },
                                        else => unreachable,
                                    }
                                },
                            }
                        }
                    } else if (will_transform_to_common_js) {
                        const expr: js_ast.Expr = switch (st.value) {
                            .expr => |exp| exp,
                            .stmt => |s2| brk2: {
                                switch (s2.data) {
                                    .s_function => |func| {
                                        break :brk2 p.e(E.Function{ .func = func.func }, s2.loc);
                                    },
                                    .s_class => |class| {
                                        break :brk2 p.e(class.class, s2.loc);
                                    },
                                    else => unreachable,
                                }
                            },
                        };
                        var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                        export_default_args[0] = p.@"module.exports"(expr.loc);
                        export_default_args[1] = expr;
                        stmt = p.s(S.SExpr{ .value = p.callRuntime(expr.loc, "__exportDefault", export_default_args) }, expr.loc);
                    }
                },
                .s_export_clause => |st| {
                    for (st.items) |item| {
                        try p.recordExport(item.alias_loc, item.alias, item.name.ref.?);
                    }

                    // export clauses simply disappear when we have HMR on, we use NamedExports to regenerate it at the end
                    if (p.options.features.hot_module_reloading) {
                        continue;
                    }
                },
                .s_export_star => |st| {
                    try p.import_records_for_current_part.append(allocator, st.import_record_index);

                    if (st.alias) |alias| {
                        // "export * as ns from 'path'"
                        try p.named_imports.put(st.namespace_ref, js_ast.NamedImport{
                            .alias = null,
                            .alias_is_star = true,
                            .alias_loc = alias.loc,
                            .namespace_ref = Ref.None,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(alias.loc, alias.original_name, st.namespace_ref);
                    } else {
                        // "export * from 'path'"
                        try p.export_star_import_records.append(allocator, st.import_record_index);
                    }
                },
                .s_export_from => |st| {
                    try p.import_records_for_current_part.append(allocator, st.import_record_index);

                    for (st.items) |item| {
                        const ref = item.name.ref orelse p.panic("Expected export from item to have a name {s}", .{st});
                        // Note that the imported alias is not item.Alias, which is the
                        // exported alias. This is somewhat confusing because each
                        // SExportFrom statement is basically SImport + SExportClause in one.
                        try p.named_imports.put(ref, js_ast.NamedImport{
                            .alias_is_star = false,
                            .alias = item.original_name,
                            .alias_loc = item.name.loc,
                            .namespace_ref = st.namespace_ref,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(item.name.loc, item.alias, ref);
                    }
                },
                else => {},
            }

            stmts[stmts_end] = stmt;
            stmts_end += 1;
        }
        scanner.stmts = stmts[0..stmts_end];
        return scanner;
    }
};

const StaticSymbolName = struct {
    internal: string,
    primary: string,
    backup: string,

    pub const List = struct {
        fn NewStaticSymbol(comptime basename: string) StaticSymbolName {
            return comptime StaticSymbolName{
                .internal = basename ++ "_" ++ std.fmt.comptimePrint("{x}", .{std.hash.Wyhash.hash(0, basename)}),
                .primary = basename,
                .backup = "_" ++ basename ++ "$",
            };
        }

        fn NewStaticSymbolWithBackup(comptime basename: string, comptime backup: string) StaticSymbolName {
            return comptime StaticSymbolName{
                .internal = basename ++ "_" ++ std.fmt.comptimePrint("{x}", .{std.hash.Wyhash.hash(0, basename)}),
                .primary = basename,
                .backup = backup,
            };
        }

        pub const jsx = NewStaticSymbol("jsx");
        pub const jsxs = NewStaticSymbol("jsxs");
        pub const ImportSource = NewStaticSymbol("JSX");
        pub const ClassicImportSource = NewStaticSymbol("JSXClassic");
        pub const jsxFilename = NewStaticSymbolWithBackup("fileName", "jsxFileName");
        pub const REACT_ELEMENT_TYPE = NewStaticSymbolWithBackup("$$typeof", "$$reactEl");
        pub const Symbol = NewStaticSymbolWithBackup("Symbol", "Symbol");
        pub const Factory = NewStaticSymbol("jsxEl");
        pub const Refresher = NewStaticSymbol("FastRefresh");
        pub const Fragment = NewStaticSymbol("JSXFrag");

        pub const __name = NewStaticSymbol("__name");
        pub const __toModule = NewStaticSymbol("__toModule");
        pub const __require = NewStaticSymbol("require");
        pub const __cJS2eSM = NewStaticSymbol("__cJS2eSM");
        pub const __export = NewStaticSymbol("__export");
        pub const __reExport = NewStaticSymbol("__reExport");
        pub const __load = NewStaticSymbol("__load");
        pub const @"$$lzy" = NewStaticSymbol("$$lzy");
        pub const __HMRModule = NewStaticSymbol("HMR");
        pub const __HMRClient = NewStaticSymbol("Bun");
        pub const __FastRefreshModule = NewStaticSymbol("FastHMR");
        pub const __FastRefreshRuntime = NewStaticSymbol("FastRefresh");

        pub const @"$$m" = NewStaticSymbol("$$m");

        pub const __exportValue = NewStaticSymbol("__exportValue");
        pub const __exportDefault = NewStaticSymbol("__exportDefault");
        pub const hmr = NewStaticSymbol("hmr");

        pub const insert = NewStaticSymbol("insert");
        pub const template = NewStaticSymbol("template");
        pub const wrap = NewStaticSymbol("wrap");
        pub const createComponent = NewStaticSymbol("createComponent");
        pub const setAttribute = NewStaticSymbol("setAttribute");
        pub const effect = NewStaticSymbol("effect");
        pub const delegateEvents = NewStaticSymbol("delegateEvents");
        pub const Solid = NewStaticSymbol("Solid");

        pub const __merge = NewStaticSymbol("__merge");
    };
};

pub const SideEffects = enum(u1) {
    could_have_side_effects,
    no_side_effects,

    pub const Result = struct {
        side_effects: SideEffects,
        ok: bool = false,
        value: bool = false,
    };

    pub fn canChangeStrictToLoose(lhs: Expr.Data, rhs: Expr.Data) bool {
        const left = lhs.knownPrimitive();
        const right = rhs.knownPrimitive();
        return left == right and left != .unknown and left != .mixed;
    }

    pub fn simplifyBoolean(p: anytype, expr: Expr) Expr {
        switch (expr.data) {
            .e_unary => |e| {
                if (e.op == .un_not) {
                    // "!!a" => "a"
                    if (e.value.data == .e_unary and e.value.data.e_unary.op == .un_not) {
                        return simplifyBoolean(p, e.value.data.e_unary.value);
                    }

                    e.value = simplifyBoolean(p, e.value);
                }
            },
            .e_binary => |e| {
                switch (e.op) {
                    .bin_logical_and => {
                        const effects = SideEffects.toBoolean(e.right.data);
                        if (effects.ok and effects.value and effects.side_effects == .no_side_effects) {
                            // "if (anything && truthyNoSideEffects)" => "if (anything)"
                            return e.left;
                        }
                    },
                    .bin_logical_or => {
                        const effects = SideEffects.toBoolean(e.right.data);
                        if (effects.ok and !effects.value and effects.side_effects == .no_side_effects) {
                            // "if (anything || falsyNoSideEffects)" => "if (anything)"
                            return e.left;
                        }
                    },
                    else => {},
                }
            },
            else => {},
        }

        return expr;
    }

    pub const toNumber = Expr.Data.toNumber;
    pub const typeof = Expr.Data.toTypeof;

    pub fn isPrimitiveToReorder(data: Expr.Data) bool {
        switch (data) {
            .e_null, .e_undefined, .e_string, .e_boolean, .e_number, .e_big_int => {
                return true;
            },
            else => {
                return false;
            },
        }
    }

    pub fn simpifyUnusedExpr(p: anytype, expr: Expr) ?Expr {
        switch (expr.data) {
            .e_null, .e_undefined, .e_missing, .e_boolean, .e_number, .e_big_int, .e_string, .e_this, .e_reg_exp, .e_function, .e_arrow, .e_import_meta => {
                return null;
            },

            .e_dot => |dot| {
                if (dot.can_be_removed_if_unused) {
                    return null;
                }
            },
            .e_identifier => |ident| {
                if (ident.must_keep_due_to_with_stmt) {
                    return expr;
                }

                if (ident.can_be_removed_if_unused or p.symbols.items[ident.ref.innerIndex()].kind != .unbound) {
                    return null;
                }
            },
            .e_if => |__if__| {
                __if__.yes = simpifyUnusedExpr(p, __if__.yes) orelse __if__.yes.toEmpty();
                __if__.no = simpifyUnusedExpr(p, __if__.no) orelse __if__.no.toEmpty();

                // "foo() ? 1 : 2" => "foo()"
                if (__if__.yes.isEmpty() and __if__.no.isEmpty()) {
                    return simpifyUnusedExpr(p, __if__.test_);
                }

                // "foo() ? 1 : bar()" => "foo() || bar()"
                if (__if__.yes.isEmpty()) {
                    return Expr.joinWithLeftAssociativeOp(
                        .bin_logical_or,
                        __if__.test_,
                        __if__.no,
                        p.allocator,
                    );
                }

                // "foo() ? bar() : 2" => "foo() && bar()"
                if (__if__.no.isEmpty()) {
                    return Expr.joinWithLeftAssociativeOp(
                        .bin_logical_and,
                        __if__.test_,
                        __if__.yes,
                        p.allocator,
                    );
                }
            },
            .e_unary => |un| {
                // These operators must not have any type conversions that can execute code
                // such as "toString" or "valueOf". They must also never throw any exceptions.
                switch (un.op) {
                    .un_void, .un_not => {
                        return simpifyUnusedExpr(p, un.value);
                    },
                    .un_typeof => {
                        // "typeof x" must not be transformed into if "x" since doing so could
                        // cause an exception to be thrown. Instead we can just remove it since
                        // "typeof x" is special-cased in the standard to never throw.
                        if (std.meta.activeTag(un.value.data) == .e_identifier) {
                            return null;
                        }

                        return simpifyUnusedExpr(p, un.value);
                    },

                    else => {},
                }
            },

            .e_call => |call| {

                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if (call.can_be_unwrapped_if_unused) {
                    if (call.args.len > 0) {
                        return Expr.joinAllWithCommaCallback(call.args.slice(), @TypeOf(p), p, simpifyUnusedExpr, p.allocator);
                    }
                }
            },

            .e_binary => |bin| {
                switch (bin.op) {
                    // These operators must not have any type conversions that can execute code
                    // such as "toString" or "valueOf". They must also never throw any exceptions.
                    .bin_strict_eq, .bin_strict_ne, .bin_comma => {
                        return Expr.joinWithComma(
                            simpifyUnusedExpr(p, bin.left) orelse bin.left.toEmpty(),
                            simpifyUnusedExpr(p, bin.right) orelse bin.right.toEmpty(),
                            p.allocator,
                        );
                    },

                    // We can simplify "==" and "!=" even though they can call "toString" and/or
                    // "valueOf" if we can statically determine that the types of both sides are
                    // primitives. In that case there won't be any chance for user-defined
                    // "toString" and/or "valueOf" to be called.
                    .bin_loose_eq,
                    .bin_loose_ne,
                    => {
                        if (isPrimitiveWithSideEffects(bin.left.data) and isPrimitiveWithSideEffects(bin.right.data)) {
                            return Expr.joinWithComma(simpifyUnusedExpr(p, bin.left) orelse bin.left.toEmpty(), simpifyUnusedExpr(p, bin.right) orelse bin.right.toEmpty(), p.allocator);
                        }
                    },

                    .bin_logical_and, .bin_logical_or, .bin_nullish_coalescing => {
                        bin.right = simpifyUnusedExpr(p, bin.right) orelse bin.right.toEmpty();
                        // Preserve short-circuit behavior: the left expression is only unused if
                        // the right expression can be completely removed. Otherwise, the left
                        // expression is important for the branch.

                        if (bin.right.isEmpty())
                            return simpifyUnusedExpr(p, bin.left);
                    },

                    else => {},
                }
            },

            .e_object => {
                // Arrays with "..." spread expressions can't be unwrapped because the
                // "..." triggers code evaluation via iterators. In that case, just trim
                // the other items instead and leave the array expression there.

                var properties_slice = expr.data.e_object.properties.slice();
                var end: usize = 0;
                var any_computed = false;
                for (properties_slice) |spread| {
                    end = 0;
                    any_computed = any_computed or spread.flags.contains(.is_computed);
                    if (spread.kind == .spread) {
                        // Spread properties must always be evaluated
                        for (properties_slice) |prop_| {
                            var prop = prop_;
                            if (prop_.kind != .spread) {
                                if (prop.value != null) {
                                    if (simpifyUnusedExpr(p, prop.value.?)) |value| {
                                        prop.value = value;
                                    } else if (!prop.flags.contains(.is_computed)) {
                                        continue;
                                    } else {
                                        prop.value = p.e(E.Number{ .value = 0.0 }, prop.value.?.loc);
                                    }
                                }
                            }

                            properties_slice[end] = prop_;
                            end += 1;
                        }

                        properties_slice = properties_slice[0..end];
                        expr.data.e_object.properties = G.Property.List.init(properties_slice);
                        return expr;
                    }
                }

                if (any_computed) {
                    // Otherwise, the object can be completely removed. We only need to keep any
                    // object properties with side effects. Apply this simplification recursively.
                    // for (properties_slice) |prop| {
                    //     if (prop.flags.is_computed) {
                    //         // Make sure "ToString" is still evaluated on the key

                    //     }
                    // }

                    // keep this for now because we need better test coverage to do this correctly
                    return expr;
                }

                return null;
            },
            .e_array => {
                var items = expr.data.e_array.items.slice();

                for (items) |item| {
                    if (item.data == .e_spread) {
                        var end: usize = 0;
                        for (items) |item__| {
                            var item_ = item__;
                            if (item_.data != .e_missing) {
                                items[end] = item_;
                                end += 1;
                            }

                            expr.data.e_array.items = ExprNodeList.init(items[0..end]);
                            return expr;
                        }
                    }
                }

                // Otherwise, the array can be completely removed. We only need to keep any
                // array items with side effects. Apply this simplification recursively.
                return Expr.joinAllWithCommaCallback(
                    items,
                    @TypeOf(p),
                    p,
                    simpifyUnusedExpr,
                    p.allocator,
                );
            },

            .e_new => |call| {
                // A constructor call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if (call.can_be_unwrapped_if_unused) {
                    if (call.args.len > 0) {
                        return Expr.joinAllWithCommaCallback(call.args.slice(), @TypeOf(p), p, simpifyUnusedExpr, p.allocator);
                    }
                }
            },
            else => {},
        }

        return expr;
    }

    fn findIdentifiers(binding: Binding, decls: *std.ArrayList(G.Decl)) void {
        switch (binding.data) {
            .b_identifier => {
                decls.append(.{ .binding = binding }) catch unreachable;
            },
            .b_array => |array| {
                for (array.items) |item| {
                    findIdentifiers(item.binding, decls);
                }
            },
            .b_object => |obj| {
                for (obj.properties) |item| {
                    findIdentifiers(item.value, decls);
                }
            },
            else => {},
        }
    }

    // If this is in a dead branch, then we want to trim as much dead code as we
    // can. Everything can be trimmed except for hoisted declarations ("var" and
    // "function"), which affect the parent scope. For example:
    //
    //   function foo() {
    //     if (false) { var x; }
    //     x = 1;
    //   }
    //
    // We can't trim the entire branch as dead or calling foo() will incorrectly
    // assign to a global variable instead.
    pub fn shouldKeepStmtInDeadControlFlow(stmt: Stmt, allocator: Allocator) bool {
        switch (stmt.data) {
            // Omit these statements entirely
            .s_empty, .s_expr, .s_throw, .s_return, .s_break, .s_continue, .s_class, .s_debugger => return false,

            .s_local => |local| {
                if (local.kind != .k_var) {
                    // Omit these statements entirely
                    return false;
                }

                // Omit everything except the identifiers

                // common case: single var foo = blah, don't need to allocate
                if (local.decls.len == 1 and local.decls[0].binding.data == .b_identifier) {
                    const prev = local.decls[0];
                    stmt.data.s_local.decls[0] = G.Decl{ .binding = prev.binding };
                    return true;
                }

                var decls = std.ArrayList(G.Decl).initCapacity(allocator, local.decls.len) catch unreachable;
                for (local.decls) |decl| {
                    findIdentifiers(decl.binding, &decls);
                }

                local.decls = decls.toOwnedSlice();
                return true;
            },

            .s_block => |block| {
                for (block.stmts) |child| {
                    if (shouldKeepStmtInDeadControlFlow(child, allocator)) {
                        return true;
                    }
                }

                return false;
            },

            .s_if => |_if_| {
                if (shouldKeepStmtInDeadControlFlow(_if_.yes, allocator)) {
                    return true;
                }

                const no = _if_.no orelse return false;

                return shouldKeepStmtInDeadControlFlow(no, allocator);
            },

            .s_while => {
                return shouldKeepStmtInDeadControlFlow(stmt.data.s_while.body, allocator);
            },

            .s_do_while => {
                return shouldKeepStmtInDeadControlFlow(stmt.data.s_do_while.body, allocator);
            },

            .s_for => |__for__| {
                if (__for__.init) |init_| {
                    if (shouldKeepStmtInDeadControlFlow(init_, allocator)) {
                        return true;
                    }
                }

                return shouldKeepStmtInDeadControlFlow(__for__.body, allocator);
            },

            .s_for_in => |__for__| {
                return shouldKeepStmtInDeadControlFlow(__for__.init, allocator) or shouldKeepStmtInDeadControlFlow(__for__.body, allocator);
            },

            .s_for_of => |__for__| {
                return shouldKeepStmtInDeadControlFlow(__for__.init, allocator) or shouldKeepStmtInDeadControlFlow(__for__.body, allocator);
            },

            .s_label => |label| {
                return shouldKeepStmtInDeadControlFlow(label.stmt, allocator);
            },
            else => return true,
        }
    }

    // Returns true if this expression is known to result in a primitive value (i.e.
    // null, undefined, boolean, number, bigint, or string), even if the expression
    // cannot be removed due to side effects.
    pub fn isPrimitiveWithSideEffects(data: Expr.Data) bool {
        switch (data) {
            .e_null, .e_undefined, .e_boolean, .e_number, .e_big_int, .e_string => {
                return true;
            },
            .e_unary => |e| {
                switch (e.op) {
                    // number or bigint
                    .un_pos,
                    .un_neg,
                    .un_cpl,
                    .un_pre_dec,
                    .un_pre_inc,
                    .un_post_dec,
                    .un_post_inc,
                    // boolean
                    .un_not,
                    .un_delete,
                    // undefined
                    .un_void,
                    // string
                    .un_typeof,
                    => {
                        return true;
                    },
                    else => {},
                }
            },
            .e_binary => |e| {
                switch (e.op) {
                    // boolean
                    .bin_lt,
                    .bin_le,
                    .bin_gt,
                    .bin_ge,
                    .bin_in,
                    .bin_instanceof,
                    .bin_loose_eq,
                    .bin_loose_ne,
                    .bin_strict_eq,
                    .bin_strict_ne,
                    // string, number, or bigint
                    .bin_add,
                    .bin_add_assign,
                    // number or bigint
                    .bin_sub,
                    .bin_mul,
                    .bin_div,
                    .bin_rem,
                    .bin_pow,
                    .bin_sub_assign,
                    .bin_mul_assign,
                    .bin_div_assign,
                    .bin_rem_assign,
                    .bin_pow_assign,
                    .bin_shl,
                    .bin_shr,
                    .bin_u_shr,
                    .bin_shl_assign,
                    .bin_shr_assign,
                    .bin_u_shr_assign,
                    .bin_bitwise_or,
                    .bin_bitwise_and,
                    .bin_bitwise_xor,
                    .bin_bitwise_or_assign,
                    .bin_bitwise_and_assign,
                    .bin_bitwise_xor_assign,
                    => {
                        return true;
                    },

                    // These always return one of the arguments unmodified
                    .bin_logical_and,
                    .bin_logical_or,
                    .bin_nullish_coalescing,
                    .bin_logical_and_assign,
                    .bin_logical_or_assign,
                    .bin_nullish_coalescing_assign,
                    => {
                        return isPrimitiveWithSideEffects(e.left.data) and isPrimitiveWithSideEffects(e.right.data);
                    },
                    .bin_comma => {
                        return isPrimitiveWithSideEffects(e.right.data);
                    },
                    else => {},
                }
            },
            .e_if => |e| {
                return isPrimitiveWithSideEffects(e.yes.data) and isPrimitiveWithSideEffects(e.no.data);
            },
            else => {},
        }
        return false;
    }

    pub const toTypeOf = Expr.Data.typeof;

    pub fn toNullOrUndefined(exp: Expr.Data) Result {
        switch (exp) {
            // Never null or undefined
            .e_boolean, .e_number, .e_string, .e_reg_exp, .e_function, .e_arrow, .e_big_int => {
                return Result{ .value = false, .side_effects = SideEffects.no_side_effects, .ok = true };
            },

            .e_object, .e_array, .e_class => {
                return Result{ .value = false, .side_effects = .could_have_side_effects, .ok = true };
            },

            // always anull or undefined
            .e_null, .e_undefined => {
                return Result{ .value = true, .side_effects = .no_side_effects, .ok = true };
            },

            .e_unary => |e| {
                switch (e.op) {
                    // Always number or bigint
                    .un_pos,
                    .un_neg,
                    .un_cpl,
                    .un_pre_dec,
                    .un_pre_inc,
                    .un_post_dec,
                    .un_post_inc,

                    // Always boolean
                    .un_not,
                    .un_typeof,
                    .un_delete,
                    => {
                        return Result{ .ok = true, .value = false, .side_effects = SideEffects.could_have_side_effects };
                    },

                    // Always undefined
                    .un_void => {
                        return Result{ .value = true, .side_effects = .could_have_side_effects, .ok = true };
                    },

                    else => {},
                }
            },

            .e_binary => |e| {
                switch (e.op) {
                    // always string or number or bigint
                    .bin_add,
                    .bin_add_assign,
                    // always number or bigint
                    .bin_sub,
                    .bin_mul,
                    .bin_div,
                    .bin_rem,
                    .bin_pow,
                    .bin_sub_assign,
                    .bin_mul_assign,
                    .bin_div_assign,
                    .bin_rem_assign,
                    .bin_pow_assign,
                    .bin_shl,
                    .bin_shr,
                    .bin_u_shr,
                    .bin_shl_assign,
                    .bin_shr_assign,
                    .bin_u_shr_assign,
                    .bin_bitwise_or,
                    .bin_bitwise_and,
                    .bin_bitwise_xor,
                    .bin_bitwise_or_assign,
                    .bin_bitwise_and_assign,
                    .bin_bitwise_xor_assign,
                    // always boolean
                    .bin_lt,
                    .bin_le,
                    .bin_gt,
                    .bin_ge,
                    .bin_in,
                    .bin_instanceof,
                    .bin_loose_eq,
                    .bin_loose_ne,
                    .bin_strict_eq,
                    .bin_strict_ne,
                    => {
                        return Result{ .ok = true, .value = false, .side_effects = SideEffects.could_have_side_effects };
                    },

                    .bin_comma => {
                        const res = toNullOrUndefined(e.right.data);
                        if (res.ok) {
                            return Result{ .ok = true, .value = res.value, .side_effects = SideEffects.could_have_side_effects };
                        }
                    },
                    else => {},
                }
            },
            else => {},
        }

        return Result{ .ok = false, .value = false, .side_effects = SideEffects.could_have_side_effects };
    }

    pub fn toBoolean(exp: Expr.Data) Result {
        switch (exp) {
            .e_null, .e_undefined => {
                return Result{ .ok = true, .value = false, .side_effects = .no_side_effects };
            },
            .e_boolean => |e| {
                return Result{ .ok = true, .value = e.value, .side_effects = .no_side_effects };
            },
            .e_number => |e| {
                return Result{ .ok = true, .value = e.value != 0.0 and !std.math.isNan(e.value), .side_effects = .no_side_effects };
            },
            .e_big_int => |e| {
                return Result{ .ok = true, .value = !strings.eqlComptime(e.value, "0"), .side_effects = .no_side_effects };
            },
            .e_string => |e| {
                return Result{ .ok = true, .value = e.isPresent(), .side_effects = .no_side_effects };
            },
            .e_function, .e_arrow, .e_reg_exp => {
                return Result{ .ok = true, .value = true, .side_effects = .no_side_effects };
            },
            .e_object, .e_array, .e_class => {
                return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
            },
            .e_unary => |e_| {
                switch (e_.op) {
                    .un_void => {
                        return Result{ .ok = true, .value = false, .side_effects = .could_have_side_effects };
                    },
                    .un_typeof => {
                        // Never an empty string

                        return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
                    },
                    .un_not => {
                        var result = toBoolean(e_.value.data);
                        if (result.ok) {
                            result.value = !result.value;
                            return result;
                        }
                    },
                    else => {},
                }
            },
            .e_binary => |e_| {
                switch (e_.op) {
                    .bin_logical_or => {
                        // "anything || truthy" is truthy
                        const result = toBoolean(e_.right.data);
                        if (result.value and result.ok) {
                            return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
                        }
                    },
                    .bin_logical_and => {
                        // "anything && falsy" is falsy
                        const result = toBoolean(e_.right.data);
                        if (!result.value and result.ok) {
                            return Result{ .ok = true, .value = false, .side_effects = .could_have_side_effects };
                        }
                    },
                    .bin_comma => {
                        // "anything, truthy/falsy" is truthy/falsy
                        var result = toBoolean(e_.right.data);
                        if (result.ok) {
                            result.side_effects = .could_have_side_effects;
                            return result;
                        }
                    },
                    else => {},
                }
            },
            else => {},
        }

        return Result{ .ok = false, .value = false, .side_effects = SideEffects.could_have_side_effects };
    }
};

const ExprOrLetStmt = struct {
    stmt_or_expr: js_ast.StmtOrExpr,
    decls: []G.Decl = &([_]G.Decl{}),
};

const FunctionKind = enum { stmt, expr };

const AsyncPrefixExpression = enum(u2) {
    none,
    is_yield,
    is_async,
    is_await,

    const map = ComptimeStringMap(AsyncPrefixExpression, .{
        .{ "yield", .is_yield },
        .{ "await", .is_await },
        .{ "async", .is_async },
    });

    pub fn find(ident: string) AsyncPrefixExpression {
        return map.get(ident) orelse .none;
    }
};

const IdentifierOpts = struct {
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,
    is_delete_target: bool = false,
    was_originally_identifier: bool = false,
};

fn statementCaresAboutScope(stmt: Stmt) bool {
    switch (stmt.data) {
        .s_block,
        .s_empty,
        .s_debugger,
        .s_expr,
        .s_if,
        .s_for,
        .s_for_in,
        .s_for_of,
        .s_do_while,
        .s_while,
        .s_with,
        .s_try,
        .s_switch,
        .s_return,
        .s_throw,
        .s_break,
        .s_continue,
        .s_directive,
        => {
            return false;
        },
        // This is technically incorrect.
        // var does not care about the scope
        // However, we are choosing _not_ to relocate vars to the top level

        .s_local => |local| {
            return local.kind != .k_var;
        },
        else => {
            return true;
        },
    }
}

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
// This can sometimes show up on benchmarks as a small thing.
fn isEvalOrArguments(name: string) bool {
    return strings.eqlComptime(name, "eval") or strings.eqlComptime(name, "arguments");
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
    Global.panic("Not implemented yet!!", .{});
}

const ExprBindingTuple = struct {
    expr: ?ExprNodeIndex = null,
    binding: ?Binding = null,
};

const TempRef = struct {
    ref: Ref,
    value: ?Expr = null,
};

const ImportNamespaceCallOrConstruct = struct {
    ref: Ref,
    is_construct: bool = false,
};

const ThenCatchChain = struct {
    next_target: js_ast.Expr.Data,
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

const Map = _hash_map.AutoHashMapUnmanaged;

const List = std.ArrayListUnmanaged;
const ListManaged = std.ArrayList;
const InvalidLoc = struct {
    loc: logger.Loc,
    kind: Tag = Tag.unknown,

    pub const Tag = enum {
        spread,
        parenthese,
        getter,
        setter,
        method,
        unknown,
    };

    pub fn addError(loc: InvalidLoc, log: *logger.Log, source: *const logger.Source) void {
        @setCold(true);
        const text = switch (loc.kind) {
            .spread => "Unexpected trailing comma after rest element",
            .parenthese => "Unexpected parentheses in binding pattern",
            .getter => "Unexpected getter in binding pattern",
            .setter => "Unexpected setter in binding pattern",
            .method => "Unexpected method in binding pattern",
            .unknown => "Invalid binding pattern",
        };
        log.addError(source, loc.loc, text) catch unreachable;
    }
};
const LocList = ListManaged(InvalidLoc);
const StmtList = ListManaged(Stmt);

// This hash table is used every time we parse function args
// Rather than allocating a new hash table each time, we can just reuse the previous allocation

const StringVoidMap = struct {
    allocator: Allocator,
    map: std.StringHashMapUnmanaged(void) = std.StringHashMapUnmanaged(void){},

    /// Returns true if the map already contained the given key.
    pub fn getOrPutContains(this: *StringVoidMap, key: string) bool {
        const entry = this.map.getOrPut(this.allocator, key) catch unreachable;
        return entry.found_existing;
    }

    pub fn contains(this: *StringVoidMap, key: string) bool {
        return this.map.contains(key);
    }

    fn init(allocator: Allocator) anyerror!StringVoidMap {
        return StringVoidMap{ .allocator = allocator };
    }

    pub fn reset(this: *StringVoidMap) void {
        // We must reset or the hash table will contain invalid pointers
        this.map.clearRetainingCapacity();
    }

    pub inline fn get(allocator: Allocator) *Node {
        return Pool.get(allocator);
    }

    pub inline fn release(node: *Node) void {
        Pool.release(node);
    }

    pub const Pool = ObjectPool(StringVoidMap, init, true, 32);
    pub const Node = Pool.Node;
};
const RefCtx = @import("./ast/base.zig").RefCtx;
const SymbolUseMap = std.HashMapUnmanaged(Ref, js_ast.Symbol.Use, RefCtx, 80);
const StringBoolMap = std.StringHashMapUnmanaged(bool);
const RefMap = std.HashMapUnmanaged(Ref, void, RefCtx, 80);
const RefArrayMap = std.ArrayHashMapUnmanaged(Ref, void, @import("./ast/base.zig").RefHashCtx, false);

const RefRefMap = std.HashMapUnmanaged(Ref, Ref, RefCtx, 80);
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

const AwaitOrYield = enum(u3) {
    allow_ident,
    allow_expr,
    forbid_all,
};

// This is function-specific information used during parsing. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataParse = struct {
    async_range: logger.Range = logger.Range.None,
    allow_await: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_yield: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_super_call: bool = false,
    allow_super_property: bool = false,
    is_top_level: bool = false,
    is_constructor: bool = false,
    is_typescript_declare: bool = false,

    is_return_disallowed: bool = false,
    is_this_disallowed: bool = false,

    has_async_range: bool = false,
    arrow_arg_errors: DeferredArrowArgErrors = DeferredArrowArgErrors{},
    track_arrow_arg_errors: bool = false,

    // In TypeScript, forward declarations of functions have no bodies
    allow_missing_body_for_type_script: bool = false,

    // Allow TypeScript decorators in function arguments
    allow_ts_decorators: bool = false,

    pub fn i() FnOrArrowDataParse {
        return FnOrArrowDataParse{ .allow_await = AwaitOrYield.forbid_all };
    }
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataVisit = struct {
    // super_index_ref: ?*Ref = null,

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
    arguments_ref: ?Ref = null,

    // Arrow functions don't capture the value of "this" and "arguments". Instead,
    // the values are inherited from the surrounding context. If arrow functions
    // are turned into regular functions due to lowering, we will need to generate
    // local variables to capture these values so they are preserved correctly.
    this_capture_ref: ?Ref = null,
    arguments_capture_ref: ?Ref = null,

    // Inside a static class property initializer, "this" expressions should be
    // replaced with the class name.
    this_class_static_ref: ?Ref = null,

    // If we're inside an async arrow function and async functions are not
    // supported, then we will have to convert that arrow function to a generator
    // function. That means references to "arguments" inside the arrow function
    // will have to reference a captured variable instead of the real variable.
    is_inside_async_arrow_fn: bool = false,

    // If false, disallow "new.target" expressions. We disallow all "new.target"
    // expressions at the top-level of the file (i.e. not inside a function or
    // a class field). Technically since CommonJS files are wrapped in a function
    // you can use "new.target" in node as an alias for "undefined" but we don't
    // support that.
    is_new_target_allowed: bool = false,

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
        to.invalid_expr_default_value = self.invalid_expr_default_value orelse to.invalid_expr_default_value;
        to.invalid_expr_after_question = self.invalid_expr_after_question orelse to.invalid_expr_after_question;
        to.array_spread_feature = self.array_spread_feature orelse to.array_spread_feature;
    }

    const None = DeferredErrors{
        .invalid_expr_default_value = null,
        .invalid_expr_after_question = null,
        .array_spread_feature = null,
    };
};

const ImportClause = struct {
    items: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
    had_type_only_imports: bool = false,
};

const ModuleType = enum { esm };

const PropertyOpts = struct {
    async_range: logger.Range = logger.Range.None,
    declare_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    is_generator: bool = false,

    // Class-related options
    is_static: bool = false,
    is_class: bool = false,
    class_has_extends: bool = false,
    allow_ts_decorators: bool = false,
    ts_decorators: []Expr = &[_]Expr{},
};

pub const ScanPassResult = struct {
    pub const ParsePassSymbolUse = struct { ref: Ref, used: bool = false, import_record_index: u32 };
    pub const NamespaceCounter = struct { count: u16, import_record_index: u32 };
    pub const ParsePassSymbolUsageMap = std.StringArrayHashMap(ParsePassSymbolUse);
    import_records: ListManaged(ImportRecord),
    named_imports: js_ast.Ast.NamedImports,
    used_symbols: ParsePassSymbolUsageMap,
    import_records_to_keep: ListManaged(u32),
    approximate_newline_count: usize = 0,

    pub fn init(allocator: Allocator) ScanPassResult {
        return .{
            .import_records = ListManaged(ImportRecord).init(allocator),
            .named_imports = js_ast.Ast.NamedImports.init(allocator),
            .used_symbols = ParsePassSymbolUsageMap.init(allocator),
            .import_records_to_keep = ListManaged(u32).init(allocator),
            .approximate_newline_count = 0,
        };
    }

    pub fn reset(scan_pass: *ScanPassResult) void {
        scan_pass.named_imports.clearRetainingCapacity();
        scan_pass.import_records.shrinkRetainingCapacity(0);
        scan_pass.used_symbols.clearRetainingCapacity();
        scan_pass.approximate_newline_count = 0;
    }
};

fn MacroContextType() type {
    if (comptime Environment.isWasm) {
        return ?*anyopaque;
    }

    return js_ast.Macro.MacroContext;
}

pub const Parser = struct {
    options: Options,
    lexer: js_lexer.Lexer,
    log: *logger.Log,
    source: *const logger.Source,
    define: *Define,
    allocator: Allocator,

    pub const Options = struct {
        jsx: options.JSX.Pragma,
        can_import_from_bundle: bool = false,
        ts: bool = false,
        keep_names: bool = true,
        omit_runtime_for_tests: bool = false,
        ignore_dce_annotations: bool = false,
        preserve_unused_imports_ts: bool = false,
        use_define_for_class_fields: bool = false,
        suppress_warnings_about_weird_code: bool = true,
        filepath_hash_for_hmr: u32 = 0,
        features: RuntimeFeatures = RuntimeFeatures{},

        tree_shaking: bool = false,

        macro_context: *MacroContextType() = undefined,

        warn_about_unbundled_modules: bool = true,

        // Used when bundling node_modules
        enable_bundling: bool = false,
        transform_require_to_import: bool = true,

        moduleType: ModuleType = ModuleType.esm,

        pub fn init(jsx: options.JSX.Pragma, loader: options.Loader) Options {
            var opts = Options{
                .ts = loader.isTypeScript(),

                .jsx = jsx,
            };
            opts.jsx.parse = loader.isJSX();
            return opts;
        }
    };

    pub fn scanImports(self: *Parser, scan_pass: *ScanPassResult) !void {
        if (self.options.ts and self.options.jsx.parse) {
            return try self._scanImports(TSXImportScanner, scan_pass);
        } else if (self.options.ts) {
            return try self._scanImports(TypeScriptImportScanner, scan_pass);
        } else if (self.options.jsx.parse) {
            return try self._scanImports(JSXImportScanner, scan_pass);
        } else {
            return try self._scanImports(JavaScriptImportScanner, scan_pass);
        }
    }

    fn _scanImports(self: *Parser, comptime ParserType: type, scan_pass: *ScanPassResult) !void {
        var p: ParserType = undefined;

        try ParserType.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options, &p);
        p.import_records = &scan_pass.import_records;
        p.named_imports = &scan_pass.named_imports;

        // The problem with our scan pass approach is type-only imports.
        // We don't have accurate symbol counts.
        // So we don't have a good way to distuingish between a type-only import and not.
        if (comptime ParserType.parser_features.typescript) {
            p.parse_pass_symbol_uses = &scan_pass.used_symbols;
        }

        // Parse the file in the first pass, but do not bind symbols
        var opts = ParseStatementOptions{ .is_module_scope = true };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        _ = try p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts);

        //
        if (comptime ParserType.parser_features.typescript) {
            for (scan_pass.import_records.items) |*import_record| {
                // Mark everything as unused
                // Except:
                // - export * as ns from 'foo';
                // - export * from 'foo';
                // - import 'foo';
                // - import("foo")
                // - require("foo")
                import_record.is_unused = import_record.is_unused or
                    (import_record.kind == .stmt and
                    !import_record.was_originally_bare_import and
                    !import_record.calls_run_time_re_export_fn);
            }

            var iter = scan_pass.used_symbols.iterator();
            while (iter.next()) |entry| {
                const val = entry.value_ptr;
                if (val.used) {
                    scan_pass.import_records.items[val.import_record_index].is_unused = false;
                }
            }
        }

        // Symbol use counts are unavailable
        // So we say "did we parse any JSX?"
        // if yes, just automatically add the import so that .bun knows to include the file.
        if (self.options.jsx.parse and p.needs_jsx_import) {
            _ = p.addImportRecord(
                .require,
                logger.Loc{ .start = 0 },
                p.options.jsx.import_source,
            );
            // Ensure we have both classic and automatic
            // This is to handle cases where they use fragments in the automatic runtime
            _ = p.addImportRecord(
                .require,
                logger.Loc{ .start = 0 },
                p.options.jsx.classic_import_source,
            );
        }

        scan_pass.approximate_newline_count = p.lexer.approximate_newline_count;
    }

    pub fn parse(self: *Parser) !js_ast.Result {
        if (comptime Environment.isWasm) {
            self.options.ts = true;
            self.options.jsx.parse = true;
            // if (self.options.features.is_macro_runtime) {
            //     return try self._parse(TSParserMacro);
            // }

            return try self._parse(TSXParser);
        }

        if (self.options.ts and self.options.features.is_macro_runtime) return try self._parse(TSParserMacro);
        if (!self.options.ts and self.options.features.is_macro_runtime) return try self._parse(JSParserMacro);

        if (self.options.ts and self.options.jsx.parse) {
            return if (self.options.jsx.runtime != .solid) try self._parse(TSXParser) else try self._parse(SolidTSXParser);
        } else if (self.options.ts) {
            return try self._parse(TypeScriptParser);
        } else if (self.options.jsx.parse) {
            return if (self.options.jsx.runtime != .solid) try self._parse(JSXParser) else try self._parse(SolidJSXParser);
        } else {
            return try self._parse(JavaScriptParser);
        }
    }

    fn _parse(self: *Parser, comptime ParserType: type) !js_ast.Result {
        var p: ParserType = undefined;
        try ParserType.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options, &p);
        p.should_fold_numeric_constants = self.options.features.should_fold_numeric_constants;
        defer p.lexer.deinit();
        var result: js_ast.Result = undefined;

        // defer {
        //     if (p.allocated_names_pool) |pool| {
        //         pool.data = p.allocated_names;
        //         pool.release();
        //         p.allocated_names_pool = null;
        //     }
        // }

        // Consume a leading hashbang comment
        var hashbang: string = "";
        if (p.lexer.token == .t_hashbang) {
            hashbang = p.lexer.identifier;
            try p.lexer.next();
        }

        // Parse the file in the first pass, but do not bind symbols
        var opts = ParseStatementOptions{ .is_module_scope = true };

        // Parsing seems to take around 2x as much time as visiting.
        // Which makes sense.
        // June 4: "Parsing took: 18028000"
        // June 4: "Rest of this took: 8003000"
        const stmts = try p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts);

        try p.prepareForVisitPass();

        // ESM is always strict mode. I don't think we need this.
        // // Strip off a leading "use strict" directive when not bundling
        // var directive = "";

        // Insert a variable for "import.meta" at the top of the file if it was used.
        // We don't need to worry about "use strict" directives because this only
        // happens when bundling, in which case we are flatting the module scopes of
        // all modules together anyway so such directives are meaningless.
        // if (!p.import_meta_ref.isSourceIndexNull()) {
        //     // heap so it lives beyond this function call
        //     var decls = try p.allocator.alloc(G.Decl, 1);
        //     decls[0] = Decl{ .binding = p.b(B.Identifier{
        //         .ref = p.import_meta_ref,
        //     }, logger.Loc.Empty), .value = p.e(E.Object{}, logger.Loc.Empty) };
        //     var importMetaStatement = p.s(S.Local{
        //         .kind = .k_const,
        //         .decls = decls,
        //     }, logger.Loc.Empty);
        // }

        var before = ListManaged(js_ast.Part).init(p.allocator);
        var after = ListManaged(js_ast.Part).init(p.allocator);
        var parts = ListManaged(js_ast.Part).init(p.allocator);

        if (!p.options.tree_shaking) {
            try p.appendPart(&parts, stmts);
        } else {
            // When tree shaking is enabled, each top-level statement is potentially a separate part.
            for (stmts) |stmt| {
                switch (stmt.data) {
                    .s_local => |local| {
                        if (local.decls.len > 1) {
                            for (local.decls) |decl| {
                                var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                                sliced.items.len = 1;
                                var _local = local.*;
                                var list = try ListManaged(G.Decl).initCapacity(p.allocator, 1);
                                list.items.len = 1;
                                list.items[0] = decl;
                                _local.decls = list.items;
                                sliced.items[0] = p.s(_local, stmt.loc);
                                try p.appendPart(&parts, sliced.items);
                            }
                        } else {
                            var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                            sliced.items.len = 1;
                            sliced.items[0] = stmt;
                            try p.appendPart(&parts, sliced.items);
                        }
                    },
                    else => {
                        var sliced = try ListManaged(Stmt).initCapacity(p.allocator, 1);
                        sliced.items.len = 1;
                        sliced.items[0] = stmt;
                        try p.appendPart(&parts, sliced.items);
                    },
                }
            }
        }

        const uses_dirname = p.symbols.items[p.dirname_ref.innerIndex()].use_count_estimate > 0;
        const uses_filename = p.symbols.items[p.filename_ref.innerIndex()].use_count_estimate > 0;

        if (uses_dirname or uses_filename) {
            const count = @as(usize, @boolToInt(uses_dirname)) + @as(usize, @boolToInt(uses_filename));
            var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, count);
            var decls = p.allocator.alloc(G.Decl, count) catch unreachable;
            if (uses_dirname) {
                decls[0] = .{
                    .binding = p.b(B.Identifier{ .ref = p.dirname_ref }, logger.Loc.Empty),
                    .value = p.e(
                        // TODO: test UTF-8 file paths
                        E.String.init(p.source.path.name.dir),
                        logger.Loc.Empty,
                    ),
                };
                declared_symbols[0] = .{ .ref = p.dirname_ref, .is_top_level = true };
            }
            if (uses_filename) {
                decls[@as(usize, @boolToInt(uses_dirname))] = .{
                    .binding = p.b(B.Identifier{ .ref = p.filename_ref }, logger.Loc.Empty),
                    .value = p.e(
                        E.String.init(p.source.path.text),
                        logger.Loc.Empty,
                    ),
                };
                declared_symbols[@as(usize, @boolToInt(uses_dirname))] = .{ .ref = p.filename_ref, .is_top_level = true };
            }

            // TODO: DeclaredSymbol
            var part_stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
            part_stmts[0] = p.s(S.Local{
                .kind = .k_var,
                .decls = decls,
            }, logger.Loc.Empty);
            before.append(js_ast.Part{
                .stmts = part_stmts,
                .declared_symbols = declared_symbols,
                .tag = .dirname_filename,
            }) catch unreachable;
        }

        var did_import_fast_refresh = false;

        // Analyze cross-part dependencies for tree shaking and code splitting
        var exports_kind = js_ast.ExportsKind.none;
        const uses_exports_ref = p.symbols.items[p.exports_ref.innerIndex()].use_count_estimate > 0;
        const uses_module_ref = p.symbols.items[p.module_ref.innerIndex()].use_count_estimate > 0;

        var wrapper_expr: ?Expr = null;

        if ((p.es6_export_keyword.len > 0 or p.top_level_await_keyword.len > 0) and !uses_exports_ref) {
            exports_kind = .esm;
        } else if (uses_exports_ref or uses_module_ref or p.has_top_level_return) {
            exports_kind = .cjs;
            if (p.options.transform_require_to_import or (p.options.features.dynamic_require and !p.options.enable_bundling)) {
                var args = p.allocator.alloc(Expr, 2) catch unreachable;

                if (p.runtime_imports.__exportDefault == null and p.has_export_default) {
                    p.runtime_imports.__exportDefault = try p.declareGeneratedSymbol(.other, "__exportDefault");
                    p.resolveGeneratedSymbol(&p.runtime_imports.__exportDefault.?);
                }

                wrapper_expr = p.callRuntime(logger.Loc.Empty, "__cJS2eSM", args);
                p.resolveGeneratedSymbol(&p.runtime_imports.__cJS2eSM.?);

                // Disable HMR if we're wrapping it in CommonJS
                // It's technically possible to support this.
                // But we need to cut scope for the v0.
                p.options.features.hot_module_reloading = false;
                p.options.features.react_fast_refresh = false;
                p.runtime_imports.__HMRModule = null;
                p.runtime_imports.__FastRefreshModule = null;
                p.runtime_imports.__FastRefreshRuntime = null;
                p.runtime_imports.__HMRClient = null;
            }
        } else {
            exports_kind = .esm;
        }

        // Auto-import & post-process JSX
        switch (comptime ParserType.jsx_transform_type) {
            .react => {
                const jsx_filename_symbol = if (p.options.jsx.development)
                    p.symbols.items[p.jsx_filename.ref.innerIndex()]
                else
                    Symbol{ .original_name = "" };

                {
                    const jsx_symbol = p.symbols.items[p.jsx_runtime.ref.innerIndex()];
                    const jsx_static_symbol = p.symbols.items[p.jsxs_runtime.ref.innerIndex()];
                    const jsx_fragment_symbol = p.symbols.items[p.jsx_fragment.ref.innerIndex()];
                    const jsx_factory_symbol = p.symbols.items[p.jsx_factory.ref.innerIndex()];

                    // Currently, React (and most node_modules) ship a CJS version or a UMD version
                    // but we should assume that it'll pretty much always be CJS
                    // Given that, we can't directly call import {jsxDEV} from 'react';
                    // Instead, we must call require("react").default.jsxDEV
                    // So a jsx_symbol usage means a jsx_factory_symbol usage
                    // This is kind of a broken way of doing it because it wouldn't work if it was more than one level deep
                    if (FeatureFlags.jsx_runtime_is_cjs) {
                        if (jsx_symbol.use_count_estimate > 0 or jsx_static_symbol.use_count_estimate > 0) {
                            p.recordUsage(p.jsx_automatic.ref);
                        }

                        if (jsx_fragment_symbol.use_count_estimate > 0) {
                            p.recordUsage(p.jsx_classic.ref);
                        }

                        if (jsx_factory_symbol.use_count_estimate > 0) {
                            p.recordUsage(p.jsx_classic.ref);
                        }
                    }
                }

                p.resolveStaticJSXSymbols();

                if (p.options.features.auto_import_jsx) {
                    const jsx_classic_symbol = p.symbols.items[p.jsx_classic.ref.innerIndex()];
                    const jsx_automatic_symbol = p.symbols.items[p.jsx_automatic.ref.innerIndex()];
                    const react_element_symbol = if (p.options.features.jsx_optimization_inline) p.symbols.items[p.react_element_type.ref.innerIndex()] else Symbol{
                        .original_name = "IF_YOU_SEE_THIS_ITS_A_BUG_IN_BUN_WHERE_REACT_ELEMENT_SYMBOL_IS_BEING_ADDED_WHEN_IT_SHOULDNT_BE_PLEASE_REPORT_IT",
                    };

                    // JSX auto-imports
                    // The classic runtime is a different import than the main import
                    // There are cases where you can use both JSX runtimes in the same file.
                    // 1. If you use a spread operator like this: <div foo bar key="foo" {...props} baz />
                    // 2. If you use a React.Fragment
                    // So we have to support both.
                    if (jsx_classic_symbol.use_count_estimate > 0 or jsx_automatic_symbol.use_count_estimate > 0 or react_element_symbol.use_count_estimate > 0) {
                        // These must unfortunately be copied
                        // p.symbols may grow during this scope
                        // if it grows, the previous pointers are invalidated
                        const jsx_symbol = p.symbols.items[p.jsx_runtime.ref.innerIndex()];
                        const jsx_static_symbol = p.symbols.items[p.jsxs_runtime.ref.innerIndex()];
                        const jsx_fragment_symbol = p.symbols.items[p.jsx_fragment.ref.innerIndex()];
                        const jsx_factory_symbol = p.symbols.items[p.jsx_factory.ref.innerIndex()];

                        const classic_namespace_ref = p.jsx_classic.ref;
                        const automatic_namespace_ref = p.jsx_automatic.ref;

                        const decls_count: u32 =
                            // "REACT_ELEMENT_TYPE"
                            // "Symbol.for('react.element')"
                            @intCast(u32, @boolToInt(react_element_symbol.use_count_estimate > 0)) * 2 +

                            // "JSX"
                            @intCast(u32, @boolToInt(jsx_symbol.use_count_estimate > 0)) * 2 +
                            @intCast(u32, @boolToInt(jsx_static_symbol.use_count_estimate > 0)) * 2 +
                            @intCast(u32, @boolToInt(jsx_factory_symbol.use_count_estimate > 0)) +
                            @intCast(u32, @boolToInt(jsx_fragment_symbol.use_count_estimate > 0)) +
                            @intCast(u32, @boolToInt(jsx_filename_symbol.use_count_estimate > 0));

                        const imports_count =
                            @intCast(u32, @boolToInt(jsx_symbol.use_count_estimate > 0)) +
                            @intCast(u32, @boolToInt(jsx_classic_symbol.use_count_estimate > 0)) +
                            @intCast(u32, @boolToInt(jsx_fragment_symbol.use_count_estimate > 0)) +
                            @intCast(u32, @boolToInt(p.options.features.react_fast_refresh)) +
                            @intCast(u32, @boolToInt(jsx_static_symbol.use_count_estimate > 0));
                        const stmts_count = imports_count + 1;
                        const symbols_count: u32 = imports_count + decls_count;
                        const loc = logger.Loc{ .start = 0 };

                        // Preallocate everything we'll need here
                        var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, symbols_count);
                        var decls = try p.allocator.alloc(G.Decl, decls_count);
                        var jsx_part_stmts = try p.allocator.alloc(Stmt, stmts_count);
                        // Use the same array for storing the require call target of potentially both JSX runtimes
                        var require_call_args_base = p.allocator.alloc(Expr, if (p.options.can_import_from_bundle) 0 else imports_count) catch unreachable;
                        var import_records = try p.allocator.alloc(u32, imports_count);

                        var decl_i: usize = 0;
                        var declared_symbols_i: usize = 0;
                        var import_record_i: usize = 0;
                        var require_call_args_i: usize = 0;
                        var stmt_i: usize = 0;

                        if (react_element_symbol.use_count_estimate > 0) {
                            declared_symbols[declared_symbols_i] = .{ .ref = p.react_element_type.ref, .is_top_level = true };
                            declared_symbols_i += 1;
                            p.recordUsage(p.es6_symbol_global.ref);
                            var call_args = p.allocator.alloc(Expr, 1) catch unreachable;
                            call_args[0] = Expr{ .data = Prefill.Data.REACT_ELEMENT_TYPE, .loc = logger.Loc.Empty };

                            decls[decl_i] = G.Decl{
                                .binding = p.b(
                                    B.Identifier{
                                        .ref = p.react_element_type.ref,
                                    },
                                    loc,
                                ),
                                .value = p.e(
                                    E.Call{
                                        // Symbol.for
                                        .target = p.e(
                                            E.Dot{
                                                .name = "for",
                                                .name_loc = logger.Loc.Empty,
                                                .target = p.e(
                                                    E.Identifier{
                                                        .ref = p.es6_symbol_global.ref,
                                                        .can_be_removed_if_unused = true,
                                                        .call_can_be_unwrapped_if_unused = true,
                                                    },
                                                    logger.Loc.Empty,
                                                ),
                                                .can_be_removed_if_unused = true,
                                                .call_can_be_unwrapped_if_unused = true,
                                            },
                                            logger.Loc.Empty,
                                        ),
                                        .args = ExprNodeList.init(call_args),
                                        .close_paren_loc = logger.Loc.Empty,
                                        .can_be_unwrapped_if_unused = true,
                                    },
                                    logger.Loc.Empty,
                                ),
                            };
                            decl_i += 1;
                        }

                        if (jsx_symbol.use_count_estimate > 0 or jsx_static_symbol.use_count_estimate > 0) {
                            declared_symbols[declared_symbols_i] = .{ .ref = automatic_namespace_ref, .is_top_level = true };
                            declared_symbols_i += 1;

                            const automatic_identifier = p.e(E.ImportIdentifier{ .ref = automatic_namespace_ref }, loc);

                            // We do not mark this as .require becuase we are already wrapping it manually.
                            // unless it's bun and you're not bundling
                            const use_automatic_identifier = (p.options.can_import_from_bundle or p.options.enable_bundling or !p.options.features.allow_runtime);
                            const import_record_kind = if (use_automatic_identifier) ImportKind.internal else ImportKind.require;
                            const import_record_id = p.addImportRecord(import_record_kind, loc, p.options.jsx.import_source);

                            const dot_call_target = brk: {
                                if (use_automatic_identifier) {
                                    break :brk automatic_identifier;
                                } else if (p.options.features.dynamic_require) {
                                    break :brk p.e(E.Require{ .import_record_index = import_record_id }, loc);
                                } else {
                                    require_call_args_base[require_call_args_i] = automatic_identifier;
                                    require_call_args_i += 1;
                                    break :brk p.callUnbundledRequire(require_call_args_base[0..require_call_args_i]);
                                }
                            };

                            if (jsx_symbol.use_count_estimate > 0) {
                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsx_runtime.ref, .is_top_level = true };
                                declared_symbols_i += 1;

                                decls[decl_i] = G.Decl{
                                    .binding = p.b(
                                        B.Identifier{
                                            .ref = p.jsx_runtime.ref,
                                        },
                                        loc,
                                    ),
                                    .value = p.e(
                                        E.Dot{
                                            .target = dot_call_target,
                                            .name = p.options.jsx.jsx,
                                            .name_loc = loc,
                                            .can_be_removed_if_unused = true,
                                        },
                                        loc,
                                    ),
                                };
                                decl_i += 1;
                            }

                            if (jsx_static_symbol.use_count_estimate > 0) {
                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsxs_runtime.ref, .is_top_level = true };
                                declared_symbols_i += 1;

                                decls[decl_i] = G.Decl{
                                    .binding = p.b(
                                        B.Identifier{
                                            .ref = p.jsxs_runtime.ref,
                                        },
                                        loc,
                                    ),
                                    .value = p.e(
                                        E.Dot{
                                            .target = dot_call_target,
                                            .name = p.options.jsx.jsx_static,
                                            .name_loc = loc,
                                            .can_be_removed_if_unused = true,
                                        },
                                        loc,
                                    ),
                                };

                                decl_i += 1;
                            }

                            if (jsx_filename_symbol.use_count_estimate > 0) {
                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsx_filename.ref, .is_top_level = true };
                                declared_symbols_i += 1;
                                decls[decl_i] = G.Decl{
                                    .binding = p.b(
                                        B.Identifier{
                                            .ref = p.jsx_filename.ref,
                                        },
                                        loc,
                                    ),
                                    .value = p.e(E.String{ .data = p.source.path.pretty }, loc),
                                };
                                decl_i += 1;
                            }

                            p.import_records.items[import_record_id].tag = .jsx_import;
                            if (dot_call_target.data != .e_require) {
                                // When everything is CommonJS
                                // We import JSX like this:
                                // var {jsxDev} = require("react/jsx-dev")
                                jsx_part_stmts[stmt_i] = p.s(S.Import{
                                    .namespace_ref = automatic_namespace_ref,
                                    .star_name_loc = loc,
                                    .is_single_line = true,
                                    .import_record_index = import_record_id,
                                }, loc);

                                stmt_i += 1;
                            }

                            p.named_imports.put(
                                automatic_namespace_ref,
                                js_ast.NamedImport{
                                    .alias = jsx_automatic_symbol.original_name,
                                    .alias_is_star = true,
                                    .alias_loc = loc,
                                    .namespace_ref = automatic_namespace_ref,
                                    .import_record_index = import_record_id,
                                },
                            ) catch unreachable;
                            p.is_import_item.put(p.allocator, automatic_namespace_ref, .{}) catch unreachable;
                            import_records[import_record_i] = import_record_id;
                            import_record_i += 1;
                        }

                        if (jsx_classic_symbol.use_count_estimate > 0) {
                            const classic_identifier = p.e(E.ImportIdentifier{ .ref = classic_namespace_ref }, loc);
                            const import_record_id = p.addImportRecord(.require, loc, p.options.jsx.classic_import_source);
                            const dot_call_target = brk: {
                                // var react = $aopaSD123();

                                if (p.options.can_import_from_bundle or p.options.enable_bundling or !p.options.features.allow_runtime) {
                                    break :brk classic_identifier;
                                } else if (p.options.features.dynamic_require) {
                                    break :brk p.e(E.Require{ .import_record_index = import_record_id }, loc);
                                } else {
                                    const require_call_args_start = require_call_args_i;
                                    require_call_args_base[require_call_args_i] = classic_identifier;
                                    require_call_args_i += 1;
                                    break :brk p.callUnbundledRequire(require_call_args_base[require_call_args_start..][0..1]);
                                }
                            };

                            if (jsx_factory_symbol.use_count_estimate > 0) {
                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsx_factory.ref, .is_top_level = true };
                                declared_symbols_i += 1;
                                decls[decl_i] = G.Decl{
                                    .binding = p.b(
                                        B.Identifier{
                                            .ref = p.jsx_factory.ref,
                                        },
                                        loc,
                                    ),
                                    .value = p.memberExpression(
                                        loc,
                                        dot_call_target,
                                        if (p.options.jsx.factory.len > 1) p.options.jsx.factory[1..] else p.options.jsx.factory,
                                    ),
                                };
                                decl_i += 1;
                            }

                            if (jsx_fragment_symbol.use_count_estimate > 0) {
                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsx_fragment.ref, .is_top_level = true };
                                declared_symbols_i += 1;
                                decls[decl_i] = G.Decl{
                                    .binding = p.b(
                                        B.Identifier{
                                            .ref = p.jsx_fragment.ref,
                                        },
                                        loc,
                                    ),
                                    .value = p.memberExpression(
                                        loc,
                                        dot_call_target,
                                        if (p.options.jsx.fragment.len > 1) p.options.jsx.fragment[1..] else p.options.jsx.fragment,
                                    ),
                                };
                                decl_i += 1;
                            }

                            if (dot_call_target.data != .e_require) {
                                jsx_part_stmts[stmt_i] = p.s(S.Import{
                                    .namespace_ref = classic_namespace_ref,
                                    .star_name_loc = loc,
                                    .is_single_line = true,
                                    .import_record_index = import_record_id,
                                }, loc);
                                stmt_i += 1;
                            }

                            p.import_records.items[import_record_id].tag = .jsx_classic;

                            p.named_imports.put(
                                classic_namespace_ref,
                                js_ast.NamedImport{
                                    .alias = jsx_classic_symbol.original_name,
                                    .alias_is_star = true,
                                    .alias_loc = loc,
                                    .namespace_ref = classic_namespace_ref,
                                    .import_record_index = import_record_id,
                                },
                            ) catch unreachable;
                            p.is_import_item.put(p.allocator, classic_namespace_ref, .{}) catch unreachable;
                            import_records[import_record_i] = import_record_id;
                            declared_symbols[declared_symbols_i] = .{ .ref = classic_namespace_ref, .is_top_level = true };
                            declared_symbols_i += 1;
                        }

                        if (p.options.features.react_fast_refresh) {
                            defer did_import_fast_refresh = true;
                            p.resolveGeneratedSymbol(&p.jsx_refresh_runtime);
                            if (!p.options.jsx.use_embedded_refresh_runtime) {
                                const refresh_runtime_symbol: *const Symbol = &p.symbols.items[p.jsx_refresh_runtime.ref.innerIndex()];

                                declared_symbols[declared_symbols_i] = .{ .ref = p.jsx_refresh_runtime.ref, .is_top_level = true };
                                declared_symbols_i += 1;

                                const import_record_id = p.addImportRecord(.require, loc, p.options.jsx.refresh_runtime);
                                p.import_records.items[import_record_id].tag = .react_refresh;
                                jsx_part_stmts[stmt_i] = p.s(S.Import{
                                    .namespace_ref = p.jsx_refresh_runtime.ref,
                                    .star_name_loc = loc,
                                    .is_single_line = true,
                                    .import_record_index = import_record_id,
                                }, loc);

                                stmt_i += 1;
                                p.named_imports.put(
                                    p.jsx_refresh_runtime.ref,
                                    js_ast.NamedImport{
                                        .alias = refresh_runtime_symbol.original_name,
                                        .alias_is_star = true,
                                        .alias_loc = loc,
                                        .namespace_ref = p.jsx_refresh_runtime.ref,
                                        .import_record_index = import_record_id,
                                    },
                                ) catch unreachable;
                                p.is_import_item.put(p.allocator, p.jsx_refresh_runtime.ref, .{}) catch unreachable;
                                import_records[import_record_i] = import_record_id;
                            }
                            p.recordUsage(p.jsx_refresh_runtime.ref);
                        }

                        jsx_part_stmts[stmt_i] = p.s(S.Local{ .kind = .k_var, .decls = decls[0..decl_i] }, loc);
                        stmt_i += 1;

                        before.append(js_ast.Part{
                            .stmts = jsx_part_stmts[0..stmt_i],
                            .declared_symbols = declared_symbols,
                            .import_record_indices = import_records,
                            .tag = .jsx_import,
                        }) catch unreachable;
                    }
                } else if (p.options.features.jsx_optimization_inline) {
                    const react_element_symbol = p.symbols.items[p.react_element_type.ref.innerIndex()];

                    if (react_element_symbol.use_count_estimate > 0) {
                        var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, 1);
                        var decls = try p.allocator.alloc(G.Decl, 1);
                        var part_stmts = try p.allocator.alloc(Stmt, 1);

                        declared_symbols[0] = .{ .ref = p.react_element_type.ref, .is_top_level = true };
                        p.recordUsage(p.es6_symbol_global.ref);
                        var call_args = p.allocator.alloc(Expr, 1) catch unreachable;
                        call_args[0] = Expr{ .data = Prefill.Data.REACT_ELEMENT_TYPE, .loc = logger.Loc.Empty };

                        decls[0] = G.Decl{
                            .binding = p.b(
                                B.Identifier{
                                    .ref = p.react_element_type.ref,
                                },
                                logger.Loc.Empty,
                            ),
                            .value = p.e(
                                E.Call{
                                    // Symbol.for
                                    .target = p.e(
                                        E.Dot{
                                            .name = "for",
                                            .name_loc = logger.Loc.Empty,
                                            .target = p.e(
                                                E.Identifier{
                                                    .ref = p.es6_symbol_global.ref,
                                                    .can_be_removed_if_unused = true,
                                                    .call_can_be_unwrapped_if_unused = true,
                                                },
                                                logger.Loc.Empty,
                                            ),
                                            .can_be_removed_if_unused = true,
                                            .call_can_be_unwrapped_if_unused = true,
                                        },
                                        logger.Loc.Empty,
                                    ),
                                    .args = ExprNodeList.init(call_args),
                                    .close_paren_loc = logger.Loc.Empty,
                                    .can_be_unwrapped_if_unused = true,
                                },
                                logger.Loc.Empty,
                            ),
                        };
                        part_stmts[0] = p.s(S.Local{ .kind = .k_var, .decls = decls }, logger.Loc.Empty);
                        before.append(js_ast.Part{
                            .stmts = part_stmts,
                            .declared_symbols = declared_symbols,
                            .tag = .jsx_import,
                        }) catch unreachable;
                    }
                } else {
                    const jsx_fragment_symbol: Symbol = p.symbols.items[p.jsx_fragment.ref.innerIndex()];
                    const jsx_factory_symbol: Symbol = p.symbols.items[p.jsx_factory.ref.innerIndex()];

                    // inject
                    //   var jsxFrag =
                    if (jsx_fragment_symbol.use_count_estimate + jsx_factory_symbol.use_count_estimate > 0) {
                        const total = @as(usize, @boolToInt(jsx_fragment_symbol.use_count_estimate > 0)) + @as(usize, @boolToInt(jsx_factory_symbol.use_count_estimate > 0));
                        var declared_symbols = try std.ArrayList(js_ast.DeclaredSymbol).initCapacity(p.allocator, total);
                        var decls = try std.ArrayList(G.Decl).initCapacity(p.allocator, total);
                        var part_stmts = try p.allocator.alloc(Stmt, 1);

                        if (jsx_fragment_symbol.use_count_estimate > 0) declared_symbols.appendAssumeCapacity(.{ .ref = p.jsx_fragment.ref, .is_top_level = true });
                        if (jsx_factory_symbol.use_count_estimate > 0) declared_symbols.appendAssumeCapacity(.{ .ref = p.jsx_factory.ref, .is_top_level = true });

                        if (jsx_fragment_symbol.use_count_estimate > 0)
                            decls.appendAssumeCapacity(G.Decl{
                                .binding = p.b(
                                    B.Identifier{
                                        .ref = p.jsx_fragment.ref,
                                    },
                                    logger.Loc.Empty,
                                ),
                                .value = try p.jsxStringsToMemberExpression(logger.Loc.Empty, p.options.jsx.fragment),
                            });

                        if (jsx_factory_symbol.use_count_estimate > 0)
                            decls.appendAssumeCapacity(G.Decl{
                                .binding = p.b(
                                    B.Identifier{
                                        .ref = p.jsx_factory.ref,
                                    },
                                    logger.Loc.Empty,
                                ),
                                .value = try p.jsxStringsToMemberExpression(logger.Loc.Empty, p.options.jsx.factory),
                            });
                        part_stmts[0] = p.s(S.Local{ .kind = .k_var, .decls = decls.items }, logger.Loc.Empty);
                        before.append(js_ast.Part{
                            .stmts = part_stmts,
                            .declared_symbols = declared_symbols.items,
                            .tag = .jsx_import,
                        }) catch unreachable;
                    }
                }

                if (!did_import_fast_refresh and p.options.features.react_fast_refresh) {
                    p.resolveGeneratedSymbol(&p.jsx_refresh_runtime);
                    p.recordUsage(p.jsx_refresh_runtime.ref);

                    if (!p.options.jsx.use_embedded_refresh_runtime) {
                        if (comptime Environment.allow_assert)
                            assert(!p.options.enable_bundling);
                        var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, 1);
                        const loc = logger.Loc.Empty;
                        const import_record_id = p.addImportRecord(.require, loc, p.options.jsx.refresh_runtime);
                        p.import_records.items[import_record_id].tag = .react_refresh;

                        var import_stmt = p.s(S.Import{
                            .namespace_ref = p.jsx_refresh_runtime.ref,
                            .star_name_loc = loc,
                            .is_single_line = true,
                            .import_record_index = import_record_id,
                        }, loc);

                        const refresh_runtime_symbol: *const Symbol = &p.symbols.items[p.jsx_refresh_runtime.ref.innerIndex()];

                        p.named_imports.put(
                            p.jsx_refresh_runtime.ref,
                            js_ast.NamedImport{
                                .alias = refresh_runtime_symbol.original_name,
                                .alias_is_star = true,
                                .alias_loc = loc,
                                .namespace_ref = p.jsx_refresh_runtime.ref,
                                .import_record_index = import_record_id,
                            },
                        ) catch unreachable;
                        p.is_import_item.put(p.allocator, p.jsx_refresh_runtime.ref, .{}) catch unreachable;
                        var import_records = try p.allocator.alloc(@TypeOf(import_record_id), 1);
                        import_records[0] = import_record_id;
                        declared_symbols[0] = .{ .ref = p.jsx_refresh_runtime.ref, .is_top_level = true };
                        var part_stmts = try p.allocator.alloc(Stmt, 1);
                        part_stmts[0] = import_stmt;

                        before.append(js_ast.Part{
                            .stmts = part_stmts,
                            .declared_symbols = declared_symbols,
                            .import_record_indices = import_records,
                            .tag = .react_fast_refresh,
                        }) catch unreachable;
                    }
                }
            },
            .solid => {
                p.resolveGeneratedSymbol(&p.solid.wrap);
                p.resolveGeneratedSymbol(&p.solid.insert);
                p.resolveGeneratedSymbol(&p.solid.template);
                p.resolveGeneratedSymbol(&p.solid.delegateEvents);
                p.resolveGeneratedSymbol(&p.solid.createComponent);
                p.resolveGeneratedSymbol(&p.solid.setAttribute);
                p.resolveGeneratedSymbol(&p.solid.effect);
                p.resolveGeneratedSymbol(&p.solid.namespace);

                const import_count =
                    @as(usize, @boolToInt(p.symbols.items[p.solid.wrap.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.insert.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.template.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.delegateEvents.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.createComponent.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.setAttribute.ref.innerIndex()].use_count_estimate > 0)) +
                    @as(usize, @boolToInt(p.symbols.items[p.solid.effect.ref.innerIndex()].use_count_estimate > 0));
                var import_items = try p.allocator.alloc(js_ast.ClauseItem, import_count);

                // 1. Inject the part containing template declarations and Solid's import statement
                var stmts_to_inject = p.allocator.alloc(Stmt, @as(usize, @boolToInt(p.solid.template_decls.count() > 0)) + @as(usize, @boolToInt(import_count > 0 and p.options.features.auto_import_jsx))) catch unreachable;
                var j: usize = 0;
                const order = .{
                    "createComponent",
                    "delegateEvents",
                    "effect",
                    "insert",
                    "setAttribute",
                    "template",
                    "wrap",
                };

                var stmts_remain = stmts_to_inject;

                if (stmts_to_inject.len > 0) {
                    var declared_symbols = p.allocator.alloc(js_ast.DeclaredSymbol, p.solid.template_decls.count()) catch unreachable;
                    var import_record_ids: []u32 = &[_]u32{};

                    if (p.options.features.auto_import_jsx) {
                        try p.named_imports.ensureUnusedCapacity(import_count);
                        try p.is_import_item.ensureUnusedCapacity(p.allocator, @intCast(u32, import_count));
                        const import_record_id = p.addImportRecord(.stmt, logger.Loc.Empty, p.options.jsx.import_source);

                        inline for (order) |field_name| {
                            const ref = @field(p.solid, field_name).ref;
                            if (p.symbols.items[ref.innerIndex()].use_count_estimate > 0) {
                                import_items[j] = js_ast.ClauseItem{
                                    .alias = field_name,
                                    .name = .{ .loc = logger.Loc.Empty, .ref = ref },
                                    .alias_loc = logger.Loc.Empty,
                                    .original_name = "",
                                };

                                p.named_imports.putAssumeCapacity(
                                    ref,
                                    js_ast.NamedImport{
                                        .alias = p.symbols.items[ref.innerIndex()].original_name,
                                        .alias_is_star = false,
                                        .alias_loc = logger.Loc.Empty,
                                        .namespace_ref = p.solid.namespace.ref,
                                        .import_record_index = import_record_id,
                                    },
                                );
                                p.is_import_item.putAssumeCapacity(ref, .{});
                                j += 1;
                            }
                        }

                        p.import_records.items[import_record_id].tag = .jsx_import;
                        stmts_remain[0] = p.s(
                            S.Import{
                                .namespace_ref = p.solid.namespace.ref,
                                .star_name_loc = null,
                                .is_single_line = true,
                                .import_record_index = import_record_id,
                                .items = import_items,
                            },
                            logger.Loc.Empty,
                        );
                        stmts_remain = stmts_remain[1..];
                        import_record_ids = p.allocator.alloc(u32, 1) catch unreachable;
                        import_record_ids[0] = import_record_id;
                    }

                    if (p.solid.template_decls.count() > 0) {
                        for (p.solid.template_decls.values()) |val, i| {
                            declared_symbols[i] = js_ast.DeclaredSymbol{
                                .ref = val.binding.data.b_identifier.ref,
                                .is_top_level = true,
                            };
                        }
                        stmts_remain[0] = p.s(
                            S.Local{
                                .decls = p.solid.template_decls.values(),
                            },
                            logger.Loc.Empty,
                        );
                    }

                    before.append(js_ast.Part{
                        .stmts = stmts_to_inject,
                        .declared_symbols = declared_symbols,
                        .import_record_indices = import_record_ids,
                        .tag = .jsx_import,
                    }) catch unreachable;
                }
            },
            else => {},
        }

        if (p.options.enable_bundling) p.resolveBundlingSymbols();

        var runtime_imports_iter = p.runtime_imports.iter();

        const has_cjs_imports = p.cjs_import_stmts.items.len > 0 and p.options.transform_require_to_import;

        p.resolveCommonJSSymbols();

        // - don't import runtime if we're bundling, it's already included
        // - when HMR is enabled, we always need to import the runtime for HMRClient and HMRModule.
        // - when HMR is not enabled, we only need any runtime imports if we're importing require()
        if (p.options.features.allow_runtime and
            !p.options.enable_bundling and
            (p.has_called_runtime or p.options.features.hot_module_reloading or has_cjs_imports))
        {
            const before_start = before.items.len;
            if (p.options.features.hot_module_reloading) {
                p.resolveHMRSymbols();

                if (runtime_imports_iter.next()) |entry| {
                    std.debug.assert(entry.key == 0);

                    // HMRClient.activate(true)
                    var args_list: []Expr = if (Environment.isDebug) &Prefill.HotModuleReloading.DebugEnabledArgs else &Prefill.HotModuleReloading.DebugDisabled;

                    var hmr_module_class_ident = p.e(E.Identifier{ .ref = p.runtime_imports.__HMRClient.?.ref }, logger.Loc.Empty);
                    const imports = [_]u16{entry.key};
                    // TODO: remove these unnecessary allocations
                    p.generateImportStmt(
                        RuntimeImports.Name,
                        &imports,
                        &before,
                        p.runtime_imports,
                        p.s(
                            S.SExpr{
                                .value = p.e(E.Call{
                                    .target = p.e(E.Dot{
                                        .target = hmr_module_class_ident,
                                        .name = "activate",
                                        .name_loc = logger.Loc.Empty,
                                    }, logger.Loc.Empty),
                                    .args = ExprNodeList.init(args_list),
                                }, logger.Loc.Empty),
                            },
                            logger.Loc.Empty,
                        ),
                        "import_",
                        true,
                    ) catch unreachable;
                }
            }

            while (runtime_imports_iter.next()) |entry| {
                const imports = [_]u16{entry.key};
                // TODO: remove these unnecessary allocations
                p.generateImportStmt(
                    RuntimeImports.Name,
                    &imports,
                    &before,
                    p.runtime_imports,
                    null,
                    "import_",
                    true,
                ) catch unreachable;
            }
            // If we import JSX, we might call require.
            // We need to import require before importing JSX.
            // But a runtime import may not be necessary until we import JSX.
            // So we have to swap it after the fact, instead of just moving this above the JSX import.
            if (before_start > 0) {
                var j: usize = 0;
                while (j < before_start) : (j += 1) {
                    std.mem.swap(js_ast.Part, &before.items[j], &before.items[before.items.len - j - 1]);
                }
            }
        }

        if (has_cjs_imports) {
            var import_records = try p.allocator.alloc(u32, p.cjs_import_stmts.items.len);
            var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, p.cjs_import_stmts.items.len);

            for (p.cjs_import_stmts.items) |entry, i| {
                const import_statement: *S.Import = entry.data.s_import;
                import_records[i] = import_statement.import_record_index;
                declared_symbols[i] = .{
                    .ref = import_statement.namespace_ref,
                    .is_top_level = true,
                };
            }

            before.append(js_ast.Part{
                .stmts = p.cjs_import_stmts.items,
                .declared_symbols = declared_symbols,
                .import_record_indices = import_records,
                .tag = .cjs_imports,
            }) catch unreachable;
        }

        var parts_slice: []js_ast.Part = &([_]js_ast.Part{});

        if (before.items.len > 0 or after.items.len > 0) {
            const before_len = before.items.len;
            const after_len = after.items.len;
            const parts_len = parts.items.len;

            var _parts = try p.allocator.alloc(
                js_ast.Part,
                before_len +
                    after_len +
                    parts_len,
            );

            var remaining_parts = _parts;
            if (before_len > 0) {
                const parts_to_copy = before.items;
                std.mem.copy(js_ast.Part, remaining_parts, parts_to_copy);
                remaining_parts = remaining_parts[parts_to_copy.len..];
            }

            if (parts_len > 0) {
                const parts_to_copy = parts.items;
                std.mem.copy(js_ast.Part, remaining_parts, parts_to_copy);
                remaining_parts = remaining_parts[parts_to_copy.len..];
            }

            if (after_len > 0) {
                const parts_to_copy = after.items;
                std.mem.copy(js_ast.Part, remaining_parts, parts_to_copy);
            }

            parts_slice = _parts;
        } else {
            after.deinit();
            before.deinit();
            parts_slice = parts.items;
        }

        // Pop the module scope to apply the "ContainsDirectEval" rules
        // p.popScope();

        result.ast = try p.toAST(parts_slice, exports_kind, wrapper_expr);
        result.ok = true;

        return result;
    }

    pub fn init(_options: Options, log: *logger.Log, source: *const logger.Source, define: *Define, allocator: Allocator) !Parser {
        const lexer = try js_lexer.Lexer.init(log, source.*, allocator);
        return Parser{
            .options = _options,
            .allocator = allocator,
            .lexer = lexer,
            .define = define,
            .source = source,
            .log = log,
        };
    }
};

const FindLabelSymbolResult = struct { ref: Ref, is_loop: bool, found: bool = false };

const FindSymbolResult = struct {
    ref: Ref,
    declare_loc: ?logger.Loc = null,
    is_inside_with_scope: bool = false,
};
const ExportClauseResult = struct {
    clauses: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
    had_type_only_exports: bool = false,
};

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

    pub fn hasDecorators(self: *ParseStatementOptions) bool {
        const decs = self.ts_decorators orelse return false;
        return decs.values.len > 0;
    }
};

var e_missing_data = E.Missing{};
var s_missing = S.Empty{};
var nullExprData = Expr.Data{ .e_missing = e_missing_data };
var nullStmtData = Stmt.Data{ .s_empty = s_missing };
pub const Prefill = struct {
    pub const HotModuleReloading = struct {
        pub var DebugEnabledArgs = [_]Expr{
            Expr{ .data = .{ .e_boolean = E.Boolean{ .value = true } }, .loc = logger.Loc.Empty },
        };
        pub var DebugDisabled = [_]Expr{
            Expr{ .data = .{ .e_boolean = E.Boolean{ .value = false } }, .loc = logger.Loc.Empty },
        };
        pub var ActivateString = E.String{
            .data = "activate",
        };
        pub var ActivateIndex = E.Index{
            .index = .{
                .data = .{
                    .e_string = &ActivateString,
                },
                .loc = logger.Loc.Empty,
            },
            .target = undefined,
        };
    };
    pub const StringLiteral = struct {
        pub const Key = [3]u8{ 'k', 'e', 'y' };
        pub const Children = [_]u8{ 'c', 'h', 'i', 'l', 'd', 'r', 'e', 'n' };
        pub const Filename = [_]u8{ 'f', 'i', 'l', 'e', 'N', 'a', 'm', 'e' };
        pub const LineNumber = [_]u8{ 'l', 'i', 'n', 'e', 'N', 'u', 'm', 'b', 'e', 'r' };
        pub const ColumnNumber = [_]u8{ 'c', 'o', 'l', 'u', 'm', 'n', 'N', 'u', 'm', 'b', 'e', 'r' };
    };
    pub const Value = struct {
        pub const EThis = E.This{};
        pub const Zero = E.Number{ .value = 0.0 };
    };
    pub const String = struct {
        pub var Key = E.String{ .data = &Prefill.StringLiteral.Key };
        pub var Children = E.String{ .data = &Prefill.StringLiteral.Children };
        pub var Filename = E.String{ .data = &Prefill.StringLiteral.Filename };
        pub var LineNumber = E.String{ .data = &Prefill.StringLiteral.LineNumber };
        pub var ColumnNumber = E.String{ .data = &Prefill.StringLiteral.ColumnNumber };

        pub var @"$$typeof" = E.String{ .data = "$$typeof" };
        pub var @"type" = E.String{ .data = "type" };
        pub var @"ref" = E.String{ .data = "ref" };
        pub var @"props" = E.String{ .data = "props" };
        pub var @"_owner" = E.String{ .data = "_owner" };
        pub var @"REACT_ELEMENT_TYPE" = E.String{ .data = "react.element" };
    };
    pub const Data = struct {
        pub var BMissing = B{ .b_missing = BMissing_ };
        pub var BMissing_ = B.Missing{};

        pub var EMissing = Expr.Data{ .e_missing = EMissing_ };
        pub var EMissing_ = E.Missing{};

        pub var SEmpty = Stmt.Data{ .s_empty = SEmpty_ };
        pub var SEmpty_ = S.Empty{};

        pub var Filename = Expr.Data{ .e_string = &Prefill.String.Filename };
        pub var LineNumber = Expr.Data{ .e_string = &Prefill.String.LineNumber };
        pub var ColumnNumber = Expr.Data{ .e_string = &Prefill.String.ColumnNumber };
        pub var @"$$typeof" = Expr.Data{ .e_string = &Prefill.String.@"$$typeof" };
        pub var @"key" = Expr.Data{ .e_string = &Prefill.String.@"Key" };
        pub var @"type" = Expr.Data{ .e_string = &Prefill.String.@"type" };
        pub var @"ref" = Expr.Data{ .e_string = &Prefill.String.@"ref" };
        pub var @"props" = Expr.Data{ .e_string = &Prefill.String.@"props" };
        pub var @"_owner" = Expr.Data{ .e_string = &Prefill.String.@"_owner" };
        pub var @"REACT_ELEMENT_TYPE" = Expr.Data{ .e_string = &Prefill.String.@"REACT_ELEMENT_TYPE" };
        pub const This = Expr.Data{ .e_this = E.This{} };
        pub const Zero = Expr.Data{ .e_number = Value.Zero };
    };
    pub const Runtime = struct {
        pub var JSXFilename = "__jsxFilename";
        pub var MarkAsModule = "__markAsModule";
        pub var CommonJS = "__commonJS";
        pub var ReExport = "__reExport";
        pub var ToModule = "__toModule";
        const JSXShortname = "jsx";
    };
};

const ReactJSX = struct {
    hoisted_elements: std.ArrayHashMapUnmanaged(Ref, G.Decl, bun.ArrayIdentityContext, false) = .{},
};

var keyExprData = Expr.Data{ .e_string = &Prefill.String.Key };
var jsxChildrenKeyData = Expr.Data{ .e_string = &Prefill.String.Children };
var nullExprValueData = E.Null{};
var falseExprValueData = E.Boolean{ .value = false };
var nullValueExpr = Expr.Data{ .e_null = nullExprValueData };
var falseValueExpr = Expr.Data{ .e_boolean = E.Boolean{ .value = false } };

pub const ImportOrRequireScanResults = struct {
    import_records: List(ImportRecord),
};

const JSXTransformType = enum {
    none,
    react,
    macro,
    solid,
};

const SolidJS = struct {
    namespace: GeneratedSymbol = undefined,
    wrap: GeneratedSymbol = undefined,
    insert: GeneratedSymbol = undefined,
    template: GeneratedSymbol = undefined,
    delegateEvents: GeneratedSymbol = undefined,
    createComponent: GeneratedSymbol = undefined,
    setAttribute: GeneratedSymbol = undefined,
    effect: GeneratedSymbol = undefined,

    events_to_delegate: Event.Bitset = .{},
    template_decls: std.ArrayHashMapUnmanaged(u32, G.Decl, bun.ArrayIdentityContext, false) = .{},
    is_in_jsx_component: bool = false,

    stack: Stack = .{},

    pub const ExpressionTransform = union(enum) {
        class: void,
        nativeEvent: void,
        nativeEventCaptured: void,
        style: void,
        setAttribute: void,
        event: Event,

        pub fn which(key: []const u8) ExpressionTransform {
            const len = key.len;
            if (len < 3)
                return .{ .setAttribute = {} };

            if (strings.hasPrefixComptime(key, "on:")) {
                return .{ .nativeEvent = {} };
            }

            if (strings.hasPrefixComptime(key, "oncapture:")) {
                return .{ .nativeEventCaptured = {} };
            }

            if (Event.map.get(key)) |event| {
                return .{ .event = event };
            }

            switch (key.len) {
                "class".len => {
                    if (strings.eqlComptime(key, "class"))
                        return .{ .class = {} };

                    if (strings.eqlComptime(key, "style"))
                        return .{ .style = {} };

                    return .{ .setAttribute = {} };
                },
                "className".len => {
                    if (strings.eqlComptime(key, "className"))
                        return .{ .class = {} };
                    return .{ .setAttribute = {} };
                },
                else => return .{ .setAttribute = {} },
            }
        }
    };

    pub const Stack = struct {
        component_body: std.ArrayListUnmanaged(Stmt) = .{},
        component_body_decls: std.ArrayListUnmanaged(G.Decl) = .{},
        last_template_id: E.Identifier = .{},
        last_element_id: E.Identifier = .{},
        temporary_scope: Scope = Scope{
            .kind = .function_body,
            .parent = null,
        },
        prev_scope: ?*Scope = null,
        node_count: u32 = 0,

        current_template_string: MutableString = .{
            .allocator = undefined,
            .list = .{},
        },
        buffered_writer: MutableString.BufferedWriter = undefined,

        element_counter: u32 = 0,
    };

    pub fn generateElementName(this: *SolidJS, allocator: std.mem.Allocator) string {
        if (this.stack.component_body_decls.items.len <= prefilled_element_names.len) {
            return prefilled_element_names[this.stack.component_body_decls.items.len];
        }
        return std.fmt.allocPrint(allocator, "_el${d}", .{this.stack.component_body_decls.items.len}) catch unreachable;
    }

    pub fn generateTemplateName(this: *SolidJS, allocator: std.mem.Allocator) string {
        if (this.template_decls.count() <= prefilled_template_names.len) {
            return prefilled_template_names[this.template_decls.count()];
        }
        return std.fmt.allocPrint(allocator, "_tmpl${d}", .{this.template_decls.count()}) catch unreachable;
    }

    pub fn generateElement(solid: *SolidJS, p: anytype, template_expression: Expr, value_loc: logger.Loc) !E.Identifier {
        var name = solid.generateElementName(p.allocator);

        var prev_scope = p.current_scope;
        p.current_scope = &solid.stack.temporary_scope;
        const ref = p.declareSymbolMaybeGenerated(.import, value_loc, name, true) catch unreachable;
        p.current_scope = prev_scope;
        const element = .{ .ref = ref };
        var decl_value: Expr = undefined;
        var decls = &solid.stack.component_body_decls;

        switch (decls.items.len) {
            0 => {
                decl_value = p.e(
                    E.Call{
                        .target = p.e(
                            E.Dot{
                                .name = "cloneNode",
                                .name_loc = value_loc,
                                .target = template_expression,
                                .can_be_removed_if_unused = true,
                                .call_can_be_unwrapped_if_unused = true,
                            },
                            template_expression.loc,
                        ),
                        .args = ExprNodeList.init(true_args),
                        .can_be_unwrapped_if_unused = true,
                    },
                    value_loc,
                );
                p.recordUsage(template_expression.data.e_identifier.ref);
            },
            1 => {
                const ident = E.Identifier{ .ref = decls.items[decls.items.len - 1].binding.data.b_identifier.ref };
                decl_value = p.e(
                    E.Dot{
                        .target = .{
                            .data = .{ .e_identifier = ident },
                            .loc = value_loc,
                        },
                        .name = "firstChild",
                        .name_loc = template_expression.loc,
                        .can_be_removed_if_unused = true,
                        .call_can_be_unwrapped_if_unused = true,
                    },
                    value_loc,
                );
                p.recordUsage(ident.ref);
            },
            else => {
                const ident = E.Identifier{ .ref = decls.items[decls.items.len - 1].binding.data.b_identifier.ref };
                decl_value = p.e(E.Dot{
                    .target = .{
                        .data = .{ .e_identifier = ident },
                        .loc = value_loc,
                    },
                    .name_loc = template_expression.loc,
                    .name = "nextSibling",
                    .can_be_removed_if_unused = true,
                    .call_can_be_unwrapped_if_unused = true,
                }, value_loc);
                p.recordUsage(ident.ref);
            },
        }
        try decls.append(
            p.allocator,
            G.Decl{ .binding = p.b(B.Identifier{ .ref = ref }, template_expression.loc), .value = decl_value },
        );
        return element;
    }

    pub const Event = enum {
        beforeinput,
        click,
        dblclick,
        contextmenu,
        focusin,
        focusout,
        input,
        keydown,
        keyup,
        mousedown,
        mousemove,
        mouseout,
        mouseover,
        mouseup,
        pointerdown,
        pointermove,
        pointerout,
        pointerover,
        pointerup,
        touchend,
        touchmove,
        touchstart,

        pub const setter_names = std.enums.EnumArray(Event, string).init(
            .{
                .beforeinput = "$$beforeinput",
                .click = "$$click",
                .dblclick = "$$dblclick",
                .contextmenu = "$$contextmenu",
                .focusin = "$$focusin",
                .focusout = "$$focusout",
                .input = "$$input",
                .keydown = "$$keydown",
                .keyup = "$$keyup",
                .mousedown = "$$mousedown",
                .mousemove = "$$mousemove",
                .mouseout = "$$mouseout",
                .mouseover = "$$mouseover",
                .mouseup = "$$mouseup",
                .pointerdown = "$$pointerdown",
                .pointermove = "$$pointermove",
                .pointerout = "$$pointerout",
                .pointerover = "$$pointerover",
                .pointerup = "$$pointerup",
                .touchend = "$$touchend",
                .touchmove = "$$touchmove",
                .touchstart = "$$touchstart",
            },
        );

        pub inline fn setter(this: Event) string {
            return setter_names.get(this);
        }

        pub const map = ComptimeStringMap(
            Event,
            .{
                .{ "onbeforeinput", Event.beforeinput },
                .{ "onclick", Event.click },
                .{ "ondblclick", Event.dblclick },
                .{ "oncontextmenu", Event.contextmenu },
                .{ "onfocusin", Event.focusin },
                .{ "onfocusout", Event.focusout },
                .{ "oninput", Event.input },
                .{ "onkeydown", Event.keydown },
                .{ "onkeyup", Event.keyup },
                .{ "onmousedown", Event.mousedown },
                .{ "onmousemove", Event.mousemove },
                .{ "onmouseout", Event.mouseout },
                .{ "onmouseover", Event.mouseover },
                .{ "onmouseup", Event.mouseup },
                .{ "onpointerdown", Event.pointerdown },
                .{ "onpointermove", Event.pointermove },
                .{ "onpointerout", Event.pointerout },
                .{ "onpointerover", Event.pointerover },
                .{ "onpointerup", Event.pointerup },
                .{ "ontouchend", Event.touchend },
                .{ "ontouchmove", Event.touchmove },
                .{ "ontouchstart", Event.touchstart },
                .{ "onbeforeinput", Event.beforeinput },
                .{ "onClick", Event.click },
                .{ "onDblclick", Event.dblclick },
                .{ "onContextMenu", Event.contextmenu },
                .{ "onFocusIn", Event.focusin },
                .{ "onFocusOut", Event.focusout },
                .{ "onInput", Event.input },
                .{ "onKeydown", Event.keydown },
                .{ "onKeyup", Event.keyup },
                .{ "onMouseDown", Event.mousedown },
                .{ "onMouseMove", Event.mousemove },
                .{ "onMouseOut", Event.mouseout },
                .{ "onMouseOver", Event.mouseover },
                .{ "onMouseUp", Event.mouseup },
                .{ "onPointerDown", Event.pointerdown },
                .{ "onPointerMove", Event.pointermove },
                .{ "onPointerOut", Event.pointerout },
                .{ "onPointerOver", Event.pointerover },
                .{ "onPointerUp", Event.pointerup },
                .{ "onTouchEnd", Event.touchend },
                .{ "onTouchMove", Event.touchmove },
                .{ "onTouchStart", Event.touchstart },
            },
        );

        pub const Bitset = std.enums.EnumSet(Event);
    };

    const prefilled_element_names = [_]string{
        "_el",
        "_el$1",
        "_el$2",
        "_el$3",
        "_el$4",
        "_el$5",
        "_el$6",
        "_el$7",
        "_el$8",
        "_el$9",
        "_el$10",
        "_el$11",
        "_el$12",
        "_el$13",
        "_el$14",
        "_el$15",
        "_el$16",
        "_el$17",
        "_el$18",
        "_el$19",
        "_el$20",
        "_el$21",
    };
    const prefilled_template_names = [_]string{
        "_tmpl",
        "_tmpl$1",
        "_tmpl$2",
        "_tmpl$3",
        "_tmpl$4",
        "_tmpl$5",
        "_tmpl$6",
        "_tmpl$7",
        "_tmpl$8",
        "_tmpl$9",
        "_tmpl$10",
        "_tmpl$11",
        "_tmpl$12",
        "_tmpl$13",
        "_tmpl$14",
        "_tmpl$15",
        "_tmpl$16",
        "_tmpl$17",
        "_tmpl$18",
        "_tmpl$19",
        "_tmpl$20",
        "_tmpl$21",
    };
};

fn GetSolidJSSymbols(comptime jsx: JSXTransformType) type {
    if (jsx != .solid)
        return void;

    return SolidJS;
}
const ParserFeatures = struct {
    typescript: bool = false,
    jsx: JSXTransformType = JSXTransformType.none,
    scan_only: bool = false,

    // *** How React Fast Refresh works ***
    //
    //  Implmenetations:
    //   [0]: https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
    //   [1]: https://github.com/swc-project/swc/blob/master/ecmascript/transforms/react/src/refresh/mod.rs
    //
    //  Additional reading:
    //   - https://github.com/facebook/react/issues/16604#issuecomment-528663101
    //   - https://github.com/facebook/react/blob/master/packages/react-refresh/src/__tests__/ReactFreshIntegration-test.js
    //
    //  From reading[0] and Dan Abramov's comment, there are really five parts.
    //  1. At the top of the file:
    //      1. Declare a $RefreshReg$ if it doesn't exist
    //         - This really just does "RefreshRuntime.register(ComponentIdentifier, ComponentIdentifier.name);"
    //      2. Run "var _s${componentIndex} = $RefreshSig$()" to generate a function for updating react refresh scoped to the component. So it's one per *component*.
    //         - This really just does "RefreshRuntime.createSignatureFunctionForTransform();"
    //  2. Register all React components[2] defined in the module scope by calling the equivalent of $RefreshReg$(ComponentIdentifier, "ComponentName")
    //  3. For each registered component:
    //    1. Call "_s()" to mark the first render of this component for "react-refresh/runtime". Call this at the start of the React component's function body
    //    2. Track every call expression to a hook[3] inside the component, including:
    //        - Identifier of the hook function
    //        - Arguments passed
    //    3. For each hook's call expression, generate a signature key which is
    //        - The hook's identifier ref
    //        - The S.Decl ("VariableDeclarator")'s source
    //           "var [foo, bar] = useFooBar();"
    //                ^--------^ This region, I think. Judging from this line: https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js#L407
    //        - For the "useState" hook, also hash the source of the first argument if it exists e.g. useState(foo => true);
    //        - For the "useReducer" hook, also hash the source of the second argument if it exists e.g. useReducer({}, () => ({}));
    //    4. If the hook component is not builtin and is defined inside a component, always reset the component state
    //        - See this test: https://github.com/facebook/react/blob/568dc3532e25b30eee5072de08503b1bbc4f065d/packages/react-refresh/src/__tests__/ReactFreshIntegration-test.js#L909
    //  4. From the signature key generated in 3., call one of the following:
    //     - _s(ComponentIdentifier, hash(signature));
    //     - _s(ComponentIdentifier, hash(signature), true /* forceReset */);
    //     - _s(ComponentIdentifier, hash(signature), false /* forceReset */, () => [customHook1, customHook2, customHook3]);
    //     Note: This step is only strictly required on rebuild.
    //  5. if (isReactComponentBoundary(exports)) enqueueUpdateAndHandleErrors();
    // **** FAQ ****
    //  [2]: Q: From a parser's perspective, what's a component?
    //       A: typeof name === 'string' && name[0] >= 'A' && name[0] <= 'Z -- https://github.com/facebook/react/blob/568dc3532e25b30eee5072de08503b1bbc4f065d/packages/react-refresh/src/ReactFreshBabelPlugin.js#L42-L44
    //  [3]: Q: From a parser's perspective, what's a hook?
    //       A: /^use[A-Z]/ -- https://github.com/facebook/react/blob/568dc3532e25b30eee5072de08503b1bbc4f065d/packages/react-refresh/src/ReactFreshBabelPlugin.js#L390
    //
    //
    //
    // react_fast_refresh: bool = false,
};

// Our implementation diverges somewhat from the official implementation
// Specifically, we use a subclass of HMRModule - FastRefreshModule
// Instead of creating a globally-scoped
const FastRefresh = struct {};

const ImportItemForNamespaceMap = std.StringArrayHashMap(LocRef);

pub const MacroState = struct {
    refs: MacroRefs,
    prepend_stmts: *ListManaged(Stmt) = undefined,
    imports: std.AutoArrayHashMap(i32, Ref),

    pub fn init(allocator: Allocator) MacroState {
        return MacroState{
            .refs = MacroRefs.init(allocator),
            .prepend_stmts = undefined,
            .imports = std.AutoArrayHashMap(i32, Ref).init(allocator),
        };
    }
};

// workaround for https://github.com/ziglang/zig/issues/10903
fn NewParser(
    comptime parser_features: ParserFeatures,
) type {
    return NewParser_(
        parser_features.typescript,
        parser_features.jsx,
        parser_features.scan_only,
    );
}
fn NewParser_(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    const js_parser_features: ParserFeatures = .{
        .typescript = parser_feature__typescript,
        .jsx = parser_feature__jsx,
        .scan_only = parser_feature__scan_only,
    };

    // P is for Parser!
    return struct {
        const js_parser_jsx = if (FeatureFlags.force_macro) JSXTransformType.macro else js_parser_features.jsx;
        const is_typescript_enabled = js_parser_features.typescript;
        const is_jsx_enabled = js_parser_jsx != .none;
        const only_scan_imports_and_do_not_visit = js_parser_features.scan_only;
        const ImportRecordList = if (only_scan_imports_and_do_not_visit) *std.ArrayList(ImportRecord) else std.ArrayList(ImportRecord);
        const NamedImportsType = if (only_scan_imports_and_do_not_visit) *js_ast.Ast.NamedImports else js_ast.Ast.NamedImports;
        const NeedsJSXType = if (only_scan_imports_and_do_not_visit) bool else void;
        const track_symbol_usage_during_parse_pass = only_scan_imports_and_do_not_visit and is_typescript_enabled;
        const ParsePassSymbolUsageType = if (track_symbol_usage_during_parse_pass) *ScanPassResult.ParsePassSymbolUsageMap else void;

        pub const parser_features: ParserFeatures = js_parser_features;
        const P = @This();
        pub const jsx_transform_type: JSXTransformType = js_parser_jsx;
        const allow_macros = FeatureFlags.is_macro_enabled and jsx_transform_type != .macro;
        const MacroCallCountType = if (allow_macros) u32 else u0;
        macro: MacroState = undefined,
        allocator: Allocator,
        options: Parser.Options,
        log: *logger.Log,
        define: *Define,
        source: *const logger.Source,
        lexer: js_lexer.Lexer,
        allow_in: bool = false,
        allow_private_identifiers: bool = false,

        has_top_level_return: bool = false,
        latest_return_had_semicolon: bool = false,
        has_import_meta: bool = false,
        has_es_module_syntax: bool = false,
        top_level_await_keyword: logger.Range = logger.Range.None,
        fn_or_arrow_data_parse: FnOrArrowDataParse = FnOrArrowDataParse{},
        fn_or_arrow_data_visit: FnOrArrowDataVisit = FnOrArrowDataVisit{},
        fn_only_data_visit: FnOnlyDataVisit = FnOnlyDataVisit{},
        allocated_names: List(string) = .{},
        // allocated_names: ListManaged(string) = ListManaged(string).init(bun.default_allocator),
        // allocated_names_pool: ?*AllocatedNamesPool.Node = null,
        latest_arrow_arg_loc: logger.Loc = logger.Loc.Empty,
        forbid_suffix_after_as_loc: logger.Loc = logger.Loc.Empty,
        current_scope: *js_ast.Scope = undefined,
        scopes_for_current_part: List(*js_ast.Scope) = .{},
        symbols: ListManaged(js_ast.Symbol) = undefined,
        ts_use_counts: List(u32) = .{},
        exports_ref: Ref = Ref.None,
        require_ref: Ref = Ref.None,
        module_ref: Ref = Ref.None,
        filename_ref: Ref = Ref.None,
        dirname_ref: Ref = Ref.None,
        import_meta_ref: Ref = Ref.None,
        bun_plugin: js_ast.BunPlugin = .{},
        scopes_in_order_visitor_index: usize = 0,
        has_classic_runtime_warned: bool = false,
        macro_call_count: MacroCallCountType = 0,

        /// Used for transforming export default -> module.exports
        has_export_default: bool = false,

        hmr_module: GeneratedSymbol = GeneratedSymbol{ .primary = Ref.None, .backup = Ref.None, .ref = Ref.None },

        has_called_runtime: bool = false,

        cjs_import_stmts: std.ArrayList(Stmt),

        injected_define_symbols: List(Ref) = .{},
        symbol_uses: js_ast.Part.SymbolUseMap = .{},
        declared_symbols: List(js_ast.DeclaredSymbol) = .{},
        declared_symbols_for_reuse: List(js_ast.DeclaredSymbol) = .{},
        runtime_imports: RuntimeImports = RuntimeImports{},

        parse_pass_symbol_uses: ParsePassSymbolUsageType = undefined,
        // duplicate_case_checker: void,
        // non_bmp_identifiers: StringBoolMap,
        // legacy_octal_literals: void,
        // legacy_octal_literals:      map[js_ast.E]logger.Range,

        // For lowering private methods
        // weak_map_ref: ?Ref,
        // weak_set_ref: ?Ref,
        // private_getters: RefRefMap,
        // private_setters: RefRefMap,

        // These are for TypeScript
        should_fold_numeric_constants: bool = false,
        emitted_namespace_vars: RefMap = RefMap{},
        is_exported_inside_namespace: RefRefMap = .{},
        known_enum_values: Map(Ref, _hash_map.StringHashMapUnmanaged(f64)) = .{},
        local_type_names: StringBoolMap = StringBoolMap{},

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
        enclosing_namespace_arg_ref: ?Ref = null,

        react_element_type: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        /// Symbol object
        es6_symbol_global: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_filename: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_runtime: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_factory: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_fragment: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_automatic: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsxs_runtime: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        jsx_classic: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },
        // only applicable when is_react_fast_refresh_enabled
        jsx_refresh_runtime: GeneratedSymbol = GeneratedSymbol{ .ref = Ref.None, .primary = Ref.None, .backup = Ref.None },

        solid: GetSolidJSSymbols(jsx_transform_type) = if (jsx_transform_type == JSXTransformType.solid) SolidJS{} else void{},

        bun_jsx_ref: Ref = Ref.None,

        // Imports (both ES6 and CommonJS) are tracked at the top level
        import_records: ImportRecordList,
        import_records_for_current_part: List(u32) = .{},
        export_star_import_records: List(u32) = .{},

        // These are for handling ES6 imports and exports
        es6_import_keyword: logger.Range = logger.Range.None,
        es6_export_keyword: logger.Range = logger.Range.None,
        enclosing_class_keyword: logger.Range = logger.Range.None,
        import_items_for_namespace: std.AutoHashMapUnmanaged(Ref, ImportItemForNamespaceMap) = .{},
        is_import_item: RefMap = .{},
        named_imports: NamedImportsType,
        named_exports: js_ast.Ast.NamedExports,
        import_namespace_cc_map: Map(ImportNamespaceCallOrConstruct, bool) = .{},

        // When we're only scanning the imports
        // If they're using the automatic JSX runtime
        // We won't know that we need to import JSX robustly because we don't track
        // symbol counts. Instead, we ask:
        // "Did we parse anything that looked like JSX"?
        // If yes, then automatically add the JSX import.
        needs_jsx_import: NeedsJSXType,

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
        scopes_in_order: ScopeOrderList = .{},

        // These properties are for the visit pass, which runs after the parse pass.
        // The visit pass binds identifiers to declared symbols, does constant
        // folding, substitutes compile-time variable definitions, and lowers certain
        // syntactic constructs as appropriate.
        stmt_expr_value: Expr.Data,
        call_target: Expr.Data,
        delete_target: Expr.Data,
        loop_body: Stmt.Data,
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
        await_target: ?js_ast.Expr.Data = null,

        to_expr_wrapper_namespace: Binding2ExprWrapper.Namespace,
        to_expr_wrapper_hoisted: Binding2ExprWrapper.Hoisted,

        // This helps recognize the "import().catch()" pattern. We also try to avoid
        // warning about this just like the "try { await import() }" pattern.
        then_catch_chain: ThenCatchChain,

        // Temporary variables used for lowering
        temp_refs_to_declare: List(TempRef) = .{},
        temp_ref_count: i32 = 0,

        // When bundling, hoisted top-level local variables declared with "var" in
        // nested scopes are moved up to be declared in the top-level scope instead.
        // The old "var" statements are turned into regular assignments instead. This
        // makes it easier to quickly scan the top-level statements for "var" locals
        // with the guarantee that all will be found.
        relocated_top_level_vars: List(js_ast.LocRef) = .{},

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
        import_transposer: ImportTransposer,
        require_transposer: RequireTransposer,
        require_resolve_transposer: RequireResolveTransposer,

        // This is a general place to put lots of Expr objects
        expr_list: List(Expr) = .{},

        scope_order_to_visit: []ScopeOrder = &([_]ScopeOrder{}),

        import_refs_to_always_trim_if_unused: RefArrayMap = .{},

        pub fn transposeImport(p: *P, arg: Expr, state: anytype) Expr {
            // The argument must be a string
            if (@as(Expr.Tag, arg.data) == .e_string) {
                // Ignore calls to import() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if (p.is_control_flow_dead) {
                    return p.e(E.Null{}, arg.loc);
                }

                const import_record_index = p.addImportRecord(.dynamic, arg.loc, arg.data.e_string.slice(p.allocator));
                p.import_records.items[import_record_index].handles_import_errors = (state.is_await_target and p.fn_or_arrow_data_visit.try_body_count != 0) or state.is_then_catch_target;
                p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;
                return p.e(E.Import{
                    .expr = arg,
                    .import_record_index = Ref.toInt(import_record_index),
                    // .leading_interior_comments = arg.getString().
                }, state.loc);
            }

            if (p.options.warn_about_unbundled_modules) {
                // Use a debug log so people can see this if they want to
                const r = js_lexer.rangeOfIdentifier(p.source, state.loc);
                p.log.addRangeDebug(p.source, r, "This \"import\" expression cannot be bundled because the argument is not a string literal") catch unreachable;
            }

            return p.e(E.Import{
                .expr = arg,
                .import_record_index = Ref.None.sourceIndex(),
            }, state.loc);
        }

        pub fn transposeRequireResolve(p: *P, arg: Expr, state: anytype) Expr {
            // The argument must be a string
            if (@as(Expr.Tag, arg.data) == .e_string) {
                // Ignore calls to import() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if (p.is_control_flow_dead) {
                    return p.e(E.Null{}, arg.loc);
                }

                const import_record_index = p.addImportRecord(.require, arg.loc, arg.data.e_string.string(p.allocator) catch unreachable);
                p.import_records.items[import_record_index].handles_import_errors = p.fn_or_arrow_data_visit.try_body_count != 0;
                p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;
                return p.e(E.RequireOrRequireResolve{
                    .import_record_index = Ref.toInt(import_record_index),
                    // .leading_interior_comments = arg.getString().
                }, arg.loc);
            }

            if (p.options.warn_about_unbundled_modules) {
                // Use a debug log so people can see this if they want to
                const r = js_lexer.rangeOfIdentifier(p.source, arg.loc);
                p.log.addRangeDebug(p.source, r, "This \"require.resolve\" expression cannot be bundled because the argument is not a string literal") catch unreachable;
            }

            return state;
        }

        pub fn transposeRequire(p: *P, arg: Expr, _: anytype) Expr {
            switch (arg.data) {
                .e_string => |str| {

                    // Ignore calls to require() if the control flow is provably dead here.
                    // We don't want to spend time scanning the required files if they will
                    // never be used.
                    if (p.is_control_flow_dead) {
                        return Expr{ .data = nullExprData, .loc = arg.loc };
                    }

                    const pathname = str.string(p.allocator) catch unreachable;

                    const import_record_index = p.addImportRecord(.require, arg.loc, pathname);
                    p.import_records.items[import_record_index].handles_import_errors = p.fn_or_arrow_data_visit.try_body_count != 0;
                    p.import_records_for_current_part.append(p.allocator, import_record_index) catch unreachable;

                    if (!p.options.transform_require_to_import) {
                        return p.e(E.Require{ .import_record_index = import_record_index }, arg.loc);
                    }

                    p.import_records.items[import_record_index].was_originally_require = true;
                    p.import_records.items[import_record_index].contains_import_star = true;

                    const symbol_name = p.import_records.items[import_record_index].path.name.nonUniqueNameString(p.allocator);
                    const cjs_import_name = std.fmt.allocPrint(
                        p.allocator,
                        "{s}_{x}_{d}",
                        .{
                            symbol_name,
                            @truncate(
                                u16,
                                std.hash.Wyhash.hash(
                                    0,
                                    p.import_records.items[import_record_index].path.text,
                                ),
                            ),
                            p.cjs_import_stmts.items.len,
                        },
                    ) catch unreachable;

                    const namespace_ref = p.declareSymbol(.hoisted, arg.loc, cjs_import_name) catch unreachable;

                    p.cjs_import_stmts.append(
                        p.s(
                            S.Import{
                                .namespace_ref = namespace_ref,
                                .star_name_loc = arg.loc,
                                .is_single_line = true,
                                .import_record_index = import_record_index,
                            },
                            arg.loc,
                        ),
                    ) catch unreachable;

                    const args = p.allocator.alloc(Expr, 1) catch unreachable;
                    args[0] = p.e(
                        E.ImportIdentifier{
                            .ref = namespace_ref,
                        },
                        arg.loc,
                    );

                    p.ignoreUsage(p.require_ref);

                    // require(import_object_assign)
                    return p.callRuntime(arg.loc, "__require", args);
                },
                else => {},
            }

            return arg;
        }

        fn isBindingUsed(p: *P, binding: Binding, default_export_ref: Ref) bool {
            switch (binding.data) {
                .b_identifier => |ident| {
                    if (default_export_ref.eql(ident.ref)) return true;
                    if (p.named_imports.contains(ident.ref))
                        return true;

                    for (p.named_exports.values()) |named_export| {
                        if (named_export.ref.eql(ident.ref))
                            return true;
                    }

                    const symbol: *const Symbol = &p.symbols.items[ident.ref.innerIndex()];
                    return symbol.use_count_estimate > 0;
                },
                .b_array => |array| {
                    for (array.items) |item| {
                        if (isBindingUsed(p, item.binding, default_export_ref)) {
                            return true;
                        }
                    }

                    return false;
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        if (isBindingUsed(p, prop.value, default_export_ref)) {
                            return true;
                        }
                    }

                    return false;
                },
                .b_property => |prop| {
                    return p.isBindingUsed(prop.value, default_export_ref);
                },

                .b_missing => return false,
            }
        }

        pub fn treeShake(p: *P, parts: *[]js_ast.Part, merge: bool) void {
            var parts_: []js_ast.Part = parts.*;
            defer {
                if (merge and parts_.len > 1) {
                    var first_none_part: usize = parts_.len;
                    var stmts_count: usize = 0;
                    for (parts_) |part, i| {
                        if (part.tag == .none) {
                            stmts_count += part.stmts.len;
                            first_none_part = @minimum(i, first_none_part);
                        }
                    }

                    if (first_none_part < parts_.len) {
                        var stmts_list = p.allocator.alloc(Stmt, stmts_count) catch unreachable;
                        var stmts_remain = stmts_list;

                        for (parts_) |part| {
                            if (part.tag == .none) {
                                std.mem.copy(Stmt, stmts_remain, part.stmts);
                                stmts_remain = stmts_remain[part.stmts.len..];
                            }
                        }

                        parts_[first_none_part].stmts = stmts_list;

                        parts_ = parts_[0 .. first_none_part + 1];
                    }
                }

                parts.* = parts_;
            }
            const default_export_ref =
                if (p.named_exports.get("default")) |default_| default_.ref else Ref.None;

            while (parts_.len > 1) {
                var parts_end: usize = 0;
                var last_end = parts_.len;

                for (parts_) |part| {
                    const is_dead = part.can_be_removed_if_unused and can_remove_part: {
                        for (part.stmts) |stmt| {
                            switch (stmt.data) {
                                .s_local => |local| {
                                    if (local.is_export) break :can_remove_part false;
                                    for (local.decls) |decl| {
                                        if (isBindingUsed(p, decl.binding, default_export_ref))
                                            break :can_remove_part false;
                                    }
                                },
                                .s_if => |if_statement| {
                                    const result = SideEffects.toBoolean(if_statement.test_.data);
                                    if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                        break :can_remove_part false;
                                    }
                                },
                                .s_while => |while_statement| {
                                    const result = SideEffects.toBoolean(while_statement.test_.data);
                                    if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                        break :can_remove_part false;
                                    }
                                },
                                .s_for => |for_statement| {
                                    if (for_statement.test_) |expr| {
                                        const result = SideEffects.toBoolean(expr.data);
                                        if (!(result.ok and result.side_effects == .no_side_effects and !result.value)) {
                                            break :can_remove_part false;
                                        }
                                    }
                                },
                                .s_function => |func| {
                                    if (func.func.flags.contains(.is_export)) break :can_remove_part false;
                                    if (func.func.name) |name| {
                                        const symbol: *const Symbol = &p.symbols.items[name.ref.?.innerIndex()];

                                        if (name.ref.?.eql(default_export_ref) or
                                            symbol.use_count_estimate > 0 or
                                            p.named_exports.contains(symbol.original_name) or
                                            p.named_imports.contains(name.ref.?) or
                                            p.is_import_item.get(name.ref.?) != null)
                                        {
                                            break :can_remove_part false;
                                        }
                                    }
                                },
                                .s_import,
                                .s_export_clause,
                                .s_export_from,
                                .s_export_default,
                                => break :can_remove_part false,

                                .s_class => |class| {
                                    if (class.is_export) break :can_remove_part false;
                                    if (class.class.class_name) |name| {
                                        const symbol: *const Symbol = &p.symbols.items[name.ref.?.innerIndex()];

                                        if (name.ref.?.eql(default_export_ref) or
                                            symbol.use_count_estimate > 0 or
                                            p.named_exports.contains(symbol.original_name) or
                                            p.named_imports.contains(name.ref.?) or
                                            p.is_import_item.get(name.ref.?) != null)
                                        {
                                            break :can_remove_part false;
                                        }
                                    }
                                },

                                else => break :can_remove_part false,
                            }
                        }
                        break :can_remove_part true;
                    };

                    if (is_dead) {
                        p.clearSymbolUsagesFromDeadPart(part);

                        continue;
                    }

                    parts_[parts_end] = part;
                    parts_end += 1;
                }

                parts_.len = parts_end;
                if (last_end == parts_.len) {
                    break;
                }
            }
        }

        const ImportTransposer = ExpressionTransposer(P, P.transposeImport);
        const RequireTransposer = ExpressionTransposer(P, P.transposeRequire);
        const RequireResolveTransposer = ExpressionTransposer(P, P.transposeRequireResolve);

        const Binding2ExprWrapper = struct {
            pub const Namespace = Binding.ToExpr(P, P.wrapIdentifierNamespace);
            pub const Hoisted = Binding.ToExpr(P, P.wrapIdentifierHoisting);
        };

        fn clearSymbolUsagesFromDeadPart(p: *P, part: js_ast.Part) void {
            var symbol_use_refs = part.symbol_uses.keys();
            var symbol_use_values = part.symbol_uses.values();
            var symbols = p.symbols.items;

            for (symbol_use_refs) |ref, i| {
                symbols[ref.innerIndex()].use_count_estimate -|= symbol_use_values[i].count_estimate;
            }

            for (part.declared_symbols) |declared| {
                symbols[declared.ref.innerIndex()].use_count_estimate = 0;
                // }
            }
        }

        pub fn s(_: *P, t: anytype, loc: logger.Loc) Stmt {
            const Type = @TypeOf(t);
            comptime {
                if (!is_typescript_enabled and (Type == S.TypeScript or Type == *S.TypeScript)) {
                    @compileError("Attempted to use TypeScript syntax in a non-TypeScript environment");
                }
            }

            if (!is_typescript_enabled and (Type == S.TypeScript or Type == *S.TypeScript)) {
                unreachable;
            }

            // Output.print("\nStmt: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
            if (@typeInfo(Type) == .Pointer) {
                // ExportFrom normally becomes import records during the visiting pass
                // However, we skip the visiting pass in this mode
                // So we must generate a minimum version of it here.
                if (comptime only_scan_imports_and_do_not_visit) {
                    // if (@TypeOf(t) == *S.ExportFrom) {
                    //     switch (call.target.data) {
                    //         .e_identifier => |ident| {
                    //             // is this a require("something")
                    //             if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args[0].data) == .e_string) {
                    //                 _ = p.addImportRecord(.require, loc, call.args[0].data.e_string.string(p.allocator) catch unreachable);
                    //             }
                    //         },
                    //         else => {},
                    //     }
                    // }
                }

                return Stmt.init(std.meta.Child(Type), t, loc);
            } else {
                return Stmt.alloc(Type, t, loc);
            }
        }

        pub fn e(p: *P, t: anytype, loc: logger.Loc) Expr {
            const Type = @TypeOf(t);

            comptime {
                if (jsx_transform_type == .none) {
                    if (Type == E.JSXElement or Type == *E.JSXElement) {
                        @compileError("JSXElement is not supported in this environment");
                    }
                }
            }

            // Output.print("\nExpr: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
            if (@typeInfo(Type) == .Pointer) {
                if (comptime only_scan_imports_and_do_not_visit) {
                    if (Type == *E.Call) {
                        const call: *E.Call = t;
                        switch (call.target.data) {
                            .e_identifier => |ident| {
                                // is this a require("something")
                                if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args.ptr[0].data) == .e_string) {
                                    _ = p.addImportRecord(.require, loc, call.args.first_().data.e_string.string(p.allocator) catch unreachable);
                                }
                            },
                            else => {},
                        }
                    }
                }
                return Expr.init(std.meta.Child(Type), t.*, loc);
            } else {
                if (comptime only_scan_imports_and_do_not_visit) {
                    if (Type == E.Call) {
                        const call: E.Call = t;
                        switch (call.target.data) {
                            .e_identifier => |ident| {
                                // is this a require("something")
                                if (strings.eqlComptime(p.loadNameFromRef(ident.ref), "require") and call.args.len == 1 and std.meta.activeTag(call.args.ptr[0].data) == .e_string) {
                                    _ = p.addImportRecord(.require, loc, call.args.first_().data.e_string.string(p.allocator) catch unreachable);
                                }
                            },
                            else => {},
                        }
                    }
                }
                return Expr.init(Type, t, loc);
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
            parser.import_namespace_cc_map.deinit();
            parser.scopes_in_order.deinit();
            parser.temp_refs_to_declare.deinit();
            parser.relocated_top_level_vars.deinit();
        }

        pub fn findSymbol(p: *P, loc: logger.Loc, name: string) !FindSymbolResult {
            var declare_loc: logger.Loc = undefined;
            var is_inside_with_scope = false;
            // This function can show up in profiling.
            // That's part of why we do this.
            // Instead of rehashing `name` for every scope, we do it just once.
            const hash = @TypeOf(p.module_scope.members).getHash(name);
            const allocator = p.allocator;

            const ref: Ref = brk: {
                var _scope: ?*Scope = p.current_scope;

                var did_forbid_argumen = false;

                while (_scope) |scope| : (_scope = _scope.?.parent) {

                    // Track if we're inside a "with" statement body
                    if (scope.kind == .with) {
                        is_inside_with_scope = true;
                    }

                    // Forbid referencing "arguments" inside class bodies
                    if (scope.forbid_arguments and !did_forbid_argumen and strings.eqlComptime(name, "arguments")) {
                        const r = js_lexer.rangeOfIdentifier(p.source, loc);
                        p.log.addRangeErrorFmt(p.source, r, allocator, "Cannot access \"{s}\" here", .{name}) catch unreachable;
                        did_forbid_argumen = true;
                    }

                    // Is the symbol a member of this scope?
                    if (scope.members.getWithHash(name, hash)) |member| {
                        declare_loc = member.loc;
                        break :brk member.ref;
                    }
                }

                // Allocate an "unbound" symbol
                p.checkForNonBMPCodePoint(loc, name);
                const _ref = p.newSymbol(.unbound, name) catch unreachable;
                declare_loc = loc;
                p.module_scope.members.putWithHash(allocator, name, hash, js_ast.Scope.Member{ .ref = _ref, .loc = logger.Loc.Empty }) catch unreachable;

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
            p.recordUsage(ref);

            return FindSymbolResult{
                .ref = ref,
                .declare_loc = declare_loc,
                .is_inside_with_scope = is_inside_with_scope,
            };
        }

        pub fn recordExportedBinding(p: *P, binding: Binding) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |ident| {
                    p.recordExport(binding.loc, p.symbols.items[ident.ref.innerIndex()].original_name, ident.ref) catch unreachable;
                },
                .b_array => |array| {
                    for (array.items) |prop| {
                        p.recordExportedBinding(prop.binding);
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        p.recordExportedBinding(prop.value);
                    }
                },
                else => {
                    p.panic("Unexpected binding export type {s}", .{binding});
                },
            }
        }

        // If we're auto-importing JSX and it's bundled, we use the bundled version
        // This means we need to transform from require(react) to react()
        // unless we're building inside of bun, then it's just normal commonjs
        pub inline fn callUnbundledRequire(p: *P, require_args: []Expr) Expr {
            return p.callRuntime(require_args[0].loc, "__require", require_args);
        }

        pub fn recordExport(p: *P, loc: logger.Loc, alias: string, ref: Ref) !void {
            if (p.named_exports.get(alias)) |name| {
                // Duplicate exports are an error
                var notes = try p.allocator.alloc(logger.Data, 1);
                notes[0] = logger.Data{
                    .text = try std.fmt.allocPrint(p.allocator, "\"{s}\" was originally exported here", .{alias}),
                    .location = logger.Location.init_or_nil(p.source, js_lexer.rangeOfIdentifier(p.source, name.alias_loc)),
                };
                try p.log.addRangeErrorFmtWithNotes(
                    p.source,
                    js_lexer.rangeOfIdentifier(p.source, loc),
                    p.allocator,
                    notes,
                    "Multiple exports with the same name \"{s}\"",
                    .{std.mem.trim(u8, alias, "\"'")},
                );
            } else {
                try p.named_exports.put(alias, js_ast.NamedExport{ .alias_loc = loc, .ref = ref });
            }
        }

        pub fn recordUsage(p: *P, ref: Ref) void {
            // The use count stored in the symbol is used for generating symbol names
            // during minification. These counts shouldn't include references inside dead
            // code regions since those will be culled.
            if (!p.is_control_flow_dead) {
                if (comptime Environment.allow_assert) assert(p.symbols.items.len > ref.innerIndex());
                p.symbols.items[ref.innerIndex()].use_count_estimate += 1;
                var result = p.symbol_uses.getOrPut(p.allocator, ref) catch unreachable;
                if (!result.found_existing) {
                    result.value_ptr.* = Symbol.Use{ .count_estimate = 1 };
                } else {
                    result.value_ptr.count_estimate += 1;
                }
            }

            // The correctness of TypeScript-to-JavaScript conversion relies on accurate
            // symbol use counts for the whole file, including dead code regions. This is
            // tracked separately in a parser-only data structure.
            if (is_typescript_enabled) {
                p.ts_use_counts.items[ref.innerIndex()] += 1;
            }
        }

        fn logArrowArgErrors(p: *P, errors: *DeferredArrowArgErrors) void {
            if (errors.invalid_expr_await.len > 0) {
                var r = errors.invalid_expr_await;
                p.log.addRangeError(p.source, r, "Cannot use an \"await\" expression here") catch unreachable;
            }

            if (errors.invalid_expr_yield.len > 0) {
                var r = errors.invalid_expr_yield;
                p.log.addRangeError(p.source, r, "Cannot use a \"yield\" expression here") catch unreachable;
            }
        }

        fn keyNameForError(p: *P, key: js_ast.Expr) string {
            switch (key.data) {
                .e_string => {
                    return key.data.e_string.string(p.allocator) catch unreachable;
                },
                .e_private_identifier => |private| {
                    return p.loadNameFromRef(private.ref);
                    // return p.loadNameFromRef()
                },
                else => {
                    return "property";
                },
            }
        }

        pub fn handleIdentifier(p: *P, loc: logger.Loc, ident: E.Identifier, _original_name: ?string, opts: IdentifierOpts) Expr {
            const ref = ident.ref;

            if ((opts.assign_target != .none or opts.is_delete_target) and p.symbols.items[ref.innerIndex()].kind == .import) {
                // Create an error for assigning to an import namespace
                const r = js_lexer.rangeOfIdentifier(p.source, loc);
                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot assign to import \"{s}\"", .{
                    p.symbols.items[ref.innerIndex()].original_name,
                }) catch unreachable;
            }

            // Substitute an EImportIdentifier now if this is an import item
            if (p.is_import_item.contains(ref)) {
                return p.e(
                    E.ImportIdentifier{ .ref = ref, .was_originally_identifier = opts.was_originally_identifier },
                    loc,
                );
            }

            // Substitute a namespace export reference now if appropriate
            if (is_typescript_enabled) {
                if (p.is_exported_inside_namespace.get(ref)) |ns_ref| {
                    const name = p.symbols.items[ref.innerIndex()].original_name;

                    // If this is a known enum value, inline the value of the enum
                    if (p.known_enum_values.get(ns_ref)) |enum_values| {
                        if (enum_values.get(name)) |number| {
                            return p.e(E.Number{ .value = number }, loc);
                        }
                    }

                    // Otherwise, create a property access on the namespace
                    p.recordUsage(ns_ref);

                    return p.e(E.Dot{ .target = p.e(E.Identifier{ .ref = ns_ref }, loc), .name = name, .name_loc = loc }, loc);
                }
            }

            if (_original_name) |original_name| {
                const result = p.findSymbol(loc, original_name) catch unreachable;
                var _ident = ident;
                _ident.ref = result.ref;
                return p.e(_ident, loc);
            }

            return p.e(ident, loc);
        }

        pub fn generateImportStmt(
            p: *P,
            import_path: string,
            imports: anytype,
            parts: *ListManaged(js_ast.Part),
            symbols: anytype,
            additional_stmt: ?Stmt,
            comptime suffix: string,
            comptime is_internal: bool,
        ) !void {
            const allocator = p.allocator;
            const import_record_i = p.addImportRecordByRange(.stmt, logger.Range.None, import_path);
            var import_record: *ImportRecord = &p.import_records.items[import_record_i];
            import_record.path.namespace = "runtime";
            import_record.is_internal = is_internal;
            var import_path_identifier = try import_record.path.name.nonUniqueNameString(allocator);
            var namespace_identifier = try allocator.alloc(u8, import_path_identifier.len + suffix.len);
            var clause_items = try allocator.alloc(js_ast.ClauseItem, imports.len);
            var stmts = try allocator.alloc(Stmt, 1 + if (additional_stmt != null) @as(usize, 1) else @as(usize, 0));
            var declared_symbols = try allocator.alloc(js_ast.DeclaredSymbol, imports.len);
            std.mem.copy(u8, namespace_identifier[0..suffix.len], suffix);
            std.mem.copy(
                u8,
                namespace_identifier[suffix.len..namespace_identifier.len],
                import_path_identifier[0..import_path_identifier.len],
            );

            const namespace_ref = try p.newSymbol(.other, namespace_identifier);
            try p.module_scope.generated.append(allocator, namespace_ref);
            for (imports) |alias, i| {
                const ref = symbols.get(alias) orelse unreachable;
                const alias_name = if (@TypeOf(symbols) == RuntimeImports) RuntimeImports.all[alias] else alias;
                clause_items[i] = js_ast.ClauseItem{
                    .alias = alias_name,
                    .original_name = alias_name,
                    .alias_loc = logger.Loc{},
                    .name = LocRef{ .ref = ref, .loc = logger.Loc{} },
                };
                declared_symbols[i] = js_ast.DeclaredSymbol{ .ref = ref, .is_top_level = true };
                try p.is_import_item.put(allocator, ref, .{});
                try p.named_imports.put(ref, js_ast.NamedImport{
                    .alias = alias_name,
                    .alias_loc = logger.Loc{},
                    .namespace_ref = null,
                    .import_record_index = import_record_i,
                });
            }

            stmts[0] = p.s(S.Import{
                .namespace_ref = namespace_ref,
                .items = clause_items,
                .import_record_index = import_record_i,
            }, logger.Loc{});
            if (additional_stmt) |add| {
                stmts[1] = add;
            }

            var import_records = try allocator.alloc(@TypeOf(import_record_i), 1);
            import_records[0] = import_record_i;

            // Append a single import to the end of the file (ES6 imports are hoisted
            // so we don't need to worry about where the import statement goes)
            parts.append(js_ast.Part{
                .stmts = stmts,
                .declared_symbols = declared_symbols,
                .import_record_indices = import_records,
                .tag = .runtime,
            }) catch unreachable;
        }

        pub fn prepareForVisitPass(p: *P) !void {
            {
                var count: usize = 0;
                for (p.scopes_in_order.items) |item| {
                    if (item != null) {
                        count += 1;
                    }
                }
                var i: usize = 0;
                p.scope_order_to_visit = try p.allocator.alloc(ScopeOrder, p.scopes_in_order.items.len);
                for (p.scopes_in_order.items) |item| {
                    if (item) |_item| {
                        p.scope_order_to_visit[i] = _item;
                        i += 1;
                    }
                }
            }

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

            var generated_symbols_count: u32 = 3;

            if (p.options.enable_bundling) {
                generated_symbols_count += 4;
            }

            if (p.options.features.hot_module_reloading) {
                generated_symbols_count += 3;

                if (p.options.features.react_fast_refresh) {
                    generated_symbols_count += 1;
                }
            }

            if (is_jsx_enabled) {
                generated_symbols_count += 7;

                if (p.options.jsx.development) generated_symbols_count += 1;
            }

            try p.module_scope.generated.ensureUnusedCapacity(p.allocator, generated_symbols_count * 3);
            try p.module_scope.members.ensureCapacity(p.allocator, generated_symbols_count * 3 + p.module_scope.members.count());

            p.exports_ref = try p.declareCommonJSSymbol(.hoisted, "exports");
            p.module_ref = try p.declareCommonJSSymbol(.hoisted, "module");
            p.require_ref = try p.declareCommonJSSymbol(.unbound, "require");
            p.dirname_ref = try p.declareCommonJSSymbol(.unbound, "__dirname");
            p.filename_ref = try p.declareCommonJSSymbol(.unbound, "__filename");

            if (p.options.enable_bundling) {
                p.runtime_imports.__reExport = try p.declareGeneratedSymbol(.other, "__reExport");
                p.runtime_imports.@"$$m" = try p.declareGeneratedSymbol(.other, "$$m");

                p.runtime_imports.@"$$lzy" = try p.declareGeneratedSymbol(.other, "$$lzy");

                p.runtime_imports.__export = try p.declareGeneratedSymbol(.other, "__export");
                p.runtime_imports.__exportValue = try p.declareGeneratedSymbol(.other, "__exportValue");
                p.runtime_imports.__exportDefault = try p.declareGeneratedSymbol(.other, "__exportDefault");
            }

            if (p.options.features.hot_module_reloading) {
                p.hmr_module = try p.declareGeneratedSymbol(.other, "hmr");
                if (p.options.features.react_fast_refresh) {
                    if (p.options.jsx.use_embedded_refresh_runtime) {
                        p.runtime_imports.__FastRefreshRuntime = try p.declareGeneratedSymbol(.other, "__FastRefreshRuntime");
                        p.recordUsage(p.runtime_imports.__FastRefreshRuntime.?.ref);
                        p.jsx_refresh_runtime = p.runtime_imports.__FastRefreshRuntime.?;
                    } else {
                        p.jsx_refresh_runtime = try p.declareGeneratedSymbol(.other, "Refresher");
                    }

                    p.runtime_imports.__FastRefreshModule = try p.declareGeneratedSymbol(.other, "__FastRefreshModule");
                    p.recordUsage(p.runtime_imports.__FastRefreshModule.?.ref);
                } else {
                    p.runtime_imports.__HMRModule = try p.declareGeneratedSymbol(.other, "__HMRModule");
                    p.recordUsage(p.runtime_imports.__HMRModule.?.ref);
                }

                p.runtime_imports.__HMRClient = try p.declareGeneratedSymbol(.other, "__HMRClient");
                p.recordUsage(p.hmr_module.ref);
                p.recordUsage(p.runtime_imports.__HMRClient.?.ref);
            }

            switch (comptime jsx_transform_type) {
                .react => {
                    if (p.options.jsx.development) {
                        p.jsx_filename = p.declareGeneratedSymbol(.other, "jsxFilename") catch unreachable;
                    }

                    if (p.options.features.jsx_optimization_inline) {
                        p.react_element_type = p.declareGeneratedSymbol(.other, "REACT_ELEMENT_TYPE") catch unreachable;
                        p.es6_symbol_global = p.declareGeneratedSymbol(.unbound, "Symbol") catch unreachable;
                    }
                    p.jsx_fragment = p.declareGeneratedSymbol(.other, "Fragment") catch unreachable;
                    p.jsx_runtime = p.declareGeneratedSymbol(.other, "jsx") catch unreachable;
                    p.jsxs_runtime = p.declareGeneratedSymbol(.other, "jsxs") catch unreachable;
                    p.jsx_factory = p.declareGeneratedSymbol(.other, "Factory") catch unreachable;

                    if (p.options.jsx.factory.len > 1 or FeatureFlags.jsx_runtime_is_cjs) {
                        p.jsx_classic = p.declareGeneratedSymbol(.other, "ClassicImportSource") catch unreachable;
                    }

                    if (p.options.jsx.import_source.len > 0) {
                        p.jsx_automatic = p.declareGeneratedSymbol(.other, "ImportSource") catch unreachable;
                    }
                },
                .solid => {
                    p.solid.insert = p.declareGeneratedSymbol(.other, "insert") catch unreachable;
                    p.solid.template = p.declareGeneratedSymbol(.other, "template") catch unreachable;
                    p.solid.wrap = p.declareGeneratedSymbol(.other, "wrap") catch unreachable;
                    p.solid.namespace = p.declareGeneratedSymbol(.other, "Solid") catch unreachable;
                    p.solid.delegateEvents = p.declareGeneratedSymbol(.other, "delegateEvents") catch unreachable;
                    p.solid.createComponent = p.declareGeneratedSymbol(.other, "createComponent") catch unreachable;
                    p.solid.setAttribute = p.declareGeneratedSymbol(.other, "setAttribute") catch unreachable;
                    p.solid.effect = p.declareGeneratedSymbol(.other, "effect") catch unreachable;
                    p.solid.stack.current_template_string = MutableString.initEmpty(p.allocator);
                    p.solid.stack.buffered_writer = p.solid.stack.current_template_string.bufferedWriter();
                },
                .macro => {
                    p.bun_jsx_ref = p.declareSymbol(.other, logger.Loc.Empty, "bunJSX") catch unreachable;
                    BunJSX.bun_jsx_identifier = E.Identifier{
                        .ref = p.bun_jsx_ref,
                        .can_be_removed_if_unused = true,
                        .call_can_be_unwrapped_if_unused = true,
                    };
                    p.jsx_fragment = p.declareGeneratedSymbol(.other, "Fragment") catch unreachable;
                },
                else => {},
            }
        }

        // This won't work for adversarial cases
        pub fn resolveGeneratedSymbol(p: *P, generated_symbol: *GeneratedSymbol) void {
            if (generated_symbol.ref.isNull()) return;

            if (p.symbols.items[generated_symbol.primary.innerIndex()].use_count_estimate == 0 and
                p.symbols.items[generated_symbol.primary.innerIndex()].link.isNull())
            {
                p.symbols.items[generated_symbol.ref.innerIndex()].original_name = p.symbols.items[generated_symbol.primary.innerIndex()].original_name;
                return;
            }

            if (p.symbols.items[generated_symbol.backup.innerIndex()].use_count_estimate == 0 and
                p.symbols.items[generated_symbol.backup.innerIndex()].link.isNull())
            {
                p.symbols.items[generated_symbol.ref.innerIndex()].original_name = p.symbols.items[generated_symbol.backup.innerIndex()].original_name;
                return;
            }
        }

        pub fn resolveCommonJSSymbols(p: *P) void {
            if (p.runtime_imports.__require) |*require| {
                p.resolveGeneratedSymbol(require);
            } else if (p.symbols.items[p.require_ref.innerIndex()].use_count_estimate == 0 and
                p.symbols.items[p.require_ref.innerIndex()].link.isNull())
            {
                // ensure our unused require() never collides with require()
                p.symbols.items[p.require_ref.innerIndex()].original_name = "__require";
            }
        }

        pub fn resolveBundlingSymbols(p: *P) void {
            p.recordUsage(p.runtime_imports.@"$$m".?.ref);

            p.resolveGeneratedSymbol(&p.runtime_imports.__reExport.?);
            p.resolveGeneratedSymbol(&p.runtime_imports.@"$$m".?);
            p.resolveGeneratedSymbol(&p.runtime_imports.@"$$lzy".?);
            p.resolveGeneratedSymbol(&p.runtime_imports.__export.?);
            p.resolveGeneratedSymbol(&p.runtime_imports.__exportValue.?);
            p.resolveGeneratedSymbol(&p.runtime_imports.__exportDefault.?);
        }

        pub fn resolveHMRSymbols(p: *P) void {
            p.resolveGeneratedSymbol(&p.hmr_module);
            if (p.runtime_imports.__FastRefreshModule != null) {
                p.resolveGeneratedSymbol(&p.runtime_imports.__FastRefreshModule.?);
                if (p.options.jsx.use_embedded_refresh_runtime)
                    p.resolveGeneratedSymbol(&p.runtime_imports.__FastRefreshRuntime.?);
            }
            if (p.runtime_imports.__HMRModule != null) p.resolveGeneratedSymbol(&p.runtime_imports.__HMRModule.?);
            if (p.runtime_imports.__HMRClient != null) p.resolveGeneratedSymbol(&p.runtime_imports.__HMRClient.?);
        }

        pub fn resolveStaticJSXSymbols(p: *P) void {
            if (p.options.features.jsx_optimization_inline) {
                p.resolveGeneratedSymbol(&p.react_element_type);
                p.resolveGeneratedSymbol(&p.es6_symbol_global);
                if (p.runtime_imports.__merge) |*merge| {
                    p.resolveGeneratedSymbol(merge);
                }
            }
            p.resolveGeneratedSymbol(&p.jsx_runtime);
            p.resolveGeneratedSymbol(&p.jsxs_runtime);
            p.resolveGeneratedSymbol(&p.jsx_factory);
            p.resolveGeneratedSymbol(&p.jsx_fragment);
            p.resolveGeneratedSymbol(&p.jsx_classic);
            p.resolveGeneratedSymbol(&p.jsx_automatic);
            p.resolveGeneratedSymbol(&p.jsx_filename);
        }

        fn hoistSymbols(p: *P, scope: *js_ast.Scope) void {
            if (!scope.kindStopsHoisting()) {
                var iter = scope.members.iterator();
                const allocator = p.allocator;
                nextMember: while (iter.next()) |res| {
                    var symbol = &p.symbols.items[res.value.ref.innerIndex()];
                    if (!symbol.isHoisted()) {
                        continue :nextMember;
                    }

                    // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
                    var __scope = scope.parent;

                    var hash: u64 = undefined;
                    if (__scope) |_scope| {
                        hash = @TypeOf(_scope.members).getHash(symbol.original_name);
                    }

                    while (__scope) |_scope| {
                        // Variable declarations hoisted past a "with" statement may actually end
                        // up overwriting a property on the target of the "with" statement instead
                        // of initializing the variable. We must not rename them or we risk
                        // causing a behavior change.
                        //
                        //   var obj = { foo: 1 }
                        //   with (obj) { var foo = 2 }
                        //   assert(foo === undefined)
                        //   assert(obj.foo === 2)
                        //
                        if (_scope.kind == .with) {
                            symbol.must_not_be_renamed = true;
                        }

                        if (_scope.members.getEntryWithHash(symbol.original_name, hash)) |existing_member_entry| {
                            const existing_member = &existing_member_entry.value;
                            const existing_symbol: *const Symbol = &p.symbols.items[existing_member.ref.innerIndex()];

                            // We can hoist the symbol from the child scope into the symbol in
                            // this scope if:
                            //
                            //   - The symbol is unbound (i.e. a global variable access)
                            //   - The symbol is also another hoisted variable
                            //   - The symbol is a function of any kind and we're in a function or module scope
                            //
                            // Is this unbound (i.e. a global access) or also hoisted?
                            if (existing_symbol.kind == .unbound or existing_symbol.kind == .hoisted or
                                (Symbol.isKindFunction(existing_symbol.kind) and (_scope.kind == .entry or _scope.kind == .function_body)))
                            {
                                // Silently merge this symbol into the existing symbol
                                symbol.link = existing_member.ref;
                                continue :nextMember;
                            }

                            // Otherwise if this isn't a catch identifier, it's a collision
                            if (existing_symbol.kind != .catch_identifier) {

                                // An identifier binding from a catch statement and a function
                                // declaration can both silently shadow another hoisted symbol
                                if (symbol.kind != .catch_identifier and symbol.kind != .hoisted_function) {
                                    const r = js_lexer.rangeOfIdentifier(p.source, res.value.loc);
                                    var notes = allocator.alloc(logger.Data, 1) catch unreachable;
                                    notes[0] =
                                        logger.rangeData(
                                        p.source,
                                        r,
                                        std.fmt.allocPrint(
                                            allocator,
                                            "{s} was originally declared here",
                                            .{existing_symbol.original_name},
                                        ) catch unreachable,
                                    );

                                    p.log.addRangeErrorFmtWithNotes(p.source, js_lexer.rangeOfIdentifier(p.source, existing_member_entry.value.loc), allocator, notes, "{s} has already been declared", .{symbol.original_name}) catch unreachable;
                                }

                                continue :nextMember;
                            }
                        }

                        if (_scope.kindStopsHoisting()) {
                            _scope.members.putWithHash(allocator, symbol.original_name, hash, res.value) catch unreachable;
                            break;
                        }
                        __scope = _scope.parent;
                    }
                }
            }

            for (scope.children.items) |_, i| {
                p.hoistSymbols(scope.children.items[i]);
            }
        }

        inline fn nextScopeInOrderForVisitPass(p: *P) ScopeOrder {
            const head = p.scope_order_to_visit[0];
            p.scope_order_to_visit = p.scope_order_to_visit[1..p.scope_order_to_visit.len];
            return head;
        }

        fn pushScopeForVisitPass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !void {
            // Output.print("\n+Loc: {d}\n", .{loc.start});
            // for (p.scopes_in_order.items[p.scopes_in_order_visitor_index..p.scopes_in_order.items.len]) |scope_order, i| {
            //     if (scope_order) |ord| {
            //         Output.print("Scope ({d}, {d})\n", .{ @enumToInt(ord.scope.kind), ord.loc.start });
            //     }
            // }
            const order = p.nextScopeInOrderForVisitPass();

            // Sanity-check that the scopes generated by the first and second passes match
            if (order.loc.start != loc.start or order.scope.kind != kind) {
                p.panic("Expected scope ({s}, {d}) in {s}, found scope ({s}, {d})", .{ kind, loc.start, p.source.path.pretty, order.scope.kind, order.loc.start });
            }

            p.current_scope = order.scope;

            try p.scopes_for_current_part.append(p.allocator, order.scope);
        }

        fn pushScopeForParsePass(p: *P, comptime kind: js_ast.Scope.Kind, loc: logger.Loc) !usize {
            var parent: *Scope = p.current_scope;
            const allocator = p.allocator;
            var scope = try allocator.create(Scope);

            scope.* = Scope{
                .kind = kind,
                .label_ref = null,
                .parent = parent,
                .generated = .{},
            };

            try parent.children.append(allocator, scope);
            scope.strict_mode = parent.strict_mode;

            p.current_scope = scope;

            if (comptime !Environment.isRelease) {
                // Enforce that scope locations are strictly increasing to help catch bugs
                // where the pushed scopes are mistmatched between the first and second passes
                if (p.scopes_in_order.items.len > 0) {
                    var last_i = p.scopes_in_order.items.len - 1;
                    while (p.scopes_in_order.items[last_i] == null and last_i > 0) {
                        last_i -= 1;
                    }

                    if (p.scopes_in_order.items[last_i]) |prev_scope| {
                        if (prev_scope.loc.start >= loc.start) {
                            p.panic("Scope location {d} must be greater than {d}", .{ loc.start, prev_scope.loc.start });
                        }
                    }
                }
            }

            // Copy down function arguments into the function body scope. That way we get
            // errors if a statement in the function body tries to re-declare any of the
            // arguments.
            if (comptime kind == js_ast.Scope.Kind.function_body) {
                if (comptime Environment.allow_assert)
                    assert(parent.kind == js_ast.Scope.Kind.function_args);

                var iter = scope.parent.?.members.iterator();
                while (iter.next()) |entry| {
                    // 	// Don't copy down the optional function expression name. Re-declaring
                    // 	// the name of a function expression is allowed.
                    const adjacent_kind = p.symbols.items[entry.value.ref.innerIndex()].kind;
                    if (adjacent_kind != .hoisted_function) {
                        try scope.members.put(allocator, entry.key, entry.value);
                    }
                }
            }

            // Remember the length in case we call popAndDiscardScope() later
            const scope_index = p.scopes_in_order.items.len;
            try p.scopes_in_order.append(allocator, ScopeOrder{ .loc = loc, .scope = scope });
            // Output.print("\nLoc: {d}\n", .{loc.start});
            return scope_index;
        }

        // Note: do not write to "p.log" in this function. Any errors due to conversion
        // from expression to binding should be written to "invalidLog" instead. That
        // way we can potentially keep this as an expression if it turns out it's not
        // needed as a binding after all.
        fn convertExprToBinding(p: *P, expr: ExprNodeIndex, invalid_loc: *LocList) ?Binding {
            switch (expr.data) {
                .e_missing => {
                    return null;
                },
                .e_identifier => |ex| {
                    return p.b(B.Identifier{ .ref = ex.ref }, expr.loc);
                },
                .e_array => |ex| {
                    if (ex.comma_after_spread) |spread| {
                        invalid_loc.append(.{
                            .loc = spread,
                            .kind = .spread,
                        }) catch unreachable;
                    }

                    if (ex.is_parenthesized) {
                        invalid_loc.append(.{
                            .loc = p.source.rangeOfOperatorBefore(expr.loc, "(").loc,
                            .kind = .parenthese,
                        }) catch unreachable;
                    }

                    // p.markSyntaxFeature(Destructing)
                    var items = List(js_ast.ArrayBinding).initCapacity(p.allocator, ex.items.len) catch unreachable;
                    var is_spread = false;
                    for (ex.items.slice()) |_, i| {
                        var item = ex.items.ptr[i];
                        if (item.data == .e_spread) {
                            is_spread = true;
                            item = item.data.e_spread.value;
                        }
                        const res = p.convertExprToBindingAndInitializer(&item, invalid_loc, is_spread);

                        items.appendAssumeCapacity(js_ast.ArrayBinding{
                            // It's valid for it to be missing
                            // An example:
                            //      Promise.all(promises).then(([, len]) => true);
                            //                                   ^ Binding is missing there
                            .binding = res.binding orelse p.b(B.Missing{}, item.loc),
                            .default_value = res.expr,
                        });
                    }

                    return p.b(B.Array{
                        .items = items.items,
                        .has_spread = is_spread,
                        .is_single_line = ex.is_single_line,
                    }, expr.loc);
                },
                .e_object => |ex| {
                    if (ex.comma_after_spread) |sp| {
                        invalid_loc.append(.{ .loc = sp, .kind = .spread }) catch unreachable;
                    }

                    if (ex.is_parenthesized) {
                        invalid_loc.append(.{ .loc = p.source.rangeOfOperatorBefore(expr.loc, "(").loc, .kind = .parenthese }) catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                    var properties = List(B.Property).initCapacity(p.allocator, ex.properties.len) catch unreachable;
                    for (ex.properties.slice()) |*item| {
                        if (item.flags.contains(.is_method) or item.kind == .get or item.kind == .set) {
                            invalid_loc.append(.{
                                .loc = item.key.?.loc,
                                .kind = if (item.flags.contains(.is_method))
                                    InvalidLoc.Tag.method
                                else if (item.kind == .get)
                                    InvalidLoc.Tag.getter
                                else
                                    InvalidLoc.Tag.setter,
                            }) catch unreachable;
                            continue;
                        }
                        var value = &item.value.?;
                        const tup = p.convertExprToBindingAndInitializer(value, invalid_loc, false);
                        const initializer = tup.expr orelse item.initializer;
                        const is_spread = item.kind == .spread or item.flags.contains(.is_spread);
                        properties.appendAssumeCapacity(B.Property{
                            .flags = Flags.Property.init(.{
                                .is_spread = is_spread,
                                .is_computed = item.flags.contains(.is_computed),
                            }),
                            .key = item.key orelse p.e(E.Missing{}, expr.loc),
                            .value = tup.binding orelse p.b(B.Missing{}, expr.loc),
                            .default_value = initializer,
                        });
                    }

                    return p.b(B.Object{
                        .properties = properties.items,
                        .is_single_line = ex.is_single_line,
                    }, expr.loc);
                },
                else => {
                    invalid_loc.append(.{ .loc = expr.loc, .kind = .unknown }) catch unreachable;
                    return null;
                },
            }

            return null;
        }

        fn convertExprToBindingAndInitializer(p: *P, _expr: *ExprNodeIndex, invalid_log: *LocList, is_spread: bool) ExprBindingTuple {
            var initializer: ?ExprNodeIndex = null;
            var expr = _expr;
            // zig syntax is sometimes painful
            switch (expr.*.data) {
                .e_binary => |bin| {
                    if (bin.op == .bin_assign) {
                        initializer = bin.right;
                        expr = &bin.left;
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

        fn forbidLexicalDecl(p: *P, loc: logger.Loc) !void {
            try p.log.addError(p.source, loc, "Cannot use a declaration in a single-statement context");
        }

        /// If we attempt to parse TypeScript syntax outside of a TypeScript file
        /// make it a compile error
        inline fn markTypeScriptOnly(_: *const P) void {
            if (comptime !is_typescript_enabled) {
                @compileError("This function can only be used in TypeScript");
            }

            // explicitly mark it as unreachable in the hopes that the function doesn't exist at all
            if (!is_typescript_enabled) {
                unreachable;
            }
        }

        fn logExprErrors(p: *P, errors: *DeferredErrors) void {
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

        // This assumes the "function" token has already been parsed

        fn parseFnStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, asyncRange: ?logger.Range) !Stmt {
            const is_generator = p.lexer.token == T.t_asterisk;
            const is_async = asyncRange != null;

            if (is_generator) {
                // p.markSyntaxFeature(compat.Generator, p.lexer.Range())
                try p.lexer.next();
            } else if (is_async) {
                // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
            }

            switch (opts.lexical_decl) {
                .forbid => {
                    try p.forbidLexicalDecl(loc);
                },

                // Allow certain function statements in certain single-statement contexts
                .allow_fn_inside_if, .allow_fn_inside_label => {
                    if (opts.is_typescript_declare or is_generator or is_async) {
                        try p.forbidLexicalDecl(loc);
                    }
                },
                else => {},
            }

            var name: ?js_ast.LocRef = null;
            var nameText: string = "";

            // The name is optional for "export default function() {}" pseudo-statements
            if (!opts.is_name_optional or p.lexer.token == T.t_identifier) {
                var nameLoc = p.lexer.loc();
                nameText = p.lexer.identifier;
                try p.lexer.expect(T.t_identifier);
                // Difference
                const ref = try p.newSymbol(Symbol.Kind.other, nameText);
                name = js_ast.LocRef{
                    .loc = nameLoc,
                    .ref = ref,
                };
            }

            // Even anonymous functions can have TypeScript type parameters
            if (is_typescript_enabled) {
                try p.skipTypeScriptTypeParameters();
            }

            // Introduce a fake block scope for function declarations inside if statements
            var ifStmtScopeIndex: usize = 0;
            var hasIfScope = opts.lexical_decl == .allow_fn_inside_if;
            if (hasIfScope) {
                ifStmtScopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.block, loc);
            }

            var scopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.function_args, p.lexer.loc());
            var func = try p.parseFn(name, FnOrArrowDataParse{
                .async_range = asyncRange orelse logger.Range.None,
                .has_async_range = asyncRange != null,
                .allow_await = if (is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .allow_yield = if (is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .is_typescript_declare = opts.is_typescript_declare,

                // Only allow omitting the body if we're parsing TypeScript
                .allow_missing_body_for_type_script = is_typescript_enabled,
            });

            if (comptime is_typescript_enabled) {
                // Don't output anything if it's just a forward declaration of a function
                if (opts.is_typescript_declare or func.flags.contains(.is_forward_declaration)) {
                    p.popAndDiscardScope(scopeIndex);

                    // Balance the fake block scope introduced above
                    if (hasIfScope) {
                        p.popScope();
                    }

                    if (opts.is_typescript_declare and opts.is_namespace_scope and opts.is_export) {
                        p.has_non_local_export_declare_inside_namespace = true;
                    }

                    return p.s(S.TypeScript{}, loc);
                }
            }

            p.popScope();

            // Only declare the function after we know if it had a body or not. Otherwise
            // TypeScript code such as this will double-declare the symbol:
            //
            //     function foo(): void;
            //     function foo(): void {}
            //
            if (name) |*name_| {
                const kind = if (is_generator or is_async) Symbol.Kind.generator_or_async_function else Symbol.Kind.hoisted_function;
                name_.ref = try p.declareSymbol(kind, name_.loc, nameText);
                func.name = name_.*;
            }

            func.flags.setPresent(.has_if_scope, hasIfScope);
            func.flags.setPresent(.is_export, opts.is_export);

            // Balance the fake block scope introduced above
            if (hasIfScope) {
                p.popScope();
            }

            return p.s(S.Function{
                .func = func,
            }, func.open_parens_loc);
        }

        fn popAndDiscardScope(p: *P, scope_index: usize) void {
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
                p.panic("Internal error", .{});
            }

            _ = children.popOrNull();
        }

        fn parseFn(p: *P, name: ?js_ast.LocRef, opts: FnOrArrowDataParse) anyerror!G.Fn {
            // if data.allowAwait and data.allowYield {
            // 	p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
            // }

            var func = G.Fn{
                .name = name,

                .flags = Flags.Function.init(.{
                    .has_rest_arg = false,
                    .is_async = opts.allow_await == .allow_expr,
                    .is_generator = opts.allow_yield == .allow_expr,
                }),

                .arguments_ref = null,
                .open_parens_loc = p.lexer.loc(),
            };
            try p.lexer.expect(T.t_open_paren);

            // Await and yield are not allowed in function arguments
            var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);

            p.fn_or_arrow_data_parse.allow_await = if (opts.allow_await == .allow_expr)
                AwaitOrYield.forbid_all
            else
                AwaitOrYield.allow_ident;

            p.fn_or_arrow_data_parse.allow_yield = if (opts.allow_yield == .allow_expr)
                AwaitOrYield.forbid_all
            else
                AwaitOrYield.allow_ident;

            // If "super()" is allowed in the body, it's allowed in the arguments
            p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;
            p.fn_or_arrow_data_parse.allow_super_property = opts.allow_super_property;

            var args = List(G.Arg){};
            while (p.lexer.token != T.t_close_paren) {
                // Skip over "this" type annotations
                if (is_typescript_enabled and p.lexer.token == T.t_this) {
                    try p.lexer.next();
                    if (p.lexer.token == T.t_colon) {
                        try p.lexer.next();
                        try p.skipTypeScriptType(js_ast.Op.Level.lowest);
                    }
                    if (p.lexer.token != T.t_comma) {
                        break;
                    }

                    try p.lexer.next();
                    continue;
                }

                var ts_decorators: []ExprNodeIndex = &([_]ExprNodeIndex{});
                if (opts.allow_ts_decorators) {
                    ts_decorators = try p.parseTypeScriptDecorators();
                }

                if (!func.flags.contains(.has_rest_arg) and p.lexer.token == T.t_dot_dot_dot) {
                    // p.markSyntaxFeature
                    try p.lexer.next();
                    func.flags.insert(.has_rest_arg);
                }

                var is_typescript_ctor_field = false;
                var is_identifier = p.lexer.token == T.t_identifier;
                var text = p.lexer.identifier;
                var arg = try p.parseBinding();

                if (comptime is_typescript_enabled) {
                    if (is_identifier and opts.is_constructor) {
                        // Skip over TypeScript accessibility modifiers, which turn this argument
                        // into a class field when used inside a class constructor. This is known
                        // as a "parameter property" in TypeScript.
                        while (true) {
                            switch (p.lexer.token) {
                                .t_identifier, .t_open_brace, .t_open_bracket => {
                                    if (!js_lexer.TypeScriptAccessibilityModifier.has(text)) {
                                        break;
                                    }

                                    is_typescript_ctor_field = true;

                                    // TypeScript requires an identifier binding
                                    if (p.lexer.token != .t_identifier) {
                                        try p.lexer.expect(.t_identifier);
                                    }
                                    text = p.lexer.identifier;

                                    // Re-parse the binding (the current binding is the TypeScript keyword)
                                    arg = try p.parseBinding();
                                },
                                else => {
                                    break;
                                },
                            }
                        }
                    }

                    // "function foo(a?) {}"
                    if (p.lexer.token == .t_question) {
                        try p.lexer.next();
                    }

                    // "function foo(a: any) {}"
                    if (p.lexer.token == .t_colon) {
                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    }
                }

                var parseStmtOpts = ParseStatementOptions{};
                p.declareBinding(.hoisted, &arg, &parseStmtOpts) catch unreachable;

                var default_value: ?ExprNodeIndex = null;
                if (!func.flags.contains(.has_rest_arg) and p.lexer.token == .t_equals) {
                    // p.markSyntaxFeature
                    try p.lexer.next();
                    default_value = try p.parseExpr(.comma);
                }

                args.append(p.allocator, G.Arg{
                    .ts_decorators = ExprNodeList.init(ts_decorators),
                    .binding = arg,
                    .default = default_value,

                    // We need to track this because it affects code generation
                    .is_typescript_ctor_field = is_typescript_ctor_field,
                }) catch unreachable;

                if (p.lexer.token != .t_comma) {
                    break;
                }

                if (func.flags.contains(.has_rest_arg)) {
                    // JavaScript does not allow a comma after a rest argument
                    if (opts.is_typescript_declare) {
                        // TypeScript does allow a comma after a rest argument in a "declare" context
                        try p.lexer.next();
                    } else {
                        try p.lexer.expect(.t_close_paren);
                    }

                    break;
                }

                try p.lexer.next();
            }
            if (args.items.len > 0) {
                func.args = args.items;
            }

            // Reserve the special name "arguments" in this scope. This ensures that it
            // shadows any variable called "arguments" in any parent scopes. But only do
            // this if it wasn't already declared above because arguments are allowed to
            // be called "arguments", in which case the real "arguments" is inaccessible.
            if (!p.current_scope.members.contains("arguments")) {
                func.arguments_ref = p.declareSymbolMaybeGenerated(.arguments, func.open_parens_loc, "arguments", true) catch unreachable;
                p.symbols.items[func.arguments_ref.?.innerIndex()].must_not_be_renamed = true;
            }

            try p.lexer.expect(.t_close_paren);
            p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

            // "function foo(): any {}"
            if (is_typescript_enabled and p.lexer.token == .t_colon) {
                try p.lexer.next();
                try p.skipTypescriptReturnType();
            }

            // "function foo(): any;"
            if (opts.allow_missing_body_for_type_script and p.lexer.token != .t_open_brace) {
                try p.lexer.expectOrInsertSemicolon();
                func.flags.insert(.is_forward_declaration);
                return func;
            }
            var tempOpts = opts;
            func.body = try p.parseFnBody(&tempOpts);

            return func;
        }

        // pub fn parseBinding(p: *P)

        pub inline fn skipTypescriptReturnType(p: *P) anyerror!void {
            try p.skipTypeScriptTypeWithOpts(.lowest, .{ .is_return_type = true });
        }

        pub fn parseTypeScriptDecorators(p: *P) ![]ExprNodeIndex {
            if (!is_typescript_enabled) {
                return &([_]ExprNodeIndex{});
            }

            var decorators = ListManaged(ExprNodeIndex).init(p.allocator);
            while (p.lexer.token == T.t_at) {
                try p.lexer.next();

                // Parse a new/call expression with "exprFlagTSDecorator" so we ignore
                // EIndex expressions, since they may be part of a computed property:
                //
                //   class Foo {
                //     @foo ['computed']() {}
                //   }
                //
                // This matches the behavior of the TypeScript compiler.
                try decorators.append(try p.parseExprWithFlags(.new, Expr.EFlags.ts_decorator));
            }

            return decorators.items;
        }

        inline fn skipTypeScriptType(p: *P, level: js_ast.Op.Level) anyerror!void {
            p.markTypeScriptOnly();
            try p.skipTypeScriptTypeWithOpts(level, .{});
        }

        fn skipTypeScriptBinding(p: *P) anyerror!void {
            p.markTypeScriptOnly();
            switch (p.lexer.token) {
                .t_identifier, .t_this => {
                    try p.lexer.next();
                },
                .t_open_bracket => {
                    try p.lexer.next();

                    // "[, , a]"

                    while (p.lexer.token == .t_comma) {
                        try p.lexer.next();
                    }
                    // "[a, b]"
                    while (p.lexer.token != .t_close_bracket) {
                        try p.skipTypeScriptBinding();

                        if (p.lexer.token != .t_comma) {
                            break;
                        }
                        try p.lexer.next();
                    }

                    try p.lexer.expect(.t_close_bracket);
                },
                .t_open_brace => {
                    try p.lexer.next();

                    while (p.lexer.token != .t_close_brace) {
                        var found_identifier = false;

                        switch (p.lexer.token) {
                            .t_identifier => {
                                found_identifier = true;
                                try p.lexer.next();
                            },

                            // "{1: y}"
                            // "{'x': y}"
                            .t_string_literal, .t_numeric_literal => {
                                try p.lexer.next();
                            },

                            else => {
                                if (p.lexer.isIdentifierOrKeyword()) {
                                    // "{if: x}"
                                    try p.lexer.next();
                                } else {
                                    try p.lexer.unexpected();
                                    return error.Backtrack;
                                }
                            },
                        }

                        if (p.lexer.token == .t_colon or !found_identifier) {
                            try p.lexer.expect(.t_colon);
                            try p.skipTypeScriptBinding();
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        try p.lexer.next();
                    }

                    try p.lexer.expect(.t_close_brace);
                },
                else => {
                    // try p.lexer.unexpected();
                    return error.Backtrack;
                },
            }
        }

        fn skipTypescriptFnArgs(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            try p.lexer.expect(.t_open_paren);

            while (p.lexer.token != .t_close_paren) {
                // "(...a)"
                if (p.lexer.token == .t_dot_dot_dot) {
                    try p.lexer.next();
                }

                try p.skipTypeScriptBinding();

                // "(a?)"
                if (p.lexer.token == .t_question) {
                    try p.lexer.next();
                }

                // "(a: any)"
                if (p.lexer.token == .t_colon) {
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);
                }

                // "(a, b)"
                if (p.lexer.token != .t_comma) {
                    break;
                }

                try p.lexer.next();
            }

            try p.lexer.expect(.t_close_paren);
        }

        // This is a spot where the TypeScript grammar is highly ambiguous. Here are
        // some cases that are valid:
        //
        //     let x = (y: any): (() => {}) => { };
        //     let x = (y: any): () => {} => { };
        //     let x = (y: any): (y) => {} => { };
        //     let x = (y: any): (y[]) => {};
        //     let x = (y: any): (a | b) => {};
        //
        // Here are some cases that aren't valid:
        //
        //     let x = (y: any): (y) => {};
        //     let x = (y: any): (y) => {return 0};
        //     let x = (y: any): asserts y is (y) => {};
        //
        fn skipTypeScriptParenOrFnType(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            if (p.trySkipTypeScriptArrowArgsWithBacktracking()) {
                try p.skipTypescriptReturnType();
            } else {
                try p.lexer.expect(.t_open_paren);
                try p.skipTypeScriptType(.lowest);
                try p.lexer.expect(.t_close_paren);
            }
        }

        fn skipTypeScriptTypeWithOpts(p: *P, level: js_ast.Op.Level, opts: TypeScript.SkipTypeOptions) anyerror!void {
            p.markTypeScriptOnly();

            while (true) {
                switch (p.lexer.token) {
                    .t_numeric_literal,
                    .t_big_integer_literal,
                    .t_string_literal,
                    .t_no_substitution_template_literal,
                    .t_true,
                    .t_false,
                    .t_null,
                    .t_void,
                    .t_const,
                    => {
                        try p.lexer.next();
                    },

                    .t_this => {
                        try p.lexer.next();

                        // "function check(): this is boolean"
                        if (p.lexer.isContextualKeyword("is") and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            return;
                        }
                    },
                    .t_minus => {
                        // "-123"
                        // "-123n"
                        try p.lexer.next();

                        if (p.lexer.token == .t_big_integer_literal) {
                            try p.lexer.next();
                        } else {
                            try p.lexer.expect(.t_numeric_literal);
                        }
                    },
                    .t_ampersand, .t_bar => {
                        // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                        try p.lexer.next();
                        continue;
                    },
                    .t_import => {
                        // "import('fs')"
                        try p.lexer.next();
                        try p.lexer.expect(.t_open_paren);
                        try p.lexer.expect(.t_string_literal);
                        try p.lexer.expect(.t_close_paren);
                    },
                    .t_new => {
                        // "new () => Foo"
                        // "new <T>() => Foo<T>"
                        try p.lexer.next();
                        try p.skipTypeScriptTypeParameters();
                        try p.skipTypeScriptParenOrFnType();
                    },
                    .t_less_than => {
                        // "<T>() => Foo<T>"
                        try p.skipTypeScriptTypeParameters();
                        try p.skipTypeScriptParenOrFnType();
                    },
                    .t_open_paren => {
                        // "(number | string)"
                        try p.skipTypeScriptParenOrFnType();
                    },
                    .t_identifier => {
                        const kind = TypeScript.Identifier.IMap.get(p.lexer.identifier) orelse .normal;

                        if (kind == .prefix) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.prefix);
                            break;
                        }

                        var check_type_parameters = true;

                        switch (kind) {
                            .unique => {
                                try p.lexer.next();

                                // "let foo: unique symbol"

                                if (p.lexer.isContextualKeyword("symbol")) {
                                    try p.lexer.next();
                                    break;
                                }
                            },
                            .abstract => {
                                try p.lexer.next();

                                // "let foo: abstract new () => {}" added in TypeScript 4.2
                                if (p.lexer.token == .t_new) {
                                    continue;
                                }
                            },
                            .asserts => {
                                try p.lexer.next();

                                // "function assert(x: boolean): asserts x"
                                // "function assert(x: boolean): asserts x is boolean"

                                if (opts.is_return_type and !p.lexer.has_newline_before and (p.lexer.token == .t_identifier or p.lexer.token == .t_this)) {
                                    try p.lexer.next();
                                }
                            },
                            .primitive => {
                                try p.lexer.next();
                                check_type_parameters = false;
                            },
                            else => {
                                try p.lexer.next();
                            },
                        }

                        // "function assert(x: any): x is boolean"

                        if (p.lexer.isContextualKeyword("is") and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            return;
                        }

                        // "let foo: any \n <number>foo" must not become a single type
                        if (check_type_parameters and !p.lexer.has_newline_before) {
                            _ = try p.skipTypeScriptTypeArguments(false);
                        }
                    },
                    .t_typeof => {
                        try p.lexer.next();
                        if (p.lexer.token == .t_import) {
                            // "typeof import('fs')"
                            continue;
                        } else {
                            // "typeof x"
                            // "typeof x.y"

                            while (true) {
                                if (!p.lexer.isIdentifierOrKeyword()) {
                                    try p.lexer.expected(.t_identifier);
                                }

                                try p.lexer.next();
                                if (p.lexer.token != .t_dot) {
                                    break;
                                }

                                try p.lexer.next();
                            }
                        }
                    },
                    .t_open_bracket => {
                        // "[number, string]"
                        // "[first: number, second: string]"
                        try p.lexer.next();

                        while (p.lexer.token != .t_close_bracket) {
                            if (p.lexer.token == .t_dot_dot_dot) {
                                try p.lexer.next();
                            }
                            try p.skipTypeScriptType(.lowest);
                            if (p.lexer.token == .t_question) {
                                try p.lexer.next();
                            }
                            if (p.lexer.token == .t_colon) {
                                try p.lexer.next();
                                try p.skipTypeScriptType(.lowest);
                            }
                            if (p.lexer.token != .t_comma) {
                                break;
                            }
                            try p.lexer.next();
                        }
                        try p.lexer.expect(.t_close_bracket);
                    },
                    .t_open_brace => {
                        try p.skipTypeScriptObjectType();
                    },
                    .t_template_head => {
                        // "`${'a' | 'b'}-${'c' | 'd'}`"

                        while (true) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            try p.lexer.rescanCloseBraceAsTemplateToken();

                            if (p.lexer.token == .t_template_tail) {
                                try p.lexer.next();
                                break;
                            }
                        }
                    },

                    else => {
                        try p.lexer.unexpected();
                        return error.Backtrack;
                    },
                }
                break;
            }

            while (true) {
                switch (p.lexer.token) {
                    .t_bar => {
                        if (level.gte(.bitwise_or)) {
                            return;
                        }
                        try p.lexer.next();
                        try p.skipTypeScriptType(.bitwise_or);
                    },
                    .t_ampersand => {
                        if (level.gte(.bitwise_and)) {
                            return;
                        }

                        try p.lexer.next();
                        try p.skipTypeScriptType(.bitwise_and);
                    },
                    .t_exclamation => {
                        // A postfix "!" is allowed in JSDoc types in TypeScript, which are only
                        // present in comments. While it's not valid in a non-comment position,
                        // it's still parsed and turned into a soft error by the TypeScript
                        // compiler. It turns out parsing this is important for correctness for
                        // "as" casts because the "!" token must still be consumed.
                        if (p.lexer.has_newline_before) {
                            return;
                        }

                        try p.lexer.next();
                    },
                    .t_dot => {
                        try p.lexer.next();
                        if (!p.lexer.isIdentifierOrKeyword()) {
                            try p.lexer.expect(.t_identifier);
                        }
                        try p.lexer.next();
                        _ = try p.skipTypeScriptTypeArguments(false);
                    },
                    .t_open_bracket => {
                        // "{ ['x']: string \n ['y']: string }" must not become a single type
                        if (p.lexer.has_newline_before) {
                            return;
                        }
                        try p.lexer.next();
                        if (p.lexer.token != .t_close_bracket) {
                            try p.skipTypeScriptType(.lowest);
                        }
                        try p.lexer.expect(.t_close_bracket);
                    },
                    .t_extends => {
                        // "{ x: number \n extends: boolean }" must not become a single type
                        if (p.lexer.has_newline_before or level.gte(.conditional)) {
                            return;
                        }

                        try p.lexer.next();

                        // The type following "extends" is not permitted to be another conditional type
                        try p.skipTypeScriptType(.conditional);
                        try p.lexer.expect(.t_question);
                        try p.skipTypeScriptType(.lowest);
                        try p.lexer.expect(.t_colon);
                        try p.skipTypeScriptType(.lowest);
                    },
                    else => {
                        return;
                    },
                }
            }
        }
        fn skipTypeScriptObjectType(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            try p.lexer.expect(.t_open_brace);

            while (p.lexer.token != .t_close_brace) {
                // "{ -readonly [K in keyof T]: T[K] }"
                // "{ +readonly [K in keyof T]: T[K] }"
                if (p.lexer.token == .t_plus or p.lexer.token == .t_minus) {
                    try p.lexer.next();
                }

                // Skip over modifiers and the property identifier
                var found_key = false;
                while (p.lexer.isIdentifierOrKeyword() or p.lexer.token == .t_string_literal or p.lexer.token == .t_numeric_literal) {
                    try p.lexer.next();
                    found_key = true;
                }

                if (p.lexer.token == .t_open_bracket) {
                    // Index signature or computed property
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);

                    // "{ [key: string]: number }"
                    // "{ readonly [K in keyof T]: T[K] }"
                    switch (p.lexer.token) {
                        .t_colon => {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                        },
                        .t_in => {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            if (p.lexer.isContextualKeyword("as")) {
                                // "{ [K in keyof T as `get-${K}`]: T[K] }"
                                try p.lexer.next();
                                try p.skipTypeScriptType(.lowest);
                            }
                        },
                        else => {},
                    }

                    try p.lexer.expect(.t_close_bracket);

                    // "{ [K in keyof T]+?: T[K] }"
                    // "{ [K in keyof T]-?: T[K] }"
                    switch (p.lexer.token) {
                        .t_plus, .t_minus => {
                            try p.lexer.next();
                        },
                        else => {},
                    }

                    found_key = true;
                }

                // "?" indicates an optional property
                // "!" indicates an initialization assertion
                if (found_key and (p.lexer.token == .t_question or p.lexer.token == .t_exclamation)) {
                    try p.lexer.next();
                }

                // Type parameters come right after the optional mark
                try p.skipTypeScriptTypeParameters();

                switch (p.lexer.token) {
                    .t_colon => {
                        // Regular property
                        if (!found_key) {
                            try p.lexer.expect(.t_identifier);
                        }

                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    },
                    .t_open_paren => {
                        // Method signature
                        try p.skipTypescriptFnArgs();

                        if (p.lexer.token == .t_colon) {
                            try p.lexer.next();
                            try p.skipTypescriptReturnType();
                        }
                    },
                    else => {
                        if (!found_key) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }
                    },
                }
                switch (p.lexer.token) {
                    .t_close_brace => {},
                    .t_comma, .t_semicolon => {
                        try p.lexer.next();
                    },
                    else => {
                        if (!p.lexer.has_newline_before) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }
                    },
                }
            }
            try p.lexer.expect(.t_close_brace);
        }

        fn processImportStatement(p: *P, stmt_: S.Import, path: ParsedPath, loc: logger.Loc, was_originally_bare_import: bool) anyerror!Stmt {
            const is_macro = FeatureFlags.is_macro_enabled and js_ast.Macro.isMacroPath(path.text);
            var stmt = stmt_;
            if (is_macro) {
                const id = p.addImportRecord(.stmt, path.loc, path.text);
                p.import_records.items[id].path.namespace = js_ast.Macro.namespace;
                p.import_records.items[id].is_unused = true;

                if (stmt.default_name) |name_loc| {
                    const name = p.loadNameFromRef(name_loc.ref.?);
                    const ref = try p.declareSymbol(.other, name_loc.loc, name);
                    try p.is_import_item.put(p.allocator, ref, .{});
                    try p.macro.refs.put(ref, id);
                }

                for (stmt.items) |item| {
                    const name = p.loadNameFromRef(item.name.ref.?);
                    const ref = try p.declareSymbol(.other, item.name.loc, name);
                    try p.is_import_item.put(p.allocator, ref, .{});
                    try p.macro.refs.put(ref, id);
                }

                return p.s(S.Empty{}, loc);
            }

            if (p.options.features.hoist_bun_plugin and strings.eqlComptime(path.text, "bun")) {
                var plugin_i: usize = std.math.maxInt(usize);
                const items = stmt.items;
                for (items) |item, i| {
                    // Mark Bun.plugin()
                    // TODO: remove if they have multiple imports of the same name?
                    if (strings.eqlComptime(item.alias, "plugin")) {
                        const name = p.loadNameFromRef(item.name.ref.?);
                        const ref = try p.declareSymbol(.other, item.name.loc, name);
                        try p.is_import_item.put(p.allocator, ref, .{});
                        p.bun_plugin.ref = ref;
                        plugin_i = i;
                        break;
                    }
                }

                if (plugin_i != std.math.maxInt(usize)) {
                    var list = std.ArrayListUnmanaged(@TypeOf(stmt.items[0])){
                        .items = stmt.items,
                        .capacity = stmt.items.len,
                    };
                    // remove it from the list
                    _ = list.swapRemove(plugin_i);
                    stmt.items = list.items;
                }

                // if the import statement is now empty, remove it completely
                if (stmt.items.len == 0 and stmt.default_name == null and stmt.star_name_loc == null) {
                    return p.s(S.Empty{}, loc);
                }
            }

            const macro_remap = if ((comptime allow_macros) and !is_macro)
                p.options.macro_context.getRemap(path.text)
            else
                null;

            stmt.import_record_index = p.addImportRecord(.stmt, path.loc, path.text);
            p.import_records.items[stmt.import_record_index].was_originally_bare_import = was_originally_bare_import;

            if (stmt.star_name_loc) |star| {
                const name = p.loadNameFromRef(stmt.namespace_ref);

                stmt.namespace_ref = try p.declareSymbol(.import, star, name);

                if (comptime track_symbol_usage_during_parse_pass) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = stmt.namespace_ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }
            } else {
                var path_name = fs.PathName.init(strings.append(p.allocator, "import_", path.text) catch unreachable);
                const name = try path_name.nonUniqueNameString(p.allocator);
                stmt.namespace_ref = try p.newSymbol(.other, name);
                var scope: *Scope = p.current_scope;
                try scope.generated.append(p.allocator, stmt.namespace_ref);
            }

            var item_refs = ImportItemForNamespaceMap.init(p.allocator);
            const count_excluding_namespace = @intCast(u16, stmt.items.len) +
                @intCast(u16, @boolToInt(stmt.default_name != null));

            try item_refs.ensureUnusedCapacity(count_excluding_namespace);
            // Even though we allocate ahead of time here
            // we cannot use putAssumeCapacity because a symbol can have existing links
            // those may write to this hash table, so this estimate may be innaccurate
            try p.is_import_item.ensureUnusedCapacity(p.allocator, count_excluding_namespace);
            var remap_count: u32 = 0;
            // Link the default item to the namespace
            if (stmt.default_name) |*name_loc| {
                outer: {
                    const name = p.loadNameFromRef(name_loc.ref.?);
                    const ref = try p.declareSymbol(.import, name_loc.loc, name);
                    name_loc.ref = ref;
                    try p.is_import_item.put(p.allocator, ref, .{});

                    if (macro_remap) |*remap| {
                        if (remap.get("default")) |remapped_path| {
                            const new_import_id = p.addImportRecord(.stmt, path.loc, remapped_path);
                            try p.macro.refs.put(ref, new_import_id);

                            p.import_records.items[new_import_id].path.namespace = js_ast.Macro.namespace;
                            p.import_records.items[new_import_id].is_unused = true;
                            if (comptime only_scan_imports_and_do_not_visit) {
                                p.import_records.items[new_import_id].is_internal = true;
                                p.import_records.items[new_import_id].path.is_disabled = true;
                            }
                            stmt.default_name = null;
                            remap_count += 1;
                            break :outer;
                        }
                    }

                    if (comptime track_symbol_usage_during_parse_pass) {
                        p.parse_pass_symbol_uses.put(name, .{
                            .ref = ref,
                            .import_record_index = stmt.import_record_index,
                        }) catch unreachable;
                    }

                    if (is_macro) {
                        try p.macro.refs.put(ref, stmt.import_record_index);
                        stmt.default_name = null;
                        break :outer;
                    }

                    if (comptime ParsePassSymbolUsageType != void) {
                        p.parse_pass_symbol_uses.put(name, .{
                            .ref = ref,
                            .import_record_index = stmt.import_record_index,
                        }) catch unreachable;
                    }

                    item_refs.putAssumeCapacity(name, name_loc.*);
                }
            }
            var i: usize = 0;
            var end: usize = 0;

            while (i < stmt.items.len) : (i += 1) {
                var item: js_ast.ClauseItem = stmt.items[i];
                const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                const ref = try p.declareSymbol(.import, item.name.loc, name);
                item.name.ref = ref;

                try p.is_import_item.put(p.allocator, ref, .{});
                p.checkForNonBMPCodePoint(item.alias_loc, item.alias);

                if (macro_remap) |*remap| {
                    if (remap.get(item.alias)) |remapped_path| {
                        const new_import_id = p.addImportRecord(.stmt, path.loc, remapped_path);
                        try p.macro.refs.put(ref, new_import_id);

                        p.import_records.items[new_import_id].path.namespace = js_ast.Macro.namespace;
                        p.import_records.items[new_import_id].is_unused = true;
                        if (comptime only_scan_imports_and_do_not_visit) {
                            p.import_records.items[new_import_id].is_internal = true;
                            p.import_records.items[new_import_id].path.is_disabled = true;
                        }
                        remap_count += 1;
                        continue;
                    }
                }

                if (comptime track_symbol_usage_during_parse_pass) {
                    p.parse_pass_symbol_uses.put(name, .{
                        .ref = ref,
                        .import_record_index = stmt.import_record_index,
                    }) catch unreachable;
                }

                item_refs.putAssumeCapacity(item.alias, item.name);
                stmt.items[end] = item;
                end += 1;
            }
            stmt.items = stmt.items[0..end];

            // If we remapped the entire import away
            // i.e. import {graphql} "react-relay"

            if (remap_count > 0 and stmt.items.len == 0 and stmt.default_name == null) {
                p.import_records.items[stmt.import_record_index].path.namespace = js_ast.Macro.namespace;
                p.import_records.items[stmt.import_record_index].is_unused = true;

                if (comptime only_scan_imports_and_do_not_visit) {
                    p.import_records.items[stmt.import_record_index].path.is_disabled = true;
                    p.import_records.items[stmt.import_record_index].is_internal = true;
                }

                return p.s(S.Empty{}, loc);
            } else if (remap_count > 0) {
                item_refs.shrinkAndFree(stmt.items.len + @as(usize, @boolToInt(stmt.default_name != null)));
            }

            // Track the items for this namespace
            try p.import_items_for_namespace.put(p.allocator, stmt.namespace_ref, item_refs);
            return p.s(stmt, loc);
        }

        // This is the type parameter declarations that go with other symbol
        // declarations (class, function, type, etc.)
        fn skipTypeScriptTypeParameters(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            if (p.lexer.token == .t_less_than) {
                try p.lexer.next();

                while (true) {
                    try p.lexer.expect(.t_identifier);
                    // "class Foo<T extends number> {}"
                    if (p.lexer.token == .t_extends) {
                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    }
                    // "class Foo<T = void> {}"
                    if (p.lexer.token == .t_equals) {
                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }
                    try p.lexer.next();
                    if (p.lexer.token == .t_greater_than) {
                        break;
                    }
                }
                try p.lexer.expectGreaterThan(false);
            }
        }

        fn createDefaultName(p: *P, loc: logger.Loc) !js_ast.LocRef {
            var identifier = try std.fmt.allocPrint(p.allocator, "{s}_default", .{try p.source.path.name.nonUniqueNameString(p.allocator)});

            const name = js_ast.LocRef{ .loc = loc, .ref = try p.newSymbol(Symbol.Kind.other, identifier) };

            var scope = p.current_scope;

            try scope.generated.append(p.allocator, name.ref.?);

            return name;
        }

        pub fn newSymbol(p: *P, kind: Symbol.Kind, identifier: string) !Ref {
            const inner_index = Ref.toInt(p.symbols.items.len);
            try p.symbols.append(Symbol{
                .kind = kind,
                .original_name = identifier,
            });

            if (is_typescript_enabled) {
                try p.ts_use_counts.append(p.allocator, 0);
            }

            return Ref.init(inner_index, Ref.toInt(p.source.index), false);
        }

        fn parseLabelName(p: *P) !?js_ast.LocRef {
            if (p.lexer.token != .t_identifier or p.lexer.has_newline_before) {
                return null;
            }

            const name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(p.lexer.identifier) };
            try p.lexer.next();
            return name;
        }

        fn parseClassStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) !Stmt {
            var name: ?js_ast.LocRef = null;
            var class_keyword = p.lexer.range();
            if (p.lexer.token == .t_class) {
                //marksyntaxfeature
                try p.lexer.next();
            } else {
                try p.lexer.expected(.t_class);
            }

            var is_identifier = p.lexer.token == .t_identifier;

            if (!opts.is_name_optional or (is_identifier and (!is_typescript_enabled or !strings.eqlComptime(p.lexer.identifier, "interface")))) {
                var name_loc = p.lexer.loc();
                var name_text = p.lexer.identifier;
                try p.lexer.expect(.t_identifier);

                // We must return here
                // or the lexer will crash loop!
                // example:
                // export class {}
                if (!is_identifier) {
                    return error.SyntaxError;
                }

                if (p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name_text, "await")) {
                    try p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"await\" as an identifier here");
                }

                name = LocRef{ .loc = name_loc, .ref = null };
                if (!opts.is_typescript_declare) {
                    (name orelse unreachable).ref = p.declareSymbol(.class, name_loc, name_text) catch unreachable;
                }
            }

            // Even anonymous classes can have TypeScript type parameters
            if (is_typescript_enabled) {
                try p.skipTypeScriptTypeParameters();
            }
            var class_opts = ParseClassOptions{
                .allow_ts_decorators = true,
                .is_type_script_declare = opts.is_typescript_declare,
            };
            if (opts.ts_decorators) |dec| {
                class_opts.ts_decorators = dec.values;
            }

            const scope_index = p.pushScopeForParsePass(.class_name, loc) catch unreachable;
            const class = try p.parseClass(class_keyword, name, class_opts);

            if (comptime is_typescript_enabled) {
                if (opts.is_typescript_declare) {
                    p.popAndDiscardScope(scope_index);
                    if (opts.is_namespace_scope and opts.is_export) {
                        p.has_non_local_export_declare_inside_namespace = true;
                    }

                    return p.s(S.TypeScript{}, loc);
                }
            }

            p.popScope();
            return p.s(S.Class{
                .class = class,
                .is_export = opts.is_export,
            }, loc);
        }

        // For HMR, we must convert syntax like this:
        // export function leftPad() {
        // export const guy = GUY_FIERI_ASCII_ART;
        // export class Bacon {}
        // export default GuyFieriAsciiArt;
        // export {Bacon};
        // export {Bacon as default};
        // to:
        // var __hmr__module = new __hmr_HMRModule(file_id, import.meta);
        // (__hmr__module._load = function() {
        //      __hmr__module.exports.leftPad = function () {};
        //      __hmr__module.exports.npmProgressBar33 = true;
        //      __hmr__module.exports.Bacon = class {};
        // })();
        // export { __hmr__module.exports.leftPad as leftPad, __hmr__module.exports.npmProgressBar33 as npmProgressBar33, __hmr__module }
        //
        //
        //
        // At bottom of the file:
        // -
        // var __hmr__exports = new HMRModule({
        //  leftPad: () => leftPad,
        //  npmProgressBar33 () => npmProgressBar33,
        //  default: () => GuyFieriAsciiArt,
        //  [__hmr_ModuleIDSymbol]:
        //});
        // export { __hmr__exports.leftPad as leftPad, __hmr__  }
        // -
        // Then:
        // if () {
        //
        // }

        // pub fn maybeRewriteExportSymbol(p: *P, )

        fn defaultNameForExpr(p: *P, expr: Expr, loc: logger.Loc) LocRef {
            switch (expr.data) {
                .e_function => |func_container| {
                    if (func_container.func.name) |_name| {
                        if (_name.ref) |ref| {
                            return LocRef{ .loc = loc, .ref = ref };
                        }
                    }
                },
                .e_identifier => |ident| {
                    return LocRef{ .loc = loc, .ref = ident.ref };
                },
                .e_import_identifier => |ident| {
                    if (!allow_macros or (allow_macros and !p.macro.refs.contains(ident.ref))) {
                        return LocRef{ .loc = loc, .ref = ident.ref };
                    }
                },
                .e_class => |class| {
                    if (class.class_name) |_name| {
                        if (_name.ref) |ref| {
                            return LocRef{ .loc = loc, .ref = ref };
                        }
                    }
                },
                else => {},
            }

            return createDefaultName(p, loc) catch unreachable;
        }

        fn parseStmt(p: *P, opts: *ParseStatementOptions) anyerror!Stmt {
            var loc = p.lexer.loc();

            switch (p.lexer.token) {
                .t_semicolon => {
                    try p.lexer.next();
                    return Stmt.empty();
                },

                .t_export => {
                    var previousExportKeyword = p.es6_export_keyword;
                    if (opts.is_module_scope) {
                        p.es6_export_keyword = p.lexer.range();
                    } else if (!opts.is_namespace_scope) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                    try p.lexer.next();

                    // TypeScript decorators only work on class declarations
                    // "@decorator export class Foo {}"
                    // "@decorator export abstract class Foo {}"
                    // "@decorator export default class Foo {}"
                    // "@decorator export default abstract class Foo {}"
                    // "@decorator export declare class Foo {}"
                    // "@decorator export declare abstract class Foo {}"
                    if (opts.ts_decorators != null and p.lexer.token != js_lexer.T.t_class and
                        p.lexer.token != js_lexer.T.t_default and
                        !p.lexer.isContextualKeyword("abstract") and
                        !p.lexer.isContextualKeyword("declare"))
                    {
                        try p.lexer.expected(js_lexer.T.t_class);
                    }

                    switch (p.lexer.token) {
                        T.t_class, T.t_const, T.t_function, T.t_var => {
                            opts.is_export = true;
                            return p.parseStmt(opts);
                        },

                        T.t_import => {
                            // "export import foo = bar"
                            if (is_typescript_enabled and (opts.is_module_scope or opts.is_namespace_scope)) {
                                opts.is_export = true;
                                return p.parseStmt(opts);
                            }

                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        },

                        T.t_enum => {
                            if (!is_typescript_enabled) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            opts.is_export = true;
                            return p.parseStmt(opts);
                        },

                        T.t_identifier => {
                            if (p.lexer.isContextualKeyword("let")) {
                                opts.is_export = true;
                                return p.parseStmt(opts);
                            }

                            if (comptime is_typescript_enabled) {
                                if (opts.is_typescript_declare and p.lexer.isContextualKeyword("as")) {
                                    // "export as namespace ns;"
                                    try p.lexer.next();
                                    try p.lexer.expectContextualKeyword("namespace");
                                    try p.lexer.expect(T.t_identifier);
                                    try p.lexer.expectOrInsertSemicolon();

                                    return p.s(S.TypeScript{}, loc);
                                }
                            }

                            if (p.lexer.isContextualKeyword("async")) {
                                var asyncRange = p.lexer.range();
                                try p.lexer.next();
                                if (p.lexer.has_newline_before) {
                                    try p.log.addRangeError(p.source, asyncRange, "Unexpected newline after \"async\"");
                                }

                                try p.lexer.expect(T.t_function);
                                opts.is_export = true;
                                return try p.parseFnStmt(loc, opts, asyncRange);
                            }

                            if (is_typescript_enabled) {
                                if (TypeScript.Identifier.forStr(p.lexer.identifier)) |ident| {
                                    switch (ident) {
                                        .s_type => {
                                            // "export type foo = ..."
                                            const type_range = p.lexer.range();
                                            try p.lexer.next();
                                            if (p.lexer.has_newline_before) {
                                                try p.log.addErrorFmt(p.source, type_range.end(), p.allocator, "Unexpected newline after \"type\"", .{});
                                                return error.SynaxError;
                                            }
                                            var skipper = ParseStatementOptions{ .is_module_scope = opts.is_module_scope, .is_export = true };
                                            try p.skipTypeScriptTypeStmt(&skipper);
                                            return p.s(S.TypeScript{}, loc);
                                        },
                                        .s_namespace, .s_abstract, .s_module, .s_interface => {
                                            // "export namespace Foo {}"
                                            // "export abstract class Foo {}"
                                            // "export module Foo {}"
                                            // "export interface Foo {}"
                                            opts.is_export = true;
                                            return try p.parseStmt(opts);
                                        },
                                        .s_declare => {
                                            // "export declare class Foo {}"
                                            opts.is_export = true;
                                            opts.lexical_decl = .allow_all;
                                            opts.is_typescript_declare = true;
                                            return try p.parseStmt(opts);
                                        },
                                    }
                                }
                            }

                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        },

                        T.t_default => {
                            if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            var defaultLoc = p.lexer.loc();
                            try p.lexer.next();

                            // TypeScript decorators only work on class declarations
                            // "@decorator export default class Foo {}"
                            // "@decorator export default abstract class Foo {}"
                            if (opts.ts_decorators != null and p.lexer.token != T.t_class and !p.lexer.isContextualKeyword("abstract")) {
                                try p.lexer.expected(T.t_class);
                            }

                            if (p.lexer.isContextualKeyword("async")) {
                                var async_range = p.lexer.range();
                                try p.lexer.next();
                                var defaultName: js_ast.LocRef = undefined;
                                if (p.lexer.token == T.t_function and !p.lexer.has_newline_before) {
                                    try p.lexer.next();
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
                                        defaultName = js_ast.LocRef{ .loc = name.loc, .ref = name.ref };
                                    } else {
                                        defaultName = try p.createDefaultName(defaultLoc);
                                    }
                                    var value = js_ast.StmtOrExpr{ .stmt = stmt };
                                    return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                                }

                                defaultName = try createDefaultName(p, loc);

                                const prefix_expr = try p.parseAsyncPrefixExpr(async_range, Level.comma);
                                var expr = try p.parseSuffix(prefix_expr, Level.comma, null, Expr.EFlags.none);
                                try p.lexer.expectOrInsertSemicolon();
                                var value = js_ast.StmtOrExpr{ .expr = expr };
                                p.has_export_default = true;
                                return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                            }

                            if (p.lexer.token == .t_function or p.lexer.token == .t_class or p.lexer.isContextualKeyword("interface")) {
                                var _opts = ParseStatementOptions{
                                    .ts_decorators = opts.ts_decorators,
                                    .is_name_optional = true,
                                    .lexical_decl = .allow_all,
                                };
                                var stmt = try p.parseStmt(&_opts);

                                const default_name: js_ast.LocRef = default_name_getter: {
                                    switch (stmt.data) {
                                        // This was just a type annotation
                                        .s_type_script => {
                                            return stmt;
                                        },

                                        .s_function => |func_container| {
                                            if (func_container.func.name) |name| {
                                                break :default_name_getter LocRef{ .loc = name.loc, .ref = name.ref };
                                            } else {}
                                        },
                                        .s_class => |class| {
                                            if (class.class.class_name) |name| {
                                                break :default_name_getter LocRef{ .loc = name.loc, .ref = name.ref };
                                            } else {}
                                        },
                                        else => {},
                                    }

                                    break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                                };
                                p.has_export_default = true;
                                return p.s(
                                    S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } },
                                    loc,
                                );
                            }

                            const is_identifier = p.lexer.token == .t_identifier;
                            const name = p.lexer.identifier;
                            var expr = try p.parseExpr(.comma);

                            // Handle the default export of an abstract class in TypeScript
                            if (is_typescript_enabled and is_identifier and (p.lexer.token == .t_class or opts.ts_decorators != null) and strings.eqlComptime(name, "abstract")) {
                                switch (expr.data) {
                                    .e_identifier => {
                                        var stmtOpts = ParseStatementOptions{
                                            .ts_decorators = opts.ts_decorators,
                                            .is_name_optional = true,
                                        };
                                        const stmt: Stmt = try p.parseClassStmt(loc, &stmtOpts);

                                        // Use the statement name if present, since it's a better name
                                        const default_name: js_ast.LocRef = default_name_getter: {
                                            switch (stmt.data) {
                                                // This was just a type annotation
                                                .s_type_script => {
                                                    return stmt;
                                                },

                                                .s_function => |func_container| {
                                                    if (func_container.func.name) |_name| {
                                                        break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                                    } else {}
                                                },
                                                .s_class => |class| {
                                                    if (class.class.class_name) |_name| {
                                                        break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                                    } else {}
                                                },
                                                else => {},
                                            }

                                            break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                                        };
                                        p.has_export_default = true;
                                        return p.s(S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } }, loc);
                                    },
                                    else => {
                                        p.panic("internal error: unexpected", .{});
                                    },
                                }
                            }

                            try p.lexer.expectOrInsertSemicolon();

                            // Use the expression name if present, since it's a better name
                            p.has_export_default = true;
                            return p.s(
                                S.ExportDefault{
                                    .default_name = p.defaultNameForExpr(expr, defaultLoc),
                                    .value = js_ast.StmtOrExpr{
                                        .expr = expr,
                                    },
                                },
                                loc,
                            );
                        },
                        T.t_asterisk => {
                            if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            try p.lexer.next();
                            var namespace_ref: Ref = Ref.None;
                            var alias: ?js_ast.G.ExportStarAlias = null;
                            var path: ParsedPath = undefined;

                            if (p.lexer.isContextualKeyword("as")) {
                                // "export * as ns from 'path'"
                                try p.lexer.next();
                                const name = try p.parseClauseAlias("export");
                                namespace_ref = try p.storeNameInRef(name);
                                alias = G.ExportStarAlias{ .loc = p.lexer.loc(), .original_name = name };
                                try p.lexer.next();
                                try p.lexer.expectContextualKeyword("from");
                                path = try p.parsePath();
                            } else {
                                // "export * from 'path'"
                                try p.lexer.expectContextualKeyword("from");
                                path = try p.parsePath();
                                const name = try fs.PathName.init(path.text).nonUniqueNameString(p.allocator);
                                namespace_ref = try p.storeNameInRef(name);
                            }

                            var import_record_index = p.addImportRecord(
                                ImportKind.stmt,
                                path.loc,
                                path.text,
                                // TODO: import assertions
                                // path.assertions
                            );

                            if (comptime track_symbol_usage_during_parse_pass) {
                                // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                                p.import_records.items[import_record_index].calls_run_time_re_export_fn = true;
                            }

                            try p.lexer.expectOrInsertSemicolon();
                            return p.s(S.ExportStar{
                                .namespace_ref = namespace_ref,
                                .alias = alias,
                                .import_record_index = import_record_index,
                            }, loc);
                        },
                        T.t_open_brace => {
                            if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            const export_clause = try p.parseExportClause();
                            if (p.lexer.isContextualKeyword("from")) {
                                try p.lexer.expectContextualKeyword("from");
                                const parsedPath = try p.parsePath();

                                try p.lexer.expectOrInsertSemicolon();

                                if (comptime is_typescript_enabled) {
                                    // export {type Foo} from 'bar';
                                    // ->
                                    // nothing
                                    // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                                    if (export_clause.clauses.len == 0 and export_clause.had_type_only_exports) {
                                        return p.s(S.TypeScript{}, loc);
                                    }
                                }

                                const import_record_index = p.addImportRecord(.stmt, parsedPath.loc, parsedPath.text);
                                var path_name = fs.PathName.init(strings.append(p.allocator, "import_", parsedPath.text) catch unreachable);
                                const namespace_ref = p.storeNameInRef(path_name.nonUniqueNameString(p.allocator) catch unreachable) catch unreachable;

                                if (comptime track_symbol_usage_during_parse_pass) {
                                    // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                                    p.import_records.items[import_record_index].calls_run_time_re_export_fn = true;
                                }

                                return p.s(S.ExportFrom{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line, .namespace_ref = namespace_ref, .import_record_index = import_record_index }, loc);
                            }
                            try p.lexer.expectOrInsertSemicolon();

                            if (comptime is_typescript_enabled) {
                                // export {type Foo};
                                // ->
                                // nothing
                                // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                                if (export_clause.clauses.len == 0 and export_clause.had_type_only_exports) {
                                    return p.s(S.TypeScript{}, loc);
                                }
                            }

                            return p.s(S.ExportClause{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line }, loc);
                        },
                        T.t_equals => {
                            // "export = value;"

                            p.es6_export_keyword = previousExportKeyword; // This wasn't an ESM export statement after all
                            if (is_typescript_enabled) {
                                try p.lexer.next();
                                var value = try p.parseExpr(.lowest);
                                try p.lexer.expectOrInsertSemicolon();
                                return p.s(S.ExportEquals{ .value = value }, loc);
                            }
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        },
                        else => {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        },
                    }
                },

                .t_function => {
                    try p.lexer.next();
                    return try p.parseFnStmt(loc, opts, null);
                },
                .t_enum => {
                    if (!is_typescript_enabled) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                    return p.parseTypescriptEnumStmt(loc, opts);
                },
                .t_at => {
                    // Parse decorators before class statements, which are potentially exported
                    if (is_typescript_enabled) {
                        const scope_index = p.scopes_in_order.items.len;
                        const ts_decorators = try p.parseTypeScriptDecorators();

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
                            try p.lexer.expected(.t_class);
                        }

                        return p.parseStmt(opts);
                    }
                    // notimpl();

                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
                .t_class => {
                    if (opts.lexical_decl != .allow_all) {
                        try p.forbidLexicalDecl(loc);
                    }

                    return try p.parseClassStmt(loc, opts);
                },
                .t_var => {
                    try p.lexer.next();
                    const decls = try p.parseAndDeclareDecls(.hoisted, opts);
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.Local{ .kind = .k_var, .decls = decls, .is_export = opts.is_export }, loc);
                },
                .t_const => {
                    if (opts.lexical_decl != .allow_all) {
                        try p.forbidLexicalDecl(loc);
                    }
                    // p.markSyntaxFeature(compat.Const, p.lexer.Range())

                    try p.lexer.next();

                    if (is_typescript_enabled and p.lexer.token == T.t_enum) {
                        return p.parseTypescriptEnumStmt(loc, opts);
                    }

                    const decls = try p.parseAndDeclareDecls(.cconst, opts);
                    try p.lexer.expectOrInsertSemicolon();

                    if (!opts.is_typescript_declare) {
                        try p.requireInitializers(decls);
                    }

                    // When HMR is enabled, replace all const/let exports with var
                    const kind = if (p.options.features.hot_module_reloading and opts.is_export) S.Local.Kind.k_var else S.Local.Kind.k_const;
                    return p.s(S.Local{ .kind = kind, .decls = decls, .is_export = opts.is_export }, loc);
                },
                .t_if => {
                    try p.lexer.next();
                    try p.lexer.expect(.t_open_paren);
                    const test_ = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{
                        .lexical_decl = .allow_fn_inside_if,
                    };
                    const yes = try p.parseStmt(&stmtOpts);
                    var no: ?Stmt = null;
                    if (p.lexer.token == .t_else) {
                        try p.lexer.next();
                        stmtOpts = ParseStatementOptions{
                            .lexical_decl = .allow_fn_inside_if,
                        };
                        no = try p.parseStmt(&stmtOpts);
                    }

                    return p.s(S.If{
                        .test_ = test_,
                        .yes = yes,
                        .no = no,
                    }, loc);
                },
                .t_do => {
                    try p.lexer.next();
                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);
                    try p.lexer.expect(.t_while);
                    try p.lexer.expect(.t_open_paren);
                    const test_ = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);

                    // This is a weird corner case where automatic semicolon insertion applies
                    // even without a newline present
                    if (p.lexer.token == .t_semicolon) {
                        try p.lexer.next();
                    }
                    return p.s(S.DoWhile{ .body = body, .test_ = test_ }, loc);
                },
                .t_while => {
                    try p.lexer.next();

                    try p.lexer.expect(.t_open_paren);
                    const test_ = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);

                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);

                    return p.s(S.While{
                        .body = body,
                        .test_ = test_,
                    }, loc);
                },
                .t_with => {
                    try p.lexer.next();
                    try p.lexer.expect(.t_open_paren);
                    const test_ = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);

                    const body_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, body_loc);
                    defer p.popScope();

                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);

                    return p.s(S.With{ .body = body, .body_loc = body_loc, .value = test_ }, loc);
                },
                .t_switch => {
                    try p.lexer.next();

                    try p.lexer.expect(.t_open_paren);
                    const test_ = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);

                    const body_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, body_loc);
                    defer p.popScope();

                    try p.lexer.expect(.t_open_brace);
                    var cases = ListManaged(js_ast.Case).init(p.allocator);
                    var foundDefault = false;
                    var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                    var value: ?js_ast.Expr = null;
                    while (p.lexer.token != .t_close_brace) {
                        var body = StmtList.init(p.allocator);
                        value = null;
                        if (p.lexer.token == .t_default) {
                            if (foundDefault) {
                                try p.log.addRangeError(p.source, p.lexer.range(), "Multiple default clauses are not allowed");
                                return error.SyntaxError;
                            }

                            foundDefault = true;
                            try p.lexer.next();
                            try p.lexer.expect(.t_colon);
                        } else {
                            try p.lexer.expect(.t_case);
                            value = try p.parseExpr(.lowest);
                            try p.lexer.expect(.t_colon);
                        }

                        caseBody: while (true) {
                            switch (p.lexer.token) {
                                .t_close_brace, .t_case, .t_default => {
                                    break :caseBody;
                                },
                                else => {
                                    stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                                    try body.append(try p.parseStmt(&stmtOpts));
                                },
                            }
                        }
                        try cases.append(js_ast.Case{ .value = value, .body = body.items, .loc = logger.Loc.Empty });
                    }
                    try p.lexer.expect(.t_close_brace);
                    return p.s(S.Switch{ .test_ = test_, .body_loc = body_loc, .cases = cases.items }, loc);
                },
                .t_try => {
                    try p.lexer.next();
                    const body_loc = p.lexer.loc();
                    try p.lexer.expect(.t_open_brace);
                    _ = try p.pushScopeForParsePass(.block, loc);
                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                    p.popScope();
                    try p.lexer.next();

                    var catch_: ?js_ast.Catch = null;
                    var finally: ?js_ast.Finally = null;

                    if (p.lexer.token == .t_catch) {
                        const catch_loc = p.lexer.loc();
                        _ = try p.pushScopeForParsePass(.block, catch_loc);
                        try p.lexer.next();
                        var binding: ?js_ast.Binding = null;

                        // The catch binding is optional, and can be omitted
                        // jarred: TIL!
                        if (p.lexer.token != .t_open_brace) {
                            try p.lexer.expect(.t_open_paren);
                            var value = try p.parseBinding();

                            // Skip over types
                            if (is_typescript_enabled and p.lexer.token == .t_colon) {
                                try p.lexer.expect(.t_colon);
                                try p.skipTypeScriptType(.lowest);
                            }

                            try p.lexer.expect(.t_close_paren);

                            // Bare identifiers are a special case
                            var kind = Symbol.Kind.other;
                            switch (value.data) {
                                .b_identifier => {
                                    kind = .catch_identifier;
                                },
                                else => {},
                            }
                            stmtOpts = ParseStatementOptions{};
                            try p.declareBinding(kind, &value, &stmtOpts);
                            binding = value;
                        }

                        try p.lexer.expect(.t_open_brace);
                        stmtOpts = ParseStatementOptions{};
                        const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                        try p.lexer.next();
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
                        try p.lexer.expect(.t_finally);
                        try p.lexer.expect(.t_open_brace);
                        stmtOpts = ParseStatementOptions{};
                        const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                        try p.lexer.next();
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

                    try p.lexer.next();

                    // "for await (let x of y) {}"
                    var isForAwait = p.lexer.isContextualKeyword("await");
                    if (isForAwait) {
                        const await_range = p.lexer.range();
                        if (p.fn_or_arrow_data_parse.allow_await != .allow_expr) {
                            try p.log.addRangeError(p.source, await_range, "Cannot use \"await\" outside an async function");
                            isForAwait = false;
                        } else {
                            // TODO: improve error handling here
                            //         		didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                            if (p.fn_or_arrow_data_parse.is_top_level) {
                                p.top_level_await_keyword = await_range;
                                // p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                            }
                        }
                        try p.lexer.next();
                    }

                    try p.lexer.expect(.t_open_paren);

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
                            try p.lexer.next();
                            var stmtOpts = ParseStatementOptions{};
                            decls = try p.parseAndDeclareDecls(.hoisted, &stmtOpts);
                            init_ = p.s(S.Local{ .kind = .k_var, .decls = decls }, init_loc);
                        },
                        // for (const )
                        .t_const => {
                            try p.lexer.next();
                            var stmtOpts = ParseStatementOptions{};
                            decls = try p.parseAndDeclareDecls(.cconst, &stmtOpts);
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
                            return error.SyntaxError;
                        }

                        if (isForAwait and !p.lexer.isContextualKeyword("of")) {
                            if (init_ != null) {
                                try p.lexer.expectedString("\"of\"");
                            } else {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                        }

                        try p.forbidInitializers(decls, "of", false);
                        try p.lexer.next();
                        const value = try p.parseExpr(.comma);
                        try p.lexer.expect(.t_close_paren);
                        var stmtOpts = ParseStatementOptions{};
                        const body = try p.parseStmt(&stmtOpts);
                        return p.s(S.ForOf{ .is_await = isForAwait, .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                    }

                    // Detect for-in loops
                    if (p.lexer.token == .t_in) {
                        try p.forbidInitializers(decls, "in", is_var);
                        try p.lexer.next();
                        const value = try p.parseExpr(.lowest);
                        try p.lexer.expect(.t_close_paren);
                        var stmtOpts = ParseStatementOptions{};
                        const body = try p.parseStmt(&stmtOpts);
                        return p.s(S.ForIn{ .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                    }

                    // Only require "const" statement initializers when we know we're a normal for loop
                    if (init_) |init_stmt| {
                        switch (init_stmt.data) {
                            .s_local => {
                                if (init_stmt.data.s_local.kind == .k_const) {
                                    try p.requireInitializers(decls);
                                }
                            },
                            else => {},
                        }
                    }

                    try p.lexer.expect(.t_semicolon);
                    if (p.lexer.token != .t_semicolon) {
                        test_ = try p.parseExpr(.lowest);
                    }

                    try p.lexer.expect(.t_semicolon);

                    if (p.lexer.token != .t_close_paren) {
                        update = try p.parseExpr(.lowest);
                    }

                    try p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);
                    return p.s(
                        S.For{ .init = init_, .test_ = test_, .update = update, .body = body },
                        loc,
                    );
                },
                .t_import => {
                    const previous_import_keyword = p.es6_import_keyword;
                    p.es6_import_keyword = p.lexer.range();
                    try p.lexer.next();
                    var stmt: S.Import = S.Import{
                        .namespace_ref = Ref.None,
                        .import_record_index = std.math.maxInt(u32),
                    };
                    var was_originally_bare_import = false;

                    // "export import foo = bar"
                    if ((opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) and p.lexer.token != .t_identifier) {
                        try p.lexer.expected(.t_identifier);
                    }

                    switch (p.lexer.token) {
                        // "import('path')"
                        // "import.meta"
                        .t_open_paren, .t_dot => {
                            p.es6_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                            const expr = try p.parseSuffix(try p.parseImportExpr(loc, .lowest), .lowest, null, Expr.EFlags.none);
                            try p.lexer.expectOrInsertSemicolon();
                            return p.s(S.SExpr{
                                .value = expr,
                            }, loc);
                        },
                        .t_string_literal, .t_no_substitution_template_literal => {
                            // "import 'path'"
                            if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                            was_originally_bare_import = true;
                        },
                        .t_asterisk => {
                            // "import * as ns from 'path'"
                            if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            try p.lexer.next();
                            try p.lexer.expectContextualKeyword("as");
                            stmt = S.Import{
                                .namespace_ref = try p.storeNameInRef(p.lexer.identifier),
                                .star_name_loc = p.lexer.loc(),
                                .import_record_index = std.math.maxInt(u32),
                            };
                            try p.lexer.expect(.t_identifier);
                            try p.lexer.expectContextualKeyword("from");
                        },
                        .t_open_brace => {
                            // "import {item1, item2} from 'path'"
                            if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                            var importClause = try p.parseImportClause();
                            if (comptime is_typescript_enabled) {
                                if (importClause.had_type_only_imports and importClause.items.len == 0) {
                                    try p.lexer.expectContextualKeyword("from");
                                    _ = try p.parsePath();
                                    try p.lexer.expectOrInsertSemicolon();
                                    return p.s(S.TypeScript{}, loc);
                                }
                            }

                            stmt = S.Import{
                                .namespace_ref = Ref.None,
                                .import_record_index = std.math.maxInt(u32),
                                .items = importClause.items,
                                .is_single_line = importClause.is_single_line,
                            };
                            try p.lexer.expectContextualKeyword("from");
                        },
                        .t_identifier => {
                            // "import defaultItem from 'path'"
                            // "import foo = bar"
                            if (!opts.is_module_scope and (!opts.is_namespace_scope)) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }

                            var default_name = p.lexer.identifier;
                            stmt = S.Import{ .namespace_ref = Ref.None, .import_record_index = std.math.maxInt(u32), .default_name = LocRef{
                                .loc = p.lexer.loc(),
                                .ref = try p.storeNameInRef(default_name),
                            } };
                            try p.lexer.next();

                            if (comptime is_typescript_enabled) {
                                // Skip over type-only imports
                                if (strings.eqlComptime(default_name, "type")) {
                                    switch (p.lexer.token) {
                                        .t_identifier => {
                                            if (!strings.eqlComptime(p.lexer.identifier, "from")) {
                                                default_name = p.lexer.identifier;
                                                stmt.default_name.?.loc = p.lexer.loc();
                                                try p.lexer.next();

                                                if (p.lexer.token == .t_equals) {
                                                    // "import type foo = require('bar');"
                                                    // "import type foo = bar.baz;"
                                                    opts.is_typescript_declare = true;
                                                    return try p.parseTypeScriptImportEqualsStmt(loc, opts, stmt.default_name.?.loc, default_name);
                                                } else {
                                                    // "import type foo from 'bar';"
                                                    try p.lexer.expectContextualKeyword("from");
                                                    _ = try p.parsePath();
                                                    try p.lexer.expectOrInsertSemicolon();
                                                    return p.s(S.TypeScript{}, loc);
                                                }
                                            }
                                        },
                                        .t_asterisk => {
                                            // "import type * as foo from 'bar';"
                                            try p.lexer.next();
                                            try p.lexer.expectContextualKeyword("as");
                                            try p.lexer.expect(.t_identifier);
                                            try p.lexer.expectContextualKeyword("from");
                                            _ = try p.parsePath();
                                            try p.lexer.expectOrInsertSemicolon();
                                            return p.s(S.TypeScript{}, loc);
                                        },

                                        .t_open_brace => {
                                            // "import type {foo} from 'bar';"
                                            _ = try p.parseImportClause();
                                            try p.lexer.expectContextualKeyword("from");
                                            _ = try p.parsePath();
                                            try p.lexer.expectOrInsertSemicolon();
                                            return p.s(S.TypeScript{}, loc);
                                        },
                                        else => {},
                                    }
                                }

                                // Parse TypeScript import assignment statements
                                if (p.lexer.token == .t_equals or opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) {
                                    p.es6_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                                    return p.parseTypeScriptImportEqualsStmt(loc, opts, logger.Loc.Empty, default_name);
                                }
                            }

                            if (p.lexer.token == .t_comma) {
                                try p.lexer.next();

                                switch (p.lexer.token) {
                                    // "import defaultItem, * as ns from 'path'"
                                    .t_asterisk => {
                                        try p.lexer.next();
                                        try p.lexer.expectContextualKeyword("as");
                                        stmt.namespace_ref = try p.storeNameInRef(p.lexer.identifier);
                                        stmt.star_name_loc = p.lexer.loc();
                                        try p.lexer.expect(.t_identifier);
                                    },
                                    // "import defaultItem, {item1, item2} from 'path'"
                                    .t_open_brace => {
                                        const importClause = try p.parseImportClause();

                                        stmt.items = importClause.items;
                                        stmt.is_single_line = importClause.is_single_line;
                                    },
                                    else => {
                                        try p.lexer.unexpected();
                                        return error.SyntaxError;
                                    },
                                }
                            }

                            try p.lexer.expectContextualKeyword("from");
                        },
                        else => {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        },
                    }

                    const path = try p.parsePath();
                    try p.lexer.expectOrInsertSemicolon();

                    return try p.processImportStatement(stmt, path, loc, was_originally_bare_import);
                },
                .t_break => {
                    try p.lexer.next();
                    const name = try p.parseLabelName();
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.Break{ .label = name }, loc);
                },
                .t_continue => {
                    try p.lexer.next();
                    const name = try p.parseLabelName();
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.Continue{ .label = name }, loc);
                },
                .t_return => {
                    if (p.fn_or_arrow_data_parse.is_return_disallowed) {
                        try p.log.addRangeError(p.source, p.lexer.range(), "A return statement cannot be used here");
                    }
                    try p.lexer.next();
                    var value: ?Expr = null;
                    if ((p.lexer.token != .t_semicolon and
                        !p.lexer.has_newline_before and
                        p.lexer.token != .t_close_brace and
                        p.lexer.token != .t_end_of_file))
                    {
                        value = try p.parseExpr(.lowest);
                    }
                    p.latest_return_had_semicolon = p.lexer.token == .t_semicolon;
                    try p.lexer.expectOrInsertSemicolon();

                    return p.s(S.Return{ .value = value }, loc);
                },
                .t_throw => {
                    try p.lexer.next();
                    if (p.lexer.has_newline_before) {
                        try p.log.addError(p.source, logger.Loc{
                            .start = loc.start + 5,
                        }, "Unexpected newline after \"throw\"");
                        return error.SyntaxError;
                    }
                    const expr = try p.parseExpr(.lowest);
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.Throw{ .value = expr }, loc);
                },
                .t_debugger => {
                    try p.lexer.next();
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.Debugger{}, loc);
                },
                .t_open_brace => {
                    _ = try p.pushScopeForParsePass(.block, loc);
                    defer p.popScope();
                    try p.lexer.next();
                    var stmtOpts = ParseStatementOptions{};
                    const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                    try p.lexer.next();
                    return p.s(S.Block{
                        .stmts = stmts,
                    }, loc);
                },

                else => {
                    const is_identifier = p.lexer.token == .t_identifier;
                    const name = p.lexer.identifier;
                    var emiss = E.Missing{};
                    // Parse either an async function, an async expression, or a normal expression
                    var expr: Expr = Expr{ .loc = loc, .data = Expr.Data{ .e_missing = emiss } };
                    if (is_identifier and strings.eqlComptime(p.lexer.raw(), "async")) {
                        var async_range = p.lexer.range();
                        try p.lexer.next();
                        if (p.lexer.token == .t_function and !p.lexer.has_newline_before) {
                            try p.lexer.next();

                            return try p.parseFnStmt(async_range.loc, opts, async_range);
                        }

                        expr = try p.parseSuffix(try p.parseAsyncPrefixExpr(async_range, .lowest), .lowest, null, Expr.EFlags.none);
                    } else {
                        const exprOrLet = try p.parseExprOrLetStmt(opts);
                        switch (exprOrLet.stmt_or_expr) {
                            .stmt => |stmt| {
                                try p.lexer.expectOrInsertSemicolon();
                                return stmt;
                            },
                            .expr => |_expr| {
                                expr = _expr;
                            },
                        }
                    }
                    if (is_identifier) {
                        switch (expr.data) {
                            .e_identifier => |ident| {
                                if (p.lexer.token == .t_colon and !opts.hasDecorators()) {
                                    _ = try p.pushScopeForParsePass(.label, loc);
                                    defer p.popScope();

                                    // Parse a labeled statement
                                    try p.lexer.next();

                                    const _name = LocRef{ .loc = expr.loc, .ref = ident.ref };
                                    var nestedOpts = ParseStatementOptions{};

                                    switch (opts.lexical_decl) {
                                        .allow_all, .allow_fn_inside_label => {
                                            nestedOpts.lexical_decl = .allow_fn_inside_label;
                                        },
                                        else => {},
                                    }
                                    var stmt = try p.parseStmt(&nestedOpts);
                                    return p.s(S.Label{ .name = _name, .stmt = stmt }, loc);
                                }
                            },
                            else => {},
                        }

                        if (is_typescript_enabled) {
                            if (js_lexer.TypescriptStmtKeyword.List.get(name)) |ts_stmt| {
                                switch (ts_stmt) {
                                    .ts_stmt_type => {
                                        if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
                                            // "type Foo = any"
                                            var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };
                                            try p.skipTypeScriptTypeStmt(&stmtOpts);
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
                                            return p.parseTypeScriptNamespaceStmt(loc, opts);
                                        }
                                    },
                                    .ts_stmt_interface => {
                                        // "interface Foo {}"
                                        var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };

                                        try p.skipTypeScriptInterfaceStmt(&stmtOpts);
                                        return p.s(S.TypeScript{}, loc);
                                    },
                                    .ts_stmt_abstract => {
                                        if (p.lexer.token == .t_class or opts.ts_decorators != null) {
                                            return try p.parseClassStmt(loc, opts);
                                        }
                                    },
                                    .ts_stmt_global => {
                                        // "declare module 'fs' { global { namespace NodeJS {} } }"
                                        if (opts.is_namespace_scope and opts.is_typescript_declare and p.lexer.token == .t_open_brace) {
                                            try p.lexer.next();
                                            _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                            try p.lexer.next();
                                            return p.s(S.TypeScript{}, loc);
                                        }
                                    },
                                    .ts_stmt_declare => {
                                        opts.lexical_decl = .allow_all;
                                        opts.is_typescript_declare = true;

                                        // "@decorator declare class Foo {}"
                                        // "@decorator declare abstract class Foo {}"
                                        if (opts.ts_decorators != null and p.lexer.token != .t_class and !p.lexer.isContextualKeyword("abstract")) {
                                            try p.lexer.expected(.t_class);
                                        }

                                        // "declare global { ... }"
                                        if (p.lexer.isContextualKeyword("global")) {
                                            try p.lexer.next();
                                            try p.lexer.expect(.t_open_brace);
                                            _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                            try p.lexer.next();
                                            return p.s(S.TypeScript{}, loc);
                                        }

                                        // "declare const x: any"
                                        const stmt = try p.parseStmt(opts);
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
                                                    var _decls = try ListManaged(G.Decl).initCapacity(p.allocator, local.decls.len);
                                                    for (local.decls) |decl| {
                                                        try extractDeclsForBinding(decl.binding, &_decls);
                                                    }
                                                    decls = _decls.items;
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
                    // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.SExpr{ .value = expr }, loc);
                },
            }

            return js_ast.Stmt.empty();
        }

        fn discardScopesUpTo(p: *P, scope_index: usize) void {
            // Remove any direct children from their parent
            var scope = p.current_scope;
            var children = scope.children;

            for (p.scopes_in_order.items[scope_index..]) |_child| {
                const child = _child orelse continue;

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
            p.scopes_in_order.shrinkRetainingCapacity(scope_index);
        }

        fn skipTypeScriptTypeStmt(p: *P, opts: *ParseStatementOptions) anyerror!void {
            if (opts.is_export and p.lexer.token == .t_open_brace) {
                // "export type {foo}"
                // "export type {foo} from 'bar'"
                _ = try p.parseExportClause();
                if (p.lexer.isContextualKeyword("from")) {
                    try p.lexer.next();
                    _ = try p.parsePath();
                }
                try p.lexer.expectOrInsertSemicolon();
                return;
            }

            const name = p.lexer.identifier;
            try p.lexer.expect(.t_identifier);

            if (opts.is_module_scope) {
                p.local_type_names.put(p.allocator, name, true) catch unreachable;
            }

            try p.skipTypeScriptTypeParameters();
            try p.lexer.expect(.t_equals);
            try p.skipTypeScriptType(.lowest);
            try p.lexer.expectOrInsertSemicolon();
        }

        fn parseTypeScriptNamespaceStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) anyerror!Stmt {
            // "namespace foo {}";
            const name_loc = p.lexer.loc();
            const name_text = p.lexer.identifier;
            try p.lexer.next();

            var name = LocRef{ .loc = name_loc, .ref = null };
            const scope_index = try p.pushScopeForParsePass(.entry, loc);

            const old_has_non_local_export_declare_inside_namespace = p.has_non_local_export_declare_inside_namespace;
            p.has_non_local_export_declare_inside_namespace = false;

            var stmts: ListManaged(Stmt) = ListManaged(Stmt).init(p.allocator);

            if (p.lexer.token == .t_dot) {
                const dot_loc = p.lexer.loc();
                try p.lexer.next();

                var _opts = ParseStatementOptions{
                    .is_export = true,
                    .is_namespace_scope = true,
                    .is_typescript_declare = opts.is_typescript_declare,
                };
                stmts.append(try p.parseTypeScriptNamespaceStmt(dot_loc, &_opts)) catch unreachable;
            } else if (opts.is_typescript_declare and p.lexer.token != .t_open_brace) {
                try p.lexer.expectOrInsertSemicolon();
            } else {
                try p.lexer.expect(.t_open_brace);
                var _opts = ParseStatementOptions{
                    .is_namespace_scope = true,
                    .is_typescript_declare = opts.is_typescript_declare,
                };
                stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, try p.parseStmtsUpTo(.t_close_brace, &_opts));
                try p.lexer.next();
            }
            const has_non_local_export_declare_inside_namespace = p.has_non_local_export_declare_inside_namespace;
            p.has_non_local_export_declare_inside_namespace = old_has_non_local_export_declare_inside_namespace;

            // Import assignments may be only used in type expressions, not value
            // expressions. If this is the case, the TypeScript compiler removes
            // them entirely from the output. That can cause the namespace itself
            // to be considered empty and thus be removed.
            var import_equal_count: usize = 0;
            const _stmts: []Stmt = stmts.items;
            for (_stmts) |stmt| {
                switch (stmt.data) {
                    .s_local => |local| {
                        if (local.was_ts_import_equals and !local.is_export) {
                            import_equal_count += 1;
                        }
                    },
                    else => {},
                }
            }

            // TypeScript omits namespaces without values. These namespaces
            // are only allowed to be used in type expressions. They are
            // allowed to be exported, but can also only be used in type
            // expressions when imported. So we shouldn't count them as a
            // real export either.
            //
            // TypeScript also strangely counts namespaces containing only
            // "export declare" statements as non-empty even though "declare"
            // statements are only type annotations. We cannot omit the namespace
            // in that case. See https://github.com/evanw/esbuild/issues/1158.
            if ((stmts.items.len == import_equal_count and !has_non_local_export_declare_inside_namespace) or opts.is_typescript_declare) {
                p.popAndDiscardScope(scope_index);
                if (opts.is_module_scope) {
                    p.local_type_names.put(p.allocator, name_text, true) catch unreachable;
                }
                return p.s(S.TypeScript{}, loc);
            }

            var arg_ref: ?Ref = null;
            if (!opts.is_typescript_declare) {
                // Avoid a collision with the namespace closure argument variable if the
                // namespace exports a symbol with the same name as the namespace itself:
                //
                //   namespace foo {
                //     export let foo = 123
                //     console.log(foo)
                //   }
                //
                // TypeScript generates the following code in this case:
                //
                //   var foo;
                //   (function (foo_1) {
                //     foo_1.foo = 123;
                //     console.log(foo_1.foo);
                //   })(foo || (foo = {}));
                //
                if (p.current_scope.members.contains(name_text)) {
                    // Add a "_" to make tests easier to read, since non-bundler tests don't
                    // run the renamer. For external-facing things the renamer will avoid
                    // collisions automatically so this isn't important for correctness.
                    arg_ref = p.newSymbol(.hoisted, strings.cat(p.allocator, "_", name_text) catch unreachable) catch unreachable;
                    p.current_scope.generated.append(p.allocator, arg_ref.?) catch unreachable;
                } else {
                    arg_ref = p.newSymbol(.hoisted, name_text) catch unreachable;
                }
            }
            p.popScope();

            if (!opts.is_typescript_declare) {
                name.ref = p.declareSymbol(.ts_namespace, name_loc, name_text) catch unreachable;
            }

            return p.s(
                S.Namespace{ .name = name, .arg = arg_ref orelse Ref.None, .stmts = stmts.items, .is_export = opts.is_export },
                loc,
            );
        }

        fn skipTypeScriptInterfaceStmt(p: *P, opts: *ParseStatementOptions) !void {
            const name = p.lexer.identifier;
            try p.lexer.expect(.t_identifier);

            if (opts.is_module_scope) {
                p.local_type_names.put(p.allocator, name, true) catch unreachable;
            }

            try p.skipTypeScriptTypeParameters();

            if (p.lexer.token == .t_extends) {
                try p.lexer.next();

                while (true) {
                    try p.skipTypeScriptType(.lowest);
                    if (p.lexer.token != .t_comma) {
                        break;
                    }
                    try p.lexer.next();
                }
            }

            if (p.lexer.isContextualKeyword("implements")) {
                try p.lexer.next();
                while (true) {
                    try p.skipTypeScriptType(.lowest);
                    if (p.lexer.token != .t_comma) {
                        break;
                    }
                    try p.lexer.next();
                }
            }

            try p.skipTypeScriptObjectType();
        }

        // This assumes the caller has already parsed the "import" token

        fn parseTypeScriptImportEqualsStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, default_name_loc: logger.Loc, default_name: string) anyerror!Stmt {
            try p.lexer.expect(.t_equals);

            const kind = S.Local.Kind.k_const;
            const name = p.lexer.identifier;
            const target = p.e(E.Identifier{ .ref = p.storeNameInRef(name) catch unreachable }, p.lexer.loc());
            var value = target;
            try p.lexer.expect(.t_identifier);

            if (strings.eqlComptime(name, "require") and p.lexer.token == .t_open_paren) {
                // "import ns = require('x')"
                try p.lexer.next();
                const path = p.e(p.lexer.toEString(), p.lexer.loc());
                try p.lexer.expect(.t_string_literal);
                try p.lexer.expect(.t_close_paren);
                if (!opts.is_typescript_declare) {
                    const args = try ExprNodeList.one(p.allocator, path);
                    value = p.e(E.Call{ .target = target, .close_paren_loc = p.lexer.loc(), .args = args }, loc);
                }
            } else {
                // "import Foo = Bar"
                // "import Foo = Bar.Baz"
                var prev_value = value;
                while (p.lexer.token == .t_dot) : (prev_value = value) {
                    try p.lexer.next();
                    value = p.e(E.Dot{ .target = prev_value, .name = p.lexer.identifier, .name_loc = p.lexer.loc() }, loc);
                    try p.lexer.expect(.t_identifier);
                }
            }

            try p.lexer.expectOrInsertSemicolon();

            if (opts.is_typescript_declare) {
                // "import type foo = require('bar');"
                // "import type foo = bar.baz;"
                return p.s(S.TypeScript{}, loc);
            }

            const ref = p.declareSymbol(.cconst, default_name_loc, default_name) catch unreachable;
            var decls = p.allocator.alloc(Decl, 1) catch unreachable;
            decls[0] = Decl{
                .binding = p.b(B.Identifier{ .ref = ref }, default_name_loc),
                .value = value,
            };
            return p.s(S.Local{ .kind = kind, .decls = decls, .is_export = opts.is_export, .was_ts_import_equals = true }, loc);
        }

        fn parseClauseAlias(p: *P, kind: string) !string {
            const loc = p.lexer.loc();

            // The alias may now be a string (see https://github.com/tc39/ecma262/pull/2154)
            if (p.lexer.token == .t_string_literal) {
                if (p.lexer.string_literal_is_ascii) {
                    return p.lexer.string_literal_slice;
                } else if (p.lexer.utf16ToStringWithValidation(p.lexer.string_literal)) |alias| {
                    return alias;
                } else |_| {
                    const r = p.source.rangeOfString(loc);
                    // TODO: improve error message
                    try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Invalid {s} alias because it contains an unpaired Unicode surrogate (like emoji)", .{kind});
                    return p.source.textForRange(r);
                }
            }

            // The alias may be a keyword
            if (!p.lexer.isIdentifierOrKeyword()) {
                try p.lexer.expect(.t_identifier);
            }

            const alias = p.lexer.identifier;
            p.checkForNonBMPCodePoint(loc, alias);
            return alias;
        }

        fn parseImportClause(
            p: *P,
        ) !ImportClause {
            var items = ListManaged(js_ast.ClauseItem).init(p.allocator);
            try p.lexer.expect(.t_open_brace);
            var is_single_line = !p.lexer.has_newline_before;
            // this variable should not exist if we're not in a typescript file
            var had_type_only_imports = if (comptime is_typescript_enabled)
                false
            else
                void{};

            while (p.lexer.token != .t_close_brace) {
                // The alias may be a keyword;
                const isIdentifier = p.lexer.token == .t_identifier;
                const alias_loc = p.lexer.loc();
                const alias = try p.parseClauseAlias("import");
                var name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(alias) };
                var original_name = alias;
                try p.lexer.next();

                const probably_type_only_import = if (comptime is_typescript_enabled)
                    strings.eqlComptime(alias, "type") and
                        p.lexer.token != .t_comma and
                        p.lexer.token != .t_close_brace
                else
                    false;

                // "import { type xx } from 'mod'"
                // "import { type xx as yy } from 'mod'"
                // "import { type 'xx' as yy } from 'mod'"
                // "import { type as } from 'mod'"
                // "import { type as as } from 'mod'"
                // "import { type as as as } from 'mod'"
                if (probably_type_only_import) {
                    if (p.lexer.isContextualKeyword("as")) {
                        try p.lexer.next();
                        if (p.lexer.isContextualKeyword("as")) {
                            original_name = p.lexer.identifier;
                            name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(original_name) };
                            try p.lexer.next();

                            if (p.lexer.token == .t_identifier) {

                                // "import { type as as as } from 'mod'"
                                // "import { type as as foo } from 'mod'"
                                had_type_only_imports = true;
                                try p.lexer.next();
                            } else {
                                // "import { type as as } from 'mod'"

                                try items.append(.{
                                    .alias = alias,
                                    .alias_loc = alias_loc,
                                    .name = name,
                                    .original_name = original_name,
                                });
                            }
                        } else if (p.lexer.token == .t_identifier) {
                            had_type_only_imports = true;

                            // "import { type as xxx } from 'mod'"
                            original_name = p.lexer.identifier;
                            name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(original_name) };
                            try p.lexer.expect(.t_identifier);

                            if (isEvalOrArguments(original_name)) {
                                const r = p.source.rangeOfString(name.loc);
                                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use {s} as an identifier here", .{original_name});
                            }

                            try items.append(.{
                                .alias = alias,
                                .alias_loc = alias_loc,
                                .name = name,
                                .original_name = original_name,
                            });
                        }
                    } else {
                        const is_identifier = p.lexer.token == .t_identifier;

                        // "import { type xx } from 'mod'"
                        // "import { type xx as yy } from 'mod'"
                        // "import { type if as yy } from 'mod'"
                        // "import { type 'xx' as yy } from 'mod'"
                        _ = try p.parseClauseAlias("import");
                        try p.lexer.next();

                        if (p.lexer.isContextualKeyword("as")) {
                            try p.lexer.next();

                            try p.lexer.expect(.t_identifier);
                        } else if (!is_identifier) {
                            // An import where the name is a keyword must have an alias
                            try p.lexer.expectedString("\"as\"");
                        }
                        had_type_only_imports = true;
                    }
                } else {
                    if (p.lexer.isContextualKeyword("as")) {
                        try p.lexer.next();
                        original_name = p.lexer.identifier;
                        name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(original_name) };
                        try p.lexer.expect(.t_identifier);
                    } else if (!isIdentifier) {
                        // An import where the name is a keyword must have an alias
                        try p.lexer.expectedString("\"as\"");
                    }

                    // Reject forbidden names
                    if (isEvalOrArguments(original_name)) {
                        const r = js_lexer.rangeOfIdentifier(p.source, name.loc);
                        try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use \"{s}\" as an identifier here", .{original_name});
                    }

                    try items.append(js_ast.ClauseItem{
                        .alias = alias,
                        .alias_loc = alias_loc,
                        .name = name,
                        .original_name = original_name,
                    });
                }

                if (p.lexer.token != .t_comma) {
                    break;
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }

                try p.lexer.next();

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }

            try p.lexer.expect(.t_close_brace);
            return ImportClause{
                .items = items.items,
                .is_single_line = is_single_line,
                .had_type_only_imports = if (comptime is_typescript_enabled)
                    had_type_only_imports
                else
                    false,
            };
        }

        fn forbidInitializers(p: *P, decls: []G.Decl, comptime loop_type: string, is_var: bool) !void {
            switch (decls.len) {
                0 => {},
                1 => {
                    if (decls[0].value) |value| {
                        if (is_var) {

                            // This is a weird special case. Initializers are allowed in "var"
                            // statements with identifier bindings.
                            return;
                        }

                        try p.log.addError(p.source, value.loc, comptime std.fmt.comptimePrint("for-{s} loop variables cannot have an initializer", .{loop_type}));
                    }
                },
                else => {
                    try p.log.addError(p.source, decls[0].binding.loc, comptime std.fmt.comptimePrint("for-{s} loops must have a single declaration", .{loop_type}));
                },
            }
        }

        fn parseExprOrLetStmt(p: *P, opts: *ParseStatementOptions) !ExprOrLetStmt {
            var let_range = p.lexer.range();
            var raw = p.lexer.raw();
            if (p.lexer.token != .t_identifier or !strings.eqlComptime(raw, "let")) {
                // Output.print("HI", .{});
                return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = try p.parseExpr(.lowest) } };
            }

            try p.lexer.next();

            switch (p.lexer.token) {
                .t_identifier, .t_open_bracket, .t_open_brace => {
                    if (opts.lexical_decl == .allow_all or !p.lexer.has_newline_before or p.lexer.token == .t_open_bracket) {
                        if (opts.lexical_decl != .allow_all) {
                            try p.forbidLexicalDecl(let_range.loc);
                        }

                        const decls = try p.parseAndDeclareDecls(.other, opts);
                        return ExprOrLetStmt{
                            .stmt_or_expr = js_ast.StmtOrExpr{
                                .stmt = p.s(S.Local{
                                    // Replace all "export let" with "export var" when HMR is enabled
                                    .kind = if (opts.is_export and p.options.features.hot_module_reloading) .k_var else .k_let,
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
            return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = try p.parseSuffix(expr, .lowest, null, Expr.EFlags.none) } };
        }

        fn requireInitializers(p: *P, decls: []G.Decl) !void {
            for (decls) |decl| {
                if (decl.value == null) {
                    switch (decl.binding.data) {
                        .b_identifier => |ident| {
                            const r = js_lexer.rangeOfIdentifier(p.source, decl.binding.loc);
                            try p.log.addRangeErrorFmt(p.source, r, p.allocator, "The constant \"{s}\" must be initialized", .{p.symbols.items[ident.ref.innerIndex()].original_name});
                            // return;/
                        },
                        else => {
                            try p.log.addError(p.source, decl.binding.loc, "This constant must be initialized");
                        },
                    }
                }
            }
        }

        fn parseBinding(p: *P) anyerror!Binding {
            var loc = p.lexer.loc();

            switch (p.lexer.token) {
                .t_identifier => {
                    const name = p.lexer.identifier;
                    if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and strings.eqlComptime(name, "yield"))) {
                        // TODO: add fmt to addRangeError
                        p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"yield\" or \"await\" here.") catch unreachable;
                    }

                    const ref = p.storeNameInRef(name) catch unreachable;
                    try p.lexer.next();
                    return p.b(B.Identifier{ .ref = ref }, loc);
                },
                .t_open_bracket => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var items = ListManaged(js_ast.ArrayBinding).init(p.allocator);
                    var has_spread = false;

                    // "in" expressions are allowed
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while (p.lexer.token != .t_close_bracket) {
                        if (p.lexer.token == .t_comma) {
                            items.append(js_ast.ArrayBinding{
                                .binding = Binding{ .data = Prefill.Data.BMissing, .loc = p.lexer.loc() },
                            }) catch unreachable;
                        } else {
                            if (p.lexer.token == .t_dot_dot_dot) {
                                try p.lexer.next();
                                has_spread = true;

                                // This was a bug in the ES2015 spec that was fixed in ES2016
                                if (p.lexer.token != .t_identifier) {
                                    // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())

                                }
                            }

                            const binding = try p.parseBinding();

                            var default_value: ?Expr = null;
                            if (!has_spread and p.lexer.token == .t_equals) {
                                try p.lexer.next();
                                default_value = try p.parseExpr(.comma);
                            }

                            items.append(js_ast.ArrayBinding{ .binding = binding, .default_value = default_value }) catch unreachable;

                            // Commas after spread elements are not allowed
                            if (has_spread and p.lexer.token == .t_comma) {
                                p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                                return error.SyntaxError;
                            }
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                        try p.lexer.next();

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }

                    p.allow_in = old_allow_in;

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_bracket);
                    return p.b(B.Array{
                        .items = items.items,
                        .has_spread = has_spread,
                        .is_single_line = is_single_line,
                    }, loc);
                },
                .t_open_brace => {
                    // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var properties = ListManaged(js_ast.B.Property).init(p.allocator);

                    // "in" expressions are allowed
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while (p.lexer.token != .t_close_brace) {
                        var property = try p.parsePropertyBinding();
                        properties.append(property) catch unreachable;

                        // Commas after spread elements are not allowed
                        if (property.flags.contains(.is_spread) and p.lexer.token == .t_comma) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                            return error.SyntaxError;
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                        try p.lexer.next();
                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }

                    p.allow_in = old_allow_in;

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_brace);

                    return p.b(B.Object{
                        .properties = properties.items,
                        .is_single_line = is_single_line,
                    }, loc);
                },
                else => {},
            }

            try p.lexer.expect(.t_identifier);
            return Binding{ .loc = loc, .data = Prefill.Data.BMissing };
        }

        pub fn parsePropertyBinding(p: *P) anyerror!B.Property {
            var key: js_ast.Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
            var is_computed = false;

            switch (p.lexer.token) {
                .t_dot_dot_dot => {
                    try p.lexer.next();
                    const value = p.b(
                        B.Identifier{
                            .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable,
                        },
                        p.lexer.loc(),
                    );
                    try p.lexer.expect(.t_identifier);
                    return B.Property{
                        .key = p.e(E.Missing{}, p.lexer.loc()),

                        .flags = Flags.Property.init(.{ .is_spread = true }),
                        .value = value,
                    };
                },
                .t_numeric_literal => {
                    key = p.e(E.Number{
                        .value = p.lexer.number,
                    }, p.lexer.loc());
                    // check for legacy octal literal
                    try p.lexer.next();
                },
                .t_string_literal => {
                    key = try p.parseStringLiteral();
                },
                .t_big_integer_literal => {
                    key = p.e(E.BigInt{
                        .value = p.lexer.identifier,
                    }, p.lexer.loc());
                    // p.markSyntaxFeature(compat.BigInt, p.lexer.Range())
                    try p.lexer.next();
                },
                .t_open_bracket => {
                    is_computed = true;
                    try p.lexer.next();
                    key = try p.parseExpr(.comma);
                    try p.lexer.expect(.t_close_bracket);
                },
                else => {
                    const name = p.lexer.identifier;
                    const loc = p.lexer.loc();

                    if (!p.lexer.isIdentifierOrKeyword()) {
                        try p.lexer.expect(.t_identifier);
                    }

                    try p.lexer.next();

                    key = p.e(E.String{ .data = name }, loc);

                    if (p.lexer.token != .t_colon and p.lexer.token != .t_open_paren) {
                        const ref = p.storeNameInRef(name) catch unreachable;
                        const value = p.b(B.Identifier{ .ref = ref }, loc);
                        var default_value: ?Expr = null;
                        if (p.lexer.token == .t_equals) {
                            try p.lexer.next();
                            default_value = try p.parseExpr(.comma);
                        }

                        return B.Property{
                            .key = key,
                            .value = value,
                            .default_value = default_value,
                        };
                    }
                },
            }

            try p.lexer.expect(.t_colon);
            const value = try p.parseBinding();

            var default_value: ?Expr = null;
            if (p.lexer.token == .t_equals) {
                try p.lexer.next();
                default_value = try p.parseExpr(.comma);
            }

            return B.Property{
                .flags = Flags.Property.init(.{
                    .is_computed = is_computed,
                }),
                .key = key,
                .value = value,
                .default_value = default_value,
            };
        }

        fn parseAndDeclareDecls(p: *P, kind: Symbol.Kind, opts: *ParseStatementOptions) anyerror![]G.Decl {
            var decls = ListManaged(G.Decl).init(p.allocator);

            while (true) {
                // Forbid "let let" and "const let" but not "var let"
                if ((kind == .other or kind == .cconst) and p.lexer.isContextualKeyword("let")) {
                    p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"let\" as an identifier here") catch unreachable;
                }

                var value: ?js_ast.Expr = null;
                var local = try p.parseBinding();
                p.declareBinding(kind, &local, opts) catch unreachable;

                // Skip over types
                if (comptime is_typescript_enabled) {
                    // "let foo!"
                    var is_definite_assignment_assertion = p.lexer.token == .t_exclamation;
                    if (is_definite_assignment_assertion) {
                        try p.lexer.next();
                    }

                    // "let foo: number"
                    if (is_definite_assignment_assertion or p.lexer.token == .t_colon) {
                        try p.lexer.expect(.t_colon);
                        try p.skipTypeScriptType(.lowest);
                    }

                    if (p.lexer.token == .t_close_paren) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \")\"") catch unreachable;
                        return error.SyntaxError;
                    }
                }

                if (p.lexer.token == .t_equals) {
                    try p.lexer.next();
                    value = try p.parseExpr(.comma);
                }

                decls.append(G.Decl{
                    .binding = local,
                    .value = value,
                }) catch unreachable;

                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }

            return decls.items;
        }

        pub fn parseTypescriptEnumStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) anyerror!Stmt {
            try p.lexer.expect(.t_enum);
            const name_loc = p.lexer.loc();
            const name_text = p.lexer.identifier;
            try p.lexer.expect(.t_identifier);
            var name = LocRef{ .loc = name_loc, .ref = Ref.None };
            var arg_ref = Ref.None;
            if (!opts.is_typescript_declare) {
                name.ref = try p.declareSymbol(.ts_enum, name_loc, name_text);
                _ = try p.pushScopeForParsePass(.entry, loc);
            }

            try p.lexer.expect(.t_open_brace);

            var values = std.ArrayList(js_ast.EnumValue).init(p.allocator);
            while (p.lexer.token != .t_close_brace) {
                var value = js_ast.EnumValue{ .loc = p.lexer.loc(), .ref = Ref.None, .name = undefined, .value = null };
                var needs_symbol = false;

                // Parse the name
                if (p.lexer.token == .t_string_literal) {
                    value.name = p.lexer.toEString();
                } else if (p.lexer.isIdentifierOrKeyword()) {
                    value.name = E.String{ .data = p.lexer.identifier };
                    needs_symbol = true;
                } else {
                    try p.lexer.expect(.t_identifier);
                }
                try p.lexer.next();

                // Identifiers can be referenced by other values

                if (!opts.is_typescript_declare and needs_symbol) {
                    value.ref = try p.declareSymbol(.other, value.loc, try value.name.string(p.allocator));
                }

                // Parse the initializer
                if (p.lexer.token == .t_equals) {
                    try p.lexer.next();
                    value.value = try p.parseExpr(.comma);
                }

                values.append(value) catch unreachable;

                if (p.lexer.token != .t_comma and p.lexer.token != .t_semicolon) {
                    break;
                }

                try p.lexer.next();
            }

            if (!opts.is_typescript_declare) {
                // Avoid a collision with the enum closure argument variable if the
                // enum exports a symbol with the same name as the enum itself:
                //
                //   enum foo {
                //     foo = 123,
                //     bar = foo,
                //   }
                //
                // TypeScript generates the following code in this case:
                //
                //   var foo;
                //   (function (foo) {
                //     foo[foo["foo"] = 123] = "foo";
                //     foo[foo["bar"] = 123] = "bar";
                //   })(foo || (foo = {}));
                //
                // Whereas in this case:
                //
                //   enum foo {
                //     bar = foo as any,
                //   }
                //
                // TypeScript generates the following code:
                //
                //   var foo;
                //   (function (foo) {
                //     foo[foo["bar"] = foo] = "bar";
                //   })(foo || (foo = {}));
                //
                if (p.current_scope.members.contains(name_text)) {
                    // Add a "_" to make tests easier to read, since non-bundler tests don't
                    // run the renamer. For external-facing things the renamer will avoid
                    // collisions automatically so this isn't important for correctness.
                    arg_ref = p.newSymbol(.hoisted, strings.cat(p.allocator, "_", name_text) catch unreachable) catch unreachable;
                    p.current_scope.generated.append(p.allocator, arg_ref) catch unreachable;
                } else {
                    arg_ref = p.declareSymbol(.hoisted, name_loc, name_text) catch unreachable;
                }

                p.popScope();
            }

            try p.lexer.expect(.t_close_brace);

            if (opts.is_typescript_declare) {
                if (opts.is_namespace_scope and opts.is_export) {
                    p.has_non_local_export_declare_inside_namespace = true;
                }

                return p.s(S.TypeScript{}, loc);
            }

            return p.s(S.Enum{
                .name = name,
                .arg = arg_ref,
                .values = values.toOwnedSlice(),
                .is_export = opts.is_export,
            }, loc);
        }

        fn parseExportClause(p: *P) !ExportClauseResult {
            var items = ListManaged(js_ast.ClauseItem).initCapacity(p.allocator, 1) catch unreachable;
            try p.lexer.expect(.t_open_brace);
            var is_single_line = !p.lexer.has_newline_before;
            var first_non_identifier_loc = logger.Loc{ .start = 0 };
            var had_type_only_exports = false;

            while (p.lexer.token != .t_close_brace) {
                var alias = try p.parseClauseAlias("export");
                var alias_loc = p.lexer.loc();

                const name = LocRef{
                    .loc = alias_loc,
                    .ref = p.storeNameInRef(alias) catch unreachable,
                };
                const original_name = alias;

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
                if (p.lexer.token != .t_identifier and first_non_identifier_loc.start == 0) {
                    first_non_identifier_loc = p.lexer.loc();
                }
                try p.lexer.next();

                if (comptime is_typescript_enabled) {
                    if (strings.eqlComptime(alias, "type") and p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                        if (p.lexer.isContextualKeyword("as")) {
                            try p.lexer.next();

                            if (p.lexer.isContextualKeyword("as")) {
                                alias = try p.parseClauseAlias("export");
                                alias_loc = p.lexer.loc();
                                try p.lexer.next();

                                if (p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                                    // "export { type as as as }"
                                    // "export { type as as foo }"
                                    // "export { type as as 'foo' }"
                                    _ = p.parseClauseAlias("export") catch "";
                                    had_type_only_exports = true;
                                    try p.lexer.next();
                                } else {
                                    // "export { type as as }"
                                    items.append(js_ast.ClauseItem{
                                        .alias = alias,
                                        .alias_loc = alias_loc,
                                        .name = name,
                                        .original_name = original_name,
                                    }) catch unreachable;
                                }
                            } else if (p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                                // "export { type as xxx }"
                                // "export { type as 'xxx' }"
                                alias = try p.parseClauseAlias("export");
                                alias_loc = p.lexer.loc();
                                try p.lexer.next();

                                items.append(js_ast.ClauseItem{
                                    .alias = alias,
                                    .alias_loc = alias_loc,
                                    .name = name,
                                    .original_name = original_name,
                                }) catch unreachable;
                            } else {
                                had_type_only_exports = true;
                            }
                        } else {
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
                            if (p.lexer.token != .t_identifier and first_non_identifier_loc.start == 0) {
                                first_non_identifier_loc = p.lexer.loc();
                            }

                            // "export { type xx }"
                            // "export { type xx as yy }"
                            // "export { type xx as if }"
                            // "export { type default } from 'path'"
                            // "export { type default as if } from 'path'"
                            // "export { type xx as 'yy' }"
                            // "export { type 'xx' } from 'mod'"
                            _ = p.parseClauseAlias("export") catch "";
                            try p.lexer.next();

                            if (p.lexer.isContextualKeyword("as")) {
                                try p.lexer.next();
                                _ = p.parseClauseAlias("export") catch "";
                                try p.lexer.next();
                            }

                            had_type_only_exports = true;
                        }
                    } else {
                        if (p.lexer.isContextualKeyword("as")) {
                            try p.lexer.next();
                            alias = try p.parseClauseAlias("export");
                            alias_loc = p.lexer.loc();

                            try p.lexer.next();
                        }

                        items.append(js_ast.ClauseItem{
                            .alias = alias,
                            .alias_loc = alias_loc,
                            .name = name,
                            .original_name = original_name,
                        }) catch unreachable;
                    }
                } else {
                    if (p.lexer.isContextualKeyword("as")) {
                        try p.lexer.next();
                        alias = try p.parseClauseAlias("export");
                        alias_loc = p.lexer.loc();

                        try p.lexer.next();
                    }

                    items.append(js_ast.ClauseItem{
                        .alias = alias,
                        .alias_loc = alias_loc,
                        .name = name,
                        .original_name = original_name,
                    }) catch unreachable;
                }

                // we're done if there's no comma
                if (p.lexer.token != .t_comma) {
                    break;
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                try p.lexer.next();
                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
            try p.lexer.expect(.t_close_brace);

            // Throw an error here if we found a keyword earlier and this isn't an
            // "export from" statement after all
            if (first_non_identifier_loc.start != 0 and !p.lexer.isContextualKeyword("from")) {
                const r = js_lexer.rangeOfIdentifier(p.source, first_non_identifier_loc);
                try p.lexer.addRangeError(r, "Expected identifier but found \"{s}\"", .{p.source.textForRange(r)}, true);
                return error.SyntaxError;
            }

            return ExportClauseResult{
                .clauses = items.items,
                .is_single_line = is_single_line,
                .had_type_only_exports = had_type_only_exports,
            };
        }

        pub fn parsePath(p: *P) !ParsedPath {
            var path = ParsedPath{
                .loc = p.lexer.loc(),
                .text = p.lexer.string_literal_slice,
            };

            if (p.lexer.token == .t_no_substitution_template_literal) {
                try p.lexer.next();
            } else {
                try p.lexer.expect(.t_string_literal);
            }

            // For now, we silently strip import assertions
            if (!p.lexer.has_newline_before and p.lexer.isContextualKeyword("assert")) {
                try p.lexer.next();
                try p.lexer.expect(.t_open_brace);

                while (p.lexer.token != .t_close_brace) {
                    // Parse the key
                    if (p.lexer.isIdentifierOrKeyword()) {} else if (p.lexer.token == .t_string_literal) {} else {
                        try p.lexer.expect(.t_identifier);
                    }

                    try p.lexer.next();
                    try p.lexer.expect(.t_colon);

                    try p.lexer.expect(.t_string_literal);

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    try p.lexer.next();
                }

                try p.lexer.expect(.t_close_brace);
            }

            return path;
        }

        // TODO:
        pub fn checkForNonBMPCodePoint(_: *P, _: logger.Loc, _: string) void {}

        fn parseStmtsUpTo(p: *P, eend: js_lexer.T, _opts: *ParseStatementOptions) ![]Stmt {
            var opts = _opts.*;
            var stmts = StmtList.init(p.allocator);

            var returnWithoutSemicolonStart: i32 = -1;
            opts.lexical_decl = .allow_all;
            var isDirectivePrologue = true;

            while (true) {
                for (p.lexer.comments_to_preserve_before.items) |comment| {
                    try stmts.append(p.s(S.Comment{
                        .text = comment.text,
                    }, p.lexer.loc()));
                }
                p.lexer.comments_to_preserve_before.shrinkRetainingCapacity(0);

                if (p.lexer.token == eend) {
                    break;
                }

                var current_opts = opts;
                var stmt = try p.parseStmt(&current_opts);

                // Skip TypeScript types entirely
                if (is_typescript_enabled) {
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
                                        isDirectivePrologue = true;

                                        if (str.eqlComptime("use strict")) {
                                            // Track "use strict" directives
                                            p.current_scope.strict_mode = .explicit_strict_mode;
                                        } else if (str.eqlComptime("use asm")) {
                                            stmt.data = Prefill.Data.SEmpty;
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
                            .s_expr => {
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

        fn markStrictModeFeature(p: *P, feature: StrictModeFeature, r: logger.Range, detail: string) !void {
            const can_be_transformed = feature == StrictModeFeature.for_in_var_init;
            const text = switch (feature) {
                .with_statement => "With statements",
                .delete_bare_name => "\"delete\" of a bare identifier",
                .for_in_var_init => "Variable initializers within for-in loops",
                .eval_or_arguments => try std.fmt.allocPrint(p.allocator, "Declarations with the name {s}", .{detail}),
                .reserved_word => try std.fmt.allocPrint(p.allocator, "\"{s}\" is a reserved word and", .{detail}),
                .legacy_octal_literal => "Legacy octal literals",
                .legacy_octal_escape => "Legacy octal escape sequences",
                .if_else_function_stmt => "Function declarations inside if statements",
                // else => {
                //     text = "This feature";
                // },
            };

            var scope = p.current_scope;
            if (p.isStrictMode()) {
                var why: string = "";
                var where: logger.Range = logger.Range.None;
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
                var notes = try p.allocator.alloc(logger.Data, 1);
                notes[0] = logger.rangeData(p.source, where, why);
                try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used in strict mode", .{text}), notes);
            } else if (!can_be_transformed and p.isStrictModeOutputFormat()) {
                try p.log.addRangeError(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used with esm due to strict mode", .{text}));
            }
        }

        pub inline fn isStrictMode(p: *P) bool {
            return p.current_scope.strict_mode != .sloppy_mode;
        }

        pub inline fn isStrictModeOutputFormat(_: *P) bool {
            return true;
        }

        pub fn declareCommonJSSymbol(p: *P, comptime kind: Symbol.Kind, comptime name: string) !Ref {
            const name_hash = comptime @TypeOf(p.module_scope.members).getHash(name);
            const member = p.module_scope.members.getWithHash(name, name_hash);

            // If the code declared this symbol using "var name", then this is actually
            // not a collision. For example, node will let you do this:
            //
            //   var exports;
            //   module.exports.foo = 123;
            //   console.log(exports.foo);
            //
            // This works because node's implementation of CommonJS wraps the entire
            // source file like this:
            //
            //   (function(require, exports, module, __filename, __dirname) {
            //     var exports;
            //     module.exports.foo = 123;
            //     console.log(exports.foo);
            //   })
            //
            // Both the "exports" argument and "var exports" are hoisted variables, so
            // they don't collide.
            if (member) |_member| {
                if (p.symbols.items[_member.ref.innerIndex()].kind == .hoisted and kind == .hoisted and !p.has_es_module_syntax) {
                    return _member.ref;
                }
            }

            // Create a new symbol if we didn't merge with an existing one above
            const ref = try p.newSymbol(kind, name);

            if (member == null) {
                try p.module_scope.members.putWithHash(p.allocator, name, name_hash, Scope.Member{ .ref = ref, .loc = logger.Loc.Empty });
                return ref;
            }

            // If the variable was declared, then it shadows this symbol. The code in
            // this module will be unable to reference this symbol. However, we must
            // still add the symbol to the scope so it gets minified (automatically-
            // generated code may still reference the symbol).
            try p.module_scope.generated.append(p.allocator, ref);
            return ref;
        }

        fn declareGeneratedSymbol(p: *P, kind: Symbol.Kind, comptime name: string) !GeneratedSymbol {
            const static = @field(StaticSymbolName.List, name);
            return GeneratedSymbol{
                .backup = try declareSymbolMaybeGenerated(p, .other, logger.Loc.Empty, static.backup, true),
                .primary = try declareSymbolMaybeGenerated(p, .other, logger.Loc.Empty, static.primary, true),
                .ref = try declareSymbolMaybeGenerated(p, kind, logger.Loc.Empty, static.internal, true),
            };
        }

        fn declareSymbol(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string) !Ref {
            return try @call(.{ .modifier = .always_inline }, declareSymbolMaybeGenerated, .{ p, kind, loc, name, false });
        }

        fn declareSymbolMaybeGenerated(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string, comptime is_generated: bool) !Ref {
            // p.checkForNonBMPCodePoint(loc, name)

            if (comptime !is_generated) {

                // Forbid declaring a symbol with a reserved word in strict mode
                if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
                    try p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, loc), name);
                }
            }

            // Allocate a new symbol
            var ref = try p.newSymbol(kind, name);

            const scope = p.current_scope;
            var entry = try scope.members.getOrPut(p.allocator, name);
            if (entry.found_existing) {
                const existing = entry.entry.value;
                var symbol: *Symbol = &p.symbols.items[existing.ref.innerIndex()];

                if (comptime !is_generated) {
                    switch (scope.canMergeSymbols(symbol.kind, kind, is_typescript_enabled)) {
                        .forbidden => {
                            var notes = try p.allocator.alloc(logger.Data, 1);
                            notes[0] =
                                logger.rangeData(
                                p.source,
                                js_lexer.rangeOfIdentifier(p.source, existing.loc),
                                std.fmt.allocPrint(
                                    p.allocator,
                                    "{s} was originally declared here",
                                    .{symbol.original_name},
                                ) catch unreachable,
                            );

                            p.log.addRangeErrorFmtWithNotes(
                                p.source,
                                js_lexer.rangeOfIdentifier(p.source, loc),
                                p.allocator,
                                notes,
                                "\"{s}\" has already been declared",
                                .{symbol.original_name},
                            ) catch unreachable;

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
                } else {
                    // Ensure that EImportIdentifier is created for the symbol in handleIdentifier
                    if (symbol.kind == .import and kind != .import) {
                        try p.is_import_item.put(p.allocator, ref, .{});
                    }

                    p.symbols.items[ref.innerIndex()].link = existing.ref;
                }
            }

            entry.entry.value = js_ast.Scope.Member{ .ref = ref, .loc = loc };
            if (comptime is_generated) {
                try p.module_scope.generated.append(p.allocator, ref);
            }
            return ref;
        }

        fn validateFunctionName(p: *P, func: G.Fn, kind: FunctionKind) void {
            if (func.name) |name| {
                const original_name = p.symbols.items[name.ref.?.innerIndex()].original_name;

                if (func.flags.contains(.is_async) and strings.eqlComptime(original_name, "await")) {
                    p.log.addRangeError(
                        p.source,
                        js_lexer.rangeOfIdentifier(p.source, name.loc),
                        "An async function cannot be named \"await\"",
                    ) catch unreachable;
                } else if (kind == .expr and func.flags.contains(.is_generator) and strings.eqlComptime(original_name, "yield")) {
                    p.log.addRangeError(
                        p.source,
                        js_lexer.rangeOfIdentifier(p.source, name.loc),
                        "An generator function expression cannot be named \"yield\"",
                    ) catch unreachable;
                }
            }
        }

        fn parseFnExpr(p: *P, loc: logger.Loc, is_async: bool, async_range: logger.Range) !Expr {
            try p.lexer.next();
            const is_generator = p.lexer.token == T.t_asterisk;
            if (is_generator) {
                // p.markSyntaxFeature()
                try p.lexer.next();
            } else if (is_async) {
                // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
            }

            var name: ?js_ast.LocRef = null;

            _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;

            // The name is optional
            if (p.lexer.token == .t_identifier) {
                const text = p.lexer.identifier;

                // Don't declare the name "arguments" since it's shadowed and inaccessible
                name = js_ast.LocRef{
                    .loc = p.lexer.loc(),
                    .ref = if (text.len > 0 and !strings.eqlComptime(text, "arguments"))
                        try p.declareSymbol(.hoisted_function, p.lexer.loc(), text)
                    else
                        try p.newSymbol(.hoisted_function, text),
                };

                try p.lexer.next();
            }

            // Even anonymous functions can have TypeScript type parameters
            if (comptime is_typescript_enabled) {
                try p.skipTypeScriptTypeParameters();
            }

            const func = try p.parseFn(name, FnOrArrowDataParse{
                .async_range = async_range,
                .allow_await = if (is_async) .allow_expr else .allow_ident,
                .allow_yield = if (is_generator) .allow_expr else .allow_ident,
            });

            p.validateFunctionName(func, .expr);
            p.popScope();

            return p.e(js_ast.E.Function{
                .func = func,
            }, loc);
        }

        fn parseFnBody(p: *P, data: *FnOrArrowDataParse) !G.FnBody {
            var oldFnOrArrowData = p.fn_or_arrow_data_parse;
            var oldAllowIn = p.allow_in;
            p.fn_or_arrow_data_parse = data.*;
            p.allow_in = true;

            const loc = p.lexer.loc();
            _ = try p.pushScopeForParsePass(Scope.Kind.function_body, p.lexer.loc());
            defer p.popScope();

            try p.lexer.expect(.t_open_brace);
            var opts = ParseStatementOptions{};
            const stmts = try p.parseStmtsUpTo(.t_close_brace, &opts);
            try p.lexer.next();

            p.allow_in = oldAllowIn;
            p.fn_or_arrow_data_parse = oldFnOrArrowData;
            return G.FnBody{ .loc = loc, .stmts = stmts };
        }

        fn parseArrowBody(p: *P, args: []js_ast.G.Arg, data: *FnOrArrowDataParse) !E.Arrow {
            var arrow_loc = p.lexer.loc();

            // Newlines are not allowed before "=>"
            if (p.lexer.has_newline_before) {
                try p.log.addRangeError(p.source, p.lexer.range(), "Unexpected newline before \"=>\"");
                return error.SyntaxError;
            }

            try p.lexer.expect(T.t_equals_greater_than);

            for (args) |*arg| {
                var opts = ParseStatementOptions{};
                try p.declareBinding(Symbol.Kind.hoisted, &arg.binding, &opts);
            }

            // The ability to use "this" and "super()" is inherited by arrow functions
            data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;
            data.allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
            data.is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;

            if (p.lexer.token == .t_open_brace) {
                var body = try p.parseFnBody(data);
                p.after_arrow_body_loc = p.lexer.loc();
                return E.Arrow{ .args = args, .body = body };
            }

            _ = try p.pushScopeForParsePass(Scope.Kind.function_body, arrow_loc);
            defer p.popScope();

            var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);

            p.fn_or_arrow_data_parse = data.*;
            var expr = try p.parseExpr(Level.comma);
            p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

            var stmts = try p.allocator.alloc(Stmt, 1);
            stmts[0] = p.s(S.Return{ .value = expr }, expr.loc);
            return E.Arrow{ .args = args, .prefer_expr = true, .body = G.FnBody{ .loc = arrow_loc, .stmts = stmts } };
        }

        fn declareBinding(p: *P, kind: Symbol.Kind, binding: *BindingNodeIndex, opts: *ParseStatementOptions) !void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |bind| {
                    if (!opts.is_typescript_declare or (opts.is_namespace_scope and opts.is_export)) {
                        bind.ref = try p.declareSymbol(kind, binding.loc, p.loadNameFromRef(bind.ref));
                    }
                },

                .b_array => |bind| {
                    for (bind.items) |_, i| {
                        p.declareBinding(kind, &bind.items[i].binding, opts) catch unreachable;
                    }
                },

                .b_object => |bind| {
                    for (bind.properties) |*prop| {
                        p.declareBinding(kind, &prop.value, opts) catch unreachable;
                    }
                },

                else => {
                    // @compileError("Missing binding type");
                },
            }
        }

        // This is where the allocate memory to the heap for AST objects.
        // This is a short name to keep the code more readable.
        // It also swallows errors, but I think that's correct here.
        // We can handle errors via the log.
        // We'll have to deal with @wasmHeapGrow or whatever that thing is.
        pub inline fn mm(self: *P, comptime ast_object_type: type, instance: anytype) *ast_object_type {
            var obj = self.allocator.create(ast_object_type) catch unreachable;
            obj.* = instance;
            return obj;
        }

        // mmmm memmory allocation
        pub inline fn m(self: *P, kind: anytype) *@TypeOf(kind) {
            return self.mm(@TypeOf(kind), kind);
        }

        pub fn storeNameInRef(p: *P, name: string) !Ref {
            if (comptime track_symbol_usage_during_parse_pass) {
                if (p.parse_pass_symbol_uses.getPtr(name)) |res| {
                    res.used = true;
                }
            }

            if (@ptrToInt(p.source.contents.ptr) <= @ptrToInt(name.ptr) and (@ptrToInt(name.ptr) + name.len) <= (@ptrToInt(p.source.contents.ptr) + p.source.contents.len)) {
                const start = Ref.toInt(@ptrToInt(name.ptr) - @ptrToInt(p.source.contents.ptr));
                const end = Ref.toInt(name.len);
                return Ref.initSourceEnd(.{ .source_index = start, .inner_index = end, .is_source_contents_slice = true });
            } else {
                const inner_index = Ref.toInt(p.allocated_names.items.len);
                try p.allocated_names.append(p.allocator, name);
                return Ref.initSourceEnd(.{ .source_index = std.math.maxInt(Ref.Int), .inner_index = inner_index, .is_source_contents_slice = false });
            }
        }

        pub fn loadNameFromRef(p: *P, ref: Ref) string {
            if (ref.isSourceContentsSlice()) {
                return p.source.contents[ref.sourceIndex() .. ref.sourceIndex() + ref.innerIndex()];
            } else if (ref.sourceIndex() == std.math.maxInt(Ref.Int)) {
                if (comptime Environment.allow_assert)
                    assert(ref.innerIndex() < p.allocated_names.items.len);
                return p.allocated_names.items[ref.innerIndex()];
            } else {
                return p.symbols.items[ref.innerIndex()].original_name;
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
                        if (level.lte(.assign)) {
                            var args = try p.allocator.alloc(G.Arg, 1);
                            args[0] = G.Arg{ .binding = p.b(
                                B.Identifier{
                                    .ref = try p.storeNameInRef("async"),
                                },
                                async_range.loc,
                            ) };
                            _ = p.pushScopeForParsePass(.function_args, async_range.loc) catch unreachable;
                            var data = FnOrArrowDataParse{};
                            var arrow_body = try p.parseArrowBody(args, &data);
                            p.popScope();
                            return p.e(arrow_body, async_range.loc);
                        }
                    },
                    // "async x => {}"
                    .t_identifier => {
                        if (level.lte(.assign)) {
                            // p.markLoweredSyntaxFeature();

                            const ref = try p.storeNameInRef(p.lexer.identifier);
                            var args = try p.allocator.alloc(G.Arg, 1);
                            args[0] = G.Arg{ .binding = p.b(
                                B.Identifier{
                                    .ref = ref,
                                },
                                async_range.loc,
                            ) };
                            try p.lexer.next();

                            _ = try p.pushScopeForParsePass(.function_args, async_range.loc);
                            defer p.popScope();

                            var data = FnOrArrowDataParse{
                                .allow_await = .allow_expr,
                            };
                            var arrowBody = try p.parseArrowBody(args, &data);
                            arrowBody.is_async = true;
                            return p.e(arrowBody, async_range.loc);
                        }
                    },

                    // "async()"
                    // "async () => {}"
                    .t_open_paren => {
                        try p.lexer.next();
                        return p.parseParenExpr(async_range.loc, level, ParenExprOpts{ .is_async = true, .async_range = async_range });
                    },

                    // "async<T>()"
                    // "async <T>() => {}"
                    .t_less_than => {
                        if (is_typescript_enabled and p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                            try p.lexer.next();
                            return p.parseParenExpr(async_range.loc, level, ParenExprOpts{ .is_async = true, .async_range = async_range });
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

        pub const Backtracking = struct {
            pub inline fn lexerBacktracker(p: *P, func: anytype) bool {
                p.markTypeScriptOnly();
                var old_lexer = std.mem.toBytes(p.lexer);
                const old_log_disabled = p.lexer.is_log_disabled;
                p.lexer.is_log_disabled = true;

                defer p.lexer.is_log_disabled = old_log_disabled;
                var backtrack = false;
                func(p) catch |err| {
                    switch (err) {
                        error.Backtrack => {
                            backtrack = true;
                        },
                        else => {},
                    }
                };

                if (backtrack) {
                    p.lexer = std.mem.bytesToValue(@TypeOf(p.lexer), &old_lexer);
                }

                return !backtrack;
            }

            pub fn skipTypeScriptTypeParametersThenOpenParenWithBacktracking(p: *P) anyerror!void {
                try p.skipTypeScriptTypeParameters();
                if (p.lexer.token != .t_open_paren) {
                    // try p.lexer.unexpected(); return error.SyntaxError;
                    return error.Backtrack;
                }
            }

            pub fn skipTypeScriptArrowArgsWithBacktracking(p: *P) anyerror!void {
                try p.skipTypescriptFnArgs();
                p.lexer.expect(.t_equals_greater_than) catch
                    return error.Backtrack;
            }

            pub fn skipTypeScriptTypeArgumentsWithBacktracking(p: *P) anyerror!void {
                _ = try p.skipTypeScriptTypeArguments(false);

                // Check the token after this and backtrack if it's the wrong one
                if (!TypeScript.canFollowTypeArgumentsInExpression(p.lexer.token)) {
                    // try p.lexer.unexpected(); return error.SyntaxError;
                    return error.Backtrack;
                }
            }

            pub fn skipTypeScriptArrowReturnTypeWithBacktracking(p: *P) anyerror!void {
                p.lexer.expect(.t_colon) catch
                    return error.Backtrack;

                try p.skipTypescriptReturnType();
                // Check the token after this and backtrack if it's the wrong one
                if (p.lexer.token != .t_equals_greater_than) {
                    // try p.lexer.unexpected(); return error.SyntaxError;
                    return error.Backtrack;
                }
            }
        };

        pub fn trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptTypeParametersThenOpenParenWithBacktracking);
        }

        pub fn trySkipTypeScriptTypeArgumentsWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptTypeArgumentsWithBacktracking);
        }

        pub fn trySkipTypeScriptArrowReturnTypeWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptArrowReturnTypeWithBacktracking);
        }

        pub fn trySkipTypeScriptArrowArgsWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptArrowArgsWithBacktracking);
        }

        pub inline fn parseExprOrBindings(p: *P, level: Level, errors: ?*DeferredErrors) anyerror!Expr {
            return try p.parseExprCommon(level, errors, Expr.EFlags.none);
        }

        pub inline fn parseExpr(p: *P, level: Level) anyerror!Expr {
            return try p.parseExprCommon(level, null, Expr.EFlags.none);
        }

        pub inline fn parseExprWithFlags(p: *P, level: Level, flags: Expr.EFlags) anyerror!Expr {
            return try p.parseExprCommon(level, null, flags);
        }

        pub fn parseExprCommon(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            const had_pure_comment_before = p.lexer.has_pure_comment_before and !p.options.ignore_dce_annotations;
            var expr = try p.parsePrefix(level, errors, flags);

            // There is no formal spec for "__PURE__" comments but from reverse-
            // engineering, it looks like they apply to the next CallExpression or
            // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
            // to the expression "a().b()".

            if (had_pure_comment_before and level.lt(.call)) {
                expr = try p.parseSuffix(expr, @intToEnum(Level, @enumToInt(Level.call) - 1), errors, flags);
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

            return try p.parseSuffix(expr, level, errors, flags);
        }

        pub inline fn addImportRecord(p: *P, kind: ImportKind, loc: logger.Loc, name: string) u32 {
            return p.addImportRecordByRange(kind, p.source.rangeOfString(loc), name);
        }

        pub fn addImportRecordByRange(p: *P, kind: ImportKind, range: logger.Range, name: string) u32 {
            var index = p.import_records.items.len;
            const record = ImportRecord{
                .kind = kind,
                .range = range,
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

                    p.symbols.items[member.value.ref.innerIndex()].must_not_be_renamed = true;
                }
            }

            p.current_scope = current_scope.parent orelse p.panic("Internal error: attempted to call popScope() on the topmost scope", .{});
        }

        pub fn markExprAsParenthesized(_: *P, expr: *Expr) void {
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

        pub fn parseYieldExpr(p: *P, loc: logger.Loc) !ExprNodeIndex {
            // Parse a yield-from expression, which yields from an iterator
            const isStar = p.lexer.token == T.t_asterisk;

            if (isStar) {
                if (p.lexer.has_newline_before) {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                }
                try p.lexer.next();
            }

            var value: ?ExprNodeIndex = null;
            switch (p.lexer.token) {
                .t_close_brace, .t_close_paren, .t_colon, .t_comma, .t_semicolon => {},
                else => {
                    if (isStar or !p.lexer.has_newline_before) {
                        value = try p.parseExpr(.yield);
                    }
                },
            }

            return p.e(E.Yield{
                .value = value,
                .is_star = isStar,
            }, loc);
        }

        pub fn parseProperty(p: *P, kind: Property.Kind, opts: *PropertyOpts, errors: ?*DeferredErrors) anyerror!?G.Property {
            var key: Expr = Expr{ .loc = logger.Loc.Empty, .data = .{ .e_missing = E.Missing{} } };
            var key_range = p.lexer.range();
            var is_computed = false;

            switch (p.lexer.token) {
                .t_numeric_literal => {
                    key = p.e(E.Number{
                        .value = p.lexer.number,
                    }, p.lexer.loc());
                    // p.checkForLegacyOctalLiteral()
                    try p.lexer.next();
                },
                .t_string_literal => {
                    key = try p.parseStringLiteral();
                },
                .t_big_integer_literal => {
                    key = p.e(E.BigInt{ .value = p.lexer.identifier }, p.lexer.loc());
                    // markSyntaxFeature
                    try p.lexer.next();
                },
                .t_private_identifier => {
                    if (!opts.is_class or opts.ts_decorators.len > 0) {
                        try p.lexer.expected(.t_identifier);
                    }

                    key = p.e(E.PrivateIdentifier{ .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable }, p.lexer.loc());
                    try p.lexer.next();
                },
                .t_open_bracket => {
                    is_computed = true;
                    // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                    try p.lexer.next();
                    const wasIdentifier = p.lexer.token == .t_identifier;
                    const expr = try p.parseExpr(.comma);

                    if (comptime is_typescript_enabled) {

                        // Handle index signatures
                        if (p.lexer.token == .t_colon and wasIdentifier and opts.is_class) {
                            switch (expr.data) {
                                .e_identifier => {
                                    try p.lexer.next();
                                    try p.skipTypeScriptType(.lowest);
                                    try p.lexer.expect(.t_close_bracket);
                                    try p.lexer.expect(.t_colon);
                                    try p.skipTypeScriptType(.lowest);
                                    try p.lexer.expectOrInsertSemicolon();

                                    // Skip this property entirely
                                    return null;
                                },
                                else => {},
                            }
                        }
                    }

                    try p.lexer.expect(.t_close_bracket);
                    key = expr;
                },
                .t_asterisk => {
                    if (kind != .normal or opts.is_generator) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    try p.lexer.next();
                    opts.is_generator = true;
                    return try p.parseProperty(.normal, opts, errors);
                },

                else => {
                    const name = p.lexer.identifier;
                    const raw = p.lexer.raw();
                    const name_range = p.lexer.range();

                    if (!p.lexer.isIdentifierOrKeyword()) {
                        try p.lexer.expect(.t_identifier);
                    }

                    try p.lexer.next();

                    // Support contextual keywords
                    if (kind == .normal and !opts.is_generator) {
                        // Does the following token look like a key?
                        const couldBeModifierKeyword = p.lexer.isIdentifierOrKeyword() or switch (p.lexer.token) {
                            .t_open_bracket, .t_numeric_literal, .t_string_literal, .t_asterisk, .t_private_identifier => true,
                            else => false,
                        };

                        // If so, check for a modifier keyword
                        if (couldBeModifierKeyword) {
                            // TODO: micro-optimization, use a smaller list for non-typescript files.
                            if (js_lexer.PropertyModifierKeyword.List.get(name)) |keyword| {
                                switch (keyword) {
                                    .p_get => {
                                        if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_get) {
                                            // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                            return try p.parseProperty(.get, opts, null);
                                        }
                                    },

                                    .p_set => {
                                        if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_set) {
                                            // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                            return try p.parseProperty(.set, opts, null);
                                        }
                                    },
                                    .p_async => {
                                        if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_async and !p.lexer.has_newline_before) {
                                            opts.is_async = true;
                                            opts.async_range = name_range;

                                            // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                            return try p.parseProperty(kind, opts, null);
                                        }
                                    },
                                    .p_static => {
                                        if (!opts.is_static and !opts.is_async and opts.is_class and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_get) == .p_static) {
                                            opts.is_static = true;
                                            return try p.parseProperty(kind, opts, null);
                                        }
                                    },
                                    .p_private, .p_protected, .p_public, .p_readonly, .p_abstract, .p_declare, .p_override => {
                                        // Skip over TypeScript keywords
                                        if (opts.is_class and is_typescript_enabled and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == keyword) {
                                            return try p.parseProperty(kind, opts, null);
                                        }
                                    },
                                }
                            }
                        } else if (p.lexer.token == .t_open_brace and strings.eqlComptime(name, "static")) {
                            const loc = p.lexer.loc();
                            try p.lexer.next();

                            const old_fn_or_arrow_data_parse = p.fn_or_arrow_data_parse;
                            p.fn_or_arrow_data_parse = .{
                                .is_return_disallowed = true,
                                .allow_super_property = true,
                                .allow_await = .forbid_all,
                            };

                            _ = try p.pushScopeForParsePass(.class_static_init, loc);
                            var _parse_opts = ParseStatementOptions{};
                            var stmts = try p.parseStmtsUpTo(.t_close_brace, &_parse_opts);

                            p.popScope();

                            p.fn_or_arrow_data_parse = old_fn_or_arrow_data_parse;
                            try p.lexer.expect(.t_close_brace);

                            var block = p.allocator.create(
                                G.ClassStaticBlock,
                            ) catch unreachable;

                            block.* = G.ClassStaticBlock{
                                .stmts = js_ast.BabyList(Stmt).init(stmts),
                                .loc = loc,
                            };

                            return G.Property{
                                .kind = .class_static_block,
                                .class_static_block = block,
                            };
                        }
                    }

                    key = p.e(E.String{ .data = name }, name_range.loc);

                    // Parse a shorthand property
                    const isShorthandProperty = !opts.is_class and
                        kind == .normal and
                        p.lexer.token != .t_colon and
                        p.lexer.token != .t_open_paren and
                        p.lexer.token != .t_less_than and
                        !opts.is_generator and
                        !opts.is_async and
                        !js_lexer.Keywords.has(name);

                    if (isShorthandProperty) {
                        if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and
                            strings.eqlComptime(name, "await")) or
                            (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and
                            strings.eqlComptime(name, "yield")))
                        {
                            if (strings.eqlComptime(name, "await")) {
                                p.log.addRangeError(p.source, name_range, "Cannot use \"await\" here") catch unreachable;
                            } else {
                                p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" here") catch unreachable;
                            }
                        }

                        const ref = p.storeNameInRef(name) catch unreachable;
                        const value = p.e(E.Identifier{ .ref = ref }, key.loc);

                        // Destructuring patterns have an optional default value
                        var initializer: ?Expr = null;
                        if (errors != null and p.lexer.token == .t_equals) {
                            errors.?.invalid_expr_default_value = p.lexer.range();
                            try p.lexer.next();
                            initializer = try p.parseExpr(.comma);
                        }

                        return G.Property{
                            .kind = kind,
                            .key = key,
                            .value = value,
                            .initializer = initializer,
                            .flags = Flags.Property.init(.{
                                .was_shorthand = true,
                            }),
                        };
                    }
                },
            }

            if (comptime is_typescript_enabled) {
                // "class X { foo?: number }"
                // "class X { foo!: number }"
                if (opts.is_class and (p.lexer.token == .t_question or p.lexer.token == .t_exclamation)) {
                    try p.lexer.next();
                }

                // "class X { foo?<T>(): T }"
                // "const x = { foo<T>(): T {} }"
                try p.skipTypeScriptTypeParameters();
            }

            // Parse a class field with an optional initial value
            if (opts.is_class and kind == .normal and !opts.is_async and !opts.is_generator and p.lexer.token != .t_open_paren) {
                var initializer: ?Expr = null;

                // Forbid the names "constructor" and "prototype" in some cases
                if (!is_computed) {
                    switch (key.data) {
                        .e_string => |str| {
                            if (str.eqlComptime("constructor") or (opts.is_static and str.eqlComptime("prototype"))) {
                                // TODO: fmt error message to include string value.
                                p.log.addRangeError(p.source, key_range, "Invalid field name") catch unreachable;
                            }
                        },
                        else => {},
                    }
                }

                if (comptime is_typescript_enabled) {
                    // Skip over types
                    if (p.lexer.token == .t_colon) {
                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    }
                }

                if (p.lexer.token == .t_equals) {
                    if (comptime is_typescript_enabled) {
                        if (!opts.declare_range.isEmpty()) {
                            try p.log.addRangeError(p.source, p.lexer.range(), "Class fields that use \"declare\" cannot be initialized");
                        }
                    }

                    try p.lexer.next();

                    // "this" and "super" property access is allowed in field initializers
                    const old_is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;
                    const old_allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
                    p.fn_or_arrow_data_parse.is_this_disallowed = false;
                    p.fn_or_arrow_data_parse.allow_super_property = true;

                    initializer = try p.parseExpr(.comma);

                    p.fn_or_arrow_data_parse.is_this_disallowed = old_is_this_disallowed;
                    p.fn_or_arrow_data_parse.allow_super_property = old_allow_super_property;
                }

                // Special-case private identifiers
                switch (key.data) {
                    .e_private_identifier => |*private| {
                        const name = p.loadNameFromRef(private.ref);
                        if (strings.eqlComptime(name, "#constructor")) {
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

                try p.lexer.expectOrInsertSemicolon();

                return G.Property{
                    .ts_decorators = ExprNodeList.init(opts.ts_decorators),
                    .kind = kind,
                    .flags = Flags.Property.init(.{
                        .is_computed = is_computed,
                        .is_static = opts.is_static,
                    }),
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
                            if (!opts.is_static and str.eqlComptime("constructor")) {
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
                            } else if (opts.is_static and str.eqlComptime("prototype")) {
                                p.log.addRangeError(p.source, key_range, "Invalid static method name \"prototype\"") catch unreachable;
                            }
                        },
                        else => {},
                    }
                }

                var func = try p.parseFn(null, FnOrArrowDataParse{
                    .async_range = opts.async_range,
                    .has_async_range = !opts.async_range.isEmpty(),
                    .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                    .allow_yield = if (opts.is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                    .allow_super_call = opts.class_has_extends and is_constructor,
                    .allow_super_property = true,
                    .allow_ts_decorators = opts.allow_ts_decorators,
                    .is_constructor = is_constructor,

                    // Only allow omitting the body if we're parsing TypeScript class
                    .allow_missing_body_for_type_script = is_typescript_enabled and opts.is_class,
                });

                // "class Foo { foo(): void; foo(): void {} }"
                if (func.flags.contains(.is_forward_declaration)) {
                    // Skip this property entirely
                    p.popAndDiscardScope(scope_index);
                    return null;
                }

                p.popScope();
                func.flags.insert(.is_unique_formal_parameters);
                const value = p.e(E.Function{ .func = func }, loc);

                // Enforce argument rules for accessors
                switch (kind) {
                    .get => {
                        if (func.args.len > 0) {
                            const r = js_lexer.rangeOfIdentifier(p.source, func.args[0].binding.loc);
                            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Getter {s} must have zero arguments", .{p.keyNameForError(key)}) catch unreachable;
                        }
                    },
                    .set => {
                        if (func.args.len != 1) {
                            var r = js_lexer.rangeOfIdentifier(p.source, if (func.args.len > 0) func.args[0].binding.loc else loc);
                            if (func.args.len > 1) {
                                r = js_lexer.rangeOfIdentifier(p.source, func.args[1].binding.loc);
                            }
                            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Setter {s} must have exactly 1 argument (there are {d})", .{ p.keyNameForError(key), func.args.len }) catch unreachable;
                        }
                    },
                    else => {},
                }

                // Special-case private identifiers
                switch (key.data) {
                    .e_private_identifier => |*private| {
                        var declare: Symbol.Kind = undefined;
                        var suffix: string = "";
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
                        if (strings.eqlComptime(name, "#constructor")) {
                            p.log.addRangeError(p.source, key_range, "Invalid method name \"#constructor\"") catch unreachable;
                        }
                        private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                    },
                    else => {},
                }

                return G.Property{
                    .ts_decorators = ExprNodeList.init(opts.ts_decorators),
                    .kind = kind,
                    .flags = Flags.Property.init(.{
                        .is_computed = is_computed,
                        .is_method = true,
                        .is_static = opts.is_static,
                    }),
                    .key = key,
                    .value = value,
                };
            }

            // Parse an object key/value pair
            try p.lexer.expect(.t_colon);
            const value = try p.parseExprOrBindings(.comma, errors);

            return G.Property{
                .kind = kind,
                .flags = Flags.Property.init(.{
                    .is_computed = is_computed,
                }),
                .key = key,
                .value = value,
            };
        }

        // By the time we call this, the identifier and type parameters have already
        // been parsed. We need to start parsing from the "extends" clause.
        pub fn parseClass(p: *P, class_keyword: logger.Range, name: ?js_ast.LocRef, class_opts: ParseClassOptions) !G.Class {
            var extends: ?Expr = null;

            if (p.lexer.token == .t_extends) {
                try p.lexer.next();
                extends = try p.parseExpr(.new);

                // TypeScript's type argument parser inside expressions backtracks if the
                // first token after the end of the type parameter list is "{", so the
                // parsed expression above will have backtracked if there are any type
                // arguments. This means we have to re-parse for any type arguments here.
                // This seems kind of wasteful to me but it's what the official compiler
                // does and it probably doesn't have that high of a performance overhead
                // because "extends" clauses aren't that frequent, so it should be ok.
                if (comptime is_typescript_enabled) {
                    _ = try p.skipTypeScriptTypeArguments(false); // isInsideJSXElement
                }
            }

            if (comptime is_typescript_enabled) {
                if (p.lexer.isContextualKeyword("implements")) {
                    try p.lexer.next();

                    while (true) {
                        try p.skipTypeScriptType(.lowest);
                        if (p.lexer.token != .t_comma) {
                            break;
                        }
                        try p.lexer.next();
                    }
                }
            }

            var body_loc = p.lexer.loc();
            try p.lexer.expect(T.t_open_brace);
            var properties = ListManaged(G.Property).init(p.allocator);

            // Allow "in" and private fields inside class bodies
            const old_allow_in = p.allow_in;
            const old_allow_private_identifiers = p.allow_private_identifiers;
            p.allow_in = true;
            p.allow_private_identifiers = true;

            // A scope is needed for private identifiers
            const scopeIndex = p.pushScopeForParsePass(.class_body, body_loc) catch unreachable;

            var opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };
            while (p.lexer.token != T.t_close_brace) {
                if (p.lexer.token == .t_semicolon) {
                    try p.lexer.next();
                    continue;
                }

                opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };

                // Parse decorators for this property
                const first_decorator_loc = p.lexer.loc();
                if (opts.allow_ts_decorators) {
                    opts.ts_decorators = try p.parseTypeScriptDecorators();
                } else {
                    opts.ts_decorators = &[_]Expr{};
                }

                // This property may turn out to be a type in TypeScript, which should be ignored
                if (try p.parseProperty(.normal, &opts, null)) |property| {
                    properties.append(property) catch unreachable;

                    // Forbid decorators on class constructors
                    if (opts.ts_decorators.len > 0) {
                        switch ((property.key orelse p.panic("Internal error: Expected property {s} to have a key.", .{property})).data) {
                            .e_string => |str| {
                                if (str.eqlComptime("constructor")) {
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
            const close_brace_loc = p.lexer.loc();
            try p.lexer.expect(.t_close_brace);

            return G.Class{
                .class_name = name,
                .extends = extends,
                .close_brace_loc = close_brace_loc,
                .ts_decorators = ExprNodeList.init(class_opts.ts_decorators),
                .class_keyword = class_keyword,
                .body_loc = body_loc,
                .properties = properties.toOwnedSlice(),
            };
        }

        pub fn skipTypeScriptTypeArguments(p: *P, comptime isInsideJSXElement: bool) anyerror!bool {
            p.markTypeScriptOnly();
            switch (p.lexer.token) {
                .t_less_than, .t_less_than_equals, .t_less_than_less_than, .t_less_than_less_than_equals => {},
                else => {
                    return false;
                },
            }

            try p.lexer.expectLessThan(false);

            while (true) {
                try p.skipTypeScriptType(.lowest);
                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }

            // This type argument list must end with a ">"
            try p.lexer.expectGreaterThan(isInsideJSXElement);
            return true;
        }

        pub fn parseTemplateParts(p: *P, _: bool) ![]E.TemplatePart {
            var parts = ListManaged(E.TemplatePart).initCapacity(p.allocator, 1) catch unreachable;
            // Allow "in" inside template literals
            var oldAllowIn = p.allow_in;
            p.allow_in = true;

            parseTemplatePart: while (true) {
                try p.lexer.next();
                const value = try p.parseExpr(.lowest);
                const tail_loc = p.lexer.loc();
                try p.lexer.rescanCloseBraceAsTemplateToken();

                var tail = p.lexer.toEString();

                parts.append(E.TemplatePart{
                    .value = value,
                    .tail_loc = tail_loc,
                    .tail = tail,
                }) catch unreachable;

                if (p.lexer.token == .t_template_tail) {
                    try p.lexer.next();
                    break :parseTemplatePart;
                }
                if (comptime Environment.allow_assert)
                    assert(p.lexer.token != .t_end_of_file);
            }

            p.allow_in = oldAllowIn;

            return parts.toOwnedSlice();
        }

        // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
        pub fn parseStringLiteral(p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            var str = p.lexer.toEString();
            str.prefer_template = p.lexer.token == .t_no_substitution_template_literal;

            const expr = p.e(str, loc);
            try p.lexer.next();
            return expr;
        }

        pub fn parseCallArgs(p: *P) anyerror!ExprListLoc {
            // Allow "in" inside call arguments
            const old_allow_in = p.allow_in;
            p.allow_in = true;
            defer p.allow_in = old_allow_in;

            var args = ListManaged(Expr).init(p.allocator);
            try p.lexer.expect(.t_open_paren);

            while (p.lexer.token != .t_close_paren) {
                const loc = p.lexer.loc();
                const is_spread = p.lexer.token == .t_dot_dot_dot;
                if (is_spread) {
                    // p.mark_syntax_feature(compat.rest_argument, p.lexer.range());
                    try p.lexer.next();
                }
                var arg = try p.parseExpr(.comma);
                if (is_spread) {
                    arg = p.e(E.Spread{ .value = arg }, loc);
                }
                args.append(arg) catch unreachable;
                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }
            const close_paren_loc = p.lexer.loc();
            try p.lexer.expect(.t_close_paren);
            return ExprListLoc{ .list = ExprNodeList.fromList(args), .loc = close_paren_loc };
        }

        pub fn parseSuffix(p: *P, _left: Expr, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            var left = _left;
            var optional_chain: ?js_ast.OptionalChain = null;
            while (true) {
                if (p.lexer.loc().start == p.after_arrow_body_loc.start) {
                    while (true) {
                        switch (p.lexer.token) {
                            .t_comma => {
                                if (level.gte(.comma)) {
                                    return left;
                                }

                                try p.lexer.next();
                                left = p.e(E.Binary{
                                    .op = .bin_comma,
                                    .left = left,
                                    .right = try p.parseExpr(.comma),
                                }, left.loc);
                            },
                            else => {
                                return left;
                            },
                        }
                    }
                }

                if (comptime is_typescript_enabled) {
                    // Stop now if this token is forbidden to follow a TypeScript "as" cast
                    if (p.forbid_suffix_after_as_loc.start > -1 and p.lexer.loc().start == p.forbid_suffix_after_as_loc.start) {
                        return left;
                    }
                }

                // Reset the optional chain flag by default. That way we won't accidentally
                // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
                var old_optional_chain = optional_chain;
                optional_chain = null;
                switch (p.lexer.token) {
                    .t_dot => {
                        try p.lexer.next();
                        if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                            // "a.#b"
                            // "a?.b.#c"
                            switch (left.data) {
                                .e_super => {
                                    try p.lexer.expected(.t_identifier);
                                },
                                else => {},
                            }

                            const name = p.lexer.identifier;
                            const name_loc = p.lexer.loc();
                            try p.lexer.next();
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
                                try p.lexer.expect(.t_identifier);
                            }

                            const name = p.lexer.identifier;
                            const name_loc = p.lexer.loc();
                            try p.lexer.next();

                            left = p.e(E.Dot{ .target = left, .name = name, .name_loc = name_loc, .optional_chain = old_optional_chain }, left.loc);
                        }

                        optional_chain = old_optional_chain;
                    },
                    .t_question_dot => {
                        try p.lexer.next();
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
                                try p.lexer.next();

                                // allow "in" inside the brackets;
                                const old_allow_in = p.allow_in;
                                p.allow_in = true;

                                const index = try p.parseExpr(.lowest);

                                p.allow_in = old_allow_in;

                                try p.lexer.expect(.t_close_bracket);
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

                                const list_loc = try p.parseCallArgs();
                                left = p.e(E.Call{
                                    .target = left,
                                    .args = list_loc.list,
                                    .close_paren_loc = list_loc.loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            },
                            .t_less_than => {
                                // "a?.<T>()"
                                if (comptime !is_typescript_enabled) {
                                    try p.lexer.expected(.t_identifier);
                                    return error.SyntaxError;
                                }

                                _ = try p.skipTypeScriptTypeArguments(false);
                                if (p.lexer.token != .t_open_paren) {
                                    try p.lexer.expected(.t_open_paren);
                                }

                                if (level.gte(.call)) {
                                    return left;
                                }

                                const list_loc = try p.parseCallArgs();
                                left = p.e(E.Call{
                                    .target = left,
                                    .args = list_loc.list,
                                    .close_paren_loc = list_loc.loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            },
                            else => {
                                if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                                    // "a?.#b"
                                    const name = p.lexer.identifier;
                                    const name_loc = p.lexer.loc();
                                    try p.lexer.next();
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
                                        try p.lexer.expect(.t_identifier);
                                    }
                                    const name = p.lexer.identifier;
                                    const name_loc = p.lexer.loc();
                                    try p.lexer.next();

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
                        const head = p.lexer.toEString();
                        try p.lexer.next();
                        left = p.e(E.Template{
                            .tag = left,
                            .head = head,
                        }, left.loc);
                    },
                    .t_template_head => {
                        if (old_optional_chain != null) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                        }
                        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                        const head = p.lexer.toEString();
                        const partsGroup = try p.parseTemplateParts(true);
                        const tag = left;
                        left = p.e(E.Template{ .tag = tag, .head = head, .parts = partsGroup }, left.loc);
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
                        if (flags == .ts_decorator) {
                            return left;
                        }

                        try p.lexer.next();

                        // Allow "in" inside the brackets
                        const old_allow_in = p.allow_in;
                        p.allow_in = true;

                        const index = try p.parseExpr(.lowest);

                        p.allow_in = old_allow_in;

                        try p.lexer.expect(.t_close_bracket);

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

                        const list_loc = try p.parseCallArgs();
                        left = p.e(
                            E.Call{
                                .target = left,
                                .args = list_loc.list,
                                .close_paren_loc = list_loc.loc,
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
                        try p.lexer.next();

                        // Stop now if we're parsing one of these:
                        // "(a?) => {}"
                        // "(a?: b) => {}"
                        // "(a?, b?) => {}"
                        if (is_typescript_enabled and left.loc.start == p.latest_arrow_arg_loc.start and (p.lexer.token == .t_colon or
                            p.lexer.token == .t_close_paren or p.lexer.token == .t_comma))
                        {
                            if (errors == null) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                            errors.?.invalid_expr_after_question = p.lexer.range();
                            return left;
                        }

                        // Allow "in" in between "?" and ":"
                        const old_allow_in = p.allow_in;
                        p.allow_in = true;

                        const yes = try p.parseExpr(.comma);

                        p.allow_in = old_allow_in;

                        try p.lexer.expect(.t_colon);
                        const no = try p.parseExpr(.comma);

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

                        if (!is_typescript_enabled) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        if (level.gte(.postfix)) {
                            return left;
                        }

                        try p.lexer.next();
                        optional_chain = old_optional_chain;
                    },
                    .t_minus_minus => {
                        if (p.lexer.has_newline_before or level.gte(.postfix)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Unary{ .op = .un_post_dec, .value = left }, left.loc);
                    },
                    .t_plus_plus => {
                        if (p.lexer.has_newline_before or level.gte(.postfix)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Unary{ .op = .un_post_inc, .value = left }, left.loc);
                    },
                    .t_comma => {
                        if (level.gte(.comma)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_comma, .left = left, .right = try p.parseExpr(.comma) }, left.loc);
                    },
                    .t_plus => {
                        if (level.gte(.add)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_add, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                    },
                    .t_plus_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_add_assign, .left = left, .right = try p.parseExpr(@intToEnum(Op.Level, @enumToInt(Op.Level.assign) - 1)) }, left.loc);
                    },
                    .t_minus => {
                        if (level.gte(.add)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_sub, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                    },
                    .t_minus_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_sub_assign, .left = left, .right = try p.parseExpr(Op.Level.sub(Op.Level.assign, 1)) }, left.loc);
                    },
                    .t_asterisk => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_mul, .left = left, .right = try p.parseExpr(.multiply) }, left.loc);
                    },
                    .t_asterisk_asterisk => {
                        if (level.gte(.exponentiation)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_pow, .left = left, .right = try p.parseExpr(Op.Level.exponentiation.sub(1)) }, left.loc);
                    },
                    .t_asterisk_asterisk_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_pow_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                    },
                    .t_asterisk_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_mul_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                    },
                    .t_percent => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_rem, .left = left, .right = try p.parseExpr(Op.Level.multiply) }, left.loc);
                    },
                    .t_percent_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_rem_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_slash => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_div, .left = left, .right = try p.parseExpr(Level.multiply) }, left.loc);
                    },
                    .t_slash_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_div_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_loose_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_exclamation_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_loose_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_equals_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_strict_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_exclamation_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_strict_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_less_than => {
                        // TypeScript allows type arguments to be specified with angle brackets
                        // inside an expression. Unlike in other languages, this unfortunately
                        // appears to require backtracking to parse.
                        if (is_typescript_enabled and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                            optional_chain = old_optional_chain;
                            continue;
                        }

                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_lt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_less_than_equals => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_le, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_greater_than => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_gt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_greater_than_equals => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_ge, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_less_than_less_than => {
                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_shl, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_less_than_less_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_greater_than_greater_than => {
                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_greater_than_greater_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_shr_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_greater_than_greater_than_greater_than => {
                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_u_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_greater_than_greater_than_greater_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_u_shr_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_question_question => {
                        if (level.gte(.nullish_coalescing)) {
                            return left;
                        }
                        try p.lexer.next();
                        const prev = left;
                        left = p.e(E.Binary{ .op = .bin_nullish_coalescing, .left = prev, .right = try p.parseExpr(.nullish_coalescing) }, left.loc);
                    },
                    .t_question_question_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_nullish_coalescing_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_bar_bar => {
                        if (level.gte(.logical_or)) {
                            return left;
                        }

                        // Prevent "||" inside "??" from the right
                        if (level.eql(.nullish_coalescing)) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        const right = try p.parseExpr(.logical_or);
                        left = p.e(E.Binary{ .op = Op.Code.bin_logical_or, .left = left, .right = right }, left.loc);

                        if (level.lt(.nullish_coalescing)) {
                            left = try p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                            if (p.lexer.token == .t_question_question) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                        }
                    },
                    .t_bar_bar_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_logical_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_ampersand_ampersand => {
                        if (level.gte(.logical_and)) {
                            return left;
                        }

                        // Prevent "&&" inside "??" from the right
                        if (level.eql(.nullish_coalescing)) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_logical_and, .left = left, .right = try p.parseExpr(.logical_and) }, left.loc);

                        // Prevent "&&" inside "??" from the left
                        if (level.lt(.nullish_coalescing)) {
                            left = try p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                            if (p.lexer.token == .t_question_question) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                        }
                    },
                    .t_ampersand_ampersand_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_logical_and_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_bar => {
                        if (level.gte(.bitwise_or)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_or, .left = left, .right = try p.parseExpr(.bitwise_or) }, left.loc);
                    },
                    .t_bar_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_ampersand => {
                        if (level.gte(.bitwise_and)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_and, .left = left, .right = try p.parseExpr(.bitwise_and) }, left.loc);
                    },
                    .t_ampersand_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_and_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_caret => {
                        if (level.gte(.bitwise_xor)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_xor, .left = left, .right = try p.parseExpr(.bitwise_xor) }, left.loc);
                    },
                    .t_caret_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_bitwise_xor_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();

                        left = p.e(E.Binary{ .op = .bin_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
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

                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_in, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
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
                        try p.lexer.next();
                        left = p.e(E.Binary{ .op = .bin_instanceof, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    else => {
                        // Handle the TypeScript "as" operator
                        if (is_typescript_enabled and level.lt(.compare) and !p.lexer.has_newline_before and p.lexer.isContextualKeyword("as")) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);

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

        pub const MacroVisitor = struct {
            p: *P,

            loc: logger.Loc,

            pub fn visitImport(this: MacroVisitor, import_data: js_ast.Macro.JSNode.ImportData) void {
                var p = this.p;

                const record_id = p.addImportRecord(.stmt, this.loc, import_data.path);
                var record: *ImportRecord = &p.import_records.items[record_id];
                record.was_injected_by_macro = true;
                p.macro.imports.ensureUnusedCapacity(import_data.import.items.len) catch unreachable;
                var import = import_data.import;
                import.import_record_index = record_id;

                p.is_import_item.ensureUnusedCapacity(
                    p.allocator,
                    @intCast(u32, p.is_import_item.count() + import.items.len),
                ) catch unreachable;

                for (import.items) |*clause| {
                    const import_hash_name = clause.original_name;

                    if (strings.eqlComptime(clause.alias, "default")) {
                        var non_unique_name = record.path.name.nonUniqueNameString(p.allocator) catch unreachable;
                        clause.original_name = std.fmt.allocPrint(p.allocator, "{s}_default", .{non_unique_name}) catch unreachable;
                        record.contains_default_alias = true;
                    }
                    const name_ref = p.declareSymbol(.import, this.loc, clause.original_name) catch unreachable;
                    clause.name = LocRef{ .loc = this.loc, .ref = name_ref };

                    p.is_import_item.putAssumeCapacity(name_ref, .{});

                    p.macro.imports.putAssumeCapacity(js_ast.Macro.JSNode.SymbolMap.generateImportHash(import_hash_name, import_data.path), name_ref);

                    // Ensure we don't accidentally think this is an export from
                }

                p.macro.prepend_stmts.append(p.s(import, this.loc)) catch unreachable;
            }
        };

        pub fn panic(p: *P, comptime str: string, args: anytype) noreturn {
            @setCold(true);
            var panic_buffer = p.allocator.alloc(u8, 32 * 1024) catch unreachable;
            var panic_stream = std.io.fixedBufferStream(panic_buffer);
            p.log.addRangeErrorFmt(p.source, p.lexer.range(), p.allocator, str, args) catch unreachable;

            p.log.printForLogLevel(
                panic_stream.writer(),
            ) catch unreachable;
            Global.panic("{s}", .{panic_buffer[0..panic_stream.pos]});
        }

        pub fn parsePrefix(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            const loc = p.lexer.loc();
            const l = @enumToInt(level);
            // Output.print("Parse Prefix {s}:{s} @{s} ", .{ p.lexer.token, p.lexer.raw(), @tagName(level) });

            switch (p.lexer.token) {
                .t_super => {
                    const superRange = p.lexer.range();
                    try p.lexer.next();

                    switch (p.lexer.token) {
                        .t_open_paren => {
                            if (l < @enumToInt(Level.call) and p.fn_or_arrow_data_parse.allow_super_call) {
                                return p.e(E.Super{}, loc);
                            }
                        },
                        .t_dot, .t_open_bracket => {
                            if (p.fn_or_arrow_data_parse.allow_super_property) {
                                return p.e(E.Super{}, loc);
                            }
                        },
                        else => {},
                    }

                    p.log.addRangeError(p.source, superRange, "Unexpected \"super\"") catch unreachable;
                    return p.e(E.Super{}, loc);
                },
                .t_open_paren => {
                    try p.lexer.next();

                    // Arrow functions aren't allowed in the middle of expressions
                    if (level.gt(.assign)) {
                        // Allow "in" inside parentheses
                        const oldAllowIn = p.allow_in;
                        p.allow_in = true;

                        var value = try p.parseExpr(Level.lowest);
                        p.markExprAsParenthesized(&value);
                        try p.lexer.expect(.t_close_paren);

                        p.allow_in = oldAllowIn;
                        return value;
                    }

                    return p.parseParenExpr(loc, level, ParenExprOpts{});
                },
                .t_false => {
                    try p.lexer.next();
                    return p.e(E.Boolean{ .value = false }, loc);
                },
                .t_true => {
                    try p.lexer.next();
                    return p.e(E.Boolean{ .value = true }, loc);
                },
                .t_null => {
                    try p.lexer.next();
                    return p.e(E.Null{}, loc);
                },
                .t_this => {
                    if (p.fn_or_arrow_data_parse.is_this_disallowed) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"this\" here") catch unreachable;
                    }
                    try p.lexer.next();
                    return Expr{ .data = Prefill.Data.This, .loc = loc };
                },
                .t_private_identifier => {
                    if (!p.allow_private_identifiers or !p.allow_in or level.gte(.compare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    const name = p.lexer.identifier;
                    try p.lexer.next();

                    // Check for "#foo in bar"
                    if (p.lexer.token != .t_in) {
                        try p.lexer.expected(.t_in);
                    }

                    return p.e(E.PrivateIdentifier{ .ref = try p.storeNameInRef(name) }, loc);
                },
                .t_identifier => {
                    const name = p.lexer.identifier;
                    const name_range = p.lexer.range();
                    const raw = p.lexer.raw();

                    try p.lexer.next();

                    // Handle async and await expressions
                    switch (AsyncPrefixExpression.find(name)) {
                        .is_async => {
                            if ((raw.ptr == name.ptr and raw.len == name.len) or AsyncPrefixExpression.find(raw) == .is_async) {
                                return try p.parseAsyncPrefixExpr(name_range, level);
                            }
                        },

                        .is_await => {
                            switch (p.fn_or_arrow_data_parse.allow_await) {
                                .forbid_all => {
                                    p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be used here") catch unreachable;
                                },
                                .allow_expr => {
                                    if (AsyncPrefixExpression.find(raw) != .is_await) {
                                        p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be escaped") catch unreachable;
                                    } else {
                                        if (p.fn_or_arrow_data_parse.is_top_level) {
                                            p.top_level_await_keyword = name_range;
                                        }

                                        if (p.fn_or_arrow_data_parse.track_arrow_arg_errors) {
                                            p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_await = name_range;
                                        }

                                        const value = try p.parseExpr(.prefix);
                                        if (p.lexer.token == T.t_asterisk_asterisk) {
                                            try p.lexer.unexpected();
                                            return error.SyntaxError;
                                        }

                                        return p.e(E.Await{ .value = value }, loc);
                                    }
                                },
                                else => {},
                            }
                        },

                        .is_yield => {
                            switch (p.fn_or_arrow_data_parse.allow_yield) {
                                .forbid_all => {
                                    p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be used here") catch unreachable;
                                },
                                .allow_expr => {
                                    if (AsyncPrefixExpression.find(raw) != .is_yield) {
                                        p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be escaped") catch unreachable;
                                    } else {
                                        if (level.gt(.assign)) {
                                            p.log.addRangeError(p.source, name_range, "Cannot use a \"yield\" here without parentheses") catch unreachable;
                                        }

                                        if (p.fn_or_arrow_data_parse.track_arrow_arg_errors) {
                                            p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_yield = name_range;
                                        }

                                        return p.parseYieldExpr(loc);
                                    }
                                },
                                // .allow_ident => {

                                // },
                                else => {
                                    // Try to gracefully recover if "yield" is used in the wrong place
                                    if (!p.lexer.has_newline_before) {
                                        switch (p.lexer.token) {
                                            .t_null, .t_identifier, .t_false, .t_true, .t_numeric_literal, .t_big_integer_literal, .t_string_literal => {
                                                p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" outside a generator function") catch unreachable;
                                            },
                                            else => {},
                                        }
                                    }
                                },
                            }
                        },
                        .none => {},
                    }

                    // Handle the start of an arrow expression
                    if (p.lexer.token == .t_equals_greater_than and level.lte(.assign)) {
                        const ref = p.storeNameInRef(name) catch unreachable;
                        var args = p.allocator.alloc(Arg, 1) catch unreachable;
                        args[0] = Arg{ .binding = p.b(B.Identifier{
                            .ref = ref,
                        }, loc) };

                        _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
                        defer p.popScope();

                        var fn_or_arrow_data = FnOrArrowDataParse{};
                        const ret = p.e(try p.parseArrowBody(args, &fn_or_arrow_data), loc);
                        return ret;
                    }

                    const ref = p.storeNameInRef(name) catch unreachable;

                    return Expr.initIdentifier(ref, loc);
                },
                .t_string_literal, .t_no_substitution_template_literal => {
                    return try p.parseStringLiteral();
                },
                .t_template_head => {
                    const head = p.lexer.toEString();

                    const parts = try p.parseTemplateParts(false);

                    // Check if TemplateLiteral is unsupported. We don't care for this product.`
                    // if ()

                    return p.e(E.Template{
                        .head = head,
                        .parts = parts,
                    }, loc);
                },
                .t_numeric_literal => {
                    const value = p.e(E.Number{ .value = p.lexer.number }, loc);
                    // p.checkForLegacyOctalLiteral()
                    try p.lexer.next();
                    return value;
                },
                .t_big_integer_literal => {
                    const value = p.lexer.identifier;
                    // markSyntaxFeature bigInt
                    try p.lexer.next();
                    return p.e(E.BigInt{ .value = value }, loc);
                },
                .t_slash, .t_slash_equals => {
                    try p.lexer.scanRegExp();
                    // always set regex_flags_start to null to make sure we don't accidentally use the wrong value later
                    defer p.lexer.regex_flags_start = null;
                    const value = p.lexer.raw();
                    try p.lexer.next();

                    return p.e(E.RegExp{ .value = value, .flags_offset = p.lexer.regex_flags_start }, loc);
                },
                .t_void => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{
                        .op = .un_void,
                        .value = value,
                    }, loc);
                },
                .t_typeof => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{ .op = .un_typeof, .value = value }, loc);
                },
                .t_delete => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                    if (value.data == .e_index) {
                        if (value.data.e_index.index.data == .e_private_identifier) {
                            const private = value.data.e_index.index.data.e_private_identifier;
                            const name = p.loadNameFromRef(private.ref);
                            const range = logger.Range{ .loc = value.loc, .len = @intCast(i32, name.len) };
                            p.log.addRangeErrorFmt(p.source, range, p.allocator, "Deleting the private name \"{s}\" is forbidden", .{name}) catch unreachable;
                        }
                    }

                    return p.e(E.Unary{ .op = .un_delete, .value = value }, loc);
                },
                .t_plus => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{ .op = .un_pos, .value = value }, loc);
                },
                .t_minus => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{ .op = .un_neg, .value = value }, loc);
                },
                .t_tilde => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{ .op = .un_cpl, .value = value }, loc);
                },
                .t_exclamation => {
                    try p.lexer.next();
                    const value = try p.parseExpr(.prefix);
                    if (p.lexer.token == .t_asterisk_asterisk) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    return p.e(E.Unary{ .op = .un_not, .value = value }, loc);
                },
                .t_minus_minus => {
                    try p.lexer.next();
                    return p.e(E.Unary{ .op = .un_pre_dec, .value = try p.parseExpr(.prefix) }, loc);
                },
                .t_plus_plus => {
                    try p.lexer.next();
                    return p.e(E.Unary{ .op = .un_pre_inc, .value = try p.parseExpr(.prefix) }, loc);
                },
                .t_function => {
                    return try p.parseFnExpr(loc, false, logger.Range.None);
                },
                .t_class => {
                    const classKeyword = p.lexer.range();
                    // markSyntaxFEatuer class
                    try p.lexer.next();
                    var name: ?js_ast.LocRef = null;

                    _ = p.pushScopeForParsePass(.class_name, loc) catch unreachable;

                    // Parse an optional class name
                    if (p.lexer.token == .t_identifier) {
                        const name_text = p.lexer.identifier;
                        if (!is_typescript_enabled or !strings.eqlComptime(name_text, "implements")) {
                            if (p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name_text, "await")) {
                                p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"await\" as an identifier here") catch unreachable;
                            }

                            name = js_ast.LocRef{
                                .loc = p.lexer.loc(),
                                .ref = p.newSymbol(
                                    .other,
                                    name_text,
                                ) catch unreachable,
                            };
                            try p.lexer.next();
                        }
                    }

                    // Even anonymous classes can have TypeScript type parameters
                    if (is_typescript_enabled) {
                        try p.skipTypeScriptTypeParameters();
                    }

                    const class = try p.parseClass(classKeyword, name, ParseClassOptions{});
                    p.popScope();

                    return p.e(class, loc);
                },
                .t_new => {
                    try p.lexer.next();

                    // Special-case the weird "new.target" expression here
                    if (p.lexer.token == .t_dot) {
                        try p.lexer.next();

                        if (p.lexer.token != .t_identifier or !strings.eqlComptime(p.lexer.raw(), "target")) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }
                        const range = logger.Range{ .loc = loc, .len = p.lexer.range().end().start - loc.start };

                        try p.lexer.next();
                        return p.e(E.NewTarget{ .range = range }, loc);
                    }

                    const target = try p.parseExprWithFlags(.member, flags);
                    var args = ExprNodeList{};

                    if (comptime is_typescript_enabled) {
                        // Skip over TypeScript non-null assertions
                        if (p.lexer.token == .t_exclamation and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                        }

                        // Skip over TypeScript type arguments here if there are any
                        if (p.lexer.token == .t_less_than) {
                            _ = p.trySkipTypeScriptTypeArgumentsWithBacktracking();
                        }
                    }

                    var close_parens_loc = logger.Loc.Empty;
                    if (p.lexer.token == .t_open_paren) {
                        const call_args = try p.parseCallArgs();
                        args = call_args.list;
                        close_parens_loc = call_args.loc;
                    }

                    return p.e(E.New{
                        .target = target,
                        .args = args,
                        .close_parens_loc = close_parens_loc,
                    }, loc);
                },
                .t_open_bracket => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var items = ListManaged(Expr).init(p.allocator);
                    var self_errors = DeferredErrors{};
                    var comma_after_spread = logger.Loc{};

                    // Allow "in" inside arrays
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while (p.lexer.token != .t_close_bracket) {
                        switch (p.lexer.token) {
                            .t_comma => {
                                items.append(Expr{ .data = Prefill.Data.EMissing, .loc = p.lexer.loc() }) catch unreachable;
                            },
                            .t_dot_dot_dot => {
                                if (errors != null)
                                    errors.?.array_spread_feature = p.lexer.range();

                                const dots_loc = p.lexer.loc();
                                try p.lexer.next();
                                items.append(
                                    p.e(E.Spread{ .value = try p.parseExprOrBindings(.comma, &self_errors) }, dots_loc),
                                ) catch unreachable;

                                // Commas are not allowed here when destructuring
                                if (p.lexer.token == .t_comma) {
                                    comma_after_spread = p.lexer.loc();
                                }
                            },
                            else => {
                                items.append(
                                    try p.parseExprOrBindings(.comma, &self_errors),
                                ) catch unreachable;
                            },
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }

                        try p.lexer.next();

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    const close_bracket_loc = p.lexer.loc();
                    try p.lexer.expect(.t_close_bracket);
                    p.allow_in = old_allow_in;

                    // Is this a binding pattern?
                    if (p.willNeedBindingPattern()) {
                        // noop
                    } else if (errors == null) {
                        // Is this an expression?
                        p.logExprErrors(&self_errors);
                    } else {
                        // In this case, we can't distinguish between the two yet
                        self_errors.mergeInto(errors.?);
                    }
                    return p.e(E.Array{
                        .items = ExprNodeList.fromList(items),
                        .comma_after_spread = comma_after_spread.toNullable(),
                        .is_single_line = is_single_line,
                        .close_bracket_loc = close_bracket_loc,
                    }, loc);
                },
                .t_open_brace => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var properties = ListManaged(G.Property).init(p.allocator);
                    var self_errors = DeferredErrors{};
                    var comma_after_spread: logger.Loc = logger.Loc{};

                    // Allow "in" inside object literals
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while (p.lexer.token != .t_close_brace) {
                        if (p.lexer.token == .t_dot_dot_dot) {
                            try p.lexer.next();
                            properties.append(G.Property{ .kind = .spread, .value = try p.parseExpr(.comma) }) catch unreachable;

                            // Commas are not allowed here when destructuring
                            if (p.lexer.token == .t_comma) {
                                comma_after_spread = p.lexer.loc();
                            }
                        } else {
                            // This property may turn out to be a type in TypeScript, which should be ignored
                            var propertyOpts = PropertyOpts{};
                            if (try p.parseProperty(.normal, &propertyOpts, &self_errors)) |prop| {
                                if (comptime Environment.allow_assert) {
                                    assert(prop.key != null or prop.value != null);
                                }
                                properties.append(prop) catch unreachable;
                            }
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }

                        try p.lexer.next();

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    const close_brace_loc = p.lexer.loc();
                    try p.lexer.expect(.t_close_brace);
                    p.allow_in = old_allow_in;

                    if (p.willNeedBindingPattern()) {
                        // Is this a binding pattern?
                    } else if (errors == null) {
                        // Is this an expression?
                        p.logExprErrors(&self_errors);
                    } else {
                        // In this case, we can't distinguish between the two yet
                        self_errors.mergeInto(errors.?);
                    }

                    return p.e(E.Object{
                        .properties = G.Property.List.fromList(properties),
                        .comma_after_spread = if (comma_after_spread.start > 0)
                            comma_after_spread
                        else
                            null,
                        .is_single_line = is_single_line,
                        .close_brace_loc = close_brace_loc,
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
                    if (comptime is_typescript_enabled and is_jsx_enabled) {
                        var oldLexer = std.mem.toBytes(p.lexer);

                        try p.lexer.next();
                        // Look ahead to see if this should be an arrow function instead
                        var is_ts_arrow_fn = false;

                        if (p.lexer.token == .t_identifier) {
                            try p.lexer.next();
                            if (p.lexer.token == .t_comma) {
                                is_ts_arrow_fn = true;
                            } else if (p.lexer.token == .t_extends) {
                                try p.lexer.next();
                                is_ts_arrow_fn = p.lexer.token != .t_equals and p.lexer.token != .t_greater_than;
                            }
                        }

                        // Restore the lexer
                        p.lexer = std.mem.bytesToValue(@TypeOf(p.lexer), &oldLexer);

                        if (is_ts_arrow_fn) {
                            try p.skipTypeScriptTypeParameters();
                            try p.lexer.expect(.t_open_paren);
                            return try p.parseParenExpr(loc, level, ParenExprOpts{ .force_arrow_fn = true });
                        }
                    }

                    if (is_jsx_enabled) {
                        // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
                        try p.lexer.nextInsideJSXElement();
                        const element = try p.parseJSXElement(loc);

                        // The call to parseJSXElement() above doesn't consume the last
                        // TGreaterThan because the caller knows what Next() function to call.
                        // Use Next() instead of NextInsideJSXElement() here since the next
                        // token is an expression.
                        try p.lexer.next();
                        return element;
                    }

                    if (is_typescript_enabled) {
                        // This is either an old-style type cast or a generic lambda function

                        // "<T>(x)"
                        // "<T>(x) => {}"
                        if (p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                            try p.lexer.expect(.t_open_paren);
                            return p.parseParenExpr(loc, level, ParenExprOpts{});
                        }

                        // "<T>x"
                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                        try p.lexer.expectGreaterThan(false);
                        return p.parsePrefix(level, errors, flags);
                    }

                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
                .t_import => {
                    try p.lexer.next();
                    return p.parseImportExpr(loc, level);
                },
                else => {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
            }
            return error.SyntaxError;
        }

        // esbuild's version of this function is much more complicated.
        // I'm not sure why defines is strictly relevant for this case
        // do people do <API_URL>?
        fn jsxRefToMemberExpression(p: *P, loc: logger.Loc, ref: Ref) Expr {
            p.recordUsage(ref);
            return p.e(E.Identifier{
                .ref = ref,
                .can_be_removed_if_unused = true,
                .call_can_be_unwrapped_if_unused = true,
            }, loc);
        }

        fn jsxStringsToMemberExpression(p: *P, loc: logger.Loc, parts: []const []const u8) !Expr {
            const result = try p.findSymbol(loc, parts[0]);

            var value = p.handleIdentifier(
                loc,
                E.Identifier{
                    .ref = result.ref,
                    .must_keep_due_to_with_stmt = result.is_inside_with_scope,
                    .can_be_removed_if_unused = true,
                },
                parts[0],
                .{
                    .was_originally_identifier = true,
                },
            );
            if (parts.len > 1) {
                return p.memberExpression(loc, value, parts[1..]);
            }

            return value;
        }

        fn memberExpression(p: *P, loc: logger.Loc, initial_value: Expr, parts: []const []const u8) Expr {
            var value = initial_value;

            for (parts) |part| {
                if (p.maybeRewritePropertyAccess(
                    loc,
                    value,
                    part,
                    loc,
                    false,
                )) |rewrote| {
                    value = rewrote;
                } else {
                    value = p.e(
                        E.Dot{
                            .target = value,
                            .name = part,
                            .name_loc = loc,

                            .can_be_removed_if_unused = true,
                        },
                        loc,
                    );
                }
            }

            return value;
        }

        // Note: The caller has already parsed the "import" keyword
        fn parseImportExpr(p: *P, loc: logger.Loc, level: Level) anyerror!Expr {
            // Parse an "import.meta" expression
            if (p.lexer.token == .t_dot) {
                p.es6_import_keyword = js_lexer.rangeOfIdentifier(p.source, loc);
                try p.lexer.next();
                if (p.lexer.isContextualKeyword("meta")) {
                    try p.lexer.next();
                    p.has_import_meta = true;
                    return p.e(E.ImportMeta{}, loc);
                } else {
                    try p.lexer.expectedString("\"meta\"");
                }
            }

            if (level.gt(.call)) {
                const r = js_lexer.rangeOfIdentifier(p.source, loc);
                p.log.addRangeError(p.source, r, "Cannot use an \"import\" expression here without parentheses") catch unreachable;
            }

            // allow "in" inside call arguments;
            var old_allow_in = p.allow_in;
            p.allow_in = true;

            p.lexer.preserve_all_comments_before = true;
            try p.lexer.expect(.t_open_paren);
            const comments = p.lexer.comments_to_preserve_before.toOwnedSlice();
            p.lexer.preserve_all_comments_before = false;

            const value = try p.parseExpr(.comma);

            if (p.lexer.token == .t_comma) {
                // "import('./foo.json', )"
                try p.lexer.next();

                if (p.lexer.token != .t_close_paren) {
                    // for now, we silently strip import assertions
                    // "import('./foo.json', { assert: { type: 'json' } })"
                    _ = try p.parseExpr(.comma);

                    if (p.lexer.token == .t_comma) {
                        // "import('./foo.json', { assert: { type: 'json' } }, , )"
                        try p.lexer.next();
                    }
                }
            }

            try p.lexer.expect(.t_close_paren);

            p.allow_in = old_allow_in;

            if (comptime only_scan_imports_and_do_not_visit) {
                if (value.data == .e_string and value.data.e_string.isUTF8() and value.data.e_string.isPresent()) {
                    const import_record_index = p.addImportRecord(.dynamic, value.loc, value.data.e_string.slice(p.allocator));

                    return p.e(E.Import{
                        .expr = value,
                        .leading_interior_comments = comments,
                        .import_record_index = import_record_index,
                    }, loc);
                }
            }

            return p.e(E.Import{ .expr = value, .leading_interior_comments = comments, .import_record_index = 0 }, loc);
        }

        fn parseJSXPropValueIdentifier(p: *P, previous_string_with_backslash_loc: *logger.Loc) !Expr {
            // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
            try p.lexer.nextInsideJSXElement();
            if (p.lexer.token == .t_string_literal) {
                previous_string_with_backslash_loc.start = std.math.max(p.lexer.loc().start, p.lexer.previous_backslash_quote_in_jsx.loc.start);
                const expr = p.e(p.lexer.toEString(), previous_string_with_backslash_loc.*);

                try p.lexer.nextInsideJSXElement();
                return expr;
            } else {
                // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
                try p.lexer.expect(.t_open_brace);
                const value = try p.parseExpr(.lowest);

                try p.lexer.expectInsideJSXElement(.t_close_brace);
                return value;
            }
        }

        fn parseJSXElement(p: *P, loc: logger.Loc) anyerror!Expr {
            if (only_scan_imports_and_do_not_visit) {
                p.needs_jsx_import = true;
            }

            var tag = try JSXTag.parse(P, p);

            // The tag may have TypeScript type arguments: "<Foo<T>/>"
            if (is_typescript_enabled) {
                // Pass a flag to the type argument skipper because we need to call
                _ = try p.skipTypeScriptTypeArguments(true);
            }

            var previous_string_with_backslash_loc = logger.Loc{};
            var properties = G.Property.List{};
            var key_prop: ?ExprNodeIndex = null;
            var flags = Flags.JSXElement.Bitset{};
            var start_tag: ?ExprNodeIndex = null;
            var can_be_inlined = false;

            // Fragments don't have props
            // Fragments of the form "React.Fragment" are not parsed as fragments.
            if (@as(JSXTag.TagType, tag.data) == .tag) {
                start_tag = tag.data.tag;
                can_be_inlined = p.options.features.jsx_optimization_inline;

                var spread_loc: logger.Loc = logger.Loc.Empty;
                var props = ListManaged(G.Property).init(p.allocator);
                var key_prop_i: i32 = -1;
                var spread_prop_i: i32 = -1;
                var i: i32 = 0;
                parse_attributes: while (true) {
                    switch (p.lexer.token) {
                        .t_identifier => {
                            defer i += 1;
                            // Parse the prop name
                            var key_range = p.lexer.range();
                            const prop_name_literal = p.lexer.identifier;
                            const special_prop = E.JSXElement.SpecialProp.Map.get(prop_name_literal) orelse E.JSXElement.SpecialProp.any;
                            try p.lexer.nextInsideJSXElement();

                            if (special_prop == .key) {
                                // <ListItem key>
                                if (p.lexer.token != .t_equals) {
                                    // Unlike Babel, we're going to just warn here and move on.
                                    try p.log.addWarning(p.source, key_range.loc, "\"key\" prop ignored. Must be a string, number or symbol.");
                                    continue;
                                }

                                key_prop_i = i;
                                key_prop = try p.parseJSXPropValueIdentifier(&previous_string_with_backslash_loc);
                                continue;
                            }

                            can_be_inlined = can_be_inlined and special_prop != .ref;

                            const prop_name = p.e(E.String{ .data = prop_name_literal }, key_range.loc);

                            // Parse the value
                            var value: Expr = undefined;
                            if (p.lexer.token != .t_equals) {

                                // Implicitly true value
                                // <button selected>
                                value = p.e(E.Boolean{ .value = true }, logger.Loc{ .start = key_range.loc.start + key_range.len });
                            } else {
                                value = try p.parseJSXPropValueIdentifier(&previous_string_with_backslash_loc);
                                if (comptime jsx_transform_type == .solid) {
                                    switch (value.knownPrimitive()) {
                                        .unknown => {
                                            flags.insert(.has_any_dynamic);
                                        },
                                        else => {},
                                    }
                                }
                            }

                            try props.append(G.Property{ .key = prop_name, .value = value });
                        },
                        .t_open_brace => {
                            defer i += 1;
                            // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                            try p.lexer.next();

                            switch (p.lexer.token) {
                                .t_dot_dot_dot => {
                                    try p.lexer.next();
                                    can_be_inlined = false;

                                    spread_prop_i = i;
                                    spread_loc = p.lexer.loc();
                                    try props.append(G.Property{ .value = try p.parseExpr(.comma), .kind = .spread });
                                },
                                // This implements
                                //  <div {foo} />
                                //  ->
                                //  <div foo={foo} />
                                T.t_identifier => {
                                    // we need to figure out what the key they mean is
                                    // to do that, we must determine the key name
                                    const expr = try p.parseExpr(Level.lowest);

                                    const key = brk: {
                                        switch (expr.data) {
                                            .e_import_identifier => |ident| {
                                                break :brk p.e(E.String{ .data = p.loadNameFromRef(ident.ref) }, expr.loc);
                                            },
                                            .e_identifier => |ident| {
                                                break :brk p.e(E.String{ .data = p.loadNameFromRef(ident.ref) }, expr.loc);
                                            },
                                            .e_dot => |dot| {
                                                break :brk p.e(E.String{ .data = dot.name }, dot.name_loc);
                                            },
                                            .e_index => |index| {
                                                if (index.index.data == .e_string) {
                                                    break :brk index.index;
                                                }
                                            },
                                            else => {},
                                        }

                                        // If we get here, it's invalid
                                        try p.log.addError(p.source, expr.loc, "Invalid JSX prop shorthand, must be identifier, dot or string");
                                        return error.SyntaxError;
                                    };

                                    if (comptime jsx_transform_type == .solid) {
                                        switch (expr.knownPrimitive()) {
                                            .unknown => {
                                                flags.insert(.has_any_dynamic);
                                            },
                                            else => {},
                                        }
                                    }

                                    try props.append(G.Property{ .value = expr, .key = key, .kind = .normal });
                                },
                                // This implements
                                //  <div {"foo"} />
                                //  <div {'foo'} />
                                //  ->
                                //  <div foo="foo" />
                                // note: template literals are not supported, operations on strings are not supported either
                                T.t_string_literal => {
                                    const key = p.e(p.lexer.toEString(), p.lexer.loc());
                                    try p.lexer.next();
                                    try props.append(G.Property{ .value = key, .key = key, .kind = .normal });
                                },

                                else => try p.lexer.unexpected(),
                            }

                            try p.lexer.nextInsideJSXElement();
                        },
                        else => {
                            break :parse_attributes;
                        },
                    }
                }

                const is_key_before_rest = key_prop_i > -1 and spread_prop_i > key_prop_i;
                flags.setPresent(.is_key_before_rest, is_key_before_rest);
                if (is_key_before_rest and p.options.jsx.runtime == .automatic and !p.has_classic_runtime_warned) {
                    try p.log.addWarning(p.source, spread_loc, "\"key\" prop before a {...spread} is deprecated in JSX. Falling back to classic runtime.");
                    p.has_classic_runtime_warned = true;
                }
                properties = G.Property.List.fromList(props);
            }

            // People sometimes try to use the output of "JSON.stringify()" as a JSX
            // attribute when automatically-generating JSX code. Doing so is incorrect
            // because JSX strings work like XML instead of like JS (since JSX is XML-in-
            // JS). Specifically, using a backslash before a quote does not cause it to
            // be escaped:
            //
            //   JSX ends the "content" attribute here and sets "content" to 'some so-called \\'
            //                                          v
            //         <Button content="some so-called \"button text\"" />
            //                                                      ^
            //       There is no "=" after the JSX attribute "text", so we expect a ">"
            //
            // This code special-cases this error to provide a less obscure error message.
            if (p.lexer.token == .t_syntax_error and strings.eqlComptime(p.lexer.raw(), "\\") and previous_string_with_backslash_loc.start > 0) {
                const r = p.lexer.range();
                // Not dealing with this right now.
                try p.log.addRangeError(p.source, r, "Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead");
                return error.SyntaxError;
            }

            // A slash here is a self-closing element
            if (p.lexer.token == .t_slash) {
                const close_tag_loc = p.lexer.loc();
                // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"

                try p.lexer.nextInsideJSXElement();

                if (p.lexer.token != .t_greater_than) {
                    try p.lexer.expected(.t_greater_than);
                }

                if (can_be_inlined) {
                    flags.insert(.can_be_inlined);
                }

                return p.e(E.JSXElement{
                    .tag = start_tag,
                    .properties = properties,
                    .key = key_prop,
                    .flags = flags,
                    .close_tag_loc = close_tag_loc,
                }, loc);
            }

            // Use ExpectJSXElementChild() so we parse child strings
            try p.lexer.expectJSXElementChild(.t_greater_than);
            var children = ListManaged(Expr).init(p.allocator);
            // var last_element_i: usize = 0;

            while (true) {
                switch (p.lexer.token) {
                    .t_string_literal => {
                        try children.append(p.e(p.lexer.toEString(), loc));
                        try p.lexer.nextJSXElementChild();
                    },
                    .t_open_brace => {
                        // Use Next() instead of NextJSXElementChild() here since the next token is an expression
                        try p.lexer.next();

                        // The "..." here is ignored (it's used to signal an array type in TypeScript)
                        if (p.lexer.token == .t_dot_dot_dot and is_typescript_enabled) {
                            try p.lexer.next();
                        }

                        // The expression is optional, and may be absent
                        if (p.lexer.token != .t_close_brace) {
                            if (comptime jsx_transform_type == .solid) {
                                const child = try p.parseExpr(.lowest);
                                switch (child.knownPrimitive()) {
                                    .unknown => {
                                        flags.insert(.has_any_dynamic);
                                    },
                                    else => {},
                                }
                                try children.append(child);
                            } else {
                                try children.append(try p.parseExpr(.lowest));
                            }
                        }

                        // Use ExpectJSXElementChild() so we parse child strings
                        try p.lexer.expectJSXElementChild(.t_close_brace);
                    },
                    .t_less_than => {
                        const less_than_loc = p.lexer.loc();
                        try p.lexer.nextInsideJSXElement();

                        if (p.lexer.token != .t_slash) {
                            // This is a child element
                            if (comptime jsx_transform_type == .solid) {
                                const child = try p.parseJSXElement(less_than_loc);

                                // if (!flags.contains(.has_dynamic_children)) {
                                //     if (@as(Expr.Tag, child.data) == .e_jsx_element) {
                                //         if (child.data.e_jsx_element.flags.contains(.has_dynamic_children) or child.data.e_jsx_element.flags.contains(.has_dynamic_prop)) {
                                //             flags.insert(.has_dynamic_children);

                                //         }
                                //     } else {
                                //         switch (child.knownPrimitive()) {
                                //             .unknown => {
                                //                 flags.insert(.has_dynamic_children);
                                //             },
                                //             else => {},
                                //         }
                                //     }
                                // }

                                if (!flags.contains(.has_any_dynamic)) {
                                    if (@as(Expr.Tag, child.data) == .e_jsx_element) {
                                        if (child.data.e_jsx_element.flags.contains(.has_any_dynamic)) {
                                            flags.insert(.has_any_dynamic);
                                        }
                                    } else {
                                        switch (child.knownPrimitive()) {
                                            .unknown => {
                                                flags.insert(.has_any_dynamic);
                                            },
                                            else => {},
                                        }
                                    }
                                }

                                children.append(child) catch unreachable;
                            } else {
                                children.append(try p.parseJSXElement(less_than_loc)) catch unreachable;
                            }

                            // The call to parseJSXElement() above doesn't consume the last
                            // TGreaterThan because the caller knows what Next() function to call.
                            // Use NextJSXElementChild() here since the next token is an element
                            // child.
                            try p.lexer.nextJSXElementChild();
                            continue;
                        }

                        // This is the closing element
                        try p.lexer.nextInsideJSXElement();
                        const end_tag = try JSXTag.parse(P, p);

                        if (!strings.eql(end_tag.name, tag.name)) {
                            try p.log.addRangeErrorFmt(p.source, end_tag.range, p.allocator, "Expected closing tag </{s}> to match opening tag <{s}>", .{
                                end_tag.name,
                                tag.name,
                            });
                            return error.SyntaxError;
                        }

                        if (p.lexer.token != .t_greater_than) {
                            try p.lexer.expected(.t_greater_than);
                        }

                        if (can_be_inlined) {
                            flags.insert(.can_be_inlined);
                        }

                        return p.e(E.JSXElement{
                            .tag = end_tag.data.asExpr(),
                            .children = ExprNodeList.fromList(children),
                            .properties = properties,
                            .key = key_prop,
                            .flags = flags,
                            .close_tag_loc = end_tag.range.loc,
                        }, loc);
                    },
                    else => {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    },
                }
            }
        }

        fn willNeedBindingPattern(p: *P) bool {
            return switch (p.lexer.token) {
                // "[a] = b;"
                .t_equals => true,
                // "for ([a] in b) {}"
                .t_in => !p.allow_in,
                // "for ([a] of b) {}"
                .t_identifier => !p.allow_in and p.lexer.isContextualKeyword("of"),
                else => false,
            };
        }

        fn appendPart(p: *P, parts: *ListManaged(js_ast.Part), stmts: []Stmt) !void {
            // Reuse the memory if possible
            // This is reusable if the last part turned out to be dead
            p.symbol_uses.clearRetainingCapacity();
            p.declared_symbols.clearRetainingCapacity();
            p.scopes_for_current_part.clearRetainingCapacity();
            p.import_records_for_current_part.clearRetainingCapacity();

            const allocator = p.allocator;
            var opts = PrependTempRefsOpts{};
            var partStmts = ListManaged(Stmt).fromOwnedSlice(allocator, stmts);

            //
            const bun_plugin_usage_count_before: usize = if (p.options.features.hoist_bun_plugin and !p.bun_plugin.ref.isNull())
                p.symbols.items[p.bun_plugin.ref.innerIndex()].use_count_estimate
            else
                0;

            try p.visitStmtsAndPrependTempRefs(&partStmts, &opts);

            // Insert any relocated variable statements now
            if (p.relocated_top_level_vars.items.len > 0) {
                var already_declared = RefMap{};
                var already_declared_allocator_stack = std.heap.stackFallback(1024, allocator);
                var already_declared_allocator = already_declared_allocator_stack.get();
                defer if (already_declared_allocator_stack.fixed_buffer_allocator.end_index >= 1023) already_declared.deinit(already_declared_allocator);

                for (p.relocated_top_level_vars.items) |*local| {
                    // Follow links because "var" declarations may be merged due to hoisting
                    while (local.ref != null) {
                        const link = p.symbols.items[local.ref.?.innerIndex()].link;
                        if (link.isNull()) {
                            break;
                        }
                        local.ref = link;
                    }
                    const ref = local.ref orelse continue;
                    var declaration_entry = try already_declared.getOrPut(already_declared_allocator, ref);
                    if (!declaration_entry.found_existing) {
                        const decls = try allocator.alloc(G.Decl, 1);
                        decls[0] = Decl{
                            .binding = p.b(B.Identifier{ .ref = ref }, local.loc),
                        };
                        try partStmts.append(p.s(S.Local{ .decls = decls }, local.loc));
                    }
                }
                p.relocated_top_level_vars.clearRetainingCapacity();

                // Follow links because "var" declarations may be merged due to hoisting

                // while (true) {
                //     const link = p.symbols.items[local.ref.innerIndex()].link;
                // }
            }

            if (partStmts.items.len > 0) {
                const _stmts = partStmts.toOwnedSlice();

                // -- hoist_bun_plugin --
                if (_stmts.len == 1 and p.options.features.hoist_bun_plugin and !p.bun_plugin.ref.isNull()) {
                    const bun_plugin_usage_count_after: usize = p.symbols.items[p.bun_plugin.ref.innerIndex()].use_count_estimate;
                    if (bun_plugin_usage_count_after > bun_plugin_usage_count_before) {
                        var previous_parts: []js_ast.Part = parts.items;

                        for (previous_parts) |*previous_part, j| {
                            if (previous_part.stmts.len == 0) continue;

                            const declared_symbols = previous_part.declared_symbols;

                            for (declared_symbols) |decl| {
                                if (p.symbol_uses.contains(decl.ref)) {
                                    // we move this part to our other file
                                    for (previous_parts[0..j]) |*this_part| {
                                        if (this_part.stmts.len == 0) continue;
                                        const this_declared_symbols = this_part.declared_symbols;
                                        for (this_declared_symbols) |this_decl| {
                                            if (previous_part.symbol_uses.contains(this_decl.ref)) {
                                                try p.bun_plugin.hoisted_stmts.appendSlice(p.allocator, this_part.stmts);
                                                this_part.stmts = &.{};
                                                break;
                                            }
                                        }
                                    }

                                    try p.bun_plugin.hoisted_stmts.appendSlice(p.allocator, previous_part.stmts);
                                    break;
                                }
                            }
                        }
                        p.bun_plugin.hoisted_stmts.append(p.allocator, _stmts[0]) catch unreachable;

                        // Single-statement part which uses Bun.plugin()
                        // It's effectively an unrelated file
                        if (p.declared_symbols.items.len > 0 or p.symbol_uses.count() > 0) {
                            p.clearSymbolUsagesFromDeadPart(.{ .stmts = undefined, .declared_symbols = p.declared_symbols.items, .symbol_uses = p.symbol_uses });
                        }
                        return;
                    }
                }
                // -- hoist_bun_plugin --

                try parts.append(js_ast.Part{
                    .stmts = _stmts,
                    .symbol_uses = p.symbol_uses,
                    .declared_symbols = p.declared_symbols.toOwnedSlice(
                        p.allocator,
                    ),
                    .import_record_indices = p.import_records_for_current_part.toOwnedSlice(
                        p.allocator,
                    ),
                    .scopes = p.scopes_for_current_part.toOwnedSlice(p.allocator),
                    .can_be_removed_if_unused = p.stmtsCanBeRemovedIfUnused(_stmts),
                });
                p.symbol_uses = .{};
            } else if (p.declared_symbols.items.len > 0 or p.symbol_uses.count() > 0) {
                // if the part is dead, invalidate all the usage counts
                p.clearSymbolUsagesFromDeadPart(.{ .stmts = undefined, .declared_symbols = p.declared_symbols.items, .symbol_uses = p.symbol_uses });
            }
        }

        fn bindingCanBeRemovedIfUnused(p: *P, binding: Binding) bool {
            switch (binding.data) {
                .b_array => |bi| {
                    for (bi.items) |*item| {
                        if (!p.bindingCanBeRemovedIfUnused(item.binding)) {
                            return false;
                        }

                        if (item.default_value) |*default| {
                            if (!p.exprCanBeRemovedIfUnused(default)) {
                                return false;
                            }
                        }
                    }
                },
                .b_object => |bi| {
                    for (bi.properties) |*property| {
                        if (!property.flags.contains(.is_spread) and !p.exprCanBeRemovedIfUnused(&property.key)) {
                            return false;
                        }

                        if (!p.bindingCanBeRemovedIfUnused(property.value)) {
                            return false;
                        }

                        if (property.default_value) |*default| {
                            if (!p.exprCanBeRemovedIfUnused(default)) {
                                return false;
                            }
                        }
                    }
                },
                else => {},
            }

            return true;
        }

        fn stmtsCanBeRemovedIfUnused(p: *P, stmts: []Stmt) bool {
            for (stmts) |stmt| {
                switch (stmt.data) {
                    // These never have side effects
                    .s_function, .s_empty => {},

                    // Let these be removed if they are unused. Note that we also need to
                    // check if the imported file is marked as "sideEffects: false" before we
                    // can remove a SImport statement. Otherwise the import must be kept for
                    // its side effects.
                    .s_import => {},
                    .s_class => |st| {
                        if (!p.classCanBeRemovedIfUnused(&st.class)) {
                            return false;
                        }
                    },
                    .s_expr => |st| {
                        if (st.does_not_affect_tree_shaking) {
                            // Expressions marked with this are automatically generated and have
                            // no side effects by construction.
                            break;
                        }

                        if (!p.exprCanBeRemovedIfUnused(&st.value)) {
                            return false;
                        }
                    },
                    .s_local => |st| {
                        for (st.decls) |*decl| {
                            if (!p.bindingCanBeRemovedIfUnused(decl.binding)) {
                                return false;
                            }

                            if (decl.value) |*decl_value| {
                                if (!p.exprCanBeRemovedIfUnused(decl_value)) {
                                    return false;
                                }
                            }
                        }
                    },

                    .s_try => |try_| {
                        if (!p.stmtsCanBeRemovedIfUnused(try_.body) or (try_.finally != null and !p.stmtsCanBeRemovedIfUnused(try_.finally.?.stmts))) {
                            return false;
                        }
                    },

                    // Exports are tracked separately, so this isn't necessary
                    .s_export_clause, .s_export_from => {},

                    .s_export_default => |st| {
                        switch (st.value) {
                            .stmt => |s2| {
                                switch (s2.data) {
                                    .s_expr => |s_expr| {
                                        if (!p.exprCanBeRemovedIfUnused(&s_expr.value)) {
                                            return false;
                                        }
                                    },

                                    // These never have side effects
                                    .s_function => {},

                                    .s_class => {
                                        if (!p.classCanBeRemovedIfUnused(&s2.data.s_class.class)) {
                                            return false;
                                        }
                                    },
                                    else => {
                                        Global.panic("Unexpected type in export default: {s}", .{s2});
                                    },
                                }
                            },
                            .expr => |*exp| {
                                if (!p.exprCanBeRemovedIfUnused(exp)) {
                                    return false;
                                }
                            },
                        }
                    },
                    else => {
                        return false;
                    },
                }
            }

            return true;
        }

        fn visitStmtsAndPrependTempRefs(p: *P, stmts: *ListManaged(Stmt), opts: *PrependTempRefsOpts) !void {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            p.temp_refs_to_declare.deinit(p.allocator);
            p.temp_refs_to_declare = @TypeOf(p.temp_refs_to_declare){};
            p.temp_ref_count = 0;

            try p.visitStmts(stmts, opts.kind);

            // Prepend values for "this" and "arguments"
            if (opts.fn_body_loc != null) {
                // Capture "this"
                if (p.fn_only_data_visit.this_capture_ref) |ref| {
                    try p.temp_refs_to_declare.append(p.allocator, TempRef{
                        .ref = ref,
                        .value = p.e(E.This{}, opts.fn_body_loc orelse p.panic("Internal error: Expected opts.fn_body_loc to exist", .{})),
                    });
                }
            }
        }

        fn recordDeclaredSymbol(p: *P, ref: Ref) !void {
            try p.declared_symbols.append(p.allocator, js_ast.DeclaredSymbol{
                .ref = ref,
                .is_top_level = p.current_scope == p.module_scope,
            });
        }

        // public for JSNode.JSXWriter usage
        pub fn visitExpr(p: *P, expr: Expr) Expr {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            // hopefully this gets tailed
            return p.visitExprInOut(expr, .{});
        }

        fn visitFunc(p: *P, _func: G.Fn, open_parens_loc: logger.Loc) G.Fn {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            var func = _func;
            const old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
            const old_fn_only_data = p.fn_only_data_visit;
            p.fn_or_arrow_data_visit = FnOrArrowDataVisit{ .is_async = func.flags.contains(.is_async) };
            p.fn_only_data_visit = FnOnlyDataVisit{ .is_this_nested = true, .arguments_ref = func.arguments_ref };

            if (func.name) |name| {
                if (name.ref) |name_ref| {
                    p.recordDeclaredSymbol(name_ref) catch unreachable;
                    const symbol_name = p.loadNameFromRef(name_ref);
                    if (isEvalOrArguments(symbol_name)) {
                        p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, name.loc), symbol_name) catch unreachable;
                    }
                }
            }

            const body = func.body;

            p.pushScopeForVisitPass(.function_args, open_parens_loc) catch unreachable;
            p.visitArgs(
                func.args,
                VisitArgsOpts{
                    .has_rest_arg = func.flags.contains(.has_rest_arg),
                    .body = body.stmts,
                    .is_unique_formal_parameters = true,
                },
            );

            p.pushScopeForVisitPass(.function_body, body.loc) catch unreachable;
            var stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, body.stmts);
            var temp_opts = PrependTempRefsOpts{ .kind = StmtsKind.fn_body, .fn_body_loc = body.loc };
            p.visitStmtsAndPrependTempRefs(&stmts, &temp_opts) catch unreachable;
            func.body = G.FnBody{ .stmts = stmts.toOwnedSlice(), .loc = body.loc };

            p.popScope();
            p.popScope();

            p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
            p.fn_only_data_visit = old_fn_only_data;
            return func;
        }

        fn maybeKeepExprSymbolName(p: *P, expr: Expr, original_name: string, was_anonymous_named_expr: bool) Expr {
            return if (was_anonymous_named_expr) p.keepExprSymbolName(expr, original_name) else expr;
        }

        fn valueForThis(p: *P, loc: logger.Loc) ?Expr {
            // Substitute "this" if we're inside a static class property initializer
            if (p.fn_only_data_visit.this_class_static_ref) |ref| {
                p.recordUsage(ref);
                return p.e(E.Identifier{ .ref = ref }, loc);
            }

            // oroigianlly was !=- modepassthrough
            if (!p.fn_only_data_visit.is_this_nested) {
                if (p.has_es_module_syntax) {
                    // In an ES6 module, "this" is supposed to be undefined. Instead of
                    // doing this at runtime using "fn.call(undefined)", we do it at
                    // compile time using expression substitution here.
                    return Expr{ .loc = loc, .data = nullValueExpr };
                } else {
                    // In a CommonJS module, "this" is supposed to be the same as "exports".
                    // Instead of doing this at runtime using "fn.call(module.exports)", we
                    // do it at compile time using expression substitution here.
                    p.recordUsage(p.exports_ref);
                    return p.e(E.Identifier{ .ref = p.exports_ref }, loc);
                }
            }

            return null;
        }

        fn isValidAssignmentTarget(p: *P, expr: Expr) bool {
            return switch (expr.data) {
                .e_identifier => |ident| !isEvalOrArguments(p.loadNameFromRef(ident.ref)),
                .e_dot => |e| e.optional_chain == null,
                .e_index => |e| e.optional_chain == null,
                .e_array => |e| !e.is_parenthesized,
                .e_object => |e| !e.is_parenthesized,
                else => false,
            };
        }

        fn visitExprInOut(p: *P, expr: Expr, in: ExprIn) Expr {
            if (in.assign_target != .none and !p.isValidAssignmentTarget(expr)) {
                p.log.addError(p.source, expr.loc, "Invalid assignment target") catch unreachable;
            }

            // Output.print("\nVisit: {s} - {d}\n", .{ @tagName(expr.data), expr.loc.start });
            switch (expr.data) {
                .e_null, .e_super, .e_boolean, .e_big_int, .e_reg_exp, .e_undefined => {},

                .e_new_target => |_| {
                    // this error is not necessary and it is causing breakages
                    // if (!p.fn_only_data_visit.is_new_target_allowed) {
                    //     p.log.addRangeError(p.source, target.range, "Cannot use \"new.target\" here") catch unreachable;
                    // }
                },

                .e_string => {

                    // If you're using this, you're probably not using 0-prefixed legacy octal notation
                    // if e.LegacyOctalLoc.Start > 0 {
                },
                .e_number => {

                    // idc about legacy octal loc
                },
                .e_this => {
                    if (p.valueForThis(expr.loc)) |exp| {
                        return exp;
                    }

                    //         		// Capture "this" inside arrow functions that will be lowered into normal
                    // // function expressions for older language environments
                    // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
                    // 	return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
                    // }
                },

                .e_import_meta => {
                    // TODO: delete import.meta might not work
                    const is_delete_target = std.meta.activeTag(p.delete_target) == .e_import_meta;

                    if (p.define.dots.get("meta")) |meta| {
                        for (meta) |define| {
                            if (p.isDotDefineMatch(expr, define.parts)) {
                                // Substitute user-specified defines
                                return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                            }
                        }
                    }

                    if (!p.import_meta_ref.isNull()) {
                        p.recordUsage(p.import_meta_ref);
                        return p.e(E.Identifier{ .ref = p.import_meta_ref }, expr.loc);
                    }
                },
                .e_spread => |exp| {
                    exp.value = p.visitExpr(exp.value);
                },
                .e_identifier => {
                    var e_ = expr.data.e_identifier;
                    const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_identifier and expr.data.e_identifier.ref.eql(p.delete_target.e_identifier.ref);

                    const name = p.loadNameFromRef(e_.ref);
                    if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
                        p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, expr.loc), name) catch unreachable;
                    }

                    const result = p.findSymbol(expr.loc, name) catch unreachable;

                    e_.must_keep_due_to_with_stmt = result.is_inside_with_scope;
                    e_.ref = result.ref;

                    // TODO: fix the underyling cause here
                    // The problem seems to be that result.ref.innerIndex() is not always set.

                    // Handle assigning to a constant
                    // if (in.assign_target != .none and p.symbols.items[result.ref.innerIndex()].kind == .cconst) {
                    //     const r = js_lexer.rangeOfIdentifier(p.source, expr.loc);
                    //     p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot assign to {s} because it is a constant", .{name}) catch unreachable;
                    // }

                    var original_name: ?string = null;

                    // Substitute user-specified defines for unbound symbols
                    if (p.symbols.items[e_.ref.innerIndex()].kind == .unbound and !result.is_inside_with_scope and !is_delete_target) {
                        if (p.define.identifiers.get(name)) |def| {
                            if (!def.isUndefined()) {
                                const newvalue = p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &def);

                                // Don't substitute an identifier for a non-identifier if this is an
                                // assignment target, since it'll cause a syntax error
                                if (@as(Expr.Tag, newvalue.data) == .e_identifier or in.assign_target == .none) {
                                    p.ignoreUsage(e_.ref);
                                    return newvalue;
                                }

                                original_name = def.original_name;
                            }

                            // Copy the side effect flags over in case this expression is unused
                            if (def.can_be_removed_if_unused) {
                                e_.can_be_removed_if_unused = true;
                            }
                            if (def.call_can_be_unwrapped_if_unused and !p.options.ignore_dce_annotations) {
                                e_.call_can_be_unwrapped_if_unused = true;
                            }
                        }
                    }

                    return p.handleIdentifier(expr.loc, e_, original_name, IdentifierOpts{
                        .assign_target = in.assign_target,
                        .is_delete_target = is_delete_target,
                        .was_originally_identifier = true,
                    });
                },

                .e_jsx_element => |e_| {
                    switch (comptime jsx_transform_type) {
                        .macro => {
                            const WriterType = js_ast.Macro.JSNode.NewJSXWriter(P);
                            var writer = WriterType.initWriter(p, &BunJSX.bun_jsx_identifier);
                            return writer.writeFunctionCall(e_.*);
                        },
                        .solid => {
                            // The rules:
                            // 1. HTML string literals of static JSX elements are generated & escaped, injected at the top of the file
                            // 1a. Static elements are contiguous in the HTML, but dynamic elements get a marker string during if client-side hydration
                            // Each element becomes a declaration in the top-level scope of the JSX expression (i.e. either the anonymous IIFE or an array)
                            // Those elements may be markers
                            // The final count of the markers is passed to the template function
                            // 3. The first element in a a group of elements becomes .cloneNode(true)
                            // Subsequent elements call .nextSibling on the previous element.
                            // The specific function differs if SSR is enabled and if client-side hydration is enabled.
                            // 4. Non-static JSX children are added like this:
                            //     insert(topElement, createComponent(MyComponent, props), markerElement)
                            // 5. Non-statically analyzable attributes are added like this:
                            //    setAttribute(topElement, "data-foo", "bar")
                            var global_solid = &p.solid;
                            var symbols = global_solid;

                            var solid = &global_solid.stack;

                            const old_is_in_jsx_component = global_solid.is_in_jsx_component;
                            global_solid.is_in_jsx_component = true;
                            defer global_solid.is_in_jsx_component = old_is_in_jsx_component;

                            if (!old_is_in_jsx_component) {
                                solid.current_template_string.reset();
                                solid.buffered_writer.pos = 0;
                                solid.component_body.clearRetainingCapacity();
                                solid.component_body_decls.clearRetainingCapacity();

                                // prepend an empty statement
                                // this will later become an S.Local for the decls
                                solid.component_body.append(p.allocator, p.s(S.Empty{}, expr.loc)) catch unreachable;

                                solid.last_element_id = E.Identifier{};
                                solid.prev_scope = p.current_scope;
                                solid.temporary_scope.reset();
                                solid.node_count = 0;
                                solid.temporary_scope.kind = .function_body;
                                solid.temporary_scope.parent = p.current_scope;

                                solid.last_template_id.ref = Ref.None;
                            }

                            var writer = &solid.buffered_writer;

                            // The JSX tag used
                            const tag: Expr = tagger: {
                                if (e_.tag) |_tag| {
                                    break :tagger p.visitExpr(_tag);
                                } else {
                                    break :tagger p.e(E.Array{}, expr.loc);
                                }
                            };

                            const jsx_props = e_.properties.slice();

                            var template_expression = Expr{ .loc = expr.loc, .data = .{ .e_identifier = solid.last_template_id } };
                            var element: ?E.Identifier = null;
                            var needs_end_bracket = false;
                            var children = e_.children.slice();
                            defer {
                                if (old_is_in_jsx_component) {
                                    if (element) |el| {
                                        solid.last_element_id = el;
                                    }
                                }
                            }
                            switch (tag.data) {
                                .e_string => {
                                    // write the template
                                    _ = writer.writeAll("<") catch unreachable;
                                    _ = writer.writeString(tag.data.e_string) catch unreachable;
                                    needs_end_bracket = true;

                                    for (jsx_props) |*property, i| {
                                        if (property.kind != .spread) {
                                            property.key = p.visitExpr(e_.properties.ptr[i].key.?);
                                        }

                                        if (property.value != null) {
                                            property.value = p.visitExpr(e_.properties.ptr[i].value.?);

                                            if (property.kind != .spread) {
                                                var key = property.key.?.data.e_string;

                                                const transform: SolidJS.ExpressionTransform =
                                                    if (key.isUTF8())
                                                    SolidJS.ExpressionTransform.which(key.slice(p.allocator))
                                                else
                                                    SolidJS.ExpressionTransform{ .setAttribute = {} };

                                                const primitive = @as(Expr.Tag, property.value.?.data);
                                                const is_dynamic = switch (primitive) {
                                                    .e_string, .e_number, .e_boolean, .e_null, .e_undefined => false,
                                                    else => true,
                                                };
                                                do_transform: {
                                                    var out: Expr = p.e(E.Missing{}, expr.loc);
                                                    var needs_wrap = false;
                                                    if (is_dynamic) {
                                                        if (template_expression.data.e_identifier.ref.isNull()) {
                                                            var new_template_name = global_solid.generateTemplateName(p.allocator);
                                                            // declare the template in the module scope
                                                            solid.prev_scope = p.current_scope;
                                                            p.current_scope = p.module_scope;
                                                            solid.last_template_id = .{
                                                                .ref = p.declareSymbolMaybeGenerated(.other, expr.loc, new_template_name, true) catch unreachable,
                                                                .can_be_removed_if_unused = true,
                                                                .call_can_be_unwrapped_if_unused = true,
                                                            };
                                                            p.current_scope = solid.prev_scope.?;
                                                            template_expression = .{ .loc = expr.loc, .data = .{ .e_identifier = solid.last_template_id } };
                                                        }

                                                        if (element == null) {
                                                            element = global_solid.generateElement(
                                                                p,
                                                                template_expression,
                                                                property.value.?.loc,
                                                            ) catch unreachable;
                                                        }
                                                    }

                                                    if (!is_dynamic and (transform == .class or transform == .style or transform == .setAttribute)) {
                                                        switch (transform) {
                                                            .class => {
                                                                switch (property.value.?.data) {
                                                                    .e_string => |str| {
                                                                        if (str.len() == 0) break :do_transform;
                                                                        _ = writer.writeAll(" class=\"") catch unreachable;
                                                                        _ = writer.writeHTMLAttributeValueString(str) catch unreachable;
                                                                        _ = writer.writeAll("\"") catch unreachable;
                                                                    },
                                                                    .e_number => |num| {
                                                                        writer.writer().print(" class={d}", .{num.value}) catch unreachable;
                                                                    },
                                                                    else => {},
                                                                }
                                                            },
                                                            .setAttribute => {
                                                                _ = writer.writeAll(" ") catch unreachable;
                                                                _ = writer.writeString(property.key.?.data.e_string) catch unreachable;

                                                                switch (property.value.?.data) {
                                                                    .e_string => |str| {
                                                                        if (str.len() == 0) break :do_transform;
                                                                        _ = writer.writeAll("=\"") catch unreachable;
                                                                        _ = writer.writeHTMLAttributeValueString(str) catch unreachable;
                                                                        _ = writer.writeAll("\"") catch unreachable;
                                                                    },
                                                                    .e_number => |num| {
                                                                        writer.writer().print("={d}", .{num.value}) catch unreachable;
                                                                    },
                                                                    else => {},
                                                                }
                                                            },
                                                            .style => {},
                                                            else => unreachable,
                                                        }
                                                    } else {
                                                        switch (transform) {
                                                            .nativeEvent, .nativeEventCaptured => {
                                                                var args = p.allocator.alloc(Expr, 2 + @as(usize, @boolToInt(transform == .nativeEventCaptured))) catch unreachable;

                                                                // on:MyEvent => MyEvent
                                                                property.key.?.data.e_string.data = property.key.?.data.e_string.data[3..];

                                                                args[0] = property.key.?;
                                                                args[1] = property.value.?;

                                                                if (transform == .nativeEventCaptured) {
                                                                    args[2] = p.e(E.Boolean{ .value = true }, property.key.?.loc);
                                                                }
                                                                // $element.addEventListener("MyEvent", (e) => { ... });
                                                                out = p.e(
                                                                    E.Call{
                                                                        .target = p.e(
                                                                            E.Dot{
                                                                                .target = p.e(
                                                                                    element.?,
                                                                                    expr.loc,
                                                                                ),
                                                                                .name = "addEventListener",
                                                                                .name_loc = property.key.?.loc,
                                                                            },
                                                                            property.key.?.loc,
                                                                        ),
                                                                        .args = ExprNodeList.init(args),
                                                                    },
                                                                    property.key.?.loc,
                                                                );

                                                                p.recordUsage(element.?.ref);
                                                            },
                                                            .style => {},
                                                            .class, .setAttribute => {
                                                                var args = p.allocator.alloc(Expr, 4) catch unreachable;
                                                                args[0] = p.e(element.?, expr.loc);
                                                                args[1] = property.key.?;
                                                                args[2] = property.value.?;

                                                                // setAttribute(template_expression, key, value);
                                                                out = p.e(
                                                                    E.Call{
                                                                        .target = p.e(
                                                                            E.Identifier{
                                                                                .ref = symbols.setAttribute.ref,
                                                                                .can_be_removed_if_unused = false,
                                                                                .call_can_be_unwrapped_if_unused = false,
                                                                            },
                                                                            property.value.?.loc,
                                                                        ),
                                                                        .args = ExprNodeList.init(args[0..3]),
                                                                    },
                                                                    property.key.?.loc,
                                                                );

                                                                p.recordUsage(symbols.setAttribute.ref);
                                                                if (args[2].data == .e_identifier or args[2].data == .e_import_identifier) {
                                                                    if (args[2].data == .e_identifier) p.recordUsage(args[2].data.e_identifier.ref);
                                                                    if (args[2].data == .e_import_identifier) p.recordUsage(args[2].data.e_import_identifier.ref);
                                                                } else {
                                                                    needs_wrap = true;
                                                                }
                                                            },
                                                            .event => |event| {
                                                                out = p.e(
                                                                    E.Binary{
                                                                        .left = p.e(E.Dot{
                                                                            .target = p.e(element.?, property.key.?.loc),
                                                                            .name = event.setter(),
                                                                            .name_loc = property.key.?.loc,
                                                                        }, property.key.?.loc),
                                                                        .op = js_ast.Op.Code.bin_assign,
                                                                        .right = property.value.?,
                                                                    },
                                                                    property.key.?.loc,
                                                                );
                                                                needs_wrap = switch (property.value.?.data) {
                                                                    .e_arrow, .e_function => false,
                                                                    else => true,
                                                                };
                                                                global_solid.events_to_delegate.insert(event);
                                                            },
                                                        }

                                                        var stmt: Stmt = undefined;

                                                        if (needs_wrap) {
                                                            var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                                                            stmts[0] = p.s(S.Return{ .value = out }, property.value.?.loc);
                                                            var args = p.allocator.alloc(Expr, 1) catch unreachable;
                                                            args[0] = p.e(
                                                                E.Arrow{
                                                                    .args = &[_]G.Arg{},
                                                                    .body = G.FnBody{
                                                                        .stmts = stmts,
                                                                        .loc = out.loc,
                                                                    },
                                                                },
                                                                property.value.?.loc,
                                                            );
                                                            stmt = p.s(S.SExpr{
                                                                .value = p.e(
                                                                    E.Call{
                                                                        .target = p.e(
                                                                            E.Identifier{
                                                                                .ref = symbols.effect.ref,
                                                                            },
                                                                            property.value.?.loc,
                                                                        ),
                                                                        .args = ExprNodeList.init(args),
                                                                    },
                                                                    property.value.?.loc,
                                                                ),
                                                            }, property.value.?.loc);
                                                            p.recordUsage(symbols.effect.ref);
                                                        } else {
                                                            stmt = p.s(S.SExpr{
                                                                .value = out,
                                                            }, property.value.?.loc);
                                                        }

                                                        solid.component_body.append(p.allocator, stmt) catch unreachable;
                                                    }
                                                }
                                            }
                                        }

                                        if (property.initializer != null) {
                                            property.initializer = p.visitExpr(e_.properties.ptr[i].initializer.?);
                                        }
                                    }

                                    const start_node_count = solid.node_count;
                                    for (children) |*el, k| {
                                        if (needs_end_bracket and el.data == .e_jsx_element) {
                                            _ = writer.writeAll(">") catch unreachable;
                                            solid.node_count += 1;

                                            needs_end_bracket = false;
                                        }

                                        const child = p.visitExpr(el.*);
                                        switch (child.data) {
                                            // skip it
                                            .e_missing => {},

                                            // we need to serialize it to HTML
                                            // it's probably a text node
                                            .e_string => |str| {
                                                if (str.len() > 0) {
                                                    if (needs_end_bracket) {
                                                        _ = writer.writeAll(">") catch unreachable;
                                                        solid.node_count += 1;
                                                        needs_end_bracket = false;
                                                    }
                                                    writer.writeHTMLAttributeValueString(str) catch unreachable;
                                                }
                                            },
                                            .e_number => |str| {
                                                if (needs_end_bracket) {
                                                    _ = writer.writeAll(">") catch unreachable;
                                                    needs_end_bracket = false;
                                                }
                                                writer.writer().print("{d}", .{str.value}) catch unreachable;
                                            },

                                            // debug assertion that we don't get here
                                            .e_jsx_element => unreachable,

                                            else => {
                                                if (template_expression.data.e_identifier.ref.isNull()) {
                                                    var new_template_name = global_solid.generateTemplateName(p.allocator);
                                                    // declare the template in the module scope
                                                    p.current_scope = p.module_scope;
                                                    solid.last_template_id = .{
                                                        .ref = p.declareSymbolMaybeGenerated(.other, expr.loc, new_template_name, true) catch unreachable,
                                                        .can_be_removed_if_unused = true,
                                                        .call_can_be_unwrapped_if_unused = true,
                                                    };
                                                    p.current_scope = solid.prev_scope.?;
                                                    template_expression = .{ .loc = expr.loc, .data = .{ .e_identifier = solid.last_template_id } };
                                                }
                                                p.recordUsage(symbols.insert.ref);
                                                p.recordUsage(template_expression.data.e_identifier.ref);
                                                var args = p.allocator.alloc(Expr, 3) catch unreachable;
                                                args[0..3].* = .{
                                                    template_expression,
                                                    child,
                                                    if (k != children.len - 1 and !solid.last_element_id.ref.eql(Ref.None))
                                                        p.e(solid.last_element_id, expr.loc)
                                                    else
                                                        p.e(E.Null{}, expr.loc),
                                                };
                                                solid.node_count += 1;
                                                solid.component_body.append(
                                                    p.allocator,
                                                    p.s(
                                                        S.SExpr{
                                                            .value = p.e(
                                                                E.Call{
                                                                    .target = p.e(E.ImportIdentifier{ .ref = symbols.insert.ref }, child.loc),
                                                                    .args = ExprNodeList.init(args),
                                                                },
                                                                child.loc,
                                                            ),
                                                        },
                                                        child.loc,
                                                    ),
                                                ) catch unreachable;
                                            },
                                        }
                                    }

                                    if (start_node_count != solid.node_count) {
                                        solid.node_count += 1;
                                        _ = writer.writeAll("</") catch unreachable;
                                        _ = writer.writeString(tag.data.e_string) catch unreachable;
                                        _ = writer.writeAll(">") catch unreachable;
                                    } else if (needs_end_bracket) {
                                        _ = writer.writeAll("/>") catch unreachable;
                                    }

                                    // this is the root of a template tag, we just finished
                                    // <div>
                                    // /* some stuff in here */
                                    // </div>
                                    //  ^
                                    // we are here!
                                    if (!old_is_in_jsx_component) {
                                        if (p.is_control_flow_dead) {
                                            solid.node_count = 0;
                                            return p.e(E.Missing{}, expr.loc);
                                        }

                                        var hash: u64 = 0;
                                        // we are done, so it's time to turn our template into a string we can write
                                        // note that we are writing as UTF-8 but the input may be UTF-16 or UTF-8, depending.
                                        if (writer.pos == 0 and writer.context.list.items.len == 0) {} else if (writer.pos < writer.buffer.len and writer.context.list.items.len == 0) {
                                            hash = std.hash.Wyhash.hash(0, writer.buffer[0..writer.pos]);
                                        } else {
                                            var hasher = std.hash.Wyhash.init(0);
                                            hasher.update(writer.context.list.items);
                                            hasher.update(writer.buffer[0..writer.pos]);
                                            hash = hasher.final();
                                        }

                                        var gpe = global_solid.template_decls.getOrPut(p.allocator, @truncate(u32, hash)) catch unreachable;

                                        if (template_expression.data.e_identifier.ref.isNull()) {
                                            var new_template_name = global_solid.generateTemplateName(p.allocator);
                                            // declare the template in the module scope
                                            p.current_scope = p.module_scope;
                                            solid.last_template_id = .{
                                                .ref = p.declareSymbolMaybeGenerated(.other, expr.loc, new_template_name, true) catch unreachable,
                                                .can_be_removed_if_unused = true,
                                                .call_can_be_unwrapped_if_unused = true,
                                            };
                                            p.current_scope = solid.prev_scope.?;
                                            template_expression = .{ .loc = expr.loc, .data = .{ .e_identifier = solid.last_template_id } };
                                        }

                                        if (!gpe.found_existing) {
                                            var args = p.allocator.alloc(Expr, 2) catch unreachable;

                                            if (writer.pos == 0 and writer.context.list.items.len == 0) {
                                                args[0] = p.e(E.String.init(""), expr.loc);
                                            } else if (writer.pos < writer.buffer.len and writer.context.list.items.len == 0) {
                                                args[0] = p.e(E.String.init(p.allocator.dupe(u8, writer.buffer[0..writer.pos]) catch unreachable), expr.loc);
                                            } else {
                                                const total = writer.context.list.items.len + writer.pos;
                                                var buffer = p.allocator.alloc(u8, total) catch unreachable;
                                                @memcpy(buffer.ptr, writer.context.list.items.ptr, writer.context.list.items.len);
                                                @memcpy(buffer.ptr + writer.context.list.items.len, &writer.buffer, writer.buffer.len);
                                                args[0] = p.e(E.String.init(buffer), expr.loc);
                                            }

                                            args[1] = p.e(E.Number{ .value = @intToFloat(f64, solid.node_count) }, expr.loc);
                                            solid.node_count = 0;

                                            gpe.value_ptr.* = G.Decl{
                                                .binding = p.b(B.Identifier{ .ref = template_expression.data.e_identifier.ref }, template_expression.loc),
                                                .value = p.e(
                                                    E.Call{
                                                        .args = ExprNodeList.init(args),
                                                        .target = p.e(
                                                            E.ImportIdentifier{
                                                                .ref = symbols.template.ref,
                                                            },
                                                            expr.loc,
                                                        ),
                                                        .can_be_unwrapped_if_unused = true,
                                                    },
                                                    template_expression.loc,
                                                ),
                                            };
                                        } else {
                                            // link the template to the existing decl
                                            // this will cause the printer to use the existing template
                                            p.symbols.items[template_expression.data.e_identifier.ref.innerIndex()].link = gpe.value_ptr.binding.data.b_identifier.ref;
                                        }
                                        p.recordUsage(symbols.template.ref);

                                        // 1 means it was actually static
                                        // that means we can just turn it into a single $template.cloneNode(true)
                                        if (solid.component_body.items.len == 1) {
                                            return p.e(E.Call{
                                                .target = p.e(
                                                    E.Dot{
                                                        .name = "cloneNode",
                                                        .name_loc = expr.loc,
                                                        .target = template_expression,
                                                        .can_be_removed_if_unused = true,
                                                        .call_can_be_unwrapped_if_unused = true,
                                                    },
                                                    template_expression.loc,
                                                ),
                                                .args = ExprNodeList.init(true_args),
                                                .can_be_unwrapped_if_unused = true,
                                            }, expr.loc);
                                        }
                                        if (solid.component_body_decls.items.len == 0) {
                                            solid.component_body_decls.ensureTotalCapacityPrecise(p.allocator, 1) catch unreachable;
                                            solid.component_body_decls.appendAssumeCapacity(G.Decl{
                                                .binding = p.b(B.Identifier{ .ref = solid.last_template_id.ref }, expr.loc),
                                                .value = p.e(E.Call{
                                                    .target = p.e(
                                                        E.Dot{
                                                            .name = "cloneNode",
                                                            .name_loc = expr.loc,
                                                            .target = template_expression,
                                                            .can_be_removed_if_unused = true,
                                                            .call_can_be_unwrapped_if_unused = true,
                                                        },
                                                        template_expression.loc,
                                                    ),
                                                    .args = ExprNodeList.init(true_args),
                                                    .can_be_unwrapped_if_unused = true,
                                                }, expr.loc),
                                            });
                                        }

                                        // we need to wrap the template in a function
                                        const ret = p.e(E.Identifier{ .ref = solid.component_body_decls.items[0].binding.data.b_identifier.ref }, expr.loc);
                                        solid.component_body.items[0] = p.s(S.Local{ .decls = solid.component_body_decls.toOwnedSlice(p.allocator) }, expr.loc);
                                        solid.component_body.append(p.allocator, p.s(S.Return{ .value = ret }, expr.loc)) catch unreachable;
                                        return p.e(
                                            E.Arrow{ .args = &[_]G.Arg{}, .body = G.FnBody{ .stmts = solid.component_body.toOwnedSlice(p.allocator), .loc = expr.loc } },
                                            expr.loc,
                                        );
                                        // we don't need to return anything because it's a static element that will live in the template
                                    } else {
                                        return p.e(E.Missing{}, expr.loc);
                                    }
                                },
                                .e_dot, .e_import_identifier, .e_identifier => {
                                    var out_props = p.allocator.alloc(G.Property, jsx_props.len + @as(usize, @boolToInt(e_.key != null)) + @as(usize, @boolToInt(e_.children.len > 0))) catch unreachable;
                                    var out_props_i: usize = 0;
                                    for (jsx_props) |property, i| {
                                        if (property.kind != .spread) {
                                            e_.properties.ptr[i].key = p.visitExpr(e_.properties.ptr[i].key.?);
                                        }

                                        if (property.value != null) {
                                            e_.properties.ptr[i].value = p.visitExpr(e_.properties.ptr[i].value.?);
                                        }

                                        if (property.initializer != null) {
                                            e_.properties.ptr[i].initializer = p.visitExpr(e_.properties.ptr[i].initializer.?);
                                        }

                                        if (property.kind != .spread) {
                                            const kind = if (property.value.?.data == .e_arrow or property.value.?.data == .e_function)
                                                G.Property.Kind.get
                                            else
                                                G.Property.Kind.normal;

                                            out_props[out_props_i] = G.Property{
                                                .key = property.key,
                                                .value = if (kind != .get)
                                                    property.value.?
                                                else
                                                    property.value.?.wrapInArrow(p.allocator) catch unreachable,

                                                .kind = kind,
                                            };
                                            out_props_i += 1;
                                        }
                                    }

                                    if (e_.key) |k| {
                                        const key = p.visitExpr(k);
                                        if (key.data != .e_missing) {
                                            const kind = if (key.data == .e_arrow or key.data == .e_function)
                                                Property.Kind.get
                                            else
                                                Property.Kind.normal;

                                            out_props[out_props_i] = G.Property{
                                                .key = p.e(Prefill.String.Key, k.loc),
                                                .value = key,
                                                .kind = kind,
                                            };
                                            out_props_i += 1;
                                        }
                                    }

                                    var out_child_i: usize = 0;
                                    for (children) |child, j| {
                                        children[j] = p.visitExpr(child);
                                        if (children[j].data != .e_missing) {
                                            children[out_child_i] = children[j];
                                            out_child_i += 1;
                                        }
                                    }

                                    if (out_child_i > 0) {
                                        const kind = Property.Kind.get;

                                        out_props[out_props_i] = G.Property{
                                            .key = p.e(Prefill.String.Children, expr.loc),
                                            .value = p.e(E.Array{ .items = ExprNodeList.init(children[0..out_child_i]) }, expr.loc),
                                            .kind = kind,
                                        };
                                        out_props_i += 1;
                                    }

                                    var args = p.allocator.alloc(Expr, 2) catch unreachable;
                                    args[0] = tag;
                                    args[1] = p.e(E.Object{
                                        .properties = G.Property.List.init(out_props[0..out_props_i]),
                                    }, expr.loc);
                                    p.recordUsage(symbols.createComponent.ref);
                                    return p.e(
                                        E.Call{
                                            .target = p.e(E.ImportIdentifier{ .ref = symbols.createComponent.ref }, expr.loc),
                                            .args = ExprNodeList.init(args),
                                            .close_paren_loc = e_.close_tag_loc,
                                        },
                                        expr.loc,
                                    );
                                },
                                .e_array => {},
                                else => unreachable,
                            }
                        },
                        .react => {
                            const tag: Expr = tagger: {
                                if (e_.tag) |_tag| {
                                    break :tagger p.visitExpr(_tag);
                                } else {
                                    break :tagger p.jsxRefToMemberExpression(expr.loc, p.jsx_fragment.ref);
                                }
                            };

                            const jsx_props = e_.properties.slice();
                            for (jsx_props) |property, i| {
                                if (property.kind != .spread) {
                                    e_.properties.ptr[i].key = p.visitExpr(e_.properties.ptr[i].key.?);
                                }

                                if (property.value != null) {
                                    e_.properties.ptr[i].value = p.visitExpr(e_.properties.ptr[i].value.?);
                                }

                                if (property.initializer != null) {
                                    e_.properties.ptr[i].initializer = p.visitExpr(e_.properties.ptr[i].initializer.?);
                                }
                            }

                            if (e_.key) |key| {
                                e_.key = p.visitExpr(key);
                            }

                            const runtime = if (p.options.jsx.runtime == .automatic and !e_.flags.contains(.is_key_before_rest)) options.JSX.Runtime.automatic else options.JSX.Runtime.classic;
                            var children_count = e_.children.len;

                            const is_childless_tag = FeatureFlags.react_specific_warnings and children_count > 0 and
                                tag.data == .e_string and tag.data.e_string.isUTF8() and js_lexer.ChildlessJSXTags.has(tag.data.e_string.slice(p.allocator));

                            children_count = if (is_childless_tag) 0 else children_count;

                            if (children_count != e_.children.len) {
                                // Error: meta is a void element tag and must neither have `children` nor use `dangerouslySetInnerHTML`.
                                // ^ from react-dom
                                p.log.addWarningFmt(
                                    p.source,
                                    tag.loc,
                                    p.allocator,
                                    "<{s} /> is a void element and must not have \"children\"",
                                    .{tag.data.e_string.slice(p.allocator)},
                                ) catch {};
                            }

                            // TODO: maybe we should split these into two different AST Nodes
                            // That would reduce the amount of allocations a little
                            switch (runtime) {
                                .classic => {
                                    // Arguments to createElement()
                                    const args = p.allocator.alloc(Expr, 2 + children_count) catch unreachable;
                                    // There are at least two args:
                                    // - name of the tag
                                    // - props
                                    var i: usize = 1;
                                    args[0] = tag;
                                    if (e_.properties.len > 0) {
                                        if (e_.key) |key| {
                                            var props = p.allocator.alloc(G.Property, e_.properties.len + 1) catch unreachable;
                                            std.mem.copy(G.Property, props, e_.properties.slice());
                                            props[props.len - 1] = G.Property{ .key = Expr{ .loc = key.loc, .data = keyExprData }, .value = key };
                                            args[1] = p.e(E.Object{ .properties = G.Property.List.init(props) }, expr.loc);
                                        } else {
                                            args[1] = p.e(E.Object{ .properties = e_.properties }, expr.loc);
                                        }
                                        i = 2;
                                    } else {
                                        args[1] = p.e(E.Null{}, expr.loc);
                                        i = 2;
                                    }

                                    const children_elements = e_.children.slice()[0..children_count];
                                    for (children_elements) |child| {
                                        args[i] = p.visitExpr(child);
                                        i += @intCast(usize, @boolToInt(args[i].data != .e_missing));
                                    }

                                    // Call createElement()
                                    return p.e(E.Call{
                                        .target = p.jsxRefToMemberExpression(expr.loc, p.jsx_factory.ref),
                                        .args = ExprNodeList.init(args[0..i]),
                                        // Enable tree shaking
                                        .can_be_unwrapped_if_unused = !p.options.ignore_dce_annotations,
                                        .close_paren_loc = e_.close_tag_loc,
                                    }, expr.loc);
                                },
                                // function jsxDEV(type, config, maybeKey, source, self) {
                                .automatic => {
                                    // --- These must be done in all cases --
                                    const allocator = p.allocator;
                                    var props = e_.properties.list();
                                    // arguments needs to be like
                                    // {
                                    //    ...props,
                                    //    children: [el1, el2]
                                    // }

                                    {
                                        var last_child: u32 = 0;
                                        var children = e_.children.slice()[0..children_count];
                                        for (children) |child| {
                                            e_.children.ptr[last_child] = p.visitExpr(child);
                                            // if tree-shaking removes the element, we must also remove it here.
                                            last_child += @intCast(u32, @boolToInt(e_.children.ptr[last_child].data != .e_missing));
                                        }
                                        e_.children.len = last_child;
                                    }

                                    const children_key = Expr{ .data = jsxChildrenKeyData, .loc = expr.loc };

                                    // Optimization: if the only non-child prop is a spread object
                                    // we can just pass the object as the first argument
                                    // this goes as deep as there are spreads
                                    // <div {{...{...{...{...foo}}}}} />
                                    // ->
                                    // <div {{...foo}} />
                                    // jsx("div", {...foo})
                                    while (props.items.len == 1 and props.items[0].kind == .spread and props.items[0].value.?.data == .e_object) {
                                        props = props.items[0].value.?.data.e_object.properties.list();
                                    }

                                    // Babel defines static jsx as children.len > 1
                                    const is_static_jsx = e_.children.len > 1;

                                    // if (p.options.jsx.development) {
                                    switch (e_.children.len) {
                                        0 => {},
                                        1 => {
                                            props.append(allocator, G.Property{
                                                .key = children_key,
                                                .value = e_.children.ptr[0],
                                            }) catch unreachable;
                                        },
                                        else => {
                                            props.append(allocator, G.Property{
                                                .key = children_key,
                                                .value = p.e(E.Array{
                                                    .items = e_.children,
                                                    .is_single_line = e_.children.len < 2,
                                                }, e_.close_tag_loc),
                                            }) catch unreachable;
                                        },
                                    }
                                    // --- These must be done in all cases --

                                    // Trivial elements can be inlined, removing the call to createElement or jsx()
                                    if (p.options.features.jsx_optimization_inline and e_.flags.contains(.can_be_inlined)) {
                                        // The output object should look like this:
                                        // https://babeljs.io/repl/#?browsers=defaults%2C%20not%20ie%2011%2C%20not%20ie_mob%2011&build=&builtIns=false&corejs=false&spec=false&loose=false&code_lz=FAMwrgdgxgLglgewgAgLIE8DCCC2AHJAUwhgAoBvAIwEMAvAXwEplzhl3kAnQmMTlADwAxBAmQA-AIwAmAMxsOAFgCsANgEB6EQnEBuYPWBA&debug=false&forceAllTransforms=false&shippedProposals=true&circleciRepo=&evaluate=false&fileSize=true&timeTravel=false&sourceType=module&lineWrap=true&presets=react%2Ctypescript&prettier=true&targets=&version=7.18.4&externalPlugins=%40babel%2Fplugin-transform-flow-strip-types%407.16.7%2C%40babel%2Fplugin-transform-react-inline-elements%407.16.7&assumptions=%7B%22arrayLikeIsIterable%22%3Atrue%2C%22constantReexports%22%3Atrue%2C%22constantSuper%22%3Atrue%2C%22enumerableModuleMeta%22%3Atrue%2C%22ignoreFunctionLength%22%3Atrue%2C%22ignoreToPrimitiveHint%22%3Atrue%2C%22mutableTemplateObject%22%3Atrue%2C%22iterableIsArray%22%3Atrue%2C%22noClassCalls%22%3Atrue%2C%22noNewArrows%22%3Atrue%2C%22noDocumentAll%22%3Atrue%2C%22objectRestNoSymbols%22%3Atrue%2C%22privateFieldsAsProperties%22%3Atrue%2C%22pureGetters%22%3Atrue%2C%22setComputedProperties%22%3Atrue%2C%22setClassMethods%22%3Atrue%2C%22setSpreadProperties%22%3Atrue%2C%22setPublicClassFields%22%3Atrue%2C%22skipForOfIteratorClosing%22%3Atrue%2C%22superIsCallableConstructor%22%3Atrue%7D
                                        // return {
                                        //     $$typeof: REACT_ELEMENT_TYPE,
                                        //     type: type,
                                        //     key: void 0 === key ? null : "" + key,
                                        //     ref: null,
                                        //     props: props,
                                        //     _owner: null
                                        // };
                                        //
                                        p.recordUsage(p.react_element_type.ref);
                                        const key = if (e_.key) |key_| brk: {
                                            // key: void 0 === key ? null : "" + key,
                                            break :brk switch (key_.data) {
                                                .e_string => break :brk key_,
                                                .e_undefined, .e_null => p.e(E.Null{}, key_.loc),
                                                else => p.e(E.If{
                                                    .test_ = p.e(E.Binary{
                                                        .left = p.e(E.Undefined{}, key_.loc),
                                                        .op = Op.Code.bin_strict_eq,
                                                        .right = key_,
                                                    }, key_.loc),
                                                    .yes = p.e(E.Null{}, key_.loc),
                                                    .no = p.e(
                                                        E.Binary{
                                                            .op = Op.Code.bin_add,
                                                            .left = p.e(&E.String.empty, key_.loc),
                                                            .right = key_,
                                                        },
                                                        key_.loc,
                                                    ),
                                                }, key_.loc),
                                            };
                                        } else p.e(E.Null{}, expr.loc);
                                        var jsx_element = p.allocator.alloc(G.Property, 6) catch unreachable;
                                        const props_object = p.e(
                                            E.Object{
                                                .properties = G.Property.List.fromList(props),
                                                .close_brace_loc = e_.close_tag_loc,
                                            },
                                            expr.loc,
                                        );
                                        var props_expression = props_object;

                                        // we must check for default props
                                        if (tag.data != .e_string) {
                                            // We assume defaultProps is supposed to _not_ have side effects
                                            // We do not support "key" or "ref" in defaultProps.
                                            const defaultProps = p.e(E.Dot{
                                                .name = "defaultProps",
                                                .name_loc = tag.loc,
                                                .target = tag,
                                                .can_be_removed_if_unused = true,
                                            }, tag.loc);
                                            // props: MyComponent.defaultProps || {}
                                            if (props.items.len == 0) {
                                                props_expression = p.e(E.Binary{ .op = Op.Code.bin_logical_or, .left = defaultProps, .right = props_object }, defaultProps.loc);
                                            } else {
                                                var call_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                                call_args[0..2].* = .{
                                                    props_object,
                                                    defaultProps,
                                                };
                                                // __merge(props, MyComponent.defaultProps)
                                                // originally, we always inlined here
                                                // see https://twitter.com/jarredsumner/status/1534084541236686848
                                                // but, that breaks for defaultProps
                                                // we assume that most components do not have defaultProps
                                                // so __merge quickly checks if it needs to merge any props
                                                // and if not, it passes along the props object
                                                // this skips an extra allocation
                                                props_expression = p.callRuntime(tag.loc, "__merge", call_args);
                                            }
                                        }

                                        jsx_element[0..6].* =
                                            [_]G.Property{
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"$$typeof", .loc = tag.loc },
                                                .value = p.e(
                                                    E.Identifier{
                                                        .ref = p.react_element_type.ref,
                                                        .can_be_removed_if_unused = true,
                                                    },
                                                    tag.loc,
                                                ),
                                            },
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"type", .loc = tag.loc },
                                                .value = tag,
                                            },
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"key", .loc = key.loc },
                                                .value = key,
                                            },
                                            // this is a de-opt
                                            // any usage of ref should make it impossible for this code to be reached
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"ref", .loc = expr.loc },
                                                .value = p.e(E.Null{}, expr.loc),
                                            },
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"props", .loc = expr.loc },
                                                .value = props_expression,
                                            },
                                            G.Property{
                                                .key = Expr{ .data = Prefill.Data.@"_owner", .loc = key.loc },
                                                .value = p.e(
                                                    E.Null{},
                                                    expr.loc,
                                                ),
                                            },
                                        };

                                        const output = p.e(
                                            E.Object{
                                                .properties = G.Property.List.init(jsx_element),
                                                .close_brace_loc = e_.close_tag_loc,
                                            },
                                            expr.loc,
                                        );

                                        return output;
                                    } else {
                                        // -- The typical jsx automatic transform happens here --

                                        // Either:
                                        // jsxDEV(type, arguments, key, isStaticChildren, source, self)
                                        // jsx(type, arguments, key)
                                        const include_filename = FeatureFlags.include_filename_in_jsx and p.options.jsx.development;
                                        const args = p.allocator.alloc(Expr, if (p.options.jsx.development) @as(usize, 6) else @as(usize, 2) + @as(usize, @boolToInt(e_.key != null))) catch unreachable;
                                        args[0] = tag;

                                        args[1] = p.e(E.Object{
                                            .properties = G.Property.List.fromList(props),
                                        }, expr.loc);

                                        if (e_.key) |key| {
                                            args[2] = key;
                                        } else if (p.options.jsx.development) {
                                            // if (maybeKey !== undefined)
                                            args[2] = Expr{
                                                .loc = expr.loc,
                                                .data = .{
                                                    .e_undefined = E.Undefined{},
                                                },
                                            };
                                        }

                                        if (p.options.jsx.development) {
                                            // is the return type of the first child an array?
                                            // It's dynamic
                                            // Else, it's static
                                            args[3] = Expr{
                                                .loc = expr.loc,
                                                .data = .{
                                                    .e_boolean = .{
                                                        .value = is_static_jsx,
                                                    },
                                                },
                                            };

                                            if (include_filename) {
                                                var source = p.allocator.alloc(G.Property, 2) catch unreachable;
                                                p.recordUsage(p.jsx_filename.ref);
                                                source[0] = G.Property{
                                                    .key = Expr{ .loc = expr.loc, .data = Prefill.Data.Filename },
                                                    .value = p.e(E.Identifier{
                                                        .ref = p.jsx_filename.ref,
                                                        .can_be_removed_if_unused = true,
                                                    }, expr.loc),
                                                };

                                                source[1] = G.Property{
                                                    .key = Expr{ .loc = expr.loc, .data = Prefill.Data.LineNumber },
                                                    .value = p.e(E.Number{ .value = @intToFloat(f64, expr.loc.start) }, expr.loc),
                                                };

                                                // Officially, they ask for columnNumber. But I don't see any usages of it in the code!
                                                // source[2] = G.Property{
                                                //     .key = Expr{ .loc = expr.loc, .data = Prefill.Data.ColumnNumber },
                                                //     .value = p.e(E.Number{ .value = @intToFloat(f64, expr.loc.start) }, expr.loc),
                                                // };
                                                args[4] = p.e(E.Object{
                                                    .properties = G.Property.List.init(source),
                                                }, expr.loc);

                                                // When disabled, this must specifically be undefined
                                                // Not an empty object
                                                // See this code from react:
                                                // >  if (source !== undefined) {
                                                // >     var fileName = source.fileName.replace(/^.*[\\\/]/, "");
                                                // >     var lineNumber = source.lineNumber;
                                                // >     return "\n\nCheck your code at " + fileName + ":" + lineNumber + ".";
                                                // > }
                                            } else {
                                                args[4] = p.e(E.Undefined{}, expr.loc);
                                            }

                                            args[5] = Expr{ .data = Prefill.Data.This, .loc = expr.loc };
                                        }

                                        return p.e(E.Call{
                                            .target = p.jsxRefToMemberExpressionAutomatic(expr.loc, is_static_jsx),
                                            .args = ExprNodeList.init(args),
                                            // Enable tree shaking
                                            .can_be_unwrapped_if_unused = !p.options.ignore_dce_annotations,
                                            .was_jsx_element = true,
                                            .close_paren_loc = e_.close_tag_loc,
                                        }, expr.loc);
                                    }
                                },
                                else => unreachable,
                            }
                        },
                        else => unreachable,
                    }
                },

                .e_template => |e_| {
                    if (e_.tag) |tag| {
                        e_.tag = p.visitExpr(tag);

                        if (comptime allow_macros) {
                            if (e_.tag.?.data == .e_import_identifier) {
                                const ref = e_.tag.?.data.e_import_identifier.ref;

                                if (p.macro.refs.get(ref)) |import_record_id| {
                                    const name = p.symbols.items[ref.innerIndex()].original_name;
                                    p.ignoreUsage(ref);
                                    if (p.is_control_flow_dead) {
                                        return p.e(E.Undefined{}, e_.tag.?.loc);
                                    }
                                    p.macro_call_count += 1;
                                    const record = &p.import_records.items[import_record_id];
                                    // We must visit it to convert inline_identifiers and record usage
                                    const macro_result = (p.options.macro_context.call(
                                        record.path.text,
                                        p.source.path.sourceDir(),
                                        p.log,
                                        p.source,
                                        record.range,
                                        expr,
                                        &.{},
                                        name,
                                        MacroVisitor,
                                        MacroVisitor{
                                            .p = p,
                                            .loc = expr.loc,
                                        },
                                    ) catch return expr);

                                    if (macro_result.data != .e_template) {
                                        return p.visitExpr(macro_result);
                                    }
                                }
                            }
                        }
                    }

                    for (e_.parts) |*part| {
                        part.value = p.visitExpr(part.value);
                    }
                },

                .inline_identifier => |id| {
                    const ref = p.macro.imports.get(id) orelse {
                        p.panic("Internal error: missing identifier from macro: {d}", .{id});
                    };

                    if (!p.is_control_flow_dead) {
                        p.recordUsage(ref);
                    }

                    return p.e(
                        E.ImportIdentifier{
                            .was_originally_identifier = false,
                            .ref = ref,
                        },
                        expr.loc,
                    );
                },

                .e_binary => |e_| {
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
                                    const r = logger.Range{ .loc = e_.left.loc, .len = @intCast(i32, name.len) };
                                    p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                                }

                                e_.right = p.visitExpr(e_.right);
                                e_.left = .{ .data = .{ .e_private_identifier = private }, .loc = e_.left.loc };

                                // privateSymbolNeedsToBeLowered
                                return expr;
                            }
                        },
                        else => {},
                    }

                    const is_call_target = @as(Expr.Tag, p.call_target) == .e_binary and expr.data.e_binary == p.call_target.e_binary;
                    // const is_stmt_expr = @as(Expr.Tag, p.stmt_expr_value) == .e_binary and expr.data.e_binary == p.stmt_expr_value.e_binary;
                    const was_anonymous_named_expr = p.isAnonymousNamedExpr(e_.right);

                    if (comptime jsx_transform_type == .macro) {
                        if (e_.op == Op.Code.bin_instanceof and (e_.right.data == .e_jsx_element or e_.left.data == .e_jsx_element)) {
                            // foo instanceof <string />
                            // ->
                            // bunJSX.isNodeType(foo, 13)

                            // <string /> instanceof foo
                            // ->
                            // bunJSX.isNodeType(foo, 13)
                            var call_args = p.allocator.alloc(Expr, 2) catch unreachable;
                            call_args[0] = e_.left;
                            call_args[1] = e_.right;

                            if (e_.right.data == .e_jsx_element) {
                                const jsx_element = e_.right.data.e_jsx_element;
                                if (jsx_element.tag) |tag| {
                                    if (tag.data == .e_string) {
                                        const tag_string = tag.data.e_string.slice(p.allocator);
                                        if (js_ast.Macro.JSNode.Tag.names.get(tag_string)) |node_tag| {
                                            call_args[1] = Expr{ .loc = tag.loc, .data = js_ast.Macro.JSNode.Tag.ids.get(node_tag) };
                                        } else {
                                            p.log.addRangeErrorFmt(
                                                p.source,
                                                js_lexer.rangeOfIdentifier(p.source, tag.loc),
                                                p.allocator,
                                                "Invalid JSX tag: \"{s}\"",
                                                .{tag_string},
                                            ) catch unreachable;
                                            return expr;
                                        }
                                    }
                                } else {
                                    call_args[1] = p.visitExpr(call_args[1]);
                                }
                            } else {
                                call_args[1] = p.visitExpr(call_args[1]);
                            }

                            if (e_.left.data == .e_jsx_element) {
                                const jsx_element = e_.left.data.e_jsx_element;
                                if (jsx_element.tag) |tag| {
                                    if (tag.data == .e_string) {
                                        const tag_string = tag.data.e_string.slice(p.allocator);
                                        if (js_ast.Macro.JSNode.Tag.names.get(tag_string)) |node_tag| {
                                            call_args[0] = Expr{ .loc = tag.loc, .data = js_ast.Macro.JSNode.Tag.ids.get(node_tag) };
                                        } else {
                                            p.log.addRangeErrorFmt(
                                                p.source,
                                                js_lexer.rangeOfIdentifier(p.source, tag.loc),
                                                p.allocator,
                                                "Invalid JSX tag: \"{s}\"",
                                                .{tag_string},
                                            ) catch unreachable;
                                            return expr;
                                        }
                                    }
                                } else {
                                    call_args[0] = p.visitExpr(call_args[0]);
                                }
                            } else {
                                call_args[0] = p.visitExpr(call_args[0]);
                            }

                            return p.e(
                                E.Call{
                                    .target = p.e(
                                        E.Dot{
                                            .name = "isNodeType",
                                            .name_loc = expr.loc,
                                            .target = p.e(BunJSX.bun_jsx_identifier, expr.loc),
                                            .can_be_removed_if_unused = true,
                                            .call_can_be_unwrapped_if_unused = true,
                                        },
                                        expr.loc,
                                    ),
                                    .args = ExprNodeList.init(call_args),
                                    .can_be_unwrapped_if_unused = true,
                                },
                                expr.loc,
                            );
                        }
                    }

                    e_.left = p.visitExprInOut(e_.left, ExprIn{
                        .assign_target = e_.op.binaryAssignTarget(),
                    });

                    // Mark the control flow as dead if the branch is never taken
                    switch (e_.op) {
                        .bin_logical_or => {
                            const side_effects = SideEffects.toBoolean(e_.left.data);
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
                            const side_effects = SideEffects.toBoolean(e_.left.data);
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
                            const side_effects = SideEffects.toNullOrUndefined(e_.left.data);
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
                            // notimpl();
                        },
                        .bin_loose_eq => {
                            const equality = e_.left.data.eql(e_.right.data);
                            if (equality.ok) {
                                return p.e(
                                    E.Boolean{ .value = equality.equal },
                                    expr.loc,
                                );
                            }

                            // const after_op_loc = locAfterOp(e_.);
                            // TODO: warn about equality check
                            // TODO: warn about typeof string

                        },
                        .bin_strict_eq => {
                            const equality = e_.left.data.eql(e_.right.data);
                            if (equality.ok) {
                                return p.e(E.Boolean{ .value = equality.equal }, expr.loc);
                            }

                            // const after_op_loc = locAfterOp(e_.);
                            // TODO: warn about equality check
                            // TODO: warn about typeof string
                        },
                        .bin_loose_ne => {
                            const equality = e_.left.data.eql(e_.right.data);
                            if (equality.ok) {
                                return p.e(E.Boolean{ .value = !equality.equal }, expr.loc);
                            }
                            // const after_op_loc = locAfterOp(e_.);
                            // TODO: warn about equality check
                            // TODO: warn about typeof string

                            // "x != void 0" => "x != null"
                            if (@as(Expr.Tag, e_.right.data) == .e_undefined) {
                                e_.right = p.e(E.Null{}, e_.right.loc);
                            }
                        },
                        .bin_strict_ne => {
                            const equality = e_.left.data.eql(e_.right.data);
                            if (equality.ok) {
                                return p.e(E.Boolean{ .value = !equality.equal }, expr.loc);
                            }
                        },
                        .bin_nullish_coalescing => {
                            const nullorUndefined = SideEffects.toNullOrUndefined(e_.left.data);
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
                            const side_effects = SideEffects.toBoolean(e_.left.data);
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
                            const side_effects = SideEffects.toBoolean(e_.left.data);
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

                            // TODO:
                            // "(1 && fn)()" => "fn()"
                            // "(1 && this.fn)" => "this.fn"
                            // "(1 && this.fn)()" => "(0, this.fn)()"
                        },
                        .bin_add => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    return p.e(E.Number{ .value = vals[0] + vals[1] }, expr.loc);
                                }
                            }

                            if (foldStringAddition(e_.left, e_.right)) |res| {
                                return res;
                            }
                        },
                        .bin_sub => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    return p.e(E.Number{ .value = vals[0] - vals[1] }, expr.loc);
                                }
                            }
                        },
                        .bin_mul => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    return p.e(E.Number{ .value = vals[0] * vals[1] }, expr.loc);
                                }
                            }
                        },
                        .bin_div => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    return p.e(E.Number{ .value = vals[0] / vals[1] }, expr.loc);
                                }
                            }
                        },
                        .bin_rem => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    // is this correct?
                                    return p.e(E.Number{ .value = std.math.mod(f64, vals[0], vals[1]) catch 0.0 }, expr.loc);
                                }
                            }
                        },
                        .bin_pow => {
                            if (p.should_fold_numeric_constants) {
                                if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                    return p.e(E.Number{ .value = std.math.pow(f64, vals[0], vals[1]) }, expr.loc);
                                }
                            }
                        },
                        .bin_shl => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) << @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        .bin_shr => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        .bin_u_shr => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        .bin_bitwise_and => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        .bin_bitwise_or => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        .bin_bitwise_xor => {
                            // TODO:
                            // if (p.should_fold_numeric_constants) {
                            //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                            //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                            //     }
                            // }
                        },
                        // ---------------------------------------------------------------------------------------------------
                        // ---------------------------------------------------------------------------------------------------
                        // ---------------------------------------------------------------------------------------------------
                        // ---------------------------------------------------------------------------------------------------
                        .bin_assign => {

                            // Optionally preserve the name
                            if (@as(Expr.Tag, e_.left.data) == .e_identifier) {
                                e_.right = p.maybeKeepExprSymbolName(e_.right, p.symbols.items[e_.left.data.e_identifier.ref.innerIndex()].original_name, was_anonymous_named_expr);
                            }
                        },
                        .bin_add_assign => {
                            // notimpl();
                        },
                        .bin_sub_assign => {
                            // notimpl();
                        },
                        .bin_mul_assign => {
                            // notimpl();
                        },
                        .bin_div_assign => {
                            // notimpl();
                        },
                        .bin_rem_assign => {
                            // notimpl();
                        },
                        .bin_pow_assign => {
                            // notimpl();
                        },
                        .bin_shl_assign => {
                            // notimpl();
                        },
                        .bin_shr_assign => {
                            // notimpl();
                        },
                        .bin_u_shr_assign => {
                            // notimpl();
                        },
                        .bin_bitwise_or_assign => {
                            // notimpl();
                        },
                        .bin_bitwise_and_assign => {
                            // notimpl();
                        },
                        .bin_bitwise_xor_assign => {
                            // notimpl();
                        },
                        .bin_nullish_coalescing_assign => {
                            // notimpl();
                        },
                        .bin_logical_and_assign => {
                            // notimpl();
                        },
                        .bin_logical_or_assign => {
                            // notimpl();
                        },
                        else => {},
                    }
                },
                .e_index => |e_| {
                    const is_call_target = std.meta.activeTag(p.call_target) == .e_index and expr.data.e_index == p.call_target.e_index;
                    const is_delete_target = std.meta.activeTag(p.delete_target) == .e_index and expr.data.e_index == p.delete_target.e_index;

                    const target = p.visitExprInOut(e_.target, ExprIn{
                        // this is awkward due to a zig compiler bug
                        .has_chain_parent = (e_.optional_chain orelse js_ast.OptionalChain.start) == js_ast.OptionalChain.ccontinue,
                    });
                    e_.target = target;

                    switch (e_.index.data) {
                        .e_private_identifier => |_private| {
                            var private = _private;
                            const name = p.loadNameFromRef(private.ref);
                            const result = p.findSymbol(e_.index.loc, name) catch unreachable;
                            private.ref = result.ref;

                            // Unlike regular identifiers, there are no unbound private identifiers
                            const kind: Symbol.Kind = p.symbols.items[result.ref.innerIndex()].kind;
                            var r: logger.Range = undefined;
                            if (!Symbol.isKindPrivate(kind)) {
                                r = logger.Range{ .loc = e_.index.loc, .len = @intCast(i32, name.len) };
                                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                            } else {
                                if (in.assign_target != .none and (kind == .private_method or kind == .private_static_method)) {
                                    r = logger.Range{ .loc = e_.index.loc, .len = @intCast(i32, name.len) };
                                    p.log.addRangeWarningFmt(p.source, r, p.allocator, "Writing to read-only method \"{s}\" will throw", .{name}) catch unreachable;
                                } else if (in.assign_target != .none and (kind == .private_get or kind == .private_static_get)) {
                                    r = logger.Range{ .loc = e_.index.loc, .len = @intCast(i32, name.len) };
                                    p.log.addRangeWarningFmt(p.source, r, p.allocator, "Writing to getter-only property \"{s}\" will throw", .{name}) catch unreachable;
                                } else if (in.assign_target != .replace and (kind == .private_set or kind == .private_static_set)) {
                                    r = logger.Range{ .loc = e_.index.loc, .len = @intCast(i32, name.len) };
                                    p.log.addRangeWarningFmt(p.source, r, p.allocator, "Reading from setter-only property \"{s}\" will throw", .{name}) catch unreachable;
                                }
                            }

                            e_.index = .{ .data = .{ .e_private_identifier = private }, .loc = e_.index.loc };
                        },
                        else => {
                            const index = p.visitExpr(e_.index);
                            e_.index = index;
                        },
                    }

                    if (e_.optional_chain == null and e_.index.data == .e_string and e_.index.data.e_string.isUTF8()) {
                        const literal = e_.index.data.e_string.slice(p.allocator);
                        if (p.maybeRewritePropertyAccess(
                            expr.loc,
                            e_.target,
                            literal,
                            e_.index.loc,
                            is_call_target,
                        )) |val| {
                            return val;
                        }

                        // delete process.env["NODE_ENV"]
                        // shouldn't be transformed into
                        // delete undefined
                        if (!is_delete_target and !is_call_target) {
                            // We check for defines here as well
                            // esbuild doesn't do this
                            // In a lot of codebases, people will sometimes do:
                            // process.env["NODE_ENV"]
                            // Often not intentionally
                            // So we want to be able to detect this and still Do The Right Thing
                            if (p.define.dots.get(literal)) |parts| {
                                for (parts) |define| {
                                    if (p.isDotDefineMatch(expr, define.parts)) {
                                        if (!define.data.isUndefined()) {
                                            return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                                        }

                                        return p.e(E.Undefined{}, expr.loc);
                                    }
                                }
                            }
                        }
                        // "foo"[2]
                    } else if (e_.optional_chain == null and target.data == .e_string and e_.index.data == .e_number and target.data.e_string.isUTF8() and e_.index.data.e_number.value >= 0) {
                        const literal = target.data.e_string.slice(p.allocator);
                        const index = e_.index.data.e_number.toUsize();
                        if (literal.len > index) {
                            return p.e(E.String{ .data = literal[index .. index + 1] }, expr.loc);
                        }
                    }
                    // Create an error for assigning to an import namespace when bundling. Even
                    // though this is a run-time error, we make it a compile-time error when
                    // bundling because scope hoisting means these will no longer be run-time
                    // errors.
                    if ((in.assign_target != .none or is_delete_target) and @as(Expr.Tag, e_.target.data) == .e_identifier and p.symbols.items[e_.target.data.e_identifier.ref.innerIndex()].kind == .import) {
                        const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                        p.log.addRangeErrorFmt(
                            p.source,
                            r,
                            p.allocator,
                            "Cannot assign to property on import \"{s}\"",
                            .{p.symbols.items[e_.target.data.e_identifier.ref.innerIndex()].original_name},
                        ) catch unreachable;
                    }

                    return p.e(e_, expr.loc);
                },
                .e_unary => |e_| {
                    switch (e_.op) {
                        .un_typeof => {
                            const id_before = std.meta.activeTag(e_.value.data) == Expr.Tag.e_identifier;
                            e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });
                            const id_after = std.meta.activeTag(e_.value.data) == Expr.Tag.e_identifier;

                            // The expression "typeof (0, x)" must not become "typeof x" if "x"
                            // is unbound because that could suppress a ReferenceError from "x"
                            if (!id_before and id_after and p.symbols.items[e_.value.data.e_identifier.ref.innerIndex()].kind == .unbound) {
                                e_.value = Expr.joinWithComma(
                                    Expr{ .loc = e_.value.loc, .data = Prefill.Data.Zero },
                                    e_.value,
                                    p.allocator,
                                );
                            }

                            if (SideEffects.typeof(e_.value.data)) |typeof| {
                                return p.e(E.String{ .data = typeof }, expr.loc);
                            }
                        },
                        .un_delete => {
                            e_.value = p.visitExprInOut(e_.value, ExprIn{ .has_chain_parent = true });
                        },
                        else => {
                            e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });

                            // Post-process the unary expression

                            switch (e_.op) {
                                .un_not => {
                                    e_.value = SideEffects.simplifyBoolean(p, e_.value);

                                    const side_effects = SideEffects.toBoolean(e_.value.data);
                                    if (side_effects.ok) {
                                        return p.e(E.Boolean{ .value = !side_effects.value }, expr.loc);
                                    }

                                    if (e_.value.maybeSimplifyNot(p.allocator)) |exp| {
                                        return exp;
                                    }
                                },
                                .un_void => {
                                    if (p.exprCanBeRemovedIfUnused(&e_.value)) {
                                        return p.e(E.Undefined{}, e_.value.loc);
                                    }
                                },
                                .un_pos => {
                                    if (SideEffects.toNumber(e_.value.data)) |num| {
                                        return p.e(E.Number{ .value = num }, expr.loc);
                                    }
                                },
                                .un_neg => {
                                    if (SideEffects.toNumber(e_.value.data)) |num| {
                                        return p.e(E.Number{ .value = -num }, expr.loc);
                                    }
                                },

                                ////////////////////////////////////////////////////////////////////////////////

                                .un_pre_dec => {
                                    // TODO: private fields
                                },
                                .un_pre_inc => {
                                    // TODO: private fields
                                },
                                .un_post_dec => {
                                    // TODO: private fields
                                },
                                .un_post_inc => {
                                    // TODO: private fields
                                },
                                else => {},
                            }

                            // "-(a, b)" => "a, -b"
                            if (switch (e_.op) {
                                .un_delete, .un_typeof => false,
                                else => true,
                            }) {
                                switch (e_.value.data) {
                                    .e_binary => |comma| {
                                        if (comma.op == .bin_comma) {
                                            return Expr.joinWithComma(
                                                comma.left,
                                                p.e(
                                                    E.Unary{
                                                        .op = e_.op,
                                                        .value = comma.right,
                                                    },
                                                    comma.right.loc,
                                                ),
                                                p.allocator,
                                            );
                                        }
                                    },
                                    else => {},
                                }
                            }
                        },
                    }
                },
                .e_dot => |e_| {
                    const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_dot and expr.data.e_dot == p.delete_target.e_dot;
                    const is_call_target = @as(Expr.Tag, p.call_target) == .e_dot and expr.data.e_dot == p.call_target.e_dot;

                    if (p.define.dots.get(e_.name)) |parts| {
                        for (parts) |define| {
                            if (p.isDotDefineMatch(expr, define.parts)) {
                                // Substitute user-specified defines
                                if (!define.data.isUndefined()) {
                                    return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                                }

                                // Copy the side effect flags over in case this expression is unused
                                if (define.data.can_be_removed_if_unused) {
                                    e_.can_be_removed_if_unused = true;
                                }

                                if (define.data.call_can_be_unwrapped_if_unused and !p.options.ignore_dce_annotations) {
                                    e_.call_can_be_unwrapped_if_unused = true;
                                }

                                break;
                            }
                        }
                    }

                    // Track ".then().catch()" chains
                    if (is_call_target and @as(Expr.Tag, p.then_catch_chain.next_target) == .e_dot and p.then_catch_chain.next_target.e_dot == expr.data.e_dot) {
                        if (strings.eqlComptime(e_.name, "catch")) {
                            p.then_catch_chain = ThenCatchChain{
                                .next_target = e_.target.data,
                                .has_catch = true,
                            };
                        } else if (strings.eqlComptime(e_.name, "then")) {
                            p.then_catch_chain = ThenCatchChain{
                                .next_target = e_.target.data,
                                .has_catch = p.then_catch_chain.has_catch or p.then_catch_chain.has_multiple_args,
                            };
                        }
                    }

                    e_.target = p.visitExpr(e_.target);
                    if (e_.optional_chain == null) {
                        if (p.maybeRewritePropertyAccess(
                            expr.loc,
                            e_.target,
                            e_.name,
                            e_.name_loc,
                            is_call_target,
                        )) |_expr| {
                            return _expr;
                        }

                        if (comptime allow_macros) {
                            if (p.macro_call_count > 0 and e_.target.data == .e_object and e_.target.data.e_object.was_originally_macro) {
                                if (e_.target.get(e_.name)) |obj| {
                                    return obj;
                                }
                            }
                        }
                    }
                },
                .e_if => |e_| {
                    const is_call_target = @as(Expr.Data, p.call_target) == .e_if and expr.data.e_if == p.call_target.e_if;

                    e_.test_ = p.visitExpr(e_.test_);

                    e_.test_ = SideEffects.simplifyBoolean(p, e_.test_);

                    const side_effects = SideEffects.toBoolean(e_.test_.data);

                    if (!side_effects.ok) {
                        e_.yes = p.visitExpr(e_.yes);
                        e_.no = p.visitExpr(e_.no);
                    } else {
                        // Mark the control flow as dead if the branch is never taken
                        if (side_effects.value) {
                            // "true ? live : dead"
                            e_.yes = p.visitExpr(e_.yes);
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.no = p.visitExpr(e_.no);
                            p.is_control_flow_dead = old;

                            if (side_effects.side_effects == .could_have_side_effects) {
                                return Expr.joinWithComma(SideEffects.simpifyUnusedExpr(p, e_.test_) orelse p.e(E.Missing{}, e_.test_.loc), e_.yes, p.allocator);
                            }

                            // "(1 ? fn : 2)()" => "fn()"
                            // "(1 ? this.fn : 2)" => "this.fn"
                            // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                            if (is_call_target and e_.yes.hasValueForThisInCall()) {
                                return p.e(E.Number{ .value = 0 }, e_.test_.loc).joinWithComma(e_.yes, p.allocator);
                            }

                            return e_.yes;
                        } else {
                            // "false ? dead : live"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.yes = p.visitExpr(e_.yes);
                            p.is_control_flow_dead = old;
                            e_.no = p.visitExpr(e_.no);

                            // "(a, false) ? b : c" => "a, c"
                            if (side_effects.side_effects == .could_have_side_effects) {
                                return Expr.joinWithComma(SideEffects.simpifyUnusedExpr(p, e_.test_) orelse p.e(E.Missing{}, e_.test_.loc), e_.no, p.allocator);
                            }

                            // "(1 ? fn : 2)()" => "fn()"
                            // "(1 ? this.fn : 2)" => "this.fn"
                            // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                            if (is_call_target and e_.no.hasValueForThisInCall()) {
                                return p.e(E.Number{ .value = 0 }, e_.test_.loc).joinWithComma(e_.no, p.allocator);
                            }
                            return e_.no;
                        }
                    }
                },
                .e_await => |e_| {
                    p.await_target = e_.value.data;
                    e_.value = p.visitExpr(e_.value);
                },
                .e_yield => |e_| {
                    if (e_.value) |val| {
                        e_.value = p.visitExpr(val);
                    }
                },
                .e_array => |e_| {
                    if (in.assign_target != .none) {
                        p.maybeCommaSpreadError(e_.comma_after_spread);
                    }
                    var items = e_.items.slice();
                    for (items) |*item| {
                        switch (item.data) {
                            .e_missing => {},
                            .e_spread => |spread| {
                                spread.value = p.visitExprInOut(spread.value, ExprIn{ .assign_target = in.assign_target });
                            },
                            .e_binary => |e2| {
                                if (in.assign_target != .none and e2.op == .bin_assign) {
                                    const was_anonymous_named_expr = p.isAnonymousNamedExpr(e2.right);
                                    e2.left = p.visitExprInOut(e2.left, ExprIn{ .assign_target = .replace });
                                    e2.right = p.visitExpr(e2.right);

                                    if (@as(Expr.Tag, e2.left.data) == .e_identifier) {
                                        e2.right = p.maybeKeepExprSymbolName(
                                            e2.right,
                                            p.symbols.items[e2.left.data.e_identifier.ref.innerIndex()].original_name,
                                            was_anonymous_named_expr,
                                        );
                                    }
                                } else {
                                    item.* = p.visitExprInOut(item.*, ExprIn{ .assign_target = in.assign_target });
                                }
                            },
                            else => {
                                item.* = p.visitExprInOut(item.*, ExprIn{ .assign_target = in.assign_target });
                            },
                        }
                    }
                },
                .e_object => |e_| {
                    if (in.assign_target != .none) {
                        p.maybeCommaSpreadError(e_.comma_after_spread);
                    }

                    var has_spread = false;
                    var has_proto = false;
                    var i: usize = 0;
                    while (i < e_.properties.len) : (i += 1) {
                        var property = e_.properties.ptr[i];

                        if (property.kind != .spread) {
                            property.key = p.visitExpr(property.key orelse Global.panic("Expected property key", .{}));
                            const key = property.key.?;
                            // Forbid duplicate "__proto__" properties according to the specification
                            if (!property.flags.contains(.is_computed) and
                                !property.flags.contains(.was_shorthand) and
                                !property.flags.contains(.is_method) and
                                in.assign_target == .none and
                                key.data.isStringValue() and
                                strings.eqlComptime(
                                // __proto__ is utf8, assume it lives in refs
                                key.data.e_string.slice(p.allocator),
                                "__proto__",
                            )) {
                                if (has_proto) {
                                    const r = js_lexer.rangeOfIdentifier(p.source, key.loc);
                                    p.log.addRangeError(p.source, r, "Cannot specify the \"__proto__\" property more than once per object") catch unreachable;
                                }
                                has_proto = true;
                            }
                        } else {
                            has_spread = true;
                        }

                        // Extract the initializer for expressions like "({ a: b = c } = d)"
                        if (in.assign_target != .none and property.initializer == null and property.value != null) {
                            switch (property.value.?.data) {
                                .e_binary => |bin| {
                                    if (bin.op == .bin_assign) {
                                        property.initializer = bin.right;
                                        property.value = bin.left;
                                    }
                                },
                                else => {},
                            }
                        }

                        if (property.value != null) {
                            property.value = p.visitExprInOut(property.value.?, ExprIn{ .assign_target = in.assign_target });
                        }

                        if (property.initializer != null) {
                            const was_anonymous_named_expr = p.isAnonymousNamedExpr(property.initializer orelse unreachable);
                            property.initializer = p.visitExpr(property.initializer.?);

                            if (property.value) |val| {
                                if (@as(Expr.Tag, val.data) == .e_identifier) {
                                    property.initializer = p.maybeKeepExprSymbolName(
                                        property.initializer orelse unreachable,
                                        p.symbols.items[val.data.e_identifier.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                }
                            }
                        }

                        e_.properties.ptr[i] = property;
                    }
                },
                .e_import => |e_| {
                    const state = TransposeState{
                        // we must check that the await_target is an e_import or it will crash
                        // example from next.js where not checking causes a panic:
                        // ```
                        // const {
                        //     normalizeLocalePath,
                        //   } = require('../shared/lib/i18n/normalize-locale-path') as typeof import('../shared/lib/i18n/normalize-locale-path')
                        // ```
                        .is_await_target = if (p.await_target != null) p.await_target.? == .e_import and p.await_target.?.e_import == e_ else false,
                        .is_then_catch_target = p.then_catch_chain.has_catch and std.meta.activeTag(p.then_catch_chain.next_target) == .e_import and expr.data.e_import == p.then_catch_chain.next_target.e_import,
                        .loc = e_.expr.loc,
                    };

                    e_.expr = p.visitExpr(e_.expr);
                    return p.import_transposer.maybeTransposeIf(e_.expr, state);
                },
                .e_call => |e_| {
                    p.call_target = e_.target.data;

                    p.then_catch_chain = ThenCatchChain{
                        .next_target = e_.target.data,
                        .has_multiple_args = e_.args.len >= 2,
                        .has_catch = @as(Expr.Tag, p.then_catch_chain.next_target) == .e_call and p.then_catch_chain.next_target.e_call == expr.data.e_call and p.then_catch_chain.has_catch,
                    };

                    e_.target = p.visitExprInOut(e_.target, ExprIn{
                        .has_chain_parent = (e_.optional_chain orelse js_ast.OptionalChain.start) == .ccontinue,
                    });
                    var could_be_require_resolve: bool = false;

                    // Copy the call side effect flag over if this is a known target
                    switch (e_.target.data) {
                        .e_identifier => |ident| {
                            e_.can_be_unwrapped_if_unused = e_.can_be_unwrapped_if_unused or ident.call_can_be_unwrapped_if_unused;
                        },
                        .e_dot => |dot| {
                            e_.can_be_unwrapped_if_unused = e_.can_be_unwrapped_if_unused or dot.call_can_be_unwrapped_if_unused;
                            // Prepare to recognize "require.resolve()" calls
                            could_be_require_resolve = (e_.args.len >= 1 and
                                dot.optional_chain == null and
                                @as(Expr.Tag, dot.target.data) == .e_identifier and
                                dot.target.data.e_identifier.ref.eql(p.require_ref) and
                                strings.eqlComptime(dot.name, "resolve"));
                        },
                        else => {},
                    }

                    const is_macro_ref: bool = if (comptime FeatureFlags.is_macro_enabled and
                        jsx_transform_type != .macro)
                        e_.target.data == .e_import_identifier and p.macro.refs.contains(e_.target.data.e_import_identifier.ref)
                    else
                        false;

                    {
                        const old_ce = p.options.ignore_dce_annotations;
                        defer p.options.ignore_dce_annotations = old_ce;
                        if (is_macro_ref)
                            p.options.ignore_dce_annotations = true;

                        for (e_.args.slice()) |_, i| {
                            const arg = e_.args.ptr[i];
                            e_.args.ptr[i] = p.visitExpr(arg);
                        }
                    }

                    if (e_.optional_chain == null and @as(Expr.Tag, e_.target.data) == .e_identifier and e_.target.data.e_identifier.ref.eql(p.require_ref)) {
                        e_.can_be_unwrapped_if_unused = false;

                        // Heuristic: omit warnings inside try/catch blocks because presumably
                        // the try/catch statement is there to handle the potential run-time
                        // error from the unbundled require() call failing.
                        if (e_.args.len == 1) {
                            const first = e_.args.first_();
                            switch (first.data) {
                                .e_string => {
                                    // require(FOO) => require(FOO)
                                    return p.transposeRequire(first, null);
                                },
                                .e_if => {
                                    // require(FOO  ? '123' : '456') => FOO ? require('123') : require('456')
                                    // This makes static analysis later easier
                                    return p.require_transposer.maybeTransposeIf(first, null);
                                },
                                else => {},
                            }
                        }

                        if (p.options.features.dynamic_require) {
                            p.ignoreUsage(p.require_ref);
                            return p.e(
                                E.Call{
                                    .target = p.e(E.Dot{
                                        .target = p.e(E.ImportMeta{}, expr.loc),
                                        .name = "require",
                                        .name_loc = expr.loc,
                                    }, expr.loc),
                                    .args = e_.args,
                                    .close_paren_loc = e_.close_paren_loc,
                                    .optional_chain = e_.optional_chain,
                                    .can_be_unwrapped_if_unused = e_.can_be_unwrapped_if_unused,
                                },
                                expr.loc,
                            );
                        }

                        if (p.options.warn_about_unbundled_modules) {
                            const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                            p.log.addRangeDebug(p.source, r, "This call to \"require\" will not be bundled because it has multiple arguments") catch unreachable;
                        }
                    }

                    if (could_be_require_resolve) {
                        // Ignore calls to require.resolve() if the control flow is provably
                        // dead here. We don't want to spend time scanning the required files
                        // if they will never be used.
                        if (p.is_control_flow_dead) {
                            return p.e(E.Null{}, expr.loc);
                        }

                        if (p.options.features.dynamic_require) {
                            p.ignoreUsage(p.require_ref);
                            // require.resolve(FOO) => import.meta.resolveSync(FOO)
                            // require.resolve(FOO) => import.meta.resolveSync(FOO, pathsObject)
                            return p.e(
                                E.Call{
                                    .target = p.e(
                                        E.Dot{
                                            .target = p.e(E.ImportMeta{}, e_.target.loc),
                                            .name = "resolveSync",
                                            .name_loc = e_.target.data.e_dot.name_loc,
                                        },
                                        e_.target.loc,
                                    ),
                                    .args = e_.args,
                                    .close_paren_loc = e_.close_paren_loc,
                                },
                                expr.loc,
                            );
                        }

                        if (e_.args.len == 1) {
                            const first = e_.args.first_();
                            switch (first.data) {
                                .e_string => {
                                    // require(FOO) => require(FOO)
                                    return p.transposeRequireResolve(first, expr);
                                },
                                .e_if => {
                                    // require(FOO  ? '123' : '456') => FOO ? require('123') : require('456')
                                    // This makes static analysis later easier
                                    return p.require_resolve_transposer.maybeTransposeIf(first, expr);
                                },
                                else => {},
                            }
                        }
                    }

                    if (comptime allow_macros) {
                        if (is_macro_ref) {
                            const ref = e_.target.data.e_import_identifier.ref;
                            const import_record_id = p.macro.refs.get(ref).?;
                            p.ignoreUsage(ref);
                            if (p.is_control_flow_dead) {
                                return p.e(E.Undefined{}, e_.target.loc);
                            }
                            const name = p.symbols.items[ref.innerIndex()].original_name;
                            const record = &p.import_records.items[import_record_id];
                            const copied = Expr{ .loc = expr.loc, .data = .{ .e_call = e_ } };
                            const start_error_count = p.log.msgs.items.len;
                            p.macro_call_count += 1;
                            const macro_result =
                                p.options.macro_context.call(
                                record.path.text,
                                p.source.path.sourceDir(),
                                p.log,
                                p.source,
                                record.range,
                                copied,
                                &.{},
                                name,
                                MacroVisitor,
                                MacroVisitor{ .p = p, .loc = expr.loc },
                            ) catch |err| {
                                if (err == error.MacroFailed) {
                                    if (p.log.msgs.items.len == start_error_count) {
                                        p.log.addError(p.source, expr.loc, "macro threw exception") catch unreachable;
                                    }
                                } else {
                                    p.log.addErrorFmt(p.source, expr.loc, p.allocator, "{s} error in macro", .{@errorName(err)}) catch unreachable;
                                }
                                return expr;
                            };

                            if (macro_result.data != .e_call) {
                                return p.visitExpr(macro_result);
                            }
                        }
                    }

                    return expr;
                },
                .e_new => |e_| {
                    e_.target = p.visitExpr(e_.target);
                    // p.warnA

                    for (e_.args.slice()) |*arg| {
                        arg.* = p.visitExpr(arg.*);
                    }
                },
                .e_arrow => |e_| {
                    const old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_visit);
                    p.fn_or_arrow_data_visit = FnOrArrowDataVisit{
                        .is_arrow = true,
                        .is_async = e_.is_async,
                    };

                    // Mark if we're inside an async arrow function. This value should be true
                    // even if we're inside multiple arrow functions and the closest inclosing
                    // arrow function isn't async, as long as at least one enclosing arrow
                    // function within the current enclosing function is async.
                    const old_inside_async_arrow_fn = p.fn_only_data_visit.is_inside_async_arrow_fn;
                    p.fn_only_data_visit.is_inside_async_arrow_fn = e_.is_async or p.fn_only_data_visit.is_inside_async_arrow_fn;

                    p.pushScopeForVisitPass(.function_args, expr.loc) catch unreachable;
                    var dupe = p.allocator.dupe(Stmt, e_.body.stmts) catch unreachable;

                    p.visitArgs(e_.args, VisitArgsOpts{
                        .has_rest_arg = e_.has_rest_arg,
                        .body = dupe,
                        .is_unique_formal_parameters = true,
                    });
                    p.pushScopeForVisitPass(.function_body, e_.body.loc) catch unreachable;

                    var stmts_list = ListManaged(Stmt).fromOwnedSlice(p.allocator, dupe);
                    var temp_opts = PrependTempRefsOpts{ .kind = StmtsKind.fn_body };
                    p.visitStmtsAndPrependTempRefs(&stmts_list, &temp_opts) catch unreachable;
                    p.allocator.free(e_.body.stmts);
                    e_.body.stmts = stmts_list.toOwnedSlice();
                    p.popScope();
                    p.popScope();

                    p.fn_only_data_visit.is_inside_async_arrow_fn = old_inside_async_arrow_fn;
                    p.fn_or_arrow_data_visit = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_visit), &old_fn_or_arrow_data);
                },
                .e_function => |e_| {
                    e_.func = p.visitFunc(e_.func, expr.loc);
                    if (e_.func.name) |name| {
                        return p.keepExprSymbolName(expr, p.symbols.items[name.ref.?.innerIndex()].original_name);
                    }
                },
                .e_class => |e_| {

                    // This might be wrong.
                    _ = p.visitClass(expr.loc, e_);
                },
                else => {},
            }
            return expr;
        }

        fn visitArgs(p: *P, args: []G.Arg, opts: VisitArgsOpts) void {
            const strict_loc = fnBodyContainsUseStrict(opts.body);
            const has_simple_args = isSimpleParameterList(args, opts.has_rest_arg);
            var duplicate_args_check: ?*StringVoidMap.Node = null;
            defer {
                if (duplicate_args_check) |checker| {
                    StringVoidMap.release(checker);
                }
            }

            // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
            // FunctionBodyContainsUseStrict of FunctionBody is true and
            // IsSimpleParameterList of FormalParameters is false."
            if (strict_loc != null and !has_simple_args) {
                p.log.addRangeError(p.source, p.source.rangeOfString(strict_loc.?), "Cannot use a \"use strict\" directive in a function with a non-simple parameter list") catch unreachable;
            }

            // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
            // the same BindingIdentifier in a FormalParameterList is only allowed for
            // functions which have simple parameter lists and which are not defined in
            // strict mode code."
            if (opts.is_unique_formal_parameters or strict_loc != null or !has_simple_args or p.isStrictMode()) {
                duplicate_args_check = StringVoidMap.get(bun.default_allocator);
            }

            var i: usize = 0;
            var duplicate_args_check_ptr: ?*StringVoidMap = if (duplicate_args_check != null)
                &duplicate_args_check.?.data
            else
                null;

            while (i < args.len) : (i += 1) {
                if (args[i].ts_decorators.len > 0) {
                    args[i].ts_decorators = p.visitTSDecorators(args[i].ts_decorators);
                }

                p.visitBinding(args[i].binding, duplicate_args_check_ptr);
                if (args[i].default) |default| {
                    args[i].default = p.visitExpr(default);
                }
            }
        }

        pub fn visitTSDecorators(p: *P, decs: ExprNodeList) ExprNodeList {
            var i: usize = 0;
            while (i < decs.len) : (i += 1) {
                decs.ptr[i] = p.visitExpr(decs.ptr[i]);
            }

            return decs;
        }

        pub fn keepExprSymbolName(_: *P, _value: Expr, _: string) Expr {
            return _value;
            // var start = p.expr_list.items.len;
            // p.expr_list.ensureUnusedCapacity(2) catch unreachable;
            // p.expr_list.appendAssumeCapacity(_value);
            // p.expr_list.appendAssumeCapacity(p.e(E.String{
            //     .utf8 = name,
            // }, _value.loc));

            // var value = p.callRuntime(_value.loc, "ℹ", p.expr_list.items[start..p.expr_list.items.len]);
            // // Make sure tree shaking removes this if the function is never used
            // value.getCall().can_be_unwrapped_if_unused = true;
            // return value;
        }

        pub fn fnBodyContainsUseStrict(body: []Stmt) ?logger.Loc {
            for (body) |stmt| {
                switch (stmt.data) {
                    .s_comment => {
                        continue;
                    },
                    .s_directive => |dir| {
                        if (strings.utf16EqlString(dir.value, "use strict")) {
                            return stmt.loc;
                        }
                    },
                    else => {},
                }
            }

            return null;
        }

        pub fn isSimpleParameterList(args: []G.Arg, has_rest_arg: bool) bool {
            if (has_rest_arg) {
                return false;
            }

            for (args) |arg| {
                if (@as(Binding.Tag, arg.binding.data) != .b_identifier or arg.default != null) {
                    return false;
                }
            }

            return true;
        }

        pub fn classCanBeRemovedIfUnused(p: *P, class: *G.Class) bool {
            if (class.extends) |*extends| {
                if (!p.exprCanBeRemovedIfUnused(extends)) {
                    return false;
                }
            }

            for (class.properties) |*property| {
                if (property.kind == .class_static_block) {
                    if (!p.stmtsCanBeRemovedIfUnused(property.class_static_block.?.stmts.slice())) {
                        return false;
                    }
                    continue;
                }

                if (!p.exprCanBeRemovedIfUnused(&(property.key orelse unreachable))) {
                    return false;
                }

                if (property.value) |*val| {
                    if (!p.exprCanBeRemovedIfUnused(val)) {
                        return false;
                    }
                }

                if (property.initializer) |*val| {
                    if (!p.exprCanBeRemovedIfUnused(val)) {
                        return false;
                    }
                }
            }

            return true;
        }

        // TODO:
        // When React Fast Refresh is enabled, anything that's a JSX component should not be removable
        // This is to improve the reliability of fast refresh between page loads.
        pub fn exprCanBeRemovedIfUnused(p: *P, expr: *const Expr) bool {
            switch (expr.data) {
                .e_null,
                .e_undefined,
                .e_missing,
                .e_boolean,
                .e_number,
                .e_big_int,
                .e_string,
                .e_this,
                .e_reg_exp,
                .e_function,
                .e_arrow,
                .e_import_meta,
                => {
                    return true;
                },

                .e_dot => |ex| {
                    return ex.can_be_removed_if_unused;
                },
                .e_class => |ex| {
                    return p.classCanBeRemovedIfUnused(ex);
                },
                .e_identifier => |ex| {
                    if (ex.must_keep_due_to_with_stmt) {
                        return false;
                    }

                    // Unbound identifiers cannot be removed because they can have side effects.
                    // One possible side effect is throwing a ReferenceError if they don't exist.
                    // Another one is a getter with side effects on the global object:
                    //
                    //   Object.defineProperty(globalThis, 'x', {
                    //     get() {
                    //       sideEffect();
                    //     },
                    //   });
                    //
                    // Be very careful about this possibility. It's tempting to treat all
                    // identifier expressions as not having side effects but that's wrong. We
                    // must make sure they have been declared by the code we are currently
                    // compiling before we can tell that they have no side effects.
                    //
                    // Note that we currently ignore ReferenceErrors due to TDZ access. This is
                    // incorrect but proper TDZ analysis is very complicated and would have to
                    // be very conservative, which would inhibit a lot of optimizations of code
                    // inside closures. This may need to be revisited if it proves problematic.
                    if (ex.can_be_removed_if_unused or p.symbols.items[ex.ref.innerIndex()].kind != .unbound) {
                        return true;
                    }
                },
                .e_import_identifier => {

                    // References to an ES6 import item are always side-effect free in an
                    // ECMAScript environment.
                    //
                    // They could technically have side effects if the imported module is a
                    // CommonJS module and the import item was translated to a property access
                    // (which esbuild's bundler does) and the property has a getter with side
                    // effects.
                    //
                    // But this is very unlikely and respecting this edge case would mean
                    // disabling tree shaking of all code that references an export from a
                    // CommonJS module. It would also likely violate the expectations of some
                    // developers because the code *looks* like it should be able to be tree
                    // shaken.
                    //
                    // So we deliberately ignore this edge case and always treat import item
                    // references as being side-effect free.
                    return true;
                },
                .e_if => |ex| {
                    return p.exprCanBeRemovedIfUnused(&ex.test_) and
                        (p.isSideEffectFreeUnboundIdentifierRef(
                        ex.yes,
                        ex.test_,
                        true,
                    ) or
                        p.exprCanBeRemovedIfUnused(&ex.yes)) and
                        (p.isSideEffectFreeUnboundIdentifierRef(
                        ex.no,
                        ex.test_,
                        false,
                    ) or p.exprCanBeRemovedIfUnused(
                        &ex.no,
                    ));
                },
                .e_array => |ex| {
                    for (ex.items.slice()) |*item| {
                        if (!p.exprCanBeRemovedIfUnused(item)) {
                            return false;
                        }
                    }

                    return true;
                },
                .e_object => |ex| {
                    for (ex.properties.slice()) |*property| {

                        // The key must still be evaluated if it's computed or a spread
                        if (property.kind == .spread or property.flags.contains(.is_computed) or property.flags.contains(.is_spread)) {
                            return false;
                        }

                        if (property.value) |*val| {
                            if (!p.exprCanBeRemovedIfUnused(val)) {
                                return false;
                            }
                        }
                    }
                    return true;
                },
                .e_call => |ex| {

                    // A call that has been marked "__PURE__" can be removed if all arguments
                    // can be removed. The annotation causes us to ignore the target.
                    if (ex.can_be_unwrapped_if_unused) {
                        for (ex.args.slice()) |*arg| {
                            if (!p.exprCanBeRemovedIfUnused(arg)) {
                                return false;
                            }
                        }
                        return true;
                    }
                },
                .e_new => |ex| {

                    // A call that has been marked "__PURE__" can be removed if all arguments
                    // can be removed. The annotation causes us to ignore the target.
                    if (ex.can_be_unwrapped_if_unused) {
                        for (ex.args.slice()) |*arg| {
                            if (!p.exprCanBeRemovedIfUnused(arg)) {
                                return false;
                            }
                        }

                        return true;
                    }
                },
                .e_unary => |ex| {
                    switch (ex.op) {
                        // These operators must not have any type conversions that can execute code
                        // such as "toString" or "valueOf". They must also never throw any exceptions.
                        .un_void, .un_not => {
                            return p.exprCanBeRemovedIfUnused(&ex.value);
                        },

                        // The "typeof" operator doesn't do any type conversions so it can be removed
                        // if the result is unused and the operand has no side effects. However, it
                        // has a special case where if the operand is an identifier expression such
                        // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
                        // operation has no side effects.
                        //
                        // Note that there *is* actually a case where "typeof x" can throw an error:
                        // when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
                        // checks are not yet handled correctly by bun or esbuild, so this possibility is
                        // currently ignored.
                        .un_typeof => {
                            if (ex.value.data == .e_identifier) {
                                return true;
                            }

                            return p.exprCanBeRemovedIfUnused(&ex.value);
                        },

                        else => {},
                    }
                },
                .e_binary => |ex| {
                    switch (ex.op) {
                        // These operators must not have any type conversions that can execute code
                        // such as "toString" or "valueOf". They must also never throw any exceptions.
                        .bin_strict_eq,
                        .bin_strict_ne,
                        .bin_comma,
                        .bin_nullish_coalescing,
                        => return p.exprCanBeRemovedIfUnused(&ex.left) and p.exprCanBeRemovedIfUnused(&ex.right),

                        // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
                        .bin_logical_or => return p.exprCanBeRemovedIfUnused(&ex.left) and
                            (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, false) or p.exprCanBeRemovedIfUnused(&ex.right)),

                        // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
                        .bin_logical_and => return p.exprCanBeRemovedIfUnused(&ex.left) and
                            (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, true) or p.exprCanBeRemovedIfUnused(&ex.right)),

                        // For "==" and "!=", pretend the operator was actually "===" or "!==". If
                        // we know that we can convert it to "==" or "!=", then we can consider the
                        // operator itself to have no side effects. This matters because our mangle
                        // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
                        // and since "typeof x === 'object'" is considered to be side-effect free,
                        // we must also consider "typeof x == 'object'" to be side-effect free.
                        .bin_loose_eq, .bin_loose_ne => return SideEffects.canChangeStrictToLoose(
                            ex.left.data,
                            ex.right.data,
                        ) and
                            p.exprCanBeRemovedIfUnused(&ex.left) and p.exprCanBeRemovedIfUnused(&ex.right),
                        else => {},
                    }
                },
                .e_template => |templ| {
                    if (templ.tag == null) {
                        for (templ.parts) |part| {
                            if (!p.exprCanBeRemovedIfUnused(&part.value) or part.value.knownPrimitive() == .unknown) {
                                return false;
                            }
                        }
                    }

                    return true;
                },
                else => {},
            }

            return false;
        }

        // // This is based on exprCanBeRemovedIfUnused.
        // // The main difference: identifiers, functions, arrow functions cause it to return false
        // pub fn exprCanBeHoistedForJSX(p: *P, expr: *const Expr) bool {
        //     if (comptime jsx_transform_type != .react) {
        //         unreachable;
        //     }

        //     switch (expr.data) {
        //         .e_null,
        //         .e_undefined,
        //         .e_missing,
        //         .e_boolean,
        //         .e_number,
        //         .e_big_int,
        //         .e_string,
        //         .e_reg_exp,
        //         => {
        //             return true;
        //         },

        //         .e_dot => |ex| {
        //             return ex.can_be_removed_if_unused;
        //         },
        //         .e_import_identifier => {

        //             // References to an ES6 import item are always side-effect free in an
        //             // ECMAScript environment.
        //             //
        //             // They could technically have side effects if the imported module is a
        //             // CommonJS module and the import item was translated to a property access
        //             // (which esbuild's bundler does) and the property has a getter with side
        //             // effects.
        //             //
        //             // But this is very unlikely and respecting this edge case would mean
        //             // disabling tree shaking of all code that references an export from a
        //             // CommonJS module. It would also likely violate the expectations of some
        //             // developers because the code *looks* like it should be able to be tree
        //             // shaken.
        //             //
        //             // So we deliberately ignore this edge case and always treat import item
        //             // references as being side-effect free.
        //             return true;
        //         },
        //         .e_if => |ex| {
        //             return p.exprCanBeHoistedForJSX(&ex.test_) and
        //                 (p.isSideEffectFreeUnboundIdentifierRef(
        //                 ex.yes,
        //                 ex.test_,
        //                 true,
        //             ) or
        //                 p.exprCanBeHoistedForJSX(&ex.yes)) and
        //                 (p.isSideEffectFreeUnboundIdentifierRef(
        //                 ex.no,
        //                 ex.test_,
        //                 false,
        //             ) or p.exprCanBeHoistedForJSX(
        //                 &ex.no,
        //             ));
        //         },
        //         .e_array => |ex| {
        //             for (ex.items.slice()) |*item| {
        //                 if (!p.exprCanBeHoistedForJSX(item)) {
        //                     return false;
        //                 }
        //             }

        //             return true;
        //         },
        //         .e_object => |ex| {
        //             // macros disable this because macros get inlined
        //             // so it's sort of the opposite of the purpose of this function
        //             if (ex.was_originally_macro)
        //                 return false;

        //             for (ex.properties.slice()) |*property| {

        //                 // The key must still be evaluated if it's computed or a spread
        //                 if (property.kind == .spread or property.flags.contains(.is_computed) or property.flags.contains(.is_spread)) {
        //                     return false;
        //                 }

        //                 if (property.value) |*val| {
        //                     if (!p.exprCanBeHoistedForJSX(val)) {
        //                         return false;
        //                     }
        //                 }
        //             }
        //             return true;
        //         },
        //         .e_call => |ex| {

        //             // A call that has been marked "__PURE__" can be removed if all arguments
        //             // can be removed. The annotation causes us to ignore the target.
        //             if (ex.can_be_unwrapped_if_unused) {
        //                 for (ex.args.slice()) |*arg| {
        //                     if (!p.exprCanBeHoistedForJSX(arg)) {
        //                         return false;
        //                     }
        //                 }
        //                 return true;
        //             }
        //         },
        //         .e_new => |ex| {

        //             // A call that has been marked "__PURE__" can be removed if all arguments
        //             // can be removed. The annotation causes us to ignore the target.
        //             if (ex.can_be_unwrapped_if_unused) {
        //                 for (ex.args.slice()) |*arg| {
        //                     if (!p.exprCanBeHoistedForJSX(arg)) {
        //                         return false;
        //                     }
        //                 }

        //                 return true;
        //             }
        //         },
        //         .e_unary => |ex| {
        //             switch (ex.op) {
        //                 // These operators must not have any type conversions that can execute code
        //                 // such as "toString" or "valueOf". They must also never throw any exceptions.
        //                 .un_void, .un_not => {
        //                     return p.exprCanBeHoistedForJSX(&ex.value);
        //                 },

        //                 // The "typeof" operator doesn't do any type conversions so it can be removed
        //                 // if the result is unused and the operand has no side effects. However, it
        //                 // has a special case where if the operand is an identifier expression such
        //                 // as "typeof x" and "x" doesn't exist, no reference error is thrown so the
        //                 // operation has no side effects.
        //                 //
        //                 // Note that there *is* actually a case where "typeof x" can throw an error:
        //                 // when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
        //                 // checks are not yet handled correctly by bun or esbuild, so this possibility is
        //                 // currently ignored.
        //                 .un_typeof => {
        //                     if (ex.value.data == .e_identifier) {
        //                         return true;
        //                     }

        //                     return p.exprCanBeHoistedForJSX(&ex.value);
        //                 },

        //                 else => {},
        //             }
        //         },
        //         .e_binary => |ex| {
        //             switch (ex.op) {
        //                 // These operators must not have any type conversions that can execute code
        //                 // such as "toString" or "valueOf". They must also never throw any exceptions.
        //                 .bin_strict_eq,
        //                 .bin_strict_ne,
        //                 .bin_comma,
        //                 .bin_nullish_coalescing,
        //                 => return p.exprCanBeHoistedForJSX(&ex.left) and p.exprCanBeHoistedForJSX(&ex.right),

        //                 // Special-case "||" to make sure "typeof x === 'undefined' || x" can be removed
        //                 .bin_logical_or => return p.exprCanBeHoistedForJSX(&ex.left) and
        //                     (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, false) or p.exprCanBeHoistedForJSX(&ex.right)),

        //                 // Special-case "&&" to make sure "typeof x !== 'undefined' && x" can be removed
        //                 .bin_logical_and => return p.exprCanBeHoistedForJSX(&ex.left) and
        //                     (p.isSideEffectFreeUnboundIdentifierRef(ex.right, ex.left, true) or p.exprCanBeHoistedForJSX(&ex.right)),

        //                 // For "==" and "!=", pretend the operator was actually "===" or "!==". If
        //                 // we know that we can convert it to "==" or "!=", then we can consider the
        //                 // operator itself to have no side effects. This matters because our mangle
        //                 // logic will convert "typeof x === 'object'" into "typeof x == 'object'"
        //                 // and since "typeof x === 'object'" is considered to be side-effect free,
        //                 // we must also consider "typeof x == 'object'" to be side-effect free.
        //                 .bin_loose_eq, .bin_loose_ne => return SideEffects.canChangeStrictToLoose(
        //                     ex.left.data,
        //                     ex.right.data,
        //                 ) and
        //                     p.exprCanBeHoistedForJSX(&ex.left) and p.exprCanBeHoistedForJSX(&ex.right),
        //                 else => {},
        //             }
        //         },
        //         .e_template => |templ| {
        //             if (templ.tag == null) {
        //                 for (templ.parts) |part| {
        //                     if (!p.exprCanBeHoistedForJSX(&part.value) or part.value.knownPrimitive() == .unknown) {
        //                         return false;
        //                     }
        //                 }
        //             }

        //             return true;
        //         },
        //         else => {},

        //         // These may reference variables from an upper scope
        //         // it's possible to detect that, but we are cutting scope for now
        //         // .e_function,
        //         // .e_arrow,
        //         // .e_this,
        //     }

        //     return false;
        // }

        fn isSideEffectFreeUnboundIdentifierRef(p: *P, value: Expr, guard_condition: Expr, is_yes_branch: bool) bool {
            if (value.data != .e_identifier or
                p.symbols.items[value.data.e_identifier.ref.innerIndex()].kind != .unbound or
                guard_condition.data != .e_binary)
                return false;

            const binary = guard_condition.data.e_binary.*;

            switch (binary.op) {
                .bin_strict_eq, .bin_strict_ne, .bin_loose_eq, .bin_loose_ne => {
                    // typeof x !== 'undefined'
                    var typeof: Expr.Data = binary.left.data;
                    var compare: Expr.Data = binary.right.data;
                    // typeof 'undefined' !== x
                    if (typeof == .e_string) {
                        typeof = binary.right.data;
                        compare = binary.left.data;
                    }

                    // this order because Expr.Data Tag is not a pointer
                    // so it should be slightly faster to compare
                    if (compare != .e_string or
                        typeof != .e_unary)
                        return false;
                    const unary = typeof.e_unary.*;

                    if (unary.op != .un_typeof or unary.value.data != .e_identifier)
                        return false;

                    const id = value.data.e_identifier.ref;
                    const id2 = unary.value.data.e_identifier.ref;
                    return ((compare.e_string.eqlComptime("undefined") == is_yes_branch) ==
                        (binary.op == .bin_strict_ne or binary.op == .bin_loose_ne)) and
                        id.eql(id2);
                },
                else => return false,
            }
        }

        fn jsxRefToMemberExpressionAutomatic(p: *P, loc: logger.Loc, is_static: bool) Expr {
            return p.jsxRefToMemberExpression(loc, if (is_static and !p.options.jsx.development)
                p.jsxs_runtime.ref
            else
                p.jsx_runtime.ref);
        }

        fn maybeRelocateVarsToTopLevel(p: *P, decls: []const G.Decl, mode: RelocateVars.Mode) RelocateVars {
            // Only do this when the scope is not already top-level and when we're not inside a function.
            if (p.current_scope == p.module_scope) {
                return .{ .ok = false };
            }

            var scope = p.current_scope;
            while (!scope.kindStopsHoisting()) {
                if (comptime Environment.allow_assert) assert(scope.parent != null);
                scope = scope.parent.?;
            }

            if (scope != p.module_scope) {
                return .{ .ok = false };
            }

            var value: Expr = Expr{ .loc = logger.Loc.Empty, .data = Expr.Data{ .e_missing = E.Missing{} } };
            var any_initializers = false;
            for (decls) |decl| {
                const binding = Binding.toExpr(
                    &decl.binding,
                    p.to_expr_wrapper_hoisted,
                );
                if (decl.value) |decl_value| {
                    value = value.joinWithComma(Expr.assign(binding, decl_value, p.allocator), p.allocator);
                    any_initializers = true;
                } else if (mode == .for_in_or_for_of) {
                    value = value.joinWithComma(binding, p.allocator);
                }
            }

            if (std.meta.activeTag(value.data) == .e_missing or !any_initializers) {
                return .{ .ok = true };
            }

            return .{ .stmt = p.s(S.SExpr{ .value = value }, value.loc), .ok = true };
        }

        // fn maybeInlineMacroObject(p: *P, decl: *G.Decl, macro: Expr) void {
        //     if (decl.value == null) return;
        //     switch (decl.binding.data) {
        //         .b_identifier => |ident| {
        //             if (macro.get(p.loadNameFromRef(ident.ref))) |val| {
        //                 decl
        //             }
        //         }
        //     }
        // }
        //  if (comptime allow_macros) {
        //                         if (p.macro_call_count and data.decls[i].value != null and
        //                             data.decls[i].value.?.data == .e_object and data.decls[i].value.?.data.e_object.was_originally_macro)
        //                         {
        //                             p.maybeInlineMacroObject(&data.decls[i], data.decls[i].value.?);
        //                         }
        //                     }

        // EDot nodes represent a property access. This function may return an
        // expression to replace the property access with. It assumes that the
        // target of the EDot expression has already been visited.
        fn maybeRewritePropertyAccess(
            p: *P,
            loc: logger.Loc,
            target: js_ast.Expr,
            name: string,
            name_loc: logger.Loc,
            is_call_target: bool,
        ) ?Expr {
            switch (target.data) {
                .e_identifier => |id| {
                    // Rewrite "module.require()" to "require()" for Webpack compatibility.
                    // See https://github.com/webpack/webpack/pull/7750 for more info.
                    // This also makes correctness a little easier.
                    if (is_call_target and id.ref.eql(p.module_ref) and strings.eqlComptime(name, "require")) {
                        p.ignoreUsage(p.module_ref);
                        p.recordUsage(p.require_ref);
                        return p.e(E.Identifier{ .ref = p.require_ref }, name_loc);
                    }

                    // If this is a known enum value, inline the value of the enum
                    if (is_typescript_enabled) {
                        if (p.known_enum_values.get(id.ref)) |enum_value_map| {
                            if (enum_value_map.get(name)) |enum_value| {
                                return p.e(E.Number{ .value = enum_value }, loc);
                            }
                        }
                    }
                },
                .e_string => |str| {
                    // minify "long-string".length to 11
                    if (strings.eqlComptime(name, "length")) {
                        return p.e(E.Number{ .value = @intToFloat(f64, str.len()) }, loc);
                    }
                },
                else => {},
            }

            return null;
        }

        pub fn ignoreUsage(p: *P, ref: Ref) void {
            if (!p.is_control_flow_dead) {
                if (comptime Environment.allow_assert) assert(@as(usize, ref.innerIndex()) < p.symbols.items.len);
                p.symbols.items[ref.innerIndex()].use_count_estimate -|= 1;
                var use = p.symbol_uses.get(ref) orelse return;
                use.count_estimate -|= 1;
                if (use.count_estimate == 0) {
                    _ = p.symbol_uses.swapRemove(ref);
                } else {
                    p.symbol_uses.putAssumeCapacity(ref, use);
                }
            }

            // Don't roll back the "tsUseCounts" increment. This must be counted even if
            // the value is ignored because that's what the TypeScript compiler does.
        }

        fn visitAndAppendStmt(p: *P, stmts: *ListManaged(Stmt), stmt: *Stmt) !void {
            switch (stmt.data) {
                // These don't contain anything to traverse

                .s_debugger, .s_empty, .s_comment => {},
                .s_type_script => {

                    // Erase TypeScript constructs from the output completely
                    return;
                },
                .s_directive => {

                    //         	if p.isStrictMode() && s.LegacyOctalLoc.Start > 0 {
                    // 	p.markStrictModeFeature(legacyOctalEscape, p.source.RangeOfLegacyOctalEscape(s.LegacyOctalLoc), "")
                    // }
                    return;
                },
                .s_import => |data| {
                    try p.recordDeclaredSymbol(data.namespace_ref);

                    if (data.default_name) |default_name| {
                        try p.recordDeclaredSymbol(default_name.ref.?);
                    }

                    if (data.items.len > 0) {
                        for (data.items) |*item| {
                            try p.recordDeclaredSymbol(item.name.ref.?);
                        }
                    }
                },
                .s_export_clause => |data| {
                    // "export {foo}"
                    var end: usize = 0;
                    var any_replaced = false;
                    if (p.options.features.replace_exports.count() > 0) {
                        for (data.items) |*item| {
                            const name = p.loadNameFromRef(item.name.ref.?);

                            const symbol = try p.findSymbol(item.alias_loc, name);
                            const ref = symbol.ref;

                            if (p.options.features.replace_exports.getPtr(name)) |entry| {
                                if (entry.* != .replace) p.ignoreUsage(symbol.ref);
                                _ = p.injectReplacementExport(stmts, symbol.ref, stmt.loc, entry);
                                any_replaced = true;
                                continue;
                            }

                            if (p.symbols.items[ref.innerIndex()].kind == .unbound) {
                                // Silently strip exports of non-local symbols in TypeScript, since
                                // those likely correspond to type-only exports. But report exports of
                                // non-local symbols as errors in JavaScript.
                                if (!is_typescript_enabled) {
                                    const r = js_lexer.rangeOfIdentifier(p.source, item.name.loc);
                                    try p.log.addRangeErrorFmt(p.source, r, p.allocator, "\"{s}\" is not declared in this file", .{name});
                                }
                                continue;
                            }

                            item.name.ref = ref;
                            data.items[end] = item.*;
                            end += 1;
                        }
                    } else {
                        for (data.items) |*item| {
                            const name = p.loadNameFromRef(item.name.ref.?);
                            const symbol = try p.findSymbol(item.alias_loc, name);
                            const ref = symbol.ref;

                            if (p.symbols.items[ref.innerIndex()].kind == .unbound) {
                                // Silently strip exports of non-local symbols in TypeScript, since
                                // those likely correspond to type-only exports. But report exports of
                                // non-local symbols as errors in JavaScript.
                                if (!is_typescript_enabled) {
                                    const r = js_lexer.rangeOfIdentifier(p.source, item.name.loc);
                                    try p.log.addRangeErrorFmt(p.source, r, p.allocator, "\"{s}\" is not declared in this file", .{name});
                                    continue;
                                }
                                continue;
                            }

                            item.name.ref = ref;
                            data.items[end] = item.*;
                            end += 1;
                        }
                    }

                    const remove_for_tree_shaking = any_replaced and end == 0 and data.items.len > 0 and p.options.tree_shaking;
                    data.items.len = end;

                    if (remove_for_tree_shaking) {
                        return;
                    }
                },
                .s_export_from => |data| {
                    // When HMR is enabled, we need to transform this into
                    // import {foo} from "./foo";
                    // export {foo};

                    // From:
                    // export {foo as default} from './foo';
                    // To:
                    // import {default as foo} from './foo';
                    // export {foo};

                    // "export {foo} from 'path'"
                    const name = p.loadNameFromRef(data.namespace_ref);

                    data.namespace_ref = try p.newSymbol(.other, name);
                    try p.current_scope.generated.append(p.allocator, data.namespace_ref);
                    try p.recordDeclaredSymbol(data.namespace_ref);

                    if (p.options.features.replace_exports.count() > 0) {
                        var j: usize = 0;
                        // This is a re-export and the symbols created here are used to reference
                        for (data.items) |item| {
                            const old_ref = item.name.ref.?;

                            if (p.options.features.replace_exports.count() > 0) {
                                if (p.options.features.replace_exports.getPtr(item.alias)) |entry| {
                                    _ = p.injectReplacementExport(stmts, old_ref, logger.Loc.Empty, entry);

                                    continue;
                                }
                            }

                            const _name = p.loadNameFromRef(old_ref);

                            const ref = try p.newSymbol(.other, _name);
                            try p.current_scope.generated.append(p.allocator, data.namespace_ref);
                            try p.recordDeclaredSymbol(data.namespace_ref);
                            data.items[j] = item;
                            data.items[j].name.ref = ref;
                            j += 1;
                        }

                        data.items.len = j;

                        if (j == 0 and data.items.len > 0) {
                            return;
                        }
                    } else {

                        // This is a re-export and the symbols created here are used to reference
                        for (data.items) |*item| {
                            const _name = p.loadNameFromRef(item.name.ref.?);
                            const ref = try p.newSymbol(.other, _name);
                            try p.current_scope.generated.append(p.allocator, data.namespace_ref);
                            try p.recordDeclaredSymbol(data.namespace_ref);
                            item.name.ref = ref;
                        }
                    }
                },
                .s_export_star => |data| {

                    // "export * from 'path'"
                    const name = p.loadNameFromRef(data.namespace_ref);
                    data.namespace_ref = try p.newSymbol(.other, name);
                    try p.current_scope.generated.append(p.allocator, data.namespace_ref);
                    try p.recordDeclaredSymbol(data.namespace_ref);

                    // "export * as ns from 'path'"
                    if (data.alias) |alias| {
                        if (p.options.features.replace_exports.count() > 0) {
                            if (p.options.features.replace_exports.getPtr(alias.original_name)) |entry| {
                                _ = p.injectReplacementExport(stmts, p.declareSymbol(.other, logger.Loc.Empty, alias.original_name) catch unreachable, logger.Loc.Empty, entry);
                                return;
                            }
                        }
                        // "import * as ns from 'path'"
                        // "export {ns}"

                        // jarred: For now, just always do this transform.
                        // because Safari doesn't support it and I've seen cases where this breaks

                        p.recordUsage(data.namespace_ref);
                        try stmts.ensureTotalCapacity(stmts.items.len + 2);
                        stmts.appendAssumeCapacity(p.s(S.Import{ .namespace_ref = data.namespace_ref, .star_name_loc = alias.loc, .import_record_index = data.import_record_index }, stmt.loc));

                        var items = try List(js_ast.ClauseItem).initCapacity(p.allocator, 1);
                        items.appendAssumeCapacity(js_ast.ClauseItem{ .alias = alias.original_name, .original_name = alias.original_name, .alias_loc = alias.loc, .name = LocRef{ .loc = alias.loc, .ref = data.namespace_ref } });
                        stmts.appendAssumeCapacity(p.s(S.ExportClause{ .items = items.toOwnedSlice(p.allocator), .is_single_line = true }, stmt.loc));
                        return;
                    }
                },
                .s_export_default => |data| {
                    if (data.default_name.ref) |ref| {
                        try p.recordDeclaredSymbol(ref);
                    }

                    var mark_for_replace: bool = false;

                    const orig_dead = p.is_control_flow_dead;
                    if (p.options.features.replace_exports.count() > 0) {
                        if (p.options.features.replace_exports.getPtr("default")) |entry| {
                            p.is_control_flow_dead = entry.* != .replace;
                            mark_for_replace = true;
                        }
                    }

                    defer {
                        p.is_control_flow_dead = orig_dead;
                    }

                    switch (data.value) {
                        .expr => |expr| {
                            const was_anonymous_named_expr = p.isAnonymousNamedExpr(expr);

                            data.value.expr = p.visitExpr(expr);

                            if (p.is_control_flow_dead) {
                                return;
                            }

                            // Optionally preserve the name

                            data.value.expr = p.maybeKeepExprSymbolName(data.value.expr, js_ast.ClauseItem.default_alias, was_anonymous_named_expr);

                            // Discard type-only export default statements
                            if (is_typescript_enabled) {
                                switch (data.value.expr.data) {
                                    .e_identifier => |ident| {
                                        if (!ident.ref.isSourceContentsSlice()) {
                                            const symbol = p.symbols.items[ident.ref.innerIndex()];
                                            if (symbol.kind == .unbound) {
                                                if (p.local_type_names.get(symbol.original_name)) |local_type| {
                                                    if (local_type) {
                                                        return;
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    else => {},
                                }
                            }

                            if (mark_for_replace) {
                                var entry = p.options.features.replace_exports.getPtr("default").?;
                                if (entry.* == .replace) {
                                    data.value.expr = entry.replace;
                                } else {
                                    _ = p.injectReplacementExport(stmts, Ref.None, logger.Loc.Empty, entry);
                                    return;
                                }
                            }

                            // When bundling, replace ExportDefault with __exportDefault(exportsRef, expr);
                            if (p.options.enable_bundling) {
                                var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                export_default_args[0] = p.@"module.exports"(expr.loc);
                                export_default_args[1] = data.value.expr;
                                stmts.append(p.s(S.SExpr{ .value = p.callRuntime(expr.loc, "__exportDefault", export_default_args) }, expr.loc)) catch unreachable;
                                return;
                            }
                        },

                        .stmt => |s2| {
                            switch (s2.data) {
                                .s_function => |func| {
                                    var name: string = "";
                                    const had_name = func.func.name != null;
                                    if (func.func.name) |func_loc| {
                                        name = p.loadNameFromRef(func_loc.ref.?);
                                    } else {
                                        func.func.name = data.default_name;
                                        name = js_ast.ClauseItem.default_alias;
                                    }

                                    func.func = p.visitFunc(func.func, func.func.open_parens_loc);

                                    if (p.is_control_flow_dead) {
                                        return;
                                    }

                                    if (mark_for_replace) {
                                        var entry = p.options.features.replace_exports.getPtr("default").?;
                                        if (entry.* == .replace) {
                                            data.value = .{ .expr = entry.replace };
                                        } else {
                                            _ = p.injectReplacementExport(stmts, Ref.None, logger.Loc.Empty, entry);
                                            return;
                                        }

                                        // When bundling, replace ExportDefault with __exportDefault(exportsRef, expr);
                                        if (p.options.enable_bundling) {
                                            var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                            export_default_args[0] = p.@"module.exports"(data.value.expr.loc);
                                            export_default_args[1] = data.value.expr;
                                            stmts.append(p.s(S.SExpr{ .value = p.callRuntime(data.value.expr.loc, "__exportDefault", export_default_args) }, data.value.expr.loc)) catch unreachable;
                                            return;
                                        }
                                    } else if (p.options.enable_bundling) {
                                        var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                        export_default_args[0] = p.@"module.exports"(s2.loc);

                                        if (had_name) {
                                            export_default_args[1] = p.e(E.Identifier{ .ref = func.func.name.?.ref.? }, s2.loc);
                                            stmts.ensureUnusedCapacity(2) catch unreachable;

                                            stmts.appendAssumeCapacity(s2);
                                        } else {
                                            export_default_args[1] = p.e(E.Function{ .func = func.func }, s2.loc);
                                        }

                                        stmts.append(p.s(S.SExpr{ .value = p.callRuntime(s2.loc, "__exportDefault", export_default_args) }, s2.loc)) catch unreachable;
                                        return;
                                    }

                                    stmts.append(stmt.*) catch unreachable;

                                    // if (func.func.name != null and func.func.name.?.ref != null) {
                                    //     stmts.append(p.keepStmtSymbolName(func.func.name.?.loc, func.func.name.?.ref.?, name)) catch unreachable;
                                    // }
                                    // prevent doubling export default function name
                                    return;
                                },
                                .s_class => |class| {
                                    // TODO: https://github.com/oven-sh/bun/issues/51
                                    _ = p.visitClass(s2.loc, &class.class);

                                    if (p.is_control_flow_dead)
                                        return;

                                    if (mark_for_replace) {
                                        var entry = p.options.features.replace_exports.getPtr("default").?;
                                        if (entry.* == .replace) {
                                            data.value = .{ .expr = entry.replace };
                                        } else {
                                            _ = p.injectReplacementExport(stmts, Ref.None, logger.Loc.Empty, entry);
                                            return;
                                        }

                                        // When bundling, replace ExportDefault with __exportDefault(exportsRef, expr);
                                        if (p.options.enable_bundling) {
                                            var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                            export_default_args[0] = p.@"module.exports"(data.value.expr.loc);
                                            export_default_args[1] = data.value.expr;
                                            stmts.append(p.s(S.SExpr{ .value = p.callRuntime(data.value.expr.loc, "__exportDefault", export_default_args) }, data.value.expr.loc)) catch unreachable;
                                            return;
                                        }
                                    } else if (p.options.enable_bundling) {
                                        var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                                        export_default_args[0] = p.@"module.exports"(s2.loc);

                                        const class_name_ref = brk: {
                                            if (class.class.class_name) |class_name_ref| {
                                                if (class_name_ref.ref) |ref| {
                                                    break :brk ref;
                                                }
                                            }
                                            break :brk null;
                                        };
                                        if (class_name_ref) |ref| {
                                            stmts.ensureUnusedCapacity(2) catch unreachable;
                                            stmts.appendAssumeCapacity(s2);
                                            export_default_args[1] = p.e(E.Identifier{ .ref = ref }, s2.loc);
                                        } else {
                                            export_default_args[1] = p.e(class.class, s2.loc);
                                        }

                                        stmts.append(p.s(S.SExpr{ .value = p.callRuntime(s2.loc, "__exportDefault", export_default_args) }, s2.loc)) catch unreachable;
                                        return;
                                    }

                                    stmts.append(stmt.*) catch unreachable;
                                    return;
                                },
                                else => {},
                            }
                        },
                    }
                },
                .s_export_equals => |data| {
                    if (p.options.enable_bundling) {
                        var export_default_args = p.allocator.alloc(Expr, 2) catch unreachable;
                        export_default_args[0] = p.@"module.exports"(stmt.loc);
                        export_default_args[1] = data.value;

                        stmts.append(p.s(S.SExpr{ .value = p.callRuntime(stmt.loc, "__exportDefault", export_default_args) }, stmt.loc)) catch unreachable;
                        return;
                    }

                    // "module.exports = value"
                    stmts.append(
                        Expr.assignStmt(
                            p.@"module.exports"(
                                stmt.loc,
                            ),
                            p.visitExpr(data.value),
                            p.allocator,
                        ),
                    ) catch unreachable;
                    p.recordUsage(p.module_ref);
                },
                .s_break => |data| {
                    if (data.label) |*label| {
                        const name = p.loadNameFromRef(label.ref orelse p.panic("Expected label to have a ref", .{}));
                        const res = p.findLabelSymbol(label.loc, name);
                        if (res.found) {
                            label.ref = res.ref;
                        } else {
                            data.label = null;
                        }
                    } else if (!p.fn_or_arrow_data_visit.is_inside_loop and !p.fn_or_arrow_data_visit.is_inside_switch) {
                        const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                        p.log.addRangeError(p.source, r, "Cannot use \"break\" here") catch unreachable;
                    }
                },
                .s_continue => |data| {
                    if (data.label) |*label| {
                        const name = p.loadNameFromRef(label.ref orelse p.panic("Expected continue label to have a ref", .{}));
                        const res = p.findLabelSymbol(label.loc, name);
                        label.ref = res.ref;
                        if (res.found and !res.is_loop) {
                            const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot \"continue\" to label {s}", .{name}) catch unreachable;
                        }
                    } else if (!p.fn_or_arrow_data_visit.is_inside_loop) {
                        const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                        p.log.addRangeError(p.source, r, "Cannot use \"continue\" here") catch unreachable;
                    }
                },
                .s_label => |data| {
                    p.pushScopeForVisitPass(.label, stmt.loc) catch unreachable;
                    const name = p.loadNameFromRef(data.name.ref.?);
                    const ref = p.newSymbol(.label, name) catch unreachable;
                    data.name.ref = ref;
                    p.current_scope.label_ref = ref;
                    switch (data.stmt.data) {
                        .s_for, .s_for_in, .s_for_of, .s_while, .s_do_while => {
                            p.current_scope.label_stmt_is_loop = true;
                        },
                        else => {},
                    }

                    data.stmt = p.visitSingleStmt(data.stmt, StmtsKind.none);
                    p.popScope();
                },
                .s_local => |data| {
                    const decls_len = if (!(data.is_export and p.options.features.replace_exports.entries.len > 0))
                        p.visitDecls(data.decls, false)
                    else
                        p.visitDecls(data.decls, true);

                    const is_now_dead = data.decls.len > 0 and decls_len == 0;
                    if (is_now_dead) {
                        return;
                    }

                    data.decls.len = decls_len;

                    // Handle being exported inside a namespace
                    if (data.is_export and p.enclosing_namespace_arg_ref != null) {
                        for (data.decls) |*d| {
                            if (d.value) |val| {
                                p.recordUsage((p.enclosing_namespace_arg_ref orelse unreachable));
                                // TODO: is it necessary to lowerAssign? why does esbuild do it _most_ of the time?
                                stmts.append(p.s(S.SExpr{
                                    .value = Expr.assign(Binding.toExpr(&d.binding, p.to_expr_wrapper_namespace), val, p.allocator),
                                }, stmt.loc)) catch unreachable;
                            }
                        }

                        return;
                    }

                    // We must relocate vars in order to safely handle removing if/else depending on NODE_ENV.
                    // Edgecase:
                    //  `export var` is skipped because it's unnecessary. That *should* be a noop, but it loses the `is_export` flag if we're in HMR.
                    if (data.kind == .k_var and !data.is_export) {
                        const relocated = p.maybeRelocateVarsToTopLevel(data.decls, .normal);
                        if (relocated.ok) {
                            if (relocated.stmt) |new_stmt| {
                                stmts.append(new_stmt) catch unreachable;
                            }

                            return;
                        }
                    }
                },
                .s_expr => |data| {
                    p.stmt_expr_value = data.value.data;
                    data.value = p.visitExpr(data.value);
                    // simplify unused
                    data.value = SideEffects.simpifyUnusedExpr(p, data.value) orelse data.value.toEmpty();
                },
                .s_throw => |data| {
                    data.value = p.visitExpr(data.value);
                },
                .s_return => |data| {

                    // Forbid top-level return inside modules with ECMAScript-style exports
                    if (p.fn_or_arrow_data_visit.is_outside_fn_or_arrow) {
                        const where = where: {
                            if (p.es6_export_keyword.len > 0) {
                                break :where p.es6_export_keyword;
                            } else if (p.top_level_await_keyword.len > 0) {
                                break :where p.top_level_await_keyword;
                            } else {
                                break :where logger.Range.None;
                            }
                        };

                        if (where.len > 0) {
                            p.log.addRangeError(p.source, where, "Top-level return cannot be used inside an ECMAScript module") catch unreachable;
                        }
                    }

                    if (data.value) |val| {
                        data.value = p.visitExpr(val);

                        // "return undefined;" can safely just always be "return;"
                        if (data.value != null and @as(Expr.Tag, data.value.?.data) == .e_undefined) {
                            // Returning undefined is implicit
                            data.value = null;
                        }
                    }
                },
                .s_block => |data| {
                    {
                        p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;

                        // Pass the "is loop body" status on to the direct children of a block used
                        // as a loop body. This is used to enable optimizations specific to the
                        // topmost scope in a loop body block.
                        const kind = if (std.meta.eql(p.loop_body, stmt.data)) StmtsKind.loop_body else StmtsKind.none;
                        var _stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, data.stmts);
                        p.visitStmts(&_stmts, kind) catch unreachable;
                        data.stmts = _stmts.toOwnedSlice();
                        p.popScope();
                    }

                    // // trim empty statements
                    if (data.stmts.len == 0) {
                        stmts.append(Stmt{ .data = Prefill.Data.SEmpty, .loc = stmt.loc }) catch unreachable;
                        return;
                    } else if (data.stmts.len == 1 and !statementCaresAboutScope(data.stmts[0])) {
                        // Unwrap blocks containing a single statement
                        stmts.append(data.stmts[0]) catch unreachable;
                        return;
                    }
                    stmts.append(stmt.*) catch unreachable;
                    return;
                },
                .s_with => |data| {
                    // using with is forbidden in strict mode
                    // we largely only deal with strict mode
                    // however, old code should still technically transpile
                    // we do not attempt to preserve all the semantics of with
                    data.value = p.visitExpr(data.value);
                    // This stmt should be a block
                    if (comptime Environment.allow_assert) assert(data.body.data == .s_block);
                    data.body = p.visitSingleStmt(data.body, StmtsKind.none);
                },
                .s_while => |data| {
                    data.test_ = p.visitExpr(data.test_);
                    data.body = p.visitLoopBody(data.body);

                    data.test_ = SideEffects.simplifyBoolean(p, data.test_);
                    const result = SideEffects.toBoolean(data.test_.data);
                    if (result.ok and result.side_effects == .no_side_effects) {
                        data.test_ = p.e(E.Boolean{ .value = result.value }, data.test_.loc);
                    }
                },
                .s_do_while => |data| {
                    data.body = p.visitLoopBody(data.body);
                    data.test_ = p.visitExpr(data.test_);

                    data.test_ = SideEffects.simplifyBoolean(p, data.test_);
                },
                .s_if => |data| {
                    data.test_ = SideEffects.simplifyBoolean(p, p.visitExpr(data.test_));

                    const effects = SideEffects.toBoolean(data.test_.data);
                    if (effects.ok and !effects.value) {
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        data.yes = p.visitSingleStmt(data.yes, StmtsKind.none);
                        p.is_control_flow_dead = old;
                    } else {
                        data.yes = p.visitSingleStmt(data.yes, StmtsKind.none);
                    }

                    // The "else" clause is optional
                    if (data.no) |no| {
                        if (effects.ok and effects.value) {
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            defer p.is_control_flow_dead = old;
                            data.no = p.visitSingleStmt(no, .none);
                        } else {
                            data.no = p.visitSingleStmt(no, .none);
                        }

                        // Trim unnecessary "else" clauses
                        if (data.no != null and @as(Stmt.Tag, data.no.?.data) == .s_empty) {
                            data.no = null;
                        }
                    }

                    if (effects.ok) {
                        if (effects.value) {
                            if (data.no == null or !SideEffects.shouldKeepStmtInDeadControlFlow(data.no.?, p.allocator)) {
                                if (effects.side_effects == .could_have_side_effects) {
                                    // Keep the condition if it could have side effects (but is still known to be truthy)
                                    if (SideEffects.simpifyUnusedExpr(p, data.test_)) |test_| {
                                        stmts.append(p.s(S.SExpr{ .value = test_ }, test_.loc)) catch unreachable;
                                    }
                                }

                                return try p.appendIfBodyPreservingScope(stmts, data.yes);
                            } else {
                                // We have to keep the "no" branch
                            }
                        } else {
                            // The test is falsy
                            if (!SideEffects.shouldKeepStmtInDeadControlFlow(data.yes, p.allocator)) {
                                if (effects.side_effects == .could_have_side_effects) {
                                    // Keep the condition if it could have side effects (but is still known to be truthy)
                                    if (SideEffects.simpifyUnusedExpr(p, data.test_)) |test_| {
                                        stmts.append(p.s(S.SExpr{ .value = test_ }, test_.loc)) catch unreachable;
                                    }
                                }

                                // if (false) {
                                // }
                                if (data.no == null) {
                                    return;
                                }

                                return try p.appendIfBodyPreservingScope(stmts, data.no.?);
                            }
                        }
                    }
                },
                .s_for => |data| {
                    {
                        p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;

                        if (data.init) |initst| {
                            data.init = p.visitForLoopInit(initst, false);
                        }

                        if (data.test_) |test_| {
                            data.test_ = SideEffects.simplifyBoolean(p, p.visitExpr(test_));

                            const result = SideEffects.toBoolean(data.test_.?.data);
                            if (result.ok and result.value and result.side_effects == .no_side_effects) {
                                data.test_ = null;
                            }
                        }

                        if (data.update) |update| {
                            data.update = p.visitExpr(update);
                        }

                        data.body = p.visitLoopBody(data.body);

                        // Potentially relocate "var" declarations to the top level. Note that this
                        // must be done inside the scope of the for loop or they won't be relocated.
                        if (data.init) |init_| {
                            if (init_.data == .s_local and init_.data.s_local.kind == .k_var) {
                                const relocate = p.maybeRelocateVarsToTopLevel(init_.data.s_local.decls, .normal);
                                if (relocate.stmt) |relocated| {
                                    data.init = relocated;
                                }
                            }
                        }
                        p.popScope();
                    }
                },
                .s_for_in => |data| {
                    {
                        p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                        defer p.popScope();
                        _ = p.visitForLoopInit(data.init, true);
                        data.value = p.visitExpr(data.value);
                        data.body = p.visitLoopBody(data.body);

                        if (data.init.data == .s_local and data.init.data.s_local.kind == .k_var) {
                            const relocate = p.maybeRelocateVarsToTopLevel(data.init.data.s_local.decls, RelocateVars.Mode.for_in_or_for_of);
                            if (relocate.stmt) |relocated_stmt| {
                                data.init = relocated_stmt;
                            }
                        }
                    }
                },
                .s_for_of => |data| {
                    p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                    defer p.popScope();
                    _ = p.visitForLoopInit(data.init, true);
                    data.value = p.visitExpr(data.value);
                    data.body = p.visitLoopBody(data.body);

                    if (data.init.data == .s_local and data.init.data.s_local.kind == .k_var) {
                        const relocate = p.maybeRelocateVarsToTopLevel(data.init.data.s_local.decls, RelocateVars.Mode.for_in_or_for_of);
                        if (relocate.stmt) |relocated_stmt| {
                            data.init = relocated_stmt;
                        }
                    }
                },
                .s_try => |data| {
                    p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                    {
                        var _stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, data.body);
                        p.fn_or_arrow_data_visit.try_body_count += 1;
                        p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                        p.fn_or_arrow_data_visit.try_body_count -= 1;
                        data.body = _stmts.toOwnedSlice();
                    }
                    p.popScope();

                    if (data.catch_) |*catch_| {
                        p.pushScopeForVisitPass(.block, catch_.loc) catch unreachable;
                        {
                            if (catch_.binding != null) {
                                p.visitBinding(catch_.binding.?, null);
                            }
                            var _stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, catch_.body);
                            p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                            catch_.body = _stmts.toOwnedSlice();
                        }
                        p.popScope();
                    }

                    if (data.finally) |*finally| {
                        p.pushScopeForVisitPass(.block, finally.loc) catch unreachable;
                        {
                            var _stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, finally.stmts);
                            p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                            finally.stmts = _stmts.toOwnedSlice();
                        }
                        p.popScope();
                    }
                },
                .s_switch => |data| {
                    data.test_ = p.visitExpr(data.test_);
                    {
                        p.pushScopeForVisitPass(.block, data.body_loc) catch unreachable;
                        defer p.popScope();
                        var old_is_inside_Swsitch = p.fn_or_arrow_data_visit.is_inside_switch;
                        p.fn_or_arrow_data_visit.is_inside_switch = true;
                        defer p.fn_or_arrow_data_visit.is_inside_switch = old_is_inside_Swsitch;
                        var i: usize = 0;
                        while (i < data.cases.len) : (i += 1) {
                            const case = data.cases[i];
                            if (case.value) |val| {
                                data.cases[i].value = p.visitExpr(val);
                                // TODO: error messages
                                // Check("case", *c.Value, c.Value.Loc)
                                // 				p.warnAboutTypeofAndString(s.Test, *c.Value)
                            }
                            var _stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, case.body);
                            p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                            data.cases[i].body = _stmts.toOwnedSlice();
                        }
                    }
                    // TODO: duplicate case checker

                },
                .s_function => |data| {
                    // We mark it as dead, but the value may not actually be dead
                    // We just want to be sure to not increment the usage counts for anything in the function
                    const mark_as_dead = data.func.flags.contains(.is_export) and p.options.features.replace_exports.count() > 0 and p.isExportToEliminate(data.func.name.?.ref.?);
                    const original_is_dead = p.is_control_flow_dead;

                    if (mark_as_dead) {
                        p.is_control_flow_dead = true;
                    }
                    defer {
                        if (mark_as_dead) {
                            p.is_control_flow_dead = original_is_dead;
                        }
                    }

                    data.func = p.visitFunc(data.func, data.func.open_parens_loc);

                    // Handle exporting this function from a namespace
                    if (data.func.flags.contains(.is_export) and p.enclosing_namespace_arg_ref != null) {
                        data.func.flags.remove(.is_export);

                        const enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref orelse unreachable;
                        stmts.ensureUnusedCapacity(3) catch unreachable;
                        stmts.appendAssumeCapacity(stmt.*);
                        stmts.appendAssumeCapacity(Expr.assignStmt(p.e(E.Dot{
                            .target = p.e(E.Identifier{ .ref = enclosing_namespace_arg_ref }, stmt.loc),
                            .name = p.loadNameFromRef(data.func.name.?.ref.?),
                            .name_loc = data.func.name.?.loc,
                        }, stmt.loc), p.e(E.Identifier{ .ref = data.func.name.?.ref.? }, data.func.name.?.loc), p.allocator));
                    } else if (!mark_as_dead) {
                        stmts.append(stmt.*) catch unreachable;
                    } else if (mark_as_dead) {
                        const name = data.func.name.?.ref.?;
                        if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(name))) |replacement| {
                            _ = p.injectReplacementExport(stmts, name, data.func.name.?.loc, replacement);
                        }
                    }

                    // stmts.appendAssumeCapacity(
                    //     // i wonder if this will crash
                    //     p.keepStmtSymbolName(
                    //         data.func.name.?.loc,
                    //         data.func.name.?.ref.?,
                    //         p.symbols.items[data.func.name.?.ref.?.innerIndex()].original_name,
                    //     ),
                    // );
                    return;
                },
                .s_class => |data| {
                    const mark_as_dead = data.is_export and p.options.features.replace_exports.count() > 0 and p.isExportToEliminate(data.class.class_name.?.ref.?);
                    const original_is_dead = p.is_control_flow_dead;

                    if (mark_as_dead) {
                        p.is_control_flow_dead = true;
                    }
                    defer {
                        if (mark_as_dead) {
                            p.is_control_flow_dead = original_is_dead;
                        }
                    }

                    const shadow_ref = p.visitClass(stmt.loc, &data.class);

                    // Remove the export flag inside a namespace
                    const was_export_inside_namespace = data.is_export and p.enclosing_namespace_arg_ref != null;
                    if (was_export_inside_namespace) {
                        data.is_export = false;
                    }

                    const lowered = p.lowerClass(js_ast.StmtOrExpr{ .stmt = stmt.* }, shadow_ref);

                    if (!mark_as_dead or was_export_inside_namespace)
                        // Lower class field syntax for browsers that don't support it
                        stmts.appendSlice(lowered) catch unreachable
                    else {
                        const ref = data.class.class_name.?.ref.?;
                        if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(ref))) |replacement| {
                            if (p.injectReplacementExport(stmts, ref, data.class.class_name.?.loc, replacement)) {
                                p.is_control_flow_dead = original_is_dead;
                            }
                        }
                    }

                    // Handle exporting this class from a namespace
                    if (was_export_inside_namespace) {
                        stmts.appendAssumeCapacity(Expr.assignStmt(p.e(E.Dot{
                            .target = p.e(E.Identifier{ .ref = p.enclosing_namespace_arg_ref.? }, stmt.loc),
                            .name = p.symbols.items[data.class.class_name.?.ref.?.innerIndex()].original_name,
                            .name_loc = data.class.class_name.?.loc,
                        }, stmt.loc), p.e(E.Identifier{ .ref = data.class.class_name.?.ref.? }, data.class.class_name.?.loc), p.allocator));
                    }

                    return;
                },
                .s_enum => |data| {
                    p.recordDeclaredSymbol(data.name.ref.?) catch unreachable;
                    p.pushScopeForVisitPass(.entry, stmt.loc) catch unreachable;
                    defer p.popScope();
                    p.recordDeclaredSymbol(data.arg) catch unreachable;

                    const allocator = p.allocator;
                    // Scan ahead for any variables inside this namespace. This must be done
                    // ahead of time before visiting any statements inside the namespace
                    // because we may end up visiting the uses before the declarations.
                    // We need to convert the uses into property accesses on the namespace.
                    for (data.values) |value| {
                        if (!value.ref.isNull()) {
                            p.is_exported_inside_namespace.put(allocator, value.ref, data.arg) catch unreachable;
                        }
                    }

                    // Values without initializers are initialized to one more than the
                    // previous value if the previous value is numeric. Otherwise values
                    // without initializers are initialized to undefined.
                    var next_numeric_value: f64 = 0.0;
                    var has_numeric_value = true;

                    var value_exprs = ListManaged(Expr).initCapacity(allocator, data.values.len) catch unreachable;

                    // Track values so they can be used by constant folding. We need to follow
                    // links here in case the enum was merged with a preceding namespace
                    var values_so_far = _hash_map.StringHashMapUnmanaged(f64){};

                    p.known_enum_values.put(allocator, data.name.ref orelse p.panic("Expected data.name.ref", .{}), values_so_far) catch unreachable;
                    p.known_enum_values.put(allocator, data.arg, values_so_far) catch unreachable;

                    // We normally don't fold numeric constants because they might increase code
                    // size, but it's important to fold numeric constants inside enums since
                    // that's what the TypeScript compiler does.
                    const old_should_fold_numeric_constants = p.should_fold_numeric_constants;
                    p.should_fold_numeric_constants = true;
                    for (data.values) |*enum_value| {
                        // gotta allocate here so it lives after this function stack frame goes poof
                        const name = enum_value.name;
                        var assign_target: Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
                        var has_string_value = false;

                        if (enum_value.value != null) {
                            enum_value.value = p.visitExpr(enum_value.value.?);
                            switch (enum_value.value.?.data) {
                                .e_number => |num| {

                                    // prob never allocates in practice
                                    values_so_far.put(allocator, name.string(allocator) catch unreachable, num.value) catch unreachable;
                                    has_numeric_value = true;
                                    next_numeric_value = num.value + 1.0;
                                },
                                .e_string => {
                                    has_string_value = true;
                                },
                                else => {},
                            }
                        } else if (has_numeric_value) {
                            enum_value.value = p.e(E.Number{ .value = next_numeric_value }, enum_value.loc);
                            values_so_far.put(allocator, name.string(allocator) catch unreachable, next_numeric_value) catch unreachable;
                            next_numeric_value += 1;
                        } else {
                            enum_value.value = p.e(E.Undefined{}, enum_value.loc);
                        }
                        // "Enum['Name'] = value"
                        assign_target = Expr.assign(p.e(E.Index{
                            .target = p.e(
                                E.Identifier{ .ref = data.arg },
                                enum_value.loc,
                            ),
                            .index = p.e(
                                enum_value.name,
                                enum_value.loc,
                            ),
                        }, enum_value.loc), enum_value.value orelse unreachable, allocator);

                        p.recordUsage(data.arg);

                        // String-valued enums do not form a two-way map
                        if (has_string_value) {
                            value_exprs.append(assign_target) catch unreachable;
                        } else {
                            // "Enum[assignTarget] = 'Name'"
                            value_exprs.append(
                                Expr.assign(
                                    p.e(E.Index{
                                        .target = p.e(
                                            E.Identifier{ .ref = data.arg },
                                            enum_value.loc,
                                        ),
                                        .index = assign_target,
                                    }, enum_value.loc),
                                    p.e(enum_value.name, enum_value.loc),
                                    allocator,
                                ),
                            ) catch unreachable;
                        }
                        p.recordUsage(data.arg);
                    }

                    p.should_fold_numeric_constants = old_should_fold_numeric_constants;

                    var value_stmts = ListManaged(Stmt).initCapacity(allocator, value_exprs.items.len) catch unreachable;
                    // Generate statements from expressions
                    for (value_exprs.items) |expr| {
                        value_stmts.appendAssumeCapacity(p.s(S.SExpr{ .value = expr }, expr.loc));
                    }
                    value_exprs.deinit();
                    try p.generateClosureForTypeScriptNamespaceOrEnum(
                        stmts,
                        stmt.loc,
                        data.is_export,
                        data.name.loc,
                        data.name.ref.?,
                        data.arg,
                        value_stmts.toOwnedSlice(),
                    );
                    return;
                },
                .s_namespace => |data| {
                    p.recordDeclaredSymbol(data.name.ref.?) catch unreachable;

                    // Scan ahead for any variables inside this namespace. This must be done
                    // ahead of time before visiting any statements inside the namespace
                    // because we may end up visiting the uses before the declarations.
                    // We need to convert the uses into property accesses on the namespace.
                    for (data.stmts) |child_stmt| {
                        switch (child_stmt.data) {
                            .s_local => |local| {
                                if (local.is_export) {
                                    p.markExportedDeclsInsideNamespace(data.arg, local.decls);
                                }
                            },
                            else => {},
                        }
                    }

                    var prepend_temp_refs = PrependTempRefsOpts{ .kind = StmtsKind.fn_body };
                    var prepend_list = ListManaged(Stmt).fromOwnedSlice(p.allocator, data.stmts);

                    const old_enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref;
                    p.enclosing_namespace_arg_ref = data.arg;
                    p.pushScopeForVisitPass(.entry, stmt.loc) catch unreachable;
                    p.recordDeclaredSymbol(data.arg) catch unreachable;
                    p.visitStmtsAndPrependTempRefs(&prepend_list, &prepend_temp_refs) catch unreachable;
                    p.popScope();
                    p.enclosing_namespace_arg_ref = old_enclosing_namespace_arg_ref;

                    try p.generateClosureForTypeScriptNamespaceOrEnum(
                        stmts,
                        stmt.loc,
                        data.is_export,
                        data.name.loc,
                        data.name.ref.?,
                        data.arg,
                        prepend_list.items,
                    );
                    return;
                },
                else => {
                    notimpl();
                },
            }

            // if we get this far, it stays
            try stmts.append(stmt.*);
        }

        fn isExportToEliminate(p: *P, ref: Ref) bool {
            const symbol_name = p.loadNameFromRef(ref);
            return p.options.features.replace_exports.contains(symbol_name);
        }

        fn visitDecls(p: *P, decls: []G.Decl, comptime is_possibly_decl_to_remove: bool) usize {
            var i: usize = 0;
            const count = decls.len;
            var j: usize = 0;
            var out_decls = decls;
            while (i < count) : (i += 1) {
                p.visitBinding(decls[i].binding, null);

                if (decls[i].value != null) {
                    var val = decls[i].value.?;
                    const was_anonymous_named_expr = p.isAnonymousNamedExpr(val);
                    var replacement: ?*const RuntimeFeatures.ReplaceableExport = null;

                    const prev_macro_call_count = p.macro_call_count;
                    const orig_dead = p.is_control_flow_dead;
                    if (comptime is_possibly_decl_to_remove) {
                        if (decls[i].binding.data == .b_identifier) {
                            if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(decls[i].binding.data.b_identifier.ref))) |replacer| {
                                replacement = replacer;
                                if (replacer.* != .replace) {
                                    p.is_control_flow_dead = true;
                                }
                            }
                        }
                    }

                    decls[i].value = p.visitExpr(val);

                    if (comptime is_possibly_decl_to_remove) {
                        p.is_control_flow_dead = orig_dead;
                    }
                    if (comptime is_possibly_decl_to_remove) {
                        if (decls[i].binding.data == .b_identifier) {
                            if (replacement) |ptr| {
                                if (!p.replaceDeclAndPossiblyRemove(&decls[i], ptr)) {
                                    continue;
                                }
                            }
                        }
                    }

                    p.visitDecl(
                        &decls[i],
                        was_anonymous_named_expr,
                        if (comptime allow_macros)
                            prev_macro_call_count != p.macro_call_count
                        else
                            false,
                    );
                } else if (comptime is_possibly_decl_to_remove) {
                    if (decls[i].binding.data == .b_identifier) {
                        if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(decls[i].binding.data.b_identifier.ref))) |ptr| {
                            if (!p.replaceDeclAndPossiblyRemove(&decls[i], ptr)) {
                                p.visitDecl(
                                    &decls[i],
                                    false,
                                    false,
                                );
                            } else {
                                continue;
                            }
                        }
                    }
                }

                if (comptime is_possibly_decl_to_remove) {
                    out_decls[j] = decls[i];
                    j += 1;
                }
            }

            if (comptime is_possibly_decl_to_remove) {
                return j;
            }

            return decls.len;
        }

        fn injectReplacementExport(p: *P, stmts: *StmtList, name_ref: Ref, loc: logger.Loc, replacement: *const RuntimeFeatures.ReplaceableExport) bool {
            switch (replacement.*) {
                .delete => return false,
                .replace => |value| {
                    const count = stmts.items.len;
                    var decls = p.allocator.alloc(G.Decl, 1) catch unreachable;

                    decls[0] = .{ .binding = p.b(B.Identifier{ .ref = name_ref }, loc), .value = value };
                    var local = p.s(
                        S.Local{
                            .is_export = true,
                            .decls = decls,
                        },
                        loc,
                    );
                    p.visitAndAppendStmt(stmts, &local) catch unreachable;
                    return count != stmts.items.len;
                },
                .inject => |with| {
                    const count = stmts.items.len;
                    var decls = p.allocator.alloc(G.Decl, 1) catch unreachable;
                    decls[0] = .{
                        .binding = p.b(
                            B.Identifier{ .ref = p.declareSymbol(.other, loc, with.name) catch unreachable },
                            loc,
                        ),
                        .value = with.value,
                    };

                    var local = p.s(
                        S.Local{
                            .is_export = true,
                            .decls = decls,
                        },
                        loc,
                    );
                    p.visitAndAppendStmt(stmts, &local) catch unreachable;
                    return count != stmts.items.len;
                },
            }
        }

        fn replaceDeclAndPossiblyRemove(p: *P, decl: *G.Decl, replacement: *const RuntimeFeatures.ReplaceableExport) bool {
            switch (replacement.*) {
                .delete => return false,
                .replace => |value| {
                    decl.*.value = p.visitExpr(value);
                    return true;
                },
                .inject => |with| {
                    decl.* = .{
                        .binding = p.b(
                            B.Identifier{ .ref = p.declareSymbol(.other, decl.binding.loc, with.name) catch unreachable },
                            decl.binding.loc,
                        ),
                        .value = p.visitExpr(Expr{ .data = with.value.data, .loc = if (decl.value != null) decl.value.?.loc else decl.binding.loc }),
                    };
                    return true;
                },
            }
        }

        fn visitBindingAndExprForMacro(p: *P, binding: Binding, expr: Expr) void {
            switch (binding.data) {
                .b_object => |bound_object| {
                    if (expr.data == .e_object and
                        expr.data.e_object.was_originally_macro)
                    {
                        var object = expr.data.e_object;
                        for (bound_object.properties) |property| {
                            if (property.flags.contains(.is_spread)) return;
                        }
                        var output_properties = object.properties.slice();
                        var end: u32 = 0;
                        for (bound_object.properties) |property| {
                            if (property.key.asString(p.allocator)) |name| {
                                if (object.asProperty(name)) |query| {
                                    switch (query.expr.data) {
                                        .e_object, .e_array => p.visitBindingAndExprForMacro(property.value, query.expr),
                                        else => {},
                                    }
                                    output_properties[end] = output_properties[query.i];
                                    end += 1;
                                }
                            }
                        }

                        object.properties.len = end;
                    }
                },
                .b_array => |bound_array| {
                    if (expr.data == .e_array and
                        expr.data.e_array.was_originally_macro and !bound_array.has_spread)
                    {
                        var array = expr.data.e_array;

                        array.items.len = @minimum(array.items.len, @truncate(u32, bound_array.items.len));
                        var slice = array.items.slice();
                        for (bound_array.items[0..array.items.len]) |item, item_i| {
                            const child_expr = slice[item_i];
                            if (item.binding.data == .b_missing) {
                                slice[item_i] = p.e(E.Missing{}, expr.loc);
                                continue;
                            }

                            p.visitBindingAndExprForMacro(item.binding, child_expr);
                        }
                    }
                },
                else => {},
            }
        }

        fn visitDecl(p: *P, decl: *Decl, was_anonymous_named_expr: bool, could_be_macro: bool) void {
            // Optionally preserve the name
            switch (decl.binding.data) {
                .b_identifier => |id| {
                    decl.value = p.maybeKeepExprSymbolName(
                        decl.value.?,
                        p.symbols.items[id.ref.innerIndex()].original_name,
                        was_anonymous_named_expr,
                    );
                },
                .b_object, .b_array => {
                    if (comptime allow_macros) {
                        if (could_be_macro and decl.value != null) {
                            p.visitBindingAndExprForMacro(decl.binding, decl.value.?);
                        }
                    }
                },
                else => {},
            }
        }

        pub fn markExportedDeclsInsideNamespace(p: *P, ns_ref: Ref, decls: []G.Decl) void {
            for (decls) |decl| {
                p.markExportedBindingInsideNamespace(ns_ref, decl.binding);
            }
        }

        pub fn appendIfBodyPreservingScope(p: *P, stmts: *ListManaged(Stmt), body: Stmt) !void {
            switch (body.data) {
                .s_block => |block| {
                    var keep_block = false;
                    for (block.stmts) |stmt| {
                        if (statementCaresAboutScope(stmt)) {
                            keep_block = true;
                            break;
                        }
                    }

                    if (!keep_block and block.stmts.len > 0) {
                        try stmts.appendSlice(block.stmts);
                        return;
                    }
                },
                else => {},
            }

            if (statementCaresAboutScope(body)) {
                var block_stmts = try p.allocator.alloc(Stmt, 1);
                block_stmts[0] = body;
                try stmts.append(p.s(S.Block{ .stmts = block_stmts }, body.loc));
                return;
            }

            try stmts.append(body);
            return;
        }

        fn markExportedBindingInsideNamespace(p: *P, ref: Ref, binding: BindingNodeIndex) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |ident| {
                    p.is_exported_inside_namespace.put(p.allocator, ident.ref, ref) catch unreachable;
                },
                .b_array => |array| {
                    for (array.items) |item| {
                        p.markExportedBindingInsideNamespace(ref, item.binding);
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |item| {
                        p.markExportedBindingInsideNamespace(ref, item.value);
                    }
                },
                else => {
                    Global.panic("Unexpected binding type in namespace. This is a bug. {s}", .{binding});
                },
            }
        }

        fn generateClosureForTypeScriptNamespaceOrEnum(
            p: *P,
            stmts: *ListManaged(Stmt),
            stmt_loc: logger.Loc,
            is_export: bool,
            name_loc: logger.Loc,
            _name_ref: Ref,
            arg_ref: Ref,
            stmts_inside_closure: []Stmt,
        ) anyerror!void {
            var name_ref = _name_ref;
            // Follow the link chain in case symbols were merged
            var symbol: Symbol = p.symbols.items[name_ref.innerIndex()];
            while (symbol.hasLink()) {
                const link = symbol.link;
                name_ref = link;
                symbol = p.symbols.items[name_ref.innerIndex()];
            }
            const allocator = p.allocator;

            // Make sure to only emit a variable once for a given namespace, since there
            // can be multiple namespace blocks for the same namespace
            if (symbol.kind == .ts_namespace or symbol.kind == .ts_enum and !p.emitted_namespace_vars.contains(name_ref)) {
                p.emitted_namespace_vars.put(allocator, name_ref, .{}) catch unreachable;

                var decls = allocator.alloc(G.Decl, 1) catch unreachable;
                decls[0] = G.Decl{ .binding = p.b(B.Identifier{ .ref = name_ref }, name_loc) };

                if (p.enclosing_namespace_arg_ref == null) {
                    // Top-level namespace
                    stmts.append(
                        p.s(
                            S.Local{
                                .kind = .k_var,
                                .decls = decls,
                                .is_export = is_export,
                            },
                            stmt_loc,
                        ),
                    ) catch unreachable;
                } else {
                    // Nested namespace
                    stmts.append(
                        p.s(
                            S.Local{
                                .kind = .k_let,
                                .decls = decls,
                            },
                            stmt_loc,
                        ),
                    ) catch unreachable;
                }
            }

            var arg_expr: Expr = undefined;

            if (is_export and p.enclosing_namespace_arg_ref != null) {
                const namespace = p.enclosing_namespace_arg_ref.?;
                // "name = enclosing.name || (enclosing.name = {})"
                const name = p.symbols.items[name_ref.innerIndex()].original_name;
                arg_expr = Expr.assign(
                    Expr.initIdentifier(name_ref, name_loc),
                    p.e(
                        E.Binary{
                            .op = .bin_logical_or,
                            .left = p.e(
                                E.Dot{
                                    .target = Expr.initIdentifier(namespace, name_loc),
                                    .name = name,
                                    .name_loc = name_loc,
                                },
                                name_loc,
                            ),
                            .right = Expr.assign(
                                p.e(
                                    E.Dot{
                                        .target = Expr.initIdentifier(namespace, name_loc),
                                        .name = name,
                                        .name_loc = name_loc,
                                    },
                                    name_loc,
                                ),
                                p.e(E.Object{}, name_loc),
                                allocator,
                            ),
                        },
                        name_loc,
                    ),
                    allocator,
                );
                p.recordUsage(namespace);
                p.recordUsage(namespace);
                p.recordUsage(name_ref);
            } else {
                // "name || (name = {})"
                arg_expr = p.e(E.Binary{
                    .op = .bin_logical_or,
                    .left = Expr.initIdentifier(name_ref, name_loc),
                    .right = Expr.assign(
                        Expr.initIdentifier(name_ref, name_loc),
                        p.e(
                            E.Object{},
                            name_loc,
                        ),
                        allocator,
                    ),
                }, name_loc);
                p.recordUsage(name_ref);
                p.recordUsage(name_ref);
            }

            var func_args = allocator.alloc(G.Arg, 1) catch unreachable;
            func_args[0] = .{ .binding = p.b(B.Identifier{ .ref = arg_ref }, name_loc) };
            var args_list = allocator.alloc(ExprNodeIndex, 1) catch unreachable;
            args_list[0] = arg_expr;
            const func = G.Fn{
                .args = func_args,
                .name = null,
                .open_parens_loc = stmt_loc,
                .body = G.FnBody{
                    .loc = stmt_loc,
                    .stmts = try allocator.dupe(StmtNodeIndex, stmts_inside_closure),
                },
            };
            const target = p.e(
                E.Function{
                    .func = func,
                },
                stmt_loc,
            );

            const call = p.e(
                E.Call{
                    .target = target,
                    .args = ExprNodeList.init(args_list),
                },
                stmt_loc,
            );

            const closure = p.s(
                S.SExpr{
                    .value = call,
                },
                stmt_loc,
            );

            stmts.append(closure) catch unreachable;
        }

        // TODO: https://github.com/oven-sh/bun/issues/51
        fn lowerClass(
            p: *P,
            stmtorexpr: js_ast.StmtOrExpr,
            // ref
            _: Ref,
        ) []Stmt {
            switch (stmtorexpr) {
                .stmt => |stmt| {
                    var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                    stmts[0] = stmt;
                    return stmts;
                },
                .expr => |expr| {
                    var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                    stmts[0] = p.s(S.SExpr{ .value = expr }, expr.loc);
                    return stmts;
                },
            }
        }

        fn visitForLoopInit(p: *P, stmt: Stmt, is_in_or_of: bool) Stmt {
            switch (stmt.data) {
                .s_expr => |st| {
                    const assign_target = if (is_in_or_of) js_ast.AssignTarget.replace else js_ast.AssignTarget.none;
                    p.stmt_expr_value = st.value.data;
                    st.value = p.visitExprInOut(st.value, ExprIn{ .assign_target = assign_target });
                },
                .s_local => |st| {
                    for (st.decls) |*dec| {
                        p.visitBinding(dec.binding, null);
                        if (dec.value) |val| {
                            dec.value = p.visitExpr(val);
                        }
                    }
                    // st.kind = .k_var;
                    //         		s.Decls = p.lowerObjectRestInDecls(s.Decls)
                    // s.Kind = p.selectLocalKind(s.Kind)
                },
                else => {
                    p.panic("Unexpected stmt in visitForLoopInit: {s}", .{stmt});
                },
            }

            return stmt;
        }

        fn wrapIdentifierNamespace(
            p: *P,
            loc: logger.Loc,
            ref: Ref,
        ) Expr {
            const enclosing_ref = p.enclosing_namespace_arg_ref.?;
            p.recordUsage(enclosing_ref);

            return p.e(E.Dot{
                .target = Expr.initIdentifier(enclosing_ref, loc),
                .name = p.symbols.items[ref.innerIndex()].original_name,
                .name_loc = loc,
            }, loc);
        }

        fn wrapIdentifierHoisting(
            p: *P,
            loc: logger.Loc,
            ref: Ref,
        ) Expr {
            p.relocated_top_level_vars.append(p.allocator, LocRef{ .loc = loc, .ref = ref }) catch unreachable;
            var _ref = ref;
            p.recordUsage(_ref);
            return Expr.initIdentifier(_ref, loc);
        }

        fn isAnonymousNamedExpr(_: *P, expr: ExprNodeIndex) bool {
            switch (expr.data) {
                .e_arrow => {
                    return true;
                },
                .e_function => |func| {
                    return func.func.name == null;
                },
                .e_class => |class| {
                    return class.class_name == null;
                },
                else => {
                    return false;
                },
            }
        }

        fn valueForDefine(p: *P, loc: logger.Loc, assign_target: js_ast.AssignTarget, is_delete_target: bool, define_data: *const DefineData) Expr {
            switch (define_data.value) {
                .e_identifier => {
                    return p.handleIdentifier(
                        loc,
                        define_data.value.e_identifier,
                        define_data.original_name.?,
                        IdentifierOpts{
                            .assign_target = assign_target,
                            .is_delete_target = is_delete_target,
                            .was_originally_identifier = true,
                        },
                    );
                },
                .e_string => |str| {
                    return p.e(str, loc);
                },
                else => {},
            }

            return Expr{
                .data = define_data.value,
                .loc = loc,
            };
        }

        // This function is recursive
        // But it shouldn't be that long
        fn isDotDefineMatch(p: *P, expr: Expr, parts: []const string) bool {
            switch (expr.data) {
                .e_dot => |ex| {
                    if (parts.len > 1) {
                        if (ex.optional_chain != null) {
                            return false;
                        }

                        // Intermediates must be dot expressions
                        const last = parts.len - 1;
                        const is_tail_match = strings.eql(parts[last], ex.name);
                        return is_tail_match and p.isDotDefineMatch(ex.target, parts[0..last]);
                    }
                },
                .e_import_meta => {
                    return parts.len == 2 and strings.eqlComptime(parts[0], "import") and strings.eqlComptime(parts[1], "meta");
                },
                // Note: this behavior differs from esbuild
                // esbuild does not try to match index accessors
                // we do, but only if it's a UTF8 string
                // the intent is to handle people using this form instead of E.Dot. So we really only want to do this if the accessor can also be an identifier
                .e_index => |index| {
                    if (parts.len > 1 and index.index.data == .e_string and index.index.data.e_string.isUTF8()) {
                        if (index.optional_chain != null) {
                            return false;
                        }

                        const last = parts.len - 1;
                        const is_tail_match = strings.eql(parts[last], index.index.data.e_string.slice(p.allocator));
                        return is_tail_match and p.isDotDefineMatch(index.target, parts[0..last]);
                    }
                },
                .e_identifier => |ex| {

                    // The last expression must be an identifier
                    if (parts.len == 1) {
                        const name = p.loadNameFromRef(ex.ref);
                        if (!strings.eql(name, parts[0])) {
                            return false;
                        }

                        const result = p.findSymbol(expr.loc, name) catch return false;

                        // We must not be in a "with" statement scope
                        if (result.is_inside_with_scope) {
                            return false;
                        }

                        // The last symbol must be unbound
                        return p.symbols.items[result.ref.innerIndex()].kind == .unbound;
                    }
                },
                else => {},
            }

            return false;
        }

        fn visitBinding(p: *P, binding: BindingNodeIndex, duplicate_arg_check: ?*StringVoidMap) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |bind| {
                    p.recordDeclaredSymbol(bind.ref) catch unreachable;
                    const name = p.symbols.items[bind.ref.innerIndex()].original_name;
                    if (isEvalOrArguments(name)) {
                        p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, binding.loc), name) catch unreachable;
                    }
                    if (duplicate_arg_check) |dup| {
                        if (dup.getOrPutContains(name)) {
                            p.log.addRangeErrorFmt(
                                p.source,
                                js_lexer.rangeOfIdentifier(p.source, binding.loc),
                                p.allocator,
                                "\"{s}\" cannot be bound multiple times in the same parameter list",
                                .{name},
                            ) catch unreachable;
                        }
                    }
                },
                .b_array => |bind| {
                    for (bind.items) |*item| {
                        p.visitBinding(item.binding, duplicate_arg_check);
                        if (item.default_value) |default_value| {
                            const was_anonymous_named_expr = p.isAnonymousNamedExpr(default_value);
                            item.default_value = p.visitExpr(default_value);

                            switch (item.binding.data) {
                                .b_identifier => |bind_| {
                                    item.default_value = p.maybeKeepExprSymbolName(
                                        item.default_value orelse unreachable,
                                        p.symbols.items[bind_.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                },
                                else => {},
                            }
                        }
                    }
                },
                .b_object => |bind| {
                    for (bind.properties) |*property| {
                        if (!property.flags.contains(.is_spread)) {
                            property.key = p.visitExpr(property.key);
                        }

                        p.visitBinding(property.value, duplicate_arg_check);
                        if (property.default_value) |default_value| {
                            const was_anonymous_named_expr = p.isAnonymousNamedExpr(default_value);
                            property.default_value = p.visitExpr(default_value);

                            switch (property.value.data) {
                                .b_identifier => |bind_| {
                                    property.default_value = p.maybeKeepExprSymbolName(
                                        property.default_value orelse unreachable,
                                        p.symbols.items[bind_.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                },
                                else => {},
                            }
                        }
                    }
                },
                else => {
                    p.panic("Unexpected binding {s}", .{binding});
                },
            }
        }

        fn visitLoopBody(p: *P, stmt: StmtNodeIndex) StmtNodeIndex {
            const old_is_inside_loop = p.fn_or_arrow_data_visit.is_inside_loop;
            p.fn_or_arrow_data_visit.is_inside_loop = true;
            p.loop_body = stmt.data;
            const res = p.visitSingleStmt(stmt, .loop_body);
            p.fn_or_arrow_data_visit.is_inside_loop = old_is_inside_loop;
            return res;
        }

        fn visitSingleStmt(p: *P, stmt: Stmt, kind: StmtsKind) Stmt {
            const has_if_scope = switch (stmt.data) {
                .s_function => stmt.data.s_function.func.flags.contains(.has_if_scope),
                else => false,
            };

            // Introduce a fake block scope for function declarations inside if statements
            if (has_if_scope) {
                p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
            }

            var stmts = ListManaged(Stmt).initCapacity(p.allocator, 1) catch unreachable;
            stmts.append(stmt) catch unreachable;
            p.visitStmts(&stmts, kind) catch unreachable;

            if (has_if_scope) {
                p.popScope();
            }

            return p.stmtsToSingleStmt(stmt.loc, stmts.toOwnedSlice());
        }

        // One statement could potentially expand to several statements
        fn stmtsToSingleStmt(p: *P, loc: logger.Loc, stmts: []Stmt) Stmt {
            if (stmts.len == 0) {
                return Stmt{ .data = Prefill.Data.SEmpty, .loc = loc };
            }

            if (stmts.len == 1 and std.meta.activeTag(stmts[0].data) != .s_local or (std.meta.activeTag(stmts[0].data) == .s_local and stmts[0].data.s_local.kind == S.Local.Kind.k_var)) {
                // "let" and "const" must be put in a block when in a single-statement context
                return stmts[0];
            }

            return p.s(S.Block{ .stmts = stmts }, loc);
        }

        fn findLabelSymbol(p: *P, loc: logger.Loc, name: string) FindLabelSymbolResult {
            var res = FindLabelSymbolResult{ .ref = Ref.None, .is_loop = false };

            var _scope: ?*Scope = p.current_scope;

            while (_scope != null and !_scope.?.kindStopsHoisting()) : (_scope = _scope.?.parent.?) {
                const scope = _scope orelse unreachable;
                const label_ref = scope.label_ref orelse continue;
                if (scope.kind == .label and strings.eql(name, p.symbols.items[label_ref.innerIndex()].original_name)) {
                    // Track how many times we've referenced this symbol
                    p.recordUsage(label_ref);
                    res.ref = label_ref;
                    res.is_loop = scope.label_stmt_is_loop;
                    res.found = true;
                    return res;
                }
            }

            const r = js_lexer.rangeOfIdentifier(p.source, loc);
            p.log.addRangeErrorFmt(p.source, r, p.allocator, "There is no containing label named \"{s}\"", .{name}) catch unreachable;

            // Allocate an "unbound" symbol
            var ref = p.newSymbol(.unbound, name) catch unreachable;

            // Track how many times we've referenced this symbol
            p.recordUsage(ref);

            return res;
        }

        fn visitClass(p: *P, name_scope_loc: logger.Loc, class: *G.Class) Ref {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            class.ts_decorators = p.visitTSDecorators(class.ts_decorators);

            if (class.class_name) |name| {
                p.recordDeclaredSymbol(name.ref.?) catch unreachable;
            }

            p.pushScopeForVisitPass(.class_name, name_scope_loc) catch unreachable;
            const old_enclosing_class_keyword = p.enclosing_class_keyword;
            p.enclosing_class_keyword = class.class_keyword;
            p.current_scope.recursiveSetStrictMode(.implicit_strict_mode_class);
            var class_name_ref: Ref = if (class.class_name != null)
                class.class_name.?.ref.?
            else
                p.newSymbol(.other, "this") catch unreachable;

            var shadow_ref = Ref.None;

            if (!class_name_ref.eql(Ref.None)) {
                // are not allowed to assign to this symbol (it throws a TypeError).
                const name = p.symbols.items[class_name_ref.innerIndex()].original_name;
                var identifier = p.allocator.alloc(u8, name.len + 1) catch unreachable;
                std.mem.copy(u8, identifier[1..identifier.len], name);
                identifier[0] = '_';
                shadow_ref = p.newSymbol(Symbol.Kind.cconst, identifier) catch unreachable;
                p.recordDeclaredSymbol(shadow_ref) catch unreachable;
                if (class.class_name) |class_name| {
                    p.current_scope.members.put(p.allocator, identifier, Scope.Member{ .loc = class_name.loc, .ref = shadow_ref }) catch unreachable;
                }
            }

            if (class.extends) |extends| {
                class.extends = p.visitExpr(extends);
            }

            p.pushScopeForVisitPass(.class_body, class.body_loc) catch unreachable;
            defer {
                p.popScope();
                p.enclosing_class_keyword = old_enclosing_class_keyword;
            }

            var i: usize = 0;
            var constructor_function: ?*E.Function = null;
            while (i < class.properties.len) : (i += 1) {
                var property = &class.properties[i];

                if (property.kind == .class_static_block) {
                    var old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
                    var old_fn_only_data = p.fn_only_data_visit;
                    p.fn_or_arrow_data_visit = .{};
                    p.fn_only_data_visit = .{ .is_this_nested = true, .is_new_target_allowed = true };

                    p.pushScopeForVisitPass(.class_static_init, property.class_static_block.?.loc) catch unreachable;

                    // Make it an error to use "arguments" in a static class block
                    p.current_scope.forbid_arguments = true;

                    var list = property.class_static_block.?.stmts.listManaged(p.allocator);
                    p.visitStmts(&list, .fn_body) catch unreachable;
                    property.class_static_block.?.stmts = js_ast.BabyList(Stmt).fromList(list);
                    p.popScope();

                    p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
                    p.fn_only_data_visit = old_fn_only_data;

                    continue;
                }
                property.ts_decorators = p.visitTSDecorators(property.ts_decorators);
                const is_private = if (property.key != null) @as(Expr.Tag, property.key.?.data) == .e_private_identifier else false;

                // Special-case EPrivateIdentifier to allow it here

                if (is_private) {
                    p.recordDeclaredSymbol(property.key.?.data.e_private_identifier.ref) catch unreachable;
                } else if (property.key) |key| {
                    class.properties[i].key = p.visitExpr(key);
                }

                // Make it an error to use "arguments" in a class body
                p.current_scope.forbid_arguments = true;
                defer p.current_scope.forbid_arguments = false;

                // The value of "this" is shadowed inside property values
                const old_is_this_captured = p.fn_only_data_visit.is_this_nested;
                const old_this = p.fn_only_data_visit.this_class_static_ref;
                p.fn_only_data_visit.is_this_nested = true;
                p.fn_only_data_visit.is_new_target_allowed = true;
                p.fn_only_data_visit.this_class_static_ref = null;
                defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                defer p.fn_only_data_visit.this_class_static_ref = old_this;

                // We need to explicitly assign the name to the property initializer if it
                // will be transformed such that it is no longer an inline initializer.

                var constructor_function_: ?*E.Function = null;

                var name_to_keep: ?string = null;
                if (is_private) {} else if (!property.flags.contains(.is_method) and !property.flags.contains(.is_computed)) {
                    if (property.key) |key| {
                        if (@as(Expr.Tag, key.data) == .e_string) {
                            name_to_keep = key.data.e_string.string(p.allocator) catch unreachable;
                        }
                    }
                } else if (property.flags.contains(.is_method)) {
                    if (comptime is_typescript_enabled) {
                        if (property.value.?.data == .e_function and property.key.?.data == .e_string and
                            property.key.?.data.e_string.eqlComptime("constructor"))
                        {
                            constructor_function_ = property.value.?.data.e_function;
                            constructor_function = constructor_function_;
                        }
                    }
                }

                if (property.value) |val| {
                    if (name_to_keep) |name| {
                        const was_anon = p.isAnonymousNamedExpr(val);
                        property.value = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                    } else {
                        property.value = p.visitExpr(val);
                    }

                    if (comptime is_typescript_enabled) {
                        if (constructor_function_ != null and property.value != null and property.value.?.data == .e_function) {
                            constructor_function = property.value.?.data.e_function;
                        }
                    }
                }

                if (property.initializer) |val| {
                    // if (property.flags.is_static and )
                    if (name_to_keep) |name| {
                        const was_anon = p.isAnonymousNamedExpr(val);
                        property.initializer = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                    } else {
                        property.initializer = p.visitExpr(val);
                    }
                }
            }

            // note: our version assumes useDefineForClassFields is true
            if (comptime is_typescript_enabled) {
                if (constructor_function) |constructor| {
                    var to_add: usize = 0;
                    for (constructor.func.args) |arg| {
                        to_add += @boolToInt(arg.is_typescript_ctor_field and arg.binding.data == .b_identifier);
                    }

                    if (to_add > 0) {
                        // to match typescript behavior, we also must prepend to the class body
                        var stmts = std.ArrayList(Stmt).fromOwnedSlice(p.allocator, constructor.func.body.stmts);
                        stmts.ensureUnusedCapacity(to_add) catch unreachable;
                        var class_body = std.ArrayList(G.Property).fromOwnedSlice(p.allocator, class.properties);
                        class_body.ensureUnusedCapacity(to_add) catch unreachable;
                        var j: usize = 0;

                        for (constructor.func.args) |arg| {
                            if (arg.is_typescript_ctor_field) {
                                switch (arg.binding.data) {
                                    .b_identifier => |id| {
                                        const name = p.symbols.items[id.ref.innerIndex()].original_name;
                                        const ident = p.e(E.Identifier{ .ref = id.ref }, arg.binding.loc);
                                        stmts.appendAssumeCapacity(
                                            Expr.assignStmt(
                                                p.e(E.Dot{
                                                    .target = p.e(E.This{}, arg.binding.loc),
                                                    .name = name,
                                                    .name_loc = arg.binding.loc,
                                                }, arg.binding.loc),
                                                ident,
                                                p.allocator,
                                            ),
                                        );
                                        // O(N)
                                        class_body.items.len += 1;
                                        std.mem.copyBackwards(G.Property, class_body.items[j + 1 .. class_body.items.len], class_body.items[j .. class_body.items.len - 1]);
                                        class_body.items[j] = G.Property{ .key = ident };
                                        j += 1;
                                    },
                                    else => {},
                                }
                            }
                        }

                        class.properties = class_body.toOwnedSlice();
                        constructor.func.body.stmts = stmts.toOwnedSlice();
                    }
                }
            }

            if (!shadow_ref.eql(Ref.None)) {
                if (p.symbols.items[shadow_ref.innerIndex()].use_count_estimate == 0) {
                    // Don't generate a shadowing name if one isn't needed
                    shadow_ref = Ref.None;
                } else if (class.class_name) |_| {
                    // If there was originally no class name but something inside needed one
                    // (e.g. there was a static property initializer that referenced "this"),
                    // store our generated name so the class expression ends up with a name.
                    class.class_name = LocRef{ .loc = name_scope_loc, .ref = class_name_ref };
                    p.current_scope.generated.append(p.allocator, class_name_ref) catch unreachable;
                    p.recordDeclaredSymbol(class_name_ref) catch unreachable;
                }
            }

            return shadow_ref;
        }

        fn keepStmtSymbolName(p: *P, loc: logger.Loc, ref: Ref, name: string) Stmt {
            p.expr_list.ensureUnusedCapacity(2) catch unreachable;
            const start = p.expr_list.items.len;
            p.expr_list.appendAssumeCapacity(p.e(E.Identifier{
                .ref = ref,
            }, loc));
            p.expr_list.appendAssumeCapacity(p.e(E.String{ .data = name }, loc));
            return p.s(S.SExpr{
                // I believe that this is a spot we can do $RefreshReg$(name)
                .value = p.callRuntime(loc, "__name", p.expr_list.items[start..p.expr_list.items.len]),

                // Make sure tree shaking removes this if the function is never used
                .does_not_affect_tree_shaking = true,
            }, loc);
        }

        pub fn callRuntime(p: *P, loc: logger.Loc, comptime name: string, args: []Expr) Expr {
            var ref: Ref = undefined;
            p.has_called_runtime = true;

            if (!p.runtime_imports.contains(name)) {
                ref = brk: {
                    if (comptime strings.eqlComptime(name, "__require")) {
                        p.runtime_imports.__require = GeneratedSymbol{
                            .backup = declareSymbolMaybeGenerated(p, .other, logger.Loc.Empty, StaticSymbolName.List.__require.backup, true) catch unreachable,
                            .primary = p.require_ref,
                            .ref = declareSymbolMaybeGenerated(p, .other, logger.Loc.Empty, StaticSymbolName.List.__require.internal, true) catch unreachable,
                        };
                        p.runtime_imports.put(name, p.runtime_imports.__require.?);
                        break :brk p.runtime_imports.__require.?.ref;
                    }
                    const generated_symbol = p.declareGeneratedSymbol(.other, name) catch unreachable;
                    p.runtime_imports.put(name, generated_symbol);
                    break :brk generated_symbol.ref;
                };

                p.module_scope.generated.append(p.allocator, ref) catch unreachable;
            } else {
                ref = p.runtime_imports.at(name).?;
            }

            p.recordUsage(ref);
            return p.e(E.Call{
                .target = p.e(E.Identifier{
                    .ref = ref,
                }, loc),
                .args = ExprNodeList.init(args),
            }, loc);
        }

        // Try separating the list for appending, so that it's not a pointer.
        fn visitStmts(p: *P, stmts: *ListManaged(Stmt), _: StmtsKind) !void {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            // Save the current control-flow liveness. This represents if we are
            // currently inside an "if (false) { ... }" block.
            var old_is_control_flow_dead = p.is_control_flow_dead;
            defer p.is_control_flow_dead = old_is_control_flow_dead;

            // visit all statements first
            var visited = try ListManaged(Stmt).initCapacity(p.allocator, stmts.items.len);
            var before = ListManaged(Stmt).init(p.allocator);
            var after = ListManaged(Stmt).init(p.allocator);

            if (p.current_scope == p.module_scope) {
                p.macro.prepend_stmts = &before;
            }

            defer before.deinit();
            defer visited.deinit();
            defer after.deinit();

            for (stmts.items) |*stmt| {
                const list = list_getter: {
                    switch (stmt.data) {
                        .s_export_equals => {
                            // TypeScript "export = value;" becomes "module.exports = value;". This
                            // must happen at the end after everything is parsed because TypeScript
                            // moves this statement to the end when it generates code.
                            break :list_getter &after;
                        },
                        .s_function => |data| {
                            // Manually hoist block-level function declarations to preserve semantics.
                            // This is only done for function declarations that are not generators
                            // or async functions, since this is a backwards-compatibility hack from
                            // Annex B of the JavaScript standard.
                            if (!p.current_scope.kindStopsHoisting() and p.symbols.items[data.func.name.?.ref.?.innerIndex()].kind == .hoisted_function) {
                                break :list_getter &before;
                            }
                        },
                        else => {},
                    }
                    break :list_getter &visited;
                };
                try p.visitAndAppendStmt(list, stmt);
            }

            var visited_count = visited.items.len;
            if (p.is_control_flow_dead) {
                var end: usize = 0;
                for (visited.items) |item| {
                    if (!SideEffects.shouldKeepStmtInDeadControlFlow(item, p.allocator)) {
                        continue;
                    }

                    visited.items[end] = item;
                    end += 1;
                }
                visited_count = end;
            }

            const total_size = visited_count + before.items.len + after.items.len;

            if (total_size != stmts.items.len) {
                try stmts.resize(total_size);
            }

            var i: usize = 0;

            for (before.items) |item| {
                stmts.items[i] = item;
                i += 1;
            }

            const visited_slice = visited.items[0..visited_count];
            for (visited_slice) |item| {
                stmts.items[i] = item;
                i += 1;
            }

            for (after.items) |item| {
                stmts.items[i] = item;
                i += 1;
            }
        }

        fn extractDeclsForBinding(binding: Binding, decls: *ListManaged(G.Decl)) !void {
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

        pub inline fn @"module.exports"(p: *P, loc: logger.Loc) Expr {
            return p.e(E.Dot{ .name = exports_string_name, .name_loc = loc, .target = p.e(E.Identifier{ .ref = p.module_ref }, loc) }, loc);
        }

        // This assumes that the open parenthesis has already been parsed by the caller
        pub fn parseParenExpr(p: *P, loc: logger.Loc, level: Level, opts: ParenExprOpts) anyerror!Expr {
            var items_list = ListManaged(Expr).init(p.allocator);
            var errors = DeferredErrors{};
            var arrowArgErrors = DeferredArrowArgErrors{};
            var spread_range = logger.Range{};
            var type_colon_range = logger.Range{};
            var comma_after_spread: ?logger.Loc = null;

            // Push a scope assuming this is an arrow function. It may not be, in which
            // case we'll need to roll this change back. This has to be done ahead of
            // parsing the arguments instead of later on when we hit the "=>" token and
            // we know it's an arrow function because the arguments may have default
            // values that introduce new scopes and declare new symbols. If this is an
            // arrow function, then those new scopes will need to be parented under the
            // scope of the arrow function itself.
            const scope_index = try p.pushScopeForParsePass(.function_args, loc);

            // Allow "in" inside parentheses
            var oldAllowIn = p.allow_in;
            p.allow_in = true;

            // Forbid "await" and "yield", but only for arrow functions
            var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);
            p.fn_or_arrow_data_parse.arrow_arg_errors = arrowArgErrors;
            p.fn_or_arrow_data_parse.track_arrow_arg_errors = true;

            // Scan over the comma-separated arguments or expressions
            while (p.lexer.token != .t_close_paren) {
                const is_spread = p.lexer.token == .t_dot_dot_dot;

                if (is_spread) {
                    spread_range = p.lexer.range();
                    // p.markSyntaxFeature()
                    try p.lexer.next();
                }

                // We don't know yet whether these are arguments or expressions, so parse
                p.latest_arrow_arg_loc = p.lexer.loc();

                var item = try p.parseExprOrBindings(.comma, &errors);

                if (is_spread) {
                    item = p.e(E.Spread{ .value = item }, loc);
                }

                // Skip over types
                if (is_typescript_enabled and p.lexer.token == .t_colon) {
                    type_colon_range = p.lexer.range();
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);
                }

                // There may be a "=" after the type (but not after an "as" cast)
                if (is_typescript_enabled and p.lexer.token == .t_equals and !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())) {
                    try p.lexer.next();
                    item = Expr.assign(item, try p.parseExpr(.comma), p.allocator);
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
                try p.lexer.next();
            }
            var items = items_list.items;

            // The parenthetical construct must end with a close parenthesis
            try p.lexer.expect(.t_close_paren);

            // Restore "in" operator status before we parse the arrow function body
            p.allow_in = oldAllowIn;

            // Also restore "await" and "yield" expression errors
            p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

            // Are these arguments to an arrow function?
            if (p.lexer.token == .t_equals_greater_than or opts.force_arrow_fn or (is_typescript_enabled and p.lexer.token == .t_colon)) {
                // Arrow functions are not allowed inside certain expressions
                if (level.gt(.assign)) {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                }

                var invalidLog = LocList.init(p.allocator);
                var args = ListManaged(G.Arg).init(p.allocator);

                if (opts.is_async) {
                    // markl,oweredsyntaxpoksdpokasd
                }

                // First, try converting the expressions to bindings
                for (items) |_, i| {
                    var is_spread = false;
                    switch (items[i].data) {
                        .e_spread => |v| {
                            is_spread = true;
                            items[i] = v.value;
                        },
                        else => {},
                    }

                    var item = items[i];
                    const tuple = p.convertExprToBindingAndInitializer(&item, &invalidLog, is_spread);
                    // double allocations
                    args.append(G.Arg{
                        .binding = tuple.binding orelse Binding{ .data = Prefill.Data.BMissing, .loc = item.loc },
                        .default = tuple.expr,
                    }) catch unreachable;
                }

                // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
                // function. The ":" after the ")" may be a return type annotation, so we
                // attempt to convert the expressions to bindings first before deciding
                // whether this is an arrow function, and only pick an arrow function if
                // there were no conversion errors.
                if (p.lexer.token == .t_equals_greater_than or ((comptime is_typescript_enabled) and
                    invalidLog.items.len == 0 and
                    p.trySkipTypeScriptArrowReturnTypeWithBacktracking()) or
                    opts.force_arrow_fn)
                {
                    p.maybeCommaSpreadError(comma_after_spread);
                    p.logArrowArgErrors(&arrowArgErrors);

                    // Now that we've decided we're an arrow function, report binding pattern
                    // conversion errors
                    if (invalidLog.items.len > 0) {
                        for (invalidLog.items) |_loc| {
                            _loc.addError(
                                p.log,
                                p.source,
                            );
                        }
                    }
                    var arrow_data = FnOrArrowDataParse{
                        .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                    };
                    var arrow = try p.parseArrowBody(args.items, &arrow_data);
                    arrow.is_async = opts.is_async;
                    arrow.has_rest_arg = spread_range.len > 0;
                    p.popScope();
                    return p.e(arrow, loc);
                }
            }

            // If we get here, it's not an arrow function so undo the pushing of the
            // scope we did earlier. This needs to flatten any child scopes into the
            // parent scope as if the scope was never pushed in the first place.
            p.popAndFlattenScope(scope_index);

            // If this isn't an arrow function, then types aren't allowed
            if (type_colon_range.len > 0) {
                try p.log.addRangeError(p.source, type_colon_range, "Unexpected \":\"");
                return error.SyntaxError;
            }

            // Are these arguments for a call to a function named "async"?
            if (opts.is_async) {
                p.logExprErrors(&errors);
                const async_expr = p.e(E.Identifier{ .ref = try p.storeNameInRef("async") }, loc);
                return p.e(E.Call{ .target = async_expr, .args = ExprNodeList.init(items) }, loc);
            }

            // Is this a chain of expressions and comma operators?
            if (items.len > 0) {
                p.logExprErrors(&errors);
                if (spread_range.len > 0) {
                    try p.log.addRangeError(p.source, type_colon_range, "Unexpected \"...\"");
                    return error.SyntaxError;
                }

                var value = Expr.joinAllWithComma(items, p.allocator);
                p.markExprAsParenthesized(&value);
                return value;
            }

            // Indicate that we expected an arrow function
            try p.lexer.expected(.t_equals_greater_than);
            return error.SyntaxError;
        }

        // This code is tricky.
        // - Doing it incorrectly will cause segfaults.
        // - Doing it correctly drastically affects runtime performance while parsing larger files
        // The key is in how we remove scopes from the list
        // If we do an orderedRemove, it gets very slow.
        // swapRemove is fast. But a little more dangerous.
        // Instead, we just tombstone it.
        pub fn popAndFlattenScope(p: *P, scope_index: usize) void {
            // Move up to the parent scope
            var to_flatten = p.current_scope;
            var parent = to_flatten.parent.?;
            p.current_scope = parent;

            // Erase this scope from the order. This will shift over the indices of all
            // the scopes that were created after us. However, we shouldn't have to
            // worry about other code with outstanding scope indices for these scopes.
            // These scopes were all created in between this scope's push and pop
            // operations, so they should all be child scopes and should all be popped
            // by the time we get here.
            p.scopes_in_order.items[scope_index] = null;
            // Remove the last child from the parent scope
            const last = parent.children.items.len - 1;
            if (comptime Environment.allow_assert) assert(parent.children.items[last] == to_flatten);
            _ = parent.children.popOrNull();

            for (to_flatten.children.items) |item| {
                item.parent = parent;
                parent.children.append(p.allocator, item) catch unreachable;
            }
        }

        fn maybeCommaSpreadError(p: *P, _comma_after_spread: ?logger.Loc) void {
            const comma_after_spread = _comma_after_spread orelse return;
            if (comma_after_spread.start == -1) return;

            p.log.addRangeError(p.source, logger.Range{ .loc = comma_after_spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
        }

        pub fn toAST(p: *P, _parts: []js_ast.Part, exports_kind: js_ast.ExportsKind, commonjs_wrapper_expr: ?Expr) !js_ast.Ast {
            const allocator = p.allocator;
            var parts = _parts;
            // Insert an import statement for any runtime imports we generated

            if (p.options.tree_shaking and p.options.features.trim_unused_imports) {
                p.treeShake(&parts, false);
            }

            var parts_end: usize = 0;
            // Handle import paths after the whole file has been visited because we need
            // symbol usage counts to be able to remove unused type-only imports in
            // TypeScript code.
            while (true) {
                var kept_import_equals = false;
                var removed_import_equals = false;

                var i: usize = 0;
                // Potentially remove some statements, then filter out parts to remove any
                // with no statements
                while (i < parts.len) : (i += 1) {
                    var part = parts[i];
                    p.import_records_for_current_part.shrinkRetainingCapacity(0);
                    p.declared_symbols.shrinkRetainingCapacity(0);

                    var result = try ImportScanner.scan(P, p, part.stmts, commonjs_wrapper_expr != null);
                    kept_import_equals = kept_import_equals or result.kept_import_equals;
                    removed_import_equals = removed_import_equals or result.removed_import_equals;
                    part.import_record_indices = part.import_record_indices;
                    part.declared_symbols = p.declared_symbols.toOwnedSlice(allocator);
                    part.stmts = result.stmts;
                    if (part.stmts.len > 0) {
                        if (p.module_scope.contains_direct_eval and part.declared_symbols.len > 0) {
                            // If this file contains a direct call to "eval()", all parts that
                            // declare top-level symbols must be kept since the eval'd code may
                            // reference those symbols.
                            part.can_be_removed_if_unused = false;
                        }
                        parts[parts_end] = part;
                        parts_end += 1;
                    }
                }

                // We need to iterate multiple times if an import-equals statement was
                // removed and there are more import-equals statements that may be removed
                if (!kept_import_equals or !removed_import_equals) {
                    break;
                }
            }

            parts = parts[0..parts_end];

            // Do a second pass for exported items now that imported items are filled out
            for (parts) |part| {
                for (part.stmts) |stmt| {
                    switch (stmt.data) {
                        .s_export_clause => |clause| {
                            for (clause.items) |item| {
                                if (p.named_imports.getEntry(item.name.ref.?)) |_import| {
                                    _import.value_ptr.is_exported = true;
                                }
                            }
                        },
                        else => {},
                    }
                }
            }

            if (p.options.tree_shaking) {
                p.treeShake(&parts, commonjs_wrapper_expr != null or p.options.features.hot_module_reloading or p.options.enable_bundling);
            }

            if (commonjs_wrapper_expr) |commonjs_wrapper| {
                var part = &parts[parts.len - 1];

                var require_function_args = allocator.alloc(Arg, 2) catch unreachable;

                var imports_count: u32 = 0;
                // We have to also move export from, since we will preserve those
                var exports_from_count: u32 = 0;

                // Two passes. First pass just counts.
                for (parts[parts.len - 1].stmts) |stmt| {
                    imports_count += switch (stmt.data) {
                        .s_import => @as(u32, 1),
                        else => @as(u32, 0),
                    };

                    exports_from_count += switch (stmt.data) {
                        .s_export_star, .s_export_from => @as(u32, 1),
                        else => @as(u32, 0),
                    };
                }

                var new_stmts_list = allocator.alloc(Stmt, exports_from_count + imports_count + 1) catch unreachable;
                var imports_list = new_stmts_list[0..imports_count];

                var exports_list = if (exports_from_count > 0) new_stmts_list[imports_list.len + 1 ..] else &[_]Stmt{};

                require_function_args[0] = G.Arg{ .binding = p.b(B.Identifier{ .ref = p.module_ref }, logger.Loc.Empty) };
                require_function_args[1] = G.Arg{ .binding = p.b(B.Identifier{ .ref = p.exports_ref }, logger.Loc.Empty) };

                var imports_list_i: u32 = 0;
                var exports_list_i: u32 = 0;

                for (part.stmts) |_, i| {
                    switch (part.stmts[i].data) {
                        .s_import => {
                            imports_list[imports_list_i] = part.stmts[i];
                            part.stmts[i] = Stmt.empty();
                            part.stmts[i].loc = imports_list[imports_list_i].loc;
                            imports_list_i += 1;
                        },

                        .s_export_star, .s_export_from => {
                            exports_list[exports_list_i] = part.stmts[i];
                            part.stmts[i] = Stmt.empty();
                            part.stmts[i].loc = exports_list[exports_list_i].loc;
                            exports_list_i += 1;
                        },
                        else => {},
                    }
                }

                commonjs_wrapper.data.e_call.args.ptr[0] = p.e(
                    E.Function{ .func = G.Fn{
                        .name = null,
                        .open_parens_loc = logger.Loc.Empty,
                        .args = require_function_args,
                        .body = .{ .loc = logger.Loc.Empty, .stmts = parts[parts.len - 1].stmts },
                        .flags = Flags.Function.init(.{ .is_export = true }),
                    } },
                    logger.Loc.Empty,
                );
                var sourcefile_name = p.source.path.pretty;
                if (strings.lastIndexOf(sourcefile_name, "node_modules")) |node_modules_i| {
                    // 1 for the separator
                    const end = node_modules_i + 1 + "node_modules".len;
                    // If you were to name your file "node_modules.js" it shouldn't appear as ".js"
                    if (end < sourcefile_name.len) {
                        sourcefile_name = sourcefile_name[end..];
                    }
                }
                commonjs_wrapper.data.e_call.args.ptr[1] = p.e(E.String{ .data = sourcefile_name }, logger.Loc.Empty);

                new_stmts_list[imports_list.len] = p.s(
                    S.ExportDefault{
                        .value = .{
                            .expr = commonjs_wrapper,
                        },
                        .default_name = LocRef{ .ref = null, .loc = logger.Loc.Empty },
                    },
                    logger.Loc.Empty,
                );
                part.stmts = new_stmts_list;
            } else if (p.options.features.hot_module_reloading and p.options.features.allow_runtime) {
                var named_exports_count: usize = p.named_exports.count();
                const named_imports: js_ast.Ast.NamedImports = p.named_imports;

                // To transform to something HMR'able, we must:
                // 1. Wrap the top level code in an IIFE
                // 2. Move imports to the top of the file (preserving the order)
                // 3. Remove export clauses (done during ImportScanner)
                // 4. Move export * from and export from to the bottom of the file (or the top, it doesn't matter I don't think)
                // 5. Export everything as getters in our HMR module
                // 6. Call the HMRModule's exportAll function like so:
                // __hmrModule.exportAll({
                //   exportAlias: () => identifier,
                //   exportAlias: () => identifier,
                // });
                // This has the unfortunate property of making property accesses of exports slower at runtime.
                // But, I'm not sure there's a way to use regular properties without breaking stuff.
                var imports_count: usize = 0;
                // We have to also move export from, since we will preserve those
                var exports_from_count: usize = 0;
                // Two passes. First pass just counts.
                for (parts[parts.len - 1].stmts) |stmt| {
                    imports_count += switch (stmt.data) {
                        .s_import => @as(usize, 1),
                        else => @as(usize, 0),
                    };
                    exports_from_count += switch (stmt.data) {
                        .s_export_star, .s_export_from => @as(usize, 1),
                        else => @as(usize, 0),
                    };
                }
                var part = &parts[parts.len - 1];

                const end_iife_stmts_count = part.stmts.len - imports_count - exports_from_count + 1;
                // Why 7?
                // 1. HMRClient.activate(${isDebug});
                // 2. var __hmrModule = new HMMRModule(id, file_path), __exports = __hmrModule.exports;
                // 3. (__hmrModule.load = function() {
                // ${...end_iffe_stmts_count - 1}
                // ${end_iffe_stmts_count}
                // __hmrModule.exportAll({exportAlias: () => identifier}) <-- ${named_exports_count}
                // ();
                // 4. var __hmrExport_exportName = __hmrModule.exports.exportName,
                // 5. export { __hmrExport_exportName as blah, ... }
                // 6. __hmrModule.onSetExports = (newExports) => {
                // $named_exports_count   __hmrExport_exportName = newExports.exportName; <-- ${named_exports_count}
                // }

                // if there are no exports:
                // - there shouldn't be an export statement
                // - we don't need the S.Local for wrapping the exports
                // We still call exportAll just with an empty object.
                const has_any_exports = named_exports_count > 0;

                const toplevel_stmts_count = 3 + (@intCast(usize, @boolToInt(has_any_exports)) * 2);
                var _stmts = allocator.alloc(
                    Stmt,
                    end_iife_stmts_count + toplevel_stmts_count + (named_exports_count * 2) + imports_count + exports_from_count,
                ) catch unreachable;
                // Normally, we'd have to grow that inner function's stmts list by one
                // But we can avoid that by just making them all use this same array.
                var curr_stmts = _stmts;

                // in debug: crash in the printer due to undefined memory
                // in release: print ";" instead.
                // this should never happen regardless, but i'm just being cautious here.
                if (comptime !Environment.isDebug) {
                    std.mem.set(Stmt, _stmts, Stmt.empty());
                }

                // Second pass: move any imports from the part's stmts array to the new stmts
                var imports_list = curr_stmts[0..imports_count];
                curr_stmts = curr_stmts[imports_list.len..];
                var toplevel_stmts = curr_stmts[0..toplevel_stmts_count];
                curr_stmts = curr_stmts[toplevel_stmts.len..];
                var exports_from = curr_stmts[0..exports_from_count];
                curr_stmts = curr_stmts[exports_from.len..];
                // This is used for onSetExports
                var update_function_stmts = curr_stmts[0..named_exports_count];
                curr_stmts = curr_stmts[update_function_stmts.len..];
                var export_all_function_body_stmts = curr_stmts[0..named_exports_count];
                curr_stmts = curr_stmts[export_all_function_body_stmts.len..];
                // This is the original part statements + 1
                var part_stmts = curr_stmts;
                if (comptime Environment.allow_assert) assert(part_stmts.len == end_iife_stmts_count);
                var part_stmts_i: usize = 0;

                var import_list_i: usize = 0;
                var export_list_i: usize = 0;

                // We must always copy it into the new stmts array
                for (part.stmts) |stmt| {
                    switch (stmt.data) {
                        .s_import => {
                            imports_list[import_list_i] = stmt;
                            import_list_i += 1;
                        },
                        .s_export_star, .s_export_from => {
                            exports_from[export_list_i] = stmt;
                            export_list_i += 1;
                        },
                        else => {
                            part_stmts[part_stmts_i] = stmt;
                            part_stmts_i += 1;
                        },
                    }
                }

                const new_call_args_count: usize = if (p.options.features.react_fast_refresh) 3 else 2;
                var call_args = try allocator.alloc(Expr, new_call_args_count + 1);
                var new_call_args = call_args[0..new_call_args_count];
                var hmr_module_ident = p.e(E.Identifier{ .ref = p.hmr_module.ref }, logger.Loc.Empty);

                new_call_args[0] = p.e(E.Number{ .value = @intToFloat(f64, p.options.filepath_hash_for_hmr) }, logger.Loc.Empty);
                // This helps us provide better error messages
                new_call_args[1] = p.e(E.String{ .data = p.source.path.pretty }, logger.Loc.Empty);
                if (p.options.features.react_fast_refresh) {
                    new_call_args[2] = p.e(E.Identifier{ .ref = p.jsx_refresh_runtime.ref }, logger.Loc.Empty);
                }

                var toplevel_stmts_i: u8 = 0;

                var decls = try allocator.alloc(G.Decl, 2 + named_exports_count);
                var first_decl = decls[0..2];
                // We cannot rely on import.meta.url because if we import it within a blob: url, it will be nonsensical
                // var __hmrModule = new HMRModule(123123124, "/index.js"), __exports = __hmrModule.exports;
                const hmr_import_module_ = if (p.options.features.react_fast_refresh)
                    p.runtime_imports.__FastRefreshModule.?
                else
                    p.runtime_imports.__HMRModule.?;

                const hmr_import_ref = hmr_import_module_.ref;
                first_decl[0] = G.Decl{
                    .binding = p.b(B.Identifier{ .ref = p.hmr_module.ref }, logger.Loc.Empty),
                    .value = p.e(E.New{
                        .args = ExprNodeList.init(new_call_args),
                        .target = p.e(
                            E.Identifier{
                                .ref = hmr_import_ref,
                            },
                            logger.Loc.Empty,
                        ),
                        .close_parens_loc = logger.Loc.Empty,
                    }, logger.Loc.Empty),
                };
                first_decl[1] = G.Decl{
                    .binding = p.b(B.Identifier{ .ref = p.exports_ref }, logger.Loc.Empty),
                    .value = p.e(E.Dot{
                        .target = p.e(E.Identifier{ .ref = p.hmr_module.ref }, logger.Loc.Empty),
                        .name = "exports",
                        .name_loc = logger.Loc.Empty,
                    }, logger.Loc.Empty),
                };

                var export_clauses = try allocator.alloc(js_ast.ClauseItem, named_exports_count);
                var named_export_i: usize = 0;
                var named_exports_iter = p.named_exports.iterator();
                var export_properties = try allocator.alloc(G.Property, named_exports_count);

                var export_name_string_length: usize = 0;
                while (named_exports_iter.next()) |named_export| {
                    export_name_string_length += named_export.key_ptr.len + "$$hmr_".len;
                }

                var export_name_string_all = try allocator.alloc(u8, export_name_string_length);
                var export_name_string_remainder = export_name_string_all;
                var hmr_module_exports_dot = p.e(
                    E.Dot{
                        .target = hmr_module_ident,
                        .name = "exports",
                        .name_loc = logger.Loc.Empty,
                    },
                    logger.Loc.Empty,
                );
                var exports_decls = decls[first_decl.len..];
                named_exports_iter = p.named_exports.iterator();
                var update_function_args = try allocator.alloc(G.Arg, 1);
                var exports_ident = p.e(E.Identifier{ .ref = p.exports_ref }, logger.Loc.Empty);
                update_function_args[0] = G.Arg{ .binding = p.b(B.Identifier{ .ref = p.exports_ref }, logger.Loc.Empty) };

                while (named_exports_iter.next()) |named_export| {
                    const named_export_value = named_export.value_ptr.*;

                    // Do not try to HMR export {foo} from 'bar';
                    if (named_imports.get(named_export_value.ref)) |named_import| {
                        if (named_import.is_exported) continue;
                    }

                    const named_export_symbol: Symbol = p.symbols.items[named_export_value.ref.innerIndex()];

                    var export_name_string = export_name_string_remainder[0 .. named_export.key_ptr.len + "$$hmr_".len];
                    export_name_string_remainder = export_name_string_remainder[export_name_string.len..];
                    std.mem.copy(u8, export_name_string, "$$hmr_");
                    std.mem.copy(u8, export_name_string["$$hmr_".len..], named_export.key_ptr.*);

                    var name_ref = try p.declareSymbol(.other, logger.Loc.Empty, export_name_string);

                    var body_stmts = export_all_function_body_stmts[named_export_i .. named_export_i + 1];
                    body_stmts[0] = p.s(
                        // was this originally a named import?
                        // preserve the identifier
                        S.Return{ .value = if (named_export_symbol.namespace_alias != null)
                            p.e(E.ImportIdentifier{
                                .ref = named_export_value.ref,
                                .was_originally_identifier = true,
                            }, logger.Loc.Empty)
                        else
                            p.e(E.Identifier{
                                .ref = named_export_value.ref,
                            }, logger.Loc.Empty) },
                        logger.Loc.Empty,
                    );
                    export_clauses[named_export_i] = js_ast.ClauseItem{
                        .original_name = "",
                        .alias = named_export.key_ptr.*,
                        .alias_loc = named_export_value.alias_loc,
                        .name = .{ .ref = name_ref, .loc = logger.Loc.Empty },
                    };

                    var decl_value = p.e(
                        E.Dot{ .target = hmr_module_exports_dot, .name = named_export.key_ptr.*, .name_loc = logger.Loc.Empty },
                        logger.Loc.Empty,
                    );
                    exports_decls[named_export_i] = G.Decl{
                        .binding = p.b(B.Identifier{ .ref = name_ref }, logger.Loc.Empty),
                        .value = decl_value,
                    };

                    update_function_stmts[named_export_i] = Expr.assignStmt(
                        p.e(
                            E.Identifier{ .ref = name_ref },
                            logger.Loc.Empty,
                        ),
                        p.e(E.Dot{
                            .target = exports_ident,
                            .name = named_export.key_ptr.*,
                            .name_loc = logger.Loc.Empty,
                        }, logger.Loc.Empty),
                        allocator,
                    );

                    export_properties[named_export_i] = G.Property{
                        .key = p.e(E.String{ .data = named_export.key_ptr.* }, logger.Loc.Empty),
                        .value = p.e(
                            E.Arrow{
                                .args = &[_]G.Arg{},
                                .body = .{
                                    .stmts = body_stmts,
                                    .loc = logger.Loc.Empty,
                                },
                                .prefer_expr = true,
                            },
                            logger.Loc.Empty,
                        ),
                    };
                    named_export_i += 1;
                }
                var export_all_args = call_args[new_call_args.len..];
                export_all_args[0] = p.e(
                    E.Object{ .properties = Property.List.init(export_properties[0..named_export_i]) },
                    logger.Loc.Empty,
                );

                part_stmts[part_stmts.len - 1] = p.s(
                    S.SExpr{
                        .value = p.e(
                            E.Call{
                                .target = p.e(
                                    E.Dot{
                                        .target = hmr_module_ident,
                                        .name = "exportAll",
                                        .name_loc = logger.Loc.Empty,
                                    },
                                    logger.Loc.Empty,
                                ),
                                .args = ExprNodeList.init(export_all_args),
                            },
                            logger.Loc.Empty,
                        ),
                    },
                    logger.Loc.Empty,
                );

                toplevel_stmts[toplevel_stmts_i] = p.s(
                    S.Local{
                        .decls = first_decl,
                    },
                    logger.Loc.Empty,
                );

                toplevel_stmts_i += 1;

                const is_async = !p.top_level_await_keyword.isEmpty();

                var func = p.e(
                    E.Function{
                        .func = .{
                            .body = .{ .loc = logger.Loc.Empty, .stmts = part_stmts[0 .. part_stmts_i + 1] },
                            .name = null,
                            .open_parens_loc = logger.Loc.Empty,
                            .flags = Flags.Function.init(.{
                                .print_as_iife = true,
                                .is_async = is_async,
                            }),
                        },
                    },
                    logger.Loc.Empty,
                );

                const call_load = p.e(
                    E.Call{
                        .target = Expr.assign(
                            p.e(
                                E.Dot{
                                    .name = "_load",
                                    .target = hmr_module_ident,
                                    .name_loc = logger.Loc.Empty,
                                },
                                logger.Loc.Empty,
                            ),
                            func,
                            allocator,
                        ),
                    },
                    logger.Loc.Empty,
                );
                // (__hmrModule._load = function())()
                toplevel_stmts[toplevel_stmts_i] = p.s(
                    S.SExpr{
                        .value = if (is_async)
                            p.e(E.Await{ .value = call_load }, logger.Loc.Empty)
                        else
                            call_load,
                    },
                    logger.Loc.Empty,
                );

                toplevel_stmts_i += 1;

                if (has_any_exports) {
                    if (named_export_i > 0) {
                        toplevel_stmts[toplevel_stmts_i] = p.s(
                            S.Local{
                                .decls = exports_decls[0..named_export_i],
                            },
                            logger.Loc.Empty,
                        );
                    } else {
                        toplevel_stmts[toplevel_stmts_i] = p.s(
                            S.Empty{},
                            logger.Loc.Empty,
                        );
                    }

                    toplevel_stmts_i += 1;
                }

                toplevel_stmts[toplevel_stmts_i] = p.s(
                    S.SExpr{
                        .value = Expr.assign(
                            p.e(
                                E.Dot{
                                    .name = "_update",
                                    .target = hmr_module_ident,
                                    .name_loc = logger.Loc.Empty,
                                },
                                logger.Loc.Empty,
                            ),
                            p.e(
                                E.Function{
                                    .func = .{
                                        .body = .{ .loc = logger.Loc.Empty, .stmts = if (named_export_i > 0) update_function_stmts[0..named_export_i] else &.{} },
                                        .name = null,
                                        .args = update_function_args,
                                        .open_parens_loc = logger.Loc.Empty,
                                    },
                                },
                                logger.Loc.Empty,
                            ),
                            allocator,
                        ),
                    },
                    logger.Loc.Empty,
                );
                toplevel_stmts_i += 1;
                if (has_any_exports) {
                    if (named_export_i > 0) {
                        toplevel_stmts[toplevel_stmts_i] = p.s(
                            S.ExportClause{
                                .items = export_clauses[0..named_export_i],
                            },
                            logger.Loc.Empty,
                        );
                    } else {
                        toplevel_stmts[toplevel_stmts_i] = p.s(
                            S.Empty{},
                            logger.Loc.Empty,
                        );
                    }
                }

                part.stmts = _stmts[0 .. imports_list.len + toplevel_stmts.len + exports_from.len];
            } else if (p.options.features.hot_module_reloading) {}

            {

                // Each part tracks the other parts it depends on within this file
                // var local_dependencies = AutoHashMap(u32, u32).init(p.allocator);

                // while (i < parts.len) : (i += 1) {
                //     const part = parts[i];
                //     if (part.symbol_uses.count() > 0) {
                //         var iter = part.symbol_uses.iterator();
                //         var dependencies = List(js_ast.Dependency).init(p.allocator);
                //         while (iter.next()) |entry| {
                //             const ref = entry.key;

                //             if (p.top_level_symbol_to_parts.get(ref)) |tlstp| {
                //                 for (tlstp.items) |other_part_index| {
                //                     if (!local_dependencies.contains(other_part_index) or other_part_index != i) {
                //                         try local_dependencies.put(other_part_index, @intCast(u32, i));
                //                         try dependencies.append(js_ast.Dependency{
                //                             .source_index = p.source.index,
                //                             .part_index = other_part_index,
                //                         });
                //                     }
                //                 }
                //             }

                //             // Also map from imports to parts that use them
                //             // TODO: will appending to this list like this be a perf issue?
                //             if (p.named_imports.getEntry(ref)) |named_import_entry| {
                //                 const named_import = named_import_entry.value;
                //                 var buf = try p.allocator.alloc(u32, named_import.local_parts_with_uses.len + 1);
                //                 if (named_import.local_parts_with_uses.len > 0) {
                //                     std.mem.copy(u32, buf, named_import.local_parts_with_uses);
                //                 }
                //                 buf[buf.len - 1] = @intCast(u32, i);
                //                 named_import_entry.value.local_parts_with_uses = buf;
                //             }
                //         }
                //     }
                // }
            }

            return js_ast.Ast{
                .runtime_imports = p.runtime_imports,
                .parts = parts,
                .module_scope = p.module_scope.*,
                .symbols = p.symbols.items,
                .exports_ref = p.exports_ref,
                .wrapper_ref = null,
                .module_ref = p.module_ref,
                .import_records = p.import_records.items,
                .export_star_import_records = p.export_star_import_records.items,
                .approximate_newline_count = p.lexer.approximate_newline_count,
                .exports_kind = exports_kind,
                .named_imports = p.named_imports,
                .named_exports = p.named_exports,
                .import_keyword = p.es6_import_keyword,
                .export_keyword = p.es6_export_keyword,
                .require_ref = if (p.runtime_imports.__require != null)
                    p.runtime_imports.__require.?.ref
                else
                    p.require_ref,

                .uses_module_ref = (p.symbols.items[p.module_ref.innerIndex()].use_count_estimate > 0),
                .uses_exports_ref = (p.symbols.items[p.exports_ref.innerIndex()].use_count_estimate > 0),
                .uses_require_ref = if (p.runtime_imports.__require != null)
                    (p.symbols.items[p.runtime_imports.__require.?.ref.innerIndex()].use_count_estimate > 0)
                else
                    false,
                // .top_Level_await_keyword = p.top_level_await_keyword,
                .bun_plugin = p.bun_plugin,
            };
        }

        pub fn init(
            allocator: Allocator,
            log: *logger.Log,
            source: *const logger.Source,
            define: *Define,
            lexer: js_lexer.Lexer,
            opts: Parser.Options,
            this: *P,
        ) !void {
            var scope_order = try ScopeOrderList.initCapacity(allocator, 1);
            var scope = try allocator.create(Scope);
            scope.* = Scope{
                .members = @TypeOf(scope.members){},
                .children = @TypeOf(scope.children){},
                .generated = @TypeOf(scope.generated){},
                .kind = .entry,
                .label_ref = null,
                .parent = null,
            };

            scope_order.appendAssumeCapacity(ScopeOrder{ .loc = locModuleScope, .scope = scope });
            this.* = P{
                .cjs_import_stmts = @TypeOf(this.cjs_import_stmts).init(allocator),
                // This must default to true or else parsing "in" won't work right.
                // It will fail for the case in the "in-keyword.js" file
                .allow_in = true,

                .call_target = nullExprData,
                .delete_target = nullExprData,
                .stmt_expr_value = nullExprData,
                .expr_list = .{},
                .loop_body = nullStmtData,
                .define = define,
                .import_records = undefined,
                .named_imports = undefined,
                .named_exports = js_ast.Ast.NamedExports.init(allocator),
                .log = log,
                .allocator = allocator,
                .options = opts,
                .then_catch_chain = ThenCatchChain{ .next_target = nullExprData },
                .to_expr_wrapper_namespace = undefined,
                .to_expr_wrapper_hoisted = undefined,
                .import_transposer = undefined,
                .require_transposer = undefined,
                .require_resolve_transposer = undefined,
                .source = source,
                .macro = MacroState.init(allocator),
                .current_scope = scope,
                .module_scope = scope,
                .scopes_in_order = scope_order,
                .needs_jsx_import = if (comptime only_scan_imports_and_do_not_visit) false else NeedsJSXType{},
                .lexer = lexer,
            };

            this.symbols = std.ArrayList(Symbol).init(allocator);

            if (comptime !only_scan_imports_and_do_not_visit) {
                this.import_records = @TypeOf(this.import_records).init(allocator);
                this.named_imports = NamedImportsType.init(allocator);
            }

            this.to_expr_wrapper_namespace = Binding2ExprWrapper.Namespace.init(this);
            this.to_expr_wrapper_hoisted = Binding2ExprWrapper.Hoisted.init(this);
            this.import_transposer = @TypeOf(this.import_transposer).init(this);
            this.require_transposer = @TypeOf(this.require_transposer).init(this);
            this.require_resolve_transposer = @TypeOf(this.require_resolve_transposer).init(this);

            if (opts.features.top_level_await or comptime only_scan_imports_and_do_not_visit) {
                this.fn_or_arrow_data_parse.allow_await = .allow_expr;
                this.fn_or_arrow_data_parse.is_top_level = true;
            }
        }
    };
}

// Doing this seems to yield a 1% performance improvement parsing larger files
// ❯ hyperfine "../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" "../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" --min-runs=500
// Benchmark #1: ../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.1 ms ±   1.1 ms    [User: 20.4 ms, System: 3.1 ms]
//   Range (min … max):    23.5 ms …  31.7 ms    500 runs

// Benchmark #2: ../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
//   Time (mean ± σ):      25.6 ms ±   1.3 ms    [User: 20.9 ms, System: 3.1 ms]
//   Range (min … max):    24.1 ms …  39.7 ms    500 runs
// '../../build/macos-x86_64/bun node_modules/react-dom/cjs/react-dom.development.js --resolve=disable' ran
// 1.02 ± 0.07 times faster than '../../bun.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable'
const JavaScriptParser = NewParser(.{});
const JSXParser = NewParser(.{ .jsx = .react });
const TSXParser = NewParser(.{ .jsx = .react, .typescript = true });
const TypeScriptParser = NewParser(.{ .typescript = true });
const SolidJSXParser = NewParser(.{ .jsx = .solid });
const SolidTSXParser = NewParser(.{ .jsx = .solid, .typescript = true });

const JSParserMacro = NewParser(.{
    .jsx = .macro,
});
const TSParserMacro = NewParser(.{
    .jsx = .macro,
    .typescript = true,
});

const JavaScriptImportScanner = NewParser(.{ .scan_only = true });
const JSXImportScanner = NewParser(.{ .jsx = .react, .scan_only = true });
const TSXImportScanner = NewParser(.{ .jsx = .react, .typescript = true, .scan_only = true });
const TypeScriptImportScanner = NewParser(.{ .typescript = true, .scan_only = true });

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
