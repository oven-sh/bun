#pragma once

#include "root.h"
#include "BunClientData.h"
#include "JSEventTarget.h"
#include "WebViewEventTarget.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <atomic>

namespace Bun {

namespace WebViewProto {
enum class VirtualKey : uint8_t;
}

enum class WebViewBackend : uint8_t {
    WebKit, // WKWebView via separate host process (Darwin only)
    Chrome, // Chrome DevTools Protocol via --remote-debugging-pipe
};

enum class ScreenshotFormat : uint8_t {
    Png, // lossless, default.
    Jpeg, // lossy, quality 0-100.
    Webp, // lossy/lossless by quality. Chrome via CDP format:"webp";
          // WebKit via CGImageDestination with public.webp UTI (macOS 11+).
};

// How the image bytes are handed back to JS. The child (WebKit host,
// Chrome) always produces encoded image bytes; only the parent-side
// post-receive handling differs.
enum class ScreenshotEncoding : uint8_t {
    Blob, // default. WebKit: mmap'd shm → Blob store (zero-copy).
          // Chrome: base64-decode → Blob.
    Buffer, // WebKit: mmap'd shm → ArrayBuffer with munmap destructor
            // (zero-copy — same mapping as Blob, just wrapped as a
            // JSUint8Array Buffer). Chrome: base64-decode → Buffer.
    Base64, // WebKit: mmap → base64Encode → string, munmap.
            // Chrome: return the CDP "data" field as-is (zero decode).
    Shmem, // POSIX shm name + size. Parent does NOT shm_unlink —
           // caller (or Kitty via its t=s transmission mode) owns
           // cleanup. WebKit: the child already wrote here; just skip
           // our unlink. Chrome: create a fresh shm, write decoded
           // bytes, return name. Not supported on Windows.
};

inline const char* screenshotMimeType(ScreenshotFormat f)
{
    switch (f) {
    case ScreenshotFormat::Png:
        return "image/png";
    case ScreenshotFormat::Jpeg:
        return "image/jpeg";
    case ScreenshotFormat::Webp:
        return "image/webp";
    }
    return "image/png";
}

// IPC client + EventTarget wrapper. For WebKit, the actual WKWebView lives
// in the host subprocess; this object holds a viewId and writes length-
// prefixed frames. For Chrome, this holds a CDP sessionId and writes NUL-
// delimited JSON to the pipe. Promises for pending ops live in the
// WriteBarrier slots — no Strong<>.
//
// Inherits JSEventTarget so addEventListener/removeEventListener/
// dispatchEvent work. The EventTarget impl (m_wrapped) is a thin
// WebViewEventTarget that holds just the listener map — all WebView state
// stays on this wrapper. The Ref<EventTarget> keeps the impl alive; the
// impl's Weak<JSDOMObject> points back here (set by setWrapper in create).
class JSWebView final : public WebCore::JSEventTarget {
public:
    using Base = WebCore::JSEventTarget;
    using DOMWrapped = WebViewEventTarget;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    WebViewBackend m_backend = WebViewBackend::WebKit;

    // WebKit: viewId routes frames to the host. Chrome: 0.
    uint32_t m_viewId = 0;
    // Chrome: target creation width/height for the first navigate() which
    // does Target.createTarget. WebKit: held in the child.
    uint32_t m_width = 0, m_height = 0;
    bool m_closed = false;
    // Updated from NavDone replies / Page.frameNavigated — the getters are
    // synchronous but the real values live in the child.
    WTF::String m_url;
    WTF::String m_title;
    bool m_loading = false;

    // Chrome session state. Empty until the Target.createTarget →
    // Target.attachToTarget → Page.enable chain completes (driven by the
    // first navigate()). sessionId routes commands; targetId is for
    // Target.closeTarget. The chain stashes the navigate URL here so the
    // final step can send Page.navigate; subsequent navigates read
    // m_sessionId directly and skip the chain.
    WTF::String m_sessionId;
    WTF::String m_targetId;
    WTF::String m_pendingChromeNavigateUrl;
    // clickSelector stash — the actionability eval chains into a
    // dispatchMouseEvent that needs these. WebViewHost has the same fields
    // on its side (m_selButton etc.) for the same chain.
    uint8_t m_selButton = 0;
    uint8_t m_selModifiers = 0;
    uint8_t m_selClickCount = 1;
    // goBack/goForward stash — PageGetNavigationHistory chains into
    // navigateToHistoryEntry with entries[currentIndex + delta].id.
    int8_t m_chromeHistoryDelta = 0;
    // Screenshot format/encoding stash — set by screenshot() before
    // dispatch, read by both backends' response handlers. CDP/IPC payloads
    // don't echo these; stashing here is simpler than threading them
    // through Pending/viewId routing. format → MIME type on the Blob;
    // encoding → how the bytes are wrapped (Blob/Buffer/base64/shmem).
    ScreenshotFormat m_screenshotFormat = ScreenshotFormat::Png;
    ScreenshotEncoding m_screenshotEncoding = ScreenshotEncoding::Blob;

    JSC::WriteBarrier<JSC::JSObject> m_onNavigated;
    JSC::WriteBarrier<JSC::JSObject> m_onNavigationFailed;
    // Console capture. If the user passed `console: globalThis.console`,
    // m_consoleIsGlobal is set and dispatch goes straight to the
    // ConsoleClient (Bun__ConsoleObject__messageWithTypeAndLevel) — no JS
    // call. Otherwise m_onConsole holds a (type, ...args) callback. Chrome
    // fires from Runtime.consoleAPICalled; WebKit from a WKScriptMessage
    // handler receiving a user-script wrap of console.*.
    JSC::WriteBarrier<JSC::JSObject> m_onConsole;
    bool m_consoleIsGlobal = false;
    // One slot per operation type. The req_id map in HostClient has no JS
    // refs — just {req_id → viewId, slot}. If GC collects this object
    // (user dropped both view and the awaited promise), the reply finds a
    // dead Weak and drops. No Strong<> roots.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingNavigate;
    JSC::WriteBarrier<JSC::JSPromise> m_pendingEval;
    JSC::WriteBarrier<JSC::JSPromise> m_pendingScreenshot;
    // Resize/Back/Forward/Reload/Close — one at a time, the child is fast.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingMisc;
    // Chrome-only: raw view.cdp(method, params) escape hatch. Separate
    // slot so it doesn't block resize/goBack. Still one raw op at a time.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingCdp;
    // Read by isReachableFromOpaqueRoots on the GC thread — the barriers
    // themselves are not safe to read there. Inc BEFORE slot.set(), dec
    // AFTER slot.clear(), so GC never sees a set slot with count==0.
    std::atomic<uint32_t> m_pendingActivityCount { 0 };

    static JSWebView* create(JSC::Structure*, WebCore::JSDOMGlobalObject*, Ref<WebViewEventTarget>&&);
    static void destroy(JSC::JSCell*);
    ~JSWebView();

    WebViewEventTarget& wrapped() const { return static_cast<WebViewEventTarget&>(Base::wrapped()); }

    // Instance-level operations. Called from JSWebViewPrototype.cpp after arg
    // validation. Each branches on m_backend: WebKit path encodes binary
    // frames for the host subprocess, Chrome path builds CDP JSON commands.
    // Both return the promise stored in the corresponding WriteBarrier slot.
    //
    // Caller guarantees the relevant slot is empty (INVALID_STATE thrown
    // before reaching here) and m_closed is false. WebKit paths are
    // Darwin-only; calling one on the WebKit backend off-Darwin is a bug
    // (constructor already threw).
    JSC::JSPromise* navigate(JSC::JSGlobalObject*, const WTF::String& url);
    JSC::JSPromise* evaluate(JSC::JSGlobalObject*, const WTF::String& script);
    JSC::JSPromise* screenshot(JSC::JSGlobalObject*, ScreenshotFormat, uint8_t quality);
    // Chrome-only. Raw CDP escape hatch — method is "Domain.method",
    // paramsJson is JSON.stringify(params) or "{}". Returns the decoded
    // result object from the CDP response.
    JSC::JSPromise* cdp(JSC::JSGlobalObject*, const WTF::String& method, const WTF::String& paramsJson);
    JSC::JSPromise* click(JSC::JSGlobalObject*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);
    JSC::JSPromise* clickSelector(JSC::JSGlobalObject*, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount);
    JSC::JSPromise* type(JSC::JSGlobalObject*, const WTF::String& text);
    JSC::JSPromise* press(JSC::JSGlobalObject*, WebViewProto::VirtualKey, uint8_t modifiers, const WTF::String& character);
    JSC::JSPromise* scroll(JSC::JSGlobalObject*, double dx, double dy);
    JSC::JSPromise* scrollTo(JSC::JSGlobalObject*, const WTF::String& selector, uint32_t timeout, uint8_t block);
    JSC::JSPromise* resize(JSC::JSGlobalObject*, uint32_t width, uint32_t height);
    JSC::JSPromise* goBack(JSC::JSGlobalObject*);
    JSC::JSPromise* goForward(JSC::JSGlobalObject*);
    JSC::JSPromise* reload(JSC::JSGlobalObject*);
    void doClose();

#if OS(DARWIN)
    // WebKit constructor: spawn host if needed, allocate viewId, register
    // in the Weak routing table, write the Create frame. Returns nullptr if
    // host spawn failed (caller throws).
    static JSWebView* createAndSend(JSC::JSGlobalObject*, JSC::Structure*,
        uint32_t width, uint32_t height, const WTF::String& persistDir,
        bool stdoutInherit, bool stderrInherit);
#endif

    // Chrome constructor. Lazy-spawns Chrome; stores width/height for the
    // Target.createTarget that the first navigate() sends. path overrides
    // auto-detection; extraArgv appends to the built-in flags. Works on
    // all platforms where Chrome runs (not just Darwin). Returns nullptr
    // if Chrome spawn failed.
    // wsUrl: connect to an existing Chrome's WebSocket debugger endpoint
    // instead of spawning. Empty → spawn with --remote-debugging-pipe.
    static JSWebView* createChrome(JSC::JSGlobalObject*, JSC::Structure*,
        uint32_t width, uint32_t height, const WTF::String& userDataDir,
        const WTF::String& path, const WTF::Vector<WTF::String>& extraArgv,
        bool stdoutInherit, bool stderrInherit, const WTF::String& wsUrl = {},
        bool skipAutoDetect = false);

    void finishCreation(JSC::VM&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWebView, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSWebView.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSWebView = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSWebView.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSWebView = std::forward<decltype(space)>(space); });
    }

private:
    JSWebView(JSC::Structure*, WebCore::JSDOMGlobalObject&, Ref<WebViewEventTarget>&&);
};

// toJS overload for WebViewEventTarget. EventTargetFactory dispatches here
// when event.target (or event.currentTarget) needs to produce a JS wrapper
// for a WebViewEventTarget impl. The impl's ScriptWrappable holds a
// Weak<JSDOMObject> set by create() → wrapper().
JSC::JSValue toJS(JSC::JSGlobalObject*, WebCore::JSDOMGlobalObject*, WebViewEventTarget&);

void setupJSWebViewClassStructure(JSC::LazyClassStructure::Initializer&);

// Shared weak owner for HostClient.viewsById and Transport.m_pending/
// .m_sessions. Roots a view while m_pendingActivityCount > 0.
JSC::WeakHandleOwner& webViewWeakOwner();

// Settle = read, clear, dec activity, resolve-or-reject. Slot cleared BEFORE
// the call into JS so a re-entrant navigate() inside a .then() sees an empty
// slot. Activity decremented AFTER clear (GC seeing count>0 with a clear
// slot is benign — one extra mark cycle). Shared by all backends.
void settleSlot(JSC::JSGlobalObject*, JSWebView*,
    JSC::WriteBarrier<JSC::JSPromise>& slot, bool ok, JSC::JSValue);

// Implemented in JSWebViewPrototype.cpp / JSWebViewConstructor.cpp.
// setupJSWebViewClassStructure calls these.
JSC::JSObject* createJSWebViewPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::InternalFunction* createJSWebViewConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);

} // namespace Bun
