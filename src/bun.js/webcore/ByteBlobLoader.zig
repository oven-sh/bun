const ByteBlobLoader = @This();

offset: Blob.SizeType = 0,
store: ?*Blob.Store = null,
chunk_size: Blob.SizeType = 1024 * 1024 * 2,
remain: Blob.SizeType = 1024 * 1024 * 2,
done: bool = false,
pulled: bool = false,

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
    this.* = ByteBlobLoader{
        .offset = blobe.offset,
        .store = blobe.store.?,
        .chunk_size = @min(
            if (user_chunk_size > 0) @min(user_chunk_size, blobe.size) else blobe.size,
            1024 * 1024 * 2,
        ),
        .remain = blobe.size,
        .done = false,
        .content_type = content_type,
        .content_type_allocated = content_type_allocated,
    };
}

pub fn onStart(this: *ByteBlobLoader) streams.Start {
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

    temporary = temporary[0..@min(buffer.len, @min(temporary.len, this.remain))];
    if (temporary.len == 0) {
        this.clearData();
        this.done = true;
        return .{ .done = {} };
    }

    const copied = @as(Blob.SizeType, @intCast(temporary.len));

    this.remain -|= copied;
    this.offset +|= copied;
    bun.assert(buffer.ptr != temporary.ptr);
    @memcpy(buffer[0..temporary.len], temporary);
    if (this.remain == 0) {
        return .{ .into_array_and_done = .{ .value = array, .len = copied } };
    }

    return .{ .into_array = .{ .value = array, .len = copied } };
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
    temporary = temporary[0..@min(16384, @min(temporary.len, this.remain))];

    var byte_list = bun.ByteList.fromBorrowedSliceDangerous(temporary);
    const cloned = bun.handleOom(byte_list.clone(bun.default_allocator));
    this.offset +|= @as(Blob.SizeType, cloned.len);
    this.remain -|= @as(Blob.SizeType, cloned.len);

    return cloned;
}

pub fn toBufferedValue(this: *ByteBlobLoader, globalThis: *JSGlobalObject, action: streams.BufferAction.Tag) bun.JSError!JSValue {
    if (this.toAnyBlob(globalThis)) |blob_| {
        var blob = blob_;
        return blob.toPromise(globalThis, action);
    }

    return .zero;
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
