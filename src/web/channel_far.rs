//! An [`Endpoint`] that is sent to another process stays, and passes on what arrives.

use core::sync::atomic::AtomicU32;

use bun_collections::HashMap;
use bun_ui::protocol::Lane;

use super::*;
use crate::remote::{self, HOST, Head, Kind, OF_PAGES, Peer};
use crate::wire::{Malformed, Reader, Writer};

const MOST_PORTS: usize = 1 << 16;
/// What a message counts as, at least.
const OVERHEAD: usize = 1 << 10;

#[derive(Default)]
struct Tables {
    /// Until the other process has said that it is closed.
    carried: HashMap<Peer, HashMap<u32, Arc<Endpoint>>>,
    /// What is for a port can overtake the message that it comes with.
    early: HashMap<u32, Endpoint>,
}

fn tables() -> &'static Guarded<Tables> {
    static ALL: std::sync::OnceLock<Guarded<Tables>> = std::sync::OnceLock::new();
    ALL.get_or_init(Guarded::default)
}

impl Tables {
    fn of(&mut self, peer: Peer) -> &mut HashMap<u32, Arc<Endpoint>> {
        self.carried.entry(peer).or_default()
    }

    fn counterpart(&mut self, key: (Peer, u32)) -> Endpoint {
        let (carried, given) = Endpoint::pair();
        carried.0.sides[carried.0.side].lock().carrier = Some(key);
        self.of(key.0).insert(key.1, Arc::new(carried));
        given
    }
}

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
            let unsent = tables().lock().of(key.0).remove(&key.1);
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
        tables().lock().of(peer).insert(id, endpoint);
        to.afterwards(move || carry(leaving));
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Endpoint> {
        let Some(peer) = from.peer() else {
            return f64::read(from).map(Endpoint::unpark);
        };
        let (id, mut all) = (u32::read(from)?, tables().lock());
        if peer == HOST {
            let early = all.early.remove(&id);
            return Ok(early.unwrap_or_else(|| all.counterpart((peer, id))));
        }
        let of_peer = all.of(peer);
        if id & OF_PAGES == 0 || of_peer.contains_key(&id) || of_peer.len() >= MOST_PORTS {
            return Err(Malformed);
        }
        Ok(all.counterpart((peer, id)))
    }
}

pub(crate) fn accept(from: Peer, id: u32, arrival: Arrival, length: usize) -> wire::Result<()> {
    let (key, mut all) = ((from, id), tables().lock());
    if from == HOST && id & OF_PAGES == 0 && !all.of(from).contains_key(&id) {
        let given = all.counterpart(key);
        all.early.insert(id, given);
    }
    let Some(endpoint) = all.of(from).get(&id).cloned() else {
        return Ok(());
    };
    match arrival {
        Arrival::Message(message) => {
            drop(all);
            let mut other = endpoint.0.sides[1 - endpoint.0.side].lock();
            other.bytes_from_afar *= usize::from(!other.inbox.is_empty());
            other.bytes_from_afar += length + OVERHEAD;
            if from != HOST && other.bytes_from_afar > 2 * wire::LARGE {
                return Err(Malformed);
            }
            drop(other);
            endpoint.send(message);
        }
        Arrival::Closed => {
            all.of(from).remove(&id);
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
    Ok(())
}

pub(crate) fn forget(peer: Peer) {
    let gone = tables().lock().carried.remove(&peer);
    drop(gone);
}
