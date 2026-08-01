// JSCompressionStream / JSDecompressionStream — CompressionStream and
// DecompressionStream instance cells. Each IS a JSTransformStream (C++ subclass)
// whose controller's transformerKind drives the Rust CompressionStreamCoder
// (m_coder) directly.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSDOMGlobalObject.h"
#include "JSTransformStream.h"
#include "StreamConstructor.h"

namespace WebCore {

class JSCompressionStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSCompressionStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

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

    // the Rust CompressionStreamCoder; freed by destroy().
    void* m_coder { nullptr };
    Bun::WebStreams::CompressionFormat m_format { Bun::WebStreams::CompressionFormat::Deflate };

private:
    JSCompressionStream(JSC::VM&, JSC::Structure*);
    ~JSCompressionStream();
};

using JSCompressionStreamConstructor = JSStreamConstructor<JSCompressionStream>;

class JSDecompressionStream final : public JSTransformStream {
public:
    using Base = JSTransformStream;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDecompressionStream* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);

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

    void* m_coder { nullptr };
    Bun::WebStreams::CompressionFormat m_format { Bun::WebStreams::CompressionFormat::Deflate };

private:
    JSDecompressionStream(JSC::VM&, JSC::Structure*);
    ~JSDecompressionStream();
};

using JSDecompressionStreamConstructor = JSStreamConstructor<JSDecompressionStream>;

} // namespace WebCore
