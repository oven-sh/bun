#pragma once

#include "JSCookieMap.h"
#include "root.h"
#include "ZigGeneratedClasses.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

class JSBakeResponse : public JSResponse {
public:
    using Base = JSResponse;

    static JSBakeResponse* create(JSC::VM& vm, JSC::Structure* structure, void* ctx);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    // JSC::Strong<JSC::Unknown>& type() { return m_type; }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if (mode == JSC::SubspaceAccess::Concurrently) {
            return nullptr;
        }

        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    DECLARE_VISIT_CHILDREN;
    DECLARE_INFO;

private:
    JSBakeResponse(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr);
    void finishCreation(JSC::VM& vm);

    // JSC::Strong<JSC::Unknown> m_type;
};

JSC::Structure* createJSBakeResponseStructure(JSC::VM&, Zig::GlobalObject*);
void setupJSBakeResponseClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
