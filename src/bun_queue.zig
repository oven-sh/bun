const std = @import("std");
const Mutex = @import("./lock.zig").Mutex;
const WaitGroup = @import("./sync.zig").WaitGroup;
usingnamespace @import("./global.zig");
const Wyhash = std.hash.Wyhash;
const assert = std.debug.assert;

const VerboseQueue = false;

pub fn NewBlockQueue(comptime Value: type, comptime block_size: comptime_int, comptime block_count: usize) type {
    return struct {
        const BlockQueue = @This();
        const Block = [block_size]Value;

        blocks: [block_count]*Block = undefined,
        overflow: std.ArrayList(*Block) = undefined,
        first: Block = undefined,
        len: std.atomic.Atomic(i32) = std.atomic.Atomic(i32).init(0),
        allocated_blocks: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

        write_lock: bool = false,
        overflow_write_lock: bool = false,
        overflow_readers: std.atomic.Atomic(u8) = std.atomic.Atomic(u8).init(0),
        allocator: std.mem.Allocator,
        empty_queue: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(1),
        rand: std.rand.DefaultPrng = std.rand.DefaultPrng.init(100),

        pub fn new(this: *BlockQueue, allocator: std.mem.Allocator) void {
            this.* = BlockQueue{
                .allocator = allocator,
                .overflow = std.ArrayList(*Block).init(allocator),
                .len = std.atomic.Atomic(i32).init(0),
            };
            this.blocks[0] = &this.first;
            this.allocator = allocator;
        }

        pub fn get(this: *BlockQueue) ?Value {
            if (this.len.fetchMax(-1, .SeqCst) <= 0) return null;

            while (@atomicRmw(bool, &this.write_lock, .Xchg, true, .SeqCst)) {
                const end = this.rand.random.uintAtMost(u8, 64);
                var i: u8 = 0;
                while (i < end) : (i += 1) {}
                std.atomic.spinLoopHint();
            }
            defer assert(@atomicRmw(bool, &this.write_lock, .Xchg, false, .SeqCst));

            if (this.len.fetchMax(-1, .SeqCst) <= 0) return null;
            const current_len_ = this.len.fetchSub(1, .SeqCst);
            if (current_len_ <= 0) return null;

            const current_len = @intCast(u32, current_len_);
            if (current_len == 0) {
                return null;
            }

            const current_block = @floatToInt(u32, std.math.floor(@intToFloat(f32, (current_len - 1) / block_size)));
            const index = (current_len - 1) % block_size;

            if (comptime VerboseQueue) std.debug.print("[GET] {d}, {d}\n", .{ current_block, index });

            switch (current_block) {
                0 => {
                    return this.first[index];
                },
                1...block_count => {
                    const ptr = @atomicLoad(*Block, &this.blocks[current_block], .SeqCst);
                    return ptr[index];
                },
                else => {
                    const is_overflowing = current_block > block_count;

                    unreachable;
                },
            }
        }

        pub fn enqueue(this: *BlockQueue, value: Value) !void {
            while (@atomicRmw(bool, &this.write_lock, .Xchg, true, .SeqCst)) {
                const end = this.rand.random.uintAtMost(u8, 32);
                var i: u8 = 0;
                while (i < end) : (i += 1) {}
                std.atomic.spinLoopHint();
            }
            defer assert(@atomicRmw(bool, &this.write_lock, .Xchg, false, .SeqCst));
            defer {
                const old = this.empty_queue.swap(0, .SeqCst);
                if (old == 1) std.Thread.Futex.wake(&this.empty_queue, std.math.maxInt(u32));
            }

            const current_len = @intCast(u32, std.math.max(this.len.fetchAdd(1, .SeqCst), 0));
            const next_len = current_len + 1;

            const current_block = @floatToInt(u32, std.math.floor(@intToFloat(f32, current_len) / block_size));
            const next_block = @floatToInt(u32, std.math.floor(@intToFloat(f32, next_len) / block_size));
            const index = (current_len % block_size);
            const next_index = (next_len % block_size);

            if (comptime VerboseQueue) std.debug.print("\n[PUT]  {d}, {d} - {d} \n", .{ current_block, index, current_len });

            const allocated_block = this.allocated_blocks.load(.SeqCst);
            const needs_new_block = next_index == 0;
            const needs_to_allocate_block = needs_new_block and allocated_block < next_block;
            const overflowing = current_block >= block_count;

            if (needs_to_allocate_block) {
                defer {
                    _ = this.allocated_blocks.fetchAdd(1, .SeqCst);
                }
                var new_list = try this.allocator.create(Block);
                if (next_block >= block_count) {
                    const needs_lock = this.overflow.items.len + 1 >= this.overflow.capacity;
                    if (needs_lock) {
                        while (this.overflow_readers.load(.SeqCst) > 0) {
                            std.atomic.spinLoopHint();
                        }
                        @atomicStore(bool, &this.overflow_write_lock, true, .SeqCst);
                    }
                    defer {
                        if (needs_lock) {
                            @atomicStore(bool, &this.overflow_write_lock, false, .SeqCst);
                        }
                    }
                    try this.overflow.append(new_list);
                } else {
                    @atomicStore(*Block, &this.blocks[next_block], new_list, .SeqCst);
                }
            }

            var block_ptr = if (!overflowing)
                @atomicLoad(*Block, &this.blocks[current_block], .SeqCst)
            else
                @atomicLoad(*Block, &this.overflow.items[current_block - block_count], .SeqCst);

            block_ptr[index] = value;
            if (current_len < 10) std.Thread.Futex.wake(@ptrCast(*const std.atomic.Atomic(u32), &this.len), std.math.maxInt(u32));
        }
    };
}

pub fn NewBunQueue(comptime Value: type) type {
    return struct {
        const KeyType = u32;
        const BunQueue = @This();
        const Queue = NewBlockQueue(Value, 64, 48);
        allocator: std.mem.Allocator,
        queue: Queue,
        keys: Keys,
        count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

        pub fn init(allocator: std.mem.Allocator) !*BunQueue {
            var bun = try allocator.create(BunQueue);
            bun.* = BunQueue{
                .allocator = allocator,
                .queue = undefined,
                .keys = Keys{
                    .offset = AtomicOffset.init(Offset.bits(.{ .used = 0, .len = 0 })),
                    .block_overflow = Keys.OverflowList.init(allocator),
                },
            };
            bun.queue.new(allocator);

            bun.keys.blocks[0] = &bun.keys.first_key_list;
            return bun;
        }

        pub const Keys = struct {
            pub const OverflowList = std.ArrayList([*]KeyType);

            blocks: [overflow_size][*]KeyType = undefined,
            offset: AtomicOffset,
            block_overflow: OverflowList,
            block_overflow_lock: bool = false,
            first_key_list: [block_size]KeyType = undefined,
            write_lock: bool = false,
            append_readers: u8 = 0,
            append_lock: bool = false,
            pending_write: KeyType = 0,
        };

        pub const Offset = packed struct {
            used: u16,
            len: u16,

            pub const Int = std.meta.Int(.unsigned, @bitSizeOf(@This()));

            pub inline fn bits(this: Offset) Int {
                return @bitCast(Int, this);
            }
        };

        // Half a page of memory
        pub const block_size = 2048 / @sizeOf(KeyType);
        // 32 is arbitrary
        pub const overflow_size = 32;

        // In one atomic load/store, get the length and offset of the keys
        pub const AtomicOffset = std.atomic.Atomic(Offset.Int);

        fn pushList(this: *BunQueue, used: u16) !void {

            // this.keys.mutex.acquire();
            // defer this.keys.mutex.release();

            var block = try this.allocator.alloc(KeyType, block_size);

            if (used < overflow_size) {
                @atomicStore([*]KeyType, &this.keys.blocks[used], block.ptr, .Release);
            } else {
                const needs_lock = this.keys.block_overflow.items.len + 1 >= this.keys.block_overflow.capacity;
                if (needs_lock) {
                    while (@atomicLoad(u8, &this.keys.append_readers, .SeqCst) > 0) {
                        std.atomic.spinLoopHint();
                    }
                    @atomicStore(bool, &this.keys.append_lock, true, .SeqCst);
                }
                defer {
                    if (needs_lock) @atomicStore(bool, &this.keys.append_lock, false, .SeqCst);
                }
                try this.keys.block_overflow.append(block.ptr);
            }
        }

        inline fn contains(this: *BunQueue, key: KeyType) bool {
            @fence(.Acquire);
            if (@atomicLoad(KeyType, &this.keys.pending_write, .SeqCst) == key) return true;

            var offset = this.getOffset();
            std.debug.assert(&this.keys.first_key_list == this.keys.blocks[0]);

            // Heuristic #1: the first files you import are probably the most common in your app
            // e.g. "react"
            if (offset.used != 0) {
                for (this.keys.first_key_list) |_key| {
                    if (key == _key) return true;
                }
            }

            if (offset.used < overflow_size) {
                // Heuristic #2: you import files near each other
                const block_ptr = @atomicLoad([*]KeyType, &this.keys.blocks[offset.used], .SeqCst);
                for (block_ptr[0..offset.len]) |_key| {
                    if (key == _key) return true;
                }
            } else {
                while (@atomicLoad(bool, &this.keys.append_lock, .SeqCst)) {
                    std.atomic.spinLoopHint();
                }
                _ = @atomicRmw(u8, &this.keys.append_readers, .Add, 1, .SeqCst);
                defer {
                    _ = @atomicRmw(u8, &this.keys.append_readers, .Sub, 1, .SeqCst);
                }
                const latest = @atomicLoad([*]KeyType, &this.keys.block_overflow.items[offset.used - overflow_size], .SeqCst);

                for (latest[0..offset.len]) |_key| {
                    if (key == _key) return true;
                }
            }

            if (offset.used > 0) {
                var j: usize = 1;
                while (j < std.math.min(overflow_size, offset.used)) : (j += 1) {
                    const block_ptr = @atomicLoad([*]KeyType, &this.keys.blocks[j], .SeqCst);
                    for (block_ptr[0..block_size]) |_key| {
                        if (key == _key) return true;
                    }
                }

                if (offset.used > overflow_size) {
                    var end = offset.used - overflow_size;
                    j = 0;
                    while (j < end) : (j += 1) {
                        while (@atomicLoad(bool, &this.keys.append_lock, .SeqCst)) {
                            std.atomic.spinLoopHint();
                        }

                        _ = @atomicRmw(u8, &this.keys.append_readers, .Add, 1, .SeqCst);
                        defer {
                            _ = @atomicRmw(u8, &this.keys.append_readers, .Sub, 1, .SeqCst);
                        }

                        const block = @atomicLoad([*]KeyType, &this.keys.block_overflow.items[j], .SeqCst);
                        for (block[0..block_size]) |_key| {
                            if (key == _key) return true;
                        }
                    }
                }
            }

            return @atomicLoad(KeyType, &this.keys.pending_write, .Acquire) == key;
        }

        pub inline fn getOffset(this: *BunQueue) Offset {
            return @bitCast(Offset, this.keys.offset.load(std.atomic.Ordering.Acquire));
        }

        pub fn hasItem(this: *BunQueue, key: KeyType) bool {
            @fence(.SeqCst);

            if (this.contains(key)) return true;
            while (@atomicRmw(bool, &this.keys.write_lock, .Xchg, true, .SeqCst)) {
                std.atomic.spinLoopHint();
            }
            defer assert(@atomicRmw(bool, &this.keys.write_lock, .Xchg, false, .SeqCst));

            if (@atomicRmw(KeyType, &this.keys.pending_write, .Xchg, key, .SeqCst) == key) return true;

            const offset = this.getOffset();

            const new_len = (offset.len + 1) % block_size;
            const is_new_list = new_len == 0;
            const new_offset = Offset{ .used = @intCast(u16, @boolToInt(is_new_list)) + offset.used, .len = new_len };

            {
                var latest_list = if (offset.used < overflow_size)
                    @atomicLoad([*]KeyType, &this.keys.blocks[offset.used], .SeqCst)
                else
                    @atomicLoad([*]KeyType, &this.keys.block_overflow.items[offset.used - overflow_size], .SeqCst);

                assert(@atomicRmw(KeyType, &latest_list[offset.len], .Xchg, key, .Release) != key);
            }

            // We only should need to lock when we're allocating memory
            if (is_new_list) {
                this.pushList(new_offset.used) catch unreachable;
            }

            this.keys.offset.store(new_offset.bits(), .Release);

            return false;
        }

        inline fn _writeItem(this: *BunQueue, value: Value) !void {
            _ = this.count.fetchAdd(1, .Release);
            try this.queue.enqueue(value);
        }

        pub fn upsert(this: *BunQueue, key: KeyType, value: Value) !void {
            if (!this.hasItem(key)) {
                try this._writeItem(value);
            }
        }

        pub fn upsertWithResult(this: *BunQueue, key: KeyType, value: Value) !bool {
            if (!this.hasItem(key)) {
                try this._writeItem(value);
                return true;
            }

            return false;
        }
        pub inline fn next(this: *BunQueue) ?Value {
            return this.queue.get();
        }
    };
}

test "BunQueue: Single-threaded" {
    const BunQueue = NewBunQueue([]const u8);
    const hash = Wyhash.hash;
    const expect = std.testing.expect;

    var queue = try BunQueue.init(default_allocator);

    var greet = [_]string{
        "hello",                          "how",                               "are",                            "you",
        "https://",                       "ton.local.twitter.com",             "/responsive-web-internal/",      "sourcemaps",
        "/client-web/",                   "loader.Typeahead.7c3b3805.js.map:", "ERR_BLOCKED_BY_CLIENT",          "etch failed loading: POST ",
        "ondemand.LottieWeb.08803c45.js", "ondemand.InlinePlayer.4990ef15.js", "ondemand.BranchSdk.bb99d145.js", "ondemand.Dropdown.011d5045.js",
    };
    var greeted: [greet.len]bool = undefined;
    std.mem.set(bool, &greeted, false);

    for (greet) |ing, i| {
        const key = @truncate(u32, hash(0, ing));
        try expect(!queue.contains(
            key,
        ));
        try queue.upsert(
            key,
            ing,
        );
        try expect(queue.hasItem(
            key,
        ));
        try expect(queue.getOffset().len == i + 1);
    }

    {
        var i: usize = 0;
        while (i < greet.len) : (i += 1) {
            const item = (queue.next()) orelse return try std.testing.expect(false);
            try expect(strings.containsAny(&greet, item));
            const index = strings.indexAny(&greet, item) orelse unreachable;
            try expect(!greeted[index]);
            greeted[index] = true;
        }
        i = 0;
        while (i < greet.len) : (i += 1) {
            try expect(queue.next() == null);
        }
        i = 0;
        while (i < greet.len) : (i += 1) {
            try expect(greeted[i]);
        }
        i = 0;
    }

    const end_offset = queue.getOffset().len;

    for (greet) |ing, i| {
        const key = @truncate(u32, hash(0, ing));
        try queue.upsert(
            key,
            ing,
        );

        try expect(end_offset == queue.getOffset().len);
    }
}

test "BunQueue: Dedupes" {
    const BunQueue = NewBunQueue([]const u8);
    const hash = Wyhash.hash;
    const expect = std.testing.expect;

    var queue = try BunQueue.init(default_allocator);

    var greet = [_]string{
        "uniq1",
        "uniq2",
        "uniq3",
        "uniq4",
        "uniq5",
        "uniq6",
        "uniq7",
        "uniq8",
        "uniq9",
        "uniq10",
        "uniq11",
        "uniq12",
        "uniq13",
        "uniq14",
        "uniq15",
        "uniq16",
        "uniq17",
        "uniq18",
        "uniq19",
        "uniq20",
        "uniq21",
        "uniq22",
        "uniq23",
        "uniq24",
        "uniq25",
        "uniq26",
        "uniq27",
        "uniq28",
        "uniq29",
        "uniq30",
    } ++ [_]string{ "dup20", "dup21", "dup27", "dup2", "dup12", "dup15", "dup4", "dup12", "dup10", "dup7", "dup26", "dup22", "dup1", "dup23", "dup11", "dup8", "dup11", "dup29", "dup28", "dup25", "dup20", "dup2", "dup6", "dup16", "dup22", "dup13", "dup30", "dup9", "dup3", "dup17", "dup14", "dup18", "dup8", "dup3", "dup28", "dup30", "dup24", "dup18", "dup24", "dup5", "dup23", "dup10", "dup13", "dup26", "dup27", "dup29", "dup25", "dup4", "dup19", "dup15", "dup6", "dup17", "dup1", "dup16", "dup19", "dup7", "dup9", "dup21", "dup14", "dup5" };
    var prng = std.rand.DefaultPrng.init(100);
    prng.random.shuffle(string, &greet);
    var deduped = std.BufSet.init(default_allocator);
    var consumed = std.BufSet.init(default_allocator);

    for (greet) |ing, i| {
        const key = @truncate(u32, hash(0, ing));

        const is_new = !deduped.contains(ing);
        try deduped.insert(ing);
        try queue.upsert(key, ing);
    }

    while (queue.next()) |i| {
        try expect(consumed.contains(i) == false);
        try consumed.insert(i);
    }

    try std.testing.expectEqual(consumed.count(), deduped.count());
    try expect(deduped.count() > 0);
}

test "BunQueue: SCMP Threaded" {
    const BunQueue = NewBunQueue([]const u8);
    const expect = std.testing.expect;

    var _queue = try BunQueue.init(default_allocator);

    var greet = [_]string{
        "uniq1",
        "uniq2",
        "uniq3",
        "uniq4",
        "uniq5",
        "uniq6",
        "uniq7",
        "uniq8",
        "uniq9",
        "uniq10",
        "uniq11",
        "uniq12",
        "uniq13",
        "uniq14",
        "uniq15",
        "uniq16",
        "uniq17",
        "uniq18",
        "uniq19",
        "uniq20",
        "uniq21",
        "uniq22",
        "uniq23",
        "uniq24",
        "uniq25",
        "uniq26",
        "uniq27",
        "uniq28",
        "uniq29",
        "uniq30",
        "uniq31",
        "uniq32",
        "uniq33",
        "uniq34",
        "uniq35",
        "uniq36",
        "uniq37",
        "uniq38",
        "uniq39",
        "uniq40",
        "uniq41",
        "uniq42",
        "uniq43",
        "uniq44",
        "uniq45",
        "uniq46",
        "uniq47",
        "uniq48",
        "uniq49",
        "uniq50",
        "uniq51",
        "uniq52",
        "uniq53",
        "uniq54",
        "uniq55",
        "uniq56",
        "uniq57",
        "uniq58",
        "uniq59",
        "uniq60",
        "uniq61",
        "uniq62",
        "uniq63",
        "uniq64",
        "uniq65",
        "uniq66",
        "uniq67",
        "uniq68",
        "uniq69",
        "uniq70",
        "uniq71",
        "uniq72",
        "uniq73",
        "uniq74",
        "uniq75",
        "uniq76",
        "uniq77",
        "uniq78",
        "uniq79",
        "uniq80",
        "uniq81",
        "uniq82",
        "uniq83",
        "uniq84",
        "uniq85",
        "uniq86",
        "uniq87",
        "uniq88",
        "uniq89",
        "uniq90",
        "uniq91",
        "uniq92",
        "uniq93",
        "uniq94",
        "uniq95",
        "uniq96",
        "uniq97",
        "uniq98",
        "uniq99",
        "uniq100",
        "uniq101",
        "uniq102",
        "uniq103",
        "uniq104",
        "uniq105",
        "uniq106",
        "uniq107",
        "uniq108",
        "uniq109",
        "uniq110",
        "uniq111",
        "uniq112",
        "uniq113",
        "uniq114",
        "uniq115",
        "uniq116",
        "uniq117",
        "uniq118",
        "uniq119",
        "uniq120",
    } ++ [_]string{ "dup1", "dup1", "dup10", "dup10", "dup11", "dup11", "dup12", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup12", "dup13", "dup13", "dup14", "dup14", "dup15", "dup15", "dup16", "dup16", "dup17", "dup17", "dup18", "dup18", "dup19", "dup19", "dup2", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup24", "dup24", "dup25", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup23", "dup23", "dup12", "dup13", "dup13", "dup14", "dup14", "dup15", "dup15", "dup16", "dup16", "dup17", "dup17", "dup18", "dup18", "dup19", "dup19", "dup2", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup24", "dup24", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9", "dup25", "dup26", "dup26", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9", "dup27", "dup27", "dup28", "dup28", "dup29", "dup29", "dup3", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9" };
    var prng = std.rand.DefaultPrng.init(100);
    prng.random.shuffle(string, &greet);
    var in = try default_allocator.create(std.BufSet);
    in.* = std.BufSet.init(default_allocator);
    for (greet) |i| {
        try in.insert(i);
        try _queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, i)), i);
    }

    const Worker = struct {
        index: u8 = 0,

        pub fn run(queue: *BunQueue, dedup_list: *std.BufSet, wg: *WaitGroup, mut: *Mutex) !void {
            defer wg.done();
            // const tasks = more_work[num];
            // var remain = tasks;
            while (queue.next()) |cur| {
                mut.acquire();
                defer mut.release();
                try dedup_list.insert(cur);
            }
        }

        pub fn run1(queue: *BunQueue, num: u8, dedup_list: *std.BufSet, wg: *WaitGroup, mut: *Mutex) !void {
            defer wg.done();
            const tasks = more_work[num];
            var remain = tasks;
            try queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, remain[0])), remain[0]);
            remain = tasks[1..];
            loop: while (true) {
                while (queue.next()) |cur| {
                    mut.acquire();
                    try dedup_list.insert(cur);
                    mut.release();
                }

                if (remain.len > 0) {
                    try queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, remain[0])), remain[0]);
                    remain = tasks[1..];
                    var j: usize = 0;
                    while (j < 1000) : (j += 1) {}
                    continue :loop;
                }

                break :loop;
            }
        }
    };

    var out = try default_allocator.create(std.BufSet);
    out.* = std.BufSet.init(default_allocator);

    var waitgroup = try default_allocator.create(WaitGroup);
    waitgroup.* = WaitGroup.init();

    var worker1 = try default_allocator.create(Worker);
    worker1.* = Worker{};
    var worker2 = try default_allocator.create(Worker);
    worker2.* = Worker{};
    waitgroup.add();
    waitgroup.add();
    var mutex = try default_allocator.create(Mutex);
    mutex.* = Mutex{};

    var thread1 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, out, waitgroup, mutex });
    var thread2 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, out, waitgroup, mutex });

    waitgroup.wait();
    thread1.join();
    thread2.join();

    try std.testing.expectEqual(out.count(), in.count());
    var iter = in.hash_map.iterator();

    while (iter.next()) |entry| {
        try expect(in.contains(entry.key_ptr.*));
    }
}

test "BunQueue: MPMC Threaded" {
    const BunQueue = NewBunQueue([]const u8);
    const expect = std.testing.expect;
    var _queue = try BunQueue.init(default_allocator);

    var in = try default_allocator.create(std.BufSet);
    in.* = std.BufSet.init(default_allocator);

    const Worker = struct {
        index: u8 = 0,
        const WorkerCount = 2;
        const lodash_all = shuffle(@TypeOf(@import("./test/project.zig").lodash), @import("./test/project.zig").lodash);
        const lodash1 = lodash_all[0 .. lodash_all.len / 3];
        const lodash2 = lodash_all[lodash1.len..][0 .. lodash_all.len / 3];
        const lodash3 = lodash_all[lodash1.len + lodash2.len ..];

        pub fn shuffle(comptime Type: type, comptime val: Type) Type {
            var copy = val;
            @setEvalBranchQuota(99999);
            var rand = std.rand.DefaultPrng.init(100);
            rand.random.shuffle(string, &copy);
            return copy;
        }
        const three_all = shuffle(@TypeOf(@import("./test/project.zig").three), @import("./test/project.zig").three);
        const three1 = three_all[0 .. three_all.len / 3];
        const three2 = three_all[three1.len..][0 .. three_all.len / 3];
        const three3 = three_all[three1.len + three2.len ..];

        fn run1(queue: *BunQueue, num: u8, dedup_list: *std.BufSet, wg: *WaitGroup, mut: *Mutex) !void {
            defer wg.done();
            const tasks = switch (num) {
                0 => lodash1,
                1 => lodash2,
                2 => lodash3,
                3 => three1,
                4 => three2,
                5 => three3,
                else => unreachable,
            };

            var remain = tasks;
            try queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, remain[0])), remain[0]);
            remain = tasks[1..];
            loop: while (true) {
                while (queue.next()) |cur| {
                    mut.acquire();
                    defer mut.release();
                    try expect(!dedup_list.contains(cur));
                    try dedup_list.insert(cur);
                }

                if (remain.len > 0) {
                    try queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, remain[0])), remain[0]);
                    remain = remain[1..];
                    var j: usize = 0;
                    while (j < 10000) : (j += 1) {}
                    continue :loop;
                }

                break :loop;
            }
        }

        pub fn run(queue: *BunQueue, num: u8, dedup_list: *std.BufSet, wg: *WaitGroup, mut: *Mutex) !void {
            try run1(queue, num, dedup_list, wg, mut);
        }
    };

    var greet = [_]string{
        "uniq1",
        "uniq2",
        "uniq3",
        "uniq4",
        "uniq5",
        "uniq6",
        "uniq7",
        "uniq8",
        "uniq9",
        "uniq10",
        "uniq11",
        "uniq12",
        "uniq13",
        "uniq14",
        "uniq15",
        "uniq16",
        "uniq17",
        "uniq18",
        "uniq19",
        "uniq20",
        "uniq21",
        "uniq22",
        "uniq23",
        "uniq24",
        "uniq25",
        "uniq26",
        "uniq27",
        "uniq28",
        "uniq29",
        "uniq30",
    } ++ [_]string{ "dup1", "dup1", "dup10", "dup10", "dup11", "dup11", "dup12", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup12", "dup13", "dup13", "dup14", "dup14", "dup15", "dup15", "dup16", "dup16", "dup17", "dup17", "dup18", "dup18", "dup19", "dup19", "dup2", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup24", "dup24", "dup25", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup23", "dup23", "dup12", "dup13", "dup13", "dup14", "dup14", "dup15", "dup15", "dup16", "dup16", "dup17", "dup17", "dup18", "dup18", "dup19", "dup19", "dup2", "dup2", "dup20", "dup20", "dup21", "dup21", "dup22", "dup22", "dup23", "dup23", "dup24", "dup24", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9", "dup25", "dup26", "dup26", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9", "dup27", "dup27", "dup28", "dup28", "dup29", "dup29", "dup3", "dup3", "dup30", "dup30", "dup4", "dup4", "dup5", "dup5", "dup6", "dup6", "dup7", "dup7", "dup8", "dup8", "dup9", "dup9" };

    for (greet) |a| {
        try in.insert(a);
        try _queue.upsert(@truncate(u32, std.hash.Wyhash.hash(0, a)), a);
    }

    for (Worker.lodash_all) |a| {
        try in.insert(a);
    }

    for (Worker.three_all) |a| {
        try in.insert(a);
    }

    var out = try default_allocator.create(std.BufSet);
    out.* = std.BufSet.init(default_allocator);

    var waitgroup = try default_allocator.create(WaitGroup);
    waitgroup.* = WaitGroup.init();

    waitgroup.add();
    waitgroup.add();
    waitgroup.add();
    waitgroup.add();
    waitgroup.add();
    waitgroup.add();
    var mutex = try default_allocator.create(Mutex);
    mutex.* = Mutex{};

    var thread1 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 0, out, waitgroup, mutex });
    var thread2 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 1, out, waitgroup, mutex });
    var thread3 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 2, out, waitgroup, mutex });
    var thread4 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 3, out, waitgroup, mutex });
    var thread5 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 4, out, waitgroup, mutex });
    var thread6 = try std.Thread.spawn(.{}, Worker.run, .{ _queue, 5, out, waitgroup, mutex });

    waitgroup.wait();
    thread1.join();
    thread2.join();
    thread3.join();
    thread4.join();
    thread5.join();
    thread6.join();

    try std.testing.expectEqual(out.count(), in.count());
    var iter = in.hash_map.iterator();

    while (iter.next()) |entry| {
        try expect(out.contains(entry.key_ptr.*));
    }
}
