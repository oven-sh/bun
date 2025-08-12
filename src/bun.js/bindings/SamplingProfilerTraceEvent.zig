const std = @import("std");
const bun = @import("root");
const JSC = @import("../jsc.zig");

extern "C" fn free(ptr: ?*anyopaque) void;

pub extern fn BunSamplingProfilerTraceEvent__start(vm: *JSC.VM) void;
pub extern fn BunSamplingProfilerTraceEvent__stop(vm: *JSC.VM) ?[*:0]u8;

pub const SamplingProfilerTraceEvent = struct {
    pub fn start(vm: *JSC.VM) void {
        BunSamplingProfilerTraceEvent__start(vm);
    }
    
    pub fn stop(vm: *JSC.VM, file_path: []const u8) bool {
        const profile_data_ptr = BunSamplingProfilerTraceEvent__stop(vm) orelse return false;
        defer free(profile_data_ptr);
        
        const profile_data = std.mem.span(profile_data_ptr);
        
        // Write to file using Zig std library
        std.fs.cwd().writeFile(.{
            .sub_path = file_path,
            .data = profile_data,
        }) catch {
            return false;
        };
        
        return true;
    }
};