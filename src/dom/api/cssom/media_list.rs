//! <https://drafts.csswg.org/cssom/#the-medialist-interface>

use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope, Result};

use super::{CSSRule, CSSStyleSheet};
use crate::api::core::{DomError, dom_error};
use crate::condition::media_list;
use crate::generated_bindgen::cssom::{MediaList, js_MediaList};
use crate::prelude::Prelude;
use crate::values::Out;

fn parse_media_query(source: &[u8]) -> Option<Out> {
    let [query] = <[Out; 1]>::try_from(media_list(source).1).ok()?;
    Some(query)
}

impl MediaList {
    pub(super) fn of_sheet<'a>(heap: &JsHeap<'a>, sheet: &CSSStyleSheet) -> &'a MediaList {
        let made = js_MediaList::create(sheet.realm(heap), MediaList::default());
        js_MediaList::set_sheet(made, Some(sheet));
        made
    }

    pub(super) fn of_rule<'a>(heap: &JsHeap<'a>, rule: &CSSRule) -> &'a MediaList {
        let made = js_MediaList::create(rule.realm(heap), MediaList::default());
        js_MediaList::set_rule(made, Some(rule));
        made
    }

    fn queries(&self) -> Vec<Out> {
        let Some(rule) = js_MediaList::rule(self) else {
            return js_MediaList::sheet(self)
                .map_or(Vec::new(), |it| media_list(&it.get().media()).1);
        };
        match &*rule.get().prelude() {
            Prelude::Media(all) => all.clone(),
            Prelude::Import(it) => it.media.clone(),
            _ => Vec::new(),
        }
    }

    fn set_queries<'a>(&'a self, cx: &mut JsScope<'a>, queries: Vec<Out>) {
        let Some(rule) = js_MediaList::rule(self) else {
            return js_MediaList::sheet(self)
                .into_iter()
                .for_each(|it| super::set_media(cx, it, &queries.join(&b',')));
        };
        rule.get().edit_prelude(|it| match it {
            Prelude::Media(all) => *all = queries,
            Prelude::Import(it) => it.media = queries,
            _ => {}
        });
        rule.changed(cx);
        if let Some(sheet) = rule
            .get_parent_style_sheet()
            .filter(|_| matches!(*rule.get().prelude(), Prelude::Import(_)))
        {
            sheet.imports_changed(cx);
        }
    }

    pub(crate) fn get_media_text(&self, _: &mut JsScope<'_>) -> Out {
        self.queries().join(&b", "[..])
    }

    pub(crate) fn set_media_text<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) {
        self.set_queries(cx, media_list(value).1);
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.queries().len() as u32
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<Out> {
        self.queries().into_iter().nth(index as usize)
    }

    pub(crate) fn item(&self, index: u32) -> Option<Out> {
        self.indexed_get(index)
    }

    pub(crate) fn append_medium<'a>(&'a self, cx: &mut JsScope<'a>, medium: &[u8]) {
        let mut queries = self.queries();
        if let Some(query) = parse_media_query(medium).filter(|it| !queries.contains(it)) {
            queries.push(query);
            self.set_queries(cx, queries);
        }
    }

    pub(crate) fn delete_medium<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        medium: &[u8],
    ) -> Result<'a, ()> {
        let Some(query) = parse_media_query(medium) else {
            return Ok(());
        };
        let mut queries = self.queries();
        queries.contains(&query).ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The medium is not in the list.",
            )
        })?;
        queries.retain(|it| *it != query);
        self.set_queries(cx, queries);
        Ok(())
    }
}
