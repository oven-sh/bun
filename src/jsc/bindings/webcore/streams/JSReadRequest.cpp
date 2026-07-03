#include "config.h"
#include "JSReadRequest.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMGlobalObject.h"
#include "JSReadableByteStreamController.h"
#include "JSReadableStream.h"
#include "JSReadableStreamAsyncIterator.h"
#include "JSReadableStreamDefaultController.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamPipeToOperation.h"
#include "JSStreamTeeState.h"
#include "JSStreamsRuntime.h"
#include "WebStreamsInternals.h"
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/MicrotaskQueue.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;
using namespace Bun::WebStreams;

// The tee state's branches always carry the controller kind their tee installed.
static JSReadableStreamDefaultController* defaultControllerOf(JSReadableStream* stream)
{
    ASSERT(stream->m_controllerKind == ControllerKind::Default);
    return uncheckedDowncast<JSReadableStreamDefaultController>(stream->m_controller.get());
}

static JSReadableByteStreamController* byteControllerOf(JSReadableStream* stream)
{
    ASSERT(stream->m_controllerKind == ControllerKind::Byte);
    return uncheckedDowncast<JSReadableByteStreamController>(stream->m_controller.get());
}

// [reaction-convention] deferral: runs handler(value, context) as its own microtask,
// carrying the current async context, without allocating a promise.
static void queueReactionJob(JSC::VM& vm, JSGlobalObject* globalObject, JSFunction* handler, JSValue value, JSValue context)
{
    JSValue asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    if (asyncContext.isEmpty())
        asyncContext = jsUndefined();
    QueuedTask task { nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, handler, asyncContext, value, context };
    vm.queueMicrotask(WTF::move(task));
}

const ClassInfo JSReadRequest::s_info = { "ReadRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadRequest) };

JSReadRequest::JSReadRequest(VM& vm, Structure* structure, ReadRequestKind kind)
    : Base(vm, structure)
    , m_kind(kind)
{
}

void JSReadRequest::finishCreation(VM& vm, JSValue context)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_context.set(vm, this, context);
}

JSReadRequest* JSReadRequest::create(VM& vm, Structure* structure, ReadRequestKind kind, JSValue context)
{
    auto* cell = new (NotNull, allocateCell<JSReadRequest>(vm)) JSReadRequest(vm, structure, kind);
    cell->finishCreation(vm, context);
    return cell;
}

Structure* JSReadRequest::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSReadRequest::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadRequest, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadRequest = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadRequest);

template<typename Visitor>
void JSReadRequest::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadRequest>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_context);
}

void JSReadRequest::chunkSteps(JSGlobalObject* globalObject, JSValue chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadRequestKind::Promise: {
        auto* promise = uncheckedDowncast<JSPromise>(m_context.get());
        auto* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    case ReadRequestKind::PipeTo:
        RELEASE_AND_RETURN(scope, pipeToReadRequestChunkSteps(globalObject, uncheckedDowncast<JSStreamPipeToOperation>(m_context.get()), chunk));
    case ReadRequestKind::DefaultTee:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onDefaultTeeReadChunkMicrotask(), chunk, m_context.get());
    case ReadRequestKind::ByteTee:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onByteTeeReadChunkMicrotask(), chunk, m_context.get());
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        auto* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void JSReadRequest::closeSteps(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadRequestKind::Promise: {
        auto* promise = uncheckedDowncast<JSPromise>(m_context.get());
        auto* result = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    case ReadRequestKind::PipeTo:
        RELEASE_AND_RETURN(scope, pipeToReadRequestCloseSteps(globalObject, uncheckedDowncast<JSStreamPipeToOperation>(m_context.get())));
    case ReadRequestKind::DefaultTee: {
        auto* teeState = uncheckedDowncast<JSStreamTeeState>(m_context.get());
        teeState->m_reading = false;
        if (!teeState->m_canceled1) {
            readableStreamDefaultControllerClose(globalObject, defaultControllerOf(teeState->m_branch1.get()));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled2) {
            readableStreamDefaultControllerClose(globalObject, defaultControllerOf(teeState->m_branch2.get()));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled1 || !teeState->m_canceled2)
            resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        return;
    }
    case ReadRequestKind::ByteTee: {
        auto* teeState = uncheckedDowncast<JSStreamTeeState>(m_context.get());
        teeState->m_reading = false;
        if (!teeState->m_canceled1) {
            readableByteStreamControllerClose(globalObject, byteControllerOf(teeState->m_branch1.get()));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled2) {
            readableByteStreamControllerClose(globalObject, byteControllerOf(teeState->m_branch2.get()));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!byteControllerOf(teeState->m_branch1.get())->m_pendingPullIntos.isEmpty()) {
            readableByteStreamControllerRespond(globalObject, byteControllerOf(teeState->m_branch1.get()), 0);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!byteControllerOf(teeState->m_branch2.get())->m_pendingPullIntos.isEmpty()) {
            readableByteStreamControllerRespond(globalObject, byteControllerOf(teeState->m_branch2.get()), 0);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled1 || !teeState->m_canceled2)
            resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        return;
    }
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* iterator = uncheckedDowncast<JSReadableStreamAsyncIterator>(context->getInternalField(0));
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        iterator->m_isFinished = true;
        readableStreamDefaultReaderRelease(globalObject, iterator->m_reader.get());
        RETURN_IF_EXCEPTION(scope, void());
        auto* result = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void JSReadRequest::errorSteps(JSGlobalObject* globalObject, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadRequestKind::Promise:
        RELEASE_AND_RETURN(scope, rejectPromise(globalObject, uncheckedDowncast<JSPromise>(m_context.get()), error));
    case ReadRequestKind::PipeTo:
        RELEASE_AND_RETURN(scope, pipeToReadRequestErrorSteps(globalObject, uncheckedDowncast<JSStreamPipeToOperation>(m_context.get()), error));
    case ReadRequestKind::DefaultTee:
    case ReadRequestKind::ByteTee:
        uncheckedDowncast<JSStreamTeeState>(m_context.get())->m_reading = false;
        return;
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* iterator = uncheckedDowncast<JSReadableStreamAsyncIterator>(context->getInternalField(0));
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        iterator->m_isFinished = true;
        readableStreamDefaultReaderRelease(globalObject, iterator->m_reader.get());
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, rejectPromise(globalObject, promise, error));
    }
    }
    RELEASE_ASSERT_NOT_REACHED();
}

const ClassInfo JSReadIntoRequest::s_info = { "ReadIntoRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadIntoRequest) };

JSReadIntoRequest::JSReadIntoRequest(VM& vm, Structure* structure, ReadIntoRequestKind kind)
    : Base(vm, structure)
    , m_kind(kind)
{
}

void JSReadIntoRequest::finishCreation(VM& vm, JSValue context)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_context.set(vm, this, context);
}

JSReadIntoRequest* JSReadIntoRequest::create(VM& vm, Structure* structure, ReadIntoRequestKind kind, JSValue context)
{
    auto* cell = new (NotNull, allocateCell<JSReadIntoRequest>(vm)) JSReadIntoRequest(vm, structure, kind);
    cell->finishCreation(vm, context);
    return cell;
}

Structure* JSReadIntoRequest::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

GCClient::IsoSubspace* JSReadIntoRequest::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSReadIntoRequest, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadIntoRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadIntoRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadIntoRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadIntoRequest = std::forward<decltype(space)>(space); });
}

DEFINE_VISIT_CHILDREN(JSReadIntoRequest);

template<typename Visitor>
void JSReadIntoRequest::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSReadIntoRequest>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_context);
}

void JSReadIntoRequest::chunkSteps(JSGlobalObject* globalObject, JSArrayBufferView* chunk)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadIntoRequestKind::Promise: {
        auto* promise = uncheckedDowncast<JSPromise>(m_context.get());
        auto* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    case ReadIntoRequestKind::ByteTee:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onByteTeeReadIntoChunkMicrotask(), chunk, m_context.get());
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void JSReadIntoRequest::closeSteps(JSGlobalObject* globalObject, JSArrayBufferView* chunkOrNull)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadIntoRequestKind::Promise: {
        auto* promise = uncheckedDowncast<JSPromise>(m_context.get());
        auto* result = createIteratorResultObject(globalObject, chunkOrNull ? JSValue(chunkOrNull) : jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, void());
        RELEASE_AND_RETURN(scope, resolvePromise(globalObject, promise, result));
    }
    case ReadIntoRequestKind::ByteTee: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* teeState = uncheckedDowncast<JSStreamTeeState>(context->getInternalField(0));
        bool forBranch2 = context->getInternalField(1).asBoolean();
        teeState->m_reading = false;
        auto* byobBranch = forBranch2 ? teeState->m_branch2.get() : teeState->m_branch1.get();
        auto* otherBranch = forBranch2 ? teeState->m_branch1.get() : teeState->m_branch2.get();
        bool byobCanceled = forBranch2 ? teeState->m_canceled2 : teeState->m_canceled1;
        bool otherCanceled = forBranch2 ? teeState->m_canceled1 : teeState->m_canceled2;
        if (!byobCanceled) {
            readableByteStreamControllerClose(globalObject, byteControllerOf(byobBranch));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!otherCanceled) {
            readableByteStreamControllerClose(globalObject, byteControllerOf(otherBranch));
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (chunkOrNull) {
            ASSERT(!chunkOrNull->byteLength());
            if (!byobCanceled) {
                readableByteStreamControllerRespondWithNewView(globalObject, byteControllerOf(byobBranch), chunkOrNull);
                RETURN_IF_EXCEPTION(scope, void());
            }
            if (!otherCanceled && !byteControllerOf(otherBranch)->m_pendingPullIntos.isEmpty()) {
                readableByteStreamControllerRespond(globalObject, byteControllerOf(otherBranch), 0);
                RETURN_IF_EXCEPTION(scope, void());
            }
        }
        if (!byobCanceled || !otherCanceled)
            resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        return;
    }
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void JSReadIntoRequest::errorSteps(JSGlobalObject* globalObject, JSValue error)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    switch (m_kind) {
    case ReadIntoRequestKind::Promise:
        RELEASE_AND_RETURN(scope, rejectPromise(globalObject, uncheckedDowncast<JSPromise>(m_context.get()), error));
    case ReadIntoRequestKind::ByteTee:
        uncheckedDowncast<JSStreamTeeState>(uncheckedDowncast<InternalFieldTuple>(m_context.get())->getInternalField(0))->m_reading = false;
        return;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

} // namespace WebCore
