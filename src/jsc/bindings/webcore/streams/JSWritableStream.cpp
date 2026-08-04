#include "config.h"
#include "JSWritableStream.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "JSWritableStreamDefaultController.h"
#include "JSWritableStreamDefaultWriter.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsHeapAnalyzer.h"
#include "WebStreamsInspectCustom.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_abort);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_close);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_getWriter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamPrototypeGetter_locked);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamPrototypeGetter_constructor);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamPrototype_inspectCustom);

class JSWritableStreamPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWritableStreamPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWritableStreamPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamPrototype>(vm)) JSWritableStreamPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamPrototype, JSWritableStreamPrototype::Base);

// JSWritableStreamConstructor = JSStreamConstructor<JSWritableStream>.

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamConstructor::construct(JSGlobalObject*, CallFrame*);
template<> JSValue JSWritableStreamConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);
template<> void JSWritableStreamConstructor::finishCreation(JSC::VM&, JSDOMGlobalObject&);
template<> GCClient::IsoSubspace* JSWritableStreamConstructor::subspaceForImpl(JSC::VM&);
template<> void JSWritableStreamConstructor::visitChildren(JSCell*, JSC::AbstractSlotVisitor&);
template<> void JSWritableStreamConstructor::visitChildren(JSCell*, JSC::SlotVisitor&);
template<>
template<typename Visitor>
void JSWritableStreamConstructor::visitChildrenImpl(JSCell*, Visitor&);

template<> const ClassInfo JSWritableStreamConstructor::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamConstructor) };

template<> JSValue JSWritableStreamConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<>
template<typename Visitor>
void JSWritableStreamConstructor::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWritableStreamConstructor>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_instanceStructure);
}
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(template<>, JSWritableStreamConstructor);

template<> GCClient::IsoSubspace* JSWritableStreamConstructor::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamConstructor, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamConstructor = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamConstructor.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamConstructor = std::forward<decltype(space)>(space); });
}

template<> void JSWritableStreamConstructor::finishCreation(VM& vm, JSDOMGlobalObject& globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "WritableStream"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSWritableStream::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    m_instanceStructure.set(vm, this, getDOMStructure<JSWritableStream>(vm, globalObject));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSWritableStreamConstructor>(callFrame->jsCallee());

    // `optional object underlyingSink`: missing => null; a present non-object is a TypeError.
    JSValue underlyingSink = callFrame->argument(0);
    if (underlyingSink.isUndefined())
        underlyingSink = jsNull();
    else if (!underlyingSink.isObject())
        return throwVMTypeError(lexicalGlobalObject, scope, "WritableStream constructor takes an object as first argument"_s);

    // WebIDL converts the strategy ARGUMENT before the constructor steps convert the sink.
    auto strategy = convertQueuingStrategyDict(lexicalGlobalObject, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    auto* structure = structureForNewTarget(vm, constructor, lexicalGlobalObject, asObject(callFrame->newTarget()));
    RETURN_IF_EXCEPTION(scope, {});
    auto* stream = JSWritableStream::create(vm, structure);

    auto sink = convertUnderlyingSinkDict(lexicalGlobalObject, underlyingSink);
    RETURN_IF_EXCEPTION(scope, {});
    if (sink.hasType)
        return throwVMRangeError(lexicalGlobalObject, scope, "The underlying sink's 'type' property is reserved and must not be present"_s);

    initializeWritableStream(stream);
    auto* sizeAlgorithm = extractSizeAlgorithm(strategy);
    double highWaterMark = extractHighWaterMark(lexicalGlobalObject, strategy, 1);
    RETURN_IF_EXCEPTION(scope, {});
    setUpWritableStreamDefaultControllerFromUnderlyingSink(lexicalGlobalObject, stream, underlyingSink, sink, highWaterMark, sizeAlgorithm);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(stream);
}
JSC_ANNOTATE_HOST_FUNCTION(JSWritableStreamConstructorConstruct, JSWritableStreamConstructor::construct);

// JSWritableStreamPrototype

static const HashTableValue JSWritableStreamPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamPrototypeGetter_constructor, 0 } },
    { "locked"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWritableStreamPrototypeGetter_locked, 0 } },
    { "abort"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_abort, 0 } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_close, 0 } },
    { "getWriter"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_getWriter, 0 } },
};

const ClassInfo JSWritableStreamPrototype::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototype_inspectCustom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callFrame->thisValue();
    auto* thisObject = dynamicDowncast<JSWritableStream>(thisValue);
    if (!thisObject) [[unlikely]]
        return JSValue::encode(thisValue);
    JSObject* data = constructEmptyObject(lexicalGlobalObject);
    data->putDirect(vm, Identifier::fromString(vm, "locked"_s), jsBoolean(isWritableStreamLocked(thisObject)), 0);
    ASCIILiteral state;
    switch (thisObject->m_state) {
    case WritableStreamState::Writable:
        state = "writable"_s;
        break;
    case WritableStreamState::Erroring:
        state = "erroring"_s;
        break;
    case WritableStreamState::Errored:
        state = "errored"_s;
        break;
    case WritableStreamState::Closed:
        state = "closed"_s;
        break;
    }
    data->putDirect(vm, Identifier::fromString(vm, "state"_s), jsNontrivialString(vm, state), 0);
    RELEASE_AND_RETURN(scope, Bun::WebStreams::customInspect(lexicalGlobalObject, callFrame, thisValue, "WritableStream"_s, data));
}

void JSWritableStreamPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStream::info(), JSWritableStreamPrototypeTableValues, *this);
    Bun::WebStreams::installInspectCustom(vm, this, jsWritableStreamPrototype_inspectCustom);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// JSWritableStream

const ClassInfo JSWritableStream::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStream) };

JSWritableStream::JSWritableStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSWritableStream::~JSWritableStream() = default;

void JSWritableStream::destroy(JSCell* cell)
{
    static_cast<JSWritableStream*>(cell)->JSWritableStream::~JSWritableStream();
}

void JSWritableStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWritableStream* JSWritableStream::create(VM& vm, Structure* structure)
{
    auto* stream = new (NotNull, allocateCell<JSWritableStream>(vm)) JSWritableStream(vm, structure);
    stream->finishCreation(vm);
    return stream;
}

Structure* JSWritableStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSWritableStream::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSWritableStreamPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSWritableStreamPrototype::create(vm, &globalObject, structure);
}

JSObject* JSWritableStream::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSWritableStream>(vm, globalObject);
}

JSValue JSWritableStream::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSWritableStreamConstructor, DOMConstructorID::WritableStream>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSWritableStream::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStream, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStream = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStream.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStream = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSWritableStream);

template<typename Visitor>
void JSWritableStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSWritableStream>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.appendHidden(thisObject->m_controller);
    visitor.appendHidden(thisObject->m_writer);
    visitor.appendHidden(thisObject->m_storedError);
    visitor.appendHidden(thisObject->m_closeRequest);
    visitor.appendHidden(thisObject->m_inFlightWriteRequest);
    visitor.appendHidden(thisObject->m_inFlightCloseRequest);
    visitor.appendHidden(thisObject->m_closedPromise);
    visitor.appendHidden(thisObject->m_pendingAbortRequest.promise);
    visitor.appendHidden(thisObject->m_pendingAbortRequest.reason);
    {
        WTF::Locker locker { thisObject->cellLock() };
        for (auto& writeRequest : thisObject->m_writeRequests)
            visitor.appendHidden(writeRequest);
    }
}

void JSWritableStream::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSWritableStream>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_controller, "controller"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_writer, "writer"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_storedError, "storedError"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closeRequest, "closeRequest"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_inFlightWriteRequest, "inFlightWriteRequest"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_inFlightCloseRequest, "inFlightCloseRequest"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_closedPromise, "closedPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingAbortRequest.promise, "pendingAbortRequestPromise"_s);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_pendingAbortRequest.reason, "pendingAbortRequestReason"_s);
    {
        WTF::Locker locker { thisObject->cellLock() };
        uint32_t i = 0;
        for (auto& entry : thisObject->m_writeRequests) {
            if (auto* value = entry.get())
                analyzer.analyzeIndexEdge(cell, value, i);
            ++i;
        }
    }
}

// Prototype host functions

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSWritableStreamPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSWritableStream::getConstructor(vm, prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamPrototypeGetter_locked, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSWritableStream>(JSValue::decode(thisValue));
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "WritableStream"_s);
    return JSValue::encode(jsBoolean(isWritableStreamLocked(stream)));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_abort, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSWritableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStream.prototype.abort can only be called on a WritableStream"_s))));
    if (isWritableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot abort a locked WritableStream"_s))));
    auto* promise = writableStreamAbort(lexicalGlobalObject, stream, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_close, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSWritableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "WritableStream.prototype.close can only be called on a WritableStream"_s))));
    if (isWritableStreamLocked(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot close a locked WritableStream"_s))));
    if (writableStreamCloseQueuedOrInFlight(stream))
        RELEASE_AND_RETURN(scope, JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_STATE_TypeError, "Invalid state: Cannot close a WritableStream that is already closing"_s))));
    auto* promise = writableStreamClose(lexicalGlobalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_getWriter, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = dynamicDowncast<JSWritableStream>(callFrame->thisValue());
    if (!stream) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, lexicalGlobalObject, "WritableStream"_s);
    auto* writer = acquireWritableStreamDefaultWriter(lexicalGlobalObject, stream);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(writer);
}

} // namespace WebCore
