#include "ErrorCode+List.h"
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
#include "BunReadableStreamDefaultReader.h"
#include "ErrorCode.h"
namespace Bun {

using namespace JSC;

class JSReadableStreamDefaultReaderPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSReadableStreamDefaultReaderPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamDefaultReaderPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReaderPrototype>(vm)) JSReadableStreamDefaultReaderPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamDefaultReaderPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamDefaultReaderPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

// JSReadableStreamDefaultReader.cpp

static JSC_DECLARE_CUSTOM_GETTER(readableStreamDefaultReaderClosedGetter);
static JSC_DECLARE_CUSTOM_GETTER(readableStreamDefaultReaderReadyGetter);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderRead);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderReleaseLock);
static JSC_DECLARE_HOST_FUNCTION(readableStreamDefaultReaderCancel);

const ClassInfo JSReadableStreamDefaultReader::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReader) };

static const HashTableValue JSReadableStreamDefaultReaderPrototypeTableValues[] = {
    { "closed"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, readableStreamDefaultReaderClosedGetter, nullptr } },
    { "ready"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, readableStreamDefaultReaderReadyGetter, nullptr } },
    { "read"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderRead, 0 } },
    { "releaseLock"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderReleaseLock, 0 } },
    { "cancel"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamDefaultReaderCancel, 1 } },
};

const ClassInfo JSReadableStreamDefaultReaderPrototype::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderPrototype) };

JSReadableStreamDefaultReader* JSReadableStreamDefaultReader::create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultReader* reader = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReader>(vm)) JSReadableStreamDefaultReader(vm, structure);
    reader->finishCreation(vm);
    reader->m_stream.set(vm, reader, stream);
    reader->m_readRequests.set(vm, reader, JSC::constructEmptyArray(globalObject, nullptr));
    reader->m_closedPromise.set(vm, reader, JSC::JSPromise::create(vm, globalObject->promiseStructure()));
    reader->m_readyPromise.set(vm, reader, JSC::JSPromise::create(vm, globalObject->promiseStructure()));
    return reader;
}

template<typename Visitor>
void JSReadableStreamDefaultReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* reader = jsCast<JSReadableStreamDefaultReader*>(cell);
    ASSERT_GC_OBJECT_INHERITS(reader, JSReadableStreamDefaultReader::info());
    Base::visitChildren(reader, visitor);
    visitor.append(reader->m_stream);
    visitor.append(reader->m_readyPromise);
    visitor.append(reader->m_closedPromise);
    visitor.append(reader->m_readRequests);
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultReader);

void JSReadableStreamDefaultReader::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void JSReadableStreamDefaultReader::detach()
{
    ASSERT(isActive());
    m_stream.clear();
    m_readyPromise.clear();
    m_readRequests.clear();
}

void JSReadableStreamDefaultReader::releaseLock()
{
    if (!isActive())
        return;

    // Release the stream's reader reference
    m_stream->setReader(nullptr);
    detach();
}

void JSReadableStreamDefaultReaderPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamDefaultReader::info(), JSReadableStreamDefaultReaderPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSPromise* JSReadableStreamDefaultReader::read(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!this->isActive()) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on released reader"_s));
        return nullptr;
    }

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // Add read request to the queue
    JSArray* readRequests = m_readRequests.get();
    readRequests->push(globalObject, promise);

    // Attempt to fulfill read request immediately if possible
    stream()->controller()->callPullIfNeeded(globalObject);

    return promise;
}

// JS Bindings Implementation
JSC_DEFINE_HOST_FUNCTION(readableStreamDefaultReaderRead, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSReadableStreamDefaultReader* reader = jsDynamicCast<JSReadableStreamDefaultReader*>(callFrame->thisValue());
    if (!reader) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on incompatible object"_s));
        return {};
    }

    JSC::JSPromise* promise = reader->read(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(promise);
}

class JSReadableStreamDefaultReaderConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static JSReadableStreamDefaultReaderConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStreamDefaultReaderPrototype* prototype)
    {
        JSReadableStreamDefaultReaderConstructor* constructor = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReaderConstructor>(vm)) JSReadableStreamDefaultReaderConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

private:
    JSReadableStreamDefaultReaderConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSReadableStreamDefaultReaderPrototype*);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
};

// Implementation

const ClassInfo JSReadableStreamDefaultReaderConstructor::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReaderConstructor) };

void JSReadableStreamDefaultReaderConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSReadableStreamDefaultReaderPrototype* prototype)
{
    Base::finishCreation(vm, 1, "ReadableStreamDefaultReader"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::call(JSC::JSGlobalObject* globalObject, JSC::CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "ReadableStreamDefaultReader constructor cannot be called as a function"_s);
    return {};
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamDefaultReaderConstructor::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultReader constructor requires a ReadableStream argument"_s);
    }

    JSValue streamValue = callFrame->uncheckedArgument(0);
    JSReadableStream* stream = jsDynamicCast<JSReadableStream*>(streamValue);
    if (!stream) {
        return throwVMTypeError(globalObject, scope, "ReadableStreamDefaultReader constructor argument must be a ReadableStream"_s);
    }

    // Check if stream is already locked
    if (stream->isLocked()) {
        return throwVMTypeError(globalObject, scope, "Cannot construct a ReadableStreamDefaultReader for a locked ReadableStream"_s);
    }

    JSC::JSObject* newTarget = callFrame->newTarget().getObject();
    JSC::JSObject* constructor = callFrame->jsCallee();

    auto* structure = defaultGlobalObject(globalObject)->readableStreamDefaultReaderStructure();

    // TODO: double-check this.
    if (!(!newTarget || newTarget == constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSReadableStreamDefaultReader* reader = JSReadableStreamDefaultReader::create(vm, globalObject, structure, stream);
    RETURN_IF_EXCEPTION(scope, {});

    // Lock the stream to this reader
    stream->setReader(reader);

    // Set up initial ready state
    if (stream->isDisturbed() || stream->state() == JSReadableStream::State::Errored) {
        JSValue error = stream->storedError();
        if (!error)
            error = jsUndefined();

        reader->readyPromise()->reject(globalObject, error);
    } else {
        reader->readyPromise()->fulfillWithNonPromise(globalObject, jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(reader));
}

}
