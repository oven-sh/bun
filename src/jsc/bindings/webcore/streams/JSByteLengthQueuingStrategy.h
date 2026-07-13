// JSByteLengthQueuingStrategy — the ByteLengthQueuingStrategy instance cell.
// Non-destructible. The per-realm `size` function
// (%byteLengthQueuingStrategySizeFunction%) is owned by JSStreamsRuntime, not the instance.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSByteLengthQueuingStrategy final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSByteLengthQueuingStrategy* create(JSC::VM&, JSC::Structure*, double highWaterMark);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // No WriteBarrier / barrier-container / Weak members ⇒ no DECLARE_VISIT_CHILDREN.

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    // [[highWaterMark]] — the `unrestricted double` given in the constructor, verbatim.
    double m_highWaterMark { 0 };

private:
    JSByteLengthQueuingStrategy(JSC::VM&, JSC::Structure*, double highWaterMark);
    void finishCreation(JSC::VM&);
};

using JSByteLengthQueuingStrategyConstructor = JSStreamConstructor<JSByteLengthQueuingStrategy>;

} // namespace WebCore
