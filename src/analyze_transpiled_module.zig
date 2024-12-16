const std = @import("std");
const bun = @import("bun.zig");
const js_ast = bun.JSAst;
const Ast = js_ast.Ast;

// export fn Bun__analyzeTranspiledModule(globalObject: *bun.JSC.JSGlobalObject, moduleKey: *anyopaque, sourceCode: *anyopaque) *bun.JSC.JSModuleRecord {
//     // const record = bun.JSC.JSModuleRecord.create(globalObject, globalObject.vm(), globalObject.moduleRecordStructure(), moduleKey, sourceCode, declaredVariables, lexicalVariables, features);
//     _ = globalObject;
//     _ = moduleKey;
//     _ = sourceCode;
//     @panic("TODO analyzeTranspiledModule");
// }

pub const ModuleInfo = struct {
    /// all strings in wtf-8. index in hashmap = StringID
    strings: bun.StringArrayHashMap(void),
    requested_modules: std.AutoArrayHashMap(StringID, FetchParameters),
    imports: std.ArrayList(ImportInfo),
    exports: std.ArrayList(ExportInfo),
    declared_variables: std.ArrayList(StringID),
    lexical_variables: std.ArrayList(StringID),
    contains_import_meta: bool,

    pub const FetchParameters = union(enum) {
        none,
        javascript,
        webassembly,
        json,
        host_defined: StringID,
    };

    pub const VarKind = enum { declared, lexical };
    pub fn addVar(self: *ModuleInfo, name: []const u8, kind: VarKind) !void {
        const id = try self.str(name);
        try self.addVarStrID(id, kind);
    }
    pub fn addVarStrID(self: *ModuleInfo, id: StringID, kind: VarKind) !void {
        switch (kind) {
            .declared => try self.declared_variables.append(id),
            .lexical => try self.lexical_variables.append(id),
        }
    }

    pub fn init(allocator: std.mem.Allocator) ModuleInfo {
        return .{
            .strings = bun.StringArrayHashMap(void).init(allocator),
            .requested_modules = std.AutoArrayHashMap(StringID, FetchParameters).init(allocator),
            .imports = std.ArrayList(ImportInfo).init(allocator),
            .exports = std.ArrayList(ExportInfo).init(allocator),
            .declared_variables = std.ArrayList(StringID).init(allocator),
            .lexical_variables = std.ArrayList(StringID).init(allocator),
            .contains_import_meta = false,
        };
    }
    pub fn deinit(self: *ModuleInfo) void {
        for (self.strings.keys()) |string| self.strings.allocator.free(string);
        self.strings.deinit();
        self.requested_modules.deinit();
        self.imports.deinit();
        self.exports.deinit();
        self.declared_variables.deinit();
        self.lexical_variables.deinit();
    }
    pub fn str(self: *ModuleInfo, value: []const u8) !StringID {
        const gpres = try self.strings.getOrPut(value);
        if (gpres.found_existing) return @enumFromInt(@as(u32, @intCast(gpres.index)));
        gpres.key_ptr.* = try self.strings.allocator.dupe(u8, value);
        gpres.value_ptr.* = {};
        return @enumFromInt(@as(u32, @intCast(gpres.index)));
    }
    pub fn starDefault(self: *ModuleInfo) !StringID {
        return try self.str("*default*");
    }
    pub fn requestModule(self: *ModuleInfo, import_record_path: []const u8, fetch_parameters: FetchParameters) !void {
        // jsc only records the attributes of the first import with the given import_record_path. so only put if not exists.
        const gpres = try self.requested_modules.getOrPut(try self.str(import_record_path));
        if (!gpres.found_existing) gpres.value_ptr.* = fetch_parameters;
    }

    /// find any exports marked as 'local' that are actually 'indirect' and fix them
    pub fn fixupIndirectExports(self: *ModuleInfo) !void {
        var local_name_to_module_name = std.AutoArrayHashMap(StringID, *ImportInfo).init(self.strings.allocator);
        defer local_name_to_module_name.deinit();
        for (self.imports.items) |*ip| {
            try local_name_to_module_name.put(ip.local_name, ip);
        }

        for (self.exports.items) |*xp| {
            if (xp.* == .local) {
                if (local_name_to_module_name.get(xp.local.local_name)) |ip| {
                    if (ip.kind == .single) {
                        xp.* = .{ .indirect = .{ .export_name = xp.local.export_name, .import_name = ip.import_name, .module_name = ip.module_name } };
                    }
                }
            }
        }
    }

    const JsonStringifyableModuleInfo = struct {
        strings: []const struct {
            comptime {
                if (@sizeOf(@This()) != @sizeOf([]const u8) or @alignOf(@This()) != @alignOf([]const u8)) unreachable;
            }
            value: []const u8,
            pub fn jsonStringify(self: @This(), jw: anytype) !void {
                try jw.write(self.value);
            }
            pub fn jsonParse(alloc: std.mem.Allocator, source: anytype, options: anytype) !@This() {
                const token = try source.nextAllocMax(alloc, .alloc_if_needed, options.max_value_len.?);
                if (token == .string) return .{ .value = token.string };
                if (token != .allocated_string) return error.UnexpectedToken;
                return .{ .value = token.allocated_string };
            }
        },
        requested_modules_keys: []const StringID,
        requested_modules_values: []const FetchParameters,
        imports: []const ImportInfo,
        exports: []const ExportInfo,
        declared_variables: []const StringID,
        lexical_variables: []const StringID,
        contains_import_meta: bool,
    };

    pub fn jsonStringify(self: *ModuleInfo, writer: anytype) !void {
        try std.json.stringify(JsonStringifyableModuleInfo{
            .strings = @ptrCast(self.strings.keys()),
            .requested_modules_keys = self.requested_modules.keys(),
            .requested_modules_values = self.requested_modules.values(),
            .imports = self.imports.items,
            .exports = self.exports.items,
            .declared_variables = self.declared_variables.items,
            .lexical_variables = self.lexical_variables.items,
            .contains_import_meta = self.contains_import_meta,
        }, .{}, writer);
    }
    pub fn jsonParse(allocator: std.mem.Allocator, source: []const u8) !ModuleInfo {
        const parsed = try std.json.parseFromSlice(JsonStringifyableModuleInfo, allocator, source, .{ .allocate = .alloc_always });
        defer parsed.deinit();
        var result = init(allocator);
        for (parsed.value.strings) |string| if (try result.strings.fetchPut(try allocator.dupe(u8, string.value), {}) != null) return error.ParseError;
        for (parsed.value.requested_modules_keys, parsed.value.requested_modules_values) |reqk, reqv| if (try result.requested_modules.fetchPut(reqk, reqv) != null) return error.ParseError;
        try result.imports.appendSlice(parsed.value.imports);
        try result.exports.appendSlice(parsed.value.exports);
        try result.declared_variables.appendSlice(parsed.value.declared_variables);
        try result.lexical_variables.appendSlice(parsed.value.lexical_variables);
        result.contains_import_meta = parsed.value.contains_import_meta;
        return result;
    }
};
pub const StringID = enum(u32) {
    _,
    pub fn jsonStringify(self: @This(), jw: anytype) !void {
        try jw.write(@intFromEnum(self));
    }
    pub fn jsonParse(alloc: std.mem.Allocator, source: anytype, options: anytype) !@This() {
        const token = try source.nextAllocMax(alloc, .alloc_if_needed, options.max_value_len.?);
        defer switch (token) {
            .allocated_number, .allocated_string => |slice| {
                alloc.free(slice);
            },
            else => {},
        };
        const slice = switch (token) {
            inline .number, .allocated_number, .string, .allocated_string => |slice| slice,
            else => return error.UnexpectedToken,
        };
        return @enumFromInt(try std.fmt.parseInt(u32, slice, 10));
    }
};

const ImportInfo = struct {
    kind: enum { single, namespace },
    /// eg "./a.ts" or "./q". must be in requested_modules.
    module_name: StringID,
    /// eg "a". if kind is namespace, this should be "*".
    import_name: StringID,
    /// the name of the local variable this will be bound to
    local_name: StringID,
};

const ExportInfo = union(enum) {
    indirect: struct {
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
    },
    local: struct {
        export_name: StringID,
        local_name: StringID,
    },

    /// not sure. `import * as mod; export {mod}` didn't do it. but it seems right?
    namespace: struct {
        export_name: StringID,
        module_name: StringID,
    },
    star: struct {
        module_name: StringID,
    },
};

export fn zig__renderDiff(expected_ptr: [*:0]const u8, expected_len: usize, received_ptr: [*:0]const u8, received_len: usize, globalThis: *bun.JSC.JSGlobalObject) void {
    const DiffFormatter = @import("bun.js/test/diff_format.zig").DiffFormatter;
    const formatter = DiffFormatter{
        .received_string = received_ptr[0..received_len],
        .expected_string = expected_ptr[0..expected_len],
        .globalThis = globalThis,
    };
    const stderr = std.io.getStdErr().writer();
    stderr.print("DIFF:\n{}\n", .{formatter}) catch {};
}

fn fail(result: *c_int, code: c_int) ?*JSModuleRecord {
    result.* = code;
    return null;
}
export fn zig__ModuleInfo__parseFromSourceCode(
    globalObject: *bun.JSC.JSGlobalObject,
    vm: *bun.JSC.VM,
    module_key: *const IdentifierArray,
    source_code: *const SourceCode,
    declared_variables: *VariableEnvironment,
    lexical_variables: *VariableEnvironment,
    source_ptr: [*]const u8,
    source_len: usize,
    failure_reason: *c_int,
) ?*JSModuleRecord {
    const source = source_ptr[0..source_len];
    const l3 = std.mem.lastIndexOfScalar(u8, source, '\n') orelse return fail(failure_reason, 1);
    const l2 = std.mem.lastIndexOfScalar(u8, source[0..l3], '\n') orelse return fail(failure_reason, 1);
    const l1 = std.mem.lastIndexOfScalar(u8, source[0..l2], '\n') orelse return fail(failure_reason, 1);
    const l0 = std.mem.lastIndexOfScalar(u8, source[0..l1], '\n') orelse return fail(failure_reason, 1);

    if (l3 + 1 != source.len) return fail(failure_reason, 1);

    if (!std.mem.eql(u8, source[l0..l1], "\n// <jsc-module-info>")) return fail(failure_reason, 1);
    if (!std.mem.startsWith(u8, source[l1..l2], "\n// ")) return fail(failure_reason, 1);
    if (!std.mem.eql(u8, source[l2..l3], "\n// </jsc-module-info>")) return fail(failure_reason, 1);
    const json_part = source[l1 + "\n// ".len .. l2];
    var res = ModuleInfo.jsonParse(std.heap.c_allocator, json_part) catch return fail(failure_reason, 2);
    defer res.deinit();

    var identifiers = IdentifierArray.create(res.strings.keys().len);
    defer identifiers.destroy();
    for (res.strings.keys(), 0..) |key, i| {
        if (bun.strings.eqlComptime(key, "*default*")) {
            identifiers.setFromStarDefault(i, vm);
        } else {
            identifiers.setFromUtf8(i, vm, key);
        }
    }

    for (res.declared_variables.items) |id| declared_variables.add(identifiers, id);
    for (res.lexical_variables.items) |id| lexical_variables.add(identifiers, id);

    const module_record = JSModuleRecord.create(globalObject, vm, module_key, source_code, declared_variables, lexical_variables, res.contains_import_meta);

    for (res.requested_modules.keys(), res.requested_modules.values()) |reqk, reqv| {
        switch (reqv) {
            .none => module_record.addRequestedModuleNullAttributesPtr(identifiers, reqk),
            .javascript => module_record.addRequestedModuleJavaScript(identifiers, reqk),
            .webassembly => module_record.addRequestedModuleWebAssembly(identifiers, reqk),
            .json => module_record.addRequestedModuleJSON(identifiers, reqk),
            .host_defined => |v| {
                const tmp_str = std.heap.c_allocator.dupeZ(u8, res.strings.keys()[@intFromEnum(v)]) catch return fail(failure_reason, 2);
                defer std.heap.c_allocator.free(tmp_str);
                if (std.mem.indexOfScalar(u8, tmp_str, 0) != null) return fail(failure_reason, 2);
                if (!bun.strings.isAllASCII(tmp_str)) return fail(failure_reason, 2);
                module_record.addRequestedModuleHostDefined(identifiers, reqk, tmp_str.ptr);
            },
        }
    }
    for (res.imports.items) |import_info| switch (import_info.kind) {
        .single => module_record.addImportEntrySingle(identifiers, import_info.import_name, import_info.local_name, import_info.module_name),
        .namespace => module_record.addImportEntryNamespace(identifiers, import_info.import_name, import_info.local_name, import_info.module_name),
    };
    for (res.exports.items) |export_info| switch (export_info) {
        .indirect => module_record.addIndirectExport(identifiers, export_info.indirect.export_name, export_info.indirect.import_name, export_info.indirect.module_name),
        .local => module_record.addLocalExport(identifiers, export_info.local.export_name, export_info.local.local_name),
        .namespace => module_record.addNamespaceExport(identifiers, export_info.namespace.export_name, export_info.namespace.module_name),
        .star => module_record.addStarExport(identifiers, export_info.star.module_name),
    };

    return module_record;
}
export fn zig__ModuleInfo__destroy(info: *ModuleInfo) void {
    info.deinit();
    std.heap.c_allocator.destroy(info);
}

const VariableEnvironment = opaque {
    extern fn JSC__VariableEnvironment__add(environment: *VariableEnvironment, identifier_array: *IdentifierArray, identifier_index: StringID) void;
    pub const add = JSC__VariableEnvironment__add;
};
const IdentifierArray = opaque {
    extern fn JSC__IdentifierArray__create(len: usize) *IdentifierArray;
    pub const create = JSC__IdentifierArray__create;

    extern fn JSC__IdentifierArray__destroy(identifier_array: *IdentifierArray) void;
    pub const destroy = JSC__IdentifierArray__destroy;

    extern fn JSC__IdentifierArray__setFromUtf8(identifier_array: *IdentifierArray, n: usize, vm: *bun.JSC.VM, str: [*]const u8, len: usize) void;
    pub fn setFromUtf8(self: *IdentifierArray, n: usize, vm: *bun.JSC.VM, str: []const u8) void {
        JSC__IdentifierArray__setFromUtf8(self, n, vm, str.ptr, str.len);
    }

    extern fn JSC__IdentifierArray__setFromStarDefault(identifier_array: *IdentifierArray, n: usize, vm: *bun.JSC.VM) void;
    pub const setFromStarDefault = JSC__IdentifierArray__setFromStarDefault;
};
const SourceCode = opaque {};
const JSModuleRecord = opaque {
    extern fn JSC_JSModuleRecord__create(global_object: *bun.JSC.JSGlobalObject, vm: *bun.JSC.VM, module_key: *const IdentifierArray, source_code: *const SourceCode, declared_variables: *VariableEnvironment, lexical_variables: *VariableEnvironment, has_import_meta: bool) *JSModuleRecord;
    pub const create = JSC_JSModuleRecord__create;

    extern fn JSC_JSModuleRecord__declaredVariables(module_record: *JSModuleRecord) *VariableEnvironment;
    pub const declaredVariables = JSC_JSModuleRecord__declaredVariables;
    extern fn JSC_JSModuleRecord__lexicalVariables(module_record: *JSModuleRecord) *VariableEnvironment;
    pub const lexicalVariables = JSC_JSModuleRecord__lexicalVariables;

    extern fn JSC_JSModuleRecord__addIndirectExport(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, export_name: StringID, import_name: StringID, module_name: StringID) void;
    pub const addIndirectExport = JSC_JSModuleRecord__addIndirectExport;
    extern fn JSC_JSModuleRecord__addLocalExport(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, export_name: StringID, local_name: StringID) void;
    pub const addLocalExport = JSC_JSModuleRecord__addLocalExport;
    extern fn JSC_JSModuleRecord__addNamespaceExport(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, export_name: StringID, module_name: StringID) void;
    pub const addNamespaceExport = JSC_JSModuleRecord__addNamespaceExport;
    extern fn JSC_JSModuleRecord__addStarExport(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID) void;
    pub const addStarExport = JSC_JSModuleRecord__addStarExport;

    extern fn JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID) void;
    pub const addRequestedModuleNullAttributesPtr = JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr;
    extern fn JSC_JSModuleRecord__addRequestedModuleJavaScript(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID) void;
    pub const addRequestedModuleJavaScript = JSC_JSModuleRecord__addRequestedModuleJavaScript;
    extern fn JSC_JSModuleRecord__addRequestedModuleWebAssembly(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID) void;
    pub const addRequestedModuleWebAssembly = JSC_JSModuleRecord__addRequestedModuleWebAssembly;
    extern fn JSC_JSModuleRecord__addRequestedModuleJSON(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID) void;
    pub const addRequestedModuleJSON = JSC_JSModuleRecord__addRequestedModuleJSON;
    extern fn JSC_JSModuleRecord__addRequestedModuleHostDefined(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID, host_defined_import_type: [*:0]const u8) void;
    pub const addRequestedModuleHostDefined = JSC_JSModuleRecord__addRequestedModuleHostDefined;

    extern fn JSC_JSModuleRecord__addImportEntrySingle(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntrySingle = JSC_JSModuleRecord__addImportEntrySingle;
    extern fn JSC_JSModuleRecord__addImportEntryNamespace(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntryNamespace = JSC_JSModuleRecord__addImportEntryNamespace;
};
