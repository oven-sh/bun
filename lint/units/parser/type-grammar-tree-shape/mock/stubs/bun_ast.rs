#![allow(dead_code, non_camel_case_types, clippy::all)]
use std::fmt;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Ref(pub u32);
impl Ref {
    pub const NONE: Ref = Ref(u32::MAX);
    pub fn eql(self, other: Ref) -> bool { self == other }
    pub fn inner_index(self) -> u32 { self.0 }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Loc { pub start: i32 }
impl Loc {
    pub const EMPTY: Loc = Loc { start: -1 };
    pub fn eql(self, other: Loc) -> bool { self.start == other.start }
    pub fn i(self) -> usize { self.start.max(0) as usize }
}
pub fn usize2loc(n: usize) -> Loc { Loc { start: n as i32 } }

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Range { pub loc: Loc, pub len: i32 }
impl Range {
    pub const NONE: Range = Range { loc: Loc::EMPTY, len: 0 };
    pub fn end_i(self) -> usize { self.loc.i() + self.len.max(0) as usize }
}

pub struct Source { pub contents: Vec<u8> }
impl Source {
    pub fn text_for_range(&self, r: Range) -> &[u8] { &self.contents[r.loc.i()..r.end_i()] }
}

pub struct Msg { pub text: String, pub loc: Loc }
#[derive(Default)]
pub struct Log { pub warnings: u32, pub errors: u32, pub msgs: Vec<Msg> }
impl Log {
    pub fn add_range_error<T: AsRef<[u8]>>(&mut self, _source: Option<&Source>, r: Range, text: T) {
        self.errors += 1;
        self.msgs.push(Msg { text: String::from_utf8_lossy(text.as_ref()).into_owned(), loc: r.loc });
    }
    pub fn add_range_error_fmt(&mut self, _source: Option<&Source>, r: Range, args: fmt::Arguments<'_>) {
        self.errors += 1;
        self.msgs.push(Msg { text: format!("{}", args), loc: r.loc });
    }
    pub fn has_errors(&self) -> bool { self.errors > 0 }
}

pub mod op {
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    pub enum Level {
        Lowest, Comma, Spread, Yield, Assign, Conditional, NullishCoalescing, LogicalOr, LogicalAnd, BitwiseOr, BitwiseXor,
        BitwiseAnd, Equals, Compare, Shift, Add, Multiply, Exponentiation, Prefix, Postfix, New, Call, Member,
    }
    impl Level {
        #[inline] pub fn lt(self, b: Level) -> bool { (self as u8) < (b as u8) }
        #[inline] pub fn gt(self, b: Level) -> bool { (self as u8) > (b as u8) }
        #[inline] pub fn gte(self, b: Level) -> bool { (self as u8) >= (b as u8) }
        #[inline] pub fn lte(self, b: Level) -> bool { (self as u8) <= (b as u8) }
    }
}

pub mod ts {
    pub use crate::Ref;
    include!("metadata.rs.inc");
    use std::cell::RefCell;
    thread_local! { static SHAPES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) }; }
    /// Mock of a type node: a shape text in a table.
    #[derive(Clone, Copy, Debug)]
    pub struct Type { pub start: u32, pub end: u32, pub id: u32 }
    impl Type {
        pub fn mk(text: String) -> Type { SHAPES.with(|t| { let mut t = t.borrow_mut(); t.push(text); Type { start: 0, end: 0, id: (t.len() - 1) as u32 } }) }
        pub fn text(self) -> String { SHAPES.with(|t| t.borrow()[self.id as usize].clone()) }
    }
    #[derive(Clone, Copy, Debug)] pub struct Token;
    #[derive(Clone, Copy, Debug)] pub enum TokenKind { Asserts }
    #[derive(Clone, Copy, Debug)] pub struct Name { pub start: u32, pub end: u32 }
    #[derive(Clone, Copy, Debug)] pub enum TypeOperatorKind { KeyOf, Readonly, Unique }
    #[derive(Clone, Copy, Debug)] pub struct TemplatePiece;
    #[derive(Clone, Copy, Debug)] pub struct TemplateLiteralTypeSpan;
    pub struct List<T>(pub core::marker::PhantomData<T>);
    impl<T> Clone for List<T> { fn clone(&self) -> Self { *self } }
    impl<T> Copy for List<T> {}
}

pub mod scope {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Kind { FunctionArgs, FunctionBody }
}
