//! Live tracing runtime: TracerProvider, Tracer, RecordingSpan, Sampler.
//! The at-rest data model the encoder consumes lives in `span.zig`; this file
//! produces those records and feeds them to the BatchProcessor.

const log = bun.Output.scoped(.otel, .visible);

pub fn nowUnixNanos() u64 {
    return @intCast(@max(std.time.nanoTimestamp(), 0));
}

pub const Sampler = union(enum) {
    always_on,
    always_off,
    /// Sample if the low 8 bytes of trace_id (big-endian) fall below threshold.
    trace_id_ratio: u64,

    pub fn shouldSample(self: Sampler, trace_id: model.TraceId) bool {
        return switch (self) {
            .always_on => true,
            .always_off => false,
            .trace_id_ratio => |threshold| std.mem.readInt(u64, trace_id[8..16], .big) < threshold,
        };
    }

    pub fn fromRatio(ratio: f64) Sampler {
        if (ratio >= 1.0) return .always_on;
        if (ratio <= 0.0) return .always_off;
        const max: f64 = @floatFromInt(std.math.maxInt(u64));
        return .{ .trace_id_ratio = @intFromFloat(ratio * max) };
    }
};

pub fn generateTraceId() model.TraceId {
    var id: model.TraceId = undefined;
    while (true) {
        bun.csprng(&id);
        if (!std.mem.eql(u8, &id, &model.zero_trace_id)) return id;
    }
}

pub fn generateSpanId() model.SpanId {
    var id: model.SpanId = undefined;
    while (true) {
        bun.csprng(&id);
        if (!std.mem.eql(u8, &id, &model.zero_span_id)) return id;
    }
}

/// Per-hook auto-instrumentation toggles. One bool load after the existing
/// `TracerProvider.get(vm)` null-check; default-on for the wire-level surfaces
/// users expect to "just work", default-off for the chatty ones.
pub const InstrumentFlags = packed struct(u32) {
    serve: bool = true,
    fetch: bool = true,
    node_http: bool = true,
    sql: bool = true,
    redis: bool = true,
    fs: bool = false,
    websocket: bool = false,
    spawn: bool = false,
    _: u24 = 0,

    pub const FieldEnum = std.meta.FieldEnum(InstrumentFlags);

    /// Clear flags named in a comma-separated list (for
    /// `OTEL_BUN_DISABLED_INSTRUMENTATIONS`). Unknown names are ignored.
    pub fn applyDisabledList(self: *InstrumentFlags, list: []const u8) void {
        var it = std.mem.splitScalar(u8, list, ',');
        while (it.next()) |raw| {
            const name = bun.strings.trim(raw, " \t");
            inline for (std.meta.fields(InstrumentFlags)) |f| {
                if (comptime f.type != bool) continue;
                if (bun.strings.eqlComptime(name, f.name)) {
                    @field(self, f.name) = false;
                    break;
                }
            }
            // Accept the JS-side camelCase alias.
            if (bun.strings.eqlComptime(name, "nodeHttp")) self.node_http = false;
        }
    }
};

pub const Config = struct {
    endpoint: []const u8,
    headers: []const KV = &.{},
    sampler: Sampler = .always_on,
    instrument: InstrumentFlags = .{},
    scheduled_delay_ms: u32 = 5000,
    max_export_batch_size: u32 = 512,
    max_queue_size: u32 = 2048,
    resource_attributes: []const Attribute = &.{},

    pub const KV = struct { name: []const u8, value: []const u8 };
};

/// One per VM. Owns processor, exporter, resource, scope registry.
pub const TracerProvider = struct {
    allocator: std.mem.Allocator,
    vm: *jsc.VirtualMachine,
    sampler: Sampler,
    resource: model.Resource,
    resource_storage: std.heap.ArenaAllocator,
    resource_attrs: std.ArrayListUnmanaged(Attribute) = .{},

    scopes: std.StringArrayHashMapUnmanaged(model.InstrumentationScope) = .{},
    processor: BatchProcessor,
    exporter: ?*OtlpHttpExporter,
    instrument: InstrumentFlags,

    pub const new = bun.TrivialNew(@This());

    pub fn init(vm: *jsc.VirtualMachine, cfg: Config) !*TracerProvider {
        const allocator = bun.default_allocator;
        const exporter = if (cfg.endpoint.len > 0)
            try OtlpHttpExporter.init(allocator, vm, cfg.endpoint, cfg.headers)
        else
            null;

        const self = TracerProvider.new(.{
            .allocator = allocator,
            .vm = vm,
            .sampler = cfg.sampler,
            .instrument = cfg.instrument,
            .resource = .{},
            .resource_storage = std.heap.ArenaAllocator.init(allocator),
            .processor = undefined,
            .exporter = exporter,
        });

        try self.buildResource(cfg.resource_attributes);
        self.processor = BatchProcessor.init(self, .{
            .scheduled_delay_ms = cfg.scheduled_delay_ms,
            .max_export_batch_size = cfg.max_export_batch_size,
            .max_queue_size = cfg.max_queue_size,
        });
        return self;
    }

    fn buildResource(self: *TracerProvider, extra: []const Attribute) !void {
        // service.name defaults to argv[0] basename via bun later; for now use "unknown_service:bun".
        try self.appendResourceAttr(.semconv(.@"service.name", .string("unknown_service:bun")));
        try self.appendResourceAttr(.semconv(.@"telemetry.sdk.name", .string("bun")));
        try self.appendResourceAttr(.semconv(.@"telemetry.sdk.language", .string("zig")));
        try self.appendResourceAttr(.semconv(.@"telemetry.sdk.version", .string(bun.Environment.version_string)));
        for (extra) |a| try self.appendResourceAttr(a);
        self.resource = .{ .attributes = .from(self.resource_attrs.items) };
    }

    fn appendResourceAttr(self: *TracerProvider, a: Attribute) !void {
        try self.resource_attrs.append(self.allocator, a.cloneInto(self.resource_storage.allocator()));
    }

    fn internString(self: *TracerProvider, s: []const u8) ![]const u8 {
        return self.resource_storage.allocator().dupe(u8, s);
    }

    pub fn getOrCreateScope(self: *TracerProvider, name: []const u8) u32 {
        if (self.scopes.getIndex(name)) |i| return @intCast(i);
        const owned = bun.handleOom(self.allocator.dupe(u8, name));
        bun.handleOom(self.scopes.put(self.allocator, owned, .{ .name = owned }));
        return @intCast(self.scopes.count() - 1);
    }

    pub fn scopeAt(self: *const TracerProvider, idx: u32) model.InstrumentationScope {
        return self.scopes.values()[idx];
    }

    pub fn deinit(self: *TracerProvider) void {
        self.processor.deinit();
        if (self.exporter) |e| e.deinit();
        var it = self.scopes.iterator();
        while (it.next()) |entry| self.allocator.free(entry.key_ptr.*);
        self.scopes.deinit(self.allocator);
        self.resource_attrs.deinit(self.allocator);
        self.resource_storage.deinit();
        bun.destroy(self);
    }

    /// Mutate config in place so existing OtelTracer/OtelSpan pointers stay valid.
    /// `deinit` is only called at VM shutdown.
    pub fn reconfigure(self: *TracerProvider, cfg: Config) !void {
        self.sampler = cfg.sampler;
        self.instrument = cfg.instrument;
        self.processor.opts.scheduled_delay_ms = cfg.scheduled_delay_ms;
        self.processor.opts.max_export_batch_size = cfg.max_export_batch_size;
        self.processor.opts.max_queue_size = cfg.max_queue_size;
        if (self.exporter) |e| {
            if (cfg.endpoint.len > 0 and !bun.strings.hasPrefix(e.traces_url_buf, cfg.endpoint)) {
                log("Bun.otel.configure: endpoint cannot be changed after first configure (in-flight exports hold the exporter); still sending to {s}", .{e.traces_url_buf});
            }
        } else if (cfg.endpoint.len > 0) {
            self.exporter = try OtlpHttpExporter.init(self.allocator, self.vm, cfg.endpoint, cfg.headers);
        }
    }

    /// Get the per-VM provider, or null if `Bun.otel.configure` was never called
    /// and `OTEL_EXPORTER_OTLP_ENDPOINT` isn't set.
    pub fn get(vm: *jsc.VirtualMachine) ?*TracerProvider {
        return vm.rareData().otel_tracer_provider;
    }

    /// Hot-path gate for native instrumentation hooks: returns the provider
    /// only if it exists AND the named flag is set, so the call site is one
    /// `if (getIfEnabled(vm, .serve)) |p| { ... }`.
    pub fn getIfEnabled(vm: *jsc.VirtualMachine, comptime which: InstrumentFlags.FieldEnum) ?*TracerProvider {
        const p = get(vm) orelse return null;
        return if (@field(p.instrument, @tagName(which))) p else null;
    }

    pub fn getOrInitFromEnv(vm: *jsc.VirtualMachine) ?*TracerProvider {
        if (get(vm)) |p| return p;
        const endpoint = bun.env_var.OTEL_EXPORTER_OTLP_ENDPOINT.get() orelse return null;
        var instr: InstrumentFlags = .{};
        if (bun.env_var.OTEL_BUN_DISABLED_INSTRUMENTATIONS.get()) |d| instr.applyDisabledList(d);
        const provider = TracerProvider.init(vm, .{ .endpoint = endpoint, .instrument = instr }) catch |err| {
            log("failed to initialize from OTEL_EXPORTER_OTLP_ENDPOINT: {s}", .{@errorName(err)});
            return null;
        };
        vm.rareData().otel_tracer_provider = provider;
        return provider;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// JS classes
// ─────────────────────────────────────────────────────────────────────────────

pub const OtelSpanContext = struct {
    pub const js = jsc.Codegen.JSOtelSpanContext;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    ctx: model.SpanContext,
    is_remote: bool = false,

    pub const new = bun.TrivialNew(@This());

    pub fn create(global: *JSGlobalObject, ctx: model.SpanContext, is_remote: bool) JSValue {
        const self = OtelSpanContext.new(.{ .ctx = ctx, .is_remote = is_remote });
        return self.toJS(global);
    }

    pub fn getTraceId(this: *OtelSpanContext, global: *JSGlobalObject) bun.JSError!JSValue {
        return jsc.ArrayBuffer.createUint8Array(global, &this.ctx.trace_id);
    }

    pub fn getSpanId(this: *OtelSpanContext, global: *JSGlobalObject) bun.JSError!JSValue {
        return jsc.ArrayBuffer.createUint8Array(global, &this.ctx.span_id);
    }

    pub fn getTraceFlags(this: *OtelSpanContext, _: *JSGlobalObject) JSValue {
        return JSValue.jsNumber(@as(u32, this.ctx.flags));
    }

    pub fn getIsRemote(this: *OtelSpanContext, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.is_remote);
    }

    pub fn toTraceparent(this: *OtelSpanContext, global: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        var buf: [propagation.traceparent_len]u8 = undefined;
        propagation.formatTraceparent(this.ctx, &buf);
        return bun.String.createUTF8ForJS(global, &buf);
    }

    pub fn finalize(this: *OtelSpanContext) void {
        bun.destroy(this);
    }
};

pub const OtelTracer = struct {
    pub const js = jsc.Codegen.JSOtelTracer;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    provider: ?*TracerProvider,
    scope_index: u32,

    pub const new = bun.TrivialNew(@This());

    /// `start(name)` / `start(name, opts)` → span; activates context. The
    ///   returned span has `[Symbol.dispose]` = restore + end (use with
    ///   `await using`).
    /// `start(name, fn)` / `start(name, opts, fn)` → callback form; activates
    ///   for the duration of `fn`, sync-restores after `fn` returns, ends on
    ///   settle. Handles overlapping async correctly.
    pub fn start(this: *OtelTracer, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isString()) {
            return global.throwInvalidArguments("tracer.start(name[, options][, fn]) expects a span name string", .{});
        }

        var opts: JSValue = .js_undefined;
        var func: JSValue = .js_undefined;
        if (args.len > 1) {
            if (args[args.len - 1].isCallable()) {
                func = args[args.len - 1];
                if (args.len > 2 and args[1].isObject()) opts = args[1];
            } else if (args[1].isObject()) {
                opts = args[1];
            }
        }

        const span = try this.createSpan(global, args[0], opts);
        const span_js = span.toJS(global);
        const cell = OtelSpanContext.create(global, span.ctx, false);
        const guard = instrument.SlotGuard.enter(global, cell);

        if (func == .js_undefined) {
            // `using` form: stash the previous span cell; dispose surgically restores it.
            OtelSpan.js.savedSlotSetCached(span_js, global, guard.saved);
            return span_js;
        }

        var did_throw = false;
        const result = func.call(global, .js_undefined, &.{span_js}) catch |err| blk: {
            did_throw = true;
            break :blk global.takeException(err);
        };
        guard.restore();

        if (did_throw) {
            span.endNowWithError(global, result);
            return global.throwValue(result);
        }
        if (result.asAnyPromise()) |_| {
            return result.thenWithValueReturning(global, span_js, OtelSpan.onActiveResolve, OtelSpan.onActiveReject) catch result;
        }
        span.endNow();
        return result;
    }

    fn createSpan(this: *OtelTracer, global: *JSGlobalObject, name_js: JSValue, opts: JSValue) bun.JSError!*OtelSpan {
        var parent: ?model.SpanContext = null;
        var kind: model.SpanKind = .internal;
        var start_ns: u64 = 0;
        var explicit_parent = false;
        if (opts != .js_undefined) {
            if (try opts.get(global, "parent")) |p| {
                explicit_parent = true;
                parent = try readSpanContext(global, p);
            }
            if (try opts.get(global, "kind")) |k| {
                if (k.isNumber()) {
                    const ki = k.toInt32();
                    if (ki >= 0 and ki <= 5) kind = @enumFromInt(@as(u8, @intCast(ki)));
                }
            }
            if (try opts.get(global, "startTime")) |t| {
                if (t.isBigInt()) start_ns = t.toUInt64NoTruncate();
            }
        }
        if (!explicit_parent) parent = instrument.getActiveSpanContext(global);

        const trace_id: model.TraceId = if (parent) |p| p.trace_id else generateTraceId();
        const span_id = generateSpanId();

        const provider = this.provider;
        const sampled = if (provider) |p| p.sampler.shouldSample(trace_id) else false;
        const flags: u8 = if (sampled) 0x01 else 0x00;
        const ctx: model.SpanContext = .{ .trace_id = trace_id, .span_id = span_id, .flags = flags };

        const span = OtelSpan.new(.{
            .provider = if (sampled) provider else null,
            .scope_index = this.scope_index,
            .ctx = ctx,
            .parent_span_id = if (parent) |p| p.span_id else model.zero_span_id,
            .kind = kind,
            .start_ns = if (start_ns > 0) start_ns else nowUnixNanos(),
            .arena = std.heap.ArenaAllocator.init(bun.default_allocator),
        });

        if (sampled) {
            span.name = try jsStringSlice(global, name_js, &span.arena);
            if (opts != .js_undefined) {
                if (try opts.get(global, "attributes")) |a| {
                    if (a.isObject()) try span.appendAttributesObject(global, a);
                }
            }
        }
        return span;
    }

    pub fn finalize(this: *OtelTracer) void {
        bun.destroy(this);
    }
};

pub const OtelSpan = struct {
    pub const js = jsc.Codegen.JSOtelSpan;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    /// Null when not recording (sampler said no, or no provider configured).
    provider: ?*TracerProvider,
    scope_index: u32,

    ctx: model.SpanContext,
    parent_span_id: model.SpanId,
    kind: model.SpanKind,
    start_ns: u64,
    name: []const u8 = "",
    status: model.Status = .{},
    ended: bool = false,

    arena: std.heap.ArenaAllocator,
    attrs: std.ArrayListUnmanaged(Attribute) = .{},
    events: std.ArrayListUnmanaged(model.Event) = .{},

    pub const new = bun.TrivialNew(@This());

    fn alloc(this: *OtelSpan) std.mem.Allocator {
        return this.arena.allocator();
    }

    fn dupe(this: *OtelSpan, s: []const u8) []const u8 {
        return bun.handleOom(this.alloc().dupe(u8, s));
    }

    pub fn getSpanContext(this: *OtelSpan, global: *JSGlobalObject) bun.JSError!JSValue {
        return OtelSpanContext.create(global, this.ctx, false);
    }

    pub fn getIsRecording(this: *OtelSpan, _: *JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.provider != null and !this.ended);
    }

    /// `set(key, value)` or `set({k1: v1, k2: v2, ...})`.
    pub fn set(this: *OtelSpan, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments();
        if (this.provider == null or this.ended or args.len < 1) return callframe.this();
        if (args[0].isString()) {
            if (args.len < 2) return callframe.this();
            const key = try jsStringSlice(global, args[0], &this.arena);
            try this.appendAttr(key, try anyValueFromJS(global, args[1], this.alloc()));
        } else if (args[0].isObject()) {
            try this.appendAttributesObject(global, args[0]);
        }
        return callframe.this();
    }

    fn appendAttributesObject(this: *OtelSpan, global: *JSGlobalObject, obj: JSValue) bun.JSError!void {
        const jsobj = obj.getObject() orelse return;
        var iter = try jsc.JSPropertyIterator(.{ .include_value = true, .skip_empty_name = true }).init(global, jsobj);
        defer iter.deinit();
        while (try iter.next()) |key| {
            const k_slice = key.toUTF8(this.alloc());
            defer k_slice.deinit();
            try this.appendAttr(this.dupe(k_slice.slice()), try anyValueFromJS(global, iter.value, this.alloc()));
        }
    }

    fn appendAttr(this: *OtelSpan, key: []const u8, value: attributes.Value) !void {
        bun.handleOom(this.attrs.append(this.alloc(), Attribute.init(key, value)));
    }

    pub fn event(this: *OtelSpan, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments();
        if (this.provider == null or this.ended or args.len < 1) return callframe.this();
        const name = try jsStringSlice(global, args[0], &this.arena);
        var ev_attrs: attributes.AttrList = .{};
        if (args.len > 1 and args[1].isObject()) {
            var list: std.ArrayListUnmanaged(Attribute) = .{};
            const jsobj = args[1].getObject().?;
            var iter = try jsc.JSPropertyIterator(.{ .include_value = true, .skip_empty_name = true }).init(global, jsobj);
            defer iter.deinit();
            while (try iter.next()) |key| {
                const k_slice = key.toUTF8(this.alloc());
                defer k_slice.deinit();
                const k = this.dupe(k_slice.slice());
                bun.handleOom(list.append(this.alloc(), Attribute.init(k, try anyValueFromJS(global, iter.value, this.alloc()))));
            }
            ev_attrs = .from(list.items);
        }
        bun.handleOom(this.events.append(this.alloc(), .{
            .time_unix_nano = nowUnixNanos(),
            .name = name,
            .attributes = ev_attrs,
        }));
        return callframe.this();
    }

    pub fn ok(this: *OtelSpan, _: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.provider == null or this.ended) return callframe.this();
        this.status = .{ .code = .ok };
        return callframe.this();
    }

    /// `error()` / `error(message: string)` / `error(err: Error)`.
    /// When given an `Error`, also records an `exception` event with semconv
    /// attributes (type/message/stacktrace).
    pub fn setError(this: *OtelSpan, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.provider == null or this.ended) return callframe.this();
        this.status.code = .err;
        const args = callframe.arguments();
        if (args.len < 1 or args[0].isUndefinedOrNull()) return callframe.this();
        if (args[0].isString()) {
            this.status.message = try jsStringSlice(global, args[0], &this.arena);
            return callframe.this();
        }
        try this.recordException(global, args[0]);
        return callframe.this();
    }

    fn recordException(this: *OtelSpan, global: *JSGlobalObject, val: JSValue) bun.JSError!void {
        var list: std.ArrayListUnmanaged(Attribute) = .{};
        const err_obj = val.toError() orelse val;
        if (err_obj.isObject()) {
            if (try err_obj.fastGet(global, .name)) |n| if (n.isString()) {
                const s = try jsStringSlice(global, n, &this.arena);
                bun.handleOom(list.append(this.alloc(), .semconv(.@"exception.type", .string(s))));
            };
            if (try err_obj.fastGet(global, .message)) |m| if (m.isString()) {
                const s = try jsStringSlice(global, m, &this.arena);
                this.status.message = s;
                bun.handleOom(list.append(this.alloc(), .semconv(.@"exception.message", .string(s))));
            };
            if (try err_obj.get(global, "stack")) |st| if (st.isString()) {
                const s = try jsStringSlice(global, st, &this.arena);
                bun.handleOom(list.append(this.alloc(), .semconv(.@"exception.stacktrace", .string(s))));
            };
        }
        bun.handleOom(this.events.append(this.alloc(), .{
            .time_unix_nano = nowUnixNanos(),
            .name = "exception",
            .attributes = .from(list.items),
        }));
    }

    pub fn updateName(this: *OtelSpan, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments();
        if (this.provider == null or this.ended or args.len < 1) return callframe.this();
        this.name = try jsStringSlice(global, args[0], &this.arena);
        return callframe.this();
    }

    pub fn end(this: *OtelSpan, _: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.ended) return .js_undefined;
        this.ended = true;
        const provider = this.provider orelse return .js_undefined;

        const args = callframe.arguments();
        const end_ns: u64 = if (args.len > 0 and args[0].isBigInt())
            args[0].toUInt64NoTruncate()
        else
            nowUnixNanos();

        const at_rest: model.Span = .{
            .trace_id = this.ctx.trace_id,
            .span_id = this.ctx.span_id,
            .parent_span_id = this.parent_span_id,
            .flags = @as(u32, this.ctx.flags) | 0x100, // CONTEXT_HAS_IS_REMOTE
            .name = this.name,
            .kind = this.kind,
            .start_time_unix_nano = this.start_ns,
            .end_time_unix_nano = end_ns,
            .attributes = .from(this.attrs.items),
            .dropped_attributes_count = attributes.AttrList.droppedCount(this.attrs.items.len),
            .events = this.events.items,
            .status = this.status,
        };
        provider.processor.onEnd(at_rest, this.scope_index);
        return .js_undefined;
    }

    /// `[Symbol.dispose]` / `[Symbol.asyncDispose]`. Surgically removes this
    /// span from the active-context slot (preserving any ALS state added since
    /// `start()`), restores the previous span cell if there was one, and ends
    /// the span. No-op for the slot if this span isn't currently on top
    /// (out-of-order dispose). `.end()` does NOT touch the slot.
    pub fn dispose(this: *OtelSpan, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const this_value = callframe.this();
        if (js.savedSlotGetCached(this_value)) |prev_cell| {
            instrument.surgicalRestoreSpan(global, this.ctx.span_id, prev_cell);
            js.savedSlotSetCached(this_value, global, .zero);
        }
        this.endNow();
        return .js_undefined;
    }

    pub fn endNow(this: *OtelSpan) void {
        if (this.ended) return;
        this.ended = true;
        const provider = this.provider orelse return;
        const at_rest: model.Span = .{
            .trace_id = this.ctx.trace_id,
            .span_id = this.ctx.span_id,
            .parent_span_id = this.parent_span_id,
            .flags = @as(u32, this.ctx.flags) | 0x100,
            .name = this.name,
            .kind = this.kind,
            .start_time_unix_nano = this.start_ns,
            .end_time_unix_nano = nowUnixNanos(),
            .attributes = .from(this.attrs.items),
            .dropped_attributes_count = attributes.AttrList.droppedCount(this.attrs.items.len),
            .events = this.events.items,
            .status = this.status,
        };
        provider.processor.onEnd(at_rest, this.scope_index);
    }

    pub fn endNowWithError(this: *OtelSpan, global: *JSGlobalObject, err: JSValue) void {
        if (this.provider != null and !this.ended) {
            this.status.code = .err;
            if (err.toError()) |e| {
                if (e.fastGet(global, .message) catch null) |msg| {
                    if (msg.isString()) {
                        const s = msg.toSlice(global, this.alloc()) catch return this.endNow();
                        defer s.deinit();
                        this.status.message = this.dupe(s.slice());
                    }
                }
            }
        }
        this.endNow();
    }

    pub fn onActiveResolve(_: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments_old(2);
        if (OtelSpan.fromJS(args.ptr[1])) |span| span.endNow();
        return args.ptr[0];
    }

    pub fn onActiveReject(global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments_old(2);
        if (OtelSpan.fromJS(args.ptr[1])) |span| span.endNowWithError(global, args.ptr[0]);
        return global.throwValue(args.ptr[0]);
    }

    pub export const Bun__OtelSpan__onActiveResolve = jsc.toJSHostFn(onActiveResolve);
    pub export const Bun__OtelSpan__onActiveReject = jsc.toJSHostFn(onActiveReject);

    pub fn finalize(this: *OtelSpan) void {
        this.arena.deinit();
        bun.destroy(this);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn jsStringSlice(global: *JSGlobalObject, v: JSValue, arena: *std.heap.ArenaAllocator) bun.JSError![]const u8 {
    const slice = try v.toSlice(global, arena.allocator());
    defer slice.deinit();
    return bun.handleOom(arena.allocator().dupe(u8, slice.slice()));
}

fn anyValueFromJS(global: *JSGlobalObject, v: JSValue, gpa: std.mem.Allocator) bun.JSError!attributes.Value {
    if (v.isString()) {
        const s = try v.toSlice(global, gpa);
        defer s.deinit();
        return .string(bun.handleOom(gpa.dupe(u8, s.slice())));
    }
    if (v.isBoolean()) return .boolean(v.asBoolean());
    if (v.isBigInt()) return .int(@bitCast(v.toUInt64NoTruncate()));
    if (v.isNumber()) {
        const n = v.asNumber();
        if (@trunc(n) == n and std.math.isFinite(n) and @abs(n) < @as(f64, @floatFromInt(@as(i64, 1) << 53))) {
            return .int(@intFromFloat(n));
        }
        return .double(n);
    }
    if (v.asArrayBuffer(global)) |ab| {
        return .bytesV(bun.handleOom(gpa.dupe(u8, ab.byteSlice())));
    }
    if (v.isUndefinedOrNull()) return .empty;
    // Fallback: stringify objects/arrays. Keeps the hot path branch-free; OTEL
    // spec only requires string|bool|int|double|bytes|array as attribute values.
    const s = try v.toSlice(global, gpa);
    defer s.deinit();
    return .string(bun.handleOom(gpa.dupe(u8, s.slice())));
}

fn readSpanContext(global: *JSGlobalObject, v: JSValue) bun.JSError!?model.SpanContext {
    if (v.isUndefinedOrNull()) return null;
    if (OtelSpanContext.fromJS(v)) |sc| return sc.ctx;
    if (OtelSpan.fromJS(v)) |span| return span.ctx;
    if (v.isObject()) {
        // {traceId: Uint8Array(16), spanId: Uint8Array(8), traceFlags?: number}
        var ctx: model.SpanContext = .{ .trace_id = model.zero_trace_id, .span_id = model.zero_span_id, .flags = 0 };
        if (try v.get(global, "traceId")) |tid| {
            if (tid.asArrayBuffer(global)) |ab| {
                if (ab.byteSlice().len == 16) @memcpy(&ctx.trace_id, ab.byteSlice());
            }
        }
        if (try v.get(global, "spanId")) |sid| {
            if (sid.asArrayBuffer(global)) |ab| {
                if (ab.byteSlice().len == 8) @memcpy(&ctx.span_id, ab.byteSlice());
            }
        }
        if (try v.get(global, "traceFlags")) |tf| {
            if (tf.isNumber()) ctx.flags = @truncate(@as(u32, @intCast(@max(tf.toInt32(), 0))));
        }
        return if (ctx.isValid()) ctx else null;
    }
    return null;
}

const bun = @import("bun");
const instrument = @import("./instrument.zig");
const model = @import("./span.zig");
const propagation = @import("./propagation.zig");
const std = @import("std");
const BatchProcessor = @import("./processor.zig").BatchProcessor;
const OtlpHttpExporter = @import("./otlp/exporter.zig").OtlpHttpExporter;

const attributes = @import("./attributes.zig");
const Attribute = attributes.Attribute;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
