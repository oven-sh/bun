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
//! Lifetime: a `Channel` is embedded as `owner_field` in an owner that
//! outlives all uv/usockets callbacks (the coordinator's `Worker[]`, or the
//! worker's `WorkerLoop` which lives for the process). The owner is recovered
//! via `@fieldParentPtr` so the channel default-inits without a self-pointer.
//! `deinit` assumes no write is in flight — true for both call sites (start()
//! errdefer and reapWorker after the peer has exited).

pub fn Channel(comptime Owner: type, comptime owner_field: []const u8) type {
    return struct {
        const Self = @This();

        /// Incoming bytes that don't yet form a complete frame.
        in: std.ArrayListUnmanaged(u8) = .empty,
        /// Outgoing bytes the kernel didn't accept yet.
        out: std.ArrayListUnmanaged(u8) = .empty,
        done: bool = false,

        backend: Backend = .{},
        const Backend = if (Environment.isWindows) WindowsBackend else PosixBackend;

        inline fn owner(self: *Self) *Owner {
            return @alignCast(@fieldParentPtr(owner_field, self));
        }

        // -- POSIX (usockets) ----------------------------------------------

        pub const Socket = if (Environment.isWindows) void else uws.NewSocketHandler(false);

        const PosixBackend = struct {
            socket: Socket = .detached,
        };

        /// Shared embedded group for this channel. Uses `.dynamic` kind +
        /// per-Owner vtable because the test-parallel channel is an
        /// internal-only one-off whose ext type (`*Self`) varies by Owner —
        /// not worth a `SocketKind` value of its own. The per-file isolation
        /// swap skips `rare.test_parallel_ipc_group` so the coordinator link
        /// survives.
        fn ensurePosixGroup(vm: *jsc.VirtualMachine) *uws.SocketGroup {
            const g = vm.rareData().testParallelIPCGroup(vm);
            // First Owner to call wins the vtable; coordinator and worker run
            // in separate processes so there's never more than one Owner type
            // sharing this group.
            if (g.vtable == null) g.vtable = uws.vtable.make(PosixHandlers);
            return g;
        }

        // -- Windows (uv.Pipe) ---------------------------------------------

        const WindowsBackend = struct {
            pipe: ?*uv.Pipe = null,
            /// Read scratch — libuv asks us to allocate before each read.
            read_chunk: [16 * 1024]u8 = [_]u8{0} ** (16 * 1024),
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
                // ipc=true matches ipc.zig windowsConfigureClient. With ipc=true
                // libuv wraps reads/writes in its own framing; both ends use it
                // so the wrapping is transparent and our payload bytes pass
                // through unchanged. With ipc=false the parent end (created by
                // uv_spawn for the .ipc stdio container, which always inits with
                // ipc=true) and child end disagree on framing and the channel
                // never delivers a frame.
                const pipe = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe));
                pipe.init(uv.Loop.get(), true).unwrap() catch |e| {
                    bun.Output.debugWarn("Channel.adopt: uv_pipe_init failed: {s}", .{@errorName(e)});
                    bun.destroy(pipe);
                    return false;
                };
                pipe.open(fd).unwrap() catch |e| {
                    bun.Output.debugWarn("Channel.adopt: uv_pipe_open({d}) failed: {s}", .{ fd.uv(), @errorName(e) });
                    pipe.closeAndDestroy();
                    return false;
                };
                if (!self.adoptPipe(vm, pipe)) {
                    pipe.closeAndDestroy();
                    return false;
                }
                return true;
            }
            const g = ensurePosixGroup(vm);
            const sock = Socket.fromFd(g, .dynamic, fd, Self, self, null, true) orelse return false;
            self.backend.socket = sock;
            sock.setTimeout(0);
            return true;
        }

        /// Windows-only: adopt a `uv.Pipe` already initialized by spawn (the
        /// `.ipc` extra-fd parent end, or the worker's just-opened pipe).
        /// Starts reading. On failure the caller still owns `pipe`.
        ///
        /// Unlike ipc.zig's windowsConfigureServer/Client we keep the pipe
        /// ref'd: the worker (and the coordinator before workers register
        /// process exit handles) has nothing else keeping `uv_loop_alive()`
        /// true, so unref'ing here makes autoTick() take the tickWithoutIdle
        /// (NOWAIT) path and never block for the peer's first frame. The pipe
        /// is closed explicitly in `close()` / `deinit()`, and both sides exit
        /// via Global.exit / drive() returning, so the extra ref never holds
        /// the process open.
        pub fn adoptPipe(self: *Self, _: *jsc.VirtualMachine, pipe: *uv.Pipe) bool {
            if (comptime !Environment.isWindows) @compileError("adoptPipe is Windows-only");
            pipe.readStart(self, WindowsHandlers.onAlloc, WindowsHandlers.onError, WindowsHandlers.onRead).unwrap() catch |e| {
                bun.Output.debugWarn("Channel.adoptPipe: readStart failed: {s}", .{@errorName(e)});
                return false;
            };
            self.backend.pipe = pipe;
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
            // Try a synchronous write first. uv_try_write on a Windows
            // UV_NAMED_PIPE always returns EAGAIN (vendor/libuv/src/win/stream.c),
            // so this currently always falls through to submitWindowsWrite — kept
            // because EBADF/EPIPE here mean the pipe is dead and must not silently
            // drop the frame.
            const w: usize = switch (pipe.tryWrite(frame_bytes)) {
                .result => |n| n,
                .err => |e| if (e.getErrno() == .AGAIN) 0 else {
                    self.markDone();
                    return;
                },
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
                self.backend.inflight = .empty;
            } else if (!self.backend.socket.isDetached()) {
                self.backend.socket.close(.normal);
                self.backend.socket = .detached;
            }
            self.in.deinit(bun.default_allocator);
            self.in = .empty;
            self.out.deinit(bun.default_allocator);
            self.out = .empty;
        }

        // -- frame decode (shared) -----------------------------------------

        fn ingest(self: *Self, data: []const u8) void {
            if (self.done) return;
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
                self.owner().onChannelFrame(kind, &rd);
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
            self.owner().onChannelDone();
        }

        // -- platform callbacks --------------------------------------------

        /// `vtable.make()` shape: `(ext: **Self, *us_socket_t, …)`.
        const PosixHandlers = struct {
            pub const Ext = **Self;
            pub fn onData(self: Ext, _: *uws.us_socket_t, data: []const u8) void {
                self.*.ingest(data);
            }
            pub fn onWritable(self: Ext, _: *uws.us_socket_t) void {
                self.*.flush();
            }
            pub fn onClose(self: Ext, _: *uws.us_socket_t, _: i32, _: ?*anyopaque) void {
                self.*.backend.socket = .detached;
                self.*.markDone();
            }
            pub fn onEnd(_: Ext, s: *uws.us_socket_t) void {
                _ = s.close(.normal, null);
            }
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

const uv = if (Environment.isWindows) bun.windows.libuv else struct {};

const Frame = @import("./Frame.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const uws = bun.uws;
