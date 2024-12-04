#include "root.h"

#include "JSDOMURL.h"
#include "JSURLSearchParams.h"
#include "JSAbortSignal.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"

#include "JSFetchHeaders.h"
#include "JSDOMFormData.h"
#include "JavaScriptCore/ObjectConstructor.h"

#include "helpers.h"
#include "BunClientData.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/JSFunction.h"
#include "JSDOMFile.h"
#include "JSWebSocket.h"
#include "JSCloseEvent.h"
#include "JSErrorEvent.h"
#include "JSMessageEvent.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Ensure overriding globals doesn't impact usages.
JSC::JSValue createUndiciInternalBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    auto* obj = constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);
    obj->putDirectIndex(
        globalObject, 0,
        globalObject->JSResponseConstructor());
    obj->putDirectIndex(
        globalObject, 1,
        globalObject->JSRequestConstructor());
    obj->putDirectIndex(
        globalObject, 2,
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 3,
        WebCore::JSDOMFormData::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 4,
        globalObject->JSDOMFileConstructor());
    obj->putDirectIndex(
        globalObject, 5,
        JSDOMURL::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 6,
        JSAbortSignal::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 7,
        JSURLSearchParams::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 8,
        JSWebSocket::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 9,
        JSCloseEvent::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 10,
        JSErrorEvent::getConstructor(vm, globalObject));
    obj->putDirectIndex(
        globalObject, 11,
        JSMessageEvent::getConstructor(vm, globalObject));

    return obj;
}

}
