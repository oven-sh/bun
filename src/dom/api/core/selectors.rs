//! <https://dom.spec.whatwg.org/#selectors>

use std::rc::Rc;

use bun_jsc::JSString;
use bun_jsc::bindgen::{self, JsLocal, JsScope};

use super::string::impl_of;
use super::*;
use crate::bindings::{Of, Selection, Within};
use crate::selector::Sought;
use crate::tree::NodeId;

type Str<'a> = JsLocal<'a, JSString>;

type Known = Option<(DomString, Of, Rc<Sought>)>;

/// By the string that a script has passed, the newer first.
#[thread_local]
static RECENT: Recent<[Known; 2], 32> = Recent::new();

pub(super) fn forget_recent() {
    RECENT.forget();
}

impl Node {
    #[inline(always)]
    fn select<R>(
        &self,
        sought: &Sought,
        find: impl FnOnce(&Selection<'_>, NodeId) -> R,
    ) -> Option<R> {
        let unprepared =
            self.arena()
                .read(|engine| match engine.plain_selection(self.id(), sought) {
                    Some(selection) => Ok(find(&selection, self.id())),
                    None => Err(find),
                });
        unprepared.map_or_else(
            |find| {
                self.arena().attempt(|engine| {
                    engine.select(self.id(), sought, self.is_rendered(), |selection| {
                        find(selection, self.id())
                    })
                })
            },
            Some,
        )
    }

    #[inline(always)]
    fn prepare_to_select<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: Str<'a>,
    ) -> bindgen::Result<'a, Rc<Sought>> {
        let (doc, selector) = (self.doc(), impl_of(&cx.heap, selector)?);
        let (of, address) = (
            Of {
                is_xml: !doc.is_html_doc(),
                is_quirky: doc.quirks(),
            },
            core::ptr::from_ref(selector).addr(),
        );
        let slot = (address >> 4 ^ address >> 10) % 32;
        let known = RECENT.borrow_mut()[slot]
            .iter()
            .flatten()
            .find(|it| core::ptr::eq(it.0.as_impl(), selector) && it.1 == of)
            .map(|it| Rc::clone(&it.2));
        let sought = known.map_or_else(
            || self.parse_selector(cx, DomString::from_impl(selector), of, slot),
            Ok,
        )?;
        if sought.tests_state {
            match self.is_rendered() {
                true => crate::api::ui::entry::flush_controls(cx, doc),
                false => self.derive_state(cx),
            }
        }
        Ok(sought)
    }

    #[inline(never)]
    fn parse_selector<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: DomString,
        of: Of,
        slot: usize,
    ) -> bindgen::Result<'a, Rc<Sought>> {
        let parsed = self.engine(|engine, _| engine.selector(selector.to_utf8().as_bytes(), of));
        let sought = parsed.ok_or_else(|| {
            dom_error(
                &cx.heap,
                DomError::SyntaxError,
                &format!("'{}' is not a valid selector.", selector.to_utf8()),
            )
        })?;
        if selector.len() <= 256 {
            let [newer, older] = &mut RECENT.borrow_mut()[slot];
            *older = newer.replace((selector, of, Rc::clone(&sought)));
        }
        Ok(sought)
    }

    #[inline(never)]
    fn derive_state<'a>(&'a self, cx: &mut JsScope<'a>) {
        let root = self.shadow_including_root();
        seams::show_controls(cx, root);
        root.engine(|engine, id| engine.derive_state_of_unrendered(id));
    }

    fn where_to_look(&self, sought: &Sought) -> Within {
        let Some((id, scope)) = sought
            .within
            .as_ref()
            .and_then(|it| Some((it, self.scope()?)))
        else {
            return Within::Root;
        };
        match *scope.some_elements_by_id(id) {
            [only] if !only.contains(self) => match self == scope || self.contains(only) {
                true => Within::Subtree(only.id()),
                false => Within::Nothing,
            },
            [] => Within::Nothing,
            _ => Within::Root,
        }
    }

    pub(crate) fn query_selector<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: Str<'a>,
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        let sought = self.prepare_to_select(cx, selector)?;
        let found = self
            .arena()
            .read(|engine| engine.known_first(self.id(), &sought))
            .or_else(|| {
                let within = self.where_to_look(&sought);
                self.select(&sought, |selection, id| selection.first_below(id, within))
            });
        debug_assert!(
            self.select(&sought, |selection, id| selection
                .below(id)
                .next()
                .unwrap_or_default())
                == found
        );
        // SAFETY: a descendant.
        Ok(found.and_then(|it| unsafe { it.as_ref() }?.as_element()))
    }

    pub(crate) fn query_selector_all<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: Str<'a>,
    ) -> bindgen::Result<'a, List<'a>> {
        let sought = self.prepare_to_select(cx, selector)?;
        let found = self
            .arena()
            .read(|engine| engine.known_all(self.id(), sought.key))
            .unwrap_or_else(|| {
                let within = self.where_to_look(&sought);
                self.select(&sought, |selection, id| selection.all_below(id, within))
                    .unwrap_or_default()
            });
        debug_assert!(
            self.select(&sought, |selection, id| selection
                .below(id)
                .eq(found.iter().copied()))
                != Some(false)
        );
        // SAFETY: descendants, which this one holds.
        Ok(unsafe { List::from_pointers(&cx.heap, &found) })
    }
}

impl Element {
    pub(crate) fn matches<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: Str<'a>,
    ) -> bindgen::Result<'a, bool> {
        let sought = self.prepare_to_select(cx, selector)?;
        Ok(self.select(&sought, |selection, id| selection.has(id)) == Some(true))
    }

    pub(crate) fn closest<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: Str<'a>,
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        let sought = self.prepare_to_select(cx, selector)?;
        Ok(self
            .select(&sought, |selection, id| selection.closest(id))
            .flatten()
            .and_then(|it| self.node(it)?.as_element()))
    }
}
