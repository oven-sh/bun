// What src/telemetry_jsc needs of the engine.

#include "root.h"

#include "TelemetryBindings.h"

#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "BunModuleRegistry.h"
#include "BunProcess.h"
#include "FormatStackTraceForJS.h"
#include "GeneratedTelemetry.h"
#include "JSCommonJSModule.h"
#include "JSDOMException.h"
#include "JSFFIFunction.h"
#include "ModuleGraph.h"
#include "NodeAsyncHooks.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/AsyncContextSwapScope.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/DeferTermination.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSFunctionWithFields.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StackVisitor.h>
#include <wtf/SetForScope.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/AOTPropertyWalk.h>
#endif

extern "C" bool Bun__Telemetry__isEnabled();
extern "C" JSC::EncodedJSValue Bun__Telemetry__createRootContext(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createTracerProvider(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createContextManager(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__createPropagator(JSC::JSGlobalObject*);

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

    JSValue valueBeside(JSValue head, JSValue binding) const
    {
        JSObject* frame = findBinding(head);
        return frame && read(frame, FrameStorage) == binding ? read(frame, FrameValue) : jsUndefined();
    }

    // Not in a copy that async_hooks.ts has made, whose fields compiled code takes for its own.
    void setValueBeside(JSValue head, JSValue binding, JSValue value) const
    {
        JSObject* frame = findBinding(head);
        if (frame && frame->structureID() == m_nativeStructure && read(frame, FrameStorage) == binding)
            frame->putDirectOffset(m_vm, FrameValue, value);
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

extern "C" EncodedJSValue Bun__Telemetry__contextKeptFor(JSGlobalObject* lexicalGlobalObject, EncodedJSValue span)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(Frames(globalObject).valueBeside(currentFrame(globalObject), JSValue::decode(span)));
}

extern "C" void Bun__Telemetry__keepContextFor(JSGlobalObject* lexicalGlobalObject, EncodedJSValue span, EncodedJSValue context)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    Frames(globalObject).setValueBeside(currentFrame(globalObject), JSValue::decode(span), JSValue::decode(context));
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
    JSValue active = frames.binding(currentFrame(globalObject));
    if (!active)
        return callback;
    return AsyncContextFrame::create(globalObject, wrapper->callback.get(), frames.withBinding(wrapper->context.get(), active));
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

// The first read of an Error's `stack` calls Error.prepareStackTrace, fixes the text and drops the frames.
static String formatFrames(JSGlobalObject* globalObject, ErrorInstance* error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // A collection that finds a frame dead frees them all.
    DeferGCForAWhile deferGC(vm);
    auto* frames = error->stackTrace();
    if (!frames)
        return {};
    String name = error->sanitizedNameString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    String message = error->sanitizedMessageString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    OrdinalNumber line, column;
    String sourceURL;
    RELEASE_AND_RETURN(scope, formatStackTrace(vm, defaultGlobalObject(error->globalObject()), error->globalObject(), name, message, line, column, sourceURL, *frames, nullptr));
}

static __attribute__((minsize)) String readString(JSGlobalObject* globalObject, JSObject* object, const Identifier& name, bool runsGetters)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value;
    if (runsGetters) {
        value = object->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        for (JSObject* holder = object; holder && !holder->structure()->typeInfo().overridesGetPrototype(); holder = holder->getPrototypeDirect().getObject()) {
            value = holder->getDirect(vm, name);
            if (value)
                break;
            if (auto* error = name == vm.propertyNames->stack ? dynamicDowncast<ErrorInstance>(holder) : nullptr)
                RELEASE_AND_RETURN(scope, formatFrames(globalObject, error));
        }
    }
    if (!value || !value.isString())
        return {};
    RELEASE_AND_RETURN(scope, asString(value)->value(globalObject));
}

// The type is the `code`, or else the `name`. A primitive has none: it is the message.
extern "C" __attribute__((minsize)) void Bun__Telemetry__describeError(JSGlobalObject* globalObject, EncodedJSValue encodedError, bool runsGetters, ErrorDescription* out)
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
        stack = readString(globalObject, object, vm.propertyNames->stack, runsGetters);
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

// engine.rs has the numbers.
enum class FunctionKind : uint8_t { Other,
    Generator,
    Class };

extern "C" FunctionKind Bun__Telemetry__kindOfFunction(EncodedJSValue encodedFunction)
{
    JSValue value = JSValue::decode(encodedFunction);
    if (!value.isCell())
        return FunctionKind::Other;
#if ENABLE(AOT)
    if (value.asCell()->vm().hasCompiledCode()) {
        auto declaredAs = AOT::declaredAs(value.asCell());
        if (declaredAs == AOT::DeclaredAs::GeneratorFunction || declaredAs == AOT::DeclaredAs::AsyncGeneratorFunction)
            return FunctionKind::Generator;
        if (declaredAs != AOT::DeclaredAs::NotCompiled)
            return declaredAs == AOT::DeclaredAs::Class ? FunctionKind::Class : FunctionKind::Other;
    }
#endif
    auto* function = dynamicDowncast<JSFunction>(value);
    if (!function || function->isHostFunction())
        return FunctionKind::Other;
    if (isGeneratorOrAsyncGeneratorWrapperParseMode(function->jsExecutable()->parseMode()))
        return FunctionKind::Generator;
    return function->jsExecutable()->isClassConstructorFunction() ? FunctionKind::Class : FunctionKind::Other;
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

__attribute__((minsize)) void addValuesOfOtel(VM& vm, JSGlobalObject* globalObject, JSObject* otel)
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

// …/@opentelemetry/api, or …/@opentelemetry/api@1.9.0@@@1 in the install cache. 0 if `path` does not lie in it.
static size_t lengthOfFolderOfApi(const String& path)
{
    static constexpr auto scope = "@opentelemetry"_s;
    size_t at = path.reverseFind(scope);
    if (at == notFound)
        return 0;
    size_t name = at + scope.length() + 1;
    size_t end = path.find([](char16_t c) { return c == '/' || c == '\\'; }, name);
    if (end == notFound)
        return 0;
    StringView folder = StringView(path).substring(name, end - name);
    return folder == "api"_s || folder.startsWith("api@"_s) ? end : 0;
}

static __attribute__((minsize)) bool isEntryPointOfApi(const String& path)
{
    size_t folder = lengthOfFolderOfApi(path);
    if (!folder)
        return false;
    String file = makeStringByReplacingAll(path.substring(folder), '\\', '/');
    return file == "/dist/index.cjs"_s || file == "/dist/index.mjs"_s || file == "/build/src/index.js"_s || file == "/build/esm/index.js"_s || file == "/build/esnext/index.js"_s;
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
static __attribute__((minsize)) void fillRegistry(Zig::GlobalObject* globalObject, JSObject* registry)
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

// getGlobal() takes a registry whose minor version is not older than its own, and registerGlobal() wants its very
// own. So `version` suits every 1.x until registerGlobal() reads it, which only looking at the caller tells. That is
// too slow for getGlobal(), but registerGlobal() assigns to the global first:
// `_global[key] = _global[key] ?? { version: VERSION }`.
//
// The three accessor functions keep the registry, and the getter of `version` or what it goes by.
static constexpr auto registryField = static_cast<JSFunctionWithFields::Field>(0);
static constexpr auto versionGetterField = static_cast<JSFunctionWithFields::Field>(1);
// The key as a Symbol, `true` behind an assignment, or `false` while registerGlobal() is being asked.
static constexpr auto keyField = static_cast<JSFunctionWithFields::Field>(1);

static Identifier registryKey(VM& vm)
{
    return Identifier::fromUid(vm.symbolRegistry().symbolForKey("opentelemetry.js.api.1"_s));
}

static Symbol* registrySymbol(VM& vm)
{
    return Symbol::create(vm, static_cast<SymbolImpl&>(*registryKey(vm).impl()));
}

static JSFunctionWithFields* createAccessorFunction(JSGlobalObject* globalObject, NativeFunction body)
{
    auto& vm = getVM(globalObject);
    auto* function = JSFunctionWithFields::create(vm, globalObject, vm.getHostFunction(body, ImplementationVisibility::Private, callHostFunctionAsConstructor, 0, String()));
    function->setField(vm, registryField, jsUndefined());
    function->setField(vm, versionGetterField, jsUndefined());
    return function;
}

static JSFunctionWithFields* calleeOf(CallFrame* callFrame)
{
    return uncheckedDowncast<JSFunctionWithFields>(callFrame->jsCallee());
}

static bool isRegisterGlobal(CodeBlock* codeBlock)
{
    auto* executable = dynamicDowncast<FunctionExecutable>(codeBlock->ownerExecutable());
    if (!executable || codeBlock->isConstructor() || executable->parameterCount() < 3 || executable->parameterCount() > 4)
        return false;
    if (executable->parseMode() != SourceParseMode::NormalFunctionMode || executable->source().length() > 2048)
        return false;
    return executable->source().view().contains("Attempted duplicate registration of API"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsKeepApiLog, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    calleeOf(callFrame)->setField(getVM(globalObject), registryField, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

// What it logs last.
static __attribute__((minsize)) JSValue registerNothing(JSFunction* registerGlobal)
{
    auto* globalObject = registerGlobal->globalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* log = createAccessorFunction(globalObject, jsKeepApiLog);
    JSObject* logger = constructEmptyObject(globalObject);
    logger->putDirect(vm, Identifier::fromString(vm, "debug"_s), log);
    logger->putDirect(vm, Identifier::fromString(vm, "error"_s), log);
    MarkedArgumentBuffer arguments;
    arguments.append(jsEmptyString(vm));
    arguments.append(jsUndefined());
    arguments.append(logger);
    // It logs the stack of an Error, which is none of the program's.
    SetForScope withoutHook(defaultGlobalObject(globalObject)->isInsideErrorPrepareStackTraceCallback, true);
    call(globalObject, registerGlobal, getCallData(registerGlobal), jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});
    return log->getField(registryField);
}

static __attribute__((minsize)) JSValue versionBehind(JSGlobalObject* globalObject, JSValue logged, ASCIILiteral words)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!logged.isString())
        return jsUndefined();
    String text = asString(logged)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    size_t start = text.find(words);
    if (start == notFound)
        return jsUndefined();
    start += words.length();
    size_t end = start;
    while (end < text.length() && (isASCIIAlphanumeric(text[end]) || text[end] == '.' || text[end] == '-' || text[end] == '+'))
        ++end;
    if (end > start && text[end - 1] == '.')
        --end;
    return jsString(vm, text.substring(start, end - start));
}

static __attribute__((minsize)) JSValue askForVersion(JSFunction* registerGlobal)
{
    auto* globalObject = registerGlobal->globalObject();
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue refusal = registerNothing(registerGlobal);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue version = versionBehind(globalObject, refusal, "previously registered API v"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (version.isString())
        return version;

    // An older release only names it when it succeeds, which it does where there is no registry yet.
    Identifier key = registryKey(vm);
    JSValue registry = globalObject->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    bool isDeleted = registry.isObject() && JSCell::deleteProperty(globalObject, globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isDeleted)
        return jsUndefined();
    JSValue success = registerNothing(registerGlobal);
    bool hasThrown = scope.exception();
    {
        SuspendExceptionScope suspended(vm);
        auto restoring = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        PutPropertySlot slot(globalObject);
        globalObject->methodTable()->put(globalObject, globalObject, key, registry, slot);
        (void)restoring.tryClearException();
    }
    if (hasThrown)
        return {};
    RELEASE_AND_RETURN(scope, versionBehind(globalObject, success, "Registered a global for  v"_s));
}

struct Reader {
    JSFunction* registerGlobal { nullptr };
    bool isCompiled { false };
    bool isCalledRegisterGlobal { false };
};

static Reader readerOfVersion(VM& vm, CallFrame* callFrame)
{
    Reader reader;
    StackVisitor::visit(callFrame, vm, [&](StackVisitor& visitor) {
        if (!visitor->index())
            return IterationStatus::Continue;
        reader.isCompiled = visitor->isCompiledFrame();
        if (reader.isCompiled)
            reader.isCalledRegisterGlobal = visitor->functionName() == "registerGlobal"_s;
        else if (auto* codeBlock = visitor->codeBlock(); codeBlock && isRegisterGlobal(codeBlock))
            reader.registerGlobal = dynamicDowncast<JSFunction>(visitor->callee().asCell());
        return IterationStatus::Done;
    });
    return reader;
}

static bool hasRegistryAccessor(JSGlobalObject* globalObject, PropertyName key)
{
    unsigned attributes = 0;
    return globalObject->getDirect(getVM(globalObject), key, attributes) && (attributes & PropertyAttribute::Accessor);
}

static bool assignmentsOfCallerAreSeen(JSGlobalObject* globalObject, CallFrame* callFrame, Symbol* key)
{
    auto& vm = getVM(globalObject);
    if (!hasRegistryAccessor(globalObject, PropertyName(&key->uid())))
        return false;
    if (vm.hasCompiledCode())
        return true;
    // A context of node:vm may have been given a copy of the globals.
    EntryFrame* entryFrame = vm.topEntryFrame;
    CallFrame* caller = callFrame->callerFrame(entryFrame);
    return !caller || caller->isNativeCalleeFrame() || caller->lexicalGlobalObject(vm) == globalObject;
}

JSC_DEFINE_HOST_FUNCTION(jsGetApiVersion, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Telemetry, jsGetApiVersion);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* getter = calleeOf(callFrame);
    JSValue key = getter->getField(keyField);
    if (key.isTrue() || (key.isSymbol() && !assignmentsOfCallerAreSeen(globalObject, callFrame, asSymbol(key)))) [[unlikely]] {
        Reader reader = readerOfVersion(vm, callFrame);
        JSValue version = jsUndefined();
        if (reader.registerGlobal) {
            getter->setField(vm, keyField, jsBoolean(false));
            version = askForVersion(reader.registerGlobal);
        }
        getter->setField(vm, keyField, registrySymbol(vm));
        RETURN_IF_EXCEPTION(scope, {});
        // It takes no call that the compiler has not seen. The latest release is the guess, for this read alone.
        if (reader.isCompiled && (key.isTrue() || reader.isCalledRegisterGlobal))
            return JSValue::encode(jsNontrivialString(vm, "1.10.0"_s));
        if (version.isString()) {
            JSObject* registry = asObject(getter->getField(registryField));
            registry->methodTable()->defineOwnProperty(registry, globalObject, Identifier::fromString(vm, "version"_s), PropertyDescriptor(version, 0), false);
            RETURN_IF_EXCEPTION(scope, {});
            if (hasRegistryAccessor(globalObject, registryKey(vm))) {
                globalObject->methodTable()->defineOwnProperty(globalObject, globalObject, registryKey(vm), PropertyDescriptor(registry, 0), false);
                RETURN_IF_EXCEPTION(scope, {});
            }
            return JSValue::encode(version);
        }
    }
    static NeverDestroyed<String> suitsEveryMinor { MAKE_STATIC_STRING_IMPL("1.999.0") };
    return JSValue::encode(jsStringWithCache(vm, suitsEveryMinor.get()));
}

JSC_DEFINE_HOST_FUNCTION(jsGetApiRegistry, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Telemetry, jsGetApiRegistry);
    auto* getter = calleeOf(callFrame);
    if (JSValue registry = getter->getField(registryField); registry.isObject()) [[likely]]
        return JSValue::encode(registry);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* registry = constructEmptyObject(globalObject);
    auto* versionGetter = uncheckedDowncast<JSFunctionWithFields>(getter->getField(versionGetterField));
    registry->putDirectAccessor(globalObject, Identifier::fromString(vm, "version"_s), GetterSetter::create(vm, globalObject, versionGetter, nullptr), PropertyAttribute::Accessor | 0);
    fillRegistry(defaultGlobalObject(globalObject), registry);
    RETURN_IF_EXCEPTION(scope, {});
    versionGetter->setField(vm, registryField, registry);
    getter->setField(vm, registryField, registry);
    return JSValue::encode(registry);
}

JSC_DEFINE_HOST_FUNCTION(jsSetApiRegistry, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    BUN_REMOVABLE_HOST_FUNCTION_DEFINITION(Telemetry, jsSetApiRegistry);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* versionGetter = uncheckedDowncast<JSFunctionWithFields>(calleeOf(callFrame)->getField(versionGetterField));
    JSValue value = callFrame->argument(0);
    if (value.isObject() && value == versionGetter->getField(registryField)) {
        if (!versionGetter->getField(keyField).isFalse())
            versionGetter->setField(vm, keyField, jsBoolean(true));
        return JSValue::encode(jsUndefined());
    }
    globalObject->methodTable()->defineOwnProperty(globalObject, globalObject, registryKey(vm), PropertyDescriptor(value, 0), false);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

extern "C" __attribute__((minsize)) void Bun__Telemetry__registerWithApi(JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Identifier key = registryKey(vm);

    // The compiler has not seen these calls, so it may have left out what they would call.
    if (!vm.hasCompiledCode()) {
        registerWithLoadedCopiesOfApi(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
    }

    JSValue present = globalObject->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, );
    if (JSObject* registry = present.getObject())
        RELEASE_AND_RETURN(scope, fillRegistry(globalObject, registry));
    // A program that does not load the package never reads it.
    auto* versionGetter = createAccessorFunction(globalObject, jsGetApiVersion);
    auto* getter = createAccessorFunction(globalObject, jsGetApiRegistry);
    auto* setter = createAccessorFunction(globalObject, jsSetApiRegistry);
    versionGetter->setField(vm, keyField, registrySymbol(vm));
    getter->setField(vm, versionGetterField, versionGetter);
    setter->setField(vm, versionGetterField, versionGetter);
    globalObject->putDirectAccessor(globalObject, key, GetterSetter::create(vm, globalObject, getter, setter), PropertyAttribute::Accessor | 0);
}

}
