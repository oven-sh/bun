const JSC = @import("root").bun.JSC;
const bun = @import("root").bun;
const string = bun.string;
const std = @import("std");

fn _getSystem() type {
    // this is a workaround for a Zig stage1 bug
    // the "usingnamespace" is evaluating in dead branches
    return brk: {
        if (comptime bun.Environment.isLinux) {
            const Type = bun.C.linux;
            break :brk struct {
                pub usingnamespace std.os.system;
                pub usingnamespace Type;
            };
        }

        break :brk std.os.system;
    };
}

const system = _getSystem();

const Maybe = JSC.Node.Maybe;

const fd_t = std.os.fd_t;
const pid_t = std.os.pid_t;
const toPosixPath = std.os.toPosixPath;
const errno = std.os.errno;
const mode_t = std.os.mode_t;
const unexpectedErrno = std.os.unexpectedErrno;

pub const WaitPidResult = struct {
    pid: pid_t,
    status: u32,
};

// mostly taken from zig's posix_spawn.zig
pub const PosixSpawn = struct {
    pub const Attr = struct {
        attr: system.posix_spawnattr_t,

        pub fn init() !Attr {
            var attr: system.posix_spawnattr_t = undefined;
            switch (errno(system.posix_spawnattr_init(&attr))) {
                .SUCCESS => return Attr{ .attr = attr },
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn deinit(self: *Attr) void {
            if (comptime bun.Environment.isMac) {
                // https://github.com/ziglang/zig/issues/12964
                _ = system.posix_spawnattr_destroy(&self.attr);
            } else {
                _ = system.posix_spawnattr_destroy(&self.attr);
            }
        }

        pub fn get(self: Attr) !u16 {
            var flags: c_short = undefined;
            switch (errno(system.posix_spawnattr_getflags(&self.attr, &flags))) {
                .SUCCESS => return @bitCast(u16, flags),
                .INVAL => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn set(self: *Attr, flags: u16) !void {
            switch (errno(system.posix_spawnattr_setflags(&self.attr, @bitCast(c_short, flags)))) {
                .SUCCESS => return,
                .INVAL => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }
    };

    pub const Actions = struct {
        actions: system.posix_spawn_file_actions_t,

        pub fn init() !Actions {
            var actions: system.posix_spawn_file_actions_t = undefined;
            switch (errno(system.posix_spawn_file_actions_init(&actions))) {
                .SUCCESS => return Actions{ .actions = actions },
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn deinit(self: *Actions) void {
            if (comptime bun.Environment.isMac) {
                // https://github.com/ziglang/zig/issues/12964
                _ = system.posix_spawn_file_actions_destroy(&self.actions);
            } else {
                _ = system.posix_spawn_file_actions_destroy(&self.actions);
            }

            self.* = undefined;
        }

        pub fn open(self: *Actions, fd: fd_t, path: []const u8, flags: u32, mode: mode_t) !void {
            const posix_path = try toPosixPath(path);
            return self.openZ(fd, &posix_path, flags, mode);
        }

        pub fn openZ(self: *Actions, fd: fd_t, path: [*:0]const u8, flags: u32, mode: mode_t) !void {
            switch (errno(system.posix_spawn_file_actions_addopen(&self.actions, fd, path, @bitCast(c_int, flags), mode))) {
                .SUCCESS => return,
                .BADF => return error.InvalidFileDescriptor,
                .NOMEM => return error.SystemResources,
                .NAMETOOLONG => return error.NameTooLong,
                .INVAL => unreachable, // the value of file actions is invalid
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn close(self: *Actions, fd: fd_t) !void {
            switch (errno(system.posix_spawn_file_actions_addclose(&self.actions, fd))) {
                .SUCCESS => return,
                .BADF => return error.InvalidFileDescriptor,
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable, // the value of file actions is invalid
                .NAMETOOLONG => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn dup2(self: *Actions, fd: fd_t, newfd: fd_t) !void {
            switch (errno(system.posix_spawn_file_actions_adddup2(&self.actions, fd, newfd))) {
                .SUCCESS => return,
                .BADF => return error.InvalidFileDescriptor,
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable, // the value of file actions is invalid
                .NAMETOOLONG => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn inherit(self: *Actions, fd: fd_t) !void {
            switch (errno(system.posix_spawn_file_actions_addinherit_np(&self.actions, fd))) {
                .SUCCESS => return,
                .BADF => return error.InvalidFileDescriptor,
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable, // the value of file actions is invalid
                .NAMETOOLONG => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn chdir(self: *Actions, path: []const u8) !void {
            const posix_path = try toPosixPath(path);
            return self.chdirZ(&posix_path);
        }

        pub fn chdirZ(self: *Actions, path: [*:0]const u8) !void {
            switch (errno(system.posix_spawn_file_actions_addchdir_np(&self.actions, path))) {
                .SUCCESS => return,
                .NOMEM => return error.SystemResources,
                .NAMETOOLONG => return error.NameTooLong,
                .BADF => unreachable,
                .INVAL => unreachable, // the value of file actions is invalid
                else => |err| return unexpectedErrno(err),
            }
        }

        pub fn fchdir(self: *Actions, fd: fd_t) !void {
            switch (errno(system.posix_spawn_file_actions_addfchdir_np(&self.actions, fd))) {
                .SUCCESS => return,
                .BADF => return error.InvalidFileDescriptor,
                .NOMEM => return error.SystemResources,
                .INVAL => unreachable, // the value of file actions is invalid
                .NAMETOOLONG => unreachable,
                else => |err| return unexpectedErrno(err),
            }
        }
    };

    pub fn spawn(
        path: []const u8,
        actions: ?Actions,
        attr: ?Attr,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !pid_t {
        const posix_path = try toPosixPath(path);
        return spawnZ(&posix_path, actions, attr, argv, envp);
    }

    pub fn spawnZ(
        path: [*:0]const u8,
        actions: ?Actions,
        attr: ?Attr,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) Maybe(pid_t) {
        var pid: pid_t = undefined;
        const rc = system.posix_spawn(
            &pid,
            path,
            if (actions) |a| &a.actions else null,
            if (attr) |a| &a.attr else null,
            argv,
            envp,
        );
        if (comptime bun.Environment.allow_assert)
            JSC.Node.Syscall.syslog("posix_spawn({s}) = {d} ({d})", .{
                path,
                rc,
                pid,
            });

        if (comptime bun.Environment.isLinux) {
            // rc is negative because it's libc errno
            if (rc > 0) {
                if (Maybe(pid_t).errnoSysP(-rc, .posix_spawn, path)) |err| {
                    return err;
                }
            }
        } else {
            if (Maybe(pid_t).errnoSysP(rc, .posix_spawn, path)) |err| {
                return err;
            }
        }

        return Maybe(pid_t){ .result = pid };
    }

    pub fn spawnp(
        file: []const u8,
        actions: ?Actions,
        attr: ?Attr,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !pid_t {
        const posix_file = try toPosixPath(file);
        return spawnpZ(&posix_file, actions, attr, argv, envp);
    }

    pub fn spawnpZ(
        file: [*:0]const u8,
        actions: ?Actions,
        attr: ?Attr,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !pid_t {
        var pid: pid_t = undefined;
        switch (errno(system.posix_spawnp(
            &pid,
            file,
            if (actions) |a| &a.actions else null,
            if (attr) |a| &a.attr else null,
            argv,
            envp,
        ))) {
            .SUCCESS => return pid,
            .@"2BIG" => return error.TooBig,
            .NOMEM => return error.SystemResources,
            .BADF => return error.InvalidFileDescriptor,
            .ACCES => return error.PermissionDenied,
            .IO => return error.InputOutput,
            .LOOP => return error.FileSystem,
            .NAMETOOLONG => return error.NameTooLong,
            .NOENT => return error.FileNotFound,
            .NOEXEC => return error.InvalidExe,
            .NOTDIR => return error.NotDir,
            .TXTBSY => return error.FileBusy,
            .BADARCH => return error.InvalidExe,
            .BADEXEC => return error.InvalidExe,
            .FAULT => unreachable,
            .INVAL => unreachable,
            else => |err| return unexpectedErrno(err),
        }
    }

    /// Use this version of the `waitpid` wrapper if you spawned your child process using `posix_spawn`
    /// or `posix_spawnp` syscalls.
    /// See also `std.os.waitpid` for an alternative if your child process was spawned via `fork` and
    /// `execve` method.
    pub fn waitpid(pid: pid_t, flags: u32) Maybe(WaitPidResult) {
        const Status = c_int;
        var status: Status = undefined;
        while (true) {
            const rc = system.waitpid(pid, &status, @intCast(c_int, flags));
            switch (errno(rc)) {
                .SUCCESS => return Maybe(WaitPidResult){
                    .result = .{
                        .pid = @intCast(pid_t, rc),
                        .status = @bitCast(u32, status),
                    },
                },
                .INTR => continue,

                else => return JSC.Maybe(WaitPidResult).errnoSys(rc, .waitpid).?,
            }
        }
    }
};
