//! POSIX bidirectional IPC channel for `bun test --parallel`, backed by a
//! usockets socket adopted from the spawn-time `socketpair`. Reads are
//! frame-decoded in the loop's data callback; writes go through
//! `socket.write()` with backpressure buffered and drained on `onWritable`, so
//! a full kernel buffer never truncates a frame. The owner type provides
//! `onChannelFrame(kind, *Frame.Reader)` and `onChannelDone()`. Windows uses
//! the existing `BufferedReader`/uv-pipe path and does not instantiate this.

pub fn Channel(comptime Owner: type) type {
    return struct {
        const Self = @This();
        pub const Socket = uws.NewSocketHandler(false);

        owner: *Owner,
        socket: Socket = .detached,
        /// Incoming bytes that don't yet form a complete frame.
        in: std.ArrayListUnmanaged(u8) = .empty,
        /// Outgoing bytes the kernel didn't accept yet; drained in onWritable.
        out: std.ArrayListUnmanaged(u8) = .empty,
        done: bool = false,

        /// Returns the shared SocketContext for this Owner type, creating it on
        /// first use. One context per Owner type means all coordinator-side
        /// worker channels share a context, and the worker-side command channel
        /// has its own.
        pub fn ensureContext(vm: *jsc.VirtualMachine) *uws.SocketContext {
            const S = struct {
                var ctx: ?*uws.SocketContext = null;
            };
            if (S.ctx) |c| return c;
            const c = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*anyopaque)).?;
            Socket.configure(c, true, *Self, Handlers);
            S.ctx = c;
            // The isolation swap walks every uws context and closes its sockets.
            // This channel must survive that — it's the coordinator link.
            vm.rareData().test_parallel_ipc_context = c;
            return c;
        }

        pub fn adopt(self: *Self, vm: *jsc.VirtualMachine, fd: bun.FD) bool {
            const ctx = ensureContext(vm);
            const sock = Socket.fromFd(ctx, fd, Self, self, "socket", true) orelse return false;
            sock.setTimeout(0);
            return true;
        }

        /// Queue and write a complete encoded frame. If the kernel accepts only
        /// part of it (or there's already a backlog), the remainder lands in
        /// `out` and `onWritable` finishes it.
        pub fn send(self: *Self, frame_bytes: []const u8) void {
            if (self.done) return;
            if (self.out.items.len > 0) {
                bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes));
                return;
            }
            const wrote = self.socket.write(frame_bytes);
            const w: usize = if (wrote > 0) @intCast(wrote) else 0;
            if (w < frame_bytes.len) {
                bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes[w..]));
            }
        }

        /// Best-effort drain of any buffered writes. Called from `onWritable`
        /// and before close so trailing frames make it out.
        pub fn flush(self: *Self) void {
            while (self.out.items.len > 0 and !self.done) {
                const wrote = self.socket.write(self.out.items);
                if (wrote <= 0) return;
                const w: usize = @intCast(wrote);
                std.mem.copyForwards(u8, self.out.items[0 .. self.out.items.len - w], self.out.items[w..]);
                self.out.items.len -= w;
            }
        }

        pub fn close(self: *Self) void {
            if (self.done) return;
            self.flush();
            self.socket.close(.normal);
        }

        pub fn deinit(self: *Self) void {
            if (!self.socket.isDetached()) self.socket.close(.normal);
            self.in.deinit(bun.default_allocator);
            self.out.deinit(bun.default_allocator);
        }

        const Handlers = struct {
            pub fn onOpen(_: *Self, _: Socket) void {}
            pub fn onData(self: *Self, _: Socket, data: []const u8) void {
                bun.handleOom(self.in.appendSlice(bun.default_allocator, data));
                var head: usize = 0;
                while (self.in.items.len - head >= 5) {
                    const len = std.mem.readInt(u32, self.in.items[head..][0..4], .little);
                    if (len > Frame.max_payload) {
                        self.done = true;
                        self.owner.onChannelDone();
                        return;
                    }
                    if (self.in.items.len - head < @as(usize, 5) + len) break;
                    const kind = std.meta.intToEnum(Frame.Kind, self.in.items[head + 4]) catch {
                        head += @as(usize, 5) + len;
                        continue;
                    };
                    var rd = Frame.Reader{ .p = self.in.items[head + 5 ..][0..len] };
                    self.owner.onChannelFrame(kind, &rd);
                    head += @as(usize, 5) + len;
                }
                if (head > 0) {
                    const rest = self.in.items.len - head;
                    std.mem.copyForwards(u8, self.in.items[0..rest], self.in.items[head..]);
                    self.in.items.len = rest;
                }
            }
            pub fn onWritable(self: *Self, _: Socket) void {
                self.flush();
            }
            pub fn onClose(self: *Self, _: Socket, _: c_int, _: ?*anyopaque) void {
                self.socket = .detached;
                if (!self.done) {
                    self.done = true;
                    self.owner.onChannelDone();
                }
            }
            pub fn onEnd(self: *Self, sock: Socket) void {
                _ = self;
                sock.close(.normal);
            }
            pub fn onTimeout(_: *Self, _: Socket) void {}
            pub fn onLongTimeout(_: *Self, _: Socket) void {}
            pub fn onConnectError(_: *Self, _: Socket, _: c_int) void {}
            pub fn onHandshake(_: *Self, _: Socket, _: i32, _: uws.us_bun_verify_error_t) void {}
        };
    };
}

const Frame = @import("./Frame.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
