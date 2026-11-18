//! A shared worker runs in the process that is the first to ask for it.

use core::any::Any;

use super::*;
use crate::channel::Endpoint;
use crate::outside::{AboutSharedWorker as News, Claim};

const LONGEST_KEY: usize = 64 << 10;

/// A process, and its number for a worker.
type Handle = (Peer, u32);

struct Worker {
    key: Bytes,
    options: [u8; 4],
    owner: Handle,
    users: Vec<Handle>,
    /// While it has users.
    lease: Option<Box<dyn Any>>,
}

static ALL: bun_ui::Lasting<ManuallyDrop<RefCell<Vec<Worker>>>> = bun_ui::Lasting::empty();

fn tell((peer, worker): Handle, news: News) {
    let head = Head::new(Kind::SharedWorker, worker, 0);
    remote::send(peer, Lane::Scripts, head, news);
}

fn remove(is_meant: impl Fn(Handle) -> bool, has_failed: bool) {
    let (ended, leases) = ALL.with(|it| {
        let mut all = it.borrow_mut();
        let ended = Vec::from_iter(all.extract_if(.., |it| is_meant(it.owner)));
        let mut leases = Vec::new();
        for it in all.iter_mut() {
            it.users.retain(|it| !is_meant(*it));
            if let Some(lease) = it.lease.take_if(|_| it.users.is_empty()) {
                tell(it.owner, News::IsUsed(false));
                leases.push(lease);
            }
        }
        (ended, leases)
    });
    (ended.iter().flat_map(|it| &it.users)).for_each(|it| tell(*it, News::Ended { has_failed }));
    drop(leases);
}

pub(super) fn claim(by: Handle, client: &Client, key: Bytes, options: [u8; 4]) -> Claim {
    let replaced = ALL.with(|it| {
        let all = it.borrow();
        Some(
            all.iter()
                .find(|it| it.key == key && it.owner.0 == by.0)?
                .owner,
        )
    });
    if let Some(it) = replaced {
        leave(it, false);
    }
    ALL.with(|it| {
        let mut all = it.borrow_mut();
        let handles = (all.iter()).flat_map(|it| it.users.iter().chain([&it.owner]));
        if handles.filter(|it| it.0 == by.0).count() >= MOST_WORKERS
            || key.len() > LONGEST_KEY
            || client.origin().is_opaque()
        {
            return Claim::Refused;
        }
        match all.iter_mut().find(|it| it.key == key) {
            Some(found) if found.options != options => Claim::Refused,
            Some(found) => {
                if found.lease.is_none() {
                    found.lease = client.session.keep_process(found.owner.0);
                    tell(found.owner, News::IsUsed(true));
                }
                found.users.push(by);
                Claim::IsElsewhere
            }
            None => {
                all.push(Worker {
                    key,
                    options,
                    owner: by,
                    users: Vec::new(),
                    lease: None,
                });
                Claim::Granted
            }
        }
    })
}

pub(super) fn connect(by: Handle, port: Endpoint) {
    let owner = ALL.with(|it| Some(it.borrow().iter().find(|it| it.users.contains(&by))?.owner));
    if let Some(it) = owner {
        tell(it, News::Connect(port));
    }
}

pub(super) fn leave(by: Handle, has_failed: bool) {
    remove(|it| it == by, has_failed);
}

pub(super) fn forget(peer: Peer) {
    remove(|it| it.0 == peer, false);
}
