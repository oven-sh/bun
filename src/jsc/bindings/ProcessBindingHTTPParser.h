#pragma once

#include "root.h"

namespace Bun {

// The object returned from process.binding('http_parser')
class ProcessBindingHTTPParser final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::HasStaticPropertyTable;

    static ProcessBindingHTTPParser* create(JSC::VM&, JSC::Structure* structure);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*);

    DECLARE_INFO;

private:
    void finishCreation(JSC::VM&);

    ProcessBindingHTTPParser(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace Bun
