const PipeReader = @This();

reader: IOReader = undefined,
process: ?*Subprocess = null,
event_loop: *JSC.EventLoop = undefined,
ref_count: PipeReader.RefCount,
state: union(enum) {
    pending: void,
    done: []u8,
    err: bun.sys.Error,
} = .{ .pending = {} },
stdio_result: StdioResult,

pub const ref = PipeReader.RefCount.ref;
pub const deref = PipeReader.RefCount.deref;
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

pub fn create(event_loop: *JSC.EventLoop, process: *Subprocess, result: StdioResult, limit: ?*MaxBuf) *PipeReader {
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

pub fn start(this: *PipeReader, process: *Subprocess, event_loop: *JSC.EventLoop) JSC.Maybe(void) {
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
            }

            return .{ .result = {} };
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

pub fn toReadableStream(this: *PipeReader, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
    defer this.detach();

    switch (this.state) {
        .pending => {
            const stream = JSC.WebCore.ReadableStream.fromPipe(globalObject, this, &this.reader);
            this.state = .{ .done = &.{} };
            return stream;
        },
        .done => |bytes| {
            this.state = .{ .done = &.{} };
            return JSC.WebCore.ReadableStream.fromOwnedSlice(globalObject, bytes, 0);
        },
        .err => |err| {
            _ = err; // autofix
            const empty = JSC.WebCore.ReadableStream.empty(globalObject);
            JSC.WebCore.ReadableStream.cancel(&JSC.WebCore.ReadableStream.fromJS(empty, globalObject).?, globalObject);
            return empty;
        },
    }
}

pub fn toBuffer(this: *PipeReader, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    switch (this.state) {
        .done => |bytes| {
            defer this.state = .{ .done = &.{} };
            return JSC.MarkedArrayBuffer.fromBytes(bytes, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        },
        else => {
            return JSC.JSValue.undefined;
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

pub fn eventLoop(this: *PipeReader) *JSC.EventLoop {
    return this.event_loop;
}

pub fn loop(this: *PipeReader) *uws.Loop {
    return this.event_loop.virtual_machine.uwsLoop();
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

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Subprocess = JSC.API.Subprocess;
const Stdio = bun.spawn.Stdio;
const StdioResult = Subprocess.StdioResult;
const Environment = bun.Environment;
const Output = bun.Output;
const JSValue = JSC.JSValue;
const RefCount = bun.ptr.RefCount(@This(), "ref_count", PipeReader.deinit, .{});
const MaxBuf = Subprocess.MaxBuf;
const uws = bun.uws;
const IOReader = bun.io.BufferedReader;
const StdioKind = Subprocess.StdioKind;
