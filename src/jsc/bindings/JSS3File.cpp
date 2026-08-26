
#include "root.h"

#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"

#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/GetterSetter.h>
#include "JavaScriptCore/JSCJSValue.h"
#include "ErrorCode.h"

#include "JSS3File.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

// External C functions declarations
extern "C" {
SYSV_ABI EncodedJSValue JSS3File__presign(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3File__stat(void* ptr, JSC::JSGlobalObject*, JSC::CallFrame* callframe);
SYSV_ABI EncodedJSValue JSS3File__bucket(void* ptr, JSC::JSGlobalObject*);
}

// Forward declarations
JSC_DECLARE_HOST_FUNCTION(functionS3File_presign);
JSC_DECLARE_HOST_FUNCTION(functionS3File_stat);
static JSC_DECLARE_CUSTOM_GETTER(getterS3File_bucket);
static JSC_DEFINE_CUSTOM_GETTER(getterS3File_bucket, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSS3File>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3File instance"_s);
        return {};
    }

    return JSS3File__bucket(thisObject->wrapped(), globalObject);
}
static const HashTableValue JSS3FilePrototypeTableValues[] = {
    { "presign"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3File_presign, 1 } },
    { "stat"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionS3File_stat, 1 } },
    { "bucket"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor | PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, getterS3File_bucket, 0 } },
};
class JSS3FilePrototype final : public WebCore::JSBlobPrototype {
public:
    using Base = WebCore::JSBlobPrototype;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSS3FilePrototype* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure)
    {
        JSS3FilePrototype* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSS3FilePrototype))) JSS3FilePrototype(vm, globalObject, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSS3FilePrototype, Base);
        return &vm.plainObjectSpace();
    }

protected:
    JSS3FilePrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, globalObject, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm, globalObject);
        ASSERT(inherits(info()));
        Bun::reifyStaticPropertyTable(vm, JSS3File::info(), JSS3FilePrototypeTableValues, *this);

        this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsOwnedString(vm, "S3File"_s), 0);
    }
};

// Implementation of JSS3File methods
void JSS3File::destroy(JSCell* cell)
{
    static_cast<JSS3File*>(cell)->JSS3File::~JSS3File();
}

JSS3File::~JSS3File()
{
    // Base class destructor will be called automatically
}

JSS3File* JSS3File::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ptr)
{
    JSS3File* thisObject = new (NotNull, JSC::allocateCell<JSS3File>(vm)) JSS3File(vm, structure, ptr);
    thisObject->finishCreation(vm);
    return thisObject;
}

JSValue constructS3FileInternal(JSC::JSGlobalObject* lexicalGlobalObject, void* ptr)
{
    ASSERT(ptr);
    auto& vm = JSC::getVM(lexicalGlobalObject);

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* structure = globalObject->m_JSS3FileStructure.getInitializedOnMainThread(lexicalGlobalObject);
    return JSS3File::create(vm, globalObject, structure, ptr);
}

JSC::Structure* JSS3File::createStructure(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSObject* superPrototype = defaultGlobalObject(globalObject)->JSDOMFileStructure()->storedPrototypeObject();
    auto* protoStructure = JSS3FilePrototype::createStructure(vm, globalObject, superPrototype);
    auto* prototype = JSS3FilePrototype::create(vm, globalObject, protoStructure);
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), StructureFlags), info(), NonArray);
}

Structure* createJSS3FileStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSS3File::createStructure(globalObject);
}

JSC_DEFINE_HOST_FUNCTION(functionS3File_presign, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = dynamicDowncast<JSS3File>(callframe->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3File instance"_s);
        return {};
    }

    return JSS3File__presign(thisObject->wrapped(), globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(functionS3File_stat, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* thisObject = dynamicDowncast<JSS3File>(callframe->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a S3File instance"_s);
        return {};
    }
    return JSS3File__stat(thisObject->wrapped(), globalObject, callframe);
}

const JSC::ClassInfo JSS3FilePrototype::s_info = { "S3File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3FilePrototype) };
const JSC::ClassInfo JSS3File::s_info = { "S3File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3File) };

extern "C" {
SYSV_ABI EncodedJSValue BUN__createJSS3FileUnsafely(JSC::JSGlobalObject* globalObject, void* ptr)
{
    return JSValue::encode(constructS3FileInternal(globalObject, ptr));
};
}

}
