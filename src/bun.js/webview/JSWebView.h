#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <atomic>

namespace Bun {

// IPC client. The actual WKWebView lives in the host subprocess; this
// object holds a viewId and routes frames. Promises for pending ops live
// in the client's req_id → Strong<JSPromise> map, not here.
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

} // namespace Bun
