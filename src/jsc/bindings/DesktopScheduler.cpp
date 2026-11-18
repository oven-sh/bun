// What src/dom/api/scheduler needs of WebCore.
#include "root.h"

#include "BunClientData.h"
#include "JSAbortController.h"
#include "JSAbortSignal.h"
#include "JSDOMConvertInterface.h"
#include "JSEventListener.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCInlines.h>

using namespace JSC;
using namespace WebCore;

extern "C" EncodedJSValue Bun__DOM__createAbortController(JSGlobalObject* globalObject, EncodedJSValue newTarget, EncodedJSValue behind)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue constructor = JSAbortController::getConstructor(vm, globalObject);
    JSObject* controller = construct(globalObject, constructor, getConstructData(constructor), ArgList(), JSValue::decode(newTarget));
    RETURN_IF_EXCEPTION(scope, {});
    controller->putDirect(vm, builtinNames(vm).implPrivateName(), JSValue::decode(behind));
    return JSValue::encode(controller);
}

extern "C" EncodedJSValue Bun__DOM__signalOfController(JSGlobalObject* globalObject, EncodedJSValue value)
{
    auto* controller = uncheckedDowncast<JSAbortController>(JSValue::decode(value));
    return JSValue::encode(toJS(globalObject, controller->globalObject(), controller->wrapped().signal()));
}

extern "C" void Bun__DOM__putBehindSignal(JSGlobalObject* globalObject, EncodedJSValue value, EncodedJSValue prototype, EncodedJSValue behind)
{
    VM& vm = globalObject->vm();
    JSObject* signal = asObject(JSValue::decode(value));
    signal->setPrototypeDirect(vm, JSValue::decode(prototype));
    signal->putDirect(vm, builtinNames(vm).implPrivateName(), JSValue::decode(behind));
}

extern "C" EncodedJSValue Bun__DOM__behindSignal(JSGlobalObject* globalObject, EncodedJSValue signal)
{
    VM& vm = globalObject->vm();
    JSValue behind = asObject(JSValue::decode(signal))->getDirect(vm, builtinNames(vm).implPrivateName());
    return JSValue::encode(behind ? behind : jsUndefined());
}

static AtomString priorityChange() { return "prioritychange"_s; }

extern "C" EncodedJSValue Bun__DOM__priorityChangeHandler(EncodedJSValue value)
{
    auto* signal = uncheckedDowncast<JSAbortSignal>(JSValue::decode(value));
    return JSValue::encode(eventHandlerAttribute(signal->wrapped(), priorityChange(), worldForDOMObject(*signal)));
}

extern "C" void Bun__DOM__setPriorityChangeHandler(EncodedJSValue value, EncodedJSValue handler)
{
    auto* signal = uncheckedDowncast<JSAbortSignal>(JSValue::decode(value));
    setEventHandlerAttribute<JSEventListener>(signal->wrapped(), priorityChange(), JSValue::decode(handler), *signal);
    signal->vm().writeBarrier(signal, JSValue::decode(handler));
}

extern "C" bool Bun__DOM__hearsOfPriorityChanges(EncodedJSValue signal)
{
    return uncheckedDowncast<JSAbortSignal>(JSValue::decode(signal))->wrapped().hasEventListeners(priorityChange());
}
