pub fn NewStaticPipeWriter(comptime ProcessType: type) type {
    return struct {
        const This = @This();

        ref_count: WriterRefCount,
        writer: IOWriter = .{},
        stdio_result: StdioResult,
        source: Source = .{ .detached = {} },
        process: *ProcessType = undefined,
        event_loop: jsc.EventLoopHandle,
        buffer: []const u8 = "",

        // It seems there is a bug in the Zig compiler. We'll get back to this one later
        const WriterRefCount = bun.ptr.RefCount(@This(), "ref_count", _deinit, .{});
        pub const ref = WriterRefCount.ref;
        pub const deref = WriterRefCount.deref;

        const print = bun.Output.scoped(.StaticPipeWriter, .visible);

        pub const IOWriter = bun.io.BufferedWriter(@This(), struct {
            pub const onWritable = null;
            pub const getBuffer = This.getBuffer;
            pub const onClose = This.onClose;
            pub const onError = This.onError;
            pub const onWrite = This.onWrite;
        });
        pub const Poll = IOWriter;

        pub fn updateRef(this: *This, add: bool) void {
            this.writer.updateRef(this.event_loop, add);
        }

        pub fn getBuffer(this: *This) []const u8 {
            return this.buffer;
        }

        pub fn close(this: *This) void {
            log("StaticPipeWriter(0x{x}) close()", .{@intFromPtr(this)});
            this.writer.close();
        }

        pub fn flush(this: *This) void {
            if (this.buffer.len > 0)
                this.writer.write();
        }

        pub fn create(event_loop: anytype, subprocess: *ProcessType, result: StdioResult, source: Source) *This {
            const this = bun.new(This, .{
                .ref_count = .init(),
                .event_loop = jsc.EventLoopHandle.init(event_loop),
                .process = subprocess,
                .stdio_result = result,
                .source = source,
            });
            if (Environment.isWindows) {
                this.writer.setPipe(this.stdio_result.buffer);
            }
            this.writer.setParent(this);
            return this;
        }

        pub fn start(this: *This) bun.sys.Maybe(void) {
            log("StaticPipeWriter(0x{x}) start()", .{@intFromPtr(this)});
            this.ref();
            this.buffer = this.source.slice();
            if (Environment.isWindows) {
                return this.writer.startWithCurrentPipe();
            }
            switch (this.writer.start(this.stdio_result.?, true)) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => {
                    if (comptime Environment.isPosix) {
                        const poll = this.writer.handle.poll;
                        poll.flags.insert(.socket);
                    }

                    return .success;
                },
            }
        }

        pub fn onWrite(this: *This, amount: usize, status: bun.io.WriteStatus) void {
            log("StaticPipeWriter(0x{x}) onWrite(amount={d} {})", .{ @intFromPtr(this), amount, status });
            this.buffer = this.buffer[@min(amount, this.buffer.len)..];
            if (status == .end_of_file or this.buffer.len == 0) {
                this.writer.close();
            }
        }

        pub fn onError(this: *This, err: bun.sys.Error) void {
            log("StaticPipeWriter(0x{x}) onError(err={f})", .{ @intFromPtr(this), err });
            this.source.detach();
        }

        pub fn onClose(this: *This) void {
            log("StaticPipeWriter(0x{x}) onClose()", .{@intFromPtr(this)});
            this.source.detach();
            this.process.onCloseIO(.stdin);
        }

        fn _deinit(this: *This) void {
            this.writer.end();
            this.source.detach();
            bun.destroy(this);
        }

        pub fn memoryCost(this: *const This) usize {
            return @sizeOf(@This()) + this.source.memoryCost() + this.writer.memoryCost();
        }

        pub fn loop(this: *This) *bun.Async.Loop {
            if (comptime bun.Environment.isWindows) {
                return this.event_loop.loop().uv_loop;
            } else {
                return this.event_loop.loop();
            }
        }

        pub fn watch(this: *This) void {
            if (this.buffer.len > 0) {
                this.writer.watch();
            }
        }

        pub fn eventLoop(this: *This) jsc.EventLoopHandle {
            return this.event_loop;
        }
    };
}

const log = Output.scoped(.StaticPipeWriter, .hidden);

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const jsc = bun.jsc;

const Subprocess = jsc.API.Subprocess;
const Source = Subprocess.Source;
const StdioResult = Subprocess.StdioResult;
