/// MissingModulePollTimer manages polling for missing modules in watch mode.
///
/// When a script tries to import a file that doesn't exist, Bun's watch mode should
/// wait for the file to be created rather than exiting with an error. This timer
/// implements exponential backoff polling to check if the missing file has appeared.
///
/// Behavior:
/// - Starts at 2ms intervals, exponentially backs off to max 100ms
/// - Checks if the missing file exists on each poll
/// - Triggers a process reload when the file appears
/// - Stops polling if watch mode is disabled or VM is shutting down
const MissingModulePollTimer = @This();

event_loop_timer: jsc.API.Timer.EventLoopTimer = .{
    .tag = .MissingModulePollTimer,
    .next = .epoch,
},

/// The path to the missing module that we're polling for
missing_path: []const u8 = &.{},

/// Current polling interval in milliseconds
current_interval_ms: u32 = 2,

/// Minimum polling interval (2ms)
min_interval_ms: u32 = 2,

/// Maximum polling interval (100ms)
max_interval_ms: u32 = 100,

/// Whether the timer is actively polling
is_polling: bool = false,

pub fn init() MissingModulePollTimer {
    return .{};
}

/// Start polling for a missing module
pub fn startPolling(this: *MissingModulePollTimer, vm: *VirtualMachine, missing_path: []const u8) !void {
    // If already polling, stop the current timer first
    if (this.is_polling) {
        this.stopPolling(vm);
    }

    // Store a copy of the path
    if (this.missing_path.len > 0) {
        bun.default_allocator.free(this.missing_path);
    }
    this.missing_path = try bun.default_allocator.dupe(u8, missing_path);

    // Reset interval to minimum
    this.current_interval_ms = this.min_interval_ms;
    this.is_polling = true;

    // Schedule the first poll
    this.scheduleNextPoll(vm);

    log("Started polling for missing module: {s} (interval: {}ms)", .{ this.missing_path, this.current_interval_ms });
}

/// Stop polling for the missing module
pub fn stopPolling(this: *MissingModulePollTimer, vm: *VirtualMachine) void {
    if (!this.is_polling) return;

    if (this.event_loop_timer.state == .ACTIVE) {
        vm.timer.remove(&this.event_loop_timer);
    }

    this.is_polling = false;
    this.current_interval_ms = this.min_interval_ms;

    log("Stopped polling for missing module: {s}", .{this.missing_path});
}

/// Schedule the next poll with the current interval
fn scheduleNextPoll(this: *MissingModulePollTimer, vm: *VirtualMachine) void {
    this.event_loop_timer.next = bun.timespec.msFromNow(@intCast(this.current_interval_ms));
    vm.timer.insert(&this.event_loop_timer);
}

/// Timer callback that checks if the missing file exists
pub fn onTimeout(this: *MissingModulePollTimer, vm: *VirtualMachine) jsc.API.Timer.EventLoopTimer.Arm {
    this.event_loop_timer.state = .FIRED;

    if (!this.is_polling) {
        return .disarm;
    }

    // Check if the file exists
    const file_exists = this.checkFileExists();

    if (file_exists) {
        log("Missing module found: {s}. Triggering reload.", .{this.missing_path});

        // Stop polling
        this.is_polling = false;

        // Trigger a hot reload by calling reload directly
        const HotReloader = jsc.hot_reloader.HotReloader;
        var task = HotReloader.Task.initEmpty(undefined);
        vm.reload(&task);

        return .disarm;
    }

    // File still doesn't exist, increase interval with exponential backoff
    this.current_interval_ms = @min(this.current_interval_ms * 2, this.max_interval_ms);

    log("Missing module not found yet: {s}. Next poll in {}ms", .{ this.missing_path, this.current_interval_ms });

    // Schedule next poll
    this.scheduleNextPoll(vm);

    return .disarm;
}

/// Check if the file exists
fn checkFileExists(this: *MissingModulePollTimer) bool {
    if (this.missing_path.len == 0) return false;

    // Use stat to check if the file exists
    const stat_result = std.fs.cwd().statFile(this.missing_path) catch return false;
    return stat_result.kind == .file;
}

/// Cleanup timer resources
pub fn deinit(this: *MissingModulePollTimer, vm: *VirtualMachine) void {
    if (this.event_loop_timer.state == .ACTIVE) {
        vm.timer.remove(&this.event_loop_timer);
    }

    if (this.missing_path.len > 0) {
        bun.default_allocator.free(this.missing_path);
        this.missing_path = &.{};
    }

    this.is_polling = false;
}

const log = bun.Output.scoped(.MissingModulePollTimer, .hidden);

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
