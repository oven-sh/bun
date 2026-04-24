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
#include <JavaScriptCore/JSONObject.h>
#include <wtf/text/MakeString.h>

#include "ipc_protocol.h" // VirtualKey, Mod*

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncNavigate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncEvaluate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScreenshot);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncCdp);
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
    { "cdp"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncCdp, 1 } },
    { "click"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncClick, 2 } },
    { "type"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncType, 1 } },
    { "press"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncPress, 1 } },
    { "scroll"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncScroll, 2 } },
    { "scrollTo"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncScrollTo, 1 } },
    { "resize"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncResize, 2 } },
    { "goBack"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncBack, 0 } },
    { "goForward"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsWebViewProtoFuncForward, 0 } },
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

    static JSWebViewPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        JSWebViewPrototype* prototype = new (NotNull, allocateCell<JSWebViewPrototype>(vm)) JSWebViewPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
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

    void finishCreation(VM& vm, JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        reifyStaticProperties(vm, JSWebView::info(), JSWebViewPrototypeTableValues, *this);
        JSC_TO_STRING_TAG_WITHOUT_TRANSITION();

        // close() is synchronous: writes the Close frame, rejects any pending
        // promises, erases from the routing table. `using` calls dispose;
        // `await using` calls asyncDispose if present (else dispose). Both
        // point to close — no async teardown to wait for.
        auto* closeFn = JSFunction::create(vm, globalObject, 0, "close"_s, jsWebViewProtoFuncClose, ImplementationVisibility::Public);
        putDirect(vm, vm.propertyNames->disposeSymbol, closeFn, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);
        putDirect(vm, vm.propertyNames->asyncDisposeSymbol, closeFn, PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);
    }
};

const ClassInfo JSWebViewPrototype::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebViewPrototype) };

JSObject* createJSWebViewPrototype(VM& vm, JSGlobalObject* globalObject)
{
    // Chain to EventTarget.prototype — addEventListener/removeEventListener/
    // dispatchEvent live there and unwrap `this` via dynamicDowncast<JSEventTarget>,
    // which succeeds for JSWebView : JSEventTarget. WebView.prototype.__proto__
    // === EventTarget.prototype; `view instanceof EventTarget` is true.
    auto* domGlobal = uncheckedDowncast<WebCore::JSDOMGlobalObject>(globalObject);
    auto* etProto = WebCore::JSEventTarget::prototype(vm, *domGlobal);
    auto* structure = JSWebViewPrototype::createStructure(vm, globalObject, etProto);
    return JSWebViewPrototype::create(vm, globalObject, structure);
}

// --- Helpers ----------------------------------------------------------------

using WebViewProto::VirtualKey;

static JSWebView* unwrapThis(JSGlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame, ASCIILiteral method)
{
    auto* thisObject = dynamicDowncast<JSWebView>(callFrame->thisValue());
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
    auto* arr = dynamicDowncast<JSArray>(v);
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
        else if (s == "Control"_s || s == "Ctrl"_s || s == "ctrl"_s || s == "control"_s)
            mods |= ModCtrl;
        else if (s == "Alt"_s || s == "alt"_s || s == "Option"_s || s == "option"_s)
            mods |= ModAlt;
        else if (s == "Meta"_s || s == "meta"_s || s == "Cmd"_s || s == "cmd"_s || s == "Command"_s || s == "command"_s)
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

// --- Core ops ---------------------------------------------------------------

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncNavigate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncEvaluate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScreenshot, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "screenshot"_s);
    RETURN_IF_EXCEPTION(scope, {});

    ScreenshotFormat format = ScreenshotFormat::Png;
    ScreenshotEncoding encoding = ScreenshotEncoding::Blob;
    uint8_t quality = 80; // CDP default for jpeg/webp. Ignored for png.

    JSValue optsVal = callFrame->argument(0);
    if (optsVal.isObject()) {
        JSObject* opts = optsVal.getObject();
        JSValue fmtVal = opts->get(globalObject, Identifier::fromString(vm, "format"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (fmtVal.isString()) {
            auto s = fmtVal.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (s == "png"_s)
                format = ScreenshotFormat::Png;
            else if (s == "jpeg"_s)
                format = ScreenshotFormat::Jpeg;
            else if (s == "webp"_s) {
                // NSBitmapImageRep's representationUsingType: has no WebP
                // enum value — would need ImageIO's CGImageDestination with
                // public.webp UTI (macOS 11+), which is a separate dlsym
                // surface not yet wired. Chrome-only until then.
                if (thisObject->m_backend != WebViewBackend::Chrome)
                    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
                        "format: \"webp\" requires backend: \"chrome\""_s);
                format = ScreenshotFormat::Webp;
            } else
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                    "format must be \"png\", \"jpeg\", or \"webp\""_s);
        } else if (!fmtVal.isUndefined())
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "format must be a string"_s);

        JSValue qVal = opts->get(globalObject, Identifier::fromString(vm, "quality"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (qVal.isNumber()) {
            double q = qVal.asNumber();
            if (!std::isfinite(q) || q < 0 || q > 100)
                return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "quality"_s, 0, 100, qVal);
            quality = static_cast<uint8_t>(q);
        } else if (!qVal.isUndefined())
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "quality must be a number"_s);

        // encoding: how the bytes are handed back. "shmem" is for Kitty
        // graphics protocol t=s — returns {name, size}, we skip our
        // shm_unlink, the terminal handles cleanup.
        JSValue encVal = opts->get(globalObject, Identifier::fromString(vm, "encoding"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (encVal.isString()) {
            auto s = encVal.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (s == "blob"_s)
                encoding = ScreenshotEncoding::Blob;
            else if (s == "buffer"_s)
                encoding = ScreenshotEncoding::Buffer;
            else if (s == "base64"_s)
                encoding = ScreenshotEncoding::Base64;
            else if (s == "shmem"_s) {
#if OS(WINDOWS)
                // No POSIX shm. Kitty on Windows uses temp files (t=t)
                // or direct (t=d) transmission anyway.
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
                    "encoding: \"shmem\" is not supported on Windows"_s);
#else
                encoding = ScreenshotEncoding::Shmem;
#endif
            } else
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                    "encoding must be \"blob\", \"buffer\", \"base64\", or \"shmem\""_s);
        } else if (!encVal.isUndefined())
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "encoding must be a string"_s);
    }

    // checkSlot after option parsing: opts->get() can invoke Proxy getters
    // that call view.close() between the guard and the screenshot() send.
    if (!checkSlot(globalObject, scope, thisObject->m_pendingScreenshot, "a screenshot()"_s)) return {};
    if (thisObject->m_closed)
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_STATE, "WebView is closed"_s);

    thisObject->m_screenshotEncoding = encoding;
    return JSValue::encode(thisObject->screenshot(globalObject, format, quality));
}

// Raw Chrome DevTools Protocol escape hatch. view.cdp("Domain.method",
// {params}) → JSON.parse(response.result). Chrome-only: WebKit's host
// subprocess speaks a binary frame protocol, not CDP. WKWebView DOES have
// _WKInspector SPI but wiring it through the host process + shm is a
// different project.
//
// params is JSON.stringify'd here and inserted verbatim into the CDP
// envelope. JSONStringify rejects cycles and non-serializable values with
// a TypeError — same as `JSON.stringify(params)` in user code.
//
// The command carries this view's sessionId, so it targets THIS tab.
// Domain-qualified: "Page.captureScreenshot", "Runtime.evaluate",
// "DOM.querySelector", etc. Not validated here — Chrome returns a
// {"code":-32601,"message":"'Foo.bar' wasn't found"} error which rejects
// the promise.
JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncCdp, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "cdp"_s);
    RETURN_IF_EXCEPTION(scope, {});

    if (thisObject->m_backend != WebViewBackend::Chrome)
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
            "WebView.cdp() requires backend: \"chrome\""_s);

    // Must have attached (first navigate() completes the target→session
    // chain). Before attach there's no sessionId; a browser-level CDP
    // command here would reach the wrong target. The user can `await
    // navigate(...)` first to get a session, or use Bun.WebView.chrome()
    // for browser-level commands (v2).
    if (thisObject->m_sessionId.isEmpty())
        return Bun::ERR::INVALID_STATE(scope, globalObject,
            "WebView.cdp(): no session - await navigate() first"_s);

    JSValue methodArg = callFrame->argument(0);
    if (!methodArg.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "method"_s, "string"_s, methodArg);
    WTF::String method = methodArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // params: JSON.stringify or default to "{}". JSONStringify handles
    // escape/encoding; its output is well-formed JSON we can insert
    // verbatim into the CDP envelope. undefined/null → "{}" (most CDP
    // methods accept empty params).
    JSValue paramsArg = callFrame->argument(1);
    WTF::String paramsJson;
    if (paramsArg.isUndefinedOrNull()) {
        paramsJson = "{}"_s;
    } else {
        paramsJson = JSONStringify(globalObject, paramsArg, 0);
        RETURN_IF_EXCEPTION(scope, {});
        // JSONStringify returns empty for non-serializable (function,
        // symbol as root). CDP params must be an object.
        if (paramsJson.isEmpty() || paramsJson[0] != '{')
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "params must be a JSON-serializable object"_s);
    }

    // Same TOCTOU as screenshot: JSONStringify can call a user-supplied
    // .toJSON() that closes the view between the earlier guards and send.
    if (thisObject->m_closed)
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_STATE, "WebView is closed"_s);
    if (!checkSlot(globalObject, scope, thisObject->m_pendingCdp, "a cdp()"_s)) return {};
    return JSValue::encode(thisObject->cdp(globalObject, method, paramsJson));
}

// --- Native input -----------------------------------------------------------

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClick, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncType, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncPress, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScroll, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "scroll"_s);
    RETURN_IF_EXCEPTION(scope, {});

    double dx = callFrame->argument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    double dy = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // NaN/Inf permanently poison the m_pendingScrollDx/Dy accumulators
    // in the host (NaN + anything = NaN), and static_cast<int32_t>(NaN)
    // at the CGEvent call site is UB.
    if (!std::isfinite(dx) || !std::isfinite(dy))
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "dx/dy"_s,
            jsNumber(std::isfinite(dx) ? dy : dx), "must be finite"_s);

    if (!checkSlot(globalObject, scope, thisObject->m_pendingMisc, "a simple operation"_s)) return {};
    return JSValue::encode(thisObject->scroll(globalObject, dx, dy));
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncScrollTo, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncResize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
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
}

// Chrome back/forward chains Page.getNavigationHistory →
// Page.navigateToHistoryEntry and settles via Page.loadEventFired, which
// only resolves PendingSlot::Navigate. WebKit's Op::History Ack is sync
// (Misc). Same backend-dependent slot as reload.
static auto& navSlot(JSWebView* view)
{
    return view->m_backend == WebViewBackend::Chrome ? view->m_pendingNavigate : view->m_pendingMisc;
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncBack, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "goBack"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, navSlot(thisObject), "a navigation"_s)) return {};
    return JSValue::encode(thisObject->goBack(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncForward, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "goForward"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, navSlot(thisObject), "a navigation"_s)) return {};
    return JSValue::encode(thisObject->goForward(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncReload, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "reload"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!checkSlot(globalObject, scope, navSlot(thisObject), "a navigation"_s)) return {};
    return JSValue::encode(thisObject->reload(globalObject));
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSWebView>(callFrame->thisValue());
    if (!thisObject || thisObject->m_closed) return JSValue::encode(jsUndefined());
    thisObject->doClose();
    return JSValue::encode(jsUndefined());
}

// --- Getters ----------------------------------------------------------------

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_url, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = dynamicDowncast<JSWebView>(JSValue::decode(thisValue));
    if (!thisObject) return JSValue::encode(jsEmptyString(globalObject->vm()));
    return JSValue::encode(jsString(globalObject->vm(), thisObject->m_url));
}

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_title, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = dynamicDowncast<JSWebView>(JSValue::decode(thisValue));
    if (!thisObject) return JSValue::encode(jsEmptyString(globalObject->vm()));
    return JSValue::encode(jsString(globalObject->vm(), thisObject->m_title));
}

JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_loading, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* thisObject = dynamicDowncast<JSWebView>(JSValue::decode(thisValue));
    return JSValue::encode(jsBoolean(thisObject && thisObject->m_loading));
}

// --- Callback accessors -----------------------------------------------------

#define WEBVIEW_CALLBACK_ACCESSOR(Name, field)                                                                  \
    JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_##Name, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName)) \
    {                                                                                                           \
        auto* thisObject = dynamicDowncast<JSWebView>(JSValue::decode(thisValue));                               \
        if (!thisObject) return JSValue::encode(jsUndefined());                                                 \
        JSObject* cb = thisObject->field.get();                                                                 \
        return JSValue::encode(cb ? JSValue(cb) : jsNull());                                                    \
    }                                                                                                           \
    JSC_DEFINE_CUSTOM_SETTER(jsWebViewSetter_##Name,                                                            \
        (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))   \
    {                                                                                                           \
        auto* thisObject = dynamicDowncast<JSWebView>(JSValue::decode(thisValue));                               \
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
