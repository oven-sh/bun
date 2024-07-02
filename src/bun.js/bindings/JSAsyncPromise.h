
#pragma once

namespace Bun {

class JSAsyncPromise : public JSC::JSCell {
public:
    using Base = JSC::JSCell;
    static constexpr unsigned StructureFlags = Base::StructureFlags | StructureIsImmortal;
    static constexpr bool needsDestruction = true;

    static JSAsyncPromise* create(JSC::VM& vm, Zig::GlobalObject* globalObject);

    static void destroy(JSC::JSCell*);
    ~JSAsyncPromise() = default;

    void finishCreation(VM& vm);

    void reject(VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue value);
    void resolve(VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue value);

    mutable JSC::WriteBarrier<JSC::JSPromise> promise;
    StackFrame frame;

    DECLARE_VISIT_CHILDREN;
    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Structure::create(vm, globalObject, jsNull(), TypeInfo(CellType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSAsyncPromise, UseCustomHeapCellType::Yes>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSAsyncPromise.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSAsyncPromise = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSAsyncPromise.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSAsyncPromise = std::forward<decltype(space)>(space); },
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSAsyncPromise; });
    }

    JSAsyncPromise(JSC::VM& vm, JSC::Structure* structure, JSC::JSPromise* promise)
        : Base(vm, structure)
        , promise(promise, JSC::WriteBarrierEarlyInit)
    {
    }
};

JSC::Structure* createJSAsyncPromiseStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

}