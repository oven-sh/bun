//! For the clients and the workers that are in page processes. The registry talks to their twins.

use core::cell::RefCell;
use core::mem::ManuallyDrop;

use super::*;
use crate::HashMap;
use crate::client::Seed;
use crate::exec::{self, oneshot};
use crate::headers::HeaderList;
use crate::net::body::Body;
use crate::net::record::{RecordReader, RecordWriter};
use crate::outside::Outside as Host;
use crate::remote::HOST;
use crate::wire::{self, Malformed, Reader, Wire, Writer};

crate::wire!(impl never Event, Busy);
crate::wire!(impl WorkerInfo { id, url, state });
crate::wire!(impl RegistrationInfo { id, scope, update_via_cache, workers });
crate::wire!(impl WindowState { frame_type, is_visible, is_focused });
crate::wire!(impl ClientInfo { id, kind, url, ancestors, window });
crate::wire!(impl Subscription { name, url });
crate::wire!(impl Control { registration, worker });
crate::wire!(impl enum Source { Client(ClientInfo), Worker(WorkerInfo), });
crate::wire!(impl enum Failure { Type, Security, InvalidState, InvalidAccess, Abort, Quota, });
crate::wire!(impl enum Call by parts {
    Register { scope, script, is_module, update_via_cache },
    Update(id),
    Unregister(id),
    GetRegistration(url),
    GetRegistrations,
    Ready,
    PostToWorker(id, message),
    Preload(id, is_enabled, value),
    SkipWaiting,
    AddRoutes(rules),
    Claim,
    GetClient(id),
    MatchAll { includes_uncontrolled, kind },
    PostToClient(id, message),
    Navigate(id, url),
    Focus(id),
    Subscribe(id, all),
    Unsubscribe(id, all),
    GetSubscriptions(id),
    ShowNotification(id, it),
    GetNotifications(id, tag),
    CloseNotification(id),
});
crate::wire!(impl enum Outcome by parts {
    Done,
    Failed(failure, message),
    Registration(it),
    Registrations(all),
    Unregistered(it),
    Preload(is_enabled, value),
    Client(it),
    Navigated(it),
    Clients(all),
    Subscriptions(all),
    Notifications(all),
});
crate::wire!(impl enum Notice by parts {
    Settled(ticket, outcome),
    Registration(it),
    UpdateFound(id),
    State(id, state),
    Controller(it),
    Message(from, message),
    Event(event, busy),
});

impl Wire for Notification {
    fn write(self, to: &mut Writer) {
        [self.title, self.body, self.tag, self.lang].write(to);
        (self.urls, (self.id, self.timestamp)).write(to);
        (self.direction, self.is_silent).write(to);
        [self.renotifies, self.requires_interaction].write(to);
        self.values.into_iter().for_each(|it| it.write(to));
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Notification> {
        let [title, body, tag, lang] = Wire::read(from)?;
        let (urls, (id, timestamp)) = Wire::read(from)?;
        let (direction @ 0..3, is_silent) = Wire::read(from)? else {
            return Err(Malformed);
        };
        let [renotifies, requires_interaction] = Wire::read(from)?;
        Ok(Notification {
            id,
            title,
            body,
            tag,
            lang,
            urls,
            timestamp,
            direction,
            renotifies,
            is_silent,
            requires_interaction,
            tells_of_closing: false,
            values: [Wire::read(from)?, Wire::read(from)?, Wire::read(from)?],
        })
    }
}

impl Wire for Rule {
    fn write(self, to: &mut Writer) {
        let mut record = RecordWriter::default();
        Rule::write(&self, &mut record);
        to.put_bytes(&record.0);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Rule> {
        Rule::read(&mut RecordReader(from.take_bytes()?)).ok_or(Malformed)
    }
}

/// The host goes by what it knows of the client.
impl Wire for Handler {
    fn write(self, to: &mut Writer) {
        match self {
            Handler::Registration { client, .. } => Some(client),
            _ => None,
        }
        .write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Handler> {
        let of = |client| Handler::Registration { id: 0, client };
        Ok(Option::read(from)?.map_or(Handler::Nobody, of))
    }
}

impl Wire for Reserved {
    fn write(self, to: &mut Writer) {
        (self.presence.id, self.control).write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Reserved> {
        let (id, control) = Wire::read(from)?;
        let presence = Arc::new(Presence { session: None, id });
        match from.peer() {
            Some(HOST) => Ok(Reserved {
                presence,
                control,
                is_apart: true,
            }),
            _ => Err(Malformed),
        }
    }
}

impl Wire for Answer {
    fn write(self, to: &mut Writer) {
        ((self.status, self.status_text), (self.headers, self.body)).write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Answer> {
        let ((status, text), (headers, body)) = <((u16, Bytes), (HeaderList, Body))>::read(from)?;
        Ok(Answer::new(status, &text, headers, body))
    }
}

crate::wire!(impl Served {
    kind,
    url,
    is_redirected,
    allows_timing,
    includes_credentials,
    has_credentials_mode_include,
    kept_as,
    answer,
});

crate::wire! {
    pub enum Told {
        Notice(Notice),
        Event { number: u32, event: Happening },
        Aborted(u32),
        Preloaded { number: u32, response: Result<Box<Response>> },
    }

    pub enum Happening {
        Lifecycle(State),
        Fetch { request: Box<Request>, client: Option<Id>, resulting_client: Option<Id>, has_preload: bool },
        Message { source: Source, message: Message },
        CookieChange(Change),
        Notification { about: Box<Notification>, is_click: bool },
    }

    /// Of an event.
    pub enum Progress {
        Passed(bool),
        Answered(Option<Result<Box<Served>>>),
        Handled,
        Over,
    }

    /// For the main thread, about a worker that no page has started.
    pub enum Lodger {
        Start {
            seed: Box<Seed>,
            ancestors: Vec<Origin>,
            own: Box<(WorkerInfo, RegistrationInfo)>,
            is_module: bool,
            source: Option<SharedBytes>,
        },
        End,
    }
}

impl wire::Message for Lodger {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

/// An event that the host has sent.
#[derive(Clone, Copy)]
pub(super) struct Occasion(Host, u32);

impl Occasion {
    pub(super) fn report(self, progress: Progress) {
        self.0.report_progress(self.1, progress);
    }
}

/// What is still to come for the events of a worker.
#[derive(Default)]
struct Awaited {
    aborts: HashMap<u32, Controller>,
    preloads: HashMap<u32, Sender<Result<Response>>>,
}

static AWAITED: bun_ui::Lasting<RefCell<Awaited>> = bun_ui::Lasting::empty();

fn reply<T: 'static>(occasion: Occasion, busy: &Busy, progress: fn(T) -> Progress) -> Sender<T> {
    let ((sender, result), busy) = (oneshot(), busy.clone().without_limit());
    exec::spawn(async move {
        let result = result.await;
        AWAITED.with(|it| it.borrow_mut().aborts.remove(&occasion.1));
        if let Some(it) = result {
            occasion.report(progress(it));
        }
        drop(busy);
    });
    sender
}

fn event_of(occasion: Occasion, busy: &Busy, event: Happening) -> Event {
    match event {
        Happening::Lifecycle(state) => {
            Event::Lifecycle(state, reply(occasion, busy, Progress::Passed))
        }
        Happening::Fetch {
            request,
            client,
            resulting_client,
            has_preload,
        } => {
            let (controller, (sender, preload)) = (Controller::default(), oneshot());
            AWAITED.with(|it| {
                let mut it = it.borrow_mut();
                it.aborts.insert(occasion.1, controller.clone());
                has_preload.then(|| it.preloads.insert(occasion.1, sender))
            });
            Event::Fetch(Box::new(Intercepted {
                request: *request,
                client,
                resulting_client,
                preload: has_preload.then_some(preload),
                controller,
                answer: reply(occasion, busy, |it| {
                    Progress::Answered(it.map(|it| it.map(Box::new)))
                }),
            }))
        }
        Happening::Message { source, message } => Event::Message(source, message),
        Happening::CookieChange(change) => Event::CookieChange(change),
        Happening::Notification { about, is_click } => Event::Notification { about, is_click },
    }
}

/// On the thread of the client.
pub(crate) fn hear(client: &Client, host: Host, told: Told) {
    match told {
        Told::Notice(notice) => client.notice(notice),
        Told::Event { number, event } => {
            let occasion = Occasion(host, number);
            let busy = Busy {
                pending: Arc::new(Pending::Far(occasion)),
                _event: Some(Arc::new(Limit(Some(occasion)))),
            };
            client.notice(Notice::Event(event_of(occasion, &busy, event), busy));
        }
        Told::Aborted(number) => {
            let found = AWAITED.with(|it| it.borrow_mut().aborts.remove(&number));
            found.iter().for_each(Controller::abort);
        }
        Told::Preloaded { number, response } => {
            let found = AWAITED.with(|it| it.borrow_mut().preloads.remove(&number));
            if let Some(it) = found {
                it.send(response.map(|it| *it));
            }
        }
    }
}

static LODGERS: bun_ui::Lasting<ManuallyDrop<RefCell<HashMap<u32, Running>>>> =
    bun_ui::Lasting::empty();

pub fn obey(client: u32, order: Lodger) {
    let Lodger::Start {
        seed,
        ancestors,
        own,
        is_module,
        source,
    } = order
    else {
        let gone = LODGERS.with(|it| it.borrow_mut().remove(&client));
        return drop(gone);
    };
    let (host, (started, start)) = (Host::of(ClientId(client)), oneshot());
    let (worker, registration) = *own;
    let own = Own {
        client: ClientId(client),
        worker: worker.clone(),
        registration,
        imports: Arc::default(),
    };
    let seed = WorkerSeed::from_host(*seed, ancestors, own);
    let running = crate::dom::start_service_worker(Start {
        outside: Outside {
            host: Some(host),
            ..Outside::new(seed.session(), worker)
        },
        seed,
        is_module,
        source,
        started,
        ended: Box::new(move || host.forget()),
    });
    match running {
        Some(it) => drop(LODGERS.with(|all| all.borrow_mut().insert(client, it))),
        None => host.forget(),
    }
    exec::spawn_background(async move {
        if let Some((_, handles_fetch)) = start.await {
            host.announce_start(handles_fetch);
        }
    });
}
