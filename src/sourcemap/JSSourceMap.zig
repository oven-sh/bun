const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const string = bun.string;

pub const JSSourceMap = struct {
    pub const js = JSC.Codegen.JSSourceMap;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    sourcemap: bun.sourcemap.SourceMap,
    payload: JSValue = .zero,
    line_lengths: JSValue = .zero,
    sources: []JSC.ZigString.Slice = &.{},

    pub fn constructor(
        globalObject: *JSGlobalObject,
        callFrame: *CallFrame,
    ) bun.JSError!*JSSourceMap {
        
        if (callFrame.argumentsCount() < 1) {
            return globalObject.throw("SourceMap constructor requires a payload argument", .{});
        }

        const payload_arg = callFrame.argument(0);
        const options_arg = callFrame.argument(1);

        if (!payload_arg.isObject()) {
            return globalObject.throw("payload must be an object", .{});
        }

        var line_lengths: JSValue = .zero;
        if (!options_arg.isUndefinedOrNull()) {
            if (!options_arg.isObject()) {
                return globalObject.throw("options must be an object", .{});
            }
            
            if (try options_arg.getIfPropertyExists(globalObject, "lineLengths")) |lengths| {
                if (!lengths.isUndefinedOrNull() and !lengths.jsType().isArray()) {
                    return globalObject.throw("lineLengths must be an array", .{});
                }
                line_lengths = lengths;
            }
        }

        // Parse the payload to create a proper sourcemap
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const arena_allocator = arena.allocator();

        // Extract mappings string from payload
        const mappings_value = try payload_arg.getIfPropertyExists(globalObject, "mappings") orelse {
            return globalObject.throw("payload must have a 'mappings' property", .{});
        };
        
        if (!mappings_value.isString()) {
            return globalObject.throw("mappings must be a string", .{});
        }
        
        const mappings_zigstring = try mappings_value.getZigString(globalObject);
        const mappings_slice = mappings_zigstring.toSlice(arena_allocator);
        defer mappings_slice.deinit();
        const mappings_str = mappings_slice.slice();

        // Extract sources array from payload
        const sources_value = try payload_arg.getIfPropertyExists(globalObject, "sources") orelse {
            return globalObject.throw("payload must have a 'sources' property", .{});
        };
        
        if (!sources_value.jsType().isArray()) {
            return globalObject.throw("sources must be an array", .{});
        }
        
        const sources_length = try sources_value.getLength(globalObject);
        
        // Convert sources array to ZigString.Slice objects
        const sources_slices = try bun.default_allocator.alloc(JSC.ZigString.Slice, sources_length);
        const sources_ptrs = try bun.default_allocator.alloc([]const u8, sources_length);
        
        for (0..sources_length) |i| {
            const source_val = try sources_value.getIndex(globalObject, @intCast(i));
            if (!source_val.isString()) {
                return globalObject.throw("all sources must be strings", .{});
            }
            const source_zigstring = try source_val.getZigString(globalObject);
            sources_slices[i] = source_zigstring.toSlice(bun.default_allocator);
            sources_ptrs[i] = sources_slices[i].slice();
        }

        // Parse the VLQ mappings
        const parse_result = bun.sourcemap.Mapping.parse(
            bun.default_allocator,
            mappings_str,
            null, // estimated_mapping_count
            @intCast(sources_ptrs.len), // sources_count
            100, // input_line_count (estimate)
        );

        const mapping_list = switch (parse_result) {
            .success => |parsed| parsed.mappings,
            .fail => |fail| {
                // Clean up sources on error
                for (sources_slices) |slice| slice.deinit();
                bun.default_allocator.free(sources_slices);
                bun.default_allocator.free(sources_ptrs);
                return globalObject.throw("failed to parse sourcemap mappings: {s}", .{fail.msg});
            },
        };

        const empty_strings: []string = &.{};
        const source_map = bun.new(JSSourceMap, .{
            .sourcemap = .{
                .sources = sources_ptrs,
                .sources_content = empty_strings,
                .mapping = mapping_list,
                .allocator = bun.default_allocator,
            },
            .payload = payload_arg,
            .line_lengths = line_lengths,
            .sources = sources_slices,
        });

        return source_map;
    }

    pub fn getPayload(this: *JSSourceMap, globalObject: *JSGlobalObject) JSValue {
        _ = globalObject;
        return this.payload;
    }

    pub fn getLineLengths(this: *JSSourceMap, globalObject: *JSGlobalObject) JSValue {
        _ = globalObject;
        if (this.line_lengths == .zero) {
            return .js_undefined;
        }
        return this.line_lengths;
    }

    pub fn findOrigin(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        if (callFrame.argumentsCount() < 2) {
            return globalObject.throw("findOrigin requires lineNumber and columnNumber arguments", .{});
        }

        const line_number_arg = callFrame.argument(0);
        const column_number_arg = callFrame.argument(1);

        if (!line_number_arg.isNumber()) {
            return globalObject.throw("lineNumber must be a number", .{});
        }
        if (!column_number_arg.isNumber()) {
            return globalObject.throw("columnNumber must be a number", .{});
        }

        const line_number = line_number_arg.toInt32();
        const column_number = column_number_arg.toInt32();

        // Use bun.sourcemap.find to get the mapping
        if (bun.sourcemap.Mapping.find(this.sourcemap.mapping, line_number, column_number)) |mapping| {
            const result = JSC.JSValue.createEmptyObject(globalObject, 4);
            result.put(globalObject, JSC.ZigString.static("line"), JSC.JSValue.jsNumber(mapping.originalLine()));
            result.put(globalObject, JSC.ZigString.static("column"), JSC.JSValue.jsNumber(mapping.originalColumn()));
            
            // Add source filename if available
            if (mapping.sourceIndex() >= 0 and mapping.sourceIndex() < this.sourcemap.sources.len) {
                const source_name = this.sourcemap.sources[@intCast(mapping.sourceIndex())];
                result.put(globalObject, JSC.ZigString.static("source"), JSC.ZigString.init(source_name).toJS(globalObject));
            }
            
            // Note: name is not implemented yet as it would require names array
            result.put(globalObject, JSC.ZigString.static("name"), JSC.JSValue.jsNull());
            
            return result;
        }

        return JSC.JSValue.createEmptyObject(globalObject, 0);
    }

    pub fn findEntry(this: *JSSourceMap, globalObject: *JSGlobalObject, callFrame: *CallFrame) bun.JSError!JSValue {
        if (callFrame.argumentsCount() < 2) {
            return globalObject.throw("findEntry requires lineNumber and columnNumber arguments", .{});
        }

        const line_number_arg = callFrame.argument(0);
        const column_number_arg = callFrame.argument(1);

        if (!line_number_arg.isNumber()) {
            return globalObject.throw("lineNumber must be a number", .{});
        }
        if (!column_number_arg.isNumber()) {
            return globalObject.throw("columnNumber must be a number", .{});
        }

        const line_number = line_number_arg.toInt32();
        const column_number = column_number_arg.toInt32();

        // Use bun.sourcemap.find to get the mapping
        if (bun.sourcemap.Mapping.find(this.sourcemap.mapping, line_number, column_number)) |mapping| {
            const result = JSC.JSValue.createEmptyObject(globalObject, 3);
            result.put(globalObject, JSC.ZigString.static("generatedLine"), JSC.JSValue.jsNumber(mapping.generatedLine()));
            result.put(globalObject, JSC.ZigString.static("generatedColumn"), JSC.JSValue.jsNumber(mapping.generatedColumn()));
            result.put(globalObject, JSC.ZigString.static("originalLine"), JSC.JSValue.jsNumber(mapping.originalLine()));
            result.put(globalObject, JSC.ZigString.static("originalColumn"), JSC.JSValue.jsNumber(mapping.originalColumn()));
            result.put(globalObject, JSC.ZigString.static("source"), JSC.JSValue.jsNumber(mapping.sourceIndex()));
            return result;
        }

        return JSC.JSValue.createEmptyObject(globalObject, 0);
    }

    pub fn deinit(this: *JSSourceMap) void {
        // Clean up ZigString.Slice objects
        for (this.sources) |slice| {
            slice.deinit();
        }
        if (this.sources.len > 0) {
            this.sourcemap.allocator.free(this.sources);
        }
        
        // Clean up sources pointer array
        if (this.sourcemap.sources.len > 0) {
            this.sourcemap.allocator.free(this.sourcemap.sources);
        }
        
        // Clean up mapping list
        this.sourcemap.mapping.deinit(this.sourcemap.allocator);
        
        bun.destroy(this);
    }

    pub fn finalize(this: *JSSourceMap) void {
        this.deinit();
    }
};