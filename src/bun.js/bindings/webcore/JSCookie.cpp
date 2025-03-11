#include "config.h"
#include "JSCookie.h"

#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
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

namespace WebCore {

using namespace JSC;

// Helper for getting wrapped Cookie from JS value
static Cookie* toCookieWrapped(JSGlobalObject* lexicalGlobalObject, JSC::ThrowScope& throwScope, JSValue value)
{
    auto& vm = getVM(lexicalGlobalObject);
    auto* impl = JSCookie::toWrapped(vm, value);
    if (UNLIKELY(!impl))
        throwVMTypeError(lexicalGlobalObject, throwScope);
    return impl;
}

static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_toString);
static JSC_DECLARE_HOST_FUNCTION(jsCookiePrototypeFunction_toJSON);
static JSC_DECLARE_HOST_FUNCTION(jsCookieStaticFunctionParse);
static JSC_DECLARE_HOST_FUNCTION(jsCookieStaticFunctionFrom);
static JSC_DECLARE_CUSTOM_GETTER(jsCookiePrototypeGetter_name);
static JSC_DECLARE_CUSTOM_SETTER(jsCookiePrototypeSetter_name);
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

using JSCookieDOMConstructor = JSDOMConstructor<JSCookie>;

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCookieDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSCookieDOMConstructor*>(callFrame->jsCallee());

    // Check if this was called with 'new'
    if (UNLIKELY(!callFrame->thisValue().isObject()))
        return throwVMError(lexicalGlobalObject, throwScope, createNotAConstructorError(lexicalGlobalObject, callFrame->jsCallee()));

    // Static method: parse(cookieString)
    if (callFrame->argumentCount() == 1) {
        auto cookieString = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(0));
        RETURN_IF_EXCEPTION(throwScope, {});

        auto result = Cookie::parse(cookieString);
        RETURN_IF_EXCEPTION(throwScope, {});

        auto* globalObject = castedThis->globalObject();
        RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS(lexicalGlobalObject, globalObject, result.releaseReturnValue())));
    }

    // Constructor: Cookie.from(name, value, options)
    if (callFrame->argumentCount() >= 2) {
        auto name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(0));
        RETURN_IF_EXCEPTION(throwScope, {});

        auto value = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->argument(1));
        RETURN_IF_EXCEPTION(throwScope, {});

        // Default values
        String domain;
        String path = "/"_s;
        double expires = 0;
        bool secure = false;
        CookieSameSite sameSite = CookieSameSite::Strict;

        // Optional options parameter (third argument)
        if (callFrame->argumentCount() > 2 && !callFrame->argument(2).isUndefinedOrNull()) {
            auto options = callFrame->argument(2);

            if (!options.isObject())
                return throwVMTypeError(lexicalGlobalObject, throwScope, "Options must be an object"_s);

            auto* optionsObj = options.getObject();

            // domain
            if (auto domainValue = optionsObj->get(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "domain"_s)));
                !domainValue.isUndefined() && !domainValue.isNull()) {
                domain = convert<IDLUSVString>(*lexicalGlobalObject, domainValue);
                RETURN_IF_EXCEPTION(throwScope, {});
            }

            // path
            if (auto pathValue = optionsObj->get(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "path"_s)));
                !pathValue.isUndefined() && !pathValue.isNull()) {
                path = convert<IDLUSVString>(*lexicalGlobalObject, pathValue);
                RETURN_IF_EXCEPTION(throwScope, {});
            }

            // expires
            if (auto expiresValue = optionsObj->get(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "expires"_s)));
                !expiresValue.isUndefined() && !expiresValue.isNull() && expiresValue.isNumber()) {
                expires = expiresValue.asNumber();
                RETURN_IF_EXCEPTION(throwScope, {});
            }

            // secure
            if (auto secureValue = optionsObj->get(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "secure"_s)));
                !secureValue.isUndefined()) {
                secure = secureValue.toBoolean(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(throwScope, {});
            }

            // sameSite
            if (auto sameSiteValue = optionsObj->get(lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "sameSite"_s)));
                !sameSiteValue.isUndefined() && !sameSiteValue.isNull()) {
                String sameSiteStr = convert<IDLUSVString>(*lexicalGlobalObject, sameSiteValue);
                RETURN_IF_EXCEPTION(throwScope, {});

                if (sameSiteStr == "strict"_s)
                    sameSite = CookieSameSite::Strict;
                else if (sameSiteStr == "lax"_s)
                    sameSite = CookieSameSite::Lax;
                else if (sameSiteStr == "none"_s)
                    sameSite = CookieSameSite::None;
                else
                    return throwVMTypeError(lexicalGlobalObject, throwScope, "Invalid sameSite value. Must be 'strict', 'lax', or 'none'"_s);
            }
        }

        auto cookie = Cookie::create(name, value, domain, path, expires, secure, sameSite);
        auto* globalObject = castedThis->globalObject();
        RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS(lexicalGlobalObject, globalObject, WTFMove(cookie))));
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
    { "name"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_name, jsCookiePrototypeSetter_name } },
    { "value"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_value, jsCookiePrototypeSetter_value } },
    { "domain"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_domain, jsCookiePrototypeSetter_domain } },
    { "path"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_path, jsCookiePrototypeSetter_path } },
    { "expires"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_expires, jsCookiePrototypeSetter_expires } },
    { "secure"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_secure, jsCookiePrototypeSetter_secure } },
    { "sameSite"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookiePrototypeGetter_sameSite, jsCookiePrototypeSetter_sameSite } },
    { "toString"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_toString, 0 } },
    { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookiePrototypeFunction_toJSON, 0 } },
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
    : JSDOMWrapper<Cookie>(structure, globalObject, WTFMove(impl))
{
}

void JSCookie::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
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
    if (UNLIKELY(!prototype))
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSCookie::getConstructor(vm, prototype->globalObject()));
}

// Instance methods
static inline JSC::EncodedJSValue jsCookiePrototypeFunction_toStringBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookie>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJS<IDLDOMString>(*lexicalGlobalObject, throwScope, impl.toString())));
}

JSC_DEFINE_HOST_FUNCTION(jsCookiePrototypeFunction_toString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookie>::call<jsCookiePrototypeFunction_toStringBody>(*lexicalGlobalObject, *callFrame, "toString");
}

// Implementation of the toJSON method
static inline JSC::EncodedJSValue jsCookiePrototypeFunction_toJSONBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookie>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    // Delegate to the C++ toJSON method
    JSC::JSValue result = impl.toJSON(lexicalGlobalObject);
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

    auto result = Cookie::parse(cookieString);
    RETURN_IF_EXCEPTION(throwScope, {});

    auto* globalObject = jsCast<JSDOMGlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(toJS(lexicalGlobalObject, globalObject, result.releaseReturnValue()));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieStaticFunctionFrom, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2)
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, {});

    auto value = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
    RETURN_IF_EXCEPTION(throwScope, {});

    // Optional parameters
    String domain;
    String path = "/"_s;
    double expires = 0;
    bool secure = false;
    auto& builtinNames = Bun::builtinNames(vm);

    CookieSameSite sameSite = CookieSameSite::Strict;

    // Check for options object
    if (callFrame->argumentCount() > 2 && !callFrame->uncheckedArgument(2).isUndefinedOrNull() && callFrame->uncheckedArgument(2).isObject()) {
        auto* options = callFrame->uncheckedArgument(2).getObject();

        // domain
        auto domainValue = options->get(lexicalGlobalObject, builtinNames.domainPublicName());
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!domainValue.isUndefined() && !domainValue.isNull()) {
            domain = convert<IDLUSVString>(*lexicalGlobalObject, domainValue);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        // path
        auto pathValue = options->get(lexicalGlobalObject, builtinNames.pathPublicName());
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!pathValue.isUndefined() && !pathValue.isNull()) {
            path = convert<IDLUSVString>(*lexicalGlobalObject, pathValue);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        // expires
        auto expiresValue = options->get(lexicalGlobalObject, builtinNames.expiresPublicName());
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!expiresValue.isUndefined() && !expiresValue.isNull() && expiresValue.isNumber()) {
            expires = expiresValue.asNumber();
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        // secure
        auto secureValue = options->get(lexicalGlobalObject, builtinNames.securePublicName());
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!secureValue.isUndefined()) {
            secure = secureValue.toBoolean(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
        }

        // sameSite
        auto sameSiteValue = options->get(lexicalGlobalObject, builtinNames.sameSitePublicName());
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!sameSiteValue.isUndefined() && !sameSiteValue.isNull()) {
            String sameSiteStr = convert<IDLUSVString>(*lexicalGlobalObject, sameSiteValue);
            RETURN_IF_EXCEPTION(throwScope, {});

            if (sameSiteStr == "strict"_s)
                sameSite = CookieSameSite::Strict;
            else if (sameSiteStr == "lax"_s)
                sameSite = CookieSameSite::Lax;
            else if (sameSiteStr == "none"_s)
                sameSite = CookieSameSite::None;
            else
                return throwVMTypeError(lexicalGlobalObject, throwScope, "Invalid sameSite value. Must be 'strict', 'lax', or 'none'"_s);
        }
    }

    // Create the cookie
    auto cookie = Cookie::from(name, value, domain, path, expires, secure, sameSite);

    auto* globalObject = jsCast<JSDOMGlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(toJSNewlyCreated(lexicalGlobalObject, globalObject, WTFMove(cookie)));
}

// Property getters/setters
JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_name, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "name"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.name()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_name, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "name"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setName(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_value, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "value"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.value()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_value, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
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
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "domain"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLNullable<IDLUSVString>>(*lexicalGlobalObject, throwScope, impl.domain()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_domain, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "domain"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setDomain(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_path, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "path"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLUSVString>(*lexicalGlobalObject, throwScope, impl.path()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_path, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "path"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setPath(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_expires, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "expires"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLNullable<IDLDouble>>(*lexicalGlobalObject, throwScope, impl.expires()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_expires, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "expires"_s);
    auto& impl = thisObject->wrapped();
    auto value = convert<IDLDouble>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    impl.setExpires(value);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsCookiePrototypeGetter_secure, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "secure"_s);
    auto& impl = thisObject->wrapped();
    return JSValue::encode(toJS<IDLBoolean>(*lexicalGlobalObject, throwScope, impl.secure()));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_secure, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
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
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "sameSite"_s);
    auto& impl = thisObject->wrapped();

    String sameSiteStr;
    switch (impl.sameSite()) {
    case CookieSameSite::Strict:
        sameSiteStr = "strict"_s;
        break;
    case CookieSameSite::Lax:
        sameSiteStr = "lax"_s;
        break;
    case CookieSameSite::None:
        sameSiteStr = "none"_s;
        break;
    }

    return JSValue::encode(jsString(vm, sameSiteStr));
}

JSC_DEFINE_CUSTOM_SETTER(jsCookiePrototypeSetter_sameSite, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookie*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject))
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Cookie"_s, "sameSite"_s);
    auto& impl = thisObject->wrapped();

    auto sameSiteStr = convert<IDLUSVString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);

    CookieSameSite sameSite;
    if (sameSiteStr == "strict"_s)
        sameSite = CookieSameSite::Strict;
    else if (sameSiteStr == "lax"_s)
        sameSite = CookieSameSite::Lax;
    else if (sameSiteStr == "none"_s)
        sameSite = CookieSameSite::None;
    else {
        throwTypeError(lexicalGlobalObject, throwScope, "Invalid sameSite value. Must be 'strict', 'lax', or 'none'"_s);
        return false;
    }

    impl.setSameSite(sameSite);
    return true;
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

void JSCookieOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsCookie = static_cast<JSCookie*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsCookie->wrapped(), jsCookie);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Cookie>&& impl)
{
    return createWrapper<Cookie>(globalObject, WTFMove(impl));
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
