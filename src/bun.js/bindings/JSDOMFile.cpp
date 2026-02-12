#include "root.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSDOMFile.h"
#include "ErrorCode.h"

using namespace JSC;

extern "C" SYSV_ABI void* JSDOMFile__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);
extern "C" SYSV_ABI EncodedJSValue BlobPrototype__getName(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject);
extern "C" SYSV_ABI bool BlobPrototype__setName(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value);
extern "C" SYSV_ABI EncodedJSValue BlobPrototype__getLastModified(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject);

static JSC_DECLARE_CUSTOM_GETTER(getterDOMFile_name);
static JSC_DECLARE_CUSTOM_SETTER(setterDOMFile_name);
static JSC_DECLARE_CUSTOM_GETTER(getterDOMFile_lastModified);

static JSC_DEFINE_CUSTOM_GETTER(getterDOMFile_name, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<WebCore::JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a File instance"_s);
        return {};
    }

    return BlobPrototype__getName(thisObject->wrapped(), thisValue, globalObject);
}

static JSC_DEFINE_CUSTOM_SETTER(setterDOMFile_name, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<WebCore::JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a File instance"_s);
        return false;
    }

    return BlobPrototype__setName(thisObject->wrapped(), thisValue, globalObject, value);
}

static JSC_DEFINE_CUSTOM_GETTER(getterDOMFile_lastModified, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<WebCore::JSBlob*>(JSValue::decode(thisValue));
    if (!thisObject) {
        Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_INVALID_THIS, "Expected a File instance"_s);
        return {};
    }

    return BlobPrototype__getLastModified(thisObject->wrapped(), globalObject);
}

static const HashTableValue JSDOMFilePrototypeTableValues[] = {
    { "lastModified"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterDOMFile_lastModified, 0 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterDOMFile_name, setterDOMFile_name } },
};

class JSDOMFilePrototype final : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;
public:
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDOMFilePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDOMFilePrototype* prototype = new (NotNull, JSC::allocateCell<JSDOMFilePrototype>(vm)) JSDOMFilePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

private:
    JSDOMFilePrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
        reifyStaticProperties(vm, info(), JSDOMFilePrototypeTableValues, *this);
        this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsOwnedString(vm, "File"_s), 0);
    }
};

const JSC::ClassInfo JSDOMFilePrototype::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFilePrototype) };

// TODO: make this inherit from JSBlob instead of InternalFunction
// That will let us remove this hack for [Symbol.hasInstance] and fix the prototype chain.
class JSDOMFile : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    JSDOMFile(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = (Base::StructureFlags & ~ImplementsDefaultHasInstance) | ImplementsHasInstance;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(InternalFunctionType, StructureFlags), info());
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm, 2, "File"_s);
    }

    static JSDOMFile* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto* zigGlobal = defaultGlobalObject(globalObject);
        auto structure = createStructure(vm, globalObject, zigGlobal->functionPrototype());
        auto* object = new (NotNull, JSC::allocateCell<JSDOMFile>(vm)) JSDOMFile(vm, structure);
        object->finishCreation(vm);

        // Create a proper File prototype that extends Blob.prototype
        auto* blobPrototype = zigGlobal->JSBlobPrototype();
        auto* protoStructure = JSDOMFilePrototype::createStructure(vm, globalObject, blobPrototype);
        auto* filePrototype = JSDOMFilePrototype::create(vm, globalObject, protoStructure);

        object->putDirect(vm, vm.propertyNames->prototype, filePrototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);
        filePrototype->putDirect(vm, vm.propertyNames->constructor, object, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));

        return object;
    }

    static bool customHasInstance(JSObject* object, JSGlobalObject* globalObject, JSValue value)
    {
        if (!value.isObject())
            return false;

        // Note: this breaks [Symbol.hasInstance]
        // We must do this for now until we update the code generator to export classes
        return JSDOMFile__hasInstance(JSValue::encode(object), globalObject, JSValue::encode(value));
    }

    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& vm = JSC::getVM(globalObject);
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->JSDOMFileConstructor();
        Structure* structure = globalObject->m_JSDOMFileStructure.getInitializedOnMainThread(lexicalGlobalObject);
        if (constructor != newTarget) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto* functionGlobalObject = static_cast<Zig::GlobalObject*>(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(lexicalGlobalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, functionGlobalObject->m_JSDOMFileStructure.getInitializedOnMainThread(lexicalGlobalObject));
            RETURN_IF_EXCEPTION(scope, {});
        }

        void* ptr = JSDOMFile__construct(lexicalGlobalObject, callFrame);

        if (!ptr) [[unlikely]] {
            return JSValue::encode(JSC::jsUndefined());
        }

        return JSValue::encode(
            WebCore::JSBlob::create(vm, globalObject, structure, ptr));
    }

    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue call(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
        throwTypeError(lexicalGlobalObject, scope, "Class constructor File cannot be invoked without 'new'"_s);
        return {};
    }
};

const JSC::ClassInfo JSDOMFile::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFile) };

namespace Bun {

JSC::JSObject* createJSDOMFileConstructor(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSDOMFile::create(vm, globalObject);
}

JSC::Structure* createJSDOMFileInstanceStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    // Get the File.prototype from the constructor
    auto* fileConstructor = zigGlobal->JSDOMFileConstructor();
    JSValue filePrototype = fileConstructor->getDirect(vm, vm.propertyNames->prototype);
    ASSERT(filePrototype.isObject());
    // Create a JSBlob structure that uses File.prototype instead of Blob.prototype
    return JSC::Structure::create(vm, globalObject, filePrototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), WebCore::JSBlob::StructureFlags), WebCore::JSBlob::info(), JSC::NonArray);
}

}
