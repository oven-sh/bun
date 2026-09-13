// Every name of the `Bun.pprof` API is here, except `sampleInterval` (src/runtime/api/PprofObject.rs).

#include "root.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>

// src/runtime/api/PprofObject.rs
BUN_DECLARE_HOST_FUNCTION(Bun__pprof__heapStart);
BUN_DECLARE_HOST_FUNCTION(Bun__pprof__heapProfile);
BUN_DECLARE_HOST_FUNCTION(Bun__pprof__heapStop);
extern "C" bool Bun__pprof__heapIsRunning();

namespace Bun {

using namespace JSC;

JSC_DEFINE_CUSTOM_GETTER(pprofHeapIsRunning, (JSGlobalObject*, EncodedJSValue, PropertyName))
{
    return JSValue::encode(jsBoolean(Bun__pprof__heapIsRunning()));
}

JSObject* createPprofObject(VM& vm, JSGlobalObject* globalObject)
{
    constexpr unsigned attributes = PropertyAttribute::DontDelete | 0;

    JSObject* heap = constructEmptyObject(globalObject);
    heap->putDirect(vm, Identifier::fromString(vm, "start"_s),
        JSFunction::create(vm, globalObject, 1, "start"_s, Bun__pprof__heapStart, ImplementationVisibility::Public), attributes);
    heap->putDirect(vm, Identifier::fromString(vm, "profile"_s),
        JSFunction::create(vm, globalObject, 0, "profile"_s, Bun__pprof__heapProfile, ImplementationVisibility::Public), attributes);
    heap->putDirect(vm, Identifier::fromString(vm, "stop"_s),
        JSFunction::create(vm, globalObject, 0, "stop"_s, Bun__pprof__heapStop, ImplementationVisibility::Public), attributes);
    heap->putDirectCustomAccessor(vm, Identifier::fromString(vm, "isRunning"_s),
        CustomGetterSetter::create(vm, pprofHeapIsRunning, nullptr),
        PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor);

    JSObject* pprof = constructEmptyObject(globalObject);
    pprof->putDirect(vm, Identifier::fromString(vm, "heap"_s), heap, attributes);
    return pprof;
}

} // namespace Bun
