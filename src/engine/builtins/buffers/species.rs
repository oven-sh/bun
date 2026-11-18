use bun_engine_vm::JsTypedArray;

use crate::prelude::*;

/// SpeciesConstructor. `None` stands for the default.
#[inline]
pub(super) fn species_constructor(cx: &mut Cx, exemplar: &JsTypedArray) -> JsResult<Option<Value>> {
    if exemplar.is_species_pristine(cx) {
        return Ok(None);
    }
    look_up_species_constructor(cx, exemplar)
}

#[inline(never)]
fn look_up_species_constructor(cx: &mut Cx, exemplar: &JsTypedArray) -> JsResult<Option<Value>> {
    let constructor = exemplar.get(cx, names::constructor)?;
    if constructor.is_undefined() {
        return Ok(None);
    }
    if !constructor.is_object() {
        return Err(cx.throw_type_error("constructor Property should not be null"));
    }
    let species = constructor.get(cx, symbols::species)?;
    let default = (cx.global()).constructor_of_typed_array(cx, exemplar.element_type());
    if species.is_undefined_or_null() || species == default.into() {
        return Ok(None);
    }
    Ok(Some(species))
}

/// The rest of TypedArraySpeciesCreate. The result has at least `min_length` elements.
pub(super) fn construct_species(
    cx: &mut Cx,
    exemplar: &JsTypedArray,
    species: Value,
    arguments: &[Value],
    min_length: usize,
) -> JsResult<Gc<JsTypedArray>> {
    if !species.is_constructor() {
        return Err(cx.throw_type_error("species is not a constructor"));
    }
    let result = cx.construct(species, arguments, species)?;
    let Some(result) = result.downcast::<JsTypedArray>() else {
        return Err(cx.throw_type_error("species constructor did not return a TypedArray View"));
    };
    if result.validate(cx)? < min_length {
        let message = "TypedArray.prototype.slice constructed typed array of insufficient length";
        return Err(cx.throw_type_error(message));
    }
    if result.element_type().is_bigint() != exemplar.element_type().is_bigint() {
        let message = "Content types of source and created typed arrays are different";
        return Err(cx.throw_type_error(message));
    }
    Ok(result)
}
