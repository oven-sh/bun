//! <https://drafts.css-houdini.org/css-typed-om/>

mod map;
mod math;
pub(crate) mod numeric;
mod reify;
mod transform;

use core::cell::{Cell, RefCell};

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsList, JsLocal, Result};

pub(crate) use map::{StylePropertyMapIterator, StylePropertyMapReadOnly};
use numeric::Reader;
pub(crate) use transform::CSSTransformComponent;

use crate::api::core::{DomString, List, global_of};
use crate::calc::{Kind, Unit};
use crate::cssom::Segment;
use crate::generated_bindgen::typed::*;
pub(crate) use crate::generated_bindgen::typed::{CSSNumericValue, StylePropertyMap};
use crate::prelude::written;
use crate::properties::Prop;
use crate::values::{Out, text, write_ident};

const MAX_DEPTH: usize = 200;
const MAX_LENGTH: usize = 1 << 24;

pub(crate) enum CSSStyleValue {
    /// What has no class of its own, or an image.
    Plain(Prop, Out),
    Keyword(RefCell<Out>),
    Unit(Cell<f64>, Unit),
    Math(math::Operation),
    /// All of it is in the fields.
    Compound,
}

impl CSSStyleValue {
    fn slot(&self, index: usize) -> JSValue {
        [
            js_CSSStyleValue::first,
            js_CSSStyleValue::second,
            js_CSSStyleValue::third,
        ][index](self)
        .unwrap_or(JSValue::UNDEFINED)
    }

    fn set_slot(&self, index: usize, value: JSValue) {
        [
            js_CSSStyleValue::set_first,
            js_CSSStyleValue::set_second,
            js_CSSStyleValue::set_third,
        ][index](self, value);
    }

    fn items(&self) -> List<'_> {
        List::from_value(self.slot(0))
    }

    /// <https://webidl.spec.whatwg.org/#dfn-set-the-value-of-a-new-indexed-property>
    fn set_item<'a>(&self, heap: &JsHeap<'a>, index: u32, value: JSValue) -> Result<'a, ()> {
        match index.cmp(&self.items().len()) {
            core::cmp::Ordering::Less => self.items().set(heap, index, value),
            core::cmp::Ordering::Equal => self.items().push(heap, value),
            core::cmp::Ordering::Greater => {
                return Err(
                    heap.range_error(format_args!("The index provided is outside the range."))
                );
            }
        }
        Ok(())
    }

    fn write<'a>(&'a self, heap: &JsHeap<'a>, reader: Reader, out: &mut Out) {
        match self {
            CSSStyleValue::Plain(_, it) => out.extend(it),
            CSSStyleValue::Keyword(it) => write_ident(&it.borrow(), out),
            CSSStyleValue::Unit(..) | CSSStyleValue::Math(_) => {
                numeric::write(&self.node(heap), reader, out)
            }
            CSSStyleValue::Compound => match (
                self.downcast::<CSSUnparsedValue>(),
                self.downcast::<CSSTransformValue>(),
            ) {
                (Some(unparsed), _) => unparsed.write_segments(heap, &mut Vec::new(), out),
                (_, Some(transform)) => transform.write_components(heap, reader, out),
                _ => {
                    for (index, it) in (0..2)
                        .filter_map(|it| CSSStyleValue::from_js(heap, self.slot(it)))
                        .enumerate()
                    {
                        out.extend_from_slice(&b" "[..index]);
                        it.write(heap, reader, out);
                    }
                }
            },
        }
    }

    pub(crate) fn stringify(&self, heap: &JsHeap<'_>) -> Out {
        written(|out| self.write(JsHeap::from_global(global_of(heap)), Reader::Script, out))
    }

    pub(crate) fn parse<'a>(
        heap: &JsHeap<'a>,
        property: &[u8],
        source: &[u8],
    ) -> Result<'a, &'a Self> {
        Ok(Self::from_js(
            heap,
            reify::parse(heap, reify::valid_property(heap, property)?, source)?.get(0),
        )
        .expect("the list is not empty"))
    }

    pub(crate) fn parse_all<'a>(
        heap: &JsHeap<'a>,
        property: &[u8],
        source: &[u8],
    ) -> Result<'a, impl Iterator<Item = JSValue> + use<'a>> {
        Ok(reify::parse(heap, reify::valid_property(heap, property)?, source)?.values())
    }
}

impl HasItems {
    pub(crate) fn get_length(&self) -> u32 {
        self.items().len()
    }
}

impl CSSKeywordValue {
    fn new<'a>(heap: &JsHeap<'a>, value: &[u8]) -> &'a Self {
        js_CSSKeywordValue::create(heap, CSSStyleValue::Keyword(value.to_vec().into()))
    }

    fn check<'a>(heap: &JsHeap<'a>, value: &[u8]) -> Result<'a, Out> {
        (!value.is_empty()).then(|| value.to_vec()).ok_or_else(|| {
            heap.type_error(format_args!(
                "CSSKeywordValue does not support empty strings"
            ))
        })
    }

    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, value: &[u8]) -> Result<'a, CSSStyleValue> {
        Ok(CSSStyleValue::Keyword(Self::check(heap, value)?.into()))
    }

    pub(crate) fn get_value<'a>(&'a self, _: &JsHeap<'a>) -> Result<'a, Out> {
        Ok(if let CSSStyleValue::Keyword(it) = &**self {
            it.borrow().clone()
        } else {
            Out::new()
        })
    }

    pub(crate) fn set_value<'a>(&self, heap: &JsHeap<'a>, value: &[u8]) -> Result<'a, ()> {
        if let CSSStyleValue::Keyword(it) = &**self {
            it.replace(Self::check(heap, value)?);
        }
        Ok(())
    }
}

pub(crate) struct CSSVariableReferenceValue(RefCell<Out>);

impl CSSVariableReferenceValue {
    fn check<'a>(heap: &JsHeap<'a>, name: &[u8]) -> Result<'a, Out> {
        name.starts_with(b"--")
            .then(|| name.to_vec())
            .ok_or_else(|| heap.type_error(format_args!("Invalid custom property name")))
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        variable: &[u8],
        fallback: Option<&'a CSSUnparsedValue>,
    ) -> Result<'a, &'a Self> {
        let made = structure.create(
            heap,
            CSSVariableReferenceValue(Self::check(heap, variable)?.into()),
        );
        js_CSSVariableReferenceValue::set_fallback(made, fallback);
        Ok(made)
    }

    pub(crate) fn get_variable<'a>(&self, _: &JsHeap<'a>) -> Result<'a, Out> {
        Ok(self.0.borrow().clone())
    }

    pub(crate) fn set_variable<'a>(&self, heap: &JsHeap<'a>, value: &[u8]) -> Result<'a, ()> {
        self.0.replace(Self::check(heap, value)?);
        Ok(())
    }
}

impl CSSUnparsedSegment<'_> {
    fn value(&self) -> JSValue {
        match self {
            CSSUnparsedSegment::Variable(it) => it.to_js(),
            CSSUnparsedSegment::Text(it) => it.to_js(),
        }
    }
}

impl CSSUnparsedValue {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        members: JsList<'a, CSSUnparsedSegment<'a>>,
    ) -> Result<'a, &'a Self> {
        let (made, items) = (
            structure.create(heap, CSSStyleValue::Compound),
            List::new(heap),
        );
        made.set_slot(0, items.to_js());
        members.iter().for_each(|it| items.push(heap, it.value()));
        Ok(made)
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#reify-a-list-of-component-values>
    fn reify<'a>(heap: &JsHeap<'a>, segments: &[Segment<'_>]) -> &'a Self {
        let (made, items) = (
            js_CSSUnparsedValue::create(heap, CSSStyleValue::Compound),
            List::new(heap),
        );
        made.set_slot(0, items.to_js());
        for segment in segments {
            items.push(
                heap,
                match segment {
                    Segment::Text(it) => DomString::from_utf8(text(it)).to_js(heap).to_js(),
                    Segment::Variable(name, fallback) => {
                        let reference = js_CSSVariableReferenceValue::create(
                            heap,
                            CSSVariableReferenceValue(name.clone().into()),
                        );
                        js_CSSVariableReferenceValue::set_fallback(
                            reference,
                            fallback.as_ref().map(|it| Self::reify(heap, it)),
                        );
                        reference.to_js()
                    }
                },
            );
        }
        made
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.items().len()
    }

    pub(crate) fn indexed_get<'a>(
        &self,
        _: &JsHeap<'a>,
        index: u32,
    ) -> Result<'a, Option<JSValue>> {
        Ok(Some(self.items().get(index)).filter(|it| !it.is_empty()))
    }

    pub(crate) fn indexed_set<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: u32,
        value: CSSUnparsedSegment<'a>,
    ) -> Result<'a, ()> {
        self.set_item(heap, index, value.value())
    }

    /// <https://drafts.css-houdini.org/css-typed-om/#unparsedvalue-serialization>
    fn write_segments<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        outer: &mut Vec<*const Self>,
        out: &mut Out,
    ) {
        if outer.len() >= MAX_DEPTH
            || out.len() >= MAX_LENGTH
            || outer.contains(&core::ptr::from_ref(self))
        {
            return;
        }
        outer.push(self);
        let mut is_after_text = false;
        for item in self.items().values() {
            let reference = CSSVariableReferenceValue::from_js(heap, item);
            let would_join = reference.is_none()
                || out.last().is_some_and(|it| {
                    it.is_ascii_alphanumeric() || matches!(it, b'_' | b'-' | b'@' | b'#' | 0x80..)
                });
            out.extend_from_slice(if is_after_text && would_join {
                b"/**/"
            } else {
                b""
            });
            is_after_text = reference.is_none();
            let Some(reference) = reference else {
                let string = JsLocal::new(heap, item)
                    .as_string()
                    .and_then(|it| DomString::from_js_string(heap, it).ok());
                out.extend(string.unwrap_or_default().to_utf8().bytes());
                continue;
            };
            out.extend([b"var(", &reference.0.borrow()[..]].concat());
            if let Some(fallback) = js_CSSVariableReferenceValue::fallback(reference) {
                out.push(b',');
                fallback.write_segments(heap, outer, out);
            }
            out.push(b')');
        }
        outer.pop();
    }
}

impl Coordinate {
    pub(crate) fn get<'a>(&self, _: &JsHeap<'a>, index: usize) -> Result<'a, JSValue> {
        Ok(self.slot(index))
    }

    pub(crate) fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        index: usize,
        value: &'a CSSNumericValue,
    ) -> Result<'a, ()> {
        value
            .numeric_type()
            .matches_or_percentage(Kind::Length)
            .ok_or_else(|| heap.type_error(format_args!("Must pass length or percentage.")))?;
        self.set_slot(index, value.to_js());
        Ok(())
    }
}

impl CSSPositionValue {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        x: &'a CSSNumericValue,
        y: &'a CSSNumericValue,
    ) -> Result<'a, &'a Self> {
        let is_valid = [x, y]
            .iter()
            .all(|it| it.numeric_type().matches_or_percentage(Kind::Length));
        is_valid.ok_or_else(|| heap.type_error(format_args!("Must pass length or percentage.")))?;
        let made = structure.create(heap, CSSStyleValue::Compound);
        made.set_slot(0, x.to_js());
        made.set_slot(1, y.to_js());
        Ok(made)
    }
}
