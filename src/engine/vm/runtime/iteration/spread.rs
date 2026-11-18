use bun_engine_text::{Text, symbols};

use super::record::plain_length;
use crate::{
    CellType, ClonedArguments, Cx, ElementKind, Gc, HoleMode, ImmutableArray, IterationMode,
    IteratorRecord, JsArray, JsObject, JsResult, JsSet, JsString, JsTypedArray, MappedArguments,
    PlainRange, RealmWatchpoint, Storage, Value, ValueVec, errors,
};

/// The elements up to `length`, unless getting them runs code or allocates. Never raw doubles.
pub(super) fn try_list_of_elements(
    cx: &mut Cx,
    source: &JsObject,
    length: u64,
) -> JsResult<Option<Gc<ImmutableArray>>> {
    if let Some(shared) = source.shared_elements()
        && shared.kind() != ElementKind::Double
        && u64::from(shared.len()) == length
    {
        return Ok(Some(shared));
    }
    let holes = HoleMode::FillWithUndefined;
    let Some(plain) = PlainRange::of(&cx.no_gc(), source, 0..length, holes) else {
        return Ok(None);
    };
    let kind = match plain.kind() {
        ElementKind::Int32 => ElementKind::Int32,
        _ => ElementKind::Contiguous,
    };
    // SAFETY: all that has happened since is allocation. The elements are only copied, and no hole is left.
    let list = unsafe {
        ImmutableArray::try_build(cx, kind, plain.len(), |writer| plain.write_to(writer))
    };
    cx.or_out_of_memory(list).map(Some)
}

pub(super) fn list_of_code_points(cx: &Cx, string: &JsString) -> JsResult<Gc<ImmutableArray>> {
    let view = string.view(cx)?;
    cx.or_out_of_memory(match view.text() {
        Text::Latin1(characters) => ImmutableArray::try_from_fn(cx, characters.len(), |index| {
            (cx.small_strings.single_character(characters[index])).into()
        }),
        text => {
            let mut code_points = text.code_points();
            ImmutableArray::try_from_fn(cx, code_points.clone().count(), |_| {
                JsString::from_code_point(cx, code_points.next().unwrap_or_default()).into()
            })
        }
    })
}

/// What `iterable` yields, if no script can tell how that was found out.
pub fn try_spread_directly(cx: &mut Cx, iterable: Value) -> JsResult<Option<Gc<ImmutableArray>>> {
    let Some(cell) = iterable.as_cell() else {
        return Ok(None);
    };
    let is_pristine = match cell.cell_type() {
        CellType::Array => cell.cast::<JsArray>().is_iteration_pristine(),
        CellType::String if cx.holds(RealmWatchpoint::StringIteratorProtocol) => {
            return list_of_code_points(cx, &cell.cast()).map(Some);
        }
        CellType::Set if cell.cast::<JsSet>().is_iteration_pristine(cx) => {
            return cell.cast::<JsSet>().to_immutable_array(cx).map(Some);
        }
        CellType::DirectArguments | CellType::ScopedArguments => {
            cell.cast::<MappedArguments>().is_iteration_pristine()
        }
        CellType::ClonedArguments => cell.cast::<ClonedArguments>().is_iteration_pristine(),
        _ => (cell.downcast::<JsTypedArray>()).is_some_and(|it| it.is_iteration_pristine(cx)),
    };
    let object = is_pristine.then(|| cell.cast::<JsObject>());
    match object.and_then(|object| Some((object, plain_length(&object)?))) {
        Some((object, length)) => try_list_of_elements(cx, &object, length),
        None => Ok(None),
    }
}

/// `spread`. The elements of the list are values, not raw doubles.
#[inline]
pub fn spread(cx: &mut Cx, iterable: Value) -> JsResult<Gc<ImmutableArray>> {
    match try_spread_directly(cx, iterable)? {
        Some(list) => Ok(list),
        None => spread_slow(cx, iterable),
    }
}

#[inline(never)]
fn spread_slow(cx: &mut Cx, iterable: Value) -> JsResult<Gc<ImmutableArray>> {
    if iterable.is_undefined_or_null() {
        return Err(
            cx.throw_type_error("Spread syntax requires ...iterable not be null or undefined")
        );
    }
    let method = iterable.get(cx, symbols::iterator)?;
    if !method.is_callable() {
        let message = "Spread syntax requires ...iterable[Symbol.iterator] to be a function";
        return Err(cx.throw_type_error(message));
    }
    let mut record = match IteratorRecord::open(cx, iterable, method)? {
        Some(record) => record,
        None => {
            let iterator = cx.call(method, iterable, &[])?;
            IteratorRecord::direct(cx, iterator)?
        }
    };
    if record.mode() == IterationMode::Generic {
        let [_, next, iterator] = record.parts();
        if !iterator.is_object() && next.is_callable() {
            return Err(cx.throw_type_error(errors::ITERATOR_RESULT_NOT_OBJECT));
        }
        let collect = cx.private_collect_for_spread().into();
        let array = cx.call(collect, Value::UNDEFINED, &[iterator, next])?;
        let array = array.cast::<JsArray>();
        let list = try_list_of_elements(cx, &array, array.length().into())?;
        return list.ok_or_else(|| cx.throw_out_of_memory());
    }
    if record.mode() == IterationMode::TypedArray {
        let array = iterable.cast::<JsTypedArray>();
        if let Some(list) = try_list_of_elements(cx, &array, array.length() as u64)? {
            return Ok(list);
        }
    }
    if let Some((object, _)) = record.next_element()
        && object.public_length() > Storage::MAX_VECTOR_LENGTH
        && !object.chain_may_intercept_indexed_access()
    {
        return Err(cx.throw_out_of_memory());
    }
    let mut values = ValueVec::new();
    while let Some(value) = record.step_builtin(cx)? {
        if values.len() == Storage::MAX_VECTOR_LENGTH as usize || values.try_push(value).is_err() {
            return Err(cx.throw_out_of_memory());
        }
        cx.check_traps()?;
    }
    cx.or_out_of_memory(ImmutableArray::try_from_values(cx, &values))
}
