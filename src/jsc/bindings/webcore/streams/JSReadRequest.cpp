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
#include "WebStreamsHeapAnalyzer.h"
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

// Null-safe tee-branch controller recovery: Bun's native-sink pumps clear a consumed
// stream's controller slot in their finally step, so a tee reaction queued before that
// teardown can see a branch with no controller. A torn-down branch is terminal; skip it.
static JSReadableStreamDefaultController* teeBranchDefaultController(JSReadableStream* branch)
{
    if (branch->m_controllerKind != ControllerKind::Default)
        return nullptr;
    return uncheckedDowncast<JSReadableStreamDefaultController>(branch->m_controller.get());
}

static JSReadableByteStreamController* teeBranchByteController(JSReadableStream* branch)
{
    if (branch->m_controllerKind != ControllerKind::Byte)
        return nullptr;
    return uncheckedDowncast<JSReadableByteStreamController>(branch->m_controller.get());
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
    visitor.appendHidden(thisObject->m_context);
}

void JSReadRequest::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadRequest>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_context, "context"_s);
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
    case ReadRequestKind::ReadStreamIntoSink:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onReadStreamIntoSinkChunk(), chunk, m_context.get());
    case ReadRequestKind::ResumableSinkPump:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onResumableSinkChunk(), chunk, m_context.get());
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        auto* result = createIteratorResultObject(globalObject, chunk, false);
        RETURN_IF_EXCEPTION(scope, void());
        // Per spec, next()'s promise resolves from a queued microtask.
        queueStreamsMicrotask(globalObject, JSStreamsRuntime::from(globalObject)->onAsyncIteratorResolveMicrotask(), result, promise);
        return;
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
        auto* controller1 = teeBranchDefaultController(teeState->m_branch1.get());
        auto* controller2 = teeBranchDefaultController(teeState->m_branch2.get());
        if (!teeState->m_canceled1 && controller1) {
            readableStreamDefaultControllerClose(globalObject, controller1);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled2 && controller2) {
            readableStreamDefaultControllerClose(globalObject, controller2);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled1 || !teeState->m_canceled2)
            resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        return;
    }
    case ReadRequestKind::ByteTee: {
        auto* teeState = uncheckedDowncast<JSStreamTeeState>(m_context.get());
        teeState->m_reading = false;
        auto* controller1 = teeBranchByteController(teeState->m_branch1.get());
        auto* controller2 = teeBranchByteController(teeState->m_branch2.get());
        if (!teeState->m_canceled1 && controller1) {
            readableByteStreamControllerClose(globalObject, controller1);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled2 && controller2) {
            readableByteStreamControllerClose(globalObject, controller2);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (controller1 && !controller1->m_pendingPullIntos.isEmpty()) {
            readableByteStreamControllerRespond(globalObject, controller1, 0);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (controller2 && !controller2->m_pendingPullIntos.isEmpty()) {
            readableByteStreamControllerRespond(globalObject, controller2, 0);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!teeState->m_canceled1 || !teeState->m_canceled2)
            resolvePromise(globalObject, teeState->m_cancelPromise.get(), jsUndefined());
        return;
    }
    case ReadRequestKind::ReadStreamIntoSink:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onReadStreamIntoSinkClose(), jsUndefined(), m_context.get());
    case ReadRequestKind::ResumableSinkPump:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onResumableSinkClose(), jsUndefined(), m_context.get());
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* iterator = uncheckedDowncast<JSReadableStreamAsyncIterator>(context->getInternalField(0));
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        iterator->m_isFinished = true;
        readableStreamDefaultReaderRelease(globalObject, iterator->m_reader.get());
        RETURN_IF_EXCEPTION(scope, void());
        auto* result = createIteratorResultObject(globalObject, jsUndefined(), true);
        RETURN_IF_EXCEPTION(scope, void());
        queueStreamsMicrotask(globalObject, JSStreamsRuntime::from(globalObject)->onAsyncIteratorResolveMicrotask(), result, promise);
        return;
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
    case ReadRequestKind::ReadStreamIntoSink:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onReadStreamIntoSinkRejected(), error, m_context.get());
    case ReadRequestKind::ResumableSinkPump:
        return queueReactionJob(vm, globalObject, JSStreamsRuntime::from(globalObject)->onResumableSinkReadRejected(), error, m_context.get());
    case ReadRequestKind::AsyncIterator: {
        auto* context = uncheckedDowncast<InternalFieldTuple>(m_context.get());
        auto* iterator = uncheckedDowncast<JSReadableStreamAsyncIterator>(context->getInternalField(0));
        auto* promise = uncheckedDowncast<JSPromise>(context->getInternalField(1));
        iterator->m_isFinished = true;
        readableStreamDefaultReaderRelease(globalObject, iterator->m_reader.get());
        RETURN_IF_EXCEPTION(scope, void());
        queueStreamsMicrotask(globalObject, JSStreamsRuntime::from(globalObject)->onAsyncIteratorRejectMicrotask(), error, promise);
        return;
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
    visitor.appendHidden(thisObject->m_context);
}

void JSReadIntoRequest::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSReadIntoRequest>(cell);
    auto& vm = cell->vm();
    Base::analyzeHeap(cell, analyzer);
    analyzeBarrierEdge(vm, analyzer, cell, thisObject->m_context, "context"_s);
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
        auto* byobController = teeBranchByteController(byobBranch);
        auto* otherController = teeBranchByteController(otherBranch);
        bool byobCanceled = forBranch2 ? teeState->m_canceled2 : teeState->m_canceled1;
        bool otherCanceled = forBranch2 ? teeState->m_canceled1 : teeState->m_canceled2;
        if (!byobCanceled && byobController) {
            readableByteStreamControllerClose(globalObject, byobController);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (!otherCanceled && otherController) {
            readableByteStreamControllerClose(globalObject, otherController);
            RETURN_IF_EXCEPTION(scope, void());
        }
        if (chunkOrNull) {
            ASSERT(!chunkOrNull->byteLength());
            if (!byobCanceled && byobController) {
                readableByteStreamControllerRespondWithNewView(globalObject, byobController, chunkOrNull);
                RETURN_IF_EXCEPTION(scope, void());
            }
            if (!otherCanceled && otherController && !otherController->m_pendingPullIntos.isEmpty()) {
                readableByteStreamControllerRespond(globalObject, otherController, 0);
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
