const std = @import("std");

pub fn ObjectPool(comptime Type: type, comptime Init: (fn (allocator: std.mem.Allocator) anyerror!Type), comptime threadsafe: bool) type {
    return struct {
        const LinkedList = std.SinglyLinkedList(Type);
        const Data = if (threadsafe)
            struct {
                pub threadlocal var list: LinkedList = undefined;
                pub threadlocal var loaded: bool = false;
            }
        else
            struct {
                pub var list: LinkedList = undefined;
                pub var loaded: bool = false;
            };

        const data = Data;
        pub const Node = LinkedList.Node;

        pub fn get(allocator: std.mem.Allocator) *LinkedList.Node {
            if (data.loaded) {
                if (data.list.popFirst()) |node| {
                    node.data.reset();
                    return node;
                }
            }

            var new_node = allocator.create(LinkedList.Node) catch unreachable;
            new_node.* = LinkedList.Node{
                .data = Init(
                    allocator,
                ) catch unreachable,
            };

            return new_node;
        }

        pub fn release(node: *LinkedList.Node) void {
            if (data.loaded) {
                data.list.prepend(node);
                return;
            }

            data.list = LinkedList{ .first = node };
            data.loaded = true;
        }
    };
}
