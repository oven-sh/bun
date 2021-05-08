const std = @import("std");

const Allocator = std.mem.Allocator;

pub const Config = struct {
    /// ZeeAlloc will request a multiple of `slab_size` from the backing allocator.
    /// **Must** be a power of two.
    slab_size: usize = std.math.max(std.mem.page_size, 65536), // 64K ought to be enough for everybody

    /// **Must** be a power of two.
    min_element_size: usize = 4,

    fn maxElementSize(conf: Config) usize {
        // Scientifically derived value
        return conf.slab_size / 4;
    }
};

pub const ZeeAllocDefaults = ZeeAlloc(Config{});

pub fn ZeeAlloc(comptime conf: Config) type {
    return struct {
        const Self = @This();

        const min_shift_size = unsafeLog2(usize, conf.min_element_size);
        const max_shift_size = unsafeLog2(usize, conf.maxElementSize());
        const total_slabs = max_shift_size - min_shift_size + 1;

        /// The definitive™ way of using `ZeeAlloc`
        pub const wasm_allocator = &_wasm.allocator;
        pub var _wasm = init(&wasm_page_allocator);

        jumbo: ?*Slab = null,
        slabs: [total_slabs]?*Slab = [_]?*Slab{null} ** total_slabs,
        backing_allocator: *std.mem.Allocator,

        allocator: Allocator = Allocator{
            .allocFn = alloc,
            .resizeFn = resize,
        },

        const Slab = extern struct {
            const header_size = 2 * @sizeOf(usize);
            const payload_alignment = header_size;

            next: ?*Slab align(conf.slab_size),
            element_size: usize,
            pad: [conf.slab_size - header_size]u8 align(payload_alignment),

            fn init(element_size: usize) Slab {
                var result: Slab = undefined;
                result.reset(element_size);
                return result;
            }

            fn reset(self: *Slab, element_size: usize) void {
                self.next = null;
                self.element_size = element_size;

                const blocks = self.freeBlocks();
                for (blocks) |*block| {
                    block.* = std.math.maxInt(u64);
                }

                const remaining_bits = @truncate(u6, (self.elementCount() - self.dataOffset()) % 64);
                // TODO: detect overflow
                blocks[blocks.len - 1] = (@as(u64, 1) << remaining_bits) - 1;
            }

            fn fromMemPtr(ptr: [*]u8) *Slab {
                const addr = std.mem.alignBackward(@ptrToInt(ptr), conf.slab_size);
                return @intToPtr(*Slab, addr);
            }

            const detached_signal = @intToPtr(*align(1) Slab, 0xaaaa);
            fn markDetached(self: *Slab) void {
                // Salt the earth
                const raw_next = @ptrCast(*usize, &self.next);
                raw_next.* = @ptrToInt(detached_signal);
            }

            fn isDetached(self: Slab) bool {
                return self.next == detached_signal;
            }

            fn freeBlocks(self: *Slab) []u64 {
                const count = divCeil(usize, self.elementCount(), 64);
                const ptr = @ptrCast([*]u64, &self.pad);
                return ptr[0..count];
            }

            fn totalFree(self: *Slab) usize {
                var i: usize = 0;
                for (self.freeBlocks()) |block| {
                    i += @popCount(u64, block);
                }
                return i;
            }

            const UsizeShift = std.meta.Int(.unsigned, @bitSizeOf(std.math.Log2Int(usize)) - 1);
            fn elementSizeShift(self: Slab) UsizeShift {
                return @truncate(UsizeShift, @ctz(usize, self.element_size));
            }

            fn elementCount(self: Slab) usize {
                return conf.slab_size >> self.elementSizeShift();
            }

            fn dataOffset(self: Slab) usize {
                const BITS_PER_BYTE = 8;
                return 1 + ((conf.slab_size / BITS_PER_BYTE) >> self.elementSizeShift() >> self.elementSizeShift());
            }

            fn elementAt(self: *Slab, idx: usize) []u8 {
                std.debug.assert(idx >= self.dataOffset());
                std.debug.assert(idx < self.elementCount());

                const bytes = std.mem.asBytes(self);
                return bytes[idx << self.elementSizeShift() ..][0..self.element_size];
            }

            fn elementIdx(self: *Slab, element: []u8) usize {
                std.debug.assert(element.len <= self.element_size);
                const diff = @ptrToInt(element.ptr) - @ptrToInt(self);
                std.debug.assert(diff % self.element_size == 0);

                return diff >> self.elementSizeShift();
            }

            fn alloc(self: *Slab) ![]u8 {
                for (self.freeBlocks()) |*block, i| {
                    const bit = @ctz(u64, block.*);
                    if (bit != 64) {
                        const index = 64 * i + bit;

                        const mask = @as(u64, 1) << @intCast(u6, bit);
                        block.* &= ~mask;

                        return self.elementAt(index + self.dataOffset());
                    }
                }

                return error.OutOfMemory;
            }

            fn free(self: *Slab, element: []u8) void {
                const index = self.elementIdx(element) - self.dataOffset();

                const block = &self.freeBlocks()[index / 64];
                const mask = @as(u64, 1) << @truncate(u6, index);
                std.debug.assert(mask & block.* == 0);
                block.* |= mask;
            }
        };

        pub fn init(allocator: *std.mem.Allocator) Self {
            return .{ .backing_allocator = allocator };
        }

        pub fn freeAll(self: *Self) void {
            {
                var iter = self.jumbo;
                while (iter) |node| {
                    iter = node.next;
                    const bytes = @ptrCast([*]u8, node);
                    self.backing_allocator.free(bytes[0..node.element_size]);
                }
            }

            for (self.slabs) |root| {
                var iter = root;
                while (iter) |node| {
                    iter = node.next;
                    self.backing_allocator.destroy(node);
                }
            }
        }

        pub fn deinit(self: *Self) void {
            self.freeAll();
            self.* = undefined;
        }

        fn isJumbo(value: usize) bool {
            return value > conf.slab_size / 4;
        }

        fn padToSize(memsize: usize) usize {
            if (isJumbo(memsize)) {
                return std.mem.alignForward(memsize + Slab.header_size, conf.slab_size);
            } else {
                return std.math.max(conf.min_element_size, ceilPowerOfTwo(usize, memsize));
            }
        }

        fn unsafeLog2(comptime T: type, val: T) T {
            std.debug.assert(ceilPowerOfTwo(T, val) == val);
            return @ctz(T, val);
        }

        fn findSlabIndex(padded_size: usize) usize {
            return unsafeLog2(usize, padded_size) - min_shift_size;
        }

        fn allocJumbo(self: *Self, padded_size: usize, ptr_align: usize) ![*]u8 {
            if (ptr_align > Slab.payload_alignment) {
                return error.OutOfMemory;
            }

            const slab: *Slab = blk: {
                var prev = @ptrCast(*align(@alignOf(Self)) Slab, self);
                while (prev.next) |curr| : (prev = curr) {
                    if (curr.element_size == padded_size) {
                        prev.next = curr.next;
                        break :blk curr;
                    }
                }

                const new_frame = try self.backing_allocator.allocAdvanced(u8, conf.slab_size, padded_size, .exact);
                const synth_slab = @ptrCast(*Slab, new_frame.ptr);
                synth_slab.element_size = padded_size;
                break :blk synth_slab;
            };
            slab.markDetached();
            return @ptrCast([*]u8, &slab.pad);
        }

        fn allocSlab(self: *Self, element_size: usize, ptr_align: usize) ![*]u8 {
            if (ptr_align > element_size) {
                return error.OutOfMemory;
            }

            const idx = findSlabIndex(element_size);
            const slab = self.slabs[idx] orelse blk: {
                const new_slab = try self.backing_allocator.create(Slab);
                new_slab.reset(element_size);
                self.slabs[idx] = new_slab;
                break :blk new_slab;
            };

            const result = slab.alloc() catch unreachable;
            if (slab.totalFree() == 0) {
                self.slabs[idx] = slab.next;
                slab.markDetached();
            }

            return result.ptr;
        }

        fn alloc(allocator: *Allocator, n: usize, ptr_align: u29, len_align: u29, ret_addr: usize) Allocator.Error![]u8 {
            const self = @fieldParentPtr(Self, "allocator", allocator);

            const padded_size = padToSize(n);
            const ptr: [*]u8 = if (isJumbo(n))
                try self.allocJumbo(padded_size, ptr_align)
            else
                try self.allocSlab(padded_size, ptr_align);

            return ptr[0..std.mem.alignAllocLen(padded_size, n, len_align)];
        }

        fn resize(allocator: *Allocator, buf: []u8, buf_align: u29, new_size: usize, len_align: u29, ret_addr: usize) Allocator.Error!usize {
            const self = @fieldParentPtr(Self, "allocator", allocator);

            const slab = Slab.fromMemPtr(buf.ptr);
            if (new_size == 0) {
                if (isJumbo(slab.element_size)) {
                    std.debug.assert(slab.isDetached());
                    slab.next = self.jumbo;
                    self.jumbo = slab;
                } else {
                    slab.free(buf);
                    if (slab.isDetached()) {
                        const idx = findSlabIndex(slab.element_size);
                        slab.next = self.slabs[idx];
                        self.slabs[idx] = slab;
                    }
                }
                return 0;
            }

            const padded_new_size = padToSize(new_size);
            if (padded_new_size > slab.element_size) {
                return error.OutOfMemory;
            }

            return std.mem.alignAllocLen(padded_new_size, new_size, len_align);
        }
    };
}

pub var wasm_page_allocator = init: {
    if (!std.builtin.target.isWasm()) {
        @compileError("wasm allocator is only available for wasm32 arch");
    }

    // std.heap.WasmPageAllocator is designed for reusing pages
    // We never free, so this lets us stay super small
    const WasmPageAllocator = struct {
        fn alloc(allocator: *Allocator, n: usize, alignment: u29, len_align: u29, ret_addr: usize) Allocator.Error![]u8 {
            const is_debug = std.builtin.mode == .Debug;
            @setRuntimeSafety(is_debug);
            std.debug.assert(n % std.mem.page_size == 0); // Should only be allocating page size chunks
            std.debug.assert(alignment % std.mem.page_size == 0); // Should only align to page_size increments

            const requested_page_count = @intCast(u32, n / std.mem.page_size);
            const prev_page_count = @wasmMemoryGrow(0, requested_page_count);
            if (prev_page_count < 0) {
                return error.OutOfMemory;
            }

            const start_ptr = @intToPtr([*]u8, @intCast(usize, prev_page_count) * std.mem.page_size);
            return start_ptr[0..n];
        }
    };

    break :init Allocator{
        .allocFn = WasmPageAllocator.alloc,
        .resizeFn = undefined, // Shouldn't be shrinking / freeing
    };
};

pub const ExportC = struct {
    allocator: *std.mem.Allocator,
    malloc: bool = true,
    free: bool = true,
    calloc: bool = false,
    realloc: bool = false,

    pub fn run(comptime conf: ExportC) void {
        const Funcs = struct {
            fn malloc(size: usize) callconv(.C) ?*c_void {
                if (size == 0) {
                    return null;
                }
                //const result = conf.allocator.alloc(u8, size) catch return null;
                const result = conf.allocator.allocFn(conf.allocator, size, 1, 1, 0) catch return null;
                return result.ptr;
            }
            fn calloc(num_elements: usize, element_size: usize) callconv(.C) ?*c_void {
                const size = num_elements *% element_size;
                const c_ptr = @call(.{ .modifier = .never_inline }, malloc, .{size});
                if (c_ptr) |ptr| {
                    const p = @ptrCast([*]u8, ptr);
                    @memset(p, 0, size);
                }
                return c_ptr;
            }
            fn realloc(c_ptr: ?*c_void, new_size: usize) callconv(.C) ?*c_void {
                if (new_size == 0) {
                    @call(.{ .modifier = .never_inline }, free, .{c_ptr});
                    return null;
                } else if (c_ptr) |ptr| {
                    // Use a synthetic slice
                    const p = @ptrCast([*]u8, ptr);
                    const result = conf.allocator.realloc(p[0..1], new_size) catch return null;
                    return @ptrCast(*c_void, result.ptr);
                } else {
                    return @call(.{ .modifier = .never_inline }, malloc, .{new_size});
                }
            }
            fn free(c_ptr: ?*c_void) callconv(.C) void {
                if (c_ptr) |ptr| {
                    // Use a synthetic slice. zee_alloc will free via corresponding metadata.
                    const p = @ptrCast([*]u8, ptr);
                    //conf.allocator.free(p[0..1]);
                    _ = conf.allocator.resizeFn(conf.allocator, p[0..1], 0, 0, 0, 0) catch unreachable;
                }
            }
        };

        if (conf.malloc) {
            @export(Funcs.malloc, .{ .name = "malloc" });
        }
        if (conf.calloc) {
            @export(Funcs.calloc, .{ .name = "calloc" });
        }
        if (conf.realloc) {
            @export(Funcs.realloc, .{ .name = "realloc" });
        }
        if (conf.free) {
            @export(Funcs.free, .{ .name = "free" });
        }
    }
};

fn divCeil(comptime T: type, numerator: T, denominator: T) T {
    return (numerator + denominator - 1) / denominator;
}

// https://github.com/ziglang/zig/issues/2426
fn ceilPowerOfTwo(comptime T: type, value: T) T {
    std.debug.assert(value != 0);
    const Shift = comptime std.math.Log2Int(T);
    return @as(T, 1) << @intCast(Shift, @bitSizeOf(T) - @clz(T, value - 1));
}

test "divCeil" {
    std.testing.expectEqual(@as(u32, 0), divCeil(u32, 0, 64));
    std.testing.expectEqual(@as(u32, 1), divCeil(u32, 1, 64));
    std.testing.expectEqual(@as(u32, 1), divCeil(u32, 64, 64));
    std.testing.expectEqual(@as(u32, 2), divCeil(u32, 65, 64));
}

test "Slab.init" {
    {
        const slab = ZeeAllocDefaults.Slab.init(16384);
        std.testing.expectEqual(@as(usize, 16384), slab.element_size);
        std.testing.expectEqual(@as(?*ZeeAllocDefaults.Slab, null), slab.next);

        const raw_ptr = @ptrCast(*const u64, &slab.pad);
        std.testing.expectEqual((@as(u64, 1) << 3) - 1, raw_ptr.*);
    }

    {
        const slab = ZeeAllocDefaults.Slab.init(2048);
        std.testing.expectEqual(@as(usize, 2048), slab.element_size);
        std.testing.expectEqual(@as(?*ZeeAllocDefaults.Slab, null), slab.next);

        const raw_ptr = @ptrCast(*const u64, &slab.pad);
        std.testing.expectEqual((@as(u64, 1) << 31) - 1, raw_ptr.*);
    }

    const u64_max: u64 = std.math.maxInt(u64);

    {
        const slab = ZeeAllocDefaults.Slab.init(256);
        std.testing.expectEqual(@as(usize, 256), slab.element_size);
        std.testing.expectEqual(@as(?*ZeeAllocDefaults.Slab, null), slab.next);

        const raw_ptr = @ptrCast([*]const u64, &slab.pad);
        std.testing.expectEqual(u64_max, raw_ptr[0]);
        std.testing.expectEqual(u64_max, raw_ptr[1]);
        std.testing.expectEqual(u64_max, raw_ptr[2]);
        std.testing.expectEqual((@as(u64, 1) << 63) - 1, raw_ptr[3]);
    }
}

test "Slab.elementAt" {
    {
        var slab = ZeeAllocDefaults.Slab.init(16384);

        var element = slab.elementAt(1);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(1 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(2);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(2 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(3);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(3 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));
    }
    {
        var slab = ZeeAllocDefaults.Slab.init(128);

        var element = slab.elementAt(1);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(1 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(2);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(2 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(3);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(3 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));
    }
    {
        var slab = ZeeAllocDefaults.Slab.init(64);
        std.testing.expectEqual(@as(usize, 3), slab.dataOffset());

        var element = slab.elementAt(3);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(3 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(5);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(5 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));
    }
    {
        var slab = ZeeAllocDefaults.Slab.init(4);
        std.testing.expectEqual(@as(usize, 513), slab.dataOffset());

        var element = slab.elementAt(513);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(513 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));

        element = slab.elementAt(1023);
        std.testing.expectEqual(slab.element_size, element.len);
        std.testing.expectEqual(1023 * slab.element_size, @ptrToInt(element.ptr) - @ptrToInt(&slab));
    }
}

test "Slab.elementIdx" {
    var slab = ZeeAllocDefaults.Slab.init(128);

    var element = slab.elementAt(1);
    std.testing.expectEqual(@as(usize, 1), slab.elementIdx(element));
}

test "Slab.freeBlocks" {
    {
        var slab = ZeeAllocDefaults.Slab.init(16384);

        const blocks = slab.freeBlocks();
        std.testing.expectEqual(@as(usize, 1), blocks.len);
        std.testing.expectEqual(@ptrToInt(&slab.pad), @ptrToInt(blocks.ptr));
    }
    {
        var slab = ZeeAllocDefaults.Slab.init(128);

        const blocks = slab.freeBlocks();
        std.testing.expectEqual(@as(usize, 8), blocks.len);
        std.testing.expectEqual(@ptrToInt(&slab.pad), @ptrToInt(blocks.ptr));
    }
}

test "Slab.alloc + free" {
    var slab = ZeeAllocDefaults.Slab.init(16384);

    std.testing.expectEqual(@as(usize, 3), slab.totalFree());

    const data0 = try slab.alloc();
    std.testing.expectEqual(@as(usize, 2), slab.totalFree());
    std.testing.expectEqual(@as(usize, 16384), data0.len);

    const data1 = try slab.alloc();
    std.testing.expectEqual(@as(usize, 1), slab.totalFree());
    std.testing.expectEqual(@as(usize, 16384), data1.len);
    std.testing.expectEqual(@as(usize, 16384), @ptrToInt(data1.ptr) - @ptrToInt(data0.ptr));

    const data2 = try slab.alloc();
    std.testing.expectEqual(@as(usize, 0), slab.totalFree());
    std.testing.expectEqual(@as(usize, 16384), data2.len);
    std.testing.expectEqual(@as(usize, 16384), @ptrToInt(data2.ptr) - @ptrToInt(data1.ptr));

    std.testing.expectError(error.OutOfMemory, slab.alloc());

    {
        slab.free(data2);
        std.testing.expectEqual(@as(usize, 1), slab.totalFree());
        slab.free(data1);
        std.testing.expectEqual(@as(usize, 2), slab.totalFree());
        slab.free(data0);
        std.testing.expectEqual(@as(usize, 3), slab.totalFree());
    }
}

test "padToSize" {
    const page_size = 65536;
    const header_size = 2 * @sizeOf(usize);

    std.testing.expectEqual(@as(usize, 4), ZeeAllocDefaults.padToSize(1));
    std.testing.expectEqual(@as(usize, 4), ZeeAllocDefaults.padToSize(4));
    std.testing.expectEqual(@as(usize, 8), ZeeAllocDefaults.padToSize(8));
    std.testing.expectEqual(@as(usize, 16), ZeeAllocDefaults.padToSize(9));
    std.testing.expectEqual(@as(usize, 16384), ZeeAllocDefaults.padToSize(16384));
}

test "alloc slabs" {
    var zee_alloc = ZeeAllocDefaults.init(std.testing.allocator);
    defer zee_alloc.deinit();

    for (zee_alloc.slabs) |root| {
        std.testing.expect(root == null);
    }

    std.testing.expect(zee_alloc.slabs[0] == null);
    const small = try zee_alloc.allocator.alloc(u8, 4);
    std.testing.expect(zee_alloc.slabs[0] != null);
    const smalls_before_free = zee_alloc.slabs[0].?.totalFree();
    zee_alloc.allocator.free(small);
    std.testing.expectEqual(smalls_before_free + 1, zee_alloc.slabs[0].?.totalFree());

    std.testing.expect(zee_alloc.slabs[12] == null);
    const large = try zee_alloc.allocator.alloc(u8, 16384);
    std.testing.expect(zee_alloc.slabs[12] != null);
    const larges_before_free = zee_alloc.slabs[12].?.totalFree();
    zee_alloc.allocator.free(large);
    std.testing.expectEqual(larges_before_free + 1, zee_alloc.slabs[12].?.totalFree());
}

test "alloc jumbo" {
    var zee_alloc = ZeeAllocDefaults.init(std.testing.allocator);
    defer zee_alloc.deinit();

    std.testing.expect(zee_alloc.jumbo == null);
    const first = try zee_alloc.allocator.alloc(u8, 32000);
    std.testing.expect(zee_alloc.jumbo == null);
    std.testing.expectEqual(@as(usize, ZeeAllocDefaults.Slab.header_size), @ptrToInt(first.ptr) % 65536);
    zee_alloc.allocator.free(first);
    std.testing.expect(zee_alloc.jumbo != null);

    const reuse = try zee_alloc.allocator.alloc(u8, 32000);
    std.testing.expect(zee_alloc.jumbo == null);
    std.testing.expectEqual(first.ptr, reuse.ptr);
    zee_alloc.allocator.free(first);
    std.testing.expect(zee_alloc.jumbo != null);
}

test "functional tests" {
    var zee_alloc = ZeeAllocDefaults.init(std.testing.allocator);
    defer zee_alloc.deinit();

    try std.heap.testAllocator(&zee_alloc.allocator);
    try std.heap.testAllocatorAligned(&zee_alloc.allocator, 16);
}

fn expectIllegalBehavior(context: anytype, comptime func: anytype) !void {
    if (!@hasDecl(std.os.system, "fork") or !std.debug.runtime_safety) return;

    const child_pid = try std.os.fork();
    if (child_pid == 0) {
        const null_fd = std.os.openZ("/dev/null", std.os.O_RDWR, 0) catch {
            std.debug.print("Cannot open /dev/null\n", .{});
            std.os.exit(0);
        };
        std.os.dup2(null_fd, std.io.getStdErr().handle) catch {
            std.debug.print("Cannot close child process stderr\n", .{});
            std.os.exit(0);
        };

        func(context); // this should crash
        std.os.exit(0);
    } else {
        const status = std.os.waitpid(child_pid, 0);
        // Maybe we should use a fixed error code instead of checking status != 0
        if (status == 0) @panic("Expected illegal behavior but succeeded instead");
    }
}

const AllocContext = struct {
    allocator: *Allocator,
    mem: []u8,

    fn init(allocator: *Allocator, mem: []u8) AllocContext {
        return .{ .allocator = allocator, .mem = mem };
    }

    fn free(self: AllocContext) void {
        self.allocator.free(self.mem);
    }
};

test "double free" {
    var zee_alloc = ZeeAllocDefaults.init(std.testing.allocator);
    defer zee_alloc.deinit();

    const mem = try zee_alloc.allocator.alloc(u8, 16);
    zee_alloc.allocator.free(mem);

    const context = AllocContext.init(&zee_alloc.allocator, mem);
    try expectIllegalBehavior(context, AllocContext.free);
}

test "freeing non-owned memory" {
    var zee_alloc = ZeeAllocDefaults.init(std.testing.allocator);
    defer zee_alloc.deinit();

    const mem = try std.testing.allocator.alloc(u8, 16);
    defer std.testing.allocator.free(mem);

    const context = AllocContext.init(&zee_alloc.allocator, mem);
    try expectIllegalBehavior(context, AllocContext.free);
}
