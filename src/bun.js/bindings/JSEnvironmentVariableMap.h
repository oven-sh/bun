#pragma once
#include "root.h"
#include "BunClientData.h"

namespace Zig {
class GlobalObject;
}

namespace JSC {
class JSValue;
}

namespace Bun {

JSC::JSValue createEnvironmentVariablesMap(Zig::GlobalObject* globalObject);

class JSEnvironmentVariableMap : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;
    ~JSEnvironmentVariableMap();

    static JSEnvironmentVariableMap* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSEnvironmentVariableMap* ptr = new (NotNull, JSC::allocateCell<JSEnvironmentVariableMap>(vm)) JSEnvironmentVariableMap(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

protected:
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);

private:
    JSEnvironmentVariableMap(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

}
