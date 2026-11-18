//! Types of values, each in 32 bits.
//!
//! ```text
//! bits  0..4   kind
//! bit   4      nullable
//! bits  5..9   abstract heap type; for a defined type `func`, `struct` or `array`
//! bit   9      defined type
//! bits 12..32  index of the defined type
//! ```

use bun_engine_asm::{FloatWidth, Size, Width};

use crate::index::TypeIndex;
use crate::limits::MAX_TYPES;

const KIND_MASK: u32 = 0xf;
const KIND_REF: u32 = ValKind::Ref as u32;
const KIND_I8: u32 = 6;
const KIND_I16: u32 = 7;
const KIND_UNKNOWN: u32 = 8;
const NULLABLE: u32 = 1 << 4;
const ABSTRACT_SHIFT: u32 = 5;
const ABSTRACT_MASK: u32 = 0xf << ABSTRACT_SHIFT;
const ABSTRACT_UNKNOWN: u32 = 0xf << ABSTRACT_SHIFT;
const DEFINED: u32 = 1 << 9;
const INDEX_SHIFT: u32 = 12;

const _: () = assert!(MAX_TYPES <= 1 << (32 - INDEX_SHIFT));

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum ValKind {
    I32,
    I64,
    F32,
    F64,
    V128,
    Ref,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum AbstractHeapType {
    Func,
    NoFunc,
    Extern,
    NoExtern,
    Exn,
    NoExn,
    Any,
    Eq,
    I31,
    Struct,
    Array,
    None,
}

impl AbstractHeapType {
    pub const ALL: [Self; 12] = [
        Self::Func,
        Self::NoFunc,
        Self::Extern,
        Self::NoExtern,
        Self::Exn,
        Self::NoExn,
        Self::Any,
        Self::Eq,
        Self::I31,
        Self::Struct,
        Self::Array,
        Self::None,
    ];

    /// The supertype of all that is in the same hierarchy.
    pub const fn top(self) -> Self {
        match self {
            Self::Func | Self::NoFunc => Self::Func,
            Self::Extern | Self::NoExtern => Self::Extern,
            Self::Exn | Self::NoExn => Self::Exn,
            _ => Self::Any,
        }
    }

    /// The subtype of all that is in the same hierarchy. Only null has it.
    pub const fn bottom(self) -> Self {
        match self.top() {
            Self::Func => Self::NoFunc,
            Self::Extern => Self::NoExtern,
            Self::Exn => Self::NoExn,
            _ => Self::None,
        }
    }

    pub const fn is_subtype_of(self, other: Self) -> bool {
        self as u8 == other as u8
            || match other {
                Self::Func | Self::Extern | Self::Exn | Self::Any => {
                    self.top() as u8 == other as u8
                }
                Self::Eq => matches!(self, Self::I31 | Self::Struct | Self::Array | Self::None),
                Self::I31 | Self::Struct | Self::Array => matches!(self, Self::None),
                Self::NoFunc | Self::NoExtern | Self::NoExn | Self::None => false,
            }
    }
}

/// What a module can define.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum TypeKind {
    Func,
    Struct,
    Array,
}

impl TypeKind {
    #[inline]
    pub const fn abstract_type(self) -> AbstractHeapType {
        match self {
            Self::Func => AbstractHeapType::Func,
            Self::Struct => AbstractHeapType::Struct,
            Self::Array => AbstractHeapType::Array,
        }
    }
}

/// An abstract type or a type of the module. Equal types of one module are equal as integers.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct HeapType(u32);

impl HeapType {
    pub const FUNC: Self = Self::of(AbstractHeapType::Func);
    pub const EXTERN: Self = Self::of(AbstractHeapType::Extern);
    pub const EXN: Self = Self::of(AbstractHeapType::Exn);
    pub const ANY: Self = Self::of(AbstractHeapType::Any);
    pub const EQ: Self = Self::of(AbstractHeapType::Eq);
    pub const I31: Self = Self::of(AbstractHeapType::I31);
    pub const STRUCT: Self = Self::of(AbstractHeapType::Struct);
    pub const ARRAY: Self = Self::of(AbstractHeapType::Array);
    /// Below every heap type. Only the validator sees it, in unreachable code.
    pub(crate) const UNKNOWN: Self = Self(ABSTRACT_UNKNOWN);

    #[inline]
    pub const fn of(ty: AbstractHeapType) -> Self {
        Self((ty as u32) << ABSTRACT_SHIFT)
    }

    #[inline]
    pub(crate) const fn defined(index: TypeIndex, kind: TypeKind) -> Self {
        Self(index.0 << INDEX_SHIFT | DEFINED | Self::of(kind.abstract_type()).0)
    }

    /// `None` for an abstract type.
    #[inline]
    pub const fn index(self) -> Option<TypeIndex> {
        if self.0 & DEFINED != 0 {
            Some(TypeIndex(self.0 >> INDEX_SHIFT))
        } else {
            None
        }
    }

    /// The type itself if it is abstract, otherwise its closest abstract supertype.
    #[inline]
    pub const fn abstract_type(self) -> AbstractHeapType {
        const PADDED: [AbstractHeapType; 16] = {
            let mut padded = [AbstractHeapType::None; 16];
            let mut i = 0;
            while i < AbstractHeapType::ALL.len() {
                padded[i] = AbstractHeapType::ALL[i];
                i += 1;
            }
            padded
        };
        PADDED[((self.0 & ABSTRACT_MASK) >> ABSTRACT_SHIFT) as usize]
    }

    #[inline]
    pub const fn is(self, ty: AbstractHeapType) -> bool {
        self.0 == Self::of(ty).0
    }

    #[inline]
    pub const fn nullable(self) -> RefType {
        RefType::new(self, true)
    }

    #[inline]
    pub const fn non_null(self) -> RefType {
        RefType::new(self, false)
    }

    #[inline]
    pub(crate) const fn has_kind(self, kind: TypeKind) -> bool {
        self.0 & (ABSTRACT_MASK | DEFINED) == DEFINED | Self::of(kind.abstract_type()).0
    }

    /// `defined` decides for two different defined types.
    #[inline]
    pub(crate) fn is_subtype_of(
        self,
        other: Self,
        defined: impl FnOnce(TypeIndex, TypeIndex) -> bool,
    ) -> bool {
        if self == Self::UNKNOWN {
            return true;
        }
        match (self.index(), other.index()) {
            (Some(sub), Some(sup)) => defined(sub, sup),
            (_, None) => self.abstract_type().is_subtype_of(other.abstract_type()),
            (None, Some(_)) => self.is(other.abstract_type().bottom()),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct RefType(u32);

impl RefType {
    pub const FUNCREF: Self = HeapType::FUNC.nullable();
    pub const EXTERNREF: Self = HeapType::EXTERN.nullable();
    pub const EXNREF: Self = HeapType::EXN.nullable();
    pub const ANYREF: Self = HeapType::ANY.nullable();
    pub const EQREF: Self = HeapType::EQ.nullable();
    pub const I31REF: Self = HeapType::I31.nullable();
    pub const STRUCTREF: Self = HeapType::STRUCT.nullable();
    pub const ARRAYREF: Self = HeapType::ARRAY.nullable();

    #[inline]
    pub const fn new(heap_type: HeapType, nullable: bool) -> Self {
        Self(heap_type.0 | KIND_REF | if nullable { NULLABLE } else { 0 })
    }

    #[inline]
    pub const fn heap_type(self) -> HeapType {
        HeapType(self.0 & !(KIND_MASK | NULLABLE))
    }

    #[inline]
    pub const fn is_nullable(self) -> bool {
        self.0 & NULLABLE != 0
    }

    #[inline]
    pub const fn value_type(self) -> ValType {
        ValType(self.0)
    }
}

/// Equal types of one module are equal as integers.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct ValType(u32);

impl ValType {
    pub const I32: Self = Self(ValKind::I32 as u32);
    pub const I64: Self = Self(ValKind::I64 as u32);
    pub const F32: Self = Self(ValKind::F32 as u32);
    pub const F64: Self = Self(ValKind::F64 as u32);
    pub const V128: Self = Self(ValKind::V128 as u32);
    pub const FUNCREF: Self = RefType::FUNCREF.value_type();
    pub const EXTERNREF: Self = RefType::EXTERNREF.value_type();
    pub const EXNREF: Self = RefType::EXNREF.value_type();
    pub const ANYREF: Self = RefType::ANYREF.value_type();
    /// Below every type. Only the validator sees it, in unreachable code.
    pub(crate) const UNKNOWN: Self = Self(KIND_UNKNOWN);
    /// No value has it.
    pub(crate) const NONE: Self = Self(u32::MAX);

    #[inline]
    pub const fn int(width: Width) -> Self {
        match width {
            Width::W32 => Self::I32,
            Width::W64 => Self::I64,
        }
    }

    #[inline]
    pub const fn float(width: FloatWidth) -> Self {
        match width {
            FloatWidth::F32 => Self::F32,
            FloatWidth::F64 => Self::F64,
        }
    }

    #[inline]
    pub const fn to_bits(self) -> u32 {
        self.0
    }

    /// Undoes [`Self::to_bits`].
    #[inline]
    pub const fn from_bits(bits: u32) -> Self {
        Self(bits)
    }

    #[inline]
    pub const fn kind(self) -> ValKind {
        match self.0 & KIND_MASK {
            0 => ValKind::I32,
            1 => ValKind::I64,
            2 => ValKind::F32,
            3 => ValKind::F64,
            4 => ValKind::V128,
            _ => ValKind::Ref,
        }
    }

    #[inline]
    pub const fn is_ref(self) -> bool {
        self.0 & KIND_MASK == KIND_REF
    }

    #[inline]
    pub const fn as_ref(self) -> Option<RefType> {
        if self.is_ref() {
            Some(RefType(self.0))
        } else {
            None
        }
    }

    /// All but references that exclude null have a default value.
    #[inline]
    pub const fn is_defaultable(self) -> bool {
        self.0 & (KIND_MASK | NULLABLE) != KIND_REF
    }

    /// What it takes in a global, a field or an element.
    #[inline]
    pub const fn size_in_bytes(self) -> u32 {
        StorageType(self.0).size_in_bytes()
    }

    #[inline]
    pub(crate) const fn bits(self) -> u32 {
        self.0
    }

    /// To compare two at once.
    #[inline(always)]
    pub(crate) const fn pair([low, high]: [Self; 2]) -> u64 {
        low.0 as u64 | (high.0 as u64) << 32
    }

    /// For slices of the same length. Looking at all elements lets the compiler take several at once.
    #[inline(never)]
    pub(crate) fn all_equal(a: &[Self], b: &[Self]) -> bool {
        a.iter().zip(b).fold(0, |bits, (a, b)| bits | a.0 ^ b.0) == 0
    }

    #[inline]
    pub(crate) const fn defined_index(self) -> Option<TypeIndex> {
        HeapType(self.0).index()
    }

    /// The same nullability with another heap type.
    #[inline]
    pub(crate) const fn with_heap_type(self, heap_type: HeapType) -> Self {
        Self(self.0 & (KIND_MASK | NULLABLE) | heap_type.0)
    }

    #[inline]
    pub(crate) const fn with_index(self, index: u32) -> Self {
        Self(self.0 & ((1 << INDEX_SHIFT) - 1) | index << INDEX_SHIFT)
    }

    /// `defined` decides for references to defined types.
    #[inline]
    pub(crate) fn is_subtype_of(
        self,
        other: Self,
        defined: impl FnOnce(TypeIndex, TypeIndex) -> bool,
    ) -> bool {
        match (self.as_ref(), other.as_ref()) {
            (Some(sub), Some(sup)) => {
                (!sub.is_nullable() || sup.is_nullable())
                    && sub.heap_type().is_subtype_of(sup.heap_type(), defined)
            }
            _ => self == other || self == Self::UNKNOWN,
        }
    }
}

impl From<RefType> for ValType {
    #[inline]
    fn from(ty: RefType) -> Self {
        ty.value_type()
    }
}

/// The type of a field or an element: a value type, or an integer of 8 or 16 bits.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct StorageType(u32);

impl StorageType {
    pub const I8: Self = Self(KIND_I8);
    pub const I16: Self = Self(KIND_I16);

    /// `None` for a value type.
    #[inline]
    pub const fn packed_size(self) -> Option<Size> {
        match self.0 {
            KIND_I8 => Some(Size::S8),
            KIND_I16 => Some(Size::S16),
            _ => None,
        }
    }

    /// The type on the operand stack.
    #[inline]
    pub const fn unpacked(self) -> ValType {
        match self.0 {
            KIND_I8 | KIND_I16 => ValType::I32,
            bits => ValType(bits),
        }
    }

    #[inline]
    pub const fn is_ref(self) -> bool {
        ValType(self.0).is_ref()
    }

    /// A reference takes 8 bytes.
    #[inline]
    pub const fn log2_size(self) -> u8 {
        const LOG2_SIZES: [u8; 8] = [2, 3, 2, 3, 4, 3, 0, 1];
        LOG2_SIZES[(self.0 & 7) as usize]
    }

    #[inline]
    pub const fn size_in_bytes(self) -> u32 {
        1 << self.log2_size()
    }

    /// For what treats both alike. `kind` is meaningless for a packed type.
    #[inline]
    pub(crate) const fn as_value_bits(self) -> ValType {
        ValType(self.0)
    }

    #[inline]
    pub(crate) const fn from_value_bits(bits: ValType) -> Self {
        Self(bits.0)
    }
}

impl From<ValType> for StorageType {
    #[inline]
    fn from(ty: ValType) -> Self {
        Self(ty.0)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct FieldType {
    pub storage: StorageType,
    pub mutable: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum BlockType {
    Empty,
    Value(ValType),
    Func(TypeIndex),
}
