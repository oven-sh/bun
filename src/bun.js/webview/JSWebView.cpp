#include "root.h"
#include "JSWebView.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/WeakHandleOwner.h>
#include <wtf/text/MakeString.h>

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
// Spawn + process-exit watch in Zig (reuses bun.spawn.Process / EVFILT_PROC).
extern "C" int32_t Bun__WebViewHost__ensure(Zig::GlobalObject*);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);
// Bracket the whole onData batch. exit() drains microtasks when outermost,
// so all the promise reactions from this batch run before we return to
// usockets.
extern "C" void Bun__EventLoop__enter(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__exit(Zig::GlobalObject*);
// runCallback does its own nested enter/exit + reportActiveExceptionAsUnhandled
// on throw — one bad onNavigated callback won't poison the rest of the batch.
extern "C" void Bun__EventLoop__runCallback2(JSC::JSGlobalObject*, JSC::EncodedJSValue cb,
    JSC::EncodedJSValue thisVal, JSC::EncodedJSValue arg0, JSC::EncodedJSValue arg1);

using namespace WebViewProto;

// ---------------------------------------------------------------------------
// HostClient: parent-side state for the single host subprocess.
// Static — one host per Bun process, lazy-spawned.
// Everything runs on the JS thread (usockets callbacks fire there).
//
// No Strong<>, no req_id map. Promises live in WriteBarrier slots on
// JSWebView; the frame header carries viewId. Reply arrives → viewsById[viewId]
// (Weak) → Reply type picks the slot. If the user drops view + promise, GC
// takes both; the reply finds a dead Weak and discards.
//
// The viewsById Weak<> has a WeakHandleOwner: isReachableFromOpaqueRoots
// returns true while any pending slot is set. Under `bun test` the closure →
// view → m_pendingNavigate → promise → reaction → closure cycle has no
// external root (the test-function promise goes out of Zig scope after
// runTestCallback returns). This predicate IS the root.
// ---------------------------------------------------------------------------
namespace {

class JSWebViewWeakOwner final : public JSC::WeakHandleOwner {
    bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, JSC::AbstractSlotVisitor&, ASCIILiteral* reason) final
    {
        auto* view = jsCast<JSWebView*>(handle.slot()->asCell());
        if (view->m_pendingActivityCount.load(std::memory_order_acquire) == 0)
            return false;
        if (reason) [[unlikely]] *reason = "WebView with pending operation"_s;
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

HostClient s_client;

us_socket_t* hostOnData(us_socket_t* s, char* data, int length)
{
    s_client.onData(data, length);
    return s;
}
us_socket_t* hostOnWritable(us_socket_t* s) { s_client.onWritable(); return s; }
us_socket_t* hostOnClose(us_socket_t* s, int, void*) { s_client.onClose(); return s; }
us_socket_t* hostOnEnd(us_socket_t* s) { s_client.onClose(); return s; }
us_socket_t* hostOnOpen(us_socket_t* s, int, char*, int) { return s; }

bool HostClient::ensureSpawned(Zig::GlobalObject* zig)
{
    if (sock && !dead) return true;
    if (dead) return false;

    int fd = Bun__WebViewHost__ensure(zig);
    if (fd < 0) { dead = true; return false; }
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
    if (!sock) { dead = true; return false; }
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
        Reader r{ rx.span().data() + off + sizeof(Frame),
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

// Returns Uint8Array on success, JS Error on failure. May throw (OOM in
// createUninitialized); caller's scope in onData reports + clears.
static JSValue openShmScreenshot(JSGlobalObject* g, const char* name, uint32_t nameLen, uint32_t pngLen)
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
        return jsUndefined();
    }
    memcpy(u8->typedVector(), map, pngLen);
    munmap(map, pngLen);
    RELEASE_AND_RETURN(scope, u8);
}

// Settle = read, clear, dec activity, resolve-or-reject. Slot cleared BEFORE
// the call into JS so a re-entrant navigate() inside a .then() sees an empty
// slot. Activity decremented AFTER clear (GC seeing count>0 with a clear
// slot is benign — one extra mark cycle).
static void settle(JSGlobalObject* g, JSWebView* view, WriteBarrier<JSPromise>& slot, bool ok, JSValue v)
{
    JSPromise* p = slot.get();
    if (!p) return;
    slot.clear();
    view->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
    if (ok) p->resolve(g, v);
    else    p->reject(g->vm(), g, v);
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
        settle(g, view, view->m_pendingNavigate, false, createError(g, r.str()));
        return;

    case Reply::EvalDone: {
        WTF::String s = r.str();
        settle(g, view, view->m_pendingEval, true,
            s.isEmpty() ? JSValue(jsUndefined()) : JSValue(jsString(vm, s)));
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
        settle(g, v, v->m_pendingNavigate,   false, err);
        settle(g, v, v->m_pendingEval,       false, err);
        settle(g, v, v->m_pendingScreenshot, false, err);
        settle(g, v, v->m_pendingMisc,       false, err);
    }
    viewsById.clear();
    updateKeepAlive();
}

void HostClient::onClose()
{
    rejectAllAndMarkDead("WebView host process died"_s);
}

// Pack an inline string: u32 len + bytes. viewId is in the frame header.
WTF::Vector<uint8_t, 512> packStr(const WTF::String& s)
{
    WTF::CString c = s.utf8();
    uint32_t n = static_cast<uint32_t>(c.length());
    WTF::Vector<uint8_t, 512> out;
    out.grow(4 + n);
    uint8_t* p = out.mutableSpan().data();
    memcpy(p, &n, 4);
    memcpy(p + 4, c.data(), n);
    return out;
}

// Send with slot — creates the promise, stores in the barrier, writes frame.
// Caller guarantees slot is empty (checked before call, INVALID_STATE thrown).
JSPromise* sendOp(JSGlobalObject* g, JSWebView* view, WriteBarrier<JSPromise>& slot,
    Op op, const uint8_t* payload, uint32_t len)
{
    auto& vm = g->vm();
    auto* promise = JSPromise::create(vm, g->promiseStructure());
    if (!s_client.sock || s_client.dead || us_socket_is_closed(0, s_client.sock)) {
        promise->reject(vm, g, createError(g, "WebView host process is not running"_s));
        return promise;
    }
    // Inc BEFORE slot.set so GC never observes a set slot with count==0.
    // Release ordering: the slot write below must not be reordered above this.
    view->m_pendingActivityCount.fetch_add(1, std::memory_order_release);
    slot.set(vm, view, promise);
    s_client.writeFrame(op, view->m_viewId, payload, len);
    return promise;
}

} // anonymous namespace

// Called from Zig's onProcessExit (EVFILT_PROC). The socket onClose may or
// may not have fired (crash = no FIN). Idempotent with onClose.
extern "C" void Bun__WebViewHost__childDied(int32_t signo)
{
    if (s_client.dead) return;
    s_client.rejectAllAndMarkDead(signo
        ? makeString("WebView host process killed by signal "_s, signo)
        : "WebView host process exited"_s);
}

#endif // OS(DARWIN)

// ---------------------------------------------------------------------------
// JSWebView class scaffolding
// ---------------------------------------------------------------------------

JSC_DECLARE_HOST_FUNCTION(callWebView);
JSC_DECLARE_HOST_FUNCTION(constructWebView);

static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncNavigate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncEvaluate);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScreenshot);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncClick);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncType);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncPress);
static JSC_DECLARE_HOST_FUNCTION(jsWebViewProtoFuncScroll);
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
        s_client.viewsById.erase(m_viewId);
        s_client.updateKeepAlive();
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

// --- Prototype -------------------------------------------------------------

class JSWebViewPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWebViewPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
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

// --- Constructor -----------------------------------------------------------

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

#if !OS(DARWIN)
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,
        "Bun.WebView is not yet implemented on this platform"_s);
#else
    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    uint32_t width = 800, height = 600;
    WTF::String persistDir;

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

    if (width == 0 || height == 0 || width > 16384 || height > 16384) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "width/height"_s, 1, 16384, jsNumber(width));
    }

    // Lazy-spawn the host. Synchronous — spawn returns after fork+exec,
    // before the child finishes init. The socket is writable immediately
    // (kernel buffers); the child reads on its first CFRunLoop tick.
    if (!s_client.ensureSpawned(zigGlobalObject)) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_DLOPEN_FAILED,
            "Failed to spawn WebView host process"_s);
    }

    Structure* structure = zigGlobalObject->m_JSWebViewClassStructure.get(zigGlobalObject);
    JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSWebViewClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(),
            functionGlobalObject->m_JSWebViewClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSWebView* view = JSWebView::create(vm, structure);
    view->m_viewId = s_client.nextViewId++;
    s_client.viewsById.emplace(view->m_viewId, Weak<JSWebView>(view, &webViewWeakOwner()));
    s_client.updateKeepAlive();

    // Create payload: u32 w, u32 h, u8 kind, [u32 dirLen, dir]. viewId is in
    // the frame header. Fire-and-forget — no promise, no slot. If WKWebView
    // alloc fails (exceedingly rare), subsequent ops get Reply::Error from
    // the child's "invalid viewId" lookup. Simpler than an async constructor.
    WTF::CString dir = persistDir.utf8();
    uint32_t dirLen = static_cast<uint32_t>(dir.length());
    bool persistent = !persistDir.isEmpty();
    WTF::Vector<uint8_t, 64> payload;
    payload.grow(4 + 4 + 1 + (persistent ? 4 + dirLen : 0));
    uint8_t* p = payload.mutableSpan().data();
    memcpy(p, &width, 4);  p += 4;
    memcpy(p, &height, 4); p += 4;
    *p++ = persistent ? static_cast<uint8_t>(DataStoreKind::Persistent)
                      : static_cast<uint8_t>(DataStoreKind::Ephemeral);
    if (persistent) {
        memcpy(p, &dirLen, 4); p += 4;
        memcpy(p, dir.data(), dirLen);
    }
    s_client.writeFrame(Op::Create, view->m_viewId, payload.span().data(), static_cast<uint32_t>(payload.size()));

    return JSValue::encode(view);
#endif
}

// --- Prototype method helpers ----------------------------------------------

#if OS(DARWIN)
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

// Simple ops: empty payload, reply is Ack → m_pendingMisc slot.
static EncodedJSValue sendSimpleOp(JSGlobalObject* g, CallFrame* cf, Op op, ASCIILiteral method)
{
    auto& vm = g->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* view = unwrapThis(g, scope, cf, method);
    RETURN_IF_EXCEPTION(scope, {});
    if (view->m_pendingMisc) {
        Bun::ERR::INVALID_STATE(scope, g, makeString("WebView."_s, method, ": a simple operation is already pending"_s));
        return {};
    }
    return JSValue::encode(sendOp(g, view, view->m_pendingMisc, op, nullptr, 0));
}
#endif

#define WEBVIEW_UNIMPLEMENTED_BODY(method)                                                               \
    VM& vm = globalObject->vm();                                                                         \
    auto scope = DECLARE_THROW_SCOPE(vm);                                                                \
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_METHOD_NOT_IMPLEMENTED,                   \
        "Bun.WebView." method " is not yet implemented on this platform"_s);

// --- Prototype methods -----------------------------------------------------

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
    if (!urlArg.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "url"_s, "string"_s, urlArg);
    }
    WTF::String url = urlArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (thisObject->m_pendingNavigate) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "a navigation is already pending"_s);
        return {};
    }
    thisObject->m_loading = true;
    auto payload = packStr(url);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingNavigate,
        Op::Navigate, payload.span().data(), static_cast<uint32_t>(payload.size())));
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
    if (!scriptArg.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "script"_s, "string"_s, scriptArg);
    }
    WTF::String script = scriptArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (thisObject->m_pendingEval) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "an evaluate() is already pending"_s);
        return {};
    }
    auto payload = packStr(script);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingEval,
        Op::Evaluate, payload.span().data(), static_cast<uint32_t>(payload.size())));
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
    if (thisObject->m_pendingScreenshot) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "a screenshot() is already pending"_s);
        return {};
    }
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingScreenshot,
        Op::Screenshot, nullptr, 0));
#endif
}

// click/type/scroll desugar to evaluate() with generated JS.

// --- Native input ---------------------------------------------------------
// click/type/most of press use WebKit's own completion SPIs in the child:
// _doAfterProcessingAllPendingMouseEvents: (click) and _executeEditCommand:
// (type, editing-key press). Ack arrives when WebContent has processed the
// input, not just when it's been queued. Escape and modifier chords fall
// back to keyDown with immediate Ack (WebKit has no keyboard barrier SPI).

#if OS(DARWIN)
static uint8_t parseModifiers(JSGlobalObject* g, ThrowScope& scope, JSValue v)
{
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
        if (s == "shift"_s)      mods |= ModShift;
        else if (s == "ctrl"_s || s == "control"_s) mods |= ModCtrl;
        else if (s == "alt"_s || s == "option"_s)   mods |= ModAlt;
        else if (s == "meta"_s || s == "cmd"_s || s == "command"_s) mods |= ModMeta;
    }
    return mods;
}
#endif

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClick, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("click")
#else
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = unwrapThis(globalObject, scope, callFrame, "click"_s);
    RETURN_IF_EXCEPTION(scope, {});

    double x = callFrame->argument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    double y = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Optional { button: "left"|"right"|"middle", modifiers: [...], clickCount }
    uint8_t button = 0, mods = 0, clickCount = 1;
    JSValue opts = callFrame->argument(2);
    if (opts.isObject()) {
        JSObject* o = opts.getObject();
        JSValue b = o->get(globalObject, Identifier::fromString(vm, "button"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (b.isString()) {
            WTF::String bs = b.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (bs == "right"_s) button = 1;
            else if (bs == "middle"_s) button = 2;
        }
        JSValue m = o->get(globalObject, Identifier::fromString(vm, "modifiers"_s));
        RETURN_IF_EXCEPTION(scope, {});
        mods = parseModifiers(globalObject, scope, m);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue cc = o->get(globalObject, Identifier::fromString(vm, "clickCount"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (cc.isNumber()) clickCount = static_cast<uint8_t>(std::clamp(cc.toInt32(globalObject), 1, 3));
        RETURN_IF_EXCEPTION(scope, {});
    }

    if (thisObject->m_pendingMisc) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "WebView.click: a simple operation is already pending"_s);
        return {};
    }

    // f32 x, f32 y, u8 button, u8 modifiers, u8 clickCount
    uint8_t payload[11];
    float fx = static_cast<float>(x), fy = static_cast<float>(y);
    memcpy(payload,     &fx, 4);
    memcpy(payload + 4, &fy, 4);
    payload[8]  = button;
    payload[9]  = mods;
    payload[10] = clickCount;
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingMisc, Op::Click, payload, 11));
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
    if (!textArg.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "text"_s, "string"_s, textArg);
    }
    WTF::String text = textArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (thisObject->m_pendingMisc) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "WebView.type: a simple operation is already pending"_s);
        return {};
    }

    // Child iterates per code unit (surrogate pairs paired), emits keydown+
    // keyup with keyCode=0. Text routes through the editing pipeline —
    // input/beforeinput fire, maxlength respected, IME-aware.
    auto payload = packStr(text);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingMisc,
        Op::Type, payload.span().data(), static_cast<uint32_t>(payload.size())));
#endif
}

#if OS(DARWIN)
// JS string name → wire tag. Order must match the enum in ipc_protocol.h
// (static_assert there enforces it matches the child's table too).
static VirtualKey virtualKeyFromName(const WTF::String& s)
{
    struct { ASCIILiteral name; VirtualKey k; } table[] = {
        { "Enter"_s,      VirtualKey::Enter },
        { "Tab"_s,        VirtualKey::Tab },
        { "Space"_s,      VirtualKey::Space },
        { "Backspace"_s,  VirtualKey::Backspace },
        { "Delete"_s,     VirtualKey::Delete },
        { "Escape"_s,     VirtualKey::Escape },
        { "ArrowLeft"_s,  VirtualKey::ArrowLeft },
        { "ArrowRight"_s, VirtualKey::ArrowRight },
        { "ArrowUp"_s,    VirtualKey::ArrowUp },
        { "ArrowDown"_s,  VirtualKey::ArrowDown },
        { "Home"_s,       VirtualKey::Home },
        { "End"_s,        VirtualKey::End },
        { "PageUp"_s,     VirtualKey::PageUp },
        { "PageDown"_s,   VirtualKey::PageDown },
    };
    for (auto& e : table) if (s == e.name) return e.k;
    return VirtualKey::Character;
}
#endif

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
    if (!keyArg.isString()) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "key"_s, "string"_s, keyArg);
    }
    WTF::String key = keyArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    uint8_t mods = parseModifiers(globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    VirtualKey vk = virtualKeyFromName(key);
    if (vk == VirtualKey::Character && key.length() != 1) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, globalObject, "key"_s, keyArg,
            "must be a virtual key name (Enter, Tab, Escape, Arrow*, etc.) or a single character"_s);
    }

    if (thisObject->m_pendingMisc) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "WebView.press: a simple operation is already pending"_s);
        return {};
    }

    // u8 tag, u8 modifiers, [str char iff Character]. 2 bytes for named keys.
    if (vk != VirtualKey::Character) {
        uint8_t payload[2] = { static_cast<uint8_t>(vk), mods };
        return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingMisc,
            Op::Press, payload, 2));
    }
    WTF::CString c = key.utf8();
    uint32_t clen = static_cast<uint32_t>(c.length());
    WTF::Vector<uint8_t, 16> payload;
    payload.grow(2 + 4 + clen);
    uint8_t* p = payload.mutableSpan().data();
    *p++ = static_cast<uint8_t>(vk);
    *p++ = mods;
    memcpy(p, &clen, 4); p += 4;
    memcpy(p, c.data(), clen);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingMisc,
        Op::Press, payload.span().data(), static_cast<uint32_t>(payload.size())));
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

    if (thisObject->m_pendingEval) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "an evaluate() is already pending"_s);
        return {};
    }
    auto js = makeString("window.scrollBy("_s, dx, ","_s, dy, ")"_s);
    auto payload = packStr(js);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingEval,
        Op::Evaluate, payload.span().data(), static_cast<uint32_t>(payload.size())));
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
    if (w == 0 || h == 0 || w > 16384 || h > 16384) {
        return Bun::ERR::OUT_OF_RANGE(scope, globalObject, "width/height"_s, 1, 16384, jsNumber(w));
    }
    if (thisObject->m_pendingMisc) {
        Bun::ERR::INVALID_STATE(scope, globalObject, "WebView.resize: a simple operation is already pending"_s);
        return {};
    }
    uint8_t payload[8];
    memcpy(payload,     &w, 4);
    memcpy(payload + 4, &h, 4);
    return JSValue::encode(sendOp(globalObject, thisObject, thisObject->m_pendingMisc, Op::Resize, payload, 8));
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncBack, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("back")
#else
    return sendSimpleOp(globalObject, callFrame, Op::GoBack, "back"_s);
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncForward, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("forward")
#else
    return sendSimpleOp(globalObject, callFrame, Op::GoForward, "forward"_s);
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncReload, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    WEBVIEW_UNIMPLEMENTED_BODY("reload")
#else
    return sendSimpleOp(globalObject, callFrame, Op::Reload, "reload"_s);
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsWebViewProtoFuncClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
#if !OS(DARWIN)
    return JSValue::encode(jsUndefined());
#else
    auto* thisObject = jsDynamicCast<JSWebView*>(callFrame->thisValue());
    if (!thisObject || thisObject->m_closed) {
        return JSValue::encode(jsUndefined());
    }
    thisObject->m_closed = true;
    // Fire-and-forget: no slot (view is going away), child's Ack finds no
    // entry in viewsById and drops. Erase AFTER write so keep-alive stays
    // ref'd long enough for the frame to reach the socket buffer.
    s_client.writeFrame(Op::Close, thisObject->m_viewId, nullptr, 0);
    s_client.viewsById.erase(thisObject->m_viewId);
    s_client.updateKeepAlive();
    return JSValue::encode(jsUndefined());
#endif
}

// --- Getters ---------------------------------------------------------------

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

// --- Callback accessors ----------------------------------------------------

#define WEBVIEW_CALLBACK_ACCESSOR(Name, field)                                                                   \
    JSC_DEFINE_CUSTOM_GETTER(jsWebViewGetter_##Name, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))  \
    {                                                                                                            \
        auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));                                \
        if (!thisObject) return JSValue::encode(jsUndefined());                                                  \
        JSObject* cb = thisObject->field.get();                                                                  \
        return JSValue::encode(cb ? JSValue(cb) : jsNull());                                                     \
    }                                                                                                            \
    JSC_DEFINE_CUSTOM_SETTER(jsWebViewSetter_##Name,                                                             \
        (JSGlobalObject * globalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))    \
    {                                                                                                            \
        auto* thisObject = jsDynamicCast<JSWebView*>(JSValue::decode(thisValue));                                \
        if (!thisObject) return false;                                                                           \
        JSValue value = JSValue::decode(encodedValue);                                                           \
        if (value.isUndefinedOrNull()) {                                                                         \
            thisObject->field.clear();                                                                           \
        } else if (value.isCallable()) {                                                                         \
            thisObject->field.set(globalObject->vm(), thisObject, value.getObject());                            \
        } else {                                                                                                 \
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());                                                \
            Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "callback"_s, "function"_s, value);                  \
            return false;                                                                                        \
        }                                                                                                        \
        return true;                                                                                             \
    }

WEBVIEW_CALLBACK_ACCESSOR(onNavigated, m_onNavigated)
WEBVIEW_CALLBACK_ACCESSOR(onNavigationFailed, m_onNavigationFailed)

#undef WEBVIEW_CALLBACK_ACCESSOR

// --- Setup -----------------------------------------------------------------

void setupJSWebViewClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSWebViewPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSWebViewPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSWebViewConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSWebViewConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSWebView::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
