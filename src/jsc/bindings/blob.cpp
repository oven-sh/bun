#include "blob.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArrayInlines.h>

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

// An Array whose iteration no script can observe: reading it by index is the
// same conversion as running the iterator protocol on it.
static JSC::JSArray* unobservablyIterableArray(JSC::JSValue value)
{
    if (!JSC::isJSArray(value))
        return nullptr;
    auto* array = uncheckedDowncast<JSC::JSArray>(value.asCell());
    return array->isIteratorProtocolFastAndNonObservable() ? array : nullptr;
}

extern "C" bool Blob__plainPartsArray(JSC::EncodedJSValue encodedParts, const JSC::EncodedJSValue** elements, uint32_t* length)
{
    auto* array = unobservablyIterableArray(JSC::JSValue::decode(encodedParts));
    if (!array)
        return false;

    // Int32 and Contiguous butterflies hold boxed values. A hole is an empty
    // value, which the caller has to read through the prototype chain.
    JSC::IndexingType indexing = array->indexingType();
    if (hasInt32(indexing) || hasContiguous(indexing)) {
        JSC::Butterfly* butterfly = array->butterfly();
        *length = butterfly->publicLength();
        *elements = reinterpret_cast<const JSC::EncodedJSValue*>(butterfly->contiguous().data());
        return true;
    }

    *length = 0;
    return !array->length();
}

// https://webidl.spec.whatwg.org/#create-sequence-from-iterable, with the
// conversion of each value done by `onPart`. A value that fails to convert ends
// the walk, and the spec does not close the iterator for it.
extern "C" bool Blob__forEachPart(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedParts, void* ctx, bool (*onPart)(void* ctx, JSC::JSGlobalObject*, JSC::EncodedJSValue part))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* parts = JSC::JSValue::decode(encodedParts).getObject();
    if (!parts)
        return false;

    if (auto* array = unobservablyIterableArray(parts)) {
        // What an Array Iterator does on each step: read `length`, then the element.
        for (unsigned index = 0; index < array->length(); ++index) {
            JSC::JSValue part = array->getIndex(globalObject, index);
            RETURN_IF_EXCEPTION(scope, true);
            bool wantsMore = onPart(ctx, globalObject, JSC::JSValue::encode(part));
            RETURN_IF_EXCEPTION(scope, true);
            if (!wantsMore)
                return true;
        }
        return true;
    }

    JSC::JSValue method = JSC::iteratorMethod(globalObject, parts);
    RETURN_IF_EXCEPTION(scope, true);
    if (method.isUndefined())
        return false;
    JSC::IterationRecord iteration = JSC::iteratorForIterable(globalObject, parts, method);
    RETURN_IF_EXCEPTION(scope, true);
    while (true) {
        JSC::JSValue step = JSC::iteratorStep(globalObject, iteration);
        RETURN_IF_EXCEPTION(scope, true);
        if (step.isFalse())
            return true;
        JSC::JSValue part = JSC::iteratorValue(globalObject, step);
        RETURN_IF_EXCEPTION(scope, true);
        bool wantsMore = onPart(ctx, globalObject, JSC::JSValue::encode(part));
        RETURN_IF_EXCEPTION(scope, true);
        if (!wantsMore)
            return true;
    }
}

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    BunString filename = Bun::toString(fileNameStr);

    JSC::EncodedJSValue encoded = Blob__create(lexicalGlobalObject, impl->impl());
    JSBlob* blob = uncheckedDowncast<JSBlob>(JSC::JSValue::decode(encoded));
    Blob__setAsFile(blob->wrapped(), &filename);

    return JSC::JSValue::decode(encoded);
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::memoryCost(impl());
}

}
