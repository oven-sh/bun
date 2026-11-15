//! The `state` and `stats` of a handle, which script reads and writes through two ArrayBuffers.

use core::ffi::c_void;
use core::sync::atomic::{AtomicI64, AtomicU8, AtomicU16, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};

/// # Safety
/// Every byte of `Self` is part of an atomic integer.
pub(crate) unsafe trait AllAtomic: Send + Sync + 'static {}

// SAFETY: an array holds nothing but its elements.
unsafe impl<T: AllAtomic, const N: usize> AllAtomic for [T; N] {}

macro_rules! scalars {
    ($($Name:ident($Atomic:ty, $int:ty)),+ $(,)?) => {$(
        /// Atomic because script can transfer the buffer to another thread. It orders nothing.
        #[derive(Default)]
        #[repr(transparent)]
        pub(crate) struct $Name($Atomic);

        impl $Name {
            pub(super) fn get(&self) -> $int {
                self.0.load(Ordering::Relaxed)
            }
            pub(super) fn set(&self, value: $int) {
                self.0.store(value, Ordering::Relaxed);
            }
        }

        // SAFETY: it is one.
        unsafe impl AllAtomic for $Name {}
    )+};
}

scalars!(
    U8(AtomicU8, u8),
    U16(AtomicU16, u16),
    U32(AtomicU32, u32),
    U64(AtomicU64, u64),
    I64(AtomicI64, i64),
);

/// A `#[repr(C)]` struct that is [`AllAtomic`], so its padding is spelled out.
macro_rules! state_struct {
    ($(#[$meta:meta])* $vis:vis struct $Name:ident { $($field_vis:vis $field:ident: $Field:ty),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Default)]
        #[repr(C)]
        $vis struct $Name { $($field_vis $field: $Field),+ }

        const _: () = assert!(size_of::<$Name>() == 0 $(+ size_of::<$Field>())+);
        // SAFETY: so are its fields, and they leave no gap.
        unsafe impl $crate::node::quic::exposed::AllAtomic for $Name
        where
            $($Field: $crate::node::quic::exposed::AllAtomic),+
        {
        }
    };
}
pub(super) use state_struct;

struct Memory<S, const STATS: usize> {
    state: S,
    stats: [U64; STATS],
}

/// Shares the memory with the buffers, so it does not matter what becomes of them.
pub(super) struct Exposed<S, const STATS: usize>(Arc<Memory<S, STATS>>);

impl<S: AllAtomic + Default, const STATS: usize> Exposed<S, STATS> {
    pub(super) fn new() -> Self {
        Self(Arc::new(Memory {
            state: S::default(),
            stats: core::array::from_fn(|_| U64::default()),
        }))
    }

    pub(super) fn buffers(&self, global: &JSGlobalObject) -> JsResult<Buffers> {
        Ok(Buffers {
            state: self.buffer(global, |m| &m.state)?,
            stats: self.buffer(global, |m| &m.stats)?,
        })
    }

    fn buffer<T: AllAtomic>(
        &self,
        global: &JSGlobalObject,
        part: impl FnOnce(&Memory<S, STATS>) -> &T,
    ) -> JsResult<JSValue> {
        unsafe extern "C" fn release<M>(_: *mut c_void, memory: *mut c_void) {
            // SAFETY: the ref that `buffer` took.
            drop(unsafe { Arc::from_raw(memory.cast::<M>()) });
        }
        let buffer = ArrayBuffer {
            ptr: core::ptr::from_ref(part(&self.0)).cast_mut().cast(),
            len: size_of::<T>(),
            byte_len: size_of::<T>(),
            typed_array_type: JSType::ArrayBuffer,
            ..Default::default()
        };
        let memory = Arc::into_raw(Arc::clone(&self.0));
        // SAFETY: the bytes are initialized, can be written while they are shared, take any value,
        // and live until `release` runs. It can run on any thread, as `S` is `Send` and `Sync`.
        unsafe {
            buffer.to_js_with_context(
                global,
                memory.cast_mut().cast(),
                Some(release::<Memory<S, STATS>>),
            )
        }
    }

    pub(super) fn read_stat(&self, idx: usize) -> u64 {
        self.0.stats[idx].get()
    }

    pub(super) fn write_stat(&self, idx: usize, value: u64) {
        self.0.stats[idx].set(value);
    }

    pub(super) fn add_stat(&self, idx: usize, delta: u64) {
        self.write_stat(idx, self.read_stat(idx).wrapping_add(delta));
    }
}

pub(super) struct Buffers {
    state: JSValue,
    stats: JSValue,
}

impl Buffers {
    pub(super) fn expose(self, global: &JSGlobalObject, handle: JSValue) {
        handle.put(global, b"state", self.state);
        handle.put(global, b"stats", self.stats);
        handle.put(global, b"stateByteOffset", JSValue::js_number(0.0));
        handle.put(global, b"statsByteOffset", JSValue::js_number(0.0));
    }
}

impl<S, const STATS: usize> core::ops::Deref for Exposed<S, STATS> {
    type Target = S;
    fn deref(&self) -> &S {
        &self.0.state
    }
}
