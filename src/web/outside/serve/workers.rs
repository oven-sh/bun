//! Service workers, and what has to do with them.

use core::any::Any;
use core::sync::atomic::AtomicUsize;
use core::task::{Context, Poll};

use super::*;
use crate::csp::Metadata;
use crate::exec::{Receiver, Thread};
use crate::headers::is_valid_value;
use crate::net::NetError;
use crate::net::body::{Body, Budget, Read, Source};
use crate::net::response::Answer;
use crate::remote::kept_head;
use crate::service::far::{Happening, Lodger, Progress, Told};
use crate::service::{
    self, Busy, Event, Failure, Handler, Intercepted, Lodging, Notice, Outcome, Presence, Reserved,
    Running, Served, Start, Weight,
};
use crate::wire::Measured;

const MOST_IN_NOTIFICATION: usize = 256 << 10;

struct Lodged {
    started: Option<Sender<(Thread, bool)>>,
    ended: Box<dyn Fn()>,
    outside: service::Outside,
}

impl Drop for Lodged {
    fn drop(&mut self) {
        (self.ended)();
    }
}

/// An event.
struct Ongoing {
    client: u32,
    busy: Busy,
    result: Option<Sender<bool>>,
    answer: Option<Sender<Option<crate::net::Result<Served>>>>,
    navigation: Option<Request>,
    /// For as long as it matters that the request is aborted.
    interest: Option<Sender<()>>,
    is_handled: bool,
}

/// The worker runs while it is read.
struct Streamed(Body, Option<Busy>);

impl Source for Streamed {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let read = self.0.poll_read(cx);
        if matches!(read, Poll::Ready(Ok(None) | Err(_))) {
            self.1 = None;
        }
        read
    }

    fn expect_read_to_end(&mut self, budget: &'static Budget, read: &mut Vec<u8>) {
        self.0.expect_read_to_end(budget, read);
    }

    fn gathered(&self) -> u64 {
        self.0.gathered()
    }
}

/// About a process.
#[derive(Default)]
pub(super) struct Records {
    lodged: HashMap<u32, Lodged>,
    events: HashMap<u32, Ongoing>,
    presences: HashMap<u32, Arc<Presence>>,
    /// For workers that have yet to be started.
    reserved: VecDeque<(Url, Reserved)>,
    in_calls: Arc<AtomicUsize>,
}

impl Records {
    /// To be dropped when nothing is borrowed.
    pub(super) fn take_those_of(&mut self, client: u32) -> impl Any + use<> {
        let of_client = (self.events.iter()).filter(|it| it.1.client == client);
        let events = Vec::from_iter(of_client.map(|it| *it.0));
        (
            Vec::from_iter(events.iter().filter_map(|it| self.events.remove(it))),
            self.presences.remove(&client),
            self.lodged.remove(&client),
        )
    }

    pub(super) fn keep(&mut self, client: u32, presence: Option<Arc<Presence>>) {
        presence.map(|it| self.presences.insert(client, it));
    }

    pub(super) fn reserve(&mut self, head: &ResponseHead) {
        (self.reserved).extend(head.reserved.clone().map(|it| (head.url.clone(), it)));
        if self.reserved.len() > MOST_WORKERS {
            self.reserved.pop_front();
        }
    }

    pub(super) fn take_reserved(&mut self, id: u32, url: &Url) -> Option<Reserved> {
        let is_it = |it: &(Url, Reserved)| it.1.presence.id == id && it.0.href() == url.href();
        let at = self.reserved.iter().position(is_it)?;
        Some(self.reserved.remove(at)?.1)
    }
}

fn complete(peer: Peer, mut served: Served, busy: Busy) -> crate::net::Result<Served> {
    let body = core::mem::take(&mut served.answer.body);
    served.answer.body = Body::new(Streamed(body, Some(busy)));
    let Some(head) = kept_head(peer, served.kept_as) else {
        (served.answer.headers).retain(|name, _| !name.eq_ignore_ascii_case(b"set-cookie"));
        let is_sane = matches!(served.answer.status, 0 | 200..=599);
        return is_sane.then_some(served).ok_or(NetError::Failed);
    };
    let body = served.answer.body;
    Ok(Served {
        kind: Some(head.kind),
        url: Url::parse(head.url.without_fragment()),
        is_redirected: head.redirects > 0,
        allows_timing: head.allows_timing,
        includes_credentials: head.includes_credentials,
        has_credentials_mode_include: head.has_credentials_mode_include,
        kept_as: 0,
        answer: Answer::new(head.status, &head.status_text, head.headers, body),
    })
}

struct Stay {
    peer: Peer,
    client: ClientId,
    _lease: Box<dyn Any>,
}

impl Drop for Stay {
    fn drop(&mut self) {
        let head = Head::new(Kind::Lodger, self.client.0, 0);
        remote::send(self.peer, Lane::Scripts, head, Lodger::End);
        with_guest(self.peer, |it| {
            let lodged = it.of_workers.lodged.get_mut(&self.client.0);
            if let Some(it) = lodged {
                it.ended = Box::new(|| {});
            }
        });
        dismiss(self.peer, self.client);
    }
}

pub(crate) fn start(lodging: Lodging, start: Start) -> Option<Running> {
    let (peer, twin) = (lodging.peer, Client::for_worker(start.seed));
    let own = twin.as_service_worker()?;
    twin.move_out(true);
    if lodging.is_like_in_browser {
        twin.treat_like_in_browser();
    }
    twin.set_twin(Rc::new(OfWorker(peer, twin.id.0)));
    let order = Lodger::Start {
        seed: twin.seed(),
        ancestors: twin.ancestors(),
        own: Box::new((own.worker, own.registration)),
        is_module: start.is_module,
        source: start.source,
    };
    let (client, lodged) = (
        twin.id,
        Lodged {
            started: Some(start.started),
            ended: start.ended,
            outside: start.outside,
        },
    );
    GUESTS.with(|it| {
        let mut all = it.borrow_mut();
        let guest = all.get_mut(&peer).expect("it has just been leased");
        guest.of_workers.lodged.insert(client.0, lodged);
        guest.clients.insert(client.0, twin);
    });
    let head = Head::new(Kind::Lodger, client.0, 0);
    remote::send(peer, Lane::Scripts, head, order);
    Some(Box::new(Stay {
        peer,
        client,
        _lease: lodging.lease,
    }))
}

pub(super) fn has_started(peer: Peer, client: u32, handles_fetch: bool) {
    let started = with_guest(peer, |it| {
        it.of_workers.lodged.get_mut(&client)?.started.take()
    });
    if let Some(it) = started {
        it.send((Thread::current(), handles_fetch));
    }
}

pub(super) fn outside_of(peer: Peer, client: u32) -> Option<service::Outside> {
    with_guest(peer, |it| {
        Some(it.of_workers.lodged.get(&client)?.outside.clone())
    })
}

fn tell_worker(peer: Peer, client: u32, told: Told) -> bool {
    tell(peer, client, News::Update(Update::Service(told.into())))
}

async fn preload(peer: Peer, key: u32, number: u32, it: Receiver<crate::net::Result<Response>>) {
    let response = it.await.unwrap_or(Err(NetError::Failed));
    let response = response.map(|it| without_secrets(peer, it, Destination::Empty, true));
    tell_worker(peer, key, Told::Preloaded { number, response });
}

fn dispatch(peer: Peer, key: u32, twin: &Client, event: Event, busy: Busy) {
    let (number, mut preloading) = (remote::next_ticket(), None);
    let mut ongoing = Ongoing {
        client: key,
        busy,
        result: None,
        answer: None,
        navigation: None,
        interest: None,
        is_handled: false,
    };
    let event = match event {
        Event::Lifecycle(state, result) => {
            ongoing.result = Some(result);
            Happening::Lifecycle(state)
        }
        Event::Fetch(it) => {
            let Intercepted {
                mut request,
                client,
                resulting_client,
                preload,
                controller,
                answer,
            } = *it;
            if request.may_become_code {
                twin.was_asked_for_code(&request.url);
            }
            if let Some(starter) = &mut request.starter {
                starter.number = number;
                ongoing.navigation = Some(request.without_body());
            }
            with_guest(peer, |it| {
                let has_room = it.referrers.len() < MOST_REFERRERS;
                let foreign = (request.referrer.as_ref())
                    .filter(|it| has_room && !twin.origin().is_origin_of(it));
                foreign.map(|referrer| it.referrers.insert(hash_of(referrer), ()))
            });
            (request.cors_exempt_headers, request.blob) = Default::default();
            request.metadata = Metadata {
                integrity: request.metadata.integrity,
                ..Metadata::default()
            };
            let (interest, answered) = oneshot();
            (ongoing.answer, ongoing.interest) = (Some(answer), Some(interest));
            exec::spawn_background(async move {
                if let Either::Second(()) = race(answered, controller.aborted()).await {
                    tell_worker(peer, key, Told::Aborted(number));
                }
            });
            preloading = preload;
            Happening::Fetch {
                request: request.into(),
                client,
                resulting_client,
                has_preload: preloading.is_some(),
            }
        }
        Event::Message(source, message) => Happening::Message { source, message },
        Event::CookieChange(change) => Happening::CookieChange(change),
        Event::Notification { about, is_click } => Happening::Notification { about, is_click },
    };
    if tell_worker(peer, key, Told::Event { number, event }) {
        drop(with_guest(peer, |it| {
            it.of_workers.events.insert(number, ongoing)
        }));
        (preloading.into_iter())
            .for_each(|it| exec::spawn_background(preload(peer, key, number, it)));
    }
}

pub(super) fn listen(peer: Peer, key: u32, twin: &Rc<Client>) {
    let weak = Rc::downgrade(twin);
    twin.listen_to_service_workers(Rc::new(move |notice| {
        let Some(twin) = weak.upgrade() else { return };
        match notice {
            Notice::Event(event, busy) => dispatch(peer, key, &twin, event, busy),
            notice => _ = twin.update_twin(|| Update::Service(Told::Notice(notice).into())),
        }
    }));
}

pub(super) fn call(
    peer: Peer,
    twin: &Client,
    ticket: u32,
    Measured(call, size): Measured<service::Call>,
) -> wire::Result<()> {
    use service::Call;
    const TOO_MUCH: (Failure, &str) = (Failure::Quota, "That is too much.");
    let refusal = match &call {
        Call::PostToWorker(..) | Call::PostToClient(..) => None,
        Call::Preload(_, _, Some(value)) if !is_valid_value(value) => return Err(Malformed),
        Call::Navigate(_, url) if !url.is_http() && !service::is_allowed_at(url) => {
            Some((Failure::Type, "The URL cannot be navigated to."))
        }
        Call::ShowNotification(..) if size <= MOST_IN_NOTIFICATION => None,
        Call::ShowNotification(..) => Some((Failure::Type, "The notification is too large.")),
        _ => (size > wire::SMALL).then_some(TOO_MUCH),
    };
    let account = with_guest(peer, |it| Some(Arc::clone(&it.of_workers.in_calls)));
    let weigh = || account.and_then(|it| Weight::new(it, size)).ok_or(TOO_MUCH);
    match refusal.map_or_else(weigh, Err) {
        Ok(weight) => twin.call_service_workers_with(ticket, call, Some(weight.into())),
        Err((failure, why)) => {
            twin.notice(Notice::Settled(ticket, Outcome::Failed(failure, why)));
        }
    }
    Ok(())
}

pub(super) fn note_progress(peer: Peer, key: u32, number: u32, progress: Progress) {
    let over = with_guest(peer, |it| {
        let all = &mut it.of_workers;
        let event = all.events.get_mut(&number).filter(|it| it.client == key)?;
        match progress {
            Progress::Passed(has_passed) => event.result.take()?.send(has_passed),
            Progress::Answered(answer) => {
                event.interest = None;
                let (sender, busy) = (event.answer.take()?, event.busy.clone().without_limit());
                sender.send(answer.map(|it| it.and_then(|it| complete(peer, *it, busy))));
            }
            Progress::Handled => event.is_handled = true,
            Progress::Over => return all.events.remove(&number),
        }
        let is_over = event.is_handled && event.answer.is_none() && event.result.is_none();
        is_over.then(|| all.events.remove(&number))?
    });
    drop(over);
}

/// Puts what the host knows in the place of what the process refers to.
pub(super) fn identify(peer: Peer, key: u32, request: &mut Request) {
    let claimed = request.starter.take();
    with_guest(peer, |guest| {
        let Some(twin) = guest.clients.get(&key) else {
            return;
        };
        if let Some(Handler::Registration { client, .. }) = request.handler {
            let mut all = guest.clients.iter();
            let found = all.find(|it| *it.0 == client || it.1.id_for_service_workers() == client);
            let found = found.filter(|it| it.1.bucket() == twin.bucket());
            request.handler = Some(found.map(|it| it.1.initiator().service).unwrap_or_default());
        }
        if !twin.is_service_worker() {
            return;
        }
        let event = claimed.and_then(|it| guest.of_workers.events.get(&it.number));
        let known = (event.filter(|it| it.client == key)).and_then(|it| it.navigation.as_ref());
        if let Some(known) = known {
            let Request {
                url,
                method,
                starter,
                ..
            } = known.without_body();
            (request.url, request.method, request.starter) = (url, method, starter);
            (request.mode, request.redirect) = (known.mode, known.redirect);
            request.destination = Destination::Empty;
        }
        request.handler = Some(Handler::Nobody);
        let navigates = request.mode == Mode::Navigate || request.destination.is_navigation();
        if navigates && request.starter.is_none() {
            (request.mode, request.destination) = (Mode::SameOrigin, Destination::Empty);
        }
        if request.mode == Mode::NoCors {
            let is_ping = request.headers.get(b"content-type").as_deref() == Some(b"text/ping");
            if is_ping {
                request.initiator_type = Some(InitiatorType::Ping);
            }
            request.headers.retain(|name, value| {
                is_cors_safelisted(name, value)
                    || name.eq_ignore_ascii_case(b"range")
                    || (is_ping && name.eq_ignore_ascii_case(b"content-type"))
            });
        }
    });
}

/// Leaves what a request for a script needs.
pub(super) fn make_import(peer: Peer, key: u32, request: &mut Request) -> wire::Result<()> {
    let is_other = |it: &mut Guest| Some(!it.clients.get(&key)?.is_service_worker());
    let is_for_script = match request.destination {
        Destination::Script | Destination::Json | Destination::Style | Destination::Text => {
            !matches!(request.mode, Mode::Navigate | Mode::WebSocket)
        }
        Destination::ServiceWorker => request.mode == Mode::Cors,
        _ => false,
    };
    if with_guest(peer, is_other) == Some(true) || !is_for_script {
        return Err(Malformed);
    }
    let url = request.url.clone();
    *request = Request {
        referrer: request.referrer.take(),
        referrer_policy: request.referrer_policy,
        metadata: core::mem::take(&mut request.metadata),
        initiator_type: request.initiator_type,
        ..Request::new(url, request.destination, request.mode, request.credentials)
    };
    Ok(())
}
