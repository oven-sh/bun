/// SIGUSR1 Handler for Runtime Inspector Activation
///
/// Activates the inspector/debugger at runtime via SIGUSR1, matching Node.js behavior.
/// Uses a watcher thread pattern: signal handler does semaphore post, watcher thread
/// safely activates the inspector on the main thread.
///
/// Usage: `kill -USR1 <pid>` to start debugger on port 6499
const Sigusr1Handler = @This();

const log = Output.scoped(.Sigusr1Handler, .hidden);

const inspector_port = "6499";

/// Platform-specific semaphore for async-signal-safe signaling.
/// Uses Mach semaphores on macOS, POSIX sem_t on Linux.
const Semaphore = if (Environment.isMac) MachSemaphore else PosixSemaphore;

const MachSemaphore = struct {
    sem: mach.semaphore_t = undefined,

    const mach = struct {
        const mach_port_t = std.c.mach_port_t;
        const semaphore_t = mach_port_t;
        const kern_return_t = c_int;
        const KERN_SUCCESS: kern_return_t = 0;
        const KERN_ABORTED: kern_return_t = 14;

        extern "c" fn semaphore_create(task: mach_port_t, semaphore: *semaphore_t, policy: c_int, value: c_int) kern_return_t;
        extern "c" fn semaphore_destroy(task: mach_port_t, semaphore: semaphore_t) kern_return_t;
        extern "c" fn semaphore_signal(semaphore: semaphore_t) kern_return_t;
        extern "c" fn semaphore_wait(semaphore: semaphore_t) kern_return_t;
    };

    const SYNC_POLICY_FIFO = 0;

    fn init(self: *MachSemaphore) bool {
        return mach.semaphore_create(std.c.mach_task_self(), &self.sem, SYNC_POLICY_FIFO, 0) == mach.KERN_SUCCESS;
    }

    fn deinit(self: *MachSemaphore) void {
        _ = mach.semaphore_destroy(std.c.mach_task_self(), self.sem);
    }

    fn post(self: *MachSemaphore) void {
        _ = mach.semaphore_signal(self.sem);
    }

    fn wait(self: *MachSemaphore) void {
        while (true) {
            const result = mach.semaphore_wait(self.sem);
            if (result != mach.KERN_ABORTED) break;
        }
    }
};

const PosixSemaphore = struct {
    sem: std.c.sem_t = undefined,

    fn init(self: *PosixSemaphore) bool {
        return std.c.sem_init(&self.sem, 0, 0) == 0;
    }

    fn deinit(self: *PosixSemaphore) void {
        _ = std.c.sem_destroy(&self.sem);
    }

    fn post(self: *PosixSemaphore) void {
        _ = std.c.sem_post(&self.sem);
    }

    fn wait(self: *PosixSemaphore) void {
        while (true) {
            const result = std.c.sem_wait(&self.sem);
            if (result == 0) break;
            if (std.c._errno().* != @intFromEnum(std.posix.E.INTR)) break;
        }
    }
};

var semaphore: Semaphore = .{};
var installed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var watcher_thread: ?std.Thread = null;
var inspector_activation_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

/// Signal handler - async-signal-safe. Only does semaphore post.
fn onSigusr1Signal(_: c_int) callconv(.c) void {
    semaphore.post();
}

export fn Bun__onSigusr1Signal(sig: c_int) void {
    onSigusr1Signal(sig);
}

fn watcherThreadMain() void {
    Output.Source.configureNamedThread("Sigusr1Watcher");
    log("Watcher thread started", .{});

    while (installed.load(.acquire)) {
        semaphore.wait();

        if (!installed.load(.acquire)) {
            log("Watcher thread shutting down", .{});
            break;
        }

        log("Watcher thread woken by SIGUSR1", .{});
        requestInspectorActivation();
    }

    log("Watcher thread exited", .{});
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
        Output.prettyErrorln("Failed to activate inspector on SIGUSR1: {s}\n", .{@errorName(err)});
        Output.flush();
    };
}

fn activateInspector(vm: *VirtualMachine) !void {
    log("Activating inspector from SIGUSR1", .{});

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

/// Install the SIGUSR1 signal handler and start the watcher thread.
/// Safe to call multiple times - subsequent calls are no-ops.
pub fn installIfNotAlready() void {
    if (comptime !Environment.isPosix) {
        return;
    }

    if (installed.swap(true, .acq_rel)) {
        return;
    }

    log("Installing SIGUSR1 handler with watcher thread", .{});

    if (!semaphore.init()) {
        log("Failed to initialize semaphore", .{});
        installed.store(false, .release);
        return;
    }

    watcher_thread = std.Thread.spawn(.{
        .stack_size = 128 * 1024,
    }, watcherThreadMain, .{}) catch |err| {
        log("Failed to spawn watcher thread: {s}", .{@errorName(err)});
        semaphore.deinit();
        installed.store(false, .release);
        return;
    };

    const act = std.posix.Sigaction{
        .handler = .{ .handler = onSigusr1Signal },
        .mask = std.posix.sigemptyset(),
        .flags = 0,
    };
    std.posix.sigaction(std.posix.SIG.USR1, &act, null);

    log("SIGUSR1 handler installed successfully", .{});
}

/// Uninstall the handler and stop the watcher thread.
pub fn uninstall() void {
    uninstallInternal(true);
}

/// Uninstall when a user SIGUSR1 listener takes over.
/// Does NOT reset the signal handler since BunProcess.cpp already installed forwardSignal.
pub fn uninstallForUserHandler() void {
    uninstallInternal(false);
}

fn uninstallInternal(restore_default_handler: bool) void {
    if (comptime !Environment.isPosix) {
        return;
    }

    if (!installed.swap(false, .acq_rel)) {
        return;
    }

    log("Uninstalling SIGUSR1 handler", .{});

    semaphore.post();

    if (watcher_thread) |thread| {
        thread.join();
        watcher_thread = null;
    }

    semaphore.deinit();

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

pub fn isInstalled() bool {
    return installed.load(.acquire);
}

pub fn triggerForTesting() void {
    semaphore.post();
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
