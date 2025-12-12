/// Runtime Inspector Activation Handler
///
/// Activates the inspector/debugger at runtime via `process._debugProcess(pid)`.
///
/// On POSIX (macOS/Linux):
///   - Dedicated thread waits for SIGUSR1 using sigwait()
///   - When signal arrives, sets atomic flag and wakes event loop
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
    var signal_thread: ?std.Thread = null;

    fn signalThreadMain() void {
        Output.Source.configureNamedThread("SIGUSR1");

        var set = std.posix.sigemptyset();
        std.posix.sigaddset(&set, std.posix.SIG.USR1);

        while (installed.load(.acquire)) {
            var sig: c_int = 0;
            _ = std.c.sigwait(&set, &sig);

            if (sig != std.posix.SIG.USR1) continue;
            if (!installed.load(.acquire)) break;

            requestInspectorActivation();
        }
    }

    fn install() bool {
        var set = std.posix.sigemptyset();
        std.posix.sigaddset(&set, std.posix.SIG.USR1);
        std.posix.sigprocmask(std.posix.SIG.BLOCK, &set, null);

        signal_thread = std.Thread.spawn(.{
            .stack_size = 128 * 1024,
        }, signalThreadMain, .{}) catch {
            std.posix.sigprocmask(std.posix.SIG.UNBLOCK, &set, null);
            return false;
        };

        return true;
    }

    fn uninstall() void {
        if (signal_thread) |thread| {
            std.posix.kill(std.c.getpid(), std.posix.SIG.USR1) catch {};
            thread.join();
            signal_thread = null;
        }

        // Unblock SIGUSR1 so user handlers can receive it
        var set = std.posix.sigemptyset();
        std.posix.sigaddset(&set, std.posix.SIG.USR1);
        std.posix.sigprocmask(std.posix.SIG.UNBLOCK, &set, null);
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

    /// Called via CreateRemoteThread from another process.
    fn startDebugThreadProc(_: ?LPVOID) callconv(.winapi) DWORD {
        requestInspectorActivation();
        return 0;
    }

    fn install() bool {
        const pid = GetCurrentProcessId();

        var mapping_name_buf: [64]u8 = undefined;
        const name_slice = std.fmt.bufPrint(&mapping_name_buf, "bun-debug-handler-{d}", .{pid}) catch return false;

        var wide_name: [64]u16 = undefined;
        const wide_name_z = bun.strings.toWPath(&wide_name, name_slice);

        mapping_handle = CreateFileMappingW(
            INVALID_HANDLE_VALUE,
            null,
            PAGE_READWRITE,
            0,
            @sizeOf(LPTHREAD_START_ROUTINE),
            wide_name_z.ptr,
        );

        if (mapping_handle) |handle| {
            const handler_ptr = MapViewOfFile(
                handle,
                FILE_MAP_ALL_ACCESS,
                0,
                0,
                @sizeOf(LPTHREAD_START_ROUTINE),
            );

            if (handler_ptr) |ptr| {
                const typed_ptr: *LPTHREAD_START_ROUTINE = @ptrCast(@alignCast(ptr));
                typed_ptr.* = &startDebugThreadProc;
                _ = UnmapViewOfFile(ptr);
                return true;
            } else {
                _ = bun.windows.CloseHandle(handle);
                mapping_handle = null;
                return false;
            }
        } else {
            return false;
        }
    }

    fn uninstall() void {
        if (mapping_handle) |handle| {
            _ = bun.windows.CloseHandle(handle);
            mapping_handle = null;
        }
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

/// Uninstall when a user SIGUSR1 listener takes over (POSIX only).
pub fn uninstallForUserHandler() void {
    if (!installed.swap(false, .acq_rel)) {
        return;
    }

    if (comptime Environment.isPosix) {
        posix.uninstall();
    }
}

/// Called from C++ when user adds a SIGUSR1 listener
export fn Bun__Sigusr1Handler__uninstall() void {
    uninstallForUserHandler();
}

comptime {
    if (Environment.isPosix) {
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
