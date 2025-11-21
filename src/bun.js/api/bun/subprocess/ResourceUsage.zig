const ResourceUsage = @This();

pub const js = jsc.Codegen.JSResourceUsage;
pub const toJS = ResourceUsage.js.toJS;
pub const fromJS = ResourceUsage.js.fromJS;
pub const fromJSDirect = ResourceUsage.js.fromJSDirect;

rusage: Rusage,

pub fn create(rusage: *const Rusage, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return bun.new(ResourceUsage, .{ .rusage = rusage.* }).toJS(globalObject);
}

pub fn getCPUTime(this: *ResourceUsage, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    var cpu = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    const rusage = this.rusage;

    const usrTime = try JSValue.fromTimevalNoTruncate(globalObject, rusage.utime.usec, rusage.utime.sec);
    const sysTime = try JSValue.fromTimevalNoTruncate(globalObject, rusage.stime.usec, rusage.stime.sec);

    cpu.put(globalObject, jsc.ZigString.static("user"), usrTime);
    cpu.put(globalObject, jsc.ZigString.static("system"), sysTime);
    cpu.put(globalObject, jsc.ZigString.static("total"), JSValue.bigIntSum(globalObject, usrTime, sysTime));

    return cpu;
}

pub fn getMaxRSS(this: *ResourceUsage, _: *JSGlobalObject) JSValue {
    return jsc.JSValue.jsNumber(this.rusage.maxrss);
}

pub fn getSharedMemorySize(this: *ResourceUsage, _: *JSGlobalObject) JSValue {
    return jsc.JSValue.jsNumber(this.rusage.ixrss);
}

pub fn getSwapCount(this: *ResourceUsage, _: *JSGlobalObject) JSValue {
    return jsc.JSValue.jsNumber(this.rusage.nswap);
}

pub fn getOps(this: *ResourceUsage, globalObject: *JSGlobalObject) JSValue {
    var ops = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    ops.put(globalObject, jsc.ZigString.static("in"), jsc.JSValue.jsNumber(this.rusage.inblock));
    ops.put(globalObject, jsc.ZigString.static("out"), jsc.JSValue.jsNumber(this.rusage.oublock));
    return ops;
}

pub fn getMessages(this: *ResourceUsage, globalObject: *JSGlobalObject) JSValue {
    var msgs = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    msgs.put(globalObject, jsc.ZigString.static("sent"), jsc.JSValue.jsNumber(this.rusage.msgsnd));
    msgs.put(globalObject, jsc.ZigString.static("received"), jsc.JSValue.jsNumber(this.rusage.msgrcv));
    return msgs;
}

pub fn getSignalCount(this: *ResourceUsage, _: *JSGlobalObject) JSValue {
    return jsc.JSValue.jsNumber(this.rusage.nsignals);
}

pub fn getContextSwitches(this: *ResourceUsage, globalObject: *JSGlobalObject) JSValue {
    var ctx = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
    ctx.put(globalObject, jsc.ZigString.static("voluntary"), jsc.JSValue.jsNumber(this.rusage.nvcsw));
    ctx.put(globalObject, jsc.ZigString.static("involuntary"), jsc.JSValue.jsNumber(this.rusage.nivcsw));
    return ctx;
}

pub fn finalize(this: *ResourceUsage) callconv(.c) void {
    bun.destroy(this);
}

const bun = @import("bun");
const Rusage = bun.spawn.Rusage;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
