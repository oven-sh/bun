//! Methods of the embedder that read or write one number in a `Uint8Array`, which a compiler can do itself.

use bun_engine_macros::FieldOffsets;
use bun_threading::Guarded;

use crate::NativeFunction;

/// `read(offset)` returns the number, and `write(value, offset)` the offset after it. An offset that is missing is zero,
/// unless the size is an argument. They throw for an offset or an integer that is out of range.
#[derive(Clone, Copy, PartialEq, Eq, Debug, FieldOffsets)]
#[repr(C)]
pub struct BufferAccessor {
    /// Zero if one more argument says. An integer of eight bytes is a BigInt.
    pub byte_size: u8,
    pub is_signed: bool,
    pub is_float: bool,
    pub is_little_endian: bool,
    pub is_write: bool,
}

static ACCESSORS: Guarded<Vec<(usize, BufferAccessor)>> = Guarded::new(Vec::new());

impl BufferAccessor {
    /// Once for each function whose intrinsic is `BufferAccessor`.
    pub fn register(self, function: NativeFunction) {
        ACCESSORS.lock().push((function as usize, self));
    }

    pub fn of(function: NativeFunction) -> Option<BufferAccessor> {
        let accessors = ACCESSORS.lock();
        let entry = accessors.iter().find(|it| it.0 == function as usize);
        entry.map(|it| it.1)
    }
}
