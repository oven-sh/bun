const PosixSignalHandle = @This();

const buffer_size = 8192;

signals: [buffer_size]u8 = undefined,

// Producer index (signal handler writes).
tail: std.atomic.Value(u16) = std.atomic.Value(u16).init(0),
// Consumer index (main thread reads).
head: std.atomic.Value(u16) = std.atomic.Value(u16).init(0),

const log = bun.Output.scoped(.PosixSignalHandle, true);

pub const new = bun.TrivialNew(@This());

/// Called by the signal handler (single producer).
/// Returns `true` if enqueued successfully, or `false` if the ring is full.
pub fn enqueue(this: *PosixSignalHandle, signal: u8) bool {
    // Read the current tail and head (Acquire to ensure we have up‐to‐date values).
    const old_tail = this.tail.load(.acquire);
    const head_val = this.head.load(.acquire);

    // Compute the next tail (wrapping around buffer_size).
    const next_tail = (old_tail +% 1) % buffer_size;

    // Check if the ring is full.
    if (next_tail == (head_val % buffer_size)) {
        // The ring buffer is full.
        // We cannot block or wait here (since we're in a signal handler).
        // So we just drop the signal or log if desired.
        log("signal queue is full; dropping", .{});
        return false;
    }

    // Store the signal into the ring buffer slot (Release to ensure data is visible).
    @atomicStore(u8, &this.signals[old_tail % buffer_size], signal, .release);

    // Publish the new tail (Release so that the consumer sees the updated tail).
    this.tail.store(old_tail +% 1, .release);

    VirtualMachine.getMainThreadVM().?.eventLoop().wakeup();

    return true;
}

/// This is the signal handler entry point. Calls enqueue on the ring buffer.
/// Note: Must be minimal logic here. Only do atomics & signal‐safe calls.
export fn Bun__onPosixSignal(number: i32) void {
    if (comptime Environment.isPosix) {
        const vm = VirtualMachine.getMainThreadVM().?;
        _ = vm.eventLoop().signal_handler.?.enqueue(@intCast(number));
    }
}

/// Called by the main thread (single consumer).
/// Returns `null` if the ring is empty, or the next signal otherwise.
pub fn dequeue(this: *PosixSignalHandle) ?u8 {
    // Read the current head and tail.
    const old_head = this.head.load(.acquire);
    const tail_val = this.tail.load(.acquire);

    // If head == tail, the ring is empty.
    if (old_head == tail_val) {
        return null; // No available items
    }

    const slot_index = old_head % buffer_size;
    // Acquire load of the stored signal to get the item.
    const signal = @atomicRmw(u8, &this.signals[slot_index], .Xchg, 0, .acq_rel);

    // Publish the updated head (Release).
    this.head.store(old_head +% 1, .release);

    return signal;
}

/// Drain as many signals as possible and enqueue them as tasks in the event loop.
/// Called by the main thread.
pub fn drain(this: *PosixSignalHandle, event_loop: *JSC.EventLoop) void {
    while (this.dequeue()) |signal| {
        // Example: wrap the signal into a Task structure
        var posix_signal_task: PosixSignalTask = undefined;
        var task = JSC.Task.init(&posix_signal_task);
        task.setUintptr(signal);
        event_loop.enqueueTask(task);
    }
}

pub const PosixSignalTask = struct {
    number: u8,
    extern "c" fn Bun__onSignalForJS(number: i32, globalObject: *JSC.JSGlobalObject) void;

    pub const new = bun.TrivialNew(@This());
    pub fn runFromJSThread(number: u8, globalObject: *JSC.JSGlobalObject) void {
        Bun__onSignalForJS(number, globalObject);
    }
};

export fn Bun__ensureSignalHandler() void {
    if (comptime Environment.isPosix) {
        if (VirtualMachine.getMainThreadVM()) |vm| {
            const this = vm.eventLoop();
            if (this.signal_handler == null) {
                this.signal_handler = PosixSignalHandle.new(.{});
                @memset(&this.signal_handler.?.signals, 0);
            }
        }
    }
}

comptime {
    if (Environment.isPosix) {
        _ = Bun__ensureSignalHandler;
        _ = Bun__onPosixSignal;
    }
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const Environment = bun.Environment;
