#pragma once

#include "root.h"
#include "JSSocketAddressPrototype.h"

namespace Bun {

class JSSocketAddressConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static JSSocketAddressConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
        // TODO: use separate subspace??

        // return WebCore::subspaceForImpl<JSSocketAddressConstructor, WebCore::UseCustomHeapCellType::No>(
        //     vm,
        //     [](auto& spaces) { return spaces.m_clientSubspaceForBunClassConstructor.get(); },
        //     [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunClassConstructor = std::forward<decltype(space)>(space); },
        //     [](auto& spaces) { return spaces.m_subspaceForBunClassConstructor.get(); },
        //     [](auto& spaces, auto&& space) { spaces.m_subspaceForBunClassConstructor = std::forward<decltype(space)>(space); });
    }

    // void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSSocketAddressPrototype* prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    DECLARE_EXPORT_INFO;

protected:
    JSSocketAddressConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSObject* prototype);
    // DECLARE_DEFAULT_FINISH_CREATION;
};

} // namespace Bun
