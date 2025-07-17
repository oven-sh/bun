const ThreadSafeStreamBuffer = @This();

buffer: bun.io.StreamBuffer = .{},
mutex: bun.Mutex = .{},
ref_count: StreamBufferRefCount = .initExactRefs(2), // 1 for main thread and 1 for http thread
// callback will be called passing the context for the http callback
// this is used to report when the buffer is drained and only if end chunk was not sent/reported
callback: ?Callback = null,

const Callback = struct {
    callback: *const fn (*anyopaque) void,
    context: *anyopaque,

    pub fn init(comptime T: type, callback: *const fn (*T) void, context: *T) @This() {
        return .{ .callback = @ptrCast(callback), .context = @ptrCast(context) };
    }

    pub fn call(this: @This()) void {
        this.callback(this.context);
    }
};

const StreamBufferRefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", ThreadSafeStreamBuffer.deinit, .{});
pub const ref = StreamBufferRefCount.ref;
pub const deref = StreamBufferRefCount.deref;
pub const new = bun.TrivialNew(@This());

pub fn acquire(this: *ThreadSafeStreamBuffer) *bun.io.StreamBuffer {
    this.mutex.lock();
    return &this.buffer;
}

pub fn release(this: *ThreadSafeStreamBuffer) void {
    this.mutex.unlock();
}

/// Should only be called in the main thread and before schedule the it to the http thread
pub fn setDrainCallback(this: *ThreadSafeStreamBuffer, comptime T: type, callback: *const fn (*T) void, context: *T) void {
    this.callback = Callback.init(T, callback, context);
}

pub fn clearDrainCallback(this: *ThreadSafeStreamBuffer) void {
    this.callback = null;
}

/// This is exclusively called from the http thread
/// Buffer should be acquired before calling this
pub fn reportDrain(this: *ThreadSafeStreamBuffer) void {
    if (this.buffer.isEmpty()) {
        if (this.callback) |callback| {
            callback.call();
        }
    }
}

pub fn deinit(this: *ThreadSafeStreamBuffer) void {
    this.buffer.deinit();
    bun.destroy(this);
}

const bun = @import("bun");
