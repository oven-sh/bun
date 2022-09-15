const EditorContext = @import("../open.zig").EditorContext;
const Blob = @import("./webcore/response.zig").Blob;
const default_allocator = @import("../global.zig").default_allocator;
const Output = @import("../global.zig").Output;
const RareData = @This();
const Syscall = @import("./node/syscall.zig");
const JSC = @import("javascript_core");
const std = @import("std");
const BoringSSL = @import("boringssl");
const bun = @import("../global.zig");
const WebSocketClientMask = @import("../http/websocket_http_client.zig").Mask;

boring_ssl_engine: ?*BoringSSL.ENGINE = null,
editor_context: EditorContext = EditorContext{},
stderr_store: ?*Blob.Store = null,
stdin_store: ?*Blob.Store = null,
stdout_store: ?*Blob.Store = null,

entropy_cache: ?*EntropyCache = null,

// TODO: make this per JSGlobalObject instead of global
// This does not handle ShadowRealm correctly!
tail_cleanup_hook: ?*CleanupHook = null,
cleanup_hook: ?*CleanupHook = null,

pub fn nextUUID(this: *RareData) [16]u8 {
    if (this.entropy_cache == null) {
        this.entropy_cache = default_allocator.create(EntropyCache) catch unreachable;
        this.entropy_cache.?.init();
    }

    return this.entropy_cache.?.get();
}

pub fn entropySlice(this: *RareData, len: usize) []u8 {
    if (this.entropy_cache == null) {
        this.entropy_cache = default_allocator.create(EntropyCache) catch unreachable;
        this.entropy_cache.?.init();
    }

    return this.entropy_cache.?.slice(len);
}

pub const EntropyCache = struct {
    pub const buffered_uuids_count = 16;
    pub const size = buffered_uuids_count * 128;

    cache: [size]u8 = undefined,
    index: usize = 0,

    pub fn init(instance: *EntropyCache) void {
        instance.fill();
    }

    pub fn fill(this: *EntropyCache) void {
        bun.rand(&this.cache);
        this.index = 0;
    }

    pub fn slice(this: *EntropyCache, len: usize) []u8 {
        if (len > this.cache.len) {
            return &[_]u8{};
        }

        if (this.index + len > this.cache.len) {
            this.fill();
        }
        const result = this.cache[this.index..][0..len];
        this.index += len;
        return result;
    }

    pub fn get(this: *EntropyCache) [16]u8 {
        if (this.index + 16 > this.cache.len) {
            this.fill();
        }
        const result = this.cache[this.index..][0..16].*;
        this.index += 16;
        return result;
    }
};

pub const CleanupHook = struct {
    next: ?*CleanupHook = null,
    ctx: ?*anyopaque,
    func: Function,
    globalThis: *JSC.JSGlobalObject,

    pub fn eql(self: CleanupHook, other: CleanupHook) bool {
        return self.ctx == other.ctx and self.func == other.func and self.globalThis == other.globalThis;
    }

    pub fn execute(self: CleanupHook) void {
        self.func(self.ctx);
    }

    pub fn from(
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        func: CleanupHook.Function,
    ) CleanupHook {
        return .{
            .next = null,
            .ctx = ctx,
            .func = func,
            .globalThis = globalThis,
        };
    }

    pub const Function = fn (?*anyopaque) callconv(.C) void;
};

pub fn pushCleanupHook(
    this: *RareData,
    globalThis: *JSC.JSGlobalObject,
    ctx: ?*anyopaque,
    func: CleanupHook.Function,
) void {
    var hook = JSC.VirtualMachine.vm.allocator.create(CleanupHook) catch unreachable;
    hook.* = CleanupHook.from(globalThis, ctx, func);
    if (this.cleanup_hook == null) {
        this.cleanup_hook = hook;
        this.tail_cleanup_hook = hook;
    } else {
        this.cleanup_hook.?.next = hook;
    }
}

pub fn boringEngine(rare: *RareData) *BoringSSL.ENGINE {
    return rare.boring_ssl_engine orelse brk: {
        rare.boring_ssl_engine = BoringSSL.ENGINE_new();
        break :brk rare.boring_ssl_engine.?;
    };
}

pub fn stderr(rare: *RareData) *Blob.Store {
    return rare.stderr_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDERR_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }

        store.* = Blob.Store{
            .ref_count = 2,
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDERR_FILENO,
                    },
                    .is_atty = Output.stderr_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        };
        rare.stderr_store = store;
        break :brk store;
    };
}

pub fn stdout(rare: *RareData) *Blob.Store {
    return rare.stdout_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDOUT_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }
        store.* = Blob.Store{
            .ref_count = 2,
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDOUT_FILENO,
                    },
                    .is_atty = Output.stdout_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        };
        rare.stdout_store = store;
        break :brk store;
    };
}

pub fn stdin(rare: *RareData) *Blob.Store {
    return rare.stdin_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDIN_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }
        store.* = Blob.Store{
            .allocator = default_allocator,
            .ref_count = 2,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDIN_FILENO,
                    },
                    .is_atty = std.os.isatty(std.os.STDIN_FILENO),
                    .mode = mode,
                },
            },
        };
        rare.stdin_store = store;
        break :brk store;
    };
}
