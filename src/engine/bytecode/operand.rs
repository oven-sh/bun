//! What the operands of an instruction are, and how each width stores them.

/// A slot of the frame, in words from the frame pointer.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Register(i32);

impl Register {
    pub const CALLEE: Register = Register(3);
    pub const THIS: Register = Register(5);
    /// `enter` loads the scope of the callee into it.
    pub const SCOPE: Register = Register::local(0);
    /// The slots of a frame below `this`.
    pub const HEADER_WORDS: u32 = 5;

    #[inline(always)]
    pub const fn from_offset(offset: i32) -> Register {
        Register(offset)
    }

    /// The inverse of [`Field::word`].
    #[inline(always)]
    pub const fn from_word(word: u32) -> Register {
        Register(word as i32)
    }

    #[inline(always)]
    pub const fn local(index: u32) -> Register {
        Register(-1 - index as i32)
    }

    /// Argument 0 is the one after `this`.
    #[inline(always)]
    pub const fn argument(index: u32) -> Register {
        Register(Self::THIS.0 + 1 + index as i32)
    }

    /// Where the caller puts an argument for a callee whose frame is `frame` words below its own.
    #[inline(always)]
    pub const fn outgoing_argument(frame: u32, index: u32) -> Register {
        Register(Self::argument(index).0 - frame as i32)
    }

    #[inline(always)]
    pub const fn offset(self) -> i32 {
        self.0
    }

    #[inline(always)]
    pub const fn is_local(self) -> bool {
        self.0 < 0
    }

    #[inline(always)]
    pub const fn local_index(self) -> Option<u32> {
        if self.0 < 0 {
            Some((-1 - self.0) as u32)
        } else {
            None
        }
    }

    /// Element `index` of the run of locals that starts here.
    #[inline(always)]
    pub const fn nth(self, index: u32) -> Register {
        Register(self.0.wrapping_sub(index as i32))
    }
}

/// A register or a constant.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Operand(i32);

impl Operand {
    const FIRST_CONSTANT: i32 = Wide32::FIRST_CONSTANT;

    #[inline(always)]
    pub const fn constant(index: u32) -> Operand {
        Operand(Self::FIRST_CONSTANT + index as i32)
    }

    /// The inverse of [`Field::word`].
    #[inline(always)]
    pub const fn from_word(word: u32) -> Operand {
        Operand(word as i32)
    }

    #[inline(always)]
    pub const fn as_constant(self) -> Option<u32> {
        if self.0 >= Self::FIRST_CONSTANT {
            Some((self.0 - Self::FIRST_CONSTANT) as u32)
        } else {
            None
        }
    }

    #[inline(always)]
    pub const fn as_register(self) -> Option<Register> {
        if self.0 < Self::FIRST_CONSTANT {
            Some(Register(self.0))
        } else {
            None
        }
    }
}

impl From<Register> for Operand {
    #[inline(always)]
    fn from(register: Register) -> Operand {
        Operand(register.0)
    }
}

impl PartialEq<Register> for Operand {
    #[inline(always)]
    fn eq(&self, other: &Register) -> bool {
        self.0 == other.0
    }
}

/// The distance in bytes from the start of the instruction, prefix included.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Jump(pub i32);

impl Jump {
    #[inline(always)]
    pub const fn from(self, offset: u32) -> u32 {
        offset.wrapping_add_signed(self.0)
    }
}

/// The bytes of one instruction, from its opcode on.
pub trait Bytes: Copy {
    fn u8(self, at: usize) -> u8;
    fn u16(self, at: usize) -> u16;
    fn u32(self, at: usize) -> u32;
}

/// Panics past the end.
impl Bytes for &[u8] {
    #[inline(always)]
    fn u8(self, at: usize) -> u8 {
        self[at]
    }

    #[inline(always)]
    fn u16(self, at: usize) -> u16 {
        u16::from_le_bytes([self[at], self[at + 1]])
    }

    #[inline(always)]
    fn u32(self, at: usize) -> u32 {
        u32::from_le_bytes([self[at], self[at + 1], self[at + 2], self[at + 3]])
    }
}

/// An instruction is `[prefix] opcode operand* [metadata]`.
pub trait Width {
    const PREFIX_BYTES: usize;
    const OPERAND_BYTES: usize;
    const METADATA_BYTES: usize;
    /// A stored operand from here on is a constant.
    const FIRST_CONSTANT: i32;

    fn signed(bytes: impl Bytes, index: usize) -> i32;
    fn unsigned(bytes: impl Bytes, index: usize) -> u32;
    fn metadata(bytes: impl Bytes, operands: usize) -> u32;
}

macro_rules! widths {
    ($($name:ident { prefix: $prefix:literal, operand: $read:ident / $signed:ty, metadata: $read_metadata:ident, first_constant: $first:literal })*) => {$(
        pub enum $name {}

        impl Width for $name {
            const PREFIX_BYTES: usize = $prefix;
            const OPERAND_BYTES: usize = size_of::<$read>();
            const METADATA_BYTES: usize = size_of::<$read_metadata>();
            const FIRST_CONSTANT: i32 = $first;

            #[inline(always)]
            fn signed(bytes: impl Bytes, index: usize) -> i32 {
                i32::from(bytes.$read(1 + index * Self::OPERAND_BYTES) as $signed)
            }

            #[inline(always)]
            fn unsigned(bytes: impl Bytes, index: usize) -> u32 {
                u32::from(bytes.$read(1 + index * Self::OPERAND_BYTES))
            }

            #[inline(always)]
            fn metadata(bytes: impl Bytes, operands: usize) -> u32 {
                u32::from(bytes.$read_metadata(1 + operands * Self::OPERAND_BYTES))
            }
        }
    )*};
}

widths! {
    Narrow { prefix: 0, operand: u8 / i8, metadata: u16, first_constant: 16 }
    Wide16 { prefix: 1, operand: u16 / i16, metadata: u16, first_constant: 64 }
    Wide32 { prefix: 1, operand: u32 / i32, metadata: u32, first_constant: 0x4000_0000 }
}

/// A type that an operand decodes to.
pub trait Field: Copy {
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> Self;
    /// The operand as `Wide32` stores it.
    fn word(self) -> u32;
}

impl Field for Register {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> Register {
        Register(W::signed(bytes, index))
    }

    #[inline(always)]
    fn word(self) -> u32 {
        self.0 as u32
    }
}

impl Field for Operand {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> Operand {
        let stored = W::signed(bytes, index);
        if stored >= W::FIRST_CONSTANT {
            Operand(stored - W::FIRST_CONSTANT + Self::FIRST_CONSTANT)
        } else {
            Operand(stored)
        }
    }

    #[inline(always)]
    fn word(self) -> u32 {
        self.0 as u32
    }
}

impl Field for Jump {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> Jump {
        Jump(W::signed(bytes, index))
    }

    #[inline(always)]
    fn word(self) -> u32 {
        self.0 as u32
    }
}

impl Field for u32 {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> u32 {
        W::unsigned(bytes, index)
    }

    #[inline(always)]
    fn word(self) -> u32 {
        self
    }
}

impl Field for bool {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> bool {
        W::unsigned(bytes, index) != 0
    }

    #[inline(always)]
    fn word(self) -> u32 {
        u32::from(self)
    }
}

macro_rules! indices {
    ($($(#[$doc:meta])* $name:ident)*) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub struct $name(pub u32);

        impl $name {
            #[inline(always)]
            pub const fn index(self) -> usize {
                self.0 as usize
            }
        }

        impl Field for $name {
            #[inline(always)]
            fn read<W: Width>(bytes: impl Bytes, index: usize) -> $name {
                $name(W::unsigned(bytes, index))
            }

            #[inline(always)]
            fn word(self) -> u32 {
                self.0
            }
        }
    )*};
}

indices! {
    /// Into `Code::identifiers`.
    IdentifierIndex
    /// Into `Code::constants`.
    ConstantIndex
    /// Into `Code::functions`.
    FunctionIndex
    /// Into `Code::scopes`.
    ScopeIndex
    /// Into `Code::name_lists`.
    NameListIndex
    /// Into `Body::int_switches`.
    IntSwitchIndex
    /// Into `Code::string_switches`.
    StringSwitchIndex
    /// Into `Body::spread_masks`.
    SpreadMaskIndex
    /// Into `Body::suspend_points`.
    SuspendPointIndex
    /// Into `Body::coverage_blocks`.
    CoverageBlockIndex
}

macro_rules! enumerations {
    ($($(#[$doc:meta])* $name:ident { $(#[$first_doc:meta])* $first:ident, $($(#[$variant_doc:meta])* $variant:ident,)* })*) => {
    $(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum $name {
            $(#[$first_doc])* $first,
            $($(#[$variant_doc])* $variant,)*
        }

        impl $name {
            pub(crate) const COUNT: u32 = [$name::$first, $($name::$variant),*].len() as u32;

            /// The first variant for what is none, which the verifier refuses.
            #[inline(always)]
            pub(crate) fn from_word(word: u32) -> $name {
                $(if word == $name::$variant as u32 {
                    return $name::$variant;
                })*
                $name::$first
            }
        }

        impl Field for $name {
            #[inline(always)]
            fn read<W: Width>(bytes: impl Bytes, index: usize) -> $name {
                $name::from_word(W::unsigned(bytes, index))
            }

            #[inline(always)]
            fn word(self) -> u32 {
                self as u32
            }
        }
    )*};
}

enumerations! {
    /// What a read of a name that nothing binds does.
    Unresolved {
        Throw,
        /// The operand of `typeof`.
        Undefined,
    }

    ErrorKind {
        TypeError,
        RangeError,
        ReferenceError,
        SyntaxError,
        OutOfMemory,
    }

    /// An error with a fixed text. See [`StaticError::kind`] and [`StaticError::message`].
    StaticError {
        AssignToConstant,
        AssignToCall,
        PrefixIncrementOfCall,
        PrefixDecrementOfCall,
        PostfixIncrementOfCall,
        PostfixDecrementOfCall,
        ForInTargetIsCall,
        ForOfTargetIsCall,
        DeleteSuperProperty,
        PropertyOfNullish,
        IteratorResultNotObject,
        DelegateHasNoThrow,
        StaticFieldNamedPrototype,
        StaticBrandMismatch,
        StaticBrandOfNonObject,
        NoPrivateGetter,
        NoPrivateSetter,
        /// Names the class.
        ClassCalledWithoutNew,
        /// Names the constructor.
        ConstructorCalledWithoutNew,
        /// Names the class.
        DerivedConstructorResult,
        /// Names the first property of the pattern.
        DestructureNullish,
    }

    /// Why a generator left its frame.
    SuspendKind {
        /// Its parameters are bound and its body has not begun.
        Start,
        /// The driver of an async generator awaits the value before it delivers it.
        Yield,
        /// `yield*`. A generator hands the result object of the inner iterator on as it is; an async generator
        /// delivers the value without awaiting it.
        Delegate,
        Await,
    }

    /// How control leaves the code that holds an iterator open.
    CloseMode {
        Normal,
        /// An exception is under way: what `return` does or throws is dropped.
        Throw,
    }

    ImportPhase {
        Evaluation,
        Defer,
    }

    DebugHook {
        WillExecuteProgram,
        DidExecuteProgram,
        DidEnterCallFrame,
        DidReachDebuggerStatement,
        WillLeaveCallFrame,
        WillExecuteStatement,
        WillExecuteExpression,
        WillAwait,
        DidAwait,
        WillYield,
        DidYield,
        DidReturnFromTailCall,
    }

    /// The storage that the elements known at generation fit in.
    ArrayShape {
        Undecided,
        Int32,
        Double,
        Contiguous,
    }
}

/// The values of the mode of a resumption.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ResumeMode {
    Normal,
    Return,
    Throw,
}

impl StaticError {
    pub const fn kind(self) -> ErrorKind {
        match self {
            StaticError::AssignToCall
            | StaticError::PrefixIncrementOfCall
            | StaticError::PrefixDecrementOfCall
            | StaticError::PostfixIncrementOfCall
            | StaticError::PostfixDecrementOfCall
            | StaticError::ForInTargetIsCall
            | StaticError::ForOfTargetIsCall
            | StaticError::DeleteSuperProperty => ErrorKind::ReferenceError,
            _ => ErrorKind::TypeError,
        }
    }

    /// The text when there is no name to put in it.
    pub const fn message(self) -> &'static str {
        match self {
            StaticError::AssignToConstant => "Attempted to assign to readonly property.",
            StaticError::AssignToCall => "Left side of assignment is not a reference.",
            StaticError::PrefixIncrementOfCall => {
                "Prefix ++ operator applied to value that is not a reference."
            }
            StaticError::PrefixDecrementOfCall => {
                "Prefix -- operator applied to value that is not a reference."
            }
            StaticError::PostfixIncrementOfCall => {
                "Postfix ++ operator applied to value that is not a reference."
            }
            StaticError::PostfixDecrementOfCall => {
                "Postfix -- operator applied to value that is not a reference."
            }
            StaticError::ForInTargetIsCall => "Left side of for-in statement is not a reference.",
            StaticError::ForOfTargetIsCall => "Left side of for-of statement is not a reference.",
            StaticError::DeleteSuperProperty => "Cannot delete a super property",
            StaticError::PropertyOfNullish => "Cannot access property of undefined or null",
            StaticError::IteratorResultNotObject => "Iterator result interface is not an object.",
            StaticError::DelegateHasNoThrow => {
                "The iterator, to which yield* delegated iteration, does not have a 'throw' method."
            }
            StaticError::StaticFieldNamedPrototype => {
                "Cannot declare a static field named 'prototype'"
            }
            StaticError::StaticBrandMismatch => "Cannot access static private method or accessor",
            StaticError::StaticBrandOfNonObject => {
                "Cannot access static private method or accessor of a non-Object"
            }
            StaticError::NoPrivateGetter => "Trying to access an undefined private getter",
            StaticError::NoPrivateSetter => "Trying to access an undefined private setter",
            StaticError::ClassCalledWithoutNew => "Cannot call a class constructor without |new|",
            StaticError::ConstructorCalledWithoutNew => "Cannot call a constructor without |new|",
            StaticError::DerivedConstructorResult => {
                "Cannot return a non-object type in the constructor of a derived class."
            }
            StaticError::DestructureNullish => "Cannot destructure null or undefined value",
        }
    }

    /// What goes before and after a name that is not empty.
    pub const fn message_around_name(self) -> Option<(&'static str, &'static str)> {
        match self {
            StaticError::ClassCalledWithoutNew => {
                Some(("Cannot call a class constructor ", " without |new|"))
            }
            StaticError::ConstructorCalledWithoutNew => {
                Some(("Cannot call a constructor ", " without |new|"))
            }
            StaticError::DerivedConstructorResult => Some((
                "Cannot return a non-object type in the constructor of a derived class ",
                ".",
            )),
            StaticError::DestructureNullish => Some((
                "Cannot destructure property '",
                "' from null or undefined value",
            )),
            _ => None,
        }
    }
}

macro_rules! flag_sets {
    ($($name:ident { $($(#[doc = $doc:literal])* $flag:ident = $bit:literal,)* })*) => {$(
        bitflags::bitflags! {
            #[derive(Clone, Copy, PartialEq, Eq, Debug)]
            pub struct $name: u8 {
                $($(#[doc = $doc])* const $flag = 1 << $bit;)*
            }
        }

        impl Field for $name {
            #[inline(always)]
            fn read<W: Width>(bytes: impl Bytes, index: usize) -> $name {
                $name::from_bits_retain(W::unsigned(bytes, index) as u8)
            }

            #[inline(always)]
            fn word(self) -> u32 {
                u32::from(self.bits())
            }
        }
    )*};
}

flag_sets! {
    PutFlags {
        STRICT = 0,
        /// CreateDataProperty in place of Set.
        DIRECT = 1,
    }

    DefineFlags {
        ENUMERABLE = 0,
        /// The key was computed: it names the functions.
        SET_NAME = 1,
        HAS_GETTER = 2,
        HAS_SETTER = 3,
    }
}

/// The type byte of a cell. The generator names these; a built-in gets the others from [`crate::Host`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CellType(pub u8);

impl CellType {
    pub const STRING: CellType = CellType(2);
    pub const BIGINT: CellType = CellType(3);
    pub const SYMBOL: CellType = CellType(4);
}

impl Field for CellType {
    #[inline(always)]
    fn read<W: Width>(bytes: impl Bytes, index: usize) -> CellType {
        CellType(W::unsigned(bytes, index) as u8)
    }

    #[inline(always)]
    fn word(self) -> u32 {
        u32::from(self.0)
    }
}

impl core::fmt::Debug for Register {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match *self {
            Register::CALLEE => formatter.write_str("callee"),
            Register::THIS => formatter.write_str("this"),
            Register(offset @ ..0) => write!(formatter, "loc{}", -1 - offset),
            Register(offset @ 6..) => write!(formatter, "arg{}", offset - 6),
            Register(offset) => write!(formatter, "head{offset}"),
        }
    }
}

impl core::fmt::Debug for Operand {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self.as_constant() {
            Some(index) => write!(formatter, "k{index}"),
            None => Register(self.0).fmt(formatter),
        }
    }
}
