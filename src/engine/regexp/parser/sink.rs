use bun_engine_text::{CodeUnit, Text};
use bun_engine_unicode::Property;

use crate::tree::{Group, Groups};
use crate::{Error, Flags};

#[derive(Clone, Copy)]
pub(crate) enum Assertion {
    Start,
    End,
    WordBoundary { negated: bool },
}

#[derive(Clone, Copy)]
pub(crate) enum ClassEscape {
    Digit,
    NotDigit,
    Space,
    NotSpace,
    Word,
    NotWord,
    Property(Property),
    NotProperty(Property),
}

impl ClassEscape {
    #[inline(always)]
    pub(crate) fn has_strings(self) -> bool {
        matches!(self, ClassEscape::Property(property) if property.has_strings())
    }
}

#[derive(Clone, Copy)]
pub(crate) enum GroupKind {
    Capture(Group),
    Plain { set: Flags, cleared: Flags },
    Look { behind: bool, negated: bool },
}

impl GroupKind {
    pub(crate) const PLAIN: GroupKind = GroupKind::Plain {
        set: Flags::empty(),
        cleared: Flags::empty(),
    };
}

#[derive(Clone, Copy)]
pub(crate) struct Quantifier {
    pub(crate) min: u32,
    pub(crate) max: u32,
    pub(crate) greedy: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SetOperator {
    Intersection,
    Subtraction,
}

/// Names count from zero, in the order in which the source first mentions them.
pub(crate) type NameId = u32;

/// Takes the parts of a pattern in the order of the source.
pub(crate) trait Sink {
    /// What it needs to get back when a group ends.
    type Outer;

    /// Units that stand for themselves. A surrogate pair is not split.
    fn text<C: CodeUnit>(&mut self, units: &[C]) -> Result<(), Error>;
    fn character(&mut self, c: u32) -> Result<(), Error>;
    fn assertion(&mut self, assertion: Assertion) -> Result<(), Error>;
    fn dot(&mut self) -> Result<(), Error>;
    /// One without strings.
    fn class_escape(&mut self, escape: ClassEscape) -> Result<(), Error>;
    /// Nothing if the group cannot have matched by then.
    fn back_reference(&mut self, group: Option<Group>) -> Result<(), Error>;
    /// To those of `candidates` that have the name.
    fn named_reference(&mut self, name: NameId, candidates: Groups) -> Result<(), Error>;
    /// Of the last character, dot, class escape or back reference.
    fn quantify(&mut self, quantifier: Quantifier) -> Result<(), Error>;

    fn name_group(&mut self, group: Group, name: NameId, text: Text<'_>) -> Result<(), Error>;
    fn open(&mut self, kind: GroupKind) -> Result<Self::Outer, Error>;
    fn next_alternative(&mut self) -> Result<(), Error>;
    /// `captures` has the group itself if it captures.
    fn close(
        &mut self,
        outer: Self::Outer,
        captures: Groups,
        quantifier: Option<Quantifier>,
    ) -> Result<(), Error>;

    fn class_character(&mut self, c: u32) -> Result<(), Error>;
    fn class_range(&mut self, first: u32, last: u32) -> Result<(), Error>;
    fn class_member(&mut self, escape: ClassEscape) -> Result<(), Error>;
    fn close_class(&mut self, negated: bool, quantifier: Option<Quantifier>) -> Result<(), Error>;

    fn open_nested_class(&mut self) -> Result<(), Error>;
    fn close_nested_class(&mut self, negated: bool) -> Result<(), Error>;
    fn set_operator(&mut self, operator: SetOperator) -> Result<(), Error>;
    fn class_string_character(&mut self, c: u32) -> Result<(), Error>;
    fn close_class_string(&mut self) -> Result<(), Error>;
}

/// Keeps nothing.
pub(crate) struct Discard;

macro_rules! discard {
    ($($method:ident($($argument:ty),*);)*) => {$(
        #[inline(always)]
        fn $method(&mut self, $(_: $argument),*) -> Result<(), Error> {
            Ok(())
        }
    )*};
}

impl Sink for Discard {
    type Outer = ();

    #[inline(always)]
    fn text<C: CodeUnit>(&mut self, _: &[C]) -> Result<(), Error> {
        Ok(())
    }

    discard! {
        character(u32);
        assertion(Assertion);
        dot();
        class_escape(ClassEscape);
        back_reference(Option<Group>);
        named_reference(NameId, Groups);
        quantify(Quantifier);
        name_group(Group, NameId, Text<'_>);
        open(GroupKind);
        next_alternative();
        close((), Groups, Option<Quantifier>);
        class_character(u32);
        class_range(u32, u32);
        class_member(ClassEscape);
        close_class(bool, Option<Quantifier>);
        open_nested_class();
        close_nested_class(bool);
        set_operator(SetOperator);
        class_string_character(u32);
        close_class_string();
    }
}
