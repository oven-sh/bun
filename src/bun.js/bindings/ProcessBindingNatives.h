#pragma once
#include "root.h"

namespace Bun {
using namespace JSC;

// The object returned from process.binding('natives')
class ProcessBindingNatives final : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    static ProcessBindingNatives* create(JSC::VM& vm, JSC::Structure* structure);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ProcessBindingNatives, Base);
        return &vm.plainObjectSpace();
    }

private:
    void finishCreation(JSC::VM& vm);

    ProcessBindingNatives(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace Bun
