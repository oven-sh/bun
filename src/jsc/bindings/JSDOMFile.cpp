#include "root.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSDOMFile.h"

using namespace JSC;

extern "C" SYSV_ABI void* JSDOMFile__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);

namespace WebCore {
JSC_DECLARE_CUSTOM_GETTER(BlobPrototype__nameGetterWrap);
JSC_DECLARE_CUSTOM_GETTER(BlobPrototype__lastModifiedGetterWrap);
}

namespace Bun {

static const HashTableValue JSDOMFilePrototypeTableValues[] = {
    { "name"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, WebCore::BlobPrototype__nameGetterWrap, 0 } },
    { "lastModified"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, WebCore::BlobPrototype__lastModifiedGetterWrap, 0 } },
};

class JSDOMFilePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSDOMFilePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSDOMFilePrototype* prototype = new (NotNull, JSC::allocateCell<JSDOMFilePrototype>(vm)) JSDOMFilePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMFilePrototype, Base);
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
        reifyStaticProperties(vm, WebCore::JSBlob::info(), JSDOMFilePrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const JSC::ClassInfo JSDOMFilePrototype::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFilePrototype) };

class JSDOMFileConstructor final : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    JSDOMFileConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(InternalFunctionType, StructureFlags), info());
    }

    static JSDOMFileConstructor* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::JSObject* filePrototype)
    {
        auto* zigGlobal = defaultGlobalObject(globalObject);
        auto structure = createStructure(vm, globalObject, zigGlobal->JSBlobConstructor());
        auto* object = new (NotNull, JSC::allocateCell<JSDOMFileConstructor>(vm)) JSDOMFileConstructor(vm, structure);
        object->finishCreation(vm);

        object->putDirectWithoutTransition(vm, vm.propertyNames->prototype, filePrototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

        return object;
    }

    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
        auto& vm = JSC::getVM(globalObject);
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->JSDOMFileConstructor();
        Structure* structure = globalObject->JSDOMFileStructure();
        if (constructor != newTarget) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto* functionGlobalObject = static_cast<Zig::GlobalObject*>(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(lexicalGlobalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget, functionGlobalObject->JSDOMFileStructure());
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

private:
    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm, 2, "File"_s);
    }
};

const JSC::ClassInfo JSDOMFileConstructor::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFileConstructor) };

void setupJSDOMFileClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* zigGlobal = defaultGlobalObject(init.global);
    JSC::JSObject* blobPrototype = zigGlobal->JSBlobPrototype();
    auto* protoStructure = JSDOMFilePrototype::createStructure(init.vm, init.global, blobPrototype);
    auto* prototype = JSDOMFilePrototype::create(init.vm, init.global, protoStructure);
    auto* structure = WebCore::JSBlob::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSDOMFileConstructor::create(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

extern "C" SYSV_ABI EncodedJSValue BUN__createJSDOMFile(JSC::JSGlobalObject* lexicalGlobalObject, void* ptr)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto* structure = globalObject->JSDOMFileStructure();
    return JSValue::encode(WebCore::JSBlob::create(vm, globalObject, structure, ptr));
}

}
