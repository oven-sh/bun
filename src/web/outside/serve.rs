//! In the host.

use core::cell::RefCell;
use core::mem::ManuallyDrop;
use std::rc::Rc;

use bun_collections::HashMap;
use bun_ui::protocol::Lane;

use super::{Call, Deed, News, Return};
use crate::client::{Client, Twin, Update};
use crate::exec::{self, Either, Sender, oneshot, race};
use crate::headers::{is_cors_safelisted, is_forbidden_method, is_token};
use crate::net::embedder::ClientId;
use crate::net::fetch::Controller;
use crate::net::response::{Response, ResponseType};
use crate::origin::Origin;
use crate::remote::{self, Head, Kind, OF_PAGES, Peer};
use crate::request::{Destination, InitiatorType, Mode, Request};
use crate::wire::{self, Malformed};

const MOST_CALLS: usize = 1 << 16;
const MOST_CLIENTS: usize = 1 << 14;

#[derive(Default)]
struct Guest {
    /// By the ids that the process has for them.
    clients: HashMap<u32, Rc<Client>>,
    /// Dropping one ends the call.
    calls: HashMap<u32, Sender<()>>,
}

thread_local! {
    static GUESTS: ManuallyDrop<RefCell<HashMap<Peer, Guest>>> = ManuallyDrop::default();
}

fn with_guest<R>(peer: Peer, steps: impl FnOnce(&mut Guest) -> R) -> R {
    GUESTS.with(|it| steps(it.borrow_mut().entry(peer).or_default()))
}

/// The process may act as `client` until it says that it is done.
pub fn admit(peer: Peer, client: &Rc<Client>) {
    with_guest(peer, |it| it.clients.insert(client.id.0, Rc::clone(client)));
}

pub(crate) fn forget(peer: Peer) {
    let guest = GUESTS.with(|it| it.borrow_mut().remove(&peer));
    (guest.iter().flat_map(|it| it.clients.values())).for_each(Client::dispose);
}

fn tell(peer: Peer, client: u32, news: News) {
    remote::send(
        peer,
        Lane::Elsewhere,
        Head::new(Kind::News, client, 0),
        news,
    );
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
    let Some(client) = with_guest(from, |it| it.clients.get(&head.about).cloned()) else {
        return Ok(());
    };
    match deed {
        Deed::Cancel { .. } => {}
        Deed::Forget {} => {
            with_guest(from, |it| it.clients.remove(&head.about));
            client.dispose();
        }
        Deed::StartWorker {
            id: ClientId(id),
            url,
            headers,
            is_shared,
        } => {
            let is_own = url.scheme() == b"data"
                || Origin::of(&url).as_bytes() == client.origin().as_bytes();
            let has_room =
                |it: &mut Guest| it.clients.len() < MOST_CLIENTS && !it.clients.contains_key(&id);
            if id & OF_PAGES == 0 || !is_own || !with_guest(from, has_room) {
                return Err(Malformed);
            }
            let worker = Client::for_worker(client.seed_worker(url, &headers, is_shared));
            worker.worker_has_started();
            worker.set_twin(Rc::new(OfWorker(from, id)));
            with_guest(from, |it| it.clients.insert(id, worker));
        }
        Deed::WatchCookies {} => client.watch_cookies(|client, change| {
            client.update_twin(|| Update::Cookie(change.clone()));
        }),
    }
    Ok(())
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
    !matches!(request.mode, Mode::Navigate | Mode::WebSocket)
        && !matches!(
            request.destination,
            Destination::Document | Destination::Frame | Destination::Iframe
        )
        && is_token(&request.method)
        && !is_forbidden_method(&request.method)
        && request.cors_exempt_headers.iter().all(|it| is_exempt(it.0))
        && (request.mode != Mode::NoCors
            || (matches!(&*request.method, b"GET" | b"HEAD" | b"POST")
                && request.headers.iter().all(needs_no_cors)))
}

fn without_secrets(mut response: Response) -> Box<Response> {
    let is_hidden = response.head.kind == ResponseType::OpaqueRedirect;
    response.head.headers.retain(|name, _| {
        !is_hidden
            && !name.eq_ignore_ascii_case(b"set-cookie")
            && !name.eq_ignore_ascii_case(b"set-cookie2")
    });
    response.into()
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
            let Either::First(fetched) =
                race(client.fetch_for_twin(*request, &controller), report).await;
            guard.0 = None;
            Return::Fetch(fetched.map(without_secrets))
        }
        Call::Connect {
            url,
            protocols,
            frames,
        } => Return::Connect(client.connect_for_twin(url, &protocols, frames).await),
        Call::SourceOf { url } => Return::SourceOf(client.session.source_of(&url).await),
        Call::CookieString {} => Return::CookieString(client.cookie_string()),
        Call::Cookies {} => Return::Cookies(client.cookies()),
        Call::SetCookie { text } => Return::SetCookie(client.set_cookie(&text)),
    }
}

pub(crate) fn call(from: Peer, head: Head, mut call: Call) -> wire::Result<()> {
    let back = Head::new(Kind::Return, head.about, head.ticket);
    let mut outlives_process = false;
    match &mut call {
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
    let client = with_guest(from, |it| {
        if it.calls.len() >= MOST_CALLS || it.calls.contains_key(&head.ticket) {
            return Err(Malformed);
        }
        Ok(it.clients.get(&head.about).cloned())
    })?;
    let Some(client) = client else {
        remote::reply::<Return>(from, Lane::Elsewhere, back, None);
        return Ok(());
    };
    with_guest(from, |it| it.calls.insert(head.ticket, sender));
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
