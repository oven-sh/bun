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

struct us_socket_context_t;
struct us_socket_t;

namespace Zig {
class GlobalObject;
}

namespace Bun {

class JSWebView;

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
    Command& str(ASCIILiteral key, const WTF::String& value)
    {
        comma();
        m_sb.append('"', key, "\":"_s);
        m_sb.appendQuotedJSONString(value);
        return *this;
    }

    // Named number param. StringBuilder's variadic append has a double
    // StringTypeAdapter (FormattedNumber::fixedPrecision).
    Command& num(ASCIILiteral key, double value)
    {
        comma();
        m_sb.append('"', key, "\":"_s, value);
        return *this;
    }

    Command& num(ASCIILiteral key, int32_t value)
    {
        comma();
        m_sb.append('"', key, "\":"_s, value);
        return *this;
    }

    // Named boolean param.
    Command& boolean(ASCIILiteral key, bool value)
    {
        comma();
        m_sb.append('"', key, "\":"_s, value ? "true"_s : "false"_s);
        return *this;
    }

    // Raw JSON fragment (pre-validated object/array). Used for nested params
    // like Input.dispatchMouseEvent's button enum — caller knows the value
    // is a fixed literal string, not user input.
    Command& raw(ASCIILiteral key, ASCIILiteral fragment)
    {
        comma();
        m_sb.append('"', key, "\":"_s, fragment);
        return *this;
    }

    // Finish: close params and the outer object, append NUL. The Vector is
    // the builder's own buffer — no extra copy. Caller writes it to the pipe.
    WTF::CString finish()
    {
        m_sb.append("}}\0"_s);
        return m_sb.toString().utf8();
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
enum class Method : uint8_t {
    TargetCreateTarget,
    TargetAttachToTarget,
    TargetCloseTarget,
    PageNavigate,
    PageCaptureScreenshot,
    RuntimeEvaluate,
    InputDispatchMouseEvent,
    InputDispatchKeyEvent,
    InputInsertText,
    EmulationSetDeviceMetricsOverride,
};

// --- Transport singleton ---------------------------------------------------
// Mirror of HostClient but NUL-framed JSON instead of binary. The read side
// is fd 4 adopted into usockets; the write side is fd 3 with a direct
// write() + EAGAIN queue (usockets doesn't handle write-only-pipe-fds
// cleanly — it wants bidirectional sockets).
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
    bool ensureSpawned(Zig::GlobalObject*, const WTF::String& userDataDir = {});

    // Next CDP id — caller uses it with Command(id, ...) then calls send().
    uint32_t nextId() { return m_nextId++; }

    // Write a NUL-terminated frame to Chrome's fd 3. The frame came from
    // Command::finish() which appended the NUL.
    uint32_t send(const WTF::CString& frame);

    // Called from usockets onData. Parses complete NUL-delimited messages
    // out of rx, dispatches each to handleMessage.
    void onData(const char* data, int length);
    void onWritable();
    void onClose();

    Zig::GlobalObject* m_global = nullptr;
    us_socket_context_t* m_ctx = nullptr;
    us_socket_t* m_readSock = nullptr;
    int m_writeFd = -1;
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

} // namespace CDP

} // namespace Bun
