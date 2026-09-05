#include "config.h"
#include "JSWasmStreamingCompiler.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMBinding.h"
#include "JSDOMOperation.h"
#include <JavaScriptCore/HeapAnalyzer.h>

#include "ErrorCode.h"

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_addBytes);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_finalize);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_fail);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_cancel);

class JSWasmStreamingCompilerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWasmStreamingCompilerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWasmStreamingCompilerPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSWasmStreamingCompilerPrototype))) JSWasmStreamingCompilerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWasmStreamingCompilerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWasmStreamingCompilerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWasmStreamingCompilerPrototype, JSWasmStreamingCompilerPrototype::Base);

static const HashTableValue JSWasmStreamingCompilerPrototypeTableValues[] = {
    { "addBytes"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_addBytes, 1 } },
    { "finalize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_finalize, 0 } },
    { "fail"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_fail, 1 } },
    { "cancel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWasmStreamingCompilerPrototypeFunction_cancel, 0 } }
};

const ClassInfo JSWasmStreamingCompilerPrototype::s_info = { "WasmStreamingCompiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWasmStreamingCompilerPrototype) };

void JSWasmStreamingCompilerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSWasmStreamingCompiler::info(), JSWasmStreamingCompilerPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

const ClassInfo JSWasmStreamingCompiler::s_info = { "WasmStreamingCompiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWasmStreamingCompiler) };

JSWasmStreamingCompiler::JSWasmStreamingCompiler(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Wasm::StreamingCompiler>&& impl)
    : JSDOMWrapper<Wasm::StreamingCompiler>(structure, globalObject, WTF::move(impl))
{
}

void JSWasmStreamingCompiler::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSWasmStreamingCompiler::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSWasmStreamingCompilerPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSWasmStreamingCompilerPrototype::create(vm, &globalObject, structure);
}

void JSWasmStreamingCompiler::destroy(JSCell* cell)
{
    auto* thisObject = static_cast<JSWasmStreamingCompiler*>(cell);
    thisObject->JSWasmStreamingCompiler::~JSWasmStreamingCompiler();
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

GCClient::IsoSubspace* JSWasmStreamingCompiler::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSWasmStreamingCompiler, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForWasmStreamingCompiler, m_subspaceForWasmStreamingCompiler));
}

void JSWasmStreamingCompiler::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSWasmStreamingCompiler>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    Base::analyzeHeap(cell, analyzer);
}

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Wasm::StreamingCompiler>&& impl)
{
    return createWrapper<Wasm::StreamingCompiler>(globalObject, WTF::move(impl));
}

}
