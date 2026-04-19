const FileCloner = @This();

// macOS clonefileat only

cache_dir: FD,
cache_dir_subpath: bun.AutoRelPath,
dest_subpath: bun.Path(.{ .sep = .auto, .unit = .os }),
/// When true, an existing destination is treated as success rather than wiped
/// and re-cloned. Set for global virtual-store entries, which are shared
/// across projects and content-addressed by name (so the existing tree is
/// already what we'd produce).
keep_existing_dest: bool = false,

fn clonefileat(this: *FileCloner) sys.Maybe(void) {
    return sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), this.dest_subpath.sliceZ());
}

pub fn clone(this: *FileCloner) sys.Maybe(void) {
    switch (this.clonefileat()) {
        .result => return .success,
        .err => |err| {
            switch (err.getErrno()) {
                .EXIST => {
                    if (this.keep_existing_dest) {
                        return .success;
                    }
                    FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                    return this.clonefileat();
                },

                .NOENT => {
                    const parent_dest_dir = std.fs.path.dirname(this.dest_subpath.slice()) orelse {
                        return .initErr(err);
                    };
                    FD.cwd().makePath(u8, parent_dest_dir) catch {};
                    return switch (this.clonefileat()) {
                        .result => .success,
                        .err => |retry_err| switch (retry_err.getErrno()) {
                            // Another install racing on the same global-store
                            // entry created it between our NOENT and this retry;
                            // for content-addressed dests that's a successful
                            // outcome, not a failure.
                            .EXIST => if (this.keep_existing_dest) .success else .initErr(retry_err),
                            else => .initErr(retry_err),
                        },
                    };
                },
                else => {
                    return .initErr(err);
                },
            }
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const FD = bun.FD;
const sys = bun.sys;
