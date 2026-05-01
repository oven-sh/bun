#pragma once

#include "root.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

class JSNodePerformanceHooksHistogramPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodePerformanceHooksHistogramPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSNodePerformanceHooksHistogramPrototype* prototype = new (NotNull, allocateCell<JSNodePerformanceHooksHistogramPrototype>(vm)) JSNodePerformanceHooksHistogramPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSNodePerformanceHooksHistogramPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

} // namespace Bun
