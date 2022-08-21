const std = @import("std");
const uinstd = @cImport(@cInclude("unistd.h"));

pub fn get_total_memory() u64 {
    const pages = uinstd.sysconf(uinstd._SC_PHYS_PAGES);
    const page_size = uinstd.sysconf(uinstd._SC_PAGE_SIZE);

    return @bitCast(u64, pages) * @bitCast(u64, page_size);
}

pub fn main() void {
    std.debug.print("TOTAL: {}", .{get_total_memory()});
    //std.debug.print("FREE: {}", .{pages2 * page_size});
}
