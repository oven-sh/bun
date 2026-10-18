#include "Algo/Tuple.h"
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
#include <tuple>

namespace Zig {
JSC::JSValue WebSocketConstructorCallback(JSC::VM&, JSC::JSObject*);
}

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Ensure overriding globals doesn't impact usages.
JSC::JSValue createUndiciInternalBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSValue (*volatile webSocketConstructor)(VM&, JSObject*) = Zig::WebSocketConstructorCallback;

    auto fields = std::make_tuple(
        globalObject->JSResponseConstructor(),
        globalObject->JSRequestConstructor(),
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject),
        WebCore::JSDOMFormData::getConstructor(vm, globalObject),
        globalObject->JSDOMFileConstructor(),
        JSDOMURL::getConstructor(vm, globalObject),
        JSAbortSignal::getConstructor(vm, globalObject),
        JSURLSearchParams::getConstructor(vm, globalObject),
        webSocketConstructor(vm, globalObject),
        JSCloseEvent::getConstructor(vm, globalObject),
        JSErrorEvent::getConstructor(vm, globalObject),
        JSMessageEvent::getConstructor(vm, globalObject));

    auto* obj = constructEmptyObject(globalObject, globalObject->objectPrototype(),
        std::tuple_size_v<decltype(fields)>);

    Bun::Algo::Tuple::forEachIndexed(std::move(fields), [&](std::size_t index, auto&& field) {
        obj->putDirectIndex(globalObject, index, field);
    });

    return obj;
}

}
