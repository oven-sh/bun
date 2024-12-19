
#include "root.h"

#include "JavaScriptCore/Lookup.h"
#include "BunReadableStreamBYOBReader.h"
#include "BunReadableStream.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(readableStreamBYOBReaderClosedGetter);
static JSC_DECLARE_HOST_FUNCTION(readableStreamBYOBReaderRead);
static JSC_DECLARE_HOST_FUNCTION(readableStreamBYOBReaderReleaseLock);
static JSC_DECLARE_HOST_FUNCTION(readableStreamBYOBReaderCancel);

static const HashTableValue JSReadableStreamBYOBReaderPrototypeTableValues[] = {
    { "closed"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor),
        NoIntrinsic,
        { HashTableValue::GetterSetterType, readableStreamBYOBReaderClosedGetter, nullptr } },
    { "read"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamBYOBReaderRead, 1 } },
    { "releaseLock"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamBYOBReaderReleaseLock, 0 } },
    { "cancel"_s,
        static_cast<unsigned>(JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::Function),
        NoIntrinsic,
        { HashTableValue::NativeFunctionType, readableStreamBYOBReaderCancel, 1 } },
};

class JSReadableStreamBYOBReaderPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSObject* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSReadableStreamBYOBReaderPrototype(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

const ClassInfo JSReadableStreamBYOBReaderPrototype::s_info = { "ReadableStreamBYOBReader"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamBYOBReaderPrototype) };

JSObject* JSReadableStreamBYOBReaderPrototype::create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
{
    auto* prototype = new (NotNull, allocateCell<JSReadableStreamBYOBReaderPrototype>(vm)) JSReadableStreamBYOBReaderPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

Structure* JSReadableStreamBYOBReaderPrototype::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSReadableStreamBYOBReaderPrototype::JSReadableStreamBYOBReaderPrototype(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void JSReadableStreamBYOBReaderPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), JSReadableStreamBYOBReaderPrototypeTableValues, *this);
}

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

void JSReadableStreamBYOBReader::visitChildren(JSCell* cell, SlotVisitor& visitor)
{
    JSReadableStreamBYOBReader* thisObject = jsCast<JSReadableStreamBYOBReader*>(cell);
    ASSERT(thisObject->inherits(JSReadableStreamBYOBReader::info()));
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_stream);
    visitor.append(thisObject->m_readRequests);
    visitor.append(thisObject->m_closedPromise);
    visitor.append(thisObject->m_readyPromise);
}

JSC_DEFINE_CUSTOM_GETTER(readableStreamBYOBReaderClosedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(JSValue::decode(thisValue));
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.closed called on incompatible receiver"_s);
    return JSValue::encode(reader->closedPromise());
}

JSC_DEFINE_HOST_FUNCTION(readableStreamBYOBReaderRead, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read called on incompatible receiver"_s);

    // 2. Check if stream is undefined (released)
    if (!reader->stream())
        return throwVMTypeError(globalObject, scope, "Cannot read from a released reader"_s);

    // 3. Validate view argument
    if (!callFrame->argumentCount())
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires at least one argument"_s);

    JSValue viewValue = callFrame->argument(0);
    if (!viewValue.isObject())
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires an ArrayBufferView argument"_s);

    JSObject* viewObject = jsCast<JSObject*>(viewValue);
    if (!viewObject->inherits<JSArrayBufferView>())
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.read requires an ArrayBufferView argument"_s);

    // 4. Get the ArrayBufferView
    JSArrayBufferView* view = jsCast<JSArrayBufferView*>(viewObject);

    // 5. Check if view's buffer is detached
    if (view->isDetached())
        return throwVMTypeError(globalObject, scope, "Cannot read into a detached ArrayBuffer"_s);

    // 6. Check view's byte length
    if (view->byteLength() == 0)
        return throwVMTypeError(globalObject, scope, "Cannot read into a zero-length view"_s);

    // 7. Get read options
    uint64_t minRequested = 1;
    if (callFrame->argumentCount() > 1) {
        JSValue options = callFrame->argument(1);
        if (!options.isUndefined()) {
            if (!options.isObject())
                return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader read options must be an object"_s);

            JSObject* optionsObj = jsCast<JSObject*>(options);
            JSValue minValue = optionsObj->get(globalObject, Identifier::fromString(vm, "min"_s));
            RETURN_IF_EXCEPTION(scope, encodedJSValue());

            if (!minValue.isUndefined()) {
                minRequested = minValue.toNumber(globalObject);
                RETURN_IF_EXCEPTION(scope, encodedJSValue());

                if (minRequested == 0)
                    return throwVMTypeError(globalObject, scope, "min option must be greater than 0"_s);

                if (minRequested > view->byteLength())
                    return throwVMRangeError(globalObject, scope, "min option cannot be greater than view's byte length"_s);
            }
        }
    }

    // 8. Create a new promise for the read result
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // 9. Create a read-into request
    JSObject* readIntoRequest = constructEmptyObject(globalObject);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "promise"_s), promise);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "view"_s), view);
    readIntoRequest->putDirect(vm, Identifier::fromString(vm, "min"_s), jsNumber(minRequested));

    // 10. Add to read requests queue
    JSArray* readRequests = reader->readRequests();
    readRequests->push(globalObject, readIntoRequest);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    // 11. Return the promise
    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(readableStreamBYOBReaderReleaseLock, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.releaseLock called on incompatible receiver"_s);

    // 2. Check if already released
    if (!reader->stream())
        return JSValue::encode(jsUndefined());

    // 3. If there are pending read requests, reject them
    JSArray* readRequests = reader->readRequests();
    if (readRequests->length() > 0) {
        JSValue typeError = createTypeError(globalObject, "Reader was released while it still had pending read requests"_s);
        for (unsigned i = 0; i < readRequests->length(); ++i) {
            JSObject* request = jsCast<JSObject*>(readRequests->get(globalObject, i));
            JSPromise* promise = jsCast<JSPromise*>(request->get(globalObject, Identifier::fromString(vm, "promise"_s)));
            promise->reject(globalObject, typeError);
        }
    }

    // 4. Clear the read requests
    reader->setReadRequests(vm, constructEmptyArray(globalObject, nullptr));

    // 5. Clear the stream reference
    reader->clearStream();

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(readableStreamBYOBReaderCancel, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // 1. Validate the reader
    auto* reader = jsDynamicCast<JSReadableStreamBYOBReader*>(callFrame->thisValue());
    if (!reader)
        return throwVMTypeError(globalObject, scope, "ReadableStreamBYOBReader.prototype.cancel called on incompatible receiver"_s);

    // 2. Check if stream is undefined (released)
    JSReadableStream* stream = reader->stream();
    if (!stream)
        return throwVMTypeError(globalObject, scope, "Cannot cancel a released reader"_s);

    // 3. Get cancel reason
    JSValue reason = callFrame->argument(0);

    // 4. Cancel the stream with the given reason
    JSPromise* promise = stream->cancel(vm, globalObject, reason);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    return JSValue::encode(promise);
}

} // namespace Bun
