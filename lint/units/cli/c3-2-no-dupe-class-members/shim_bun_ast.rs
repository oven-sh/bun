// Stand-in for the part of bun_ast that src/lint/rules/no_dupe_class_members.rs reads.
#![allow(non_snake_case)]

// `Loc` of src/ast/lib.rs.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
#[repr(transparent)]
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

// `StoreSlice` of src/ast/nodes.rs: it is `Copy`, and `slice` takes it by value and gives a borrow of any lifetime.
pub struct StoreSlice<T> {
    ptr: core::ptr::NonNull<T>,
    len: u32,
}

impl<T> Copy for StoreSlice<T> {}
impl<T> Clone for StoreSlice<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> StoreSlice<T> {
    pub const fn new(s: &[T]) -> Self {
        // SAFETY: `&[T]` always has a non-null data pointer.
        let ptr = unsafe { core::ptr::NonNull::new_unchecked(s.as_ptr().cast_mut()) };
        StoreSlice {
            ptr,
            len: s.len() as u32,
        }
    }

    pub fn slice<'a>(self) -> &'a [T] {
        // SAFETY: `ptr` points at `len` values that the caller of `new` keeps alive, as the arena does in bun_ast.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
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

    pub struct Class {
        pub properties: super::StoreSlice<Property>,
    }
}
