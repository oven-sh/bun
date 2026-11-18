//! The instructions that know of JavaScript. They share a function with those of the back end.
//!
//! Operands and results are tagged values unless an entry says otherwise. A check gives its first operand back, and
//! what is valid only after the check uses that result. A node that may exit has the state to go on from, and one that
//! may throw has what `Graph::state_for_unwinding` says.
//!
//! A node that writes nothing is replaced by an earlier one with the same operands and data unless it is `DISTINCT`, and
//! moves out of loops unless it is `CONTROL_DEPENDENT`.

use bun_engine_codegen::ir::{EffectFlags, Effects, Heap, NodeInfo, NodeKind, Type};
use bun_engine_vm::SpeculatedType as T;

use super::FormCall;
use super::heaps::*;

#[derive(Clone, Copy)]
struct Does {
    effects: Effects,
    collects: bool,
    throws: bool,
}

const NOTHING: Does = Does {
    effects: Effects::NONE,
    collects: false,
    throws: false,
};
const EXIT: Does = NOTHING.and(EffectFlags::EXITS);
/// Runs scripts.
const ANYTHING: Does = Does {
    effects: Effects {
        reads: WORLD,
        writes: WORLD,
        ..Effects::CALL
    },
    collects: true,
    throws: true,
};
/// Puts the characters of ropes together, for which there may be no memory.
const READ_TEXT: Does = NOTHING.writing(STRING_FIBER).throwing();
/// Looks at a value in a way that is valid only for what the operand is known to be.
const INSPECT: Does = NOTHING.and(EffectFlags::CONTROL_DEPENDENT);
/// Two allocations are not the same, and one that is not used is not needed.
const ALLOCATE: Does = NOTHING.and(EffectFlags::DISTINCT).collecting();

const LEAF: Does = NOTHING.reading(STRING_FIBER).anywhere();
const ATTEMPT: Does = EXIT.reading(WORLD).collecting();

impl Does {
    const fn and(mut self, flags: EffectFlags) -> Self {
        self.effects.flags = self.effects.flags.union(flags);
        self
    }

    const fn reading(mut self, heap: Heap) -> Self {
        self.effects.reads = heap;
        self.and(EffectFlags::CONTROL_DEPENDENT)
    }

    /// Relies on nothing but what its operands have been checked for.
    const fn anywhere(mut self) -> Self {
        self.effects.flags = (self.effects.flags).difference(EffectFlags::CONTROL_DEPENDENT);
        self
    }

    const fn writing(mut self, heap: Heap) -> Self {
        self.effects.writes = heap;
        self.and(EffectFlags::CONTROL_DEPENDENT)
    }

    /// Others count on where that happens.
    const fn collecting(self) -> Self {
        Self {
            collects: true,
            ..self.and(EffectFlags::CONTROL_DEPENDENT)
        }
    }

    const fn throwing(self) -> Self {
        Self {
            throws: true,
            ..self.and(EffectFlags::EXITS).collecting()
        }
    }

    const fn on_frame(self) -> Self {
        self.reading(Heap::EVERYTHING).writing(Heap::EVERYTHING)
    }

    const fn ending(self) -> Self {
        self.and(EffectFlags::ENDS_BLOCK)
    }
}

/// What a node gives.
#[derive(Clone, Copy)]
pub(crate) enum Gives {
    Nothing,
    /// A tagged value of this type.
    Value(T),
    /// The first operand.
    Operand,
    Int32,
    Boolean,
    Int52,
    Double,
    /// An I64 that is no value of the language.
    Word,
    Tuple(&'static [Type]),
}

impl Gives {
    pub(crate) const fn machine_type(self) -> Type {
        match self {
            Self::Nothing => Type::Void,
            Self::Value(_) | Self::Operand | Self::Int52 | Self::Word => Type::I64,
            Self::Int32 | Self::Boolean => Type::I32,
            Self::Double => Type::F64,
            Self::Tuple(_) => Type::Tuple,
        }
    }
}

const TOP: Gives = Gives::Value(T::HEAP_TOP);
const NUMBER: Gives = Gives::Value(T::BOXED_NUMBER);
const STRING: Gives = Gives::Value(T::STRING);
const OBJECT: Gives = Gives::Value(T::OBJECT);
const FLAT_STRING: Gives = Gives::Value(T::STRING.difference(T::ROPE_STRING));
const ATOM: Gives = Gives::Value(T::ATOM_STRING);
const SUM: Gives = Gives::Value(T::BOXED_NUMBER.union(T::STRING).union(T::BIGINT));
const PRIMITIVE: Gives = Gives::Value(T::HEAP_TOP.difference(T::OBJECT));

macro_rules! nodes {
    ($($(#[$meta:meta])* $name:ident: $gives:expr, $does:expr;)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u16)]
        pub(crate) enum Kind {
            $($(#[$meta])* $name,)*
        }

        const ALL: &[Kind] = &[$(Kind::$name,)*];
        const GIVES: &[Gives] = { use Gives::*; &[$($gives,)*] };
        const DOES: &[Does] = &[$($does,)*];
        pub(crate) static INFO: &[NodeInfo] = &[$(NodeInfo {
            name: stringify!($name),
            effects: DOES[Kind::$name as usize].effects,
            elements: if let Gives::Tuple(elements) = GIVES[Kind::$name as usize] { elements } else { &[] },
        },)*];
    };
}

const _: () = {
    let mut kind = 0;
    while kind < DOES.len() {
        let flags = DOES[kind].effects.flags;
        assert!(!DOES[kind].collects || flags.contains(EffectFlags::CONTROL_DEPENDENT));
        kind += 1;
    }
};

impl Kind {
    #[inline]
    pub(crate) fn of(kind: NodeKind) -> Self {
        ALL[usize::from(kind.0)]
    }

    #[inline]
    pub(crate) fn id(self) -> NodeKind {
        NodeKind(self as u16)
    }

    #[inline]
    pub(crate) fn gives(self) -> Gives {
        GIVES[self as usize]
    }

    #[inline]
    pub(crate) fn gives_operand(self) -> bool {
        matches!(self.gives(), Gives::Operand)
    }

    /// Does more than compute and check.
    #[inline]
    pub(crate) fn has_effects(self) -> bool {
        !self.effects().at_most_exits()
    }

    /// To go on in a lower tier.
    #[inline]
    pub(crate) fn can_exit(self) -> bool {
        self.effects().has(EffectFlags::EXITS) && !self.can_throw()
    }

    /// Once it is specialized.
    pub(crate) fn may_come_to_throw(self) -> bool {
        matches!(
            self,
            Self::Compare | Self::LooseEqual | Self::StrictEqual | Self::ToString
        )
    }

    pub(crate) fn allocates(self) -> bool {
        matches!(
            self,
            Self::NewObject
                | Self::NewScope
                | Self::NewFunction
                | Self::NewInstance
                | Self::NewArray
                | Self::NewArrayOfHoles
                | Self::NewArrayFromFrame
                | Self::CopyElements
                | Self::ShareList
                | Self::NewTypedArray
                | Self::NewArguments
                | Self::NewArgumentsFromFrame
        )
    }

    pub(crate) fn has_arithmetic_data(self) -> bool {
        self == Self::UInt32ToNumber
            || (Self::NumberAdd as u16..=Self::NumberRound as u16).contains(&(self as u16))
    }

    /// With the data, where that picks a function.
    pub(crate) fn described(self, data: u32) -> String {
        match self {
            Self::MathFunction | Self::Compare | Self::PrimitiveCompare => {
                format!("{self:?}{data}")
            }
            _ if self.calls_form() => format!("{self:?} {:?}", FormCall::from_data(data).form),
            _ => format!("{self:?}"),
        }
    }

    /// To the scripts that it runs, or in the trace of an error that is not for lack of memory.
    pub(crate) fn shows_stack(self) -> bool {
        self.can_throw() && [WORLD, Heap::EVERYTHING].contains(&self.effects().writes)
            || matches!(
                self,
                Self::ToObject | Self::BigIntOperator | Self::PrimitiveOperator
            )
    }

    #[inline]
    pub(crate) fn effects(self) -> Effects {
        DOES[self as usize].effects
    }

    #[inline]
    pub(crate) fn can_collect(self) -> bool {
        DOES[self as usize].collects
    }

    #[inline]
    pub(crate) fn can_throw(self) -> bool {
        DOES[self as usize].throws
    }
}

nodes! {
    // Places

    /// The first instruction of a block with parameters. Its state is valid on the edges to the block, with their
    /// arguments for the parameters.
    Checkpoint: Nothing, NOTHING.and(EffectFlags::KEPT);
    /// The start of a function that is inlined. Its state has what those who walk the stack ask for.
    InlineEntry: Nothing, NOTHING.and(EffectFlags::KEPT);
    /// Where the code is left once an assumption has failed.
    InvalidationPoint: Nothing, EXIT.writing(SIDE_STATE);
    /// The data is an `ExitKind`.
    ForceExit: Nothing, EXIT.ending();
    PollTraps: Nothing, EXIT.writing(SIDE_STATE);
    TierUpInLoop: Nothing, EXIT.writing(SIDE_STATE).collecting();
    /// Of a loop that is inlined. It is for others to see that the counter has run out.
    CountTurn: Nothing, NOTHING.writing(SIDE_STATE);
    TierUpAtReturn: Nothing, NOTHING.writing(SIDE_STATE).collecting();
    /// The collector finds the operand on the stack up to here.
    KeepAlive: Nothing, NOTHING.and(EffectFlags::KEPT);
    /// The data is a position in `Graph::claims`.
    Verify: Nothing, NOTHING.reading(Heap::EVERYTHING).and(EffectFlags::KEPT);
    /// The operand, below a branch that tells something about it. The data is a `TypeCheck`, which need not be all.
    Refine: Operand, INSPECT.and(EffectFlags::DISTINCT);
    /// The same, where it follows from what the code is and not from a test.
    Assume: Operand, INSPECT.and(EffectFlags::DISTINCT);
    /// Below a branch on the shape. The data is a `ShapeSet`.
    RefineShape: Operand, INSPECT.and(EffectFlags::DISTINCT);
    /// Stands for a check that is left to such a branch, until its users are specialized. The data is a `TypeCheck`.
    Unproven: Operand, INSPECT.and(EffectFlags::DISTINCT);
    /// Follows the stores of the other operands, if it has any, into the first.
    StoreBarrier: Nothing, NOTHING.writing(SIDE_STATE);

    // Representations

    BoxInt32: Value(T::INT32), NOTHING;
    BoxInt52: NUMBER, NOTHING;
    BoxDouble: Value(T::BOXED_DOUBLE), NOTHING;
    BoxBoolean: Value(T::BOOLEAN), NOTHING;
    /// Of an I32 taken as unsigned. The data says whether it has been seen to need a double.
    UInt32ToNumber: NUMBER, EXIT;
    AsInt32: Int32, EXIT;
    AsInt52: Int52, EXIT;
    AsBoolean: Boolean, EXIT;
    /// Of a number.
    AsDouble: Double, EXIT;
    /// ToInt32 of a number, a boolean, undefined or null.
    Truncate: Int32, EXIT;
    /// Of an operand that is known to be a number. The data is whether it is expected to be an int32.
    NumberToDouble: Double, NOTHING;
    /// Of a number, a boolean, undefined or null.
    PrimitiveToDouble: Double, NOTHING;
    /// ToInt32 of an F64.
    TruncateDouble: Int32, NOTHING;
    /// Of an F64 that has to be an integer other than −0. The data is an `ExitKind`.
    DoubleAsInt32: Int32, EXIT;
    DoubleAsInt52: Int52, EXIT;

    // Checks

    /// The data is a `TypeCheck`.
    CheckType: Operand, EXIT;
    /// Of a cell. The data is a `ShapeSet`.
    CheckShape: Operand, EXIT.reading(SHAPE).anywhere();
    /// Of a cell. The data is a `ModeCheck`.
    CheckModes: Operand, EXIT.reading(INDEXING_MODE).anywhere();
    /// The second operand is a constant with the same bits.
    CheckIdentical: Operand, EXIT;
    /// Of a function. The second operand is the executable.
    CheckExecutable: Operand, EXIT.reading(FUNCTION_TARGET).anywhere();
    /// Gives the first I32, which is below the second. What is at that index is loaded by way of the result.
    CheckBounds: Int32, EXIT;
    /// The same, where a branch has seen to that.
    InBounds: Int32, INSPECT.and(EffectFlags::DISTINCT);

    // Operators on numbers. What is no number exits. The data is an `ArithmeticData`.

    NumberAdd: NUMBER, EXIT;
    NumberSubtract: NUMBER, EXIT;
    NumberMultiply: NUMBER, EXIT;
    NumberDivide: NUMBER, EXIT;
    NumberRemainder: NUMBER, EXIT;
    NumberNegate: NUMBER, EXIT;
    NumberToNumber: NUMBER, EXIT;
    NumberPower: NUMBER, EXIT;
    NumberAbs: NUMBER, EXIT;
    NumberMin: NUMBER, EXIT;
    NumberMax: NUMBER, EXIT;
    NumberFloor: NUMBER, EXIT;
    NumberCeil: NUMBER, EXIT;
    NumberTrunc: NUMBER, EXIT;
    NumberRound: NUMBER, EXIT;
    /// Of two F64.
    DoubleRemainder: Double, NOTHING;
    DoublePower: Double, NOTHING;
    /// Of an F64. The data is from `math_function_for`.
    MathFunction: Double, NOTHING;

    // Operators on what converts without running scripts. Anything else exits.

    /// Of a number, a boolean, undefined or null. The data is a `TypeCheck` that wants what has been seen.
    QuietToNumber: NUMBER, EXIT;
    /// The data is a `Relation`.
    Compare: Boolean, EXIT.writing(STRING_FIBER).collecting();
    LooseEqual: Boolean, EXIT.writing(STRING_FIBER).collecting();
    StrictEqual: Boolean, EXIT.writing(STRING_FIBER).collecting();
    ToBoolean: Boolean, EXIT;
    EqualNull: Boolean, EXIT;
    /// Of what is no object. The data is a `TypeCheck` that wants what has been seen.
    ToString: STRING, EXIT.collecting();
    /// The data is a `TypeCheck`.
    IsType: Boolean, NOTHING;
    IsCellOfType: Boolean, NOTHING;
    /// The data of these four is a `TypeCheck` that wants what is expected. All but the first count on no object posing
    /// as undefined.
    IsCallable: Boolean, INSPECT;
    HasObjectTypeName: Boolean, INSPECT;
    PlainToBoolean: Boolean, INSPECT;
    PlainTypeof: ATOM, INSPECT;
    IsConstructor: Boolean, INSPECT;
    GenericEqualNull: Boolean, INSPECT;
    GenericToBoolean: Boolean, INSPECT;
    GenericTypeof: ATOM, INSPECT;
    /// What specialization leaves of the comparisons where it takes more than an instruction.
    StringEqual: Boolean, READ_TEXT;
    AtomEqual: Boolean, NOTHING.reading(STRING_FIBER).anywhere();
    /// Of anything and a constant that is an atom. The data is a `TypeCheck` that wants what is expected.
    EqualsAtom: Boolean, READ_TEXT;
    /// 0, 1 or 2 for less, equal and greater.
    StringOrder: Int32, READ_TEXT;
    /// Of a string and that of one code unit, which is an I32. The data is a `Relation`.
    CompareWithUnit: Boolean, READ_TEXT;
    /// The data is a `Relation` and `InLine`.
    PrimitiveCompare: Boolean, READ_TEXT;
    /// The data is `InLine`.
    QuietLooseEqual: Boolean, READ_TEXT;
    /// The data is from `TypeChecks::pair`, and each wants what is expected.
    GenericStrictEqual: Boolean, READ_TEXT;
    /// Negative, zero or positive.
    BigIntOrder: Int32, INSPECT;
    /// Of an I32.
    Int32ToString: FLAT_STRING, NOTHING.collecting();
    /// Of an F64.
    DoubleToString: FLAT_STRING, NOTHING.collecting();
    /// The data is a `TypeCheck` that wants what is expected.
    PrimitiveToString: STRING, INSPECT.throwing();
    /// The data of these is an `Operator`, and for all but the first `InLine`.
    BigIntOperator: Value(T::BIGINT), INSPECT.throwing();
    PrimitiveOperator: SUM, READ_TEXT;
    /// The code unit of a string that has just one, or −1. The data of these three is a `TypeCheck` that wants what is
    /// expected.
    OnlyUnit: Int32, READ_TEXT;
    /// The address of the atom with the characters of a string, or what is no address.
    ExistingAtom: Word, READ_TEXT;
    /// The integer that a number is, or what no I32 is.
    ExactInt32: Word, INSPECT;

    // Operators on anything

    GenericOperator: SUM, ANYTHING;
    GenericCompare: Boolean, ANYTHING;
    GenericLooseEqual: Boolean, ANYTHING;
    /// The data is a `Conversion`.
    Convert: PRIMITIVE, ANYTHING;
    /// The second operand is the address of the name that is the message of the error.
    ToObject: OBJECT, ALLOCATE.and(EffectFlags::CONTROL_DEPENDENT).throwing();
    /// The second operand is the `this` of the realm.
    ToThis: OBJECT, ALLOCATE.and(EffectFlags::CONTROL_DEPENDENT);

    // Objects

    /// Of a cell.
    LoadShapeId: Int32, NOTHING.reading(SHAPE).anywhere();
    /// The data is a position in `Graph::transitions`.
    SetShape: Nothing, NOTHING.writing(SHAPE);
    /// Moves the slots to a storage with room for those of the new shape, and marks the old shape as no longer
    /// describing the object. `SetShape` follows. Gives the storage.
    GrowSlots: Word, NOTHING.writing(LAYOUT).collecting();
    /// The data of these is a position in `Graph::allocations`. The slots are empty.
    NewObject: Value(T::FINAL_OBJECT), ALLOCATE;
    /// Parent and template. Stores that follow initialize the slots.
    NewScope: Value(T::OTHER_CELL), ALLOCATE;
    /// Scope and executable.
    NewFunction: Value(T::FUNCTION), ALLOCATE;
    /// Of a class of the engine. Stores that follow initialize what comes after the storage, of which there is none.
    NewInstance: OBJECT, ALLOCATE;
    /// For any `new.target`. The data is the number of slots that is likely to be needed.
    CreateThis: OBJECT, ANYTHING;
    /// Of an object. These two exit where it is not for the shapes to say.
    LoadPrototype: Value(T::OBJECT.union(T::NULL)), EXIT.reading(SHAPE);
    /// Whether the second object is on the prototype chain of the first.
    InheritsFrom: Boolean, EXIT.reading(SHAPE);
    GenericGetPrototypeOf: Value(T::OBJECT.union(T::NULL)), ANYTHING;
    /// Constructor, value and method.
    CustomHasInstance: Boolean, ANYTHING;
    /// Of a cell. The data has `TypeFlags` that are the same for as long as it lives.
    HasTypeFlag: Boolean, INSPECT;
    /// Of a cell, as a word.
    LoadShape: Word, NOTHING.reading(SHAPE);
    /// The `ImmutableArray` of own keys that the shape of an object keeps, or zero. The data is its offset.
    KeptNames: Word, NOTHING.reading(SHAPE);

    /// The data is a position in `Graph::cached_accesses`.
    Cached: TOP, ANYTHING;
    /// Of an object. The data of these is a position in `Graph::searches`.
    SearchAndLoad: TOP, EXIT.reading(OBJECTS);
    /// Object and value. Gives the address of the slot, which it adds if need be. The store follows, and then a barrier
    /// and `MayHaveFired`.
    SearchForStore: Word, EXIT.writing(LAYOUT).collecting();
    MayHaveFired: Nothing, NOTHING.writing(WATCHPOINT_STATES);
    /// Of a function, as a cell that is no value.
    LoadExecutable: Word, NOTHING.reading(FUNCTION_TARGET).anywhere();

    // Elements

    /// The data of these is as for `NewObject`. The first and the third need not be arrays. Stores that follow
    /// initialize the slots, and those of the elements that the `Vector` says.
    NewArray: OBJECT, ALLOCATE;
    /// I32 length, which is not one for sparse elements, and the shape.
    NewArrayOfHoles: Value(T::ARRAY), ALLOCATE.throwing();
    /// The address of the first value and their number, an I32.
    NewArrayFromFrame: OBJECT, ALLOCATE.reading(FRAME).throwing();
    /// The same, and the object that has them in its storage.
    CopyElements: Value(T::ARRAY), ALLOCATE.reading(ELEMENTS).throwing();
    /// An array that has its elements in an `ImmutableArray`.
    ShareList: Value(T::ARRAY), ALLOCATE;
    /// I32 length and shape.
    NewTypedArray: Value(T::TYPED_ARRAY), ALLOCATE.throwing();
    /// `MappedArguments`. Stores that follow initialize all of it.
    NewArguments: OBJECT, ALLOCATE;
    /// All but the slots. The operands are as for `NewArrayFromFrame`.
    NewArgumentsFromFrame: OBJECT, ALLOCATE.reading(FRAME).throwing();
    /// An `ImmutableArray` of the operands.
    NewList: Value(T::OTHER_CELL), ALLOCATE;
    Spread: Value(T::OTHER_CELL), ANYTHING;
    /// Exits where a script would have to run.
    SpreadElements: Value(T::OTHER_CELL), EXIT.reading(WORLD).collecting().and(EffectFlags::DISTINCT);
    /// Elements and lists.
    NewArrayWithSpread: Value(T::ARRAY), ALLOCATE.throwing();
    /// Gives the address of a copy of the operands.
    CopyToMemory: Word, NOTHING;
    /// Of a cell. The second operand is the realm whose arrays start out with the shape.
    CheckOriginalArray: Operand, EXIT.reading(SHAPE).anywhere();
    /// ArraySpeciesCreate comes down to ArrayCreate.
    CheckSpeciesIsArray: Nothing, EXIT.reading(WORLD);
    /// Object, storage and I32 index, which may be past the vector. Gives the storage that has it.
    MakeRoom: Word, EXIT.writing(ROOM).collecting();
    /// Of a cell. The data is a `ModeCheck`.
    HasModes: Boolean, NOTHING.reading(INDEXING_MODE).anywhere();
    /// Object and I32 key. These exit where a script would have to run.
    LookUpElement: TOP, EXIT.reading(WORLD).writing(SIDE_STATE);
    HasElement: Value(T::BOOLEAN), EXIT.reading(WORLD).writing(SIDE_STATE);
    /// Object and the address of a name.
    LookUpName: TOP, EXIT.reading(OBJECTS);
    /// Object, I32 key and value.
    StorePlainElement: Nothing, EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    /// Object and key. The data is the type that the key is certain to have.
    HasOwn: Boolean, EXIT.reading(WORLD).writing(STRING_FIBER).collecting();
    /// Methods of an array, under the same condition. Those that add a value give the new length.
    Push: Int32, EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    Unshift: Int32, EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    Pop: TOP, EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    Shift: TOP, EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    /// The elements are not shared.
    ShiftWritable: TOP, EXIT.writing(VECTORS).collecting();
    /// Array with dense elements that can be written to, storage and I32 length.
    SetLength: Nothing, EXIT.writing(VECTORS).collecting();
    /// The arguments that are positions are I32.
    Splice: Value(T::ARRAY), EXIT.writing(ELEMENTS_AND_SHAPES).collecting();
    /// Of any object.
    Slice: Value(T::ARRAY), EXIT.reading(WORLD).collecting().and(EffectFlags::DISTINCT);
    /// The data is a `Search`. Gives the index, or −1.
    FindElement: Int32, EXIT.reading(WORLD).writing(STRING_FIBER).collecting();
    /// Storage, start, end and the word to look for. Gives the index, or −1.
    FindWord: Int32, NOTHING.reading(VALUE_ELEMENTS);
    /// Of a symbol, or of a string that is no index. It is an atom afterwards. The data of these is the type of the key.
    AsName: Operand, EXIT.writing(STRING_FIBER).collecting();
    /// Of the address of a name.
    HashName: Int32, NOTHING;
    /// A string has the characters of the atom whose address is the second operand.
    CheckText: Nothing, EXIT.writing(STRING_FIBER).collecting();
    /// Of an I64 that is not negative.
    SizeAsInt32: Int32, EXIT;
    /// Of an F64 that has to be an integer.
    DoubleAsIndex: Int32, EXIT;
    /// ToNumber of a number, a boolean, undefined or null.
    ToDouble: Double, EXIT;
    /// ToUint8Clamp of the same. The low byte counts.
    Clamp: Int32, EXIT;
    /// ToInt32 of a number between the ends of an `IntegerRange`.
    TruncateInRange: Int32, EXIT;
    /// From the low 16 bits of an I32.
    HalfToDouble: Double, NOTHING;
    DoubleToHalf: Int32, NOTHING;
    /// An I64, an I32 that says whether it is negative, and the BigInt for zero. The data is as for `NewObject`.
    BigIntFromDigit: Value(T::BIGINT), ALLOCATE;
    /// Modulo 2^64.
    BigIntToBits: Word, NOTHING.and(EffectFlags::CONTROL_DEPENDENT);
    /// The same, of one that is in an `IntegerRange` of eight bytes.
    BigIntInRange: Word, EXIT.and(EffectFlags::CONTROL_DEPENDENT);
    /// Target, source, and the I64 offset and number of bytes. All of the source fits.
    CopyView: Nothing, NOTHING.reading(BACKING).writing(TYPED_ELEMENTS);
    /// Of a view on a buffer whose length can change. Afterwards the view knows it too.
    UpdateViewLength: Word, NOTHING.writing(VIEW_LENGTH);
    /// The same, but the view need not learn it. The data is the logarithm of the size of an element.
    CurrentViewLength: Word, NOTHING.writing(VIEW_LENGTH);
    CurrentViewOffset: Word, NOTHING.writing(VIEW_LENGTH);
    /// Of a string.
    StringLength: Int32, NOTHING;
    ResolveRope: Operand, NOTHING.writing(STRING_FIBER).throwing();
    /// Of a string that is no rope, at an I32 index that is in bounds.
    StringUnitAt: Int32, NOTHING.reading(STRING_FIBER).anywhere();
    StringCodePointAt: Int32, NOTHING.reading(STRING_FIBER).anywhere();
    /// From an I32 code unit.
    StringFromUnit: FLAT_STRING, NOTHING.collecting();
    /// Of two or three strings. The data has `Fibers` for each.
    Concatenate: STRING, INSPECT.throwing();

    // Maps and sets. What adds an entry exits if that would throw.

    NormalizeKey: TOP, NOTHING;
    /// Of what that gives. It is no rope afterwards.
    HashKey: Int32, EXIT.writing(STRING_FIBER).collecting();
    /// Of a string that is no rope.
    HashString: Int32, NOTHING.reading(STRING_FIBER).anywhere();
    /// Table, key and hash. The data says whether other bits can stand for the key. Gives the address, or zero.
    FindEntry: Word, NOTHING.reading(COLLECTIONS).anywhere();
    /// Collection, key, hash and, for a map, the value.
    MapSet: Nothing, EXIT.writing(COLLECTIONS).collecting();
    SetAdd: Nothing, EXIT.writing(COLLECTIONS).collecting();
    /// The data says whether it is from a map.
    RemoveEntry: Boolean, NOTHING.writing(COLLECTIONS).collecting();
    WeakMapGet: TOP, NOTHING.reading(WEAK_TABLES);
    HasWeakEntry: Boolean, NOTHING.reading(WEAK_TABLES);
    WeakMapSet: Nothing, EXIT.writing(WEAK_TABLES).collecting();
    WeakSetAdd: Nothing, EXIT.writing(WEAK_TABLES).collecting();

    // Iteration

    /// Of an array, at an I32 without a sign.
    GetIndex: TOP, ANYTHING;
    /// Of a string that is no rope, at an I32 index that is in bounds.
    CodePointString: FLAT_STRING, NOTHING.reading(STRING_FIBER).collecting();
    /// The parts of a cursor, the second an I32. Gives the table that has the next entry, or zero, and its number. The
    /// data is whether there are values.
    NextEntry: Tuple(&[Type::I64, Type::I64]), NOTHING.reading(COLLECTIONS);
    /// Of a typed array.
    CanIterateByIndex: Boolean, NOTHING.writing(VIEW_LENGTH);
    /// It is in bounds, and the I32 is not.
    CheckViewEndsAt: Nothing, EXIT.writing(VIEW_LENGTH);
    /// Whether an array has its `Symbol.iterator` from the prototype of the realm, which is the second operand.
    InheritsArrayIteration: Boolean, NOTHING.reading(OBJECTS);

    /// For `for`-`in` over what is neither undefined nor null.
    GetEnumerator: Value(T::OTHER_CELL), ANYTHING;
    /// The base, the enumerator, and the mode and the index in the upper and the lower half of an I64. Gives the next
    /// name, or undefined, and such an I64.
    NextName: Tuple(&[Type::I64, Type::I64]), ANYTHING;
    /// The same and the name.
    HasOwnName: Boolean, ANYTHING;

    // Code that suspends, and exceptions

    /// For the frame. The data is whether it is async.
    CreateGenerator: Value(T::OTHER_OBJECT), ANYTHING;
    /// The value, the generator, the id of the shape of plain promises, what has the async context, and `Awaiting`. The
    /// data is a `TypeCheck` that wants what is expected of the value.
    Await: Nothing, ANYTHING;
    /// The generator, which may be empty, and the value.
    AsyncReturn: Value(T::PROMISE), ANYTHING;
    AsyncThrow: Value(T::PROMISE), ANYTHING;
    /// The iterator, the coroutine that asks, and the value, which may be empty. Gives what to await.
    RequestStep: TOP, ANYTHING;
    /// The executable, the callee, the generator, the value and the mode.
    ResumeGenerator: TOP, ANYTHING;
    /// A value, or the record of an exception.
    Throw: Nothing, ANYTHING.ending();

    // Calls. The operands are the callee, `this` or `new.target`, and the arguments.

    Call: TOP, ANYTHING;
    Construct: TOP, ANYTHING;
    TailCall: Nothing, ANYTHING.ending();
    /// The executable comes first.
    DirectCall: TOP, ANYTHING;
    DirectConstruct: TOP, ANYTHING;
    DirectTailCall: Nothing, ANYTHING.ending();
    /// The address of the `NativeFunction` and its realm come first. Both are constants.
    NativeCall: TOP, ANYTHING;
    NativeConstruct: TOP, ANYTHING;
    NativeTailCall: Nothing, ANYTHING.ending();
    /// The data is a `Lists`.
    CallVarargs: TOP, ANYTHING.reading(Heap::EVERYTHING);
    ConstructVarargs: TOP, ANYTHING.reading(Heap::EVERYTHING);
    TailCallVarargs: Nothing, ANYTHING.reading(Heap::EVERYTHING).ending();
    ToArgumentList: TOP, ANYTHING;
    /// The operands are the arguments, in the types of the parameters. The data is a position in `Graph::wasm_calls`.
    CallWasm: Nothing, ANYTHING;
    CallWasmForInt32: Int32, ANYTHING;
    CallWasmForInt64: Word, ANYTHING;
    CallWasmForDouble: Double, ANYTHING;
    CallWasmForValue: TOP, ANYTHING;

    // Calls of forms of built-ins. The data is a `FormCall`, for which `Kind::calling` picks the kind. The operands are the
    // realm, if that is the context, and what is passed, with a string for its characters. They exit if it throws.

    LeafValue: TOP, LEAF;
    LeafInt32: Int32, LEAF;
    LeafDouble: Double, LEAF;
    ReadingLeafValue: TOP, NOTHING.reading(WORLD);
    ReadingLeafInt32: Int32, NOTHING.reading(WORLD);
    ReadingLeafDouble: Double, NOTHING.reading(WORLD);
    ChangeDate: Double, NOTHING.reading(WORLD).writing(DATES);
    ReadClock: Double, NOTHING.writing(SIDE_STATE);
    MakePrimitive: PRIMITIVE, NOTHING.collecting();
    MakeDistinct: TOP, ALLOCATE.reading(WORLD);
    TextValue: TOP, ATTEMPT.writing(STRING_FIBER);
    TextInt32: Int32, ATTEMPT.writing(STRING_FIBER);
    SearchValue: TOP, ATTEMPT.writing(SEARCH);
    SearchInt32: Int32, ATTEMPT.writing(SEARCH);
    ChangeAnything: TOP, ATTEMPT.writing(WORLD);
    /// The bits, or zero for an invalid date. The data is the offset of the field that keeps them.
    DateFields: Word, NOTHING.reading(DATES).anywhere();
    /// Date and time value, an F64.
    SetTime: Nothing, NOTHING.writing(DATES);
    /// Follows what does.
    MayHaveSetLastIndex: Nothing, NOTHING.writing(LAST_INDEX);

    // Calls of C functions, which have no frame that scripts can see. The address comes first, and is a constant.

    /// Realm, `this` and the address of the name.
    CallCustomGetter: TOP, ANYTHING;
    /// Realm, `this`, value and the address of the name.
    CallCustomSetter: Nothing, ANYTHING;
    /// Of a `NativeFunction` that is as `Intrinsic::Clock` says, with its realm.
    CallClock: NUMBER, NOTHING.writing(SIDE_STATE);
    /// The arguments are I64, F32 or F64. The data of these is a position in `Graph::signatures`. Only as many bits of
    /// the result count as its type has.
    CallForeign: Word, ANYTHING;
    CallForeignForFloat: Double, ANYTHING;
    /// Of an I64 that is a number if it is exact. The data is its `NativeType`.
    BoxForeignInteger: Value(T::BOXED_NUMBER.union(T::BIGINT).union(T::NULL)), NOTHING.collecting();

    // Instructions that the interpreter executes

    /// What stands in for the frame pointer.
    ShadowFrame: Word, NOTHING;
    /// The shadow frame and the address of the instruction. The data is the opcode. Gives an `Outcome`.
    Interpret: Tuple(&[Type::I64, Type::I64]), ANYTHING.on_frame();
}
