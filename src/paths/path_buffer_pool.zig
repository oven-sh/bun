// This pool exists because on Windows, each path buffer costs 64 KB.
// This makes the stack memory usage very unpredictable, which means we can't really know how much stack space we have left.
// This pool is a workaround to make the stack memory usage more predictable.
// We keep up to 4 path buffers alive per thread at a time.
fn PathBufferPoolT(comptime T: type) type {
    return struct {
        const Pool = ObjectPool(T, null, true, 4);

        pub fn get() *T {
            // use a thread-local allocator so mimalloc deletes it on thread deinit.
            return &Pool.get(bun.threadLocalAllocator()).data;
        }

        pub fn put(buffer: *const T) void {
            // there's no deinit function on T so @constCast is fine
            var node: *Pool.Node = @alignCast(@fieldParentPtr("data", @constCast(buffer)));
            node.release();
        }

        pub fn deleteAll() void {
            Pool.deleteAll();
        }
    };
}

pub const path_buffer_pool = PathBufferPoolT(PathBuffer);
pub const w_path_buffer_pool = PathBufferPoolT(WPathBuffer);
pub const os_path_buffer_pool = if (Environment.isWindows) w_path_buffer_pool else path_buffer_pool;

const bun = @import("bun");
const Environment = bun.Environment;
const ObjectPool = bun.ObjectPool;
const PathBuffer = bun.PathBuffer;
const WPathBuffer = bun.WPathBuffer;
