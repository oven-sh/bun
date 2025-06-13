/// uWS::Request C++ -> Zig bindings.
pub const Request = opaque {
    pub fn isAncient(req: *Request) bool {
        return c.uws_req_is_ancient(req);
    }
    pub fn getYield(req: *Request) bool {
        return c.uws_req_get_yield(req);
    }
    pub fn setYield(req: *Request, yield: bool) void {
        c.uws_req_set_yield(req, yield);
    }
    pub fn url(req: *Request) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..c.uws_req_get_url(req, &ptr)];
    }
    pub fn method(req: *Request) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..c.uws_req_get_method(req, &ptr)];
    }
    pub fn header(req: *Request, name: []const u8) ?[]const u8 {
        bun.assert(std.ascii.isLower(name[0]));

        var ptr: [*]const u8 = undefined;
        const len = c.uws_req_get_header(req, name.ptr, name.len, &ptr);
        if (len == 0) return null;
        return ptr[0..len];
    }
    pub fn dateForHeader(req: *Request, name: []const u8) ?u64 {
        const value = header(req, name);
        if (value == null) return null;
        var string = bun.String.init(value.?);
        defer string.deref();
        const date_f64 = bun.String.parseDate(&string, bun.JSC.VirtualMachine.get().global);
        if (!std.math.isNan(date_f64) and std.math.isFinite(date_f64)) {
            return @intFromFloat(date_f64);
        }
        return null;
    }
    pub fn query(req: *Request, name: []const u8) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..c.uws_req_get_query(req, name.ptr, name.len, &ptr)];
    }
    pub fn parameter(req: *Request, index: u16) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..c.uws_req_get_parameter(req, @as(c_ushort, @intCast(index)), &ptr)];
    }
};

const c = struct {
    pub extern fn uws_req_is_ancient(res: *Request) bool;
    pub extern fn uws_req_get_yield(res: *Request) bool;
    pub extern fn uws_req_set_yield(res: *Request, yield: bool) void;
    pub extern fn uws_req_get_url(res: *Request, dest: *[*]const u8) usize;
    pub extern fn uws_req_get_method(res: *Request, dest: *[*]const u8) usize;
    pub extern fn uws_req_get_header(res: *Request, lower_case_header: [*]const u8, lower_case_header_length: usize, dest: *[*]const u8) usize;
    pub extern fn uws_req_get_query(res: *Request, key: [*c]const u8, key_length: usize, dest: *[*]const u8) usize;
    pub extern fn uws_req_get_parameter(res: *Request, index: c_ushort, dest: *[*]const u8) usize;
};

const bun = @import("bun");
const std = @import("std");
