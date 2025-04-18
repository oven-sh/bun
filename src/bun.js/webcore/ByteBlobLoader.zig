const ByteBlobLoader = @This();

offset: Blob.SizeType = 0,
store: ?*Blob.Store = null,
chunk_size: Blob.SizeType = 1024 * 1024 * 2,
remain: Blob.SizeType = 1024 * 1024 * 2,
done: bool = false,
pulled: bool = false,

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
    this.* = ByteBlobLoader{
        .offset = blobe.offset,
        .store = blobe.store.?,
        .chunk_size = @min(
            if (user_chunk_size > 0) @min(user_chunk_size, blobe.size) else blobe.size,
            1024 * 1024 * 2,
        ),
        .remain = blobe.size,
        .done = false,
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
        this.clearStore();
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
        if (this.offset == 0 and this.remain == store.size()) {
            if (store.toAnyBlob()) |blob| {
                defer store.deref();
                return blob;
            }
        }

        var blob = Blob.initWithStore(store, globalThis);
        blob.offset = this.offset;
        blob.size = this.remain;
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
    this.clearStore();
}

pub fn deinit(this: *ByteBlobLoader) void {
    this.clearStore();
    this.parent().deinit();
}

fn clearStore(this: *ByteBlobLoader) void {
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

    const cloned = bun.ByteList.init(temporary).listManaged(bun.default_allocator).clone() catch bun.outOfMemory();
    this.offset +|= @as(Blob.SizeType, @truncate(cloned.items.len));
    this.remain -|= @as(Blob.SizeType, @truncate(cloned.items.len));

    return bun.ByteList.fromList(cloned);
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
const webcore = bun.webcore;
const streams = webcore.streams;
const Blob = webcore.Blob;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
