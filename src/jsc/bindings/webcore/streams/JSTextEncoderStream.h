// JSTextEncoderStream — the TextEncoderStream instance cell: it is
// TransformerKind::TextEncoder's algorithmContext, and the transform/flush algorithms are
// native code over m_encoder. Non-destructible (the lone-surrogate buffering lives in the
// held TextEncoderStreamEncoder cell, not here).
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

class JSTextEncoderStream final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    static JSTextEncoderStream* create(JSC::VM&, JSC::Structure*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_transform, m_encoder.
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

    // the inner TransformStream (created by createTransformStream with
    // TransformerKind::TextEncoder and `this` as the algorithm context).
    JSC::WriteBarrier<JSTransformStream> m_transform;
    // the existing native TextEncoderStreamEncoder cell (owns the lone-surrogate buffering).
    JSC::WriteBarrier<JSC::JSObject> m_encoder;

private:
    JSTextEncoderStream(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

using JSTextEncoderStreamConstructor = JSStreamConstructor<JSTextEncoderStream>;

} // namespace WebCore
