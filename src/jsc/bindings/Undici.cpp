#include "Algo/Tuple.h"
#include "root.h"

#include "JSDOMURL.h"
#include "JSURLSearchParams.h"
#include "JSAbortSignal.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"

#include "GeneratedResponse.h"
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

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Ensure overriding globals doesn't impact usages.
JSC::JSValue createUndiciInternalBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto fields = std::make_tuple(
        Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSResponse>(globalObject),
        Bun::Bindgen::constructorForClass<Bun::Bindgen::Generated::JSRequest>(globalObject),
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject),
        WebCore::JSDOMFormData::getConstructor(vm, globalObject),
        globalObject->JSDOMFileConstructor(),
        JSDOMURL::getConstructor(vm, globalObject),
        JSAbortSignal::getConstructor(vm, globalObject),
        JSURLSearchParams::getConstructor(vm, globalObject),
        JSWebSocket::getConstructor(vm, globalObject),
        JSCloseEvent::getConstructor(vm, globalObject),
        JSErrorEvent::getConstructor(vm, globalObject),
        JSMessageEvent::getConstructor(vm, globalObject));

    auto* obj = constructEmptyObject(globalObject, globalObject->objectPrototype(),
        std::tuple_size_v<decltype(fields)>);

    bool hasException = false;
    Bun::Algo::Tuple::forEachIndexed(std::move(fields), [&](std::size_t index, auto&& field) {
        if (hasException)
            return;
        obj->putDirectIndex(globalObject, index, field);
        hasException = !!scope.exception();
    });
    RETURN_IF_EXCEPTION(scope, {});

    return obj;
}

}
