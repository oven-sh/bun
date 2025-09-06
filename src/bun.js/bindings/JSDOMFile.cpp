#include "root.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSDOMFile.h"

using namespace JSC;

extern "C" SYSV_ABI void* JSDOMFile__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);

// External functions from generated Blob code
extern "C" JSC::EncodedJSValue BlobPrototype__getLastModified(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject);
extern "C" JSC::EncodedJSValue BlobPrototype__getName(void* ptr, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* lexicalGlobalObject);
extern "C" bool BlobPrototype__setName(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value);

// Custom getters for File.prototype.name and File.prototype.lastModified
// Named properly so desc.get?.name returns "get name" and "get lastModified"
static JSC_DECLARE_CUSTOM_GETTER(filePrototype_getName);
static JSC_DECLARE_CUSTOM_GETTER(filePrototype_getLastModified);

static JSC_DEFINE_CUSTOM_GETTER(filePrototype_getName, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue encodedThisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The getter function should only be called on JSBlob instances
    auto* thisObject = jsDynamicCast<WebCore::JSBlob*>(JSValue::decode(encodedThisValue));
    if (!thisObject) {
        throwTypeError(lexicalGlobalObject, scope, "The Blob.name getter can only be used on instances of Blob"_s);
        return {};
    }

    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);

    // Check cached value first
    if (JSValue cachedValue = thisObject->m_name.get())
        return JSValue::encode(cachedValue);

    // Get the value from native code
    JSC::JSValue result = JSC::JSValue::decode(
        BlobPrototype__getName(thisObject->wrapped(), encodedThisValue, globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    // Cache the result
    thisObject->m_name.set(vm, thisObject, result);
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

static JSC_DEFINE_CUSTOM_GETTER(filePrototype_getLastModified, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue encodedThisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<WebCore::JSBlob*>(JSValue::decode(encodedThisValue));
    if (!thisObject) {
        throwTypeError(lexicalGlobalObject, scope, "The Blob.lastModified getter can only be used on instances of Blob"_s);
        return {};
    }

    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);

    // lastModified is not cached, just call the getter
    JSC::EncodedJSValue result = BlobPrototype__getLastModified(thisObject->wrapped(), globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, result);
}

// JSDOMFilePrototype inherits from JSBlobPrototype
class JSDOMFilePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDOMFilePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDOMFilePrototype* prototype = new (NotNull, JSC::allocateCell<JSDOMFilePrototype>(vm)) JSDOMFilePrototype(vm, globalObject, structure);
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

protected:
    JSDOMFilePrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));

        // Set the toStringTag to "File"
        this->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsOwnedString(vm, "File"_s), 0);

        // Add name and lastModified getters as read-only properties
        // Both are read-only (no setter) to match Node.js File API
        this->putDirectCustomAccessor(vm, vm.propertyNames->name,
            JSC::CustomGetterSetter::create(vm, filePrototype_getName, nullptr),
            static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute));

        this->putDirectCustomAccessor(vm, Identifier::fromString(vm, "lastModified"_s),
            JSC::CustomGetterSetter::create(vm, filePrototype_getLastModified, nullptr),
            static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute));
    }
};

const JSC::ClassInfo JSDOMFilePrototype::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFilePrototype) };

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

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSDOMFilePrototype* prototype)
    {
        Base::finishCreation(vm, 2, "File"_s);

        // Set the prototype property to our custom prototype
        this->putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

        // Set the constructor property on the prototype
        prototype->putDirect(vm, vm.propertyNames->constructor, this, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
    }

    static JSDOMFile* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto* zigGlobal = defaultGlobalObject(globalObject);

        // Create JSDOMFilePrototype with JSBlobPrototype as its prototype
        auto* blobPrototype = zigGlobal->JSBlobPrototype();
        auto* prototypeStructure = JSDOMFilePrototype::createStructure(vm, globalObject, blobPrototype);
        auto* prototype = JSDOMFilePrototype::create(vm, globalObject, prototypeStructure);

        // Create JSDOMFile constructor
        auto structure = createStructure(vm, globalObject, zigGlobal->functionPrototype());
        auto* object = new (NotNull, JSC::allocateCell<JSDOMFile>(vm)) JSDOMFile(vm, structure);
        object->finishCreation(vm, globalObject, prototype);

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
        Structure* structure = globalObject->JSBlobStructure();
        if (constructor != newTarget) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(lexicalGlobalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, functionGlobalObject->JSBlobStructure());
            RETURN_IF_EXCEPTION(scope, {});
        }

        void* ptr = JSDOMFile__construct(lexicalGlobalObject, callFrame);

        if (!ptr) [[unlikely]] {
            return JSValue::encode(JSC::jsUndefined());
        }

        auto* fileInstance = WebCore::JSBlob::create(vm, globalObject, structure, ptr);

        // Set toStringTag to "File" on the instance since this is a File, not just a Blob
        fileInstance->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsOwnedString(vm, "File"_s), 0);

        return JSValue::encode(fileInstance);
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

}
