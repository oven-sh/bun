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

    pub fn fromType(comptime T: type) Tag {
        return switch (T) {
            server.HTTPServer.RequestContext => .HTTPServerRequestContext,
            server.HTTPSServer.RequestContext => .HTTPSServerRequestContext,
            server.DebugHTTPServer.RequestContext => .DebugHTTPServerRequestContext,
            server.DebugHTTPSServer.RequestContext => .DebugHTTPSServerRequestContext,
            bun.webcore.Body.ValueBufferer => .BodyValueBufferer,
            else => @compileError("NativePromiseContext.Tag: unsupported type " ++ @typeName(T)),
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
pub export fn Bun__NativePromiseContext__destroy(ctx: *anyopaque, tag: u8) callconv(.c) void {
    switch (@as(Tag, @enumFromInt(tag))) {
        .HTTPServerRequestContext => @as(*server.HTTPServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
        .HTTPSServerRequestContext => @as(*server.HTTPSServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
        .DebugHTTPServerRequestContext => @as(*server.DebugHTTPServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
        .DebugHTTPSServerRequestContext => @as(*server.DebugHTTPSServer.RequestContext, @ptrCast(@alignCast(ctx))).deref(),
        .BodyValueBufferer => {
            // ValueBufferer is embedded by value inside HTMLRewriter's
            // BufferOutputSink, with the owner pointer stored in .ctx. The
            // pending-promise ref was taken on the owner, so we release it.
            const bufferer: *bun.webcore.Body.ValueBufferer = @ptrCast(@alignCast(ctx));
            @as(*HTMLRewriter.BufferOutputSink, @ptrCast(@alignCast(bufferer.ctx))).deref();
        },
    }
}

comptime {
    _ = &Bun__NativePromiseContext__destroy;
}

const bun = @import("bun");
const jsc = bun.jsc;

const server = bun.api.server;
const HTMLRewriter = bun.api.HTMLRewriter.HTMLRewriter;
