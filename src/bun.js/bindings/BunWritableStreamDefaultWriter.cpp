#include "root.h"

#include <JavaScriptCore/Lookup.h>
#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStream.h"
#include "JSDOMWrapper.h"
#include "ErrorCode.h"
#include <JavaScriptCore/LazyPropertyInlines.h>

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

JSWritableStreamDefaultWriter* JSWritableStreamDefaultWriter::create(VM& vm, Structure* structure, JSWritableStream* stream)
{
    JSWritableStreamDefaultWriter* writer = new (
        NotNull,
        allocateCell<JSWritableStreamDefaultWriter>(vm)) JSWritableStreamDefaultWriter(vm, structure, stream);

    writer->finishCreation(vm);
    return writer;
}

void JSWritableStreamDefaultWriter::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_closedPromise.initLater([](const auto& init) {
        auto* globalObject = init.owner.globalObject();
        init.set(init.vm, init.owner, JSPromise::create(init.vm, globalObject->promiseStructure()));
    });

    m_readyPromise.initLater([](const auto& init) {
        auto* globalObject = init.owner.globalObject();
        init.set(init.vm, init.owner, JSPromise::create(init.vm, globalObject->promiseStructure()));
    });

    m_writeRequests.initLater([](const auto& init) {
        init.set(init.vm, init.owner, JSC::constructEmptyArray(init.owner->globalObject(), static_cast<ArrayAllocationProfile*>(nullptr), 0));
    });
}

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* writer = jsCast<JSWritableStreamDefaultWriter*>(cell);
    ASSERT_GC_OBJECT_INHERITS(writer, info());

    Base::visitChildren(writer, visitor);
    writer->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultWriter);

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_stream);
    this->m_closedPromise.visit(visitor);
    this->m_readyPromise.visit(visitor);
    this->m_writeRequests.visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSWritableStreamDefaultWriter);

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
