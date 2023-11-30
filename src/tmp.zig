const bun = @import("root").bun;
const std = @import("std");
const Environment = bun.Environment;
const O = std.os.O;
// To be used with files
// not folders!
pub const Tmpfile = struct {
    destination_dir: bun.FileDescriptor = bun.invalid_fd,
    tmpfilename: [:0]const u8 = "",
    fd: bun.FileDescriptor = bun.invalid_fd,
    using_tmpfile: bool = Environment.isLinux,

    pub fn create(
        destination_dir: bun.FileDescriptor,
        tmpfilename: [:0]const u8,
    ) bun.JSC.Maybe(Tmpfile) {
        const perm = 0o644;
        var tmpfile = Tmpfile{
            .destination_dir = destination_dir,
            .tmpfilename = tmpfilename,
        };

        open: while (true) {
            if (comptime Environment.isLinux) {
                switch (bun.sys.openat(destination_dir, ".", O.WRONLY | O.TMPFILE | O.CLOEXEC, perm)) {
                    .result => |fd| {
                        tmpfile.fd = fd;
                        break :open;
                    },
                    .err => |err| {
                        switch (err.getErrno()) {
                            .INVAL, .OPNOTSUPP, .NOSYS => {
                                tmpfile.using_tmpfile = false;
                            },
                            else => return .{ .err = err },
                        }
                    },
                }
            }

            tmpfile.fd = switch (bun.sys.openat(bun.toFD(bun.fs.FileSystem.instance.tmpdir().fd), tmpfilename, O.CREAT | O.CLOEXEC | O.WRONLY, perm)) {
                .result => |fd| fd,
                .err => |err| return .{ .err = err },
            };
            break :open;
        }

        return .{ .result = tmpfile };
    }

    pub fn finish(this: *Tmpfile, destname: [:0]const u8) !void {
        if (comptime Environment.isLinux) {
            if (this.using_tmpfile) {
                return try bun.sys.linkatTmpfile(this.fd, this.destination_dir, destname).unwrap();
            }
        }

        try bun.C.moveFileZWithHandle(bun.fdcast(this.fd), this.destination_dir, this.tmpfilename.ptr, bun.fdcast(this.destination_dir), destname.ptr);
    }
};
