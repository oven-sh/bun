const bun = @import("root").bun;
const std = @import("std");
const zlib = @import("./zlib.zig");
const brotli = bun.brotli;

pub const Error = struct {
    code: bun.String = bun.String.empty,
    message: bun.String = bun.String.empty,
};

pub const Ownership = enum { transfer, must_copy };
pub const Completion = enum { last, not_last };

pub const Controller = struct {
    ctx: *anyopaque,
    max_to_receive: ?*usize = null,
    closed: *bool,
    receive_data_fn: *const fn (*anyopaque, []const u8, Ownership, Completion) void,
    receive_error_fn: *const fn (*anyopaque, Error) void,
    pull_fn: *const fn (*anyopaque) void,

    pub fn enqueue(this: *const Controller, data: []const u8, ownership: Ownership, completion: Completion) void {
        this.receive_data_fn(this.ctx, data, ownership, completion);
    }

    pub fn fail(this: *const Controller, err: Error) void {
        this.receive_error_fn(this.ctx, err);
    }

    pub fn pull(this: *const Controller) void {
        this.pull_fn(this.ctx);
    }

    pub fn init(comptime Context: type, context: Context) Controller {
        return Controller{
            .ctx = @ptrCast(*anyopaque, context),
            .closed = @ptrCast(*bool, &context.closed),
            .receive_data_fn = @ptrCast(*const fn (*anyopaque, []const u8, Ownership, Completion) void, Context.onData),
            .receive_error_fn = @ptrCast(*const fn (*anyopaque, Error) void, Context.onError),
            .pull_fn = @ptrCast(*const fn (*anyopaque) void, Context.onPull),
        };
    }
};

pub const CLIFileStreamCompressor = struct {
    input: std.fs.File,
    output: std.fs.File,
    closed: bool = false,

    ready_for_more: bool = false,
    has_more_output: bool = true,

    pub fn controller(this: *CLIFileStreamCompressor) Controller {
        return Controller.init(*CLIFileStreamCompressor, this);
    }

    pub fn onData(this: *CLIFileStreamCompressor, bytes: []const u8, _: Ownership, completion: Completion) void {
        std.debug.assert(!this.closed);
        this.output.writeAll(bytes) catch @panic("failed to write to file");
        if (completion == Completion.last) {
            this.ready_for_more = false;
        }
    }

    pub fn onError(this: *CLIFileStreamCompressor, err: Error) void {
        std.debug.assert(!this.closed);
        std.debug.panic("Error: {}\n{}", .{ err.code, err.message });
    }

    pub fn onPull(this: *CLIFileStreamCompressor) void {
        this.ready_for_more = true;
    }

    pub fn init(path: []const u8) !CLIFileStreamCompressor {
        var file = try std.fs.cwd().openFile(path, .{ .mode = .read_write });
        return CLIFileStreamCompressor{ .input = file, .output = std.io.getStdOut() };
    }

    pub fn run(this: *CLIFileStreamCompressor, stream: *Compressor) !void {
        this.ready_for_more = true;
        const ctrl = this.controller();

        while (this.has_more_output) {
            var buffer: [64 * 1024]u8 = undefined;
            var to_read: []u8 = buffer[0..try this.input.readAll(&buffer)];
            this.has_more_output = to_read.len != 0;
            if (this.has_more_output) {
                stream.write(to_read, ctrl);
            }
        }

        stream.end(ctrl);
    }
};

pub const Compressor = union(enum) {
    BrotliEncoder: Brotli.Encoder,
    BrotliDecoder: Brotli.Decoder,

    pub fn write(this: *Compressor, data: []const u8, controller: Controller) void {
        return switch (this) {
            .BrotliEncoder => this.BrotliEncoder.write(data, controller),
            .BrotliDecoder => this.BrotliDecoder.write(data, controller),
        };
    }

    pub fn end(this: *Compressor) void {
        return switch (this) {
            .BrotliEncoder => this.BrotliEncoder.end(),
            .BrotliDecoder => this.BrotliDecoder.end(),
        };
    }

    pub fn initWithType(comptime Type: type, value: Type) !*Compressor {
        var compressor = try bun.default_allocator.create(Compressor);
        compressor.* = switch (comptime Type) {
            Brotli.Encoder => .{ .BrotliEncoder = value },
            Brotli.Decoder => .{ .BrotliDecoder = value },
            else => @compileError("unsupported compressor type"),
        };
        return compressor;
    }

    pub fn init(compressor: anytype) !*Compressor {
        return initWithType(@TypeOf(compressor), compressor);
    }
};

pub const Brotli = struct {
    pub const Encoder = struct {
        state: ?*brotli.BrotliEncoderState,

        pub fn initWithoutOptions() Encoder {
            return Encoder{
                .state = brotli.BrotliEncoderState.init(),
            };
        }

        pub fn write(this: *Encoder, data: []const u8, controller: Controller) void {
            var state = this.state orelse return;
            var input = data;

            consume(state, controller);
            std.debug.assert(state.write(&input, null, null));
            std.debug.assert(state.flush(null, null, null));
            consume(state, controller);
        }

        fn consume(state: *brotli.BrotliEncoderState, controller: Controller) void {
            while (!controller.closed.*) {
                const to_receive = if (controller.max_to_receive) |max| max.* else 0;
                if (isFull(to_receive)) break;
                const taken = state.take(to_receive);
                if (taken.len == 0)
                    break;

                controller.enqueue(
                    taken,
                    .must_copy,
                    false,
                );

                if (!state.hasMoreOutput())
                    break;
            }
        }

        pub fn end(this: *Encoder, controller: Controller) void {
            var state = this.state orelse return;
            this.state = null;
            std.debug.assert(state.finish(null, null, null));
            consume(state, controller);
            state.deinit();
        }
    };

    pub const Decoder = struct {
        state: ?*brotli.BrotliDecoderState,

        pub fn initWithoutOptions() Decoder {
            return Decoder{
                .state = brotli.BrotliDecoderState.init(),
            };
        }

        pub fn write(this: *Decoder, data: []const u8, controller: Controller) void {
            var state = this.state orelse return;
            var input = data;
            while (!controller.closed.* and !state.isFinished()) {
                switch (state.write(&input, null, null)) {
                    .success => {
                        consume(state, controller, true);
                        return;
                    },
                    .@"error" => {
                        const code = state.getErrorCode();
                        controller.fail(Error{
                            .code = bun.String.static(code.code()),
                            .message = bun.String.static(code.message()),
                        });
                        return;
                    },
                    .needs_more_input => {
                        controller.pull();
                        return;
                    },
                    .needs_more_output => {
                        consume(state, controller, false);
                    },
                }
            }
        }

        fn consume(state: *brotli.BrotliDecoderState, controller: Controller, is_last: bool) void {
            while (!controller.closed.*) {
                const to_receive = if (controller.max_to_receive) |max| max.* else 0;
                if (isFull(to_receive)) break;
                const taken = state.take(to_receive);
                if (taken.len == 0)
                    break;

                controller.enqueue(
                    taken,
                    .must_copy,
                    if (!state.hasMoreOutput() and is_last) .last else .not_last,
                );

                if (!state.hasMoreOutput())
                    break;
            }
        }

        pub fn end(this: *Decoder, controller: Controller) void {
            var state = this.state orelse return;
            this.state = null;
            consume(state, controller);
            std.debug.assert(state.finish(null, null, null));
            consume(state, controller);
            state.deinit();
        }
    };
};

fn isFull(size: usize) bool {
    return size == std.math.maxInt(usize);
}
