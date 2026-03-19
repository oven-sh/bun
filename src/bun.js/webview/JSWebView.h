#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>
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

// IPC client. For WebKit, the actual WKWebView lives in the host subprocess;
// this object holds a viewId and writes length-prefixed frames. For Chrome,
// this holds a CDP sessionId and writes NUL-delimited JSON to the pipe.
// Promises for pending ops live in the WriteBarrier slots — no Strong<>.
class JSWebView final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

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

    JSC::WriteBarrier<JSC::JSObject> m_onNavigated;
    JSC::WriteBarrier<JSC::JSObject> m_onNavigationFailed;
    // One slot per operation type. The req_id map in HostClient has no JS
    // refs — just {req_id → viewId, slot}. If GC collects this object
    // (user dropped both view and the awaited promise), the reply finds a
    // dead Weak and drops. No Strong<> roots.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingNavigate;
    JSC::WriteBarrier<JSC::JSPromise> m_pendingEval;
    JSC::WriteBarrier<JSC::JSPromise> m_pendingScreenshot;
    // Resize/Back/Forward/Reload/Close — one at a time, the child is fast.
    JSC::WriteBarrier<JSC::JSPromise> m_pendingMisc;
    // Read by isReachableFromOpaqueRoots on the GC thread — the barriers
    // themselves are not safe to read there. Inc BEFORE slot.set(), dec
    // AFTER slot.clear(), so GC never sees a set slot with count==0.
    std::atomic<uint32_t> m_pendingActivityCount { 0 };

    static JSWebView* create(JSC::VM&, JSC::Structure*);
    static void destroy(JSC::JSCell*);
    ~JSWebView();

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
    JSC::JSPromise* screenshot(JSC::JSGlobalObject*);
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
        uint32_t width, uint32_t height, const WTF::String& persistDir);
#endif

    // Chrome constructor. Lazy-spawns Chrome; stores width/height for the
    // Target.createTarget that the first navigate() sends. Works on all
    // platforms where Chrome runs (not just Darwin). Returns nullptr if
    // Chrome spawn failed.
    static JSWebView* createChrome(JSC::JSGlobalObject*, JSC::Structure*,
        uint32_t width, uint32_t height, const WTF::String& userDataDir);

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
    JSWebView(JSC::VM&, JSC::Structure*);
};

void setupJSWebViewClassStructure(JSC::LazyClassStructure::Initializer&);

// Shared weak owner for HostClient.viewsById and Transport.m_pending/
// .m_sessions. Roots a view while m_pendingActivityCount > 0.
JSC::WeakHandleOwner& webViewWeakOwner();

// Implemented in JSWebViewPrototype.cpp / JSWebViewConstructor.cpp.
// setupJSWebViewClassStructure calls these.
JSC::JSObject* createJSWebViewPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::InternalFunction* createJSWebViewConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);

} // namespace Bun
