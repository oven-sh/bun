//! Inline caches. They are data: the interpreter and baseline code read them, and the optimizer takes them for what is
//! likely.

mod access_case;
mod by_shape;
mod by_value;
mod call_profile;
mod cases;
mod global;
mod inline;
mod keyed;
mod load;
pub mod operations;
mod private;
mod prototype_lookup;
mod query;
mod store;

pub use access_case::{AccessCase, AccessKind, Key};
pub use by_value::{
    STATIC_KEYS, delete_by_value, get_by_value, get_by_value_with_this, has_by_value, put_by_value,
    static_name_for_key,
};
pub use call_profile::{CallProfile, CallTargetCount};
pub use cases::{AccessCases, CaseList, Last, SeenCase, Summary};
pub use inline::{InlineCase, InlineKey, InlineKind, InlineLoad, InlineStore};
pub use keyed::KeyedCase;
pub use load::{KeptResult, LoadCache, get_by_key};
pub(crate) use prototype_lookup::PrototypeLookups;
pub use prototype_lookup::{LookupEpoch, PrototypeLookup};
pub use query::{delete_by_key, has_by_key, instance_of};
pub use store::{StoreCache, StoreMode, put_by_key};

use crate::heap::{BLOCK_SIZE, PAYLOAD_SIZE};
use crate::{JsObject, ShapeId, Value};

/// What a cache takes for the shape of a value that has none.
pub const NUMBER_SHAPE: ShapeId = ShapeId::from_bits(0x10 | ShapeId::LAST_BITS);
pub const BOOLEAN_SHAPE: ShapeId = ShapeId::from_bits(0x20 | ShapeId::LAST_BITS);

/// That would be in the header of a block.
const _: () = assert!((BOOLEAN_SHAPE.bits() as usize) < BLOCK_SIZE - PAYLOAD_SIZE);

#[inline(always)]
fn shape_for_lookup(value: Value) -> ShapeId {
    match value.as_cell() {
        Some(cell) => cell.shape_id(),
        None if value.is_number() => NUMBER_SHAPE,
        None if value.is_boolean() => BOOLEAN_SHAPE,
        None => ShapeId::NONE,
    }
}

fn is_live(shape: ShapeId, survivors: &crate::heap::Survivors) -> bool {
    shape.bits() <= BOOLEAN_SHAPE.bits() || survivors.contains_shape(shape)
}

/// # Safety
/// `byte_offset` is that of a slot which the object has.
#[inline(always)]
pub unsafe fn slot_at(object: &JsObject, byte_offset: i32) -> &crate::Field<Option<Value>> {
    let base = if byte_offset > 0 {
        object.address()
    } else {
        object.storage().address()
    };
    let address = base.wrapping_add_signed(byte_offset as isize);
    // SAFETY: the caller's.
    unsafe { &*core::ptr::with_exposed_provenance(address) }
}
