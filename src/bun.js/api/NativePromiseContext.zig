//! Zig bindings for the NativePromiseContext JSCell.
//!
//! See src/bun.js/bindings/NativePromiseContext.h for the rationale. Short
//! version: when native code `.then()`s a user Promise and needs a context
//! pointer, wrap the pointer in this GC-managed cell instead of passing it
//! raw. If the Promise never settles, GC collects the cell and the destructor
//! releases the ref — no leak, no use-after-free.
//!
//! Usage pattern:
//!
//!     ctx.ref();
//!     const cell = NativePromiseContext.create(global, ctx);
//!     try promise.thenWithValue(global, cell, onResolve, onReject);
//!
//!     // In onResolve/onReject:
//!     const ctx = NativePromiseContext.take(RequestContext, arguments.ptr[1]) orelse return;
//!     defer ctx.deref();
//!     // ... process ...

pub const NativePromiseContext = @This();

/// Must match Bun::NativePromiseContext::Tag in NativePromiseContext.h.
/// One entry per concrete native type — the tag is packed into the pointer's
/// upper bits via CompactPointerTuple so the cell stays at one pointer of
/// storage beyond the JSCell header.
pub const Tag = enum(u8) {
    HTTPServerRequestContext,
    HTTPSServerRequestContext,
    DebugHTTPServerRequestContext,
    DebugHTTPSServerRequestContext,
    BodyValueBufferer,
    HTTPSServerH3RequestContext,
    DebugHTTPSServerH3RequestContext,

    pub fn fromType(comptime T: type) Tag {
        return switch (T) {
            server.HTTPServer.RequestContext => .HTTPServerRequestContext,
            server.HTTPSServer.RequestContext => .HTTPSServerRequestContext,
            server.DebugHTTPServer.RequestContext => .DebugHTTPServerRequestContext,
            server.DebugHTTPSServer.RequestContext => .DebugHTTPSServerRequestContext,
            bun.webcore.Body.ValueBufferer => .BodyValueBufferer,
            else => if (!bun.Environment.isWindows) switch (T) {
                server.HTTPSServer.H3RequestContext => .HTTPSServerH3RequestContext,
                server.DebugHTTPSServer.H3RequestContext => .DebugHTTPSServerH3RequestContext,
                else => @compileError("NativePromiseContext.Tag: unsupported type " ++ @typeName(T)),
            } else @compileError("NativePromiseContext.Tag: unsupported type " ++ @typeName(T)),
        };
    }
};

extern fn Bun__NativePromiseContext__create(global: *jsc.JSGlobalObject, ctx: *anyopaque, tag: u8) jsc.JSValue;
extern fn Bun__NativePromiseContext__take(value: jsc.JSValue) ?*anyopaque;

/// The caller must have already taken a ref on `ctx`. The returned cell owns
/// that ref until `take()` transfers it back or GC runs the destructor.
pub fn create(global: *jsc.JSGlobalObject, ctx: anytype) jsc.JSValue {
    const T = @typeInfo(@TypeOf(ctx)).pointer.child;
    return Bun__NativePromiseContext__create(global, ctx, @intFromEnum(Tag.fromType(T)));
}

/// Transfers the ref back to the caller and nulls the cell so the destructor
/// is a no-op. Returns null if already taken (e.g., the connection aborted
/// and the ref was released via the destructor on a prior GC cycle).
pub fn take(comptime T: type, cell: jsc.JSValue) ?*T {
    return @ptrCast(@alignCast(Bun__NativePromiseContext__take(cell)));
}

/// Called from the C++ destructor when a cell is collected with a non-null
/// pointer (i.e., `take()` was never called — the Promise was GC'd without
/// settling).
///
/// The destructor runs during GC sweep, so it is NOT safe to do anything
/// that might touch the JSC heap. RequestContext.deref() can trigger
/// deinit() which detaches responses, unrefs bodies, and calls back into
/// the server — all of which may unprotect JS values or allocate. We must
/// defer that work to the event loop.
pub export fn Bun__NativePromiseContext__destroy(ctx: *anyopaque, tag: u8) callconv(.c) void {
    DeferredDerefTask.schedule(ctx, @enumFromInt(tag));
}

comptime {
    _ = &Bun__NativePromiseContext__destroy;
}

/// Defers the GC-triggered deref to the next event-loop tick so it runs
/// outside the sweep phase.
///
/// Zero-allocation: the ctx pointer and our Tag are packed into the task's
/// `_ptr` slot (pointer in high bits, tag in low 3 bits — the target types
/// are all >= 8-byte aligned). See PosixSignalTask for the same trick with
/// signal numbers.
///
/// Layout inside jsc.Task's packed u64 after setUintptr:
///
///     bits 63..49  bits 48..3           bits 2..0
///     ┌──────────┬────────────────────┬─────────┐
///     │ data=u15 │ ctx ptr (aligned)  │ our Tag │
///     └──────────┴────────────────────┴─────────┘
///          ▲              ▲                 ▲
///          │              └─────────┬───────┘
///      Task union           _ptr (u49) — set by setUintptr
///      discriminant
///      (set by init,
///       untouched)
///
/// setUintptr only writes _ptr; the Task discriminant in data that
/// Task.init(&marker) stamped stays put. @truncate to u49 keeps the low
/// bits, so both the ctx pointer (bits 3..48) and our Tag (bits 0..2)
/// survive.
pub const DeferredDerefTask = struct {
    const tag_mask: usize = 0b111;
    comptime {
        // Low 3 bits hold the tag; verify both capacity and alignment
        // slack so adding a tag or a packed field can't silently break
        // the packing.
        bun.assert(@typeInfo(Tag).@"enum".fields.len <= tag_mask + 1);
        bun.assert(@alignOf(server.HTTPServer.RequestContext) > tag_mask);
        bun.assert(@alignOf(server.HTTPSServer.RequestContext) > tag_mask);
        bun.assert(@alignOf(server.DebugHTTPServer.RequestContext) > tag_mask);
        bun.assert(@alignOf(server.DebugHTTPSServer.RequestContext) > tag_mask);
        bun.assert(@alignOf(bun.webcore.Body.ValueBufferer) > tag_mask);
    }

    pub fn schedule(ctx: *anyopaque, tag: Tag) void {
        const vm = jsc.VirtualMachine.get();
        // Process is dying; the leak no longer matters and the task
        // queue won't drain.
        if (vm.isShuttingDown()) return;

        const addr = @intFromPtr(ctx);
        bun.debugAssert(addr & tag_mask == 0);

        var marker: DeferredDerefTask = undefined;
        var task = jsc.Task.init(&marker);
        task.setUintptr(@truncate(addr | @intFromEnum(tag)));
        vm.eventLoop().enqueueTask(task);
    }

    pub fn runFromJSThread(packed_ptr: usize) void {
        const tag: Tag = @enumFromInt(packed_ptr & tag_mask);
        const ctx: *anyopaque = @ptrFromInt(packed_ptr & ~tag_mask);
        switch (tag) {
            .HTTPServerRequestContext => @as(*server.HTTPServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
            .HTTPSServerRequestContext => @as(*server.HTTPSServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
            .DebugHTTPServerRequestContext => @as(*server.DebugHTTPServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
            .DebugHTTPSServerRequestContext => @as(*server.DebugHTTPSServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
            .BodyValueBufferer => {
                // ValueBufferer is embedded by value inside HTMLRewriter's
                // BufferOutputSink, with the owner pointer stored in .ctx.
                // The pending-promise ref was taken on the owner, so we
                // release it there.
                const bufferer: *bun.webcore.Body.ValueBufferer = @ptrCast(@alignCast(ctx));
                @as(*HTMLRewriter.BufferOutputSink, @ptrCast(@alignCast(bufferer.ctx))).deref();
            },
            .HTTPSServerH3RequestContext => if (comptime bun.Environment.isWindows) unreachable else @as(*server.HTTPSServer.H3RequestContext, @ptrCast(@alignCast(ctx))).deref(),
            .DebugHTTPSServerH3RequestContext => if (comptime bun.Environment.isWindows) unreachable else @as(*server.DebugHTTPSServer.H3RequestContext, @ptrCast(@alignCast(ctx))).deref(),
        }
    }
};

const bun = @import("bun");
const jsc = bun.jsc;

const server = bun.api.server;
const HTMLRewriter = bun.api.HTMLRewriter.HTMLRewriter;
