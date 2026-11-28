// What a WebSocket publishes to node:diagnostics_channel. See internal/undici_channels.ts.

#include "config.h"
#include "WebSocket.h"

#include "AsyncContextFrame.h"
#include "BunString.h"
#include "JSBuffer.h"
#include "JSDOMExceptionHandling.h"
#include "JSWebSocket.h"
#include "ModuleGraph.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include <wtf/CryptographicallyRandomNumber.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/Base64.h>

extern "C" JSC::EncodedJSValue Bun__socketReadErrorFromCloseCode(JSC::JSGlobalObject*, int code);

namespace WebCore {

using namespace JSC;
using Bun::DiagnosticsHook;
using Bun::RequestEvent;
using Bun::WebSocketEvent;

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(WebSocket::SentRequest);
WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(WebSocket::AcceptedHandshake);

static JSValue jsEvent(auto event)
{
    return jsNumber(static_cast<uint8_t>(event));
}

static JSArray* jsFields(JSGlobalObject* globalObject, std::span<const String> fields)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* array = constructEmptyArray(globalObject, nullptr, fields.size());
    RETURN_IF_EXCEPTION(scope, nullptr);
    for (size_t i = 0; i < fields.size(); ++i) {
        array->putDirectIndex(globalObject, i, jsString(vm, fields[i]));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return array;
}

static JSArray* jsBuffers(JSGlobalObject* globalObject, std::span<const String> latin1Fields)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSArray* array = constructEmptyArray(globalObject, nullptr, latin1Fields.size());
    RETURN_IF_EXCEPTION(scope, nullptr);
    for (size_t i = 0; i < latin1Fields.size(); ++i) {
        auto* buffer = createBuffer(globalObject, byteCast<uint8_t>(latin1Fields[i].span8()));
        RETURN_IF_EXCEPTION(scope, nullptr);
        array->putDirectIndex(globalObject, i, buffer);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return array;
}

static void appendAddress(VM& vm, MarkedArgumentBuffer& arguments, const std::optional<WebSocket::RemoteAddress>& address)
{
    arguments.append(address ? jsString(vm, address->address) : jsUndefined());
    arguments.append(address ? jsNumber(address->port) : jsUndefined());
}

std::optional<WebSocket::RemoteAddress> WebSocket::addressOfSocket(us_socket_t* socket, bool isLocal)
{
    Bun::OwnedString address;
    uint16_t port = 0;
    if (!socket || !Bun__WebSocket__addressOfSocket(socket, isLocal, &address, &port))
        return std::nullopt;
    return RemoteAddress { address.transferToWTFString(), port };
}

JSObject* WebSocket::diagnosticsHook() const
{
    auto* context = scriptExecutionContext();
    if (!context || isWsMode() || !wrapper())
        return nullptr;
    return defaultGlobalObject(context->jsGlobalObject())->diagnosticsHook(DiagnosticsHook::WebSocket);
}

void WebSocket::callInContext(JSValue function, const ArgList& arguments)
{
    RefPtr context = scriptExecutionContext();
    if (!context || context->isJSExecutionForbidden() || (context->isForModuleGraph() && context->isStopped()))
        return;

    auto* globalObject = context->jsGlobalObject();
    JSLockHolder lock(context->vm());
    Ref protectedThis { *this };
    AsyncContextScope asyncContext(globalObject, m_asyncContext.getValue());
    Bun::ModuleGraphContextScope moduleGraphContext(*context);
    NakedPtr<JSC::Exception> exception;
    profiledCall(globalObject, ProfilingReason::Other, function, getCallData(function), jsUndefined(), arguments, exception);
    if (exception)
        reportException(globalObject, exception.get());
}

JSValue WebSocket::createRequestTracer(ScriptExecutionContext& context)
{
    auto* globalObject = defaultGlobalObject(context.jsGlobalObject());
    JSObject* hook = globalObject->diagnosticsHook(DiagnosticsHook::Request);
    if (!hook || context.isStopped()) [[likely]]
        return {};
    return call(globalObject, hook, getCallData(hook), jsUndefined(), ArgList());
}

ExceptionOr<void> WebSocket::publishRequest(const WebSocketOptions& options, const String& host, const String& resource, const String& protocols, const String& authorization, Vector<String, 8>& names, Vector<String, 8>& values)
{
    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto has = [&](ASCIILiteral name) {
        return names.containsIf([&](auto& other) { return equalIgnoringASCIICase(other, name); });
    };
    if (!has("Sec-WebSocket-Key"_s)) {
        std::array<uint8_t, 16> nonce;
        cryptographicallyRandomValues(std::span { nonce });
        names.append("Sec-WebSocket-Key"_s);
        values.append(base64EncodeToString(std::span<const uint8_t> { nonce }));
    }

    Vector<String> fields;
    for (size_t i = 0; i < names.size(); ++i)
        fields.appendList({ names[i], values[i] });
    // What build_request_body() in WebSocketUpgradeClient.rs adds.
    auto appendDefault = [&](ASCIILiteral name, const String& value) {
        if (!value.isEmpty() && !has(name))
            fields.appendList({ String(name), value });
    };
    appendDefault("Upgrade"_s, "websocket"_s);
    appendDefault("Sec-WebSocket-Version"_s, "13"_s);
    appendDefault("Sec-WebSocket-Extensions"_s, options.extensions);
    appendDefault("Sec-WebSocket-Protocol"_s, protocols);
    appendDefault("Authorization"_s, authorization);

    auto scheme = m_url.protocol().startsWith("wss"_s) ? "https://"_s : "http://"_s;
    JSArray* array = jsFields(globalObject, fields.span());
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(RequestEvent::Create));
    arguments.append(jsNontrivialString(vm, "GET"_s));
    arguments.append(jsString(vm, makeString(scheme, m_url.host().isEmpty() ? host : m_url.hostAndPort())));
    arguments.append(jsString(vm, resource));
    arguments.append(array);
    arguments.append(jsBoolean(false));
    arguments.append(jsNull());
    auto callData = getCallData(options.requestTracer);
    JSValue changed = call(globalObject, options.requestTracer, callData, jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });

    // writeFields() has validated them.
    if (auto* changedFields = dynamicDowncast<JSArray>(changed)) {
        names.clear();
        values.clear();
        for (unsigned i = 0; i < changedFields->length(); ++i) {
            JSValue field = changedFields->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            auto text = field.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
            (i % 2 ? values : names).append(WTF::move(text));
        }
    }

    arguments.clear();
    arguments.append(jsEvent(RequestEvent::Connecting));
    call(globalObject, options.requestTracer, callData, jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, Exception { ExistingExceptionError });
    return {};
}

void WebSocket::willSendRequest(std::span<const uint8_t> request, us_socket_t* socket)
{
    if (!m_requestTracer || request.size() < 2) [[likely]]
        return;
    // The end of a TLS renegotiation gets here too.
    if (std::exchange(m_didSendRequest, true))
        return;

    m_sentRequest = makeUnique<SentRequest>(String { byteCast<Latin1Character>(request.first(request.size() - 2)) }, addressOfSocket(socket, false), addressOfSocket(socket, true));
    queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [](WebSocket& ws) {
        ws.publishSentRequest();
    });
}

void WebSocket::publishSentRequest()
{
    auto request = std::exchange(m_sentRequest, nullptr);
    if (!request || !m_requestTracer)
        return;

    auto& vm = scriptExecutionContext()->vm();
    EnsureStillAliveScope tracer = m_requestTracer.getValue();
    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(RequestEvent::HeadSent));
    arguments.append(jsString(vm, request->head));
    arguments.append(jsNumber(1));
    appendAddress(vm, arguments, request->remoteAddress);
    appendAddress(vm, arguments, request->localAddress);
    callInContext(tracer.value(), arguments);

    arguments.clear();
    arguments.append(jsEvent(RequestEvent::BodySent));
    callInContext(tracer.value(), arguments);
}

void WebSocket::publishResponse(uint16_t statusCode, std::span<const uint8_t> statusMessage, std::span<const HandshakeRawHeader> headers)
{
    bool keepsResponse = statusCode == 101 && diagnosticsHook();
    if (!keepsResponse && !m_requestTracer) [[likely]]
        return;

    String statusText = String::fromUTF8ReplacingInvalidSequences(byteCast<Latin1Character>(statusMessage));
    Vector<String> fields;
    for (auto& header : headers)
        fields.appendList({ String(byteCast<Latin1Character>(header.name.span())), String(byteCast<Latin1Character>(header.value.span())) });
    if (keepsResponse)
        m_acceptedHandshake = makeUnique<AcceptedHandshake>(statusText, fields);
    // The response can arrive in the read that ends the TLS handshake.
    publishSentRequest();
    if (!m_requestTracer)
        return;

    EnsureStillAliveScope tracer = m_requestTracer.getValue();
    m_requestTracer.clear();

    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSArray* array = jsBuffers(globalObject, fields.span());
    if (scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(RequestEvent::ResponseHead));
    arguments.append(jsNumber(statusCode));
    arguments.append(jsString(vm, statusText));
    arguments.append(array);
    callInContext(tracer.value(), arguments);

    arguments.clear();
    arguments.append(jsEvent(RequestEvent::ResponseEnd));
    callInContext(tracer.value(), arguments);
}

void WebSocket::publishRequestError(const Failure& failure, JSValue error)
{
    if (!m_requestTracer) [[likely]]
        return;

    EnsureStillAliveScope tracer = m_requestTracer.getValue();
    m_requestTracer.clear();

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(RequestEvent::Error));
    arguments.append(failure.isCancellation ? createDOMException(scriptExecutionContext()->jsGlobalObject(), AbortError, "The operation was aborted."_s) : error);
    arguments.append(jsBoolean(failure.isCancellation));
    callInContext(tracer.value(), arguments);
}

void WebSocket::publishOpen()
{
    auto handshake = std::exchange(m_acceptedHandshake, nullptr);
    JSObject* hook = handshake ? diagnosticsHook() : nullptr;
    if (!hook) [[likely]]
        return;

    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (scope.exception()) [[unlikely]]
        return;
    JSArray* array = jsFields(globalObject, handshake->fields.span());
    if (scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        return;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(WebSocketEvent::Open));
    arguments.append(wrapper());
    arguments.append(jsNumber(101));
    arguments.append(jsString(vm, handshake->statusText));
    arguments.append(array);
    appendAddress(vm, arguments, handshake->localAddress);
    callInContext(hook, arguments);
}

void WebSocket::publishClose(unsigned short code, const String& reason)
{
    JSObject* hook = diagnosticsHook();
    if (!hook) [[likely]]
        return;

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(WebSocketEvent::Close));
    arguments.append(wrapper());
    arguments.append(jsNumber(code));
    arguments.append(jsString(scriptExecutionContext()->vm(), reason));
    callInContext(hook, arguments);
}

void WebSocket::publishPingOrPong(Opcode opcode, JSValue payload)
{
    JSObject* hook = diagnosticsHook();
    if (!hook)
        return;

    MarkedArgumentBuffer arguments;
    arguments.append(jsEvent(opcode == Opcode::Ping ? WebSocketEvent::Ping : WebSocketEvent::Pong));
    arguments.append(wrapper());
    arguments.append(payload);
    callInContext(hook, arguments);
}

void WebSocket::socketDidFail(int32_t closeCode, bool isWrite, String&& tlsReason)
{
    if (!diagnosticsHook()) [[likely]]
        return;

    queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [closeCode, isWrite, tlsReason = WTF::move(tlsReason)](WebSocket& ws) {
        JSObject* hook = ws.diagnosticsHook();
        if (!hook)
            return;

        auto* globalObject = ws.scriptExecutionContext()->jsGlobalObject();
        auto& vm = getVM(globalObject);
        MarkedArgumentBuffer arguments;
        arguments.append(jsEvent(closeCode ? WebSocketEvent::SocketError : WebSocketEvent::TLSError));
        arguments.append(ws.wrapper());
        if (closeCode) {
            arguments.append(JSValue::decode(Bun__socketReadErrorFromCloseCode(globalObject, closeCode)));
            arguments.append(jsNontrivialString(vm, isWrite ? "write"_s : "read"_s));
        } else
            arguments.append(jsString(vm, tlsReason));
        ws.callInContext(hook, arguments);
    });
}

} // namespace WebCore
