//! JSC bridge for analyze_transpiled_module.zig — converts the parsed
//! `ModuleInfoDeserialized` into a `JSC::JSModuleRecord`. Aliased back so the
//! `export fn` symbol names are still discoverable from C++.

export fn zig__renderDiff(expected_ptr: [*:0]const u8, expected_len: usize, received_ptr: [*:0]const u8, received_len: usize, globalThis: *bun.jsc.JSGlobalObject) void {
    const formatter = DiffFormatter{
        .received_string = received_ptr[0..received_len],
        .expected_string = expected_ptr[0..expected_len],
        .globalThis = globalThis,
    };
    bun.Output.errorWriter().print("DIFF:\n{any}\n", .{formatter}) catch {};
}

export fn zig__ModuleInfoDeserialized__toJSModuleRecord(
    globalObject: *bun.jsc.JSGlobalObject,
    vm: *bun.jsc.VM,
    module_key: *const IdentifierArray,
    source_code: *const SourceCode,
    declared_variables: *VariableEnvironment,
    lexical_variables: *VariableEnvironment,
    res: *ModuleInfoDeserialized,
) ?*JSModuleRecord {
    // Ownership of `res` stays with the caller; this function only reads it.
    // The caller (BunAnalyzeTranspiledModule.cpp) decides whether to free
    // immediately or keep it alive on the SourceProvider for the isolation
    // SourceProvider cache.

    var identifiers = IdentifierArray.create(res.strings_lens.len);
    defer identifiers.destroy();
    var offset: usize = 0;
    for (0.., res.strings_lens) |index, len| {
        if (res.strings_buf.len < offset + len) return null; // error!
        const sub = res.strings_buf[offset..][0..len];
        identifiers.setFromUtf8(index, vm, sub);
        offset += len;
    }

    {
        var i: usize = 0;
        for (res.record_kinds) |k| {
            if (i + (k.len() catch 0) > res.buffer.len) return null;
            switch (k) {
                .declared_variable => declared_variables.add(vm, identifiers, res.buffer[i]),
                .lexical_variable => lexical_variables.add(vm, identifiers, res.buffer[i]),
                .import_info_single, .import_info_single_type_script, .import_info_namespace, .export_info_indirect, .export_info_local, .export_info_namespace, .export_info_star => {},
                else => return null,
            }
            i += k.len() catch unreachable; // handled above
        }
    }

    const module_record = JSModuleRecord.create(globalObject, vm, module_key, source_code, declared_variables, lexical_variables, res.flags.contains_import_meta, res.flags.is_typescript, res.flags.has_tla);

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
                .import_info_single_type_script => module_record.addImportEntrySingleTypeScript(identifiers, res.buffer[i + 1], res.buffer[i + 2], res.buffer[i]),
                .import_info_namespace => module_record.addImportEntryNamespace(identifiers, res.buffer[i + 1], res.buffer[i + 2], res.buffer[i]),
                .export_info_indirect => if (res.buffer[i + 1] == .star_namespace)
                    module_record.addNamespaceExport(identifiers, res.buffer[i + 0], res.buffer[i + 2])
                else
                    module_record.addIndirectExport(identifiers, res.buffer[i + 0], res.buffer[i + 1], res.buffer[i + 2]),
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

const VariableEnvironment = opaque {
    extern fn JSC__VariableEnvironment__add(environment: *VariableEnvironment, vm: *bun.jsc.VM, identifier_array: *IdentifierArray, identifier_index: StringID) void;
    pub const add = JSC__VariableEnvironment__add;
};
const IdentifierArray = opaque {
    extern fn JSC__IdentifierArray__create(len: usize) *IdentifierArray;
    pub const create = JSC__IdentifierArray__create;

    extern fn JSC__IdentifierArray__destroy(identifier_array: *IdentifierArray) void;
    pub const destroy = JSC__IdentifierArray__destroy;

    extern fn JSC__IdentifierArray__setFromUtf8(identifier_array: *IdentifierArray, n: usize, vm: *bun.jsc.VM, str: [*]const u8, len: usize) void;
    pub fn setFromUtf8(self: *IdentifierArray, n: usize, vm: *bun.jsc.VM, str: []const u8) void {
        JSC__IdentifierArray__setFromUtf8(self, n, vm, str.ptr, str.len);
    }
};
const SourceCode = opaque {};
const JSModuleRecord = opaque {
    extern fn JSC_JSModuleRecord__create(global_object: *bun.jsc.JSGlobalObject, vm: *bun.jsc.VM, module_key: *const IdentifierArray, source_code: *const SourceCode, declared_variables: *VariableEnvironment, lexical_variables: *VariableEnvironment, has_import_meta: bool, is_typescript: bool, has_tla: bool) *JSModuleRecord;
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
    extern fn JSC_JSModuleRecord__addImportEntrySingleTypeScript(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntrySingleTypeScript = JSC_JSModuleRecord__addImportEntrySingleTypeScript;
    extern fn JSC_JSModuleRecord__addImportEntryNamespace(module_record: *JSModuleRecord, identifier_array: *IdentifierArray, import_name: StringID, local_name: StringID, module_name: StringID) void;
    pub const addImportEntryNamespace = JSC_JSModuleRecord__addImportEntryNamespace;
};

const bun = @import("bun");
const DiffFormatter = @import("../test_runner/diff_format.zig").DiffFormatter;

const analyze = @import("../bundler/analyze_transpiled_module.zig");
const ModuleInfoDeserialized = analyze.ModuleInfoDeserialized;
const StringID = analyze.StringID;
