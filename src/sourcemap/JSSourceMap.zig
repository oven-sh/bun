/// This implements the JavaScript SourceMap class from Node.js.
///
const JSSourceMap = @This();

sourcemap: *bun.SourceMap.ParsedSourceMap,
sources: []bun.String = &.{},
names: []bun.String = &.{},

/// TODO: when we implement --enable-source-map CLI flag, set this to true.
pub var @"--enable-source-maps" = false;

fn findSourceMap(
    globalObject: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
    // Node.js doesn't enable source maps by default.
    // In Bun, we do use them for almost all files since we transpile almost all files
    // If we enable this by default, we don't have a `payload` object since we don't internally create one.
    // This causes Next.js to emit errors like the below on start:
    //       .next/server/chunks/ssr/[root-of-the-server]__012ba519._.js: Invalid source map. Only conformant source maps can be used to filter stack frames. Cause: TypeError: payload is not an Object. (evaluating '"sections" in payload')
    if (!@"--enable-source-maps") {
        return .js_undefined;
    }

    const source_url_value = callFrame.argument(0);
    if (!source_url_value.isString()) {
        return .js_undefined;
    }

    var source_url_string = try bun.String.fromJS(source_url_value, globalObject);
    defer source_url_string.deref();

    var source_url_slice = source_url_string.toUTF8(bun.default_allocator);
    defer source_url_slice.deinit();

    var source_url = source_url_slice.slice();
    if (bun.strings.hasPrefix(source_url, "node:") or bun.strings.hasPrefix(source_url, "bun:") or bun.strings.hasPrefix(source_url, "data:")) {
        return .js_undefined;
    }

    if (bun.strings.indexOf(source_url, "://")) |source_url_index| {
        if (bun.strings.eqlComptime(source_url[0..source_url_index], "file")) {
            const path = bun.jsc.URL.pathFromFileURL(source_url_string);

            if (path.tag == .Dead) {
                return globalObject.ERR(.INVALID_URL, "Invalid URL: {s}", .{source_url}).throw();
            }

            // Replace the file:// URL with the absolute path.
            source_url_string.deref();
            source_url_slice.deinit();
            source_url_string = path;
            source_url_slice = path.toUTF8(bun.default_allocator);
            source_url = source_url_slice.slice();
        }
    }

    const vm = globalObject.bunVM();
    const source_map = vm.source_mappings.get(source_url) orelse return .js_undefined;
    const fake_sources_array = bun.default_allocator.alloc(bun.String, 1) catch return globalObject.throwOutOfMemory();
    fake_sources_array[0] = source_url_string.dupeRef();

    const this = bun.new(JSSourceMap, .{
        .sourcemap = source_map,
        .sources = fake_sources_array,
        .names = &.{},
    });

    return this.toJS(globalObject);
}

pub fn constructor(
    globalObject: *JSGlobalObject,
    callFrame: *CallFrame,
    thisValue: JSValue,
) bun.JSError!*JSSourceMap {
    const payload_arg = callFrame.argument(0);
    const options_arg = callFrame.argument(1);

    try globalObject.validateObject("payload", payload_arg, .{});

    var line_lengths: JSValue = .zero;
    if (options_arg.isObject()) {
        // Node doesn't check it further than this.
        if (try options_arg.getIfPropertyExists(globalObject, "lineLengths")) |lengths| {
            if (lengths.jsType().isArray()) {
                line_lengths = lengths;
            }
        }
    }

    // Parse the payload to create a proper sourcemap
    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const arena_allocator = arena.allocator();

    // Extract mappings string from payload
    const mappings_value = try payload_arg.getStringish(globalObject, "mappings") orelse {
        return globalObject.throwInvalidArguments("payload 'mappings' must be a string", .{});
    };
    defer mappings_value.deref();

    const mappings_str = mappings_value.toUTF8(arena_allocator);
    defer mappings_str.deinit();

    var names = std.array_list.Managed(bun.String).init(bun.default_allocator);
    errdefer {
        for (names.items) |*str| {
            str.deref();
        }
        names.deinit();
    }

    var sources = std.array_list.Managed(bun.String).init(bun.default_allocator);
    errdefer {
        for (sources.items) |*str| {
            str.deref();
        }
        sources.deinit();
    }

    if (try payload_arg.getArray(globalObject, "sources")) |sources_value| {
        var iter = try sources_value.arrayIterator(globalObject);
        while (try iter.next()) |source| {
            const source_str = try source.toBunString(globalObject);
            try sources.append(source_str);
        }
    }

    if (try payload_arg.getArray(globalObject, "names")) |names_value| {
        var iter = try names_value.arrayIterator(globalObject);
        while (try iter.next()) |name| {
            const name_str = try name.toBunString(globalObject);
            try names.append(name_str);
        }
    }

    // Parse the VLQ mappings
    const parse_result = bun.SourceMap.Mapping.parse(
        bun.default_allocator,
        mappings_str.slice(),
        null, // estimated_mapping_count
        @intCast(sources.items.len), // sources_count
        std.math.maxInt(i32),
        .{ .allow_names = true, .sort = true },
    );

    const mapping_list = switch (parse_result) {
        .success => |parsed| parsed,
        .fail => |fail| {
            if (fail.loc.toNullable()) |loc| {
                return globalObject.throwValue(globalObject.createSyntaxErrorInstance("{s} at {d}", .{ fail.msg, loc.start }));
            }
            return globalObject.throwValue(globalObject.createSyntaxErrorInstance("{s}", .{fail.msg}));
        },
    };

    const source_map = bun.new(JSSourceMap, .{
        .sourcemap = bun.new(bun.SourceMap.ParsedSourceMap, mapping_list),
        .sources = sources.items,
        .names = names.items,
    });

    if (payload_arg != .zero) {
        js.payloadSetCached(thisValue, globalObject, payload_arg);
    }
    if (line_lengths != .zero) {
        js.lineLengthsSetCached(thisValue, globalObject, line_lengths);
    }

    return source_map;
}

pub fn memoryCost(this: *const JSSourceMap) usize {
    return @sizeOf(JSSourceMap) + this.sources.len * @sizeOf(bun.String) + this.sourcemap.memoryCost();
}

pub fn estimatedSize(this: *JSSourceMap) usize {
    return this.memoryCost();
}

// The cached value should handle this.
pub fn getPayload(_: *JSSourceMap, _: *JSGlobalObject) JSValue {
    return .js_undefined;
}

// The cached value should handle this.
pub fn getLineLengths(_: *JSSourceMap, _: *JSGlobalObject) JSValue {
    return .js_undefined;
}

fn getLineColumn(globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError![2]i32 {
    const line_number_value = callFrame.argument(0);
    const column_number_value = callFrame.argument(1);

    return .{
        // Node.js does no validations.
        try line_number_value.coerce(i32, globalObject),
        try column_number_value.coerce(i32, globalObject),
    };
}

fn mappingNameToJS(this: *const JSSourceMap, globalObject: *JSGlobalObject, mapping: *const bun.SourceMap.Mapping) bun.JSError!JSValue {
    const name_index = mapping.nameIndex();
    if (name_index >= 0) {
        if (this.sourcemap.mappings.getName(name_index)) |name| {
            return bun.String.createUTF8ForJS(globalObject, name);
        } else {
            const index: usize = @intCast(name_index);
            if (index < this.names.len) {
                return this.names[index].toJS(globalObject);
            }
        }
    }
    return .js_undefined;
}

fn sourceNameToJS(this: *const JSSourceMap, globalObject: *JSGlobalObject, mapping: *const bun.SourceMap.Mapping) bun.JSError!JSValue {
    const source_index = mapping.sourceIndex();
    if (source_index >= 0 and source_index < @as(i32, @intCast(this.sources.len))) {
        return this.sources[@intCast(source_index)].toJS(globalObject);
    }

    return .js_undefined;
}

extern fn Bun__createNodeModuleSourceMapOriginObject(
    globalObject: *JSGlobalObject,
    name: JSValue,
    line: JSValue,
    column: JSValue,
    source: JSValue,
) JSValue;

extern fn Bun__createNodeModuleSourceMapEntryObject(
    globalObject: *JSGlobalObject,
    generatedLine: JSValue,
    generatedColumn: JSValue,
    originalLine: JSValue,
    originalColumn: JSValue,
    source: JSValue,
    name: JSValue,
) JSValue;

pub fn findOrigin(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    const line_number, const column_number = try getLineColumn(globalObject, callFrame);

    const mapping = this.sourcemap.mappings.find(.fromZeroBased(line_number), .fromZeroBased(column_number)) orelse return jsc.JSValue.createEmptyObject(globalObject, 0);
    const name = try mappingNameToJS(this, globalObject, &mapping);
    const source = try sourceNameToJS(this, globalObject, &mapping);
    return Bun__createNodeModuleSourceMapOriginObject(
        globalObject,
        name,
        jsc.JSValue.jsNumber(mapping.originalLine()),
        jsc.JSValue.jsNumber(mapping.originalColumn()),
        source,
    );
}

pub fn findEntry(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    const line_number, const column_number = try getLineColumn(globalObject, callFrame);

    const mapping = this.sourcemap.mappings.find(.fromZeroBased(line_number), .fromZeroBased(column_number)) orelse return jsc.JSValue.createEmptyObject(globalObject, 0);

    const name = try mappingNameToJS(this, globalObject, &mapping);
    const source = try sourceNameToJS(this, globalObject, &mapping);
    return Bun__createNodeModuleSourceMapEntryObject(
        globalObject,
        jsc.JSValue.jsNumber(mapping.generatedLine()),
        jsc.JSValue.jsNumber(mapping.generatedColumn()),
        jsc.JSValue.jsNumber(mapping.originalLine()),
        jsc.JSValue.jsNumber(mapping.originalColumn()),
        source,
        name,
    );
}

pub fn deinit(this: *JSSourceMap) void {
    for (this.sources) |*str| {
        str.deref();
    }
    bun.default_allocator.free(this.sources);

    for (this.names) |*name| {
        name.deref();
    }

    bun.default_allocator.free(this.names);

    this.sourcemap.deref();
    bun.destroy(this);
}

pub fn finalize(this: *JSSourceMap) void {
    this.deinit();
}

comptime {
    const jsFunctionFindSourceMap = jsc.toJSHostFn(findSourceMap);
    @export(&jsFunctionFindSourceMap, .{ .name = "Bun__JSSourceMap__find" });
}

pub const js = jsc.Codegen.JSSourceMap;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const string = []const u8;

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
