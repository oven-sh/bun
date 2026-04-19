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
    if (this.keep_existing_dest) {
        // Global virtual-store entries are content-addressed and shared across
        // processes, so a previously-created destination is normally a hit.
        // But if an earlier install was interrupted mid-clonefile (jetsam,
        // disk-full mid directory walk, panic), the destination directory can
        // exist with only some of the package files. Treating that EEXIST as
        // success would permanently lock in the broken entry for every future
        // install. Make population atomic instead: clone into a per-process
        // temp sibling, then rename into place. The losing process's rename
        // sees EEXIST/NOTEMPTY and discards its identical temp tree.
        return this.cloneAtomic();
    }
    switch (this.clonefileat()) {
        .result => return .success,
        .err => |err| {
            switch (err.getErrno()) {
                .EXIST => {
                    FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                    return this.clonefileat();
                },

                .NOENT => {
                    const parent_dest_dir = std.fs.path.dirname(this.dest_subpath.slice()) orelse {
                        return .initErr(err);
                    };
                    FD.cwd().makePath(u8, parent_dest_dir) catch {};
                    return this.clonefileat();
                },
                else => {
                    return .initErr(err);
                },
            }
        },
    }
}

fn cloneAtomic(this: *FileCloner) sys.Maybe(void) {
    var tmp_buf: bun.PathBuffer = undefined;
    // Temp path is a sibling of the final path so the rename is atomic and
    // stays on the same volume (clonefile already requires same-volume).
    const tmp_path: [:0]const u8 = std.fmt.bufPrintZ(
        &tmp_buf,
        "{s}.tmp-{d}-{d}",
        .{ this.dest_subpath.slice(), std.c.getpid(), std.crypto.random.int(u32) },
    ) catch return .initErr(.{ .errno = @intFromEnum(bun.sys.E.NAMETOOLONG), .syscall = .clonefile });

    cloned: {
        switch (sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), tmp_path)) {
            .result => break :cloned,
            .err => |err| switch (err.getErrno()) {
                .NOENT => {
                    if (std.fs.path.dirname(this.dest_subpath.slice())) |parent| {
                        FD.cwd().makePath(u8, parent) catch {};
                    }
                },
                .EXIST => {
                    // Stale temp from a crashed earlier run with the same pid.
                    FD.cwd().deleteTree(tmp_path) catch {};
                },
                else => return .initErr(err),
            },
        }
        switch (sys.clonefileat(this.cache_dir, this.cache_dir_subpath.sliceZ(), FD.cwd(), tmp_path)) {
            .result => break :cloned,
            .err => |err| return .initErr(err),
        }
    }

    switch (sys.rename(tmp_path, this.dest_subpath.sliceZ())) {
        .result => return .success,
        .err => |err| switch (err.getErrno()) {
            .EXIST, .NOTEMPTY => {
                // Someone got there first. Distinguish "concurrent install
                // produced a complete entry" from "an interrupted install
                // left a partial directory" by probing for the package.json
                // the warm-hit fast path uses as its sentinel.
                var sentinel_buf: bun.PathBuffer = undefined;
                const sentinel = std.fmt.bufPrintZ(&sentinel_buf, "{s}/package.json", .{this.dest_subpath.slice()}) catch {
                    FD.cwd().deleteTree(tmp_path) catch {};
                    return .initErr(err);
                };
                if (sys.existsZ(sentinel)) {
                    FD.cwd().deleteTree(tmp_path) catch {};
                    return .success;
                }
                // Partial entry from an interrupted earlier run: replace it
                // with the complete tree we just produced.
                FD.cwd().deleteTree(this.dest_subpath.slice()) catch {};
                return switch (sys.rename(tmp_path, this.dest_subpath.sliceZ())) {
                    .result => .success,
                    .err => |e| switch (e.getErrno()) {
                        // A concurrent install repopulated it between our
                        // deleteTree and rename — we're done either way.
                        .EXIST, .NOTEMPTY => {
                            FD.cwd().deleteTree(tmp_path) catch {};
                            return .success;
                        },
                        else => {
                            FD.cwd().deleteTree(tmp_path) catch {};
                            return .initErr(e);
                        },
                    },
                };
            },
            else => {
                FD.cwd().deleteTree(tmp_path) catch {};
                return .initErr(err);
            },
        },
    }
}

const std = @import("std");

const bun = @import("bun");
const FD = bun.FD;
const sys = bun.sys;
