#include "root.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ProxyObject.h>
#include "JSDOMFile.h"

using namespace JSC;

extern "C" SYSV_ABI void* JSDOMFile__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);

// TODO: make this inehrit from JSBlob instead of InternalFunction
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

        // This is not quite right. But we'll fix it if someone files an issue about it.
        object->putDirect(vm, vm.propertyNames->prototype, zigGlobal->JSBlobPrototype(), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

        return object;
    }

    static bool customHasInstance(JSObject* object, JSGlobalObject* globalObject, JSValue value)
    {
        if (!value.isObject())
            return false;

        if (JSDOMFile__hasInstance(JSValue::encode(object), globalObject, JSValue::encode(value)))
            return true;

        // A direct Blob instance must not match `instanceof File` even though
        // the default prototype-chain check below would say true (File.prototype
        // is currently the same object as Blob.prototype). Real Files are caught
        // above via JSDOMFile__hasInstance. Unwrap proxies so a proxy wrapping a
        // Blob is also rejected — without this, defaultHasInstance would forward
        // through the proxy's [[GetPrototypeOf]] back to Blob.prototype and (due
        // to the prototype aliasing) declare it `instanceof File`.
        JSObject* unwrapped = asObject(value);
        while (auto* proxy = dynamicDowncast<ProxyObject>(unwrapped)) {
            unwrapped = proxy->target();
            if (!unwrapped)
                break;
        }
        if (unwrapped && unwrapped->inherits<WebCore::JSBlob>())
            return false;

        // Fall back to the standard OrdinaryHasInstance check so proxies whose
        // getPrototypeOf trap returns File.prototype, or ordinary objects with
        // File.prototype in their chain, still satisfy `instanceof File`.
        // See https://github.com/oven-sh/bun/issues/25422.
        auto& vm = JSC::getVM(globalObject);
        JSValue prototype = object->getDirect(vm, vm.propertyNames->prototype);
        return JSObject::defaultHasInstance(globalObject, value, prototype);
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

            auto* functionGlobalObject = static_cast<Zig::GlobalObject*>(
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

}
