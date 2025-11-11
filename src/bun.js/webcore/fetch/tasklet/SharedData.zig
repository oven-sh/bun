const SharedData = @This();
mutex: bun.Mutex = .{},
ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

/// buffer being used by AsyncHTTP
response_buffer: bun.MutableString = undefined,
request_body_streaming_buffer: ?*bun.http.ThreadSafeStreamBuffer = null,
result: bun.http.HTTPClientResult = .{},

signals: bun.http.Signals = .{},
signal_store: bun.http.Signals.Store = .{},
has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

fn parent(this: *SharedData) *FetchTasklet {
    return @fieldParentPtr("shared", this);
}

/// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
pub fn resumeRequestDataStream(this: *SharedData) void {
    // ref until the main thread callback is called
    const tasklet = this.parent();
    tasklet.ref();
    tasklet.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(&tasklet.request, tasklet.request.resumeRequestDataStream));
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const FetchTasklet = @import("../FetchTasklet.zig");
const ResumableSinkBackpressure = jsc.WebCore.ResumableSinkBackpressure;
