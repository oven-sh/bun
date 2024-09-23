const bun = @import("root").bun;
const std = @import("std");
const builtin = @import("builtin");
const Arena = @import("../mimalloc_arena.zig").Arena;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSPromise = bun.JSC.JSPromise;
const JSGlobalObject = bun.JSC.JSGlobalObject;

threadlocal var arena_: ?Arena = null;

pub fn minifyTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    return minifyTestWithOptionsImpl(globalThis, callframe, true);
}

pub fn testWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    return minifyTestWithOptionsImpl(globalThis, callframe, false);
}

pub fn minifyTestWithOptionsImpl(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame, comptime minify: bool) JSC.JSValue {
    var arena = arena_ orelse brk: {
        break :brk Arena.init() catch @panic("oopsie arena no good");
    };
    defer arena.reset();
    const alloc = arena.allocator();

    const arguments_ = callframe.arguments(2);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const source_arg: JSC.JSValue = arguments.nextEat() orelse {
        globalThis.throw("minifyTestWithOptions: expected 2 arguments, got 0", .{});
        return .undefined;
    };
    if (!source_arg.isString()) {
        globalThis.throw("minifyTestWithOptions: expected source to be a string", .{});
        return .undefined;
    }
    const source_bunstr = source_arg.toBunString(globalThis);
    defer source_bunstr.deref();
    const source = source_bunstr.toUTF8(bun.default_allocator);
    defer source.deinit();

    const expected_arg = arguments.nextEat() orelse {
        globalThis.throw("minifyTestWithOptions: expected 2 arguments, got 1", .{});
        return .undefined;
    };
    if (!expected_arg.isString()) {
        globalThis.throw("minifyTestWithOptions: expected `expected` arg to be a string", .{});
        return .undefined;
    }
    const expected_bunstr = expected_arg.toBunString(globalThis);
    defer expected_bunstr.deref();
    const expected = expected_bunstr.toUTF8(bun.default_allocator);
    defer expected.deinit();

    const options_arg = arguments.nextEat();

    var log = bun.logger.Log.init(alloc);
    defer log.deinit();

    const parser_options = parser_options: {
        const opts = bun.css.ParserOptions.default(alloc, &log);

        if (options_arg) |optargs| {
            _ = optargs; // autofix
            // if (optargs.isObject()) {
            //     if (optargs.getStr
            // }
            std.debug.panic("ZACK: suppor this lol", .{});
        }

        break :parser_options opts;
    };

    switch (bun.css.StyleSheet(bun.css.DefaultAtRule).parse(
        alloc,
        source.slice(),
        parser_options,
    )) {
        .result => |stylesheet| {
            const result = stylesheet.toCss(alloc, bun.css.PrinterOptions{
                .minify = minify,
            }) catch |e| {
                bun.handleErrorReturnTrace(e, @errorReturnTrace());
                return .undefined;
            };
            return bun.String.fromBytes(result.code).toJS(globalThis);
        },
        .err => |err| {
            if (log.hasAny()) {
                return log.toJS(globalThis, bun.default_allocator, "parsing failed:");
            }
            globalThis.throw("parsing failed: {}", .{err.kind});
            return .undefined;
        },
    }
}
