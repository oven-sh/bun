//! Auto-instrumentation primitives. The active span propagates through async
//! continuations by riding the SAME `m_asyncContextData` internal field 0 that
//! `AsyncLocalStorage` uses — no extra Promise reaction fields. The slot value
//! is polymorphic:
//!
//!   undefined         no async context at all
//!   OtelSpanContext   active span only (cheap path: one cell, no Array)
//!   JSArray           ALS map [k0,v0,k1,v1,...]; if k0 == null then v0 is
//!                     the OtelSpanContext carried alongside ALS entries
//!
//! `NativeSpan` is the pure-Zig recording span used by RequestContext /
//! FetchTasklet so the auto-instrumented hot path never allocates a JS
//! `OtelSpan` wrapper.

extern fn Bun__getAsyncContextSlot(global: *JSGlobalObject) JSValue;
extern fn Bun__setAsyncContextSlot(global: *JSGlobalObject, value: JSValue) void;
extern fn Bun__enableAsyncContextTracking(global: *JSGlobalObject) void;

pub fn enableTracking(global: *JSGlobalObject) void {
    Bun__enableAsyncContextTracking(global);
}

pub fn getSlot(global: *JSGlobalObject) JSValue {
    return Bun__getAsyncContextSlot(global);
}

pub fn setSlot(global: *JSGlobalObject, value: JSValue) void {
    Bun__setAsyncContextSlot(global, value);
}

/// Read the active span context from the polymorphic slot. Returns null when
/// the slot is undefined, or holds only ALS data with no span sentinel.
pub fn getActiveSpanContext(global: *JSGlobalObject) ?model.SpanContext {
    const slot = getSlot(global);
    if (slot.isUndefinedOrNull()) return null;
    if (tracer.OtelSpanContext.fromJSDirect(slot)) |sc| return sc.ctx;
    // ALS array: if [0] == null, [1] is the OtelSpanContext.
    if (slot.isCell() and slot.jsType().isArray()) {
        const k0 = slot.getIndex(global, 0) catch return null;
        if (!k0.isNull()) return null;
        const v0 = slot.getIndex(global, 1) catch return null;
        if (tracer.OtelSpanContext.fromJSDirect(v0)) |sc| return sc.ctx;
    }
    return null;
}

/// Return the OtelSpanContext JSValue currently in the span position of the
/// slot, or `.null` if no span is active.
fn activeSpanCell(global: *JSGlobalObject) JSValue {
    const slot = getSlot(global);
    if (slot.isUndefinedOrNull()) return .null;
    if (tracer.OtelSpanContext.fromJSDirect(slot)) |_| return slot;
    if (slot.isCell() and slot.jsType().isArray()) {
        const k0 = slot.getIndex(global, 0) catch return .null;
        if (!k0.isNull()) return .null;
        const v0 = slot.getIndex(global, 1) catch return .null;
        if (tracer.OtelSpanContext.fromJSDirect(v0)) |_| return v0;
    }
    return .null;
}

/// Surgically replace the active-span position in the *current* slot with
/// `prev_cell` (the span cell that was active before `span_id` was pushed, or
/// `.null`). Only acts if `span_id` is the span currently on top — out-of-order
/// dispose leaves the slot untouched. ALS pairs that were added between
/// enter/restore are preserved.
pub fn surgicalRestoreSpan(global: *JSGlobalObject, span_id: model.SpanId, prev_cell: JSValue) void {
    const current = getSlot(global);
    if (tracer.OtelSpanContext.fromJSDirect(current)) |sc| {
        if (std.mem.eql(u8, &sc.ctx.span_id, &span_id)) setSlot(global, prev_cell);
        return;
    }
    if (current.isCell() and current.jsType().isArray()) {
        const len: u32 = @intCast(current.getLength(global) catch return);
        if (len < 2) return;
        const k0 = current.getIndex(global, 0) catch return;
        if (!k0.isNull()) return;
        const top = current.getIndex(global, 1) catch return;
        const sc = tracer.OtelSpanContext.fromJSDirect(top) orelse return;
        if (!std.mem.eql(u8, &sc.ctx.span_id, &span_id)) return;
        const new_slot = rebuildArrayForRestore(global, current, len, prev_cell) catch return;
        setSlot(global, new_slot);
    }
}

fn rebuildArrayForRestore(global: *JSGlobalObject, arr: JSValue, len: u32, prev_cell: JSValue) bun.JSError!JSValue {
    if (!prev_cell.isNull()) {
        const out = try JSValue.createEmptyArray(global, len);
        try out.putIndex(global, 0, .null);
        try out.putIndex(global, 1, prev_cell);
        var i: u32 = 2;
        while (i < len) : (i += 1) try out.putIndex(global, i, try arr.getIndex(global, i));
        return out;
    }
    if (len <= 2) return .null;
    const out = try JSValue.createEmptyArray(global, len - 2);
    var i: u32 = 2;
    var j: u32 = 0;
    while (i < len) : ({
        i += 1;
        j += 1;
    }) try out.putIndex(global, j, try arr.getIndex(global, i));
    return out;
}

/// Swap the active span for the duration of a synchronous JS call. `restore()`
/// surgically removes only this span from whatever the slot has become, so ALS
/// mutations made between enter/restore survive.
pub const SlotGuard = struct {
    global: *JSGlobalObject,
    /// Previous span cell that was active at `enter()`, or `.null`. NOT a full
    /// slot snapshot — that would clobber interleaved ALS state on restore.
    saved: JSValue,
    cell: JSValue,

    pub fn enter(global: *JSGlobalObject, cell: JSValue) SlotGuard {
        const prev_cell = activeSpanCell(global);
        const slot = getSlot(global);
        const new_slot = if (slot.isCell() and slot.jsType().isArray())
            buildArrayWithSpan(global, slot, cell)
        else
            cell;
        setSlot(global, new_slot);
        return .{ .global = global, .saved = prev_cell, .cell = cell };
    }

    pub fn restore(self: *const SlotGuard) void {
        const sc = tracer.OtelSpanContext.fromJSDirect(self.cell) orelse return;
        surgicalRestoreSpan(self.global, sc.ctx.span_id, self.saved);
    }
};

fn buildArrayWithSpan(global: *JSGlobalObject, prev_array: JSValue, cell: JSValue) JSValue {
    return buildArrayWithSpanImpl(global, prev_array, cell) catch cell;
}

fn buildArrayWithSpanImpl(global: *JSGlobalObject, prev_array: JSValue, cell: JSValue) bun.JSError!JSValue {
    const len: u32 = @intCast(try prev_array.getLength(global));
    const has_sentinel = len >= 2 and (try prev_array.getIndex(global, 0)).isNull();
    const start: u32 = if (has_sentinel) 2 else 0;
    const out = try JSValue.createEmptyArray(global, 2 + (len - start));
    try out.putIndex(global, 0, .null);
    try out.putIndex(global, 1, cell);
    var i: u32 = start;
    var j: u32 = 2;
    while (i < len) : ({
        i += 1;
        j += 1;
    }) {
        try out.putIndex(global, j, try prev_array.getIndex(global, i));
    }
    return out;
}

/// Pooled per-span scratch for start-time strings (path, UA, host, …) that the
/// hook needs at `end()` but which won't survive the request otherwise. Slots
/// are hook-interpreted; see each hook's comment for the index assignments.
pub const StrStash = struct {
    buf: [256]u8 = undefined,
    used: u16 = 0,
    /// Hook-specific named slots pointing into `buf` (or the overflow arena).
    s: [6][]const u8 = .{""} ** 6,
    /// Single integer slot (port, body_size, …).
    i: i64 = 0,
    /// Lazy heap arena for the rare case `buf` overflows.
    overflow: ?*std.heap.ArenaAllocator = null,

    pub fn push(self: *StrStash, str: []const u8) []const u8 {
        if (str.len == 0) return "";
        if (self.overflow == null) {
            const remaining = self.buf.len - self.used;
            if (str.len <= remaining) {
                const dst = self.buf[self.used..][0..str.len];
                @memcpy(dst, str);
                self.used += @intCast(str.len);
                return dst;
            }
        }
        const arena = self.overflow orelse blk: {
            const a = bun.new(std.heap.ArenaAllocator, std.heap.ArenaAllocator.init(bun.default_allocator));
            self.overflow = a;
            break :blk a;
        };
        return bun.handleOom(arena.allocator().dupe(u8, str));
    }

    pub fn reset(self: *StrStash) void {
        self.used = 0;
        self.s = .{""} ** 6;
        self.i = 0;
        if (self.overflow) |o| {
            o.deinit();
            bun.destroy(o);
            self.overflow = null;
        }
    }
};

/// Pure-Zig recording span for native instrumentation hooks. Pooled on
/// `TracerProvider`; the owning RequestContext/FetchTasklet holds a
/// `?*NativeSpan = null` (8 bytes when OTEL is off). Attrs are NOT stored
/// here — the hook builds them on the stack at `end()` time from start-time
/// scalars + `stash()`ed strings, so this struct stays one cache line.
pub const NativeSpan = struct {
    provider: *tracer.TracerProvider,
    stash_: ?*StrStash = null,
    start_ns: u64,
    name: []const u8 = "",
    status_message: []const u8 = "",
    ctx: model.SpanContext,
    parent_span_id: model.SpanId,
    scope: Scope,
    kind: model.SpanKind,
    status_code: model.StatusCode = .unset,

    comptime {
        bun.assert(@sizeOf(NativeSpan) <= 96);
    }

    pub const Scope = enum {
        server,
        fetch,
        node_http,
        fs,
        websocket,
        websocket_client,

        fn name(self: Scope) []const u8 {
            return switch (self) {
                .server => "bun.serve",
                .fetch => "bun.fetch",
                .node_http => "node.http",
                .fs => "node.fs",
                .websocket => "bun.websocket",
                .websocket_client => "websocket.client",
            };
        }
    };

    /// Null when no provider is configured, the per-hook flag is off, or the
    /// sampler rejects. `which` selects the `InstrumentFlags` bool to gate on.
    /// `name` must be static (caller-owned for the span's lifetime); use
    /// `stash()` for request-scoped strings.
    pub fn start(
        vm: *jsc.VirtualMachine,
        comptime which: tracer.InstrumentFlags.FieldEnum,
        scope: Scope,
        kind: model.SpanKind,
        name: []const u8,
        parent: ?model.SpanContext,
    ) ?*NativeSpan {
        const provider = tracer.TracerProvider.getIfEnabled(vm, which) orelse return null;
        const start_ns = tracer.nowUnixNanos();
        const trace_id: model.TraceId = if (parent) |p| p.trace_id else tracer.generateTraceId(vm, start_ns);
        if (!provider.sampler.shouldSample(trace_id)) return null;
        const self = provider.span_pool.get();
        self.* = .{
            .provider = provider,
            .scope = scope,
            .ctx = .{
                .trace_id = trace_id,
                .span_id = tracer.generateSpanId(vm),
                .flags = 0x01,
            },
            .parent_span_id = if (parent) |p| p.span_id else model.zero_span_id,
            .kind = kind,
            .start_ns = start_ns,
            .name = name,
        };
        return self;
    }

    /// Lazily acquire the pooled string scratch. Most spans (ws, fs) need at
    /// most one string; many need none.
    pub fn stash(self: *NativeSpan) *StrStash {
        if (self.stash_) |st| return st;
        const st = self.provider.stash_pool.get();
        st.* = .{};
        self.stash_ = st;
        return st;
    }

    pub inline fn setStatus(self: *NativeSpan, code: model.StatusCode, message: []const u8) void {
        self.status_code = code;
        self.status_message = message;
    }

    /// Hands the span to the BatchProcessor (which deep-copies `attrs_slice`
    /// and any string values it references) and returns both pooled structs.
    /// Caller must null its pointer.
    pub fn end(self: *NativeSpan, attrs_slice: []const Attribute) void {
        const at_rest: model.Span = .{
            .trace_id = self.ctx.trace_id,
            .span_id = self.ctx.span_id,
            .parent_span_id = self.parent_span_id,
            .flags = @as(u32, self.ctx.flags) | 0x100,
            .name = self.name,
            .kind = self.kind,
            .start_time_unix_nano = self.start_ns,
            .end_time_unix_nano = tracer.nowUnixNanos(),
            .attributes = .from(attrs_slice),
            .status = .{ .code = self.status_code, .message = self.status_message },
        };
        self.provider.processor.onEnd(at_rest, self.provider.getOrCreateScope(self.scope.name()));
        if (self.stash_) |st| {
            st.reset();
            self.provider.stash_pool.put(st);
        }
        self.provider.span_pool.put(self);
    }

    pub fn createContextCell(self: *const NativeSpan, global: *JSGlobalObject) JSValue {
        return tracer.OtelSpanContext.create(global, self.ctx, false);
    }
};

/// Stash slot assignments for HTTP-server spans (Bun.serve + node:http). The
/// start site (`server.zig`) writes; `endHttpServerSpan` reads.
pub const ServerSlot = struct {
    pub const url = 0;
    pub const ua = 1;
    pub const client_addr = 2;
    pub const server_addr = 3;
    pub const route = 4;
    pub const method = 5;
};

/// Shared `end()` for Bun.serve (`RequestContext.finalizeWithoutDeinit`) and
/// node:http (`NodeHTTPResponse.endOtelSpan`). Builds the semconv attr set on
/// the stack from stash slots + end-time scalars.
pub fn endHttpServerSpan(span: *NativeSpan, scheme: []const u8, status_code: u16, aborted: bool) void {
    var buf: [12]Attribute = undefined;
    var a: []Attribute = &buf;
    a[0] = .semconv(.@"url.scheme", .string(scheme));
    a = a[1..];
    if (span.stash_) |st| {
        if (st.s[ServerSlot.method].len > 0) {
            a[0] = .semconv(.@"http.request.method", .string(st.s[ServerSlot.method]));
            a = a[1..];
        }
        const url = st.s[ServerSlot.url];
        if (bun.strings.indexOfChar(url, '?')) |q| {
            a[0] = .semconv(.@"url.path", .string(url[0..q]));
            a = a[1..];
            if (q + 1 < url.len) {
                a[0] = .semconv(.@"url.query", .string(url[q + 1 ..]));
                a = a[1..];
            }
        } else if (url.len > 0) {
            a[0] = .semconv(.@"url.path", .string(url));
            a = a[1..];
        }
        if (st.s[ServerSlot.ua].len > 0) {
            a[0] = .semconv(.@"user_agent.original", .string(st.s[ServerSlot.ua]));
            a = a[1..];
        }
        if (st.s[ServerSlot.client_addr].len > 0) {
            a[0] = .semconv(.@"client.address", .string(st.s[ServerSlot.client_addr]));
            a = a[1..];
        }
        if (st.s[ServerSlot.server_addr].len > 0) {
            a[0] = .semconv(.@"server.address", .string(st.s[ServerSlot.server_addr]));
            a = a[1..];
        }
        if (st.s[ServerSlot.route].len > 0) {
            a[0] = .semconv(.@"http.route", .string(st.s[ServerSlot.route]));
            a = a[1..];
        }
        if (st.i != 0) {
            a[0] = .semconv(.@"server.port", .int(st.i));
            a = a[1..];
        }
    }
    var ebuf: [4]u8 = undefined;
    if (aborted) {
        span.setStatus(.err, "aborted");
        a[0] = .semconv(.@"error.type", .string("aborted"));
        a = a[1..];
    } else if (status_code != 0) {
        a[0] = .semconv(.@"http.response.status_code", .int(status_code));
        a = a[1..];
        if (status_code >= 500) {
            span.setStatus(.err, "");
            a[0] = .semconv(.@"error.type", .string(std.fmt.bufPrint(&ebuf, "{d}", .{status_code}) catch "5xx"));
            a = a[1..];
        }
    }
    span.end(buf[0 .. buf.len - a.len]);
}

/// Shared guard for WebSocket server (`ServerWebSocket.zig`) and client
/// (`CppWebSocket.zig`) handler invocations: span + active-context slot for
/// the duration of the JS call.
pub const WSGuard = struct {
    guard: ?SlotGuard,
    span: ?*NativeSpan,
    body_size: ?usize,
    error_type: []const u8 = "",

    pub const none: WSGuard = .{ .guard = null, .span = null, .body_size = null };

    pub fn begin(
        vm: *jsc.VirtualMachine,
        global: *JSGlobalObject,
        comptime scope: NativeSpan.Scope,
        name: []const u8,
        body_size: ?usize,
    ) WSGuard {
        if (tracer.TracerProvider.getIfEnabled(vm, .websocket) == null) return none;
        const parent = getActiveSpanContext(global);
        const span = NativeSpan.start(vm, .websocket, scope, .consumer, name, parent) orelse return none;
        return .{
            .guard = SlotGuard.enter(global, span.createContextCell(global)),
            .span = span,
            .body_size = body_size,
        };
    }

    pub fn setError(self: *WSGuard, error_type: []const u8) void {
        if (self.span) |s| s.setStatus(.err, "");
        self.error_type = error_type;
    }

    pub fn end(self: *WSGuard) void {
        if (self.guard) |*g| g.restore();
        if (self.span) |s| {
            self.span = null;
            var buf: [2]Attribute = undefined;
            var a: []Attribute = &buf;
            if (self.body_size) |sz| {
                a[0] = .semconv(.@"messaging.message.body.size", .int(@intCast(sz)));
                a = a[1..];
            }
            if (self.error_type.len > 0) {
                a[0] = .semconv(.@"error.type", .string(self.error_type));
                a = a[1..];
            }
            s.end(buf[0 .. buf.len - a.len]);
        }
    }

    pub fn endWithResult(self: *WSGuard, result: JSValue) void {
        if (self.span) |s| {
            if (result.toError()) |_| s.setStatus(.err, "");
        }
        self.end();
    }
};

pub const Attribute = attrs.Attribute;

const attrs = @import("./attributes.zig");
const bun = @import("bun");
const model = @import("./span.zig");
const std = @import("std");
const tracer = @import("./tracer.zig");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
