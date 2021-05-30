const std = @import("std");
const logger = @import("logger.zig");
const JSXRuntime = @import("options.zig").JSX.Runtime;

usingnamespace @import("global.zig");
usingnamespace @import("ast/base.zig");

const ImportRecord = @import("import_record.zig").ImportRecord;
const allocators = @import("allocators.zig");

const _hash_map = @import("hash_map.zig");
const StringHashMap = _hash_map.StringHashMap;
const AutoHashMap = _hash_map.AutoHashMap;

pub const ListIndex = packed struct {
    index: u31,
    is_overflowing: bool = false,

    pub fn eql(a: ListIndex, b: ListIndex) bool {
        return @bitCast(u32, a) == @bitCast(u32, b);
    }
};

// There are three types.
// 1. Expr (expression)
// 2. Stmt (statement)
// 3. Binding
// Q: "What's the difference between an expression and a statement?"
// A:  > Expression: Something which evaluates to a value. Example: 1+2/x
//     > Statement: A line of code which does something. Example: GOTO 100
//     > https://stackoverflow.com/questions/19132/expression-versus-statement/19224#19224

// Expr, Binding, and Stmt each wrap a Data:
// Data is where the actual data where the node lives.
// There are four possible versions of this structure:
// [ ] 1.  *Expr, *Stmt, *Binding
// [ ] 1a. *Expr, *Stmt, *Binding something something dynamic dispatch
// [ ] 2.  *Data
// [x] 3.  Data.(*) (The union value in Data is a pointer)
// I chose #3 mostly for code simplification -- sometimes, the data is modified in-place.
// But also it uses the least memory.
// Since Data is a union, the size in bytes of Data is the max of all types
// So with #1 or #2, if S.Function consumes 768 bits, that means Data must be >= 768 bits
// Which means "true" in code now takes up over 768 bits, probably more than what v8 spends
// Instead, this approach means Data is the size of a pointer.
// It's not really clear which approach is best without benchmarking it.
// The downside with this approach is potentially worse memory locality, since the data for the node is somewhere else.
// But it could also be better memory locality due to smaller in-memory size (more likely to hit the cache)
// only benchmarks will provide an answer!
// But we must have pointers somewhere in here because can't have types that contain themselves
pub const BindingNodeIndex = Binding;
pub const StmtNodeIndex = Stmt;
pub const ExprNodeIndex = Expr;

pub const ExprNodeList = []Expr;
pub const StmtNodeList = []Stmt;
pub const BindingNodeList = []Binding;

pub const ImportItemStatus = enum(u2) {
    none,

    // The linker doesn't report import/export mismatch errors
    generated,
    // The printer will replace this import with "undefined"

    missing,
};

pub const AssignTarget = enum(u2) {
    none,
    replace, // "a = b"
    update, // "a += b"
};

pub const LocRef = struct { loc: logger.Loc, ref: ?Ref };

pub const Flags = struct {
    pub const JSXElement = packed struct {
        is_key_before_rest: bool = false,
    };

    pub const Property = packed struct {
        is_computed: bool = false,
        is_method: bool = false,
        is_static: bool = false,
        was_shorthand: bool = false,
        is_spread: bool = false,

        const None = Flags.Property{};
    };

    pub const Function = packed struct {
        is_async: bool = false,
        is_generator: bool = false,
        has_rest_arg: bool = false,
        has_if_scope: bool = false,

        is_forward_declaration: bool = false,

        // This is true if the function is a method
        is_unique_formal_parameters: bool = false,

        // Only applicable to function statements.
        is_export: bool = false,

        const None = Flags.Function{};
    };
};

pub const Binding = struct {
    loc: logger.Loc,
    data: B,

    const Serializable = struct {
        @"type": Tag,
        object: string,
        value: B,
        loc: logger.Loc,
    };

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .@"type" = std.meta.activeTag(self.data), .object = "binding", .value = self.data, .loc = self.loc }, options, writer);
    }

    pub fn ToExpr(comptime expr_type: type, comptime func_type: anytype) type {
        const ExprType = expr_type;
        return struct {
            context: *ExprType,
            allocator: *std.mem.Allocator,
            pub const Context = @This();

            pub fn wrapIdentifier(ctx: *const Context, loc: logger.Loc, ref: Ref) Expr {
                return func_type(ctx.context, loc, ref);
            }

            pub fn init(context: *ExprType) Context {
                return Context{ .context = context, .allocator = context.allocator };
            }
        };
    }

    pub fn toExpr(binding: *const Binding, wrapper: anytype) Expr {
        var loc = binding.loc;

        switch (binding.data) {
            .b_missing => {
                return Expr.alloc(wrapper.allocator, E.Missing{}, loc);
            },

            .b_identifier => |b| {
                return wrapper.wrapIdentifier(loc, b.ref);
            },
            .b_array => |b| {
                var exprs = wrapper.allocator.alloc(Expr, b.items.len) catch unreachable;
                var i: usize = 0;
                while (i < exprs.len) : (i += 1) {
                    const item = b.items[i];
                    exprs[i] = convert: {
                        const expr = toExpr(&item.binding, wrapper);
                        if (b.has_spread and i == exprs.len - 1) {
                            break :convert Expr.alloc(wrapper.allocator, E.Spread{ .value = expr }, expr.loc);
                        } else if (item.default_value) |default| {
                            break :convert Expr.assign(expr, default, wrapper.allocator);
                        } else {
                            break :convert expr;
                        }
                    };
                }

                return Expr.alloc(wrapper.allocator, E.Array{ .items = exprs, .is_single_line = b.is_single_line }, loc);
            },
            .b_object => |b| {
                var properties = wrapper.allocator.alloc(G.Property, b.properties.len) catch unreachable;
                var i: usize = 0;
                while (i < properties.len) : (i += 1) {
                    const item = b.properties[i];
                    properties[i] = G.Property{
                        .flags = item.flags,
                        .kind = if (item.flags.is_spread) G.Property.Kind.spread else G.Property.Kind.normal,
                        .value = toExpr(&item.value, wrapper),
                        .initializer = item.default_value,
                    };
                }
                return Expr.alloc(wrapper.allocator, E.Object{ .properties = properties, .is_single_line = b.is_single_line }, loc);
            },
            else => {
                Global.panic("Interanl error", .{});
            },
        }
    }

    pub const Tag = enum(u5) {
        b_identifier,
        b_array,
        b_property,
        b_object,
        b_missing,
    };

    pub fn init(t: anytype, loc: logger.Loc) Binding {
        switch (@TypeOf(t)) {
            *B.Identifier => {
                return Binding{ .loc = loc, .data = B{ .b_identifier = t } };
            },
            *B.Array => {
                return Binding{ .loc = loc, .data = B{ .b_array = t } };
            },
            *B.Property => {
                return Binding{ .loc = loc, .data = B{ .b_property = t } };
            },
            *B.Object => {
                return Binding{ .loc = loc, .data = B{ .b_object = t } };
            },
            *B.Missing => {
                return Binding{ .loc = loc, .data = B{ .b_missing = t } };
            },
            else => {
                @compileError("Invalid type passed to Binding.init");
            },
        }
    }

    pub fn alloc(allocator: *std.mem.Allocator, t: anytype, loc: logger.Loc) Binding {
        switch (@TypeOf(t)) {
            B.Identifier => {
                var data = allocator.create(B.Identifier) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_identifier = data } };
            },
            B.Array => {
                var data = allocator.create(B.Array) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_array = data } };
            },
            B.Property => {
                var data = allocator.create(B.Property) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_property = data } };
            },
            B.Object => {
                var data = allocator.create(B.Object) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_object = data } };
            },
            B.Missing => {
                var data = allocator.create(B.Missing) catch unreachable;
                data.* = t;
                return Binding{ .loc = loc, .data = B{ .b_missing = data } };
            },
            else => {
                @compileError("Invalid type passed to Binding.alloc");
            },
        }
    }
};

pub const B = union(Binding.Tag) {
    b_identifier: *B.Identifier,
    b_array: *B.Array,
    b_property: *B.Property,
    b_object: *B.Object,
    b_missing: *B.Missing,

    pub const Identifier = struct {
        ref: Ref,
    };

    pub const Property = struct {
        flags: Flags.Property = Flags.Property.None,
        key: ExprNodeIndex,
        value: BindingNodeIndex,
        default_value: ?ExprNodeIndex = null,
    };

    pub const Object = struct { properties: []Property, is_single_line: bool = false };

    pub const Array = struct {
        items: []ArrayBinding,
        has_spread: bool = false,
        is_single_line: bool = false,
    };

    pub const Missing = struct {};
};

pub const ClauseItem = struct {
    alias: string,
    alias_loc: logger.Loc,
    name: LocRef,

    // This is the original name of the symbol stored in "Name". It's needed for
    // "SExportClause" statements such as this:
    //
    //   export {foo as bar} from 'path'
    //
    // In this case both "foo" and "bar" are aliases because it's a re-export.
    // We need to preserve both aliases in case the symbol is renamed. In this
    // example, "foo" is "OriginalName" and "bar" is "Alias".
    original_name: string,
};

pub const G = struct {
    pub const Decl = struct {
        binding: BindingNodeIndex,
        value: ?ExprNodeIndex = null,
    };

    pub const NamespaceAlias = struct {
        namespace_ref: Ref,
        alias: string,
    };

    pub const ExportStarAlias = struct {
        loc: logger.Loc,

        // Although this alias name starts off as being the same as the statement's
        // namespace symbol, it may diverge if the namespace symbol name is minified.
        // The original alias name is preserved here to avoid this scenario.
        original_name: string,
    };

    pub const Class = struct {
        class_keyword: logger.Range = logger.Range.None,
        ts_decorators: ExprNodeList = &([_]Expr{}),
        class_name: ?LocRef = null,
        extends: ?ExprNodeIndex = null,
        body_loc: logger.Loc = logger.Loc.Empty,
        properties: []Property = &([_]Property{}),
    };

    // invalid shadowing if left as Comment
    pub const Comment = struct { loc: logger.Loc, text: string };

    pub const Property = struct {
        ts_decorators: ExprNodeList = &([_]ExprNodeIndex{}),
        // Key is optional for spread
        key: ?ExprNodeIndex = null,

        // This is omitted for class fields
        value: ?ExprNodeIndex = null,

        // This is used when parsing a pattern that uses default values:
        //
        //   [a = 1] = [];
        //   ({a = 1} = {});
        //
        // It's also used for class fields:
        //
        //   class Foo { a = 1 }
        //
        initializer: ?ExprNodeIndex = null,
        kind: Kind = Kind.normal,
        flags: Flags.Property = Flags.Property.None,

        pub const Kind = enum(u2) {
            normal,
            get,
            set,
            spread,
        };
    };

    pub const FnBody = struct {
        loc: logger.Loc,
        stmts: StmtNodeList,
    };

    pub const Fn = struct {
        name: ?LocRef,
        open_parens_loc: logger.Loc,
        args: []Arg = &([_]Arg{}),
        // This was originally nullable, but doing so I believe caused a miscompilation
        // Specifically, the body was always null.
        body: FnBody = FnBody{ .loc = logger.Loc.Empty, .stmts = &([_]StmtNodeIndex{}) },
        arguments_ref: ?Ref = null,

        flags: Flags.Function = Flags.Function.None,
    };
    pub const Arg = struct {
        ts_decorators: ExprNodeList = &([_]Expr{}),
        binding: BindingNodeIndex,
        default: ?ExprNodeIndex = null,

        // "constructor(public x: boolean) {}"
        is_typescript_ctor_field: bool = false,
    };
};

pub const Symbol = struct {
    // This is the name that came from the parser. Printed names may be renamed
    // during minification or to avoid name collisions. Do not use the original
    // name during printing.
    original_name: string,

    // This is used for symbols that represent items in the import clause of an
    // ES6 import statement. These should always be referenced by EImportIdentifier
    // instead of an EIdentifier. When this is present, the expression should
    // be printed as a property access off the namespace instead of as a bare
    // identifier.
    //
    // For correctness, this must be stored on the symbol instead of indirectly
    // associated with the Ref for the symbol somehow. In ES6 "flat bundling"
    // mode, re-exported symbols are collapsed using MergeSymbols() and renamed
    // symbols from other files that end up at this symbol must be able to tell
    // if it has a namespace alias.
    namespace_alias: ?G.NamespaceAlias = null,

    // Used by the parser for single pass parsing. Symbols that have been merged
    // form a linked-list where the last link is the symbol to use. This link is
    // an invalid ref if it's the last link. If this isn't invalid, you need to
    // FollowSymbols to get the real one.
    link: ?Ref = null,

    // An estimate of the number of uses of this symbol. This is used to detect
    // whether a symbol is used or not. For example, TypeScript imports that are
    // unused must be removed because they are probably type-only imports. This
    // is an estimate and may not be completely accurate due to oversights in the
    // code. But it should always be non-zero when the symbol is used.
    use_count_estimate: u32 = 0,

    // This is for generating cross-chunk imports and exports for code splitting.
    chunk_index: ?u32 = null,

    // This is used for minification. Symbols that are declared in sibling scopes
    // can share a name. A good heuristic (from Google Closure Compiler) is to
    // assign names to symbols from sibling scopes in declaration order. That way
    // local variable names are reused in each global function like this, which
    // improves gzip compression:
    //
    //   function x(a, b) { ... }
    //   function y(a, b, c) { ... }
    //
    // The parser fills this in for symbols inside nested scopes. There are three
    // slot namespaces: regular symbols, label symbols, and private symbols.
    nested_scope_slot: ?u32 = null,

    kind: Kind = Kind.other,

    // Certain symbols must not be renamed or minified. For example, the
    // "arguments" variable is declared by the runtime for every function.
    // Renaming can also break any identifier used inside a "with" statement.
    must_not_be_renamed: bool = false,

    // We automatically generate import items for property accesses off of
    // namespace imports. This lets us remove the expensive namespace imports
    // while bundling in many cases, replacing them with a cheap import item
    // instead:
    //
    //   import * as ns from 'path'
    //   ns.foo()
    //
    // That can often be replaced by this, which avoids needing the namespace:
    //
    //   import {foo} from 'path'
    //   foo()
    //
    // However, if the import is actually missing then we don't want to report a
    // compile-time error like we do for real import items. This status lets us
    // avoid this. We also need to be able to replace such import items with
    // undefined, which this status is also used for.
    import_item_status: ImportItemStatus = ImportItemStatus.none,

    // Sometimes we lower private symbols even if they are supported. For example,
    // consider the following TypeScript code:
    //
    //   class Foo {
    //     #foo = 123
    //     bar = this.#foo
    //   }
    //
    // If "useDefineForClassFields: false" is set in "tsconfig.json", then "bar"
    // must use assignment semantics instead of define semantics. We can compile
    // that to this code:
    //
    //   class Foo {
    //     constructor() {
    //       this.#foo = 123;
    //       this.bar = this.#foo;
    //     }
    //     #foo;
    //   }
    //
    // However, we can't do the same for static fields:
    //
    //   class Foo {
    //     static #foo = 123
    //     static bar = this.#foo
    //   }
    //
    // Compiling these static fields to something like this would be invalid:
    //
    //   class Foo {
    //     static #foo;
    //   }
    //   Foo.#foo = 123;
    //   Foo.bar = Foo.#foo;
    //
    // Thus "#foo" must be lowered even though it's supported. Another case is
    // when we're converting top-level class declarations to class expressions
    // to avoid the TDZ and the class shadowing symbol is referenced within the
    // class body:
    //
    //   class Foo {
    //     static #foo = Foo
    //   }
    //
    // This cannot be converted into something like this:
    //
    //   var Foo = class {
    //     static #foo;
    //   };
    //   Foo.#foo = Foo;
    //
    private_symbol_must_be_lowered: bool = false,

    pub const Kind = enum {

        // An unbound symbol is one that isn't declared in the file it's referenced
        // in. For example, using "window" without declaring it will be unbound.
        unbound,

        // This has special merging behavior. You're allowed to re-declare these
        // symbols more than once in the same scope. These symbols are also hoisted
        // out of the scope they are declared in to the closest containing function
        // or module scope. These are the symbols with this kind:
        //
        // - Function arguments
        // - Function statements
        // - Variables declared using "var"
        //
        hoisted,
        hoisted_function,

        // There's a weird special case where catch variables declared using a simple
        // identifier (i.e. not a binding pattern) block hoisted variables instead of
        // becoming an error:
        //
        //   var e = 0;
        //   try { throw 1 } catch (e) {
        //     print(e) // 1
        //     var e = 2
        //     print(e) // 2
        //   }
        //   print(e) // 0 (since the hoisting stops at the catch block boundary)
        //
        // However, other forms are still a syntax error:
        //
        //   try {} catch (e) { let e }
        //   try {} catch ({e}) { var e }
        //
        // This symbol is for handling this weird special case.
        catch_identifier,

        // Generator and async functions are not hoisted, but still have special
        // properties such as being able to overwrite previous functions with the
        // same name
        generator_or_async_function,

        // This is the special "arguments" variable inside functions
        arguments,

        // Classes can merge with TypeScript namespaces.
        class,

        // A class-private identifier (i.e. "#foo").
        private_field,
        private_method,
        private_get,
        private_set,
        private_get_set_pair,
        private_static_field,
        private_static_method,
        private_static_get,
        private_static_set,
        private_static_get_set_pair,

        // Labels are in their own namespace
        label,

        // TypeScript enums can merge with TypeScript namespaces and other TypeScript
        // enums.
        ts_enum,

        // TypeScript namespaces can merge with classes, functions, TypeScript enums,
        // and other TypeScript namespaces.
        ts_namespace,

        // In TypeScript, imports are allowed to silently collide with symbols within
        // the module. Presumably this is because the imports may be type-only.
        import,

        // Assigning to a "const" symbol will throw a TypeError at runtime
        cconst,

        // This annotates all other symbols that don't have special behavior.
        other,
    };

    pub const Use = struct {
        count_estimate: u32 = 0,
    };

    pub const Map = struct {
        // This could be represented as a "map[Ref]Symbol" but a two-level array was
        // more efficient in profiles. This appears to be because it doesn't involve
        // a hash. This representation also makes it trivial to quickly merge symbol
        // maps from multiple files together. Each file only generates symbols in a
        // single inner array, so you can join the maps together by just make a
        // single outer array containing all of the inner arrays. See the comment on
        // "Ref" for more detail.
        symbols_for_source: [][]Symbol,

        pub fn get(self: *Map, ref: Ref) ?Symbol {
            if (Ref.isSourceIndexNull(ref.source_index)) {
                return null;
            }

            return self.symbols_for_source[ref.source_index][ref.inner_index];
        }

        pub fn init(sourceCount: usize, allocator: *std.mem.Allocator) !Map {
            var symbols_for_source: [][]Symbol = try allocator.alloc([]Symbol, sourceCount);
            return Map{ .symbols_for_source = symbols_for_source };
        }

        pub fn initList(list: [][]Symbol) Map {
            return Map{ .symbols_for_source = list };
        }

        pub fn follow(symbols: *Map, ref: Ref) Ref {
            if (symbols.get(ref)) |*symbol| {
                const link = symbol.link orelse return ref;
                if (!link.eql(ref)) {
                    symbol.link = ref;
                }

                return symbol.link orelse unreachable;
            } else {
                return ref;
            }
        }
    };

    pub fn isKindPrivate(kind: Symbol.Kind) bool {
        return @enumToInt(kind) >= @enumToInt(Symbol.Kind.private_field) and @enumToInt(kind) <= @enumToInt(Symbol.Kind.private_static_get_set_pair);
    }

    pub fn isKindHoisted(kind: Symbol.Kind) bool {
        return @enumToInt(kind) == @enumToInt(Symbol.Kind.hoisted) or @enumToInt(kind) == @enumToInt(Symbol.Kind.hoisted_function);
    }

    pub fn isHoisted(self: *Symbol) bool {
        return Symbol.isKindHoisted(self.kind);
    }

    pub fn isKindHoistedOrFunction(kind: Symbol.Kind) bool {
        return isKindHoisted(kind) or kind == Symbol.Kind.generator_or_async_function;
    }

    pub fn isKindFunction(kind: Symbol.Kind) bool {
        return kind == Symbol.Kind.hoisted_function or kind == Symbol.Kind.generator_or_async_function;
    }
};

pub const OptionalChain = packed enum(u2) {

// "a?.b"
start,

// "a?.b.c" => ".c" is OptionalChainContinue
// "(a?.b).c" => ".c" is OptionalChain null
ccontinue };

pub const E = struct {
    pub const Array = struct {
        items: ExprNodeList,
        comma_after_spread: ?logger.Loc = null,
        is_single_line: bool = false,
        is_parenthesized: bool = false,
    };

    pub const Unary = struct {
        op: Op.Code,
        value: ExprNodeIndex,
    };

    pub const Binary = struct {
        left: ExprNodeIndex,
        right: ExprNodeIndex,
        op: Op.Code,
    };

    pub const Boolean = packed struct { value: bool };
    pub const Super = struct {};
    pub const Null = struct {};
    pub const This = struct {};
    pub const Undefined = struct {};
    pub const New = struct {
        target: ExprNodeIndex,
        args: ExprNodeList,

        // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
        // this call expression. See the comment inside ECall for more details.
        can_be_unwrapped_if_unused: bool = false,
    };
    pub const NewTarget = struct {};
    pub const ImportMeta = struct {};

    pub const Call = struct {
        // Node:
        target: ExprNodeIndex,
        args: ExprNodeList,
        optional_chain: ?OptionalChain = null,
        is_direct_eval: bool = false,

        // True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
        // this call expression. This is an annotation used for tree shaking, and
        // means that the call can be removed if it's unused. It does not mean the
        // call is pure (e.g. it may still return something different if called twice).
        //
        // Note that the arguments are not considered to be part of the call. If the
        // call itself is removed due to this annotation, the arguments must remain
        // if they have side effects.
        can_be_unwrapped_if_unused: bool = false,

        // Used when printing to generate the source prop on the fly
        was_jsx_element: bool = false,

        pub fn hasSameFlagsAs(a: *Call, b: *Call) bool {
            return (a.optional_chain == b.optional_chain and
                a.is_direct_eval == b.is_direct_eval and
                a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused);
        }
    };

    pub const Dot = struct {
        // target is Node
        target: ExprNodeIndex,
        name: string,
        name_loc: logger.Loc,
        optional_chain: ?OptionalChain = null,

        // If true, this property access is known to be free of side-effects. That
        // means it can be removed if the resulting value isn't used.
        can_be_removed_if_unused: bool = false,

        // If true, this property access is a function that, when called, can be
        // unwrapped if the resulting value is unused. Unwrapping means discarding
        // the call target but keeping any arguments with side effects.
        call_can_be_unwrapped_if_unused: bool = false,

        pub fn hasSameFlagsAs(a: *Dot, b: *Dot) bool {
            return (a.optional_chain == b.optional_chain and
                a.is_direct_eval == b.is_direct_eval and
                a.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused and a.call_can_be_unwrapped_if_unused == b.call_can_be_unwrapped_if_unused);
        }
    };

    pub const Index = struct {
        index: ExprNodeIndex,
        target: ExprNodeIndex,
        optional_chain: ?OptionalChain = null,

        pub fn hasSameFlagsAs(a: *Index, b: *Index) bool {
            return (a.optional_chain == b.optional_chain);
        }
    };

    pub const Arrow = struct {
        args: []G.Arg,
        body: G.FnBody,

        is_async: bool = false,
        has_rest_arg: bool = false,
        prefer_expr: bool = false, // Use shorthand if true and "Body" is a single return statement
    };

    pub const Function = struct { func: G.Fn };

    pub const Identifier = packed struct {
        ref: Ref = Ref.None,

        // If we're inside a "with" statement, this identifier may be a property
        // access. In that case it would be incorrect to remove this identifier since
        // the property access may be a getter or setter with side effects.
        must_keep_due_to_with_stmt: bool = false,

        // If true, this identifier is known to not have a side effect (i.e. to not
        // throw an exception) when referenced. If false, this identifier may or may
        // not have side effects when referenced. This is used to allow the removal
        // of known globals such as "Object" if they aren't used.
        can_be_removed_if_unused: bool = false,

        // If true, this identifier represents a function that, when called, can be
        // unwrapped if the resulting value is unused. Unwrapping means discarding
        // the call target but keeping any arguments with side effects.
        call_can_be_unwrapped_if_unused: bool = false,
    };

    // This is similar to an EIdentifier but it represents a reference to an ES6
    // import item.
    //
    // Depending on how the code is linked, the file containing this EImportIdentifier
    // may or may not be in the same module group as the file it was imported from.
    //
    // If it's the same module group than we can just merge the import item symbol
    // with the corresponding symbol that was imported, effectively renaming them
    // to be the same thing and statically binding them together.
    //
    // But if it's a different module group, then the import must be dynamically
    // evaluated using a property access off the corresponding namespace symbol,
    // which represents the result of a require() call.
    //
    // It's stored as a separate type so it's not easy to confuse with a plain
    // identifier. For example, it'd be bad if code trying to convert "{x: x}" into
    // "{x}" shorthand syntax wasn't aware that the "x" in this case is actually
    // "{x: importedNamespace.x}". This separate type forces code to opt-in to
    // doing this instead of opt-out.
    pub const ImportIdentifier = packed struct {
        ref: Ref,

        // If true, this was originally an identifier expression such as "foo". If
        // false, this could potentially have been a member access expression such
        // as "ns.foo" off of an imported namespace object.
        was_originally_identifier: bool = false,
    };

    // This is similar to EIdentifier but it represents class-private fields and
    // methods. It can be used where computed properties can be used, such as
    // EIndex and Property.
    pub const PrivateIdentifier = struct {
        ref: Ref,
    };

    /// In development mode, the new JSX transform has a few special props
    /// - `React.jsxDEV(type, arguments, key, isStaticChildren, source, self)`
    /// - `arguments`:
    ///      ```{ ...props, children: children, }```
    /// - `source`: https://github.com/babel/babel/blob/ef87648f3f05ccc393f89dea7d4c7c57abf398ce/packages/babel-plugin-transform-react-jsx-source/src/index.js#L24-L48
    ///      ```{
    ///         fileName: string | null,
    ///         columnNumber: number | null,
    ///         lineNumber: number | null,
    ///      }```
    /// - `children`:
    ///     - multiple children? the function is React.jsxsDEV, "jsxs" instead of "jsx"
    ///     - one child? the function is React.jsxDEV,
    ///     - no children? the function is React.jsxDEV and children is an empty array.
    /// `isStaticChildren`: https://github.com/facebook/react/blob/4ca62cac45c288878d2532e5056981d177f9fdac/packages/react/src/jsx/ReactJSXElementValidator.js#L369-L384 
    ///     This flag means children is an array of JSX Elements literals.
    ///     The documentation on this is sparse, but it appears that
    ///     React just calls Object.freeze on the children array.
    ///     Object.freeze, historically, is quite a bit slower[0] than just not doing that.
    ///     Given that...I am choosing to always pass "false" to this.
    ///     This also skips extra state that we'd need to track.
    ///     If React Fast Refresh ends up using this later, then we can revisit this decision.
    ///  [0]: https://github.com/automerge/automerge/issues/177
    pub const JSXElement = struct {
        /// null represents a fragment
        tag: ?ExprNodeIndex = null,

        /// props
        properties: []G.Property = &([_]G.Property{}),

        /// element children
        children: ExprNodeList = &([_]ExprNodeIndex{}),

        /// key is the key prop like <ListItem key="foo">
        key: ?ExprNodeIndex = null,

        flags: Flags.JSXElement = Flags.JSXElement{},

        pub const SpecialProp = enum {
            __self, // old react transform used this as a prop
            __source,
            key,
            any,

            pub const Map = std.ComptimeStringMap(SpecialProp, .{
                .{ "__self", .__self },
                .{ "__source", .__source },
                .{ "key", .key },
            });
        };
    };

    pub const Missing = struct {
        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(null, opts, o);
        }
    };

    pub const Number = struct {
        value: f64,
        pub fn jsonStringify(self: *const Number, opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }
    };

    pub const BigInt = struct {
        value: string,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }
    };

    pub const Object = struct {
        properties: []G.Property = &([_]G.Property{}),
        comma_after_spread: ?logger.Loc = null,
        is_single_line: bool = false,
        is_parenthesized: bool = false,
    };

    pub const Spread = struct { value: ExprNodeIndex };

    pub const String = struct {
        value: JavascriptString = &([_]u16{}),
        utf8: string = &([_]u8{}),
        legacy_octal_loc: ?logger.Loc = null,
        prefer_template: bool = false,

        pub fn isUTF8(s: *const String) bool {
            return s.utf8.len > 0;
        }

        pub fn isBlank(s: *const String) bool {
            return std.math.max(s.utf8.len, s.value.len) == 0;
        }

        pub fn isPresent(s: *const String) bool {
            return std.math.max(s.utf8.len, s.value.len) > 0;
        }

        pub fn eql(s: *const String, comptime _t: type, other: anytype) bool {
            if (s.isUTF8()) {
                switch (_t) {
                    @This() => {
                        if (other.isUTF8()) {
                            return strings.eql(s.utf8, other.utf8);
                        } else {
                            return strings.utf16EqlString(other.value, s.utf8);
                        }
                    },
                    string => {
                        return strings.eql(s.utf8, other);
                    },
                    JavascriptString => {
                        return strings.utf16EqlString(other, s.utf8);
                    },
                    else => {
                        @compileError("Invalid type");
                    },
                }
            } else {
                switch (_t) {
                    @This() => {
                        if (other.isUTF8()) {
                            return strings.utf16EqlString(s.value, other.utf8);
                        } else {
                            return std.mem.eql(u16, other.value, s.value);
                        }
                    },
                    string => {
                        return strings.utf16EqlString(s.value, other);
                    },
                    JavascriptString => {
                        return std.mem.eql(u16, other.value, s.value);
                    },
                    else => {
                        @compileError("Invalid type");
                    },
                }
            }
        }

        pub fn string(s: *const String, allocator: *std.mem.Allocator) !string {
            if (s.isUTF8()) {
                return s.utf8;
            } else {
                return strings.toUTF8Alloc(allocator, s.value);
            }
        }

        pub fn jsonStringify(s: *const String, options: anytype, writer: anytype) !void {
            var buf = [_]u8{0} ** 4096;
            var i: usize = 0;
            for (s.value) |char| {
                buf[i] = @intCast(u8, char);
                i += 1;
                if (i >= 4096) {
                    break;
                }
            }

            return try std.json.stringify(buf[0..i], options, writer);
        }
    };

    // value is in the Node
    pub const TemplatePart = struct {
        value: ExprNodeIndex,
        tail_loc: logger.Loc,
        tail: E.String,
    };

    pub const Template = struct {
        tag: ?ExprNodeIndex = null,
        head: E.String,
        parts: []TemplatePart = &([_]TemplatePart{}),
        legacy_octal_loc: logger.Loc = logger.Loc.Empty,
    };

    pub const RegExp = struct {
        value: string,

        pub fn jsonStringify(self: *const RegExp, opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }
    };

    pub const Class = G.Class;

    pub const Await = struct {
        value: ExprNodeIndex,
    };

    pub const Yield = struct {
        value: ?ExprNodeIndex = null,
        is_star: bool = false,
    };

    pub const If = struct {
        test_: ExprNodeIndex,
        yes: ExprNodeIndex,
        no: ExprNodeIndex,
    };

    pub const Require = packed struct {
        import_record_index: u32 = 0,
    };

    pub const RequireOrRequireResolve = struct {
        import_record_index: u32 = 0,
    };

    pub const Import = struct {
        expr: ExprNodeIndex,
        import_record_index: u32,

        // Comments inside "import()" expressions have special meaning for Webpack.
        // Preserving comments inside these expressions makes it possible to use
        // esbuild as a TypeScript-to-JavaScript frontend for Webpack to improve
        // performance. We intentionally do not interpret these comments in esbuild
        // because esbuild is not Webpack. But we do preserve them since doing so is
        // harmless, easy to maintain, and useful to people. See the Webpack docs for
        // more info: https://webpack.js.org/api/module-methods/#magic-comments.
        // TODO:
        leading_interior_comments: []G.Comment = &([_]G.Comment{}),
    };
};

pub const Stmt = struct {
    loc: logger.Loc,
    data: Data,

    const Serializable = struct {
        @"type": Tag,
        object: string,
        value: Data,
        loc: logger.Loc,
    };

    pub fn jsonStringify(self: *const Stmt, options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .@"type" = std.meta.activeTag(self.data), .object = "stmt", .value = self.data, .loc = self.loc }, options, writer);
    }

    pub fn isTypeScript(self: *Stmt) bool {
        return @as(Stmt.Tag, self.data) == .s_type_script;
    }

    pub fn empty() Stmt {
        return Stmt.init(Stmt.None, logger.Loc.Empty);
    }

    var None = S.Empty{};

    pub inline fn getBlock(self: *const @This()) *S.Block {
        return Data.Store.Block.at(self.data.s_block);
    }
    pub inline fn getBreak(self: *const @This()) *S.Break {
        return Data.Store.Break.at(self.data.s_break);
    }
    pub inline fn getClass(self: *const @This()) *S.Class {
        return Data.Store.Class.at(self.data.s_class);
    }
    pub inline fn getComment(self: *const @This()) *S.Comment {
        return Data.Store.Comment.at(self.data.s_comment);
    }
    pub inline fn getContinue(self: *const @This()) *S.Continue {
        return Data.Store.Continue.at(self.data.s_continue);
    }
    pub inline fn getDebugger(self: *const @This()) S.Debugger {
        return S.Debugger{};
    }
    pub inline fn getDirective(self: *const @This()) *S.Directive {
        return Data.Store.Directive.at(self.data.s_directive);
    }
    pub inline fn getDoWhile(self: *const @This()) *S.DoWhile {
        return Data.Store.DoWhile.at(self.data.s_do_while);
    }
    pub inline fn getEmpty(self: *const @This()) S.Empty {
        return S.Empty{};
    }
    pub inline fn getEnum(self: *const @This()) *S.Enum {
        return Data.Store.Enum.at(self.data.s_enum);
    }
    pub inline fn getExportClause(self: *const @This()) *S.ExportClause {
        return Data.Store.ExportClause.at(self.data.s_export_clause);
    }
    pub inline fn getExportDefault(self: *const @This()) *S.ExportDefault {
        return Data.Store.ExportDefault.at(self.data.s_export_default);
    }
    pub inline fn getExportEquals(self: *const @This()) *S.ExportEquals {
        return Data.Store.ExportEquals.at(self.data.s_export_equals);
    }
    pub inline fn getExportFrom(self: *const @This()) *S.ExportFrom {
        return Data.Store.ExportFrom.at(self.data.s_export_from);
    }
    pub inline fn getExportStar(self: *const @This()) *S.ExportStar {
        return Data.Store.ExportStar.at(self.data.s_export_star);
    }
    pub inline fn getExpr(self: *const @This()) *S.SExpr {
        return Data.Store.SExpr.at(self.data.s_expr);
    }
    pub inline fn getForIn(self: *const @This()) *S.ForIn {
        return Data.Store.ForIn.at(self.data.s_for_in);
    }
    pub inline fn getForOf(self: *const @This()) *S.ForOf {
        return Data.Store.ForOf.at(self.data.s_for_of);
    }
    pub inline fn getFor(self: *const @This()) *S.For {
        return Data.Store.For.at(self.data.s_for);
    }
    pub inline fn getFunction(self: *const @This()) *S.Function {
        return Data.Store.Function.at(self.data.s_function);
    }
    pub inline fn getIf(self: *const @This()) *S.If {
        return Data.Store.If.at(self.data.s_if);
    }
    pub inline fn getImport(self: *const @This()) *S.Import {
        return Data.Store.Import.at(self.data.s_import);
    }
    pub inline fn getLabel(self: *const @This()) *S.Label {
        return Data.Store.Label.at(self.data.s_label);
    }
    pub inline fn getLazyExport(self: *const @This()) *S.LazyExport {
        return Data.Store.LazyExport.at(self.data.s_lazy_export);
    }
    pub inline fn getLocal(self: *const @This()) *S.Local {
        return Data.Store.Local.at(self.data.s_local);
    }
    pub inline fn getNamespace(self: *const @This()) *S.Namespace {
        return Data.Store.Namespace.at(self.data.s_namespace);
    }
    pub inline fn getReturn(self: *const @This()) *S.Return {
        return Data.Store.Return.at(self.data.s_return);
    }
    pub inline fn getSwitch(self: *const @This()) *S.Switch {
        return Data.Store.Switch.at(self.data.s_switch);
    }
    pub inline fn getThrow(self: *const @This()) *S.Throw {
        return Data.Store.Throw.at(self.data.s_throw);
    }
    pub inline fn getTry(self: *const @This()) *S.Try {
        return Data.Store.Try.at(self.data.s_try);
    }
    pub inline fn getTypeScript(self: *const @This()) S.TypeScript {
        return S.TypeScript{};
    }
    pub inline fn getWhile(self: *const @This()) *S.While {
        return Data.Store.While.at(self.data.s_while);
    }
    pub inline fn getWith(self: *const @This()) *S.With {
        return Data.Store.With.at(self.data.s_with);
    }
    pub var icount: usize = 0;
    pub fn init(origData: anytype, loc: logger.Loc) Stmt {
        icount += 1;
        if (@typeInfo(@TypeOf(origData)) != .Pointer and @TypeOf(origData) != S.Empty) {
            @compileError("Stmt.init needs a pointer.");
        }

        if (@TypeOf(origData) == S.Empty) {
            return Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } };
        }

        switch (@TypeOf(origData.*)) {
            S.Block => {
                return Stmt.comptime_init("s_block", S.Block, origData, loc);
            },
            S.Break => {
                return Stmt.comptime_init("s_break", S.Break, origData, loc);
            },
            S.Class => {
                return Stmt.comptime_init("s_class", S.Class, origData, loc);
            },
            S.Comment => {
                return Stmt.comptime_init("s_comment", S.Comment, origData, loc);
            },
            S.Continue => {
                return Stmt.comptime_init("s_continue", S.Continue, origData, loc);
            },
            S.Debugger => {
                return Stmt.comptime_init("s_debugger", S.Debugger, origData, loc);
            },
            S.Directive => {
                return Stmt.comptime_init("s_directive", S.Directive, origData, loc);
            },
            S.DoWhile => {
                return Stmt.comptime_init("s_do_while", S.DoWhile, origData, loc);
            },
            S.Empty => {
                return Stmt.comptime_init("s_empty", S.Empty, origData, loc);
            },
            S.Enum => {
                return Stmt.comptime_init("s_enum", S.Enum, origData, loc);
            },
            S.ExportClause => {
                return Stmt.comptime_init("s_export_clause", S.ExportClause, origData, loc);
            },
            S.ExportDefault => {
                return Stmt.comptime_init("s_export_default", S.ExportDefault, origData, loc);
            },
            S.ExportEquals => {
                return Stmt.comptime_init("s_export_equals", S.ExportEquals, origData, loc);
            },
            S.ExportFrom => {
                return Stmt.comptime_init("s_export_from", S.ExportFrom, origData, loc);
            },
            S.ExportStar => {
                return Stmt.comptime_init("s_export_star", S.ExportStar, origData, loc);
            },
            S.SExpr => {
                return Stmt.comptime_init("s_expr", S.SExpr, origData, loc);
            },
            S.ForIn => {
                return Stmt.comptime_init("s_for_in", S.ForIn, origData, loc);
            },
            S.ForOf => {
                return Stmt.comptime_init("s_for_of", S.ForOf, origData, loc);
            },
            S.For => {
                return Stmt.comptime_init("s_for", S.For, origData, loc);
            },
            S.Function => {
                return Stmt.comptime_init("s_function", S.Function, origData, loc);
            },
            S.If => {
                return Stmt.comptime_init("s_if", S.If, origData, loc);
            },
            S.Import => {
                return Stmt.comptime_init("s_import", S.Import, origData, loc);
            },
            S.Label => {
                return Stmt.comptime_init("s_label", S.Label, origData, loc);
            },
            S.LazyExport => {
                return Stmt.comptime_init("s_lazy_export", S.LazyExport, origData, loc);
            },
            S.Local => {
                return Stmt.comptime_init("s_local", S.Local, origData, loc);
            },
            S.Namespace => {
                return Stmt.comptime_init("s_namespace", S.Namespace, origData, loc);
            },
            S.Return => {
                return Stmt.comptime_init("s_return", S.Return, origData, loc);
            },
            S.Switch => {
                return Stmt.comptime_init("s_switch", S.Switch, origData, loc);
            },
            S.Throw => {
                return Stmt.comptime_init("s_throw", S.Throw, origData, loc);
            },
            S.Try => {
                return Stmt.comptime_init("s_try", S.Try, origData, loc);
            },
            S.TypeScript => {
                return Stmt.comptime_init("s_type_script", S.TypeScript, origData, loc);
            },
            S.While => {
                return Stmt.comptime_init("s_while", S.While, origData, loc);
            },
            S.With => {
                return Stmt.comptime_init("s_with", S.With, origData, loc);
            },
            else => {
                @compileError("Invalid type in Stmt.init");
            },
        }
    }
    inline fn comptime_alloc(allocator: *std.mem.Allocator, comptime tag_name: string, comptime typename: type, origData: anytype, loc: logger.Loc) Stmt {
        return Stmt{ .loc = loc, .data = @unionInit(Data, tag_name, Data.Store.append(typename, origData)) };
    }

    inline fn comptime_init(comptime tag_name: string, comptime typename: type, origData: anytype, loc: logger.Loc) Stmt {
        return Stmt{ .loc = loc, .data = @unionInit(Data, tag_name, origData) };
    }

    pub fn alloc(allocator: *std.mem.Allocator, origData: anytype, loc: logger.Loc) Stmt {
        icount += 1;
        switch (@TypeOf(origData)) {
            S.Block => {
                return Stmt.comptime_alloc(allocator, "s_block", S.Block, origData, loc);
            },
            S.Break => {
                return Stmt.comptime_alloc(allocator, "s_break", S.Break, origData, loc);
            },
            S.Class => {
                return Stmt.comptime_alloc(allocator, "s_class", S.Class, origData, loc);
            },
            S.Comment => {
                return Stmt.comptime_alloc(allocator, "s_comment", S.Comment, origData, loc);
            },
            S.Continue => {
                return Stmt.comptime_alloc(allocator, "s_continue", S.Continue, origData, loc);
            },
            S.Debugger => {
                return Stmt{ .loc = loc, .data = .{ .s_debugger = origData } };
            },
            S.Directive => {
                return Stmt.comptime_alloc(allocator, "s_directive", S.Directive, origData, loc);
            },
            S.DoWhile => {
                return Stmt.comptime_alloc(allocator, "s_do_while", S.DoWhile, origData, loc);
            },
            S.Empty => {
                return Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } };
            },
            S.Enum => {
                return Stmt.comptime_alloc(allocator, "s_enum", S.Enum, origData, loc);
            },
            S.ExportClause => {
                return Stmt.comptime_alloc(allocator, "s_export_clause", S.ExportClause, origData, loc);
            },
            S.ExportDefault => {
                return Stmt.comptime_alloc(allocator, "s_export_default", S.ExportDefault, origData, loc);
            },
            S.ExportEquals => {
                return Stmt.comptime_alloc(allocator, "s_export_equals", S.ExportEquals, origData, loc);
            },
            S.ExportFrom => {
                return Stmt.comptime_alloc(allocator, "s_export_from", S.ExportFrom, origData, loc);
            },
            S.ExportStar => {
                return Stmt.comptime_alloc(allocator, "s_export_star", S.ExportStar, origData, loc);
            },
            S.SExpr => {
                return Stmt.comptime_alloc(allocator, "s_expr", S.SExpr, origData, loc);
            },
            S.ForIn => {
                return Stmt.comptime_alloc(allocator, "s_for_in", S.ForIn, origData, loc);
            },
            S.ForOf => {
                return Stmt.comptime_alloc(allocator, "s_for_of", S.ForOf, origData, loc);
            },
            S.For => {
                return Stmt.comptime_alloc(allocator, "s_for", S.For, origData, loc);
            },
            S.Function => {
                return Stmt.comptime_alloc(allocator, "s_function", S.Function, origData, loc);
            },
            S.If => {
                return Stmt.comptime_alloc(allocator, "s_if", S.If, origData, loc);
            },
            S.Import => {
                return Stmt.comptime_alloc(allocator, "s_import", S.Import, origData, loc);
            },
            S.Label => {
                return Stmt.comptime_alloc(allocator, "s_label", S.Label, origData, loc);
            },
            S.LazyExport => {
                return Stmt.comptime_alloc(allocator, "s_lazy_export", S.LazyExport, origData, loc);
            },
            S.Local => {
                return Stmt.comptime_alloc(allocator, "s_local", S.Local, origData, loc);
            },
            S.Namespace => {
                return Stmt.comptime_alloc(allocator, "s_namespace", S.Namespace, origData, loc);
            },
            S.Return => {
                return Stmt.comptime_alloc(allocator, "s_return", S.Return, origData, loc);
            },
            S.Switch => {
                return Stmt.comptime_alloc(allocator, "s_switch", S.Switch, origData, loc);
            },
            S.Throw => {
                return Stmt.comptime_alloc(allocator, "s_throw", S.Throw, origData, loc);
            },
            S.Try => {
                return Stmt.comptime_alloc(allocator, "s_try", S.Try, origData, loc);
            },
            S.TypeScript => {
                return Stmt{ .loc = loc, .data = Data{ .s_type_script = S.TypeScript{} } };
            },
            S.While => {
                return Stmt.comptime_alloc(allocator, "s_while", S.While, origData, loc);
            },
            S.With => {
                return Stmt.comptime_alloc(allocator, "s_with", S.With, origData, loc);
            },

            else => {
                @compileError("Invalid type in Stmt.init");
            },
        }
    }

    pub const Tag = enum(u6) {
        s_block,
        s_break,
        s_class,
        s_comment,
        s_continue,
        s_debugger,
        s_directive,
        s_do_while,
        s_empty,
        s_enum,
        s_export_clause,
        s_export_default,
        s_export_equals,
        s_export_from,
        s_export_star,
        s_expr,
        s_for_in,
        s_for_of,
        s_for,
        s_function,
        s_if,
        s_import,
        s_label,
        s_lazy_export,
        s_local,
        s_namespace,
        s_return,
        s_switch,
        s_throw,
        s_try,
        s_type_script,
        s_while,
        s_with,
    };

    pub const Data = union(Tag) {
        s_block: ListIndex,
        s_break: ListIndex,
        s_class: ListIndex,
        s_comment: ListIndex,
        s_continue: ListIndex,
        s_debugger: S.Debugger,
        s_directive: ListIndex,
        s_do_while: ListIndex,
        s_empty: S.Empty, // special case, its a zero value type
        s_enum: ListIndex,
        s_export_clause: ListIndex,
        s_export_default: ListIndex,
        s_export_equals: ListIndex,
        s_export_from: ListIndex,
        s_export_star: ListIndex,
        s_expr: ListIndex,
        s_for_in: ListIndex,
        s_for_of: ListIndex,
        s_for: ListIndex,
        s_function: ListIndex,
        s_if: ListIndex,
        s_import: ListIndex,
        s_label: ListIndex,
        s_lazy_export: ListIndex,
        s_local: ListIndex,
        s_namespace: ListIndex,
        s_return: ListIndex,
        s_switch: ListIndex,
        s_throw: ListIndex,
        s_try: ListIndex,
        s_type_script: S.TypeScript,
        s_while: ListIndex,
        s_with: ListIndex,

        pub const Store = struct {
            pub const Block = NewStore(S.Block);
            pub const Break = NewStore(S.Break);
            pub const Class = NewStore(S.Class);
            pub const Comment = NewStore(S.Comment);
            pub const Continue = NewStore(S.Continue);
            pub const Directive = NewStore(S.Directive);
            pub const DoWhile = NewStore(S.DoWhile);
            pub const Enum = NewStore(S.Enum);
            pub const ExportClause = NewStore(S.ExportClause);
            pub const ExportDefault = NewStore(S.ExportDefault);
            pub const ExportEquals = NewStore(S.ExportEquals);
            pub const ExportFrom = NewStore(S.ExportFrom);
            pub const ExportStar = NewStore(S.ExportStar);
            pub const SExpr = NewStore(S.SExpr);
            pub const ForIn = NewStore(S.ForIn);
            pub const ForOf = NewStore(S.ForOf);
            pub const For = NewStore(S.For);
            pub const Function = NewStore(S.Function);
            pub const If = NewStore(S.If);
            pub const Import = NewStore(S.Import);
            pub const Label = NewStore(S.Label);
            pub const LazyExport = NewStore(S.LazyExport);
            pub const Local = NewStore(S.Local);
            pub const Namespace = NewStore(S.Namespace);
            pub const Return = NewStore(S.Return);
            pub const Switch = NewStore(S.Switch);
            pub const Throw = NewStore(S.Throw);
            pub const Try = NewStore(S.Try);
            pub const TypeScript = NewStore(S.TypeScript);
            pub const While = NewStore(S.While);
            pub const With = NewStore(S.With);

            threadlocal var has_inited = false;
            pub fn create(allocator: *std.mem.Allocator) void {
                if (has_inited) {
                    return;
                }

                has_inited = true;
                _ = Block.init(allocator);
                _ = Break.init(allocator);
                _ = Class.init(allocator);
                _ = Comment.init(allocator);
                _ = Continue.init(allocator);
                _ = Directive.init(allocator);
                _ = DoWhile.init(allocator);
                _ = Enum.init(allocator);
                _ = ExportClause.init(allocator);
                _ = ExportDefault.init(allocator);
                _ = ExportEquals.init(allocator);
                _ = ExportFrom.init(allocator);
                _ = ExportStar.init(allocator);
                _ = SExpr.init(allocator);
                _ = ForIn.init(allocator);
                _ = ForOf.init(allocator);
                _ = For.init(allocator);
                _ = Function.init(allocator);
                _ = If.init(allocator);
                _ = Import.init(allocator);
                _ = Label.init(allocator);
                _ = LazyExport.init(allocator);
                _ = Local.init(allocator);
                _ = Namespace.init(allocator);
                _ = Return.init(allocator);
                _ = Switch.init(allocator);
                _ = Throw.init(allocator);
                _ = Try.init(allocator);
                _ = While.init(allocator);
                _ = With.init(allocator);
            }

            pub fn reset() void {
                Block.reset();
                Break.reset();
                Class.reset();
                Comment.reset();
                Continue.reset();
                Directive.reset();
                DoWhile.reset();
                Enum.reset();
                ExportClause.reset();
                ExportDefault.reset();
                ExportEquals.reset();
                ExportFrom.reset();
                ExportStar.reset();
                SExpr.reset();
                ForIn.reset();
                ForOf.reset();
                For.reset();
                Function.reset();
                If.reset();
                Import.reset();
                Label.reset();
                LazyExport.reset();
                Local.reset();
                Namespace.reset();
                Return.reset();
                Switch.reset();
                Throw.reset();
                Try.reset();
                While.reset();
                With.reset();
            }

            pub fn append(comptime ValueType: type, value: anytype) ListIndex {
                switch (comptime ValueType) {
                    S.Block => {
                        return Block.append(value);
                    },
                    S.Break => {
                        return Break.append(value);
                    },
                    S.Class => {
                        return Class.append(value);
                    },
                    S.Comment => {
                        return Comment.append(value);
                    },
                    S.Continue => {
                        return Continue.append(value);
                    },

                    S.Directive => {
                        return Directive.append(value);
                    },
                    S.DoWhile => {
                        return DoWhile.append(value);
                    },
                    S.Empty => {
                        return Empty.append(value);
                    },
                    S.Enum => {
                        return Enum.append(value);
                    },
                    S.ExportClause => {
                        return ExportClause.append(value);
                    },
                    S.ExportDefault => {
                        return ExportDefault.append(value);
                    },
                    S.ExportEquals => {
                        return ExportEquals.append(value);
                    },
                    S.ExportFrom => {
                        return ExportFrom.append(value);
                    },
                    S.ExportStar => {
                        return ExportStar.append(value);
                    },
                    S.SExpr => {
                        return SExpr.append(value);
                    },
                    S.ForIn => {
                        return ForIn.append(value);
                    },
                    S.ForOf => {
                        return ForOf.append(value);
                    },
                    S.For => {
                        return For.append(value);
                    },
                    S.Function => {
                        return Function.append(value);
                    },
                    S.If => {
                        return If.append(value);
                    },
                    S.Import => {
                        return Import.append(value);
                    },
                    S.Label => {
                        return Label.append(value);
                    },
                    S.LazyExport => {
                        return LazyExport.append(value);
                    },
                    S.Local => {
                        return Local.append(value);
                    },
                    S.Namespace => {
                        return Namespace.append(value);
                    },
                    S.Return => {
                        return Return.append(value);
                    },
                    S.Switch => {
                        return Switch.append(value);
                    },
                    S.Throw => {
                        return Throw.append(value);
                    },
                    S.Try => {
                        return Try.append(value);
                    },

                    S.While => {
                        return While.append(value);
                    },
                    S.With => {
                        return With.append(value);
                    },
                    else => {
                        @compileError("Invalid type passed to Stmt.Data.set " ++ @typeName(ValueType));
                    },
                }
            }

            pub fn NewStore(comptime ValueType: type) type {
                const count = 8096;
                const max_index = count - 1;
                const list_count = count;
                return struct {
                    pub threadlocal var backing_buf: [count]ValueType = undefined;
                    pub threadlocal var backing_buf_used: u16 = 0;
                    const Allocator = std.mem.Allocator;
                    const Self = @This();
                    const NotFound = allocators.NotFound;
                    const Unassigned = allocators.Unassigned;

                    overflow_list: std.ArrayListUnmanaged(ValueType),
                    allocator: *Allocator,

                    pub threadlocal var instance: Self = undefined;
                    pub threadlocal var self: *Self = undefined;

                    pub fn reset() void {
                        backing_buf_used = 0;
                        self.overflow_list.items.len = 0;
                    }

                    pub fn init(allocator: *std.mem.Allocator) *Self {
                        instance = Self{
                            .allocator = allocator,
                            .overflow_list = std.ArrayListUnmanaged(ValueType){},
                        };

                        self = &instance;
                        return self;
                    }

                    pub fn isOverflowing() bool {
                        return backing_buf_used >= @as(u16, count);
                    }

                    pub fn at(index: ListIndex) *ValueType {
                        std.debug.assert(index.index != NotFound.index and index.index != Unassigned.index);

                        if (index.is_overflowing) {
                            return &self.overflow_list.items[index.index];
                        } else {
                            return &backing_buf[index.index];
                        }
                    }

                    pub fn exists(value: ValueType) bool {
                        return isSliceInBuffer(value, backing_buf);
                    }

                    pub fn append(value: ValueType) ListIndex {
                        var result = ListIndex{ .index = std.math.maxInt(u31), .is_overflowing = backing_buf_used > max_index };
                        if (result.is_overflowing) {
                            result.index = @intCast(u31, self.overflow_list.items.len);
                            self.overflow_list.append(self.allocator, value) catch unreachable;
                        } else {
                            result.index = backing_buf_used;
                            backing_buf[result.index] = value;
                            backing_buf_used += 1;
                            if (backing_buf_used >= max_index and self.overflow_list.capacity == 0) {
                                self.overflow_list = @TypeOf(self.overflow_list).initCapacity(self.allocator, 1) catch unreachable;
                            }
                        }

                        return result;
                    }
                };
            }
        };

        pub inline fn set(data: *Data, value: anytype) void {
            const ValueType = @TypeOf(value);
            if (@typeInfo(ValueType) == .Pointer) {
                data.setValue(@TypeOf(value.*), value.*);
            } else {
                data.setValue(@TypeOf(value), value);
            }
        }

        pub inline fn setValue(data: *Data, comptime ValueType: type, value: ValueType) void {
            switch (comptime ValueType) {
                S.Block => {
                    data.s_block = Block.append(value);
                },
                S.Break => {
                    data.s_break = Break.append(value);
                },
                S.Class => {
                    data.s_class = Class.append(value);
                },
                S.Comment => {
                    data.s_comment = Comment.append(value);
                },
                S.Continue => {
                    data.s_continue = Continue.append(value);
                },
                S.Debugger => {
                    data.s_debugger = Debugger.append(value);
                },
                S.Directive => {
                    data.s_directive = Directive.append(value);
                },
                S.DoWhile => {
                    data.s_do_while = DoWhile.append(value);
                },
                S.Empty => {
                    data.s_empty = Empty.append(value);
                },
                S.Enum => {
                    data.s_enum = Enum.append(value);
                },
                S.ExportClause => {
                    data.s_export_clause = ExportClause.append(value);
                },
                S.ExportDefault => {
                    data.s_export_default = ExportDefault.append(value);
                },
                S.ExportEquals => {
                    data.s_export_equals = ExportEquals.append(value);
                },
                S.ExportFrom => {
                    data.s_export_from = ExportFrom.append(value);
                },
                S.ExportStar => {
                    data.s_export_star = ExportStar.append(value);
                },
                S.SExpr => {
                    data.s_s_expr = SExpr.append(value);
                },
                S.ForIn => {
                    data.s_for_in = ForIn.append(value);
                },
                S.ForOf => {
                    data.s_for_of = ForOf.append(value);
                },
                S.For => {
                    data.s_for = For.append(value);
                },
                S.Function => {
                    data.s_function = Function.append(value);
                },
                S.If => {
                    data.s_if = If.append(value);
                },
                S.Import => {
                    data.s_import = Import.append(value);
                },
                S.Label => {
                    data.s_label = Label.append(value);
                },
                S.LazyExport => {
                    data.s_lazy_export = LazyExport.append(value);
                },
                S.Local => {
                    data.s_local = Local.append(value);
                },
                S.Namespace => {
                    data.s_namespace = Namespace.append(value);
                },
                S.Return => {
                    data.s_return = Return.append(value);
                },
                S.Switch => {
                    data.s_switch = Switch.append(value);
                },
                S.Throw => {
                    data.s_throw = Throw.append(value);
                },
                S.Try => {
                    data.s_try = Try.append(value);
                },
                S.TypeScript => {
                    data.s_type_script = value;
                },
                S.While => {
                    data.s_while = While.append(value);
                },
                S.With => {
                    data.s_with = With.append(value);
                },
                else => {
                    @compileError("Invalid type passed to Stmt.Data.set " ++ @typeName(ValueType));
                },
            }
        }
    };

    pub fn caresAboutScope(self: *Stmt) bool {
        return switch (self.data) {
            .s_block, .s_empty, .s_debugger, .s_expr, .s_if, .s_for, .s_for_in, .s_for_of, .s_do_while, .s_while, .s_with, .s_try, .s_switch, .s_return, .s_throw, .s_break, .s_continue, .s_directive => {
                return false;
            },

            .s_local => |local| {
                return local.kind != Kind.k_var;
            },
            else => {
                return true;
            },
        };
    }
};

pub const Expr = struct {
    loc: logger.Loc,
    data: Data,
    pub fn toEmpty(expr: *Expr) Expr {
        return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = expr.loc };
    }
    pub fn isEmpty(expr: *Expr) bool {
        return std.meta.activeTag(expr.data) == .e_missing;
    }
    pub const Query = struct { expr: Expr, loc: logger.Loc };

    pub fn getArray(exp: *const Expr) *E.Array {
        return Data.Store.Array.at(exp.data.e_array);
    }
    pub fn getUnary(exp: *const Expr) *E.Unary {
        return Data.Store.Unary.at(exp.data.e_unary);
    }
    pub fn getBinary(exp: *const Expr) *E.Binary {
        return Data.Store.Binary.at(exp.data.e_binary);
    }
    pub fn getThis(exp: *const Expr) *E.This {
        return E.This{};
    }
    pub fn getClass(exp: *const Expr) *E.Class {
        return Data.Store.Class.at(exp.data.e_class);
    }
    pub fn getBoolean(exp: *const Expr) *E.Boolean {
        return Data.Store.Boolean.at(exp.data.e_boolean);
    }
    pub fn getSuper(exp: *const Expr) *E.Super {
        return Data.Store.Super.at(exp.data.e_super);
    }
    pub fn getNull(exp: *const Expr) *E.Null {
        return Data.Store.Null.at(exp.data.e_null);
    }
    pub fn getUndefined(exp: *const Expr) *E.Undefined {
        return Data.Store.Undefined.at(exp.data.e_undefined);
    }
    pub fn getNew(exp: *const Expr) *E.New {
        return Data.Store.New.at(exp.data.e_new);
    }
    pub fn getNewTarget(exp: *const Expr) *E.NewTarget {
        return &E.NewTarget{};
    }
    pub fn getFunction(exp: *const Expr) *E.Function {
        return Data.Store.Function.at(exp.data.e_function);
    }

    pub fn getCall(exp: *const Expr) *E.Call {
        return Data.Store.Call.at(exp.data.e_call);
    }
    pub fn getDot(exp: *const Expr) *E.Dot {
        return Data.Store.Dot.at(exp.data.e_dot);
    }
    pub fn getIndex(exp: *const Expr) *E.Index {
        return Data.Store.Index.at(exp.data.e_index);
    }
    pub fn getArrow(exp: *const Expr) *E.Arrow {
        return Data.Store.Arrow.at(exp.data.e_arrow);
    }
    pub fn getIdentifier(exp: *const Expr) *E.Identifier {
        return Data.Store.Identifier.at(exp.data.e_identifier);
    }
    pub fn getImportIdentifier(exp: *const Expr) *E.ImportIdentifier {
        return Data.Store.ImportIdentifier.at(exp.data.e_import_identifier);
    }
    pub fn getPrivateIdentifier(exp: *const Expr) *E.PrivateIdentifier {
        return Data.Store.PrivateIdentifier.at(exp.data.e_private_identifier);
    }
    pub fn getJsxElement(exp: *const Expr) *E.JSXElement {
        return Data.Store.JSXElement.at(exp.data.e_jsx_element);
    }
    pub fn getMissing(exp: *const Expr) *E.Missing {
        return Data.Store.Missing.at(exp.data.e_missing);
    }
    pub fn getNumber(exp: *const Expr) *E.Number {
        return Data.Store.Number.at(exp.data.e_number);
    }
    pub fn getBigInt(exp: *const Expr) *E.BigInt {
        return Data.Store.BigInt.at(exp.data.e_big_int);
    }
    pub fn getObject(exp: *const Expr) *E.Object {
        return Data.Store.Object.at(exp.data.e_object);
    }
    pub fn getSpread(exp: *const Expr) *E.Spread {
        return Data.Store.Spread.at(exp.data.e_spread);
    }
    pub fn getString(exp: *const Expr) *E.String {
        return Data.Store.String.at(exp.data.e_string);
    }
    pub fn getTemplatePart(exp: *const Expr) *E.TemplatePart {
        return Data.Store.TemplatePart.at(exp.data.e_template_part);
    }
    pub fn getTemplate(exp: *const Expr) *E.Template {
        return Data.Store.Template.at(exp.data.e_template);
    }
    pub fn getRegExp(exp: *const Expr) *E.RegExp {
        return Data.Store.RegExp.at(exp.data.e_reg_exp);
    }
    pub fn getAwait(exp: *const Expr) *E.Await {
        return Data.Store.Await.at(exp.data.e_await);
    }
    pub fn getYield(exp: *const Expr) *E.Yield {
        return Data.Store.Yield.at(exp.data.e_yield);
    }
    pub fn getIf(exp: *const Expr) *E.If {
        return Data.Store.If.at(exp.data.e_if);
    }
    pub fn getRequire(exp: *const Expr) *E.Require {
        return Data.Store.Require.at(exp.data.e_require);
    }
    pub fn getRequireOrRequireResolve(exp: *const Expr) *E.RequireOrRequireResolve {
        return Data.Store.RequireOrRequireResolve.at(exp.data.e_require_or_require_resolve);
    }
    pub fn getImport(exp: *const Expr) *E.Import {
        return Data.Store.Import.at(exp.data.e_import);
    }

    pub fn asProperty(expr: *const Expr, name: string) ?Query {
        if (std.meta.activeTag(expr.data) != .e_object) return null;
        const obj = expr.getObject();

        for (obj.properties) |prop| {
            const value = prop.value orelse continue;
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            const key_str: *const E.String = key.getString();
            if (key_str.eql(string, name)) {
                return Query{ .expr = value, .loc = key.loc };
            }
        }

        return null;
    }

    pub fn asString(expr: *const Expr, allocator: *std.mem.Allocator) ?string {
        if (std.meta.activeTag(expr.data) != .e_string) return null;

        const key_str: *const E.String = expr.getString();

        return if (key_str.isUTF8()) key_str.utf8 else key_str.string(allocator) catch null;
    }

    pub fn asBool(
        expr: *const Expr,
    ) ?bool {
        if (std.meta.activeTag(expr.data) != .e_boolean) return null;

        const obj = expr.getBoolean();

        return obj.value;
    }

    pub const EFlags = enum { none, ts_decorator };

    const Serializable = struct {
        @"type": Tag,
        object: string,
        value: Data,
        loc: logger.Loc,
    };

    pub fn isMissing(a: *const Expr) bool {
        return std.meta.activeTag(a.data) == Expr.Tag.e_missing;
    }

    pub fn joinWithComma(a: Expr, b: Expr, allocator: *std.mem.Allocator) Expr {
        if (a.isMissing()) {
            return b;
        }

        if (b.isMissing()) {
            return a;
        }

        return Expr.alloc(allocator, E.Binary{ .op = .bin_comma, .left = a, .right = b }, a.loc);
    }

    pub fn joinAllWithComma(all: []Expr, allocator: *std.mem.Allocator) Expr {
        std.debug.assert(all.len > 0);
        switch (all.len) {
            1 => {
                return all[0];
            },
            2 => {
                return Expr.joinWithComma(all[0], all[1], allocator);
            },
            else => {
                var i: usize = 1;
                var expr = all[0];
                while (i < all.len) : (i += 1) {
                    expr = Expr.joinWithComma(expr, all[i], allocator);
                }

                return expr;
            },
        }
    }

    pub fn jsonStringify(self: *const @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(Serializable{ .@"type" = std.meta.activeTag(self.data), .object = "expr", .value = self.data, .loc = self.loc }, options, writer);
    }

    pub fn extractNumericValues(left: Expr.Data, right: Expr.Data) ?[2]f64 {
        if (!(@as(Expr.Tag, left) == .e_number and @as(Expr.Tag, right) == .e_number)) {
            return null;
        }

        return [2]f64{ Expr.Data.Store.Number.at(left.e_number).value, Expr.Data.Store.Number.at(right.e_number).value };
    }

    pub fn isAnonymousNamed(e: *Expr) bool {
        switch (e.data) {
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

    pub var icount: usize = 0;
    pub fn init(exp: anytype, loc: logger.Loc) Expr {
        icount += 1;
        const st = exp.*;
        switch (@TypeOf(st)) {
            E.Array => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_array = Data.Store.Array.append(st),
                    },
                };
            },
            E.Class => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_class = Data.Store.Class.append(st),
                    },
                };
            },
            E.Unary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_unary = Data.Store.Unary.append(st),
                    },
                };
            },
            E.Binary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_binary = Data.Store.Binary.append(st),
                    },
                };
            },
            E.This => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_this = st,
                    },
                };
            },
            E.Boolean => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_boolean = Data.Store.Boolean.append(st),
                    },
                };
            },
            E.Super => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_super = st,
                    },
                };
            },
            E.Null => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_null = st,
                    },
                };
            },
            E.Undefined => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_undefined = st,
                    },
                };
            },
            E.New => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new = Data.Store.New.append(st),
                    },
                };
            },
            E.NewTarget => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new_target = st,
                    },
                };
            },
            E.Function => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_function = Data.Store.Function.append(st),
                    },
                };
            },
            E.ImportMeta => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_meta = Data.Store.ImportMeta.append(st),
                    },
                };
            },
            E.Call => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_call = Data.Store.Call.append(st),
                    },
                };
            },
            E.Dot => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_dot = Data.Store.Dot.append(st),
                    },
                };
            },
            E.Index => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_index = Data.Store.Index.append(st),
                    },
                };
            },
            E.Arrow => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_arrow = Data.Store.Arrow.append(st),
                    },
                };
            },
            E.Identifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_identifier = Data.Store.Identifier.append(st),
                    },
                };
            },
            E.ImportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_identifier = Data.Store.ImportIdentifier.append(st),
                    },
                };
            },
            E.PrivateIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_private_identifier = Data.Store.PrivateIdentifier.append(st),
                    },
                };
            },
            E.JSXElement => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_jsx_element = Data.Store.JSXElement.append(st),
                    },
                };
            },
            E.Missing => {
                return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
            },
            E.Number => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_number = Data.Store.Number.append(st),
                    },
                };
            },
            E.BigInt => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_big_int = Data.Store.BigInt.append(st),
                    },
                };
            },
            E.Object => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_object = Data.Store.Object.append(st),
                    },
                };
            },
            E.Spread => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_spread = Data.Store.Spread.append(st),
                    },
                };
            },
            E.String => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.String.append(st),
                    },
                };
            },
            E.TemplatePart => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template_part = Data.Store.TemplatePart.append(st),
                    },
                };
            },
            E.Template => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template = Data.Store.Template.append(st),
                    },
                };
            },
            E.RegExp => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_reg_exp = Data.Store.RegExp.append(st),
                    },
                };
            },
            E.Await => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_await = Data.Store.Await.append(st),
                    },
                };
            },
            E.Yield => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_yield = Data.Store.Yield.append(st),
                    },
                };
            },
            E.If => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_if = Data.Store.If.append(st),
                    },
                };
            },
            E.RequireOrRequireResolve => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_or_require_resolve = Data.Store.RequireOrRequireResolve.append(st),
                    },
                };
            },
            E.Import => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import = Data.Store.Import.append(st),
                    },
                };
            },
            E.Require => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require = Data.Store.Require.append(st),
                    },
                };
            },

            else => {
                @compileError("Invalid type passed to Expr.init");
            },
        }
    }

    pub fn alloc(allocator: *std.mem.Allocator, st: anytype, loc: logger.Loc) Expr {
        icount += 1;
        switch (@TypeOf(st)) {
            E.Array => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_array = Data.Store.Array.append(st),
                    },
                };
            },
            E.Class => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_class = Data.Store.Class.append(st),
                    },
                };
            },
            E.Unary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_unary = Data.Store.Unary.append(st),
                    },
                };
            },
            E.Binary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_binary = Data.Store.Binary.append(st),
                    },
                };
            },
            E.This => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_this = st,
                    },
                };
            },
            E.Boolean => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_boolean = Data.Store.Boolean.append(st),
                    },
                };
            },
            E.Super => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_super = st,
                    },
                };
            },
            E.Null => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_null = st,
                    },
                };
            },
            E.Undefined => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_undefined = st,
                    },
                };
            },
            E.New => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_new = Data.Store.New.append(st),
                    },
                };
            },
            E.NewTarget => {
                return Expr{
                    .loc = loc,
                    .data = Data{ .e_new_target = st },
                };
            },
            E.Function => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_function = Data.Store.Function.append(st),
                    },
                };
            },
            E.ImportMeta => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_meta = st,
                    },
                };
            },
            E.Call => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_call = Data.Store.Call.append(st),
                    },
                };
            },
            E.Dot => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_dot = Data.Store.Dot.append(st),
                    },
                };
            },
            E.Index => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_index = Data.Store.Index.append(st),
                    },
                };
            },
            E.Arrow => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_arrow = Data.Store.Arrow.append(st),
                    },
                };
            },
            E.Identifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_identifier = Data.Store.Identifier.append(st),
                    },
                };
            },
            E.ImportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_identifier = Data.Store.ImportIdentifier.append(st),
                    },
                };
            },
            E.PrivateIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_private_identifier = Data.Store.PrivateIdentifier.append(st),
                    },
                };
            },
            E.JSXElement => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_jsx_element = Data.Store.JSXElement.append(st),
                    },
                };
            },
            E.Missing => {
                return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
            },
            E.Number => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_number = Data.Store.Number.append(st),
                    },
                };
            },
            E.BigInt => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_big_int = Data.Store.BigInt.append(st),
                    },
                };
            },
            E.Object => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_object = Data.Store.Object.append(st),
                    },
                };
            },
            E.Spread => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_spread = Data.Store.Spread.append(st),
                    },
                };
            },
            E.String => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.String.append(st),
                    },
                };
            },
            E.TemplatePart => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template_part = Data.Store.TemplatePart.append(st),
                    },
                };
            },
            E.Template => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template = Data.Store.Template.append(st),
                    },
                };
            },
            E.RegExp => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_reg_exp = Data.Store.RegExp.append(st),
                    },
                };
            },
            E.Await => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_await = Data.Store.Await.append(st),
                    },
                };
            },
            E.Yield => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_yield = Data.Store.Yield.append(st),
                    },
                };
            },
            E.If => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_if = Data.Store.If.append(st),
                    },
                };
            },
            E.RequireOrRequireResolve => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_or_require_resolve = Data.Store.RequireOrRequireResolve.append(st),
                    },
                };
            },
            E.Import => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import = Data.Store.Import.append(st),
                    },
                };
            },
            E.Require => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require = Data.Store.Require.append(st),
                    },
                };
            },

            else => {
                @compileError("Invalid type passed to Expr.init");
            },
        }
    }

    pub const Tag = enum(u6) {
        e_array,
        e_unary,
        e_binary,
        e_boolean,
        e_super,
        e_null,
        e_undefined,
        e_new,
        e_function,
        e_new_target,
        e_import_meta,
        e_call,
        e_dot,
        e_index,
        e_arrow,
        e_identifier,
        e_import_identifier,
        e_private_identifier,
        e_jsx_element,
        e_missing,
        e_number,
        e_big_int,
        e_object,
        e_spread,
        e_string,
        e_template_part,
        e_template,
        e_reg_exp,
        e_await,
        e_yield,
        e_if,
        e_require_or_require_resolve,
        e_import,
        e_this,
        e_class,
        e_require,

        pub fn isArray(self: Tag) bool {
            switch (self) {
                .e_array => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isUnary(self: Tag) bool {
            switch (self) {
                .e_unary => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBinary(self: Tag) bool {
            switch (self) {
                .e_binary => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isThis(self: Tag) bool {
            switch (self) {
                .e_this => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isClass(self: Tag) bool {
            switch (self) {
                .e_class => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBoolean(self: Tag) bool {
            switch (self) {
                .e_boolean => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isSuper(self: Tag) bool {
            switch (self) {
                .e_super => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNull(self: Tag) bool {
            switch (self) {
                .e_null => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isUndefined(self: Tag) bool {
            switch (self) {
                .e_undefined => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNew(self: Tag) bool {
            switch (self) {
                .e_new => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNewTarget(self: Tag) bool {
            switch (self) {
                .e_new_target => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isFunction(self: Tag) bool {
            switch (self) {
                .e_function => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImportMeta(self: Tag) bool {
            switch (self) {
                .e_import_meta => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isCall(self: Tag) bool {
            switch (self) {
                .e_call => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isDot(self: Tag) bool {
            switch (self) {
                .e_dot => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIndex(self: Tag) bool {
            switch (self) {
                .e_index => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isArrow(self: Tag) bool {
            switch (self) {
                .e_arrow => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIdentifier(self: Tag) bool {
            switch (self) {
                .e_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImportIdentifier(self: Tag) bool {
            switch (self) {
                .e_import_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isPrivateIdentifier(self: Tag) bool {
            switch (self) {
                .e_private_identifier => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isJsxElement(self: Tag) bool {
            switch (self) {
                .e_jsx_element => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isMissing(self: Tag) bool {
            switch (self) {
                .e_missing => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isNumber(self: Tag) bool {
            switch (self) {
                .e_number => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isBigInt(self: Tag) bool {
            switch (self) {
                .e_big_int => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isObject(self: Tag) bool {
            switch (self) {
                .e_object => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isSpread(self: Tag) bool {
            switch (self) {
                .e_spread => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isString(self: Tag) bool {
            switch (self) {
                .e_string => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isTemplatePart(self: Tag) bool {
            switch (self) {
                .e_template_part => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isTemplate(self: Tag) bool {
            switch (self) {
                .e_template => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isRegExp(self: Tag) bool {
            switch (self) {
                .e_reg_exp => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isAwait(self: Tag) bool {
            switch (self) {
                .e_await => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isYield(self: Tag) bool {
            switch (self) {
                .e_yield => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isIf(self: Tag) bool {
            switch (self) {
                .e_if => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isRequireOrRequireResolve(self: Tag) bool {
            switch (self) {
                .e_require_or_require_resolve => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
        pub fn isImport(self: Tag) bool {
            switch (self) {
                .e_import => {
                    return true;
                },
                else => {
                    return false;
                },
            }
        }
    };

    pub fn isBoolean(a: Expr) bool {
        switch (a.data) {
            .e_boolean => {
                return true;
            },

            .e_if => {
                const ex = a.getIf();
                return isBoolean(ex.yes) and isBoolean(ex.no);
            },
            .e_unary => {
                const ex = a.getUnary();
                return ex.op == .un_not or ex.op == .un_delete;
            },
            .e_binary => {
                const ex = a.getBinary();
                switch (ex.op) {
                    .bin_strict_eq, .bin_strict_ne, .bin_loose_eq, .bin_loose_ne, .bin_lt, .bin_gt, .bin_le, .bin_ge, .bin_instanceof, .bin_in => {
                        return true;
                    },
                    .bin_logical_or => {
                        return isBoolean(ex.left) and isBoolean(ex.right);
                    },
                    .bin_logical_and => {
                        return isBoolean(ex.left) and isBoolean(ex.right);
                    },
                    else => {},
                }
            },
            else => {},
        }

        return false;
    }

    pub fn assign(a: Expr, b: Expr, allocator: *std.mem.Allocator) Expr {
        return alloc(allocator, E.Binary{
            .op = .bin_assign,
            .left = a,
            .right = b,
        }, a.loc);
    }
    pub inline fn at(expr: *Expr, t: anytype, allocator: *std.mem.Allocator) Expr {
        return alloc(allocator, t, expr.loc);
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(expr: *Expr, allocator: *std.mem.Allocator) Expr {
        return maybeSimplifyNot(expr, allocator) orelse expr.*;
    }

    // The given "expr" argument should be the operand of a "!" prefix operator
    // (i.e. the "x" in "!x"). This returns a simplified expression for the
    // whole operator (i.e. the "!x") if it can be simplified, or false if not.
    // It's separate from "Not()" above to avoid allocation on failure in case
    // that is undesired.
    pub fn maybeSimplifyNot(expr: *Expr, allocator: *std.mem.Allocator) ?Expr {
        switch (expr.data) {
            .e_null, .e_undefined => {
                return expr.at(E.Boolean{ .value = true }, allocator);
            },
            .e_boolean => {
                const b = expr.getBoolean();
                return expr.at(E.Boolean{ .value = b.value }, allocator);
            },
            .e_number => {
                const n = expr.getNumber();
                return expr.at(E.Boolean{ .value = (n.value == 0 or std.math.isNan(n.value)) }, allocator);
            },
            .e_big_int => {
                const b = expr.getBigInt();
                return expr.at(E.Boolean{ .value = strings.eql(b.value, "0") }, allocator);
            },
            .e_function,
            .e_arrow,
            .e_reg_exp,
            => {
                return expr.at(E.Boolean{ .value = false }, allocator);
            },
            // "!!!a" => "!a"
            .e_unary => {
                const un = expr.getUnary();
                if (un.op == Op.Code.un_not and isBoolean(un.value)) {
                    return un.value;
                }
            },
            .e_binary => {
                const ex = expr.getBinary();
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                switch (ex.op) {
                    Op.Code.bin_loose_eq => {
                        ex.op = .bin_loose_ne;
                        return expr.*;
                    },
                    Op.Code.bin_loose_ne => {
                        ex.op = .bin_loose_eq;
                        return expr.*;
                    },
                    Op.Code.bin_strict_eq => {
                        ex.op = .bin_strict_ne;
                        return expr.*;
                    },
                    Op.Code.bin_strict_ne => {
                        ex.op = .bin_strict_eq;
                        return expr.*;
                    },
                    Op.Code.bin_comma => {
                        ex.right = ex.right.not(allocator);
                        return expr.*;
                    },
                    else => {},
                }
            },

            else => {},
        }

        return null;
    }

    pub fn assignStmt(a: Expr, b: Expr, allocator: *std.mem.Allocator) Stmt {
        return Stmt.alloc(
            allocator,
            S.SExpr{
                .value = Expr.assign(a, b, allocator),
            },
            a.loc,
        );
    }

    pub fn isOptionalChain(self: *const @This()) bool {
        return switch (self.data) {
            .e_dot => self.getDot().optional_chain != null,
            .e_index => self.getIndex().optional_chain != null,
            .e_call => self.getCall().optional_chain != null,
            else => false,
        };
    }

    pub const Data = union(Tag) {
        e_array: ListIndex,
        e_unary: ListIndex,
        e_binary: ListIndex,

        e_class: ListIndex,
        e_boolean: ListIndex,

        e_missing: E.Missing,
        e_this: E.This,
        e_super: E.Super,
        e_null: E.Null,
        e_undefined: E.Undefined,
        e_new_target: E.NewTarget,

        e_new: ListIndex,

        e_function: ListIndex,
        e_import_meta: E.ImportMeta,
        e_call: ListIndex,
        e_dot: ListIndex,
        e_index: ListIndex,
        e_arrow: ListIndex,
        e_identifier: ListIndex,
        e_import_identifier: ListIndex,
        e_private_identifier: ListIndex,
        e_jsx_element: ListIndex,

        e_number: ListIndex,
        e_big_int: ListIndex,
        e_object: ListIndex,
        e_spread: ListIndex,
        e_string: ListIndex,
        e_template_part: ListIndex,
        e_template: ListIndex,
        e_reg_exp: ListIndex,
        e_await: ListIndex,
        e_yield: ListIndex,
        e_if: ListIndex,
        e_require: ListIndex,
        e_require_or_require_resolve: ListIndex,
        e_import: ListIndex,

        pub const Store = struct {
            pub const Array = NewStore(E.Array);
            pub const Unary = NewStore(E.Unary);
            pub const Binary = NewStore(E.Binary);
            pub const This = NewStore(E.This);
            pub const Class = NewStore(E.Class);
            pub const Boolean = NewStore(E.Boolean);
            pub const Super = NewStore(E.Super);
            pub const Null = NewStore(E.Null);
            pub const Undefined = NewStore(E.Undefined);
            pub const New = NewStore(E.New);
            pub const Function = NewStore(E.Function);
            pub const ImportMeta = NewStore(E.ImportMeta);
            pub const Call = NewStore(E.Call);
            pub const Dot = NewStore(E.Dot);
            pub const Index = NewStore(E.Index);
            pub const Arrow = NewStore(E.Arrow);
            pub const Identifier = NewStore(E.Identifier);
            pub const ImportIdentifier = NewStore(E.ImportIdentifier);
            pub const PrivateIdentifier = NewStore(E.PrivateIdentifier);
            pub const JSXElement = NewStore(E.JSXElement);
            pub const Missing = NewStore(E.Missing);
            pub const Number = NewStore(E.Number);
            pub const BigInt = NewStore(E.BigInt);
            pub const Object = NewStore(E.Object);
            pub const Spread = NewStore(E.Spread);
            pub const String = NewStore(E.String);
            pub const TemplatePart = NewStore(E.TemplatePart);
            pub const Template = NewStore(E.Template);
            pub const RegExp = NewStore(E.RegExp);
            pub const Await = NewStore(E.Await);
            pub const Yield = NewStore(E.Yield);
            pub const If = NewStore(E.If);
            pub const Require = NewStore(E.Require);
            pub const RequireOrRequireResolve = NewStore(E.RequireOrRequireResolve);
            pub const Import = NewStore(E.Import);

            threadlocal var has_inited = false;
            pub fn create(allocator: *std.mem.Allocator) void {
                if (has_inited) {
                    return;
                }

                has_inited = true;
                _ = Array.init(allocator);
                _ = Unary.init(allocator);
                _ = Binary.init(allocator);
                _ = This.init(allocator);
                _ = Class.init(allocator);
                _ = Boolean.init(allocator);
                _ = New.init(allocator);
                _ = Function.init(allocator);
                _ = ImportMeta.init(allocator);
                _ = Call.init(allocator);
                _ = Dot.init(allocator);
                _ = Index.init(allocator);
                _ = Arrow.init(allocator);
                _ = Identifier.init(allocator);
                _ = ImportIdentifier.init(allocator);
                _ = PrivateIdentifier.init(allocator);
                _ = JSXElement.init(allocator);
                _ = Missing.init(allocator);
                _ = Number.init(allocator);
                _ = BigInt.init(allocator);
                _ = Object.init(allocator);
                _ = Spread.init(allocator);
                _ = String.init(allocator);
                _ = TemplatePart.init(allocator);
                _ = Template.init(allocator);
                _ = RegExp.init(allocator);
                _ = Await.init(allocator);
                _ = Yield.init(allocator);
                _ = If.init(allocator);
                _ = Require.init(allocator);
                _ = RequireOrRequireResolve.init(allocator);
                _ = Import.init(allocator);
            }

            pub fn reset() void {
                Array.reset();
                Unary.reset();
                Binary.reset();
                This.reset();
                Class.reset();
                Boolean.reset();
                New.reset();
                Function.reset();
                ImportMeta.reset();
                Call.reset();
                Dot.reset();
                Index.reset();
                Arrow.reset();
                Identifier.reset();
                ImportIdentifier.reset();
                PrivateIdentifier.reset();
                JSXElement.reset();
                Missing.reset();
                Number.reset();
                BigInt.reset();
                Object.reset();
                Spread.reset();
                String.reset();
                TemplatePart.reset();
                Template.reset();
                RegExp.reset();
                Await.reset();
                Yield.reset();
                If.reset();
                Require.reset();
                RequireOrRequireResolve.reset();
                Import.reset();
            }

            pub fn append(comptime ValueType: type, value: anytype) ListIndex {
                switch (comptime ValueType) {
                    E.Array => {
                        return Array.append(value);
                    },
                    E.Unary => {
                        return Unary.append(value);
                    },
                    E.Binary => {
                        return Binary.append(value);
                    },
                    E.This => {
                        return This.append(value);
                    },
                    E.Class => {
                        return Class.append(value);
                    },
                    E.Boolean => {
                        return Boolean.append(value);
                    },
                    E.Super => {
                        return Super.append(value);
                    },
                    E.Null => {
                        return Null.append(value);
                    },
                    E.Undefined => {
                        return Undefined.append(value);
                    },
                    E.New => {
                        return New.append(value);
                    },
                    E.NewTarget => {
                        return @compileError("NewTarget bad");
                    },
                    E.Function => {
                        return Function.append(value);
                    },
                    E.ImportMeta => {
                        return ImportMeta.append(value);
                    },
                    E.Call => {
                        return Call.append(value);
                    },
                    E.Dot => {
                        return Dot.append(value);
                    },
                    E.Index => {
                        return Index.append(value);
                    },
                    E.Arrow => {
                        return Arrow.append(value);
                    },
                    E.Identifier => {
                        return Identifier.append(value);
                    },
                    E.ImportIdentifier => {
                        return ImportIdentifier.append(value);
                    },
                    E.PrivateIdentifier => {
                        return PrivateIdentifier.append(value);
                    },
                    E.JSXElement => {
                        return JSXElement.append(value);
                    },
                    E.Missing => {
                        return Missing.append(value);
                    },
                    E.Number => {
                        return Number.append(value);
                    },
                    E.BigInt => {
                        return BigInt.append(value);
                    },
                    E.Object => {
                        return Object.append(value);
                    },
                    E.Spread => {
                        return Spread.append(value);
                    },
                    E.String => {
                        return String.append(value);
                    },
                    E.TemplatePart => {
                        return TemplatePart.append(value);
                    },
                    E.Template => {
                        return Template.append(value);
                    },
                    E.RegExp => {
                        return RegExp.append(value);
                    },
                    E.Await => {
                        return Await.append(value);
                    },
                    E.Yield => {
                        return Yield.append(value);
                    },
                    E.If => {
                        return If.append(value);
                    },
                    E.Require => {
                        return Require.append(value);
                    },
                    E.RequireOrRequireResolve => {
                        return RequireOrRequireResolve.append(value);
                    },
                    E.Import => {
                        return Import.append(value);
                    },
                    else => {
                        @compileError("Invalid type passed to Stmt.Data.set " ++ @typeName(ValueType));
                    },
                }
            }

            pub fn NewStore(comptime ValueType: type) type {
                const count = 8096;
                const max_index = count - 1;
                const list_count = count;
                return struct {
                    pub threadlocal var backing_buf: [count]ValueType = undefined;
                    pub threadlocal var backing_buf_used: u16 = 0;
                    const Allocator = std.mem.Allocator;
                    const Self = @This();
                    const NotFound = allocators.NotFound;
                    const Unassigned = allocators.Unassigned;

                    overflow_list: std.ArrayListUnmanaged(ValueType),
                    allocator: *Allocator,

                    pub threadlocal var instance: Self = undefined;
                    pub threadlocal var self: *Self = undefined;

                    pub fn reset() void {
                        backing_buf_used = 0;
                        self.overflow_list.shrinkRetainingCapacity(0);
                    }

                    pub fn init(allocator: *std.mem.Allocator) *Self {
                        instance = Self{
                            .allocator = allocator,
                            .overflow_list = std.ArrayListUnmanaged(ValueType){},
                        };

                        self = &instance;
                        return self;
                    }

                    pub fn isOverflowing() bool {
                        return backing_buf_used >= @as(u16, count);
                    }

                    pub fn at(index: ListIndex) *ValueType {
                        std.debug.assert(index.index != NotFound.index and index.index != Unassigned.index);

                        if (index.is_overflowing) {
                            return &self.overflow_list.items[index.index];
                        } else {
                            return &backing_buf[index.index];
                        }
                    }

                    pub fn exists(value: ValueType) bool {
                        return isSliceInBuffer(value, backing_buf);
                    }

                    pub fn append(value: ValueType) ListIndex {
                        var result = ListIndex{ .index = std.math.maxInt(u31), .is_overflowing = backing_buf_used > max_index };
                        if (result.is_overflowing) {
                            result.index = @intCast(u31, self.overflow_list.items.len);
                            self.overflow_list.append(self.allocator, value) catch unreachable;
                        } else {
                            result.index = backing_buf_used;
                            backing_buf[result.index] = value;
                            backing_buf_used += 1;

                            if (backing_buf_used >= max_index and self.overflow_list.capacity == 0) {
                                self.overflow_list = @TypeOf(self.overflow_list).initCapacity(self.allocator, 1) catch unreachable;
                            }
                        }

                        return result;
                    }
                };
            }
        };

        pub fn isBooleanValue(self: *Expr) bool {
            // TODO:
            return false;
            // return switch (self) {
            //     Expr.e_boolean => |dot| true,
            //     Expr.e_if => |dot| dot.optional_chain != OptionalChain.none,
            //     Expr.e_call => |dot| dot.optional_chain != OptionalChain.none,
            //     else => false,
            // };
        }

        pub fn isNumericValue(self: *Expr) bool {
            // TODO:

            return false;
        }
        pub inline fn isStringValue(self: Data) bool {
            return @as(Expr.Tag, self) == .e_string;
        }
    };
};

pub const EnumValue = struct {
    loc: logger.Loc,
    ref: Ref,
    name: E.String,
    value: ?ExprNodeIndex,
};

pub const S = struct {
    pub const Block = struct { stmts: StmtNodeList };
    pub const SExpr = struct {
        value: ExprNodeIndex,

        // This is set to true for automatically-generated expressions that should
        // not affect tree shaking. For example, calling a function from the runtime
        // that doesn't have externally-visible side effects.
        does_not_affect_tree_shaking: bool = false,
    };

    pub const Comment = struct { text: string };

    pub const Directive = struct { value: JavascriptString, legacy_octal_loc: ?logger.Loc = null };

    pub const ExportClause = struct { items: []ClauseItem, is_single_line: bool = false };

    pub const Empty = struct {};

    pub const ExportStar = struct {
        namespace_ref: Ref,
        alias: ?G.ExportStarAlias = null,
        import_record_index: u32,
    };

    // This is an "export = value;" statement in TypeScript
    pub const ExportEquals = struct { value: ExprNodeIndex };

    // The decision of whether to export an expression using "module.exports" or
    // "export default" is deferred until linking using this statement kind
    pub const LazyExport = struct { value: ExprNodeIndex };

    pub const Label = struct { name: LocRef, stmt: StmtNodeIndex };

    // This is a stand-in for a TypeScript type declaration
    pub const TypeScript = struct {};

    pub const Debugger = struct {};

    pub const ExportFrom = struct {
        items: []ClauseItem,
        namespace_ref: Ref,
        import_record_index: u32,
        is_single_line: bool,
    };

    pub const ExportDefault = struct { default_name: LocRef, // value may be a SFunction or SClass
    value: StmtOrExpr };

    pub const Enum = struct {
        name: LocRef,
        arg: Ref,
        values: []EnumValue,
        is_export: bool,
    };

    pub const Namespace = struct {
        name: LocRef,
        arg: Ref,
        stmts: StmtNodeList,
        is_export: bool,
    };

    pub const Function = struct {
        func: G.Fn,
    };

    pub const Class = struct { class: G.Class, is_export: bool = false };

    pub const If = struct {
        test_: ExprNodeIndex,
        yes: StmtNodeIndex,
        no: ?StmtNodeIndex,
    };

    pub const For = struct {
    // May be a SConst, SLet, SVar, or SExpr
    init: ?StmtNodeIndex = null, test_: ?ExprNodeIndex = null, update: ?ExprNodeIndex = null, body: StmtNodeIndex };

    pub const ForIn = struct {
    // May be a SConst, SLet, SVar, or SExpr
    init: StmtNodeIndex, value: ExprNodeIndex, body: StmtNodeIndex };

    pub const ForOf = struct {
        is_await: bool = false,
        // May be a SConst, SLet, SVar, or SExpr
        init: StmtNodeIndex,
        value: ExprNodeIndex,
        body: StmtNodeIndex,
    };

    pub const DoWhile = struct { body: StmtNodeIndex, test_: ExprNodeIndex };

    pub const While = struct {
        test_: ExprNodeIndex,
        body: StmtNodeIndex,
    };

    pub const With = struct {
        value: ExprNodeIndex,
        body: StmtNodeIndex,
        body_loc: logger.Loc,
    };

    pub const Try = struct {
        body_loc: logger.Loc,
        body: StmtNodeList,

        catch_: ?Catch = null,
        finally: ?Finally = null,
    };

    pub const Switch = struct {
        test_: ExprNodeIndex,
        body_loc: logger.Loc,
        cases: []Case,
    };

    // This object represents all of these types of import statements:
    //
    //    import 'path'
    //    import {item1, item2} from 'path'
    //    import * as ns from 'path'
    //    import defaultItem, {item1, item2} from 'path'
    //    import defaultItem, * as ns from 'path'
    //
    // Many parts are optional and can be combined in different ways. The only
    // restriction is that you cannot have both a clause and a star namespace.
    pub const Import = struct {
        // If this is a star import: This is a Ref for the namespace symbol. The Loc
        // for the symbol is StarLoc.
        //
        // Otherwise: This is an auto-generated Ref for the namespace representing
        // the imported file. In this case StarLoc is nil. The NamespaceRef is used
        // when converting this module to a CommonJS module.
        namespace_ref: Ref,
        default_name: ?LocRef = null,
        items: []ClauseItem = &([_]ClauseItem{}),
        star_name_loc: ?logger.Loc = null,
        import_record_index: u32,
        is_single_line: bool = false,
    };

    pub const Return = struct { value: ?ExprNodeIndex = null };
    pub const Throw = struct { value: ExprNodeIndex };

    pub const Local = struct {
        kind: Kind = Kind.k_var,
        decls: []G.Decl,
        is_export: bool = false,
        // The TypeScript compiler doesn't generate code for "import foo = bar"
        // statements where the import is never used.
        was_ts_import_equals: bool = false,

        pub const Kind = enum(u2) {
            k_var,
            k_let,
            k_const,
        };
    };

    pub const Break = struct {
        label: ?LocRef = null,
    };

    pub const Continue = struct {
        label: ?LocRef = null,
    };
};

pub const Catch = struct {
    loc: logger.Loc,
    binding: ?BindingNodeIndex = null,
    body: StmtNodeList,
};

pub const Finally = struct {
    loc: logger.Loc,
    stmts: StmtNodeList,
};

pub const Case = struct { loc: logger.Loc, value: ?ExprNodeIndex, body: StmtNodeList };

pub const Op = struct {
    // If you add a new token, remember to add it to "Table" too
    pub const Code = enum {
        // Prefix
        un_pos,
        un_neg,
        un_cpl,
        un_not,
        un_void,
        un_typeof,
        un_delete,

        // Prefix update
        un_pre_dec,
        un_pre_inc,

        // Postfix update
        un_post_dec,
        un_post_inc,

        // Left-associative
        bin_add,
        bin_sub,
        bin_mul,
        bin_div,
        bin_rem,
        bin_pow,
        bin_lt,
        bin_le,
        bin_gt,
        bin_ge,
        bin_in,
        bin_instanceof,
        bin_shl,
        bin_shr,
        bin_u_shr,
        bin_loose_eq,
        bin_loose_ne,
        bin_strict_eq,
        bin_strict_ne,
        bin_nullish_coalescing,
        bin_logical_or,
        bin_logical_and,
        bin_bitwise_or,
        bin_bitwise_and,
        bin_bitwise_xor,

        // Non-associative
        bin_comma,

        // Right-associative
        bin_assign,
        bin_add_assign,
        bin_sub_assign,
        bin_mul_assign,
        bin_div_assign,
        bin_rem_assign,
        bin_pow_assign,
        bin_shl_assign,
        bin_shr_assign,
        bin_u_shr_assign,
        bin_bitwise_or_assign,
        bin_bitwise_and_assign,
        bin_bitwise_xor_assign,
        bin_nullish_coalescing_assign,
        bin_logical_or_assign,
        bin_logical_and_assign,

        pub fn unaryAssignTarget(code: Op.Code) AssignTarget {
            if (@enumToInt(code) >= @enumToInt(Op.Code.un_pre_dec) and @enumToInt(code) <= @enumToInt(Op.Code.un_post_inc)) {
                return AssignTarget.update;
            } else {
                return AssignTarget.none;
            }
        }
        pub fn isLeftAssociative(code: Op.Code) bool {
            return @enumToInt(code) >= @enumToInt(Op.Code.bin_add) and @enumToInt(code) < @enumToInt(Op.Code.bin_comma) and code != .bin_pow;
        }
        pub fn isRightAssociative(code: Op.Code) bool {
            return @enumToInt(code) >= @enumToInt(Op.Code.bin_assign) or code == .bin_pow;
        }
        pub fn binaryAssignTarget(code: Op.Code) AssignTarget {
            if (code == .bin_assign) {
                return AssignTarget.replace;
            } else if (@enumToInt(code) > @enumToInt(Op.Code.bin_assign)) {
                return .update;
            } else {
                return .none;
            }
        }

        pub fn isPrefix(code: Op.Code) bool {
            return @enumToInt(code) < @enumToInt(Op.Code.un_post_dec);
        }
    };

    pub const Level = packed enum(u6) {
        lowest,
        comma,
        spread,
        yield,
        assign,
        conditional,
        nullish_coalescing,
        logical_or,
        logical_and,
        bitwise_or,
        bitwise_xor,
        bitwise_and,
        equals,
        compare,
        shift,
        add,
        multiply,
        exponentiation,
        prefix,
        postfix,
        new,
        call,
        member,
        pub fn lt(self: Level, b: Level) bool {
            return @enumToInt(self) < @enumToInt(b);
        }
        pub fn gt(self: Level, b: Level) bool {
            return @enumToInt(self) > @enumToInt(b);
        }
        pub fn gte(self: Level, b: Level) bool {
            return @enumToInt(self) >= @enumToInt(b);
        }
        pub fn lte(self: Level, b: Level) bool {
            return @enumToInt(self) <= @enumToInt(b);
        }
        pub fn eql(self: Level, b: Level) bool {
            return @enumToInt(self) == @enumToInt(b);
        }

        pub fn sub(self: Level, i: anytype) Level {
            return @intToEnum(Level, @enumToInt(self) - i);
        }

        pub fn add(self: Level, i: anytype) Level {
            return @intToEnum(Level, @enumToInt(self) + i);
        }
    };

    text: string,
    level: Level,
    is_keyword: bool = false,

    pub fn init(triple: anytype) Op {
        return Op{
            .text = triple.@"0",
            .level = triple.@"1",
            .is_keyword = triple.@"2",
        };
    }

    pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(self.text, opts, o);
    }

    pub const TableType: std.EnumArray(Op.Code, Op) = undefined;
    pub const Table = {
        var table = std.EnumArray(Op.Code, Op).initUndefined();

        // Prefix
        table.set(Op.Code.un_pos, Op.init(.{ "+", Level.prefix, false }));
        table.set(Op.Code.un_neg, Op.init(.{ "-", Level.prefix, false }));
        table.set(Op.Code.un_cpl, Op.init(.{ "~", Level.prefix, false }));
        table.set(Op.Code.un_not, Op.init(.{ "!", Level.prefix, false }));
        table.set(Op.Code.un_void, Op.init(.{ "void", Level.prefix, true }));
        table.set(Op.Code.un_typeof, Op.init(.{ "typeof", Level.prefix, true }));
        table.set(Op.Code.un_delete, Op.init(.{ "delete", Level.prefix, true }));

        // Prefix update
        table.set(Op.Code.un_pre_dec, Op.init(.{ "--", Level.prefix, false }));
        table.set(Op.Code.un_pre_inc, Op.init(.{ "++", Level.prefix, false }));

        // Postfix update
        table.set(Op.Code.un_post_dec, Op.init(.{ "--", Level.postfix, false }));
        table.set(Op.Code.un_post_inc, Op.init(.{ "++", Level.postfix, false }));

        // Left-associative
        table.set(Op.Code.bin_add, Op.init(.{ "+", Level.add, false }));
        table.set(Op.Code.bin_sub, Op.init(.{ "-", Level.add, false }));
        table.set(Op.Code.bin_mul, Op.init(.{ "*", Level.multiply, false }));
        table.set(Op.Code.bin_div, Op.init(.{ "/", Level.multiply, false }));
        table.set(Op.Code.bin_rem, Op.init(.{ "%", Level.multiply, false }));
        table.set(Op.Code.bin_pow, Op.init(.{ "**", Level.exponentiation, false }));
        table.set(Op.Code.bin_lt, Op.init(.{ "<", Level.compare, false }));
        table.set(Op.Code.bin_le, Op.init(.{ "<=", Level.compare, false }));
        table.set(Op.Code.bin_gt, Op.init(.{ ">", Level.compare, false }));
        table.set(Op.Code.bin_ge, Op.init(.{ ">=", Level.compare, false }));
        table.set(Op.Code.bin_in, Op.init(.{ "in", Level.compare, true }));
        table.set(Op.Code.bin_instanceof, Op.init(.{ "instanceof", Level.compare, true }));
        table.set(Op.Code.bin_shl, Op.init(.{ "<<", Level.shift, false }));
        table.set(Op.Code.bin_shr, Op.init(.{ ">>", Level.shift, false }));
        table.set(Op.Code.bin_u_shr, Op.init(.{ ">>>", Level.shift, false }));
        table.set(Op.Code.bin_loose_eq, Op.init(.{ "==", Level.equals, false }));
        table.set(Op.Code.bin_loose_ne, Op.init(.{ "!=", Level.equals, false }));
        table.set(Op.Code.bin_strict_eq, Op.init(.{ "===", Level.equals, false }));
        table.set(Op.Code.bin_strict_ne, Op.init(.{ "!==", Level.equals, false }));
        table.set(Op.Code.bin_nullish_coalescing, Op.init(.{ "??", Level.nullish_coalescing, false }));
        table.set(Op.Code.bin_logical_or, Op.init(.{ "||", Level.logical_or, false }));
        table.set(Op.Code.bin_logical_and, Op.init(.{ "&&", Level.logical_and, false }));
        table.set(Op.Code.bin_bitwise_or, Op.init(.{ "|", Level.bitwise_or, false }));
        table.set(Op.Code.bin_bitwise_and, Op.init(.{ "&", Level.bitwise_and, false }));
        table.set(Op.Code.bin_bitwise_xor, Op.init(.{ "^", Level.bitwise_xor, false }));

        // Non-associative
        table.set(Op.Code.bin_comma, Op.init(.{ ",", Level.comma, false }));

        // Right-associative
        table.set(Op.Code.bin_assign, Op.init(.{ "=", Level.assign, false }));
        table.set(Op.Code.bin_add_assign, Op.init(.{ "+=", Level.assign, false }));
        table.set(Op.Code.bin_sub_assign, Op.init(.{ "-=", Level.assign, false }));
        table.set(Op.Code.bin_mul_assign, Op.init(.{ "*=", Level.assign, false }));
        table.set(Op.Code.bin_div_assign, Op.init(.{ "/=", Level.assign, false }));
        table.set(Op.Code.bin_rem_assign, Op.init(.{ "%=", Level.assign, false }));
        table.set(Op.Code.bin_pow_assign, Op.init(.{ "**=", Level.assign, false }));
        table.set(Op.Code.bin_shl_assign, Op.init(.{ "<<=", Level.assign, false }));
        table.set(Op.Code.bin_shr_assign, Op.init(.{ ">>=", Level.assign, false }));
        table.set(Op.Code.bin_u_shr_assign, Op.init(.{ ">>>=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_or_assign, Op.init(.{ "|=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_and_assign, Op.init(.{ "&=", Level.assign, false }));
        table.set(Op.Code.bin_bitwise_xor_assign, Op.init(.{ "^=", Level.assign, false }));
        table.set(Op.Code.bin_nullish_coalescing_assign, Op.init(.{ "??=", Level.assign, false }));
        table.set(Op.Code.bin_logical_or_assign, Op.init(.{ "||=", Level.assign, false }));
        table.set(Op.Code.bin_logical_and_assign, Op.init(.{ "&&=", Level.assign, false }));

        return table;
    };
};

pub const ArrayBinding = struct {
    binding: BindingNodeIndex,
    default_value: ?ExprNodeIndex = null,
};

pub const Ast = struct {
    approximate_line_count: i32 = 0,
    has_lazy_export: bool = false,

    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    has_top_level_return: bool = false,
    uses_exports_ref: bool = false,
    uses_module_ref: bool = false,
    exports_kind: ExportsKind = ExportsKind.none,

    // This is a list of ES6 features. They are ranges instead of booleans so
    // that they can be used in log messages. Check to see if "Len > 0".
    import_keyword: ?logger.Range = null, // Does not include TypeScript-specific syntax or "import()"
    export_keyword: ?logger.Range = null, // Does not include TypeScript-specific syntax
    top_level_await_keyword: ?logger.Range = null,

    // These are stored at the AST level instead of on individual AST nodes so
    // they can be manipulated efficiently without a full AST traversal
    import_records: []ImportRecord = &([_]ImportRecord{}),

    hashbang: ?string = null,
    directive: ?string = null,
    url_for_css: ?string = null,
    parts: []Part,
    symbols: []Symbol = &([_]Symbol{}),
    module_scope: ?Scope = null,
    // char_freq:    *CharFreq,
    exports_ref: ?Ref = null,
    module_ref: ?Ref = null,
    wrapper_ref: ?Ref = null,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    named_imports: AutoHashMap(Ref, NamedImport) = undefined,
    named_exports: StringHashMap(NamedExport) = undefined,
    top_level_symbol_to_parts: AutoHashMap(Ref, std.ArrayList(u32)) = undefined,
    export_star_import_records: []u32 = &([_]u32{}),

    pub fn initTest(parts: []Part) Ast {
        return Ast{
            .parts = parts,
        };
    }

    pub fn toJSON(self: *const Ast, allocator: *std.mem.Allocator, stream: anytype) !void {
        const opts = std.json.StringifyOptions{ .whitespace = std.json.StringifyOptions.Whitespace{
            .separator = true,
        } };
        try std.json.stringify(self.parts, opts, stream);
    }
};

pub const Span = struct {
    text: string,
    range: logger.Range,
};

pub const ExportsKind = enum {
// This file doesn't have any kind of export, so it's impossible to say what
// kind of file this is. An empty file is in this category, for example.
none,

// The exports are stored on "module" and/or "exports". Calling "require()"
// on this module returns "module.exports". All imports to this module are
// allowed but may return undefined.
cjs,

// All export names are known explicitly. Calling "require()" on this module
// generates an exports object (stored in "exports") with getters for the
// export names. Named imports to this module are only allowed if they are
// in the set of export names.
esm,

// Some export names are known explicitly, but others fall back to a dynamic
// run-time object. This is necessary when using the "export * from" syntax
// with either a CommonJS module or an external module (i.e. a module whose
// export names are not known at compile-time).
//
// Calling "require()" on this module generates an exports object (stored in
// "exports") with getters for the export names. All named imports to this
// module are allowed. Direct named imports reference the corresponding export
// directly. Other imports go through property accesses on "exports".
esm_with_dyn };

pub fn isDynamicExport(exp: ExportsKind) bool {
    return kind == .cjs || kind == .esm_with_dyn;
}

pub const DeclaredSymbol = packed struct {
    ref: Ref,
    is_top_level: bool = false,
};

pub const Dependency = packed struct {
    source_index: u32 = 0,
    part_index: u32 = 0,
};

pub const ExprList = std.ArrayList(Expr);
pub const StmtList = std.ArrayList(Stmt);
pub const BindingList = std.ArrayList(Binding);
pub const AstData = struct {
    expr_list: ExprList,
    stmt_list: StmtList,
    binding_list: BindingList,

    pub fn init(allocator: *std.mem.Allocator) AstData {
        return AstData{
            .expr_list = ExprList.init(allocator),
            .stmt_list = StmtList.init(allocator),
            .binding_list = BindingList.init(allocator),
        };
    }

    pub fn deinit(self: *AstData) void {
        self.expr_list.deinit();
        self.stmt_list.deinit();
        self.binding_list.deinit();
    }

    pub fn expr(self: *AstData, index: ExprNodeIndex) Expr {
        return self.expr_list.items[index];
    }

    pub fn stmt(self: *AstData, index: StmtNodeIndex) Stmt {
        return self.stmt_list.items[index];
    }

    pub fn binding(self: *AstData, index: BindingNodeIndex) Binding {
        return self.binding_list.items[index];
    }

    pub fn add_(self: *AstData, t: anytype) !void {
        return switch (@TypeOf(t)) {
            Stmt => {
                try self.stmt_list.append(t);
            },
            Expr => {
                try self.expr_list.append(t);
            },
            Binding => {
                try self.binding_list.append(t);
            },
            else => {
                @compileError("Invalid type passed to AstData.add. Expected Stmt, Expr, or Binding.");
            },
        };
    }

    pub fn add(self: *AstData, t: anytype) !NodeIndex {
        return &t;
        // return switch (@TypeOf(t)) {
        //     Stmt => {
        //         var len = self.stmt_list.items.len;
        //         try self.stmt_list.append(t);
        //         return @intCast(StmtNodeIndex, len);
        //     },
        //     Expr => {
        //         var len = self.expr_list.items.len;
        //         try self.expr_list.append(t);
        //         return @intCast(ExprNodeIndex, len);
        //     },
        //     Binding => {
        //         var len = self.binding_list.items.len;
        //         try self.binding_list.append(t);
        //         return @intCast(BindingNodeIndex, len);
        //     },
        //     else => {
        //         @compileError("Invalid type passed to AstData.add. Expected Stmt, Expr, or Binding.");
        //     },
        // };
    }
};

// Each file is made up of multiple parts, and each part consists of one or
// more top-level statements. Parts are used for tree shaking and code
// splitting analysis. Individual parts of a file can be discarded by tree
// shaking and can be assigned to separate chunks (i.e. output files) by code
// splitting.
pub const Part = struct {
    stmts: []Stmt,
    scopes: []*Scope = &([_]*Scope{}),

    // Each is an index into the file-level import record list
    import_record_indices: []u32 = &([_]u32{}),

    // All symbols that are declared in this part. Note that a given symbol may
    // have multiple declarations, and so may end up being declared in multiple
    // parts (e.g. multiple "var" declarations with the same name). Also note
    // that this list isn't deduplicated and may contain duplicates.
    declared_symbols: []DeclaredSymbol = &([_]DeclaredSymbol{}),

    // An estimate of the number of uses of all symbols used within this part.
    symbol_uses: SymbolUseMap = undefined,

    // The indices of the other parts in this file that are needed if this part
    // is needed.
    dependencies: []Dependency = &([_]Dependency{}),

    // If true, this part can be removed if none of the declared symbols are
    // used. If the file containing this part is imported, then all parts that
    // don't have this flag enabled must be included.
    can_be_removed_if_unused: bool = false,

    // This is used for generated parts that we don't want to be present if they
    // aren't needed. This enables tree shaking for these parts even if global
    // tree shaking isn't enabled.
    force_tree_shaking: bool = false,

    // This is true if this file has been marked as live by the tree shaking
    // algorithm.
    is_live: bool = false,
    pub const SymbolUseMap = AutoHashMap(Ref, Symbol.Use);
    pub fn jsonStringify(self: *const Part, options: std.json.StringifyOptions, writer: anytype) !void {
        return std.json.stringify(self.stmts, options, writer);
    }
};

pub const Result = struct {
    ast: Ast,
    ok: bool = false,
};

pub const StmtOrExpr = union(enum) {
    stmt: StmtNodeIndex,
    expr: ExprNodeIndex,
};

pub const NamedImport = struct {
    // Parts within this file that use this import
    local_parts_with_uses: []u32 = &([_]u32{}),

    alias: ?string,
    alias_loc: ?logger.Loc,
    namespace_ref: ?Ref,
    import_record_index: u32,

    // If true, the alias refers to the entire export namespace object of a
    // module. This is no longer represented as an alias called "*" because of
    // the upcoming "Arbitrary module namespace identifier names" feature:
    // https://github.com/tc39/ecma262/pull/2154
    alias_is_star: bool = false,

    // It's useful to flag exported imports because if they are in a TypeScript
    // file, we can't tell if they are a type or a value.
    is_exported: bool = false,
};

pub const NamedExport = struct {
    ref: Ref,
    alias_loc: logger.Loc,
};

pub const StrictModeKind = packed enum(u7) {
    sloppy_mode,
    explicit_strict_mode,
    implicit_strict_mode_import,
    implicit_strict_mode_export,
    implicit_strict_mode_top_level_await,
    implicit_strict_mode_class,
};

pub const Scope = struct {
    id: usize = 0,
    kind: Kind = Kind.block,
    parent: ?*Scope,
    children: std.ArrayList(*Scope),
    members: StringHashMap(Member),
    generated: std.ArrayList(Ref),

    // This is used to store the ref of the label symbol for ScopeLabel scopes.
    label_ref: ?Ref = null,
    label_stmt_is_loop: bool = false,

    // If a scope contains a direct eval() expression, then none of the symbols
    // inside that scope can be renamed. We conservatively assume that the
    // evaluated code might reference anything that it has access to.
    contains_direct_eval: bool = false,

    // This is to help forbid "arguments" inside class body scopes
    forbid_arguments: bool = false,

    strict_mode: StrictModeKind = StrictModeKind.sloppy_mode,

    // Do not make this a packed struct
    // Two hours of debugging time lost to that.
    // It causes a crash due to undefined memory
    pub const Member = struct {
        ref: Ref,
        loc: logger.Loc,

        pub fn eql(a: Member, b: Member) bool {
            return @call(.{ .modifier = .always_inline }, Ref.eql, .{ a.ref, b.ref }) and a.loc.start == b.loc.start;
        }
    };

    pub const Kind = enum(u8) {
        block,
        with,
        label,
        class_name,
        class_body,

        // The scopes below stop hoisted variables from extending into parent scopes
        entry, // This is a module, TypeScript enum, or TypeScript namespace
        function_args,
        function_body,
    };

    pub fn recursiveSetStrictMode(s: *Scope, kind: StrictModeKind) void {
        if (s.strict_mode == .sloppy_mode) {
            s.strict_mode = kind;
            for (s.children.items) |child| {
                child.recursiveSetStrictMode(kind);
            }
        }
    }

    pub fn kindStopsHoisting(s: *Scope) bool {
        return @enumToInt(s.kind) >= @enumToInt(Kind.entry);
    }

    pub fn initPtr(allocator: *std.mem.Allocator) !*Scope {
        var scope = try allocator.create(Scope);
        scope.* = Scope{
            .members = @TypeOf(scope.members).init(allocator),
            .children = @TypeOf(scope.children).init(allocator),
            .generated = @TypeOf(scope.generated).init(allocator),
            .parent = null,
        };
        return scope;
    }
};

pub fn printmem(comptime format: string, args: anytype) void {
    // Output.print(format, args);
}

test "Binding.init" {
    var binding = Binding.alloc(
        std.heap.page_allocator,
        B.Identifier{ .ref = Ref{ .source_index = 0, .inner_index = 10 } },
        logger.Loc{ .start = 1 },
    );
    std.testing.expect(binding.loc.start == 1);
    std.testing.expect(@as(Binding.Tag, binding.data) == Binding.Tag.b_identifier);

    printmem("-------Binding:           {d} bits\n", .{@bitSizeOf(Binding)});
    printmem("B.Identifier:             {d} bits\n", .{@bitSizeOf(B.Identifier)});
    printmem("B.Array:                  {d} bits\n", .{@bitSizeOf(B.Array)});
    printmem("B.Property:               {d} bits\n", .{@bitSizeOf(B.Property)});
    printmem("B.Object:                 {d} bits\n", .{@bitSizeOf(B.Object)});
    printmem("B.Missing:                {d} bits\n", .{@bitSizeOf(B.Missing)});
    printmem("-------Binding:           {d} bits\n", .{@bitSizeOf(Binding)});
}

test "Stmt.init" {
    var stmt = Stmt.alloc(
        std.heap.page_allocator,
        S.Continue{},
        logger.Loc{ .start = 1 },
    );
    std.testing.expect(stmt.loc.start == 1);
    std.testing.expect(@as(Stmt.Tag, stmt.data) == Stmt.Tag.s_continue);

    printmem("-----Stmt       {d} bits\n", .{@bitSizeOf(Stmt)});
    printmem("StmtNodeList:   {d} bits\n", .{@bitSizeOf(StmtNodeList)});
    printmem("StmtOrExpr:     {d} bits\n", .{@bitSizeOf(StmtOrExpr)});
    printmem("S.Block         {d} bits\n", .{@bitSizeOf(S.Block)});
    printmem("S.Comment       {d} bits\n", .{@bitSizeOf(S.Comment)});
    printmem("S.Directive     {d} bits\n", .{@bitSizeOf(S.Directive)});
    printmem("S.ExportClause  {d} bits\n", .{@bitSizeOf(S.ExportClause)});
    printmem("S.Empty         {d} bits\n", .{@bitSizeOf(S.Empty)});
    printmem("S.TypeScript    {d} bits\n", .{@bitSizeOf(S.TypeScript)});
    printmem("S.Debugger      {d} bits\n", .{@bitSizeOf(S.Debugger)});
    printmem("S.ExportFrom    {d} bits\n", .{@bitSizeOf(S.ExportFrom)});
    printmem("S.ExportDefault {d} bits\n", .{@bitSizeOf(S.ExportDefault)});
    printmem("S.Enum          {d} bits\n", .{@bitSizeOf(S.Enum)});
    printmem("S.Namespace     {d} bits\n", .{@bitSizeOf(S.Namespace)});
    printmem("S.Function      {d} bits\n", .{@bitSizeOf(S.Function)});
    printmem("S.Class         {d} bits\n", .{@bitSizeOf(S.Class)});
    printmem("S.If            {d} bits\n", .{@bitSizeOf(S.If)});
    printmem("S.For           {d} bits\n", .{@bitSizeOf(S.For)});
    printmem("S.ForIn         {d} bits\n", .{@bitSizeOf(S.ForIn)});
    printmem("S.ForOf         {d} bits\n", .{@bitSizeOf(S.ForOf)});
    printmem("S.DoWhile       {d} bits\n", .{@bitSizeOf(S.DoWhile)});
    printmem("S.While         {d} bits\n", .{@bitSizeOf(S.While)});
    printmem("S.With          {d} bits\n", .{@bitSizeOf(S.With)});
    printmem("S.Try           {d} bits\n", .{@bitSizeOf(S.Try)});
    printmem("S.Switch        {d} bits\n", .{@bitSizeOf(S.Switch)});
    printmem("S.Import        {d} bits\n", .{@bitSizeOf(S.Import)});
    printmem("S.Return        {d} bits\n", .{@bitSizeOf(S.Return)});
    printmem("S.Throw         {d} bits\n", .{@bitSizeOf(S.Throw)});
    printmem("S.Local         {d} bits\n", .{@bitSizeOf(S.Local)});
    printmem("S.Break         {d} bits\n", .{@bitSizeOf(S.Break)});
    printmem("S.Continue      {d} bits\n", .{@bitSizeOf(S.Continue)});
    printmem("-----Stmt       {d} bits\n", .{@bitSizeOf(Stmt)});
}

test "Expr.init" {
    var allocator = std.heap.page_allocator;
    const ident = Expr.alloc(allocator, E.Identifier{}, logger.Loc{ .start = 100 });
    var list = [_]Expr{ident};
    var expr = Expr.alloc(
        allocator,
        E.Array{ .items = list[0..] },
        logger.Loc{ .start = 1 },
    );
    std.testing.expect(expr.loc.start == 1);
    std.testing.expect(@as(Expr.Tag, expr.data) == Expr.Tag.e_array);
    std.testing.expect(expr.data.e_array.items[0].loc.start == 100);

    printmem("--Ref                      {d} bits\n", .{@bitSizeOf(Ref)});
    printmem("--LocRef                   {d} bits\n", .{@bitSizeOf(LocRef)});
    printmem("--logger.Loc               {d} bits\n", .{@bitSizeOf(logger.Loc)});
    printmem("--logger.Range             {d} bits\n", .{@bitSizeOf(logger.Range)});
    printmem("----------Expr:            {d} bits\n", .{@bitSizeOf(Expr)});
    printmem("ExprNodeList:              {d} bits\n", .{@bitSizeOf(ExprNodeList)});
    printmem("E.Array:                   {d} bits\n", .{@bitSizeOf(E.Array)});

    printmem("E.Unary:                   {d} bits\n", .{@bitSizeOf(E.Unary)});
    printmem("E.Binary:                  {d} bits\n", .{@bitSizeOf(E.Binary)});
    printmem("E.Boolean:                 {d} bits\n", .{@bitSizeOf(E.Boolean)});
    printmem("E.Super:                   {d} bits\n", .{@bitSizeOf(E.Super)});
    printmem("E.Null:                    {d} bits\n", .{@bitSizeOf(E.Null)});
    printmem("E.Undefined:               {d} bits\n", .{@bitSizeOf(E.Undefined)});
    printmem("E.New:                     {d} bits\n", .{@bitSizeOf(E.New)});
    printmem("E.NewTarget:               {d} bits\n", .{@bitSizeOf(E.NewTarget)});
    printmem("E.Function:                {d} bits\n", .{@bitSizeOf(E.Function)});
    printmem("E.ImportMeta:              {d} bits\n", .{@bitSizeOf(E.ImportMeta)});
    printmem("E.Call:                    {d} bits\n", .{@bitSizeOf(E.Call)});
    printmem("E.Dot:                     {d} bits\n", .{@bitSizeOf(E.Dot)});
    printmem("E.Index:                   {d} bits\n", .{@bitSizeOf(E.Index)});
    printmem("E.Arrow:                   {d} bits\n", .{@bitSizeOf(E.Arrow)});
    printmem("E.Identifier:              {d} bits\n", .{@bitSizeOf(E.Identifier)});
    printmem("E.ImportIdentifier:        {d} bits\n", .{@bitSizeOf(E.ImportIdentifier)});
    printmem("E.PrivateIdentifier:       {d} bits\n", .{@bitSizeOf(E.PrivateIdentifier)});
    printmem("E.JSXElement:              {d} bits\n", .{@bitSizeOf(E.JSXElement)});
    printmem("E.Missing:                 {d} bits\n", .{@bitSizeOf(E.Missing)});
    printmem("E.Number:                  {d} bits\n", .{@bitSizeOf(E.Number)});
    printmem("E.BigInt:                  {d} bits\n", .{@bitSizeOf(E.BigInt)});
    printmem("E.Object:                  {d} bits\n", .{@bitSizeOf(E.Object)});
    printmem("E.Spread:                  {d} bits\n", .{@bitSizeOf(E.Spread)});
    printmem("E.String:                  {d} bits\n", .{@bitSizeOf(E.String)});
    printmem("E.TemplatePart:            {d} bits\n", .{@bitSizeOf(E.TemplatePart)});
    printmem("E.Template:                {d} bits\n", .{@bitSizeOf(E.Template)});
    printmem("E.RegExp:                  {d} bits\n", .{@bitSizeOf(E.RegExp)});
    printmem("E.Await:                   {d} bits\n", .{@bitSizeOf(E.Await)});
    printmem("E.Yield:                   {d} bits\n", .{@bitSizeOf(E.Yield)});
    printmem("E.If:                      {d} bits\n", .{@bitSizeOf(E.If)});
    printmem("E.RequireOrRequireResolve: {d} bits\n", .{@bitSizeOf(E.RequireOrRequireResolve)});
    printmem("E.Import:                  {d} bits\n", .{@bitSizeOf(E.Import)});
    printmem("----------Expr:            {d} bits\n", .{@bitSizeOf(Expr)});
}

// -- ESBuild bit sizes
// EArray             | 256
// EArrow             | 512
// EAwait             | 192
// EBinary            | 448
// ECall              | 448
// EDot               | 384
// EIdentifier        | 96
// EIf                | 576
// EImport            | 448
// EImportIdentifier  | 96
// EIndex             | 448
// EJSXElement        | 448
// ENew               | 448
// EnumValue          | 384
// EObject            | 256
// EPrivateIdentifier | 64
// ERequire           | 32
// ERequireResolve    | 32
// EString            | 256
// ETemplate          | 640
// EUnary             | 256
// Expr               | 192
// ExprOrStmt         | 128
// EYield             | 128
// Finally            | 256
// Fn                 | 704
// FnBody             | 256
// LocRef             | 96
// NamedExport        | 96
// NamedImport        | 512
// NameMinifier       | 256
// NamespaceAlias     | 192
// opTableEntry       | 256
// Part               | 1088
// Property           | 640
// PropertyBinding    | 512
// Ref                | 64
// SBlock             | 192
// SBreak             | 64
// SClass             | 704
// SComment           | 128
// SContinue          | 64
// Scope              | 704
// ScopeMember        | 96
// SDirective         | 256
// SDoWhile           | 384
// SEnum              | 448
// SExportClause      | 256
// SExportDefault     | 256
// SExportEquals      | 192
// SExportFrom        | 320
// SExportStar        | 192
// SExpr              | 256
// SFor               | 384
// SForIn             | 576
// SForOf             | 640
// SFunction          | 768
// SIf                | 448
// SImport            | 320
// SLabel             | 320
// SLazyExport        | 192
// SLocal             | 256
// SNamespace         | 448
// Span               | 192
// SReturn            | 64
// SSwitch            | 448
// SThrow             | 192
// Stmt               | 192
// STry               | 384
// -- ESBuild bit sizes

