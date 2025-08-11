#pragma once

#include "root.h"
#include <JavaScriptCore/JSObject.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

class JSNodeSQLiteStatementSyncPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSNodeSQLiteStatementSyncPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        JSNodeSQLiteStatementSyncPrototype* protObj = new (NotNull, allocateCell<JSNodeSQLiteStatementSyncPrototype>(vm)) JSNodeSQLiteStatementSyncPrototype(vm, structure);
        protObj->finishCreation(vm);
        return protObj;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

private:
    JSNodeSQLiteStatementSyncPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun