// JSCompressionStream / JSDecompressionStream — the CompressionStream and
// DecompressionStream instance cells. Each is TransformerKind::Compression /
// ::Decompression's algorithmContext; the transform/flush arms drive the
// Rust CompressionStreamCoder (m_coder) directly and enqueue the resulting
// Uint8Array via the TransformStream backpressure machinery. Destructible:
// the coder owns a zlib/brotli/zstd context that must be freed.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "StreamConstructor.h"
#include <JavaScriptCore/JSDestructibleObject.h>

namespace WebCore {

class JSCompressionStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSCompressionStream* create(JSC::VM&, JSC::Structure*);
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
    // TransformerKind::Compression and `this` as the algorithm context).
    JSC::WriteBarrier<JSTransformStream> m_transform;
    // the Rust CompressionStreamCoder; freed by destroy().
    void* m_coder { nullptr };
    Bun::WebStreams::CompressionFormat m_format { Bun::WebStreams::CompressionFormat::Deflate };

private:
    JSCompressionStream(JSC::VM&, JSC::Structure*);
    ~JSCompressionStream();
    void finishCreation(JSC::VM&);
};

using JSCompressionStreamConstructor = JSStreamConstructor<JSCompressionStream>;

class JSDecompressionStream final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    static JSDecompressionStream* create(JSC::VM&, JSC::Structure*);
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

    JSC::WriteBarrier<JSTransformStream> m_transform;
    void* m_coder { nullptr };
    Bun::WebStreams::CompressionFormat m_format { Bun::WebStreams::CompressionFormat::Deflate };

private:
    JSDecompressionStream(JSC::VM&, JSC::Structure*);
    ~JSDecompressionStream();
    void finishCreation(JSC::VM&);
};

using JSDecompressionStreamConstructor = JSStreamConstructor<JSDecompressionStream>;

} // namespace WebCore
