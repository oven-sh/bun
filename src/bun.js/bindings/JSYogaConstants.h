#pragma once
#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace Bun {

class JSYogaConstants final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSYogaConstants* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSYogaConstants* constants = new (NotNull, allocateCell<JSYogaConstants>(vm)) JSYogaConstants(vm, structure);
        constants->finishCreation(vm);
        return constants;
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

private:
    JSYogaConstants(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
