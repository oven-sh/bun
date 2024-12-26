#include "root.h"

#include <JavaScriptCore/LazyPropertyInlines.h>
#include "BunReadableStreamDefaultReader.h"
#include "BunClientData.h"
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
    reader->m_readRequests.initLater(
        [](const auto& init) {
            auto* globalObject = init.owner->globalObject();
            init.set(JSC::constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 0));
        });
    reader->m_closedPromise.initLater(
        [](const auto& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();
            init.set(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        });
    reader->m_readyPromise.initLater(
        [](const auto& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();
            init.set(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        });
    return reader;
}

template<typename Visitor>
void JSReadableStreamDefaultReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* reader = static_cast<JSReadableStreamDefaultReader*>(cell);
    ASSERT_GC_OBJECT_INHERITS(reader, JSReadableStreamDefaultReader::info());
    Base::visitChildren(reader, visitor);
    visitor.append(reader->m_stream);
    reader->m_readyPromise.visit(visitor);
    reader->m_closedPromise.visit(visitor);
    reader->m_readRequests.visit(visitor);
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
    if (m_readyPromise.isInitialized())
        m_readyPromise.setMayBeNull(vm(), this, nullptr);
    if (m_readRequests.isInitialized())
        m_readRequests.setMayBeNull(vm(), this, nullptr);
    if (m_closedPromise.isInitialized())
        m_closedPromise.setMayBeNull(vm(), this, nullptr);
}

void JSReadableStreamDefaultReader::releaseLock()
{
    if (!isActive())
        return;

    // Release the stream's reader reference
    stream()->setReader(nullptr);
    detach();
}

JSPromise* JSReadableStreamDefaultReader::cancel(JSC::VM& vm, JSGlobalObject* globalObject, JSValue reason)
{
    auto* stream = this->stream();
    if (!stream) {
        return JSPromise::rejectedPromise(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.cancel called on reader with no ReadableStream"_s));
    }

    return stream->cancel(vm, globalObject, reason);
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
    JSArray* readRequests = m_readRequests.get(this);
    readRequests->push(globalObject, promise);

    // Attempt to fulfill read request immediately if possible
    stream()->controller()->callPullIfNeeded(globalObject);

    return promise;
}

JSReadableStream* JSReadableStreamDefaultReader::stream() const
{
    return jsCast<JSReadableStream*>(m_stream.get());
}

GCClient::IsoSubspace* JSReadableStreamDefaultReader::subspaceForImpl(JSC::VM& vm)
{

    return WebCore::subspaceForImpl<JSReadableStreamDefaultReader, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSReadableStreamDefaultReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSReadableStreamDefaultReader = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSReadableStreamDefaultReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSReadableStreamDefaultReader = std::forward<decltype(space)>(space); });
}

} // namespace Bun
