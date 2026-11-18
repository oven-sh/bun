//! The methods that make a new array.

use core::ops::Range;

use bun_engine_vm::{
    CellType, ElementKind, ElementWriter, Elements, HoleMode, JsArray, NoGc, RealmWatchpoint,
    Storage, array_species_create, errors, is_array,
};

use super::mutate::splice_range;
use super::{MAX_LENGTH, receiver, set_length, this_object};
use crate::prelude::*;

/// What ArrayCreate checks.
pub(super) fn check_array_size(cx: &Cx, length: u64) -> JsResult<u32> {
    u32::try_from(length).map_err(|_| cx.throw_range_error(errors::INVALID_ARRAY_SIZE))
}

/// An array without holes.
pub(super) fn array_create(
    cx: &mut Cx,
    length: u32,
    mut element: impl FnMut(&mut Cx, u64) -> JsResult<Value>,
) -> JsResult<Gc<JsArray>> {
    if length > Storage::MAX_VECTOR_LENGTH {
        return Err(cx.throw_out_of_memory());
    }
    let array = cx.new_array_with_capacity(ElementKind::Undecided, length as usize)?;
    for index in 0..length {
        let value = element(cx, index.into())?;
        array.append(cx, value)?;
        cx.check_traps()?;
    }
    Ok(array)
}

/// To the start of `target`, or of a new array.
pub(super) fn copy_properties(
    cx: &mut Cx,
    source: &JsObject,
    range: Range<u64>,
    target: Option<Gc<JsObject>>,
) -> JsResult<Gc<JsObject>> {
    let count = range.end - range.start;
    let target = match (target, u32::try_from(count)) {
        (Some(target), _) => target,
        (None, Ok(count)) => (cx.new_array_with_length(ElementKind::Undecided, count)?).upcast(),
        (None, Err(_)) => return Err(cx.throw_range_error(errors::LENGTH_EXCEEDS_MAXIMUM)),
    };
    define_properties_from(cx, source, range, &target, 0)?;
    set_length(cx, &target, count)?;
    Ok(target)
}

fn define_properties_from(
    cx: &mut Cx,
    source: &JsObject,
    range: Range<u64>,
    target: &JsObject,
    start: u64,
) -> JsResult<()> {
    let mut index = range.start;
    while index < range.end {
        index = match source.get_index_if_has_property(cx, index)? {
            Some(value) => {
                target.create_data_index(cx, start + (index - range.start), value, true)?;
                index + 1
            }
            None => source.skip_holes(index + 1..range.end),
        };
        cx.check_traps()?;
    }
    Ok(())
}

#[native_abi]
pub(super) fn slice(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let length = object.length_of_array_like(cx)?;
    let start = frame.argument(0).to_relative_index(cx, length, 0)?;
    let end = frame.argument(1).to_relative_index(cx, length, length)?;
    let range = start..end.max(start);
    let species = array_species_create(cx, &object, range.end - start)?;
    if species.is_none()
        && let Some(copy) = JsArray::try_copy(cx, &object, range.clone(), HoleMode::Keep)?
    {
        return Ok(copy.into());
    }
    copy_properties(cx, &object, range, species).map(Into::into)
}

/// IsConcatSpreadable, if finding out runs no code.
#[inline(always)]
fn try_is_concat_spreadable(cx: &Cx, value: Value) -> Option<bool> {
    let Some(object) = value.as_object() else {
        return Some(false);
    };
    let (global, name) = (object.realm()?, symbols::isConcatSpreadable);
    let array = object.as_exact_array();
    let inherits = match array {
        Some(array) => array.inherits_from_array_prototype(&global, name),
        None => {
            object.cell_type() == CellType::FinalObject
                && object.prototype_direct() == global.object_prototype().into()
                && object.shape().get(name).is_none()
        }
    };
    (inherits && global.holds(cx, RealmWatchpoint::ArrayIsConcatSpreadable))
        .then_some(array.is_some())
}

fn is_concat_spreadable(cx: &mut Cx, value: Value) -> JsResult<bool> {
    if let Some(answer) = try_is_concat_spreadable(cx, value) {
        return Ok(answer);
    }
    match value.get(cx, symbols::isConcatSpreadable)? {
        Value::UNDEFINED => is_array(cx, value),
        spreadable => Ok(spreadable.to_boolean(cx)),
    }
}

/// Of an array that has nothing else. More may make the result sparse.
const MAX_COPIED_HOLES: u64 = 1000;

fn try_concat(cx: &mut Cx, first: Value, rest: &[Value]) -> JsResult<Option<Gc<JsArray>>> {
    let parts = || core::iter::once(&first).chain(rest).copied();
    let (mut kind, mut length) = (ElementKind::Undecided, 0);
    let mut longest = None;
    for part in parts() {
        let Some(is_spreadable) = try_is_concat_spreadable(cx, part) else {
            return Ok(None);
        };
        if !is_spreadable {
            kind = kind.max(ElementKind::for_value(part));
            length += 1;
            continue;
        }
        let array = part.cast::<JsArray>();
        let count = u64::from(array.length());
        if array.plain_elements(&cx.no_gc(), 0..count).is_none()
            || (array.element_kind() == ElementKind::Undecided && count > MAX_COPIED_HOLES)
        {
            return Ok(None);
        }
        if count != 0 {
            kind = kind.max(array.element_kind()).max(ElementKind::Int32);
            length += count;
            longest = Some(array);
        }
    }
    if let Some(only) = longest.filter(|it| u64::from(it.length()) == length) {
        return JsArray::try_copy(cx, &only, 0..length, HoleMode::Keep);
    }
    if length > u64::from(Storage::MAX_VECTOR_LENGTH) {
        return Ok(None);
    }
    JsArray::build(cx, kind, length as usize, |writer, no_gc| {
        for part in parts() {
            match part.as_exact_array() {
                Some(array) if array.length() == 0 => {}
                Some(array) => writer.extend(array.dense_elements(no_gc), HoleMode::Keep),
                None => writer.push(part),
            }
        }
    })
    .map(Some)
}

#[native_abi]
pub(super) fn concat(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "concat")?;
    let species = array_species_create(cx, &object, 0)?;
    if species.is_none()
        && let Some(result) = try_concat(cx, object.into(), frame.arguments())?
    {
        return Ok(result.into());
    }
    let result = species.unwrap_or_else(|| cx.new_array().upcast());
    let mut length = 0;
    for &part in core::iter::once(&object.into()).chain(frame.arguments()) {
        let source = is_concat_spreadable(cx, part)?.then(|| part.cast::<JsObject>());
        let count = match source {
            Some(source) => source.length_of_array_like(cx)?,
            None => 1,
        };
        if length + count > MAX_LENGTH {
            return Err(cx.throw_type_error(errors::LENGTH_EXCEEDS_MAXIMUM));
        }
        match (source, result.as_exact_array()) {
            (None, _) => result
                .create_data_index(cx, length, part, true)
                .map(|_| ())?,
            (Some(source), Some(array))
                if cx
                    .or_out_of_memory(array.try_append_elements(cx, length, &source, count))? => {}
            (Some(source), _) => define_properties_from(cx, &source, 0..count, &result, length)?,
        }
        length += count;
    }
    set_length(cx, &result, length)?;
    Ok(result.into())
}

/// The kind of a copy of the first `length` elements with the holes filled, if it can be made at once.
#[inline(always)]
fn kind_of_filled_copy(cx: &mut Cx, object: &JsObject, length: u64) -> Option<ElementKind> {
    let no_gc = cx.no_gc();
    let elements = object.plain_elements(&no_gc, 0..length)?;
    Some(elements.kind_with(HoleMode::FillWithUndefined))
}

#[native_abi]
pub(super) fn to_reversed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "toReversed")?;
    let length = object.length_of_array_like(cx)?;
    let size = check_array_size(cx, length)?;
    match kind_of_filled_copy(cx, &object, length) {
        Some(kind) => JsArray::build(cx, kind, size as usize, |writer, no_gc| {
            let elements = object.dense_elements(no_gc).slice(0..size as usize);
            writer.extend_reversed(elements, HoleMode::FillWithUndefined);
        }),
        None => array_create(cx, size, |cx, index| {
            object.get_index(cx, length - index - 1)
        }),
    }
    .map(Into::into)
}

/// The first `length` elements, with `items` in place of those in the range.
fn copy_replacing(
    cx: &mut Cx,
    object: &JsObject,
    length: u64,
    range: Range<u64>,
    items: &[Value],
) -> JsResult<Value> {
    let (removed, added) = (range.end - range.start, items.len() as u64);
    let size = check_array_size(cx, length - removed + added)?;
    match kind_of_filled_copy(cx, object, length) {
        Some(kind) => {
            let kind = kind.generalized_for_slice(items);
            JsArray::build(cx, kind, size as usize, |writer, no_gc| {
                let (elements, holes) = (object.dense_elements(no_gc), HoleMode::FillWithUndefined);
                writer.extend(elements.slice(0..range.start as usize), holes);
                writer.extend_from_slice(items);
                writer.extend(elements.slice(range.end as usize..length as usize), holes);
            })
        }
        None => array_create(cx, size, |cx, index| match index.checked_sub(range.start) {
            None => object.get_index(cx, index),
            Some(offset) if offset < added => Ok(items[offset as usize]),
            Some(_) => object.get_index(cx, index - added + removed),
        }),
    }
    .map(Into::into)
}

#[native_abi]
pub(super) fn to_spliced(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "toSpliced")?;
    let length = object.length_of_array_like(cx)?;
    let (start, removed) = splice_range(cx, frame, length)?;
    let items = frame.rest(2);
    if length - removed + items.len() as u64 > MAX_LENGTH {
        return Err(cx.throw_type_error("Array length exceeds 2**53 - 1"));
    }
    copy_replacing(cx, &object, length, start..start + removed, items)
}

#[native_abi]
pub(super) fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "with")?;
    let length = object.length_of_array_like(cx)?;
    let relative = match frame.argument(0).as_int32() {
        Some(relative) => i64::from(relative),
        None => frame.argument(0).to_integer_or_infinity(cx)? as i64,
    };
    let index = if relative < 0 {
        length.wrapping_add_signed(relative)
    } else {
        relative as u64
    };
    if index >= length {
        return Err(cx.throw_range_error("Array index out of range"));
    }
    copy_replacing(cx, &object, length, index..index + 1, &[frame.argument(1)])
}

/// Deeper than this, flattening watches the stack.
const MAX_PLAIN_NESTING: u32 = 64;
/// With more than this, it can be interrupted.
const MAX_PLAIN_ARRAYS: u32 = 1 << 26;

struct Extent {
    kind: ElementKind,
    /// Counts some holes too.
    room: u64,
    arrays: u32,
}

impl Extent {
    #[inline(always)]
    fn add_flat(&mut self, elements: Elements<'_>) {
        if !elements.is_empty() {
            self.kind = self.kind.max(elements.kind());
            self.room += elements.len() as u64;
        }
    }

    /// `None` if flattening takes more than a look at the elements.
    fn add_nested(
        &mut self,
        no_gc: &NoGc<'_>,
        values: &[Option<Value>],
        depth: u64,
        nesting: u32,
    ) -> Option<()> {
        let (mut common_bits, mut count) = (u64::MAX, 0);
        for &value in values.iter().flatten() {
            if let Some(cell) = value.as_cell() {
                if let Some(array) = cell.as_exact_array() {
                    self.arrays += 1;
                    match array.plain_elements(no_gc, 0..array.length().into())? {
                        Elements::Contiguous(inner) if depth > 1 => {
                            self.add_nested(no_gc, inner, depth - 1, nesting.checked_sub(1)?)?;
                        }
                        inner => self.add_flat(inner),
                    }
                    continue;
                }
                if matches!(cell.cell_type(), CellType::Proxy | CellType::DerivedArray) {
                    return None;
                }
            }
            common_bits &= value.to_bits();
            count += 1;
        }
        if common_bits < Value::NUMBER_TAG {
            self.kind = ElementKind::Contiguous;
        } else if count != 0 {
            self.kind = self.kind.max(ElementKind::Int32);
        }
        self.room += count;
        (self.room <= u64::from(Storage::MAX_VECTOR_LENGTH) && self.arrays <= MAX_PLAIN_ARRAYS)
            .then_some(())
    }
}

fn write_nested(
    writer: &mut ElementWriter<'_>,
    no_gc: &NoGc<'_>,
    mut values: &[Option<Value>],
    depth: u64,
) {
    loop {
        let count = writer.extend_until(values, |value| value.as_exact_array().is_some());
        let Some(array) = values.get(count).and_then(|it| (*it)?.as_exact_array()) else {
            return;
        };
        match array.dense_elements(no_gc) {
            Elements::Contiguous(inner) if depth > 1 => {
                write_nested(writer, no_gc, inner, depth - 1);
            }
            inner => writer.extend_without_holes(inner),
        }
        values = &values[count + 1..];
    }
}

fn try_flatten(
    cx: &mut Cx,
    source: &JsObject,
    length: u64,
    depth: u64,
) -> JsResult<Option<Gc<JsArray>>> {
    let mut extent = Extent {
        kind: ElementKind::Undecided,
        room: 0,
        arrays: 0,
    };
    let no_gc = cx.no_gc();
    match source.plain_elements(&no_gc, 0..length) {
        Some(Elements::Contiguous(values)) if depth != 0 => {
            let added = extent.add_nested(&no_gc, values, depth, MAX_PLAIN_NESTING);
            if added.is_none() {
                return Ok(None);
            }
        }
        Some(elements) => extent.add_flat(elements),
        None => return Ok(None),
    }
    JsArray::build(
        cx,
        extent.kind,
        extent.room as usize,
        |writer, no_gc| match source.dense_elements(no_gc).slice(0..length as usize) {
            Elements::Contiguous(values) if depth != 0 => {
                write_nested(writer, no_gc, values, depth)
            }
            elements => writer.extend_without_holes(elements),
        },
    )
    .map(Some)
}

/// FlattenIntoArray
fn flatten_into(
    cx: &mut Cx,
    target: &JsObject,
    source: &JsObject,
    length: u64,
    mut target_index: u64,
    depth: u64,
) -> JsResult<u64> {
    cx.check_stack()?;
    for index in 0..length {
        cx.check_traps()?;
        let Some(element) = source.get_index_if_has_property(cx, index)? else {
            continue;
        };
        if depth != 0 && is_array(cx, element)? {
            let inner = element.cast::<JsObject>();
            let length = inner.length_of_array_like(cx)?;
            target_index = flatten_into(cx, target, &inner, length, target_index, depth - 1)?;
        } else {
            if target_index >= MAX_LENGTH {
                return Err(cx.throw_type_error("flatten array exceeds 2**53 - 1"));
            }
            target.create_data_index(cx, target_index, element, true)?;
            target_index += 1;
        }
    }
    Ok(target_index)
}

#[native_abi]
pub(super) fn flat(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_object!(cx, frame, "flat")?;
    let length = object.length_of_array_like(cx)?;
    let depth = match frame.argument(0) {
        Value::UNDEFINED => 1,
        depth => depth.to_integer_or_infinity(cx)? as u64,
    };
    let species = array_species_create(cx, &object, 0)?;
    if species.is_none()
        && let Some(result) = try_flatten(cx, &object, length, depth)?
    {
        return Ok(result.into());
    }
    let result = species.unwrap_or_else(|| cx.new_array().upcast());
    flatten_into(cx, &result, &object, length, 0, depth)?;
    Ok(result.into())
}
