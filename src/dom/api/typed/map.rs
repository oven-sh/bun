//! <https://drafts.css-houdini.org/css-typed-om/#the-stylepropertymap>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{Callable, JsHeap, JsInterface, JsList, JsLocal, JsScope, Result, to_js};
use bun_jsc::{JSObject, JSValue};

use super::CSSStyleValue;
use super::reify::{self, valid_property};
use crate::api::core::{DomString, Edge, List};
use crate::api::cssom::{CSSStyleDeclaration, get_computed_style, inline_style};
use crate::calc::Node;
use crate::cssom::segments;
use crate::declarations::Key;
use crate::generated_bindgen::typed::*;
use crate::properties::Prop;
use crate::values::Out;

enum Given {
    Number(Node),
    Keyword(Out),
    Unparsed(Out),
}

/// The values that were set last, with the source of the declaration that each has led to.
#[derive(Default)]
pub(crate) struct StylePropertyMapReadOnly(RefCell<Vec<(Prop, Out, Given)>>);

impl StylePropertyMapReadOnly {
    fn style(&self) -> &CSSStyleDeclaration {
        js_StylePropertyMapReadOnly::style(self).expect("it is made with one")
    }

    fn specified(&self, prop: Prop) -> Option<Option<[Out; 2]>> {
        self.style().read(|it| {
            Some(
                it.get_with_source(Key::Property(prop))?
                    .map(|it| it.into_owned()),
            )
        })
    }

    fn values_of<'a>(&'a self, cx: &mut JsScope<'a>, prop: Prop) -> Result<'a, List<'a>> {
        let Some(specified) = self.specified(prop) else {
            let computed = self.style().computed_value(cx, prop);
            let heap = self.realm(&cx.heap);
            return Ok(match computed {
                Some((value, syntax)) if syntax.is_empty() => {
                    reify::reify(heap, prop, &value, &value)
                }
                Some((value, syntax)) => reify::reify_registered(heap, prop, &value, &syntax),
                None => List::new(heap),
            });
        };
        let heap = self.realm(&cx.heap);
        let Some([serialized, source]) = specified else {
            return Ok(List::new(heap));
        };
        let value = match self
            .0
            .borrow()
            .iter()
            .find(|it| it.0 == prop && it.1 == source)
            .map(|it| &it.2)
        {
            Some(Given::Number(it)) => CSSNumericValue::of_node(heap, it)?.to_js(),
            Some(Given::Keyword(it)) => CSSKeywordValue::new(heap, it).to_js(),
            Some(Given::Unparsed(it)) => CSSUnparsedValue::reify(heap, &segments(it)).to_js(),
            None => return Ok(reify::reify(heap, prop, &serialized, &source)),
        };
        Ok(List::from_fn(heap, 1, |_| value))
    }

    fn entry_at<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> Result<'a, Option<[JSValue; 2]>> {
        let Some(key @ Key::Property(prop)) = self.style().key_at(cx, index) else {
            return Ok(None);
        };
        Ok(Some([
            to_js::utf8(&cx.heap, &*key.name())?.to_js(),
            self.values_of(cx, prop)?.to_js(),
        ]))
    }

    fn iterate<'a>(&self, heap: &JsHeap<'a>, yields: Yields) -> &'a StylePropertyMapIterator {
        let made = js_StylePropertyMapIterator::create(
            self.realm(heap),
            StylePropertyMapIterator(yields, Cell::new(0)),
        );
        js_StylePropertyMapIterator::set_map(made, Some(self));
        made
    }

    pub(crate) fn entries<'a>(&self, heap: &JsHeap<'a>) -> &'a StylePropertyMapIterator {
        self.iterate(heap, Yields::Entries)
    }

    pub(crate) fn keys<'a>(&self, heap: &JsHeap<'a>) -> &'a StylePropertyMapIterator {
        self.iterate(heap, Yields::Keys)
    }

    pub(crate) fn values<'a>(&self, heap: &JsHeap<'a>) -> &'a StylePropertyMapIterator {
        self.iterate(heap, Yields::Values)
    }

    pub(crate) fn for_each<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        callback: JsLocal<'a, Callable>,
        this: JsLocal<'a>,
    ) -> Result<'a, ()> {
        let mut index = 0;
        while let Some([name, values]) = self.entry_at(cx, index)? {
            let arguments = [values, name, self.to_js()].map(|it| JsLocal::new(&cx.heap, it));
            callback.call(cx, this, &arguments)?;
            index += 1;
        }
        Ok(())
    }

    pub(crate) fn get<'a>(&'a self, cx: &mut JsScope<'a>, property: &[u8]) -> Result<'a, JSValue> {
        let prop = valid_property(&cx.heap, property)?;
        Ok(self
            .values_of(cx, prop)?
            .values()
            .next()
            .unwrap_or(JSValue::UNDEFINED))
    }

    pub(crate) fn get_all<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: &[u8],
    ) -> Result<'a, JSValue> {
        let prop = valid_property(&cx.heap, property)?;
        Ok(self.values_of(cx, prop)?.to_js())
    }

    pub(crate) fn has<'a>(&'a self, cx: &mut JsScope<'a>, property: &[u8]) -> Result<'a, bool> {
        let prop = valid_property(&cx.heap, property)?;
        Ok(self.specified(prop).map_or_else(
            || self.style().computed_value(cx, prop).is_some(),
            |it| it.is_some(),
        ))
    }

    pub(crate) fn get_size<'a>(&'a self, cx: &mut JsScope<'a>) -> u32 {
        self.style().get_length(cx)
    }
}

#[derive(Clone, Copy)]
enum Yields {
    Entries,
    Keys,
    Values,
}

pub(crate) struct StylePropertyMapIterator(Yields, Cell<u32>);

impl StylePropertyMapIterator {
    pub(crate) fn next<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JsLocal<'a, JSObject>> {
        let entry = js_StylePropertyMapIterator::map(self)
            .expect("it is made with one")
            .entry_at(cx, self.1.get())?;
        self.1.set(self.1.get() + u32::from(entry.is_some()));
        let heap = self.realm(&cx.heap);
        Ok(heap.create_iterator_result(entry.map(|entry| match self.0 {
            Yields::Entries => List::from_fn(heap, 2, |it| entry[it as usize]).to_js(),
            Yields::Keys => entry[0],
            Yields::Values => entry[1],
        })))
    }
}

fn source_of<'a>(
    heap: &JsHeap<'a>,
    prop: Prop,
    value: &ValueOrText<'a>,
    is_alone: bool,
) -> Result<'a, Out> {
    let source = match value {
        ValueOrText::Value(it) => reify::from_value(heap, prop, it, is_alone),
        ValueOrText::Text(it) => reify::from_text(
            prop,
            DomString::from_js_string(heap, *it)?.to_utf8().as_bytes(),
            is_alone,
        ),
    };
    source.ok_or_else(|| heap.type_error(format_args!("Invalid type for property")))
}

impl StylePropertyMap {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, style: &CSSStyleDeclaration) -> &'a Self {
        let made = js_StylePropertyMap::create(heap, StylePropertyMapReadOnly::default());
        js_StylePropertyMapReadOnly::set_style(made, Some(style));
        made
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: &[u8],
        values: JsList<'a, ValueOrText<'a>>,
    ) -> Result<'a, ()> {
        let (heap, is_alone) = (&cx.heap, values.len() == 1);
        let prop = valid_property(heap, property)?;
        (is_alone || values.len() > 1 && reify::is_list(prop))
            .ok_or_else(|| heap.type_error(format_args!("Invalid type for property")))?;
        let source = values
            .iter()
            .map(|it| source_of(heap, prop, &it, is_alone))
            .collect::<Result<'a, Vec<_>>>()?
            .join(&b", "[..]);
        let given = match values.iter().next().filter(|_| is_alone) {
            Some(ValueOrText::Value(value)) => match value {
                CSSStyleValue::Unit(..) if source.starts_with(b"calc(") => {
                    Some(Given::Number(Node::Sum(vec![value.node(heap)])))
                }
                CSSStyleValue::Unit(..) | CSSStyleValue::Math(_) => {
                    Some(Given::Number(value.node(heap)))
                }
                CSSStyleValue::Keyword(it) if reify::is_only_set_typed(prop) => {
                    Some(Given::Keyword(it.borrow().to_ascii_lowercase()))
                }
                _ => value
                    .is_a::<CSSUnparsedValue>()
                    .then(|| Given::Unparsed(source.clone())),
            },
            _ => None,
        };
        self.style().set(
            cx,
            Key::Property(prop),
            if source.is_empty() { b" " } else { &source },
            false,
        );
        let StylePropertyMapReadOnly(known) = &**self;
        known.borrow_mut().retain(|it| it.0 != prop);
        known.borrow_mut().extend(
            given
                .zip(self.specified(prop).flatten())
                .map(|(given, [_, source])| (prop, source, given)),
        );
        Ok(())
    }

    pub(crate) fn append<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: &[u8],
        values: JsList<'a, ValueOrText<'a>>,
    ) -> Result<'a, ()> {
        let prop = valid_property(&cx.heap, property)?;
        reify::is_list(prop).ok_or_else(|| {
            cx.heap
                .type_error(format_args!("Property does not support multiple values"))
        })?;
        let is_pending = self
            .style()
            .read(|it| it.has(Key::Property(prop)) && it.get(Key::Property(prop)).is_empty())
            == Some(true);
        (!is_pending).ok_or_else(|| {
            cx.heap.type_error(format_args!(
                "Cannot append to a list containing a variable reference"
            ))
        })?;
        let old = self
            .values_of(cx, prop)?
            .values()
            .filter_map(|it| CSSStyleValue::from_js(&cx.heap, it))
            .map(ValueOrText::Value);
        let all = old
            .chain(values.iter())
            .map(|it| source_of(&cx.heap, prop, &it, false))
            .collect::<Result<'a, Vec<_>>>()?;
        if values.len() > 0 {
            self.style()
                .set(cx, Key::Property(prop), &all.join(&b", "[..]), false);
        }
        Ok(())
    }

    pub(crate) fn delete<'a>(&'a self, cx: &mut JsScope<'a>, property: &[u8]) -> Result<'a, ()> {
        let prop = valid_property(&cx.heap, property)?;
        self.style().remove(cx, Key::Property(prop));
        Ok(())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.style().replace(cx, b"");
    }
}

impl ElementInlineStyleMap {
    pub(crate) fn get_attribute_style_map<'a>(&'a self, heap: &JsHeap<'a>) -> &'a StylePropertyMap {
        let map = self.same_object(heap, Edge::StyleMap, || {
            StylePropertyMap::new(self.realm(heap), inline_style(heap, self)).to_js()
        });
        StylePropertyMap::from_js(heap, map).expect("it was made")
    }
}

impl ElementStyleMap {
    pub(crate) fn computed_style_map<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::ComputedStyleMap, || {
            let made = js_StylePropertyMapReadOnly::create(
                self.realm(heap),
                StylePropertyMapReadOnly::default(),
            );
            js_StylePropertyMapReadOnly::set_style(
                made,
                Some(get_computed_style(heap, self, None)),
            );
            made.to_js()
        })
    }
}
