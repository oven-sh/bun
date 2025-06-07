const ResourceUsage = @This();

rusage: Rusage,

pub fn create(rusage: *const Rusage, globalObject: *JSGlobalObject) JSValue {
    const resource_usage = ResourceUsage{
        .rusage = rusage.*,
    };

    var result = bun.default_allocator.create(ResourceUsage) catch {
        return globalObject.throwOutOfMemoryValue();
    };
    result.* = resource_usage;
    return result.toJS(globalObject);
}

pub fn getCPUTime(
    this: *ResourceUsage,
    globalObject: *JSGlobalObject,
) JSValue {
    var cpu = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    const rusage = this.rusage;

    const usrTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.utime.usec, rusage.utime.sec);
    const sysTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.stime.usec, rusage.stime.sec);

    cpu.put(globalObject, JSC.ZigString.static("user"), usrTime);
    cpu.put(globalObject, JSC.ZigString.static("system"), sysTime);
    cpu.put(globalObject, JSC.ZigString.static("total"), JSValue.bigIntSum(globalObject, usrTime, sysTime));

    return cpu;
}

pub fn getMaxRSS(
    this: *ResourceUsage,
    _: *JSGlobalObject,
) JSValue {
    return JSC.JSValue.jsNumber(this.rusage.maxrss);
}

pub fn getSharedMemorySize(
    this: *ResourceUsage,
    _: *JSGlobalObject,
) JSValue {
    return JSC.JSValue.jsNumber(this.rusage.ixrss);
}

pub fn getSwapCount(
    this: *ResourceUsage,
    _: *JSGlobalObject,
) JSValue {
    return JSC.JSValue.jsNumber(this.rusage.nswap);
}

pub fn getOps(
    this: *ResourceUsage,
    globalObject: *JSGlobalObject,
) JSValue {
    var ops = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    ops.put(globalObject, JSC.ZigString.static("in"), JSC.JSValue.jsNumber(this.rusage.inblock));
    ops.put(globalObject, JSC.ZigString.static("out"), JSC.JSValue.jsNumber(this.rusage.oublock));
    return ops;
}

pub fn getMessages(
    this: *ResourceUsage,
    globalObject: *JSGlobalObject,
) JSValue {
    var msgs = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    msgs.put(globalObject, JSC.ZigString.static("sent"), JSC.JSValue.jsNumber(this.rusage.msgsnd));
    msgs.put(globalObject, JSC.ZigString.static("received"), JSC.JSValue.jsNumber(this.rusage.msgrcv));
    return msgs;
}

pub fn getSignalCount(
    this: *ResourceUsage,
    _: *JSGlobalObject,
) JSValue {
    return JSC.JSValue.jsNumber(this.rusage.nsignals);
}

pub fn getContextSwitches(
    this: *ResourceUsage,
    globalObject: *JSGlobalObject,
) JSValue {
    var ctx = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    ctx.put(globalObject, JSC.ZigString.static("voluntary"), JSC.JSValue.jsNumber(this.rusage.nvcsw));
    ctx.put(globalObject, JSC.ZigString.static("involuntary"), JSC.JSValue.jsNumber(this.rusage.nivcsw));
    return ctx;
}

pub fn finalize(this: *ResourceUsage) callconv(.C) void {
    bun.default_allocator.destroy(this);
}

pub const js = JSC.Codegen.JSResourceUsage;
pub const toJS = ResourceUsage.js.toJS;
pub const fromJS = ResourceUsage.js.fromJS;
pub const fromJSDirect = ResourceUsage.js.fromJSDirect;

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;

const Rusage = bun.spawn.Rusage;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const Subprocess = JSC.API.Subprocess;
const Environment = bun.Environment;
const PosixSpawn = bun.spawn;
