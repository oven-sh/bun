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
#include "JSDOMExceptionHandling.h"
#include <bun-uws/src/App.h>
#include "JSURLSearchParams.h"
#include "URLSearchParams.h"
#include <wtf/URLParser.h>
namespace Bun {

extern "C" uWS::HttpRequest* Request__getUWSRequest(JSBunRequest*);

static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetParams);
static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetCookies);
static JSC_DECLARE_CUSTOM_GETTER(jsJSBunRequestGetQuery);

static const HashTableValue JSBunRequestPrototypeValues[] = {
    { "searchParams"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetQuery, nullptr } },
    { "params"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetParams, nullptr } },
    { "cookies"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsJSBunRequestGetCookies, nullptr } },
};

JSBunRequest* JSBunRequest::create(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr, JSObject* params)
{
    JSBunRequest* ptr = new (NotNull, JSC::allocateCell<JSBunRequest>(vm)) JSBunRequest(vm, structure, sinkPtr);
    ptr->finishCreation(vm, params);
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
    if (m_cookies) {
        return m_cookies.get();
    }
    return nullptr;
}

JSObject* JSBunRequest::query() const
{
    if (m_query) {
        return m_query.get();
    }
    return nullptr;
}

void JSBunRequest::setQuery(JSObject* query)
{
    m_query.set(Base::vm(), this, query);
}

extern "C" void Request__setCookiesOnRequestContext(void* internalZigRequestPointer, CookieMap* cookieMap);

void JSBunRequest::setCookies(JSObject* cookies)
{
    m_cookies.set(Base::vm(), this, cookies);
    Request__setCookiesOnRequestContext(this->wrapped(), WebCoreCast<WebCore::JSCookieMap, WebCore::CookieMap>(JSValue::encode(cookies)));
}

JSBunRequest::JSBunRequest(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)
    : Base(vm, structure, sinkPtr)
{
}
extern "C" size_t Request__estimatedSize(void* requestPtr);
extern "C" void Bun__JSRequest__calculateEstimatedByteSize(void* requestPtr);
void JSBunRequest::finishCreation(JSC::VM& vm, JSObject* params)
{
    Base::finishCreation(vm);
    m_params.setMayBeNull(vm, this, params);
    m_cookies.clear();
    m_query.clear();
    Bun__JSRequest__calculateEstimatedByteSize(this->wrapped());

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
    visitor.append(thisCallSite->m_query);
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

static JSValue createQueryObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSBunRequest* request)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* uws = Request__getUWSRequest(request);
    auto* global = defaultGlobalObject(globalObject);

    // First, try to get it from uWS::HttpRequest
    if (uws) {
        auto query = uws->getQuery();
        auto span = std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(query.data()), query.size());
        // This should always be URL-encoded
        WTF::String queryString = WTF::String::fromUTF8ReplacingInvalidSequences(span);
        auto searchParams = WebCore::URLSearchParams::create(queryString, nullptr);
        return WebCore::toJSNewlyCreated(global, global, WTFMove(searchParams));
    }

    // Otherwise, get it by reading the url property.
    auto& names = builtinNames(vm);
    auto url = request->get(globalObject, names.urlPublicName());
    RETURN_IF_EXCEPTION(scope, {});

    auto* urlString = url.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = urlString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Figure out where the query string is
    const auto findQustionMark = view->find('?');
    WTF::StringView queryView;

    if (findQustionMark != WTF::notFound) {
        queryView = view->substring(findQustionMark + 1, view->length() - findQustionMark - 1);
    }

    // Parse the query string
    auto searchParams = queryView.length() > 0 ? WebCore::URLSearchParams::create(WTF::URLParser::parseURLEncodedForm(queryView)) : WebCore::URLSearchParams::create({});

    // If for any reason that failed, throw an error
    if (searchParams.hasException()) [[unlikely]] {
        WebCore::propagateException(*globalObject, scope, searchParams.releaseException());
        return {};
    }

    return WebCore::toJSNewlyCreated(global, global, searchParams.releaseReturnValue());
}

JSC_DEFINE_CUSTOM_GETTER(jsJSBunRequestGetQuery, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{

    JSBunRequest* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue));
    if (!request)
        return JSValue::encode(jsUndefined());

    if (auto* query = request->query()) {
        return JSValue::encode(query);
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto result = createQueryObject(vm, globalObject, request);
    RETURN_IF_EXCEPTION(scope, {});
    request->setQuery(result.getObject());
    return JSValue::encode(result);
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
        if (!headers)
            return JSValue::encode(jsUndefined());

        auto& fetchHeaders = headers->wrapped();

        auto cookieHeader = fetchHeaders.internalHeaders().get(HTTPHeaderName::Cookie);

        // Create a CookieMap from the cookie header
        auto cookieMapResult = WebCore::CookieMap::create(cookieHeader);
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        if (cookieMapResult.hasException()) {
            WebCore::propagateException(*globalObject, throwScope, cookieMapResult.releaseException());
            return JSValue::encode(jsUndefined());
        }

        auto cookieMap = cookieMapResult.releaseReturnValue();

        // Convert to JS
        auto cookies = WebCore::toJSNewlyCreated(globalObject, jsCast<JSDOMGlobalObject*>(globalObject), WTFMove(cookieMap));
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        request->setCookies(cookies.getObject());
        return JSValue::encode(cookies);
    }

    return JSValue::encode(cookies);
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

    return JSValue::encode({});
}

extern "C" EncodedJSValue Bun__getQueryIfBunRequest(JSC::EncodedJSValue thisValue)
{
    if (auto* request = jsDynamicCast<JSBunRequest*>(JSValue::decode(thisValue))) {
        if (auto* query = request->query()) {
            return JSValue::encode(query);
        }

        auto* globalObject = request->globalObject();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto result = createQueryObject(vm, globalObject, request);
        RETURN_IF_EXCEPTION(scope, encodedJSValue());
        request->setQuery(result.getObject());
        return JSValue::encode(result);
    }

    return JSValue::encode(jsUndefined());
}

} // namespace Bun
