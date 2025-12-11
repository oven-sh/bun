/// SIGUSR1 Handler for Runtime Inspector Activation
///
/// Activates the inspector/debugger at runtime via SIGUSR1, matching Node.js behavior.
/// Uses a watcher thread pattern: signal handler does sem_post(), watcher thread
/// safely activates the inspector on the main thread.
///
/// Usage: `kill -USR1 <pid>` to start debugger on port 6499
const Sigusr1Handler = @This();

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
const Debugger = jsc.Debugger;

const log = Output.scoped(.Sigusr1Handler, .hidden);

var semaphore: std.Thread.Semaphore = .{};
var installed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var signal_pending: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var watcher_thread: ?std.Thread = null;
var inspector_activation_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

/// Signal handler - MUST be async-signal-safe. Only does sem_post().
fn onSigusr1Signal(_: c_int) callconv(.c) void {
    if (!signal_pending.swap(true, .acq_rel)) {
        semaphore.post();
    }
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

        signal_pending.store(false, .release);
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

    if (vm.debugger != null) {
        log("Debugger already active, ignoring SIGUSR1", .{});
        return;
    }

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
        .path_or_port = "6499", // TODO(@alii): Find a port?
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
        \\Debugger listening on ws://127.0.0.1:6499/
        \\For help, see: https://bun.com/docs/runtime/debugger
        \\
    , .{});
    Output.flush();
}

/// Install the SIGUSR1 signal handler and start the watcher thread.
pub fn install() void {
    if (comptime !Environment.isPosix) {
        return;
    }

    if (installed.swap(true, .acq_rel)) {
        return;
    }

    log("Installing SIGUSR1 handler with watcher thread", .{});

    watcher_thread = std.Thread.spawn(.{
        .stack_size = 128 * 1024,
    }, watcherThreadMain, .{}) catch |err| {
        log("Failed to spawn watcher thread: {s}", .{@errorName(err)});
        installed.store(false, .release);
        return;
    };

    var action: std.posix.Sigaction = .{
        .handler = .{ .handler = onSigusr1Signal },
        .mask = std.posix.sigemptyset(),
        .flags = 0,
    };
    std.posix.sigaction(std.posix.SIG.USR1, &action, null);

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

    if (restore_default_handler) {
        var action: std.posix.Sigaction = .{
            .handler = .{ .handler = std.posix.SIG.DFL },
            .mask = std.posix.sigemptyset(),
            .flags = 0,
        };
        std.posix.sigaction(std.posix.SIG.USR1, &action, null);
    }

    log("SIGUSR1 handler uninstalled", .{});
}

pub fn isInstalled() bool {
    return installed.load(.acquire);
}

pub fn triggerForTesting() void {
    if (!signal_pending.swap(true, .acq_rel)) {
        semaphore.post();
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
