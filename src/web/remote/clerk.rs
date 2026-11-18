//! The thread that the host has for the petitions of a page process.

use core::sync::atomic::{AtomicU32, Ordering};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_collections::HashMap;
use bun_sys::{E, Fd, File, O, S};
use bun_threading::{Futex, Guarded};
use bun_ui::protocol::{Lane, PageCommand, Ui};

use super::petition::{Opened, Petition, Ruling, Tidings};
use super::{Head, Kind, Peer, grants};
use crate::channel::FarBroadcast;
use crate::exec::{Line, Sender};
use crate::locks::LockRequest;
use crate::net::session::Session;
use crate::storage::caches::{CacheId, Caches};
use crate::storage::files::{Draft, Entry, Locator, OpenFile, is_valid_name};
use crate::storage::indexed::far::{Operation, Supervised, require_key};
use crate::storage::indexed::{Connection, Notice, Place, Turn};
use crate::storage::{Shelf, SqlError};
use crate::wire::{self, Malformed};

const MOST_HANDLES: usize = 1 << 17;
const MOST_FILES: usize = 1 << 9;
const MOST_CALLS: u32 = 1 << 16;
const MOST_NAMES: usize = 1 << 7;
const MOST_CACHES: usize = 1 << 12;
const MOST_IN_HANDLES: usize = 2 << 30;
const MOST_AT_A_TIME: u32 = 32;

enum Kept {
    /// Until it arrives.
    Nothing,
    Turn(Arc<Turn>),
    Connection {
        connection: Connection,
        waiting: Vec<u32>,
    },
    Transaction(Box<Supervised>),
    Place {
        _place: Option<Place>,
    },
    File(OpenFile),
    Draft(Draft),
    Lock {
        _request: LockRequest,
    },
    Broadcast(FarBroadcast),
}

/// With other threads. Nothing is locked or dropped while it is locked.
#[derive(Default)]
struct Shared {
    awaited: HashMap<u32, Option<Kept>>,
    events: HashMap<u32, Sender<bool>>,
    last_event: u32,
    caches: VecDeque<(u32, CacheId)>,
}

struct Clerk {
    ui: &'static Ui,
    peer: Peer,
    kept: HashMap<u32, Kept>,
    files: Vec<u32>,
    shared: Arc<Guarded<Shared>>,
    calls: Arc<AtomicU32>,
    /// Those that wait for nothing but the disk.
    busy: Arc<AtomicU32>,
    line: Arc<Line>,
    sizes: HashMap<u32, usize>,
    in_handles: usize,
}

enum Failure {
    Malformed,
    /// It can be a matter of timing.
    Refused,
}

impl From<Malformed> for Failure {
    fn from(_: Malformed) -> Failure {
        Failure::Malformed
    }
}

type Outcome<T = ()> = Result<T, Failure>;

pub(crate) fn tell(peer: Peer, handle: u32, tidings: Tidings) {
    let head = Head::new(Kind::Tidings, handle, 0);
    super::send(peer, Lane::Elsewhere, head, tidings);
}

fn rule(peer: Peer, ticket: u32, ruling: Option<Ruling>) {
    let head = |kind| Head::new(kind, 0, ticket);
    if !ruling.is_some_and(|it| super::send(peer, Lane::Elsewhere, head(Kind::Ruling), it)) {
        super::send_head(peer, Lane::Elsewhere, head(Kind::NoRuling));
    }
}

fn hand_over(shared: &Guarded<Shared>, handle: u32, kept: Kept) {
    let mut kept = Some(kept);
    if let Some(slot) = shared.lock().awaited.get_mut(&handle) {
        core::mem::swap(slot, &mut kept);
    }
}

fn open_file(path: &[u8]) -> (Opened, Option<File>) {
    let flags = O::RDONLY | O::CLOEXEC | O::NONBLOCK | O::NOCTTY;
    let opened = File::openat(Fd::cwd(), path, flags, 0).and_then(|it| Ok((it.stat()?, it)));
    let failed = |it: E| (Opened::Failed { errno: it as i32 }, None);
    match opened {
        Ok((stat, file)) if S::ISREG(stat.st_mode as _) => (Opened::File, Some(file)),
        Ok(_) => grants::modification_of_directory(path).map_or_else(
            || failed(E::EACCES),
            |modified| (Opened::Directory { modified }, None),
        ),
        Err(error) => failed(error.get_errno()),
    }
}

macro_rules! kept {
    ($this:ident, $handle:expr, $pattern:pat => $value:expr) => {
        match $this.get($handle) {
            Some($pattern) => $value,
            _ => return Err(Failure::Refused),
        }
    };
}

impl Clerk {
    fn get(&mut self, handle: u32) -> Option<&mut Kept> {
        let kept = self.kept.get_mut(&handle)?;
        if let Kept::Nothing = kept {
            let mut shared = self.shared.lock();
            *kept = shared.awaited.get_mut(&handle)?.take()?;
            shared.awaited.remove(&handle);
        }
        Some(kept)
    }

    fn keep(&mut self, handle: u32, kept: Kept) -> Outcome {
        if self.kept.len() >= MOST_HANDLES || self.kept.insert(handle, kept).is_some() {
            return Err(Failure::Malformed);
        }
        Ok(())
    }

    fn reserve(&mut self, handle: u32) -> Outcome<impl FnOnce(Kept) + Send + use<>> {
        self.keep(handle, Kept::Nothing)?;
        self.shared.lock().awaited.insert(handle, None);
        let shared = Arc::clone(&self.shared);
        Ok(move |it| hand_over(&shared, handle, it))
    }

    fn reserve_file(&mut self, handle: u32) -> Outcome<impl FnOnce(Kept) + Send + use<>> {
        self.files.retain(|it| self.kept.contains_key(it));
        if self.files.len() >= MOST_FILES {
            return Err(Failure::Refused);
        }
        self.files.push(handle);
        self.reserve(handle)
    }

    fn take_transaction(&mut self, handle: u32) -> Outcome<Box<Supervised>> {
        kept!(self, handle, Kept::Transaction(_) => {});
        match self.kept.remove(&handle) {
            Some(Kept::Transaction(it)) => Ok(it),
            _ => Err(Failure::Refused),
        }
    }

    fn turn(&mut self, handle: u32) -> Outcome<Arc<Turn>> {
        Ok(kept!(self, handle, Kept::Turn(it) => Arc::clone(it)))
    }

    fn session(&self, shelf: &Shelf) -> Outcome<Arc<Session>> {
        (grants::has_shelf(self.peer, shelf).then(|| Session::find(shelf.session)))
            .ok_or(Failure::Refused)
    }

    fn caches(&self, shelf: Shelf, cache: Option<CacheId>) -> Outcome<Caches> {
        if cache.is_some_and(|it| !self.shared.lock().caches.contains(&(shelf.session, it))) {
            return Err(Failure::Refused);
        }
        Ok(Caches {
            storage: Arc::clone(&self.session(&shelf)?.storage),
            bucket: shelf.bucket,
        })
    }

    fn locate(&self, Entry { shelf, names }: Entry) -> Outcome<Locator> {
        if names.len() > MOST_NAMES || !names.iter().all(|it| is_valid_name(it)) {
            return Err(Failure::Refused);
        }
        let storage = Arc::clone(&self.session(&shelf)?.storage);
        Ok(Locator::new(storage, &shelf.bucket, names))
    }

    fn later(
        &self,
        ticket: u32,
        ruling: impl Future<Output = Option<Ruling>> + Send + 'static,
    ) -> Outcome {
        if self.calls.fetch_add(1, Ordering::Relaxed) >= MOST_CALLS + MOST_HANDLES as u32 * 2 {
            return Err(Failure::Malformed);
        }
        let (peer, calls) = (self.peer, Arc::clone(&self.calls));
        self.line.detach(async move {
            rule(peer, ticket, ruling.await);
            calls.fetch_sub(1, Ordering::Relaxed);
        });
        Ok(())
    }

    fn wait_for_turn(&self) -> Arc<AtomicU32> {
        loop {
            match self.busy.load(Ordering::Acquire) {
                busy @ MOST_AT_A_TIME.. => Futex::wait_forever(&self.busy, busy),
                _ => break,
            }
        }
        self.busy.fetch_add(1, Ordering::AcqRel);
        Arc::clone(&self.busy)
    }

    fn call<T>(
        &self,
        ticket: u32,
        result: impl Future<Output = T> + Send + 'static,
        ruling: fn(T) -> Ruling,
    ) -> Outcome
    where
        T: 'static,
    {
        let busy = self.wait_for_turn();
        self.later(ticket, async move {
            let result = result.await;
            busy.fetch_sub(1, Ordering::AcqRel);
            Futex::wake(&busy, 1);
            Some(ruling(result))
        })
    }

    fn count(&mut self, petition: &Petition, size: usize) -> wire::Result<()> {
        match *petition {
            Petition::Release { handle } => {
                self.in_handles -= self.sizes.remove(&handle).unwrap_or(0);
            }
            Petition::Write {
                transaction: handle,
                ..
            }
            | Petition::Run {
                transaction: handle,
                ..
            }
            | Petition::Commit {
                transaction: handle,
                ..
            }
            | Petition::Begin {
                transaction: handle,
                ..
            }
            | Petition::RequestLock { lock: handle, .. }
            | Petition::Join { member: handle, .. }
            | Petition::TakeTurn { turn: handle, .. } => {
                *self.sizes.entry(handle).or_default() += size;
                self.in_handles += size;
            }
            _ => {}
        }
        match self.in_handles <= MOST_IN_HANDLES && self.sizes.len() <= MOST_HANDLES {
            true => Ok(()),
            false => Err(Malformed),
        }
    }

    fn connect(&mut self, turn: u32, connection: u32) -> Outcome {
        let (peer, shared) = (self.peer, Arc::downgrade(&self.shared));
        let notify = move |notice| match notice {
            Notice::VersionChange {
                new_version,
                handled,
            } => {
                let Some(shared) = shared.upgrade() else {
                    return;
                };
                let mut shared = shared.lock();
                shared.last_event += 1;
                let event = shared.last_event;
                shared.events.insert(event, handled);
                drop(shared);
                let news = Tidings::VersionChange { new_version, event };
                tell(peer, connection, news);
            }
            Notice::Erased => tell(peer, connection, Tidings::Erased),
        };
        let kept = Kept::Connection {
            connection: self.turn(turn)?.connect(notify),
            waiting: Vec::new(),
        };
        self.keep(connection, kept)
    }

    fn obey(&mut self, ticket: u32, petition: Petition) -> Outcome {
        match petition {
            Petition::Release { handle } => {
                let arrived = self.shared.lock().awaited.remove(&handle);
                drop((arrived, self.kept.remove(&handle)));
                Ok(())
            }
            Petition::Connect { turn, connection } => self.connect(turn, connection),
            Petition::Handled { event, is_open } => {
                let handled = self.shared.lock().events.remove(&event);
                handled.into_iter().for_each(|it| it.send(is_open));
                Ok(())
            }
            Petition::Write { transaction, steps } => {
                let it = kept!(self, transaction, Kept::Transaction(it) => it);
                Ok(it.run(steps, Operation::Nothing).map(drop)?)
            }
            Petition::Abort { transaction } => {
                let _place = self.take_transaction(transaction)?.abort();
                self.keep(transaction, Kept::Place { _place })
            }
            Petition::Persist { shelf } => {
                self.session(&shelf)?.storage.persist(&shelf.bucket);
                Ok(())
            }
            Petition::RequestLock {
                lock,
                shelf,
                info,
                priority,
                answer,
                theft,
            } => {
                let locks = self.session(&shelf)?.locks_of(&shelf.bucket);
                let (_request, answered, stolen) = locks.request(info, priority);
                self.keep(lock, Kept::Lock { _request })?;
                self.later(answer, async { answered.await.map(Ruling::Answered) })?;
                self.later(theft, async { stolen.await.map(Ruling::Stolen) })
            }
            Petition::Broadcast { member, value } => {
                kept!(self, member, Kept::Broadcast(it) => it.send(&value));
                Ok(())
            }
            Petition::TakeTurn { turn, shelf, name } => {
                require_key(&name)?;
                let database = (self.session(&shelf)?.storage).near_database(&shelf.bucket, name);
                let hand_over = self.reserve(turn)?;
                self.later(ticket, async {
                    hand_over(Kept::Turn(database.take_turn().await?.into()));
                    Some(Ruling::TakeTurn(()))
                })
            }
            Petition::Schema { turn } => {
                let turn = self.turn(turn)?;
                let schema = async move { turn.schema().await.map(Arc::unwrap_or_clone) };
                self.call(ticket, schema, Ruling::Schema)
            }
            Petition::Announce { turn, new_version } => {
                let turn = self.turn(turn)?;
                let is_blocked = async move { turn.announce(new_version).await };
                self.later(ticket, async { Some(Ruling::Announce(is_blocked.await)) })
            }
            Petition::UntilUnused { turn } => {
                let turn = self.turn(turn)?;
                self.later(ticket, async move {
                    turn.until_unused().await;
                    Some(Ruling::UntilUnused(()))
                })
            }
            Petition::Erase { turn } => {
                let turn = self.turn(turn)?;
                self.call(ticket, async move { turn.erase().await }, Ruling::Erase)
            }
            Petition::Commit {
                transaction,
                steps,
                schema,
                is_strict,
            } => {
                let mut it = self.take_transaction(transaction)?;
                drop(it.run(steps, Operation::Nothing)?);
                let (committed, hand_over) =
                    (it.commit(schema, is_strict)?, self.reserve(transaction)?);
                self.later(ticket, async {
                    let (result, _place) = committed.await;
                    hand_over(Kept::Place { _place });
                    Some(Ruling::Commit(result))
                })
            }
            Petition::Databases { shelf } => {
                let storage = Arc::clone(&self.session(&shelf)?.storage);
                let all = storage.databases(shelf.bucket.into());
                self.call(ticket, all, Ruling::Databases)
            }
            Petition::Usage { shelf } => {
                let storage = Arc::clone(&self.session(&shelf)?.storage);
                self.call(ticket, storage.usage(shelf.bucket.into()), Ruling::Usage)
            }
            Petition::CacheNames { shelf } => {
                let names = self.caches(shelf, None)?.names();
                self.call(ticket, names, Ruling::CacheNames)
            }
            Petition::HasCache { shelf, name } => {
                let has = self.caches(shelf, None)?.has(name);
                self.call(ticket, has, Ruling::HasCache)
            }
            Petition::OpenCache { shelf, name } => {
                let (session, shared) = (shelf.session, Arc::clone(&self.shared));
                let opened = self.caches(shelf, None)?.open(name);
                let note = move |it: &CacheId| {
                    let known = &mut shared.lock().caches;
                    if !known.contains(&(session, *it)) {
                        known.push_back((session, *it));
                    }
                    if known.len() > MOST_CACHES {
                        known.pop_front();
                    }
                };
                let opened = async { Ok::<_, SqlError>(opened.await?).inspect(note) };
                self.call(ticket, opened, Ruling::OpenCache)
            }
            Petition::DeleteCache { shelf, name } => {
                let deleted = self.caches(shelf, None)?.delete(name);
                self.call(ticket, deleted, Ruling::DeleteCache)
            }
            Petition::FirstResponse {
                shelf,
                name,
                asked,
                options,
            } => {
                let found = (self.caches(shelf, None)?).first_response(name, asked, options);
                self.call(ticket, found, Ruling::FirstResponse)
            }
            Petition::Requests {
                shelf,
                cache,
                asked,
                options,
            } => {
                let found = (self.caches(shelf, Some(cache))?).requests(cache, asked, options);
                self.call(ticket, found, Ruling::Requests)
            }
            Petition::Responses {
                shelf,
                cache,
                asked,
                options,
                limit,
            } => {
                let caches = self.caches(shelf, Some(cache))?;
                let found = caches.responses(cache, asked, options, limit);
                self.call(ticket, found, Ruling::Responses)
            }
            Petition::RemoveCached {
                shelf,
                cache,
                asked,
                options,
            } => {
                let removed = (self.caches(shelf, Some(cache))?).remove(cache, asked, options);
                self.call(ticket, removed, Ruling::RemoveCached)
            }
            Petition::PutCached {
                shelf,
                cache,
                entries,
            } => {
                let stored = (self.caches(shelf, Some(cache))?).put(cache, entries);
                self.call(ticket, stored, Ruling::PutCached)
            }
            Petition::CreateRoot { shelf } => {
                let names = Vec::new();
                let created = self.locate(Entry { shelf, names })?.create_root();
                self.call(ticket, created, Ruling::CreateRoot)
            }
            Petition::Find {
                entry,
                kind,
                creates,
            } => {
                let found = self.locate(entry)?.find(kind, creates);
                self.call(ticket, found, Ruling::Find)
            }
            Petition::Children { entry } => {
                self.call(ticket, self.locate(entry)?.children(), Ruling::Children)
            }
            Petition::Remove {
                entry,
                is_recursive,
            } => {
                let removed = self.locate(entry)?.remove(is_recursive);
                self.call(ticket, removed, Ruling::Remove)
            }
            Petition::Move { entry, target } if entry.shelf == target.shelf => {
                let moved = self.locate(entry)?.move_file(self.locate(target)?);
                self.call(ticket, moved, Ruling::Move)
            }
            Petition::Snapshot { entry } => {
                let (peer, found) = (self.peer, self.locate(entry)?.snapshot());
                let path = async move {
                    (found.await.map(|it| it.0)).inspect(|it| grants::grant(peer, it))
                };
                self.call(ticket, path, Ruling::Snapshot)
            }
            Petition::Open { file, entry, mode } => {
                let (locator, hand_over) = (self.locate(entry)?, self.reserve_file(file)?);
                let opened = locator.open(mode);
                let opened = async { opened.await.map(Kept::File).map(hand_over) };
                self.call(ticket, opened, Ruling::Open)
            }
            Petition::Draft {
                draft,
                entry,
                mode,
                keeps_data,
            } => {
                let (locator, hand_over) = (self.locate(entry)?, self.reserve_file(draft)?);
                let made = locator.draft(mode, keeps_data);
                let made = async { made.await.map(Kept::Draft).map(hand_over) };
                self.call(ticket, made, Ruling::Draft)
            }
            Petition::Keep { draft } => {
                let draft = kept!(self, draft, Kept::Draft(it) => it.clone());
                self.call(ticket, draft.keep(), Ruling::Keep)
            }
            _ => Err(Failure::Malformed),
        }
    }

    fn answer(&mut self, petition: Petition) -> Outcome<(Ruling, Option<File>)> {
        let ruling = match petition {
            Petition::OpenFile { path } => {
                let (opened, file) = match grants::is_granted(self.peer, &path) {
                    true => open_file(&path),
                    false => return Err(Failure::Refused),
                };
                return Ok((Ruling::OpenFile(opened), file));
            }
            Petition::Descriptor { of } => {
                let file = match self.get(of) {
                    Some(Kept::File(it)) => bun_sys::dup(it.fd()).ok().map(File::from_fd),
                    Some(Kept::Draft(it)) => it.duplicate_file(),
                    _ => None,
                };
                return Ok((Ruling::Descriptor(()), file));
            }
            Petition::Begin {
                connection,
                transaction,
                mode,
                tables,
                started,
            } => {
                let (begun, start, mut waiting) = kept!(
                    self, connection,
                    Kept::Connection { connection, waiting } => {
                        let (begun, start) = Supervised::begin(connection, mode, tables);
                        (begun, start, core::mem::take(waiting))
                    }
                );
                self.keep(transaction, Kept::Transaction(begun.into()))?;
                let mut have_started = Vec::new();
                waiting.retain(|id| match self.kept.get(id) {
                    Some(Kept::Transaction(it)) if it.has_started() => {
                        have_started.push(*id);
                        false
                    }
                    other => matches!(other, Some(Kept::Transaction(_))),
                });
                match start {
                    Some(start) => {
                        waiting.push(transaction);
                        self.later(started, async { start.await.map(Ruling::Started) })?;
                    }
                    None => have_started.push(transaction),
                }
                kept!(self, connection, Kept::Connection { waiting: it, .. } => *it = waiting);
                Ruling::Begin(have_started)
            }
            Petition::Run {
                transaction,
                steps,
                then,
            } => {
                Ruling::Run(kept!(self, transaction, Kept::Transaction(it) => it.run(steps, then)?))
            }
            Petition::Join {
                member,
                shelf,
                name,
            } => {
                self.session(&shelf)?;
                let joined = FarBroadcast::join(self.peer, member, &shelf, &name);
                self.keep(member, Kept::Broadcast(joined))?;
                Ruling::Join(())
            }
            Petition::IsPersisted { shelf } => {
                Ruling::IsPersisted(self.session(&shelf)?.storage.is_persisted(&shelf.bucket))
            }
            Petition::QueryLocks { shelf } => {
                Ruling::QueryLocks(self.session(&shelf)?.locks_of(&shelf.bucket).query().into())
            }
            _ => return Err(Failure::Malformed),
        };
        Ok((ruling, None))
    }

    fn accept(&mut self, message: &[u8]) -> wire::Result<()> {
        let (head, petition) = (Head::of(message)?, super::open(self.peer, message)?);
        self.count(&petition, message.len())?;
        if !Petition::is_waited_for(&petition) {
            return match self.obey(head.ticket, petition) {
                Err(Failure::Malformed) => Err(Malformed),
                Err(Failure::Refused) if head.ticket != 0 => {
                    rule(self.peer, head.ticket, None);
                    Ok(())
                }
                _ => Ok(()),
            };
        }
        let (ruling, file) = match self.answer(petition) {
            Ok((ruling, file)) => (wire::encode_for(Some(self.peer), &[], ruling), file),
            Err(Failure::Refused) => (None, None),
            Err(Failure::Malformed) => return Err(Malformed),
        };
        let bytes = ruling.map(|it| it.0).unwrap_or_default();
        let descriptor = file.as_ref().map_or(-1, |it| it.fd().uv());
        // SAFETY: a slice, and a descriptor that is open.
        unsafe { (self.ui.rule)(self.peer, bytes.as_ptr(), bytes.len(), descriptor) };
        Ok(())
    }
}

/// Until the process is gone.
pub fn employ(peer: Peer, ui: &'static Ui) {
    grants::begin(peer);
    crate::outside::serve::begin(peer);
    let work = move || {
        let mut clerk = Clerk {
            ui,
            peer,
            kept: HashMap::default(),
            files: Vec::new(),
            shared: Arc::default(),
            calls: Arc::default(),
            busy: Arc::default(),
            line: Arc::default(),
            sizes: HashMap::default(),
            in_handles: 0,
        };
        while clerk.accept(&(ui.next_petition)(peer)).is_ok() {}
        (ui.tell_page_process)(peer, PageCommand::Close);
        let shared = core::mem::take(&mut *clerk.shared.lock());
        drop(shared);
    };
    let thread = std::thread::Builder::new().name("clerk".into());
    if thread.stack_size(1 << 20).spawn(work).is_err() {
        (ui.tell_page_process)(peer, PageCommand::Close);
    }
}
