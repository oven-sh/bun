const Mutex = @This();

pub const js = jsc.Codegen.JSMutex;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

mutex: bun.Mutex = .{},

pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*Mutex {
    const alloc = bun.default_allocator;
    const mutex = bun.handleOom(alloc.create(Mutex));
    mutex.* = .{};
    return mutex;
}

pub fn finalize(this: *Mutex) callconv(.c) void {
    const alloc = jsc.VirtualMachine.get().allocator;
    alloc.destroy(this);
}

pub fn lock(this: *Mutex, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.mutex.lock();
    return .js_undefined;
}

pub fn unlock(this: *Mutex, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.mutex.unlock();
    return .js_undefined;
}

pub fn tryLock(this: *Mutex, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const acquired = this.mutex.tryLock();
    return jsc.JSValue.jsBoolean(acquired);
}

const bun = @import("root").bun;

const jsc = @import("root").bun.JSC;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

