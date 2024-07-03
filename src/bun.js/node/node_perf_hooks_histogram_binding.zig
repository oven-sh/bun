const std = @import("std");
const bun = @import("root").bun;
const HDRHistogram = @import("./node_perf_hooks_histogram.zig").HDRHistogram;
const meta = bun.meta;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;

// Wrapper around HRD Histogram
pub const RecordableHistogram = struct {
    pub usingnamespace JSC.Codegen.JSRecordableHistogram;
    hdrHist: HDRHistogram = undefined,

    const This = @This();

    //todo: these should also be explicit functions, IE both .max and .max() work
    // pub const exceeds = getter(.exceeds);

    pub const min = @as(
        PropertyGetter,
        struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
                return globalThis.toJS(this.hdrHist.min, .temporary);
            }
        }.callback,
    );

    // pub const max = @as(
    //     PropertyGetter,
    //     struct {
    //         pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    //             return globalThis.toJS(this._histogram.max, .temporary);
    //         }
    //     }.callback,
    // );

    // pub const count = @as(
    //     PropertyGetter,
    //     struct {
    //         pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    //             return globalThis.toJS(this._histogram.total_count, .temporary);
    //         }
    //     }.callback,
    // );

    // pub const mean = @as(
    //     PropertyGetter,
    //     struct {
    //         pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    //             return globalThis.toJS(this._histogram.mean(), .temporary);
    //         }
    //     }.callback,
    // );

    // pub const stddev = @as(
    //     PropertyGetter,
    //     struct {
    //         pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    //             return globalThis.toJS(this._histogram.stddev(), .temporary);
    //         }
    //     }.callback,
    // );

    // pub const percentiles = @as(
    //     PropertyGetter,
    //     struct {
    //         pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
    //             _ = globalThis;
    //             _ = this;
    //             return .undefined;
    //         }
    //     }.callback,
    // );

    pub fn record(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callframe.arguments(1).slice();
        if (args.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }
        const value = args[0].to(u64);
        this.hdrHist.record_value(value, 1);
        return .undefined;
    }

    // pub fn recordDelta(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn add(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     const args = callframe.arguments(1).slice();
    //     if (args.len != 1) {
    //         globalThis.throwInvalidArguments("Expected 1 argument", .{});
    //         return .zero;
    //     }
    //     // todo: make below work
    //     // const other = args[0].to(RecordableHistogram);
    //     // _ = other;
    //     return .undefined;
    // }

    // pub fn reset(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn countBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn minBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn maxBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn exceedsBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn percentile(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     const args = callframe.arguments(1).slice();
    //     if (args.len != 1) {
    //         globalThis.throwInvalidArguments("Expected 1 argument", .{});
    //         return .zero;
    //     }
    //     // todo: make below work
    //     // const percent = args[0].to(f64);
    //     // _ = percent;
    //     return .undefined;
    // }

    // pub fn percentileBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     const args = callframe.arguments(1).slice();
    //     if (args.len != 1) {
    //         globalThis.throwInvalidArguments("Expected 1 argument", .{});
    //         return .zero;
    //     }
    //     // todo: make below work
    //     // const percent = args[0].to(f64);
    //     // _ = percent;
    //     return .undefined;
    // }

    // pub fn percentilesBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    // pub fn toJSON(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
    //     _ = this;
    //     _ = globalThis;
    //     _ = callframe;
    //     return .undefined;
    // }

    const PropertyGetter = fn (this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    fn getter(comptime field: meta.FieldEnum(This)) PropertyGetter {
        return struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
                const v = @field(this, @tagName(field));
                return globalThis.toJS(v, .temporary);
            }
        }.callback;
    }

    // const PropertySetter = fn (this: *This, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(.C) bool;
    // fn setter(comptime field: meta.FieldEnum(This)) PropertySetter {
    //     return struct {
    //         pub fn callback(
    //             this: *This,
    //             globalThis: *JSC.JSGlobalObject,
    //             value: JSC.JSValue,
    //         ) callconv(.C) bool {
    //             const fieldType = @TypeOf(@field(this, @tagName(field)));
    //             switch (fieldType) {
    //                 u64, i64 => |T| {
    //                     if (!value.isNumber()) {
    //                         globalThis.throwInvalidArguments("Expected a number", .{}); // protect users from themselves
    //                         return false;
    //                     }
    //                     @field(this, @tagName(field)) = value.to(T);
    //                     return true;
    //                 },
    //                 f64 => {
    //                     if (!value.isNumber()) {
    //                         globalThis.throwInvalidArguments("Expected a number", .{});
    //                         return false;
    //                     }
    //                     @field(this, @tagName(field)) = value.asNumber();
    //                     return true;
    //                 },
    //                 bool => {
    //                     if (!value.isBoolean()) {
    //                         globalThis.throwInvalidArguments("Expected a boolean", .{});
    //                         return false;
    //                     }
    //                     @field(this, @tagName(field)) = value.to(bool);
    //                     return true;
    //                 },
    //                 else => @compileError("Unsupported setter field type"), // protect us from ourselves
    //             }
    //         }
    //     }.callback;
    // }

    // since we create this with bun.new, we need to have it be destroyable
    // our node.classes.ts has finalize=true to generate the call to finalize
    pub fn finalize(this: *This) callconv(.C) void {
        this.hdrHist.deinit();
        bun.destroy(this);
    }
};

fn createHistogram(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    var histogram = bun.new(RecordableHistogram, .{});
    histogram.hdrHist = HDRHistogram.init(bun.default_allocator, .{}) catch |err| {
        globalThis.throwError(err, "failed to initialize histogram");
        return .zero;
    };
    return histogram.toJS(globalThis);
}

pub fn createPerfHooksHistogramBinding(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const histogram = JSC.JSValue.createEmptyObject(global, 1);
    histogram.put(
        global,
        bun.String.init("createHistogram"),
        JSC.JSFunction.create(
            global,
            "createHistogram",
            &createHistogram,
            3, // function length
            .{},
        ),
    );

    return histogram;
}
