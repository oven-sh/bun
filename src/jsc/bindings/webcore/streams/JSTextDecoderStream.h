// JSTextDecoderStream — the TextDecoderStream instance cell: it is
// TransformerKind::TextDecoder's algorithmContext, and the transform/flush arms drive
// the Rust TextDecoder (m_decoder) directly through the extern "C" surface in
// TextDecoder.rs (no per-chunk `{stream: true}` options object, no prototype lookup).
// Destructible: m_decoder must be freed.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace WebCore {

class JSTextDecoderStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSTextDecoderStream* create(JSC::VM&, JSC::Structure*);
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
    // TransformerKind::TextDecoder and `this` as the algorithm context).
    JSC::WriteBarrier<JSTransformStream> m_transform;
    // the Rust TextDecoder (encoding state, BOM / partial-sequence buffering); freed by destroy().
    void* m_decoder { nullptr };
    bool m_fatal { false };
    bool m_ignoreBOM { false };

private:
    JSTextDecoderStream(JSC::VM&, JSC::Structure*);
    ~JSTextDecoderStream();
    void finishCreation(JSC::VM&);
};

using JSTextDecoderStreamConstructor = JSStreamConstructor<JSTextDecoderStream>;

} // namespace WebCore
