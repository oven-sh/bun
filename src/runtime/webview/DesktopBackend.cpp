#include "root.h"
#include "DesktopBackend.h"
#include "WebKitBackend.h"

#if OS(DARWIN)

#include "ipc_protocol.h"
#include "ZigGlobalObject.h"
#include <wtf/Vector.h>
#include <unordered_set>
#include <dlfcn.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <CoreGraphics/CGGeometry.h>

extern "C" {
void Bun__Desktop__onNavDone(Zig::GlobalObject* g, uint32_t windowId, bool ok, const uint8_t* errPtr, uint32_t errLen);
void Bun__Desktop__onIpcMessage(Zig::GlobalObject* g, uint32_t windowId, uint32_t reqId, bool isInvoke, const uint8_t* chPtr, uint32_t chLen, const uint8_t* argsPtr, uint32_t argsLen);
void Bun__Desktop__onIpcBinaryMessage(Zig::GlobalObject* g, uint32_t windowId, uint32_t reqId, const uint8_t* chPtr, uint32_t chLen, const uint8_t* dataPtr, uint32_t dataLen);
void Bun__Desktop__onWindowClosed(Zig::GlobalObject* g, uint32_t windowId);
void Bun__Desktop__onHostDied();
void Bun__Desktop__onSchemeRequest(Zig::GlobalObject* g, uint32_t windowId, uint32_t taskId, const uint8_t* urlPtr, uint32_t urlLen, const uint8_t* methodPtr, uint32_t methodLen, const uint8_t* rangePtr, uint32_t rangeLen, const uint8_t* headersPtr, uint32_t headersLen, const uint8_t* bodyPtr, uint32_t bodyLen);
void Bun__Desktop__onDialogResult(Zig::GlobalObject* g, uint32_t reqId, const uint8_t* resPtr, uint32_t resLen);
void Bun__Desktop__onEvalResult(Zig::GlobalObject* g, uint32_t reqId, bool ok, const uint8_t* resPtr, uint32_t resLen);
}

namespace Bun {
namespace DesktopBackend {

using namespace WebViewProto;

static std::unordered_set<uint32_t>& activeWindows()
{
    static std::unordered_set<uint32_t> set;
    return set;
}

static inline void appendStr(WTF::Vector<uint8_t, 256>& buf, const char* ptr, uint32_t len)
{
    size_t off = buf.size();
    buf.grow(off + 4 + len);
    memcpy(buf.mutableSpan().data() + off, &len, 4);
    if (len > 0 && ptr) {
        memcpy(buf.mutableSpan().data() + off + 4, ptr, len);
    }
}

bool hasActiveWindows()
{
    return !activeWindows().empty();
}

void onHostDied()
{
    activeWindows().clear();
    Bun__Desktop__onHostDied();
}

bool handleReply(Zig::GlobalObject* global, const Frame& h, Reader r)
{
    if (h.op != static_cast<uint8_t>(Reply::DesktopDialogResult) && !activeWindows().contains(h.viewId)) {
        return false;
    }

    auto reply = static_cast<Reply>(h.op);
    switch (reply) {
    case Reply::NavDone:
        Bun__Desktop__onNavDone(global, h.viewId, true, nullptr, 0);
        return true;

    case Reply::NavFailed: {
        WTF::CString err = r.str().utf8();
        Bun__Desktop__onNavDone(global, h.viewId, false, reinterpret_cast<const uint8_t*>(err.data()), static_cast<uint32_t>(err.length()));
        return true;
    }

    case Reply::DesktopIpc: {
        uint32_t reqId = r.u32();
        bool isInvoke = r.u8() != 0;
        uint32_t chLen = r.u32();
        const uint8_t* chPtr = r.bytes(chLen);
        uint32_t argsLen = r.u32();
        const uint8_t* argsPtr = r.bytes(argsLen);
        Bun__Desktop__onIpcMessage(global, h.viewId, reqId, isInvoke, chPtr, chLen, argsPtr, argsLen);
        return true;
    }

    case Reply::DesktopIpcBinary: {
        uint32_t reqId = r.u32();
        uint32_t chLen = r.u32();
        const uint8_t* chPtr = r.bytes(chLen);
        uint32_t dataLen = r.u32();
        const uint8_t* dataPtr = r.bytes(dataLen);
        Bun__Desktop__onIpcBinaryMessage(global, h.viewId, reqId, chPtr, chLen, dataPtr, dataLen);
        return true;
    }

    case Reply::DesktopWindowClosed:
        activeWindows().erase(h.viewId);
        WK::client().updateKeepAlive();
        Bun__Desktop__onWindowClosed(global, h.viewId);
        return true;

    case Reply::DesktopSchemeRequest: {
        uint32_t taskId = r.u32();
        uint32_t urlLen = r.u32();
        const uint8_t* urlPtr = r.bytes(urlLen);
        uint32_t methodLen = r.u32();
        const uint8_t* methodPtr = r.bytes(methodLen);
        uint32_t rangeLen = r.u32();
        const uint8_t* rangePtr = r.bytes(rangeLen);
        uint32_t headersLen = r.remaining() >= 4 ? r.u32() : 0;
        const uint8_t* headersPtr = headersLen ? r.bytes(headersLen) : nullptr;
        uint32_t bodyLen = r.remaining() >= 4 ? r.u32() : 0;
        const uint8_t* bodyPtr = bodyLen ? r.bytes(bodyLen) : nullptr;
        Bun__Desktop__onSchemeRequest(global, h.viewId, taskId, urlPtr, urlLen, methodPtr, methodLen, rangePtr, rangeLen, headersPtr, headersLen, bodyPtr, bodyLen);
        return true;
    }

    case Reply::DesktopDialogResult: {
        uint32_t reqId = r.u32();
        uint32_t resLen = r.u32();
        const uint8_t* resPtr = r.bytes(resLen);
        Bun__Desktop__onDialogResult(global, reqId, resPtr, resLen);
        return true;
    }

    case Reply::DesktopEvalResult: {
        uint32_t reqId = r.u32();
        bool ok = r.remaining() >= 1 ? (r.u8() != 0) : false;
        uint32_t resLen = r.remaining() >= 4 ? r.u32() : 0;
        const uint8_t* resPtr = resLen ? r.bytes(resLen) : nullptr;
        Bun__Desktop__onEvalResult(global, reqId, ok, resPtr, resLen);
        return true;
    }

    case Reply::NavEvent:
    case Reply::NavFailEvent:
    case Reply::ConsoleEvent:
    case Reply::Ack:
    case Reply::Error:
        return true;

    default:
        return true;
    }
}

} // namespace DesktopBackend
} // namespace Bun

static WTF::Vector<WTF::String>& pendingCustomSchemes()
{
    static LazyNeverDestroyed<WTF::Vector<WTF::String>> list;
    static std::once_flag once;
    std::call_once(once, [] { list.construct(); });
    return list.get();
}

static void flushPendingCustomSchemes()
{
    auto& client = Bun::WK::client();
    for (const auto& s : pendingCustomSchemes()) {
        WTF::Vector<uint8_t, 256> buf;
        WTF::CString utf8 = s.utf8();
        Bun::DesktopBackend::appendStr(buf, reinterpret_cast<const char*>(utf8.data()), static_cast<uint32_t>(utf8.length()));
        client.writeFrame(Bun::WebViewProto::Op::DesktopRegisterScheme, 0, buf.span().data(), static_cast<uint32_t>(buf.size()));
    }
}

extern "C" void Bun__Desktop__warm(Zig::GlobalObject* g)
{
    auto& client = Bun::WK::client();
    if (!client.ensureSpawned(g, false, false)) {
        return;
    }
    flushPendingCustomSchemes();
    client.writeFrame(Bun::WebViewProto::Op::DesktopWarm, 0, nullptr, 0);
}

extern "C" void Bun__Desktop__registerScheme(const char* ptr, uint32_t len)
{
    if (!ptr || len == 0) return;
    WTF::String scheme = WTF::String::fromUTF8(std::span<const char>(ptr, len)).convertToASCIILowercase();
    if (scheme.isEmpty() || scheme == "app"_s || scheme == "http"_s || scheme == "https"_s || scheme == "file"_s) return;
    auto& list = pendingCustomSchemes();
    for (const auto& existing : list) {
        if (existing == scheme) return;
    }
    list.append(scheme);
    auto& client = Bun::WK::client();
    if (!client.dead && (client.inProcess || client.sock)) {
        WTF::Vector<uint8_t, 256> buf;
        Bun::DesktopBackend::appendStr(buf, ptr, len);
        client.writeFrame(Bun::WebViewProto::Op::DesktopRegisterScheme, 0, buf.span().data(), static_cast<uint32_t>(buf.size()));
    }
}

extern "C" void Bun__Desktop__evaluateJS(uint32_t id, uint32_t reqId, const char* scriptPtr, uint32_t scriptLen)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(4);
    memcpy(buf.mutableSpan().data(), &reqId, 4);
    Bun::DesktopBackend::appendStr(buf, scriptPtr, scriptLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopEval, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" uint32_t Bun__Desktop__createWindow(
    Zig::GlobalObject* g,
    int32_t width,
    int32_t height,
    int32_t x,
    int32_t y,
    uint8_t flags,
    const char* titlePtr,
    uint32_t titleLen,
    const char* preloadPtr,
    uint32_t preloadLen)
{
    auto& client = Bun::WK::client();
    if (!client.ensureSpawned(g, false, false)) {
        return 0;
    }
    flushPendingCustomSchemes();

    uint32_t id = client.nextViewId++;
    Bun::DesktopBackend::activeWindows().insert(id);
    client.updateKeepAlive();

    Bun::WebViewProto::CreateDesktopWindowPayload p;
    p.width = static_cast<uint32_t>(width > 0 ? width : 800);
    p.height = static_cast<uint32_t>(height > 0 ? height : 600);
    p.x = x;
    p.y = y;
    p.flags = flags;

    WTF::Vector<uint8_t, 256> buf;
    buf.grow(sizeof(p));
    memcpy(buf.mutableSpan().data(), &p, sizeof(p));
    Bun::DesktopBackend::appendStr(buf, titlePtr, titleLen);
    Bun::DesktopBackend::appendStr(buf, preloadPtr, preloadLen);

    client.writeFrame(Bun::WebViewProto::Op::CreateDesktopWindow, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
    return id;
}

extern "C" void Bun__Desktop__navigate(uint32_t id, const char* urlPtr, uint32_t urlLen)
{
    WTF::Vector<uint8_t, 256> buf;
    Bun::DesktopBackend::appendStr(buf, urlPtr, urlLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::Navigate, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__close(uint32_t id)
{
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::Close, id, nullptr, 0);
    Bun::DesktopBackend::activeWindows().erase(id);
    Bun::WK::client().updateKeepAlive();
}

extern "C" void Bun__Desktop__setTitle(uint32_t id, const char* titlePtr, uint32_t titleLen)
{
    WTF::Vector<uint8_t, 256> buf;
    Bun::DesktopBackend::appendStr(buf, titlePtr, titleLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::SetWindowTitle, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__showWindow(uint32_t id, bool visible)
{
    uint8_t v = visible ? 1 : 0;
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::ShowWindow, id, &v, 1);
}

extern "C" void Bun__Desktop__setSize(uint32_t id, uint32_t width, uint32_t height)
{
    Bun::WebViewProto::ResizePayload p { width, height };
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::Resize, id, reinterpret_cast<const uint8_t*>(&p), sizeof(p));
}

extern "C" void Bun__Desktop__sendIpcReply(uint32_t id, uint32_t reqId, bool ok, const char* jsonPtr, uint32_t jsonLen)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(5);
    memcpy(buf.mutableSpan().data(), &reqId, 4);
    buf[4] = ok ? 1 : 0;
    Bun::DesktopBackend::appendStr(buf, jsonPtr, jsonLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopIpcReply, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__sendIpcBinaryReply(uint32_t id, uint32_t reqId, uint16_t status, const uint8_t* dataPtr, uint32_t dataLen)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(6);
    memcpy(buf.mutableSpan().data(), &reqId, 4);
    buf[4] = static_cast<uint8_t>(status & 0xFF);
    buf[5] = static_cast<uint8_t>((status >> 8) & 0xFF);
    Bun::DesktopBackend::appendStr(buf, reinterpret_cast<const char*>(dataPtr), dataLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopIpcBinaryReply, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__dispatchToRenderer(uint32_t id, const char* chPtr, uint32_t chLen, const char* argsPtr, uint32_t argsLen)
{
    WTF::Vector<uint8_t, 256> buf;
    Bun::DesktopBackend::appendStr(buf, chPtr, chLen);
    Bun::DesktopBackend::appendStr(buf, argsPtr, argsLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopDispatch, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__sendSchemeResponseBytes(
    uint32_t id,
    uint32_t taskId,
    uint16_t status,
    const char* headersPtr,
    uint32_t headersLen,
    const uint8_t* bodyPtr,
    uint32_t bodyLen)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(7);
    memcpy(buf.mutableSpan().data(), &taskId, 4);
    buf[4] = static_cast<uint8_t>(status & 0xFF);
    buf[5] = static_cast<uint8_t>((status >> 8) & 0xFF);
    buf[6] = 0; // Bytes
    Bun::DesktopBackend::appendStr(buf, headersPtr, headersLen);
    Bun::DesktopBackend::appendStr(buf, reinterpret_cast<const char*>(bodyPtr), bodyLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopSchemeResponse, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__sendSchemeResponseFile(
    uint32_t id,
    uint32_t taskId,
    uint16_t status,
    const char* headersPtr,
    uint32_t headersLen,
    const char* pathPtr,
    uint32_t pathLen,
    uint64_t offset,
    uint64_t length)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(7);
    memcpy(buf.mutableSpan().data(), &taskId, 4);
    buf[4] = static_cast<uint8_t>(status & 0xFF);
    buf[5] = static_cast<uint8_t>((status >> 8) & 0xFF);
    buf[6] = 1; // File
    Bun::DesktopBackend::appendStr(buf, headersPtr, headersLen);
    Bun::DesktopBackend::appendStr(buf, pathPtr, pathLen);
    size_t off = buf.size();
    buf.grow(off + 16);
    memcpy(buf.mutableSpan().data() + off, &offset, 8);
    memcpy(buf.mutableSpan().data() + off + 8, &length, 8);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopSchemeResponse, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__sendSchemeResponseError(uint32_t id, uint32_t taskId, uint16_t status)
{
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(7);
    memcpy(buf.mutableSpan().data(), &taskId, 4);
    buf[4] = static_cast<uint8_t>(status & 0xFF);
    buf[5] = static_cast<uint8_t>((status >> 8) & 0xFF);
    buf[6] = 2; // Error
    Bun::DesktopBackend::appendStr(buf, "{}", 2);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopSchemeResponse, id, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__windowAction(uint32_t id, uint8_t action)
{
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopWindowAction, id, &action, 1);
}

namespace {
struct AppKitRuntime {
    using GetClassFn = Class (*)(const char*);
    using SelRegFn = SEL (*)(const char*);
    GetClassFn getClass = nullptr;
    SelRegFn selReg = nullptr;
    void* msgSend = nullptr;
    void* msgSendStret = nullptr;
    bool ready = false;

    static AppKitRuntime& get()
    {
        static AppKitRuntime rt = []() {
            AppKitRuntime r;
            dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", RTLD_LAZY | RTLD_LOCAL);
            r.getClass = reinterpret_cast<GetClassFn>(dlsym(RTLD_DEFAULT, "objc_getClass"));
            r.selReg = reinterpret_cast<SelRegFn>(dlsym(RTLD_DEFAULT, "sel_registerName"));
            r.msgSend = dlsym(RTLD_DEFAULT, "objc_msgSend");
#if CPU(X86_64)
            r.msgSendStret = dlsym(RTLD_DEFAULT, "objc_msgSend_stret");
#endif
            r.ready = r.getClass && r.selReg && r.msgSend;
            return r;
        }();
        return rt;
    }

    template<typename R, typename... Args>
    R call(id target, const char* selName, Args... args) const
    {
        auto fn = reinterpret_cast<R (*)(id, SEL, Args...)>(msgSend);
        return fn(target, selReg(selName), args...);
    }

    id nsString(const char* ptr, uint32_t len) const
    {
        Class cls = getClass("NSString");
        id alloc = call<id>(reinterpret_cast<id>(cls), "alloc");
        // NSUTF8StringEncoding = 4
        return call<id>(alloc, "initWithBytes:length:encoding:", ptr, static_cast<unsigned long>(len), 4UL);
    }
};
} // namespace

extern "C" bool Bun__Desktop__clipboardWriteText(const char* ptr, uint32_t len)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready) return false;
    Class pbCls = rt.getClass("NSPasteboard");
    if (!pbCls) return false;
    id pb = rt.call<id>(reinterpret_cast<id>(pbCls), "generalPasteboard");
    if (!pb) return false;
    rt.call<long>(pb, "clearContents");
    id str = rt.nsString(ptr ? ptr : "", len);
    id typeStr = rt.nsString("public.utf8-plain-text", 22);
    bool ok = rt.call<bool>(pb, "setString:forType:", str, typeStr);
    rt.call<void>(str, "release");
    rt.call<void>(typeStr, "release");
    return ok;
}

extern "C" uint32_t Bun__Desktop__clipboardReadText(char* outBuf, uint32_t outCap)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !outBuf || outCap == 0) return 0;
    Class pbCls = rt.getClass("NSPasteboard");
    if (!pbCls) return 0;
    id pb = rt.call<id>(reinterpret_cast<id>(pbCls), "generalPasteboard");
    if (!pb) return 0;
    id typeStr = rt.nsString("public.utf8-plain-text", 22);
    id str = rt.call<id>(pb, "stringForType:", typeStr);
    rt.call<void>(typeStr, "release");
    if (!str) return 0;
    const char* utf8 = rt.call<const char*>(str, "UTF8String");
    if (!utf8) return 0;
    size_t n = strlen(utf8);
    if (n > outCap) n = outCap;
    memcpy(outBuf, utf8, n);
    return static_cast<uint32_t>(n);
}

extern "C" bool Bun__Desktop__isDarkMode()
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready) return false;
    Class udCls = rt.getClass("NSUserDefaults");
    if (!udCls) return false;
    id ud = rt.call<id>(reinterpret_cast<id>(udCls), "standardUserDefaults");
    if (!ud) return false;
    id key = rt.nsString("AppleInterfaceStyle", 19);
    id val = rt.call<id>(ud, "stringForKey:", key);
    rt.call<void>(key, "release");
    if (!val) return false;
    const char* utf8 = rt.call<const char*>(val, "UTF8String");
    return utf8 && strcmp(utf8, "Dark") == 0;
}

extern "C" bool Bun__Desktop__getPrimaryDisplay(double* outValues)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !outValues) return false;
    Class scrCls = rt.getClass("NSScreen");
    if (!scrCls) return false;
    id scr = rt.call<id>(reinterpret_cast<id>(scrCls), "mainScreen");
    if (!scr) return false;
#if CPU(ARM64)
    CGRect frame = rt.call<CGRect>(scr, "frame");
    CGRect visible = rt.call<CGRect>(scr, "visibleFrame");
#elif CPU(X86_64)
    auto fnStret = reinterpret_cast<void (*)(CGRect*, id, SEL)>(rt.msgSendStret);
    CGRect frame = {};
    CGRect visible = {};
    fnStret(&frame, scr, rt.selReg("frame"));
    fnStret(&visible, scr, rt.selReg("visibleFrame"));
#else
    CGRect frame = { { 0, 0 }, { 1440, 900 } };
    CGRect visible = { { 0, 0 }, { 1440, 875 } };
#endif
    double scale = rt.call<double>(scr, "backingScaleFactor");
    outValues[0] = frame.origin.x;
    outValues[1] = frame.origin.y;
    outValues[2] = frame.size.width;
    outValues[3] = frame.size.height;
    outValues[4] = visible.origin.x;
    outValues[5] = visible.origin.y;
    outValues[6] = visible.size.width;
    outValues[7] = visible.size.height;
    outValues[8] = scale > 0 ? scale : 1.0;
    return true;
}

extern "C" void Bun__Desktop__setWindowProgress(uint32_t id, double progress)
{
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopWindowProgress, id, reinterpret_cast<const uint8_t*>(&progress), sizeof(progress));
}

extern "C" void Bun__Desktop__setMenu(const char* jsonPtr, uint32_t jsonLen)
{
    WTF::Vector<uint8_t, 256> buf;
    Bun::DesktopBackend::appendStr(buf, jsonPtr, jsonLen);
    Bun::WK::client().writeFrame(Bun::WebViewProto::Op::DesktopSetMenu, 0, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

extern "C" void Bun__Desktop__showDialog(Zig::GlobalObject* g, uint32_t windowId, uint32_t reqId, uint8_t kind, const char* optsPtr, uint32_t optsLen)
{
    auto& client = Bun::WK::client();
    if (!client.ensureSpawned(g, false, false)) {
        return;
    }
    WTF::Vector<uint8_t, 256> buf;
    buf.grow(5);
    memcpy(buf.mutableSpan().data(), &reqId, 4);
    buf[4] = kind;
    Bun::DesktopBackend::appendStr(buf, optsPtr, optsLen);
    client.writeFrame(Bun::WebViewProto::Op::DesktopDialog, windowId, buf.span().data(), static_cast<uint32_t>(buf.size()));
}

namespace {
struct IOKitPowerState {
    using CreateFn = int (*)(CFStringRef, uint32_t, CFStringRef, uint32_t*);
    using ReleaseFn = int (*)(uint32_t);
    CreateFn createAssertion = nullptr;
    ReleaseFn releaseAssertion = nullptr;
    std::unordered_set<uint32_t> activeIds;

    static IOKitPowerState& get()
    {
        static IOKitPowerState s = []() {
            IOKitPowerState p;
            dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_LAZY | RTLD_LOCAL);
            p.createAssertion = reinterpret_cast<CreateFn>(dlsym(RTLD_DEFAULT, "IOPMAssertionCreateWithName"));
            p.releaseAssertion = reinterpret_cast<ReleaseFn>(dlsym(RTLD_DEFAULT, "IOPMAssertionRelease"));
            return p;
        }();
        return s;
    }
};
} // namespace

extern "C" uint32_t Bun__Desktop__powerSaveStart(uint8_t kind)
{
    auto& ps = IOKitPowerState::get();
    auto& rt = AppKitRuntime::get();
    if (!ps.createAssertion || !rt.ready) return 0;
    const char* rawType = kind == 1 ? "PreventUserIdleDisplaySleep" : "PreventUserIdleSystemSleep";
    id typeStr = rt.nsString(rawType, static_cast<uint32_t>(strlen(rawType)));
    id reasonStr = rt.nsString("Bun Desktop powerSaveBlocker", 28);
    uint32_t assertionId = 0;
    // kIOPMAssertionLevelOn = 255
    int rc = ps.createAssertion(reinterpret_cast<CFStringRef>(typeStr), 255, reinterpret_cast<CFStringRef>(reasonStr), &assertionId);
    rt.call<void>(typeStr, "release");
    rt.call<void>(reasonStr, "release");
    if (rc != 0 || assertionId == 0) return 0;
    ps.activeIds.insert(assertionId);
    return assertionId;
}

extern "C" bool Bun__Desktop__powerSaveStop(uint32_t id)
{
    auto& ps = IOKitPowerState::get();
    if (!ps.releaseAssertion || !ps.activeIds.erase(id)) return false;
    return ps.releaseAssertion(id) == 0;
}

extern "C" bool Bun__Desktop__powerSaveIsStarted(uint32_t id)
{
    return IOKitPowerState::get().activeIds.contains(id);
}

extern "C" bool Bun__Desktop__imageSizeFromPath(const char* pathPtr, uint32_t pathLen, double* outWH)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !pathPtr || pathLen == 0 || !outWH) return false;
    Class imgCls = rt.getClass("NSImage");
    if (!imgCls) return false;
    id pathStr = rt.nsString(pathPtr, pathLen);
    id alloc = rt.call<id>(reinterpret_cast<id>(imgCls), "alloc");
    id img = rt.call<id>(alloc, "initWithContentsOfFile:", pathStr);
    rt.call<void>(pathStr, "release");
    if (!img) return false;
#if CPU(ARM64)
    CGSize sz = rt.call<CGSize>(img, "size");
#elif CPU(X86_64)
    auto fnStret = reinterpret_cast<void (*)(CGSize*, id, SEL)>(rt.msgSendStret);
    CGSize sz = {};
    fnStret(&sz, img, rt.selReg("size"));
#else
    CGSize sz = { 0, 0 };
#endif
    rt.call<void>(img, "release");
    outWH[0] = sz.width;
    outWH[1] = sz.height;
    return sz.width > 0 && sz.height > 0;
}

extern "C" bool Bun__Desktop__openExternal(const char* urlPtr, uint32_t urlLen)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !urlPtr || urlLen == 0) return false;
    Class wsCls = rt.getClass("NSWorkspace");
    Class urlCls = rt.getClass("NSURL");
    if (!wsCls || !urlCls) return false;
    id ws = rt.call<id>(reinterpret_cast<id>(wsCls), "sharedWorkspace");
    id urlStr = rt.nsString(urlPtr, urlLen);
    id nsUrl = rt.call<id>(reinterpret_cast<id>(urlCls), "URLWithString:", urlStr);
    rt.call<void>(urlStr, "release");
    if (!ws || !nsUrl) return false;
    return rt.call<bool>(ws, "openURL:", nsUrl);
}

extern "C" bool Bun__Desktop__showItemInFolder(const char* pathPtr, uint32_t pathLen)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !pathPtr || pathLen == 0) return false;
    Class wsCls = rt.getClass("NSWorkspace");
    Class urlCls = rt.getClass("NSURL");
    Class arrCls = rt.getClass("NSArray");
    if (!wsCls || !urlCls || !arrCls) return false;
    id ws = rt.call<id>(reinterpret_cast<id>(wsCls), "sharedWorkspace");
    id pathStr = rt.nsString(pathPtr, pathLen);
    id fileUrl = rt.call<id>(reinterpret_cast<id>(urlCls), "fileURLWithPath:", pathStr);
    rt.call<void>(pathStr, "release");
    if (!ws || !fileUrl) return false;
    id arr = rt.call<id>(reinterpret_cast<id>(arrCls), "arrayWithObject:", fileUrl);
    rt.call<void>(ws, "activateFileViewerSelectingURLs:", arr);
    return true;
}

extern "C" bool Bun__Desktop__trashItem(const char* pathPtr, uint32_t pathLen)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready || !pathPtr || pathLen == 0) return false;
    Class fmCls = rt.getClass("NSFileManager");
    Class urlCls = rt.getClass("NSURL");
    if (!fmCls || !urlCls) return false;
    id fm = rt.call<id>(reinterpret_cast<id>(fmCls), "defaultManager");
    id pathStr = rt.nsString(pathPtr, pathLen);
    id fileUrl = rt.call<id>(reinterpret_cast<id>(urlCls), "fileURLWithPath:", pathStr);
    rt.call<void>(pathStr, "release");
    if (!fm || !fileUrl) return false;
    id resulting = nullptr;
    id err = nullptr;
    return rt.call<bool>(fm, "trashItemAtURL:resultingItemURL:error:", fileUrl, &resulting, &err);
}

extern "C" bool Bun__Desktop__showNotification(const char* titlePtr, uint32_t titleLen, const char* bodyPtr, uint32_t bodyLen)
{
    auto& rt = AppKitRuntime::get();
    if (!rt.ready) return false;
    Class notifCls = rt.getClass("NSUserNotification");
    Class centerCls = rt.getClass("NSUserNotificationCenter");
    if (!notifCls || !centerCls) return false;
    id center = rt.call<id>(reinterpret_cast<id>(centerCls), "defaultUserNotificationCenter");
    if (!center) return false;
    id notif = rt.call<id>(rt.call<id>(reinterpret_cast<id>(notifCls), "alloc"), "init");
    if (!notif) return false;
    id tStr = rt.nsString(titlePtr ? titlePtr : "", titleLen);
    id bStr = rt.nsString(bodyPtr ? bodyPtr : "", bodyLen);
    rt.call<void>(notif, "setTitle:", tStr);
    rt.call<void>(notif, "setInformativeText:", bStr);
    rt.call<void>(center, "deliverNotification:", notif);
    rt.call<void>(tStr, "release");
    rt.call<void>(bStr, "release");
    rt.call<void>(notif, "release");
    return true;
}

#endif // OS(DARWIN)
