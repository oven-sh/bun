#include "root.h"

#include "DurableObject.h"
#include "sqlite/DurableObjectStorage.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "PathInlines.h"
#include "ZigGeneratedClasses.h"
#include "ZigGlobalObject.h"
#include "ActiveDOMObject.h"
#include "BunString.h"
#include "EncodeURIComponent.h"

#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/WeakGCMapInlines.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

extern "C" void Bun__reportUnhandledError(JSC::JSGlobalObject*, JSC::EncodedJSValue);
extern "C" JSC::EncodedJSValue Bun__resolveSync(JSC::JSGlobalObject*, JSC::EncodedJSValue specifier, JSC::EncodedJSValue from, bool isESM, bool isUserRequireResolve);
extern "C" JSC::EncodedJSValue Bun__Process__getCwd(JSC::JSGlobalObject*);

namespace Bun {
using namespace JSC;
using Field = JSDurableObjectRealm::Field;
using HandleKind = JSDurableObjectHandle::Kind;

static constexpr Seconds blockConcurrencyTimeout = 30_s;
static constexpr uint8_t maxAlarmRetries = 6;
static constexpr unsigned maxTags = 10;
static constexpr unsigned maxTagLength = 256;

static double nowMs() { return WallTime::now().secondsSinceEpoch().milliseconds(); }

static Identifier ident(VM& vm, ASCIILiteral name) { return Identifier::fromString(vm, name); }

JSObject* createDurableObjectResetError(JSGlobalObject* globalObject)
{
    return createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_RESET, "This Durable Object is no longer running: it was evicted or reset after this reference to it was made"_s);
}

static JSObject* createClosedError(JSGlobalObject* globalObject)
{
    return createError(globalObject, ErrorCode::ERR_INVALID_STATE, "This DurableObjectNamespace is closed"_s);
}

// The async context with nothing in it, until this goes: what an object's script runs under
// is its graph's own frame, whoever is calling and whatever AsyncLocalStorage stores they are in.
class AsyncContextReset {
    WTF_MAKE_NONCOPYABLE(AsyncContextReset);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    explicit AsyncContextReset(Zig::GlobalObject* globalObject)
        : m_globalObject(globalObject)
        , m_previous(globalObject->m_asyncContextData.get()->getInternalField(0))
    {
        globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, jsUndefined());
    }
    ~AsyncContextReset()
    {
        m_globalObject->m_asyncContextData.get()->putInternalField(m_globalObject->vm(), 0, m_previous);
    }

private:
    Zig::GlobalObject* m_globalObject;
    JSValue m_previous;
};

// The one way into an object's context: its script runs under its graph's own frame, not on top of
// the caller's.
class ObjectScope {
    WTF_MAKE_NONCOPYABLE(ObjectScope);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ObjectScope(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
        : m_reset(globalObject)
        , m_context(globalObject, graph)
    {
    }

private:
    AsyncContextReset m_reset;
    ModuleGraphContextScope m_context;
};

static JSValue callMethod(JSGlobalObject* globalObject, JSValue target, ASCIILiteral name, const ArgList& arguments)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = target.get(globalObject, ident(vm, name));
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(method);
    if (callData.type == CallData::Type::None) {
        throwTypeError(globalObject, scope, makeString(name, " is not a function"_s));
        return {};
    }
    RELEASE_AND_RETURN(scope, call(globalObject, method, callData, target, arguments));
}

static void awaitWith(Zig::GlobalObject* globalObject, JSPromise* promise, JSDurableObjectEvent* continuation)
{
    auto* realm = JSDurableObjectRealm::of(globalObject);
    promise->performPromiseThenWithContext(globalObject->vm(), globalObject, realm->function(Field::OnFulfilled), realm->function(Field::OnRejected), jsUndefined(), continuation);
}

// `value` as a promise to wait on: itself, or one that follows it when it is some other thenable. Null when it is neither.
static JSPromise* toAwaitable(Zig::GlobalObject* globalObject, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (auto* promise = dynamicDowncast<JSPromise>(value))
        return promise;
    if (!value.isObject())
        return nullptr;
    JSValue then = asObject(value)->get(globalObject, globalObject->vm().propertyNames->then);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!then.isCallable())
        return nullptr;
    RELEASE_AND_RETURN(scope, JSPromise::resolvedPromise(globalObject, value));
}

// ─── Subspaces ───────────────────────────────────────────────────────────────

GCClient::IsoSubspace* JSDurableObjectRealm::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectRealm, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectRealm, m_subspaceForDurableObjectRealm));
}
GCClient::IsoSubspace* JSDurableObjectId::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectId, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectId, m_subspaceForDurableObjectId));
}
GCClient::IsoSubspace* JSDurableObjectStub::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectStub, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectStub, m_subspaceForDurableObjectStub));
}
GCClient::IsoSubspace* JSDurableObjectRpcFunction::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectRpcFunction, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectRpcFunction, m_subspaceForDurableObjectRpcFunction));
}
GCClient::IsoSubspace* JSDurableObjectHandle::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectHandle, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectHandle, m_subspaceForDurableObjectHandle));
}
GCClient::IsoSubspace* JSDurableObjectEvent::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectEvent, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectEvent, m_subspaceForDurableObjectEvent));
}
GCClient::IsoSubspace* JSDurableObjectActor::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectActor, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectActor, m_subspaceForDurableObjectActor));
}
GCClient::IsoSubspace* JSDurableObjectNamespace::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSDurableObjectNamespace, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForDurableObjectNamespace, m_subspaceForDurableObjectNamespace));
}

// ─── DurableObjectId ─────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectId::s_info = { "DurableObjectId"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectId) };

Structure* JSDurableObjectId::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectId* JSDurableObjectId::create(VM& vm, Structure* structure, JSDurableObjectNamespace* ns, JSString* hex, JSString* name)
{
    auto* id = new (NotNull, allocateCell<JSDurableObjectId>(vm)) JSDurableObjectId(vm, structure);
    id->finishCreation(vm);
    id->m_namespace.set(vm, id, ns);
    id->m_hex.set(vm, id, hex);
    if (name)
        id->m_name.set(vm, id, name);
    return id;
}

template<typename Visitor>
void JSDurableObjectId::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectId>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_namespace);
    visitor.append(thisObject->m_hex);
    visitor.append(thisObject->m_name);
    visitor.append(thisObject->m_stub);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectId);

JSDurableObjectStub* JSDurableObjectId::stub(Zig::GlobalObject* globalObject)
{
    if (auto* stub = m_stub.get())
        return stub;
    VM& vm = globalObject->vm();
    auto* stub = JSDurableObjectStub::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::StubStructure), this);
    m_stub.set(vm, this, stub);
    return stub;
}

static JSDurableObjectId* thisId(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* id = dynamicDowncast<JSDurableObjectId>(thisValue);
    if (!id) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "DurableObjectId"_s, method);
    return id;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectIdToString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* id = thisId(globalObject, scope, callFrame->thisValue(), "toString"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(id->hex());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectIdEquals, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* id = thisId(globalObject, scope, callFrame->thisValue(), "equals"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* other = dynamicDowncast<JSDurableObjectId>(callFrame->argument(0));
    if (!other || other->ns() != id->ns())
        return JSValue::encode(jsBoolean(false));
    bool equal = id->hex()->equal(globalObject, other->hex());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(equal));
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectIdName, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* id = thisId(globalObject, scope, JSValue::decode(thisValue), "name"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(id->name() ? JSValue(id->name()) : jsUndefined());
}

static const HashTableValue idPrototypeValues[] = {
    { "toString"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectIdToString, 0 } },
    { "toJSON"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectIdToString, 0 } },
    { "equals"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectIdEquals, 1 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectIdName, 0 } },
};

// ─── Stubs ───────────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectStub::s_info = { "DurableObjectStub"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectStub) };

Structure* JSDurableObjectStub::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectStub* JSDurableObjectStub::create(VM& vm, Structure* structure, JSDurableObjectId* id)
{
    auto* stub = new (NotNull, allocateCell<JSDurableObjectStub>(vm)) JSDurableObjectStub(vm, structure);
    stub->finishCreation(vm);
    stub->m_id.set(vm, stub, id);
    return stub;
}

template<typename Visitor>
void JSDurableObjectStub::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectStub>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_id);
    visitor.append(thisObject->m_actor);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectStub);

JSDurableObjectActor* JSDurableObjectStub::actor(Zig::GlobalObject* globalObject)
{
    auto* actor = m_actor.get();
    if (!actor || actor->m_forgotten) {
        actor = m_id->ns()->actorFor(globalObject, m_id.get());
        m_actor.set(globalObject->vm(), this, actor);
    }
    return actor;
}

// Names a stub never forwards: `then`, so that a stub can be returned from an async function;
// the class's handlers, which are the runtime's to call; and what every object answers itself.
static bool isReservedRpcName(const String& name)
{
    static constexpr ASCIILiteral reserved[] = {
        "then"_s,
        "constructor"_s,
        "alarm"_s,
        "webSocketOpen"_s,
        "webSocketMessage"_s,
        "webSocketClose"_s,
        "webSocketError"_s,
        "webSocketDrain"_s,
        "ctx"_s,
        "env"_s,
        "toJSON"_s,
        "__proto__"_s,
    };
    for (auto literal : reserved) {
        if (name == literal)
            return true;
    }
    return false;
}

bool JSDurableObjectStub::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    if (Base::getOwnPropertySlot(object, globalObject, propertyName, slot))
        return true;
    if (propertyName.isSymbol() || propertyName.isPrivateName() || slot.internalMethodType() == PropertySlot::InternalMethodType::VMInquiry)
        return false;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stub = uncheckedDowncast<JSDurableObjectStub>(object);
    String name = propertyName.uid();
    if (isReservedRpcName(name))
        return false;
    // id, name, fetch, and what Object.prototype has.
    PropertySlot inherited(stub, PropertySlot::InternalMethodType::VMInquiry, &vm);
    JSValue prototype = stub->getPrototypeDirect();
    bool isInherited = prototype.isObject() && asObject(prototype)->getPropertySlot(globalObject, propertyName, inherited);
    RETURN_IF_EXCEPTION(scope, false);
    if (isInherited)
        return false;
    auto* realm = JSDurableObjectRealm::of(defaultGlobalObject(globalObject));
    auto* function = JSDurableObjectRpcFunction::create(vm, realm->structure(Field::RpcFunctionStructure), stub, jsString(vm, name));
    stub->putDirect(vm, propertyName, function, static_cast<unsigned>(PropertyAttribute::DontEnum));
    slot.setValue(stub, static_cast<unsigned>(PropertyAttribute::DontEnum), function);
    return true;
}

static JSDurableObjectStub* thisStub(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* stub = dynamicDowncast<JSDurableObjectStub>(thisValue);
    if (!stub) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "DurableObjectStub"_s, method);
    return stub;
}

static bool isServer(JSValue value)
{
    return value.inherits<WebCore::JSHTTPServer>() || value.inherits<WebCore::JSHTTPSServer>() || value.inherits<WebCore::JSDebugHTTPServer>() || value.inherits<WebCore::JSDebugHTTPSServer>();
}

// stub.fetch(request, server?) and stub.fetch(input, init?, server?)
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStubFetch, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stub = thisStub(globalObject, scope, callFrame->thisValue(), "fetch"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue request = callFrame->argument(0);
    JSValue second = callFrame->argument(1);
    JSValue server = jsUndefined();
    if (request.inherits<WebCore::JSRequest>() && (second.isUndefined() || isServer(second)))
        server = second;
    else {
        MarkedArgumentBuffer arguments;
        arguments.append(request);
        if (isServer(second))
            server = second;
        else {
            arguments.append(second);
            server = callFrame->argument(2);
            if (!server.isUndefined() && !isServer(server)) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "server"_s, "Server"_s, server);
                return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
            }
        }
        JSObject* constructor = globalObject->JSRequestConstructor();
        request = construct(globalObject, constructor, JSC::getConstructData(constructor), arguments);
        if (scope.exception()) [[unlikely]]
            return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(stub->id()->ns()->dispatch(globalObject, stub, DurableObjectEventKind::Fetch, request, server)));
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectStubId, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* stub = thisStub(globalObject, scope, JSValue::decode(thisValue), "id"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stub->id());
}

JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectStubName, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* stub = thisStub(globalObject, scope, JSValue::decode(thisValue), "name"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stub->id()->name() ? JSValue(stub->id()->name()) : jsUndefined());
}

static const HashTableValue stubPrototypeValues[] = {
    { "fetch"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStubFetch, 1 } },
    { "id"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectStubId, 0 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectStubName, 0 } },
};

// ─── stub.method ─────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectRpcFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectRpcFunction) };

static JSC_DECLARE_HOST_FUNCTION(jsDurableObjectRpcCall);

JSDurableObjectRpcFunction::JSDurableObjectRpcFunction(VM& vm, Structure* structure)
    : Base(vm, structure, jsDurableObjectRpcCall, nullptr)
{
}

Structure* JSDurableObjectRpcFunction::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSDurableObjectRpcFunction* JSDurableObjectRpcFunction::create(VM& vm, Structure* structure, JSDurableObjectStub* stub, JSString* name)
{
    auto* function = new (NotNull, allocateCell<JSDurableObjectRpcFunction>(vm)) JSDurableObjectRpcFunction(vm, structure);
    function->finishCreation(vm, 0, name->tryGetValue(), PropertyAdditionMode::WithStructureTransition);
    function->m_stub.set(vm, function, stub);
    function->m_name.set(vm, function, name);
    return function;
}

template<typename Visitor>
void JSDurableObjectRpcFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectRpcFunction>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_stub);
    visitor.append(thisObject->m_name);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectRpcFunction);

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectRpcCall, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* function = uncheckedDowncast<JSDurableObjectRpcFunction>(callFrame->jsCallee());
    auto* stub = function->stub();
    ArgList arguments(callFrame);
    return JSValue::encode(stub->id()->ns()->dispatch(globalObject, stub, DurableObjectEventKind::Call, function->methodName(), jsUndefined(), &arguments));
}

// `await stub.property`
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectRpcThen, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* function = dynamicDowncast<JSDurableObjectRpcFunction>(callFrame->thisValue());
    if (!function) [[unlikely]]
        return WebCore::throwThisTypeError(*globalObject, scope, "DurableObjectStub"_s, "then"_s);
    auto* stub = function->stub();
    JSPromise* promise = stub->id()->ns()->dispatch(globalObject, stub, DurableObjectEventKind::Get, function->methodName(), jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(promise->then(globalObject, callFrame->argument(0), callFrame->argument(1))));
}

// ─── Handles ─────────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectHandle::s_info = { "DurableObjectState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectHandle) };

Structure* JSDurableObjectHandle::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectHandle* JSDurableObjectHandle::create(VM& vm, Structure* structure, Kind kind, JSDurableObjectActor* actor)
{
    auto* handle = new (NotNull, allocateCell<JSDurableObjectHandle>(vm)) JSDurableObjectHandle(vm, structure, kind);
    handle->finishCreation(vm);
    handle->m_actor.set(vm, handle, actor);
    handle->m_generation = actor->generation();
    return handle;
}

bool JSDurableObjectHandle::isCurrent() const
{
    auto* actor = m_actor.get();
    return actor->generation() == m_generation && actor->state() != JSDurableObjectActor::State::Unloaded;
}

template<typename Visitor>
void JSDurableObjectHandle::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectHandle>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_actor);
    visitor.append(thisObject->m_target);
    visitor.append(thisObject->m_extra);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectHandle);

JSDurableObjectHandle* toCurrentHandle(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, HandleKind kind, ASCIILiteral className, ASCIILiteral method)
{
    auto* handle = dynamicDowncast<JSDurableObjectHandle>(value);
    if (!handle || handle->kind() != kind) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, className, method);
        return nullptr;
    }
    if (!handle->isCurrent()) [[unlikely]] {
        throwException(globalObject, scope, createDurableObjectResetError(globalObject));
        return nullptr;
    }
    return handle;
}

// ─── Events ──────────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectEvent::s_info = { "DurableObjectEvent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectEvent) };

Structure* JSDurableObjectEvent::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectEvent* JSDurableObjectEvent::create(VM& vm, Zig::GlobalObject* globalObject, DurableObjectEventKind kind, JSDurableObjectActor* actor, JSValue a, JSValue b, JSValue c, JSPromise* promise)
{
    Structure* structure = JSDurableObjectRealm::of(globalObject)->structure(JSDurableObjectRealm::Field::EventStructure);
    auto* event = new (NotNull, allocateCell<JSDurableObjectEvent>(vm)) JSDurableObjectEvent(vm, structure, kind);
    event->finishCreation(vm);
    event->internalField(static_cast<uint32_t>(Field::Actor)).set(vm, event, actor);
    event->internalField(static_cast<uint32_t>(Field::A)).set(vm, event, a ? a : jsUndefined());
    event->internalField(static_cast<uint32_t>(Field::B)).set(vm, event, b ? b : jsUndefined());
    event->internalField(static_cast<uint32_t>(Field::C)).set(vm, event, c ? c : jsUndefined());
    event->internalField(static_cast<uint32_t>(Field::Promise)).set(vm, event, promise ? JSValue(promise) : jsUndefined());
    event->m_generation = actor->generation();
    return event;
}

JSDurableObjectActor* JSDurableObjectEvent::actor() const
{
    return uncheckedDowncast<JSDurableObjectActor>(internalField(static_cast<uint32_t>(Field::Actor)).get().asCell());
}

static JSWeakMap* socketMap(Zig::GlobalObject* globalObject)
{
    return uncheckedDowncast<JSWeakMap>(JSDurableObjectRealm::of(globalObject)->object(Field::SocketMap));
}

// ─── One object ──────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectActor::s_info = { "DurableObjectActor"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectActor) };

JSDurableObjectActor::JSDurableObjectActor(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSDurableObjectActor::~JSDurableObjectActor() = default;

void JSDurableObjectActor::destroy(JSCell* cell)
{
    static_cast<JSDurableObjectActor*>(cell)->~JSDurableObjectActor();
}

Structure* JSDurableObjectActor::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectActor* JSDurableObjectActor::create(VM& vm, Structure* structure, JSDurableObjectNamespace* ns, JSDurableObjectId* id)
{
    auto* actor = new (NotNull, allocateCell<JSDurableObjectActor>(vm)) JSDurableObjectActor(vm, structure);
    actor->finishCreation(vm);
    actor->m_namespace.set(vm, actor, ns);
    actor->m_id.set(vm, actor, id);
    return actor;
}

template<typename Visitor>
void JSDurableObjectActor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectActor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_namespace);
    visitor.append(thisObject->m_id);
    visitor.append(thisObject->m_graph);
    visitor.append(thisObject->m_instance);
    Locker locker { thisObject->cellLock() };
    for (auto* event : thisObject->m_queue)
        visitor.appendUnbarriered(event);
    for (auto* event : thisObject->m_running)
        visitor.appendUnbarriered(event);
    for (auto* socket : thisObject->m_sockets)
        visitor.appendUnbarriered(socket);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectActor);

void JSDurableObjectActor::becameIdleOrBusy()
{
    if (isIdle())
        ns()->actorBecameIdle(this);
    else
        ns()->actorBecameBusy(this);
}

void JSDurableObjectActor::rejectEvent(Zig::GlobalObject* globalObject, JSDurableObjectEvent* event, JSValue error)
{
    if (auto* promise = event->promise())
        promise->reject(globalObject->vm(), error);
}

void JSDurableObjectActor::post(Zig::GlobalObject* globalObject, DurableObjectEventKind kind, JSValue a, JSValue b, JSValue c)
{
    enqueue(globalObject, JSDurableObjectEvent::create(globalObject->vm(), globalObject, kind, this, a, b, c, nullptr), nullptr, nullptr);
}

JSPromise* JSDurableObjectActor::request(Zig::GlobalObject* globalObject, DurableObjectEventKind kind, JSValue a, JSValue b, const ArgList* arguments, JSModuleGraph* callerGraph)
{
    VM& vm = globalObject->vm();
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    enqueue(globalObject, JSDurableObjectEvent::create(vm, globalObject, kind, this, a, b, jsUndefined(), promise), arguments, callerGraph);
    return promise;
}

// An event starts right away when nothing of this object is running or waiting to; otherwise
// it waits its turn, and turns are taken from the event loop's task queue: the microtasks of what
// is running have drained by then, so a run of `await`s on storage is never interleaved with
// another event, and what is running is waiting on something outside (a timer, a fetch, another
// object).
void JSDurableObjectActor::enqueue(Zig::GlobalObject* globalObject, JSDurableObjectEvent* event, const ArgList* arguments, JSModuleGraph* callerGraph)
{
    VM& vm = globalObject->vm();
    if (ns()->isClosed()) {
        rejectEvent(globalObject, event, createClosedError(globalObject));
        return;
    }
    if (m_state == State::Running && !m_inflight && !m_blockers && m_queue.isEmpty() && (!callerGraph || callerGraph != m_graph.get())) {
        run(globalObject, event, arguments);
        return;
    }
    if (arguments && event->m_kind == DurableObjectEventKind::Call) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSArray* copy = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), *arguments);
        if (scope.exception()) [[unlikely]] {
            JSValue error = scope.exception()->value();
            if (scope.clearExceptionExceptTermination())
                rejectEvent(globalObject, event, error);
            return;
        }
        event->internalField(static_cast<uint32_t>(JSDurableObjectEvent::Field::B)).set(vm, event, copy);
    }
    {
        Locker locker { cellLock() };
        m_queue.append(event);
    }
    vm.writeBarrier(this, event);
    ns()->actorBecameBusy(this);
    if (m_state == State::Unloaded)
        start(globalObject);
    else if (m_state == State::Running)
        schedulePump(globalObject);
}

void JSDurableObjectActor::schedulePump(Zig::GlobalObject* globalObject)
{
    if (m_pumpScheduled || m_queue.isEmpty())
        return;
    m_pumpScheduled = true;
    ns()->context().postTask([actor = Strong<JSDurableObjectActor>(globalObject->vm(), this), generation = m_generation](WebCore::ScriptExecutionContext& context) {
        auto* self = actor.get();
        if (self->m_generation != generation)
            return;
        self->m_pumpScheduled = false;
        ModuleGraphContextScope scope(self->ns()->context());
        self->pump(defaultGlobalObject(context.jsGlobalObject()));
    });
}

void JSDurableObjectActor::pump(Zig::GlobalObject* globalObject)
{
    while (m_state == State::Running && !m_blockers && !m_queue.isEmpty()) {
        JSDurableObjectEvent* event;
        {
            Locker locker { cellLock() };
            event = m_queue.takeFirst();
        }
        if (!run(globalObject, event)) {
            schedulePump(globalObject);
            return;
        }
    }
    becameIdleOrBusy();
}

// The object's method, looked up the way a call over RPC may: on the class, not on the instance
// (what the constructor assigned is the object's private state) and not what every object has.
static JSValue rpcProperty(Zig::GlobalObject* globalObject, ThrowScope& scope, JSObject* instance, JSString* nameString, bool& found)
{
    auto name = nameString->toIdentifier(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    PropertySlot slot(instance, PropertySlot::InternalMethodType::Get);
    found = instance->getPropertySlot(globalObject, name, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (found && (slot.slotBase() == instance || slot.slotBase() == globalObject->objectPrototype()))
        found = false;
    if (!found)
        return jsUndefined();
    RELEASE_AND_RETURN(scope, slot.getValue(globalObject, name));
}

static JSValue invokeEvent(Zig::GlobalObject* globalObject, JSDurableObjectActor* actor, JSDurableObjectEvent* event, const ArgList* directArguments)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* instance = actor->instance();
    auto& names = WebCore::builtinNames(vm);
    auto handler = [&](const Identifier& name, const ArgList& arguments, bool required) -> JSValue {
        JSValue method = instance->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
        auto callData = JSC::getCallData(method);
        if (callData.type == CallData::Type::None) {
            if (required)
                throwTypeError(globalObject, scope, makeString("The Durable Object \""_s, actor->ns()->name(), "\" has no "_s, name.string(), "() handler"_s));
            return jsUndefined();
        }
        RELEASE_AND_RETURN(scope, call(globalObject, method, callData, instance, arguments));
    };
    switch (event->m_kind) {
    case DurableObjectEventKind::Call: {
        bool found = false;
        JSValue method = rpcProperty(globalObject, scope, instance, asString(event->a()), found);
        RETURN_IF_EXCEPTION(scope, {});
        auto callData = JSC::getCallData(method);
        if (!found || callData.type == CallData::Type::None) {
            String name = asString(event->a())->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            throwTypeError(globalObject, scope, makeString("The Durable Object \""_s, actor->ns()->name(), "\" has no method \""_s, name, '"'));
            return {};
        }
        if (directArguments)
            RELEASE_AND_RETURN(scope, call(globalObject, method, callData, instance, *directArguments));
        MarkedArgumentBuffer arguments;
        if (auto* array = dynamicDowncast<JSArray>(event->b())) {
            for (unsigned i = 0, length = array->length(); i < length; i++)
                arguments.append(array->getIndexQuickly(i));
        }
        RELEASE_AND_RETURN(scope, call(globalObject, method, callData, instance, arguments));
    }
    case DurableObjectEventKind::Get: {
        bool found = false;
        JSValue value = rpcProperty(globalObject, scope, instance, asString(event->a()), found);
        RETURN_IF_EXCEPTION(scope, {});
        if (value.isCallable()) {
            String name = asString(event->a())->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            throwTypeError(globalObject, scope, makeString('"', name, "\" is a method of the Durable Object \""_s, actor->ns()->name(), "\": call it"_s));
            return {};
        }
        return value;
    }
    case DurableObjectEventKind::Fetch: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        if (!event->b().isUndefined()) {
            auto* server = JSDurableObjectHandle::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::ServerStructure), HandleKind::Server, actor);
            server->setTarget(vm, event->b());
            event->internalField(static_cast<uint32_t>(JSDurableObjectEvent::Field::C)).set(vm, event, server);
            arguments.append(server);
        }
        return handler(ident(vm, "fetch"_s), arguments, true);
    }
    case DurableObjectEventKind::Alarm: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        return handler(names.alarmPublicName(), arguments, true);
    }
    case DurableObjectEventKind::SocketOpen: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        return handler(names.webSocketOpenPublicName(), arguments, false);
    }
    case DurableObjectEventKind::SocketMessage: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        arguments.append(event->b());
        return handler(names.webSocketMessagePublicName(), arguments, false);
    }
    case DurableObjectEventKind::SocketClose: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        arguments.append(event->b());
        arguments.append(event->c());
        arguments.append(jsBoolean(event->b().isInt32() && event->b().asInt32() != 1006));
        return handler(names.webSocketClosePublicName(), arguments, false);
    }
    case DurableObjectEventKind::SocketDrain: {
        MarkedArgumentBuffer arguments;
        arguments.append(event->a());
        return handler(names.webSocketDrainPublicName(), arguments, false);
    }
    default:
        return jsUndefined();
    }
}

bool JSDurableObjectActor::run(Zig::GlobalObject* globalObject, JSDurableObjectEvent* event, const ArgList* arguments)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (event->m_kind == DurableObjectEventKind::Alarm && !beginAlarm(globalObject, event))
        return true;
    m_inflight++;
    event->m_generation = m_generation;
    {
        Locker locker { cellLock() };
        event->m_runningIndex = m_running.size();
        m_running.append(event);
    }
    vm.writeBarrier(this, event);
    ns()->actorBecameBusy(this);

    JSValue result;
    {
        ObjectScope inside(globalObject, m_graph.get());
        result = invokeEvent(globalObject, this, event, arguments);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            settle(globalObject, event, error, true);
        return true;
    }
    JSPromise* awaited = toAwaitable(globalObject, result);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            settle(globalObject, event, error, true);
        return true;
    }
    if (awaited) {
        awaitWith(globalObject, awaited, event);
        return false;
    }
    settle(globalObject, event, result, false);
    return true;
}

void JSDurableObjectActor::settle(Zig::GlobalObject* globalObject, JSDurableObjectEvent* event, JSValue value, bool failed)
{
    VM& vm = globalObject->vm();
    // Reset since it started: abort() answered it.
    if (event->m_runningIndex == JSDurableObjectEvent::notRunning || event->m_generation != m_generation)
        return;
    {
        Locker locker { cellLock() };
        uint32_t index = event->m_runningIndex;
        JSDurableObjectEvent* last = m_running.takeLast();
        if (last != event) {
            m_running[index] = last;
            last->m_runningIndex = index;
        }
        event->m_runningIndex = JSDurableObjectEvent::notRunning;
    }
    m_inflight--;
    // Nothing leaves the object before what it wrote is committed.
    if (!flush(globalObject)) {
        rejectEvent(globalObject, event, createDurableObjectResetError(globalObject));
        return;
    }
    JSPromise* promise = event->promise();
    switch (event->m_kind) {
    default:
        if (failed) {
            if (promise)
                promise->reject(vm, value);
            else
                ns()->reportError(globalObject, value, this);
        } else if (promise)
            promise->resolve(globalObject, vm, value);
        break;
    case DurableObjectEventKind::Alarm:
        endAlarm(globalObject, value, failed);
        break;
    case DurableObjectEventKind::Fetch:
        if (!failed && !value.inherits<WebCore::JSResponse>()) {
            auto* server = dynamicDowncast<JSDurableObjectHandle>(event->c());
            if (!value.isUndefined() || !server || !server->m_finished) {
                failed = true;
                value = createTypeError(globalObject, "A Durable Object's fetch() must return a Response, or nothing after server.upgrade(request)"_s);
            }
        }
        if (failed)
            promise->reject(vm, value);
        else
            promise->resolve(globalObject, vm, value);
        break;
    }
    if (m_state != State::Running)
        return;
    if (!m_queue.isEmpty())
        schedulePump(globalObject);
    else
        becameIdleOrBusy();
}

// ── Starting ──

void JSDurableObjectActor::start(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* owner = ns();
    m_state = State::Starting;
    JSObject* onError = nullptr;
    if (owner->onError()) {
        // The graph reports (error, kind); the namespace's onError gets (error, id).
        onError = JSBoundFunction::create(vm, globalObject, JSDurableObjectRealm::of(globalObject)->function(Field::OnGraphError), this, ArgList(), 2, jsEmptyString(vm), makeSource("onError"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
        if (auto* exception = scope.exception()) [[unlikely]] {
            JSValue error = exception->value();
            if (scope.clearExceptionExceptTermination())
                abort(globalObject, error, KeepSockets);
            return;
        }
    }
    JSModuleGraph* graph = createModuleGraph(globalObject, owner->globals(), onError);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            abort(globalObject, error, KeepSockets);
        return;
    }
    // The class of a `class:` namespace is the host's code; what it throws in an object is the object's.
    graph->setTakesErrorsOfItsContext(!!owner->classValue());
    m_graph.set(vm, this, graph);
    if (owner->classValue()) {
        construct(globalObject, JSValue(owner->classValue()));
        return;
    }
    JSPromise* loaded = graph->import(globalObject, jsString(vm, owner->modulePath()));
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            abort(globalObject, error, KeepSockets);
        return;
    }
    awaitWith(globalObject, loaded, JSDurableObjectEvent::create(vm, globalObject, DurableObjectEventKind::Import, this, jsUndefined(), jsUndefined(), jsUndefined(), nullptr));
}

void JSDurableObjectActor::importSettled(Zig::GlobalObject* globalObject, JSDurableObjectEvent* continuation, JSValue value, bool failed)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (continuation->m_generation != m_generation || m_state != State::Starting)
        return;
    if (failed) {
        abort(globalObject, value, KeepSockets);
        return;
    }
    JSValue classValue = value.get(globalObject, Identifier::fromString(vm, ns()->exportName()));
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            abort(globalObject, error, KeepSockets);
        return;
    }
    if (!classValue.isConstructor()) {
        abort(globalObject, createTypeError(globalObject, makeString("The Durable Object module "_s, ns()->modulePath(), " has no exported class \""_s, ns()->exportName(), '"')), KeepSockets);
        return;
    }
    construct(globalObject, classValue);
}

void JSDurableObjectActor::construct(Zig::GlobalObject* globalObject, JSValue classValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* realm = JSDurableObjectRealm::of(globalObject);
    uint32_t generation = m_generation;

    auto* state = JSDurableObjectHandle::create(vm, realm->structure(Field::StateStructure), HandleKind::State, this);
    auto* storage = JSDurableObjectHandle::create(vm, realm->structure(Field::StorageStructure), HandleKind::Storage, this);
    auto* sql = JSDurableObjectHandle::create(vm, realm->structure(Field::SqlStructure), HandleKind::Sql, this);
    auto* kv = JSDurableObjectHandle::create(vm, realm->structure(Field::KvStructure), HandleKind::Kv, this);
    constexpr unsigned readOnly = PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;
    storage->putDirect(vm, ident(vm, "sql"_s), sql, readOnly);
    storage->putDirect(vm, ident(vm, "kv"_s), kv, readOnly);
    state->putDirect(vm, vm.propertyNames->id, id(), readOnly);
    state->putDirect(vm, ident(vm, "storage"_s), storage, readOnly);

    MarkedArgumentBuffer arguments;
    arguments.append(state);
    arguments.append(ns()->env() ? ns()->env() : jsUndefined());
    JSObject* instance;
    {
        ObjectScope inside(globalObject, m_graph.get());
        instance = JSC::construct(globalObject, classValue.getObject(), JSC::getConstructData(classValue), arguments);
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination() && m_generation == generation && m_state == State::Starting)
            abort(globalObject, error, KeepSockets);
        return;
    }
    if (m_generation != generation || m_state != State::Starting)
        return;
    m_instance.set(vm, this, instance);
    m_state = State::Running;
    m_initializing = m_blockers > 0;
    ns()->m_loadedCount++;
    ns()->updateKeepAlive();
    if (!m_blockers)
        pump(globalObject);
}

// ── ctx.blockConcurrencyWhile / ctx.waitUntil ──

JSValue JSDurableObjectActor::block(Zig::GlobalObject* globalObject, JSValue callback)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    uint32_t generation = m_generation;
    m_blockers++;
    ns()->actorBecameBusy(this);
    JSValue result;
    {
        ObjectScope inside(globalObject, m_graph.get());
        result = call(globalObject, callback, JSC::getCallData(callback), jsUndefined(), ArgList());
    }
    JSPromise* awaited = nullptr;
    if (!scope.exception())
        awaited = toAwaitable(globalObject, result);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (!scope.clearExceptionExceptTermination())
            return {};
        if (m_generation == generation)
            abort(globalObject, error, m_state == State::Starting || m_initializing ? KeepSockets : CloseSockets);
        // The calls that were waiting have the error; whether anyone looks at this promise too is up to the object.
        JSPromise* rejected = JSPromise::create(vm, globalObject->promiseStructure());
        rejected->rejectAsHandled(vm, error);
        return rejected;
    }
    if (!awaited) {
        unblock(globalObject, generation);
        JSPromise* resolved = JSPromise::resolvedPromise(globalObject, result);
        if (scope.exception()) [[unlikely]] {
            (void)scope.clearExceptionExceptTermination();
            return {};
        }
        return resolved;
    }
    if (!m_blockTimer)
        m_blockTimer = makeUnique<RunLoop::Timer>(vm.runLoop(), "DurableObject::blockConcurrencyWhile"_s, [this] { blockTimedOut(); });
    m_blockTimer->startOneShot(blockConcurrencyTimeout);
    JSPromise* outer = JSPromise::create(vm, globalObject->promiseStructure());
    awaitWith(globalObject, awaited, JSDurableObjectEvent::create(vm, globalObject, DurableObjectEventKind::Block, this, jsUndefined(), jsUndefined(), jsUndefined(), outer));
    return outer;
}

void JSDurableObjectActor::blockTimedOut()
{
    if (!m_blockers)
        return;
    ns()->context().postTask([actor = Strong<JSDurableObjectActor>(vm(), this), generation = m_generation](WebCore::ScriptExecutionContext& context) {
        auto* self = actor.get();
        if (self->m_generation != generation || !self->m_blockers)
            return;
        auto* globalObject = defaultGlobalObject(context.jsGlobalObject());
        ModuleGraphContextScope scope(self->ns()->context());
        self->abort(globalObject, createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_RESET, "blockConcurrencyWhile() did not finish within 30 seconds; the Durable Object was reset"_s));
    });
}

void JSDurableObjectActor::unblock(Zig::GlobalObject* globalObject, uint32_t generation)
{
    if (m_generation != generation || !m_blockers)
        return;
    if (--m_blockers)
        return;
    m_initializing = false;
    if (m_blockTimer)
        m_blockTimer->stop();
    if (m_state != State::Running)
        return;
    if (!m_inflight)
        pump(globalObject);
    else
        schedulePump(globalObject);
}

void JSDurableObjectActor::waitUntil(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    m_inflight++;
    ns()->actorBecameBusy(this);
    awaitWith(globalObject, promise, JSDurableObjectEvent::create(globalObject->vm(), globalObject, DurableObjectEventKind::WaitUntil, this, jsUndefined(), jsUndefined(), jsUndefined(), nullptr));
}

// ── What a promise the runtime waited on continues with ──

EncodedJSValue durableObjectReaction(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, bool failed)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    JSValue value = callFrame->argument(0);
    auto* event = dynamicDowncast<JSDurableObjectEvent>(callFrame->argument(1));
    if (!event)
        return JSValue::encode(jsUndefined());
    auto* actor = event->actor();
    ModuleGraphContextScope context(actor->ns()->context());
    bool current = actor->generation() == event->m_generation;
    switch (event->m_kind) {
    case DurableObjectEventKind::Import:
        actor->importSettled(globalObject, event, value, failed);
        break;
    case DurableObjectEventKind::Block:
        if (failed) {
            if (current)
                actor->abort(globalObject, value, actor->state() == JSDurableObjectActor::State::Starting || actor->m_initializing ? JSDurableObjectActor::KeepSockets : JSDurableObjectActor::CloseSockets);
            event->promise()->rejectAsHandled(vm, value);
        } else {
            actor->unblock(globalObject, event->m_generation);
            event->promise()->resolve(globalObject, vm, value);
        }
        break;
    case DurableObjectEventKind::WaitUntil:
        if (current) {
            actor->m_inflight--;
            actor->becameIdleOrBusy();
        }
        if (failed)
            actor->ns()->reportError(globalObject, value, actor);
        break;
    case DurableObjectEventKind::Transaction:
        finishDurableObjectTransaction(globalObject, event, value, failed);
        break;
    default:
        actor->settle(globalObject, event, value, failed);
        break;
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectOnFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return durableObjectReaction(globalObject, callFrame, false);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectOnRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return durableObjectReaction(globalObject, callFrame, true);
}

// The onError of an object's graph, bound to its actor.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectOnGraphError, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (auto* actor = dynamicDowncast<JSDurableObjectActor>(callFrame->thisValue())) {
        ModuleGraphContextScope context(actor->ns()->context());
        actor->ns()->reportError(globalObject, callFrame->argument(0), actor);
    }
    return JSValue::encode(jsUndefined());
}

// ── Alarms ──

void JSDurableObjectActor::alarmChanged()
{
    auto* database = m_database.get();
    if (!database)
        return;
    std::optional<int64_t> time;
    if (!database->alarmTime(time))
        return;
    auto* owner = ns();
    owner->alarmIndex().set(id()->hex()->tryGetValue(), time);
    owner->scheduleAlarms();
    owner->updateKeepAlive();
}

bool JSDurableObjectActor::beginAlarm(Zig::GlobalObject* globalObject, JSDurableObjectEvent* event)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* owner = ns();
    auto skip = [&](std::optional<int64_t> time) {
        owner->alarmIndex().set(id()->hex()->tryGetValue(), time);
        owner->scheduleAlarms();
        owner->updateKeepAlive();
        becameIdleOrBusy();
        return false;
    };
    // The object's own record says whether an alarm is due; the namespace's index is a hint.
    auto* database = this->database(globalObject);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue error = exception->value();
        if (scope.clearExceptionExceptTermination())
            owner->reportError(globalObject, error, this);
        return skip(std::nullopt);
    }
    std::optional<int64_t> due;
    if (!database->alarmTime(due) || !due || static_cast<double>(*due) > nowMs())
        return skip(due);
    unsigned retries = database->alarmRetries();
    JSObject* info = constructEmptyObject(globalObject);
    info->putDirect(vm, ident(vm, "isRetry"_s), jsBoolean(retries > 0), 0);
    info->putDirect(vm, ident(vm, "retryCount"_s), jsNumber(retries), 0);
    info->putDirect(vm, ident(vm, "scheduledTime"_s), jsNumber(static_cast<double>(*due)), 0);
    event->setA(vm, info);
    m_alarmRunning = true;
    m_alarmTouched = false;
    return true;
}

void JSDurableObjectActor::endAlarm(Zig::GlobalObject* globalObject, JSValue error, bool failed)
{
    m_alarmRunning = false;
    if (failed) {
        alarmFailed(globalObject);
        ns()->reportError(globalObject, error, this);
        return;
    }
    if (!m_alarmTouched) {
        if (auto* database = m_database.get()) {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
            if (beginWrite(globalObject, database))
                database->deleteAlarm();
            (void)scope.clearExceptionExceptTermination();
            if (!flush(globalObject))
                return;
        }
    }
    // Whatever the index was told meanwhile, it says what is stored from here on.
    alarmChanged();
}

// Tried again with exponential backoff, six times. The stored time is left as it is; the count
// is stored next to it, so neither an eviction nor a restart makes the alarm young again.
void JSDurableObjectActor::alarmFailed(Zig::GlobalObject* globalObject)
{
    auto* owner = ns();
    if (m_alarmTouched) {
        alarmChanged();
        return;
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    auto* database = this->database(globalObject);
    if (scope.exception()) [[unlikely]] {
        (void)scope.clearExceptionExceptTermination();
        return;
    }
    unsigned retries = database->alarmRetries();
    bool giveUp = retries >= maxAlarmRetries;
    if (beginWrite(globalObject, database)) {
        if (giveUp)
            database->deleteAlarm();
        else
            database->setAlarmRetries(retries + 1);
    }
    (void)scope.clearExceptionExceptTermination();
    if (!database->flush())
        return;
    database->m_alarmDirty = false;
    if (giveUp) {
        alarmChanged();
        return;
    }
    owner->alarmIndex().set(id()->hex()->tryGetValue(), static_cast<int64_t>(nowMs() + 1000.0 * (1 << (retries + 1))));
    owner->scheduleAlarms();
    owner->updateKeepAlive();
}

// ── WebSockets ──

void JSDurableObjectActor::addSocket(VM& vm, JSDurableObjectHandle* socket)
{
    {
        Locker locker { cellLock() };
        socket->m_index = m_sockets.size();
        m_sockets.append(socket);
    }
    vm.writeBarrier(this, socket);
    ns()->m_socketCount++;
    ns()->updateKeepAlive();
}

void JSDurableObjectActor::removeSocket(JSDurableObjectHandle* socket)
{
    {
        Locker locker { cellLock() };
        uint32_t index = socket->m_index;
        if (index >= m_sockets.size() || m_sockets[index] != socket)
            return;
        JSDurableObjectHandle* last = m_sockets.takeLast();
        if (last != socket) {
            m_sockets[index] = last;
            last->m_index = index;
        }
    }
    ns()->m_socketCount--;
    ns()->updateKeepAlive();
}

JSArray* JSDurableObjectActor::socketsWithTag(Zig::GlobalObject* globalObject, const String& tag)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    // (A socket is on the list from its open to its close event.)
    MarkedArgumentBuffer sockets;
    for (auto* socket : m_sockets) {
        if (!tag.isNull()) {
            bool tagged = false;
            if (auto* tags = dynamicDowncast<JSArray>(socket->extra())) {
                for (unsigned i = 0, length = tags->length(); i < length && !tagged; i++) {
                    auto* string = dynamicDowncast<JSString>(tags->getIndexQuickly(i));
                    tagged = string && string->tryGetValue() == tag;
                }
            }
            if (!tagged)
                continue;
        }
        sockets.append(socket->target());
    }
    RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), sockets));
}

void JSDurableObjectActor::closeSockets(Zig::GlobalObject* globalObject, int code, ASCIILiteral reason)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    Vector<JSDurableObjectHandle*> sockets;
    {
        Locker locker { cellLock() };
        sockets = std::exchange(m_sockets, {});
    }
    if (sockets.isEmpty())
        return;
    ns()->m_socketCount -= sockets.size();
    MarkedArgumentBuffer targets;
    for (auto* socket : sockets)
        targets.append(socket->target());
    for (unsigned i = 0; i < targets.size(); i++) {
        JSValue target = targets.at(i);
        if (!target.isObject())
            continue;
        socketMap(globalObject)->remove(asObject(target));
        MarkedArgumentBuffer arguments;
        arguments.append(jsNumber(code));
        arguments.append(jsNontrivialString(vm, reason));
        callMethod(globalObject, target, "close"_s, arguments);
        if (!scope.clearExceptionExceptTermination())
            return;
    }
    ns()->updateKeepAlive();
}

// ── Unloading ──

void JSDurableObjectActor::evict(Zig::GlobalObject* globalObject)
{
    if (m_state != State::Running || !isIdle())
        return;
    if (!flush(globalObject))
        return;
    unload(globalObject);
    ns()->forget(this);
}

void JSDurableObjectActor::abort(Zig::GlobalObject* globalObject, JSValue error, AbortSockets sockets)
{
    if (auto* database = m_database.get()) {
        bool alarmDirty = std::exchange(database->m_alarmDirty, false);
        database->rollback();
        if (alarmDirty)
            alarmChanged();
    }
    Vector<JSDurableObjectEvent*> running;
    Deque<JSDurableObjectEvent*> queue;
    {
        Locker locker { cellLock() };
        running = std::exchange(m_running, {});
        queue = std::exchange(m_queue, {});
    }
    MarkedArgumentBuffer events;
    for (auto* event : running) {
        event->m_runningIndex = JSDurableObjectEvent::notRunning;
        events.append(event);
    }
    for (auto* event : queue)
        events.append(event);
    bool alarm = m_alarmRunning;
    bool unheard = false;
    for (unsigned i = 0; i < events.size(); i++) {
        auto* event = uncheckedDowncast<JSDurableObjectEvent>(events.at(i).asCell());
        alarm = alarm || event->m_kind == DurableObjectEventKind::Alarm;
        unheard = unheard || !event->promise();
    }
    unload(globalObject);
    for (unsigned i = 0; i < events.size(); i++)
        rejectEvent(globalObject, uncheckedDowncast<JSDurableObjectEvent>(events.at(i).asCell()), error);
    if (sockets == CloseSockets)
        closeSockets(globalObject, 1011, "Durable Object reset"_s);
    if (alarm) {
        m_alarmTouched = false;
        alarmFailed(globalObject);
        if (m_state == State::Unloaded && m_database && !m_database->isInMemory())
            closeDatabase();
    }
    // An alarm or a WebSocket event has nobody to tell but the namespace.
    if (unheard)
        ns()->reportError(globalObject, error, this);
    ns()->forget(this);
    ns()->actorWasReset();
}

// The namespace's own context stopped. No script runs here (see ContextObserver).
void JSDurableObjectActor::stoppedWithContext()
{
    m_state = State::Unloaded;
    m_generation++;
    m_inflight = 0;
    m_blockers = 0;
    if (m_blockTimer)
        m_blockTimer->stop();
    {
        Locker locker { cellLock() };
        m_queue.clear();
        m_running.clear();
        m_sockets.clear();
    }
    m_instance.clear();
    m_graph.clear();
    closeDatabase();
}

void JSDurableObjectActor::unload(Zig::GlobalObject* globalObject)
{
    m_initializing = false;
    auto* owner = ns();
    if (m_state == State::Running)
        owner->m_loadedCount--;
    m_state = State::Unloaded;
    m_generation++;
    m_inflight = 0;
    m_blockers = 0;
    m_pumpScheduled = false;
    m_commitScheduled = false;
    m_alarmRunning = false;
    if (m_blockTimer)
        m_blockTimer->stop();
    m_instance.clear();
    JSModuleGraph* graph = m_graph.get();
    m_graph.clear();
    owner->actorBecameBusy(this);
    if (auto* database = m_database.get()) {
        database->abandonOpenStatements();
        database->rollback();
        // A file is reopened when next needed; a database in memory is the only copy.
        if (!database->isInMemory())
            closeDatabase();
    }
    if (graph) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        graph->dispose(globalObject);
        (void)scope.clearExceptionExceptTermination();
    }
    owner->updateKeepAlive();
}

// ─── ctx ─────────────────────────────────────────────────────────────────────

#define THIS_STATE(method)                                                                                                          \
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);                                                                  \
    [[maybe_unused]] VM& vm = globalObject->vm();                                                                                   \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                                           \
    auto* handle = toCurrentHandle(globalObject, scope, callFrame->thisValue(), HandleKind::State, "DurableObjectState"_s, method); \
    RETURN_IF_EXCEPTION(scope, {});                                                                                                 \
    auto* actor = handle->actor();

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateWaitUntil, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* handle = dynamicDowncast<JSDurableObjectHandle>(callFrame->thisValue());
    if (!handle || handle->kind() != HandleKind::State) [[unlikely]]
        return WebCore::throwThisTypeError(*globalObject, scope, "DurableObjectState"_s, "waitUntil"_s);
    if (!handle->isCurrent() || handle->actor()->state() != JSDurableObjectActor::State::Running)
        return JSValue::encode(jsUndefined());
    JSPromise* promise = toAwaitable(globalObject, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    if (promise) {
        ModuleGraphContextScope context(handle->actor()->ns()->context());
        handle->actor()->waitUntil(globalObject, promise);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateBlockConcurrencyWhile, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("blockConcurrencyWhile"_s)
    JSValue callback = callFrame->argument(0);
    V::validateFunction(scope, globalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    ModuleGraphContextScope context(actor->ns()->context());
    RELEASE_AND_RETURN(scope, JSValue::encode(actor->block(globalObject, callback)));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateAbort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("abort"_s)
    JSValue reason = callFrame->argument(0);
    JSValue error = reason;
    if (!reason.inherits<ErrorInstance>()) {
        String message = "Durable Object was aborted"_s;
        if (!reason.isUndefined()) {
            message = reason.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        error = createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_RESET, message);
    }
    {
        ModuleGraphContextScope context(actor->ns()->context());
        actor->abort(globalObject, error);
    }
    throwException(globalObject, scope, error);
    return {};
}

static JSArray* validateTags(Zig::GlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    VM& vm = globalObject->vm();
    MarkedArgumentBuffer tags;
    if (!value.isUndefined()) {
        if (!isArray(globalObject, value)) {
            RETURN_IF_EXCEPTION(scope, nullptr);
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "tags"_s, "Array"_s, value);
            return nullptr;
        }
        Vector<String> seen;
        forEachInArrayLike(globalObject, asObject(value), [&](JSValue element) {
            if (!element.isString()) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "tags[]"_s, "string"_s, element);
                return false;
            }
            String tag = asString(element)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            if (tag.length() > maxTagLength) {
                Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "tags[]"_s, element, makeString("must be at most "_s, maxTagLength, " characters"_s));
                return false;
            }
            if (!seen.contains(tag)) {
                seen.append(tag);
                tags.append(jsString(vm, tag));
            }
            if (seen.size() > maxTags) {
                Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "tags"_s, value, makeString("must have at most "_s, maxTags, " tags"_s));
                return false;
            }
            return true;
        });
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), tags));
}

// The record that ties `ws` to the Durable Object that accepted it, if one did.
static JSDurableObjectHandle* socketOf(Zig::GlobalObject* globalObject, JSValue ws)
{
    if (!ws.isObject())
        return nullptr;
    JSValue bound = socketMap(globalObject)->get(asObject(ws));
    return bound ? dynamicDowncast<JSDurableObjectHandle>(bound) : nullptr;
}

static void bindSocket(Zig::GlobalObject* globalObject, JSDurableObjectHandle* socket, JSObject* ws, JSArray* tags)
{
    VM& vm = globalObject->vm();
    socket->setTarget(vm, ws);
    socket->setExtra(vm, tags);
    socket->m_finished = true;
    socketMap(globalObject)->add(vm, ws, socket);
    socket->actor()->addSocket(vm, socket);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateAcceptWebSocket, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("acceptWebSocket"_s)
    JSValue ws = callFrame->argument(0);
    if (!ws.inherits<WebCore::JSServerWebSocket>())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "ws"_s, "ServerWebSocket"_s, ws);
    if (auto* accepted = socketOf(globalObject, ws); accepted && !accepted->m_rolledBack)
        return Bun::ERR::INVALID_STATE(scope, globalObject, "This WebSocket was already accepted by a Durable Object"_s);
    JSValue readyState = ws.get(globalObject, WebCore::builtinNames(vm).readyStatePublicName());
    RETURN_IF_EXCEPTION(scope, {});
    if (!readyState.isInt32() || readyState.asInt32() != 1)
        return Bun::ERR::INVALID_STATE(scope, globalObject, "This WebSocket is not open"_s);
    JSArray* tags = validateTags(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    auto* socket = JSDurableObjectHandle::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::SocketStructure), HandleKind::Socket, actor);
    bindSocket(globalObject, socket, asObject(ws), tags);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateGetWebSockets, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("getWebSockets"_s)
    String tag;
    if (!callFrame->argument(0).isUndefined()) {
        V::validateString(scope, globalObject, callFrame->argument(0), "tag"_s);
        RETURN_IF_EXCEPTION(scope, {});
        tag = asString(callFrame->argument(0))->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(actor->socketsWithTag(globalObject, tag)));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateGetTags, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("getTags"_s)
    auto* socket = socketOf(globalObject, callFrame->argument(0));
    if (!socket || socket->actor() != actor)
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "ws"_s, callFrame->argument(0), "is not a WebSocket this Durable Object accepted"_s);
    MarkedArgumentBuffer tags;
    if (auto* array = dynamicDowncast<JSArray>(socket->extra())) {
        for (unsigned i = 0, length = array->length(); i < length; i++)
            tags.append(array->getIndexQuickly(i));
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), tags)));
}

// Answered by the namespace without waking the object: { request: "ping", response: "pong" }.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateSetWebSocketAutoResponse, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("setWebSocketAutoResponse"_s)
    JSValue pair = callFrame->argument(0);
    if (pair.isUndefinedOrNull()) {
        actor->m_autoResponseRequest = String();
        actor->m_autoResponseResponse = String();
        return JSValue::encode(jsUndefined());
    }
    V::validateObject(scope, globalObject, pair, "pair"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue request = pair.get(globalObject, ident(vm, "request"_s));
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, request, "pair.request"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue response = pair.get(globalObject, ident(vm, "response"_s));
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, response, "pair.response"_s);
    RETURN_IF_EXCEPTION(scope, {});
    String requestString = asString(request)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String responseString = asString(response)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    actor->m_autoResponseRequest = requestString.isolatedCopy();
    actor->m_autoResponseResponse = responseString.isolatedCopy();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateGetWebSocketAutoResponse, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("getWebSocketAutoResponse"_s)
    if (actor->m_autoResponseRequest.isNull())
        return JSValue::encode(jsNull());
    JSObject* pair = constructEmptyObject(globalObject);
    pair->putDirect(vm, ident(vm, "request"_s), jsString(vm, actor->m_autoResponseRequest), 0);
    pair->putDirect(vm, ident(vm, "response"_s), jsString(vm, actor->m_autoResponseResponse), 0);
    return JSValue::encode(pair);
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectStateGetWebSocketAutoResponseTimestamp, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_STATE("getWebSocketAutoResponseTimestamp"_s)
    auto* socket = socketOf(globalObject, callFrame->argument(0));
    if (!socket || socket->actor() != actor || !socket->m_autoResponseAt)
        return JSValue::encode(jsNull());
    return JSValue::encode(DateInstance::create(vm, globalObject->dateStructure(), socket->m_autoResponseAt));
}

static const HashTableValue statePrototypeValues[] = {
    { "waitUntil"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateWaitUntil, 1 } },
    { "blockConcurrencyWhile"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateBlockConcurrencyWhile, 1 } },
    { "abort"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateAbort, 0 } },
    { "acceptWebSocket"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateAcceptWebSocket, 1 } },
    { "getWebSockets"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateGetWebSockets, 0 } },
    { "getTags"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateGetTags, 1 } },
    { "setWebSocketAutoResponse"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateSetWebSocketAutoResponse, 0 } },
    { "getWebSocketAutoResponse"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateGetWebSocketAutoResponse, 0 } },
    { "getWebSocketAutoResponseTimestamp"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectStateGetWebSocketAutoResponseTimestamp, 1 } },
};

// ─── The `server` of fetch(request, server) ──────────────────────────────────

#define THIS_SERVER(method)                                                        \
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);                 \
    [[maybe_unused]] VM& vm = globalObject->vm();                                  \
    auto scope = DECLARE_THROW_SCOPE(vm);                                          \
    auto* handle = dynamicDowncast<JSDurableObjectHandle>(callFrame->thisValue()); \
    if (!handle || handle->kind() != HandleKind::Server) [[unlikely]]              \
        return WebCore::throwThisTypeError(*globalObject, scope, "Server"_s, method);

// The socket is this object's: its events come to the object's webSocket*() handlers, and it
// stays connected while the object is evicted.
JSC_DEFINE_HOST_FUNCTION(jsDurableObjectServerUpgrade, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    THIS_SERVER("upgrade"_s)
    if (!handle->isCurrent()) {
        throwException(globalObject, scope, createDurableObjectResetError(globalObject));
        return {};
    }
    JSValue options = callFrame->argument(1);
    JSValue headers = jsUndefined(), data = jsUndefined(), tagsValue = jsUndefined();
    if (!options.isUndefinedOrNull()) {
        V::validateObject(scope, globalObject, options, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        headers = options.get(globalObject, ident(vm, "headers"_s));
        RETURN_IF_EXCEPTION(scope, {});
        data = options.get(globalObject, WebCore::builtinNames(vm).dataPublicName());
        RETURN_IF_EXCEPTION(scope, {});
        tagsValue = options.get(globalObject, ident(vm, "tags"_s));
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSArray* tags = validateTags(globalObject, scope, tagsValue);
    RETURN_IF_EXCEPTION(scope, {});
    auto* socket = JSDurableObjectHandle::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::SocketStructure), HandleKind::Socket, handle->actor());
    socket->setTarget(vm, data);
    socket->setExtra(vm, tags);
    JSObject* upgradeOptions = constructEmptyObject(globalObject);
    upgradeOptions->putDirect(vm, WebCore::builtinNames(vm).dataPublicName(), socket, 0);
    if (!headers.isUndefined())
        upgradeOptions->putDirect(vm, ident(vm, "headers"_s), headers, 0);
    MarkedArgumentBuffer arguments;
    arguments.append(callFrame->argument(0));
    arguments.append(upgradeOptions);
    JSValue upgraded = callMethod(globalObject, handle->target(), "upgrade"_s, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    if (upgraded.isTrue())
        handle->m_finished = true;
    return JSValue::encode(upgraded);
}

#define FORWARDED_SERVER_FUNCTION(name)                                                                                   \
    JSC_DEFINE_HOST_FUNCTION(jsDurableObjectServer_##name, (JSGlobalObject * lexicalGlobalObject, CallFrame * callFrame)) \
    {                                                                                                                     \
        static constexpr auto literal = #name##_s;                                                                        \
        THIS_SERVER(literal)                                                                                              \
        ArgList arguments(callFrame);                                                                                     \
        RELEASE_AND_RETURN(scope, JSValue::encode(callMethod(globalObject, handle->target(), literal, arguments)));       \
    }

FORWARDED_SERVER_FUNCTION(requestIP)
FORWARDED_SERVER_FUNCTION(timeout)
FORWARDED_SERVER_FUNCTION(publish)
FORWARDED_SERVER_FUNCTION(subscriberCount)

#define FORWARDED_SERVER_GETTER(name)                                                                                                     \
    JSC_DEFINE_CUSTOM_GETTER(jsDurableObjectServerGetter_##name, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName)) \
    {                                                                                                                                     \
        [[maybe_unused]] VM& vm = globalObject->vm();                                                                                     \
        auto scope = DECLARE_THROW_SCOPE(vm);                                                                                             \
        auto* handle = dynamicDowncast<JSDurableObjectHandle>(JSValue::decode(thisValue));                                                \
        if (!handle || handle->kind() != HandleKind::Server) [[unlikely]]                                                                 \
            return WebCore::throwThisTypeError(*globalObject, scope, "Server"_s, #name##_s);                                              \
        RELEASE_AND_RETURN(scope, JSValue::encode(handle->target().get(globalObject, ident(vm, #name##_s))));                             \
    }

FORWARDED_SERVER_GETTER(url)
FORWARDED_SERVER_GETTER(port)
FORWARDED_SERVER_GETTER(hostname)
FORWARDED_SERVER_GETTER(development)
FORWARDED_SERVER_GETTER(id)
FORWARDED_SERVER_GETTER(address)
FORWARDED_SERVER_GETTER(protocol)
FORWARDED_SERVER_GETTER(pendingRequests)
FORWARDED_SERVER_GETTER(pendingWebSockets)

static const HashTableValue serverPrototypeValues[] = {
    { "upgrade"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectServerUpgrade, 1 } },
    { "requestIP"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectServer_requestIP, 1 } },
    { "timeout"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectServer_timeout, 2 } },
    { "publish"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectServer_publish, 2 } },
    { "subscriberCount"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectServer_subscriberCount, 1 } },
    { "url"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_url, 0 } },
    { "port"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_port, 0 } },
    { "hostname"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_hostname, 0 } },
    { "development"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_development, 0 } },
    { "id"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_id, 0 } },
    { "address"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_address, 0 } },
    { "protocol"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_protocol, 0 } },
    { "pendingRequests"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_pendingRequests, 0 } },
    { "pendingWebSockets"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsDurableObjectServerGetter_pendingWebSockets, 0 } },
};

// ─── Bun.serve({ websocket: Bun.DurableObject.websocket }) ───────────────────
//
// One handler object for every namespace. A socket that no Durable Object accepted is left alone.
// A socket a Durable Object accepted is the server's, not the object's graph's, so it stays
// connected while the object is evicted; `ws.data` is the application's.

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSocketOpen, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue ws = callFrame->argument(0);
    if (!ws.isObject())
        return JSValue::encode(jsUndefined());
    JSValue data = ws.get(globalObject, WebCore::builtinNames(vm).dataPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    auto* socket = dynamicDowncast<JSDurableObjectHandle>(data);
    if (!socket || socket->kind() != HandleKind::Socket || socket->m_finished)
        return JSValue::encode(jsUndefined());
    PutPropertySlot slot(ws);
    asObject(ws)->methodTable()->put(asObject(ws), globalObject, WebCore::builtinNames(vm).dataPublicName(), socket->target() ? socket->target() : jsUndefined(), slot);
    RETURN_IF_EXCEPTION(scope, {});
    auto* actor = socket->actor();
    ModuleGraphContextScope context(actor->ns()->context());
    if (actor->ns()->isClosed()) {
        MarkedArgumentBuffer arguments;
        arguments.append(jsNumber(1001));
        arguments.append(jsNontrivialString(vm, "Durable Object namespace closed"_s));
        callMethod(globalObject, ws, "close"_s, arguments);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }
    auto* tags = dynamicDowncast<JSArray>(socket->extra());
    if (!tags)
        return JSValue::encode(jsUndefined());
    bindSocket(globalObject, socket, asObject(ws), tags);
    actor->post(globalObject, DurableObjectEventKind::SocketOpen, ws, jsUndefined(), jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSocketMessage, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue ws = callFrame->argument(0);
    JSValue message = callFrame->argument(1);
    auto* socket = socketOf(globalObject, ws);
    if (!socket || socket->m_rolledBack)
        return JSValue::encode(jsUndefined());
    auto* actor = socket->actor();
    if (!actor->m_autoResponseRequest.isNull() && message.isString()) {
        bool matches = asString(message)->value(globalObject) == actor->m_autoResponseRequest;
        RETURN_IF_EXCEPTION(scope, {});
        if (matches) {
            socket->m_autoResponseAt = nowMs();
            MarkedArgumentBuffer arguments;
            arguments.append(jsString(vm, actor->m_autoResponseResponse));
            callMethod(globalObject, ws, "send"_s, arguments);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        }
    }
    ModuleGraphContextScope context(actor->ns()->context());
    actor->post(globalObject, DurableObjectEventKind::SocketMessage, ws, message, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSocketClose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue ws = callFrame->argument(0);
    auto* socket = socketOf(globalObject, ws);
    if (!socket || socket->m_rolledBack)
        return JSValue::encode(jsUndefined());
    auto* actor = socket->actor();
    ModuleGraphContextScope context(actor->ns()->context());
    socket->m_rolledBack = true;
    actor->removeSocket(socket);
    actor->post(globalObject, DurableObjectEventKind::SocketClose, ws, callFrame->argument(1), callFrame->argument(2));
    actor->ns()->forget(actor);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectSocketDrain, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue ws = callFrame->argument(0);
    auto* socket = socketOf(globalObject, ws);
    if (!socket || socket->m_rolledBack)
        return JSValue::encode(jsUndefined());
    auto* actor = socket->actor();
    ModuleGraphContextScope context(actor->ns()->context());
    actor->post(globalObject, DurableObjectEventKind::SocketDrain, ws, jsUndefined(), jsUndefined());
    return JSValue::encode(jsUndefined());
}

// ─── The namespace ───────────────────────────────────────────────────────────

// Hears when the context the namespace was made in stops (the Bun.ModuleGraph whose script made it
// was disposed). The root context only stops with the VM.
class JSDurableObjectNamespace::ContextObserver final : public RefCounted<JSDurableObjectNamespace::ContextObserver>, public WebCore::ActiveDOMObject {
public:
    static Ref<ContextObserver> create(WebCore::ScriptExecutionContext& context, JSDurableObjectNamespace* owner)
    {
        Ref observer = adoptRef(*new ContextObserver(context, owner));
        observer->suspendIfNeeded();
        return observer;
    }
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    void stop() final
    {
        if (auto* owner = std::exchange(m_owner, nullptr))
            owner->contextStopped();
    }
    void detach() { m_owner = nullptr; }

private:
    ContextObserver(WebCore::ScriptExecutionContext& context, JSDurableObjectNamespace* owner)
        : WebCore::ActiveDOMObject(&context)
        , m_owner(owner)
    {
    }
    JSDurableObjectNamespace* m_owner;
};

const ClassInfo JSDurableObjectNamespace::s_info = { "DurableObjectNamespace"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectNamespace) };

JSDurableObjectNamespace::JSDurableObjectNamespace(VM& vm, Structure* structure, Ref<WebCore::ScriptExecutionContext>&& context)
    : Base(vm, structure)
    , m_context(WTF::move(context))
    , m_namedIds(vm)
    , m_alarmTimer(vm.runLoop(), "DurableObjectNamespace::alarm"_s, [this] { alarmTimerFired(); })
    , m_sweepTimer(vm.runLoop(), "DurableObjectNamespace::sweep"_s, [this] { sweepTimerFired(); })
{
}

JSDurableObjectNamespace::~JSDurableObjectNamespace()
{
    if (m_contextObserver)
        m_contextObserver->detach();
}

// Nothing of the context runs again, so there is nothing to tell: what the namespace holds outside
// the heap is let go of, and the objects' graphs were the context's and stopped with it.
void JSDurableObjectNamespace::contextStopped()
{
    m_contextStopped = true;
    m_alarmTimer.stop();
    m_sweepTimer.stop();
    if (std::exchange(m_keepsEventLoopAlive, false))
        m_context->unrefEventLoop();
    for (auto* actor : m_actors.values())
        actor->stoppedWithContext();
    m_index = nullptr;
    // A close() that was waiting for the objects has nothing left to wait for.
    if (auto* closing = m_closing.get()) {
        auto* globalObject = defaultGlobalObject(m_context->jsGlobalObject());
        closing->resolve(globalObject, globalObject->vm(), jsUndefined());
    }
    m_keepAlive.clear();
}

void JSDurableObjectNamespace::destroy(JSCell* cell)
{
    static_cast<JSDurableObjectNamespace*>(cell)->~JSDurableObjectNamespace();
}

Structure* JSDurableObjectNamespace::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename Visitor>
void JSDurableObjectNamespace::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSDurableObjectNamespace>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_class);
    visitor.append(thisObject->m_globals);
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_env);
    visitor.append(thisObject->m_closing);
    Locker locker { thisObject->cellLock() };
    for (auto* actor : thisObject->m_actors.values())
        visitor.appendUnbarriered(actor);
    for (auto* actor : thisObject->m_idle)
        visitor.appendUnbarriered(actor);
}
DEFINE_VISIT_CHILDREN(JSDurableObjectNamespace);

JSDurableObjectNamespace* JSDurableObjectNamespace::create(Zig::GlobalObject* globalObject, ThrowScope& scope, Structure* structure, Options&& options)
{
    VM& vm = globalObject->vm();
    String error;
    bool inUse = false;
    auto index = DurableObjectAlarmIndex::open(options.storageDirectory, error, inUse);
    if (!index) {
        if (inUse)
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_DURABLE_OBJECT_STORAGE_IN_USE, makeString("The Durable Object storage at "_s, options.storageDirectory, " is in use by another DurableObjectNamespace, in this process or another"_s)));
        else
            throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_SQLITE_ERROR, error));
        return nullptr;
    }
    // A namespace made by a Bun.ModuleGraph's script is that graph's, with everything in it.
    Ref context = *globalObject->currentScriptExecutionContext();
    auto* ns = new (NotNull, allocateCell<JSDurableObjectNamespace>(vm)) JSDurableObjectNamespace(vm, structure, WTF::move(context));
    ns->finishCreation(vm);
    ns->m_index = WTF::move(index);
    ns->m_name = WTF::move(options.name).isolatedCopy();
    ns->m_modulePath = WTF::move(options.modulePath).isolatedCopy();
    ns->m_exportName = WTF::move(options.exportName).isolatedCopy();
    ns->m_storageDirectory = WTF::move(options.storageDirectory).isolatedCopy();
    ns->m_idleTimeoutMs = options.idleTimeoutMs;
    if (options.classValue)
        ns->m_class.set(vm, ns, options.classValue);
    if (options.globals)
        ns->m_globals.set(vm, ns, options.globals);
    if (options.onError)
        ns->m_onError.set(vm, ns, options.onError);
    if (options.env)
        ns->m_env.set(vm, ns, options.env);
    CString seed = makeString("bun:DurableObjectNamespace"_s, '\0', ns->m_name).utf8();
    SHA256(reinterpret_cast<const uint8_t*>(seed.data()), seed.length(), ns->m_key.data());
    if (ns->m_context->isForModuleGraph())
        ns->m_contextObserver = ContextObserver::create(ns->m_context.get(), ns);
    ns->scheduleAlarms();
    ns->updateKeepAlive();
    return ns;
}

// An id is 24 bytes that say which object (random, or derived from the name; the top bit tells
// the two apart) followed by 8 bytes of HMAC under the namespace's key, so that an id of another
// namespace, or a string that is no id at all, is refused by idFromString().
JSString* JSDurableObjectNamespace::sealId(Zig::GlobalObject* globalObject, std::span<const uint8_t> payload)
{
    std::array<uint8_t, 32> bytes;
    memcpy(bytes.data(), payload.data(), 24);
    std::array<uint8_t, 32> mac;
    unsigned macLength = 0;
    HMAC(EVP_sha256(), m_key.data(), m_key.size(), bytes.data(), 24, mac.data(), &macLength);
    memcpy(bytes.data() + 24, mac.data(), 8);
    std::span<Latin1Character> characters;
    String hex = String::createUninitialized(64, characters);
    for (unsigned i = 0; i < 32; i++) {
        characters[i * 2] = upperNibbleToLowercaseASCIIHexDigit(bytes[i]);
        characters[i * 2 + 1] = lowerNibbleToLowercaseASCIIHexDigit(bytes[i]);
    }
    return jsNontrivialString(globalObject->vm(), WTF::move(hex));
}

JSDurableObjectId* JSDurableObjectNamespace::idFromName(Zig::GlobalObject* globalObject, JSString* name)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    String key = name->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (auto* known = m_namedIds.get(key))
        return known;
    auto utf8 = UTF8View::tryCreate(globalObject, scope, key);
    RETURN_IF_EXCEPTION(scope, nullptr);
    std::array<uint8_t, 32> payload;
    unsigned length = 0;
    HMAC(EVP_sha256(), m_key.data(), m_key.size(), utf8->bytes().data(), utf8->bytes().size(), payload.data(), &length);
    payload[0] |= 0x80;
    auto* id = JSDurableObjectId::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::IdStructure), this, sealId(globalObject, payload), name);
    m_namedIds.set(key.isolatedCopy(), id);
    return id;
}

JSDurableObjectId* JSDurableObjectNamespace::newUniqueId(Zig::GlobalObject* globalObject)
{
    std::array<uint8_t, 24> payload;
    RAND_bytes(payload.data(), payload.size());
    payload[0] &= 0x7f;
    return JSDurableObjectId::create(globalObject->vm(), JSDurableObjectRealm::of(globalObject)->structure(Field::IdStructure), this, sealId(globalObject, payload), nullptr);
}

JSDurableObjectId* JSDurableObjectNamespace::idFromString(Zig::GlobalObject* globalObject, ThrowScope& scope, JSString* hexString)
{
    VM& vm = globalObject->vm();
    String hex = hexString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    std::array<uint8_t, 32> bytes;
    bool valid = hex.length() == 64;
    for (unsigned i = 0; valid && i < 32; i++) {
        char16_t high = hex[i * 2], low = hex[i * 2 + 1];
        valid = isASCIIHexDigit(high) && isASCIIHexDigit(low) && !isASCIIUpper(high) && !isASCIIUpper(low);
        if (valid)
            bytes[i] = toASCIIHexValue(high, low);
    }
    if (!valid) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "id"_s, hexString, "is not a Durable Object id (64 lowercase hex digits)"_s);
        return nullptr;
    }
    JSString* sealed = sealId(globalObject, std::span<const uint8_t>(bytes).first(24));
    if (sealed->tryGetValue() != hex) {
        Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "id"_s, hexString, makeString("is not an id of the DurableObjectNamespace \""_s, m_name, '"'));
        return nullptr;
    }
    return JSDurableObjectId::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::IdStructure), this, sealed, nullptr);
}

JSDurableObjectActor* JSDurableObjectNamespace::actorFor(Zig::GlobalObject* globalObject, JSDurableObjectId* id)
{
    VM& vm = globalObject->vm();
    String hex = id->hex()->tryGetValue();
    if (auto* actor = m_actors.get(hex)) {
        // An object learns its name from whoever addresses it by name first.
        if (!actor->id()->name() && id->name())
            actor->setId(vm, id);
        return actor;
    }
    auto* actor = JSDurableObjectActor::create(vm, JSDurableObjectRealm::of(globalObject)->structure(Field::ActorStructure), this, id);
    {
        Locker locker { cellLock() };
        m_actors.add(hex, actor);
    }
    vm.writeBarrier(this, actor);
    return actor;
}

JSPromise* JSDurableObjectNamespace::dispatch(Zig::GlobalObject* globalObject, JSDurableObjectStub* stub, DurableObjectEventKind kind, JSValue a, JSValue b, const ArgList* arguments)
{
    if (isClosed())
        return JSPromise::rejectedPromise(globalObject, createClosedError(globalObject));
    JSModuleGraph* callerGraph = globalObject->hasModuleGraphs() ? currentModuleGraph(globalObject) : nullptr;
    ModuleGraphContextScope context(m_context.get());
    return stub->actor(globalObject)->request(globalObject, kind, a, b, arguments, callerGraph);
}

void JSDurableObjectNamespace::reportError(Zig::GlobalObject* globalObject, JSValue error, JSDurableObjectActor* actor)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = m_onError.get();
    if (!onError) {
        Bun__reportUnhandledError(globalObject, JSValue::encode(error));
        return;
    }
    ModuleGraphContextScope context(m_context.get());
    MarkedArgumentBuffer arguments;
    arguments.append(error);
    arguments.append(actor->id());
    call(globalObject, onError, JSC::getCallData(onError), jsUndefined(), arguments);
    if (auto* exception = scope.exception()) [[unlikely]] {
        JSValue thrown = exception->value();
        if (scope.clearExceptionExceptTermination())
            Bun__reportUnhandledError(globalObject, JSValue::encode(thrown));
    }
}

// An idle object is evicted between one and two idleTimeouts after it was last used: what a call
// costs is a flag, and the clock is read when the list is swept.
void JSDurableObjectNamespace::actorBecameIdle(JSDurableObjectActor* actor)
{
    if (!actor->m_inIdleList) {
        actor->m_inIdleList = true;
        actor->m_usedSinceIdle = false;
        actor->m_idleSince = nowMs();
        {
            Locker locker { cellLock() };
            m_idle.append(actor);
        }
        vm().writeBarrier(this, actor);
    }
    if (m_closing) {
        later(&JSDurableObjectNamespace::finishClosing);
        return;
    }
    if (!m_sweepTimer.isActive())
        m_sweepTimer.startOneShot(Seconds::fromMilliseconds(std::max(1.0, m_idleTimeoutMs)));
}

// From the event loop, in the namespace's own context.
void JSDurableObjectNamespace::later(void (JSDurableObjectNamespace::*step)(Zig::GlobalObject*))
{
    m_context->postTask([ns = Strong<JSDurableObjectNamespace>(vm(), this), step](WebCore::ScriptExecutionContext& context) {
        auto* self = ns.get();
        if (self->m_contextStopped)
            return;
        ModuleGraphContextScope scope(self->context());
        (self->*step)(defaultGlobalObject(context.jsGlobalObject()));
    });
}

void JSDurableObjectNamespace::actorWasReset()
{
    if (!m_closing)
        return;
    later(&JSDurableObjectNamespace::finishClosing);
}

void JSDurableObjectNamespace::actorBecameBusy(JSDurableObjectActor* actor)
{
    actor->m_usedSinceIdle = true;
}

void JSDurableObjectNamespace::forget(JSDurableObjectActor* actor)
{
    if (actor->state() != JSDurableObjectActor::State::Unloaded || actor->hasKeptState() || actor->isBusy() || actor->m_forgotten)
        return;
    actor->m_forgotten = true;
    Locker locker { cellLock() };
    m_actors.remove(actor->id()->hex()->tryGetValue());
}

void JSDurableObjectNamespace::sweepTimerFired()
{
    later(&JSDurableObjectNamespace::sweep);
}

void JSDurableObjectNamespace::sweep(Zig::GlobalObject* globalObject)
{
    if (isClosed())
        return;
    double now = nowMs();
    for (size_t remaining = m_idle.size(); remaining && !m_idle.isEmpty(); remaining--) {
        JSDurableObjectActor* actor = m_idle.first();
        bool idle = actor->isIdle();
        if (idle && !actor->m_usedSinceIdle) {
            double left = actor->m_idleSince + m_idleTimeoutMs - now;
            if (left > 0) {
                m_sweepTimer.startOneShot(Seconds::fromMilliseconds(std::max(1.0, left)));
                return;
            }
        }
        {
            Locker locker { cellLock() };
            m_idle.removeFirst();
            if (idle && actor->m_usedSinceIdle)
                m_idle.append(actor);
        }
        if (!idle)
            actor->m_inIdleList = false;
        else if (actor->m_usedSinceIdle) {
            actor->m_usedSinceIdle = false;
            actor->m_idleSince = now;
        } else {
            actor->m_inIdleList = false;
            actor->evict(globalObject);
        }
    }
    if (!m_idle.isEmpty())
        m_sweepTimer.startOneShot(Seconds::fromMilliseconds(std::max(1.0, m_idleTimeoutMs)));
}

void JSDurableObjectNamespace::scheduleAlarms()
{
    if (isClosed())
        return;
    auto next = m_index->next();
    if (!next) {
        m_alarmTimer.stop();
        m_alarmTimerAt = 0;
    } else if (!m_alarmTimer.isActive() || m_alarmTimerAt != static_cast<double>(*next)) {
        m_alarmTimerAt = static_cast<double>(*next);
        m_alarmTimer.startOneShot(Seconds::fromMilliseconds(std::max(1.0, m_alarmTimerAt - nowMs())));
    }
    // An alarm that is set keeps the process running, as a timer would.
    bool keeps = !!next;
    if (keeps != m_keepsEventLoopAlive) {
        m_keepsEventLoopAlive = keeps;
        if (keeps)
            m_context->refEventLoop();
        else
            m_context->unrefEventLoop();
    }
}

void JSDurableObjectNamespace::alarmTimerFired()
{
    m_alarmTimerAt = 0;
    later(&JSDurableObjectNamespace::fireAlarms);
}

void JSDurableObjectNamespace::fireAlarms(Zig::GlobalObject* globalObject)
{
    if (isClosed())
        return;
    VM& vm = globalObject->vm();
    auto* realm = JSDurableObjectRealm::of(globalObject);
    for (auto& hex : m_index->due(static_cast<int64_t>(nowMs()))) {
        JSDurableObjectActor* actor = m_actors.get(hex);
        if (!actor) {
            auto* id = JSDurableObjectId::create(vm, realm->structure(Field::IdStructure), this, jsNontrivialString(vm, hex), nullptr);
            actor = actorFor(globalObject, id);
        }
        // Until the alarm has run (or is found not to be due), keep the timer off this entry:
        // endAlarm() and beginAlarm() put back what is stored.
        m_index->set(hex, static_cast<int64_t>(nowMs() + 1000.0 * (1 << (maxAlarmRetries + 1))));
        if (actor->m_alarmRunning)
            continue;
        actor->post(globalObject, DurableObjectEventKind::Alarm, jsUndefined(), jsUndefined(), jsUndefined());
    }
    scheduleAlarms();
}

void JSDurableObjectNamespace::updateKeepAlive()
{
    bool keep = !isClosed() && (m_loadedCount || m_socketCount || m_alarmTimer.isActive());
    if (keep == !!m_keepAlive)
        return;
    if (keep)
        m_keepAlive.set(vm(), this);
    else
        m_keepAlive.clear();
}

// Waits for what is running to finish, evicts every object and closes the storage. Calls made
// from now on fail.
JSPromise* JSDurableObjectNamespace::close(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    // The context it was made in is gone, and what it held with it: there is nothing to wait for.
    if (m_contextStopped || m_context->isStopped()) {
        if (!m_contextStopped)
            contextStopped();
        return JSPromise::resolvedPromise(globalObject, jsUndefined());
    }
    if (m_closing)
        return m_closing.get();
    ModuleGraphContextScope context(m_context.get());
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    m_closing.set(vm, this, promise);
    m_alarmTimer.stop();
    m_sweepTimer.stop();
    if (m_keepsEventLoopAlive) {
        m_keepsEventLoopAlive = false;
        m_context->unrefEventLoop();
    }
    finishClosing(globalObject);
    return promise;
}

void JSDurableObjectNamespace::finishClosing(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    if (!m_index)
        return;
    // What the objects of a namespace whose own context was stopped are waiting for never comes.
    bool stopped = m_context->isStopped();
    MarkedArgumentBuffer actors;
    for (auto* actor : m_actors.values()) {
        if (!stopped && (actor->isBusy() || actor->m_blockers))
            return;
        actors.append(actor);
    }
    for (unsigned i = 0; i < actors.size(); i++) {
        auto* actor = uncheckedDowncast<JSDurableObjectActor>(actors.at(i).asCell());
        actor->closeSockets(globalObject, 1001, "Durable Object namespace closed"_s);
        if (stopped && actor->isBusy())
            actor->abort(globalObject, createClosedError(globalObject));
        else if (actor->state() == JSDurableObjectActor::State::Running) {
            actor->flush(globalObject);
            actor->unload(globalObject);
        }
        actor->closeDatabase();
    }
    {
        Locker locker { cellLock() };
        m_actors.clear();
        m_idle.clear();
    }
    m_index = nullptr;
    m_keepAlive.clear();
    m_closing->resolve(globalObject, vm, jsUndefined());
}

// ── new Bun.DurableObjectNamespace(options) ──

static JSDurableObjectNamespace* thisNamespace(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* ns = dynamicDowncast<JSDurableObjectNamespace>(thisValue);
    if (!ns) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "DurableObjectNamespace"_s, method);
    return ns;
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceNewUniqueId, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "newUniqueId"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(ns->newUniqueId(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceIdFromName, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "idFromName"_s);
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, callFrame->argument(0), "name"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(ns->idFromName(globalObject, asString(callFrame->argument(0)))));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceIdFromString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "idFromString"_s);
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, callFrame->argument(0), "id"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(ns->idFromString(globalObject, scope, asString(callFrame->argument(0)))));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceGet, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "get"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* id = dynamicDowncast<JSDurableObjectId>(callFrame->argument(0));
    if (!id)
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "id"_s, "DurableObjectId"_s, callFrame->argument(0));
    if (id->ns() != ns)
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "id"_s, id->hex(), "belongs to a different DurableObjectNamespace"_s);
    return JSValue::encode(id->stub(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceGetByName, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "getByName"_s);
    RETURN_IF_EXCEPTION(scope, {});
    V::validateString(scope, globalObject, callFrame->argument(0), "name"_s);
    RETURN_IF_EXCEPTION(scope, {});
    auto* id = ns->idFromName(globalObject, asString(callFrame->argument(0)));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(id->stub(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsDurableObjectNamespaceClose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* ns = thisNamespace(globalObject, scope, callFrame->thisValue(), "close"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(ns->close(globalObject)));
}

static const HashTableValue namespacePrototypeValues[] = {
    { "newUniqueId"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceNewUniqueId, 0 } },
    { "idFromName"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceIdFromName, 1 } },
    { "idFromString"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceIdFromString, 1 } },
    { "get"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceGet, 1 } },
    { "getByName"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceGetByName, 1 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsDurableObjectNamespaceClose, 0 } },
};

static JSC_DECLARE_HOST_FUNCTION(constructDurableObjectNamespace);
static JSC_DECLARE_HOST_FUNCTION(callDurableObjectNamespace);
static JSC_DECLARE_HOST_FUNCTION(constructDurableObject);
static JSC_DECLARE_HOST_FUNCTION(callDurableObject);

class JSDurableObjectClassConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    DECLARE_INFO;
    template<typename, SubspaceAccess> static GCClient::IsoSubspace* subspaceFor(VM& vm) { return &vm.internalFunctionSpace(); }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return createClassStructure(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }
    static JSDurableObjectClassConstructor* create(VM& vm, JSGlobalObject* globalObject, NativeFunction call, NativeFunction construct, ASCIILiteral name, unsigned length, JSObject* prototype)
    {
        Structure* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
        auto* constructor = new (NotNull, allocateCell<JSDurableObjectClassConstructor>(vm)) JSDurableObjectClassConstructor(vm, structure, call, construct);
        constructor->finishCreation(vm, length, name, PropertyAdditionMode::WithoutStructureTransition);
        constructor->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
        prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
        return constructor;
    }

private:
    JSDurableObjectClassConstructor(VM& vm, Structure* structure, NativeFunction call, NativeFunction construct)
        : Base(vm, structure, call, construct)
    {
    }
};

const ClassInfo JSDurableObjectClassConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectClassConstructor) };

JSC_DEFINE_HOST_FUNCTION(callDurableObjectNamespace, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Class constructor DurableObjectNamespace cannot be invoked without 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(callDurableObject, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Class constructor DurableObject cannot be invoked without 'new'"_s);
}

// encodeURIComponent(name), except for what a file system would take for something else: a name of
// nothing but dots, and `*`. Null with an exception thrown for a name that is not well-formed Unicode.
static String directoryNameFor(Zig::GlobalObject* globalObject, ThrowScope& scope, const String& name)
{
    StringBuilder builder;
    auto result = JSC::encodeURIComponent(globalObject->vm(), name, builder);
    if (result.hasException()) {
        WebCore::propagateException(*globalObject, scope, result.releaseException());
        return String();
    }
    String encoded = builder.toString();
    if (encoded.containsOnly<[](char16_t c) { return c == '.'; }>())
        return makeStringByReplacingAll(encoded, "."_s, "%2E"_s);
    return makeStringByReplacingAll(encoded, "*"_s, "%2A"_s);
}

// new Bun.DurableObjectNamespace({ class | module, export?, name?, storage?, env?, idleTimeout?, globals?, onError? })
JSC_DEFINE_HOST_FUNCTION(constructDurableObjectNamespace, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue optionsValue = callFrame->argument(0);
    V::validateObject(scope, globalObject, optionsValue, "options"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* object = asObject(optionsValue);
    auto read = [&](ASCIILiteral name) -> JSValue {
        RELEASE_AND_RETURN(scope, object->get(globalObject, ident(vm, name)));
    };

    JSDurableObjectNamespace::Options options;
    JSValue classValue = read("class"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue moduleValue = read("module"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue exportValue = read("export"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue globalsValue = read("globals"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!classValue.isUndefined() && !moduleValue.isUndefined())
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options"_s, optionsValue, "takes either \"class\" or \"module\", not both"_s);
    if (!classValue.isUndefined()) {
        if (!classValue.isConstructor())
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.class"_s, "class"_s, classValue);
        if (!exportValue.isUndefined())
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.export"_s, exportValue, "is only used together with \"module\""_s);
        if (!globalsValue.isUndefined())
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.globals"_s, globalsValue, "is only used together with \"module\""_s);
        options.classValue = asObject(classValue);
    } else if (!moduleValue.isUndefined()) {
        V::validateString(scope, globalObject, moduleValue, "options.module"_s);
        RETURN_IF_EXCEPTION(scope, {});
        options.exportName = "default"_s;
        if (!exportValue.isUndefined()) {
            V::validateString(scope, globalObject, exportValue, "options.export"_s);
            RETURN_IF_EXCEPTION(scope, {});
            options.exportName = asString(exportValue)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        if (!globalsValue.isUndefined()) {
            V::validateObject(scope, globalObject, globalsValue, "options.globals"_s);
            RETURN_IF_EXCEPTION(scope, {});
            // As they are now: every object of the namespace gets the same names and values.
            JSObject* given = asObject(globalsValue);
            PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            given->methodTable()->getOwnPropertyNames(given, globalObject, names, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, {});
            options.globals = constructEmptyObject(globalObject);
            for (auto& name : names) {
                JSValue value = given->get(globalObject, name);
                RETURN_IF_EXCEPTION(scope, {});
                options.globals->putDirect(vm, name, value, 0);
            }
        }
        // Resolved now, against the working directory, like a graph's import() would later.
        JSValue cwd = JSValue::decode(Bun__Process__getCwd(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        String directory = cwd.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue referrer = jsString(vm, makeString(directory, PLATFORM_SEP_s, "[durable-object]"_s));
        JSValue resolved = JSValue::decode(Bun__resolveSync(globalObject, JSValue::encode(moduleValue), JSValue::encode(referrer), true, false));
        RETURN_IF_EXCEPTION(scope, {});
        options.modulePath = resolved.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options"_s, optionsValue, "needs a \"class\" or a \"module\""_s);

    JSValue nameValue = read("name"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!nameValue.isUndefined()) {
        V::validateString(scope, globalObject, nameValue, "options.name"_s);
        RETURN_IF_EXCEPTION(scope, {});
        options.name = asString(nameValue)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (options.classValue) {
        JSValue className = options.classValue->get(globalObject, vm.propertyNames->name);
        RETURN_IF_EXCEPTION(scope, {});
        if (className.isString()) {
            options.name = asString(className)->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    } else
        options.name = options.exportName == "default"_s ? options.modulePath : options.exportName;
    if (options.name.isEmpty())
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.name"_s, nameValue, "must be a non-empty string when the class has no name"_s);
    if (hasUnpairedSurrogate(options.name))
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.name"_s, jsString(vm, options.name), "must be well-formed Unicode"_s);

    JSValue storageValue = read("storage"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!storageValue.isUndefined()) {
        V::validateString(scope, globalObject, storageValue, "options.storage"_s);
        RETURN_IF_EXCEPTION(scope, {});
        String storage = asString(storageValue)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (storage.isEmpty())
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "options.storage"_s, storageValue, "must be a directory or \":memory:\""_s);
        if (storage != ":memory:"_s) {
            String root = pathResolveWTFString(globalObject, storage);
            RETURN_IF_EXCEPTION(scope, {});
            String directory = directoryNameFor(globalObject, scope, options.name);
            RETURN_IF_EXCEPTION(scope, {});
            options.storageDirectory = makeString(root, PLATFORM_SEP_s, directory);
        }
    }

    options.env = read("env"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue idleTimeout = read("idleTimeout"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!idleTimeout.isUndefined()) {
        if (!idleTimeout.isNumber() || !(idleTimeout.asNumber() >= 0) || !std::isfinite(idleTimeout.asNumber()))
            return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "options.idleTimeout"_s, "a non-negative number of milliseconds"_s, idleTimeout);
        options.idleTimeoutMs = idleTimeout.asNumber();
    }

    JSValue onError = read("onError"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!onError.isUndefined()) {
        V::validateFunction(scope, globalObject, onError, "options.onError"_s);
        RETURN_IF_EXCEPTION(scope, {});
        options.onError = asObject(onError);
    }

    auto* realm = JSDurableObjectRealm::of(globalObject);
    Structure* structure = realm->structure(Field::NamespaceStructure);
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(JSDurableObjectNamespace::create(globalObject, scope, structure, WTF::move(options))));
}

// class extends Bun.DurableObject: constructor(ctx, env) { this.ctx = ctx; this.env = env; }
JSC_DEFINE_HOST_FUNCTION(constructDurableObject, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* state = dynamicDowncast<JSDurableObjectHandle>(callFrame->argument(0));
    if (!state || state->kind() != HandleKind::State)
        return throwVMTypeError(globalObject, scope, "A DurableObject is constructed by its DurableObjectNamespace. Get a stub with namespace.get(id) or namespace.getByName(name) and call that."_s);
    auto* realm = JSDurableObjectRealm::of(globalObject);
    Structure* structure = realm->structure(Field::DurableObjectStructure);
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSObject* instance = constructEmptyObject(vm, structure);
    instance->putDirect(vm, WebCore::builtinNames(vm).ctxPublicName(), state, 0);
    instance->putDirect(vm, ident(vm, "env"_s), callFrame->argument(1), 0);
    return JSValue::encode(instance);
}

// ─── The realm ───────────────────────────────────────────────────────────────

const ClassInfo JSDurableObjectRealm::s_info = { "DurableObjectRealm"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDurableObjectRealm) };

Structure* JSDurableObjectRealm::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(ObjectType, StructureFlags), info());
}

JSDurableObjectRealm* JSDurableObjectRealm::create(VM& vm, Zig::GlobalObject* globalObject)
{
    Structure* structure = createStructure(vm, globalObject);
    auto* realm = new (NotNull, allocateCell<JSDurableObjectRealm>(vm)) JSDurableObjectRealm(vm, structure);
    realm->finishCreation(vm, globalObject);
    return realm;
}

JSDurableObjectRealm* JSDurableObjectRealm::of(Zig::GlobalObject* globalObject)
{
    return uncheckedDowncast<JSDurableObjectRealm>(globalObject->m_durableObjectRealm.getInitializedOnMainThread(globalObject));
}

void JSDurableObjectRealm::finishCreation(VM& vm, Zig::GlobalObject* globalObject)
{
    Base::finishCreation(vm);
    auto set = [&](Field field, JSValue value) { internalField(static_cast<uint32_t>(field)).set(vm, this, value); };
    for (uint32_t i = 0; i < numberOfInternalFields; i++)
        internalField(i).set(vm, this, jsUndefined());

    JSObject* namespacePrototype = createDurableObjectPrototype(vm, globalObject, JSDurableObjectNamespace::info(), namespacePrototypeValues, "DurableObjectNamespace"_s);
    namespacePrototype->putDirect(vm, vm.propertyNames->asyncDisposeSymbol, namespacePrototype->getDirect(vm, ident(vm, "close"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    set(Field::NamespaceStructure, JSDurableObjectNamespace::createStructure(vm, globalObject, namespacePrototype));
    set(Field::NamespaceConstructor, JSDurableObjectClassConstructor::create(vm, globalObject, callDurableObjectNamespace, constructDurableObjectNamespace, "DurableObjectNamespace"_s, 1, namespacePrototype));

    JSObject* durableObjectPrototype = constructEmptyObject(globalObject, globalObject->objectPrototype());
    set(Field::DurableObjectStructure, globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, durableObjectPrototype, 2));
    auto* durableObjectConstructor = JSDurableObjectClassConstructor::create(vm, globalObject, callDurableObject, constructDurableObject, "DurableObject"_s, 2, durableObjectPrototype);
    set(Field::DurableObjectConstructor, durableObjectConstructor);

    JSObject* handler = constructEmptyObject(globalObject);
    handler->putDirectNativeFunction(vm, globalObject, ident(vm, "open"_s), 1, jsDurableObjectSocketOpen, ImplementationVisibility::Public, NoIntrinsic, 0);
    handler->putDirectNativeFunction(vm, globalObject, ident(vm, "message"_s), 2, jsDurableObjectSocketMessage, ImplementationVisibility::Public, NoIntrinsic, 0);
    handler->putDirectNativeFunction(vm, globalObject, ident(vm, "close"_s), 3, jsDurableObjectSocketClose, ImplementationVisibility::Public, NoIntrinsic, 0);
    handler->putDirectNativeFunction(vm, globalObject, ident(vm, "drain"_s), 1, jsDurableObjectSocketDrain, ImplementationVisibility::Public, NoIntrinsic, 0);
    set(Field::WebSocketHandler, handler);
    set(Field::SocketMap, JSWeakMap::create(vm, globalObject->weakMapStructure()));
    durableObjectConstructor->putDirect(vm, ident(vm, "websocket"_s), handler, PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);

    set(Field::IdStructure, JSDurableObjectId::createStructure(vm, globalObject, createDurableObjectPrototype(vm, globalObject, JSDurableObjectId::info(), idPrototypeValues, "DurableObjectId"_s)));
    JSObject* stubPrototype = createDurableObjectPrototype(vm, globalObject, JSDurableObjectStub::info(), stubPrototypeValues, "DurableObjectStub"_s);
    stubPrototype->putDirect(vm, vm.propertyNames->constructor, jsUndefined(), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    set(Field::StubStructure, JSDurableObjectStub::createStructure(vm, globalObject, stubPrototype));

    JSObject* rpcPrototype = constructEmptyObject(globalObject, globalObject->functionPrototype());
    rpcPrototype->putDirectNativeFunction(vm, globalObject, vm.propertyNames->then, 2, jsDurableObjectRpcThen, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontEnum));
    set(Field::RpcFunctionStructure, JSDurableObjectRpcFunction::createStructure(vm, globalObject, rpcPrototype));

    set(Field::StateStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), statePrototypeValues, "DurableObjectState"_s)));
    set(Field::StorageStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectStoragePrototype(vm, globalObject)));
    set(Field::SqlStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectSqlPrototype(vm, globalObject)));
    set(Field::KvStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectKvPrototype(vm, globalObject)));
    set(Field::TransactionStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectTransactionPrototype(vm, globalObject)));
    set(Field::SocketStructure, JSDurableObjectHandle::createStructure(vm, globalObject, jsNull()));
    set(Field::ServerStructure, JSDurableObjectHandle::createStructure(vm, globalObject, createDurableObjectPrototype(vm, globalObject, JSDurableObjectHandle::info(), serverPrototypeValues, "Server"_s)));
    set(Field::CursorStructure, createDurableObjectCursorStructure(vm, globalObject, false));
    set(Field::RawCursorStructure, createDurableObjectCursorStructure(vm, globalObject, true));
    set(Field::ActorStructure, JSDurableObjectActor::createStructure(vm, globalObject));
    set(Field::EventStructure, JSDurableObjectEvent::createStructure(vm, globalObject));

    set(Field::OnFulfilled, JSFunction::create(vm, globalObject, 2, String(), jsDurableObjectOnFulfilled, ImplementationVisibility::Private));
    set(Field::OnRejected, JSFunction::create(vm, globalObject, 2, String(), jsDurableObjectOnRejected, ImplementationVisibility::Private));
    set(Field::CommitMicrotask, JSFunction::create(vm, globalObject, 2, String(), jsDurableObjectCommitMicrotask, ImplementationVisibility::Private));
    set(Field::OnGraphError, JSFunction::create(vm, globalObject, 2, String(), jsDurableObjectOnGraphError, ImplementationVisibility::Private));
}

JSCell* createDurableObjectRealm(VM& vm, Zig::GlobalObject* globalObject)
{
    return JSDurableObjectRealm::create(vm, globalObject);
}

JSValue durableObjectConstructor(Zig::GlobalObject* globalObject)
{
    return JSDurableObjectRealm::of(globalObject)->object(Field::DurableObjectConstructor);
}

JSValue durableObjectNamespaceConstructor(Zig::GlobalObject* globalObject)
{
    return JSDurableObjectRealm::of(globalObject)->object(Field::NamespaceConstructor);
}

} // namespace Bun
