//! Between the process of the app, which is the host, and those of its pages.

pub(crate) mod bodies;
mod grants;

use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_ui::protocol::Lane;

pub use self::grants::{grant, is_granted};
pub use crate::wire::Peer;
use crate::wire::{self, Malformed, Message};
use crate::{channel, outside};

pub const HOST: Peer = 0;

static IS_PAGE_PROCESS: AtomicBool = AtomicBool::new(false);

#[inline]
pub fn is_page_process() -> bool {
    IS_PAGE_PROCESS.load(Ordering::Relaxed)
}

/// The numbers that a page process comes up with have this bit, unlike those of the host.
pub const OF_PAGES: u32 = 1 << 31;

pub(crate) fn own_number(next: &AtomicU32) -> u32 {
    next.fetch_add(1, Ordering::Relaxed) | if is_page_process() { OF_PAGES } else { 0 }
}

/// Never 0.
pub fn next_ticket() -> u32 {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed) % (OF_PAGES - 1) + 1
}

keywords! {
    /// The type of what follows the head.
    pub enum Kind {
        Notice = b"notice",
        Question = b"question",
        Outcome = b"outcome",
        Done = b"done",
        Deed = b"deed",
        Call = b"call",
        Begin = b"begin",
        Order = b"order",
        Query = b"query",
        Change = b"change",
        Command = b"command",
        Task = b"task",
        Answer = b"answer",
        Return = b"return",
        News = b"news",
        /// In place of a reply.
        Nothing = b"nothing",
        /// The end of what is [`Flags::HELD`].
        Release = b"release",
        Port = b"port",
        Body = b"body",
        /// Bytes as they are.
        Chunk = b"chunk",
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        /// No script is to run between it and the next one.
        const HELD = 1;
        /// It can be answered whatever is on the stack.
        const HARMLESS = 2;
        const OF_BLANK_FRAME = 4;
        const OF_PRELOAD = 8;
    }
}

#[derive(Clone, Copy)]
pub struct Head {
    pub kind: Kind,
    pub flags: Flags,
    /// A page, a context, a client, a port or a body.
    pub about: u32,
    /// What the reply has, or 0.
    pub ticket: u32,
    /// The ticket of the question that the host was answering, or 0.
    pub within: u32,
}

impl Head {
    const LENGTH: usize = 14;

    pub fn new(kind: Kind, about: u32, ticket: u32) -> Head {
        Head {
            kind,
            flags: Flags::empty(),
            about,
            ticket,
            within: 0,
        }
    }

    pub fn with(self, flags: Flags) -> Head {
        let flags = self.flags | flags;
        Head { flags, ..self }
    }

    fn to_bytes(self) -> [u8; Head::LENGTH] {
        let mut bytes = [self.kind as u8; Head::LENGTH];
        bytes[1] = self.flags.bits();
        let numbers = [self.about, self.ticket, self.within].map(u32::to_le_bytes);
        bytes[2..].copy_from_slice(numbers.as_flattened());
        bytes
    }

    pub fn of(message: &[u8]) -> wire::Result<Head> {
        let [kind, flags, numbers @ ..]: [u8; Head::LENGTH] =
            *message.first_chunk().ok_or(Malformed)?;
        let number = |at: usize| u32::from_le_bytes(numbers.as_chunks().0[at]);
        Ok(Head {
            kind: *Kind::ALL.get(usize::from(kind)).ok_or(Malformed)?,
            flags: Flags::from_bits(flags).ok_or(Malformed)?,
            about: number(0),
            ticket: number(1),
            within: number(2),
        })
    }
}

pub(crate) fn runs_no_script(message: &[u8]) -> bool {
    Head::of(message).is_ok_and(|it| {
        matches!(it.kind, Kind::Answer | Kind::Nothing) || it.flags.contains(Flags::HARMLESS)
    })
}

fn send_bytes(to: Peer, lane: Lane, bytes: &[u8]) {
    if let Some(ui) = bun_ui::loaded() {
        // SAFETY: a slice, and no descriptor.
        unsafe { (ui.send)(to, lane, bytes.as_ptr(), bytes.len(), -1) }
    }
}

/// From any thread. False if it is too long.
pub fn send<T: Message>(to: Peer, lane: Lane, head: Head, message: T) -> bool {
    let Some((bytes, afterwards)) = wire::encode_for(Some(to), &head.to_bytes(), message) else {
        return false;
    };
    send_bytes(to, lane, &bytes);
    afterwards.into_iter().for_each(|it| it());
    true
}

pub fn send_head(to: Peer, lane: Lane, head: Head) {
    send_bytes(to, lane, &head.to_bytes());
}

/// `head` has the kind of what is expected.
pub fn reply<T: Message>(to: Peer, lane: Lane, head: Head, message: Option<T>) {
    if !message.is_some_and(|it| send(to, lane, head, it)) {
        let kind = Kind::Nothing;
        send_head(to, lane, Head { kind, ..head });
    }
}

/// What follows the head.
pub fn open<T: Message>(from: Peer, message: &[u8]) -> wire::Result<T> {
    wire::decode_from(Some(from), message.get(Head::LENGTH..).ok_or(Malformed)?)
}

/// What is not about a document. The host calls it on its main thread.
pub fn accept(from: Peer, head: Head, message: Vec<u8>) -> wire::Result<()> {
    match head.kind {
        Kind::Port => channel::far::accept(from, head.about, open(from, &message)?),
        Kind::Body => bodies::accept(from, head.about, open(from, &message)?),
        Kind::Chunk => return bodies::accept_chunk(from, head.about, message, Head::LENGTH),
        Kind::Return => outside::returned(head.ticket, Some(open(from, &message)?)),
        Kind::Nothing => outside::returned(head.ticket, None),
        Kind::News if from == HOST => outside::hear(head.about, open(from, &message)?),
        Kind::Deed if from != HOST => {
            return outside::serve::deed(from, head, open(from, &message)?);
        }
        Kind::Call if from != HOST => {
            return outside::serve::call(from, head, open(from, &message)?);
        }
        _ => return Err(Malformed),
    }
    Ok(())
}

/// The process is gone.
pub fn forget(peer: Peer) {
    outside::serve::forget(peer);
    channel::far::forget(peer);
    bodies::forget(peer);
    grants::forget(peer);
}

/// Before anything else is done with this crate.
pub fn become_page_process(ui: &'static bun_ui::protocol::Ui) {
    IS_PAGE_PROCESS.store(true, Ordering::Relaxed);
    let listen = move || {
        loop {
            let message = (ui.receive)().bytes.into_vec();
            (Head::of(&message).and_then(|head| accept(HOST, head, message)))
                .expect("the host makes sense");
        }
    };
    (std::thread::Builder::new().name("outside".into()))
        .stack_size(1 << 20)
        .spawn(listen)
        .expect("a thread");
}
