/// This implements the JavaScript SourceMap class from Node.js.
///
const JSSourceMap = @This();

sourcemap: *bun.sourcemap.ParsedSourceMap,
sources: []bun.String = &.{},
names: []bun.String = &.{},

fn findSourceMap(
    globalObject: *JSGlobalObject,
    callFrame: *CallFrame,
) bun.JSError!JSValue {
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
            const path = bun.JSC.URL.pathFromFileURL(source_url_string);

            if (path.tag == .Dead) {
                return globalObject.ERR(.INVALID_URL, "Invalid URL: {s}", .{source_url}).throw();
            }

            source_url_string.deref();
            source_url_slice.deinit();
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

    var names = std.ArrayList(bun.String).init(bun.default_allocator);
    errdefer {
        for (names.items) |*str| {
            str.deref();
        }
        names.deinit();
    }

    // Convert sources array to ZigString.Slice objects
    var sources = std.ArrayList(bun.String).init(bun.default_allocator);
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
    const parse_result = bun.sourcemap.Mapping.parse(
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
        .sourcemap = bun.new(bun.sourcemap.ParsedSourceMap, mapping_list),
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

fn mappingNameToJS(this: *const JSSourceMap, globalObject: *JSGlobalObject, mapping: *const bun.sourcemap.Mapping) bun.JSError!JSValue {
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

fn sourceNameToJS(this: *const JSSourceMap, globalObject: *JSGlobalObject, mapping: *const bun.sourcemap.Mapping) bun.JSError!JSValue {
    const source_index = mapping.sourceIndex();
    if (source_index >= 0 and source_index < @as(i32, @intCast(this.sources.len))) {
        return this.sources[@intCast(source_index)].toJS(globalObject);
    }

    return .js_undefined;
}

pub fn findOrigin(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    const line_number, const column_number = try getLineColumn(globalObject, callFrame);

    const mapping = this.sourcemap.mappings.find(line_number, column_number) orelse return JSC.JSValue.createEmptyObject(globalObject, 0);
    const result = JSC.JSValue.createEmptyObject(globalObject, 4);
    result.put(globalObject, JSC.ZigString.static("line"), JSC.JSValue.jsNumber(mapping.originalLine()));
    result.put(globalObject, JSC.ZigString.static("column"), JSC.JSValue.jsNumber(mapping.originalColumn()));
    result.put(globalObject, JSC.ZigString.static("fileName"), try sourceNameToJS(this, globalObject, &mapping));
    result.put(globalObject, JSC.ZigString.static("name"), try mappingNameToJS(this, globalObject, &mapping));

    return result;
}

pub fn findEntry(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
    const line_number, const column_number = try getLineColumn(globalObject, callFrame);

    const mapping = this.sourcemap.mappings.find(line_number, column_number) orelse return JSC.JSValue.createEmptyObject(globalObject, 0);

    const result = JSC.JSValue.createEmptyObject(globalObject, 5);
    result.put(globalObject, JSC.ZigString.static("generatedLine"), JSC.JSValue.jsNumber(mapping.generatedLine()));
    result.put(globalObject, JSC.ZigString.static("generatedColumn"), JSC.JSValue.jsNumber(mapping.generatedColumn()));
    result.put(globalObject, JSC.ZigString.static("originalLine"), JSC.JSValue.jsNumber(mapping.originalLine()));
    result.put(globalObject, JSC.ZigString.static("originalColumn"), JSC.JSValue.jsNumber(mapping.originalColumn()));
    result.put(globalObject, JSC.ZigString.static("originalSource"), try sourceNameToJS(this, globalObject, &mapping));
    result.put(globalObject, JSC.ZigString.static("name"), try mappingNameToJS(this, globalObject, &mapping));

    return result;
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
    const jsFunctionFindSourceMap = JSC.toJSHostFn(findSourceMap);
    @export(&jsFunctionFindSourceMap, .{ .name = "Bun__JSSourceMap__find" });
}

// @sortImports

const std = @import("std");

const bun = @import("bun");
const string = bun.string;

const JSC = bun.JSC;
const CallFrame = JSC.CallFrame;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;

pub const js = JSC.Codegen.JSSourceMap;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;
