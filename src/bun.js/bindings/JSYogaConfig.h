#pragma once
#include "root.h"
#include <memory>
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <wtf/Ref.h>

// Forward declarations
typedef struct YGConfig* YGConfigRef;

namespace Bun {

class YogaConfigImpl;

class JSYogaConfig final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSYogaConfig* create(JSC::VM&, JSC::Structure*);
    static JSYogaConfig* create(JSC::VM&, JSC::Structure*, Ref<YogaConfigImpl>&&);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    ~JSYogaConfig();

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    YogaConfigImpl& impl() { return m_impl.get(); }
    const YogaConfigImpl& impl() const { return m_impl.get(); }

    // Context storage
    JSC::WriteBarrier<JSC::Unknown> m_context;

    // Logger callback
    JSC::WriteBarrier<JSC::JSObject> m_loggerFunc;

    // Clone node callback
    JSC::WriteBarrier<JSC::JSObject> m_cloneNodeFunc;

private:
    JSYogaConfig(JSC::VM&, JSC::Structure*);
    JSYogaConfig(JSC::VM&, JSC::Structure*, Ref<YogaConfigImpl>&&);
    void finishCreation(JSC::VM&);

    Ref<YogaConfigImpl> m_impl;
};

} // namespace Bun
