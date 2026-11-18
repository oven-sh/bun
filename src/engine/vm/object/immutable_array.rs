use core::mem::offset_of;
use core::ops::Deref;

use bun_alloc::AllocError;

use crate::heap::{Never, visit_children_of};
use crate::{
    CellKind, CellType, CellTypeRange, Class, ClassOps, ElementKind, ElementWriter, Elements,
    Extends, Gc, GcFree, HoleMode, JsCell, Shape, Storage, TypeFlags, Value, Visitor, Vm,
    ascii_literal,
};

/// A list without holes that never changes. After the header it looks like a storage, so arrays can share it until
/// they are written to.
#[repr(C)]
pub struct ImmutableArray {
    base: JsCell,
    public_length: u32,
    vector_length: u32,
}

#[unsafe(export_name = "engine_class_ImmutableArray")]
static IMMUTABLE_ARRAY_CLASS: Class = Class::new::<ImmutableArray>(
    ascii_literal!("Cell Butterfly"),
    None,
    CellTypeRange::new(CellType::ImmutableArray, CellType::ImmutableArray),
);

impl !GcFree for ImmutableArray {}

impl Deref for ImmutableArray {
    type Target = JsCell;

    #[inline(always)]
    fn deref(&self) -> &JsCell {
        &self.base
    }
}

// SAFETY: starts with a `JsCell`.
unsafe impl Extends<JsCell> for ImmutableArray {}

// SAFETY: visits the elements.
unsafe impl CellKind for ImmutableArray {
    type Base = JsCell;
    type Init = Never;

    const CLASS: &'static Class = &IMMUTABLE_ARRAY_CLASS;
    const CELL_TYPE: CellType = CellType::ImmutableArray;
    const FLAGS: TypeFlags = TypeFlags::SHAPE_IS_IMMORTAL;
    const HOLDS_CLASS: bool = false;
    const OPS: ClassOps = {
        let mut ops = JsCell::OPS;
        ops.visit_children = visit_children_of::<ImmutableArray>;
        ops
    };

    #[inline(always)]
    fn is(cell: &JsCell) -> bool {
        cell.cell_type() == CellType::ImmutableArray
    }

    fn shape_of(init: &Self::Init) -> Gc<Shape> {
        match *init {}
    }

    unsafe fn initialize(_: *mut ImmutableArray, init: Self::Init) {
        match init {}
    }

    fn trace_fields(&self, visitor: &mut Visitor) {
        if self.kind() == ElementKind::Contiguous {
            // SAFETY: that many values follow the header.
            for field in unsafe { self.storage().values(self.public_length) } {
                crate::Trace::trace(field, visitor);
            }
        }
    }
}

impl ImmutableArray {
    pub const OFFSET_OF_LENGTH: usize = offset_of!(ImmutableArray, public_length);
    pub const OFFSET_OF_ELEMENTS: usize = size_of::<ImmutableArray>();

    /// There is always room for one element, so that the pointer to the elements is inside the cell.
    pub const fn allocation_size(length: u32) -> usize {
        Self::OFFSET_OF_ELEMENTS + if length == 0 { 1 } else { length as usize } * size_of::<u64>()
    }

    /// Panics unless `fill` writes `length` elements.
    ///
    /// # Safety
    /// None is a hole, and no collection runs meanwhile.
    #[inline(always)]
    pub(crate) unsafe fn try_build(
        vm: &Vm,
        kind: ElementKind,
        length: usize,
        fill: impl FnOnce(&mut ElementWriter<'_>),
    ) -> Result<Gc<ImmutableArray>, AllocError> {
        if length > Storage::MAX_VECTOR_LENGTH as usize {
            return Err(AllocError);
        }
        let length = length as u32;
        let size = Self::allocation_size(length);
        let address = vm.heap.cells.try_allocate(&vm.heap, size);
        if address == 0 {
            return Err(AllocError);
        }
        // SAFETY: a new cell of that size, which is complete before the next collection.
        unsafe {
            let array = Gc::<ImmutableArray>::from_address(address);
            JsCell::initialize(array.as_ptr().cast(), vm.shapes.immutable_array(kind));
            let storage = Storage::from_address(address + Self::OFFSET_OF_ELEMENTS);
            storage.set_lengths(length, length);
            let mut writer = ElementWriter::new(storage.uninitialized_elements(0, length), kind);
            fill(&mut writer);
            assert!(writer.remaining() == 0);
            Ok(array)
        }
    }

    #[inline]
    pub fn try_from_values(vm: &Vm, values: &[Value]) -> Result<Gc<ImmutableArray>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| writer.extend_from_slice(values);
        // SAFETY: only copies values.
        unsafe { Self::try_build(vm, ElementKind::Contiguous, values.len(), fill) }
    }

    /// No collection runs meanwhile.
    #[inline]
    pub fn try_from_fn(
        vm: &Vm,
        length: usize,
        mut element: impl FnMut(usize) -> Value,
    ) -> Result<Gc<ImmutableArray>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| {
            let _defer = vm.heap.defer_collection();
            (0..length).for_each(|index| writer.push(element(index)));
        };
        // SAFETY: values, with collection deferred.
        unsafe { Self::try_build(vm, ElementKind::Contiguous, length, fill) }
    }

    /// No collection runs meanwhile. Panics unless there are `length` values.
    #[inline]
    pub fn try_from_iter(
        vm: &Vm,
        length: usize,
        values: impl Iterator<Item = Value>,
    ) -> Result<Gc<ImmutableArray>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| {
            let _defer = vm.heap.defer_collection();
            values.for_each(|value| writer.push(value));
        };
        // SAFETY: values, with collection deferred.
        unsafe { Self::try_build(vm, ElementKind::Contiguous, length, fill) }
    }

    pub fn try_from_int32s(vm: &Vm, values: &[i32]) -> Result<Gc<ImmutableArray>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| {
            values.iter().for_each(|&it| writer.push(Value::int32(it)));
        };
        // SAFETY: only copies values.
        unsafe { Self::try_build(vm, ElementKind::Int32, values.len(), fill) }
    }

    pub fn try_from_doubles(vm: &Vm, values: &[f64]) -> Result<Gc<ImmutableArray>, AllocError> {
        let source = Elements::Double(values);
        if source.has_holes() {
            return Self::try_from_fn(vm, values.len(), |index| Value::double(values[index]));
        }
        let fill = |writer: &mut ElementWriter<'_>| writer.extend(source, HoleMode::Keep);
        // SAFETY: only copies, and none is NaN.
        unsafe { Self::try_build(vm, ElementKind::Double, values.len(), fill) }
    }

    /// The same values in a kind that is at least as general.
    pub fn try_generalized(&self, vm: &Vm, kind: ElementKind) -> Result<Gc<Self>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| writer.extend(self.elements(), HoleMode::Keep);
        // SAFETY: only copies what has no holes.
        unsafe { Self::try_build(vm, kind, self.len() as usize, fill) }
    }

    /// # Safety
    /// The storage of an object whose indexing mode is copy on write.
    #[inline(always)]
    pub unsafe fn from_storage(storage: Storage) -> Gc<ImmutableArray> {
        // SAFETY: the caller's.
        unsafe { Gc::from_address(storage.address() - Self::OFFSET_OF_ELEMENTS) }
    }

    #[inline(always)]
    pub fn storage(&self) -> Storage {
        Storage::from_address(self.address() + Self::OFFSET_OF_ELEMENTS)
    }

    #[inline(always)]
    pub fn kind(&self) -> ElementKind {
        self.indexing_mode().kind()
    }

    #[inline(always)]
    pub fn len(&self) -> u32 {
        self.public_length
    }

    pub fn is_empty(&self) -> bool {
        self.public_length == 0
    }

    #[inline(always)]
    pub fn get(&self, index: u32) -> Option<Value> {
        if index >= self.public_length {
            return None;
        }
        // SAFETY: inside, and of that kind.
        unsafe {
            if self.kind() == ElementKind::Double {
                Some(Value::double(self.storage().double_at(index).get()))
            } else {
                self.storage().value_at(index).get()
            }
        }
    }

    /// Unless the elements are raw doubles.
    #[inline]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub fn values(&self) -> Option<&[Value]> {
        let elements = self.storage().elements_ptr().cast();
        // SAFETY: none is empty, none changes, and the slice is inside the cell.
        (self.kind() != ElementKind::Double)
            .then(|| unsafe { core::slice::from_raw_parts(elements, self.len() as usize) })
    }

    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::stays("points into the cell"))]
    pub fn elements(&self) -> Elements<'_> {
        use core::slice::from_raw_parts;
        let (first, length) = (self.storage().elements_ptr(), self.len() as usize);
        // SAFETY: of that kind. None changes, and the slice is inside the cell.
        unsafe {
            match self.kind() {
                ElementKind::Int32 => Elements::Int32(from_raw_parts(first.cast(), length)),
                ElementKind::Double => Elements::Double(from_raw_parts(first.cast(), length)),
                _ => Elements::Contiguous(from_raw_parts(first.cast(), length)),
            }
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = Value> {
        (0..self.len()).filter_map(|index| self.get(index))
    }
}
