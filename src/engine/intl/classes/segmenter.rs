use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_vm::{JsFinalObject, ShapeSpec, Visitor};

use super::prelude::*;
use super::results::record_shape;
use crate::segmenter::{Segment, SegmentIterator, Segmenter, Segments};

#[cell(name = "Object")]
struct JsSegmenter {
    base: JsDestructibleObject,
    segmenter: Segmenter,
}

#[cell(name = "Object", visit_children)]
struct JsSegments {
    base: JsDestructibleObject,
    segments: Segments,
    input: Gc<JsString>,
    extra_memory: AtomicUsize,
}

impl JsSegments {
    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.report_extra_memory(self.extra_memory.load(Ordering::Relaxed));
    }
}

#[cell(name = "Object", visit_children)]
struct JsSegmentIterator {
    base: JsDestructibleObject,
    iterator: SegmentIterator,
    input: Gc<JsString>,
    extra_memory: usize,
}

impl JsSegmentIterator {
    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.report_extra_memory(self.extra_memory);
    }
}

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::segment, segment, 1),
    StaticProperty::function(names::resolvedOptions, resolved_options, 0),
    StaticProperty::string(symbols::toStringTag, names::intlSegmenter),
]);

static_table!(static SEGMENTS_PROPERTIES = [
    StaticProperty::function(names::containing, containing, 1),
    StaticProperty::function(symbols::iterator, iterate, 0),
]);

static_table!(static ITERATOR_PROPERTIES = [
    StaticProperty::function(names::next, next, 0),
    StaticProperty::string(symbols::toStringTag, names::segmenterStringIterator),
]);

define_class!(
    Segmenter: JsSegmenter, "Intl.Segmenter", length 0, GENERAL_CONSTRUCTOR_PROPERTIES,
    init_segmenter_constructor, init_segmenter_shape
);

define_throwing_call!("Segmenter");

define_object!(SegmentsPrototype, "%Segments%", SEGMENTS_PROPERTIES);

define_object!(
    IteratorPrototype,
    "Segmenter String Iterator",
    ITERATOR_PROPERTIES
);

pub(super) fn initialize_segments(cx: &Cx) {
    let global = cx.global();
    let shape =
        |prototype: Gc<JsObject>, spec| Shape::create(cx, Some(global), prototype.into(), spec);
    let prototype = SegmentsPrototype::create(cx, cx.object_prototype());
    global.init_segments_shape(shape(prototype, ShapeSpec::of::<JsSegments>()));
    let prototype = IteratorPrototype::create(cx, cx.iterator_prototype());
    global.init_segment_iterator_shape(shape(prototype, ShapeSpec::of::<JsSegmentIterator>()));
    let names = [
        names::segment,
        names::index,
        names::input,
        names::isWordLike,
    ];
    global.init_segment_data_shape(record_shape(cx, &names[..3]));
    global.init_word_segment_data_shape(record_shape(cx, &names));
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::segmenter_shape)?;
    let requested = canonicalize_locale_list(cx, frame.argument(0))?;
    let options = OptionBag::require(cx, frame.argument(1))?;
    options.check_locale_matcher(cx)?;
    let granularity = options.value_or_default(cx, names::granularity)?;
    let segmenter = with_cache(cx, |cache| Segmenter::new(cache, &requested, granularity))?;
    let base = JsObjectInit::new(cx, shape);
    let object = cx.allocate::<JsSegmenter>(JsSegmenterInit { base, segmenter });
    Ok(object.into())
}

#[native_abi]
fn segment(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsSegmenter> = this!(cx, frame.this_value(), "Segmenter", "segment")?;
    let input = frame.argument(0).to_string(cx)?;
    let string = input.to_string_ref(cx)?;
    let segments = this.segmenter.segment(string).or_throw(cx)?;
    let extra_memory = segments.estimated_size();
    let object = cx.allocate::<JsSegments>(JsSegmentsInit {
        base: JsObjectInit::new(cx, cx.segments_shape()),
        segments,
        input,
        extra_memory: AtomicUsize::new(extra_memory),
    });
    cx.heap.report_extra_memory_allocated(&object, extra_memory);
    Ok(object.into())
}

#[native_abi]
fn resolved_options(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsSegmenter> = this!(cx, frame.this_value(), "Segmenter", "resolvedOptions")?;
    let granularity = this.segmenter.granularity();
    let options = Record::with_locale(cx, this.segmenter.locale().string().clone());
    options.put_named(names::granularity, granularity);
    Ok(options.finish())
}

#[native_abi]
fn containing(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = frame.this_value().downcast::<JsSegments>() else {
        let message = "%Segments.prototype%.containing called on value that's not a Segments";
        return Err(cx.throw_type_error(message));
    };
    let index = frame.argument(0).to_integer_or_infinity(cx)?;
    let remembered = this.segments.remembered_size();
    let found = this.segments.containing(index);
    let added = this.segments.remembered_size() - remembered;
    if added != 0 {
        this.extra_memory.fetch_add(added, Ordering::Relaxed);
        cx.heap.report_extra_memory_allocated(&this, added);
    }
    match found.or_throw(cx)? {
        Some(segment) => segment_data(cx, &segment, this.input),
        None => Ok(Value::UNDEFINED),
    }
}

#[native_abi]
fn iterate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = frame.this_value().downcast::<JsSegments>() else {
        let message = "%Segments.prototype%[@@iterator] called on value that's not a Segments";
        return Err(cx.throw_type_error(message));
    };
    let iterator = this.segments.iterate();
    let extra_memory = iterator.estimated_size();
    let object = cx.allocate::<JsSegmentIterator>(JsSegmentIteratorInit {
        iterator,
        input: this.input,
        extra_memory,
        base: JsObjectInit::new(cx, cx.segment_iterator_shape()),
    });
    cx.heap.report_extra_memory_allocated(&object, extra_memory);
    Ok(object.into())
}

#[native_abi]
fn next(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this: Gc<JsSegmentIterator> = this!(cx, frame.this_value(), "SegmentIterator", "next")?;
    let result = match this.iterator.next().or_throw(cx)? {
        Some(segment) => cx.new_iterator_result(segment_data(cx, &segment, this.input)?, false),
        None => cx.new_iterator_result(Value::UNDEFINED, true),
    };
    Ok(result.into())
}

/// CreateSegmentDataObject
fn segment_data(cx: &Cx, segment: &Segment, input: Gc<JsString>) -> JsResult<Value> {
    let (start, end) = (segment.range.start as u32, segment.range.end as u32);
    let (string, index) = (input.substring(cx, start, end)?.into(), start.into());
    let create = |shape, values: &[Value]| JsFinalObject::create_with_values(cx, shape, values);
    let data = match segment.is_word_like {
        Some(is_word_like) => create(
            cx.word_segment_data_shape(),
            &[string, index, input.into(), is_word_like.into()],
        ),
        None => create(cx.segment_data_shape(), &[string, index, input.into()]),
    };
    Ok(data.into())
}
