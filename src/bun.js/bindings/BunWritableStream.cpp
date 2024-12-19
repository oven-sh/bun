#include "root.h"

#include "BunWritableStream.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStreamDefaultWriter.h"
#include "BunStreamStructures.h"
#include "BunStreamInlines.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// Forward declarations
namespace Operations {
void WritableStreamStartErroring(JSWritableStream* stream, JSValue reason);
void WritableStreamFinishErroring(JSWritableStream* stream);
void WritableStreamDefaultWriterEnsureReadyPromiseRejected(JSWritableStreamDefaultWriter* writer, JSValue reason);
} // namespace Operations

// JSWritableStreamPrototype bindings
JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_abort, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.abort called on non-WritableStream object"_s);

    JSValue reason = callFrame->argument(0);
    return JSValue::encode(stream->abort(globalObject, reason));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_close, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.close called on non-WritableStream object"_s);

    return JSValue::encode(stream->close(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrototypeFunction_getWriter, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(callFrame->thisValue());
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.getWriter called on non-WritableStream object"_s);

    if (stream->isLocked())
        return throwVMTypeError(globalObject, scope, "Cannot get writer for locked WritableStream"_s);

    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (!zigGlobalObject)
        return throwVMTypeError(globalObject, scope, "Invalid global object"_s);

    Structure* writerStructure = zigGlobalObject->streamStructures().getWritableStreamDefaultWriterStructure(zigGlobalObject);
    auto* writer = JSWritableStreamDefaultWriter::create(vm, writerStructure, stream);
    RETURN_IF_EXCEPTION(scope, {});

    stream->setWriter(vm, writer);
    return JSValue::encode(writer);
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamPrototypeLockedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(JSValue::decode(thisValue));
    if (!stream)
        return throwVMTypeError(globalObject, scope, "WritableStream.prototype.locked called on non-WritableStream object"_s);

    return JSValue::encode(jsBoolean(stream->isLocked()));
}

// Static hash table of properties
static const HashTableValue JSWritableStreamPrototypeTableValues[] = {
    { "abort"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_abort, 1 } },
    { "close"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_close, 0 } },
    { "getWriter"_s,
        static_cast<unsigned>(PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamPrototypeFunction_getWriter, 0 } },
    { "locked"_s,
        static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamPrototypeLockedGetter, nullptr } }
};

class JSWritableStreamPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static JSWritableStreamPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure);
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Base::createStructure(vm, globalObject, prototype);
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSWritableStreamPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm, JSGlobalObject* globalObject);
};

class JSWritableStreamConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWritableStreamConstructor* create(VM&, JSGlobalObject*, Structure*, JSWritableStreamPrototype*);
    DECLARE_INFO;

    template<typename CellType, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWritableStreamConstructor,
            WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForConstructor = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForConstructor = std::forward<decltype(space)>(space); });
    }

    static Structure* createStructure(VM&, JSGlobalObject*, JSValue prototype);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

private:
    JSWritableStreamConstructor(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype)
    {
        Base::finishCreation(vm, 1, "WritableStream"_s, PropertyAdditionMode::WithStructureTransition);
        this->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, 0);
    }
};

// Prototype Implementation
const ClassInfo JSWritableStreamPrototype::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamPrototype) };

JSWritableStreamPrototype* JSWritableStreamPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* prototype = new (NotNull, allocateCell<JSWritableStreamPrototype>(vm)) JSWritableStreamPrototype(vm, structure);
    prototype->finishCreation(vm, globalObject);
    return prototype;
}

void JSWritableStreamPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSWritableStream::info(), JSWritableStreamPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Constructor Implementation
const ClassInfo JSWritableStreamConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamConstructor) };

JSWritableStreamConstructor::JSWritableStreamConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

JSWritableStreamConstructor* JSWritableStreamConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSWritableStreamPrototype* prototype)
{
    JSWritableStreamConstructor* constructor = new (NotNull, allocateCell<JSWritableStreamConstructor>(vm)) JSWritableStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

Structure* JSWritableStreamConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue newTarget = callFrame->newTarget();
    if (newTarget.isUndefined())
        return throwVMTypeError(globalObject, scope, "WritableStream constructor must be called with 'new'"_s);

    JSObject* underlyingSink = callFrame->argument(0).getObject();
    JSValue strategy = callFrame->argument(1);

    JSObject* constructor = asObject(newTarget);
    Structure* structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget, globalObject->writableStreamStructure());
    RETURN_IF_EXCEPTION(scope, {});

    JSWritableStream* stream = JSWritableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    // Initialize with underlying sink if provided
    if (underlyingSink) {
        // Set up controller with underlying sink...
        auto controller = JSWritableStreamDefaultController::create(vm, globalObject, stream, underlyingSink);
        RETURN_IF_EXCEPTION(scope, {});
        stream->setController(controller);
    }

    return JSValue::encode(stream);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrivateConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    // Similar to above but for internal usage
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Structure* structure = globalObject->writableStreamStructure();
    JSWritableStream* stream = JSWritableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}

// WritableStream implementation
const ClassInfo JSWritableStream::s_info = { "WritableStream"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStream) };

JSWritableStream::JSWritableStream(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSWritableStream::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWritableStream* JSWritableStream::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* zigGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    if (!zigGlobalObject)
        return nullptr;

    Structure* streamStructure = zigGlobalObject->streamStructures().getWritableStreamStructure(zigGlobalObject);
    JSWritableStream* stream = new (NotNull, allocateCell<JSWritableStream>(vm))
        JSWritableStream(vm, streamStructure ? streamStructure : structure);
    stream->finishCreation(vm);
    return stream;
}

void JSWritableStream::destroy(JSCell* cell)
{
    static_cast<JSWritableStream*>(cell)->JSWritableStream::~JSWritableStream();
}

template<typename Visitor>
void JSWritableStream::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSWritableStream*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_controller);
    visitor.append(thisObject->m_writer);
    visitor.append(thisObject->m_closeRequest);
    visitor.append(thisObject->m_inFlightWriteRequest);
    visitor.append(thisObject->m_inFlightCloseRequest);
    visitor.append(thisObject->m_storedError);
}

DEFINE_VISIT_CHILDREN(JSWritableStream);

Structure* JSWritableStream::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype,
        TypeInfo(ObjectType, StructureFlags), info());
}

bool JSWritableStream::isLocked() const
{
    return !!m_writer;
}

JSValue JSWritableStream::error(JSGlobalObject* globalObject, JSValue error)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_state != State::Writable)
        return jsUndefined();

    m_state = State::Errored;
    m_storedError.set(vm, this, error);

    if (m_writer)
        m_writer->error(globalObject, error);

    RELEASE_AND_RETURN(scope, jsUndefined());
}

namespace Operations {

void WritableStreamStartErroring(JSWritableStream* stream, JSValue reason)
{
    VM& vm = stream->vm();
    JSGlobalObject* globalObject = stream->globalObject();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Assert: stream.[[storedError]] is undefined.
    ASSERT(!stream->storedError() || stream->storedError().isUndefined());

    // 2. Assert: stream.[[state]] is "writable".
    ASSERT(stream->state() == JSWritableStream::State::Writable);

    // 3. Let controller be stream.[[writableStreamController]].
    auto* controller = stream->controller();
    ASSERT(controller);

    // 4. Set stream.[[state]] to "erroring".
    stream->setState(JSWritableStream::State::Erroring);

    // 5. Set stream.[[storedError]] to reason.
    stream->setStoredError(vm, reason);

    // 6. Let writer be stream.[[writer]].
    auto* writer = stream->writer();

    // 7. If writer is not undefined, perform ! WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason).
    if (writer)
        WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);

    // 8. If ! WritableStreamHasOperationMarkedInFlight(stream) is false and controller.[[started]] is true,
    //    perform ! WritableStreamFinishErroring(stream).
    if (!stream->hasOperationMarkedInFlight() && controller->started())
        WritableStreamFinishErroring(stream);

    RETURN_IF_EXCEPTION(scope, void());
}

void WritableStreamFinishErroring(JSWritableStream* stream)
{
    VM& vm = stream->vm();
    JSGlobalObject* globalObject = stream->globalObject();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Assert: stream.[[state]] is "erroring".
    ASSERT(stream->state() == JSWritableStream::State::Erroring);

    // 2. Assert: ! WritableStreamHasOperationMarkedInFlight(stream) is false.
    ASSERT(!stream->hasOperationMarkedInFlight());

    // 3. Set stream.[[state]] to "errored".
    stream->setState(JSWritableStream::State::Errored);

    // 4. Perform ! WritableStreamDefaultControllerErrorSteps(stream.[[writableStreamController]]).
    stream->controller()->errorSteps();

    JSValue storedError = stream->storedError();

    // 5. Let writer be stream.[[writer]].
    auto* writer = stream->writer();

    // 6. If writer is not undefined,
    if (writer) {
        // a. Let writeRequests be writer.[[writeRequests]].
        // b. Set writer.[[writeRequests]] to an empty List.
        // c. For each writeRequest of writeRequests,
        //    1. Reject writeRequest with stream.[[storedError]].
        writer->rejectWriteRequests(globalObject, storedError);
    }

    JSPromise* abortPromise = stream->pendingAbortRequestPromise();

    // 7. Let pendingAbortRequest be stream.[[pendingAbortRequest]].
    // 8. If pendingAbortRequest is undefined, return.
    if (!abortPromise)
        return;

    JSValue abortReason = stream->pendingAbortRequestReason();
    bool wasAlreadyErroring = stream->wasAlreadyErroring();
    stream->clearPendingAbortRequest();

    // 10. If pendingAbortRequest.[[wasAlreadyErroring]] is true,
    if (wasAlreadyErroring) {
        // a. Reject pendingAbortRequest.[[promise]] with pendingAbortRequest.[[reason]].
        abortPromise->reject(globalObject, abortReason);
        // b. Return.
        return;
    }

    // 11. Let abortAlgorithm be stream.[[writableStreamController]].[[abortAlgorithm]].
    // 12. Let result be the result of performing abortAlgorithm with argument pendingAbortRequest.[[reason]].
    JSValue result = stream->controller()->performAbortAlgorithm(abortReason);

    // 13. Upon fulfillment of result,
    //     a. Resolve pendingAbortRequest.[[promise]] with undefined.
    // 14. Upon rejection of result with reason r,
    //     a. Reject pendingAbortRequest.[[promise]] with r.
    if (JSPromise* resultPromise = jsDynamicCast<JSPromise*>(result)) {
        Bun::then(globalObject, resultPromise,
            jsFunctionResolveAbortPromiseWithUndefined,
            jsFunctionRejectAbortPromiseWithReason,
            abortPromise);
    } else {
        // If not a promise, treat as fulfilled
        abortPromise->resolve(globalObject, jsUndefined());
    }
}

void WritableStreamDefaultWriterEnsureReadyPromiseRejected(JSWritableStreamDefaultWriter* writer, JSValue reason)
{
    VM& vm = writer->globalObject()->vm();
    JSGlobalObject* globalObject = writer->globalObject();

    // 1. If writer.[[readyPromise]] is pending, reject it with reason.
    JSPromise* readyPromise = writer->ready();
    if (readyPromise && readyPromise->status() == JSPromise::Status::Pending)
        readyPromise->reject(globalObject, reason);

    // 2. Set writer.[[readyPromise]] to a promise rejected with reason.
    JSPromise* newPromise = JSPromise::create(vm, globalObject->promiseStructure());
    newPromise->reject(globalObject, reason);
    writer->setReady(vm, newPromise);
}

} // namespace Operations

JSValue JSWritableStream::abort(JSGlobalObject* globalObject, JSValue reason)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. If ! IsWritableStreamLocked(this) is true, return a promise rejected with a TypeError exception.
    if (isLocked())
        return JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "Cannot abort a locked WritableStream"_s));

    // 2. Let state be this.[[state]].
    const auto state = m_state;

    // 3. If state is "closed" or state is "errored", return a promise resolved with undefined.
    if (state == State::Closed || state == State::Errored)
        return JSPromise::resolvedPromise(globalObject, jsUndefined());

    // 4. If this.[[pendingAbortRequest]] is not undefined, return this.[[pendingAbortRequest]].[[promise]].
    if (auto promise = m_pendingAbortRequestPromise.get())
        return promise;

    // 5. Assert: state is "writable" or state is "erroring".
    ASSERT(state == State::Writable || state == State::Erroring);

    // 6. Let wasAlreadyErroring be false.
    bool wasAlreadyErroring = false;

    // 7. If state is "erroring",
    if (state == State::Erroring) {
        // a. Set wasAlreadyErroring to true.
        wasAlreadyErroring = true;
        // b. Set reason to undefined.
        reason = jsUndefined();
    }

    // 8. Let promise be a new promise.
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // 9. Set this.[[pendingAbortRequest]] to record {[[promise]]: promise, [[reason]]: reason, [[wasAlreadyErroring]]: wasAlreadyErroring}.
    m_pendingAbortRequestPromise.set(vm, this, promise);
    m_pendingAbortRequestReason.set(vm, this, reason);
    m_wasAlreadyErroring = wasAlreadyErroring;

    // 10. If wasAlreadyErroring is false, perform ! WritableStreamStartErroring(this, reason).
    if (!wasAlreadyErroring)
        Operations::WritableStreamStartErroring(this, reason);

    // 11. If this.[[state]] is "errored", perform ! WritableStreamFinishErroring(this).
    if (m_state == State::Errored)
        Operations::WritableStreamFinishErroring(this);

    // 12. Return promise.
    return promise;
}

JSValue JSWritableStream::close(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. If ! IsWritableStreamLocked(this) is true, return a promise rejected with a TypeError exception.
    if (isLocked())
        return JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "Cannot close a locked WritableStream"_s));

    // 2. If ! WritableStreamCloseQueuedOrInFlight(this) is true, return a promise rejected with a TypeError exception.
    if (m_closeRequest || m_inFlightCloseRequest)
        return JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "Cannot close an already closing stream"_s));

    // 3. Let state be this.[[state]].
    const auto state = m_state;

    // 4. If state is "closed", return a promise rejected with a TypeError exception.
    if (state == State::Closed)
        return JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "Cannot close an already closed stream"_s));

    // 5. If state is "errored", return a promise rejected with this.[[storedError]].
    if (state == State::Errored)
        return JSPromise::rejectedPromise(globalObject, m_storedError.get());

    // 6. If state is "erroring", return a promise rejected with this.[[storedError]].
    if (state == State::Erroring)
        return JSPromise::rejectedPromise(globalObject, m_storedError.get());

    // 7. Assert: state is "writable".
    ASSERT(state == State::Writable);

    // 8. Let closeRequest be ! WritableStreamCreateCloseRequest(this).
    JSPromise* closeRequest = JSPromise::create(vm, globalObject->promiseStructure());
    m_closeRequest.set(vm, this, closeRequest);

    // 9. Perform ! WritableStreamDefaultControllerClose(this.[[controller]]).
    m_controller->close(globalObject);

    // 10. Return closeRequest.[[promise]].
    return closeRequest;
}

void JSWritableStream::finishInFlightClose()
{
    VM& vm = m_controller->vm();
    JSGlobalObject* globalObject = m_controller->globalObject();

    // 1. Assert: this.[[inFlightCloseRequest]] is not undefined.
    ASSERT(m_inFlightCloseRequest);

    // 2. Resolve this.[[inFlightCloseRequest]] with undefined.
    m_inFlightCloseRequest->resolve(globalObject, jsUndefined());

    // 3. Set this.[[inFlightCloseRequest]] to undefined.
    m_inFlightCloseRequest.clear();

    // 4. Set this.[[state]] to "closed".
    m_state = State::Closed;

    // 5. Let writer be this.[[writer]].
    auto* writer = m_writer.get();

    // 6. If writer is not undefined,
    if (writer) {
        // a. Resolve writer.[[closedPromise]] with undefined.
        writer->resolveClosedPromise(globalObject, jsUndefined());
    }
}

void JSWritableStream::finishInFlightCloseWithError(JSValue error)
{
    VM& vm = m_controller->vm();
    JSGlobalObject* globalObject = m_controller->globalObject();

    // 1. Assert: this.[[inFlightCloseRequest]] is not undefined.
    ASSERT(m_inFlightCloseRequest);

    // 2. Reject this.[[inFlightCloseRequest]] with error.
    m_inFlightCloseRequest->reject(globalObject, error);

    // 3. Set this.[[inFlightCloseRequest]] to undefined.
    m_inFlightCloseRequest.clear();

    // 4. Set this.[[state]] to "errored".
    m_state = State::Errored;

    // 5. Set this.[[storedError]] to error.
    m_storedError.set(vm, this, error);

    // 6. Let writer be this.[[writer]].
    auto* writer = m_writer.get();

    // 7. If writer is not undefined,
    if (writer) {
        // a. Reject writer.[[closedPromise]] with error.
        writer->rejectClosedPromise(globalObject, error);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionResolveAbortPromiseWithUndefined, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSPromise* promise = jsDynamicCast<JSPromise*>(callFrame->argument(1));
    if (!promise)
        return JSValue::encode(jsUndefined());
    promise->resolve(globalObject, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRejectAbortPromiseWithReason, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSPromise* promise = jsDynamicCast<JSPromise*>(callFrame->argument(1));
    if (!promise)
        return JSValue::encode(jsUndefined());
    promise->reject(globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

}
