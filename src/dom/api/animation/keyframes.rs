//! <https://drafts.csswg.org/web-animations/#processing-a-keyframes-argument>

use core::ffi::c_void;
use std::rc::Rc;

use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope, Result, to_js};
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult, VM};

use crate::animation::ComputedKeyframe;
use crate::api::core::List;
use crate::api::cssom::{camel_case, property_of_attribute};
use crate::calc::{Kind, Unit};
use crate::cssom::keyframe_offset;
use crate::declarations::{Key, Standalone};
use crate::generated_bindgen::animation::*;
use crate::properties::{Id, Prop};
use crate::sheet::{Block, Keyframe};
use crate::types::{Easing, RangeName};
use crate::values::{Composite, Css, Ctx, Flow, Out, parse_all, text};

#[derive(Clone)]
pub(super) struct Frame {
    /// In `range`, if it has one.
    offset: Option<f64>,
    pub(super) range: Option<RangeName>,
    computed_offset: Option<f64>,
    easing: Easing,
    composite: Option<Composite>,
    values: Vec<Standalone>,
}

struct Given {
    frame: Frame,
    easing: Out,
}

impl Default for Given {
    fn default() -> Given {
        Given {
            frame: Frame {
                offset: None,
                range: None,
                computed_offset: None,
                easing: Easing::linear(),
                composite: None,
                values: Vec::new(),
            },
            easing: "linear".into(),
        }
    }
}

pub(super) fn parse_easing<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Result<'a, Easing> {
    if source == b"linear" {
        return Ok(Easing::linear());
    }
    let (cx, is_valid) = (
        Ctx::dummy(),
        crate::grammar::definition("<easing>").is_some_and(|it| it.accepts(source)),
    );
    let parsed = is_valid
        .then(|| parse_all(source, |p| Easing::parse(p, &cx)))
        .flatten()
        .filter(|_| cx.deps.get().is_empty());
    parsed.ok_or_else(|| {
        heap.type_error(format_args!(
            "'{}' is not a valid value for easing",
            text(source)
        ))
    })
}

impl CompositeOperationOrAuto {
    fn get(self) -> Option<Composite> {
        [
            Some(Composite::Replace),
            Some(Composite::Add),
            Some(Composite::Accumulate),
            None,
        ][self as usize]
    }
}

impl TimelineRange {
    pub(super) fn get(self) -> Option<RangeName> {
        use RangeName::*;
        [
            None,
            Some(Cover),
            Some(Contain),
            Some(Entry),
            Some(Exit),
            Some(EntryCrossing),
            Some(ExitCrossing),
            Some(Scroll),
        ][self as usize]
    }
}

fn set_offset<'a>(cx: &mut JsScope<'a>, frame: &mut Frame, offset: JSValue) -> Result<'a, ()> {
    let global = cx.global();
    let (range, fraction) = match () {
        () if offset.is_undefined_or_null() => return Ok(()),
        () if offset.is_number() => (None, Some(offset.as_number()).filter(|it| it.is_finite())),
        () if offset.is_object() => TimelineRangeOffset::from_js(global, offset, |it| {
            let percentage = it
                .offset
                .filter(|it| it.numeric_type().matches(Kind::Percentage));
            Ok((
                it.range_name.get(),
                percentage
                    .and_then(|it| it.amount(JsHeap::from_global(global), Unit::Percent).ok())
                    .map(|it| it / 100.0),
            ))
        })?,
        () => {
            keyframe_offset(&offset.to_utf8(global)?).map_or((None, None), |it| (it.0, Some(it.1)))
        }
    };
    (frame.range, frame.offset) = (
        range,
        Some(fraction.ok_or_else(|| cx.heap.type_error(format_args!("The offset is not valid.")))?),
    );
    Ok(())
}

/// <https://drafts.csswg.org/web-animations/#idl-attribute-name-to-animation-property-name>
fn animatable_property(member: &[u8]) -> Option<Prop> {
    if member.starts_with(b"--") {
        crate::custom::remember(member);
        return Prop::from_name(member);
    }
    let prop = match member {
        b"float" | b"offset" | [b'A'..=b'Z', ..] => return None,
        b"cssOffset" => Prop::from_name(b"offset")?,
        _ if member.starts_with(b"webkit") || bun_core::strings::contains_char(member, b'-') => {
            return None;
        }
        _ => property_of_attribute(member)?,
    };
    (prop != Prop::All
        && prop
            .longhands(Flow::DEFAULT)
            .iter()
            .any(|it| it.is_animatable()))
    .then_some(prop)
}

fn member_name(prop: Prop) -> Out {
    match prop {
        Prop::Custom(_) => Key::Property(prop).name().into_owned().into(),
        Prop::Long(Id::Float) => "cssFloat".into(),
        _ if prop.name() == "offset" => "cssOffset".into(),
        _ => camel_case(prop.name().as_bytes()),
    }
}

fn animatable_members(global: &JSGlobalObject, object: JSValue) -> JsResult<Vec<(Out, Prop)>> {
    let (mut all, mut keys) = (Vec::new(), object.keys(global)?.array_iterator(global)?);
    while let Some(key) = keys.next()? {
        let name = key.to_utf8(global)?;
        all.extend(animatable_property(&name).map(|it| (name.to_vec(), it)));
    }
    bun_collections::index_sort::sort_slice_by(&mut all, |a, b| a.0.cmp(&b.0));
    Ok(all)
}

fn member(global: &JSGlobalObject, object: JSValue, name: &[u8]) -> JsResult<JSValue> {
    Ok(object.get(global, name)?.unwrap_or(JSValue::UNDEFINED))
}

/// Its items if it can be iterated, or else itself.
fn list_of(global: &JSGlobalObject, value: JSValue) -> JsResult<List<'_>> {
    extern "C" fn push(_: *mut VM, global: &JSGlobalObject, list: *mut c_void, item: JSValue) {
        List::from_value(JSValue::from_encoded(list as usize))
            .push(JsHeap::from_global(global), item);
    }
    let list = List::new(JsHeap::from_global(global));
    match value.is_object() && value.is_iterable(global)? {
        true => value.for_each(global, list.to_js().encoded() as *mut c_void, push)?,
        false => list.push(JsHeap::from_global(global), value),
    }
    Ok(list)
}

fn from_object<'a>(cx: &mut JsScope<'a>, object: JsLocal<'a, JSObject>) -> Result<'a, Given> {
    let (mut given, object) = (Given::default(), object.to_js());
    let offset = BaseKeyframe::from_js(cx.global(), object, |it| {
        (given.frame.composite, given.easing) = (
            it.composite.get(),
            it.easing
                .as_ref()
                .map_or_else(|| "linear".into(), |it| it.to_vec()),
        );
        Ok(it.offset.to_js())
    })?;
    set_offset(cx, &mut given.frame, offset)?;
    let global = cx.global();
    for (name, prop) in animatable_members(global, object)? {
        given.frame.values.extend(Standalone::parse(
            prop,
            &member(global, object, &name)?.to_utf8(global)?,
        ));
    }
    Ok(given)
}

/// With the easings that are left over.
fn from_lists<'a>(
    cx: &mut JsScope<'a>,
    object: JsLocal<'a, JSObject>,
) -> Result<'a, (Vec<Given>, Vec<Out>)> {
    let (global, object) = (cx.global(), object.to_js());
    let (composites, mut easings, offsets): (Vec<_>, Vec<Out>, _) =
        BasePropertyIndexedKeyframe::from_js(global, object, |it| {
            let composites = match &it.composite {
                Some(Composites::Many(all)) => all.clone(),
                Some(Composites::One(it)) => vec![*it],
                None => Vec::new(),
            };
            let easings = match &it.easing {
                Some(Easings::Many(all)) => all.iter().map(|it| it.to_vec()).collect(),
                Some(Easings::One(it)) => vec![it.to_vec()],
                None => Vec::new(),
            };
            Ok((composites, easings, it.offset.to_js()))
        })?;
    let listed = List::from_value(list_of(global, offsets)?.to_js());
    let mut all: Vec<(f64, Given)> = Vec::new();
    for (name, prop) in animatable_members(global, object)? {
        let values = list_of(global, member(global, object, &name)?)?
            .values()
            .map(|it| it.to_utf8(global))
            .collect::<JsResult<Vec<_>>>()?;
        for (index, value) in values.iter().enumerate() {
            let at = if values.len() == 1 {
                1.0
            } else {
                index as f64 / (values.len() - 1) as f64
            };
            let place = all
                .binary_search_by(|it| it.0.total_cmp(&at))
                .unwrap_or_else(|place| {
                    all.insert(place, (at, Given::default()));
                    place
                });
            all[place]
                .1
                .frame
                .values
                .extend(Standalone::parse(prop, value));
        }
    }
    for (index, (_, given)) in all.iter_mut().enumerate() {
        set_offset(
            cx,
            &mut given.frame,
            Some(listed.get(index as u32))
                .filter(|it| !it.is_empty())
                .unwrap_or(JSValue::NULL),
        )?;
        if !easings.is_empty() {
            given.easing.clone_from(&easings[index % easings.len()]);
        }
        if !composites.is_empty() {
            given.frame.composite = composites[index % composites.len()].get();
        }
    }
    easings.drain(..all.len().min(easings.len()));
    Ok((all.into_iter().map(|it| it.1).collect(), easings))
}

/// <https://drafts.csswg.org/web-animations/#compute-missing-keyframe-offsets>
fn compute_offsets<'a>(heap: &JsHeap<'a>, all: &mut [Given]) -> Result<'a, ()> {
    let mut plain: Vec<_> = all
        .iter_mut()
        .map(|it| &mut it.frame)
        .filter(|it| it.range.is_none())
        .collect();
    let given = || plain.iter().filter_map(|it| it.offset);
    given().is_sorted().ok_or_else(|| {
        heap.type_error(format_args!(
            "Offsets must be monotonically non-decreasing."
        ))
    })?;
    given().all(|it| (0.0..=1.0).contains(&it)).ok_or_else(|| {
        heap.type_error(format_args!("Offsets must be null or in the range [0,1]."))
    })?;
    let (last, mut known) = (plain.len().saturating_sub(1), (0, 0.0));
    for index in 0..plain.len() {
        let Some(offset) = plain[index]
            .offset
            .or_else(|| (index == last).then_some(1.0))
            .or_else(|| (index == 0).then_some(0.0))
        else {
            continue;
        };
        for between in known.0 + 1..index {
            plain[between].computed_offset = Some(
                known.1
                    + (offset - known.1) * (between - known.0) as f64 / (index - known.0) as f64,
            );
        }
        (plain[index].computed_offset, known) = (Some(offset), (index, offset));
    }
    Ok(())
}

pub(super) fn process<'a>(
    cx: &mut JsScope<'a>,
    keyframes: Keyframes<'a>,
) -> Result<'a, Rc<[Frame]>> {
    let (mut all, unused) = match keyframes {
        Keyframes::None => Default::default(),
        Keyframes::List(list) => (
            list.iter()
                .map(|it| it.map_or_else(|| Ok(Given::default()), |it| from_object(cx, it)))
                .collect::<Result<'a, _>>()?,
            Vec::new(),
        ),
        Keyframes::Indexed(object) => from_lists(cx, object)?,
    };
    compute_offsets(&cx.heap, &mut all)?;
    let frames = all
        .into_iter()
        .map(|it| {
            Ok(Frame {
                easing: parse_easing(&cx.heap, &it.easing)?,
                ..it.frame
            })
        })
        .collect::<Result<'a, _>>()?;
    unused
        .iter()
        .try_for_each(|it| parse_easing(&cx.heap, it).map(drop))?;
    Ok(frames)
}

/// With the digits that it was written with.
pub(super) fn widen(value: f32) -> f64 {
    value.to_string().parse().unwrap_or(f64::NAN)
}

impl From<ComputedKeyframe> for Frame {
    fn from(it: ComputedKeyframe) -> Frame {
        let values = it
            .values
            .into_iter()
            .map(|(prop, value)| Standalone::computed(prop, &value))
            .collect();
        Frame {
            offset: Some(widen(it.offset)),
            range: it.range,
            computed_offset: it.computed_offset.map(widen),
            easing: it.easing,
            composite: it.adds,
            values,
        }
    }
}

impl Frame {
    /// <https://drafts.csswg.org/web-animations/#calculating-computed-keyframes>
    pub(super) fn for_engine(&self, base_url: &Rc<[u8]>) -> Keyframe {
        let weight = |prop: Prop| match prop {
            Prop::Short(index) => {
                crate::shorthand::get(index)
                    .longhands()
                    .iter()
                    .map(|it| {
                        if let Prop::Logical(_) = it {
                            1 << 10
                        } else {
                            2
                        }
                    })
                    .max()
                    .unwrap_or(2)
                    + prop.longhands(Flow::DEFAULT).len()
            }
            Prop::Logical(_) => 1,
            _ => 0,
        };
        let mut values: Vec<_> = self.values.iter().rev().collect();
        bun_collections::index_sort::sort_slice_by_key(&mut values, |it| {
            core::cmp::Reverse(weight(it.prop))
        });
        Keyframe {
            offset: if self.range.is_some() {
                self.offset
            } else {
                self.computed_offset
            }
            .unwrap_or(0.0) as f32,
            range: self.range,
            block: Rc::new(Block::of_declarations(
                values
                    .into_iter()
                    .filter_map(|it| it.declaration.clone())
                    .collect(),
                base_url,
            )),
            easing: Some(self.easing.clone()),
            adds: self.composite,
        }
    }

    pub(super) fn computed_offset(&self) -> Option<f64> {
        self.computed_offset
    }

    pub(super) fn to_js<'a>(
        &self,
        cx: &mut JsScope<'a>,
        computed_offset: Option<f64>,
    ) -> Result<'a, JSValue> {
        let global = cx.global();
        let (heap, number) = (JsHeap::from_global(global), |it: Option<f64>| {
            it.map_or(JSValue::NULL, JSValue::js_number)
        });
        let string = |it: &[u8]| {
            to_js::utf8(heap, it)
                .map(JsLocal::to_js)
                .map_err(|it| it.into_js_error(global))
        };
        let (object, offset) = (
            JSValue::create_empty_object(global, 4 + self.values.len()),
            match self.range {
                Some(range) => super::range::offset_to_js(
                    heap,
                    range.name(),
                    super::percent(heap, self.offset.unwrap_or(0.0) * 100.0),
                ),
                None => number(self.offset),
            },
        );
        object.put(global, b"offset", offset);
        object.put(global, b"easing", string(&self.easing.written())?);
        object.put(
            global,
            b"composite",
            string(self.composite.map_or("auto", Composite::name).as_bytes())?,
        );
        for it in &self.values {
            object.put(global, &member_name(it.prop)[..], string(&it.written)?);
        }
        object.put(global, b"computedOffset", number(computed_offset));
        Ok(object)
    }
}
