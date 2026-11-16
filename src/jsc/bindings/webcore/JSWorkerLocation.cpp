#include "config.h"
#include "JSWorkerLocation.h"

#include "BunClientData.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "WebCoreJSClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocationPrototypeGetter_constructor);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_href);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_origin);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_protocol);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_host);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_hostname);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_port);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_pathname);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_search);
static JSC_DECLARE_CUSTOM_GETTER(jsWorkerLocation_hash);
static JSC_DECLARE_HOST_FUNCTION(jsWorkerLocationPrototypeFunction_toString);

class JSWorkerLocationPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSWorkerLocationPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWorkerLocationPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSWorkerLocationPrototype))) JSWorkerLocationPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWorkerLocationPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWorkerLocationPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWorkerLocationPrototype, JSWorkerLocationPrototype::Base);

// JSWorkerLocationConstructor = JSDOMConstructorNotConstructable<...>: construct and call both throw.

template<> JSValue JSWorkerLocationConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject);
template<> void JSWorkerLocationConstructor::initializeProperties(JSC::VM&, JSDOMGlobalObject&);

template<> const ClassInfo JSWorkerLocationConstructor::s_info = { "WorkerLocation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWorkerLocationConstructor) };

template<> JSValue JSWorkerLocationConstructor::prototypeForStructure(JSC::VM&, const JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

template<> void JSWorkerLocationConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    initializeBaseProperties(vm, 0, "WorkerLocation"_s, JSWorkerLocation::prototype(vm, globalObject));
}

// JSWorkerLocationPrototype

static const HashTableValue JSWorkerLocationPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocationPrototypeGetter_constructor, 0 } },
    { "href"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_href, 0 } },
    { "origin"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_origin, 0 } },
    { "protocol"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_protocol, 0 } },
    { "host"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_host, 0 } },
    { "hostname"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_hostname, 0 } },
    { "port"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_port, 0 } },
    { "pathname"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_pathname, 0 } },
    { "search"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_search, 0 } },
    { "hash"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWorkerLocation_hash, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWorkerLocationPrototypeFunction_toString, 0 } },
};

const ClassInfo JSWorkerLocationPrototype::s_info = { "WorkerLocation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWorkerLocationPrototype) };

void JSWorkerLocationPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSWorkerLocation::info(), JSWorkerLocationPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

// JSWorkerLocation

const ClassInfo JSWorkerLocation::s_info = { "WorkerLocation"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWorkerLocation) };

JSWorkerLocation::JSWorkerLocation(VM& vm, Structure* structure, URL&& url)
    : Base(vm, structure)
    , m_location(WTF::move(url))
{
}

void JSWorkerLocation::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWorkerLocation* JSWorkerLocation::create(VM& vm, JSDOMGlobalObject& globalObject, URL&& url)
{
    auto* structure = getDOMStructure<JSWorkerLocation>(vm, globalObject);
    auto* location = new (NotNull, allocateCell<JSWorkerLocation>(vm)) JSWorkerLocation(vm, structure, WTF::move(url));
    location->finishCreation(vm);
    return location;
}

Structure* JSWorkerLocation::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

JSObject* JSWorkerLocation::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSWorkerLocationPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSWorkerLocationPrototype::create(vm, &globalObject, structure);
}

JSObject* JSWorkerLocation::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSWorkerLocation>(vm, globalObject);
}

JSValue JSWorkerLocation::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSWorkerLocationConstructor, DOMConstructorID::WorkerLocation>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

GCClient::IsoSubspace* JSWorkerLocation::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSWorkerLocation, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForWorkerLocation, m_subspaceForWorkerLocation));
}

// Prototype host functions

JSC_DEFINE_CUSTOM_GETTER(jsWorkerLocationPrototypeGetter_constructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSWorkerLocationPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, scope);
    return JSValue::encode(JSWorkerLocation::getConstructor(vm, prototype->globalObject()));
}

// One getter per WorkerLocation attribute, each a WHATWG URL component of the entry.
#define DEFINE_WORKER_LOCATION_GETTER(name, expression)                                                                                    \
    JSC_DEFINE_CUSTOM_GETTER(jsWorkerLocation_##name, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName)) \
    {                                                                                                                                      \
        auto& vm = JSC::getVM(lexicalGlobalObject);                                                                                        \
        auto scope = DECLARE_THROW_SCOPE(vm);                                                                                              \
        auto* location = dynamicDowncast<JSWorkerLocation>(JSValue::decode(thisValue));                                                    \
        if (!location) [[unlikely]]                                                                                                        \
            return throwThisTypeError(*lexicalGlobalObject, scope, "WorkerLocation"_s, #name ""_s);                                        \
        const auto& impl = location->wrapped();                                                                                            \
        return JSValue::encode(jsString(vm, expression));                                                                                  \
    }

DEFINE_WORKER_LOCATION_GETTER(href, impl.url().string())
DEFINE_WORKER_LOCATION_GETTER(origin, impl.origin())
DEFINE_WORKER_LOCATION_GETTER(protocol, impl.protocol())
DEFINE_WORKER_LOCATION_GETTER(host, impl.host())
DEFINE_WORKER_LOCATION_GETTER(hostname, impl.hostname())
DEFINE_WORKER_LOCATION_GETTER(port, impl.port())
DEFINE_WORKER_LOCATION_GETTER(pathname, impl.pathname())
DEFINE_WORKER_LOCATION_GETTER(search, impl.search())
DEFINE_WORKER_LOCATION_GETTER(hash, impl.hash())

#undef DEFINE_WORKER_LOCATION_GETTER

// The stringifier: the same text as `href`.
JSC_DEFINE_HOST_FUNCTION(jsWorkerLocationPrototypeFunction_toString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* location = dynamicDowncast<JSWorkerLocation>(callFrame->thisValue());
    if (!location) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, scope, "WorkerLocation"_s, "toString"_s);
    return JSValue::encode(jsString(vm, location->wrapped().url().string()));
}

} // namespace WebCore
