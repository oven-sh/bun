#include "root.h"

#include "BunTeeState.h"
#include "JSTextEncoderStream.h"
#include "BunStreamInlines.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

const ClassInfo TeeState::s_info = { "TeeState"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(TeeState) };

TeeState::TeeState(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void TeeState::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSC::JSPromise* TeeState::cancel(VM& vm, JSGlobalObject* globalObject, Bun::JSReadableStream* canceledBranch, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_closedOrErrored)
        return JSPromise::resolvedPromise(globalObject, jsUndefined());

    if (canceledBranch == m_branch1.get()) {
        m_canceled1 = true;
        m_reason1.set(vm, this, reason);
    } else {
        m_canceled2 = true;
        m_reason2.set(vm, this, reason);
    }

    // Create the cancelPromise if it doesn't exist
    if (!m_cancelPromise) {
        m_cancelPromise.set(vm, this, JSPromise::create(vm, globalObject->promiseStructure()));
    }

    if (!m_canceled1 || !m_canceled2)
        return m_cancelPromise.get();

    // Both branches are now canceled - composite the reasons
    auto* reasons = JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 2);
    reasons->putDirectIndex(globalObject, 0, m_reason1.get());
    reasons->putDirectIndex(globalObject, 1, m_reason2.get());

    JSC::JSPromise* result = m_reader->cancel(vm, globalObject, reasons);
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSValue resolve = m_cancelPromiseResolve.get();
    JSValue reject = m_cancelPromiseReject.get();
    m_cancelPromiseResolve.clear();
    m_cancelPromiseReject.clear();

    Bun::then(globalObject, result, resolve, reject);

    return m_cancelPromise.get();
}

void TeeState::perform(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    // Start pulling from the original stream
    pullAlgorithm(vm, globalObject);
}

Structure* TeeState::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(vm, globalObject, jsNull(), TypeInfo(CellType, StructureFlags), info());
}

Structure* TeeState::structure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->teeStateStructure();
}

TeeState* TeeState::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, Bun::JSReadableStreamDefaultReader* reader, Bun::JSReadableStream* branch1, Bun::JSReadableStream* branch2)
{
    auto* structure = TeeState::structure(vm, globalObject);
    auto* teeState = new (NotNull, allocateCell<TeeState>(vm)) TeeState(vm, structure);
    teeState->finishCreation(vm);
    teeState->finishCreation(vm, reader, branch1, branch2);
    return teeState;
}

void TeeState::finishCreation(JSC::VM& vm, Bun::JSReadableStreamDefaultReader* reader, Bun::JSReadableStream* branch1, Bun::JSReadableStream* branch2)
{
    m_reader.set(vm, this, reader);
    m_branch1.set(vm, this, branch1);
    m_branch2.set(vm, this, branch2);
}

void TeeState::pullAlgorithmReject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue error)
{
    m_closedOrErrored = true;
    if (!m_canceled1)
        m_branch1->controller()->error(vm, globalObject, error);
    if (!m_canceled2)
        m_branch2->controller()->error(vm, globalObject, error);
}

void TeeState::pullAlgorithmFulfill(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue result)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* resultObj = result.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    bool done = resultObj->get(globalObject, vm.propertyNames->done).toBoolean(globalObject);
    JSValue value = resultObj->get(globalObject, vm.propertyNames->value);

    if (done) {
        if (!m_canceled1)
            m_branch1->controller()->close(vm, globalObject);
        if (!m_canceled2)
            m_branch2->controller()->close(vm, globalObject);
        m_closedOrErrored = true;
    } else {
        // Enqueue the chunk to both branches
        JSValue chunk1 = value;
        JSValue chunk2 = value;

        // If the chunks are not immutable, clone chunk2
        // TODO: Implement this
        // if (auto *arrayBuffer = jsDynamicCast<JSC::JSArrayBuffer*>(value)) {
        //     structured
        //     RETURN_IF_EXCEPTION(scope, void());
        // }

        if (!m_canceled1)
            m_branch1->controller()->enqueue(vm, globalObject, chunk1);
        if (!m_canceled2)
            m_branch2->controller()->enqueue(vm, globalObject, chunk2);

        m_pullInProgress = false;
        pullAlgorithm(vm, globalObject);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsTeeStatePullAlgorithmFulfill, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    TeeState* teeState = jsDynamicCast<TeeState*>(callFrame->argument(1));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (UNLIKELY(!teeState))
        return throwVMTypeError(globalObject, scope, "TeeState.pullAlgorithmFulfill called on incompatible object"_s);

    teeState->pullAlgorithmFulfill(globalObject->vm(), globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTeeStatePullAlgorithmReject, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    TeeState* teeState = jsDynamicCast<TeeState*>(callFrame->argument(1));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (UNLIKELY(!teeState))
        return throwVMTypeError(globalObject, scope, "TeeState.pullAlgorithmReject called on incompatible object"_s);

    teeState->pullAlgorithmReject(globalObject->vm(), globalObject, callFrame->argument(0));
    return JSValue::encode(jsUndefined());
}

void TeeState::pullAlgorithm(VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (m_pullInProgress || m_closedOrErrored)
        return;

    m_pullInProgress = true;

    JSValue readResult = m_reader->read(vm, globalObject);
    RETURN_IF_EXCEPTION(scope, void());

    if (JSPromise* promise = jsDynamicCast<JSPromise*>(readResult)) {
        Bun::then(globalObject, promise, jsTeeStatePullAlgorithmFulfill, jsTeeStatePullAlgorithmReject, this);
    }
}

} // namespace Bun
