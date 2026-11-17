//! A document or a worker, as what it loads and stores is checked against. Scripts have no say in it.

use core::cell::{Cell, Ref, RefCell};
use core::mem::ManuallyDrop;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::Poll;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_threading::Guarded;

use crate::csp::embedded::RequiredCsp;
use crate::csp::{Delivery, Directive, Inline, Metadata, Verdict, Violation, strip_for_report};
use crate::encoding::Encoding;
use crate::exec::{self, LocalFuture, Shared, Thread, Waiter};
use crate::headers::{HeaderList, collect_quoted, is_forbidden_request_header, split};
use crate::integrity::{Hash, parse_metadata};
use crate::locks::LockManager;
use crate::mime::Mime;
use crate::net::body::{Chunk, Data, FOR_DATA, FOR_SUBRESOURCES, SharedBytes};
use crate::net::checks::{EmbedderPolicy, has_bad_port, is_insecure, upgrade_insecure};
use crate::net::cookies::{self, Cookie};
use crate::net::embedder::ClientId;
use crate::net::fetch::{self, Controller, EndOfBody, Initiator, IsolationKind, Observer, Role};
use crate::net::response::{Head, Response, ResponseType, is_ok_status};
use crate::net::schemes::process_data_url;
use crate::net::session::Session;
use crate::net::web_socket::{Connection, Handshake};
use crate::net::{NetError, Result};
use crate::origin::{Origin, Site, is_potentially_trustworthy};
use crate::permissions_policy::{Declared, Feature, PermissionsPolicy};
use crate::policy_container::PolicyContainer;
use crate::referrer::ReferrerPolicy;
use crate::reporting::{Member, Members, ReportType, to_json};
use crate::request::{
    Credentials, Destination, InitiatorType, Mode, Redirect, Request, RequestBody,
};
use crate::scheme::{Privileges, privileges_of};
use crate::structured::{Bare, parse_item};
use crate::time::monotonic_now;
use crate::timing::{NavigationType, ResourceTiming};
use crate::url::Url;
use crate::{Bytes, compiled, mime, trust};

const MAX_UNREAD_TIMINGS: usize = 250;
const MAX_SENT_REPORTS: usize = 1000;

#[derive(Clone, Default)]
pub struct ScriptLocation {
    pub url: Bytes,
    pub line: u32,
    pub column: u32,
}

unsafe extern "C" {
    safe fn Bun__DesktopRealm__locate(
        global: &JSGlobalObject,
        thrown: JSValue,
        line_and_column: &mut [u32; 2],
    ) -> bun_core::String;
}

impl ScriptLocation {
    /// Of the script that is running.
    pub fn now(global: &JSGlobalObject) -> ScriptLocation {
        ScriptLocation::of_exception(global, JSValue::ZERO)
    }

    /// `thrown` is a `JSC::Exception`, or the value that was thrown last.
    pub fn of_exception(global: &JSGlobalObject, thrown: JSValue) -> ScriptLocation {
        let mut place = [0; 2];
        let url = Bun__DesktopRealm__locate(global, thrown, &mut place);
        ScriptLocation {
            url: (*url.to_utf8()).into(),
            line: place[0],
            column: place[1],
        }
    }
}

/// What a client tells its realm.
pub trait Scripts {
    fn log_error(&self, message: &[u8]);
    fn location(&self) -> ScriptLocation;
    fn is_inspected(&self) -> bool;
}

/// What comes with a document.
pub struct Commit<'a> {
    pub url: Url,
    pub headers: &'a HeaderList,
    pub status: u16,
    pub referrer: Bytes,
    pub origin_of: Option<&'a Client>,
    pub policies_of: Option<&'a Client>,
    pub has_policies_from_history: bool,
    pub sandboxing: Sandboxing,
    pub container: Option<Container<'a>>,
}

pub enum Sandboxing {
    ByPolicy,
    OpaqueOrigin,
    Ignored,
}

/// The attributes of the element of a frame.
pub struct Container<'a> {
    pub allow: &'a [u8],
    pub allows_fullscreen: bool,
    pub has_started_navigation: bool,
    pub csp: Option<&'a [u8]>,
    /// `None` is the origin of the parent.
    pub src: Option<Url>,
}

#[derive(Clone)]
struct Document {
    url: Url,
    origin: Origin,
    /// Also if the origin is opaque, and derives from such a one.
    is_from_https: bool,
    status: u16,
    referrer: Bytes,
    policies: PolicyContainer,
    permissions: PermissionsPolicy,
    reported_permissions: PermissionsPolicy,
    is_isolated: bool,
    required_csp: Option<RequiredCsp>,
    refuses_required_csp: bool,
}

#[derive(Clone)]
struct Agent {
    user_agent: Bytes,
    accept_language: Bytes,
    app_path: Bytes,
}

enum Ancestry {
    Top,
    Frame(Rc<Client>),
    Worker {
        ancestors: Vec<Origin>,
        is_secure: bool,
    },
}

#[derive(Clone)]
struct Creator {
    thread: Thread,
    id: ClientId,
    destination: Destination,
}

/// What the thread of a worker makes its client from.
pub struct WorkerSeed {
    id: ClientId,
    responsible: ClientId,
    token: Bytes,
    session: Arc<Session>,
    role: Role,
    agent: Agent,
    document: Document,
    ancestors: Vec<Origin>,
    is_secure: bool,
    creator: Creator,
    unread_timings: UnreadTimings,
}

/// A worker shares them with the client that fetches its first scripts.
type UnreadTimings = Arc<Guarded<Vec<ResourceTiming>>>;

#[derive(Clone)]
pub struct Loaded {
    pub head: Head,
    pub bytes: SharedBytes,
}

struct Deferred {
    id: u32,
    origin: Origin,
    size: usize,
}

pub struct Client {
    pub id: ClientId,
    pub token: Bytes,
    pub session: Arc<Session>,
    role: Role,
    ancestry: Ancestry,
    agent: RefCell<Agent>,
    document: RefCell<Document>,
    scripts: RefCell<Option<Rc<dyn Scripts>>>,
    fetches: RefCell<Vec<Controller>>,
    preloaded: RefCell<HashMap<Bytes, Preloaded>>,
    sent_reports: RefCell<HashMap<u64, ()>>,
    unread_timings: UnreadTimings,
    navigation_timing: RefCell<Option<(ResourceTiming, NavigationType)>>,
    created: f64,
    timing_watcher: RefCell<Option<Rc<dyn Fn(ResourceTiming)>>>,
    /// Of this document, and of the frames of the same origin in it.
    deferred_quota: RefCell<Vec<Deferred>>,
    deferred_requests: RefCell<Vec<(u32, Request)>>,
    /// The length of the bodies of keepalive requests that are on their way.
    kept_alive: Cell<u64>,
    outliving: RefCell<(u32, Waiter)>,
    /// Of a worker, until it runs: what loads the modules that it starts with.
    creator: RefCell<Option<Creator>>,
    /// The document that the app is told about for its requests.
    responsible: Cell<ClientId>,
    is_disposed: Cell<bool>,
}

thread_local! {
    static CLIENTS: RefCell<HashMap<u32, Weak<Client>>> = RefCell::default();
}

fn next_id() -> u32 {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

impl ClientId {
    pub fn next() -> ClientId {
        ClientId(next_id())
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = CLIENTS.try_with(|it| it.borrow_mut().remove(&self.id.0));
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScriptType {
    Classic,
    JavaScriptModule,
    JsonModule,
    CssModule,
    TextModule,
}

impl ScriptType {
    /// From the import attribute `type`.
    pub fn of_module(attribute: &[u8]) -> Option<ScriptType> {
        Some(match attribute {
            b"" => ScriptType::JavaScriptModule,
            b"json" => ScriptType::JsonModule,
            b"css" => ScriptType::CssModule,
            b"text" => ScriptType::TextModule,
            _ => return None,
        })
    }

    pub fn destination(self) -> Destination {
        match self {
            ScriptType::Classic | ScriptType::JavaScriptModule => Destination::Script,
            ScriptType::JsonModule => Destination::Json,
            ScriptType::CssModule => Destination::Style,
            ScriptType::TextModule => Destination::Text,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Use,
    Preload,
    Prefetch,
}

/// What an element or a style sheet has asked for.
#[derive(Clone)]
pub struct Resource {
    pub url: Url,
    pub status: u16,
    pub mime: Option<Mime>,
    pub bytes: SharedBytes,
    /// Whether scripts may know what is in it.
    pub is_readable: bool,
    pub referrer_policy: ReferrerPolicy,
}

impl Resource {
    pub fn essence(&self) -> &[u8] {
        self.mime.as_ref().map_or(b"", Mime::essence)
    }

    /// `fallback` is for what does not say how it is encoded.
    pub fn encoding(&self, fallback: Encoding) -> Encoding {
        let declared = || Encoding::for_label(self.mime.as_ref()?.parameter(b"charset")?);
        (Encoding::for_bom(&self.bytes).or_else(declared)).unwrap_or(fallback)
    }
}

pub enum Script {
    FromApp(Vec<u8>),
    Loaded(Box<Loaded>),
}

impl Script {
    pub fn into_source(self) -> SharedBytes {
        match self {
            Script::FromApp(source) => source.into(),
            Script::Loaded(loaded) => loaded.bytes,
        }
    }
}

#[derive(Clone, Copy)]
pub enum Cors {
    Anonymous,
    UseCredentials,
}

impl Cors {
    pub fn parse(attribute: &[u8]) -> Cors {
        if attribute.eq_ignore_ascii_case(b"use-credentials") {
            Cors::UseCredentials
        } else {
            Cors::Anonymous
        }
    }
}

/// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#create-a-potential-cors-request
pub fn potential_cors_request(url: Url, destination: Destination, cors: Option<Cors>) -> Request {
    match cors {
        None => Request::new(url, destination, Mode::NoCors, Credentials::Include),
        Some(Cors::Anonymous) => {
            Request::new(url, destination, Mode::Cors, Credentials::SameOrigin)
        }
        Some(Cors::UseCredentials) => {
            Request::new(url, destination, Mode::Cors, Credentials::Include)
        }
    }
}

/// What `as` and `type` of a link ask for, if that can be preloaded.
pub fn preload_destination(kind: &[u8], mime: &[u8]) -> Option<Destination> {
    let mime = &*mime.to_ascii_lowercase();
    let (destination, is_supported) = match kind {
        b"fetch" => (Destination::Empty, true),
        b"font" => (
            Destination::Font,
            matches!(
                mime,
                b"font/woff" | b"font/woff2" | b"font/otf" | b"font/ttf" | b"font/sfnt"
            ),
        ),
        b"image" => {
            let subtype = mime.strip_prefix(b"image/").unwrap_or_default();
            (
                Destination::Image,
                matches!(
                    subtype,
                    b"apng" | b"bmp" | b"gif" | b"jpeg" | b"png" | b"svg+xml" | b"webp" | b"x-icon"
                ),
            )
        }
        b"script" => (Destination::Script, mime::is_javascript(mime)),
        b"style" => (Destination::Style, mime == b"text/css"),
        b"track" => (Destination::Track, mime == b"text/vtt"),
        _ => return None,
    };
    (mime.is_empty() || is_supported).then_some(destination)
}

/// The same for requests that can share a response.
pub fn preload_key(request: &Request) -> Bytes {
    [
        request.url.without_fragment(),
        &[
            b' ',
            request.destination as u8,
            request.mode as u8,
            request.credentials as u8,
        ],
    ]
    .concat()
    .into()
}

pub enum DeferError {
    InsecureUrl,
    QuotaExceeded(usize),
}

pub enum SocketRefusal {
    MixedContent,
    Blocked,
}

struct Preloaded {
    integrity: Vec<Hash>,
    loading: Shared<Result<Loaded>>,
}

struct Fetching<'a> {
    client: &'a Client,
    timed: Option<(Bytes, InitiatorType)>,
    blocks_rendering: bool,
}

impl Observer for Fetching<'_> {
    fn will_check(&self, request: &Request, first: Option<&Url>) {
        self.client.report_request(request, first);
    }

    fn allows(&self, request: &Request, first: Option<&Url>) -> bool {
        (first.is_none() || request.destination != Destination::Report)
            && self.client.allows_request(request, first)
            && (first.is_some() || self.client.integrity_policy_allows(request))
            && (request.initiator_type == Some(InitiatorType::XmlHttpRequest)
                || self.client.allows_credentials_in(&request.url))
    }

    fn blocked_as_mixed_content(&self, request: &Request, first: Option<&Url>) {
        self.client
            .report_mixed_content(first.unwrap_or(&request.url));
    }

    fn violated(&self, kind: IsolationKind, request: &Request, first: &Url, is_enforced: bool) {
        self.client
            .report_corp_violation(kind, b"corp", request.destination, first, is_enforced);
    }

    fn end_of_body(&self) -> Option<EndOfBody> {
        let ((name, initiator_type), blocks_rendering) =
            (self.timed.clone()?, self.blocks_rendering);
        let (id, thread) = (self.client.id, Thread::current());
        Some(Box::new(move |head, size| {
            let Ok(size) = size else { return };
            let record = ResourceTiming {
                blocks_rendering,
                ..ResourceTiming::of_response(&name, initiator_type, head, size)
            };
            thread.run(move || {
                if let Some(client) = Client::find(id) {
                    client.record_timing(record);
                }
            });
        }))
    }
}

impl Client {
    fn make(
        id: ClientId,
        token: Bytes,
        session: Arc<Session>,
        role: Role,
        ancestry: Ancestry,
        agent: Agent,
        document: Document,
        unread_timings: UnreadTimings,
    ) -> Rc<Client> {
        let client = Rc::new(Client {
            id,
            token,
            session,
            role,
            ancestry,
            agent: agent.into(),
            document: document.into(),
            scripts: RefCell::default(),
            fetches: RefCell::default(),
            preloaded: RefCell::default(),
            sent_reports: RefCell::default(),
            unread_timings,
            navigation_timing: RefCell::default(),
            created: monotonic_now(),
            timing_watcher: RefCell::default(),
            deferred_quota: RefCell::default(),
            deferred_requests: RefCell::default(),
            kept_alive: Cell::default(),
            outliving: RefCell::default(),
            creator: RefCell::default(),
            responsible: Cell::new(id),
            is_disposed: Cell::new(false),
        });
        CLIENTS.with_borrow_mut(|it| it.insert(id.0, Rc::downgrade(&client)));
        client
    }

    fn new_token() -> Bytes {
        let mut random = [0u8; 16];
        bun_boringssl_sys::rand_bytes(&mut random);
        format!("{:032X}", u128::from_le_bytes(random))
            .into_bytes()
            .into()
    }

    /// It has an opaque origin until [`commit`](Self::commit).
    pub fn new(
        session: Arc<Session>,
        parent: Option<Rc<Client>>,
        has_web_security: bool,
        url: Url,
    ) -> Rc<Client> {
        let role = if has_web_security {
            Role::Page
        } else {
            Role::PageWithoutWebSecurity
        };
        Client::with_role(session, parent, role, url)
    }

    fn with_role(
        session: Arc<Session>,
        parent: Option<Rc<Client>>,
        role: Role,
        url: Url,
    ) -> Rc<Client> {
        let origin = Origin::new_opaque();
        let permissions = PermissionsPolicy::new(origin.clone(), None, Declared::default());
        let document = Document {
            policies: PolicyContainer::from_response(&url, &HeaderList::default(), false),
            url,
            origin,
            is_from_https: false,
            status: 200,
            referrer: Bytes::default(),
            reported_permissions: permissions.clone(),
            permissions,
            is_isolated: false,
            required_csp: None,
            refuses_required_csp: false,
        };
        let agent = Agent {
            user_agent: Bytes::default(),
            accept_language: Bytes::default(),
            app_path: Bytes::default(),
        };
        Client::make(
            ClientId(next_id()),
            Client::new_token(),
            session,
            role,
            parent.map_or(Ancestry::Top, Ancestry::Frame),
            agent,
            document,
            UnreadTimings::default(),
        )
    }

    fn for_program() -> Rc<Client> {
        let url = Url::parse(b"about:blank").expect("a URL");
        let role = Role::App {
            bypasses_handlers: true,
        };
        Client::with_role(Session::without_embedder(), None, role, url)
    }

    /// For the documents whose scripts are the program.
    pub fn of_program() -> Rc<Client> {
        thread_local! {
            static OF_PROGRAM: ManuallyDrop<RefCell<Option<Rc<Client>>>> = bun_ui::lasting(|| drop(OF_PROGRAM.with(|it| it.take())));
        }
        OF_PROGRAM.with(|it| Rc::clone(it.borrow_mut().get_or_insert_with(Client::for_program)))
    }

    /// For the documents that draw controls, which need nothing from outside.
    pub fn of_controls() -> Rc<Client> {
        thread_local! {
            static OF_CONTROLS: ManuallyDrop<Rc<Client>> = {
                let client = Client::for_program();
                client.add_csp(b"default-src data: blob: 'unsafe-inline'", Delivery::Header);
                ManuallyDrop::new(client)
            };
        }
        OF_CONTROLS.with(|it| Rc::clone(it))
    }

    /// Of this thread.
    pub fn find(id: ClientId) -> Option<Rc<Client>> {
        CLIENTS.with_borrow(|it| it.get(&id.0)?.upgrade())
    }

    pub fn set_scripts(&self, scripts: Rc<dyn Scripts>) {
        self.scripts.replace(Some(scripts));
    }

    pub fn set_agent(&self, user_agent: &[u8], accept_language: &[u8], app_path: &[u8]) {
        self.agent.replace(Agent {
            user_agent: user_agent.into(),
            accept_language: accept_language.into(),
            app_path: app_path.into(),
        });
    }

    pub fn commit(&self, commit: Commit<'_>) {
        let Commit {
            url,
            headers,
            status,
            referrer,
            ..
        } = commit;
        let origin = commit
            .origin_of
            .map_or_else(|| Origin::of(&url), Client::origin);
        let inherited = commit.policies_of.map(|it| it.policies().inherited());
        let is_from_https = origin.is_https()
            || commit
                .origin_of
                .is_some_and(|it| it.document.borrow().is_from_https);
        let mut document = self.document.borrow_mut();
        document.is_from_https = is_from_https;
        (
            document.url,
            document.origin,
            document.status,
            document.referrer,
        ) = (url, origin, status, referrer);
        drop(document);
        let mut policies = inherited.unwrap_or_else(|| {
            PolicyContainer::from_response(&self.url(), headers, self.is_secure())
        });
        let required_csp =
            self.required_csp(commit.container.as_ref().and_then(|it| it.csp), &self.url());
        let asked = required_csp
            .as_ref()
            .zip(self.parent())
            .filter(|_| !commit.has_policies_from_history);
        let refuses_required_csp = asked.is_some_and(|it| {
            !it.0
                .apply(&mut policies.csp, &self.url(), headers, &it.1.origin())
        });
        let origin = match commit.sandboxing {
            Sandboxing::ByPolicy
                if policies
                    .csp
                    .sandbox()
                    .is_none_or(|it| it.iter().any(|it| it == b"allow-same-origin")) =>
            {
                self.origin()
            }
            Sandboxing::Ignored => self.origin(),
            _ => Origin::new_opaque(),
        };
        let around = self.parent().map(|parent| {
            let (parent, mut declared) = (parent.document.borrow().clone(), Declared::default());
            if let Some(Container {
                allow,
                allows_fullscreen,
                has_started_navigation,
                src,
                ..
            }) = commit.container
            {
                let src = if origin.is_opaque() {
                    origin.clone()
                } else {
                    src.map_or_else(|| parent.origin.clone(), |it| Origin::of(&it))
                };
                declared.add_directives(allow, &parent.origin, Some(&src));
                declared.add_directives(
                    if allows_fullscreen {
                        b"fullscreen *"
                    } else {
                        b""
                    },
                    &parent.origin,
                    Some(&src),
                );
                if !has_started_navigation {
                    declared.forget_opaque_src();
                }
            }
            (parent, declared)
        });
        let mut enforced =
            Declared::from_header(&headers.get_or_empty(b"permissions-policy"), &origin);
        enforced.add_directives(&headers.get_or_empty(b"feature-policy"), &origin, None);
        let reported = Declared::from_header(
            &headers.get_or_empty(b"permissions-policy-report-only"),
            &origin,
        );
        let mut document = self.document.borrow_mut();
        document.permissions = PermissionsPolicy::new(
            origin.clone(),
            around.as_ref().map(|it| (&it.0.permissions, &it.1)),
            enforced,
        );
        document.reported_permissions = PermissionsPolicy::new(origin.clone(), None, reported);
        document.origin = origin;
        let has_own_group = || {
            matches!(
                parse_item(&headers.get_or_empty(b"cross-origin-opener-policy")),
                Some((Bare::Token(b"same-origin"), _))
            )
        };
        document.is_isolated = policies.document_isolation_policy.isolates()
            || (around.map_or_else(
                || policies.embedder_policy.isolates() && has_own_group(),
                |it| it.0.is_isolated,
            ) && document.permissions.allows(Feature::CrossOriginIsolated));
        (
            document.policies,
            document.required_csp,
            document.refuses_required_csp,
        ) = (policies, required_csp, refuses_required_csp);
    }

    fn required_csp(&self, attribute: Option<&[u8]>, url: &Url) -> Option<RequiredCsp> {
        RequiredCsp::new(
            attribute,
            self.parent()?.document.borrow().required_csp.as_ref(),
            url,
        )
    }

    /// What this document inherits from when it is loaded again.
    pub fn bequest(&self, creator: &Client) -> Rc<Client> {
        let (agent, document) = (
            self.agent.borrow().clone(),
            Document {
                origin: creator.origin(),
                ..self.document.borrow().clone()
            },
        );
        Client::make(
            ClientId(next_id()),
            Client::new_token(),
            Arc::clone(&self.session),
            self.role,
            Ancestry::Top,
            agent,
            document,
            UnreadTimings::default(),
        )
    }

    /// `headers` came with the script at `url`.
    pub fn seed_worker(&self, url: Url, headers: &HeaderList, is_shared: bool) -> WorkerSeed {
        let mut document = self.document.borrow().clone();
        document.is_from_https = self.prohibits_mixed_content();
        if url.scheme() == b"data" {
            (document.origin, document.is_isolated) = (Origin::new_opaque(), false);
        }
        let inherited = document.policies.inherited();
        document.policies = if url.is_http() {
            let document_isolation_policy = inherited.document_isolation_policy;
            PolicyContainer {
                document_isolation_policy,
                ..PolicyContainer::from_response(&url, headers, self.is_secure())
            }
        } else {
            inherited
        };
        if is_shared {
            document.policies.document_isolation_policy = Default::default();
        }
        (document.url, document.status, document.referrer) = (url, 200, Bytes::default());
        WorkerSeed {
            id: ClientId(next_id()),
            responsible: self.responsible.get(),
            token: Client::new_token(),
            session: Arc::clone(&self.session),
            role: self.role,
            agent: self.agent.borrow().clone(),
            document,
            ancestors: self.ancestors(),
            is_secure: self.is_secure(),
            creator: Creator {
                thread: Thread::current(),
                id: self.id,
                destination: match is_shared {
                    true => Destination::SharedWorker,
                    false => Destination::Worker,
                },
            },
            unread_timings: UnreadTimings::default(),
        }
    }

    pub fn for_worker(seed: WorkerSeed) -> Rc<Client> {
        let WorkerSeed {
            id,
            responsible,
            token,
            session,
            role,
            agent,
            document,
            ancestors,
            is_secure,
            creator,
            unread_timings,
        } = seed;
        let client = Client::make(
            id,
            token,
            session,
            role,
            Ancestry::Worker {
                ancestors,
                is_secure,
            },
            agent,
            document,
            unread_timings,
        );
        client.creator.replace(Some(creator));
        client.responsible.set(responsible);
        client
    }

    pub fn parent(&self) -> Option<&Rc<Client>> {
        if let Ancestry::Frame(parent) = &self.ancestry {
            Some(parent)
        } else {
            None
        }
    }

    pub fn url(&self) -> Url {
        self.document.borrow().url.clone()
    }

    pub fn set_url(&self, url: Url) {
        self.document.borrow_mut().url = url;
    }

    pub fn referrer(&self) -> Bytes {
        self.document.borrow().referrer.clone()
    }

    pub fn origin(&self) -> Origin {
        self.document.borrow().origin.clone()
    }

    pub fn policies(&self) -> Ref<'_, PolicyContainer> {
        Ref::map(self.document.borrow(), |it| &it.policies)
    }

    pub fn permissions_policy(&self) -> Ref<'_, PermissionsPolicy> {
        Ref::map(self.document.borrow(), |it| &it.permissions)
    }

    pub fn add_csp(&self, value: &[u8], delivery: Delivery) {
        self.document.borrow_mut().policies.csp.add(value, delivery);
    }

    pub fn set_referrer_policy(&self, policy: ReferrerPolicy) {
        let policies = &mut self.document.borrow_mut().policies;
        policies.referrer_policy = policy.or(policies.referrer_policy);
    }

    pub fn is_cross_origin_isolated(&self) -> bool {
        self.document.borrow().is_isolated
    }

    /// The origins of the documents that it is in, the outermost last.
    pub fn ancestors(&self) -> Vec<Origin> {
        match &self.ancestry {
            Ancestry::Top => Vec::new(),
            Ancestry::Frame(parent) => [vec![parent.origin()], parent.ancestors()].concat(),
            Ancestry::Worker { ancestors, .. } => ancestors.clone(),
        }
    }

    pub fn is_secure(&self) -> bool {
        if let Ancestry::Worker { is_secure, .. } = self.ancestry {
            return is_secure;
        }
        let document = self.document.borrow();
        is_potentially_trustworthy(document.origin.to_url().as_ref().unwrap_or(&document.url))
            && self.parent().is_none_or(|it| it.is_secure())
    }

    /// https://w3c.github.io/webappsec-mixed-content/#categorize-settings-object
    fn prohibits_mixed_content(&self) -> bool {
        self.document.borrow().is_from_https
            || self.parent().is_some_and(|it| it.prohibits_mixed_content())
    }

    /// What is not upgraded by itself.
    pub fn blocks_as_mixed_content(&self, url: &Url) -> bool {
        self.prohibits_mixed_content() && is_insecure(url) && !self.upgrades_insecure_requests()
    }

    pub fn upgrades_insecure_requests(&self) -> bool {
        self.policies()
            .csp
            .enforces(Directive::UpgradeInsecureRequests)
            || self
                .parent()
                .is_some_and(|it| it.upgrades_insecure_requests())
    }

    /// What it is the referrer as.
    pub fn referrer_source(&self) -> Option<Url> {
        let document = self.document.borrow();
        match self.parent() {
            Some(parent) if document.url.href() == b"about:srcdoc" => parent.referrer_source(),
            _ => (!document.origin.is_opaque()).then(|| document.url.clone()),
        }
    }

    /// What its storage is kept under.
    pub fn bucket(&self) -> Vec<u8> {
        let (origin, ancestors) = (self.origin(), self.ancestors());
        let Some(top) = ancestors.last() else {
            return origin.as_bytes().to_vec();
        };
        let is_first_party =
            |it: &Origin| it == top || top.to_url().is_some_and(|top| it.is_same_site_with(&top));
        if is_first_party(&origin) && ancestors.iter().all(is_first_party) {
            return origin.as_bytes().to_vec();
        }
        [origin.as_bytes(), b"^", top.as_bytes()].concat()
    }

    /// What it has in common with those that it may talk to.
    pub fn partition_key(&self) -> Vec<u8> {
        let origin = self.origin();
        let key = if origin.is_opaque() {
            origin.key()
        } else {
            self.bucket()
        };
        [&self.session.id().to_le_bytes(), &*key].concat()
    }

    pub fn locks(&self) -> LockManager {
        self.session.locks_of(&self.bucket())
    }

    fn scripts(&self) -> Option<Rc<dyn Scripts>> {
        self.scripts.borrow().clone()
    }

    fn log_error(&self, message: core::fmt::Arguments<'_>) {
        if let Some(scripts) = self.scripts() {
            scripts.log_error(message.to_string().as_bytes());
        }
    }

    fn send_report(&self, url: Url, is_legacy: bool, json: String) {
        let Some(client) = Client::find(self.id) else {
            return;
        };
        let mut request = Request::new(
            url,
            Destination::Report,
            if is_legacy { Mode::NoCors } else { Mode::Cors },
            Credentials::SameOrigin,
        );
        request.method = b"POST"[..].into();
        request.redirect = if is_legacy {
            Redirect::Follow
        } else {
            Redirect::Error
        };
        request.headers.append(
            b"Content-Type",
            if is_legacy {
                b"application/csp-report"
            } else {
                b"application/reports+json"
            },
        );
        request.body = Some(RequestBody::Data(Data::Bytes(json.into_bytes().into())));
        request.keepalive = true;
        client.fetch_and_forget(request);
    }

    /// To the observers in the realm, and to an endpoint that `Reporting-Endpoints` has named.
    fn queue_report(
        &self,
        kind: ReportType,
        body: Members,
        endpoint: Option<&[u8]>,
        element: JSValue,
    ) {
        if let Some(endpoint) = endpoint {
            self.send_to_endpoint(kind, &body, endpoint);
        }
        crate::realm::tell_scripts(self.id, kind, body, element);
    }

    fn send_to_endpoint(&self, kind: ReportType, body: &Members, endpoint: &[u8]) {
        let url = self.policies().endpoints.get(endpoint).cloned();
        if let Some(url) = url {
            let about = [
                ("age", Member::Number(0)),
                ("type", kind.as_bytes().into()),
                ("url", (*strip_for_report(&self.url())).into()),
                (
                    "user_agent",
                    Member::Text(self.agent.borrow().user_agent.clone()),
                ),
            ];
            self.send_report(
                url,
                false,
                format!("[{{\"body\":{},{}]", to_json(body), &to_json(&about)[1..]),
            );
        }
    }

    /// The URL of the script that is running, the line and the column.
    fn location(&self, known: Option<ScriptLocation>) -> [Member; 3] {
        let ScriptLocation { url, line, column } = known
            .or_else(|| self.scripts().map(|it| it.location()))
            .unwrap_or_default();
        Url::parse(&url).map_or([Member::Null, Member::Null, Member::Null], |url| {
            let stripped = strip_for_report(&url);
            let without_query =
                strings::split_once_char(&stripped, b'?').map_or(&*stripped, |it| it.0);
            [
                without_query.into(),
                Member::Number(line),
                Member::Number(column),
            ]
        })
    }

    /// https://w3c.github.io/webappsec-csp/#report-violation
    fn report_violation(&self, violation: Violation, element: JSValue, at: Option<ScriptLocation>) {
        let Violation {
            blocked,
            directive,
            policy,
            is_enforced,
            sample,
            report_urls,
            report_group,
        } = violation;
        let (name, shown) = (
            bstr::BStr::new(directive.as_bytes()),
            bstr::BStr::new(&policy),
        );
        self.log_error(format_args!(
            "Refused {}: it violates the directive {name} of \"{shown}\"",
            bstr::BStr::new(&blocked)
        ));
        let [source, line, column] = self.location(at);
        let (url, document) = (self.url(), self.document.borrow());
        let members = [
            (
                "documentURL",
                "document-uri",
                (*strip_for_report(&url)).into(),
            ),
            (
                "referrer",
                "referrer",
                Member::Text(document.referrer.clone()),
            ),
            ("blockedURL", "blocked-uri", Member::Text(blocked)),
            (
                "effectiveDirective",
                "effective-directive",
                directive.as_bytes().into(),
            ),
            ("originalPolicy", "original-policy", Member::Text(policy)),
            ("sourceFile", "source-file", source),
            ("sample", "script-sample", Member::Text(sample)),
            (
                "disposition",
                "disposition",
                disposition(is_enforced, b"report"),
            ),
            (
                "statusCode",
                "status-code",
                Member::Number(if url.is_http() {
                    document.status.into()
                } else {
                    0
                }),
            ),
            ("lineNumber", "line-number", line),
            ("columnNumber", "column-number", column),
        ];
        drop(document);
        let mut is_new = false;
        if !report_urls.is_empty() || report_group.is_some() {
            let known = members
                .iter()
                .filter(|it| !matches!(it.2, Member::Null))
                .map(|it| (it.1, it.2.clone()));
            let legacy: Members = known
                .chain([("violated-directive", directive.as_bytes().into())])
                .collect();
            let json = format!("{{\"csp-report\":{}}}", to_json(&legacy));
            let mut sent = self.sent_reports.borrow_mut();
            is_new = sent.len() < MAX_SENT_REPORTS
                && sent.insert(bun_wyhash::hash(json.as_bytes()), ()).is_none();
            drop(sent);
            for target in report_urls
                .iter()
                .filter(|_| is_new)
                .filter_map(|it| url.join(it))
            {
                self.send_report(target, true, json.clone());
            }
        }
        let body = members.into_iter().map(|it| (it.0, it.2)).collect();
        self.queue_report(
            ReportType::CspViolation,
            body,
            report_group.as_deref().filter(|_| is_new),
            element,
        );
    }

    pub fn report_corp_violation(
        &self,
        kind: IsolationKind,
        violated: &[u8],
        destination: Destination,
        blocked: &Url,
        is_enforced: bool,
    ) {
        let (report_type, policy) = match kind {
            IsolationKind::Embedder => (ReportType::Coep, self.policies().embedder_policy.clone()),
            IsolationKind::Document => (
                ReportType::Dip,
                self.policies().document_isolation_policy.clone(),
            ),
        };
        let body = vec![
            ("type", violated.into()),
            ("blockedURL", blocked.stripped().href().into()),
            ("destination", destination.as_bytes().into()),
            ("disposition", disposition(is_enforced, b"reporting")),
        ];
        let endpoint = if is_enforced {
            policy.endpoint
        } else {
            policy.report_only_endpoint
        };
        self.queue_report(report_type, body, endpoint.as_deref(), JSValue::UNDEFINED);
    }

    /// Reports what it violates.
    pub fn allows_eval(&self, code: &[u8]) -> bool {
        let verdict = self.policies().csp.check_eval(code);
        self.enforce(verdict, JSValue::UNDEFINED) && !crate::compiled::is_exclusive()
    }

    pub fn allows_string_for(&self, sink: &[u8], value: &[u8]) -> bool {
        let verdict = self.policies().csp.check_sink(sink, value);
        self.enforce(verdict, JSValue::UNDEFINED)
    }

    pub fn allows_type_policy(&self, name: &[u8], is_taken: bool) -> bool {
        let verdict = self.policies().csp.check_type_policy(name, is_taken);
        self.enforce(verdict, JSValue::UNDEFINED)
    }

    pub fn enforce(&self, verdict: Verdict, element: JSValue) -> bool {
        self.enforce_at(verdict, element, None)
    }

    fn enforce_at(&self, verdict: Verdict, element: JSValue, at: Option<(u32, u32)>) -> bool {
        let is_allowed = verdict.is_allowed();
        for it in verdict.violations {
            let at = at.map(|(line, column)| ScriptLocation {
                url: self.url().href().into(),
                line,
                column,
            });
            self.report_violation(it, element, at);
        }
        is_allowed
    }

    /// `parsed_at`: the line and the column in the source of the document.
    pub fn csp_allows_inline<T: AsRef<str>>(
        &self,
        kind: Inline,
        source: impl FnOnce() -> T,
        nonce: &[u8],
        is_parser_inserted: bool,
        element: JSValue,
        parsed_at: Option<(u32, u32)>,
    ) -> bool {
        if self.policies().csp.is_empty() {
            return true;
        }
        let source = source();
        let verdict = (self.policies().csp).check_inline(
            kind,
            source.as_ref().as_bytes(),
            nonce,
            is_parser_inserted,
        );
        self.enforce_at(verdict, element, parsed_at)
    }

    /// Whether the policy that the document came with says which scripts run.
    pub fn has_restricted_scripts(&self) -> bool {
        !compiled::is_exclusive() && self.policies().csp.restricts_scripts()
    }

    /// Without a policy: what the document came with, and nothing that was put into it since.
    pub fn trusts_inline_script(&self, came_with_document: impl FnOnce() -> bool) -> bool {
        let is_up_to_page = !matches!(self.role, Role::App { .. })
            && (self.has_restricted_scripts()
                || (!compiled::is_exclusive() && trust::trusts_injected_scripts()));
        let is_trusted = is_up_to_page || came_with_document();
        if !is_trusted {
            self.log_error(format_args!(
                "Refused to run an inline script that is not in the source of the document"
            ));
        }
        is_trusted
    }

    /// For when it is about to be used, which is reported if it must not be.
    pub fn may_use(&self, feature: Feature) -> bool {
        let document = self.document.borrow();
        let is_allowed = document.permissions.allows(feature);
        let violated = if is_allowed {
            &document.reported_permissions
        } else {
            &document.permissions
        };
        if violated.allows(feature) {
            return true;
        }
        let endpoint = violated.endpoint(feature).map(Bytes::from);
        drop(document);
        let [source, line, column] = self.location(None);
        let message = [
            b"Permissions policy violation: ",
            feature.as_bytes(),
            b" is not allowed in this document.",
        ]
        .concat();
        let body = vec![
            ("featureId", feature.as_bytes().into()),
            ("sourceFile", source),
            ("lineNumber", line),
            ("columnNumber", column),
            ("disposition", disposition(!is_allowed, b"report")),
            ("message", (*message).into()),
        ];
        self.queue_report(
            ReportType::PermissionsPolicyViolation,
            body,
            endpoint.as_deref(),
            JSValue::UNDEFINED,
        );
        is_allowed
    }

    pub fn csp_allows_request(
        &self,
        url: &Url,
        destination: Destination,
        metadata: &Metadata,
        first: Option<&Url>,
    ) -> bool {
        let verdict = self
            .policies()
            .csp
            .check_request(url, destination, metadata, first);
        self.enforce(verdict, JSValue::UNDEFINED)
    }

    /// Where the program has the script. `None` if it is to be fetched, or to be refused when it is.
    pub fn compiled_path(
        &self,
        url: &Url,
        destination: Destination,
        metadata: &Metadata,
    ) -> Option<Vec<u8>> {
        let path = compiled::path_of(url.href())?;
        let verdict = (self.policies().csp).check_request(url, destination, metadata, None);
        (verdict.is_allowed() && self.enforce(verdict, JSValue::UNDEFINED)).then_some(path)
    }

    /// Only those that it was loaded with.
    pub fn allows_credentials_in(&self, url: &Url) -> bool {
        let own = self.url();
        !url.includes_credentials()
            || ((own.username(), own.password()) == (url.username(), url.password())
                && self.origin() == Origin::of(url))
    }

    fn check_request(&self, request: &Request, first: Option<&Url>) -> Verdict {
        let csp = &self.policies().csp;
        csp.check_request(&request.url, request.destination, &request.metadata, first)
    }

    /// Whether what another request has fetched may be used without a word.
    pub fn may_reuse_for(&self, request: &Request) -> bool {
        self.check_request(request, None).violations.is_empty()
    }

    pub fn report_mixed_content(&self, url: &Url) {
        let verdict = self.policies().csp.check_mixed_content(url);
        self.enforce(verdict, JSValue::UNDEFINED);
    }

    /// https://w3c.github.io/webappsec-csp/#report-for-request
    pub fn report_request(&self, request: &Request, first: Option<&Url>) {
        if self.policies().csp.has_report_only() {
            let verdict = self.check_request(request, first).of_enforced(false);
            self.enforce(verdict, JSValue::UNDEFINED);
        }
    }

    /// https://w3c.github.io/webappsec-subresource-integrity/#should-request-be-blocked-by-integrity-policy-section
    fn integrity_policy_allows(&self, request: &Request) -> bool {
        let policies = self.policies();
        let both = [
            &policies.integrity_policy,
            &policies.report_only_integrity_policy,
        ];
        if request.destination != Destination::Script
            || !both.iter().any(|it| it.blocks_scripts)
            || request.url.is_local()
            || privileges_of(request.url.scheme()).contains(Privileges::BYPASS_CSP)
            || (request.mode != Mode::NoCors
                && !parse_metadata(&request.metadata.integrity).is_empty())
        {
            return true;
        }
        for (policy, is_report_only) in both.into_iter().zip([false, true]) {
            if policy.blocks_scripts {
                let body = vec![
                    ("documentURL", (*strip_for_report(&self.url())).into()),
                    ("blockedURL", (*strip_for_report(&request.url)).into()),
                    ("destination", request.destination.as_bytes().into()),
                    ("reportOnly", Member::Boolean(is_report_only)),
                ];
                let kind = ReportType::IntegrityViolation;
                (policy.endpoints.iter()).for_each(|it| self.send_to_endpoint(kind, &body, it));
                self.queue_report(kind, body, None, JSValue::UNDEFINED);
            }
        }
        !policies.integrity_policy.blocks_scripts
    }

    /// Whatever the policy of the page allows, no script of another party runs in this process. After [`Client::report_request`].
    pub fn allows_request(&self, request: &Request, first: Option<&Url>) -> bool {
        let (url, destination) = (&request.url, request.destination);
        let verdict = self.check_request(request, first).of_enforced(true);
        self.enforce(verdict, JSValue::UNDEFINED)
            && match url.scheme() {
                _ if !destination.is_script_like() || matches!(self.role, Role::App { .. }) => true,
                _ if compiled::is_exclusive() => compiled::path_of(url.href()).is_some(),
                b"blob" => true,
                b"data" => {
                    self.policies().csp.restricts_scripts() || trust::trusts_injected_scripts()
                }
                _ => trust::is_trusted(url, &self.agent.borrow().app_path),
            }
    }

    /// Whether a frame or a worker of it may have the policy `theirs`.
    fn embedder_policy_allows(
        &self,
        theirs: EmbedderPolicy,
        violated: &[u8],
        destination: Destination,
        url: &Url,
    ) -> bool {
        let own = self.policies().embedder_policy.values;
        let allows =
            |own| own == EmbedderPolicy::UnsafeNone || theirs != EmbedderPolicy::UnsafeNone;
        for (policy, is_enforced) in [(own.reported, false), (own.enforced, true)] {
            if !allows(policy) {
                self.report_corp_violation(
                    IsolationKind::Embedder,
                    violated,
                    destination,
                    url,
                    is_enforced,
                );
            }
        }
        allows(own.enforced)
    }

    /// https://html.spec.whatwg.org/multipage/document-lifecycle.html#check-a-navigation-response's-adherence-to-x-frame-options
    pub fn allows_embedder(&self, headers: &HeaderList) -> bool {
        let ancestors = self.ancestors();
        if ancestors.is_empty() || self.url().scheme() == b"chrome-error" {
            return true;
        }
        let verdict = self.policies().csp.check_ancestors(&ancestors);
        if !self.enforce(verdict, JSValue::UNDEFINED) || self.document.borrow().refuses_required_csp
        {
            return false;
        }
        let (url, own) = (self.url(), self.policies().embedder_policy.values.enforced);
        if !url.is_local()
            && self.parent().is_some_and(|it| {
                !it.embedder_policy_allows(own, b"navigation", Destination::Iframe, &url)
            })
        {
            return false;
        }
        let value = headers
            .get_or_empty(b"x-frame-options")
            .to_ascii_lowercase();
        let mut options: Vec<_> = split(&value, b',').collect();
        options.sort_unstable();
        options.dedup();
        match &*options {
            _ if self.policies().csp.enforces(Directive::FrameAncestors) => true,
            [b"deny"] => false,
            [b"sameorigin"] => ancestors.iter().all(|it| *it == self.origin()),
            [_] => true,
            _ => !options
                .iter()
                .any(|it| matches!(*it, b"deny" | b"allowall" | b"sameorigin")),
        }
    }

    pub fn initiator(&self) -> Initiator {
        let is_inspected = self.scripts().is_some_and(|it| it.is_inspected());
        let (agent, document) = (self.agent.borrow(), self.document.borrow());
        Initiator {
            role: self.role,
            origin: Some(document.origin.clone()),
            ancestors: self.ancestors(),
            client: Some(self.responsible.get()),
            user_agent: agent.user_agent.clone(),
            accept_language: agent.accept_language.clone(),
            upgrades_insecure_requests: self.upgrades_insecure_requests(),
            prohibits_mixed_content: self.prohibits_mixed_content(),
            blocks_all_mixed_content: document
                .policies
                .csp
                .enforces(Directive::BlockAllMixedContent),
            embedder_policy: document.policies.embedder_policy.values,
            document_isolation_policy: document.policies.document_isolation_policy.values,
            is_inspected,
        }
    }

    /// Of the frame that this document is in, by `source`.
    pub fn prepare_navigation(
        &self,
        request: &mut Request,
        initiator: &mut Initiator,
        source: Option<&Client>,
        is_form: bool,
        csp: Option<&[u8]>,
    ) {
        (request.mode, request.credentials) = (Mode::Navigate, Credentials::Include);
        (initiator.client, initiator.ancestors) = (Some(self.id), self.ancestors());
        initiator.is_inspected = self.scripts().is_some_and(|it| it.is_inspected());
        initiator.prohibits_mixed_content =
            self.parent().is_some_and(|it| it.prohibits_mixed_content());
        initiator.blocks_all_mixed_content = true;
        initiator.embedder_policy = self
            .parent()
            .map(|it| it.policies().embedder_policy.values)
            .unwrap_or_default();
        if let Some(required) = self.required_csp(csp, &request.url) {
            request
                .cors_exempt_headers
                .append(b"Sec-Required-CSP", required.as_bytes());
        }
        initiator.upgrades_insecure_requests = self
            .parent()
            .is_some_and(|it| it.upgrades_insecure_requests())
            || source.is_some_and(|it| {
                it.upgrades_insecure_requests()
                    && (is_form || it.url().host() == request.url.host())
            });
        if let Some(source) = source {
            request.referrer_policy = request
                .referrer_policy
                .or(source.policies().referrer_policy);
        }
    }

    pub fn may_keep_alive(&self, length: u64) -> bool {
        self.kept_alive.get() + length <= 64 << 10
    }

    /// Until the requests that are kept alive have been answered.
    pub async fn finish_kept_alive(&self) {
        core::future::poll_fn(|cx| match &mut *self.outliving.borrow_mut() {
            (0, _) => Poll::Ready(()),
            (_, waiter) => waiter.pending(cx),
        })
        .await
    }

    pub fn fetch<'a>(
        &'a self,
        request: Request,
        controller: &'a Controller,
    ) -> LocalFuture<'a, Result<Response>> {
        Box::pin(self.run_fetch(request, controller))
    }

    async fn run_fetch(&self, mut request: Request, controller: &Controller) -> Result<Response> {
        if !self.preloaded.borrow().is_empty()
            && let Some(loaded) = self.take_preloaded(&request).await
        {
            return loaded.map(|it| Response {
                head: it.head,
                body: Some(Chunk::Shared(it.bytes).into()),
            });
        }
        if !request.keepalive {
            let mut fetches = self.fetches.borrow_mut();
            if fetches.len() == fetches.capacity() {
                fetches.retain(Controller::is_in_use);
            }
            fetches.push(controller.clone());
            if self.is_disposed.get() {
                controller.abort();
            }
        }
        request.referrer_policy = request.referrer_policy.or(self.policies().referrer_policy);
        request
            .headers
            .retain(|name, value| !is_forbidden_request_header(name, value));
        let (start, name) = (monotonic_now(), Bytes::from(request.url.href()));
        let timed = request
            .initiator_type
            .filter(|_| request.url.is_http())
            .map(|it| (name.clone(), it));
        let observer = Fetching {
            client: self,
            timed,
            blocks_rendering: request.blocks_rendering,
        };
        let kept_alive = match &request.body {
            Some(RequestBody::Data(data)) if request.keepalive => data.len(),
            _ => 0,
        };
        let outlives = u32::from(request.keepalive);
        self.kept_alive.update(|it| it + kept_alive);
        self.outliving.borrow_mut().0 += outlives;
        let initiator = self.initiator();
        let fetching = fetch::fetch(&self.session, &initiator, request, &observer, controller);
        let fetched = exec::never_at_once(fetching).await;
        self.kept_alive.update(|it| it - kept_alive);
        self.outliving.borrow_mut().0 -= outlives;
        self.outliving.borrow_mut().1.wake();
        let error = match fetched {
            Ok(response) => return Ok(response),
            Err(failure) => failure.error,
        };
        if error != NetError::Aborted {
            self.log_error(format_args!(
                "Failed to load {}: {}",
                bstr::BStr::new(&name),
                error.message()
            ));
            if let Some((name, initiator_type)) = &observer.timed {
                let failed = ResourceTiming::of_failure(name, *initiator_type, start);
                self.record_timing(ResourceTiming {
                    blocks_rendering: observer.blocks_rendering,
                    ..failed
                });
            }
        }
        Err(error)
    }

    pub fn fetch_whole<'a>(
        &'a self,
        request: Request,
        controller: &'a Controller,
    ) -> LocalFuture<'a, Result<Loaded>> {
        Box::pin(self.run_fetch_whole(request, controller))
    }

    async fn run_fetch_whole(&self, request: Request, controller: &Controller) -> Result<Loaded> {
        let budget = match (request.initiator_type, request.destination) {
            (Some(InitiatorType::Fetch | InitiatorType::XmlHttpRequest), _)
            | (_, Destination::Audio | Destination::Video) => &FOR_DATA,
            _ => &FOR_SUBRESOURCES,
        };
        let Response { head, body } = self.fetch(request, controller).await?;
        let bytes = body.unwrap_or_default().read_within(budget).await?;
        Ok(Loaded {
            head,
            bytes: bytes.into_shared(),
        })
    }

    /// `None` if it cannot be used.
    pub fn load(
        self: Rc<Self>,
        request: Request,
        purpose: Purpose,
        is_quirky: bool,
    ) -> LocalFuture<'static, Option<Resource>> {
        Box::pin(self.run_load(request, purpose, is_quirky))
    }

    async fn run_load(
        self: Rc<Self>,
        mut request: Request,
        purpose: Purpose,
        is_quirky: bool,
    ) -> Option<Resource> {
        let destination = request.destination;
        if destination == Destination::Script
            && (self.compiled_path(&request.url, destination, &request.metadata)).is_some()
        {
            return Some(Resource {
                url: request.url,
                status: 200,
                mime: None,
                bytes: Vec::new().into(),
                is_readable: true,
                referrer_policy: ReferrerPolicy::Empty,
            });
        }
        if purpose == Purpose::Prefetch {
            request.metadata.is_prefetch = true;
            (request.cors_exempt_headers).append(b"Sec-Purpose", b"prefetch");
        }
        let Loaded { head, bytes } = match purpose {
            Purpose::Preload => self.preload(request).await,
            _ => self.fetch_whole(request, &Controller::default()).await,
        }
        .ok()?;
        let (mime, is_readable) = (head.headers.mime(), head.kind != ResponseType::Opaque);
        let has_type = destination != Destination::Style
            || purpose == Purpose::Preload
            || mime.as_ref().is_none_or(|it| it.essence() == b"text/css")
            || (is_quirky && is_readable && head.url.scheme() != b"data");
        let has_status = matches!(destination, Destination::Image | Destination::Empty)
            || is_ok_status(head.status);
        let is_hidden = destination == Destination::Empty && !is_readable;
        (has_type && has_status).then(|| Resource {
            referrer_policy: head.referrer_policy(),
            url: head.url,
            status: if is_hidden { 0 } else { head.status },
            mime,
            bytes: if is_hidden { Vec::new().into() } else { bytes },
            is_readable,
        })
    }

    /// A style sheet that is all in its URL, unless anybody has a say in it.
    pub fn sheet_in_url(&self, request: &Request) -> Option<Resource> {
        (request.url.scheme() == b"data"
            && request.metadata.integrity.is_empty()
            && !self.session.handles(b"data")
            && self.may_reuse_for(request))
        .then_some(())?;
        let (mime, bytes) = process_data_url(&request.url)?;
        Some(Resource {
            url: request.url.clone(),
            status: 200,
            mime: Some(Mime::parse(&mime).filter(|it| it.essence() == b"text/css")?),
            bytes: bytes.into(),
            is_readable: true,
            referrer_policy: ReferrerPolicy::Empty,
        })
    }

    /// Whether what has not been parsed may be fetched.
    pub fn allows_speculation(&self) -> bool {
        self.policies().csp.is_empty()
    }

    pub fn fetch_and_forget(self: Rc<Self>, request: Request) {
        exec::spawn(async move {
            if let Ok(Response {
                body: Some(mut body),
                ..
            }) = self.fetch(request, &Controller::default()).await
            {
                while let Ok(Some(_)) = body.read().await {}
            }
        });
    }

    /// https://html.spec.whatwg.org/multipage/links.html#hyperlink-auditing
    pub fn ping(self: Rc<Self>, url: Url, target: &[u8]) {
        if !url.is_http() {
            return;
        }
        let own = self.url();
        let tells_source = self.origin().is_origin_of(&url) || own.scheme() != b"https";
        let mut request = Request::new(url, Destination::Empty, Mode::NoCors, Credentials::Include);
        request.method = b"POST"[..].into();
        request.headers.append(b"Content-Type", b"text/ping");
        if tells_source {
            request.cors_exempt_headers.append(b"Ping-From", own.href());
        }
        request.cors_exempt_headers.append(b"Ping-To", target);
        request.body = Some(RequestBody::Data(Data::Bytes(b"PING".to_vec().into())));
        (request.initiator_type, request.keepalive) = (Some(InitiatorType::Ping), true);
        self.fetch_and_forget(request);
    }

    pub fn preload(self: &Rc<Self>, request: Request) -> Shared<Result<Loaded>> {
        let key = preload_key(&request);
        let integrity = parse_metadata(&request.metadata.integrity);
        if let Some(known) = self.preloaded.borrow().get(&key)
            && known.integrity == integrity
        {
            return known.loading.clone();
        }
        let client = Rc::clone(self);
        let loading =
            Shared::spawn(async move { client.fetch_whole(request, &Controller::default()).await });
        let preloaded = Preloaded {
            integrity,
            loading: loading.clone(),
        };
        self.preloaded.borrow_mut().insert(key, preloaded);
        loading
    }

    /// https://html.spec.whatwg.org/multipage/links.html#consume-a-preloaded-resource
    async fn take_preloaded(&self, request: &Request) -> Option<Result<Loaded>> {
        let key = preload_key(request);
        let integrity = parse_metadata(&request.metadata.integrity);
        let matches = (self.preloaded.borrow().get(&key))
            .is_some_and(|it| integrity.is_empty() || it.integrity == integrity);
        (matches && *request.method == *b"GET" && self.may_reuse_for(request)).then_some(())?;
        let preloaded = self.preloaded.borrow_mut().remove(&key)?;
        Some(preloaded.loading.await)
    }

    /// The preloads that `Link` headers ask for.
    pub fn follow_links(self: &Rc<Self>, mut header: &[u8]) {
        while let Some((target, rest)) = strings::split_once_char(header, b'<')
            .and_then(|it| strings::split_once_char(it.1, b'>'))
        {
            let parameters = split(rest, b',').next().unwrap_or_default();
            header = &rest[parameters.len()..];
            let get = |name: &[u8]| {
                let mut all = split(parameters, b';')
                    .map(|it| strings::split_once_char(it, b'=').unwrap_or((it, b"")));
                let value = all
                    .find(|it| it.0.trim_ascii().eq_ignore_ascii_case(name))?
                    .1
                    .trim_ascii();
                Some(if value.starts_with(b"\"") {
                    collect_quoted(value).0
                } else {
                    value.to_vec()
                })
            };
            let text = |name| get(name).unwrap_or_default();
            let cors = get(b"crossorigin").map(|it| Cors::parse(&it));
            let (destination, cors) = match &*text(b"rel").to_ascii_lowercase() {
                b"modulepreload" => (Some(Destination::Script), cors.or(Some(Cors::Anonymous))),
                b"preload" => (preload_destination(&text(b"as"), &text(b"type")), cors),
                _ => continue,
            };
            let (Some(destination), Some(url)) = (destination, self.url().join(target)) else {
                continue;
            };
            if destination == Destination::Script && compiled::path_of(url.href()).is_some() {
                continue;
            }
            let mut request = potential_cors_request(url, destination, cors);
            request.metadata = Metadata {
                nonce: text(b"nonce").into(),
                integrity: text(b"integrity").into(),
                ..Metadata::default()
            };
            request.referrer = self.referrer_source();
            request.referrer_policy =
                ReferrerPolicy::parse(&text(b"referrerpolicy")).unwrap_or_default();
            request.initiator_type = Some(InitiatorType::Link);
            self.preload(request);
        }
    }

    pub fn fetch_script(
        &self,
        request: Request,
        kind: ScriptType,
    ) -> LocalFuture<'_, Result<Script>> {
        Box::pin(self.run_fetch_script(request, kind))
    }

    async fn run_fetch_script(&self, request: Request, kind: ScriptType) -> Result<Script> {
        if kind == ScriptType::JavaScriptModule
            && compiled::has_sources()
            && let Some(source) = self.session.source_of(&request.url).await?
        {
            return Ok(Script::FromApp(source));
        }
        let (is_for_worker, starts_worker) = (
            request.destination != Destination::Script,
            request.mode == Mode::SameOrigin && request.destination == Destination::Worker,
        );
        let loaded = self.fetch_whole(request, &Controller::default()).await?;
        if starts_worker && !loaded.head.url.is_local() {
            let theirs = PolicyContainer::from_response(
                &loaded.head.url,
                &loaded.head.headers,
                self.is_secure(),
            )
            .embedder_policy
            .values
            .enforced;
            if !self.embedder_policy_allows(
                theirs,
                b"worker initialization",
                Destination::Worker,
                &loaded.head.url,
            ) {
                return Err(NetError::BlockedByResponse);
            }
        }
        let mime = loaded.head.headers.mime();
        let essence = mime.as_ref().map_or(&b""[..], |it| it.essence());
        let has_type = match kind {
            ScriptType::Classic => {
                mime::is_javascript(essence) || (is_for_worker && !loaded.head.url.is_http())
            }
            ScriptType::JavaScriptModule => mime::is_javascript(essence),
            ScriptType::JsonModule => mime::is_json(essence),
            ScriptType::CssModule => essence == b"text/css",
            ScriptType::TextModule => true,
        };
        if has_type && is_ok_status(loaded.head.status) {
            Ok(Script::Loaded(loaded.into()))
        } else {
            Err(NetError::Failed)
        }
    }

    /// https://html.spec.whatwg.org/#fetch-a-module-worker-script-tree
    pub fn fetch_module(
        &self,
        request: Request,
        kind: ScriptType,
    ) -> LocalFuture<'_, Result<Script>> {
        Box::pin(self.run_fetch_module(request, kind))
    }

    async fn run_fetch_module(&self, mut request: Request, kind: ScriptType) -> Result<Script> {
        let creator = self.creator.borrow().clone();
        let Some(creator) = creator else {
            return self.fetch_script(request, kind).await;
        };
        if kind == ScriptType::JavaScriptModule {
            request.destination = creator.destination;
        }
        let fetching = creator.thread.call(move || async move {
            let client = Client::find(creator.id).ok_or(NetError::Aborted)?;
            client.fetch_script(request, kind).await
        });
        fetching.await.unwrap_or(Err(NetError::Aborted))
    }

    pub fn worker_has_started(&self) {
        self.creator.take();
    }

    fn deferred_fetch_control(&self) -> &Client {
        match self.parent() {
            Some(parent) if parent.origin() == self.origin() => parent.deferred_fetch_control(),
            _ => self,
        }
    }

    /// What is neither sent nor canceled is sent when the document goes away.
    pub fn defer_fetch(
        &self,
        request: Request,
        size: usize,
    ) -> core::result::Result<u32, DeferError> {
        if !request.url.is_http() || !is_potentially_trustworthy(&request.url) {
            return Err(DeferError::InsecureUrl);
        }
        let (control, origin) = (self.deferred_fetch_control(), Origin::of(&request.url));
        let allows = |feature| control.permissions_policy().allows(feature);
        let quota: usize = match (allows(Feature::DeferredFetch), control.parent().is_some()) {
            (true, false) => 512 << 10,
            (true, true) => 64 << 10,
            (false, true) if allows(Feature::DeferredFetchMinimal) => 8 << 10,
            (false, _) => 0,
        };
        let mut used = control.deferred_quota.borrow_mut();
        let of_origin = used
            .iter()
            .filter(|it| it.origin == origin)
            .map(|it| it.size)
            .sum();
        let left = quota
            .saturating_sub(used.iter().map(|it| it.size).sum())
            .min((64usize << 10).saturating_sub(of_origin));
        if size > left {
            return Err(DeferError::QuotaExceeded(left));
        }
        let id = next_id();
        used.push(Deferred { id, origin, size });
        self.deferred_requests.borrow_mut().push((id, request));
        Ok(id)
    }

    pub fn cancel_deferred_fetch(&self, id: u32) -> Option<Request> {
        self.deferred_fetch_control()
            .deferred_quota
            .borrow_mut()
            .retain(|it| it.id != id);
        self.deferred_requests
            .borrow_mut()
            .extract_if(.., |it| it.0 == id)
            .next()
            .map(|it| it.1)
    }

    pub fn send_deferred_fetch(self: &Rc<Self>, id: u32) -> bool {
        self.cancel_deferred_fetch(id)
            .map(|it| Rc::clone(self).fetch_and_forget(it))
            .is_some()
    }

    pub fn record_timing(&self, record: ResourceTiming) {
        let watcher = self.timing_watcher.borrow().clone();
        match watcher {
            Some(watcher) => watcher(record),
            None => {
                let mut unread = self.unread_timings.lock();
                if unread.len() < MAX_UNREAD_TIMINGS {
                    unread.push(record);
                }
            }
        }
    }

    pub fn watch_timings(&self, watcher: Rc<dyn Fn(ResourceTiming)>) {
        self.timing_watcher.replace(Some(watcher));
        let unread = core::mem::take(&mut *self.unread_timings.lock());
        unread.into_iter().for_each(|it| self.record_timing(it));
    }

    pub fn set_navigation_timing(&self, record: ResourceTiming, kind: NavigationType) {
        self.navigation_timing.replace(Some((record, kind)));
    }

    pub fn navigation_timing(&self) -> (ResourceTiming, NavigationType) {
        self.navigation_timing.borrow().clone().unwrap_or_else(|| {
            let mut record =
                ResourceTiming::of_failure(self.url().href(), InitiatorType::Other, self.created);
            record.response_end = self.created;
            (record, NavigationType::Navigate)
        })
    }

    fn cookie_context(&self, url: &Url, is_for_script: bool) -> cookies::Context {
        let (origin, ancestors) = (self.origin(), self.ancestors());
        cookies::Context {
            is_same_site: origin.is_same_site_with(url)
                && ancestors.iter().all(|it| it.is_same_site_with(url)),
            is_top_level_navigation: false,
            has_safe_method: true,
            is_for_script,
            top_level_site: Site::of_origin(ancestors.last().unwrap_or(&origin)),
        }
    }

    /// Another one when [`cookie_string`](Self::cookie_string) may have changed.
    pub fn cookie_version(&self) -> u32 {
        self.session.with_cookies(|it| it.version())
    }

    pub fn cookie_string(&self) -> Vec<u8> {
        let url = self.url();
        self.session
            .with_cookies(|it| it.header(&url, &self.cookie_context(&url, true)))
    }

    pub fn cookies(&self) -> Vec<Cookie> {
        let url = self.url();
        self.session.with_cookies(|it| {
            it.matching(&url, &self.cookie_context(&url, true))
                .into_iter()
                .cloned()
                .collect()
        })
    }

    pub fn set_cookie(&self, text: &[u8]) -> bool {
        let url = self.url();
        !self.origin().is_opaque()
            && self
                .session
                .with_cookies(|it| it.receive(text, &url, &self.cookie_context(&url, true)))
    }

    /// `watcher` runs on this thread.
    pub fn watch_cookies(&self, watcher: fn(&Client, &cookies::Change)) {
        let (id, thread) = (self.id, Thread::current());
        let tell = move |change: &cookies::Change| {
            if change.cause != cookies::Cause::Overwrite && !change.cookie.is_http_only {
                let change = change.clone();
                thread.post(move || {
                    if let Some(client) =
                        Client::find(id).filter(|it| change.cookie.applies_to(&it.url()))
                    {
                        watcher(&client, &change);
                    }
                });
            }
        };
        self.session.watch_cookies(id.0, Some(Box::new(tell)));
    }

    /// Where a WebSocket connects to.
    pub fn check_web_socket(&self, url: Url) -> core::result::Result<Url, SocketRefusal> {
        let url = upgrade_insecure(&url)
            .filter(|_| self.upgrades_insecure_requests())
            .unwrap_or(url);
        if self.prohibits_mixed_content() && is_insecure(&url) {
            return Err(SocketRefusal::MixedContent);
        }
        let is_allowed = !has_bad_port(&url)
            && self.csp_allows_request(&url, Destination::Empty, &Metadata::default(), None);
        if is_allowed {
            Ok(url)
        } else {
            Err(SocketRefusal::Blocked)
        }
    }

    /// To a URL that `check_web_socket` has returned.
    pub fn connect_web_socket<'a>(
        &'a self,
        url: &'a Url,
        protocols: &'a [Bytes],
    ) -> LocalFuture<'a, Result<Connection>> {
        Box::pin(self.run_connect_web_socket(url, protocols))
    }

    async fn run_connect_web_socket(&self, url: &Url, protocols: &[Bytes]) -> Result<Connection> {
        struct Checked;
        impl Observer for Checked {}
        let (handshake, request) = Handshake::start(url, protocols);
        let (initiator, controller) = (self.initiator(), Controller::default());
        let response =
            fetch::fetch(&self.session, &initiator, request, &Checked, &controller).await;
        handshake.finish(response.map_err(|it| it.error)?, protocols)
    }

    /// https://html.spec.whatwg.org/multipage/document-lifecycle.html#abort-a-document
    pub fn abort_fetches(&self) {
        self.fetches.take().iter().for_each(Controller::abort);
        drop(self.preloaded.take());
    }

    pub fn dispose(self: &Rc<Self>) {
        self.is_disposed.set(true);
        self.abort_fetches();
        for (id, request) in self.deferred_requests.take() {
            self.cancel_deferred_fetch(id);
            Rc::clone(self).fetch_and_forget(request);
        }
        self.session.watch_cookies(self.id.0, None);
        self.unread_timings.lock().clear();
        drop((self.scripts.take(), self.timing_watcher.take()));
    }
}

fn disposition(is_enforced: bool, otherwise: &[u8]) -> Member {
    if is_enforced {
        b"enforce"[..].into()
    } else {
        otherwise.into()
    }
}
