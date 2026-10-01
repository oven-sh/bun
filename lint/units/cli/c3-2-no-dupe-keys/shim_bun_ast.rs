// Stand-in for the part of bun_ast that src/lint/rules/no_dupe_keys.rs reads.
#![allow(non_snake_case)]

#[derive(Clone, Copy)]
pub struct Loc {
    pub start: i32,
}

pub mod flags {
    #[derive(Clone, Copy)]
    pub enum Property {
        IsComputed,
        IsMethod,
        IsStatic,
        WasShorthand,
        IsSpread,
    }

    // The real set is an `enumset::EnumSet<Property>`: `contains` has the same signature.
    #[derive(Clone, Copy, Default)]
    pub struct PropertySet(u8);

    impl PropertySet {
        pub fn contains(&self, value: Property) -> bool {
            self.0 & (1 << value as u8) != 0
        }

        pub fn insert(&mut self, value: Property) {
            self.0 |= 1 << value as u8;
        }
    }
}

pub struct Expr {
    pub loc: Loc,
    pub data: ExprData,
}

pub enum ExprData {
    EString(Vec<u8>),
    EIdentifier,
}

pub mod G {
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum PropertyKind {
        Normal,
        Get,
        Set,
        Spread,
        Declare,
        Abstract,
        ClassStaticBlock,
        AutoAccessor,
    }

    pub struct Property {
        pub kind: PropertyKind,
        pub flags: super::flags::PropertySet,
        pub key: Option<super::Expr>,
    }

    pub type PropertyList = Vec<Property>;
}

pub mod E {
    pub struct Object {
        pub properties: super::G::PropertyList,
    }
}
