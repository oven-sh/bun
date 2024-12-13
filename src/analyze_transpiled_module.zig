const std = @import("std");
const bun = @import("bun.zig");
const js_ast = bun.JSAst;
const Ast = js_ast.Ast;

export fn zig_log_u8(m1: [*:0]const u8, m2_ptr: [*]const u8, m2_len: usize) void {
    std.log.err("{s}{s}", .{ std.mem.span(m1), m2_ptr[0..m2_len] });
}
export fn zig_log_cstr(m1: [*:0]const u8, m2: [*:0]const u8) void {
    std.log.err("{s}{s}", .{ std.mem.span(m1), std.mem.span(m2) });
}
export fn zig_log_ushort(m1: [*:0]const u8, value: c_ushort) void {
    std.log.err("{s}{d}", .{ std.mem.span(m1), value });
}

// export fn Bun__analyzeTranspiledModule(globalObject: *bun.JSC.JSGlobalObject, moduleKey: *anyopaque, sourceCode: *anyopaque) *bun.JSC.JSModuleRecord {
//     // const record = bun.JSC.JSModuleRecord.create(globalObject, globalObject.vm(), globalObject.moduleRecordStructure(), moduleKey, sourceCode, declaredVariables, lexicalVariables, features);
//     _ = globalObject;
//     _ = moduleKey;
//     _ = sourceCode;
//     @panic("TODO analyzeTranspiledModule");
// }

const ModuleInfo = struct {
    /// all strings in wtf-8. index in hashmap = StringID
    strings: bun.StringArrayHashMap(void),
    requested_modules: std.AutoArrayHashMap(StringID, void),
    imports: std.ArrayList(ImportInfo),
    exports: std.ArrayList(ExportInfo),
    declared_variables: std.ArrayList(StringID),
    lexical_variables: std.ArrayList(StringID),
    uses_import_meta: bool,

    pub fn init(allocator: std.mem.Allocator) ModuleInfo {
        return .{
            .strings = bun.StringArrayHashMap(void).init(allocator),
            .requested_modules = std.AutoArrayHashMap(StringID, void).init(allocator),
            .imports = std.ArrayList(ImportInfo).init(allocator),
            .exports = std.ArrayList(ExportInfo).init(allocator),
            .declared_variables = std.ArrayList(StringID).init(allocator),
            .lexical_variables = std.ArrayList(StringID).init(allocator),
            .uses_import_meta = false,
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
        requested_modules: []const StringID,
        imports: []const ImportInfo,
        exports: []const ExportInfo,
        declared_variables: []const StringID,
        lexical_variables: []const StringID,
        uses_import_meta: bool,
    };

    pub fn jsonStringify(self: *ModuleInfo, writer: anytype) !void {
        try std.json.stringify(JsonStringifyableModuleInfo{
            .strings = @ptrCast(self.strings.keys()),
            .requested_modules = self.requested_modules.keys(),
            .imports = self.imports.items,
            .exports = self.exports.items,
            .declared_variables = self.declared_variables.items,
            .lexical_variables = self.lexical_variables.items,
            .uses_import_meta = self.uses_import_meta,
        }, .{}, writer);
    }
    pub fn jsonParse(allocator: std.mem.Allocator, source: []const u8) !ModuleInfo {
        const parsed = try std.json.parseFromSlice(JsonStringifyableModuleInfo, allocator, source, .{ .allocate = .alloc_always });
        defer parsed.deinit();
        var result = init(allocator);
        for (parsed.value.strings) |string| if (try result.strings.fetchPut(try allocator.dupe(u8, string.value), {}) != null) return error.ParseError;
        for (parsed.value.requested_modules) |reqm| if (try result.requested_modules.fetchPut(reqm, {}) != null) return error.ParseError;
        try result.imports.appendSlice(parsed.value.imports);
        try result.exports.appendSlice(parsed.value.exports);
        try result.declared_variables.appendSlice(parsed.value.declared_variables);
        try result.lexical_variables.appendSlice(parsed.value.lexical_variables);
        result.uses_import_meta = parsed.value.uses_import_meta;
        return result;
    }
};
const StringID = enum(u32) {
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

pub fn analyzeTranspiledModule(p: anytype, tree: Ast, allocator: std.mem.Allocator, contains_import_meta: bool) !ModuleInfo {
    var res: ModuleInfo = ModuleInfo.init(allocator);
    errdefer res.deinit();

    // DeclaredVariables is important and used in JSModuleRecord::instantiateDeclarations
    // so we need to make sure to add `function a()` in DeclaredVariables and also `var a`

    std.log.err("\n\n\n\n\n\n       \x1b[95mPrinting AST:\x1b(B\x1b[m", .{});
    std.log.err("  Import Records:", .{});
    for (tree.import_records.slice()) |record| {
        try res.requested_modules.put(try res.str(record.path.text), {});
        std.log.err("  - {s}", .{record.path.text});
    }
    std.log.err("  Export Records:", .{});
    const writer = std.io.getStdErr().writer();
    for (tree.parts.slice()) |part| {
        for (part.stmts) |stmt| {
            try stmt.print(writer.any());
            try writer.print(",\n", .{});
            switch (stmt.data) {
                .s_local => |slocal| {
                    for (slocal.decls.slice()) |decl| {
                        switch (decl.binding.data) {
                            .b_identifier => |v| {
                                const name = p.renamer.nameForSymbol(v.ref);
                                switch (slocal.kind) {
                                    .k_var => try res.declared_variables.append(try res.str(name)),
                                    else => try res.lexical_variables.append(try res.str(name)),
                                }
                                if (slocal.is_export) {
                                    try res.exports.append(.{ .local = .{ .export_name = try res.str(name), .local_name = try res.str(name) } });
                                }
                            },
                            else => {
                                @panic("TODO support exported non-identifier binding");
                            },
                        }
                    }
                },
                else => {},
            }
        }
    }
    std.log.err("  Uses import.meta: {}", .{contains_import_meta});
    // - varDeclarations:
    //
    // - lexicalVariables:
    //

    // if(comptime true) {
    //     tree
    // }

    return res;
}

export fn zig__ModuleInfo__parseFromSourceCode(vm: *bun.JSC.VM, module_record: *JSModuleRecord, source_ptr: [*]const u8, source_len: usize) bool {
    const stderr = std.io.getStdErr().writer();
    const declared_variables = JSModuleRecord.declaredVariables(module_record);
    const lexical_variables = JSModuleRecord.lexicalVariables(module_record);

    const source = source_ptr[0..source_len];
    const l3 = std.mem.lastIndexOfScalar(u8, source, '\n') orelse return false;
    const l2 = std.mem.lastIndexOfScalar(u8, source[0..l3], '\n') orelse return false;
    const l1 = std.mem.lastIndexOfScalar(u8, source[0..l2], '\n') orelse return false;
    const l0 = std.mem.lastIndexOfScalar(u8, source[0..l1], '\n') orelse return false;

    if (l3 + 1 != source.len) return false;

    if (!std.mem.eql(u8, source[l0..l1], "\n// <jsc-module-info>")) return false;
    if (!std.mem.startsWith(u8, source[l1..l2], "\n// ")) return false;
    if (!std.mem.eql(u8, source[l2..l3], "\n// </jsc-module-info>")) return false;
    const json_part = source[l1 + "\n// ".len .. l2];
    var res = ModuleInfo.jsonParse(std.heap.c_allocator, json_part) catch return false;
    defer res.deinit();

    res.jsonStringify(stderr) catch {};

    var identifiers = IdentifierArray.create(res.strings.keys().len);
    defer identifiers.destroy();
    for (res.strings.keys(), 0..) |key, i| identifiers.setFromUtf8(i, vm, key);

    for (res.declared_variables.items) |id| declared_variables.add(identifiers, id);
    for (res.lexical_variables.items) |id| lexical_variables.add(identifiers, id);

    for (res.requested_modules.keys()) |_| @panic("TODO requested_modules");
    for (res.imports.items) |_| @panic("TODO imports");
    for (res.exports.items) |export_info| switch (export_info) {
        .indirect => module_record.addIndirectExport(identifiers, export_info.indirect.export_name, export_info.indirect.import_name, export_info.indirect.module_name),
        .local => module_record.addLocalExport(identifiers, export_info.local.export_name, export_info.local.local_name),
        .namespace => module_record.addNamespaceExport(identifiers, export_info.namespace.export_name, export_info.namespace.module_name),
        .star => module_record.addStarExport(identifiers, export_info.star.module_name),
    };

    return true;
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
};
const JSModuleRecord = opaque {
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
};
