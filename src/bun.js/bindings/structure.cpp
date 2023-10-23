#include "root.h"
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

namespace Bun {
using namespace JSC;

typedef union DataCellValue {
    uint8_t null_value;
    WTF::StringImpl* string;
    double number;
    uint32_t integer;
    int64_t bigint;
    bool boolean;
    double date;
    size_t bytea[2];
    WTF::StringImpl* json;
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
};

typedef struct DataCell {
    DataCellTag tag;
    DataCellValue value;
    bool freeValue;
} DataCell;

static JSC::JSValue toJS(JSC::Structure* structure, DataCell* cells, unsigned count, JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(vm, structure);

    for (unsigned i = 0; i < count; i++) {
        auto& cell = cells[i];
        switch (cell.tag) {
        case DataCellTag::Null:
            object->putDirectOffset(vm, i, jsNull());
            break;
        case DataCellTag::String: {
            object->putDirectOffset(vm, i, jsString(vm, WTF::String(cell.value.string)));
            break;
        }
        case DataCellTag::Double:
            object->putDirectOffset(vm, i, jsDoubleNumber(cell.value.number));
            break;
        case DataCellTag::Integer:
            object->putDirectOffset(vm, i, jsNumber(cell.value.integer));
            break;
        case DataCellTag::Bigint:
            object->putDirectOffset(vm, i, JSC::JSBigInt::createFrom(globalObject, cell.value.bigint));
            break;
        case DataCellTag::Boolean:
            object->putDirectOffset(vm, i, jsBoolean(cell.value.boolean));
            break;
        case DataCellTag::Date:
            object->putDirectOffset(vm, i, JSC::DateInstance::create(vm, globalObject->dateStructure(), cell.value.date));
            break;
        case DataCellTag::Bytea: {
            Zig::GlobalObject* zigGlobal = jsCast<Zig::GlobalObject*>(globalObject);
            auto* subclassStructure = zigGlobal->JSBufferSubclassStructure();
            auto* uint8Array = JSC::JSUint8Array::createUninitialized(globalObject, subclassStructure, cell.value.bytea[1]);
            memcpy(uint8Array->vector(), reinterpret_cast<void*>(cell.value.bytea[0]), cell.value.bytea[1]);
            object->putDirectOffset(vm, i, uint8Array);
            break;
        }
        case DataCellTag::Json: {
            auto str = WTF::String(cell.value.string);
            JSC::JSValue json = JSC::JSONParse(globalObject, str);
            object->putDirectOffset(vm, i, json);
            break;
        }
        default: {
            RELEASE_ASSERT_NOT_REACHED();
        }
        }
    }

    return object;
}

static JSC::JSValue toJS(JSC::JSArray* array, JSC::Structure* structure, DataCell* cells, unsigned count, JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    if (array) {
        array->push(globalObject, toJS(structure, cells, count, globalObject));
        return array;
    }

    auto* newArray = JSC::constructEmptyArray(globalObject, nullptr);

    newArray->putDirectIndex(globalObject, 0, toJS(structure, cells, count, globalObject));
    return newArray;
}

extern "C" EncodedJSValue JSC__constructObjectFromDataCell(
    JSC::JSGlobalObject* globalObject,
    EncodedJSValue arrayValue,
    EncodedJSValue structureValue, DataCell* cells, unsigned count)
{
    auto* array = arrayValue ? jsDynamicCast<JSC::JSArray*>(JSC::JSValue::decode(arrayValue)) : nullptr;
    auto* structure = jsDynamicCast<JSC::Structure*>(JSC::JSValue::decode(structureValue));

    return JSValue::encode(toJS(array, structure, cells, count, globalObject));
}

extern "C" EncodedJSValue JSC__createStructure(JSC::JSGlobalObject* globalObject, JSC::JSCell* owner, unsigned int inlineCapacity, BunString* names)
{
    auto& vm = globalObject->vm();
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), inlineCapacity);
    if (owner) {
        vm.writeBarrier(owner, structure);
    } else {
        vm.writeBarrier(structure);
    }
    ensureStillAliveHere(structure);

    PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    for (unsigned i = 0; i < inlineCapacity; i++) {
        propertyNames.add(Identifier::fromString(vm, Bun::toWTFString(names[i])));
    }

    PropertyOffset offset = 0;
    for (unsigned i = 0; i < inlineCapacity; i++) {
        structure = structure->addPropertyTransition(vm, structure, propertyNames[i], 0, offset);
    }

    return JSValue::encode(structure);
}

extern "C" EncodedJSValue JSC__createEmptyObjectWithStructure(JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
{
    auto& vm = globalObject->vm();
    auto* object = JSC::constructEmptyObject(vm, structure);

    ensureStillAliveHere(object);
    vm.writeBarrier(object);

    return JSValue::encode(object);
}

extern "C" void JSC__putDirectOffset(JSC::VM* vm, JSC::EncodedJSValue object, unsigned int offset, JSC::EncodedJSValue value)
{
    JSValue::decode(object).getObject()->putDirectOffset(*vm, offset, JSValue::decode(value));
}

}
