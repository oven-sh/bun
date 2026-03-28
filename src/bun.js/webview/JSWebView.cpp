// JSWebView: the JSCell class + backend dispatch. Prototype/Constructor
// validate args and call JSWebView::navigate() etc.; those branch on
// m_backend into WK::Ops::* (Darwin) or CDP::Ops::*. All wire encoding and
// transport singletons live in the backend files.

#include "root.h"
#include "JSWebView.h"
#include "ChromeBackend.h"
#include "WebKitBackend.h"
#include "ipc_protocol.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "ScriptExecutionContext.h"
#include "ScriptWrappableInlines.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/WeakHandleOwner.h>
#include <wtf/NeverDestroyed.h>

namespace Bun {

using namespace JSC;
using namespace WebViewProto;

// ---------------------------------------------------------------------------
// Shared weak owner. Both backends (WebKit's HostClient.viewsById and
// Chrome's Transport.m_pending/.m_sessions) hold Weak<JSWebView>. The
// isReachableFromOpaqueRoots predicate reads the atomic activity count:
// under `bun test` the closure → view → m_pendingNavigate → promise →
// reaction → closure cycle has no external root (the test-function promise
// goes out of Zig scope after runTestCallback returns). This IS the root.
// ---------------------------------------------------------------------------

class JSWebViewWeakOwner final : public JSC::WeakHandleOwner {
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor&, ASCIILiteral* reason) final
    {
        auto* view = jsCast<JSWebView*>(handle.slot()->asCell());
        if (view->m_pendingActivityCount.load(std::memory_order_acquire) == 0)
            return false;
        if (reason) [[unlikely]]
            *reason = "WebView with pending operation"_s;
        return true;
    }
};

WeakHandleOwner& webViewWeakOwner()
{
    static NeverDestroyed<JSWebViewWeakOwner> owner;
    return owner.get();
}

void settleSlot(JSGlobalObject* g, JSWebView* v,
    WriteBarrier<JSPromise>& slot, bool ok, JSValue value)
{
    JSPromise* p = slot.get();
    if (!p) return;
    slot.clear();
    v->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
    if (ok)
        p->resolve(g, g->vm(), value);
    else
        p->reject(g->vm(), g, value);
}

// --- WebViewEventTarget ----------------------------------------------------

WTF_MAKE_TZONE_ALLOCATED_IMPL(WebViewEventTarget);

JSValue toJS(JSGlobalObject*, WebCore::JSDOMGlobalObject*, WebViewEventTarget& impl)
{
    // The impl's ScriptWrappable holds a Weak<JSDOMObject> set by
    // JSWebView::create → impl.setWrapper(). EventTargetFactory calls here
    // to produce event.target/currentTarget — just return the existing
    // wrapper. If it was collected (user dropped the view mid-event), return
    // null; event.target will be null, which is unusual but not fatal.
    if (auto* wrapper = impl.wrapper())
        return wrapper;
    return jsNull();
}

// --- JSWebView class -------------------------------------------------------

JSWebView::JSWebView(Structure* structure, WebCore::JSDOMGlobalObject& global, Ref<WebViewEventTarget>&& impl)
    : Base(structure, global, WTF::move(impl))
{
}

JSWebView* JSWebView::create(Structure* structure, WebCore::JSDOMGlobalObject* global, Ref<WebViewEventTarget>&& impl)
{
    auto& vm = global->vm();
    JSWebView* instance = new (NotNull, allocateCell<JSWebView>(vm)) JSWebView(structure, *global, WTF::move(impl));
    instance->finishCreation(vm);
    // Wire impl→wrapper so event.target resolves. JSDOMWrapper ctor already
    // moved the impl into m_wrapped; read it back via wrapped(). The Weak's
    // owner is our existing activity-count predicate — same one the backend
    // routing tables use.
    instance->wrapped().setWrapper(instance, &webViewWeakOwner(), nullptr);
    return instance;
}

void JSWebView::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWebView::~JSWebView()
{
    // We do NOT send Close from here. The destructor runs during GC;
    // JSPromise::create is unsafe (allocating in collection). The peer-side
    // view/target leaks for process lifetime — bounded, and the user was
    // supposed to call close().
    if (m_closed) return;
    if (m_backend == WebViewBackend::Chrome) {
        auto& t = CDP::transport();
        if (!m_sessionId.isEmpty()) t.m_sessions.remove(m_sessionId);
        if (m_viewId) t.m_views.remove(m_viewId);
        t.updateKeepAlive();
        return;
    }
#if OS(DARWIN)
    if (m_viewId) {
        auto& c = WK::client();
        c.viewsById.erase(m_viewId);
        c.updateKeepAlive();
    }
#endif
}

void JSWebView::destroy(JSCell* cell)
{
    static_cast<JSWebView*>(cell)->~JSWebView();
}

Structure* JSWebView::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

template<typename Visitor>
void JSWebView::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSWebView* thisObject = jsCast<JSWebView*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    // Base::visitChildren → JSEventTarget::visitAdditionalChildren →
    // wrapped().visitJSEventListeners(visitor) — marks all registered
    // addEventListener callbacks. The WriteBarrier slots below are our own
    // promise/handler refs; they're not in the EventTarget listener map.
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_onNavigated);
    visitor.append(thisObject->m_onNavigationFailed);
    visitor.append(thisObject->m_onConsole);
    visitor.append(thisObject->m_pendingNavigate);
    visitor.append(thisObject->m_pendingEval);
    visitor.append(thisObject->m_pendingScreenshot);
    visitor.append(thisObject->m_pendingMisc);
    visitor.append(thisObject->m_pendingCdp);
}

DEFINE_VISIT_CHILDREN(JSWebView);

const ClassInfo JSWebView::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebView) };

// --- Dispatching instance methods ------------------------------------------
// Each branches on m_backend. WebKit paths are Darwin-gated; calling one
// with backend=WebKit off-Darwin is unreachable (constructor threw).

#if !OS(DARWIN)
#define WK_DISPATCH(call)             \
    do {                              \
        RELEASE_ASSERT_NOT_REACHED(); \
        return nullptr;               \
    } while (0)
#else
#define WK_DISPATCH(call) return call
#endif

JSPromise* JSWebView::navigate(JSGlobalObject* g, const WTF::String& url)
{
    if (m_backend == WebViewBackend::Chrome) {
        auto* p = CDP::Ops::navigate(g, this, url);
        if (m_pendingNavigate) m_loading = true;
        return p;
    }
    WK_DISPATCH(WK::Ops::navigate(g, this, url));
}

JSPromise* JSWebView::evaluate(JSGlobalObject* g, const WTF::String& script)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::evaluate(g, this, script);
    WK_DISPATCH(WK::Ops::evaluate(g, this, script));
}

JSPromise* JSWebView::screenshot(JSGlobalObject* g, ScreenshotFormat format, uint8_t quality)
{
    m_screenshotFormat = format;
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::screenshot(g, this, format, quality);
    WK_DISPATCH(WK::Ops::screenshot(g, this, format, quality));
}

JSPromise* JSWebView::cdp(JSGlobalObject* g, const WTF::String& method, const WTF::String& paramsJson)
{
    // Chrome-only — the prototype function already threw for WebKit. The
    // backend check here is defensive (RELEASE_ASSERT would work but costs
    // nothing to return a rejected promise instead).
    ASSERT(m_backend == WebViewBackend::Chrome);
    return CDP::Ops::cdp(g, this, method, paramsJson);
}

JSPromise* JSWebView::click(JSGlobalObject* g, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    if (m_backend == WebViewBackend::Chrome)
        return CDP::Ops::click(g, this, x, y, button, modifiers, clickCount);
    WK_DISPATCH(WK::Ops::click(g, this, x, y, button, modifiers, clickCount));
}

JSPromise* JSWebView::clickSelector(JSGlobalObject* g, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    if (m_backend == WebViewBackend::Chrome)
        return CDP::Ops::clickSelector(g, this, selector, timeout, button, modifiers, clickCount);
    WK_DISPATCH(WK::Ops::clickSelector(g, this, selector, timeout, button, modifiers, clickCount));
}

JSPromise* JSWebView::type(JSGlobalObject* g, const WTF::String& text)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::type(g, this, text);
    WK_DISPATCH(WK::Ops::type(g, this, text));
}

JSPromise* JSWebView::press(JSGlobalObject* g, VirtualKey key, uint8_t modifiers, const WTF::String& character)
{
    if (m_backend == WebViewBackend::Chrome)
        return CDP::Ops::press(g, this, static_cast<uint8_t>(key), modifiers, character);
    WK_DISPATCH(WK::Ops::press(g, this, key, modifiers, character));
}

JSPromise* JSWebView::scroll(JSGlobalObject* g, double dx, double dy)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::scroll(g, this, dx, dy);
    WK_DISPATCH(WK::Ops::scroll(g, this, dx, dy));
}

JSPromise* JSWebView::scrollTo(JSGlobalObject* g, const WTF::String& selector, uint32_t timeout, uint8_t block)
{
    if (m_backend == WebViewBackend::Chrome)
        return CDP::Ops::scrollTo(g, this, selector, timeout, block);
    WK_DISPATCH(WK::Ops::scrollTo(g, this, selector, timeout, block));
}

JSPromise* JSWebView::resize(JSGlobalObject* g, uint32_t width, uint32_t height)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::resize(g, this, width, height);
    WK_DISPATCH(WK::Ops::resize(g, this, width, height));
}

JSPromise* JSWebView::goBack(JSGlobalObject* g)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::goBack(g, this);
    WK_DISPATCH(WK::Ops::goBack(g, this));
}

JSPromise* JSWebView::goForward(JSGlobalObject* g)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::goForward(g, this);
    WK_DISPATCH(WK::Ops::goForward(g, this));
}

JSPromise* JSWebView::reload(JSGlobalObject* g)
{
    if (m_backend == WebViewBackend::Chrome) return CDP::Ops::reload(g, this);
    WK_DISPATCH(WK::Ops::reload(g, this));
}

#undef WK_DISPATCH

void JSWebView::doClose()
{
    m_closed = true;
    if (m_backend == WebViewBackend::Chrome) {
        CDP::Ops::close(this);
        return;
    }
#if OS(DARWIN)
    WK::Ops::close(this);
#endif
}

// --- Factory entry ---------------------------------------------------------

#if OS(DARWIN)
JSWebView* JSWebView::createAndSend(JSGlobalObject* g, Structure* structure,
    uint32_t width, uint32_t height, const WTF::String& persistDir,
    bool stdoutInherit, bool stderrInherit)
{
    auto* zig = defaultGlobalObject(g);
    auto& c = WK::client();
    if (!c.ensureSpawned(zig, stdoutInherit, stderrInherit)) return nullptr;

    auto impl = WebViewEventTarget::create(*zig->scriptExecutionContext());
    JSWebView* view = create(structure, zig, WTF::move(impl));
    view->m_viewId = c.nextViewId++;
    c.viewsById.emplace(view->m_viewId, Weak<JSWebView>(view, &webViewWeakOwner()));
    c.updateKeepAlive();

    bool persistent = !persistDir.isEmpty();
    auto payload = encode(
        CreatePayload { width, height,
            static_cast<uint8_t>(persistent ? DataStoreKind::Persistent : DataStoreKind::Ephemeral) },
        persistent ? persistDir : WTF::String());
    c.writeFrame(Op::Create, view->m_viewId,
        payload.span().data(), static_cast<uint32_t>(payload.size()));

    return view;
}
#endif

// Reads DevToolsActivePort from default profile locations. Returns 0
// if no file found, else writes ws://127.0.0.1:<port>/devtools/... into
// out and returns the length. Sync file read — instant.
extern "C" size_t Bun__Chrome__autoDetect(char* out, size_t cap);

JSWebView* JSWebView::createChrome(JSGlobalObject* g, Structure* structure,
    uint32_t width, uint32_t height, const WTF::String& userDataDir,
    const WTF::String& path, const WTF::Vector<WTF::String>& extraArgv,
    bool stdoutInherit, bool stderrInherit, const WTF::String& wsUrl, bool skipAutoDetect)
{
    auto* zig = defaultGlobalObject(g);
    auto& t = CDP::transport();

    // Transport selection, in priority order:
    //   1. url: "ws://..." → connect (autoDetected=false → no fallback)
    //   2. path/argv set OR url:false → spawn, skip auto-detect
    //   3. neither → auto-detect DevToolsActivePort → connect OR spawn
    //
    // All paths end up in the same singleton; first call wins. A stale
    // DevToolsActivePort (Chrome crashed/restarted) triggers the
    // wsOnClose fallback to spawn (autoDetected=true). The file read is
    // sync/instant so the constructor stays synchronous.
    bool ok;
    if (!wsUrl.isEmpty()) {
        ok = t.ensureConnected(zig, wsUrl, /* autoDetected */ false);
    } else if (skipAutoDetect || !path.isEmpty() || !extraArgv.isEmpty()) {
        ok = t.ensureSpawned(zig, userDataDir, path, extraArgv, stdoutInherit, stderrInherit);
    } else {
        // Auto-detect. DevToolsActivePort URL caps at
        // ws://127.0.0.1:65535/devtools/browser/<36-char-uuid> ≈ 70B.
        char buf[128];
        size_t len = Bun__Chrome__autoDetect(buf, sizeof(buf));
        if (len > 0) {
            ok = t.ensureConnected(zig,
                WTF::String::fromUTF8(std::span<const char>(buf, len)),
                /* autoDetected */ true, userDataDir, stdoutInherit, stderrInherit);
        } else {
            ok = t.ensureSpawned(zig, userDataDir, path, extraArgv, stdoutInherit, stderrInherit);
        }
    }
    if (!ok) return nullptr;

    auto impl = WebViewEventTarget::create(*zig->scriptExecutionContext());
    JSWebView* view = create(structure, zig, WTF::move(impl));
    view->m_backend = WebViewBackend::Chrome;
    view->m_width = width;
    view->m_height = height;
    // One Weak per view, stored in Transport::m_views. All CDP routing
    // dereferences through this — m_pending and m_sessions hold just the
    // viewId, not their own Weaks. Mirrors WebKit's HostClient::viewsById.
    view->m_viewId = t.registerView(view);
    // Target.createTarget deferred to first navigate() — keeps the constructor
    // synchronous and the attach chain owned by the navigate promise (which
    // resolves on Page.loadEventFired, so one await covers the whole sequence).
    return view;
}

// --- Setup -----------------------------------------------------------------

void setupJSWebViewClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = createJSWebViewPrototype(init.vm, init.global);
    auto* constructor = createJSWebViewConstructor(init.vm, init.global, prototype);
    auto* structure = JSWebView::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun

// ---------------------------------------------------------------------------
// Termination hook. Called from dispatchOnExit (same path as SQLite's
// Bun__closeAllSQLiteDatabasesForTermination) and from WebView.closeAll().
// SIGKILLs both browser subprocesses — no CDP Browser.close, no promise
// rejection, no socket teardown. At dispatchOnExit the event loop is past
// the point of processing any reply; the only thing that matters is the
// subprocesses don't outlive us. Chrome's zygote tree (renderer/gpu/utility)
// exits when the browser process dies; WebKit's WebContent/GPU/Network
// helpers exit via XPC-invalidated when the host dies. Idempotent: kill(9)
// on a reaped pid returns ESRCH and we discard it.
// ---------------------------------------------------------------------------

extern "C" void Bun__Chrome__kill();
extern "C" void Bun__WebViewHost__kill();

extern "C" void Bun__WebView__closeAllForTermination()
{
    Bun__Chrome__kill();
    Bun__WebViewHost__kill();
}
