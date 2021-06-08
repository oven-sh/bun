pub usingnamespace @import("std").c.builtins;

// int clonefileat(int src_dirfd, const char * src, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn clonefileat(c_int, [*c]const u8, c_int, [*c]const u8, uint32_t: c_int) c_int;
// int fclonefileat(int srcfd, int dst_dirfd, const char * dst, int flags);
pub extern "c" fn fclonefileat(c_int, c_int, [*c]const u8, uint32_t: c_int) c_int;
// int clonefile(const char * src, const char * dst, int flags);
pub extern "c" fn clonefile([*c]const u8, [*c]const u8, uint32_t: c_int) c_int;

pub extern "c" fn chmod([*c]const u8, mode_t) c_int;
pub extern "c" fn fchmod(c_int, mode_t) c_int;
pub extern "c" fn umask(mode_t) mode_t;
pub extern "c" fn fchmodat(c_int, [*c]const u8, mode_t, c_int) c_int;

const mode_t = u16;
