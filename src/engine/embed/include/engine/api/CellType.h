#pragma once

// What the header of a cell says.

#include "engine/api/Forward.h"

namespace JSC {

enum JSType : uint8_t {
    CellType = Engine::CellType::Cell,
    StructureType = Engine::CellType::Shape,
    StringType = Engine::CellType::String,
    HeapBigIntType = Engine::CellType::BigInt,
    SymbolType = Engine::CellType::Symbol,
    GetterSetterType = Engine::CellType::GetterSetter,
    CustomGetterSetterType = Engine::CellType::CustomGetterSetter,
    FunctionRareDataType = Engine::CellType::FunctionRareData,
    NativeExecutableType = Engine::CellType::NativeExecutable,
    ProgramExecutableType = Engine::CellType::ProgramExecutable,
    ModuleProgramExecutableType = Engine::CellType::ModuleExecutable,
    FunctionExecutableType = Engine::CellType::FunctionExecutable,
    LexicalEnvironmentType = Engine::CellType::Environment,
    ModuleEnvironmentType = Engine::CellType::ModuleEnvironment,
    CodeBlockType = Engine::CellType::CodeBlock,
    JSCellButterflyType = Engine::CellType::ImmutableArray,
    JSSourceCodeType = Engine::CellType::SourceCode,
    ExceptionType = Engine::CellType::Exception,
    ObjectType = Engine::CellType::Object,
    FinalObjectType = Engine::CellType::FinalObject,
    JSCalleeType = Engine::CellType::Callee,
    JSFunctionType = Engine::CellType::Function,
    InternalFunctionType = Engine::CellType::InternalFunction,
    BooleanObjectType = Engine::CellType::BooleanObject,
    NumberObjectType = Engine::CellType::NumberObject,
    ErrorInstanceType = Engine::CellType::ErrorInstance,
    GlobalProxyType = Engine::CellType::GlobalProxy,
    DirectArgumentsType = Engine::CellType::DirectArguments,
    ScopedArgumentsType = Engine::CellType::ScopedArguments,
    ClonedArgumentsType = Engine::CellType::ClonedArguments,
    ArrayType = Engine::CellType::Array,
    DerivedArrayType = Engine::CellType::DerivedArray,
    ArrayBufferType = Engine::CellType::ArrayBuffer,
    Int8ArrayType = Engine::CellType::Int8Array,
    Uint8ArrayType = Engine::CellType::Uint8Array,
    Uint8ClampedArrayType = Engine::CellType::Uint8ClampedArray,
    Int16ArrayType = Engine::CellType::Int16Array,
    Uint16ArrayType = Engine::CellType::Uint16Array,
    Int32ArrayType = Engine::CellType::Int32Array,
    Uint32ArrayType = Engine::CellType::Uint32Array,
    Float16ArrayType = Engine::CellType::Float16Array,
    Float32ArrayType = Engine::CellType::Float32Array,
    Float64ArrayType = Engine::CellType::Float64Array,
    BigInt64ArrayType = Engine::CellType::BigInt64Array,
    BigUint64ArrayType = Engine::CellType::BigUint64Array,
    DataViewType = Engine::CellType::DataView,
    GlobalObjectType = Engine::CellType::GlobalObject,
    ModuleNamespaceObjectType = Engine::CellType::ModuleNamespaceObject,
    RegExpObjectType = Engine::CellType::RegExpObject,
    JSDateType = Engine::CellType::Date,
    ProxyObjectType = Engine::CellType::Proxy,
    JSGeneratorType = Engine::CellType::Generator,
    JSAsyncGeneratorType = Engine::CellType::AsyncGenerator,
    JSArrayIteratorType = Engine::CellType::ArrayIterator,
    JSMapIteratorType = Engine::CellType::MapIterator,
    JSSetIteratorType = Engine::CellType::SetIterator,
    JSAsyncFromSyncIteratorType = Engine::CellType::AsyncFromSyncIterator,
    JSPromiseType = Engine::CellType::Promise,
    JSMapType = Engine::CellType::Map,
    JSSetType = Engine::CellType::Set,
    JSWeakMapType = Engine::CellType::WeakMap,
    JSWeakSetType = Engine::CellType::WeakSet,
    WebAssemblyModuleType = Engine::CellType::WasmModule,
    WebAssemblyInstanceType = Engine::CellType::WasmInstance,
    WebAssemblyGCObjectType = Engine::CellType::WasmGcObject,
    StringObjectType = Engine::CellType::StringObject,
    DerivedStringObjectType = Engine::CellType::DerivedStringObject,
    InternalFieldTupleType = Engine::CellType::InternalFieldTuple,
    LastJSCObjectType = InternalFieldTupleType,
    MaxJSType = 0xff,
};

struct JSTypeRange {
    constexpr bool contains(JSType type) const { return static_cast<uint8_t>(type - first) <= static_cast<uint8_t>(last - first); }

    JSType first;
    JSType last;
};

constexpr bool isTypedArrayType(JSType type) { return type >= Int8ArrayType && type <= BigUint64ArrayType; }
constexpr bool isTypedArrayTypeIncludingDataView(JSType type) { return type >= Int8ArrayType && type <= DataViewType; }

inline constexpr unsigned ImplementsDefaultHasInstance = Engine::TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE;
inline constexpr unsigned OverridesGetCallData = Engine::TypeFlags::OVERRIDES_CALL_DATA;
inline constexpr unsigned OverridesGetOwnPropertySlot = Engine::TypeFlags::OVERRIDES_GET_OWN_PROPERTY_SLOT;
inline constexpr unsigned OverridesGetPrototype = Engine::TypeFlags::OVERRIDES_GET_PROTOTYPE;
inline constexpr unsigned HasStaticPropertyTable = Engine::TypeFlags::HAS_STATIC_PROPERTY_TABLE;
inline constexpr unsigned TypeInfoPerCellBit = Engine::TypeFlags::PER_CELL_BIT;
inline constexpr unsigned ImplementsHasInstance = Engine::TypeFlags::IMPLEMENTS_HAS_INSTANCE;
inline constexpr unsigned OverridesGetOwnPropertyNames = Engine::TypeFlags::OVERRIDES_OWN_PROPERTY_NAMES;
inline constexpr unsigned OverridesGetOwnSpecialPropertyNames = Engine::TypeFlags::OVERRIDES_OWN_SPECIAL_PROPERTY_NAMES;
inline constexpr unsigned ProhibitsPropertyCaching = Engine::TypeFlags::PROHIBITS_PROPERTY_CACHING;
inline constexpr unsigned IsImmutablePrototypeExoticObject = Engine::TypeFlags::IS_IMMUTABLE_PROTOTYPE_EXOTIC_OBJECT;
inline constexpr unsigned GetOwnPropertySlotIsImpureForPropertyAbsence = Engine::TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE_FOR_ABSENCE;
inline constexpr unsigned InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero = Engine::TypeFlags::INTERCEPTS_INDEXED_ACCESS;
inline constexpr unsigned OverridesPut = Engine::TypeFlags::OVERRIDES_PUT;
inline constexpr unsigned GetOwnPropertySlotMayBeWrongAboutDontEnum = Engine::TypeFlags::GET_OWN_PROPERTY_SLOT_MAY_BE_WRONG_ABOUT_DONT_ENUM;
inline constexpr unsigned OverridesIsExtensible = Engine::TypeFlags::OVERRIDES_IS_EXTENSIBLE;

class TypeInfo {
public:
    using InlineTypeFlags = uint8_t;

    constexpr TypeInfo(JSType type, unsigned flags)
        : m_type(type)
        , m_flags(flags)
    {
    }

    constexpr JSType type() const { return m_type; }
    constexpr unsigned flags() const { return m_flags; }
    constexpr bool isObject() const { return m_type >= ObjectType; }

    constexpr bool hasStaticPropertyTable() const { return m_flags & HasStaticPropertyTable; }
    constexpr bool implementsHasInstance() const { return m_flags & ImplementsHasInstance; }
    constexpr bool interceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero() const { return m_flags & InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero; }
    constexpr bool overridesAnyFormOfGetOwnPropertyNames() const { return m_flags & (OverridesGetOwnPropertyNames | OverridesGetOwnSpecialPropertyNames); }
    constexpr bool overridesGetOwnPropertyNames() const { return m_flags & OverridesGetOwnPropertyNames; }
    constexpr bool overridesGetOwnPropertySlot() const { return m_flags & OverridesGetOwnPropertySlot; }
    constexpr bool overridesGetPrototype() const { return m_flags & OverridesGetPrototype; }
    constexpr bool overridesPut() const { return m_flags & OverridesPut; }
    constexpr bool prohibitsPropertyCaching() const { return m_flags & ProhibitsPropertyCaching; }
    static constexpr bool overridesGetOwnPropertySlot(InlineTypeFlags flags) { return flags & OverridesGetOwnPropertySlot; }

private:
    JSType m_type;
    unsigned m_flags;
};

inline constexpr IndexingType IsArray = Engine::Layout::isArray;
inline constexpr IndexingType IndexingShapeMask = Engine::Layout::elementKindMask;
inline constexpr IndexingType NoIndexingShape = Engine::ElementKind::None;
inline constexpr IndexingType Int32Shape = Engine::ElementKind::Int32;
inline constexpr IndexingType DoubleShape = Engine::ElementKind::Double;
inline constexpr IndexingType ContiguousShape = Engine::ElementKind::Contiguous;
inline constexpr IndexingType ArrayStorageShape = Engine::ElementKind::Sparse;
// In no header: what indexingType() says of elements that cannot simply be stored to, however they are kept.
inline constexpr IndexingType SlowPutArrayStorageShape = ArrayStorageShape + 2;
static_assert(!(SlowPutArrayStorageShape & ~IndexingShapeMask));
inline constexpr IndexingType CopyOnWrite = Engine::Layout::copyOnWrite;
// In no header either: for Structure::create().
inline constexpr IndexingType MayHaveIndexedAccessors = 0x40;

inline constexpr IndexingType NonArray = NoIndexingShape;
inline constexpr IndexingType ArrayWithInt32 = IsArray | Int32Shape;
inline constexpr IndexingType ArrayWithDouble = IsArray | DoubleShape;
inline constexpr IndexingType ArrayWithContiguous = IsArray | ContiguousShape;

constexpr bool hasIndexedProperties(IndexingType type) { return type & IndexingShapeMask; }
constexpr bool hasInt32(IndexingType type) { return (type & IndexingShapeMask) == Int32Shape; }
constexpr bool hasContiguous(IndexingType type) { return (type & IndexingShapeMask) == ContiguousShape; }
constexpr bool hasAnyArrayStorage(IndexingType type) { return (type & IndexingShapeMask) >= ArrayStorageShape; }

constexpr IndexingType indexingTypeOfHeader(uint8_t bits)
{
    if ((bits & Engine::Layout::slowPut) && hasIndexedProperties(bits)) [[unlikely]]
        return (bits & IsArray) | SlowPutArrayStorageShape;
    return bits & (IsArray | IndexingShapeMask);
}

extern "C" const uintptr_t engine_shape_base;

class StructureID {
public:
    StructureID() = default;
    explicit StructureID(uint32_t bits)
        : m_bits(bits)
    {
    }

    static StructureID encode(const Structure* structure) { return StructureID(reinterpret_cast<uintptr_t>(structure) - engine_shape_base); }
    Structure* decode() const { return reinterpret_cast<Structure*>(engine_shape_base + (m_bits & ~isBeingChanged)); }
    uint32_t bits() const { return m_bits; }
    friend bool operator==(const StructureID&, const StructureID&) = default;

private:
    // Only a marker that runs beside the thread of the cell sees it.
    static constexpr uint32_t isBeingChanged = Engine::Layout::shapeIdIsNuked;

    uint32_t m_bits { 0 };
};

} // namespace JSC
