//! A compact, pointer-free tree of names. `generate-table.cjs` writes the data.
//!
//! The names are slices of one string. The members of all maps are in one array, with each map's members contiguous,
//! and each member stores the range of its own members. So a map can be one of its own members, like `globalThis`.

use bun_lint::utils::eslint_utils::{ReferenceKind, Trace};
use std::marker::PhantomData;
use std::ops::Range;

/// Gives access to a table's arrays.
pub(crate) trait Table: Sized + 'static {
    fn names() -> &'static str;
    fn members() -> &'static [Member<Self>];
    /// A member's values for `[READ]`, `[CALL]` and `[CONSTRUCT]`. Each is [`NONE`] or a number whose meaning is up to
    /// the table's user. A member stores the index of its triple.
    fn kinds() -> &'static [[u16; 3]];
}

pub(crate) const NONE: u16 = u16::MAX;

/// A contiguous range in one of a table's arrays: some bytes of the names, or some elements of an array.
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

    /// This range of [`Table::names`].
    pub(crate) fn text<T: Table>(self) -> &'static str {
        T::names().get(self.range()).unwrap_or_default()
    }

    /// This range of [`Table::members`].
    pub(crate) fn members<T: Table>(self) -> &'static [Member<T>] {
        T::members().get(self.range()).unwrap_or_default()
    }
}

/// A name in the table `T`, with its values and members.
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

/// A map whose members are a selection of a table's members.
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
