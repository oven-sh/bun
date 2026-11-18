//! In the host.

mod shared;
pub(crate) mod workers;

use core::cell::RefCell;
use core::mem::ManuallyDrop;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use bun_ui::protocol::Lane;

use super::{Call, Deed, News, Return};
use crate::Bytes;
use crate::HashMap;
use crate::client::{Client, Twin, Update};
use crate::convert::resolve_blob_url;
use crate::exec::{self, Either, Sender, oneshot, race};
use crate::headers::{HeaderList, is_cors_safelisted, is_forbidden_method, is_token};
use crate::net::body::Blob;
use crate::net::embedder::ClientId;
use crate::net::fetch::Controller;
use crate::net::response::{Head as ResponseHead, Response, ResponseType};
use crate::net::session::Session;
use crate::origin::Origin;
use crate::remote::{self, Flags, Head, Kind, OF_PAGES, Peer, grants};
use crate::request::{Destination, InitiatorType, Mode, Request};
use crate::storage::areas::{self, Borrower, Whose};
use crate::url::Url;
use crate::wire::{self, Malformed};

const LONGEST_BLOB_URL: usize = 512;
const MOST_BLOB_URLS: usize = 1 << 16;
const MOST_CALLS: usize = 1 << 16;
const MOST_CLIENTS: usize = 1 << 14;
const MOST_REFERRERS: usize = 1 << 16;
const MOST_WORKERS: usize = 1 << 8;

#[derive(Default)]
struct Guest {
    /// By the ids that the process has for them.
    clients: HashMap<u32, Rc<Client>>,
    /// Of those that are documents.
    tabs: HashMap<u32, u32>,
    /// Style sheets and scripts, which load more.
    referrers: HashMap<u64, ()>,
    /// The scripts that they start with.
    workers: VecDeque<(Url, HeaderList)>,
    /// And the clients that have made them.
    blob_urls: HashMap<Bytes, u32>,
    wanted_blobs: HashMap<u32, (u32, Sender<Blob>)>,
    /// Dropping one ends the call.
    calls: HashMap<u32, Sender<()>>,
    of_workers: workers::Records,
}

static GUESTS: bun_ui::Lasting<ManuallyDrop<RefCell<HashMap<Peer, Guest>>>> =
    bun_ui::Lasting::empty();

pub(crate) fn begin(peer: Peer) {
    GUESTS.with(|it| it.borrow_mut().insert(peer, Guest::default()));
}

fn with_guest<R: Default>(peer: Peer, steps: impl FnOnce(&mut Guest) -> R) -> R {
    GUESTS.with(|it| {
        it.borrow_mut()
            .get_mut(&peer)
            .map(steps)
            .unwrap_or_default()
    })
}

/// The process may act as `client`.
pub fn admit(peer: Peer, client: &Rc<Client>, tab: u32) {
    with_guest(peer, |it| {
        it.clients.insert(client.id.0, Rc::clone(client));
        it.tabs.insert(client.id.0, tab);
    });
}

pub fn dismiss(peer: Peer, client: ClientId) {
    let known = GUESTS.with(|it| {
        let mut all = it.borrow_mut();
        let guest = all.get_mut(&peer)?;
        guest.tabs.remove(&client.0);
        guest.blob_urls.retain(|_, maker| *maker != client.0);
        guest.wanted_blobs.retain(|_, it| it.0 != client.0);
        let gone = guest.clients.remove(&client.0)?;
        let (session, bucket) = (gone.session.id(), gone.bucket());
        let is_same = |it: &Rc<Client>| it.session.id() == session && it.bucket() == bucket;
        if !guest.clients.values().any(is_same) {
            let used = Vec::from_iter(
                guest
                    .clients
                    .values()
                    .map(|it| (it.session.id(), it.bucket())),
            );
            grants::keep_only_shelves(peer, |it| {
                (used.iter()).any(|used| used.0 == it.session && *used.1 == *it.bucket)
            });
        }
        Some((gone, guest.of_workers.take_those_of(client.0)))
    });
    (known.iter()).for_each(|it| it.0.dispose());
}

fn borrower(peer: Peer, client: &Client, is_local: bool) -> Option<Borrower> {
    let tab = with_guest(peer, |it| it.tabs.get(&client.id.0).copied())?;
    (!client.origin().is_opaque()).then(|| Borrower {
        peer,
        whose: match is_local {
            true => Whose::Session(client.session.id()),
            false => Whose::Tab(tab),
        },
        storage: Arc::clone(&client.session.storage),
        bucket: client.bucket(),
    })
}

pub(crate) fn forget(peer: Peer) {
    shared::forget(peer);
    let guest = GUESTS.with(|it| it.borrow_mut().remove(&peer));
    (guest.iter().flat_map(|it| it.clients.values())).for_each(Client::dispose);
}

fn tell(peer: Peer, client: u32, news: News) -> bool {
    let head = Head::new(Kind::News, client, 0);
    remote::send(peer, Lane::Elsewhere, head, news)
}

struct OfWorker(Peer, u32);

impl Twin for OfWorker {
    fn update(&self, update: Update) {
        tell(self.0, self.1, News::Update(update));
    }
}

pub(crate) fn deed(from: Peer, head: Head, deed: Deed) -> wire::Result<()> {
    if let Deed::Cancel { ticket } = deed {
        drop(with_guest(from, |it| it.calls.remove(&ticket)));
        return Ok(());
    }
    if let Deed::LendBlob { ticket, blob } = deed {
        let wanted = with_guest(from, |it| it.wanted_blobs.remove(&ticket));
        (wanted.zip(blob).into_iter()).for_each(|(wanted, blob)| wanted.1.send(blob));
        return Ok(());
    }
    if let Deed::ConnectToSharedWorker { worker, port } = deed {
        shared::connect((from, worker), port);
        return Ok(());
    }
    if let Deed::LeaveSharedWorker { worker, has_failed } = deed {
        shared::leave((from, worker), has_failed);
        return Ok(());
    }
    let Some(client) = with_guest(from, |it| it.clients.get(&head.about).cloned()) else {
        return Ok(());
    };
    match deed {
        Deed::Cancel { .. }
        | Deed::LendBlob { .. }
        | Deed::ConnectToSharedWorker { .. }
        | Deed::LeaveSharedWorker { .. } => {}
        Deed::AnnounceBlobUrl { url, is_revoked } => with_guest(from, |it| {
            if is_revoked {
                it.blob_urls.remove(url.href());
            } else if it.blob_urls.len() < MOST_BLOB_URLS
                && url.href().len() <= LONGEST_BLOB_URL
                && client.origin().is_origin_of(&url)
            {
                it.blob_urls.insert(url.href().into(), head.about);
            }
        }),
        Deed::Forget {} => dismiss(from, ClientId(head.about)),
        Deed::WatchAreas {} => ([true, false].iter())
            .filter_map(|it| borrower(from, &client, *it))
            .for_each(|it| areas::watch(&it)),
        Deed::ChangeArea {
            is_local,
            change,
            number,
        } => (borrower(from, &client, is_local).iter())
            .for_each(|it| areas::change(it, &change, number, client.url().href())),
        Deed::StartWorker {
            id: ClientId(id),
            url,
            is_shared,
            reserved,
        } => {
            let is_own = url.scheme() == b"data"
                || Origin::of(&url).as_bytes() == client.origin().as_bytes();
            let has_room =
                |it: &mut Guest| it.clients.len() < MOST_CLIENTS && !it.clients.contains_key(&id);
            if id & OF_PAGES == 0 || !is_own || !with_guest(from, has_room) {
                return Err(Malformed);
            }
            let headers = with_guest(from, |guest| {
                let known = guest.workers.iter().find(|it| it.0.href() == url.href());
                known.map(|it| it.1.clone())
            });
            let Some(headers) = headers.or_else(|| (!url.is_http()).then(HeaderList::default))
            else {
                return Ok(());
            };
            let reserved = with_guest(from, |it| it.of_workers.take_reserved(reserved?, &url));
            let seed = client.seed_worker(url, &headers, is_shared, reserved);
            with_guest(from, |it| it.of_workers.keep(id, seed.presence()));
            let worker = Client::for_worker(seed);
            worker.worker_has_started();
            worker.set_twin(Rc::new(OfWorker(from, id)));
            with_guest(from, |it| it.clients.insert(id, worker));
        }
        Deed::ListenToServiceWorkers {} => workers::listen(from, head.about, &client),
        Deed::CallServiceWorkers { ticket, call } => {
            return workers::call(from, &client, ticket, call);
        }
        Deed::AnnounceStart { handles_fetch } => {
            workers::has_started(from, head.about, handles_fetch);
        }
        Deed::ReportProgress { event, progress } => {
            workers::note_progress(from, head.about, event, progress);
        }
        Deed::Log {
            level,
            message,
            line,
            url,
        } => (workers::outside_of(from, head.about))
            .map_or((), |it| it.log(level, message, line, url)),
        Deed::WatchCookies {} => client.watch_cookies(Client::tell_twin_of_cookie),
    }
    Ok(())
}

/// What a page process has made a URL for.
pub(crate) async fn borrow_blob(session: &Arc<Session>, url: &Url) -> Option<Blob> {
    const PATIENCE: Duration = Duration::from_secs(30);
    let (ticket, (sender, lent)) = (remote::next_ticket(), oneshot());
    let (peer, client) = GUESTS.with(|it| {
        let mut all = it.borrow_mut();
        let (peer, guest, client) = all.iter_mut().find_map(|(peer, guest)| {
            let client = *guest.blob_urls.get(url.without_fragment())?;
            let is_familiar = Arc::ptr_eq(&guest.clients.get(&client)?.session, session);
            is_familiar.then_some((*peer, guest, client))
        })?;
        guest.wanted_blobs.insert(ticket, (client, sender));
        Some((peer, client))
    })?;
    let url = url.clone();
    tell(peer, client, News::WantsBlob { ticket, url });
    let lent = race(lent, exec::sleep(PATIENCE)).await;
    drop(with_guest(peer, |it| it.wanted_blobs.remove(&ticket)));
    match lent {
        Either::First(blob) => blob,
        Either::Second(()) => None,
    }
}

/// Whether a page that goes by the rules could have made it.
fn is_allowed(request: &Request) -> bool {
    let is_exempt = |name: &[u8]| {
        matches!(
            &*name.to_ascii_lowercase(),
            b"accept"
                | b"cache-control"
                | b"last-event-id"
                | b"ping-from"
                | b"ping-to"
                | b"sec-purpose"
        )
    };
    let needs_no_cors = |(name, value): (&[u8], &[u8])| {
        is_cors_safelisted(name, value)
            || name.eq_ignore_ascii_case(b"range")
            || (name.eq_ignore_ascii_case(b"content-type")
                && match value {
                    b"application/csp-report" => request.destination == Destination::Report,
                    b"text/ping" => request.initiator_type == Some(InitiatorType::Ping),
                    _ => false,
                })
    };
    let navigates = request.mode == Mode::Navigate
        || matches!(
            request.destination,
            Destination::Document | Destination::Frame | Destination::Iframe
        );
    request.mode != Mode::WebSocket
        && request.destination != Destination::ServiceWorker
        && (!navigates || request.starter.is_some())
        && is_token(&request.method)
        && !is_forbidden_method(&request.method)
        && request.cors_exempt_headers.iter().all(|it| is_exempt(it.0))
        && (request.mode != Mode::NoCors
            || (matches!(&*request.method, b"GET" | b"HEAD" | b"POST")
                && request.headers.iter().all(needs_no_cors)))
}

/// With `is_object`, scripts can pass it on.
fn without_secrets(
    peer: Peer,
    mut response: Response,
    destination: Destination,
    is_object: bool,
) -> Box<Response> {
    if is_object && response.head.kind != ResponseType::Basic {
        remote::keep_head(peer, &mut response.head);
    }
    response.head.hide_secrets(destination);
    response.into()
}

fn hash_of(url: &Url) -> u64 {
    bun_wyhash::hash(url.without_fragment())
}

impl Guest {
    fn note(&mut self, destination: Destination, response: &Response) {
        let url = &response.head.url;
        match destination {
            Destination::Worker | Destination::SharedWorker => {
                self.workers.retain(|it| it.0.href() != url.href());
                (self.workers).push_back((url.clone(), response.head.headers.clone()));
                if self.workers.len() > MOST_WORKERS {
                    self.workers.pop_front();
                }
                self.of_workers.reserve(&response.head);
            }
            Destination::Style | Destination::Script if self.referrers.len() < MOST_REFERRERS => {
                self.referrers.insert(hash_of(url), ());
            }
            _ => {}
        }
    }
}

struct AbortsUnlessDone(Option<Controller>);

impl Drop for AbortsUnlessDone {
    fn drop(&mut self) {
        self.0.iter().for_each(Controller::abort);
    }
}

async fn perform(from: Peer, head: Head, client: Rc<Client>, call: Call) -> Return {
    match call {
        Call::Fetch {
            request,
            reports_upload,
        } => {
            let controller = match reports_upload {
                true => Controller::with_upload_progress(),
                false => Controller::default(),
            };
            let report = async {
                while let Some(progress) = &controller.upload {
                    let (ticket, bytes) = (head.ticket, progress.changed().await);
                    tell(from, head.about, News::Uploaded { ticket, bytes });
                }
                core::future::pending::<core::convert::Infallible>().await
            };
            let mut guard = AbortsUnlessDone(Some(controller.clone()));
            let destination = request.destination;
            let Either::First(fetched) =
                race(client.fetch_for_twin(*request, &controller), report).await;
            guard.0 = None;
            let note = |it: &_| {
                let note = |guest: &mut Guest| guest.note(destination, it);
                GUESTS.with(|all| all.borrow_mut().get_mut(&from).map_or((), note));
            };
            let is_object = destination == Destination::Empty || client.is_service_worker();
            let hide = |it| without_secrets(from, it, destination, is_object);
            Return::Fetch(fetched.inspect(note).map(hide))
        }
        Call::Connect {
            url,
            protocols,
            frames,
        } => Return::Connect(client.connect_for_twin(url, &protocols, frames.0).await),
        Call::SourceOf { url } if !client.origin().is_origin_of(&url) => Return::SourceOf(Ok(None)),
        Call::SourceOf { url } => Return::SourceOf(client.session.source_of(&url).await),
        Call::CookieString {} if client.origin().is_opaque() => {
            Return::CookieString(Default::default())
        }
        Call::Cookies { .. } if client.origin().is_opaque() => Return::Cookies(Vec::new()),
        Call::BorrowArea { is_local } => Return::BorrowArea(
            (borrower(from, &client, is_local).map(|it| areas::lend(&it))).unwrap_or_default(),
        ),
        Call::CookieString {} => {
            client.watch_cookie_string(move || remote::outdate(from));
            let expiries = client.cookies(None).into_iter().filter_map(|it| it.expires);
            let until = expiries.fold(f64::MAX, f64::min);
            Return::CookieString((client.cookie_string(), until))
        }
        Call::Cookies { url } => {
            let scope = client.as_service_worker().map(|it| it.registration.scope);
            let is_own = |it: &Url| scope.is_some_and(|scope| it.href().starts_with(scope.href()));
            Return::Cookies(client.cookies(url.filter(is_own)))
        }
        Call::Import { request } => Return::Import(client.load_script(*request).await.map(|it| {
            let mut it = Box::new(it);
            it.head.hide_secrets(Destination::Script);
            it
        })),
        Call::ClaimSharedWorker {
            worker,
            url,
            name,
            options,
        } => {
            let key = [&client.partition_key(), url.href(), &name].join(&b'\n');
            Return::ClaimSharedWorker(shared::claim((from, worker), &client, key.into(), options))
        }
        Call::MayNotify {} => Return::MayNotify(match workers::outside_of(from, head.about) {
            Some(it) => it.may_notify().await,
            None => false,
        }),
        Call::SetCookie { text } => Return::SetCookie(client.set_cookie_for_twin(&text)),
    }
}

pub(crate) fn call(from: Peer, head: Head, mut call: Call) -> wire::Result<()> {
    let back = Head::new(Kind::Return, head.about, head.ticket);
    let mut outlives_process = false;
    match &mut call {
        Call::Fetch { request, .. } => workers::identify(from, head.about, request),
        Call::Import { request } => workers::make_import(from, head.about, request)?,
        _ => {}
    }
    match &mut call {
        call if call.is_harmless() != head.flags.contains(Flags::HARMLESS) => {
            return Err(Malformed);
        }
        Call::Fetch { request, .. } if !is_allowed(request) => return Err(Malformed),
        Call::Fetch { request, .. } => {
            (request.blob, request.has_user_activation) = (None, false);
            outlives_process = request.keepalive;
        }
        Call::Connect { url, protocols, .. }
            if !matches!(url.scheme(), b"ws" | b"wss")
                || !protocols.iter().all(|it| is_token(it)) =>
        {
            return Err(Malformed);
        }
        _ => {}
    }
    let (sender, canceled) = oneshot();
    if with_guest(from, |it| {
        it.calls.len() >= MOST_CALLS || it.calls.contains_key(&head.ticket)
    }) {
        return Err(Malformed);
    }
    let Some(client) = with_guest(from, |it| it.clients.get(&head.about).cloned()) else {
        remote::reply::<Return>(from, Lane::Elsewhere, back, None);
        return Ok(());
    };
    with_guest(from, |guest| {
        if let Call::Fetch { request, .. } | Call::Import { request } = &mut call {
            if request.url.scheme() == b"blob" && client.origin().is_origin_of(&request.url) {
                request.blob = resolve_blob_url(&request.url);
            }
            let is_familiar = |it: &mut Url| {
                client.origin().is_origin_of(it)
                    || client
                        .referrer_source()
                        .is_some_and(|own| own.href() == it.href())
                    || guest.referrers.contains_key(&hash_of(it))
            };
            request.referrer = request.referrer.take_if(is_familiar);
        }
        guest.calls.insert(head.ticket, sender)
    });
    exec::spawn_background(async move {
        let canceled = async {
            canceled.await;
            if outlives_process && GUESTS.with(|it| !it.borrow().contains_key(&from)) {
                core::future::pending::<()>().await;
            }
        };
        if let Either::First(result) = race(perform(from, head, client, call), canceled).await {
            let is_there =
                GUESTS.with(|it| it.borrow_mut().get_mut(&from)?.calls.remove(&head.ticket));
            if is_there.is_some() {
                remote::reply(from, Lane::Elsewhere, back, Some(result));
            }
        }
    });
    Ok(())
}
