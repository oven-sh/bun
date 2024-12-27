#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

class JSReadableStreamBYOBReaderConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSReadableStreamBYOBReaderConstructor* create(JSC::VM&, JSC::JSGlobalObject*, JSObject* prototype);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

private:
    JSReadableStreamBYOBReaderConstructor(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace Bun
