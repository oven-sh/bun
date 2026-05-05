#pragma once

// WKWebView backend. The actual WKWebView lives in a separate host process
// (thread-0 CFRunLoopRun + AppKit); this side speaks binary IPC over a
// socketpair. See ipc_protocol.h for the wire format.
//
// HostClient is the usockets wire singleton — one socket to the host,
// viewsById routes replies. Promises live in WriteBarrier slots on JSWebView;
// the frame header's viewId + the reply type pick the slot. No Strong<>.

#include "root.h"

#if OS(DARWIN)

#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/JSPromise.h>
#include <wtf/Vector.h>
#include <unordered_map>

struct us_socket_t;

namespace Zig {
class GlobalObject;
}

namespace Bun {

class JSWebView;
enum class ScreenshotFormat : uint8_t;

namespace WebViewProto {
struct Frame;
struct Reader;
enum class Op : uint8_t;
enum class VirtualKey : uint8_t;
}

namespace WK {

// One per process. Lazy-spawned on first WebView construction via
// Bun__WebViewHost__ensure (Zig side, reuses bun.spawn.Process).
struct HostClient {
    us_socket_t* sock = nullptr;
    Zig::GlobalObject* global = nullptr;
    bool dead = false;

    uint32_t nextViewId = 1;
    std::unordered_map<uint32_t, JSC::Weak<JSWebView>> viewsById;

    WTF::Vector<uint8_t> rx;
    WTF::Vector<uint8_t> txQueue;
    bool sockRefd = false;

    bool ensureSpawned(Zig::GlobalObject*, bool stdoutInherit, bool stderrInherit);
    void writeFrame(WebViewProto::Op, uint32_t viewId, const uint8_t* payload, uint32_t len);
    void handleReply(const WebViewProto::Frame&, WebViewProto::Reader);
    void rejectAllAndMarkDead(const WTF::String& reason);
    void updateKeepAlive();
    void onData(const char* data, int length);
    void onWritable();
    void onClose();
};

HostClient& client();

// Per-view ops. Each encodes the typed payload (ipc_protocol.h), stores a
// promise in the right WriteBarrier slot, and writes the frame. Caller has
// already validated args and checked m_closed + slot-empty.
namespace Ops {

JSC::JSPromise* navigate(JSC::JSGlobalObject*, JSWebView*, const WTF::String& url);
JSC::JSPromise* evaluate(JSC::JSGlobalObject*, JSWebView*, const WTF::String& script);
JSC::JSPromise* screenshot(JSC::JSGlobalObject*, JSWebView*, ScreenshotFormat, uint8_t quality);
JSC::JSPromise* click(JSC::JSGlobalObject*, JSWebView*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount);
JSC::JSPromise* clickSelector(JSC::JSGlobalObject*, JSWebView*, const WTF::String& selector, uint32_t timeout, uint8_t button, uint8_t modifiers, uint8_t clickCount);
JSC::JSPromise* mouseDown(JSC::JSGlobalObject*, JSWebView*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask);
JSC::JSPromise* mouseUp(JSC::JSGlobalObject*, JSWebView*, float x, float y, uint8_t button, uint8_t modifiers, uint8_t clickCount, uint8_t buttonsMask);
JSC::JSPromise* mouseMove(JSC::JSGlobalObject*, JSWebView*, float fromX, float fromY, float x, float y, uint32_t steps, uint8_t buttonsMask, uint8_t modifiers);
JSC::JSPromise* type(JSC::JSGlobalObject*, JSWebView*, const WTF::String& text);
JSC::JSPromise* press(JSC::JSGlobalObject*, JSWebView*, WebViewProto::VirtualKey, uint8_t modifiers, const WTF::String& character);
JSC::JSPromise* scroll(JSC::JSGlobalObject*, JSWebView*, double dx, double dy);
JSC::JSPromise* scrollTo(JSC::JSGlobalObject*, JSWebView*, const WTF::String& selector, uint32_t timeout, uint8_t block);
JSC::JSPromise* resize(JSC::JSGlobalObject*, JSWebView*, uint32_t width, uint32_t height);
JSC::JSPromise* goBack(JSC::JSGlobalObject*, JSWebView*);
JSC::JSPromise* goForward(JSC::JSGlobalObject*, JSWebView*);
JSC::JSPromise* reload(JSC::JSGlobalObject*, JSWebView*);
void close(JSWebView*);

} // namespace Ops

} // namespace WK

} // namespace Bun

#endif // OS(DARWIN)
