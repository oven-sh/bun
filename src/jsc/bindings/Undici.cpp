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
#include "JavaScriptCore/JSCustomGetterFunction.h"
#include "JavaScriptCore/JSFunction.h"
#include "JSDOMFile.h"
#include "JSWebSocket.h"
#include "JSCloseEvent.h"
#include "JSErrorEvent.h"
#include "JSMessageEvent.h"
#include <tuple>

// The members of Response.prototype, which bindgen defines in GeneratedResponse.cpp.
JSC_DECLARE_CUSTOM_GETTER(jsResponsePrototypeGetter_body);
JSC_DECLARE_CUSTOM_GETTER(jsResponsePrototypeGetter_headers);
JSC_DECLARE_CUSTOM_GETTER(jsResponsePrototypeGetter_status);
JSC_DECLARE_HOST_FUNCTION(jsResponsePrototypeFunction_arrayBuffer);
JSC_DECLARE_HOST_FUNCTION(jsResponsePrototypeFunction_blob);
JSC_DECLARE_HOST_FUNCTION(jsResponsePrototypeFunction_formData);
JSC_DECLARE_HOST_FUNCTION(jsResponsePrototypeFunction_json);
JSC_DECLARE_HOST_FUNCTION(jsResponsePrototypeFunction_text);

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Ensure overriding globals doesn't impact usages.
JSC::JSValue createUndiciInternalBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // request() reads the Response of its fetch() with these. Each is made here from the native code of a member of
    // Response.prototype or Headers.prototype, so it is that member whatever a program has stored on the prototype since.
    auto getter = [&](ASCIILiteral name, JSC::GetValueFunc function) {
        // The generated getters leave the check of `this` to the caller.
        return JSCustomGetterFunction::create(vm, globalObject, Identifier::fromString(vm, name), function, DOMAttributeAnnotation { Bun::Bindgen::Generated::JSResponse::info(), nullptr });
    };
    auto method = [&](ASCIILiteral name, JSC::NativeFunction function) {
        return JSFunction::create(vm, globalObject, 0, name, function, ImplementationVisibility::Private);
    };

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
        JSMessageEvent::getConstructor(vm, globalObject),
        getter("status"_s, jsResponsePrototypeGetter_status),
        getter("headers"_s, jsResponsePrototypeGetter_headers),
        method("toJSON"_s, jsFetchHeadersPrototypeFunction_toJSON),
        getter("body"_s, jsResponsePrototypeGetter_body),
        method("arrayBuffer"_s, jsResponsePrototypeFunction_arrayBuffer),
        method("blob"_s, jsResponsePrototypeFunction_blob),
        method("formData"_s, jsResponsePrototypeFunction_formData),
        method("json"_s, jsResponsePrototypeFunction_json),
        method("text"_s, jsResponsePrototypeFunction_text));

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
