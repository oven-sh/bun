#pragma once

#include "root.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

class JSNodeHTTPServerSocketPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable;

    static JSNodeHTTPServerSocketPrototype* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSNodeHTTPServerSocketPrototype* prototype = new (NotNull, JSC::allocateCell<JSNodeHTTPServerSocketPrototype>(vm)) JSNodeHTTPServerSocketPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSNodeHTTPServerSocketPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
