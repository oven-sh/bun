//! What the instructions that make arrays do. A run of registers is a slice with the last one first.

use bun_engine_bytecode::ArrayShape;
use bun_engine_text::{names, symbols};

use crate::{
    ArrayAllocationProfile, Cx, ElementKind, ElementWriter, Gc, HoleMode, ImmutableArray, JsArray,
    JsObject, JsResult, RealmSlot, RealmWatchpoint, Storage, Value, errors, function_realm,
    is_array,
};

impl From<ArrayShape> for ElementKind {
    #[inline(always)]
    fn from(shape: ArrayShape) -> ElementKind {
        match shape {
            ArrayShape::Undecided => ElementKind::Undecided,
            ArrayShape::Int32 => ElementKind::Int32,
            ArrayShape::Double => ElementKind::Double,
            ArrayShape::Contiguous => ElementKind::Contiguous,
        }
    }
}

/// `new_array`
///
/// # Safety
/// As for `ArrayAllocationProfile::update`, also for those below that take a profile.
#[inline]
pub unsafe fn new_array(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    shape: ArrayShape,
    registers: &[Option<Value>],
) -> JsResult<Gc<JsArray>> {
    // SAFETY: the caller's.
    let (kind, vector_length) = unsafe { profile.update() };
    let kind = (kind.max(shape.into())).generalized_for(registers.iter().flatten().copied());
    let fill = |writer: &mut ElementWriter<'_>| {
        (registers.iter().rev()).for_each(|&element| writer.push_or_hole(element));
    };
    let room = registers.len().max(vector_length as usize);
    // SAFETY: only copies.
    let array = unsafe { JsArray::try_build_in_realm(cx, &cx.global(), kind, room, fill) };
    Ok(profile.did_allocate(cx.or_out_of_memory(array)?))
}

/// `new_array_from_constant`. If the shared elements of the array are not `elements`, they are the better constant.
///
/// # Safety
/// See `new_array`.
#[inline]
pub unsafe fn new_array_from_constant(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    elements: Gc<ImmutableArray>,
) -> JsResult<Gc<JsArray>> {
    // SAFETY: the caller's.
    let (kind, vector_length) = unsafe { profile.update() };
    if profile.prefers_copy_of(elements.len()) {
        let (kind, room) = (kind.max(elements.kind()), elements.len().max(vector_length));
        let fill =
            |writer: &mut ElementWriter<'_>| writer.extend(elements.elements(), HoleMode::Keep);
        // SAFETY: only copies.
        let array =
            unsafe { JsArray::try_build_in_realm(cx, &cx.global(), kind, room as usize, fill) };
        return Ok(profile.did_allocate(cx.or_out_of_memory(array)?));
    }
    let elements = if kind > elements.kind() {
        cx.or_out_of_memory(elements.try_generalized(cx, kind))?
    } else {
        elements
    };
    Ok(profile.did_allocate(JsArray::from_immutable(cx, elements)?))
}

/// # Safety
/// See `new_array`.
#[inline(always)]
unsafe fn new_array_of_holes(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    length: u32,
) -> JsResult<Gc<JsArray>> {
    // SAFETY: the caller's.
    let (kind, vector_length) = unsafe { profile.update() };
    let array = JsArray::try_create(cx, cx.global().array_shape(kind), length, vector_length);
    Ok(profile.did_allocate(cx.or_out_of_memory(array)?))
}

/// `new_array_with_size`
///
/// # Safety
/// See `new_array`.
#[inline]
pub unsafe fn new_array_with_size(
    cx: &Cx,
    profile: &ArrayAllocationProfile,
    length: Value,
) -> JsResult<Gc<JsArray>> {
    // SAFETY: the caller's.
    unsafe {
        match length.as_uint32() {
            Some(length) => new_array_of_holes(cx, profile, length),
            None if length.is_number() => Err(cx.throw_range_error(errors::INVALID_ARRAY_SIZE)),
            None => new_array(cx, profile, ArrayShape::Contiguous, &[Some(length)]),
        }
    }
}

/// `new_array_with_species`
///
/// # Safety
/// See `new_array`.
#[inline]
pub unsafe fn new_array_with_species(
    cx: &mut Cx,
    profile: &ArrayAllocationProfile,
    length: Value,
    original: &JsObject,
) -> JsResult<Gc<JsObject>> {
    let length = length.as_number().map_or(0, |length| length as u64);
    if let Some(object) = array_species_create(cx, original, length)? {
        return Ok(object);
    }
    let Ok(length) = u32::try_from(length) else {
        return Err(cx.throw_range_error(errors::INVALID_ARRAY_SIZE));
    };
    // SAFETY: the caller's.
    unsafe { new_array_of_holes(cx, profile, length) }.map(Gc::upcast)
}

impl JsArray {
    /// Whether ArraySpeciesCreate comes down to ArrayCreate without running any code.
    #[inline(always)]
    pub fn has_default_species(&self, cx: &Cx) -> bool {
        self.realm().is_some_and(|global| {
            self.inherits_from_array_prototype(&global, names::constructor)
                && global.holds(cx, RealmWatchpoint::ArraySpecies)
        })
    }
}

/// ArraySpeciesCreate. `None` leaves ArrayCreate to the caller.
#[inline(always)]
pub fn array_species_create(
    cx: &mut Cx,
    original: &JsObject,
    length: u64,
) -> JsResult<Option<Gc<JsObject>>> {
    if let Some(array) = original.as_exact_array()
        && array.has_default_species(cx)
    {
        return Ok(None);
    }
    array_species_create_slow(cx, original, length)
}

#[inline(never)]
fn array_species_create_slow(
    cx: &mut Cx,
    original: &JsObject,
    length: u64,
) -> JsResult<Option<Gc<JsObject>>> {
    if !is_array(cx, original.as_value())? {
        return Ok(None);
    }
    let mut constructor = original.get(cx, names::constructor)?;
    if let Some(object) = constructor.as_object() {
        if object.is_constructor() {
            let realm = function_realm(cx, object)?;
            let its_array = realm.slot_if_initialized(RealmSlot::array_constructor);
            if realm != cx.global() && its_array == Some(object.cell()) {
                return Ok(None);
            }
        }
        constructor = object.get(cx, symbols::species)?;
        if constructor.is_null() {
            return Ok(None);
        }
    }
    if constructor.is_undefined() {
        return Ok(None);
    }
    if !constructor.is_constructor() {
        return Err(cx.throw_type_error("Species construction did not get a valid constructor"));
    }
    cx.construct(constructor, &[length.into()], constructor)
        .map(Some)
}

/// No script has one, so it can only have come from `spread`.
#[inline(always)]
pub(super) fn as_spread(register: Option<Value>) -> Option<Gc<ImmutableArray>> {
    register?.downcast()
}

/// How many elements the registers stand for.
#[inline]
fn spread_length(registers: &[Option<Value>]) -> usize {
    let length = |&register| as_spread(register).map_or(1, |list| list.len() as usize);
    registers.iter().map(length).sum()
}

fn spread_kind(registers: &[Option<Value>]) -> ElementKind {
    let is_int32 = |&register: &Option<Value>| match as_spread(register) {
        Some(list) => list.kind() == ElementKind::Int32 || list.is_empty(),
        None => register.is_none_or(Value::is_int32),
    };
    if registers.iter().all(is_int32) {
        ElementKind::Int32
    } else {
        ElementKind::Contiguous
    }
}

/// `new_array_with_spread`
pub fn new_array_with_spread(cx: &Cx, registers: &[Option<Value>]) -> JsResult<Gc<JsArray>> {
    if let &[only] = registers
        && let Some(list) = as_spread(only)
    {
        return JsArray::from_immutable(cx, list);
    }
    let fill = |writer: &mut ElementWriter<'_>| {
        for &register in registers.iter().rev() {
            match as_spread(register) {
                Some(list) if list.is_empty() => {}
                Some(list) => writer.extend(list.elements(), HoleMode::Keep),
                None => writer.push_or_hole(register),
            }
        }
    };
    let (kind, length) = (spread_kind(registers), spread_length(registers));
    // SAFETY: only copies.
    let array = unsafe { JsArray::try_build_in_realm(cx, &cx.global(), kind, length, fill) };
    cx.or_out_of_memory(array)
}

/// `append_to_array`
pub fn append_to_array(cx: &Cx, array: &JsArray, registers: &[Option<Value>]) -> JsResult<()> {
    let end = array.length() as usize + spread_length(registers);
    if end > Storage::MAX_VECTOR_LENGTH as usize {
        return Err(cx.throw_out_of_memory());
    }
    for &register in registers.iter().rev() {
        let appended = match (as_spread(register), register) {
            (Some(list), _) => array.append_values(cx, list.values().unwrap_or_default()),
            (None, Some(value)) => array.append_values(cx, &[value]),
            (None, None) => array.ensure_public_length(cx, array.length() + 1),
        };
        cx.or_out_of_memory(appended)?;
    }
    Ok(())
}
