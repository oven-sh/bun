use core::ops::Deref;

use bun_alloc::AllocError;
use bun_engine_text::PropertyName;

use super::property_table::PropertyTable;
use crate::heap::{Marker, Never, visit_children_of};
use crate::{
    CellKind, CellType, CellTypeRange, Class, ClassOps, Cx, Extends, Field, Gc, GcFree,
    GlobalObject, JsCell, JsObject, JsObjectInit, PropertyOffset, Shape, ShapeFlags, ShapeSpec,
    Storage, TypeFlags, Value, Visitor, Vm, ascii_literal,
};

/// An ordinary object. The first slots follow the header.
#[repr(C)]
pub struct JsFinalObject {
    base: JsObject,
}

#[unsafe(export_name = "engine_class_FinalObject")]
static FINAL_OBJECT_CLASS: Class = Class::new::<JsFinalObject>(
    ascii_literal!("Object"),
    None,
    CellTypeRange::new(CellType::FinalObject, CellType::FinalObject),
);

impl !GcFree for JsFinalObject {}

impl Deref for JsFinalObject {
    type Target = JsObject;

    #[inline(always)]
    fn deref(&self) -> &JsObject {
        &self.base
    }
}

// SAFETY: starts with a `JsObject`.
unsafe impl<T> Extends<T> for JsFinalObject where JsObject: Extends<T> {}

// SAFETY: visits the slots too.
unsafe impl CellKind for JsFinalObject {
    type Base = JsObject;
    /// Only `JsFinalObject::allocate` knows the size.
    type Init = Never;

    const CLASS: &'static Class = &FINAL_OBJECT_CLASS;
    const CELL_TYPE: CellType = CellType::FinalObject;
    const FLAGS: TypeFlags = JsObject::FLAGS;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = {
        let mut ops = JsObject::OPS;
        ops.visit_children = visit_children_of::<JsFinalObject>;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.cell_type() == CellType::FinalObject
    }

    fn shape_of(init: &Never) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut JsFinalObject, init: Never) {
        match init {}
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        self.visit(visitor);
    }
}

impl JsFinalObject {
    #[inline(always)]
    pub(super) fn visit(&self, visitor: &mut impl Marker) {
        let Some(max_offset) = self.visit_shape_and_storage(visitor) else {
            return;
        };
        let count = if max_offset.is_inline() {
            (max_offset.get() + 1) as usize
        } else {
            let shape = self.shape_id_concurrently().address();
            // SAFETY: all shapes that the object ever has are of the same capacity.
            unsafe { Gc::<Shape>::from_address(shape) }.inline_capacity()
        };
        // SAFETY: at most the capacity.
        unsafe { visitor.append_hidden_words(self.inline_slots(count).as_ptr().cast(), count) };
    }

    pub const DEFAULT_INLINE_CAPACITY: usize = 6;
    pub const MAX_INLINE_CAPACITY: usize = 62;

    #[inline(always)]
    pub const fn allocation_size(inline_capacity: usize) -> usize {
        size_of::<JsObject>() + inline_capacity * size_of::<u64>()
    }

    /// For an object that is known to get `inferred` properties: the cell is filled up with slots.
    pub fn optimal_inline_capacity(inferred: usize) -> usize {
        const SLACK_BELOW: usize = 2;
        let wanted = match inferred {
            0 => Self::DEFAULT_INLINE_CAPACITY,
            _ => inferred.clamp(SLACK_BELOW, Self::MAX_INLINE_CAPACITY),
        };
        let size = crate::heap::optimal_size(Self::allocation_size(wanted));
        ((size - size_of::<JsObject>()) / size_of::<u64>()).min(Self::MAX_INLINE_CAPACITY)
    }

    pub fn create_shape(
        vm: &Vm,
        global: Gc<GlobalObject>,
        prototype: Value,
        inline_capacity: usize,
    ) -> Gc<Shape> {
        assert!(inline_capacity <= Self::MAX_INLINE_CAPACITY);
        let spec = ShapeSpec::of::<JsFinalObject>().with_inline_capacity(inline_capacity);
        Shape::create(vm, Some(global), prototype, spec)
    }

    #[inline(always)]
    unsafe fn inline_slots(&self, count: usize) -> &[Field<Option<Value>>] {
        let first = core::ptr::with_exposed_provenance(self.address() + size_of::<JsObject>());
        // SAFETY: the caller's.
        unsafe { core::slice::from_raw_parts(first, count) }
    }

    /// The slots in the cell are empty.
    #[inline(always)]
    pub(crate) fn allocate(vm: &Vm, init: JsObjectInit) -> Gc<JsFinalObject> {
        let shape = JsObject::shape_of(&init);
        assert!(shape.instance_type() == CellType::FinalObject);
        let capacity = shape.inline_capacity();
        let address = vm.allocate_cell_memory(Self::allocation_size(capacity));
        let object = core::ptr::with_exposed_provenance_mut::<JsObject>(address);
        // SAFETY: a new cell of that size.
        unsafe {
            JsObject::initialize(object, init);
            object.add(1).cast::<u64>().write_bytes(0, capacity);
            Gc::from_address(address)
        }
    }

    /// The properties that the shape has are undefined.
    #[inline]
    pub fn create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsFinalObject> {
        /// Up to here a loop is faster than a call to fill the slots.
        const FEW: usize = 14;
        let (capacity, used) = (shape.inline_capacity(), shape.max_offset().get() + 1);
        if capacity > FEW
            || used as usize > capacity
            || shape.instance_indexing_mode().has_elements()
            || shape.has(ShapeFlags::DICTIONARY.union(ShapeFlags::IS_CLAIMED))
        {
            return Self::create_slow(vm, shape);
        }
        assert!(shape.instance_type() == CellType::FinalObject);
        let address = vm.allocate_cell_memory(Self::allocation_size(capacity));
        // SAFETY: a new cell of that size, each word of which is written.
        unsafe {
            let object = Gc::<JsFinalObject>::from_address(address);
            let init = JsObjectInit::with_storage(shape, Storage::NONE);
            JsObject::initialize(object.as_ptr().cast(), init);
            let (used, unused) = (object.inline_slots(capacity)).split_at_unchecked(used as usize);
            for slot in used {
                slot.set_without_barrier(Some(Value::UNDEFINED));
            }
            for slot in unused {
                slot.set_without_barrier(None);
            }
            object
        }
    }

    #[inline(never)]
    fn create_slow(vm: &Vm, shape: Gc<Shape>) -> Gc<JsFinalObject> {
        let object = Self::allocate(vm, JsObjectInit::new(vm, shape));
        if shape.max_offset().is_valid() {
            // SAFETY: at most the capacity, and no cell.
            for slot in unsafe { object.inline_slots(shape.inline_size()) } {
                // SAFETY: as above.
                unsafe { slot.set_without_barrier(Some(Value::UNDEFINED)) };
            }
        }
        object
    }

    /// # Safety
    /// `Shape::is_shape_of_clones` holds.
    #[inline]
    pub unsafe fn clone_unchecked(&self, vm: &Vm) -> Gc<JsFinalObject> {
        let shape = self.shape();
        let (inline, out_of_line) = (shape.inline_capacity(), shape.out_of_line_capacity());
        let mut storage = Storage::NONE;
        // SAFETY: both have what the shape describes. `self` keeps the values alive until the new object has them.
        unsafe {
            if out_of_line != 0 {
                storage = Storage::try_allocate(vm, 0, out_of_line, None)
                    .unwrap_or_else(|_| bun_alloc::out_of_memory());
                (self.storage()).copy_words_to(storage, -1 - out_of_line as isize, out_of_line);
            }
            let address = vm.allocate_cell_memory(Self::allocation_size(inline));
            let object = core::ptr::with_exposed_provenance_mut::<JsObject>(address);
            JsObject::initialize(object, JsObjectInit::with_storage(shape, storage));
            let slots = self.inline_slots(inline).as_ptr().cast::<u64>();
            (object.add(1).cast::<u64>()).copy_from_nonoverlapping(slots, inline);
            Gc::from_address(address)
        }
    }

    /// One value for each slot of the shape, in order. Panics if there are more or fewer, or any is an accessor.
    #[inline]
    pub fn create_with_values(vm: &Vm, shape: Gc<Shape>, values: &[Value]) -> Gc<JsFinalObject> {
        // SAFETY: only reads a slice.
        unsafe { Self::create_from_iter(vm, shape, values.iter().copied()) }
    }

    /// The same, for as many as a script likes.
    #[inline(always)]
    pub fn try_create_with_values(
        vm: &Vm,
        shape: Gc<Shape>,
        values: &[Value],
    ) -> Result<Gc<JsFinalObject>, AllocError> {
        const UNFIT: ShapeFlags = (ShapeFlags::DICTIONARY.union(ShapeFlags::IS_CLAIMED))
            .union(ShapeFlags::HAS_ANY_ACCESSOR);
        let (count, capacity) = (values.len(), shape.inline_capacity());
        if (shape.max_offset().get() + 1) as usize != count
            || count.wrapping_sub(1) >= capacity
            || shape.has(UNFIT)
            || shape.instance_indexing_mode().has_elements()
        {
            return Self::try_create_with_storage(vm, shape, values);
        }
        assert!(shape.instance_type() == CellType::FinalObject);
        let address = vm.allocate_cell_memory(Self::allocation_size(capacity));
        // SAFETY: a new cell of that size, each word of which is written.
        unsafe {
            let object = Gc::<JsFinalObject>::from_address(address);
            let init = JsObjectInit::with_storage(shape, Storage::NONE);
            JsObject::initialize(object.as_ptr().cast(), init);
            let (used, unused) = object.inline_slots(capacity).split_at_unchecked(count);
            for (slot, &value) in used.iter().zip(values) {
                slot.set_without_barrier(Some(value));
            }
            for slot in unused {
                slot.set_without_barrier(None);
            }
            Ok(object)
        }
    }

    #[inline(never)]
    fn try_create_with_storage(
        vm: &Vm,
        shape: Gc<Shape>,
        values: &[Value],
    ) -> Result<Gc<JsFinalObject>, AllocError> {
        let (size, capacity) = (shape.out_of_line_size(), shape.out_of_line_capacity());
        if size == 0 || shape.instance_indexing_mode().has_elements() {
            return Ok(Self::create_with_values(vm, shape, values));
        }
        assert!(
            values.len() == shape.slot_count()
                && !shape.has(ShapeFlags::IS_CLAIMED | ShapeFlags::HAS_ANY_ACCESSOR)
        );
        let storage = Storage::try_allocate(vm, 0, capacity, None)?;
        if shape.is_dictionary() {
            shape.set_flags(ShapeFlags::IS_CLAIMED);
        }
        let (inline, out_of_line) = values.split_at(shape.inline_capacity());
        // SAFETY: each slot is written, and the caller keeps the values alive.
        unsafe {
            storage.clear_slots(size, capacity);
            for (slot, &value) in storage.slots(size).iter().rev().zip(out_of_line) {
                slot.set_without_barrier(Some(value));
            }
            let object = Self::allocate(vm, JsObjectInit::with_storage(shape, storage));
            for (slot, &value) in object.inline_slots(inline.len()).iter().zip(inline) {
                slot.set_without_barrier(Some(value));
            }
            Ok(object)
        }
    }

    /// With a value for each name, none of which is an index. Of those for the same name, the last one counts. What
    /// `values` has afterwards is unspecified.
    pub fn try_create_dictionary<'a>(
        cx: &Cx,
        names: impl Iterator<Item = PropertyName<'a>>,
        values: &mut [Value],
    ) -> Result<Gc<JsFinalObject>, AllocError> {
        let capacity = Self::DEFAULT_INLINE_CAPACITY;
        let mut table = PropertyTable::try_with_room_for(values.len())?;
        for (index, name) in (0..values.len()).zip(names) {
            assert!(name.as_index().is_none());
            values[table.find_or_add(name, capacity)] = values[index];
        }
        let count = table.len();
        let spec = ShapeSpec::of::<JsFinalObject>().with_inline_capacity(capacity);
        let (global, prototype) = (Some(cx.global()), cx.object_prototype().into());
        let shape = Shape::create_dictionary(cx, global, prototype, spec);
        shape.adopt_table(table);
        shape.set_flags(ShapeFlags::HAS_BEEN_DICTIONARY);
        Self::try_create_with_values(cx, shape, &values[..count])
    }

    /// # Safety
    /// The iterator has the length that it claims, and allocates nothing.
    #[inline(always)]
    pub unsafe fn create_from_iter(
        vm: &Vm,
        shape: Gc<Shape>,
        values: impl ExactSizeIterator<Item = Value>,
    ) -> Gc<JsFinalObject> {
        assert!(
            values.len() == shape.slot_count() && !shape.has(crate::ShapeFlags::HAS_ANY_ACCESSOR)
        );
        let object = Self::allocate(vm, JsObjectInit::new(vm, shape));
        let capacity = shape.inline_capacity();
        for (number, value) in values.enumerate() {
            let offset = PropertyOffset::for_slot(number, capacity);
            // SAFETY: a slot of the shape, in a new object.
            unsafe {
                object
                    .slot_unchecked(offset)
                    .set_without_barrier(Some(value))
            };
        }
        object
    }
}
