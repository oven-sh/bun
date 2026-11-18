use core::cell::Cell;

use crate::{ElementKind, Gc, IndexingMode, JsArray};

/// What became of the arrays that an instruction has made. Zero is where it starts.
#[derive(Default)]
#[repr(transparent)]
pub struct ArrayAllocationProfile(Cell<u64>);

impl ArrayAllocationProfile {
    /// The low bits are the address of the last array, which they do not keep alive, or zero.
    pub const ARRAY_MASK: u64 = (1 << Self::VECTOR_LENGTH_SHIFT) - 1;
    pub const VECTOR_LENGTH_SHIFT: u32 = 48;
    pub const KIND_SHIFT: u32 = 56;
    const MAX_VECTOR_LENGTH_HINT: u32 = 25;
    /// One of them has had elements of its own.
    const HAS_BEEN_WRITTEN: u64 = 1 << Self::KIND_SHIFT;
    const MAX_COPIED: u32 = 16;

    /// The kind and the vector length that the word records.
    #[inline(always)]
    pub fn decode(word: u64) -> (ElementKind, u32) {
        let kind = IndexingMode::from_bits((word >> Self::KIND_SHIFT) as u8).kind();
        let vector_length = u32::from((word >> Self::VECTOR_LENGTH_SHIFT) as u8);
        (kind.max(ElementKind::Undecided), vector_length)
    }

    /// Takes the last array into account and forgets it. Returns what `decode` does.
    ///
    /// # Safety
    /// It has been called by each collection that found the last array dead, before anything was swept.
    #[inline(always)]
    pub unsafe fn update(&self) -> (ElementKind, u32) {
        let word = self.0.get();
        let (mut kind, mut vector_length) = Self::decode(word);
        let address = word & Self::ARRAY_MASK;
        if address != 0 {
            // SAFETY: the caller's.
            let array = unsafe { Gc::<JsArray>::from_address(address as usize) };
            if array.element_kind().is_dense() {
                kind = kind.max(array.element_kind());
                let seen = array.vector_length().min(Self::MAX_VECTOR_LENGTH_HINT);
                vector_length = vector_length.max(seen);
            }
            let has_own_elements = !array.indexing_mode().is_copy_on_write();
            self.0.set(
                (kind as u64 | u64::from(has_own_elements)) << Self::KIND_SHIFT
                    | word & Self::HAS_BEEN_WRITTEN
                    | u64::from(vector_length) << Self::VECTOR_LENGTH_SHIFT,
            );
        }
        (kind, vector_length)
    }

    /// Whether sharing that many elements would only put the copy off.
    #[inline(always)]
    pub fn prefers_copy_of(&self, length: u32) -> bool {
        self.0.get() & Self::HAS_BEEN_WRITTEN != 0 && length <= Self::MAX_COPIED
    }

    #[inline(always)]
    pub fn did_allocate(&self, array: Gc<JsArray>) -> Gc<JsArray> {
        (self.0).update(|word| word & !Self::ARRAY_MASK | array.address() as u64);
        array
    }
}
