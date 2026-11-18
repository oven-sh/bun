//! What has to be checked to know that a reference has a type.

use bun_engine_wasm_format::{AbstractHeapType, RefType, Rtt, TypeIndex, TypeKind, Types};

use crate::abi::{INT32_TAG, NULL, ObjectType};

/// The bits of which a cell has none.
pub const NOT_CELL_MASK: u64 = INT32_TAG | NULL as u64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Null {
    Impossible,
    Passes,
    Fails,
}

/// What a reference that is not null can be, and so how to tell an `i31ref` and a cell.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    /// An `i31ref` is not below [`INT32_TAG`]. A cell has no bit of [`NOT_CELL_MASK`], and is of any kind.
    Any,
    /// An `i31ref` is negative. The rest are structs and arrays.
    Eq,
    /// A struct, an array or a function.
    Object,
}

/// For a reference that is not null.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Check {
    Passes,
    Fails,
    IsI31(Source),
    /// From [`Source::Any`]: an `i31ref`, a struct or an array.
    IsEq,
    IsObject(Source, ObjectCheck),
    IsFunction(RttCheck),
}

/// For the number of the type of a cell. That of `expected` is in the header for its objects.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ObjectCheck {
    /// The cell may be of any kind.
    Is {
        expected: TypeIndex,
    },
    /// The 32 bits at this offset in the [`ObjectType`] are.
    EntryIs {
        offset: i32,
        expected: TypeIndex,
    },
    /// For the `Rtt` in the [`ObjectType`].
    Rtt(RttCheck),
    KindIs(TypeKind),
}

impl ObjectCheck {
    /// For the type of a struct or an array.
    pub fn new(types: &Types, ty: TypeIndex) -> Self {
        let (expected, depth) = (types.first_index(ty), types.depth(ty));
        if types.is_final(ty) {
            Self::Is { expected }
        } else if depth < ObjectType::DISPLAY_LENGTH {
            let offset = ObjectType::DISPLAY + depth as i32 * 4;
            Self::EntryIs { offset, expected }
        } else {
            Self::Rtt(RttCheck::new(types, ty))
        }
    }
}

/// `expected` is an address.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RttCheck {
    Is {
        expected: usize,
    },
    /// The word at this offset in it is.
    InlineEntryIs {
        offset: i32,
        expected: usize,
    },
    /// Its depth is not less, and the entry for that depth in the long display is.
    LongEntryIs {
        depth: u32,
        expected: usize,
    },
}

impl RttCheck {
    pub fn new(types: &Types, ty: TypeIndex) -> Self {
        let (expected, depth) = (types.rtt(ty).address(), types.depth(ty));
        if types.is_final(ty) {
            Self::Is { expected }
        } else if depth < Rtt::INLINE_DISPLAY_LENGTH {
            let offset = Rtt::DISPLAY_OFFSET + depth as i32 * 8;
            Self::InlineEntryIs { offset, expected }
        } else {
            Self::LongEntryIs { depth, expected }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cast {
    pub null: Null,
    pub check: Check,
}

impl Cast {
    /// Both types are of the same hierarchy.
    pub fn new(types: &Types, from: RefType, to: RefType) -> Self {
        let null = match (from.is_nullable(), to.is_nullable()) {
            (false, _) => Null::Impossible,
            (true, true) => Null::Passes,
            (true, false) => Null::Fails,
        };
        let (from, to) = (from.heap_type(), to.heap_type());
        let source = match from.abstract_type() {
            AbstractHeapType::Any => Source::Any,
            AbstractHeapType::Eq => Source::Eq,
            _ => Source::Object,
        };
        let check = if types.is_heap_subtype(from, to) {
            Check::Passes
        } else if !types.is_heap_subtype(to, from) {
            Check::Fails
        } else if let Some(index) = to.index() {
            match types.kind(index) {
                TypeKind::Func => Check::IsFunction(RttCheck::new(types, index)),
                _ => Check::IsObject(source, ObjectCheck::new(types, index)),
            }
        } else {
            match to.abstract_type() {
                AbstractHeapType::Eq => Check::IsEq,
                AbstractHeapType::I31 => Check::IsI31(source),
                AbstractHeapType::Struct => {
                    Check::IsObject(source, ObjectCheck::KindIs(TypeKind::Struct))
                }
                AbstractHeapType::Array => {
                    Check::IsObject(source, ObjectCheck::KindIs(TypeKind::Array))
                }
                _ => Check::Fails,
            }
        };
        Self { null, check }
    }
}
