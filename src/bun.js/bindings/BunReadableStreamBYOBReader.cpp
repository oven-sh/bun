#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ObjectConstructor.h>

#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStream.h"
#include "BunReadableStreamDefaultController.h"
#include "BunReadableStreamDefaultReader.h"
#include "BunStreamInlines.h"

namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamBYOBReader::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReader) };

JSReadableStreamBYOBReader::JSReadableStreamBYOBReader(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamBYOBReader::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSReadableStreamBYOBReader* JSReadableStreamBYOBReader::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSReadableStream* stream)
{
    JSReadableStreamBYOBReader* reader = new (NotNull, allocateCell<JSReadableStreamBYOBReader>(vm)) JSReadableStreamBYOBReader(vm, structure);
    reader->finishCreation(vm);
    reader->setStream(vm, stream);
    reader->setReadRequests(vm, constructEmptyArray(globalObject, nullptr));
    reader->setClosedPromise(vm, JSPromise::create(vm, globalObject->promiseStructure()));
    reader->setReadyPromise(vm, JSPromise::create(vm, globalObject->promiseStructure()));
    return reader;
}

template<typename Visitor>
void JSReadableStreamBYOBReader::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSReadableStreamBYOBReader* thisObject = jsCast<JSReadableStreamBYOBReader*>(cell);
    ASSERT(thisObject->inherits(JSReadableStreamBYOBReader::info()));
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_stream);
    visitor.append(thisObject->m_readRequests);
    visitor.append(thisObject->m_closedPromise);
    visitor.append(thisObject->m_readyPromise);
}

DEFINE_VISIT_CHILDREN(JSReadableStreamBYOBReader);

JSValue JSReadableStreamBYOBReader::read(VM& vm, JSGlobalObject* globalObject, JSArrayBufferView* view, uint64_t minRequested)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 5. Check if view's buffer is detached
    if (view->isDetached()) {
        throwVMTypeError(globalObject, scope, "Cannot read into a detached ArrayBuffer"_s);
        return {};
    }

    // 6. Check view's byte length
    if (view->byteLength() == 0) {
        throwVMTypeError(globalObject, scope, "Cannot read into a zero-length view"_s);
        return {};
    }

    // 8. Create a new promise for the read result
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // 9. Create a read-into request
    JSObject* readIntoRequest = constructEmptyObject(globalObject);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "promise"_s), promise);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "view"_s), view);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "min"_s), jsNumber(minRequested));

    // 10. Add to read requests queue
    JSArray* readRequests = this->readRequests();
    readRequests->push(globalObject, readIntoRequest);
    RETURN_IF_EXCEPTION(scope, {});

    // 11. Return the promise
    return promise;
}

void JSReadableStreamBYOBReader::releaseLock(VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!stream())
        return;

    auto* readRequests = this->readRequests();
    if (readRequests->length() > 0) {
        for (unsigned i = 0; i < readRequests->length(); ++i) {
            auto* request = jsCast<JSObject*>(readRequests->get(globalObject, i));
            auto* promise = jsCast<JSPromise*>(request->get(globalObject, Identifier::fromString(vm, "promise"_s)));
            promise->reject(globalObject, createTypeError(globalObject, "Reader was released"_s));
        }
    }

    if (stream()) {
        stream()->setReader(vm, nullptr);
        clearStream();
    }
    closedPromise()->reject(globalObject, createTypeError(globalObject, "Reader was released"_s));
}

JSValue JSReadableStreamBYOBReader::cancel(VM& vm, JSGlobalObject* globalObject, JSValue reason)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!stream())
        return throwTypeError(globalObject, scope, "Cannot cancel a released reader"_s);

    return stream()->cancel(vm, globalObject, reason);
}

JSC::GCClient::IsoSubspace* JSReadableStreamBYOBReader::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSReadableStreamBYOBReader, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForReadableStreamBYOBReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForReadableStreamBYOBReader = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForReadableStreamBYOBReader.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForReadableStreamBYOBReader = std::forward<decltype(space)>(space); });
}

} // namespace Bun
