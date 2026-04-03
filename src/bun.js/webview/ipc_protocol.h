#pragma once

// Wire protocol between the Bun process (parent, JS thread, usockets) and
// the WebView host process (child, CFRunLoopRun on thread 0). Length-prefixed
// frames over a SOCK_STREAM socketpair. No JSON, no alignment padding.
//
// Parent death → socket EOF → child's read() returns 0 → CFRunLoopStop.

#include <cstdint>
#include <span>
#include <wtf/Forward.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

typedef struct __CFFileDescriptor* CFFileDescriptorRef;

namespace Bun::WebViewProto {

#pragma pack(push, 1)

struct Frame {
    uint32_t len; // payload bytes following this 9-byte header
    uint32_t viewId; // parent-assigned; child routes by it, echoes in reply.
                     // Reply type → slot on JSWebView. No req_id map.
    uint8_t op;
    // uint8_t payload[len] follows
};

static_assert(sizeof(Frame) == 9);

// Cap at uint30 max. evaluate() scripts can be arbitrarily large; this just
// catches the 0xFFFFFFFF corruption case (top two bits set) before unbounded
// rx growth + livelock on a never-satisfiable partial-payload check.
constexpr uint32_t kMaxFrameLen = (1u << 30) - 1;

#pragma pack(pop)

// Parent → child. viewId is in the frame header.
enum class Op : uint8_t {
    Create = 1, // u32 w, u32 h, u8 dataStoreKind, [u32 dirLen, dir bytes]
    Navigate = 2, // u32 urlLen, url bytes
    Evaluate = 3, // u32 scriptLen, script bytes
    Screenshot = 4, // u8 format (0=png 1=jpeg 2=webp), u8 quality (0-100, ignored for png)
    Close = 5, // (empty)
    Resize = 6, // u32 w, u32 h
    GoBack = 7, // (empty)
    GoForward = 8, // (empty)
    Reload = 9, // (empty)

    // Native input with proper WebKit completion barriers.
    // Click: NSEvent mouseDown/Up + _doAfterProcessingAllPendingMouseEvents:
    // Type:  _executeEditCommand("InsertText") — sendWithAsyncReply
    // Press: editing command with completion, or keyDown fallback for
    //        Escape/chord keys (no completion; WebKit exposes no keyboard
    //        equivalent of the mouse barrier).
    Click = 10, // ClickPayload
    Type = 11, // str text
    Press = 12, // PressPayload + [str char iff VirtualKey::Character]
    Scroll = 13, // ScrollPayload

    // click(selector) — page-side rAF-polled actionability check via
    // callAsyncJavaScript:, then native click at the resolved coords.
    ClickSelector = 14, // ClickSelectorPayload + str selector

    // scrollTo(selector) — page-side scrollIntoView via callAsyncJavaScript:
    // after waiting for the element to exist. No native wheel; scroll event
    // fires (isTrusted:true — browser-driven), scrollY updates,
    // IntersectionObserver triggers.
    ScrollTo = 15, // ScrollToPayload + str selector
};

// Mouse button: 0=left, 1=right, 2=middle.
// Modifier bits (parent encoding, expanded to NSEventModifierFlags in child):
enum : uint8_t {
    ModShift = 1 << 0,
    ModCtrl = 1 << 1,
    ModAlt = 1 << 2,
    ModMeta = 1 << 3,
};

// --- Payload structs -------------------------------------------------------
// Fixed-size heads; variable-length strings (u32 len + utf8) follow where
// noted. Both sides include this header so encode/decode stay in lockstep.
// No padding — pragma pack(1) already in effect above for Frame.

#pragma pack(push, 1)

struct CreatePayload {
    uint32_t width;
    uint32_t height;
    uint8_t dataStoreKind; // DataStoreKind; str persistDir follows iff Persistent
};

struct ClickPayload {
    float x; // viewport coords, y-down
    float y;
    uint8_t button;
    uint8_t modifiers;
    uint8_t clickCount;
};

struct ResizePayload {
    uint32_t width;
    uint32_t height;
};

struct PressPayload {
    uint8_t virtualKey; // VirtualKey; str character follows iff Character
    uint8_t modifiers;
};

struct ScrollPayload {
    float deltaX;
    float deltaY;
};

struct ClickSelectorPayload {
    uint32_t timeout; // ms; page-time (performance.now), pauses with debugger
    uint8_t button;
    uint8_t modifiers;
    uint8_t clickCount;
    // str selector follows
};

struct ScrollToPayload {
    uint32_t timeout;
    uint8_t block; // 0=start 1=center 2=end 3=nearest
    // str selector follows
};

#pragma pack(pop)

static_assert(sizeof(CreatePayload) == 9);
static_assert(sizeof(ClickPayload) == 11);
static_assert(sizeof(ResizePayload) == 8);
static_assert(sizeof(PressPayload) == 2);
static_assert(sizeof(ScrollPayload) == 8);
static_assert(sizeof(ClickSelectorPayload) == 7);
static_assert(sizeof(ScrollToPayload) == 5);

// Encode: POD head + optional trailing string (u32 len + utf8). 64 bytes
// inline covers every head; strings that overflow it heap-allocate, which
// is fine — evaluate() scripts are the only large ones and they pay one
// alloc per call anyway.
template<typename Head>
WTF::Vector<uint8_t, 64> encode(const Head& head, const WTF::String& tail = {})
{
    static_assert(std::is_trivially_copyable_v<Head>);
    WTF::Vector<uint8_t, 64> out;
    if (tail.isNull()) {
        out.grow(sizeof(Head));
        __builtin_memcpy(out.mutableSpan().data(), &head, sizeof(Head));
    } else {
        WTF::CString c = tail.utf8();
        uint32_t n = static_cast<uint32_t>(c.length());
        out.grow(sizeof(Head) + 4 + n);
        uint8_t* p = out.mutableSpan().data();
        __builtin_memcpy(p, &head, sizeof(Head));
        p += sizeof(Head);
        __builtin_memcpy(p, &n, 4);
        p += 4;
        __builtin_memcpy(p, c.data(), n);
    }
    return out;
}

// String-only payload (Navigate, Evaluate, Type) — no head struct.
inline WTF::Vector<uint8_t, 64> encodeStr(const WTF::String& s)
{
    WTF::CString c = s.utf8();
    uint32_t n = static_cast<uint32_t>(c.length());
    WTF::Vector<uint8_t, 64> out;
    out.grow(4 + n);
    uint8_t* p = out.mutableSpan().data();
    __builtin_memcpy(p, &n, 4);
    __builtin_memcpy(p + 4, c.data(), n);
    return out;
}

// Press() key tag. Order doesn't matter across the wire — both sides
// include this header. Parent maps JS string name → tag; child maps tag →
// editing command (with completion) or HID keyCode (keyDown fallback).
enum class VirtualKey : uint8_t {
    Character = 0, // payload has a trailing str (single char, e.g. Cmd+A)
    Enter,
    Tab,
    Space,
    Backspace,
    Delete,
    Escape,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    Home,
    End,
    PageUp,
    PageDown,
};

// Child → parent. Reply type determines the WriteBarrier slot on JSWebView:
// NavDone/NavFailed → m_pendingNavigate, EvalDone/EvalFailed → m_pendingEval,
// ScreenshotDone/Failed → m_pendingScreenshot, Ack/Error → m_pendingMisc.
enum class Reply : uint8_t {
    NavDone = 2, // u32 urlLen, url bytes, u32 titleLen, title bytes
    NavFailed = 3, // u32 errLen, err bytes
    EvalDone = 4, // u32 resultLen, result bytes
    EvalFailed = 5, // u32 errLen, err bytes
    ScreenshotDone = 6, // u32 shmNameLen, name bytes, u32 pngLen
    ScreenshotFailed = 7, // u32 errLen, err bytes
    Ack = 8, // no payload — Create/Close/Resize/Go*/Reload
    Error = 9, // u32 errLen, err bytes

    // Unsolicited — fires the onNavigated/onNavigationFailed callback.
    // Same viewId in header; these arrive BEFORE the corresponding
    // NavDone/NavFailed reply so the callback fires before `await` resumes.
    NavEvent = 10, // u32 urlLen, url, u32 titleLen, title
    NavFailEvent = 11, // u32 errLen, err

    // Unsolicited — fires the console callback or forwards to the global
    // console. A user-script wrap of console.{log,warn,...} posts via
    // WKScriptMessageHandler; the delegate packs and ships this event.
    // Payload: str type + u32 argCount + (str arg)*, where each arg is
    // the page-side JSON.stringify of the console argument.
    ConsoleEvent = 12,
};

enum class DataStoreKind : uint8_t {
    Ephemeral = 0,
    Persistent = 1,
};

// Minimal packed reader — payloads are dense, no alignment. Both ends are us,
// but the outer Frame.len already bounds the payload: clamping here costs a
// compare and turns a child-corruption segfault into an empty string.
struct Reader {
    const uint8_t* p;
    const uint8_t* end;

    size_t remaining() const { return static_cast<size_t>(end - p); }

    uint32_t u32()
    {
        if (remaining() < 4) [[unlikely]] {
            p = end;
            return 0;
        }
        uint32_t v;
        __builtin_memcpy(&v, p, 4);
        p += 4;
        return v;
    }
    uint16_t u16()
    {
        if (remaining() < 2) [[unlikely]] {
            p = end;
            return 0;
        }
        uint16_t v;
        __builtin_memcpy(&v, p, 2);
        p += 2;
        return v;
    }
    float f32()
    {
        if (remaining() < 4) [[unlikely]] {
            p = end;
            return 0;
        }
        float v;
        __builtin_memcpy(&v, p, 4);
        p += 4;
        return v;
    }
    uint8_t u8()
    {
        if (p >= end) [[unlikely]]
            return 0;
        return *p++;
    }
    const uint8_t* bytes(uint32_t n)
    {
        if (n > remaining()) [[unlikely]] {
            p = end;
            return end;
        }
        auto* r = p;
        p += n;
        return r;
    }

    // u32 length + UTF-8 bytes → WTF::String.
    WTF::String str()
    {
        uint32_t n = u32();
        if (n > remaining()) [[unlikely]] {
            p = end;
            return WTF::String();
        }
        auto* b = p;
        p += n;
        return WTF::String::fromUTF8(std::span<const char>(reinterpret_cast<const char*>(b), n));
    }
};

// Child-side decode for payload structs. Reader already bounds-checks;
// this reads the head out of the stream and advances past it.
template<typename Head>
Head decode(Reader& r)
{
    static_assert(std::is_trivially_copyable_v<Head>);
    Head h {};
    if (r.remaining() >= sizeof(Head)) {
        __builtin_memcpy(&h, r.bytes(sizeof(Head)), sizeof(Head));
    }
    return h;
}

// Child-side writer. Decl here so WebViewHost's completion callbacks can
// call sendReply; impl in host_main.cpp (owns the CF fd).
class FrameWriter {
public:
    void sendReply(uint32_t viewId, Reply op, const uint8_t* payload = nullptr, uint32_t len = 0);
    void sendReplyStr(uint32_t viewId, Reply op, const WTF::String& s);

    void init(int fd, CFFileDescriptorRef cffd)
    {
        m_fd = fd;
        m_cffd = cffd;
    }
    void onWritable();

private:
    void queueFrom(const uint8_t* a, size_t alen, const uint8_t* b, size_t blen, size_t skip);

    int m_fd = -1;
    CFFileDescriptorRef m_cffd = nullptr;
    WTF::Vector<uint8_t> m_queue;
};

FrameWriter* hostWriter();

} // namespace Bun::WebViewProto
