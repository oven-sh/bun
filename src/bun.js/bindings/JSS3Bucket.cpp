
#include "root.h"

#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include "ZigGeneratedClasses.h"

#include "JSS3Bucket.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JavaScriptCore/JSCJSValue.h"
#include "ErrorCode.h"

namespace Bun {
using namespace JSC;

// External C functions declarations
extern "C" {
SYSV_ABI void* JSS3Bucket__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__call(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__unlink(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__write(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__presign(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__exists(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3Bucket__size(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI void* JSS3Bucket__deinit(void* ptr);
}

// Forward declarations
JSC_DECLARE_HOST_FUNCTION(functionS3Bucket_unlink);
JSC_DECLARE_HOST_FUNCTION(functionS3Bucket_write);
JSC_DECLARE_HOST_FUNCTION(functionS3Bucket_presign);
JSC_DECLARE_HOST_FUNCTION(functionS3Bucket_exists);
JSC_DECLARE_HOST_FUNCTION(functionS3Bucket_size);

static const HashTableValue JSS3BucketPrototypeTableValues[] = {
    { "unlink"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3Bucket_unlink, 0 } },
    { "write"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3Bucket_write, 1 } },
    { "presign"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3Bucket_presign, 1 } },
    { "exists"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3Bucket_exists, 1 } },
    { "size"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3Bucket_size, 1 } },
};

class JSS3BucketPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSS3BucketPrototype* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure)
    {
        JSS3BucketPrototype* prototype = new (NotNull, JSC::allocateCell<JSS3BucketPrototype>(vm)) JSS3BucketPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSS3BucketPrototype, Base);
        return &vm.plainObjectSpace();
    }

protected:
    JSS3BucketPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
        reifyStaticProperties(vm, info(), JSS3BucketPrototypeTableValues, *this);
    }
};

// Implementation of JSS3Bucket methods
void JSS3Bucket::destroy(JSCell* cell)
{
    static_cast<JSS3Bucket*>(cell)->JSS3Bucket::~JSS3Bucket();
}

JSS3Bucket::~JSS3Bucket()
{
    if (ptr) {
        JSS3Bucket__deinit(ptr);
    }
}

JSC::GCClient::IsoSubspace* JSS3Bucket::subspaceForImpl(JSC::VM& vm)
{
    // This needs it's own heapcell because of the destructor.
    return WebCore::subspaceForImpl<JSS3Bucket, WebCore::UseCustomHeapCellType::Yes>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSS3Bucket.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSS3Bucket = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSS3Bucket.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSS3Bucket = std::forward<decltype(space)>(space); },
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSS3Bucket; });
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSS3Bucket::call(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->jsCallee();
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(thisValue);
    if (UNLIKELY(!thisObject)) {
        Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    ASSERT(thisObject->ptr);

    return JSS3Bucket__call(thisObject->ptr, lexicalGlobalObject, callFrame);
}

JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSS3Bucket::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::throwError(lexicalGlobalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "S3Bucket is not constructable. To instantiate a bucket, do Bun.S3()"_s);
    return {};
}

JSS3Bucket* JSS3Bucket::create(JSC::VM& vm, Zig::GlobalObject* globalObject, void* ptr)
{
    auto* structure = globalObject->m_JSS3BucketStructure.getInitializedOnMainThread(globalObject);
    NativeExecutable* executable = vm.getHostFunction(&JSS3Bucket::call, ImplementationVisibility::Public, &JSS3Bucket::construct, String("S3Bucket"_s));
    JSS3Bucket* functionObject = new (NotNull, JSC::allocateCell<JSS3Bucket>(vm)) JSS3Bucket(vm, executable, globalObject, structure, ptr);
    functionObject->finishCreation(vm, executable, 1, "S3Bucket"_s);
    return functionObject;
}

JSC::Structure* JSS3Bucket::createStructure(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* prototype = JSS3BucketPrototype::create(vm, globalObject, JSS3BucketPrototype::createStructure(vm, globalObject, globalObject->functionPrototype()));
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::JSFunctionType, StructureFlags), info(), NonArray);
}

JSC_DEFINE_HOST_FUNCTION(functionS3Bucket_unlink, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(callframe->thisValue());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    return JSS3Bucket__unlink(thisObject->ptr, globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(functionS3Bucket_write, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(callframe->thisValue());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    return JSS3Bucket__write(thisObject->ptr, globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(functionS3Bucket_presign, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(callframe->thisValue());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    return JSS3Bucket__presign(thisObject->ptr, globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(functionS3Bucket_exists, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(callframe->thisValue());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    return JSS3Bucket__exists(thisObject->ptr, globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(functionS3Bucket_size, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(callframe->thisValue());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3Bucket instance"_s);
        return {};
    }

    return JSS3Bucket__size(thisObject->ptr, globalObject, callframe);
}

extern "C" {
SYSV_ABI void* BUN__getJSS3Bucket(JSC::EncodedJSValue value)
{
    JSValue thisValue = JSC::JSValue::decode(value);
    auto* thisObject = jsDynamicCast<JSS3Bucket*>(thisValue);
    return thisObject ? thisObject->ptr : nullptr;
};

BUN_DEFINE_HOST_FUNCTION(Bun__S3Constructor, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    void* ptr = JSS3Bucket__construct(globalObject, callframe);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(ptr);

    return JSValue::encode(JSS3Bucket::create(vm, defaultGlobalObject(globalObject), ptr));
}
}

Structure* createJSS3BucketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSS3Bucket::createStructure(globalObject);
}

const JSC::ClassInfo JSS3BucketPrototype::s_info = { "S3Bucket"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3BucketPrototype) };
const JSC::ClassInfo JSS3Bucket::s_info = { "S3Bucket"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3Bucket) };

} // namespace Bun
