const std = @import("std");
const logger = @import("logger.zig");
const JSXRuntime = @import("options.zig").JSX.Runtime;
const Runtime = @import("runtime.zig").Runtime;
usingnamespace @import("global.zig");
usingnamespace @import("ast/base.zig");

const ImportRecord = @import("import_record.zig").ImportRecord;
const allocators = @import("allocators.zig");

const _hash_map = @import("hash_map.zig");
const StringHashMap = _hash_map.StringHashMap;
const AutoHashMap = _hash_map.AutoHashMap;
pub fn NewBaseStore(comptime Union: anytype, comptime count: usize) type {
    var max_size = 0;
    var max_align = 1;
    for (Union) |kind| {
        max_size = std.math.max(@sizeOf(kind), max_size);
        max_align = if (@sizeOf(kind) == 0) max_align else std.math.max(@alignOf(kind), max_align);
    }

    const UnionValueType = [max_size]u8;
    const MaxAlign = max_align;
    const total_items_len = max_size * count;
    return struct {
        const Allocator = std.mem.Allocator;
        const Self = @This();

        const Block = struct {
            items: [count]UnionValueType align(MaxAlign) = undefined,
            used: usize = 0,
            allocator: *std.mem.Allocator,

            pub inline fn isFull(block: *const Block) bool {
                return block.used >= block.items.len;
            }

            pub fn append(block: *Block, value: anytype) *UnionValueType {
                std.debug.assert(block.used < count);
                const index = block.used;
                std.mem.copy(u8, &block.items[index], value);

                block.used += 1;
                return &block.items[index];
            }
        };

        block: Block,
        overflow_ptrs: [4096 * 3]*Block = undefined,
        overflow: []*Block = &([_]*Block{}),
        overflow_used: usize = 0,
        allocator: *Allocator,

        pub threadlocal var instance: Self = undefined;
        pub threadlocal var _self: *Self = undefined;

        pub fn reset() void {
            _self.block.used = 0;
            for (_self.overflow[0.._self.overflow_used]) |b| {
                b.used = 0;
            }
            _self.overflow_used = 0;
        }

        pub fn init(allocator: *std.mem.Allocator) *Self {
            instance = Self{
                .allocator = allocator,
                .block = Block{ .allocator = allocator },
            };

            _self = &instance;
            return _self;
        }

        pub fn append(comptime ValueType: type, value: ValueType) *ValueType {
            return _self._append(ValueType, value);
        }

        fn _append(self: *Self, comptime ValueType: type, value: ValueType) *ValueType {
            if (!self.block.isFull()) {
                var ptr = self.block.append(std.mem.asBytes(&value));
                var aligned_slice = @alignCast(@alignOf(ValueType), ptr);

                return @ptrCast(
                    *ValueType,
                    aligned_slice,
                );
            }

            if (self.overflow_used >= self.overflow.len or self.overflow[self.overflow_used].isFull()) {
                var slice = self.allocator.alloc(Block, 2) catch unreachable;
                for (slice) |*block| {
                    block.allocator = self.allocator;
                    block.used = 0;
                    block.items = undefined;
                    self.overflow_ptrs[self.overflow.len] = block;
                    self.overflow = self.overflow_ptrs[0 .. self.overflow.len + 1];
                }
            }

            var block = self.overflow[self.overflow_used];
            var ptr = block.append(std.mem.asBytes(&value));
            if (block.isFull()) {
                self.overflow_used += 1;
            }

            var aligned_slice = @alignCast(@alignOf(ValueType), ptr);

            return @ptrCast(
                *ValueType,
                aligned_slice,
            );
        }
    };
}

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
    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
};

pub const AssignTarget = enum(u2) {
    none,
    replace, // "a = b"
    update, // "a += b"
    pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
};

pub const LocRef = struct { loc: logger.Loc, ref: ?Ref };

pub const Flags = struct {
    pub const JSXElement = struct {
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

        // Used for Hot Module Reloading's wrapper function
        // "iife" stands for "immediately invoked function expression"
        print_as_iife: bool = false,

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
                return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = loc };
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
                            break :convert Expr.init(E.Spread, E.Spread{ .value = expr }, expr.loc);
                        } else if (item.default_value) |default| {
                            break :convert Expr.assign(expr, default, wrapper.allocator);
                        } else {
                            break :convert expr;
                        }
                    };
                }

                return Expr.init(E.Array, E.Array{ .items = exprs, .is_single_line = b.is_single_line }, loc);
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
                return Expr.init(E.Object, E.Object{ .properties = properties, .is_single_line = b.is_single_line }, loc);
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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub var icount: usize = 0;

    pub fn init(t: anytype, loc: logger.Loc) Binding {
        icount += 1;
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
            B.Missing => {
                return Binding{ .loc = loc, .data = B{ .b_missing = t } };
            },
            else => {
                @compileError("Invalid type passed to Binding.init");
            },
        }
    }

    pub fn alloc(allocator: *std.mem.Allocator, t: anytype, loc: logger.Loc) Binding {
        icount += 1;
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
                return Binding{ .loc = loc, .data = B{ .b_missing = .{} } };
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
    b_missing: B.Missing,

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
        import_record_index: u32 = std.math.maxInt(u32),
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
            pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
                return try std.json.stringify(@tagName(self), opts, o);
            }
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

    // Used by the parser for single pass parsing.
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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
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

        pub fn get(self: *Map, ref: Ref) ?*Symbol {
            if (Ref.isSourceIndexNull(ref.source_index)) {
                return null;
            }

            return &self.symbols_for_source[ref.source_index][ref.inner_index];
        }

        pub fn init(sourceCount: usize, allocator: *std.mem.Allocator) !Map {
            var symbols_for_source: [][]Symbol = try allocator.alloc([]Symbol, sourceCount);
            return Map{ .symbols_for_source = symbols_for_source };
        }

        pub fn initList(list: [][]Symbol) Map {
            return Map{ .symbols_for_source = list };
        }

        pub fn follow(symbols: *Map, ref: Ref) Ref {
            if (symbols.get(ref)) |symbol| {
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

    pub inline fn isKindPrivate(kind: Symbol.Kind) bool {
        return @enumToInt(kind) >= @enumToInt(Symbol.Kind.private_field) and @enumToInt(kind) <= @enumToInt(Symbol.Kind.private_static_get_set_pair);
    }

    pub inline fn isKindHoisted(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted, .hoisted_function => true,
            else => false,
        };
    }

    pub inline fn isHoisted(self: *const Symbol) bool {
        return Symbol.isKindHoisted(self.kind);
    }

    pub inline fn isKindHoistedOrFunction(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted, .hoisted_function, .generator_or_async_function => true,
            else => false,
        };
    }

    pub inline fn isKindFunction(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted_function, .generator_or_async_function => true,
            else => false,
        };
    }

    pub fn isReactComponentishName(symbol: *const Symbol) bool {
        switch (symbol.kind) {
            .hoisted, .hoisted_function, .cconst, .class, .other => {
                return switch (symbol.original_name[0]) {
                    'A'...'Z' => true,
                    else => false,
                };
            },

            else => {
                return false;
            },
        }
    }
};

pub const OptionalChain = enum(u2) {

    // "a?.b"
    start,

    // "a?.b.c" => ".c" is OptionalChainContinue
    // "(a?.b).c" => ".c" is OptionalChain null
    ccontinue,

    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
};

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

    pub const Boolean = struct { value: bool };
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
        args: ExprNodeList = &([_]ExprNodeIndex{}),
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

    pub const Identifier = struct {
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

        pub inline fn init(ref: Ref) Identifier {
            return Identifier{
                .ref = ref,
                .must_keep_due_to_with_stmt = false,
                .can_be_removed_if_unused = false,
                .call_can_be_unwrapped_if_unused = false,
            };
        }
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
    pub const ImportIdentifier = struct {
        ref: Ref = Ref.None,

        // If true, this was originally an identifier expression such as "foo". If
        // false, this could potentially have been a member access expression such
        // as "ns.foo" off of an imported namespace object.
        was_originally_identifier: bool = false,

        was_from_macro: bool = false,
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
    ///     - static the function is React.jsxsDEV, "jsxs" instead of "jsx"
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

        pub var empty = BigInt{ .value = "" };

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(self.value, opts, o);
        }
    };

    pub const Object = struct {
        properties: []G.Property = &[_]G.Property{},
        comma_after_spread: ?logger.Loc = null,
        is_single_line: bool = false,
        is_parenthesized: bool = false,
    };

    pub const Spread = struct { value: ExprNodeIndex };

    /// JavaScript string literal type
    pub const String = struct {
        // A version of this where `utf8` and `value` are stored in a packed union, with len as a single u32 was attempted.
        // It did not improve benchmarks. Neither did converting this from a heap-allocated type to a stack-allocated type.
        value: []const u16 = &.{},
        utf8: string = &([_]u8{}),
        prefer_template: bool = false,

        pub var empty = String{};
        pub var @"true" = String{ .utf8 = "true" };
        pub var @"false" = String{ .utf8 = "false" };
        pub var @"null" = String{ .utf8 = "null" };
        pub var @"undefined" = String{ .utf8 = "undefined" };

        pub fn clone(str: *const String, allocator: *std.mem.Allocator) !String {
            if (str.isUTF8()) {
                return String{
                    .utf8 = try allocator.dupe(u8, str.utf8),
                    .prefer_template = str.prefer_template,
                };
            } else {
                return String{
                    .value = try allocator.dupe(u16, str.value),
                    .prefer_template = str.prefer_template,
                };
            }
        }

        pub inline fn isUTF8(s: *const String) bool {
            return @maximum(s.utf8.len, s.value.len) == s.utf8.len;
        }

        pub inline fn isBlank(s: *const String) bool {
            return @maximum(s.utf8.len, s.value.len) == 0;
        }

        pub inline fn isPresent(s: *const String) bool {
            return @maximum(s.utf8.len, s.value.len) > 0;
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
                    []u16, []const u16 => {
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
                    []u16, []const u16 => {
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

        pub fn hash(s: *const String) u64 {
            if (s.isBlank()) return 0;

            if (s.isUTF8()) {
                // hash utf-8
                return std.hash.Wyhash.hash(0, s.utf8);
            } else {
                // hash utf-16
                return std.hash.Wyhash.hash(0, @ptrCast([*]const u8, s.value.ptr)[0 .. s.value.len * 2]);
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
    };

    pub const RegExp = struct {
        value: string,

        // This exists for JavaScript bindings
        // The RegExp constructor expects flags as a second argument.
        // We want to avoid re-lexing the flags, so we store them here.
        // This is the index of the first character in a flag, not the "/"
        // /foo/gim
        //      ^
        flags_offset: ?u16 = null,

        pub var empty = RegExp{ .value = "" };

        pub fn pattern(this: RegExp) string {

            // rewind until we reach the /foo/gim
            //                               ^
            // should only ever be a single character
            // but we're being cautious
            if (this.flags_offset) |i_| {
                var i = i_;
                while (i > 0 and this.value[i] != '/') {
                    i -= 1;
                }

                return std.mem.trim(u8, this.value[0..i], "/");
            }

            return std.mem.trim(u8, this.value, "/");
        }

        pub fn flags(this: RegExp) string {
            // rewind until we reach the /foo/gim
            //                               ^
            // should only ever be a single character
            // but we're being cautious
            if (this.flags_offset) |i| {
                return this.value[i..];
            }

            return "";
        }

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

    pub const Require = struct {
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
        return Stmt{ .data = .{ .s_empty = None }, .loc = logger.Loc{} };
    }

    const None = S.Empty{};

    pub inline fn getBlock(self: *const @This()) *S.Block {
        return self.data.s_block;
    }
    pub inline fn getBreak(self: *const @This()) *S.Break {
        return self.data.s_break;
    }
    pub inline fn getClass(self: *const @This()) *S.Class {
        return self.data.s_class;
    }
    pub inline fn getComment(self: *const @This()) *S.Comment {
        return self.data.s_comment;
    }
    pub inline fn getContinue(self: *const @This()) *S.Continue {
        return self.data.s_continue;
    }
    pub inline fn getDebugger(self: *const @This()) S.Debugger {
        return S.Debugger{};
    }
    pub inline fn getDirective(self: *const @This()) *S.Directive {
        return self.data.s_directive;
    }
    pub inline fn getDoWhile(self: *const @This()) *S.DoWhile {
        return self.data.s_do_while;
    }
    pub inline fn getEmpty(self: *const @This()) S.Empty {
        return S.Empty{};
    }
    pub inline fn getEnum(self: *const @This()) *S.Enum {
        return self.data.s_enum;
    }
    pub inline fn getExportClause(self: *const @This()) *S.ExportClause {
        return self.data.s_export_clause;
    }
    pub inline fn getExportDefault(self: *const @This()) *S.ExportDefault {
        return self.data.s_export_default;
    }
    pub inline fn getExportEquals(self: *const @This()) *S.ExportEquals {
        return self.data.s_export_equals;
    }
    pub inline fn getExportFrom(self: *const @This()) *S.ExportFrom {
        return self.data.s_export_from;
    }
    pub inline fn getExportStar(self: *const @This()) *S.ExportStar {
        return self.data.s_export_star;
    }
    pub inline fn getExpr(self: *const @This()) *S.SExpr {
        return self.data.s_expr;
    }
    pub inline fn getForIn(self: *const @This()) *S.ForIn {
        return self.data.s_for_in;
    }
    pub inline fn getForOf(self: *const @This()) *S.ForOf {
        return self.data.s_for_of;
    }
    pub inline fn getFor(self: *const @This()) *S.For {
        return self.data.s_for;
    }
    pub inline fn getFunction(self: *const @This()) *S.Function {
        return self.data.s_function;
    }
    pub inline fn getIf(self: *const @This()) *S.If {
        return self.data.s_if;
    }
    pub inline fn getImport(self: *const @This()) *S.Import {
        return self.data.s_import;
    }
    pub inline fn getLabel(self: *const @This()) *S.Label {
        return self.data.s_label;
    }
    pub inline fn getLazyExport(self: *const @This()) *S.LazyExport {
        return self.data.s_lazy_export;
    }
    pub inline fn getLocal(self: *const @This()) *S.Local {
        return self.data.s_local;
    }
    pub inline fn getNamespace(self: *const @This()) *S.Namespace {
        return self.data.s_namespace;
    }
    pub inline fn getReturn(self: *const @This()) *S.Return {
        return self.data.s_return;
    }
    pub inline fn getSwitch(self: *const @This()) *S.Switch {
        return self.data.s_switch;
    }
    pub inline fn getThrow(self: *const @This()) *S.Throw {
        return self.data.s_throw;
    }
    pub inline fn getTry(self: *const @This()) *S.Try {
        return self.data.s_try;
    }
    pub inline fn getTypeScript(self: *const @This()) S.TypeScript {
        return S.TypeScript{};
    }
    pub inline fn getWhile(self: *const @This()) *S.While {
        return self.data.s_while;
    }
    pub inline fn getWith(self: *const @This()) *S.With {
        return self.data.s_with;
    }
    pub var icount: usize = 0;
    pub fn init(comptime StatementType: type, origData: *StatementType, loc: logger.Loc) Stmt {
        icount += 1;

        if (StatementType == S.Empty) {
            return Stmt{ .loc = loc, .data = Data{ .s_empty = S.Empty{} } };
        }

        switch (StatementType) {
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

    inline fn comptime_init(comptime tag_name: string, comptime TypeName: type, origData: anytype, loc: logger.Loc) Stmt {
        return Stmt{ .loc = loc, .data = @unionInit(Data, tag_name, origData) };
    }

    pub fn alloc(allocator: *std.mem.Allocator, comptime StatementData: type, origData: StatementData, loc: logger.Loc) Stmt {
        icount += 1;
        switch (StatementData) {
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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }

        pub fn isExportLike(tag: Tag) bool {
            return switch (tag) {
                .s_export_clause, .s_export_default, .s_export_equals, .s_export_from, .s_export_star, .s_empty => true,
                else => false,
            };
        }
    };

    pub const Data = union(Tag) {
        s_block: *S.Block,
        s_break: *S.Break,
        s_class: *S.Class,
        s_comment: *S.Comment,
        s_continue: *S.Continue,
        s_directive: *S.Directive,
        s_do_while: *S.DoWhile,
        s_enum: *S.Enum,
        s_export_clause: *S.ExportClause,
        s_export_default: *S.ExportDefault,
        s_export_equals: *S.ExportEquals,
        s_export_from: *S.ExportFrom,
        s_export_star: *S.ExportStar,
        s_expr: *S.SExpr,
        s_for_in: *S.ForIn,
        s_for_of: *S.ForOf,
        s_for: *S.For,
        s_function: *S.Function,
        s_if: *S.If,
        s_import: *S.Import,
        s_label: *S.Label,
        s_lazy_export: *S.LazyExport,
        s_local: *S.Local,
        s_namespace: *S.Namespace,
        s_return: *S.Return,
        s_switch: *S.Switch,
        s_throw: *S.Throw,
        s_try: *S.Try,
        s_while: *S.While,
        s_with: *S.With,

        s_type_script: S.TypeScript,
        s_empty: S.Empty, // special case, its a zero value type
        s_debugger: S.Debugger,

        pub const Store = struct {
            const Union = [_]type{
                S.Block,
                S.Break,
                S.Class,
                S.Comment,
                S.Continue,
                S.Directive,
                S.DoWhile,
                S.Enum,
                S.ExportClause,
                S.ExportDefault,
                S.ExportEquals,
                S.ExportFrom,
                S.ExportStar,
                S.SExpr,
                S.ForIn,
                S.ForOf,
                S.For,
                S.Function,
                S.If,
                S.Import,
                S.Label,
                S.LazyExport,
                S.Local,
                S.Namespace,
                S.Return,
                S.Switch,
                S.Throw,
                S.Try,
                S.TypeScript,
                S.While,
                S.With,
            };
            pub const All = NewBaseStore(Union, 128);

            threadlocal var has_inited = false;
            pub threadlocal var disable_reset = false;
            pub fn create(allocator: *std.mem.Allocator) void {
                if (has_inited) {
                    return;
                }

                has_inited = true;
                _ = All.init(allocator);
            }

            pub fn reset() void {
                if (disable_reset) return;
                All.reset();
            }

            pub fn append(comptime ValueType: type, value: anytype) *ValueType {
                return All.append(ValueType, value);
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

    pub inline fn initIdentifier(ref: Ref, loc: logger.Loc) Expr {
        return Expr{
            .loc = loc,
            .data = .{
                .e_identifier = E.Identifier.init(ref),
            },
        };
    }

    pub fn toEmpty(expr: *Expr) Expr {
        return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = expr.loc };
    }
    pub fn isEmpty(expr: *Expr) bool {
        return std.meta.activeTag(expr.data) == .e_missing;
    }
    pub const Query = struct { expr: Expr, loc: logger.Loc };

    pub fn getArray(exp: *const Expr) *E.Array {
        return exp.data.e_array;
    }
    pub fn getUnary(exp: *const Expr) *E.Unary {
        return exp.data.e_unary;
    }
    pub fn getBinary(exp: *const Expr) *E.Binary {
        return exp.data.e_binary;
    }
    pub fn getThis(exp: *const Expr) *E.This {
        return E.This{};
    }
    pub fn getClass(exp: *const Expr) *E.Class {
        return exp.data.e_class;
    }
    pub fn getBoolean(exp: *const Expr) *E.Boolean {
        return exp.data.e_boolean;
    }
    pub fn getSuper(exp: *const Expr) *E.Super {
        return exp.data.e_super;
    }
    pub fn getNull(exp: *const Expr) *E.Null {
        return exp.data.e_null;
    }
    pub fn getUndefined(exp: *const Expr) *E.Undefined {
        return exp.data.e_undefined;
    }
    pub fn getNew(exp: *const Expr) *E.New {
        return exp.data.e_new;
    }
    pub fn getNewTarget(exp: *const Expr) *E.NewTarget {
        return &E.NewTarget{};
    }
    pub fn getFunction(exp: *const Expr) *E.Function {
        return exp.data.e_function;
    }

    pub fn getCall(exp: *const Expr) *E.Call {
        return exp.data.e_call;
    }
    pub fn getDot(exp: *const Expr) *E.Dot {
        return exp.data.e_dot;
    }
    pub fn getIndex(exp: *const Expr) *E.Index {
        return exp.data.e_index;
    }
    pub fn getArrow(exp: *const Expr) *E.Arrow {
        return exp.data.e_arrow;
    }
    pub fn getPrivateIdentifier(exp: *const Expr) *E.PrivateIdentifier {
        return exp.data.e_private_identifier;
    }
    pub fn getJsxElement(exp: *const Expr) *E.JSXElement {
        return exp.data.e_jsx_element;
    }
    pub fn getMissing(exp: *const Expr) *E.Missing {
        return exp.data.e_missing;
    }
    pub fn getNumber(exp: *const Expr) E.Number {
        return exp.data.e_number;
    }
    pub fn getBigInt(exp: *const Expr) E.BigInt {
        return exp.data.e_big_int;
    }
    pub fn getObject(exp: *const Expr) *E.Object {
        return exp.data.e_object;
    }
    pub fn getSpread(exp: *const Expr) *E.Spread {
        return exp.data.e_spread;
    }
    pub fn getString(exp: *const Expr) E.String {
        return exp.data.e_string;
    }
    pub fn getTemplatePart(exp: *const Expr) *E.TemplatePart {
        return exp.data.e_template_part;
    }
    pub fn getTemplate(exp: *const Expr) *E.Template {
        return exp.data.e_template;
    }
    pub fn getRegExp(exp: *const Expr) *E.RegExp {
        return exp.data.e_reg_exp;
    }
    pub fn getAwait(exp: *const Expr) *E.Await {
        return exp.data.e_await;
    }
    pub fn getYield(exp: *const Expr) *E.Yield {
        return exp.data.e_yield;
    }
    pub fn getIf(exp: *const Expr) *E.If {
        return exp.data.e_if;
    }
    pub fn getRequire(exp: *const Expr) *E.Require {
        return exp.data.e_require;
    }
    pub fn getRequireOrRequireResolve(exp: *const Expr) *E.RequireOrRequireResolve {
        return exp.data.e_require_or_require_resolve;
    }
    pub fn getImport(exp: *const Expr) *E.Import {
        return exp.data.e_import;
    }

    pub fn hasAnyPropertyNamed(expr: *const Expr, comptime names: []const string) bool {
        if (std.meta.activeTag(expr.data) != .e_object) return false;
        const obj = expr.data.e_object;
        if (@ptrToInt(obj.properties.ptr) == 0) return false;

        for (obj.properties) |prop| {
            const value = prop.value orelse continue;
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            const key_str = key.data.e_string;
            if (strings.eqlAnyComptime(key_str.utf8, names)) return true;
        }

        return false;
    }

    // Making this comptime bloats the binary and doesn't seem to impact runtime performance.
    pub fn asProperty(expr: *const Expr, name: string) ?Query {
        if (std.meta.activeTag(expr.data) != .e_object) return null;
        const obj = expr.data.e_object;
        if (@ptrToInt(obj.properties.ptr) == 0) return null;

        for (obj.properties) |prop| {
            const value = prop.value orelse continue;
            const key = prop.key orelse continue;
            if (std.meta.activeTag(key.data) != .e_string) continue;
            const key_str = key.data.e_string;
            if (key_str.eql(string, name)) {
                return Query{ .expr = value, .loc = key.loc };
            }
        }

        return null;
    }

    pub const ArrayIterator = struct {
        array: *const E.Array,
        index: u32,

        pub fn next(this: *ArrayIterator) ?Expr {
            if (this.index >= this.array.items.len) {
                return null;
            }
            defer this.index += 1;
            return this.array.items[this.index];
        }
    };

    pub fn asArray(expr: *const Expr) ?ArrayIterator {
        if (std.meta.activeTag(expr.data) != .e_array) return null;
        const array = expr.data.e_array;
        if (array.items.len == 0 or @ptrToInt(array.items.ptr) == 0) return null;

        return ArrayIterator{ .array = array, .index = 0 };
    }

    pub fn asString(expr: *const Expr, allocator: *std.mem.Allocator) ?string {
        if (std.meta.activeTag(expr.data) != .e_string) return null;

        const key_str = expr.data.e_string;

        return if (key_str.isUTF8()) key_str.utf8 else key_str.string(allocator) catch null;
    }

    pub fn asBool(
        expr: *const Expr,
    ) ?bool {
        if (std.meta.activeTag(expr.data) != .e_boolean) return null;

        return expr.data.e_boolean.value;
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

    // The goal of this function is to "rotate" the AST if it's possible to use the
    // left-associative property of the operator to avoid unnecessary parentheses.
    //
    // When using this, make absolutely sure that the operator is actually
    // associative. For example, the "-" operator is not associative for
    // floating-point numbers.
    pub fn joinWithLeftAssociativeOp(
        comptime op: Op.Code,
        a: Expr,
        b: Expr,
        allocator: *std.mem.Allocator,
    ) Expr {
        // "(a, b) op c" => "a, b op c"
        switch (a.data) {
            .e_binary => |comma| {
                if (comma.op == .bin_comma) {
                    comma.right = joinWithLeftAssociativeOp(op, comma.right, b, allocator);
                }
            },
            else => {},
        }

        // "a op (b op c)" => "(a op b) op c"
        // "a op (b op (c op d))" => "((a op b) op c) op d"
        switch (b.data) {
            .e_binary => |binary| {
                if (binary.op == op) {
                    return joinWithLeftAssociativeOp(
                        op,
                        joinWithLeftAssociativeOp(op, a, binary.left, allocator),
                        binary.right,
                        allocator,
                    );
                }
            },
            else => {},
        }

        // "a op b" => "a op b"
        // "(a op b) op c" => "(a op b) op c"
        return Expr.init(E.Binary, E.Binary{ .op = op, .left = a, .right = b }, a.loc);
    }

    pub fn joinWithComma(a: Expr, b: Expr, allocator: *std.mem.Allocator) Expr {
        if (a.isMissing()) {
            return b;
        }

        if (b.isMissing()) {
            return a;
        }

        return Expr.init(E.Binary, E.Binary{ .op = .bin_comma, .left = a, .right = b }, a.loc);
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

    pub fn joinAllWithCommaCallback(all: []Expr, comptime Context: type, ctx: Context, callback: (fn (ctx: anytype, expr: anytype) ?Expr), allocator: *std.mem.Allocator) ?Expr {
        std.debug.assert(all.len > 0);
        switch (all.len) {
            1 => {
                return callback(ctx, all[0]);
            },
            2 => {
                return Expr.joinWithComma(
                    callback(ctx, all[0]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[0].loc,
                    },
                    callback(ctx, all[1]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[1].loc,
                    },
                    allocator,
                );
            },
            else => {
                var i: usize = 1;
                var expr = callback(ctx, all[0]) orelse Expr{
                    .data = .{ .e_missing = .{} },
                    .loc = all[0].loc,
                };

                while (i < all.len) : (i += 1) {
                    expr = Expr.joinWithComma(expr, callback(ctx, all[i]) orelse Expr{
                        .data = .{ .e_missing = .{} },
                        .loc = all[i].loc,
                    }, allocator);
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

        return [2]f64{ left.e_number.value, right.e_number.value };
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

    // We don't need to dynamically allocate booleans
    var true_bool = E.Boolean{ .value = true };
    var false_bool = E.Boolean{ .value = false };
    var bool_values = [_]*E.Boolean{ &false_bool, &true_bool };

    pub fn init(comptime Type: type, st: Type, loc: logger.Loc) Expr {
        icount += 1;

        switch (Type) {
            E.Array => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_array = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Class => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_class = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Unary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_unary = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Binary => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_binary = Data.Store.All.append(Type, st),
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
                        .e_boolean = st,
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
                        .e_new = Data.Store.All.append(Type, st),
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
                        .e_function = Data.Store.All.append(Type, st),
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
                        .e_call = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Dot => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_dot = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Index => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_index = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Arrow => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_arrow = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Identifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_identifier = E.Identifier{
                            .ref = st.ref,
                            .must_keep_due_to_with_stmt = st.must_keep_due_to_with_stmt,
                            .can_be_removed_if_unused = st.can_be_removed_if_unused,
                            .call_can_be_unwrapped_if_unused = st.call_can_be_unwrapped_if_unused,
                        },
                    },
                };
            },
            E.ImportIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import_identifier = .{
                            .ref = st.ref,
                            .was_originally_identifier = st.was_originally_identifier,
                        },
                    },
                };
            },
            E.PrivateIdentifier => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_private_identifier = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.JSXElement => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_jsx_element = Data.Store.All.append(Type, st),
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
                        .e_number = st,
                    },
                };
            },
            E.BigInt => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_big_int = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Object => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_object = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Spread => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_spread = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.String => {
                if (comptime isDebug) {
                    // Sanity check: assert string is not a null ptr
                    if (st.isUTF8() and st.utf8.len > 0) {
                        std.debug.assert(@ptrToInt(st.utf8.ptr) > 0);
                        std.debug.assert(st.utf8[0] > 0);
                    } else if (st.value.len > 0) {
                        std.debug.assert(@ptrToInt(st.value.ptr) > 0);
                    }
                }
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.TemplatePart => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template_part = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Template => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_template = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.RegExp => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_reg_exp = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Await => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_await = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Yield => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_yield = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.If => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_if = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.RequireOrRequireResolve => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require_or_require_resolve = st,
                    },
                };
            },
            E.Import => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_import = Data.Store.All.append(Type, st),
                    },
                };
            },
            E.Require => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_require = st,
                    },
                };
            },
            *E.String => {
                return Expr{
                    .loc = loc,
                    .data = Data{
                        .e_string = Data.Store.All.append(@TypeOf(st.*), st.*),
                    },
                };
            },

            else => {
                @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
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

        // This should never make it to the printer
        inline_identifier,

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }

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

            .e_if => |ex| {
                return isBoolean(ex.yes) and isBoolean(ex.no);
            },
            .e_unary => |ex| {
                return ex.op == .un_not or ex.op == .un_delete;
            },
            .e_binary => |ex| {
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
        return init(E.Binary, E.Binary{
            .op = .bin_assign,
            .left = a,
            .right = b,
        }, a.loc);
    }
    pub inline fn at(expr: Expr, comptime Type: type, t: Type, allocator: *std.mem.Allocator) Expr {
        return init(Type, t, expr.loc);
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub fn not(expr: *Expr, allocator: *std.mem.Allocator) Expr {
        return maybeSimplifyNot(expr, allocator) orelse expr.*;
    }

    pub fn hasValueForThisInCall(expr: Expr) bool {
        return switch (expr.data) {
            .e_dot, .e_index => true,
            else => false,
        };
    }

    // The given "expr" argument should be the operand of a "!" prefix operator
    // (i.e. the "x" in "!x"). This returns a simplified expression for the
    // whole operator (i.e. the "!x") if it can be simplified, or false if not.
    // It's separate from "Not()" above to avoid allocation on failure in case
    // that is undesired.
    pub fn maybeSimplifyNot(expr: *Expr, allocator: *std.mem.Allocator) ?Expr {
        switch (expr.data) {
            .e_null, .e_undefined => {
                return expr.at(E.Boolean, E.Boolean{ .value = true }, allocator);
            },
            .e_boolean => |b| {
                return expr.at(E.Boolean, E.Boolean{ .value = b.value }, allocator);
            },
            .e_number => |n| {
                return expr.at(E.Boolean, E.Boolean{ .value = (n.value == 0 or std.math.isNan(n.value)) }, allocator);
            },
            .e_big_int => |b| {
                return expr.at(E.Boolean, E.Boolean{ .value = strings.eqlComptime(b.value, "0") }, allocator);
            },
            .e_function,
            .e_arrow,
            .e_reg_exp,
            => {
                return expr.at(E.Boolean, E.Boolean{ .value = false }, allocator);
            },
            // "!!!a" => "!a"
            .e_unary => |un| {
                if (un.op == Op.Code.un_not and isBoolean(un.value)) {
                    return un.value;
                }
            },
            .e_binary => |ex| {
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
            S.SExpr,
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
        e_array: *E.Array,
        e_unary: *E.Unary,
        e_binary: *E.Binary,
        e_class: *E.Class,

        e_new: *E.New,
        e_function: *E.Function,
        e_call: *E.Call,
        e_dot: *E.Dot,
        e_index: *E.Index,
        e_arrow: *E.Arrow,
        e_identifier: E.Identifier,
        e_import_identifier: E.ImportIdentifier,
        e_private_identifier: *E.PrivateIdentifier,
        e_jsx_element: *E.JSXElement,

        e_object: *E.Object,
        e_spread: *E.Spread,

        e_template_part: *E.TemplatePart,
        e_template: *E.Template,
        e_reg_exp: *E.RegExp,
        e_await: *E.Await,
        e_yield: *E.Yield,
        e_if: *E.If,
        e_require: E.Require,
        e_require_or_require_resolve: E.RequireOrRequireResolve,
        e_import: *E.Import,

        e_boolean: E.Boolean,
        e_number: E.Number,
        e_big_int: *E.BigInt,
        e_string: *E.String,

        e_missing: E.Missing,
        e_this: E.This,
        e_super: E.Super,
        e_null: E.Null,
        e_undefined: E.Undefined,
        e_new_target: E.NewTarget,
        e_import_meta: E.ImportMeta,

        // This type should not exist outside of MacroContext
        // If it ends up in JSParser or JSPrinter, it is a bug.
        inline_identifier: i32,

        pub const Store = struct {
            const often = 512;
            const medium = 256;
            const rare = 24;

            pub const All = NewBaseStore(
                &([_]type{
                    E.Array,
                    E.Unary,
                    E.Binary,
                    E.Class,
                    E.New,
                    E.Function,
                    E.Call,
                    E.Dot,
                    E.Index,
                    E.Arrow,
                    E.RegExp,

                    E.PrivateIdentifier,
                    E.JSXElement,
                    E.Number,
                    E.BigInt,
                    E.Object,
                    E.Spread,
                    E.String,
                    E.TemplatePart,
                    E.Template,
                    E.Await,
                    E.Yield,
                    E.If,
                    E.Import,
                }),
                512,
            );

            threadlocal var has_inited = false;
            pub threadlocal var disable_reset = false;
            pub fn create(allocator: *std.mem.Allocator) void {
                if (has_inited) {
                    return;
                }

                has_inited = true;
                _ = All.init(allocator);
            }

            pub fn reset() void {
                if (disable_reset) return;
                All.reset();
            }

            pub fn append(comptime ValueType: type, value: anytype) *ValueType {
                if (ValueType == E.Identifier) {
                    return Identifier.append(ValueType, value);
                } else {
                    return All.append(ValueType, value);
                }
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

    pub const Directive = struct {
        value: []const u16,
    };

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
            pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
                return try std.json.stringify(@tagName(self), opts, o);
            }
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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }

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

    pub const Level = enum(u6) {
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
    pub const Table = brk: {
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

        break :brk table;
    };
};

pub const ArrayBinding = struct {
    binding: BindingNodeIndex,
    default_value: ?ExprNodeIndex = null,
};

pub const Ast = struct {
    approximate_newline_count: usize = 0,
    has_lazy_export: bool = false,
    runtime_imports: Runtime.Imports,

    runtime_import_record_id: ?u32 = null,
    needs_runtime: bool = false,
    externals: []u32 = &[_]u32{},
    // This is a list of CommonJS features. When a file uses CommonJS features,
    // it's not a candidate for "flat bundling" and must be wrapped in its own
    // closure.
    has_top_level_return: bool = false,
    uses_exports_ref: bool = false,
    uses_module_ref: bool = false,
    uses_require_ref: bool = false,
    exports_kind: ExportsKind = ExportsKind.none,

    bundle_export_ref: ?Ref = null,

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
    require_ref: Ref = Ref.None,

    bundle_namespace_ref: ?Ref = null,
    prepend_part: ?Part = null,

    // These are used when bundling. They are filled in during the parser pass
    // since we already have to traverse the AST then anyway and the parser pass
    // is conveniently fully parallelized.
    named_imports: NamedImports = undefined,
    named_exports: NamedExports = undefined,
    top_level_symbol_to_parts: AutoHashMap(Ref, std.ArrayList(u32)) = undefined,
    export_star_import_records: []u32 = &([_]u32{}),

    pub const NamedImports = std.ArrayHashMap(Ref, NamedImport, RefHashCtx, true);
    pub const NamedExports = std.StringArrayHashMap(NamedExport);

    pub fn initTest(parts: []Part) Ast {
        return Ast{
            .parts = parts,
            .runtime_imports = .{},
        };
    }

    pub const empty = Ast{ .parts = &[_]Part{}, .runtime_imports = undefined };

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
    esm_with_dyn,

    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
};

pub fn isDynamicExport(exp: ExportsKind) bool {
    return kind == .cjs || kind == .esm_with_dyn;
}

pub const DeclaredSymbol = struct {
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

    tag: Tag = Tag.none,

    pub const Tag = enum {
        none,
        jsx_import,
    };

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

pub const StrictModeKind = enum(u7) {
    sloppy_mode,
    explicit_strict_mode,
    implicit_strict_mode_import,
    implicit_strict_mode_export,
    implicit_strict_mode_top_level_await,
    implicit_strict_mode_class,
    pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
        return try std.json.stringify(@tagName(self), opts, o);
    }
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

    pub fn reset(this: *Scope) void {
        this.children.clearRetainingCapacity();
        this.generated.clearRetainingCapacity();
        this.members.clearRetainingCapacity();
        this.parent = null;
        this.id = 0;
        this.label_ref = null;
        this.label_stmt_is_loop = false;
        this.contains_direct_eval = false;
        this.strict_mode = .sloppy_mode;
        this.kind = .block;
    }

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

        pub fn jsonStringify(self: @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
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
};

pub fn printmem(comptime format: string, args: anytype) void {
    defer Output.flush();
    Output.initTest();
    Output.print(format, args);
}

pub const Macro = struct {
    const JavaScript = @import("./javascript/jsc/javascript.zig");
    const JSC = @import("./javascript/jsc/bindings/bindings.zig");
    const JSCBase = @import("./javascript/jsc/base.zig");
    const Resolver = @import("./resolver/resolver.zig").Resolver;
    const isPackagePath = @import("./resolver/resolver.zig").isPackagePath;
    const ResolveResult = @import("./resolver/resolver.zig").Result;
    const DotEnv = @import("./env_loader.zig");
    const js = @import("./javascript/jsc/JavascriptCore.zig");
    const Zig = @import("./javascript/jsc/bindings/exports.zig");
    const Bundler = @import("./bundler.zig").Bundler;
    const MacroEntryPoint = @import("./bundler.zig").MacroEntryPoint;
    const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
    const MacroRemapEntry = @import("./resolver/package_json.zig").MacroImportReplacementMap;

    pub const namespace: string = "macro";
    pub const namespaceWithColon: string = namespace ++ ":";

    pub fn isMacroPath(str: string) bool {
        return (str.len > namespaceWithColon.len and strings.eqlComptimeIgnoreLen(str[0..namespaceWithColon.len], namespaceWithColon));
    }

    pub const MacroContext = struct {
        pub const MacroMap = std.AutoArrayHashMap(i32, Macro);

        resolver: *Resolver,
        env: *DotEnv.Loader,
        macros: MacroMap,
        remap: MacroRemap,

        pub fn getRemap(this: MacroContext, path: string) ?MacroRemapEntry {
            return this.remap.get(path);
        }

        pub fn init(bundler: *Bundler) MacroContext {
            return MacroContext{
                .macros = MacroMap.init(default_allocator),
                .resolver = &bundler.resolver,
                .env = bundler.env,
                .remap = MacroRemap{},
            };
        }

        pub fn call(
            this: *MacroContext,
            import_record_path: string,
            source_dir: string,
            log: *logger.Log,
            source: *const logger.Source,
            import_range: logger.Range,
            caller: Expr,
            args: []Expr,
            function_name: string,
            comptime Visitor: type,
            visitor: Visitor,
        ) anyerror!Expr {
            Expr.Data.Store.disable_reset = true;
            Stmt.Data.Store.disable_reset = true;
            defer Expr.Data.Store.disable_reset = false;
            defer Stmt.Data.Store.disable_reset = false;
            // const is_package_path = isPackagePath(specifier);
            const import_record_path_without_macro_prefix = if (isMacroPath(import_record_path))
                import_record_path[namespaceWithColon.len..]
            else
                import_record_path;

            std.debug.assert(!isMacroPath(import_record_path_without_macro_prefix));

            const resolve_result = this.resolver.resolve(source_dir, import_record_path_without_macro_prefix, .stmt) catch |err| {
                switch (err) {
                    error.ModuleNotFound => {
                        log.addResolveError(
                            source,
                            import_range,
                            log.msgs.allocator,
                            "Macro \"{s}\" not found",
                            .{import_record_path},
                            .stmt,
                        ) catch unreachable;
                        return error.MacroNotFound;
                    },
                    else => {
                        log.addRangeErrorFmt(
                            source,
                            import_range,
                            log.msgs.allocator,
                            "{s} resolving macro \"{s}\"",
                            .{ @errorName(err), import_record_path },
                        ) catch unreachable;
                        return err;
                    },
                }
            };

            var specifier_buf: [64]u8 = undefined;
            var specifier_buf_len: u32 = 0;
            const hash = MacroEntryPoint.generateID(
                resolve_result.path_pair.primary.text,
                function_name,
                &specifier_buf,
                &specifier_buf_len,
            );

            var macro_entry = this.macros.getOrPut(hash) catch unreachable;
            if (!macro_entry.found_existing) {
                macro_entry.value_ptr.* = Macro.init(
                    default_allocator,
                    this.resolver,
                    resolve_result,
                    log,
                    this.env,
                    function_name,
                    specifier_buf[0..specifier_buf_len],
                    hash,
                ) catch |err| {
                    macro_entry.value_ptr.* = Macro{ .resolver = undefined, .disabled = true };
                    return err;
                };
                Output.flush();
            }
            defer Output.flush();

            const macro = macro_entry.value_ptr.*;
            if (macro.disabled) {
                return caller;
            }
            macro.vm.enableMacroMode();
            defer macro.vm.disableMacroMode();
            return Macro.Runner.run(
                macro,
                log,
                default_allocator,
                function_name,
                caller,
                args,
                source,
                hash,
                comptime Visitor,
                visitor,
            );
            // this.macros.getOrPut(key: K)
        }
    };

    pub const MacroResult = struct {
        import_statements: []S.Import = &[_]S.Import{},
        replacement: Expr,
    };

    pub const JSNode = struct {
        loc: logger.Loc,
        data: Data,
        pub const Class = JSCBase.NewClass(
            JSNode,
            .{
                .name = "JSNode",
                .read_only = true,
            },
            .{
                .toString = .{
                    .rfn = JSBindings.toString,
                },

                // .getAt = .{
                //     .rfn = JSBindings.getAt,
                // },
                // .valueAt = .{
                //     .rfn = JSBindings.valueAt,
                // },
                // .toNumber = .{
                //     .rfn = toNumber,
                // },
                .get = .{
                    .rfn = JSBindings.get,
                    .ro = true,
                },
            },
            .{
                .tag = .{
                    .get = JSBindings.getTag,
                    .ro = true,
                },

                .tagName = .{
                    .get = JSBindings.getTagName,
                    .ro = true,
                },
                .position = .{
                    .get = JSBindings.getPosition,
                    .ro = true,
                },
                .value = .{
                    .get = JSBindings.getValue,
                    .ro = true,
                },
                .arguments = .{
                    .get = JSBindings.getCallArgs,
                    .ro = true,
                },
                .properties = .{
                    .get = JSBindings.getProperties,
                    .ro = true,
                },
                .propertyNodes = .{
                    .get = JSBindings.getPropertyNodes,
                    .ro = true,
                },

                .namespace = .{
                    .get = JSBindings.getModuleNamespace,
                    .ro = true,
                },
            },
        );

        pub fn makeFromExpr(allocator: *std.mem.Allocator, expr: Expr) js.JSObjectRef {
            var ptr = allocator.create(JSNode) catch unreachable;
            ptr.* = JSNode.initExpr(expr);
            // If we look at JSObjectMake, we can see that all it does with the ctx value is lookup what the global object is
            // so it's safe to just avoid that and do it here like this:
            return JSNode.Class.make(JavaScript.VirtualMachine.vm.global.ref(), ptr);
        }

        pub fn updateSymbolsMap(this: *const JSNode, comptime Visitor: type, visitor: Visitor) void {
            switch (this.data) {
                Tag.fragment => |frag| {
                    for (frag) |child| {
                        if (child.data == .inline_inject) {
                            child.updateSymbolsMap(Visitor, visitor);
                        }
                    }
                },
                Tag.inline_inject => |inject| {
                    for (inject) |child| {
                        child.updateSymbolsMap(Visitor, visitor);
                    }
                },

                Tag.s_import => |import| {
                    visitor.visitImport(import.*);
                },

                else => {},
            }
        }

        pub const JSBindings = struct {
            const getAllocator = JSCBase.getAllocator;

            threadlocal var temporary_call_args_array: [256]js.JSValueRef = undefined;
            pub fn getCallArgs(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                const args = this.data.callArgs();

                switch (args.len) {
                    0 => return js.JSObjectMakeArray(ctx, 0, null, exception),
                    1...255 => {
                        var slice = temporary_call_args_array[0..args.len];
                        for (slice) |_, i| {
                            var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                            node.* = JSNode.initExpr(args[i]);
                            slice[i] = JSNode.Class.make(ctx, node);
                        }
                        return js.JSObjectMakeArray(ctx, args.len, slice.ptr, exception);
                    },
                    else => {
                        Output.prettyErrorln("are you for real? {d} args to your call expression? that has to be a bug.\n", .{args.len});
                        Output.flush();
                        return js.JSObjectMakeArray(ctx, 0, null, exception);
                    },
                }
            }

            pub fn getProperties(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                if (this.data != .e_object) {
                    return js.JSObjectMake(ctx, null, null);
                }

                var lazy = getAllocator(ctx).create(LazyPropertiesObject) catch unreachable;
                lazy.* = LazyPropertiesObject{ .node = this.* };
                return LazyPropertiesObject.Class.make(ctx, lazy);
            }

            pub fn getPropertyNodes(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                const args = if (this.data == .e_object) this.data.e_object.properties else &[_]G.Property{};

                switch (args.len) {
                    0 => return js.JSObjectMakeArray(ctx, 0, null, exception),
                    1...255 => {
                        var slice = temporary_call_args_array[0..args.len];
                        for (slice) |_, i| {
                            var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                            node.* = JSNode{ .data = .{ .g_property = &args[i] }, .loc = this.loc };
                            slice[i] = JSNode.Class.make(ctx, node);
                        }
                        return js.JSObjectMakeArray(ctx, args.len, slice.ptr, exception);
                    },
                    else => {
                        return js.JSObjectMakeArray(ctx, 0, null, exception);
                    },
                }
            }

            pub fn getModuleNamespace(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                if (this.data != .s_import) return js.JSValueMakeUndefined(ctx);

                var module_namespace = getAllocator(ctx).create(ModuleNamespace) catch unreachable;
                module_namespace.* = ModuleNamespace{ .import_data = this.data.s_import.* };
                return ModuleNamespace.Class.make(ctx, module_namespace);
            }

            fn toNumberValue(this: *JSNode, number: E.Number) js.JSValueRef {
                return JSC.JSValue.jsNumberFromDouble(number.value).asRef();
            }

            fn toStringValue(this: *JSNode, ctx: js.JSContextRef, str: E.String) js.JSObjectRef {
                if (str.isBlank()) {
                    return JSC.ZigString.init("").toValue(JavaScript.VirtualMachine.vm.global).asRef();
                }

                if (str.isUTF8()) {
                    return JSC.ZigString.init(str.utf8).toValue(JavaScript.VirtualMachine.vm.global).asRef();
                } else {
                    return js.JSValueMakeString(ctx, js.JSStringCreateWithCharactersNoCopy(str.value.ptr, str.value.len));
                }
            }

            threadlocal var regex_value_array: [2]js.JSValueRef = undefined;

            fn toRegexValue(this: *JSNode, ctx: js.JSContextRef, regex: *E.RegExp, exception: js.ExceptionRef) js.JSObjectRef {
                if (regex.value.len == 0) {
                    return js.JSObjectMakeRegExp(ctx, 0, null, exception);
                }

                regex_value_array[0] = JSC.ZigString.init(regex.pattern()).toValue(JavaScript.VirtualMachine.vm.global).asRef();
                regex_value_array[1] = JSC.ZigString.init(regex.flags()).toValue(JavaScript.VirtualMachine.vm.global).asRef();

                return js.JSObjectMakeRegExp(ctx, 2, &regex_value_array, exception);
            }

            fn toArrayValue(this: *JSNode, ctx: js.JSContextRef, array: E.Array, exception: js.ExceptionRef) js.JSObjectRef {
                if (array.items.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                for (array.items) |expr, i| {
                    var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                    node.* = JSNode.initExpr(expr);
                    temporary_call_args_array[i] = JSNode.Class.make(ctx, node);
                }

                return js.JSObjectMakeArray(ctx, array.items.len, &temporary_call_args_array, exception);
            }

            fn toArrayPrimitive(this: *JSNode, ctx: js.JSContextRef, array: E.Array, exception: js.ExceptionRef) js.JSObjectRef {
                if (array.items.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                var node: JSNode = undefined;
                for (array.items) |expr, i| {
                    node = JSNode.initExpr(expr);
                    temporary_call_args_array[i] = toPrimitive(&node, ctx, exception);
                }

                return js.JSObjectMakeArray(ctx, array.items.len, temporary_call_args_array[0..array.items.len].ptr, exception);
            }

            fn toObjectValue(this: *JSNode, ctx: js.JSContextRef, obj: E.Object, exception: js.ExceptionRef) js.JSObjectRef {
                if (obj.properties.len == 0) {
                    return js.JSObjectMakeArray(ctx, 0, null, exception);
                }

                var object_properties_array: [64]js.JSObjectRef = undefined;

                var did_allocate = false;
                var properties_list = if (obj.properties.len < object_properties_array.len)
                    object_properties_array[0..obj.properties.len]
                else brk: {
                    did_allocate = true;
                    break :brk getAllocator(ctx).alloc(js.JSObjectRef, obj.properties.len) catch unreachable;
                };

                defer if (did_allocate) getAllocator(ctx).free(properties_list);

                for (obj.properties) |_, i| {
                    var node = JSCBase.getAllocator(ctx).create(JSNode) catch unreachable;
                    node.* = JSNode{
                        .data = .{
                            .g_property = &obj.properties[i],
                        },
                        .loc = this.loc,
                    };
                    properties_list[i] = JSNode.Class.make(ctx, node);
                }

                return js.JSObjectMakeArray(ctx, properties_list.len, properties_list.ptr, exception);
            }

            fn toObjectPrimitive(this: *JSNode, ctx: js.JSContextRef, obj: E.Object, exception: js.ExceptionRef) js.JSObjectRef {
                var lazy = getAllocator(ctx).create(LazyPropertiesObject) catch unreachable;
                lazy.* = LazyPropertiesObject{ .node = this.* };
                return LazyPropertiesObject.Class.make(ctx, lazy);
            }

            fn toPropertyPrimitive(this: *JSNode, ctx: js.JSContextRef, prop: G.Property, exception: js.ExceptionRef) js.JSObjectRef {
                var entries: [3]js.JSValueRef = undefined;

                entries[0] = js.JSValueMakeUndefined(ctx);
                entries[1] = entries[0];
                entries[2] = entries[0];

                var other: JSNode = undefined;

                if (prop.key) |key| {
                    other = JSNode.initExpr(key);
                    entries[0] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                if (prop.value) |value| {
                    other = JSNode.initExpr(value);
                    entries[1] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                if (prop.initializer) |value| {
                    other = JSNode.initExpr(value);
                    entries[2] = toPrimitive(
                        &other,
                        ctx,
                        exception,
                    ) orelse js.JSValueMakeUndefined(ctx);
                }

                const out = js.JSObjectMakeArray(ctx, 3, &entries, exception);
                return out;
            }

            pub fn toString(
                this: *JSNode,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                switch (this.data) {
                    .e_string => |str| {
                        return toStringValue(this, ctx, str.*);
                    },
                    .e_template => |template| {
                        const str = template.head;

                        if (str.isBlank()) {
                            return JSC.ZigString.init("").toValue(JavaScript.VirtualMachine.vm.global).asRef();
                        }

                        if (str.isUTF8()) {
                            return JSC.ZigString.init(str.utf8).toValue(JavaScript.VirtualMachine.vm.global).asRef();
                        } else {
                            return js.JSValueMakeString(ctx, js.JSStringCreateWithCharactersNoCopy(str.value.ptr, str.value.len));
                        }
                    },
                    // .e_number => |number| {

                    // },
                    else => {
                        return JSC.ZigString.init("").toValue(JavaScript.VirtualMachine.vm.global).asRef();
                    },
                }
            }

            fn toPrimitive(
                this: *JSNode,
                ctx: js.JSContextRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                return @call(.{ .modifier = .always_inline }, toPrimitiveAllowRecursion, .{ this, ctx, exception, false });
            }

            fn toPrimitiveWithRecursion(
                this: *JSNode,
                ctx: js.JSContextRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                return @call(.{ .modifier = .always_inline }, toPrimitiveAllowRecursion, .{ this, ctx, exception, true });
            }

            fn toPrimitiveAllowRecursion(this: *JSNode, ctx: js.JSContextRef, exception: js.ExceptionRef, comptime allow_recursion: bool) js.JSValueRef {
                switch (this.data) {
                    .e_string => |str| {
                        return JSBindings.toStringValue(this, ctx, str.*);
                    },
                    .e_template => |template| {
                        return JSBindings.toStringValue(this, ctx, template.head);
                        // return JSBindings.toTemplatePrimitive(this, ctx, template.*);
                    },
                    .e_number => |number| {
                        return JSBindings.toNumberValue(this, number);
                    },
                    .e_reg_exp => |regex| {
                        return JSBindings.toRegexValue(this, ctx, regex, exception);
                    },
                    .e_object => |object| {
                        return JSBindings.toObjectPrimitive(this, ctx, object.*, exception);
                    },
                    .e_array => |array| {
                        return JSBindings.toArrayPrimitive(this, ctx, array.*, exception);
                    },

                    // Returns an Entry
                    // [string, number | regex | object | string | null | undefined]
                    .g_property => |property| {
                        return JSBindings.toPropertyPrimitive(this, ctx, property.*, exception);
                    },
                    .e_null => {
                        return js.JSValueMakeNull(ctx);
                    },
                    else => {
                        return js.JSValueMakeUndefined(ctx);
                    },
                }
            }

            fn toValue(this: *JSNode, ctx: js.JSContextRef, exception: js.ExceptionRef) js.JSObjectRef {
                switch (this.data) {
                    .e_await => |aw| {
                        return JSNode.makeFromExpr(getAllocator(ctx), aw.value);
                    },
                    .e_yield => |yi| {
                        return JSNode.makeFromExpr(getAllocator(ctx), yi.value orelse return null);
                    },
                    .e_spread => |spread| {
                        return JSNode.makeFromExpr(getAllocator(ctx), spread.value);
                    },
                    .e_reg_exp => |reg| {
                        return JSC.ZigString.toRef(reg.value, JavaScript.VirtualMachine.vm.global);
                    },

                    .e_array => |array| {
                        return toArrayValue(this, ctx, array.*, exception);
                    },
                    .e_object => |obj| {
                        return toObjectValue(this, ctx, obj.*, exception);
                    },
                    else => {
                        return null;
                    },
                }
            }

            pub fn getValue(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return toValue(this, ctx, exception) orelse return thisObject;
            }

            pub fn get(
                this: *JSNode,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return toPrimitiveWithRecursion(this, ctx, exception) orelse return js.JSValueMakeUndefined(ctx);
            }

            pub fn getTag(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.JSValue.jsNumberFromU16(@intCast(u16, @enumToInt(std.meta.activeTag(this.data)))).asRef();
            }
            pub fn getTagName(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.ZigString.init(@tagName(this.data)).toValue(JavaScript.VirtualMachine.vm.global).asRef();
            }
            pub fn getPosition(
                this: *JSNode,
                ctx: js.JSContextRef,
                thisObject: js.JSValueRef,
                prop: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                return JSC.JSValue.jsNumberFromInt32(this.loc.start).asRef();
            }
        };

        pub fn initExpr(this: Expr) JSNode {
            switch (this.data) {
                .e_array => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_array = value } };
                },
                .e_unary => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_unary = value } };
                },
                .e_binary => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_binary = value } };
                },
                .e_function => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_function = value } };
                },
                .e_new_target => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_new_target = value } };
                },
                .e_import_meta => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import_meta = value } };
                },
                .e_call => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_call = value } };
                },
                .e_dot => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_dot = value } };
                },
                .e_index => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_index = value } };
                },
                .e_arrow => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_arrow = value } };
                },
                .e_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_identifier = value } };
                },
                .e_import_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import_identifier = value } };
                },
                .e_private_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_private_identifier = value } };
                },
                .e_jsx_element => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_jsx_element = value } };
                },
                .e_big_int => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_big_int = value } };
                },
                .e_object => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_object = value } };
                },
                .e_spread => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_spread = value } };
                },
                .e_string => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_string = value } };
                },
                .e_template_part => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_template_part = value } };
                },
                .e_template => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_template = value } };
                },
                .e_reg_exp => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_reg_exp = value } };
                },
                .e_await => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_await = value } };
                },
                .e_yield => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_yield = value } };
                },
                .e_if => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_if = value } };
                },
                .e_require_or_require_resolve => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_require_or_require_resolve = value } };
                },
                .e_import => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_import = value } };
                },
                .e_this => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_this = value } };
                },
                .e_class => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_class = value } };
                },
                .e_require => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_require = value } };
                },
                .e_missing => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_missing = value } };
                },
                .e_boolean => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_boolean = value } };
                },
                .e_super => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_super = value } };
                },
                .e_null => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_null = value } };
                },
                .e_number => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_number = value } };
                },
                .e_undefined => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .e_undefined = value } };
                },
                .inline_identifier => |value| {
                    return JSNode{ .loc = this.loc, .data = .{ .inline_identifier = value } };
                },
                else => {
                    if (comptime isDebug) {
                        Output.prettyWarnln("initExpr fail: {s}", .{@tagName(this.data)});
                    }
                    return JSNode{ .loc = this.loc, .data = .{ .e_missing = .{} } };
                },
            }
        }

        pub fn toExpr(this: JSNode) Expr {
            switch (this.data) {
                .e_array => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_array = value } };
                },
                .e_unary => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_unary = value } };
                },
                .e_binary => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_binary = value } };
                },
                .e_function => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_function = value } };
                },
                .e_new_target => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_new_target = value } };
                },
                .e_import_meta => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import_meta = value } };
                },
                .e_call => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_call = value } };
                },
                .e_dot => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_dot = value } };
                },
                .e_index => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_index = value } };
                },
                .e_arrow => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_arrow = value } };
                },
                .e_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_identifier = value } };
                },
                .e_import_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import_identifier = value } };
                },
                .e_private_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_private_identifier = value } };
                },
                .e_jsx_element => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_jsx_element = value } };
                },
                .e_big_int => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_big_int = value } };
                },
                .e_object => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_object = value } };
                },
                .e_spread => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_spread = value } };
                },
                .e_string => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_string = value } };
                },
                .e_template_part => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_template_part = value } };
                },
                .e_template => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_template = value } };
                },
                .e_reg_exp => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_reg_exp = value } };
                },
                .e_await => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_await = value } };
                },
                .e_yield => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_yield = value } };
                },
                .e_if => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_if = value } };
                },
                .e_require_or_require_resolve => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_require_or_require_resolve = value } };
                },
                .e_import => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_import = value } };
                },
                .e_this => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_this = value } };
                },
                .e_class => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_class = value } };
                },
                .e_require => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_require = value } };
                },
                .e_missing => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_missing = value } };
                },
                .e_boolean => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_boolean = value } };
                },
                .e_super => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_super = value } };
                },
                .e_null => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_null = value } };
                },
                .e_number => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_number = value } };
                },
                .e_undefined => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .e_undefined = value } };
                },
                .inline_identifier => |value| {
                    return Expr{ .loc = this.loc, .data = .{ .inline_identifier = value } };
                },
                .fragment => |fragment| {
                    if (fragment.len == 0) return Expr{ .loc = this.loc, .data = .{ .e_missing = E.Missing{} } };

                    var left = toExpr(fragment[0]);

                    if (fragment.len == 1) return left;

                    for (fragment[1..]) |item| {
                        const right = toExpr(item);
                        left = Expr.joinWithComma(left, right, default_allocator);
                    }

                    return left;
                },
                else => {
                    return Expr{ .loc = this.loc, .data = .{ .e_missing = .{} } };
                },
            }
        }

        // S.Import but with the path
        pub const ImportData = struct {
            import: S.Import,
            path: string,
        };

        pub const Data = union(Tag) {
            inline_false: void,
            inline_true: void,
            e_boolean: E.Boolean,
            fragment: []JSNode,

            e_super: E.Super,
            e_null: E.Null,
            e_number: E.Number,
            e_undefined: E.Undefined,
            e_new_target: E.NewTarget,
            e_import_meta: E.ImportMeta,
            e_missing: E.Missing,
            e_this: E.This,

            e_array: *E.Array,
            e_unary: *E.Unary,
            e_binary: *E.Binary,
            e_function: *E.Function,

            e_call: *E.Call,
            e_dot: *E.Dot,
            e_index: *E.Index,
            e_arrow: *E.Arrow,
            e_identifier: E.Identifier,
            e_import_identifier: E.ImportIdentifier,

            e_private_identifier: *E.PrivateIdentifier,
            e_jsx_element: *E.JSXElement,

            e_big_int: *E.BigInt,
            e_object: *E.Object,
            e_spread: *E.Spread,
            e_string: *E.String,
            e_template_part: *E.TemplatePart,
            e_template: *E.Template,

            e_await: *E.Await,
            e_yield: *E.Yield,
            e_if: *E.If,

            e_import: *E.Import,

            e_class: *E.Class,

            s_import: *ImportData,
            s_block: *S.Block,

            e_reg_exp: *E.RegExp,
            e_require_or_require_resolve: E.RequireOrRequireResolve,
            e_require: E.Require,

            g_property: *G.Property,

            inline_inject: []JSNode,
            inline_identifier: i32,

            pub fn callArgs(this: Data) ExprNodeList {
                if (this == .e_call)
                    return this.e_call.args
                else
                    return &[_]Expr{};
            }

            pub fn booleanValue(this: Data) bool {
                return switch (this) {
                    .inline_false => false,
                    .inline_true => true,
                    .e_boolean => this.e_boolean.value,
                };
            }
        };
        pub const Tag = enum(u8) {
            e_array,
            e_unary,
            e_binary,
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
            s_import,
            s_block,

            g_property,

            e_missing,
            e_boolean,
            e_super,
            e_null,
            e_number,
            e_undefined,

            inline_true,
            inline_false,
            inline_inject,
            inline_identifier,

            fragment,

            pub const ids: std.EnumArray(Tag, Expr.Data) = brk: {
                var list = std.EnumArray(Tag, Expr.Data).initFill(Expr.Data{ .e_number = E.Number{ .value = 0.0 } });
                const fields: []const std.builtin.TypeInfo.EnumField = @typeInfo(Tag).Enum.fields;
                for (fields) |field| {
                    list.set(@intToEnum(Tag, field.value), Expr.Data{ .e_number = E.Number{ .value = @intToFloat(f64, field.value) } });
                }

                break :brk list;
            };

            pub const names = std.ComptimeStringMap(Tag, .{
                .{ "array", Tag.e_array },
                .{ "unary", Tag.e_unary },
                .{ "binary", Tag.e_binary },
                .{ "bool", Tag.e_boolean },
                .{ "super", Tag.e_super },
                .{ "null", Tag.e_null },
                .{ "undefined", Tag.e_undefined },
                .{ "function", Tag.e_function },
                .{ "new_target", Tag.e_new_target },
                .{ "import-meta", Tag.e_import_meta },
                .{ "call", Tag.e_call },
                .{ "dot", Tag.e_dot },
                .{ "index", Tag.e_index },
                .{ "arrow", Tag.e_arrow },
                .{ "import-id", Tag.e_import_identifier },
                .{ "private-id", Tag.e_private_identifier },
                .{ "jsx", Tag.e_jsx_element },
                .{ "missing", Tag.e_missing },
                .{ "number", Tag.e_number },
                .{ "bigint", Tag.e_big_int },
                .{ "object", Tag.e_object },
                .{ "spread", Tag.e_spread },
                .{ "string", Tag.e_string },
                .{ "template-part", Tag.e_template_part },
                .{ "template", Tag.e_template },
                .{ "regex", Tag.e_reg_exp },
                .{ "await", Tag.e_await },
                .{ "yield", Tag.e_yield },
                .{ "if", Tag.e_if },
                .{ "dynamic", Tag.e_import },
                .{ "this", Tag.e_this },
                .{ "class", Tag.e_class },
                .{ "require", Tag.e_require },
                .{ "import", Tag.s_import },
                .{ "property", Tag.g_property },
                .{ "block", Tag.s_block },
                .{ "true", Tag.inline_true },
                .{ "false", Tag.inline_false },
                .{ "inject", Tag.inline_inject },

                .{ "id", Tag.inline_identifier },
            });

            pub const as_expr_tag: std.EnumArray(Tag, Expr.Tag) = brk: {
                var list = std.EnumArray(Tag, Expr.Tag).initFill(Expr.Tag.e_missing);
                list.set(Tag.e_array, Expr.Tag.e_array);
                list.set(Tag.e_unary, Expr.Tag.e_unary);
                list.set(Tag.e_binary, Expr.Tag.e_binary);
                list.set(Tag.e_boolean, Expr.Tag.e_boolean);
                list.set(Tag.e_super, Expr.Tag.e_super);
                list.set(Tag.e_null, Expr.Tag.e_null);
                list.set(Tag.e_undefined, Expr.Tag.e_undefined);
                list.set(Tag.e_function, Expr.Tag.e_function);
                list.set(Tag.e_new_target, Expr.Tag.e_new_target);
                list.set(Tag.e_import_meta, Expr.Tag.e_import_meta);
                list.set(Tag.e_call, Expr.Tag.e_call);
                list.set(Tag.e_dot, Expr.Tag.e_dot);
                list.set(Tag.e_index, Expr.Tag.e_index);
                list.set(Tag.e_arrow, Expr.Tag.e_arrow);
                list.set(Tag.e_identifier, Expr.Tag.e_identifier);
                list.set(Tag.e_import_identifier, Expr.Tag.e_import_identifier);
                list.set(Tag.e_private_identifier, Expr.Tag.e_private_identifier);
                list.set(Tag.e_jsx_element, Expr.Tag.e_jsx_element);
                list.set(Tag.e_missing, Expr.Tag.e_missing);
                list.set(Tag.e_number, Expr.Tag.e_number);
                list.set(Tag.e_big_int, Expr.Tag.e_big_int);
                list.set(Tag.e_object, Expr.Tag.e_object);
                list.set(Tag.e_spread, Expr.Tag.e_spread);
                list.set(Tag.e_string, Expr.Tag.e_string);
                list.set(Tag.e_template_part, Expr.Tag.e_template_part);
                list.set(Tag.e_template, Expr.Tag.e_template);
                list.set(Tag.e_reg_exp, Expr.Tag.e_reg_exp);
                list.set(Tag.e_await, Expr.Tag.e_await);
                list.set(Tag.e_yield, Expr.Tag.e_yield);
                list.set(Tag.e_if, Expr.Tag.e_if);
                list.set(Tag.e_require_or_require_resolve, Expr.Tag.e_require_or_require_resolve);
                list.set(Tag.e_import, Expr.Tag.e_import);
                list.set(Tag.e_this, Expr.Tag.e_this);
                list.set(Tag.e_class, Expr.Tag.e_class);
                list.set(Tag.e_require, Expr.Tag.e_require);
                break :brk list;
            };

            pub const to_expr_tag: std.EnumArray(Expr.Tag, Tag) = brk: {
                var list = std.EnumArray(Expr.Tag, Tag).initFill(Tag.wip);
                list.set(Expr.Tag.e_array, Tag.e_array);
                list.set(Expr.Tag.e_unary, Tag.e_unary);
                list.set(Expr.Tag.e_binary, Tag.e_binary);
                list.set(Expr.Tag.e_boolean, Tag.e_boolean);
                list.set(Expr.Tag.e_super, Tag.e_super);
                list.set(Expr.Tag.e_null, Tag.e_null);
                list.set(Expr.Tag.e_undefined, Tag.e_undefined);
                list.set(Expr.Tag.e_function, Tag.e_function);
                list.set(Expr.Tag.e_new_target, Tag.e_new_target);
                list.set(Expr.Tag.e_import_meta, Tag.e_import_meta);
                list.set(Expr.Tag.e_call, Tag.e_call);
                list.set(Expr.Tag.e_dot, Tag.e_dot);
                list.set(Expr.Tag.e_index, Tag.e_index);
                list.set(Expr.Tag.e_arrow, Tag.e_arrow);
                list.set(Expr.Tag.e_identifier, Tag.e_identifier);
                list.set(Expr.Tag.e_import_identifier, Tag.e_import_identifier);
                list.set(Expr.Tag.e_private_identifier, Tag.e_private_identifier);
                list.set(Expr.Tag.e_jsx_element, Tag.e_jsx_element);
                list.set(Expr.Tag.e_missing, Tag.e_missing);
                list.set(Expr.Tag.e_number, Tag.e_number);
                list.set(Expr.Tag.e_big_int, Tag.e_big_int);
                list.set(Expr.Tag.e_object, Tag.e_object);
                list.set(Expr.Tag.e_spread, Tag.e_spread);
                list.set(Expr.Tag.e_string, Tag.e_string);
                list.set(Expr.Tag.e_template_part, Tag.e_template_part);
                list.set(Expr.Tag.e_template, Tag.e_template);
                list.set(Expr.Tag.e_reg_exp, Tag.e_reg_exp);
                list.set(Expr.Tag.e_await, Tag.e_await);
                list.set(Expr.Tag.e_yield, Tag.e_yield);
                list.set(Expr.Tag.e_if, Tag.e_if);
                list.set(Expr.Tag.e_require_or_require_resolve, Tag.e_require_or_require_resolve);
                list.set(Expr.Tag.e_import, Tag.e_import);
                list.set(Expr.Tag.e_this, Tag.e_this);
                list.set(Expr.Tag.e_class, Tag.e_class);
                list.set(Expr.Tag.e_require, Tag.e_require);
                break :brk list;
            };

            pub const Validator = struct {
                pub const List = std.EnumArray(JSNode.Tag, bool);
                fn NewList(comptime valid_tags: anytype) List {
                    return comptime brk: {
                        var list = List.initFill(false);
                        for (std.meta.fieldNames(@TypeOf(valid_tags))) |index| {
                            const name = @tagName(@field(valid_tags, index));

                            if (!@hasField(JSNode.Tag, name)) {
                                @compileError(
                                    "JSNode.Tag does not have a \"" ++ name ++ "\" field. Valid fields are " ++ std.fmt.comptimePrint(
                                        "{s}",
                                        .{
                                            std.meta.fieldNames(@TypeOf(valid_tags)),
                                        },
                                    ),
                                );
                            }
                            list.set(@field(JSNode.Tag, name), true);
                        }

                        break :brk list;
                    };
                }

                pub const valid_object_tags = Tag.Validator.NewList(.{
                    .g_property,
                    .e_spread,
                    .e_identifier,
                    .e_import_identifier,
                    .e_index,
                    .e_call,
                    .e_private_identifier,
                    .e_dot,
                    .e_unary,
                    .e_binary,
                });

                pub const valid_inject_tags = Tag.Validator.NewList(.{
                    .s_import,
                });
            };

            pub const max_tag: u8 = brk: {
                const Enum: std.builtin.TypeInfo.Enum = @typeInfo(Tag).Enum;
                var max_value: u8 = 0;
                for (Enum.fields) |field| {
                    max_value = std.math.max(@as(u8, field.value), max_value);
                }
                break :brk max_value;
            };

            pub const min_tag: u8 = brk: {
                const Enum: std.builtin.TypeInfo.Enum = @typeInfo(Tag).Enum;
                var min: u8 = 255;
                for (Enum.fields) |field| {
                    min = std.math.min(@as(u8, field.value), min);
                }
                break :brk min;
            };
        };

        pub const JSNodeList = std.ArrayListUnmanaged(JSNode);

        pub fn NewJSXWriter(comptime P: type) type {
            return struct {
                const JSXWriter = @This();
                p: *P,
                bun_jsx_ref: Ref,
                log: *logger.Log,
                args: ExprList,
                bun_identifier: *E.Identifier,
                allocator: *std.mem.Allocator,
                parent_tag: Tag = Tag.e_missing,

                pub fn initWriter(p: *P, bun_identifier: *E.Identifier) JSXWriter {
                    return JSXWriter{
                        .p = p,
                        .log = p.log,
                        .bun_jsx_ref = p.bun_jsx_ref,
                        .args = ExprList.init(p.allocator),
                        .allocator = p.allocator,
                        .bun_identifier = bun_identifier,
                    };
                }

                fn hasPropertyNamed(props: []G.Property, comptime name: string) bool {
                    return indexOfPropertyByName(props, name) != null;
                }

                fn indexOfPropertyByName(props: []G.Property, comptime name: string) ?u32 {
                    for (props) |prop, i| {
                        const key = prop.key orelse continue;
                        if (key.data != .e_string or !key.data.e_string.isUTF8()) continue;
                        if (strings.eqlComptime(key.data.e_string.utf8, name)) return @intCast(u32, i);
                    }

                    return null;
                }

                fn propertyValueNamed(props: []G.Property, comptime name: string) ?Expr {
                    for (props) |prop| {
                        const key = prop.key orelse continue;
                        if (key.data != .e_string or !key.data.e_string.isUTF8()) continue;
                        if (strings.eqlComptime(key.data.e_string.utf8, name)) return prop.value;
                    }

                    return null;
                }

                pub fn writeExprType(self: *JSXWriter, expr: Expr) bool {}

                pub fn writeNodeType(self: *JSXWriter, tag: JSNode.Tag, props: []G.Property, children: []Expr, loc: logger.Loc) bool {
                    switch (tag) {

                        // <bool value={foo} />
                        // intended for dynamic values
                        Tag.e_boolean => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_boolean) });
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<bool> should have a \"value\" prop") catch unreachable;
                                self.args.append(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = loc }) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = loc };

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" shouldn't be a string") catch unreachable;
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = value.loc });
                                },
                                .e_boolean => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = true } }, .loc = value.loc });
                                },
                                // null and undefined literals are coerced to false
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = false } }, .loc = value.loc });
                                },
                                .e_number => {
                                    // Numbers are cooerced to booleans
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = value.data.e_number.value > 0.0 } }, .loc = value.loc });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" should be a bool, jsx element, number, identifier, index, call, private identifier, or dot") catch unreachable;
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_boolean = .{ .value = false } }, .loc = value.loc });
                                },
                            }

                            return true;
                        },
                        // <number value={1.0} />
                        Tag.e_number => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_number) });
                            const invalid_value = Expr{ .data = .{ .e_number = .{ .value = 0.0 } }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<number> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.log.addError(self.p.source, loc, "<number> should not be a string.") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                .e_boolean => {
                                    // Booleans are cooerced to numbers
                                    self.args.appendAssumeCapacity(
                                        Expr{
                                            .data = .{
                                                .e_number = E.Number{
                                                    .value = @intToFloat(f64, @boolToInt(value.data.e_boolean.value)),
                                                },
                                            },
                                            .loc = value.loc,
                                        },
                                    );
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null and undefined literals are coerced to 0
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_number = .{ .value = 0 } }, .loc = value.loc });
                                },
                                // <number>123</number>
                                .e_number => {
                                    // Numbers are cooerced to booleans
                                    self.args.appendAssumeCapacity(value);
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<number value> should be a number, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.e_big_int => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_big_int) });
                            const invalid_value = Expr{ .data = .{ .e_big_int = &E.BigInt.empty }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<big-int> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => |str| {
                                    self.args.appendAssumeCapacity(Expr.init(E.BigInt, E.BigInt{ .value = std.mem.trimRight(u8, str.utf8, "n") }, value.loc));
                                },
                                .e_big_int => |bigint| {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null and undefined literals are coerced to 0
                                .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .data = .{ .e_big_int = &E.BigInt.empty }, .loc = value.loc });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "\"value\" should be a BigInt, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.e_array => {
                            self.args.ensureUnusedCapacity(2 + children.len) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_array) });
                            const children_count = @truncate(u16, children.len);
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = E.Number{ .value = @intToFloat(f64, children_count) } } });

                            var old_parent = self.parent_tag;
                            self.parent_tag = Tag.e_array;
                            defer self.parent_tag = old_parent;
                            for (children) |child, i| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    // TODO: handle when simplification changes the expr type
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited_expr = self.p.visitExpr(child);
                                        switch (visited_expr.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElement(el.*)) return false;
                                            },
                                            .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited_expr) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, visited_expr.loc, "<array> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = visited_expr.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<array> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        Tag.e_object => {
                            self.args.ensureUnusedCapacity(2 + children.len) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_object) });
                            const children_count = @truncate(u16, children.len);
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = E.Number{ .value = @intToFloat(f64, children_count) } } });

                            var old_parent = self.parent_tag;
                            self.parent_tag = Tag.e_object;
                            defer self.parent_tag = old_parent;

                            for (children) |child, i| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_object_tags)) return false;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited = self.p.visitExpr(child);
                                        switch (visited.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_object_tags)) return false;
                                            },
                                            .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, child.loc, "<object> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<object> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },

                        Tag.g_property => {
                            const name_property = propertyValueNamed(props, "name");
                            const value_property = propertyValueNamed(props, "value");
                            const init_property = propertyValueNamed(props, "init");

                            var old_parent = self.parent_tag;
                            if (old_parent != .e_object) {
                                self.args.append(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.g_property) }) catch unreachable;
                            }

                            self.parent_tag = Tag.g_property;
                            defer self.parent_tag = old_parent;

                            var is_spread = false;
                            if (value_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "value should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            } else {
                                self.args.append(Expr{ .data = comptime Tag.ids.get(.e_undefined), .loc = loc }) catch unreachable;
                            }

                            if (init_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },

                                    .e_template, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "init should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            } else {
                                self.args.append(Expr{ .data = comptime Tag.ids.get(.e_undefined), .loc = loc }) catch unreachable;
                            }

                            if (name_property) |prop| {
                                switch (prop.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },
                                    .e_string => |str| {
                                        self.args.append(prop) catch unreachable;
                                    },
                                    .e_template, .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.append(self.p.visitExpr(prop)) catch unreachable;
                                    },
                                    else => {
                                        self.log.addError(self.p.source, prop.loc, "should only contain other jsx elements or a string") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = prop.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        Tag.e_string => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_string) });
                            const invalid_value = Expr{ .data = .{ .e_string = &E.String.empty }, .loc = loc };
                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<string> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };
                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_jsx_element => |el| {
                                    return self.writeElement(el.*);
                                },
                                .e_string => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // null is cooerced to "null"
                                .e_null => {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = &E.String.@"null" } });
                                },
                                // undefined is cooerced to "undefined"
                                .e_undefined => {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = &E.String.@"undefined" } });
                                },
                                .e_boolean => |boolean| {
                                    self.args.appendAssumeCapacity(Expr{ .loc = value.loc, .data = .{ .e_string = if (boolean.value) &E.String.@"true" else &E.String.@"false" } });
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<string value> should be a string, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }
                        },
                        Tag.e_reg_exp => {
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.e_reg_exp) });
                            const invalid_value = Expr{ .data = .{ .e_reg_exp = &E.RegExp.empty }, .loc = loc };

                            const value_i = indexOfPropertyByName(props, "value") orelse {
                                self.log.addError(self.p.source, loc, "<regex> should have a \"value\" prop") catch unreachable;
                                self.args.append(invalid_value) catch unreachable;
                                return true;
                            };

                            const value = props[value_i].value orelse invalid_value;

                            switch (value.data) {
                                .e_string => |str| {
                                    self.args.appendAssumeCapacity(Expr.init(E.RegExp, E.RegExp{ .value = str.utf8 }, value.loc));
                                },
                                .e_reg_exp => {
                                    self.args.appendAssumeCapacity(value);
                                },
                                .e_missing, .e_null, .e_undefined => {
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                                // these ones are not statically analyzable so we just leave them in as-is
                                .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(self.p.visitExpr(value));
                                },
                                // everything else is invalid
                                else => {
                                    self.log.addError(self.p.source, value.loc, "<regex value> should be a string, jsx element, identifier, index, call, private identifier, or dot expression") catch unreachable;
                                    self.args.appendAssumeCapacity(invalid_value);
                                },
                            }

                            return true;
                        },
                        Tag.inline_inject => {

                            // For <inject>, immediate children must be JSX types or arrays
                            if (props.len > 0) {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "<inject> does not accept props",
                                ) catch unreachable;
                            }

                            var count: usize = children.len;
                            for (children) |c| {
                                count += switch (c.data) {
                                    .e_jsx_element => if (c.data.e_jsx_element.tag != null) 1 else brk: {
                                        break :brk c.data.e_jsx_element.children.len;
                                    },
                                    else => 1,
                                };
                            }
                            self.args.ensureUnusedCapacity(2 + count) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.inline_inject) });
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = .{ .value = @intToFloat(f64, @intCast(u32, children.len)) } } });

                            const old_parent_tag = self.parent_tag;
                            self.parent_tag = Tag.inline_inject;
                            defer self.parent_tag = old_parent_tag;

                            for (children) |child| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElementWithValidTagList(el.*, comptime Tag.Validator.valid_inject_tags)) return false;
                                    },
                                    else => {
                                        self.args.append(self.p.visitExpr(child)) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },

                        Tag.inline_identifier => {
                            // id only accepts "to" and it must be a int32
                            self.args.ensureUnusedCapacity(2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.inline_identifier) });

                            if (propertyValueNamed(props, "to")) |prop| {
                                switch (prop.data) {
                                    .e_number, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(self.p.visitExpr(prop));
                                    },
                                    else => {
                                        self.log.addError(
                                            self.p.source,
                                            prop.loc,
                                            "\"to\" prop must be a number",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(prop);
                                    },
                                }
                            } else {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "\"to\" prop is required",
                                ) catch unreachable;
                                self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = .{ .e_number = .{ .value = 0 } } });
                            }

                            return true;
                        },

                        Tag.s_import => {
                            var p = self.p;
                            const default_property_ = propertyValueNamed(props, "default");
                            const path_property = propertyValueNamed(props, "path") orelse {
                                self.log.addError(
                                    self.p.source,
                                    loc,
                                    "<import> must have a path",
                                ) catch unreachable;
                                return false;
                            };
                            const namespace_ = propertyValueNamed(props, "namespace");

                            const items_count: u32 = 1 +
                                @intCast(u32, @boolToInt(namespace_ != null));

                            self.args.ensureUnusedCapacity(items_count) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.s_import) });

                            switch (path_property.data) {
                                .e_string => {
                                    self.args.appendAssumeCapacity(path_property);
                                },
                                .e_jsx_element => {
                                    self.log.addError(
                                        self.p.source,
                                        path_property.loc,
                                        "import path cannot be JSX",
                                    ) catch unreachable;
                                    return false;
                                },
                                .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                    self.args.appendAssumeCapacity(p.visitExpr(path_property));
                                },
                                else => {
                                    self.log.addError(
                                        self.p.source,
                                        path_property.loc,
                                        "import path must be a string or identifier",
                                    ) catch unreachable;
                                    self.args.appendAssumeCapacity(path_property);
                                },
                            }

                            if (namespace_) |namespace_expr| {
                                switch (namespace_expr.data) {
                                    .e_string => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "import * as is not supported in macros yet",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(p.visitExpr(namespace_expr));
                                        return false;
                                    },
                                    .e_jsx_element => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "namespace cannot be JSX",
                                        ) catch unreachable;
                                        return false;
                                    },

                                    .e_object, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(p.visitExpr(namespace_expr));
                                    },

                                    else => {
                                        self.log.addError(
                                            self.p.source,
                                            namespace_expr.loc,
                                            "namespace must be an object shaped like {\"fromName\": \"toName\"}",
                                        ) catch unreachable;
                                        self.args.appendAssumeCapacity(namespace_expr);
                                    },
                                }
                            } else {
                                self.args.appendAssumeCapacity(Expr{
                                    .loc = loc,
                                    .data = .{
                                        .e_null = E.Null{},
                                    },
                                });
                            }

                            if (default_property_) |default| {
                                switch (default.data) {
                                    .e_string => {
                                        self.args.appendAssumeCapacity(default);
                                    },
                                    .e_jsx_element => {
                                        self.log.addError(
                                            self.p.source,
                                            default.loc,
                                            "default import cannot be JSX",
                                        ) catch unreachable;
                                        return false;
                                    },
                                    .e_template, .e_if, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        self.args.appendAssumeCapacity(p.visitExpr(default));
                                    },
                                    else => {
                                        self.log.addError(self.p.source, default.loc, "default import must be a string or identifier") catch unreachable;
                                        self.args.appendAssumeCapacity(default);
                                    },
                                }
                            } else {
                                self.args.appendAssumeCapacity(Expr{
                                    .loc = loc,
                                    .data = .{
                                        .e_null = E.Null{},
                                    },
                                });
                            }

                            return true;
                        },
                        Tag.fragment => {
                            self.args.ensureUnusedCapacity(children.len + 2) catch unreachable;
                            self.args.appendAssumeCapacity(Expr{ .loc = loc, .data = comptime Tag.ids.get(Tag.fragment) });
                            self.args.appendAssumeCapacity(Expr{
                                .loc = loc,
                                .data = .{
                                    .e_number = E.Number{
                                        .value = @intToFloat(f64, children.len),
                                    },
                                },
                            });

                            for (children) |child, i| {
                                switch (child.data) {
                                    .e_jsx_element => |el| {
                                        if (!self.writeElement(el.*)) return false;
                                    },

                                    .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                        const visited = self.p.visitExpr(child);
                                        switch (visited.data) {
                                            .e_jsx_element => |el| {
                                                if (!self.writeElement(el.*)) return false;
                                            },
                                            .e_if, .e_spread, .e_identifier, .e_import_identifier, .e_index, .e_call, .e_private_identifier, .e_dot, .e_unary, .e_binary => {
                                                self.args.append(visited) catch unreachable;
                                            },
                                            else => {
                                                self.log.addError(self.p.source, child.loc, "<> should only contain other jsx elements") catch unreachable;
                                                self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                            },
                                        }
                                    },
                                    else => {
                                        self.log.addError(self.p.source, child.loc, "<> should only contain other jsx elements") catch unreachable;
                                        self.args.append(Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = child.loc }) catch unreachable;
                                    },
                                }
                            }

                            return true;
                        },
                        // Tag.e_jsx_element => unreachable,
                        // Tag.e_identifier => {
                        //     // self.args.ensureUnusedCapacity(2) catch unreachable;
                        //     Global.notimpl();
                        // },
                        // Tag.e_import_identifier => {
                        //     Global.notimpl();
                        // },
                        // Tag.e_private_identifier => {
                        //     Global.notimpl();
                        // },

                        // Tag.e_unary => {

                        // },
                        // Tag.e_binary => {},

                        // Tag.e_function => {},
                        // Tag.e_new_target => {},
                        // Tag.e_import_meta => {},
                        // Tag.e_call => {},
                        // Tag.e_dot => {},
                        // Tag.e_index => {},
                        // Tag.e_arrow => {},

                        // Tag.e_spread => {},

                        // Tag.e_template_part => {},
                        // Tag.e_template => {},
                        // Tag.e_regex => {},
                        // Tag.e_await => {},
                        // Tag.e_yield => {},
                        // Tag.e_if => {},
                        // Tag.e_import => {},

                        // Tag.e_class => {},
                        // Tag.e_require => {},
                        // Tag.s_import => {},

                        // Tag.s_block => {},

                        // The valueless ones
                        Tag.e_super, Tag.e_null, Tag.e_undefined, Tag.e_missing, Tag.inline_true, Tag.inline_false, Tag.e_this => {
                            self.args.append(Expr{ .loc = loc, .data = Tag.ids.get(tag) }) catch unreachable;
                        },
                        else => Global.panic("Tag \"{s}\" is not implemented yet.", .{@tagName(tag)}),
                    }

                    return true;
                }

                pub fn writeFunctionCall(self: *JSXWriter, element: E.JSXElement) Expr {
                    if (element.tag) |tag_expr| {
                        switch (tag_expr.data) {
                            .e_string => |str| {
                                self.p.recordUsage(self.bun_jsx_ref);
                                _ = self.writeElement(element);
                                var call_args = self.p.allocator.alloc(Expr, 1) catch unreachable;
                                call_args[0] = Expr.init(E.Array, E.Array{ .items = self.args.items }, tag_expr.loc);

                                return Expr.init(
                                    E.Call,
                                    E.Call{
                                        .target = Expr{
                                            .data = .{
                                                .e_identifier = self.bun_identifier.*,
                                            },
                                            .loc = tag_expr.loc,
                                        },
                                        .can_be_unwrapped_if_unused = true,
                                        .args = call_args,
                                    },
                                    tag_expr.loc,
                                );
                            },
                            else => Global.panic("Not implemented yet top-level jsx element: {s}", .{@tagName(tag_expr.data)}),
                        }
                    } else {
                        const loc = logger.Loc.Empty;
                        self.p.recordUsage(self.bun_jsx_ref);
                        _ = self.writeNodeType(JSNode.Tag.fragment, element.properties, element.children, loc);
                        var call_args = self.p.allocator.alloc(Expr, 1) catch unreachable;
                        call_args[0] = Expr.init(E.Array, E.Array{ .items = self.args.items }, loc);

                        return Expr.init(
                            E.Call,
                            E.Call{
                                .target = Expr{
                                    .data = .{
                                        .e_identifier = self.bun_identifier.*,
                                    },
                                    .loc = loc,
                                },
                                .can_be_unwrapped_if_unused = true,
                                .args = call_args,
                            },
                            loc,
                        );
                    }

                    return Expr{ .data = .{ .e_missing = .{} }, .loc = logger.Loc.Empty };
                }

                pub fn writeRootElement(self: JSXWriter, element: E.JSXElement) Expr {
                    var tag = element.tag orelse E.Array{ .items = &.{} };
                    switch (tag.data) {
                        .e_string, .e_array => {},
                        else => {},
                    }
                }

                fn writeElementWithValidTagList(self: *JSXWriter, element: E.JSXElement, comptime valid_tags: Tag.Validator.List) bool {
                    const tag_expr = element.tag orelse return false;
                    if (tag_expr.data != .e_string) return false;
                    const str = tag_expr.data.e_string;
                    var p = self.p;

                    const node_type: JSNode.Tag = JSNode.Tag.names.get(str.utf8) orelse {
                        if (!str.isUTF8()) {
                            self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{strings.toUTF8Alloc(self.p.allocator, str.value)}) catch unreachable;
                        } else {
                            self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{str.utf8}) catch unreachable;
                        }
                        return false;
                    };

                    if (!valid_tags.get(node_type)) {
                        self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid here", .{str.utf8}) catch unreachable;
                    }

                    return self.writeNodeType(node_type, element.properties, element.children, tag_expr.loc);
                }

                pub fn writeElement(self: *JSXWriter, element: E.JSXElement) bool {
                    const tag_expr = element.tag orelse return false;
                    if (tag_expr.data != .e_string) return false;
                    const str = tag_expr.data.e_string;
                    var p = self.p;

                    const node_type: JSNode.Tag = JSNode.Tag.names.get(str.utf8) orelse {
                        if (!str.isUTF8()) {
                            self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{strings.toUTF8Alloc(self.p.allocator, str.value)}) catch unreachable;
                        } else {
                            self.log.addErrorFmt(p.source, tag_expr.loc, p.allocator, "Tag \"{s}\" is invalid", .{str.utf8}) catch unreachable;
                        }
                        return false;
                    };

                    return self.writeNodeType(node_type, element.properties, element.children, tag_expr.loc);
                }
            };
        }

        pub const SymbolMap = struct {
            pub fn generateImportHash(name: string, path: string) i32 {
                var hasher = std.hash.Wyhash.init(8);
                hasher.update(path);
                hasher.update("#");
                hasher.update(name);
                return @bitCast(i32, @truncate(u32, hasher.final()));
            }
        };

        pub const Writer = struct {
            log: *logger.Log,
            exception: JSCBase.ExceptionValueRef = null,
            ctx: js.JSContextRef,
            errored: bool = false,
            allocator: *std.mem.Allocator,
            loc: logger.Loc,
            args_value: JSC.JSValue,
            args_i: u32 = 0,
            args_len: u32 = 0,

            inject: std.ArrayList(JSNode),

            pub inline fn eatArg(this: *Writer) ?JSC.JSValue {
                if (this.args_i >= this.args_len) return null;
                const i = this.args_i;

                this.args_i += 1;
                return JSC.JSObject.getIndex(this.args_value, JavaScript.VirtualMachine.vm.global, i);
            }

            pub inline fn peekArg(this: *Writer) ?JSC.JSValue {
                if (this.args_i >= this.args_len) return null;
                return JSC.JSObject.getIndex(this.args_value, JavaScript.VirtualMachine.vm.global, this.args_i);
            }

            pub inline fn nextJSValue(this: *Writer) ?JSC.JSValue {
                return this.eatArg();
            }

            pub const TagOrJSNode = union(TagOrNodeType) {
                tag: JSNode.Tag,
                node: JSNode,
                invalid: void,

                pub const TagOrNodeType = enum {
                    tag,
                    node,
                    invalid,
                };

                pub fn fromJSValueRefNoValidate(ctx: js.JSContextRef, value: js.JSValueRef) TagOrJSNode {
                    switch (js.JSValueGetType(ctx, value)) {
                        js.JSType.kJSTypeNumber => {
                            const tag_int = @floatToInt(u8, JSC.JSValue.fromRef(value).asNumber());
                            if (tag_int < Tag.min_tag or tag_int > Tag.max_tag) {
                                return TagOrJSNode{ .invalid = .{} };
                            }
                            return TagOrJSNode{ .tag = @intToEnum(JSNode.Tag, tag_int) };
                        },
                        js.JSType.kJSTypeObject => {
                            if (JSCBase.GetJSPrivateData(JSNode, value)) |node| {
                                return TagOrJSNode{ .node = node.* };
                            }

                            return TagOrJSNode{ .invalid = .{} };
                        },
                        else => {
                            return TagOrJSNode{ .invalid = .{} };
                        },
                    }
                }

                pub fn fromJSValueRef(writer: *Writer, ctx: js.JSContextRef, value: js.JSValueRef) TagOrJSNode {
                    switch (js.JSValueGetType(ctx, value)) {
                        js.JSType.kJSTypeNumber => {
                            const tag_int = @floatToInt(u8, JSC.JSValue.fromRef(value).asNumber());
                            if (tag_int < Tag.min_tag or tag_int > Tag.max_tag) {
                                throwTypeError(ctx, "Node type has invalid value", writer.exception);
                                writer.errored = true;
                                return TagOrJSNode{ .invalid = .{} };
                            }
                            return TagOrJSNode{ .tag = @intToEnum(JSNode.Tag, tag_int) };
                        },
                        js.JSType.kJSTypeObject => {
                            if (JSCBase.GetJSPrivateData(JSNode, value)) |node| {
                                return TagOrJSNode{ .node = node.* };
                            }

                            return TagOrJSNode{ .invalid = .{} };
                        },
                        else => {
                            throwTypeError(writer.ctx, "Invalid Bun AST", writer.exception);
                            return TagOrJSNode{ .invalid = .{} };
                        },
                    }
                }

                pub fn fromJSValue(writer: *Writer, value: JSC.JSValue) TagOrJSNode {
                    return fromJSValueRef(writer, JavaScript.VirtualMachine.vm.global.ref(), value.asRef());
                }
            };

            fn writeProperty(writer: *Writer, property: *G.Property) bool {

                // Property is
                // value
                // initializer
                // if property value is an e.spread, then key is skipped
                // key

                // value is first
                var expect_key = true;
                switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                    TagOrJSNode.tag => |tag| {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                        property.value = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                        property.flags.is_spread = expr.data == .e_spread;
                        expect_key = property.value == null or !property.flags.is_spread;
                    },
                    TagOrJSNode.node => |node| {
                        const expr = node.toExpr();
                        property.value = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                        property.flags.is_spread = expr.data == .e_spread;
                        expect_key = property.value == null or !property.flags.is_spread;
                    },
                    TagOrJSNode.invalid => {
                        return false;
                    },
                }

                switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                    TagOrJSNode.tag => |tag| {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                        property.initializer = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                    },
                    TagOrJSNode.node => |node| {
                        const expr = node.toExpr();
                        property.initializer = switch (expr.data) {
                            .e_missing, .e_undefined => null,
                            else => expr,
                        };
                    },
                    TagOrJSNode.invalid => {
                        return false;
                    },
                }

                if (expect_key) {
                    var next_arg = writer.peekArg() orelse return false;
                    // its okay for property keys to literally be strings
                    // <property name="foo">
                    if (next_arg.isString()) {
                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_string = &E.String.empty } };
                        if (!writer.writeFromJSWithTagInExpr(JSNode.Tag.e_string, &expr)) return false;
                        property.key = expr;
                    } else {
                        switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                            TagOrJSNode.tag => |tag| {
                                var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };
                                if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return false;
                                property.key = expr;
                            },
                            TagOrJSNode.node => |node| {
                                property.key = node.toExpr();
                            },
                            TagOrJSNode.invalid => {
                                return false;
                            },
                        }
                    }
                }

                return true;
            }

            fn writeFromJSWithTagInNode(writer: *Writer, tag: JSNode.Tag) bool {
                switch (tag) {
                    .s_import => {
                        const path_arg = writer.eatArg() orelse return false;
                        // path should be a plain old JS string
                        if (!path_arg.isString()) {
                            throwTypeError(writer.ctx, "Import path must be a string", writer.exception);
                            return false;
                        }

                        var path_zig_string = JSC.ZigString.Empty;
                        path_arg.toZigString(&path_zig_string, JavaScript.VirtualMachine.vm.global);
                        const import_path = path_zig_string.trimmedSlice();

                        if (import_path.len == 0) {
                            throwTypeError(writer.ctx, "Import path must be a non-empty string", writer.exception);
                            return false;
                        }

                        var import = ImportData{
                            .import = S.Import{
                                .namespace_ref = Ref.None,
                                .import_record_index = std.math.maxInt(u32),
                            },
                            .path = import_path,
                        };
                        var import_namespace_arg = writer.eatArg() orelse return false;
                        var import_default_arg = writer.eatArg() orelse return false;

                        const has_default = import_default_arg.isString();

                        var import_default_name_string = JSC.ZigString.Empty;
                        if (has_default) import_default_arg.toZigString(&import_default_name_string, JavaScript.VirtualMachine.vm.global);

                        const import_default_name = import_default_name_string.slice();

                        var import_item_i: u32 = 0;

                        // TODO: verify it's safe to reuse the memory here
                        if (!import_namespace_arg.isNull()) {
                            if (import_namespace_arg.isObject()) {
                                throwTypeError(writer.ctx, "Import namespace should be an object where the keys are import names and the values are aliases.", writer.exception);
                                return false;
                            }

                            const JSLexer = @import("./js_lexer.zig");
                            var array = js.JSObjectCopyPropertyNames(writer.ctx, import_namespace_arg.asObjectRef());
                            defer js.JSPropertyNameArrayRelease(array);
                            const property_names_count = @intCast(u32, js.JSPropertyNameArrayGetCount(array));
                            var iter = JSCBase.JSPropertyNameIterator{
                                .array = array,
                                .count = @intCast(u32, property_names_count),
                            };

                            import.import.items = writer.allocator.alloc(
                                ClauseItem,
                                @intCast(u32, @boolToInt(has_default)) + property_names_count,
                            ) catch return false;

                            var object_ref = import_namespace_arg.asObjectRef();

                            while (iter.next()) |prop| {
                                const ptr = js.JSStringGetCharacters8Ptr(prop);
                                const len = js.JSStringGetLength(prop);
                                const name = ptr[0..len];
                                const i = iter.i - 1;

                                const property_value = JSC.JSValue.fromRef(js.JSObjectGetProperty(writer.ctx, object_ref, prop, writer.exception));

                                if (!property_value.isString()) {
                                    return false;
                                }

                                var property_value_zig_string = JSC.ZigString.Empty;
                                property_value.toZigString(&property_value_zig_string, JavaScript.VirtualMachine.vm.global);

                                const alias = property_value_zig_string.slice();

                                if (!JSLexer.isIdentifier(alias)) throwTypeError(writer.ctx, "import alias must be an identifier", writer.exception);

                                import.import.items[import_item_i] = ClauseItem{
                                    .alias = name,
                                    .original_name = alias,
                                    .name = .{ .loc = writer.loc, .ref = Ref.None },
                                    .alias_loc = writer.loc,
                                };

                                import_item_i += 1;
                            }
                        } else {
                            import.import.items = writer.allocator.alloc(
                                ClauseItem,
                                @intCast(u32, @boolToInt(has_default)),
                            ) catch return false;
                        }

                        if (has_default) {
                            import.import.items[import_item_i] = ClauseItem{
                                .alias = "default",
                                .name = .{ .loc = writer.loc, .ref = Ref.None },
                                .original_name = import_default_name,
                                .alias_loc = writer.loc,
                            };
                            import_item_i += 1;
                        }

                        import.import.items = import.import.items[0..import_item_i];

                        var import_ = writer.allocator.create(ImportData) catch return false;
                        import_.* = import;
                        writer.inject.append(JSNode{ .data = .{ .s_import = import_ }, .loc = writer.loc }) catch unreachable;
                        return true;
                    },
                    else => {
                        return false;
                    },
                }
            }

            fn writeFromJSWithTagInExpr(writer: *Writer, tag: JSNode.Tag, expr: *Expr) bool {
                switch (tag) {
                    .e_array => {
                        // var e_array: E.Array = E.Array{ .items = writer.allocator.alloc(E.Array, args.len) catch return false };
                        var count = (writer.nextJSValue() orelse return false).toU32();
                        var i: @TypeOf(count) = 0;
                        var items = ExprList.initCapacity(writer.allocator, count) catch unreachable;

                        while (i < count) {
                            var nextArg = writer.eatArg() orelse return false;
                            if (js.JSValueIsArray(writer.ctx, nextArg.asRef())) {
                                const extras = nextArg.getLengthOfArray(JavaScript.VirtualMachine.vm.global);
                                count += std.math.max(@truncate(@TypeOf(count), extras), 1) - 1;
                                items.ensureUnusedCapacity(extras) catch unreachable;
                                items.expandToCapacity();
                                var new_writer = writer.*;
                                new_writer.args_i = 0;
                                new_writer.args_len = extras;
                                new_writer.args_value = nextArg;

                                while (new_writer.nextJSValue()) |value| {
                                    defer i += 1;
                                    switch (TagOrJSNode.fromJSValue(&new_writer, value)) {
                                        TagOrJSNode.tag => |tag_| {
                                            if (!new_writer.writeFromJSWithTagInExpr(
                                                tag_,
                                                &items.items[i],
                                            )) return false;
                                        },
                                        TagOrJSNode.node => |node_| {
                                            const node: JSNode = node_;
                                            switch (node.data) {
                                                JSNode.Tag.s_import => |import| {
                                                    return false;
                                                },
                                                else => {
                                                    items.items[i] = node.toExpr();
                                                },
                                            }
                                        },
                                        TagOrJSNode.invalid => {
                                            return false;
                                        },
                                    }
                                }
                            } else {
                                defer i += 1;

                                switch (TagOrJSNode.fromJSValue(writer, nextArg)) {
                                    TagOrJSNode.tag => |tag_| {
                                        if (!writer.writeFromJSWithTagInExpr(tag_, &items.items[i])) return false;
                                    },
                                    TagOrJSNode.node => |node_| {
                                        const node: JSNode = node_;
                                        switch (node.data) {
                                            JSNode.Tag.s_import => |import| {
                                                return false;
                                            },
                                            else => {
                                                items.items[i] = node.toExpr();
                                            },
                                        }
                                    },
                                    TagOrJSNode.invalid => {
                                        return false;
                                    },
                                }
                            }
                        }
                        expr.* = Expr.init(E.Array, E.Array{ .items = items.items[0..i] }, writer.loc);
                        return true;
                    },
                    .e_boolean => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{
                            .value = JSC.JSValue.toBoolean(writer.nextJSValue() orelse return false),
                        } } };
                        return true;
                    },
                    .inline_true => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{ .value = true } } };
                        return true;
                    },
                    .inline_false => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_boolean = .{ .value = false } } };
                        return true;
                    },
                    .e_null => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };
                        return true;
                    },
                    .e_undefined => {
                        expr.* = Expr{ .loc = writer.loc, .data = .{ .e_undefined = E.Undefined{} } };
                        return true;
                    },
                    .e_number => {
                        expr.* = Expr{
                            .loc = writer.loc,
                            .data = .{
                                .e_number = .{
                                    .value = JSC.JSValue.asNumber(writer.nextJSValue() orelse return false),
                                },
                            },
                        };
                        return true;
                    },
                    .e_string => {
                        var wtf_string = JSC.JSValue.toWTFString(writer.nextJSValue() orelse return false, JavaScript.VirtualMachine.vm.global);
                        if (wtf_string.isEmpty()) {
                            expr.* = Expr{
                                .loc = writer.loc,
                                .data = .{
                                    .e_string = &E.String.empty,
                                },
                            };
                        } else if (wtf_string.is8Bit()) {
                            expr.* = Expr.init(E.String, E.String{ .utf8 = wtf_string.characters8()[0..wtf_string.length()] }, writer.loc);
                        } else if (wtf_string.is16Bit()) {
                            expr.* = Expr.init(E.String, E.String{ .value = wtf_string.characters16()[0..wtf_string.length()] }, writer.loc);
                        } else {
                            unreachable;
                        }
                        return true;
                    },
                    .e_reg_exp => {
                        var jsstring = js.JSValueToStringCopy(writer.ctx, (writer.eatArg() orelse return false).asRef(), writer.exception);
                        defer js.JSStringRelease(jsstring);

                        const len = js.JSStringGetLength(jsstring);
                        var str = writer.allocator.alloc(u8, len + 1) catch unreachable;
                        const outlen = js.JSStringGetUTF8CString(jsstring, str.ptr, len + 1);
                        expr.* = Expr.init(E.RegExp, E.RegExp{ .value = str[0..outlen] }, writer.loc);
                        return true;
                    },
                    .e_object => {
                        const len = (writer.nextJSValue() orelse return false).toU32();

                        var properties = writer.allocator.alloc(G.Property, len) catch return false;
                        var property_i: u32 = 0;

                        while (property_i < properties.len) : (property_i += 1) {
                            switch (TagOrJSNode.fromJSValue(writer, writer.eatArg() orelse return false)) {
                                TagOrJSNode.tag => |tag_| {
                                    if (tag_ != JSNode.Tag.g_property) return false;

                                    if (!writer.writeProperty(
                                        &properties[property_i],
                                    )) return false;
                                },
                                TagOrJSNode.node => |node_| {
                                    const node: JSNode = node_;
                                    switch (node.data) {
                                        .g_property => |property| {
                                            properties[property_i] = property.*;
                                        },
                                        else => {
                                            return false;
                                        },
                                    }
                                },
                                TagOrJSNode.invalid => {
                                    return false;
                                },
                            }
                        }

                        return true;
                    },
                    .inline_identifier => {
                        const to = (writer.nextJSValue() orelse return false).toInt32();
                        expr.* = Expr{ .data = .{ .inline_identifier = to }, .loc = writer.loc };
                        return true;
                    },

                    else => {
                        return false;
                    },

                    // .e_call => {},

                    // .e_dot => {},
                    // .e_index => {},
                    // .e_identifier => {},
                    // .e_import_identifier => {},

                    // .e_spread => {},

                    // .e_template_part => {},
                    // .e_template => {},

                    // .e_await => {},
                    // .e_yield => {},
                    // .e_if => {},
                    // .e_import => {},
                    // .e_this => {},
                    // .e_class => {},
                    // s_import => {},
                }

                return false;
            }

            pub fn writeFromJS(writer: *Writer) ?JSNode {
                switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, (writer.eatArg() orelse return null).asRef())) {
                    TagOrJSNode.tag => |tag| {
                        if (tag == Tag.inline_inject) {
                            const count: u32 = (writer.eatArg() orelse return null).toU32();
                            var i: u32 = 0;
                            while (i < count) : (i += 1) {
                                const next_value = (writer.eatArg() orelse return null);
                                const next_value_ref = next_value.asRef();
                                if (js.JSValueIsArray(writer.ctx, next_value_ref)) {
                                    var iter = JSC.JSArrayIterator.init(next_value, JavaScript.VirtualMachine.vm.global);
                                    while (iter.next()) |current_value| {
                                        switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, current_value.asRef())) {
                                            .node => |node| {
                                                if (node.data != .s_import) {
                                                    throwTypeError(writer.ctx, "inject must only contain imports", writer.exception);
                                                    return null;
                                                }
                                                writer.inject.append(node) catch unreachable;
                                            },
                                            .tag => |t| {
                                                if (!writer.writeFromJSWithTagInNode(t)) return null;
                                            },
                                            .invalid => {
                                                return null;
                                            },
                                        }
                                    }
                                    i += 1;
                                    continue;
                                } else {
                                    switch (TagOrJSNode.fromJSValueRef(writer, writer.ctx, next_value_ref)) {
                                        .tag => |tag2| {
                                            if (!writer.writeFromJSWithTagInNode(tag2)) return null;
                                        },
                                        TagOrJSNode.node => |node| {
                                            writer.inject.append(node) catch unreachable;
                                        },
                                        TagOrJSNode.invalid => {
                                            return null;
                                        },
                                    }
                                }
                            }
                            return JSNode{ .data = .{ .inline_inject = writer.inject.toOwnedSlice() }, .loc = writer.loc };
                        }

                        if (tag == Tag.s_import) {
                            if (!writer.writeFromJSWithTagInNode(tag)) return null;
                            return writer.inject.items[0];
                        }

                        if (tag == Tag.fragment) {
                            const count: u32 = (writer.eatArg() orelse return null).toU32();
                            // collapse single-item fragments
                            switch (count) {
                                0 => {
                                    return JSNode{ .data = .{ .fragment = &[_]JSNode{} }, .loc = writer.loc };
                                },

                                1 => {
                                    var _node = writer.writeFromJS() orelse return null;
                                    while (true) {
                                        switch (_node.data) {
                                            .fragment => |fragment| {
                                                if (fragment.len == 1) {
                                                    _node = fragment[0];
                                                    continue;
                                                }

                                                return _node;
                                            },
                                            else => {
                                                return _node;
                                            },
                                        }
                                    }
                                },
                                else => {},
                            }

                            var i: u32 = 0;
                            var fragment = std.ArrayList(JSNode).initCapacity(writer.allocator, count) catch return null;
                            while (i < count) : (i += 1) {
                                const node = writer.writeFromJS() orelse return null;
                                fragment.append(node) catch unreachable;
                            }

                            return JSNode{ .data = .{ .fragment = fragment.toOwnedSlice() }, .loc = writer.loc };
                        }

                        var expr: Expr = Expr{ .loc = writer.loc, .data = .{ .e_null = E.Null{} } };

                        if (!writer.writeFromJSWithTagInExpr(tag, &expr)) return null;
                        return JSNode.initExpr(expr);
                    },
                    TagOrJSNode.node => |node| {
                        return node;
                    },
                    TagOrJSNode.invalid => {
                        return null;
                    },
                }
            }
        };

        // pub fn isInstanceOf(
        //     ctx: js.JSContextRef,
        //     obj: js.JSObjectRef,
        //     value: js.JSValueRef,
        //     exception: js.ExceptionRef,
        // ) bool {
        //     js.JSValueToNumber(ctx, value, exception);
        // }

        fn throwTypeError(ctx: js.JSContextRef, comptime msg: string, exception: js.ExceptionRef) void {
            JSCBase.JSError(JSCBase.getAllocator(ctx), msg, .{}, ctx, exception);
        }

        pub const BunJSXCallbackFunction = JSCBase.NewClass(
            void,
            .{ .name = "bunJSX" },
            .{
                .call = .{
                    .rfn = createFromJavaScript,
                    .ro = true,
                },
                .isNodeType = .{
                    .rfn = isNodeType,
                    .ro = true,
                },
            },
            .{},
        );

        pub fn isNodeType(
            this: void,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            if (arguments.len != 2) {
                throwTypeError(ctx, "bunJSX.isNodeType() requires 2 arguments", exception);
                return null;
            }

            const TagOrNodeType = Writer.TagOrJSNode.TagOrNodeType;

            const left = Writer.TagOrJSNode.fromJSValueRefNoValidate(ctx, arguments[0]);
            const right = Writer.TagOrJSNode.fromJSValueRefNoValidate(ctx, arguments[1]);

            if (left == TagOrNodeType.invalid or right == TagOrNodeType.invalid) {
                return js.JSValueMakeBoolean(ctx, false);
            }

            if (left == TagOrNodeType.node and right == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, left.node.data) == @as(Tag, right.node.data));
            }

            if (left == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, left.node.data) == right.tag);
            }

            if (right == TagOrNodeType.node) {
                return js.JSValueMakeBoolean(ctx, @as(Tag, right.node.data) == left.tag);
            }

            unreachable;
        }

        pub fn createFromJavaScript(
            this: void,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            if (arguments.len != 1 or !js.JSValueIsArray(ctx, arguments[0])) {
                throwTypeError(ctx, "bunJSX requires one array argument", exception);
                return null;
            }

            js.JSValueProtect(ctx, arguments[0]);
            defer Output.flush();
            const args_value = JSC.JSValue.fromRef(arguments[0]);
            var writer = Writer{
                .inject = std.ArrayList(JSNode).init(JSCBase.getAllocator(ctx)),
                .log = JavaScript.VirtualMachine.vm.log,
                .ctx = ctx,
                .loc = logger.Loc.Empty,
                .allocator = JSCBase.getAllocator(ctx),
                .exception = exception,
                .args_value = args_value,
                .args_len = args_value.getLengthOfArray(JavaScript.VirtualMachine.vm.global),
                .args_i = 0,
                .errored = false,
            };

            if (writer.writeFromJS()) |node| {
                var ptr = writer.allocator.create(JSNode) catch unreachable;
                ptr.* = node;
                var result = JSNode.Class.make(ctx, ptr);
                js.JSValueProtect(ctx, result);
                return result;
            }

            return null;
        }
    };

    pub const LazyPropertiesObject = struct {
        node: JSNode,

        pub const Class = JSCBase.NewClass(
            LazyPropertiesObject,
            .{
                .name = "LazyPropertiesObject",
                .read_only = true,
            },
            .{
                .getProperty = .{
                    .rfn = getProperty,
                },
                .hasProperty = .{
                    .rfn = hasProperty,
                },
                .getPropertyNames = .{
                    .rfn = getPropertyNames,
                },
            },
            .{},
        );

        pub fn getProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return null;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.node.data.e_object.properties;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];
            var value_node: JSNode = undefined;

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.utf8;

                if (strings.eql(property_slice, str)) {
                    const value = property.value orelse return js.JSValueMakeUndefined(ctx);
                    value_node = JSNode.initExpr(value);
                    return JSNode.JSBindings.toPrimitive(&value_node, ctx, exception);
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        pub fn hasProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
        ) callconv(.C) bool {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return false;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.node.data.e_object.properties;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.utf8;

                if (strings.eql(property_slice, str)) return true;
            }

            return false;
        }

        pub fn getPropertyNames(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            var this: *LazyPropertiesObject = JSCBase.GetJSPrivateData(LazyPropertiesObject, thisObject) orelse return;

            const properties = this.node.data.e_object.properties;

            for (properties) |property| {
                const key = property.key orelse continue;
                if (key.data != .e_string) continue;
                const str = key.data.e_string.utf8;
                js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreateStatic(str.ptr, str.len));
            }
        }
    };

    pub const ModuleNamespace = struct {
        import_data: JSNode.ImportData,

        pub const Class = JSCBase.NewClass(
            ModuleNamespace,
            .{
                .name = "ModuleNamespace",
                .read_only = true,
            },
            .{
                .getProperty = .{
                    .rfn = getProperty,
                },
                .hasProperty = .{
                    .rfn = hasProperty,
                },
                .getPropertyNames = .{
                    .rfn = getPropertyNames,
                },
            },
            .{},
        );

        pub fn getProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return null;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.import_data.import.items;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];
            var value_node: JSNode = undefined;

            for (properties) |property| {
                if (strings.eql(property.original_name, property_slice)) {
                    return JSC.JSValue.jsNumberFromInt32(JSNode.SymbolMap.generateImportHash(property.original_name, this.import_data.path)).asRef();
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        pub fn hasProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
        ) callconv(.C) bool {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return false;

            const len = js.JSStringGetLength(propertyName);
            const properties = this.import_data.import.items;
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var property_slice = ptr[0..len];

            for (properties) |property| {
                if (strings.eql(property.original_name, property_slice)) return true;
            }

            return false;
        }

        pub fn getPropertyNames(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            var this: *ModuleNamespace = JSCBase.GetJSPrivateData(ModuleNamespace, thisObject) orelse return;

            const items = this.import_data.import.items;

            for (items) |clause| {
                const str = clause.original_name;
                js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreateStatic(str.ptr, str.len));
            }
        }
    };

    resolver: *Resolver,
    vm: *JavaScript.VirtualMachine = undefined,

    resolved: ResolveResult = undefined,
    disabled: bool = false,

    pub fn init(
        allocator: *std.mem.Allocator,
        resolver: *Resolver,
        resolved: ResolveResult,
        log: *logger.Log,
        env: *DotEnv.Loader,
        function_name: string,
        specifier: string,
        hash: i32,
    ) !Macro {
        const path = resolved.path_pair.primary;

        var vm: *JavaScript.VirtualMachine = if (JavaScript.VirtualMachine.vm_loaded)
            JavaScript.VirtualMachine.vm
        else brk: {
            var old_transform_options = resolver.opts.transform_options;
            resolver.opts.transform_options.node_modules_bundle_path = null;
            resolver.opts.transform_options.node_modules_bundle_path_server = null;
            defer resolver.opts.transform_options = old_transform_options;
            var _vm = try JavaScript.VirtualMachine.init(default_allocator, resolver.opts.transform_options, null, log, env);

            _vm.enableMacroMode();

            _vm.bundler.configureLinker();
            try _vm.bundler.configureDefines();
            break :brk _vm;
        };

        vm.enableMacroMode();

        var loaded_result = try vm.loadMacroEntryPoint(path.text, function_name, specifier, hash);

        if (loaded_result.status(vm.global.vm()) == JSC.JSPromise.Status.Rejected) {
            vm.defaultErrorHandler(loaded_result.result(vm.global.vm()), null);
            vm.disableMacroMode();
            return error.MacroLoadError;
        }

        JavaScript.VirtualMachine.vm_loaded = true;

        // We don't need to do anything with the result.
        // We just want to make sure the promise is finished.
        _ = loaded_result.result(vm.global.vm());

        return Macro{
            .vm = vm,
            .resolved = resolved,
            .resolver = resolver,
        };
    }

    pub const Runner = struct {
        threadlocal var args_buf: [2]js.JSObjectRef = undefined;
        threadlocal var expr_nodes_buf: [1]JSNode = undefined;
        threadlocal var exception_holder: Zig.ZigException.Holder = undefined;
        pub fn run(
            macro: Macro,
            log: *logger.Log,
            allocator: *std.mem.Allocator,
            function_name: string,
            caller: Expr,
            args: []Expr,
            source: *const logger.Source,
            id: i32,
            comptime Visitor: type,
            visitor: Visitor,
        ) Expr {
            if (comptime isDebug) Output.prettyln("<r><d>[macro]<r> call <d><b>{s}<r>", .{function_name});

            exception_holder = Zig.ZigException.Holder.init();
            expr_nodes_buf[0] = JSNode.initExpr(caller);
            args_buf[0] = JSNode.Class.make(
                macro.vm.global.ref(),
                &expr_nodes_buf[0],
            );

            args_buf[1] = null;

            var macro_callback = macro.vm.macros.get(id) orelse return caller;
            var result = js.JSObjectCallAsFunctionReturnValue(macro.vm.global.ref(), macro_callback, null, args.len + 1, &args_buf);
            js.JSValueProtect(macro.vm.global.ref(), result.asRef());
            defer js.JSValueUnprotect(macro.vm.global.ref(), result.asRef());
            var promise = JSC.JSPromise.resolvedPromise(macro.vm.global, result);
            macro.vm.global.vm().drainMicrotasks();

            if (promise.status(macro.vm.global.vm()) == .Rejected) {
                macro.vm.defaultErrorHandler(promise.result(macro.vm.global.vm()), null);
                return caller;
            }

            const value = promise.result(macro.vm.global.vm());

            if (JSCBase.GetJSPrivateData(JSNode, value.asObjectRef())) |node| {
                node.updateSymbolsMap(Visitor, visitor);
                return node.toExpr();
            } else {
                return Expr{ .data = .{ .e_missing = .{} }, .loc = caller.loc };
            }
        }
    };
};

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
    const ident = Expr.init(E.Identifier, E.Identifier{}, logger.Loc{ .start = 100 });
    var list = [_]Expr{ident};
    var expr = Expr.init(
        E.Array,
        E.Array{ .items = list[0..] },
        logger.Loc{ .start = 1 },
    );
    try std.testing.expect(expr.loc.start == 1);
    try std.testing.expect(@as(Expr.Tag, expr.data) == Expr.Tag.e_array);
    try std.testing.expect(expr.data.e_array.items[0].loc.start == 100);

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
