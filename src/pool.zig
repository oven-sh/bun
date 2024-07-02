const std = @import("std");
const bun = @import("root").bun;

fn SinglyLinkedList(comptime T: type, comptime Parent: type) type {
    return struct {
        const Self = @This();

        /// Node inside the linked list wrapping the actual data.
        pub const Node = struct {
            next: ?*Node = null,
            allocator: std.mem.Allocator,
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

            pub inline fn release(node: *Node) void {
                Parent.release(node);
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

const log_allocations = false;

pub fn ObjectPool(
    comptime Type: type,
    comptime Init: (?fn (allocator: std.mem.Allocator) anyerror!Type),
    comptime threadsafe: bool,
    comptime max_count: comptime_int,
) type {
    return struct {
        const Pool = @This();
        const LinkedList = SinglyLinkedList(Type, Pool);
        pub const List = LinkedList;
        pub const Node = LinkedList.Node;
        const MaxCountInt = std.math.IntFittingRange(0, max_count);
        const DataStruct = struct {
            list: LinkedList = undefined,
            loaded: bool = false,
            count: MaxCountInt = 0,
        };

        // We want this to be global
        // but we don't want to create 3 global variables per pool
        // instead, we create one global variable per pool
        const DataStructNonThreadLocal = if (threadsafe) void else DataStruct;
        const DataStructThreadLocal = if (!threadsafe) void else DataStruct;
        threadlocal var data_threadlocal: DataStructThreadLocal = DataStructThreadLocal{};
        var data__: DataStructNonThreadLocal = DataStructNonThreadLocal{};
        inline fn data() *DataStruct {
            if (comptime threadsafe) {
                return &data_threadlocal;
            }

            if (comptime !threadsafe) {
                return &data__;
            }

            unreachable;
        }

        pub fn full() bool {
            if (comptime max_count == 0) return false;
            return data().loaded and data().count >= max_count;
        }

        pub fn has() bool {
            return data().loaded and data().list.first != null;
        }

        pub fn push(allocator: std.mem.Allocator, pooled: Type) void {
            if (comptime @import("./env.zig").allow_assert)
                bun.assert(!full());

            const new_node = allocator.create(LinkedList.Node) catch unreachable;
            new_node.* = LinkedList.Node{
                .allocator = allocator,
                .data = pooled,
            };
            release(new_node);
        }

        pub fn getIfExists() ?*LinkedList.Node {
            if (!data().loaded) {
                return null;
            }

            var node = data().list.popFirst() orelse return null;
            if (std.meta.hasFn(Type, "reset")) node.data.reset();
            if (comptime max_count > 0) data().count -|= 1;

            return node;
        }

        pub fn first(allocator: std.mem.Allocator) *Type {
            return &get(allocator).data;
        }

        pub fn get(allocator: std.mem.Allocator) *LinkedList.Node {
            if (data().loaded) {
                if (data().list.popFirst()) |node| {
                    if (comptime std.meta.hasFn(Type, "reset")) node.data.reset();
                    if (comptime max_count > 0) data().count -|= 1;
                    return node;
                }
            }

            if (comptime log_allocations) std.io.getStdErr().writeAll(comptime std.fmt.comptimePrint("Allocate {s} - {d} bytes\n", .{ @typeName(Type), @sizeOf(Type) })) catch {};

            const new_node = allocator.create(LinkedList.Node) catch unreachable;
            new_node.* = LinkedList.Node{
                .allocator = allocator,
                .data = if (comptime Init) |init_|
                    (init_(
                        allocator,
                    ) catch unreachable)
                else
                    undefined,
            };

            return new_node;
        }

        pub fn releaseValue(value: *Type) void {
            @as(*LinkedList.Node, @fieldParentPtr("data", value)).release();
        }

        pub fn release(node: *LinkedList.Node) void {
            if (comptime max_count > 0) {
                if (data().count >= max_count) {
                    if (comptime log_allocations) std.io.getStdErr().writeAll(comptime std.fmt.comptimePrint("Free {s} - {d} bytes\n", .{ @typeName(Type), @sizeOf(Type) })) catch {};
                    if (std.meta.hasFn(Type, "deinit")) node.data.deinit();
                    node.allocator.destroy(node);
                    return;
                }
            }

            if (comptime max_count > 0) data().count +|= 1;

            if (data().loaded) {
                data().list.prepend(node);
                return;
            }

            data().list = LinkedList{ .first = node };
            data().loaded = true;
        }
    };
}
