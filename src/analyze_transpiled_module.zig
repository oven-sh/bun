const std = @import("std");
const bun = @import("bun.zig");
const js_ast = bun.JSAst;
const Ast = js_ast.Ast;

pub const RecordKind = enum(u8) {
    /// var_name
    declared_variable,
    /// let_name
    lexical_variable,
    /// module_name, import_name, local_name
    import_info_single,
    /// module_name, import_name = '*', local_name
    import_info_namespace,
    /// export_name, import_name, module_name
    export_info_indirect,
    /// export_name, local_name, padding (for local => indirect conversion)
    export_info_local,
    /// export_name, module_name
    export_info_namespace,
    /// module_name
    export_info_star,
    _,

    pub fn len(record: RecordKind) !usize {
        return switch (record) {
            .declared_variable, .lexical_variable => 1,
            .import_info_single => 3,
            .import_info_namespace => 3,
            .export_info_indirect => 3,
            .export_info_local => 3,
            .export_info_namespace => 2,
            .export_info_star => 1,
            else => return error.InvalidRecordKind,
        };
    }
};

pub const ModuleInfoDeserialized = struct {
    strings_buf: []const u8,
    strings_lens: []align(1) const u32,
    requested_modules_keys: []align(1) const StringID,
    requested_modules_values: []align(1) const ModuleInfo.FetchParameters,
    buffer: []align(1) const StringID,
    record_kinds: []align(1) const RecordKind,
    contains_import_meta: bool,
    owner: union(enum) {
        module_info,
        allocated_slice: struct {
            slice: []const u8,
            allocator: std.mem.Allocator,
        },
    },
    dead: bool = false,

    pub fn deinit(self: *ModuleInfoDeserialized) void {
        switch (self.owner) {
            .module_info => {
                const mi: *ModuleInfo = @fieldParentPtr("_deserialized", self);
                mi.destroy();
            },
            .allocated_slice => |as| {
                as.allocator.free(as.slice);
                as.allocator.destroy(self);
            },
        }
    }

    inline fn eat(rem: *[]const u8, len: usize) ![]const u8 {
        if (rem.*.len < len) return error.BadModuleInfo;
        const res = rem.*[0..len];
        rem.* = rem.*[len..];
        return res;
    }
    inline fn eatC(rem: *[]const u8, comptime len: usize) !*const [len]u8 {
        if (rem.*.len < len) return error.BadModuleInfo;
        const res = rem.*[0..len];
        rem.* = rem.*[len..];
        return res;
    }
    pub fn create(source: []const u8, gpa: std.mem.Allocator) !*ModuleInfoDeserialized {
        std.log.info("ModuleInfoDeserialized.create", .{});
        var rem = try gpa.dupe(u8, source);
        errdefer gpa.free(rem);
        var res = try gpa.create(ModuleInfoDeserialized);
        errdefer res.deinit();

        const record_kinds_len = std.mem.readInt(u32, try eatC(&rem, 4), .little);
        const record_kinds = std.mem.bytesAsSlice(RecordKind, try eat(&rem, record_kinds_len * @sizeOf(RecordKind)));
        const buffer_len = std.mem.readInt(u32, try eatC(&rem, 4), .little);
        const buffer = std.mem.bytesAsSlice(StringID, try eat(&rem, buffer_len * @sizeOf(StringID)));
        const requested_modules_len = std.mem.readInt(u32, try eatC(&rem, 4), .little);
        const requested_modules_keys = std.mem.bytesAsSlice(StringID, try eat(&rem, requested_modules_len * @sizeOf(StringID)));
        const requested_modules_values = std.mem.bytesAsSlice(ModuleInfo.FetchParameters, try eat(&rem, requested_modules_len * @sizeOf(ModuleInfo.FetchParameters)));
        const contains_import_meta = (try eatC(&rem, 1))[0] != 0;
        const strings_len = std.mem.readInt(u32, try eatC(&rem, 4), .little);
        const strings_lens = std.mem.bytesAsSlice(u32, try eat(&rem, strings_len * @sizeOf(u32)));
        const strings_buf = rem;

        res.* = .{
            .strings_buf = strings_buf,
            .strings_lens = strings_lens,
            .requested_modules_keys = requested_modules_keys,
            .requested_modules_values = requested_modules_values,
            .buffer = buffer,
            .record_kinds = record_kinds,
            .contains_import_meta = contains_import_meta,
            .owner = .{ .allocated_slice = .{
                .slice = source,
                .allocator = gpa,
            } },
        };
        return res;
    }
    pub fn serialize(self: *const ModuleInfoDeserialized, writer: anytype) !void {
        try writer.writeInt(u32, @truncate(self.record_kinds.len), .little);
        try writer.writeAll(std.mem.sliceAsBytes(self.record_kinds));
        try writer.writeInt(u32, @truncate(self.buffer.len), .little);
        try writer.writeAll(std.mem.sliceAsBytes(self.buffer));

        try writer.writeInt(u32, @truncate(self.requested_modules_keys.len), .little);
        try writer.writeAll(std.mem.sliceAsBytes(self.requested_modules_keys));
        try writer.writeAll(std.mem.sliceAsBytes(self.requested_modules_values));

        try writer.writeInt(u8, @intFromBool(self.contains_import_meta), .little);

        try writer.writeInt(u32, @truncate(self.strings_lens.len), .little);
        try writer.writeAll(std.mem.sliceAsBytes(self.strings_lens));
        try writer.writeAll(self.strings_buf);
    }
};

const StringMapKey = enum(u32) {
    get_or_put = std.math.maxInt(u32),
    _,
};
pub const StringContext = struct {
    get_or_put_key: []const u8,
    strings_buf: []const u8,
    strings_lens: []const u32,

    pub fn hash(self: @This(), s: StringMapKey) u32 {
        bun.assert(s == .get_or_put);
        return @as(u32, @truncate(std.hash.Wyhash.hash(0, self.get_or_put_key)));
    }
    pub fn eql(self: @This(), fetch_key: StringMapKey, item_key: StringMapKey, item_i: usize) bool {
        bun.assert(item_key != .get_or_put);
        bun.assert(fetch_key == .get_or_put);
        return bun.strings.eqlLong(self.get_or_put_key, self.strings_buf[@intFromEnum(item_key)..][0..self.strings_lens[item_i]], true);
    }
};

pub const ModuleInfo = struct {
    /// all strings in wtf-8. index in hashmap = StringID
    gpa: std.mem.Allocator,
    strings_map: std.ArrayHashMapUnmanaged(StringMapKey, void, StringContext, true),
    strings_buf: std.ArrayListUnmanaged(u8),
    strings_lens: std.ArrayListUnmanaged(u32),
    requested_modules: std.AutoArrayHashMap(StringID, FetchParameters),
    buffer: std.ArrayList(StringID),
    record_kinds: std.ArrayList(RecordKind),
    exported_names: std.AutoArrayHashMapUnmanaged(StringID, void),
    contains_import_meta: bool,
    finalized: bool = false,

    _deserialized: ModuleInfoDeserialized = undefined,

    pub fn asDeserialized(self: *ModuleInfo) *ModuleInfoDeserialized {
        bun.assert(self.finalized);
        return &self._deserialized;
    }

    pub const FetchParameters = enum(u32) {
        none = std.math.maxInt(u32),
        javascript = std.math.maxInt(u32) - 1,
        webassembly = std.math.maxInt(u32) - 2,
        json = std.math.maxInt(u32) - 3,
        _, // host_defined: cast to StringID
        pub fn hostDefined(value: StringID) FetchParameters {
            return @enumFromInt(@intFromEnum(value));
        }
    };

    pub const VarKind = enum { declared, lexical };
    pub fn addVar(self: *ModuleInfo, name: []const u8, kind: VarKind) !void {
        switch (kind) {
            .declared => try self.addDeclaredVariable(name),
            .lexical => try self.addLexicalVariable(name),
        }
    }

    fn _addRecord(self: *ModuleInfo, kind: RecordKind, data: []const StringID) !void {
        bun.assert(!self.finalized);
        bun.assert(data.len == kind.len() catch unreachable);
        try self.record_kinds.append(kind);
        try self.buffer.appendSlice(data);
    }
    pub fn addDeclaredVariable(self: *ModuleInfo, id: []const u8) !void {
        try self._addRecord(.declared_variable, &.{try self.str(id)});
    }
    pub fn addLexicalVariable(self: *ModuleInfo, id: []const u8) !void {
        try self._addRecord(.lexical_variable, &.{try self.str(id)});
    }
    pub fn addImportInfoSingle(self: *ModuleInfo, module_name: []const u8, import_name: []const u8, local_name: []const u8) !void {
        try self._addRecord(.import_info_single, &.{ try self.str(module_name), try self.str(import_name), try self.str(local_name) });
    }
    pub fn addImportInfoNamespace(self: *ModuleInfo, module_name: []const u8, local_name: []const u8) !void {
        try self._addRecord(.import_info_namespace, &.{ try self.str(module_name), try self.str("*"), try self.str(local_name) });
    }
    pub fn addExportInfoIndirect(self: *ModuleInfo, export_name: []const u8, import_name: []const u8, module_name: []const u8) !void {
        const export_name_id = try self.str(export_name);
        if (try self._hasOrAddExportedName(export_name_id)) return; // a syntax error will be emitted later in this case
        try self._addRecord(.export_info_indirect, &.{ export_name_id, try self.str(import_name), try self.str(module_name) });
    }
    pub fn addExportInfoLocal(self: *ModuleInfo, export_name: []const u8, local_name: []const u8) !void {
        const export_name_id = try self.str(export_name);
        if (try self._hasOrAddExportedName(export_name_id)) return; // a syntax error will be emitted later in this case
        try self._addRecord(.export_info_local, &.{ export_name_id, try self.str(local_name), @enumFromInt(std.math.maxInt(u32)) });
    }
    pub fn addExportInfoNamespace(self: *ModuleInfo, export_name: []const u8, module_name: []const u8) !void {
        const export_name_id = try self.str(export_name);
        if (try self._hasOrAddExportedName(export_name_id)) return; // a syntax error will be emitted later in this case
        try self._addRecord(.export_info_namespace, &.{ export_name_id, try self.str(module_name) });
    }
    pub fn addExportInfoStar(self: *ModuleInfo, module_name: []const u8) !void {
        try self._addRecord(.export_info_star, &.{try self.str(module_name)});
    }

    pub fn _hasOrAddExportedName(self: *ModuleInfo, name: StringID) !bool {
        if (try self.exported_names.fetchPut(self.gpa, name, {}) != null) return true;
        return false;
    }

    pub fn create(gpa: std.mem.Allocator) !*ModuleInfo {
        const res = try gpa.create(ModuleInfo);
        res.* = ModuleInfo.init(gpa);
        return res;
    }
    fn init(allocator: std.mem.Allocator) ModuleInfo {
        return .{
            .gpa = allocator,
            .strings_map = .{},
            .strings_buf = .{},
            .strings_lens = .{},
            .exported_names = .{},
            .requested_modules = std.AutoArrayHashMap(StringID, FetchParameters).init(allocator),
            .buffer = std.ArrayList(StringID).init(allocator),
            .record_kinds = std.ArrayList(RecordKind).init(allocator),
            .contains_import_meta = false,
        };
    }
    fn deinit(self: *ModuleInfo) void {
        self.strings_map.deinit(self.gpa);
        self.strings_buf.deinit(self.gpa);
        self.strings_lens.deinit(self.gpa);
        self.exported_names.deinit(self.gpa);
        self.requested_modules.deinit();
        self.buffer.deinit();
        self.record_kinds.deinit();
    }
    pub fn destroy(self: *ModuleInfo) void {
        const alloc = self.gpa;
        self.deinit();
        alloc.destroy(self);
    }
    pub fn str(self: *ModuleInfo, value: []const u8) !StringID {
        const gpres = try self.strings_map.getOrPutContext(self.gpa, .get_or_put, .{
            .get_or_put_key = value,
            .strings_buf = self.strings_buf.items,
            .strings_lens = self.strings_lens.items,
        });
        if (gpres.found_existing) return @enumFromInt(@as(u32, @intCast(gpres.index)));

        gpres.key_ptr.* = @enumFromInt(@as(u32, @truncate(self.strings_buf.items.len)));
        gpres.value_ptr.* = {};
        try self.strings_buf.ensureUnusedCapacity(self.gpa, value.len);
        try self.strings_lens.ensureUnusedCapacity(self.gpa, 1);
        self.strings_buf.appendSliceAssumeCapacity(value);
        self.strings_lens.appendAssumeCapacity(@as(u32, @truncate(value.len)));
        return @enumFromInt(@as(u32, @intCast(gpres.index)));
    }
    pub const star_default = "*default*";
    pub fn requestModule(self: *ModuleInfo, import_record_path: []const u8, fetch_parameters: FetchParameters) !void {
        // jsc only records the attributes of the first import with the given import_record_path. so only put if not exists.
        const gpres = try self.requested_modules.getOrPut(try self.str(import_record_path));
        if (!gpres.found_existing) gpres.value_ptr.* = fetch_parameters;
    }

    /// find any exports marked as 'local' that are actually 'indirect' and fix them
    pub fn finalize(self: *ModuleInfo) !void {
        bun.assert(!self.finalized);
        var local_name_to_module_name = std.AutoArrayHashMap(StringID, struct { module_name: StringID, import_name: StringID }).init(bun.default_allocator);
        defer local_name_to_module_name.deinit();
        {
            var i: usize = 0;
            for (self.record_kinds.items) |k| {
                if (k == .import_info_single) {
                    try local_name_to_module_name.put(self.buffer.items[i + 2], .{ .module_name = self.buffer.items[i], .import_name = self.buffer.items[i + 1] });
                }
                i += k.len() catch unreachable;
            }
        }

        {
            var i: usize = 0;
            for (self.record_kinds.items) |*k| {
                if (k.* == .export_info_local) {
                    if (local_name_to_module_name.get(self.buffer.items[i + 1])) |ip| {
                        k.* = .export_info_indirect;
                        self.buffer.items[i + 1] = ip.import_name;
                        self.buffer.items[i + 2] = ip.module_name;
                    }
                }
                i += k.len() catch unreachable;
            }
        }

        self._deserialized = .{
            .strings_buf = self.strings_buf.items,
            .strings_lens = self.strings_lens.items,
            .requested_modules_keys = self.requested_modules.keys(),
            .requested_modules_values = self.requested_modules.values(),
            .buffer = self.buffer.items,
            .record_kinds = self.record_kinds.items,
            .contains_import_meta = self.contains_import_meta,
            .owner = .module_info,
        };

        self.finalized = true;
    }
};
pub const StringID = enum(u32) {
    _,
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

export fn zig__ModuleInfoDeserialized__toJSModuleRecord(
    globalObject: *bun.JSC.JSGlobalObject,
    vm: *bun.JSC.VM,
    module_key: *const IdentifierArray,
    source_code: *const SourceCode,
    declared_variables: *VariableEnvironment,
    lexical_variables: *VariableEnvironment,
    res: *ModuleInfoDeserialized,
) ?*JSModuleRecord {
    if (res.dead) @panic("ModuleInfoDeserialized already deinit()ed");
    defer res.deinit();

    var identifiers = IdentifierArray.create(res.strings_lens.len);
    defer identifiers.destroy();
    var offset: usize = 0;
    for (0.., res.strings_lens) |index, len| {
        if (res.strings_buf.len < offset + len) return null; // error!
        const sub = res.strings_buf[offset..][0..len];
        if (bun.strings.eqlComptime(sub, ModuleInfo.star_default)) {
            identifiers.setFromStarDefault(index, vm);
        } else {
            identifiers.setFromUtf8(index, vm, sub);
        }
        offset += len;
    }

    {
        var i: usize = 0;
        for (res.record_kinds) |k| {
            if (i + (k.len() catch 0) > res.buffer.len) return null;
            switch (k) {
                .declared_variable => declared_variables.add(identifiers, res.buffer[i]),
                .lexical_variable => lexical_variables.add(identifiers, res.buffer[i]),
                .import_info_single, .import_info_namespace, .export_info_indirect, .export_info_local, .export_info_namespace, .export_info_star => {},
                else => return null,
            }
            i += k.len() catch unreachable; // handled above
        }
    }

    const module_record = JSModuleRecord.create(globalObject, vm, module_key, source_code, declared_variables, lexical_variables, res.contains_import_meta);

    for (res.requested_modules_keys, res.requested_modules_values) |reqk, reqv| {
        switch (reqv) {
            .none => module_record.addRequestedModuleNullAttributesPtr(identifiers, reqk),
            .javascript => module_record.addRequestedModuleJavaScript(identifiers, reqk),
            .webassembly => module_record.addRequestedModuleWebAssembly(identifiers, reqk),
            .json => module_record.addRequestedModuleJSON(identifiers, reqk),
            else => |uv| module_record.addRequestedModuleHostDefined(identifiers, reqk, @enumFromInt(@intFromEnum(uv))),
        }
    }

    {
        var i: usize = 0;
        for (res.record_kinds) |k| {
            if (i + (k.len() catch unreachable) > res.buffer.len) unreachable; // handled above
            switch (k) {
                .declared_variable, .lexical_variable => {},
                .import_info_single => module_record.addImportEntrySingle(identifiers, res.buffer[i + 1], res.buffer[i + 2], res.buffer[i]),
                .import_info_namespace => module_record.addImportEntryNamespace(identifiers, res.buffer[i + 1], res.buffer[i + 2], res.buffer[i]),
                .export_info_indirect => module_record.addIndirectExport(identifiers, res.buffer[i + 0], res.buffer[i + 1], res.buffer[i + 2]),
                .export_info_local => module_record.addLocalExport(identifiers, res.buffer[i], res.buffer[i + 1]),
                .export_info_namespace => module_record.addNamespaceExport(identifiers, res.buffer[i], res.buffer[i + 1]),
                .export_info_star => module_record.addStarExport(identifiers, res.buffer[i]),
                else => unreachable, // handled above
            }
            i += k.len() catch unreachable; // handled above
        }
    }

    return module_record;
}
export fn zig__ModuleInfo__destroy(info: *ModuleInfo) void {
    info.deinit();
    bun.default_allocator.destroy(info);
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
    extern fn JSC_JSModuleRecord__addRequestedModuleHostDefined(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, module_name: StringID, host_defined_import_type: StringID) void;
    pub const addRequestedModuleHostDefined = JSC_JSModuleRecord__addRequestedModuleHostDefined;

    extern fn JSC_JSModuleRecord__addImportEntrySingle(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntrySingle = JSC_JSModuleRecord__addImportEntrySingle;
    extern fn JSC_JSModuleRecord__addImportEntryNamespace(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntryNamespace = JSC_JSModuleRecord__addImportEntryNamespace;
};
