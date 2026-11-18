//! The session history of a window and its frames.

use std::rc::Rc;

use bun_web::host::{
    Activation, HistoryChange, HistoryEntries, HistoryEntry, Serialized, Traversal,
};
use bun_web::trust;
use bun_web::url::Url;

use super::load::{How, Navigation, Request};
use super::page::Page;
use super::{Contents, with_id, without_hash};
use crate::contents::inspection::News;
use crate::prelude::*;
use crate::text::{origin_of, random_uuid};

const MOST_ENTRIES: usize = 50;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Document {
    None,
    Page(u32),
    /// The id of the view, and the index in the history that the web engine keeps.
    Guest(i32, u32),
}

/// What one window or frame showed.
#[derive(Clone)]
pub(super) struct Shown {
    pub(super) url: String,
    pub(super) title: String,
    state: Option<HistoryEntry>,
    document: Document,
    origin: String,
    /// The same for as long as it is about the same load of a URL, even if that has been repeated.
    pub(super) sequence: u32,
    pub(super) request: Rc<Request>,
}

impl Shown {
    pub(super) fn is_of(&self, page: &Page) -> bool {
        self.document == Document::Page(page.id)
    }
}

/// The entries that only differ in other frames share it.
pub(super) type Item = Rc<RefCell<Shown>>;

pub(crate) struct Entry {
    top: Item,
    /// By their places in the tree.
    frames: RefCell<Vec<(Rc<str>, Item)>>,
}

#[derive(Default)]
pub(crate) struct History {
    pub(crate) entries: Vec<Rc<Entry>>,
    pub(crate) index: usize,
    /// Where a traversal is going that has not arrived. The next one counts from there.
    aim: Option<Rc<Entry>>,
    last_sequence: u32,
}

impl Entry {
    pub(crate) fn new(url: String, title: String, document: Document) -> Rc<Entry> {
        let shown = Shown {
            url,
            title,
            state: None,
            document,
            origin: String::new(),
            sequence: 0,
            request: Rc::default(),
        };
        Rc::new(Entry {
            top: Rc::new(shown.into()),
            frames: RefCell::default(),
        })
    }

    pub(crate) fn url(&self) -> String {
        self.top.borrow().url.clone()
    }

    pub(crate) fn set_initiator(&self, origin: &str) {
        Rc::make_mut(&mut self.top.borrow_mut().request).set_initiator(origin);
    }

    pub(crate) fn foreign_initiator(&self) -> Option<String> {
        let shown = self.top.borrow();
        shown.request.foreign_initiator(&shown.url)
    }

    pub(crate) fn title(&self) -> String {
        self.top.borrow().title.clone()
    }

    pub(crate) fn document(&self) -> Document {
        self.top.borrow().document
    }

    pub(super) fn describe(&self) -> JsResult<JSValue> {
        Ok(object!({ "url": self.url(), "title": self.title() }))
    }

    fn set_frame(&self, place: &Rc<str>, item: &Item) {
        let mut frames = self.frames.borrow_mut();
        frames.retain(|it| it.0 != *place);
        frames.push((Rc::clone(place), Rc::clone(item)));
    }
}

impl History {
    fn position(&self, entry: &Rc<Entry>) -> Option<usize> {
        self.entries.iter().position(|it| Rc::ptr_eq(it, entry))
    }

    pub(super) fn at_offset(&self, offset: i32) -> Option<usize> {
        self.index
            .checked_add_signed(offset as isize)
            .filter(|it| *it < self.entries.len())
    }
}

impl Shown {
    fn key(&self) -> Option<String> {
        self.state.as_ref().map(|it| it.key.clone())
    }

    fn for_scripts(&self, url: &str, is_of_document: bool) -> HistoryEntry {
        let state = self
            .state
            .clone()
            .unwrap_or_else(|| HistoryEntry::of(String::new()));
        HistoryEntry {
            url: url.to_owned(),
            is_of_document,
            ..state
        }
    }
}

fn named(key: String, navigation_state: Option<Serialized>) -> HistoryEntry {
    HistoryEntry {
        key,
        id: random_uuid(),
        navigation_state,
        ..HistoryEntry::of(String::new())
    }
}

impl Contents {
    pub(super) fn item_in(&self, entry: &Entry) -> Option<Item> {
        match &self.embedded {
            Some(frame) => entry
                .frames
                .borrow()
                .iter()
                .find(|it| it.0 == frame.place)
                .map(|it| Rc::clone(&it.1)),
            None => Some(Rc::clone(&entry.top)),
        }
    }

    fn item_at(&self, index: usize) -> Option<Item> {
        self.item_in(self.history().borrow().entries.get(index)?)
    }

    pub(super) fn item(&self) -> Option<Item> {
        let index = self.history().borrow().index;
        self.item_at(index)
    }

    fn items(&self) -> Vec<Item> {
        let mut all: Vec<Item> = self
            .history()
            .borrow()
            .entries
            .iter()
            .filter_map(|it| self.item_in(it))
            .collect();
        all.dedup_by(|a, b| Rc::ptr_eq(a, b));
        all
    }

    pub(super) fn request_to_repeat(&self) -> Rc<Request> {
        self.item()
            .map(|it| Rc::clone(&it.borrow().request))
            .unwrap_or_default()
    }

    pub(super) fn forget_aim(&self) {
        self.history().borrow_mut().aim = None;
    }

    /// `load` is there if the document is a new one.
    pub(super) fn commit_entry(
        &self,
        url: &str,
        pushes: bool,
        state: Option<HistoryEntry>,
        load: Option<(u32, Rc<Request>)>,
    ) -> JsResult<()> {
        let (page, before) = (self.page(), self.item());
        let of_before = || {
            before
                .as_ref()
                .map(|it| (it.borrow().sequence, Rc::clone(&it.borrow().request)))
        };
        let (sequence, request) = load.or_else(of_before).unwrap_or_default();
        let shown = Shown {
            url: url.to_owned(),
            title: page.title(),
            state: Some(state.unwrap_or_else(|| named(random_uuid(), None))),
            document: Document::Page(page.id),
            origin: page.origin_key(),
            sequence,
            request,
        };
        if let Some(before) = before.as_ref().filter(|_| !pushes) {
            before.replace(shown);
            return Ok(());
        }
        let (item, mut history) = (Rc::new(RefCell::new(shown)), self.history().borrow_mut());
        let place = self.embedded.as_ref().map(|it| &it.place);
        match (before, place) {
            (None, Some(place)) => history
                .entries
                .iter()
                .for_each(|it| it.set_frame(place, &item)),
            (None, None) => {
                (history.entries, history.index) = (
                    vec![Rc::new(Entry {
                        top: item,
                        frames: RefCell::default(),
                    })],
                    0,
                )
            }
            (Some(_), _) => {
                let current = &history.entries[history.index];
                let top = Rc::clone(if place.is_some() { &current.top } else { &item });
                let entry = Entry {
                    top,
                    frames: current.frames.clone(),
                };
                place.into_iter().for_each(|it| entry.set_frame(it, &item));
                history.index += 1;
                let index = history.index;
                history.entries.truncate(index);
                history.entries.push(Rc::new(entry));
                drop(history);
                self.owner().tell_of_pruning(Some(self))?;
                let mut history = self.history().borrow_mut();
                if history.entries.len() > MOST_ENTRIES && history.index > 0 {
                    history.entries.remove(0);
                    history.index -= 1;
                    page.after_script(|it| it.owner().tell_of_pruning(None));
                }
            }
        }
        Ok(())
    }

    fn tell_of_pruning(&self, except: Option<&Contents>) -> JsResult<()> {
        if except.is_none_or(|it| !same(it, self)) && self.page().is_started() {
            let keys: Vec<String> = self
                .items()
                .iter()
                .filter_map(|it| it.borrow().key())
                .collect();
            self.page().tell(|it| it.keep_entries(keys))?;
        }
        self.children()?
            .try_for_each(|it| it.tell_of_pruning(except))
    }

    pub(super) fn commit_document(&self, url: &str, navigation: &Navigation) -> JsResult<()> {
        let (page, how) = (self.page(), navigation.how);
        let before = self.item().map(|it| it.borrow().clone());
        let is_repeated = matches!(how, How::Traverse(_) | How::Reload);
        if let How::Traverse(index) = how
            && index < self.history().borrow().entries.len()
        {
            self.history().borrow_mut().index = index;
        }
        self.forget_aim();
        let of_origin = before.as_ref().filter(|it| it.origin == page.origin_key());
        if let Some(item) = self.item().filter(|_| is_repeated) {
            let mut shown = item.borrow_mut();
            if without_hash(&shown.url) != without_hash(url) {
                self.history().borrow_mut().last_sequence += 1;
                shown.sequence = self.history().borrow().last_sequence;
                (shown.state, shown.request) = (None, Rc::clone(&navigation.request));
            }
            if navigation.starts_over {
                (shown.title, shown.request) = (String::new(), Rc::clone(&navigation.request));
            }
            (shown.url, shown.origin, shown.document) =
                (url.to_owned(), page.origin_key(), Document::Page(page.id));
            shown
                .state
                .get_or_insert_with(|| named(random_uuid(), None));
            let sequence = shown.sequence;
            drop(shown);
            for other in self
                .items()
                .iter()
                .filter(|it| sequence != 0 && it.borrow().sequence == sequence)
            {
                other.borrow_mut().document = Document::Page(page.id);
            }
        } else {
            let key = of_origin
                .filter(|_| how != How::Push)
                .and_then(Shown::key)
                .unwrap_or_else(random_uuid);
            let request = match (&navigation.markup, &before) {
                (None, _) => Rc::clone(&navigation.request),
                (Some(_), before) => before
                    .as_ref()
                    .map(|it| Rc::clone(&it.request))
                    .unwrap_or_default(),
            };
            self.history().borrow_mut().last_sequence += 1;
            let load = (self.history().borrow().last_sequence, request);
            self.commit_entry(
                url,
                how == How::Push,
                Some(named(key, navigation.state.clone())),
                Some(load),
            )?;
        }
        page.restores_scroll
            .set(is_repeated && !navigation.starts_over);
        page.is_from_history.set(matches!(how, How::Traverse(_)));
        let is_first = before.is_none() && !self.is_frame() && !matches!(how, How::Traverse(_));
        self.activation.replace(Some(Activation {
            kind: if is_first { How::Replace } else { how }.name().to_owned(),
            from: of_origin.map(|it| it.for_scripts(&it.url, false)),
            entry: (self.item()).map(|it| it.borrow().for_scripts(&page.url(), true)),
        }));
        Ok(())
    }

    /// Those around the current one that are of the same origin.
    pub(super) fn entries_for_scripts(&self) -> Option<HistoryEntries> {
        let item = self
            .item()
            .filter(|it| it.borrow().document == Document::Page(self.page().id))?;
        let (all, current) = (self.items(), item.borrow());
        let at = all.iter().position(|it| Rc::ptr_eq(it, &item))?;
        let is_foreign = |it: &Item| it.borrow().origin != current.origin;
        let from = all[..at]
            .iter()
            .rposition(is_foreign)
            .map_or(0, |it| it + 1);
        let to = all[at..]
            .iter()
            .position(is_foreign)
            .map_or(all.len(), |it| at + it);
        let of_error = self.page().unreachable_url().map(|_| self.page().url());
        let describe = |it: &Item| {
            let it = it.borrow();
            let url = of_error.as_ref().unwrap_or(&it.url);
            it.for_scripts(url, it.document == current.document)
        };
        Some(HistoryEntries {
            entries: all[from..to].iter().map(describe).collect(),
            index: (at - from) as u32,
        })
    }

    pub(super) fn will_swap(
        &self,
        next: &Page,
        url: &str,
        has_crossed_origins: bool,
        how: How,
    ) -> JsResult<()> {
        let known = match how {
            How::Traverse(index) => self.item_at(index),
            How::Reload => self.item(),
            How::Push | How::Replace => None,
        };
        let known = known.map_or_else(
            || HistoryEntry::of(url.to_owned()),
            |it| it.borrow().for_scripts(url, false),
        );
        let is_visible = next.origin_key() == self.page().origin_key() && !has_crossed_origins;
        let to = is_visible.then(|| Box::new(known));
        let captured = (self.page()).ask(|it, reply| it.will_swap(how.swap(), to, reply))?;
        (next.inbound_transition).set(if next.is_beside(self.page()) {
            captured
        } else {
            0
        });
        Ok(())
    }

    pub(super) fn title_changed(&self, page: &Page, title: String) {
        let before = self.item().map_or_else(
            || page.title(),
            |it| core::mem::replace(&mut it.borrow_mut().title, title.clone()),
        );
        page.set_title(title.clone());
        if before != title {
            page.later(move |it| it.contents().announce_title(title));
        }
    }

    fn announce_title(&self, title: String) -> JsResult<()> {
        let is_explicit = !title.is_empty() || !self.page().url().starts_with("file:");
        let title = if is_explicit { title } else { self.title() };
        self.announce("page-title-updated", &[js(title)?, is_explicit.into()])
    }

    pub(super) fn announce_title_after(&self, how: How) -> JsResult<()> {
        let title = self
            .item()
            .filter(|_| matches!(how, How::Traverse(_)))
            .map(|it| it.borrow().title.clone());
        title
            .filter(|it| !it.is_empty())
            .map_or(Ok(()), |it| self.announce_title(it))
    }

    pub(super) fn announce_entry(&self, is_in_page: bool, replaces: bool) -> JsResult<()> {
        let url = self.owner().page().url_in_history();
        self.owner().announce(
            "navigation-entry-committed",
            &[js(url)?, is_in_page.into(), replaces.into()],
        )
    }

    pub(super) fn history_changed(
        &self,
        page: &Page,
        entry: HistoryEntry,
        change: HistoryChange,
    ) -> JsResult<()> {
        let has_url = |it: &Page| without_hash(&it.url()) == without_hash(&entry.url);
        let is_of_relative = || {
            let mut pages =
                super::alive().filter_map(|it| self.relative(it.id).map(Contents::page));
            pages.any(|it| it.has_relatives.get() && it.is_kin_of(page) && has_url(it))
        };
        let is_of_origin = page.origin() != "null" && origin_of(&entry.url) == page.origin();
        if !is_of_origin && !has_url(page) && !is_of_relative() {
            return Ok(());
        }
        if change == HistoryChange::Update {
            let item = self.items().into_iter().find(|it| {
                it.borrow()
                    .state
                    .as_ref()
                    .is_some_and(|it| it.id == entry.id)
            });
            item.into_iter()
                .for_each(|it| it.borrow_mut().state = Some(entry.clone()));
            return Ok(());
        }
        let url = entry.url.clone();
        if !same(page, self.page()) {
            return Ok(());
        }
        let how = if change == HistoryChange::Push {
            How::Push
        } else {
            How::Replace
        };
        let goes_to_fragment = entry.state.is_none() && has_url(page);
        self.commit_entry(&url, how == How::Push, Some(entry), None)?;
        if let Some(item) = self.item().filter(|_| !goes_to_fragment) {
            Rc::make_mut(&mut item.borrow_mut().request).pass_to(page);
        }
        self.navigated_in_page(&url, how)?;
        if Url::parse(url.as_bytes()).is_some_and(|it| trust::ends_trusted_document(&it)) {
            self.later(move |it| {
                if it.page().url() == url {
                    it.load(&url, Navigation::new(How::Replace), None)
                } else {
                    Ok(())
                }
            });
        }
        Ok(())
    }

    pub(super) fn navigated_in_page(&self, url: &str, how: How) -> JsResult<()> {
        let (page, url) = (self.page(), url.to_owned());
        page.set_url(&url);
        self.notify(News::NavigatedWithinDocument(&url))?;
        page.later(move |page| {
            let (it, replaces) = (page.contents(), matches!(how, How::Replace | How::Reload));
            it.while_beginning(&mut || {
                it.dispatch_navigation("did-start-navigation", &url, true, page.handle())?;
                if !it.is_frame() || !replaces {
                    it.announce_entry(true, replaces)?;
                }
                it.announce_for_frame("did-navigate-in-page", page, &[js(&*url)?])?;
                it.announce_title_after(how)
            })
        });
        Ok(())
    }

    pub(super) fn pop_state(&self, url: &str, item: &Item) -> JsResult<()> {
        let key = item.borrow().key();
        self.page().tell(|it| it.pop_state(url.to_owned(), key))
    }

    pub(super) fn traverse_by(&self, delta: i32, page: &Page) -> JsResult<()> {
        let history = self.history.borrow();
        let from = history
            .aim
            .as_ref()
            .and_then(|it| history.position(it))
            .unwrap_or(history.index);
        let Some(aim) = from
            .checked_add_signed(delta as isize)
            .and_then(|it| history.entries.get(it))
            .cloned()
        else {
            return Ok(());
        };
        drop(history);
        if !self.may_be_taken_to(&aim, page)? {
            return Ok(());
        }
        self.history.borrow_mut().aim = Some(Rc::clone(&aim));
        let page = Root::new(page);
        self.after_script(move |it| {
            let index = it.history.borrow().position(&aim);
            let may = !it.ignores(Some(page.get())) && it.may_be_taken_to(&aim, page.get())?;
            if let Some(index) = index.filter(|_| may && !page.get().is_disposed()) {
                it.traverse(index, false)?;
            }
            let is_still = it
                .history
                .borrow()
                .aim
                .as_ref()
                .is_some_and(|it| Rc::ptr_eq(it, &aim));
            if is_still && !(may && it.has_pending_load()?) {
                it.forget_aim();
            }
            Ok(())
        });
        Ok(())
    }

    fn has_pending_load(&self) -> JsResult<bool> {
        if self.loading.is_pending() {
            return Ok(true);
        }
        self.children()?
            .try_fold(false, |has, it| Ok(has || it.has_pending_load()?))
    }

    pub(crate) fn traverse(&self, index: usize, is_by_user: bool) -> JsResult<()> {
        self.try_to_traverse(index, is_by_user).map(drop)
    }

    /// False if a document has refused.
    fn try_to_traverse(&self, index: usize, is_by_user: bool) -> JsResult<bool> {
        let entry = self.history.borrow().entries.get(index).cloned();
        let Some(entry) = entry.filter(|_| !self.is_destroyed.get()) else {
            return Ok(true);
        };
        if let (Document::Guest(view, own), Some(guest)) = (entry.document(), self.guest())
            && view == guest.id()
        {
            guest.tell_page("navigationHistory.goToIndex", &[js(own)?])?;
            return Ok(true);
        }
        let mut changing = self.changing_for(&entry)?;
        if changing.is_empty() {
            self.history.borrow_mut().index = index;
            self.cancel_traversals()?;
        }
        changing.reverse();
        go_on(changing, entry, index, is_by_user)
    }

    fn cancel_traversals(&self) -> JsResult<()> {
        if self.loading.is_traversing() {
            self.stop_loading()?;
        }
        self.children()?.try_for_each(Contents::cancel_traversals)
    }

    fn changing_for(&self, entry: &Entry) -> JsResult<Vec<u32>> {
        let (target, mut all) = (self.item_in(entry), Vec::new());
        let has_other_document = target
            .as_ref()
            .is_some_and(|it| it.borrow().document != Document::Page(self.page().id));
        if has_other_document
            || target.is_some_and(|it| self.item().is_none_or(|now| !Rc::ptr_eq(&now, &it)))
        {
            all.push(self.id);
        }
        if !has_other_document {
            for frame in self.children()? {
                all.append(&mut frame.changing_for(entry)?);
            }
        }
        Ok(all)
    }

    fn may_be_taken_to(&self, entry: &Entry, source: &Page) -> JsResult<bool> {
        for other in self.changing_for(entry)?.into_iter().filter_map(with_id) {
            if !other.is_navigable_by(source) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub(super) fn traverse_to(&self, key: &str) -> JsResult<Traversal> {
        let (entries, index) = (
            self.history().borrow().entries.clone(),
            self.history().borrow().index,
        );
        let has_key = |it: &Rc<Entry>| {
            self.item_in(it)
                .is_some_and(|it| it.borrow().key().as_deref() == Some(key))
        };
        let Some(first) = entries.iter().position(has_key) else {
            return Ok(Traversal::Impossible);
        };
        let nearest = if first > index {
            first
        } else {
            entries.iter().rposition(has_key).unwrap_or(first)
        };
        if !(self.owner()).may_be_taken_to(&entries[nearest], self.page())? {
            return Ok(Traversal::Forbidden);
        }
        Ok(match self.owner().try_to_traverse(nearest, false)? {
            true => Traversal::Begun,
            false => Traversal::Aborted,
        })
    }
}

/// With the last of `rest`.
fn go_on(mut rest: Vec<u32>, entry: Rc<Entry>, index: usize, is_by_user: bool) -> JsResult<bool> {
    let Some(contents) = rest.pop().and_then(with_id) else {
        return Ok(true);
    };
    let (page, Some(target)) = (contents.page(), contents.item_in(&entry)) else {
        return Ok(true);
    };
    if target.borrow().document != Document::Page(page.id) && !contents.may_unload(false)? {
        return Ok(false);
    }
    let key = target.borrow().key();
    let proceed = move |page: &'static Page| {
        let contents = page.contents();
        if page.is_disposed() || contents.history().borrow().position(&entry) != Some(index) {
            return Ok(());
        }
        let Shown {
            url,
            document,
            request,
            ..
        } = target.borrow().clone();
        if document == Document::Page(page.id) {
            contents.cancel_pending()?;
            contents.history().borrow_mut().index = index;
            contents.later(Contents::rest);
            contents.navigated_in_page(&url, How::Traverse(index))?;
            contents.pop_state(&url, &target)?;
        } else {
            let navigation = Navigation {
                request,
                may_unload: true,
                ..Navigation::new(How::Traverse(index))
            };
            match is_by_user {
                true => contents.load(&url, navigation, None)?,
                false => contents.load_for_page(&url, navigation)?,
            }
        }
        go_on(rest, entry, index, is_by_user).map(drop)
    };
    if !page.is_started() {
        return proceed(page).map(|()| true);
    }
    page.will_traverse(key.unwrap_or_default(), is_by_user, Box::new(proceed))
}
