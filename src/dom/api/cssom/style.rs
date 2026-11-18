//! <https://drafts.csswg.org/cssom/#css-declaration-blocks>

use std::rc::Rc;
use std::sync::LazyLock;

use bun_core::WTFStringImplStruct;
use bun_jsc::JSString;
use bun_jsc::bindgen::{Class, JsHeap, JsInterface, JsLocal, JsScope, PropertyNames, Result};

use super::CSSRule;
use crate::api::core::custom;
use crate::api::core::steps::AttrChange;
use crate::api::core::{
    DocFlags, DomError, DomString, Edge, Element, Familiar, NodeFlags, QualName, Recent, Record,
    atom, dom_error, impl_of, queue_mutation_record,
};
use crate::api::events::WindowTarget;
use crate::declarations::{Accepts, DeclarationList, InlineBlocks, Key, Specified};
use crate::document::Document;
use crate::generated_bindgen::cssom::*;
use crate::name::Name;
use crate::properties::{Id, Prop, PropsByName, logical_props};
use crate::selector::Pseudo;
use crate::sheet::{Block, Within};
use crate::tree::NodeId;
use crate::values::{Out, eq};

#[derive(Clone, Copy)]
enum Source {
    Inline,
    /// `None` if there is no such pseudo-element.
    Computed(Option<Pseudo>),
    Rule,
}

pub(crate) struct CSSStyleDeclaration(Source, bun_jsc::bindgen::Interior);

enum Owner<'a> {
    Inline(&'a Element),
    Computed(Option<(&'a Element, Pseudo)>),
    Rule(&'a CSSRule),
}

const PROPERTIES: Accepts = Accepts::Properties(Within::Style);

/// Some are listed by another name, too.
fn computed_properties() -> &'static [(&'static str, Prop)] {
    static ALL: LazyLock<Vec<(&str, Prop)>> = LazyLock::new(|| {
        const HIDDEN: [&str; 5] = [
            "page",
            "size",
            "background-position-",
            "-webkit-perspective-origin-",
            "-webkit-transform-origin-",
        ];
        const OTHERS: &str = "background-position contain-intrinsic-size font-variant mask-position text-decoration -webkit-box-decoration-break -webkit-line-break \
            -webkit-mask-box-image -webkit-text-orientation -webkit-writing-mode";
        let longhands = Id::ALL
            .iter()
            .map(|it| Prop::Long(*it))
            .chain(logical_props())
            .filter(|it| !HIDDEN.iter().any(|start| it.name().starts_with(start)));
        let others = OTHERS
            .split_ascii_whitespace()
            .filter_map(|it| Some((it, Prop::from_name(it.as_bytes())?)));
        let mut all: Vec<_> = longhands.map(|it| (it.name(), it)).chain(others).collect();
        bun_collections::index_sort::sort_slice_by_key(&mut all, |it| {
            (it.0.starts_with('-'), it.0)
        });
        all
    });
    &ALL
}

fn up_to_date<'a, R: Default>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    run: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    element.synced_engine(cx, |engine, id| {
        engine.catch_up_with_compositor();
        run(engine, id)
    })
}

fn read_inline<R>(element: &Element, read: impl FnOnce(&DeclarationList) -> R) -> R {
    element
        .arena()
        .write(|engine| match engine.inline_style(element.id()) {
            Some(block) => read(&block.editable().list),
            None => read(&DeclarationList::default()),
        })
}

/// <https://drafts.csswg.org/cssom/#update-style-attribute-for>
fn edit_inline<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    edit: impl FnOnce(&mut InlineBlocks, &mut Rc<Block>) -> bool,
) {
    change_inline(cx, element, |engine, id| engine.edit_inline_style(id, edit));
}

#[inline]
fn change_inline<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    change: impl FnOnce(&mut Document, NodeId) -> bool,
) {
    if !element.doc().has_page() {
        check_against_shown_document(cx, element);
    }
    let observed = is_observed(element).then(|| {
        needs_old_value(&cx.heap, element)
            .then(|| style_attribute(element))
            .flatten()
    });
    if element.change(change) {
        inline_style_changed(cx, element, observed.as_ref().map(Option::as_ref));
    }
}

fn check_against_shown_document<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    if let Some(shown) = WindowTarget::of_realm(&cx.heap)
        .and_then(WindowTarget::doc)
        .filter(|it| it.is(DocFlags::CHECKS_STYLE_ATTRIBUTES))
    {
        crate::api::core::page::check_style_attribute(cx, element, shown);
    }
}

fn is_observed(element: &Element) -> bool {
    element.has(NodeFlags::CUSTOM)
        || element.doc().is(DocFlags::OBSERVES_ATTRIBUTES)
            && element.has_observed_attribute(&atom!("style").into())
}

fn needs_old_value<'a>(heap: &JsHeap<'a>, element: &'a Element) -> bool {
    element.has(NodeFlags::CUSTOM)
        || element.doc().is(DocFlags::RECORDS_EDITS)
        || element.has_observed_old_value(heap, &atom!("style").into())
}

/// `observed` has what the attribute was.
fn inline_style_changed<'a>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    observed: Option<Option<&DomString>>,
) {
    element.set(NodeFlags::STYLE_DIRTY);
    element.attributes_changed();
    if element.is_rendered() {
        element.doc().invalidate(cx);
    }
    if let Some(old) = observed {
        let name = QualName::plain(atom!("style"));
        queue_mutation_record(&cx.heap, element, Record::Attribute { name: &name, old });
        if element.has(NodeFlags::CUSTOM) {
            custom::attribute_changed(
                cx,
                element,
                &AttrChange {
                    name: &name,
                    old,
                    new: style_attribute(element).as_ref(),
                },
            );
        }
    }
}

fn style_attribute(element: &Element) -> Option<DomString> {
    if element.has(NodeFlags::STYLE_DIRTY) {
        flush_style(element);
    }
    element.attr(atom!("style"))
}

pub(crate) fn flush_style(element: &Element) {
    element.unset(NodeFlags::STYLE_DIRTY);
    element
        .arena()
        .write(|engine| engine.serialize_inline_style(element.id()));
}

impl CSSStyleDeclaration {
    pub(super) fn of_rule<'a>(heap: &JsHeap<'a>, class: Class<Self>, rule: &CSSRule) -> &'a Self {
        let made = class.create(
            rule.realm(heap),
            CSSStyleDeclaration(Source::Rule, Default::default()),
        );
        js_CSSStyleDeclaration::set_parent_rule(made, Some(rule));
        made
    }

    fn of_element<'a>(
        heap: &JsHeap<'a>,
        source: Source,
        element: &Element,
    ) -> &'a CSSStyleProperties {
        let made =
            js_CSSStyleProperties::create(heap, CSSStyleDeclaration(source, Default::default()));
        js_CSSStyleDeclaration::set_element(made, Some(element));
        made
    }

    #[inline]
    fn owner(&self) -> Owner<'_> {
        match (
            self.0,
            js_CSSStyleDeclaration::element(self),
            js_CSSStyleDeclaration::parent_rule(self),
        ) {
            (Source::Inline, Some(element), _) => Owner::Inline(element),
            (Source::Rule, _, Some(rule)) => Owner::Rule(rule),
            (Source::Computed(pseudo), element, _) => {
                Owner::Computed(element.filter(|it| it.is_rendered()).zip(pseudo))
            }
            _ => Owner::Computed(None),
        }
    }

    fn accepts(&self) -> Accepts {
        if let Owner::Rule(rule) = self.owner() {
            rule.get().accepts()
        } else {
            PROPERTIES
        }
    }

    /// `None` if it is computed.
    pub(crate) fn read<R>(&self, read: impl FnOnce(&DeclarationList) -> R) -> Option<R> {
        match self.owner() {
            Owner::Inline(element) => Some(read_inline(element, read)),
            Owner::Rule(rule) => Some(read(&rule.get().style())),
            Owner::Computed(_) => None,
        }
    }

    fn check_writable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, ()> {
        match self.0 {
            Source::Computed(_) => Err(dom_error(
                heap,
                DomError::NoModificationAllowedError,
                "These styles are computed, and therefore read-only.",
            )),
            _ => Ok(()),
        }
    }

    #[inline]
    fn get<'a>(&'a self, cx: &mut JsScope<'a>, key: Option<Key>) -> JsLocal<'a, JSString> {
        match (self.owner(), key) {
            (Owner::Computed(Some((element, pseudo))), Some(Key::Property(prop))) => {
                let known = element.at_a_glance(cx, |engine, id| {
                    engine
                        .known_resolved_value(id, prop)
                        .filter(|_| pseudo == Pseudo::None)
                });
                known
                    .unwrap_or_else(|| {
                        up_to_date(cx, element, |engine, id| {
                            engine.resolved_value(id, pseudo, prop)
                        })
                    })
                    .to_js(&cx.heap)
            }
            (_, None) => DomString::default().to_js(&cx.heap),
            (_, Some(key)) => self
                .read(|it| Familiar::from_utf8(&it.get(key)))
                .map_or_else(
                    || DomString::default().to_js(&cx.heap),
                    |it| it.to_js(&cx.heap),
                ),
        }
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        key: Key,
        value: &[u8],
        is_important: bool,
    ) {
        match (self.owner(), key) {
            _ if value.is_empty() => self.remove(cx, key),
            (Owner::Inline(element), Key::Property(prop)) => {
                change_inline(cx, element, |engine, id| {
                    engine.set_inline_property(id, prop, value, is_important)
                })
            }
            (Owner::Rule(rule), _) => {
                let specified =
                    Specified::parse(rule.get().accepts(), key, value, is_important).map(Rc::new);
                rule.edit_style(cx, |it| specified.is_some_and(|new| it.set(&new)));
            }
            _ => {}
        }
    }

    pub(crate) fn remove<'a>(&'a self, cx: &mut JsScope<'a>, key: Key) {
        match (self.owner(), key) {
            (Owner::Inline(element), Key::Property(prop)) => {
                edit_inline(cx, element, |blocks, it| blocks.remove(it, prop))
            }
            (Owner::Rule(rule), _) => rule.edit_style(cx, |it| it.remove(key)),
            _ => {}
        }
    }

    pub(crate) fn replace<'a>(&'a self, cx: &mut JsScope<'a>, source: &[u8]) {
        match self.owner() {
            Owner::Inline(element) => edit_inline(cx, element, |blocks, it| {
                *it = blocks.parse(source, it.within(), &it.base_url);
                true
            }),
            Owner::Rule(rule) => rule.edit_style(cx, |it| {
                *it = DeclarationList::parse(rule.get().accepts(), source);
                true
            }),
            Owner::Computed(_) => {}
        }
    }

    /// What is computed besides `computed_properties`. `None` if nothing is.
    fn computed_customs<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<Rc<[Name]>> {
        let Owner::Computed(Some((element, pseudo))) = self.owner() else {
            return None;
        };
        Some(element.synced_engine(cx, |engine, id| engine.custom_property_names(id, pseudo)))
    }

    /// With the part of the registered syntax that it matches.
    pub(crate) fn computed_value<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        prop: Prop,
    ) -> Option<(Out, Out)> {
        let Owner::Computed(Some((element, _))) = self.owner() else {
            return None;
        };
        up_to_date(cx, element, |engine, id| engine.computed_value(id, prop))
    }

    pub(crate) fn get_css_text<'a>(&self, _: &mut JsScope<'a>) -> Result<'a, Out> {
        Ok(self.read(DeclarationList::serialize).unwrap_or_default())
    }

    pub(crate) fn set_css_text<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) -> Result<'a, ()> {
        self.check_writable(&cx.heap)?;
        self.replace(cx, value);
        Ok(())
    }

    pub(crate) fn get_length<'a>(&'a self, cx: &mut JsScope<'a>) -> u32 {
        let computed = self
            .computed_customs(cx)
            .map(|it| computed_properties().len() + it.len());
        computed
            .or_else(|| self.read(DeclarationList::len))
            .unwrap_or(0) as u32
    }

    pub(crate) fn indexed_length(&self) -> u32 {
        match self.owner() {
            Owner::Computed(Some((element, pseudo))) => {
                (computed_properties().len()
                    + element.engine(|engine, id| engine.custom_property_names(id, pseudo).len()))
                    as u32
            }
            _ => self.read(DeclarationList::len).unwrap_or(0) as u32,
        }
    }

    pub(crate) fn key_at<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Option<Key> {
        let (index, listed) = (index as usize, computed_properties());
        match self.owner() {
            Owner::Computed(Some(_)) if index < listed.len() => {
                Some(Key::Property(listed[index].1))
            }
            Owner::Computed(_) => Some(Key::Property(Prop::Custom(
                *self.computed_customs(cx)?.get(index - listed.len())?,
            ))),
            _ => self.read(|it| it.key_at(index))?,
        }
    }

    pub(crate) fn indexed_get<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Option<Out> {
        let (key, listed) = (
            self.key_at(cx, index)?,
            computed_properties()
                .get(index as usize)
                .filter(|_| matches!(self.0, Source::Computed(_))),
        );
        Some(listed.map_or_else(|| key.name().into_owned().into(), |it| it.0.into()))
    }

    pub(crate) fn item<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Out {
        self.indexed_get(cx, index).unwrap_or_default()
    }

    pub(crate) fn get_property_value<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: &[u8],
    ) -> JsLocal<'a, JSString> {
        self.get(cx, self.accepts().key(property))
    }

    pub(crate) fn get_property_priority(&self, property: &[u8]) -> &'static str {
        let is_important = self
            .accepts()
            .key(property)
            .and_then(|key| self.read(|it| it.is_important(key)));
        if is_important == Some(true) {
            "important"
        } else {
            ""
        }
    }

    #[inline]
    fn key_of<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: JsLocal<'a, JSString>,
    ) -> Result<'a, Option<Key>> {
        let (name, accepts) = (impl_of(heap, name)?, self.accepts());
        let Accepts::Properties(_) = accepts else {
            return Ok(accepts.key(DomString::from_impl(name).to_utf8().as_bytes()));
        };
        let known = &mut RECENT_NAMES.borrow_mut()[slot_of(name)];
        if let Some(found) = known
            .iter()
            .flatten()
            .find(|it| core::ptr::eq(it.0.as_impl(), name))
        {
            return Ok(Some(found.1));
        }
        let (name, [newer, older]) = (DomString::from_impl(name), known);
        let key = accepts.key(name.to_utf8().as_bytes());
        key.into_iter()
            .for_each(|it| *older = newer.replace((name.clone(), it)));
        Ok(key)
    }

    pub(crate) fn js_get_property_value<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: JsLocal<'a, JSString>,
    ) -> Result<'a, JsLocal<'a, JSString>> {
        let key = self.key_of(&cx.heap, property)?;
        Ok(self.get(cx, key))
    }

    pub(crate) fn set_property<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: &[u8],
        value: &[u8],
        priority: &[u8],
    ) -> Result<'a, ()> {
        self.set_with_priority(cx, self.accepts().key(property), value, priority)
    }

    pub(crate) fn js_set_property<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: JsLocal<'a, JSString>,
        value: &[u8],
        priority: &[u8],
    ) -> Result<'a, ()> {
        let key = self.key_of(&cx.heap, property)?;
        self.set_with_priority(cx, key, value, priority)
    }

    fn set_with_priority<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        key: Option<Key>,
        value: &[u8],
        priority: &[u8],
    ) -> Result<'a, ()> {
        self.check_writable(&cx.heap)?;
        if let Some(key) =
            key.filter(|_| value.is_empty() || priority.is_empty() || eq(priority, "important"))
        {
            self.set(cx, key, value, !priority.is_empty());
        }
        Ok(())
    }

    pub(crate) fn remove_property<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        property: JsLocal<'a, JSString>,
    ) -> Result<'a, JsLocal<'a, JSString>> {
        self.check_writable(&cx.heap)?;
        let key = self
            .key_of(&cx.heap, property)?
            .filter(|key| self.read(|it| it.has_some_of(*key)) == Some(true));
        let Some(key) = key else {
            return Ok(DomString::default().to_js(&cx.heap));
        };
        let old = self.get(cx, Some(key));
        self.remove(cx, key);
        Ok(old)
    }

    #[inline]
    fn set_member<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        key: Option<Key>,
        value: &[u8],
    ) -> Result<'a, ()> {
        self.check_writable(&cx.heap)?;
        key.into_iter()
            .for_each(|it| self.set(cx, it, value, false));
        Ok(())
    }
}

/// <https://drafts.csswg.org/cssom/#css-property-to-idl-attribute>
pub(crate) fn camel_case(name: &[u8]) -> Out {
    let mut words = bun_core::strings::split(name, b"-");
    let first = words.next().unwrap_or_default().to_vec();
    words.fold(first, |all, it| {
        [
            &all[..],
            &it[..it.len().min(1)].to_ascii_uppercase(),
            &it[it.len().min(1)..],
        ]
        .concat()
    })
}

fn spellings(name: &[u8]) -> impl Iterator<Item = Out> {
    let dashed = bun_core::strings::contains_char(name, b'-').then(|| name.to_vec());
    let camel = core::iter::once(camel_case(name)).chain(name.strip_prefix(b"-").map(camel_case));
    camel
        .filter(|_| !name.starts_with(b"-electron-"))
        .chain(dashed)
}

fn property_attributes() -> impl Iterator<Item = (Out, Prop)> {
    let all = crate::properties::property_names()
        .into_iter()
        .filter_map(|it| Some((Prop::from_name(&it)?, it)));
    all.flat_map(|(prop, name)| spellings(&name).map(|it| (it, prop)).collect::<Vec<_>>())
        .chain([("cssFloat".into(), Prop::Long(Id::Float))])
}

#[inline]
pub(crate) fn property_of_attribute(name: &[u8]) -> Option<Prop> {
    static ALL: LazyLock<PropsByName> = LazyLock::new(|| {
        property_attributes()
            .map(|it| (it.0.into(), it.1))
            .collect()
    });
    ALL.get(name, false)
}

#[thread_local]
static RECENT: Recent<[Option<(DomString, Prop)>; 2], 128> = Recent::new();

#[thread_local]
static RECENT_NAMES: Recent<[Option<(DomString, Key)>; 2], 128> = Recent::new();

fn slot_of(name: &WTFStringImplStruct) -> usize {
    core::ptr::from_ref(name)
        .addr()
        .wrapping_mul(0x9e37_79b9_7f4a_7c15)
        >> 57
}

pub(crate) fn forget_attributes() {
    RECENT.forget();
    RECENT_NAMES.forget();
}

/// `name` is an atom.
#[inline]
fn key_of_attribute(name: &WTFStringImplStruct) -> Option<Key> {
    let known = &mut RECENT.borrow_mut()[slot_of(name)];
    let found = known
        .iter()
        .flatten()
        .find(|it| core::ptr::eq(it.0.as_impl(), name))
        .map(|it| it.1);
    found
        .or_else(|| remember_attribute(known, name))
        .map(Key::Property)
}

#[cold]
fn remember_attribute(
    [newer, older]: &mut [Option<(DomString, Prop)>; 2],
    name: &WTFStringImplStruct,
) -> Option<Prop> {
    let prop = property_of_attribute(name.latin1_slice())?;
    *older = newer.replace((DomString::from_impl(name), prop));
    Some(prop)
}

fn descriptor_of_attribute(all: &'static str, name: &WTFStringImplStruct) -> Option<Key> {
    all.split_ascii_whitespace()
        .find(|it| spellings(it.as_bytes()).any(|it| it == name.latin1_slice()))
        .map(Key::Descriptor)
}

macro_rules! attributes {
    ($($Class:ident $names:expr, $key:expr;)+) => {
        $(impl $Class {
            pub(crate) fn attribute_names(names: &mut PropertyNames) {
                $names.for_each(|it: Out| names.add_utf8(&it));
            }

            pub(crate) fn attribute_get<'a>(&'a self, cx: &mut JsScope<'a>, name: &WTFStringImplStruct) -> Result<'a, JsLocal<'a, JSString>> {
                Ok(self.get(cx, $key(name)))
            }

            pub(crate) fn attribute_set<'a>(&'a self, cx: &mut JsScope<'a>, name: &WTFStringImplStruct, value: &[u8]) -> Result<'a, ()> {
                self.set_member(cx, $key(name), value)
            }
        })+
    };
}

fn spelled(all: &'static str) -> impl Iterator<Item = Out> {
    all.split_ascii_whitespace()
        .flat_map(|it| spellings(it.as_bytes()))
}

const OF_PAGE: &str =
    "margin margin-top margin-right margin-bottom margin-left size page-orientation";
const OF_POSITION_TRY: &str = "margin margin-top margin-right margin-bottom margin-left margin-block margin-block-start margin-block-end \
    margin-inline margin-inline-start margin-inline-end inset inset-block inset-block-start inset-block-end inset-inline inset-inline-start \
    inset-inline-end top left right bottom width min-width max-width height min-height max-height block-size min-block-size max-block-size \
    inline-size min-inline-size max-inline-size place-self align-self justify-self position-anchor position-area";
const OF_FONT_FACE: &str = "src font-family font-style font-weight font-stretch font-variant size-adjust unicode-range font-display \
    font-feature-settings font-variation-settings ascent-override descent-override line-gap-override";

attributes! {
    CSSStyleProperties property_attributes().map(|it| it.0), key_of_attribute;
    CSSPageDescriptors spelled(OF_PAGE), key_of_attribute;
    CSSPositionTryDescriptors spelled(OF_POSITION_TRY), key_of_attribute;
    CSSFontFaceDescriptors spelled(OF_FONT_FACE), |it| descriptor_of_attribute(OF_FONT_FACE, it);
    CSSFunctionDescriptors spelled("result"), |_| Some(Key::Descriptor("result"));
}

#[inline]
pub(crate) fn inline_style<'a>(heap: &JsHeap<'a>, element: &'a Element) -> &'a CSSStyleProperties {
    let style = element.same_object(heap, Edge::Style, || {
        CSSStyleDeclaration::of_element(element.realm(heap), Source::Inline, element).to_js()
    });
    // SAFETY: the edge holds what is made above.
    unsafe { CSSStyleProperties::from_js_unchecked(style) }
}

impl ElementCSSInlineStyle {
    pub(crate) fn get_style<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CSSStyleProperties {
        inline_style(heap, self)
    }
}

/// <https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle>
pub(crate) fn get_computed_style<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
    pseudo: Option<&[u8]>,
) -> &'a CSSStyleProperties {
    let pseudo = match pseudo.filter(|it| it.starts_with(b":")) {
        Some(source) => crate::cssom::pseudo_element(source)
            .filter(|it| !it.ends_with(b"(*)"))
            .map(|it| Pseudo::from_name(&it)),
        None => Some(Pseudo::None),
    };
    CSSStyleDeclaration::of_element(element.realm(heap), Source::Computed(pseudo), element)
}

pub(crate) fn set_all_unless_important<'a, 'v>(
    cx: &mut JsScope<'a>,
    element: &'a Element,
    values: impl Iterator<Item = (Prop, &'v [u8])>,
) {
    edit_inline(cx, element, |blocks, block| {
        values.fold(false, |has_changed, (prop, value)| {
            (!block.editable().list.is_important(Key::Property(prop))
                && blocks.set(block, prop, value, false))
                | has_changed
        })
    });
}
