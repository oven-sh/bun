// Stand-in for the part of bun_ast that src/lint/rules/no_empty_pattern.rs reads.
#![allow(non_snake_case)]

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Loc {
    pub start: i32,
}

// The real one is a pointer and a length into the arena: `slice` takes it by value there too, and it is `Copy` for every `T`.
pub struct StoreSlice<T: 'static> {
    items: &'static [T],
}

impl<T: 'static> Copy for StoreSlice<T> {}

impl<T: 'static> Clone for StoreSlice<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: 'static> StoreSlice<T> {
    pub fn new(items: &'static [T]) -> Self {
        StoreSlice { items }
    }

    pub fn slice<'a>(self) -> &'a [T] {
        self.items
    }
}

// A hole of an array pattern is an item of this kind in the real tree.
pub struct ArrayBinding {
    pub is_missing: bool,
}

pub struct Expr {
    pub is_missing: bool,
}

pub mod B {
    pub struct Property {}

    pub struct Object {
        pub properties: super::StoreSlice<Property>,
        pub is_single_line: bool,
    }

    pub struct Array {
        pub items: super::StoreSlice<super::ArrayBinding>,
        pub has_spread: bool,
        pub is_single_line: bool,
    }
}

pub mod G {
    pub struct Property {}
}

pub mod E {
    // The real lists are `Vec<_, bun_alloc::AstAlloc>`: `as_slice` is the same call.
    pub struct Array {
        pub items: Vec<super::Expr>,
    }

    pub struct Object {
        pub properties: Vec<super::G::Property>,
    }
}
