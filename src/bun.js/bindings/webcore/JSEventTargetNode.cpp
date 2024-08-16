

#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JSEventTarget.h"
#include "JavaScriptCore/JSArray.h"
#include "wtf/text/MakeString.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeEventsGetEventListeners, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, throwScope, "getEventListeners needs 2 arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue thisValue = callFrame->argument(0);
    auto* thisObject = jsDynamicCast<JSEventTarget*>(thisValue);
    RETURN_IF_EXCEPTION(throwScope, {});
    auto eventType = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    if (UNLIKELY(!thisObject))
        return JSValue::encode(constructEmptyArray(globalObject, nullptr, 0));

    MarkedArgumentBuffer values;
    auto& listeners = thisObject->wrapped().eventListeners(WTF::makeAtomString(eventType));
    for (auto& listener : listeners) {
        auto* function = listener->callback().jsFunction();
        if (function) {
            values.append(function);
        }
    }

    return JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), values));
}

}