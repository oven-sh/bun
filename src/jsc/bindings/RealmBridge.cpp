#include "root.h"

#include "RealmBridge.h"
#include "BunClientData.h"
#include "DesktopRealm.h"
#include "DesktopWindow.h"
#include "GeneratedBlob.h"
#include "InternalModuleRegistry.h"
#include "IsolatedWorld.h"
#include "JSDOMException.h"
#include "JSDOMExceptionHandling.h"
#include "JSMessagePort.h"
#include "ScriptExecutionContext.h"
#include "SerializedScriptValue.h"
#include "ZigGlobalObject.h"
#include "blob.h"

#include <JavaScriptCore/ButterflyInlines.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/JSCellButterfly.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun::RealmBridge {

using namespace JSC;

static const Identifier& targetName(VM& vm) { return WebCore::builtinNames(vm).hostPrivateName(); }
static const Identifier& receiverName(VM& vm) { return WebCore::builtinNames(vm).selfPrivateName(); }
static constexpr PropertyOffset targetOffset = firstOutOfLineOffset;
static constexpr PropertyOffset receiverOffset = firstOutOfLineOffset + 1;

static Structure* sealedWith(VM& vm, Structure* structure, std::initializer_list<PropertyName> names)
{
    for (PropertyName name : names) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, name, 0, offset);
    }
    return Structure::preventExtensionsTransition(vm, structure);
}

class Handle : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSNonFinalObject));
        return &vm.plainObjectSpace();
    }

    static Structure* createStructure(JSGlobalObject* realm)
    {
        VM& vm = realm->vm();
        return sealedWith(vm, Structure::create(vm, realm, jsNull(), TypeInfo(ObjectType, StructureFlags), info()), { targetName(vm) });
    }

    static Handle* create(VM& vm, Structure* structure, JSObject* target)
    {
        auto* butterfly = Butterfly::create(vm, nullptr, structure);
        auto* handle = new (NotNull, allocateCell<Handle>(vm)) Handle(vm, structure, butterfly);
        handle->finishCreation(vm);
        handle->putDirectOffset(vm, targetOffset, target);
        return handle;
    }

    JSObject* target() const { return asObject(getDirect(targetOffset)); }

private:
    Handle(VM& vm, Structure* structure, Butterfly* butterfly)
        : Base(vm, structure, butterfly)
    {
    }
};
const ClassInfo Handle::s_info = { "Object"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Handle) };

static JSC_DECLARE_HOST_FUNCTION(callAcross);

// Not a JSFunction, so that `Function.prototype.caller` does not look past it.
class Port final : public InternalFunction {
public:
    using Base = InternalFunction;
    DECLARE_INFO;

    static Structure* createStructure(JSGlobalObject* realm)
    {
        VM& vm = realm->vm();
        auto* empty = Structure::create(vm, realm, realm->functionPrototype(), TypeInfo(InternalFunctionType, StructureFlags), info());
        return sealedWith(vm, empty, { targetName(vm), receiverName(vm) });
    }

    static Port* create(VM& vm, Structure* structure, JSObject* target, JSValue receiver)
    {
        auto* butterfly = Butterfly::create(vm, nullptr, structure);
        auto* port = new (NotNull, allocateCell<Port>(vm)) Port(vm, structure);
        port->setButterfly(vm, butterfly);
        port->finishCreation(vm);
        port->m_originalName.set(vm, port, jsEmptyString(vm));
        port->putDirectOffset(vm, targetOffset, target);
        port->putDirectOffset(vm, receiverOffset, receiver);
        return port;
    }

    JSObject* target() const { return asObject(getDirect(targetOffset)); }
    JSValue receiver() const { return getDirect(receiverOffset); }

private:
    Port(VM& vm, Structure* structure)
        : Base(vm, structure, callAcross)
    {
    }
};
const ClassInfo Port::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Port) };

enum class Slot : uint8_t {
    PortStructure,
    Fulfill,
    Reject,
    // In the main realm.
    HandleStructure,
    Handles,
    Count,
};

template<typename Cell>
static Cell* lazily(JSGlobalObject* realm, Slot slot, NOESCAPE const auto& create)
{
    VM& vm = realm->vm();
    auto* holder = uncheckedDowncast<Zig::GlobalObject>(realm)->internalModuleRegistry();
    JSValue held = holder->getDirect(vm, targetName(vm));
    if (!held) [[unlikely]] {
        auto* slots = JSCellButterfly::create(vm, CopyOnWriteArrayWithContiguous, static_cast<unsigned>(Slot::Count));
        for (unsigned i = 0; i < slots->length(); ++i)
            slots->setIndex(vm, i, jsUndefined());
        holder->putDirect(vm, targetName(vm), held = slots);
    }
    auto* slots = uncheckedDowncast<JSCellButterfly>(held);
    JSValue value = slots->get(static_cast<unsigned>(slot));
    if (!value.isCell()) [[unlikely]]
        slots->setIndex(vm, static_cast<unsigned>(slot), value = create());
    return uncheckedDowncast<Cell>(value);
}

static Handle* createHandle(VM& vm, JSObject* object)
{
    auto* main = defaultGlobalObject(vm);
    return Handle::create(vm, lazily<Structure>(main, Slot::HandleStructure, [&] { return Handle::createStructure(main); }), object);
}

// The same one each time.
static JSObject* keep(VM& vm, JSObject* object)
{
    auto* main = defaultGlobalObject(vm);
    auto* handles = lazily<JSWeakMap>(main, Slot::Handles, [&] { return JSWeakMap::create(vm, main->weakMapStructure()); });
    if (JSObject* known = handles->get(object).getObject())
        return known;
    auto* handle = createHandle(vm, object);
    handles->set(vm, object, handle);
    return handle;
}

JSValue peek(JSValue value)
{
    auto* handle = dynamicDowncast<Handle>(value);
    return handle ? handle->target() : value;
}

JSValue originalOf(JSValue thrown)
{
    bool isError = thrown.inherits<ErrorInstance>() || thrown.inherits<WebCore::JSDOMException>();
    JSValue original = isError ? asObject(thrown)->getDirect(asObject(thrown)->vm(), targetName(asObject(thrown)->vm())) : JSValue();
    return original ? original : peek(thrown);
}

extern "C" EncodedJSValue Bun__RealmBridge__peek(EncodedJSValue value) { return JSValue::encode(peek(JSValue::decode(value))); }

extern "C" void Bun__RealmBridge__setPathOfFile(JSGlobalObject* realm, EncodedJSValue file, EncodedJSValue path)
{
    asObject(JSValue::decode(file))->putDirect(realm->vm(), WebCore::builtinNames(realm->vm()).pathPrivateName(), JSValue::decode(path));
}

// It is no plain object, so it is not copied.
extern "C" EncodedJSValue Bun__RealmBridge__tokenForPath(JSGlobalObject* realm, EncodedJSValue path)
{
    RELEASE_ASSERT(!isDesktopRealm(realm));
    EncodedJSValue token = JSValue::encode(constructEmptyObject(realm, realm->functionPrototype()));
    Bun__RealmBridge__setPathOfFile(realm, token, path);
    return token;
}

// Of a `File`, or of what the host has made for a path. The main realm names it itself.
extern "C" EncodedJSValue Bun__RealmBridge__pathOfFile(JSGlobalObject* realm, EncodedJSValue file)
{
    JSValue value = peek(JSValue::decode(file));
    if (!value.isObject())
        return isDesktopRealm(realm) ? encodedJSUndefined() : file;
    JSValue path = asObject(value)->getDirect(realm->vm(), WebCore::builtinNames(realm->vm()).pathPrivateName());
    return path ? JSValue::encode(path) : encodedJSUndefined();
}

extern "C" EncodedJSValue Bun__RealmBridge__cross(JSGlobalObject* to, EncodedJSValue value) { return JSValue::encode(cross(to, JSValue::decode(value))); }

static bool isOfPages(JSObject* object)
{
    if (auto* proxy = dynamicDowncast<JSGlobalProxy>(object))
        return isDesktopRealm(proxy->target()) || isRemoteWindow(proxy->target());
    auto* realm = object->structure()->realm();
    return realm && isDesktopRealm(realm);
}

static JSGlobalObject* homeOf(JSObject* function)
{
    return isOfPages(function) ? function->structure()->realm() : defaultGlobalObject(function->vm());
}

// The documents of an origin use the `dom/` modules of the first one.
static bool mayHaveObjectsOf(JSGlobalObject* realm, JSGlobalObject* other)
{
    if (realm == other)
        return true;
    auto& name = WebCore::builtinNames(realm->vm()).documentPrivateName();
    JSValue modules = realm->getDirect(realm->vm(), name);
    return modules && modules == other->getDirect(realm->vm(), name) && !IsolatedWorld::is(other);
}

static JSValue structuredClone(JSGlobalObject* to, JSValue value, Vector<Strong<JSObject>>&& transfer = {})
{
    using namespace WebCore;
    auto scope = DECLARE_THROW_SCOPE(to->vm());
    Vector<RefPtr<MessagePort>> ports;
    auto serialized = SerializedScriptValue::create(*to, value, WTF::move(transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    RETURN_IF_EXCEPTION(scope, {});
    if (serialized.hasException()) {
        propagateException(*to, scope, serialized.releaseException());
        return {};
    }
    auto disentangled = MessagePort::disentanglePorts(WTF::move(ports));
    if (disentangled.hasException()) {
        propagateException(*to, scope, disentangled.releaseException());
        return {};
    }
    ports = MessagePort::entanglePorts(*defaultGlobalObject(to)->scriptExecutionContext(), disentangled.releaseReturnValue());
    RELEASE_AND_RETURN(scope, serialized.releaseReturnValue()->deserialize(*to, to, ports));
}

// Null unless its bytes are in memory.
extern "C" void* Blob__dupeForRealm(EncodedJSValue, JSGlobalObject*);

template<bool isRejection>
static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES settle(JSGlobalObject*, CallFrame*);

extern "C" void Bun__prefault(void*, size_t);

class Crossing {
public:
    // The methods of a native object of a page read dictionaries, to which scripts must not add members.
    explicit Crossing(JSGlobalObject* to, JSValue receiver = jsUndefined())
        : m_vm(to->vm())
        , m_to(to)
        , m_isToPages(isDesktopRealm(to))
        , m_inheritsNothing(m_isToPages && receiver.isObject() && !mayBePlainData(asObject(receiver)))
    {
    }

    ALWAYS_INLINE JSValue convert(JSValue value)
    {
        if (!value.isObject())
            return value;
        JSObject* object = asObject(value);
        if (mayBePlainData(object) && !isHome(object)) {
            if (JSValue copy = WebCore::SerializedScriptValue::tryCopyPlainData(*m_to, object)) {
                if (m_inheritsNothing)
                    disinherit(copy);
                return copy;
            }
        }
        return convertObject(object, jsUndefined());
    }

    // It is the same again when it is back.
    JSValue convertThrown(JSValue value)
    {
        if (!value.isObject())
            return value;
        JSObject* object = asObject(value);
        if (!m_isToPages && !isError(object) && !object->inherits<Handle>() && !isHome(object))
            return keep(m_vm, object);
        if (auto* handle = dynamicDowncast<Handle>(object); handle && !mayHave(handle->target()))
            return handle;
        return convertObject(object, jsUndefined());
    }

    // For the exception that is pending.
    EncodedJSValue rethrow(ThrowScope& scope)
    {
        for (unsigned attempt = 0; attempt < 2; ++attempt) {
            JSValue thrown = scope.exception()->value();
            if (!thrown.isObject() || (!thrown.inherits<Handle>() && isHome(asObject(thrown))) || !scope.tryClearException())
                return {};
            JSValue converted = convertThrown(thrown);
            if (!scope.exception()) {
                throwException(m_to, scope, converted);
                return {};
            }
        }
        if (scope.tryClearException())
            throwTypeError(m_to, scope, "An exception could not be copied."_s);
        return {};
    }

    JSObject* methodsOf(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* methods = constructEmptyObject(m_to);
        auto* prototype = object->getPrototypeDirect().getObject();
        if (!prototype)
            return methods;
        auto* from = homeOf(object);
        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        prototype->methodTable()->getOwnPropertyNames(prototype, from, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (auto& name : names) {
            PropertyDescriptor descriptor;
            bool exists = prototype->getOwnPropertyDescriptor(from, name, descriptor);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (exists && descriptor.isDataDescriptor() && descriptor.value().isCallable())
                methods->putDirectMayBeIndex(m_to, name, portFor(asObject(descriptor.value()), object));
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        return methods;
    }

private:
    static constexpr unsigned maximumLength = 1 << 26;

    void disinherit(JSValue copy)
    {
        if (!copy)
            return;
        if (auto* list = dynamicDowncast<JSArray>(copy)) {
            if (hasContiguous(list->indexingType())) {
                for (unsigned i = 0; i < list->length(); ++i)
                    disinherit(list->tryGetIndexQuickly(i));
            }
            return;
        }
        auto* object = dynamicDowncast<JSFinalObject>(copy);
        if (!object || object->getPrototypeDirect().isNull())
            return;
        object->setPrototypeDirect(m_vm, jsNull());
        auto* structure = object->structure();
        for (unsigned i = 0; i < structure->inlineSize() + structure->outOfLineSize(); ++i)
            disinherit(object->getDirect(offsetForPropertyNumber(i, structure->inlineCapacity())));
    }

    bool isHome(JSObject* object) const { return isOfPages(object) == m_isToPages; }

    bool mayHave(JSObject* object) const
    {
        if (!isHome(object))
            return false;
        return !m_isToPages || (object->type() != GlobalProxyType && mayHaveObjectsOf(m_to, object->structure()->realm()));
    }

    static bool mayBePlainData(JSObject* object)
    {
        return object->type() == FinalObjectType || object->type() == ArrayType || object->type() == CompiledObjectType;
    }

    static bool isError(JSObject* object)
    {
        return object->type() == ErrorInstanceType || object->inherits<WebCore::JSDOMException>();
    }

    static bool isCloned(JSObject* object)
    {
        switch (object->type()) {
        case ArrayBufferType:
        case JSDateType:
        case RegExpObjectType:
        case JSMapType:
        case JSSetType:
        case BooleanObjectType:
        case NumberObjectType:
        case StringObjectType:
            return true;
        default:
            return isTypedArrayTypeIncludingDataView(object->type());
        }
    }

    static bool isPlain(JSObject* object)
    {
        if (object->type() != FinalObjectType && object->type() != CompiledObjectType)
            return false;
        JSValue prototype = object->getPrototypeDirect();
        return prototype.isNull() || prototype == object->structure()->realm()->objectPrototype();
    }

    JSValue convertMember(JSValue value, JSValue holder)
    {
        return value.isObject() ? convertObject(asObject(value), holder) : value;
    }

    JSValue convertObject(JSObject* object, JSValue holder)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (auto* handle = dynamicDowncast<Handle>(object))
            return isHome(handle->target()) ? handle->target() : handle;
        if (isHome(object))
            return object;
        if (auto* known = m_copies.get(object))
            return known;
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_to, scope);
            return {};
        }
        if (object->isCallable())
            return portFor(object, holder);
        if (auto* promise = dynamicDowncast<JSPromise>(object))
            RELEASE_AND_RETURN(scope, follow(promise));
        if (isError(object))
            RELEASE_AND_RETURN(scope, copyError(object));
        if (isJSArray(object) || object->type() == DerivedArrayType)
            RELEASE_AND_RETURN(scope, copyArray(uncheckedDowncast<JSArray>(object)));
        if (auto* bytes = dynamicDowncast<JSUint8Array>(object); bytes && !bytes->isShared())
            RELEASE_AND_RETURN(scope, copyBytes(bytes));
        if (isCloned(object))
            RELEASE_AND_RETURN(scope, structuredClone(m_to, object));
        if (isPlain(object))
            RELEASE_AND_RETURN(scope, copyObject(object));
        if (void* blob = object->inherits<Bindgen::Generated::JSBlob>() ? Blob__dupeForRealm(JSValue::encode(object), m_to) : nullptr) {
            JSValue copy = Bindgen::createWrapper<Bindgen::Generated::JSBlob>(m_to, blob);
            desktopRealmAdoptFile(m_to, copy);
            return copy;
        }
        if (object->inherits<WebCore::JSMessagePort>())
            RELEASE_AND_RETURN(scope, structuredClone(m_to, object, Vector { Strong<JSObject>(m_vm, object) }));
        return keep(m_vm, object);
    }

    void remember(JSObject* object, JSObject* copy)
    {
        m_copies.add(object, copy);
        m_roots.append(object);
        m_roots.append(copy);
    }

    JSValue portFor(JSObject* function, JSValue receiver)
    {
        if (auto* port = dynamicDowncast<Port>(function))
            return port->target();
        return Port::create(m_vm, lazily<Structure>(m_to, Slot::PortStructure, [&] { return Port::createStructure(m_to); }), function, receiver);
    }

    JSFunction* reaction(Slot slot, NativeFunction function)
    {
        return lazily<JSFunction>(m_to, slot, [&] { return JSFunction::create(m_vm, m_to, 2, emptyString(), function, ImplementationVisibility::Public); });
    }

    JSValue follow(JSPromise* promise)
    {
        auto* follower = JSPromise::create(m_vm, m_to->promiseStructure());
        if (promise->isHandled())
            follower->markAsHandled();
        else if (promise->status() == JSPromise::Status::Rejected) {
            auto* from = promise->structure()->realm();
            from->globalObjectMethodTable()->promiseRejectionTracker(from, promise, JSPromiseRejectionOperation::Handle);
            promise->markAsHandled();
        }
        promise->performPromiseThenWithContext(m_vm, m_to, reaction(Slot::Fulfill, settle<false>), reaction(Slot::Reject, settle<true>), jsUndefined(), follower);
        return follower;
    }

    // Empty unless it is a string.
    JSValue textAt(JSObject* object, PropertyName name)
    {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(m_vm);
        JSValue value = object->get(object->structure()->realm(), name);
        if (scope.exception()) [[unlikely]] {
            scope.clearExceptionExceptTermination();
            return {};
        }
        return value.isString() ? value : JSValue();
    }

    JSValue copyError(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (JSValue original = object->getDirect(m_vm, targetName(m_vm)); original && mayHave(asObject(original)))
            return original;
        String name, message;
        auto* error = dynamicDowncast<ErrorInstance>(object);
        if (error) {
            name = error->sanitizedNameString(m_to);
            RETURN_IF_EXCEPTION(scope, {});
            message = error->sanitizedMessageString(m_to);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            auto& exception = uncheckedDowncast<WebCore::JSDOMException>(object)->wrapped();
            name = exception.name();
            message = exception.message();
        }

        JSObject* copy;
        ErrorType type = error && error->errorType() <= ErrorType::URIError ? error->errorType() : ErrorType::Error;
        for (ErrorType named : { ErrorType::RangeError, ErrorType::TypeError }) {
            if (error && name == errorTypeName(named))
                type = named;
        }
        bool isNamedByType = name == errorTypeName(type);
        if (error && (isNamedByType || !m_isToPages)) {
            copy = ErrorInstance::create(m_vm, m_to->errorStructure(type), message, JSValue(), nullptr, TypeNothing, type);
            if (!isNamedByType)
                copy->putDirect(m_vm, m_vm.propertyNames->name, jsString(m_vm, name), static_cast<unsigned>(PropertyAttribute::DontEnum));
            // The stack of the main realm has the paths of the app.
            auto& other = m_isToPages ? WebCore::builtinNames(m_vm).codePublicName() : m_vm.propertyNames->stack;
            JSValue text = textAt(error, other);
            RETURN_IF_EXCEPTION(scope, {});
            if (text) {
                PropertyDescriptor descriptor(text, static_cast<unsigned>(PropertyAttribute::DontEnum));
                copy->methodTable()->defineOwnProperty(copy, m_to, other, descriptor, false);
                RETURN_IF_EXCEPTION(scope, {});
            }
        } else
            copy = asObject(WebCore::toJSNewlyCreated(m_to, uncheckedDowncast<Zig::GlobalObject>(m_to), WebCore::DOMException::create(message, name)));
        copy->putDirect(m_vm, targetName(m_vm), object);
        return copy;
    }

    JSValue copyBytes(JSUint8Array* bytes)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* copy = JSUint8Array::createUninitialized(m_to, m_to->typedArrayStructure(TypeUint8, false), bytes->length());
        RETURN_IF_EXCEPTION(scope, {});
        Bun__prefault(copy->vector(), copy->length());
        memcpySpan(copy->typedSpan(), bytes->typedSpan());
        return copy;
    }

    JSValue copyArray(JSArray* array)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        unsigned length = array->length();
        if (length > maximumLength) [[unlikely]] {
            throwRangeError(m_to, scope, "The array is too long."_s);
            return {};
        }
        auto* copy = constructEmptyArray(m_to, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        remember(array, copy);
        for (unsigned i = 0; i < length; ++i) {
            JSValue element = array->getIndex(array->structure()->realm(), i);
            RETURN_IF_EXCEPTION(scope, {});
            element = convertMember(element, jsUndefined());
            RETURN_IF_EXCEPTION(scope, {});
            copy->putDirectIndex(m_to, i, element);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return copy;
    }

    JSValue copyObject(JSObject* object)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto* from = homeOf(object);
        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, from, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, {});
        auto* copy = constructEmptyObject(m_to, m_to->objectPrototype(), std::clamp<unsigned>(names.size(), JSFinalObject::defaultInlineCapacity, JSFinalObject::maxInlineCapacity));
        if (m_inheritsNothing)
            copy->setPrototypeDirect(m_vm, jsNull());
        remember(object, copy);
        for (auto& name : names) {
            JSValue member = object->get(from, name);
            RETURN_IF_EXCEPTION(scope, {});
            member = convertMember(member, object);
            RETURN_IF_EXCEPTION(scope, {});
            copy->putDirectMayBeIndex(m_to, name, member);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return copy;
    }

    VM& m_vm;
    JSGlobalObject* m_to;
    bool m_isToPages;
    bool m_inheritsNothing;
    UncheckedKeyHashMap<JSObject*, JSObject*> m_copies;
    MarkedArgumentBuffer m_roots;
};

// (value, promise)
template<bool isRejection>
static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES settle(JSGlobalObject* realm, CallFrame* callFrame)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* follower = uncheckedDowncast<JSPromise>(callFrame->uncheckedArgument(1));
    Crossing crossing(realm);
    JSValue value = isRejection ? crossing.convertThrown(callFrame->uncheckedArgument(0)) : crossing.convert(callFrame->uncheckedArgument(0));
    if (scope.exception()) [[unlikely]] {
        crossing.rethrow(scope);
        scope.release();
        follower->rejectWithCaughtException(vm, scope);
        return {};
    }
    scope.release();
    isRejection ? follower->reject(vm, value) : follower->fulfill(vm, value);
    return encodedJSUndefined();
}

static EncodedJSValue callFrom(JSGlobalObject* here, JSObject* target, JSValue receiver, const ArgList& given)
{
    auto scope = DECLARE_THROW_SCOPE(here->vm());
    auto* there = homeOf(target);
    JSValue result = [&] -> JSValue {
        MarkedArgumentBuffer arguments;
        Crossing crossing(there, receiver);
        for (unsigned i = 0; i < given.size(); ++i) {
            JSValue argument = crossing.convert(given.at(i));
            RETURN_IF_EXCEPTION(scope, {});
            arguments.append(argument);
        }
        if (arguments.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(here, scope);
            return {};
        }
        return call(there, target, getCallData(target), receiver, arguments);
    }();
    if (!scope.exception() && !result.isObject()) [[likely]]
        return JSValue::encode(result);
    Crossing back(here);
    if (!scope.exception())
        result = back.convert(result);
    return scope.exception() ? back.rethrow(scope) : JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(callAcross, (JSGlobalObject * here, CallFrame* callFrame))
{
    auto* port = uncheckedDowncast<Port>(callFrame->jsCallee());
    return callFrom(here, port->target(), port->receiver(), ArgList(callFrame));
}

JSValue cross(JSGlobalObject* to, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(to->vm());
    Crossing crossing(to);
    JSValue result = crossing.convert(value);
    if (!scope.exception()) [[likely]]
        return result;
    crossing.rethrow(scope);
    return {};
}

}

namespace Bun {

using namespace JSC;
using namespace RealmBridge;

extern "C" EncodedJSValue Bun__RealmBridge__methodsOf(JSGlobalObject* globalObject, EncodedJSValue given)
{
    RELEASE_ASSERT(!isDesktopRealm(globalObject));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* handle = dynamicDowncast<Handle>(JSValue::decode(given));
    if (!handle || !isOfPages(handle->target())) {
        throwTypeError(globalObject, scope);
        return {};
    }
    Crossing crossing(globalObject);
    auto* methods = crossing.methodsOf(handle->target());
    if (scope.exception()) [[unlikely]]
        return crossing.rethrow(scope);
    methods->putDirect(globalObject->vm(), Identifier::fromString(globalObject->vm(), "handle"_s), handle);
    return JSValue::encode(methods);
}

extern "C" EncodedJSValue Bun__RealmBridge__keep(EncodedJSValue object) { return JSValue::encode(keep(asObject(JSValue::decode(object))->vm(), asObject(JSValue::decode(object)))); }

extern "C" EncodedJSValue Bun__RealmBridge__clone(JSGlobalObject* globalObject, EncodedJSValue given, EncodedJSValue transferred, JSGlobalObject* to)
{
    RELEASE_ASSERT(!isDesktopRealm(globalObject));
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = peek(JSValue::decode(given));
    JSValue copy = [&] -> JSValue {
        Vector<Strong<JSObject>> transfer;
        if (auto* list = dynamicDowncast<JSArray>(peek(JSValue::decode(transferred)))) {
            for (unsigned i = 0; i < list->length(); ++i) {
                JSValue item = list->getDirectIndex(to, i);
                RETURN_IF_EXCEPTION(scope, {});
                if (!item || !item.isObject()) {
                    WebCore::throwDataCloneError(*to, scope);
                    return {};
                }
                transfer.append(Strong<JSObject>(vm, asObject(peek(item))));
            }
        }
        JSValue plain = transfer.isEmpty() ? WebCore::SerializedScriptValue::tryCopyPlainData(*to, value) : JSValue();
        return plain ? plain : structuredClone(to, value, WTF::move(transfer));
    }();
    if (scope.exception()) [[unlikely]]
        return Crossing(globalObject).rethrow(scope);
    if (to == globalObject || !copy.isObject())
        return JSValue::encode(copy);
    return JSValue::encode(createHandle(vm, asObject(copy)));
}

}
