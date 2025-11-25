const lshpack_header = extern struct {
    name: [*]const u8 = undefined,
    name_len: usize = 0,
    value: [*]const u8 = undefined,
    value_len: usize = 0,
    never_index: bool = false,
    hpack_index: u16 = 255,
};

/// wrapper implemented at src/bun.js/bindings/c-bindings.cpp
pub const HPACK = extern struct {
    self: *anyopaque,

    pub const DecodeResult = struct {
        name: []const u8,
        value: []const u8,
        never_index: bool,
        well_know: u16,
        // offset of the next header position in src
        next: usize,
    };

    pub const LSHPACK_MAX_HEADER_SIZE: usize = 65536;

    pub fn init(max_capacity: u32) *HPACK {
        return lshpack_wrapper_init(mimalloc.mi_malloc, mimalloc.mi_free, max_capacity) orelse bun.outOfMemory();
    }

    /// DecodeResult name and value uses a thread_local shared buffer and should be copy/cloned before the next decode/encode call
    pub fn decode(self: *HPACK, src: []const u8) !DecodeResult {
        var header: lshpack_header = .{};
        const offset = lshpack_wrapper_decode(self, src.ptr, src.len, &header);
        if (offset == 0) return error.UnableToDecode;
        if (header.name_len == 0) return error.EmptyHeaderName;

        return .{
            .name = header.name[0..header.name_len],
            .value = header.value[0..header.value_len],
            .next = offset,
            .never_index = header.never_index,
            .well_know = header.hpack_index,
        };
    }

    /// encode name, value with never_index option into dst_buffer
    /// if name + value length is greater than LSHPACK_MAX_HEADER_SIZE this will return UnableToEncode
    pub fn encode(self: *HPACK, name: []const u8, value: []const u8, never_index: bool, dst_buffer: []u8, dst_buffer_offset: usize) !usize {
        const offset = lshpack_wrapper_encode(self, name.ptr, name.len, value.ptr, value.len, @intFromBool(never_index), dst_buffer.ptr, dst_buffer.len, dst_buffer_offset);
        if (offset <= 0) return error.UnableToEncode;
        return offset;
    }

    pub fn deinit(self: *HPACK) void {
        lshpack_wrapper_deinit(self);
    }
};

const lshpack_wrapper_alloc = ?*const fn (size: usize) callconv(.c) ?*anyopaque;
const lshpack_wrapper_free = ?*const fn (ptr: ?*anyopaque) callconv(.c) void;
extern fn lshpack_wrapper_init(alloc: lshpack_wrapper_alloc, free: lshpack_wrapper_free, capacity: usize) ?*HPACK;
extern fn lshpack_wrapper_deinit(self: *HPACK) void;
extern fn lshpack_wrapper_decode(self: *HPACK, src: [*]const u8, src_len: usize, output: *lshpack_header) usize;
extern fn lshpack_wrapper_encode(self: *HPACK, name: [*]const u8, name_len: usize, value: [*]const u8, value_len: usize, never_index: c_int, buffer: [*]u8, buffer_len: usize, buffer_offset: usize) usize;

const bun = @import("bun");
const mimalloc = bun.mimalloc;
