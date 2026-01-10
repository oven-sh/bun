#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "helpers.h"
#include "BunClientData.h"

#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSFunction.h>
#include "wtf/URL.h"
#include "JSFetchHeaders.h"
#include "JSDOMExceptionHandling.h"
#include <bun-uws/src/App.h>
#include "ZigGeneratedClasses.h"
#include "ScriptExecutionContext.h"
#include "AsyncContextFrame.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSSocketAddressDTO.h"
#include "node/JSNodeHTTPServerSocket.h"
#include "node/JSNodeHTTPServerSocketPrototype.h"
namespace Bun {

using namespace JSC;
using namespace WebCore;

BUN_DECLARE_HOST_FUNCTION(Bun__drainMicrotasksFromJS);
BUN_DECLARE_HOST_FUNCTION(jsFunctionRequestOrResponseHasBodyValue);
BUN_DECLARE_HOST_FUNCTION(jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer);
extern "C" uWS::HttpRequest* Request__getUWSRequest(void*);
extern "C" void Request__setInternalEventCallback(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Request__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" bool NodeHTTPResponse__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Server__setIdleTimeout(EncodedJSValue, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" EncodedJSValue Server__setAppFlags(JSC::JSGlobalObject*, EncodedJSValue, bool require_host_header, bool use_strict_method_validation);
extern "C" EncodedJSValue Server__setOnClientError(JSC::JSGlobalObject*, EncodedJSValue, EncodedJSValue);
extern "C" EncodedJSValue Server__setMaxHTTPHeaderSize(JSC::JSGlobalObject*, EncodedJSValue, uint64_t);

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

static void assignHeadersFromUWebSocketsForCall(uWS::HttpRequest* request, JSValue methodString, MarkedArgumentBuffer& args, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        std::string_view fullURLStdStr = request->getFullUrl();
        String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(fullURLStdStr.data()), fullURLStdStr.length() });
        args.append(jsString(vm, WTF::move(fullURL)));
    }

    // Get the method.
    if (methodString.isUndefinedOrNull()) [[unlikely]] {
        std::string_view methodView = request->getMethod();
        WTF::String methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(methodView.data()), methodView.length() });
        args.append(jsString(vm, WTF::move(methodString)));
    } else {
        args.append(methodString);
    }

    size_t size = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        size++;
    }

    JSC::JSObject* headersObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(size, static_cast<size_t>(JSFinalObject::maxInlineCapacity)));
    RETURN_IF_EXCEPTION(scope, void());
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;
    MarkedArgumentBuffer arrayValues;

    args.append(headersObject);

    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        StringView nameView = StringView(std::span { reinterpret_cast<const Latin1Character*>(pair.first.data()), pair.first.length() });
        std::span<Latin1Character> data;
        auto value = String::createUninitialized(pair.second.length(), data);
        if (pair.second.length() > 0)
            memcpy(data.data(), pair.second.data(), pair.second.length());

        HTTPHeaderName name;

        JSString* jsValue = jsString(vm, value);

        HTTPHeaderIdentifiers& identifiers = WebCore::clientData(vm)->httpHeaderIdentifiers();
        Identifier nameIdentifier;
        JSString* nameString = nullptr;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            nameString = identifiers.stringFor(globalObject, name);
            nameIdentifier = identifiers.identifierFor(vm, name);
        } else {
            WTF::String wtfString = nameView.toString();
            nameString = jsString(vm, wtfString);
            nameIdentifier = Identifier::fromString(vm, wtfString.convertToASCIILowercase());
        }

        if (name == WebCore::HTTPHeaderName::SetCookie) {
            if (!setCookiesHeaderArray) {
                setCookiesHeaderArray = constructEmptyArray(globalObject, nullptr);
                RETURN_IF_EXCEPTION(scope, );
                setCookiesHeaderString = nameString;
                headersObject->putDirect(vm, nameIdentifier, setCookiesHeaderArray, 0);
                RETURN_IF_EXCEPTION(scope, void());
            }
            arrayValues.append(setCookiesHeaderString);
            arrayValues.append(jsValue);
            setCookiesHeaderArray->push(globalObject, jsValue);
            RETURN_IF_EXCEPTION(scope, void());

        } else {
            headersObject->putDirectMayBeIndex(globalObject, nameIdentifier, jsValue);
            RETURN_IF_EXCEPTION(scope, void());
            arrayValues.append(nameString);
            arrayValues.append(jsValue);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }

    JSC::JSArray* array;
    {

        ObjectInitializationScope initializationScope(vm);
        if ((array = JSArray::tryCreateUninitializedRestricted(initializationScope, nullptr, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), arrayValues.size()))) [[likely]] {
            EncodedJSValue* data = arrayValues.data();
            for (size_t i = 0, size = arrayValues.size(); i < size; ++i) {
                array->initializeIndex(initializationScope, i, JSValue::decode(data[i]));
            }
        } else {
            RETURN_IF_EXCEPTION(scope, );
            array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), arrayValues);
            RETURN_IF_EXCEPTION(scope, );
        }
    }

    args.append(array);
}

// This is an 8% speedup.
static EncodedJSValue assignHeadersFromUWebSockets(uWS::HttpRequest* request, JSObject* prototype, JSObject* objectValue, JSC::InternalFieldTuple* tuple, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    {
        std::string_view fullURLStdStr = request->getFullUrl();
        String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(fullURLStdStr.data()), fullURLStdStr.length() });
        PutPropertySlot slot(objectValue, false);
        objectValue->put(objectValue, globalObject, builtinNames.urlPublicName(), jsString(vm, WTF::move(fullURL)), slot);
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
            methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(methodView.data()), methodView.length() });
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
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;

    unsigned i = 0;

    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        StringView nameView = StringView(std::span { reinterpret_cast<const Latin1Character*>(pair.first.data()), pair.first.length() });
        std::span<Latin1Character> data;
        auto value = String::tryCreateUninitialized(pair.second.length(), data);
        if (value.isNull()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        if (pair.second.length() > 0)
            memcpy(data.data(), pair.second.data(), pair.second.length());

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
                RETURN_IF_EXCEPTION(scope, {});
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

template<bool isSSL>
static void assignOnNodeJSCompat(uWS::TemplatedApp<isSSL>* app)
{
    app->setOnSocketClosed([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onClose();
    });
    app->setOnSocketDrain([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onDrain();
    });
    app->setOnSocketData([](void* socketData, int is_ssl, struct us_socket_t* rawSocket, const char* data, int length, bool last) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onData(data, length, last);
    });
    app->setOnSocketUpgraded([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        // the socket is adopted and might not be the same as the rawSocket
        socket->socket = rawSocket;
        socket->upgraded = true;
    });
}

extern "C" void NodeHTTP_assignOnNodeJSCompat(bool is_ssl, void* uws_app)
{
    if (is_ssl) {
        assignOnNodeJSCompat<true>(reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app));
    } else {
        assignOnNodeJSCompat<false>(reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app));
    }
}

extern "C" void NodeHTTP_setUsingCustomExpectHandler(bool is_ssl, void* uws_app, bool value)
{
    if (is_ssl) {
        reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app)->setUsingCustomExpectHandler(value);
    } else {
        reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app)->setUsingCustomExpectHandler(value);
    }
}

extern "C" EncodedJSValue NodeHTTPResponse__createForJS(size_t any_server, JSC::JSGlobalObject* globalObject, bool* hasBody, uWS::HttpRequest* request, int isSSL, void* response_ptr, void* upgrade_ctx, void** nodeHttpResponsePtr);

template<bool isSSL>
static EncodedJSValue NodeHTTPServer__onRequest(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    JSValue thisValue,
    JSValue callback,
    JSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<isSSL>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* callbackObject = jsCast<JSObject*>(callback);
    MarkedArgumentBuffer args;
    args.append(thisValue);

    assignHeadersFromUWebSocketsForCall(request, methodString, args, globalObject, vm);
    RETURN_IF_EXCEPTION(scope, {});

    bool hasBody = false;
    WebCore::JSNodeHTTPResponse* nodeHTTPResponseObject = jsCast<WebCore::JSNodeHTTPResponse*>(JSValue::decode(NodeHTTPResponse__createForJS(any_server, globalObject, &hasBody, request, isSSL, response, upgrade_ctx, nodeHttpResponsePtr)));

    args.append(nodeHTTPResponseObject);
    args.append(jsBoolean(hasBody));

    auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(response->getHttpResponseData()->socketData);

    if (currentSocketDataPtr) {
        auto* thisSocket = jsCast<JSNodeHTTPServerSocket*>(currentSocketDataPtr);
        thisSocket->currentResponseObject.set(vm, thisSocket, nodeHTTPResponseObject);
        args.append(thisSocket);
        args.append(jsBoolean(false));
        if (thisSocket->m_duplex) {
            args.append(thisSocket->m_duplex.get());
        } else {
            args.append(jsUndefined());
        }
    } else {
        JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(vm, globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject), (us_socket_t*)response, isSSL, nodeHTTPResponseObject);

        socket->strongThis.set(vm, socket);

        response->getHttpResponseData()->socketData = socket;

        args.append(socket);
        args.append(jsBoolean(true));
        args.append(jsUndefined());
    }
    args.append(jsBoolean(request->isAncient()));

    // Pass pipelined data (head buffer) for Node.js compat (connect/upgrade events)
    if (!request->head.empty()) {
        JSC::JSUint8Array* headBuffer = WebCore::createBuffer(globalObject, std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(request->head.data()), request->head.size()));
        RETURN_IF_EXCEPTION(scope, {});
        args.append(headBuffer);
    } else {
        args.append(jsUndefined());
    }

    JSValue returnValue = AsyncContextFrame::profiledCall(globalObject, callbackObject, jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});

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

        // Prevent automatic Date header insertion when user provides one
        if (header.key == WebCore::HTTPHeaderName::Date) {
            data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_DATE_HEADER;
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
    if (response->getLoopData()->canCork() && response->getBufferedAmount() == 0) {
        response->getLoopData()->setCorkedSocket(response, isSSL);
    }
    response->writeStatus(std::string_view(statusMessage, statusMessageLength));

    if (headersObject) {
        if (auto* fetchHeaders = jsDynamicCast<WebCore::JSFetchHeaders*>(headersObject)) {
            writeFetchHeadersToUWSResponse<isSSL>(fetchHeaders->wrapped(), response);
            return;
        }

        if (headersObject->hasNonReifiedStaticProperties()) [[unlikely]] {
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
                RETURN_IF_EXCEPTION(scope, false);

                writeResponseHeader<isSSL>(response, key, value);

                return true;
            });
        } else {
            PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            headersObject->getOwnPropertyNames(headersObject, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, void());

            for (unsigned i = 0; i < propertyNames.size(); ++i) {
                JSValue headerValue = headersObject->getIfPropertyExists(globalObject, propertyNames[i]);
                RETURN_IF_EXCEPTION(scope, );
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
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<false>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<false>(
        any_server,
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        upgrade_ctx,
        nodeHttpResponsePtr);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_https(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<true>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<true>(
        any_server,
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        upgrade_ctx,
        nodeHttpResponsePtr);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignHeaders, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
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

                RELEASE_AND_RETURN(scope, assignHeadersFromFetchHeaders(impl, globalObject->objectPrototype(), objectValue, tuple, globalObject, vm));
            }
        }
    }

    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignEventCallback, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
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
    auto& vm = JSC::getVM(globalObject);
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
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue seconds = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    Server__setIdleTimeout(JSValue::encode(serverValue), JSValue::encode(seconds), globalObject);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetCustomOptions, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(callFrame->argumentCount() == 5);
    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue requireHostHeader = callFrame->uncheckedArgument(1);
    JSValue useStrictMethodValidation = callFrame->uncheckedArgument(2);
    JSValue maxHeaderSize = callFrame->uncheckedArgument(3);
    JSValue callback = callFrame->uncheckedArgument(4);

    double maxHeaderSizeNumber = maxHeaderSize.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setAppFlags(globalObject, JSValue::encode(serverValue), requireHostHeader.toBoolean(globalObject), useStrictMethodValidation.toBoolean(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    Server__setMaxHTTPHeaderSize(globalObject, JSValue::encode(serverValue), maxHeaderSizeNumber);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setOnClientError(globalObject, JSValue::encode(serverValue), JSValue::encode(callback));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPGetHeader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
        JSValue nameValue = callFrame->argument(1);
        if (nameValue.isString()) {
            FetchHeaders* impl = &headers->wrapped();
            JSString* nameString = nameValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            const auto name = nameString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (WTF::equalIgnoringASCIICase(name, "set-cookie"_s)) {
                RELEASE_AND_RETURN(scope, fetchHeadersGetSetCookie(globalObject, vm, impl));
            }

            WebCore::ExceptionOr<String> res = impl->get(name);
            if (res.hasException()) {
                WebCore::propagateException(globalObject, scope, res.releaseException());
                RELEASE_AND_RETURN(scope, {});
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
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);
    JSValue nameValue = callFrame->argument(1);
    JSValue valueValue = callFrame->argument(2);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {

        if (nameValue.isString()) {
            String name = nameValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            FetchHeaders* impl = &headers->wrapped();

            if (valueValue.isUndefined())
                return JSValue::encode(jsUndefined());

            if (isArray(globalObject, valueValue)) {
                auto* array = jsCast<JSArray*>(valueValue);
                unsigned length = array->length();
                if (length > 0) {
                    JSValue item = array->getIndex(globalObject, 0);
                    RETURN_IF_EXCEPTION(scope, {});
                    auto value = item.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    impl->set(name, value);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                for (unsigned i = 1; i < length; ++i) {
                    JSValue value = array->getIndex(globalObject, i);
                    RETURN_IF_EXCEPTION(scope, {});
                    auto string = value.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    impl->append(name, string);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
                return JSValue::encode(jsUndefined());
            }

            auto value = valueValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            impl->set(name, value);
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
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerCustomOptions"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setServerCustomOptions"_s, jsHTTPSetCustomOptions, ImplementationVisibility::Public), 0);
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
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "drainMicrotasks"_s)),
        0, Bun__drainMicrotasksFromJS, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);

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
