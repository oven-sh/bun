//! <https://dom.spec.whatwg.org/#selectors>

use bun_jsc::bindgen::{self, JsScope};

use super::*;
use crate::bindings::{Of, Selection, Within};
use crate::tree::NodeId;

impl Node {
    fn select<'a, R>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
        find: impl FnOnce(&Selection<'_>, NodeId) -> R,
    ) -> bindgen::Result<'a, Option<R>> {
        let of = self.prepare_to_select(cx, selector);
        self.select_prepared(cx, selector, of, of.key(selector), find)
    }

    fn select_prepared<'a, R>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
        of: Of,
        key: u64,
        find: impl FnOnce(&Selection<'_>, NodeId) -> R,
    ) -> bindgen::Result<'a, Option<R>> {
        match self.arena().attempt(|engine| {
            engine.select(self.id(), selector, of, key, |selection| {
                find(selection, self.id())
            })
        }) {
            Some(None) => Err(dom_error(
                &cx.heap,
                DomError::SyntaxError,
                &format!("'{}' is not a valid selector.", bstr(selector)),
            )),
            found => Ok(found.flatten()),
        }
    }

    #[inline(always)]
    fn prepare_to_select<'a>(&'a self, cx: &mut JsScope<'a>, selector: &[u8]) -> Of {
        let doc = self.doc();
        let of = Of {
            is_xml: !doc.is_html_doc(),
            is_quirky: doc.quirks(),
            is_rendered: self.is_rendered(),
        };
        if !of.is_rendered {
            self.derive_state_for(cx, selector, of);
        } else if doc.needs_sync() {
            doc.sync(cx);
        }
        of
    }

    #[inline(never)]
    fn derive_state_for<'a>(&'a self, cx: &mut JsScope<'a>, selector: &[u8], of: Of) {
        if self.engine(|engine, _| engine.tests_state(selector, of)) {
            let root = self.shadow_including_root();
            seams::show_controls(cx, root);
            root.engine(|engine, id| engine.derive_state_of_unrendered(id));
        }
    }

    /// What matches `#a`, `#a.b` or `#a > b c` is the element with that id or in it.
    fn where_to_look(&self, selector: &[u8], of: Of) -> Within {
        let is_in_name = |it: &u8| it.is_ascii_alphanumeric() || matches!(it, b'-' | b'_');
        let Some(rest) = selector.strip_prefix(b"#").filter(|it| {
            !of.is_quirky && it.iter().all(|it| is_in_name(it) || b" >.#*".contains(it))
        }) else {
            return Within::Root;
        };
        let Some(scope) = self.scope() else {
            return Within::Root;
        };
        let id = Atom::from_latin1(&rest[..rest.iter().take_while(|it| is_in_name(it)).count()]);
        let mut all = scope.elements_by_id(&id);
        match (all.next(), all.next()) {
            (Some(only), None) if !only.contains(self) => {
                match self == scope || self.contains(only) {
                    true => Within::Subtree(only.id()),
                    false => Within::Nothing,
                }
            }
            (None, _) => Within::Nothing,
            _ => Within::Root,
        }
    }

    pub(crate) fn query_selector<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        let of = self.prepare_to_select(cx, selector);
        let key = of.key(selector);
        let found = match self
            .arena()
            .read(|engine| engine.known_first(self.id(), key))
        {
            None => {
                let within = self.where_to_look(selector, of);
                self.select_prepared(cx, selector, of, key, |selection, id| {
                    selection.first_below(id, within)
                })?
            }
            known => known,
        };
        debug_assert!(
            self.select(cx, selector, |selection, id| selection
                .below(id)
                .next()
                .unwrap_or_default())?
                == found
        );
        // SAFETY: a descendant.
        Ok(found.and_then(|it| unsafe { it.as_ref() }?.as_element()))
    }

    pub(crate) fn query_selector_all<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
    ) -> bindgen::Result<'a, List<'a>> {
        let of = self.prepare_to_select(cx, selector);
        let key = of.key(selector);
        let found = match self.arena().read(|engine| engine.known_all(self.id(), key)) {
            None => {
                let within = self.where_to_look(selector, of);
                self.select_prepared(cx, selector, of, key, |selection, id| {
                    selection.all_below(id, within)
                })?
                .unwrap_or_default()
            }
            Some(known) => known,
        };
        debug_assert!(
            self.select(cx, selector, |selection, id| selection
                .below(id)
                .eq(found.iter().copied()))?
                != Some(false)
        );
        Ok(List::from_fn(&cx.heap, found.len() as u32, |it| {
            // SAFETY: descendants, which this one holds.
            unsafe { &*found[it as usize] }.to_js()
        }))
    }
}

impl Element {
    pub(crate) fn matches<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
    ) -> bindgen::Result<'a, bool> {
        Ok(self.select(cx, selector, |selection, id| selection.has(id))? == Some(true))
    }

    pub(crate) fn closest<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        selector: &[u8],
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        let found = self.select(cx, selector, |selection, id| selection.closest(id))?;
        Ok(found.flatten().and_then(|it| self.node(it)?.as_element()))
    }
}

fn bstr(bytes: &[u8]) -> &str {
    crate::values::text(bytes)
}
