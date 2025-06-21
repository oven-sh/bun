#pragma once
#include "root.h"
#include <memory>
#include <JavaScriptCore/JSDestructibleObject.h>

// Forward declarations
typedef struct YGConfig* YGConfigRef;

namespace Bun {

class JSYogaConfig final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSYogaConfig* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue);
    ~JSYogaConfig();

    template<typename, JSC::SubspaceAccess> 
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM&);
    
    DECLARE_INFO;

    YGConfigRef internal() { return m_config; }

private:
    JSYogaConfig(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
    
    YGConfigRef m_config;
};

} // namespace Bun