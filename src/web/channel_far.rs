//! An [`Endpoint`] that is sent to another process stays, and passes on what arrives.

use core::sync::atomic::AtomicU32;

use bun_ui::protocol::Lane;

use super::*;
use crate::remote::{self, HOST, Head, Kind, OF_PAGES, Peer};
use crate::wire::{Malformed, Reader, Writer};

const MOST_PORTS: usize = 1 << 16;

struct Carried {
    key: (Peer, u32),
    endpoint: Arc<Endpoint>,
}

/// Until the other process has said that it is closed.
static CARRIED: Guarded<Vec<Carried>> = Guarded::new(Vec::new());
/// What is for a port can overtake the message that it comes with.
static EARLY: Guarded<Vec<(u32, Endpoint)>> = Guarded::new(Vec::new());

crate::wire!(impl enum Arrival { Message(Message), Closed, });

impl wire::Message for Arrival {
    fn most_bytes(_: u16) -> usize {
        wire::LARGE
    }
}

/// In a message that has not been sent.
struct Leaving(Option<((Peer, u32), Arc<Endpoint>)>);

impl Drop for Leaving {
    fn drop(&mut self) {
        if let Some((key, _)) = &self.0 {
            let unsent = CARRIED.lock().extract_if(.., |it| it.key == *key).next();
            drop(unsent);
        }
    }
}

thread_local! {
    static TO_CARRY: RefCell<Option<VecDeque<Leaving>>> = const { RefCell::new(None) };
}

pub(super) fn pass_on((peer, id): (Peer, u32), arrival: Arrival) {
    let head = Head::new(Kind::Port, id, 0);
    if !remote::send(peer, Lane::Elsewhere, head, arrival) {
        let unreadable = Arrival::Message(Serialized::unreadable().into());
        remote::send(peer, Lane::Elsewhere, head, unreadable);
    }
}

/// Without recursion: a script decides how deeply ports are nested.
fn carry(first: Leaving) {
    let mut next = TO_CARRY.with_borrow_mut(|it| match it {
        Some(others) => {
            others.push_back(first);
            None
        }
        None => {
            *it = Some(VecDeque::new());
            Some(first)
        }
    });
    while let Some((key, endpoint)) = next.and_then(|mut it| it.0.take()) {
        let mut side = endpoint.0.sides[endpoint.0.side].lock();
        let has_end = matches!(side.inbox.back(), Some(Arrival::Closed));
        side.inbox.drain(..).for_each(|it| pass_on(key, it));
        side.is_closed |= has_end;
        side.carrier = (!side.is_closed).then_some(key);
        drop(side);
        next = TO_CARRY.with_borrow_mut(|it| {
            let next = it.as_mut()?.pop_front();
            it.take_if(|_| next.is_none());
            next
        });
    }
}

fn counterpart(key: (Peer, u32), all: &mut Vec<Carried>) -> Endpoint {
    let (carried, given) = Endpoint::pair();
    carried.0.sides[carried.0.side].lock().carrier = Some(key);
    let endpoint = Arc::new(carried);
    all.push(Carried { key, endpoint });
    given
}

impl wire::Wire for Endpoint {
    fn write(self, to: &mut Writer) {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let Some(peer) = to.peer() else {
            return self.park().write(to);
        };
        let id = remote::own_number(&NEXT);
        id.write(to);
        let (key, endpoint) = ((peer, id), Arc::new(self));
        let leaving = Leaving(Some((key, Arc::clone(&endpoint))));
        CARRIED.lock().push(Carried { key, endpoint });
        to.afterwards(move || carry(leaving));
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Endpoint> {
        let Some(peer) = from.peer() else {
            return f64::read(from).map(Endpoint::unpark);
        };
        let (id, mut all) = (u32::read(from)?, CARRIED.lock());
        if peer == HOST {
            let early = EARLY.lock().extract_if(.., |it| it.0 == id).next();
            return Ok(early.map_or_else(|| counterpart((peer, id), &mut all), |it| it.1));
        }
        let of_peer = || all.iter().filter(|it| it.key.0 == peer);
        if id & OF_PAGES == 0
            || of_peer().any(|it| it.key.1 == id)
            || of_peer().count() >= MOST_PORTS
        {
            return Err(Malformed);
        }
        Ok(counterpart((peer, id), &mut all))
    }
}

pub(crate) fn accept(from: Peer, id: u32, arrival: Arrival) {
    let (key, mut all) = ((from, id), CARRIED.lock());
    let mut at = all.iter().position(|it| it.key == key);
    if at.is_none() && from == HOST && id & OF_PAGES == 0 {
        let given = counterpart(key, &mut all);
        EARLY.lock().push((id, given));
        at = Some(all.len() - 1);
    }
    let Some(at) = at else { return };
    match arrival {
        Arrival::Message(message) => {
            let endpoint = Arc::clone(&all[at].endpoint);
            drop(all);
            endpoint.send(message);
        }
        Arrival::Closed => {
            let Carried { endpoint, .. } = all.swap_remove(at);
            drop(all);
            let mut side = endpoint.0.sides[endpoint.0.side].lock();
            let has_to_confirm = !core::mem::replace(&mut side.is_closed, true);
            side.carrier = None;
            drop(side);
            if has_to_confirm {
                pass_on(key, Arrival::Closed);
                endpoint.peer().deliver(Arrival::Closed);
            }
        }
    }
}

pub(crate) fn forget(peer: Peer) {
    let gone: Vec<_> = (CARRIED.lock().extract_if(.., |it| it.key.0 == peer)).collect();
    drop(gone);
}
