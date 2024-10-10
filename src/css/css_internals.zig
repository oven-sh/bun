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

const TestKind = enum {
    normal,
    minify,
    prefix,
};

pub fn minifyTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    return testingImpl(globalThis, callframe, .minify);
}

pub fn prefixTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    return testingImpl(globalThis, callframe, .prefix);
}

pub fn testWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    return testingImpl(globalThis, callframe, .normal);
}

pub fn testingImpl(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame, comptime test_kind: TestKind) JSC.JSValue {
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
        if (test_kind == .prefix) break :parser_options opts;

        if (options_arg) |optargs| {
            _ = optargs; // autofix
            // if (optargs.isObject()) {
            //     if (optargs.getStr
            // }
            std.debug.panic("ZACK: suppor this lol", .{});
        }

        break :parser_options opts;
    };

    var import_records = bun.BabyList(bun.ImportRecord){};
    switch (bun.css.StyleSheet(bun.css.DefaultAtRule).parse(
        alloc,
        source.slice(),
        parser_options,
        &import_records,
    )) {
        .result => |stylesheet_| {
            var stylesheet = stylesheet_;
            var minify_options: bun.css.MinifyOptions = bun.css.MinifyOptions.default();
            switch (test_kind) {
                .minify => {},
                .normal => {},
                .prefix => {
                    if (options_arg) |optarg| {
                        if (optarg.isObject()) {
                            minify_options.targets.browsers = targetsFromJS(globalThis, optarg);
                        }
                    }
                },
            }
            _ = stylesheet.minify(alloc, minify_options).assert();

            const result = stylesheet.toCss(alloc, bun.css.PrinterOptions{
                .minify = switch (test_kind) {
                    .minify => true,
                    .normal => false,
                    .prefix => false,
                },
            }, &import_records) catch |e| {
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

fn targetsFromJS(globalThis: *JSC.JSGlobalObject, jsobj: JSValue) bun.css.targets.Browsers {
    var targets = bun.css.targets.Browsers{};

    if (jsobj.getTruthy(globalThis, "android")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.android = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "chrome")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.chrome = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "edge")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.edge = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "firefox")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.firefox = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "ie")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.ie = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "ios_saf")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.ios_saf = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "opera")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.opera = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "safari")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.safari = @intFromFloat(value);
            }
        }
    }
    if (jsobj.getTruthy(globalThis, "samsung")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.samsung = @intFromFloat(value);
            }
        }
    }

    return targets;
}

pub fn attrTest(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    var arena = arena_ orelse brk: {
        break :brk Arena.init() catch @panic("oopsie arena no good");
    };
    defer arena.reset();
    const alloc = arena.allocator();

    const arguments_ = callframe.arguments(4);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const source_arg: JSC.JSValue = arguments.nextEat() orelse {
        globalThis.throw("attrTest: expected 3 arguments, got 0", .{});
        return .undefined;
    };
    if (!source_arg.isString()) {
        globalThis.throw("attrTest: expected source to be a string", .{});
        return .undefined;
    }
    const source_bunstr = source_arg.toBunString(globalThis);
    defer source_bunstr.deref();
    const source = source_bunstr.toUTF8(bun.default_allocator);
    defer source.deinit();

    const expected_arg = arguments.nextEat() orelse {
        globalThis.throw("attrTest: expected 3 arguments, got 1", .{});
        return .undefined;
    };
    if (!expected_arg.isString()) {
        globalThis.throw("attrTest: expected `expected` arg to be a string", .{});
        return .undefined;
    }
    const expected_bunstr = expected_arg.toBunString(globalThis);
    defer expected_bunstr.deref();
    const expected = expected_bunstr.toUTF8(bun.default_allocator);
    defer expected.deinit();

    const minify_arg: JSC.JSValue = arguments.nextEat() orelse {
        globalThis.throw("attrTest: expected 3 arguments, got 2", .{});
        return .undefined;
    };
    const minify = minify_arg.isBoolean() and minify_arg.toBoolean();

    var targets: bun.css.targets.Targets = .{};
    if (arguments.nextEat()) |arg| {
        if (arg.isObject()) {
            targets.browsers = targetsFromJS(globalThis, arg);
        }
    }

    var log = bun.logger.Log.init(alloc);
    defer log.deinit();

    const parser_options = bun.css.ParserOptions.default(alloc, &log);

    var import_records = bun.BabyList(bun.ImportRecord){};
    switch (bun.css.StyleAttribute.parse(alloc, source.slice(), parser_options, &import_records)) {
        .result => |stylesheet_| {
            var stylesheet = stylesheet_;
            var minify_options: bun.css.MinifyOptions = bun.css.MinifyOptions.default();
            minify_options.targets = targets;
            stylesheet.minify(alloc, minify_options);

            const result = stylesheet.toCss(alloc, bun.css.PrinterOptions{
                .minify = minify,
                .targets = targets,
            }, &import_records) catch |e| {
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
