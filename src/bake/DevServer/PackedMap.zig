//! Packed source mapping data for a single file.
//! Owned by one IncrementalGraph file and/or multiple SourceMapStore entries.
const Self = @This();

/// Allocated by `dev.allocator()`. Access with `.vlq()`
/// This is stored to allow lazy construction of source map files.
vlq_: OwnedIn([]u8, DevAllocator),
/// The bundler runs quoting on multiple threads, so it only makes
/// sense to preserve that effort for concatenation and
/// re-concatenation.
escaped_source: Owned([]u8),
/// Used to track the last state of the source map chunk. This
/// is used when concatenating chunks. The generated column is
/// not tracked because it is always zero (all chunks end in a
/// newline because minification is off), and the generated line
/// is recomputed on demand and is different per concatenation.
end_state: struct {
    original_line: i32,
    original_column: i32,
},

pub fn newNonEmpty(chunk: *SourceMap.Chunk, escaped_source: Owned([]u8)) bun.ptr.Shared(*Self) {
    var buffer = &chunk.buffer;
    assert(!buffer.isEmpty());
    const dev_allocator = DevAllocator.downcast(buffer.allocator);
    return .new(.{
        .vlq_ = .fromRawIn(buffer.toOwnedSlice(), dev_allocator),
        .escaped_source = escaped_source,
        .end_state = .{
            .original_line = chunk.end_state.original_line,
            .original_column = chunk.end_state.original_column,
        },
    });
}

pub fn deinit(self: *Self) void {
    self.vlq_.deinit();
    self.escaped_source.deinit();
}

pub fn memoryCost(self: *const Self) usize {
    return self.vlq().len + self.quotedContents().len + @sizeOf(Self);
}

pub fn vlq(self: *const Self) []const u8 {
    return self.vlq_.get();
}

// TODO: rename to `escapedSource`
pub fn quotedContents(self: *const Self) []const u8 {
    return self.escaped_source.get();
}

comptime {
    // `ci_assert` builds add a `safety.ThreadLock`
    if (!Environment.ci_assert) {
        assert_eql(@sizeOf(Self), @sizeOf(usize) * 5);
        assert_eql(@alignOf(Self), @alignOf(usize));
    }
}

const PackedMap = Self;

pub const LineCount = bun.GenericIndex(u32, u8);

/// HTML, CSS, Assets, and failed files do not have source maps. These cases
/// should never allocate an object. There is still relevant state for these
/// files to encode, so a tagged union is used.
pub const Shared = union(enum) {
    some: bun.ptr.Shared(*PackedMap),
    none: void,
    line_count: LineCount,

    pub fn get(self: Shared) ?*PackedMap {
        return switch (self) {
            .some => |ptr| ptr.get(),
            else => null,
        };
    }

    pub fn take(self: *Shared) ?bun.ptr.Shared(*PackedMap) {
        switch (self.*) {
            .some => |ptr| {
                self.* = .none;
                return ptr;
            },
            else => return null,
        }
    }

    pub fn clone(self: Shared) Shared {
        return switch (self) {
            .some => |ptr| .{ .some = ptr.clone() },
            else => self,
        };
    }

    pub fn deinit(self: *Shared) void {
        defer self.* = undefined;
        switch (self.*) {
            .some => |*ptr| ptr.deinit(),
            else => {},
        }
    }

    /// Amortized memory cost across all references to the same `PackedMap`
    pub fn memoryCost(self: Shared) usize {
        return switch (self) {
            .some => |ptr| ptr.get().memoryCost() / ptr.strongCount(),
            else => 0,
        };
    }
};

const bun = @import("bun");
const Environment = bun.Environment;
const SourceMap = bun.SourceMap;
const assert = bun.assert;
const assert_eql = bun.assert_eql;
const Chunk = bun.bundle_v2.Chunk;
const DevAllocator = bun.bake.DevServer.DevAllocator;

const Owned = bun.ptr.Owned;
const OwnedIn = bun.ptr.OwnedIn;
