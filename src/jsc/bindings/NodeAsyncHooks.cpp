#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/AOTFunction.h"

#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// This is called when AsyncLocalStorage is constructed.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsRegisterAsyncLocalStorage, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 3);
#if ENABLE(AOT)
    JSC::AOT::registerAsyncLocalStorage(globalObject, asObject(callFrame->uncheckedArgument(0)), asObject(callFrame->uncheckedArgument(1)), callFrame->uncheckedArgument(2).asCell());
#else
    UNUSED_PARAM(globalObject);
    UNUSED_PARAM(callFrame);
#endif
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
