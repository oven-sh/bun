const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSGlobalObject = bun.JSC.JSGlobalObject;

const TestKind = enum {
    normal,
    minify,
    prefix,
};

const TestCategory = enum {
    /// arg is browsers
    normal,
    /// arg is parser options
    parser_options,
};

pub fn minifyErrorTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .minify, .parser_options);
}

pub fn minifyTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .minify, .parser_options);
}

pub fn prefixTestWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .prefix, .parser_options);
}

pub fn testWithOptions(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .normal, .parser_options);
}

pub fn minifyTest(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .minify, .normal);
}

pub fn prefixTest(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .prefix, .normal);
}

pub fn _test(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return testingImpl(globalThis, callframe, .normal, .normal);
}

pub fn testingImpl(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame, comptime test_kind: TestKind, comptime test_category: TestCategory) bun.JSError!JSC.JSValue {
    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const arguments_ = callframe.arguments_old(3);
    var arguments = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const source_arg: JSC.JSValue = arguments.nextEat() orelse {
        return globalThis.throw("minifyTestWithOptions: expected 2 arguments, got 0", .{});
    };
    if (!source_arg.isString()) {
        return globalThis.throw("minifyTestWithOptions: expected source to be a string", .{});
    }
    const source_bunstr = try source_arg.toBunString(globalThis);
    defer source_bunstr.deref();
    const source = source_bunstr.toUTF8(bun.default_allocator);
    defer source.deinit();

    const expected_arg = arguments.nextEat() orelse {
        return globalThis.throw("minifyTestWithOptions: expected 2 arguments, got 1", .{});
    };
    if (!expected_arg.isString()) {
        return globalThis.throw("minifyTestWithOptions: expected `expected` arg to be a string", .{});
    }
    const expected_bunstr = try expected_arg.toBunString(globalThis);
    defer expected_bunstr.deref();
    const expected = expected_bunstr.toUTF8(bun.default_allocator);
    defer expected.deinit();

    const browser_options_arg = arguments.nextEat();

    var log = bun.logger.Log.init(alloc);
    defer log.deinit();

    var browsers: ?bun.css.targets.Browsers = null;
    const parser_options = parser_options: {
        var opts = bun.css.ParserOptions.default(alloc, &log);
        // if (test_kind == .prefix) break :parser_options opts;

        switch (test_category) {
            .normal => {
                if (browser_options_arg) |optargs| {
                    if (optargs.isObject()) {
                        browsers = try targetsFromJS(globalThis, optargs);
                    }
                }
            },
            .parser_options => {
                if (browser_options_arg) |optargs| {
                    if (optargs.isObject()) {
                        try parserOptionsFromJS(globalThis, alloc, &opts, optargs);
                    }
                }
            },
        }

        break :parser_options opts;
    };

    var import_records = bun.BabyList(bun.ImportRecord){};
    switch (bun.css.StyleSheet(bun.css.DefaultAtRule).parse(
        alloc,
        source.slice(),
        parser_options,
        &import_records,
        bun.bundle_v2.Index.invalid,
    )) {
        .result => |ret| {
            var stylesheet, var extra = ret;
            var minify_options: bun.css.MinifyOptions = bun.css.MinifyOptions.default();
            minify_options.targets.browsers = browsers;
            _ = stylesheet.minify(alloc, minify_options, &extra).assert();

            const symbols = bun.JSAst.Symbol.Map{};
            var local_names = bun.css.LocalsResultsMap{};
            const result = switch (stylesheet.toCss(
                alloc,
                bun.css.PrinterOptions{
                    .minify = switch (test_kind) {
                        .minify => true,
                        .normal => false,
                        .prefix => false,
                    },
                    .targets = .{
                        .browsers = minify_options.targets.browsers,
                    },
                },
                .initOutsideOfBundler(&import_records),
                &local_names,
                &symbols,
            )) {
                .result => |result| result,
                .err => |err| {
                    return err.toJSString(alloc, globalThis);
                },
            };

            return bun.String.fromBytes(result.code).toJS(globalThis);
        },
        .err => |err| {
            if (log.hasErrors()) {
                return log.toJS(globalThis, bun.default_allocator, "parsing failed:");
            }
            return globalThis.throw("parsing failed: {}", .{err.kind});
        },
    }
}

fn parserOptionsFromJS(globalThis: *JSC.JSGlobalObject, allocator: Allocator, opts: *bun.css.ParserOptions, jsobj: JSValue) bun.JSError!void {
    _ = allocator; // autofix
    if (try jsobj.getTruthy(globalThis, "flags")) |val| {
        if (val.isArray()) {
            var iter = try val.arrayIterator(globalThis);
            while (try iter.next()) |item| {
                const bunstr = try item.toBunString(globalThis);
                defer bunstr.deref();
                const str = bunstr.toUTF8(bun.default_allocator);
                defer str.deinit();
                if (std.mem.eql(u8, str.slice(), "DEEP_SELECTOR_COMBINATOR")) {
                    opts.flags.deep_selector_combinator = true;
                } else {
                    return globalThis.throw("invalid flag: {s}", .{str.slice()});
                }
            }
        } else {
            return globalThis.throw("flags must be an array", .{});
        }
    }

    // if (try jsobj.getTruthy(globalThis, "css_modules")) |val| {
    //     opts.css_modules = bun.css.css_modules.Config{

    //     };
    //     if (val.isObject()) {
    //         if (try val.getTruthy(globalThis, "pure")) |pure_val| {
    //             opts.css_modules.pure = pure_val.toBoolean();
    //         }
    //     }
    // }
}

fn targetsFromJS(globalThis: *JSC.JSGlobalObject, jsobj: JSValue) bun.JSError!bun.css.targets.Browsers {
    var targets = bun.css.targets.Browsers{};

    if (try jsobj.getTruthy(globalThis, "android")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.android = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "chrome")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.chrome = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "edge")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.edge = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "firefox")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.firefox = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "ie")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.ie = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "ios_saf")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.ios_saf = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "opera")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.opera = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "safari")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.safari = @intFromFloat(value);
            }
        }
    }
    if (try jsobj.getTruthy(globalThis, "samsung")) |val| {
        if (val.isInt32()) {
            if (val.getNumber()) |value| {
                targets.samsung = @intFromFloat(value);
            }
        }
    }

    return targets;
}

pub fn attrTest(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    const arguments_ = callframe.arguments_old(4);
    var arguments = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const source_arg: JSC.JSValue = arguments.nextEat() orelse {
        return globalThis.throw("attrTest: expected 3 arguments, got 0", .{});
    };
    if (!source_arg.isString()) {
        return globalThis.throw("attrTest: expected source to be a string", .{});
    }
    const source_bunstr = try source_arg.toBunString(globalThis);
    defer source_bunstr.deref();
    const source = source_bunstr.toUTF8(bun.default_allocator);
    defer source.deinit();

    const expected_arg = arguments.nextEat() orelse {
        return globalThis.throw("attrTest: expected 3 arguments, got 1", .{});
    };
    if (!expected_arg.isString()) {
        return globalThis.throw("attrTest: expected `expected` arg to be a string", .{});
    }
    const expected_bunstr = try expected_arg.toBunString(globalThis);
    defer expected_bunstr.deref();
    const expected = expected_bunstr.toUTF8(bun.default_allocator);
    defer expected.deinit();

    const minify_arg: JSC.JSValue = arguments.nextEat() orelse {
        return globalThis.throw("attrTest: expected 3 arguments, got 2", .{});
    };
    const minify = minify_arg.isBoolean() and minify_arg.toBoolean();

    var targets: bun.css.targets.Targets = .{};
    if (arguments.nextEat()) |arg| {
        if (arg.isObject()) {
            targets.browsers = try targetsFromJS(globalThis, arg);
        }
    }

    var log = bun.logger.Log.init(alloc);
    defer log.deinit();

    const parser_options = bun.css.ParserOptions.default(alloc, &log);

    var import_records = bun.BabyList(bun.ImportRecord){};
    switch (bun.css.StyleAttribute.parse(alloc, source.slice(), parser_options, &import_records, bun.bundle_v2.Index.invalid)) {
        .result => |stylesheet_| {
            var stylesheet = stylesheet_;
            var minify_options: bun.css.MinifyOptions = bun.css.MinifyOptions.default();
            minify_options.targets = targets;
            stylesheet.minify(alloc, minify_options);

            const result = stylesheet.toCss(
                alloc,
                bun.css.PrinterOptions{
                    .minify = minify,
                    .targets = targets,
                },
                .initOutsideOfBundler(&import_records),
            ) catch |e| {
                bun.handleErrorReturnTrace(e, @errorReturnTrace());
                return .js_undefined;
            };

            return bun.String.fromBytes(result.code).toJS(globalThis);
        },
        .err => |err| {
            if (log.hasAny()) {
                return log.toJS(globalThis, bun.default_allocator, "parsing failed:");
            }
            return globalThis.throw("parsing failed: {}", .{err.kind});
        },
    }
}
