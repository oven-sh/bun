#pragma once

#include "root.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSGlobalObject.h>

namespace Bun {

class JSNodeSQLiteDatabaseSyncConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteDatabaseSyncConstructor* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSC::JSObject* prototype);

    template<typename, JSC::SubspaceAccess mode> 
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSNodeSQLiteDatabaseSyncConstructor(JSC::VM& vm, JSC::Structure* structure);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
};

} // namespace Bun