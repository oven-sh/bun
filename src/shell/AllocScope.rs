//! This is just a wrapper around `bun_alloc::AllocationScope` that ensures that it is
//! zero-cost in release builds.

use bun_alloc::{AllocationScope, Allocator};

// TODO(port): `bun.Environment.enableAllocScopes` is mapped to `debug_assertions` here;
// Phase B should confirm whether a dedicated `cfg(feature = "alloc_scopes")` is preferred.

pub struct AllocScope {
    #[cfg(debug_assertions)]
    __scope: AllocationScope,
    #[cfg(not(debug_assertions))]
    __scope: (),
}

impl AllocScope {
    pub fn begin_scope(alloc: &dyn Allocator) -> AllocScope {
        #[cfg(debug_assertions)]
        {
            return AllocScope {
                __scope: AllocationScope::init(alloc),
            };
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = alloc;
            AllocScope { __scope: () }
        }
    }

    pub fn end_scope(self) {
        // PORT NOTE: Zig calls `__scope.deinit()`. `AllocationScope` tears down via
        // `impl Drop`, so consuming `self` here lets field Drop cascade — no explicit
        // `.deinit()` call. Kept as a stub for structural parity with the Zig call sites.
    }

    pub fn leak_slice<T>(&mut self, memory: &[T]) {
        // Zig: `_ = @typeInfo(@TypeOf(memory)).pointer;` — compile-time assert that
        // `memory` is a pointer/slice. Enforced here by the `&[T]` parameter type.
        #[cfg(debug_assertions)]
        {
            if let Err(err) = self.__scope.track_external_free(memory, None) {
                panic!("invalid free: {}", err.name());
            }
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = memory;
        }
    }

    pub fn assert_in_scope<T>(&mut self, memory: &[T]) {
        #[cfg(debug_assertions)]
        {
            self.__scope.assert_owned(memory);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = memory;
        }
    }

    #[inline]
    pub fn allocator(&mut self) -> &dyn Allocator {
        // TODO(port): under the global-mimalloc model (`#[global_allocator]`), callers
        // use `Box`/`Vec` directly and this accessor may be obsolete. Kept for structural
        // parity; Phase B should decide whether `AllocScope` survives at all.
        #[cfg(debug_assertions)]
        {
            return self.__scope.allocator();
        }
        #[cfg(not(debug_assertions))]
        {
            bun_alloc::default_allocator()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/AllocScope.zig (43 lines)
//   confidence: medium
//   todos:      2
//   notes:      debug-only alloc tracker; whole type may be redundant under global-allocator model
// ──────────────────────────────────────────────────────────────────────────
