#include "config.h"
#include "JSWasmStreamingCompiler.h"

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"
#include "JSDOMPrototype.h"

#include "ErrorCode.h"

#if ENABLE(WEBASSEMBLY)

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_addBytes);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_finalize);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_fail);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_cancel);

using JSWasmStreamingCompilerPrototype = JSDOMPrototype<JSWasmStreamingCompiler>;

static const HashTableValue JSWasmStreamingCompilerPrototypeTableValues[] = {
    { "addBytes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_addBytes, 1 } },
    { "finalize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_finalize, 0 } },
    { "fail"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_fail, 1 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_cancel, 0 } }
};

template<> const ClassInfo JSWasmStreamingCompilerPrototype::s_info = { "WasmStreamingCompiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWasmStreamingCompilerPrototype) };

template<> void JSWasmStreamingCompilerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSWasmStreamingCompiler::info(), JSWasmStreamingCompilerPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

const ClassInfo JSWasmStreamingCompiler::s_info = { "WasmStreamingCompiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWasmStreamingCompiler) };

JSObject* JSWasmStreamingCompiler::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSWasmStreamingCompilerPrototype::create(vm, globalObject, globalObject.objectPrototype());
}

static inline EncodedJSValue jsWasmStreamingCompilerPrototypeFunction_addBytesBody(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, typename IDLOperation<JSWasmStreamingCompiler>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    auto chunkValue = callFrame->uncheckedArgument(0);

    // See getWasmBufferFromValue in JSC's JSWebAssemblyHelpers.h
    if (auto arrayBufferView = dynamicDowncast<JSArrayBufferView>(chunkValue)) {
        if (isTypedArrayType(arrayBufferView->type())) {
            validateTypedArray(lexicalGlobalObject, arrayBufferView);
            RETURN_IF_EXCEPTION(throwScope, {});
        } else {
            // DataView
            IdempotentArrayBufferByteLengthGetter<std::memory_order_relaxed> getter;
            if (!uncheckedDowncast<JSDataView>(arrayBufferView)->viewByteLength(getter)) [[unlikely]] {
                throwTypeError(lexicalGlobalObject, throwScope, typedArrayBufferHasBeenDetachedErrorMessage);
                return {};
            }
        }

        impl.addBytes(arrayBufferView->span());
        return encodedJSUndefined();
    } else if (auto arrayBuffer = dynamicDowncast<JSArrayBuffer>(chunkValue)) {
        auto arrayBufferImpl = arrayBuffer->impl();
        if (arrayBufferImpl->isDetached()) {
            throwTypeError(lexicalGlobalObject, throwScope, typedArrayBufferHasBeenDetachedErrorMessage);
            return {};
        }

        impl.addBytes(arrayBufferImpl->span());
        return encodedJSUndefined();
    } else [[unlikely]] {
        // See WasmStreamingObject::Push in Node.js's node_wasm_web_api.cc
        return Bun::ERR::INVALID_ARG_TYPE(throwScope, lexicalGlobalObject, "chunk must be an ArrayBufferView or an ArrayBuffer"_s);
    }
}

JSC_DEFINE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_addBytes, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSWasmStreamingCompiler>::call<jsWasmStreamingCompilerPrototypeFunction_addBytesBody>(*lexicalGlobalObject, *callFrame, "addBytes"_s);
}

static inline EncodedJSValue jsWasmStreamingCompilerPrototypeFunction_finalizeBody(JSGlobalObject* lexicalGlobalObject, CallFrame*, typename IDLOperation<JSWasmStreamingCompiler>::ClassParameter castedThis)
{
    castedThis->wrapped().finalize(lexicalGlobalObject);
    return encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_finalize, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSWasmStreamingCompiler>::call<jsWasmStreamingCompilerPrototypeFunction_finalizeBody>(*lexicalGlobalObject, *callFrame, "finalize"_s);
}

static inline EncodedJSValue jsWasmStreamingCompilerPrototypeFunction_failBody(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, typename IDLOperation<JSWasmStreamingCompiler>::ClassParameter castedThis)
{
    // This should never fail since this method is only called internally
    auto error = callFrame->uncheckedArgument(0);
    castedThis->wrapped().fail(lexicalGlobalObject, error);
    return encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_fail, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSWasmStreamingCompiler>::call<jsWasmStreamingCompilerPrototypeFunction_failBody>(*lexicalGlobalObject, *callFrame, "fail"_s);
}

static inline EncodedJSValue jsWasmStreamingCompilerPrototypeFunction_cancelBody(JSGlobalObject*, CallFrame*, typename IDLOperation<JSWasmStreamingCompiler>::ClassParameter castedThis)
{
    castedThis->wrapped().cancel();
    return encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_cancel, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSWasmStreamingCompiler>::call<jsWasmStreamingCompilerPrototypeFunction_cancelBody>(*lexicalGlobalObject, *callFrame, "cancel"_s);
}

}

#endif // ENABLE(WEBASSEMBLY)
