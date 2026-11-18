//! The values that code names. A realm makes cells of them when it links the code.

use std::rc::Rc;

use bun_engine_text::{Atom, StringRef};

/// A value of the realm. The generator names these; a built-in gets the others from [`crate::Host`].
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct LinkTimeConstant(pub u16);

impl LinkTimeConstant {
    pub const FUNCTION_PROTOTYPE_CALL: LinkTimeConstant = LinkTimeConstant(0);
    pub const FUNCTION_PROTOTYPE_APPLY: LinkTimeConstant = LinkTimeConstant(1);
    pub const OBJECT_PROTOTYPE_HAS_OWN_PROPERTY: LinkTimeConstant = LinkTimeConstant(2);
    pub const REFLECT_CONSTRUCT: LinkTimeConstant = LinkTimeConstant(3);
    pub const EVAL: LinkTimeConstant = LinkTimeConstant(4);
    pub const OBJECT: LinkTimeConstant = LinkTimeConstant(5);
    pub const ARRAY: LinkTimeConstant = LinkTimeConstant(6);
    pub const FIRST_OF_HOST: LinkTimeConstant = LinkTimeConstant(7);
}

#[derive(Clone, Debug)]
pub enum Constant {
    Empty,
    Undefined,
    Null,
    Boolean(bool),
    Int32(i32),
    /// Stays a double if it is a whole number: it was written as one.
    Double(f64),
    String(Atom),
    /// Too long to be worth an atom.
    LongString(StringRef),
    BigInt(Rc<BigIntLiteral>),
    RegExp(Rc<RegExpLiteral>),
    Template(Rc<TemplateSite>),
    Array(Rc<ArrayLiteral>),
    LinkTime(LinkTimeConstant),
}

#[derive(Debug)]
pub struct BigIntLiteral {
    pub digits: StringRef,
    pub radix: u8,
    pub is_negative: bool,
}

/// Free of syntax errors.
#[derive(Debug)]
pub struct RegExpLiteral {
    pub pattern: Atom,
    pub flags: Atom,
}

#[derive(Debug)]
pub struct TemplateSite {
    pub cooked: Box<[Option<Atom>]>,
    pub raw: Box<[Atom]>,
    /// Where it ends in the source, which tells it from all other sites.
    pub end: u32,
}

#[derive(Debug)]
pub enum ArrayLiteral {
    Int32(Box<[i32]>),
    Double(Box<[f64]>),
    Strings(Box<[Atom]>),
    /// Primitives.
    Values(Box<[Constant]>),
}
