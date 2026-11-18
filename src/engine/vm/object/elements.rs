//! Properties whose names are array indices.

use core::ops::Range;

use bun_alloc::AllocError;
use bun_engine_text::Identifier;
use bun_highway::elements::{index_of_nan, index_of_u64};

use crate::{
    Attributes, CellType, Cx, DeferredFire, DontEnumMode, ElementKind, Gc, GetterSetter,
    GlobalObject, GlobalProxy, HoleMode, ImmutableArray, IndexingMode, JsArrayBufferView, JsObject,
    JsResult, NoGc, PropertyDescriptor, PropertyNameList, PropertySlot, ProxyObject,
    PutPropertySlot, ShapeFlags, SparseElements, SparseEntry, Storage, TransitionKind, TypeFlags,
    Value, Vm, errors,
};

pub(super) const MIN_SPARSE_INDEX: u32 = 100_000;
const MIN_SPARSE_DISTANCE: u32 = 1000;
const MIN_DENSITY: u32 = 8;
/// For elements that are likely to be dense soon.
const MIN_DENSITY_WHILE_FILLING: u32 = 256;

pub(super) fn is_dense_enough(length: u32, count: usize) -> bool {
    (length / MIN_DENSITY) as usize <= count
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PutDirectIndexMode {
    /// Also on an object that is not extensible.
    LikePutDirect,
    ShouldNotThrow,
    ShouldThrow,
}

/// The dense elements below the public length.
#[derive(Clone, Copy)]
pub enum Elements<'a> {
    /// `None` is a hole.
    Int32(&'a [Option<Value>]),
    /// NaN is a hole.
    Double(&'a [f64]),
    Contiguous(&'a [Option<Value>]),
}

impl<'a> Elements<'a> {
    #[inline(always)]
    pub fn len(self) -> usize {
        self.words().len()
    }

    #[inline(always)]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline(always)]
    pub fn kind(self) -> ElementKind {
        match self {
            Elements::Int32(_) => ElementKind::Int32,
            Elements::Double(_) => ElementKind::Double,
            Elements::Contiguous(_) => ElementKind::Contiguous,
        }
    }

    /// That of a copy.
    #[inline]
    pub fn kind_with(self, holes: HoleMode) -> ElementKind {
        let kind = self.kind();
        if holes == HoleMode::Keep || kind == ElementKind::Contiguous || !self.has_holes() {
            kind
        } else {
            ElementKind::Contiguous
        }
    }

    /// As they are stored.
    #[inline(always)]
    pub fn words(self) -> &'a [u64] {
        let (first, length) = match self {
            Elements::Int32(values) | Elements::Contiguous(values) => {
                (values.as_ptr().cast(), values.len())
            }
            Elements::Double(numbers) => (numbers.as_ptr().cast(), numbers.len()),
        };
        // SAFETY: each is eight bytes without padding.
        unsafe { core::slice::from_raw_parts(first, length) }
    }

    /// Panics if the range is not inside.
    #[inline(always)]
    pub fn slice(self, range: Range<usize>) -> Elements<'a> {
        match self {
            Elements::Int32(values) => Elements::Int32(&values[range]),
            Elements::Double(numbers) => Elements::Double(&numbers[range]),
            Elements::Contiguous(values) => Elements::Contiguous(&values[range]),
        }
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn at(self, index: usize) -> Option<Value> {
        match self {
            Elements::Int32(values) | Elements::Contiguous(values) => values[index],
            Elements::Double(numbers) => {
                let number = numbers[index];
                (!number.is_nan()).then(|| Value::double(number))
            }
        }
    }

    #[inline]
    pub fn iter(self) -> impl DoubleEndedIterator<Item = Option<Value>> + ExactSizeIterator + 'a {
        (0..self.len()).map(move |index| self.at(index))
    }

    #[inline]
    pub fn first_hole(self) -> Option<usize> {
        match self {
            Elements::Double(numbers) => index_of_nan(numbers),
            _ => index_of_u64(self.words(), 0),
        }
    }

    #[inline]
    pub fn has_holes(self) -> bool {
        self.first_hole().is_some()
    }
}

impl JsObject {
    #[inline(always)]
    pub fn element_kind(&self) -> ElementKind {
        self.indexing_mode().kind()
    }

    /// One more than the highest index that may be in use. Of an array, its length.
    #[inline(always)]
    pub fn public_length(&self) -> u32 {
        if self.indexing_mode().has_elements() {
            // SAFETY: it has lengths.
            unsafe { self.storage().public_length() }
        } else {
            0
        }
    }

    #[inline(always)]
    pub fn vector_length(&self) -> u32 {
        if self.indexing_mode().has_elements() {
            // SAFETY: as above.
            unsafe { self.storage().vector_length() }
        } else {
            0
        }
    }

    /// # Safety
    /// The object has elements.
    #[inline(always)]
    pub(super) unsafe fn element_words(&self) -> u32 {
        // SAFETY: the caller's.
        unsafe { self.storage().vector_length() }.max(1)
    }

    pub fn sparse_elements(&self) -> Option<Gc<SparseElements>> {
        // SAFETY: what the first slot has for that kind.
        (self.element_kind() == ElementKind::Sparse).then(|| unsafe {
            Gc::from_address(Value::bits_of(self.storage().value_at(0).get()) as usize)
        })
    }

    /// `None` unless the elements are dense. An object without any has an empty slice.
    #[inline(always)]
    pub fn elements<'a>(&self, _: &'a NoGc<'_>) -> Option<Elements<'a>> {
        // SAFETY: changing them takes the token exclusively, or the `Vm` that it keeps borrowed.
        unsafe { self.elements_unchecked() }
    }

    /// The same, if they are of that kind.
    #[inline(always)]
    pub(crate) fn contiguous_elements<'a>(&self, _: &'a NoGc<'_>) -> Option<&'a [Option<Value>]> {
        if self.indexing_mode().bits() & IndexingMode::KIND_MASK != ElementKind::Contiguous as u8 {
            return None;
        }
        let storage = self.storage();
        // SAFETY: as above.
        Some(unsafe {
            let (first, length) = (storage.elements_ptr(), storage.public_length() as usize);
            core::slice::from_raw_parts(first.cast(), length)
        })
    }

    /// Panics if they are sparse.
    #[inline(always)]
    pub fn dense_elements<'a>(&'a self, no_gc: &'a NoGc<'_>) -> Elements<'a> {
        self.elements(no_gc).expect("dense elements")
    }

    /// What the object shares until it is written to.
    #[inline(always)]
    pub fn shared_elements(&self) -> Option<Gc<ImmutableArray>> {
        // SAFETY: of that mode.
        (self.indexing_mode().is_copy_on_write())
            .then(|| unsafe { ImmutableArray::from_storage(self.storage()) })
    }

    /// # Safety
    /// Nothing changes the elements or collects while the borrow lasts.
    #[inline(always)]
    pub unsafe fn elements_unchecked<'a>(&self) -> Option<Elements<'a>> {
        use core::slice::from_raw_parts;
        let kind = self.element_kind();
        if !kind.is_dense() {
            return (kind == ElementKind::None).then_some(Elements::Int32(&[]));
        }
        let storage = self.storage();
        // SAFETY: the caller's, and the kind says what they are.
        unsafe {
            let (first, length) = (storage.elements_ptr(), storage.public_length() as usize);
            Some(if kind == ElementKind::Contiguous {
                Elements::Contiguous(from_raw_parts(first.cast(), length))
            } else if kind == ElementKind::Double {
                Elements::Double(from_raw_parts(first.cast(), length))
            } else {
                Elements::Int32(from_raw_parts(first.cast(), length))
            })
        }
    }

    /// Dense, and neither shared nor restricted in any way.
    #[inline(always)]
    pub fn has_plain_writable_elements(&self) -> bool {
        let mode = self.indexing_mode();
        mode.kind().is_dense() && !mode.is_copy_on_write() && !mode.is_slow_put()
    }

    /// Dense, and a store anywhere defines a plain data property. They may be shared.
    #[inline(always)]
    pub fn has_unrestricted_elements(&self) -> bool {
        let mode = self.indexing_mode();
        mode.kind().is_dense() && !mode.is_slow_put()
    }

    #[inline(always)]
    pub fn try_get_dense(&self, index: u32) -> Option<Value> {
        // SAFETY: of that kind, and below the length.
        unsafe {
            let is_inside = || index < self.storage().public_length();
            match self.element_kind() {
                ElementKind::Int32 | ElementKind::Contiguous if is_inside() => {
                    self.storage().value_at(index).get()
                }
                ElementKind::Double if is_inside() => {
                    let number = self.storage().double_at(index).get();
                    (!number.is_nan()).then(|| Value::double(number))
                }
                _ => None,
            }
        }
    }

    /// If there is a writable data property at the index, and the value takes no other kind of elements.
    #[inline]
    pub(crate) fn try_replace_element(&self, vm: &Vm, index: u32, value: Value) -> bool {
        if let Some(sparse) = self.sparse_elements() {
            let did_replace = sparse.try_replace(index, value);
            self.convert_to_dense_if_worthwhile(vm, &sparse);
            return did_replace;
        }
        let kind = self.element_kind();
        if self.try_get_dense(index).is_none()
            || self.indexing_mode().is_copy_on_write()
            || ElementKind::for_value(value) > kind
            || self.shape().has(ShapeFlags::ELEMENTS_ARE_FROZEN)
        {
            return false;
        }
        // SAFETY: inside, and the kind can represent the value.
        unsafe { store_unchecked(self.storage(), kind, index, value) };
        self.write_barrier(value);
        true
    }

    #[inline(always)]
    pub(crate) fn has_ordinary_store_by_index(&self) -> bool {
        matches!(self.cell_type(), CellType::Array | CellType::FinalObject)
    }

    /// Of an object for which `has_unrestricted_elements` holds.
    #[inline(always)]
    pub(crate) fn set_unrestricted_element(
        &self,
        vm: &Vm,
        index: u32,
        value: Value,
    ) -> Result<(), AllocError> {
        if self.try_set_dense(vm, index, value) {
            return Ok(());
        }
        self.store_element(vm, index, value)
    }

    /// If it takes neither more memory nor another kind.
    #[inline(always)]
    pub fn try_set_dense(&self, _: &Vm, index: u32, value: Value) -> bool {
        let mode = self.indexing_mode().bits() & IndexingMode::KIND_AND_WRITABILITY_MASK;
        // SAFETY: of that kind, and below the vector length.
        unsafe {
            let has_room = || index < self.storage().vector_length();
            if mode == ElementKind::Contiguous as u8 && has_room() {
                self.storage().value_at(index).set(self, Some(value));
            } else if mode == ElementKind::Int32 as u8 && value.is_int32() && has_room() {
                (self.storage().value_at(index)).set_without_barrier(Some(value));
            } else if mode == ElementKind::Double as u8
                && has_room()
                && let Some(number) = value.as_number().filter(|number| !number.is_nan())
            {
                self.storage().double_at(index).set(number);
            } else {
                return false;
            }
            let storage = self.storage();
            if index >= storage.public_length() {
                storage.set_public_length(index + 1);
            }
        }
        true
    }

    /// Whether reading a hole has to look further than this object.
    #[inline]
    pub fn holes_must_forward_to_prototype(&self) -> bool {
        !self.inherits_as_arrays_do() && self.holes_must_forward_to_prototype_slow()
    }

    /// It is an array, and `RealmWatchpoint::ArrayPrototypeChainIsSane` holds for its prototypes.
    #[inline(always)]
    pub(super) fn inherits_as_arrays_do(&self) -> bool {
        let shape = self.shape();
        self.cell_type() == CellType::Array
            && shape.global().is_some_and(|global| {
                shape.prototype() == global.array_prototype().into()
                    && global.array_prototype_chain_is_sane()
            })
    }

    #[inline(never)]
    fn holes_must_forward_to_prototype_slow(&self) -> bool {
        let flags = self.shape().type_flags();
        flags.intersects(TypeFlags::INTERCEPTS_INDEXED_ACCESS | TypeFlags::OVERRIDES_GET_PROTOTYPE)
            || self.chain_direct().skip(1).any(|prototype| {
                prototype.indexing_mode().has_elements()
                    || prototype.overrides_get_prototype()
                    || prototype.shape().may_intercept_indexed_access()
            })
    }

    /// Whether an index is the key of no property, own or inherited, unless the dense elements have it. False if that has
    /// not been looked into lately.
    #[inline(always)]
    pub fn is_known_to_have_only_own_elements(&self, vm: &Vm) -> bool {
        self.shape().own_elements_epoch.get() == vm.full_prototype_chain_epoch()
    }

    /// The same, for sure.
    #[inline(always)]
    pub fn has_only_own_elements(&self, vm: &Vm) -> bool {
        self.is_known_to_have_only_own_elements(vm) || self.has_only_own_elements_slow(vm)
    }

    /// Whether no prototype has a property whose key is an index.
    #[inline]
    pub(crate) fn inherits_no_elements(&self, vm: &Vm) -> bool {
        !self.overrides_get_prototype()
            && self.prototype_object_direct().is_none_or(|first| {
                !first.indexing_mode().has_elements() && first.has_only_own_elements(vm)
            })
    }

    #[inline(never)]
    fn has_only_own_elements_slow(&self, vm: &Vm) -> bool {
        let holds = self.element_kind() != ElementKind::Sparse
            && !self.holes_must_forward_to_prototype_slow()
            && (self.chain_direct()).all(|it| it.class().has_ordinary_lookup_by_index());
        if holds {
            (self.shape().own_elements_epoch).set(vm.full_prototype_chain_epoch());
        }
        holds
    }

    /// The elements in the range, if they are dense and below the public length, and a hole among them means that
    /// there is no such property along the prototype chain either.
    #[inline(always)]
    pub fn plain_elements<'a>(
        &'a self,
        no_gc: &'a NoGc<'_>,
        range: Range<u64>,
    ) -> Option<Elements<'a>> {
        let elements = self.elements(no_gc)?;
        if range.start > range.end || range.end > elements.len() as u64 {
            return None;
        }
        let elements = elements.slice(range.start as usize..range.end as usize);
        (!self.holes_must_forward_to_prototype() || !elements.has_holes()).then_some(elements)
    }

    /// For a loop that has met a hole: where to go on, which is past the indices at the start of the range that
    /// neither the object nor a prototype has, if that is worth finding out.
    pub fn skip_holes(&self, range: Range<u64>) -> u64 {
        /// Looking at an entry is that much cheaper than a turn of the loop.
        const ENTRIES_PER_TURN: u64 = 8;
        let turns = range.end.saturating_sub(range.start);
        if turns < ENTRIES_PER_TURN || range.end > u64::from(u32::MAX) {
            return range.start;
        }
        let (start, sparse) = (range.start as u32, self.sparse_elements());
        let is_worth_it = match sparse.map(|it| it.len() as u64) {
            Some(count) => count * count < turns * ENTRIES_PER_TURN,
            None => start >= self.public_length() || self.element_kind() == ElementKind::Undecided,
        };
        if !is_worth_it || self.holes_must_forward_to_prototype() {
            return range.start;
        }
        let next = sparse.and_then(|it| it.first_index_from(start));
        next.map_or(range.end, |next| range.end.min(next.into()))
    }

    /// The first index from `start` on that has an element.
    pub fn next_element_index(&self, start: u32) -> Option<u32> {
        match self.sparse_elements() {
            Some(sparse) => sparse.first_index_from(start),
            None if self.element_kind().is_dense() => {
                (start..self.public_length()).find(|&index| self.try_get_dense(index).is_some())
            }
            None => None,
        }
    }

    fn dense_attributes(&self) -> Attributes {
        if !self.indexing_mode().is_slow_put() {
            return Attributes::NONE;
        }
        let (shape, mut attributes) = (self.shape(), Attributes::NONE);
        attributes.set(
            Attributes::DONT_DELETE,
            shape.has(ShapeFlags::ELEMENTS_ARE_SEALED),
        );
        attributes.set(
            Attributes::READ_ONLY,
            shape.has(ShapeFlags::ELEMENTS_ARE_FROZEN),
        );
        attributes
    }

    pub(super) fn own_element(&self, index: u32) -> Option<SparseEntry> {
        match self.try_get_dense(index) {
            Some(value) => Some(SparseEntry {
                value,
                attributes: self.dense_attributes(),
            }),
            None => self.sparse_elements()?.get(index),
        }
    }

    pub(crate) fn count_dense_elements(&self) -> usize {
        // SAFETY: only reads.
        match unsafe { self.elements_unchecked() } {
            Some(Elements::Int32(values) | Elements::Contiguous(values)) => {
                values.iter().filter(|value| value.is_some()).count()
            }
            Some(Elements::Double(values)) => values.iter().filter(|it| !it.is_nan()).count(),
            None => 0,
        }
    }

    /// Ends the process if there is no memory.
    #[inline(always)]
    pub fn ensure_writable_elements(&self, vm: &Vm) {
        self.try_ensure_writable_elements(vm)
            .unwrap_or_else(|_| bun_alloc::out_of_memory());
    }

    #[inline(always)]
    pub fn try_ensure_writable_elements(&self, vm: &Vm) -> Result<(), AllocError> {
        if self.indexing_mode().is_copy_on_write() {
            return self.copy_shared_elements(vm, self.public_length());
        }
        Ok(())
    }

    /// Makes room for `needed` elements, and keeps no more than that.
    #[inline(never)]
    pub(super) fn copy_shared_elements(&self, vm: &Vm, needed: u32) -> Result<(), AllocError> {
        let (kind, length) = (self.element_kind(), self.public_length().min(needed));
        let mut vector_length = Storage::optimal_vector_length(0, length);
        if vector_length < needed {
            vector_length = grown_vector_length(0, length, needed);
        }
        let storage = Storage::try_allocate(vm, 0, 0, Some(vector_length))?;
        let mut deferred = DeferredFire::new(vm);
        let transition = TransitionKind::allocate(kind);
        let shape = self.shape();
        let shape = shape.non_property_transition(vm, transition, &mut deferred);
        // SAFETY: an object that shares its elements has no out-of-line slots.
        unsafe {
            self.storage().copy_words_to(storage, 0, length as usize);
            storage.set_lengths(length, vector_length);
            storage.clear_elements(kind, length, vector_length);
            self.set_shape_and_storage(&shape, storage, false);
        }
        Ok(())
    }

    /// Replaces the elements by `vector_length` holes of another kind, and has `fill` store into them.
    fn replace_elements(
        &self,
        vm: &Vm,
        kind: ElementKind,
        public_length: u32,
        vector_length: u32,
        fill: impl FnOnce(Storage),
    ) -> Result<(), AllocError> {
        if !self.cell_type().has_storage() {
            return Err(AllocError);
        }
        if kind.is_dense()
            && !self.indexing_mode().is_slow_put()
            && (self.chain_may_intercept_indexed_access() || !self.shape().is_extensible())
        {
            self.non_property_transition(vm, TransitionKind::SwitchToSlowPut);
        }
        // First, because there is no way back from a transition.
        let capacity = self.shape().out_of_line_capacity();
        let storage = Storage::try_create(vm, capacity, kind, 0, vector_length.max(1))?;
        let mut deferred = DeferredFire::new(vm);
        let transition = TransitionKind::allocate(kind);
        let shape = self.shape();
        let shape = shape.non_property_transition(vm, transition, &mut deferred);
        // SAFETY: new and of that size.
        unsafe {
            if capacity != 0 {
                self.storage()
                    .copy_words_to(storage, -1 - capacity as isize, capacity);
            }
            storage.set_lengths(public_length, vector_length);
            fill(storage);
            self.set_shape_and_storage(&shape, storage, false);
        }
        self.did_change_as_prototype(vm, &shape);
        Ok(())
    }

    pub fn convert_to_sparse(&self, vm: &Vm) -> Result<Gc<SparseElements>, AllocError> {
        if let Some(sparse) = self.sparse_elements() {
            return Ok(sparse);
        }
        let sparse = SparseElements::create(vm);
        sparse.try_reserve(self.count_dense_elements())?;
        let (length, attributes) = (self.public_length(), self.dense_attributes());
        for index in 0..length {
            if let Some(value) = self.try_get_dense(index) {
                sparse.insert(index, value, attributes);
            }
        }
        if attributes.contains(Attributes::READ_ONLY) {
            self.notify_presence_of_indexed_accessors(vm);
        }
        // SAFETY: there is one word, and the barrier comes with the shape.
        self.replace_elements(vm, ElementKind::Sparse, length, 0, |storage| unsafe {
            storage.value_at(0).set_without_barrier(Some(sparse.into()));
        })?;
        Ok(sparse)
    }

    fn convert_sparse_to_dense(
        &self,
        vm: &Vm,
        sparse: &SparseElements,
        length: u32,
    ) -> Result<(), AllocError> {
        let capacity = self.shape().out_of_line_capacity();
        let vector_length = Storage::optimal_vector_length(capacity, length);
        let mut kind = ElementKind::Undecided;
        sparse.for_each(|_, entry| kind = kind.max(ElementKind::for_value(entry.value)));
        self.replace_elements(vm, kind, length, vector_length, |storage| {
            sparse.for_each(|index, entry| {
                assert!(index < length);
                // SAFETY: inside, the kind can represent the value, and the barrier comes with the shape.
                unsafe { store_unchecked(storage, kind, index, entry.value) };
            });
        })
    }

    /// The elements are dense, writable and of a kind that is less general than `to`.
    #[inline(never)]
    fn generalize_elements(&self, vm: &Vm, to: ElementKind) {
        let from = self.element_kind();
        debug_assert!(from.is_dense() && from < to && to.is_dense());
        let mut deferred = DeferredFire::new(vm);
        let transition = TransitionKind::allocate(to);
        let shape = self.shape();
        let shape = shape.non_property_transition(vm, transition, &mut deferred);
        let storage = self.storage();
        // SAFETY: each word is read as the old kind and written as the new. A marker looks at neither.
        unsafe {
            let length = storage.vector_length();
            let words = core::slice::from_raw_parts_mut(storage.elements_ptr(), length as usize);
            if to == ElementKind::Double {
                for word in words {
                    *word = match *word {
                        0 => Value::PURE_NAN_BITS,
                        int32 => f64::from(int32 as i32).to_bits(),
                    };
                }
            } else if from == ElementKind::Double {
                for word in words {
                    let number = f64::from_bits(*word);
                    *word = Value::bits_of((!number.is_nan()).then(|| Value::double(number)));
                }
            }
            self.set_shape(&shape);
        }
    }

    /// Makes dense elements writable and able to represent what `kind` can.
    #[inline]
    pub fn ensure_element_kind(&self, vm: &Vm, kind: ElementKind) -> Result<(), AllocError> {
        assert!(self.element_kind().is_dense() && kind.is_dense());
        self.try_ensure_writable_elements(vm)?;
        if self.element_kind() < kind {
            self.generalize_elements(vm, kind);
        }
        Ok(())
    }

    /// The unused words in front of the slots.
    #[inline(always)]
    pub(super) fn pre_capacity(&self, capacity: usize) -> usize {
        if self.inline_flags().contains(TypeFlags::HAS_PRE_CAPACITY) {
            // SAFETY: the flag says that there is a count.
            unsafe { self.storage().pre_capacity(capacity) }
        } else {
            0
        }
    }

    /// The elements are dense and writable, and there is no room for `needed`.
    #[inline(never)]
    fn grow_vector(&self, vm: &Vm, needed: u32) -> Result<(), AllocError> {
        let (kind, capacity) = (self.element_kind(), self.shape().out_of_line_capacity());
        let (used, old_length) = (self.public_length(), self.vector_length());
        let vector_length = grown_vector_length(capacity, old_length, needed);
        let (pre_capacity, header) = (self.pre_capacity(capacity), -1 - capacity as isize);
        // SAFETY: each has the slots and the elements, and then holes.
        unsafe {
            let old = self.storage();
            let available = pre_capacity + old_length as usize;
            // A queue goes on in the memory that it has, unless that is much more than it needs.
            if (needed as usize * 5 / 4..=vector_length as usize * 4).contains(&available)
                && pre_capacity != 0
                && available <= Storage::MAX_VECTOR_LENGTH as usize
                && !self.may_be_read_by_marker()
            {
                let moved = old.shift_header(capacity, -(pre_capacity as isize));
                moved.move_elements(pre_capacity as u32, 0, used);
                moved.set_lengths(used, available as u32);
                moved.clear_elements(kind, used, available as u32);
                self.set_moved_storage(moved, false);
                return Ok(());
            }
            let grown = (pre_capacity == 0).then(|| old.try_grow(vm, capacity, vector_length));
            let (storage, initialized) = match grown.flatten() {
                Some(storage) => (storage, old_length),
                None => {
                    let storage = Storage::try_allocate(vm, 0, capacity, Some(vector_length))?;
                    old.copy_words_to(storage, header, capacity + 1 + used as usize);
                    (storage, used)
                }
            };
            storage.set_lengths(used, vector_length);
            storage.clear_elements(kind, initialized, vector_length);
            self.set_storage(storage);
        }
        Ok(())
    }

    /// Makes the elements writable, with room for `needed`. Panics unless they are dense.
    #[inline]
    pub fn reserve_elements(&self, vm: &Vm, needed: u32) -> Result<(), AllocError> {
        let mode = self.indexing_mode();
        assert!(mode.kind().is_dense());
        if needed > Storage::MAX_VECTOR_LENGTH {
            return Err(AllocError);
        }
        if mode.is_copy_on_write() {
            return self.copy_shared_elements(vm, needed.max(self.public_length()));
        }
        if needed > self.vector_length() {
            return self.grow_vector(vm, needed);
        }
        Ok(())
    }

    /// Raises the public length. Panics unless the elements are dense.
    #[inline]
    pub(crate) fn ensure_public_length(&self, vm: &Vm, length: u32) -> Result<(), AllocError> {
        self.reserve_elements(vm, length)?;
        if length > self.public_length() {
            // SAFETY: inside the vector.
            unsafe { self.storage().set_public_length(length) };
        }
        Ok(())
    }

    #[inline]
    fn stays_dense_with(&self, index: u32) -> bool {
        let vector_length = self.vector_length();
        index < vector_length
            || (index < Storage::MAX_VECTOR_LENGTH
                && (index < MIN_SPARSE_DISTANCE
                    || (index / 2 <= vector_length
                        && (index == self.public_length()
                            || is_dense_enough(index, self.count_dense_elements())))))
    }

    /// The address of the storage, if that can be made to have the index. Panics unless the elements are dense.
    pub fn try_make_room_for_element(&self, vm: &Vm, index: u32) -> Option<usize> {
        let has_room = self.stays_dense_with(index) && self.reserve_elements(vm, index + 1).is_ok();
        has_room.then(|| self.storage().address())
    }

    /// Adds or replaces a plain data element, whatever the attributes or prototypes say, if there is storage.
    #[inline(never)]
    pub fn store_element(&self, vm: &Vm, index: u32, value: Value) -> Result<(), AllocError> {
        if !self.cell_type().has_storage() {
            return Ok(());
        }
        let needed = ElementKind::for_value(value);
        let stays_dense = self.stays_dense_with(index);
        match self.element_kind() {
            ElementKind::None if stays_dense => {
                let capacity = self.shape().out_of_line_capacity();
                let vector_length = Storage::optimal_vector_length(capacity, index + 1);
                self.replace_elements(vm, needed, 0, vector_length, |_| {})?;
            }
            kind if kind.is_dense() && stays_dense => {}
            _ => return self.store_sparse(vm, index, value, Attributes::NONE),
        }
        self.reserve_elements(vm, index + 1)?;
        self.ensure_element_kind(vm, needed)?;
        self.ensure_public_length(vm, index + 1)?;
        // SAFETY: inside, and the kind can represent the value.
        unsafe { store_unchecked(self.storage(), self.element_kind(), index, value) };
        self.write_barrier(value);
        Ok(())
    }

    fn store_sparse(
        &self,
        vm: &Vm,
        index: u32,
        value: Value,
        attributes: Attributes,
    ) -> Result<(), AllocError> {
        let sparse = self.convert_to_sparse(vm)?;
        if attributes.intersects(Attributes::READ_ONLY | Attributes::ACCESSOR) {
            self.notify_presence_of_indexed_accessors(vm);
        }
        sparse.try_reserve(1)?;
        sparse.insert(index, value, attributes);
        let length = self.public_length().max(index + 1);
        // SAFETY: not dense.
        unsafe { self.storage().set_public_length(length) };
        self.convert_to_dense_if_worthwhile(vm, &sparse);
        Ok(())
    }

    /// For code that is about to look at many elements.
    #[inline(always)]
    pub fn prefer_dense_elements(&self, vm: &Vm) {
        if let Some(sparse) = self.sparse_elements() {
            self.convert_to_dense_if_worthwhile(vm, &sparse);
        }
    }

    #[inline(always)]
    pub(super) fn convert_to_dense_if_worthwhile(&self, vm: &Vm, sparse: &SparseElements) {
        if (self.public_length() / MIN_DENSITY_WHILE_FILLING) as usize <= sparse.len() {
            self.consider_converting_to_dense(vm, sparse);
        }
    }

    #[inline(never)]
    fn consider_converting_to_dense(&self, vm: &Vm, sparse: &SparseElements) {
        let (length, count) = (self.public_length(), sparse.len());
        let restricted = ShapeFlags::ELEMENTS_ARE_SEALED | ShapeFlags::MAY_HAVE_INDEXED_ACCESSORS;
        if (is_dense_enough(length, count)
            || (count >= MIN_SPARSE_DISTANCE as usize / MIN_DENSITY as usize
                && sparse.is_being_filled(length)))
            && length <= Storage::MAX_VECTOR_LENGTH
            && sparse.has_only_plain_entries()
            && !self.shape().has(restricted)
        {
            // It can stay sparse if there is no memory.
            let _ = self.convert_sparse_to_dense(vm, sparse, length);
        }
    }

    pub(crate) fn notify_presence_of_indexed_accessors(&self, vm: &Vm) {
        if let Some(global) = self.downcast::<GlobalObject>() {
            global
                .global_this()
                .notify_presence_of_indexed_accessors(vm);
        }
        if !self.shape().may_intercept_indexed_access() {
            self.intercept_indexed_access_of_heirs(vm);
        }
    }

    #[inline]
    pub fn ordinary_get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if index == u32::MAX {
            return self.get_own_property_slot(cx, Identifier::from_index(index).name(), slot);
        }
        let Some(SparseEntry { value, attributes }) = self.own_element(index) else {
            return Ok(false);
        };
        if attributes.contains(Attributes::ACCESSOR) {
            slot.set_getter(self, attributes, &value.cast::<GetterSetter>());
        } else {
            slot.set_value(self, attributes, value);
        }
        Ok(true)
    }

    pub(super) fn length_forbids(&self, index: u32) -> bool {
        self.indexing_mode().is_array()
            && index >= self.public_length()
            && self.shape().has(ShapeFlags::LENGTH_IS_READ_ONLY)
    }

    pub fn ordinary_put_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<bool> {
        if self.try_set_dense(cx, index, value) {
            return Ok(true);
        }
        if index == u32::MAX {
            let name = Identifier::from_index(index);
            return self.set(cx, name.name(), value, should_throw);
        }
        let mode = self.indexing_mode();
        if mode.is_slow_put() || !mode.kind().is_dense() {
            if let Some(entry) = self.own_element(index) {
                if entry.attributes.contains(Attributes::ACCESSOR) {
                    let accessor = entry.value.cast::<GetterSetter>();
                    return accessor.call_setter(cx, self.as_value(), value, should_throw);
                }
                if !entry.attributes.is_writable() {
                    return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
                }
                if let Some(sparse) = self.sparse_elements() {
                    sparse.insert(index, value, entry.attributes);
                    self.convert_to_dense_if_worthwhile(cx, &sparse);
                    return Ok(true);
                }
            } else {
                if let Some(result) = self.intercept_put_on_hole(cx, index, value, should_throw)? {
                    return Ok(result);
                }
                if !self.shape().is_extensible() || self.length_forbids(index) {
                    return cx.reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE);
                }
            }
        }
        self.store_element(cx, index, value)
            .map_err(|_| cx.throw_out_of_memory())?;
        Ok(true)
    }

    /// `Some` if a prototype has dealt with the store. No script has run otherwise.
    fn intercept_put_on_hole(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        should_throw: bool,
    ) -> JsResult<Option<bool>> {
        if self.overrides_get_prototype() {
            return Ok(None);
        }
        let this = self.as_value();
        let next = |object: &Gc<JsObject>| match object.downcast::<GlobalProxy>() {
            Some(proxy) => proxy.target().prototype_object_direct(),
            None => object.prototype_object_direct(),
        };
        for prototype in core::iter::successors(self.prototype_object_direct(), next) {
            if !prototype.shape().may_intercept_indexed_access()
                && !prototype.indexing_mode().has_elements()
            {
                continue;
            }
            if let Some(proxy) = prototype.downcast::<ProxyObject>() {
                return proxy
                    .put_index_with_receiver(cx, this, index, value, should_throw)
                    .map(Some);
            }
            if prototype.cell_type() == CellType::ModuleNamespaceObject {
                let mut slot = PutPropertySlot::new(this, should_throw);
                let name = Identifier::from_index(index);
                return prototype.put(cx, name.name(), value, &mut slot).map(Some);
            }
            if CellType::TYPED_ARRAYS.contains(prototype.cell_type()) {
                let length = prototype.cast::<JsArrayBufferView>().length();
                return Ok((index as usize >= length).then_some(true));
            }
            let mut slot = PropertySlot::new(this, crate::InternalMethod::Inquiry);
            if !prototype.get_own_property_slot_by_index(cx, index, &mut slot)? {
                continue;
            }
            if let Some(accessor) = slot.getter_setter() {
                return accessor
                    .call_setter(cx, this, value, should_throw)
                    .map(Some);
            }
            if !slot.attributes().is_writable() {
                return cx
                    .reject(should_throw, errors::READ_ONLY_PROPERTY_WRITE)
                    .map(Some);
            }
            return Ok(None);
        }
        Ok(None)
    }

    /// Defines an own data property with default attributes.
    #[inline(always)]
    pub fn put_direct_index(&self, cx: &mut Cx, index: u32, value: Value) -> JsResult<bool> {
        let mode = PutDirectIndexMode::LikePutDirect;
        self.put_direct_index_with(cx, index, value, Attributes::NONE, mode)
    }

    #[inline(always)]
    pub fn put_direct_index_with(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        attributes: Attributes,
        mode: PutDirectIndexMode,
    ) -> JsResult<bool> {
        if attributes.is_empty() && self.try_set_dense(cx, index, value) {
            return Ok(true);
        }
        self.put_direct_index_slow(cx, index, value, attributes, mode)
    }

    fn has_ordinary_elements(&self) -> bool {
        matches!(
            self.cell_type(),
            CellType::Array | CellType::DerivedArray | CellType::FinalObject
        ) || self.class().has_ordinary_define_own_property()
    }

    #[inline(never)]
    fn put_direct_index_slow(
        &self,
        cx: &mut Cx,
        index: u32,
        value: Value,
        attributes: Attributes,
        mode: PutDirectIndexMode,
    ) -> JsResult<bool> {
        let should_throw = mode == PutDirectIndexMode::ShouldThrow;
        if index == u32::MAX || !self.has_ordinary_elements() {
            let name = Identifier::from_index(index);
            let descriptor = PropertyDescriptor::stored(value, attributes);
            return self.define_own_property(cx, name.name(), &descriptor, should_throw);
        }
        let indexing_mode = self.indexing_mode();
        if attributes.is_empty()
            && indexing_mode.kind() != ElementKind::Sparse
            && !self
                .shape()
                .has(ShapeFlags::DID_PREVENT_EXTENSIONS | ShapeFlags::LENGTH_IS_READ_ONLY)
        {
            self.store_element(cx, index, value)
                .map_err(|_| cx.throw_out_of_memory())?;
            return Ok(true);
        }
        let descriptor = PropertyDescriptor::stored(value, attributes);
        let is_extensible =
            mode == PutDirectIndexMode::LikePutDirect || self.shape().is_extensible();
        self.define_element(cx, index, &descriptor, is_extensible, should_throw)
    }

    pub fn define_own_indexed_property(
        &self,
        cx: &mut Cx,
        index: u32,
        descriptor: &PropertyDescriptor,
        should_throw: bool,
    ) -> JsResult<bool> {
        let is_extensible = self.shape().is_extensible();
        self.define_element(cx, index, descriptor, is_extensible, should_throw)
    }

    fn define_element(
        &self,
        cx: &mut Cx,
        index: u32,
        descriptor: &PropertyDescriptor,
        is_extensible: bool,
        should_throw: bool,
    ) -> JsResult<bool> {
        if self.length_forbids(index) {
            return cx.reject(should_throw, errors::DEFINE_BEYOND_READ_ONLY_LENGTH);
        }
        let current = self.own_element(index).map(SparseEntry::descriptor);
        let current = current.as_ref();
        if !super::validate_property_descriptor(
            cx,
            is_extensible,
            descriptor,
            current,
            should_throw,
        )? {
            return Ok(false);
        }
        if let Some(current) = current
            && descriptor.changes_nothing(cx, current)?
        {
            return Ok(true);
        }
        let (value, attributes) = descriptor.apply_to(cx, current);
        let stored = if self.element_kind() != ElementKind::Sparse
            && attributes == self.dense_attributes()
        {
            self.store_element(cx, index, value)
        } else {
            self.store_sparse(cx, index, value, attributes)
        };
        stored.map_err(|_| cx.throw_out_of_memory())?;
        Ok(true)
    }

    pub fn ordinary_delete_property_by_index(&self, cx: &mut Cx, index: u32) -> JsResult<bool> {
        if index == u32::MAX {
            return self.delete(cx, Identifier::from_index(index).name());
        }
        let Some(entry) = self.own_element(index) else {
            return Ok(true);
        };
        if !entry.attributes.is_configurable() {
            return Ok(false);
        }
        if let Some(sparse) = self.sparse_elements() {
            sparse.remove(index);
        } else {
            cx.or_out_of_memory(self.try_ensure_writable_elements(cx))?;
            // SAFETY: there is an element at that index.
            unsafe {
                self.storage()
                    .clear_elements(self.element_kind(), index, index + 1);
            }
        }
        Ok(true)
    }

    pub fn own_indexed_property_names(&self, list: &mut PropertyNameList, mode: DontEnumMode) {
        if !self.indexing_mode().has_elements() || !list.includes_strings() {
            return;
        }
        match self.sparse_elements() {
            Some(sparse) => match sparse.try_sorted_indices(0..u32::MAX, mode) {
                Ok(indices) => list.add_indices(indices.len(), indices.into_iter()),
                Err(AllocError) => list.did_overflow(),
            },
            None => list.add_indices(
                self.count_dense_elements(),
                (0..self.public_length()).filter(|&index| self.try_get_dense(index).is_some()),
            ),
        }
    }
}

/// At least `needed`, which is at most the limit.
pub(super) fn grown_vector_length(capacity: usize, old: u32, needed: u32) -> u32 {
    let amortized = (old + old / 2 + 4).min(Storage::MAX_VECTOR_LENGTH);
    Storage::optimal_vector_length(capacity, needed.max(amortized))
}

/// # Safety
/// Below the vector length, `kind` is that of the storage and can represent the value, and the barrier follows.
#[inline(always)]
pub(super) unsafe fn store_unchecked(
    storage: Storage,
    kind: ElementKind,
    index: u32,
    value: Value,
) {
    // SAFETY: the caller's.
    unsafe {
        if kind == ElementKind::Double {
            let number = value.as_number().unwrap_or(f64::NAN);
            storage.double_at(index).set(number);
        } else {
            storage.value_at(index).set_without_barrier(Some(value));
        }
    }
}
