pub const MemberHashMap = bun.StringHashMapUnmanaged(Member);

id: usize = 0,
kind: Kind = Kind.block,
parent: ?*Scope = null,
children: BabyList(*Scope) = .{},
members: MemberHashMap = .{},
generated: BabyList(Ref) = .{},

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

is_after_const_local_prefix: bool = false,

// This will be non-null if this is a TypeScript "namespace" or "enum"
ts_namespace: ?*TSNamespaceScope = null,

pub const NestedScopeMap = std.AutoArrayHashMap(u32, bun.BabyList(*Scope));

pub fn getMemberHash(name: []const u8) u64 {
    return bun.StringHashMapContext.hash(.{}, name);
}

pub fn getMemberWithHash(this: *const Scope, name: []const u8, hash_value: u64) ?Member {
    const hashed = bun.StringHashMapContext.Prehashed{
        .value = hash_value,
        .input = name,
    };
    return this.members.getAdapted(name, hashed);
}

pub fn getOrPutMemberWithHash(
    this: *Scope,
    allocator: std.mem.Allocator,
    name: []const u8,
    hash_value: u64,
) !MemberHashMap.GetOrPutResult {
    const hashed = bun.StringHashMapContext.Prehashed{
        .value = hash_value,
        .input = name,
    };
    return this.members.getOrPutContextAdapted(allocator, name, hashed, .{});
}

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
        return @call(bun.callmod_inline, Ref.eql, .{ a.ref, b.ref }) and a.loc.start == b.loc.start;
    }
};

pub const SymbolMergeResult = enum {
    forbidden,
    replace_with_new,
    overwrite_with_new,
    keep_existing,
    become_private_get_set_pair,
    become_private_static_get_set_pair,
};

pub fn canMergeSymbols(
    scope: *Scope,
    existing: Symbol.Kind,
    new: Symbol.Kind,
    comptime is_typescript_enabled: bool,
) SymbolMergeResult {
    if (existing == .unbound) {
        return .replace_with_new;
    }

    if (comptime is_typescript_enabled) {
        // In TypeScript, imports are allowed to silently collide with symbols within
        // the module. Presumably this is because the imports may be type-only:
        //
        //   import {Foo} from 'bar'
        //   class Foo {}
        //
        if (existing == .import) {
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
                .ts_namespace,
                .ts_enum,
                .hoisted_function,
                .generator_or_async_function,
                .class,
                => return .keep_existing,
                else => {},
            }
        }
    }

    // "var foo; var foo;"
    // "var foo; function foo() {}"
    // "function foo() {} var foo;"
    // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
    if (Symbol.isKindHoistedOrFunction(new) and
        Symbol.isKindHoistedOrFunction(existing) and
        (scope.kind == .entry or scope.kind == .function_body or scope.kind == .function_args or
            (new == existing and Symbol.isKindHoisted(existing))))
    {
        return .replace_with_new;
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

pub const Kind = enum(u8) {
    block,
    with,
    label,
    class_name,
    class_body,
    catch_binding,

    // The scopes below stop hoisted variables from extending into parent scopes
    entry, // This is a module, TypeScript enum, or TypeScript namespace
    function_args,
    function_body,
    class_static_init,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};

pub fn recursiveSetStrictMode(s: *Scope, kind: StrictModeKind) void {
    if (s.strict_mode == .sloppy_mode) {
        s.strict_mode = kind;
        for (s.children.slice()) |child| {
            child.recursiveSetStrictMode(kind);
        }
    }
}

pub inline fn kindStopsHoisting(s: *const Scope) bool {
    return @intFromEnum(s.kind) >= @intFromEnum(Kind.entry);
}

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const logger = bun.logger;

const js_ast = bun.ast;
const Ref = js_ast.Ref;
const Scope = js_ast.Scope;
const StrictModeKind = js_ast.StrictModeKind;
const Symbol = js_ast.Symbol;
const TSNamespaceScope = js_ast.TSNamespaceScope;
const TypeScript = js_ast.TypeScript;
