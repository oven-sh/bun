#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/DateInstance.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/GCDeferralContext.h>
#include "GCDefferalContext.h"
#include "wtf/Assertions.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JavaScriptCore/TypedArrayAdaptersForwardDeclarations.h"

namespace Bun {
using namespace JSC;

typedef struct ExternColumnIdentifier {
    uint8_t tag;
    union {
        uint32_t index;
        BunString name;
    };

    bool isIndexedColumn() const { return tag == 1; }
    bool isNamedColumn() const { return tag == 2; }
    bool isDuplicateColumn() const { return tag == 0; }

    Identifier propertyName(VM& vm) const
    {
        ASSERT(isNamedColumn());
        // NonNull: a column named "" is the empty BunString, and Identifier::fromString cannot take a null String.
        return Identifier::fromString(vm, name.toWTFString(BunString::NonNull));
    }
} ExternColumnIdentifier;

typedef struct DataCellArray {
    struct DataCell* cells;
    uint32_t length;
    uint32_t cap;
} DataCellArray;

// Numbers and nulls. No GC cell.
typedef struct DataCellNumbers {
    JSC::JSValue* values;
    uint32_t length;
    uint32_t cap;
} DataCellNumbers;

typedef struct DataCellRaw {
    void* ptr;
    uint64_t length;
} DataCellRaw;

typedef union DataCellValue {
    uint8_t null_value;
    WTF::StringImpl* string;
    double number;
    int32_t integer;
    int64_t bigint;
    uint64_t unsigned_bigint;
    uint8_t boolean;
    double date;
    size_t bytea[2];
    WTF::StringImpl* json;
    DataCellArray array;
    DataCellNumbers numbers;
    DataCellRaw raw;
    uint32_t unsigned_integer;
} DataCellValue;

enum class DataCellTag : uint8_t {
    Null = 0,
    String = 1,
    Double = 2,
    Integer = 3,
    Bigint = 4,
    Boolean = 5,
    Date = 6,
    Bytea = 7,
    Json = 8,
    Array = 9,
    Raw = 10,
    UnsignedInteger = 11,
    UnsignedBigint = 12,
    Numbers = 13,
    Int32Array = 14,
    Float32Array = 15,
};

enum class BunResultMode : uint8_t {
    Objects = 0,
    Values = 1,
    Raw = 2,
};

typedef struct DataCell {
    DataCellTag tag;
    DataCellValue value;
    uint8_t freeValue;
    uint8_t _indexedColumnFlag;
    uint32_t index;

    bool isIndexedColumn() const { return _indexedColumnFlag == 1; }
    bool isNamedColumn() const { return _indexedColumnFlag == 0; }
    bool isDuplicateColumn() const { return _indexedColumnFlag == 2; }
} DataCell;

static_assert(sizeof(DataCell) == 32, "DataCell must match SQLDataCell in src/sql_jsc/shared/SQLDataCell.rs");

class BunStructureFlags {
public:
    uint32_t flags;

    BunStructureFlags(uint32_t flags)
        : flags(flags)
    {
    }

    bool hasIndexedColumns() const { return flags & (1 << 0); }
    bool hasNamedColumns() const { return flags & (1 << 1); }
    bool hasDuplicateColumns() const { return flags & (1 << 2); }
};

static JSC::JSValue toJS(JSC::VM& vm, JSC::JSGlobalObject* globalObject, DataCell& cell)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (cell.tag) {
    case DataCellTag::Null:
        return jsNull();
        break;
    case DataCellTag::Raw: {
        Zig::GlobalObject* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
        auto* subclassStructure = zigGlobal->JSBufferSubclassStructure();
        auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, cell.value.raw.length);
        RETURN_IF_EXCEPTION(scope, {});

        if (cell.value.raw.length > 0) {
            memcpy(uint8Array->vector(), reinterpret_cast<void*>(cell.value.raw.ptr), cell.value.raw.length);
        }
        return uint8Array;
    }
    case DataCellTag::String: {
        if (cell.value.string) {
            return jsString(vm, WTF::String(cell.value.string));
        }
        return jsEmptyString(vm);
    }
    case DataCellTag::Double:
        return jsNumber(purifyNaN(cell.value.number));
        break;
    case DataCellTag::Integer:
        return jsNumber(cell.value.integer);
        break;
    case DataCellTag::UnsignedInteger:
        return jsNumber(cell.value.unsigned_integer);
        break;
    case DataCellTag::Bigint:
        RELEASE_AND_RETURN(scope, JSC::JSBigInt::createFrom(globalObject, cell.value.bigint));
        break;
    case DataCellTag::UnsignedBigint:
        RELEASE_AND_RETURN(scope, JSC::JSBigInt::createFrom(globalObject, cell.value.unsigned_bigint));
        break;
    case DataCellTag::Boolean:
        return jsBoolean(cell.value.boolean);
        break;
    case DataCellTag::Date: {
        // Postgres 'infinity'::date / '-infinity'::timestamp arrive here as
        // ±Infinity. DateInstance::create applies timeClip, which maps every
        // non-finite input to NaN and loses the sign. Return the Number
        // ±Infinity instead, matching node-postgres (pg-types / postgres-date).
        if (std::isinf(cell.value.date)) {
            return jsDoubleNumber(cell.value.date);
        }
        return JSC::DateInstance::create(vm, globalObject->dateStructure(), cell.value.date);
        break;
    }
    case DataCellTag::Bytea: {
        Zig::GlobalObject* zigGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
        auto* subclassStructure = zigGlobal->JSBufferSubclassStructure();
        auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, cell.value.bytea[1]);
        RETURN_IF_EXCEPTION(scope, {});

        if (cell.value.bytea[1] > 0) {
            memcpy(uint8Array->vector(), reinterpret_cast<void*>(cell.value.bytea[0]), cell.value.bytea[1]);
        }
        return uint8Array;
    }
    case DataCellTag::Json: {
        if (cell.value.json) {
            auto str = WTF::String(cell.value.json);
            JSC::JSValue json = JSC::JSONParseWithException(globalObject, str);
            RETURN_IF_EXCEPTION(scope, {});
            return json;
        }
        return jsNull();
    }
    case DataCellTag::Array: {
        MarkedArgumentBuffer args;
        uint32_t length = cell.value.array.length;
        for (uint32_t i = 0; i < length; i++) {
            JSValue result = toJS(vm, globalObject, cell.value.array.cells[i]);
            RETURN_IF_EXCEPTION(scope, {});
            args.append(result);
        }
        if (args.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        RELEASE_AND_RETURN(scope, JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args));
    }
    case DataCellTag::Numbers: {
        const JSValue* values = cell.value.numbers.values;
        uint32_t length = cell.value.numbers.length;
        IndexingType indexingType = ArrayWithInt32;
        for (JSValue value : std::span { values, length }) {
            if (value.isInt32())
                continue;
            if (!value.isDouble() || std::isnan(value.asDouble())) {
                indexingType = ArrayWithContiguous;
                break;
            }
            indexingType = ArrayWithDouble;
        }
        ObjectInitializationScope initializationScope(vm);
        JSArray* array = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(indexingType), length);
        if (!array) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        // ArrayStorage when the global object is having a bad time.
        indexingType = array->indexingType();
        if (indexingType == ArrayWithDouble) {
            auto doubles = array->butterfly()->contiguousDouble();
            for (uint32_t i = 0; i < length; i++)
                doubles.atUnsafe(i) = values[i].asNumber();
        } else if (indexingType == ArrayWithInt32 || indexingType == ArrayWithContiguous) {
            auto slots = array->butterfly()->contiguous();
            for (uint32_t i = 0; i < length; i++)
                slots.atUnsafe(i).setWithoutWriteBarrier(values[i]);
        } else {
            for (uint32_t i = 0; i < length; i++)
                array->initializeIndexWithoutBarrier(initializationScope, i, values[i], indexingType);
        }
        return array;
    }
    case DataCellTag::Int32Array:
    case DataCellTag::Float32Array: {
        size_t length = cell.value.raw.length;
        JSArrayBufferView* array = cell.tag == DataCellTag::Int32Array
            ? static_cast<JSArrayBufferView*>(JSInt32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeInt32>(), length))
            : JSFloat32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeFloat32>(), length);
        RETURN_IF_EXCEPTION(scope, {});

        // Each element is 4 bytes of size and 4 of value, big-endian.
        auto* elements = static_cast<const uint8_t*>(cell.value.raw.ptr);
        auto* values = static_cast<uint32_t*>(array->vector());
        for (size_t i = 0; i < length; i++) {
            uint32_t value;
            memcpy(&value, elements + i * 8 + 4, sizeof(value));
            values[i] = std::byteswap(value);
        }
        return array;
    }
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }
}

static JSC::JSValue toJS(JSC::Structure* structure, DataCell* cells, uint32_t count, JSC::JSGlobalObject* globalObject, Bun::BunStructureFlags flags, BunResultMode result_mode, ExternColumnIdentifier* namesPtr, uint32_t namesCount)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::optional<std::span<ExternColumnIdentifier>> names = std::nullopt;
    if (namesPtr && namesCount > 0) {
        names = std::span<ExternColumnIdentifier>(namesPtr, namesCount);
    }
    switch (result_mode) {
    case BunResultMode::Objects: // objects

    {
        auto* object = structure ? JSC::constructEmptyObject(vm, structure) : JSC::constructEmptyObject(globalObject);

        // cells[i] corresponds to fields[i]: the slow path below advances
        // structureOffsetIndex only on named cells, so it visits them in the
        // same order JSC__createStructure assigned the offsets. No sort needed.

        // Fast path: named columns only, no duplicate columns
        if (flags.hasNamedColumns() && !flags.hasDuplicateColumns() && !flags.hasIndexedColumns()) {
            for (uint32_t i = 0; i < count; i++) {
                auto& cell = cells[i];
                JSValue value = toJS(vm, globalObject, cell);
                RETURN_IF_EXCEPTION(scope, {});
                ASSERT(!cell.isDuplicateColumn());
                ASSERT(!cell.isIndexedColumn());
                ASSERT(cell.isNamedColumn());
                if (names.has_value()) {
                    object->putDirect(vm, names.value()[i].propertyName(vm), value);
                } else {
                    // CachedStructure::build_from_columns guarantees one offset
                    // per column on this path; never drop a value silently.
                    RELEASE_ASSERT_WITH_MESSAGE(structure && structure->isValidOffset(i),
                        "SQL row column %u has no matching Structure offset", i);
                    object->putDirectOffset(vm, i, value);
                }
            }
        } else if (flags.hasIndexedColumns() && !flags.hasNamedColumns() && !flags.hasDuplicateColumns()) {
            for (uint32_t i = 0; i < count; i++) {
                auto& cell = cells[i];
                JSValue value = toJS(vm, globalObject, cell);
                RETURN_IF_EXCEPTION(scope, {});
                ASSERT(!cell.isDuplicateColumn());
                ASSERT(cell.isIndexedColumn());
                ASSERT(!cell.isNamedColumn());
                // cell.index can be > count
                // for example:
                //   select 1 as "8", 2 as "2", 3 as "3"
                //   -> { "8": 1, "2": 2, "3": 3 }
                //  8 > count
                object->putDirectIndex(globalObject, cell.index, value);
                RETURN_IF_EXCEPTION(scope, {});
            }
        } else {
            uint32_t structureOffsetIndex = 0;
            // slow path: named columns with duplicate columns or indexed columns
            for (uint32_t i = 0; i < count; i++) {
                auto& cell = cells[i];
                if (cell.isIndexedColumn()) {
                    JSValue value = toJS(vm, globalObject, cell);
                    RETURN_IF_EXCEPTION(scope, {});
                    // cell.index is the column name parsed as an integer, not a
                    // positional ordinal, so it can be >= count (e.g.
                    // `select 1 as "8"` -> index 8). putDirectIndex handles
                    // sparse indices, same as the indexed-only fast path above.
                    ASSERT(!cell.isNamedColumn());
                    ASSERT(!cell.isDuplicateColumn());
                    object->putDirectIndex(globalObject, cell.index, value);
                    RETURN_IF_EXCEPTION(scope, {});
                } else if (cell.isNamedColumn()) {
                    JSValue value = toJS(vm, globalObject, cell);
                    RETURN_IF_EXCEPTION(scope, {});
                    ASSERT(!cell.isIndexedColumn());
                    ASSERT(!cell.isDuplicateColumn());
                    ASSERT(cell.index < count);

                    if (names.has_value()) {
                        while (structureOffsetIndex < namesCount && !names.value()[structureOffsetIndex].isNamedColumn()) {
                            structureOffsetIndex++;
                        }
                        if (structureOffsetIndex < namesCount) {
                            object->putDirect(vm, names.value()[structureOffsetIndex++].propertyName(vm), value);
                        }
                    } else {
                        // JSC__createStructure added one offset per named
                        // column; never drop a value silently.
                        RELEASE_ASSERT_WITH_MESSAGE(structure && structure->isValidOffset(structureOffsetIndex),
                            "SQL row named column has no matching Structure offset (index %u)", structureOffsetIndex);
                        object->putDirectOffset(vm, structureOffsetIndex++, value);
                    }
                } else if (cell.isDuplicateColumn()) {
                    // skip it!
                }
            }
        }
        return object;
    }
    case BunResultMode::Raw: // raw is just array mode with raw values
    case BunResultMode::Values: // values
    {
        auto* array = JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), count);
        RETURN_IF_EXCEPTION(scope, {});

        for (uint32_t i = 0; i < count; i++) {
            auto& cell = cells[i];
            JSValue value = toJS(vm, globalObject, cell);
            RETURN_IF_EXCEPTION(scope, {});
            array->putDirectIndex(globalObject, i, value);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return array;
    }

    default:
        // not a valid result mode
        ASSERT_NOT_REACHED();
        return jsUndefined();
    }
}
static JSC::JSValue toJS(JSC::JSArray* array, JSC::Structure* structure, DataCell* cells, uint32_t count, JSC::JSGlobalObject* globalObject, Bun::BunStructureFlags flags, BunResultMode result_mode, ExternColumnIdentifier* namesPtr, uint32_t namesCount)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = toJS(structure, cells, count, globalObject, flags, result_mode, namesPtr, namesCount);
    RETURN_IF_EXCEPTION(scope, {});

    if (array) {
        array->push(globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        return array;
    }

    auto* newArray = JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 1);
    RETURN_IF_EXCEPTION(scope, {});

    newArray->putDirectIndex(globalObject, 0, value);
    RETURN_IF_EXCEPTION(scope, {});
    return newArray;
}

extern "C" EncodedJSValue JSC__constructObjectFromDataCell(
    JSC::JSGlobalObject* globalObject,
    EncodedJSValue encodedArrayValue,
    EncodedJSValue encodedStructureValue, DataCell* cells, uint32_t count, uint32_t flags, uint8_t result_mode, ExternColumnIdentifier* namesPtr, uint32_t namesCount)
{
    JSValue arrayValue = JSValue::decode(encodedArrayValue);
    JSValue structureValue = JSValue::decode(encodedStructureValue);
    auto* array = arrayValue ? dynamicDowncast<JSC::JSArray>(arrayValue) : nullptr;
    auto* structure = dynamicDowncast<JSC::Structure>(structureValue);
    return JSValue::encode(toJS(array, structure, cells, count, globalObject, Bun::BunStructureFlags(flags), BunResultMode(result_mode), namesPtr, namesCount));
}

extern "C" EncodedJSValue JSC__createStructure(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, uint32_t capacity, ExternColumnIdentifier* namesPtr)
{
    auto& vm = JSC::getVM(globalObject);

    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    std::span<ExternColumnIdentifier> names(namesPtr, capacity);
    uint32_t nonDuplicateCount = 0;

    for (uint32_t i = 0; i < capacity; i++) {
        ExternColumnIdentifier& name = names[i];
        if (name.isNamedColumn()) {
            propertyNames.add(name.propertyName(vm));
        }
        nonDuplicateCount += !name.isDuplicateColumn();
        if (nonDuplicateCount == JSFinalObject::maxInlineCapacity) {
            break;
        }
    }

    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), nonDuplicateCount);
    if (owner) {
        vm.writeBarrier(owner, structure);
    } else {
        vm.writeBarrier(structure);
    }
    ensureStillAliveHere(structure);

    if (names.size() > 0) {
        PropertyOffset offset = 0;
        uint32_t indexInPropertyNamesArray = 0;
        uint32_t propertyNamesSize = propertyNames.size();
        for (uint32_t i = 0; i < capacity && indexInPropertyNamesArray < propertyNamesSize; i++) {
            ExternColumnIdentifier& name = names[i];
            if (name.isNamedColumn()) {
                structure = structure->addPropertyTransition(vm, structure, propertyNames[indexInPropertyNamesArray++], 0, offset);
            }
        }
    }

    return JSValue::encode(structure);
}

// `result.statement`. `columnValues` holds one value for each of `keys`, column after column.
extern "C" EncodedJSValue SQL__createStatementDescription(JSC::JSGlobalObject* globalObject, const BunString* query, const uint32_t* parameterTypes, size_t parameterCount, const char* const* keys, size_t keyCount, MarkedArgumentBuffer* columnValues)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<Identifier, 8> identifiers;
    for (const char* key : std::span { keys, keyCount })
        identifiers.append(Identifier::fromString(vm, byteCast<Latin1Character>(unsafeSpan(key))));

    MarkedArgumentBuffer types;
    for (uint32_t type : std::span { parameterTypes, parameterCount })
        types.append(jsNumber(type));

    MarkedArgumentBuffer columns;
    for (size_t i = 0; i < columnValues->size(); i += keyCount) {
        JSObject* column = constructEmptyObject(globalObject, globalObject->objectPrototype(), static_cast<unsigned>(keyCount));
        for (size_t key = 0; key < keyCount; key++)
            column->putDirect(vm, identifiers[key], columnValues->at(i + key));
        columns.append(column);
    }

    if (columnValues->hasOverflowed() || columns.hasOverflowed() || types.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSString* string = toJS(globalObject, *query);
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* typesArray = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), types);
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* columnsArray = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), columns);
    RETURN_IF_EXCEPTION(scope, {});

    JSObject* statement = constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
    Bun::putDirectNamed(vm, statement, "string"_s, string);
    Bun::putDirectNamed(vm, statement, "types"_s, typesArray);
    Bun::putDirectNamed(vm, statement, "columns"_s, columnsArray);
    return JSValue::encode(statement);
}

extern "C" uint32_t JSC__JSObject__maxInlineCapacity = JSC::JSFinalObject::maxInlineCapacity;

// For ColumnIdentifier::init in bun_sql, which cannot see JSC. UINT32_MAX: not an array index.
static_assert(MAX_ARRAY_INDEX < std::numeric_limits<uint32_t>::max());
extern "C" uint32_t JSC__parseIndex(const Latin1Character* name, size_t length)
{
    return parseIndex(std::span<const Latin1Character> { name, length }).value_or(std::numeric_limits<uint32_t>::max());
}
}
