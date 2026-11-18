use crate::{CellType, Value};

/// Where an object keeps the value of a property: inside the cell below `FIRST_OUT_OF_LINE`, else in its storage.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(transparent)]
pub struct PropertyOffset(i32);

impl PropertyOffset {
    pub const INVALID: PropertyOffset = PropertyOffset(-1);
    pub const FIRST_OUT_OF_LINE: i32 = 64;
    const INITIAL_OUT_OF_LINE_CAPACITY: usize = 4;
    /// Caches have the `byte_offset` in 32 bits.
    pub(super) const MAX_OUT_OF_LINE_CAPACITY: usize = 1 << 27;

    #[inline(always)]
    pub const fn new(offset: i32) -> PropertyOffset {
        PropertyOffset(offset)
    }

    #[inline(always)]
    pub const fn get(self) -> i32 {
        self.0
    }

    #[inline(always)]
    pub const fn is_valid(self) -> bool {
        self.0 >= 0
    }

    #[inline(always)]
    pub const fn is_inline(self) -> bool {
        self.0 < Self::FIRST_OUT_OF_LINE
    }

    /// That of the slot with this number, counting from the first one in the cell.
    #[inline]
    pub const fn for_slot(number: usize, inline_capacity: usize) -> PropertyOffset {
        PropertyOffset(if number < inline_capacity {
            number as i32
        } else {
            (number - inline_capacity) as i32 + Self::FIRST_OUT_OF_LINE
        })
    }

    /// From the start of the cell if it is inline, else from the pointer to the storage. It is valid.
    #[inline(always)]
    pub const fn byte_offset(self) -> isize {
        debug_assert!(self.is_valid());
        if self.is_inline() {
            (self.0 as isize + 2) * 8
        } else {
            (Self::FIRST_OUT_OF_LINE as isize - 2 - self.0 as isize) * 8
        }
    }

    /// The slots in use if this is the highest offset.
    #[inline]
    pub const fn slot_count(self, inline_capacity: usize) -> usize {
        if self.is_inline() {
            (self.0 + 1) as usize
        } else {
            inline_capacity + self.out_of_line_size()
        }
    }

    #[inline(always)]
    pub const fn out_of_line_size(self) -> usize {
        if self.is_inline() {
            0
        } else {
            (self.0 - Self::FIRST_OUT_OF_LINE + 1) as usize
        }
    }

    #[inline(always)]
    pub const fn out_of_line_capacity(self) -> usize {
        Self::capacity_for(self.out_of_line_size())
    }

    #[inline(always)]
    pub const fn capacity_for(out_of_line_size: usize) -> usize {
        match out_of_line_size {
            0 => 0,
            1..=Self::INITIAL_OUT_OF_LINE_CAPACITY => Self::INITIAL_OUT_OF_LINE_CAPACITY,
            size => size.next_power_of_two(),
        }
    }
}

const _: () = {
    let last = PropertyOffset::for_slot(PropertyOffset::MAX_OUT_OF_LINE_CAPACITY - 1, 0);
    assert!(last.byte_offset() >= i32::MIN as isize);
};

bitflags::bitflags! {
    /// A shape keeps those of the low byte. The others describe entries of static tables.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    #[repr(transparent)]
    pub struct Attributes: u32 {
        /// Of an element of `MappedArguments`: the value is that of the parameter.
        const MAPPED = 1 << 0;
        const READ_ONLY = 1 << 1;
        const DONT_ENUM = 1 << 2;
        const DONT_DELETE = 1 << 3;
        /// The slot has a `GetterSetter`.
        const ACCESSOR = 1 << 4;
        /// The slot has a `CustomGetterSetter`, which scripts see as an accessor.
        const CUSTOM_ACCESSOR = 1 << 5;
        /// The slot has a `CustomGetterSetter`, which scripts see as a data property.
        const CUSTOM_VALUE = 1 << 6;
        const FUNCTION = 1 << 8;
        const BUILTIN = 1 << 9;
        const CONSTANT_INTEGER = 1 << 10;
        const CELL_PROPERTY = 1 << 11;
        const CLASS_STRUCTURE = 1 << 12;
        const PROPERTY_CALLBACK = 1 << 13;
        const DOM_ATTRIBUTE = 1 << 14;
        const CONSTRUCTABLE = 1 << 17;

        const CUSTOM = Self::CUSTOM_ACCESSOR.bits() | Self::CUSTOM_VALUE.bits();
        const ANY_ACCESSOR = Self::ACCESSOR.bits() | Self::CUSTOM.bits();
        const REJECTS_PLAIN_STORE =
            Self::READ_ONLY.bits() | Self::ACCESSOR.bits() | Self::CUSTOM_ACCESSOR.bits();
        const LAZY_VALUE = Self::FUNCTION.bits() | Self::BUILTIN.bits() | Self::CELL_PROPERTY.bits()
            | Self::CLASS_STRUCTURE.bits() | Self::PROPERTY_CALLBACK.bits();
        const CONSTANT = Self::READ_ONLY.bits() | Self::DONT_ENUM.bits() | Self::DONT_DELETE.bits();
    }
}

impl Attributes {
    pub const NONE: Attributes = Attributes::empty();

    #[inline(always)]
    pub const fn for_shape(self) -> Attributes {
        Attributes::from_bits_retain(self.bits() & 0xff)
    }

    /// Those for a shape, made to agree with what the slot is going to have.
    #[inline]
    pub fn for_stored(self, value: Value) -> Attributes {
        let plain = self.for_shape() - Attributes::ANY_ACCESSOR;
        match value.as_cell().map(|cell| cell.cell_type()) {
            Some(CellType::GetterSetter) => plain | Attributes::ACCESSOR,
            Some(CellType::CustomGetterSetter) if self.contains(Attributes::CUSTOM_ACCESSOR) => {
                plain | Attributes::CUSTOM_ACCESSOR
            }
            Some(CellType::CustomGetterSetter) => plain | Attributes::CUSTOM_VALUE,
            _ => plain,
        }
    }

    #[inline(always)]
    pub const fn is_writable(self) -> bool {
        !self.contains(Attributes::READ_ONLY)
    }

    #[inline(always)]
    pub const fn is_enumerable(self) -> bool {
        !self.contains(Attributes::DONT_ENUM)
    }

    #[inline(always)]
    pub const fn is_configurable(self) -> bool {
        !self.contains(Attributes::DONT_DELETE)
    }
}
