const std = @import("std");

pub fn ObjectPool(comptime Type: type, comptime Init: (fn (allocator: *std.mem.Allocator) anyerror!Type)) type {
    return struct {
        const LinkedList = std.SinglyLinkedList(Type);
        // mimalloc crashes on realloc across threads
        threadlocal var list: LinkedList = undefined;
        threadlocal var loaded: bool = false;

        pub const Node = LinkedList.Node;
        pub fn get(allocator: *std.mem.Allocator) *Node {
            if (loaded) {
                if (list.popFirst()) |node| {
                    node.data.reset();
                    return node;
                }
            }

            var new_node = allocator.create(Node) catch unreachable;
            new_node.* = Node{
                .data = Init(
                    allocator,
                ) catch unreachable,
            };

            return new_node;
        }

        pub fn release(node: *Node) void {
            if (loaded) {
                list.prepend(node);
                return;
            }

            list = LinkedList{ .first = node };
            loaded = true;
        }
    };
}
