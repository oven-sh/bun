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

#include "libusockets.h"
#include "_libusockets.h"

namespace Bun {
namespace CDP {

using namespace JSC;

// From ChromeProcess.zig. Packed {write_fd<<32 | read_fd}.
extern "C" int64_t Bun__Chrome__ensure(Zig::GlobalObject*, const char* userDataDir);
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
    while (p < end && (*p == ' ' || *p == '\t')) ++p;
    while (end > p && (end[-1] == ' ' || end[-1] == '\t')) --end;
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

    WTF::CString dir = userDataDir.utf8();
    int64_t packed = Bun__Chrome__ensure(zig, dir.isNull() ? nullptr : dir.data());
    if (packed < 0) {
        m_dead = true;
        return false;
    }
    m_writeFd = static_cast<int>(static_cast<uint64_t>(packed) >> 32);
    int readFd = static_cast<int>(static_cast<uint64_t>(packed) & 0xFFFFFFFF);
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
    m_readSock = us_socket_from_fd(m_ctx, sizeof(void*), readFd, 0);
    if (!m_readSock) {
        ::close(readFd);
        ::close(m_writeFd);
        m_dead = true;
        return false;
    }
    return true;
}

uint32_t Transport::send(const WTF::CString& frame)
{
    writeRaw(frame.data(), frame.length());
    return m_nextId - 1; // caller pre-incremented via Command ctor — actually no,
                         // the Command ctor takes id; caller allocates. See sendCommand().
}

// Write to Chrome's fd 3. Direct syscall — usockets doesn't own this fd.
// On EAGAIN, queue and retry from the read socket's onWritable (the read
// pipe's writable event isn't meaningful, but usockets still fires it;
// we piggyback off it as a "something happened on the loop" tick). If the
// queue backs up past a cap, we're blocking on Chrome and something is
// wrong — Chrome reads fd 3 on a dedicated thread, it shouldn't back up.
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
    // usockets doesn't poll m_writeFd. We retry opportunistically from
    // onWritable (fires often enough on the read socket) and from the next
    // writeRaw call. If Chrome really is blocked, onData won't fire either
    // and we're stuck anyway — fd 3 EAGAIN with a drained fd 4 is "Chrome
    // is dead", not "try harder".
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

// Per-method result handlers. Each knows the schema of its result object
// and extracts just what the JS side needs. The promise resolves with a
// JS value built from the extracted slice(s).
//
// The m_pending entry is erased BEFORE the JS call so re-entrant sends
// from .then() don't see a stale map entry.

void Transport::handleResponse(uint32_t id, std::span<const char> result, std::span<const char> error)
{
    auto it = m_pending.find(id);
    if (it == m_pending.end()) return; // late reply after rejectAll
    auto entry = WTF::move(it->value);
    m_pending.remove(it);

    auto* g = m_global;
    auto& vm = g->vm();

    JSWebView* view = entry.view.get();
    if (view) view->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
    JSPromise* promise = entry.promise.get();
    if (!promise) return;

    if (!error.empty()) {
        // {"code":-32000,"message":"..."}
        auto msgSlice = jsonString(jsonField(error, { "message", 7 }));
        auto errStr = WTF::String::fromUTF8(std::span<const char>(msgSlice));
        promise->reject(vm, g, createError(g, errStr.isEmpty() ? "CDP error"_s : errStr));
        return;
    }

    switch (entry.method) {
    case Method::TargetCreateTarget: {
        // {"targetId":"<hex>"} — caller (createAndSend) stores it on the
        // view and immediately sends Target.attachToTarget. Resolve with
        // undefined; the targetId lives on the JSWebView.
        auto tid = jsonString(jsonField(result, { "targetId", 8 }));
        // The view's m_chromeTargetId is set by the caller that holds the
        // view reference — we don't touch JSWebView internals here. Resolve
        // with the targetId string so the caller can chain.
        promise->resolve(g, jsString(vm, WTF::String::fromUTF8(tid)));
        return;
    }
    case Method::TargetAttachToTarget: {
        // {"sessionId":"<base64ish>"} — store in m_sessions for event routing.
        auto sid = jsonString(jsonField(result, { "sessionId", 9 }));
        auto sidStr = WTF::String::fromUTF8(sid);
        // Re-root the view under its sessionId — events now route by it.
        // The Weak's owner predicate keeps the view alive while pending > 0.
        // TODO: move the view reference from a caller-side map to here.
        promise->resolve(g, jsString(vm, sidStr));
        return;
    }
    case Method::TargetCloseTarget:
        promise->resolve(g, jsUndefined());
        return;

    case Method::PageNavigate: {
        // {"frameId":"...","loaderId":"..."} or {"frameId":"...","errorText":"..."}
        // errorText present → navigation failed synchronously (bad URL etc.).
        // Otherwise the frameId is valid; Page.frameNavigated event signals
        // completion. For v1 we resolve here and let onNavigated handle the
        // event — same semantics as WKWebView's NavDone.
        auto err = jsonString(jsonField(result, { "errorText", 9 }));
        if (!err.empty()) {
            promise->reject(vm, g, createError(g, WTF::String::fromUTF8(err)));
        } else {
            // TODO: defer resolve to Page.frameNavigated for proper
            // load-complete semantics. For now resolve immediately so the
            // basic navigate → evaluate flow works.
            promise->resolve(g, jsUndefined());
        }
        return;
    }

    case Method::RuntimeEvaluate: {
        // {"result":{"type":"...","value":...},"exceptionDetails":{...}?}
        // With returnByValue:true + awaitPromise:true, result.value is the
        // JSON-serialized return value. If exceptionDetails present, the
        // script threw — reject with the exception description.
        auto excDetails = jsonField(result, { "exceptionDetails", 16 });
        if (!excDetails.empty()) {
            auto text = jsonString(jsonField(excDetails, { "text", 4 }));
            auto desc = jsonString(jsonField(
                jsonField(excDetails, { "exception", 9 }), { "description", 11 }));
            auto msg = desc.empty() ? text : desc;
            promise->reject(vm, g, createError(g, WTF::String::fromUTF8(msg)));
            return;
        }
        // result.result.value — the inner result object's value field.
        auto inner = jsonField(result, { "result", 6 });
        auto type = jsonString(jsonField(inner, { "type", 4 }));
        auto valueSlice = jsonField(inner, { "value", 5 });
        // type:"undefined" → no value field → resolve undefined.
        if (valueSlice.empty() || (type.size() == 9 && memcmp(type.data(), "undefined", 9) == 0)) {
            promise->resolve(g, jsUndefined());
            return;
        }
        // JSONParse the value slice directly. Same 1-parse as WKWebView's
        // EvalDone — the slice IS JSON (returnByValue serialized it).
        JSValue v = JSONParse(g, WTF::String::fromUTF8(valueSlice));
        promise->resolve(g, v ? v : jsUndefined());
        return;
    }

    case Method::PageCaptureScreenshot: {
        // {"data":"<base64 PNG>"} — decode into a Uint8Array. The slice
        // excludes quotes (jsonString peeled them). WTF::base64Decode
        // allocates its own Vector<uint8_t> then we memcpy into the JS
        // heap — two copies of the PNG in memory at peak (b64 source +
        // decoded Vector), then the decoded Vector drops after the memcpy.
        // A zero-copy decode-into-buffer would need a WTF API we don't
        // have; Chrome's SIMD base64 path in bun.base64 is available but
        // wiring it here costs more than the memcpy saves. TODO.
        auto b64 = jsonString(jsonField(result, { "data", 4 }));
        auto decoded = WTF::base64Decode(
            std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(b64.data()), b64.size()));
        if (!decoded) {
            promise->reject(vm, g, createError(g, "screenshot: invalid base64"_s));
            return;
        }
        auto* u8 = JSUint8Array::createUninitialized(g, g->m_typedArrayUint8.get(g),
            static_cast<uint32_t>(decoded->size()));
        if (!u8) {
            promise->reject(vm, g, createError(g, "screenshot: OOM"_s));
            return;
        }
        memcpy(u8->typedVector(), decoded->span().data(), decoded->size());
        promise->resolve(g, u8);
        return;
    }

    case Method::InputDispatchMouseEvent:
    case Method::InputDispatchKeyEvent:
    case Method::InputInsertText:
    case Method::EmulationSetDeviceMetricsOverride:
        // Input.* and Emulation.* reply with empty result on success.
        // Sync-reply — no _doAfter* barrier dance, the event has been
        // processed by the time we get the reply.
        promise->resolve(g, jsUndefined());
        return;
    }
}

void Transport::handleEvent(std::span<const char> method, std::span<const char> params, std::span<const char> sessionId)
{
    // Target.attachedToTarget — browser-level, sessionId in params routes
    // the new session to the view that requested the attach. Target.targetDestroyed
    // unhooks it. Page.frameNavigated fires the onNavigated callback.
    //
    // For v1 we handle Page.frameNavigated only. Target lifecycle is driven
    // by the command-response path (attachToTarget's result carries sessionId).

    auto* g = m_global;
    auto& vm = g->vm();

    // Page.frameNavigated — fire onNavigated with the URL.
    if (method.size() == 18 && memcmp(method.data(), "Page.frameNavigated", 18) == 0) {
        auto sidStr = WTF::String::fromUTF8(sessionId);
        auto it = m_sessions.find(sidStr);
        if (it == m_sessions.end()) return;
        JSWebView* view = it->value.get();
        if (!view) return;

        // params.frame.url — the committed URL.
        auto frame = jsonField(params, { "frame", 5 });
        auto url = jsonString(jsonField(frame, { "url", 3 }));
        auto urlStr = WTF::String::fromUTF8(url);
        view->m_url = urlStr;
        view->m_loading = false;

        if (JSObject* cb = view->m_onNavigated.get()) {
            Bun__EventLoop__runCallback2(g, JSValue::encode(cb), JSValue::encode(jsUndefined()),
                JSValue::encode(jsString(vm, urlStr)), JSValue::encode(jsUndefined()));
        }
        return;
    }

    // TODO: Page.loadEventFired, Target.targetDestroyed, Runtime.consoleAPICalled.
}

void Transport::onClose()
{
    rejectAllAndMarkDead("Chrome process closed the pipe"_s);
}

void Transport::rejectAllAndMarkDead(const WTF::String& reason)
{
    m_dead = true;
    m_readSock = nullptr;
    if (m_writeFd >= 0) {
        ::close(m_writeFd);
        m_writeFd = -1;
    }
    if (!m_global) return;
    auto* g = m_global;
    JSValue err = createError(g, reason);
    for (auto& [id, entry] : m_pending) {
        if (JSWebView* v = entry.view.get())
            v->m_pendingActivityCount.fetch_sub(1, std::memory_order_release);
        if (JSPromise* p = entry.promise.get())
            p->reject(g->vm(), g, err);
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
