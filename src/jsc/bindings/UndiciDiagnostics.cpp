#include "root.h"
#include "UndiciDiagnostics.h"

#include "ZigGlobalObject.h"
#include "InternalModuleRegistry.h"
#include "webcore/WebSocket.h"
#include "webcore/JSWebSocket.h"
#include "JSBuffer.h"
#include <JavaScriptCore/Error.h>

namespace Bun {

using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsNotifyUndiciSubscribed, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* global = defaultGlobalObject(globalObject);
    global->hasUndiciDiagnosticsSubscriber = true;
    // Eagerly load the helper module while the just-subscribed Channel is
    // still on markActive()'s stack, so its module-scope dc.channel()
    // constants pin it. diagnostics_channel's WeakReference.incRef() is a bare
    // counter without GC effect, so without this the Channel could otherwise
    // be collected before the first fetch() resolves it.
    global->m_undiciDiagnosticsModule.getInitializedOnMainThread(global);
    return JSValue::encode(jsUndefined());
}

namespace UndiciDiagnostics {

bool hasSubscriber(Zig::GlobalObject* globalObject)
{
    return globalObject->hasUndiciDiagnosticsSubscriber;
}

static JSFunction* getHelper(Zig::GlobalObject* globalObject, const ASCIILiteral& name)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* mod = globalObject->m_undiciDiagnosticsModule.getInitializedOnMainThread(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!mod) [[unlikely]]
        return nullptr;
    JSValue fn = mod->getIfPropertyExists(globalObject, Identifier::fromString(vm, name));
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!fn)
        return nullptr;
    return dynamicDowncast<JSFunction>(fn);
}

static JSValue callHelper(Zig::GlobalObject* globalObject, const ASCIILiteral& name, const ArgList& args)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSFunction* fn = getHelper(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (!fn) [[unlikely]]
        return jsUndefined();
    auto callData = JSC::getCallData(fn);
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, fn, callData, jsUndefined(), args));
}

static JSValue callHelperNoThrow(Zig::GlobalObject* globalObject, const ASCIILiteral& name, const ArgList& args)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue result = callHelper(globalObject, name, args);
    if (auto* exception = scope.exception()) [[unlikely]] {
        // Subscribers throwing must not break fetch()/WebSocket; diagnostics_channel
        // itself catches inside publish(), but module load or property access can
        // still throw under very unusual conditions.
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        return jsUndefined();
    }
    return result;
}

void publishWebSocketOpen(JSC::JSGlobalObject* lexicalGlobalObject, WebCore::WebSocket& ws, const WTF::String& protocol, const WTF::String& extensions)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!hasSubscriber(globalObject))
        return;
    auto& vm = globalObject->vm();
    MarkedArgumentBuffer args;
    args.append(WebCore::toJS(globalObject, reinterpret_cast<WebCore::JSDOMGlobalObject*>(globalObject), ws));
    args.append(jsString(vm, protocol));
    args.append(jsString(vm, extensions));
    callHelperNoThrow(globalObject, "wsOpen"_s, args);
}

void publishWebSocketClose(JSC::JSGlobalObject* lexicalGlobalObject, WebCore::WebSocket& ws, unsigned short code, const WTF::String& reason)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!hasSubscriber(globalObject))
        return;
    auto& vm = globalObject->vm();
    MarkedArgumentBuffer args;
    args.append(WebCore::toJS(globalObject, reinterpret_cast<WebCore::JSDOMGlobalObject*>(globalObject), ws));
    args.append(jsNumber(code));
    args.append(jsString(vm, reason));
    callHelperNoThrow(globalObject, "wsClose"_s, args);
}

void publishWebSocketError(JSC::JSGlobalObject* lexicalGlobalObject, const WTF::String& message)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!hasSubscriber(globalObject))
        return;
    MarkedArgumentBuffer args;
    args.append(createError(globalObject, message));
    callHelperNoThrow(globalObject, "wsError"_s, args);
}

void publishWebSocketPingPong(JSC::JSGlobalObject* lexicalGlobalObject, bool isPong, std::span<const uint8_t> payload)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!hasSubscriber(globalObject))
        return;
    MarkedArgumentBuffer args;
    args.append(Bun::createBuffer(globalObject, payload));
    callHelperNoThrow(globalObject, isPong ? "wsPong"_s : "wsPing"_s, args);
}

}
}

using namespace JSC;

extern "C" [[ZIG_EXPORT(nothrow)]] bool Bun__undiciDiagnosticsHasSubscriber(Zig::GlobalObject* globalObject)
{
    return Bun::UndiciDiagnostics::hasSubscriber(globalObject);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] EncodedJSValue Bun__undiciDiagnosticsOnCreate(Zig::GlobalObject* globalObject, EncodedJSValue origin, EncodedJSValue method, EncodedJSValue path, EncodedJSValue host, EncodedJSValue hostname, EncodedJSValue protocol, EncodedJSValue port, EncodedJSValue headers)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(origin));
    args.append(JSValue::decode(method));
    args.append(JSValue::decode(path));
    args.append(JSValue::decode(host));
    args.append(JSValue::decode(hostname));
    args.append(JSValue::decode(protocol));
    args.append(JSValue::decode(port));
    args.append(JSValue::decode(headers));
    JSValue result = Bun::UndiciDiagnostics::callHelper(globalObject, "onCreate"_s, args);
    RETURN_IF_EXCEPTION(scope, {});
    if (result.isEmpty() || result.isUndefinedOrNull())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] EncodedJSValue Bun__undiciDiagnosticsGetAddedHeaders(Zig::GlobalObject* globalObject, EncodedJSValue request)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue req = JSValue::decode(request);
    if (!req.isObject())
        return JSValue::encode(jsUndefined());
    JSValue added = req.getObject()->getIfPropertyExists(globalObject, Identifier::fromString(vm, "_added"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (!added || !added.isObject())
        return JSValue::encode(jsUndefined());
    return JSValue::encode(added);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__undiciDiagnosticsOnConnected(Zig::GlobalObject* globalObject, EncodedJSValue request)
{
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(request));
    Bun::UndiciDiagnostics::callHelperNoThrow(globalObject, "onConnected"_s, args);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__undiciDiagnosticsOnHeaders(Zig::GlobalObject* globalObject, EncodedJSValue request, int32_t statusCode, EncodedJSValue statusText, EncodedJSValue headers)
{
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(request));
    args.append(jsNumber(statusCode));
    args.append(JSValue::decode(statusText));
    args.append(JSValue::decode(headers));
    Bun::UndiciDiagnostics::callHelperNoThrow(globalObject, "onHeaders"_s, args);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__undiciDiagnosticsOnComplete(Zig::GlobalObject* globalObject, EncodedJSValue request)
{
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(request));
    Bun::UndiciDiagnostics::callHelperNoThrow(globalObject, "onComplete"_s, args);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__undiciDiagnosticsOnError(Zig::GlobalObject* globalObject, EncodedJSValue request, EncodedJSValue error)
{
    MarkedArgumentBuffer args;
    args.append(JSValue::decode(request));
    args.append(JSValue::decode(error));
    Bun::UndiciDiagnostics::callHelperNoThrow(globalObject, "onError"_s, args);
}
