// WebView host subprocess entry point. Reached via cli.zig when
// BUN_INTERNAL_WEBVIEW_HOST is set. Runs CFRunLoopRun() as the real main
// loop — CF manages ignoreWakeUps correctly when it owns the loop. No
// JSC, no VM, no Zig runtime past the env check.
//
// Parent death → socket read() returns 0 → CFRunLoopStop → process exits.

#include "root.h"

#if OS(DARWIN)

#include "ObjCRuntime.h"
#include "WebViewHost.h"
#include "ipc_protocol.h"

#include <CoreFoundation/CFFileDescriptor.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/uio.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>

#include <unordered_map>
#include <wtf/NeverDestroyed.h>

namespace Bun {
namespace WebViewProto {

// ---------------------------------------------------------------------------
// CF symbols the child needs beyond ObjCRuntime's set. Could be merged
// into ObjCRuntime, but this file is the only consumer and ObjCRuntime is
// already large. dlsym'd at hostMain entry.
// ---------------------------------------------------------------------------
static struct {
    void (*CFRunLoopRun)();
    void (*CFRunLoopStop)(CFRunLoopRef);
    CFRunLoopRef (*CFRunLoopGetCurrent)();
    void (*CFRunLoopAddSource)(CFRunLoopRef, CFRunLoopSourceRef, CFStringRef);
    CFStringRef kCFRunLoopDefaultMode;

    CFFileDescriptorRef (*CFFileDescriptorCreate)(CFAllocatorRef, int, Boolean,
        void (*)(CFFileDescriptorRef, CFOptionFlags, void*), const CFFileDescriptorContext*);
    CFRunLoopSourceRef (*CFFileDescriptorCreateRunLoopSource)(CFAllocatorRef, CFFileDescriptorRef, CFIndex);
    void (*CFFileDescriptorEnableCallBacks)(CFFileDescriptorRef, CFOptionFlags);
} cf;

static bool loadHostCF()
{
    void* h = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);
    if (!h) return false;
#define S(name)                                                     \
    cf.name = reinterpret_cast<decltype(cf.name)>(dlsym(h, #name)); \
    if (!cf.name) return false
    S(CFRunLoopRun);
    S(CFRunLoopStop);
    S(CFRunLoopGetCurrent);
    S(CFRunLoopAddSource);
    S(CFFileDescriptorCreate);
    S(CFFileDescriptorCreateRunLoopSource);
    S(CFFileDescriptorEnableCallBacks);
#undef S
    auto* mode = reinterpret_cast<CFStringRef*>(dlsym(h, "kCFRunLoopDefaultMode"));
    if (!mode) return false;
    cf.kCFRunLoopDefaultMode = *mode;
    return true;
}

// ---------------------------------------------------------------------------
// FrameWriter impl. Frames are small (header + a string or two); socket
// buffer is ~256KB default on Darwin. Direct writev almost always succeeds.
// If it doesn't, queue and enable the CFFileDescriptor write callback.
// ---------------------------------------------------------------------------

void FrameWriter::sendReply(uint32_t viewId, Reply op, const uint8_t* payload, uint32_t len)
{
    Frame h = { len, viewId, static_cast<uint8_t>(op) };
    if (m_queue.isEmpty()) {
        iovec iov[2] = {
            { &h, sizeof(h) },
            { const_cast<uint8_t*>(payload), len },
        };
        ssize_t w = ::writev(m_fd, iov, payload ? 2 : 1);
        size_t total = sizeof(h) + len;
        if (w == static_cast<ssize_t>(total)) return;
        if (w < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK) return; // peer gone; EOF on read handles it
            w = 0;
        }
        queueFrom(reinterpret_cast<uint8_t*>(&h), sizeof(h), payload, len, static_cast<size_t>(w));
    } else {
        queueFrom(reinterpret_cast<uint8_t*>(&h), sizeof(h), payload, len, 0);
    }
    cf.CFFileDescriptorEnableCallBacks(m_cffd, kCFFileDescriptorWriteCallBack);
}

void FrameWriter::sendReplyStr(uint32_t viewId, Reply op, const WTF::String& s)
{
    WTF::CString c = s.utf8();
    uint32_t slen = static_cast<uint32_t>(c.length());
    WTF::Vector<uint8_t, 256> payload;
    payload.grow(4 + slen);
    uint8_t* p = payload.mutableSpan().data();
    memcpy(p, &slen, 4);
    memcpy(p + 4, c.data(), slen);
    sendReply(viewId, op, p, static_cast<uint32_t>(payload.size()));
}

void FrameWriter::onWritable()
{
    while (!m_queue.isEmpty()) {
        ssize_t w = ::write(m_fd, m_queue.span().data(), m_queue.size());
        if (w < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                cf.CFFileDescriptorEnableCallBacks(m_cffd, kCFFileDescriptorWriteCallBack);
            }
            return;
        }
        m_queue.removeAt(0, static_cast<size_t>(w));
    }
}

void FrameWriter::queueFrom(const uint8_t* a, size_t alen, const uint8_t* b, size_t blen, size_t skip)
{
    if (skip < alen) {
        m_queue.append(std::span<const uint8_t>(a + skip, alen - skip));
        skip = 0;
    } else {
        skip -= alen;
    }
    if (blen > skip) m_queue.append(std::span<const uint8_t>(b + skip, blen - skip));
}

// ---------------------------------------------------------------------------
// Host state: all views by id, the socket, the frame writer.
// Single-threaded — everything runs inside CFRunLoop callbacks.
// ---------------------------------------------------------------------------
struct Host {
    int fd = -1;
    CFFileDescriptorRef cffd = nullptr;
    FrameWriter writer;

    std::unordered_map<uint32_t, Ref<WebViewHost>> views;

    // CFFileDescriptor delivers one callback then disarms; read until EAGAIN,
    // then re-enable. Incomplete frame at buffer tail stays until more bytes.
    WTF::Vector<uint8_t> rx;

    void onReadable();
    void dispatch(uint32_t viewId, Op op, Reader payload);

    // Op → failure reply type. Lets "invalid viewId" reject the correct
    // parent-side slot (Navigate → m_pendingNavigate, etc.) instead of
    // always Reply::Error which is misc-only. Everything past Screenshot
    // is a misc op.
    static constexpr Reply failureFor(Op op)
    {
        switch (op) {
        case Op::Navigate:
            return Reply::NavFailed;
        case Op::Evaluate:
            return Reply::EvalFailed;
        case Op::Screenshot:
            return Reply::ScreenshotFailed;
        default:
            return Reply::Error;
        }
    }

    WebViewHost* view(uint32_t viewId, Op op)
    {
        auto it = views.find(viewId);
        if (it == views.end()) {
            writer.sendReplyStr(viewId, failureFor(op), "invalid viewId"_s);
            return nullptr;
        }
        return it->second.ptr();
    }
};

// Lazy construct — a file-scope `static Host g_host;` would run
// unordered_map/Vector constructors at image-load in the PARENT process
// (same binary, the code is linked in even though only the child calls
// hostMain). LazyNeverDestroyed defers to first .construct(), which is
// in hostMain() on the child's thread 0.
static LazyNeverDestroyed<Host> g_host;
FrameWriter* hostWriter() { return &g_host->writer; }

void Host::onReadable()
{
    // Pull everything the kernel has, then parse whole frames.
    for (;;) {
        size_t was = rx.size();
        rx.grow(was + 4096);
        ssize_t n = ::read(fd, rx.mutableSpan().data() + was, 4096);
        if (n > 0) {
            rx.shrink(was + static_cast<size_t>(n));
            continue;
        }
        rx.shrink(was);
        if (n == 0) {
            // Parent died. Closing all views lets WKWebView dealloc cleanly
            // (WebContent children get XPC cancel) before we go.
            views.clear();
            cf.CFRunLoopStop(cf.CFRunLoopGetCurrent());
            return;
        }
        // n < 0
        if (errno == EINTR) continue;
        break; // EAGAIN — drained
    }

    size_t off = 0;
    const uint8_t* base = rx.span().data();
    while (rx.size() - off >= sizeof(Frame)) {
        Frame h;
        memcpy(&h, base + off, sizeof(h));
        if (h.len > kMaxFrameLen) [[unlikely]] {
            // Parent memory corruption. Bail out cleanly — parent will see
            // socket EOF, reject its promises, and EVFILT_PROC reports us.
            views.clear();
            cf.CFRunLoopStop(cf.CFRunLoopGetCurrent());
            return;
        }
        if (rx.size() - off < sizeof(Frame) + h.len) break; // partial payload
        Reader r { base + off + sizeof(Frame), base + off + sizeof(Frame) + h.len };
        dispatch(h.viewId, static_cast<Op>(h.op), r);
        off += sizeof(Frame) + h.len;
    }
    if (off) rx.removeAt(0, off);

    cf.CFFileDescriptorEnableCallBacks(cffd, kCFFileDescriptorReadCallBack);
}

void Host::dispatch(uint32_t viewId, Op op, Reader r)
{
    ObjCRuntime::ARPool pool;
    switch (op) {
    case Op::Create: {
        auto p = decode<CreatePayload>(r);
        WTF::String persistDir;
        if (static_cast<DataStoreKind>(p.dataStoreKind) == DataStoreKind::Persistent)
            persistDir = r.str();
        views.emplace(viewId, WebViewHost::createForIPC(viewId, p.width, p.height, persistDir));
        // No Ack for Create — parent doesn't await it (fire-and-forget).
        return;
    }
    case Op::Navigate:
        if (auto* v = view(viewId, op)) v->navigateIPC(r.str());
        return;
    case Op::Evaluate:
        if (auto* v = view(viewId, op)) v->evaluateIPC(r.str());
        return;
    case Op::Screenshot: {
        // Two bytes: format (0=png 1=jpeg 2=webp), quality (0-100).
        // Older parents sent an empty payload — default to png.
        uint8_t fmt = r.remaining() >= 1 ? r.u8() : 0;
        uint8_t q = r.remaining() >= 1 ? r.u8() : 80;
        if (auto* v = view(viewId, op)) v->screenshotIPC(fmt, q);
        return;
    }
    case Op::Close:
        views.erase(viewId);
        writer.sendReply(viewId, Reply::Ack);
        return;
    case Op::Resize: {
        auto p = decode<ResizePayload>(r);
        if (auto* v = view(viewId, op)) {
            v->resize(p.width, p.height);
            writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::GoBack:
        if (auto* v = view(viewId, op)) {
            v->goBack();
            writer.sendReply(viewId, Reply::Ack);
        }
        return;
    case Op::GoForward:
        if (auto* v = view(viewId, op)) {
            v->goForward();
            writer.sendReply(viewId, Reply::Ack);
        }
        return;
    case Op::Reload:
        if (auto* v = view(viewId, op)) {
            v->reload();
            writer.sendReply(viewId, Reply::Ack);
        }
        return;
    // Input ops: return true = async (completion block Acks), false = sync.
    case Op::Click: {
        auto p = decode<ClickPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->clickIPC(p.x, p.y, p.button, p.modifiers, p.clickCount)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::Type:
        if (auto* v = view(viewId, op)) {
            if (!v->typeIPC(r.str())) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    case Op::Press: {
        auto p = decode<PressPayload>(r);
        auto vk = static_cast<VirtualKey>(p.virtualKey);
        WTF::String ch = (vk == VirtualKey::Character) ? r.str() : WTF::String();
        if (auto* v = view(viewId, op)) {
            if (!v->pressIPC(vk, p.modifiers, ch)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::Scroll: {
        auto p = decode<ScrollPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->scrollIPC(p.deltaX, p.deltaY)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::ClickSelector: {
        auto p = decode<ClickSelectorPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->clickSelectorIPC(r.str(), p.timeout, p.button, p.modifiers, p.clickCount)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::ScrollTo: {
        auto p = decode<ScrollToPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->scrollToIPC(r.str(), p.timeout, p.block)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::MouseDown: {
        auto p = decode<MouseDownPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->mouseDownIPC(p.x, p.y, p.button, p.modifiers, p.clickCount, p.buttonsMask)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::MouseUp: {
        auto p = decode<MouseUpPayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->mouseUpIPC(p.x, p.y, p.button, p.modifiers, p.clickCount, p.buttonsMask)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    case Op::MouseMove: {
        auto p = decode<MouseMovePayload>(r);
        if (auto* v = view(viewId, op)) {
            if (!v->mouseMoveIPC(p.fromX, p.fromY, p.x, p.y, p.steps, p.buttonsMask, p.modifiers)) writer.sendReply(viewId, Reply::Ack);
        }
        return;
    }
    }
    writer.sendReplyStr(viewId, Reply::Error, "unknown op"_s);
}

static void cfCallback(CFFileDescriptorRef, CFOptionFlags flags, void*)
{
    if (flags & kCFFileDescriptorReadCallBack) g_host->onReadable();
    if (flags & kCFFileDescriptorWriteCallBack) g_host->writer.onWritable();
}

} // namespace WebViewProto
} // namespace Bun

// ---------------------------------------------------------------------------
// Entry. cli.zig calls this before anything else when BUN_INTERNAL_WEBVIEW_HOST
// is set. Never returns.
// ---------------------------------------------------------------------------
extern "C" [[noreturn]] void Bun__WebView__hostMain(int fd)
{
    using namespace Bun;
    using namespace Bun::WebViewProto;

    // dup2 preserved the parent-side flags on the parent end, not ours.
    // Set nonblocking here; the CFFileDescriptor callback reads to EAGAIN.
    int fl = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, fl | O_NONBLOCK);

    if (!loadHostCF()) {
        fprintf(stderr, "webview-host: CoreFoundation dlopen failed\n");
        _exit(70); // EX_SOFTWARE
    }
    // ObjCRuntime loads AppKit + WebKit + objc. sharedApplication with
    // ActivationPolicyAccessory so no dock tile for the host.
    auto* rt = ObjCRuntime::tryLoad();
    if (!rt->m_loaded) {
        fprintf(stderr, "webview-host: %s\n", rt->m_loadError.utf8().data());
        _exit(70);
    }

    // App Nap suppresses the host process on CI — no user interaction, no
    // visible window, ActivationPolicyAccessory. The CVDisplayLink callback
    // fires but the main run loop is throttled; the IPC send to WebContent
    // doesn't reach it, rAF never fires. WebKitTestRunner disables it
    // (main.mm:59). WebContent-side App Nap is handled separately via
    // WKPreferences._pageVisibilityBasedProcessSuppressionEnabled = NO.
    {
        ObjCRuntime::ARPool pool;
        objc::NSProcessInfo::disableAppNap();
    }

    g_host.construct();
    g_host->fd = fd;
    g_host->cffd = cf.CFFileDescriptorCreate(nullptr, fd, /*closeOnInvalidate*/ true, cfCallback, nullptr);
    g_host->writer.init(fd, g_host->cffd);

    CFRunLoopSourceRef src = cf.CFFileDescriptorCreateRunLoopSource(nullptr, g_host->cffd, 0);
    cf.CFRunLoopAddSource(cf.CFRunLoopGetCurrent(), src, cf.kCFRunLoopDefaultMode);
    cf.CFFileDescriptorEnableCallBacks(g_host->cffd, kCFFileDescriptorReadCallBack);

    cf.CFRunLoopRun();
    // Reached on socket EOF (parent died) or explicit stop. Views are
    // already cleared in onReadable's EOF path.
    _exit(0);
}

#endif // OS(DARWIN)
