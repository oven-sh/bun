// JSWebViewConstructor: `new Bun.WebView({ ... })` options parsing.
// Host spawn + viewId registration + Create frame write all happen in
// JSWebView::createAndSend (JSWebView.cpp).

#include "root.h"
#include "JSWebView.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(callWebView);
static JSC_DECLARE_HOST_FUNCTION(constructWebView);

class JSWebViewConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWebViewConstructor* create(VM& vm, Structure* structure, JSObject* prototype)
    {
        JSWebViewConstructor* constructor = new (NotNull, allocateCell<JSWebViewConstructor>(vm)) JSWebViewConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm) { return &vm.internalFunctionSpace(); }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }

private:
    JSWebViewConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, callWebView, constructWebView)
    {
    }

    void finishCreation(VM& vm, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "WebView"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype,
            PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSWebViewConstructor::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebViewConstructor) };

InternalFunction* createJSWebViewConstructor(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    auto* structure = JSWebViewConstructor::createStructure(vm, globalObject, globalObject->functionPrototype());
    return JSWebViewConstructor::create(vm, structure, prototype);
}

// ---------------------------------------------------------------------------

JSC_DEFINE_HOST_FUNCTION(callWebView, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR,
        "Class constructor WebView cannot be invoked without 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(constructWebView, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    uint32_t width = 800, height = 600;
    WTF::String persistDir;
    WTF::String initialUrl;
    WebViewBackend backend = WebViewBackend::WebKit;
    WTF::String chromePath;
    WTF::Vector<WTF::String> chromeArgv;

    JSValue options = callFrame->argument(0);
    if (options.isObject()) {
        JSObject* opts = options.getObject();
        JSValue w = opts->get(globalObject, Identifier::fromString(vm, "width"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (w.isNumber()) width = static_cast<uint32_t>(w.toUInt32(globalObject));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue h = opts->get(globalObject, Identifier::fromString(vm, "height"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (h.isNumber()) height = static_cast<uint32_t>(h.toUInt32(globalObject));
        RETURN_IF_EXCEPTION(scope, {});

        JSValue headless = opts->get(globalObject, Identifier::fromString(vm, "headless"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (headless.isBoolean() && !headless.asBoolean()) {
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
                "headless: false is not yet implemented"_s);
        }

        // backend: "chrome" | "webkit" | { type: "chrome", path?, argv? }
        // The object form lets the user override the auto-detected binary
        // and append extra flags (e.g. --enable-features=...). argv entries
        // go after our core flags so they can override defaults.
        JSValue be = opts->get(globalObject, Identifier::fromString(vm, "backend"_s));
        RETURN_IF_EXCEPTION(scope, {});
        auto parseBackendType = [&](const WTF::String& s) -> bool {
            if (s == "chrome"_s) {
                backend = WebViewBackend::Chrome;
                return true;
            }
            if (s == "webkit"_s) {
                backend = WebViewBackend::WebKit;
                return true;
            }
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                "backend.type must be \"webkit\" or \"chrome\""_s);
            return false;
        };
        if (be.isString()) {
            WTF::String s = be.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!parseBackendType(s)) return {};
        } else if (be.isObject()) {
            JSObject* beObj = be.getObject();
            JSValue type = beObj->get(globalObject, Identifier::fromString(vm, "type"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (!type.isString()) {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "backend.type must be a string"_s);
            }
            if (!parseBackendType(type.toWTFString(globalObject))) return {};
            RETURN_IF_EXCEPTION(scope, {});

            JSValue path = beObj->get(globalObject, Identifier::fromString(vm, "path"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (path.isString()) {
                chromePath = path.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
            } else if (!path.isUndefined()) {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "backend.path must be a string"_s);
            }

            JSValue argvVal = beObj->get(globalObject, Identifier::fromString(vm, "argv"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* arr = jsDynamicCast<JSArray*>(argvVal)) {
                unsigned len = arr->length();
                for (unsigned i = 0; i < len; ++i) {
                    JSValue item = arr->get(globalObject, i);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (!item.isString()) {
                        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                            "backend.argv entries must be strings"_s);
                    }
                    chromeArgv.append(item.toWTFString(globalObject));
                    RETURN_IF_EXCEPTION(scope, {});
                }
            } else if (!argvVal.isUndefined()) {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "backend.argv must be an array of strings"_s);
            }
        }

        // Initial URL — the navigate() is fired off immediately after
        // Create. The promise lives in m_pendingNavigate; the user's first
        // await (navigate, evaluate, etc.) will serialize after it. For
        // WKWebView the Create frame is fire-and-forget, so Navigate lands
        // right behind it in the same socket write batch.
        JSValue url = opts->get(globalObject, Identifier::fromString(vm, "url"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (url.isString()) {
            initialUrl = url.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        } else if (!url.isUndefined()) {
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                "url must be a string"_s);
        }

        JSValue dataStore = opts->get(globalObject, Identifier::fromString(vm, "dataStore"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (dataStore.isObject()) {
            JSValue dir = dataStore.getObject()->get(globalObject, Identifier::fromString(vm, "directory"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (dir.isString()) {
                persistDir = dir.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
            } else {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "dataStore.directory must be a string"_s);
            }
        } else if (dataStore.isString()) {
            WTF::String s = dataStore.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (s != "ephemeral"_s) {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                    "dataStore must be \"ephemeral\" or { directory: string }"_s);
            }
        }
    }

    if (width == 0 || width > 16384)
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "width"_s, 1, 16384, jsNumber(width));
    if (height == 0 || height > 16384)
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "height"_s, 1, 16384, jsNumber(height));

    Structure* structure = zigGlobalObject->m_JSWebViewClassStructure.get(zigGlobalObject);
    JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSWebViewClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(),
            functionGlobalObject->m_JSWebViewClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (backend == WebViewBackend::Chrome) {
        JSWebView* view = JSWebView::createChrome(globalObject, structure, width, height,
            persistDir, chromePath, chromeArgv);
        if (!view) {
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
                "Failed to spawn Chrome (set BUN_CHROME_PATH, backend.path, or install Chrome/Chromium)"_s);
        }
        if (!initialUrl.isEmpty()) view->navigate(globalObject, initialUrl);
        return JSValue::encode(view);
    }

#if !OS(DARWIN)
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "Bun.WebView with backend \"webkit\" is only available on macOS; use backend: \"chrome\""_s);
#else
    JSWebView* view = JSWebView::createAndSend(globalObject, structure, width, height, persistDir);
    if (!view) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
            "Failed to spawn WebView host process"_s);
    }
    // Navigate promise lands in m_pendingNavigate; the user's first await
    // (including the next navigate()) serializes behind it. If it rejects
    // (bad URL), the next op's checkSlot sees the slot cleared and proceeds;
    // the rejection is unobserved unless the user explicitly awaits the
    // first navigate via view.onNavigated or a second navigate that picks
    // up the pending state. Same semantics as `view.navigate(url)` right
    // after construction — just one line shorter.
    if (!initialUrl.isEmpty()) view->navigate(globalObject, initialUrl);
    return JSValue::encode(view);
#endif
}

} // namespace Bun
