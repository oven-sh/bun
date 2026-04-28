#include "root.h"
#include "ChromeBackend.h"
#include "bun-uws/src/SocketKinds.h"
#include "JSWebView.h"
#include "ipc_protocol.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "ScriptExecutionContext.h"
#include "BunString.h"
#include "../bindings/webcore/WebSocket.h"
#include "../bindings/webcore/MessageEvent.h"
#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <JavaScriptCore/Strong.h>

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "JSBuffer.h"
#include <wtf/JSONValues.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/Base64.h>

#include <errno.h>
#include <mutex>
#include <stdio.h>
#include <stdlib.h>

#if OS(WINDOWS)
#include <winsock2.h>
#else
#include <unistd.h>
#include <sys/mman.h>
#include <fcntl.h>
#endif

#if OS(LINUX)
#include <dlfcn.h>
// shm_open/shm_unlink live in librt on older glibc and musl; glibc 2.34+
// moved them into libc. We don't link -lrt, so resolve at runtime.
// RTLD_DEFAULT finds them in libc on 2.34+; librt fallback covers older
// distros. macOS doesn't need this — libSystem (always linked) has both.
namespace {
struct Shm {
    int (*open)(const char*, int, mode_t) = nullptr;
    int (*unlink)(const char*) = nullptr;
    bool load()
    {
        if (open) return true;
        open = reinterpret_cast<decltype(open)>(dlsym(RTLD_DEFAULT, "shm_open"));
        unlink = reinterpret_cast<decltype(unlink)>(dlsym(RTLD_DEFAULT, "shm_unlink"));
        if (open && unlink) return true;
        void* h = dlopen("librt.so.1", RTLD_NOLOAD | RTLD_LAZY);
        if (!h) h = dlopen("librt.so.1", RTLD_NOW);
        if (!h) return false;
        open = reinterpret_cast<decltype(open)>(dlsym(h, "shm_open"));
        unlink = reinterpret_cast<decltype(unlink)>(dlsym(h, "shm_unlink"));
        return open && unlink;
    }
};
Shm s_shm;
} // namespace
#define BUN_SHM_OPEN(n, f, m) s_shm.open((n), (f), (m))
#define BUN_SHM_UNLINK(n) s_shm.unlink((n))
#define BUN_SHM_LOAD() s_shm.load()
#elif OS(DARWIN) || OS(FREEBSD)
#define BUN_SHM_OPEN(n, f, m) ::shm_open((n), (f), (m))
#define BUN_SHM_UNLINK(n) ::shm_unlink((n))
#define BUN_SHM_LOAD() true
#endif

#include "libusockets.h"
#include "_libusockets.h"

// LIBUS_SOCKET_DESCRIPTOR is SOCKET on Windows, int on POSIX. us_socket_
// from_fd takes one; its failure-path close needs the matching close.
// Bun__Chrome__ensure returns -1 on Windows (no socketpair) so the branch
// is unreachable there, but the compiler needs the decl to type-check.
#if OS(WINDOWS)
static inline void closefd(LIBUS_SOCKET_DESCRIPTOR s) { closesocket(s); }
#else
static inline void closefd(LIBUS_SOCKET_DESCRIPTOR fd) { ::close(fd); }
#endif

namespace Bun {
namespace CDP {

using namespace JSC;

// From ChromeProcess.zig. Returns the parent's socketpair fd (bidirectional).
// path overrides auto-detection; extraArgv (count entries, each NUL-
// terminated) appends after core flags. All pointers nullable.
extern "C" int32_t Bun__Chrome__ensure(Zig::GlobalObject*, const char* userDataDir,
    const char* path, const char* const* extraArgv, uint32_t extraArgvLen,
    bool stdoutInherit, bool stderrInherit);
extern "C" void* Blob__fromBytesWithType(JSC::JSGlobalObject*, const uint8_t* ptr, size_t len, const char* mime);
extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(Zig::GlobalObject*, void* impl);
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
// Scan a value slice from where the key matched. Depth counts braces/
// brackets; inStr tracks quoted regions (commas inside strings don't
// terminate). Depth-0 comma or enclosing-close ends it.
static std::span<const char> scanValue(const char* vstart, const char* end)
{
    int depth = 0;
    bool inStr = false, esc = false;
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
            if (depth == 0) break; // enclosing close ended the value
            --depth;
            continue;
        }
        if (c == ',' && depth == 0) break;
    }
    return { vstart, static_cast<size_t>(v - vstart) };
}

// Depth-counted walk: matches "key": only at depth 1 (inside the outermost
// object). {"result":{"id":2},"id":1} with key="id" returns the outer 1, not
// the nested 2 — the nested one is at depth 2. Chrome's encoder emits
// id-first in responses so a naive memchr happened to work, but CDP doesn't
// guarantee key ordering; a proxy or Chrome version change would surface
// the misparse as promise hangs (handleResponse's find(wrong-id)==end()
// drops the reply).
std::span<const char> jsonField(std::span<const char> json, std::span<const char> key)
{
    const char* p = json.data();
    const char* end = p + json.size();
    size_t klen = key.size();

    int depth = 0;
    bool inStr = false, esc = false;
    for (; p + klen + 3 < end; ++p) {
        char c = *p;
        if (esc) {
            esc = false;
            continue;
        }
        if (c == '\\') {
            esc = true;
            continue;
        }
        if (c == '"') {
            // Opening quote outside a string at depth 1 → a key start.
            // Chrome's encoder emits no whitespace; "key": is contiguous.
            // String VALUES at depth 1 are preceded by a colon so the
            // quote before them has inStr transitioning true→false and
            // the next quote (the value's opening) sees depth 1 with
            // inStr false again — but that quote's byte+1 isn't going to
            // match the key (it's the value's first char), so the memcmp
            // fails and we flip inStr for the string body.
            if (!inStr && depth == 1
                && memcmp(p + 1, key.data(), klen) == 0
                && p[klen + 1] == '"' && p[klen + 2] == ':')
                return scanValue(p + klen + 3, end);
            inStr = !inStr;
            continue;
        }
        if (inStr) continue;
        if (c == '{' || c == '[') {
            ++depth;
            continue;
        }
        if (c == '}' || c == ']') {
            --depth;
            continue;
        }
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

// One group per process — reused across Chrome respawns. Embedded (not
// heap-alloc'd) and lazily linked into the loop on first socket. The vtable
// is static-const since the singleton handlers never change.
static us_socket_group_t s_cdpGroup;

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

static constexpr us_socket_vtable_t s_cdpVTable = {
    .on_open = cdpOnOpen,
    .on_data = cdpOnData,
    .on_fd = nullptr,
    .on_writable = cdpOnWritable,
    .on_close = cdpOnClose,
    .on_timeout = nullptr,
    .on_long_timeout = nullptr,
    .on_end = cdpOnEnd,
    .on_connect_error = nullptr,
    .on_connecting_error = nullptr,
    .on_handshake = nullptr,
};

bool Transport::ensureSpawned(Zig::GlobalObject* zig, const WTF::String& userDataDir,
    const WTF::String& path, const WTF::Vector<WTF::String>& extraArgv,
    bool stdoutInherit, bool stderrInherit)
{
    if (m_mode != TransportMode::None && !m_dead) return true;
    if (m_dead) {
        m_dead = false;
        m_readSock = nullptr;
        m_rx.clear();
        m_txQueue.clear();
    }
    m_mode = TransportMode::Pipe;

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
        static_cast<uint32_t>(argvPtrs.size()),
        stdoutInherit, stderrInherit);
    if (fd < 0) {
        m_dead = true;
        return false;
    }
    // Socketpair — same fd for read + write. Chrome's end is dup'd to its
    // fd 3 and fd 4; read(3)+write(4) both hit our socketpair peer. usockets'
    // bsd_recv calls recv() which needs a real socket (pipe fds broke here
    // with ENOTSOCK silently misread as EOF).
    m_global = zig;

    if (!s_cdpGroup.loop) {
        us_socket_group_init(&s_cdpGroup, uws_get_loop(), &s_cdpVTable, nullptr);
    }

    // Adopt read fd only. usockets polls it READABLE|WRITABLE but we only
    // care about READABLE — writable events on a read-end pipe fire
    // constantly, but onWritable is a no-op when m_txQueue is empty so
    // they're harmless. kind=1 (.dynamic) → dispatch via s_cdpVTable.
    m_readSock = us_socket_from_fd(&s_cdpGroup, BUN_SOCKET_KIND_DYNAMIC, nullptr, sizeof(void*), fd, 0);
    if (!m_readSock) {
        closefd(fd);
        m_dead = true;
        return false;
    }
    return true;
}

void Transport::send(uint32_t cdpId, Command&& cmd)
{
    if (m_mode == TransportMode::WebSocket) {
        // WS text frame per CDP message — the framing IS the delimiter.
        // If the handshake hasn't completed, queue with the id; wsOnOpen
        // drains, skipping ids that Ops::close already erased from
        // m_pending (view closed before open = don't create its target).
        // sendTextNative is a no-op when m_state != OPEN, so queuing is
        // mandatory here or commands silently drop.
        auto body = cmd.finishToString();
        if (m_wsOpen) {
            m_ws->sendTextNative(body);
        } else {
            m_wsPending.append({ cdpId, WTF::move(body) });
        }
        return;
    }
    cmd.finishAndWrite([this](const char* d, size_t n) { writeRaw(d, n); });
}

// --- WebSocket transport ----------------------------------------------------
// Native-callback trampolines. Plain C function pointers (not capturing
// lambdas) — the ctx arg is the Transport* singleton. Zig's CppWebSocket
// wrapper already does eventLoop.enter()/exit() around the extern "C"
// call, so any JS these end up running (settle → resolve → .then()) is
// already in the right execution context.

static void wsOnOpen(void* ctx)
{
    auto& t = *static_cast<Transport*>(ctx);
    t.m_wsOpen = true;
    // Drain commands queued during the handshake, skipping ids whose
    // Pending entry was erased (Ops::close → m_pending.removeIf). A
    // view closed before the handshake completed shouldn't create its
    // target — orphaned tab in the user's Chrome, visible until the WS
    // closes. id==0 means untracked fire-and-forget (Runtime.enable);
    // always send those — they don't create targets.
    for (auto& cmd : t.m_wsPending) {
        if (cmd.id && !t.m_pending.contains(cmd.id)) continue;
        t.m_ws->sendTextNative(cmd.body);
    }
    t.m_wsPending.clear();
}

static void wsOnMessage(void* ctx, std::span<const char> utf8)
{
    auto& t = *static_cast<Transport*>(ctx);
    // One text frame = one CDP message. handleMessage is mode-agnostic
    // — same JSON parsing as the pipe's NUL-delimited frames. The span
    // is valid until this callback returns (UTF8View's storage on the
    // caller's stack); handleMessage doesn't stash it.
    auto& vm = t.m_global->vm();
    auto catchScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    t.handleMessage(utf8);
    if (auto* ex = catchScope.exception()) [[unlikely]] {
        catchScope.clearExceptionExceptTermination();
        t.m_global->reportUncaughtExceptionAtEventLoop(t.m_global, ex);
    }
}

static void wsOnClose(void* ctx, unsigned short code)
{
    auto& t = *static_cast<Transport*>(ctx);
    bool neverOpened = !t.m_wsOpen;
    bool wasAutoDetected = std::exchange(t.m_wasAutoDetected, false);
    t.m_wsOpen = false;
    t.m_ws = nullptr;

    // Stale-file fallback: if we auto-detected (read DevToolsActivePort
    // ourselves, user didn't ask for WS) AND the connect never opened
    // (stale port/path from a dead Chrome), fall back to spawn. The
    // pending commands re-send over the pipe. If onOpen DID fire, the
    // user's Chrome was reachable and now isn't — that's a real error
    // (user killed Chrome, dialog dismissed, etc.), surface it.
    //
    // m_wsPending holds the Command bodies as WTF::Strings. Those are
    // pipe-safe (the pipe also carries UTF-8 JSON, just NUL-delimited).
    // ensureSpawned sets m_mode = Pipe; send() routes to writeRaw; the
    // first spawn's onOpen path (socket adoption) drains the same way.
    // But m_wsPending stores the NON-NUL-terminated body. The pipe needs
    // the NUL. We write each body + NUL manually after spawn.
    if (wasAutoDetected && neverOpened) {
        t.m_mode = TransportMode::None;
        // m_wsPending survives — we replay it below after spawn. Don't
        // let ensureSpawned's m_dead-reset clear it.
        auto pending = std::exchange(t.m_wsPending, {});
        if (t.ensureSpawned(t.m_global, t.m_fallbackUserDataDir, {}, {},
                t.m_fallbackStdoutInherit, t.m_fallbackStderrInherit)) {
            // Replay over the pipe. Same cancellation check as wsOnOpen
            // — skip ids close() already removed. Append the NUL
            // terminator the pipe protocol needs.
            for (auto& cmd : pending) {
                if (cmd.id && !t.m_pending.contains(cmd.id)) continue;
                Bun::UTF8View view(cmd.body);
                auto s = view.span();
                t.writeRaw(s.data(), s.size());
                t.writeRaw("\0", 1);
            }
            return;
        }
        // Spawn also failed. ensureSpawned set m_dead before returning
        // false; rejectAllAndMarkDead's guard would short-circuit and
        // the pending promises would hang. Clear it so reject runs.
        t.m_dead = false;
    }

    // rejectAllAndMarkDead settles every pending promise with an error.
    // If onOpen never fired (connect failure), m_pending holds the first
    // navigate's Target.createTarget — it rejects with this message.
    t.rejectAllAndMarkDead(makeString("Chrome WebSocket closed (code "_s, code, ')'));
}

bool Transport::ensureConnected(Zig::GlobalObject* zig, const WTF::String& wsUrl, bool autoDetected,
    const WTF::String& userDataDir, bool stdoutInherit, bool stderrInherit)
{
    // Already connected — singleton semantics, first call wins.
    if (m_mode != TransportMode::None && !m_dead) return true;
    if (m_dead) {
        m_dead = false;
        m_ws = nullptr;
        m_wsOpen = false;
        m_wsPending.clear();
        m_rx.clear();
        m_txQueue.clear();
    }
    m_global = zig;
    m_mode = TransportMode::WebSocket;
    m_wasAutoDetected = autoDetected;
    if (autoDetected) {
        m_fallbackUserDataDir = userDataDir;
        m_fallbackStdoutInherit = stdoutInherit;
        m_fallbackStderrInherit = stderrInherit;
    }

    auto* ctx = zig->scriptExecutionContext();
    auto result = WebCore::WebSocket::create(*ctx, wsUrl);
    if (result.hasException()) {
        m_dead = true;
        m_mode = TransportMode::None;
        return false;
    }
    m_ws = result.releaseReturnValue();
    // setNativeCallbacks swaps the MessageEvent/dispatchEvent path for
    // direct C++ calls BEFORE the upgrade completes — handshake is async
    // (queued on the event loop, can't fire before this returns). If we
    // raced, the normal path would dispatch via EventTarget into an
    // empty listener map and the message would silently drop.
    m_ws->setNativeCallbacks({
        .ctx = this,
        .onOpen = wsOnOpen,
        .onMessage = wsOnMessage,
        .onClose = wsOnClose,
    });
    return true;
}

// us_socket_write through usockets' own write path — it sets
// last_write_failed on partial so the dispatch loop keeps WRITABLE polling
// armed and re-fires onWritable. Direct ::write() bypassed that flag and
// stopped the poll after the first fire, hanging large frames.
void Transport::writeRaw(const char* data, size_t len)
{
    if (m_dead || !m_readSock) return;

    if (m_txQueue.isEmpty()) {
        int w = us_socket_write(m_readSock, data, static_cast<int>(len));
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
        int w = us_socket_write(m_readSock,
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
    case PendingSlot::Cdp:
        return view->m_pendingCdp;
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
    auto& vm = g->vm();
    JSWebView* view = viewFor(entry.viewId);
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
        m_pending.add(cid, Pending { Method::TargetAttachToTarget, entry.slot, entry.viewId });
        send(cid, Command(cid, "Target.attachToTarget"_s).str("targetId"_s, view->m_targetId).boolean("flatten"_s, true));
        return;
    }
    case Method::TargetAttachToTarget: {
        // {"sessionId":"<base64ish>"}
        auto sid = jsonString(jsonField(result, { "sessionId", 9 }));
        view->m_sessionId = WTF::String::fromUTF8(sid);
        // Route events to this view via its viewId — m_views holds the one
        // Weak per view. A view with a slot set is rooted via the owner
        // predicate reading m_pendingActivityCount.
        m_sessions.add(view->m_sessionId, entry.viewId);
        updateKeepAlive();

        // Page.enable lets us receive frameNavigated / loadEventFired.
        // sessionId now available — the remaining chain goes to the page.
        auto ss = view->m_sessionId.utf8();
        std::span<const char> sidSpan(ss.data(), ss.length());
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageEnable, entry.slot, entry.viewId });
        send(cid, Command(cid, "Page.enable"_s, sidSpan));
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
        send(0, Command(rid, "Runtime.enable"_s, sidSpan));

        // Page.navigate with the url stashed by the first navigate() call.
        // The response confirms the navigation STARTED; Page.loadEventFired
        // confirms completion. We keep the pending entry alive for the
        // response so errorText rejects the right slot.
        uint32_t cid = nextId();
        m_pending.add(cid, Pending { Method::PageNavigate, entry.slot, entry.viewId });
        send(cid, Command(cid, "Page.navigate"_s, sidSpan).str("url"_s, view->m_pendingChromeNavigateUrl));
        view->m_pendingChromeNavigateUrl = WTF::String();
        return;
    }
    case Method::RuntimeEnable:
    case Method::TargetCloseTarget:
        // Untracked fire-and-forget — close() sends TargetCloseTarget
        // without adding to m_pending (the view is going away). Chrome's
        // reply finds no entry, handleResponse's find()==end() drops it.
        // This case arm is unreachable; present for switch completeness.
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

    case Method::PageTitle: {
        // Runtime.evaluate("document.title") chained from loadEventFired.
        // result.result.value is the string. Set m_title, settle Navigate.
        auto inner = jsonField(result, { "result", 6 });
        auto value = jsonString(jsonField(inner, { "value", 5 }));
        view->m_title = WTF::String::fromUTF8(value);
        settle(g, view, entry.slot, true, jsUndefined());
        return;
    }

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
        m_pending.add(cid, Pending { Method::PageNavigateToHistoryEntry, entry.slot, entry.viewId });
        send(cid, Command(cid, "Page.navigateToHistoryEntry"_s, sidSpan(view->m_sessionId)).num("entryId"_s, entryId));
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
        // {"data":"<base64 encoded image>"} — the base64 string is the ONLY
        // representation CDP gives us. All encodings except Base64 need to
        // decode first. m_screenshotEncoding stashed by screenshot() before
        // dispatch picks the JS shape.
        auto b64 = jsonString(jsonField(result, { "data", 4 }));
        auto enc = view->m_screenshotEncoding;

        if (enc == ScreenshotEncoding::Base64) {
            // Zero decode — hand back the CDP "data" string as-is. The user
            // wanted base64; CDP gave us base64. The string is allocated
            // fresh (jsonString returns a span into the rx buffer, not
            // safe to hold past the next onData), so one copy into the JS
            // heap via fromUTF8 → jsString.
            settle(g, view, entry.slot, true,
                jsString(vm, WTF::String::fromUTF8(std::span<const char>(b64.data(), b64.size()))));
            return;
        }

        auto decoded = WTF::base64Decode(
            std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(b64.data()), b64.size()));
        if (!decoded) {
            settle(g, view, entry.slot, false, createError(g, "screenshot: invalid base64"_s));
            return;
        }

        if (enc == ScreenshotEncoding::Buffer) {
            // createBuffer(span) copies into a JSC-allocated ArrayBuffer.
            // decoded Vector drops after; one copy. We can't
            // adopt-the-Vector because WTF::Vector uses WTF's bmalloc, not
            // the JSC ArrayBuffer allocator — destructors wouldn't match.
            settle(g, view, entry.slot, true,
                createBuffer(g, decoded->span()));
            return;
        }

#if !OS(WINDOWS)
        if (enc == ScreenshotEncoding::Shmem) {
            // Create a fresh POSIX shm segment, write decoded bytes, return
            // {name, size}. Caller (or Kitty via t=s) owns shm_unlink.
            // Name uses our pid + a monotonic counter — same scheme as the
            // WebKit child, different namespace (chrome- prefix) so they
            // never collide even if someone mixes backends in one process.
            if (!BUN_SHM_LOAD()) {
                settle(g, view, entry.slot, false,
                    createError(g, "shm_open unavailable (librt not found)"_s));
                return;
            }
            static uint32_t shmSeq = 0;
            char name[48];
            snprintf(name, sizeof(name), "/bun-chrome-%d-%u", getpid(), ++shmSeq);
            int fd = BUN_SHM_OPEN(name, O_CREAT | O_RDWR | O_EXCL, 0600);
            if (fd < 0) {
                settle(g, view, entry.slot, false,
                    createError(g, makeString("shm_open: "_s, WTF::String::fromUTF8(strerror(errno)))));
                return;
            }
            size_t sz = decoded->size();
            if (ftruncate(fd, static_cast<off_t>(sz)) != 0) {
                int err = errno; // close/unlink can clobber errno
                ::close(fd);
                BUN_SHM_UNLINK(name);
                settle(g, view, entry.slot, false,
                    createError(g, makeString("ftruncate: "_s, WTF::String::fromUTF8(strerror(err)))));
                return;
            }
            void* map = mmap(nullptr, sz, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
            int mmap_err = (map == MAP_FAILED) ? errno : 0;
            ::close(fd);
            if (map == MAP_FAILED) {
                BUN_SHM_UNLINK(name);
                settle(g, view, entry.slot, false,
                    createError(g, makeString("mmap: "_s, WTF::String::fromUTF8(strerror(mmap_err)))));
                return;
            }
            memcpy(map, decoded->span().data(), sz);
            munmap(map, sz);
            // Don't unlink — the name IS the return value. User (Kitty)
            // unlinks after shm_open'ing.
            auto* obj = constructEmptyObject(g);
            obj->putDirect(vm, Identifier::fromString(vm, "name"_s),
                jsString(vm, WTF::String::fromUTF8(std::span<const char>(name, strlen(name)))));
            obj->putDirect(vm, Identifier::fromString(vm, "size"_s),
                jsNumber(static_cast<double>(sz)));
            settle(g, view, entry.slot, true, obj);
            return;
        }
#endif

        // Blob — the default. Blob__fromBytes copies via mimalloc
        // (handleOom crashes on failure, no JS exception). m_screenshotFormat
        // picks the MIME so `Bun.write(path, blob)` / `new Response(blob)`
        // don't need the user to remember what format they asked for.
        void* impl = Blob__fromBytesWithType(g, decoded->span().data(), decoded->size(),
            screenshotMimeType(view->m_screenshotFormat));
        settle(g, view, entry.slot, true,
            JSValue::decode(Blob__create(defaultGlobalObject(g), impl)));
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
        send(0, Command(idDown, "Input.dispatchMouseEvent"_s, sid).raw("type"_s, "\"mousePressed\""_s).num("x"_s, cx).num("y"_s, cy).raw("button"_s, btn).num("clickCount"_s, static_cast<int32_t>(view->m_selClickCount)).num("modifiers"_s, mods));
        // Released — tracked, resolves the slot.
        uint32_t idUp = nextId();
        m_pending.add(idUp, Pending { Method::InputDispatchMouseEvent, entry.slot, entry.viewId });
        send(idUp, Command(idUp, "Input.dispatchMouseEvent"_s, sid).raw("type"_s, "\"mouseReleased\""_s).num("x"_s, cx).num("y"_s, cy).raw("button"_s, btn).num("clickCount"_s, static_cast<int32_t>(view->m_selClickCount)).num("modifiers"_s, mods));
        return;
    }

    case Method::UserRaw: {
        // User-supplied raw command via view.cdp(). result is the verbatim
        // CDP result object JSON; JSONParse it into a JSValue so the user
        // gets the same object shape CDP documents. The error path is
        // handled earlier in this function (error span non-empty → reject
        // with createError). Some CDP methods legitimately return `{}`
        // (Input.*, Page.reload) — JSONParse gives an empty JSObject.
        JSValue v = JSONParse(g, WTF::String::fromUTF8(result));
        settle(g, view, entry.slot, true, v ? v : jsUndefined());
        return;
    }
    }
}

void Transport::handleEvent(std::span<const char> method, std::span<const char> params, std::span<const char> sessionId)
{
    auto* g = m_global;
    auto& vm = g->vm();

    // Target.detachedFromTarget — fires when an attached session's target
    // dies (renderer crash, OOM, kill). params: {sessionId, targetId}.
    // Browser-level (no sessionId on the envelope). close() handles user-
    // initiated closes eagerly; this is the only notification for external
    // death. Without it, pending evaluates on the dead view hang forever.
    if (sessionId.empty()) {
        if (method.size() != 25 || memcmp(method.data(), "Target.detachedFromTarget", 25) != 0)
            return;
        auto sid = jsonString(jsonField(params, { "sessionId", 9 }));
        auto sidStr = WTF::String::fromUTF8(sid);
        auto it = m_sessions.find(sidStr);
        if (it == m_sessions.end()) return;
        uint32_t vid = it->value;
        m_sessions.remove(it);
        JSWebView* view = viewFor(vid);
        m_views.remove(vid);
        if (!view) return;
        // Reject all pending slots. settle() is idempotent on empty slots.
        auto* err = createError(g, "page detached (crashed or closed)"_s);
        for (auto s : { PendingSlot::Navigate, PendingSlot::Evaluate, PendingSlot::Screenshot, PendingSlot::Misc, PendingSlot::Cdp })
            settle(g, view, s, false, err);
        // Erase stale m_pending entries — replies won't come.
        m_pending.removeIf([vid](auto& kv) { return kv.value.viewId == vid; });
        view->m_closed = true;
        updateKeepAlive();
        return;
    }
    auto sidStr = WTF::String::fromUTF8(sessionId);
    auto it = m_sessions.find(sidStr);
    if (it == m_sessions.end()) return;
    JSWebView* view = viewFor(it->value);
    if (!view) {
        // Weak died (user dropped view during a load). Chrome will keep
        // sending events; erasing here stops the lookup thrash.
        m_views.remove(it->value);
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

    // Page.loadEventFired — load complete. Chain a document.title fetch
    // so view.title is populated when navigate() resolves — matches
    // WKWebView's NavDone which packs url+title in one reply. One extra
    // roundtrip (~1ms), but the user-visible guarantee is worth it:
    // `await view.navigate(); view.title` just works.
    //
    // If no navigate is pending (uninitiated navigation, redirect), the
    // PageTitle handler settles a no-op and m_title still updates.
    if (method.size() == 19 && memcmp(method.data(), "Page.loadEventFired", 19) == 0) {
        view->m_loading = false;
        uint32_t tid = nextId();
        m_pending.add(tid, Pending { Method::PageTitle, PendingSlot::Navigate, view->m_viewId });
        send(tid, Command(tid, "Runtime.evaluate"_s, sidSpan(view->m_sessionId)).str("expression"_s, "document.title"_s).boolean("returnByValue"_s, true));
        return;
    }

    // Runtime.consoleAPICalled — fires for every console.* call in the page.
    // params: {"type":"log","args":[<RemoteObject>,...],"stackTrace":{...}}.
    if (method.size() == 24 && memcmp(method.data(), "Runtime.consoleAPICalled", 24) == 0) {
        if (!view->m_consoleIsGlobal && !view->m_onConsole) return;

        // WTF::JSON parse — small payload per call, console-path-only.
        auto root = JSON::Value::parseJSON(WTF::String::fromUTF8(params));
        auto o = root ? root->asObject() : nullptr;
        if (!o) return;
        auto type = o->getString("type"_s);
        auto argsArr = o->getArray("args"_s);

        // remoteToJS allocates (jsString/JSONParse). Both dispatch paths
        // re-enter JS — logWithLevel via ConsoleClient, the custom callback
        // via call() — and each opens its own ThrowScope which asserts
        // under validateExceptionChecks if a prior simulated throw wasn't
        // checked. Check after building args; release before dispatch so
        // the nested scope takes over. Real exceptions propagate to
        // onData's TopExceptionScope.
        auto scope = DECLARE_THROW_SCOPE(vm);

        // RemoteObject → JSValue. Primitives unwrap to raw values (so
        // console.log("hi") forwards as "hi", not {type:"string",value:"hi"}).
        // Object/function RemoteObjects JSONParse whole — the user (or
        // util.inspect) sees {className, description, preview:{properties}}
        // which is the best we get without a Runtime.getProperties roundtrip.
        auto remoteToJS = [&](RefPtr<JSON::Object> ao) -> JSValue {
            auto t = ao->getString("type"_s);
            if (t == "string"_s) return jsString(vm, ao->getString("value"_s));
            if (t == "number"_s) return jsNumber(ao->getDouble("value"_s).value_or(0));
            if (t == "boolean"_s) return jsBoolean(ao->getBoolean("value"_s).value_or(false));
            if (t == "undefined"_s) return jsUndefined();
            if (t == "bigint"_s || t == "symbol"_s)
                // No .value — .description is "42n" / "Symbol(foo)".
                return jsString(vm, ao->getString("description"_s));
            // object / function. JSONParse the whole RemoteObject so the
            // caller can inspect preview.properties. toJSONString round-
            // trips the WTF::JSON tree back to a string; JSC::JSONParse
            // builds the JSValue tree.
            auto s = ao->toJSONString();
            auto v = JSONParse(g, s);
            return v ? v : jsNull();
        };

        MarkedArgumentBuffer args;
        if (argsArr) {
            for (auto& a : *argsArr) {
                auto ao = a->asObject();
                JSValue v = ao ? remoteToJS(ao) : jsUndefined();
                RETURN_IF_EXCEPTION(scope, void());
                args.append(v);
            }
        }

        if (view->m_consoleIsGlobal) {
            // ConsoleClient::logWithLevel — the same path console.log()
            // takes after argument collection. ScriptArguments holds
            // Vector<Strong<Unknown>> which GC-roots across the call
            // (util.format allocates). Inspector forwarding + Bun's
            // console formatter apply.
            //
            // CDP type → MessageLevel. trace/dir/table/assert all render
            // through Log level with their formatting intact (the args
            // carry the structure); level distinction matters for
            // error/warn coloring and stderr routing.
            using JSC::MessageLevel;
            MessageLevel ml = MessageLevel::Log;
            if (type == "error"_s || type == "assert"_s)
                ml = MessageLevel::Error;
            else if (type == "warning"_s)
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
            scope.release();
            if (auto clientRef = g->consoleClient())
                clientRef->logWithLevel(g, WTF::move(scriptArgs), ml);
            return;
        }

        // Custom callback: (type, ...args).
        JSObject* cb = view->m_onConsole.get();
        auto callData = getCallData(cb);
        if (callData.type == CallData::Type::None) return;
        JSValue typeStr = jsString(vm, type.isEmpty() ? "log"_s : type);
        RETURN_IF_EXCEPTION(scope, void());
        MarkedArgumentBuffer cbArgs;
        cbArgs.append(typeStr);
        for (unsigned i = 0; i < args.size(); ++i)
            cbArgs.append(args.at(i));
        scope.release();
        call(g, cb, callData, jsUndefined(), cbArgs);
        return;
    }

    // Unhandled CDP event — dispatch to the view's EventTarget if it has
    // a listener for this method name. Check hasEventListeners first:
    // Chrome is chatty (frameScheduledNavigation, lifecycleEvent, etc.)
    // and most events won't have listeners; skipping the JSONParse saves
    // an alloc per unwanted event. The listener was added via
    // view.addEventListener("Network.responseReceived", e => e.data.response).
    auto methodAtom = AtomString::fromUTF8(method);
    if (!view->wrapped().hasEventListeners(methodAtom)) return;

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue data = JSONParse(g, WTF::String::fromUTF8(params));
    RETURN_IF_EXCEPTION(scope, void());
    if (!data) data = jsUndefined();
    // MessageEvent::m_jsData is a JSValueInWrappedObject (Weak<>). The
    // wrapper's visitAdditionalChildren roots it AFTER wrapper creation;
    // dispatchEvent allocates that wrapper which can GC in between. Keep
    // the parsed object alive across the gap.
    JSC::EnsureStillAliveScope dataRoot { data };

    WebCore::MessageEvent::Init init;
    init.data = data;
    auto event = WebCore::MessageEvent::create(methodAtom, WTF::move(init), WebCore::Event::IsTrusted::Yes);
    scope.release();
    view->wrapped().dispatchEvent(event);
}

void Transport::onClose()
{
    rejectAllAndMarkDead("Chrome process closed the pipe"_s);
}

void Transport::rejectAllAndMarkDead(const WTF::String& reason)
{
    if (m_dead) return;
    m_dead = true;
    // us_socket_close is idempotent (checks is_closed internally) so calling
    // it from the cdpOnClose path is a no-op. When this runs via
    // Bun__Chrome__died (EVFILT_PROC won the race against EOF) the socket
    // is still polling — close it. us_socket_close fires cdpOnClose
    // synchronously; the m_dead guard above short-circuits that reentrant
    // call so the caller's `reason` survives.
    if (auto* s = std::exchange(m_readSock, nullptr)) us_socket_close(s, 0, nullptr);
    // WebSocket mode: drop our ref. The WS's native onClose calls us
    // (wsOnClose → rejectAllAndMarkDead); that path nulls m_ws after
    // this returns. If WE'RE initiating (closeAll), close() kicks off the
    // closing handshake; we don't wait for it, just drop. The m_dead
    // guard prevents wsOnClose from re-entering.
    if (m_ws) {
        auto ws = std::exchange(m_ws, nullptr);
        ws->setNativeCallbacks({}); // prevent wsOnClose re-entry
        ws->close(std::nullopt, WTF::String());
    }
    m_mode = TransportMode::None;
    m_wsOpen = false;
    m_wsPending.clear();
    if (!m_global) return;
    auto* g = m_global;
    JSValue err = createError(g, reason);
    // Reject each view's slots via settle(). Multiple pending ids may point
    // at the same view (different slots); settle() is idempotent on an
    // already-cleared slot — the first settle for a slot rejects, the rest
    // find barrier.get() == null and no-op.
    for (auto& [id, entry] : m_pending) {
        if (JSWebView* v = viewFor(entry.viewId))
            settle(g, v, entry.slot, false, err);
    }
    m_pending.clear();
    m_sessions.clear();
    m_views.clear();
    updateKeepAlive();
}

void Transport::updateKeepAlive()
{
    // m_views is source-of-truth for live views (populated in
    // createChrome, erased in close/destroy). m_pending covers in-flight
    // ops on a view that was just closed but the response hasn't arrived.
    bool want = !m_views.isEmpty() || !m_pending.isEmpty();
    if (want == m_sockRefd || !m_global) return;
    m_sockRefd = want;
    Bun__eventLoop__incrementRefConcurrently(
        WebCore::clientData(m_global->vm())->bunVM, want ? 1 : -1);

    // WebSocket mode: close the connection when the last view is gone.
    // We're connected to the USER'S Chrome — keeping the WS open after
    // they're done holds a DevTools session (shows "<Bun> is debugging
    // this browser" in Chrome's UI). Pipe mode keeps the subprocess
    // alive (it's OURS), but the user's Chrome should be released.
    //
    // m_mode reset to None means the next `new Bun.WebView()` re-runs
    // auto-detect → reconnect (pops the Allow dialog again, which is
    // correct — it's a new session). The close handshake is async but
    // we don't wait; setNativeCallbacks({}) prevents wsOnClose from
    // re-entering rejectAllAndMarkDead on the ack.
    if (!want && m_mode == TransportMode::WebSocket && m_ws) {
        auto ws = std::exchange(m_ws, nullptr);
        ws->setNativeCallbacks({});
        ws->close(std::nullopt, WTF::String());
        m_wsOpen = false;
        m_wasAutoDetected = false;
        m_mode = TransportMode::None;
    }
}

uint32_t Transport::registerView(JSWebView* v)
{
    uint32_t id = m_nextViewId++;
    m_views.add(id, JSC::Weak<JSWebView>(v, &webViewWeakOwner()));
    return id;
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
    // m_mode == None means neither ensureSpawned nor ensureConnected ran
    // (constructor already called one, so this is unreachable unless
    // rejectAllAndMarkDead reset it). WebSocket mode doesn't need
    // m_wsOpen here — send() queues until onOpen fires.
    if (t.m_dead || t.m_mode == TransportMode::None) {
        promise->reject(vm, g, createError(g, "Chrome connection is not available"_s));
        return promise;
    }
    v->m_pendingActivityCount.fetch_add(1, std::memory_order_release);
    slot.set(vm, v, promise);
    t.m_pending.add(id, Pending { m, ps, v->m_viewId });
    t.send(id, WTF::move(cmd));
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

// Raw CDP escape hatch. method is the domain-qualified name
// ("Page.captureScreenshot", "DOM.querySelector", etc.); paramsJson is the
// output of JSON.stringify(params) — a well-formed JSON object or "{}".
// The Command::RawTag constructor passes both through: method gets
// appendQuotedJSONString (it's user input, could have a stray quote),
// paramsJson is inserted verbatim (JSON.stringify guarantees well-formed).
// Response handler JSONParse's the result object and settles with the
// decoded JSValue — caller gets the same object shape CDP documents.
//
// Scoped to the view's sessionId, so commands target THIS tab. Browser-
// level commands (Target.*, Browser.*) need the sessionId omitted —
// if m_sessionId is empty (first-navigate chain not yet complete) we send
// browser-level. For explicit browser-level after attach, the user can
// construct a second WebView or await Bun-side Target APIs (v2).
JSPromise* cdp(JSGlobalObject* g, JSWebView* view, const WTF::String& method, const WTF::String& paramsJson)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingCdp, PendingSlot::Cdp,
        Method::UserRaw, id,
        Command(Command::RawTag {}, id, method, sidSpan(view->m_sessionId), paramsJson));
}

JSPromise* screenshot(JSGlobalObject* g, JSWebView* view, ScreenshotFormat format, uint8_t quality)
{
    auto& t = transport();
    uint32_t id = t.nextId();
    // CDP takes format as a JSON string. quality is ignored for PNG by
    // Chrome; for JPEG/WebP it's 0-100. Pass it unconditionally — Chrome
    // silently ignores quality for PNG, and the builder's && ref-qualifier
    // means conditionals break the chain (lvalue after materialization).
    // The response handler reads view->m_screenshotFormat (stashed by
    // JSWebView::screenshot before dispatch) to stamp the right MIME type
    // on the Blob.
    ASCIILiteral fmtLit = format == ScreenshotFormat::Jpeg ? "\"jpeg\""_s
        : format == ScreenshotFormat::Webp                 ? "\"webp\""_s
                                                           : "\"png\""_s;
    return sendChromeOp(g, view, view->m_pendingScreenshot, PendingSlot::Screenshot,
        Method::PageCaptureScreenshot, id,
        Command(id, "Page.captureScreenshot"_s, sidSpan(view->m_sessionId))
            .raw("format"_s, fmtLit)
            .num("quality"_s, static_cast<int32_t>(quality)));
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
    t.send(0, Command(idDown, "Input.dispatchMouseEvent"_s, sid).raw("type"_s, "\"mousePressed\""_s).num("x"_s, x).num("y"_s, y).raw("button"_s, btn).num("clickCount"_s, static_cast<int32_t>(clickCount)).num("modifiers"_s, mods));
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

// Translate Bun's button-mask bitmap (bit 0=left, bit 1=right, bit 2=middle)
// to CDP's `buttons` field, which matches the W3C MouseEvent.buttons bit
// layout: bit 0=left, bit 1=right, bit 2=middle. Same layout. Kept as a
// helper for clarity and in case the layouts ever diverge.
static int32_t cdpButtonsMask(uint8_t mask) { return mask; }

// Low-level pointer primitives. mouseDown/mouseUp mirror click()'s single-
// event paths. mouseMove emits one dispatchMouseEvent per intermediate
// step plus the final — all but the last are fire-and-forget; the last
// resolves the slot. Chrome processes events in send order, so the final
// reply means all preceding events landed too.
JSPromise* mouseDown(JSGlobalObject* g, JSWebView* view, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask)
{
    auto& t = transport();
    auto sid = sidSpan(view->m_sessionId);
    auto btn = cdpButton(button);
    int32_t mods = cdpModifiers(modifiers);
    int32_t buttons = cdpButtonsMask(buttonsMask);

    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchMouseEvent, id,
        Command(id, "Input.dispatchMouseEvent"_s, sid)
            .raw("type"_s, "\"mousePressed\""_s)
            .num("x"_s, x)
            .num("y"_s, y)
            .raw("button"_s, btn)
            .num("buttons"_s, buttons)
            .num("clickCount"_s, static_cast<int32_t>(clickCount))
            .num("modifiers"_s, mods));
}

JSPromise* mouseUp(JSGlobalObject* g, JSWebView* view, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask)
{
    auto& t = transport();
    auto sid = sidSpan(view->m_sessionId);
    auto btn = cdpButton(button);
    int32_t mods = cdpModifiers(modifiers);
    int32_t buttons = cdpButtonsMask(buttonsMask);

    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchMouseEvent, id,
        Command(id, "Input.dispatchMouseEvent"_s, sid)
            .raw("type"_s, "\"mouseReleased\""_s)
            .num("x"_s, x)
            .num("y"_s, y)
            .raw("button"_s, btn)
            .num("buttons"_s, buttons)
            .num("clickCount"_s, static_cast<int32_t>(clickCount))
            .num("modifiers"_s, mods));
}

// mouseMove: emit steps-1 intermediate events + 1 final. For pure hover
// (buttonsMask==0) the event is a plain mouseMoved with button:"none".
// When dragging (buttonsMask != 0) the event type is still "mouseMoved"
// — CDP doesn't have a separate "mouseDragged" — but the non-zero
// `buttons` field tells Chrome a drag is in progress. Chrome synthesizes
// the right pointermove/mousemove + dragenter/dragover dispatch on the
// page side.
JSPromise* mouseMove(JSGlobalObject* g, JSWebView* view, float fromX, float fromY, float x, float y, uint32_t steps, uint8_t buttonsMask, uint8_t modifiers)
{
    auto& t = transport();
    auto sid = sidSpan(view->m_sessionId);
    int32_t mods = cdpModifiers(modifiers);
    int32_t buttons = cdpButtonsMask(buttonsMask);

    // CDP mouseMoved with no pressed button wants "none"; with a button
    // held it wants the string name of the primary button for legacy
    // `MouseEvent.button` in handlers. Pick the lowest-order pressed bit.
    ASCIILiteral btnStr = "\"none\""_s;
    if (buttonsMask & 0x1)
        btnStr = "\"left\""_s;
    else if (buttonsMask & 0x2)
        btnStr = "\"right\""_s;
    else if (buttonsMask & 0x4)
        btnStr = "\"middle\""_s;

    if (steps < 1) steps = 1;

    // Emit the first (steps - 1) events as fire-and-forget; send the
    // final event with a tracked id that resolves the slot. Chrome
    // processes serially so the final reply means all prior events
    // were handled.
    for (uint32_t i = 1; i < steps; ++i) {
        float ix = fromX + (x - fromX) * (static_cast<float>(i) / static_cast<float>(steps));
        float iy = fromY + (y - fromY) * (static_cast<float>(i) / static_cast<float>(steps));
        uint32_t idInterm = t.nextId();
        t.send(0, Command(idInterm, "Input.dispatchMouseEvent"_s, sid)
                      .raw("type"_s, "\"mouseMoved\""_s)
                      .num("x"_s, ix)
                      .num("y"_s, iy)
                      .raw("button"_s, btnStr)
                      .num("buttons"_s, buttons)
                      .num("modifiers"_s, mods));
    }

    uint32_t id = t.nextId();
    return sendChromeOp(g, view, view->m_pendingMisc, PendingSlot::Misc,
        Method::InputDispatchMouseEvent, id,
        Command(id, "Input.dispatchMouseEvent"_s, sid)
            .raw("type"_s, "\"mouseMoved\""_s)
            .num("x"_s, x)
            .num("y"_s, y)
            .raw("button"_s, btnStr)
            .num("buttons"_s, buttons)
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
    t.send(0, Command(idDown, "Input.dispatchKeyEvent"_s, sid).raw("type"_s, hasText ? "\"keyDown\""_s : "\"rawKeyDown\""_s).str("key"_s, keyStr).str("text"_s, textStr).num("windowsVirtualKeyCode"_s, info.vk).num("modifiers"_s, mods));
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
        settleSlot(g, view, view->m_pendingCdp, false, err);
    }
    // Prune m_pending entries for this view — the attach chain
    // (TargetCreateTarget → TargetAttachToTarget → PageEnable →
    // PageNavigate) holds Weak<view> per step and each step chains to the
    // next on reply. If close() lands mid-chain, the next reply would
    // continue on a closed view: m_sessions.add re-registers it,
    // PageEnable sends Page.navigate, the tab navigates after dispose.
    // removeIf breaks the chain at the next reply — handleResponse's
    // find(id)==end() early-return drops it.
    t.m_pending.removeIf([vid = view->m_viewId](auto& pair) {
        return pair.value.viewId == vid;
    });
    // Target.closeTarget — fire-and-forget. targetId is stashed at
    // TargetCreateTarget's reply (before sessionId) so it's populated
    // earlier in the chain. Chrome tears down the tab; we ignore the
    // Target.targetDestroyed event. Erase sessionId so late events drop.
    if (!view->m_targetId.isEmpty()) {
        t.send(0, Command(t.nextId(), "Target.closeTarget"_s).str("targetId"_s, view->m_targetId));
    }
    if (!view->m_sessionId.isEmpty()) t.m_sessions.remove(view->m_sessionId);
    t.m_views.remove(view->m_viewId);
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
