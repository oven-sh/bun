//! The windows that a window knows about.

use bun_web::window_features::WindowFeatures;

use super::navigate::{Options, Source, is_above};
use super::*;
use crate::api::frames;

impl Window {
    pub(super) fn has_opaque_origin(&self) -> bool {
        self.host().origin().is_some_and(|it| it == "null")
    }

    fn window_around(&self) -> Option<&Window> {
        Window::of(
            js_DomWindow::empty_frame(self)
                .and_then(Element::from_value)?
                .doc(),
        )
    }

    /// Itself, or the window that an empty frame is in.
    pub(crate) fn is_shown(&self) -> bool {
        core::iter::successors(Some(self), |it| it.window_around()).any(|it| it.surface() != 0)
    }

    pub(crate) fn get_parent<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        self.relative(&cx.heap, |it| Some(it.parent_or_itself()))
            .unwrap_or_else(|| self.window_around().unwrap_or(self).get_itself(&cx.heap))
    }

    pub(crate) fn get_top<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        self.relative(&cx.heap, |it| Some(it.top()))
            .unwrap_or_else(|| {
                core::iter::successors(Some(self), |it| it.window_around())
                    .last()
                    .unwrap_or(self)
                    .get_itself(&cx.heap)
            })
    }

    pub(crate) fn get_frame_element<'a>(&'a self, _: &mut Cx<'a>) -> Option<&'a Element> {
        let of_context = || {
            let (own, element) = (self.cluster()?, self.context()?.container()?.element());
            Window::of(self.context()?.container()?.around().doc())?
                .cluster()
                .filter(|it| it.origin() == own.origin())
                .map(|_| element)
        };
        js_DomWindow::empty_frame(self)
            .and_then(Element::from_value)
            .or_else(of_context)
            .filter(|_| !self.is_disposed())
    }

    pub(crate) fn get_length(&self) -> u32 {
        Ui::of(self.document()).map_or(0, frames::entry::frame_count)
    }

    pub(crate) fn get_opener<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        let related = self
            .context()
            .and_then(Context::opened_by)
            .filter(|_| self.knows_other_windows());
        let beside = || {
            self.opened_beside()
                .filter(|it| !it.is_disposed())
                .map(|it| it.window())
        };
        related
            .map_or_else(beside, |it| self.relative(&cx.heap, |_| Some(it)))
            .unwrap_or(JSValue::NULL)
    }

    /// The window whose realm it has.
    pub(super) fn opened_beside(&self) -> Option<&Window> {
        Window::from_value(js_DomWindow::opened_beside(self)?)
    }

    pub(crate) fn set_opener<'a>(&'a self, cx: &mut Cx<'a>, value: JsLocal<'a>) -> Result<'a> {
        unsafe extern "C" {
            safe fn Bun__DOM__replaceOpener(
                global: &bun_jsc::JSGlobalObject,
                window: JSValue,
                value: JSValue,
            );
        }
        if value.to_js().is_null() && self.knows_other_windows() {
            self.host().disown();
            return Ok(());
        }
        let (window, global) = (self.get_itself(&cx.heap), cx.global());
        Ok(bun_jsc::from_js_host_call_generic(global, || {
            Bun__DOM__replaceOpener(global, window, value.to_js())
        })?)
    }

    pub(crate) fn get_closed(&self, _: &mut Cx<'_>) -> bool {
        self.is_disposed() || self.host().is_closed()
    }

    pub(crate) fn get_name(&self, _: &mut Cx<'_>) -> DomString {
        let name = self.host().name().or_else(|| self.name.borrow().clone());
        let given = || {
            js_DomWindow::empty_frame(self)
                .and_then(Element::from_value)?
                .attr(atom!("name"))
        };
        name.map(|it| DomString::from_utf8(&it))
            .or_else(given)
            .unwrap_or_default()
    }

    pub(crate) fn set_name(&self, _: &mut Cx<'_>, name: &DomString) {
        let name = name.to_utf8();
        if self.name.borrow().as_deref() != Some(&*name)
            || !self.context().is_some_and(|it| it.has_name(&name))
        {
            self.name.replace(Some(name.to_string()));
            self.host().set_name(name.into_owned());
        }
    }

    /// <https://html.spec.whatwg.org/#window-open-steps>
    pub(crate) fn open<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        given: &DomString,
        target: &DomString,
        features: &DomString,
    ) -> Result<'a, JSValue> {
        if self.is_disposed() {
            return Ok(JSValue::NULL);
        }
        let source = host::entry(cx, self);
        let Some(url) = (if given.is_empty() {
            Some("about:blank".into())
        } else {
            source.resolve(cx, given)
        }) else {
            return Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!(
                    "Unable to open a window with invalid URL '{}'.",
                    given.to_utf8()
                ),
            ));
        };
        if source.is_unloading() || self.is_unloading() || self.has_unloading_part(&cx.heap) {
            return Ok(JSValue::NULL);
        }
        let (target, features) = (
            if target.is_empty() {
                "_blank".into()
            } else {
                target.to_utf8()
            },
            features.to_utf8(),
        );
        let WindowFeatures {
            noopener,
            noreferrer,
            ..
        } = WindowFeatures::parse(features.as_bytes());
        let is_keyword = is_above(&target) || target.eq_ignore_ascii_case("_self");
        let options = Options {
            source: Source::Script,
            referrer_policy: noreferrer.then(|| "no-referrer".into()),
            ..Default::default()
        };
        let found = host::navigate_other(
            cx,
            self,
            &target,
            (!given.is_empty()).then_some(&*url),
            &options,
            !noopener && !is_keyword,
        );
        if let host::Target::Window(found) = found {
            return Ok(if noopener && !is_keyword {
                JSValue::NULL
            } else {
                found
            });
        }
        if !is_keyword {
            let options = Options {
                has_text_activation: source.consume_activation(cx),
                ..Default::default()
            };
            return Ok(host::open(cx, source, &url, &target, &features, &options));
        }
        History::of(&cx.heap, source).navigate(
            cx,
            &url,
            Options {
                source: Source::Script,
                ..Default::default()
            },
            "",
        );
        Ok(source.get_itself(&cx.heap))
    }

    pub(crate) fn close(&self, _: &mut Cx<'_>) {
        self.host().close();
    }

    pub(crate) fn stop<'a>(&'a self, cx: &mut Cx<'a>) {
        entry::abort_navigation(cx, self);
        if let Some(it) = self.history_if_any() {
            it.planned.cancel();
            it.cancel_refresh();
        }
        crate::api::frames::stop(cx, self.document());
        if crate::api::loading::stop(cx, self.document()) {
            self.host().loaded(bun_web::host::Stage::Stopped);
        }
        self.host().stop();
    }

    pub(crate) fn ignores_opens<'a>(&'a self, heap: &JsHeap<'a>) -> bool {
        self.has_unloading_part(heap) && (self.is_unloading() || self.host().is_being_left())
    }

    fn has_unloading_part<'a>(&'a self, heap: &JsHeap<'a>) -> bool {
        let below = Ui::of(self.document())
            .map(|it| frames::below(heap, it))
            .unwrap_or_default();
        below
            .iter()
            .filter_map(|it| Window::of(it.doc()))
            .chain([self])
            .any(|it| it.is_unloading() && !it.is_disposed())
    }

    /// The window of the entry document.
    pub(crate) fn will_open_document<'a>(&'a self, cx: &mut Cx<'a>) -> &'a Window {
        let of_realm = WindowTarget::of_realm(self.realm(&cx.heap))
            .and_then(|it| it.downcast())
            .unwrap_or(self);
        let entry = if self.cluster().is_some() {
            host::entry(cx, self)
        } else {
            of_realm
        };
        if History::of(&cx.heap, self).cancel_immediate_refresh() || self.host().is_being_left() {
            crate::api::loading::abort_fetches(&cx.heap, self.document());
        }
        History::of(&cx.heap, self).opens.update(|it| it + 1);
        self.host().cancel_navigation();
        entry
    }

    pub(crate) fn has_opened_document<'a>(&'a self, cx: &mut Cx<'a>, entry: &'a Window) {
        if self.host().is_active() == Some(false) {
            return;
        }
        if !core::ptr::eq(entry, self) {
            let url = entry.url();
            entry::replace_url(
                cx,
                self,
                strings::split_once_char(url.as_bytes(), b'#').map_or(url.as_bytes(), |it| it.0),
            );
        }
        self.host().opened();
    }

    pub(crate) fn focus<'a>(&'a self, cx: &mut Cx<'a>) {
        let Some(ui) = Ui::of(self.document()) else {
            return;
        };
        if ui.focused_frame().is_some() {
            crate::api::ui::entry::reset_focus(cx, ui);
        }
        match ui.any_container() {
            Some(container) => container.focus(cx),
            None => self.host().focus_window(),
        }
    }

    pub(crate) fn request_resize<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a> {
        if !crate::api::core::metadata::sizes_container(self.document()) {
            return Err(dom_error(
                &cx.heap,
                DomError::NotAllowedError,
                "The document does not size the element that embeds it.",
            ));
        }
        frames::entry::fit_container(cx, self.document());
        Ok(())
    }

    /// <https://html.spec.whatwg.org/#named-access-on-the-window-object>
    pub(crate) fn named<'a>(&'a self, cx: &mut Cx<'a>, name: &Atom) -> JSValue {
        let framed = Ui::of(self.document()).filter(|it| it.frames().iter().next().is_some());
        let frame = framed.and_then(|it| frames::window_named(cx, it, &name.to_dom_string()));
        let absent = if framed.is_some() {
            JSValue::NULL
        } else {
            JSValue::UNDEFINED
        };
        frame
            .or_else(|| self.document().named_in_window(self.realm(&cx.heap), name))
            .unwrap_or(absent)
    }
}
