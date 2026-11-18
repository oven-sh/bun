#pragma once

#include "JSDOMInterface.h"
#include "JavaScriptCore/WasmStreamingCompiler.h"

#if ENABLE(WEBASSEMBLY)

namespace WebCore {

class JSWasmStreamingCompiler final : public JSDOMInterface<JSWasmStreamingCompiler, JSC::Wasm::StreamingCompiler> {
public:
    using JSDOMInterface::JSDOMInterface;

    DECLARE_INFO;
    static constexpr auto subspaceSlots = BUN_SUBSPACE_SLOTS(m_clientSubspaceForWasmStreamingCompiler, m_subspaceForWasmStreamingCompiler);

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
};

template<> struct JSDOMWrapperConverterTraits<JSC::Wasm::StreamingCompiler> {
    using WrapperClass = JSWasmStreamingCompiler;
};

} // namespace WebCore

#endif // ENABLE(WEBASSEMBLY)
