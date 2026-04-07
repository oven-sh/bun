//! JavaScript bindings for `Bun.otel`.
//!
//! This is the slow-but-spec-shaped public codec: `encodeTraces` accepts an
//! OTLP/JSON-shaped plain object (camelCase keys, hex traceId/spanId, decimal
//! string int64s) and returns protobuf bytes; `decodeTraces` is the inverse.
//! The hot path (native batch processor → wire) lives in `encode.zig` and does
//! not go through here.

// ─────────────────────────────────────────────────────────────────────────────
// encodeTraces
// ─────────────────────────────────────────────────────────────────────────────

pub fn jsEncodeTraces(global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arg = callframe.argument(0);
    if (!arg.isObject()) {
        return global.throwInvalidArguments("encodeTraces expects an object with a resourceSpans array", .{});
    }

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const alloc = arena.allocator();

    var ctx: ReadCtx = .{ .global = global, .alloc = alloc };
    const resource_spans = try ctx.readResourceSpansArray(arg);

    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(bun.default_allocator);
    bun.handleOom(encode.encodeExportTraceServiceRequest(bun.default_allocator, resource_spans, &out));

    return jsc.ArrayBuffer.createUint8Array(global, out.items);
}

const ReadCtx = struct {
    global: *JSGlobalObject,
    alloc: std.mem.Allocator,

    fn str(ctx: *ReadCtx, obj: JSValue, comptime name: []const u8) bun.JSError![]const u8 {
        const v = (try obj.get(ctx.global, name)) orelse return "";
        if (v.isUndefinedOrNull()) return "";
        const slice = try v.toSlice(ctx.global, ctx.alloc);
        // Arena owns any allocated copy; borrowed slices stay valid for the
        // duration of the host call. Dupe so the encoder doesn't reach into
        // potentially-ropey JSString internals after further JS allocation.
        return bun.handleOom(ctx.alloc.dupe(u8, slice.slice()));
    }

    fn uint32(ctx: *ReadCtx, obj: JSValue, comptime name: []const u8) bun.JSError!u32 {
        const v = (try obj.get(ctx.global, name)) orelse return 0;
        if (!v.isNumber()) return 0;
        const n = v.asNumber();
        if (n < 0 or n > @as(f64, std.math.maxInt(u32))) return 0;
        return @intFromFloat(n);
    }

    fn fixed64(ctx: *ReadCtx, obj: JSValue, comptime name: []const u8) bun.JSError!u64 {
        const v = (try obj.get(ctx.global, name)) orelse return 0;
        return try ctx.parseInt64(v, name) orelse 0;
    }

    fn parseInt64(ctx: *ReadCtx, v: JSValue, comptime name: []const u8) bun.JSError!?u64 {
        if (v.isUndefinedOrNull()) return null;
        if (v.isNumber()) {
            const n = v.asNumber();
            if (!std.math.isFinite(n)) {
                return ctx.global.throwInvalidArguments("'{s}' must be a finite number", .{name});
            }
            return @bitCast(std.math.lossyCast(i64, n));
        }
        if (v.isBigInt()) return v.toUInt64NoTruncate();
        if (v.isString()) {
            const s = try v.toSlice(ctx.global, ctx.alloc);
            defer s.deinit();
            if (std.fmt.parseInt(i64, s.slice(), 10) catch null) |signed| return @bitCast(signed);
            return std.fmt.parseInt(u64, s.slice(), 10) catch {
                return ctx.global.throwInvalidArguments("invalid int64 string for '{s}'", .{name});
            };
        }
        return ctx.global.throwInvalidArguments("'{s}' must be a string, number, or bigint", .{name});
    }

    fn hexId(ctx: *ReadCtx, obj: JSValue, comptime name: []const u8, comptime N: usize) bun.JSError![N]u8 {
        var out: [N]u8 = [_]u8{0} ** N;
        const v = (try obj.get(ctx.global, name)) orelse return out;
        if (v.isUndefinedOrNull()) return out;
        const s = try v.toSlice(ctx.global, ctx.alloc);
        defer s.deinit();
        const hex = s.slice();
        if (hex.len == 0) return out;
        if (hex.len != N * 2) {
            return ctx.global.throwInvalidArguments("'{s}' must be {d} hex chars, got {d}", .{ name, N * 2, hex.len });
        }
        _ = bun.strings.decodeHexToBytes(&out, u8, hex) catch {
            return ctx.global.throwInvalidArguments("'{s}' is not valid hex", .{name});
        };
        return out;
    }

    fn readResourceSpansArray(ctx: *ReadCtx, root: JSValue) bun.JSError![]span.ResourceSpans {
        const arr = (try root.get(ctx.global, "resourceSpans")) orelse return &.{};
        if (!arr.isArray()) return &.{};
        var iter = try arr.arrayIterator(ctx.global);
        var list = bun.handleOom(std.ArrayList(span.ResourceSpans).initCapacity(ctx.alloc, iter.len));
        while (try iter.next()) |item| {
            if (!item.isObject()) continue;
            list.appendAssumeCapacity(try ctx.readResourceSpans(item));
        }
        return list.items;
    }

    fn readResourceSpans(ctx: *ReadCtx, obj: JSValue) bun.JSError!span.ResourceSpans {
        var rs: span.ResourceSpans = .{ .scope_spans = &.{} };
        if (try obj.get(ctx.global, "resource")) |res_v| {
            if (res_v.isObject()) rs.resource = .{
                .attributes = try ctx.readAttributes(res_v, "attributes"),
                .dropped_attributes_count = try ctx.uint32(res_v, "droppedAttributesCount"),
            };
        }
        rs.schema_url = try ctx.str(obj, "schemaUrl");
        if (try obj.get(ctx.global, "scopeSpans")) |arr| if (arr.isArray()) {
            var iter = try arr.arrayIterator(ctx.global);
            var list = bun.handleOom(std.ArrayList(span.ScopeSpans).initCapacity(ctx.alloc, iter.len));
            while (try iter.next()) |item| {
                if (!item.isObject()) continue;
                list.appendAssumeCapacity(try ctx.readScopeSpans(item));
            }
            rs.scope_spans = list.items;
        };
        return rs;
    }

    fn readScopeSpans(ctx: *ReadCtx, obj: JSValue) bun.JSError!span.ScopeSpans {
        var ss: span.ScopeSpans = .{ .spans = &.{} };
        if (try obj.get(ctx.global, "scope")) |scope_v| if (scope_v.isObject()) {
            ss.scope = .{
                .name = try ctx.str(scope_v, "name"),
                .version = try ctx.str(scope_v, "version"),
                .attributes = try ctx.readAttributes(scope_v, "attributes"),
                .dropped_attributes_count = try ctx.uint32(scope_v, "droppedAttributesCount"),
            };
        };
        ss.schema_url = try ctx.str(obj, "schemaUrl");
        if (try obj.get(ctx.global, "spans")) |arr| if (arr.isArray()) {
            var iter = try arr.arrayIterator(ctx.global);
            var list = bun.handleOom(std.ArrayList(span.Span).initCapacity(ctx.alloc, iter.len));
            while (try iter.next()) |item| {
                if (!item.isObject()) continue;
                list.appendAssumeCapacity(try ctx.readSpan(item));
            }
            ss.spans = list.items;
        };
        return ss;
    }

    fn readSpan(ctx: *ReadCtx, obj: JSValue) bun.JSError!span.Span {
        var s: span.Span = .{
            .trace_id = try ctx.hexId(obj, "traceId", 16),
            .span_id = try ctx.hexId(obj, "spanId", 8),
            .name = try ctx.str(obj, "name"),
        };
        s.trace_state = try ctx.str(obj, "traceState");
        s.parent_span_id = try ctx.hexId(obj, "parentSpanId", 8);
        s.flags = try ctx.uint32(obj, "flags");
        s.kind = @enumFromInt(@min(try ctx.uint32(obj, "kind"), 5));
        s.start_time_unix_nano = try ctx.fixed64(obj, "startTimeUnixNano");
        s.end_time_unix_nano = try ctx.fixed64(obj, "endTimeUnixNano");
        s.attributes = try ctx.readAttributes(obj, "attributes");
        s.dropped_attributes_count = try ctx.uint32(obj, "droppedAttributesCount");
        s.dropped_events_count = try ctx.uint32(obj, "droppedEventsCount");
        s.dropped_links_count = try ctx.uint32(obj, "droppedLinksCount");

        if (try obj.get(ctx.global, "events")) |arr| if (arr.isArray()) {
            var iter = try arr.arrayIterator(ctx.global);
            var list = bun.handleOom(std.ArrayList(span.Event).initCapacity(ctx.alloc, iter.len));
            while (try iter.next()) |item| if (item.isObject()) list.appendAssumeCapacity(.{
                .time_unix_nano = try ctx.fixed64(item, "timeUnixNano"),
                .name = try ctx.str(item, "name"),
                .attributes = try ctx.readAttributes(item, "attributes"),
                .dropped_attributes_count = try ctx.uint32(item, "droppedAttributesCount"),
            });
            s.events = list.items;
        };

        if (try obj.get(ctx.global, "links")) |arr| if (arr.isArray()) {
            var iter = try arr.arrayIterator(ctx.global);
            var list = bun.handleOom(std.ArrayList(span.Link).initCapacity(ctx.alloc, iter.len));
            while (try iter.next()) |item| if (item.isObject()) list.appendAssumeCapacity(.{
                .trace_id = try ctx.hexId(item, "traceId", 16),
                .span_id = try ctx.hexId(item, "spanId", 8),
                .trace_state = try ctx.str(item, "traceState"),
                .attributes = try ctx.readAttributes(item, "attributes"),
                .dropped_attributes_count = try ctx.uint32(item, "droppedAttributesCount"),
                .flags = try ctx.uint32(item, "flags"),
            });
            s.links = list.items;
        };

        if (try obj.get(ctx.global, "status")) |st_v| if (st_v.isObject()) {
            s.status = .{
                .message = try ctx.str(st_v, "message"),
                .code = @enumFromInt(@min(try ctx.uint32(st_v, "code"), 2)),
            };
        };

        return s;
    }

    fn readAttributes(ctx: *ReadCtx, obj: JSValue, comptime name: []const u8) bun.JSError![]const Attribute {
        const arr = (try obj.get(ctx.global, name)) orelse return attrs.empty;
        if (!arr.isArray()) return attrs.empty;
        return ctx.readAttributesFromArray(arr, 0);
    }

    fn readAttributesFromArray(ctx: *ReadCtx, arr: JSValue, depth: u8) bun.JSError![]const Attribute {
        if (depth > max_any_value_depth) return ctx.global.throwInvalidArguments("attribute nesting too deep", .{});
        var iter = try arr.arrayIterator(ctx.global);
        var list = bun.handleOom(std.ArrayList(Attribute).initCapacity(ctx.alloc, iter.len));
        while (try iter.next()) |item| {
            if (!item.isObject()) continue;
            const key = try ctx.str(item, "key");
            var value: AnyValue = .empty;
            if (try item.get(ctx.global, "value")) |v| if (v.isObject()) {
                value = try ctx.readAnyValue(v, depth + 1);
            };
            list.appendAssumeCapacity(.{ .key = key, .value = value });
        }
        return list.items;
    }

    fn readAnyValue(ctx: *ReadCtx, obj: JSValue, depth: u8) bun.JSError!AnyValue {
        if (depth > max_any_value_depth) return ctx.global.throwInvalidArguments("attribute nesting too deep", .{});
        if (try obj.get(ctx.global, "stringValue")) |v| {
            const s = try v.toSlice(ctx.global, ctx.alloc);
            return .{ .string = bun.handleOom(ctx.alloc.dupe(u8, s.slice())) };
        }
        if (try obj.get(ctx.global, "boolValue")) |v| return .{ .boolean = v.toBoolean() };
        if (try obj.get(ctx.global, "intValue")) |v| {
            const u = (try ctx.parseInt64(v, "intValue")) orelse 0;
            return .{ .int = @bitCast(u) };
        }
        if (try obj.get(ctx.global, "doubleValue")) |v| if (v.isNumber()) return .{ .double = v.asNumber() };
        if (try obj.get(ctx.global, "bytesValue")) |v| {
            const s = try v.toSlice(ctx.global, ctx.alloc);
            defer s.deinit();
            const slice = s.slice();
            const buf = bun.handleOom(ctx.alloc.alloc(u8, bun.base64.decodeLenUpperBound(slice.len)));
            const result = bun.base64.decode(buf, slice);
            return .{ .bytes = buf[0..result.count] };
        }
        if (try obj.get(ctx.global, "arrayValue")) |av| if (av.isObject()) {
            if (try av.get(ctx.global, "values")) |arr| if (arr.isArray()) {
                var iter = try arr.arrayIterator(ctx.global);
                var list = bun.handleOom(std.ArrayList(AnyValue).initCapacity(ctx.alloc, iter.len));
                while (try iter.next()) |item| {
                    if (!item.isObject()) continue;
                    list.appendAssumeCapacity(try ctx.readAnyValue(item, depth + 1));
                }
                return .{ .array = list.items };
            };
            return .{ .array = &.{} };
        };
        if (try obj.get(ctx.global, "kvlistValue")) |kvl| if (kvl.isObject()) {
            if (try kvl.get(ctx.global, "values")) |arr| if (arr.isArray()) {
                return .{ .kvlist = try ctx.readAttributesFromArray(arr, depth + 1) };
            };
            return .{ .kvlist = &.{} };
        };
        return .empty;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// decodeTraces
// ─────────────────────────────────────────────────────────────────────────────

pub fn jsDecodeTraces(global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arg = callframe.argument(0);
    const ab = arg.asArrayBuffer(global) orelse {
        return global.throwInvalidArguments("decodeTraces expects an ArrayBuffer or typed array", .{});
    };
    const bytes = ab.byteSlice();

    var d: DecodeCtx = .{ .global = global };
    return d.decodeRequest(bytes) catch |err| switch (err) {
        error.JSError => |e| return e,
        error.OutOfMemory => bun.outOfMemory(),
        else => return global.throwInvalidArguments("malformed OTLP protobuf: {s}", .{@errorName(err)}),
    };
}

const max_any_value_depth = 32;

const DecodeCtx = struct {
    global: *JSGlobalObject,
    depth: u8 = 0,

    const Err = pb.DecodeError || bun.JSError || std.mem.Allocator.Error;

    fn obj(d: *DecodeCtx, hint: usize) JSValue {
        return JSValue.createEmptyObject(d.global, hint);
    }

    fn jsStr(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        return try bun.String.createUTF8ForJS(d.global, bytes);
    }

    fn jsHex(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var stack: [32]u8 = undefined;
        if (bytes.len * 2 > stack.len) {
            // OTLP IDs are 8/16 bytes; anything else is producer error but we
            // still surface it without crashing.
            const buf = bun.handleOom(bun.default_allocator.alloc(u8, bytes.len * 2));
            defer bun.default_allocator.free(buf);
            _ = bun.strings.encodeBytesToHex(buf, bytes);
            return d.jsStr(buf);
        }
        const n = bun.strings.encodeBytesToHex(stack[0 .. bytes.len * 2], bytes);
        return d.jsStr(stack[0..n]);
    }

    fn jsInt64Str(d: *DecodeCtx, v: u64) Err!JSValue {
        var stack: [24]u8 = undefined;
        const s = std.fmt.bufPrint(&stack, "{d}", .{v}) catch unreachable;
        return d.jsStr(s);
    }

    fn jsSignedInt64Str(d: *DecodeCtx, v: i64) Err!JSValue {
        var stack: [24]u8 = undefined;
        const s = std.fmt.bufPrint(&stack, "{d}", .{v}) catch unreachable;
        return d.jsStr(s);
    }

    fn jsBase64(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        const buf = bun.handleOom(bun.default_allocator.alloc(u8, bun.base64.encodeLen(bytes)));
        defer bun.default_allocator.free(buf);
        const n = bun.base64.encode(buf, bytes);
        return d.jsStr(buf[0..n]);
    }

    fn arrayPusher(d: *DecodeCtx) Err!ArrayPusher {
        return .{ .global = d.global, .arr = try JSValue.createEmptyArray(d.global, 0) };
    }

    fn decodeRequest(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const root = d.obj(1);
        var rs = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.ExportTraceServiceRequest.resource_spans.num => try rs.push(try d.decodeResourceSpans(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        root.put(d.global, "resourceSpans", rs.arr);
        return root;
    }

    fn decodeResourceSpans(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(3);
        var ss = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.ResourceSpans.resource.num => o.put(d.global, "resource", try d.decodeResource(try r.readBytes())),
                tags.ResourceSpans.scope_spans.num => try ss.push(try d.decodeScopeSpans(try r.readBytes())),
                tags.ResourceSpans.schema_url.num => o.put(d.global, "schemaUrl", try d.jsStr(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "scopeSpans", ss.arr);
        return o;
    }

    fn decodeResource(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(2);
        var attributes = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.Resource.attributes.num => try attributes.push(try d.decodeKeyValue(try r.readBytes())),
                tags.Resource.dropped_attributes_count.num => o.put(d.global, "droppedAttributesCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "attributes", attributes.arr);
        return o;
    }

    fn decodeScopeSpans(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(3);
        var spans = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.ScopeSpans.scope.num => o.put(d.global, "scope", try d.decodeScope(try r.readBytes())),
                tags.ScopeSpans.spans.num => try spans.push(try d.decodeSpan(try r.readBytes())),
                tags.ScopeSpans.schema_url.num => o.put(d.global, "schemaUrl", try d.jsStr(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "spans", spans.arr);
        return o;
    }

    fn decodeScope(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(4);
        var attributes = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.InstrumentationScope.name.num => o.put(d.global, "name", try d.jsStr(try r.readBytes())),
                tags.InstrumentationScope.version.num => o.put(d.global, "version", try d.jsStr(try r.readBytes())),
                tags.InstrumentationScope.attributes.num => try attributes.push(try d.decodeKeyValue(try r.readBytes())),
                tags.InstrumentationScope.dropped_attributes_count.num => o.put(d.global, "droppedAttributesCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "attributes", attributes.arr);
        return o;
    }

    fn decodeSpan(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(16);
        var attributes = try d.arrayPusher();
        var events = try d.arrayPusher();
        var links = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.Span.trace_id.num => o.put(d.global, "traceId", try d.jsHex(try r.readBytes())),
                tags.Span.span_id.num => o.put(d.global, "spanId", try d.jsHex(try r.readBytes())),
                tags.Span.trace_state.num => o.put(d.global, "traceState", try d.jsStr(try r.readBytes())),
                tags.Span.parent_span_id.num => o.put(d.global, "parentSpanId", try d.jsHex(try r.readBytes())),
                tags.Span.name.num => o.put(d.global, "name", try d.jsStr(try r.readBytes())),
                tags.Span.kind.num => o.put(d.global, "kind", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                tags.Span.start_time_unix_nano.num => o.put(d.global, "startTimeUnixNano", try d.jsInt64Str(try r.readFixed64())),
                tags.Span.end_time_unix_nano.num => o.put(d.global, "endTimeUnixNano", try d.jsInt64Str(try r.readFixed64())),
                tags.Span.attributes.num => try attributes.push(try d.decodeKeyValue(try r.readBytes())),
                tags.Span.dropped_attributes_count.num => o.put(d.global, "droppedAttributesCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                tags.Span.events.num => try events.push(try d.decodeEvent(try r.readBytes())),
                tags.Span.dropped_events_count.num => o.put(d.global, "droppedEventsCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                tags.Span.links.num => try links.push(try d.decodeLink(try r.readBytes())),
                tags.Span.dropped_links_count.num => o.put(d.global, "droppedLinksCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                tags.Span.status.num => o.put(d.global, "status", try d.decodeStatus(try r.readBytes())),
                tags.Span.flags.num => o.put(d.global, "flags", JSValue.jsNumber(try r.readFixed32())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "attributes", attributes.arr);
        o.put(d.global, "events", events.arr);
        o.put(d.global, "links", links.arr);
        return o;
    }

    fn decodeEvent(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(4);
        var attributes = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.Span_Event.time_unix_nano.num => o.put(d.global, "timeUnixNano", try d.jsInt64Str(try r.readFixed64())),
                tags.Span_Event.name.num => o.put(d.global, "name", try d.jsStr(try r.readBytes())),
                tags.Span_Event.attributes.num => try attributes.push(try d.decodeKeyValue(try r.readBytes())),
                tags.Span_Event.dropped_attributes_count.num => o.put(d.global, "droppedAttributesCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "attributes", attributes.arr);
        return o;
    }

    fn decodeLink(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(6);
        var attributes = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.Span_Link.trace_id.num => o.put(d.global, "traceId", try d.jsHex(try r.readBytes())),
                tags.Span_Link.span_id.num => o.put(d.global, "spanId", try d.jsHex(try r.readBytes())),
                tags.Span_Link.trace_state.num => o.put(d.global, "traceState", try d.jsStr(try r.readBytes())),
                tags.Span_Link.attributes.num => try attributes.push(try d.decodeKeyValue(try r.readBytes())),
                tags.Span_Link.dropped_attributes_count.num => o.put(d.global, "droppedAttributesCount", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                tags.Span_Link.flags.num => o.put(d.global, "flags", JSValue.jsNumber(try r.readFixed32())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "attributes", attributes.arr);
        return o;
    }

    fn decodeStatus(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(2);
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.Status.message.num => o.put(d.global, "message", try d.jsStr(try r.readBytes())),
                tags.Status.code.num => o.put(d.global, "code", JSValue.jsNumber(@as(u32, @truncate(try r.readVarint())))),
                else => try r.skip(hdr.wire),
            }
        }
        return o;
    }

    fn decodeKeyValue(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(2);
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.KeyValue.key.num => o.put(d.global, "key", try d.jsStr(try r.readBytes())),
                tags.KeyValue.value.num => o.put(d.global, "value", try d.decodeAnyValue(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        return o;
    }

    fn decodeAnyValue(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        if (d.depth >= max_any_value_depth) return error.NestingTooDeep;
        d.depth += 1;
        defer d.depth -= 1;

        var r = pb.Reader.init(bytes);
        const o = d.obj(1);
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.AnyValue.string_value.num => o.put(d.global, "stringValue", try d.jsStr(try r.readBytes())),
                tags.AnyValue.bool_value.num => o.put(d.global, "boolValue", JSValue.jsBoolean((try r.readVarint()) != 0)),
                tags.AnyValue.int_value.num => o.put(d.global, "intValue", try d.jsSignedInt64Str(@bitCast(try r.readVarint()))),
                tags.AnyValue.double_value.num => o.put(d.global, "doubleValue", JSValue.jsDoubleNumber(@bitCast(try r.readFixed64()))),
                tags.AnyValue.bytes_value.num => o.put(d.global, "bytesValue", try d.jsBase64(try r.readBytes())),
                tags.AnyValue.array_value.num => o.put(d.global, "arrayValue", try d.decodeArrayValue(try r.readBytes())),
                tags.AnyValue.kvlist_value.num => o.put(d.global, "kvlistValue", try d.decodeKeyValueList(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        return o;
    }

    fn decodeArrayValue(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(1);
        var values = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.ArrayValue.values.num => try values.push(try d.decodeAnyValue(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "values", values.arr);
        return o;
    }

    fn decodeKeyValueList(d: *DecodeCtx, bytes: []const u8) Err!JSValue {
        var r = pb.Reader.init(bytes);
        const o = d.obj(1);
        var values = try d.arrayPusher();
        while (!r.done()) {
            const hdr = try r.readTag();
            switch (hdr.num) {
                tags.KeyValueList.values.num => try values.push(try d.decodeKeyValue(try r.readBytes())),
                else => try r.skip(hdr.wire),
            }
        }
        o.put(d.global, "values", values.arr);
        return o;
    }
};

const ArrayPusher = struct {
    global: *JSGlobalObject,
    arr: JSValue,
    i: u32 = 0,

    fn push(self: *ArrayPusher, v: JSValue) bun.JSError!void {
        try self.arr.putIndex(self.global, self.i, v);
        self.i += 1;
    }
};

comptime {
    const js_encode = jsc.toJSHostFn(jsEncodeTraces);
    @export(&js_encode, .{ .name = "Bun__otel__encodeTraces" });
    const js_decode = jsc.toJSHostFn(jsDecodeTraces);
    @export(&js_decode, .{ .name = "Bun__otel__decodeTraces" });
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;

const pb = @import("./otlp/protobuf.zig");
const encode = @import("./otlp/encode.zig");
const span = @import("./span.zig");
const attrs = @import("./attributes.zig");
const tags = @import("OtlpProtoTags");
const Attribute = attrs.Attribute;
const AnyValue = attrs.AnyValue;
