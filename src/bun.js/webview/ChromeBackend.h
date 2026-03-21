#pragma once

// Chrome DevTools Protocol backend. --remote-debugging-pipe gives us fd 3
// (write to Chrome) and fd 4 (read from Chrome); NUL-delimited JSON frames.
// Chrome IS the child process — no intermediate host, one fewer IPC hop
// than the WKWebView path.
//
// Commands are per-method makeString templates. The one user string per
// command (URL, script, selector) goes through StringBuilder::
// appendQuotedJSONString. No JSValue construction on the send path.
//
// Response parsing is schema-driven: jsonField() scans for a top-level key
// with memchr + brace-depth counting. ~60 LOC, no general parser. The CDP
// envelope is flat with a known per-method schema; we extract the slice we
// care about and only JSC::JSONParse the evaluate result.value slice (same
// as WKWebView's EvalDone). The parsed envelope JSObject would exist solely
// to be read once — the intermediate materialization we avoid.
//
// Per-request map keyed on CDP id (not per-slot like WKWebView — that was
// forced by the completion-block model). Unlimited concurrent evals free.
// Multi-view: one Chrome, N Target.createTarget → each gets a sessionId;
// sessionId routes replies to the right JSWebView.

#include "root.h"
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/Vector.h>
#include <wtf/HashMap.h>
#include <wtf/text/StringBuilder.h>

struct us_socket_t;

namespace Zig {
class GlobalObject;
}

namespace Bun {

class JSWebView;
enum class ScreenshotFormat : uint8_t;

namespace CDP {

// --- JSON field scanner -----------------------------------------------------
// CDP responses are flat: {"id":N,"result":{...}} or {"id":N,"error":{...}}
// or {"method":"...","params":{...},"sessionId":"..."}. Known depth-1 keys.
//
// jsonField(span, "key") → span of the value slice. Brace-counts from the
// colon; stops at the matching close or comma at depth 0. No string decode,
// no escape handling — the scanner finds boundaries, the caller interprets.
// memchr for the key, then byte-walk to the colon, then depth-counted scan
// to the value end. Handles nested objects/arrays and string-quoted commas.
std::span<const char> jsonField(std::span<const char> json, std::span<const char> key);

// Parse the id out of {"id":N,...} — fast path, no general number parse.
// Returns 0 for events (no id field) or parse failure.
uint32_t jsonId(std::span<const char> json);

// Slice out the inner string contents (past the quotes, before escapes).
// The caller must know the field is a string. Does NOT unescape — for
// sessionId/targetId that's fine (base64-ish, no escapes); for method
// names it's fine (no escapes in CDP method names).
std::span<const char> jsonString(std::span<const char> field);

// --- Command builder -------------------------------------------------------
// Per-method fixed templates. The builder holds an inline-capacity
// StringBuilder; call one of the append*() methods in the right order, then
// finish() returns the NUL-terminated frame ready for the pipe.
//
// StringBuilder::appendQuotedJSONString is the one escape hatch — it's
// WTF's own JSON string quoter (handles control chars, quotes, backslash,
// non-BMP). Every user-controlled string goes through it.
class Command {
public:
    Command(uint32_t id, ASCIILiteral method, std::span<const char> sessionId = {})
    {
        m_sb.append("{\"id\":"_s, id, ",\"method\":\""_s, method, "\""_s);
        if (!sessionId.empty()) {
            m_sb.append(",\"sessionId\":\""_s);
            m_sb.append(std::span<const Latin1Character>(
                reinterpret_cast<const Latin1Character*>(sessionId.data()), sessionId.size()));
            m_sb.append('"');
        }
        m_sb.append(",\"params\":{"_s);
    }

    // Named string param. appendQuotedJSONString adds the quotes + escapes.
    // Rvalue-ref-qualified returns Command&& so chaining on a temporary
    // (the usual `send(Command(...).str(...).num(...))` pattern) stays an
    // rvalue and binds to send(Command&&).
    Command&& str(ASCIILiteral key, const WTF::String& value) &&
    {
        comma();
        m_sb.append('"', key, "\":"_s);
        m_sb.appendQuotedJSONString(value);
        return WTF::move(*this);
    }

    // Named number param. StringBuilder's variadic append has a double
    // StringTypeAdapter (FormattedNumber::fixedPrecision).
    Command&& num(ASCIILiteral key, double value) &&
    {
        comma();
        m_sb.append('"', key, "\":"_s, value);
        return WTF::move(*this);
    }

    Command&& num(ASCIILiteral key, int32_t value) &&
    {
        comma();
        m_sb.append('"', key, "\":"_s, value);
        return WTF::move(*this);
    }

    // Named boolean param.
    Command&& boolean(ASCIILiteral key, bool value) &&
    {
        comma();
        m_sb.append('"', key, "\":"_s, value ? "true"_s : "false"_s);
        return WTF::move(*this);
    }

    // Raw JSON fragment (pre-validated object/array). Used for nested params
    // like Input.dispatchMouseEvent's button enum — caller knows the value
    // is a fixed literal string, not user input.
    Command&& raw(ASCIILiteral key, ASCIILiteral fragment) &&
    {
        comma();
        m_sb.append('"', key, "\":"_s, fragment);
        return WTF::move(*this);
    }

    // Finish + write to a raw-byte sink. If the builder is 8-bit and all-
    // ASCII (the common case — the template IS ASCII, URLs/selectors
    // usually are), span8() aliases the buffer directly; zero-copy.
    // Non-ASCII Latin1 (bytes 128-255 passed through by appendQuotedJSON-
    // String) or UTF-16 (user string had a non-Latin1 codepoint) need the
    // utf8() transcode — one copy into the CString buffer, unavoidable.
    //
    // The trailing NUL frame delimiter: we write sink(body, len) then
    // sink("\0", 1). Two syscalls in the best case; a writev would be
    // one, but the pipe buffer coalesces anyway.
    template<typename Sink> // void(const char*, size_t)
    void finishAndWrite(Sink&& sink)
    {
        m_sb.append("}}"_s);
        if (m_sb.is8Bit()) [[likely]] {
            auto s = m_sb.span8();
            // OR-accumulate: all bytes < 0x80 → no high bit → valid ASCII.
            // One pass, no branching. Commands are typically <512B.
            Latin1Character acc = 0;
            for (auto c : s)
                acc |= c;
            if (!(acc & 0x80)) [[likely]] {
                sink(reinterpret_cast<const char*>(s.data()), s.size());
                sink("\0", 1);
                return;
            }
        }
        // Non-ASCII path: transcode. The CString has its own NUL terminator
        // at data()[length()], so length()+1 covers the frame delimiter.
        auto utf8 = m_sb.toString().utf8();
        sink(utf8.data(), utf8.length() + 1);
    }

private:
    void comma()
    {
        if (m_hasParam) m_sb.append(',');
        m_hasParam = true;
    }

    WTF::StringBuilder m_sb;
    bool m_hasParam = false;
};

// --- Method tags -----------------------------------------------------------
// The response handler dispatches on {id → methodTag} without re-reading
// the method string. Adding a method means adding a tag + a handler arm.
//
// TargetCreateTarget + TargetAttachToTarget + PageEnable form an internal
// chain kicked off by the first navigate() on a view. Their responses
// don't settle a user promise; the last one (PageEnable) sends the actual
// Page.navigate and the promise resolves on Page.loadEventFired.
enum class Method : uint8_t {
    // Internal attach chain — responses chain into the next command.
    TargetCreateTarget,
    TargetAttachToTarget,
    PageEnable,
    RuntimeEnable,
    // User-facing ops — responses settle (or errors reject) a slot.
    TargetCloseTarget,
    PageNavigate,
    PageReload,
    // Chained from Page.loadEventFired: Runtime.evaluate("document.title")
    // → set m_title, settle Navigate. Makes `await navigate(); view.title`
    // work like WKWebView (which packs title in NavDone).
    PageTitle,
    // goBack/goForward chain: getNavigationHistory → navigateToHistoryEntry.
    // The first picks entries[currentIndex + delta].id; the second navigates.
    // Page.loadEventFired settles, same as navigate/reload.
    PageGetNavigationHistory,
    PageNavigateToHistoryEntry,
    PageCaptureScreenshot,
    RuntimeEvaluate,
    InputDispatchMouseEvent,
    InputDispatchKeyEvent,
    InputInsertText,
    InputDispatchScrollEvent,
    EmulationSetDeviceMetricsOverride,
    // Selector ops — two-phase. Runtime.evaluate runs the rAF-polled
    // actionability check page-side; response chains into the actual
    // click/no-op. Same mechanism as WKWebView's callAsync + doNativeClick,
    // but the chain lives in the CDP pending map instead of a completion
    // block.
    ClickSelectorEval, // actionability → "cx,cy" → dispatchMouseEvent
    ScrollToSelectorEval, // scrollIntoView ran page-side → settle
};

// Shared actionability/scrollTo JS — same predicate as WKWebView's
// kActionabilityJS (WebViewHost.cpp:321). IIFE with `sel` and `timeout`
// passed as JSON-escaped arguments at the end — avoids Chrome's
// callFunctionOn dance for one string + one number.
//
// The predicate: attached + has size + in viewport + stable for 2 frames
// + elementFromPoint at center returns the element (not obscured). Returns
// the center coords as [cx, cy]; throws on timeout.
constexpr ASCIILiteral kActionabilityIIFE = R"js((async (sel, timeout) => {
const deadline = performance.now() + timeout;
let last;
for (;;) {
  const el = document.querySelector(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      if (last && last.l === r.left && last.t === r.top && last.w === r.width && last.h === r.height) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit === el || el.contains(hit)) return [cx, cy];
      }
      last = { l: r.left, t: r.top, w: r.width, h: r.height };
    } else last = undefined;
  } else last = undefined;
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "' to be actionable";
  await new Promise(f => requestAnimationFrame(f));
}
}))js"_s;

// scrollIntoView is page-side atomic — just wait for the element, scroll,
// return. No coords to parse.
constexpr ASCIILiteral kScrollToIIFE = R"js((async (sel, timeout, block) => {
const deadline = performance.now() + timeout;
for (;;) {
  const el = document.querySelector(sel);
  if (el) { el.scrollIntoView({ block, behavior: 'instant' }); return; }
  if (performance.now() > deadline) throw "timeout waiting for '" + sel + "'";
  await new Promise(f => requestAnimationFrame(f));
}
}))js"_s;

// --- Transport singleton ---------------------------------------------------
// Mirror of HostClient but NUL-framed JSON instead of binary. One socketpair
// — the child gets the peer end dup'd to fd 3 AND fd 4 (Chrome reads fd 3,
// writes fd 4; both hit our socket). Adopted into usockets for onData;
// writes go through the same fd via direct write(). Socketpair not two
// pipes because usockets' bsd_recv calls recv() which fails ENOTSOCK on a
// pipe — the error was misread as EOF and onClose fired before any data.
//
// pending maps CDP id → {methodTag, slot selector, weak view}. Promises
// live in the WriteBarrier slots on JSWebView (visitChildren marks them);
// the id map routes the response to the right slot. The Weak's owner
// predicate reads m_pendingActivityCount — same GC root pattern as
// HostClient's viewsById.
//
// One slot per op type means one pending op of each type per view. Chrome
// has no intrinsic serialization (every id is independent), so this caps
// concurrency artificially. Lifting the cap needs a per-view HashMap of
// barriers on JSWebView with a custom visitChildren — v2.
enum class PendingSlot : uint8_t {
    Navigate,
    Evaluate,
    Screenshot,
    Misc,
};

struct Pending {
    Method method;
    PendingSlot slot;
    JSC::Weak<JSWebView> view;
};

class Transport {
public:
    // Lazy-spawn Chrome. Returns false on spawn failure; caller throws.
    // path overrides auto-detection (BUN_CHROME_PATH > path > app bundles >
    // playwright cache). extraArgv appends after the core flags so user
    // flags can override built-ins. stdoutInherit/stderrInherit route
    // Chrome's output (chatty on stderr — GCM/updater/font-config noise).
    // Spawn args apply only on the FIRST call — subsequent views share the
    // one Chrome, so mismatched args across views get the first-call's.
    bool ensureSpawned(Zig::GlobalObject*, const WTF::String& userDataDir = {},
        const WTF::String& path = {}, const WTF::Vector<WTF::String>& extraArgv = {},
        bool stdoutInherit = false, bool stderrInherit = false);

    // Next CDP id — caller uses it with Command(id, ...) then calls send().
    uint32_t nextId() { return m_nextId++; }

    // Finish the command and write to the pipe. Zero-copy when the command
    // body is all-ASCII (the common case). See Command::finishAndWrite.
    void send(Command&& cmd);

    // Called from usockets onData. Parses complete NUL-delimited messages
    // out of rx, dispatches each to handleMessage.
    void onData(const char* data, int length);
    void onWritable();
    void onClose();

    Zig::GlobalObject* m_global = nullptr;
    us_socket_t* m_readSock = nullptr;
    bool m_dead = false;

    uint32_t m_nextId = 1;
    WTF::HashMap<uint32_t, Pending> m_pending;
    // sessionId → JSWebView. The string is the raw slice from
    // Target.attachedToTarget — base64-ish, no escapes, stored as-is.
    WTF::HashMap<WTF::String, JSC::Weak<JSWebView>> m_sessions;

    WTF::Vector<uint8_t> m_rx;
    WTF::Vector<uint8_t> m_txQueue;
    bool m_sockRefd = false;

    void handleMessage(std::span<const char> msg);
    void handleResponse(uint32_t id, std::span<const char> result, std::span<const char> error);
    void handleEvent(std::span<const char> method, std::span<const char> params, std::span<const char> sessionId);
    void rejectAllAndMarkDead(const WTF::String& reason);
    void updateKeepAlive();
    void writeRaw(const char* data, size_t len);
};

Transport& transport();

// --- CDP::Ops --------------------------------------------------------------
// Per-view ops. Each builds a CDP JSON command via Command (the one user-
// controlled string goes through appendQuotedJSONString), stores a promise
// in the right WriteBarrier slot, adds to Transport.m_pending, and writes
// the frame. Caller has already validated args and checked m_closed +
// slot-empty.
namespace Ops {

JSC::JSPromise* navigate(JSC::JSGlobalObject*, JSWebView*, const WTF::String& url);
JSC::JSPromise* evaluate(JSC::JSGlobalObject*, JSWebView*, const WTF::String& script);
JSC::JSPromise* screenshot(JSC::JSGlobalObject*, JSWebView*, ScreenshotFormat, uint8_t quality);
JSC::JSPromise* click(JSC::JSGlobalObject*, JSWebView*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);
JSC::JSPromise* clickSelector(JSC::JSGlobalObject*, JSWebView*, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount);
JSC::JSPromise* type(JSC::JSGlobalObject*, JSWebView*, const WTF::String& text);
JSC::JSPromise* press(JSC::JSGlobalObject*, JSWebView*, uint8_t virtualKey, uint8_t modifiers, const WTF::String& character);
JSC::JSPromise* scroll(JSC::JSGlobalObject*, JSWebView*, double dx, double dy);
JSC::JSPromise* scrollTo(JSC::JSGlobalObject*, JSWebView*, const WTF::String& selector, uint32_t timeout, uint8_t block);
JSC::JSPromise* resize(JSC::JSGlobalObject*, JSWebView*, uint32_t width, uint32_t height);
JSC::JSPromise* goBack(JSC::JSGlobalObject*, JSWebView*);
JSC::JSPromise* goForward(JSC::JSGlobalObject*, JSWebView*);
JSC::JSPromise* reload(JSC::JSGlobalObject*, JSWebView*);
void close(JSWebView*);

} // namespace Ops

} // namespace CDP

} // namespace Bun
