//! A [`Body`] that is read in another process. No more is sent than has been asked for.

use core::future::poll_fn;
use core::sync::atomic::{AtomicU32, Ordering};
use core::task::{Context, Poll, Waker};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_threading::Guarded;
use bun_ui::protocol::Lane;

use super::{HOST, Head, Kind, Peer, send, send_bytes};
use crate::exec::{self, Either, Waiter, race};
use crate::net::body::{Body, Budget, Chunk, FOR_DATA, Read, Share, SharedBytes, Source};
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
        All,
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

/// A page only sends a body once the network wants it.
fn asked_at_first(sender: Peer) -> usize {
    if sender == HOST { WINDOW } else { 0 }
}

#[derive(Default)]
struct Wanted {
    bytes: usize,
    is_all: bool,
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

type Table<T> = Guarded<Vec<((Peer, u32), Arc<Guarded<T>>)>>;

static LEAVING: Table<Wanted> = Guarded::new(Vec::new());
static ARRIVING: Table<Arrived> = Guarded::new(Vec::new());

fn find<T>(table: &Table<T>, key: (Peer, u32)) -> Option<Arc<Guarded<T>>> {
    (table.lock().iter()).find_map(|it| (it.0 == key).then(|| Arc::clone(&it.1)))
}

/// Says that it is cut short if it is dropped before the end.
struct Leaving {
    key: (Peer, u32),
    wanted: Arc<Guarded<Wanted>>,
    end: Result<()>,
}

impl Drop for Leaving {
    fn drop(&mut self) {
        LEAVING.lock().retain(|it| it.0 != self.key);
        tell(self.key.0, self.key.1, About::End(self.end));
    }
}

impl Leaving {
    /// How many bytes, and whether all others will be. `None` if there is no reader.
    async fn wanted(&self) -> Option<(usize, bool)> {
        poll_fn(|cx| match &mut *self.wanted.lock() {
            it if it.is_enough => Poll::Ready(None),
            it if it.bytes > 0 => Poll::Ready(Some((it.bytes, core::mem::take(&mut it.is_all)))),
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

    async fn send(mut self, mut body: Body) {
        let (head, mut bytes) = (Head::new(Kind::Chunk, self.key.1, 0).to_bytes(), Vec::new());
        while let Some((_, is_all)) = self.wanted().await {
            if is_all {
                body.expect_read_to_end(&FOR_DATA, &mut Vec::new());
            }
            let chunk = match race(body.read(), self.abandoned()).await {
                Either::First(Ok(Some(chunk))) => chunk,
                Either::First(end) => return self.end = end.map(drop),
                Either::Second(()) => return,
            };
            let mut left = &*chunk;
            while !left.is_empty() {
                let Some((wanted, _)) = self.wanted().await else {
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
            drop(it);
            tell(self.key.0, self.key.1, About::All);
        }
    }
}

impl Drop for Arriving {
    fn drop(&mut self) {
        if self.arrived.lock().end.is_none() {
            ARRIVING.lock().retain(|it| it.0 != self.key);
            tell(self.key.0, self.key.1, About::Enough);
        }
    }
}

fn end(key: (Peer, u32), how: Result<()>) {
    let found = ARRIVING.lock().extract_if(.., |it| it.0 == key).next();
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
        About::All => change(&|it| it.is_all = true),
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
    let arriving = ARRIVING.lock().iter().map(|it| it.0).collect();
    of_peer(arriving).for_each(|it| end(it, Err(NetError::Aborted)));
    let leaving = LEAVING.lock().iter().map(|it| it.0).collect();
    of_peer(leaving).for_each(|it| accept(peer, it.1, About::Enough));
}

crate::wire! {
    enum Rest {
        None(Result<()>),
        Follows(u32),
    }
}

/// On a JS thread, which passes on what is not there yet.
impl Wire for Body {
    fn write(mut self, to: &mut Writer) {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let peer = to.peer().expect("it is for another process");
        let mut start = Vec::new();
        while peer != HOST && start.len() < MOST_IN_CHUNK {
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
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        (start, Rest::Follows(id)).write(to);
        let wanted = Arc::new(Guarded::new(Wanted {
            bytes: if peer == HOST {
                0
            } else {
                asked_at_first(HOST)
            },
            ..Wanted::default()
        }));
        LEAVING.lock().push(((peer, id), Arc::clone(&wanted)));
        let leaving = Leaving {
            key: (peer, id),
            wanted,
            end: Err(NetError::Aborted),
        };
        to.afterwards(move || exec::spawn_background(leaving.send(self)));
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Body> {
        let peer = from.peer().ok_or(Malformed)?;
        let (start, rest) = <(Vec<u8>, Rest)>::read(from)?;
        let rest = match rest {
            Rest::None(Ok(())) => return Ok(start.into()),
            Rest::None(Err(error)) => Body::new(error),
            Rest::Follows(id) => {
                let (key, mut all) = ((peer, id), ARRIVING.lock());
                let count = all.iter().filter(|it| it.0.0 == peer).count();
                if (peer != HOST && count >= MOST_BODIES) || all.iter().any(|it| it.0 == key) {
                    return Err(Malformed);
                }
                let arrived = Arc::new(Guarded::new(Arrived {
                    expected: asked_at_first(peer),
                    ..Arrived::default()
                }));
                all.push((key, Arc::clone(&arrived)));
                Body::new(Arriving {
                    key,
                    arrived,
                    window: WINDOW,
                })
            }
        };
        Ok(rest.after(start))
    }
}
