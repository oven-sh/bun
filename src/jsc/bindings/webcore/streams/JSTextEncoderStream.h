// JSTextEncoderStream — the TextEncoderStream instance cell: it is
// TransformerKind::TextEncoder's algorithmContext, and the transform/flush arms drive
// the Rust TextEncoderStreamEncoder (m_encoder) directly through the extern "C" surface
// in TextEncoderStreamEncoder.rs. Destructible: m_encoder must be freed.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace WebCore {

class JSTextEncoderStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSTextEncoderStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSObject* prototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    // visitChildrenImpl MUST visit: m_transform.
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
    // the Rust TextEncoderStreamEncoder (lone-surrogate buffering); freed by destroy().
    void* m_encoder { nullptr };

private:
    JSTextEncoderStream(JSC::VM&, JSC::Structure*);
    ~JSTextEncoderStream();
    void finishCreation(JSC::VM&);
};

using JSTextEncoderStreamConstructor = JSStreamConstructor<JSTextEncoderStream>;

} // namespace WebCore
