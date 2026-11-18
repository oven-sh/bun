/// The coarse type in the header of a cell. An embedder has the numbers from `FIRST_EMBEDDER_TYPE`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(transparent)]
pub struct CellType(pub u8);

macro_rules! cell_types {
    ($($name:ident = $number:literal,)*) => {
        #[allow(non_upper_case_globals)]
        impl CellType {
            $(pub const $name: CellType = CellType($number);)*
        }
    };
}

cell_types! {
    Cell = 0,
    Shape = 1,
    String = 2,
    BigInt = 3,
    Symbol = 4,
    GetterSetter = 5,
    CustomGetterSetter = 6,
    FunctionRareData = 7,
    NativeExecutable = 8,
    ProgramExecutable = 9,
    ModuleExecutable = 10,
    EvalExecutable = 11,
    FunctionExecutable = 12,
    Environment = 13,
    ModuleEnvironment = 14,
    WithScope = 15,
    ScopeTemplate = 16,
    PropertyNameEnumerator = 17,
    CodeBlock = 18,
    ImmutableArray = 19,
    SourceCode = 20,
    SlimPromiseReaction = 21,
    FullPromiseReaction = 22,
    SparseElements = 23,
    OrderedHashTable = 24,
    Exception = 25,
    TemplateDescriptor = 26,
    ModuleRegistryEntry = 27,
    ModuleLoader = 31,
    Sentinel = 32,
    RegExp = 33,
    Object = 34,
    FinalObject = 35,
    Callee = 36,
    Function = 37,
    InternalFunction = 39,
    BooleanObject = 41,
    NumberObject = 42,
    ErrorInstance = 43,
    GlobalProxy = 44,
    DirectArguments = 45,
    ScopedArguments = 46,
    ClonedArguments = 47,
    Array = 48,
    DerivedArray = 49,
    ArrayBuffer = 50,
    Int8Array = 51,
    Uint8Array = 52,
    Uint8ClampedArray = 53,
    Int16Array = 54,
    Uint16Array = 55,
    Int32Array = 56,
    Uint32Array = 57,
    Float16Array = 58,
    Float32Array = 59,
    Float64Array = 60,
    BigInt64Array = 61,
    BigUint64Array = 62,
    DataView = 63,
    GlobalObject = 64,
    AsyncDisposableStack = 70,
    DisposableStack = 71,
    ModuleNamespaceObject = 72,
    ShadowRealm = 73,
    RegExpObject = 74,
    Date = 75,
    Proxy = 76,
    Generator = 77,
    AsyncFunctionGenerator = 78,
    AsyncGenerator = 79,
    ArrayIterator = 80,
    Iterator = 81,
    IteratorHelper = 82,
    MapIterator = 83,
    SetIterator = 84,
    StringIterator = 85,
    WrapForValidIterator = 86,
    RegExpStringIterator = 87,
    AsyncFromSyncIterator = 88,
    Promise = 89,
    Map = 90,
    Set = 91,
    WeakMap = 92,
    WeakSet = 93,
    WasmModule = 94,
    WasmInstance = 95,
    WasmGcObject = 96,
    StringObject = 100,
    DerivedStringObject = 101,
    InternalFieldTuple = 102,
    EmbedderArrayLike = 0b1110_1101,
}

impl CellType {
    pub const FIRST_EMBEDDER_TYPE: CellType = CellType(0b1110_0000);
    pub const LAST: CellType = CellType(u8::MAX);
    pub const OBJECTS: CellTypeRange = CellTypeRange::new(Self::Object, Self::LAST);
    pub const ARRAYS: CellTypeRange = CellTypeRange::new(Self::Array, Self::DerivedArray);
    pub const TYPED_ARRAYS: CellTypeRange =
        CellTypeRange::new(Self::Int8Array, Self::BigUint64Array);
    pub const BUFFER_VIEWS: CellTypeRange = CellTypeRange::new(Self::Int8Array, Self::DataView);
    /// Have an executable at the same offset.
    pub const FUNCTIONS: CellTypeRange = CellTypeRange::new(Self::Function, Self::InternalFunction);
    pub const ARGUMENTS: CellTypeRange =
        CellTypeRange::new(Self::DirectArguments, Self::ClonedArguments);

    #[inline(always)]
    pub const fn is_object(self) -> bool {
        self.0 >= Self::Object.0
    }

    /// An object that has none has something else in that word, so it keeps its shape, which has no properties.
    #[inline(always)]
    pub const fn has_storage(self) -> bool {
        self.0 != Self::WasmGcObject.0
    }
}

/// Both ends are in it.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct CellTypeRange {
    pub first: CellType,
    pub last: CellType,
}

impl CellTypeRange {
    pub const NONE: CellTypeRange = CellTypeRange::new(CellType(1), CellType(0));

    pub const fn new(first: CellType, last: CellType) -> CellTypeRange {
        CellTypeRange { first, last }
    }

    #[inline(always)]
    pub const fn contains(self, cell_type: CellType) -> bool {
        self.first.0 <= cell_type.0 && cell_type.0 <= self.last.0
    }
}

bitflags::bitflags! {
    /// What the instances of a class do differently from ordinary objects. Each cell has a copy of the low byte.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct TypeFlags: u32 {
        const MASQUERADES_AS_UNDEFINED = 1 << 0;
        const IMPLEMENTS_DEFAULT_HAS_INSTANCE = 1 << 1;
        const OVERRIDES_CALL_DATA = 1 << 2;
        const OVERRIDES_GET_OWN_PROPERTY_SLOT = 1 << 3;
        const OVERRIDES_GET_PROTOTYPE = 1 << 4;
        const HAS_STATIC_PROPERTY_TABLE = 1 << 5;
        /// Belongs to the cell: there are unused words in front of its storage.
        const HAS_PRE_CAPACITY = 1 << 6;
        /// Belongs to the cell, not to its shape. What it means is up to the class.
        const PER_CELL_BIT = 1 << 7;
        const IMPLEMENTS_HAS_INSTANCE = 1 << 8;
        const OVERRIDES_OWN_PROPERTY_NAMES = 1 << 9;
        const OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES = 1 << 10;
        const PROHIBITS_PROPERTY_CACHING = 1 << 11;
        const GET_OWN_PROPERTY_SLOT_IS_IMPURE = 1 << 12;
        const NEW_IMPURE_PROPERTY_FIRES_WATCHPOINTS = 1 << 13;
        const IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT = 1 << 14;
        const GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE = 1 << 15;
        const INTERCEPTS_INDEXED_ACCESS = 1 << 16;
        const SHAPE_IS_IMMORTAL = 1 << 17;
        const OVERRIDES_PUT = 1 << 18;
        const GET_OWN_PROPERTY_SLOT_MAY_BE_WRONG_ABOUT_DONT_ENUM = 1 << 20;
        const OVERRIDES_IS_EXTENSIBLE = 1 << 21;
    }
}
