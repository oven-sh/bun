//! What <https://w3c.github.io/IndexedDB/> stores. The keys of what is in use are in memory, for all threads.

pub mod either;
pub(crate) mod far;

use core::ops::Bound::{Excluded, Included, Unbounded};
use core::sync::atomic::{AtomicUsize, Ordering};
use core::time::Duration;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

use bun_threading::guarded::GuardedLock;
use bun_threading::{Guarded, Mutex};

use super::Storage;
use super::key::{self, Key, KeyRange};
use super::large::LARGE;
use super::sql::{self, Connection as Sql, SqlError, Value::*};
use crate::Bytes;
use crate::HashMap;
use crate::exec::{Receiver, Sender, oneshot, sleep, spawn_background};
use crate::net::record::{RecordReader, RecordWriter};

const LAST_GENERATED_KEY: f64 = 9_007_199_254_740_992.0;
/// Of a bucket.
const MOST_IN_KEYS: usize = 2 << 30;
/// For who opens it for each use.
const KEPT_AFTER_CLOSING: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Failure {
    KeyExists,
    IndexKeyExists,
    NoKeyLeft,
    Erased,
    Sql(SqlError),
}

crate::wire!(impl enum Failure { KeyExists, IndexKeyExists, NoKeyLeft, Erased, Sql(SqlError), });

impl From<SqlError> for Failure {
    fn from(error: SqlError) -> Failure {
        Failure::Sql(error)
    }
}

type Result<T = ()> = core::result::Result<T, Failure>;

/// Of an object store, or of an index, whose entries are a key and then the key of the record.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Table(pub(super) i64);

crate::wire!(impl Table(_));

impl Table {
    fn unique() -> Table {
        Table((crate::random() >> 11) as i64)
    }
}

/// Names and key paths are encoded like keys.
#[derive(Clone)]
pub struct IndexSchema {
    pub table: Table,
    pub name: Key,
    pub key_path: Key,
    pub is_unique: bool,
    pub is_multi_entry: bool,
}

#[derive(Clone)]
pub struct StoreSchema {
    pub table: Table,
    pub name: Key,
    pub key_path: Option<Key>,
    pub auto_increments: bool,
    pub indexes: Vec<IndexSchema>,
}

#[derive(Clone, Default)]
pub struct Schema {
    pub version: u64,
    pub stores: Vec<StoreSchema>,
}

crate::wire!(impl IndexSchema { table, name, key_path, is_unique, is_multi_entry });
crate::wire!(impl StoreSchema { table, name, key_path, auto_increments, indexes });
crate::wire!(impl Schema { version, stores });

impl Schema {
    pub(super) fn serialize_stores(&self) -> Vec<u8> {
        let mut out = RecordWriter::default();
        out.count(self.stores.len());
        for store in &self.stores {
            out.number(store.table.0 as f64);
            out.bytes(&store.name);
            out.bytes(store.key_path.as_deref().unwrap_or_default());
            out.count(store.auto_increments.into());
            out.count(store.indexes.len());
            for index in &store.indexes {
                out.number(index.table.0 as f64);
                out.bytes(&index.name);
                out.bytes(&index.key_path);
                out.count(index.is_unique.into());
                out.count(index.is_multi_entry.into());
            }
        }
        out.0
    }

    fn parse_stores(bytes: &[u8]) -> Option<Vec<StoreSchema>> {
        let index = |it: &mut RecordReader<'_>| {
            Some(IndexSchema {
                table: Table(it.number()? as i64),
                name: it.bytes()?.into(),
                key_path: it.bytes()?.into(),
                is_unique: it.count()? == 1,
                is_multi_entry: it.count()? == 1,
            })
        };
        RecordReader(bytes).list(|it| {
            Some(StoreSchema {
                table: Table(it.number()? as i64),
                name: it.bytes()?.into(),
                key_path: Some(it.bytes()?).filter(|it| !it.is_empty()).map(Key::from),
                auto_increments: it.count()? == 1,
                indexes: it.list(index)?,
            })
        })
    }

    pub fn tables(&self) -> impl Iterator<Item = Table> {
        self.stores
            .iter()
            .flat_map(|it| it.indexes.iter().map(|it| it.table).chain([it.table]))
    }
}

/// How much memory keys take.
struct Weight {
    own: usize,
    of_bucket: Arc<AtomicUsize>,
}

impl Weight {
    const OF_ENTRY: usize = 32;

    fn new(of_bucket: &Arc<AtomicUsize>) -> Weight {
        Weight {
            own: 0,
            of_bucket: Arc::clone(of_bucket),
        }
    }

    fn add(&mut self, key: &[u8]) {
        self.own += key.len() + Weight::OF_ENTRY;
        self.of_bucket
            .fetch_add(key.len() + Weight::OF_ENTRY, Ordering::Relaxed);
    }

    fn remove(&mut self, key: &[u8]) {
        self.own -= key.len() + Weight::OF_ENTRY;
        self.of_bucket
            .fetch_sub(key.len() + Weight::OF_ENTRY, Ordering::Relaxed);
    }

    fn check_room(&self, bytes: usize) -> Result {
        if self.of_bucket.load(Ordering::Relaxed).saturating_add(bytes) <= MOST_IN_KEYS {
            Ok(())
        } else {
            Err(SqlError::TOO_BIG.into())
        }
    }
}

impl Drop for Weight {
    fn drop(&mut self) {
        self.of_bucket.fetch_sub(self.own, Ordering::Relaxed);
    }
}

struct Rows {
    keys: BTreeSet<Key>,
    weight: Weight,
    /// The entries of an index with their halves swapped, once they are needed.
    by_record: Option<BTreeSet<Key>>,
    next_key: f64,
}

fn swapped(entry: &[u8]) -> Key {
    let (first, second) = key::split(entry);
    [second, first].concat().into()
}

fn within<'k>(
    keys: &'k BTreeSet<Key>,
    range: &KeyRange,
) -> impl DoubleEndedIterator<Item = &'k Key> + use<'k> {
    keys.range::<[u8], _>((Included(&*range.from), Excluded(&*range.to)))
}

impl Rows {
    /// Whether it was there.
    fn set(&mut self, key: &Key, exists: bool) -> bool {
        if let Some(by_record) = &mut self.by_record {
            let entry = swapped(key);
            _ = if exists {
                by_record.insert(entry)
            } else {
                by_record.remove(&entry)
            };
        }
        let existed = if exists {
            !self.keys.insert(Arc::clone(key))
        } else {
            self.keys.remove(key)
        };
        match (existed, exists) {
            (false, true) => self.weight.add(key),
            (true, false) => self.weight.remove(key),
            _ => {}
        }
        existed
    }

    fn entries_for(&mut self, record: &[u8]) -> Vec<Key> {
        let by_record = self
            .by_record
            .get_or_insert_with(|| self.keys.iter().map(|it| swapped(it)).collect());
        within(by_record, &KeyRange::only(record))
            .map(|it| swapped(it))
            .collect()
    }

    fn first_from(&self, key: &[u8]) -> Option<&Key> {
        self.keys
            .range::<[u8], _>((Included(key), Unbounded))
            .next()
    }

    fn last_before(&self, key: &[u8]) -> Option<&Key> {
        self.keys
            .range::<[u8], _>((Unbounded, Excluded(key)))
            .next_back()
    }

    fn after(
        &self,
        range: &KeyRange,
        direction: Direction,
        position: Option<&[u8]>,
        target: Option<&[u8]>,
    ) -> Option<&Key> {
        let passed = position.map(|it| {
            if direction.skips_duplicates {
                key::split(it).0
            } else {
                it
            }
        });
        let next = match (direction.is_forward, target, passed) {
            (true, Some(target), _) => self.first_from(target),
            (true, None, Some(passed)) => self.first_from(&key::past(passed)),
            (true, None, None) => self.first_from(&range.from),
            (false, Some(target), _) => self.last_before(&key::past(target)),
            (false, None, passed) => self.last_before(passed.unwrap_or(&range.to)),
        };
        let next = next.filter(|it| range.includes(it))?;
        if direction.skips_duplicates && !direction.is_forward {
            self.first_from(key::split(next).0)
        } else {
            Some(next)
        }
    }
}

pub enum Notice {
    /// `handled` gets whether the connection is open after the event.
    VersionChange {
        new_version: Option<u64>,
        handled: Sender<bool>,
    },
    Erased,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    ReadOnly,
    ReadWrite,
    VersionChange,
}

crate::wire!(impl enum Mode { ReadOnly, ReadWrite, VersionChange, });

struct Scheduled {
    id: u32,
    mode: Mode,
    tables: Vec<Table>,
    /// Until it has started.
    start: Option<Sender<Result>>,
}

impl Scheduled {
    fn waits_for(&self, earlier: &Scheduled) -> bool {
        earlier.mode == Mode::VersionChange
            || ((self.mode, earlier.mode) != (Mode::ReadOnly, Mode::ReadOnly)
                && earlier.tables.iter().any(|it| self.tables.contains(it)))
    }
}

#[derive(Default)]
struct State {
    schema: Option<Arc<Schema>>,
    tables: HashMap<Table, Rows>,
    weight_of_bucket: Arc<AtomicUsize>,
    times_erased: u32,
    last_id: u32,
    connections: Vec<(u32, Box<dyn Fn(Notice) + Send>)>,
    transactions: Vec<Scheduled>,
    is_turn_taken: bool,
    turns: VecDeque<Sender<Turn>>,
    when_unused: Option<Sender<()>>,
}

impl State {
    fn next_id(&mut self) -> u32 {
        self.last_id += 1;
        self.last_id
    }

    fn check_unused(&mut self) {
        if self.connections.is_empty() && self.transactions.is_empty() {
            self.when_unused = None;
        }
    }

    fn rows(&mut self, table: Table) -> &mut Rows {
        self.tables.entry(table).or_insert_with(|| Rows {
            keys: BTreeSet::new(),
            weight: Weight::new(&self.weight_of_bucket),
            by_record: None,
            next_key: 1.0,
        })
    }
}

pub struct Database {
    storage: Arc<Storage>,
    pub(super) bucket: Bytes,
    pub(super) name: Key,
    state: Guarded<State>,
}

/// <https://w3c.github.io/IndexedDB/#connection-queue>: the next one comes when it is dropped.
pub struct Turn(Arc<Database>);

impl Drop for Turn {
    fn drop(&mut self) {
        let next = {
            let mut state = self.0.state.lock();
            let next = core::iter::from_fn(|| state.turns.pop_front()).find(|it| !it.is_closed());
            state.is_turn_taken = next.is_some();
            next
        };
        if let Some(next) = next {
            next.send(Turn(Arc::clone(&self.0)));
        }
    }
}

impl Turn {
    pub async fn schema(&self) -> Result<Arc<Schema>> {
        if let Some(schema) = &self.0.state.lock().schema {
            return Ok(Arc::clone(schema));
        }
        let database = Arc::clone(&self.0);
        let stored = self.0.storage.write(move |sql| {
            if !database
                .storage
                .has_looked_for_unused_values
                .swap(true, Ordering::Relaxed)
            {
                let _ = database.storage.remove_unused_large_values(sql);
            }
            let read = |it: &sql::Row<'_>| {
                Some(Schema {
                    version: it.integer(0) as u64,
                    stores: Schema::parse_stores(it.bytes(1))?,
                })
            };
            sql.one(
                "SELECT version, stores FROM databases WHERE bucket = ? AND name = ?",
                &[Text(&database.bucket), Blob(&database.name)],
                read,
            )
        });
        let schema = stored.await?.flatten().unwrap_or_default();
        Ok(Arc::clone(
            self.0
                .state
                .lock()
                .schema
                .get_or_insert_with(|| Arc::new(schema)),
        ))
    }

    /// Whether a connection was still open after it had heard of it.
    pub async fn announce(&self, new_version: Option<u64>) -> bool {
        let announce = |it: &(u32, Box<dyn Fn(Notice) + Send>)| {
            let (handled, receiver) = oneshot();
            it.1(Notice::VersionChange {
                new_version,
                handled,
            });
            receiver
        };
        let events: Vec<_> = self
            .0
            .state
            .lock()
            .connections
            .iter()
            .map(announce)
            .collect();
        let mut is_blocked = false;
        for event in events {
            is_blocked |= event.await == Some(true);
        }
        is_blocked
    }

    pub async fn until_unused(&self) {
        let (sender, receiver) = oneshot();
        {
            let mut state = self.0.state.lock();
            state.when_unused = Some(sender);
            state.check_unused();
        }
        receiver.await;
    }

    /// `notify` is called on any thread, with the database locked.
    pub fn connect(&self, notify: impl Fn(Notice) + Send + 'static) -> Connection {
        let mut state = self.0.state.lock();
        let id = state.next_id();
        state.connections.push((id, Box::new(notify)));
        Connection {
            database: Arc::clone(&self.0),
            id,
            times_erased: state.times_erased,
        }
    }

    pub async fn erase(&self) -> Result {
        Ok(self.0.erase().await?)
    }
}

impl Database {
    /// `sibling` is in the same bucket.
    pub(super) fn new(
        storage: Arc<Storage>,
        bucket: &[u8],
        name: Key,
        sibling: Option<&Database>,
    ) -> Database {
        let weight_of_bucket = sibling
            .map(|it| Arc::clone(&it.state.lock().weight_of_bucket))
            .unwrap_or_default();
        Database {
            storage,
            bucket: bucket.into(),
            name,
            state: Guarded::new(State {
                weight_of_bucket,
                ..State::default()
            }),
        }
    }

    pub async fn take_turn(self: Arc<Self>) -> Option<Turn> {
        let (sender, receiver) = oneshot();
        {
            let mut state = self.state.lock();
            if !core::mem::replace(&mut state.is_turn_taken, true) {
                return Some(Turn(Arc::clone(&self)));
            }
            state.turns.push_back(sender);
        }
        receiver.await
    }

    /// In memory. What is stored is for the caller to delete.
    pub(super) fn forget(&self) {
        let mut state = self.state.lock();
        (state.schema, state.tables) = (Some(Arc::default()), HashMap::default());
        state.times_erased += 1;
        state.connections.iter().for_each(|it| it.1(Notice::Erased));
    }

    fn erase(self: &Arc<Self>) -> impl Future<Output = sql::Result> + use<> {
        self.forget();
        let database = Arc::clone(self);
        self.storage.write(move |sql| {
            sql.atomically(|sql| erase(sql, &database.bucket, &database.name))?;
            let _ = database.storage.remove_unused_large_values(sql);
            Ok(())
        })
    }

    fn start_transactions(self: &Arc<Self>, state: &mut State) {
        for at in 0..state.transactions.len() {
            let (earlier, [it, ..]) = state.transactions.split_at_mut(at) else {
                return;
            };
            let Some(start) = it.start.take_if(|_| true) else {
                continue;
            };
            if earlier.iter().any(|earlier| it.waits_for(earlier)) {
                it.start = Some(start);
                continue;
            }
            let missing: Vec<_> = it
                .tables
                .iter()
                .copied()
                .filter(|it| !state.tables.contains_key(it))
                .collect();
            if missing.is_empty() {
                start.send(Ok(()));
            } else {
                let (database, times_erased) = (Arc::clone(self), state.times_erased);
                drop(self.storage.write(move |sql| {
                    start.send(
                        missing
                            .into_iter()
                            .try_for_each(|it| database.load(sql, it, times_erased)),
                    );
                    sql::Result::Ok(())
                }));
            }
        }
    }

    fn load(&self, sql: &mut Sql, table: Table, times_erased: u32) -> Result {
        if self.state.lock().tables.contains_key(&table) {
            return Ok(());
        }
        let mut weight = Weight::new(&self.state.lock().weight_of_bucket);
        weight.check_room(0)?;
        let keys = sql.all(
            "SELECT key FROM records WHERE tab = ? ORDER BY key",
            &[Integer(table.0)],
            |it| Key::from(it.bytes(0)),
        )?;
        let next_key = sql
            .one(
                "SELECT next_key FROM tables WHERE id = ?",
                &[Integer(table.0)],
                |it| it.real(0),
            )?
            .unwrap_or(1.0);
        keys.iter().for_each(|it| weight.add(it));
        let rows = Rows {
            keys: keys.into_iter().collect(),
            weight,
            by_record: None,
            next_key,
        };
        self.lock_unless_erased(times_erased)?
            .tables
            .insert(table, rows);
        Ok(())
    }

    fn lock_unless_erased(&self, times_erased: u32) -> Result<GuardedLock<'_, State, Mutex>> {
        Some(self.state.lock())
            .filter(|it| it.times_erased == times_erased)
            .ok_or(Failure::Erased)
    }
}

pub(super) fn erase(sql: &mut Sql, bucket: &[u8], name: &[u8]) -> sql::Result {
    let database = [Text(bucket), Blob(name)];
    sql.run(
        "DELETE FROM records WHERE tab IN (SELECT id FROM tables WHERE bucket = ? AND name = ?)",
        &database,
    )?;
    sql.run(
        "DELETE FROM tables WHERE bucket = ? AND name = ?",
        &database,
    )?;
    sql.run(
        "DELETE FROM databases WHERE bucket = ? AND name = ?",
        &database,
    )
}

/// Closed when it is dropped.
pub struct Connection {
    database: Arc<Database>,
    id: u32,
    times_erased: u32,
}

impl Drop for Connection {
    fn drop(&mut self) {
        let mut state = self.database.state.lock();
        state.connections.retain(|it| it.0 != self.id);
        state.check_unused();
        let database = Arc::clone(&self.database);
        self.database.storage.main.post(move || {
            spawn_background(async move {
                sleep(KEPT_AFTER_CLOSING).await;
                drop(database);
            });
        });
    }
}

impl Connection {
    /// `tables` are those of the stores and of their indexes. With what to wait for, unless it has started.
    pub fn begin(&self, mode: Mode, tables: Vec<Table>) -> (Transaction, Option<Receiver<Result>>) {
        let mut state = self.database.state.lock();
        let mut scheduled = Scheduled {
            id: state.next_id(),
            mode,
            tables,
            start: None,
        };
        let has_started = !state.transactions.iter().any(|it| scheduled.waits_for(it))
            && scheduled
                .tables
                .iter()
                .all(|it| state.tables.contains_key(it));
        let started = (!has_started).then(|| {
            let (sender, receiver) = oneshot();
            scheduled.start = Some(sender);
            receiver
        });
        let place = Place {
            database: Arc::clone(&self.database),
            id: scheduled.id,
        };
        state.transactions.push(scheduled);
        if !has_started {
            self.database.start_transactions(&mut state);
        }
        let weight = Weight::new(&state.weight_of_bucket);
        (
            Transaction {
                place: Some(place),
                times_erased: self.times_erased,
                written: Vec::new(),
                cleared: Vec::new(),
                undo: Vec::new(),
                weight,
            },
            started,
        )
    }
}

/// Later transactions wait until it is dropped.
pub struct Place {
    database: Arc<Database>,
    id: u32,
}

impl Drop for Place {
    fn drop(&mut self) {
        let mut state = self.database.state.lock();
        state.transactions.retain(|it| it.id != self.id);
        self.database.start_transactions(&mut state);
        state.check_unused();
    }
}

/// `None` is a deletion.
type Written = BTreeMap<Key, Option<Bytes>>;

enum Undo {
    Write {
        table: Table,
        key: Key,
        existed: bool,
        before: Option<Option<Bytes>>,
    },
    Clear {
        table: Table,
        keys: BTreeSet<Key>,
        weight: Weight,
        written: Written,
    },
    NextKey {
        table: Table,
        before: f64,
    },
}

#[derive(Clone)]
pub struct IndexKeys {
    pub table: Table,
    pub is_unique: bool,
    pub keys: Vec<Vec<u8>>,
}

#[derive(Clone, Copy)]
pub struct Direction {
    pub is_forward: bool,
    /// Only for an index.
    pub skips_duplicates: bool,
}

crate::wire!(impl IndexKeys { table, is_unique, keys });
crate::wire!(impl Direction { is_forward, skips_duplicates });

/// One after the other.
#[derive(Default)]
pub struct Values {
    bytes: Vec<u8>,
    ends: Vec<usize>,
    /// If only the first one is needed now: how many have been left out at the end.
    skipped: Option<usize>,
    most_bytes: Option<usize>,
}

impl Values {
    const AHEAD: usize = 256 << 10;

    fn skips(&mut self, is_large: bool) -> bool {
        let is_enough = !self.ends.is_empty() && (is_large || self.bytes.len() > Self::AHEAD);
        self.skipped
            .as_mut()
            .filter(|it| is_enough || **it > 0)
            .map(|it| *it += 1)
            .is_some()
    }

    fn push(&mut self, value: &[u8]) {
        if self.skips(value.len() >= LARGE) {
            return;
        }
        self.bytes.extend_from_slice(value);
        self.ends.push(self.bytes.len());
    }

    fn check_size(&self) -> sql::Result {
        self.most_bytes
            .is_none_or(|it| self.bytes.len() <= it)
            .then_some(())
            .ok_or(SqlError::TOO_BIG)
    }

    fn push_stored(&mut self, row: &sql::Row<'_>, storage: &Storage) -> sql::Result {
        self.check_size()?;
        if !row.is_text(0) {
            self.push(row.bytes(0));
            return Ok(());
        }
        if self.skips(true) {
            return Ok(());
        }
        storage.read_large_value(row.bytes(0), &mut self.bytes)?;
        self.ends.push(self.bytes.len());
        Ok(())
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = &[u8]> {
        let mut start = 0;
        self.ends
            .iter()
            .map(move |end| &self.bytes[core::mem::replace(&mut start, *end)..*end])
    }
}

/// The values of the entries that a cursor comes to next.
#[derive(Default)]
pub struct Ahead {
    entries: Vec<Key>,
    values: Values,
    next: usize,
    /// If they are from another process: how often the transaction had written.
    times_written: u32,
}

impl Ahead {
    pub fn value(&self) -> &[u8] {
        let Values { bytes, ends, .. } = &self.values;
        &bytes[self.next.checked_sub(2).map_or(0, |it| ends[it])..ends[self.next - 1]]
    }
}

pub struct Walk<'w> {
    pub store: Table,
    pub index: Option<Table>,
    pub range: &'w KeyRange,
    pub direction: Direction,
}

/// Aborted when it is dropped.
pub struct Transaction {
    place: Option<Place>,
    times_erased: u32,
    written: Vec<(Table, Written)>,
    cleared: Vec<Table>,
    undo: Vec<Undo>,
    /// Of the keys in `undo`.
    weight: Weight,
}

/// With the database locked.
struct Writer<'t> {
    state: GuardedLock<'t, State, Mutex>,
    written: &'t mut Vec<(Table, Written)>,
    cleared: &'t mut Vec<Table>,
    undo: &'t mut Vec<Undo>,
    weight: &'t mut Weight,
}

impl Writer<'_> {
    fn written_to(&mut self, table: Table) -> &mut Written {
        let at = self
            .written
            .iter()
            .position(|it| it.0 == table)
            .unwrap_or_else(|| {
                self.written.push((table, Written::new()));
                self.written.len() - 1
            });
        &mut self.written[at].1
    }

    fn write(&mut self, table: Table, key: Key, value: Option<Bytes>) {
        let existed = self.state.rows(table).set(&key, value.is_some());
        let before = self.written_to(table).insert(Arc::clone(&key), value);
        self.weight.add(&key);
        self.undo.push(Undo::Write {
            table,
            key,
            existed,
            before,
        });
    }

    fn remove_from_index(&mut self, index: Table, record: &[u8]) {
        for entry in self.state.rows(index).entries_for(record) {
            self.write(index, entry, None);
        }
    }

    fn add_to_index(&mut self, index: &IndexKeys, record: &[u8]) -> Result {
        self.weight
            .check_room(index.keys.iter().fold(0, |all: usize, it| {
                all.saturating_add(it.len() + record.len())
            }))?;
        for key in &index.keys {
            if index.is_unique
                && self
                    .state
                    .rows(index.table)
                    .first_from(key)
                    .is_some_and(|it| it.starts_with(key))
            {
                return Err(Failure::IndexKeyExists);
            }
            self.write(
                index.table,
                [key, record].concat().into(),
                Some(Bytes::default()),
            );
        }
        Ok(())
    }

    fn set_next_key(&mut self, table: Table, after: f64) {
        let next = if after >= LAST_GENERATED_KEY {
            LAST_GENERATED_KEY * 2.0
        } else {
            after.floor() + 1.0
        };
        let before = core::mem::replace(&mut self.state.rows(table).next_key, next);
        self.undo.push(Undo::NextKey { table, before });
    }
}

impl Transaction {
    fn database(&self) -> &Arc<Database> {
        &self.place.as_ref().expect("it has not ended").database
    }

    fn writer(&mut self) -> Result<Writer<'_>> {
        let state = self
            .place
            .as_ref()
            .ok_or(Failure::Erased)?
            .database
            .lock_unless_erased(self.times_erased)?;
        Ok(Writer {
            state,
            written: &mut self.written,
            cleared: &mut self.cleared,
            undo: &mut self.undo,
            weight: &mut self.weight,
        })
    }

    fn with_rows<R>(&self, table: Table, read: impl FnOnce(&Rows) -> R) -> Result<R> {
        Ok(read(
            self.database()
                .lock_unless_erased(self.times_erased)?
                .rows(table),
        ))
    }

    pub fn has_started(&self) -> bool {
        self.place.as_ref().is_some_and(|place| {
            let state = place.database.state.lock();
            state.transactions.iter().any(|it| {
                it.id == place.id
                    && it.start.is_none()
                    && it.tables.iter().all(|it| state.tables.contains_key(it))
            })
        })
    }

    /// For its turn, or for its keys, unless all is gone.
    fn is_waiting(&self) -> bool {
        self.database()
            .lock_unless_erased(self.times_erased)
            .map(drop)
            .is_ok()
            && !self.has_started()
    }

    pub fn new_table(&self) -> Table {
        Table::unique()
    }

    /// For [`roll_back`](Self::roll_back).
    pub fn mark(&self) -> usize {
        self.undo.len()
    }

    pub fn roll_back(&mut self, mark: usize) {
        let Ok(mut it) = self.writer() else { return };
        while let Some(undo) = (it.undo.len() > mark).then(|| it.undo.pop()).flatten() {
            match undo {
                Undo::Write {
                    table,
                    key,
                    existed,
                    before,
                } => {
                    it.weight.remove(&key);
                    it.state.rows(table).set(&key, existed);
                    _ = match before {
                        Some(before) => it.written_to(table).insert(key, before),
                        None => it.written_to(table).remove(&key),
                    };
                }
                Undo::Clear {
                    table,
                    keys,
                    weight,
                    written,
                } => {
                    let rows = it.state.rows(table);
                    (rows.keys, rows.weight, rows.by_record) = (keys, weight, None);
                    *it.written_to(table) = written;
                    it.cleared.pop();
                }
                Undo::NextKey { table, before } => it.state.rows(table).next_key = before,
            }
        }
    }

    pub fn generate_key(&mut self, store: Table) -> Result<f64> {
        let mut it = self.writer()?;
        let key = Some(it.state.rows(store).next_key)
            .filter(|it| *it <= LAST_GENERATED_KEY)
            .ok_or(Failure::NoKeyLeft)?;
        it.set_next_key(store, key);
        Ok(key)
    }

    /// <https://w3c.github.io/IndexedDB/#possibly-update-the-key-generator>
    pub fn update_key_generator(&mut self, store: Table, key: f64) -> Result {
        let mut it = self.writer()?;
        if key >= it.state.rows(store).next_key {
            it.set_next_key(store, key);
        }
        Ok(())
    }

    pub fn put(
        &mut self,
        store: Table,
        key: &Key,
        value: Bytes,
        indexes: &[IndexKeys],
        replaces: bool,
    ) -> Result {
        let mut it = self.writer()?;
        it.weight.check_room(key.len())?;
        if (!replaces || !indexes.is_empty()) && it.state.rows(store).keys.contains(key) {
            if !replaces {
                return Err(Failure::KeyExists);
            }
            indexes
                .iter()
                .for_each(|index| it.remove_from_index(index.table, key));
        }
        it.write(store, Arc::clone(key), Some(value));
        indexes
            .iter()
            .try_for_each(|index| it.add_to_index(index, key))
    }

    pub fn add_to_index(&mut self, index: &IndexKeys, record: &[u8]) -> Result {
        self.writer()?.add_to_index(index, record)
    }

    pub fn delete(&mut self, store: Table, range: &KeyRange, indexes: &[Table]) -> Result {
        let mut it = self.writer()?;
        while let Some(key) = it
            .state
            .rows(store)
            .first_from(&range.from)
            .filter(|it| range.includes(it))
            .cloned()
        {
            indexes
                .iter()
                .for_each(|index| it.remove_from_index(*index, &key));
            it.write(store, key, None);
        }
        Ok(())
    }

    pub fn clear(&mut self, table: Table) -> Result {
        let mut it = self.writer()?;
        let rows = it.state.rows(table);
        rows.by_record = None;
        let none = Weight::new(&rows.weight.of_bucket);
        let (keys, weight) = (
            core::mem::take(&mut rows.keys),
            core::mem::replace(&mut rows.weight, none),
        );
        let written = core::mem::take(it.written_to(table));
        it.cleared.push(table);
        it.undo.push(Undo::Clear {
            table,
            keys,
            weight,
            written,
        });
        Ok(())
    }

    pub fn count(&self, table: Table, range: &KeyRange) -> Result<usize> {
        self.with_rows(table, |it| {
            if range.is_all() {
                it.keys.len()
            } else {
                within(&it.keys, range).count()
            }
        })
    }

    pub fn select(
        &self,
        table: Table,
        range: &KeyRange,
        direction: Direction,
        limit: usize,
    ) -> Result<Vec<Key>> {
        self.with_rows(table, |it| {
            let entries = within(&it.keys, range);
            if !direction.skips_duplicates {
                return if direction.is_forward {
                    entries.take(limit).cloned().collect()
                } else {
                    entries.rev().take(limit).cloned().collect()
                };
            }
            let mut firsts: Vec<_> = entries.cloned().collect();
            firsts.dedup_by(|it, earlier| key::split(it).0 == key::split(earlier).0);
            if !direction.is_forward {
                firsts.reverse();
            }
            firsts.truncate(limit);
            firsts
        })
    }

    /// <https://w3c.github.io/IndexedDB/#iterate-a-cursor>
    pub fn iterate(
        &self,
        table: Table,
        range: &KeyRange,
        direction: Direction,
        position: Option<&[u8]>,
        target: Option<&[u8]>,
        count: u32,
    ) -> Result<Option<Key>> {
        self.with_rows(table, |rows| {
            let (mut position, mut found) = (position, None);
            for _ in 0..count {
                let next = rows.after(range, direction, position, target)?;
                (position, found) = (Some(&**next), Some(next));
            }
            found.cloned()
        })
    }

    /// Of records that exist.
    pub fn read<'k>(
        &self,
        store: Table,
        keys: impl IntoIterator<Item = &'k [u8]>,
    ) -> Result<Values> {
        self.read_to(Values::default(), store, keys)
    }

    fn read_to<'k>(
        &self,
        mut values: Values,
        store: Table,
        keys: impl IntoIterator<Item = &'k [u8]>,
    ) -> Result<Values> {
        let written = self.written.iter().find(|it| it.0 == store);
        let (storage, keys) = (&self.database().storage, keys.into_iter());
        let is_one = keys.size_hint().1 == Some(1);
        let read = |sql: &mut Sql| {
            for key in keys {
                match written.and_then(|it| it.1.get(key)?.as_deref()) {
                    Some(value) => values.push(value),
                    None => sql
                        .one(
                            "SELECT value FROM records WHERE tab = ? AND key = ?",
                            &[Integer(store.0), Blob(key)],
                            |it| values.push_stored(it, storage),
                        )?
                        .ok_or(Failure::Erased)??,
                }
                values.check_size()?;
            }
            Result::Ok(())
        };
        storage.read(|sql| if is_one { read(sql) } else { sql.at_once(read) })?;
        Ok(values)
    }

    /// Of an entry that [`iterate`](Self::iterate) has found. It is [`Ahead::value`], unless this transaction has written it.
    pub fn read_at(
        &self,
        walk: &Walk<'_>,
        entry: &Key,
        ahead: &mut Ahead,
    ) -> Result<Option<Bytes>> {
        let record_of: fn(&[u8]) -> &[u8] = if walk.index.is_some() {
            |it| key::split(it).1
        } else {
            |it| it
        };
        if let Some(value) = self
            .written
            .iter()
            .find(|it| it.0 == walk.store)
            .and_then(|it| it.1.get(record_of(entry))?.as_deref())
        {
            return Ok(Some(value.into()));
        }
        if let Some(skipped) = ahead.entries[ahead.next..]
            .iter()
            .position(|it| it == entry)
        {
            ahead.next += skipped + 1;
            return Ok(None);
        }
        let (used, fitting) = (
            ahead.next,
            Values::AHEAD * ahead.entries.len() / ahead.values.bytes.len().max(1),
        );
        let mut entries = self.with_rows(walk.index.unwrap_or(walk.store), |rows| {
            let following = core::iter::successors(Some(entry), |it| {
                rows.after(walk.range, walk.direction, Some(it), None)
            });
            following
                .take((used * 4).min(fitting).clamp(1, 256))
                .cloned()
                .collect::<Vec<_>>()
        })?;
        let values = Values {
            skipped: Some(0),
            ..Values::default()
        };
        let values = if walk.index.is_some() {
            self.read_to(values, walk.store, entries.iter().map(|it| record_of(it)))
        } else {
            self.read_adjacent_to(values, walk.store, &entries)
        }?;
        entries.truncate(values.ends.len());
        *ahead = Ahead {
            entries,
            values,
            next: 1,
            times_written: 0,
        };
        Ok(None)
    }

    /// Of all the records from the first up to and with the last of `keys`.
    pub fn read_adjacent(&self, store: Table, keys: &[Key]) -> Result<Values> {
        self.read_adjacent_to(Values::default(), store, keys)
    }

    fn read_adjacent_to(&self, mut values: Values, store: Table, keys: &[Key]) -> Result<Values> {
        let ([first, .., last], false) = (keys, self.written.iter().any(|it| it.0 == store)) else {
            return self.read_to(values, store, keys.iter().map(|it| &**it));
        };
        let (storage, mut result) = (&self.database().storage, Ok(()));
        let push =
            |it: &sql::Row<'_>| result = result.and_then(|()| values.push_stored(it, storage));
        storage.read(|sql| match first < last {
            true => sql.each(
                "SELECT value FROM records WHERE tab = ? AND key BETWEEN ? AND ? ORDER BY key",
                &[Integer(store.0), Blob(first), Blob(last)],
                push,
            ),
            false => sql.each(
                "SELECT value FROM records WHERE tab = ? AND key BETWEEN ? AND ? ORDER BY key DESC",
                &[Integer(store.0), Blob(last), Blob(first)],
                push,
            ),
        })?;
        result.and_then(|()| values.check_size())?;
        if values.ends.len() + values.skipped.unwrap_or(0) == keys.len() {
            Ok(values)
        } else {
            Err(Failure::Erased)
        }
    }

    pub fn has_written(&self) -> bool {
        !self.undo.is_empty()
    }

    fn store(
        &self,
        sql: &mut Sql,
        schema: Option<&Schema>,
        (old, new): &mut (Vec<Bytes>, Vec<Bytes>),
    ) -> Result {
        let database = self.database();
        let (bucket, name) = (Text(&database.bucket), Blob(&database.name));
        let (next_keys, old_schema) = {
            let mut state = database.lock_unless_erased(self.times_erased)?;
            let mut changed: Vec<_> = self
                .undo
                .iter()
                .filter_map(|it| {
                    if let Undo::NextKey { table, .. } = it {
                        Some(*table)
                    } else {
                        None
                    }
                })
                .collect();
            changed.dedup();
            (
                changed
                    .into_iter()
                    .map(|it| (it, state.rows(it).next_key))
                    .collect::<Vec<_>>(),
                state.schema.clone().unwrap_or_default(),
            )
        };
        for table in &self.cleared {
            sql.each(
                "SELECT value FROM records WHERE tab = ? AND typeof(value) = 'text'",
                &[Integer(table.0)],
                |it| old.push(it.bytes(0).into()),
            )?;
            sql.run("DELETE FROM records WHERE tab = ?", &[Integer(table.0)])?;
        }
        for (table, written) in &self.written {
            let has_large = sql
                .one(
                    "SELECT 1 FROM records WHERE tab = ? AND typeof(value) = 'text' LIMIT 1",
                    &[Integer(table.0)],
                    |_| (),
                )?
                .is_some();
            for (key, value) in written {
                if has_large {
                    sql.each("SELECT value FROM records WHERE tab = ? AND key = ? AND typeof(value) = 'text'", &[Integer(table.0), Blob(key)], |it| old.push(it.bytes(0).into()))?;
                }
                let file = value
                    .as_ref()
                    .filter(|it| it.len() >= LARGE)
                    .map_or(Ok(None), |it| database.storage.write_large_value(it))?;
                let value = match file {
                    Some(file) => Some(Text(new.push_mut(file))),
                    None => value.as_deref().map(Blob),
                };
                match value {
                    Some(value) => sql.run(
                        "INSERT OR REPLACE INTO records VALUES (?, ?, ?)",
                        &[Integer(table.0), Blob(key), value],
                    )?,
                    None => sql.run(
                        "DELETE FROM records WHERE tab = ? AND key = ?",
                        &[Integer(table.0), Blob(key)],
                    )?,
                }
            }
        }
        if let Some(schema) = schema {
            sql.run(
                "INSERT OR REPLACE INTO databases VALUES (?, ?, ?, ?)",
                &[
                    bucket,
                    name,
                    Integer(schema.version as i64),
                    Blob(&schema.serialize_stores()),
                ],
            )?;
            for table in schema.tables() {
                sql.run(
                    "INSERT OR IGNORE INTO tables VALUES (?, ?, ?, 1)",
                    &[Integer(table.0), bucket, name],
                )?;
            }
            for table in old_schema
                .tables()
                .filter(|old| schema.tables().all(|it| it != *old))
            {
                sql.run("DELETE FROM tables WHERE id = ?", &[Integer(table.0)])?;
            }
        }
        for (table, next_key) in next_keys {
            sql.run(
                "UPDATE tables SET next_key = ? WHERE id = ?",
                &[Real(next_key), Integer(table.0)],
            )?;
        }
        Ok(())
    }

    /// An upgrade has a `schema`. What `is_strict` is on the disk when this ends.
    pub async fn commit(
        mut self,
        schema: Option<Schema>,
        is_strict: bool,
    ) -> (Result, Option<Place>) {
        let storage = Arc::clone(&self.database().storage);
        let finished = storage.write(move |sql| {
            let (storage, mut files) = (Arc::clone(&self.database().storage), Default::default());
            let store = |sql: &mut Sql| {
                self.store(sql, schema.as_ref(), &mut files)?;
                if is_strict && !files.1.is_empty() {
                    storage.sync_large_values(&files.1)?;
                }
                Ok(())
            };
            let result = super::durably(sql, is_strict, |sql| sql.atomically(store));
            if result.is_err() {
                if !files.1.is_empty() || matches!(result, Err(Failure::Sql(SqlError::FULL))) {
                    let _ = storage.remove_unused_large_values(sql);
                }
                return Ok((result, self.abort()));
            }
            storage.replace_large_values(files.0, files.1);
            if let (Some(schema), Ok(mut state)) = (
                schema,
                self.database().lock_unless_erased(self.times_erased),
            ) {
                state
                    .tables
                    .retain(|table, _| schema.tables().any(|it| it == *table));
                state.schema = Some(Arc::new(schema));
            }
            Ok((result, self.place.take()))
        });
        finished
            .await
            .unwrap_or_else(|error: SqlError| (Err(error.into()), None))
    }

    pub fn abort(mut self) -> Option<Place> {
        self.roll_back(0);
        self.place.take()
    }
}

impl Drop for Transaction {
    fn drop(&mut self) {
        if self.has_written() {
            self.roll_back(0);
        }
    }
}
