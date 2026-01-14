#include "root.h"

#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSObject.h>
#include "JSBunRequest.h"
#include "ZigGlobalObject.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include "JSFetchHeaders.h"
#include "JSCookieMap.h"
#include "Cookie.h"
#include "CookieMap.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include <bun-uws/src/App.h>

namespace Bun {

extern "C" SYSV_ABI JSC::EncodedJSValue Bun__JSRequest__createForBake(Zig::GlobalObject* globalObject, void* requestPtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* structure = globalObject->m_JSBunRequestStructure.get(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto* paramsPrototype = globalObject->m_JSBunRequestParamsPrototype.get(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // the params are passed into the page component as a prop so we'll make
    // this empty for now
    auto* emptyParams = JSC::constructEmptyObject(globalObject, paramsPrototype);
    RETURN_IF_EXCEPTION(scope, {});

    JSBunRequest* request
        = JSBunRequest::create(vm, structure, requestPtr, emptyParams);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(request);
}

static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetParams);
static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetCookies);

static JSC_DECLARE_HOST_FUNCTION(jsJSBunRequestClone);

extern "C" void Bun__JSRequest__calculateEstimatedByteSize(void* requestPtr);

static const HashTableValue JSBunRequestPrototypeValues[] = {
    { "params"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetParams, nullptr } },
    { "cookies"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetCookies, nullptr } },
    { "clone"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsJSBunRequestClone, 1 } }
};

JSBunRequest* JSBunRequest::create(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr, JSObject* params)
{
    // Do this **extremely** early, before we create the JSValue.
    // We do not want to risk the GC running before this function is called.
    Bun__JSRequest__calculateEstimatedByteSize(sinkPtr);

    JSBunRequest* ptr = new (NotNull, JSC::allocateCell<JSBunRequest>(vm)) JSBunRequest(vm, structure, sinkPtr, params);
    ptr->finishCreation(vm);
    return ptr;
}

JSC::Structure* JSBunRequest::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(0b11101110), StructureFlags), info());
}

JSC::GCClient::IsoSubspace* JSBunRequest::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBunRequest, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBunRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForBunRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBunRequest = std::forward<decltype(space)>(space); });
}

JSObject* JSBunRequest::params() const
{
    if (m_params) {
        return m_params.get();
    }
    return nullptr;
}

void JSBunRequest::setParams(JSObject* params)
{
    m_params.set(Base::vm(), this, params);
}

JSObject* JSBunRequest::cookies() const
{
    return m_cookies.get();
}

extern "C" void* Request__clone(void* internalZigRequestPointer, JSGlobalObject* globalObject);

JSBunRequest* JSBunRequest::clone(JSC::VM& vm, JSGlobalObject* globalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* structure = defaultGlobalObject(globalObject)->m_JSBunRequestStructure.getInitializedOnMainThread(globalObject);
    auto* raw = Request__clone(this->wrapped(), globalObject);
    EXCEPTION_ASSERT(!!raw == !throwScope.exception());
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    auto* clone = this->create(vm, structure, raw, nullptr);

    // Cookies and params are deep copied as they can be changed between the clone and original
    if (auto* params = this->params()) {
        // TODO: Use JSC's internal `cloneObject()` if/when it's exposed
        // https://github.com/oven-sh/WebKit/blob/c5e9b9e327194f520af2c28679adb0ea1fa902ad/Source/JavaScriptCore/runtime/JSGlobalObjectFunctions.cpp#L1018-L1099
        auto* prototype = defaultGlobalObject(globalObject)->m_JSBunRequestParamsPrototype.get(globalObject);
        auto* paramsClone = JSC::constructEmptyObject(globalObject, prototype);

        auto propertyNames = PropertyNameArrayBuilder(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        JSObject::getOwnPropertyNames(params, globalObject, propertyNames, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, nullptr);

        for (auto& property : propertyNames) {
            auto value = params->get(globalObject, property);
            RETURN_IF_EXCEPTION(throwScope, nullptr);
            paramsClone->putDirect(vm, property, value);
        }

        clone->setParams(paramsClone);
    }

    if (auto* cookiesObject = cookies()) {
        if (auto* wrapper = jsDynamicCast<JSCookieMap*>(cookiesObject)) {
            auto cookieMap = wrapper->protectedWrapped();
            auto cookieMapClone = cookieMap->clone();
            auto cookies = WebCore::toJSNewlyCreated(globalObject, jsCast<JSDOMGlobalObject*>(globalObject), WTF::move(cookieMapClone));
            clone->setCookies(cookies.getObject());
        }
    }

    RELEASE_AND_RETURN(throwScope, clone);
}

extern "C" void Request__setCookiesOnRequestContext(void* internalZigRequestPointer, CookieMap* cookieMap);

void JSBunRequest::setCookies(JSObject* cookies)
{
    m_cookies.set(Base::vm(), this, cookies);
    Request__setCookiesOnRequestContext(this->wrapped(), WebCoreCast<WebCore::JSCookieMap, WebCore::CookieMap>(JSValue::encode(cookies)));
}

JSBunRequest::JSBunRequest(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr, JSC::JSObject* params)
    : Base(vm, structure, sinkPtr)
    , m_params(params, JSC::WriteBarrierEarlyInit)
    , m_cookies(nullptr, JSC::WriteBarrierEarlyInit)
{
}
extern SYSV_ABI "C" size_t Request__estimatedSize(void* requestPtr);
extern "C" void Bun__JSRequest__calculateEstimatedByteSize(void* requestPtr);
void JSBunRequest::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);

    auto size = Request__estimatedSize(this->wrapped());
    vm.heap.reportExtraMemoryAllocated(this, size);
}

template<typename Visitor>
void JSBunRequest::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBunRequest* thisCallSite = jsCast<JSBunRequest*>(cell);
    Base::visitChildren(thisCallSite, visitor);
    visitor.append(thisCallSite->m_params);
    visitor.append(thisCallSite->m_cookies);
}

DEFINE_VISIT_CHILDREN(JSBunRequest);

class JSBunRequestPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static JSBunRequestPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        auto* ptr = new (NotNull, JSC::allocateCell<JSBunRequestPrototype>(vm)) JSBunRequestPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), NonArray);
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBunRequestPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSBunRequestPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSBunRequest::info(), JSBunRequestPrototypeValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const JSC::ClassInfo JSBunRequestPrototype::s_info = { "BunRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunRequestPrototype) };
const JSC::ClassInfo JSBunRequest::s_info = { "BunRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBunRequest) };

JSC_DEFINE_CUSTOM_GETTER(jsJSBunRequestGetParams, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBunRequest* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue));
    if (!request)
        return JSValue::encode(jsUndefined());

    auto* params = request->params();
    if (!params) {
        auto* prototype = defaultGlobalObject(globalObject)->m_JSBunRequestParamsPrototype.get(globalObject);
        params = JSC::constructEmptyObject(globalObject, prototype);
        request->setParams(params);
    }

    return JSValue::encode(params);
}

JSC_DEFINE_CUSTOM_GETTER(jsJSBunRequestGetCookies, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSBunRequest* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue));
    if (!request)
        return JSValue::encode(jsUndefined());

    auto* cookies = request->cookies();
    if (!cookies) {
        auto& vm = globalObject->vm();
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        auto& names = builtinNames(vm);
        JSC::JSValue headersValue = request->get(globalObject, names.headersPublicName());
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue);
        if (!headers) return JSValue::encode(jsUndefined());

        auto& fetchHeaders = headers->wrapped();

        auto cookieHeader = fetchHeaders.internalHeaders().get(HTTPHeaderName::Cookie);

        // Create a CookieMap from the cookie header
        auto cookieMapResult = WebCore::CookieMap::create(cookieHeader);
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        if (cookieMapResult.hasException()) {
            WebCore::propagateException(*globalObject, throwScope, cookieMapResult.releaseException());
            RELEASE_AND_RETURN(throwScope, {});
        }

        auto cookieMap = cookieMapResult.releaseReturnValue();

        // Convert to JS
        auto cookies = WebCore::toJSNewlyCreated(globalObject, jsCast<JSDOMGlobalObject*>(globalObject), WTF::move(cookieMap));
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        request->setCookies(cookies.getObject());
        return JSValue::encode(cookies);
    }

    return JSValue::encode(cookies);
}

JSC_DEFINE_HOST_FUNCTION(jsJSBunRequestClone, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    auto* request = jsDynamicCast<JSBunRequest*>(callFrame->thisValue());
    if (!request) {
        throwScope.throwException(globalObject, Bun::createInvalidThisError(globalObject, request, "BunRequest"));
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    auto clone = request->clone(vm, globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(clone);
}

Structure* createJSBunRequestStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    auto prototypeStructure = JSBunRequestPrototype::createStructure(vm, globalObject, globalObject->JSRequestPrototype());
    auto* prototype = JSBunRequestPrototype::create(vm, globalObject, prototypeStructure);
    return JSBunRequest::createStructure(vm, globalObject, prototype);
}

extern "C" EncodedJSValue Bun__getParamsIfBunRequest(JSC::EncodedJSValue thisValue)
{
    if (auto* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue))) {
        auto* params = request->params();
        if (!params) {
            return JSValue::encode(jsUndefined());
        }

        return JSValue::encode(params);
    }

    return {};
}

} // namespace Bun
