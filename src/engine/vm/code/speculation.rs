use crate::{CellType, JsCell, JsString, Value};

bitflags::bitflags! {
    /// A set of types that a value may have.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    #[repr(transparent)]
    pub struct SpeculatedType: u64 {
        const FINAL_OBJECT = 1 << 0;
        const ARRAY = 1 << 1;
        const FUNCTION = 1 << 2;
        const INT8_ARRAY = 1 << 3;
        const UINT8_ARRAY = 1 << 4;
        const UINT8_CLAMPED_ARRAY = 1 << 5;
        const INT16_ARRAY = 1 << 6;
        const UINT16_ARRAY = 1 << 7;
        const INT32_ARRAY = 1 << 8;
        const UINT32_ARRAY = 1 << 9;
        const FLOAT16_ARRAY = 1 << 10;
        const FLOAT32_ARRAY = 1 << 11;
        const FLOAT64_ARRAY = 1 << 12;
        const BIGINT64_ARRAY = 1 << 13;
        const BIGUINT64_ARRAY = 1 << 14;
        const DATA_VIEW = 1 << 15;
        const DIRECT_ARGUMENTS = 1 << 16;
        const SCOPED_ARGUMENTS = 1 << 17;
        const STRING_OBJECT = 1 << 18;
        const REGEXP_OBJECT = 1 << 19;
        const DATE = 1 << 20;
        const PROMISE = 1 << 21;
        const MAP = 1 << 22;
        const SET = 1 << 23;
        const MAP_ITERATOR = 1 << 24;
        const SET_ITERATOR = 1 << 25;
        const WEAK_MAP = 1 << 26;
        const WEAK_SET = 1 << 27;
        const PROXY = 1 << 28;
        const GLOBAL_PROXY = 1 << 29;
        const DERIVED_ARRAY = 1 << 30;
        const OTHER_OBJECT = 1 << 31;
        const ATOM_STRING = 1 << 32;
        const RESOLVED_STRING = 1 << 33;
        const ROPE_STRING = 1 << 34;
        const SYMBOL = 1 << 35;
        const BIGINT = 1 << 36;
        const OTHER_CELL = 1 << 37;
        /// 0 or 1.
        const BOOL_INT32 = 1 << 38;
        const NON_BOOL_INT32 = 1 << 39;
        const INT32_AS_INT52 = 1 << 40;
        const NON_INT32_AS_INT52 = 1 << 41;
        /// An integer of 52 bits.
        const INT_AS_DOUBLE = 1 << 42;
        const NON_INT_AS_DOUBLE = 1 << 43;
        const PURE_NAN = 1 << 44;
        const IMPURE_NAN = 1 << 45;
        const BOOLEAN = 1 << 46;
        const NULL = 1 << 47;
        const UNDEFINED = 1 << 48;
        const EMPTY = 1 << 49;

        const TYPED_ARRAY = (1 << 15) - (1 << 3);
        const OBJECT = (1 << 32) - 1;
        /// No rope, which it stays.
        const FLAT_STRING = Self::ATOM_STRING.bits() | Self::RESOLVED_STRING.bits();
        const STRING = Self::FLAT_STRING.bits() | Self::ROPE_STRING.bits();
        const CELL = (1 << 38) - 1;
        const INT32 = Self::BOOL_INT32.bits() | Self::NON_BOOL_INT32.bits();
        const INT52 = Self::INT32_AS_INT52.bits() | Self::NON_INT32_AS_INT52.bits();
        const REAL_DOUBLE = Self::INT_AS_DOUBLE.bits() | Self::NON_INT_AS_DOUBLE.bits();
        const BOXED_DOUBLE = Self::REAL_DOUBLE.bits() | Self::PURE_NAN.bits();
        const FULL_DOUBLE = Self::BOXED_DOUBLE.bits() | Self::IMPURE_NAN.bits();
        const BOXED_NUMBER = Self::INT32.bits() | Self::BOXED_DOUBLE.bits();
        const FULL_NUMBER = Self::INT32.bits() | Self::INT52.bits() | Self::FULL_DOUBLE.bits();
        const NULLISH = Self::NULL.bits() | Self::UNDEFINED.bits();
        const HEAP_TOP = Self::CELL.bits() | Self::BOXED_NUMBER.bits() | Self::BOOLEAN.bits() | Self::NULLISH.bits();
        const BYTECODE_TOP = Self::HEAP_TOP.bits() | Self::EMPTY.bits();
    }
}

impl SpeculatedType {
    /// What it is once it has a tag.
    pub fn boxed(self) -> SpeculatedType {
        let mut boxed = self & Self::BYTECODE_TOP;
        if self.intersects(Self::INT52) {
            boxed |= Self::INT32 | Self::INT_AS_DOUBLE;
        }
        if self.intersects(Self::IMPURE_NAN) {
            boxed |= Self::PURE_NAN;
        }
        boxed
    }

    /// Of a string, any kind.
    pub const fn of_cell_type(cell_type: CellType) -> SpeculatedType {
        if CellType::BUFFER_VIEWS.contains(cell_type) {
            let distance = cell_type.0 - CellType::Int8Array.0;
            return Self::from_bits_retain(Self::INT8_ARRAY.bits() << distance);
        }
        match cell_type {
            CellType::String => Self::STRING,
            CellType::Symbol => Self::SYMBOL,
            CellType::BigInt => Self::BIGINT,
            CellType::FinalObject => Self::FINAL_OBJECT,
            CellType::Array => Self::ARRAY,
            CellType::DerivedArray => Self::DERIVED_ARRAY,
            CellType::Function => Self::FUNCTION,
            CellType::DirectArguments => Self::DIRECT_ARGUMENTS,
            CellType::ScopedArguments => Self::SCOPED_ARGUMENTS,
            CellType::StringObject => Self::STRING_OBJECT,
            CellType::RegExpObject => Self::REGEXP_OBJECT,
            CellType::Date => Self::DATE,
            CellType::Promise => Self::PROMISE,
            CellType::Map => Self::MAP,
            CellType::Set => Self::SET,
            CellType::MapIterator => Self::MAP_ITERATOR,
            CellType::SetIterator => Self::SET_ITERATOR,
            CellType::WeakMap => Self::WEAK_MAP,
            CellType::WeakSet => Self::WEAK_SET,
            CellType::Proxy => Self::PROXY,
            CellType::GlobalProxy => Self::GLOBAL_PROXY,
            _ if cell_type.is_object() => Self::OTHER_OBJECT,
            _ => Self::OTHER_CELL,
        }
    }

    /// Looks at nothing but the cell itself, which may be dead as long as it has not been swept.
    pub fn of_cell(cell: &JsCell) -> SpeculatedType {
        match cell.downcast::<JsString>() {
            Some(string) if string.is_atom() => Self::ATOM_STRING,
            Some(string) if string.is_rope() => Self::ROPE_STRING,
            Some(_) => Self::RESOLVED_STRING,
            None => Self::of_cell_type(cell.cell_type()),
        }
    }

    pub fn of_double(number: f64) -> SpeculatedType {
        if number.is_nan() {
            Self::PURE_NAN
        } else if bun_engine_number::exact_int52(number).is_some() {
            Self::INT_AS_DOUBLE
        } else {
            Self::NON_INT_AS_DOUBLE
        }
    }

    /// Of the bits of a value, unless it is a cell.
    pub fn of_immediate(bits: u64) -> Option<SpeculatedType> {
        let is_cell = bits != 0 && bits & Value::NOT_CELL_MASK == 0;
        // SAFETY: no cell, so there is nothing that the bits have to refer to.
        (!is_cell).then(|| Self::of(unsafe { Value::from_bits_or_empty(bits) }))
    }

    pub fn of(value: Option<Value>) -> SpeculatedType {
        let Some(value) = value else {
            return Self::EMPTY;
        };
        if let Some(cell) = value.as_cell() {
            return Self::of_cell(&cell);
        }
        match (value.as_int32(), value.as_double()) {
            (Some(0 | 1), _) => Self::BOOL_INT32,
            (Some(_), _) => Self::NON_BOOL_INT32,
            (_, Some(number)) => Self::of_double(number),
            _ if value.is_boolean() => Self::BOOLEAN,
            _ if value.is_null() => Self::NULL,
            _ => Self::UNDEFINED,
        }
    }
}

const _: () = {
    let views = [
        (CellType::Int8Array, SpeculatedType::INT8_ARRAY),
        (CellType::Uint8Array, SpeculatedType::UINT8_ARRAY),
        (
            CellType::Uint8ClampedArray,
            SpeculatedType::UINT8_CLAMPED_ARRAY,
        ),
        (CellType::Int16Array, SpeculatedType::INT16_ARRAY),
        (CellType::Uint16Array, SpeculatedType::UINT16_ARRAY),
        (CellType::Int32Array, SpeculatedType::INT32_ARRAY),
        (CellType::Uint32Array, SpeculatedType::UINT32_ARRAY),
        (CellType::Float16Array, SpeculatedType::FLOAT16_ARRAY),
        (CellType::Float32Array, SpeculatedType::FLOAT32_ARRAY),
        (CellType::Float64Array, SpeculatedType::FLOAT64_ARRAY),
        (CellType::BigInt64Array, SpeculatedType::BIGINT64_ARRAY),
        (CellType::BigUint64Array, SpeculatedType::BIGUINT64_ARRAY),
        (CellType::DataView, SpeculatedType::DATA_VIEW),
    ];
    let mut index = 0;
    while index < views.len() {
        let (cell_type, speculated) = views[index];
        assert!(SpeculatedType::of_cell_type(cell_type).bits() == speculated.bits());
        index += 1;
    }
};
