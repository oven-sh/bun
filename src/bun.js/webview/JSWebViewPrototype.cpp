// JSWebViewPrototype: prototype method table + JS-facing arg validation.
// Calls JSWebView:: instance methods; all wire encoding and HostClient
// access is in JSWebView.cpp.

#include "root.h"
#include "JSWebView.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/text/MakeString.h>

#if OS(DARWIN)
#include "ipc_protocol.h" // VirtualKey, Mod*
#endif

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncNavigate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncEvaluate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScreenshot);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncClick);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncType);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncPress);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScroll);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScrollTo);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncResize);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncBack);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncForward);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncReload);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncClose);

static JSC_DECLARE_CUSTOM_GETTER(jsWebViewGetter_url);
static JSC_DECLARE_CUSTOM_GETTER(jsWebViewGetter_title);
static JSC_DECLARE_CUSTOM_GETTER(jsWebViewGetter_loading);
static JSC_DECLARE_CUSTOM_GETTER(jsWebViewGetter_onNavigated);
static JSC_DECLARE_CUSTOM_SETTER(jsWebViewSetter_onNavigated);
static JSC_DECLARE_CUSTOM_GETTER(jsWebViewGetter_onNavigationFailed);
static JSC_DECLARE_CUSTOM_SETTER(jsWebViewSetter_onNavigationFailed);

static const HashTableValue JSWebViewPrototypeTableValues[] = {
    { "navigate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncNavigate, 1 } },
    { "evaluate"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncEvaluate, 1 } },
    { "screenshot"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncScreenshot, 0 } },
    { "click"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncClick, 2 } },
    { "type"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncType, 1 } },
    { "press"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncPress, 1 } },
    { "scroll"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncScroll, 2 } },
    { "scrollTo"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncScrollTo, 1 } },
    { "resize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncResize, 2 } },
    { "back"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncBack, 0 } },
    { "forward"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncForward, 0 } },
    { "reload"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncReload, 0 } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncClose, 0 } },
    { "url"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebViewGetter_url, 0 } },
    { "title"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebViewGetter_title, 0 } },
    { "loading"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebViewGetter_loading, 0 } },
    { "onNavigated"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebViewGetter_onNavigated, jsWebViewSetter_onNavigated } },
    { "onNavigationFailed"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsWebViewGetter_onNavigationFailed, jsWebViewSetter_onNavigationFailed } },
};

// ---------------------------------------------------------------------------

class JSWebViewPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWebViewPrototype* create(VM& vm, JSGlobalObject*, Structure* structure)
    {
        JSWebViewPrototype* prototype = new (NotNull, allocateCell<JSWebViewPrototype>(vm)) JSWebViewPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm) { return &vm.plainObjectSpace(); }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSWebViewPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSWebView::info(), JSWebViewPrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    }
};

const ClassInfo JSWebViewPrototype::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebViewPrototype) };

JSObject* createJSWebViewPrototype(VM& vm, JSGlobalObject* globalObject)
{
    auto* structure = JSWebViewPrototype::createStructure(vm, globalObject, globalObject->objectPrototype());
    return JSWebViewPrototype::create(vm, globalObject, structure);
}

// --- Helpers ----------------------------------------------------------------

#define WEBVIEW_UNIMPLEMENTED_BODY(method)                                             \
    VM& vm = globalObject->vm();                                                       \
    auto scope = DECLARE_THROW_SCOPE(vm);                                              \
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED, \
        "Bun.WebView." method " is not yet implemented on this platform"_s);

#if OS(DARWIN)

using WebViewProto::VirtualKey;

static JSWebView* unwrapThis(JSGlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame, ASCIILiteral method)
{
    auto* thisObject = jsDynamicCast<JSWebView*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::ERR::INVALID_THIS(scope, globalObject, "WebView"_s);
        return nullptr;
    }
    if (thisObject->m_closed) {
        Bun::ERR::INVALID_STATE(scope, globalObject, makeString("WebView."_s, method, ": view is closed"_s));
        return nullptr;
    }
    return thisObject;
}

// Slot-empty check + INVALID_STATE. Separate from unwrapThis because each
// method uses a different slot.
static bool checkSlot(JSGlobalObject* g, ThrowScope& scope, const WriteBarrier<JSPromise>& slot, ASCIILiteral what)
{
    if (slot) {
        Bun::ERR::INVALID_STATE(scope, g, makeString(what, " is already pending"_s));
        return false;
    }
    return true;
}

static uint8_t parseModifiers(JSGlobalObject* g, ThrowScope& scope, JSValue v)
{
    using namespace WebViewProto;
    if (!v.isObject()) return 0;
    auto* arr = jsDynamicCast<JSArray*>(v);
    if (!arr) return 0;
    uint8_t mods = 0;
    unsigned len = arr->length();
    for (unsigned i = 0; i < len; ++i) {
        JSValue item = arr->get(g, i);
        RETURN_IF_EXCEPTION(scope, 0);
        WTF::String s = item.toWTFString(g);
        RETURN_IF_EXCEPTION(scope, 0);
        if (s == "Shift"_s || s == "shift"_s)
            mods |= ModShift;
        else if (s == "Control"_s || s == "ctrl"_s || s == "control"_s)
            mods |= ModCtrl;
        else if (s == "Alt"_s || s == "alt"_s || s == "option"_s)
            mods |= ModAlt;
        else if (s == "Meta"_s || s == "meta"_s || s == "cmd"_s || s == "command"_s)
            mods |= ModMeta;
    }
    return mods;
}

// JS string name → wire tag. Order must match ipc_protocol.h's enum; the
// static_assert in WebViewHost.cpp enforces the child-side table matches too.
static VirtualKey virtualKeyFromName(const WTF::String& s)
{
    struct {
        ASCIILiteral name;
        VirtualKey k;
    } table[] = {
        { "Enter"_s, VirtualKey::Enter },
        { "Tab"_s, VirtualKey::Tab },
        { "Space"_s, VirtualKey::Space },
        { "Backspace"_s, VirtualKey::Backspace },
        { "Delete"_s, VirtualKey::Delete },
        { "Escape"_s, VirtualKey::Escape },
        { "ArrowLeft"_s, VirtualKey::ArrowLeft },
        { "ArrowRight"_s, VirtualKey::ArrowRight },
        { "ArrowUp"_s, VirtualKey::ArrowUp },
        { "ArrowDown"_s, VirtualKey::ArrowDown },
        { "Home"_s, VirtualKey::Home },
        { "End"_s, VirtualKey::End },
        { "PageUp"_s, VirtualKey::PageUp },
        { "PageDown"_s, VirtualKey::PageDown },
    };
    for (auto& e : table)
        if (s == e.name) return e.k;
    return VirtualKey::Character;
}

#endif // OS(DARWIN)

// --- Core ops ---------------------------------------------------------------

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncNavigate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("navigate")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "navigate"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue urlArg = callFrame->argument(0);
    if (!urlArg.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "url"_s, "string"_s, urlArg);
    WTF::String url = urlArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!checkSlot(globalObject, scope, thisObject->m_pendingNavigate, "a navigation"_s)) return {};
    return JSValue::encode(thisObject->navigate(globalObject, url));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncEvaluate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("evaluate")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "evaluate"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue scriptArg = callFrame->argument(0);
    if (!scriptArg.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "script"_s, "string"_s, scriptArg);
    WTF::String script = scriptArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!checkSlot(globalObject, scope, thisObject->m_pendingEval, "an evaluate()"_s)) return {};
    return JSValue::encode(thisObject->evaluate(globalObject, script));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScreenshot, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("screenshot")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "screenshot"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, thisObject->m_pendingScreenshot, "a screenshot()"_s)) return {};
    return JSValue::encode(thisObject->screenshot(globalObject));
#endif
}

// --- Native input -----------------------------------------------------------

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClick, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("click")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "click"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue arg0 = callFrame->argument(0);

    // Shared options parse: { button, modifiers, clickCount, timeout }
    // timeout only applies to the selector overload.
    uint8_t button = 0, mods = 0, clickCount = 1;
    uint32_t timeout = 30000;
    auto parseOpts = [&](JSValue opts) -> bool {
        if (!opts.isObject()) return true;
        JSObject* o = opts.getObject();
        JSValue b = o->get(globalObject, Identifier::fromString(vm, "button"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (b.isString()) {
            WTF::String bs = b.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            if (bs == "right"_s)
                button = 1;
            else if (bs == "middle"_s)
                button = 2;
        }
        JSValue m = o->get(globalObject, Identifier::fromString(vm, "modifiers"_s));
        RETURN_IF_EXCEPTION(scope, false);
        mods = parseModifiers(globalObject, scope, m);
        RETURN_IF_EXCEPTION(scope, false);
        JSValue cc = o->get(globalObject, Identifier::fromString(vm, "clickCount"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (cc.isNumber()) clickCount = static_cast<uint8_t>(std::clamp(cc.toInt32(globalObject), 1, 3));
        RETURN_IF_EXCEPTION(scope, false);
        JSValue t = o->get(globalObject, Identifier::fromString(vm, "timeout"_s));
        RETURN_IF_EXCEPTION(scope, false);
        if (t.isNumber()) timeout = static_cast<uint32_t>(std::max(0.0, t.toNumber(globalObject)));
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    };

    // click(selector, opts?) — rAF-polled actionability check page-side
    // via callAsyncJavaScript:, then native click at the resolved center.
    if (arg0.isString()) {
        WTF::String selector = arg0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (selector.isEmpty()) {
            return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "selector"_s, arg0, "must not be empty"_s);
        }
        if (!parseOpts(callFrame->argument(1))) return {};
        if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
        return JSValue::encode(thisObject->clickSelector(globalObject, selector, timeout, button, mods, clickCount));
    }

    // click(x, y, opts?)
    double x = arg0.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    double y = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!parseOpts(callFrame->argument(2))) return {};

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->click(globalObject,
        static_cast<float>(x), static_cast<float>(y), button, mods, clickCount));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncType, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("type")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "type"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue textArg = callFrame->argument(0);
    if (!textArg.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "text"_s, "string"_s, textArg);
    WTF::String text = textArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->type(globalObject, text));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncPress, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("press")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "press"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue keyArg = callFrame->argument(0);
    if (!keyArg.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string"_s, keyArg);
    WTF::String key = keyArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    uint8_t mods = 0;
    JSValue opts = callFrame->argument(1);
    if (opts.isObject()) {
        JSValue m = opts.getObject()->get(globalObject, Identifier::fromString(vm, "modifiers"_s));
        RETURN_IF_EXCEPTION(scope, {});
        mods = parseModifiers(globalObject, scope, m);
        RETURN_IF_EXCEPTION(scope, {});
    }

    VirtualKey vk = virtualKeyFromName(key);
    if (vk == VirtualKey::Character && key.length() != 1) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, keyArg,
            "must be a virtual key name (Enter, Tab, Escape, Arrow*, etc.) or a single character"_s);
    }

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->press(globalObject, vk, mods,
        vk == VirtualKey::Character ? key : WTF::String()));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScroll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("scroll")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "scroll"_s);
    RETURN_IF_EXCEPTION(scope, {});

    double dx = callFrame->argument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    double dy = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->scroll(globalObject, dx, dy));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScrollTo, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("scrollTo")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "scrollTo"_s);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "selector"_s, "string"_s, arg0);
    }
    WTF::String selector = arg0.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (selector.isEmpty()) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "selector"_s, arg0, "must not be empty"_s);
    }

    // opts: { timeout?, block?: "start"|"center"|"end"|"nearest" }
    uint32_t timeout = 30000;
    uint8_t block = 1; // center
    JSValue opts = callFrame->argument(1);
    if (opts.isObject()) {
        JSObject* o = opts.getObject();
        JSValue t = o->get(globalObject, Identifier::fromString(vm, "timeout"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (t.isNumber()) timeout = static_cast<uint32_t>(std::max(0.0, t.toNumber(globalObject)));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue b = o->get(globalObject, Identifier::fromString(vm, "block"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (b.isString()) {
            WTF::String bs = b.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (bs == "start"_s)
                block = 0;
            else if (bs == "center"_s)
                block = 1;
            else if (bs == "end"_s)
                block = 2;
            else if (bs == "nearest"_s)
                block = 3;
            else
                return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "block"_s, b,
                    "must be \"start\", \"center\", \"end\", or \"nearest\""_s);
        }
    }

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->scrollTo(globalObject, selector, timeout, block));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncResize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("resize")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "resize"_s);
    RETURN_IF_EXCEPTION(scope, {});

    uint32_t w = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    uint32_t h = callFrame->argument(1).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (w == 0 || w > 16384)
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "width"_s, 1, 16384, jsNumber(w));
    if (h == 0 || h > 16384)
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "height"_s, 1, 16384, jsNumber(h));

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->resize(globalObject, w, h));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncBack, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("back")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "back"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->goBack(globalObject));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncForward, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("forward")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "forward"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->goForward(globalObject));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncReload, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("reload")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "reload"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->reload(globalObject));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    return JSValue::encode(jsUndefined());
#else
    auto* thisObject = jsDynamicCast<JSWebView*>(callFrame->thisValue());
    if (!thisObject || thisObject->m_closed) return JSValue::encode(jsUndefined());
    thisObject->doClose();
    return JSValue::encode(jsUndefined());
#endif
}

// --- Getters ----------------------------------------------------------------

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_url, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));
    if (!thisObject) return JSValue::encode(jsEmptyString(globalObject->vm()));
    return JSValue::encode(jsString(globalObject->vm(), thisObject->m_url));
}

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_title, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));
    if (!thisObject) return JSValue::encode(jsEmptyString(globalObject->vm()));
    return JSValue::encode(jsString(globalObject->vm(), thisObject->m_title));
}

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_loading, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));
    return JSValue::encode(jsBoolean(thisObject && thisObject->m_loading));
}

// --- Callback accessors -----------------------------------------------------

#define WEBVIEW_CALLBACK_ACCESSOR(Name, field)                                                                  \
    JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_##Name, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName)) \
    {                                                                                                           \
        auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));                               \
        if (!thisObject) return JSValue::encode(jsUndefined());                                                 \
        JSObject* cb = thisObject->field.get();                                                                 \
        return JSValue::encode(cb ? JSValue(cb) : jsNull());                                                    \
    }                                                                                                           \
    JSC_DEFINE_CUSTOM_SETTER(jsWebViewSetter_##Name,                                                            \
        (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))   \
    {                                                                                                           \
        auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));                               \
        if (!thisObject) return false;                                                                          \
        JSValue value = JSValue::decode(encodedValue);                                                          \
        if (value.isUndefinedOrNull()) {                                                                        \
            thisObject->field.clear();                                                                          \
        } else if (value.isCallable()) {                                                                        \
            thisObject->field.set(globalObject->vm(), thisObject, value.getObject());                           \
        } else {                                                                                                \
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());                                               \
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, value);                 \
            return false;                                                                                       \
        }                                                                                                       \
        return true;                                                                                            \
    }

WEBVIEW_CALLBACK_ACCESSOR(onNavigated, m_onNavigated)
WEBVIEW_CALLBACK_ACCESSOR(onNavigationFailed, m_onNavigationFailed)

#undef WEBVIEW_CALLBACK_ACCESSOR

} // namespace Bun
