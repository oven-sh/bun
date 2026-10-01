// Stand-in for the part of bun_ast that src/lint/rules/valid_typeof.rs reads: the same names, and the same shape of each payload.
#![allow(non_snake_case)]

use std::ops::Deref;

#[derive(Clone, Copy)]
pub struct Loc {
    pub start: i32,
}

// The real one is an index into the names of the parser. Here it is the name.
#[derive(Clone, Copy)]
pub struct Ref(pub &'static [u8]);

// `op::Code`: the operators that the checks use, under their real names.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum OpCode {
    UnNeg,
    UnNot,
    UnVoid,
    UnTypeof,
    UnDelete,
    BinAdd,
    BinLt,
    BinLe,
    BinGt,
    BinGe,
    BinIn,
    BinInstanceof,
    BinLooseEq,
    BinLooseNe,
    BinStrictEq,
    BinStrictNe,
    BinNullishCoalescing,
    BinLogicalOr,
    BinLogicalAnd,
    BinComma,
    BinAssign,
}

// The real one is a pointer into the store of the tree, with the same `Deref`.
pub struct StoreRef<T>(Box<T>);

impl<T> StoreRef<T> {
    pub fn new(value: T) -> Self {
        StoreRef(Box::new(value))
    }
}

impl<T> Deref for StoreRef<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

pub struct Expr {
    pub loc: Loc,
    pub data: ExprData,
}

// `expr::Data`: a variant that holds a `StoreRef` there holds one here, one that holds the node itself holds it here.
pub enum ExprData {
    EUnary(StoreRef<E::Unary>),
    EBinary(StoreRef<E::Binary>),
    ETemplate(StoreRef<E::Template>),
    ERegExp(StoreRef<E::RegExp>),
    EIdentifier(E::Identifier),
    EBoolean(E::Boolean),
    EBranchBoolean(E::Boolean),
    ENumber(E::Number),
    EBigInt(StoreRef<E::BigInt>),
    EString(StoreRef<E::EString>),
    EMissing(E::Missing),
    EThis(E::This),
    ENull(E::Null),
    EUndefined(E::Undefined),
}

pub mod E {
    use super::{Expr, OpCode, Ref};

    pub struct Binary {
        pub left: Expr,
        pub right: Expr,
        pub op: OpCode,
    }

    pub struct Unary {
        pub op: OpCode,
        pub value: Expr,
    }

    pub struct Identifier {
        pub ref_: Ref,
    }

    // The value as the program sees it; `None` stands for a string with an unpaired surrogate.
    pub struct EString {
        pub value: Option<&'static [u8]>,
        pub prefer_template: bool,
    }

    // A template with a substitution, or with a tag.
    pub struct Template {
        pub tagged: bool,
    }

    pub struct RegExp {
        pub value: &'static [u8],
    }

    pub struct BigInt {
        pub value: &'static [u8],
    }

    pub struct Number {
        pub value: f64,
    }

    pub struct Boolean {
        pub value: bool,
    }

    pub struct Null;
    pub struct Undefined;
    pub struct Missing;
    pub struct This;
}
