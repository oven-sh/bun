//! `for`-`in`

use core::cell::Cell;
use core::mem::offset_of;

use bun_engine_macros::{cell, native_abi};
use bun_engine_text::{Identifier, PropertyName};

use crate::code::metadata;
use crate::{
    CellType, Cx, DontEnumMode, FastHashSet, Gc, ImmutableArray, JsArrayBufferView, JsCell,
    JsObject, JsResult, JsString, MappedArguments, PropertyNameList, PropertyNameMode,
    PropertyOffset, Shape, ShapeFlags, ShapeId, Step, StringObject, TypeFlags, Value, Visitor, Vm,
    caches, root_vec,
};

/// What the index of a loop is. Each is a bit, so that a profile can collect them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EnumerationMode {
    /// The key itself.
    Indexed = 1,
    /// That of a name, and the number of its slot in an object with the shape of the enumerator.
    OwnShape = 2,
    /// That of a name.
    Generic = 4,
}

/// The keys that a loop goes through: the indices below `indexed_length`, and then the names. It does not change.
#[cell(name = "JSPropertyNameEnumerator", cell_type = PropertyNameEnumerator, visit_children,
    flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub struct PropertyNameEnumerator {
    base: JsCell,
    /// Strings that are atoms.
    names: Gc<ImmutableArray>,
    subject_shape: ShapeId,
    indexed_length: u32,
    /// How many names, from the first, have `OwnShape` for their mode.
    own_shape_count: u32,
    /// How many are those of enumerable properties that any object with the shape has.
    own_count: u32,
    name_count: u32,
    inline_capacity: u32,
    /// None of the others is hidden by a property that is not enumerable.
    has_only_visible_names: bool,
    /// The properties in the shape take any value, without any code having a say.
    is_writable: bool,
    /// The shapes of the prototypes, if the names follow from them and the shape of the subject.
    chain: Option<Gc<ImmutableArray>>,
}

/// In `ShapeRareData::enumerator_epoch`: an instance may have indices, which the enumerator does not count.
const LACKS_INDICES: u64 = 1 << 63;

impl PropertyNameEnumerator {
    pub const OFFSET_OF_NAMES: usize = offset_of!(Self, names);
    pub const OFFSET_OF_SUBJECT_SHAPE: usize = offset_of!(Self, subject_shape);
    pub const OFFSET_OF_INDEXED_LENGTH: usize = offset_of!(Self, indexed_length);
    pub const OFFSET_OF_OWN_SHAPE_COUNT: usize = offset_of!(Self, own_shape_count);
    pub const OFFSET_OF_OWN_COUNT: usize = offset_of!(Self, own_count);
    pub const OFFSET_OF_NAME_COUNT: usize = offset_of!(Self, name_count);
    pub const OFFSET_OF_INLINE_CAPACITY: usize = offset_of!(Self, inline_capacity);
    pub const OFFSET_OF_IS_WRITABLE: usize = offset_of!(Self, is_writable);

    #[inline(always)]
    pub fn subject_shape(&self) -> ShapeId {
        self.subject_shape
    }

    #[inline(always)]
    pub fn indexed_length(&self) -> u32 {
        self.indexed_length
    }

    #[inline(always)]
    pub fn own_shape_count(&self) -> u32 {
        self.own_shape_count
    }

    #[inline(always)]
    pub fn names(&self) -> Gc<ImmutableArray> {
        self.names
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.indexed_length | self.name_count == 0
    }

    /// # Safety
    /// There are that many.
    #[inline(always)]
    unsafe fn name_unchecked(&self, index: u32) -> Gc<JsString> {
        // SAFETY: the caller's, and only strings are in there.
        unsafe {
            let name = self.names.storage().value_at(index).get();
            Gc::from_address(Value::bits_of(name) as usize)
        }
    }

    /// If it is known to be right for the object.
    #[inline(always)]
    pub fn current_for(vm: &Vm, object: &JsObject) -> Option<Gc<PropertyNameEnumerator>> {
        let shape = object.shape();
        let rare_data = shape.rare_data()?;
        (rare_data.enumerator_epoch.get() == vm.full_prototype_chain_epoch())
            .then(|| rare_data.enumerator.get())?
    }

    #[inline(always)]
    pub fn for_object(cx: &mut Cx, object: &JsObject) -> JsResult<Gc<PropertyNameEnumerator>> {
        match Self::current_for(cx, object) {
            Some(enumerator) => Ok(enumerator),
            None => Self::for_object_slow(cx, object),
        }
    }

    #[inline(never)]
    fn for_object_slow(cx: &mut Cx, object: &JsObject) -> JsResult<Gc<PropertyNameEnumerator>> {
        let indexed_length = gapless_index_count(object);
        let cached = indexed_length.and_then(|_| Self::cached_for(cx, &object.shape()));
        let of_names = match cached {
            Some(cached) => cached,
            None => Self::create(cx, object, indexed_length)?,
        };
        Ok(match indexed_length {
            Some(length @ 1..) => of_names.with_indexed_length(cx, length),
            _ => of_names,
        })
    }

    fn cached_for(vm: &Vm, shape: &Shape) -> Option<Gc<PropertyNameEnumerator>> {
        let rare_data = shape.rare_data()?;
        let (enumerator, epoch) = (rare_data.enumerator.get()?, &rare_data.enumerator_epoch);
        let current = vm.full_prototype_chain_epoch() | epoch.get() & LACKS_INDICES;
        if epoch.get() != current {
            let chain = shape.prototype_object().map(|first| first.chain_direct());
            let shapes = chain
                .into_iter()
                .flatten()
                .map(|it| Value::from(it.shape()));
            if !shapes.eq(enumerator.chain?.iter()) {
                return None;
            }
            epoch.set(current);
        }
        Some(enumerator)
    }

    /// Of all but the first `indexed_length` indices.
    fn create(
        cx: &mut Cx,
        object: &JsObject,
        indexed_length: Option<u32>,
    ) -> JsResult<Gc<PropertyNameEnumerator>> {
        let shape = object.shape();
        let (kinds, mode) = (PropertyNameMode::Strings, mode_for(object));
        let own = match indexed_length {
            Some(_) => object.snapshot_own_non_index_keys(cx, kinds, mode)?,
            None => object.snapshot_own_keys(cx, kinds, mode)?,
        };
        let own_count = own.count();
        let own_shape_count = if indexed_length.is_some()
            && names_are_in_slot_order(object)
            && own_count == shape.slot_count()
        {
            own_count as u32
        } else {
            0
        };
        let mut inherited = inherited_names(cx, object)?.into_vec();
        if !inherited.is_empty() {
            let (own, length): (FastHashSet<_>, _) =
                (own.iter().collect(), indexed_length.unwrap_or(0));
            inherited.retain(|name| {
                !own.contains(&name.name()) && name.name().as_index().is_none_or(|it| it >= length)
            });
        }
        let all = (own.iter().chain(inherited.iter().map(Identifier::name)))
            .map(|name| JsString::from_name(cx, name).into());
        let names = ImmutableArray::try_from_iter(cx, own_count + inherited.len(), all);
        let names = cx.or_out_of_memory(names)?;
        let is_same = object.shape() == shape;
        let chain = (is_same && indexed_length.is_some())
            .then(|| cacheable_chain(cx, &shape))
            .flatten();
        let has_names_of_shape = is_same
            && indexed_length.is_some()
            && shape.property_accesses_are_cacheable()
            && has_names_in_shape(object);
        let has_only_visible_names = has_names_of_shape
            && chain.is_some()
            && inherited.iter().all(|name| is_visible(object, name.name()));
        let enumerator = cx.allocate::<PropertyNameEnumerator>(PropertyNameEnumeratorInit {
            base: cx.shapes.property_name_enumerator(),
            names,
            subject_shape: shape.id(),
            indexed_length: 0,
            own_shape_count: if is_same { own_shape_count } else { 0 },
            own_count: if has_names_of_shape {
                own_count as u32
            } else {
                0
            },
            has_only_visible_names,
            name_count: names.len(),
            inline_capacity: shape.inline_capacity() as u32,
            is_writable: !shape.has(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO)
                && (!shape.type_flags().contains(TypeFlags::OVERRIDES_PUT)
                    || shape.instance_type() == CellType::Array),
            chain,
        });
        if chain.is_some() {
            let rare_data = shape.ensure_rare_data();
            let flag = if has_indices(&shape) {
                LACKS_INDICES
            } else {
                0
            };
            // SAFETY: the shape traces its rare data.
            unsafe { rare_data.enumerator.set(&shape, Some(enumerator)) };
            (rare_data.enumerator_epoch).set(cx.full_prototype_chain_epoch() | flag);
        }
        Ok(enumerator)
    }

    fn with_indexed_length(&self, vm: &Vm, indexed_length: u32) -> Gc<PropertyNameEnumerator> {
        vm.allocate::<PropertyNameEnumerator>(PropertyNameEnumeratorInit {
            base: vm.shapes.property_name_enumerator(),
            names: self.names,
            subject_shape: self.subject_shape,
            indexed_length,
            own_shape_count: self.own_shape_count,
            own_count: self.own_count,
            has_only_visible_names: self.has_only_visible_names,
            name_count: self.name_count,
            inline_capacity: self.inline_capacity,
            is_writable: self.is_writable,
            chain: None,
        })
    }

    /// Whether the name at the index is known to be that of an enumerable property.
    #[inline(always)]
    fn is_still_visible(&self, vm: &Vm, object: &JsCell, index: u32) -> bool {
        object.shape_id() == self.subject_shape
            && (index < self.own_count
                || (self.has_only_visible_names
                    && object.shape().rare_data().is_some_and(|rare_data| {
                        let epoch = rare_data.enumerator_epoch.get() & !LACKS_INDICES;
                        epoch == vm.full_prototype_chain_epoch()
                            && (rare_data.enumerator.get()).is_some_and(|it| it.names == self.names)
                    })))
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.append_shape(self.subject_shape);
    }
}

fn has_indices(shape: &Shape) -> bool {
    shape.instance_indexing_mode().has_elements() || shape.may_intercept_indexed_access()
}

fn overrides_names(shape: &Shape) -> bool {
    (shape.type_flags()).contains(TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES)
}

/// `Some(n)` if the own keys are the indices below `n`, all enumerable, and those of `own_non_index_property_names`.
fn gapless_index_count(object: &JsObject) -> Option<u32> {
    if !overrides_names(&object.shape()) {
        // SAFETY: only reads.
        let elements = unsafe { object.elements_unchecked() }?;
        return (!elements.has_holes()).then_some(elements.len() as u32);
    }
    if object.indexing_mode().has_elements() {
        return None;
    }
    if CellType::TYPED_ARRAYS.contains(object.cell_type()) {
        let length = object.as_object().cast::<JsArrayBufferView>().length();
        return i32::try_from(length).ok().map(|length| length as u32);
    }
    match object.downcast::<StringObject>() {
        Some(wrapper) => Some(wrapper.string().len()),
        None => Some(object.downcast::<MappedArguments>()?.plain_length()),
    }
}

/// Whether the shapes along the chain say that a lookup finds an enumerable property.
fn is_visible(object: &JsObject, name: PropertyName<'_>) -> bool {
    for object in object.chain_direct() {
        let shape = object.shape();
        if !caches::is_looked_up_in_shape(&object, name) {
            return false;
        }
        if let Some((_, attributes)) = shape.get(name) {
            return attributes.is_enumerable();
        }
        if shape.has_non_reified_static_properties() && shape.find_static_property(name).is_some() {
            return false;
        }
    }
    false
}

/// As far as enumerable properties go.
fn has_names_in_shape(object: &JsObject) -> bool {
    !object.shape().has_non_reified_static_properties()
        && (!object.overrides_get_own_property_slot() || object.cell_type() == CellType::Array)
}

fn names_are_in_slot_order(object: &JsObject) -> bool {
    object.shape().has_properties_in_slot_order() && has_names_in_shape(object)
}

/// A proxy is asked about each name when the loop gets there, and only then.
fn mode_for(object: &JsObject) -> DontEnumMode {
    if object.cell_type() == CellType::Proxy {
        DontEnumMode::Include
    } else {
        DontEnumMode::Exclude
    }
}

fn inherited_names(cx: &mut Cx, object: &JsObject) -> JsResult<PropertyNameList> {
    let mut list = PropertyNameList::new(PropertyNameMode::Strings);
    let mut object = object.as_object();
    for _ in 0..=JsObject::MAX_PROTOTYPE_CHAIN_DEPTH {
        match object.get_prototype_of(cx)?.as_object() {
            Some(prototype) => object = prototype,
            None => return Ok(list),
        }
        object.own_property_names(cx, &mut list, mode_for(&object))?;
    }
    Err(cx.throw_stack_overflow())
}

/// Whether the shape says which enumerable properties with a name an instance has, and what it inherits from.
fn determines_names(shape: &Shape) -> bool {
    let cell_type = shape.instance_type();
    !shape.is_dictionary()
        && !shape
            .type_flags()
            .intersects(TypeFlags::OVERRIDES_GET_PROTOTYPE | TypeFlags::PROHIBITS_PROPERTY_CACHING)
        && (!(shape.type_flags()).contains(TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES)
            || matches!(cell_type, CellType::Array | CellType::DerivedArray))
}

fn cacheable_chain(vm: &Vm, shape: &Shape) -> Option<Gc<ImmutableArray>> {
    if !determines_names(shape) {
        return None;
    }
    let mut shapes = root_vec();
    for prototype in shape
        .prototype_object()
        .iter()
        .flat_map(|it| it.chain_direct())
    {
        let is_flat = prototype.try_flatten_for_caching(vm);
        let shape = prototype.shape();
        if !is_flat || !determines_names(&shape) || has_indices(&shape) || overrides_names(&shape) {
            return None;
        }
        shapes.push(shape.into());
    }
    ImmutableArray::try_from_values(vm, &shapes).ok()
}

/// The three registers of a loop.
#[derive(Clone, Copy)]
pub struct ForIn {
    pub enumerator: Gc<PropertyNameEnumerator>,
    pub mode: EnumerationMode,
    /// That of the current key. All ones before the first.
    pub index: u32,
}

impl ForIn {
    /// # Safety
    /// They are what `to_registers` returned.
    #[inline(always)]
    pub unsafe fn from_registers([enumerator, mode, index]: [Value; 3]) -> ForIn {
        // SAFETY: the caller's.
        unsafe {
            ForIn {
                enumerator: Gc::from_address(enumerator.to_bits() as usize),
                mode: core::mem::transmute::<u8, EnumerationMode>(mode.to_bits() as u8),
                index: index.to_bits() as u32,
            }
        }
    }

    #[inline(always)]
    pub fn to_registers(self) -> [Value; 3] {
        [
            self.enumerator.into(),
            Value::int32(self.mode as i32),
            Value::int32(self.index as i32),
        ]
    }

    /// `for_in_open`. `None` if there is nothing to enumerate.
    #[inline]
    pub fn open(cx: &mut Cx, base: Value) -> JsResult<Option<ForIn>> {
        if base.is_undefined_or_null() {
            return Ok(None);
        }
        let object = base.to_object(cx)?;
        PropertyNameEnumerator::for_object(cx, &object).map(Self::with_enumerator)
    }

    #[inline(always)]
    pub fn with_enumerator(enumerator: Gc<PropertyNameEnumerator>) -> Option<ForIn> {
        let mode = if enumerator.indexed_length != 0 {
            EnumerationMode::Indexed
        } else {
            EnumerationMode::OwnShape
        };
        (!enumerator.is_empty()).then_some(ForIn {
            enumerator,
            mode,
            index: u32::MAX,
        })
    }

    /// `base`, if the current key names the slot with the number of the index.
    #[inline(always)]
    pub fn object_with_slot(self, base: Value) -> Option<(Gc<JsObject>, PropertyOffset)> {
        let (cell, enumerator) = (base.as_cell()?, self.enumerator);
        (self.mode == EnumerationMode::OwnShape
            && cell.shape_id() == enumerator.subject_shape
            && self.index < enumerator.own_shape_count)
            .then(|| {
                let capacity = enumerator.inline_capacity as usize;
                let offset = PropertyOffset::for_slot(self.index as usize, capacity);
                // SAFETY: the shape is that of an object.
                (unsafe { cell.cast_unchecked() }, offset)
            })
    }

    /// The same, if any value can be stored there without further ado.
    #[inline(always)]
    pub fn object_with_writable_slot(self, base: Value) -> Option<(Gc<JsObject>, PropertyOffset)> {
        self.object_with_slot(base).filter(|(object, _)| {
            self.enumerator.is_writable && !object.shape().has(ShapeFlags::IS_WATCHING_REPLACEMENT)
        })
    }

    /// In a profile: the mode was `OwnShape`, but the object had another.
    pub const SHAPE_MISMATCH: u32 = 8;

    /// What an instruction that uses the current key on `base` has to remember.
    pub fn profile_for(self, base: Value) -> u32 {
        if self.mode == EnumerationMode::OwnShape && self.object_with_slot(base).is_none() {
            return Self::SHAPE_MISMATCH;
        }
        self.mode as u32
    }

    /// The part of `next` that calls nothing and leaves the mode as it is.
    #[inline(always)]
    pub fn try_next(&mut self, base: Value) -> Option<Gc<JsString>> {
        let next = ForIn {
            index: self.index.wrapping_add(1),
            ..*self
        };
        next.object_with_slot(base)?;
        *self = next;
        // SAFETY: there are at least as many names as slots.
        Some(unsafe { self.enumerator.name_unchecked(next.index) })
    }

    /// The same, for the indices of dense elements.
    #[inline(always)]
    pub fn try_next_index(&mut self, vm: &Vm, base: &JsObject) -> Option<Gc<JsString>> {
        let index = self.index.wrapping_add(1);
        if self.mode != EnumerationMode::Indexed || index >= self.enumerator.indexed_length {
            return None;
        }
        base.try_get_dense(index)?;
        let name = JsString::existing_for_int32(vm, index as i32)?;
        self.index = index;
        Some(name)
    }

    /// The same, for any name. It sets the mode.
    #[inline(always)]
    pub fn try_next_name(&mut self, vm: &Vm, base: &JsCell) -> Option<Gc<JsString>> {
        let (enumerator, mut index) = (self.enumerator, self.index.wrapping_add(1));
        if self.mode == EnumerationMode::Indexed {
            index = index.checked_sub(enumerator.indexed_length)?;
        }
        if index >= enumerator.name_count || !enumerator.is_still_visible(vm, base, index) {
            return None;
        }
        self.index = index;
        self.mode = if index < enumerator.own_shape_count {
            EnumerationMode::OwnShape
        } else {
            EnumerationMode::Generic
        };
        // SAFETY: below the count.
        Some(unsafe { enumerator.name_unchecked(index) })
    }

    #[inline(always)]
    pub fn is_at_end(self) -> bool {
        self.is_at_last_name()
            || (self.enumerator.name_count == 0
                && self.index.wrapping_add(1) >= self.enumerator.indexed_length)
    }

    #[inline(always)]
    fn is_at_last_name(self) -> bool {
        self.mode != EnumerationMode::Indexed
            && self.index.wrapping_add(1) >= self.enumerator.name_count
    }

    /// `for_in_next`. `None` at the end. Changes nothing if it throws.
    #[inline(always)]
    pub fn next(&mut self, cx: &mut Cx, base: Value) -> JsResult<Option<Gc<JsString>>> {
        match self.try_next(base) {
            Some(name) => Ok(Some(name)),
            None => self.next_slow(cx, base),
        }
    }

    #[inline(never)]
    fn next_slow(&mut self, cx: &mut Cx, base: Value) -> JsResult<Option<Gc<JsString>>> {
        let (enumerator, mut first) = (self.enumerator, self.index.wrapping_add(1));
        if self.is_at_last_name() {
            return Ok(None);
        }
        if self.mode == EnumerationMode::Indexed
            && first < enumerator.indexed_length
            && base.is_string()
        {
            self.index = first;
            return Ok(Some(JsString::from_int32(cx, first as i32)));
        }
        let object = base.to_object(cx)?;
        if self.mode == EnumerationMode::Indexed {
            for index in first..enumerator.indexed_length {
                if object.has_enumerable_index(cx, index)? {
                    self.index = index;
                    return Ok(Some(JsString::from_int32(cx, index as i32)));
                }
                cx.check_traps()?;
            }
            first = 0;
        }
        if enumerator.has_only_visible_names {
            PropertyNameEnumerator::cached_for(cx, &object.shape());
        }
        for index in first..enumerator.name_count {
            // SAFETY: below the count.
            let name = unsafe { enumerator.name_unchecked(index) };
            let is_own = index < enumerator.own_shape_count;
            if (is_own && object.shape_id() == enumerator.subject_shape)
                || enumerator.is_still_visible(cx, &object, index)
                || caches::has_enumerable_megamorphic(cx, object, name.to_property_key(cx)?.name())?
            {
                self.index = index;
                self.mode = if is_own {
                    EnumerationMode::OwnShape
                } else {
                    EnumerationMode::Generic
                };
                return Ok(Some(name));
            }
        }
        Ok(None)
    }

    /// What to look the current key up by.
    #[inline(always)]
    pub fn key(self, name: Value) -> Value {
        if self.mode == EnumerationMode::Indexed {
            Value::int32(self.index as i32)
        } else {
            name
        }
    }

    /// Whether the current key is known to be that of an own property.
    #[inline(always)]
    pub fn is_own(self, base: &JsCell) -> bool {
        self.mode != EnumerationMode::Indexed
            && self.index < self.enumerator.own_count
            && base.shape_id() == self.enumerator.subject_shape
    }

    /// `for_in_has_own`
    #[inline]
    pub fn has_own(self, cx: &mut Cx, base: Value, name: Gc<JsString>) -> JsResult<bool> {
        let object = base.to_object(cx)?;
        if self.is_own(&object) {
            return Ok(true);
        }
        if self.mode == EnumerationMode::Indexed {
            if object.try_get_dense(self.index).is_some() {
                return Ok(true);
            }
            return object.has_own_index(cx, self.index);
        }
        caches::has_own_property(cx, &object, name.to_property_key(cx)?.name())
    }
}

/// A `ForIn` that an instruction has put in a frame.
#[repr(C)]
pub struct ForInRegisters {
    index: Cell<u64>,
    mode: Cell<u64>,
    enumerator: Cell<u64>,
}

impl ForInRegisters {
    #[inline(always)]
    pub fn get(&self) -> ForIn {
        let parts = [&self.enumerator, &self.mode, &self.index];
        // SAFETY: from `set`.
        unsafe { ForIn::from_registers(parts.map(|it| Value::from_bits(it.get()))) }
    }

    #[inline(always)]
    pub fn set(&self, for_in: ForIn) {
        self.set_parts(for_in.to_registers());
    }

    #[inline(always)]
    pub fn open(&self, opened: Option<ForIn>) {
        self.set_parts(opened.map_or([Value::UNDEFINED; 3], ForIn::to_registers));
    }

    #[inline(always)]
    fn set_parts(&self, [enumerator, mode, index]: [Value; 3]) {
        self.enumerator.set(enumerator.to_bits());
        self.mode.set(mode.to_bits());
        self.index.set(index.to_bits());
    }

    /// `ForIn::next`, if that calls nothing.
    #[inline(always)]
    pub fn try_next(&self, vm: &Vm, entry: &metadata::ForIn, base: &JsObject) -> Step {
        let mut for_in = self.get();
        let name = (for_in.try_next_index(vm, base)).or_else(|| for_in.try_next_name(vm, base));
        let Some(name) = name else {
            return if for_in.is_at_end() {
                Step::DONE
            } else {
                Step::FAILED
            };
        };
        entry.modes.record(for_in.mode as u32);
        entry.array.record_shape(base);
        self.set(for_in);
        Value::from(name).into()
    }
}

/// False if there is nothing to enumerate.
#[native_abi]
pub fn for_in_open(cx: &mut Cx, state: &ForInRegisters, base: Value) -> JsResult<Value> {
    let opened = ForIn::open(cx, base)?;
    state.open(opened);
    Ok(opened.is_some().into())
}

#[native_abi]
pub fn for_in_next(
    cx: &mut Cx,
    state: &ForInRegisters,
    entry: &metadata::ForIn,
    base: Value,
) -> Step {
    match base.as_object().map(|it| state.try_next(cx, entry, &it)) {
        None | Some(Step::FAILED) => for_in_next_slow(cx, state, entry, base),
        Some(step) => step,
    }
}

/// After `try_next`.
#[inline(never)]
pub fn for_in_next_slow(
    cx: &mut Cx,
    state: &ForInRegisters,
    entry: &metadata::ForIn,
    base: Value,
) -> Step {
    let mut for_in = state.get();
    entry.array.record_base(base);
    let name = for_in.next_slow(cx, base);
    if let Ok(Some(_)) = name {
        entry.modes.record(for_in.profile_for(base));
        state.set(for_in);
    }
    name.into()
}

#[native_abi]
pub fn for_in_has_own(
    cx: &mut Cx,
    state: &ForInRegisters,
    entry: &metadata::ForIn,
    base: Value,
    name: Gc<JsString>,
) -> JsResult<Value> {
    let for_in = state.get();
    entry.modes.record(for_in.profile_for(base));
    if for_in.mode == EnumerationMode::Indexed {
        entry.array.record_base(base);
        if let Some(object) = base.as_object() {
            entry.array.record_index(&object, for_in.index, false);
        }
    }
    for_in.has_own(cx, base, name).map(Into::into)
}
