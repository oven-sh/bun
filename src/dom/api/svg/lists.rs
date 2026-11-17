//! https://svgwg.org/svg2-draft/types.html#ListInterfaces

use core::ops::Range;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope};

use super::syntax::{Data, Syntax};
use super::values::{Attribute, Owner, READ_ONLY, Value, element_in, transform_in};
use crate::api::core::{DomString, Element, List};
use crate::api::graphics::{Affine, Failure};
use crate::generated_bindgen::geometry::DOMMatrix2DInit;
use crate::generated_bindgen::svg::{
    SVGLength, SVGNumber, SVGPoint, SVGTransform, SVGTransformList, SvgListMembers, js_SVGLength,
    js_SVGLengthList, js_SVGNumber, js_SVGNumberList, js_SVGPoint, js_SVGPointList,
    js_SVGStringList, js_SVGTransform, js_SVGTransformList, js_SvgList,
};

/// The field `items` has `Value`s, or strings.
pub(crate) struct ValueList {
    pub(super) attribute: Attribute,
}

type Item<'a> = bindgen::Result<'a, JSValue>;

impl ValueList {
    pub(super) fn create<'a>(
        heap: &JsHeap<'a>,
        element: &Element,
        attribute: Attribute,
    ) -> &'a ValueList {
        let (syntax, list, items) = (
            attribute.reflected.syntax,
            ValueList { attribute },
            List::new(heap),
        );
        let list: &ValueList = match syntax {
            Syntax::Numbers => js_SVGNumberList::create(heap, list),
            Syntax::Lengths(_) => js_SVGLengthList::create(heap, list),
            Syntax::Transforms => js_SVGTransformList::create(heap, list),
            Syntax::Points => js_SVGPointList::create(heap, list),
            _ => js_SVGStringList::create(heap, list),
        };
        js_SvgList::set_element(list, Some(element));
        js_SvgList::set_items(list, items.to_js());
        list
    }

    pub(super) fn element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        element_in(heap, js_SvgList::element(self).map(|it| it.to_js()))
    }

    fn items(&self) -> List<'_> {
        List::from_value(js_SvgList::items(self).unwrap_or_default())
    }

    fn create_item(&self, heap: &JsHeap<'_>, data: Data) -> JSValue {
        let item: &Value = match data {
            Data::Text(text) => return text.to_js(heap).to_js(),
            Data::Length(_) => js_SVGLength::create(heap, Value::detached(data)),
            Data::Transform(_) => js_SVGTransform::create(heap, Value::detached(data)),
            _ if matches!(self.attribute.reflected.syntax, Syntax::Points) => {
                js_SVGPoint::create(heap, Value::detached(data))
            }
            _ => js_SVGNumber::create(heap, Value::detached(data)),
        };
        item.attach(Owner::List, self.to_js());
        item.to_js()
    }

    fn remove(&self, heap: &JsHeap<'_>, range: Range<u32>) {
        let values = range
            .clone()
            .filter_map(|it| Value::from_js(heap, self.items().get(it)));
        values.for_each(|it| it.attach(Owner::None, JSValue::ZERO));
        self.items()
            .remove_range(heap, range.start, range.len() as u32);
    }

    #[optimize(size)]
    pub(super) fn refresh<'a>(&'a self, cx: &mut JsScope<'a>) {
        let Some(text) = self
            .element(&cx.heap)
            .and_then(|it| self.attribute.take_change(cx, it))
        else {
            return;
        };
        let (heap, items) = (&cx.heap, self.items());
        let parsed = text
            .and_then(|it| self.attribute.reflected.syntax.parse_list(&it))
            .unwrap_or_default();
        self.remove(heap, items.len().min(parsed.len() as u32)..items.len());
        for (index, data) in (0..).zip(parsed) {
            if index == items.len() {
                items.push(heap, self.create_item(heap, data));
            } else if let Some(item) = Value::from_js(heap, items.get(index)) {
                item.data.set(data);
            } else {
                items.set(heap, index, self.create_item(heap, data));
            }
        }
    }

    fn data(&self, heap: &JsHeap<'_>) -> Vec<Data> {
        let text = |item| {
            Some(Data::Text(
                DomString::from_js_string(heap, JsLocal::new(heap, item).as_string()?).ok()?,
            ))
        };
        self.items()
            .values()
            .filter_map(|item| {
                Value::from_js(heap, item)
                    .map_or_else(|| text(item), |it| Some(it.data.get().clone()))
            })
            .collect()
    }

    #[optimize(size)]
    pub(super) fn commit<'a>(&'a self, cx: &mut JsScope<'a>) {
        let text = self
            .attribute
            .reflected
            .syntax
            .serialize_list(&self.data(&cx.heap));
        self.element(&cx.heap)
            .into_iter()
            .for_each(|it| self.attribute.write(cx, it, text.clone()));
    }

    pub(crate) fn get_length<'a>(&'a self, cx: &mut JsScope<'a>) -> u32 {
        self.refresh(cx);
        self.items().len()
    }

    fn convert<'a>(&'a self, cx: &mut JsScope<'a>, item: JsLocal<'a>) -> Item<'a> {
        let is_item = match self.attribute.reflected.syntax {
            Syntax::Numbers => SVGNumber::is,
            Syntax::Lengths(_) => SVGLength::is,
            Syntax::Transforms => SVGTransform::is,
            Syntax::Points => SVGPoint::is,
            _ => return Ok(DomString::from_js(cx, item)?.to_js(&cx.heap).to_js()),
        };
        match is_item(item.to_js()) {
            true => Ok(item.to_js()),
            false => {
                Err(Failure::Type("The item is not of the type of the list.").into_error(&cx.heap))
            }
        }
    }

    /// It, or a copy if it belongs to something else.
    fn adopt<'a>(&'a self, cx: &mut JsScope<'a>, item: JSValue) -> JSValue {
        let Some(value) = Value::from_js(&cx.heap, item) else {
            return item;
        };
        let mut data = value.read(cx);
        if let (Data::Length(length), Syntax::Lengths(axis)) =
            (&mut data, self.attribute.reflected.syntax)
        {
            length.axis = axis;
        }
        if value.owner.get() != Owner::None {
            return self.create_item(&cx.heap, data);
        }
        value.data.set(data);
        value.attach(Owner::List, self.to_js());
        item
    }

    /// `range` gets the length. Answers with what it has added, or else with the first that it has removed.
    #[optimize(size)]
    fn splice<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        added: Option<JsLocal<'a>>,
        range: impl FnOnce(u32) -> Result<Range<u32>, Failure>,
    ) -> Item<'a> {
        let added = added.map(|it| self.convert(cx, it)).transpose()?;
        let range = if self.attribute.is_animated {
            Err(READ_ONLY)
        } else {
            range(self.get_length(cx))
        };
        let range = range.map_err(|it| it.into_error(&cx.heap))?;
        let added = added.map(|it| self.adopt(cx, it));
        let (items, start) = (self.items(), range.start);
        let removed = if range.is_empty() {
            JSValue::UNDEFINED
        } else {
            items.get(start)
        };
        self.remove(&cx.heap, range);
        if let Some(added) = added {
            items.push(&cx.heap, added);
            (start..items.len() - 1)
                .rev()
                .for_each(|it| items.set(&cx.heap, it + 1, items.get(it)));
            items.set(&cx.heap, start, added);
        }
        self.commit(cx);
        Ok(added.unwrap_or(removed))
    }

    fn item<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Option<JSValue> {
        (index < self.get_length(cx)).then(|| self.items().get(index))
    }

    pub(crate) fn indexed_length(&self) -> u32 {
        let global = js_SvgList::element(self).map(|it| it.doc().global().as_mut_ptr());
        // SAFETY: the engine asks for the names of the properties, which may run scripts. It is in its cell.
        global.map_or(0, |it| unsafe {
            JsScope::with(it, |cx| {
                ValueList::from_js_unchecked(self.to_js()).get_length(cx)
            })
        })
    }

    pub(crate) fn indexed_get<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> bindgen::Result<'a, Option<JSValue>> {
        Ok(self.item(cx, index))
    }

    pub(crate) fn indexed_set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
        item: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        self.splice(cx, Some(item), one(index)).map(drop)
    }
}

const OUT_OF_RANGE: Failure = Failure::index_size("The index provided is out of range.");

fn one(index: u32) -> impl FnOnce(u32) -> Result<Range<u32>, Failure> {
    move |length| {
        if index < length {
            Ok(index..index + 1)
        } else {
            Err(OUT_OF_RANGE)
        }
    }
}

impl SvgListMembers {
    pub(crate) fn get_length<'a>(&'a self, cx: &mut JsScope<'a>) -> u32 {
        ValueList::get_length(self, cx)
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, ()> {
        self.splice(cx, None, |length| Ok(0..length)).map(drop)
    }

    pub(crate) fn initialize<'a>(&'a self, cx: &mut JsScope<'a>, item: JsLocal<'a>) -> Item<'a> {
        self.splice(cx, Some(item), |length| Ok(0..length))
    }

    pub(crate) fn get_item<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<JSValue, Failure> {
        self.item(cx, index).ok_or(OUT_OF_RANGE)
    }

    pub(crate) fn insert_item_before<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        item: JsLocal<'a>,
        index: u32,
    ) -> Item<'a> {
        self.splice(cx, Some(item), |length| {
            Ok(index.min(length)..index.min(length))
        })
    }

    pub(crate) fn replace_item<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        item: JsLocal<'a>,
        index: u32,
    ) -> Item<'a> {
        self.splice(cx, Some(item), one(index))
    }

    pub(crate) fn remove_item<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Item<'a> {
        self.splice(cx, None, one(index))
    }

    pub(crate) fn append_item<'a>(&'a self, cx: &mut JsScope<'a>, item: JsLocal<'a>) -> Item<'a> {
        self.splice(cx, Some(item), |length| Ok(length..length))
    }
}

impl SVGTransformList {
    pub(crate) fn create_svg_transform_from_matrix<'a>(
        &self,
        heap: &JsHeap<'a>,
        matrix: &DOMMatrix2DInit,
    ) -> Result<&'a SVGTransform, Failure> {
        Ok(SVGTransform::new(heap, Affine::from_init(matrix)?))
    }

    pub(crate) fn consolidate<'a>(&'a self, cx: &mut JsScope<'a>) -> Item<'a> {
        if !self.attribute.is_animated && self.get_length(cx) == 0 {
            return Ok(JSValue::NULL);
        }
        let product = self
            .data(&cx.heap)
            .iter()
            .fold(Affine::default(), |all, it| {
                all.then(transform_in(it).matrix.0)
            });
        let product = SVGTransform::new(&cx.heap, product)
            .as_object(&cx.heap)
            .as_value();
        self.splice(cx, Some(product), |length| Ok(0..length))
    }
}
