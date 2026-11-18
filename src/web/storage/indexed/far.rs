//! A transaction of a page process runs in the host.

use std::sync::Arc;

use bun_threading::Guarded;

use super::either::Destination;
use super::{
    Ahead, Direction, Failure, IndexKeys, Mode, Notice, Result, Schema, Table, Values, Walk,
};
use crate::Bytes;
use crate::exec::{Receiver, detach, oneshot};
use crate::remote::petition::{self, Handle, Tidings};
use crate::storage::SqlError;
use crate::storage::key::{self, Key, KeyRange};
use crate::wire::{self, Malformed, Reader, Wire, Writer};

crate::wire! {
    pub(crate) enum Step {
        Mark,
        RollBack,
        UpdateKeyGenerator { store: Table, key: f64 },
        Put { store: Table, key: Key, value: Bytes, indexes: Vec<IndexKeys>, replaces: bool },
        AddToIndex { index: IndexKeys, record: Vec<u8> },
        Delete { store: Table, range: KeyRange, indexes: Vec<Table> },
        Clear { table: Table },
    }

    pub(crate) enum Operation {
        /// The result is that of the last step.
        Nothing,
        NewTable,
        GenerateKey { store: Table },
        Count { table: Table, range: KeyRange },
        Select { table: Table, range: KeyRange, direction: Direction, limit: usize },
        Iterate { table: Table, range: KeyRange, direction: Direction, position: Option<Vec<u8>>, target: Option<Vec<u8>>, count: u32 },
        Read { store: Table, keys: Values, are_adjacent: bool },
        /// What `Iterate` finds and what follows it, with the values in `store`.
        MoveOn { table: Table, store: Option<Table>, is_index: bool, range: KeyRange, direction: Direction, position: Option<Vec<u8>>, target: Option<Vec<u8>>, count: u32, entries: u8 },
    }

    pub(crate) enum Output {
        Nothing,
        Table(Table),
        Number(f64),
        Values(Values),
        Ahead { entries: Values, values: Values },
    }
}

impl Wire for Values {
    fn write(self, to: &mut Writer) {
        to.put_bytes(&self.bytes);
        self.ends
            .into_iter()
            .flat_map(|it| (it as u32).to_le_bytes())
            .collect::<Vec<_>>()
            .write(to);
    }

    fn read(from: &mut Reader<'_>) -> wire::Result<Values> {
        let (bytes, ends) = (Vec::<u8>::read(from)?, from.take_bytes()?.as_chunks().0);
        let ends: Vec<_> = ends
            .iter()
            .map(|it| u32::from_le_bytes(*it) as usize)
            .collect();
        (ends.is_sorted() && ends.last().is_none_or(|it| *it <= bytes.len()))
            .then_some(Values {
                bytes,
                ends,
                ..Values::default()
            })
            .ok_or(Malformed)
    }
}

impl<'k> FromIterator<&'k [u8]> for Values {
    fn from_iter<I: IntoIterator<Item = &'k [u8]>>(all: I) -> Values {
        let mut values = Values::default();
        all.into_iter().for_each(|it| values.push(it));
        values
    }
}

pub(super) struct Connection {
    handle: Handle,
    /// And have yet to hear of it.
    started: Arc<Guarded<Vec<u32>>>,
}

impl Connection {
    pub(super) fn new(
        turn: &Handle,
        notify: impl Fn(Notice) + Send + Sync + 'static,
    ) -> Connection {
        let handle = Handle::with_listener(move |it| match it {
            Tidings::VersionChange { new_version, event } => {
                let (handled, is_open) = oneshot();
                notify(Notice::VersionChange {
                    new_version,
                    handled,
                });
                detach(async move { petition::handled(event, is_open.await == Some(true)) });
            }
            Tidings::Erased => notify(Notice::Erased),
            Tidings::Broadcast(_) => {}
        });
        petition::connect(turn.id(), handle.id());
        Connection {
            handle,
            started: Arc::default(),
        }
    }

    pub(super) fn begin(
        &self,
        mode: Mode,
        tables: Vec<Table>,
    ) -> (Transaction, Option<Receiver<Result>>) {
        let (handle, (ticket, start)) = (Handle::new(), petition::expect_start());
        let mut started = petition::begin(self.handle.id(), handle.id(), mode, tables, ticket)
            .map(|it| it.0)
            .unwrap_or_default();
        let has_started = started.pop_if(|it| *it == handle.id()).is_some();
        if has_started {
            petition::ruled(ticket, None);
        }
        self.started.lock().append(&mut started);
        let started = Started {
            id: handle.id(),
            all: Arc::clone(&self.started),
        };
        (
            Transaction {
                handle,
                started,
                steps: Vec::new(),
                weight: 0,
                is_marked: true,
                has_written: false,
                times_written: 0,
            },
            (!has_started).then_some(start),
        )
    }
}

struct Started {
    id: u32,
    all: Arc<Guarded<Vec<u32>>>,
}

impl Drop for Started {
    fn drop(&mut self) {
        self.all.lock().retain(|it| *it != self.id);
    }
}

pub(super) struct Transaction {
    handle: Handle,
    started: Started,
    /// They only fail if all that follows does.
    steps: Vec<Step>,
    weight: usize,
    is_marked: bool,
    has_written: bool,
    times_written: u32,
}

fn unexpected<T>() -> Result<T> {
    Err(Failure::Erased)
}

impl Transaction {
    fn will_write(&mut self) {
        self.has_written = true;
        self.times_written += 1;
        if !core::mem::replace(&mut self.is_marked, true) {
            self.steps.push(Step::Mark);
        }
    }

    fn write(&mut self, step: Step, bytes: usize, can_fail: bool) -> Result {
        const MOST: usize = 1 << 20;
        self.will_write();
        self.steps.push(step);
        if can_fail || bytes > MOST {
            return self.run(Operation::Nothing).map(drop);
        }
        self.weight += bytes + 256;
        if self.weight > MOST {
            petition::write(self.handle.id(), self.take_steps());
        }
        Ok(())
    }

    fn take_steps(&mut self) -> Vec<Step> {
        self.weight = 0;
        core::mem::take(&mut self.steps)
    }

    fn run(&mut self, then: Operation) -> Result<Output> {
        petition::run(self.handle.id(), self.take_steps(), then)
            .map_or_else(|| Err(SqlError::TOO_BIG.into()), |it| it.0)
    }

    fn number(&mut self, of: Operation) -> Result<f64> {
        if let Output::Number(it) = self.run(of)? {
            Ok(it)
        } else {
            unexpected()
        }
    }

    fn values(&mut self, of: Operation) -> Result<Values> {
        if let Output::Values(it) = self.run(of)? {
            Ok(it)
        } else {
            unexpected()
        }
    }

    pub(super) fn has_started(&self) -> bool {
        self.started.all.lock().contains(&self.started.id)
    }

    pub(super) fn has_written(&self) -> bool {
        self.has_written
    }

    /// The host keeps the last one.
    pub(super) fn mark(&mut self) -> usize {
        self.is_marked = false;
        0
    }

    pub(super) fn roll_back(&mut self, _: usize) {
        if self.is_marked {
            self.times_written += 1;
            self.steps.push(Step::RollBack);
        }
    }

    pub(super) fn new_table(&mut self) -> Table {
        if let Ok(Output::Table(it)) = self.run(Operation::NewTable) {
            it
        } else {
            Table::unique()
        }
    }

    pub(super) fn generate_key(&mut self, store: Table) -> Result<f64> {
        self.will_write();
        self.number(Operation::GenerateKey { store })
    }

    pub(super) fn update_key_generator(&mut self, store: Table, key: f64) -> Result {
        self.write(Step::UpdateKeyGenerator { store, key }, 0, false)
    }

    pub(super) fn put(
        &mut self,
        store: Table,
        key: &Key,
        value: Bytes,
        indexes: &[IndexKeys],
        replaces: bool,
    ) -> Result {
        let bytes = key.len()
            + value.len()
            + indexes
                .iter()
                .flat_map(|it| &it.keys)
                .map(|it| it.len() + 256)
                .sum::<usize>();
        let step = Step::Put {
            store,
            key: Key::clone(key),
            value,
            indexes: indexes.to_vec(),
            replaces,
        };
        self.write(
            step,
            bytes,
            !replaces || indexes.iter().any(|it| it.is_unique),
        )
    }

    pub(super) fn add_to_index(&mut self, index: &IndexKeys, record: &[u8]) -> Result {
        let bytes = record.len() + index.keys.iter().map(|it| it.len() + 256).sum::<usize>();
        self.write(
            Step::AddToIndex {
                index: index.clone(),
                record: record.to_vec(),
            },
            bytes,
            index.is_unique,
        )
    }

    pub(super) fn delete(&mut self, store: Table, range: &KeyRange, indexes: &[Table]) -> Result {
        self.write(
            Step::Delete {
                store,
                range: range.clone(),
                indexes: indexes.to_vec(),
            },
            range.from.len() + range.to.len(),
            false,
        )
    }

    pub(super) fn clear(&mut self, table: Table) -> Result {
        self.write(Step::Clear { table }, 0, false)
    }

    pub(super) fn count(&mut self, table: Table, range: &KeyRange) -> Result<usize> {
        self.number(Operation::Count {
            table,
            range: range.clone(),
        })
        .map(|it| it as usize)
    }

    pub(super) fn select(
        &mut self,
        table: Table,
        range: &KeyRange,
        direction: Direction,
        limit: usize,
    ) -> Result<Vec<Key>> {
        Ok(self
            .values(Operation::Select {
                table,
                range: range.clone(),
                direction,
                limit,
            })?
            .iter()
            .map(Key::from)
            .collect())
    }

    pub(super) fn iterate(
        &mut self,
        table: Table,
        range: &KeyRange,
        direction: Direction,
        position: Option<&[u8]>,
        target: Option<&[u8]>,
        count: u32,
    ) -> Result<Option<Key>> {
        let [position, target] = [position, target].map(|it| it.map(<[u8]>::to_vec));
        Ok(self
            .values(Operation::Iterate {
                table,
                range: range.clone(),
                direction,
                position,
                target,
                count,
            })?
            .iter()
            .next()
            .map(Key::from))
    }

    pub(super) fn move_on(
        &mut self,
        walk: &Walk<'_>,
        to: Destination<'_>,
        ahead: &mut Ahead,
    ) -> Result<Option<Key>> {
        let goes_on = ahead.times_written == self.times_written
            && to.target.is_none()
            && to.position.is_some();
        let next = ahead.next.saturating_add(to.count as usize);
        if let Some(entry) = ahead.entries.get(next - 1).filter(|_| goes_on) {
            ahead.next = next;
            return Ok(Some(Key::clone(entry)));
        }
        let Output::Ahead { entries, values } = self.run(Operation::MoveOn {
            table: walk.index.unwrap_or(walk.store),
            store: to.needs_value.then_some(walk.store),
            is_index: walk.index.is_some(),
            range: walk.range.clone(),
            direction: walk.direction,
            position: to.position.map(<[u8]>::to_vec),
            target: to.target.map(<[u8]>::to_vec),
            count: to.count,
            entries: if goes_on {
                (ahead.next * 4).clamp(1, u8::MAX.into()) as u8
            } else {
                1
            },
        })?
        else {
            return unexpected();
        };
        *ahead = Ahead {
            entries: entries.iter().map(Key::from).collect(),
            values,
            next: 1,
            times_written: self.times_written,
        };
        Ok(ahead.entries.first().cloned())
    }

    pub(super) fn read<'k>(
        &mut self,
        store: Table,
        keys: impl IntoIterator<Item = &'k [u8]>,
    ) -> Result<Values> {
        self.values(Operation::Read {
            store,
            keys: keys.into_iter().collect(),
            are_adjacent: false,
        })
    }

    pub(super) fn read_adjacent(&mut self, store: Table, keys: &[Key]) -> Result<Values> {
        self.values(Operation::Read {
            store,
            keys: keys.iter().map(|it| &**it).collect(),
            are_adjacent: true,
        })
    }

    pub(super) async fn commit(
        mut self,
        schema: Option<Schema>,
        is_strict: bool,
    ) -> (Result, Handle) {
        (
            SqlError::unless(petition::commit(
                self.handle.id(),
                self.take_steps(),
                schema,
                is_strict,
            ))
            .await,
            self.handle,
        )
    }

    pub(super) fn abort(self) -> Handle {
        petition::abort(self.handle.id());
        self.handle
    }
}

/// In the host.
pub(crate) struct Supervised {
    transaction: super::Transaction,
    mode: Mode,
    tables: Vec<Table>,
    mark: usize,
    may_run: bool,
    is_spoiled: bool,
}

fn require(condition: bool) -> wire::Result<()> {
    condition.then_some(()).ok_or(Malformed)
}

pub(crate) fn require_key(key: &[u8]) -> wire::Result<()> {
    require(key::is_valid(key))
}

impl Supervised {
    pub(crate) fn begin(
        connection: &super::Connection,
        mode: Mode,
        mut tables: Vec<Table>,
    ) -> (Supervised, Option<Receiver<Result>>) {
        let schema = connection
            .database
            .state
            .lock()
            .schema
            .clone()
            .unwrap_or_default();
        match mode {
            Mode::VersionChange => tables = schema.tables().collect(),
            _ => tables.retain(|it| schema.tables().any(|known| known == *it)),
        }
        let (transaction, started) = connection.begin(mode, tables.clone());
        (
            Supervised {
                transaction,
                mode,
                tables,
                mark: 0,
                may_run: false,
                is_spoiled: false,
            },
            started,
        )
    }

    pub(crate) fn has_started(&self) -> bool {
        self.transaction.has_started()
    }

    fn has(&self, mut tables: impl Iterator<Item = Table>) -> Result {
        if tables.all(|it| self.tables.contains(&it)) {
            Ok(())
        } else {
            unexpected()
        }
    }

    fn take(&mut self, step: Step) -> wire::Result<Result> {
        let has_keys = |it: &IndexKeys| it.keys.iter().all(|it| key::is_valid(it));
        require(self.mode != Mode::ReadOnly)?;
        Ok(match step {
            Step::Mark => {
                self.mark = self.transaction.mark();
                Ok(())
            }
            Step::RollBack => {
                self.transaction.roll_back(self.mark);
                Ok(())
            }
            Step::UpdateKeyGenerator { store, key } => self
                .has([store].into_iter())
                .and_then(|()| self.transaction.update_key_generator(store, key)),
            Step::Put {
                store,
                key,
                value,
                indexes,
                replaces,
            } => {
                require(key::is_valid(&key) && indexes.iter().all(has_keys))?;
                if !crate::channel::is_fit_for_storage(&value) {
                    self.is_spoiled = true;
                    return Ok(Err(SqlError::TOO_BIG.into()));
                }
                self.has(indexes.iter().map(|it| it.table).chain([store]))
                    .and_then(|()| self.transaction.put(store, &key, value, &indexes, replaces))
            }
            Step::AddToIndex { index, record } => {
                require(key::is_valid(&record) && has_keys(&index))?;
                self.has([index.table].into_iter())
                    .and_then(|()| self.transaction.add_to_index(&index, &record))
            }
            Step::Delete {
                store,
                range,
                indexes,
            } => self
                .has(indexes.iter().copied().chain([store]))
                .and_then(|()| self.transaction.delete(store, &range, &indexes)),
            Step::Clear { table } => self
                .has([table].into_iter())
                .and_then(|()| self.transaction.clear(table)),
        })
    }

    pub(crate) fn run(
        &mut self,
        steps: Vec<Step>,
        then: Operation,
    ) -> wire::Result<Result<Output>> {
        let mut last = Ok(());
        self.may_run = self.may_run || !self.transaction.is_waiting();
        require(self.may_run)?;
        for step in steps {
            last = self.take(step)?;
            self.is_spoiled |= matches!(last, Err(Failure::Sql(_)));
        }
        let keys = |all: Vec<Key>| Output::Values(all.iter().map(|it| &**it).collect());
        let (table, range) = match &then {
            Operation::Nothing => return Ok(last.map(|()| Output::Nothing)),
            Operation::NewTable => {
                require(self.mode == Mode::VersionChange && self.tables.len() < 1 << 16)?;
                let table = Table::unique();
                self.tables.push(table);
                return Ok(Ok(Output::Table(table)));
            }
            Operation::GenerateKey { store: table } | Operation::Read { store: table, .. } => {
                (*table, None)
            }
            Operation::Count { table, range }
            | Operation::Select { table, range, .. }
            | Operation::Iterate { table, range, .. }
            | Operation::MoveOn { table, range, .. } => (*table, Some(range)),
        };
        let other = match then {
            Operation::MoveOn { store, .. } => store,
            _ => None,
        };
        require(
            range.is_none_or(|it| it.from <= it.to)
                && (self.mode != Mode::ReadOnly || !matches!(then, Operation::GenerateKey { .. })),
        )?;
        Ok(self.has(other.into_iter().chain([table])).and_then(|()| {
            let it = &mut self.transaction;
            let values = Values {
                most_bytes: Some(wire::LARGE),
                ..Values::default()
            };
            match then {
                Operation::Nothing | Operation::NewTable => unexpected(),
                Operation::GenerateKey { .. } => it.generate_key(table).map(Output::Number),
                Operation::Count { range, .. } => {
                    it.count(table, &range).map(|it| Output::Number(it as f64))
                }
                Operation::Select {
                    range,
                    direction,
                    limit,
                    ..
                } => it.select(table, &range, direction, limit).map(keys),
                Operation::Iterate {
                    range,
                    direction,
                    position,
                    target,
                    count,
                    ..
                } => {
                    let count = if target.is_some() { 1 } else { count };
                    it.iterate(
                        table,
                        &range,
                        direction,
                        position.as_deref(),
                        target.as_deref(),
                        count,
                    )
                    .map(|it| keys(it.into_iter().collect()))
                }
                Operation::MoveOn {
                    store,
                    is_index,
                    range,
                    direction,
                    position,
                    target,
                    count,
                    entries,
                    ..
                } => {
                    let (position, target) = (position.as_deref(), target.as_deref());
                    let count = if target.is_some() { 1 } else { count };
                    let first = it.iterate(table, &range, direction, position, target, count)?;
                    let mut entries = it.with_rows(table, |rows| {
                        let next = |it: &&Key| rows.after(&range, direction, Some(it), None);
                        let all = core::iter::successors(first.as_ref(), next);
                        all.take(entries.max(1).into()).cloned().collect::<Vec<_>>()
                    })?;
                    let mut values = Values {
                        skipped: Some(0),
                        ..values
                    };
                    if let Some(store) = store {
                        let records = (entries.iter())
                            .map(|it| if is_index { key::split(it).1 } else { &**it });
                        values = it.read_to(values, store, records)?;
                        entries.truncate(values.ends.len());
                    }
                    let entries = entries.iter().map(|it| &**it).collect();
                    Ok(Output::Ahead { entries, values })
                }
                Operation::Read {
                    keys,
                    are_adjacent: false,
                    ..
                } => (it.read_to(values, table, keys.iter())).map(Output::Values),
                Operation::Read { keys, .. } => it
                    .read_adjacent_to(
                        values,
                        table,
                        &keys.iter().map(Key::from).collect::<Vec<_>>(),
                    )
                    .map(Output::Values),
            }
        }))
    }

    pub(crate) fn commit(
        self,
        schema: Option<Schema>,
        is_strict: bool,
    ) -> wire::Result<impl Future<Output = (Result, Option<super::Place>)> + use<>> {
        require(schema.is_some() == (self.mode == Mode::VersionChange))?;
        if let Some(schema) = &schema {
            let keys = schema.stores.iter().flat_map(|it| {
                it.indexes
                    .iter()
                    .flat_map(|it| [&it.name, &it.key_path])
                    .chain([&it.name])
                    .chain(&it.key_path)
            });
            require(
                self.has(schema.tables()).is_ok() && keys.into_iter().all(|it| key::is_valid(it)),
            )?;
        }
        Ok(async move {
            if self.is_spoiled {
                (Err(SqlError::TOO_BIG.into()), self.abort())
            } else {
                self.transaction.commit(schema, is_strict).await
            }
        })
    }

    pub(crate) fn abort(self) -> Option<super::Place> {
        self.transaction.abort()
    }
}
