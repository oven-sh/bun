// What src/telemetry_jsc needs of the engine.

#include "root.h"

#include "TelemetryBindings.h"

#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "BunModuleRegistry.h"
#include "BunProcess.h"
#include "GeneratedTelemetry.h"
#include "JSCommonJSModule.h"
#include "JSDOMException.h"
#include "JSFFIFunction.h"
#include "ModuleGraph.h"
#include "NodeAsyncHooks.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/AsyncContextSwapScope.h>
#include <JavaScriptCore/DeferTermination.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSFunctionWithFields.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif

extern "C" bool Bun__Telemetry__isEnabled();
extern "C" JSC::EncodedJSValue Bun__Telemetry__createRootContext(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createTracerProvider(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createContextManager(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createPropagator(JSC::JSGlobalObject*);
extern "C" BunString Bun__Telemetry__installedApiVersion(JSC::JSGlobalObject*);

namespace Bun::Telemetry {

using namespace JSC;
using Bindgen::Generated::JSSpan;
using Bindgen::Generated::JSTelemetryContext;

// ─── The active span ─────────────────────────────────────────────────────────────────
//
// It is a frame of the async context (src/js/node/async_hooks.ts) whose `storage` is the "binding": a Span, or a
// TelemetryContext. A chain has at most one, like it has one for each AsyncLocalStorage.

class Frames {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    ALWAYS_INLINE explicit Frames(Zig::GlobalObject* globalObject)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_nativeStructure(globalObject->moduleGraphFrameStructure()->id())
    {
    }

    ALWAYS_INLINE JSValue masked(JSValue frame) const { return frame.isCell() ? read(asObject(frame), FrameMasked) : jsUndefined(); }

    // Empty if there is none.
    ALWAYS_INLINE JSValue binding(JSValue head) const
    {
        JSObject* frame = findBinding(head);
        return frame ? read(frame, FrameStorage) : JSValue();
    }

    // What `head` shows of every storage, with `binding` (empty: none) in the place of its own.
    ALWAYS_INLINE JSValue withBinding(JSValue head, JSValue binding) const
    {
        if (!head.isCell())
            return binding ? create(binding, jsUndefined(), jsUndefined(), jsUndefined()) : jsUndefined();
        JSObject* found = findBinding(head);
        JSValue rest = !found ? head : found == asObject(head) ? read(found, FramePrev)
                                                               : copyUntil(asObject(head), found);
        JSValue mask = masked(head);
        if (binding)
            return create(binding, jsUndefined(), rest, mask);
        if (!rest.isCell() || masked(rest) == mask)
            return rest;
        return copy(asObject(rest), read(asObject(rest), FramePrev), mask);
    }

private:
    ALWAYS_INLINE JSValue read(JSObject* frame, ModuleGraphFrameOffset offset) const
    {
        if (frame->structureID() == m_nativeStructure)
            return frame->getDirect(offset);
        return readByName(frame, offset);
    }

    NEVER_INLINE JSValue readByName(JSObject* frame, ModuleGraphFrameOffset offset) const
    {
        auto& names = WebCore::builtinNames(m_vm);
        const Identifier* identifiers[] = { &names.storagePublicName(), &m_vm.propertyNames->value, &names.prevPublicName(), &names.maskedPublicName() };
        JSValue value = frame->getDirect(m_vm, *identifiers[offset]);
        return value ? value : jsUndefined();
    }

    ALWAYS_INLINE JSObject* findBinding(JSValue head) const
    {
        for (JSValue frame = head; frame.isCell(); frame = read(asObject(frame), FramePrev)) {
            JSValue storage = read(asObject(frame), FrameStorage);
            if (storage.inherits<JSSpan>() || storage.inherits<JSTelemetryContext>())
                return asObject(frame);
        }
        return nullptr;
    }

    ALWAYS_INLINE JSValue create(JSValue storage, JSValue value, JSValue previous, JSValue mask) const
    {
        return createAsyncContextFrame(m_globalObject, storage, value, previous, mask);
    }

    JSValue copy(JSObject* frame, JSValue previous, JSValue mask) const
    {
        return create(read(frame, FrameStorage), read(frame, FrameValue), previous, mask);
    }

    // The frames above `cut` may be shared with other captures. `head` keeps them alive.
    NEVER_INLINE JSValue copyUntil(JSObject* head, JSObject* cut) const
    {
        Vector<JSObject*, 8> above;
        for (JSObject* frame = head; frame != cut; frame = asObject(read(frame, FramePrev)))
            above.append(frame);
        JSValue tail = read(cut, FramePrev);
        for (size_t i = above.size(); i--;)
            tail = copy(above[i], tail, read(above[i], FrameMasked));
        ensureStillAliveHere(head);
        return tail;
    }

    Zig::GlobalObject* m_globalObject;
    VM& m_vm;
    StructureID m_nativeStructure;
};

static ALWAYS_INLINE JSValue currentFrame(Zig::GlobalObject* globalObject)
{
    return globalObject->m_asyncContextData.get()->getInternalField(0);
}

static ALWAYS_INLINE void setCurrentFrame(Zig::GlobalObject* globalObject, JSValue frame)
{
    if (!globalObject->isAsyncContextTrackingEnabled() && frame.isCell()) [[unlikely]]
        beginTrackingAsyncContexts(globalObject);
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, frame);
}

extern "C" EncodedJSValue Bun__Telemetry__activeBinding(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue head = currentFrame(globalObject);
    if (!head.isCell())
        return {};
    return JSValue::encode(Frames(globalObject).binding(head));
}

// As AsyncLocalStorage.prototype.enterWith().
extern "C" void Bun__Telemetry__setActiveBinding(JSGlobalObject* lexicalGlobalObject, EncodedJSValue binding)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    setCurrentFrame(globalObject, Frames(globalObject).withBinding(currentFrame(globalObject), JSValue::decode(binding)));
}

// As the two halves of AsyncLocalStorage.prototype.run().
extern "C" EncodedJSValue Bun__Telemetry__enter(JSGlobalObject* lexicalGlobalObject, EncodedJSValue binding, EncodedJSValue* prior)
{
    BUN_REMOVABLE_DEFINITION(Telemetry, Bun__Telemetry__enter);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue head = currentFrame(globalObject);
    JSValue entered = Frames(globalObject).withBinding(head, JSValue::decode(binding));
    setCurrentFrame(globalObject, entered);
    *prior = JSValue::encode(head);
    return JSValue::encode(entered);
}

extern "C" void Bun__Telemetry__exit(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedEntered, EncodedJSValue encodedPrior)
{
    BUN_REMOVABLE_DEFINITION(Telemetry, Bun__Telemetry__exit);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue head = currentFrame(globalObject);
    JSValue prior = JSValue::decode(encodedPrior);
    Frames frames(globalObject);
    if (head == JSValue::decode(encodedEntered) && frames.masked(head) == frames.masked(prior)) [[likely]]
        return setCurrentFrame(globalObject, prior);
    // What enterWith() and disable() did meanwhile stays.
    setCurrentFrame(globalObject, frames.withBinding(head, frames.binding(prior)));
}

JSValue callbackUnderActiveSpan(Zig::GlobalObject* globalObject, JSValue callback)
{
    BUN_REMOVABLE_DEFINITION(Telemetry, callbackUnderActiveSpan);
    auto* wrapper = dynamicDowncast<AsyncContextFrame>(callback);
    if (!wrapper)
        return callback;
    Frames frames(globalObject);
    JSValue context = frames.withBinding(wrapper->context.get(), frames.binding(currentFrame(globalObject)));
    return AsyncContextFrame::create(globalObject, wrapper->callback.get(), context);
}

extern "C" EncodedJSValue Bun__Telemetry__callbackUnderActiveSpan(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    return JSValue::encode(callbackUnderActiveSpan(defaultGlobalObject(globalObject), JSValue::decode(callback)));
}

// ─── Values ──────────────────────────────────────────────────────────────────────────

using AttributeCallback = void (*)(void* context, const BunString* key, EncodedJSValue value);

static bool readPlainAttributes(VM& vm, JSObject* object, Vector<UniquedStringImpl*, 16>& keys, MarkedArgumentBuffer& values)
{
#if ENABLE(AOT)
    if (AOT::PropertyWalk::isCompiledObject(object)) {
        return AOT::PropertyWalk::forEachOwnProperty(vm, object, AOT::PropertyWalk::Filter::EnumerableStrings, [&](const AOT::PropertyWalk::OwnProperty& property) {
            keys.append(property.name);
            values.append(property.value);
            return IterationStatus::Continue;
        }) == AOT::PropertyWalk::Result::Completed;
    }
#endif
    Structure* structure = object->structure();
    if (object->type() != FinalObjectType || !structure->canPerformFastPropertyEnumeration() || hasIndexedProperties(structure->indexingType()))
        return false;
    structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
        if (!(entry.attributes() & PropertyAttribute::DontEnum) && !entry.key()->isSymbol()) {
            keys.append(entry.key());
            values.append(object->getDirect(entry.offset()));
        }
        return true;
    });
    return true;
}

// Object.entries(). Every getter has run before the first call of `each`, which runs no JavaScript.
extern "C" void Bun__Telemetry__forEachAttribute(JSGlobalObject* globalObject, EncodedJSValue encodedObject, void* context, AttributeCallback each)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(encodedObject));
    Vector<UniquedStringImpl*, 16> keys;
    MarkedArgumentBuffer values;
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    if (!readPlainAttributes(vm, object, keys, values)) {
        keys.shrink(0);
        values.clear();
        object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, );
        for (const Identifier& name : names) {
            JSValue value = object->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, );
            keys.append(name.impl());
            values.append(value);
        }
    }
    if (values.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return;
    }
    for (size_t i = 0; i < keys.size(); ++i) {
        BunString key = Bun::toString(static_cast<StringImpl*>(keys[i]));
        each(context, &key, JSValue::encode(values.at(i)));
        RETURN_IF_EXCEPTION(scope, );
    }
    ensureStillAliveHere(object);
}

extern "C" BunString Bun__Telemetry__borrowString(EncodedJSValue string)
{
    auto* impl = asString(JSValue::decode(string))->tryGetValue().data.impl();
    return impl ? Bun::toString(impl) : BunString { BunStringTag::Empty };
}

extern "C" uint32_t Bun__Telemetry__arrayLength(EncodedJSValue array)
{
    return uncheckedDowncast<JSArray>(JSValue::decode(array))->length();
}

// Empty for a hole and for what takes JavaScript to read.
extern "C" EncodedJSValue Bun__Telemetry__arrayElement(EncodedJSValue array, uint32_t index)
{
    return JSValue::encode(uncheckedDowncast<JSArray>(JSValue::decode(array))->tryGetIndexQuickly(index));
}

struct ErrorDescription {
    OwnedString type;
    OwnedString message;
    OwnedString stack;
    // Unless it is a number of the operating system's, which is negative.
    OwnedString errnoText;
    bool isNullish;
};

static String readString(JSGlobalObject* globalObject, JSObject* object, const Identifier& name, bool runsGetters)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value;
    if (runsGetters) {
        value = object->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool found = object->getPropertySlot(globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, {});
        if (found && slot.isValue())
            value = slot.getPureResult();
    }
    if (!value || !value.isString())
        return {};
    RELEASE_AND_RETURN(scope, asString(value)->value(globalObject));
}

// The first read of an Error's `stack` calls Error.prepareStackTrace.
static String readStackWithoutRunningScript(JSGlobalObject* globalObject, JSObject* object)
{
    auto& vm = getVM(globalObject);
    auto* error = dynamicDowncast<ErrorInstance>(object);
    if (!error)
        return readString(globalObject, object, vm.propertyNames->stack, false);
    auto* realm = dynamicDowncast<Zig::GlobalObject>(error->globalObject());
    if (realm && !realm->m_errorConstructorPrepareStackTraceValue)
        return readString(globalObject, object, vm.propertyNames->stack, false);
    JSValue stack = error->getDirect(vm, vm.propertyNames->stack);
    return stack && stack.isString() ? asString(stack)->value(globalObject).data : String();
}

// The type is the `code`, or else the `name`. A primitive has none: it is the message.
extern "C" void Bun__Telemetry__describeError(JSGlobalObject* globalObject, EncodedJSValue encodedError, bool runsGetters, ErrorDescription* out)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue error = JSValue::decode(encodedError);
    String type, message, stack;
    if (JSObject* object = error.getObject()) {
        if (auto* domException = dynamicDowncast<WebCore::JSDOMException>(object)) {
            type = domException->wrapped().name();
            message = domException->wrapped().message();
        } else {
            type = readString(globalObject, object, WebCore::builtinNames(vm).codePublicName(), runsGetters);
            RETURN_IF_EXCEPTION(scope, );
            if (type.isEmpty()) {
                type = readString(globalObject, object, vm.propertyNames->name, runsGetters);
                RETURN_IF_EXCEPTION(scope, );
            }
            message = readString(globalObject, object, vm.propertyNames->message, runsGetters);
            RETURN_IF_EXCEPTION(scope, );
        }
        if (type.isEmpty())
            type = "Error"_s;
        if (JSValue number = object->getDirect(vm, WebCore::builtinNames(vm).errnoPublicName()); number && (number.isString() || (number.isInt32() && number.asInt32() > 0))) {
            String text = number.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            out->errnoText = Bun::toStringRef(text);
        }
        out->type = Bun::toStringRef(type);
        out->message = Bun::toStringRef(message);
        stack = runsGetters ? readString(globalObject, object, vm.propertyNames->stack, true) : readStackWithoutRunningScript(globalObject, object);
        RETURN_IF_EXCEPTION(scope, );
        out->stack = Bun::toStringRef(stack);
        return;
    }
    out->isNullish = error.isUndefinedOrNull();
    if (out->isNullish || error.isSymbol())
        return;
    message = error.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    out->message = Bun::toStringRef(message);
}

// Runs no script, and leaves the pending exception as it is. Empty `encodedError`: of that exception, false if there is none.
extern "C" bool Bun__Telemetry__describePassingError(JSGlobalObject* globalObject, EncodedJSValue encodedError, ErrorDescription* out)
{
    auto& vm = getVM(globalObject);
    JSValue error = JSValue::decode(encodedError);
    if (!error)
        error = vm.exceptionForInspection();
    if (!error)
        return false;
    if (auto* exception = dynamicDowncast<JSC::Exception>(error)) {
        if (vm.isTerminationException(exception)) {
            out->isNullish = true;
            return true;
        }
        error = exception->value();
    }
    DeferTerminationForAWhile deferTermination(vm);
    SuspendExceptionScope suspended(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    Bun__Telemetry__describeError(globalObject, JSValue::encode(error), false, out);
    // Out of memory, or of stack.
    (void)scope.tryClearException();
    return true;
}

// `object[key] = value`
extern "C" void Bun__Telemetry__assign(JSGlobalObject* globalObject, EncodedJSValue encodedObject, const BunString* key, EncodedJSValue value)
{
    JSObject* object = asObject(JSValue::decode(encodedObject));
    PutPropertySlot slot(object, true);
    object->methodTable()->put(object, globalObject, Identifier::fromString(getVM(globalObject), key->toWTFString()), JSValue::decode(value), slot);
}

extern "C" EncodedJSValue Bun__Telemetry__processEnv(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue assigned = globalObject->processObject()->get(globalObject, WebCore::builtinNames(vm).envPublicName());
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(assigned.isObject() ? assigned : JSValue(globalObject->processEnvObject())));
}

// ─── Functions and promises ──────────────────────────────────────────────────────────

extern "C" bool Bun__Telemetry__isGeneratorFunction(EncodedJSValue encodedFunction)
{
    JSValue value = JSValue::decode(encodedFunction);
#if ENABLE(AOT)
    if (value.asCell()->vm().hasCompiledCode()) {
        auto declaredAs = AOT::declaredAs(value.asCell());
        if (declaredAs != AOT::DeclaredAs::NotCompiled)
            return declaredAs == AOT::DeclaredAs::GeneratorFunction || declaredAs == AOT::DeclaredAs::AsyncGeneratorFunction;
    }
#endif
    auto* function = dynamicDowncast<JSFunction>(value);
    return function && !function->isHostFunction() && isGeneratorOrAsyncGeneratorWrapperParseMode(function->jsExecutable()->parseMode());
}

static constexpr auto targetField = static_cast<JSFunctionWithFields::Field>(0);
static constexpr auto dataField = static_cast<JSFunctionWithFields::Field>(1);

extern "C" EncodedJSValue Bun__Telemetry__createForwarder(JSGlobalObject* globalObject, Zig::FFIFunction body, const BunString* name, uint32_t length, EncodedJSValue target, EncodedJSValue data)
{
    auto& vm = getVM(globalObject);
    auto* function = JSFunctionWithFields::create(vm, globalObject, vm.getHostFunction(body, ImplementationVisibility::Public, callHostFunctionAsConstructor, length, name->toWTFString()));
    function->setField(vm, targetField, JSValue::decode(target));
    function->setField(vm, dataField, JSValue::decode(data));
    return JSValue::encode(function);
}

extern "C" EncodedJSValue Bun__Telemetry__forwarderTarget(EncodedJSValue forwarder, EncodedJSValue* data)
{
    auto* function = uncheckedDowncast<JSFunctionWithFields>(JSValue::decode(forwarder));
    *data = JSValue::encode(function->getField(dataField));
    return JSValue::encode(function->getField(targetField));
}

extern "C" bool Bun__Telemetry__isForwarder(EncodedJSValue value, Zig::FFIFunction body)
{
    auto* function = dynamicDowncast<JSFunctionWithFields>(JSValue::decode(value));
    return function && function->nativeFunction() == toTagged(body);
}

extern "C" EncodedJSValue Bun__Telemetry__then(JSGlobalObject* globalObject, JSPromise* promise, Zig::FFIFunction onSettled)
{
    auto& vm = getVM(globalObject);
    auto* derived = JSPromise::create(vm, globalObject->promiseStructure());
    JSFunction* reaction = defaultGlobalObject(globalObject)->thenable(onSettled);
    promise->performPromiseThenExported(vm, globalObject, reaction, reaction, derived);
    return JSValue::encode(derived);
}

// The reactions get `span` behind the value. A rejection that nothing else handles is still reported.
extern "C" void Bun__Telemetry__observe(JSGlobalObject* lexicalGlobalObject, JSPromise* promise, EncodedJSValue span, Zig::FFIFunction onResolve, Zig::FFIFunction onReject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    ASSERT(promise->status() == JSPromise::Status::Pending);
    bool wasHandled = promise->isHandled();
    {
        // Capturing one takes a cell.
        AsyncContextSwapScope withoutContext(vm, lexicalGlobalObject, jsUndefined());
        promise->performPromiseThenWithContext(vm, lexicalGlobalObject, globalObject->thenable(onResolve), globalObject->thenable(onReject), jsUndefined(), JSValue::decode(span));
    }
    if (!wasHandled)
        promise->setFlags(promise->flags() & ~JSPromise::isHandledFlag);
}

extern "C" EncodedJSValue Bun__Telemetry__adoptThenable(JSGlobalObject* globalObject, EncodedJSValue value)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(value));
    // The query of Bun.sql is a Promise that starts in a then() of its own.
    if (auto* promise = dynamicDowncast<JSPromise>(object); promise ? promise->isThenFastAndNonObservable() : isDefinitelyNonThenable(object, globalObject))
        return value;
    JSValue then = object->get(globalObject, vm.propertyNames->then);
    RETURN_IF_EXCEPTION(scope, {});
    if (!then.isCallable())
        return value;
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    promise->resolve(globalObject, vm, object);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

extern "C" EncodedJSValue Bun__Telemetry__rejectionReason(JSPromise* promise)
{
    return JSValue::encode(promise->result());
}

// ─── Bun.otel ────────────────────────────────────────────────────────────────────────

JSC_DEFINE_CUSTOM_GETTER(jsOtelEnabled, (JSGlobalObject*, EncodedJSValue, PropertyName))
{
    return JSValue::encode(jsBoolean(Bun__Telemetry__isEnabled()));
}

static constexpr unsigned constantAttributes = PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;

static JSObject* createEnumeration(VM& vm, JSGlobalObject* globalObject, std::initializer_list<ASCIILiteral> names)
{
    JSObject* object = constructEmptyObject(globalObject, globalObject->objectPrototype(), names.size());
    int value = 0;
    for (ASCIILiteral name : names)
        object->putDirect(vm, Identifier::fromString(vm, name), jsNumber(value++), constantAttributes);
    return object;
}

template<auto create>
static JSValue createUnlessRemoved(JSGlobalObject* globalObject)
{
    JSValue instance = JSValue::decode(callRemovable<Feature::Telemetry, RemovedFeatureStub::ReturnDefault, create>(globalObject));
    return instance ? instance : constructEmptyObject(globalObject);
}

void addValuesOfOtel(VM& vm, JSGlobalObject* globalObject, JSObject* otel)
{
    auto add = [&](ASCIILiteral name, JSValue value) {
        otel->putDirect(vm, Identifier::fromString(vm, name), value, constantAttributes);
    };
    otel->putDirectCustomAccessor(vm, Identifier::fromString(vm, "enabled"_s), CustomGetterSetter::create(vm, jsOtelEnabled, nullptr), constantAttributes | PropertyAttribute::CustomAccessor);
    add("SpanKind"_s, createEnumeration(vm, globalObject, { "INTERNAL"_s, "SERVER"_s, "CLIENT"_s, "PRODUCER"_s, "CONSUMER"_s }));
    add("SpanStatusCode"_s, createEnumeration(vm, globalObject, { "UNSET"_s, "OK"_s, "ERROR"_s }));
    add("tracerProvider"_s, createUnlessRemoved<Bun__Telemetry__createTracerProvider>(globalObject));
    add("contextManager"_s, createUnlessRemoved<Bun__Telemetry__createContextManager>(globalObject));
    add("propagator"_s, createUnlessRemoved<Bun__Telemetry__createPropagator>(globalObject));
    add("ROOT_CONTEXT"_s, createUnlessRemoved<Bun__Telemetry__createRootContext>(globalObject));
}

static JSObject* otelObject(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue otel = globalObject->bunObject()->get(globalObject, Identifier::fromString(vm, "otel"_s));
    RETURN_IF_EXCEPTION(scope, nullptr);
    return asObject(otel);
}

extern "C" EncodedJSValue Bun__Telemetry__rootContext(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* otel = otelObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(otel->getDirect(vm, Identifier::fromString(vm, "ROOT_CONTEXT"_s)));
}

// ─── @opentelemetry/api ──────────────────────────────────────────────────────────────
//
// https://github.com/open-telemetry/opentelemetry-js/blob/api/v1.10.0/api/src/internal/global-utils.ts

// The folder is …/@opentelemetry/api, or …/@opentelemetry/api@1.9.0@@@1 in the install cache.
static bool isEntryPointOfApi(const String& key)
{
    if (!key.contains("@opentelemetry"_s))
        return false;
    String path = makeStringByReplacingAll(key, '\\', '/');
    for (ASCIILiteral entryPoint : { "/dist/index.cjs"_s, "/dist/index.mjs"_s, "/build/src/index.js"_s, "/build/esm/index.js"_s, "/build/esnext/index.js"_s }) {
        if (!path.endsWith(entryPoint))
            continue;
        StringView folder = StringView(path).left(path.length() - entryPoint.length());
        size_t slash = folder.reverseFind('/');
        if (slash == notFound || !folder.left(slash).endsWith("/@opentelemetry"_s))
            return false;
        StringView name = folder.substring(slash + 1);
        return name == "api"_s || name.startsWith("api@"_s);
    }
    return false;
}

static void collectLoadedCopiesOfApi(Zig::GlobalObject* globalObject, MarkedArgumentBuffer& copies)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), globalObject->requireMap(), IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, );
    JSValue key, value;
    while (iterator->nextKeyValue(globalObject, key, value)) {
        auto* module = dynamicDowncast<JSCommonJSModule>(value);
        if (!module || !key.isString())
            continue;
        String path = asString(key)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        if (!isEntryPointOfApi(path))
            continue;
        copies.append(module->exportsObject());
        RETURN_IF_EXCEPTION(scope, );
    }
    MarkedVector<AbstractModuleRecord*> records;
    forEachModuleRegistrySpecifier(globalObject->moduleLoader(), [&](UniquedStringImpl* specifier, ModuleRegistryEntry* entry) {
        if (isModuleEvaluated(entry->record()) && isEntryPointOfApi(String { specifier }))
            records.append(entry->record());
    });
    for (size_t i = 0; i < records.size(); ++i) {
        copies.append(records.at(i)->getModuleNamespace(globalObject, false));
        RETURN_IF_EXCEPTION(scope, );
    }
}

static JSValue getPath(JSGlobalObject* globalObject, JSValue value, std::initializer_list<ASCIILiteral> path)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    for (ASCIILiteral name : path) {
        if (!value.isObject())
            return jsUndefined();
        value = asObject(value)->get(globalObject, Identifier::fromString(vm, name));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return value;
}

// `holder[method]?.(argument)`
static JSValue callIfPresent(JSGlobalObject* globalObject, JSValue holder, ASCIILiteral method, JSValue argument = {})
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue function = getPath(globalObject, holder, { method });
    RETURN_IF_EXCEPTION(scope, {});
    if (!function.isCallable())
        return jsUndefined();
    MarkedArgumentBuffer arguments;
    if (argument)
        arguments.append(argument);
    RELEASE_AND_RETURN(scope, call(globalObject, function, getCallData(function), holder, arguments));
}

struct Providers {
    JSValue tracerProvider;
    JSValue contextManager;
    JSValue propagator;
};

static Providers providers(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* otel = otelObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto read = [&](ASCIILiteral name) { return otel->getDirect(vm, Identifier::fromString(vm, name)); };
    return { read("tracerProvider"_s), read("contextManager"_s), read("propagator"_s) };
}

// A tracer that a copy of the package has handed out already only learns of a provider through that copy.
static void registerWithLoadedCopiesOfApi(Zig::GlobalObject* globalObject, const Identifier& registryKey)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    MarkedArgumentBuffer copies;
    collectLoadedCopiesOfApi(globalObject, copies);
    RETURN_IF_EXCEPTION(scope, );
    if (copies.isEmpty())
        return;
    auto [provider, contextManager, propagator] = providers(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    for (size_t i = 0; i < copies.size(); ++i) {
        JSValue api = copies.at(i);
        JSValue trace = getPath(globalObject, api, { "trace"_s });
        RETURN_IF_EXCEPTION(scope, );
        JSValue registry = globalObject->get(globalObject, registryKey);
        RETURN_IF_EXCEPTION(scope, );
        JSValue registered = getPath(globalObject, registry, { "trace"_s });
        RETURN_IF_EXCEPTION(scope, );
        if (registered.isUndefinedOrNull()) {
            callIfPresent(globalObject, trace, "setGlobalTracerProvider"_s, provider);
            RETURN_IF_EXCEPTION(scope, );
            for (auto [name, setter, value] : { std::tuple { "context"_s, "setGlobalContextManager"_s, contextManager }, std::tuple { "propagation"_s, "setGlobalPropagator"_s, propagator } }) {
                registry = globalObject->get(globalObject, registryKey);
                RETURN_IF_EXCEPTION(scope, );
                JSValue present = getPath(globalObject, registry, { name });
                RETURN_IF_EXCEPTION(scope, );
                if (!present.isUndefinedOrNull())
                    continue;
                JSValue holder = getPath(globalObject, api, { name });
                RETURN_IF_EXCEPTION(scope, );
                callIfPresent(globalObject, holder, setter, value);
                RETURN_IF_EXCEPTION(scope, );
            }
            continue;
        }
        JSValue delegate = registered == provider ? provider : callIfPresent(globalObject, registered, "getDelegate"_s);
        RETURN_IF_EXCEPTION(scope, );
        if (delegate != provider)
            continue;
        JSValue proxy = getPath(globalObject, trace, { "_proxyTracerProvider"_s });
        RETURN_IF_EXCEPTION(scope, );
        callIfPresent(globalObject, proxy, "setDelegate"_s, provider);
        RETURN_IF_EXCEPTION(scope, );
    }
}

// What the program has registered stays.
static void fillRegistry(Zig::GlobalObject* globalObject, JSObject* registry)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto [provider, contextManager, propagator] = providers(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    for (auto [name, value] : { std::pair { "trace"_s, provider }, std::pair { "context"_s, contextManager }, std::pair { "propagation"_s, propagator } }) {
        Identifier identifier = Identifier::fromString(vm, name);
        JSValue registered = registry->get(globalObject, identifier);
        RETURN_IF_EXCEPTION(scope, );
        if (!registered.isUndefinedOrNull())
            continue;
        PutPropertySlot slot(registry);
        registry->methodTable()->put(registry, globalObject, identifier, value, slot);
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC_DEFINE_CUSTOM_GETTER(jsApiRegistry, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue holder, PropertyName name))
{
    BUN_REMOVABLE_DEFINITION(Telemetry, jsApiRegistry);
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(JSValue::decode(holder));
    auto& vm = getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* registry = constructEmptyObject(globalObject);
    registry->putDirect(vm, Identifier::fromString(vm, "version"_s), jsString(vm, OwnedString::adopt(Bun__Telemetry__installedApiVersion(globalObject)).transferToWTFString()));
    RETURN_IF_EXCEPTION(scope, {});
    fillRegistry(globalObject, registry);
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->putDirect(vm, name, registry);
    return JSValue::encode(registry);
}

JSC_DEFINE_CUSTOM_SETTER(setJSApiRegistry, (JSGlobalObject * globalObject, EncodedJSValue holder, EncodedJSValue value, PropertyName name))
{
    return asObject(JSValue::decode(holder))->putDirect(getVM(globalObject), name, JSValue::decode(value));
}

extern "C" void Bun__Telemetry__registerWithApi(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Identifier registryKey = Identifier::fromUid(vm.symbolRegistry().symbolForKey("opentelemetry.js.api.1"_s));

    // The compiler has not seen these calls, so it may have left out what they would call.
    if (!vm.hasCompiledCode()) {
        registerWithLoadedCopiesOfApi(globalObject, registryKey);
        RETURN_IF_EXCEPTION(scope, );
    }

    JSValue present = globalObject->get(globalObject, registryKey);
    RETURN_IF_EXCEPTION(scope, );
    if (JSObject* registry = present.getObject())
        RELEASE_AND_RETURN(scope, fillRegistry(globalObject, registry));
    // A program that does not load the package never reads it.
    globalObject->putDirectCustomAccessor(vm, registryKey, CustomGetterSetter::create(vm, jsApiRegistry, setJSApiRegistry), PropertyAttribute::CustomValue | 0);
}

}
