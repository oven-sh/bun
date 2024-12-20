#include "root.h"

#include <JavaScriptCore/Lookup.h>
#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStream.h"
#include "JSDOMWrapper.h"

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
    visitor.append(m_closedPromise);
    visitor.append(m_readyPromise);
    visitor.append(m_writeRequests);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSWritableStreamDefaultWriter);

// Non-JS Methods for C++ Use

bool JSWritableStreamDefaultWriter::write(JSGlobalObject* globalObject, JSValue chunk, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->controller()->write(globalObject, chunk, error);
}

bool JSWritableStreamDefaultWriter::close(JSGlobalObject* globalObject, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->close(globalObject, error);
}

bool JSWritableStreamDefaultWriter::abort(JSGlobalObject* globalObject, JSValue reason, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->abort(globalObject, reason, error);
}

void JSWritableStreamDefaultWriter::release()
{
    m_stream.clear();
    m_closedPromise->reject(vm(), jsUndefined());
    m_readyPromise->reject(vm(), jsUndefined());
}

void JSWritableStreamDefaultWriter::resolveClosedPromise(JSGlobalObject* globalObject, JSValue value)
{
    if (m_closedPromise)
        m_closedPromise->resolve(globalObject, value);
}

void JSWritableStreamDefaultWriter::rejectClosedPromise(JSGlobalObject* globalObject, JSValue error)
{
    if (m_closedPromise)
        m_closedPromise->reject(globalObject, error);
}

} // namespace Bun
