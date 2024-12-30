#pragma once

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

class JSS3Bucket : public JSC::JSFunction {
    using Base = JSC::JSFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

public:
    static constexpr bool needsDestruction = true;

    JSS3Bucket(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, NativeExecutable* executable, void* ptr);

    DECLARE_INFO;

    static void destroy(JSCell* cell);
    ~JSS3Bucket();

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue call(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);
    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);

    static JSS3Bucket* create(JSC::VM& vm, Zig::GlobalObject* globalObject, void* ptr);
    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    void* ptr;
};

// Constructor helper
JSValue constructS3Bucket(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe);
Structure* createJSS3BucketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
