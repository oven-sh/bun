// JSWebView: the JSCell class + HostClient (usockets wire to the host
// subprocess) + instance-level ops. Prototype/Constructor validate args and
// call JSWebView::navigate() etc.; all wire encoding and HostClient access
// is here.

#include "root.h"
#include "JSWebView.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/WeakHandleOwner.h>
#include <wtf/text/MakeString.h>
#include <wtf/NeverDestroyed.h>
#include <mutex>

#if OS(DARWIN)
#include "ipc_protocol.h"
#include "libusockets.h"
#include "_libusockets.h"
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>
#include <unordered_map>
#endif

namespace Bun {

using namespace JSC;

#if OS(DARWIN)

using namespace WebViewProto;

// Spawn + process-exit watch in Zig (reuses bun.spawn.Process / EVFILT_PROC).
extern "C" int32_t Bun__WebViewHost__ensure(Zig::GlobalObject*);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);
// Bracket the whole onData batch. exit() drains microtasks when outermost,
// so all the promise reactions from this batch run before we return to usockets.
extern "C" void Bun__EventLoop__enter(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__exit(Zig::GlobalObject*);
// runCallback does its own nested enter/exit + reportActiveExceptionAsUnhandled
// on throw — one bad onNavigated callback won't poison the rest of the batch.
extern "C" void Bun__EventLoop__runCallback2(JSC::JSGlobalObject*, JSC::EncodedJSValue cb,
    JSC::EncodedJSValue thisVal, JSC::EncodedJSValue arg0, JSC::EncodedJSValue arg1);

// ---------------------------------------------------------------------------
// HostClient + all wire plumbing. Anonymous namespace — nothing here is
// visible outside this TU. Prototype/Constructor go through JSWebView::
// instance methods defined below.
//
// No Strong<>, no req_id map. Promises live in WriteBarrier slots on
// JSWebView; the frame header carries viewId. Reply arrives → viewsById[viewId]
// (Weak) → Reply type picks the slot. If the user drops view + promise, GC
// takes both; the reply finds a dead Weak and discards.
//
// The viewsById Weak<> has a WeakHandleOwner: isReachableFromOpaqueRoots
// reads the atomic activity count. Under `bun test` the closure → view →
// m_pendingNavigate → promise → reaction → closure cycle has no external
// root (the test-function promise goes out of Zig scope after runTestCallback
// returns). This predicate IS the root.
// ---------------------------------------------------------------------------
namespace {

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

JSWebViewWeakOwner& webViewWeakOwner()
{
    static NeverDestroyed<JSWebViewWeakOwner> owner;
    return owner.get();
}

struct HostClient {
    us_socket_context_t* ctx = nullptr;
    us_socket_t* sock = nullptr;
    Zig::GlobalObject* global = nullptr;
    bool dead = false;

    uint32_t nextViewId = 1;
    std::unordered_map<uint32_t, Weak<JSWebView>> viewsById;

    WTF::Vector<uint8_t> rx;
    WTF::Vector<uint8_t> txQueue;
    bool sockRefd = false;

    bool ensureSpawned(Zig::GlobalObject*);
    void writeFrame(Op, uint32_t viewId, const uint8_t* payload, uint32_t len);
    void handleReply(const Frame&, Reader);
    void rejectAllAndMarkDead(const WTF::String& reason);

    // us_socket_ref/unref are no-ops on kqueue, and us_poll_start_rc doesn't
    // touch loop.active. Track our own ref against view count. A view with
    // pending ops keeps itself alive via visitChildren → promise → reaction
    // → closure → view, so "any views" covers "any pending".
    void updateKeepAlive()
    {
        bool want = !viewsById.empty();
        if (want == sockRefd || !global) return;
        sockRefd = want;
        Bun__eventLoop__incrementRefConcurrently(
            WebCore::clientData(global->vm())->bunVM, want ? 1 : -1);
    }

    void onData(const char* data, int length);
    void onWritable();
    void onClose();
};

// No static top-level initializers. HostClient's default ctor is trivial
// (just member inits), but the Vector/unordered_map members have non-trivial
// ctors that would run at image load. LazyNeverDestroyed + call_once defers
// to first use — which is always on the JS thread via ensureSpawned(), so
// the once_flag doesn't contend.
HostClient& hostClient()
{
    static LazyNeverDestroyed<HostClient> instance;
    static std::once_flag once;
    std::call_once(once, [] { instance.construct(); });
    return instance.get();
}

us_socket_t* hostOnData(us_socket_t* s, char* data, int length)
{
    hostClient().onData(data, length);
    return s;
}
us_socket_t* hostOnWritable(us_socket_t* s)
{
    hostClient().onWritable();
    return s;
}
us_socket_t* hostOnClose(us_socket_t* s, int, void*)
{
    hostClient().onClose();
    return s;
}
us_socket_t* hostOnEnd(us_socket_t* s)
{
    hostClient().onClose();
    return s;
}
us_socket_t* hostOnOpen(us_socket_t* s, int, char*, int) { return s; }

bool HostClient::ensureSpawned(Zig::GlobalObject* zig)
{
    if (sock && !dead) return true;

    // Host died (rejectAllAndMarkDead ran). The Zig side cleared its
    // instance in onProcessExit, so Bun__WebViewHost__ensure will spawn a
    // fresh child. Clear stale state and try again — the old rx/txQueue
    // bytes are for the dead socket.
    if (dead) {
        dead = false;
        sock = nullptr;
        rx.clear();
        txQueue.clear();
    }

    int fd = Bun__WebViewHost__ensure(zig);
    if (fd < 0) {
        dead = true;
        return false;
    }
    global = zig;

    // Socket context — once. usockets needs all callbacks set even for
    // adopted fds; on_open won't fire (us_socket_from_fd doesn't call it)
    // but leaving it null segfaults on a misrouted event.
    if (!ctx) {
        us_loop_t* loop = uws_get_loop();
        us_socket_context_options_t opts;
        memset(&opts, 0, sizeof(opts));
        ctx = us_create_socket_context(0, loop, sizeof(void*), opts);
        us_socket_context_on_data(0, ctx, hostOnData);
        us_socket_context_on_writable(0, ctx, hostOnWritable);
        us_socket_context_on_close(0, ctx, hostOnClose);
        us_socket_context_on_end(0, ctx, hostOnEnd);
        us_socket_context_on_open(0, ctx, hostOnOpen);
    }

    // us_socket_from_fd sets nonblocking/nodelay/no-sigpipe and polls
    // READABLE|WRITABLE. ipc=0 — we're not doing SCM_RIGHTS fd passing.
    // us_poll_start_rc doesn't touch loop.active; updateKeepAlive is the
    // sole ref manager.
    sock = us_socket_from_fd(ctx, sizeof(void*), fd, 0);
    if (!sock) {
        // us_socket_from_fd calls us_poll_free on failure but doesn't close
        // the fd (ownership was ours). Leak it and the child stays alive
        // forever with a dead read end.
        ::close(fd);
        dead = true;
        return false;
    }
    return true;
}

void HostClient::writeFrame(Op op, uint32_t viewId, const uint8_t* payload, uint32_t len)
{
    if (!sock || dead || us_socket_is_closed(0, sock)) return;
    Frame h = { len, viewId, static_cast<uint8_t>(op) };
    const auto* hbytes = reinterpret_cast<const uint8_t*>(&h);
    if (txQueue.isEmpty()) {
        // us_socket_write2 does writev(header, payload) and auto-enables the
        // writable poll on short write. Returns bytes written (≥0, never -1).
        int w = us_socket_write2(0, sock,
            reinterpret_cast<const char*>(hbytes), sizeof(h),
            reinterpret_cast<const char*>(payload), static_cast<int>(len));
        size_t total = sizeof(h) + len;
        if (static_cast<size_t>(w) == total) return;
        size_t skip = static_cast<size_t>(w);
        if (skip < sizeof(h)) {
            txQueue.append(std::span<const uint8_t>(hbytes + skip, sizeof(h) - skip));
            skip = 0;
        } else {
            skip -= sizeof(h);
        }
        if (len > skip) txQueue.append(std::span<const uint8_t>(payload + skip, len - skip));
    } else {
        txQueue.append(std::span<const uint8_t>(hbytes, sizeof(h)));
        if (len) txQueue.append(std::span<const uint8_t>(payload, len));
    }
}

void HostClient::onWritable()
{
    while (!txQueue.isEmpty()) {
        int w = us_socket_write(0, sock,
            reinterpret_cast<const char*>(txQueue.span().data()),
            static_cast<int>(txQueue.size()));
        if (w <= 0) return; // usockets re-enables writable poll on short write
        txQueue.removeAt(0, static_cast<size_t>(w));
    }
}

// Returns Uint8Array on success, JS Error on failure. May throw (OOM in
// createUninitialized); onData's TopExceptionScope reports + clears.
JSValue openShmScreenshot(JSGlobalObject* g, const char* name, uint32_t nameLen, uint32_t pngLen)
{
    auto& vm = g->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Parent owns the unlink — we know when the JS side is done with the bytes.
    WTF::Vector<char, 64> zname;
    zname.grow(nameLen + 1);
    memcpy(zname.mutableSpan().data(), name, nameLen);
    zname[nameLen] = '\0';

    int fd = shm_open(zname.span().data(), O_RDONLY, 0);
    if (fd < 0)
        RELEASE_AND_RETURN(scope, createError(g, makeString("shm_open: "_s, WTF::String::fromUTF8(strerror(errno)))));
    void* map = mmap(nullptr, pngLen, PROT_READ, MAP_SHARED, fd, 0);
    ::close(fd);
    shm_unlink(zname.span().data());
    if (map == MAP_FAILED)
        RELEASE_AND_RETURN(scope, createError(g, makeString("mmap: "_s, WTF::String::fromUTF8(strerror(errno)))));

    auto* u8 = JSUint8Array::createUninitialized(g, g->m_typedArrayUint8.get(g), pngLen);
    if (scope.exception() || !u8) [[unlikely]] {
        munmap(map, pngLen);
        // createUninitialized threw (OOM). Propagate — the caller's
        // TopExceptionScope reports and clears between frames. The promise
        // rejects with jsUndefined (result.inherits<JSUint8Array>() is false),
        // which isn't pretty, but OOM during a screenshot memcpy means we're
        // about to die anyway.
        RELEASE_AND_RETURN(scope, jsUndefined());
    }
    memcpy(u8->typedVector(), map, pngLen);
    munmap(map, pngLen);
    RELEASE_AND_RETURN(scope, u8);
}

// Settle = read, clear, dec activity, resolve-or-reject. Slot cleared BEFORE
// the call into JS so a re-entrant navigate() inside a .then() sees an empty
// slot. Activity decremented AFTER clear (GC seeing count>0 with a clear
// slot is benign — one extra mark cycle).
void settle(JSGlobalObject* g, JSWebView* view, WriteBarrier<JSPromise>& slot, bool ok, JSValue v)
{
    JSPromise* p = slot.get();
    if (!p) return;
    slot.clear();
    view->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
    if (ok)
        p->resolve(g, v);
    else
        p->reject(g->vm(), g, v);
}

void HostClient::handleReply(const Frame& h, Reader r)
{
    auto* g = global;
    auto& vm = g->vm();
    auto reply = static_cast<Reply>(h.op);

    auto it = viewsById.find(h.viewId);
    if (it == viewsById.end()) return;
    JSWebView* view = it->second.get();
    if (!view) return; // collected — user dropped both view and promise

    switch (reply) {
    // Events fire the callback; they arrive BEFORE the matching Done/Failed
    // reply so the callback observes the state change before `await` resumes.
    case Reply::NavEvent: {
        WTF::String url = r.str();
        WTF::String title = r.str();
        view->m_url = url;
        view->m_title = title;
        view->m_loading = false;
        if (JSObject* cb = view->m_onNavigated.get()) {
            Bun__EventLoop__runCallback2(g, JSValue::encode(cb), JSValue::encode(jsUndefined()),
                JSValue::encode(jsString(vm, url)), JSValue::encode(jsString(vm, title)));
        }
        return;
    }
    case Reply::NavFailEvent: {
        WTF::String err = r.str();
        view->m_loading = false;
        if (JSObject* cb = view->m_onNavigationFailed.get()) {
            Bun__EventLoop__runCallback2(g, JSValue::encode(cb), JSValue::encode(jsUndefined()),
                JSValue::encode(createError(g, err)), JSValue::encode(jsUndefined()));
        }
        return;
    }

    case Reply::NavDone:
        // url/title already cached by the preceding NavEvent.
        settle(g, view, view->m_pendingNavigate, true, jsUndefined());
        return;
    case Reply::NavFailed:
        // navigateIPC sends NavFailed directly for invalid URLs — no
        // NavFailEvent precedes it, so the only m_loading reset path is here.
        view->m_loading = false;
        settle(g, view, view->m_pendingNavigate, false, createError(g, r.str()));
        return;

    case Reply::EvalDone: {
        WTF::String s = r.str();
        // Child serialized via JSON.stringify page-side; this is the one
        // deserialization. Empty string = script returned undefined (or a
        // function/symbol — JSON.stringify collapses those to undefined).
        // JSONParse returns {} on malformed input; the child's output is
        // JSC's own JSON.stringify so it's well-formed by construction.
        JSValue v = s.isEmpty() ? jsUndefined() : JSONParse(g, s);
        settle(g, view, view->m_pendingEval, true, v ? v : jsUndefined());
        return;
    }
    case Reply::EvalFailed:
        settle(g, view, view->m_pendingEval, false, createError(g, r.str()));
        return;

    case Reply::ScreenshotDone: {
        uint32_t nameLen = r.u32();
        const char* name = reinterpret_cast<const char*>(r.bytes(nameLen));
        uint32_t pngLen = r.u32();
        JSValue result = openShmScreenshot(g, name, nameLen, pngLen);
        settle(g, view, view->m_pendingScreenshot, result.inherits<JSUint8Array>(), result);
        return;
    }
    case Reply::ScreenshotFailed:
        settle(g, view, view->m_pendingScreenshot, false, createError(g, r.str()));
        return;

    case Reply::Ack:
        settle(g, view, view->m_pendingMisc, true, jsUndefined());
        return;
    case Reply::Error:
        // Child-side misc-op failure (input contention, selector timeout,
        // malformed result). The child's view() lookup now sends op-specific
        // failure types for invalid viewId (NavFailed/EvalFailed/etc.), so
        // Error is exclusively misc-slot. Rejecting all slots here would
        // spuriously kill a concurrent navigate.
        view->m_loading = false;
        settle(g, view, view->m_pendingMisc, false, createError(g, r.str()));
        return;
    }
}

void HostClient::rejectAllAndMarkDead(const WTF::String& reason)
{
    dead = true;
    sock = nullptr;
    if (!global) return;
    auto* g = global;
    JSValue err = createError(g, reason);
    for (auto& [id, weak] : viewsById) {
        JSWebView* v = weak.get();
        if (!v) continue;
        v->m_loading = false;
        settle(g, v, v->m_pendingNavigate, false, err);
        settle(g, v, v->m_pendingEval, false, err);
        settle(g, v, v->m_pendingScreenshot, false, err);
        settle(g, v, v->m_pendingMisc, false, err);
    }
    viewsById.clear();
    updateKeepAlive();
}

void HostClient::onClose()
{
    rejectAllAndMarkDead("WebView host process died"_s);
}

void HostClient::onData(const char* data, int length)
{
    rx.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(data), static_cast<size_t>(length)));

    auto& vm = global->vm();
    // TopExceptionScope is the event-loop catch-all (same pattern as
    // performMicrotaskCheckpoint). Its dtor doesn't simulate.
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    Bun__EventLoop__enter(global);

    size_t off = 0;
    while (rx.size() - off >= sizeof(Frame)) {
        Frame h;
        memcpy(&h, rx.span().data() + off, sizeof(h));
        if (h.len > kMaxFrameLen) [[unlikely]] {
            // Child memory corruption. Stop parsing; rx tail is dead weight
            // until socket close, but we won't livelock growing it forever.
            rejectAllAndMarkDead("WebView host sent a corrupt frame"_s);
            break;
        }
        if (rx.size() - off < sizeof(Frame) + h.len) break;
        Reader r { rx.span().data() + off + sizeof(Frame),
            rx.span().data() + off + sizeof(Frame) + h.len };
        off += sizeof(Frame) + h.len;

        handleReply(h, r);
        // createError/jsString/createUninitialized can throw (OOM). Report +
        // clear so one bad frame doesn't poison the rest of the batch.
        if (auto* exception = catchScope.exception()) [[unlikely]] {
            if (!catchScope.clearExceptionExceptTermination()) break;
            global->reportUncaughtExceptionAtEventLoop(global, exception);
        }
    }
    if (off) rx.removeAt(0, off);

    // exit() drains microtasks when outermost — all the reactions from
    // resolve()s above run here, before we return to usockets.
    Bun__EventLoop__exit(global);
}

// Create promise, store in barrier, write frame. Caller guarantees the slot
// is empty (INVALID_STATE thrown in the prototype method before calling into
// the instance method that ends up here).
JSPromise* sendOp(JSGlobalObject* g, JSWebView* view, WriteBarrier<JSPromise>& slot,
    Op op, const uint8_t* payload, uint32_t len)
{
    auto& vm = g->vm();
    auto* promise = JSPromise::create(vm, g->promiseStructure());
    auto& client = hostClient();
    if (!client.sock || client.dead || us_socket_is_closed(0, client.sock)) {
        promise->reject(vm, g, createError(g, "WebView host process is not running"_s));
        return promise;
    }
    // Inc BEFORE slot.set so GC never observes a set slot with count==0.
    // Release ordering: the slot write below must not be reordered above this.
    view->m_pendingActivityCount.fetch_add(1, std::memory_order_release);
    slot.set(vm, view, promise);
    client.writeFrame(op, view->m_viewId, payload, len);
    return promise;
}

} // anonymous namespace

// Called from Zig's onProcessExit (EVFILT_PROC). The socket onClose may or
// may not have fired (crash = no FIN). Idempotent with onClose.
extern "C" void Bun__WebViewHost__childDied(int32_t signo)
{
    auto& client = hostClient();
    if (client.dead) return;
    client.rejectAllAndMarkDead(signo
            ? makeString("WebView host process killed by signal "_s, signo)
            : "WebView host process exited"_s);
}

#endif // OS(DARWIN)

#if !OS(DARWIN)
// HostProcess.zig references this unconditionally via @extern; Zig's dead-code
// elimination doesn't trigger because the TaggedPointer dispatch switch in
// process.zig pulls in all ProcessExitHandler arms. spawn() itself is gated
// on Environment.isMac so this is never called.
extern "C" void Bun__WebViewHost__childDied(int32_t) {}
#endif

// --- JSWebView class -------------------------------------------------------

JSWebView::JSWebView(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

JSWebView* JSWebView::create(VM& vm, Structure* structure)
{
    JSWebView* instance = new (NotNull, allocateCell<JSWebView>(vm)) JSWebView(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

void JSWebView::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSWebView::~JSWebView()
{
#if OS(DARWIN)
    // We do NOT send Close from here. The destructor runs during GC;
    // JSPromise::create is unsafe (allocating in collection), and a
    // req_id=0 frame would be misrouted as an unsolicited event by the
    // parent's reply handler. The child-side view leaks for process
    // lifetime — bounded, and the user was supposed to call close().
    if (!m_closed && m_viewId) {
        auto& client = hostClient();
        client.viewsById.erase(m_viewId);
        client.updateKeepAlive();
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
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_onNavigated);
    visitor.append(thisObject->m_onNavigationFailed);
    visitor.append(thisObject->m_pendingNavigate);
    visitor.append(thisObject->m_pendingEval);
    visitor.append(thisObject->m_pendingScreenshot);
    visitor.append(thisObject->m_pendingMisc);
}

DEFINE_VISIT_CHILDREN(JSWebView);

const ClassInfo JSWebView::s_info = { "WebView"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebView) };

#if OS(DARWIN)

// --- Instance operations ---------------------------------------------------
// Called from JSWebViewPrototype.cpp after arg validation. Wire encoding is
// the typed payload structs from ipc_protocol.h; no inline memcpy here.

JSPromise* JSWebView::navigate(JSGlobalObject* g, const WTF::String& url)
{
    auto payload = encodeStr(url);
    auto* promise = sendOp(g, this, m_pendingNavigate, Op::Navigate,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
    // After sendOp so m_loading isn't stuck true if the host is dead and
    // sendOp rejected without ever touching the slot.
    if (m_pendingNavigate) m_loading = true;
    return promise;
}

JSPromise* JSWebView::evaluate(JSGlobalObject* g, const WTF::String& script)
{
    auto payload = encodeStr(script);
    return sendOp(g, this, m_pendingEval, Op::Evaluate,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::screenshot(JSGlobalObject* g)
{
    return sendOp(g, this, m_pendingScreenshot, Op::Screenshot, nullptr, 0);
}

JSPromise* JSWebView::click(JSGlobalObject* g, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto payload = encode(ClickPayload { x, y, button, modifiers, clickCount });
    return sendOp(g, this, m_pendingMisc, Op::Click,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::clickSelector(JSGlobalObject* g, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto payload = encode(ClickSelectorPayload { timeout, button, modifiers, clickCount }, selector);
    return sendOp(g, this, m_pendingMisc, Op::ClickSelector,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::type(JSGlobalObject* g, const WTF::String& text)
{
    auto payload = encodeStr(text);
    return sendOp(g, this, m_pendingMisc, Op::Type,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::press(JSGlobalObject* g, VirtualKey key, uint8_t modifiers, const WTF::String& character)
{
    // Tail string is null for named keys, present for VirtualKey::Character.
    // encode() skips the tail encoding when the string is null.
    auto payload = encode(PressPayload { static_cast<uint8_t>(key), modifiers },
        key == VirtualKey::Character ? character : WTF::String());
    return sendOp(g, this, m_pendingMisc, Op::Press,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::scroll(JSGlobalObject* g, double dx, double dy)
{
    auto payload = encode(ScrollPayload { static_cast<float>(dx), static_cast<float>(dy) });
    return sendOp(g, this, m_pendingMisc, Op::Scroll,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::scrollTo(JSGlobalObject* g, const WTF::String& selector, uint32_t timeout, uint8_t block)
{
    auto payload = encode(ScrollToPayload { timeout, block }, selector);
    return sendOp(g, this, m_pendingMisc, Op::ScrollTo,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::resize(JSGlobalObject* g, uint32_t width, uint32_t height)
{
    auto payload = encode(ResizePayload { width, height });
    return sendOp(g, this, m_pendingMisc, Op::Resize,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* JSWebView::goBack(JSGlobalObject* g) { return sendOp(g, this, m_pendingMisc, Op::GoBack, nullptr, 0); }
JSPromise* JSWebView::goForward(JSGlobalObject* g) { return sendOp(g, this, m_pendingMisc, Op::GoForward, nullptr, 0); }
JSPromise* JSWebView::reload(JSGlobalObject* g) { return sendOp(g, this, m_pendingMisc, Op::Reload, nullptr, 0); }

void JSWebView::doClose()
{
    m_closed = true;
    auto& client = hostClient();

    // Reject any pending promises before erasing from the routing table —
    // otherwise the child's replies find no entry, the promises hang, and
    // m_pendingActivityCount stays >0 so isReachableFromOpaqueRoots keeps
    // this object alive forever. Same per-slot rejection as
    // rejectAllAndMarkDead.
    if (client.global) {
        auto* g = client.global;
        JSValue err = createError(g, "WebView closed"_s);
        settle(g, this, m_pendingNavigate, false, err);
        settle(g, this, m_pendingEval, false, err);
        settle(g, this, m_pendingScreenshot, false, err);
        settle(g, this, m_pendingMisc, false, err);
    }

    // Fire-and-forget: no slot (view is going away), child's Ack finds no
    // entry in viewsById and drops. Erase AFTER write so keep-alive stays
    // ref'd long enough for the frame to reach the socket buffer.
    client.writeFrame(Op::Close, m_viewId, nullptr, 0);
    client.viewsById.erase(m_viewId);
    client.updateKeepAlive();
}

// --- Constructor entry -----------------------------------------------------

JSWebView* JSWebView::createAndSend(JSGlobalObject* g, Structure* structure,
    uint32_t width, uint32_t height, const WTF::String& persistDir)
{
    auto* zig = defaultGlobalObject(g);
    auto& client = hostClient();
    // Lazy-spawn the host. Synchronous — spawn returns after fork+exec,
    // before the child finishes init. The socket is writable immediately
    // (kernel buffers); the child reads on its first CFRunLoop tick.
    if (!client.ensureSpawned(zig)) return nullptr;

    JSWebView* view = create(g->vm(), structure);
    view->m_viewId = client.nextViewId++;
    client.viewsById.emplace(view->m_viewId, Weak<JSWebView>(view, &webViewWeakOwner()));
    client.updateKeepAlive();

    // Fire-and-forget — no promise, no slot. If WKWebView alloc fails
    // (exceedingly rare), subsequent ops get Reply::Error from the child's
    // "invalid viewId" lookup. Simpler than an async constructor.
    bool persistent = !persistDir.isEmpty();
    auto payload = encode(
        CreatePayload { width, height,
            static_cast<uint8_t>(persistent ? DataStoreKind::Persistent : DataStoreKind::Ephemeral) },
        persistent ? persistDir : WTF::String());
    client.writeFrame(Op::Create, view->m_viewId,
        payload.span().data(), static_cast<uint32_t>(payload.size()));

    return view;
}

#endif // OS(DARWIN)

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
