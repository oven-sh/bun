#pragma once

#include "root.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {

// The object returned from process.binding('http_parser')
class ProcessBindingHTTPParser final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable;

    static ProcessBindingHTTPParser* create(JSC::VM&, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    void finishCreation(JSC::VM&);

    ProcessBindingHTTPParser(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

// The object process.binding("http_parser") returns, for builtins:
// $cpp("ProcessBindingHTTPParser.cpp", "getProcessBindingHTTPParser").
JSC::JSValue getProcessBindingHTTPParser(Zig::GlobalObject*);

} // namespace Bun
