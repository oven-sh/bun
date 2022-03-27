#include "root.h"

#include "JSDOMURL.h"
#include <JavaScriptCore/JSMicrotask.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace WebCore {
using namespace JSC;
using namespace Bun;
using JSGlobalObject = JSC::JSGlobalObject;
using JSValue = JSC::JSValue;
using JSString = JSC::JSString;
using JSModuleLoader = JSC::JSModuleLoader;
using JSModuleRecord = JSC::JSModuleRecord;
using Identifier = JSC::Identifier;
using SourceOrigin = JSC::SourceOrigin;
using JSObject = JSC::JSObject;
using JSNonFinalObject = JSC::JSNonFinalObject;
namespace JSCastingHelpers = JSC::JSCastingHelpers;

JSC_DEFINE_CUSTOM_GETTER(DOMURL__href_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(JSC::jsStringWithCache(vm, impl.href().string()));
}

JSC_DEFINE_CUSTOM_GETTER(DOMURL__protocol_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(JSC::jsStringWithCache(vm, impl.protocol()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__username_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.username()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__password_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.password()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__host_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.host()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__hostname_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.hostname()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__port_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.port()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__pathname_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.pathname()));
}
JSC_DEFINE_CUSTOM_GETTER(DOMURL__hash_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.hash()));
}

JSC_DEFINE_CUSTOM_GETTER(DOMURL__search_get, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(JSC::jsStringWithCache(vm, impl.search()));
}

JSC_DEFINE_CUSTOM_SETTER(DOMURL__protocol_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setProtocol(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__username_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();

    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setUsername(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}

JSC_DEFINE_CUSTOM_SETTER(DOMURL__href_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();

    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setHref(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}

JSC_DEFINE_CUSTOM_SETTER(DOMURL__password_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setPassword(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__host_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setHost(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__hostname_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setHostname(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__port_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setPort(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__pathname_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setPathname(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(DOMURL__hash_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setHash(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}

JSC_DEFINE_CUSTOM_SETTER(DOMURL__search_set,
    (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* thisObject = JSC::jsDynamicCast<JSDOMURL*>(lexicalGlobalObject->vm(), JSC::JSValue::decode(thisValue));
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject->wrapped();
    invokeFunctorPropagatingExceptionIfNecessary(lexicalGlobalObject, throwScope, [&] {
        return impl.setSearch(JSC::JSValue::decode(value).toWTFString(lexicalGlobalObject));
    });

    return true;
}

void JSDOMURL::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    auto clientData = Bun::clientData(vm);

    putDirectCustomAccessor(vm, clientData->builtinNames().protocolPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__protocol_get, DOMURL__protocol_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().usernamePublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__username_get, DOMURL__username_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().hrefPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__href_get, DOMURL__href_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().passwordPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__password_get, DOMURL__password_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().hostPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__host_get, DOMURL__host_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().hostnamePublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__hostname_get, DOMURL__hostname_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().portPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__port_get, DOMURL__port_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().pathnamePublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__pathname_get, DOMURL__pathname_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().hashPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__hash_get, DOMURL__hash_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));

    putDirectCustomAccessor(vm, clientData->builtinNames().searchPublicName(),
        JSC::CustomGetterSetter::create(vm, DOMURL__search_get, DOMURL__search_set),
        static_cast<unsigned>(JSC::PropertyAttribute::CustomValue));
}

JSC::GCClient::IsoSubspace* JSDOMURL::subspaceForImpl(JSC::VM& vm)
{
    return Bun::subspaceForImpl<JSDOMURL, UseCustomHeapCellType::No>(
        vm,
        // this is a placeholder
        [](auto& spaces) { return spaces.m_clientSubspaceForExposedToWorkerAndWindow.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForExposedToWorkerAndWindow = WTFMove(space); },
        [](auto& spaces) { return spaces.m_subspaceForExposedToWorkerAndWindow.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForExposedToWorkerAndWindow = WTFMove(space); });
}

const ClassInfo JSDOMURL::s_info = { "JSDOMURL", &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDOMURL) };

}
