//! Where the values that a parser makes are in the text: the JSON Parse Records of ECMA-262.

use core::ops::Range;

use bun_alloc::AllocError;
use bun_engine_text::Identifier;

use super::Failure;
use crate::{Gc, ImmutableArray, Value, Vm};

/// What a parser tells about its progress.
pub(super) trait Recorder {
    const IS_ACTIVE: bool = false;

    fn key(&mut self, _: impl FnOnce() -> Result<Identifier, AllocError>) -> Result<(), Failure> {
        Ok(())
    }

    fn primitive(&mut self, _: Value, _: Range<usize>) -> Result<(), Failure> {
        Ok(())
    }

    fn open(&mut self) -> Result<(), Failure> {
        Ok(())
    }

    /// `members` counts duplicates.
    fn close(&mut self, _: Value, _members: usize) -> Result<(), Failure> {
        Ok(())
    }
}

impl Recorder for () {}

pub(super) struct Record {
    pub(super) key: Option<Identifier>,
    /// Of a primitive, the units that it takes in the text. Of an object or an array, the records of the members.
    pub(super) range: Range<u32>,
}

/// To be used while no collection runs.
#[derive(Default)]
#[cfg_attr(rootcheck, rootcheck::allow("collection is deferred"))]
pub(super) struct RecordBuilder {
    next_key: Option<Identifier>,
    /// Those whose holder is still open.
    pending: Vec<(Record, Value)>,
    records: Vec<Record>,
    values: Vec<Value>,
    depth: usize,
}

/// The last one is that of the whole text.
pub(super) struct Records {
    pub(super) records: Vec<Record>,
    pub(super) values: Gc<ImmutableArray>,
}

impl RecordBuilder {
    const MAX_DEPTH: usize = 4500;

    fn begin(&mut self, value: Value, range: Range<u32>) -> Result<(), Failure> {
        self.pending.try_reserve(1).map_err(|_| AllocError)?;
        let key = self.next_key.take();
        self.pending.push((Record { key, range }, value));
        Ok(())
    }

    /// Moves the last ones that are pending, and returns where to.
    fn settle(&mut self, count: usize) -> Result<Range<u32>, AllocError> {
        let reserved = self.records.try_reserve(count);
        let reserved = reserved.and_then(|()| self.values.try_reserve(count));
        reserved.map_err(|_| AllocError)?;
        let first = self.records.len();
        for (record, value) in self.pending.drain(self.pending.len() - count..) {
            self.records.push(record);
            self.values.push(value);
        }
        Ok(first as u32..self.records.len() as u32)
    }

    pub(super) fn finish(&mut self, vm: &Vm) -> Result<Records, AllocError> {
        self.settle(1)?;
        Ok(Records {
            values: ImmutableArray::try_from_values(vm, &self.values)?,
            records: core::mem::take(&mut self.records),
        })
    }
}

impl Recorder for RecordBuilder {
    const IS_ACTIVE: bool = true;

    fn key(
        &mut self,
        name: impl FnOnce() -> Result<Identifier, AllocError>,
    ) -> Result<(), Failure> {
        self.next_key = Some(name()?);
        Ok(())
    }

    fn primitive(&mut self, value: Value, range: Range<usize>) -> Result<(), Failure> {
        self.begin(value, range.start as u32..range.end as u32)
    }

    fn open(&mut self) -> Result<(), Failure> {
        if self.depth >= Self::MAX_DEPTH {
            return Err(Failure::TooDeep);
        }
        self.depth += 1;
        self.begin(Value::UNDEFINED, 0..0)
    }

    fn close(&mut self, value: Value, members: usize) -> Result<(), Failure> {
        self.depth -= 1;
        let range = self.settle(members)?;
        if let Some(holder) = self.pending.last_mut() {
            (holder.0.range, holder.1) = (range, value);
        }
        Ok(())
    }
}
