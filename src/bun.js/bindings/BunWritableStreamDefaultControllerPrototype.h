#pragma once

#include "root.h"

namespace Bun {

class JSWritableStreamDefaultControllerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSWritableStreamDefaultControllerPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure);

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultControllerPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultControllerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

} // namespace Bun
