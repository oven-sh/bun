//! What code that is not optimized records for the optimizer.

use core::cell::Cell;

use crate::{
    CellType, ElementKind, IndexingMode, JsCell, JsObject, JsTypedArray, Shape, ShapeId,
    SpeculatedType, Value, heap::Survivors,
};

/// The last value that an instruction produced. It is not kept alive.
#[repr(transparent)]
pub struct ValueProfile(Cell<u64>);

impl ValueProfile {
    #[inline(always)]
    pub fn record(&self, value: Value) {
        self.0.set(value.to_bits());
    }

    #[inline(always)]
    pub fn record_bits(&self, bits: u64) {
        self.0.set(bits);
    }

    pub fn last(&self) -> Option<Value> {
        // SAFETY: cleared when a collection finds the cell dead, before it is swept.
        unsafe { Value::from_bits_or_empty(self.0.get()) }
    }

    pub(super) fn take_type(&self) -> SpeculatedType {
        let last = self.last();
        self.0.set(0);
        last.map_or_default(|value| SpeculatedType::of(Some(value)))
    }

    pub(super) fn clear_if_dead(&self, survivors: &Survivors) {
        if self.last().is_some_and(|it| !survivors.contains_value(it)) {
            self.0.set(0);
        }
    }
}

bitflags::bitflags! {
    /// What an instruction has seen. `LHS_*` and `RHS_*` are the same bits in two places, which `as_rhs` moves
    /// between.
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    #[repr(transparent)]
    pub struct Arithmetic: u32 {
        const LHS_INT32 = 1 << 0;
        const LHS_DOUBLE = 1 << 1;
        const LHS_OTHER = 1 << 2;
        const RHS_INT32 = 1 << 3;
        const RHS_DOUBLE = 1 << 4;
        const RHS_OTHER = 1 << 5;
        /// Of operands that are int32.
        const RESULT_OVERFLOWED_INT32 = 1 << 6;
        const RESULT_OVERFLOWED_INT52 = 1 << 7;
        const RESULT_DOUBLE = 1 << 8;
        const RESULT_NEGATIVE_ZERO = 1 << 9;
        const RESULT_BIGINT = 1 << 10;
        const RESULT_STRING = 1 << 11;
        /// Only the slow path says so.
        const RESULT_INT32 = 1 << 12;
        /// From here on, what `OTHER` has been. Compiled code leaves that to the slow path.
        const LHS_STRING = 1 << 16;
        const LHS_BOOLEAN = 1 << 17;
        const LHS_NULLISH = 1 << 18;
        const LHS_BIGINT = 1 << 19;
        /// Or a symbol.
        const LHS_OBJECT = 1 << 20;
        const RHS_STRING = 1 << 24;
        const RHS_BOOLEAN = 1 << 25;
        const RHS_NULLISH = 1 << 26;
        const RHS_BIGINT = 1 << 27;
        const RHS_OBJECT = 1 << 28;

        const BOTH_INT32 = Self::LHS_INT32.bits() | Self::RHS_INT32.bits();
        const OF_TWO_STRINGS = Self::LHS_OTHER.bits() | Self::LHS_STRING.bits()
            | Self::RHS_OTHER.bits() | Self::RHS_STRING.bits() | Self::RESULT_STRING.bits();
    }
}

impl Arithmetic {
    #[inline(always)]
    pub fn of_lhs(value: Value) -> Arithmetic {
        if value.is_int32() {
            Arithmetic::LHS_INT32
        } else if value.is_number() {
            Arithmetic::LHS_DOUBLE
        } else {
            Arithmetic::LHS_OTHER | Self::of_other_lhs(value)
        }
    }

    #[inline(always)]
    fn of_other_lhs(value: Value) -> Arithmetic {
        match value.as_cell().map(|cell| cell.cell_type()) {
            Some(CellType::String) => Arithmetic::LHS_STRING,
            Some(CellType::BigInt) => Arithmetic::LHS_BIGINT,
            Some(_) => Arithmetic::LHS_OBJECT,
            None if value.is_boolean() => Arithmetic::LHS_BOOLEAN,
            None => Arithmetic::LHS_NULLISH,
        }
    }

    #[inline(always)]
    pub fn of_rhs(value: Value) -> Arithmetic {
        Arithmetic::from_bits_retain(Self::as_rhs(Self::of_lhs(value).bits()))
    }

    /// The same about the right operand, which the bits say in their own places.
    const fn as_rhs(bits: u32) -> u32 {
        (bits & 0xffff) << 3 | (bits & !0xffff) << 8
    }

    /// For what compiled code records itself.
    pub const fn low_half(self) -> i32 {
        assert!(self.bits() >> 16 == 0);
        self.bits() as i32
    }

    pub fn types_of_lhs(self) -> SpeculatedType {
        use SpeculatedType as T;
        let types = [
            (Arithmetic::LHS_INT32, T::INT32),
            (Arithmetic::LHS_DOUBLE, T::BOXED_DOUBLE),
            (Arithmetic::LHS_STRING, T::STRING),
            (Arithmetic::LHS_BOOLEAN, T::BOOLEAN),
            (Arithmetic::LHS_NULLISH, T::NULLISH),
            (Arithmetic::LHS_BIGINT, T::BIGINT),
            (Arithmetic::LHS_OBJECT, T::OBJECT | T::SYMBOL),
        ];
        let seen = types.into_iter().filter(|it| self.contains(it.0));
        seen.fold(T::empty(), |all, it| all | it.1)
    }

    pub fn types_of_rhs(self) -> SpeculatedType {
        let bits = self.bits();
        Arithmetic::from_bits_retain(bits >> 3 & 7 | bits >> 8 & 0xff_0000).types_of_lhs()
    }

    pub fn types_of_result(self) -> SpeculatedType {
        use SpeculatedType as T;
        let doubles = Arithmetic::RESULT_DOUBLE | Arithmetic::RESULT_NEGATIVE_ZERO;
        let has_int32_or_no_rhs = self.types_of_rhs().is_empty() || self.contains(Self::RHS_INT32);
        let mut seen = self;
        if has_int32_or_no_rhs && self.contains(Arithmetic::LHS_INT32) {
            seen |= Arithmetic::RESULT_INT32;
        }
        let types = [
            (Arithmetic::RESULT_INT32, T::INT32),
            (doubles, T::BOXED_DOUBLE),
            (Arithmetic::RESULT_BIGINT, T::BIGINT),
            (Arithmetic::RESULT_STRING, T::STRING),
        ];
        let found = types.into_iter().filter(|it| seen.intersects(it.0));
        found.fold(T::empty(), |all, it| all | it.1)
    }

    #[inline(always)]
    pub fn of_result(value: Value) -> Arithmetic {
        const INT52_LIMIT: f64 = (1u64 << 51) as f64;
        match value.as_double() {
            Some(number) if number == 0.0 && number.is_sign_negative() => {
                Arithmetic::RESULT_NEGATIVE_ZERO
            }
            Some(number) if number.abs() >= INT52_LIMIT => {
                Arithmetic::RESULT_DOUBLE | Arithmetic::RESULT_OVERFLOWED_INT52
            }
            Some(_) => Arithmetic::RESULT_DOUBLE,
            None if value.is_bigint() => Arithmetic::RESULT_BIGINT,
            None if value.is_string() => Arithmetic::RESULT_STRING,
            None => Arithmetic::RESULT_INT32,
        }
    }
}

/// An operator with one operand has it on the left.
#[repr(C, align(8))]
pub struct ArithmeticProfile(Cell<Arithmetic>);

impl ArithmeticProfile {
    #[inline(always)]
    pub fn get(&self) -> Arithmetic {
        self.0.get()
    }

    #[inline(always)]
    pub fn record(&self, seen: Arithmetic) {
        self.0.set(self.0.get() | seen);
    }

    pub(super) fn set(&self, seen: Arithmetic) {
        self.0.set(seen);
    }

    #[inline]
    pub fn record_unary(&self, operand: Value, result: Value) {
        let mut seen = Arithmetic::of_lhs(operand) | Arithmetic::of_result(result);
        if operand.is_int32() && !result.is_int32() {
            seen |= Arithmetic::RESULT_OVERFLOWED_INT32;
        }
        self.record(seen);
    }

    #[inline]
    pub fn record_binary(&self, lhs: Value, rhs: Value, result: Value) {
        let mut seen =
            Arithmetic::of_lhs(lhs) | Arithmetic::of_rhs(rhs) | Arithmetic::of_result(result);
        if lhs.is_int32() && rhs.is_int32() && !result.is_int32() {
            seen |= Arithmetic::RESULT_OVERFLOWED_INT32;
        }
        self.record(seen);
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
    #[repr(transparent)]
    pub struct ArrayModes: u32 {
        const NO_ELEMENTS = 1 << 0;
        const UNDECIDED = 1 << 1;
        const INT32 = 1 << 2;
        const DOUBLE = 1 << 3;
        const CONTIGUOUS = 1 << 4;
        const SPARSE = 1 << 5;
        const ARRAY = 1 << 6;
        const NON_ARRAY = 1 << 7;
        const COPY_ON_WRITE = 1 << 8;
        const SLOW_PUT = 1 << 9;
        /// The first of twelve, in the order of the cell types.
        const INT8_ARRAY = 1 << 10;
        const TYPED_ARRAYS = 0xfff << 10;
        const STRING = 1 << 22;
        const DIRECT_ARGUMENTS = 1 << 23;
        const SCOPED_ARGUMENTS = 1 << 24;
        const EXOTIC = 1 << 25;
        const NON_ORIGINAL_ARRAY_SHAPE = 1 << 26;
        const RESIZABLE_TYPED_ARRAY = 1 << 27;
        /// Read, or appended.
        const HOLE = 1 << 28;
        /// Elements have been seen after others that they can be turned into.
        const MIXED = 1 << 29;
        const OUT_OF_BOUNDS = 1 << 30;
        /// Of a typed array, above the greatest int32. Of anything else, negative.
        const UNUSUAL_INDEX = 1 << 31;

        const STORED = (1 << 6) - 1;
    }
}

impl ArrayModes {
    /// By the bits of an `IndexingMode`, for compiled code.
    pub const OF_INDEXING_MODES: &[u16; 64] = &{
        let (mut all, mut bits) = ([0; 64], 0);
        while bits < all.len() {
            all[bits] = Self::of_indexing_mode(IndexingMode::from_bits(bits as u8)).bits() as u16;
            bits += 1;
        }
        all
    };

    pub const fn of_typed_array(cell_type: CellType) -> ArrayModes {
        let distance = cell_type.0 - CellType::Int8Array.0;
        ArrayModes::from_bits_retain(Self::INT8_ARRAY.bits() << distance)
    }

    const fn of_indexing_mode(mode: IndexingMode) -> ArrayModes {
        let mut modes = ArrayModes::from_bits_retain(1 << (mode.kind() as u32 / 2));
        modes = modes.union(if mode.is_array() {
            Self::ARRAY
        } else {
            Self::NON_ARRAY
        });
        if mode.is_copy_on_write() {
            modes = modes.union(Self::COPY_ON_WRITE);
        }
        if mode.is_slow_put() {
            modes = modes.union(Self::SLOW_PUT);
        }
        modes
    }

    pub fn of_shape(shape: &Shape) -> ArrayModes {
        let cell_type = shape.instance_type();
        if CellType::TYPED_ARRAYS.contains(cell_type) {
            let mut modes = Self::of_typed_array(cell_type);
            let is_resizable = crate::is_shape_of_resizable_view(shape);
            modes.set(ArrayModes::RESIZABLE_TYPED_ARRAY, is_resizable);
            return modes;
        }
        match cell_type {
            CellType::String => return ArrayModes::STRING,
            CellType::DirectArguments => return ArrayModes::DIRECT_ARGUMENTS,
            CellType::ScopedArguments => return ArrayModes::SCOPED_ARGUMENTS,
            _ if !cell_type.is_object() || shape.may_intercept_indexed_access() => {
                return ArrayModes::EXOTIC;
            }
            _ => {}
        }
        let mode = shape.instance_indexing_mode();
        let mut modes = Self::of_indexing_mode(mode);
        let is_original = shape
            .global()
            .is_some_and(|global| global.is_original_array_shape(shape));
        modes.set(
            ArrayModes::NON_ORIGINAL_ARRAY_SHAPE,
            mode.is_array() && !is_original,
        );
        modes
    }
}

const _: () = assert!(1 << (ElementKind::Sparse as u32 / 2) == ArrayModes::SPARSE.bits());

#[repr(C, align(8))]
pub struct ArrayProfile {
    last_shape: Cell<ShapeId>,
    modes: Cell<ArrayModes>,
}

impl ArrayProfile {
    pub const OFFSET_OF_LAST_SHAPE: usize = core::mem::offset_of!(ArrayProfile, last_shape);
    pub const OFFSET_OF_MODES: usize = core::mem::offset_of!(ArrayProfile, modes);

    #[inline(always)]
    pub fn record_shape(&self, cell: &JsCell) {
        self.last_shape.set(cell.shape_id());
    }

    /// False if that would lose another one.
    #[inline(always)]
    pub fn try_record_shape(&self, cell: &JsCell) -> bool {
        let last = self.last_shape.get();
        if last.is_none() {
            self.record_shape(cell);
        }
        last.is_none() || last == cell.shape_id()
    }

    #[inline(always)]
    pub fn record(&self, seen: ArrayModes) {
        self.modes.set(self.modes.get() | seen);
    }

    pub(super) fn set(&self, seen: ArrayModes) {
        self.modes.set(seen);
    }

    /// For a slow path, which has the time not to lose what was seen before.
    #[inline(always)]
    pub fn record_base(&self, base: Value) {
        match base.as_cell() {
            Some(cell) if cell.shape_id() == self.last_shape.get() => {}
            Some(cell) => {
                self.update();
                self.record_shape(&cell);
            }
            None => self.record(ArrayModes::EXOTIC),
        }
    }

    /// For an access that the fast path did not take.
    pub fn record_index(&self, object: &JsObject, index: u32, is_store: bool) {
        if let Some(array) = object.downcast::<JsTypedArray>() {
            return self.record_typed_index(&array, index as usize);
        }
        if !object.element_kind().is_dense() {
            return;
        }
        let limit = if is_store {
            object.vector_length()
        } else {
            object.public_length()
        };
        if index >= limit {
            self.record(ArrayModes::OUT_OF_BOUNDS);
        } else if if is_store {
            index >= object.public_length()
        } else {
            object.try_get_dense(index).is_none()
        } {
            self.record(ArrayModes::HOLE);
        }
    }

    /// The base is no typed array.
    pub fn record_negative_index(&self, base: Value) {
        self.record_base(base);
        self.record(ArrayModes::OUT_OF_BOUNDS | ArrayModes::UNUSUAL_INDEX);
    }

    pub fn record_typed_index(&self, array: &JsTypedArray, index: usize) {
        if !array.is_valid_index(index) {
            self.record(ArrayModes::OUT_OF_BOUNDS);
        } else if index > i32::MAX as usize {
            self.record(ArrayModes::UNUSUAL_INDEX);
        }
    }

    fn merge(&self, latest: ArrayModes) {
        let [earlier, kind] = [self.modes.get(), latest].map(|it| (it & ArrayModes::STORED).bits());
        if kind != 0 && earlier >= kind * 2
            || earlier != 0 && latest.contains(ArrayModes::COPY_ON_WRITE)
        {
            self.record(ArrayModes::MIXED);
        }
        self.record(latest);
    }

    pub(crate) fn update(&self) {
        let shape = self.last_shape.replace(ShapeId::NONE);
        if !shape.is_none() {
            // SAFETY: updated when a collection ends, before anything is swept.
            self.merge(ArrayModes::of_shape(&*unsafe { shape.decode() }));
        }
    }

    pub fn modes(&self) -> ArrayModes {
        self.update();
        self.modes.get()
    }
}

const _: () = {
    let pairs = [
        (Arithmetic::LHS_INT32, Arithmetic::RHS_INT32),
        (Arithmetic::LHS_DOUBLE, Arithmetic::RHS_DOUBLE),
        (Arithmetic::LHS_OTHER, Arithmetic::RHS_OTHER),
        (Arithmetic::LHS_STRING, Arithmetic::RHS_STRING),
        (Arithmetic::LHS_BOOLEAN, Arithmetic::RHS_BOOLEAN),
        (Arithmetic::LHS_NULLISH, Arithmetic::RHS_NULLISH),
        (Arithmetic::LHS_BIGINT, Arithmetic::RHS_BIGINT),
        (Arithmetic::LHS_OBJECT, Arithmetic::RHS_OBJECT),
    ];
    let mut index = 0;
    while index < pairs.len() {
        let (lhs, rhs) = pairs[index];
        assert!(Arithmetic::as_rhs(lhs.bits()) == rhs.bits());
        index += 1;
    }
};
