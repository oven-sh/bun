#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

class JSReadableStreamBYOBReaderPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSReadableStreamBYOBReaderPrototype* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    template<typename CellType, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSReadableStreamBYOBReaderPrototype(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace Bun
