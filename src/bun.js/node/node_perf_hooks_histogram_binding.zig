const std = @import("std");
const bun = @import("root").bun;
const meta = bun.meta;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;

pub const RecordableHistogram = struct {
    pub usingnamespace JSC.Codegen.JSRecordableHistogram;

    min: u64 = 1,
    max: u64 = 2,
    mean: f64 = 3, // todo: make this optional
    exceeds: u64 = 4,
    stddev: f64 = 5, // todo: make this optional
    count: u64 = 6,
    percentilesInternal: std.AutoHashMap(f32, f32) = std.AutoHashMap(f32, f32).init(bun.default_allocator),

    const This = @This();

    //todo: these should also be explicit functions, IE both .max and .max() work
    pub const min = getter(.min);
    pub const max = getter(.max);
    pub const mean = getter(.mean);
    pub const exceeds = getter(.exceeds);
    pub const stddev = getter(.stddev);
    pub const count = getter(.count);

    // we need a special getter for percentiles because it's a hashmap
    pub const percentiles = @as(
        PropertyGetter,
        struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
                _ = this;
                _ = globalThis;
                return .undefined;
            }
        }.callback,
    );

    pub fn record(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn recordDelta(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn add(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        const args = callframe.arguments(1).slice();
        if (args.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }
        // todo: make below work
        // const other = args[0].to(RecordableHistogram);
        // _ = other;
        return .undefined;
    }

    pub fn reset(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn countBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn minBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn maxBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn exceedsBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn percentile(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        const args = callframe.arguments(1).slice();
        if (args.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }
        // todo: make below work
        // const percent = args[0].to(f64);
        // _ = percent;
        return .undefined;
    }

    pub fn percentileBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        const args = callframe.arguments(1).slice();
        if (args.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }
        // todo: make below work
        // const percent = args[0].to(f64);
        // _ = percent;
        return .undefined;
    }

    pub fn percentilesBigInt(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn toJSON(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    const PropertyGetter = fn (this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    fn getter(comptime field: meta.FieldEnum(This)) PropertyGetter {
        return struct {
            pub fn callback(this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
                const v = @field(this, @tagName(field));
                return globalObject.toJS(v, .temporary);
            }
        }.callback;
    }

    pub const value = getter(.value);

    // since we create this with bun.new, we need to have it be destroyable
    // our node.classes.ts has finalize=true to generate the call to finalize
    pub fn finalize(this: *This) callconv(.C) void {
        this.percentilesInternal.deinit();
        bun.destroy(this);
    }
};

fn createHistogram(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    return bun.new(RecordableHistogram, .{}).toJS(globalThis);
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
