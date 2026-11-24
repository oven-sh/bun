#pragma once

#include "root.h"
#include "EventEmitter.h"
#include "JSDOMInterface.h"

namespace WebCore {

class JSEventEmitter : public JSDOMInterfaceWithAdditionalChildren<JSEventEmitter, EventEmitter> {
public:
    using JSDOMInterfaceWithAdditionalChildren::JSDOMInterfaceWithAdditionalChildren;

    DECLARE_INFO;
    static constexpr auto subspaceSlots = BUN_SUBSPACE_SLOTS(m_clientSubspaceForEventEmitter, m_subspaceForEventEmitter);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    static inline JSC::EncodedJSValue addListener(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSEventEmitter* castedThis, bool once, bool prepend);
    static inline JSC::EncodedJSValue removeListener(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, JSEventEmitter* castedThis);

    template<typename Visitor> void visitAdditionalChildrenInGCThread(Visitor&);
    bool isReachableFromOpaqueRoots(JSC::AbstractSlotVisitor&, ASCIILiteral*) const;
};

template<> struct JSDOMWrapperConverterTraits<EventEmitter> {
    using WrapperClass = JSEventEmitter;
};

} // namespace WebCore
#include "JSEventEmitterCustom.h"
