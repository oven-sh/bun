/// This is the name that came from the parser. Printed names may be renamed
/// during minification or to avoid name collisions. Do not use the original
/// name during printing.
original_name: []const u8,

/// This is used for symbols that represent items in the import clause of an
/// ES6 import statement. These should always be referenced by EImportIdentifier
/// instead of an EIdentifier. When this is present, the expression should
/// be printed as a property access off the namespace instead of as a bare
/// identifier.
///
/// For correctness, this must be stored on the symbol instead of indirectly
/// associated with the Ref for the symbol somehow. In ES6 "flat bundling"
/// mode, re-exported symbols are collapsed using MergeSymbols() and renamed
/// symbols from other files that end up at this symbol must be able to tell
/// if it has a namespace alias.
namespace_alias: ?G.NamespaceAlias = null,

/// Used by the parser for single pass parsing.
link: Ref = Ref.None,

/// An estimate of the number of uses of this symbol. This is used to detect
/// whether a symbol is used or not. For example, TypeScript imports that are
/// unused must be removed because they are probably type-only imports. This
/// is an estimate and may not be completely accurate due to oversights in the
/// code. But it should always be non-zero when the symbol is used.
use_count_estimate: u32 = 0,

/// This is for generating cross-chunk imports and exports for code splitting.
///
/// Do not use this directly. Use `chunkIndex()` instead.
chunk_index: u32 = invalid_chunk_index,

/// This is used for minification. Symbols that are declared in sibling scopes
/// can share a name. A good heuristic (from Google Closure Compiler) is to
/// assign names to symbols from sibling scopes in declaration order. That way
/// local variable names are reused in each global function like this, which
/// improves gzip compression:
///
///   function x(a, b) { ... }
///   function y(a, b, c) { ... }
///
/// The parser fills this in for symbols inside nested scopes. There are three
/// slot namespaces: regular symbols, label symbols, and private symbols.
///
/// Do not use this directly. Use `nestedScopeSlot()` instead.
nested_scope_slot: u32 = invalid_nested_scope_slot,

did_keep_name: bool = true,

must_start_with_capital_letter_for_jsx: bool = false,

/// The kind of symbol. This is used to determine how to print the symbol
/// and how to deal with conflicts, renaming, etc.
kind: Kind = Kind.other,

/// Certain symbols must not be renamed or minified. For example, the
/// "arguments" variable is declared by the runtime for every function.
/// Renaming can also break any identifier used inside a "with" statement.
must_not_be_renamed: bool = false,

/// We automatically generate import items for property accesses off of
/// namespace imports. This lets us remove the expensive namespace imports
/// while bundling in many cases, replacing them with a cheap import item
/// instead:
///
///   import * as ns from 'path'
///   ns.foo()
///
/// That can often be replaced by this, which avoids needing the namespace:
///
///   import {foo} from 'path'
///   foo()
///
/// However, if the import is actually missing then we don't want to report a
/// compile-time error like we do for real import items. This status lets us
/// avoid this. We also need to be able to replace such import items with
/// undefined, which this status is also used for.
import_item_status: ImportItemStatus = ImportItemStatus.none,

/// --- Not actually used yet -----------------------------------------------
/// Sometimes we lower private symbols even if they are supported. For example,
/// consider the following TypeScript code:
///
///   class Foo {
///     #foo = 123
///     bar = this.#foo
///   }
///
/// If "useDefineForClassFields: false" is set in "tsconfig.json", then "bar"
/// must use assignment semantics instead of define semantics. We can compile
/// that to this code:
///
///   class Foo {
///     constructor() {
///       this.#foo = 123;
///       this.bar = this.#foo;
///     }
///     #foo;
///   }
///
/// However, we can't do the same for static fields:
///
///   class Foo {
///     static #foo = 123
///     static bar = this.#foo
///   }
///
/// Compiling these static fields to something like this would be invalid:
///
///   class Foo {
///     static #foo;
///   }
///   Foo.#foo = 123;
///   Foo.bar = Foo.#foo;
///
/// Thus "#foo" must be lowered even though it's supported. Another case is
/// when we're converting top-level class declarations to class expressions
/// to avoid the TDZ and the class shadowing symbol is referenced within the
/// class body:
///
///   class Foo {
///     static #foo = Foo
///   }
///
/// This cannot be converted into something like this:
///
///   var Foo = class {
///     static #foo;
///   };
///   Foo.#foo = Foo;
///
/// --- Not actually used yet -----------------------------------------------
private_symbol_must_be_lowered: bool = false,

remove_overwritten_function_declaration: bool = false,

/// Used in HMR to decide when live binding code is needed.
has_been_assigned_to: bool = false,

comptime {
    bun.assert_eql(@sizeOf(Symbol), 88);
    bun.assert_eql(@alignOf(Symbol), @alignOf([]const u8));
}

const invalid_chunk_index = std.math.maxInt(u32);
pub const invalid_nested_scope_slot = std.math.maxInt(u32);

pub const SlotNamespace = enum {
    must_not_be_renamed,
    default,
    label,
    private_name,
    mangled_prop,

    pub const CountsArray = std.EnumArray(SlotNamespace, u32);
};

/// This is for generating cross-chunk imports and exports for code splitting.
pub inline fn chunkIndex(this: *const Symbol) ?u32 {
    const i = this.chunk_index;
    return if (i == invalid_chunk_index) null else i;
}

pub inline fn nestedScopeSlot(this: *const Symbol) ?u32 {
    const i = this.nested_scope_slot;
    return if (i == invalid_nested_scope_slot) null else i;
}

pub fn slotNamespace(this: *const Symbol) SlotNamespace {
    const kind = this.kind;

    if (kind == .unbound or this.must_not_be_renamed) {
        return .must_not_be_renamed;
    }

    if (kind.isPrivate()) {
        return .private_name;
    }

    return switch (kind) {
        // .mangled_prop => .mangled_prop,
        .label => .label,
        else => .default,
    };
}

pub inline fn hasLink(this: *const Symbol) bool {
    return this.link.tag != .invalid;
}

pub const Kind = enum {
    /// An unbound symbol is one that isn't declared in the file it's referenced
    /// in. For example, using "window" without declaring it will be unbound.
    unbound,

    /// This has special merging behavior. You're allowed to re-declare these
    /// symbols more than once in the same scope. These symbols are also hoisted
    /// out of the scope they are declared in to the closest containing function
    /// or module scope. These are the symbols with this kind:
    ///
    /// - Function arguments
    /// - Function statements
    /// - Variables declared using "var"
    hoisted,
    hoisted_function,

    /// There's a weird special case where catch variables declared using a simple
    /// identifier (i.e. not a binding pattern) block hoisted variables instead of
    /// becoming an error:
    ///
    ///   var e = 0;
    ///   try { throw 1 } catch (e) {
    ///     print(e) // 1
    ///     var e = 2
    ///     print(e) // 2
    ///   }
    ///   print(e) // 0 (since the hoisting stops at the catch block boundary)
    ///
    /// However, other forms are still a syntax error:
    ///
    ///   try {} catch (e) { let e }
    ///   try {} catch ({e}) { var e }
    ///
    /// This symbol is for handling this weird special case.
    catch_identifier,

    /// Generator and async functions are not hoisted, but still have special
    /// properties such as being able to overwrite previous functions with the
    /// same name
    generator_or_async_function,

    /// This is the special "arguments" variable inside functions
    arguments,

    /// Classes can merge with TypeScript namespaces.
    class,

    /// A class-private identifier (i.e. "#foo").
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

    /// Labels are in their own namespace
    label,

    /// TypeScript enums can merge with TypeScript namespaces and other TypeScript
    /// enums.
    ts_enum,

    /// TypeScript namespaces can merge with classes, functions, TypeScript enums,
    /// and other TypeScript namespaces.
    ts_namespace,

    /// In TypeScript, imports are allowed to silently collide with symbols within
    /// the module. Presumably this is because the imports may be type-only.
    /// Import statement namespace references should NOT have this set.
    import,

    /// Assigning to a "const" symbol will throw a TypeError at runtime
    constant,

    // CSS identifiers that are renamed to be unique to the file they are in
    local_css,

    /// This annotates all other symbols that don't have special behavior.
    other,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }

    pub inline fn isPrivate(kind: Symbol.Kind) bool {
        return @intFromEnum(kind) >= @intFromEnum(Symbol.Kind.private_field) and @intFromEnum(kind) <= @intFromEnum(Symbol.Kind.private_static_get_set_pair);
    }

    pub inline fn isHoisted(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted, .hoisted_function => true,
            else => false,
        };
    }

    pub inline fn isHoistedOrFunction(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted, .hoisted_function, .generator_or_async_function => true,
            else => false,
        };
    }

    pub inline fn isFunction(kind: Symbol.Kind) bool {
        return switch (kind) {
            .hoisted_function, .generator_or_async_function => true,
            else => false,
        };
    }
};

pub const Use = struct {
    count_estimate: u32 = 0,
};

pub const List = BabyList(Symbol);
pub const NestedList = BabyList(List);

pub fn mergeContentsWith(this: *Symbol, old: *Symbol) void {
    this.use_count_estimate += old.use_count_estimate;
    if (old.must_not_be_renamed) {
        this.original_name = old.original_name;
        this.must_not_be_renamed = true;
    }

    // TODO: MustStartWithCapitalLetterForJSX
}

pub const Map = struct {
    // This could be represented as a "map[Ref]Symbol" but a two-level array was
    // more efficient in profiles. This appears to be because it doesn't involve
    // a hash. This representation also makes it trivial to quickly merge symbol
    // maps from multiple files together. Each file only generates symbols in a
    // single inner array, so you can join the maps together by just make a
    // single outer array containing all of the inner arrays. See the comment on
    // "Ref" for more detail.
    symbols_for_source: NestedList = .{},

    pub fn dump(this: Map) void {
        defer Output.flush();
        for (this.symbols_for_source.slice(), 0..) |symbols, i| {
            Output.prettyln("\n\n-- Source ID: {d} ({d} symbols) --\n\n", .{ i, symbols.len });
            for (symbols.slice(), 0..) |symbol, inner_index| {
                Output.prettyln(
                    " name: {s}\n  tag: {s}\n       {f}\n",
                    .{
                        symbol.original_name, @tagName(symbol.kind),
                        if (symbol.hasLink()) symbol.link else Ref{
                            .source_index = @truncate(i),
                            .inner_index = @truncate(inner_index),
                            .tag = .symbol,
                        },
                    },
                );
            }
        }
    }

    pub fn assignChunkIndex(this: *Map, decls_: DeclaredSymbol.List, chunk_index: u32) void {
        const Iterator = struct {
            map: *Map,
            chunk_index: u32,

            pub fn next(self: @This(), ref: Ref) void {
                var symbol = self.map.get(ref).?;
                symbol.chunk_index = self.chunk_index;
            }
        };
        var decls = decls_;

        DeclaredSymbol.forEachTopLevelSymbol(&decls, Iterator{ .map = this, .chunk_index = chunk_index }, Iterator.next);
    }

    pub fn merge(this: *Map, old: Ref, new: Ref) Ref {
        if (old.eql(new)) {
            return new;
        }

        var old_symbol = this.get(old).?;
        if (old_symbol.hasLink()) {
            const old_link = old_symbol.link;
            old_symbol.link = this.merge(old_link, new);
            return old_symbol.link;
        }

        var new_symbol = this.get(new).?;

        if (new_symbol.hasLink()) {
            const new_link = new_symbol.link;
            new_symbol.link = this.merge(old, new_link);
            return new_symbol.link;
        }

        old_symbol.link = new;
        new_symbol.mergeContentsWith(old_symbol);
        return new;
    }

    pub fn get(self: *const Map, ref: Ref) ?*Symbol {
        if (Ref.isSourceIndexNull(ref.sourceIndex()) or ref.isSourceContentsSlice()) {
            return null;
        }

        return self.symbols_for_source.at(ref.sourceIndex()).mut(ref.innerIndex());
    }

    pub fn getConst(self: *const Map, ref: Ref) ?*const Symbol {
        if (Ref.isSourceIndexNull(ref.sourceIndex()) or ref.isSourceContentsSlice()) {
            return null;
        }

        return self.symbols_for_source.at(ref.sourceIndex()).at(ref.innerIndex());
    }

    pub fn init(sourceCount: usize, allocator: std.mem.Allocator) !Map {
        const symbols_for_source: NestedList = NestedList.init(try allocator.alloc([]Symbol, sourceCount));
        return Map{ .symbols_for_source = symbols_for_source };
    }

    pub fn initWithOneList(list: List) Map {
        const baby_list = BabyList(List).fromBorrowedSliceDangerous((&list)[0..1]);
        return initList(baby_list);
    }

    pub fn initList(list: NestedList) Map {
        return Map{ .symbols_for_source = list };
    }

    pub fn getWithLink(symbols: *const Map, ref: Ref) ?*Symbol {
        var symbol: *Symbol = symbols.get(ref) orelse return null;
        if (symbol.hasLink()) {
            return symbols.get(symbol.link) orelse symbol;
        }
        return symbol;
    }

    pub fn getWithLinkConst(symbols: *Map, ref: Ref) ?*const Symbol {
        var symbol: *const Symbol = symbols.getConst(ref) orelse return null;
        if (symbol.hasLink()) {
            return symbols.getConst(symbol.link) orelse symbol;
        }
        return symbol;
    }

    pub fn followAll(symbols: *Map) void {
        const trace = bun.perf.trace("Symbols.followAll");
        defer trace.end();
        for (symbols.symbols_for_source.slice()) |list| {
            for (list.slice()) |*symbol| {
                if (!symbol.hasLink()) continue;
                symbol.link = follow(symbols, symbol.link);
            }
        }
    }

    /// Equivalent to followSymbols in esbuild
    pub fn follow(symbols: *const Map, ref: Ref) Ref {
        var symbol = symbols.get(ref) orelse return ref;
        if (!symbol.hasLink()) {
            return ref;
        }

        const link = follow(symbols, symbol.link);

        if (!symbol.link.eql(link)) {
            symbol.link = link;
        }

        return link;
    }
};

pub inline fn isHoisted(self: *const Symbol) bool {
    return Symbol.isKindHoisted(self.kind);
}

pub const isKindFunction = Symbol.Kind.isFunction;
pub const isKindHoisted = Symbol.Kind.isHoisted;
pub const isKindHoistedOrFunction = Symbol.Kind.isHoistedOrFunction;
pub const isKindPrivate = Symbol.Kind.isPrivate;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const Output = bun.Output;

const js_ast = bun.ast;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const G = js_ast.G;
const ImportItemStatus = js_ast.ImportItemStatus;
const Ref = js_ast.Ref;
const Symbol = js_ast.Symbol;
