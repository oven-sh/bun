/// https://github.com/llvm/llvm-project/blob/main/compiler-rt/include/sanitizer/asan_interface.h
const c = if (bun.Environment.enable_asan) struct {
    extern fn __asan_poison_memory_region(ptr: *const anyopaque, size: usize) void;
    extern fn __asan_unpoison_memory_region(ptr: *const anyopaque, size: usize) void;
    extern fn __asan_address_is_poisoned(ptr: *const anyopaque) bool;
    extern fn __asan_describe_address(ptr: *const anyopaque) void;
    extern fn __asan_update_allocation_context(ptr: *const anyopaque) c_int;

    pub fn poison(ptr: *const anyopaque, size: usize) void {
        __asan_poison_memory_region(ptr, size);
    }
    pub fn unpoison(ptr: *const anyopaque, size: usize) void {
        __asan_unpoison_memory_region(ptr, size);
    }
    pub fn isPoisoned(ptr: *const anyopaque) bool {
        return __asan_address_is_poisoned(ptr);
    }
    pub fn describe(ptr: *const anyopaque) void {
        __asan_describe_address(ptr);
    }
    pub fn updateAllocationContext(ptr: *const anyopaque) c_int {
        return __asan_update_allocation_context(ptr);
    }
} else struct {
    pub fn poison(_: *const anyopaque) void {}
    pub fn unpoison(_: *const anyopaque) void {}
    pub fn isPoisoned(_: *const anyopaque) bool {
        return false;
    }
    pub fn describe(_: *const anyopaque) void {}
    pub fn updateAllocationContext(_: *const anyopaque) c_int {
        return 0;
    }
};

pub const enabled = bun.Environment.enable_asan;

/// Update allocation stack trace for the given allocation to the current stack
/// trace
pub fn updateAllocationContext(ptr: *const anyopaque) bool {
    if (!comptime enabled) return false;
    return c.updateAllocationContext(ptr) == 1;
}

/// Describes an address (prints out where it was allocated, freed, stacktraces,
/// etc.)
pub fn describe(ptr: *const anyopaque) void {
    if (!comptime enabled) return;
    c.describe(ptr);
}

/// Manually poison a memory region
///
/// Useful for making custom allocators asan-aware (for example HiveArray)
///
/// *NOT* threadsafe
pub fn poison(ptr: *const anyopaque, size: usize) void {
    if (!comptime enabled) return;
    c.poison(ptr, size);
}

/// Manually unpoison a memory region
///
/// Useful for making custom allocators asan-aware (for example HiveArray)
///
/// *NOT* threadsafe
pub fn unpoison(ptr: *const anyopaque, size: usize) void {
    if (!comptime enabled) return;
    c.unpoison(ptr, size);
}

fn isPoisoned(ptr: *const anyopaque) bool {
    if (!comptime enabled) return false;
    return c.isPoisoned(ptr);
}

pub fn assertPoisoned(ptr: *const anyopaque) void {
    if (!comptime enabled) return;
    if (!isPoisoned(ptr)) {
        c.describe(ptr);
        @panic("Address is not poisoned");
    }
}

pub fn assertUnpoisoned(ptr: *const anyopaque) void {
    if (!comptime enabled) return;
    if (isPoisoned(ptr)) {
        c.describe(ptr);
        @panic("Address is poisoned");
    }
}

const bun = @import("bun");
