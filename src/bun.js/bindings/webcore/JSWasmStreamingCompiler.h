#pragma once

#include "JSDOMWrapper.h"
#include "JavaScriptCore/WasmStreamingCompiler.h"
#include <wtf/NeverDestroyed.h>

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
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::Wasm::StreamingCompiler* toWrapped(JSC::VM&, JSC::JSValue);
    static void destroy(JSC::JSCell*);

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray);
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
class JSWasmStreamingCompilerOwner final : public JSC::WeakHandleOwner {
public:
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* context, JSC::AbstractSlotVisitor&, ASCIILiteral*) final;
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final;
};

inline JSC::WeakHandleOwner* wrapperOwner(DOMWrapperWorld&, JSC::Wasm::StreamingCompiler*)
{
    static NeverDestroyed<JSWasmStreamingCompilerOwner> owner;
    return &owner.get();
}

inline void* wrapperKey(JSC::Wasm::StreamingCompiler* wrappableObject)
{
    return wrappableObject;
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, JSC::Wasm::StreamingCompiler&);
inline JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, JSC::Wasm::StreamingCompiler* impl) { return impl ? toJS(lexicalGlobalObject, globalObject, *impl) : JSC::jsNull(); }
JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject*, Ref<JSC::Wasm::StreamingCompiler>&&);
inline JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, RefPtr<JSC::Wasm::StreamingCompiler>&& impl) { return impl ? toJSNewlyCreated(lexicalGlobalObject, globalObject, impl.releaseNonNull()) : JSC::jsNull(); }

template<> struct JSDOMWrapperConverterTraits<JSC::Wasm::StreamingCompiler> {
    using WrapperClass = JSWasmStreamingCompiler;
    using ToWrappedReturnType = JSC::Wasm::StreamingCompiler*;
};

} // namespace WebCore
