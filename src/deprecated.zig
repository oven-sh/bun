pub fn BufferedReader(comptime buffer_size: usize, comptime ReaderType: type) type {
    return struct {
        unbuffered_reader: ReaderType,
        buf: [buffer_size]u8,
        start: usize = 0,
        end: usize = 0,

        pub const Error = ReaderType.Error;
        pub const Reader = std.Io.GenericReader(*Self, Error, read);

        const Self = @This();

        pub fn read(self: *Self, dest: []u8) Error!usize {
            // First try reading from the already buffered data onto the destination.
            const current = self.buf[self.start..self.end];
            if (current.len != 0) {
                const to_transfer = @min(current.len, dest.len);
                @memcpy(dest[0..to_transfer], current[0..to_transfer]);
                self.start += to_transfer;
                return to_transfer;
            }

            // If dest is large, read from the unbuffered reader directly into the destination.
            if (dest.len >= buffer_size) {
                return self.unbuffered_reader.read(dest);
            }

            // If dest is small, read from the unbuffered reader into our own internal buffer,
            // and then transfer to destination.
            self.end = try self.unbuffered_reader.read(&self.buf);
            const to_transfer = @min(self.end, dest.len);
            @memcpy(dest[0..to_transfer], self.buf[0..to_transfer]);
            self.start = to_transfer;
            return to_transfer;
        }

        pub fn reader(self: *Self) Reader {
            return .{ .context = self };
        }
    };
}

pub fn bufferedReader(reader: anytype) BufferedReader(4096, @TypeOf(reader)) {
    return .{ .unbuffered_reader = reader, .buf = undefined };
}

pub fn bufferedReaderSize(comptime size: usize, reader: anytype) BufferedReader(size, @TypeOf(reader)) {
    return .{ .unbuffered_reader = reader, .buf = undefined };
}

/// A singly-linked list is headed by a single forward pointer. The elements
/// are singly-linked for minimum space and pointer manipulation overhead at
/// the expense of O(n) removal for arbitrary elements. New elements can be
/// added to the list after an existing element or at the head of the list.
/// A singly-linked list may only be traversed in the forward direction.
/// Singly-linked lists are ideal for applications with large datasets and
/// few or no removals or for implementing a LIFO queue.
pub fn SinglyLinkedList(comptime T: type) type {
    return struct {
        const Self = @This();

        /// Node inside the linked list wrapping the actual data.
        pub const Node = struct {
            next: ?*Node = null,
            data: T,

            pub const Data = T;

            /// Insert a new node after the current one.
            ///
            /// Arguments:
            ///     new_node: Pointer to the new node to insert.
            pub fn insertAfter(node: *Node, new_node: *Node) void {
                new_node.next = node.next;
                node.next = new_node;
            }

            /// Remove a node from the list.
            ///
            /// Arguments:
            ///     node: Pointer to the node to be removed.
            /// Returns:
            ///     node removed
            pub fn removeNext(node: *Node) ?*Node {
                const next_node = node.next orelse return null;
                node.next = next_node.next;
                return next_node;
            }

            /// Iterate over the singly-linked list from this node, until the final node is found.
            /// This operation is O(N).
            pub fn findLast(node: *Node) *Node {
                var it = node;
                while (true) {
                    it = it.next orelse return it;
                }
            }

            /// Iterate over each next node, returning the count of all nodes except the starting one.
            /// This operation is O(N).
            pub fn countChildren(node: *const Node) usize {
                var count: usize = 0;
                var it: ?*const Node = node.next;
                while (it) |n| : (it = n.next) {
                    count += 1;
                }
                return count;
            }

            /// Reverse the list starting from this node in-place.
            /// This operation is O(N).
            pub fn reverse(indirect: *?*Node) void {
                if (indirect.* == null) {
                    return;
                }
                var current: *Node = indirect.*.?;
                while (current.next) |next| {
                    current.next = next.next;
                    next.next = indirect.*;
                    indirect.* = next;
                }
            }
        };

        first: ?*Node = null,

        /// Insert a new node at the head.
        ///
        /// Arguments:
        ///     new_node: Pointer to the new node to insert.
        pub fn prepend(list: *Self, new_node: *Node) void {
            new_node.next = list.first;
            list.first = new_node;
        }

        /// Remove a node from the list.
        ///
        /// Arguments:
        ///     node: Pointer to the node to be removed.
        pub fn remove(list: *Self, node: *Node) void {
            if (list.first == node) {
                list.first = node.next;
            } else {
                var current_elm = list.first.?;
                while (current_elm.next != node) {
                    current_elm = current_elm.next.?;
                }
                current_elm.next = node.next;
            }
        }

        /// Remove and return the first node in the list.
        ///
        /// Returns:
        ///     A pointer to the first node in the list.
        pub fn popFirst(list: *Self) ?*Node {
            const first = list.first orelse return null;
            list.first = first.next;
            return first;
        }

        /// Iterate over all nodes, returning the count.
        /// This operation is O(N).
        pub fn len(list: Self) usize {
            if (list.first) |n| {
                return 1 + n.countChildren();
            } else {
                return 0;
            }
        }
    };
}

test "basic SinglyLinkedList test" {
    const L = SinglyLinkedList(u32);
    var list = L{};

    try testing.expect(list.len() == 0);

    var one = L.Node{ .data = 1 };
    var two = L.Node{ .data = 2 };
    var three = L.Node{ .data = 3 };
    var four = L.Node{ .data = 4 };
    var five = L.Node{ .data = 5 };

    list.prepend(&two); // {2}
    two.insertAfter(&five); // {2, 5}
    list.prepend(&one); // {1, 2, 5}
    two.insertAfter(&three); // {1, 2, 3, 5}
    three.insertAfter(&four); // {1, 2, 3, 4, 5}

    try testing.expect(list.len() == 5);

    // Traverse forwards.
    {
        var it = list.first;
        var index: u32 = 1;
        while (it) |node| : (it = node.next) {
            try testing.expect(node.data == index);
            index += 1;
        }
    }

    _ = list.popFirst(); // {2, 3, 4, 5}
    _ = list.remove(&five); // {2, 3, 4}
    _ = two.removeNext(); // {2, 4}

    try testing.expect(list.first.?.data == 2);
    try testing.expect(list.first.?.next.?.data == 4);
    try testing.expect(list.first.?.next.?.next == null);

    L.Node.reverse(&list.first);

    try testing.expect(list.first.?.data == 4);
    try testing.expect(list.first.?.next.?.data == 2);
    try testing.expect(list.first.?.next.?.next == null);
}

/// A doubly-linked list has a pair of pointers to both the head and
/// tail of the list. List elements have pointers to both the previous
/// and next elements in the sequence. The list can be traversed both
/// forward and backward. Some operations that take linear O(n) time
/// with a singly-linked list can be done without traversal in constant
/// O(1) time with a doubly-linked list:
///
/// - Removing an element.
/// - Inserting a new element before an existing element.
/// - Pushing or popping an element from the end of the list.
pub fn DoublyLinkedList(comptime T: type) type {
    return struct {
        const Self = @This();

        /// Node inside the linked list wrapping the actual data.
        pub const Node = struct {
            prev: ?*Node = null,
            next: ?*Node = null,
            data: T,
        };

        first: ?*Node = null,
        last: ?*Node = null,
        len: usize = 0,

        /// Insert a new node after an existing one.
        ///
        /// Arguments:
        ///     node: Pointer to a node in the list.
        ///     new_node: Pointer to the new node to insert.
        pub fn insertAfter(list: *Self, node: *Node, new_node: *Node) void {
            new_node.prev = node;
            if (node.next) |next_node| {
                // Intermediate node.
                new_node.next = next_node;
                next_node.prev = new_node;
            } else {
                // Last element of the list.
                new_node.next = null;
                list.last = new_node;
            }
            node.next = new_node;

            list.len += 1;
        }

        /// Insert a new node before an existing one.
        ///
        /// Arguments:
        ///     node: Pointer to a node in the list.
        ///     new_node: Pointer to the new node to insert.
        pub fn insertBefore(list: *Self, node: *Node, new_node: *Node) void {
            new_node.next = node;
            if (node.prev) |prev_node| {
                // Intermediate node.
                new_node.prev = prev_node;
                prev_node.next = new_node;
            } else {
                // First element of the list.
                new_node.prev = null;
                list.first = new_node;
            }
            node.prev = new_node;

            list.len += 1;
        }

        /// Concatenate list2 onto the end of list1, removing all entries from the former.
        ///
        /// Arguments:
        ///     list1: the list to concatenate onto
        ///     list2: the list to be concatenated
        pub fn concatByMoving(list1: *Self, list2: *Self) void {
            const l2_first = list2.first orelse return;
            if (list1.last) |l1_last| {
                l1_last.next = list2.first;
                l2_first.prev = list1.last;
                list1.len += list2.len;
            } else {
                // list1 was empty
                list1.first = list2.first;
                list1.len = list2.len;
            }
            list1.last = list2.last;
            list2.first = null;
            list2.last = null;
            list2.len = 0;
        }

        /// Insert a new node at the end of the list.
        ///
        /// Arguments:
        ///     new_node: Pointer to the new node to insert.
        pub fn append(list: *Self, new_node: *Node) void {
            if (list.last) |last| {
                // Insert after last.
                list.insertAfter(last, new_node);
            } else {
                // Empty list.
                list.prepend(new_node);
            }
        }

        /// Insert a new node at the beginning of the list.
        ///
        /// Arguments:
        ///     new_node: Pointer to the new node to insert.
        pub fn prepend(list: *Self, new_node: *Node) void {
            if (list.first) |first| {
                // Insert before first.
                list.insertBefore(first, new_node);
            } else {
                // Empty list.
                list.first = new_node;
                list.last = new_node;
                new_node.prev = null;
                new_node.next = null;

                list.len = 1;
            }
        }

        /// Remove a node from the list.
        ///
        /// Arguments:
        ///     node: Pointer to the node to be removed.
        pub fn remove(list: *Self, node: *Node) void {
            if (node.prev) |prev_node| {
                // Intermediate node.
                prev_node.next = node.next;
            } else {
                // First element of the list.
                list.first = node.next;
            }

            if (node.next) |next_node| {
                // Intermediate node.
                next_node.prev = node.prev;
            } else {
                // Last element of the list.
                list.last = node.prev;
            }

            list.len -= 1;
            assert(list.len == 0 or (list.first != null and list.last != null));
        }

        /// Remove and return the last node in the list.
        ///
        /// Returns:
        ///     A pointer to the last node in the list.
        pub fn pop(list: *Self) ?*Node {
            const last = list.last orelse return null;
            list.remove(last);
            return last;
        }

        /// Remove and return the first node in the list.
        ///
        /// Returns:
        ///     A pointer to the first node in the list.
        pub fn popFirst(list: *Self) ?*Node {
            const first = list.first orelse return null;
            list.remove(first);
            return first;
        }
    };
}

test "basic DoublyLinkedList test" {
    const L = DoublyLinkedList(u32);
    var list = L{};

    var one = L.Node{ .data = 1 };
    var two = L.Node{ .data = 2 };
    var three = L.Node{ .data = 3 };
    var four = L.Node{ .data = 4 };
    var five = L.Node{ .data = 5 };

    list.append(&two); // {2}
    list.append(&five); // {2, 5}
    list.prepend(&one); // {1, 2, 5}
    list.insertBefore(&five, &four); // {1, 2, 4, 5}
    list.insertAfter(&two, &three); // {1, 2, 3, 4, 5}

    // Traverse forwards.
    {
        var it = list.first;
        var index: u32 = 1;
        while (it) |node| : (it = node.next) {
            try testing.expect(node.data == index);
            index += 1;
        }
    }

    // Traverse backwards.
    {
        var it = list.last;
        var index: u32 = 1;
        while (it) |node| : (it = node.prev) {
            try testing.expect(node.data == (6 - index));
            index += 1;
        }
    }

    _ = list.popFirst(); // {2, 3, 4, 5}
    _ = list.pop(); // {2, 3, 4}
    list.remove(&three); // {2, 4}

    try testing.expect(list.first.?.data == 2);
    try testing.expect(list.last.?.data == 4);
    try testing.expect(list.len == 2);
}

test "DoublyLinkedList concatenation" {
    const L = DoublyLinkedList(u32);
    var list1 = L{};
    var list2 = L{};

    var one = L.Node{ .data = 1 };
    var two = L.Node{ .data = 2 };
    var three = L.Node{ .data = 3 };
    var four = L.Node{ .data = 4 };
    var five = L.Node{ .data = 5 };

    list1.append(&one);
    list1.append(&two);
    list2.append(&three);
    list2.append(&four);
    list2.append(&five);

    list1.concatByMoving(&list2);

    try testing.expect(list1.last == &five);
    try testing.expect(list1.len == 5);
    try testing.expect(list2.first == null);
    try testing.expect(list2.last == null);
    try testing.expect(list2.len == 0);

    // Traverse forwards.
    {
        var it = list1.first;
        var index: u32 = 1;
        while (it) |node| : (it = node.next) {
            try testing.expect(node.data == index);
            index += 1;
        }
    }

    // Traverse backwards.
    {
        var it = list1.last;
        var index: u32 = 1;
        while (it) |node| : (it = node.prev) {
            try testing.expect(node.data == (6 - index));
            index += 1;
        }
    }

    // Swap them back, this verifies that concatenating to an empty list works.
    list2.concatByMoving(&list1);

    // Traverse forwards.
    {
        var it = list2.first;
        var index: u32 = 1;
        while (it) |node| : (it = node.next) {
            try testing.expect(node.data == index);
            index += 1;
        }
    }

    // Traverse backwards.
    {
        var it = list2.last;
        var index: u32 = 1;
        while (it) |node| : (it = node.prev) {
            try testing.expect(node.data == (6 - index));
            index += 1;
        }
    }
}

pub const RapidHash = struct {
    const readInt = std.mem.readInt;
    const assert = bun.assert;
    const expect = std.testing.expect;
    const expectEqual = std.testing.expectEqual;

    const RAPID_SEED: u64 = 0xbdd89aa982704029;
    const RAPID_SECRET: [3]u64 = .{ 0x2d358dccaa6c78a5, 0x8bb84b93962eacc9, 0x4b33a62ed433d4a3 };

    pub fn hash(seed: u64, input: []const u8) u64 {
        const sc = RAPID_SECRET;
        const len = input.len;
        var a: u64 = 0;
        var b: u64 = 0;
        var k = input;
        var is: [3]u64 = .{ seed, 0, 0 };

        is[0] ^= mix(seed ^ sc[0], sc[1]) ^ len;

        if (len <= 16) {
            if (len >= 4) {
                const d: u64 = ((len & 24) >> @intCast(len >> 3));
                const e = len - 4;
                a = (r32(k) << 32) | r32(k[e..]);
                b = ((r32(k[d..]) << 32) | r32(k[(e - d)..]));
            } else if (len > 0)
                a = (@as(u64, k[0]) << 56) | (@as(u64, k[len >> 1]) << 32) | @as(u64, k[len - 1]);
        } else {
            var remain = len;
            if (len > 48) {
                is[1] = is[0];
                is[2] = is[0];
                while (remain >= 96) {
                    inline for (0..6) |i| {
                        const m1 = r64(k[8 * i * 2 ..]);
                        const m2 = r64(k[8 * (i * 2 + 1) ..]);
                        is[i % 3] = mix(m1 ^ sc[i % 3], m2 ^ is[i % 3]);
                    }
                    k = k[96..];
                    remain -= 96;
                }
                if (remain >= 48) {
                    inline for (0..3) |i| {
                        const m1 = r64(k[8 * i * 2 ..]);
                        const m2 = r64(k[8 * (i * 2 + 1) ..]);
                        is[i] = mix(m1 ^ sc[i], m2 ^ is[i]);
                    }
                    k = k[48..];
                    remain -= 48;
                }

                is[0] ^= is[1] ^ is[2];
            }

            if (remain > 16) {
                is[0] = mix(r64(k) ^ sc[2], r64(k[8..]) ^ is[0] ^ sc[1]);
                if (remain > 32) {
                    is[0] = mix(r64(k[16..]) ^ sc[2], r64(k[24..]) ^ is[0]);
                }
            }

            a = r64(input[len - 16 ..]);
            b = r64(input[len - 8 ..]);
        }

        a ^= sc[1];
        b ^= is[0];
        mum(&a, &b);
        return mix(a ^ sc[0] ^ len, b ^ sc[1]);
    }

    test "RapidHash.hash" {
        const bytes: []const u8 = "abcdefgh" ** 128;

        const sizes: [13]u64 = .{ 0, 1, 2, 3, 4, 8, 16, 32, 64, 128, 256, 512, 1024 };

        const outcomes: [13]u64 = .{
            0x5a6ef77074ebc84b,
            0xc11328477bc0f5d1,
            0x5644ac035e40d569,
            0x347080fbf5fcd81,
            0x56b66b8dc802bcc,
            0xb6bf9055973aac7c,
            0xed56d62eead1e402,
            0xc19072d767da8ffb,
            0x89bb40a9928a4f0d,
            0xe0af7c5e7b6e29fd,
            0x9a3ed35fbedfa11a,
            0x4c684b2119ca19fb,
            0x4b575f5bf25600d6,
        };

        for (sizes, outcomes) |s, e| {
            const r = hash(RAPID_SEED, bytes[0..s]);

            try expectEqual(e, r);
        }
    }

    inline fn mum(a: *u64, b: *u64) void {
        const r = @as(u128, a.*) * b.*;
        a.* = @truncate(r);
        b.* = @truncate(r >> 64);
    }

    inline fn mix(a: u64, b: u64) u64 {
        var copy_a = a;
        var copy_b = b;
        mum(&copy_a, &copy_b);
        return copy_a ^ copy_b;
    }

    inline fn r64(p: []const u8) u64 {
        return readInt(u64, p[0..8], .little);
    }

    inline fn r32(p: []const u8) u64 {
        return readInt(u32, p[0..4], .little);
    }
};

pub fn jsErrorToWriteError(e: bun.JSError) std.Io.Writer.Error {
    return switch (e) {
        error.JSTerminated => error.WriteFailed, // TODO: this might lose a JSTerminated, causing m_terminationException problems
        error.JSError => error.WriteFailed, // TODO: this might lose a JSError, causing exception check problems
        error.OutOfMemory => bun.handleOom(error.OutOfMemory),
    };
}

pub fn autoFormatLabelFallback(comptime ty: type, comptime fallback: []const u8) []const u8 {
    comptime if (std.meta.hasFn(ty, "format")) {
        return "{f}";
    } else {
        return fallback;
    };
}

pub fn autoFormatLabel(comptime ty: type) []const u8 {
    return autoFormatLabelFallback(ty, "{s}");
}

const bun = @import("bun");

const std = @import("std");
const testing = std.testing;

const debug = std.debug;
const assert = debug.assert;
