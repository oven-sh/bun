use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use bun_alloc::ObjectPool;

use crate::{PathBuffer, WPathBuffer};

// This pool exists because on Windows, each path buffer costs 64 KB.
// This makes the stack memory usage very unpredictable, which means we can't really know how much stack space we have left.
// This pool is a workaround to make the stack memory usage more predictable.
// We keep up to 4 path buffers alive per thread at a time.
pub struct PathBufferPoolT<T: 'static>(PhantomData<T>);

impl<T: 'static> PathBufferPoolT<T> {
    // TODO(port): ObjectPool<T, INIT, THREADSAFE, CAP> generic shape is assumed; verify against bun_alloc::ObjectPool in Phase B.
    type Pool = ObjectPool<T, (), true, 4>;

    /// Returns an RAII guard that derefs to `&mut T` and is returned to the pool on `Drop`.
    /// Callers no longer pair this with a manual `put()` (see PORTING.md idiom map).
    pub fn get() -> PoolGuard<T> {
        // use a thread-local allocator so mimalloc deletes it on thread deinit.
        // (Rust: global mimalloc + thread_local pool storage handles this; allocator param dropped.)
        PoolGuard {
            node: Self::Pool::get(),
        }
    }

    pub fn put(buffer: &T) {
        let buffer = buffer as *const T;
        // there's no deinit function on T so casting away const is fine
        // SAFETY: `buffer` points to the `data` field of a live `Pool::Node` handed out by `get()`.
        let node: *mut <Self::Pool as ObjectPoolNode>::Node = unsafe {
            (buffer as *mut T as *mut u8)
                .sub(core::mem::offset_of!(<Self::Pool as ObjectPoolNode>::Node, data))
                .cast()
        };
        // SAFETY: node was produced by Pool::get and not yet released.
        unsafe { (*node).release() };
    }

    pub fn delete_all() {
        Self::Pool::delete_all();
    }
}

/// RAII guard returned by `PathBufferPoolT::get()`. Derefs to the pooled buffer
/// and returns it to the pool on `Drop`.
pub struct PoolGuard<T: 'static> {
    // TODO(port): exact node handle type depends on bun_alloc::ObjectPool API.
    node: *mut <ObjectPool<T, (), true, 4> as ObjectPoolNode>::Node,
}

impl<T: 'static> Deref for PoolGuard<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: node is live for the lifetime of the guard.
        unsafe { &(*self.node).data }
    }
}

impl<T: 'static> DerefMut for PoolGuard<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: node is live and uniquely borrowed for the lifetime of the guard.
        unsafe { &mut (*self.node).data }
    }
}

impl<T: 'static> Drop for PoolGuard<T> {
    fn drop(&mut self) {
        // SAFETY: node was produced by Pool::get and not yet released.
        unsafe { (*self.node).release() };
    }
}

// TODO(port): helper trait to name `ObjectPool::Node` in associated-type position; remove once bun_alloc exposes it directly.
trait ObjectPoolNode {
    type Node;
}

#[allow(non_camel_case_types)]
pub type path_buffer_pool = PathBufferPoolT<PathBuffer>;
#[allow(non_camel_case_types)]
pub type w_path_buffer_pool = PathBufferPoolT<WPathBuffer>;

#[cfg(windows)]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = w_path_buffer_pool;
#[cfg(not(windows))]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = path_buffer_pool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/path_buffer_pool.zig (34 lines)
//   confidence: medium
//   todos:      3
//   notes:      ObjectPool API/node shape assumed; get() now returns RAII guard per idiom map, put() kept for structure parity.
// ──────────────────────────────────────────────────────────────────────────
