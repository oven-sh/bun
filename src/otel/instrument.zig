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

const log = bun.Output.scoped(.otel, .visible);

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

/// Pure-Zig recording span for native instrumentation hooks. Lives inline on
/// RequestContext / FetchTasklet — no heap allocation. Attribute keys and
/// string values must outlive `end()` (use static strings or the embedded
/// inline storage); BatchProcessor.onEnd deep-copies into its arena.
pub const NativeSpan = struct {
    pub const max_attrs = 8;
    pub const StrBuf = bun.BoundedArray(u8, 256);

    provider: ?*tracer.TracerProvider = null,
    scope: Scope = .server,
    ctx: model.SpanContext = .{ .trace_id = model.zero_trace_id, .span_id = model.zero_span_id, .flags = 0 },
    parent_span_id: model.SpanId = model.zero_span_id,
    kind: model.SpanKind = .internal,
    start_ns: u64 = 0,
    name_buf: StrBuf = .{},
    attrs: bun.BoundedArray(Attribute, max_attrs) = .{},
    str_buf: StrBuf = .{},
    status: model.Status = .{},
    ended: bool = false,

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

    pub fn isRecording(self: *const NativeSpan) bool {
        return self.provider != null and !self.ended;
    }

    /// Start a span if the provider is configured and the sampler accepts.
    /// `parent` is typically the result of `getActiveSpanContext` or a parsed
    /// incoming traceparent. Returns whether the span is recording.
    pub fn start(
        self: *NativeSpan,
        vm: *jsc.VirtualMachine,
        scope: Scope,
        kind: model.SpanKind,
        name: []const u8,
        parent: ?model.SpanContext,
    ) bool {
        const provider = tracer.TracerProvider.get(vm) orelse return false;
        const trace_id: model.TraceId = if (parent) |p| p.trace_id else tracer.generateTraceId();
        const sampled = provider.sampler.shouldSample(trace_id);
        self.* = .{
            .provider = if (sampled) provider else null,
            .scope = scope,
            .ctx = .{
                .trace_id = trace_id,
                .span_id = tracer.generateSpanId(),
                .flags = if (sampled) 0x01 else 0x00,
            },
            .parent_span_id = if (parent) |p| p.span_id else model.zero_span_id,
            .kind = kind,
            .start_ns = tracer.nowUnixNanos(),
        };
        if (sampled) {
            const n = @min(name.len, self.name_buf.buffer.len);
            self.name_buf.appendSliceAssumeCapacity(name[0..n]);
        }
        return sampled;
    }

    pub fn setAttrStatic(self: *NativeSpan, key: []const u8, value: []const u8) void {
        if (!self.isRecording()) return;
        self.attrs.append(.{ .key = key, .value = .{ .string = value } }) catch {};
    }

    /// Copies `value` into the span's bounded string buffer.
    pub fn setAttrStr(self: *NativeSpan, key: []const u8, value: []const u8) void {
        if (!self.isRecording()) return;
        const start_idx = self.str_buf.len;
        self.str_buf.appendSlice(value) catch return;
        self.attrs.append(.{
            .key = key,
            .value = .{ .string = self.str_buf.constSlice()[start_idx..] },
        }) catch {};
    }

    pub fn setAttrInt(self: *NativeSpan, key: []const u8, value: i64) void {
        if (!self.isRecording()) return;
        self.attrs.append(.{ .key = key, .value = .{ .int = value } }) catch {};
    }

    pub fn setStatus(self: *NativeSpan, code: model.StatusCode, message: []const u8) void {
        if (!self.isRecording()) return;
        self.status = .{ .code = code, .message = message };
    }

    pub fn end(self: *NativeSpan) void {
        if (self.ended) return;
        self.ended = true;
        const provider = self.provider orelse return;
        const at_rest: model.Span = .{
            .trace_id = self.ctx.trace_id,
            .span_id = self.ctx.span_id,
            .parent_span_id = self.parent_span_id,
            .flags = @as(u32, self.ctx.flags) | 0x100,
            .name = self.name_buf.constSlice(),
            .kind = self.kind,
            .start_time_unix_nano = self.start_ns,
            .end_time_unix_nano = tracer.nowUnixNanos(),
            .attributes = self.attrs.constSlice(),
            .status = self.status,
        };
        provider.processor.onEnd(at_rest, provider.getOrCreateScope(self.scope.name()));
    }

    /// Create the JS-side `OtelSpanContext` cell for this span (one allocation
    /// per request) so it can be installed in the async-context slot.
    pub fn createContextCell(self: *const NativeSpan, global: *JSGlobalObject) JSValue {
        return tracer.OtelSpanContext.create(global, self.ctx, false);
    }
};

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;

const model = @import("./span.zig");
const tracer = @import("./tracer.zig");
const Attribute = @import("./attributes.zig").Attribute;
