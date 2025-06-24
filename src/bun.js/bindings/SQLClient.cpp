#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
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
#include "JavaScriptCore/JSType.h"
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
} ExternColumnIdentifier;

typedef struct DataCellArray {
    struct DataCell* cells;
    uint32_t length;
    uint32_t cap;
} DataCellArray;

typedef struct DataCellRaw {
    void* ptr;
    uint64_t length;
} DataCellRaw;

typedef struct TypedArrayDataCell {
    void* headPtr;
    void* data;
    uint32_t length;
    uint32_t byteLength;
    JSC::JSType type;
} TypedArrayDataCell;

typedef union DataCellValue {
    uint8_t null_value;
    WTF::StringImpl* string;
    double number;
    int32_t integer;
    int64_t bigint;
    uint8_t boolean;
    double date;
    double date_with_time_zone;
    size_t bytea[2];
    WTF::StringImpl* json;
    DataCellArray array;
    TypedArrayDataCell typed_array;
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
    DateWithTimeZone = 7,
    Bytea = 8,
    Json = 9,
    Array = 10,
    TypedArray = 11,
    Raw = 12,
    UnsignedInteger = 13,
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
    switch (cell.tag) {
    case DataCellTag::Null:
        return jsNull();
        break;
    case DataCellTag::Raw: {
        Zig::GlobalObject* zigGlobal = jsCast<Zig::GlobalObject*>(globalObject);
        auto* subclassStructure = zigGlobal->JSBufferSubclassStructure();
        auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, cell.value.raw.length);
        if (uint8Array == nullptr) [[unlikely]] {
            return {};
        }

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
        return jsDoubleNumber(cell.value.number);
        break;
    case DataCellTag::Integer:
        return jsNumber(cell.value.integer);
        break;
    case DataCellTag::UnsignedInteger:
        return jsNumber(cell.value.unsigned_integer);
        break;
    case DataCellTag::Bigint:
        return JSC::JSBigInt::createFrom(globalObject, cell.value.bigint);
        break;
    case DataCellTag::Boolean:
        return jsBoolean(cell.value.boolean);
        break;
    case DataCellTag::DateWithTimeZone:
    case DataCellTag::Date: {
        return JSC::DateInstance::create(vm, globalObject->dateStructure(), cell.value.date);
        break;
    }
    case DataCellTag::Bytea: {
        Zig::GlobalObject* zigGlobal = jsCast<Zig::GlobalObject*>(globalObject);
        auto* subclassStructure = zigGlobal->JSBufferSubclassStructure();
        auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, cell.value.bytea[1]);
        if (uint8Array == nullptr) [[unlikely]] {
            return {};
        }

        if (cell.value.bytea[1] > 0) {
            memcpy(uint8Array->vector(), reinterpret_cast<void*>(cell.value.bytea[0]), cell.value.bytea[1]);
        }
        return uint8Array;
    }
    case DataCellTag::Json: {
        if (cell.value.json) {
            auto str = WTF::String(cell.value.json);
            JSC::JSValue json = JSC::JSONParse(globalObject, str);
            return json;
        }
        return jsNull();
    }
    case DataCellTag::Array: {
        MarkedArgumentBuffer args;
        uint32_t length = cell.value.array.length;
        for (uint32_t i = 0; i < length; i++) {
            JSValue result = toJS(vm, globalObject, cell.value.array.cells[i]);
            if (result.isEmpty()) [[unlikely]] {
                return {};
            }

            args.append(result);
        }

        return JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), args);
    }
    case DataCellTag::TypedArray: {
        JSC::JSType type = static_cast<JSC::JSType>(cell.value.typed_array.type);
        uint32_t length = cell.value.typed_array.length;
        switch (type) {
        case JSC::JSType::Int32ArrayType: {
            JSC::JSInt32Array* array = JSC::JSInt32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeInt32>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(int32_t));
            }

            return array;
        }
        case JSC::JSType::Uint32ArrayType: {
            JSC::JSUint32Array* array = JSC::JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeUint32>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(uint32_t));
            }
            return array;
        }
        case JSC::JSType::Int16ArrayType: {
            JSC::JSInt16Array* array = JSC::JSInt16Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeInt16>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(int16_t));
            }

            return array;
        }
        case JSC::JSType::Uint16ArrayType: {
            JSC::JSUint16Array* array = JSC::JSUint16Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeUint16>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(uint16_t));
            }
            return array;
        }
        case JSC::JSType::Float16ArrayType: {
            JSC::JSFloat16Array* array = JSC::JSFloat16Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeFloat16>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * 2); // sizeof(float16_t)
            }
            return array;
        }
        case JSC::JSType::Float32ArrayType: {
            JSC::JSFloat32Array* array = JSC::JSFloat32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeFloat32>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(float));
            }
            return array;
        }
        case JSC::JSType::Float64ArrayType: {
            JSC::JSFloat64Array* array = JSC::JSFloat64Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypedArrayType::TypeFloat64>(), length);
            if (array == nullptr) [[unlikely]] {
                return {};
            }

            if (length > 0) {
                memcpy(array->vector(), reinterpret_cast<void*>(cell.value.typed_array.data), length * sizeof(double));
            }
            return array;
        }
        default: {
            RELEASE_ASSERT_NOT_REACHED_WITH_MESSAGE("TODO: implement this typed array type");
        }
        }
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
        auto* object = structure ? JSC::constructEmptyObject(vm, structure) : JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);

        // TODO: once we have more tests for this, let's add another branch for
        // "only mixed names and mixed indexed columns, no duplicates"
        // then we cna remove this sort and instead do two passes.
        if (flags.hasIndexedColumns() && flags.hasNamedColumns()) {
            // sort the cells by if they're named or indexed, put named first.
            // this is to conform to the Structure offsets from earlier.
            std::sort(cells, cells + count, [](DataCell& a, DataCell& b) {
                return a.isNamedColumn() && !b.isNamedColumn();
            });
        }

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

                    auto name = names.value()[i];
                    object->putDirect(vm, Identifier::fromString(vm, name.name.toWTFString()), value);

                } else {
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
            }
        } else {
            uint32_t structureOffsetIndex = 0;
            // slow path: named columns with duplicate columns or indexed columns
            for (uint32_t i = 0; i < count; i++) {
                auto& cell = cells[i];
                if (cell.isIndexedColumn()) {
                    JSValue value = toJS(vm, globalObject, cell);
                    RETURN_IF_EXCEPTION(scope, {});
                    ASSERT(cell.index < count);
                    ASSERT(!cell.isNamedColumn());
                    ASSERT(!cell.isDuplicateColumn());
                    object->putDirectIndex(globalObject, cell.index, value);
                } else if (cell.isNamedColumn()) {
                    JSValue value = toJS(vm, globalObject, cell);
                    RETURN_IF_EXCEPTION(scope, {});
                    ASSERT(!cell.isIndexedColumn());
                    ASSERT(!cell.isDuplicateColumn());
                    ASSERT(cell.index < count);

                    if (names.has_value()) {
                        auto name = names.value()[structureOffsetIndex++];
                        object->putDirect(vm, Identifier::fromString(vm, name.name.toWTFString()), value);
                    } else {
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
    JSValue value = toJS(structure, cells, count, globalObject, flags, result_mode, namesPtr, namesCount);
    if (value.isEmpty())
        return {};

    if (array) {
        array->push(globalObject, value);
        return array;
    }

    auto* newArray = JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 1);
    if (!newArray)
        return {};

    newArray->putDirectIndex(globalObject, 0, value);
    return newArray;
}

extern "C" EncodedJSValue JSC__constructObjectFromDataCell(
    JSC::JSGlobalObject* globalObject,
    EncodedJSValue encodedArrayValue,
    EncodedJSValue encodedStructureValue, DataCell* cells, uint32_t count, uint32_t flags, uint8_t result_mode, ExternColumnIdentifier* namesPtr, uint32_t namesCount)
{
    JSValue arrayValue = JSValue::decode(encodedArrayValue);
    JSValue structureValue = JSValue::decode(encodedStructureValue);
    auto* array = arrayValue ? jsDynamicCast<JSC::JSArray*>(arrayValue) : nullptr;
    auto* structure = jsDynamicCast<JSC::Structure*>(structureValue);
    return JSValue::encode(toJS(array, structure, cells, count, globalObject, Bun::BunStructureFlags(flags), BunResultMode(result_mode), namesPtr, namesCount));
}

extern "C" EncodedJSValue JSC__createStructure(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, uint32_t capacity, ExternColumnIdentifier* namesPtr)
{
    auto& vm = JSC::getVM(globalObject);

    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    std::span<ExternColumnIdentifier> names(namesPtr, capacity);
    uint32_t nonDuplicateCount = 0;

    for (uint32_t i = 0; i < capacity; i++) {
        ExternColumnIdentifier& name = names[i];
        if (name.isNamedColumn()) {
            propertyNames.add(Identifier::fromString(vm, name.name.toWTFString()));
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

extern "C" EncodedJSValue JSC__createEmptyObjectWithStructure(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    auto& vm = JSC::getVM(globalObject);
    auto* object = JSC::constructEmptyObject(vm, structure);

    ensureStillAliveHere(object);
    vm.writeBarrier(object);

    return JSValue::encode(object);
}

extern "C" void JSC__putDirectOffset(JSC::VM* vm, JSC::EncodedJSValue object, uint32_t offset, JSC::EncodedJSValue value)
{
    JSValue::decode(object).getObject()->putDirectOffset(*vm, offset, JSValue::decode(value));
}
extern "C" uint32_t JSC__JSObject__maxInlineCapacity = JSC::JSFinalObject::maxInlineCapacity;
}
