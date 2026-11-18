//! A [`Body`] that is read in another process. No more is sent than has been asked for.

use core::future::poll_fn;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::{Context, Poll, Waker};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

use bun_threading::Guarded;
use bun_ui::protocol::Lane;

use super::{HOST, Head, Kind, Peer, send, send_bytes};
use crate::exec::{self, Either, Waiter, race};
use crate::net::body::{Body, Budget, Chunk, Read, Share, SharedBytes, Source};
use crate::net::{NetError, Result};
use crate::wire::{self, Malformed, Reader, Wire, Writer};

const WINDOW: usize = 1 << 20;
const MOST_IN_CHUNK: usize = 256 << 10;
const MOST_BODIES: usize = 1 << 14;

crate::wire! {
    #[derive(Clone, Copy)]
    pub(crate) enum About {
        /// From who sends it.
        End(Result<()>),
        /// From who reads it.
        More(u32),
        Enough,
    }
}

impl wire::Message for About {
    fn most_bytes(_: u16) -> usize {
        16
    }
}

fn tell(peer: Peer, id: u32, about: About) {
    send(peer, Lane::Elsewhere, Head::new(Kind::Body, id, 0), about);
}

#[derive(Default)]
struct Wanted {
    bytes: usize,
    is_enough: bool,
    sender: Waiter,
}

#[derive(Default)]
struct Arrived {
    chunks: VecDeque<Chunk>,
    /// What has been asked for and has not arrived.
    expected: usize,
    length: usize,
    share: Option<Share>,
    end: Option<Result<()>>,
    reader: Waiter,
}

type Table<T> = Guarded<BTreeMap<(Peer, u32), Arc<Guarded<T>>>>;

static LEAVING: Table<Wanted> = Guarded::new(BTreeMap::new());
static ARRIVING: Table<Arrived> = Guarded::new(BTreeMap::new());

fn find<T>(table: &Table<T>, key: (Peer, u32)) -> Option<Arc<Guarded<T>>> {
    table.lock().get(&key).cloned()
}

/// Says that it is cut short if it is dropped before the end.
struct Leaving {
    key: (Peer, u32),
    wanted: Arc<Guarded<Wanted>>,
    end: Result<()>,
}

impl Drop for Leaving {
    fn drop(&mut self) {
        LEAVING.lock().remove(&self.key);
        tell(self.key.0, self.key.1, About::End(self.end));
    }
}

impl Leaving {
    /// How many bytes. `None` if there is no reader.
    async fn wanted(&self) -> Option<usize> {
        poll_fn(|cx| match &mut *self.wanted.lock() {
            it if it.is_enough => Poll::Ready(None),
            it if it.bytes > 0 => Poll::Ready(Some(it.bytes)),
            it => it.sender.pending(cx),
        })
        .await
    }

    async fn abandoned(&self) {
        poll_fn(|cx| match &mut *self.wanted.lock() {
            it if it.is_enough => Poll::Ready(()),
            it => it.sender.pending(cx),
        })
        .await;
    }

    async fn send(mut self, mut body: Body, mut reads_ahead: bool) {
        let (head, mut bytes) = (Head::new(Kind::Chunk, self.key.1, 0).to_bytes(), Vec::new());
        while core::mem::take(&mut reads_ahead) || self.wanted().await.is_some() {
            let chunk = match race(body.read(), self.abandoned()).await {
                Either::First(Ok(Some(chunk))) => chunk,
                Either::First(end) => return self.end = end.map(drop),
                Either::Second(()) => return,
            };
            let mut left = &*chunk;
            while !left.is_empty() {
                let Some(wanted) = self.wanted().await else {
                    return;
                };
                let (now, later) = left.split_at(left.len().min(wanted).min(MOST_IN_CHUNK));
                self.wanted.lock().bytes -= now.len();
                bytes.clear();
                bytes.extend_from_slice(&head);
                bytes.extend_from_slice(now);
                send_bytes(self.key.0, Lane::Elsewhere, &bytes);
                left = later;
            }
        }
    }
}

struct Arriving {
    key: (Peer, u32),
    arrived: Arc<Guarded<Arrived>>,
    window: usize,
}

impl Arriving {
    fn ask_for_more(&self, it: &mut Arrived) -> Option<u32> {
        let more = self.window.saturating_sub(it.expected + it.length);
        (it.end.is_none() && more >= self.window / 2).then(|| {
            it.expected += more;
            more as u32
        })
    }
}

impl Source for Arriving {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let mut it = self.arrived.lock();
        let read = match (it.chunks.pop_front(), it.end) {
            (Some(chunk), _) => {
                it.length -= chunk.len();
                Poll::Ready(Ok(Some(chunk)))
            }
            (None, Some(end)) => Poll::Ready(end.map(|()| None)),
            (None, None) => it.reader.pending(cx),
        };
        let more = self.ask_for_more(&mut it);
        drop(it);
        (more.into_iter()).for_each(|it| tell(self.key.0, self.key.1, About::More(it)));
        read
    }

    fn expect_read_to_end(&mut self, budget: &'static Budget, _: &mut Vec<u8>) {
        let mut it = self.arrived.lock();
        if it.end.is_none() && it.share.is_none() {
            (it.share, self.window) = (Some(Share::of(budget)), 16 * WINDOW);
        }
    }
}

impl Drop for Arriving {
    fn drop(&mut self) {
        if self.arrived.lock().end.is_none() {
            ARRIVING.lock().remove(&self.key);
            tell(self.key.0, self.key.1, About::Enough);
        }
    }
}

fn end(key: (Peer, u32), how: Result<()>) {
    let found = ARRIVING.lock().remove_entry(&key);
    if let Some((_, arrived)) = found {
        let mut it = arrived.lock();
        it.end.get_or_insert(how);
        it.reader.wake();
    }
}

pub(super) fn accept(from: Peer, id: u32, about: About) {
    let change = |change: &dyn Fn(&mut Wanted)| {
        if let Some(wanted) = find(&LEAVING, (from, id)) {
            let it = &mut *wanted.lock();
            change(it);
            it.sender.wake();
        }
    };
    match about {
        About::End(how) => end((from, id), how),
        About::More(bytes) => change(&|it| it.bytes = (it.bytes + bytes as usize).min(16 * WINDOW)),
        About::Enough => change(&|it| it.is_enough = true),
    }
}

pub(super) fn accept_chunk(from: Peer, id: u32, message: Vec<u8>, at: usize) -> wire::Result<()> {
    let Some(arrived) = find(&ARRIVING, (from, id)) else {
        return Ok(());
    };
    let (mut it, all) = (arrived.lock(), message.len());
    it.expected = it.expected.checked_sub(all - at).ok_or(Malformed)?;
    if let Some(Err(error)) = it.share.as_mut().map(|it| it.grow(all - at)) {
        drop(it);
        end((from, id), Err(error));
        tell(from, id, About::Enough);
    } else if all > at {
        it.length += all - at;
        (it.chunks).push_back(Chunk::Shared(SharedBytes::from(message).slice(at..all)));
        it.reader.wake();
    }
    Ok(())
}

pub(super) fn forget(peer: Peer) {
    let of_peer = |table: Vec<(Peer, u32)>| table.into_iter().filter(|it| it.0 == peer);
    let arriving = ARRIVING.lock().keys().copied().collect();
    of_peer(arriving).for_each(|it| end(it, Err(NetError::Aborted)));
    let leaving = LEAVING.lock().keys().copied().collect();
    of_peer(leaving).for_each(|it| accept(peer, it.1, About::Enough));
}

crate::wire! {
    enum Rest {
        None(Result<()>),
        Follows(u32),
    }
}

/// What is not sent until it is read.
pub struct OnDemand(pub(crate) Body);

impl Wire for OnDemand {
    fn write(self, to: &mut Writer) {
        follow(to, Vec::new(), self.0, 0);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<OnDemand> {
        arrive(from, 0).map(OnDemand)
    }
}

/// `bytes` need not be asked for.
fn follow(to: &mut Writer, start: Vec<u8>, body: Body, bytes: usize) {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let peer = to.peer().expect("it is for another process");
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    (start, Rest::Follows(id)).write(to);
    let wanted = Arc::new(Guarded::new(Wanted {
        bytes,
        ..Wanted::default()
    }));
    LEAVING.lock().insert((peer, id), Arc::clone(&wanted));
    let leaving = Leaving {
        key: (peer, id),
        wanted,
        end: Err(NetError::Aborted),
    };
    // That an upload fails is known before a server that does not wait for it has answered.
    let reads_ahead = peer == HOST;
    to.afterwards(move || exec::spawn_background(leaving.send(body, reads_ahead)));
}

/// On a JS thread, which passes on what is not there yet.
impl Wire for Body {
    fn write(mut self, to: &mut Writer) {
        let mut start = Vec::new();
        while start.len() < MOST_IN_CHUNK {
            match self.poll_read(&mut Context::from_waker(Waker::noop())) {
                Poll::Ready(Ok(Some(chunk))) if chunk.len() > WINDOW => {
                    self = [chunk.into(), self].into_iter().collect();
                    break;
                }
                Poll::Ready(Ok(Some(chunk))) => start.extend_from_slice(&chunk),
                Poll::Ready(end) => return (start, Rest::None(end.map(drop))).write(to),
                Poll::Pending => break,
            }
        }
        follow(to, start, self, WINDOW);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Body> {
        arrive(from, WINDOW)
    }
}

fn arrive(from: &mut Reader<'_>, expected: usize) -> wire::Result<Body> {
    let peer = from.peer().ok_or(Malformed)?;
    let (start, rest) = <(Vec<u8>, Rest)>::read(from)?;
    let rest = match rest {
        Rest::None(Ok(())) => return Ok(start.into()),
        Rest::None(Err(error)) => Body::new(error),
        Rest::Follows(id) => {
            let (key, mut all) = ((peer, id), ARRIVING.lock());
            let count = || all.range((peer, 0)..=(peer, u32::MAX)).count();
            if (peer != HOST && count() >= MOST_BODIES) || all.contains_key(&key) {
                return Err(Malformed);
            }
            let arrived = Arc::new(Guarded::new(Arrived {
                expected,
                ..Arrived::default()
            }));
            all.insert(key, Arc::clone(&arrived));
            Body::new(Arriving {
                key,
                arrived,
                window: WINDOW,
            })
        }
    };
    Ok(rest.after(start))
}
