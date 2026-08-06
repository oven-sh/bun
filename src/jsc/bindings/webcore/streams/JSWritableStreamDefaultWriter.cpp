#include "config.h"
#include "JSWritableStreamDefaultWriter.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSStreamPipeToOperation.h"
#include "JSWritableStream.h"
#include "JSWritableStreamDefaultController.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace Bun {
namespace WebStreams {

using namespace JSC;

JSPromise* writableStreamDefaultWriterAbort(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer, JSValue reason)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = writer->m_stream.get();
    ASSERT(stream);
    RELEASE_AND_RETURN(scope, writableStreamAbort(globalObject, stream, reason));
}

JSPromise* writableStreamDefaultWriterClose(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = writer->m_stream.get();
    ASSERT(stream);
    RELEASE_AND_RETURN(scope, writableStreamClose(globalObject, stream));
}

JSPromise* writableStreamDefaultWriterCloseWithErrorPropagation(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = writer->m_stream.get();
    ASSERT(stream);
    auto state = stream->m_state;
    if (writableStreamCloseQueuedOrInFlight(stream) || state == WritableStreamState::Closed)
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, JSC::jsUndefined()));
    if (state == WritableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, stream->m_storedError.get()));
    ASSERT(state == WritableStreamState::Writable || state == WritableStreamState::Erroring);
    RELEASE_AND_RETURN(scope, writableStreamDefaultWriterClose(globalObject, writer));
}

void writableStreamDefaultWriterEnsureClosedPromiseRejected(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* closedPromise = writer->m_closedPromise.get();
    if (closedPromise->status() == JSPromise::Status::Pending) {
        rejectPromise(globalObject, closedPromise, error);
        RETURN_IF_EXCEPTION(scope, );
    } else {
        closedPromise = promiseRejectedWith(globalObject, error);
        RETURN_IF_EXCEPTION(scope, );
        writer->m_closedPromise.set(vm, writer, closedPromise);
    }
    markPromiseAsHandled(vm, closedPromise);
}

void writableStreamDefaultWriterEnsureReadyPromiseRejected(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* readyPromise = writer->m_readyPromise.get();
    if (readyPromise && readyPromise->status() == JSPromise::Status::Pending) {
        rejectPromise(globalObject, readyPromise, error);
        RETURN_IF_EXCEPTION(scope, );
    } else {
        readyPromise = promiseRejectedWith(globalObject, error);
        RETURN_IF_EXCEPTION(scope, );
        writer->m_readyPromise.set(vm, writer, readyPromise);
    }
    markPromiseAsHandled(vm, readyPromise);
}

// Provably-non-throwing leaf: reads members and does queue arithmetic only.
std::optional<double> writableStreamDefaultWriterGetDesiredSize(JSWritableStreamDefaultWriter* writer)
{
    const auto* stream = writer->m_stream.get();
    switch (stream->m_state) {
    case WritableStreamState::Errored:
    case WritableStreamState::Erroring:
        return std::nullopt;
    case WritableStreamState::Closed:
        return 0;
    case WritableStreamState::Writable:
        break;
    }
    return writableStreamDefaultControllerGetDesiredSize(stream->m_controller.get());
}

void writableStreamDefaultWriterRelease(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = writer->m_stream.get();
    ASSERT(stream);
    ASSERT(stream->m_writer.get() == writer);
    JSValue releasedError = Bun::createError(globalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Writer has been released"_s);
    writableStreamDefaultWriterEnsureReadyPromiseRejected(globalObject, writer, releasedError);
    RETURN_IF_EXCEPTION(scope, );
    writableStreamDefaultWriterEnsureClosedPromiseRejected(globalObject, writer, releasedError);
    RETURN_IF_EXCEPTION(scope, );
    stream->m_writer.clear();
    writer->m_stream.clear();
}

JSPromise* writableStreamDefaultWriterWrite(JSGlobalObject* globalObject, JSWritableStreamDefaultWriter* writer, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = writer->m_stream.get();
    ASSERT(stream);
    auto* controller = stream->m_controller.get();
    // Runs the user size(); it never throws out, but a VM termination still propagates.
    double chunkSize = writableStreamDefaultControllerGetChunkSize(globalObject, controller, chunk);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (writer->m_stream.get() != stream)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createTypeError(globalObject, "This WritableStreamDefaultWriter was released while the queuing strategy's size() was running"_s)));
    auto state = stream->m_state;
    if (state == WritableStreamState::Errored)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, stream->m_storedError.get()));
    if (writableStreamCloseQueuedOrInFlight(stream) || state == WritableStreamState::Closed)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, createTypeError(globalObject, "Cannot write to a WritableStream that is closing or closed"_s)));
    if (state == WritableStreamState::Erroring)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, stream->m_storedError.get()));
    ASSERT(state == WritableStreamState::Writable);
    auto* promise = writableStreamAddWriteRequest(globalObject, stream);
    writableStreamDefaultControllerWrite(globalObject, controller, chunk, chunkSize);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return promise;
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_abort);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_close);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_releaseLock);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_write);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_closed);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_desiredSize);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_ready);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_constructor);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototype_inspectCustom);

class JSWritableStreamDefaultWriterPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWritableStreamDefaultWriterPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWritableStreamDefaultWriterPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultWriterPrototype>(vm)) JSWritableStreamDefaultWriterPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultWriterPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultWriterPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultWriterPrototype, JSWritableStreamDefaultWriterPrototype::Base);

// JSWritableStreamDefaultWriterConstructor = JSStreamConstructor<JSWritableStreamDefaultWriter>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSWritableStreamDefaultWriterConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSWritableStreamDefaultWriterConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSWritableStreamDefaultWriterConstructor::subspaceForImpl(JSC::VM&);
template<> void JSWritableStreamDefaultWriterConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSWritableStreamDefaultWriterConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSWritableStreamDefaultWriterConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSWritableStreamDefaultWriterConstructor::s_info = { "WritableStreamDefaultWriter"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterConstructor) };

template<> JSValue JSWritableStreamDefaultWriterConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSWritableStreamDefaultWriterConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamDefaultWriterConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSWritableStreamDefaultWriterConstructor);

template<> GCClient::IsoSubspace* JSWritableStreamDefaultWriterConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamDefaultWriterConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamDefaultWriterConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamDefaultWriterConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamDefaultWriterConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamDefaultWriterConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSWritableStreamDefaultWriterConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "WritableStreamDefaultWriter"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSWritableStreamDefaultWriter::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSWritableStreamDefaultWriter>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSWritableStreamDefaultWriterConstructor>(callFrame->jsCallee());

    auto* stream = dynamicDowncast<JSWritableStream>(callFrame->argument(0));
    if (!stream)
        return throwVMTypeError(lexicalGlobalObject, scope, "WritableStreamDefaultWriter constructor requires a WritableStream as its first argument"_s);

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* writer = JSWritableStreamDefaultWriter::create(vm, structure);
    setUpWritableStreamDefaultWriter(lexicalGlobalObject, writer, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(writer);
}
JSC_ANNOTATE_HOST_FUNCTION(JSWritableStreamDefaultWriterConstructorConstruct, JSWritableStreamDefaultWriterConstructor::construct);

// JSWritableStreamDefaultWriterPrototype

static const HashTableValue JSWritableStreamDefaultWriterPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterPrototypeGetter_constructor, 0 } },
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterPrototypeGetter_closed, 0 } },
    { "desiredSize"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterPrototypeGetter_desiredSize, 0 } },
    { "ready"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterPrototypeGetter_ready, 0 } },
    { "abort"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterPrototypeFunction_abort, 0 } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterPrototypeFunction_close, 0 } },
    { "releaseLock"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterPrototypeFunction_releaseLock, 0 } },
    { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterPrototypeFunction_write, 0 } },
};

const ClassInfo JSWritableStreamDefaultWriterPrototype::s_info = { "WritableStreamDefaultWriter"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSWritableStreamDefaultWriter>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "stream"_s), thisObject->m_stream.get() ? JSValue(thisObject->m_stream.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "close"_s), thisObject->m_closedPromise.get() ? JSValue(thisObject->m_closedPromise.get()) : jsUndefined(), 0);
    data->putDirect(vm, Identifier::fromString(vm, "ready"_s), thisObject->m_readyPromise.get() ? JSValue(thisObject->m_readyPromise.get()) : jsUndefined(), 0);
    JSValue desiredSizeValue = jsNull();
    if (thisObject->m_stream.get()) {
        auto desiredSize = writableStreamDefaultWriterGetDesiredSize(thisObject);
        desiredSizeValue = desiredSize ? jsNumber(*desiredSize) : jsNull();
    }
    data->putDirect(vm, Identifier::fromString(vm, "desiredSize"_s), desiredSizeValue, 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "WritableStreamDefaultWriter"_s, data));
}

void JSWritableStreamDefaultWriterPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStreamDefaultWriter::info(), JSWritableStreamDefaultWriterPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsWritableStreamDefaultWriterPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSWritableStreamDefaultWriter

const ClassInfo JSWritableStreamDefaultWriter::s_info = { "WritableStreamDefaultWriter"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamDefaultWriter) };

JSWritableStreamDefaultWriter::JSWritableStreamDefaultWriter(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSWritableStreamDefaultWriter::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWritableStreamDefaultWriter* JSWritableStreamDefaultWriter::create(VM& vm, Structure* structure)
{
    auto* writer = new (NotNull, allocateCell<JSWritableStreamDefaultWriter>(vm)) JSWritableStreamDefaultWriter(vm, structure);
    writer->finishCreation(vm);
    return writer;
}

Structure* JSWritableStreamDefaultWriter::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSWritableStreamDefaultWriter::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSWritableStreamDefaultWriterPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSWritableStreamDefaultWriterPrototype::create(vm, &globalObject, structure);
}

JSObject* JSWritableStreamDefaultWriter::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSWritableStreamDefaultWriter>(vm, globalObject);
}

JSValue JSWritableStreamDefaultWriter::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSWritableStreamDefaultWriterConstructor, DOMConstructorID::WritableStreamDefaultWriter>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSWritableStreamDefaultWriter::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamDefaultWriter, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamDefaultWriter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamDefaultWriter = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamDefaultWriter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamDefaultWriter = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultWriter);

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamDefaultWriter>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_stream);
    visitor.appendHidden(thisObject->m_closedPromise);
    visitor.appendHidden(thisObject->m_readyPromise);
    visitor.appendHidden(thisObject->m_pipeOperation);
}

void JSWritableStreamDefaultWriter::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamDefaultWriter>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_stream, "stream"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closedPromise, "closedPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_readyPromise, "readyPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pipeOperation, "pipeOperation"_s);
}

// Prototype accessors and host functions

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSWritableStreamDefaultWriterPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSWritableStreamDefaultWriter::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_closed, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    const auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(JSValue::decode(thisValue));
    if (!writer) [[unlikely]]
        return JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "The 'closed' getter can only be used on a WritableStreamDefaultWriter"_s)));
    return JSValue::encode(writer->m_closedPromise.get());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_desiredSize, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(JSValue::decode(thisValue));
    if (!writer) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "WritableStreamDefaultWriter"_s);
    if (!writer->m_stream)
        return Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Writer is not bound to a WritableStream"_s);
    auto desiredSize = writableStreamDefaultWriterGetDesiredSize(writer);
    if (!desiredSize)
        return JSValue::encode(jsNull());
    return JSValue::encode(jsNumber(*desiredSize));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterPrototypeGetter_ready, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(JSValue::decode(thisValue));
    if (!writer) [[unlikely]]
        return JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "The 'ready' getter can only be used on a WritableStreamDefaultWriter"_s)));
    return JSValue::encode(writer->readyPromise(lexicalGlobalObject));
}

JSPromise* JSWritableStreamDefaultWriter::readyPromise(JSGlobalObject* globalObject)
{
    if (auto* ready = m_readyPromise.get())
        return ready;
    // Only writableStreamUpdateBackpressure clears the slot (while Writable); every other
    // state transition sets it eagerly. Materialize pending if backpressure, else fulfilled.
    auto& vm = getVM(globalObject);
    auto* stream = m_stream.get();
    auto* ready = (stream && stream->m_backpressure)
        ? JSPromise::create(vm, globalObject->promiseStructure())
        : Bun::WebStreams::promiseFulfilledWith(globalObject, JSC::jsUndefined());
    m_readyPromise.set(vm, this, ready);
    return ready;
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_abort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(callFrame->thisValue());
    if (!writer) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultWriter.prototype.abort can only be called on a WritableStreamDefaultWriter"_s))));
    if (!writer->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Writer is not bound to a WritableStream"_s))));
    auto* promise = writableStreamDefaultWriterAbort(lexicalGlobalObject, writer, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_close, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(callFrame->thisValue());
    if (!writer) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultWriter.prototype.close can only be called on a WritableStreamDefaultWriter"_s))));
    auto* stream = writer->m_stream.get();
    if (!stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Writer is not bound to a WritableStream"_s))));
    if (writableStreamCloseQueuedOrInFlight(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot close a WritableStream that is already closing"_s))));
    auto* promise = writableStreamDefaultWriterClose(lexicalGlobalObject, writer);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_releaseLock, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(callFrame->thisValue());
    if (!writer) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "WritableStreamDefaultWriter"_s);
    const auto* stream = writer->m_stream.get();
    if (!stream)
        return JSValue::encode(jsUndefined());
    ASSERT(stream->m_writer);
    writableStreamDefaultWriterRelease(lexicalGlobalObject, writer);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterPrototypeFunction_write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* writer = dynamicDowncast<JSWritableStreamDefaultWriter>(callFrame->thisValue());
    if (!writer) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStreamDefaultWriter.prototype.write can only be called on a WritableStreamDefaultWriter"_s))));
    if (!writer->m_stream)
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Writer is not bound to a WritableStream"_s))));
    auto* promise = writableStreamDefaultWriterWrite(lexicalGlobalObject, writer, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

} // namespace WebCore
