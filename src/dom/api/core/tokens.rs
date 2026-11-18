//! `DOMTokenList`, `NamedNodeMap` and `DOMStringMap`

use core::cell::RefCell;

use bun_core::{WTFStringImplStruct as Impl, strings};
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope, JsStringImpl, PropertyNames};
use bun_jsc::{JSString, JSValue};
use smallvec::SmallVec;

use super::*;
use crate::generated_bindgen::collections::{
    DOMStringMap, NamedNodeMap, js_DOMStringMap, js_DOMTokenList, js_NamedNodeMap,
};

type Str<'a> = JsLocal<'a, JSString>;
type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Tokens = SmallVec<[DomString; 8]>;

pub(crate) struct DOMTokenList {
    attribute: Known,
    supported: Option<&'static [&'static str]>,
    /// The value of the attribute, and its set.
    parsed: RefCell<(DomString, Vec<DomString>)>,
}

fn distinct(tokens: impl Iterator<Item = DomString>) -> Tokens {
    const FEW: usize = 32;
    let (mut all, mut seen) = (Tokens::new(), crate::name::Set::default());
    for token in tokens {
        if all.len() == FEW && seen.is_empty() {
            seen.extend(all.iter().cloned());
        }
        if if all.len() < FEW {
            !all.contains(&token)
        } else {
            seen.insert(token.clone())
        } {
            all.push(token);
        }
    }
    all
}

fn validate<'a>(heap: &JsHeap<'a>, token: &DomString) -> Result<'a> {
    if token.is_empty() {
        return Err(dom_error(
            heap,
            DomError::SyntaxError,
            "The token provided must not be empty.",
        ));
    }
    if token.units().any(is_ascii_whitespace) {
        return Err(dom_error(
            heap,
            DomError::InvalidCharacterError,
            &format!(
                "The token provided ('{}') contains HTML space characters.",
                token.to_utf8()
            ),
        ));
    }
    Ok(())
}

fn convert<'a>(cx: Cx<'_, 'a>, values: &[JsLocal<'a>]) -> Result<'a, Tokens> {
    let tokens = values
        .iter()
        .map(|it| DomString::from_js(cx, *it))
        .collect::<Result<'a, Tokens>>()?;
    tokens.iter().try_for_each(|it| validate(&cx.heap, it))?;
    Ok(tokens)
}

impl DOMTokenList {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        element: &'a Element,
        attribute: Known,
        supported: Option<&'static [&'static str]>,
    ) -> &'a DOMTokenList {
        let made = js_DOMTokenList::create(
            element.doc().realm(heap),
            DOMTokenList {
                attribute,
                supported,
                parsed: RefCell::default(),
            },
        );
        js_DOMTokenList::set_element(made, Some(element));
        made
    }

    fn element(&self) -> &Element {
        js_DOMTokenList::element(self).expect("set when it is made")
    }

    fn value(&self) -> DomString {
        self.element().attr(self.attribute).unwrap_or_default()
    }

    fn with_tokens<R>(&self, read: impl FnOnce(&[DomString]) -> R) -> R {
        let (value, mut parsed) = (self.value(), self.parsed.borrow_mut());
        if value != parsed.0 {
            *parsed = (value.clone(), distinct(value.tokens()).into_vec());
        }
        read(&parsed.1)
    }

    fn update<'a>(&'a self, cx: Cx<'_, 'a>, tokens: impl Iterator<Item = DomString>) {
        self.write(cx, &distinct(tokens));
    }

    fn write<'a>(&'a self, cx: Cx<'_, 'a>, tokens: &[DomString]) {
        if tokens.is_empty() && !self.element().has_attr(self.attribute) {
            return;
        }
        let mut value =
            StringBuilder::with_capacity(tokens.iter().map(|it| it.len() as usize + 1).sum());
        for (index, token) in tokens.iter().enumerate() {
            if index > 0 {
                value.push_unit(0x20);
            }
            value.push(token);
        }
        self.element().set_attr(cx, self.attribute, value.finish());
    }

    /// Whether that was possible without taking the value apart.
    fn put_in_class<'a>(&'a self, cx: Cx<'_, 'a>, token: &DomString, wanted: bool) -> bool {
        let (element, space) = (self.element(), b" ".as_slice());
        let is_tidy = |value: &DomString| {
            element.with(|it| {
                it.classes
                    .as_ref()
                    .is_some_and(|it| it.source.string() == value && it.is_tidy())
            })
        };
        let (value, Some(token)) = (self.value(), token.latin1()) else {
            return false;
        };
        let Some(all) = value
            .latin1()
            .filter(|_| self.attribute == atom!("class") && is_tidy(&value))
        else {
            return false;
        };
        let mut end = 0;
        let has = strings::split(all, space).any(|it| {
            end += it.len() + 1;
            it == token
        });
        let new = match (has, wanted) {
            (false, true) => DomString::from_latin1_parts([all, space, token].into_iter()),
            (true, false) if end > all.len() => {
                DomString::from_latin1(&all[..(all.len() - token.len()).saturating_sub(1)])
            }
            (true, false) => DomString::from_latin1_parts(
                [&all[..end - 1 - token.len()], &all[end..]].into_iter(),
            ),
            _ => value.clone(),
        };
        element.set_attr(cx, self.attribute, new.clone());
        element.with(|it| {
            it.classes
                .iter()
                .filter(|it| !new.is_empty() && *it.source.string() == new)
                .for_each(|it| it.note_tidiness())
        });
        true
    }

    pub(crate) fn contains(&self, token: &DomString) -> bool {
        self.element()
            .with_attr_string(self.attribute, |it| it.has_token(token, false))
            == Some(true)
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.with_tokens(<[_]>::len) as u32
    }

    pub(crate) fn indexed_get<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<Str<'a>> {
        self.with_tokens(|it| it.get(index as usize).cloned())
            .map(|it| it.to_js(heap))
    }

    pub(crate) fn get_value<'a>(&'a self, heap: &JsHeap<'a>) -> Str<'a> {
        self.value().to_js(heap)
    }

    pub(crate) fn set_value<'a>(&'a self, cx: Cx<'_, 'a>, value: JsStringImpl<'a>) {
        self.element()
            .set_attr(cx, self.attribute, DomString::from_impl(value.get()));
    }

    pub(crate) fn js_contains(&self, token: JsStringImpl<'_>) -> bool {
        self.contains(&DomString::from_impl(token.get()))
    }

    pub(crate) fn add<'a>(&'a self, cx: Cx<'_, 'a>, tokens: &[JsLocal<'a>]) -> Result<'a> {
        let tokens = convert(cx, tokens)?;
        if !matches!(&*tokens, [only] if self.put_in_class(cx, only, true)) {
            self.update(cx, self.value().tokens().chain(tokens));
        }
        Ok(())
    }

    pub(crate) fn remove<'a>(&'a self, cx: Cx<'_, 'a>, tokens: &[JsLocal<'a>]) -> Result<'a> {
        let tokens = convert(cx, tokens)?;
        if !matches!(&*tokens, [only] if self.put_in_class(cx, only, false)) {
            self.update(cx, self.value().tokens().filter(|it| !tokens.contains(it)));
        }
        Ok(())
    }

    pub(crate) fn toggle<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        token: JsStringImpl<'a>,
        force: Option<bool>,
    ) -> Result<'a, bool> {
        let token = DomString::from_impl(token.get());
        validate(&cx.heap, &token)?;
        let has = self.contains(&token);
        let wanted = force.unwrap_or(!has);
        if wanted != has && !self.put_in_class(cx, &token, wanted) {
            self.update(
                cx,
                self.value()
                    .tokens()
                    .filter(|it| *it != token)
                    .chain(wanted.then(|| token.clone())),
            );
        }
        Ok(wanted)
    }

    pub(crate) fn replace<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        token: JsStringImpl<'a>,
        with: JsStringImpl<'a>,
    ) -> Result<'a, bool> {
        let (token, with) = (
            DomString::from_impl(token.get()),
            DomString::from_impl(with.get()),
        );
        [&with]
            .into_iter()
            .filter(|it| it.is_empty())
            .chain([&token, &with])
            .try_for_each(|it| validate(&cx.heap, it))?;
        let has = self.contains(&token);
        if has {
            self.update(
                cx,
                self.value()
                    .tokens()
                    .map(|it| if it == token { with.clone() } else { it }),
            );
        }
        Ok(has)
    }

    pub(crate) fn supports<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        token: JsStringImpl<'a>,
    ) -> Result<'a, bool> {
        let supported = self.supported.ok_or_else(|| {
            heap.type_error(format_args!("DOMTokenList has no supported tokens."))
        })?;
        let token = DomString::from_impl(token.get());
        Ok(supported.iter().any(|it| token.eq_ignore_ascii_case(it)))
    }
}

impl NamedNodeMap {
    pub(crate) fn element(&self) -> &Element {
        js_NamedNodeMap::element(self).expect("set when it is made")
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.element().attr_count()
    }

    pub(crate) fn indexed_get<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a Attr> {
        self.element().attr_node_at(heap, index)
    }

    pub(crate) fn named_get<'a>(&'a self, heap: &JsHeap<'a>, name: &Impl) -> Option<&'a Attr> {
        let (element, name) = (self.element(), Atom::from_impl(name));
        let found = element
            .attr_name_by_qualified_name(&name)
            .filter(|_| !element.ignores_case() || name.to_ascii_lowercase() == name);
        Some(element.attr_node(heap, found?))
    }

    pub(crate) fn named_keys<'a>(&'a self, _: &JsHeap<'a>, names: &mut PropertyNames) {
        let all = self
            .element()
            .attrs()
            .into_iter()
            .map(|it| it.0.qualified());
        all.filter(|it| !self.element().ignores_case() || it.to_ascii_lowercase() == *it)
            .for_each(|it| names.add(it.as_impl()));
    }

    pub(crate) fn get_named_item<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Str<'a>,
    ) -> Result<'a, Option<&'a Attr>> {
        self.element().get_attribute_node(heap, name)
    }

    pub(crate) fn get_named_item_ns<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, Option<&'a Attr>> {
        self.element().get_attribute_node_ns(heap, ns, local)
    }

    pub(crate) fn set_named_item<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        attr: &'a Attr,
    ) -> Result<'a, Option<&'a Attr>> {
        self.element().set_attr_node(cx, attr)
    }

    pub(crate) fn remove_named_item<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Str<'a>,
    ) -> Result<'a, &'a Attr> {
        let attr = self.get_named_item(&cx.heap, name)?;
        self.element().remove_attr_node(cx, attr)
    }

    pub(crate) fn remove_named_item_ns<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        ns: Option<Str<'a>>,
        local: Str<'a>,
    ) -> Result<'a, &'a Attr> {
        let attr = self.get_named_item_ns(&cx.heap, ns, local)?;
        self.element().remove_attr_node(cx, attr)
    }
}

const HYPHEN: u16 = b'-' as u16;

fn is_lower(unit: u16) -> bool {
    matches!(unit, 0x61..=0x7a)
}

fn is_upper(unit: u16) -> bool {
    matches!(unit, 0x41..=0x5a)
}

/// Short properties, with their attributes.
#[thread_local]
static DATA_ATTRIBUTES: Recent<Option<(DomString, Atom)>, 32> = Recent::new();

pub(super) fn forget_data_attributes() {
    DATA_ATTRIBUTES.forget();
}

/// `None` if no attribute has that property.
#[inline]
fn data_attribute(property: &Impl) -> Option<Atom> {
    match &mut DATA_ATTRIBUTES.borrow_mut()[((core::ptr::from_ref(property).addr() as u64)
        .wrapping_mul(0x9e37_79b9_7f4a_7c15)
        >> 59) as usize]
    {
        Some((known, attribute)) if core::ptr::eq(known.as_impl(), property) => {
            Some(attribute.clone())
        }
        _ if property.length() > 32 => spell_data_attribute(property),
        slot => Some(
            slot.insert((
                DomString::from_impl(property),
                spell_data_attribute(property)?,
            ))
            .1
            .clone(),
        ),
    }
}

#[cold]
fn spell_data_attribute(property: &Impl) -> Option<Atom> {
    let property = DomString::from_impl(property);
    if property
        .units()
        .zip(property.units().skip(1))
        .any(|(it, next)| it == HYPHEN && is_lower(next))
    {
        return None;
    }
    let mut name = StringBuilder::with_capacity(property.len() as usize + 8);
    name.push_latin1(b"data-");
    for unit in property.units() {
        if is_upper(unit) {
            name.push_unit(HYPHEN);
        }
        name.push_unit(if is_upper(unit) { unit + 0x20 } else { unit });
    }
    Some(Atom::from_string(&name.finish()))
}

impl DOMStringMap {
    fn element(&self) -> &Element {
        js_DOMStringMap::element(self).expect("set when it is made")
    }

    pub(crate) fn named_get<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &Impl,
    ) -> Result<'a, Option<Str<'a>>> {
        Ok(data_attribute(name)
            .and_then(|it| self.element().attr(&it))
            .map(|it| it.to_js(&cx.heap)))
    }

    pub(crate) fn named_set<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: &Impl,
        value: JsStringImpl<'a>,
    ) -> Result<'a> {
        let Some(attribute) = data_attribute(name) else {
            return Err(dom_error(
                &cx.heap,
                DomError::SyntaxError,
                &format!(
                    "'{}' is not a valid property name.",
                    DomString::from_impl(name).to_utf8()
                ),
            ));
        };
        validate_attribute_name(&cx.heap, &attribute)?;
        self.element()
            .set_attr(cx, attribute, DomString::from_impl(value.get()));
        Ok(())
    }

    pub(crate) fn named_delete<'a>(&'a self, cx: Cx<'_, 'a>, name: &Impl) -> Result<'a> {
        if let Some(attribute) = data_attribute(name) {
            self.element().remove_attr(cx, attribute);
        }
        Ok(())
    }

    pub(crate) fn named_keys<'a>(&'a self, _: Cx<'_, 'a>, names: &mut PropertyNames) -> Result<'a> {
        for (name, _) in self
            .element()
            .attrs()
            .into_iter()
            .filter(|it| it.0.ns == Ns::None)
        {
            let name = name.local.to_dom_string();
            if !name.substring(0, 5).eq_str("data-") || name.units().any(is_upper) {
                continue;
            }
            let (mut property, mut units) =
                (StringBuilder::default(), name.units().skip(5).peekable());
            while let Some(unit) = units.next() {
                property.push_unit(
                    units
                        .next_if(|it| unit == HYPHEN && is_lower(*it))
                        .map_or(unit, |it| it - 0x20),
                );
            }
            names.add(property.finish().as_impl());
        }
        Ok(())
    }
}

impl Element {
    pub(crate) fn token_list<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        edge: Edge,
        attribute: Known,
        supported: Option<&'static [&'static str]>,
    ) -> JSValue {
        self.same_object(heap, edge, || {
            DOMTokenList::new(heap, self, attribute, supported).to_js()
        })
    }

    pub(crate) fn get_class_list<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.token_list(heap, Edge::ClassList, atom!("class"), None)
    }

    pub(crate) fn get_part<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.token_list(heap, Edge::Part, atom!("part"), None)
    }

    pub(crate) fn get_attributes<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::Attributes, || {
            let made = js_NamedNodeMap::create(self.doc().realm(heap), Default::default());
            js_NamedNodeMap::set_element(made, Some(self));
            made.to_js()
        })
    }

    pub(crate) fn dataset<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.same_object(heap, Edge::Dataset, || {
            let made = js_DOMStringMap::create(self.doc().realm(heap), Default::default());
            js_DOMStringMap::set_element(made, Some(self));
            made.to_js()
        })
    }
}
