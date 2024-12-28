#include "root.h"

#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSGlobalObject.h"

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
#include <JavaScriptCore/VMTrapsInlines.h>

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

    reader->visitAdditionalChildren(visitor);
}

template<typename Visitor>
void JSReadableStreamDefaultReader::visitAdditionalChildren(Visitor& visitor)
{
    m_readyPromise.visit(visitor);
    m_closedPromise.visit(visitor);
    visitor.append(m_stream);

    {
        WTF::Locker lock(cellLock());
        for (auto request : m_readRequests) {
            if (request.isCell())
                visitor.appendUnbarriered(request);
        }
    }
}

DEFINE_VISIT_CHILDREN(JSReadableStreamDefaultReader);

template<typename Visitor>
void JSReadableStreamDefaultReader::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<JSReadableStreamDefaultReader*>(cell);
    Base::visitOutputConstraints(cell, visitor);

    thisObject->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSReadableStreamDefaultReader);
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSReadableStreamDefaultReader);

void JSReadableStreamDefaultReader::finishCreation(JSC::VM& vm, JSReadableStream* stream)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_stream.setMayBeNull(vm, this, stream);

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

JSPromise* JSReadableStreamDefaultReader::takeFirst(JSC::VM& vm, JSGlobalObject* globalObject)
{
    if (m_readRequests.isEmpty()) {
        return nullptr;
    }
    JSValue first;
    {
        WTF::Locker lock(cellLock());
        first = m_readRequests.takeFirst();
    }
    return jsCast<JSPromise*>(first);
}

void JSReadableStreamDefaultReader::detach()
{
    ASSERT(isActive());
    m_stream.clear();
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

void JSReadableStreamDefaultReader::addReadRequest(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue promise)
{
    WTF::Locker lock(cellLock());
    m_readRequests.append(promise);
}

JSPromise* JSReadableStreamDefaultReader::read(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!this->isActive()) {
        scope.throwException(globalObject, createTypeError(globalObject, "ReadableStreamDefaultReader.prototype.read called on released reader"_s));
        return nullptr;
    }

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    EnsureStillAliveScope ensureStillAlive(promise);

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
