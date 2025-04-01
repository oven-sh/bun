const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const SourceMap = @import("../../sourcemap/sourcemap.zig");
const JSC = bun.JSC;
const ParsedSourceMap = SourceMap.ParsedSourceMap;
const Mapping = SourceMap.Mapping;
const ZigString = JSC.ZigString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

parsedSourceMap: *ParsedSourceMap,
lineLengths: ?[]u32 = null,

pub usingnamespace bun.New(JSParsedSourceMap);
pub usingnamespace JSC.Codegen.JSSourceMap;

pub fn getSourceMapConstructor(globalObject: *JSGlobalObject) JSValue {
    // The constructor function is generated automatically by WebKit/JSC through the codegen system
    return @This().getConstructor(globalObject);
}

pub fn estimatedSize(this: *JSParsedSourceMap) usize {
    var size = @sizeOf(JSParsedSourceMap);

    // Add size of ParsedSourceMap
    size += @sizeOf(ParsedSourceMap);

    // Add size of line lengths if present
    if (this.lineLengths) |lengths| {
        size += lengths.len * @sizeOf(u32);
    }

    // Add size of mappings
    size += this.parsedSourceMap.mappings.len * @sizeOf(SourceMap.MappingItem);

    // Add size of sources
    for (this.parsedSourceMap.external_source_names) |source| {
        size += source.len;
    }

    return size;
}

pub fn finalize(this: *JSParsedSourceMap) void {
    if (this.lineLengths) |lengths| {
        bun.default_allocator.free(lengths);
    }
    this.parsedSourceMap.deref();
    this.destroy();
}

pub fn constructor(globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*JSParsedSourceMap {
    const arguments = callframe.arguments();
    if (arguments.len < 1 or !arguments.ptr[0].isObject()) {
        return globalObject.throw("SourceMap constructor requires a SourceMapV3 payload object", .{});
    }

    const payload = arguments.ptr[0];
    var lineLengths: ?[]u32 = null;

    // Check for options argument
    if (arguments.len > 1 and arguments.ptr[1].isObject()) {
        const options = arguments.ptr[1];
        if (try options.get(globalObject, "lineLengths")) |lineLengthsValue| {
            if (lineLengthsValue.isUndefinedOrNull()) {
                // Leave lineLengths as null
            } else if (lineLengthsValue.isArray()) {
                const array_len = lineLengthsValue.getLength(globalObject);
                if (globalObject.hasException()) return .zero;

                const allocator = bun.default_allocator;
                lineLengths = allocator.alloc(u32, array_len) catch bun.outOfMemory();

                for (0..array_len) |i| {
                    const val = lineLengthsValue.getIndex(globalObject, i);
                    lineLengths.?[i] = val.coerce(u32, globalObject);
                    if (globalObject.hasException()) {
                        allocator.free(lineLengths.?);
                        return .zero;
                    }
                }
            } else {
                return globalObject.throw("lineLengths must be an array of numbers", .{});
            }
        }
    }

    // Get the SourceMapV3 properties
    const version = try payload.get(globalObject, "version");
    if (version == null or !version.?.isNumber() or version.?.toInt32() != 3) {
        return globalObject.throw("SourceMap version must be 3", .{});
    }

    const sources = try payload.get(globalObject, "sources");
    if (sources == null or !sources.?.isArray()) {
        return globalObject.throw("SourceMap sources must be an array", .{});
    }

    const mappings = try payload.get(globalObject, "mappings");
    if (mappings == null or !mappings.?.isString()) {
        return globalObject.throw("SourceMap mappings must be a string", .{});
    }

    const mappings_str = try mappings.?.toBunString(globalObject);
    defer mappings_str.deref();
    const mappings_bytes = mappings_str.byteSlice();

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    const sources_array = sources.?.asArrayBuffer(globalObject);
    if (sources_array == null) {
        return globalObject.throw("SourceMap sources must be an array", .{});
    }

    const sources_array_len = sources_array.?.length;
    const source_paths_slice = bun.default_allocator.alloc([]const u8, sources_array_len) catch bun.outOfMemory();

    var i: usize = 0;
    errdefer {
        for (0..i) |j| {
            bun.default_allocator.free(source_paths_slice[j]);
        }
        bun.default_allocator.free(source_paths_slice);
    }
    while (i < sources_array_len) : (i += 1) {
        const source = sources.?.getIndex(globalObject, i);
        if (globalObject.hasException()) {}

        const source_str = try source.toBunString(globalObject);
        defer source_str.deref();

        source_paths_slice[i] = bun.default_allocator.dupe(u8, source_str.byteSlice()) catch bun.outOfMemory();
    }

    // Parse the mappings
    const map_data = switch (Mapping.parse(
        bun.default_allocator,
        mappings_bytes,
        null,
        std.math.maxInt(i32),
        @intCast(sources_array_len),
    )) {
        .success => |x| x,
        .fail => |fail| {
            return globalObject.throw("Failed to parse SourceMap mappings: {s} ({s})", .{ fail.msg, @errorName(fail.err) });
        },
    };

    const ptr = ParsedSourceMap.new(map_data);
    ptr.external_source_names = source_paths_slice;

    return JSParsedSourceMap.new(.{
        .parsedSourceMap = ptr,
        .lineLengths = lineLengths,
    });
}

pub fn getPayload(this: *JSParsedSourceMap, globalObject: *JSGlobalObject) JSValue {
    const map = this.parsedSourceMap;
    const object = JSValue.createEmptyObject(globalObject, 5);

    // version field
    object.put(globalObject, "version", JSValue.jsNumber(3));

    // sources field
    const sources = JSValue.createEmptyArray(globalObject, map.external_source_names.len);
    for (map.external_source_names, 0..) |source, i| {
        sources.putIndex(globalObject, i, ZigString.init(source).toJS(globalObject));
    }
    object.put(globalObject, "sources", sources);

    // sourcesContent field
    const sourcesContent = JSValue.createEmptyArray(globalObject, map.external_source_names.len);
    for (map.external_source_names, 0..) |source, i| {
        sourcesContent.putIndex(globalObject, @intCast(i), bun.String.createUTF8ForJS(globalObject, source));
    }
    object.put(globalObject, "sourcesContent", sourcesContent);

    // names field
    object.put(globalObject, "names", JSValue.createEmptyArray(globalObject, 0));

    // mappings field
    var buf = std.ArrayList(u8).init(bun.default_allocator);
    defer buf.deinit();
    map.writeVLQs(buf.writer()) catch bun.outOfMemory();
    object.put(globalObject, "mappings", bun.String.createUTF8ForJS(globalObject, buf.items));

    return object;
}

pub fn getLineLengths(this: *JSParsedSourceMap, globalObject: *JSGlobalObject) JSValue {
    if (this.lineLengths) |lengths| {
        const array = JSValue.createEmptyArray(globalObject, lengths.len);
        for (lengths, 0..) |length, i| {
            array.putIndex(globalObject, i, JSValue.jsNumber(length));
        }
        return array;
    }
    return JSValue.jsUndefined();
}

pub fn findEntry(
    this: *JSParsedSourceMap,
    globalObject: *JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSValue {
    const args = callframe.arguments();
    if (args.len < 2) {
        return globalObject.throwNotEnoughArguments("findEntry", 2, args.len);
    }

    const lineOffset = try globalObject.validateIntegerRange(args[0], i32, 0, .{ .min = 1, .max = std.math.maxInt(i32) });
    const columnOffset = try globalObject.validateIntegerRange(args[1], i32, 0, .{ .min = 0, .max = std.math.maxInt(i32) });

    // Find the mapping
    const mapping = Mapping.find(this.parsedSourceMap.mappings, lineOffset, columnOffset) orelse {
        return JSValue.createEmptyObject(globalObject, 0);
    };

    // Create a SourceMapEntry object with the mapping data
    const entryObj = JSValue.createEmptyObject(globalObject, 6);
    entryObj.put(globalObject, "generatedLine", JSValue.jsNumber(mapping.generatedLine()));
    entryObj.put(globalObject, "generatedColumn", JSValue.jsNumber(mapping.generatedColumn()));

    if (mapping.sourceIndex() >= 0 and mapping.sourceIndex() < @as(i32, @intCast(this.parsedSourceMap.external_source_names.len))) {
        const sourceName = this.parsedSourceMap.external_source_names[@intCast(mapping.sourceIndex())];
        entryObj.put(globalObject, "originalSource", bun.String.createUTF8ForJS(globalObject, sourceName));
        entryObj.put(globalObject, "originalLine", JSValue.jsNumber(mapping.originalLine()));
        entryObj.put(globalObject, "originalColumn", JSValue.jsNumber(mapping.originalColumn()));

        // TODO: Add name if available
        // if (mapping.nameIndex() >= 0) {
        //     entryObj.put(globalObject, "name", JSValue.jsString(globalObject, ""));
        // }
    }

    return entryObj;
}

pub fn findOrigin(
    this: *JSParsedSourceMap,
    globalObject: *JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSValue {
    const args = callframe.arguments();
    if (args.len < 2) {
        return globalObject.throw("findOrigin requires lineNumber and columnNumber arguments", .{});
    }

    // Convert 1-indexed to 0-indexed
    const lineNumber = args.ptr[0].toInt32() - 1;
    const columnNumber = args.ptr[1].toInt32() - 1;

    // Find the mapping
    const mapping = Mapping.find(this.parsedSourceMap.mappings, lineNumber, columnNumber);
    if (mapping == null) {
        return JSValue.createEmptyObject(globalObject, 0);
    }

    // Create a SourceMapOrigin object with the mapping data
    const originObj = JSValue.createEmptyObject(globalObject, 3);

    if (mapping.?.sourceIndex() >= 0 and mapping.?.sourceIndex() < @as(i32, @intCast(this.parsedSourceMap.external_source_names.len))) {
        const sourceName = this.parsedSourceMap.external_source_names[@intCast(mapping.?.sourceIndex())];
        originObj.put(globalObject, "fileName", ZigString.init(sourceName).toJS(globalObject));

        // Convert back to 1-indexed for the return value
        originObj.put(globalObject, "lineNumber", JSValue.jsNumber(mapping.?.originalLine() + 1));
        originObj.put(globalObject, "columnNumber", JSValue.jsNumber(mapping.?.originalColumn() + 1));

        // TODO: Add name if available
    }

    return originObj;
}

const JSParsedSourceMap = @This();
