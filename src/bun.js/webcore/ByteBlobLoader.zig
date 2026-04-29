const ByteBlobLoader = @This();

offset: Blob.SizeType = 0,
store: ?*Blob.Store = null,
chunk_size: Blob.SizeType = 1024 * 1024 * 2,
remain: Blob.SizeType = 1024 * 1024 * 2,
done: bool = false,
pulled: bool = false,

/// Part boundary tracking for multi-part blobs.
/// When set, chunks are delivered at original part boundaries.
part_sizes: ?[*]Blob.SizeType = null,
part_count: Blob.SizeType = 0,
current_part: Blob.SizeType = 0,
/// Bytes remaining in the current part (handles partial reads).
current_part_remain: Blob.SizeType = 0,

/// https://github.com/oven-sh/bun/issues/14988
/// Necessary for converting a ByteBlobLoader from a Blob -> back into a Blob
/// Especially for DOMFormData, where the specific content-type might've been serialized into the data.
content_type: []const u8 = "",
content_type_allocated: bool = false,

pub const tag = webcore.ReadableStream.Tag.Blob;
pub const Source = webcore.ReadableStream.NewSource(
    @This(),
    "Blob",
    onStart,
    onPull,
    onCancel,
    deinit,
    null,
    drain,
    memoryCost,
    toBufferedValue,
);

pub fn parent(this: *@This()) *Source {
    return @fieldParentPtr("context", this);
}

pub fn setup(
    this: *ByteBlobLoader,
    blob: *const Blob,
    user_chunk_size: Blob.SizeType,
) void {
    blob.store.?.ref();
    var blobe = blob.*;
    blobe.resolveSize();
    const content_type, const content_type_allocated = brk: {
        if (blob.content_type_was_set) {
            if (blob.content_type_allocated) {
                break :brk .{ bun.handleOom(bun.default_allocator.dupe(u8, blob.content_type)), true };
            }

            break :brk .{ blob.content_type, false };
        }
        break :brk .{ "", false };
    };
    const has_user_chunk_size = user_chunk_size > 0;
    const store = blobe.store.?;
    const has_parts = !has_user_chunk_size and blobe.offset == 0 and blobe.size == store.size() and
        store.data == .bytes and store.data.bytes.part_sizes != null and store.data.bytes.part_count > 1;

    this.* = ByteBlobLoader{
        .offset = blobe.offset,
        .store = store,
        .chunk_size = @min(
            if (has_user_chunk_size) @min(user_chunk_size, blobe.size) else blobe.size,
            1024 * 1024 * 2,
        ),
        .remain = blobe.size,
        .done = false,
        .part_sizes = if (has_parts) store.data.bytes.part_sizes else null,
        .part_count = if (has_parts) store.data.bytes.part_count else 0,
        .current_part = 0,
        .current_part_remain = if (has_parts) store.data.bytes.part_sizes.?[0] else 0,
        .content_type = content_type,
        .content_type_allocated = content_type_allocated,
    };
}

pub fn onStart(this: *ByteBlobLoader) streams.Start {
    if (this.part_sizes) |sizes| {
        // Suggest a buffer large enough to hold the biggest part so each
        // part fits in a single chunk, but never exceed the 2MB cap that
        // `setup()` enforces for non-part blobs. Parts larger than the cap
        // are still split into multiple chunks by `onPull`.
        var max_part: Blob.SizeType = 0;
        for (sizes[0..this.part_count]) |s| {
            max_part = @max(max_part, s);
            if (max_part >= 1024 * 1024 * 2) break;
        }
        return .{ .chunk_size = @min(max_part, 1024 * 1024 * 2) };
    }
    return .{ .chunk_size = this.chunk_size };
}

pub fn onPull(this: *ByteBlobLoader, buffer: []u8, array: JSValue) streams.Result {
    array.ensureStillAlive();
    defer array.ensureStillAlive();
    this.pulled = true;
    const store = this.store orelse return .{ .done = {} };
    if (this.done) {
        return .{ .done = {} };
    }

    var temporary = store.sharedView();
    temporary = temporary[@min(this.offset, temporary.len)..];

    // When we have part boundaries, limit this chunk to the current part size.
    // Skip any zero-length parts first.
    if (this.part_sizes) |sizes| {
        this.skipEmptyParts(sizes);
    }
    const max_chunk = if (this.part_sizes != null)
        if (this.current_part_remain > 0) this.current_part_remain else this.remain
    else
        this.remain;

    temporary = temporary[0..@min(buffer.len, @min(temporary.len, max_chunk))];
    if (temporary.len == 0) {
        this.clearData();
        this.done = true;
        return .{ .done = {} };
    }

    const copied = @as(Blob.SizeType, @intCast(temporary.len));

    this.remain -|= copied;
    this.offset +|= copied;
    if (this.part_sizes) |sizes| {
        this.current_part_remain -|= copied;
        if (this.current_part_remain == 0) {
            this.current_part += 1;
            if (this.current_part < this.part_count) {
                this.current_part_remain = sizes[this.current_part];
            }
        }
    }
    bun.assert(buffer.ptr != temporary.ptr);
    @memcpy(buffer[0..temporary.len], temporary);
    if (this.remain == 0) {
        return .{ .into_array_and_done = .{ .value = array, .len = copied } };
    }

    return .{ .into_array = .{ .value = array, .len = copied } };
}

fn skipEmptyParts(this: *ByteBlobLoader, sizes: [*]Blob.SizeType) void {
    while (this.current_part < this.part_count and this.current_part_remain == 0) {
        this.current_part += 1;
        if (this.current_part < this.part_count) {
            this.current_part_remain = sizes[this.current_part];
        }
    }
}

pub fn toAnyBlob(this: *ByteBlobLoader, globalThis: *JSGlobalObject) ?Blob.Any {
    if (this.store) |store| {
        _ = this.detachStore();
        if (this.offset == 0 and this.remain == store.size() and this.content_type.len == 0) {
            if (store.toAnyBlob()) |blob| {
                defer store.deref();
                return blob;
            }
        }

        var blob = Blob.initWithStore(store, globalThis);
        blob.offset = this.offset;
        blob.size = this.remain;

        // Make sure to preserve the content-type.
        // https://github.com/oven-sh/bun/issues/14988
        if (this.content_type.len > 0) {
            blob.content_type = this.content_type;
            blob.content_type_was_set = this.content_type.len > 0;
            blob.content_type_allocated = this.content_type_allocated;
            this.content_type = "";
            this.content_type_allocated = false;
        }

        this.parent().is_closed = true;
        return .{ .Blob = blob };
    }
    return null;
}

pub fn detachStore(this: *ByteBlobLoader) ?*Blob.Store {
    if (this.store) |store| {
        this.store = null;
        this.done = true;
        return store;
    }
    return null;
}

pub fn onCancel(this: *ByteBlobLoader) void {
    this.clearData();
}

pub fn deinit(this: *ByteBlobLoader) void {
    this.clearData();
    this.parent().deinit();
}

fn clearData(this: *ByteBlobLoader) void {
    if (this.content_type_allocated) {
        bun.default_allocator.free(this.content_type);
        this.content_type = "";
        this.content_type_allocated = false;
    }

    if (this.store) |store| {
        this.store = null;
        store.deref();
    }
}

pub fn drain(this: *ByteBlobLoader) bun.ByteList {
    const store = this.store orelse return .{};
    var temporary = store.sharedView();
    temporary = temporary[this.offset..];

    if (this.part_sizes) |sizes| {
        this.skipEmptyParts(sizes);
    }
    // For multi-part blobs, prefer delivering a full part in one chunk, but
    // cap the clone at 2MB so a single huge part doesn't allocate synchronously.
    // Parts larger than the cap are split across multiple drain/pull calls —
    // `current_part_remain` is decremented below and only advances to the next
    // part when it reaches zero, so boundary preservation still holds.
    const max_drain = if (this.part_sizes != null)
        @min(
            1024 * 1024 * 2,
            if (this.current_part_remain > 0) this.current_part_remain else this.remain,
        )
    else
        @min(16384, this.remain);

    temporary = temporary[0..@min(max_drain, temporary.len)];

    var byte_list = bun.ByteList.fromBorrowedSliceDangerous(temporary);
    const cloned = bun.handleOom(byte_list.clone(bun.default_allocator));
    const drained = @as(Blob.SizeType, cloned.len);
    this.offset +|= drained;
    this.remain -|= drained;
    if (this.part_sizes) |sizes| {
        this.current_part_remain -|= drained;
        if (this.current_part_remain == 0) {
            this.current_part += 1;
            if (this.current_part < this.part_count) {
                this.current_part_remain = sizes[this.current_part];
            }
        }
    }

    return cloned;
}

pub fn toBufferedValue(this: *ByteBlobLoader, globalThis: *JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!JSValue {
    if (this.toAnyBlob(globalThis)) |blob_| {
        var blob = blob_;
        return blob.toPromise(globalThis, action);
    }

    return globalThis.ERR(.BODY_ALREADY_USED, "Body already used", .{}).reject();
}

pub fn memoryCost(this: *const ByteBlobLoader) usize {
    // ReadableStreamSource covers @sizeOf(FileReader)
    if (this.store) |store| {
        return store.memoryCost();
    }
    return 0;
}

const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const webcore = bun.webcore;
const Blob = webcore.Blob;
const streams = webcore.streams;
