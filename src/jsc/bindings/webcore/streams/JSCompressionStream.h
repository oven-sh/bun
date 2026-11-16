// JSCompressionStream — the CompressionStream instance cell. A JSTransformStream
// subclass whose controller's transformerKind drives the Rust CompressionStreamCoder
// (m_coder) directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSCompressionStreamShared.h"
#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSCompressionStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSCompressionStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell* cell) { static_cast<JSCompressionStream*>(cell)->~JSCompressionStream(); }

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

    // Null while an off-thread step owns it. Released eagerly at ClearAlgorithms (post-flush / error / cancel).
    std::unique_ptr<CompressionStreamCoder> m_coder;

private:
    JSCompressionStream(JSC::VM&, JSC::Structure*);
};

using JSCompressionStreamConstructor = JSStreamConstructor<JSCompressionStream>;

} // namespace WebCore
