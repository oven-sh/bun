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

    // RecordableHistogram specific internals
    delta_start: ?bun.timespec = null,

    const This = @This();
    const PropertyGetter = fn (this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;

    pub const min_fn = struct {
        pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
            return globalThis.toJS(this.hdrHist.min, .temporary);
        }
    };
    pub const min = @as(PropertyGetter, min_fn.callback);
    pub const minBigInt = getterAsFn(min_fn.callback);

    const max_fn = struct {
        pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
            return globalThis.toJS(this.hdrHist.max, .temporary);
        }
    };
    pub const max = @as(PropertyGetter, max_fn.callback);
    pub const maxBigInt = getterAsFn(max_fn.callback);

    const count_fn = struct {
        pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
            return globalThis.toJS(this.hdrHist.total_count, .temporary);
        }
    };
    pub const count = @as(PropertyGetter, count_fn.callback);
    pub const countBigInt = getterAsFn(count_fn.callback);

    pub const mean = @as(
        PropertyGetter,
        struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
                if (this.hdrHist.mean()) |m| {
                    return globalThis.toJS(m, .temporary);
                }
                return globalThis.toJS(std.math.nan(f64), .temporary);
            }
        }.callback,
    );

    pub const stddev = @as(
        PropertyGetter,
        struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSValue {
                if (this.hdrHist.stddev()) |sd| {
                    return globalThis.toJS(sd, .temporary);
                }
                return globalThis.toJS(std.math.nan(f64), .temporary);
            }
        }.callback,
    );

    pub const percentile = struct {
        pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const args = callframe.arguments(1).slice();
            if (args.len != 1) {
                globalThis.throwInvalidArguments("Expected 1 argument", .{});
                return .zero;
            }
            const percent = args[0].getNumber() orelse {
                globalThis.throwInvalidArguments("Expected a number", .{});
                return .zero;
            };
            const value = this.hdrHist.value_at_percentile(percent) orelse return .undefined;
            return globalThis.toJS(value, .temporary);
        }
    }.callback;
    pub const percentileBigInt = percentile;

    extern fn Bun__createMapFromDoubleUint64TupleArray(
        globalObject: *JSC.JSGlobalObject,
        doubles: [*]const f64,
        length: usize,
    ) JSC.JSValue;

    const percentiles_fn = struct {
        pub fn callback(this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSValue {

            // 2 arrays with percent and value
            // make a cpp version of this file, extern C function. accepts array, length, creates search JSMap:: (search)

            // first get 100th percentile, and loop 0, 50, 75, 82.5, ... until we find the highest percentile
            const maxPercentileValue = this.hdrHist.value_at_percentile(100) orelse return .undefined;
            var percent: f64 = 0;
            var stack_allocator = std.heap.stackFallback(4096, bun.default_allocator);
            var doubles = std.ArrayList(f64).init(stack_allocator.get());
            defer doubles.deinit();

            while (true) {
                if (this.hdrHist.value_at_percentile(percent)) |val| {
                    doubles.appendSlice(&.{ percent, @bitCast(val) }) catch |err| {
                        globalObject.throwError(err, "failed to append to array");
                        return .undefined;
                    };
                    if (val >= maxPercentileValue) {
                        break;
                    }
                }
                percent += ((100 - percent) / 2);
            }

            doubles.appendSlice(&.{ 100, @bitCast(maxPercentileValue) }) catch |err| {
                globalObject.throwError(err, "failed to append max value to array");
                return .undefined;
            };

            return Bun__createMapFromDoubleUint64TupleArray(globalObject, @as([*]const f64, @ptrCast(doubles.items)), doubles.items.len);
        }
    };
    pub const percentiles = @as(PropertyGetter, percentiles_fn.callback);
    pub const percentilesBigInt = getterAsFn(percentiles_fn.callback);

    //
    // additional functions

    // record duration in nanoseconds
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

    // record time since last call to recordDelta
    pub fn recordDelta(this: *This, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        if (this.delta_start) |start| {
            const end = bun.timespec.now();
            const diff = end.duration(&start);
            this.hdrHist.record_value(@intCast(diff.nsec), 1);
            this.delta_start = end;
            return .undefined;
        }

        // first call no-ops
        this.delta_start = bun.timespec.now();

        return .undefined;
    }

    pub fn reset(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = globalThis;
        _ = callframe;
        this.hdrHist.reset();
        return .undefined;
    }

    pub fn add(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callframe.arguments(1).slice();
        if (args.len != 1) {
            globalThis.throwInvalidArguments("Expected 1 argument", .{});
            return .zero;
        }
        const other = RecordableHistogram.fromJS(args[0]) orelse {
            globalThis.throwInvalidArguments("Expected a RecordableHistogram", .{});
            return .zero;
        };
        this.hdrHist.add(&other.hdrHist) catch |err| {
            globalThis.throwError(err, "failed to add histograms");
            return .zero;
        };

        return .undefined;
    }

    // the bigInt variants of these functions are simple getters without arguments, but we want them as methods
    // so this function strips the callframe argument so we can use the same callback as we do with our actual getters
    fn getterAsFn(callback: fn (
        this: *This,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue) fn (
        this: *This,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const outer = struct {
            pub fn inner(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
                // we don't need the callframe, so we can just call the callback
                return callback(this, globalThis);
            }
        };
        return outer.inner;
    }

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
