#include "root.h"
#include "napi.h"
#include <wtf/TZoneMallocInlines.h>

namespace Zig {

template<typename Visitor>
void NapiClass::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NapiClass* thisObject = uncheckedDowncast<NapiClass>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(NapiClass);

template<bool ConstructCall>
JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue NapiClass_ConstructorFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* constructorTarget = asObject(callFrame->jsCallee());
    NapiClass* napi = dynamicDowncast<NapiClass>(constructorTarget);
    while (!napi && constructorTarget) {
        constructorTarget = constructorTarget->getPrototypeDirect().getObject();
        napi = dynamicDowncast<NapiClass>(constructorTarget);
    }

    if (!napi) [[unlikely]] {
        JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor called on an object that is not a NapiClass"_s));
        return JSValue::encode(JSC::jsUndefined());
    }

    JSValue newTarget;

    if constexpr (ConstructCall) {
        // Use ::get instead of ::getIfPropertyExists here so that DontEnum is ignored.
        auto prototypeValue = napi->get(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, {});
        NapiPrototype* prototype = dynamicDowncast<NapiPrototype>(prototypeValue);

        if (!prototype) {
            JSC::throwVMError(globalObject, scope, JSC::createTypeError(globalObject, "NapiClass constructor is missing the prototype"_s));
            return JSValue::encode(JSC::jsUndefined());
        }

        newTarget = callFrame->newTarget();
        JSObject* thisValue;
        // Match the behavior from
        // https://github.com/oven-sh/WebKit/blob/397dafc9721b8f8046f9448abb6dbc14efe096d3/Source/JavaScriptCore/runtime/ObjectConstructor.cpp#L118-L145
        if (newTarget && newTarget != napi) {
            JSGlobalObject* functionGlobalObject = getFunctionRealm(globalObject, asObject(newTarget));
            RETURN_IF_EXCEPTION(scope, {});
            Structure* baseStructure = functionGlobalObject->objectStructureForObjectConstructor();
            Structure* objectStructure = InternalFunction::createSubclassStructure(globalObject, asObject(newTarget), baseStructure);
            RETURN_IF_EXCEPTION(scope, {});
            thisValue = constructEmptyObject(vm, objectStructure);
        } else {
            thisValue = prototype->subclass(globalObject, asObject(newTarget));
        }
        RETURN_IF_EXCEPTION(scope, {});
        callFrame->setThisValue(thisValue);
    }

    NAPICallFrame frame(globalObject, callFrame, napi->dataPtr(), newTarget);
    Bun::NapiHandleScope handleScope(uncheckedDowncast<Zig::GlobalObject>(globalObject));

    JSValue ret = toJS(napi->constructor()(napi->env(), frame.toNapi()));
    napi_set_last_error(napi->env(), napi_ok);
    if (napi->env()->throwPendingException()) {
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});
    if (ret.isEmpty()) {
        ret = jsUndefined();
    }
    if constexpr (ConstructCall) {
        RELEASE_AND_RETURN(scope, JSValue::encode(frame.thisValue()));
    } else {
        RELEASE_AND_RETURN(scope, JSValue::encode(ret));
    }
}

NapiClass* NapiClass::create(VM& vm, napi_env env, WTF::String name,
    napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties,
    napi_status* propertyStatus)
{
    NativeExecutable* executable = vm.getHostFunction(
        // for normal call
        NapiClass_ConstructorFunction<false>,
        ImplementationVisibility::Public,
        // for constructor call
        NapiClass_ConstructorFunction<true>, 0, name);
    Structure* structure = env->globalObject()->NapiClassStructure();
    NapiClass* napiClass = new (NotNull, allocateCell<NapiClass>(vm)) NapiClass(vm, executable, env, structure, data);
    napi_status status = napiClass->finishCreation(vm, name, constructor, data, property_count, properties);
    if (propertyStatus) {
        *propertyStatus = status;
    }
    return napiClass;
}

napi_status NapiClass::finishCreation(VM& vm, const String& name, napi_callback constructor,
    void* data,
    size_t property_count,
    const napi_property_descriptor* properties)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    this->m_constructor = constructor;
    auto globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());

    this->putDirect(vm, vm.propertyNames->name, jsString(vm, name), JSC::PropertyAttribute::DontEnum | 0);

    NapiPrototype* prototype = NapiPrototype::create(vm, globalObject->NapiPrototypeStructure());

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto env = m_env;
    napi_status result = napi_ok;

    for (size_t i = 0; i < property_count; i++) {
        const napi_property_descriptor& property = properties[i];

        JSC::JSObject* target = (property.attributes & napi_static) ? static_cast<JSC::JSObject*>(this) : prototype;
        napi_status status = Napi::defineProperty(env, target, property, throwScope);

        if (throwScope.exception()) {
            result = napi_pending_exception;
            break;
        }
        if (status != napi_ok) {
            result = status;
            break;
        }
    }

    this->putDirect(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | 0);
    prototype->putDirect(vm, vm.propertyNames->constructor, this, JSC::PropertyAttribute::DontEnum | 0);
    return result;
}

const ClassInfo NapiClass::s_info = { "Function"_s, &NapiClass::Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiClass) };
const ClassInfo NapiPrototype::s_info = { "Object"_s, &NapiPrototype::Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiPrototype) };
}
