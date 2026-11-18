//! Browsing contexts: which ones know each other, and what they may do to each other.

use std::rc::Rc;

use bun_ui::protocol::PageCommand;
use bun_web::host::{Verdict, Wish};
use bun_web::origin::{Site, is_same_site};
use bun_web::page::{self, Change, Link as _};
use bun_web::url::Url;

use super::load::Initiator;
use super::page::Page;
use super::process::{self, Process};
use super::{Contents, fields, with_id, without_hash};
use crate::prelude::*;

#[derive(Default)]
struct Group {
    members: RefCell<Vec<u32>>,
    /// What knows all of them.
    process: RefCell<Option<Rc<Process>>>,
}

/// A window or a frame, whatever document it has.
pub(super) struct Context {
    pub(super) name: RefCell<String>,
    pub(super) is_closed: Cell<bool>,
    pub(super) is_popup: Cell<bool>,
    /// Below the top one.
    pub(super) frame_count: Cell<i32>,
    /// The app has allowed it, once.
    pub(super) may_fill_screen: Cell<bool>,
    /// When the user has last pressed something.
    pub(super) last_input: Cell<f64>,
    group: Rc<Group>,
}

impl Context {
    pub(super) fn new(related: Option<&Contents>) -> Context {
        Context {
            name: Default::default(),
            is_closed: false.into(),
            is_popup: false.into(),
            frame_count: 0.into(),
            may_fill_screen: false.into(),
            last_input: f64::NEG_INFINITY.into(),
            group: related
                .map(|it| Rc::clone(&it.context.group))
                .unwrap_or_default(),
        }
    }

    pub(super) fn is_alone(&self) -> bool {
        self.group.members.borrow().len() == 1
    }
}

fn site_of(page: &Page) -> Option<String> {
    let origin = Some(page.client.origin()).filter(|it| !it.is_opaque())?;
    Some(string(Site::of_origin(&origin).as_bytes()))
}

impl Contents {
    pub(super) fn opened_by(&self) -> Option<&'static Contents> {
        fields::opened_by(self.itself())
    }

    fn with_ancestors(&self) -> impl Iterator<Item = &'static Contents> {
        core::iter::successors(Some(self.itself()), |it| it.parent())
    }

    /// Those that `window[index]` has.
    pub(super) fn children(&self) -> JsResult<impl Iterator<Item = &'static Contents> + use<>> {
        let frames = instances::<Contents>(self.page().frames_if_any()?);
        let ids = (frames.map(|it| it.map(|it| it.id))).collect::<JsResult<Vec<_>>>()?;
        Ok((ids.into_iter().filter_map(with_id)).filter(|it| it.is_indexed()))
    }

    pub(super) fn tell_pages(&self, change: Change) {
        if process::are_wanted() {
            return self.process().map_or((), |it| it.change(self.id, change));
        }
        page::here().change(self.id, change);
    }

    pub(super) fn creation(&self, related: Option<u32>) -> Change {
        let embedded = self.embedded.as_ref();
        Change::Created {
            embedder: fields::embedder(self).map(|it| it.id),
            frame: embedded.map_or(0, |it| it.number),
            image: embedded.map_or(0, |it| it.image),
            opener: self.opened_by().map(|it| it.id),
            related,
        }
    }

    pub(super) fn process(&self) -> Option<Rc<Process>> {
        let process = self.context.group.process.borrow().clone();
        process.filter(|it| !it.is_gone())
    }

    /// `None` for this one.
    pub(super) fn process_for(&self, page: &Page) -> JsResult<Option<Rc<Process>>> {
        if !process::are_wanted() {
            return Ok(None);
        }
        let process = match (self.process(), page.opener().and_then(Page::process)) {
            (Some(known), _) => known,
            (None, of_opener) => {
                let process = of_opener.map_or_else(process::take, Ok)?;
                let group = &self.context.group;
                group.process.replace(Some(Rc::clone(&process)));
                let members = group.members.borrow().clone();
                let members = members.iter().filter_map(|it| with_id(*it));
                let mut first = None;
                for it in members.filter(|it| !it.is_frame() || it.embedder().is_in(&process)) {
                    it.tell_pages(it.creation(first));
                    it.rename(it.name());
                    it.set_page(it.page());
                    first = first.or(Some(it.id));
                }
                process
            }
        };
        if process.site.borrow().is_none() {
            let site = site_of(page);
            (site.iter())
                .for_each(|it| process.command(PageCommand::StoreFontsFor((&**it).into())));
            process.site.replace(site);
        }
        Ok(Some(process))
    }

    pub(super) fn leave_process_unless_it_suits(&self, page: &Page) {
        let Some(process) = self.process().filter(|_| !page.is_started()) else {
            return;
        };
        let is_of_other_site = (process.site.borrow().as_ref().zip(site_of(page)))
            .is_some_and(|(known, new)| *known != new);
        if self.context.is_alone() && (is_of_other_site || process.is_late()) {
            self.tell_pages(Change::Discarded);
            process.command(PageCommand::Revoke(self.surface));
            self.context.group.process.take();
        }
    }

    pub(super) fn rename(&self, name: String) {
        self.context.name.replace(name.clone());
        self.tell_pages(Change::Renamed(name));
    }

    pub(super) fn set_opened_by(&self, opener: Option<&Contents>) {
        fields::set_opened_by(self, opener);
        self.tell_pages(Change::OpenedBy(opener.map(|it| it.id)));
    }

    pub(super) fn set_page(&self, page: &Page) {
        fields::set_page(self, Some(page));
        self.tell_pages(Change::Shows {
            page: page.id,
            origin: page.origin_key(),
            is_initial: page.is_initial(),
        });
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
        if page.is_started() && page.origin_key() == source.origin_key() {
            return Ok(Verdict::UpToPage);
        }
        if stays && wish.post.is_none() {
            return Ok(Verdict::UpToForeignPage);
        }
        self.wish(page, wish, Initiator::of(source), referrer)?;
        Ok(Verdict::Granted)
    }

    pub(super) fn navigate(
        &self,
        source: &Page,
        wish: Wish,
        referrer: Option<String>,
    ) -> JsResult<()> {
        match self.judge(source, wish.clone(), referrer)? {
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
            self.tell_pages(Change::Closed);
            self.close_soon();
        }
    }

    pub(super) fn discard(&self) {
        self.context.is_closed.set(true);
        self.tell_pages(Change::Discarded);
        self.context
            .group
            .members
            .borrow_mut()
            .retain(|it| *it != self.id);
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
