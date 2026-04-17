//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

pub const Worker = @This();

coord: *Coordinator,
idx: u32,
process: ?*bun.spawn.Process = null,
/// Where the coordinator writes `.run`/`.shutdown` frames. On POSIX this is
/// the same fd `ipc.reader` reads results from (the socketpair is full-duplex)
/// — owned by the reader, so close paths skip it. On Windows it's the separate
/// stdin write end and is owned here.
cmd_fd: ?bun.FD = null,
cmd_fd_shared_with_ipc: bool = false,

ipc: WorkerPipe,
out: WorkerPipe,
err: WorkerPipe,

/// Index into `Coordinator.files` currently running on this worker.
inflight: ?u32 = null,
/// Contiguous slice of `Coordinator.files` owned by this worker. `files`
/// is sorted lexicographically so adjacent indices share parent dirs (and
/// likely imports); each worker walks its range front-to-back. When the
/// range is empty the worker steals one file from the *end* of whichever
/// range has the most remaining — the end is furthest from that worker's
/// hot region.
range: FileRange = .{ .lo = 0, .hi = 0 },
/// `std.time.milliTimestamp()` at the most recent dispatch; drives lazy
/// scale-up.
dispatched_at: i64 = 0,
/// Worker stdout+stderr since the last `test_done`. Flushed atomically
/// under the right file header so concurrent files don't interleave.
captured: std.ArrayListUnmanaged(u8) = .empty,
alive: bool = false,
/// Set when the process-exit notification arrives. Reaping waits for both
/// this and `ipc.done` so trailing IPC frames are decoded first.
exit_status: ?bun.spawn.Status = null,
extra_fd_stdio: [1]bun.spawn.SpawnOptions.Stdio = .{.ignore},

pub fn start(this: *Worker) !void {
    bun.assert(!this.alive);
    const coord = this.coord;

    this.ipc.reader.setParent(&this.ipc);
    this.out.reader.setParent(&this.out);
    this.err.reader.setParent(&this.err);

    // All resource cleanup on any error return — including watchOrReap
    // failure below. Each guard checks for null/unstarted so the order in
    // which fields are populated doesn't matter.
    errdefer {
        if (this.process) |p| {
            p.exit_handler = .{};
            if (!p.hasExited()) _ = p.kill(9);
            p.close();
            this.process = null;
        }
        if (this.cmd_fd) |fd| {
            if (!this.cmd_fd_shared_with_ipc) fd.close();
            this.cmd_fd = null;
        }
        this.ipc.deinit();
        this.out.deinit();
        this.err.deinit();
    }

    if (Environment.isPosix) {
        // `.buffer` extra_fd creates a socketpair (full-duplex). The parent
        // end is both the IPC reader's fd and the command-write fd; stdin is
        // unused.
        this.extra_fd_stdio = .{.buffer};
        const options: bun.spawn.SpawnOptions = .{
            .stdin = .ignore,
            .stdout = .buffer,
            .stderr = .buffer,
            .extra_fds = &this.extra_fd_stdio,
            .cwd = coord.cwd,
            .stream = true,
            // Own pgrp so abortAll can kill(-pid, SIGTERM) the worker and
            // anything it spawned. PDEATHSIG is the SIGKILL safety net on
            // Linux for the worker itself.
            .new_process_group = true,
            .linux_pdeathsig = if (Environment.isLinux) std.posix.SIG.KILL else null,
        };
        var spawned = try (try bun.spawn.spawnProcess(&options, coord.argv.ptr, coord.envp)).unwrap();
        defer spawned.extra_pipes.deinit();
        this.process = spawned.toProcess(coord.vm.eventLoop(), false);
        if (spawned.stdout) |fd| try this.out.reader.start(fd, true).unwrap();
        if (spawned.stderr) |fd| try this.err.reader.start(fd, true).unwrap();
        if (spawned.extra_pipes.items.len > 0) {
            const ipc_fd = spawned.extra_pipes.items[0];
            this.cmd_fd = ipc_fd;
            this.cmd_fd_shared_with_ipc = true;
            try this.ipc.reader.start(ipc_fd, true).unwrap();
        } else {
            this.ipc.done = true;
        }
    } else {
        // Windows: uv_pipe() pairs are unidirectional, so commands and
        // results need separate channels (stdin for commands, fd 3 for
        // results). Both are non-overlapped so the coordinator's sync
        // bun.sys.write(cmd_fd) and the worker's sync write(ipcFd) work;
        // BufferedReader handles async reads on either via libuv.
        // TODO: verify on Windows CI.
        const uv = bun.windows.libuv;

        var stdin_pair = try bun.sys.pipe().unwrap();
        errdefer for (&stdin_pair) |*fd| {
            if (fd.isValid()) fd.close();
        };
        var ipc_pair = try bun.sys.pipe().unwrap();
        errdefer for (&ipc_pair) |*fd| {
            if (fd.isValid()) fd.close();
        };

        this.extra_fd_stdio = .{.{ .pipe = ipc_pair[1] }};
        const options: bun.spawn.SpawnOptions = .{
            .stdin = .{ .pipe = stdin_pair[0] },
            .stdout = .{ .buffer = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe)) },
            .stderr = .{ .buffer = bun.new(uv.Pipe, std.mem.zeroes(uv.Pipe)) },
            .extra_fds = &this.extra_fd_stdio,
            .cwd = coord.cwd,
            .windows = .{ .loop = jsc.EventLoopHandle.init(coord.vm) },
            .stream = true,
        };
        var spawned = try (try bun.spawn.spawnProcess(&options, coord.argv.ptr, coord.envp)).unwrap();
        this.process = spawned.toProcess(coord.vm.eventLoop(), false);

        stdin_pair[0].close();
        stdin_pair[0] = bun.FD.invalid;
        ipc_pair[1].close();
        ipc_pair[1] = bun.FD.invalid;
        this.cmd_fd = stdin_pair[1];
        this.cmd_fd_shared_with_ipc = false;
        stdin_pair[1] = bun.FD.invalid;

        try this.ipc.reader.start(ipc_pair[0], true).unwrap();
        ipc_pair[0] = bun.FD.invalid;
        if (spawned.stdout == .buffer) try this.out.reader.startWithPipe(spawned.stdout.buffer).unwrap();
        if (spawned.stderr == .buffer) try this.err.reader.startWithPipe(spawned.stderr.buffer).unwrap();
        spawned.extra_pipes.deinit();
    }

    const process = this.process.?;
    if (Environment.isWindows) {
        if (coord.windows_job) |job| {
            if (process.poller == .uv) {
                _ = bun.windows.AssignProcessToJobObject(job, process.poller.uv.process_handle);
            }
        }
    }
    this.alive = true;
    coord.live_workers += 1;
    process.setExitHandler(this);
    switch (process.watchOrReap()) {
        .result => {},
        .err => |e| {
            // Surface to the caller (spawnWorker / onWorkerExit) instead of
            // synchronously firing onExit() — that would re-enter
            // onWorkerExit() → start(), which under persistent EMFILE
            // recurses unboundedly while spawning real processes each frame.
            // Resource cleanup is handled by the function-scope errdefer.
            this.alive = false;
            coord.live_workers -= 1;
            Output.err(e, "watchOrReap failed for test worker", .{});
            return error.ProcessWatchFailed;
        },
    }
}

pub fn onProcessExit(this: *Worker, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
    this.alive = false;
    if (this.cmd_fd) |fd| {
        if (!this.cmd_fd_shared_with_ipc) fd.close();
        this.cmd_fd = null;
    }
    this.coord.onWorkerExit(this, status);
}

pub fn eventLoop(this: *Worker) *jsc.EventLoop {
    return this.coord.vm.eventLoop();
}
pub fn loop(this: *Worker) *bun.Async.Loop {
    return this.coord.vm.uvLoop();
}

pub fn dispatch(this: *Worker, file_idx: u32, file: []const u8) void {
    const fd = this.cmd_fd orelse return;
    const f = &this.coord.frame;
    f.begin(.run);
    f.u32_(file_idx);
    f.str(file);
    f.send(fd);
    this.inflight = file_idx;
    this.dispatched_at = std.time.milliTimestamp();
}

pub fn shutdown(this: *Worker) void {
    if (this.cmd_fd) |fd| {
        const f = &this.coord.frame;
        f.begin(.shutdown);
        f.send(fd);
        // When the command fd is the IPC socketpair end, leave it open: the
        // worker exits on `.shutdown` and the IPC reader still needs the fd to
        // drain trailing repeat_bufs/junit_file/coverage_file frames.
        if (!this.cmd_fd_shared_with_ipc) fd.close();
        this.cmd_fd = null;
    }
}

/// Reads worker output (IPC, stdout, or stderr) and routes it. One per pipe.
/// IPC bytes are frame-decoded; stdout/stderr accumulate into the worker's
/// `captured` buffer and flush atomically with the next test result so console
/// output from concurrent files never interleaves.
pub const WorkerPipe = struct {
    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(WorkerPipe),
    worker: *Worker,
    role: enum { ipc, stdout, stderr },
    buf: std.ArrayListUnmanaged(u8) = .empty,
    /// EOF or error observed. For the IPC pipe this gates `tryReap` so
    /// kernel-buffered frames written just before exit() are decoded
    /// before the pipe is torn down.
    done: bool = false,

    pub fn deinit(this: *WorkerPipe) void {
        this.reader.deinit();
        this.buf.deinit(bun.default_allocator);
    }

    pub fn onReadChunk(this: *WorkerPipe, chunk: []const u8, _: bun.io.ReadState) bool {
        if (this.role != .ipc) {
            bun.handleOom(this.worker.captured.appendSlice(bun.default_allocator, chunk));
            return true;
        }
        bun.handleOom(this.buf.appendSlice(bun.default_allocator, chunk));
        var head: usize = 0;
        while (this.buf.items.len - head >= 5) {
            const len = std.mem.readInt(u32, this.buf.items[head..][0..4], .little);
            if (len > Frame.max_payload) {
                // Corrupt or hostile frame (test JS wrote to fd 3). Kill the
                // worker so onWorkerExit accounts for the in-flight file and
                // the slot can respawn.
                this.buf.clearRetainingCapacity();
                this.done = true;
                if (this.worker.process) |p| _ = p.kill(9);
                return false;
            }
            if (this.buf.items.len - head < @as(usize, 5) + len) break;
            const kind = std.meta.intToEnum(Frame.Kind, this.buf.items[head + 4]) catch {
                head += @as(usize, 5) + len;
                continue;
            };
            var rd = Frame.Reader{ .p = this.buf.items[head + 5 ..][0..len] };
            this.worker.coord.onFrame(this.worker, kind, &rd);
            head += @as(usize, 5) + len;
        }
        if (head > 0) {
            const rest = this.buf.items.len - head;
            std.mem.copyForwards(u8, this.buf.items[0..rest], this.buf.items[head..]);
            this.buf.items.len = rest;
        }
        return true;
    }
    pub fn onReaderDone(this: *WorkerPipe) void {
        this.done = true;
        if (this.role == .ipc) this.worker.coord.tryReap(this.worker);
    }
    pub fn onReaderError(this: *WorkerPipe, _: bun.sys.Error) void {
        this.done = true;
        if (this.role == .ipc) this.worker.coord.tryReap(this.worker);
    }
    pub fn eventLoop(this: *WorkerPipe) *jsc.EventLoop {
        return this.worker.coord.vm.eventLoop();
    }
    pub fn loop(this: *WorkerPipe) *bun.Async.Loop {
        return this.worker.coord.vm.uvLoop();
    }
};

const FileRange = @import("./FileRange.zig");
const Frame = @import("./Frame.zig");
const std = @import("std");
const Coordinator = @import("./Coordinator.zig").Coordinator;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const jsc = bun.jsc;
