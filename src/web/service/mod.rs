//! <https://w3c.github.io/ServiceWorker/>. The registrations of a session are on the main thread. A realm makes a [`Call`] and gets a [`Notice`].

mod jobs;
mod registry;
pub mod router;
mod stored;

use core::any::Any;
use std::sync::Arc;

use bun_threading::Guarded;

pub(crate) use self::registry::{Registry, clear, handle_fetch, may_have_any, send};
use self::router::{Route, Rule};
use crate::Bytes;
use crate::channel::{Message, Serialized};
use crate::client::{Agent, Client, Loaded, WorkerSeed};
use crate::exec::{Receiver, Sender, Thread};
use crate::host::Level;
use crate::net::Result;
use crate::net::body::SharedBytes;
use crate::net::cookies::Change;
use crate::net::embedder::ClientId;
use crate::net::fetch::Controller;
use crate::net::response::{Answer, Response, ResponseType};
use crate::net::session::Session;
use crate::origin::{Origin, is_potentially_trustworthy};
use crate::referrer::ReferrerPolicy;
use crate::request::Request;
use crate::scheme::{Privileges, privileges_of};
use crate::timing::ResourceTiming;
use crate::url::Url;

pub type Id = u32;

keywords! {
    pub enum State {
        Parsed = b"parsed",
        Installing = b"installing",
        Installed = b"installed",
        Activating = b"activating",
        Activated = b"activated",
        Redundant = b"redundant",
    }
}

keywords! {
    pub enum UpdateViaCache {
        Imports = b"imports",
        All = b"all",
        None = b"none",
    }
}

keywords! {
    pub enum ClientKind {
        Window = b"window",
        Worker = b"worker",
        SharedWorker = b"sharedworker",
        ServiceWorker = b"serviceworker",
    }
}

keywords! {
    pub enum FrameType {
        Auxiliary = b"auxiliary",
        TopLevel = b"top-level",
        Nested = b"nested",
        None = b"none",
    }
}

#[derive(Clone)]
pub struct WorkerInfo {
    pub id: Id,
    pub url: Url,
    pub state: State,
}

pub const INSTALLING: usize = 0;
pub const WAITING: usize = 1;
pub const ACTIVE: usize = 2;

#[derive(Clone)]
pub struct RegistrationInfo {
    pub id: Id,
    pub scope: Url,
    pub update_via_cache: UpdateViaCache,
    pub workers: [Option<WorkerInfo>; 3],
}

#[derive(Clone, Copy)]
pub struct WindowState {
    pub frame_type: FrameType,
    pub is_visible: bool,
    pub is_focused: bool,
}

#[derive(Clone)]
pub struct ClientInfo {
    pub id: Id,
    pub kind: ClientKind,
    pub url: Url,
    pub ancestors: Vec<Origin>,
    pub window: Option<WindowState>,
}

pub enum Call {
    Register {
        scope: Url,
        script: Url,
        is_module: bool,
        update_via_cache: UpdateViaCache,
    },
    Update(Id),
    Unregister(Id),
    GetRegistration(Url),
    GetRegistrations,
    Ready,
    PostToWorker(Id, Message),
    Preload(Id, Option<bool>, Option<Bytes>),
    SkipWaiting,
    AddRoutes(Vec<Rule>),
    Claim,
    GetClient(Id),
    MatchAll {
        includes_uncontrolled: bool,
        kind: Option<ClientKind>,
    },
    PostToClient(Id, Message),
    Navigate(Id, Url),
    Focus(Id),
    Subscribe(Id, Vec<Subscription>),
    Unsubscribe(Id, Vec<Subscription>),
    GetSubscriptions(Id),
    ShowNotification(Id, Box<Notification>),
    GetNotifications(Id, String),
    CloseNotification(Id),
}

/// <https://cookiestore.spec.whatwg.org/#cookie-change-subscription>
#[derive(Clone, PartialEq, Eq)]
pub struct Subscription {
    pub name: Option<Bytes>,
    pub url: Url,
}

impl Subscription {
    fn size(&self) -> usize {
        self.name.as_ref().map_or(0, |it| it.len()) + self.url.href().len()
    }
}

/// <https://notifications.spec.whatwg.org/#persistent-notification>
#[derive(Clone)]
pub struct Notification {
    pub id: Id,
    pub title: String,
    pub body: String,
    pub tag: String,
    pub lang: String,
    /// The image, the icon, the badge, and where to navigate to.
    pub urls: [String; 4],
    pub timestamp: f64,
    pub direction: u8,
    pub renotifies: bool,
    pub is_silent: Option<bool>,
    pub requires_interaction: bool,
    pub tells_of_closing: bool,
    /// The data, the actions and the vibration pattern.
    pub values: [Serialized; 3],
}

keywords! {
    pub enum RunningStatus {
        Starting = b"starting",
        Running = b"running",
        Stopping = b"stopping",
        Stopped = b"stopped",
    }
}

/// For the app.
pub enum News {
    Registered(Url),
    Status {
        worker: WorkerInfo,
        scope: Url,
        status: RunningStatus,
    },
    Console {
        worker: Id,
        level: Level,
        message: String,
        line: u32,
        url: String,
    },
    ShowNotification(Box<Notification>),
    CloseNotification(Id),
}

pub enum Failure {
    Type,
    Security,
    InvalidState,
    InvalidAccess,
    Abort,
    Quota,
}

pub enum Outcome {
    Done,
    Failed(Failure, &'static str),
    Registration(Option<Box<RegistrationInfo>>),
    Registrations(Vec<RegistrationInfo>),
    Unregistered(bool),
    Preload(bool, Bytes),
    Client(Option<ClientInfo>),
    Navigated(Option<ClientInfo>),
    Clients(Vec<ClientInfo>),
    Subscriptions(Vec<Subscription>),
    Notifications(Vec<Notification>),
}

pub enum Source {
    Client(ClientInfo),
    Worker(WorkerInfo),
}

/// For a service worker.
pub enum Event {
    /// Whether it went well.
    Lifecycle(State, Sender<bool>),
    Fetch(Box<Intercepted>),
    Message(Source, Message),
    CookieChange(Change),
    Notification {
        about: Box<Notification>,
        is_click: bool,
    },
}

pub enum Notice {
    Settled(u32, Outcome),
    Registration(RegistrationInfo),
    UpdateFound(Id),
    State(Id, State),
    Controller(Option<Control>),
    Message(WorkerInfo, Message),
    Event(Event, Busy),
}

pub struct Intercepted {
    pub request: Request,
    pub client: Option<Id>,
    pub resulting_client: Option<Id>,
    pub preload: Option<Receiver<Result<Response>>>,
    /// It is aborted with the request.
    pub controller: Controller,
    /// `None` leaves it to the network.
    pub answer: Sender<Option<Result<Served>>>,
}

/// What a service worker has answered.
pub struct Served {
    /// `None` if it is made up.
    pub kind: Option<ResponseType>,
    pub url: Option<Url>,
    pub is_redirected: bool,
    pub allows_timing: bool,
    pub includes_credentials: bool,
    pub has_credentials_mode_include: bool,
    pub answer: Answer,
}

/// What has become of a request.
#[derive(Default)]
pub(crate) struct Handled {
    pub(crate) reserved: Option<Reserved>,
    /// `None` leaves it to the network.
    pub(crate) served: Option<Result<Served>>,
    pub(crate) routing: Routing,
}

crate::wire! {
    /// The times are 0 for what has not happened.
    #[derive(Clone, Copy, Default)]
    pub struct Routing {
        pub evaluation_start: f64,
        pub cache_lookup_start: f64,
        pub worker_start: f64,
        pub matched: Route,
        pub taken: Route,
    }
}

crate::wire!(impl never Handler, Reserved);

/// What may handle the requests of a client.
#[derive(Clone, Default)]
pub enum Handler {
    #[default]
    Nobody,
    Registration {
        id: Id,
        client: Id,
    },
    /// The request makes a client.
    Matching {
        agent: Agent,
        client: Option<Id>,
        /// Before a redirect.
        reserved: Option<Arc<Presence>>,
    },
}

/// The worker is not terminated meanwhile.
#[derive(Clone)]
pub struct Busy {
    pending: Arc<Pending>,
    /// That has a time limit.
    _event: Option<Arc<()>>,
}

impl Busy {
    pub fn without_limit(self) -> Busy {
        Busy {
            pending: self.pending,
            _event: None,
        }
    }
}

struct Pending(Arc<Session>, Id);

impl Drop for Pending {
    fn drop(&mut self) {
        send(&self.0, ToRegistry::Idle(self.1));
    }
}

/// The registry knows a client for as long as this is there.
pub struct Presence {
    session: Arc<Session>,
    pub(crate) id: Id,
}

impl Presence {
    pub(crate) fn new(session: &Arc<Session>, id: Id) -> Arc<Presence> {
        Arc::new(Presence {
            session: Arc::clone(session),
            id,
        })
    }
}

impl Drop for Presence {
    fn drop(&mut self) {
        send(&self.session, ToRegistry::Gone(self.id));
    }
}

/// Who controls a client.
#[derive(Clone)]
pub struct Control {
    pub(crate) registration: Id,
    pub worker: WorkerInfo,
}

/// A client that is yet to be made.
#[derive(Clone)]
pub struct Reserved {
    pub(crate) presence: Arc<Presence>,
    pub(crate) control: Option<Control>,
}

/// <https://w3c.github.io/ServiceWorker/#dfn-script-resource-map>
#[derive(Default)]
pub(crate) struct Imports {
    pub(crate) loaded: Vec<(Url, Loaded)>,
    /// What the check for an update could not load.
    pub(crate) missing: Vec<Url>,
    pub(crate) used: Vec<Url>,
    pub(crate) is_complete: bool,
    pub(crate) bypasses_cache: bool,
}

/// Of a main script, and of what it imports.
const MOST_BYTES_OF_SCRIPTS: usize = 32 << 20;
const MOST_IMPORTS: usize = 1024;

impl Imports {
    pub(crate) fn has_room_for(&self, more: &Loaded) -> bool {
        let used = self.loaded.iter().map(|it| it.1.bytes.len()).sum::<usize>();
        self.loaded.len() < MOST_IMPORTS && used + more.bytes.len() <= MOST_BYTES_OF_SCRIPTS
    }
}

/// What a service worker knows about itself.
#[derive(Clone)]
pub struct Own {
    pub(crate) client: ClientId,
    pub worker: WorkerInfo,
    pub registration: RegistrationInfo,
    pub(crate) imports: Arc<Guarded<Imports>>,
}

pub struct Start {
    pub seed: WorkerSeed,
    pub is_module: bool,
    /// Unless it was compiled.
    pub source: Option<SharedBytes>,
    /// Gets the thread, and whether there is a listener for `fetch`.
    pub started: Sender<(Thread, bool)>,
    pub ended: Box<dyn Fn()>,
    pub outside: Outside,
}

/// What a service worker has in place of a window.
#[derive(Clone)]
pub struct Outside {
    session: Arc<Session>,
    worker: WorkerInfo,
}

impl Outside {
    pub fn log(&self, level: Level, message: String, line: u32, url: String) {
        let news = News::Console {
            worker: self.worker.id,
            level,
            message,
            line,
            url,
        };
        self.session.notify(|it| it.service_workers_report(news));
    }

    pub async fn may_notify(&self) -> bool {
        let url = self.worker.url.clone();
        let asking =
            (self.session).consult(move |it| core::future::ready(Ok(it.lets_notify(&url))));
        asking.await == Ok(true)
    }
}

pub fn notification_was_clicked(session: &Arc<Session>, id: Id) {
    send(session, ToRegistry::Notified { id, is_click: true });
}

pub fn notification_was_closed(session: &Arc<Session>, id: Id) {
    let is_click = false;
    send(session, ToRegistry::Notified { id, is_click });
}

/// Dropping it terminates the worker.
pub type Running = Box<dyn Any>;

#[derive(Clone)]
pub(crate) struct Address {
    pub(crate) thread: Thread,
    pub(crate) client: ClientId,
}

impl Address {
    fn tell(&self, notice: Notice) {
        let id = self.client;
        self.thread
            .run(move || Client::find(id).map_or((), |it| it.notice(notice)));
    }
}

pub(crate) type Referrer = (Url, ReferrerPolicy);

/// A script has no say in it.
#[derive(Clone)]
pub(crate) struct Caller {
    pub(crate) address: Address,
    pub(crate) info: ClientInfo,
    /// What scopes are matched against.
    pub(crate) home_url: Url,
    pub(crate) referrer: Option<Referrer>,
    pub(crate) bucket: Bytes,
    pub(crate) agent: Agent,
    /// If it is a service worker.
    pub(crate) worker: Option<Id>,
}

pub(crate) enum ToRegistry {
    Call(Box<Caller>, u32, Call),
    Hello {
        caller: Box<Caller>,
        uses: Option<Id>,
        listens: bool,
    },
    /// A worker, with its bucket and the registration that it uses.
    Expect(Id, Bytes, Option<Id>),
    Gone(Id),
    Idle(Id),
    /// And whether a service worker may have brought it about.
    CookieChanged(Box<Change>, bool),
    Preloaded(Id, Box<ResourceTiming>),
    Notified {
        id: Id,
        is_click: bool,
    },
}

pub fn is_allowed_at(url: &Url) -> bool {
    is_potentially_trustworthy(url)
        && (url.is_http()
            || privileges_of(url.scheme()).contains(Privileges::ALLOW_SERVICE_WORKERS))
}
