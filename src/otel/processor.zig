//! BatchSpanProcessor: buffers ended spans and drains via the event loop's
//! DeferredTaskQueue (no thread, no timer loop). Flush conditions: batch size
//! reached, or scheduled delay elapsed since the oldest pending span.

const log = bun.Output.scoped(.otel, .visible);

pub const Options = struct {
    scheduled_delay_ms: u32 = 5000,
    max_export_batch_size: u32 = 512,
    max_queue_size: u32 = 2048,
};

pub const BatchProcessor = struct {
    provider: *TracerProvider,
    opts: Options,

    auto_flusher: AutoFlusher = .{},

    /// Double-buffered: `active` accepts new spans; `sending` holds the in-flight
    /// batch. Swap on flush; reset `sending` when the exporter callback fires.
    active: Batch,
    sending: Batch,
    inflight: bool = false,

    /// Monotonic ns of the oldest span in `active`; 0 when empty.
    first_pending_ns: u64 = 0,
    dropped: u64 = 0,

    flush_waiters: std.ArrayListUnmanaged(jsc.JSPromise.Strong) = .{},
    keep_alive: Async.KeepAlive = .{},

    pub fn init(provider: *TracerProvider, opts: Options) BatchProcessor {
        return .{
            .provider = provider,
            .opts = opts,
            .active = Batch.init(),
            .sending = Batch.init(),
        };
    }

    pub fn deinit(self: *BatchProcessor) void {
        if (self.auto_flusher.registered) {
            AutoFlusher.unregisterDeferredMicrotaskWithType(BatchProcessor, self, self.provider.vm);
        }
        self.keep_alive.disable();
        self.resolveWaiters();
        self.flush_waiters.deinit(bun.default_allocator);
        self.active.deinit();
        self.sending.deinit();
    }

    pub fn onEnd(self: *BatchProcessor, span: model.Span, scope_index: u32) void {
        if (self.active.count >= self.opts.max_queue_size) {
            self.dropped += 1;
            return;
        }
        self.active.append(span, scope_index);
        if (self.first_pending_ns == 0) {
            self.first_pending_ns = bun.timespec.now(.force_real_time).ns();
        }
        AutoFlusher.registerDeferredMicrotaskWithType(BatchProcessor, self, self.provider.vm);
    }

    /// DeferredRepeatingTask callback. Runs after the microtask queue, before
    /// other tasks. Return true to stay registered.
    pub fn onAutoFlush(self: *BatchProcessor) bool {
        if (self.active.count == 0) {
            self.auto_flusher.registered = false;
            return false;
        }
        const elapsed_ms = bun.timespec.now(.force_real_time).ns() -| self.first_pending_ns;
        const due = self.active.count >= self.opts.max_export_batch_size or
            elapsed_ms >= @as(u64, self.opts.scheduled_delay_ms) * std.time.ns_per_ms;
        if (!due) return true;

        if (self.inflight) {
            // Exporter still busy with the previous batch; try again next tick.
            return true;
        }
        self.auto_flusher.registered = false;
        self.flush();
        return false;
    }

    pub fn forceFlush(self: *BatchProcessor, global: *jsc.JSGlobalObject) JSValue {
        var promise = jsc.JSPromise.Strong.init(global);
        const value = promise.value();
        if (self.active.count == 0 and !self.inflight) {
            promise.resolve(global, .js_undefined) catch {};
            return value;
        }
        bun.handleOom(self.flush_waiters.append(bun.default_allocator, promise));
        if (!self.inflight) self.flush();
        return value;
    }

    fn flush(self: *BatchProcessor) void {
        bun.assert(!self.inflight);
        if (self.active.count == 0) {
            self.resolveWaiters();
            return;
        }
        // Swap buffers.
        const tmp = self.sending;
        self.sending = self.active;
        self.active = tmp;
        self.first_pending_ns = 0;

        const exporter = self.provider.exporter orelse {
            // No exporter configured (e.g. tests with sampler-only config). Drop.
            self.sending.reset();
            self.resolveWaiters();
            return;
        };

        var body: std.ArrayList(u8) = .empty;
        self.encodeSending(&body) catch |err| {
            log("encode failed: {s}; dropping {d} spans", .{ @errorName(err), self.sending.count });
            body.deinit(bun.default_allocator);
            self.sending.reset();
            self.resolveWaiters();
            return;
        };

        self.inflight = true;
        self.keep_alive.ref(self.provider.vm);
        exporter.send(body, @ptrCast(self), onExportCompleteThunk);
    }

    fn onExportCompleteThunk(ctx: *anyopaque, ok: bool, status: u32, rejected: i64, msg: []const u8) void {
        const self: *BatchProcessor = @ptrCast(@alignCast(ctx));
        self.onExportComplete(ok, status, rejected, msg);
    }

    fn encodeSending(self: *BatchProcessor, out: *std.ArrayList(u8)) !void {
        const provider = self.provider;
        var scope_spans: std.ArrayListUnmanaged(model.ScopeSpans) = .{};
        defer scope_spans.deinit(bun.default_allocator);

        var it = self.sending.per_scope.iterator();
        while (it.next()) |entry| {
            try scope_spans.append(bun.default_allocator, .{
                .scope = provider.scopeAt(entry.key_ptr.*),
                .spans = entry.value_ptr.items,
            });
        }
        const resource_spans = [_]model.ResourceSpans{.{
            .resource = provider.resource,
            .scope_spans = scope_spans.items,
        }};
        try encode.encodeExportTraceServiceRequest(bun.default_allocator, &resource_spans, out);
    }

    /// Called on the JS thread (via ConcurrentTask) once the exporter has a
    /// final result for the in-flight batch.
    fn onExportComplete(self: *BatchProcessor, ok: bool, status: u32, rejected: i64, msg: []const u8) void {
        _ = ok;
        if (rejected > 0 or msg.len > 0) {
            log("collector partial_success: rejected={d} msg=\"{s}\" status={d}", .{ rejected, msg, status });
        }
        self.sending.reset();
        self.inflight = false;
        self.keep_alive.unref(self.provider.vm);
        // forceFlush() is satisfied once the batch that was pending at call
        // time has been exported. Spans that arrived during the send (e.g.
        // an auto-instrumented server span for the collector itself) are
        // re-registered for the normal scheduled flush, not flushed inline.
        self.resolveWaiters();
        if (self.active.count > 0) {
            AutoFlusher.registerDeferredMicrotaskWithType(BatchProcessor, self, self.provider.vm);
        }
    }

    fn resolveWaiters(self: *BatchProcessor) void {
        const global = self.provider.vm.global;
        for (self.flush_waiters.items) |*p| {
            p.resolve(global, .js_undefined) catch {};
        }
        self.flush_waiters.clearRetainingCapacity();
    }
};

/// One batch buffer: arena owning all span data + per-scope span lists.
const Batch = struct {
    arena: std.heap.ArenaAllocator,
    per_scope: std.AutoArrayHashMapUnmanaged(u32, std.ArrayListUnmanaged(model.Span)) = .{},
    count: u32 = 0,

    fn init() Batch {
        return .{ .arena = std.heap.ArenaAllocator.init(bun.default_allocator) };
    }

    fn alloc(self: *Batch) std.mem.Allocator {
        return self.arena.allocator();
    }

    fn append(self: *Batch, src: model.Span, scope_index: u32) void {
        const gop = bun.handleOom(self.per_scope.getOrPut(bun.default_allocator, scope_index));
        if (!gop.found_existing) gop.value_ptr.* = .{};
        const cloned = self.clone(src);
        bun.handleOom(gop.value_ptr.append(self.alloc(), cloned));
        self.count += 1;
    }

    fn reset(self: *Batch) void {
        // Per-scope list buffers live in the arena; after arena.reset() the
        // retained capacity would point at poisoned memory, so drop them.
        var it = self.per_scope.iterator();
        while (it.next()) |e| e.value_ptr.* = .{};
        _ = self.arena.reset(.retain_capacity);
        self.count = 0;
    }

    fn deinit(self: *Batch) void {
        self.per_scope.deinit(bun.default_allocator);
        self.arena.deinit();
    }

    fn clone(self: *Batch, s: model.Span) model.Span {
        var out = s;
        out.name = self.dupeStr(s.name);
        out.trace_state = self.dupeStr(s.trace_state);
        out.status.message = self.dupeStr(s.status.message);
        out.attributes = self.cloneAttrs(s.attributes);
        out.events = self.cloneEvents(s.events);
        out.links = self.cloneLinks(s.links);
        return out;
    }

    fn dupeStr(self: *Batch, s: []const u8) []const u8 {
        if (s.len == 0) return "";
        return bun.handleOom(self.alloc().dupe(u8, s));
    }

    fn cloneAttrs(self: *Batch, src: attributes.AttrList) attributes.AttrList {
        const slice = src.slice();
        if (slice.len == 0) return .{};
        const dst = bun.handleOom(self.alloc().alloc(Attribute, slice.len));
        for (slice, dst) |a, *d| d.* = a.cloneInto(self.alloc());
        return attributes.AttrList.from(dst);
    }

    fn cloneEvents(self: *Batch, src: []const model.Event) []const model.Event {
        if (src.len == 0) return &.{};
        const dst = bun.handleOom(self.alloc().alloc(model.Event, src.len));
        for (src, dst) |e, *d| d.* = .{
            .time_unix_nano = e.time_unix_nano,
            .name = self.dupeStr(e.name),
            .attributes = self.cloneAttrs(e.attributes),
            .dropped_attributes_count = e.dropped_attributes_count,
        };
        return dst;
    }

    fn cloneLinks(self: *Batch, src: []const model.Link) []const model.Link {
        if (src.len == 0) return &.{};
        const dst = bun.handleOom(self.alloc().alloc(model.Link, src.len));
        for (src, dst) |l, *d| {
            d.* = l;
            d.trace_state = self.dupeStr(l.trace_state);
            d.attributes = self.cloneAttrs(l.attributes);
        }
        return dst;
    }
};

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const Async = bun.Async;
const AutoFlusher = bun.webcore.AutoFlusher;

const model = @import("./span.zig");
const attributes = @import("./attributes.zig");
const encode = @import("./otlp/encode.zig");
const Attribute = attributes.Attribute;
const TracerProvider = @import("./tracer.zig").TracerProvider;
