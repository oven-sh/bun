#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
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

BUN_DECLARE_HOST_FUNCTION(jsFunctionRequestOrResponseHasBodyValue);
BUN_DECLARE_HOST_FUNCTION(jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer);
extern "C" uWS::HttpRequest* Request__getUWSRequest(void*);
extern "C" void Request__setInternalEventCallback(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Request__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void NodeHTTPResponse__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Server__setIdleTimeout(EncodedJSValue, EncodedJSValue, JSC::JSGlobalObject*);
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

static void assignHeadersFromUWebSocketsForCall(uWS::HttpRequest* request, MarkedArgumentBuffer& args, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    std::string_view fullURLStdStr = request->getFullUrl();
    String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(fullURLStdStr.data()), fullURLStdStr.length() });

    // Get the URL.
    {
        args.append(jsString(vm, fullURL));
    }

    // Get the method.
    {
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

        args.append(jsString(vm, methodString));
    }

    size_t size = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        size++;
    }

    JSC::JSObject* headersObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(size, static_cast<size_t>(JSFinalObject::maxInlineCapacity)));
    RETURN_IF_EXCEPTION(scope, void());
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, size * 2);
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;

    args.append(headersObject);
    args.append(array);

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
                RETURN_IF_EXCEPTION(scope, void());
            }
            array->putDirectIndex(globalObject, i++, setCookiesHeaderString);
            array->putDirectIndex(globalObject, i++, jsValue);
            setCookiesHeaderArray->push(globalObject, jsValue);
            RETURN_IF_EXCEPTION(scope, void());

        } else {
            headersObject->putDirect(vm, Identifier::fromString(vm, lowercasedNameString), jsValue, 0);
            array->putDirectIndex(globalObject, i++, jsString(vm, nameString));
            array->putDirectIndex(globalObject, i++, jsValue);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }
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

extern "C" EncodedJSValue NodeHTTPResponse__createForJS(size_t any_server, JSC::JSGlobalObject* globalObject, int* hasBody, uWS::HttpRequest* request, int isSSL, void* response_ptr, void** nodeHttpResponsePtr);

template<bool isSSL>
static EncodedJSValue NodeHTTPServer__onRequest(
    size_t any_server,
    JSC::JSGlobalObject* globalObject,
    JSValue thisValue,
    JSValue callback,
    uWS::HttpRequest* request,
    uWS::HttpResponse<isSSL>* response,
    void** nodeHttpResponsePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* callbackObject = jsCast<JSObject*>(callback);
    MarkedArgumentBuffer args;
    args.append(thisValue);

    assignHeadersFromUWebSocketsForCall(request, args, globalObject, vm);
    if (scope.exception()) {
        auto* exception = scope.exception();
        response->endWithoutBody();
        scope.clearException();
        return JSValue::encode(exception);
    }

    int hasBody = 0;
    EncodedJSValue nodehttpobjectValue = NodeHTTPResponse__createForJS(any_server, globalObject, &hasBody, request, isSSL, response, nodeHttpResponsePtr);

    JSC::CallData callData = getCallData(callbackObject);
    args.append(JSValue::decode(nodehttpobjectValue));
    args.append(jsBoolean(hasBody));

    WTF::NakedPtr<JSC::Exception> exception;
    JSValue returnValue = JSC::profiledCall(globalObject, JSC::ProfilingReason::API, callbackObject, callData, jsUndefined(), args, exception);
    if (exception) {
        auto* ptr = exception.get();
        exception.clear();
        return JSValue::encode(ptr);
    }

    return JSValue::encode(returnValue);
}

template<bool isSSL>
static void writeResponseHeader(uWS::HttpResponse<isSSL>* res, const WTF::StringView& name, const WTF::StringView& value)
{
    WTF::CString nameStr;
    WTF::CString valueStr;

    std::string_view nameView;
    std::string_view valueView;

    if (name.is8Bit()) {
        const auto nameSpan = name.span8();
        ASSERT(name.containsOnlyASCII());
        nameView = std::string_view(reinterpret_cast<const char*>(nameSpan.data()), nameSpan.size());
    } else {
        nameStr = name.utf8();
        nameView = std::string_view(nameStr.data(), nameStr.length());
    }

    if (value.is8Bit()) {
        const auto valueSpan = value.span8();
        valueView = std::string_view(reinterpret_cast<const char*>(valueSpan.data()), valueSpan.size());
    } else {
        valueStr = value.utf8();
        valueView = std::string_view(valueStr.data(), valueStr.length());
    }

    res->writeHeader(nameView, valueView);
}

template<bool isSSL>
static void writeFetchHeadersToUWSResponse(WebCore::FetchHeaders& headers, uWS::HttpResponse<isSSL>* res)
{
    auto& internalHeaders = headers.internalHeaders();

    for (auto& value : internalHeaders.getSetCookieHeaders()) {

        if (value.is8Bit()) {
            const auto valueSpan = value.span8();
            res->writeHeader(std::string_view("set-cookie", 10), std::string_view(reinterpret_cast<const char*>(valueSpan.data()), valueSpan.size()));
        } else {
            WTF::CString valueStr = value.utf8();
            res->writeHeader(std::string_view("set-cookie", 10), std::string_view(valueStr.data(), valueStr.length()));
        }
    }

    auto* data = res->getHttpResponseData();

    for (const auto& header : internalHeaders.commonHeaders()) {

        const auto& name = WebCore::httpHeaderNameString(header.key);
        const auto& value = header.value;

        // We have to tell uWS not to automatically insert a TransferEncoding or Date header.
        // Otherwise, you get this when using Fastify;
        //
        // ❯ curl http://localhost:3000 --verbose
        // *   Trying [::1]:3000...
        // * Connected to localhost (::1) port 3000
        // > GET / HTTP/1.1
        // > Host: localhost:3000
        // > User-Agent: curl/8.4.0
        // > Accept: */*
        // >
        // < HTTP/1.1 200 OK
        // < Content-Type: application/json; charset=utf-8
        // < Content-Length: 17
        // < Date: Sun, 06 Oct 2024 13:37:01 GMT
        // < Transfer-Encoding: chunked
        // <
        //
        if (header.key == WebCore::HTTPHeaderName::ContentLength) {
            if (!(data->state & uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
                data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                res->writeMark();
            }
        }
        writeResponseHeader<isSSL>(res, name, value);
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        const auto& name = header.key;
        const auto& value = header.value;

        writeResponseHeader<isSSL>(res, name, value);
    }
}

template<bool isSSL>
static void NodeHTTPServer__writeHead(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<isSSL>* response)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* headersObject = headersObjectValue.getObject();
    response->writeStatus(std::string_view(statusMessage, statusMessageLength));

    if (headersObject) {
        if (auto* fetchHeaders = jsDynamicCast<WebCore::JSFetchHeaders*>(headersObject)) {
            writeFetchHeadersToUWSResponse<isSSL>(fetchHeaders->wrapped(), response);
            return;
        }

        if (UNLIKELY(headersObject->hasNonReifiedStaticProperties())) {
            headersObject->reifyAllStaticProperties(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
        }

        auto* structure = headersObject->structure();

        if (structure->canPerformFastPropertyEnumeration()) {
            structure->forEachProperty(vm, [&](const auto& entry) {
                JSValue headerValue = headersObject->getDirect(entry.offset());
                if (!headerValue.isString()) {

                    return true;
                }

                String key = entry.key();
                String value = headerValue.toWTFString(globalObject);
                if (scope.exception()) {
                    return false;
                }

                writeResponseHeader<isSSL>(response, key, value);

                return true;
            });
        } else {
            PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            headersObject->getOwnPropertyNames(headersObject, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, void());

            for (unsigned i = 0; i < propertyNames.size(); ++i) {
                JSValue headerValue = headersObject->getIfPropertyExists(globalObject, propertyNames[i]);
                if (!headerValue.isString()) {
                    continue;
                }

                String key = propertyNames[i].string();
                String value = headerValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, void());
                writeResponseHeader<isSSL>(response, key, value);
            }
        }
    }

    RELEASE_AND_RETURN(scope, void());
}

extern "C" void NodeHTTPServer__writeHead_http(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<false>* response)
{
    return NodeHTTPServer__writeHead<false>(globalObject, statusMessage, statusMessageLength, headersObjectValue, response);
}

extern "C" void NodeHTTPServer__writeHead_https(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<true>* response)
{
    return NodeHTTPServer__writeHead<true>(globalObject, statusMessage, statusMessageLength, headersObjectValue, response);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_http(
    size_t any_server,
    JSC::JSGlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    uWS::HttpRequest* request,
    uWS::HttpResponse<false>* response,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<false>(any_server, globalObject, JSValue::decode(thisValue), JSValue::decode(callback), request, response, nodeHttpResponsePtr);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_https(
    size_t any_server,
    JSC::JSGlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    uWS::HttpRequest* request,
    uWS::HttpResponse<true>* response,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<true>(any_server, globalObject, JSValue::decode(thisValue), JSValue::decode(callback), request, response, nodeHttpResponsePtr);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignHeaders, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSObject* objectValue = callFrame->uncheckedArgument(1).getObject();
    JSC::InternalFieldTuple* tuple = jsCast<JSC::InternalFieldTuple*>(callFrame->uncheckedArgument(2));
    ASSERT(callFrame->argumentCount() == 3);

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

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignEventCallback, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSValue callback = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        Request__setInternalEventCallback(jsRequest->wrapped(), JSValue::encode(callback), globalObject);
    }

    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetTimeout, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSValue seconds = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        Request__setTimeout(jsRequest->wrapped(), JSValue::encode(seconds), globalObject);
    }

    if (auto* nodeHttpResponse = jsDynamicCast<WebCore::JSNodeHTTPResponse*>(requestValue)) {
        NodeHTTPResponse__setTimeout(nodeHttpResponse->wrapped(), JSValue::encode(seconds), globalObject);
    }

    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsHTTPSetServerIdleTimeout, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue seconds = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    Server__setIdleTimeout(JSValue::encode(serverValue), JSValue::encode(seconds), globalObject);

    return JSValue::encode(jsUndefined());
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
                    RETURN_IF_EXCEPTION(scope, {});
                }
                for (unsigned i = 1; i < length; ++i) {
                    JSValue value = array->getIndex(globalObject, i);
                    if (UNLIKELY(scope.exception()))
                        return JSValue::encode(jsUndefined());
                    if (!value.isString())
                        continue;
                    impl->append(name, value.getString(globalObject));
                    RETURN_IF_EXCEPTION(scope, {});
                }
                RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
                return JSValue::encode(jsUndefined());
            }

            impl->set(name, valueValue.getString(globalObject));
            RETURN_IF_EXCEPTION(scope, {});
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
        JSC::JSFunction::create(vm, globalObject, 3, "setHeader"_s, jsHTTPSetHeader, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getHeader"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "getHeader"_s, jsHTTPGetHeader, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignHeaders"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "assignHeaders"_s, jsHTTPAssignHeaders, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignEventCallback"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "assignEventCallback"_s, jsHTTPAssignEventCallback, ImplementationVisibility::Public), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setRequestTimeout"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setRequestTimeout"_s, jsHTTPSetTimeout, ImplementationVisibility::Public), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerIdleTimeout"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setServerIdleTimeout"_s, jsHTTPSetServerIdleTimeout, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Response"_s)),
        globalObject->JSResponseConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Request"_s)),
        globalObject->JSRequestConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Blob"_s)),
        globalObject->JSBlobConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Headers"_s)),
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "headersTuple"_s)),
        JSC::InternalFieldTuple::create(vm, globalObject->m_internalFieldTupleStructure.get()), 0);
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "webRequestOrResponseHasBodyValue"_s)),
        1, jsFunctionRequestOrResponseHasBodyValue, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);

    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "getCompleteWebRequestOrResponseBodyValueAsArrayBuffer"_s)),
        1, jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
    return obj;
}

extern "C" void WebCore__FetchHeaders__toUWSResponse(WebCore::FetchHeaders* arg0, bool is_ssl, void* arg2)
{
    if (is_ssl) {
        writeFetchHeadersToUWSResponse<true>(*arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
    } else {
        writeFetchHeadersToUWSResponse<false>(*arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
    }
}

} // namespace Bun
