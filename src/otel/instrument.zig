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

/// Swap the active span for the duration of a synchronous JS call. The caller
/// must `restore()` after the call returns (before any sibling code runs); the
/// per-reaction capture in PromiseOperations handles async continuation.
pub const SlotGuard = struct {
    global: *JSGlobalObject,
    saved: JSValue,
    cell: JSValue,

    /// `cell` must be an OtelSpanContext JSValue. If `saved` is an ALS array,
    /// the new slot value is a fresh `[null, cell, ...rest]` array so ALS reads
    /// inside the call still work; otherwise we set the cell directly.
    pub fn enter(global: *JSGlobalObject, cell: JSValue) SlotGuard {
        const saved = getSlot(global);
        const new_slot = if (saved.isCell() and saved.jsType().isArray())
            buildArrayWithSpan(global, saved, cell)
        else
            cell;
        setSlot(global, new_slot);
        return .{ .global = global, .saved = saved, .cell = cell };
    }

    pub fn restore(self: *const SlotGuard) void {
        setSlot(self.global, self.saved);
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

/// Pure-Zig recording span for native instrumentation hooks. Heap-allocated
/// only when the provider is configured AND the sampler accepts; the owning
/// RequestContext/FetchTasklet holds a `?*NativeSpan = null` (8 bytes when
/// OTEL is off). Strings are arena-owned; `end()` consumes and destroys.
pub const NativeSpan = struct {
    provider: *tracer.TracerProvider,
    scope: Scope,
    ctx: model.SpanContext,
    parent_span_id: model.SpanId,
    kind: model.SpanKind,
    start_ns: u64,
    name: []const u8 = "",
    attrs: std.ArrayListUnmanaged(Attribute) = .{},
    arena: std.heap.ArenaAllocator,
    status: model.Status = .{},

    pub const new = bun.TrivialNew(@This());

    comptime {
        bun.assert(@sizeOf(NativeSpan) <= 192);
    }

    pub const Scope = enum {
        server,
        fetch,

        fn name(self: Scope) []const u8 {
            return switch (self) {
                .server => "bun.serve",
                .fetch => "bun.fetch",
            };
        }
    };

    /// Null when no provider is configured or the sampler rejects.
    pub fn start(
        vm: *jsc.VirtualMachine,
        scope: Scope,
        kind: model.SpanKind,
        name: []const u8,
        parent: ?model.SpanContext,
    ) ?*NativeSpan {
        const provider = tracer.TracerProvider.get(vm) orelse return null;
        const trace_id: model.TraceId = if (parent) |p| p.trace_id else tracer.generateTraceId();
        if (!provider.sampler.shouldSample(trace_id)) return null;
        const self = NativeSpan.new(.{
            .provider = provider,
            .scope = scope,
            .ctx = .{
                .trace_id = trace_id,
                .span_id = tracer.generateSpanId(),
                .flags = 0x01,
            },
            .parent_span_id = if (parent) |p| p.span_id else model.zero_span_id,
            .kind = kind,
            .start_ns = tracer.nowUnixNanos(),
            .arena = std.heap.ArenaAllocator.init(bun.default_allocator),
        });
        self.name = self.dupe(name);
        return self;
    }

    fn alloc(self: *NativeSpan) std.mem.Allocator {
        return self.arena.allocator();
    }

    fn dupe(self: *NativeSpan, s: []const u8) []const u8 {
        if (s.len == 0) return "";
        return bun.handleOom(self.alloc().dupe(u8, s));
    }

    pub fn setAttrStatic(self: *NativeSpan, key: attrs.SemconvKey, value: []const u8) void {
        bun.handleOom(self.attrs.append(self.alloc(), .semconv(key, .string(value))));
    }

    pub fn setAttrStr(self: *NativeSpan, key: attrs.SemconvKey, value: []const u8) void {
        bun.handleOom(self.attrs.append(self.alloc(), .semconv(key, .string(self.dupe(value)))));
    }

    pub fn setAttrInt(self: *NativeSpan, key: attrs.SemconvKey, value: i64) void {
        bun.handleOom(self.attrs.append(self.alloc(), .semconv(key, .int(value))));
    }

    pub fn setStatus(self: *NativeSpan, code: model.StatusCode, message: []const u8) void {
        self.status = .{ .code = code, .message = message };
    }

    /// Hands the span to the BatchProcessor (which deep-copies) and destroys
    /// `self`. Caller must null its pointer.
    pub fn end(self: *NativeSpan) void {
        const at_rest: model.Span = .{
            .trace_id = self.ctx.trace_id,
            .span_id = self.ctx.span_id,
            .parent_span_id = self.parent_span_id,
            .flags = @as(u32, self.ctx.flags) | 0x100,
            .name = self.name,
            .kind = self.kind,
            .start_time_unix_nano = self.start_ns,
            .end_time_unix_nano = tracer.nowUnixNanos(),
            .attributes = .from(self.attrs.items),
            .status = self.status,
        };
        self.provider.processor.onEnd(at_rest, self.provider.getOrCreateScope(self.scope.name()));
        self.arena.deinit();
        bun.destroy(self);
    }

    pub fn createContextCell(self: *const NativeSpan, global: *JSGlobalObject) JSValue {
        return tracer.OtelSpanContext.create(global, self.ctx, false);
    }
};

const bun = @import("bun");
const model = @import("./span.zig");
const std = @import("std");
const tracer = @import("./tracer.zig");

const attrs = @import("./attributes.zig");
const Attribute = attrs.Attribute;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
