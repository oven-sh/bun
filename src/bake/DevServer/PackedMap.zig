/// Packed source mapping data for a single file.
/// Owned by one IncrementalGraph file and/or multiple SourceMapStore entries.
pub const PackedMap = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", destroy, .{
    .destructor_ctx = *DevServer,
});

ref_count: RefCount,
/// Allocated by `dev.allocator`. Access with `.vlq()`
/// This is stored to allow lazy construction of source map files.
vlq_ptr: [*]u8,
vlq_len: u32,
vlq_allocator: std.mem.Allocator,
/// The bundler runs quoting on multiple threads, so it only makes
/// sense to preserve that effort for concatenation and
/// re-concatenation.
// TODO: rename to `escaped_source_*`
quoted_contents_ptr: [*]u8,
quoted_contents_len: u32,
/// Used to track the last state of the source map chunk. This
/// is used when concatenating chunks. The generated column is
/// not tracked because it is always zero (all chunks end in a
/// newline because minification is off), and the generated line
/// is recomputed on demand and is different per concatenation.
end_state: struct {
    original_line: i32,
    original_column: i32,
},
/// There is 32 bits of extra padding in this struct. These are used while
/// implementing `DevServer.memoryCost` to check which PackedMap entries are
/// already counted for.
bits_used_for_memory_cost_dedupe: u32 = 0,

pub fn newNonEmpty(chunk: SourceMap.Chunk, quoted_contents: []u8) bun.ptr.RefPtr(PackedMap) {
    assert(chunk.buffer.list.items.len > 0);
    return .new(.{
        .ref_count = .init(),
        .vlq_ptr = chunk.buffer.list.items.ptr,
        .vlq_len = @intCast(chunk.buffer.list.items.len),
        .vlq_allocator = chunk.buffer.allocator,
        .quoted_contents_ptr = quoted_contents.ptr,
        .quoted_contents_len = @intCast(quoted_contents.len),
        .end_state = .{
            .original_line = chunk.end_state.original_line,
            .original_column = chunk.end_state.original_column,
        },
    });
}

fn destroy(self: *@This(), _: *DevServer) void {
    self.vlq_allocator.free(self.vlq());
    bun.destroy(self);
}

pub fn memoryCost(self: *const @This()) usize {
    return self.vlq_len + self.quoted_contents_len + @sizeOf(@This());
}

/// When DevServer iterates everything to calculate memory usage, it passes
/// a generation number along which is different on each sweep, but
/// consistent within one. It is used to avoid counting memory twice.
pub fn memoryCostWithDedupe(self: *@This(), new_dedupe_bits: u32) usize {
    if (self.bits_used_for_memory_cost_dedupe == new_dedupe_bits) {
        return 0; // already counted.
    }
    self.bits_used_for_memory_cost_dedupe = new_dedupe_bits;
    return self.memoryCost();
}

pub fn vlq(self: *const @This()) []u8 {
    return self.vlq_ptr[0..self.vlq_len];
}

// TODO: rename to `escapedSource`
pub fn quotedContents(self: *const @This()) []u8 {
    return self.quoted_contents_ptr[0..self.quoted_contents_len];
}

comptime {
    if (!Environment.isDebug) {
        assert_eql(@sizeOf(@This()), @sizeOf(usize) * 7);
        assert_eql(@alignOf(@This()), @alignOf(usize));
    }
}

/// HTML, CSS, Assets, and failed files do not have source maps. These cases
/// should never allocate an object. There is still relevant state for these
/// files to encode, so those fields fit within the same 64 bits the pointer
/// would have used.
///
/// The tag is stored out of line with `Untagged`
/// - `IncrementalGraph(.client).File` offloads this bit into `File.Flags`
/// - `SourceMapStore.Entry` uses `MultiArrayList`
pub const RefOrEmpty = union(enum(u1)) {
    ref: bun.ptr.RefPtr(PackedMap),
    empty: Empty,

    pub const Empty = struct {
        /// Number of lines to skip when there is an associated JS chunk.
        line_count: bun.GenericIndex(u32, u8).Optional,
        /// This technically is not source-map related, but
        /// all HTML files have no source map, so this can
        /// fit in this space.
        html_bundle_route_index: RouteBundle.Index.Optional,
    };

    pub const blank_empty: @This() = .{ .empty = .{
        .line_count = .none,
        .html_bundle_route_index = .none,
    } };

    pub fn deref(map: *const @This(), dev: *DevServer) void {
        switch (map.*) {
            .ref => |ptr| ptr.derefWithContext(dev),
            .empty => {},
        }
    }

    pub fn dupeRef(map: *const @This()) @This() {
        return switch (map.*) {
            .ref => |ptr| .{ .ref = ptr.dupeRef() },
            .empty => map.*,
        };
    }

    pub fn untag(map: @This()) Untagged {
        return switch (map) {
            .ref => |ptr| .{ .ref = ptr },
            .empty => |empty| .{ .empty = empty },
        };
    }

    pub const Tag = @typeInfo(@This()).@"union".tag_type.?;
    pub const Untagged = brk: {
        @setRuntimeSafety(Environment.isDebug); // do not store a union tag in windows release
        break :brk union {
            ref: bun.ptr.RefPtr(PackedMap),
            empty: Empty,

            pub const blank_empty = RefOrEmpty.blank_empty.untag();

            pub fn decode(untagged: @This(), tag: Tag) RefOrEmpty {
                return switch (tag) {
                    .ref => .{ .ref = untagged.ref },
                    .empty => .{ .empty = untagged.empty },
                };
            }

            comptime {
                if (!Environment.isDebug) {
                    assert_eql(@sizeOf(@This()), @sizeOf(usize));
                    assert_eql(@alignOf(@This()), @alignOf(usize));
                }
            }
        };
    };
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const SourceMap = bun.sourcemap;
const assert = bun.assert;
const assert_eql = bun.assert_eql;
const bake = bun.bake;
const Chunk = bun.bundle_v2.Chunk;
const RefPtr = bun.ptr.RefPtr;

const DevServer = bake.DevServer;
const RouteBundle = DevServer.RouteBundle;
