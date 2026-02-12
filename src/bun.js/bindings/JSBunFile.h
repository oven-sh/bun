#pragma once

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

class JSBunFile : public WebCore::JSBlob {
    using Base = WebCore::JSBlob;

public:
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    JSBunFile(JSC::VM& vm, Structure* structure, void* ptr)
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
    ~JSBunFile();

    static JSBunFile* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ptr);
    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);
};

Structure* createJSBunFileStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
