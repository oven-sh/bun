//! The memory of an array buffer, which can move from one buffer to another and from thread to thread.

use core::any::Any;
use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::{null_mut, with_exposed_provenance_mut};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use bun_alloc::{AllocError, default_alloc};
use bun_engine_macros::FieldOffsets;
use bun_threading::Guarded;

use super::slice::BufferSlice;
use super::waiters;
use crate::heap::virtual_memory;
use crate::options;

pub const MAX_ARRAY_BUFFER_SIZE: usize = 1 << 32;
pub const WASM_PAGE_SIZE: usize = 64 * 1024;

/// What a resizable buffer commits at a time. One that never gets larger is allocated as a whole.
const GRANULE: usize = 64 * 1024;
/// A buffer that shrinks keeps its pages unless that many bytes have come to be unused.
const WORTH_GIVING_BACK: usize = 1 << 20;

pub type FreeBytes = unsafe extern "C" fn(bytes: *mut c_void, context: *mut c_void);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResizeError {
    InvalidLength,
    OutOfMemory,
}

/// A shared memory of WebAssembly. It never moves.
///
/// # Safety
/// The bytes from `base` up to the length are accessible for as long as the memory lives, and the length never falls.
pub unsafe trait SharedLinearMemory: Any + Send + Sync {
    fn base(&self) -> *mut u8;

    fn byte_length(&self) -> &AtomicUsize;

    /// `byte_length` is a multiple of the size of a page. It is invalid if the memory is larger already.
    fn grow_to(&self, byte_length: usize) -> Result<(), ResizeError>;
}

#[repr(C, u8)]
enum Backing {
    None,
    /// By the default allocator.
    Allocated,
    Resizable {
        committed: usize,
        /// The bytes from here on are zero, if it is above the length.
        used: usize,
    },
    External {
        free: Option<FreeBytes>,
        context: *mut c_void,
    },
    Shared {
        contents: Arc<SharedArrayBufferContents>,
        byte_length: *const AtomicUsize,
    } = ArrayBufferContents::SHARED_BACKING,
}

/// All zeros are the contents of a detached buffer.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct ArrayBufferContents {
    data: *mut u8,
    /// Of growable shared memory, what it was at some time.
    byte_length: usize,
    max_byte_length: usize,
    backing: Backing,
    is_resizable: bool,
}

// SAFETY: owns the memory, or a share of it. Whoever makes external contents vouches for `free`.
unsafe impl Send for ArrayBufferContents {}

static COMMITTED_BYTES: AtomicUsize = AtomicUsize::new(0);

/// Most of what programs commit is never touched, so there can be more of it than the machine has.
fn try_commit(address: usize, size: usize) -> Result<(), AllocError> {
    let limit = options().ram_size.saturating_mul(3);
    let total = COMMITTED_BYTES.fetch_add(size, Ordering::Relaxed) + size;
    // SAFETY: the callers pass reserved pages of their own.
    if total > limit || !unsafe { virtual_memory::commit(address, size) } {
        COMMITTED_BYTES.fetch_sub(size, Ordering::Relaxed);
        return Err(AllocError);
    }
    Ok(())
}

pub(super) fn try_allocate(byte_length: usize, is_zeroed: bool) -> Result<*mut u8, AllocError> {
    if byte_length > MAX_ARRAY_BUFFER_SIZE {
        return Err(AllocError);
    }
    // Null would mean detached.
    let size = byte_length.max(1);
    let data = if is_zeroed {
        virtual_memory::allocate_zeroed(size)
    } else {
        default_alloc::malloc(size)
    };
    if data.is_null() {
        return Err(AllocError);
    }
    Ok(data.cast())
}

impl Default for ArrayBufferContents {
    fn default() -> ArrayBufferContents {
        ArrayBufferContents::fixed(null_mut(), 0, Backing::None)
    }
}

impl ArrayBufferContents {
    pub(super) const OFFSET_OF_DATA: usize = offset_of!(ArrayBufferContents, data);
    pub(super) const OFFSET_OF_BYTE_LENGTH: usize = offset_of!(ArrayBufferContents, byte_length);
    pub const OFFSET_OF_SHARED_BYTE_LENGTH: usize =
        offset_of!(ArrayBufferContents, backing.Shared.byte_length);
    /// The first byte of `backing` if the memory is shared. It is zero if there is nothing to free.
    pub const SHARED_BACKING: u8 = 4;

    #[inline(always)]
    fn fixed(data: *mut u8, byte_length: usize, backing: Backing) -> ArrayBufferContents {
        ArrayBufferContents {
            data,
            byte_length,
            max_byte_length: byte_length,
            backing,
            is_resizable: false,
        }
    }

    #[inline]
    pub fn try_zeroed(byte_length: usize) -> Result<ArrayBufferContents, AllocError> {
        let data = try_allocate(byte_length, true)?;
        Ok(Self::fixed(data, byte_length, Backing::Allocated))
    }

    /// # Safety
    /// Each byte is written before it is read.
    #[inline]
    pub unsafe fn try_uninitialized(byte_length: usize) -> Result<Self, AllocError> {
        let data = try_allocate(byte_length, false)?;
        Ok(Self::fixed(data, byte_length, Backing::Allocated))
    }

    /// Starts with as much of `source` as fits. The rest is zero.
    pub fn try_copy_of(
        source: BufferSlice<'_, u8>,
        byte_length: usize,
    ) -> Result<ArrayBufferContents, AllocError> {
        let data = try_allocate(byte_length, byte_length > source.len())?;
        let source = source.clamped(0..byte_length);
        // SAFETY: new, and at least as long.
        unsafe { BufferSlice::new(data, source.len()) }.copy_from(source);
        Ok(Self::fixed(data, byte_length, Backing::Allocated))
    }

    pub fn try_from_slice(bytes: &[u8]) -> Result<ArrayBufferContents, AllocError> {
        let data = try_allocate(bytes.len(), false)?;
        // SAFETY: new, and of that length.
        unsafe { BufferSlice::new(data, bytes.len()) }.copy_from_slice(bytes);
        Ok(Self::fixed(data, bytes.len(), Backing::Allocated))
    }

    /// Panics if there are too many bytes.
    ///
    /// # Safety
    /// `data` is an allocation of the default allocator that has so many bytes and that the caller gives up.
    #[inline]
    pub unsafe fn adopt(data: *mut u8, byte_length: usize) -> ArrayBufferContents {
        assert!(byte_length <= MAX_ARRAY_BUFFER_SIZE);
        Self::fixed(data, byte_length, Backing::Allocated)
    }

    /// Detached if `data` is null. Panics if there are too many bytes.
    ///
    /// # Safety
    /// The bytes can be read and written until `free` is called, once, on the thread that lets go of them last.
    #[inline]
    pub unsafe fn external(
        data: *mut u8,
        byte_length: usize,
        free: Option<FreeBytes>,
        context: *mut c_void,
    ) -> ArrayBufferContents {
        assert!(byte_length <= MAX_ARRAY_BUFFER_SIZE && (byte_length == 0 || !data.is_null()));
        Self::fixed(data, byte_length, Backing::External { free, context })
    }

    /// For a memory of WebAssembly that is not shared, whose owner calls `ArrayBuffer::did_grow_wasm_memory`.
    pub fn with_max_byte_length(mut self, max_byte_length: usize) -> ArrayBufferContents {
        assert!(matches!(self.backing, Backing::External { .. }));
        assert!((self.byte_length..=MAX_ARRAY_BUFFER_SIZE).contains(&max_byte_length));
        self.max_byte_length = max_byte_length;
        self.is_resizable = true;
        self
    }

    /// Zeros.
    pub fn try_resizable(
        byte_length: usize,
        max_byte_length: usize,
    ) -> Result<ArrayBufferContents, AllocError> {
        if byte_length > max_byte_length || max_byte_length > MAX_ARRAY_BUFFER_SIZE {
            return Err(AllocError);
        }
        let (data, committed) = if max_byte_length <= GRANULE {
            (try_allocate(max_byte_length, true)?, max_byte_length)
        } else {
            let reserved = max_byte_length.next_multiple_of(GRANULE);
            let address = virtual_memory::reserve(reserved).ok_or(AllocError)?;
            (with_exposed_provenance_mut(address), 0)
        };
        let mut contents = ArrayBufferContents {
            data,
            byte_length: 0,
            max_byte_length,
            backing: Backing::Resizable { committed, used: 0 },
            is_resizable: true,
        };
        contents.grow(byte_length).map_err(|_| AllocError)?;
        Ok(contents)
    }

    /// `is_fixed_length`: it stays as long as the memory is now, which is only for one of WebAssembly.
    pub fn shared(
        contents: Arc<SharedArrayBufferContents>,
        is_fixed_length: bool,
    ) -> ArrayBufferContents {
        let byte_length = contents.byte_length();
        let max_byte_length = contents.max_byte_length.filter(|_| !is_fixed_length);
        ArrayBufferContents {
            data: contents.data,
            byte_length,
            max_byte_length: max_byte_length.unwrap_or(byte_length),
            is_resizable: max_byte_length.is_some(),
            backing: Backing::Shared {
                byte_length: contents.length_cell(),
                contents,
            },
        }
    }

    /// Panics if it is detached.
    pub fn into_shared(self) -> ArrayBufferContents {
        if self.is_shared() {
            return self;
        }
        assert!(!self.is_detached());
        let contents = SharedArrayBufferContents {
            data: self.data,
            max_byte_length: self.max_byte_length(),
            memory: SharedMemory::Own {
                byte_length: AtomicUsize::new(self.byte_length),
                contents: Guarded::new(self),
            },
        };
        Self::shared(Arc::new(contents), false)
    }

    /// Other contents with the same memory, if that is shared.
    pub fn share(&self) -> Option<ArrayBufferContents> {
        let Backing::Shared {
            contents,
            byte_length,
        } = &self.backing
        else {
            return None;
        };
        Some(ArrayBufferContents {
            backing: Backing::Shared {
                contents: Arc::clone(contents),
                byte_length: *byte_length,
            },
            ..*self
        })
    }

    /// What is left is detached, and remembers whether it was resizable.
    #[inline]
    pub(super) fn take(&mut self) -> ArrayBufferContents {
        let taken = core::mem::take(self);
        self.is_resizable = taken.is_resizable;
        taken
    }

    /// As `take`, of what is neither resizable nor shared, but the memory stays until this lets go of it too.
    pub(super) fn take_and_keep(&mut self) -> ArrayBufferContents {
        type Kept = Guarded<ArrayBufferContents>;
        unsafe extern "C" fn release(_: *mut c_void, kept: *mut c_void) {
            // SAFETY: one of the two counts.
            drop(unsafe { Arc::from_raw(kept.cast::<Kept>()) });
        }
        assert!(!self.is_resizable && !self.is_shared());
        let (data, byte_length) = (self.data, self.byte_length);
        let kept = Arc::new(Kept::new(self.take()));
        let backing = |kept: Arc<Kept>| Backing::External {
            free: Some(release),
            context: Arc::into_raw(kept).cast_mut().cast(),
        };
        self.backing = backing(Arc::clone(&kept));
        Self::fixed(data, byte_length, backing(kept))
    }

    /// Null if it is detached.
    #[inline(always)]
    pub fn data(&self) -> *mut u8 {
        self.data
    }

    #[inline(always)]
    pub fn is_detached(&self) -> bool {
        self.data.is_null()
    }

    #[inline(always)]
    pub fn byte_length(&self) -> usize {
        match self.backing {
            // SAFETY: a part of what the contents share.
            Backing::Shared { byte_length, .. } if self.is_resizable => unsafe {
                (*byte_length).load(Ordering::SeqCst)
            },
            _ => self.byte_length,
        }
    }

    #[inline(always)]
    pub fn max_byte_length(&self) -> Option<usize> {
        self.is_resizable.then_some(self.max_byte_length)
    }

    #[inline(always)]
    pub fn is_shared(&self) -> bool {
        matches!(self.backing, Backing::Shared { .. })
    }

    #[inline(always)]
    pub fn is_resizable_or_growable(&self) -> bool {
        self.is_resizable
    }

    pub fn shared_contents(&self) -> Option<&Arc<SharedArrayBufferContents>> {
        match &self.backing {
            Backing::Shared { contents, .. } => Some(contents),
            _ => None,
        }
    }

    /// `None` if others have the memory too.
    pub fn as_mut_slice(&mut self) -> Option<&mut [u8]> {
        if self.is_detached() {
            return Some(&mut []);
        }
        // SAFETY: owned.
        (!self.is_shared())
            .then(|| unsafe { core::slice::from_raw_parts_mut(self.data, self.byte_length) })
    }

    /// What it costs to keep the memory.
    pub(super) fn footprint(&self) -> usize {
        match self.backing {
            Backing::Resizable { committed, .. } => committed.max(self.reservation().min(GRANULE)),
            _ => self.byte_length(),
        }
    }

    /// The size of the address range of resizable memory, or zero if it was allocated as a whole.
    fn reservation(&self) -> usize {
        if self.max_byte_length <= GRANULE {
            return 0;
        }
        self.max_byte_length.next_multiple_of(GRANULE)
    }

    pub(super) fn grow(&mut self, byte_length: usize) -> Result<(), ResizeError> {
        let Backing::Resizable { committed, used } = &mut self.backing else {
            return Err(ResizeError::InvalidLength);
        };
        if !(self.byte_length..=self.max_byte_length).contains(&byte_length) {
            return Err(ResizeError::InvalidLength);
        }
        if byte_length > *committed {
            let needed = byte_length.next_multiple_of(GRANULE);
            try_commit(self.data.addr() + *committed, needed - *committed)
                .map_err(|_| ResizeError::OutOfMemory)?;
            *committed = needed;
        }
        // SAFETY: committed.
        unsafe { BufferSlice::<u8>::new(self.data, *used) }
            .clamped(self.byte_length..byte_length)
            .fill_with_zeros();
        *used = byte_length.max(*used);
        self.byte_length = byte_length;
        Ok(())
    }

    /// # Safety
    /// Nothing accesses the bytes that are cut off, unless `keeps_pages`.
    pub(super) unsafe fn shrink(&mut self, byte_length: usize, keeps_pages: bool) {
        assert!(byte_length <= self.byte_length);
        self.byte_length = byte_length;
        let needed = byte_length.next_multiple_of(GRANULE);
        if let Backing::Resizable { committed, used } = &mut self.backing
            && !keeps_pages
            && committed.saturating_sub(needed) >= WORTH_GIVING_BACK
            // SAFETY: whole pages of the reservation, and the caller's.
            && unsafe { virtual_memory::protect_none(self.data.addr() + needed, *committed - needed) }
        {
            COMMITTED_BYTES.fetch_sub(*committed - needed, Ordering::Relaxed);
            *committed = needed;
            *used = needed.min(*used);
        }
    }

    /// Cuts off the end of memory of the default allocator, which may move. False, having done nothing, if it cannot.
    ///
    /// # Safety
    /// Nothing accesses the bytes at their old address afterwards.
    pub(super) unsafe fn try_truncate(&mut self, byte_length: usize) -> bool {
        if !matches!(self.backing, Backing::Allocated) || byte_length > self.byte_length {
            return false;
        }
        // SAFETY: an allocation of that allocator, and the caller's.
        let data = unsafe { default_alloc::realloc(self.data.cast(), byte_length.max(1)) };
        if data.is_null() {
            return false;
        }
        self.data = data.cast();
        self.byte_length = byte_length;
        self.max_byte_length = byte_length;
        true
    }
}

impl Drop for ArrayBufferContents {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: each goes back to where it came from.
        unsafe {
            match self.backing {
                Backing::None | Backing::Shared { .. } => {}
                Backing::Resizable { committed, .. } if self.reservation() != 0 => {
                    virtual_memory::release(self.data.addr(), self.reservation());
                    COMMITTED_BYTES.fetch_sub(committed, Ordering::Relaxed);
                }
                Backing::Allocated | Backing::Resizable { .. } => {
                    default_alloc::free(self.data.cast());
                }
                Backing::External { free, context } => {
                    if let Some(free) = free {
                        free(self.data.cast(), context);
                    }
                }
            }
        }
    }
}

enum SharedMemory {
    Own {
        byte_length: AtomicUsize,
        contents: Guarded<ArrayBufferContents>,
    },
    Wasm(Arc<dyn SharedLinearMemory>),
}

/// The Shared Data Block of ECMA-262.
pub struct SharedArrayBufferContents {
    data: *mut u8,
    max_byte_length: Option<usize>,
    memory: SharedMemory,
}

// SAFETY: `data` is only handed on, to code that expects other threads to have it.
unsafe impl Send for SharedArrayBufferContents {}
// SAFETY: as above.
unsafe impl Sync for SharedArrayBufferContents {}

impl SharedArrayBufferContents {
    /// A memory has one of these, which all its buffers share.
    pub fn for_wasm_memory(
        memory: Arc<dyn SharedLinearMemory>,
        max_byte_length: usize,
    ) -> Arc<SharedArrayBufferContents> {
        assert!(max_byte_length <= MAX_ARRAY_BUFFER_SIZE);
        Arc::new(SharedArrayBufferContents {
            data: memory.base(),
            max_byte_length: Some(max_byte_length),
            memory: SharedMemory::Wasm(memory),
        })
    }

    pub fn wasm_memory(&self) -> Option<&Arc<dyn SharedLinearMemory>> {
        match &self.memory {
            SharedMemory::Own { .. } => None,
            SharedMemory::Wasm(memory) => Some(memory),
        }
    }

    pub fn data(&self) -> *mut u8 {
        self.data
    }

    fn length_cell(&self) -> &AtomicUsize {
        match &self.memory {
            SharedMemory::Own { byte_length, .. } => byte_length,
            SharedMemory::Wasm(memory) => memory.byte_length(),
        }
    }

    pub fn byte_length(&self) -> usize {
        self.length_cell().load(Ordering::SeqCst)
    }

    pub(super) fn grow(&self, new_length: usize) -> Result<(), ResizeError> {
        match &self.memory {
            SharedMemory::Own {
                byte_length,
                contents,
            } => {
                let mut contents = contents.lock();
                contents.grow(new_length)?;
                byte_length.store(new_length, Ordering::SeqCst);
                Ok(())
            }
            SharedMemory::Wasm(memory) => {
                if Some(new_length) > self.max_byte_length
                    || !new_length.is_multiple_of(WASM_PAGE_SIZE)
                {
                    return Err(ResizeError::InvalidLength);
                }
                memory.grow_to(new_length)
            }
        }
    }
}

impl Drop for SharedArrayBufferContents {
    fn drop(&mut self) {
        waiters::forget_range(self.data.addr()..self.data.addr() + self.byte_length());
    }
}
