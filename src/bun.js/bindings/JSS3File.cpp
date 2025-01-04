#include "root.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSS3File.h"
#include "JavaScriptCore/JSCJSValue.h"

using namespace JSC;

extern "C" SYSV_ABI void* JSS3File__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
extern "C" SYSV_ABI bool JSS3File__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);

extern "C" {

JSC::EncodedJSValue BUN__createJSS3FileConstructor(JSGlobalObject* lexicalGlobalObject)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    return JSValue::encode(globalObject->JSS3FileConstructor());
}
}

// TODO: make this inehrit from JSBlob instead of InternalFunction
// That will let us remove this hack for [Symbol.hasInstance] and fix the prototype chain.
class JSS3File : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    JSS3File(JSC::VM& vm, JSC::Structure* structure)
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
        Base::finishCreation(vm, 2, "S3"_s);
    }

    static JSS3File* create(JSC::VM& vm, JSGlobalObject* globalObject)
    {
        auto* zigGlobal = reinterpret_cast<Zig::GlobalObject*>(globalObject);
        auto structure = createStructure(vm, globalObject, zigGlobal->functionPrototype());
        auto* object = new (NotNull, JSC::allocateCell<JSS3File>(vm)) JSS3File(vm, structure);
        object->finishCreation(vm);

        // This is not quite right. But we'll fix it if someone files an issue about it.
        object->putDirect(vm, vm.propertyNames->prototype, zigGlobal->JSBlobPrototype(), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | 0);

        return object;
    }

    static bool customHasInstance(JSObject* object, JSGlobalObject* globalObject, JSValue value)
    {
        if (!value.isObject())
            return false;

        // Note: this breaks [Symbol.hasInstance]
        // We must do this for now until we update the code generator to export classes
        return JSS3File__hasInstance(JSValue::encode(object), globalObject, JSValue::encode(value));
    }

    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->JSS3FileConstructor();

        Structure* structure = globalObject->JSBlobStructure();
        if (constructor != newTarget) {
            auto scope = DECLARE_THROW_SCOPE(vm);

            auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
                // ShadowRealm functions belong to a different global object.
                getFunctionRealm(globalObject, newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            structure = InternalFunction::createSubclassStructure(
                globalObject,
                newTarget,
                functionGlobalObject->JSBlobStructure());
        }

        void* ptr = JSS3File__construct(globalObject, callFrame);

        if (UNLIKELY(!ptr)) {
            return JSValue::encode(JSC::jsUndefined());
        }

        return JSValue::encode(
            WebCore::JSBlob::create(vm, globalObject, structure, ptr));
    }

    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue call(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        auto scope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
        throwTypeError(lexicalGlobalObject, scope, "Class constructor S3 cannot be invoked without 'new'"_s);
        return {};
    }
};

const JSC::ClassInfo JSS3File::s_info = { "S3"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSS3File) };

namespace Bun {

JSC::JSObject* createJSS3FileConstructor(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSS3File::create(vm, globalObject);
}

}
