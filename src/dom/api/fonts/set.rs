//! <https://drafts.csswg.org/css-font-loading/#FontFaceSet-interface>

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};

use super::{host, promise};
use crate::api::core::{
    Atom, Doc, DocFlags, DomError, Edge, EventTarget, Known, List, ReadyState, atom, dom_error,
    seams,
};
use crate::api::events::{Event, EventInit, Trusted, dispatch};
use crate::api::{cssom, on_behalf};
use crate::declarations::{Accepts, DeclarationList, Key, Specified};
use crate::font_face;
use crate::generated_bindgen::fonts::*;
use crate::hooks::family_name;
use crate::properties::{Id, Prop};
use crate::sheet::{Wide, Within};
use crate::types::{FontStretch, FontStyle};
use crate::values::{Css, Ctx, eq, parse_all, text};

#[repr(C)]
pub(crate) struct FontFaceSet {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_FontFaceSet::Fields,
    scope: u32,
    is_of_worker: bool,
    /// What each of `ofRules` was made for.
    rules: RefCell<Vec<Rc<font_face::FontFace>>>,
    /// The version of the rules that the entries are for.
    listed: Cell<Option<u32>>,
    pruned: Cell<Option<u32>>,
}

fn faces(list: List<'_>) -> impl Iterator<Item = &FontFace> {
    // SAFETY: the list has faces.
    list.values()
        .map(|it| unsafe { FontFace::from_js_unchecked(it) })
}

fn list<'a>(field: Option<JSValue>) -> List<'a> {
    List::from_value(field.expect("set when it is made"))
}

fn from_task<'a>(captured: JSValue) -> &'a FontFaceSet {
    // SAFETY: the task has captured a set, and keeps it alive.
    unsafe { FontFaceSet::from_js_unchecked(captured) }
}

#[repr(C)]
pub(crate) struct FontFaceSetLoadEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_FontFaceSetLoadEvent::Fields,
}

impl FontFaceSetLoadEvent {
    fn with_faces<'a>(&'a self, heap: &JsHeap<'a>, faces: List<'a>) -> &'a Self {
        let frozen = heap
            .create_array(faces.values(), |heap, it| Ok(JsLocal::new(heap, it)))
            .and_then(|it| heap.freeze_array(it));
        frozen
            .into_iter()
            .for_each(|it| js_FontFaceSetLoadEvent::set_fontfaces(self, it.to_js()));
        self
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &FontFaceSetLoadEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(
            kind,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let (made, faces) = (
            structure.create(
                heap,
                Self {
                    base,
                    fields: Default::default(),
                },
            ),
            List::new(heap),
        );
        init.fontfaces
            .iter()
            .flat_map(|it| it.iter())
            .for_each(|it| faces.push(heap, it.to_js()));
        made.with_faces(heap, faces)
    }
}

impl FontFaceSet {
    fn of<'a>(cx: &mut JsScope<'a>, doc: &'a Doc, of_worker: Option<u32>) -> &'a Self {
        if let Some(known) = Self::if_any(doc) {
            return known;
        }
        let (realm, is_of_worker) = (doc.realm(&cx.heap), of_worker.is_some());
        let scope = of_worker.unwrap_or_else(|| doc.engine(|engine, _| engine.fonts.scope));
        let made = js_FontFaceSet::create(
            realm,
            FontFaceSet {
                base: Default::default(),
                fields: Default::default(),
                scope,
                is_of_worker,
                rules: RefCell::default(),
                listed: None.into(),
                pruned: None.into(),
            },
        );
        doc.set_edge(realm, Edge::Fonts, made.to_js());
        js_FontFaceSet::set_document(made, Some(doc));
        js_FontFaceSet::set_of_rules(made, List::new(realm).to_js());
        js_FontFaceSet::set_loading(made, List::new(realm).to_js());
        js_FontFaceSet::set_done(made, List::new(realm).to_js());
        js_FontFaceSet::set_ready(made, realm.create_promise().to_js());
        if doc.ready_state() == ReadyState::Complete {
            made.settle(cx);
        }
        made
    }

    fn if_any(doc: &Doc) -> Option<&Self> {
        // SAFETY: what is made above.
        doc.edge(Edge::Fonts)
            .map(|it| unsafe { Self::from_js_unchecked(it) })
    }

    fn doc(&self) -> &Doc {
        js_FontFaceSet::document(self).expect("set when it is made")
    }

    pub(super) fn scope(&self) -> u32 {
        self.scope
    }

    pub(super) fn is_in_use(&self) -> bool {
        self.is_of_worker || self.doc().is_fully_active()
    }

    pub(super) fn fonts_changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.doc().is(DocFlags::HAS_PAGE) {
            self.doc().engine(|engine, _| engine.fonts_changed());
            self.doc().invalidate(cx);
        }
    }

    fn join<'a>(&'a self, heap: &JsHeap<'a>, face: &'a FontFace) {
        face.sets().push(heap, self.to_js());
        face.registered.borrow_mut().push(None);
    }

    fn leave<'a>(&'a self, cx: &mut JsScope<'a>, face: &'a FontFace) {
        let Some(index) = face.sets().position(self.to_js()) else {
            return;
        };
        face.sets().remove_range(&cx.heap, index, 1);
        let registered = face.registered.borrow_mut().remove(index as usize);
        self.finished(cx, face);
        if let Some(id) = registered {
            font_face::unregister(id);
            self.fonts_changed(cx);
        }
    }

    fn face_for<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        rule: &Rc<font_face::FontFace>,
        order: usize,
    ) -> &'a FontFace {
        let (all, known) = (
            list(js_FontFaceSet::of_rules(self)),
            self.rules.borrow().iter().position(|it| it == rule),
        );
        if let Some(index) = known {
            // SAFETY: the list has faces.
            return unsafe { FontFace::from_js_unchecked(all.get(index as u32)) };
        }
        let made = FontFace::of_rule(self.realm(heap), Rc::clone(rule));
        made.order.set(order as u32);
        all.push(heap, made.to_js());
        self.rules.borrow_mut().push(Rc::clone(rule));
        self.join(heap, made);
        made
    }

    /// Those of style sheets come first.
    pub(crate) fn prepare_entries<'a>(&'a self, heap: &JsHeap<'a>) {
        cssom::flush_sheets(heap, self.doc());
        let version = Some(self.doc().engine(|engine, _| engine.font_faces_version));
        if !self.doc().is(DocFlags::HAS_PAGE) || self.listed.replace(version) == version {
            return;
        }
        let entries = js_FontFaceSet::backing(heap, self);
        let Ok(old) = entries.values(heap) else {
            return;
        };
        _ = entries.clear(heap);
        for (order, rule) in self
            .doc()
            .engine(|engine, _| engine.font_faces())
            .iter()
            .enumerate()
        {
            _ = entries.add(heap, self.face_for(heap, rule, order).to_js());
        }
        old.iter()
            .filter_map(|it| FontFace::from_js(heap, it.to_js()))
            .filter(|it| !it.is_css_connected)
            .for_each(|it| _ = entries.add(heap, it.to_js()));
    }

    fn forget_removed_rules<'a>(&'a self, cx: &mut JsScope<'a>, rules: &[Rc<font_face::FontFace>]) {
        let all = list(js_FontFaceSet::of_rules(self));
        for index in (0..all.len()).rev() {
            // SAFETY: the list has faces.
            let face = unsafe { FontFace::from_js_unchecked(all.get(index)) };
            let Some(order) = rules
                .iter()
                .rposition(|it| *it == self.rules.borrow()[index as usize])
            else {
                all.remove_range(&cx.heap, index, 1);
                self.rules.borrow_mut().remove(index as usize);
                self.leave(cx, face);
                continue;
            };
            let registered = face
                .sets()
                .position(self.to_js())
                .and_then(|it| face.registered.borrow()[it as usize]);
            if face.order.replace(order as u32) != order as u32
                && registered.is_some_and(|it| font_face::reorder(it, order as u32))
            {
                self.fonts_changed(cx);
            }
        }
    }

    fn fire<'a>(&'a self, cx: &mut JsScope<'a>, kind: Known, faces: List<'a>) {
        let event = js_FontFaceSetLoadEvent::create(
            self.realm(&cx.heap),
            FontFaceSetLoadEvent {
                base: Event::base(kind, EventInit::default(), Trusted::Yes),
                fields: Default::default(),
            },
        );
        dispatch(cx, self, event.with_faces(&cx.heap, faces));
    }

    /// <https://drafts.csswg.org/css-font-loading/#switch-the-fontfaceset-to-loading>
    pub(super) fn started<'a>(&'a self, cx: &mut JsScope<'a>, face: &'a FontFace) {
        let loading = list(js_FontFaceSet::loading(self));
        loading.push(&cx.heap, face.to_js());
        on_behalf::delay_load(cx, self.doc());
        if loading.len() > 1 {
            return;
        }
        if !promise(&cx.heap, js_FontFaceSet::ready(self)).is_pending() {
            js_FontFaceSet::set_ready(self, self.realm(&cx.heap).create_promise().to_js());
        }
        host::queue_task(
            cx,
            self.doc(),
            [self.to_js(), List::new(self.realm(&cx.heap)).to_js()],
            |cx, [this, none]| from_task(this).fire(cx, atom!("loading"), List::from_value(none)),
        );
    }

    /// <https://drafts.csswg.org/css-font-loading/#switch-the-fontfaceset-to-loaded>
    pub(super) fn finished<'a>(&'a self, cx: &mut JsScope<'a>, face: &'a FontFace) {
        let (loading, done) = (
            list(js_FontFaceSet::loading(self)),
            list(js_FontFaceSet::done(self)),
        );
        if !loading.remove(&cx.heap, face.to_js()) {
            return;
        }
        done.push(&cx.heap, face.to_js());
        on_behalf::allow_load(cx, self.doc());
        if !loading.is_empty() {
            return;
        }
        js_FontFaceSet::set_done(self, List::new(&cx.heap).to_js());
        host::queue_task(
            cx,
            self.doc(),
            [self.to_js(), done.to_js()],
            |cx, [this, done]| {
                let this = from_task(this);
                this.settle(cx);
                for (kind, status) in [
                    (atom!("loadingdone"), FontFaceLoadStatus::Loaded),
                    (atom!("loadingerror"), FontFaceLoadStatus::Error),
                ] {
                    let these = List::new(this.realm(&cx.heap));
                    faces(List::from_value(done))
                        .filter(|it| it.status.get() == status)
                        .for_each(|it| these.push(&cx.heap, it.to_js()));
                    if status == FontFaceLoadStatus::Loaded || !these.is_empty() {
                        this.fire(cx, kind, these);
                    }
                }
            },
        );
    }

    fn settle<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.get_status() == FontFaceSetLoadStatus::Loaded {
            _ = promise(&cx.heap, js_FontFaceSet::ready(self)).resolve(cx, self.to_js());
        }
    }

    /// <https://drafts.csswg.org/css-font-loading/#find-the-matching-font-faces>
    fn matching<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        font: &[u8],
        characters: &[u8],
    ) -> Result<'a, List<'a>> {
        let parsed = Prop::from_name(b"font").and_then(|it| {
            Specified::parse(
                Accepts::Properties(Within::Style),
                Key::Property(it),
                font,
                false,
            )
        });
        let parsed =
            parsed.filter(|_| Wide::of(font).is_none() && !crate::cssom::has_variables(font));
        let mut longhands = DeclarationList::default();
        longhands.set(&Rc::new(parsed.ok_or_else(|| {
            dom_error(
                heap,
                DomError::SyntaxError,
                &format!("Could not resolve '{}' as a font.", text(font)),
            )
        })?));
        let [families, weight, style, stretch] = [
            Id::FontFamily,
            Id::FontWeight,
            Id::FontStyle,
            Id::FontStretch,
        ]
        .map(|it| longhands.get(Key::Property(Prop::Long(it))));
        let weight = match &*weight {
            b"bold" | b"bolder" => 700.0,
            b"lighter" => 100.0,
            other => text(other).parse().unwrap_or(400.0),
        };
        let (stretch, style) = (
            parse_all(&stretch, |p| FontStretch::parse(p, &Ctx::dummy())),
            parse_all(&style, |p| FontStyle::parse(p, &Ctx::dummy())),
        );
        let wanted = [
            stretch.map_or(100.0, |it| it.0),
            style.map_or(0.0, FontStyle::slope),
            weight,
        ];
        self.prepare_entries(heap);
        let (entries, found) = (
            js_FontFaceSet::backing(heap, self).values(heap)?,
            List::new(self.realm(heap)),
        );
        for family in crate::grammar::split_list(&families)
            .into_iter()
            .filter_map(|it| parse_all(it, family_name))
        {
            let of_family = || {
                entries
                    .iter()
                    .filter_map(|it| FontFace::from_js(heap, it.to_js()))
                    .filter(|it| eq(&family, &it.face.borrow().family))
            };
            let best = of_family()
                .map(|it| it.face.borrow().distance(wanted))
                .min();
            let is_match = |it: &&FontFace| {
                Some(it.face.borrow().distance(wanted)) == best
                    && it.face.borrow().covers_any(text(characters))
            };
            of_family()
                .filter(is_match)
                .for_each(|it| found.push(heap, it.to_js()));
        }
        Ok(found)
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        face: &'a FontFace,
    ) -> Result<'a, &'a Self> {
        if face.sets().contains(self.to_js()) {
            return Ok(self);
        }
        if face.is_css_connected {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidModificationError,
                "Cannot add a CSS-connected FontFace.",
            ));
        }
        js_FontFaceSet::backing(&cx.heap, self).add(&cx.heap, face.to_js())?;
        self.join(&cx.heap, face);
        match face.status.get() {
            FontFaceLoadStatus::Loading => self.started(cx, face),
            FontFaceLoadStatus::Loaded => _ = face.publish(cx),
            _ => face.start_loading(cx, self.doc()),
        }
        Ok(self)
    }

    pub(crate) fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        face: &'a FontFace,
    ) -> Result<'a, bool> {
        if face.is_css_connected {
            return Ok(false);
        }
        self.leave(cx, face);
        js_FontFaceSet::backing(&cx.heap, self).remove(&cx.heap, face.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        let all = js_FontFaceSet::backing(&cx.heap, self).values(&cx.heap)?;
        // SAFETY: the set has faces.
        let mut faces = all
            .iter()
            .map(|it| unsafe { FontFace::from_js_unchecked(it.to_js()) });
        faces.try_for_each(|it| self.delete(cx, it).map(drop))
    }

    pub(crate) fn load<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        font: &[u8],
        characters: &[u8],
    ) -> Result<'a, JSValue> {
        let (found, result) = (
            self.matching(&cx.heap, font, characters)?,
            self.realm(&cx.heap).create_promise(),
        );
        faces(found).for_each(|it| it.start_loading(cx, self.doc()));
        let loaded = cx.heap.create_callback(
            |cx, [result, found], _, _| {
                let found = List::from_value(found.to_js());
                if faces(found).all(|it| it.status.get() == FontFaceLoadStatus::Loaded) {
                    let copy = cx
                        .heap
                        .create_array(found.values(), |heap, it| Ok(JsLocal::new(heap, it)))?;
                    promise(&cx.heap, Some(result.to_js())).resolve(cx, copy.to_js())?;
                }
                Ok(JSValue::UNDEFINED)
            },
            [result.to_js(), found.to_js()],
            0,
        );
        let failed = cx.heap.create_callback(
            |cx, [result, _], _, arguments| {
                promise(&cx.heap, Some(result.to_js()))
                    .reject(cx, arguments[0].to_js())
                    .map(|()| JSValue::UNDEFINED)
            },
            [result.to_js(), JSValue::UNDEFINED],
            0,
        );
        faces(found).for_each(|it| {
            promise(&cx.heap, js_AnyFontFace::loaded(it)).react(
                &cx.heap,
                Some(loaded),
                Some(failed),
            )
        });
        if found.is_empty() {
            result.resolve(cx, found.to_js())?;
        }
        Ok(result.to_js())
    }

    pub(crate) fn check<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        font: &[u8],
        characters: &[u8],
    ) -> Result<'a, bool> {
        Ok(faces(self.matching(&cx.heap, font, characters)?).all(|it| {
            matches!(
                it.status.get(),
                FontFaceLoadStatus::Loaded | FontFaceLoadStatus::Error
            )
        }))
    }

    pub(crate) fn get_ready<'a>(&'a self, cx: &mut JsScope<'a>) -> JSValue {
        if self.doc().is(DocFlags::HAS_PAGE) {
            self.doc()
                .synced_engine(cx, |engine, _| engine.update_layout());
            load_requested_fonts(cx, self.doc());
        }
        promise(&cx.heap, js_FontFaceSet::ready(self)).to_js()
    }

    pub(crate) fn get_status(&self) -> FontFaceSetLoadStatus {
        if list(js_FontFaceSet::loading(self)).is_empty() {
            FontFaceSetLoadStatus::Loaded
        } else {
            FontFaceSetLoadStatus::Loading
        }
    }
}

fn fonts_of<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> &'a FontFaceSet {
    FontFaceSet::of(cx, doc, None)
}

pub(crate) fn fonts_of_worker<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    scope: u32,
) -> &'a FontFaceSet {
    FontFaceSet::of(cx, doc, Some(scope))
}

impl FontFaceSource {
    pub(crate) fn get_fonts<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, &'a FontFaceSet> {
        let doc = if self.is(DocFlags::HAS_PAGE) {
            self
        } else {
            seams::current_document(cx)?
        };
        Ok(fonts_of(cx, doc))
    }
}

/// What style sheets have asked for.
pub(crate) fn load_requested_fonts<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    let (requested, version) = doc.synced_engine(cx, |engine, _| {
        (engine.take_font_requests(), Some(engine.font_faces_version))
    });
    if requested.is_empty() && FontFaceSet::if_any(doc).is_none_or(|it| it.pruned.get() == version)
    {
        return;
    }
    let (set, rules) = (
        fonts_of(cx, doc),
        doc.engine(|engine, _| engine.font_faces()),
    );
    if set.pruned.replace(version) != version {
        set.forget_removed_rules(cx, &rules);
    }
    for rule in requested {
        set.face_for(
            &cx.heap,
            &rule,
            rules.iter().rposition(|it| *it == rule).unwrap_or(0),
        )
        .start_loading(cx, doc);
    }
}

pub(crate) fn document_loaded<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    FontFaceSet::if_any(doc)
        .into_iter()
        .for_each(|it| it.settle(cx));
}
