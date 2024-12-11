#pragma once

#include "root.h"
#include "ZigGlobalObject.h"
#include "BunGlobalScope.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/VM.h>

#include "headers-handwritten.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallFrame.h>

namespace Bun {

class NodeVMGlobalObject final : public Bun::GlobalScope {
    using Base = Bun::GlobalScope;

public:
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut | JSC::OverridesGetOwnPropertySlot;
    static constexpr bool needsDestruction = true;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static NodeVMGlobalObject* create(JSC::VM& vm, JSC::Structure* structure);
    static Structure* createStructure(JSC::VM& vm, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void finishCreation(JSC::VM&);
    static void destroy(JSCell* cell);
    void setContextifiedObject(JSC::JSObject* contextifiedObject);
    void clearContextifiedObject();

    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot);
    static bool defineOwnProperty(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow);
    static bool getOwnPropertySlot(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot);

private:
    NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure);
    ~NodeVMGlobalObject();

    mutable JSC::WriteBarrier<JSC::JSObject> m_contextifiedObject;
};

Structure* createNodeVMGlobalObjectStructure(JSC::VM&);
void configureNodeVM(JSC::VM&, Zig::GlobalObject*);

JSC_DECLARE_HOST_FUNCTION(vmModule_createContext);
JSC_DECLARE_HOST_FUNCTION(vmModule_isContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInNewContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInThisContext);

JSC::JSValue createNodeVMBinding(Zig::GlobalObject*);
Structure* createNodeVMProxyStructure(JSC::VM&);

} // namespace Bun
