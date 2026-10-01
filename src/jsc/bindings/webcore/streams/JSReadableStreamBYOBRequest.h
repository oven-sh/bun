// JSReadableStreamBYOBRequest — the ReadableStreamBYOBRequest instance cell.
// Not user-constructible. Non-destructible.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSReadableStreamBYOBRequest final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    // Internal allocation entry point (readableByteStreamControllerGetBYOBRequest / PullInto).
    static JSReadableStreamBYOBRequest* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_controller, m_view.
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // [[controller]] — null after ReadableByteStreamControllerInvalidateBYOBRequest.
    JSC::WriteBarrier<JSReadableByteStreamController> m_controller;
    // [[view]] — a typed array view over the head pull-into descriptor, or null after
    // invalidation.
    JSC::WriteBarrier<JSC::JSArrayBufferView> m_view;

private:
    JSReadableStreamBYOBRequest(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

// Construct throws `TypeError: Illegal constructor`; the constructor object is still
// installed on globalThis so instanceof / .prototype work.
using JSReadableStreamBYOBRequestConstructor = JSDOMConstructorNotConstructable<JSReadableStreamBYOBRequest>;

} // namespace WebCore
