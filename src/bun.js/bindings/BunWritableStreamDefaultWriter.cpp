
#include "root.h"

#include "JavaScriptCore/JSCJSValue.h"
#include <JavaScriptCore/Lookup.h>
#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStream.h"
#include "JSDOMWrapper.h"
#include "ErrorCode.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include "BunPromiseInlines.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/VMTrapsInlines.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSWritableStreamDefaultWriter::s_info = {
    "WritableStreamDefaultWriter"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriter)
};

JSWritableStreamDefaultWriter::JSWritableStreamDefaultWriter(VM& vm, Structure* structure, JSWritableStream* stream)
    : Base(vm, structure)
{
}

JSC::GCClient::IsoSubspace* JSWritableStreamDefaultWriter::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSWritableStreamDefaultWriter, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWritableStreamDefaultWriter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWritableStreamDefaultWriter = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWritableStreamDefaultWriter.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWritableStreamDefaultWriter = std::forward<decltype(space)>(space); });
}

JSC::Structure* JSWritableStreamDefaultWriter::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype,
        JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSWritableStreamDefaultWriter* JSWritableStreamDefaultWriter::create(VM& vm, Structure* structure, JSWritableStream* stream)
{
    JSWritableStreamDefaultWriter* writer = new (
        NotNull,
        allocateCell<JSWritableStreamDefaultWriter>(vm)) JSWritableStreamDefaultWriter(vm, structure, stream);

    writer->finishCreation(vm);
    return writer;
}

static constexpr auto initPendingPromise = [](const JSC::LazyProperty<JSC::JSObject, JSC::JSPromise>::Initializer& init) {
    auto* globalObject = init.owner->globalObject();
    init.set(JSPromise::create(init.vm, globalObject->promiseStructure()));
};

static constexpr auto initResolvedPromise
    = [](const JSC::LazyProperty<JSC::JSObject, JSC::JSPromise>::Initializer& init) {
          auto* globalObject = init.owner->globalObject();
          init.set(Bun::createFulfilledPromise(globalObject, jsUndefined()));
      };

static constexpr auto initEmptyArray = [](const JSC::LazyProperty<JSC::JSObject, JSC::JSArray>::Initializer& init) {
    auto* globalObject = init.owner->globalObject();
    init.set(JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 0));
};

void JSWritableStreamDefaultWriter::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_closedPromise.initLater(initPendingPromise);
    m_readyPromise.initLater(initPendingPromise);
    m_writeRequests.initLater(initEmptyArray);
}

void JSWritableStreamDefaultWriter::error(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue reason)
{
    if (auto* stream = this->stream()) {
        stream->error(vm, globalObject, reason);
    }
}

void JSWritableStreamDefaultWriter::setReady(JSC::VM& vm, JSC::JSPromise* promise)
{
    m_readyPromise.set(vm, this, promise);
}

void JSWritableStreamDefaultWriter::resetReadyPromise()
{
    if (m_readyPromise.isInitialized()) {
        m_readyPromise.setMayBeNull(vm(), this, nullptr);
    }

    m_readyPromise.initLater(initPendingPromise);
}

void JSWritableStreamDefaultWriter::resolveReadyPromise()
{
    if (m_readyPromise.isInitialized()) {
        m_readyPromise.get(this)->fulfillWithNonPromise(globalObject(), jsUndefined());
    } else {
        m_readyPromise.initLater(initResolvedPromise);
    }
}

void JSWritableStreamDefaultWriter::resetClosedPromise()
{
    if (m_closedPromise.isInitialized()) {
        m_closedPromise.setMayBeNull(vm(), this, nullptr);
    }

    m_closedPromise.initLater(initPendingPromise);
}

void JSWritableStreamDefaultWriter::setClosed(JSC::VM& vm, JSC::JSPromise* promise)
{
    m_closedPromise.set(vm, this, promise);
}

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* writer = jsCast<JSWritableStreamDefaultWriter*>(cell);
    ASSERT_GC_OBJECT_INHERITS(writer, info());

    Base::visitChildren(writer, visitor);
    visitor.append(writer->m_stream);
    writer->m_closedPromise.visit(visitor);
    writer->m_readyPromise.visit(visitor);
    writer->m_writeRequests.visit(visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultWriter);

double JSWritableStreamDefaultWriter::desiredSize()
{
    auto* stream = this->stream();
    if (!stream) {
        return 0;
    }
    auto* controller = stream->controller();
    if (!controller) {
        return 0;
    }
    return controller->getDesiredSize();
}

// Non-JS Methods for C++ Use

#define CHECK_STREAM()                                                                                                                     \
    if (!m_stream) {                                                                                                                       \
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_STATE, "WritableStreamDefaultWriter has no associated stream"_s); \
        return;                                                                                                                            \
    }

void JSWritableStreamDefaultWriter::write(JSGlobalObject* globalObject, JSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    CHECK_STREAM();

    m_stream->controller()->write(globalObject, chunk);
}

void JSWritableStreamDefaultWriter::rejectWriteRequests(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSValue error)
{
    // a. Let writeRequests be writer.[[writeRequests]].
    // b. Set writer.[[writeRequests]] to an empty List.
    // c. For each writeRequest of writeRequests,
    //    1. Reject writeRequest with stream.[[storedError]].
    if (m_writeRequests.isInitialized()) {
        auto* writeRequests = m_writeRequests.get(this);
        JSC::EnsureStillAliveScope ensureStillAlive(writeRequests);
        m_writeRequests.setMayBeNull(vm, this, nullptr);
        m_writeRequests.initLater(initEmptyArray);

        JSC::forEachInIterable(globalObject, writeRequests, [error](JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue writeRequest) {
            jsCast<JSPromise*>(writeRequest)->reject(globalObject, error);
        });
    }
}

void JSWritableStreamDefaultWriter::close(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    CHECK_STREAM();

    m_stream->close(globalObject);
}

void JSWritableStreamDefaultWriter::abort(JSGlobalObject* globalObject, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    CHECK_STREAM();

    m_stream->abort(globalObject, reason);
}

void JSWritableStreamDefaultWriter::release()
{
    m_stream.clear();
    if (m_closedPromise.isInitialized())
        m_closedPromise.get(this)->rejectAsHandled(globalObject(), jsUndefined());
    if (m_readyPromise.isInitialized())
        m_readyPromise.get(this)->rejectAsHandled(globalObject(), jsUndefined());
}

void JSWritableStreamDefaultWriter::resolveClosedPromise(JSGlobalObject* globalObject, JSValue value)
{
    if (m_closedPromise.isInitialized())
        m_closedPromise.get(this)->resolve(globalObject, value);
}

void JSWritableStreamDefaultWriter::rejectClosedPromise(JSGlobalObject* globalObject, JSValue error)
{
    if (m_closedPromise.isInitialized())
        m_closedPromise.get(this)->rejectAsHandled(globalObject, error);
}

} // namespace Bun
