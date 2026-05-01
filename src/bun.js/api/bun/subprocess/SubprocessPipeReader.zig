const PipeReader = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", PipeReader.deinit, .{});
pub const ref = PipeReader.RefCount.ref;
pub const deref = PipeReader.RefCount.deref;

reader: IOReader = undefined,
process: ?*Subprocess = null,
event_loop: *jsc.EventLoop = undefined,
ref_count: PipeReader.RefCount,
state: union(enum) {
    pending: void,
    done: []u8,
    err: bun.sys.Error,
} = .{ .pending = {} },
stdio_result: StdioResult,
pub const IOReader = bun.io.BufferedReader;
pub const Poll = IOReader;

pub fn memoryCost(this: *const PipeReader) usize {
    return this.reader.memoryCost();
}

pub fn hasPendingActivity(this: *const PipeReader) bool {
    if (this.state == .pending)
        return true;

    return this.reader.hasPendingActivity();
}

pub fn detach(this: *PipeReader) void {
    this.process = null;
    this.deref();
}

pub fn create(event_loop: *jsc.EventLoop, process: *Subprocess, result: StdioResult, limit: ?*MaxBuf) *PipeReader {
    var this = bun.new(PipeReader, .{
        .ref_count = .init(),
        .process = process,
        .reader = IOReader.init(@This()),
        .event_loop = event_loop,
        .stdio_result = result,
    });
    MaxBuf.addToPipereader(limit, &this.reader.maxbuf);
    if (Environment.isWindows) {
        this.reader.source = .{ .pipe = this.stdio_result.buffer };
    }

    this.reader.setParent(this);
    return this;
}

pub fn readAll(this: *PipeReader) void {
    if (this.state == .pending)
        this.reader.read();
}

pub fn start(this: *PipeReader, process: *Subprocess, event_loop: *jsc.EventLoop) bun.sys.Maybe(void) {
    this.ref();
    this.process = process;
    this.event_loop = event_loop;
    if (Environment.isWindows) {
        return this.reader.startWithCurrentPipe();
    }

    switch (this.reader.start(this.stdio_result.?, true)) {
        .err => |err| {
            return .{ .err = err };
        },
        .result => {
            if (comptime Environment.isPosix) {
                const poll = this.reader.handle.poll;
                poll.flags.insert(.socket);
                this.reader.flags.socket = true;
                this.reader.flags.nonblocking = true;
                this.reader.flags.pollable = true;
                poll.flags.insert(.nonblocking);
            }

            return .success;
        },
    }
}

pub const toJS = toReadableStream;

pub fn onReaderDone(this: *PipeReader) void {
    const owned = this.toOwnedSlice();
    this.state = .{ .done = owned };
    if (this.process) |process| {
        this.process = null;
        process.onCloseIO(this.kind(process));
        this.deref();
    }
}

pub fn kind(reader: *const PipeReader, process: *const Subprocess) StdioKind {
    if (process.stdout == .pipe and process.stdout.pipe == reader) {
        return .stdout;
    }

    if (process.stderr == .pipe and process.stderr.pipe == reader) {
        return .stderr;
    }

    @panic("We should be either stdout or stderr");
}

pub fn toOwnedSlice(this: *PipeReader) []u8 {
    if (this.state == .done) {
        return this.state.done;
    }
    // we do not use .toOwnedSlice() because we don't want to reallocate memory.
    const out = this.reader._buffer;
    this.reader._buffer.items = &.{};
    this.reader._buffer.capacity = 0;

    if (out.capacity > 0 and out.items.len == 0) {
        out.deinit();
        return &.{};
    }

    return out.items;
}

pub fn updateRef(this: *PipeReader, add: bool) void {
    this.reader.updateRef(add);
}

pub fn watch(this: *PipeReader) void {
    if (!this.reader.isDone())
        this.reader.watch();
}

pub fn toReadableStream(this: *PipeReader, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    defer this.detach();

    switch (this.state) {
        .pending => {
            const stream = jsc.WebCore.ReadableStream.fromPipe(globalObject, this, &this.reader);
            this.state = .{ .done = &.{} };
            return stream;
        },
        .done => |bytes| {
            this.state = .{ .done = &.{} };
            return jsc.WebCore.ReadableStream.fromOwnedSlice(globalObject, bytes, 0);
        },
        .err => |err| {
            _ = err;
            const empty = try jsc.WebCore.ReadableStream.empty(globalObject);
            jsc.WebCore.ReadableStream.cancel(&(try jsc.WebCore.ReadableStream.fromJS(empty, globalObject)).?, globalObject);
            return empty;
        },
    }
}

pub fn toBuffer(this: *PipeReader, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    switch (this.state) {
        .done => |bytes| {
            defer this.state = .{ .done = &.{} };
            return jsc.MarkedArrayBuffer.fromBytes(bytes, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        },
        else => {
            return .js_undefined;
        },
    }
}

pub fn onReaderError(this: *PipeReader, err: bun.sys.Error) void {
    if (this.state == .done) {
        bun.default_allocator.free(this.state.done);
    }
    this.state = .{ .err = err };
    if (this.process) |process|
        process.onCloseIO(this.kind(process));
}

pub fn close(this: *PipeReader) void {
    switch (this.state) {
        .pending => {
            this.reader.close();
        },
        .done => {},
        .err => {},
    }
}

pub fn eventLoop(this: *PipeReader) *jsc.EventLoop {
    return this.event_loop;
}

pub fn loop(this: *PipeReader) *bun.Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.event_loop.virtual_machine.uwsLoop().uv_loop;
    } else {
        return this.event_loop.virtual_machine.uwsLoop();
    }
}

fn deinit(this: *PipeReader) void {
    if (comptime Environment.isPosix) {
        bun.assert(this.reader.isDone());
    }

    if (comptime Environment.isWindows) {
        bun.assert(this.reader.source == null or this.reader.source.?.isClosed());
    }

    if (this.state == .done) {
        bun.default_allocator.free(this.state.done);
    }

    this.reader.deinit();
    bun.destroy(this);
}

const bun = @import("bun");
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const Subprocess = jsc.API.Subprocess;
const MaxBuf = Subprocess.MaxBuf;
const StdioKind = Subprocess.StdioKind;
const StdioResult = Subprocess.StdioResult;
