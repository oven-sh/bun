#pragma once

#include "JavaScriptCore/SubspaceAccess.h"
#include "../v8/V8Template.h"
#include "InternalFieldObject.h"
#include "TemplateProperty.h"

namespace v8 {

class ObjectTemplate;

namespace shim {

class ObjectTemplate : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    DECLARE_INFO;

    static ObjectTemplate* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<ObjectTemplate, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForObjectTemplate, m_subspaceForObjectTemplate));
    }

    DECLARE_VISIT_CHILDREN;

    InternalFieldObject* newInstance();

    int internalFieldCount() const { return m_internalFieldCount; }

    void setInternalFieldCount(int newInternalFieldCount) { m_internalFieldCount = newInternalFieldCount > 0 ? newInternalFieldCount : 0; }

    WTF::Vector<TemplateProperty>& properties() { return m_properties; }
    WTF::Vector<TemplateAccessor>& accessors() { return m_accessors; }

    void addProperty(JSC::VM& vm, JSC::JSValue name, JSC::JSValue value, unsigned attributes);
    void addAccessor(JSC::VM& vm, JSC::JSValue name, AccessorNameGetterCallback getter, AccessorNameSetterCallback setter, JSC::JSValue data, unsigned attributes);

private:
    // Number of internal fields to allocate space for on objects created by this template
    int m_internalFieldCount = 0;
    WTF::Vector<TemplateProperty> m_properties;
    WTF::Vector<TemplateAccessor> m_accessors;
    // Structure used to allocate objects with this template (different than
    // GlobalInternals::m_objectTemplateStructure, which is the structure used to allocate object
    // templates themselves)
    JSC::LazyProperty<ObjectTemplate, JSC::Structure> m_objectStructure;

    ObjectTemplate(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, Template::DummyCallback, Template::DummyCallback)
    {
    }

    void finishCreation(JSC::VM& vm);
};

} // namespace shim
} // namespace v8
