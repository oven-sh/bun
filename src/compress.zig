const bun = @import("root").bun;
const std = @import("std");
const zlib = @import("./zlib.zig");
const brotli = bun.brotli;

const String = bun.String;

pub const Error = struct {
    // To workaround a zig compiler bug, we avoid using String here.
    code: []const u8,
    message: []const u8,
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

    pub fn init(comptime ContextType: type, context: ContextType) Controller {
        const Context = std.meta.Child(ContextType);
        return Controller{
            .ctx = @ptrCast(*anyopaque, context),
            .closed = @ptrCast(*bool, &context.closed),
            .receive_data_fn = @ptrCast(*const fn (*anyopaque, []const u8, Ownership, Completion) void, &Context.onData),
            .receive_error_fn = @ptrCast(*const fn (*anyopaque, Error) void, &Context.onError),
            .pull_fn = @ptrCast(*const fn (*anyopaque) void, &Context.onPull),
        };
    }
};

pub const Compressor = union(enum) {
    BrotliEncoder: Brotli.Encoder,
    BrotliDecoder: Brotli.Decoder,

    pub fn write(this: *Compressor, data: []const u8, controller: Controller) void {
        switch (this.*) {
            .BrotliEncoder => {
                this.BrotliEncoder.write(data, controller);
            },
            .BrotliDecoder => {
                this.BrotliDecoder.write(data, controller);
            },
        }
    }

    pub fn end(this: *Compressor, controller: Controller) void {
        switch (this.*) {
            .BrotliEncoder => {
                this.BrotliEncoder.end(controller);
            },
            .BrotliDecoder => {
                this.BrotliDecoder.end(controller);
            },
        }
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
                    .not_last,
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
                            .code = code.code(),
                            .message = code.message(),
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
            consume(state, controller, true);
            state.deinit();
        }
    };
};

fn isFull(size: usize) bool {
    return size == std.math.maxInt(usize);
}
