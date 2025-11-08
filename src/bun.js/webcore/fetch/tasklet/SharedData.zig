const SharedData = @This();
mutex: bun.Mutex,

ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

/// buffer being used by AsyncHTTP
response_buffer: bun.MutableString = undefined,

/// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
pub fn onWriteRequestDataDrain(this: *FetchTasklet) void {
    // ref until the main thread callback is called
    this.ref();
    this.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.resumeRequestDataStream));
}

const std = @import("std");
const bun = @import("bun");
