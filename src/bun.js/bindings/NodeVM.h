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

// This class represents a sandboxed global object for vm contexts
class NodeVMGlobalObject final : public Bun::GlobalScope {
    using Base = Bun::GlobalScope;

public:
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesGetOwnPropertySlot | JSC::OverridesPut | JSC::OverridesGetOwnPropertyNames | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum | JSC::ProhibitsPropertyCaching;
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

    // Override property access to delegate to contextified object
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSCell*, JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, JSC::PropertyNameArray&, JSC::DontEnumPropertiesMode);
    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow);
    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot);

private:
    NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure);
    ~NodeVMGlobalObject();

    // The contextified object that acts as the global proxy
    mutable JSC::WriteBarrier<JSC::JSObject> m_sandbox;
};

// Helper functions to create vm contexts and run code
JSC::JSValue createNodeVMBinding(Zig::GlobalObject*);
Structure* createNodeVMGlobalObjectStructure(JSC::VM&);
void configureNodeVM(JSC::VM&, Zig::GlobalObject*);

// VM module functions
JSC_DECLARE_HOST_FUNCTION(vmModule_createContext);
JSC_DECLARE_HOST_FUNCTION(vmModule_isContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInNewContext);
JSC_DECLARE_HOST_FUNCTION(vmModuleRunInThisContext);

} // namespace Bun
