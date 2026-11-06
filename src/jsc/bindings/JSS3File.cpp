
#include "root.h"

#include "ZigGlobalObject.h"

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
SYSV_ABI EncodedJSValue JSS3File__presign(void* ptr, JSC::JSGlobalObject*, EncodedJSValue options);
SYSV_ABI EncodedJSValue JSS3File__stat(void* ptr, JSC::JSGlobalObject*);
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

JSS3File* JSS3File::create(JSC::VM& vm, JSC::Structure* structure, void* ptr)
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
    return JSS3File::create(vm, structure, ptr);
}

JSC::Structure* JSS3File::createStructure(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSObject* superPrototype = Bun::Bindgen::prototypeForClass<Base>(globalObject);
    auto* prototype = Bun::Bindgen::createClassPrototype(vm, globalObject, superPrototype, info(), JSS3FilePrototypeTableValues);
    Bun::putToStringTagWithoutTransition(vm, prototype, info());
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(WebCore::JSDOMWrapperType), StructureFlags), info(), NonArray);
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

    // `presign(undefined)` signs with the `acl` and `storageClass` of the store, `presign()` without.
    return JSS3File__presign(thisObject->wrapped(), globalObject, JSValue::encode(callframe->argumentCount() ? callframe->uncheckedArgument(0) : JSValue()));
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
    return JSS3File__stat(thisObject->wrapped(), globalObject);
}

const JSC::ClassInfo JSS3File::s_info = { "S3File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3File) };

extern "C" {
SYSV_ABI EncodedJSValue BUN__createJSS3FileUnsafely(JSC::JSGlobalObject* globalObject, void* ptr)
{
    return JSValue::encode(constructS3FileInternal(globalObject, ptr));
};
}

}
