//! Browsing contexts: which ones know each other, and what they may do to each other.

use std::rc::Rc;

use bun_ui::protocol::PageCommand;
use bun_web::host::{Verdict, Wish};
use bun_web::origin::is_same_site;
use bun_web::page::{self, Change, Link as _};
use bun_web::url::Url;

use super::load::Initiator;
use super::page::Page;
use super::place::{self, Place};
use super::process::{self, Process};
use super::{Contents, fields, with_id, without_hash};
use crate::prelude::*;

/// A process that knows all members of a group. `None` is this one.
#[derive(Clone)]
struct Knowing(Option<Rc<Process>>);

impl Knowing {
    fn is_for(&self, page: &Page) -> bool {
        match (&self.0, page.process()) {
            (Some(own), Some(known)) => Rc::ptr_eq(own, &known),
            (Some(own), None) => !own.is_gone() && *own.place.borrow() == page.place(),
            (None, _) => page.place() == Place::App,
        }
    }

    fn tell(&self, context: u32, change: Change) {
        match &self.0 {
            Some(process) => process.change(context, change),
            None => page::here().change(context, change),
        }
    }
}

struct Group {
    members: RefCell<Vec<u32>>,
    known_to: RefCell<Vec<Knowing>>,
}

impl Default for Group {
    fn default() -> Group {
        Group {
            members: Default::default(),
            known_to: Vec::from_iter(place::is_all_in_app().then_some(Knowing(None))).into(),
        }
    }
}

/// A window or a frame, whatever document it has.
pub(super) struct Context {
    pub(super) name: RefCell<String>,
    pub(super) is_closed: Cell<bool>,
    pub(super) is_popup: Cell<bool>,
    /// Below the top one.
    pub(super) frame_count: Cell<i32>,
    /// Those of them that are known here.
    pub(super) known_frames: Cell<u32>,
    /// The app has allowed it, once.
    pub(super) may_fill_screen: Cell<bool>,
    /// When the user has last pressed something.
    pub(super) last_input: Cell<f64>,
    /// A frame, if what is typed is not for the process that has the top.
    pub(super) with_keys: Cell<u32>,
    group: Rc<Group>,
}

impl Context {
    pub(super) fn new(related: Option<&Contents>) -> Context {
        Context {
            name: Default::default(),
            is_closed: false.into(),
            is_popup: false.into(),
            frame_count: 0.into(),
            known_frames: 0.into(),
            may_fill_screen: false.into(),
            last_input: f64::NEG_INFINITY.into(),
            with_keys: 0.into(),
            group: related
                .map(|it| Rc::clone(&it.context.group))
                .unwrap_or_default(),
        }
    }

    pub(super) fn is_alone(&self) -> bool {
        self.group.members.borrow().len() == 1
    }
}

impl Contents {
    pub(super) fn opened_by(&self) -> Option<&'static Contents> {
        fields::opened_by(self.itself())
    }

    pub(super) fn with_ancestors(&self) -> impl Iterator<Item = &'static Contents> {
        core::iter::successors(Some(self.itself()), |it| it.parent())
    }

    /// Those that `window[index]` has.
    pub(super) fn children(&self) -> JsResult<impl Iterator<Item = &'static Contents> + use<>> {
        let frames = instances::<Contents>(self.page().frames_if_any()?);
        let ids = (frames.map(|it| it.map(|it| it.id))).collect::<JsResult<Vec<_>>>()?;
        Ok((ids.into_iter().filter_map(with_id)).filter(|it| it.is_indexed()))
    }

    fn tell_each(&self, change: impl Fn(&Knowing) -> Change) {
        let all = self.context.group.known_to.borrow().clone();
        all.iter().for_each(|it| it.tell(self.id, change(it)));
    }

    pub(super) fn tell_pages(&self, change: &Change) {
        self.tell_each(|_| change.clone());
    }

    fn creation(&self, related: Option<u32>, to: &Knowing) -> Change {
        let embedded = self.embedded.as_ref();
        Change::Created {
            embedder: (fields::embedder(self).filter(|it| to.is_for(it))).map(|it| it.id),
            parent: self.parent().map(|it| it.id),
            frame: embedded.map_or(0, |it| it.number),
            image: embedded.map_or(0, |it| it.image),
            opener: self.opened_by().map(|it| it.id),
            related,
        }
    }

    pub(super) fn announce_to_pages(&self, related: Option<u32>) {
        self.tell_each(|to| self.creation(related, to));
    }

    fn showing(page: &Page, to: &Knowing) -> Change {
        Change::Shows {
            page: page.id,
            origin: to.is_for(page).then(|| page.origin_key()),
            is_initial: page.is_initial(),
        }
    }

    pub(super) fn tell_children(&self) -> JsResult<()> {
        if self.context.group.known_to.borrow().len() > 1 {
            self.tell_pages(&Change::Children(
                self.children()?.map(|it| it.id).collect(),
            ));
        }
        Ok(())
    }

    pub(super) fn members(&self) -> Vec<&'static Contents> {
        let members = self.context.group.members.borrow();
        members.iter().filter_map(|it| with_id(*it)).collect()
    }

    fn introduce_group(&self, to: &Knowing) -> JsResult<()> {
        let members = self.members();
        for it in &members {
            let related = Some(members[0].id).filter(|first| *first != it.id);
            to.tell(it.id, it.creation(related, to));
            to.tell(it.id, Change::Renamed(it.name()));
            to.tell(it.id, Contents::showing(it.page(), to));
        }
        self.context.group.known_to.borrow_mut().push(to.clone());
        for it in members {
            to.tell(it.id, Change::OpenedBy(it.opened_by().map(|it| it.id)));
            it.tell_children()?;
        }
        Ok(())
    }

    /// That `page` would be in now.
    pub(super) fn process_meant_for(&self, page: &Page) -> Option<Rc<Process>> {
        let all = self.context.group.known_to.borrow();
        all.iter().find(|it| it.is_for(page))?.0.clone()
    }

    /// `None` for this one.
    pub(super) fn process_for(
        &self,
        page: &Page,
        has_preload: bool,
    ) -> JsResult<Option<Rc<Process>>> {
        let known = (self.context.group.known_to.borrow().iter())
            .find(|it| it.is_for(page))
            .cloned();
        if let Some(known) = known {
            return Ok(known.0);
        }
        const MOST_PLACES: usize = 48;
        let new = Knowing(match page.place() {
            Place::App => None,
            _ if let Some(process) = page.opener().and_then(Page::process) => Some(process.share()),
            _ if self.context.group.known_to.borrow().len() >= MOST_PLACES => {
                return Err(process::too_many());
            }
            place => Some(process::take(place, !has_preload, self.is_frame())?),
        });
        self.introduce_group(&new)?;
        Ok(new.0)
    }

    pub(super) fn has_process_for(&self, place: &Place) -> bool {
        let fits = |it: &Rc<Process>| {
            let own = it.place.borrow();
            *own == *place || (own.can_become(place) && self.context.is_alone())
        };
        (self.context.group.known_to.borrow().iter()).any(|it| it.0.as_ref().is_some_and(fits))
    }

    /// Before it is shown, and after the last one was disposed.
    pub(super) fn make_room_for(&self, page: &Page) {
        let old = self.page();
        let Some(process) = old.process().filter(|_| !page.is_started()) else {
            return;
        };
        if self.context.is_alone()
            && !process.is_shared()
            && process.place.borrow().can_become(&page.place())
        {
            process.settle(page.place());
        }
        let is_used = || (self.members().iter()).any(|it| it.page().is_running_in(&process));
        if process.is_late() && !is_used() {
            self.leave(&|it| it.0.as_ref().is_some_and(|it| Rc::ptr_eq(it, &process)));
        }
        if !(self.process_meant_for(page)).is_some_and(|it| Rc::ptr_eq(&it, &process)) {
            process.command(PageCommand::Revoke(self.surface));
            if let Some(it) = (self.embedded.as_ref()).filter(|_| !self.embedder().is_in(&process))
            {
                process.command(PageCommand::TakeBack(it.image));
            }
        }
    }

    fn leave(&self, is_left: &dyn Fn(&Knowing) -> bool) {
        let mut known_to = self.context.group.known_to.borrow_mut();
        let left = known_to
            .extract_if(.., |it| is_left(it))
            .collect::<Vec<_>>();
        drop(known_to);
        for it in left {
            let members = self.context.group.members.borrow().clone();
            (members.iter()).for_each(|id| it.tell(*id, Change::Discarded));
            it.0.iter().for_each(Process::release);
        }
    }

    pub(super) fn leave_unused_places(&self) {
        if !place::is_all_in_app() {
            let members = self.members();
            self.leave(&|place| !members.iter().any(|it| place.is_for(it.page())));
        }
    }

    pub(super) fn rename(&self, name: String) {
        self.context.name.replace(name.clone());
        self.tell_pages(&Change::Renamed(name));
    }

    pub(super) fn set_opened_by(&self, opener: Option<&Contents>) {
        fields::set_opened_by(self, opener);
        self.tell_pages(&Change::OpenedBy(opener.map(|it| it.id)));
    }

    pub(super) fn set_page(&self, page: &Page) {
        fields::set_page(self, Some(page));
        self.tell_each(|to| Contents::showing(page, to));
    }

    /// One that scripts in this one can have the window of.
    pub(super) fn relative(&self, id: u32) -> Option<&'static Contents> {
        with_id(id).filter(|it| Rc::ptr_eq(&it.context.group, &self.context.group))
    }

    pub(super) fn related_page(&self, id: u32) -> Option<&'static Page> {
        let members = self.context.group.members.borrow();
        let mut pages = (members.iter().copied().filter_map(with_id)).map(Contents::page);
        pages.find(|it| it.id == id && !it.is_disposed())
    }

    pub(super) fn show_from_now(&self, page: &Page) {
        self.crashed_at.take();
        self.was_shown.set(false);
        let key = page.origin_key();
        match fields::page(self) {
            None => self.context.group.members.borrow_mut().push(self.id),
            Some(old)
                if !self.is_frame()
                    && self.opened_by().is_none()
                    && !old.is_initial()
                    && old.origin_key() != key =>
            {
                self.rename(String::new());
            }
            Some(_) => {}
        }
        if let Some(old) = fields::page(self).filter(|it| !same(*it, page)) {
            page.succeed(old);
        }
        self.set_page(page);
        self.leave_unused_places();
    }

    /// <https://html.spec.whatwg.org/#allowed-to-navigate>
    pub(super) fn is_navigable_by(&self, source: &Page) -> bool {
        let context = source.contents();
        if !source.sandbox().is_on() || self.with_ancestors().any(|it| same(it, context)) {
            return true;
        }
        if self.is_frame() {
            return false;
        }
        if !same(self, context.owner()) {
            return self.opened_by().is_some_and(|it| same(it, context));
        }
        !source.forbids("allow-top-navigation")
            || (!source.forbids("allow-top-navigation-by-user-activation")
                && source.has_activation())
    }

    fn is_or_is_in_origin_of(&self, page: &Page) -> bool {
        let key = page.origin_key();
        self.with_ancestors()
            .any(|it| it.page().origin_key() == key)
    }

    /// Browsers are stricter than the standard.
    fn is_within_reach_of(&self, source: &Page, url: &str) -> bool {
        if self.is_or_is_in_origin_of(source) {
            return true;
        }
        if self.is_frame() {
            return false;
        }
        if !same(self, source.contents().owner()) {
            return source
                .contents()
                .opened_by()
                .is_some_and(|it| same(it, self))
                || self
                    .opened_by()
                    .is_none_or(|it| it.is_or_is_in_origin_of(source));
        }
        source.sandbox().is_on()
            || source.has_been_active.get()
            || Url::parse(url.as_bytes())
                .is_some_and(|it| is_same_site(&it, &self.page().client.url()))
    }

    /// What is up to the page has yet to be done.
    pub(super) fn judge(
        &self,
        source: &Page,
        wish: Wish,
        referrer: Option<String>,
    ) -> JsResult<Verdict> {
        let url = &*wish.url;
        if !self.is_navigable_by(source) || !self.is_within_reach_of(source, url) {
            return Ok(Verdict::Refused);
        }
        if self.has_crashed() && url.starts_with("javascript:") {
            return Ok(Verdict::Granted);
        }
        let stays = !self.has_crashed()
            && without_hash(url) != url
            && without_hash(url) == without_hash(&self.page().url());
        let page = match stays || url.starts_with("javascript:") {
            true => self.started_page()?,
            false => self.page(),
        };
        if page.is_started() && page.is_kin_of(source) {
            return Ok(Verdict::UpToPage);
        }
        if stays && wish.post.is_none() {
            return Ok(Verdict::UpToForeignPage);
        }
        self.wish(page, wish, Initiator::of(source), referrer)?;
        Ok(Verdict::Granted)
    }

    /// `source` does what is left, if it can.
    pub(super) fn judge_for_script(&self, source: &Page, wish: Wish) -> JsResult<Verdict> {
        if self.page().is_beside(source) {
            return self.judge(source, wish, None);
        }
        let verdict = self.judge(source, wish.clone(), None)?;
        let is_refused = matches!(verdict, Verdict::Refused);
        self.carry_out(verdict, source, wish)?;
        Ok(match is_refused {
            true => Verdict::Refused,
            false => Verdict::Granted,
        })
    }

    pub(super) fn navigate(
        &self,
        source: &Page,
        wish: Wish,
        referrer: Option<String>,
    ) -> JsResult<()> {
        self.carry_out(self.judge(source, wish.clone(), referrer)?, source, wish)
    }

    fn carry_out(&self, verdict: Verdict, source: &Page, wish: Wish) -> JsResult<()> {
        match verdict {
            Verdict::Refused | Verdict::Granted => Ok(()),
            Verdict::UpToPage => self.page().navigate_for(source, wish),
            Verdict::UpToForeignPage => {
                let (url, replaces, is_by_user) = (wish.url, wish.replaces, wish.is_by_user);
                let wish = Wish {
                    url,
                    replaces,
                    is_by_user,
                    ..Default::default()
                };
                self.page().navigate_for(source, wish)
            }
        }
    }

    pub(super) fn close_for(&self, source: &Page) {
        if self.is_navigable_by(source) && self.is_within_reach_of(source, "") {
            self.close_for_script();
        }
    }

    pub(super) fn close_for_script(&self) {
        if !self.is_frame() && !self.context.is_closed.replace(true) {
            self.tell_pages(&Change::Closed);
            self.close_soon();
        }
    }

    pub(super) fn discard(&self) {
        self.context.is_closed.set(true);
        self.tell_pages(&Change::Discarded);
        self.context
            .group
            .members
            .borrow_mut()
            .retain(|it| *it != self.id);
        self.leave_unused_places();
    }

    fn find_below(&'static self, name: &str) -> JsResult<Option<&'static Contents>> {
        if *self.context.name.borrow() == name {
            return Ok(Some(self));
        }
        self.children()?
            .find_map(|it| it.find_below(name).transpose())
            .transpose()
    }

    fn is_familiar_to(&self, other: &Contents) -> bool {
        let with_openers = core::iter::successors(Some(self.itself()), |it| {
            it.opened_by().filter(|_| !it.is_frame())
        });
        let most = self.context.group.members.borrow().len();
        with_openers
            .take(most + 1)
            .any(|it| it.is_or_is_in_origin_of(other.page()) || same(it, other.owner()))
    }

    /// `None` for a new window.
    pub(super) fn choose(&self, target: &str) -> JsResult<Option<&'static Contents>> {
        match &*target.to_ascii_lowercase() {
            "" | "_self" => return Ok(Some(self.itself())),
            "_parent" => return Ok(self.parent().or_else(|| Some(self.itself()))),
            "_top" => return Ok(Some(self.owner())),
            "_blank" => return Ok(None),
            _ => {}
        }
        if let Some(found) = self
            .with_ancestors()
            .find_map(|it| it.find_below(target).transpose())
        {
            return found.map(Some);
        }
        let members = self.context.group.members.borrow();
        let is_meant = |it: &&Contents| {
            *it.context.name.borrow() == target
                && !it.context.is_closed.get()
                && it.is_familiar_to(self)
        };
        Ok(members.iter().copied().filter_map(with_id).find(is_meant))
    }
}
