//! How each part of code is written and read. Records have room for the offsets of what they refer to. What does not
//! add up when it is read counts as not there.

mod code;
mod constants;
mod entries;
mod functions;
mod names;
mod scopes;

use core::ops::Range;
use std::rc::Rc;

use bun_engine_text::StringRef;
use smallvec::SmallVec;

use super::load::{Outer, Unit};
use super::strings::{StringTable, StringTableBuilder};
use crate::bytes::{Reader, Sink};
use crate::code::{Module, Script, TooLarge};
use crate::function::{FunctionInfo, FunctionRef};
use crate::host::Host;
use crate::scope::StaticScope;

pub(super) use scopes::ScopeNumbers;

#[derive(Clone, Copy)]
pub enum Root<'a> {
    Script(&'a Script),
    Module(&'a Module),
    Builtin(&'a FunctionRef),
}

/// The text has an error, or its code is too large or names what no other process could find again.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Unencodable;

impl From<TooLarge> for Unencodable {
    fn from(_: TooLarge) -> Unencodable {
        Unencodable
    }
}

pub(super) enum Target {
    Record(u32),
    /// With the number of bytes before them.
    Blob(Range<u32>),
    OwnStrings,
}

pub(super) struct Fixup {
    pub(super) at: u32,
    pub(super) target: Target,
}

#[derive(Default)]
pub(super) struct Written {
    pub(super) records: Sink<u8>,
    pub(super) blobs: Sink<u8>,
    pub(super) fixups: Sink<Fixup>,
}

/// The number that the record of the code of a function gets.
pub(super) type Place<'a> = &'a mut dyn FnMut(FunctionRef) -> Option<u32>;

pub(super) struct Writer<'a> {
    pub(super) out: &'a mut Written,
    pub(super) strings: &'a mut StringTableBuilder,
    pub(super) has_own_strings: bool,
    pub(super) source: &'a StringRef,
    pub(super) scopes: ScopeNumbers,
    pub(super) is_unencodable: bool,
}

impl Writer<'_> {
    pub(super) fn check(&self) -> Result<(), Unencodable> {
        self.out.records.check()?;
        self.out.blobs.check()?;
        self.out.fixups.check()?;
        self.strings.check()?;
        (!self.is_unencodable).ok_or(Unencodable)
    }

    fn require<T: Default>(&mut self, value: Option<T>) -> T {
        self.is_unencodable |= value.is_none();
        value.unwrap_or_default()
    }

    #[inline]
    fn bytes(&mut self) -> &mut Sink<u8> {
        &mut self.out.records
    }

    fn fixup(&mut self, target: Target) {
        let at = self.out.records.len() as u32;
        self.out.fixups.push(Fixup { at, target });
        self.bytes().fixed(0);
    }

    fn blob(&mut self, bytes: &[u8]) {
        let start = self.out.blobs.len() as u32;
        self.out.blobs.count(bytes.len());
        self.out.blobs.put(bytes);
        self.fixup(Target::Blob(start..self.out.blobs.len() as u32));
    }

    fn list<T>(&mut self, elements: &[T], mut element: impl FnMut(&mut Self, &T)) {
        self.bytes().count(elements.len());
        elements.iter().for_each(|it| element(self, it));
    }

    fn optional<T>(&mut self, value: Option<&T>, some: impl FnOnce(&mut Self, &T)) {
        self.bytes().push(u8::from(value.is_some()));
        if let Some(value) = value {
            some(self, value);
        }
    }
}

pub(super) struct Decoder<'a> {
    unit: &'a Rc<Unit>,
    strings: &'a StringTable,
    host: &'a dyn Host,
    outer: Outer<'a>,
    /// What the code is of, unless it is a script or a module.
    pub(super) function: Option<&'a FunctionInfo>,
    scopes: SmallVec<[Rc<StaticScope>; 4]>,
}

fn flag(reader: &mut Reader<'_>) -> Option<bool> {
    let byte = reader.byte()?;
    (byte <= 1).then_some(byte != 0)
}

fn optional<'a, T>(
    reader: &mut Reader<'a>,
    some: impl FnOnce(&mut Reader<'a>) -> Option<T>,
) -> Option<Option<T>> {
    Some(if flag(reader)? {
        Some(some(reader)?)
    } else {
        None
    })
}

impl<'a> Decoder<'a> {
    pub(super) fn new(
        unit: &'a Rc<Unit>,
        outer: Outer<'a>,
        host: &'a dyn Host,
    ) -> Option<Decoder<'a>> {
        Some(Decoder {
            unit,
            strings: unit.strings()?,
            host,
            outer,
            function: None,
            scopes: SmallVec::new(),
        })
    }

    #[inline]
    fn is_trusted(&self) -> bool {
        self.unit.payload.is_embedded()
    }

    fn is_in_source(&self, start: u32, end: u32) -> bool {
        start <= end && end as usize <= self.unit.source.len()
    }
}
