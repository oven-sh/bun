//! What the encoder and the decoder agree on.

use bun_engine_syntax::{FieldKind, FunctionKind};
use bun_engine_text::Text;

use crate::bytes::Sink;
use crate::code::{CodeFlags, HandlerKind};
use crate::function::{FunctionInfo, Origin, Visibility};
use crate::scope::{ScopeKind, SlotKind};

/// From `build.rs`.
pub(super) const VERSION: u32 = match u32::from_str_radix(env!("BYTECODE_VERSION"), 10) {
    Ok(version) => version,
    Err(_) => unreachable!(),
};

pub(super) trait Variants: Copy + 'static {
    const ALL: &[Self];

    #[inline]
    fn at(index: u32) -> Option<Self> {
        Self::ALL.get(index as usize).copied()
    }
}

macro_rules! variants {
    ($($name:ident { $($variant:ident),* })*) => {$(
        impl Variants for $name {
            const ALL: &[$name] = &[$($name::$variant),*];
        }

        const _: fn($name) = |value| match value {
            $($name::$variant)|* => {}
        };

        const _: () = {
            let mut index = 0;
            while index < $name::ALL.len() {
                assert!($name::ALL[index] as usize == index);
                index += 1;
            }
        };
    )*};
}

variants! {
    HandlerKind { Catch, Finally, SynthesizedCatch, SynthesizedFinally }
    FunctionKind {
        Normal, Arrow, Method, Getter, Setter, BaseConstructor, DerivedConstructor, NakedConstructor,
        FieldInitializer, StaticBlock
    }
    FieldKind { Named, Private, Computed, StaticBlock }
    Visibility { Public, Private, PrivateRecursive }
    ScopeKind {
        Function, Parameters, FunctionName, Block, Program, SimpleCatch, Catch, Class, Module, With
    }
    SlotKind {
        Variable, Let, Const, Callee, LazyFunction, Import, ImportMeta, PrivateField, PrivateMethod,
        PrivateAccessor, Internal
    }
}

/// The same whichever width stores the text. Returns whether a unit takes two bytes.
pub(super) fn put_units(bytes: &mut Sink<u8>, text: Text<'_>) -> bool {
    match text {
        Text::Latin1(units) => bytes.put(units),
        Text::Utf16(units) if text.fits_latin1() => {
            bytes.extend(units.iter().map(|&unit| unit as u8));
        }
        Text::Utf16(units) => {
            units.iter().for_each(|unit| bytes.put(&unit.to_le_bytes()));
            return true;
        }
    }
    false
}

/// What a reference to a name starts with.
pub(super) mod name {
    pub(in super::super) const EMPTY: u32 = 0;
    pub(in super::super) const PRIVATE: u32 = 1;
    pub(in super::super) const WELL_KNOWN: u32 = 2;
    pub(in super::super) const FIRST_ORDINAL: u32 = 3;
}

/// The low bits of what a constant starts with say what the others are.
pub(super) mod constant {
    pub(in super::super) const TAG_BITS: u32 = 2;
    pub(in super::super) const STRING: u64 = 0;
    pub(in super::super) const INT32: u64 = 1;
    pub(in super::super) const LINK_TIME: u64 = 2;
    pub(in super::super) const OTHER: u64 = 3;

    pub(in super::super) const EMPTY: u64 = 0;
    pub(in super::super) const UNDEFINED: u64 = 1;
    pub(in super::super) const NULL: u64 = 2;
    pub(in super::super) const FALSE: u64 = 3;
    pub(in super::super) const TRUE: u64 = 4;
    pub(in super::super) const DOUBLE: u64 = 5;
    pub(in super::super) const LONG_STRING: u64 = 6;
    pub(in super::super) const PART_OF_SOURCE: u64 = 7;
    pub(in super::super) const BIGINT: u64 = 8;
    pub(in super::super) const REGEXP: u64 = 9;
    pub(in super::super) const TEMPLATE: u64 = 10;
    pub(in super::super) const INT32_ARRAY: u64 = 11;
    pub(in super::super) const DOUBLE_ARRAY: u64 = 12;
    pub(in super::super) const STRING_ARRAY: u64 = 13;
    pub(in super::super) const VALUE_ARRAY: u64 = 14;
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    pub(super) struct CodeHead: u8 {
        const IS_STRICT = 1 << 0;
        const SUSPENDS = 1 << 1;
        const HAS_TAIL_CALLS = 1 << 2;
        const HAS_POSITIONS = 1 << 3;
        const HAS_SCOPES = 1 << 4;
        const HAS_FUNCTIONS = 1 << 5;
        const HAS_LISTS = 1 << 6;
        const HAS_TABLES = 1 << 7;
    }

    /// With the kind in the low bits. The first byte has what is common.
    #[derive(Clone, Copy)]
    pub(super) struct FunctionHead: u32 {
        const KIND = 15;
        const HAS_OWN_NAME = 1 << 4;
        const HAS_CODE = 1 << 5;
        const HAS_KNOWN_NAME = 1 << 6;
        /// From the function before it, in its visibility, context or scope.
        const DIFFERS = 1 << 7;
        const HAS_OTHER_TEXT = 1 << 8;
        const IS_NAMED_BY_SYMBOL = 1 << 9;
        const IS_DEFAULT_CONSTRUCTOR = 1 << 10;
    }

    /// With the kind in the low bits.
    #[derive(Clone, Copy)]
    pub(super) struct ScopeHead: u8 {
        const KIND = 15;
        const HAS_EVAL_VARIABLES = 1 << 4;
        const IS_OUTERMOST = 1 << 5;
    }

    /// With the kind in the low bits.
    #[derive(Clone, Copy)]
    pub(super) struct SlotHead: u8 {
        const KIND = 15;
        const HAS_KNOWN_NAME = 1 << 4;
        const IS_NAMED_BY_SYMBOL = 1 << 5;
        /// Some slots lie between it and the one before.
        const SKIPS = 1 << 6;
        const HAS_DETAIL = 1 << 7;
    }
}

impl CodeHead {
    pub(super) const FLAGS: [(CodeHead, CodeFlags); 3] = [
        (CodeHead::IS_STRICT, CodeFlags::STRICT),
        (CodeHead::SUSPENDS, CodeFlags::SUSPENDS),
        (CodeHead::HAS_TAIL_CALLS, CodeFlags::HAS_TAIL_CALLS),
    ];
}

/// What the record of its code starts with.
pub(super) fn signature(function: &FunctionInfo) -> u8 {
    function.kind as u8
        | u8::from(function.is_async()) << 4
        | u8::from(function.is_generator()) << 5
        | u8::from(function.origin.contains(Origin::DEFAULT_CONSTRUCTOR)) << 6
}

pub(super) const HASH_BYTES: usize = 3;

/// For a table whose keys differ in few bits.
pub(super) fn spread(key: u64) -> u64 {
    key.wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(32)
}

pub(super) fn canonical(value: f64) -> f64 {
    if value.is_nan() {
        f64::from_bits(0x7ff8 << 48)
    } else {
        value
    }
}
