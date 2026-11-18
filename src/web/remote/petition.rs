//! What a page process asks of the thread that the host has for it, from any thread: files and storage.

use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;

use bun_collections::HashMap;
use bun_sys::{Fd, File};
use bun_threading::Guarded;

use super::{HOST, Head, Kind, next_ticket};
use crate::Bytes;
use crate::channel::Serialized;
use crate::exec::{Receiver, oneshot};
use crate::locks::{Answer, LockInfo, Priority};
use crate::storage::caches::{CacheId, CachedRequest, CachedResponse, PutError, QueryOptions};
use crate::storage::files::{self, Entry, LockMode};
use crate::storage::indexed::far::{Operation, Output, Step};
use crate::storage::indexed::{Failure, Mode, Schema, Table};
use crate::storage::key::Key;
use crate::storage::{Shelf, SqlError, Usage};
use crate::wire;

type Stored<T> = Result<T, Failure>;
type Queried<T> = Result<T, SqlError>;

macro_rules! petitions {
    (
        tell { $($(#[doc = $of_told:literal])* $Told:ident = $tell:ident ($($t:ident: $T:ty),*);)* }
        ask { $($(#[doc = $of_asked:literal])* $Asked:ident = $ask:ident ($($a:ident: $A:ty),*) -> $AskedFor:ty;)* }
        call { $($(#[doc = $of_called:literal])* $Called:ident = $call:ident ($($c:ident: $C:ty),*) -> $Returned:ty;)* }
        expect { $($Expected:ident = $expect:ident -> $ExpectedValue:ty;)* }
    ) => {
        crate::wire! {
            pub(crate) enum Petition {
                $($Told { $($t: $T),* },)*
                $($Asked { $($a: $A),* },)*
                $($Called { $($c: $C),* },)*
            }

            pub(crate) enum Ruling {
                $($Asked($AskedFor),)*
                $($Called($Returned),)*
                $($Expected($ExpectedValue),)*
            }
        }

        impl Petition {
            pub(super) fn is_waited_for(&self) -> bool {
                matches!(self, $(Petition::$Asked { .. })|*)
            }
        }

        $($(#[doc = $of_told])* pub(crate) fn $tell($($t: $T),*) {
            send(0, Petition::$Told { $($t),* });
        })*

        $($(#[doc = $of_asked])* pub(crate) fn $ask($($a: $A),*) -> Option<($AskedFor, Option<File>)> {
            match send(0, Petition::$Asked { $($a),* })? {
                (Some(Ruling::$Asked(it)), file) => Some((it, file)),
                _ => None,
            }
        })*

        $($(#[doc = $of_called])* pub(crate) fn $call($($c: $C),*) -> Receiver<$Returned> {
            let (ticket, receiver) = expect(|it| match it {
                Ruling::$Called(it) => Some(it),
                _ => None,
            });
            if send(ticket, Petition::$Called { $($c),* }).is_none() {
                ruled(ticket, None);
            }
            receiver
        })*

        $(pub(crate) fn $expect() -> (u32, Receiver<$ExpectedValue>) {
            expect(|it| match it {
                Ruling::$Expected(it) => Some(it),
                _ => None,
            })
        })*
    };
}

petitions! {
    tell {
        Release = release(handle: u32);
        Connect = connect(turn: u32, connection: u32);
        Handled = handled(event: u32, is_open: bool);
        Write = write(transaction: u32, steps: Vec<Step>);
        /// The handle stands for its place from then on.
        Abort = abort(transaction: u32);
        Persist = persist(shelf: Shelf);
        RequestLock = request_lock(lock: u32, shelf: Shelf, info: LockInfo, priority: Priority, answer: u32, theft: u32);
        Broadcast = broadcast(member: u32, value: Serialized);
    }
    ask {
        OpenFile = open_file(path: Bytes) -> Opened;
        Descriptor = descriptor(of: u32) -> ();
        /// The transactions of the connection that have started since the last time.
        Begin = begin(connection: u32, transaction: u32, mode: Mode, tables: Vec<Table>, started: u32) -> Vec<u32>;
        Run = run(transaction: u32, steps: Vec<Step>, then: Operation) -> Stored<Output>;
        /// It gets what is sent by those who hear that it has.
        Join = join(member: u32, shelf: Shelf, name: Bytes) -> ();
        IsPersisted = is_persisted(shelf: Shelf) -> bool;
        QueryLocks = query_locks(shelf: Shelf) -> (Vec<LockInfo>, Vec<LockInfo>);
    }
    call {
        TakeTurn = take_turn(turn: u32, shelf: Shelf, name: Key) -> ();
        Schema = schema(turn: u32) -> Stored<Schema>;
        Announce = announce(turn: u32, new_version: Option<u64>) -> bool;
        UntilUnused = until_unused(turn: u32) -> ();
        Erase = erase(turn: u32) -> Stored<()>;
        /// As for `abort`.
        Commit = commit(transaction: u32, steps: Vec<Step>, schema: Option<Schema>, is_strict: bool) -> Stored<()>;
        Databases = databases(shelf: Shelf) -> Queried<Vec<(Key, u64)>>;
        Usage = usage(shelf: Shelf) -> Queried<Usage>;
        CacheNames = cache_names(shelf: Shelf) -> Queried<Vec<Bytes>>;
        HasCache = has_cache(shelf: Shelf, name: Vec<u8>) -> Queried<bool>;
        OpenCache = open_cache(shelf: Shelf, name: Vec<u8>) -> Queried<CacheId>;
        DeleteCache = delete_cache(shelf: Shelf, name: Vec<u8>) -> Queried<bool>;
        FirstResponse = first_response(shelf: Shelf, name: Option<Vec<u8>>, asked: CachedRequest, options: QueryOptions) -> Queried<Option<CachedResponse>>;
        Requests = requests(shelf: Shelf, cache: CacheId, asked: Option<CachedRequest>, options: QueryOptions) -> Queried<Vec<CachedRequest>>;
        Responses = responses(shelf: Shelf, cache: CacheId, asked: Option<CachedRequest>, options: QueryOptions, limit: usize) -> Queried<Vec<CachedResponse>>;
        RemoveCached = remove_cached(shelf: Shelf, cache: CacheId, asked: CachedRequest, options: QueryOptions) -> Queried<bool>;
        PutCached = put_cached(shelf: Shelf, cache: CacheId, entries: Vec<(CachedRequest, CachedResponse)>) -> Result<(), PutError>;
        CreateRoot = create_root(shelf: Shelf) -> files::Result<()>;
        Find = find(entry: Entry, kind: files::Kind, creates: bool) -> files::Result<()>;
        Children = children(entry: Entry) -> files::Result<Vec<(Bytes, files::Kind)>>;
        Remove = remove(entry: Entry, is_recursive: bool) -> files::Result<()>;
        Move = move_file(entry: Entry, target: Entry) -> files::Result<()>;
        /// A path for `open_file`.
        Snapshot = snapshot(entry: Entry) -> files::Result<Vec<u8>>;
        Open = open(file: u32, entry: Entry, mode: LockMode) -> files::Result<()>;
        Draft = draft(draft: u32, entry: Entry, mode: LockMode, keeps_data: bool) -> files::Result<()>;
        Keep = keep(draft: u32) -> files::Result<()>;
    }
    expect {
        Started = expect_start -> Stored<()>;
        Answered = expect_answer -> Answer;
        Stolen = expect_theft -> ();
    }
}

crate::wire! {
    pub(crate) enum Opened {
        File,
        Directory { modified: f64 },
        Failed { errno: i32 },
    }

    /// For who has a handle.
    pub(crate) enum Tidings {
        VersionChange { new_version: Option<u64>, event: u32 },
        Erased,
        Broadcast(Serialized),
    }
}

macro_rules! large {
    ($($T:ty),*) => {$(
        impl wire::Message for $T {
            fn most_bytes(_: u16) -> usize {
                wire::LARGE
            }
        }
    )*};
}

large!(Petition, Ruling, Tidings);

type Listener = std::sync::Arc<dyn Fn(Tidings) + Send + Sync>;

#[derive(Default)]
struct Expected {
    rulings: HashMap<u32, Box<dyn FnOnce(Ruling) + Send>>,
    tidings: HashMap<u32, Listener>,
}

fn expected() -> &'static Guarded<Expected> {
    static EXPECTED: OnceLock<Guarded<Expected>> = OnceLock::new();
    EXPECTED.get_or_init(Guarded::default)
}

fn expect<T: Send + 'static>(pick: fn(Ruling) -> Option<T>) -> (u32, Receiver<T>) {
    let (ticket, (sender, receiver)) = (next_ticket(), oneshot());
    let deliver = move |it| pick(it).map_or((), |it| sender.send(it));
    expected().lock().rulings.insert(ticket, Box::new(deliver));
    (ticket, receiver)
}

/// `None` if there will be none.
pub(crate) fn ruled(ticket: u32, ruling: Option<Ruling>) {
    let deliver = expected().lock().rulings.remove(&ticket);
    if let Some((deliver, ruling)) = deliver.zip(ruling) {
        deliver(ruling);
    }
}

pub(super) fn hear(handle: u32, tidings: Tidings) {
    let listener = expected().lock().tidings.get(&handle).cloned();
    if let Some(listener) = listener {
        listener(tidings);
    }
}

/// `None` if it is too long.
fn send(ticket: u32, petition: Petition) -> Option<(Option<Ruling>, Option<File>)> {
    let (head, waits) = (
        Head::new(Kind::Petition, 0, ticket),
        petition.is_waited_for(),
    );
    let (bytes, afterwards) = wire::encode_for(Some(HOST), &head.to_bytes(), petition)?;
    // SAFETY: a slice.
    let answer = unsafe { (bun_ui::loaded()?.petition)(bytes.as_ptr(), bytes.len(), waits) };
    afterwards.into_iter().for_each(|it| it());
    let file = (answer.descriptor >= 0).then(|| File::from_fd(descriptor_of(answer.descriptor)));
    Some((wire::decode_from(Some(HOST), &answer.bytes).ok(), file))
}

#[cfg(unix)]
fn descriptor_of(number: i32) -> Fd {
    Fd::from_native(number)
}

#[cfg(not(unix))]
fn descriptor_of(number: i32) -> Fd {
    Fd::from_uv(number)
}

/// Of what the host keeps until this is dropped.
pub(crate) struct Handle(u32);

impl Handle {
    pub(crate) fn new() -> Handle {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        Handle(NEXT.fetch_add(1, Ordering::Relaxed))
    }

    /// `listener` is called on another thread.
    pub(crate) fn with_listener(listener: impl Fn(Tidings) + Send + Sync + 'static) -> Handle {
        let this = Handle::new();
        (expected().lock().tidings).insert(this.0, std::sync::Arc::new(listener));
        this
    }

    pub(crate) fn id(&self) -> u32 {
        self.0
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        let listener = expected().lock().tidings.remove(&self.0);
        drop(listener);
        release(self.0);
    }
}
