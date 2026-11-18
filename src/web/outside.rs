//! What a page process asks of the host from any thread, for a [`Client`](crate::client::Client). The host goes by
//! its own record of the client.

pub mod serve;

use core::future::Future;
use core::pin::Pin;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::{Context, Poll, Waker};
use std::sync::Arc;
use std::task::Wake;

use bun_collections::HashMap;
use bun_threading::{Futex, Guarded};
use bun_ui::protocol::Lane;

use crate::Bytes;
use crate::client::{Client, Update};
use crate::exec::{Receiver, Sender, Thread, oneshot};
use crate::headers::HeaderList;
use crate::net::body::Body;
use crate::net::cookies::Cookie;
use crate::net::embedder::ClientId;
use crate::net::response::Response;
use crate::net::web_socket::Accepted;
use crate::net::{Progress, Result};
use crate::remote::{self, HOST, Head, Kind};
use crate::request::Request;
use crate::url::Url;
use crate::wire;

macro_rules! calls {
    (
        tell {
            $($(#[doc = $of_deed:literal])* $(#[size = $told:ident])? $Deed:ident = $deed:ident ($($d:ident: $D:ty),*);)*
        }
        call {
            $($(#[doc = $of_call:literal])* $(#[size = $called:ident])? $Call:ident = $call:ident ($($c:ident: $C:ty),*) -> $Returned:ty;)*
        }
    ) => {
        crate::wire! {
            pub enum Deed {
                $($Deed { $($d: $D),* },)*
            }

            pub enum Call {
                $($Call { $($c: $C),* },)*
            }

            pub enum Return {
                $($Call($Returned),)*
            }
        }

        impl wire::Message for Deed {
            fn most_bytes(kind: u16) -> usize {
                let all = [$(crate::most_bytes!($($told)?),)*];
                all.get(usize::from(kind)).copied().unwrap_or_default()
            }
        }

        impl wire::Message for Call {
            fn most_bytes(kind: u16) -> usize {
                let all = [$(crate::most_bytes!($($called)?),)*];
                all.get(usize::from(kind)).copied().unwrap_or_default()
            }
        }

        impl Outside {
            $($(#[doc = $of_deed])* pub(crate) fn $deed(self, $($d: $D),*) {
                self.tell(Deed::$Deed { $($d),* });
            })*

            $($(#[doc = $of_call])* pub(crate) fn $call(self, $($c: $C),*) -> Pending<$Returned> {
                self.call(Call::$Call { $($c),* }, |it| match it {
                    Return::$Call(it) => Some(it),
                    _ => None,
                })
            })*
        }
    };
}

calls! {
    tell {
        /// A call whose result is no longer wanted.
        Cancel = cancel(ticket: u32);
        Forget = forget();
        StartWorker = start_worker(id: ClientId, url: Url, headers: HeaderList, is_shared: bool);
        WatchCookies = watch_cookies();
    }
    call {
        #[size = large]
        Fetch = fetch(request: Box<Request>, reports_upload: bool) -> Result<Box<Response>>;
        Connect = connect(url: Url, protocols: Vec<Bytes>, frames: Body) -> Result<Accepted>;
        SourceOf = source_of(url: Url) -> Result<Option<Vec<u8>>>;
        CookieString = cookie_string() -> Vec<u8>;
        Cookies = cookies() -> Vec<Cookie>;
        SetCookie = set_cookie(text: Vec<u8>) -> bool;
    }
}

impl wire::Message for Return {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

crate::wire! {
    pub enum News {
        Uploaded { ticket: u32, bytes: u64 },
        Update(Update),
    }
}

impl wire::Message for News {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

#[derive(Default)]
struct Expected {
    returns: HashMap<u32, Sender<Return>>,
    uploads: Vec<(u32, Progress)>,
    threads: HashMap<u32, Thread>,
}

fn expected() -> &'static Guarded<Expected> {
    static EXPECTED: std::sync::OnceLock<Guarded<Expected>> = std::sync::OnceLock::new();
    EXPECTED.get_or_init(Guarded::default)
}

#[derive(Clone, Copy)]
pub(crate) struct Outside(ClientId);

impl Outside {
    /// On the thread of the client.
    pub(crate) fn enter(client: ClientId) -> Outside {
        (expected().lock().threads).insert(client.0, Thread::current());
        Outside(client)
    }

    pub(crate) fn leave(self) {
        if expected().lock().threads.remove(&self.0.0).is_some() {
            self.forget();
        }
    }

    fn tell(self, deed: Deed) {
        let head = Head::new(Kind::Deed, self.0.0, 0);
        remote::send(HOST, Lane::Elsewhere, head, deed);
    }

    fn send_call(self, call: Call) -> (u32, Receiver<Return>) {
        let (ticket, (sender, receiver)) = (remote::next_ticket(), oneshot());
        expected().lock().returns.insert(ticket, sender);
        let head = Head::new(Kind::Call, self.0.0, ticket);
        if !remote::send(HOST, Lane::Elsewhere, head, call) {
            returned(ticket, None);
        }
        (ticket, receiver)
    }

    fn call<T>(self, call: Call, pick: fn(Return) -> Option<T>) -> Pending<T> {
        let (ticket, receiver) = self.send_call(call);
        Pending {
            by: self,
            ticket,
            receiver,
            pick,
        }
    }
}

/// `None` if the host has refused.
pub(crate) struct Pending<T> {
    by: Outside,
    ticket: u32,
    receiver: Receiver<Return>,
    pick: fn(Return) -> Option<T>,
}

impl<T> Future for Pending<T> {
    type Output = Option<T>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        let pick = self.pick;
        Pin::new(&mut self.receiver).poll(cx).map(|it| pick(it?))
    }
}

impl<T> Pending<T> {
    /// For what the host answers whatever else it is doing.
    pub(crate) fn wait(mut self) -> Option<T> {
        struct Parked(AtomicU32);
        impl Wake for Parked {
            fn wake(self: Arc<Self>) {
                self.0.store(1, Ordering::Release);
                Futex::wake(&self.0, 1);
            }
        }
        let parked = Arc::new(Parked(AtomicU32::new(0)));
        let waker = Waker::from(Arc::clone(&parked));
        loop {
            if let Poll::Ready(value) = Pin::new(&mut self).poll(&mut Context::from_waker(&waker)) {
                return value;
            }
            Futex::wait_forever(&parked.0, 0);
            parked.0.store(0, Ordering::Release);
        }
    }

    pub(crate) fn report_upload_to(&self, progress: Progress) {
        expected().lock().uploads.push((self.ticket, progress));
    }
}

impl<T> Drop for Pending<T> {
    fn drop(&mut self) {
        let mut expected = expected().lock();
        expected.uploads.retain(|it| it.0 != self.ticket);
        let unanswered = expected.returns.remove(&self.ticket);
        drop(expected);
        if unanswered.is_some() {
            self.by.cancel(self.ticket);
        }
    }
}

pub(crate) fn returned(ticket: u32, value: Option<Return>) {
    let sender = expected().lock().returns.remove(&ticket);
    if let Some((sender, value)) = sender.zip(value) {
        sender.send(value);
    }
}

pub(crate) fn hear(client: u32, news: News) {
    let expected = expected().lock();
    match news {
        News::Uploaded { ticket, bytes } => (expected.uploads.iter())
            .filter(|it| it.0 == ticket)
            .for_each(|it| it.1.report(bytes)),
        News::Update(update) => {
            if let Some(thread) = expected.threads.get(&client) {
                thread
                    .post(move || Client::find(ClientId(client)).map_or((), |it| it.apply(update)));
            }
        }
    }
}
