const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const UUID = bun.UUID;
const ObjectURLRegistry = @This();

lock: bun.Mutex = .{},
map: std.AutoHashMap(UUID, *Entry) = std.AutoHashMap(UUID, *Entry).init(bun.default_allocator),

pub const Entry = struct {
    blob: JSC.WebCore.Blob,

    pub const new = bun.TrivialNew(@This());
    pub fn init(blob: *const JSC.WebCore.Blob) *Entry {
        return Entry.new(.{
            .blob = blob.dupeWithContentType(true),
        });
    }

    pub fn deinit(this: *Entry) void {
        this.blob.deinit();
        bun.destroy(this);
    }
};

pub fn register(this: *ObjectURLRegistry, vm: *JSC.VirtualMachine, blob: *const JSC.WebCore.Blob) UUID {
    const uuid = vm.rareData().nextUUID();
    const entry = Entry.init(blob);

    this.lock.lock();
    defer this.lock.unlock();
    this.map.put(uuid, entry) catch bun.outOfMemory();
    return uuid;
}

pub fn singleton() *ObjectURLRegistry {
    const Singleton = struct {
        pub var registry: ObjectURLRegistry = undefined;
        pub var once = std.once(get);

        fn get() void {
            registry = .{};
        }
    };

    Singleton.once.call();

    return &Singleton.registry;
}

fn getDupedBlob(this: *ObjectURLRegistry, uuid: *const UUID) ?JSC.WebCore.Blob {
    this.lock.lock();
    defer this.lock.unlock();
    const entry = this.map.get(uuid.*) orelse return null;
    return entry.blob.dupeWithContentType(true);
}

fn uuidFromPathname(pathname: []const u8) ?UUID {
    return UUID.parse(pathname) catch return null;
}

pub fn resolveAndDupe(this: *ObjectURLRegistry, pathname: []const u8) ?JSC.WebCore.Blob {
    const uuid = uuidFromPathname(pathname) orelse return null;
    this.lock.lock();
    defer this.lock.unlock();
    const entry = this.map.get(uuid) orelse return null;
    return entry.blob.dupeWithContentType(true);
}

pub fn resolveAndDupeToJS(this: *ObjectURLRegistry, pathname: []const u8, globalObject: *JSC.JSGlobalObject) ?JSC.JSValue {
    var blob = JSC.WebCore.Blob.new(this.resolveAndDupe(pathname) orelse return null);
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalObject);
}

pub fn revoke(this: *ObjectURLRegistry, pathname: []const u8) void {
    const uuid = uuidFromPathname(pathname) orelse return;
    this.lock.lock();
    defer this.lock.unlock();
    const entry = this.map.fetchRemove(uuid) orelse return;
    entry.value.deinit();
}

pub fn has(this: *ObjectURLRegistry, pathname: []const u8) bool {
    const uuid = uuidFromPathname(pathname) orelse return false;
    this.lock.lock();
    defer this.lock.unlock();
    return this.map.contains(uuid);
}

comptime {
    const Bun__createObjectURL = JSC.toJSHostFn(Bun__createObjectURL_);
    @export(&Bun__createObjectURL, .{ .name = "Bun__createObjectURL" });
}
fn Bun__createObjectURL_(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("createObjectURL", 1, arguments.len);
    }
    const blob = arguments.ptr[0].as(JSC.WebCore.Blob) orelse {
        return globalObject.throwInvalidArguments("createObjectURL expects a Blob object", .{});
    };
    const registry = ObjectURLRegistry.singleton();
    const uuid = registry.register(globalObject.bunVM(), blob);
    var str = bun.String.createFormat("blob:{}", .{uuid}) catch bun.outOfMemory();
    return str.transferToJS(globalObject);
}

comptime {
    const Bun__revokeObjectURL = JSC.toJSHostFn(Bun__revokeObjectURL_);
    @export(&Bun__revokeObjectURL, .{ .name = "Bun__revokeObjectURL" });
}
fn Bun__revokeObjectURL_(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("revokeObjectURL", 1, arguments.len);
    }
    if (!arguments.ptr[0].isString()) {
        return globalObject.throwInvalidArguments("revokeObjectURL expects a string", .{});
    }
    const str = arguments.ptr[0].toBunString(globalObject) catch @panic("unreachable");
    if (!str.hasPrefixComptime("blob:")) {
        return .js_undefined;
    }

    const slice = str.toUTF8WithoutRef(bun.default_allocator);
    defer slice.deinit();
    defer str.deref();

    const sliced = slice.slice();
    if (sliced.len < "blob:".len + UUID.stringLength) {
        return .js_undefined;
    }
    ObjectURLRegistry.singleton().revoke(sliced["blob:".len..]);
    return .js_undefined;
}

comptime {
    const jsFunctionResolveObjectURL = JSC.toJSHostFn(jsFunctionResolveObjectURL_);
    @export(&jsFunctionResolveObjectURL, .{ .name = "jsFunctionResolveObjectURL" });
}
fn jsFunctionResolveObjectURL_(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);

    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if (arguments.len < 1) {
        return .js_undefined;
    }
    const str = try arguments.ptr[0].toBunString(globalObject);
    defer str.deref();

    if (globalObject.hasException()) {
        return .zero;
    }

    if (!str.hasPrefixComptime("blob:") or str.length() < specifier_len) {
        return .js_undefined;
    }

    const slice = str.toUTF8WithoutRef(bun.default_allocator);
    defer slice.deinit();
    const sliced = slice.slice();

    const registry = ObjectURLRegistry.singleton();
    const blob = registry.resolveAndDupeToJS(sliced["blob:".len..], globalObject);
    return blob orelse .js_undefined;
}

pub const specifier_len = "blob:".len + UUID.stringLength;

pub fn isBlobURL(url: []const u8) bool {
    return url.len >= specifier_len and bun.strings.hasPrefixComptime(url, "blob:");
}
