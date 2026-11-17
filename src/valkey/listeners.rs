//! Which `subscribe()` stored each listener that script holds.

use core::ops::Range;

use bun_collections::StringArrayHashMap;

pub type Name = Box<[u8]>;

/// Numbers the `subscribe()` calls, which are answered in that order.
pub(crate) type Ticket = u64;

/// Listeners for script to drop: their `subscribe()` failed.
#[derive(Debug)]
pub struct Undo {
    pub channel: Name,
    pub listeners: Range<usize>,
}

#[derive(Default)]
pub(crate) struct Listeners {
    next: Ticket,
    /// An older ticket that is still here was confirmed.
    unanswered: Ticket,
    /// One ticket for each listener, in script's order. None is empty.
    channels: StringArrayHashMap<Vec<Ticket>>,
}

impl Listeners {
    pub(crate) fn is_empty(&self) -> bool {
        self.channels.is_empty()
    }

    pub(crate) fn add(&mut self, names: &[Name]) -> Ticket {
        let ticket = self.next;
        self.next += 1;
        for name in names {
            let entry = bun_core::handle_oom(self.channels.get_or_put(name));
            entry.value_ptr.push(ticket);
        }
        ticket
    }

    pub(crate) fn confirm(&mut self, ticket: Ticket) {
        self.unanswered = ticket + 1;
    }

    pub(crate) fn refuse(&mut self, ticket: Ticket, names: Vec<Name>) -> Vec<Undo> {
        self.undo(names, ticket + 1)
    }

    /// No answer comes for the tickets ahead of the first that is still queued.
    pub(crate) fn abandon(&mut self, queued: Option<Ticket>) -> Vec<Undo> {
        let end = queued.unwrap_or(self.next);
        if end == self.unanswered {
            return Vec::new();
        }
        self.undo(self.channels.keys().to_vec(), end)
    }

    fn undo(&mut self, names: Vec<Name>, end: Ticket) -> Vec<Undo> {
        let start = core::mem::replace(&mut self.unanswered, end);
        let undo = |channel: Name| {
            let tickets = self.channels.get(&channel)?;
            let index_of = |ticket| tickets.partition_point(|it| *it < ticket);
            let listeners = index_of(start)..index_of(end);
            if listeners.is_empty() {
                return None;
            }
            self.retain(&channel, |index| !listeners.contains(&index));
            Some(Undo { channel, listeners })
        };
        names.into_iter().filter_map(undo).collect()
    }

    pub(crate) fn retain(&mut self, name: &[u8], mut keep: impl FnMut(usize) -> bool) {
        let Some(tickets) = self.channels.get_mut(name) else {
            return;
        };
        let mut indices = 0..;
        tickets.retain(|_| indices.next().is_some_and(&mut keep));
        if tickets.is_empty() {
            self.channels.swap_remove(name);
        }
    }

    pub(crate) fn clear(&mut self) {
        self.channels.clear_and_free();
    }

    pub(crate) fn confirmed_channels(&self) -> impl Iterator<Item = &Name> {
        let channels = self.channels.iter();
        channels.filter_map(|(name, it)| (*it.first()? < self.unanswered).then_some(name))
    }
}
