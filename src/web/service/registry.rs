use core::cell::RefCell;
use core::sync::atomic::Ordering;
use core::time::Duration;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Weak;

use bun_collections::index_sort::sort_slice_by_key;

use super::jobs::{Job, Turns};
use super::router::MOST_CONDITIONS;
use super::*;
use crate::HashMap;
use crate::client::bucket_of;
use crate::compiled::{self, Form};
use crate::exec::{self, Either, Shared, oneshot};
use crate::headers::HeaderList;
use crate::net::NetError;
use crate::net::cookies;
use crate::net::fetch::{self, Controller, EndOfBody, Initiator, Observer};
use crate::net::response::is_ok_status;
use crate::net::session::OF_MAIN_THREAD;
use crate::origin::Site;
use crate::outside::serve;
use crate::remote::is_page_process;
use crate::request::{InitiatorType, Mode, Redirect};
use crate::storage::caches::{CachedRequest, Caches, QueryOptions};
use crate::storage::{Origins, if_for_page_processes};
use crate::time::{monotonic_now, wall_now};

/// In milliseconds.
const LONGEST_IDLENESS: f64 = 30e3;
pub(super) const LONGEST_EVENT: f64 = 300e3;
const CLICK_LASTS: f64 = 10e3;

/// Of a bucket.
const MOST_BYTES_ABOUT_REGISTRATIONS: usize = 512 << 10;
const MOST_RUNNING: usize = 32;
/// Of a registration.
const MOST_SUBSCRIPTIONS: usize = 100;
const MOST_NOTIFICATIONS: usize = 100;
pub(super) const BYTES_PER_REGISTRATION: usize = 1 << 10;
pub(super) const NO_ROOM: &str = "There is no room for that.";

pub(super) struct Registration {
    pub(super) id: Id,
    pub(super) bucket: Bytes,
    pub(super) ancestors: Vec<Origin>,
    pub(super) scope: Url,
    pub(super) update_via_cache: UpdateViaCache,
    pub(super) workers: [Option<Id>; 3],
    pub(super) checked_at: f64,
    pub(super) preload: (bool, Bytes),
    pub(super) subscriptions: Vec<Subscription>,
    pub(super) is_unregistered: bool,
    pub(super) is_update_due: bool,
}

impl Registration {
    pub(super) fn newest(&self) -> Option<Id> {
        self.workers.into_iter().flatten().next()
    }

    pub(super) fn is_stale(&self) -> bool {
        wall_now() - self.checked_at > 86_400.
    }
}

pub(super) struct Run {
    /// It may outlast the registration.
    bucket: Bytes,
    client: ClientId,
    started: Shared<Option<Address>>,
    thread: Option<Running>,
    process: Option<u32>,
}

#[derive(Clone)]
pub(super) struct Scripts {
    pub(super) source: Option<SharedBytes>,
    pub(super) headers: HeaderList,
    pub(super) imports: Arc<Guarded<Imports>>,
}

pub(super) struct Worker {
    pub(super) info: WorkerInfo,
    pub(super) registration: Id,
    pub(super) is_module: bool,
    pub(super) is_compiled: bool,
    /// Until they are stored, and while it runs.
    pub(super) scripts: Option<Scripts>,
    /// Where they are stored.
    pub(super) row: Option<i64>,
    pub(super) handles_fetch: bool,
    pub(super) routes: Vec<Rule>,
    pub(super) size_of_routes: usize,
    pub(super) skips_waiting: bool,
    pub(super) pending: u32,
    pub(super) idle_since: f64,
    /// With when their time has begun.
    pub(super) events: VecDeque<(f64, Weak<Limit>)>,
    /// When it last got an event that no service worker has made.
    pub(super) needed_at: f64,
    pub(super) clicked_at: f64,
    pub(super) run: Option<Run>,
    pub(super) activation: Option<Shared<()>>,
}

impl Worker {
    pub(super) fn new(url: Url, state: State, registration: Id) -> Worker {
        Worker {
            info: WorkerInfo {
                id: ClientId::next().0,
                url,
                state,
            },
            registration,
            is_module: false,
            is_compiled: false,
            scripts: None,
            row: None,
            handles_fetch: true,
            routes: Vec::new(),
            size_of_routes: 0,
            skips_waiting: false,
            pending: 0,
            idle_since: monotonic_now(),
            events: VecDeque::new(),
            needed_at: f64::NEG_INFINITY,
            clicked_at: f64::NEG_INFINITY,
            run: None,
            activation: None,
        }
    }
}

const MOST_STEPS_TO_ROUTE: usize = 1 << 18;

struct Known {
    bucket: Bytes,
    uses: Option<Id>,
    /// Once it is there.
    caller: Option<Box<Caller>>,
    listens: bool,
    /// Those who have asked for it.
    awaited: Vec<(Address, u32)>,
}

impl Known {
    fn expected(bucket: Bytes, uses: Option<Id>) -> Known {
        Known {
            bucket,
            uses,
            caller: None,
            listens: false,
            awaited: Vec::new(),
        }
    }
}

const MOST_AWAITING: usize = 1024;
const MOST_WORLDS: usize = 64;

#[derive(Default)]
pub(super) struct Contents {
    pub(super) registrations: Vec<Registration>,
    pub(super) workers: HashMap<Id, Worker>,
    known: HashMap<Id, Known>,
    awaiting_ready: Vec<(Box<Caller>, u32)>,
    /// The last job, and how many are not done.
    pub(super) queues: HashMap<Bytes, (Shared<()>, usize)>,
    pub(super) turns: HashMap<Bytes, Turns>,
    /// When something else than a service worker has last asked something of those of a bucket.
    needed_at: HashMap<Bytes, f64>,
    /// Where it has found or put scripts.
    pub(super) rows: Vec<i64>,
    pub(super) has_swept: bool,
    notifications: Vec<(Id, Notification)>,
    pub(super) agent: Agent,
}

impl Contents {
    pub(super) fn registration(&mut self, id: Id) -> Option<&mut Registration> {
        self.registrations.iter_mut().find(|it| it.id == id)
    }

    pub(super) fn describe(&self, it: &Registration) -> RegistrationInfo {
        RegistrationInfo {
            id: it.id,
            scope: it.scope.clone(),
            update_via_cache: it.update_via_cache,
            workers: (it.workers).map(|it| Some(self.workers.get(&it?)?.info.clone())),
        }
    }

    pub(super) fn info(&self, id: Id) -> Option<RegistrationInfo> {
        Some(self.describe(self.registrations.iter().find(|it| it.id == id)?))
    }

    fn of_bucket<'a>(&'a self, bucket: &'a [u8]) -> impl Iterator<Item = &'a Registration> {
        (self.registrations.iter()).filter(move |it| !it.is_unregistered && *it.bucket == *bucket)
    }

    pub(super) fn has_room(&self, bucket: &[u8], more: usize) -> bool {
        let size_of = |it: &Registration| {
            let workers = (it.workers.iter().flatten()).filter_map(|it| self.workers.get(it));
            let subscriptions = it.subscriptions.iter().map(Subscription::size);
            BYTES_PER_REGISTRATION
                + it.scope.href().len()
                + it.preload.1.len()
                + subscriptions.sum::<usize>()
                + (workers.map(|it| it.info.url.href().len() + it.size_of_routes)).sum::<usize>()
        };
        let all = (self.registrations.iter()).filter(|it| *it.bucket == *bucket);
        all.map(size_of).sum::<usize>() + more <= MOST_BYTES_ABOUT_REGISTRATIONS
    }

    pub(super) fn with_scope(&self, bucket: &[u8], scope: &Url) -> Option<Id> {
        Some(self.of_bucket(bucket).find(|it| it.scope == *scope)?.id)
    }

    /// <https://w3c.github.io/ServiceWorker/#scope-match-algorithm>
    fn matching<'a>(&'a self, bucket: &'a [u8], url: &Url) -> Option<&'a Registration> {
        self.of_bucket(bucket)
            .filter(|it| url.href().starts_with(it.scope.href()))
            .max_by_key(|it| it.scope.href().len())
    }

    fn note_need(&mut self, bucket: &[u8]) {
        match self.needed_at.get_mut(bucket) {
            Some(it) => *it = monotonic_now(),
            None => _ = self.needed_at.insert(bucket.into(), monotonic_now()),
        }
    }

    pub(super) fn knows(&self, client: Id) -> bool {
        self.known.contains_key(&client)
    }

    fn is_used(&self, registration: Id) -> bool {
        self.known.values().any(|it| it.uses == Some(registration))
    }

    fn is_idle(&self, worker: Option<Id>) -> bool {
        worker.is_none_or(|it| self.workers.get(&it).is_none_or(|it| it.pending == 0))
    }

    fn broadcast(&self, registration: Id, notice: impl Fn() -> Notice) {
        let Some(it) = self.registrations.iter().find(|it| it.id == registration) else {
            return;
        };
        let listeners = (self.known.values()).filter(|other| {
            (other.listens && other.bucket == it.bucket) || other.uses == Some(registration)
        });
        for caller in listeners.filter_map(|it| it.caller.as_ref()) {
            caller.address.tell(notice());
        }
    }

    pub(super) fn announce(&self, registration: Id) {
        if let Some(info) = self.info(registration) {
            self.broadcast(registration, || Notice::Registration(info.clone()));
        }
    }

    pub(super) fn announce_update(&self, registration: Id) {
        self.broadcast(registration, || Notice::UpdateFound(registration));
    }

    /// <https://w3c.github.io/ServiceWorker/#update-registration-state-algorithm>
    pub(super) fn set_slot(&mut self, registration: Id, slot: usize, worker: Option<Id>) {
        if let Some(it) = self.registration(registration) {
            it.workers[slot] = worker;
        }
        self.announce(registration);
    }

    /// <https://w3c.github.io/ServiceWorker/#update-state-algorithm>
    pub(super) fn set_state(&mut self, worker: Id, state: State) {
        let Some(it) = self.workers.get_mut(&worker) else {
            return;
        };
        it.info.state = state;
        let registration = it.registration;
        self.broadcast(registration, || Notice::State(worker, state));
    }

    fn control(&self, registration: Id) -> Option<Control> {
        Some(Control {
            registration,
            worker: self.info(registration)?.workers[ACTIVE].take()?,
        })
    }
}

pub(super) fn form_of(is_module: bool) -> Form {
    match is_module {
        true => Form::Module,
        false => Form::Classic,
    }
}

pub(crate) struct Registry {
    pub(super) session: Arc<Session>,
    pub(super) contents: RefCell<Contents>,
}

pub(crate) fn send(session: &Arc<Session>, message: ToRegistry) {
    if is_page_process() {
        return;
    }
    let kept = Arc::clone(session);
    session
        .main()
        .post(move || Registry::of(&kept).receive(message));
}

/// False if there is no registration.
pub(crate) fn may_have_any(session: &Arc<Session>) -> bool {
    let has_any = || session.may_have_service_workers.load(Ordering::Relaxed);
    if has_any() && session.main().is_current() {
        Registry::of(session);
    }
    has_any()
}

pub(crate) fn clear(session: &Arc<Session>, origins: Origins) {
    let kept = Arc::clone(session);
    session.main().run(move || {
        let this = Registry::of(&kept);
        let next = || {
            let contents = this.contents.borrow();
            let mut all = contents.registrations.iter();
            Some(all.find(|it| origins.include(&it.bucket))?.id)
        };
        while let Some(id) = next() {
            let workers = this
                .contents
                .borrow_mut()
                .registration(id)
                .map(|it| it.workers);
            this.clear(id);
            workers
                .into_iter()
                .flatten()
                .flatten()
                .for_each(|it| this.stop(it));
        }
    });
}

/// <https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm>
pub(crate) async fn handle_fetch(
    session: &Arc<Session>,
    initiator: Initiator,
    request: Request,
    controller: Controller,
    is_for_network: bool,
) -> Handled {
    let kept = Arc::clone(session);
    let handling = session.main().call(move || {
        Registry::of(&kept).handle_fetch(initiator, request, controller, is_for_network)
    });
    handling.await.unwrap_or_default()
}

impl Registry {
    fn of(session: &Arc<Session>) -> Rc<Registry> {
        let is_it = |it: &&Rc<Registry>| Arc::ptr_eq(&it.session, session);
        if let Some(known) =
            OF_MAIN_THREAD.with(|it| it.registries.borrow().iter().find(is_it).cloned())
        {
            return known;
        }
        let this = Rc::new(Registry {
            session: Arc::clone(session),
            contents: stored::read(session).unwrap_or_default().into(),
        });
        OF_MAIN_THREAD.with(|it| it.registries.borrow_mut().push(Rc::clone(&this)));
        this.count();
        this.watch_cookies();
        this
    }

    fn watch_cookies(&self) {
        let contents = self.contents.borrow();
        let is_wanted = (contents.registrations.iter()).any(|it| !it.subscriptions.is_empty());
        let session = Arc::downgrade(&self.session);
        let tell = move |change: &Change, by: Option<ClientId>| {
            if let Some(session) = session.upgrade().filter(|_| change.is_news()) {
                let is_by_worker = change.is_loss()
                    || (by.and_then(Client::find)).is_some_and(|it| it.is_service_worker());
                let change = change.clone().into();
                send(&session, ToRegistry::CookieChanged(change, is_by_worker));
            }
        };
        (self.session).watch_cookies(0, is_wanted.then(|| Box::new(tell) as _));
    }

    pub(super) fn report(&self, news: News) {
        let session = Arc::clone(&self.session);
        (self.session.main()).post(move || session.notify(|it| it.service_workers_report(news)));
    }

    fn report_status(&self, id: Id, status: RunningStatus) -> Option<()> {
        let mut contents = self.contents.borrow_mut();
        let found = contents.workers.get(&id)?;
        let (worker, registration) = (found.info.clone(), found.registration);
        let process = found.run.as_ref().and_then(|it| it.process);
        let scope = (contents.registration(registration)).map(|it| it.scope.clone());
        self.report(News::Status {
            scope: scope.unwrap_or_else(|| worker.url.clone()),
            worker,
            status,
            process,
        });
        Some(())
    }

    fn cookie_changed(self: &Rc<Self>, change: &Change, is_by_worker: bool) {
        let cares = |it: &&Registration| {
            let context = |url| cookies::Context {
                is_same_site: it.ancestors.is_empty(),
                is_top_level_navigation: false,
                has_safe_method: true,
                is_for_script: true,
                top_level_site: (it.ancestors.last())
                    .map_or_else(|| Site::of(url), Site::of_origin),
            };
            !it.is_unregistered
                && it.subscriptions.iter().any(|Subscription { name, url }| {
                    name.as_ref().is_none_or(|it| *it == change.cookie.name)
                        && change.cookie.is_visible_at(url, &context(url))
                })
        };
        let workers = (self.contents.borrow().registrations.iter())
            .filter(cares)
            .filter_map(|it| Some((it.workers[ACTIVE]?, it.bucket.clone())))
            .collect::<Vec<_>>();
        for (worker, _) in (workers.iter()).filter(|it| !is_by_worker || self.are_needed(&it.1)) {
            exec::spawn(self.dispatch(*worker, Event::CookieChange(change.clone())));
        }
    }

    /// If not, they cannot give each other more to do.
    fn are_needed(&self, bucket: &[u8]) -> bool {
        let at = self.contents.borrow().needed_at.get(bucket).copied();
        at.is_some_and(|it| monotonic_now() - it < LONGEST_EVENT)
            || (Client::windows_of(&self.session).iter()).any(|it| *it.bucket == *bucket)
    }

    fn notified(self: &Rc<Self>, id: Id, is_click: bool) -> Option<()> {
        let mut contents = self.contents.borrow_mut();
        let at = contents.notifications.iter().position(|it| it.1.id == id)?;
        let (registration, about) = match is_click {
            true => contents.notifications[at].clone(),
            false => contents.notifications.remove(at),
        };
        let found = contents.registration(registration)?;
        let (worker, bucket) = (found.workers[ACTIVE]?, found.bucket.clone());
        if is_click {
            contents.workers.get_mut(&worker)?.clicked_at = monotonic_now();
            contents.note_need(&bucket);
        } else if !about.tells_of_closing {
            return None;
        }
        drop(contents);
        let about = about.into();
        exec::spawn(self.dispatch(worker, Event::Notification { about, is_click }));
        Some(())
    }

    fn close_notifications(&self, is_meant: impl Fn(&(Id, Notification)) -> bool) {
        let mut contents = self.contents.borrow_mut();
        for (_, it) in contents.notifications.extract_if(.., |it| is_meant(it)) {
            self.report(News::CloseNotification(it.id));
        }
    }

    pub(super) fn count(&self) {
        let has_any = !self.contents.borrow().registrations.is_empty();
        (self.session.may_have_service_workers).store(has_any, Ordering::Relaxed);
    }

    /// Before anything is stored.
    pub(super) fn sweep(&self) {
        let mut contents = self.contents.borrow_mut();
        if !core::mem::replace(&mut contents.has_swept, true) {
            sort_slice_by_key(&mut contents.rows, |it| *it);
            (self.session.storage).delete_scripts_but(contents.rows.clone());
        }
    }

    pub(super) fn save(&self) {
        self.sweep();
        stored::write(&self.session, &mut self.contents.borrow_mut());
    }

    fn receive(self: Rc<Self>, message: ToRegistry) {
        match message {
            ToRegistry::Call(caller, ticket, call) => {
                self.contents.borrow_mut().agent = caller.agent.of_service_worker();
                let address = caller.address.clone();
                if let Some(outcome) = self.perform(caller, ticket, call) {
                    address.tell(Notice::Settled(ticket, outcome));
                }
            }
            ToRegistry::Hello {
                caller,
                uses,
                listens,
            } => self.greet(caller, uses, listens),
            ToRegistry::Expect(id, bucket, uses) => {
                (self.contents.borrow_mut().known).insert(id, Known::expected(bucket, uses));
            }
            ToRegistry::Gone(id) => {
                let mut contents = self.contents.borrow_mut();
                contents.awaiting_ready.retain(|it| it.0.info.id != id);
                let Some(known) = contents.known.remove(&id) else {
                    return;
                };
                drop(contents);
                for (address, ticket) in known.awaited {
                    address.tell(Notice::Settled(ticket, Outcome::Client(None)));
                }
                known.uses.into_iter().for_each(|it| self.go_on(it));
            }
            ToRegistry::Idle(id) => {
                let mut contents = self.contents.borrow_mut();
                let Some(worker) = contents.workers.get_mut(&id) else {
                    return;
                };
                worker.pending -= 1;
                worker.idle_since = monotonic_now();
                let (is_idle, registration) = (worker.pending == 0, worker.registration);
                drop(contents);
                if is_idle {
                    self.forget_if_redundant(id);
                    self.go_on(registration);
                }
            }
            ToRegistry::CookieChanged(change, by) => self.cookie_changed(&change, by),
            ToRegistry::Preloaded(id, record) => {
                let started = self.run(id);
                exec::spawn(async move {
                    if let Some(Address { thread, client }) = async { started?.await }.await {
                        thread.post(move || {
                            if let Some(client) = Client::find(client) {
                                client.record_timing(*record);
                            }
                        });
                    }
                });
            }
            ToRegistry::Notified { id, is_click } => _ = self.notified(id, is_click),
        }
    }

    fn greet(self: &Rc<Self>, caller: Box<Caller>, uses: Option<Id>, listens: bool) {
        let info = current(&caller);
        let mut contents = self.contents.borrow_mut();
        let own = caller.worker.and_then(|it| contents.workers.get(&it));
        let has_ended = match caller.info.kind {
            ClientKind::Window => false,
            ClientKind::ServiceWorker => own.is_none_or(|it| it.run.is_none()),
            _ => !contents.known.contains_key(&caller.info.id),
        };
        if has_ended {
            return;
        }
        if let Some(own) = own.and_then(|it| contents.info(it.registration)) {
            caller.address.tell(Notice::Registration(own));
        }
        let expected = Known::expected(caller.bucket.clone(), uses);
        let known = Known {
            listens,
            caller: Some(caller),
            ..expected
        };
        let Some(before) = contents.known.insert(info.id, known) else {
            return;
        };
        drop(contents);
        for (address, ticket) in before.awaited {
            address.tell(Notice::Settled(ticket, Outcome::Client(Some(info.clone()))));
        }
        if let Some(released) = before.uses.filter(|it| uses != Some(*it)) {
            self.go_on(released);
        }
    }

    /// In the order in which they were made.
    fn clients(&self, bucket: &[u8]) -> Vec<Caller> {
        let contents = self.contents.borrow();
        let workers = (contents.known.values())
            .filter_map(|it| it.caller.as_deref())
            .filter(|it| matches!(it.info.kind, ClientKind::Worker | ClientKind::SharedWorker));
        let mut all = Client::windows_of(&self.session);
        all.extend(workers.cloned());
        all.retain(|it| *it.bucket == *bucket);
        sort_slice_by_key(&mut all, |it| it.address.client.0);
        all
    }

    fn client(&self, bucket: &[u8], id: Id) -> Option<Caller> {
        self.clients(bucket).into_iter().find(|it| it.info.id == id)
    }

    /// `None` if the caller is told later, or never.
    #[optimize(size)]
    fn perform(self: &Rc<Self>, caller: Box<Caller>, ticket: u32, call: Call) -> Option<Outcome> {
        let bucket = caller.bucket.clone();
        if caller.worker.is_none() {
            self.contents.borrow_mut().note_need(&bucket);
        }
        let own = || {
            let contents = self.contents.borrow();
            let worker = contents.workers.get(&caller.worker?)?;
            Some((worker.info.clone(), worker.registration))
        };
        let is_for_caller = |registration: Id| {
            let mut contents = self.contents.borrow_mut();
            contents
                .registration(registration)
                .is_some_and(|it| it.bucket == bucket)
        };
        Some(match call {
            Call::Register { .. } | Call::Update(_) if !self.are_needed(&bucket) => {
                Outcome::Failed(
                    Failure::Abort,
                    "Nothing has needed the worker for too long.",
                )
            }
            Call::Register {
                scope,
                script,
                is_module,
                update_via_cache,
            } => {
                self.schedule(Job::Register {
                    caller,
                    ticket,
                    scope,
                    script,
                    is_module,
                    update_via_cache,
                });
                return None;
            }
            Call::Update(id) if is_for_caller(id) => {
                let referrer = caller.referrer.filter(|_| caller.worker.is_none());
                return self.update(id, Some((caller.address, ticket)), referrer);
            }
            Call::Update(_) => {
                Outcome::Failed(Failure::InvalidState, "There is nothing to update.")
            }
            Call::Unregister(id) if is_for_caller(id) => {
                self.schedule(Job::Unregister(id, caller.address, ticket));
                return None;
            }
            Call::Unregister(_) => Outcome::Unregistered(false),
            Call::GetRegistration(url) => {
                let contents = self.contents.borrow();
                Outcome::Registration(
                    contents
                        .matching(&bucket, &url)
                        .map(|it| contents.describe(it).into()),
                )
            }
            Call::GetRegistrations => {
                let contents = self.contents.borrow();
                let all = contents.of_bucket(&bucket).map(|it| contents.describe(it));
                Outcome::Registrations(all.collect())
            }
            Call::Ready => {
                let mut contents = self.contents.borrow_mut();
                let all = contents.awaiting_ready.iter();
                if all.filter(|it| it.0.info.id == caller.info.id).count() < MOST_WORLDS {
                    contents.awaiting_ready.push((caller, ticket));
                }
                drop(contents);
                self.tell_who_is_ready();
                return None;
            }
            Call::PostToWorker(id, message) => {
                let registration = self.contents.borrow().workers.get(&id)?.registration;
                let needed_at = |it| Some(self.contents.borrow().workers.get(&it)?.needed_at);
                let (source, since) = match own() {
                    Some((own, _)) => (Source::Worker(own.clone()), needed_at(own.id)?),
                    None => (Source::Client(current(&caller)), monotonic_now()),
                };
                if is_for_caller(registration) && monotonic_now() - since < LONGEST_EVENT {
                    let event = Event::Message(source, message);
                    let (dispatch, weight) = (self.dispatch_since(since, id, event), caller.weight);
                    exec::spawn(async move {
                        dispatch.await;
                        drop(weight);
                    });
                }
                return None;
            }
            Call::Preload(id, is_enabled, value) => {
                let changes = is_enabled.is_some() || value.is_some();
                let mut contents = self.contents.borrow_mut();
                if (value.as_ref()).is_some_and(|it| !contents.has_room(&bucket, it.len())) {
                    return Some(Outcome::Failed(Failure::Quota, NO_ROOM));
                }
                let found = contents.registration(id).filter(|it| it.bucket == bucket);
                let Some(it) = found.filter(|it| !changes || it.workers[ACTIVE].is_some()) else {
                    return Some(Outcome::Failed(
                        Failure::InvalidState,
                        "There is no active worker.",
                    ));
                };
                if !changes {
                    return Some(Outcome::Preload(it.preload.0, it.preload.1.clone()));
                }
                it.preload.0 = is_enabled.unwrap_or(it.preload.0);
                it.preload.1 = value.unwrap_or_else(|| it.preload.1.clone());
                drop(contents);
                self.save();
                Outcome::Done
            }
            Call::SkipWaiting => {
                let (worker, registration) = own()?;
                self.contents
                    .borrow_mut()
                    .workers
                    .get_mut(&worker.id)?
                    .skips_waiting = true;
                self.go_on(registration);
                Outcome::Done
            }
            Call::AddRoutes(rules) => {
                let (mut contents, mut written) = (self.contents.borrow_mut(), Default::default());
                stored::write_routes(&rules, &mut written);
                let has_room = contents.has_room(&bucket, written.0.len());
                let worker = contents.workers.get_mut(&caller.worker?)?;
                let all = worker.routes.iter().chain(&rules);
                if worker.info.state != State::Installing {
                    Outcome::Failed(Failure::InvalidState, "The worker is not being installed.")
                } else if all.map(|it| it.condition.count()).sum::<usize>() > MOST_CONDITIONS {
                    Outcome::Failed(Failure::Type, "There are too many conditions.")
                } else if !has_room {
                    Outcome::Failed(Failure::Quota, NO_ROOM)
                } else {
                    worker.size_of_routes += written.0.len();
                    worker.routes.extend(rules);
                    Outcome::Done
                }
            }
            Call::Claim => self.claim(&bucket, own()?),
            Call::GetClient(id) => {
                let mut contents = self.contents.borrow_mut();
                let known = contents.known.get_mut(&id);
                let is_awaited = |it: &&mut Known| {
                    it.caller.is_none() && it.bucket == bucket && it.awaited.len() < MOST_AWAITING
                };
                if let Some(it) = known.filter(is_awaited) {
                    it.awaited.push((caller.address, ticket));
                    return None;
                }
                drop(contents);
                Outcome::Client(self.client(&bucket, id).map(|it| it.info))
            }
            Call::MatchAll {
                includes_uncontrolled,
                kind,
            } => {
                let ((worker, registration), mut all) = (own()?, self.clients(&bucket));
                let contents = self.contents.borrow();
                let is_active = matches!(worker.state, State::Activating | State::Activated);
                all.retain(|it| {
                    let uses = || contents.known.get(&it.info.id)?.uses;
                    kind.is_none_or(|kind| kind == it.info.kind)
                        && (includes_uncontrolled || (is_active && uses() == Some(registration)))
                });
                sort_slice_by_key(&mut all, |it| {
                    it.info.window.map_or(2, |it| u8::from(!it.is_focused))
                });
                Outcome::Clients(all.into_iter().map(|it| it.info).collect())
            }
            Call::PostToClient(id, message) => {
                let notice = Notice::Message(own()?.0, message);
                self.client(&bucket, id)?.address.tell(notice);
                return None;
            }
            Call::Focus(id) => {
                let since_click = |it: &mut Worker| {
                    monotonic_now() - core::mem::replace(&mut it.clicked_at, f64::NEG_INFINITY)
                };
                let mut contents = self.contents.borrow_mut();
                if since_click(contents.workers.get_mut(&caller.worker?)?) > CLICK_LASTS {
                    let message = "This needs a click on a notification.";
                    return Some(Outcome::Failed(Failure::InvalidAccess, message));
                }
                drop(contents);
                let window = self.client(&bucket, id);
                if let Some(window) = window.and_then(|it| Client::find(it.address.client)) {
                    window.focus();
                }
                match self.client(&bucket, id) {
                    Some(it) => Outcome::Client(Some(it.info)),
                    None => Outcome::Failed(Failure::Type, "The client is gone."),
                }
            }
            Call::Unsubscribe(id, _) if self.contents.borrow_mut().registration(id).is_none() => {
                Outcome::Done
            }
            Call::Subscribe(id, _)
            | Call::Unsubscribe(id, _)
            | Call::GetSubscriptions(id)
            | Call::ShowNotification(id, _)
                if !is_for_caller(id) || self.contents.borrow().control(id).is_none() =>
            {
                Outcome::Failed(Failure::Type, "There is no active worker.")
            }
            Call::Subscribe(id, given) => self.change_subscriptions(id, given, true)?,
            Call::Unsubscribe(id, given) => self.change_subscriptions(id, given, false)?,
            Call::GetSubscriptions(id) => {
                let mut contents = self.contents.borrow_mut();
                Outcome::Subscriptions(contents.registration(id)?.subscriptions.clone())
            }
            Call::ShowNotification(registration, mut shown) => {
                shown.tells_of_closing = self.are_needed(&bucket);
                let (this, address) = (Rc::clone(self), caller.address);
                let worker = self.contents.borrow().control(registration)?.worker;
                let outside = Outside::new(&self.session, worker);
                exec::spawn(async move {
                    if !outside.may_notify().await {
                        let failure = Outcome::Failed(Failure::Type, "There is no permission.");
                        return address.tell(Notice::Settled(ticket, failure));
                    }
                    this.close_notifications(|it| {
                        it.0 == registration && !shown.tag.is_empty() && it.1.tag == shown.tag
                    });
                    let oldest = (this.contents.borrow().notifications.iter().rev())
                        .filter(|it| it.0 == registration)
                        .nth(MOST_NOTIFICATIONS - 1)
                        .map(|it| it.1.id);
                    this.close_notifications(|it| Some(it.1.id) == oldest);
                    shown.id = ClientId::next().0;
                    this.report(News::ShowNotification(shown.clone()));
                    (this.contents.borrow_mut().notifications).push((registration, *shown));
                    address.tell(Notice::Settled(ticket, Outcome::Done));
                });
                return None;
            }
            Call::GetNotifications(id, tag) => {
                let is_allowed = is_for_caller(id);
                let contents = self.contents.borrow();
                let found = (contents.notifications.iter())
                    .filter(|it| is_allowed && it.0 == id && (tag.is_empty() || it.1.tag == tag));
                Outcome::Notifications(found.map(|it| it.1.clone()).collect())
            }
            Call::CloseNotification(id) => {
                let find = |it: &(Id, Notification)| (it.1.id == id).then_some(it.0);
                let registration = self.contents.borrow().notifications.iter().find_map(find)?;
                if is_for_caller(registration) {
                    self.close_notifications(|it| it.1.id == id);
                }
                return None;
            }
            Call::Navigate(id, url) => {
                let (worker, registration) = own()?;
                let uses = self.contents.borrow().known.get(&id).and_then(|it| it.uses);
                let controls = worker.state != State::Redundant
                    && (self.contents.borrow().control(registration))
                        .is_some_and(|it| it.worker.id == worker.id && uses == Some(registration));
                let window = self.client(&bucket, id).filter(|_| controls);
                let client = window.and_then(|it| Client::find(it.address.client));
                let Some(navigating) = client.and_then(|it| it.navigate(url)) else {
                    return Some(Outcome::Failed(
                        Failure::Type,
                        "The worker does not control the client.",
                    ));
                };
                let this = Rc::clone(self);
                exec::spawn(async move {
                    let outcome = match navigating.await.flatten() {
                        Some(next) => {
                            let mut all = this.clients(&bucket).into_iter();
                            Outcome::Navigated(
                                all.find(|it| it.address.client == next).map(|it| it.info),
                            )
                        }
                        None => Outcome::Failed(Failure::Type, "The navigation failed."),
                    };
                    caller.address.tell(Notice::Settled(ticket, outcome));
                });
                return None;
            }
        })
    }

    fn change_subscriptions(
        &self,
        id: Id,
        given: Vec<Subscription>,
        adds: bool,
    ) -> Option<Outcome> {
        let mut contents = self.contents.borrow_mut();
        let Some(it) = contents.registration(id) else {
            return (!adds).then_some(Outcome::Done);
        };
        if !(given.iter()).all(|given| given.url.href().starts_with(it.scope.href())) {
            return Some(Outcome::Failed(
                Failure::Type,
                "The URL is not in the scope.",
            ));
        }
        let (mut all, mut more) = (it.subscriptions.clone(), 0);
        for given in given {
            if !adds {
                all.retain(|it| *it != given);
            } else if !all.contains(&given) {
                if all.len() == MOST_SUBSCRIPTIONS {
                    return Some(Outcome::Failed(Failure::Quota, NO_ROOM));
                }
                more += given.size();
                all.push(given);
            }
        }
        let bucket = it.bucket.clone();
        if adds && !contents.has_room(&bucket, more) {
            return Some(Outcome::Failed(Failure::Quota, NO_ROOM));
        }
        contents.registration(id)?.subscriptions = all;
        drop(contents);
        self.watch_cookies();
        self.save();
        Some(Outcome::Done)
    }

    /// <https://w3c.github.io/ServiceWorker/#clients-claim>
    fn claim(self: &Rc<Self>, bucket: &[u8], (worker, registration): (WorkerInfo, Id)) -> Outcome {
        let control = self.contents.borrow().control(registration);
        let Some(control) = control.filter(|it| it.worker.id == worker.id) else {
            return Outcome::Failed(
                Failure::InvalidState,
                "Only the active worker can claim clients.",
            );
        };
        for client in self.clients(bucket) {
            let contents = self.contents.borrow();
            let known = contents.known.get(&client.info.id);
            let (uses, listens) = known.map_or((None, false), |it| (it.uses, it.listens));
            let matching = contents.matching(bucket, &client.home_url);
            if matching.is_some_and(|it| it.id == registration) && uses != Some(registration) {
                client
                    .address
                    .tell(Notice::Controller(Some(control.clone())));
                drop(contents);
                self.greet(client.into(), Some(registration), listens);
            }
        }
        Outcome::Done
    }

    fn tell_who_is_ready(&self) {
        let awaiting = core::mem::take(&mut self.contents.borrow_mut().awaiting_ready);
        let mut contents = self.contents.borrow_mut();
        for (caller, ticket) in awaiting {
            let uses = contents.known.get(&caller.info.id).and_then(|it| it.uses);
            let found = (uses.filter(|_| !is_allowed_at(&caller.info.url)))
                .or_else(|| Some(contents.matching(&caller.bucket, &caller.info.url)?.id))
                .and_then(|it| contents.info(it))
                .filter(|it| it.workers[ACTIVE].is_some());
            if found.is_some() {
                (caller.address).tell(Notice::Settled(
                    ticket,
                    Outcome::Registration(found.map(Box::new)),
                ));
            } else {
                contents.awaiting_ready.push((caller, ticket));
            }
        }
    }

    /// <https://w3c.github.io/ServiceWorker/#run-service-worker-algorithm>
    pub(super) fn run(self: &Rc<Self>, id: Id) -> Option<Shared<Option<Address>>> {
        self.run_since(monotonic_now(), id)
    }

    fn run_since(self: &Rc<Self>, since: f64, id: Id) -> Option<Shared<Option<Address>>> {
        let contents = self.contents.borrow();
        let worker = (contents.workers.get(&id)).filter(|it| it.info.state != State::Redundant)?;
        if let Some(run) = &worker.run {
            return Some(run.started.clone());
        }
        let (url, mut all) = (&worker.info.url, contents.registrations.iter());
        let bucket = &all.find(|it| it.id == worker.registration)?.bucket;
        let may_run = match worker.is_compiled {
            true => compiled::path_of(url.href(), form_of(worker.is_module)).is_some(),
            false => contents.agent.may_install(url, url, bucket),
        };
        if !may_run {
            return None;
        }
        let registration = worker.registration;
        drop(contents);
        let bucket = (self
            .contents
            .borrow_mut()
            .registration(registration)?
            .bucket)
            .clone();
        self.make_room_to_run(&bucket)?;
        self.report_status(id, RunningStatus::Starting);
        let (client, (go, noted)) = (ClientId::next(), oneshot());
        let (this, busy) = (Rc::clone(self), self.occupy(id, since));
        let started = Shared::spawn(async move {
            noted.await;
            let starting = async { this.start(id, client, this.scripts(id).await?)?.await };
            let Some((thread, handles_fetch)) = starting.await else {
                if this.is_running(id, client) {
                    this.stop(id);
                }
                return None;
            };
            drop(busy);
            this.report_status(id, RunningStatus::Running);
            let mut contents = this.contents.borrow_mut();
            let worker = contents.workers.get_mut(&id)?;
            if worker.info.state == State::Parsed {
                worker.handles_fetch = handles_fetch;
            }
            Some(Address { thread, client })
        });
        self.contents.borrow_mut().workers.get_mut(&id)?.run = Some(Run {
            bucket,
            client,
            started: started.clone(),
            thread: None,
            process: None,
        });
        go.send(());
        exec::spawn_background(Rc::clone(self).watch(id, client));
        Some(started)
    }

    fn is_running(&self, id: Id, run: ClientId) -> bool {
        let client = || {
            Some(
                self.contents
                    .borrow()
                    .workers
                    .get(&id)?
                    .run
                    .as_ref()?
                    .client,
            )
        };
        client() == Some(run)
    }

    fn make_room_to_run(&self, bucket: &[u8]) -> Option<()> {
        let contents = self.contents.borrow();
        let running = (contents.workers.values())
            .filter(|it| it.run.as_ref().is_some_and(|it| *it.bucket == *bucket));
        let running = Vec::from_iter(running);
        if running.len() >= MOST_RUNNING {
            let idle = (running.into_iter())
                .filter(|it| it.pending == 0 || it.info.state == State::Redundant);
            let longest = (idle
                .min_by(|a, b| a.idle_since.total_cmp(&b.idle_since))?
                .info)
                .id;
            drop(contents);
            self.stop(longest);
        }
        Some(())
    }

    /// A registration that has lost them is of no use.
    pub(super) async fn scripts(self: &Rc<Self>, id: Id) -> Option<Scripts> {
        let about = |it: &Worker| (it.scripts.clone(), it.row, it.registration);
        let (known, row, registration) = self.contents.borrow().workers.get(&id).map(about)?;
        if known.is_some() {
            return known;
        }
        let about = |it: &Worker| (it.info.url.clone(), it.is_compiled);
        let (url, is_compiled) = self.contents.borrow().workers.get(&id).map(about)?;
        self.sweep();
        let bucket = (self
            .contents
            .borrow_mut()
            .registration(registration)?
            .bucket)
            .clone();
        let parse = move |it: &[u8]| {
            let mut scripts = stored::read_scripts(&url, it)?;
            if is_compiled {
                (scripts.source, scripts.headers) = Default::default();
            }
            (is_compiled || scripts.source.is_some()).then_some(scripts)
        };
        let storage = Arc::clone(&self.session.storage);
        let read = storage.read_scripts(row?, bucket, parse).await.ok()?;
        let slots = (self.contents.borrow_mut().registration(registration)).map(|it| it.workers);
        if read.is_none() && slots.is_some_and(|it| it.contains(&Some(id))) {
            self.clear(registration);
        }
        read
    }

    fn start(
        self: &Rc<Self>,
        id: Id,
        client: ClientId,
        scripts: Scripts,
    ) -> Option<Receiver<(Thread, bool)>> {
        let about = |it: &Worker| (it.info.url.clone(), it.is_compiled, it.registration);
        let (url, is_compiled, own) = self.contents.borrow().workers.get(&id).map(about)?;
        let is_apart = (self.contents.borrow_mut().registration(own))
            .is_some_and(|it| if_for_page_processes(&it.bucket).is_some());
        let lodging = match is_apart {
            true => Some(self.session.lodge_worker(&url, is_compiled)?),
            false => None,
        };
        let mut contents = self.contents.borrow_mut();
        let is_this_run = |it: &&Worker| it.run.as_ref().is_some_and(|it| it.client == client);
        let worker = contents.workers.get(&id).filter(is_this_run)?;
        let registration =
            (contents.registrations.iter()).find(|it| it.id == worker.registration)?;
        let outside = Outside::new(&self.session, worker.info.clone());
        let own = Own {
            client,
            worker: worker.info.clone(),
            registration: contents.describe(registration),
            imports: Arc::clone(&scripts.imports),
        };
        let (agent, ancestors) = (contents.agent.clone(), registration.ancestors.clone());
        let seed = WorkerSeed::of_service(
            &self.session,
            agent,
            &scripts.headers,
            ancestors,
            own,
            worker.is_compiled,
        );
        let ((started, start), this) = (oneshot(), Rc::clone(self));
        let process = lodging.as_ref().map(|it| it.pid);
        let start_it = |it| match lodging {
            Some(lodging) => serve::workers::start(lodging, it),
            None => crate::dom::start_service_worker(it),
        };
        let thread = start_it(Start {
            seed,
            is_module: worker.is_module,
            source: scripts.source.clone(),
            started,
            ended: Box::new(move || this.stop(id)),
            outside,
        });
        let worker = contents.workers.get_mut(&id)?;
        worker.scripts = Some(scripts);
        let run = worker.run.as_mut()?;
        (run.thread, run.process) = (thread, process);
        Some(start)
    }

    fn stop(&self, id: Id) {
        let mut contents = self.contents.borrow_mut();
        let run = contents.workers.get_mut(&id).and_then(|it| {
            it.scripts.take_if(|_| it.row.is_some());
            it.run.take()
        });
        (contents.known).retain(|_, it| it.caller.as_ref().is_none_or(|it| it.worker != Some(id)));
        drop(contents);
        if run.is_some() {
            self.report_status(id, RunningStatus::Stopping);
            self.report_status(id, RunningStatus::Stopped);
        }
    }

    /// Until that run of the worker ends.
    async fn watch(self: Rc<Self>, id: Id, run: ClientId) {
        loop {
            exec::sleep(Duration::from_secs(5)).await;
            let mut contents = self.contents.borrow_mut();
            let is_same = |it: &&mut Worker| it.run.as_ref().is_some_and(|it| it.client == run);
            let Some(worker) = contents.workers.get_mut(&id).filter(is_same) else {
                return;
            };
            worker.events.retain(|it| it.1.strong_count() > 0);
            let now = monotonic_now();
            if (worker.pending == 0 && now - worker.idle_since >= LONGEST_IDLENESS)
                || (worker.events.iter()).any(|it| now - it.0 >= LONGEST_EVENT)
                || (worker.pending as usize <= worker.events.len()
                    && now - worker.needed_at >= LONGEST_EVENT)
            {
                drop(contents);
                return self.stop(id);
            }
        }
    }

    fn forget_if_redundant(self: &Rc<Self>, id: Id) {
        let is_over = move |this: &Registry| {
            (this.contents.borrow().workers.get(&id))
                .is_some_and(|it| it.pending == 0 && it.info.state == State::Redundant)
        };
        if is_over(self) {
            let this = Rc::clone(self);
            exec::spawn_background(async move {
                exec::sleep(Duration::from_secs(1)).await;
                if is_over(&this) {
                    this.stop(id);
                    this.contents.borrow_mut().workers.remove(&id);
                }
            });
        }
    }

    pub(super) fn discard(self: &Rc<Self>, worker: Id) {
        self.contents
            .borrow_mut()
            .set_state(worker, State::Redundant);
        self.forget_if_redundant(worker);
    }

    fn occupy(&self, id: Id, since: f64) -> Option<Busy> {
        let mut contents = self.contents.borrow_mut();
        let (worker, event) = (contents.workers.get_mut(&id)?, Arc::default());
        while worker
            .events
            .pop_front_if(|it| it.1.strong_count() == 0)
            .is_some()
        {}
        worker.events.push_back((since, Arc::downgrade(&event)));
        worker.needed_at = worker.needed_at.max(since);
        worker.pending += 1;
        Some(Busy {
            pending: Arc::new(Pending::Here(Arc::clone(&self.session), id)),
            _event: Some(event),
        })
    }

    fn dispatch(self: &Rc<Self>, id: Id, event: Event) -> impl Future<Output = ()> + use<> {
        self.dispatch_since(monotonic_now(), id, event)
    }

    fn dispatch_since(
        self: &Rc<Self>,
        since: f64,
        id: Id,
        event: Event,
    ) -> impl Future<Output = ()> + use<> {
        let (started, busy) = (self.run_since(since, id), self.occupy(id, since));
        async move {
            if let (Some(started), Some(busy)) = (started, busy)
                && let Some(address) = started.await
            {
                address.tell(Notice::Event(event, busy));
            }
        }
    }

    /// Once what is being loaded has had its turn.
    fn update_soon(self: &Rc<Self>, id: Id) {
        let set = move |this: &Registry, is_due| {
            let mut contents = this.contents.borrow_mut();
            Some(core::mem::replace(
                &mut contents.registration(id)?.is_update_due,
                is_due,
            ))
        };
        if set(self, true) == Some(false) {
            let this = Rc::clone(self);
            exec::spawn_background(async move {
                exec::sleep(Duration::from_secs(1)).await;
                set(&this, false);
                this.update(id, None, None);
            });
        }
    }

    pub(super) async fn pass_through(self: &Rc<Self>, id: Id, state: State) -> bool {
        let (sender, result) = oneshot();
        self.dispatch(id, Event::Lifecycle(state, sender)).await;
        result.await == Some(true)
    }

    /// <https://w3c.github.io/ServiceWorker/#try-clear-registration-algorithm>, <https://w3c.github.io/ServiceWorker/#try-activate-algorithm>
    pub(super) fn go_on(self: &Rc<Self>, id: Id) {
        let mut contents = self.contents.borrow_mut();
        let Some((workers, is_unregistered)) =
            (contents.registration(id)).map(|it| (it.workers, it.is_unregistered))
        else {
            return;
        };
        let is_used = contents.is_used(id);
        if is_unregistered && !is_used && workers.iter().all(|it| contents.is_idle(*it)) {
            drop(contents);
            return self.clear(id);
        }
        let of = |slot: usize| contents.workers.get(&workers[slot]?);
        let Some(waiting) = of(WAITING) else {
            return;
        };
        if of(ACTIVE).is_none_or(|it| {
            it.info.state != State::Activating
                && it.pending == 0
                && (!is_used || waiting.skips_waiting)
        }) {
            let waiting = waiting.info.id;
            drop(contents);
            self.activate(id, waiting, workers[ACTIVE]);
        }
    }

    /// <https://w3c.github.io/ServiceWorker/#clear-registration-algorithm>
    pub(super) fn clear(self: &Rc<Self>, id: Id) {
        let workers = (self.contents.borrow_mut().registration(id))
            .map(|it| core::mem::take(&mut it.workers));
        self.contents.borrow().announce(id);
        workers
            .into_iter()
            .flatten()
            .flatten()
            .for_each(|it| self.discard(it));
        let mut contents = self.contents.borrow_mut();
        for user in contents.known.values_mut().filter(|it| it.uses == Some(id)) {
            user.uses = None;
            (user.caller.iter()).for_each(|it| it.address.tell(Notice::Controller(None)));
        }
        let unborn = Vec::from_iter(
            (contents.workers.values())
                .filter(|it| it.registration == id && it.info.state == State::Parsed)
                .map(|it| it.info.id),
        );
        drop(contents);
        unborn.into_iter().for_each(|it| self.stop(it));
        self.close_notifications(|it| it.0 == id);
        self.contents
            .borrow_mut()
            .registrations
            .retain(|it| it.id != id);
        self.watch_cookies();
        self.count();
        self.save();
    }

    /// <https://w3c.github.io/ServiceWorker/#activation-algorithm>
    fn activate(self: &Rc<Self>, id: Id, worker: Id, replaced: Option<Id>) {
        replaced.into_iter().for_each(|it| self.discard(it));
        let mut contents = self.contents.borrow_mut();
        contents.set_slot(id, ACTIVE, Some(worker));
        contents.set_slot(id, WAITING, None);
        contents.set_state(worker, State::Activating);
        drop(contents);
        self.tell_who_is_ready();
        let contents = self.contents.borrow();
        let users = contents.known.values().filter(|it| it.uses == Some(id));
        for (user, control) in users.filter_map(|it| it.caller.as_ref().zip(contents.control(id))) {
            user.address.tell(Notice::Controller(Some(control)));
        }
        drop(contents);
        let this = Rc::clone(self);
        let activation = Shared::spawn(async move {
            this.pass_through(worker, State::Activating).await;
            let mut contents = this.contents.borrow_mut();
            if (contents.workers.get(&worker)).is_some_and(|it| it.info.state == State::Activating)
            {
                contents.set_state(worker, State::Activated);
            }
            drop(contents);
            this.save();
            this.go_on(id);
        });
        if let Some(it) = self.contents.borrow_mut().workers.get_mut(&worker) {
            it.activation = Some(activation);
        }
    }

    fn reserve(
        self: &Rc<Self>,
        agent: &Agent,
        bucket: Bytes,
        url: &Url,
        earlier: Option<&Arc<Presence>>,
    ) -> Option<Reserved> {
        let registration = (self.contents.borrow().matching(&bucket, url)).map(|it| it.id);
        if let Some(registration) = registration {
            self.contents.borrow_mut().agent = agent.of_service_worker();
            // What was waiting when the program ended.
            self.go_on(registration);
        }
        let mut contents = self.contents.borrow_mut();
        let control = registration.and_then(|it| contents.control(it));
        let uses = control.as_ref().map(|it| it.registration);
        let is_apart = if_for_page_processes(&bucket).is_some();
        let known = earlier.and_then(|it| Some((it, contents.known.get_mut(&it.id)?)));
        let Some((earlier, known)) = known.filter(|it| it.1.bucket == bucket) else {
            let id = uses.map(|_| ClientId::next().0)?;
            contents.known.insert(id, Known::expected(bucket, uses));
            let presence = Presence::new(&self.session, id);
            return Some(Reserved {
                presence,
                control,
                is_apart,
            });
        };
        let released = core::mem::replace(&mut known.uses, uses).filter(|it| uses != Some(*it));
        drop(contents);
        released.into_iter().for_each(|it| self.go_on(it));
        let presence = Arc::clone(earlier);
        Some(Reserved {
            presence,
            control,
            is_apart,
        })
    }

    /// Redirects are not followed.
    fn fetch_meanwhile(
        &self,
        mut initiator: Initiator,
        mut request: Request,
        observer: Box<dyn Observer>,
    ) -> Receiver<Result<Response>> {
        (request.redirect, initiator.service) = (Redirect::Manual, Handler::Nobody);
        let (session, (sender, response)) = (Arc::clone(&self.session), oneshot());
        exec::spawn(async move {
            let controller = Controller::default();
            let fetched =
                fetch::fetch(&session, &initiator, request, &*observer, &controller).await;
            sender.send(fetched.map_err(|it| it.error));
        });
        response
    }

    fn preload(
        &self,
        (registration, worker): (Id, Id),
        initiator: Initiator,
        request: &Request,
    ) -> Option<Receiver<Result<Response>>> {
        let (is_enabled, value) = self
            .contents
            .borrow_mut()
            .registration(registration)?
            .preload
            .clone();
        if !is_enabled || request.mode != Mode::Navigate || *request.method != *b"GET" {
            return None;
        }
        let mut request = request.without_body();
        (request.cors_exempt_headers).set(b"Service-Worker-Navigation-Preload", &value);
        let timed = Preloading(Arc::clone(&self.session), worker);
        Some(self.fetch_meanwhile(initiator, request, Box::new(timed)))
    }

    async fn look_up(
        &self,
        registration: Id,
        name: Option<Vec<u8>>,
        request: &Request,
    ) -> Option<Served> {
        let caches = Caches {
            storage: Arc::clone(&self.session.storage),
            bucket: self
                .contents
                .borrow_mut()
                .registration(registration)?
                .bucket
                .clone(),
        };
        let asked = (*request.method == *b"GET").then(|| CachedRequest {
            url: request.url.href().into(),
            method: request.method.clone(),
            headers: request.headers.clone(),
            navigation: 0,
        })?;
        let found = caches.first_response(name, asked, QueryOptions::default());
        let mut it = found.await.ok()?.filter(|it| *it.kind != *b"error")?;
        let kind = ResponseType::parse(&it.kind);
        if kind == Some(ResponseType::Cors) {
            it.headers.set(b"access-control-expose-headers", b"*");
        }
        let body = it.body.map(Into::into).unwrap_or_default();
        Some(Served {
            kind,
            url: Url::parse(&it.url),
            is_redirected: it.is_redirected,
            allows_timing: matches!(kind, None | Some(ResponseType::Basic)),
            includes_credentials: !it.omits_credentials,
            has_credentials_mode_include: false,
            kept_as: 0,
            answer: Answer::new(it.status, &it.status_text, it.headers, body),
        })
    }

    async fn fire_fetch_event(
        self: &Rc<Self>,
        worker: Id,
        intercepted: impl FnOnce(Sender<Option<Result<Served>>>) -> Intercepted,
    ) -> Option<Result<Served>> {
        let activation = self
            .contents
            .borrow()
            .workers
            .get(&worker)?
            .activation
            .clone();
        if let Some(activation) = activation {
            activation.await;
        }
        {
            let mut contents = self.contents.borrow_mut();
            let registration = contents.workers.get(&worker)?.registration;
            let bucket = contents.registration(registration)?.bucket.clone();
            contents.note_need(&bucket);
        }
        let ((answer, answered), started) = (oneshot(), self.run(worker));
        self.dispatch(worker, Event::Fetch(intercepted(answer).into()))
            .await;
        let has_started = async { started?.await }.await.is_some();
        (answered.await).unwrap_or(has_started.then_some(Err(NetError::Failed)))
    }

    #[optimize(size)]
    async fn handle_fetch(
        self: Rc<Self>,
        initiator: Initiator,
        request: Request,
        controller: Controller,
        is_for_network: bool,
    ) -> Handled {
        let mut reserved = None;
        let bucket_of = |origin: &Origin| {
            let bucket = bucket_of(origin, &initiator.ancestors);
            bucket_for(bucket, initiator.is_in_page_process)
        };
        let (control, client) = match &initiator.service {
            Handler::Nobody => (None, None),
            Handler::Registration { id, client } => {
                let mut contents = self.contents.borrow_mut();
                let bucket = initiator.origin.as_ref().map(bucket_of);
                let is_own = (contents.registration(*id).zip(bucket))
                    .is_some_and(|(it, bucket)| *it.bucket == *bucket);
                (contents.control(*id).filter(|_| is_own), Some(*client))
            }
            Handler::Matching {
                agent,
                client,
                reserved: earlier,
            } => {
                let bucket = bucket_of(&Origin::of(&request.url));
                reserved = self.reserve(agent, bucket, &request.url, earlier.as_ref());
                (reserved.as_ref().and_then(|it| it.control.clone()), *client)
            }
        };
        let Some(control) = control else {
            return Handled {
                reserved,
                ..Handled::default()
            };
        };
        let (registration, worker) = (control.registration, control.worker.id);
        let (mut routing, mut cache_name) = (Routing::default(), None);
        let handles_fetch = self
            .contents
            .borrow()
            .workers
            .get(&worker)
            .is_some_and(|it| {
                if !it.routes.is_empty() {
                    routing.evaluation_start = monotonic_now();
                }
                let (runs, mut steps) = (it.run.is_some(), MOST_STEPS_TO_ROUTE);
                let holds = |rule: &&Rule| rule.condition.holds(&request, runs, &mut steps);
                if let Some(rule) = it.routes.iter().find(holds).filter(|_| steps > 0) {
                    (routing.matched, cache_name) = (rule.route, rule.cache_name.clone());
                }
                it.handles_fetch
            });
        let mut served = None;
        if is_for_network || routing.matched == Route::Network {
        } else if routing.matched == Route::Cache {
            routing.cache_lookup_start = monotonic_now();
            served = self
                .look_up(registration, cache_name, &request)
                .await
                .map(Ok);
        } else if handles_fetch {
            routing.worker_start = monotonic_now();
            let (mut rival, mut preload) = (None, None);
            if routing.matched == Route::Race && *request.method == *b"GET" {
                rival = Some(self.fetch_meanwhile(initiator, request.without_body(), Box::new(())));
            } else {
                preload = self.preload((registration, worker), initiator, &request);
            }
            let resulting_client = reserved.as_ref().map(|it| it.presence.id);
            let (this, (sender, mut handled)) = (Rc::clone(&self), oneshot());
            exec::spawn(async move {
                let firing = this.fire_fetch_event(worker, |answer| Intercepted {
                    request,
                    client,
                    resulting_client,
                    preload,
                    controller,
                    answer,
                });
                sender.send(firing.await);
            });
            served = if let Some(mut rival) = rival {
                let good = |it: Option<Result<Response>>| {
                    it?.ok()
                        .filter(|it| is_ok_status(it.head.status))
                        .map(|it| Ok(it.into()))
                };
                let (of_network, of_worker) = match exec::race(&mut rival, &mut handled).await {
                    Either::First(it) => match good(it) {
                        None => (None, handled.await.flatten()),
                        it => (it, None),
                    },
                    Either::Second(it) => match it.flatten() {
                        None => (good(rival.await), None),
                        it => (None, it),
                    },
                };
                routing.taken = if of_worker.is_some() {
                    Route::FetchEvent
                } else {
                    Route::Network
                };
                of_worker.or(of_network)
            } else {
                handled.await.flatten()
            };
        }
        routing.taken = match routing.matched {
            Route::Race if routing.taken != Route::None => routing.taken,
            Route::Race => Route::FetchEvent,
            Route::Cache if served.is_none() => Route::Network,
            it => it,
        };
        let is_stale =
            (self.contents.borrow_mut().registration(registration)).is_some_and(|it| it.is_stale());
        if reserved.is_some() || is_stale {
            self.update_soon(registration);
        }
        if let Some(reserved) = &mut reserved {
            reserved.control = self.contents.borrow().control(registration);
        }
        Handled {
            reserved,
            served,
            routing,
        }
    }
}

struct Preloading(Arc<Session>, Id);

impl Observer for Preloading {
    fn end_of_body(&self) -> Option<EndOfBody> {
        let (session, worker) = (Arc::clone(&self.0), self.1);
        Some(Box::new(move |head, size| {
            let Ok(size) = size else { return };
            let kind = InitiatorType::Navigation;
            let record = ResourceTiming::of_response(head.url.href(), kind, head, size);
            send(&session, ToRegistry::Preloaded(worker, record.into()));
        }))
    }
}

impl From<Response> for Served {
    fn from(Response { head, body }: Response) -> Served {
        let body = body.unwrap_or_default();
        Served {
            kind: Some(head.kind),
            url: Url::parse(head.url.without_fragment()),
            is_redirected: false,
            allows_timing: head.allows_timing,
            includes_credentials: head.includes_credentials,
            has_credentials_mode_include: head.has_credentials_mode_include,
            kept_as: 0,
            answer: Answer {
                cached: head.cached,
                protocol: head.protocol,
                ..Answer::new(head.status, &head.status_text, head.headers, body)
            },
        }
    }
}

/// With what its window is like now.
fn current(caller: &Caller) -> ClientInfo {
    let window = Client::find(caller.address.client).filter(|_| caller.address.thread.is_current());
    ClientInfo {
        window: window.and_then(|it| it.window_state()),
        ..caller.info.clone()
    }
}
