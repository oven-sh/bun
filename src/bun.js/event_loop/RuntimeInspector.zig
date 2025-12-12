/// Runtime Inspector Activation Handler
///
/// Activates the inspector/debugger at runtime via `process._debugProcess(pid)`.
///
/// On POSIX (macOS/Linux):
///   - Signal handler sets atomic flag and wakes event loop
///   - Main thread checks flag on event loop tick and activates inspector
///   - Usage: `kill -USR1 <pid>` to start debugger
///
/// On Windows:
///   - Uses named file mapping mechanism (same as Node.js)
///   - Creates "bun-debug-handler-<pid>" shared memory with function pointer
///   - External tools use CreateRemoteThread() to call that function
///   - Usage: `process._debugProcess(pid)` from another Bun/Node process
///
const RuntimeInspector = @This();

const log = Output.scoped(.RuntimeInspector, .hidden);

const inspector_port = "6499";

var installed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var inspector_activation_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

fn requestInspectorActivation() void {
    const vm = VirtualMachine.getMainThreadVM() orelse {
        log("No main thread VM available", .{});
        return;
    };

    inspector_activation_requested.store(true, .release);
    vm.eventLoop().wakeup();
}

/// Called from main thread during event loop tick.
pub fn checkAndActivateInspector(vm: *VirtualMachine) void {
    if (!inspector_activation_requested.swap(false, .acq_rel)) {
        return;
    }

    log("Processing inspector activation request on main thread", .{});

    if (vm.is_shutting_down) {
        log("VM is shutting down, ignoring inspector activation request", .{});
        return;
    }

    if (vm.debugger != null) {
        log("Debugger already active", .{});
        return;
    }

    activateInspector(vm) catch |err| {
        Output.prettyErrorln("Failed to activate inspector: {s}\n", .{@errorName(err)});
        Output.flush();
    };
}

fn activateInspector(vm: *VirtualMachine) !void {
    log("Activating inspector", .{});

    vm.debugger = .{
        .path_or_port = inspector_port,
        .from_environment_variable = "",
        .wait_for_connection = .off,
        .set_breakpoint_on_first_line = false,
        .mode = .listen,
    };

    vm.transpiler.options.minify_identifiers = false;
    vm.transpiler.options.minify_syntax = false;
    vm.transpiler.options.minify_whitespace = false;
    vm.transpiler.options.debugger = true;

    try Debugger.create(vm, vm.global);

    Output.prettyErrorln(
        \\Debugger listening on ws://127.0.0.1:{s}/
        \\For help, see: https://bun.com/docs/runtime/debugger
        \\
    , .{inspector_port});
    Output.flush();
}

pub fn isInstalled() bool {
    return installed.load(.acquire);
}

const posix = if (Environment.isPosix) struct {
    fn handleSigusr1(_: c_int) callconv(.c) void {
        inspector_activation_requested.store(true, .release);

        if (VirtualMachine.getMainThreadVM()) |vm| {
            vm.eventLoop().wakeup();
        }
    }

    fn install() bool {
        log("Installing SIGUSR1 handler", .{});

        const act = std.posix.Sigaction{
            .handler = .{ .handler = handleSigusr1 },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.USR1, &act, null);

        log("SIGUSR1 handler installed successfully", .{});
        return true;
    }

    fn uninstallInternal(restore_default_handler: bool) void {
        log("Uninstalling SIGUSR1 handler", .{});

        if (restore_default_handler) {
            const act = std.posix.Sigaction{
                .handler = .{ .handler = std.posix.SIG.DFL },
                .mask = std.posix.sigemptyset(),
                .flags = 0,
            };
            std.posix.sigaction(std.posix.SIG.USR1, &act, null);
        }

        log("SIGUSR1 handler uninstalled", .{});
    }
} else struct {};

const windows = if (Environment.isWindows) struct {
    const win32 = std.os.windows;
    const HANDLE = win32.HANDLE;
    const DWORD = win32.DWORD;
    const BOOL = win32.BOOL;
    const LPVOID = *anyopaque;
    const LPCWSTR = [*:0]const u16;
    const SIZE_T = usize;
    const INVALID_HANDLE_VALUE = win32.INVALID_HANDLE_VALUE;

    const SECURITY_ATTRIBUTES = extern struct {
        nLength: DWORD,
        lpSecurityDescriptor: ?LPVOID,
        bInheritHandle: BOOL,
    };

    const PAGE_READWRITE: DWORD = 0x04;
    const FILE_MAP_ALL_ACCESS: DWORD = 0xF001F;

    const LPTHREAD_START_ROUTINE = *const fn (?LPVOID) callconv(.winapi) DWORD;

    extern "kernel32" fn CreateFileMappingW(
        hFile: HANDLE,
        lpFileMappingAttributes: ?*SECURITY_ATTRIBUTES,
        flProtect: DWORD,
        dwMaximumSizeHigh: DWORD,
        dwMaximumSizeLow: DWORD,
        lpName: ?LPCWSTR,
    ) callconv(.winapi) ?HANDLE;

    extern "kernel32" fn MapViewOfFile(
        hFileMappingObject: HANDLE,
        dwDesiredAccess: DWORD,
        dwFileOffsetHigh: DWORD,
        dwFileOffsetLow: DWORD,
        dwNumberOfBytesToMap: SIZE_T,
    ) callconv(.winapi) ?LPVOID;

    extern "kernel32" fn UnmapViewOfFile(
        lpBaseAddress: LPVOID,
    ) callconv(.winapi) BOOL;

    extern "kernel32" fn GetCurrentProcessId() callconv(.winapi) DWORD;

    var mapping_handle: ?HANDLE = null;

    /// Called from the remote thread created by CreateRemoteThread from another process.
    /// This function must be safe to call from an arbitrary thread context.
    fn startDebugThreadProc(_: ?LPVOID) callconv(.winapi) DWORD {
        log("Remote debug thread started", .{});
        requestInspectorActivation();
        return 0;
    }

    fn install() bool {
        log("Installing Windows debug handler", .{});

        const pid = GetCurrentProcessId();

        // Create mapping name: "bun-debug-handler-<pid>"
        var mapping_name_buf: [64]u8 = undefined;
        const name_slice = std.fmt.bufPrint(&mapping_name_buf, "bun-debug-handler-{d}", .{pid}) catch {
            log("Failed to format mapping name", .{});
            return false;
        };

        // Convert to wide string (null-terminated)
        var wide_name: [64]u16 = undefined;
        const wide_name_z = bun.strings.toWPath(&wide_name, name_slice);

        // Create file mapping
        mapping_handle = CreateFileMappingW(
            INVALID_HANDLE_VALUE,
            null,
            PAGE_READWRITE,
            0,
            @sizeOf(LPTHREAD_START_ROUTINE),
            wide_name_z.ptr,
        );

        if (mapping_handle) |handle| {
            // Map view and store function pointer
            const handler_ptr = MapViewOfFile(
                handle,
                FILE_MAP_ALL_ACCESS,
                0,
                0,
                @sizeOf(LPTHREAD_START_ROUTINE),
            );

            if (handler_ptr) |ptr| {
                // Store our function pointer in the shared memory
                const typed_ptr: *LPTHREAD_START_ROUTINE = @ptrCast(@alignCast(ptr));
                typed_ptr.* = &startDebugThreadProc;
                _ = UnmapViewOfFile(ptr);
                log("Windows debug handler installed successfully (pid={d})", .{pid});
                return true;
            } else {
                log("Failed to map view of file", .{});
                _ = bun.windows.CloseHandle(handle);
                mapping_handle = null;
                return false;
            }
        } else {
            log("Failed to create file mapping", .{});
            return false;
        }
    }

    fn uninstallInternal() void {
        log("Uninstalling Windows debug handler", .{});

        if (mapping_handle) |handle| {
            _ = bun.windows.CloseHandle(handle);
            mapping_handle = null;
        }

        log("Windows debug handler uninstalled", .{});
    }
} else struct {};

/// Install the runtime inspector handler.
/// Safe to call multiple times - subsequent calls are no-ops.
pub fn installIfNotAlready() void {
    if (installed.swap(true, .acq_rel)) {
        return;
    }

    const success = if (comptime Environment.isPosix)
        posix.install()
    else if (comptime Environment.isWindows)
        windows.install()
    else
        false;

    if (!success) {
        installed.store(false, .release);
    }
}

/// Uninstall the handler and clean up resources.
pub fn uninstall() void {
    if (comptime Environment.isPosix) {
        uninstallInternal(true);
    } else if (comptime Environment.isWindows) {
        uninstallInternal(false);
    }
}

/// Uninstall when a user SIGUSR1 listener takes over (POSIX only).
/// Does NOT reset the signal handler since BunProcess.cpp already installed forwardSignal.
pub fn uninstallForUserHandler() void {
    if (comptime Environment.isPosix) {
        uninstallInternal(false);
    }
}

fn uninstallInternal(restore_default_handler: bool) void {
    if (!installed.swap(false, .acq_rel)) {
        return;
    }

    if (comptime Environment.isPosix) {
        posix.uninstallInternal(restore_default_handler);
    } else if (comptime Environment.isWindows) {
        windows.uninstallInternal();
    }
}

export fn Bun__onSigusr1Signal(sig: c_int) void {
    if (comptime Environment.isPosix) {
        posix.handleSigusr1(sig);
    }
}

/// Called from C++ when user adds a SIGUSR1 listener
export fn Bun__Sigusr1Handler__uninstall() void {
    uninstallForUserHandler();
}

comptime {
    if (Environment.isPosix) {
        _ = Bun__onSigusr1Signal;
        _ = Bun__Sigusr1Handler__uninstall;
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const jsc = bun.jsc;
const Debugger = jsc.Debugger;
const VirtualMachine = jsc.VirtualMachine;
