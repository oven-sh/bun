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
#include <JavaScriptCore/WriteBarrierInlines.h>
namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamDefaultReader::s_info = { "ReadableStreamDefaultReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamDefaultReader) };

JSReadableStreamDefaultReader* JSReadableStreamDefaultReader::create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamDefaultReader* reader = new (NotNull, JSC::allocateCell<JSReadableStreamDefaultReader>(vm)) JSReadableStreamDefaultReader(vm, structure);
    reader->finishCreation(vm, stream);

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
    {
        WTF::Locker lock(reader->m_gcLock);
        for (auto request : reader->m_readRequests) {
            visitor.appendUnbarriered(request);
        }
    }
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultReader);

void JSReadableStreamDefaultReader::finishCreation(JSC::VM& vm, JSReadableStream* stream)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_stream.set(vm, this, stream);

    m_closedPromise.initLater(
        [](const auto& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();
            init.set(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        });
    m_readyPromise.initLater(
        [](const auto& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();
            init.set(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
        });
}

JSPromise* JSReadableStreamDefaultReader::takeFirst(JSC::VM& vm)
{
    JSPromise* promise;
    {
        WTF::Locker lock(m_gcLock);
        promise = jsCast<JSPromise*>(m_readRequests.takeFirst());
    }
    vm.writeBarrier(this);
    return promise;
}

void JSReadableStreamDefaultReader::detach()
{
    ASSERT(isActive());
    m_stream.clear();
    if (m_readyPromise.isInitialized()) {
        m_readyPromise.setMayBeNull(vm(), this, nullptr);
    }
    {
        WTF::Locker lock(m_gcLock);
        m_readRequests.clear();
    }
    if (m_closedPromise.isInitialized()) {
        m_closedPromise.setMayBeNull(vm(), this, nullptr);
    }
}

void JSReadableStreamDefaultReader::releaseLock()
{
    if (!isActive())
        return;

    // Release the stream's reader reference
    stream()->setReader(vm(), nullptr);
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

void JSReadableStreamDefaultReader::addReadRequest(JSC::VM& vm, JSC::JSValue promise)
{
    {
        WTF::Locker lock(m_gcLock);
        m_readRequests.append(promise);
    }
    vm.writeBarrier(this, promise);
}

JSPromise* JSReadableStreamDefaultReader::read(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!this->isActive()) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on released reader"_s));
        return nullptr;
    }

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    stream()->controller()->performPullSteps(vm, globalObject, promise);

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
