#pragma once

#include "root.h"
#include "BunStreamStructures.h"

namespace Bun {

using namespace JSC;

class JSWritableStreamConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWritableStreamConstructor* create(VM&, JSGlobalObject*, Structure*, JSWritableStreamPrototype*);
    DECLARE_INFO;

    template<typename CellType, SubspaceAccess mode>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWritableStreamConstructor,
            WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForConstructor = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForConstructor = std::forward<decltype(space)>(space); });
    }

    static Structure* createStructure(VM&, JSGlobalObject*, JSValue prototype);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

private:
    JSWritableStreamConstructor(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype);
};

} // namespace Bun
