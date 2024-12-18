#include "root.h"

#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include "BunReadableStream.h"
#include <JavaScriptCore/WriteBarrier.h>
#include "BunStreamInlines.h"
#include "BunTeeState.h"
#include "JSAbortSignal.h"
#include "BunReadableStreamDefaultController.h"
#include <JavaScriptCore/Completion.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamGetLocked);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamGetReader);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamCancel);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPipeTo);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamPipeThrough);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamTee);

static JSC_DECLARE_CUSTOM_GETTER(jsReadableStreamGetLocked);

static const HashTableValue JSReadableStreamPrototypeTableValues[] = {
    { "locked"_s,
        static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsReadableStreamGetLocked, nullptr } },
    { "getReader"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamGetReader, 1 } },
    { "cancel"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamCancel, 1 } },
    { "pipeTo"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamPipeTo, 2 } },
    { "pipeThrough"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamPipeThrough, 2 } },
    { "tee"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsReadableStreamTee, 0 } }
};

// Prototype class
class JSReadableStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSReadableStreamPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        auto* thisObject = new (NotNull, allocateCell<JSReadableStreamPrototype>(vm)) JSReadableStreamPrototype(vm, structure);
        thisObject->finishCreation(vm, globalObject);
        return thisObject;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Base::createStructure(vm, globalObject, prototype);
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSReadableStreamPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM& vm, JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);

        reifyAllStaticProperties(globalObject);

        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

class JSReadableStreamConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSReadableStreamConstructor* create(VM&, JSGlobalObject*, Structure*, JSObject*);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Base::createStructure(vm, globalObject, prototype);
    }

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

private:
    JSReadableStreamConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }
    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "ReadableStream"_s, PropertyAdditionMode::WithoutStructureTransition);

        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
    }
};

JSValue JSReadableStream::getReader(VM& vm, JSGlobalObject* globalObject, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (locked()) {
        throwTypeError(globalObject, scope, "ReadableStream is locked"_s);
        return {};
    }

    if (!options.isUndefined()) {
        JSObject* optionsObject = options.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        JSValue mode = optionsObject->get(globalObject, vm.propertyNames->mode);
        RETURN_IF_EXCEPTION(scope, {});

        if (mode.getString(globalObject) == "byob"_s) {
            if (!m_controller || !m_controller->isByteController()) {
                throwTypeError(globalObject, scope, "Cannot get a BYOB reader for a non-byte stream"_s);
                return {};
            }

            Structure* readerStructure = globalObject->readableStreamBYOBReaderStructure();
            auto* reader = JSReadableStreamBYOBReader::create(vm, globalObject, readerStructure);
            reader->attach(this);
            m_reader.set(vm, this, reader);
            return reader;
        }
    }

    Structure* readerStructure = globalObject->readableStreamDefaultReaderStructure();
    auto* reader = JSReadableStreamDefaultReader::create(vm, globalObject, readerStructure);
    reader->attach(this);
    m_reader.set(vm, this, reader);
    return reader;
}

JSPromise* JSReadableStream::cancel(VM& vm, JSGlobalObject* globalObject, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (locked()) {
        throwTypeError(globalObject, scope, "ReadableStream is locked"_s);
        return nullptr;
    }

    if (m_state == State::Closed)
        return JSPromise::resolvedPromise(globalObject, jsUndefined());

    if (m_state == State::Errored) {
        return JSPromise::rejectedPromise(globalObject, storedError());
    }

    m_disturbed = true;

    if (!m_controller)
        return JSPromise::resolvedPromise(globalObject, jsUndefined());

    JSObject* cancelAlgorithm = m_controller->cancelAlgorithm();
    m_controller.clear();

    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, cancelAlgorithm, JSC::getCallData(cancelAlgorithm), jsUndefined(), reason);

    RETURN_IF_EXCEPTION(scope, nullptr);

    if (auto* promise = jsDynamicCast<JSPromise*>(result))
        return promise;

    return JSPromise::resolvedPromise(globalObject, result);
}

JSPromise* JSReadableStream::pipeTo(VM& vm, JSGlobalObject* globalObject, JSObject* destination, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!destination) {
        throwTypeError(globalObject, scope, "Destination must be a WritableStream"_s);
        return nullptr;
    }

    JSWritableStream* writableStream = jsDynamicCast<JSWritableStream*>(destination);

    if (locked() || writableStream->locked()) {
        throwTypeError(globalObject, scope, "Cannot pipe to/from a locked stream"_s);
        return nullptr;
    }

    bool preventClose = false;
    bool preventAbort = false;
    bool preventCancel = false;
    WebCore::JSAbortSignal* signal = nullptr;

    if (!options.isUndefined()) {
        JSObject* optionsObject = options.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);

        JSValue preventCloseValue = optionsObject->get(globalObject, Identifier::fromString(vm, "preventClose"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        preventClose = preventCloseValue.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);

        JSValue preventAbortValue = optionsObject->get(globalObject, Identifier::fromString(vm, "preventAbort"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        preventAbort = preventAbortValue.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSValue preventCancelValue = optionsObject->get(globalObject, Identifier::fromString(vm, "preventCancel"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        preventCancel = preventCancelValue.toBoolean(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);

        JSValue signalValue = optionsObject->get(globalObject, Identifier::fromString(vm, "signal"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!signalValue.isUndefined()) {
            if (auto* abortSignal = jsDynamicCast<WebCore::JSAbortSignal*>(signalValue)) {
                signal = abortSignal;
            } else {
                throwTypeError(globalObject, scope, "Signal must be an instance of AbortSignal"_s);
                return nullptr;
            }
        }
    }

    m_disturbed = true;

    auto* reader = JSReadableStreamDefaultReader::create(vm, globalObject, globalObject->readableStreamDefaultReaderStructure());
    reader->attach(this);

    auto* writer = JSWritableStreamDefaultWriter::create(vm, globalObject, globalObject->writableStreamDefaultWriterStructure());
    writer->attach(writableStream);

    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());

    auto* pipeToOperation = PipeToOperation::create(vm, globalObject, reader, writer, preventClose, preventAbort, preventCancel, signal, promise);
    pipeToOperation->perform();

    return promise;
}

JSValue JSReadableStream::pipeThrough(VM& vm, JSGlobalObject* globalObject, JSObject* transform, JSValue options)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!transform) {
        throwTypeError(globalObject, scope, "Transform must be an object"_s);
        return {};
    }

    JSValue readableValue = transform->get(globalObject, Identifier::fromString(vm, "readable"_s));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue writableValue = transform->get(globalObject, Identifier::fromString(vm, "writable"_s));
    RETURN_IF_EXCEPTION(scope, {});

    JSReadableStream* readable = jsDynamicCast<JSReadableStream*>(readableValue);
    if (UNLIKELY(!readable)) {
        throwTypeError(globalObject, scope, "Transform must have readable property that is a stream"_s);
        return {};
    }

    JSWritableStream* writable = jsDynamicCast<JSWritableStream*>(writableValue);
    if (UNLIKELY(!writable)) {
        throwTypeError(globalObject, scope, "Transform must have writable property that is a stream"_s);
        return {};
    }

    JSPromise* pipePromise = pipeTo(vm, globalObject, jsCast<JSWritableStream*>(writable), options);
    RETURN_IF_EXCEPTION(scope, {});

    // We don't want to expose the pipeTo promise to user code
    pipePromise->markAsHandled(globalObject);

    return readable;
}

void JSReadableStream::tee(VM& vm, JSGlobalObject* globalObject, JSC::JSValue& firstStream, JSC::JSValue& secondStream)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (locked()) {
        throwTypeError(globalObject, scope, "ReadableStream is locked"_s);
        return;
    }

    if (m_state == State::Errored) {
        auto* error = m_storedError.get();
        auto* stream1 = JSReadableStream::create(vm, globalObject, globalObject->readableStreamStructure());
        auto* stream2 = JSReadableStream::create(vm, globalObject, globalObject->readableStreamStructure());
        stream1->error(vm, globalObject, error);
        stream2->error(vm, globalObject, error);
        firstStream = stream1;
        secondStream = stream2;
        return;
    }

    m_disturbed = true;

    auto* reader = JSReadableStreamDefaultReader::create(vm, globalObject, globalObject->readableStreamDefaultReaderStructure());
    reader->attach(this);

    auto* branch1 = JSReadableStream::create(vm, globalObject, globalObject->readableStreamStructure());
    auto* branch2 = JSReadableStream::create(vm, globalObject, globalObject->readableStreamStructure());

    firstStream = branch1;
    secondStream = branch2;

    TeeState* teeState = TeeState::create(vm, globalObject, reader, branch1, branch2);
    teeState->perform(vm, globalObject);
}

// JavaScript bindings
JSC_DEFINE_CUSTOM_GETTER(jsReadableStreamGetLocked, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(JSValue::decode(thisValue));
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    return JSValue::encode(jsBoolean(stream->locked()));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamGetReader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue options = callFrame->argument(0);
    return JSValue::encode(stream->getReader(vm, globalObject, options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue reason = callFrame->argument(0);
    return JSValue::encode(stream->cancel(vm, globalObject, reason));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPipeTo, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue destination = callFrame->argument(0);
    JSValue options = callFrame->argument(1);

    return JSValue::encode(stream->pipeTo(vm, globalObject, destination.toObject(globalObject), options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamPipeThrough, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSValue transform = callFrame->argument(0);
    JSValue options = callFrame->argument(1);

    return JSValue::encode(stream->pipeThrough(vm, globalObject, transform.toObject(globalObject), options));
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamTee, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Not a ReadableStream"_s);

    JSC::JSValue firstStream;
    JSC::JSValue secondStream;
    stream->tee(vm, globalObject, firstStream, secondStream);
    RETURN_IF_EXCEPTION(scope, {});

    JSArray* array = constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 2);
    array->putDirectIndex(globalObject, 0, firstStream);
    array->putDirectIndex(globalObject, 1, secondStream);
    return JSValue::encode(array);
}

const ClassInfo JSReadableStream::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStream) };
const ClassInfo JSReadableStreamPrototype::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamPrototype) };
const ClassInfo JSReadableStreamConstructor::s_info = { "ReadableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamConstructor) };
}
