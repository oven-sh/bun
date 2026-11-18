//! Typed arrays that have no buffer yet.

use bun_alloc::AllocError;

use super::classes::class_of_view;
use super::contents::{MAX_ARRAY_BUFFER_SIZE, try_allocate};
use super::element::{Element, ElementType};
use super::slice::BufferSlice;
use super::view::ViewMode;
use crate::{
    CellKind, Cx, Gc, JsArrayBufferView, JsResult, JsTypedArray, NoGc, Shape, TypedArray, Vm,
};

/// Writes the elements of a new array from the first on.
pub struct Filler<'a, T> {
    rest: BufferSlice<'a, T>,
}

impl<'a, T: Element> Filler<'a, T> {
    /// The next `count` elements, all of which the caller writes without reading any. Panics if fewer are left.
    #[inline(always)]
    pub(super) fn reserve(&mut self, count: usize) -> BufferSlice<'a, T> {
        let next = self.rest.slice(0..count);
        self.rest = self.rest.slice(count..self.rest.len());
        next
    }

    /// `write` gets all that are left, reads none, and returns how many it has written.
    #[inline(always)]
    pub(super) fn write_some(&mut self, write: impl FnOnce(BufferSlice<'a, T>) -> usize) -> usize {
        let count = write(self.rest);
        self.reserve(count);
        count
    }

    /// Panics if they do not fit.
    #[inline]
    pub fn copy(&mut self, source: BufferSlice<'_, T>) {
        self.reserve(source.len()).copy_from(source);
    }

    /// Panics if they do not fit.
    #[inline]
    pub fn copy_reversed(&mut self, source: BufferSlice<'_, T>) {
        self.reserve(source.len()).copy_reversed_from(source);
    }
}

/// All panic unless the shape is for typed arrays on buffers of a fixed length. It says what the elements are.
impl JsTypedArray {
    #[inline(always)]
    pub(super) fn element_type_of(shape: &Shape) -> ElementType {
        let cell_type = shape.instance_type();
        JsArrayBufferView::assert_shape(shape, class_of_view(cell_type, false));
        ElementType::of_cell_type(cell_type).expect("the shape of a typed array")
    }

    #[inline(always)]
    fn try_allocate(
        vm: &Vm,
        shape: Gc<Shape>,
        length: usize,
        is_zeroed: bool,
    ) -> Result<Gc<JsTypedArray>, AllocError> {
        let shift = Self::element_type_of(&shape).size_shift();
        if length > JsArrayBufferView::MAX_SMALL_LENGTH {
            if length > MAX_ARRAY_BUFFER_SIZE >> shift {
                return Err(AllocError);
            }
            vm.heap.will_allocate_extra_memory(length << shift);
            let vector = try_allocate(length << shift, is_zeroed)?;
            // SAFETY: new, and of that length.
            return Ok(unsafe { Self::adopt(vm, shape, vector, length) });
        }
        let size = (length << shift).next_multiple_of(size_of::<u64>());
        let vector = JsArrayBufferView::allocate_small_vector(vm, size)?;
        // SAFETY: new and of that size, and the class is checked.
        unsafe {
            if is_zeroed {
                vector.write_bytes(0, size);
            }
            let mode = ViewMode::empty();
            Ok(JsArrayBufferView::allocate(vm, shape, vector, length, 0, mode, 0).cast_unchecked())
        }
    }

    /// Panics if there are too many elements.
    ///
    /// # Safety
    /// `vector` is an allocation of the default allocator that has so many elements and that the caller gives up.
    #[inline(never)]
    pub unsafe fn adopt(vm: &Vm, shape: Gc<Shape>, vector: *mut u8, length: usize) -> Gc<Self> {
        let shift = Self::element_type_of(&shape).size_shift();
        assert!(length <= MAX_ARRAY_BUFFER_SIZE >> shift && !vector.is_null());
        // SAFETY: the caller's, and the class is checked.
        unsafe {
            let view =
                JsArrayBufferView::allocate(vm, shape, vector, length, 0, ViewMode::OVERSIZE, 0);
            vm.services.buffers.add_oversize_view(&view);
            (vm.heap).report_extra_memory_allocated(&view, length << shift);
            view.cast_unchecked()
        }
    }

    /// Zeros.
    pub fn create(cx: &Cx, shape: Gc<Shape>, length: usize) -> JsResult<Gc<JsTypedArray>> {
        cx.or_out_of_memory(Self::try_allocate(cx, shape, length, true))
    }

    /// # Safety
    /// Each element is written before it is read.
    pub unsafe fn create_uninitialized(
        cx: &Cx,
        shape: Gc<Shape>,
        length: usize,
    ) -> JsResult<Gc<JsTypedArray>> {
        cx.or_out_of_memory(Self::try_allocate(cx, shape, length, false))
    }

    /// `fill` sees the memory as `T`s, which are not larger than the elements. What it leaves is zero.
    #[inline]
    pub fn create_filled<T: Element>(
        cx: &mut Cx,
        shape: Gc<Shape>,
        length: usize,
        fill: impl FnOnce(&NoGc<'_>, &mut Filler<'_, T>),
    ) -> JsResult<Gc<JsTypedArray>> {
        // SAFETY: the filler only writes, and has written all of them in the end.
        let array = unsafe { Self::create_uninitialized(cx, shape, length) }?;
        assert!(size_of::<T>() <= 1 << array.size_shift());
        let no_gc = cx.no_gc();
        let mut filler = Filler {
            rest: array.bytes(&no_gc).cast(),
        };
        fill(&no_gc, &mut filler);
        if !filler.rest.is_empty() {
            filler.rest.fill_with_zeros();
        }
        Ok(array)
    }
}

/// These panic unless it says `T`.
impl<T: Element> TypedArray<T> {
    /// Zeros.
    #[inline]
    pub fn create(cx: &Cx, shape: Gc<Shape>, length: usize) -> JsResult<Gc<TypedArray<T>>> {
        JsTypedArray::create(cx, shape, length).map(Gc::cast)
    }

    pub fn from_slice(cx: &Cx, shape: Gc<Shape>, elements: &[T]) -> JsResult<Gc<TypedArray<T>>> {
        // SAFETY: all are written, and nothing else has the array yet.
        unsafe {
            let array = JsTypedArray::create_uninitialized(cx, shape, elements.len())?;
            let array = array.cast::<TypedArray<T>>();
            array.elements_unchecked().copy_from_slice(elements);
            Ok(array)
        }
    }

    pub fn from_vec(cx: &Cx, shape: Gc<Shape>, elements: Vec<T>) -> JsResult<Gc<TypedArray<T>>> {
        let length = elements.len();
        if length <= JsArrayBufferView::MAX_SMALL_LENGTH
            || length > MAX_ARRAY_BUFFER_SIZE / size_of::<T>()
        {
            return Self::from_slice(cx, shape, &elements);
        }
        assert!(shape.instance_type() == Self::CELL_TYPE);
        let vector = elements.leak().as_mut_ptr().cast();
        // SAFETY: the global allocator is the default one.
        Ok(unsafe { JsTypedArray::adopt(cx, shape, vector, length) }.cast())
    }
}
