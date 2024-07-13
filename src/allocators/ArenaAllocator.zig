const std = @import("std");
const bun = @import("root").bun;
const assert = bun.assert;
const mem = std.mem;
const Allocator = std.mem.Allocator;

/// This allocator takes an existing allocator, wraps it, and provides an interface
/// where you can allocate without freeing, and then free it all together.
pub const ArenaAllocator = struct {
    child_allocator: Allocator,
    state: State,

    /// Inner state of ArenaAllocator. Can be stored rather than the entire ArenaAllocator
    /// as a memory-saving optimization.
    pub const State = struct {
        buffer_list: std.SinglyLinkedList(usize) = .{},
        end_index: usize = 0,

        pub fn promote(self: State, child_allocator: Allocator) ArenaAllocator {
            return .{
                .child_allocator = child_allocator,
                .state = self,
            };
        }
    };

    pub fn allocator(self: *ArenaAllocator) Allocator {
        return .{
            .ptr = self,
            .vtable = &.{
                .alloc = alloc,
                .resize = resize,
                .free = free,
            },
        };
    }

    const BufNode = std.SinglyLinkedList(usize).Node;

    pub fn init(child_allocator: Allocator) ArenaAllocator {
        return (State{}).promote(child_allocator);
    }

    pub fn deinit(self: ArenaAllocator) void {
        // NOTE: When changing this, make sure `reset()` is adjusted accordingly!

        var it = self.state.buffer_list.first;
        while (it) |node| {
            // this has to occur before the free because the free frees node
            const next_it = node.next;
            const align_bits = std.math.log2_int(usize, @alignOf(BufNode));
            const alloc_buf = @as([*]u8, @ptrCast(node))[0..node.data];
            self.child_allocator.rawFree(alloc_buf, align_bits, @returnAddress());
            it = next_it;
        }
    }

    pub const ResetMode = union(enum) {
        /// Releases all allocated memory in the arena.
        free_all,
        /// This will pre-heat the arena for future allocations by allocating a
        /// large enough buffer for all previously done allocations.
        /// Preheating will speed up the allocation process by invoking the backing allocator
        /// less often than before. If `reset()` is used in a loop, this means that after the
        /// biggest operation, no memory allocations are performed anymore.
        retain_capacity,
        /// This is the same as `retain_capacity`, but the memory will be shrunk to
        /// this value if it exceeds the limit.
        retain_with_limit: usize,
    };
    /// Queries the current memory use of this arena.
    /// This will **not** include the storage required for internal keeping.
    pub fn queryCapacity(self: ArenaAllocator) usize {
        var size: usize = 0;
        var it = self.state.buffer_list.first;
        while (it) |node| : (it = node.next) {
            // Compute the actually allocated size excluding the
            // linked list node.
            size += node.data - @sizeOf(BufNode);
        }
        return size;
    }
    /// Resets the arena allocator and frees all allocated memory.
    ///
    /// `mode` defines how the currently allocated memory is handled.
    /// See the variant documentation for `ResetMode` for the effects of each mode.
    ///
    /// The function will return whether the reset operation was successful or not.
    /// If the reallocation  failed `false` is returned. The arena will still be fully
    /// functional in that case, all memory is released. Future allocations just might
    /// be slower.
    ///
    /// NOTE: If `mode` is `free_mode`, the function will always return `true`.
    pub fn reset(self: *ArenaAllocator, mode: ResetMode) bool {
        // Some words on the implementation:
        // The reset function can be implemented with two basic approaches:
        // - Counting how much bytes were allocated since the last reset, and storing that
        //   information in State. This will make reset fast and alloc only a teeny tiny bit
        //   slower.
        // - Counting how much bytes were allocated by iterating the chunk linked list. This
        //   will make reset slower, but alloc() keeps the same speed when reset() as if reset()
        //   would not exist.
        //
        // The second variant was chosen for implementation, as with more and more calls to reset(),
        // the function will get faster and faster. At one point, the complexity of the function
        // will drop to amortized O(1), as we're only ever having a single chunk that will not be
        // reallocated, and we're not even touching the backing allocator anymore.
        //
        // Thus, only the first hand full of calls to reset() will actually need to iterate the linked
        // list, all future calls are just taking the first node, and only resetting the `end_index`
        // value.
        const requested_capacity = switch (mode) {
            .retain_capacity => self.queryCapacity(),
            .retain_with_limit => |limit| @min(limit, self.queryCapacity()),
            .free_all => 0,
        };
        if (requested_capacity == 0) {
            // just reset when we don't have anything to reallocate
            self.deinit();
            self.state = State{};
            return true;
        }
        const total_size = requested_capacity + @sizeOf(BufNode);
        const align_bits = std.math.log2_int(usize, @alignOf(BufNode));
        // Free all nodes except for the last one
        var it = self.state.buffer_list.first;
        const maybe_first_node = while (it) |node| {
            // this has to occur before the free because the free frees node
            const next_it = node.next;
            if (next_it == null)
                break node;
            const alloc_buf = @as([*]u8, @ptrCast(node))[0..node.data];
            self.child_allocator.rawFree(alloc_buf, align_bits, @returnAddress());
            it = next_it;
        } else null;
        assert(maybe_first_node == null or maybe_first_node.?.next == null);
        // reset the state before we try resizing the buffers, so we definitely have reset the arena to 0.
        self.state.end_index = 0;
        if (maybe_first_node) |first_node| {
            self.state.buffer_list.first = first_node;
            // perfect, no need to invoke the child_allocator
            if (first_node.data == total_size)
                return true;
            const first_alloc_buf = @as([*]u8, @ptrCast(first_node))[0..first_node.data];
            if (self.child_allocator.rawResize(first_alloc_buf, align_bits, total_size, @returnAddress())) {
                // successful resize
                first_node.data = total_size;
            } else {
                // manual realloc
                const new_ptr = self.child_allocator.rawAlloc(total_size, align_bits, @returnAddress()) orelse {
                    // we failed to preheat the arena properly, signal this to the user.
                    return false;
                };
                self.child_allocator.rawFree(first_alloc_buf, align_bits, @returnAddress());
                const node: *BufNode = @ptrCast(@alignCast(new_ptr));
                node.* = .{ .data = total_size };
                self.state.buffer_list.first = node;
            }
        }
        return true;
    }

    fn createNode(self: *ArenaAllocator, prev_len: usize, minimum_size: usize) ?*BufNode {
        const actual_min_size = minimum_size + (@sizeOf(BufNode) + 16);
        const big_enough_len = prev_len + actual_min_size;
        const len = big_enough_len + big_enough_len / 2;
        const log2_align = comptime std.math.log2_int(usize, @alignOf(BufNode));
        const ptr = self.child_allocator.rawAlloc(len, log2_align, @returnAddress()) orelse
            return null;
        const buf_node: *BufNode = @ptrCast(@alignCast(ptr));
        buf_node.* = .{ .data = len };
        self.state.buffer_list.prepend(buf_node);
        self.state.end_index = 0;
        return buf_node;
    }

    fn alloc(ctx: *anyopaque, n: usize, log2_ptr_align: u8, ra: usize) ?[*]u8 {
        const self: *ArenaAllocator = @ptrCast(@alignCast(ctx));
        _ = ra;

        const ptr_align = @as(usize, 1) << @as(Allocator.Log2Align, @intCast(log2_ptr_align));
        var cur_node = if (self.state.buffer_list.first) |first_node|
            first_node
        else
            (self.createNode(0, n + ptr_align) orelse return null);
        while (true) {
            const cur_alloc_buf = @as([*]u8, @ptrCast(cur_node))[0..cur_node.data];
            const cur_buf = cur_alloc_buf[@sizeOf(BufNode)..];
            const addr = @intFromPtr(cur_buf.ptr) + self.state.end_index;
            const adjusted_addr = mem.alignForward(usize, addr, ptr_align);
            const adjusted_index = self.state.end_index + (adjusted_addr - addr);
            const new_end_index = adjusted_index + n;

            if (new_end_index <= cur_buf.len) {
                const result = cur_buf[adjusted_index..new_end_index];
                self.state.end_index = new_end_index;
                return result.ptr;
            }

            const bigger_buf_size = @sizeOf(BufNode) + new_end_index;
            const log2_align = comptime std.math.log2_int(usize, @alignOf(BufNode));
            if (self.child_allocator.rawResize(cur_alloc_buf, log2_align, bigger_buf_size, @returnAddress())) {
                cur_node.data = bigger_buf_size;
            } else {
                // Allocate a new node if that's not possible
                cur_node = self.createNode(cur_buf.len, n + ptr_align) orelse return null;
            }
        }
    }

    fn resize(ctx: *anyopaque, buf: []u8, log2_buf_align: u8, new_len: usize, ret_addr: usize) bool {
        const self: *ArenaAllocator = @ptrCast(@alignCast(ctx));
        _ = log2_buf_align;
        _ = ret_addr;

        const cur_node = self.state.buffer_list.first orelse return false;
        const cur_buf = @as([*]u8, @ptrCast(cur_node))[@sizeOf(BufNode)..cur_node.data];
        if (@intFromPtr(cur_buf.ptr) + self.state.end_index != @intFromPtr(buf.ptr) + buf.len) {
            // It's not the most recent allocation, so it cannot be expanded,
            // but it's fine if they want to make it smaller.
            return new_len <= buf.len;
        }

        if (buf.len >= new_len) {
            self.state.end_index -= buf.len - new_len;
            return true;
        } else if (cur_buf.len - self.state.end_index >= new_len - buf.len) {
            self.state.end_index += new_len - buf.len;
            return true;
        } else {
            return false;
        }
    }

    fn free(ctx: *anyopaque, buf: []u8, log2_buf_align: u8, ret_addr: usize) void {
        _ = log2_buf_align;
        _ = ret_addr;

        const self: *ArenaAllocator = @ptrCast(@alignCast(ctx));

        const cur_node = self.state.buffer_list.first orelse return;
        const cur_buf = @as([*]u8, @ptrCast(cur_node))[@sizeOf(BufNode)..cur_node.data];

        if (@intFromPtr(cur_buf.ptr) + self.state.end_index == @intFromPtr(buf.ptr) + buf.len) {
            self.state.end_index -= buf.len;
        }
    }
};
