const std = @import("std");
const bun = @import("root").bun;
const Index = bun.ast.Index;

/// Tarjan's strongly connected components algorithm for finding cycles in the dependency graph.
/// This is more efficient than the while(changed) loop approach which has O(n²) or worse complexity.
pub const StronglyConnectedComponents = struct {
    allocator: std.mem.Allocator,

    // Node information for Tarjan's algorithm
    nodes: []Node,
    stack: std.ArrayList(u32),
    index_counter: u32,
    sccs: std.ArrayList([]u32),

    pub const Node = struct {
        index: u32 = std.math.maxInt(u32),
        lowlink: u32 = std.math.maxInt(u32),
        on_stack: bool = false,
    };

    pub fn init(allocator: std.mem.Allocator, node_count: usize) !StronglyConnectedComponents {
        return .{
            .allocator = allocator,
            .nodes = try allocator.alloc(Node, node_count),
            .stack = std.ArrayList(u32).init(allocator),
            .index_counter = 0,
            .sccs = std.ArrayList([]u32).init(allocator),
        };
    }

    pub fn deinit(self: *StronglyConnectedComponents) void {
        self.allocator.free(self.nodes);
        self.stack.deinit();
        for (self.sccs.items) |scc| {
            self.allocator.free(scc);
        }
        self.sccs.deinit();
    }

    /// Find all strongly connected components using Tarjan's algorithm
    pub fn findSCCs(
        self: *StronglyConnectedComponents,
        comptime EdgeIterator: type,
        edges: *EdgeIterator,
        node_count: usize,
    ) !void {
        // Initialize all nodes
        for (0..node_count) |i| {
            self.nodes[i] = .{};
        }

        // Visit each unvisited node
        for (0..node_count) |v| {
            if (self.nodes[v].index == std.math.maxInt(u32)) {
                try self.strongConnect(EdgeIterator, edges, @intCast(v));
            }
        }
    }

    fn strongConnect(
        self: *StronglyConnectedComponents,
        comptime EdgeIterator: type,
        edges: *EdgeIterator,
        v: u32,
    ) !void {
        // Set the depth index for v to the smallest unused index
        self.nodes[v].index = self.index_counter;
        self.nodes[v].lowlink = self.index_counter;
        self.index_counter += 1;
        try self.stack.append(v);
        self.nodes[v].on_stack = true;

        // Consider successors of v
        const neighbors = edges.getNeighbors(v);
        for (neighbors) |w| {
            if (self.nodes[w].index == std.math.maxInt(u32)) {
                // Successor w has not yet been visited; recurse on it
                try self.strongConnect(EdgeIterator, edges, w);
                self.nodes[v].lowlink = @min(self.nodes[v].lowlink, self.nodes[w].lowlink);
            } else if (self.nodes[w].on_stack) {
                // Successor w is in stack S and hence in the current SCC
                self.nodes[v].lowlink = @min(self.nodes[v].lowlink, self.nodes[w].index);
            }
        }

        // If v is a root node, pop the stack and print an SCC
        if (self.nodes[v].lowlink == self.nodes[v].index) {
            var scc = std.ArrayList(u32).init(self.allocator);

            // Pop nodes from stack until we reach v
            while (self.stack.items.len > 0) {
                const w = self.stack.pop() orelse break;
                self.nodes[w].on_stack = false;
                try scc.append(w);
                if (w == v) break;
            }

            // Store the SCC (only if it has more than 1 element or is a self-loop)
            if (scc.items.len > 1 or self.hasSelfLoop(EdgeIterator, edges, v)) {
                try self.sccs.append(try scc.toOwnedSlice());
            } else {
                scc.deinit();
            }
        }
    }

    fn hasSelfLoop(self: *StronglyConnectedComponents, comptime EdgeIteratorType: type, edges: *EdgeIteratorType, node: u32) bool {
        _ = self;
        const neighbors = edges.getNeighbors(node);
        for (neighbors) |neighbor| {
            if (neighbor == node) return true;
        }
        return false;
    }

    /// Process SCCs in topological order for async propagation
    pub fn propagateAsyncInTopologicalOrder(
        self: *StronglyConnectedComponents,
        comptime FlagType: type,
        flags: []FlagType,
        comptime EdgeIterator: type,
        edges: *EdgeIterator,
    ) void {
        // Process SCCs in reverse order (topological order)
        var i: usize = self.sccs.items.len;
        while (i > 0) {
            i -= 1;
            const scc = self.sccs.items[i];

            // Check if any node in the SCC has async or any dependency has async
            var has_async = false;
            for (scc) |node_idx| {
                if (flags[node_idx].is_async_or_has_async_dependency) {
                    has_async = true;
                    break;
                }

                // Check dependencies outside the SCC
                const neighbors = edges.getNeighbors(node_idx);
                for (neighbors) |neighbor| {
                    // Skip nodes within the same SCC
                    var in_same_scc = false;
                    for (scc) |scc_node| {
                        if (scc_node == neighbor) {
                            in_same_scc = true;
                            break;
                        }
                    }
                    if (in_same_scc) continue;

                    if (flags[neighbor].is_async_or_has_async_dependency) {
                        has_async = true;
                        break;
                    }
                }
                if (has_async) break;
            }

            // If any node has async, mark all nodes in SCC as async
            if (has_async) {
                for (scc) |node_idx| {
                    flags[node_idx].is_async_or_has_async_dependency = true;
                }
            }
        }

        // Final pass: propagate async from dependencies for non-SCC nodes
        // Process in reverse topological order (from leaves to roots)
        var node_idx: usize = flags.len;
        while (node_idx > 0) {
            node_idx -= 1;

            // Skip if already async
            if (flags[node_idx].is_async_or_has_async_dependency) continue;

            // Check if this node is in any SCC (already processed)
            var in_scc = false;
            for (self.sccs.items) |scc| {
                for (scc) |scc_node| {
                    if (scc_node == node_idx) {
                        in_scc = true;
                        break;
                    }
                }
                if (in_scc) break;
            }
            if (in_scc) continue;

            // Check dependencies
            const neighbors = edges.getNeighbors(@intCast(node_idx));
            for (neighbors) |neighbor| {
                if (flags[neighbor].is_async_or_has_async_dependency) {
                    flags[node_idx].is_async_or_has_async_dependency = true;
                    break;
                }
            }
        }
    }
};
