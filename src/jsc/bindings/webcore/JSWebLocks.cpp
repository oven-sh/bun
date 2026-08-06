#include "config.h"
#include "JSWebLocks.h"

#include "BunWebLocksRegistry.h"
#include "ErrorCode.h"
#include "InternalModuleRegistry.h"
#include "JSAbortSignal.h"
#include "JSDOMExceptionHandling.h"
#include "ScriptExecutionContext.h"
#include "Worker.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/ProcessID.h>
#include <wtf/text/MakeString.h>

extern "C" WebCore::Worker* WebWorker__getParentWorker(void* bunVM);
extern "C" void JSC__JSGlobalObject__queueMicrotaskJob(JSC::JSGlobalObject*, JSC::EncodedJSValue job, JSC::EncodedJSValue arg0, JSC::EncodedJSValue arg1);

namespace WebCore {

using namespace JSC;

// ---------------------------------------------------------------------------
// JSWebLock

const ClassInfo JSWebLock::s_info = { "Lock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebLock) };
const ClassInfo JSWebLockPrototype::s_info = { "Lock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebLockPrototype) };
const ClassInfo JSWebLockIllegalConstructor::s_info = { "Lock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebLockIllegalConstructor) };
const ClassInfo JSWebLockManager::s_info = { "LockManager"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebLockManager) };
const ClassInfo JSWebLockManagerPrototype::s_info = { "LockManager"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebLockManagerPrototype) };

JSWebLock* JSWebLock::create(VM& vm, Structure* structure, JSString* name, bool exclusive)
{
    JSWebLock* lock = new (NotNull, allocateCell<JSWebLock>(vm)) JSWebLock(vm, structure);
    lock->finishCreation(vm, name, exclusive);
    return lock;
}

Structure* JSWebLock::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void JSWebLock::finishCreation(VM& vm, JSString* name, bool exclusive)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_name.set(vm, this, name);
    m_exclusive = exclusive;
}

template<typename Visitor>
void JSWebLock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWebLock* thisObject = uncheckedDowncast<JSWebLock>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_name);
}
DEFINE_VISIT_CHILDREN(JSWebLock);

static JSString* lockModeString(VM& vm, bool exclusive)
{
    return jsNontrivialString(vm, exclusive ? "exclusive"_s : "shared"_s);
}

JSC_DEFINE_CUSTOM_GETTER(jsWebLockGetterName, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSWebLock>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Lock"_s);
    return JSValue::encode(thisObject->name());
}

JSC_DEFINE_CUSTOM_GETTER(jsWebLockGetterMode, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSWebLock>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "Lock"_s);
    return JSValue::encode(lockModeString(vm, thisObject->exclusive()));
}

static const HashTableValue JSWebLockPrototypeValues[] = {
    { "name"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebLockGetterName, 0 } },
    { "mode"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebLockGetterMode, 0 } },
};

JSWebLockPrototype* JSWebLockPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSWebLockPrototype* prototype = new (NotNull, allocateCell<JSWebLockPrototype>(vm)) JSWebLockPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSWebLockPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void JSWebLockPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWebLock::info(), JSWebLockPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ---------------------------------------------------------------------------
// Illegal constructor shared by Lock and LockManager

JSWebLockIllegalConstructor* JSWebLockIllegalConstructor::create(VM& vm, Structure* structure, JSObject* prototype, ASCIILiteral name)
{
    JSWebLockIllegalConstructor* constructor = new (NotNull, allocateCell<JSWebLockIllegalConstructor>(vm)) JSWebLockIllegalConstructor(vm, structure);
    constructor->finishCreation(vm, prototype, name);
    return constructor;
}

void JSWebLockIllegalConstructor::finishCreation(VM& vm, JSObject* prototype, ASCIILiteral name)
{
    Base::finishCreation(vm, 0, name, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSWebLockIllegalConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSWebLockIllegalConstructor::construct(JSGlobalObject* globalObject, CallFrame*)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

// ---------------------------------------------------------------------------
// JSWebLockManager

JSWebLockManager* JSWebLockManager::create(VM& vm, Structure* structure)
{
    JSWebLockManager* manager = new (NotNull, allocateCell<JSWebLockManager>(vm)) JSWebLockManager(vm, structure);
    manager->finishCreation(vm);
    return manager;
}

Structure* JSWebLockManager::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

static const HashTableValue JSWebLockManagerPrototypeValues[] = {
    { "request"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, Bun::jsWebLockManagerRequest, 2 } },
    { "query"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, Bun::jsWebLockManagerQuery, 0 } },
};

JSWebLockManagerPrototype* JSWebLockManagerPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    JSWebLockManagerPrototype* prototype = new (NotNull, allocateCell<JSWebLockManagerPrototype>(vm)) JSWebLockManagerPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSWebLockManagerPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

void JSWebLockManagerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWebLockManager::info(), JSWebLockManagerPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void setupJSWebLockClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;
    auto* prototypeStructure = JSWebLockPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSWebLockPrototype::create(vm, globalObject, prototypeStructure);
    auto* constructorStructure = JSWebLockIllegalConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSWebLockIllegalConstructor::create(vm, constructorStructure, prototype, "Lock"_s);
    auto* instanceStructure = JSWebLock::createStructure(vm, globalObject, prototype);
    init.setPrototype(prototype);
    init.setStructure(instanceStructure);
    init.setConstructor(constructor);
}

void setupJSWebLockManagerClassStructure(LazyClassStructure::Initializer& init)
{
    VM& vm = init.vm;
    JSGlobalObject* globalObject = init.global;
    auto* prototypeStructure = JSWebLockManagerPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    auto* prototype = JSWebLockManagerPrototype::create(vm, globalObject, prototypeStructure);
    auto* constructorStructure = JSWebLockIllegalConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = JSWebLockIllegalConstructor::create(vm, constructorStructure, prototype, "LockManager"_s);
    auto* instanceStructure = JSWebLockManager::createStructure(vm, globalObject, prototype);
    init.setPrototype(prototype);
    init.setStructure(instanceStructure);
    init.setConstructor(constructor);
}

} // namespace WebCore

// ---------------------------------------------------------------------------
// Request state machine

namespace Bun {

using namespace JSC;
using namespace WebCore;

static constexpr ASCIILiteral lockAbortedMessage = "The operation was aborted"_s;

static WebLocksClient& ensureWebLocksClient(Zig::GlobalObject* globalObject)
{
    auto& slot = globalObject->m_webLocksClient;
    if (!slot) {
        slot = makeUnique<WebLocksClient>();
        int threadId = 0;
        if (auto* worker = WebWorker__getParentWorker(globalObject->bunVM())) {
            // Main thread starts at 1.
            threadId = static_cast<int>(worker->clientIdentifier()) - 1;
        }
        slot->clientId = makeString("node-"_s, WTF::getCurrentProcessID(), "-"_s, threadId);
    }
    return *slot;
}

// ---------------------------------------------------------------------------
// diagnostics_channel: locks.request.{start,grant,miss,end}, like Node.

static JSObject* dcChannel(Zig::GlobalObject* globalObject, WebLocksClient::DCChannel which)
{
    auto& client = ensureWebLocksClient(globalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!client.dcChannelsInitialized) {
        // Latched only on success: a failed initialization (a stack-exhausted
        // first request, say) is swallowed and retried by the next request
        // rather than disabling diagnostics for the rest of the thread's life.
        JSValue dcModuleValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::NodeDiagnosticsChannel);
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return nullptr;
        }
        if (!dcModuleValue || !dcModuleValue.isObject()) [[unlikely]]
            return nullptr;
        auto* dcModule = asObject(dcModuleValue);
        JSValue channelFunction = dcModule->get(globalObject, Identifier::fromString(vm, "channel"_s));
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return nullptr;
        }
        auto callData = JSC::getCallData(channelFunction);
        if (callData.type == CallData::Type::None) [[unlikely]]
            return nullptr;
        static constexpr ASCIILiteral channelNames[4] = {
            "locks.request.start"_s,
            "locks.request.grant"_s,
            "locks.request.miss"_s,
            "locks.request.end"_s,
        };
        for (unsigned i = 0; i < 4; i++) {
            MarkedArgumentBuffer args;
            args.append(jsString(vm, String(channelNames[i])));
            JSValue channel = JSC::call(globalObject, channelFunction, callData, dcModule, args);
            if (scope.exception()) [[unlikely]] {
                (void)scope.tryClearException();
                return nullptr;
            }
            if (auto* channelObject = channel.getObject())
                client.dcChannels[i] = JSC::Strong<JSObject> { vm, channelObject };
        }
        client.dcChannelsInitialized = true;
    }
    scope.release();
    return client.dcChannels[which].get();
}

// Diagnostics must not break the lock machinery: a throwing subscriber (or
// tampered channel) is swallowed here, except for termination exceptions,
// which stay pending for the caller's next exception check.
static bool dcHasSubscribers(Zig::GlobalObject* globalObject, JSObject* channel)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue hasSubscribers = channel->get(globalObject, WebCore::clientData(vm)->builtinNames().hasSubscribersPublicName());
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }
    RELEASE_AND_RETURN(scope, hasSubscribers.toBoolean(globalObject));
}

static void dcPublish(Zig::GlobalObject* globalObject, JSObject* channel, JSObject* payload)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue publishFunction = channel->get(globalObject, WebCore::clientData(vm)->builtinNames().publishPublicName());
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    auto callData = JSC::getCallData(publishFunction);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return;
    MarkedArgumentBuffer args;
    args.append(payload);
    JSC::call(globalObject, publishFunction, callData, channel, args);
    (void)scope.tryClearException();
}

static JSObject* dcBasePayload(Zig::GlobalObject* globalObject, const WebLockRequest& request)
{
    auto& vm = JSC::getVM(globalObject);
    auto* payload = constructEmptyObject(globalObject);
    payload->putDirect(vm, vm.propertyNames->name, jsString(vm, request.name));
    payload->putDirect(vm, WebCore::clientData(vm)->builtinNames().modePublicName(), lockModeString(vm, request.exclusive));
    return payload;
}

static void publishLockRequestEvent(Zig::GlobalObject* globalObject, WebLocksClient::DCChannel which, const WebLockRequest& request)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* channel = dcChannel(globalObject, which);
    RETURN_IF_EXCEPTION(scope, );
    if (!channel)
        return;
    bool hasSubscribers = dcHasSubscribers(globalObject, channel);
    RETURN_IF_EXCEPTION(scope, );
    if (!hasSubscribers)
        return;
    dcPublish(globalObject, channel, dcBasePayload(globalObject, request));
    RETURN_IF_EXCEPTION(scope, );
}

// end payload: { name, mode, ifAvailable, steal, error }
static void publishLockRequestEnd(Zig::GlobalObject* globalObject, const WebLockRequest& request, JSValue error)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* channel = dcChannel(globalObject, WebLocksClient::DCEnd);
    RETURN_IF_EXCEPTION(scope, );
    if (!channel)
        return;
    bool hasSubscribers = dcHasSubscribers(globalObject, channel);
    RETURN_IF_EXCEPTION(scope, );
    if (!hasSubscribers)
        return;
    auto* payload = dcBasePayload(globalObject, request);
    payload->putDirect(vm, Identifier::fromString(vm, "ifAvailable"_s), jsBoolean(request.ifAvailable));
    payload->putDirect(vm, Identifier::fromString(vm, "steal"_s), jsBoolean(request.steal));
    payload->putDirect(vm, Identifier::fromString(vm, "error"_s), error);
    dcPublish(globalObject, channel, payload);
    RETURN_IF_EXCEPTION(scope, );
}

// ---------------------------------------------------------------------------
// Settling

static void settleResolve(Zig::GlobalObject* globalObject, WebLockRequest& request, JSValue value)
{
    if (request.settled)
        return;
    request.settled = true;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    request.promise->resolve(globalObject, vm, value);
    (void)scope.tryClearException();
}

static void settleReject(Zig::GlobalObject* globalObject, WebLockRequest& request, JSValue error)
{
    if (request.settled)
        return;
    request.settled = true;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Exception* exception = nullptr;
    if (!error.inherits<JSC::Exception>())
        exception = JSC::Exception::create(vm, error, JSC::Exception::StackCaptureAction::CaptureStack);
    else
        exception = uncheckedDowncast<JSC::Exception>(error);
    request.promise->reject(vm, exception);
    (void)scope.tryClearException();
}

static void removeAbortListener(Zig::GlobalObject* globalObject, WebLockRequest& request)
{
    if (!request.signal || !request.abortListener)
        return;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* signal = request.signal.get();
    JSObject* listener = request.abortListener.get();
    JSValue removeFunction = signal->get(globalObject, Identifier::fromString(vm, "removeEventListener"_s));
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
    auto callData = JSC::getCallData(removeFunction);
    if (callData.type == CallData::Type::None)
        return;
    MarkedArgumentBuffer args;
    args.append(jsString(vm, String("abort"_s)));
    args.append(listener);
    JSC::call(globalObject, removeFunction, callData, signal, args);
    (void)scope.tryClearException();
    request.abortListener.clear();
}

// The callback (or the promise it returned) settled: drop the lock, publish
// the end event, and settle the request promise, mirroring Node's
// ReleaseLockAndProcessQueue + the released-promise handlers in locks.js.
static void releaseAndSettle(Zig::GlobalObject* globalObject, WebLockRequest& request, JSValue value, bool rejected)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ensureWebLocksClient(globalObject).requests.remove(request.id);
    // Re-checks the queue and may grant other requests synchronously.
    bool released = BunWebLocksRegistry::singleton().release(globalObject, request.id, request.name);
    RETURN_IF_EXCEPTION(scope, );
    removeAbortListener(globalObject, request);
    RETURN_IF_EXCEPTION(scope, );
    if (request.stolen) {
        // The steal already rejected the promise and published the end event.
        return;
    }
    if (!released && request.granted) {
        // Another thread stole the lock and its notification task has not
        // run yet (the registry entry is already gone). The steal wins, as
        // it does when the notification arrives first.
        request.stolen = true;
        JSValue error = createDOMException(globalObject, ExceptionCode::AbortError, lockAbortedMessage);
        RETURN_IF_EXCEPTION(scope, );
        publishLockRequestEnd(globalObject, request, error);
        RETURN_IF_EXCEPTION(scope, );
        settleReject(globalObject, request, error);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }
    publishLockRequestEnd(globalObject, request, rejected ? value : jsUndefined());
    RETURN_IF_EXCEPTION(scope, );
    if (rejected)
        settleReject(globalObject, request, value);
    else
        settleResolve(globalObject, request, value);
    RETURN_IF_EXCEPTION(scope, );
}

// Invoke the user callback with the lock (or null on an ifAvailable miss) and
// tie the lock's lifetime to the returned promise, if any. Non-promise return
// values (including thenables) release the lock immediately, like Node.
static bool invokeCallbackAndChain(Zig::GlobalObject* globalObject, WebLockRequest& request, JSValue lockValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto callData = JSC::getCallData(request.callback.get());
    ASSERT(callData.type != CallData::Type::None);
    MarkedArgumentBuffer args;
    args.append(lockValue);
    ASSERT(!args.hasOverflowed());
    JSValue result = JSC::call(globalObject, request.callback.get(), callData, jsUndefined(), args);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (!scope.tryClearException())
            return false;
        // Unlike Node (which leaves the lock held forever here), release the
        // lock when the callback throws synchronously, per the Web Locks spec.
        releaseAndSettle(globalObject, request, error, true);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }

    if (auto* resultPromise = dynamicDowncast<JSPromise>(result)) {
        auto* onFulfilled = JSNativeStdFunction::create(vm, globalObject, 1, String(), [request = Ref { request }](JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame) -> EncodedJSValue {
            auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
            releaseAndSettle(defaultGlobalObject(lexicalGlobalObject), request.get(), callFrame->argument(0), false);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        });
        auto* onRejected = JSNativeStdFunction::create(vm, globalObject, 1, String(), [request = Ref { request }](JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame) -> EncodedJSValue {
            auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
            releaseAndSettle(defaultGlobalObject(lexicalGlobalObject), request.get(), callFrame->argument(0), true);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        });
        resultPromise->then(globalObject, onFulfilled, onRejected);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }

    releaseAndSettle(globalObject, request, result, false);
    return !scope.exception();
}

static bool handleGrantedRequest(Zig::GlobalObject* globalObject, WebLockRequest& request)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto makeLock = [&]() -> JSValue {
        auto* structure = globalObject->m_JSWebLockClassStructure.get(globalObject);
        return JSWebLock::create(vm, structure, jsString(vm, request.name), request.exclusive);
    };

    if (!request.signal) {
        request.callbackStarted = true;
        publishLockRequestEvent(globalObject, WebLocksClient::DCGrant, request);
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, invokeCallbackAndChain(globalObject, request, makeLock()));
    }

    // With a signal the callback is deferred one microtask and skipped if the
    // signal aborted in the meantime, like Node's wrappedCallback.
    auto* job = JSNativeStdFunction::create(vm, globalObject, 0, String(), [request = Ref { request }](JSGlobalObject* lexicalGlobalObject, CallFrame*) -> EncodedJSValue {
        auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        JSValue abortedValue = request->signal.get()->get(globalObject, Identifier::fromString(vm, "aborted"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (abortedValue.toBoolean(globalObject)) {
            // The promise was already rejected by the abort listener; release
            // the lock without running the callback. Node resolves its
            // internal released promise with undefined here, so the end event
            // carries no error.
            releaseAndSettle(globalObject, request.get(), jsUndefined(), false);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        }
        request->callbackStarted = true;
        publishLockRequestEvent(globalObject, WebLocksClient::DCGrant, request.get());
        RETURN_IF_EXCEPTION(scope, {});
        auto* structure = globalObject->m_JSWebLockClassStructure.get(globalObject);
        JSValue lock = JSWebLock::create(vm, structure, jsString(vm, request->name), request->exclusive);
        invokeCallbackAndChain(globalObject, request.get(), lock);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    });
    JSC__JSGlobalObject__queueMicrotaskJob(globalObject, JSValue::encode(job), JSValue::encode(jsUndefined()), JSValue::encode(jsUndefined()));
    return true;
}

bool dispatchWebLockEvent(Zig::GlobalObject* globalObject, int32_t type, uint64_t id)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& client = ensureWebLocksClient(globalObject);
    auto it = client.requests.find(id);
    if (it == client.requests.end())
        return true;
    Ref<WebLockRequest> request = it->value;

    switch (type) {
    case BunWebLocksRegistry::StolenEvent: {
        request->stolen = true;
        client.requests.remove(id);
        JSValue error = createDOMException(globalObject, ExceptionCode::AbortError, lockAbortedMessage);
        RETURN_IF_EXCEPTION(scope, false);
        publishLockRequestEnd(globalObject, request.get(), error);
        RETURN_IF_EXCEPTION(scope, false);
        settleReject(globalObject, request.get(), error);
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    }
    case BunWebLocksRegistry::MissEvent: {
        client.requests.remove(id);
        publishLockRequestEvent(globalObject, WebLocksClient::DCMiss, request.get());
        RETURN_IF_EXCEPTION(scope, false);
        RELEASE_AND_RETURN(scope, invokeCallbackAndChain(globalObject, request.get(), jsNull()));
    }
    case BunWebLocksRegistry::GrantedEvent: {
        request->granted = true;
        RELEASE_AND_RETURN(scope, handleGrantedRequest(globalObject, request.get()));
    }
    default:
        return true;
    }
}

// ---------------------------------------------------------------------------
// LockManager.prototype.request

// Reads the LockOptions dictionary in sorted member order with the same
// conversions and error messages as Node's Web IDL layer
// (lib/internal/webidl.js).
struct LockOptions {
    bool exclusive { true };
    bool ifAvailable { false };
    bool steal { false };
    JSValue signal { JSC::jsUndefined() };

    bool hasSignal() const { return !signal.isUndefined(); }
};

static String convertNameToDOMString(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral context)
{
    if (value.isSymbol()) [[unlikely]] {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, makeString(context, " is a Symbol and cannot be converted to a string."_s));
        return {};
    }
    return value.toWTFString(globalObject);
}

static bool convertLockOptions(JSGlobalObject* globalObject, ThrowScope& scope, JSValue optionsValue, LockOptions& options)
{
    if (optionsValue.isUndefinedOrNull())
        return true;
    if (!optionsValue.isObject()) [[unlikely]] {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "Value cannot be converted to a dictionary"_s);
        return false;
    }
    auto& vm = JSC::getVM(globalObject);
    JSObject* optionsObject = asObject(optionsValue);

    JSValue ifAvailableValue = optionsObject->get(globalObject, Identifier::fromString(vm, "ifAvailable"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!ifAvailableValue.isUndefined())
        options.ifAvailable = ifAvailableValue.toBoolean(globalObject);

    JSValue modeValue = optionsObject->get(globalObject, WebCore::clientData(vm)->builtinNames().modePublicName());
    RETURN_IF_EXCEPTION(scope, false);
    if (!modeValue.isUndefined()) {
        String mode = convertNameToDOMString(globalObject, scope, modeValue, "mode"_s);
        RETURN_IF_EXCEPTION(scope, false);
        if (mode == "exclusive"_s)
            options.exclusive = true;
        else if (mode == "shared"_s)
            options.exclusive = false;
        else {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_VALUE, makeString("mode '"_s, mode, "' is not a valid enum value of type LockMode."_s));
            return false;
        }
    }

    JSValue signalValue = optionsObject->get(globalObject, Identifier::fromString(vm, "signal"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!signalValue.isUndefined()) {
        if (!signalValue.isObject()) [[unlikely]] {
            Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_ARG_TYPE, "signal is not an object."_s);
            return false;
        }
        options.signal = signalValue;
    }

    JSValue stealValue = optionsObject->get(globalObject, Identifier::fromString(vm, "steal"_s));
    RETURN_IF_EXCEPTION(scope, false);
    if (!stealValue.isUndefined())
        options.steal = stealValue.toBoolean(globalObject);

    return true;
}

// Matches internal/validators validateAbortSignal: a real AbortSignal or any
// object with an `aborted` property passes, like Node.
static bool validateAbortSignal(JSGlobalObject* globalObject, ThrowScope& scope, JSValue signal)
{
    if (signal.isUndefined())
        return true;
    auto& vm = JSC::getVM(globalObject);
    auto* object = signal.getObject();
    if (object) {
        if (object->inherits<WebCore::JSAbortSignal>())
            return true;
        bool hasAborted = object->hasProperty(globalObject, Identifier::fromString(vm, "aborted"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (hasAborted)
            return true;
    }
    Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.signal"_s, "AbortSignal"_s, signal);
    return false;
}

// Calls signal.throwIfAborted() through the JS protocol so duck-typed
// signals behave exactly like they do in Node.
static void signalThrowIfAborted(JSGlobalObject* globalObject, ThrowScope& scope, JSObject* signal)
{
    auto& vm = JSC::getVM(globalObject);
    JSValue throwIfAborted = signal->get(globalObject, Identifier::fromString(vm, "throwIfAborted"_s));
    RETURN_IF_EXCEPTION(scope, );
    auto callData = JSC::getCallData(throwIfAborted);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "signal.throwIfAborted is not a function"_s);
        return;
    }
    MarkedArgumentBuffer args;
    JSC::call(globalObject, throwIfAborted, callData, signal, args);
}

static void addAbortListener(Zig::GlobalObject* globalObject, ThrowScope& scope, WebLockRequest& request)
{
    auto& vm = JSC::getVM(globalObject);
    JSObject* signal = request.signal.get();

    auto* listener = JSNativeStdFunction::create(vm, globalObject, 0, String(), [request = Ref { request }](JSGlobalObject* lexicalGlobalObject, CallFrame*) -> EncodedJSValue {
        auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (request->callbackStarted || request->settled)
            return JSValue::encode(jsUndefined());
        JSValue reason = request->signal.get()->get(globalObject, vm.propertyNames->reason);
        RETURN_IF_EXCEPTION(scope, {});
        // `||`, not `??`: Node replaces any falsy reason with an AbortError.
        if (!reason.toBoolean(globalObject)) {
            reason = createDOMException(globalObject, ExceptionCode::AbortError, lockAbortedMessage);
            RETURN_IF_EXCEPTION(scope, {});
        }
        settleReject(globalObject, request.get(), reason);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    });

    JSValue addFunction = signal->get(globalObject, Identifier::fromString(vm, "addEventListener"_s));
    RETURN_IF_EXCEPTION(scope, );
    auto callData = JSC::getCallData(addFunction);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "signal.addEventListener is not a function"_s);
        return;
    }
    auto* listenerOptions = constructEmptyObject(globalObject);
    listenerOptions->putDirect(vm, Identifier::fromString(vm, "once"_s), jsBoolean(true));
    MarkedArgumentBuffer args;
    args.append(jsString(vm, String("abort"_s)));
    args.append(listener);
    args.append(listenerOptions);
    JSC::call(globalObject, addFunction, callData, signal, args);
    RETURN_IF_EXCEPTION(scope, );
    // Armed only after registration succeeded: this Strong forms a retain
    // cycle with the Ref the listener captures, so arming it before a
    // fallible call would leak the request if that call threw.
    request.abortListener = JSC::Strong<JSObject> { vm, listener };
}

static void throwNotSupportedError(JSGlobalObject* globalObject, ThrowScope& scope, const String& message)
{
    throwException(globalObject, scope, createDOMException(globalObject, ExceptionCode::NotSupportedError, message));
}

// The body of LockManager.prototype.request. Any exception thrown here is
// turned into a rejected promise by the caller, matching Node's async
// request().
static JSValue webLockManagerRequestImpl(Zig::GlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(globalObject);

    JSValue optionsValue = callFrame->argument(1);
    JSValue callbackValue = callFrame->argument(2);
    if (callbackValue.isUndefined()) {
        callbackValue = optionsValue;
        optionsValue = jsUndefined();
    }

    String name = convertNameToDOMString(globalObject, scope, callFrame->argument(0), "Value"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (!callbackValue.isCallable()) [[unlikely]] {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, callbackValue);
        return {};
    }

    LockOptions options;
    if (!optionsValue.isUndefined() && !optionsValue.isCallable()) {
        convertLockOptions(globalObject, scope, optionsValue, options);
        RETURN_IF_EXCEPTION(scope, {});
    }

    validateAbortSignal(globalObject, scope, options.signal);
    RETURN_IF_EXCEPTION(scope, {});

    if (options.hasSignal()) {
        signalThrowIfAborted(globalObject, scope, asObject(options.signal));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (name.startsWith('-')) {
        throwNotSupportedError(globalObject, scope, "Lock name may not start with hyphen"_s);
        return {};
    }
    if (options.ifAvailable && options.steal) {
        throwNotSupportedError(globalObject, scope, "ifAvailable and steal are mutually exclusive"_s);
        return {};
    }
    if (!options.exclusive && options.steal) {
        throwNotSupportedError(globalObject, scope, "mode: \"shared\" and steal are mutually exclusive"_s);
        return {};
    }
    if (options.hasSignal() && (options.steal || options.ifAvailable)) {
        throwNotSupportedError(globalObject, scope, "signal cannot be used with steal or ifAvailable"_s);
        return {};
    }

    if (!globalObject->scriptExecutionContext()) [[unlikely]]
        return JSPromise::create(vm, globalObject->promiseStructure());

    auto& client = ensureWebLocksClient(globalObject);

    auto request = WebLockRequest::create();
    request->name = name;
    request->exclusive = options.exclusive;
    request->steal = options.steal;
    request->ifAvailable = options.ifAvailable;
    request->promise = JSC::Strong<JSPromise> { vm, JSPromise::create(vm, globalObject->promiseStructure()) };
    request->callback = JSC::Strong<JSObject> { vm, asObject(callbackValue) };
    if (options.hasSignal())
        request->signal = JSC::Strong<JSObject> { vm, asObject(options.signal) };

    publishLockRequestEvent(globalObject, WebLocksClient::DCStart, request.get());
    RETURN_IF_EXCEPTION(scope, {});

    if (options.hasSignal()) {
        addAbortListener(globalObject, scope, request.get());
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto& registry = BunWebLocksRegistry::singleton();
    uint64_t id = registry.allocateId();
    request->id = id;
    client.requests.set(id, request.copyRef());

    // The commit below can synchronously run user JS (a steal publishes its
    // victims' dc end events), and that JS can re-enter with another steal
    // that takes this very lock, so the id must be registered first: the
    // nested steal then finds this request and rejects it, and the granted
    // dispatch below no-ops on the removed id.
    int32_t immediateEvent = registry.request(globalObject, id, name, options.exclusive, options.steal, options.ifAvailable);
    RETURN_IF_EXCEPTION(scope, {});

    JSPromise* promise = request->promise.get();
    if (immediateEvent != BunWebLocksRegistry::NoEvent) {
        dispatchWebLockEvent(globalObject, immediateEvent, id);
        RETURN_IF_EXCEPTION(scope, {});
    }
    // Grant anything that became grantable while the registry critical
    // section was in flight (possibly this very request, if another thread
    // released the name in that window).
    registry.processQueue(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return promise;
}

JSC_DEFINE_HOST_FUNCTION(jsWebLockManagerRequest, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!dynamicDowncast<JSWebLockManager>(callFrame->thisValue())) [[unlikely]] {
        // Async function semantics: reject instead of throwing.
        Bun::ERR::INVALID_THIS(scope, globalObject, "LockManager"_s);
        JSValue error = scope.exception()->value();
        if (!scope.tryClearException())
            return {};
        RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::rejectedPromise(globalObject, error)));
    }

    // Node's request() is an async function: validation failures become
    // rejections, never synchronous throws.
    JSValue result = webLockManagerRequestImpl(globalObject, scope, callFrame);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (!scope.tryClearException())
            return {};
        RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::rejectedPromise(globalObject, error)));
    }
    return JSValue::encode(result);
}

// ---------------------------------------------------------------------------
// LockManager.prototype.query

JSC_DEFINE_HOST_FUNCTION(jsWebLockManagerQuery, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!dynamicDowncast<JSWebLockManager>(callFrame->thisValue())) [[unlikely]] {
        // Async function semantics: reject instead of throwing.
        Bun::ERR::INVALID_THIS(scope, globalObject, "LockManager"_s);
        JSValue error = scope.exception()->value();
        if (!scope.tryClearException())
            return {};
        RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::rejectedPromise(globalObject, error)));
    }

    auto& client = ensureWebLocksClient(globalObject);

    // Ids are monotonic, so sorting restores request order.
    Vector<WebLockRequest*> records;
    records.reserveInitialCapacity(client.requests.size());
    for (auto& entry : client.requests.values())
        records.append(entry.ptr());
    std::sort(records.begin(), records.end(), [](auto* a, auto* b) { return a->id < b->id; });

    auto clientIdentifier = Identifier::fromString(vm, "clientId"_s);
    auto makeInfo = [&](WebLockRequest* record) -> JSObject* {
        auto* info = constructEmptyObject(globalObject);
        info->putDirect(vm, vm.propertyNames->name, jsString(vm, record->name));
        info->putDirect(vm, WebCore::clientData(vm)->builtinNames().modePublicName(), lockModeString(vm, record->exclusive));
        info->putDirect(vm, clientIdentifier, jsString(vm, client.clientId));
        return info;
    };

    auto* held = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    auto* pending = constructEmptyArray(globalObject, nullptr, 0);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned heldIndex = 0;
    unsigned pendingIndex = 0;
    for (auto* record : records) {
        auto* info = makeInfo(record);
        if (record->granted)
            held->putDirectIndex(globalObject, heldIndex++, info);
        else
            pending->putDirectIndex(globalObject, pendingIndex++, info);
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* snapshot = constructEmptyObject(globalObject);
    snapshot->putDirect(vm, Identifier::fromString(vm, "held"_s), held);
    snapshot->putDirect(vm, Identifier::fromString(vm, "pending"_s), pending);

    RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::resolvedPromise(globalObject, snapshot)));
}

} // namespace Bun
