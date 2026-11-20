// The `location` of a Web Worker: https://html.spec.whatwg.org/multipage/workers.html#worker-locations
#pragma once

#include "root.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include "URLDecomposition.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/URL.h>

namespace WebCore {

// The worker's entry URL behind the WHATWG accessors that DOMURL shares.
class WorkerLocation final : public URLDecomposition {
public:
    explicit WorkerLocation(URL&& url)
        : m_url(WTF::move(url))
    {
    }
    const URL& url() const { return m_url; }

private:
    URL fullURL() const final { return m_url; }
    // Every attribute of a WorkerLocation is readonly.
    void setFullURL(const URL&) final {}

    URL m_url;
};

class JSWorkerLocation final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWorkerLocation* create(JSC::VM&, JSDOMGlobalObject&, URL&&);
    static void destroy(JSC::JSCell* cell) { static_cast<JSWorkerLocation*>(cell)->~JSWorkerLocation(); }

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    const WorkerLocation& wrapped() const { return m_location; }

private:
    JSWorkerLocation(JSC::VM&, JSC::Structure*, URL&&);
    void finishCreation(JSC::VM&);

    WorkerLocation m_location;
};

// `new WorkerLocation()` throws "Illegal constructor".
using JSWorkerLocationConstructor = JSDOMConstructorNotConstructable<JSWorkerLocation>;

} // namespace WebCore
