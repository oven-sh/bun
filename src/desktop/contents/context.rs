//! Browsing contexts: which documents share their objects, and what they see of the others.

use std::rc::{Rc, Weak};

use bun_jsc::{JSMap, Strong};
use bun_web::origin::is_same_site;
use bun_web::url::Url;

use super::load::Initiator;
use super::page::Page;
use super::worlds::{self, World};
use super::{
    Contents, NOTHING, fields, lazily, nothing, object_in, text_at, with_id, without_hash,
};
use crate::prelude::*;

/// The documents of a group that have the same origin. They use the modules of the first one.
pub(super) struct Agent {
    id: u32,
    key: String,
    group: Weak<Group>,
    root: RefCell<Option<[Strong; 2]>>,
    pages: Cell<u32>,
}

#[derive(Default)]
struct Group {
    agents: RefCell<Vec<Rc<Agent>>>,
    members: RefCell<Vec<u32>>,
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
    group: Rc<Group>,
    /// Those that have a window object for it.
    seen_by: RefCell<Vec<Rc<Agent>>>,
}

/// Of the first document.
#[derive(Clone, Copy)]
pub(super) struct Root {
    pub(super) realm: JSValue,
    pub(super) controller: JSValue,
}

impl Agent {
    pub(super) fn root(&self) -> Option<Root> {
        let [realm, controller] = self.root.borrow().as_ref()?.each_ref().map(Strong::get);
        Some(Root { realm, controller })
    }

    /// It may have left.
    pub(super) fn has(&self, page: &Page) -> bool {
        page.agent().is_some_and(|it| it.id == self.id)
    }

    /// For what a script says that it is, in the first argument.
    pub(super) fn member(&self, given: &[JSValue]) -> JsResult<&'static Page> {
        let found = Some(Page::given(given, 0)?).filter(|it| self.has(it));
        found.ok_or_else(|| type_error(format_args!("Illegal invocation")))
    }

    pub(super) fn has_other_pages(&self) -> bool {
        self.pages.get() > 1
    }

    pub(super) fn leave(&self) -> JsResult<()> {
        self.pages.update(|it| it - 1);
        if self.pages.get() > 0 {
            return Ok(());
        }
        if let Some(group) = self.group.upgrade() {
            group.agents.borrow_mut().retain(|it| it.id != self.id);
        }
        if let Some([realm, _]) = self.root.take() {
            worlds::release(realm.get());
        }
        Ok(())
    }
}

impl Context {
    pub(super) fn new(related: Option<&Contents>) -> Context {
        Context {
            name: Default::default(),
            is_closed: false.into(),
            is_popup: false.into(),
            frame_count: 0.into(),
            may_fill_screen: false.into(),
            group: related
                .map(|it| Rc::clone(&it.context.group))
                .unwrap_or_default(),
            seen_by: Default::default(),
        }
    }

    pub(super) fn is_alone(&self) -> bool {
        self.group.members.borrow().len() == 1
    }
}

type Seen = fn(&'static Contents, &Rc<Agent>, &[JSValue]) -> JsResult<JSValue>;

const CROSS_ORIGIN: &[(&str, Seen)] = &[
    ("isClosed", |it, _, _| js(it.context.is_closed.get())),
    ("length", |it, _, _| js(it.children()?.count() as u32)),
    ("child", |it, agent, given| {
        let found = match argument(given, 0).get_number() {
            Some(index) => it.children()?.nth(index as usize),
            None => {
                let name = text_at(given, 0)?;
                it.children()?.find(|it| *it.context.name.borrow() == name)
            }
        };
        found.map_or(Ok(JSValue::UNDEFINED), |it| it.window_for(agent))
    }),
    ("parent", |it, agent, _| {
        it.relative(Some(it.parent().unwrap_or(it)), agent)
    }),
    ("top", |it, agent, _| it.relative(Some(it.owner()), agent)),
    ("opener", |it, agent, _| it.relative(it.opened_by(), agent)),
    ("navigate", |it, agent, given| {
        let options = object!({ "replace": argument(given, 2) });
        js(it.navigate(agent.member(given)?, &text_at(given, 1)?, options)?)
    }),
    ("postMessage", |it, agent, given| {
        nothing(it.started_page()?.post_message(agent.member(given)?, given))
    }),
    ("close", |it, agent, given| {
        let source = agent.member(given)?;
        if it.is_navigable_by(source)? && it.is_within_reach_of(source, "")? {
            it.close_for_script();
        }
        NOTHING
    }),
    ("focus", |it, _, _| {
        nothing(if it.is_frame() {
            it.tell_element("focus", &[])
        } else {
            it.focus_window()
        })
    }),
];

impl Contents {
    pub(super) fn opened_by(&self) -> Option<&'static Contents> {
        fields::opened_by(self.itself())
    }

    fn with_ancestors(&self) -> impl Iterator<Item = &'static Contents> {
        core::iter::successors(Some(self.itself()), |it| it.parent())
    }

    /// In the order of the tree.
    pub(super) fn children(&self) -> JsResult<impl Iterator<Item = &'static Contents> + use<>> {
        let (frames, mut ids) = (self.page().ask("frames", &[])?, Vec::new());
        if frames.is_array() {
            ids.extend(
                instances::<Contents>(frames)
                    .map(|it| it.map(|it| it.id))
                    .collect::<JsResult<Vec<_>>>()?,
            );
        }
        let this = self.itself();
        let is_child = move |it: &&Contents| it.parent().is_some_and(|it| same(it, this));
        Ok(ids.into_iter().filter_map(with_id).filter(is_child))
    }

    fn windows(&self) -> JsResult<&'static mut JSMap> {
        lazily(
            fields::windows(self),
            || Ok(JSMap::create(global())),
            |it| fields::set_windows(self, it),
        )
        .map(map_in)
    }

    fn known_window(&self, agent: &Agent) -> JsResult<Option<JSValue>> {
        Ok(object_in(Some(
            self.windows()?.get(global(), js(agent.id)?)?,
        )))
    }

    fn remember_window(&self, agent: &Rc<Agent>, window: JSValue) -> JsResult<()> {
        if self
            .context
            .seen_by
            .borrow()
            .iter()
            .all(|it| it.id != agent.id)
        {
            self.context.seen_by.borrow_mut().push(Rc::clone(agent));
        }
        self.windows()?.set(global(), js(agent.id)?, window)
    }

    /// With the window object that the realm is to take over.
    pub(super) fn join(&self, page: &Page) -> JsResult<(Rc<Agent>, Option<JSValue>)> {
        let (group, key) = (&self.context.group, page.origin_key());
        let known = group
            .agents
            .borrow()
            .iter()
            .find(|it| it.key == key)
            .cloned();
        let agent = known.unwrap_or_else(|| {
            let agent = Agent {
                id: page.id,
                key,
                group: Rc::downgrade(group),
                root: None.into(),
                pages: 0.into(),
            };
            let agent = Rc::new(agent);
            group.agents.borrow_mut().push(Rc::clone(&agent));
            agent
        });
        agent.pages.update(|it| it + 1);
        let window = self.known_window(&agent)?;
        Ok((agent, window))
    }

    pub(super) fn joined(
        &self,
        agent: &Rc<Agent>,
        world: World,
        controller: JSValue,
    ) -> JsResult<()> {
        let root = || [world.realm.to_js_value(), controller].map(keep);
        agent.root.borrow_mut().get_or_insert_with(root);
        self.remember_window(agent, world.handle_of_window())
    }

    /// What was the window of the last document is now one of another origin.
    pub(super) fn show_from_now(&self, page: &Page) -> JsResult<()> {
        self.crashed_at.take();
        let key = page.origin_key();
        match fields::page(self) {
            None => self.context.group.members.borrow_mut().push(self.id),
            Some(old)
                if !self.is_frame()
                    && self.opened_by().is_none()
                    && !old.is_initial()
                    && old.origin_key() != key =>
            {
                self.context.name.take();
            }
            Some(_) => {}
        }
        if let Some(old) = fields::page(self).filter(|it| !same(*it, page)) {
            page.succeed(old);
        }
        fields::set_page(self, Some(page));
        for agent in self.context.seen_by.take() {
            let Some(window) = self.known_window(&agent)?.filter(|_| agent.pages.get() > 0) else {
                self.windows()?.remove(global(), js(agent.id)?)?;
                continue;
            };
            self.context.seen_by.borrow_mut().push(Rc::clone(&agent));
            if agent.key != key {
                self.cross_origin_window(&agent, window)?;
            }
        }
        Ok(())
    }

    fn cross_origin_window(&self, agent: &Rc<Agent>, existing: JSValue) -> JsResult<JSValue> {
        let Some(root) = agent.root() else {
            return Ok(JSValue::NULL);
        };
        let seen = object!({});
        for &(name, method) in CROSS_ORIGIN {
            let agent = Rc::clone(agent);
            let body = move |it, given: &[JSValue]| {
                // SAFETY: what was captured.
                method(unsafe { Contents::from_js_unchecked(it) }, &agent, given)
            };
            seen.put(global(), name.as_bytes(), function(self.to_js(), body)?);
        }
        invoke(root.controller, "crossOriginWindow", &[seen, existing])
    }

    pub(super) fn window_for(&self, agent: &Rc<Agent>) -> JsResult<JSValue> {
        if self.page().origin_key() == agent.key && !self.context.is_closed.get() {
            self.started_page()?;
        }
        if let Some(window) = self.known_window(agent)? {
            return Ok(window);
        }
        let window = self.cross_origin_window(agent, JSValue::UNDEFINED)?;
        self.remember_window(agent, window).map(|()| window)
    }

    fn relative(&self, other: Option<&Contents>, agent: &Rc<Agent>) -> JsResult<JSValue> {
        other
            .filter(|_| !self.context.is_closed.get())
            .map_or(Ok(JSValue::NULL), |it| it.window_for(agent))
    }

    /// <https://html.spec.whatwg.org/#allowed-to-navigate>
    pub(super) fn is_navigable_by(&self, source: &Page) -> JsResult<bool> {
        let context = source.contents();
        if !source.sandbox().is_on() || self.with_ancestors().any(|it| same(it, context)) {
            return Ok(true);
        }
        if self.is_frame() {
            return Ok(false);
        }
        if !same(self, context.owner()) {
            return Ok(self.opened_by().is_some_and(|it| same(it, context)));
        }
        Ok(!source.forbids("allow-top-navigation")
            || (!source.forbids("allow-top-navigation-by-user-activation")
                && source.ask("isActive", &[])?.to_boolean()))
    }

    fn is_or_is_in_origin_of(&self, page: &Page) -> bool {
        let key = page.origin_key();
        self.with_ancestors()
            .any(|it| it.page().origin_key() == key)
    }

    /// Browsers are stricter than the standard.
    fn is_within_reach_of(&self, source: &Page, url: &str) -> JsResult<bool> {
        if self.is_or_is_in_origin_of(source) {
            return Ok(true);
        }
        if self.is_frame() {
            return Ok(false);
        }
        if !same(self, source.contents().owner()) {
            return Ok(source
                .contents()
                .opened_by()
                .is_some_and(|it| same(it, self))
                || self
                    .opened_by()
                    .is_none_or(|it| it.is_or_is_in_origin_of(source)));
        }
        Ok(source.sandbox().is_on()
            || source.ask("hasBeenActive", &[])?.to_boolean()
            || Url::parse(url.as_bytes())
                .is_some_and(|it| is_same_site(&it, &self.page().client.url())))
    }

    /// False if `source` may not.
    pub(super) fn navigate(&self, source: &Page, url: &str, options: JSValue) -> JsResult<bool> {
        if !self.is_navigable_by(source)? || !self.is_within_reach_of(source, url)? {
            return Ok(false);
        }
        let stays =
            without_hash(url) != url && without_hash(url) == without_hash(&self.page().url());
        let page = match stays || url.starts_with("javascript:") {
            true => self.started_page()?,
            false => self.page(),
        };
        if page.is_started() && page.origin_key() == source.origin_key() {
            page.navigate_for(source, url, options)?;
        } else if stays && get(options, "body")?.is_undefined() {
            let options = object!({ "replace": get(options, "replace")?, "isByUser": get(options, "isByUser")? });
            page.navigate_for(source, url, options)?;
        } else {
            self.wish(page, url, options, Initiator::of(source))?;
        }
        Ok(true)
    }

    pub(super) fn close_for_script(&self) {
        if !self.is_frame() && !self.context.is_closed.replace(true) {
            self.close_soon();
        }
    }

    pub(super) fn discard(&self) {
        self.context.is_closed.set(true);
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
