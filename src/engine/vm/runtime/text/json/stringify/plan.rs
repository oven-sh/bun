//! What a shape tells about the text of its instances.

use core::cell::{Cell, OnceCell};
use core::hint::select_unpredictable;
use core::ptr::with_exposed_provenance;

use bun_engine_text::{CodeUnit, Cursor, Identifier, PropertyName, names};

use super::Members;
use crate::caches::is_looked_up_in_shape;
use crate::{Field, JsCell, JsObject, NoGc, PropertyOffset, Shape, TypeFlags, Value};

/// An enumerable property whose key is a string.
#[repr(C, align(16))]
pub(super) struct Member {
    /// The quoted key, a colon and a space.
    key: [[u8; Member::PART]; 3],
    /// Without the space. Zero if it does not fit.
    key_length: u8,
    byte_offset: i32,
    name: Identifier,
}

impl Member {
    const PART: usize = 16;
    pub(super) const KEY_CAPACITY: usize = 3 * Self::PART;

    fn new(name: PropertyName<'_>, offset: PropertyOffset) -> Member {
        let mut scratch = [b' '; 512];
        let length = Cursor::fill(&mut scratch, |to| {
            to.try_push_json_key(b',', name.text());
        });
        scratch[length] = b' ';
        Member {
            key: *(scratch[1..].as_chunks().0.first_chunk()).expect("longer than that"),
            key_length: if length <= Self::KEY_CAPACITY {
                length.saturating_sub(1) as u8
            } else {
                0
            },
            byte_offset: offset.byte_offset() as i32,
            name: name.to_identifier(),
        }
    }

    /// False if it is to be made from the name. A store that is wider than need be is not for free.
    #[inline(always)]
    pub(super) fn push_key<T: CodeUnit>(&self, with_space: bool, to: &mut Cursor<'_, T>) -> bool {
        const PART: usize = Member::PART;
        let length = usize::from(self.key_length) + usize::from(with_space);
        if length.wrapping_sub(2) < PART - 1 {
            to.push_latin1_prefix(&self.key[0], length);
        } else if length.wrapping_sub(PART + 1) < PART {
            to.push_latin1_prefix(&self.key[0], PART);
            to.push_latin1_prefix(&self.key[1], length - PART);
        } else if length.wrapping_sub(2 * PART + 1) < PART {
            to.push_latin1_prefix(&self.key[0], PART);
            to.push_latin1_prefix(&self.key[1], PART);
            to.push_latin1_prefix(&self.key[2], length - 2 * PART);
        } else {
            return false;
        }
        true
    }

    #[inline(always)]
    pub(super) fn name(&self) -> PropertyName<'_> {
        self.name.name()
    }

    /// What the slot has.
    ///
    /// # Safety
    /// The object has the shape that this is a member of.
    #[inline(always)]
    pub(super) unsafe fn value_in(&self, object: &JsObject) -> Option<Value> {
        let (cell, storage) = (object.address(), object.storage().address());
        let base = select_unpredictable(self.byte_offset > 0, cell, storage);
        let address = base.wrapping_add_signed(self.byte_offset as isize);
        // SAFETY: the caller's.
        unsafe { &*with_exposed_provenance::<Field<Option<Value>>>(address) }.get()
    }
}

#[derive(Default)]
pub(crate) struct Plan {
    /// The `Vm::full_prototype_chain_epoch` in which the instances were found to have no `toJSON`.
    epoch: Cell<u64>,
    members: OnceCell<Box<[Member]>>,
    /// Whether the text did not fit in bytes when an instance was last the outermost value.
    pub(super) was_wide: Cell<bool>,
}

impl Plan {
    /// In the epoch: besides, the instances are arrays, or else plain objects and the members are known.
    pub(super) const IS_COMPLETE: u64 = 1 << 63;
    const MAX_MEMBERS: usize = 128;

    #[inline(always)]
    pub(super) fn epoch(&self) -> u64 {
        self.epoch.get()
    }

    pub(super) fn complete(&self, epoch: u64) {
        self.epoch.set(epoch | Self::IS_COMPLETE);
    }

    #[inline(always)]
    pub(super) fn members(&self) -> &[Member] {
        self.members.get().map_or_default(|members| &**members)
    }

    pub(crate) fn memory_size(&self) -> usize {
        size_of_val(self.members())
    }

    /// Of a complete plan, `None` stands for elements.
    #[inline(always)]
    pub(super) fn known_members(&self) -> Option<&[Member]> {
        self.members.get().map(|members| &**members)
    }

    /// Of a complete plan.
    #[inline(always)]
    pub(super) fn kind(&self) -> Members {
        match self.known_members() {
            Some(_) => Members::Planned,
            None => Members::Elements,
        }
    }

    #[inline(always)]
    pub(super) fn of(shape: &Shape) -> Option<&Plan> {
        Some(&shape.rare_data()?.json_plan)
    }

    /// That of the shape of the cell.
    #[inline(always)]
    pub(super) fn for_cell<'a>(cell: &JsCell, _: &'a NoGc<'_>) -> Option<&'a Plan> {
        // SAFETY: it goes with the shape, which is not freed meanwhile.
        Self::of(&cell.shape()).map(|plan| unsafe { &*core::ptr::from_ref(plan) })
    }

    /// `None` if it would not last, or may not be needed again.
    pub(super) fn ensure(shape: &Shape) -> Option<&Plan> {
        (!shape.is_dictionary() && shape.lists_names_again())
            .then(|| &shape.ensure_rare_data().json_plan)
    }

    /// The same, with the members. The table has all the properties of an instance.
    pub(super) fn ensure_with_members(shape: &Shape) -> Option<&Plan> {
        if shape.slot_count() > Self::MAX_MEMBERS {
            return None;
        }
        let plan = Self::ensure(shape)?;
        plan.members.get_or_init(|| {
            let properties = shape.properties();
            let members: Box<[_]> = (properties.entries().iter())
                .filter_map(|entry| entry.as_enumerable_string())
                .map(|(name, offset)| Member::new(name, offset))
                .collect();
            (shape.heap()).note_extra_memory_allocated(shape, size_of_val(&*members));
            members
        });
        Some(plan)
    }
}

#[inline(never)]
fn lacks_own_to_json(object: &JsObject) -> bool {
    const UNRELIABLE: TypeFlags = TypeFlags::OVERRIDES_GET_PROTOTYPE
        .union(TypeFlags::PROHIBITS_PROPERTY_CACHING)
        .union(TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE)
        .union(TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE);
    let shape = object.shape();
    !shape.type_flags().intersects(UNRELIABLE)
        && is_looked_up_in_shape(object, names::toJSON)
        && shape.get(names::toJSON).is_none()
        && !(shape.has_non_reified_static_properties()
            && shape.find_static_property(names::toJSON).is_some())
}

/// Whether a lookup finds nothing and runs no code. False if that is not plain to see.
#[inline(always)]
pub(super) fn lacks_to_json(object: &JsObject, epoch: u64) -> bool {
    let is_known = |object: &JsObject| {
        Plan::of(&object.shape()).is_some_and(|it| it.epoch() & !Plan::IS_COMPLETE == epoch)
    };
    if is_known(object) {
        return true;
    }
    lacks_own_to_json(object)
        && (object.prototype_object_direct())
            .is_none_or(|it| is_known(&it) || prototype_lacks_to_json(&it, epoch))
}

/// What is added to a prototype starts a new epoch, so that it does not matter whether its shape can change.
#[inline(never)]
fn prototype_lacks_to_json(prototype: &JsObject, epoch: u64) -> bool {
    let is_absent = prototype.chain_direct().all(|it| lacks_own_to_json(&it));
    if is_absent {
        let shape = prototype.shape();
        debug_assert!(shape.may_be_prototype());
        shape.ensure_rare_data().json_plan.epoch.set(epoch);
    }
    is_absent
}
