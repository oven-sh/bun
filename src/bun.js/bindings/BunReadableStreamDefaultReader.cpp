#include "BunReadableStreamDefaultReader.h"
#include "BunReadableStream.h"
#include "BunReadableStreamDefaultController.h"
#include "BunStreamInlines.h"
#include "BunTeeState.h"
#include "JSAbortSignal.h"
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamDefaultReader::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReader) };

JSReadableStreamDefaultReader* JSReadableStreamDefaultReader::create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultReader* reader = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReader>(vm)) JSReadableStreamDefaultReader(vm, structure);
    reader->finishCreation(vm);
    reader->m_stream.set(vm, reader, stream);
    reader->m_readRequests.set(vm, reader, JSC::constructEmptyArray(globalObject, nullptr));
    reader->m_closedPromise.set(vm, reader, JSC::JSPromise::create(vm, globalObject->promiseStructure()));
    reader->m_readyPromise.set(vm, reader, JSC::JSPromise::create(vm, globalObject->promiseStructure()));
    return reader;
}

template<typename Visitor>
void JSReadableStreamDefaultReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* reader = jsCast<JSReadableStreamDefaultReader*>(cell);
    ASSERT_GC_OBJECT_INHERITS(reader, JSReadableStreamDefaultReader::info());
    Base::visitChildren(reader, visitor);
    visitor.append(reader->m_stream);
    visitor.append(reader->m_readyPromise);
    visitor.append(reader->m_closedPromise);
    visitor.append(reader->m_readRequests);
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultReader);

void JSReadableStreamDefaultReader::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void JSReadableStreamDefaultReader::detach()
{
    ASSERT(isActive());
    m_stream.clear();
    m_readyPromise.clear();
    m_readRequests.clear();
}

void JSReadableStreamDefaultReader::releaseLock()
{
    if (!isActive())
        return;

    // Release the stream's reader reference
    m_stream->setReader(nullptr);
    detach();
}

JSPromise* JSReadableStreamDefaultReader::read(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!this->isActive()) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on released reader"_s));
        return nullptr;
    }

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // Add read request to the queue
    JSArray* readRequests = m_readRequests.get();
    readRequests->push(globalObject, promise);

    // Attempt to fulfill read request immediately if possible
    stream()->controller()->callPullIfNeeded(globalObject);

    return promise;
}

Structure* JSReadableStreamDefaultReader::structure(JSC::VM& vm, JSGlobalObject* globalObject)
{
    return globalObject->readableStreamDefaultReaderStructure();
}

JSObject* JSReadableStreamDefaultReader::prototype(JSC::VM& vm, JSGlobalObject* globalObject)
{
    return globalObject->readableStreamDefaultReaderPrototype();
}

JSObject* JSReadableStreamDefaultReader::constructor(JSC::VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return globalObject->readableStreamDefaultReaderConstructor();
}

template<typename CellType, SubspaceAccess mode>
GCClient::IsoSubspace* JSReadableStreamDefaultReader::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return &vm.plainObjectSpace();
}

} // namespace Bun
