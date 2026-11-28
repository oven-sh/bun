#pragma once
#include "root.h"

namespace Bun {

using namespace JSC;

// The object returned from process.binding('fs')
class ProcessBindingFs final : public JSC::JSNonFinalObject {
public:
    DECLARE_INFO;

    using Base = JSC::JSNonFinalObject;

    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    static ProcessBindingFs* create(JSC::VM& vm, JSC::Structure* structure);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

private:
    void finishCreation(JSC::VM& vm);

    ProcessBindingFs(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace Bun
