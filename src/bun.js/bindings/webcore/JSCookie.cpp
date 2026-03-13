#include "config.h"
#include "JSCookie.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "ErrorCode.h"
#include "IDLTypes.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <JavaScriptCore/DateInstance.h>
#include "HTTPParsers.h"
namespace WebCore {

using namespace JSC;

// Helper for getting wrapped Cookie from JS value
static Cookie* toCookieWrapped(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& throwScope, JSValue value)
{
    auto& vm = getVM(lexicalGlobalObject);
    auto* impl = JSCookie::toWrapped(vm, value);
    if (!impl) [[unlikely]]
        throwVMTypeError(lexicalGlobalObject, throwScope);
    return impl;
}

static int64_t getExpiresValue(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& throwScope, JSValue expiresValue)
{
    if (expiresValue.isUndefined() || expiresValue.isNull()) {
        return Cookie::emptyExpiresAtValue;
    }

    if (auto* dateInstance = jsDynamicCast<JSC::DateInstance*>(expiresValue)) {
        double date = dateInstance->internalNumber();
        if (std::isnan(date) || std::isinf(date)) [[unlikely]] {
            throwScope.throwException(lexicalGlobalObject, createRangeError(lexicalGlobalObject, "expires must be a valid Date (or Number)"_s));
            return Cookie::emptyExpiresAtValue;
        }
        return static_cast<int64_t>(date);
    }

    if (expiresValue.isNumber()) {
        double expires = expiresValue.asNumber();
        if (std::isnan(expires) || !std::isfinite(expires)) [[unlikely]] {
            throwScope.throwException(lexicalGlobalObject, createRangeError(lexicalGlobalObject, "expires must be a valid Number (or Date)"_s));
            return Cookie::emptyExpiresAtValue;
        }

        // expires can be a negative number. This is allowed because people do that to force cookie expiration.
        return static_cast<int64_t>(expires * 1000);
    }

    if (expiresValue.isString()) {
        auto expiresStr = convert<IDLUSVString>(*lexicalGlobalObject, expiresValue);
        RETURN_IF_EXCEPTION(throwScope, Cookie::emptyExpiresAtValue);
        auto nullTerminatedSpan = expiresStr.utf8();
        if (auto parsed = WTF::parseDate(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(nullTerminatedSpan.data()), nullTerminatedSpan.length()))) {
            if (std::isnan(parsed)) {
                throwVMError(lexicalGlobalObject, throwScope, createTypeError(lexicalGlobalObject, "Invalid cookie expiration date"_s));
                return Cookie::emptyExpiresAtValue;
            }
            return static_cast<int64_t>(parsed);
        } else {
            throwVMError(lexicalGlobalObject, throwScope, createTypeError(lexicalGlobalObject, "Invalid cookie expiration date"_s));
            return Cookie::emptyExpiresAtValue;
        }
    }

    return Bun::ERR::INVALID_ARG_VALUE(throwScope, lexicalGlobalObject, "expires"_s, expiresValue, "Invalid expires value. Must be a Date or a number"_s);
}

template<bool checkName>
static std::optional<CookieInit> cookieInitFromJS(JSC::VM& vm, JSGlobalObject* lexicalGlobalObject, JSValue options, String& name, String& value)
{
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    // Default values
    String domain;
    String path = "/"_s;
    int64_t expires = Cookie::emptyExpiresAtValue;
    double maxAge = std::numeric_limits<double>::quiet_NaN();
    bool secure = false;
    bool httpOnly = false;
    bool partitioned = false;
    CookieSameSite sameSite = CookieSameSite::Lax;
    auto& names = builtinNames(vm);

    if (!options.isUndefinedOrNull()) {
        if (!options.isObject()) {
            throwVMTypeError(lexicalGlobalObject, throwScope, "Options must be an object"_s);
            return std::nullopt;
        }

        if (auto* optionsObj = options.getObject()) {
            if (checkName) {
                auto nameValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->name);
                RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                if (nameValue) {
                    name = convert<IDLUSVString>(*lexicalGlobalObject, nameValue);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                }

                if (name.isEmpty()) {
                    throwVMTypeError(lexicalGlobalObject, throwScope, "name is required"_s);
                    return std::nullopt;
                }

                auto valueValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, vm.propertyNames->value);
                RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                if (valueValue) {
                    value = convert<IDLUSVString>(*lexicalGlobalObject, valueValue);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                }
            }

            // domain
            auto domainValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.domainPublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (domainValue) {
                if (!domainValue.isUndefined() && !domainValue.isNull()) {
                    domain = convert<IDLUSVString>(*lexicalGlobalObject, domainValue);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                }
            }

            // path
            auto pathValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.pathPublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (pathValue) {
                if (!pathValue.isUndefined() && !pathValue.isNull()) {
                    path = convert<IDLUSVString>(*lexicalGlobalObject, pathValue);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                }
            }

            // expires
            auto expiresValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.expiresPublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (expiresValue) {
                expires = getExpiresValue(lexicalGlobalObject, throwScope, expiresValue);
                RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            }

            // maxAge
            auto maxAgeValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.maxAgePublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (maxAgeValue) {
                if (!maxAgeValue.isUndefined() && !maxAgeValue.isNull() && maxAgeValue.isNumber()) {
                    maxAge = maxAgeValue.asNumber();
                }
            }

            // secure
            auto secureValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.securePublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (secureValue) {
                if (!secureValue.isUndefined()) {
                    secure = secureValue.toBoolean(lexicalGlobalObject);
                }
            }

            // httpOnly
            auto httpOnlyValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.httpOnlyPublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (httpOnlyValue) {
                if (!httpOnlyValue.isUndefined()) {
                    httpOnly = httpOnlyValue.toBoolean(lexicalGlobalObject);
                }
            }

            // partitioned
            auto partitionedValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.partitionedPublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (partitionedValue) {
                if (!partitionedValue.isUndefined()) {
                    partitioned = partitionedValue.toBoolean(lexicalGlobalObject);
                }
            }

            // sameSite
            auto sameSiteValue = optionsObj->getIfPropertyExists(lexicalGlobalObject, names.sameSitePublicName());
            RETURN_IF_EXCEPTION(throwScope, std::nullopt);
            if (sameSiteValue) {
                if (!sameSiteValue.isUndefined() && !sameSiteValue.isNull()) {
                    String sameSiteStr = convert<IDLUSVString>(*lexicalGlobalObject, sameSiteValue);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);

                    if (sameSiteStr == "strict"_s)
                        sameSite = CookieSameSite::Strict;
                    else if (sameSiteStr == "lax"_s)
                        sameSite = CookieSameSite::Lax;
                    else if (sameSiteStr == "none"_s)
                        sameSite = CookieSameSite::None;
                    else
                        throwVMTypeError(lexicalGlobalObject, throwScope, "Invalid sameSite value. Must be 'strict', 'lax', or 'none'"_s);
                    RETURN_IF_EXCEPTION(throwScope, std::nullopt);
                }
            }
        }
    }

    return CookieInit { name, value, domain, path, expires, secure, sameSite, httpOnly, maxAge, partitioned };
}

std::optional<CookieInit> CookieInit::fromJS(JSC::VM& vm, JSGlobalObject* lexicalGlobalObject, JSValue options, String name, String cookieValue)
{
    return cookieInitFromJS<false>(vm, lexicalGlobalObject, options, name, cookieValue);
}

std::optional<CookieInit> CookieInit::fromJS(JSC::VM& vm, JSGlobalObject* lexicalGlobalObject, JSValue options)
{
    WTF::String name;
    WTF::String value;
    return cookieInitFromJS<true>(vm, lexicalGlobalObject, options, name, value);
}

static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_toString);
static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_serialize);
static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_toJSON);
static JSC_DECLARE_HOST_FUNCTION(jsCookieStaticFunctionParse);
static JSC_DECLARE_HOST_FUNCTION(jsCookieStaticFunctionFrom);
static JSC_DECLARE_HOST_FUNCTION(jsCookieStaticFunctionSerialize);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_name);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_value);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_value);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_domain);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_domain);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_path);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_path);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_expires);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_expires);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_secure);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_secure);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_sameSite);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_sameSite);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_httpOnly);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_httpOnly);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_maxAge);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_maxAge);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_partitioned);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_partitioned);
static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_isExpired);
static JSC_DECLARE_CUSTOM_GETTER(jsCookieConstructor);

class JSCookiePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCookiePrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCookiePrototype* ptr = new (NotNull, JSC::allocateCell<JSCookiePrototype>(vm)) JSCookiePrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCookiePrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSCookiePrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCookiePrototype, JSCookiePrototype::Base);

JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookie* castedThis)
{
    return castedThis->wrapped().toJSON(vm, lexicalGlobalObject);
}

using JSCookieDOMConstructor = JSDOMConstructor<JSCookie>;

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCookieDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSCookieDOMConstructor*>(callFrame->jsCallee());

    // Check if this was called with 'new'
    if (!callFrame->thisValue().isObject()) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotAConstructorError(lexicalGlobalObject, callFrame->jsCallee()));

    // Static method: parse(cookieString)
    if (callFrame->argumentCount() == 1 && callFrame->argument(0).isString()) {
        // new Bun.Cookie.parse("foo=bar")
        auto cookieString = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(0));
        RETURN_IF_EXCEPTION(throwScope, {});

        if (!WebCore::isValidHTTPHeaderValue(cookieString)) [[unlikely]] {
            throwVMTypeError(lexicalGlobalObject, throwScope, "cookie string is not a valid HTTP header value"_s);
            RELEASE_AND_RETURN(throwScope, {});
        }

        auto cookie_exception = Cookie::parse(cookieString);
        if (cookie_exception.hasException()) {
            WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
            RELEASE_AND_RETURN(throwScope, {});
        }
        auto cookie = cookie_exception.releaseReturnValue();

        auto* globalObject = castedThis->globalObject();
        RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS(lexicalGlobalObject, globalObject, WTF::move(cookie))));
    } else if (callFrame->argumentCount() == 1 && callFrame->argument(0).isObject()) {
        // new Bun.Cooke({
        //     name: "name",
        //     value: "value",
        //     domain: "domain",
        //     path: "path",
        //     expires: "expires",
        //     secure: "secure",
        // })
        auto cookieInit = CookieInit::fromJS(vm, lexicalGlobalObject, callFrame->argument(0));
        RETURN_IF_EXCEPTION(throwScope, {});
        ASSERT(cookieInit);

        auto cookie_exception = Cookie::create(*cookieInit);
        if (cookie_exception.hasException()) {
            WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
            RELEASE_AND_RETURN(throwScope, {});
        }
        auto cookie = cookie_exception.releaseReturnValue();
        auto* globalObject = castedThis->globalObject();
        RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS(lexicalGlobalObject, globalObject, WTF::move(cookie))));
    } else if (callFrame->argumentCount() >= 2) {
        // new Bun.Cookie("name", "value", {
        //     domain: "domain",
        //     path: "path",
        //     expires: "expires",
        //     secure: "secure",
        // })
        String name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(0));
        RETURN_IF_EXCEPTION(throwScope, {});

        if (name.isEmpty()) {
            throwVMTypeError(lexicalGlobalObject, throwScope, "name is required"_s);
            RELEASE_AND_RETURN(throwScope, {});
        }

        String value = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(1));
        RETURN_IF_EXCEPTION(throwScope, {});

        CookieInit cookieInit { name, value };

        if (callFrame->argumentCount() > 2) {
            if (auto updatedCookieInit = CookieInit::fromJS(vm, lexicalGlobalObject, callFrame->argument(2), name, value)) {
                cookieInit = *updatedCookieInit;
            }
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        auto cookie_exception = Cookie::create(cookieInit);
        if (cookie_exception.hasException()) {
            WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
            RELEASE_AND_RETURN(throwScope, {});
        }
        auto cookie = cookie_exception.releaseReturnValue();

        auto* globalObject = castedThis->globalObject();
        RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS(lexicalGlobalObject, globalObject, WTF::move(cookie))));
    }

    return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
}

JSC_ANNOTATE_HOST_FUNCTION(JSCookieDOMConstructorConstruct, JSCookieDOMConstructor::construct);

// Setup for JSCookieDOMConstructor
template<> const ClassInfo JSCookieDOMConstructor::s_info = { "Cookie"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookieDOMConstructor) };

template<> JSValue JSCookieDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.objectPrototype();
}

template<> void JSCookieDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(2), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Cookie"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSCookie::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);

    // Add static methods
    JSC::JSFunction* parseFunction = JSC::JSFunction::create(vm, &globalObject, 1, "parse"_s, jsCookieStaticFunctionParse, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic);
    putDirect(vm, Identifier::fromString(vm, "parse"_s), parseFunction, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete));

    JSC::JSFunction* fromFunction = JSC::JSFunction::create(vm, &globalObject, 3, "from"_s, jsCookieStaticFunctionFrom, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic);
    putDirect(vm, Identifier::fromString(vm, "from"_s), fromFunction, static_cast<unsigned>(JSC::PropertyAttribute::DontDelete));
}

static const HashTableValue JSCookiePrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookieConstructor, 0 } },
    { "name"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_name, 0 } },
    { "value"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_value, jsCookiePrototypeSetter_value } },
    { "domain"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_domain, jsCookiePrototypeSetter_domain } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_path, jsCookiePrototypeSetter_path } },
    { "expires"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_expires, jsCookiePrototypeSetter_expires } },
    { "maxAge"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_maxAge, jsCookiePrototypeSetter_maxAge } },
    { "secure"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_secure, jsCookiePrototypeSetter_secure } },
    { "httpOnly"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_httpOnly, jsCookiePrototypeSetter_httpOnly } },
    { "sameSite"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_sameSite, jsCookiePrototypeSetter_sameSite } },
    { "partitioned"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_partitioned, jsCookiePrototypeSetter_partitioned } },
    { "isExpired"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_isExpired, 0 } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_toString, 0 } },
    { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_toJSON, 0 } },
    { "serialize"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_serialize, 0 } },
};

const ClassInfo JSCookiePrototype::s_info = { "Cookie"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookiePrototype) };

void JSCookiePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCookie::info(), JSCookiePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSCookie::s_info = { "Cookie"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookie) };

JSCookie::JSCookie(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Cookie>&& impl)
    : JSDOMWrapper<Cookie>(structure, globalObject, WTF::move(impl))
{
}

void JSCookie::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_expires.setMayBeNull(vm, this, nullptr);
}

JSObject* JSCookie::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSCookiePrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSCookiePrototype::create(vm, &globalObject, structure);
}

JSObject* JSCookie::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSCookie>(vm, globalObject);
}

JSValue JSCookie::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSCookieDOMConstructor, DOMConstructorID::Cookie>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

void JSCookie::destroy(JSC::JSCell* cell)
{
    JSCookie* thisObject = static_cast<JSCookie*>(cell);
    thisObject->JSCookie::~JSCookie();
}

JSC_DEFINE_CUSTOM_GETTER(jsCookieConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = jsDynamicCast<JSCookiePrototype*>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSCookie::getConstructor(vm, prototype->globalObject()));
}

// Instance methods
static inline JSC::EncodedJSValue jsCookiePrototypeFunction_toStringBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookie>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLDOMString>(*lexicalGlobalObject, throwScope, impl.toString(vm))));
}

JSC_DEFINE_HOST_FUNCTION(jsCookiePrototypeFunction_toString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookie>::call<jsCookiePrototypeFunction_toStringBody>(*lexicalGlobalObject, *callFrame, "toString");
}

JSC_DEFINE_HOST_FUNCTION(jsCookiePrototypeFunction_serialize, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookie>::call<jsCookiePrototypeFunction_toStringBody>(*lexicalGlobalObject, *callFrame, "serialize");
}

// Implementation of the toJSON method
static inline JSC::EncodedJSValue jsCookiePrototypeFunction_toJSONBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookie>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    // Delegate to the C++ toJSON method
    JSC::JSValue result = impl.toJSON(vm, lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsCookiePrototypeFunction_toJSON, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookie>::call<jsCookiePrototypeFunction_toJSONBody>(*lexicalGlobalObject, *callFrame, "toJSON");
}

// Static function implementations
JSC_DEFINE_HOST_FUNCTION(jsCookieStaticFunctionParse, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1)
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto cookieString = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, {});

    if (cookieString.isEmpty()) {
        auto cookie_exception = Cookie::create(CookieInit {});
        if (cookie_exception.hasException()) {
            WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
            RELEASE_AND_RETURN(throwScope, {});
        }
        auto cookie = cookie_exception.releaseReturnValue();
        return JSValue::encode(toJSNewlyCreated(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject), WTF::move(cookie)));
    }

    if (!WebCore::isValidHTTPHeaderValue(cookieString)) [[unlikely]] {
        throwVMTypeError(lexicalGlobalObject, throwScope, "cookie string is not a valid HTTP header value"_s);
        RELEASE_AND_RETURN(throwScope, {});
    }

    auto cookie_exception = Cookie::parse(cookieString);
    if (cookie_exception.hasException()) {
        WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    auto cookie = cookie_exception.releaseReturnValue();

    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJSNewlyCreated(lexicalGlobalObject, globalObject, WTF::move(cookie))));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieStaticFunctionFrom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2)
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, {});

    if (name.isEmpty()) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "name is required"_s);
        return {};
    }

    auto value = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
    RETURN_IF_EXCEPTION(throwScope, {});

    CookieInit cookieInit { name, value };
    JSValue optionsValue = callFrame->argument(2);
    // Check for options object
    if (!optionsValue.isUndefinedOrNull() && optionsValue.isObject()) {
        if (auto updatedCookieInit = CookieInit::fromJS(vm, lexicalGlobalObject, optionsValue, name, value)) {
            cookieInit = *updatedCookieInit;
        }
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    auto cookie_exception = Cookie::create(cookieInit);
    if (cookie_exception.hasException()) {
        WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    auto cookie = cookie_exception.releaseReturnValue();
    auto* globalObject = jsCast<JSDOMGlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(toJSNewlyCreated(lexicalGlobalObject, globalObject, WTF::move(cookie)));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieStaticFunctionSerialize, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsEmptyString(vm));

    Vector<Ref<Cookie>> cookies;

    // Process each cookie argument
    for (unsigned i = 0; i < callFrame->argumentCount(); i++) {
        auto* cookieImpl = toCookieWrapped(lexicalGlobalObject, throwScope, callFrame->uncheckedArgument(i));
        RETURN_IF_EXCEPTION(throwScope, {});

        if (cookieImpl)
            cookies.append(*cookieImpl);
    }

    // Let the C++ Cookie::serialize handle the work
    String result = Cookie::serialize(vm, cookies);

    return JSValue::encode(jsString(vm, result));
}

// Property getters/setters
JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_name, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "name"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.name()));
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_value, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "value"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.value()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_value, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "value"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setValue(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_domain, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "domain"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLNullable<IDLUSVString>>(*lexicalGlobalObject, throwScope, impl.domain()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_domain, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "domain"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    WebCore::propagateException(*lexicalGlobalObject, throwScope, impl.setDomain(value));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_path, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "path"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.path()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_path, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "path"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    WebCore::propagateException(*lexicalGlobalObject, throwScope, impl.setPath(value));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_expires, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "expires"_s);
    auto& impl = thisObject->wrapped();
    if (impl.hasExpiry()) {
        if (thisObject->m_expires) {
            auto* dateInstance = thisObject->m_expires.get();
            if (static_cast<int64_t>(dateInstance->internalNumber()) == impl.expires()) {
                return JSValue::encode(dateInstance);
            }
        }
        auto* dateInstance = JSC::DateInstance::create(vm, lexicalGlobalObject->dateStructure(), impl.expires());
        thisObject->m_expires.set(vm, thisObject, dateInstance);
        return JSValue::encode(dateInstance);
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_expires, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "expires"_s);
    auto& impl = thisObject->wrapped();
    auto value = getExpiresValue(lexicalGlobalObject, throwScope, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setExpires(value);
    thisObject->m_expires.clear();
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_secure, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "secure"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.secure()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_secure, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "secure"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLBoolean>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setSecure(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_sameSite, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "sameSite"_s);
    auto& impl = thisObject->wrapped();

    return JSValue::encode(toJS(lexicalGlobalObject, impl.sameSite()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_sameSite, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "sameSite"_s);
    auto& impl = thisObject->wrapped();

    auto sameSiteStr = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);

    CookieSameSite sameSite;
    if (WTF::equalIgnoringASCIICase(sameSiteStr, "strict"_s))
        sameSite = CookieSameSite::Strict;
    else if (WTF::equalIgnoringASCIICase(sameSiteStr, "lax"_s))
        sameSite = CookieSameSite::Lax;
    else if (WTF::equalIgnoringASCIICase(sameSiteStr, "none"_s))
        sameSite = CookieSameSite::None;
    else {
        throwTypeError(lexicalGlobalObject, throwScope, "Invalid sameSite value. Must be 'strict', 'lax', or 'none'"_s);
        return false;
    }

    impl.setSameSite(sameSite);
    return true;
}

// HttpOnly property
JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_httpOnly, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "httpOnly"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.httpOnly()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_httpOnly, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "httpOnly"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLBoolean>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setHttpOnly(value);
    return true;
}

// MaxAge property
JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_maxAge, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "maxAge"_s);
    auto& impl = thisObject->wrapped();
    double maxAge = impl.maxAge();
    if (std::isnan(maxAge))
        return JSValue::encode(jsUndefined());
    return JSValue::encode(toJS<IDLNullable<IDLDouble>>(*lexicalGlobalObject, throwScope, maxAge));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_maxAge, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "maxAge"_s);
    auto& impl = thisObject->wrapped();
    if (JSValue::decode(encodedValue).isUndefinedOrNull()) {
        impl.setMaxAge(std::numeric_limits<double>::quiet_NaN());
        return true;
    }
    auto value = convert<IDLDouble>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setMaxAge(value);

    return true;
}

// Partitioned property
JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_partitioned, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "partitioned"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.partitioned()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_partitioned, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "partitioned"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLBoolean>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setPartitioned(value);
    return true;
}

// isExpired method
static inline JSC::EncodedJSValue jsCookiePrototypeFunction_isExpiredBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookie>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    bool expired = impl.isExpired();
    return JSValue::encode(JSC::jsBoolean(expired));
}

JSC_DEFINE_HOST_FUNCTION(jsCookiePrototypeFunction_isExpired, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookie>::call<jsCookiePrototypeFunction_isExpiredBody>(*lexicalGlobalObject, *callFrame, "isExpired");
}

GCClient::IsoSubspace* JSCookie::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCookie, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCookie.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCookie = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCookie.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCookie = std::forward<decltype(space)>(space); });
}

void JSCookie::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSCookie*>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    Base::analyzeHeap(cell, analyzer);
}

bool JSCookieOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);
    UNUSED_PARAM(visitor);
    UNUSED_PARAM(reason);
    return false;
}

DEFINE_VISIT_CHILDREN(JSCookie);

template<typename Visitor>
void JSCookie::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCookie* thisObject = jsCast<JSCookie*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_expires);
}

void JSCookieOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsCookie = static_cast<JSCookie*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsCookie->wrapped(), jsCookie);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Cookie>&& impl)
{
    return createWrapper<Cookie>(globalObject, WTF::move(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Cookie& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

Cookie* JSCookie::toWrapped(JSC::VM& vm, JSC::JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSCookie*>(value))
        return &wrapper->wrapped();
    return nullptr;
}

size_t JSCookie::estimatedSize(JSC::JSCell* cell, JSC::VM& vm)
{
    auto* thisObject = jsCast<JSCookie*>(cell);
    auto& wrapped = thisObject->wrapped();
    return Base::estimatedSize(cell, vm) + wrapped.memoryCost();
}

JSC::JSValue toJS(JSC::JSGlobalObject* globalObject, CookieSameSite sameSite)
{
    auto& commonStrings = defaultGlobalObject(globalObject)->commonStrings();
    switch (sameSite) {
    case CookieSameSite::Strict:
        return commonStrings.strictString(globalObject);
    case CookieSameSite::Lax:
        return commonStrings.laxString(globalObject);
    case CookieSameSite::None:
        return commonStrings.noneString(globalObject);
    default: {
        break;
    }
    }
    __builtin_unreachable();
    return {};
}
}
