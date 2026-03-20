#include "root.h"
#include "ChromeBackend.h"
#include "JSWebView.h"
#include "ipc_protocol.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <wtf/JSONValues.h>
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
// path overrides auto-detection; extraArgv (count entries, each NUL-
// terminated) appends after core flags. All pointers nullable.
extern "C" int32_t Bun__Chrome__ensure(Zig::GlobalObject*, const char* userDataDir,
    const char* path, const char* const* extraArgv, uint32_t extraArgvLen);
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

bool Transport::ensureSpawned(Zig::GlobalObject* zig, const WTF::String& userDataDir,
    const WTF::String& path, const WTF::Vector<WTF::String>& extraArgv)
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
    WTF::CString pathC = path.utf8();
    // Two-level pack: CString owns the bytes, ptrVec holds data() pointers.
    // Both live until Bun__Chrome__ensure returns (spawn copies argv).
    WTF::Vector<WTF::CString, 8> argvC;
    WTF::Vector<const char*, 8> argvPtrs;
    for (auto& s : extraArgv) {
        argvC.append(s.utf8());
        argvPtrs.append(argvC.last().data());
    }
    int32_t fd = Bun__Chrome__ensure(zig,
        dir.length() ? dir.data() : nullptr,
        pathC.length() ? pathC.data() : nullptr,
        argvPtrs.isEmpty() ? nullptr : argvPtrs.span().data(),
        static_cast<uint32_t>(argvPtrs.size()));
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

void Transport::send(Command&& cmd)
{
    cmd.finishAndWrite([this](const char* d, size_t n) {
        if (s_debugCDP && n > 1) [[unlikely]]
            fprintf(stderr, "[cdp tx] %.*s\n", static_cast<int>(n - (d[n - 1] == '\0' ? 1 : 0)), d);
        writeRaw(d, n);
    });
}

// us_socket_write through usockets' own write path — it sets
// last_write_failed on partial so the dispatch loop keeps WRITABLE polling
// armed and re-fires onWritable. Direct ::write() bypassed that flag and
// stopped the poll after the first fire, hanging large frames.
void Transport::writeRaw(const char* data, size_t len)
{
    if (m_dead || !m_readSock) return;

    if (m_txQueue.isEmpty()) {
        int w = us_socket_write(0, m_readSock, data, static_cast<int>(len));
        if (w == static_cast<int>(len)) return;
        // Partial (including 0 on EAGAIN). us_socket_write already set
        // last_write_failed; queue the tail for onWritable.
        m_txQueue.append(std::span<const uint8_t>(
            reinterpret_cast<const uint8_t*>(data) + w, len - w));
    } else {
        m_txQueue.append(std::span<const uint8_t>(
            reinterpret_cast<const uint8_t*>(data), len));
    }
}

void Transport::onWritable()
{
    while (!m_txQueue.isEmpty()) {
        int w = us_socket_write(0, m_readSock,
            reinterpret_cast<const char*>(m_txQueue.span().data()),
            static_cast<int>(m_txQueue.size()));
        if (w == 0) return; // EAGAIN — last_write_failed set, next fire retries
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

// sessionId → span<const char> for CDP::Command. sessionId is base64-ish
// (ASCII only) so Latin1 cast is safe — no UTF-8 multi-byte to worry about.
static std::span<const char> sidSpan(const WTF::String& s)
{
    if (s.isEmpty()) return {};
    ASSERT(s.is8Bit());
    auto span = s.span8();
    return { reinterpret_cast<const char*>(span.data()), span.size() };
}

// Bun click button → CDP button enum string. CDP's Input.dispatchMouseEvent
// takes a string: "none", "left", "middle", "right".
static constexpr ASCIILiteral cdpButton(uint8_t b)
{
    switch (b) {
    case 1:
        return "\"right\""_s;
    case 2:
        return "\"middle\""_s;
    default:
        return "\"left\""_s;
    }
}

// Bun modifier bits → CDP modifier integer. CDP uses bit 0=Alt, 1=Ctrl,
// 2=Meta, 3=Shift. ipc_protocol.h's ModShift=1 ModCtrl=2 ModAlt=4 ModMeta=8.
static constexpr int32_t cdpModifiers(uint8_t m)
{
    using namespace WebViewProto;
    int32_t r = 0;
    if (m & ModAlt) r |= 1;
    if (m & ModCtrl) r |= 2;
    if (m & ModMeta) r |= 4;
    if (m & ModShift) r |= 8;
    return r;
}

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

// Wraps settleSlot (JSWebView.cpp) with PendingSlot → barrier lookup.
static void settle(JSGlobalObject* g, JSWebView* view, PendingSlot slot, bool ok, JSValue v)
{
    settleSlot(g, view, slotFor(view, slot), ok, v);
}

// Build an Error from CDP exceptionDetails. exception.description is V8's
// Error.prototype.stack formatter:
//   "Error: msg\n    at functionName (url:line:col)\n    at ..."
//
// WTF::JSON parses to a C++ tree — no JSValue allocation, no GC pressure.
// The tree is small (exceptionDetails is error-path only, ~200B). Stamp
// .stack with description directly; Bun's V8StackTraceIterator
// (ZigException.cpp) already parses V8 stacks when it needs frames.
// ErrorInstance::create stackString overload sets .stack without capturing
// a JSC-side trace (which would show ChromeBackend.cpp, not page frames).
static JSValue errorFromExceptionDetails(JSGlobalObject* g, std::span<const char> excDetails)
{
    auto root = JSON::Value::parseJSON(
        StringView::fromLatin1(std::span<const Latin1Character>(
            reinterpret_cast<const Latin1Character*>(excDetails.data()), excDetails.size())));
    auto d = root ? root->asObject() : nullptr;
    if (!d) return createError(g, "JavaScript exception"_s);

    // exception.description (thrown Error) → full V8 stack string.
    // exception.value (thrown string) → the string itself.
    // text ("Uncaught (in promise)") → fallback only.
    WTF::String stack;
    if (auto exc = d->getObject("exception"_s)) {
        stack = exc->getString("description"_s);
        if (stack.isEmpty()) stack = exc->getString("value"_s);
    }
    if (stack.isEmpty()) stack = d->getString("text"_s);
    if (stack.isEmpty()) stack = "JavaScript exception"_s;

    // Message: first line past "ErrorName: " prefix. V8's first line is
    // Error.prototype.toString() which is `${name}: ${message}` (or just
    // `${name}` if message empty). Frame parsing is V8StackTraceIterator's
    // job; we only need the message here.
    auto nl = stack.find('\n');
    auto firstLine = (nl == WTF::notFound) ? stack : stack.substring(0, nl);
    auto colon = firstLine.find(": "_s);
    auto message = (colon != WTF::notFound && colon < 32)
        ? firstLine.substring(colon + 2)
        : firstLine;

    unsigned line = static_cast<unsigned>(d->getInteger("lineNumber"_s).value_or(0));
    unsigned col = static_cast<unsigned>(d->getInteger("columnNumber"_s).value_or(0));
    WTF::String url = d->getString("url"_s);

    return ErrorInstance::create(g, WTF::move(message), ErrorType::Error,
        LineColumn { line + 1, col + 1 }, // CDP 0-based → JS 1-based
        WTF::move(url), WTF::move(stack));
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
                .boolean("flatten"_s, true));
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
        send(Command(cid, "Page.enable"_s, sidSpan));
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
        send(Command(rid, "Runtime.enable"_s, sidSpan));

        // Page.navigate with the url stashed by the first navigate() call.
        // The response confirms the navigation STARTED; Page.loadEventFired
        // confirms completion. We keep the pending entry alive for the
        // response so errorText rejects the right slot.
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageNavigate, entry.slot, WTF::move(entry.view) });
        send(Command(cid, "Page.navigate"_s, sidSpan)
                .str("url"_s, view->m_pendingChromeNavigateUrl));
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

    case Method::PageGetNavigationHistory: {
        // {"currentIndex":N,"entries":[{"id":N,"url":"..."},...]}
        // Pick entries[currentIndex + delta].id and chain into
        // navigateToHistoryEntry. WTF::JSON parses to a C++ tree — no
        // JSValue allocation for a structure we only read once.
        auto root = JSON::Value::parseJSON(
            StringView::fromLatin1(std::span<const Latin1Character>(
                reinterpret_cast<const Latin1Character*>(result.data()), result.size())));
        auto o = root ? root->asObject() : nullptr;
        if (!o) {
            settle(g, view, entry.slot, false, createError(g, "malformed history response"_s));
            return;
        }
        int32_t cur = o->getInteger("currentIndex"_s).value_or(0);
        int32_t target = cur + view->m_chromeHistoryDelta;
        auto entries = o->getArray("entries"_s);
        if (!entries || target < 0 || static_cast<unsigned>(target) >= entries->length()) {
            // At history boundary — resolve undefined, same as WKWebView's
            // goBack no-op when canGoBack is false.
            settle(g, view, entry.slot, true, jsUndefined());
            return;
        }
        auto elem = entries->get(static_cast<unsigned>(target))->asObject();
        int32_t entryId = elem ? elem->getInteger("id"_s).value_or(0) : 0;
        // Chain into navigateToHistoryEntry. Page.loadEventFired settles.
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageNavigateToHistoryEntry, entry.slot, WTF::move(entry.view) });
        send(Command(cid, "Page.navigateToHistoryEntry"_s, sidSpan(view->m_sessionId))
                .num("entryId"_s, entryId));
        return;
    }
    case Method::PageNavigateToHistoryEntry:
        // Response is empty {} on success. Page.loadEventFired settles.
        return;

    case Method::RuntimeEvaluate: {
        // {"result":{"type":"...","value":...},"exceptionDetails":{...}?}
        // returnByValue:true + awaitPromise:true → result.value is the
        // JSON-serialized return. exceptionDetails present → script threw.
        auto excDetails = jsonField(result, { "exceptionDetails", 16 });
        if (!excDetails.empty()) {
            settle(g, view, entry.slot, false, errorFromExceptionDetails(g, excDetails));
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

    case Method::ScrollToSelectorEval: {
        // scrollIntoView ran page-side. exceptionDetails if timeout threw.
        auto excDetails = jsonField(result, { "exceptionDetails", 16 });
        if (!excDetails.empty()) {
            settle(g, view, entry.slot, false, errorFromExceptionDetails(g, excDetails));
        } else {
            settle(g, view, entry.slot, true, jsUndefined());
        }
        return;
    }

    case Method::ClickSelectorEval: {
        // Actionability check returned [cx, cy] or threw timeout.
        auto excDetails = jsonField(result, { "exceptionDetails", 16 });
        if (!excDetails.empty()) {
            settle(g, view, entry.slot, false, errorFromExceptionDetails(g, excDetails));
            return;
        }
        // result.result.value = [cx, cy]. jsonField gives us the array
        // slice "[<cx>,<cy>]"; scan for the comma.
        auto inner = jsonField(result, { "result", 6 });
        auto value = jsonField(inner, { "value", 5 });
        // Skip leading '['
        const char* p = value.data();
        const char* end = p + value.size();
        while (p < end && (*p == '[' || *p == ' '))
            ++p;
        // Parse cx (float until comma)
        char* ep;
        float cx = strtof(p, &ep);
        p = ep;
        while (p < end && (*p == ',' || *p == ' '))
            ++p;
        float cy = strtof(p, nullptr);

        // Chain into dispatchMouseEvent. Same down+up pair as Ops::click.
        auto ss = view->m_sessionId.utf8();
        std::span<const char> sid(ss.data(), ss.length());

        auto btn = cdpButton(view->m_selButton);
        int32_t mods = cdpModifiers(view->m_selModifiers);

        // Pressed — untracked fire-and-forget.
        uint32_t idDown = nextId();
        send(Command(idDown, "Input.dispatchMouseEvent"_s, sid)
                .raw("type"_s, "\"mousePressed\""_s)
                .num("x"_s, cx)
                .num("y"_s, cy)
                .raw("button"_s, btn)
                .num("clickCount"_s, static_cast<int32_t>(view->m_selClickCount))
                .num("modifiers"_s, mods));
        // Released — tracked, resolves the slot.
        uint32_t idUp = nextId();
        m_pending.add(idUp, Pending { Method::InputDispatchMouseEvent, entry.slot, WTF::move(entry.view) });
        send(Command(idUp, "Input.dispatchMouseEvent"_s, sid)
                .raw("type"_s, "\"mouseReleased\""_s)
                .num("x"_s, cx)
                .num("y"_s, cy)
                .raw("button"_s, btn)
                .num("clickCount"_s, static_cast<int32_t>(view->m_selClickCount))
                .num("modifiers"_s, mods));
        return;
    }
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

// --- CDP::Ops --------------------------------------------------------------
// One CDP::Command per op. Input.* and Page.captureScreenshot are
// synchronous-reply — the response means the operation completed, so these
// settle immediately on response. Page.navigate's response means the
// navigation started; actual load completion arrives via Page.loadEventFired
// (handled in Transport::handleEvent).

namespace Ops {

// Allocate promise, store in slot, add to Transport pending map, send frame.
// Caller guarantees the slot is empty and m_closed == false. Command is
// moved in; t.send() calls finishAndWrite which zero-copies to the pipe
// when the body is all-ASCII.
static JSPromise* sendChromeOp(JSGlobalObject* g, JSWebView* v,
    WriteBarrier<JSPromise>& slot, PendingSlot ps, Method m,
    uint32_t id, Command&& cmd)
{
    auto& vm = g->vm();
    auto& t = transport();
    auto* promise = JSPromise::create(vm, g->promiseStructure());
    if (t.m_dead || !t.m_readSock) {
        promise->reject(vm, g, createError(g, "Chrome process is not running"_s));
        return promise;
    }
    v->m_pendingActivityCount.fetch_add(1, std::memory_order_release);
    slot.set(vm, v, promise);
    t.m_pending.add(id, Pending { m, ps, Weak<JSWebView>(v, &webViewWeakOwner()) });
    t.send(WTF::move(cmd));
    t.updateKeepAlive();
    return promise;
}

// The first navigate() kicks off the attach chain: Target.createTarget
// (browser-level, no sessionId) → Target.attachToTarget → Page.enable →
// Page.navigate(url). Each response chains into the next command; the
// Navigate slot promise resolves on Page.loadEventFired, not on any
// response. Subsequent navigates skip straight to Page.navigate.
JSPromise* navigate(JSGlobalObject* g, JSWebView* view, const WTF::String& url)
{
    auto& t = transport();

    if (!view->m_sessionId.isEmpty()) {
        uint32_t id = t.nextId();
        return sendChromeOp(g, view, view->m_pendingNavigate, PendingSlot::Navigate,
            Method::PageNavigate, id,
            Command(id, "Page.navigate"_s, sidSpan(view->m_sessionId))
                .str("url"_s, url));
    }

    // First navigate: start the chain. Stash url; the PageEnable response
    // handler in Transport::handleResponse reads it and sends Page.navigate.
    // The Navigate slot promise is created now; it resolves much later on
    // Page.loadEventFired. The chain carries the same Weak<view> forward
    // so the pending activity count keeps this object rooted the whole time.
    //
    // newWindow:true is required for width/height — without it Chrome
    // reuses an existing window and rejects position params. Headless has
    // no visible window either way; "new window" just means "new top-level
    // browsing context".
    view->m_pendingChromeNavigateUrl = url;
    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingNavigate, PendingSlot::Navigate,
        Method::TargetCreateTarget, id,
        Command(id, "Target.createTarget"_s)
            .str("url"_s, "about:blank"_s)
            .boolean("newWindow"_s, true)
            .num("width"_s, static_cast<int32_t>(view->m_width))
            .num("height"_s, static_cast<int32_t>(view->m_height)));
}

// Runtime.evaluate with returnByValue + awaitPromise. Chrome JSON-serializes
// the result internally (same mechanism as WKWebView's page-side
// JSON.stringify but implicit). exceptionDetails present → script threw.
JSPromise* evaluate(JSGlobalObject* g, JSWebView* view, const WTF::String& script)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    // Same "await (expr)" wrap as WKWebView: forces expression context,
    // unwraps thenables. Chrome's awaitPromise does the await part; we
    // just need the paren-wrap for statement-sequence rejection consistency.
    auto body = makeString("(async()=>{return await ("_s, script, ")})()"_s);
    return sendChromeOp(g, view, view->m_pendingEval, PendingSlot::Evaluate,
        Method::RuntimeEvaluate, id,
        Command(id, "Runtime.evaluate"_s, sidSpan(view->m_sessionId))
            .str("expression"_s, body)
            .boolean("returnByValue"_s, true)
            .boolean("awaitPromise"_s, true));
}

JSPromise* screenshot(JSGlobalObject* g, JSWebView* view)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingScreenshot, PendingSlot::Screenshot,
        Method::PageCaptureScreenshot, id,
        Command(id, "Page.captureScreenshot"_s, sidSpan(view->m_sessionId))
            .raw("format"_s, "\"png\""_s));
}

// One mousePressed + one mouseReleased. CDP's Input.dispatchMouseEvent is
// synchronous-reply — Chrome processes the event, dispatches to the page,
// and THEN replies. No mouseEventQueue-drain SPI dance needed.
//
// The response to the Released event resolves the promise; the Pressed
// event is fire-and-forget (id allocated but not tracked in m_pending —
// Chrome sends a reply we ignore). Both frames go in one write().
JSPromise* click(JSGlobalObject* g, JSWebView* view, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto& t = transport();
    auto sid = sidSpan(view->m_sessionId);
    auto btn = cdpButton(button);
    int32_t mods = cdpModifiers(modifiers);

    // Pressed — untracked. Chrome replies but we don't need the ack; the
    // Released event's reply confirms both were processed.
    uint32_t idDown = t.nextId();
    t.send(Command(idDown, "Input.dispatchMouseEvent"_s, sid)
            .raw("type"_s, "\"mousePressed\""_s)
            .num("x"_s, x)
            .num("y"_s, y)
            .raw("button"_s, btn)
            .num("clickCount"_s, static_cast<int32_t>(clickCount))
            .num("modifiers"_s, mods));
    // Released — tracked, resolves the promise.
    uint32_t idUp = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchMouseEvent, idUp,
        Command(idUp, "Input.dispatchMouseEvent"_s, sid)
            .raw("type"_s, "\"mouseReleased\""_s)
            .num("x"_s, x)
            .num("y"_s, y)
            .raw("button"_s, btn)
            .num("clickCount"_s, static_cast<int32_t>(clickCount))
            .num("modifiers"_s, mods));
}

// Selector ops: Runtime.evaluate runs the rAF-polled actionability check
// (same predicate as WKWebView's kActionabilityJS). The IIFE takes
// (sel, timeout) — we appendQuotedJSONString the selector so any chars
// pass through. Response chains into dispatchMouseEvent.
JSPromise* clickSelector(JSGlobalObject* g, JSWebView* view, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount)
{
    auto& t = transport();

    view->m_selButton = button;
    view->m_selModifiers = modifiers;
    view->m_selClickCount = clickCount;

    // Build: kActionabilityIIFE + "(" + JSON(selector) + "," + timeout + ")"
    // The IIFE body is a fixed literal; only the call-site args are dynamic.
    WTF::StringBuilder sb;
    sb.append(kActionabilityIIFE, '(');
    sb.appendQuotedJSONString(selector);
    sb.append(',', timeout, ')');

    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::ClickSelectorEval, id,
        Command(id, "Runtime.evaluate"_s, sidSpan(view->m_sessionId))
            .str("expression"_s, sb.toString())
            .boolean("returnByValue"_s, true)
            .boolean("awaitPromise"_s, true));
}

JSPromise* scrollTo(JSGlobalObject* g, JSWebView* view, const WTF::String& selector, uint32_t timeout, uint8_t block)
{
    auto& t = transport();

    static constexpr ASCIILiteral blockNames[] = { "start"_s, "center"_s, "end"_s, "nearest"_s };
    auto blockStr = blockNames[block < 4 ? block : 1];

    WTF::StringBuilder sb;
    sb.append(kScrollToIIFE, '(');
    sb.appendQuotedJSONString(selector);
    sb.append(',', timeout, ",\""_s, blockStr, "\")"_s);

    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::ScrollToSelectorEval, id,
        Command(id, "Runtime.evaluate"_s, sidSpan(view->m_sessionId))
            .str("expression"_s, sb.toString())
            .boolean("returnByValue"_s, true)
            .boolean("awaitPromise"_s, true));
}

JSPromise* type(JSGlobalObject* g, JSWebView* view, const WTF::String& text)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    // Input.insertText does exactly what WKWebView's _executeEditCommand:
    // InsertText does — inserts text at the caret without keydown events.
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputInsertText, id,
        Command(id, "Input.insertText"_s, sidSpan(view->m_sessionId))
            .str("text"_s, text));
}

// VirtualKey → CDP key/code/windowsVirtualKeyCode. DOM key names from
// UIEvents-key spec (https://w3c.github.io/uievents-key/). Windows VK codes
// from WinUser.h. key == code for all named keys (e.g., "Enter" is both);
// Character has no code (layout-dependent) so we leave it empty.
struct CDPKeyInfo {
    ASCIILiteral key; // DOM key string; empty for Character (use char param)
    int32_t vk; // Windows virtual key code
    ASCIILiteral text; // char for keyDown type (generates input); empty for control keys
};
static const CDPKeyInfo& cdpKeyInfo(uint8_t k)
{
    // Indexed by VirtualKey enum value. text is the char a keyDown
    // produces — control keys like Arrow* produce none (rawKeyDown).
    static constexpr CDPKeyInfo table[] = {
        /* Character */ { {}, 0, {} },
        /* Enter */ { "Enter"_s, 13, "\r"_s },
        /* Tab */ { "Tab"_s, 9, "\t"_s },
        /* Space */ { " "_s, 32, " "_s },
        /* Backspace */ { "Backspace"_s, 8, {} },
        /* Delete */ { "Delete"_s, 46, {} },
        /* Escape */ { "Escape"_s, 27, {} },
        /* ArrowLeft */ { "ArrowLeft"_s, 37, {} },
        /* ArrowRight */ { "ArrowRight"_s, 39, {} },
        /* ArrowUp */ { "ArrowUp"_s, 38, {} },
        /* ArrowDown */ { "ArrowDown"_s, 40, {} },
        /* Home */ { "Home"_s, 36, {} },
        /* End */ { "End"_s, 35, {} },
        /* PageUp */ { "PageUp"_s, 33, {} },
        /* PageDown */ { "PageDown"_s, 34, {} },
    };
    return table[k < std::size(table) ? k : 0];
}

JSPromise* press(JSGlobalObject* g, JSWebView* view, uint8_t key, uint8_t modifiers, const WTF::String& character)
{
    auto& t = transport();
    auto sid = sidSpan(view->m_sessionId);
    int32_t mods = cdpModifiers(modifiers);
    const auto& info = cdpKeyInfo(key);

    // Character key: use the provided character for key/text. For named
    // keys, use the table. keyDown generates input events (beforeinput/
    // input); rawKeyDown fires keydown only. We want keydown + input for
    // text-producing keys (Enter, Tab, Space, Character), rawKeyDown for
    // control keys (Arrows, Escape, etc.) — same as WKWebView's editing-
    // command vs keyDown split.
    WTF::String keyStr = info.key ? WTF::String(info.key) : character;
    WTF::String textStr = info.text ? WTF::String(info.text)
        : key == 0                  ? character // Character
                                    : WTF::String();
    bool hasText = !textStr.isEmpty();

    // keyDown — always fire. Chrome's Input.dispatchKeyEvent is sync-reply;
    // the event is processed (keydown fired, default action run, input
    // fired if text present) by the time we get the reply. No _doAfter*
    // dance like WKWebView's press().
    uint32_t idDown = t.nextId();
    t.send(Command(idDown, "Input.dispatchKeyEvent"_s, sid)
            .raw("type"_s, hasText ? "\"keyDown\""_s : "\"rawKeyDown\""_s)
            .str("key"_s, keyStr)
            .str("text"_s, textStr)
            .num("windowsVirtualKeyCode"_s, info.vk)
            .num("modifiers"_s, mods));
    // keyUp — tracked, resolves the promise.
    uint32_t idUp = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchKeyEvent, idUp,
        Command(idUp, "Input.dispatchKeyEvent"_s, sid)
            .raw("type"_s, "\"keyUp\""_s)
            .str("key"_s, keyStr)
            .num("windowsVirtualKeyCode"_s, info.vk)
            .num("modifiers"_s, mods));
}

JSPromise* scroll(JSGlobalObject* g, JSWebView* view, double dx, double dy)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    // mouseWheel at the center. No presentation-barrier dance — Chrome's
    // reply means the scroll was processed.
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchMouseEvent, id,
        Command(id, "Input.dispatchMouseEvent"_s, sidSpan(view->m_sessionId))
            .raw("type"_s, "\"mouseWheel\""_s)
            .num("x"_s, view->m_width / 2.0)
            .num("y"_s, view->m_height / 2.0)
            .num("deltaX"_s, dx)
            .num("deltaY"_s, dy));
}

JSPromise* resize(JSGlobalObject* g, JSWebView* view, uint32_t width, uint32_t height)
{
    auto& t = transport();
    view->m_width = width;
    view->m_height = height;
    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::EmulationSetDeviceMetricsOverride, id,
        Command(id, "Emulation.setDeviceMetricsOverride"_s, sidSpan(view->m_sessionId))
            .num("width"_s, static_cast<int32_t>(width))
            .num("height"_s, static_cast<int32_t>(height))
            .num("deviceScaleFactor"_s, 1)
            .boolean("mobile"_s, false));
}

// Page.getNavigationHistory → Page.navigateToHistoryEntry chain. Playwright
// does the same (crPage.ts:_go). The response handler for GetNavigationHistory
// reads currentIndex and entries, picks entries[currentIndex + delta].id,
// chains into navigateToHistoryEntry. delta is stashed on the view.
static JSPromise* historyGo(JSGlobalObject* g, JSWebView* view, int8_t delta)
{
    auto& t = transport();
    view->m_chromeHistoryDelta = delta;
    uint32_t id = t.nextId();
    // Navigate slot — navigateToHistoryEntry IS a navigation and
    // Page.loadEventFired settles PendingSlot::Navigate only.
    return sendChromeOp(g, view, view->m_pendingNavigate, PendingSlot::Navigate,
        Method::PageGetNavigationHistory, id,
        Command(id, "Page.getNavigationHistory"_s, sidSpan(view->m_sessionId)));
}

JSPromise* goBack(JSGlobalObject* g, JSWebView* view) { return historyGo(g, view, -1); }
JSPromise* goForward(JSGlobalObject* g, JSWebView* view) { return historyGo(g, view, +1); }

JSPromise* reload(JSGlobalObject* g, JSWebView* view)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    // Navigate slot — reload IS a navigation. Page.loadEventFired only
    // settles PendingSlot::Navigate; using Misc would hang waiting for a
    // settle that never comes. WKWebView's reload uses Misc because its
    // Op::Reload Ack is synchronous.
    return sendChromeOp(g, view, view->m_pendingNavigate, PendingSlot::Navigate,
        Method::PageReload, id,
        Command(id, "Page.reload"_s, sidSpan(view->m_sessionId)));
}

void close(JSWebView* view)
{
    auto& t = transport();
    if (t.m_global) {
        auto* g = t.m_global;
        JSValue err = createError(g, "WebView closed"_s);
        settleSlot(g, view, view->m_pendingNavigate, false, err);
        settleSlot(g, view, view->m_pendingEval, false, err);
        settleSlot(g, view, view->m_pendingScreenshot, false, err);
        settleSlot(g, view, view->m_pendingMisc, false, err);
    }
    // Target.closeTarget — fire-and-forget. Chrome tears down the tab and
    // sends Target.targetDestroyed which we ignore. Erase sessionId from the
    // routing table so late events drop.
    if (!view->m_sessionId.isEmpty() && !view->m_targetId.isEmpty()) {
        uint32_t id = t.nextId();
        t.send(Command(id, "Target.closeTarget"_s)
                .str("targetId"_s, view->m_targetId));
        t.m_sessions.remove(view->m_sessionId);
    }
    t.updateKeepAlive();
}

} // namespace Ops

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
