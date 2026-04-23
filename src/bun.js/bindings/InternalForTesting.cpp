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
    auto view = jsCast<WebCore::JSArrayBufferView*>(value);
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

extern "C" bool JSC__isBigIntInInt64Range(JSC::EncodedJSValue value, int64_t min, int64_t max);
extern "C" bool JSC__isBigIntInUInt64Range(JSC::EncodedJSValue value, uint64_t min, uint64_t max);

// For testing JSC__isBigIntInInt64Range / JSC__isBigIntInUInt64Range from JS.
// args: (bigint, min: number|bigint, max: number|bigint, unsigned: boolean)
JSC_DEFINE_HOST_FUNCTION(jsFunction_isBigIntInRange, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->argument(0);
    JSValue minArg = callFrame->argument(1);
    JSValue maxArg = callFrame->argument(2);
    bool isUnsigned = callFrame->argument(3).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (isUnsigned) {
        uint64_t min = minArg.toBigUInt64(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        uint64_t max = maxArg.toBigUInt64(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsBoolean(JSC__isBigIntInUInt64Range(JSValue::encode(value), min, max)));
    }

    int64_t min = minArg.toBigInt64(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int64_t max = maxArg.toBigInt64(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(JSC__isBigIntInInt64Range(JSValue::encode(value), min, max)));
}

}
