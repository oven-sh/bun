use core::ops::Range;

use bun_alloc::AllocError;

use crate::{
    Cx, ElementKind, ElementWriter, Gc, GlobalObject, HoleMode, ImmutableArray, IndexingMode,
    JsArray, JsArrayInit, JsObject, JsObjectInit, JsResult, NoGc, PlainRange, PropertyOffset,
    Shape, ShapeFlags, Storage, Value, Vm,
};

#[inline(always)]
fn writable_dense_kind(shape: &Shape) -> ElementKind {
    const HAS_ONE_INSTANCE: ShapeFlags = ShapeFlags::DICTIONARY.union(ShapeFlags::IS_CLAIMED);
    let mode = shape.instance_indexing_mode();
    assert!(mode.kind().is_dense() && !mode.is_copy_on_write() && !shape.has(HAS_ONE_INSTANCE));
    mode.kind()
}

/// # Safety
/// New, with the slots that the shape calls for.
#[inline(always)]
unsafe fn initialize_slots(storage: Storage, shape: &Shape) {
    // SAFETY: the caller's, and no cell.
    unsafe {
        for slot in storage.slots(shape.out_of_line_size()) {
            slot.set_without_barrier(Some(Value::UNDEFINED));
        }
    }
}

impl JsArray {
    /// `new Array(n)` is sparse from here on.
    pub const MIN_SPARSE_CONSTRUCTION_LENGTH: u32 = 1 << 27;

    /// # Safety
    /// As for `JsObjectInit::with_storage`.
    #[inline(always)]
    pub unsafe fn create_with_storage(vm: &Vm, shape: Gc<Shape>, storage: Storage) -> Gc<JsArray> {
        // SAFETY: the caller's.
        let base = unsafe { JsObjectInit::with_storage(shape, storage) };
        vm.allocate::<JsArray>(JsArrayInit { base })
    }

    /// Holes up to `length`, and room for at least `vector_length` elements.
    #[inline]
    pub fn try_create(
        vm: &Vm,
        shape: Gc<Shape>,
        length: u32,
        vector_length: u32,
    ) -> Result<Gc<JsArray>, AllocError> {
        let kind = writable_dense_kind(&shape);
        if length >= Self::MIN_SPARSE_CONSTRUCTION_LENGTH {
            return Self::try_create_sparse(vm, shape, length);
        }
        let capacity = shape.out_of_line_capacity();
        let wanted = length.max(vector_length.min(Storage::MAX_VECTOR_LENGTH));
        let vector_length = Storage::optimal_vector_length(capacity, wanted);
        let storage = Storage::try_create(vm, capacity, kind, length, vector_length)?;
        // SAFETY: made for the shape, and without any cell.
        unsafe {
            initialize_slots(storage, &shape);
            Ok(Self::create_with_storage(vm, shape, storage))
        }
    }

    #[cold]
    fn try_create_sparse(vm: &Vm, shape: Gc<Shape>, length: u32) -> Result<Gc<Self>, AllocError> {
        let array = Self::try_create(vm, shape, 0, 0)?;
        array.convert_to_sparse(vm)?;
        // SAFETY: not dense.
        unsafe { array.storage().set_public_length(length) };
        Ok(array)
    }

    /// # Safety
    /// `fill` allocates nothing in the heap.
    #[inline(always)]
    pub(crate) unsafe fn try_build_with_shape(
        vm: &Vm,
        shape: Gc<Shape>,
        room: usize,
        fill: impl FnOnce(&mut ElementWriter<'_>),
    ) -> Result<Gc<JsArray>, AllocError> {
        let (kind, capacity) = (writable_dense_kind(&shape), shape.out_of_line_capacity());
        // SAFETY: the caller's.
        unsafe { Self::try_build_unchecked(vm, shape, kind, capacity, room, fill) }
    }

    /// With the shape that the realm has for new arrays of that kind.
    ///
    /// # Safety
    /// As above.
    #[inline(always)]
    pub(crate) unsafe fn try_build_in_realm(
        vm: &Vm,
        global: &GlobalObject,
        kind: ElementKind,
        room: usize,
        fill: impl FnOnce(&mut ElementWriter<'_>),
    ) -> Result<Gc<JsArray>, AllocError> {
        assert!(kind.is_dense());
        // SAFETY: the caller's, and such a shape has no properties.
        unsafe { Self::try_build_unchecked(vm, global.array_shape(kind), kind, 0, room, fill) }
    }

    /// # Safety
    /// As above. The shape is for writable elements of that kind and for that many slots.
    #[inline(always)]
    unsafe fn try_build_unchecked(
        vm: &Vm,
        shape: Gc<Shape>,
        kind: ElementKind,
        capacity: usize,
        room: usize,
        fill: impl FnOnce(&mut ElementWriter<'_>),
    ) -> Result<Gc<JsArray>, AllocError> {
        if room > Storage::MAX_VECTOR_LENGTH as usize {
            return Err(AllocError);
        }
        let room = room as u32;
        let (storage, vector_length) = Storage::try_allocate_optimal(vm, capacity, room)?;
        // SAFETY: a collection finds an empty array or none, and nothing else finds it before it is complete.
        unsafe {
            if capacity != 0 {
                storage.clear_slots(0, capacity);
                initialize_slots(storage, &shape);
            }
            storage.set_lengths(0, vector_length);
            let array = Self::create_with_storage(vm, shape, storage);
            let mut writer = ElementWriter::new(storage.uninitialized_elements(0, room), kind);
            fill(&mut writer);
            let length = room - writer.remaining() as u32;
            for word in storage.uninitialized_elements(length, vector_length) {
                word.as_mut_ptr().write_volatile(kind.hole());
            }
            storage.set_public_length(length);
            Ok(array)
        }
    }

    /// An array of the current realm with what `fill` writes, which is at most `room` elements.
    #[inline(always)]
    #[cfg_attr(rootcheck, rootcheck::allow("`fill` runs after the allocations"))]
    pub fn build(
        cx: &mut Cx,
        kind: ElementKind,
        room: usize,
        fill: impl FnOnce(&mut ElementWriter<'_>, &NoGc<'_>),
    ) -> JsResult<Gc<JsArray>> {
        let (global, no_gc) = (cx.global(), cx.no_gc());
        // SAFETY: outlives its cells. `fill` cannot get at it, and uses the token only after the allocations.
        let array = unsafe {
            let vm = &*global.vm_ptr();
            Self::try_build_in_realm(vm, &global, kind, room, |writer| fill(writer, &no_gc))
        };
        cx.or_out_of_memory(array)
    }

    /// CreateArrayFromList. `kind` can represent all values.
    #[inline(always)]
    pub(crate) fn from_values(
        cx: &Cx,
        kind: ElementKind,
        values: &[Value],
    ) -> JsResult<Gc<JsArray>> {
        cx.or_out_of_memory(Self::try_from_values(cx, kind, values))
    }

    #[inline(always)]
    pub(crate) fn try_from_values(
        cx: &Cx,
        kind: ElementKind,
        values: &[Value],
    ) -> Result<Gc<JsArray>, AllocError> {
        let fill = |writer: &mut ElementWriter<'_>| writer.extend_from_slice(values);
        // SAFETY: only copies.
        unsafe { Self::try_build_in_realm(cx, &cx.global(), kind, values.len(), fill) }
    }

    /// Only holes, and dense however long it is.
    pub fn try_create_dense(
        vm: &Vm,
        shape: Gc<Shape>,
        length: u32,
    ) -> Result<Gc<JsArray>, AllocError> {
        if length > Storage::MAX_VECTOR_LENGTH {
            return Err(AllocError);
        }
        let array = Self::try_create(vm, shape, 0, length)?;
        // SAFETY: at most the vector length.
        unsafe { array.storage().set_public_length(length) };
        Ok(array)
    }

    /// With a value for each property of the shape, in order. No collection runs while `element` makes the elements.
    /// Panics unless the shape is for elements of any type and has that many plain properties.
    #[inline(always)]
    pub fn try_from_fn<const N: usize>(
        vm: &Vm,
        shape: Gc<Shape>,
        properties: [Value; N],
        length: usize,
        mut element: impl FnMut(usize) -> Value,
    ) -> Result<Gc<JsArray>, AllocError> {
        assert!(
            writable_dense_kind(&shape) == ElementKind::Contiguous
                && shape.out_of_line_size() == N
                && !shape.has(ShapeFlags::HAS_ANY_ACCESSOR)
        );
        if length > Storage::MAX_VECTOR_LENGTH as usize {
            return Err(AllocError);
        }
        let capacity = const { PropertyOffset::capacity_for(N) };
        let vector_length = (length as u32).max(1);
        let storage = Storage::try_allocate(vm, 0, capacity, Some(vector_length))?;
        let _defer = vm.heap.defer_collection();
        // SAFETY: new and of that size. Each word is written before the next collection.
        unsafe {
            storage.set_lengths(length as u32, vector_length);
            storage.clear_slots(N, capacity);
            for (slot, value) in storage.slots(N).iter().rev().zip(properties) {
                slot.set_without_barrier(Some(value));
            }
            storage.elements_ptr().write(0);
            for index in 0..length {
                let value = element(index);
                storage.elements_ptr().add(index).write(value.to_bits());
            }
            Ok(Self::create_with_storage(vm, shape, storage))
        }
    }

    /// The kind of the elements becomes as general as the values need.
    #[inline]
    pub fn try_from_values_with_shape(
        vm: &Vm,
        shape: Gc<Shape>,
        values: &[Value],
    ) -> Result<Gc<JsArray>, AllocError> {
        let kind = shape.instance_indexing_mode().kind();
        if kind.generalized_for_slice(values) == kind {
            let fill = |writer: &mut ElementWriter<'_>| writer.extend_from_slice(values);
            // SAFETY: only copies.
            return unsafe { Self::try_build_with_shape(vm, shape, values.len(), fill) };
        }
        let length = u32::try_from(values.len()).map_err(|_| AllocError)?;
        let array = Self::try_create(vm, shape, 0, length)?;
        array.append_values(vm, values)?;
        Ok(array)
    }

    #[inline]
    pub fn from_immutable(cx: &Cx, elements: Gc<ImmutableArray>) -> JsResult<Gc<JsArray>> {
        cx.or_out_of_memory(Self::try_from_immutable(cx, elements))
    }

    #[inline(always)]
    pub(crate) fn try_from_immutable(
        cx: &Cx,
        elements: Gc<ImmutableArray>,
    ) -> Result<Gc<JsArray>, AllocError> {
        let global = cx.global();
        if global.is_having_a_bad_time() {
            let (kind, length) = (elements.kind(), elements.len() as usize);
            let fill =
                |writer: &mut ElementWriter<'_>| writer.extend(elements.elements(), HoleMode::Keep);
            // SAFETY: only copies.
            return unsafe { Self::try_build_in_realm(cx, &global, kind, length, fill) };
        }
        let mode = IndexingMode::array(elements.kind()).copy_on_write();
        let shape = global.original_array_shape(mode);
        // SAFETY: what such a shape describes. `elements` is alive until the array has it.
        let array = unsafe { Self::create_with_storage(cx, shape, elements.storage()) };
        elements.keep_alive();
        Ok(array)
    }

    /// An array of the current realm with these elements of `source`, unless getting them runs code or
    /// allocates.
    #[inline(always)]
    pub fn try_copy(
        cx: &mut Cx,
        source: &JsObject,
        range: Range<u64>,
        holes: HoleMode,
    ) -> JsResult<Option<Gc<JsArray>>> {
        let mode = source.indexing_mode();
        if holes == HoleMode::Keep
            && (ElementKind::Int32..=ElementKind::Contiguous).contains(&mode.kind())
            && !mode.is_copy_on_write()
            && range.start <= range.end
            && range.end <= u64::from(source.public_length())
            && !source.holes_must_forward_to_prototype()
        {
            let range = range.start as u32..range.end as u32;
            return Self::copy_words(cx, source, mode.kind(), range).map(Some);
        }
        Self::try_copy_slow(cx, source, range, holes)
    }

    /// The elements are of that dense kind, and the range is below the public length.
    #[inline]
    fn copy_words(
        cx: &Cx,
        source: &JsObject,
        kind: ElementKind,
        range: Range<u32>,
    ) -> JsResult<Gc<JsArray>> {
        // SAFETY: inside, of the same kind, and only copied.
        let array = unsafe {
            Self::try_build_in_realm(cx, &cx.global(), kind, range.len(), |writer| {
                let first = source.storage().elements_ptr().add(range.start as usize);
                writer.extend_from_words(core::slice::from_raw_parts(first, range.len()));
            })
        };
        cx.or_out_of_memory(array)
    }

    #[inline(never)]
    fn try_copy_slow(
        cx: &mut Cx,
        source: &JsObject,
        range: Range<u64>,
        holes: HoleMode,
    ) -> JsResult<Option<Gc<JsArray>>> {
        if let Some(shared) = source.shared_elements()
            && range == (0..u64::from(shared.len()))
        {
            return Self::from_immutable(cx, shared).map(Some);
        }
        let Some(plain) = PlainRange::of(&cx.no_gc(), source, range, holes) else {
            return Ok(None);
        };
        if holes == HoleMode::Keep && source.element_kind() == ElementKind::Undecided {
            let length = plain.len() as u32;
            return (cx.new_array_with_length(ElementKind::Undecided, length)).map(Some);
        }
        // SAFETY: all that has happened since is allocation.
        let fill = |writer: &mut ElementWriter<'_>, _: &NoGc<'_>| unsafe { plain.write_to(writer) };
        Self::build(cx, plain.kind(), plain.len(), fill).map(Some)
    }
}
