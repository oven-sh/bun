//! Publish and subscribe.

use core::num::NonZeroU32;
use core::ops::{Index, IndexMut};
use std::collections::BTreeMap;

use bun_collections::hashbrown::HashTable;
use bun_collections::smallvec::SmallVec;

use crate::frame::Opcode;

const MAX_QUEUED: usize = 32;

pub struct Message {
    pub payload: SmallVec<[u8; 16]>,
    pub opcode: Opcode,
    pub compress: bool,
}

pub trait Receiver: Copy {
    fn receive<'a>(self, messages: impl Iterator<Item = &'a Message>);
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Id(NonZeroU32);

impl Id {
    fn index(self) -> usize {
        self.0.get() as usize - 1
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct TopicId(Id);

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SubscriberId(Id);

struct Slots<T> {
    slots: Vec<Option<Box<T>>>,
    vacant: Vec<Id>,
}

impl<T> Slots<T> {
    const fn new() -> Self {
        Self {
            slots: Vec::new(),
            vacant: Vec::new(),
        }
    }

    fn insert(&mut self, value: T) -> Id {
        let id = self.vacant.pop().unwrap_or_else(|| {
            self.slots.push(None);
            // A connection that fails for want of memory has to be able to leave.
            self.vacant.reserve(self.slots.len());
            Id(NonZeroU32::MIN.saturating_add(self.slots.len() as u32 - 1))
        });
        self.slots[id.index()] = Some(Box::new(value));
        id
    }

    fn remove(&mut self, id: Id) -> Box<T> {
        self.vacant.push(id);
        self.slots[id.index()].take().expect("a live id")
    }
}

impl<T> Index<Id> for Slots<T> {
    type Output = T;

    fn index(&self, id: Id) -> &T {
        self.slots[id.index()].as_ref().expect("a live id")
    }
}

impl<T> IndexMut<Id> for Slots<T> {
    fn index_mut(&mut self, id: Id) -> &mut T {
        self.slots[id.index()].as_mut().expect("a live id")
    }
}

struct Topic {
    name: SmallVec<[u8; 16]>,
    hash: u64,
    subscribers: SmallVec<[SubscriberId; 4]>,
}

struct Subscriber<R> {
    receiver: R,
    /// With its index among the subscribers of each.
    topics: BTreeMap<TopicId, u32>,
    /// Indices into `messages`.
    queue: [u16; MAX_QUEUED],
    queued: u8,
    /// Into `waiting`, while `queued` is not 0.
    position: u32,
}

struct Subscribers<R> {
    all: Slots<Subscriber<R>>,
    waiting: Vec<SubscriberId>,
    messages: Vec<Message>,
}

impl<R: Receiver> Subscribers<R> {
    fn stop_waiting(&mut self, position: u32) {
        self.waiting.swap_remove(position as usize);
        if let Some(moved) = self.waiting.get(position as usize) {
            self.all[moved.0].position = position;
        }
    }

    fn deliver(subscriber: &mut Subscriber<R>, messages: &[Message]) {
        let queue = &subscriber.queue[..core::mem::take(&mut subscriber.queued).into()];
        let messages = queue.iter().map(|&index| &messages[usize::from(index)]);
        subscriber.receiver.receive(messages);
    }

    fn drain(&mut self, id: SubscriberId) {
        let subscriber = &mut self.all[id.0];
        if subscriber.queued != 0 {
            let position = subscriber.position;
            Self::deliver(subscriber, &self.messages);
            self.stop_waiting(position);
            if self.waiting.is_empty() {
                self.messages.clear();
            }
        }
    }

    fn drain_all(&mut self) {
        while let Some(id) = self.waiting.pop() {
            Self::deliver(&mut self.all[id.0], &self.messages);
        }
        self.messages.clear();
    }
}

pub struct Topics<R> {
    by_name: HashTable<TopicId>,
    topics: Slots<Topic>,
    subscribers: Subscribers<R>,
}

impl<R: Receiver> Default for Topics<R> {
    fn default() -> Self {
        Self {
            by_name: HashTable::new(),
            topics: Slots::new(),
            subscribers: Subscribers {
                all: Slots::new(),
                waiting: Vec::new(),
                messages: Vec::new(),
            },
        }
    }
}

impl<R: Receiver> Topics<R> {
    pub fn find(&self, name: &[u8]) -> Option<TopicId> {
        self.by_name
            .find(bun_wyhash::hash(name), |id| {
                *self.topics[id.0].name == *name
            })
            .copied()
    }

    pub fn subscribers(&self, topic: TopicId) -> &[SubscriberId] {
        &self.topics[topic.0].subscribers
    }

    pub fn receiver(&self, subscriber: SubscriberId) -> R {
        self.subscribers.all[subscriber.0].receiver
    }

    pub fn names(&self, subscriber: SubscriberId) -> impl ExactSizeIterator<Item = &[u8]> {
        let topics = self.subscribers.all[subscriber.0].topics.keys();
        topics.map(|id| &*self.topics[id.0].name)
    }

    pub fn is_subscribed(&self, subscriber: SubscriberId, name: &[u8]) -> bool {
        let topics = &self.subscribers.all[subscriber.0].topics;
        self.find(name).is_some_and(|id| topics.contains_key(&id))
    }

    pub fn add_subscriber(&mut self, receiver: R) -> SubscriberId {
        SubscriberId(self.subscribers.all.insert(Subscriber {
            receiver,
            topics: BTreeMap::new(),
            queue: [0; MAX_QUEUED],
            queued: 0,
            position: 0,
        }))
    }

    /// Drops what is queued for it.
    pub fn remove_subscriber(&mut self, id: SubscriberId) {
        let subscriber = self.subscribers.all.remove(id.0);
        if subscriber.queued != 0 {
            self.subscribers.stop_waiting(subscriber.position);
        }
        for (topic, index) in subscriber.topics {
            self.leave(topic, index);
        }
    }

    pub fn subscribe(&mut self, subscriber: SubscriberId, name: &[u8]) {
        let hash = bun_wyhash::hash(name);
        let entry = self.by_name.entry(
            hash,
            |id| *self.topics[id.0].name == *name,
            |id| self.topics[id.0].hash,
        );
        let entry = entry.or_insert_with(|| {
            TopicId(self.topics.insert(Topic {
                name: SmallVec::from_slice(name),
                hash,
                subscribers: SmallVec::new(),
            }))
        });
        let topic = *entry.get();
        let topics = &mut self.subscribers.all[subscriber.0].topics;
        topics.entry(topic).or_insert_with(|| {
            let subscribers = &mut self.topics[topic.0].subscribers;
            subscribers.push(subscriber);
            subscribers.len() as u32 - 1
        });
    }

    /// False if it was not subscribed.
    pub fn unsubscribe(&mut self, subscriber: SubscriberId, name: &[u8]) -> bool {
        self.find(name).is_some_and(|topic| {
            let index = self.subscribers.all[subscriber.0].topics.remove(&topic);
            index.map(|index| self.leave(topic, index)).is_some()
        })
    }

    fn leave(&mut self, id: TopicId, index: u32) {
        let subscribers = &mut self.topics[id.0].subscribers;
        subscribers.swap_remove(index as usize);
        if let Some(moved) = subscribers.get(index as usize) {
            let topics = &mut self.subscribers.all[moved.0].topics;
            *topics.get_mut(&id).expect("a subscription") = index;
        } else if subscribers.is_empty() {
            let hash = self.topics.remove(id.0).hash;
            if let Ok(entry) = self.by_name.find_entry(hash, |&other| other == id) {
                entry.remove();
            }
        }
    }

    /// Queues the message for all but `sender`. False if there is nobody else.
    pub fn publish(
        &mut self,
        topic: TopicId,
        sender: Option<SubscriberId>,
        payload: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> bool {
        let subscribers = &mut self.subscribers;
        if subscribers.messages.len() == usize::from(u16::MAX) {
            subscribers.drain_all();
        }
        let mut is_queued = false;
        // `waiting` is drained from its end.
        for &id in self.topics[topic.0].subscribers.iter().rev() {
            if Some(id) == sender {
                continue;
            }
            is_queued = true;
            let mut subscriber = &mut subscribers.all[id.0];
            if usize::from(subscriber.queued) == MAX_QUEUED {
                subscribers.drain(id);
                subscriber = &mut subscribers.all[id.0];
            }
            if subscriber.queued == 0 {
                subscriber.position = subscribers.waiting.len() as u32;
                subscribers.waiting.push(id);
            }
            subscriber.queue[usize::from(subscriber.queued)] = subscribers.messages.len() as u16;
            subscriber.queued += 1;
        }
        if is_queued {
            subscribers.messages.push(Message {
                payload: SmallVec::from_slice(payload),
                opcode,
                compress,
            });
        }
        is_queued
    }

    pub fn drain(&mut self, subscriber: SubscriberId) {
        if !self.subscribers.waiting.is_empty() {
            self.subscribers.drain(subscriber);
        }
    }

    pub fn drain_all(&mut self) {
        if !self.subscribers.messages.is_empty() {
            self.subscribers.drain_all();
        }
    }
}
