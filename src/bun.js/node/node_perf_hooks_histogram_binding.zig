const std = @import("std");
const bun = @import("root").bun;
const HDRHistogram = @import("hdr_histogram.zig").HDRHistogram;
const meta = bun.meta;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;

// Wrapper around HRD Histogram
pub const RecordableHistogram = struct {
    pub usingnamespace JSC.Codegen.JSRecordableHistogram;
    hdrHist: HDRHistogram,

    // RecordableHistogram specific internals
    delta_start: ?bun.timespec = null,

    const This = @This();
    const PropertyGetter = fn (this: *This, globalThis: *JSC.JSGlobalObject) JSC.JSValue;

    pub fn min(this: *This, globalThis: *JSC.JSGlobalObject) JSValue {
        return globalThis.toJS(this.hdrHist.min, .temporary);
    }
    pub const minBigInt = getterAsFn(min);

    pub fn max(this: *This, globalThis: *JSC.JSGlobalObject) JSValue {
        return globalThis.toJS(this.hdrHist.max, .temporary);
    }
    pub const maxBigInt = getterAsFn(max);

    pub fn count(this: *This, globalThis: *JSC.JSGlobalObject) JSValue {
        return globalThis.toJS(this.hdrHist.total_count, .temporary);
    }
    pub const countBigInt = getterAsFn(count);

    pub fn mean(this: *This, globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.hdrHist.mean()) |m| {
            return globalThis.toJS(m, .temporary);
        }
        return globalThis.toJS(std.math.nan(f64), .temporary);
    }

    pub fn stddev(this: *This, globalThis: *JSC.JSGlobalObject) JSValue {
        if (this.hdrHist.stddev()) |sd| {
            return globalThis.toJS(sd, .temporary);
        }
        return globalThis.toJS(std.math.nan(f64), .temporary);
    }

    pub fn percentile(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        const args = callframe.arguments(1).slice();
        if (args.len < 1) {
            globalThis.throwInvalidArguments("Expected query percent as argument", .{});
            return .zero;
        }
        const percent = args[0].getNumber() orelse {
            globalThis.throwInvalidArguments("Expected a number", .{});
            return .zero;
        };
        const value = this.hdrHist.value_at_percentile(percent) orelse return .undefined;
        return globalThis.toJS(value, .temporary);
    }
    pub const percentileBigInt = percentile;

    pub fn percentiles(this: *This, globalObject: *JSC.JSGlobalObject) JSValue {

        // 2 arrays with percent and value
        // make a cpp version of this file, extern C function. accepts array, length, creates search JSMap:: (search)

        // first get 100th percentile, and loop 0, 50, 75, 82.5, ... until we find the highest percentile
        const maxPercentileValue = this.hdrHist.value_at_percentile(100) orelse return .undefined;
        var percent: f64 = 0;
        var stack_allocator = std.heap.stackFallback(4096, bun.default_allocator);
        var kvs = std.ArrayList(JSValue.DoubleToIntMapKV).init(stack_allocator.get());
        defer kvs.deinit();

        while (true) {
            if (this.hdrHist.value_at_percentile(percent)) |val| {
                const kv = JSValue.DoubleToIntMapKV{ .key = percent, .value = val };
                kvs.append(kv) catch {
                    globalObject.throwOutOfMemory();
                    return .undefined;
                };
                if (val >= maxPercentileValue) {
                    break;
                }
            }
            percent += ((100 - percent) / 2);
        }

        kvs.append(JSValue.DoubleToIntMapKV{ .key = 100, .value = maxPercentileValue }) catch {
            globalObject.throwOutOfMemory();
            return .undefined;
        };

        return globalObject.toJS(JSValue.createMapFromDoubleUint64KVArray(globalObject, kvs.items), .temporary);
    }
    pub const percentilesBigInt = getterAsFn(percentiles);

    //
    // additional functions

    // record duration in nanoseconds
    pub fn record(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        const args = callframe.arguments(1).slice();
        if (args.len < 1) {
            globalThis.throwInvalidArguments("Expected the value to record as an argument", .{});
            return .zero;
        }
        const value = args[0].to(u64);
        this.hdrHist.record_value(value, 1);
        return .undefined;
    }

    // record time since last call to recordDelta
    pub fn recordDelta(this: *This, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(JSC.conv) JSValue {
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

    pub fn reset(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        _ = globalThis;
        _ = callframe;
        this.hdrHist.reset();
        return .undefined;
    }

    pub fn add(this: *This, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        const args = callframe.arguments(1).slice();
        if (args.len < 1) {
            globalThis.throwInvalidArguments("Expected other histogram to add as an argument", .{});
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
    ) JSValue) fn (
        this: *This,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(JSC.conv) JSValue {
        const outer = struct {
            pub fn inner(this: *This, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(JSC.conv) JSValue {
                // we don't need the callframe, so we can just call the callback
                return callback(this, globalThis);
            }
        };
        return outer.inner;
    }

    // since we create this with bun.new, we need to have it be destroyable
    // our node.classes.ts has finalize=true to generate the call to finalize
    pub fn finalize(this: *This) callconv(JSC.conv) void {
        this.hdrHist.deinit();
        bun.destroy(this);
    }
};

fn createHistogram(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const hdrHist = HDRHistogram.init(bun.default_allocator, .{}) catch |err| {
        globalThis.throwError(err, "failed to initialize histogram");
        return .zero;
    };
    var histogram = bun.new(RecordableHistogram, .{ .hdrHist = hdrHist });
    return histogram.toJS(globalThis);
}

pub fn createPerfHooksHistogramBinding(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
    return JSC.JSFunction.create(
        global,
        "createHistogram",
        createHistogram,
        3, // function length
        .{},
    );
}
