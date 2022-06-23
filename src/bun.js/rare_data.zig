const EditorContext = @import("../open.zig").EditorContext;
const Blob = @import("./webcore/response.zig").Blob;
const default_allocator = @import("../global.zig").default_allocator;
const Output = @import("../global.zig").Output;
const RareData = @This();
const Syscall = @import("./node/syscall.zig");
const JSC = @import("javascript_core");
const std = @import("std");
const BoringSSL = @import("boringssl");
const WebSocketClientMask = @import("../http/websocket_http_client.zig").Mask;

boring_ssl_engine: ?*BoringSSL.ENGINE = null,
editor_context: EditorContext = EditorContext{},
stderr_store: ?*Blob.Store = null,
stdin_store: ?*Blob.Store = null,
stdout_store: ?*Blob.Store = null,
websocket_mask: WebSocketClientMask = WebSocketClientMask{},

// TODO: make this per JSGlobalObject instead of global
// This does not handle ShadowRealm correctly!
tail_cleanup_hook: ?*CleanupHook = null,
cleanup_hook: ?*CleanupHook = null,

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
