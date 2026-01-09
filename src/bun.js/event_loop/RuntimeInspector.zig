/// Runtime Inspector Activation Handler
///
/// Activates the inspector/debugger at runtime via `process._debugProcess(pid)`.
///
/// On POSIX (macOS/Linux):
///   - A "SignalInspector" thread sleeps on a semaphore
///   - SIGUSR1 handler runs on the main thread but in signal context (only
///     async-signal-safe functions allowed), posts to the semaphore
///   - SignalInspector thread wakes in normal context, fires JSC debugger trap
///   - Main thread checks flag on next tick and activates the inspector
///   - Usage: `kill -USR1 <pid>` to start debugger
///
/// On Windows:
///   - Uses named file mapping mechanism (same as Node.js)
///   - Creates "bun-debug-handler-<pid>" shared memory with function pointer
///   - External tools use CreateRemoteThread() to call that function
///   - The remote thread is already in normal context, so can call JSC APIs directly
///   - Usage: `process._debugProcess(pid)` from another Bun/Node process
///
/// Why a dedicated thread? Signal handlers can only call async-signal-safe functions.
/// JSC's notifyNeedDebuggerBreak() is NOT async-signal-safe. The dedicated thread
/// provides a normal execution context from which we can safely call JSC APIs.
/// This is the same approach Node.js uses (see inspector_agent.cc).
///
const RuntimeInspector = @This();

const log = Output.scoped(.RuntimeInspector, .hidden);

/// Default port for runtime-activated inspector (via SIGUSR1/process._debugProcess).
/// Note: If this port is already in use, activation will fail with an error message.
/// This matches Node.js behavior where SIGUSR1-activated inspectors also use a fixed
/// port (9229). Users can pre-configure a different port using --inspect-port=<port>
/// or --inspect=0 for automatic port selection when starting the process.
const inspector_port = "6499";

var installed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var inspector_activation_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

/// Called from the dedicated SignalInspector thread (POSIX) or remote thread (Windows).
/// This runs in normal thread context, so it's safe to call JSC APIs.
fn requestInspectorActivation() void {
    const vm = VirtualMachine.getMainThreadVM() orelse return;

    inspector_activation_requested.store(true, .release);

    // Fire a JSC trap to interrupt JavaScript execution, even in infinite loops.
    // Safe to call from another thread (see VMTraps.h in JSC).
    vm.jsc_vm.notifyNeedDebuggerBreak();

    // Also wake the event loop in case JS is waiting on I/O
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

    // Check if debugger is already active (prevents double activation via SIGUSR1)
    if (vm.debugger != null) {
        log("Debugger already active, ignoring SIGUSR1", .{});
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
}

pub fn isInstalled() bool {
    return installed.load(.acquire);
}

const posix = if (Environment.isPosix) struct {
    var semaphore: ?Semaphore = null;
    var thread: ?std.Thread = null;
    var shutting_down: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

    fn signalHandler(_: c_int) callconv(.c) void {
        // Signal handlers can only call async-signal-safe functions.
        // Semaphore.post() is async-signal-safe (uses Mach semaphores on macOS,
        // POSIX semaphores on Linux).
        if (semaphore) |sem| _ = sem.post();
    }

    /// Dedicated thread that waits on the semaphore.
    /// When woken, it calls requestInspectorActivation() in normal thread context.
    fn signalInspectorThread() void {
        Output.Source.configureNamedThread("SignalInspector");

        while (true) {
            _ = semaphore.?.wait();
            if (shutting_down.load(.acquire)) {
                log("SignalInspector thread exiting", .{});
                return;
            }
            log("SignalInspector thread woke, activating inspector", .{});
            requestInspectorActivation();
        }
    }

    fn install() bool {
        semaphore = Semaphore.init() orelse {
            log("semaphore init failed", .{});
            return false;
        };

        // Spawn the SignalInspector thread
        thread = std.Thread.spawn(.{
            .stack_size = 512 * 1024,
        }, signalInspectorThread, .{}) catch |err| {
            log("thread spawn failed: {s}", .{@errorName(err)});
            return false;
        };

        // Install SIGUSR1 handler
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = signalHandler },
            .mask = std.posix.sigemptyset(),
            .flags = std.posix.SA.RESTART,
        };
        std.posix.sigaction(std.posix.SIG.USR1, &act, null);
        return true;
    }

    fn uninstall() void {
        // Signal the thread to exit. We don't join because:
        // 1. This is called from JS context (process.on('SIGUSR1', ...))
        // 2. Blocking the JS thread is bad
        // 3. The thread will exit on its own after checking shutting_down
        // The thread and semaphore are "leaked" and anyway this happens once
        // per process lifetime when user installs their own SIGUSR1 handler
        shutting_down.store(true, .release);
        if (semaphore) |sem| _ = sem.post();
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
                // MapViewOfFile returns page-aligned memory, which satisfies
                // the alignment requirements for function pointers.
                const typed_ptr: *LPTHREAD_START_ROUTINE = @ptrCast(@alignCast(ptr));
                typed_ptr.* = &startDebugThreadProc;
                _ = UnmapViewOfFile(ptr);
                return true;
            } else {
                log("MapViewOfFile failed", .{});
                _ = bun.windows.CloseHandle(handle);
                mapping_handle = null;
                return false;
            }
        } else {
            log("CreateFileMappingW failed for bun-debug-handler-{d}", .{pid});
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

/// Set SIGUSR1 to default action when --disable-sigusr1 is used.
/// This allows SIGUSR1 to use its default behavior (terminate process).
pub fn setDefaultSigusr1Action() void {
    if (comptime Environment.isPosix) {
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.DFL },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.USR1, &act, null);
    }
}

/// Ignore SIGUSR1 when debugger is already enabled via CLI flags.
/// This prevents SIGUSR1 from terminating the process when the user is already debugging.
pub fn ignoreSigusr1() void {
    if (comptime Environment.isPosix) {
        var act: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.IGN },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.USR1, &act, null);
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

const Semaphore = @import("../../sync/Semaphore.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const jsc = bun.jsc;
const Debugger = jsc.Debugger;
const VirtualMachine = jsc.VirtualMachine;
