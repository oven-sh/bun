const std = @import("std");
const bun = @import("bun.zig");

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
    // requested_modules
    // imports
    // exports
    // declared_variables
    // lexical_variables
    // features
};
