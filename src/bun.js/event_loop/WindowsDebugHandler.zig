/// Windows Debug Handler for Runtime Inspector Activation
///
/// On Windows, there's no SIGUSR1 signal. Instead, we use the same mechanism as Node.js:
/// 1. Create a named file mapping: "bun-debug-handler-<pid>"
/// 2. Store a function pointer in shared memory
/// 3. External tools can use CreateRemoteThread() to call that function
///
/// Usage: `process._debugProcess(pid)` from another Bun/Node process
const WindowsDebugHandler = @This();

const log = Output.scoped(.WindowsDebugHandler, .hidden);

const inspector_port = "6499";

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
const FILE_MAP_READ: DWORD = 0x0004;

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
var installed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var inspector_activation_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

/// Called from the remote thread created by CreateRemoteThread from another process.
/// This function must be safe to call from an arbitrary thread context.
fn startDebugThreadProc(_: ?LPVOID) callconv(.winapi) DWORD {
    log("Remote debug thread started", .{});
    requestInspectorActivation();
    return 0;
}

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
    log("Activating inspector from Windows debug handler", .{});

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

/// Install the Windows debug handler by creating a named file mapping.
/// Safe to call multiple times - subsequent calls are no-ops.
pub fn installIfNotAlready() void {
    if (comptime !Environment.isWindows) {
        return;
    }

    if (installed.swap(true, .acq_rel)) {
        return;
    }

    log("Installing Windows debug handler", .{});

    const pid = GetCurrentProcessId();

    // Create mapping name: "bun-debug-handler-<pid>"
    var mapping_name_buf: [64]u8 = undefined;
    const name_slice = std.fmt.bufPrint(&mapping_name_buf, "bun-debug-handler-{d}", .{pid}) catch {
        log("Failed to format mapping name", .{});
        installed.store(false, .release);
        return;
    };

    // Convert to wide string (null-terminated)
    var wide_name: [64:0]u16 = undefined;
    const wide_len = std.unicode.utf8ToUtf16Le(&wide_name, name_slice) catch {
        log("Failed to convert mapping name to wide string", .{});
        installed.store(false, .release);
        return;
    };
    wide_name[wide_len] = 0;

    // Create file mapping
    mapping_handle = CreateFileMappingW(
        INVALID_HANDLE_VALUE,
        null,
        PAGE_READWRITE,
        0,
        @sizeOf(LPTHREAD_START_ROUTINE),
        &wide_name,
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
        } else {
            log("Failed to map view of file", .{});
            _ = bun.windows.CloseHandle(handle);
            mapping_handle = null;
            installed.store(false, .release);
        }
    } else {
        log("Failed to create file mapping", .{});
        installed.store(false, .release);
    }
}

/// Uninstall the handler and clean up resources.
pub fn uninstall() void {
    if (comptime !Environment.isWindows) {
        return;
    }

    if (!installed.swap(false, .acq_rel)) {
        return;
    }

    log("Uninstalling Windows debug handler", .{});

    if (mapping_handle) |handle| {
        _ = bun.windows.CloseHandle(handle);
        mapping_handle = null;
    }

    log("Windows debug handler uninstalled", .{});
}

pub fn isInstalled() bool {
    return installed.load(.acquire);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const jsc = bun.jsc;
const Debugger = jsc.Debugger;
const VirtualMachine = jsc.VirtualMachine;
