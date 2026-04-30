#include "root.h"

#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSArrayBufferView.h"

#if ASAN_ENABLED
#include <sanitizer/lsan_interface.h>
#endif

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunction_arrayBufferViewHasBuffer, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto value = callFrame->argument(0);
    auto view = uncheckedDowncast<WebCore::JSArrayBufferView>(value);
    return JSValue::encode(jsBoolean(view->hasArrayBuffer()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_hasReifiedStatic, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto object = callFrame->argument(0).getObject();
    if (!object) {
        return JSValue::encode(jsBoolean(false));
    }

    if (object->hasNonReifiedStaticProperties()) {
        return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_lsanDoLeakCheck, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
#if ASAN_ENABLED
    return JSValue::encode(jsNumber(__lsan_do_recoverable_leak_check()));
#endif
    return encodedJSUndefined();
}

extern "C" void BunString__ensureDeadImpliesException(JSC::JSGlobalObject*);

// Simulates the state the fuzzer observed (toWTFString returned a null
// WTF::String while no exception was pending) and verifies the production
// guard in BunString.cpp synthesizes an exception so String.fromJS never
// sees a Dead result without one. The null-without-exception state is not
// reachable from JavaScript, so this hook is the only way to exercise the
// guard deterministically.
JSC_DEFINE_HOST_FUNCTION(jsFunction_bunStringDeadImpliesException, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    scope.clearException();
    RELEASE_ASSERT(!vm.exceptionForInspection());

    BunString__ensureDeadImpliesException(globalObject);

    bool hasException = !!scope.exception();
    scope.clearException();
    return JSValue::encode(jsBoolean(hasException));
}

}
