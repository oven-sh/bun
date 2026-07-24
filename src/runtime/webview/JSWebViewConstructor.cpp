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
static JSC_DECLARE_HOST_FUNCTION(jsWebViewConstructorCloseAll);

extern "C" void Bun__WebView__closeAllForTermination();
extern "C" size_t Bun__Feature__webview_chrome;
extern "C" size_t Bun__Feature__webview_webkit;

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
        putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "closeAll"_s),
            0, jsWebViewConstructorCloseAll, ImplementationVisibility::Public, NoIntrinsic,
            PropertyAttribute::Function | PropertyAttribute::DontEnum);
    }
};

const ClassInfo JSWebViewConstructor::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebViewConstructor) };

InternalFunction* createJSWebViewConstructor(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    // Bun.WebView.__proto__ === EventTarget (constructor chain, not instance
    // prototype). Matches DOM convention: BroadcastChannel.__proto__ ===
    // EventTarget. Lets static-method lookup fall through, and `extends
    // Bun.WebView` in user code transitively picks up EventTarget's own
    // static Symbol.hasInstance-less instanceof behavior.
    auto* etCtor = WebCore::JSEventTarget::getConstructor(vm, globalObject).getObject();
    auto* structure = JSWebViewConstructor::createStructure(vm, globalObject, etCtor);
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

// SIGKILLs both browser subprocesses. The onProcessExit path (EVFILT_PROC →
// Bun__Chrome__died / Bun__WebViewHost__childDied) rejects pending promises
// and marks transports dead on the next event loop tick — we don't touch JS
// state here. Calling on an already-dead process is a no-op (kill(9) returns
// ESRCH, discarded).
JSC_DEFINE_HOST_FUNCTION(jsWebViewConstructorCloseAll, (JSGlobalObject*, CallFrame*))
{
    Bun__WebView__closeAllForTermination();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(constructWebView, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    uint32_t width = 800, height = 600;
    WTF::String persistDir;
    WTF::String initialUrl;
    // Default: WebKit on Darwin (lighter than Chrome, always present);
    // Chrome elsewhere (WebKit needs the system framework, Darwin-only).
#if OS(DARWIN)
    WebViewBackend backend = WebViewBackend::WebKit;
#else
    WebViewBackend backend = WebViewBackend::Chrome;
#endif
    WTF::String chromePath;
    WTF::String chromeWsUrl;
    bool chromeSkipAutoDetect = false;
    WTF::Vector<WTF::String> chromeArgv;
    bool stdoutInherit = false;
    bool stderrInherit = false;
    bool consoleIsGlobal = false;
    JSObject* consoleCallback = nullptr;

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

            // url: controls the connect-vs-spawn choice.
            //   - "ws://..." — connect to that DevTools WebSocket directly
            //   - false — skip DevToolsActivePort auto-detect, always spawn
            //     (executable path still auto-found if `path` unset)
            //   - undefined (default) — auto-detect: if DevToolsActivePort
            //     exists, connect to the existing Chrome; else spawn
            // Bare host:port isn't accepted — Chrome's new chrome://inspect
            // toggle 404s /json/version so there's no HTTP discovery path;
            // the file IS the discovery source.
            JSValue urlOpt = beObj->get(globalObject, Identifier::fromString(vm, "url"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (urlOpt.isString()) {
                if (backend != WebViewBackend::Chrome)
                    return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                        "backend.url requires type: \"chrome\""_s);
                chromeWsUrl = urlOpt.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                if (!chromeWsUrl.startsWith("ws://"_s) && !chromeWsUrl.startsWith("wss://"_s))
                    return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                        "backend.url must be a ws:// URL (read DevToolsActivePort from Chrome's profile dir, "
                        "or omit url to auto-detect)"_s);
            } else if (urlOpt.isFalse()) {
                chromeSkipAutoDetect = true;
            } else if (!urlOpt.isUndefined()) {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "backend.url must be a ws:// string or false"_s);
            }

            JSValue argvVal = beObj->get(globalObject, Identifier::fromString(vm, "argv"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* arr = dynamicDowncast<JSArray>(argvVal)) {
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

            if (!chromeWsUrl.isEmpty() && (!chromePath.isEmpty() || !chromeArgv.isEmpty()))
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                    "backend.url (connect mode) cannot be combined with backend.path or backend.argv (spawn mode)"_s);

            // stdout/stderr: "inherit" | "ignore" — whether the subprocess's
            // streams flow to Bun's. Chrome is chatty on stderr (GCM
            // registration errors, updater noise, font-config warnings) even
            // with our flag suite; default ignore keeps test output clean.
            // "inherit" is useful when Chrome crashes silently (the crash
            // report goes to stderr). stdout is mostly quiet for both
            // backends — the WebKit host only prints on panic.
            auto parseStdio = [&](ASCIILiteral key, bool& out) -> bool {
                JSValue v = beObj->get(globalObject, Identifier::fromString(vm, key));
                RETURN_IF_EXCEPTION(scope, false);
                if (v.isUndefined()) return true;
                if (!v.isString()) {
                    Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                        makeString("backend."_s, key, " must be \"inherit\" or \"ignore\""_s));
                    return false;
                }
                WTF::String s = v.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                if (s == "inherit"_s) {
                    out = true;
                    return true;
                }
                if (s == "ignore"_s) return true;
                Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE,
                    makeString("backend."_s, key, " must be \"inherit\" or \"ignore\""_s));
                return false;
            };
            if (!parseStdio("stdout"_s, stdoutInherit)) return {};
            if (!parseStdio("stderr"_s, stderrInherit)) return {};
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

        // console: globalThis.console → direct ConsoleClient dispatch (no
        // JS call per console.log). console: (type, ...args) => {} → custom
        // callback. The globalThis.console check is reference equality —
        // passing the actual console object is the opt-in signal.
        JSValue consoleOpt = opts->get(globalObject, Identifier::fromString(vm, "console"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!consoleOpt.isUndefined()) {
            JSValue globalConsole = globalObject->get(globalObject,
                Identifier::fromString(vm, "console"_s));
            RETURN_IF_EXCEPTION(scope, {});
            if (consoleOpt == globalConsole) {
                consoleIsGlobal = true;
            } else if (consoleOpt.isCallable()) {
                consoleCallback = consoleOpt.getObject();
            } else {
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE,
                    "console must be globalThis.console or a function"_s);
            }
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
        Bun__Feature__webview_chrome += 1;
        JSWebView::ChromeCreateFailure failure = JSWebView::ChromeCreateFailure::SpawnFailed;
        JSWebView* view = JSWebView::createChrome(globalObject, structure, width, height,
            persistDir, chromePath, chromeArgv, stdoutInherit, stderrInherit, chromeWsUrl,
            chromeSkipAutoDetect, &failure);
        if (!view) {
            // NotImplementedOnWindows is distinct from SpawnFailed: the
            // POSIX socketpair + --remote-debugging-pipe fd plumbing in
            // ChromeProcess.zig has no Windows port, so when the call
            // actually needed the spawn path we surface it as a clean
            // platform-status error. BUN_CHROME_PATH / backend.path are
            // inert on that path, so the old "set the path" hint was
            // actively misleading there (issue #29102). Explicit ws://
            // connects and auto-detected existing Chrome still work on
            // Windows — those paths never reach ensureSpawned.
            switch (failure) {
            case JSWebView::ChromeCreateFailure::NotImplementedOnWindows:
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
                    "Bun.WebView chrome backend spawn is not yet implemented on Windows; "
                    "connect to an already-running Chrome with backend: { type: \"chrome\", url: \"ws://...\" } instead"_s);
            case JSWebView::ChromeCreateFailure::ConnectFailed:
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
                    "Failed to connect to Chrome (check backend.url is a valid ws:// debugger endpoint)"_s);
            case JSWebView::ChromeCreateFailure::AutoDetectConnectFailed:
                // Distinct from ConnectFailed: the user never set
                // backend.url, so the error must not hint at it. The
                // auto-detected URL came from DevToolsActivePort in
                // Chrome's profile dir and was malformed enough for
                // WebCore::WebSocket::create to fail synchronously.
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
                    "Failed to connect to auto-detected Chrome (malformed DevToolsActivePort file)"_s);
            case JSWebView::ChromeCreateFailure::SpawnFailed:
                return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
                    "Failed to spawn Chrome (set BUN_CHROME_PATH, backend.path, or install Chrome/Chromium)"_s);
            }
            RELEASE_ASSERT_NOT_REACHED();
        }
        view->m_consoleIsGlobal = consoleIsGlobal;
        if (consoleCallback) view->m_onConsole.set(vm, view, consoleCallback);
        if (!initialUrl.isEmpty()) view->navigate(globalObject, initialUrl);
        return JSValue::encode(view);
    }

#if OS(WINDOWS)
    // Chrome spawn is unavailable on Windows (see the NotImplementedOnWindows
    // branch above), so pointing users at `backend: "chrome"` as a fallback
    // here would just lead them to a second ERR_METHOD_NOT_IMPLEMENTED. They
    // can still connect to a running Chrome via backend.url, so tell them
    // that instead.
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "Bun.WebView with backend \"webkit\" is only available on macOS; "
        "on Windows, connect to an already-running Chrome with "
        "backend: { type: \"chrome\", url: \"ws://...\" }"_s);
#elif !OS(DARWIN)
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "Bun.WebView with backend \"webkit\" is only available on macOS; use backend: \"chrome\""_s);
#else
    Bun__Feature__webview_webkit += 1;
    JSWebView* view = JSWebView::createAndSend(globalObject, structure, width, height, persistDir,
        stdoutInherit, stderrInherit);
    if (!view) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
            "Failed to spawn WebView host process"_s);
    }
    view->m_consoleIsGlobal = consoleIsGlobal;
    if (consoleCallback) view->m_onConsole.set(vm, view, consoleCallback);
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
