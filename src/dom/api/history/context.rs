//! Browsing contexts: which documents share their objects, and what they see of the others.

use std::rc::Weak;

use bun_collections::HashMap;
use bun_jsc::Strong;
use bun_web::dom::Left;
use bun_web::page::Change;

use super::*;
use crate::api::core::Agent;
use crate::api::frames::{self, Frame};

/// The documents of a group that have the same origin. They use the modules of the first one.
pub(crate) struct Cluster {
    origin: String,
    group: Weak<Group>,
    first: RefCell<Option<Strong>>,
    pages: Cell<u32>,
}

#[derive(Default)]
struct Group(RefCell<Vec<Rc<Cluster>>>);

/// A window or a frame, whatever document it has.
pub(crate) struct Context {
    id: u32,
    group: Rc<Group>,
    /// That of the next document, as soon as it is certain.
    page: Cell<u32>,
    origin: RefCell<String>,
    name: RefCell<String>,
    is_initial: Cell<bool>,
    is_closed: Cell<bool>,
    has_crashed: Cell<bool>,
    /// Its document is in another process.
    is_elsewhere: Cell<bool>,
    children_elsewhere: RefCell<Vec<u32>>,
    image: u32,
    /// Those that have a window object for it.
    seen_by: RefCell<Vec<Rc<Cluster>>>,
}

slots!(
    Context = js_BrowsingContext {
        parent: Context,
        opener: Context,
        frame: Frame
    }
);

#[derive(Default)]
struct Hosted {
    contexts: RefCell<HashMap<u32, Strong>>,
    pages: RefCell<HashMap<u32, Strong>>,
}

bun_ui::state!(fn hosted() -> Hosted);

fn find<'a, T: JsInterface>(all: &RefCell<HashMap<u32, Strong>>, id: u32) -> Option<&'a T> {
    // SAFETY: each map has objects of one class.
    all.borrow()
        .get(&id)
        .map(|it| unsafe { T::from_js_unchecked(it.get()) })
}

impl Cluster {
    pub(crate) fn origin(&self) -> &str {
        &self.origin
    }

    fn first<'a>(&self) -> Option<&'a Window> {
        Window::from_value(self.first.borrow().as_ref()?.get())
    }

    /// It may have left.
    pub(super) fn has(self: &Rc<Self>, window: &Window) -> bool {
        window.cluster().is_some_and(|it| Rc::ptr_eq(it, self))
    }
}

impl Context {
    pub(crate) fn with_id<'a>(id: u32) -> Option<&'a Context> {
        find(&hosted().contexts, id)
    }

    pub(super) fn id(&self) -> u32 {
        self.id
    }

    pub(super) fn has_name(&self, name: &str) -> bool {
        *self.name.borrow() == name
    }

    pub(crate) fn name(&self) -> String {
        self.name.borrow().clone()
    }

    pub(crate) fn page(&self) -> u32 {
        self.page.get()
    }

    pub(crate) fn is_initial(&self) -> bool {
        self.is_initial.get()
    }

    pub(super) fn is_closed(&self) -> bool {
        self.is_closed.get()
    }

    pub(crate) fn has_crashed(&self) -> bool {
        self.has_crashed.get()
    }

    pub(crate) fn is_elsewhere(&self) -> bool {
        self.is_elsewhere.get()
    }

    pub(crate) fn is_frame(&self) -> bool {
        self.parent().is_some()
    }

    pub(crate) fn image(&self) -> u32 {
        self.image
    }

    pub(crate) fn has_origin(&self, cluster: &Cluster) -> bool {
        *self.origin.borrow() == cluster.origin
    }

    pub(crate) fn container(&self) -> Option<&Frame> {
        self.frame()
    }

    pub(super) fn parent_or_itself(&self) -> &Context {
        self.parent().unwrap_or(self)
    }

    pub(super) fn top(&self) -> &Context {
        core::iter::successors(Some(self), |it| it.parent())
            .last()
            .unwrap_or(self)
    }

    pub(super) fn opened_by(&self) -> Option<&Context> {
        self.opener()
    }

    /// Unless nothing has looked at the empty document yet.
    pub(crate) fn window(&self) -> Option<&Window> {
        Window::of_page(self.page.get())
    }

    pub(crate) fn started_window(&self, wanted_by: &Window) -> Option<&Window> {
        self.window().or_else(|| {
            (!self.is_elsewhere()).then(|| wanted_by.host().start_window(self.id))?;
            self.window()
        })
    }

    /// In the order of the tree.
    pub(super) fn children(&self) -> impl Iterator<Item = &Context> {
        let elsewhere = if self.is_elsewhere() {
            self.children_elsewhere.borrow().clone()
        } else {
            Vec::new()
        };
        self.window()
            .and_then(|it| Ui::of(it.document()))
            .into_iter()
            .flat_map(frames::entry::local_contexts)
            .chain(elsewhere.into_iter().filter_map(Context::with_id))
    }

    fn windows(&self) -> List<'_> {
        List::from_value(js_BrowsingContext::windows(self).expect("it is set first"))
    }

    fn known_window(&self, cluster: &Rc<Cluster>) -> Option<JSValue> {
        Some(
            self.windows().get(
                self.seen_by
                    .borrow()
                    .iter()
                    .position(|it| Rc::ptr_eq(it, cluster))? as u32,
            ),
        )
    }

    fn remember_window(&self, heap: &JsHeap<'_>, cluster: &Rc<Cluster>, window: JSValue) {
        if self.known_window(cluster).is_none() {
            self.seen_by.borrow_mut().push(Rc::clone(cluster));
            self.windows().push(heap, window);
        }
    }

    fn cluster(&self) -> Option<Rc<Cluster>> {
        self.group
            .0
            .borrow()
            .iter()
            .find(|it| self.has_origin(it))
            .cloned()
    }

    pub(crate) fn agent<'a>(&self) -> Option<&'a Agent> {
        Some(self.cluster()?.first()?.document().agent())
    }

    fn join(&self, heap: &JsHeap<'_>, window: &Window) -> Rc<Cluster> {
        let cluster = self.cluster().unwrap_or_else(|| {
            let first = Some(Strong::create(window.to_js(), global_of(heap))).into();
            let made = Rc::new(Cluster {
                origin: self.origin.borrow().clone(),
                group: Rc::downgrade(&self.group),
                first,
                pages: 0.into(),
            });
            self.group.0.borrow_mut().push(Rc::clone(&made));
            made
        });
        cluster.pages.update(|it| it + 1);
        self.remember_window(heap, &cluster, window.window());
        cluster
    }

    /// What was the window of the last document is now one of another origin.
    fn show(&self, heap: &JsHeap<'_>, page: u32, origin: String) {
        self.page.set(page);
        self.origin.replace(origin);
        let (clusters, windows) = (self.seen_by.take(), self.windows());
        js_BrowsingContext::set_windows(self, List::new(heap).to_js());
        for (at, cluster) in (0..).zip(&clusters).filter(|it| it.1.pages.get() > 0) {
            self.remember_window(heap, cluster, windows.get(at));
            if !self.has_origin(cluster) {
                self.cross_origin_window(heap, cluster, windows.get(at));
            }
        }
        windows.to_js().ensure_still_alive();
    }

    fn cross_origin_window(
        &self,
        heap: &JsHeap<'_>,
        cluster: &Rc<Cluster>,
        existing: JSValue,
    ) -> Option<JSValue> {
        let first = cluster.first()?;
        Some(ForeignWindow::in_this_process(
            first.realm(heap),
            first,
            self,
            cluster,
            existing,
        ))
    }

    pub(crate) fn window_for(&self, heap: &JsHeap<'_>, cluster: &Rc<Cluster>) -> JSValue {
        if let Some(first) = cluster
            .first()
            .filter(|_| self.has_origin(cluster) && !self.is_closed())
        {
            self.started_window(first);
        }
        let make = || {
            self.cross_origin_window(heap, cluster, JSValue::UNDEFINED)
                .inspect(|it| self.remember_window(heap, cluster, *it))
        };
        self.known_window(cluster)
            .or_else(make)
            .unwrap_or(JSValue::NULL)
    }
}

impl Window {
    pub(crate) fn of_page<'a>(id: u32) -> Option<&'a Window> {
        find(&hosted().pages, id)
    }

    pub(crate) fn settle_in(&self, heap: &JsHeap<'_>, context: &Context, has_relatives: bool) {
        js_DomWindow::set_context(self, context.to_js());
        if has_relatives {
            _ = self.cluster.set(context.join(heap, self));
        }
    }

    /// From now on it can be told what to do.
    pub(crate) fn enlist(&self, heap: &JsHeap<'_>) {
        if self.page != 0 {
            hosted()
                .pages
                .borrow_mut()
                .insert(self.page, Strong::create(self.to_js(), global_of(heap)));
        }
    }

    pub(crate) fn resign(&self) {
        drop(hosted().pages.borrow_mut().remove(&self.page));
    }

    pub(crate) fn context(&self) -> Option<&Context> {
        Context::from_value(js_DomWindow::context(self)?)
    }

    /// Pages that can reach each other have one.
    pub(crate) fn cluster(&self) -> Option<&Rc<Cluster>> {
        self.cluster.get()
    }

    /// Whether the windows that it opens, and the one that has opened it, share objects with it.
    pub(super) fn knows_other_windows(&self) -> bool {
        self.cluster().is_some() && bun_web::trust::relates_windows()
    }

    /// `None` if it has no relatives.
    pub(super) fn relative<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        which: impl FnOnce(&'a Context) -> Option<&'a Context>,
    ) -> Option<JSValue> {
        let (cluster, context) = (self.cluster()?, self.context()?);
        Some(
            which(context)
                .filter(|_| !self.is_disposed())
                .map_or(JSValue::NULL, |it| it.window_for(heap, cluster)),
        )
    }

    pub(crate) fn leave_cluster(&self) -> Left {
        let Some(cluster) = self.cluster().filter(|_| !self.has_left.replace(true)) else {
            return Left::default();
        };
        let is_first = cluster.first().is_some_and(|it| core::ptr::eq(it, self));
        cluster.pages.update(|it| it - 1);
        if cluster.pages.get() > 0 {
            return Left {
                is_needed: is_first,
                is_reachable: true,
                released: None,
            };
        }
        cluster
            .group
            .upgrade()
            .into_iter()
            .for_each(|it| it.0.borrow_mut().retain(|it| !Rc::ptr_eq(it, cluster)));
        let released = cluster.first().map(|it| global_of_cell(it).to_js_value());
        cluster.first.take();
        Left {
            is_needed: is_first,
            is_reachable: false,
            released,
        }
    }
}

fn create(id: u32, [embedder, parent, opener, related]: [Option<u32>; 4], frame: u32, image: u32) {
    let heap = JsHeap::from_global(bun_ui::main_global());
    let group = related
        .and_then(Context::with_id)
        .map(|it| Rc::clone(&it.group))
        .unwrap_or_default();
    let (
        page,
        origin,
        name,
        is_initial,
        is_closed,
        has_crashed,
        is_elsewhere,
        children_elsewhere,
        seen_by,
    ) = Default::default();
    let this = js_BrowsingContext::create(
        heap,
        Context {
            id,
            group,
            page,
            origin,
            name,
            is_initial,
            is_closed,
            has_crashed,
            is_elsewhere,
            children_elsewhere,
            image,
            seen_by,
        },
    );
    js_BrowsingContext::set_windows(this, List::new(heap).to_js());
    this.set_opener(opener.and_then(Context::with_id));
    this.set_parent(parent.and_then(Context::with_id));
    if let Some(embedder) = embedder.and_then(Window::of_page) {
        this.set_frame(Frame::with_number(embedder, frame));
        this.frame()
            .into_iter()
            .for_each(|it| it.show_context(this, image));
    }
    hosted()
        .contexts
        .borrow_mut()
        .insert(id, Strong::create(this.to_js(), global_of(heap)));
}

#[unsafe(no_mangle)]
fn __bun_dom_change_context(id: u32, change: Change) {
    if let Change::Created {
        embedder,
        parent,
        frame,
        image,
        opener,
        related,
    } = change
    {
        return create(id, [embedder, parent, opener, related], frame, image);
    }
    let Some(this) = Context::with_id(id) else {
        return;
    };
    match change {
        Change::Created { .. } => {}
        Change::Shows {
            page,
            origin,
            is_initial,
        } => {
            this.is_initial.set(is_initial);
            this.has_crashed.set(false);
            this.is_elsewhere.set(origin.is_none());
            this.show(
                JsHeap::from_global(bun_ui::main_global()),
                page,
                origin.unwrap_or_default(),
            );
            if let Some(frame) = this.frame().filter(|_| this.is_elsewhere())
                && let Some(outer) = Window::of(frame.around().doc())
            {
                outer.enter(|cx, _| {
                    Frame::from_value(frame.to_js())
                        .into_iter()
                        .for_each(|it| it.lose_document(cx))
                });
            }
        }
        Change::Children(all) => drop(this.children_elsewhere.replace(all)),
        Change::Renamed(name) => drop(this.name.replace(name)),
        Change::OpenedBy(opener) => this.set_opener(opener.and_then(Context::with_id)),
        Change::Crashed => this.has_crashed.set(true),
        Change::Closed => this.is_closed.set(true),
        Change::Discarded => {
            this.is_closed.set(true);
            drop(hosted().contexts.borrow_mut().remove(&id));
        }
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_window_to_take_over(context: u32) -> JSValue {
    Context::with_id(context)
        .and_then(|it| it.known_window(&it.cluster()?))
        .unwrap_or(JSValue::UNDEFINED)
}

#[unsafe(no_mangle)]
fn __bun_dom_element_of_frame(page: u32, frame: u32) -> JSValue {
    Window::of_page(page)
        .and_then(|it| Frame::with_number(it, frame))
        .map_or(JSValue::UNDEFINED, |it| it.element().to_js())
}
