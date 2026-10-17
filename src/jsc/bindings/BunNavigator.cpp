#include "root.h"
#include "BunNavigator.h"

#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/IntlObject.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/NumberOfCores.h>

namespace Bun {

using namespace JSC;

String navigatorUserAgent()
{
    return String::fromUTF8(Bun__userAgent);
}

ASCIILiteral navigatorPlatform()
{
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform
// https://github.com/oven-sh/bun/issues/4588
#if OS(DARWIN)
    return "MacIntel"_s;
#elif OS(WINDOWS)
    return "Win32"_s;
#elif OS(LINUX)
    return "Linux x86_64"_s;
#elif OS(FREEBSD)
#if CPU(ARM64)
    return "FreeBSD arm64"_s;
#else
    return "FreeBSD amd64"_s;
#endif
#else
    return ""_s;
#endif
}

// A global object has one navigator, and nothing can make another.
static bool isCalledOnNavigator(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    return callFrame->thisValue() == defaultGlobalObject(globalObject)->m_navigatorObject.getInitializedOnMainThread(globalObject);
}

#define DEFINE_NAVIGATOR_GETTER(name, value)                                                                 \
    static JSC_DECLARE_HOST_FUNCTION(navigatorGetter_##name);                                                \
    JSC_DEFINE_HOST_FUNCTION(navigatorGetter_##name, (JSGlobalObject * globalObject, CallFrame * callFrame)) \
    {                                                                                                        \
        auto& vm = getVM(globalObject);                                                                      \
        auto scope = DECLARE_THROW_SCOPE(vm);                                                                \
        if (!isCalledOnNavigator(globalObject, callFrame)) [[unlikely]]                                      \
            return WebCore::throwThisTypeError(*globalObject, scope, "Navigator"_s, #name##_s);              \
        return JSValue::encode(value);                                                                       \
    }

DEFINE_NAVIGATOR_GETTER(userAgent, jsString(vm, navigatorUserAgent()))
DEFINE_NAVIGATOR_GETTER(platform, jsString(vm, String(navigatorPlatform())))
DEFINE_NAVIGATOR_GETTER(hardwareConcurrency, jsNumber(WTF::numberOfProcessorCores()))
DEFINE_NAVIGATOR_GETTER(language, jsString(vm, defaultLocale(globalObject)))
DEFINE_NAVIGATOR_GETTER(languages, defaultGlobalObject(globalObject)->m_navigatorLanguages.getInitializedOnMainThread(globalObject))

#undef DEFINE_NAVIGATOR_GETTER

static JSC_DECLARE_HOST_FUNCTION(navigatorIllegalConstructor);
JSC_DEFINE_HOST_FUNCTION(navigatorIllegalConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    return throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

JSObject* createNavigatorConstructor(VM& vm, JSGlobalObject* globalObject)
{
    JSObject* prototype = constructEmptyObject(globalObject, globalObject->objectPrototype(), 8);
    auto* constructor = JSFunction::create(vm, globalObject, 0, "Navigator"_s, navigatorIllegalConstructor, ImplementationVisibility::Public, NoIntrinsic, navigatorIllegalConstructor);
    constructor->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));

    auto putGetter = [&](ASCIILiteral name, NativeFunction getter) {
        prototype->putDirectNativeIntrinsicGetter(vm, globalObject, Identifier::fromString(vm, name), getter, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::Accessor));
    };
    putGetter("userAgent"_s, navigatorGetter_userAgent);
    putGetter("platform"_s, navigatorGetter_platform);
    putGetter("hardwareConcurrency"_s, navigatorGetter_hardwareConcurrency);
    putGetter("language"_s, navigatorGetter_language);
    putGetter("languages"_s, navigatorGetter_languages);
    prototype->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "Navigator"_s), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    return constructor;
}

JSObject* createNavigator(VM& vm, Zig::GlobalObject* globalObject)
{
    JSObject* constructor = globalObject->m_navigatorConstructor.getInitializedOnMainThread(globalObject);
    return constructEmptyObject(globalObject, asObject(constructor->getDirect(vm, vm.propertyNames->prototype)), 0);
}

JSObject* createNavigatorLanguages(VM& vm, JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* languages = constructEmptyArray(globalObject, nullptr, 1);
    scope.assertNoException();
    languages->putDirectIndex(globalObject, 0, jsString(vm, defaultLocale(globalObject)));
    scope.assertNoException();
    auto* frozen = objectConstructorFreeze(globalObject, languages);
    scope.assertNoException();
    return frozen;
}

} // namespace Bun
