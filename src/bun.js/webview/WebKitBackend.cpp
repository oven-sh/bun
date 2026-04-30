// WebKitBackend: HostClient (usockets wire to the host subprocess) + all
// WK::Ops (per-view IPC commands). JSWebView's dispatching instance methods
// call into WK::Ops::*; everything Darwin-specific lives here.

#include "root.h"
#include "WebKitBackend.h"
#include "JSWebView.h"

#if OS(DARWIN)

#include "bun-uws/src/SocketKinds.h"
#include "ipc_protocol.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/Base64.h>
#include <wtf/NeverDestroyed.h>
#include <mutex>

#include "libusockets.h"
#include "_libusockets.h"
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

namespace Bun {
namespace WK {

using namespace JSC;
using namespace WebViewProto;

// Spawn + process-exit watch in Zig (reuses bun.spawn.Process / EVFILT_PROC).
extern "C" int32_t Bun__WebViewHost__ensure(Zig::GlobalObject*, bool stdoutInherit, bool stderrInherit);
extern "C" void* Blob__fromMmapWithType(JSC::JSGlobalObject*, uint8_t* ptr, size_t len, const char* mime);
extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(Zig::GlobalObject*, void* impl);
extern "C" JSC::EncodedJSValue JSBuffer__fromMmap(Zig::GlobalObject*, void* ptr, size_t length);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);
// Bracket the whole onData batch. exit() drains microtasks when outermost,
// so all the promise reactions from this batch run before we return to usockets.
extern "C" void Bun__EventLoop__enter(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__exit(Zig::GlobalObject*);
// runCallback does its own nested enter/exit + reportActiveExceptionAsUnhandled
// on throw — one bad onNavigated callback won't poison the rest of the batch.
extern "C" void Bun__EventLoop__runCallback2(JSC::JSGlobalObject*, JSC::EncodedJSValue cb,
    JSC::EncodedJSValue thisVal, JSC::EncodedJSValue arg0, JSC::EncodedJSValue arg1);

// --- HostClient singleton --------------------------------------------------
// No Strong<>, no req_id map. Promises live in WriteBarrier slots on
// JSWebView; the frame header carries viewId. Reply arrives → viewsById[viewId]
// (Weak) → Reply type picks the slot. If the user drops view + promise, GC
// takes both; the reply finds a dead Weak and discards.

// No static top-level initializers. HostClient's default ctor is trivial
// (just member inits), but the Vector/unordered_map members have non-trivial
// ctors that would run at image load. LazyNeverDestroyed + call_once defers
// to first use — which is always on the JS thread via ensureSpawned(), so
// the once_flag doesn't contend.
HostClient& client()
{
    static LazyNeverDestroyed<HostClient> instance;
    static std::once_flag once;
    std::call_once(once, [] { instance.construct(); });
    return instance.get();
}

// One group per process — reused across host respawns. Embedded (not
// heap-alloc'd) and lazily linked into the loop on first socket. The vtable
// is static-const since the singleton handlers never change.
static us_socket_group_t s_hostGroup;

static us_socket_t* hostOnData(us_socket_t* s, char* data, int length)
{
    client().onData(data, length);
    return s;
}
static us_socket_t* hostOnWritable(us_socket_t* s)
{
    client().onWritable();
    return s;
}
static us_socket_t* hostOnClose(us_socket_t* s, int, void*)
{
    client().onClose();
    return s;
}
static us_socket_t* hostOnEnd(us_socket_t* s)
{
    client().onClose();
    return s;
}
static us_socket_t* hostOnOpen(us_socket_t* s, int, char*, int) { return s; }

static constexpr us_socket_vtable_t s_hostVTable = {
    .on_open = hostOnOpen,
    .on_data = hostOnData,
    .on_fd = nullptr,
    .on_writable = hostOnWritable,
    .on_close = hostOnClose,
    .on_timeout = nullptr,
    .on_long_timeout = nullptr,
    .on_end = hostOnEnd,
    .on_connect_error = nullptr,
    .on_connecting_error = nullptr,
    .on_handshake = nullptr,
    .is_low_prio = nullptr,
};

// us_socket_ref/unref are no-ops on kqueue, and us_poll_start_rc doesn't
// touch loop.active. Track our own ref against view count. A view with
// pending ops keeps itself alive via visitChildren → promise → reaction
// → closure → view, so "any views" covers "any pending".
void HostClient::updateKeepAlive()
{
    bool want = !viewsById.empty();
    if (want == sockRefd || !global) return;
    sockRefd = want;
    Bun__eventLoop__incrementRefConcurrently(
        WebCore::clientData(global->vm())->bunVM, want ? 1 : -1);
}

bool HostClient::ensureSpawned(Zig::GlobalObject* zig, bool stdoutInherit, bool stderrInherit)
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

    int fd = Bun__WebViewHost__ensure(zig, stdoutInherit, stderrInherit);
    if (fd < 0) {
        dead = true;
        return false;
    }
    global = zig;

    // Socket group — once. Embedded; lazily linked into the loop on first
    // socket. on_open won't fire (us_socket_from_fd doesn't call it) but a
    // null vtable entry is fine — dispatch skips nulls.
    if (!s_hostGroup.loop) {
        us_socket_group_init(&s_hostGroup, uws_get_loop(), &s_hostVTable, nullptr);
    }

    // us_socket_from_fd sets nonblocking/nodelay/no-sigpipe and polls
    // READABLE|WRITABLE. ipc=0 — we're not doing SCM_RIGHTS fd passing.
    // us_poll_start_rc doesn't touch loop.active; updateKeepAlive is the
    // sole ref manager. kind=1 (.dynamic) → dispatch via s_hostVTable.
    sock = us_socket_from_fd(&s_hostGroup, BUN_SOCKET_KIND_DYNAMIC, nullptr, sizeof(void*), fd, 0);
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
    if (!sock || dead || us_socket_is_closed(sock)) return;
    Frame h = { len, viewId, static_cast<uint8_t>(op) };
    const auto* hbytes = reinterpret_cast<const uint8_t*>(&h);
    if (txQueue.isEmpty()) {
        // us_socket_write2 does writev(header, payload) and auto-enables the
        // writable poll on short write. Returns bytes written (≥0, never -1).
        int w = us_socket_write2(sock,
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
        int w = us_socket_write(sock,
            reinterpret_cast<const char*>(txQueue.span().data()),
            static_cast<int>(txQueue.size()));
        if (w <= 0) return; // usockets re-enables writable poll on short write
        txQueue.removeAt(0, static_cast<size_t>(w));
    }
}

// Open + mmap the child-written shm segment. The child already munmapped
// its side before sendReply, so we're the sole mapper. O_RDWR + PROT_WRITE
// because the Zig allocator wrapper poisons with @memset(undefined) in
// safe builds BEFORE the vtable free (which munmap's) — a PROT_READ
// mapping SIGBUS'd on that poison. MAP_SHARED is required for POSIX shm
// objects on macOS — MAP_PRIVATE returns EINVAL (the kernel's posix_shm
// vfs doesn't implement VM_BEHAVIOR_COPY). Returns nullptr on failure
// with errno set; caller reports it.
static void* mapShm(const char* zname, size_t byteLen, int& outErr)
{
    int fd = shm_open(zname, O_RDWR, 0);
    if (fd < 0) {
        outErr = errno;
        return nullptr;
    }
    void* map = mmap(nullptr, byteLen, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    outErr = (map == MAP_FAILED) ? errno : 0;
    ::close(fd); // after capturing errno
    if (map == MAP_FAILED) return nullptr;
    return map;
}

// Dispatch the child-written shm segment to the requested JS shape. For
// Blob/Buffer the mapping is adopted zero-copy — the JS object's
// destructor munmap's. For Base64 we map, encode into a JS string, unmap
// (one materialization, unavoidable). For Shmem we don't touch the
// segment at all — just hand back the name + size for Kitty graphics
// protocol t=s transmission (or manual shm_open from another process);
// caller owns shm_unlink.
static JSValue openShmScreenshot(JSGlobalObject* g, const char* name, uint32_t nameLen, uint32_t byteLen, const char* mime, ScreenshotEncoding enc, bool& ok)
{
    ok = false;
    auto& vm = g->vm();

    WTF::Vector<char, 64> zname;
    zname.grow(nameLen + 1);
    memcpy(zname.mutableSpan().data(), name, nameLen);
    zname[nameLen] = '\0';

    // Shmem: return {name, size} without opening. The name is the child-
    // picked /bun-webview-<pid>-<seq> — the user (or Kitty) shm_open's it.
    // We don't unlink; the caller owns cleanup. The child already
    // munmapped its side, so the ONLY live ref is the name itself — if the
    // user drops the name without unlinking, the pages leak until process
    // exit (macOS POSIX shm is per-login-session, not system-wide).
    if (enc == ScreenshotEncoding::Shmem) {
        auto* obj = JSC::constructEmptyObject(g);
        obj->putDirect(vm, Identifier::fromString(vm, "name"_s),
            jsString(vm, WTF::String::fromUTF8(std::span<const char>(name, nameLen))));
        obj->putDirect(vm, Identifier::fromString(vm, "size"_s), jsNumber(byteLen));
        ok = true;
        return obj;
    }

    int shmErr = 0;
    void* map = mapShm(zname.span().data(), byteLen, shmErr);
    // Unlink after we have a mapping — the name can go away, the physical
    // pages live until the last mapping drops. For the error path
    // (map==null), we still unlink to avoid leaking the name; the user
    // gets an Error and there's nothing to read anyway.
    shm_unlink(zname.span().data());
    if (!map)
        return createError(g, makeString("shm: "_s, WTF::String::fromUTF8(strerror(shmErr))));

    switch (enc) {
    case ScreenshotEncoding::Blob: {
        // Blob adopts the mapping — no copy. Store's allocator.free
        // munmap's when the Blob's refcount drops to zero.
        // `await blob.bytes()` reads directly from these pages.
        void* impl = Blob__fromMmapWithType(g, static_cast<uint8_t*>(map), byteLen, mime);
        ok = true;
        return JSValue::decode(Blob__create(defaultGlobalObject(g), impl));
    }
    case ScreenshotEncoding::Buffer: {
        // ArrayBuffer adopts the mapping — createFromBytes + a
        // SharedTask<void(void*)> destructor that munmap's. Same
        // zero-copy as Blob, just wrapped as a Node Buffer
        // (JSUint8Array with JSBufferSubclassStructure).
        ok = true;
        return JSValue::decode(JSBuffer__fromMmap(defaultGlobalObject(g), map, byteLen));
    }
    case ScreenshotEncoding::Base64: {
        // base64Encode copies into the output String — one
        // materialization, unavoidable (the user explicitly wants the
        // text form). WTF's encoder is vectorized (SIMD on the 3→4
        // table-lookup). Unmap after — the string owns its own copy.
        WTF::String b64 = WTF::base64EncodeToString(
            std::span<const uint8_t>(static_cast<const uint8_t*>(map), byteLen));
        munmap(map, byteLen);
        ok = true;
        return jsString(vm, WTF::move(b64));
    }
    case ScreenshotEncoding::Shmem:
        RELEASE_ASSERT_NOT_REACHED(); // handled above
    }
    RELEASE_ASSERT_NOT_REACHED();
    return jsUndefined();
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

    case Reply::ConsoleEvent: {
        if (!view->m_consoleIsGlobal && !view->m_onConsole) return;
        WTF::String type = r.str();
        uint32_t argCount = r.u32();

        MarkedArgumentBuffer args;
        for (uint32_t i = 0; i < argCount; ++i) {
            WTF::String s = r.str();
            // Each arg was JSON.stringify'd page-side; JSONParse to recover
            // the structured value. Primitives round-trip losslessly; objects
            // get their JSON representation. Values JSON.stringify can't
            // serialize (functions, undefined) fell back to String(x) in the
            // user script — JSONParse returns {} for those.
            JSValue v = s.isEmpty() ? jsUndefined() : JSONParse(g, s);
            args.append(v ? v : jsUndefined());
        }

        if (view->m_consoleIsGlobal) {
            // ConsoleClient::logWithLevel — same path as native
            // console.log(). trace/dir render through Log level.
            using JSC::MessageLevel;
            MessageLevel ml = MessageLevel::Log;
            if (type == "error"_s)
                ml = MessageLevel::Error;
            else if (type == "warn"_s)
                ml = MessageLevel::Warning;
            else if (type == "debug"_s)
                ml = MessageLevel::Debug;
            else if (type == "info"_s)
                ml = MessageLevel::Info;

            WTF::Vector<Strong<Unknown>> strongArgs;
            strongArgs.reserveInitialCapacity(args.size());
            for (unsigned i = 0; i < args.size(); ++i)
                strongArgs.append(Strong<Unknown>(vm, args.at(i)));
            auto scriptArgs = Inspector::ScriptArguments::create(g, WTF::move(strongArgs));
            if (auto clientRef = g->consoleClient())
                clientRef->logWithLevel(g, WTF::move(scriptArgs), ml);
            return;
        }

        // Custom callback: (type, ...args).
        JSObject* cb = view->m_onConsole.get();
        auto callData = getCallData(cb);
        if (callData.type == CallData::Type::None) return;
        MarkedArgumentBuffer cbArgs;
        cbArgs.append(jsString(vm, type.isEmpty() ? "log"_s : type));
        for (unsigned i = 0; i < args.size(); ++i)
            cbArgs.append(args.at(i));
        call(g, cb, callData, jsUndefined(), cbArgs);
        return;
    }

    case Reply::NavDone:
        // url/title already cached by the preceding NavEvent.
        settleSlot(g, view, view->m_pendingNavigate, true, jsUndefined());
        return;
    case Reply::NavFailed:
        // navigateIPC sends NavFailed directly for invalid URLs — no
        // NavFailEvent precedes it, so the only m_loading reset path is here.
        view->m_loading = false;
        settleSlot(g, view, view->m_pendingNavigate, false, createError(g, r.str()));
        return;

    case Reply::EvalDone: {
        WTF::String s = r.str();
        // Child serialized via JSON.stringify page-side; this is the one
        // deserialization. Empty string = script returned undefined (or a
        // function/symbol — JSON.stringify collapses those to undefined).
        // JSONParse returns {} on malformed input; the child's output is
        // JSC's own JSON.stringify so it's well-formed by construction.
        JSValue v = s.isEmpty() ? jsUndefined() : JSONParse(g, s);
        settleSlot(g, view, view->m_pendingEval, true, v ? v : jsUndefined());
        return;
    }
    case Reply::EvalFailed:
        settleSlot(g, view, view->m_pendingEval, false, createError(g, r.str()));
        return;

    case Reply::ScreenshotDone: {
        uint32_t nameLen = r.u32();
        const char* name = reinterpret_cast<const char*>(r.bytes(nameLen));
        uint32_t pngLen = r.u32();
        bool ok;
        JSValue result = openShmScreenshot(g, name, nameLen, pngLen,
            screenshotMimeType(view->m_screenshotFormat),
            view->m_screenshotEncoding, ok);
        settleSlot(g, view, view->m_pendingScreenshot, ok, result);
        return;
    }
    case Reply::ScreenshotFailed:
        settleSlot(g, view, view->m_pendingScreenshot, false, createError(g, r.str()));
        return;

    case Reply::Ack:
        settleSlot(g, view, view->m_pendingMisc, true, jsUndefined());
        return;
    case Reply::Error:
        // Child-side misc-op failure (input contention, selector timeout,
        // malformed result). The child's view() lookup now sends op-specific
        // failure types for invalid viewId (NavFailed/EvalFailed/etc.), so
        // Error is exclusively misc-slot. Rejecting all slots here would
        // spuriously kill a concurrent navigate.
        view->m_loading = false;
        settleSlot(g, view, view->m_pendingMisc, false, createError(g, r.str()));
        return;
    }
}

void HostClient::rejectAllAndMarkDead(const WTF::String& reason)
{
    if (dead) return;
    dead = true;
    // us_socket_close is idempotent (checks is_closed internally). When
    // this runs via Bun__WebViewHost__childDied (EVFILT_PROC won the race
    // against EOF) the socket is still polling — close it. The dead guard
    // above short-circuits the reentrant onClose.
    if (auto* s = std::exchange(sock, nullptr)) us_socket_close(s, 0, nullptr);
    if (!global) return;
    auto* g = global;
    JSValue err = createError(g, reason);
    for (auto& [id, weak] : viewsById) {
        JSWebView* v = weak.get();
        if (!v) continue;
        v->m_loading = false;
        settleSlot(g, v, v->m_pendingNavigate, false, err);
        settleSlot(g, v, v->m_pendingEval, false, err);
        settleSlot(g, v, v->m_pendingScreenshot, false, err);
        settleSlot(g, v, v->m_pendingMisc, false, err);
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
        // createError/jsString/Blob__create can throw (OOM). Report +
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

// --- WK::Ops ---------------------------------------------------------------
// Called from JSWebView's dispatching instance methods. Wire encoding is
// the typed payload structs from ipc_protocol.h.

namespace Ops {

// Create promise, store in barrier, write frame. Caller guarantees the slot
// is empty (INVALID_STATE thrown in the prototype method before calling into
// the instance method that ends up here).
static JSPromise* sendOp(JSGlobalObject* g, JSWebView* view, WriteBarrier<JSPromise>& slot,
    Op op, const uint8_t* payload, uint32_t len)
{
    auto& vm = g->vm();
    auto* promise = JSPromise::create(vm, g->promiseStructure());
    auto& c = client();
    if (!c.sock || c.dead || us_socket_is_closed(c.sock)) {
        promise->reject(vm, g, createError(g, "WebView host process is not running"_s));
        return promise;
    }
    // Inc BEFORE slot.set so GC never observes a set slot with count==0.
    // Release ordering: the slot write below must not be reordered above this.
    view->m_pendingActivityCount.fetch_add(1, std::memory_order_release);
    slot.set(vm, view, promise);
    c.writeFrame(op, view->m_viewId, payload, len);
    return promise;
}

JSPromise* navigate(JSGlobalObject* g, JSWebView* view, const WTF::String& url)
{
    auto payload = encodeStr(url);
    auto* promise = sendOp(g, view, view->m_pendingNavigate, Op::Navigate,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
    if (view->m_pendingNavigate) view->m_loading = true;
    return promise;
}

JSPromise* evaluate(JSGlobalObject* g, JSWebView* view, const WTF::String& script)
{
    auto payload = encodeStr(script);
    return sendOp(g, view, view->m_pendingEval, Op::Evaluate,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* screenshot(JSGlobalObject* g, JSWebView* view, ScreenshotFormat format, uint8_t quality)
{
    // Two bytes: format enum + quality. Child picks the CGImageDestination
    // UTI (public.png / public.jpeg / public.webp) and
    // kCGImageDestinationLossyCompressionQuality. The reply's pngLen field
    // is misnamed — it's byteLen regardless of format. The response handler
    // reads view->m_screenshotFormat (stashed by JSWebView::screenshot) to
    // stamp the right MIME on the Blob.
    uint8_t payload[2] = { static_cast<uint8_t>(format), quality };
    return sendOp(g, view, view->m_pendingScreenshot, Op::Screenshot, payload, sizeof(payload));
}

JSPromise* click(JSGlobalObject* g, JSWebView* view, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto payload = encode(ClickPayload { x, y, button, modifiers, clickCount });
    return sendOp(g, view, view->m_pendingMisc, Op::Click,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* clickSelector(JSGlobalObject* g, JSWebView* view, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto payload = encode(ClickSelectorPayload { timeout, button, modifiers, clickCount }, selector);
    return sendOp(g, view, view->m_pendingMisc, Op::ClickSelector,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* type(JSGlobalObject* g, JSWebView* view, const WTF::String& text)
{
    auto payload = encodeStr(text);
    return sendOp(g, view, view->m_pendingMisc, Op::Type,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* press(JSGlobalObject* g, JSWebView* view, VirtualKey key, uint8_t modifiers, const WTF::String& character)
{
    auto payload = encode(PressPayload { static_cast<uint8_t>(key), modifiers },
        key == VirtualKey::Character ? character : WTF::String());
    return sendOp(g, view, view->m_pendingMisc, Op::Press,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* scroll(JSGlobalObject* g, JSWebView* view, double dx, double dy)
{
    auto payload = encode(ScrollPayload { static_cast<float>(dx), static_cast<float>(dy) });
    return sendOp(g, view, view->m_pendingMisc, Op::Scroll,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* scrollTo(JSGlobalObject* g, JSWebView* view, const WTF::String& selector, uint32_t timeout, uint8_t block)
{
    auto payload = encode(ScrollToPayload { timeout, block }, selector);
    return sendOp(g, view, view->m_pendingMisc, Op::ScrollTo,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* resize(JSGlobalObject* g, JSWebView* view, uint32_t width, uint32_t height)
{
    auto payload = encode(ResizePayload { width, height });
    return sendOp(g, view, view->m_pendingMisc, Op::Resize,
        payload.span().data(), static_cast<uint32_t>(payload.size()));
}

JSPromise* goBack(JSGlobalObject* g, JSWebView* view)
{
    return sendOp(g, view, view->m_pendingMisc, Op::GoBack, nullptr, 0);
}

JSPromise* goForward(JSGlobalObject* g, JSWebView* view)
{
    return sendOp(g, view, view->m_pendingMisc, Op::GoForward, nullptr, 0);
}

JSPromise* reload(JSGlobalObject* g, JSWebView* view)
{
    return sendOp(g, view, view->m_pendingMisc, Op::Reload, nullptr, 0);
}

void close(JSWebView* view)
{
    auto& c = client();
    if (c.global) {
        auto* g = c.global;
        JSValue err = createError(g, "WebView closed"_s);
        settleSlot(g, view, view->m_pendingNavigate, false, err);
        settleSlot(g, view, view->m_pendingEval, false, err);
        settleSlot(g, view, view->m_pendingScreenshot, false, err);
        settleSlot(g, view, view->m_pendingMisc, false, err);
    }
    c.writeFrame(Op::Close, view->m_viewId, nullptr, 0);
    c.viewsById.erase(view->m_viewId);
    c.updateKeepAlive();
}

} // namespace Ops

} // namespace WK
} // namespace Bun

// Called from Zig's onProcessExit (EVFILT_PROC). The socket onClose may or
// may not have fired (crash = no FIN). Idempotent with onClose.
extern "C" void Bun__WebViewHost__childDied(int32_t signo)
{
    auto& c = Bun::WK::client();
    if (c.dead) return;
    c.rejectAllAndMarkDead(signo
            ? makeString("WebView host process killed by signal "_s, signo)
            : "WebView host process exited"_s);
}

#else // !OS(DARWIN)

// HostProcess.zig references this unconditionally via @extern; Zig's dead-code
// elimination doesn't trigger because the TaggedPointer dispatch switch in
// process.zig pulls in all ProcessExitHandler arms. spawn() itself is gated
// on Environment.isMac so this is never called.
extern "C" void Bun__WebViewHost__childDied(int32_t) {}

#endif // OS(DARWIN)
