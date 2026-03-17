#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <atomic>

namespace Bun {

#if OS(DARWIN)
namespace WebViewProto { enum class VirtualKey : uint8_t; }
#endif

// IPC client. The actual WKWebView lives in the host subprocess; this
// object holds a viewId and writes length-prefixed frames. Promises for
// pending ops live in the WriteBarrier slots below — no Strong<> anywhere.
class JSWebView final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;

    uint32_t m_viewId = 0;
    bool m_closed = false;
    // Updated from NavDone replies — the getters are synchronous but the
    // real values live in the child. These track the last-seen state.
    WTF::String m_url;
    WTF::String m_title;
    bool m_loading = false;

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

#if OS(DARWIN)
    // Instance-level operations. Called from JSWebViewPrototype.cpp after arg
    // validation; all wire encoding + HostClient access is here. Each returns
    // the promise stored in the corresponding WriteBarrier slot.
    //
    // Caller guarantees the relevant slot is empty (INVALID_STATE thrown
    // before reaching here) and m_closed is false.
    JSC::JSPromise* navigate(JSC::JSGlobalObject*, const WTF::String& url);
    JSC::JSPromise* evaluate(JSC::JSGlobalObject*, const WTF::String& script);
    JSC::JSPromise* screenshot(JSC::JSGlobalObject*);
    JSC::JSPromise* click(JSC::JSGlobalObject*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);
    JSC::JSPromise* type(JSC::JSGlobalObject*, const WTF::String& text);
    JSC::JSPromise* press(JSC::JSGlobalObject*, WebViewProto::VirtualKey, uint8_t modifiers, const WTF::String& character);
    JSC::JSPromise* scroll(JSC::JSGlobalObject*, double dx, double dy);
    JSC::JSPromise* resize(JSC::JSGlobalObject*, uint32_t width, uint32_t height);
    JSC::JSPromise* goBack(JSC::JSGlobalObject*);
    JSC::JSPromise* goForward(JSC::JSGlobalObject*);
    JSC::JSPromise* reload(JSC::JSGlobalObject*);
    void doClose();

    // For the constructor: spawn host if needed, allocate viewId, register
    // in the Weak routing table, write the Create frame. Returns nullptr if
    // host spawn failed (caller throws).
    static JSWebView* createAndSend(JSC::JSGlobalObject*, JSC::Structure*,
        uint32_t width, uint32_t height, const WTF::String& persistDir);
#endif

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

// Implemented in JSWebViewPrototype.cpp / JSWebViewConstructor.cpp.
// setupJSWebViewClassStructure calls these.
JSC::JSObject* createJSWebViewPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::InternalFunction* createJSWebViewConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);

} // namespace Bun
