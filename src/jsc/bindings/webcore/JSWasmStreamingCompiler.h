#pragma once

#include "JSDOMWrapper.h"
#include "JavaScriptCore/WasmStreamingCompiler.h"

namespace WebCore {

class JSWasmStreamingCompiler : public JSDOMWrapper<JSC::Wasm::StreamingCompiler> {
public:
    using Base = JSDOMWrapper<JSC::Wasm::StreamingCompiler>;
    static JSWasmStreamingCompiler* create(JSC::Structure* structure, JSDOMGlobalObject* globalObject, Ref<JSC::Wasm::StreamingCompiler>&& impl)
    {
        JSWasmStreamingCompiler* ptr = new (NotNull, JSC::allocateCell<JSWasmStreamingCompiler>(globalObject->vm())) JSWasmStreamingCompiler(structure, *globalObject, WTF::move(impl));
        ptr->finishCreation(globalObject->vm());
        return ptr;
    }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static void destroy(JSC::JSCell*);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
    }

    // static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

protected:
    JSWasmStreamingCompiler(JSC::Structure*, JSDOMGlobalObject&, Ref<JSC::Wasm::StreamingCompiler>&&);

    void finishCreation(JSC::VM&);
};
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<JSC::Wasm::StreamingCompiler>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<JSC::Wasm::StreamingCompiler>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<JSC::Wasm::StreamingCompiler> {
    using WrapperClass = JSWasmStreamingCompiler;
    using ToWrappedReturnType = JSC::Wasm::StreamingCompiler*;
};

} // namespace WebCore
