pub const Symlinker = struct {
    dest: bun.Path(.{ .sep = .auto }),
    target: bun.RelPath(.{ .sep = .auto }),
    fallback_junction_target: bun.AbsPath(.{ .sep = .auto }),

    pub fn symlink(this: *const @This()) sys.Maybe(void) {
        if (comptime Environment.isWindows) {
            return sys.symlinkOrJunction(this.dest.sliceZ(), this.target.sliceZ(), this.fallback_junction_target.sliceZ());
        }
        return sys.symlink(this.target.sliceZ(), this.dest.sliceZ());
    }

    pub const Strategy = enum {
        expect_existing,
        expect_missing,
        ignore_failure,
    };

    pub fn ensureSymlink(
        this: *const @This(),
        strategy: Strategy,
    ) sys.Maybe(void) {
        return switch (strategy) {
            .ignore_failure => {
                return switch (this.symlink()) {
                    .result => .success,
                    .err => |symlink_err| switch (symlink_err.getErrno()) {
                        .NOENT => {
                            const dest_parent = this.dest.dirname() orelse {
                                return .success;
                            };

                            FD.cwd().makePath(u8, dest_parent) catch {};
                            _ = this.symlink();
                            return .success;
                        },
                        else => .success,
                    },
                };
            },
            .expect_missing => {
                return switch (this.symlink()) {
                    .result => .success,
                    .err => |symlink_err1| switch (symlink_err1.getErrno()) {
                        .NOENT => {
                            const dest_parent = this.dest.dirname() orelse {
                                return .initErr(symlink_err1);
                            };

                            FD.cwd().makePath(u8, dest_parent) catch {};
                            return this.symlink();
                        },
                        .EXIST => {
                            FD.cwd().deleteTree(this.dest.sliceZ()) catch {};
                            return this.symlink();
                        },
                        else => .initErr(symlink_err1),
                    },
                };
            },
            .expect_existing => {
                const current_link_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(current_link_buf);
                var current_link: []const u8 = switch (sys.readlink(this.dest.sliceZ(), current_link_buf)) {
                    .result => |res| res,
                    .err => |readlink_err| return switch (readlink_err.getErrno()) {
                        .NOENT => switch (this.symlink()) {
                            .result => .success,
                            .err => |symlink_err| switch (symlink_err.getErrno()) {
                                .NOENT => {
                                    const dest_parent = this.dest.dirname() orelse {
                                        return .initErr(symlink_err);
                                    };

                                    FD.cwd().makePath(u8, dest_parent) catch {};
                                    return this.symlink();
                                },
                                else => .initErr(symlink_err),
                            },
                        },
                        else => {
                            FD.cwd().deleteTree(this.dest.sliceZ()) catch {};
                            return this.symlink();
                        },
                    },
                };

                // libuv adds a trailing slash to junctions.
                current_link = strings.withoutTrailingSlash(current_link);

                if (strings.eqlLong(current_link, this.target.sliceZ(), true)) {
                    return .success;
                }

                if (comptime Environment.isWindows) {
                    if (strings.eqlLong(current_link, this.fallback_junction_target.slice(), true)) {
                        return .success;
                    }

                    // this existing link is pointing to the wrong package.
                    // on windows rmdir must be used for symlinks created to point
                    // at directories, even if the target no longer exists
                    switch (sys.rmdir(this.dest.sliceZ())) {
                        .result => {},
                        .err => |err| switch (err.getErrno()) {
                            .PERM => {
                                _ = sys.unlink(this.dest.sliceZ());
                            },
                            else => {},
                        },
                    }
                } else {
                    // this existing link is pointing to the wrong package
                    _ = sys.unlink(this.dest.sliceZ());
                }

                return this.symlink();
            },
        };
    }
};

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const strings = bun.strings;
const sys = bun.sys;
