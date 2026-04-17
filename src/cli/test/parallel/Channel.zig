//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded in the loop's data callback; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame. The owner type provides
//! `onChannelFrame(kind, *Frame.Reader)` and `onChannelDone()`.
//!
//! POSIX backend: `uws.NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: `uv.Pipe` over the inherited duplex named-pipe end (same
//! mechanism as `Bun.spawn({ipc})` / `process.send()`).
//!
//! Lifetime: a `Channel` is embedded in a heap-allocated owner that outlives
//! all uv/usockets callbacks (the coordinator's `Worker[]`, or the worker's
//! `WorkerLoop` which lives for the process). `deinit` assumes no write is in
//! flight — true for both call sites (start() errdefer and reapWorker after
//! the peer has exited).

pub fn Channel(comptime Owner: type) type {
    return struct {
        const Self = @This();

        owner: *Owner,
        /// Incoming bytes that don't yet form a complete frame.
        in: std.ArrayListUnmanaged(u8) = .empty,
        /// Outgoing bytes the kernel didn't accept yet.
        out: std.ArrayListUnmanaged(u8) = .empty,
        done: bool = false,

        backend: Backend = .{},
        const Backend = if (Environment.isWindows) WindowsBackend else PosixBackend;

        // -- POSIX (usockets) ----------------------------------------------

        pub const Socket = if (Environment.isWindows) void else uws.NewSocketHandler(false);

        const PosixBackend = struct {
            socket: Socket = .detached,
        };

        /// Returns the shared SocketContext for this Owner type, creating it on
        /// first use. One context per Owner type means all coordinator-side
        /// worker channels share a context, and the worker-side command channel
        /// has its own.
        fn ensurePosixContext(vm: *jsc.VirtualMachine) *uws.SocketContext {
            const S = struct {
                var ctx: ?*uws.SocketContext = null;
            };
            if (S.ctx) |c| return c;
            const c = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*anyopaque)).?;
            Socket.configure(c, true, *Self, PosixHandlers);
            S.ctx = c;
            // The isolation swap walks every uws context and closes its sockets.
            // This channel must survive that — it's the coordinator link.
            vm.rareData().test_parallel_ipc_context = c;
            return c;
        }

        // -- Windows (uv.Pipe) ---------------------------------------------

        const WindowsBackend = struct {
            pipe: ?*uv.Pipe = null,
            /// Read scratch — libuv asks us to allocate before each read.
            read_chunk: [16 * 1024]u8 = undefined,
            /// Payload owned by the in-flight uv_write; must stay stable until
            /// the callback. New writes go to `out` until this completes, then
            /// the buffers swap.
            inflight: std.ArrayListUnmanaged(u8) = .empty,
            write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
            write_buf: uv.uv_buf_t = uv.uv_buf_t.init(""),
        };

        // -- adopt ---------------------------------------------------------

        /// Adopt a duplex fd into the channel and start reading. POSIX: the
        /// socketpair end. Windows: the inherited named-pipe end (worker side).
        pub fn adopt(self: *Self, vm: *jsc.VirtualMachine, fd: bun.FD) bool {
            if (Environment.isWindows) {
                const pipe = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe));
                pipe.init(uv.Loop.get(), false).unwrap() catch {
                    bun.destroy(pipe);
                    return false;
                };
                pipe.open(fd).unwrap() catch {
                    pipe.closeAndDestroy();
                    return false;
                };
                return self.adoptPipe(vm, pipe);
            }
            const ctx = ensurePosixContext(vm);
            const sock = Socket.fromFd(ctx, fd, Self, self, null, true) orelse return false;
            self.backend.socket = sock;
            sock.setTimeout(0);
            return true;
        }

        /// Windows-only: adopt a `uv.Pipe` already initialized by spawn (the
        /// `.buffer` extra-fd parent end). Starts reading.
        pub fn adoptPipe(self: *Self, _: *jsc.VirtualMachine, pipe: *uv.Pipe) bool {
            if (comptime !Environment.isWindows) @compileError("adoptPipe is Windows-only");
            pipe.unref();
            self.backend.pipe = pipe;
            pipe.readStart(self, WindowsHandlers.onAlloc, WindowsHandlers.onError, WindowsHandlers.onRead).unwrap() catch {
                self.backend.pipe = null;
                pipe.closeAndDestroy();
                return false;
            };
            return true;
        }

        // -- write ---------------------------------------------------------

        /// Queue and write a complete encoded frame. If the kernel accepts only
        /// part of it (or there's already a backlog), the remainder lands in
        /// `out` and the writable callback finishes it.
        pub fn send(self: *Self, frame_bytes: []const u8) void {
            if (self.done) return;
            if (Environment.isWindows) return self.sendWindows(frame_bytes);
            if (self.out.items.len > 0) {
                bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes));
                return;
            }
            const wrote = self.backend.socket.write(frame_bytes);
            const w: usize = if (wrote > 0) @intCast(wrote) else 0;
            if (w < frame_bytes.len) {
                bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes[w..]));
            }
        }

        fn sendWindows(self: *Self, frame_bytes: []const u8) void {
            if (comptime !Environment.isWindows) unreachable;
            // A uv_write is in flight — queue behind it.
            if (self.backend.inflight.items.len > 0) {
                bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes));
                return;
            }
            const pipe = self.backend.pipe orelse return;
            // Try a synchronous write first (no allocation, no req).
            const w: usize = switch (pipe.tryWrite(frame_bytes)) {
                .result => |n| n,
                .err => |e| if (e.getErrno() == .AGAIN) 0 else return,
            };
            if (w >= frame_bytes.len) return;
            bun.handleOom(self.out.appendSlice(bun.default_allocator, frame_bytes[w..]));
            self.submitWindowsWrite();
        }

        fn submitWindowsWrite(self: *Self) void {
            if (comptime !Environment.isWindows) unreachable;
            if (self.out.items.len == 0 or self.backend.inflight.items.len > 0 or self.done) return;
            const pipe = self.backend.pipe orelse return;
            // Swap: out → inflight (stable for uv_write), out becomes empty.
            std.mem.swap(std.ArrayListUnmanaged(u8), &self.backend.inflight, &self.out);
            self.backend.write_buf = uv.uv_buf_t.init(self.backend.inflight.items);
            self.backend.write_req.write(pipe.asStream(), &self.backend.write_buf, self, WindowsHandlers.onWrite).unwrap() catch {
                self.backend.inflight.clearRetainingCapacity();
                self.markDone();
            };
        }

        /// True while the underlying socket/pipe is still open. When `done`
        /// is set with the transport still attached, it was a protocol error
        /// (corrupt frame), not a clean close.
        pub fn isAttached(self: *const Self) bool {
            if (Environment.isWindows) return self.backend.pipe != null;
            return !self.backend.socket.isDetached();
        }

        /// True while any encoded bytes are still queued or in flight.
        pub fn hasPendingWrites(self: *const Self) bool {
            if (self.out.items.len > 0) return true;
            if (Environment.isWindows) return self.backend.inflight.items.len > 0;
            return false;
        }

        /// Best-effort drain of any buffered writes.
        pub fn flush(self: *Self) void {
            if (Environment.isWindows) return self.submitWindowsWrite();
            while (self.out.items.len > 0 and !self.done) {
                const wrote = self.backend.socket.write(self.out.items);
                if (wrote <= 0) return;
                const w: usize = @intCast(wrote);
                std.mem.copyForwards(u8, self.out.items[0 .. self.out.items.len - w], self.out.items[w..]);
                self.out.items.len -= w;
            }
        }

        pub fn close(self: *Self) void {
            if (self.done) return;
            self.flush();
            if (Environment.isWindows) {
                if (self.backend.pipe) |p| if (!p.isClosing()) {
                    self.backend.pipe = null;
                    p.closeAndDestroy();
                };
            } else {
                self.backend.socket.close(.normal);
            }
            self.markDone();
        }

        pub fn deinit(self: *Self) void {
            self.done = true;
            if (Environment.isWindows) {
                if (self.backend.pipe) |p| {
                    self.backend.pipe = null;
                    p.closeAndDestroy();
                }
                self.backend.inflight.deinit(bun.default_allocator);
            } else if (!self.backend.socket.isDetached()) {
                self.backend.socket.close(.normal);
            }
            self.in.deinit(bun.default_allocator);
            self.out.deinit(bun.default_allocator);
        }

        // -- frame decode (shared) -----------------------------------------

        fn ingest(self: *Self, data: []const u8) void {
            bun.handleOom(self.in.appendSlice(bun.default_allocator, data));
            var head: usize = 0;
            while (self.in.items.len - head >= 5) {
                const len = std.mem.readInt(u32, self.in.items[head..][0..4], .little);
                if (len > Frame.max_payload) {
                    self.markDone();
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

        fn markDone(self: *Self) void {
            if (self.done) return;
            self.done = true;
            self.owner.onChannelDone();
        }

        // -- platform callbacks --------------------------------------------

        const PosixHandlers = struct {
            pub fn onOpen(_: *Self, _: Socket) void {}
            pub fn onData(self: *Self, _: Socket, data: []const u8) void {
                self.ingest(data);
            }
            pub fn onWritable(self: *Self, _: Socket) void {
                self.flush();
            }
            pub fn onClose(self: *Self, _: Socket, _: c_int, _: ?*anyopaque) void {
                self.backend.socket = .detached;
                self.markDone();
            }
            pub fn onEnd(_: *Self, sock: Socket) void {
                sock.close(.normal);
            }
            pub fn onTimeout(_: *Self, _: Socket) void {}
            pub fn onLongTimeout(_: *Self, _: Socket) void {}
            pub fn onConnectError(_: *Self, _: Socket, _: c_int) void {}
            pub fn onHandshake(_: *Self, _: Socket, _: i32, _: uws.us_bun_verify_error_t) void {}
        };

        const WindowsHandlers = struct {
            pub fn onAlloc(self: *Self, suggested: usize) []u8 {
                _ = suggested;
                return self.backend.read_chunk[0..];
            }
            pub fn onRead(self: *Self, data: []const u8) void {
                self.ingest(data);
            }
            pub fn onError(self: *Self, _: bun.sys.E) void {
                // Mirror the POSIX onClose path: detach the transport before
                // signalling done so the owner can tell EOF apart from a
                // protocol error (where the pipe is still attached).
                if (self.backend.pipe) |p| {
                    self.backend.pipe = null;
                    p.closeAndDestroy();
                }
                self.markDone();
            }
            pub fn onWrite(self: *Self, status: uv.ReturnCode) void {
                self.backend.inflight.clearRetainingCapacity();
                if (self.done) return;
                if (status.toError(.write)) |_| {
                    self.markDone();
                    return;
                }
                self.submitWindowsWrite();
            }
        };
    };
}

const Frame = @import("./Frame.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const uws = bun.uws;
const uv = if (Environment.isWindows) bun.windows.libuv else struct {};
