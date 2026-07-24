// Native support for the parts of `node:v8` that need to observe the
// JavaScriptCore heap directly.
#include "root.h"

#include "ErrorCode.h"
#include "NodeV8.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/StdLibExtras.h>

namespace Bun {

using namespace JSC;

// v8.isStringOneByteRepresentation() asks whether the engine is storing the
// string with one byte per character. JSC's JSString::is8Bit() answers exactly
// that question, so this is a faithful mapping rather than a content scan.
JSC_DEFINE_HOST_FUNCTION(functionIsStringOneByteRepresentation, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue argument = callFrame->argument(0);
    if (!argument.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "content"_s, "string"_s, argument);

    return JSValue::encode(jsBoolean(asString(argument)->is8Bit()));
}

static GCProfilerObserver& ensureGCProfilerObserver(JSGlobalObject* globalObject)
{
    auto* global = defaultGlobalObject(globalObject);
    auto& slot = global->m_gcProfilerObserver;
    if (!slot)
        slot = makeUnique<GCProfilerObserver>(global->vm());
    return *slot;
}

JSC_DEFINE_HOST_FUNCTION(functionStartGCProfiler, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(jsNumber(ensureGCProfilerObserver(globalObject).startSession()));
}

JSC_DEFINE_HOST_FUNCTION(functionStopGCProfiler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t id = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto records = ensureGCProfilerObserver(globalObject).stopSession(id);
    if (!records)
        return JSValue::encode(jsUndefined());

    JSArray* result = constructEmptyArray(globalObject, nullptr, records->size());
    RETURN_IF_EXCEPTION(scope, {});

    unsigned index = 0;
    for (const auto& record : *records) {
        JSObject* entry = constructEmptyObject(globalObject);
        entry->putDirect(vm, Identifier::fromString(vm, "isFullCollection"_s), jsBoolean(record.isFullCollection));
        entry->putDirect(vm, Identifier::fromString(vm, "cost"_s), jsNumber(record.costMicroseconds));
        entry->putDirect(vm, Identifier::fromString(vm, "usedBefore"_s), jsNumber(record.usedBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "capacityBefore"_s), jsNumber(record.capacityBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "externalBefore"_s), jsNumber(record.externalBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "usedAfter"_s), jsNumber(record.usedAfter));
        entry->putDirect(vm, Identifier::fromString(vm, "capacityAfter"_s), jsNumber(record.capacityAfter));
        entry->putDirect(vm, Identifier::fromString(vm, "externalAfter"_s), jsNumber(record.externalAfter));
        result->putDirectIndex(globalObject, index++, entry);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(result);
}

JSC::JSObject* createNodeV8Binding(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSObject* object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "isStringOneByteRepresentation"_s), 1, functionIsStringOneByteRepresentation, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "startGCProfiler"_s), 0, functionStartGCProfiler, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "stopGCProfiler"_s), 1, functionStopGCProfiler, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    return object;
}

} // namespace Bun
