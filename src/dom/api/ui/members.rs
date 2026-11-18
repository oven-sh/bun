//! What elements and documents have for scripts.

use super::activation::{self, Click};
use super::focus::{self, Cause};
use super::prelude::*;
use super::{details, drag, fullscreen, pointer, popover};
use crate::api::forms::{self, InputType, internals::ElementInternals};
use crate::generated_bindgen::interaction::*;

impl UserActivation {
    pub(crate) fn get_has_been_active(&self) -> bool {
        js_UserActivation::ui(self).is_some_and(|it| it.activation.has_been_active.get())
    }

    pub(crate) fn get_is_active(&self) -> bool {
        js_UserActivation::ui(self).is_some_and(Ui::has_transient_activation)
    }
}

impl ElementFullscreen {
    pub(crate) fn request_fullscreen<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        _: &FullscreenOptions,
    ) -> bindgen::Result<'a, JSValue> {
        fullscreen::request(cx, self, false)
    }

    pub(crate) fn request_prefixed<'a>(&'a self, cx: &mut Cx<'a>, _: &FullscreenOptions) {
        _ = fullscreen::request(cx, self, true);
    }
}

impl Focusable {
    pub(crate) fn get_tab_index(&self) -> i32 {
        let is_focusable_by_default = match self.tag() {
            atom!("a")
            | atom!("area")
            | atom!("button")
            | atom!("frame")
            | atom!("iframe")
            | atom!("input")
            | atom!("object")
            | atom!("select")
            | atom!("textarea") => true,
            _ => details::is_summary(self),
        };
        self.integer(atom!("tabindex"))
            .unwrap_or(if is_focusable_by_default { 0 } else { -1 })
    }

    pub(crate) fn set_tab_index<'a>(&'a self, cx: &mut Cx<'a>, index: i32) {
        self.set_attr(
            cx,
            atom!("tabindex"),
            DomString::from(index.to_string().as_str()),
        );
    }

    pub(crate) fn focus<'a>(&'a self, cx: &mut Cx<'a>, options: &FocusOptions) {
        focus::focus(
            cx,
            self,
            Cause::Script,
            focus::Options {
                prevents_scroll: options.prevent_scroll,
                leaves_focused_alone: true,
                is_visible: options.focus_visible,
            },
        );
    }

    pub(crate) fn blur<'a>(&'a self, cx: &mut Cx<'a>) {
        focus::blur(cx, self);
    }
}

fn form_to_inherit_from(element: &Element) -> Option<&Element> {
    match element.html_tag() {
        atom!("button")
        | atom!("fieldset")
        | atom!("input")
        | atom!("output")
        | atom!("select")
        | atom!("textarea") => forms::form_owner(element),
        _ => None,
    }
}

fn capitalization(element: &Element) -> Known {
    match element.keyword(atom!("autocapitalize")) {
        None | Some(atom!("")) => form_to_inherit_from(element).map_or(atom!(""), capitalization),
        Some(atom!("off") | atom!("none")) => atom!("none"),
        Some(it @ (atom!("words") | atom!("characters"))) => it,
        Some(_) => atom!("sentences"),
    }
}

fn editable_state(node: &Node) -> Known {
    match node.keyword(atom!("contenteditable")) {
        Some(atom!("")) => atom!("true"),
        Some(it @ (atom!("true") | atom!("false") | atom!("plaintext-only"))) => it,
        _ => atom!("inherit"),
    }
}

pub(crate) fn is_spellchecked(node: &Node) -> bool {
    let says = |it: &Node| match it.keyword(atom!("spellcheck"))? {
        atom!("") | atom!("true") => Some(true),
        atom!("false") => Some(false),
        _ => None,
    };
    core::iter::successors(Some(node), |it| {
        it.parent().and_then(|_| it.parent_or_host())
    })
    .find_map(says)
    .unwrap_or(true)
}

impl Interactive {
    fn set_keyword<'a>(&'a self, cx: &mut Cx<'a>, name: Known, value: Known) {
        self.set_attr(cx, name, DomString::from(value.as_str()));
    }

    pub(crate) fn click<'a>(&'a self, cx: &mut Cx<'a>) {
        activation::click(cx, self, Trusted::No, Click::default());
    }

    pub(crate) fn get_draggable(&self) -> bool {
        drag::is_draggable(self)
    }

    pub(crate) fn set_draggable<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        self.set_keyword(
            cx,
            atom!("draggable"),
            if value { atom!("true") } else { atom!("false") },
        );
    }

    pub(crate) fn get_spellcheck(&self) -> bool {
        is_spellchecked(self)
    }

    pub(crate) fn set_spellcheck<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        self.set_keyword(
            cx,
            atom!("spellcheck"),
            if value { atom!("true") } else { atom!("false") },
        );
    }

    pub(crate) fn get_autocorrect(&self) -> bool {
        let said = || {
            self.keyword(atom!("autocorrect"))
                .or_else(|| form_to_inherit_from(self)?.keyword(atom!("autocorrect")))
        };
        !matches!(
            forms::input_type(self),
            Some(InputType::Url | InputType::Email | InputType::Password)
        ) && said() != Some(atom!("off"))
    }

    pub(crate) fn set_autocorrect<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        self.set_keyword(
            cx,
            atom!("autocorrect"),
            if value { atom!("on") } else { atom!("off") },
        );
    }

    pub(crate) fn get_autocapitalize(&self) -> Known {
        capitalization(self)
    }

    pub(crate) fn set_autocapitalize<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("autocapitalize"), value);
    }

    pub(crate) fn get_writing_suggestions(&self) -> Known {
        let said = core::iter::successors(Some::<&Node>(self), |it| it.parent_or_host())
            .find_map(|it| it.keyword(atom!("writingsuggestions")));
        if said == Some(atom!("false")) {
            atom!("false")
        } else {
            atom!("true")
        }
    }

    pub(crate) fn set_writing_suggestions<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("writingsuggestions"), value);
    }

    pub(crate) fn get_content_editable(&self) -> Known {
        editable_state(self)
    }

    pub(crate) fn set_content_editable<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: &DomString,
    ) -> bindgen::Result<'a, ()> {
        match Known::from_latin1_lowercased(value.latin1().unwrap_or(b"?")) {
            atom!("inherit") => _ = self.remove_attr(cx, atom!("contenteditable")),
            it @ (atom!("true") | atom!("false") | atom!("plaintext-only")) => {
                self.set_keyword(cx, atom!("contenteditable"), it)
            }
            _ => {
                return Err(dom_error(
                    &cx.heap,
                    DomError::SyntaxError,
                    "The value provided is not valid.",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn get_is_content_editable(&self) -> bool {
        let state = self
            .inclusive_ancestors()
            .map(editable_state)
            .find(|it| *it != atom!("inherit"));
        state.map_or_else(
            || self.doc().is(DocFlags::DESIGN_MODE),
            |it| it != atom!("false"),
        )
    }

    pub(crate) fn get_popover(&self) -> Option<Known> {
        popover::state(self).map(popover::Mode::name)
    }

    pub(crate) fn set_popover<'a>(&'a self, cx: &mut Cx<'a>, value: Option<DomString>) {
        match value {
            Some(value) => self.set_attr(cx, atom!("popover"), value),
            None => _ = self.remove_attr(cx, atom!("popover")),
        }
    }

    pub(crate) fn show_popover<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: &ShowPopoverOptions<'a>,
    ) -> bindgen::Result<'a, ()> {
        let result = popover::show(cx, self, options.source.map(|it| &**it));
        refused(&cx.heap, result)
    }

    pub(crate) fn hide_popover<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, ()> {
        let result = popover::hide(cx, self, Default::default());
        refused(&cx.heap, result)
    }

    pub(crate) fn toggle_popover<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        options: Option<TogglePopoverOptionsOrBoolean<'a>>,
    ) -> bindgen::Result<'a, bool> {
        let (force, source) = match options {
            Some(TogglePopoverOptionsOrBoolean::Options(it)) => (it.force, it.source),
            Some(TogglePopoverOptionsOrBoolean::Force(it)) => (Some(it), None),
            None => (None, None),
        };
        let result = popover::toggle(cx, self, force, source.map(|it| &**it));
        refused(&cx.heap, result)
    }

    pub(crate) fn attach_internals<'a>(
        &'a self,
        cx: &mut Cx<'a>,
    ) -> bindgen::Result<'a, &'a ElementInternals> {
        forms::internals::attach(cx, self)
    }
}

impl DocumentUi {
    pub(crate) fn get_design_mode(&self) -> Known {
        if self.is(DocFlags::DESIGN_MODE) {
            atom!("on")
        } else {
            atom!("off")
        }
    }

    pub(crate) fn set_design_mode<'a>(&'a self, cx: &mut Cx<'a>, value: &DomString) {
        let on = value.eq_ignore_ascii_case("on");
        if on || value.eq_ignore_ascii_case("off") {
            self.set_doc_flags(DocFlags::DESIGN_MODE, on);
            if let Some(root) = self.document_element() {
                root.synced_engine(cx, |engine, id| {
                    engine.is_in_design_mode = on;
                    engine.update_derived_state(id, false);
                });
            }
            if Ui::of(self).is_some() {
                crate::api::cssom::inject_sheet(
                    cx,
                    self,
                    0,
                    on.then_some((b":root{-webkit-user-modify:read-write}", false)),
                );
            }
        }
    }

    pub(crate) fn has_focus(&self) -> bool {
        Ui::of(self).is_some_and(|it| it.is_focused.get())
    }

    pub(crate) fn get_fullscreen_enabled<'a>(&'a self, _: &mut Cx<'a>) -> bool {
        fullscreen::is_enabled(self)
    }

    pub(crate) fn get_fullscreen(&self) -> bool {
        Ui::left_in(self).and_then(fullscreen::element).is_some()
    }

    pub(crate) fn exit_fullscreen<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, JSValue> {
        fullscreen::exit(cx, self)
    }

    pub(crate) fn webkit_exit_fullscreen<'a>(&'a self, cx: &mut Cx<'a>) {
        _ = fullscreen::exit(cx, self);
    }

    pub(crate) fn webkit_cancel_full_screen<'a>(&'a self, cx: &mut Cx<'a>) {
        Ui::of(self).map(|it| fullscreen::exit_fully(cx, it));
    }

    pub(crate) fn exit_pointer_lock<'a>(&'a self, cx: &mut Cx<'a>) {
        if let Some(it) = Ui::of(self).filter(|it| it.mouse().lock().is_some()) {
            pointer::set_lock(cx, it, None);
        }
    }
}

impl ScopeUi {
    fn seen<'a>(&'a self, element: Option<&'a Element>) -> Option<&'a Node> {
        Some(element?.retarget(Some(self))).filter(|it| it.root() == &**self)
    }

    pub(crate) fn get_active_element(&self) -> Option<&Node> {
        self.seen(focus::focused(self.doc())).or_else(|| {
            self.as_doc()
                .and_then(|it| it.body().or_else(|| it.document_element()))
                .map(|it| &**it)
        })
    }

    pub(crate) fn get_fullscreen_element(&self) -> Option<&Node> {
        self.seen(Ui::left_in(self.doc()).and_then(fullscreen::element))
    }

    pub(crate) fn get_pointer_lock_element(&self) -> Option<&Node> {
        self.seen(Ui::of(self.doc())?.mouse().lock())
    }
}
