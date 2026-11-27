//! Replies that still hold.

use core::cmp::Reverse;
use core::time::Duration;
use std::collections::BinaryHeap;

use hashbrown::HashTable;
use hashbrown::hash_table::OccupiedEntry;

use crate::message::{Message, Question};
use crate::system::System;

const MAX_LIFETIME: u32 = 3600;
const MAX_BYTES: usize = 16 * 1024 * 1024;

/// Times are in whole seconds.
struct Entry {
    hash: u64,
    message: Message,
    stored: u64,
    expires: u64,
    /// Unlike `stored`, from a clock that goes on while the machine sleeps.
    stored_wall_clock: i64,
}

impl Entry {
    fn bytes(&self) -> usize {
        size_of::<Self>() + self.message.len()
    }
}

#[derive(Default)]
pub(crate) struct Cache {
    entries: HashTable<Entry>,
    /// `expires` and `hash` of each entry, and of those that `get` removed early.
    expiries: BinaryHeap<Reverse<(u64, u64)>>,
    bytes: usize,
}

impl Cache {
    fn drop_expired(&mut self, now: u64) {
        while let Some(&Reverse((expires, hash))) = self.expiries.peek()
            && expires <= now
        {
            self.expiries.pop();
            let is_due = |entry: &Entry| (entry.expires, entry.hash) == (expires, hash);
            let entry = self.entries.find_entry(hash, is_due);
            self.bytes -= entry.map_or(0, |entry| entry.remove().0.bytes());
        }
    }

    fn find(&mut self, question: &Question) -> Option<OccupiedEntry<'_, Entry>> {
        let matches = |entry: &Entry| question.matches(entry.message.question());
        self.entries.find_entry(question.hash, matches).ok()
    }

    pub(crate) fn get(
        &mut self,
        question: &Question,
        now: Duration,
        system: &impl System,
    ) -> Option<Message> {
        self.drop_expired(now.as_secs());
        let found = self.find(question)?;
        let entry = found.get();
        let wall_clock_age = system.wall_clock().saturating_sub(entry.stored_wall_clock);
        // The two clocks do not start their seconds together.
        let wall_clock_age = u64::try_from(wall_clock_age).unwrap_or(0).saturating_sub(1);
        let age = wall_clock_age.max(now.as_secs().saturating_sub(entry.stored));
        if entry.stored.saturating_add(age) >= entry.expires {
            self.bytes -= found.remove().0.bytes();
            return None;
        }
        let mut message = entry.message.clone();
        message.age = age as u32;
        Some(message)
    }

    pub(crate) fn insert(
        &mut self,
        question: &Question,
        message: &Message,
        now: Duration,
        system: &impl System,
    ) {
        let stored = now.as_secs();
        self.drop_expired(stored);
        if message.lifetime == 0 || self.find(question).is_some() {
            return;
        }
        let entry = Entry {
            hash: question.hash,
            message: message.clone(),
            stored,
            expires: stored + u64::from(message.lifetime.min(MAX_LIFETIME)),
            stored_wall_clock: system.wall_clock(),
        };
        // What is in use comes back, however short its life is.
        if self.bytes + entry.bytes() > MAX_BYTES {
            *self = Self::default();
        }
        self.bytes += entry.bytes();
        self.expiries.push(Reverse((entry.expires, entry.hash)));
        self.entries
            .insert_unique(entry.hash, entry, |entry| entry.hash);
    }
}
