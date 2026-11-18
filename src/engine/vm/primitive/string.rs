use core::cell::UnsafeCell;
use core::mem::offset_of;
use core::num::NonZeroUsize;
use core::ops::Deref;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::AllocError;
use bun_engine_text::{PropertyName, StringImpl, StringRef, Text, names};

use crate::heap::{Heap, Marker, visit_children_of};
use crate::{
    Attributes, CellKind, CellType, CellTypeRange, Class, ClassOps, Cx, Extends, Gc, GcFree,
    JsCell, JsResult, JsRopeString, PropertySlot, Shape, TypeFlags, Visitor, Vm, ascii_literal,
};

/// The per-cell bit says that the characters are an atom. They may be one without it.
#[repr(C)]
pub struct JsString {
    base: JsCell,
    /// A counted reference to a `StringImpl` or, with `IS_ROPE`, the first fiber of a `JsRopeString`.
    fiber: UnsafeCell<usize>,
}

#[unsafe(export_name = "engine_class_String")]
static STRING_CLASS: Class = Class::new::<JsString>(
    ascii_literal!("string"),
    None,
    CellTypeRange::new(CellType::String, CellType::String),
);

impl !GcFree for JsString {}

impl Deref for JsString {
    type Target = JsCell;

    #[inline(always)]
    fn deref(&self) -> &JsCell {
        &self.base
    }
}

// SAFETY: starts with a `JsCell`.
unsafe impl Extends<JsCell> for JsString {}

unsafe extern "C" fn estimated_size(cell: &JsCell, _: &Vm) -> usize {
    let string = Gc::from(cell).cast::<JsString>();
    cell.cell_size() + string.try_impl().map_or(0, StringImpl::shared_cost)
}

// SAFETY: visits the fibers of a rope.
unsafe impl CellKind for JsString {
    type Base = JsCell;
    type Init = (Gc<Shape>, StringRef);

    const CLASS: &'static Class = &STRING_CLASS;
    const CELL_TYPE: CellType = CellType::String;
    const FLAGS: TypeFlags = TypeFlags::SHAPE_IS_IMMORTAL
        .union(TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT)
        .union(TypeFlags::INTERCEPTS_INDEXED_ACCESS);
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = {
        let mut ops = JsCell::OPS;
        ops.visit_children = visit_children_of::<JsString>;
        ops.destroy = crate::heap::destroy::<JsString>;
        ops.estimated_size = estimated_size;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.is_string()
    }

    #[inline(always)]
    fn shape_of(init: &Self::Init) -> Gc<Shape> {
        init.0
    }

    #[inline(always)]
    unsafe fn initialize(this: *mut JsString, (shape, string): Self::Init) {
        let atom_bit = u64::from(string.is_atom()) << (JsCell::OFFSET_OF_FLAGS * 8 + 7);
        let fiber = string.into_raw().as_ptr().expose_provenance();
        // SAFETY: the caller's.
        unsafe {
            this.cast::<u64>()
                .write(JsCell::header_for(&shape) | atom_bit);
            (&raw mut (*this).fiber).write(UnsafeCell::new(fiber));
        }
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        self.visit_fibers(visitor);
    }
}

impl Drop for JsString {
    #[inline(always)]
    fn drop(&mut self) {
        let fiber = *self.fiber.get_mut();
        if fiber & Self::IS_ROPE == 0 {
            // SAFETY: the reference that the cell holds.
            drop(unsafe { StringRef::from_raw(impl_at(fiber)) });
        }
    }
}

#[inline(always)]
pub(super) fn impl_at(fiber: usize) -> NonNull<StringImpl> {
    // SAFETY: a string that is no rope has characters.
    unsafe { NonNull::new_unchecked(core::ptr::with_exposed_provenance_mut(fiber)) }
}

impl JsString {
    /// A word that changes when a rope is put together and when the characters are swapped for an atom, which can be
    /// narrower. So the width and the address of the characters come from the same load of it. What it leads to may be
    /// read after a collection only if the cell was on the stack and is no rope.
    pub const OFFSET_OF_FIBER: usize = offset_of!(JsString, fiber);
    /// In the fiber. Once clear it stays so.
    pub const IS_ROPE: usize = 1;

    #[inline(always)]
    pub(super) fn allocate(vm: &Vm, string: StringRef) -> Gc<JsString> {
        vm.allocate::<JsString>((vm.shapes.string(), string))
    }

    #[inline]
    pub fn new(vm: &Vm, string: StringRef) -> Gc<JsString> {
        if let Some(small) = Self::small(vm, string.text()) {
            return small;
        }
        let cost = string.take_cost();
        let result = Self::allocate(vm, string);
        vm.heap.report_extra_memory_allocated(&result, cost);
        result
    }

    /// For characters that something else holds too and is likely to hold longer, so the collector is not charged.
    #[inline]
    pub fn new_uncharged(vm: &Vm, string: StringRef) -> Gc<JsString> {
        Self::small(vm, string.text()).unwrap_or_else(|| Self::allocate(vm, string))
    }

    /// The empty string, or that of one Latin-1 character.
    #[inline(always)]
    pub(super) fn small(vm: &Vm, text: Text<'_>) -> Option<Gc<JsString>> {
        if text.len() > 1 {
            return None;
        }
        match text.get(0) {
            None => Some(vm.small_strings.empty()),
            Some(unit) => Some(vm.small_strings.single_character(unit.try_into().ok()?)),
        }
    }

    #[inline]
    pub fn try_from_text(vm: &Vm, text: Text<'_>) -> Result<Gc<JsString>, AllocError> {
        match Self::small(vm, text) {
            Some(small) => Ok(small),
            None => Ok(Self::new(vm, StringRef::try_from_text(text)?)),
        }
    }

    /// For text whose size no script picks.
    pub fn from_text(vm: &Vm, text: Text<'_>) -> Gc<JsString> {
        Self::try_from_text(vm, text).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    pub fn from_literal(vm: &Vm, ascii: &'static str) -> Gc<JsString> {
        Self::new_uncharged(vm, StringRef::from_literal(ascii))
    }

    #[inline(always)]
    pub fn from_unit(vm: &Vm, unit: u16) -> Gc<JsString> {
        match u8::try_from(unit) {
            Ok(character) => vm.small_strings.single_character(character),
            Err(_) => Self::from_wide_units(vm, &[unit]),
        }
    }

    /// `code_point` is at most 0x10FFFF.
    #[inline]
    pub fn from_code_point(vm: &Vm, code_point: u32) -> Gc<JsString> {
        match code_point.checked_sub(0x10000) {
            None => Self::from_unit(vm, code_point as u16),
            Some(offset) => {
                let (lead, trail) = ((offset >> 10) as u16, (offset & 0x3ff) as u16);
                Self::from_wide_units(vm, &[0xd800 | lead, 0xdc00 | trail])
            }
        }
    }

    #[inline(never)]
    fn from_wide_units(vm: &Vm, units: &[u16]) -> Gc<JsString> {
        Self::allocate(vm, StringRef::from_text(Text::Utf16(units)))
    }

    #[inline(always)]
    pub(crate) fn fiber(&self) -> usize {
        // SAFETY: only this thread writes it. It is an address or has a flag.
        unsafe { *self.fiber.get().cast::<NonZeroUsize>() }.get()
    }

    #[inline(always)]
    fn fiber_atomic(&self) -> &AtomicUsize {
        // SAFETY: aligned. The plain loads are on the only thread that stores.
        unsafe { AtomicUsize::from_ptr(self.fiber.get()) }
    }

    /// `string` has the same characters. Whatever the cell held before is not released.
    #[inline(always)]
    pub(super) fn set_characters(&self, string: StringRef) {
        debug_assert!(string.len() == self.len() as usize);
        debug_assert!(string.is_latin1() || !self.is_latin1());
        if self.is_rope() {
            Heap::request_destruction(self);
            self.forget_reads();
        }
        let is_atom = string.is_atom();
        let fiber = string.into_raw().as_ptr().expose_provenance();
        self.fiber_atomic().store(fiber, Ordering::Release);
        if is_atom {
            self.set_per_cell_bit(true);
        }
    }

    #[inline(always)]
    pub fn is_rope(&self) -> bool {
        self.fiber() & Self::IS_ROPE != 0
    }

    /// A rope that stands for a part of another string.
    #[inline(always)]
    pub fn is_unresolved_substring(&self) -> bool {
        self.fiber() & JsRopeString::IS_SUBSTRING != 0
    }

    /// A rope whose characters are not in one piece.
    #[inline(always)]
    pub fn is_concatenation(&self) -> bool {
        self.fiber() & (Self::IS_ROPE | JsRopeString::IS_SUBSTRING) == Self::IS_ROPE
    }

    #[inline(always)]
    pub(super) fn as_rope(&self) -> Option<Gc<JsRopeString>> {
        // SAFETY: only a `JsRopeString` has the bit.
        self.is_rope()
            .then(|| unsafe { Gc::from(self).cast_unchecked() })
    }

    #[inline(always)]
    pub(super) fn as_concatenation(&self) -> Option<Gc<JsRopeString>> {
        // SAFETY: as above.
        self.is_concatenation()
            .then(|| unsafe { Gc::from(self).cast_unchecked() })
    }

    /// Not to be held across an allocation.
    #[inline(always)]
    pub(crate) fn try_impl(&self) -> Option<&StringImpl> {
        let fiber = self.fiber();
        // SAFETY: the cell holds a reference.
        (fiber & Self::IS_ROPE == 0).then(|| unsafe { impl_at(fiber).as_ref() })
    }

    #[inline(always)]
    pub fn len(&self) -> u32 {
        match self.as_rope() {
            Some(rope) => rope.rope_length(),
            // SAFETY: as above.
            None => unsafe { impl_at(self.fiber()).as_ref() }.len() as u32,
        }
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Whether the characters are stored as Latin-1. Once they are they stay so, and they may come to be.
    #[inline(always)]
    pub fn is_latin1(&self) -> bool {
        match self.try_impl() {
            Some(string) => string.is_latin1(),
            None => self.fiber() & JsRopeString::IS_LATIN1 != 0,
        }
    }

    #[inline(always)]
    pub fn is_atom(&self) -> bool {
        self.per_cell_bit()
    }

    pub fn to_number(&self, cx: &Cx) -> JsResult<f64> {
        Ok(bun_engine_number::string_to_number(self.view(cx)?.text()))
    }

    /// The properties that a String object has because of its value.
    #[inline]
    pub fn get_string_property_slot(
        &self,
        cx: &Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if name == names::length {
            slot.set_value_without_base(Attributes::CONSTANT, self.len().into());
            return Ok(true);
        }
        match name.as_index() {
            Some(index) => self.get_string_index_slot(cx, index, slot),
            None => Ok(false),
        }
    }

    pub fn get_string_index_slot(
        &self,
        cx: &Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if index >= self.len() {
            return Ok(false);
        }
        let attributes = Attributes::DONT_DELETE | Attributes::READ_ONLY;
        slot.set_value_without_base(attributes, self.string_at(cx, index)?.into());
        Ok(true)
    }

    #[inline(always)]
    pub(crate) fn visit_fibers(&self, visitor: &mut impl Marker) {
        let fiber = self.fiber_atomic().load(Ordering::Acquire);
        if fiber & Self::IS_ROPE != 0 {
            // SAFETY: only a `JsRopeString` has the bit.
            let rope = unsafe { Gc::from(self).cast_unchecked::<JsRopeString>() };
            rope.visit_rope(fiber, visitor);
        } else if visitor.is_first_visit() {
            // SAFETY: what is swapped out is released only after marking.
            unsafe { visitor.report_characters(fiber) };
        }
    }
}

/// # Safety
/// That of a string which is no rope, read during the marking that is under way.
#[inline(always)]
pub(crate) unsafe fn cost_of_fiber(fiber: usize) -> usize {
    // SAFETY: the caller's.
    unsafe { impl_at(fiber).as_ref() }.shared_cost()
}
