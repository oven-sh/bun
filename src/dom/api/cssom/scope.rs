//! <https://drafts.csswg.org/cssom/#css-style-sheet-collections>

use core::cell::{Cell, RefCell};

use bun_jsc::JSValue;
use bun_jsc::bindgen::{
    JsHeap, JsInterface, JsList, JsLocal, JsScope, ObservableArray, ObservableArrayOwner, Result,
};

use crate::api::core::{Doc, DomError, DomString, Edge, List, Node, dom_error};
use crate::generated_bindgen::cssom::{
    CSSStyleSheet, HasStyleSheets, InstructionStyle, StyleSheetList, js_StyleSheet,
    js_StyleSheetList,
};

/// Of a document or a shadow root.
#[derive(Default)]
struct IsStale(Cell<bool>);

/// Of a document.
#[derive(Default)]
struct Sheets {
    preferred_set: RefCell<DomString>,
    adopted_are_stale: Cell<bool>,
}

fn sheets_in<'a>(
    heap: &JsHeap<'a>,
    list: Option<List<'a>>,
) -> impl Iterator<Item = &'a CSSStyleSheet> {
    list.into_iter()
        .flat_map(List::values)
        .filter_map(|it| CSSStyleSheet::from_js(heap, it))
}

fn adopted<'a>(heap: &JsHeap<'a>, scope: &'a Node) -> Option<List<'a>> {
    // SAFETY: what `get_adopted_style_sheets` has made.
    let values = unsafe {
        JsLocal::<ObservableArray>::from_js_unchecked(heap, scope.edge(Edge::AdoptedSheets)?)
    }
    .values(heap)
    .ok()?;
    Some(List::from_fn(heap, values.len() as u32, |it| {
        values
            .get(it as usize)
            .map_or(JSValue::NULL, JsLocal::to_js)
    }))
}

/// Its sheets only follow it into templates and back, and between windows that have the same constructor.
pub(crate) fn scope_adopted<'a>(cx: &mut JsScope<'a>, scope: &'a Node, old: &'a Doc) {
    let (doc, owner) = (scope.doc(), old.edge(Edge::TemplateContentsOwner));
    let is_kept = owner.is_some() && owner == doc.edge(Edge::TemplateContentsOwner)
        || doc.is_rendered() && core::ptr::eq(doc.global(), old.global());
    if let Some(array) = scope.edge(Edge::AdoptedSheets).filter(|_| !is_kept) {
        // SAFETY: what `get_adopted_style_sheets` has made, and null is the empty list.
        let (array, none) = unsafe {
            (
                JsLocal::<ObservableArray>::from_js_unchecked(&cx.heap, array),
                JsList::<JsLocal>::from_cell(core::ptr::null_mut(), &cx.heap),
            )
        };
        if let Err(error) = array.replace(cx, none) {
            let error = error.into_js_error(cx.global());
            crate::api::events::report(cx, None, error);
        }
    }
}

/// Those of adopted and of injected sheets, and of sheets that scripts have filled.
pub(crate) fn rules_without_markup<'a>(heap: &JsHeap<'a>, scope: &'a Node) -> Vec<u8> {
    let filled = sheets_in(heap, scope.try_edge_list(Edge::Sheets)).filter(|it| {
        it.get_href().is_none()
            && js_StyleSheet::owner_node(it).is_some_and(|it| it.first_child().is_none())
    });
    let lists = filled
        .chain(sheets_in(heap, adopted(heap, scope)))
        .chain(sheets_in(heap, scope.try_edge_list(Edge::InjectedSheets)))
        .filter_map(|it| it.get_css_rules(heap).ok());
    let rules = lists.flat_map(|list| (0..list.get_length()).filter_map(|at| list.item(heap, at)));
    rules
        .map(|it| it.get_css_text())
        .collect::<Vec<_>>()
        .join(&b'\n')
}

pub(crate) fn sheets_changed<'a>(cx: &mut JsScope<'a>, scope: &'a Node) {
    if scope.is_rendered() && !scope.extra::<IsStale>().0.replace(true) {
        let doc = scope.doc();
        doc.edge_list(&cx.heap, Edge::StaleScopes)
            .push(&cx.heap, scope.to_js());
        doc.set_needs_sync();
        doc.invalidate(cx);
    }
}

pub(super) fn adopted_sheet_changed<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    if !doc.extra::<Sheets>().adopted_are_stale.replace(true) {
        doc.set_needs_sync();
        doc.invalidate(cx);
    }
}

pub(crate) fn shadow_root_rendered<'a>(cx: &mut JsScope<'a>, root: &'a Node) {
    if root.edge(Edge::AdoptedSheets).is_some() {
        sheets_changed(cx, root);
    }
}

pub(crate) fn shadow_root_unrendered(root: &Node) {
    root.try_extra::<IsStale>()
        .into_iter()
        .for_each(|it| it.0.set(false));
}

fn flush_scope<'a>(heap: &JsHeap<'a>, scope: &'a Node) {
    let (doc, adopted) = (scope.doc(), adopted(heap, scope));
    for sheet in sheets_in(heap, adopted) {
        let adopters =
            js_StyleSheet::adopted_in(sheet).map_or_else(|| List::new(heap), List::from_value);
        js_StyleSheet::set_adopted_in(sheet, adopters.to_js());
        if !adopters.contains(doc.to_js()) {
            adopters.push(heap, doc.to_js());
        }
    }
    let lists = [scope.try_edge_list(Edge::Sheets), adopted];
    scope.engine(|engine, id| {
        let (mut compiled, mut of_user) = (Vec::new(), Vec::new());
        if let Some(keys) = scope.try_extra::<InjectedKeys>() {
            for (sheet, key) in
                sheets_in(heap, scope.try_edge_list(Edge::InjectedSheets)).zip(&*keys.0.borrow())
            {
                sheet.get().collect(
                    engine,
                    sheet.scoping_root(),
                    if key.1 { &mut of_user } else { &mut compiled },
                );
            }
            engine.set_user_sheets(of_user);
        }
        lists
            .into_iter()
            .flat_map(|it| sheets_in(heap, it))
            .for_each(|it| it.get().collect(engine, it.scoping_root(), &mut compiled));
        engine.set_sheets(id, &compiled);
    });
}

/// Tells the engine.
pub(crate) fn flush_sheets<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    if let Some(stale) = doc
        .try_edge_list(Edge::StaleScopes)
        .filter(|it| !it.is_empty())
    {
        for scope in stale
            .nodes()
            .filter(|it| it.doc() == doc && it.extra::<IsStale>().0.take() && it.is_rendered())
        {
            flush_scope(heap, scope);
        }
        stale.clear(heap);
    }
    if doc
        .try_extra::<Sheets>()
        .is_some_and(|it| it.adopted_are_stale.take())
    {
        let scopes: Vec<_> = doc.engine(|engine, _| engine.styles.scopes.keys().copied().collect());
        scopes
            .into_iter()
            .filter_map(|it| doc.rendered_node(it))
            .filter(|it| it.edge(Edge::AdoptedSheets).is_some())
            .for_each(|it| flush_scope(heap, it));
    }
}

pub(crate) fn sheet_of<'a>(heap: &JsHeap<'a>, owner: &'a Node) -> Option<&'a CSSStyleSheet> {
    CSSStyleSheet::from_js(heap, owner.edge(Edge::Sheet)?)
}

impl InstructionStyle {
    pub(crate) fn get_sheet<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a CSSStyleSheet> {
        sheet_of(heap, self)
    }
}

fn list_in_scope<'a>(cx: &mut JsScope<'a>, owner: &'a Node, sheet: &'a CSSStyleSheet) {
    let Some(scope) = owner.scope() else { return };
    let list = scope.edge_list(&cx.heap, Edge::Sheets);
    let precedes = |index: u32| {
        CSSStyleSheet::from_js(&cx.heap, list.get(index))
            .and_then(|it| js_StyleSheet::owner_node(it))
            .is_none_or(|it| owner.compare_order(it).is_gt())
    };
    let (mut index, mut end) = (0, list.len());
    if end > 0 && precedes(end - 1) {
        index = end;
    }
    while index < end {
        let middle = index.midpoint(end);
        match precedes(middle) {
            true => index = middle + 1,
            false => end = middle,
        }
    }
    list.insert(&cx.heap, index, sheet.to_js());
    js_StyleSheet::set_scope(sheet, Some(scope));
    sheets_changed(cx, scope);
}

fn unlist<'a>(cx: &mut JsScope<'a>, sheet: &'a CSSStyleSheet) {
    let Some(scope) = js_StyleSheet::scope(sheet) else {
        return;
    };
    scope
        .edge_list(&cx.heap, Edge::Sheets)
        .remove(&cx.heap, sheet.to_js());
    js_StyleSheet::set_scope(sheet, None);
    sheets_changed(cx, scope);
}

fn update_disabled(sheet: &CSSStyleSheet, doc: &Doc) {
    let title = sheet.title.borrow();
    if !title.is_empty() {
        sheet.get().is_disabled.set(
            !sheet.is_explicitly_enabled.get()
                && *title != *doc.extra::<Sheets>().preferred_set.borrow(),
        );
    }
}

fn set_title(owner: &Node, sheet: &CSSStyleSheet, title: DomString) {
    if owner.scope().is_some_and(|it| it.as_doc().is_some()) {
        sheet.title.replace(title);
    }
}

/// <https://drafts.csswg.org/cssom/#add-a-css-style-sheet>
pub(crate) fn add_sheet<'a>(
    cx: &mut JsScope<'a>,
    owner: &'a Node,
    sheet: &'a CSSStyleSheet,
    media: &[u8],
    title: DomString,
    is_explicitly_enabled: bool,
) {
    remove_sheet(cx, owner);
    owner.set_edge(&cx.heap, Edge::Sheet, sheet.to_js());
    js_StyleSheet::set_owner_node(sheet, Some(owner));
    sheet.get().set_media(media);
    sheet.is_explicitly_enabled.set(is_explicitly_enabled);
    set_title(owner, sheet, title);
    update_disabled(sheet, owner.doc());
    list_in_scope(cx, owner, sheet);
}

/// <https://drafts.csswg.org/cssom/#remove-a-css-style-sheet>
pub(crate) fn remove_sheet<'a>(cx: &mut JsScope<'a>, owner: &'a Node) {
    let Some(sheet) = sheet_of(&cx.heap, owner) else {
        return;
    };
    unlist(cx, sheet);
    js_StyleSheet::set_owner_node(sheet, None);
    owner.clear_edge(&cx.heap, Edge::Sheet);
}

/// For both halves of `moveBefore`.
pub(crate) fn owner_moved<'a>(cx: &mut JsScope<'a>, owner: &'a Node, is_back: bool) {
    let Some(sheet) = sheet_of(&cx.heap, owner) else {
        return;
    };
    unlist(cx, sheet);
    if is_back {
        list_in_scope(cx, owner, sheet);
    }
}

pub(crate) fn retitle<'a>(heap: &JsHeap<'a>, owner: &'a Node, title: &DomString) {
    sheet_of(heap, owner)
        .into_iter()
        .for_each(|it| set_title(owner, it, title.clone()));
}

/// <https://drafts.csswg.org/cssom/#change-the-preferred-css-style-sheet-set-name>
pub(crate) fn prefer_sheets_titled<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    title: DomString,
    replaces: bool,
) {
    let preferred = &doc.extra::<Sheets>().preferred_set;
    if !title.is_empty() && (replaces || preferred.borrow().is_empty()) {
        preferred.replace(title);
        sheets_in(&cx.heap, doc.try_edge_list(Edge::Sheets))
            .for_each(|it| update_disabled(it, doc));
        sheets_changed(cx, doc);
    }
}

/// Of the sheets in `Edge::InjectedSheets`, in their order, and whether they have the origin of the user.
#[derive(Default)]
struct InjectedKeys(RefCell<Vec<(u32, bool)>>);

/// The page does not see it. It takes the place of the one with that key.
pub(crate) fn inject_sheet<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    key: u32,
    new: Option<(&[u8], bool)>,
) {
    let (sheets, keys) = (
        doc.edge_list(&cx.heap, Edge::InjectedSheets),
        &doc.extra::<InjectedKeys>().0,
    );
    let old = keys.borrow().iter().position(|it| it.0 == key);
    if let Some(at) = old {
        keys.borrow_mut().remove(at);
        sheets.remove(&cx.heap, sheets.get(at as u32));
    }
    if let Some((text, is_of_user)) = new {
        keys.borrow_mut().push((key, is_of_user));
        sheets.push(
            &cx.heap,
            super::create_sheet(&cx.heap, doc, text, doc.base_url().to_utf8().as_bytes()).to_js(),
        );
    }
    sheets_changed(cx, doc);
}

impl StyleSheetList {
    fn sheets(&self) -> Option<List<'_>> {
        js_StyleSheetList::scope(self)?.try_edge_list(Edge::Sheets)
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.sheets().map_or(0, List::len)
    }

    pub(crate) fn indexed_get<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        index: u32,
    ) -> Option<&'a CSSStyleSheet> {
        CSSStyleSheet::from_js(heap, self.sheets()?.get(index))
    }

    pub(crate) fn item<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a CSSStyleSheet> {
        self.indexed_get(heap, index)
    }
}

impl HasStyleSheets {
    pub(crate) fn get_style_sheets<'a>(&'a self, heap: &JsHeap<'a>) -> &'a StyleSheetList {
        let list = self.same_object(heap, Edge::StyleSheetList, || {
            let made = js_StyleSheetList::create(self.realm(heap), StyleSheetList::default());
            js_StyleSheetList::set_scope(made, Some(self));
            made.to_js()
        });
        StyleSheetList::from_js(heap, list).expect("it was made")
    }

    pub(crate) fn get_adopted_style_sheets<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> JsLocal<'a, ObservableArray> {
        let array = self.same_object(heap, Edge::AdoptedSheets, || {
            self.realm(heap)
                .create_observable_array::<Node>(self)
                .to_js()
        });
        // SAFETY: what is made above.
        unsafe { JsLocal::<ObservableArray>::from_js_unchecked(heap, array) }
    }

    pub(crate) fn set_adopted_style_sheets<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: JsList<'a, &'a CSSStyleSheet>,
    ) -> Result<'a, ()> {
        self.get_adopted_style_sheets(&cx.heap).replace(cx, value)
    }
}

/// <https://drafts.csswg.org/cssom/#dom-documentorshadowroot-adoptedstylesheets>
impl ObservableArrayOwner for Node {
    fn will_set<'a>(&self, cx: &mut JsScope<'a>, value: JsLocal<'a>, _: u32) -> Result<'a, ()> {
        let sheet = CSSStyleSheet::from_js(&cx.heap, value.to_js()).ok_or_else(|| {
            cx.heap
                .type_error(format_args!("The value is not of type 'CSSStyleSheet'."))
        })?;
        let refuse = |message| dom_error(&cx.heap, DomError::NotAllowedError, message);
        let made_for = js_StyleSheet::constructor_document(sheet)
            .ok_or_else(|| refuse("Can't adopt non-constructed stylesheets."))?;
        // Windows that have the same constructor cannot say which of them a sheet is for.
        let is_any_window =
            self.doc().is_rendered() && core::ptr::eq(self.doc().global(), made_for.global());
        (made_for == self.doc() || is_any_window).ok_or_else(|| {
            refuse("Sharing constructed stylesheets in multiple documents is not allowed")
        })?;
        self.will_delete(cx, value, 0)
    }

    fn will_delete<'a>(&self, cx: &mut JsScope<'a>, _: JsLocal<'a>, _: u32) -> Result<'a, ()> {
        // SAFETY: the array holds it.
        sheets_changed(cx, unsafe { Node::from_cell(self.to_js()) });
        Ok(())
    }
}
