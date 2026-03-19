#include "root.h"
#include "ChromeBackend.h"
#include "JSWebView.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/Base64.h>

#include <unistd.h>
#include <errno.h>
#include <mutex>
#include <stdio.h>
#include <stdlib.h>

#include "libusockets.h"
#include "_libusockets.h"

namespace Bun {
namespace CDP {

using namespace JSC;

// One env check, shared across all Transport instances.
static bool s_debugCDP = getenv("BUN_DEBUG_CDP") != nullptr;

// From ChromeProcess.zig. Returns the parent's socketpair fd (bidirectional).
extern "C" int32_t Bun__Chrome__ensure(Zig::GlobalObject*, const char* userDataDir);
extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);
extern "C" void Bun__EventLoop__enter(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__exit(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__runCallback2(JSGlobalObject*, EncodedJSValue cb,
    EncodedJSValue thisVal, EncodedJSValue arg0, EncodedJSValue arg1);

// --- JSON field scanner -----------------------------------------------------

// Find the value slice for a top-level key in a flat JSON object.
// memchr for the key's quoted form ("key":), then depth-counted walk to
// the value end. Returns empty span if not found.
//
// The CDP envelope has no nesting in the keys we scan (id, method, result,
// error, params, sessionId). result/params VALUES may be nested objects,
// which the depth counter handles.
std::span<const char> jsonField(std::span<const char> json, std::span<const char> key)
{
    // Look for "key": — the key is always at depth 1 in the envelope, so
    // the first quoted match at the right nesting IS the field. We could
    // walk depth-counted from the start, but memchr for the opening quote
    // of the key is much faster and the CDP envelope has no string values
    // that look like `"id":` before the actual id field.
    const char* p = json.data();
    const char* end = p + json.size();
    size_t klen = key.size();

    while (p + klen + 3 < end) {
        // Scan for the next quote.
        const char* q = static_cast<const char*>(memchr(p, '"', end - p));
        if (!q) return {};
        // Check if it's our key: "key":
        if (q + klen + 2 < end
            && memcmp(q + 1, key.data(), klen) == 0
            && q[klen + 1] == '"' && q[klen + 2] == ':') {
            const char* vstart = q + klen + 3;
            // Walk the value to its end. Depth counts braces/brackets;
            // inString tracks quoted regions (commas inside strings don't
            // terminate). Depth 0 comma or closing brace at depth 0 is done.
            int depth = 0;
            bool inStr = false;
            bool esc = false;
            const char* v = vstart;
            for (; v < end; ++v) {
                char c = *v;
                if (esc) {
                    esc = false;
                    continue;
                }
                if (c == '\\') {
                    esc = true;
                    continue;
                }
                if (c == '"') {
                    inStr = !inStr;
                    continue;
                }
                if (inStr) continue;
                if (c == '{' || c == '[') {
                    ++depth;
                    continue;
                }
                if (c == '}' || c == ']') {
                    if (depth == 0) break; // value ended at enclosing close
                    --depth;
                    continue;
                }
                if (c == ',' && depth == 0) break;
            }
            return { vstart, static_cast<size_t>(v - vstart) };
        }
        p = q + 1;
    }
    return {};
}

uint32_t jsonId(std::span<const char> json)
{
    auto slice = jsonField(json, { "id", 2 });
    if (slice.empty()) return 0;
    uint32_t n = 0;
    for (char c : slice) {
        if (c < '0' || c > '9') break;
        n = n * 10 + (c - '0');
    }
    return n;
}

std::span<const char> jsonString(std::span<const char> field)
{
    // Trim leading/trailing whitespace (shouldn't exist in CDP output but
    // cheap). Then peel the quotes.
    const char* p = field.data();
    const char* end = p + field.size();
    while (p < end && (*p == ' ' || *p == '\t'))
        ++p;
    while (end > p && (end[-1] == ' ' || end[-1] == '\t'))
        --end;
    if (end - p < 2 || *p != '"' || end[-1] != '"') return {};
    return { p + 1, static_cast<size_t>(end - p - 2) };
}

// --- Transport singleton ---------------------------------------------------

Transport& transport()
{
    static LazyNeverDestroyed<Transport> instance;
    static std::once_flag once;
    std::call_once(once, [] { instance.construct(); });
    return instance.get();
}

// usockets callbacks — thin trampolines into the singleton.
static us_socket_t* cdpOnData(us_socket_t* s, char* d, int n)
{
    transport().onData(d, n);
    return s;
}
static us_socket_t* cdpOnWritable(us_socket_t* s)
{
    transport().onWritable();
    return s;
}
static us_socket_t* cdpOnClose(us_socket_t* s, int, void*)
{
    transport().onClose();
    return s;
}
static us_socket_t* cdpOnEnd(us_socket_t* s)
{
    transport().onClose();
    return s;
}
static us_socket_t* cdpOnOpen(us_socket_t* s, int, char*, int) { return s; }

bool Transport::ensureSpawned(Zig::GlobalObject* zig, const WTF::String& userDataDir)
{
    if (m_readSock && !m_dead) return true;
    if (m_dead) {
        m_dead = false;
        m_readSock = nullptr;
        m_rx.clear();
        m_txQueue.clear();
    }

    // Empty string ≠ null. WTF::String() utf8's to an empty CString (not
    // isNull), which on the Zig side passes "" into --user-data-dir= and
    // Chrome falls back to the default profile → ProcessSingleton abort.
    WTF::CString dir = userDataDir.utf8();
    int32_t fd = Bun__Chrome__ensure(zig, dir.length() ? dir.data() : nullptr);
    if (fd < 0) {
        m_dead = true;
        return false;
    }
    // Socketpair — same fd for read + write. Chrome's end is dup'd to its
    // fd 3 and fd 4; read(3)+write(4) both hit our socketpair peer. usockets'
    // bsd_recv calls recv() which needs a real socket (pipe fds broke here
    // with ENOTSOCK silently misread as EOF).
    m_writeFd = fd;
    m_global = zig;

    if (!m_ctx) {
        us_loop_t* loop = uws_get_loop();
        us_socket_context_options_t opts;
        memset(&opts, 0, sizeof(opts));
        m_ctx = us_create_socket_context(0, loop, sizeof(void*), opts);
        us_socket_context_on_data(0, m_ctx, cdpOnData);
        us_socket_context_on_writable(0, m_ctx, cdpOnWritable);
        us_socket_context_on_close(0, m_ctx, cdpOnClose);
        us_socket_context_on_end(0, m_ctx, cdpOnEnd);
        us_socket_context_on_open(0, m_ctx, cdpOnOpen);
    }

    // Adopt read fd only. usockets polls it READABLE|WRITABLE but we only
    // care about READABLE — writable events on a read-end pipe fire
    // constantly, but onWritable is a no-op when m_txQueue is empty so
    // they're harmless.
    m_readSock = us_socket_from_fd(m_ctx, sizeof(void*), fd, 0);
    if (!m_readSock) {
        ::close(fd);
        m_writeFd = -1;
        m_dead = true;
        return false;
    }
    return true;
}

uint32_t Transport::send(const WTF::CString& frame)
{
    if (s_debugCDP) [[unlikely]]
        fprintf(stderr, "[cdp tx] %.*s\n", static_cast<int>(frame.length()), frame.data());
    // length()+1 — the CString's terminating NUL is the frame delimiter.
    // Chrome's DevToolsPipeHandler does read-until-\0 on fd 3.
    writeRaw(frame.data(), frame.length() + 1);
    return m_nextId; // returned for convenience; caller already has it
}

// Direct write() to the socketpair — usockets polls the same fd but its
// us_socket_write path adds framing we don't want. On EAGAIN, queue; the
// onWritable callback (usockets DOES poll WRITABLE on a socketpair) drains.
// Chrome reads fd 3 on a dedicated thread so the queue shouldn't back up.
void Transport::writeRaw(const char* data, size_t len)
{
    if (m_dead || m_writeFd < 0) return;

    if (m_txQueue.isEmpty()) {
        ssize_t w = ::write(m_writeFd, data, len);
        if (w == static_cast<ssize_t>(len)) return;
        if (w < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK) {
                // EPIPE — Chrome closed fd 3. onClose via fd 4 EOF is
                // coming; queuing more would be dead bytes.
                return;
            }
            w = 0;
        }
        m_txQueue.append(std::span<const uint8_t>(
            reinterpret_cast<const uint8_t*>(data) + w, len - w));
    } else {
        m_txQueue.append(std::span<const uint8_t>(
            reinterpret_cast<const uint8_t*>(data), len));
    }
    // usockets polls the socketpair WRITABLE — onWritable fires when the
    // kernel send buffer drains. cdpOnWritable calls our onWritable().
}

void Transport::onWritable()
{
    while (!m_txQueue.isEmpty()) {
        ssize_t w = ::write(m_writeFd, m_txQueue.span().data(), m_txQueue.size());
        if (w < 0) return; // EAGAIN; next onWritable retries
        m_txQueue.removeAt(0, static_cast<size_t>(w));
    }
}

void Transport::onData(const char* data, int length)
{
    m_rx.append(std::span<const uint8_t>(
        reinterpret_cast<const uint8_t*>(data), static_cast<size_t>(length)));

    // Opportunistic drain of the tx queue — Chrome just wrote to us, so
    // it's definitely alive and reading fd 3.
    if (!m_txQueue.isEmpty()) onWritable();

    auto& vm = m_global->vm();
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    Bun__EventLoop__enter(m_global);

    // NUL-delimited. memchr for the first \0, dispatch the message, repeat.
    size_t off = 0;
    const uint8_t* base = m_rx.span().data();
    size_t size = m_rx.size();
    while (off < size) {
        const uint8_t* nul = static_cast<const uint8_t*>(
            memchr(base + off, '\0', size - off));
        if (!nul) break; // partial message — wait for more bytes
        std::span<const char> msg(reinterpret_cast<const char*>(base + off),
            static_cast<size_t>(nul - (base + off)));
        handleMessage(msg);
        off = static_cast<size_t>(nul - base) + 1;

        if (auto* ex = catchScope.exception()) [[unlikely]] {
            if (!catchScope.clearExceptionExceptTermination()) break;
            m_global->reportUncaughtExceptionAtEventLoop(m_global, ex);
        }
    }
    if (off) m_rx.removeAt(0, off);

    Bun__EventLoop__exit(m_global);
}

void Transport::handleMessage(std::span<const char> msg)
{
    if (s_debugCDP) [[unlikely]]
        fprintf(stderr, "[cdp rx] %.*s\n", static_cast<int>(msg.size()), msg.data());

    // CDP messages are either responses {id,result/error} or events
    // {method,params,sessionId?}. Responses dispatch via m_pending[id];
    // events dispatch via m_sessions[sessionId] or a browser-level handler
    // for Target.* events.
    uint32_t id = jsonId(msg);
    if (id) {
        auto result = jsonField(msg, { "result", 6 });
        auto error = jsonField(msg, { "error", 5 });
        handleResponse(id, result, error);
        return;
    }

    auto method = jsonString(jsonField(msg, { "method", 6 }));
    auto params = jsonField(msg, { "params", 6 });
    auto sessionId = jsonString(jsonField(msg, { "sessionId", 9 }));
    handleEvent(method, params, sessionId);
}

// --- Response dispatch -----------------------------------------------------

// Slot → barrier member on JSWebView. Mirrors HostClient's reply-type→slot.
static WriteBarrier<JSPromise>& slotFor(JSWebView* view, PendingSlot s)
{
    switch (s) {
    case PendingSlot::Navigate:
        return view->m_pendingNavigate;
    case PendingSlot::Evaluate:
        return view->m_pendingEval;
    case PendingSlot::Screenshot:
        return view->m_pendingScreenshot;
    case PendingSlot::Misc:
        return view->m_pendingMisc;
    }
    ASSERT_NOT_REACHED();
    return view->m_pendingMisc;
}

// Same settle semantics as JSWebView.cpp's — slot cleared BEFORE JS call so
// re-entrant sends from .then() see an empty slot; activity decremented
// AFTER clear (GC seeing count>0 with a clear slot is benign).
static void settle(JSGlobalObject* g, JSWebView* view, PendingSlot slot, bool ok, JSValue v)
{
    auto& barrier = slotFor(view, slot);
    JSPromise* p = barrier.get();
    if (!p) return;
    barrier.clear();
    view->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
    if (ok)
        p->resolve(g, v);
    else
        p->reject(g->vm(), g, v);
}

// Per-method result handlers. Each knows the schema of its result object
// and extracts just what the JS side needs. The m_pending entry is erased
// BEFORE the JS call so re-entrant sends don't see a stale map entry.
void Transport::handleResponse(uint32_t id, std::span<const char> result, std::span<const char> error)
{
    auto it = m_pending.find(id);
    if (it == m_pending.end()) return; // late reply after rejectAll
    auto entry = WTF::move(it->value);
    m_pending.remove(it);

    auto* g = m_global;
    JSWebView* view = entry.view.get();
    if (!view) return; // user dropped both view and the awaited promise

    if (!error.empty()) {
        // {"code":-32000,"message":"..."}
        auto msgSlice = jsonString(jsonField(error, { "message", 7 }));
        auto errStr = WTF::String::fromUTF8(std::span<const char>(msgSlice));
        settle(g, view, entry.slot, false,
            createError(g, errStr.isEmpty() ? "CDP error"_s : errStr));
        return;
    }

    switch (entry.method) {
    // --- Attach chain --------------------------------------------------
    // First navigate() sends Target.createTarget; each response chains
    // into the next command by re-adding to m_pending with WTFMove'd
    // Weak. The chain carries entry.slot (= Navigate) so errors at any
    // stage reject the right promise. The promise RESOLVES on
    // Page.loadEventFired — not on any response in this chain.
    case Method::TargetCreateTarget: {
        // {"targetId":"<hex>"}
        auto tid = jsonString(jsonField(result, { "targetId", 8 }));
        view->m_targetId = WTF::String::fromUTF8(tid);
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::TargetAttachToTarget, entry.slot, WTF::move(entry.view) });
        send(Command(cid, "Target.attachToTarget"_s)
                .str("targetId"_s, view->m_targetId)
                .boolean("flatten"_s, true)
                .finish());
        return;
    }
    case Method::TargetAttachToTarget: {
        // {"sessionId":"<base64ish>"}
        auto sid = jsonString(jsonField(result, { "sessionId", 9 }));
        view->m_sessionId = WTF::String::fromUTF8(sid);
        // Route events to this view. The Weak's owner is the same
        // pending-activity predicate; a view with a slot set is rooted.
        m_sessions.add(view->m_sessionId,
            Weak<JSWebView>(view, &webViewWeakOwner()));
        updateKeepAlive();

        // Page.enable lets us receive frameNavigated / loadEventFired.
        // sessionId now available — the remaining chain goes to the page.
        auto ss = view->m_sessionId.utf8();
        std::span<const char> sidSpan(ss.data(), ss.length());
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageEnable, entry.slot, WTF::move(entry.view) });
        send(Command(cid, "Page.enable"_s, sidSpan).finish());
        return;
    }
    case Method::PageEnable: {
        // Chain into Runtime.enable (for consoleAPICalled later) then
        // Page.navigate to the stashed url.
        auto ss = view->m_sessionId.utf8();
        std::span<const char> sidSpan(ss.data(), ss.length());

        // Runtime.enable — fire-and-forget, untracked. We don't need to
        // wait for its reply before navigating.
        uint32_t rid = nextId();
        send(Command(rid, "Runtime.enable"_s, sidSpan).finish());

        // Page.navigate with the url stashed by the first navigate() call.
        // The response confirms the navigation STARTED; Page.loadEventFired
        // confirms completion. We keep the pending entry alive for the
        // response so errorText rejects the right slot.
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageNavigate, entry.slot, WTF::move(entry.view) });
        send(Command(cid, "Page.navigate"_s, sidSpan)
                .str("url"_s, view->m_pendingChromeNavigateUrl)
                .finish());
        view->m_pendingChromeNavigateUrl = WTF::String();
        return;
    }
    case Method::RuntimeEnable:
        // Untracked fire-and-forget — shouldn't reach here, but drop.
        return;

    case Method::TargetCloseTarget:
        settle(g, view, entry.slot, true, jsUndefined());
        return;

    case Method::PageNavigate: {
        // {"frameId":"...","loaderId":"..."} or {"frameId":"...","errorText":"..."}
        // errorText present → navigation failed synchronously (bad URL,
        // net::ERR_* resolved before commit). Reject now. Otherwise the
        // navigation is underway; Page.loadEventFired resolves. Keep the
        // pending entry so the event handler can look up the view by
        // sessionId — actually the event handler uses m_sessions, not
        // m_pending, so we just drop here.
        auto err = jsonString(jsonField(result, { "errorText", 9 }));
        if (!err.empty())
            settle(g, view, entry.slot, false, createError(g, WTF::String::fromUTF8(err)));
        // Else: don't settle — Page.loadEventFired does.
        return;
    }
    case Method::PageReload:
        // Same as navigate: don't settle, Page.loadEventFired does.
        return;

    case Method::RuntimeEvaluate: {
        // {"result":{"type":"...","value":...},"exceptionDetails":{...}?}
        // returnByValue:true + awaitPromise:true → result.value is the
        // JSON-serialized return. exceptionDetails present → script threw.
        auto excDetails = jsonField(result, { "exceptionDetails", 16 });
        if (!excDetails.empty()) {
            auto desc = jsonString(jsonField(
                jsonField(excDetails, { "exception", 9 }), { "description", 11 }));
            auto text = jsonString(jsonField(excDetails, { "text", 4 }));
            auto msg = desc.empty() ? text : desc;
            settle(g, view, entry.slot, false, createError(g, WTF::String::fromUTF8(msg)));
            return;
        }
        // result.result.value — the inner result object's value field.
        // type:"undefined" → no value field → resolve undefined.
        auto inner = jsonField(result, { "result", 6 });
        auto type = jsonString(jsonField(inner, { "type", 4 }));
        auto valueSlice = jsonField(inner, { "value", 5 });
        if (valueSlice.empty() || (type.size() == 9 && memcmp(type.data(), "undefined", 9) == 0)) {
            settle(g, view, entry.slot, true, jsUndefined());
            return;
        }
        // JSONParse the value slice directly. Same 1-parse as WKWebView's
        // EvalDone — the slice IS JSON (returnByValue serialized it).
        JSValue v = JSONParse(g, WTF::String::fromUTF8(valueSlice));
        settle(g, view, entry.slot, true, v ? v : jsUndefined());
        return;
    }

    case Method::PageCaptureScreenshot: {
        // {"data":"<base64 PNG>"} — decode into a Uint8Array. WTF::
        // base64Decode allocates its own Vector then we memcpy into the JS
        // heap. Two copies at peak (b64 source + decoded Vector), Vector
        // drops after memcpy. Zero-copy decode-into-JSUint8Array-backing
        // would need a WTF API we don't have; bun.base64's SIMD path is
        // available but wiring it here costs more than the memcpy saves.
        auto b64 = jsonString(jsonField(result, { "data", 4 }));
        auto decoded = WTF::base64Decode(
            std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(b64.data()), b64.size()));
        if (!decoded) {
            settle(g, view, entry.slot, false, createError(g, "screenshot: invalid base64"_s));
            return;
        }
        auto* u8 = JSUint8Array::createUninitialized(g, g->m_typedArrayUint8.get(g),
            static_cast<uint32_t>(decoded->size()));
        if (!u8) {
            settle(g, view, entry.slot, false, createError(g, "screenshot: OOM"_s));
            return;
        }
        memcpy(u8->typedVector(), decoded->span().data(), decoded->size());
        settle(g, view, entry.slot, true, u8);
        return;
    }

    case Method::InputDispatchMouseEvent:
    case Method::InputDispatchKeyEvent:
    case Method::InputDispatchScrollEvent:
    case Method::InputInsertText:
    case Method::EmulationSetDeviceMetricsOverride:
        // Input.* / Emulation.* reply with empty result on success. Sync-
        // reply — the event has been processed by the time we get this. No
        // presentation-barrier dance, no mouseEventQueue drain wait.
        settle(g, view, entry.slot, true, jsUndefined());
        return;
    }
}

void Transport::handleEvent(std::span<const char> method, std::span<const char> params, std::span<const char> sessionId)
{
    auto* g = m_global;
    auto& vm = g->vm();

    // Route by sessionId. Target.* browser-level events have no sessionId
    // and we don't handle them yet (Target.targetDestroyed would clean up
    // m_sessions but close() does that eagerly).
    if (sessionId.empty()) return;
    auto sidStr = WTF::String::fromUTF8(sessionId);
    auto it = m_sessions.find(sidStr);
    if (it == m_sessions.end()) return;
    JSWebView* view = it->value.get();
    if (!view) {
        // Weak died (user dropped view during a load). Chrome will keep
        // sending events; erasing here stops the lookup thrash.
        m_sessions.remove(it);
        return;
    }

    // Page.frameNavigated — commit. Update m_url and fire onNavigated.
    // Same timing as WKWebView's NavDone (didFinishNavigation): the URL is
    // now the new document, resources may still be loading.
    if (method.size() == 19 && memcmp(method.data(), "Page.frameNavigated", 19) == 0) {
        auto frame = jsonField(params, { "frame", 5 });
        auto url = jsonString(jsonField(frame, { "url", 3 }));
        auto urlStr = WTF::String::fromUTF8(url);
        view->m_url = urlStr;
        // m_loading stays true — loadEventFired flips it.

        if (JSObject* cb = view->m_onNavigated.get()) {
            Bun__EventLoop__runCallback2(g, JSValue::encode(cb), JSValue::encode(jsUndefined()),
                JSValue::encode(jsString(vm, urlStr)), JSValue::encode(jsUndefined()));
        }
        return;
    }

    // Page.loadEventFired — load complete. This is what navigate() awaits.
    // WKWebView's NavDone fires at didFinishNavigation which is roughly
    // frameNavigated timing; Chrome's loadEventFired is the window.onload
    // fire, a bit later. For await-then-evaluate patterns loadEventFired
    // is the safer barrier — the document is fully parsed and scripts ran.
    if (method.size() == 19 && memcmp(method.data(), "Page.loadEventFired", 19) == 0) {
        view->m_loading = false;
        // Settle the navigate promise. If no navigate pending (e.g. a
        // same-document navigation we didn't initiate, or a redirect
        // landing after we already settled), this no-ops.
        settle(g, view, PendingSlot::Navigate, true, jsUndefined());
        return;
    }

    // TODO: Target.targetDestroyed (cleanup m_sessions), Runtime.consoleAPICalled.
}

void Transport::onClose()
{
    rejectAllAndMarkDead("Chrome process closed the pipe"_s);
}

void Transport::rejectAllAndMarkDead(const WTF::String& reason)
{
    m_dead = true;
    // usockets owns the socket; it closes the fd when the us_socket_t is
    // freed. m_writeFd is the SAME fd (socketpair, one end for both
    // read+write) — don't double-close.
    m_readSock = nullptr;
    m_writeFd = -1;
    if (!m_global) return;
    auto* g = m_global;
    JSValue err = createError(g, reason);
    // Reject each view's slots via settle(). Multiple pending ids may point
    // at the same view (different slots); settle() is idempotent on an
    // already-cleared slot — the first settle for a slot rejects, the rest
    // find barrier.get() == null and no-op.
    for (auto& [id, entry] : m_pending) {
        if (JSWebView* v = entry.view.get())
            settle(g, v, entry.slot, false, err);
    }
    m_pending.clear();
    m_sessions.clear();
    updateKeepAlive();
}

void Transport::updateKeepAlive()
{
    bool want = !m_sessions.isEmpty() || !m_pending.isEmpty();
    if (want == m_sockRefd || !m_global) return;
    m_sockRefd = want;
    Bun__eventLoop__incrementRefConcurrently(
        WebCore::clientData(m_global->vm())->bunVM, want ? 1 : -1);
}

} // namespace CDP

// Called from ChromeProcess.zig's onProcessExit. Idempotent with onClose.
extern "C" void Bun__Chrome__died(int32_t signo)
{
    auto& t = CDP::transport();
    if (t.m_dead) return;
    t.rejectAllAndMarkDead(signo
            ? makeString("Chrome killed by signal "_s, signo)
            : "Chrome exited"_s);
}

} // namespace Bun
