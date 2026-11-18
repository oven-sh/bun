//! <https://drafts.csswg.org/scroll-animations/#named-range-get-keyframes>

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, Result};

use crate::api::core::global_of;
use crate::api::typed::CSSNumericValue;
use crate::declarations::Standalone;
use crate::generated_bindgen::animation::RangeEdge;
use crate::properties::{Id, Prop};
use crate::sheet::Declared;
use crate::types::RangeName;
use crate::values::{Out, text};

const WHOLE: [&[u8]; 2] = [b"0%", b"100%"];

/// One item of the list that the property takes.
pub(super) fn only_value(prop: Prop, source: &[u8]) -> Option<Out> {
    let value = Standalone::parse(prop, source).filter(|it| {
        matches!(
            it.declaration.as_deref().map(|it| &it.value),
            Some(Declared::Text(_))
        )
    })?;
    (crate::grammar::split_list(&value.written).len() == 1).then(|| value.written.to_vec())
}

pub(super) fn parse<'a>(
    heap: &JsHeap<'a>,
    edge: usize,
    value: Option<&RangeEdge<'_>>,
) -> Result<'a, Out> {
    let source = match value {
        None => return Ok("normal".into()),
        Some(RangeEdge::Text(it)) => it.to_vec(),
        Some(RangeEdge::Value(it)) => it.stringify(heap),
        Some(RangeEdge::Range(it)) => [
            it.range_name.get().map_or("", RangeName::name).as_bytes(),
            b" ",
            &it.offset
                .map_or_else(|| WHOLE[edge].to_vec(), |it| it.stringify(heap)),
        ]
        .concat(),
    };
    let range = only_value(
        Prop::Long([Id::AnimationRangeStart, Id::AnimationRangeEnd][edge]),
        &source,
    );
    range.ok_or_else(|| heap.type_error(format_args!("'{}' is not a valid range.", text(&source))))
}

pub(super) fn to_js<'a>(heap: &JsHeap<'a>, edge: usize, range: &[u8]) -> Result<'a, JSValue> {
    if range == b"normal" {
        return Ok(heap.create_latin1_string(range).to_js());
    }
    let (first, rest) =
        bun_core::strings::split_once_char(range, b' ').unwrap_or((range, WHOLE[edge]));
    let (name, offset) =
        RangeName::from_name(first).map_or(("none", range), |it| (it.name(), rest));
    Ok(offset_to_js(
        heap,
        name,
        CSSNumericValue::parse(heap, offset)?.to_js(),
    ))
}

pub(super) fn offset_to_js(heap: &JsHeap<'_>, name: &str, offset: JSValue) -> JSValue {
    let global = global_of(heap);
    let object = JSValue::create_empty_object(global, 2);
    object.put(global, b"offset", offset);
    object.put(
        global,
        b"rangeName",
        heap.create_latin1_string(name.as_bytes()).to_js(),
    );
    object
}
