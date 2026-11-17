//! <https://drafts.csswg.org/cssom/#css-style-sheets>

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};
use bun_jsc::{JSString, JSValue};

use super::rule::Parent;
use super::{CSSRule, scope};
use crate::api::core::{Doc, DomError, DomString, List, Node, dom_error, seams};
use crate::generated_bindgen::cssom::*;
use crate::prelude::Prelude;
use crate::sheet::Source;
use bun_web::client::Resource;
use bun_web::encoding::Encoding;
use bun_web::referrer::ReferrerPolicy;
use bun_web::url::Url;

use crate::style_sheet;
use crate::tree::NodeId;
use crate::values::{Ctx, text};

pub(crate) struct StyleSheet {
    sheet: Rc<style_sheet::StyleSheet>,
    location: Option<Box<[u8]>>,
    pub(super) title: RefCell<DomString>,
    pub(super) is_explicitly_enabled: Cell<bool>,
    is_origin_clean: Cell<bool>,
    /// For what it imports.
    encoding: Cell<Option<Encoding>>,
    referrer_policy: Cell<ReferrerPolicy>,
}

impl StyleSheet {
    fn new(
        source: Source,
        base_url: &[u8],
        location: Option<&[u8]>,
        is_constructed: bool,
    ) -> StyleSheet {
        StyleSheet {
            sheet: Rc::new(style_sheet::StyleSheet::new(
                source,
                base_url,
                is_constructed,
            )),
            location: location.map(Box::from),
            title: RefCell::default(),
            is_explicitly_enabled: Cell::new(false),
            is_origin_clean: Cell::new(true),
            encoding: Cell::default(),
            referrer_policy: Cell::default(),
        }
    }

    #[inline]
    pub(super) fn get(&self) -> &style_sheet::StyleSheet {
        &self.sheet
    }

    fn as_css(&self) -> &CSSStyleSheet {
        self.downcast().expect("there is no other kind")
    }

    pub(crate) fn get_type(&self) -> &'static str {
        "text/css"
    }

    pub(crate) fn get_href(&self) -> Option<&[u8]> {
        self.location.as_deref()
    }

    pub(crate) fn get_title<'a>(&self, heap: &JsHeap<'a>) -> Option<JsLocal<'a, JSString>> {
        Some(self.title.borrow().clone())
            .filter(|it| !it.is_empty())
            .map(|it| it.to_js(heap))
    }

    pub(crate) fn get_media<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let sheet = self.as_css();
        sheet
            .get_owner_rule(heap)
            .map_or_else(
                || MediaList::of_sheet(heap, sheet),
                |it| MediaList::of_rule(heap, it),
            )
            .to_js()
    }

    pub(crate) fn get_disabled(&self, _: &mut JsScope<'_>) -> bool {
        self.sheet.is_disabled.get()
    }

    pub(crate) fn set_disabled<'a>(&'a self, cx: &mut JsScope<'a>, value: bool) {
        self.sheet.is_disabled.set(value);
        self.as_css().changed(cx);
    }
}

impl CSSStyleSheet {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        options: &CSSStyleSheetInit<'_>,
    ) -> Result<'a, &'a Self> {
        let doc = seams::current_document(cx)?;
        let base_url = doc.base_url();
        let base_url = base_url.to_utf8();
        let base_url = match options.base_url.filter(|it| !it.is_empty()) {
            Some(url) => Ctx {
                base_url: base_url.as_bytes(),
                ..Ctx::dummy()
            }
            .url(url),
            None => text(base_url.as_bytes()).into(),
        };
        (!base_url.is_empty() || options.base_url.is_none()).ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "The base URL is not valid.",
            )
        })?;
        let made = structure.create(
            &cx.heap,
            StyleSheet::new(Source::default(), base_url.as_bytes(), None, true),
        );
        js_StyleSheet::set_constructor_document(made, Some(doc));
        made.get().set_quirky(doc.quirks());
        made.get().set_media(options.media);
        made.get().is_disabled.set(options.disabled);
        Ok(made)
    }

    fn top(&self) -> &CSSStyleSheet {
        core::iter::successors(Some(self), |it| js_StyleSheet::parent_style_sheet(it))
            .last()
            .unwrap_or(self)
    }

    pub(super) fn rendering_document(&self) -> Option<&Doc> {
        let top = self.top();
        js_StyleSheet::owner_node(top)
            .map(Node::doc)
            .or_else(|| js_StyleSheet::constructor_document(top))
            .filter(|it| it.is_rendered())
    }

    /// For an `@scope` rule that names none.
    pub(super) fn scoping_root(&self) -> NodeId {
        js_StyleSheet::owner_node(self.top())
            .and_then(Node::parent_element)
            .filter(|it| it.is_rendered())
            .map_or(0, |it| it.id())
    }

    pub(super) fn changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        let top = self.top();
        js_StyleSheet::scope(top)
            .into_iter()
            .for_each(|it| scope::sheets_changed(cx, it));
        let adopters = js_StyleSheet::adopted_in(top).map(List::from_value);
        adopters
            .into_iter()
            .flat_map(List::nodes)
            .for_each(|it| scope::adopted_sheet_changed(cx, it.doc()));
    }

    pub(super) fn imports_changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        if let Some(owner) = js_StyleSheet::owner_node(self.top()).filter(|it| it.is_rendered()) {
            crate::api::loading::imports_changed(cx, owner.doc(), self);
        }
    }

    fn imports<'a>(&'a self, heap: &JsHeap<'a>) -> impl Iterator<Item = &'a CSSStyleSheet> {
        js_StyleSheet::imports(self)
            .map(List::from_value)
            .into_iter()
            .flat_map(List::values)
            .filter_map(|it| CSSStyleSheet::from_js(heap, it))
    }

    pub(super) fn imported_from<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        href: &[u8],
    ) -> Option<&'a CSSStyleSheet> {
        let url = Ctx {
            base_url: &self.get().base_url(),
            ..Ctx::dummy()
        }
        .url(href);
        self.imports(heap)
            .find(|it| it.get_href() == Some(url.as_bytes()))
    }

    fn check_origin<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, ()> {
        self.is_origin_clean.get().ok_or_else(|| {
            dom_error(
                heap,
                DomError::SecurityError,
                "Cannot access the rules of a style sheet of another origin.",
            )
        })
    }

    fn replace_source<'a>(&'a self, cx: &mut JsScope<'a>, source: Source) {
        Parent::Sheet(self).removed(&cx.heap, 0, u32::MAX);
        self.get().replace(source);
        self.changed(cx);
    }

    pub(crate) fn get_owner_rule<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a CSSRule> {
        let parent = js_StyleSheet::parent_style_sheet(self)?;
        let imports_it = |index: &usize| match parent
            .get()
            .rule(*index)
            .as_ref()
            .map(|it| it.prelude())
            .as_deref()
        {
            Some(Prelude::Import(it)) => parent
                .imported_from(heap, &it.href)
                .is_some_and(|it| core::ptr::eq(it, self)),
            _ => false,
        };
        Parent::Sheet(parent).child(heap, (0..parent.get().len()).find(imports_it)? as u32)
    }

    pub(crate) fn get_css_rules<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a CSSRuleList> {
        self.check_origin(heap)?;
        Ok(js_StyleSheet::css_rules(self).unwrap_or_else(|| {
            let made = Parent::Sheet(self).list(self.realm(heap));
            js_StyleSheet::set_css_rules(self, Some(made));
            made
        }))
    }

    pub(crate) fn insert_rule<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rule: &[u8],
        index: u32,
    ) -> Result<'a, u32> {
        self.check_origin(&cx.heap)?;
        let affects_imports = self
            .get()
            .insert_rule(rule, index as usize)
            .map_err(|it| it.to_js(&cx.heap))?;
        Parent::Sheet(self).inserted(&cx.heap, index);
        self.changed(cx);
        if affects_imports {
            self.imports_changed(cx);
        }
        Ok(index)
    }

    pub(crate) fn delete_rule<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Result<'a, ()> {
        self.check_origin(&cx.heap)?;
        let affects_imports = self
            .get()
            .delete_rule(index as usize)
            .map_err(|it| it.to_js(&cx.heap))?;
        Parent::Sheet(self).removed(&cx.heap, index, 1);
        self.changed(cx);
        if affects_imports {
            self.imports_changed(cx);
        }
        Ok(())
    }

    pub(crate) fn add_rule<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
        style: &[u8],
        index: Option<u32>,
    ) -> Result<'a, i32> {
        let index = index.unwrap_or_else(|| self.get().len() as u32);
        self.insert_rule(cx, &[selector, b" { ", style, b" }"].concat(), index)
            .map(|_| -1)
    }

    pub(crate) fn replace_sync<'a>(&'a self, cx: &mut JsScope<'a>, text: &[u8]) -> Result<'a, ()> {
        self.get().is_constructed().ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "Can't replace a non-constructed CSSStyleSheet.",
            )
        })?;
        self.replace_source(cx, Source::copy_of(text));
        Ok(())
    }

    pub(crate) fn replace<'a>(&'a self, cx: &mut JsScope<'a>, text: &[u8]) -> Result<'a, JSValue> {
        self.replace_sync(cx, text)?;
        Ok(cx.promise_resolve(self.to_js())?.to_js())
    }
}

pub(crate) fn create_sheet<'a>(
    heap: &JsHeap<'a>,
    doc: &'a Doc,
    text: &[u8],
    base_url: &[u8],
) -> &'a CSSStyleSheet {
    let made = js_CSSStyleSheet::create(
        doc.realm(heap),
        StyleSheet::new(Source::of_sheet(text), base_url, None, false),
    );
    made.get().set_quirky(doc.quirks());
    made
}

/// It is empty until `sheet_fetched`.
pub(crate) fn create_linked_sheet<'a>(
    heap: &JsHeap<'a>,
    doc: &'a Doc,
    href: &[u8],
    media: &[u8],
) -> &'a CSSStyleSheet {
    let made = unfetched_sheet(heap, doc, href);
    made.is_origin_clean.set(false);
    made.get().set_media(media);
    made
}

fn unfetched_sheet<'a>(heap: &JsHeap<'a>, doc: &'a Doc, href: &[u8]) -> &'a CSSStyleSheet {
    let made = js_CSSStyleSheet::create(
        doc.realm(heap),
        StyleSheet::new(Source::default(), href, Some(href), false),
    );
    made.get().set_quirky(doc.quirks());
    made
}

/// <https://html.spec.whatwg.org/#creating-a-css-module-script>
pub(crate) fn create_module_sheet<'a>(
    heap: &JsHeap<'a>,
    doc: &'a Doc,
    utf8: &[u8],
    url: &[u8],
) -> &'a CSSStyleSheet {
    let source = doc.arena().read(|engine| engine.source_from_utf8(utf8));
    let made = js_CSSStyleSheet::create(heap, StyleSheet::new(source, url, None, true));
    js_StyleSheet::set_constructor_document(made, Some(doc));
    made.get().set_quirky(doc.quirks());
    made
}

/// `fallback`: <https://drafts.csswg.org/css-syntax/#determine-the-fallback-encoding>
pub(crate) fn sheet_fetched<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    sheet: &'a CSSStyleSheet,
    resource: &Resource,
    fallback: Encoding,
) {
    let encoding = resource.encoding(fallback);
    sheet.get().set_base_url(resource.url.href());
    sheet.is_origin_clean.set(resource.is_readable);
    sheet
        .encoding
        .set(Some(fallback).filter(|it| !it.is_utf8()));
    sheet.referrer_policy.set(resource.referrer_policy);
    let decoded = (!encoding.is_utf8()).then(|| encoding.decode(&resource.bytes, false));
    let source = doc.arena().read(|engine| {
        engine.source_from_utf8(decoded.as_ref().map_or(&resource.bytes, |it| it.as_bytes()))
    });
    sheet.replace_source(cx, source);
}

pub(crate) struct ImportRequest<'a> {
    pub(crate) sheet: &'a CSSStyleSheet,
    pub(crate) url: Option<Url>,
    pub(crate) modifiers: Vec<u8>,
    pub(crate) is_loaded: bool,
    pub(crate) encoding: Option<Encoding>,
    pub(crate) referrer: Option<Url>,
    pub(crate) referrer_policy: ReferrerPolicy,
}

/// Makes a sheet for each `@import` rule that has none, but no more than `limit`. The `ImportRequest`s are for those, and for the
/// ones whose own imports have to follow.
pub(crate) fn update_imports<'a>(
    heap: &JsHeap<'a>,
    doc: &'a Doc,
    sheet: &'a CSSStyleSheet,
    limit: u32,
) -> impl Iterator<Item = ImportRequest<'a>> + use<'a> {
    let wanted = doc.engine(|engine, _| sheet.get().wanted_imports(engine, sheet.scoping_root()));
    let (old, new) = (
        js_StyleSheet::imports(sheet).map(List::from_value),
        List::new(heap),
    );
    let mut requests = Vec::new();
    for import in wanted {
        let (url, modifiers) = bun_core::strings::split_once_char(import.url.as_bytes(), 0)
            .unwrap_or((import.url.as_bytes(), b""));
        let is_cycle =
            core::iter::successors(Some(sheet), |it| js_StyleSheet::parent_style_sheet(it))
                .any(|it| it.get_href() == Some(url));
        if is_cycle || new.len() >= limit {
            continue;
        }
        let known = sheet.imports(heap).find(|it| it.get_href() == Some(url));
        let imported = known.unwrap_or_else(|| unfetched_sheet(heap, doc, url));
        _ = old.map(|it| it.remove(heap, imported.to_js()));
        js_StyleSheet::set_parent_style_sheet(imported, Some(sheet));
        if imported
            .get()
            .set_wrapping([&sheet.get().wrapping()[..], &import.prelude].concat())
            || known.is_none()
        {
            let modifiers =
                bun_core::strings::split_once_char(modifiers, 0).map_or(modifiers, |it| it.0);
            requests.push((new.len(), modifiers.to_vec(), known.is_some()));
        }
        new.push(heap, imported.to_js());
    }
    sheet
        .imports(heap)
        .for_each(|it| js_StyleSheet::set_parent_style_sheet(it, None));
    js_StyleSheet::set_imports(sheet, new.to_js());
    sheet
        .get()
        .imports
        .replace(sheet.imports(heap).map(|it| Rc::clone(&it.sheet)).collect());
    requests
        .into_iter()
        .map(move |(index, modifiers, is_loaded)| {
            // SAFETY: the list has sheets, and `sheet` holds it.
            let imported = unsafe { CSSStyleSheet::from_js_unchecked(new.get(index)) };
            ImportRequest {
                sheet: imported,
                url: imported.get_href().and_then(Url::parse),
                modifiers,
                is_loaded,
                encoding: sheet.encoding.get(),
                referrer: sheet
                    .location
                    .as_ref()
                    .and_then(|_| Url::parse(&sheet.get().base_url())),
                referrer_policy: sheet.referrer_policy.get(),
            }
        })
}

pub(crate) fn imports_loaded<'a>(cx: &mut JsScope<'a>, sheet: &'a CSSStyleSheet) {
    sheet.changed(cx);
}

pub(crate) fn has_parsed_rules(sheet: &CSSStyleSheet) -> bool {
    sheet.get().has_parsed_rules()
}

pub(crate) fn set_media<'a>(cx: &mut JsScope<'a>, sheet: &'a CSSStyleSheet, media: &[u8]) {
    sheet.get().set_media(media);
    sheet.changed(cx);
}
