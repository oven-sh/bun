//! A tree of names in few bytes, and without pointers: what `generate-table.cjs` writes.
//!
//! The names are parts of one text. The members of all maps are in one array, those of a map after each other, and a
//! member says where its own members are in it. So a map can be among its own members, as that of `globalThis` is.

use bun_lint::utils::eslint_utils::{ReferenceKind, Trace};
use std::marker::PhantomData;
use std::ops::Range;

/// Where the parts of a table are.
pub(crate) trait Table: Sized + 'static {
    fn names() -> &'static str;
    fn members() -> &'static [Member<Self>];
    /// What a member has at `[READ]`, `[CALL]` and `[CONSTRUCT]`, each [`NONE`] or a number that means something to the
    /// user of the table. A member has the position of its three.
    fn kinds() -> &'static [[u16; 3]];
}

pub(crate) const NONE: u16 = u16::MAX;

/// What follows each other in one of the parts of a table: some bytes of the names, or some elements of an array.
#[derive(Copy, Clone)]
pub(crate) struct Part {
    first: u16,
    count: u8,
}

impl Part {
    pub(crate) const EMPTY: Part = Part::new(0, 0);

    pub(crate) const fn new(first: u16, count: u8) -> Part {
        Part { first, count }
    }

    pub(crate) fn range(self) -> Range<usize> {
        let first = usize::from(self.first);
        first..first + usize::from(self.count)
    }

    /// Of [`Table::names`].
    pub(crate) fn text<T: Table>(self) -> &'static str {
        T::names().get(self.range()).unwrap_or_default()
    }

    /// Of [`Table::members`].
    pub(crate) fn members<T: Table>(self) -> &'static [Member<T>] {
        T::members().get(self.range()).unwrap_or_default()
    }
}

/// A name in the table `T`, with what the name stands for.
pub(crate) struct Member<T> {
    name: u16,
    first: u16,
    kinds: u16,
    name_len: u8,
    count: u8,
    table: PhantomData<T>,
}

impl<T: Table> Member<T> {
    pub(crate) const fn new(name: Part, kinds: u16, members: Part) -> Member<T> {
        Member {
            name: name.first,
            first: members.first,
            kinds,
            name_len: name.count,
            count: members.count,
            table: PhantomData,
        }
    }

    pub(crate) fn name(&self) -> &'static str {
        Part::new(self.name, self.name_len).text::<T>()
    }

    pub(crate) fn members(&self) -> &'static [Member<T>] {
        Part::new(self.first, self.count).members::<T>()
    }

    fn traced<'m>(&'static self) -> (&'m str, &'m dyn Trace<'m>) {
        (self.name(), self)
    }

    fn is_called(&self, name: &[u8]) -> bool {
        usize::from(self.name_len) == name.len() && self.name().as_bytes() == name
    }
}

impl<'m, T: Table> Trace<'m> for Member<T> {
    fn info(&self, kind: ReferenceKind) -> Option<u16> {
        let [read, call, construct] = *T::kinds().get(usize::from(self.kinds))?;
        let info = match kind {
            ReferenceKind::Read => read,
            ReferenceKind::Call => call,
            ReferenceKind::Construct => construct,
        };
        (info != NONE).then_some(info)
    }

    fn member(&self, index: usize) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        self.members().get(index).map(Member::traced)
    }

    fn get(&self, name: &[u8]) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        let mut members = self.members().iter();
        members.find(|it| it.is_called(name)).map(Member::traced)
    }
}

/// A map with some members of a table as its members.
pub(crate) struct Roots<T: Table>(pub(crate) Vec<&'static Member<T>>);

impl<'m, T: Table> Trace<'m> for Roots<T> {
    fn info(&self, _: ReferenceKind) -> Option<u16> {
        None
    }

    fn member(&self, index: usize) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        self.0.get(index).map(|it| it.traced())
    }

    fn get(&self, name: &[u8]) -> Option<(&'m str, &'m dyn Trace<'m>)> {
        let mut members = self.0.iter();
        members.find(|it| it.is_called(name)).map(|it| it.traced())
    }
}
