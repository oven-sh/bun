//! In this process, or in the host.

use std::sync::Arc;

pub use super::{
    Ahead, Direction, Failure, IndexKeys, IndexSchema, Mode, Notice, Schema, StoreSchema, Table,
    Values, Walk,
};
use super::{Result, far};
use crate::Bytes;
use crate::exec::Receiver;
use crate::remote::petition::{self, Handle};
use crate::storage::key::{Key, KeyRange};
use crate::storage::{Shelf, SqlError};

#[derive(Clone, Copy)]
pub struct Destination<'k> {
    pub position: Option<&'k [u8]>,
    pub target: Option<&'k [u8]>,
    pub count: u32,
    pub needs_value: bool,
}

pub enum Database {
    Near(Arc<super::Database>),
    Far(Shelf, Key),
}

enum Either<N, F> {
    Near(N),
    Far(F),
}

use Either::{Far, Near};

pub struct Turn(Either<super::Turn, Handle>);
pub struct Connection(Either<super::Connection, far::Connection>);
pub struct Transaction(Either<super::Transaction, far::Transaction>);

pub struct Place {
    _held: Either<super::Place, Handle>,
}

impl Database {
    pub async fn take_turn(self) -> Option<Turn> {
        match self {
            Database::Near(it) => it.take_turn().await.map(|it| Turn(Near(it))),
            Database::Far(shelf, name) => {
                let turn = Handle::new();
                petition::take_turn(turn.id(), shelf, name)
                    .await
                    .map(|()| Turn(Far(turn)))
            }
        }
    }
}

impl Turn {
    pub async fn schema(&self) -> Result<Arc<Schema>> {
        match &self.0 {
            Near(it) => it.schema().await,
            Far(it) => SqlError::unless(petition::schema(it.id()))
                .await
                .map(Arc::new),
        }
    }

    pub async fn announce(&self, new_version: Option<u64>) -> bool {
        match &self.0 {
            Near(it) => it.announce(new_version).await,
            Far(it) => petition::announce(it.id(), new_version).await == Some(true),
        }
    }

    pub async fn until_unused(&self) {
        match &self.0 {
            Near(it) => it.until_unused().await,
            Far(it) => _ = petition::until_unused(it.id()).await,
        }
    }

    pub fn connect(&self, notify: impl Fn(Notice) + Send + Sync + 'static) -> Connection {
        Connection(match &self.0 {
            Near(it) => Near(it.connect(notify)),
            Far(it) => Far(far::Connection::new(it, notify)),
        })
    }

    pub async fn erase(&self) -> Result {
        match &self.0 {
            Near(it) => it.erase().await,
            Far(it) => SqlError::unless(petition::erase(it.id())).await,
        }
    }
}

impl Connection {
    pub fn begin(&self, mode: Mode, tables: Vec<Table>) -> (Transaction, Option<Receiver<Result>>) {
        match &self.0 {
            Near(it) => {
                let (transaction, started) = it.begin(mode, tables);
                (Transaction(Near(transaction)), started)
            }
            Far(it) => {
                let (transaction, started) = it.begin(mode, tables);
                (Transaction(Far(transaction)), started)
            }
        }
    }
}

macro_rules! either {
    ($($name:ident($($mutable:ident)? ; $($argument:ident: $Type:ty),*) -> $Result:ty;)*) => {$(
        pub fn $name(&$($mutable)? self, $($argument: $Type),*) -> $Result {
            match &$($mutable)? self.0 {
                Near(it) => it.$name($($argument),*),
                Far(it) => it.$name($($argument),*),
            }
        }
    )*};
}

impl Transaction {
    either! {
        has_started(;) -> bool;
        has_written(;) -> bool;
        mark(mut;) -> usize;
        roll_back(mut; mark: usize) -> ();
        new_table(mut;) -> Table;
        generate_key(mut; store: Table) -> Result<f64>;
        update_key_generator(mut; store: Table, key: f64) -> Result;
        put(mut; store: Table, key: &Key, value: Bytes, indexes: &[IndexKeys], replaces: bool) -> Result;
        add_to_index(mut; index: &IndexKeys, record: &[u8]) -> Result;
        delete(mut; store: Table, range: &KeyRange, indexes: &[Table]) -> Result;
        clear(mut; table: Table) -> Result;
        count(mut; table: Table, range: &KeyRange) -> Result<usize>;
        select(mut; table: Table, range: &KeyRange, direction: Direction, limit: usize) -> Result<Vec<Key>>;
        iterate(mut; table: Table, range: &KeyRange, direction: Direction, position: Option<&[u8]>, target: Option<&[u8]>, count: u32) -> Result<Option<Key>>;
        read_adjacent(mut; store: Table, keys: &[Key]) -> Result<Values>;
    }

    pub fn read<'k>(
        &mut self,
        store: Table,
        keys: impl IntoIterator<Item = &'k [u8]>,
    ) -> Result<Values> {
        match &mut self.0 {
            Near(it) => it.read(store, keys),
            Far(it) => it.read(store, keys),
        }
    }

    /// Like `iterate`, for who goes on from there.
    pub fn move_on(
        &mut self,
        walk: &Walk<'_>,
        to: Destination<'_>,
        ahead: &mut Ahead,
    ) -> Result<Option<Key>> {
        match &mut self.0 {
            Near(it) => it.iterate(
                walk.index.unwrap_or(walk.store),
                walk.range,
                walk.direction,
                to.position,
                to.target,
                to.count,
            ),
            Far(it) => it.move_on(walk, to, ahead),
        }
    }

    /// Of what `move_on` has just found.
    pub fn read_at(
        &mut self,
        walk: &Walk<'_>,
        entry: &Key,
        ahead: &mut Ahead,
    ) -> Result<Option<Bytes>> {
        match &mut self.0 {
            Near(it) => it.read_at(walk, entry, ahead),
            Far(_) => Ok(None),
        }
    }

    pub async fn commit(self, schema: Option<Schema>, is_strict: bool) -> (Result, Option<Place>) {
        match self.0 {
            Near(it) => {
                let (result, place) = it.commit(schema, is_strict).await;
                (result, place.map(|it| Place { _held: Near(it) }))
            }
            Far(it) => {
                let (result, place) = it.commit(schema, is_strict).await;
                (result, Some(Place { _held: Far(place) }))
            }
        }
    }

    pub fn abort(self) -> Option<Place> {
        match self.0 {
            Near(it) => it.abort().map(|it| Place { _held: Near(it) }),
            Far(it) => Some(Place {
                _held: Far(it.abort()),
            }),
        }
    }
}
