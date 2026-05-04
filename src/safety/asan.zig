/// https://github.com/llvm/llvm-project/blob/main/compiler-rt/include/sanitizer/asan_interface.h
const c = if (bun.Environment.enable_asan) struct {
    extern fn __asan_poison_memory_region(ptr: *const anyopaque, size: usize) void;
    extern fn __asan_unpoison_memory_region(ptr: *const anyopaque, size: usize) void;
    extern fn __asan_address_is_poisoned(ptr: *const anyopaque) bool;
    extern fn __asan_describe_address(ptr: *const anyopaque) void;
    extern fn __asan_update_allocation_context(ptr: *const anyopaque) c_int;
    /// https://github.com/llvm/llvm-project/blob/main/compiler-rt/include/sanitizer/lsan_interface.h
    extern fn __lsan_register_root_region(ptr: *const anyopaque, size: usize) void;
    extern fn __lsan_unregister_root_region(ptr: *const anyopaque, size: usize) void;

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
    pub fn registerRootRegion(ptr: *const anyopaque, size: usize) void {
        __lsan_register_root_region(ptr, size);
    }
    pub fn unregisterRootRegion(ptr: *const anyopaque, size: usize) void {
        __lsan_unregister_root_region(ptr, size);
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
    pub fn registerRootRegion(_: *const anyopaque, _: usize) void {}
    pub fn unregisterRootRegion(_: *const anyopaque, _: usize) void {}
};

pub const enabled = bun.Environment.enable_asan;

comptime {
    if (enabled) {
        // Defined here (in bun-zig.o, a direct link input) rather than in C: in CI's
        // split build the C objects are archived into libbun.a, and clang places the
        // ASAN runtime — which already weak-defines __asan_default_options — before
        // user inputs, so an archive member that only provides this symbol is never
        // extracted and the override silently doesn't apply.
        @export(&__asan_default_options, .{ .name = "__asan_default_options" });
    }
}

fn __asan_default_options() callconv(.c) [*:0]const u8 {
    // detect_stack_use_after_return moves stack locals to a heap-backed fake stack
    // that JSC's conservative GC does not scan, so JSValues that should be kept
    // alive by being on the stack (e.g. MarkedArgumentBuffer's inline storage) get
    // collected. Also surfaces as a Thread::currentSingleton().stack().contains(this)
    // assertion in JSC::JSGlobalObject::GlobalPropertyInfo on debug builds.
    //
    // detect_leaks: off by default everywhere (it defaults on for Linux only); CI
    // opts in via ASAN_OPTIONS with a suppressions file.
    return "detect_stack_use_after_return=0:detect_leaks=0";
}

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

/// Tell LSAN to scan `[ptr, ptr+size)` for live pointers during leak checking.
///
/// Needed when a malloc-backed object is reachable only through a pointer that
/// itself lives inside a mimalloc page (which LSAN does not scan). Registering
/// the mimalloc-backed owner as a root region restores the reachability chain
/// so the malloc allocation isn't reported as a false-positive leak at exit.
pub fn registerRootRegion(ptr: *const anyopaque, size: usize) void {
    if (!comptime enabled) return;
    c.registerRootRegion(ptr, size);
}

/// Undo a prior `registerRootRegion(ptr, size)` with the exact same arguments.
pub fn unregisterRootRegion(ptr: *const anyopaque, size: usize) void {
    if (!comptime enabled) return;
    c.unregisterRootRegion(ptr, size);
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
