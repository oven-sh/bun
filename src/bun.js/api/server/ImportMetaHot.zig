//! Implements the `import.meta.hot` object for `bun --hot` mode.
//! Provides HMR API: data, accept(), dispose(), decline(), invalidate().
//! Per-module state (data, dispose callbacks) is stored in VirtualMachine.
pub const ImportMetaHot = @This();
pub const js = jsc.Codegen.JSImportMetaHot;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// Module URL identifying which module this hot object belongs to.
/// Owned copy — freed on finalize.
module_url: []const u8,

pub fn init(module_url: []const u8) *ImportMetaHot {
    return bun.new(ImportMetaHot, .{
        .module_url = bun.handleOom(bun.default_allocator.dupe(u8, module_url)),
    });
}

pub fn finalize(this: *ImportMetaHot) void {
    this.deinit();
}

fn deinit(this: *ImportMetaHot) void {
    bun.default_allocator.free(this.module_url);
    bun.destroy(this);
}

/// Returns the persistent `data` object for this module.
/// The data object survives across hot reloads.
pub fn getData(this: *ImportMetaHot, globalObject: *JSGlobalObject) JSValue {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);

    if (state.data.get()) |val| {
        return val;
    }

    // Create a fresh empty object as the initial data
    const data_obj = JSValue.createEmptyObject(globalObject, 0);
    state.data = jsc.Strong.Optional.create(data_obj, globalObject);
    return data_obj;
}

/// Sets the persistent `data` object for this module.
pub fn setData(this: *ImportMetaHot, globalObject: *JSGlobalObject, value: JSValue) void {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);

    state.data.deinit();
    state.data = jsc.Strong.Optional.create(value, globalObject);
}

/// Marks this module as accepting hot updates.
/// accept() with no args = self-accepting module.
/// accept(cb) = call cb when this module is updated.
pub fn accept(
    this: *ImportMetaHot,
    globalObject: *JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);
    state.accepted = true;

    const cb = callframe.argument(0);
    if (cb != .js_undefined and cb.isCallable()) {
        state.accept_callbacks.append(bun.default_allocator, jsc.Strong.create(cb, globalObject)) catch bun.outOfMemory();
    }

    return .js_undefined;
}

/// Registers a callback to run when this module is about to be replaced.
/// The callback receives the module's current `data` object for state transfer.
pub fn dispose(
    this: *ImportMetaHot,
    globalObject: *JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);

    const cb = callframe.argument(0);
    if (cb != .js_undefined and cb.isCallable()) {
        state.dispose_callbacks.append(bun.default_allocator, jsc.Strong.create(cb, globalObject)) catch bun.outOfMemory();
    }

    return .js_undefined;
}

/// Marks this module as not hot-replaceable.
/// Changes to this module will trigger a full reload.
pub fn decline(
    this: *ImportMetaHot,
    globalObject: *JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);
    state.declined = true;
    return .js_undefined;
}

/// Marks this module as requiring a full reload on next change.
/// The actual reload is handled by the hot reloader in the next file-change cycle.
pub fn invalidate(
    this: *ImportMetaHot,
    globalObject: *JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    const vm = globalObject.bunVM();
    const state = vm.getOrCreateHotModuleState(this.module_url);
    state.invalidated = true;
    return .js_undefined;
}

/// Estimator for GC memory cost reporting.
pub fn estimatedSize(this: *const ImportMetaHot) usize {
    return this.module_url.len + @sizeOf(ImportMetaHot);
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
