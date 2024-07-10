const std = @import("std");
const system = if (bun.Environment.isWindows) std.os.windows else std.posix.system;
const bun = @import("root").bun;

// https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc
pub const ThreadPool = struct {
    state: usize = 0,
    spawned: usize = 0,
    run_queue: Queue,
    idle_semaphore: Semaphore,
    allocator: std.mem.Allocator,
    workers: []Worker = &[_]Worker{},

    pub const InitConfig = struct {
        allocator: ?std.mem.Allocator = null,
        max_threads: ?usize = null,

        var default_gpa = std.heap.GeneralPurposeAllocator(.{}){};
        var default_allocator = &default_gpa.allocator;
    };

    pub fn init(self: *ThreadPool, config: InitConfig) !void {
        self.* = ThreadPool{
            .run_queue = Queue.init(),
            .idle_semaphore = Semaphore.init(0),
            .allocator = config.allocator orelse InitConfig.default_allocator,
        };

        errdefer self.deinit();

        const num_workers = @max(1, config.max_threads orelse std.Thread.cpuCount() catch 1);
        self.workers = try self.allocator.alloc(Worker, num_workers);

        for (&self.workers) |*worker| {
            try worker.init(self);
            @atomicStore(usize, &self.spawned, self.spawned + 1, .seq_cst);
        }
    }

    pub fn deinit(self: *ThreadPool) void {
        self.shutdown();

        for (&self.workers[0..self.spawned]) |*worker|
            worker.deinit();

        while (self.run_queue.pop()) |run_node|
            (run_node.data.runFn)(&run_node.data);

        self.allocator.free(self.workers);
        self.idle_semaphore.deinit();
        self.run_queue.deinit();
        self.* = undefined;
    }

    pub fn spawn(self: *ThreadPool, comptime func: anytype, args: anytype) !void {
        const Args = @TypeOf(args);
        const Closure = struct {
            func_args: Args,
            allocator: std.mem.Allocator,
            run_node: RunNode = .{ .data = .{ .runFn = runFn } },

            fn runFn(runnable: *Runnable) void {
                const run_node: *RunNode = @fieldParentPtr("data", runnable);
                const closure: *@This() = @fieldParentPtr("run_node", run_node);
                _ = @call(.auto, func, closure.func_args);
                closure.allocator.destroy(closure);
            }
        };

        const allocator = self.allocator;
        const closure = try allocator.create(Closure);
        errdefer allocator.destroy(closure);
        closure.* = Closure{
            .func_args = args,
            .allocator = allocator,
        };

        const run_node = &closure.run_node;
        if (Worker.current) |worker| {
            worker.run_queue.push(run_node);
        } else {
            self.run_queue.push(run_node);
        }

        self.notify();
    }

    const State = struct {
        is_shutdown: bool = false,
        is_notified: bool = false,
        idle_workers: usize = 0,

        fn pack(self: State) usize {
            return ((@as(usize, @intFromBool(self.is_shutdown)) << 0) |
                (@as(usize, @intFromBool(self.is_notified)) << 1) |
                (self.idle_workers << 2));
        }

        fn unpack(value: usize) State {
            return State{
                .is_shutdown = value & (1 << 0) != 0,
                .is_notified = value & (1 << 1) != 0,
                .idle_workers = value >> 2,
            };
        }
    };

    fn wait(self: *ThreadPool) error{Shutdown}!void {
        var state = State.unpack(@atomicLoad(usize, &self.state, .seq_cst));
        while (true) {
            if (state.is_shutdown)
                return error.Shutdown;

            var new_state = state;
            if (state.is_notified) {
                new_state.is_notified = false;
            } else {
                new_state.idle_workers += 1;
            }

            if (@cmpxchgWeak(
                usize,
                &self.state,
                state.pack(),
                new_state.pack(),
                .seq_cst,
                .seq_cst,
            )) |updated| {
                state = State.unpack(updated);
                continue;
            }

            if (!state.is_notified)
                self.idle_semaphore.wait();
            return;
        }
    }

    fn notify(self: *ThreadPool) void {
        var state = State.unpack(@atomicLoad(usize, &self.state, .seq_cst));
        while (true) {
            if (state.is_shutdown)
                return;

            var new_state = state;
            if (state.is_notified) {
                return;
            } else if (state.idle_workers == 0) {
                new_state.is_notified = true;
            } else {
                new_state.idle_workers -= 1;
            }

            if (@cmpxchgWeak(
                usize,
                &self.state,
                state.pack(),
                new_state.pack(),
                .seq_cst,
                .seq_cst,
            )) |updated| {
                state = State.unpack(updated);
                continue;
            }

            if (!new_state.is_notified)
                self.idle_semaphore.post();
            return;
        }
    }

    fn shutdown(self: *ThreadPool) void {
        var state = State.unpack(@atomicRmw(
            usize,
            &self.state,
            .Xchg,
            (State{ .is_shutdown = true }).pack(),
            .seq_cst,
        ));

        while (state.idle_workers > 0) : (state.idle_workers -= 1)
            self.idle_semaphore.post();
    }

    const Worker = struct {
        thread: *std.Thread,
        run_queue: Queue,

        fn init(self: *Worker, pool: *ThreadPool) !void {
            self.* = Worker{
                .thread = undefined,
                .run_queue = Queue.init(),
            };

            self.thread = std.Thread.spawn(
                Worker.run,
                RunConfig{
                    .worker = self,
                    .pool = pool,
                },
            ) catch |err| {
                self.run_queue.deinit();
                return err;
            };
        }

        fn deinit(self: *Worker) void {
            self.thread.wait();
            self.run_queue.deinit();
            self.* = undefined;
        }

        threadlocal var current: ?*Worker = null;

        const RunConfig = struct {
            worker: *Worker,
            pool: *ThreadPool,
        };

        fn run(config: RunConfig) void {
            const self = config.worker;
            const pool = config.pool;

            const old_current = current;
            current = self;
            defer current = old_current;

            var tick = @intFromPtr(self);
            var prng = std.rand.DefaultPrng.init(tick);

            while (true) {
                const run_node = self.poll(tick, pool, &prng.random) orelse {
                    pool.wait() catch break;
                    continue;
                };

                tick +%= 1;
                (run_node.data.runFn)(&run_node.data);
            }
        }

        fn poll(self: *Worker, tick: usize, pool: *ThreadPool, rand: *std.rand.Random) ?*RunNode {
            if (tick % 128 == 0) {
                if (self.steal(pool, rand, .fair)) |run_node|
                    return run_node;
            }

            if (tick % 64 == 0) {
                if (self.run_queue.steal(&pool.run_queue, .fair)) |run_node|
                    return run_node;
            }

            if (self.run_queue.pop()) |run_node|
                return run_node;

            var attempts: usize = 8;
            while (attempts > 0) : (attempts -= 1) {
                if (self.steal(pool, rand, .unfair)) |run_node| {
                    return run_node;
                } else {
                    std.posix.sched_yield() catch spinLoopHint();
                }
            }

            if (self.run_queue.steal(&pool.run_queue, .unfair)) |run_node|
                return run_node;

            return null;
        }

        fn steal(self: *Worker, pool: *ThreadPool, rand: *std.rand.Random, mode: anytype) ?*RunNode {
            const spawned = @atomicLoad(usize, &pool.spawned, .seq_cst);
            if (spawned < 2)
                return null;

            var index = rand.uintLessThan(usize, spawned);

            var iter = spawned;
            while (iter > 0) : (iter -= 1) {
                const target = &pool.workers[index];

                index += 1;
                if (index == spawned)
                    index = 0;

                if (target == self)
                    continue;
                if (self.run_queue.steal(&target.run_queue, mode)) |run_node|
                    return run_node;
            }

            return null;
        }
    };

    const Queue = struct {
        mutex: Mutex,
        size: usize,
        list: List,

        fn init() Queue {
            return Queue{
                .mutex = Mutex.init(),
                .size = 0,
                .list = .{},
            };
        }

        fn deinit(self: *Queue) void {
            self.mutex.deinit();
            self.* = undefined;
        }

        fn push(self: *Queue, node: *List.Node) void {
            self.mutex.lock();
            defer self.mutex.unlock();

            self.list.prepend(node);
            @atomicStore(usize, &self.size, self.size + 1, .seq_cst);
        }

        fn pop(self: *Queue) ?*List.Node {
            return self.popFrom(.head);
        }

        fn steal(_: *Queue, target: *Queue, mode: enum { fair, unfair }) ?*RunNode {
            return target.popFrom(switch (mode) {
                .fair => .tail,
                .unfair => .head,
            });
        }

        fn popFrom(self: *Queue, side: enum { head, tail }) ?*RunNode {
            if (@atomicLoad(usize, &self.size, .seq_cst) == 0)
                return null;

            self.mutex.lock();
            defer self.mutex.unlock();

            // potential deadlock when all pops are fair..
            const run_node = switch (side) {
                .head => self.list.popFirst(),
                .tail => self.list.pop(),
            };

            if (run_node != null)
                @atomicStore(usize, &self.size, self.size - 1, .seq_cst);

            return run_node;
        }
    };

    const List = std.TailQueue(Runnable);
    const RunNode = List.Node;
    const Runnable = struct {
        runFn: *const (fn (*Runnable) void),
    };
};

pub fn Channel(
    comptime T: type,
    comptime buffer_type: std.fifo.LinearFifoBufferType,
) type {
    return struct {
        mutex: Mutex,
        putters: Condvar,
        getters: Condvar,
        buffer: Buffer,
        is_closed: bool,

        const Self = @This();
        const Buffer = std.fifo.LinearFifo(T, buffer_type);

        pub usingnamespace switch (buffer_type) {
            .Static => struct {
                pub inline fn init() Self {
                    return Self.withBuffer(Buffer.init());
                }
            },
            .Slice => struct {
                pub inline fn init(buf: []T) Self {
                    return Self.withBuffer(Buffer.init(buf));
                }
            },
            .Dynamic => struct {
                pub inline fn init(allocator: std.mem.Allocator) Self {
                    return Self.withBuffer(Buffer.init(allocator));
                }
            },
        };

        fn withBuffer(buffer: Buffer) Self {
            return Self{
                .mutex = Mutex.init(),
                .putters = Condvar.init(),
                .getters = Condvar.init(),
                .buffer = buffer,
                .is_closed = false,
            };
        }

        pub fn deinit(self: *Self) void {
            self.mutex.deinit();
            self.putters.deinit();
            self.getters.deinit();
            self.buffer.deinit();
            self.* = undefined;
        }

        pub fn close(self: *Self) void {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.is_closed)
                return;

            self.is_closed = true;
            self.putters.broadcast();
            self.getters.broadcast();
        }

        pub fn tryWriteItem(self: *Self, item: T) !bool {
            const wrote = try self.write(&[1]T{item});
            return wrote == 1;
        }

        pub fn writeItem(self: *Self, item: T) !void {
            return self.writeAll(&[1]T{item});
        }

        pub fn write(self: *Self, items: []const T) !usize {
            return self.writeItems(items, false);
        }

        pub fn tryReadItem(self: *Self) !?T {
            var items: [1]T = undefined;
            if ((try self.read(&items)) != 1)
                return null;
            return items[0];
        }

        pub fn readItem(self: *Self) !T {
            var items: [1]T = undefined;
            try self.readAll(&items);
            return items[0];
        }

        pub fn read(self: *Self, items: []T) !usize {
            return self.readItems(items, false);
        }

        pub fn writeAll(self: *Self, items: []const T) !void {
            bun.assert((try self.writeItems(items, true)) == items.len);
        }

        pub fn readAll(self: *Self, items: []T) !void {
            bun.assert((try self.readItems(items, true)) == items.len);
        }

        fn writeItems(self: *Self, items: []const T, should_block: bool) !usize {
            self.mutex.lock();
            defer self.mutex.unlock();

            var pushed: usize = 0;
            while (pushed < items.len) {
                const did_push = blk: {
                    if (self.is_closed)
                        return error.Closed;

                    self.buffer.write(items) catch |err| {
                        if (buffer_type == .Dynamic)
                            return err;
                        break :blk false;
                    };

                    self.getters.signal();
                    break :blk true;
                };

                if (did_push) {
                    pushed += 1;
                } else if (should_block) {
                    self.putters.wait(&self.mutex);
                } else {
                    break;
                }
            }

            return pushed;
        }

        fn readItems(self: *Self, items: []T, should_block: bool) !usize {
            self.mutex.lock();
            defer self.mutex.unlock();

            var popped: usize = 0;
            while (popped < items.len) {
                const new_item = blk: {
                    // Buffer can contain null items but readItem will return null if the buffer is empty.
                    // we need to check if the buffer is empty before trying to read an item.
                    if (self.buffer.count == 0) {
                        if (self.is_closed)
                            return error.Closed;
                        break :blk null;
                    }

                    const item = self.buffer.readItem();
                    self.putters.signal();
                    break :blk item;
                };

                if (new_item) |item| {
                    items[popped] = item;
                    popped += 1;
                } else if (should_block) {
                    self.getters.wait(&self.mutex);
                } else {
                    break;
                }
            }

            return popped;
        }
    };
}

pub const RwLock = if (@import("builtin").os.tag != .windows and @import("builtin").link_libc)
    struct {
        rwlock: if (@import("builtin").os.tag != .windows) pthread_rwlock_t else void,

        pub fn init() RwLock {
            return .{ .rwlock = PTHREAD_RWLOCK_INITIALIZER };
        }

        pub fn deinit(self: *RwLock) void {
            const safe_rc = switch (@import("builtin").os.tag) {
                .dragonfly, .netbsd => std.posix.EAGAIN,
                else => 0,
            };

            const rc = std.c.pthread_rwlock_destroy(&self.rwlock);
            bun.assert(rc == .SUCCESS or rc == safe_rc);

            self.* = undefined;
        }

        pub fn tryLock(self: *RwLock) bool {
            return pthread_rwlock_trywrlock(&self.rwlock) == 0;
        }

        pub fn lock(self: *RwLock) void {
            const rc = pthread_rwlock_wrlock(&self.rwlock);
            bun.assert(rc == .SUCCESS);
        }

        pub fn unlock(self: *RwLock) void {
            const rc = pthread_rwlock_unlock(&self.rwlock);
            bun.assert(rc == .SUCCESS);
        }

        pub fn tryLockShared(self: *RwLock) bool {
            return pthread_rwlock_tryrdlock(&self.rwlock) == 0;
        }

        pub fn lockShared(self: *RwLock) void {
            const rc = pthread_rwlock_rdlock(&self.rwlock);
            bun.assert(rc == .SUCCESS);
        }

        pub fn unlockShared(self: *RwLock) void {
            const rc = pthread_rwlock_unlock(&self.rwlock);
            bun.assert(rc == .SUCCESS);
        }

        const PTHREAD_RWLOCK_INITIALIZER = pthread_rwlock_t{};
        pub const pthread_rwlock_t = switch (@import("builtin").os.tag) {
            .macos, .ios, .watchos, .tvos => extern struct {
                __sig: c_long = 0x2DA8B3B4,
                __opaque: [192]u8 = [_]u8{0} ** 192,
            },
            .linux => switch (@import("builtin").abi) {
                .android => switch (@sizeOf(usize)) {
                    4 => extern struct {
                        lock: std.c.pthread_mutex_t = std.c.PTHREAD_MUTEX_INITIALIZER,
                        cond: std.c.pthread_cond_t = std.c.PTHREAD_COND_INITIALIZER,
                        numLocks: c_int = 0,
                        writerThreadId: c_int = 0,
                        pendingReaders: c_int = 0,
                        pendingWriters: c_int = 0,
                        attr: i32 = 0,
                        __reserved: [12]u8 = [_]u8{0} ** 2,
                    },
                    8 => extern struct {
                        numLocks: c_int = 0,
                        writerThreadId: c_int = 0,
                        pendingReaders: c_int = 0,
                        pendingWriters: c_int = 0,
                        attr: i32 = 0,
                        __reserved: [36]u8 = [_]u8{0} ** 36,
                    },
                    else => @compileError("unreachable"),
                },
                else => extern struct {
                    size: [56]u8 align(@alignOf(usize)) = [_]u8{0} ** 56,
                },
            },
            .fuchsia => extern struct {
                size: [56]u8 align(@alignOf(usize)) = [_]u8{0} ** 56,
            },
            .emscripten => extern struct {
                size: [32]u8 align(4) = [_]u8{0} ** 32,
            },
            .netbsd => extern struct {
                ptr_magic: c_uint = 0x99990009,
                ptr_interlock: switch (@import("builtin").target.cpu.arch) {
                    .aarch64, .sparc, .x86_64 => u8,
                    .arm, .powerpc => c_int,
                    else => @compileError("unreachable"),
                } = 0,
                ptr_rblocked_first: ?*u8 = null,
                ptr_rblocked_last: ?*u8 = null,
                ptr_wblocked_first: ?*u8 = null,
                ptr_wblocked_last: ?*u8 = null,
                ptr_nreaders: c_uint = 0,
                ptr_owner: std.c.pthread_t = null,
                ptr_private: ?*anyopaque = null,
            },
            .haiku => extern struct {
                flags: u32 = 0,
                owner: i32 = -1,
                lock_sem: i32 = 0,
                lock_count: i32 = 0,
                reader_count: i32 = 0,
                writer_count: i32 = 0,
                waiters: [2]?*anyopaque = [_]?*anyopaque{ null, null },
            },
            .kfreebsd, .freebsd, .openbsd => extern struct {
                ptr: ?*anyopaque = null,
            },
            .hermit => extern struct {
                ptr: usize = std.math.maxInt(usize),
            },
            else => @compileError("pthread_rwlock_t not implemented for this platform"),
        };

        extern "c" fn pthread_rwlock_destroy(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
        extern "c" fn pthread_rwlock_rdlock(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
        extern "c" fn pthread_rwlock_wrlock(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
        extern "c" fn pthread_rwlock_tryrdlock(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
        extern "c" fn pthread_rwlock_trywrlock(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
        extern "c" fn pthread_rwlock_unlock(p: *pthread_rwlock_t) callconv(.C) std.posix.E;
    }
else
    struct {
        /// https://github.com/bloomberg/rwl-bench/blob/master/bench11.cpp
        state: usize,
        mutex: Mutex,
        semaphore: Semaphore,

        const IS_WRITING: usize = 1;
        const WRITER: usize = 1 << 1;
        const READER: usize = 1 << (1 + std.meta.bitCount(Count));
        const WRITER_MASK: usize = std.math.maxInt(Count) << @ctz(WRITER);
        const READER_MASK: usize = std.math.maxInt(Count) << @ctz(READER);
        const Count = std.meta.Int(.unsigned, @divFloor(std.meta.bitCount(usize) - 1, 2));

        pub fn init() RwLock {
            return .{
                .state = 0,
                .mutex = Mutex.init(),
                .semaphore = Semaphore.init(0),
            };
        }

        pub fn deinit(self: *RwLock) void {
            self.semaphore.deinit();
            self.mutex.deinit();
            self.* = undefined;
        }

        pub fn tryLock(self: *RwLock) bool {
            if (self.mutex.tryLock()) {
                const state = @atomicLoad(usize, &self.state, .seq_cst);
                if (state & READER_MASK == 0) {
                    _ = @atomicRmw(usize, &self.state, .Or, IS_WRITING, .seq_cst);
                    return true;
                }

                self.mutex.unlock();
            }

            return false;
        }

        pub fn lock(self: *RwLock) void {
            _ = @atomicRmw(usize, &self.state, .Add, WRITER, .seq_cst);
            self.mutex.lock();

            const state = @atomicRmw(usize, &self.state, .Or, IS_WRITING, .seq_cst);
            if (state & READER_MASK != 0)
                self.semaphore.wait();
        }

        pub fn unlock(self: *RwLock) void {
            _ = @atomicRmw(usize, &self.state, .And, ~IS_WRITING, .seq_cst);
            self.mutex.unlock();
        }

        pub fn tryLockShared(self: *RwLock) bool {
            const state = @atomicLoad(usize, &self.state, .seq_cst);
            if (state & (IS_WRITING | WRITER_MASK) == 0) {
                _ = @cmpxchgStrong(
                    usize,
                    &self.state,
                    state,
                    state + READER,
                    .seq_cst,
                    .seq_cst,
                ) orelse return true;
            }

            if (self.mutex.tryLock()) {
                _ = @atomicRmw(usize, &self.state, .Add, READER, .seq_cst);
                self.mutex.unlock();
                return true;
            }

            return false;
        }

        pub fn lockShared(self: *RwLock) void {
            var state = @atomicLoad(usize, &self.state, .seq_cst);
            while (state & (IS_WRITING | WRITER_MASK) == 0) {
                state = @cmpxchgWeak(
                    usize,
                    &self.state,
                    state,
                    state + READER,
                    .seq_cst,
                    .seq_cst,
                ) orelse return;
            }

            self.mutex.lock();
            _ = @atomicRmw(usize, &self.state, .Add, READER, .seq_cst);
            self.mutex.unlock();
        }

        pub fn unlockShared(self: *RwLock) void {
            const state = @atomicRmw(usize, &self.state, .Sub, READER, .seq_cst);

            if ((state & READER_MASK == READER) and (state & IS_WRITING != 0))
                self.semaphore.post();
        }
    };

pub const WaitGroup = struct {
    mutex: Mutex,
    cond: Condvar,
    active: usize,

    pub fn init() WaitGroup {
        return .{
            .mutex = Mutex.init(),
            .cond = Condvar.init(),
            .active = 0,
        };
    }

    pub fn deinit(self: *WaitGroup) void {
        self.mutex.deinit();
        self.cond.deinit();
        self.* = undefined;
    }

    pub fn addN(self: *WaitGroup, n: usize) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.active += n;
    }

    pub fn add(self: *WaitGroup) void {
        return self.addN(1);
    }

    pub fn done(self: *WaitGroup) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.active -= 1;
        if (self.active == 0)
            self.cond.signal();
    }

    pub fn wait(self: *WaitGroup) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        while (self.active != 0)
            self.cond.wait(&self.mutex);
    }
};

pub const Semaphore = struct {
    mutex: Mutex,
    cond: Condvar,
    permits: usize,

    pub fn init(permits: usize) Semaphore {
        return .{
            .mutex = Mutex.init(),
            .cond = Condvar.init(),
            .permits = permits,
        };
    }

    pub fn deinit(self: *Semaphore) void {
        self.mutex.deinit();
        self.cond.deinit();
        self.* = undefined;
    }

    pub fn wait(self: *Semaphore) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        while (self.permits == 0)
            self.cond.wait(&self.mutex);

        self.permits -= 1;
        if (self.permits > 0)
            self.cond.signal();
    }

    pub fn post(self: *Semaphore) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.permits += 1;
        self.cond.signal();
    }
};

pub const Mutex = if (@import("builtin").os.tag == .windows)
    struct {
        srwlock: SRWLOCK,

        pub fn init() Mutex {
            return .{ .srwlock = SRWLOCK_INIT };
        }

        pub fn deinit(self: *Mutex) void {
            self.* = undefined;
        }

        pub fn tryLock(self: *Mutex) bool {
            return TryAcquireSRWLockExclusive(&self.srwlock) != system.FALSE;
        }

        pub fn lock(self: *Mutex) void {
            AcquireSRWLockExclusive(&self.srwlock);
        }

        pub fn unlock(self: *Mutex) void {
            ReleaseSRWLockExclusive(&self.srwlock);
        }

        const SRWLOCK = usize;
        const SRWLOCK_INIT: SRWLOCK = 0;

        extern "kernel32" fn TryAcquireSRWLockExclusive(s: *SRWLOCK) callconv(system.WINAPI) system.BOOL;
        extern "kernel32" fn AcquireSRWLockExclusive(s: *SRWLOCK) callconv(system.WINAPI) void;
        extern "kernel32" fn ReleaseSRWLockExclusive(s: *SRWLOCK) callconv(system.WINAPI) void;
    }
else if (@import("builtin").link_libc)
    struct {
        mutex: if (@import("builtin").link_libc) std.c.pthread_mutex_t else void,

        pub fn init() Mutex {
            return .{ .mutex = std.c.PTHREAD_MUTEX_INITIALIZER };
        }

        pub fn deinit(self: *Mutex) void {
            const safe_rc = switch (@import("builtin").os.tag) {
                .dragonfly, .netbsd => std.posix.EAGAIN,
                else => 0,
            };

            const rc = std.c.pthread_mutex_destroy(&self.mutex);
            bun.assert(rc == .SUCCESS or rc == safe_rc);

            self.* = undefined;
        }

        pub fn tryLock(self: *Mutex) bool {
            return pthread_mutex_trylock(&self.mutex) == 0;
        }

        pub fn lock(self: *Mutex) void {
            const rc = std.c.pthread_mutex_lock(&self.mutex);
            bun.assert(rc == .SUCCESS);
        }

        pub fn unlock(self: *Mutex) void {
            const rc = std.c.pthread_mutex_unlock(&self.mutex);
            bun.assert(rc == .SUCCESS);
        }

        extern "c" fn pthread_mutex_trylock(m: *std.c.pthread_mutex_t) callconv(.C) c_int;
    }
else if (@import("builtin").os.tag == .linux)
    struct {
        state: State,

        const State = enum(i32) {
            unlocked,
            locked,
            waiting,
        };

        pub fn init() Mutex {
            return .{ .state = .unlocked };
        }

        pub fn deinit(self: *Mutex) void {
            self.* = undefined;
        }

        pub fn tryLock(self: *Mutex) bool {
            return @cmpxchgStrong(
                State,
                &self.state,
                .unlocked,
                .locked,
                .acquire,
                .monotonic,
            ) == null;
        }

        pub fn lock(self: *Mutex) void {
            switch (@atomicRmw(State, &self.state, .Xchg, .locked, .acquire)) {
                .unlocked => {},
                else => |s| self.lockSlow(s),
            }
        }

        fn lockSlow(self: *Mutex, current_state: State) void {
            @setCold(true);

            var new_state = current_state;
            while (true) {
                for (0..100) |spin| {
                    const state = @cmpxchgWeak(
                        State,
                        &self.state,
                        .unlocked,
                        new_state,
                        .acquire,
                        .monotonic,
                    ) orelse return;

                    switch (state) {
                        .unlocked => {},
                        .locked => {},
                        .waiting => break,
                    }

                    for (0..spin) |_|
                        spinLoopHint();
                }

                new_state = .waiting;
                switch (@atomicRmw(State, &self.state, .Xchg, new_state, .acquire)) {
                    .unlocked => return,
                    else => {},
                }

                Futex.wait(
                    @as(*const i32, @ptrCast(&self.state)),
                    @intFromEnum(new_state),
                );
            }
        }

        pub fn unlock(self: *Mutex) void {
            switch (@atomicRmw(State, &self.state, .Xchg, .unlocked, .release)) {
                .unlocked => unreachable,
                .locked => {},
                .waiting => self.unlockSlow(),
            }
        }

        fn unlockSlow(self: *Mutex) void {
            @setCold(true);

            Futex.wake(@as(*const i32, @ptrCast(&self.state)));
        }
    }
else
    struct {
        is_locked: bool,

        pub fn init() Mutex {
            return .{ .is_locked = false };
        }

        pub fn deinit(self: *Mutex) void {
            self.* = undefined;
        }

        pub fn tryLock(self: *Mutex) bool {
            return @atomicRmw(bool, &self.is_locked, .Xchg, true, .acquire) == false;
        }

        pub fn lock(self: *Mutex) void {
            while (!self.tryLock())
                spinLoopHint();
        }

        pub fn unlock(self: *Mutex) void {
            @atomicStore(bool, &self.is_locked, false, .release);
        }
    };

pub const Condvar = if (@import("builtin").os.tag == .windows)
    struct {
        cond: CONDITION_VARIABLE,

        pub fn init() Condvar {
            return .{ .cond = CONDITION_VARIABLE_INIT };
        }

        pub fn deinit(self: *Condvar) void {
            self.* = undefined;
        }

        pub fn wait(self: *Condvar, mutex: *Mutex) void {
            const rc = SleepConditionVariableSRW(
                &self.cond,
                &mutex.srwlock,
                system.INFINITE,
                @as(system.ULONG, 0),
            );

            bun.assert(rc != system.FALSE);
        }

        pub fn signal(self: *Condvar) void {
            WakeConditionVariable(&self.cond);
        }

        pub fn broadcast(self: *Condvar) void {
            WakeAllConditionVariable(&self.cond);
        }

        const SRWLOCK = usize;
        const CONDITION_VARIABLE = usize;
        const CONDITION_VARIABLE_INIT: CONDITION_VARIABLE = 0;

        extern "kernel32" fn WakeAllConditionVariable(c: *CONDITION_VARIABLE) callconv(system.WINAPI) void;
        extern "kernel32" fn WakeConditionVariable(c: *CONDITION_VARIABLE) callconv(system.WINAPI) void;
        extern "kernel32" fn SleepConditionVariableSRW(
            c: *CONDITION_VARIABLE,
            s: *SRWLOCK,
            t: system.DWORD,
            f: system.ULONG,
        ) callconv(system.WINAPI) system.BOOL;
    }
else if (@import("builtin").link_libc)
    struct {
        cond: if (@import("builtin").link_libc) std.c.pthread_cond_t else void,

        pub fn init() Condvar {
            return .{ .cond = std.c.PTHREAD_COND_INITIALIZER };
        }

        pub fn deinit(self: *Condvar) void {
            const safe_rc = switch (@import("builtin").os.tag) {
                .dragonfly, .netbsd => std.posix.EAGAIN,
                else => 0,
            };

            const rc = std.c.pthread_cond_destroy(&self.cond);
            bun.assert(rc == .SUCCESS or rc == safe_rc);

            self.* = undefined;
        }

        pub fn wait(self: *Condvar, mutex: *Mutex) void {
            const rc = std.c.pthread_cond_wait(&self.cond, &mutex.mutex);
            bun.assert(rc == .SUCCESS);
        }

        pub fn signal(self: *Condvar) void {
            const rc = std.c.pthread_cond_signal(&self.cond);
            bun.assert(rc == .SUCCESS);
        }

        pub fn broadcast(self: *Condvar) void {
            const rc = std.c.pthread_cond_broadcast(&self.cond);
            bun.assert(rc == .SUCCESS);
        }
    }
else
    struct {
        mutex: Mutex,
        notified: bool,
        waiters: std.SinglyLinkedList(Event),

        pub fn init() Condvar {
            return .{
                .mutex = Mutex.init(),
                .notified = false,
                .waiters = .{},
            };
        }

        pub fn deinit(self: *Condvar) void {
            self.mutex.deinit();
            self.* = undefined;
        }

        pub fn wait(self: *Condvar, mutex: *Mutex) void {
            self.mutex.lock();

            if (self.notified) {
                self.notified = false;
                self.mutex.unlock();
                return;
            }

            var wait_node = @TypeOf(self.waiters).Node{ .data = .{} };
            self.waiters.prepend(&wait_node);
            self.mutex.unlock();

            mutex.unlock();
            wait_node.data.wait();
            mutex.lock();
        }

        pub fn signal(self: *Condvar) void {
            self.mutex.lock();

            const maybe_wait_node = self.waiters.popFirst();
            if (maybe_wait_node == null)
                self.notified = true;

            self.mutex.unlock();

            if (maybe_wait_node) |wait_node|
                wait_node.data.set();
        }

        pub fn broadcast(self: *Condvar) void {
            self.mutex.lock();

            var waiters = self.waiters;
            self.notified = true;

            self.mutex.unlock();

            while (waiters.popFirst()) |wait_node|
                wait_node.data.set();
        }

        const Event = struct {
            futex: i32 = 0,

            fn wait(self: *Event) void {
                while (@atomicLoad(i32, &self.futex, .acquire) == 0) {
                    if (@hasDecl(Futex, "wait")) {
                        Futex.wait(&self.futex, 0);
                    } else {
                        spinLoopHint();
                    }
                }
            }

            fn set(self: *Event) void {
                @atomicStore(i32, &self.futex, 1, .release);

                if (@hasDecl(Futex, "wake"))
                    Futex.wake(&self.futex);
            }
        };
    };

const Futex = switch (@import("builtin").os.tag) {
    .linux => struct {
        fn wait(ptr: *const i32, cmp: i32) void {
            switch (system.getErrno(system.futex_wait(
                ptr,
                system.FUTEX.PRIVATE_FLAG | system.FUTEX.WAIT,
                cmp,
                null,
            ))) {
                0 => {},
                std.posix.EINTR => {},
                std.posix.EAGAIN => {},
                else => unreachable,
            }
        }

        fn wake(ptr: *const i32) void {
            switch (system.getErrno(system.futex_wake(
                ptr,
                system.FUTEX.PRIVATE_FLAG | system.FUTEX.WAKE,
                @as(i32, 1),
            ))) {
                0 => {},
                std.posix.EFAULT => {},
                else => unreachable,
            }
        }
    },
    else => void,
};

fn spinLoopHint() void {
    switch (@import("builtin").cpu.arch) {
        .i386, .x86_64 => asm volatile ("pause" ::: "memory"),
        .arm, .aarch64 => asm volatile ("yield" ::: "memory"),
        else => {},
    }
}
