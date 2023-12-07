const std = @import("std");
const assert = std.debug.assert;

/// An intrusive heap implementation backed by a pairing heap[1] implementation.
///
/// Why? Intrusive data structures require the element type to hold the metadata
/// required for the structure, rather than an additional container structure.
/// There are numerous pros/cons that are documented well by Boost[2]. For Zig,
/// I think the primary benefits are making data structures allocation free
/// (rather, shifting allocation up to the consumer which can choose how they
/// want the memory to be available). There are various costs to this such as
/// the costs of pointer chasing, larger memory overhead, requiring the element
/// type to be aware of its container, etc. But for certain use cases an intrusive
/// data structure can yield much better performance.
///
/// Usage notes:
/// - The element T is expected to have a field "heap" of type InstrusiveHeapField.
///   See the tests for a full example of how to set this.
/// - You can easily make this a min or max heap by inverting the result of
///   "less" below.
///
/// [1]: https://en.wikipedia.org/wiki/Pairing_heap
/// [2]: https://www.boost.org/doc/libs/1_64_0/doc/html/intrusive/intrusive_vs_nontrusive.html
pub fn Intrusive(
    comptime T: type,
    comptime Context: type,
    comptime less: *const fn (ctx: Context, a: *T, b: *T) bool,
) type {
    return struct {
        const Self = @This();

        root: ?*T = null,
        context: Context,

        /// Insert a new element v into the heap. An element v can only
        /// be a member of a single heap at any given time. When compiled
        /// with runtime-safety, assertions will help verify this property.
        pub fn insert(self: *Self, v: *T) void {
            self.root = if (self.root) |root| self.meld(v, root) else v;
        }

        /// Look at the next minimum value but do not remove it.
        pub fn peek(self: *Self) ?*T {
            return self.root;
        }

        /// Delete the minimum value from the heap and return it.
        pub fn deleteMin(self: *Self) ?*T {
            const root = self.root orelse return null;
            self.root = if (root.heap.child) |child|
                self.combine_siblings(child)
            else
                null;

            // Clear pointers with runtime safety so we can verify on
            // insert that values aren't incorrectly being set multiple times.
            root.heap = .{};

            return root;
        }

        /// Remove the value v from the heap.
        pub fn remove(self: *Self, v: *T) void {
            // If v doesn't have a previous value, this must be the root
            // element. If it is NOT the root element, v can't be in this
            // heap and we trigger an assertion failure.
            const prev = v.heap.prev orelse {
                assert(self.root.? == v);
                _ = self.deleteMin();
                return;
            };

            // Detach "v" from the tree and clean up any links so it
            // is as if this node never nexisted. The previous value
            // must point to the proper next value and the pointers
            // must all be cleaned up.
            if (v.heap.next) |next| next.heap.prev = prev;
            if (prev.heap.child == v)
                prev.heap.child = v.heap.next
            else
                prev.heap.next = v.heap.next;
            v.heap.prev = null;
            v.heap.next = null;

            // If we have children, then we need to merge them back in.
            const child = v.heap.child orelse return;
            v.heap.child = null;
            const x = self.combine_siblings(child);
            self.root = self.meld(x, self.root.?);
        }

        /// Meld (union) two heaps together. This isn't a generalized
        /// union. It assumes that a.heap.next is null so this is only
        /// meant in specific scenarios in the pairing heap where meld
        /// is expected.
        ///
        /// For example, when melding a new value "v" with an existing
        /// root "root", "v" must always be the first param.
        fn meld(self: *Self, a: *T, b: *T) *T {
            assert(a.heap.next == null);

            if (less(self.context, a, b)) {
                // B points back to A
                b.heap.prev = a;

                // If B has siblings, then A inherits B's siblings
                // and B's immediate sibling must point back to A to
                // maintain the doubly linked list.
                if (b.heap.next) |b_next| {
                    a.heap.next = b_next;
                    b_next.heap.prev = a;
                    b.heap.next = null;
                }

                // If A has a child, then B becomes the leftmost sibling
                // of that child.
                if (a.heap.child) |a_child| {
                    b.heap.next = a_child;
                    a_child.heap.prev = b;
                }

                // B becomes the leftmost child of A
                a.heap.child = b;

                return a;
            }

            // Replace A with B in the tree. Any of B's children
            // become siblings of A. A becomes the leftmost child of B.
            // A points back to B
            b.heap.prev = a.heap.prev;
            a.heap.prev = b;
            if (b.heap.child) |b_child| {
                a.heap.next = b_child;
                b_child.heap.prev = a;
            }
            b.heap.child = a;
            return b;
        }

        /// Combine the siblings of the leftmost value "left" into a single
        /// new rooted with the minimum value.
        fn combine_siblings(self: *Self, left: *T) *T {
            left.heap.prev = null;

            // Merge pairs right
            var root: *T = root: {
                var a: *T = left;
                while (true) {
                    var b = a.heap.next orelse break :root a;
                    a.heap.next = null;
                    b = self.meld(a, b);
                    a = b.heap.next orelse break :root b;
                }
            };

            // Merge pairs left
            while (true) {
                var b = root.heap.prev orelse return root;
                b.heap.next = null;
                root = self.meld(b, root);
            }
        }
    };
}

/// The state that is required for IntrusiveHeap element types. This
/// should be set as the "heap" field in the type T.
pub fn IntrusiveField(comptime T: type) type {
    return struct {
        child: ?*T = null,
        prev: ?*T = null,
        next: ?*T = null,
    };
}

test "heap" {
    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    var a: Elem = .{ .value = 12 };
    var b: Elem = .{ .value = 24 };
    var c: Elem = .{ .value = 7 };
    var d: Elem = .{ .value = 9 };

    var h: Heap = .{ .context = {} };
    h.insert(&a);
    h.insert(&b);
    h.insert(&c);
    h.insert(&d);
    h.remove(&d);

    const testing = std.testing;
    try testing.expect(h.deleteMin().?.value == 7);
    try testing.expect(h.deleteMin().?.value == 12);
    try testing.expect(h.deleteMin().?.value == 24);
    try testing.expect(h.deleteMin() == null);
}

test "heap remove root" {
    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    var a: Elem = .{ .value = 12 };
    var b: Elem = .{ .value = 24 };

    var h: Heap = .{ .context = {} };
    h.insert(&a);
    h.insert(&b);
    h.remove(&a);

    const testing = std.testing;
    try testing.expect(h.deleteMin().?.value == 24);
    try testing.expect(h.deleteMin() == null);
}

test "heap remove with children" {
    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    var a: Elem = .{ .value = 36 };
    var b: Elem = .{ .value = 24 };
    var c: Elem = .{ .value = 12 };

    var h: Heap = .{ .context = {} };
    h.insert(&a);
    h.insert(&b);
    h.insert(&c);
    h.remove(&b);

    const testing = std.testing;
    try testing.expect(h.deleteMin().?.value == 12);
    try testing.expect(h.deleteMin().?.value == 36);
    try testing.expect(h.deleteMin() == null);
}

test "heap equal values" {
    const testing = std.testing;

    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    var a: Elem = .{ .value = 1 };
    var b: Elem = .{ .value = 2 };
    var c: Elem = .{ .value = 3 };
    var d: Elem = .{ .value = 4 };

    var h: Heap = .{ .context = {} };
    h.insert(&a);
    h.insert(&b);
    h.insert(&c);
    h.insert(&d);

    try testing.expect(h.deleteMin().?.value == 1);
    try testing.expect(h.deleteMin().?.value == 2);
    try testing.expect(h.deleteMin().?.value == 3);
    try testing.expect(h.deleteMin().?.value == 4);
    try testing.expect(h.deleteMin() == null);
}

test "heap: million values" {
    const testing = std.testing;
    const alloc = testing.allocator;

    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    const NUM_TIMERS: usize = 1000 * 1000;
    var elems = try alloc.alloc(Elem, NUM_TIMERS);
    defer alloc.free(elems);

    var i: usize = 0;
    var value: usize = 0;
    while (i < NUM_TIMERS) : (i += 1) {
        if (i % 100 == 0) value += 1;
        elems[i] = .{ .value = value };
    }

    var h: Heap = .{ .context = {} };
    for (elems) |*elem| {
        h.insert(elem);
    }

    var count: usize = 0;
    var last: usize = 0;
    while (h.deleteMin()) |elem| {
        count += 1;
        try testing.expect(elem.value >= last);
        last = elem.value;
    }
    try testing.expect(h.deleteMin() == null);
    try testing.expect(count == NUM_TIMERS);
}

test "heap: dangling next pointer" {
    const testing = std.testing;
    const Elem = struct {
        const Self = @This();
        value: usize = 0,
        heap: IntrusiveField(Self) = .{},
    };

    const Heap = Intrusive(Elem, void, (struct {
        fn less(ctx: void, a: *Elem, b: *Elem) bool {
            _ = ctx;
            return a.value < b.value;
        }
    }).less);

    var a: Elem = .{ .value = 2 };
    var b: Elem = .{ .value = 4 };
    var c: Elem = .{ .value = 5 };
    var d: Elem = .{ .value = 1 };
    var e: Elem = .{ .value = 3 };

    var h: Heap = .{ .context = {} };
    h.insert(&a);
    h.insert(&b);
    h.insert(&c);
    h.insert(&d);
    h.insert(&e);

    try testing.expect(h.deleteMin().?.value == 1);
    try testing.expect(h.deleteMin().?.value == 2);
    try testing.expect(h.deleteMin().?.value == 3);
    try testing.expect(h.deleteMin().?.value == 4);
    try testing.expect(h.deleteMin().?.value == 5);
    try testing.expect(h.deleteMin() == null);
}
