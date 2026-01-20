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

// Define the toWrapped template function for WasmStreamingCompiler
template<typename ExceptionThrower>
Wasm::StreamingCompiler* toWrapped(JSGlobalObject& lexicalGlobalObject, ExceptionThrower&& exceptionThrower, JSValue value)
{
    auto& vm = getVM(&lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* impl = JSWasmStreamingCompiler::toWrapped(vm, value);
    if (!impl) [[unlikely]]
        exceptionThrower(lexicalGlobalObject, scope);
    return impl;
}

static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_addBytes);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_finalize);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_fail);
static JSC_DECLARE_HOST_FUNCTION(jsWasmStreamingCompilerPrototypeFunction_cancel);

class JSWasmStreamingCompilerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWasmStreamingCompilerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWasmStreamingCompilerPrototype* ptr = new (NotNull, JSC::allocateCell<JSWasmStreamingCompilerPrototype>(vm)) JSWasmStreamingCompilerPrototype(vm, globalObject, structure);
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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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
    reifyStaticProperties(vm, JSWasmStreamingCompiler::info(), JSWasmStreamingCompilerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
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

JSObject* JSWasmStreamingCompiler::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSWasmStreamingCompiler>(vm, globalObject);
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
    if (auto arrayBufferView = jsDynamicCast<JSArrayBufferView*>(chunkValue)) {
        if (isTypedArrayType(arrayBufferView->type())) {
            validateTypedArray(lexicalGlobalObject, arrayBufferView);
            RETURN_IF_EXCEPTION(throwScope, {});
        } else {
            // DataView
            IdempotentArrayBufferByteLengthGetter<std::memory_order_relaxed> getter;
            if (!jsCast<JSDataView*>(arrayBufferView)->viewByteLength(getter)) [[unlikely]] {
                throwTypeError(lexicalGlobalObject, throwScope, typedArrayBufferHasBeenDetachedErrorMessage);
                return {};
            }
        }

        impl.addBytes(arrayBufferView->span());
        return encodedJSUndefined();
    } else if (auto arrayBuffer = jsDynamicCast<JSArrayBuffer*>(chunkValue)) {
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
    return WebCore::subspaceForImpl<JSWasmStreamingCompiler, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForWasmStreamingCompiler.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForWasmStreamingCompiler = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForWasmStreamingCompiler.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForWasmStreamingCompiler = std::forward<decltype(space)>(space); });
}

void JSWasmStreamingCompiler::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSWasmStreamingCompiler*>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    Base::analyzeHeap(cell, analyzer);
}

bool JSWasmStreamingCompilerOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor&, ASCIILiteral*)
{
    return false;
}

void JSWasmStreamingCompilerOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsWasmStreamingCompiler = static_cast<JSWasmStreamingCompiler*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsWasmStreamingCompiler->wrapped(), jsWasmStreamingCompiler);
}

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Wasm::StreamingCompiler>&& impl)
{
    return createWrapper<Wasm::StreamingCompiler>(globalObject, WTF::move(impl));
}

JSValue toJS(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Wasm::StreamingCompiler& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

Wasm::StreamingCompiler* JSWasmStreamingCompiler::toWrapped(VM& vm, JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSWasmStreamingCompiler*>(value))
        return &wrapper->wrapped();
    return nullptr;
}

}
