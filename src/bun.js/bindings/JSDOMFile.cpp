#include "root.h"
#include "ZigGeneratedClasses.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JSDOMFile.h"

using namespace JSC;

extern "C" void* JSDOMFile__construct(JSC::JSGlobalObject*, JSC::CallFrame* callframe);
extern "C" bool JSDOMFile__hasInstance(EncodedJSValue, JSC::JSGlobalObject*, EncodedJSValue);

// TODO: make this inehrit from JSBlob instead of InternalFunction
// That will let us remove this hack for [Symbol.hasInstance] and fix the prototype chain.
class JSDOMFile : public JSC::InternalFunction {
    using Base = JSC::InternalFunction;

public:
    JSDOMFile(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, nullptr, construct)
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
        auto* zigGlobal = reinterpret_cast<Zig::GlobalObject*>(globalObject);
        auto* object = new (NotNull, JSC::allocateCell<JSDOMFile>(vm)) JSDOMFile(vm, createStructure(vm, globalObject, zigGlobal->functionPrototype()));
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
        return JSDOMFile__hasInstance(JSValue::encode(object), globalObject, JSValue::encode(value));
    }

    static EncodedJSValue construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
    {
        Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
        JSC::VM& vm = globalObject->vm();
        JSObject* newTarget = asObject(callFrame->newTarget());
        auto* constructor = globalObject->JSDOMFileConstructor();
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

        void* ptr = JSDOMFile__construct(globalObject, callFrame);

        if (UNLIKELY(!ptr)) {
            return JSValue::encode(JSC::jsUndefined());
        }

        return JSValue::encode(
            WebCore::JSBlob::create(vm, globalObject, structure, ptr));
    }
};

const JSC::ClassInfo JSDOMFile::s_info = { "File"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMFile) };

namespace Bun {

JSC::JSObject* createJSDOMFileConstructor(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSDOMFile::create(vm, globalObject);
}

}