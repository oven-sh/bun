//! The pages of a memory as the contents of buffers.

use core::any::Any;
use core::ffi::c_void;
use core::sync::atomic::AtomicUsize;
use std::sync::Arc;

use bun_engine_vm::{
    ArrayBufferContents, ResizeError, SharedArrayBufferContents, SharedLinearMemory, WASM_PAGE_SIZE,
};
use bun_engine_wasm_runtime::{GrowError, Memory, Pages, SharedMemory};

/// They keep the pages that the memory has now, whatever becomes of it.
pub(super) fn unshared(memory: &Memory, is_resizable: bool) -> ArrayBufferContents {
    unsafe extern "C" fn release(_: *mut c_void, pages: *mut c_void) {
        // SAFETY: the reference that is made below.
        drop(unsafe { Arc::from_raw(pages.cast_const().cast::<Pages>()) });
    }
    let pages = memory.pages();
    let (base, length) = (pages.base(), pages.len() as usize);
    let pages = Arc::into_raw(pages).cast_mut().cast();
    // SAFETY: so many bytes are accessible for as long as the pages live, which any thread may drop.
    let contents = unsafe { ArrayBufferContents::external(base, length, Some(release), pages) };
    match is_resizable {
        true => contents.with_max_byte_length(memory.max_len() as usize),
        false => contents,
    }
}

struct SharedPages(SharedMemory);

// SAFETY: what `Pages` promises.
unsafe impl SharedLinearMemory for SharedPages {
    fn base(&self) -> *mut u8 {
        self.0.pages().base()
    }

    fn byte_length(&self) -> &AtomicUsize {
        self.0.pages().length_word()
    }

    fn grow_to(&self, byte_length: usize) -> Result<(), ResizeError> {
        let grown = self.0.grow_to((byte_length / WASM_PAGE_SIZE) as u64);
        grown.map_err(|error| match error {
            GrowError::OutOfMemory => ResizeError::OutOfMemory,
            GrowError::InvalidSize | GrowError::ExceedsMaximum => ResizeError::InvalidLength,
        })
    }
}

/// `None` unless the memory is shared. For one that is new: all threads have the same block.
pub(super) fn new_data_block(memory: &Memory) -> Option<Arc<SharedArrayBufferContents>> {
    let pages = Arc::new(SharedPages(memory.share()?));
    let max_byte_length = memory.max_len() as usize;
    Some(SharedArrayBufferContents::for_wasm_memory(
        pages,
        max_byte_length,
    ))
}

/// Of what `new_data_block` has made.
pub(super) fn memory_of(block: &SharedArrayBufferContents) -> SharedMemory {
    let memory: &dyn Any = &**block.wasm_memory().expect("that of a memory");
    let pages = memory.downcast_ref::<SharedPages>();
    pages.expect("the only kind").0.clone()
}
