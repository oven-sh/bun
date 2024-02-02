//! TODO: Delete this entire file once https://github.com/ziglang/zig/issues/18694 is resolved.
const bun = @import("root").bun;
const std = @import("std");

const os = std.os;
const windows = os.windows;
const mem = std.mem;
const unicode = std.unicode;
const fs = std.fs;
const math = std.math;

const File = fs.File;

const ChildProcess = std.ChildProcess;
const SpawnError = ChildProcess.SpawnError;
const StdIo = ChildProcess.StdIo;
const EnvMap = std.process.EnvMap;

pub fn toUTF16Alloc(alloc: mem.Allocator, bytes: []const u8) ![:0]u16 {
    return bun.strings.toUTF16AllocForReal(alloc, bytes, false, true);
}
const utf8ToUtf16Le = bun.strings.convertUTF8toUTF16InBuffer;

pub fn spawnWindows(self: *ChildProcess) SpawnError!void {
    const saAttr = windows.SECURITY_ATTRIBUTES{
        .nLength = @sizeOf(windows.SECURITY_ATTRIBUTES),
        .bInheritHandle = windows.TRUE,
        .lpSecurityDescriptor = null,
    };

    const any_ignore = (self.stdin_behavior == StdIo.Ignore or self.stdout_behavior == StdIo.Ignore or self.stderr_behavior == StdIo.Ignore);

    const nul_handle = if (any_ignore)
        // "\Device\Null" or "\??\NUL"
        windows.OpenFile(&[_]u16{ '\\', 'D', 'e', 'v', 'i', 'c', 'e', '\\', 'N', 'u', 'l', 'l' }, .{
            .access_mask = windows.GENERIC_READ | windows.SYNCHRONIZE,
            .share_access = windows.FILE_SHARE_READ,
            .creation = windows.OPEN_EXISTING,
            .io_mode = .blocking,
        }) catch |err| switch (err) {
            error.PathAlreadyExists => unreachable, // not possible for "NUL"
            error.PipeBusy => unreachable, // not possible for "NUL"
            error.FileNotFound => unreachable, // not possible for "NUL"
            error.AccessDenied => unreachable, // not possible for "NUL"
            error.NameTooLong => unreachable, // not possible for "NUL"
            error.WouldBlock => unreachable, // not possible for "NUL"
            error.NetworkNotFound => unreachable, // not possible for "NUL"
            else => |e| return e,
        }
    else
        undefined;
    defer {
        if (any_ignore) os.close(nul_handle);
    }
    if (any_ignore) {
        try windows.SetHandleInformation(nul_handle, windows.HANDLE_FLAG_INHERIT, 0);
    }

    var g_hChildStd_IN_Rd: ?windows.HANDLE = null;
    var g_hChildStd_IN_Wr: ?windows.HANDLE = null;
    switch (self.stdin_behavior) {
        StdIo.Pipe => {
            try windowsMakePipeIn(&g_hChildStd_IN_Rd, &g_hChildStd_IN_Wr, &saAttr);
        },
        StdIo.Ignore => {
            g_hChildStd_IN_Rd = nul_handle;
        },
        StdIo.Inherit => {
            g_hChildStd_IN_Rd = windows.GetStdHandle(windows.STD_INPUT_HANDLE) catch null;
        },
        StdIo.Close => {
            g_hChildStd_IN_Rd = null;
        },
    }
    errdefer if (self.stdin_behavior == StdIo.Pipe) {
        windowsDestroyPipe(g_hChildStd_IN_Rd, g_hChildStd_IN_Wr);
    };

    var g_hChildStd_OUT_Rd: ?windows.HANDLE = null;
    var g_hChildStd_OUT_Wr: ?windows.HANDLE = null;
    switch (self.stdout_behavior) {
        StdIo.Pipe => {
            try windowsMakeAsyncPipe(&g_hChildStd_OUT_Rd, &g_hChildStd_OUT_Wr, &saAttr);
        },
        StdIo.Ignore => {
            g_hChildStd_OUT_Wr = nul_handle;
        },
        StdIo.Inherit => {
            g_hChildStd_OUT_Wr = windows.GetStdHandle(windows.STD_OUTPUT_HANDLE) catch null;
        },
        StdIo.Close => {
            g_hChildStd_OUT_Wr = null;
        },
    }
    errdefer if (self.stdin_behavior == StdIo.Pipe) {
        windowsDestroyPipe(g_hChildStd_OUT_Rd, g_hChildStd_OUT_Wr);
    };

    var g_hChildStd_ERR_Rd: ?windows.HANDLE = null;
    var g_hChildStd_ERR_Wr: ?windows.HANDLE = null;
    switch (self.stderr_behavior) {
        StdIo.Pipe => {
            try windowsMakeAsyncPipe(&g_hChildStd_ERR_Rd, &g_hChildStd_ERR_Wr, &saAttr);
        },
        StdIo.Ignore => {
            g_hChildStd_ERR_Wr = nul_handle;
        },
        StdIo.Inherit => {
            g_hChildStd_ERR_Wr = windows.GetStdHandle(windows.STD_ERROR_HANDLE) catch null;
        },
        StdIo.Close => {
            g_hChildStd_ERR_Wr = null;
        },
    }
    errdefer if (self.stdin_behavior == StdIo.Pipe) {
        windowsDestroyPipe(g_hChildStd_ERR_Rd, g_hChildStd_ERR_Wr);
    };

    const cmd_line = try windowsCreateCommandLine(self.allocator, self.argv);
    defer self.allocator.free(cmd_line);

    var siStartInfo = windows.STARTUPINFOW{
        .cb = @sizeOf(windows.STARTUPINFOW),
        .hStdError = g_hChildStd_ERR_Wr,
        .hStdOutput = g_hChildStd_OUT_Wr,
        .hStdInput = g_hChildStd_IN_Rd,
        .dwFlags = windows.STARTF_USESTDHANDLES,

        .lpReserved = null,
        .lpDesktop = null,
        .lpTitle = null,
        .dwX = 0,
        .dwY = 0,
        .dwXSize = 0,
        .dwYSize = 0,
        .dwXCountChars = 0,
        .dwYCountChars = 0,
        .dwFillAttribute = 0,
        .wShowWindow = 0,
        .cbReserved2 = 0,
        .lpReserved2 = null,
    };
    var piProcInfo: windows.PROCESS_INFORMATION = undefined;

    const cwd_w = if (self.cwd) |cwd| try toUTF16Alloc(self.allocator, cwd) else null;
    defer if (cwd_w) |cwd| self.allocator.free(cwd);
    const cwd_w_ptr = if (cwd_w) |cwd| cwd.ptr else null;

    const maybe_envp_buf = if (self.env_map) |env_map| try createWindowsEnvBlock(self.allocator, env_map) else null;
    defer if (maybe_envp_buf) |envp_buf| self.allocator.free(envp_buf);
    const envp_ptr = if (maybe_envp_buf) |envp_buf| envp_buf.ptr else null;

    const app_name_utf8 = self.argv[0];
    const app_name_is_absolute = fs.path.isAbsolute(app_name_utf8);

    // the cwd set in ChildProcess is in effect when choosing the executable path
    // to match posix semantics
    var cwd_path_w_needs_free = false;
    const cwd_path_w = x: {
        // If the app name is absolute, then we need to use its dirname as the cwd
        if (app_name_is_absolute) {
            cwd_path_w_needs_free = true;
            const dir = fs.path.dirname(app_name_utf8).?;
            break :x try toUTF16Alloc(self.allocator, dir);
        } else if (self.cwd) |cwd| {
            cwd_path_w_needs_free = true;
            break :x try toUTF16Alloc(self.allocator, cwd);
        } else {
            break :x &[_:0]u16{}; // empty for cwd
        }
    };
    defer if (cwd_path_w_needs_free) self.allocator.free(cwd_path_w);

    // If the app name has more than just a filename, then we need to separate that
    // into the basename and dirname and use the dirname as an addition to the cwd
    // path. This is because NtQueryDirectoryFile cannot accept FileName params with
    // path separators.
    const app_basename_utf8 = fs.path.basename(app_name_utf8);
    // If the app name is absolute, then the cwd will already have the app's dirname in it,
    // so only populate app_dirname if app name is a relative path with > 0 path separators.
    const maybe_app_dirname_utf8 = if (!app_name_is_absolute) fs.path.dirname(app_name_utf8) else null;
    const app_dirname_w: ?[:0]u16 = x: {
        if (maybe_app_dirname_utf8) |app_dirname_utf8| {
            break :x try toUTF16Alloc(self.allocator, app_dirname_utf8);
        }
        break :x null;
    };
    defer if (app_dirname_w != null) self.allocator.free(app_dirname_w.?);

    const app_name_w = try toUTF16Alloc(self.allocator, app_basename_utf8);
    defer self.allocator.free(app_name_w);

    const cmd_line_w = try toUTF16Alloc(self.allocator, cmd_line);
    defer self.allocator.free(cmd_line_w);

    run: {
        const PATH: [:0]const u16 = std.os.getenvW(unicode.utf8ToUtf16LeStringLiteral("PATH")) orelse &[_:0]u16{};
        const PATHEXT: [:0]const u16 = std.os.getenvW(unicode.utf8ToUtf16LeStringLiteral("PATHEXT")) orelse &[_:0]u16{};

        var app_buf = std.ArrayListUnmanaged(u16){};
        defer app_buf.deinit(self.allocator);

        try app_buf.appendSlice(self.allocator, app_name_w);

        var dir_buf = std.ArrayListUnmanaged(u16){};
        defer dir_buf.deinit(self.allocator);

        if (cwd_path_w.len > 0) {
            try dir_buf.appendSlice(self.allocator, cwd_path_w);
        }
        if (app_dirname_w) |app_dir| {
            if (dir_buf.items.len > 0) try dir_buf.append(self.allocator, fs.path.sep);
            try dir_buf.appendSlice(self.allocator, app_dir);
        }
        if (dir_buf.items.len > 0) {
            // Need to normalize the path, openDirW can't handle things like double backslashes
            const normalized_len = windows.normalizePath(u16, dir_buf.items) catch return error.BadPathName;
            dir_buf.shrinkRetainingCapacity(normalized_len);
        }

        windowsCreateProcessPathExt(self.allocator, &dir_buf, &app_buf, PATHEXT, cmd_line_w.ptr, envp_ptr, cwd_w_ptr, &siStartInfo, &piProcInfo) catch |no_path_err| {
            const original_err = switch (no_path_err) {
                error.FileNotFound, error.InvalidExe, error.AccessDenied => |e| e,
                error.UnrecoverableInvalidExe => return error.InvalidExe,
                else => |e| return e,
            };

            // If the app name had path separators, that disallows PATH searching,
            // and there's no need to search the PATH if the app name is absolute.
            // We still search the path if the cwd is absolute because of the
            // "cwd set in ChildProcess is in effect when choosing the executable path
            // to match posix semantics" behavior--we don't want to skip searching
            // the PATH just because we were trying to set the cwd of the child process.
            if (app_dirname_w != null or app_name_is_absolute) {
                return original_err;
            }

            var it = mem.tokenizeScalar(u16, PATH, ';');
            while (it.next()) |search_path| {
                dir_buf.clearRetainingCapacity();
                try dir_buf.appendSlice(self.allocator, search_path);
                // Need to normalize the path, some PATH values can contain things like double
                // backslashes which openDirW can't handle
                const normalized_len = windows.normalizePath(u16, dir_buf.items) catch continue;
                dir_buf.shrinkRetainingCapacity(normalized_len);

                if (windowsCreateProcessPathExt(self.allocator, &dir_buf, &app_buf, PATHEXT, cmd_line_w.ptr, envp_ptr, cwd_w_ptr, &siStartInfo, &piProcInfo)) {
                    break :run;
                } else |err| switch (err) {
                    error.FileNotFound, error.AccessDenied, error.InvalidExe => continue,
                    error.UnrecoverableInvalidExe => return error.InvalidExe,
                    else => |e| return e,
                }
            } else {
                return original_err;
            }
        };
    }

    if (g_hChildStd_IN_Wr) |h| {
        self.stdin = File{ .handle = h };
    } else {
        self.stdin = null;
    }
    if (g_hChildStd_OUT_Rd) |h| {
        self.stdout = File{ .handle = h };
    } else {
        self.stdout = null;
    }
    if (g_hChildStd_ERR_Rd) |h| {
        self.stderr = File{ .handle = h };
    } else {
        self.stderr = null;
    }

    self.id = piProcInfo.hProcess;
    self.thread_handle = piProcInfo.hThread;
    self.term = null;

    if (self.stdin_behavior == StdIo.Pipe) {
        os.close(g_hChildStd_IN_Rd.?);
    }
    if (self.stderr_behavior == StdIo.Pipe) {
        os.close(g_hChildStd_ERR_Wr.?);
    }
    if (self.stdout_behavior == StdIo.Pipe) {
        os.close(g_hChildStd_OUT_Wr.?);
    }
}

/// Caller must dealloc.
fn windowsCreateCommandLine(allocator: mem.Allocator, argv: []const []const u8) ![:0]u8 {
    var buf = std.ArrayList(u8).init(allocator);
    defer buf.deinit();

    for (argv, 0..) |arg, arg_i| {
        if (arg_i != 0) try buf.append(' ');
        if (mem.indexOfAny(u8, arg, " \t\n\"") == null) {
            try buf.appendSlice(arg);
            continue;
        }
        try buf.append('"');
        var backslash_count: usize = 0;
        for (arg) |byte| {
            switch (byte) {
                '\\' => backslash_count += 1,
                '"' => {
                    try buf.appendNTimes('\\', backslash_count * 2 + 1);
                    try buf.append('"');
                    backslash_count = 0;
                },
                else => {
                    try buf.appendNTimes('\\', backslash_count);
                    try buf.append(byte);
                    backslash_count = 0;
                },
            }
        }
        try buf.appendNTimes('\\', backslash_count * 2);
        try buf.append('"');
    }

    return buf.toOwnedSliceSentinel(0);
}

fn windowsDestroyPipe(rd: ?windows.HANDLE, wr: ?windows.HANDLE) void {
    if (rd) |h| os.close(h);
    if (wr) |h| os.close(h);
}

fn windowsMakePipeIn(rd: *?windows.HANDLE, wr: *?windows.HANDLE, sattr: *const windows.SECURITY_ATTRIBUTES) !void {
    var rd_h: windows.HANDLE = undefined;
    var wr_h: windows.HANDLE = undefined;
    try windows.CreatePipe(&rd_h, &wr_h, sattr);
    errdefer windowsDestroyPipe(rd_h, wr_h);
    try windows.SetHandleInformation(wr_h, windows.HANDLE_FLAG_INHERIT, 0);
    rd.* = rd_h;
    wr.* = wr_h;
}

var pipe_name_counter = std.atomic.Value(u32).init(1);

fn windowsMakeAsyncPipe(rd: *?windows.HANDLE, wr: *?windows.HANDLE, sattr: *const windows.SECURITY_ATTRIBUTES) !void {
    var tmp_bufw: [128]u16 = undefined;

    // Anonymous pipes are built upon Named pipes.
    // https://docs.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-createpipe
    // Asynchronous (overlapped) read and write operations are not supported by anonymous pipes.
    // https://docs.microsoft.com/en-us/windows/win32/ipc/anonymous-pipe-operations
    const pipe_path = blk: {
        var tmp_buf: [128]u8 = undefined;
        // Forge a random path for the pipe.
        const pipe_path = std.fmt.bufPrintZ(
            &tmp_buf,
            "\\\\.\\pipe\\zig-childprocess-{d}-{d}",
            .{ windows.kernel32.GetCurrentProcessId(), pipe_name_counter.fetchAdd(1, .Monotonic) },
        ) catch unreachable;
        const buf_2 = utf8ToUtf16Le(&tmp_bufw, pipe_path);
        tmp_bufw[buf_2.len] = 0;
        break :blk tmp_bufw[0..buf_2.len :0];
    };

    // Create the read handle that can be used with overlapped IO ops.
    const read_handle = windows.kernel32.CreateNamedPipeW(
        pipe_path.ptr,
        windows.PIPE_ACCESS_INBOUND | windows.FILE_FLAG_OVERLAPPED,
        windows.PIPE_TYPE_BYTE,
        1,
        4096,
        4096,
        0,
        sattr,
    );
    if (read_handle == windows.INVALID_HANDLE_VALUE) {
        switch (windows.kernel32.GetLastError()) {
            else => |err| return windows.unexpectedError(err),
        }
    }
    errdefer os.close(read_handle);

    var sattr_copy = sattr.*;
    const write_handle = windows.kernel32.CreateFileW(
        pipe_path.ptr,
        windows.GENERIC_WRITE,
        0,
        &sattr_copy,
        windows.OPEN_EXISTING,
        windows.FILE_ATTRIBUTE_NORMAL,
        null,
    );
    if (write_handle == windows.INVALID_HANDLE_VALUE) {
        switch (windows.kernel32.GetLastError()) {
            else => |err| return windows.unexpectedError(err),
        }
    }
    errdefer os.close(write_handle);

    try windows.SetHandleInformation(read_handle, windows.HANDLE_FLAG_INHERIT, 0);

    rd.* = read_handle;
    wr.* = write_handle;
}

pub fn createWindowsEnvBlock(allocator: mem.Allocator, env_map: *const EnvMap) ![]u16 {
    // count bytes needed
    const max_chars_needed = x: {
        var max_chars_needed: usize = 4; // 4 for the final 4 null bytes
        var it = env_map.iterator();
        while (it.next()) |pair| {
            // +1 for '='
            // +1 for null byte
            max_chars_needed += pair.key_ptr.len + pair.value_ptr.len + 2;
        }
        break :x max_chars_needed;
    };
    const result = try allocator.alloc(u16, max_chars_needed);
    errdefer allocator.free(result);

    var it = env_map.iterator();
    var i: usize = 0;
    while (it.next()) |pair| {
        i += utf8ToUtf16Le(result[i..], pair.key_ptr.*).len;
        result[i] = '=';
        i += 1;
        i += utf8ToUtf16Le(result[i..], pair.value_ptr.*).len;
        result[i] = 0;
        i += 1;
    }
    result[i] = 0;
    i += 1;
    result[i] = 0;
    i += 1;
    result[i] = 0;
    i += 1;
    result[i] = 0;
    i += 1;
    return try allocator.realloc(result, i);
}

/// Expects `app_buf` to contain exactly the app name, and `dir_buf` to contain exactly the dir path.
/// After return, `app_buf` will always contain exactly the app name and `dir_buf` will always contain exactly the dir path.
/// Note: `app_buf` should not contain any leading path separators.
/// Note: If the dir is the cwd, dir_buf should be empty (len = 0).
fn windowsCreateProcessPathExt(
    allocator: mem.Allocator,
    dir_buf: *std.ArrayListUnmanaged(u16),
    app_buf: *std.ArrayListUnmanaged(u16),
    pathext: [:0]const u16,
    cmd_line: [*:0]u16,
    envp_ptr: ?[*]u16,
    cwd_ptr: ?[*:0]u16,
    lpStartupInfo: *windows.STARTUPINFOW,
    lpProcessInformation: *windows.PROCESS_INFORMATION,
) !void {
    const app_name_len = app_buf.items.len;
    const dir_path_len = dir_buf.items.len;

    if (app_name_len == 0) return error.FileNotFound;

    defer app_buf.shrinkRetainingCapacity(app_name_len);
    defer dir_buf.shrinkRetainingCapacity(dir_path_len);

    // The name of the game here is to avoid CreateProcessW calls at all costs,
    // and only ever try calling it when we have a real candidate for execution.
    // Secondarily, we want to minimize the number of syscalls used when checking
    // for each PATHEXT-appended version of the app name.
    //
    // An overview of the technique used:
    // - Open the search directory for iteration (either cwd or a path from PATH)
    // - Use NtQueryDirectoryFile with a wildcard filename of `<app name>*` to
    //   check if anything that could possibly match either the unappended version
    //   of the app name or any of the versions with a PATHEXT value appended exists.
    // - If the wildcard NtQueryDirectoryFile call found nothing, we can exit early
    //   without needing to use PATHEXT at all.
    //
    // This allows us to use a <open dir, NtQueryDirectoryFile, close dir> sequence
    // for any directory that doesn't contain any possible matches, instead of having
    // to use a separate look up for each individual filename combination (unappended +
    // each PATHEXT appended). For directories where the wildcard *does* match something,
    // we iterate the matches and take note of any that are either the unappended version,
    // or a version with a supported PATHEXT appended. We then try calling CreateProcessW
    // with the found versions in the appropriate order.

    var dir = dir: {
        // needs to be null-terminated
        try dir_buf.append(allocator, 0);
        defer dir_buf.shrinkRetainingCapacity(dir_path_len);
        const dir_path_z = dir_buf.items[0 .. dir_buf.items.len - 1 :0];
        const prefixed_path = try windows.wToPrefixedFileW(null, dir_path_z);
        break :dir fs.cwd().openDirW(prefixed_path.span().ptr, .{ .iterate = true }) catch
            return error.FileNotFound;
    };
    defer dir.close();

    // Add wildcard and null-terminator
    try app_buf.append(allocator, '*');
    try app_buf.append(allocator, 0);
    const app_name_wildcard = app_buf.items[0 .. app_buf.items.len - 1 :0];

    // This 2048 is arbitrary, we just want it to be large enough to get multiple FILE_DIRECTORY_INFORMATION entries
    // returned per NtQueryDirectoryFile call.
    var file_information_buf: [2048]u8 align(@alignOf(os.windows.FILE_DIRECTORY_INFORMATION)) = undefined;
    const file_info_maximum_single_entry_size = @sizeOf(windows.FILE_DIRECTORY_INFORMATION) + (windows.NAME_MAX * 2);
    if (file_information_buf.len < file_info_maximum_single_entry_size) {
        @compileError("file_information_buf must be large enough to contain at least one maximum size FILE_DIRECTORY_INFORMATION entry");
    }
    var io_status: windows.IO_STATUS_BLOCK = undefined;

    const num_supported_pathext = @typeInfo(CreateProcessSupportedExtension).Enum.fields.len;
    var pathext_seen = [_]bool{false} ** num_supported_pathext;
    var any_pathext_seen = false;
    var unappended_exists = false;

    // Fully iterate the wildcard matches via NtQueryDirectoryFile and take note of all versions
    // of the app_name we should try to spawn.
    // Note: This is necessary because the order of the files returned is filesystem-dependent:
    //       On NTFS, `blah.exe*` will always return `blah.exe` first if it exists.
    //       On FAT32, it's possible for something like `blah.exe.obj` to be returned first.
    while (true) {
        const app_name_len_bytes = math.cast(u16, app_name_wildcard.len * 2) orelse return error.NameTooLong;
        var app_name_unicode_string = windows.UNICODE_STRING{
            .Length = app_name_len_bytes,
            .MaximumLength = app_name_len_bytes,
            .Buffer = @constCast(app_name_wildcard.ptr),
        };
        const rc = windows.ntdll.NtQueryDirectoryFile(
            dir.fd,
            null,
            null,
            null,
            &io_status,
            &file_information_buf,
            file_information_buf.len,
            .FileDirectoryInformation,
            windows.FALSE, // single result
            &app_name_unicode_string,
            windows.FALSE, // restart iteration
        );

        // If we get nothing with the wildcard, then we can just bail out
        // as we know appending PATHEXT will not yield anything.
        switch (rc) {
            .SUCCESS => {},
            .NO_SUCH_FILE => return error.FileNotFound,
            .NO_MORE_FILES => break,
            .ACCESS_DENIED => return error.AccessDenied,
            else => return windows.unexpectedStatus(rc),
        }

        // According to the docs, this can only happen if there is not enough room in the
        // buffer to write at least one complete FILE_DIRECTORY_INFORMATION entry.
        // Therefore, this condition should not be possible to hit with the buffer size we use.
        std.debug.assert(io_status.Information != 0);

        var it = windows.FileInformationIterator(windows.FILE_DIRECTORY_INFORMATION){ .buf = &file_information_buf };
        while (it.next()) |info| {
            // Skip directories
            if (info.FileAttributes & windows.FILE_ATTRIBUTE_DIRECTORY != 0) continue;
            const filename = @as([*]u16, @ptrCast(&info.FileName))[0 .. info.FileNameLength / 2];
            // Because all results start with the app_name since we're using the wildcard `app_name*`,
            // if the length is equal to app_name then this is an exact match
            if (filename.len == app_name_len) {
                // Note: We can't break early here because it's possible that the unappended version
                //       fails to spawn, in which case we still want to try the PATHEXT appended versions.
                unappended_exists = true;
            } else if (windowsCreateProcessSupportsExtension(filename[app_name_len..])) |pathext_ext| {
                pathext_seen[@intFromEnum(pathext_ext)] = true;
                any_pathext_seen = true;
            }
        }
    }

    const unappended_err = unappended: {
        if (unappended_exists) {
            if (dir_path_len != 0) switch (dir_buf.items[dir_buf.items.len - 1]) {
                '/', '\\' => {},
                else => try dir_buf.append(allocator, fs.path.sep),
            };
            try dir_buf.appendSlice(allocator, app_buf.items[0..app_name_len]);
            try dir_buf.append(allocator, 0);
            const full_app_name = dir_buf.items[0 .. dir_buf.items.len - 1 :0];

            if (windowsCreateProcess(full_app_name.ptr, cmd_line, envp_ptr, cwd_ptr, lpStartupInfo, lpProcessInformation)) |_| {
                return;
            } else |err| switch (err) {
                error.FileNotFound,
                error.AccessDenied,
                => break :unappended err,
                error.InvalidExe => {
                    // On InvalidExe, if the extension of the app name is .exe then
                    // it's treated as an unrecoverable error. Otherwise, it'll be
                    // skipped as normal.
                    const app_name = app_buf.items[0..app_name_len];
                    const ext_start = std.mem.lastIndexOfScalar(u16, app_name, '.') orelse break :unappended err;
                    const ext = app_name[ext_start..];
                    if (windows.eqlIgnoreCaseWTF16(ext, unicode.utf8ToUtf16LeStringLiteral(".EXE"))) {
                        return error.UnrecoverableInvalidExe;
                    }
                    break :unappended err;
                },
                else => return err,
            }
        }
        break :unappended error.FileNotFound;
    };

    if (!any_pathext_seen) return unappended_err;

    // Now try any PATHEXT appended versions that we've seen
    var ext_it = mem.tokenizeScalar(u16, pathext, ';');
    while (ext_it.next()) |ext| {
        const ext_enum = windowsCreateProcessSupportsExtension(ext) orelse continue;
        if (!pathext_seen[@intFromEnum(ext_enum)]) continue;

        dir_buf.shrinkRetainingCapacity(dir_path_len);
        if (dir_path_len != 0) switch (dir_buf.items[dir_buf.items.len - 1]) {
            '/', '\\' => {},
            else => try dir_buf.append(allocator, fs.path.sep),
        };
        try dir_buf.appendSlice(allocator, app_buf.items[0..app_name_len]);
        try dir_buf.appendSlice(allocator, ext);
        try dir_buf.append(allocator, 0);
        const full_app_name = dir_buf.items[0 .. dir_buf.items.len - 1 :0];

        if (windowsCreateProcess(full_app_name.ptr, cmd_line, envp_ptr, cwd_ptr, lpStartupInfo, lpProcessInformation)) |_| {
            return;
        } else |err| switch (err) {
            error.FileNotFound => continue,
            error.AccessDenied => continue,
            error.InvalidExe => {
                // On InvalidExe, if the extension of the app name is .exe then
                // it's treated as an unrecoverable error. Otherwise, it'll be
                // skipped as normal.
                if (windows.eqlIgnoreCaseWTF16(ext, unicode.utf8ToUtf16LeStringLiteral(".EXE"))) {
                    return error.UnrecoverableInvalidExe;
                }
                continue;
            },
            else => return err,
        }
    }

    return unappended_err;
}

// Should be kept in sync with `windowsCreateProcessSupportsExtension`
const CreateProcessSupportedExtension = enum {
    bat,
    cmd,
    com,
    exe,
};

/// Case-insensitive UTF-16 lookup
fn windowsCreateProcessSupportsExtension(ext: []const u16) ?CreateProcessSupportedExtension {
    if (ext.len != 4) return null;
    const State = enum {
        start,
        dot,
        b,
        ba,
        c,
        cm,
        co,
        e,
        ex,
    };
    var state: State = .start;
    for (ext) |c| switch (state) {
        .start => switch (c) {
            '.' => state = .dot,
            else => return null,
        },
        .dot => switch (c) {
            'b', 'B' => state = .b,
            'c', 'C' => state = .c,
            'e', 'E' => state = .e,
            else => return null,
        },
        .b => switch (c) {
            'a', 'A' => state = .ba,
            else => return null,
        },
        .c => switch (c) {
            'm', 'M' => state = .cm,
            'o', 'O' => state = .co,
            else => return null,
        },
        .e => switch (c) {
            'x', 'X' => state = .ex,
            else => return null,
        },
        .ba => switch (c) {
            't', 'T' => return .bat,
            else => return null,
        },
        .cm => switch (c) {
            'd', 'D' => return .cmd,
            else => return null,
        },
        .co => switch (c) {
            'm', 'M' => return .com,
            else => return null,
        },
        .ex => switch (c) {
            'e', 'E' => return .exe,
            else => return null,
        },
    };
    return null;
}

fn windowsCreateProcess(app_name: [*:0]u16, cmd_line: [*:0]u16, envp_ptr: ?[*]u16, cwd_ptr: ?[*:0]u16, lpStartupInfo: *windows.STARTUPINFOW, lpProcessInformation: *windows.PROCESS_INFORMATION) !void {
    // TODO the docs for environment pointer say:
    // > A pointer to the environment block for the new process. If this parameter
    // > is NULL, the new process uses the environment of the calling process.
    // > ...
    // > An environment block can contain either Unicode or ANSI characters. If
    // > the environment block pointed to by lpEnvironment contains Unicode
    // > characters, be sure that dwCreationFlags includes CREATE_UNICODE_ENVIRONMENT.
    // > If this parameter is NULL and the environment block of the parent process
    // > contains Unicode characters, you must also ensure that dwCreationFlags
    // > includes CREATE_UNICODE_ENVIRONMENT.
    // This seems to imply that we have to somehow know whether our process parent passed
    // CREATE_UNICODE_ENVIRONMENT if we want to pass NULL for the environment parameter.
    // Since we do not know this information that would imply that we must not pass NULL
    // for the parameter.
    // However this would imply that programs compiled with -DUNICODE could not pass
    // environment variables to programs that were not, which seems unlikely.
    // More investigation is needed.
    return windows.CreateProcessW(
        app_name,
        cmd_line,
        null,
        null,
        windows.TRUE,
        windows.CREATE_UNICODE_ENVIRONMENT,
        @as(?*anyopaque, @ptrCast(envp_ptr)),
        cwd_ptr,
        lpStartupInfo,
        lpProcessInformation,
    );
}
