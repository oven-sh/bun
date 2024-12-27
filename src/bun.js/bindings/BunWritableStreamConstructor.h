#pragma once

#include "root.h"

namespace Bun {

class JSWritableStreamPrototype;

using namespace JSC;

class JSWritableStreamConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWritableStreamConstructor* create(VM&, JSGlobalObject*, JSWritableStreamPrototype*);
    DECLARE_INFO;

    template<typename CellType, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        if constexpr (mode == SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

    static Structure* createStructure(VM&, JSGlobalObject*, JSValue prototype);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSGlobalObject*, CallFrame*);
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSGlobalObject*, CallFrame*);

private:
    JSWritableStreamConstructor(VM& vm, Structure* structure);
    void finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype);
};

} // namespace Bun
