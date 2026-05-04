/// This "Store" is a specialized memory allocation strategy very similar to an
/// arena, used for allocating expression and statement nodes during JavaScript
/// parsing and visiting. Allocations are grouped into large blocks, where each
/// block is treated as a fixed-buffer allocator. When a block runs out of
/// space, a new one is created; all blocks are joined as a linked list.
///
/// Similarly to an arena, you can call .reset() to reset state, reusing memory
/// across operations.
pub fn NewStore(comptime types: []const type, comptime count: usize) type {
    const largest_size, const largest_align = brk: {
        var largest_size = 0;
        var largest_align = 1;
        for (types) |T| {
            if (@sizeOf(T) == 0) {
                @compileError("NewStore does not support 0 size type: " ++ @typeName(T));
            }
            largest_size = @max(@sizeOf(T), largest_size);
            largest_align = @max(@alignOf(T), largest_align);
        }
        break :brk .{ largest_size, largest_align };
    };

    const backing_allocator = bun.default_allocator;

    const log = Output.scoped(.Store, .hidden);

    return struct {
        const Store = @This();

        current: *Block,
        debug_lock: std.debug.SafetyLock = .{},

        pub const Block = struct {
            pub const size = largest_size * count * 2;
            pub const Size = std.math.IntFittingRange(0, size + largest_size);

            buffer: [size]u8 align(largest_align),
            bytes_used: Size = 0,
            next: ?*Block = null,

            pub inline fn zero(this: *Block) void {
                // Avoid initializing the entire struct.
                this.bytes_used = 0;
                this.next = null;
            }

            pub fn tryAlloc(block: *Block, comptime T: type) ?*T {
                const start = std.mem.alignForward(usize, block.bytes_used, @alignOf(T));
                if (start + @sizeOf(T) > block.buffer.len) return null;
                defer block.bytes_used = @intCast(start + @sizeOf(T));

                // it's simpler to use @ptrCast, but as a sanity check, we also
                // try to compute the slice. Zig will report an out of bounds
                // panic if the null detection logic above is wrong
                if (Environment.isDebug) {
                    _ = block.buffer[block.bytes_used..][0..@sizeOf(T)];
                }

                return @ptrCast(@alignCast(&block.buffer[start]));
            }
        };

        const PreAlloc = struct {
            metadata: Store,
            first_block: Block,

            pub inline fn zero(this: *PreAlloc) void {
                // Avoid initializing the entire struct.
                this.first_block.zero();
                this.metadata.current = &this.first_block;
            }
        };

        pub fn firstBlock(store: *Store) *Block {
            return &@as(*PreAlloc, @fieldParentPtr("metadata", store)).first_block;
        }

        pub fn init() *Store {
            log("init", .{});
            // Avoid initializing the entire struct.
            const prealloc = bun.handleOom(backing_allocator.create(PreAlloc));
            prealloc.zero();

            return &prealloc.metadata;
        }

        pub fn deinit(store: *Store) void {
            log("deinit", .{});
            var it = store.firstBlock().next; // do not free `store.head`
            while (it) |next| {
                if (Environment.isDebug or Environment.enable_asan)
                    @memset(next.buffer, undefined);
                it = next.next;
                backing_allocator.destroy(next);
            }

            const prealloc: PreAlloc = @fieldParentPtr("metadata", store);
            bun.assert(&prealloc.first_block == store.head);
            backing_allocator.destroy(prealloc);
        }

        pub fn reset(store: *Store) void {
            log("reset", .{});

            if (Environment.isDebug or Environment.enable_asan) {
                var it: ?*Block = store.firstBlock();
                while (it) |next| : (it = next.next) {
                    next.bytes_used = undefined;
                    @memset(&next.buffer, undefined);
                }
            }

            store.current = store.firstBlock();
            store.current.bytes_used = 0;
        }

        fn allocate(store: *Store, comptime T: type) *T {
            comptime bun.assert(@sizeOf(T) > 0); // don't allocate!
            comptime if (!supportsType(T)) {
                @compileError("Store does not know about type: " ++ @typeName(T));
            };

            if (store.current.tryAlloc(T)) |ptr|
                return ptr;

            // a new block is needed
            const next_block = if (store.current.next) |next| brk: {
                next.bytes_used = 0;
                break :brk next;
            } else brk: {
                const new_block = backing_allocator.create(Block) catch
                    bun.outOfMemory();
                new_block.zero();
                store.current.next = new_block;
                break :brk new_block;
            };

            store.current = next_block;

            return next_block.tryAlloc(T) orelse
                unreachable; // newly initialized blocks must have enough space for at least one
        }

        pub inline fn append(store: *Store, comptime T: type, data: T) *T {
            const ptr = store.allocate(T);
            if (Environment.isDebug) {
                log("append({s}) -> 0x{x}", .{ bun.meta.typeName(T), @intFromPtr(ptr) });
            }
            ptr.* = data;
            return ptr;
        }

        pub fn lock(store: *Store) void {
            store.debug_lock.lock();
        }

        pub fn unlock(store: *Store) void {
            store.debug_lock.unlock();
        }

        fn supportsType(T: type) bool {
            return std.mem.indexOfScalar(type, types, T) != null;
        }
    };
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
