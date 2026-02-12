
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
#include <JavaScriptCore/JSFunction.h>
#include "JavaScriptCore/JSCJSValue.h"
#include "ErrorCode.h"

#include "JSBunFile.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

// Reuse existing Blob extern functions for BunFile-specific methods
extern "C" {
SYSV_ABI EncodedJSValue BlobPrototype__getExists(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
SYSV_ABI EncodedJSValue BlobPrototype__doUnlink(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
SYSV_ABI EncodedJSValue BlobPrototype__doWrite(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
SYSV_ABI EncodedJSValue BlobPrototype__getStat(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
SYSV_ABI EncodedJSValue BlobPrototype__getWriter(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
SYSV_ABI EncodedJSValue BlobPrototype__getName(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject);
SYSV_ABI bool BlobPrototype__setName(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value);
SYSV_ABI EncodedJSValue BlobPrototype__getLastModified(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject);
SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);
}

// BunFile constructor - throws when called directly, exists for constructor.name
JSC_DECLARE_HOST_FUNCTION(callBunFileConstructor);
JSC_DEFINE_HOST_FUNCTION(callBunFileConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwTypeError(globalObject, scope, "BunFile is not constructable. Use Bun.file() to create a BunFile."_s);
    return {};
}

// Forward declarations for host functions
JSC_DECLARE_HOST_FUNCTION(functionBunFile_exists);
JSC_DECLARE_HOST_FUNCTION(functionBunFile_unlink);
JSC_DECLARE_HOST_FUNCTION(functionBunFile_write);
JSC_DECLARE_HOST_FUNCTION(functionBunFile_stat);
JSC_DECLARE_HOST_FUNCTION(functionBunFile_writer);
static JSC_DECLARE_CUSTOM_GETTER(getterBunFile_name);
static JSC_DECLARE_CUSTOM_SETTER(setterBunFile_name);
static JSC_DECLARE_CUSTOM_GETTER(getterBunFile_lastModified);

// --- Host function implementations ---

JSC_DEFINE_HOST_FUNCTION(functionBunFile_exists, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSBlob*>(callFrame->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }
    return BlobPrototype__getExists(thisObject->wrapped(), globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(functionBunFile_unlink, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSBlob*>(callFrame->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }
    return BlobPrototype__doUnlink(thisObject->wrapped(), globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(functionBunFile_write, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSBlob*>(callFrame->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }
    return BlobPrototype__doWrite(thisObject->wrapped(), globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(functionBunFile_stat, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSBlob*>(callFrame->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }
    return BlobPrototype__getStat(thisObject->wrapped(), globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(functionBunFile_writer, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSBlob*>(callFrame->thisValue());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }
    return BlobPrototype__getWriter(thisObject->wrapped(), globalObject, callFrame);
}

static JSC_DEFINE_CUSTOM_GETTER(getterBunFile_name, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }

    return BlobPrototype__getName(thisObject->wrapped(), thisValue, globalObject);
}

static JSC_DEFINE_CUSTOM_SETTER(setterBunFile_name, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return false;
    }

    return BlobPrototype__setName(thisObject->wrapped(), thisValue, globalObject, value);
}

static JSC_DEFINE_CUSTOM_GETTER(getterBunFile_lastModified, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a BunFile instance"_s);
        return {};
    }

    return BlobPrototype__getLastModified(thisObject->wrapped(), globalObject);
}

// --- BunFile-specific prototype property table ---
static const HashTableValue JSBunFilePrototypeTableValues[] = {
    { "delete"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_unlink, 0 } },
    { "exists"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_exists, 0 } },
    { "lastModified"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterBunFile_lastModified, 0 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterBunFile_name, setterBunFile_name } },
    { "stat"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_stat, 0 } },
    { "unlink"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_unlink, 0 } },
    { "write"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_write, 2 } },
    { "writer"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, functionBunFile_writer, 1 } },
};

class JSBunFilePrototype final : public WebCore::JSBlobPrototype {
public:
    using Base = WebCore::JSBlobPrototype;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSBunFilePrototype* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure)
    {
        JSBunFilePrototype* prototype = new (NotNull, JSC::allocateCell<JSBunFilePrototype>(vm)) JSBunFilePrototype(vm, globalObject, structure);
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
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBunFilePrototype, Base);
        return &vm.plainObjectSpace();
    }

protected:
    JSBunFilePrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, globalObject, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm, globalObject);
        ASSERT(inherits(info()));
        reifyStaticProperties(vm, JSBunFile::info(), JSBunFilePrototypeTableValues, *this);

        this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsOwnedString(vm, "BunFile"_s), 0);
    }
};

// Implementation of JSBunFile methods
void JSBunFile::destroy(JSCell* cell)
{
    static_cast<JSBunFile*>(cell)->JSBunFile::~JSBunFile();
}

JSBunFile::~JSBunFile()
{
    // Base class destructor will be called automatically
}

JSBunFile* JSBunFile::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ptr)
{
    JSBunFile* thisObject = new (NotNull, JSC::allocateCell<JSBunFile>(vm)) JSBunFile(vm, structure, ptr);
    thisObject->finishCreation(vm);
    return thisObject;
}

JSC::Structure* JSBunFile::createStructure(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSObject* superPrototype = defaultGlobalObject(globalObject)->JSBlobPrototype();
    auto* protoStructure = JSBunFilePrototype::createStructure(vm, globalObject, superPrototype);
    auto* prototype = JSBunFilePrototype::create(vm, globalObject, protoStructure);

    // Create a constructor function named "BunFile" for constructor.name
    auto* constructor = JSFunction::create(vm, globalObject, 0, "BunFile"_s, callBunFileConstructor, ImplementationVisibility::Public, NoIntrinsic, callBunFileConstructor);
    constructor->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));

    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), StructureFlags), info(), NonArray);
}

Structure* createJSBunFileStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSBunFile::createStructure(globalObject);
}

const JSC::ClassInfo JSBunFilePrototype::s_info = { "BunFile"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunFilePrototype) };
const JSC::ClassInfo JSBunFile::s_info = { "BunFile"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunFile) };

extern "C" {
SYSV_ABI EncodedJSValue BUN__createJSBunFileUnsafely(JSC::JSGlobalObject* globalObject, void* ptr)
{
    ASSERT(ptr);
    auto& vm = JSC::getVM(globalObject);

    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* structure = zigGlobal->m_JSBunFileStructure.getInitializedOnMainThread(globalObject);
    return JSValue::encode(JSBunFile::create(vm, globalObject, structure, ptr));
}
}

}
