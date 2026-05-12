//! `Expr.toJS` / `E.*.toJS` — converts a parsed AST literal into a runtime
//! `JSValue`. Used by the macro system. The AST types stay in `js_parser/`;
//! only the JS-materialization lives here.

pub fn exprToJS(this: Expr, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
    return dataToJS(this.data, allocator, globalObject);
}

pub fn dataToJS(this: Expr.Data, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
    return switch (this) {
        .e_array => |e| arrayToJS(e.*, allocator, globalObject),
        .e_object => |e| objectToJS(e, allocator, globalObject),
        .e_string => |e| stringToJS(e, allocator, globalObject),
        .e_null => jsc.JSValue.null,
        .e_undefined => .js_undefined,
        .e_boolean, .e_branch_boolean => |boolean| if (boolean.value)
            .true
        else
            .false,
        .e_number => |e| numberToJS(e),
        // .e_big_int => |e| e.toJS(ctx, exception),

        .e_inlined_enum => |inlined| dataToJS(inlined.value.data, allocator, globalObject),

        .e_identifier,
        .e_import_identifier,
        .e_private_identifier,
        .e_commonjs_export_identifier,
        => error.@"Cannot convert identifier to JS. Try a statically-known value",

        else => {
            return error.@"Cannot convert argument type to JS";
        },
    };
}

pub fn arrayToJS(this: E.Array, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
    const items = this.items.slice();
    var array = try jsc.JSValue.createEmptyArray(globalObject, items.len);
    array.protect();
    defer array.unprotect();
    for (items, 0..) |expr, j| {
        try array.putIndex(globalObject, @as(u32, @truncate(j)), try dataToJS(expr.data, allocator, globalObject));
    }

    return array;
}

pub fn boolToJS(this: E.Boolean, ctx: *jsc.JSGlobalObject) jsc.C.JSValueRef {
    return jsc.C.JSValueMakeBoolean(ctx, this.value);
}

pub fn numberToJS(this: E.Number) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.value);
}

pub fn bigIntToJS(_: E.BigInt) jsc.JSValue {
    // TODO:
    return jsc.JSValue.jsNumber(0);
}

pub fn objectToJS(this: *E.Object, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
    var obj = jsc.JSValue.createEmptyObject(globalObject, this.properties.len);
    obj.protect();
    defer obj.unprotect();
    const props: []const G.Property = this.properties.slice();
    for (props) |prop| {
        if (prop.kind != .normal or prop.class_static_block != null or prop.key == null or prop.value == null) {
            return error.@"Cannot convert argument type to JS";
        }
        const key = try dataToJS(prop.key.?.data, allocator, globalObject);
        const value = try exprToJS(prop.value.?, allocator, globalObject);
        try obj.putToPropertyKey(globalObject, key, value);
    }

    return obj;
}

pub fn stringToJS(s: *E.String, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) !jsc.JSValue {
    s.resolveRopeIfNeeded(allocator);
    if (!s.isPresent()) {
        var emp = bun.String.empty;
        return emp.toJS(globalObject);
    }

    if (s.isUTF8()) {
        if (try bun.strings.toUTF16Alloc(allocator, s.slice8(), false, false)) |utf16| {
            var out, const chars = bun.String.createUninitialized(.utf16, utf16.len);
            @memcpy(chars, utf16);
            return out.transferToJS(globalObject);
        } else {
            var out, const chars = bun.String.createUninitialized(.latin1, s.slice8().len);
            @memcpy(chars, s.slice8());
            return out.transferToJS(globalObject);
        }
    } else {
        var out, const chars = bun.String.createUninitialized(.utf16, s.slice16().len);
        @memcpy(chars, s.slice16());
        return out.transferToJS(globalObject);
    }
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const ToJSError = js_ast.ToJSError;
