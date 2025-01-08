#pragma once

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

class JSS3File : public WebCore::JSBlob {
    using Base = WebCore::JSBlob;

public:
    static constexpr bool needsDestruction = true;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    JSS3File(JSC::VM& vm, Structure* structure, void* ptr)
        : Base(vm, structure, ptr)
    {
    }
    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::JSBlob::subspaceFor<WebCore::JSBlob, mode>(vm);
    }

    static void destroy(JSCell* cell);
    ~JSS3File();

    static JSS3File* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ptr);
    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);
};

// Constructor helper
JSValue constructS3File(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe);
Structure* createJSS3FileStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
