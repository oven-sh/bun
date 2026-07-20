#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

class JSX509CertificatePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSX509CertificatePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSX509CertificatePrototype* prototype = new (NotNull, allocateCell<JSX509CertificatePrototype>(vm)) JSX509CertificatePrototype(vm, structure);
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
    JSX509CertificatePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
