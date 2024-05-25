#include "root.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "helpers.h"
#include "BunClientData.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSFunction.h"
#include "wtf/URL.h"
#include "JSFetchHeaders.h"
#include "JSDOMExceptionHandling.h"
#include <bun-uws/src/App.h>
#include "ZigGeneratedClasses.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

extern "C" uWS::HttpRequest* Request__getUWSRequest(void*);

static EncodedJSValue assignHeadersFromFetchHeaders(FetchHeaders& impl, JSObject* prototype, JSObject* objectValue, JSC::InternalFieldTuple* tuple, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t size = std::min(impl.sizeAfterJoiningSetCookieHeader(), static_cast<uint32_t>(JSFinalObject::maxInlineCapacity));
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, impl.size() * 2);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSObject* obj = JSC::constructEmptyObject(globalObject, prototype, size);
    RETURN_IF_EXCEPTION(scope, {});

    unsigned arrayI = 0;

    auto& internal = impl.internalHeaders();
    {
        auto& vec = internal.commonHeaders();
        for (const auto& it : vec) {
            const auto& name = it.key;
            const auto& value = it.value;
            const auto impl = WTF::httpHeaderNameStringImpl(name);
            JSString* jsValue = jsString(vm, value);
            obj->putDirect(vm, Identifier::fromString(vm, impl), jsValue, 0);
            array->putDirectIndex(globalObject, arrayI++, jsString(vm, impl));
            array->putDirectIndex(globalObject, arrayI++, jsValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    {
        const auto& values = internal.getSetCookieHeaders();

        size_t count = values.size();

        if (count > 0) {
            JSC::JSArray* setCookies = constructEmptyArray(globalObject, nullptr, count);
            RETURN_IF_EXCEPTION(scope, {});
            const auto setCookieHeaderString = WTF::httpHeaderNameStringImpl(HTTPHeaderName::SetCookie);

            JSString* setCookie = jsString(vm, setCookieHeaderString);

            for (size_t i = 0; i < count; ++i) {
                auto* out = jsString(vm, values[i]);
                array->putDirectIndex(globalObject, arrayI++, setCookie);
                array->putDirectIndex(globalObject, arrayI++, out);
                setCookies->putDirectIndex(globalObject, i, out);
                RETURN_IF_EXCEPTION(scope, {});
            }

            RETURN_IF_EXCEPTION(scope, {});
            obj->putDirect(vm, JSC::Identifier::fromString(vm, setCookieHeaderString), setCookies, 0);
        }
    }

    {
        const auto& vec = internal.uncommonHeaders();
        for (const auto& it : vec) {
            const auto& name = it.key;
            const auto& value = it.value;
            auto* jsValue = jsString(vm, value);
            obj->putDirect(vm, Identifier::fromString(vm, name.convertToASCIILowercase()), jsValue, 0);
            array->putDirectIndex(globalObject, arrayI++, jsString(vm, name));
            array->putDirectIndex(globalObject, arrayI++, jsValue);
        }
    }

    tuple->putInternalField(vm, 0, obj);
    tuple->putInternalField(vm, 1, array);

    return JSValue::encode(tuple);
}

// This is an 8% speedup.
static EncodedJSValue assignHeadersFromUWebSockets(uWS::HttpRequest* request, JSObject* prototype, JSObject* objectValue, JSC::InternalFieldTuple* tuple, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& builtinNames = WebCore::builtinNames(vm);
    std::string_view fullURLStdStr = request->getFullUrl();
    String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(fullURLStdStr.data()), fullURLStdStr.length() });

    {
        PutPropertySlot slot(objectValue, false);
        objectValue->put(objectValue, globalObject, builtinNames.urlPublicName(), jsString(vm, fullURL), slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    {
        PutPropertySlot slot(objectValue, false);
        std::string_view methodView = request->getMethod();
        WTF::String methodString;
        switch (methodView.length()) {
        case 3: {
            if (methodView == std::string_view("get", 3)) {
                methodString = "GET"_s;
                break;
            }
            if (methodView == std::string_view("put", 3)) {
                methodString = "PUT"_s;
                break;
            }

            break;
        }
        case 4: {
            if (methodView == std::string_view("post", 4)) {
                methodString = "POST"_s;
                break;
            }
            if (methodView == std::string_view("head", 4)) {
                methodString = "HEAD"_s;
                break;
            }

            if (methodView == std::string_view("copy", 4)) {
                methodString = "COPY"_s;
                break;
            }
        }

        case 5: {
            if (methodView == std::string_view("patch", 5)) {
                methodString = "PATCH"_s;
                break;
            }
            if (methodView == std::string_view("merge", 5)) {
                methodString = "MERGE"_s;
                break;
            }
            if (methodView == std::string_view("trace", 5)) {
                methodString = "TRACE"_s;
                break;
            }
            if (methodView == std::string_view("fetch", 5)) {
                methodString = "FETCH"_s;
                break;
            }
            if (methodView == std::string_view("purge", 5)) {
                methodString = "PURGE"_s;
                break;
            }

            break;
        }

        case 6: {
            if (methodView == std::string_view("delete", 6)) {
                methodString = "DELETE"_s;
                break;
            }

            break;
        }

        case 7: {
            if (methodView == std::string_view("connect", 7)) {
                methodString = "CONNECT"_s;
                break;
            }
            if (methodView == std::string_view("options", 7)) {
                methodString = "OPTIONS"_s;
                break;
            }

            break;
        }
        }

        if (methodString.isNull()) {
            methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(methodView.data()), methodView.length() });
        }
        objectValue->put(objectValue, globalObject, builtinNames.methodPublicName(), jsString(vm, methodString), slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    size_t size = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        size++;
    }

    JSC::JSObject* headersObject = JSC::constructEmptyObject(globalObject, prototype, std::min(size, static_cast<size_t>(JSFinalObject::maxInlineCapacity)));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, size * 2);
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;

    unsigned i = 0;

    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        StringView nameView = StringView(std::span { reinterpret_cast<const LChar*>(pair.first.data()), pair.first.length() });
        LChar* data = nullptr;
        auto value = String::createUninitialized(pair.second.length(), data);
        if (pair.second.length() > 0)
            memcpy(data, pair.second.data(), pair.second.length());

        HTTPHeaderName name;
        WTF::String nameString;
        WTF::String lowercasedNameString;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            nameString = WTF::httpHeaderNameStringImpl(name);
            lowercasedNameString = nameString;
        } else {
            nameString = nameView.toString();
            lowercasedNameString = nameString.convertToASCIILowercase();
        }

        JSString* jsValue = jsString(vm, value);

        if (name == WebCore::HTTPHeaderName::SetCookie) {
            if (!setCookiesHeaderArray) {
                setCookiesHeaderArray = constructEmptyArray(globalObject, nullptr);
                setCookiesHeaderString = jsString(vm, nameString);
                headersObject->putDirect(vm, Identifier::fromString(vm, lowercasedNameString), setCookiesHeaderArray, 0);
                RETURN_IF_EXCEPTION(scope, {});
            }
            array->putDirectIndex(globalObject, i++, setCookiesHeaderString);
            array->putDirectIndex(globalObject, i++, jsValue);
            setCookiesHeaderArray->push(globalObject, jsValue);
            RETURN_IF_EXCEPTION(scope, {});

        } else {
            headersObject->putDirect(vm, Identifier::fromString(vm, lowercasedNameString), jsValue, 0);
            array->putDirectIndex(globalObject, i++, jsString(vm, nameString));
            array->putDirectIndex(globalObject, i++, jsValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    tuple->putInternalField(vm, 0, headersObject);
    tuple->putInternalField(vm, 1, array);

    return JSValue::encode(tuple);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignHeaders, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue requestValue = callFrame->argument(0);
    JSObject* objectValue = callFrame->argument(1).getObject();

    JSC::InternalFieldTuple* tuple = JSC::InternalFieldTuple::create(vm, globalObject->m_internalFieldTupleStructure.get());

    JSValue headersValue = JSValue();
    JSValue urlValue = JSValue();
    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        if (uWS::HttpRequest* request = Request__getUWSRequest(jsRequest->wrapped())) {
            return assignHeadersFromUWebSockets(request, globalObject->objectPrototype(), objectValue, tuple, globalObject, vm);
        }

        if (jsRequest->m_headers) {
            headersValue = jsRequest->m_headers.get();
        }

        if (jsRequest->m_url) {
            urlValue = jsRequest->m_url.get();
        }
    }

    if (requestValue.isObject()) {
        if (!headersValue) {
            headersValue = requestValue.getObject()->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).headersPublicName());
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (!urlValue) {
            urlValue = requestValue.getObject()->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).urlPublicName());
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (headersValue) {
            if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
                FetchHeaders& impl = headers->wrapped();
                if (urlValue) {
                    if (urlValue.isString()) {
                        String url = urlValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (url.startsWith("https://"_s) || url.startsWith("http://"_s) || url.startsWith("file://"_s)) {
                            WTF::URL urlObj = WTF::URL({}, url);
                            if (urlObj.isValid()) {
                                urlValue = jsString(vm, makeString(urlObj.path(), urlObj.query().isEmpty() ? emptyString() : urlObj.queryWithLeadingQuestionMark()));
                            }
                        }
                    } else {
                        urlValue = jsEmptyString(vm);
                    }
                    PutPropertySlot slot(objectValue, false);
                    objectValue->put(objectValue, globalObject, WebCore::builtinNames(vm).urlPublicName(), urlValue, slot);
                    RETURN_IF_EXCEPTION(scope, {});
                }

                return assignHeadersFromFetchHeaders(impl, globalObject->objectPrototype(), objectValue, tuple, globalObject, vm);
            }
        }
    }

    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPGetHeader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
        JSValue nameValue = callFrame->argument(1);
        if (nameValue.isString()) {
            FetchHeaders* impl = &headers->wrapped();
            String name = nameValue.toWTFString(globalObject);
            if (WTF::equalIgnoringASCIICase(name, "set-cookie"_s)) {
                return fetchHeadersGetSetCookie(globalObject, vm, impl);
            }

            WebCore::ExceptionOr<String> res = impl->get(name);
            if (res.hasException()) {
                WebCore::propagateException(globalObject, scope, res.releaseException());
                return JSValue::encode(jsUndefined());
            }

            String value = res.returnValue();
            if (value.isEmpty()) {
                return JSValue::encode(jsUndefined());
            }

            return JSC::JSValue::encode(jsString(vm, value));
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetHeader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
        JSValue nameValue = callFrame->argument(1);
        if (nameValue.isString()) {
            String name = nameValue.toWTFString(globalObject);
            FetchHeaders* impl = &headers->wrapped();

            JSValue valueValue = callFrame->argument(2);
            if (valueValue.isUndefined())
                return JSValue::encode(jsUndefined());

            if (isArray(globalObject, valueValue)) {
                auto* array = jsCast<JSArray*>(valueValue);
                unsigned length = array->length();
                if (length > 0) {
                    JSValue item = array->getIndex(globalObject, 0);
                    if (UNLIKELY(scope.exception()))
                        return JSValue::encode(jsUndefined());
                    impl->set(name, item.getString(globalObject));
                    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
                }
                for (unsigned i = 1; i < length; ++i) {
                    JSValue value = array->getIndex(globalObject, i);
                    if (UNLIKELY(scope.exception()))
                        return JSValue::encode(jsUndefined());
                    if (!value.isString())
                        continue;
                    impl->append(name, value.getString(globalObject));
                    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
                }
                RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
                return JSValue::encode(jsUndefined());
            }

            impl->set(name, valueValue.getString(globalObject));
            RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
            return JSValue::encode(jsUndefined());
        }
    }

    return JSValue::encode(jsUndefined());
}

JSValue createNodeHTTPInternalBinding(Zig::GlobalObject* globalObject)
{
    auto* obj = constructEmptyObject(globalObject);
    VM& vm = globalObject->vm();
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setHeader"_s)),
        JSC::JSFunction::create(vm, globalObject, 3, "setHeader"_s, jsHTTPSetHeader, ImplementationVisibility::Public), NoIntrinsic);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getHeader"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "getHeader"_s, jsHTTPGetHeader, ImplementationVisibility::Public), NoIntrinsic);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignHeaders"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "assignHeaders"_s, jsHTTPAssignHeaders, ImplementationVisibility::Public), NoIntrinsic);
    return obj;
}

} // namespace Bun
