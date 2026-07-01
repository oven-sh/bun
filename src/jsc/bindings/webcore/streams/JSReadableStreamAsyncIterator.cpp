#include "config.h"
#include "JSReadableStreamAsyncIterator.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadRequest.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "WebCoreJSClientData.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AsyncIteratorPrototype.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamAsyncIteratorPrototypeFunction_next);
static JSC_DECLARE_HOST_FUNCTION(jsReadableStreamAsyncIteratorPrototypeFunction_return);

class JSReadableStreamAsyncIteratorPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSReadableStreamAsyncIteratorPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSReadableStreamAsyncIteratorPrototype* ptr = new (NotNull, JSC::allocateCell<JSReadableStreamAsyncIteratorPrototype>(vm)) JSReadableStreamAsyncIteratorPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamAsyncIteratorPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSReadableStreamAsyncIteratorPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSReadableStreamAsyncIteratorPrototype, JSReadableStreamAsyncIteratorPrototype::Base);

// %ReadableStreamAsyncIteratorPrototype% owns only `next` and `return`;
// @@asyncIterator comes from its [[Prototype]], %AsyncIteratorPrototype%.
static const HashTableValue JSReadableStreamAsyncIteratorPrototypeTableValues[] = {
    { "next"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamAsyncIteratorPrototypeFunction_next, 0 } },
    { "return"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsReadableStreamAsyncIteratorPrototypeFunction_return, 1 } },
};

const ClassInfo JSReadableStreamAsyncIteratorPrototype::s_info = { "ReadableStreamAsyncIterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamAsyncIteratorPrototype) };

void JSReadableStreamAsyncIteratorPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSReadableStreamAsyncIterator::info(), JSReadableStreamAsyncIteratorPrototypeTableValues, *this);
}

// JSReadableStreamAsyncIterator

const ClassInfo JSReadableStreamAsyncIterator::s_info = { "ReadableStreamAsyncIterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamAsyncIterator) };

JSReadableStreamAsyncIterator::JSReadableStreamAsyncIterator(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamAsyncIterator::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamAsyncIterator* JSReadableStreamAsyncIterator::create(VM& vm, Structure* structure)
{
    auto* iterator = new (NotNull, allocateCell<JSReadableStreamAsyncIterator>(vm)) JSReadableStreamAsyncIterator(vm, structure);
    iterator->finishCreation(vm);
    return iterator;
}

Structure* JSReadableStreamAsyncIterator::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSReadableStreamAsyncIterator::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSReadableStreamAsyncIteratorPrototype::createStructure(vm, &globalObject, globalObject.asyncIteratorPrototype());
    structure->setMayBePrototype(true);
    return JSReadableStreamAsyncIteratorPrototype::create(vm, &globalObject, structure);
}

JSObject* JSReadableStreamAsyncIterator::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSReadableStreamAsyncIterator>(vm, globalObject);
}

GCClient::IsoSubspace* JSReadableStreamAsyncIterator::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamAsyncIterator, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamAsyncIterator.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamAsyncIterator = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamAsyncIterator.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamAsyncIterator = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadableStreamAsyncIterator);

template<typename Visitor>
void JSReadableStreamAsyncIterator::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadableStreamAsyncIterator>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_reader);
    visitor.append(thisObject->m_ongoingPromise);
}

// "Get the next iteration result": the read request's chunk/close/error steps
// (JSReadRequest.cpp, AsyncIterator kind) settle the fresh promise carried at field 1.
static JSPromise* runAsyncIteratorNextSteps(JSGlobalObject* globalObject, JSReadableStreamAsyncIterator* iterator)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (iterator->m_isFinished) {
        auto* result = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, result));
    }

    auto* reader = iterator->m_reader.get();
    ASSERT(reader);
    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto* context = InternalFieldTuple::create(vm, domGlobalObject->internalFieldTupleStructure(), iterator, promise);
    auto* readRequest = JSReadRequest::create(vm, runtime->readRequestStructure(domGlobalObject), ReadRequestKind::AsyncIterator, context);
    readableStreamDefaultReaderRead(globalObject, reader, readRequest);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // Web IDL's next() transforms the "get the next iteration result" promise, so the value the
    // caller observes settles one reaction after the read request does (undefined = identity).
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    promise->performPromiseThenWithContext(vm, globalObject, jsUndefined(), jsUndefined(), result, jsUndefined());
    return result;
}

// "Asynchronous iterator return", wrapped per Web IDL: the result fulfills with { value, done: true }.
static JSPromise* runAsyncIteratorReturnSteps(JSGlobalObject* globalObject, JSReadableStreamAsyncIterator* iterator, JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (iterator->m_isFinished) {
        auto* result = createIteratorResultObject(globalObject, value, true);
        RETURN_IF_EXCEPTION(scope, nullptr);
        RELEASE_AND_RETURN(scope, promiseResolvedWith(globalObject, result));
    }
    iterator->m_isFinished = true;

    auto* reader = iterator->m_reader.get();
    ASSERT(reader);
    ASSERT(reader->m_readRequests.isEmpty());

    JSPromise* innerPromise = nullptr;
    if (!iterator->m_preventCancel) {
        innerPromise = readableStreamReaderGenericCancel(globalObject, reader, value);
        RETURN_IF_EXCEPTION(scope, nullptr);
        readableStreamDefaultReaderRelease(globalObject, reader);
        RETURN_IF_EXCEPTION(scope, nullptr);
    } else {
        readableStreamDefaultReaderRelease(globalObject, reader);
        RETURN_IF_EXCEPTION(scope, nullptr);
        innerPromise = promiseResolvedWith(globalObject, jsUndefined());
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    auto* domGlobalObject = defaultGlobalObject(globalObject);
    auto* runtime = JSStreamsRuntime::from(globalObject);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    // A tuple, not `value` directly: the context channel drops null/undefined contexts.
    auto* context = InternalFieldTuple::create(vm, domGlobalObject->internalFieldTupleStructure(), iterator, value);
    innerPromise->performPromiseThenWithContext(vm, globalObject, runtime->onAsyncIteratorCancelFulfilled(), jsUndefined(), result, context);
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamAsyncIteratorPrototypeFunction_next, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* iterator = dynamicDowncast<JSReadableStreamAsyncIterator>(callFrame->thisValue());
    if (!iterator) [[unlikely]]
        RELEASE_AND_RETURN(scope, rejectPromiseWithThisTypeError(*globalObject, "ReadableStreamAsyncIterator"_s, "next"_s));

    auto* ongoingPromise = iterator->m_ongoingPromise.get();
    if (ongoingPromise && ongoingPromise->status() == JSPromise::Status::Pending) {
        auto* runtime = JSStreamsRuntime::from(globalObject);
        auto* chained = JSPromise::create(vm, globalObject->promiseStructure());
        auto* onSettled = runtime->onAsyncIteratorNextAfterOngoingSettled();
        ongoingPromise->performPromiseThenWithContext(vm, globalObject, onSettled, onSettled, chained, iterator);
        iterator->m_ongoingPromise.set(vm, iterator, chained);
        return JSValue::encode(chained);
    }

    auto* promise = runAsyncIteratorNextSteps(globalObject, iterator);
    RETURN_IF_EXCEPTION(scope, {});
    iterator->m_ongoingPromise.set(vm, iterator, promise);
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsReadableStreamAsyncIteratorPrototypeFunction_return, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* iterator = dynamicDowncast<JSReadableStreamAsyncIterator>(callFrame->thisValue());
    if (!iterator) [[unlikely]]
        RELEASE_AND_RETURN(scope, rejectPromiseWithThisTypeError(*globalObject, "ReadableStreamAsyncIterator"_s, "return"_s));

    JSValue value = callFrame->argument(0);
    auto* ongoingPromise = iterator->m_ongoingPromise.get();
    if (ongoingPromise && ongoingPromise->status() == JSPromise::Status::Pending) {
        auto* domGlobalObject = defaultGlobalObject(globalObject);
        auto* runtime = JSStreamsRuntime::from(globalObject);
        auto* chained = JSPromise::create(vm, globalObject->promiseStructure());
        auto* context = InternalFieldTuple::create(vm, domGlobalObject->internalFieldTupleStructure(), iterator, value);
        auto* onSettled = runtime->onAsyncIteratorReturnAfterOngoingSettled();
        ongoingPromise->performPromiseThenWithContext(vm, globalObject, onSettled, onSettled, chained, context);
        iterator->m_ongoingPromise.set(vm, iterator, chained);
        return JSValue::encode(chained);
    }

    auto* promise = runAsyncIteratorReturnSteps(globalObject, iterator, value);
    RETURN_IF_EXCEPTION(scope, {});
    iterator->m_ongoingPromise.set(vm, iterator, promise);
    return JSValue::encode(promise);
}

// [reaction-convention] handlers (context at argument(1)). Each is a boundary: an exception
// it propagates rejects the chained result promise it was registered with.

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIteratorNextAfterOngoingSettled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* iterator = dynamicDowncast<JSReadableStreamAsyncIterator>(callFrame->argument(1));
    if (!iterator)
        return JSValue::encode(jsUndefined());
    auto* promise = runAsyncIteratorNextSteps(globalObject, iterator);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIteratorReturnAfterOngoingSettled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = dynamicDowncast<InternalFieldTuple>(callFrame->argument(1));
    if (!context)
        return JSValue::encode(jsUndefined());
    auto* iterator = uncheckedDowncast<JSReadableStreamAsyncIterator>(context->getInternalField(0));
    auto* promise = runAsyncIteratorReturnSteps(globalObject, iterator, context->getInternalField(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

// Fulfillment steps for the cancel promise: the return() result carries the caller's argument.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onAsyncIteratorCancelFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = dynamicDowncast<InternalFieldTuple>(callFrame->argument(1));
    if (!context)
        return JSValue::encode(jsUndefined());
    auto* result = createIteratorResultObject(globalObject, context->getInternalField(1), true);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

} // namespace WebCore
