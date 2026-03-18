#pragma once

#include "root.h"

#if OS(DARWIN)

// Include SDK headers for types only — all calls go through dlsym'd pointers.
// This keeps `otool -L bun` at its current 4 dylibs.
#include <objc/runtime.h>
#include <objc/message.h>
#include <CoreGraphics/CGGeometry.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>

namespace Bun {

class WebViewHost;

// Populated by ObjCRuntime::load() via dlsym(RTLD_DEFAULT, ...) — both
// symbols live in libSystem (already linked). Exposed for the HostBlock
// factory in WebViewHost.cpp.
extern void* g_NSConcreteMallocBlock;
extern void (*g_Block_release)(const void*);

namespace objc {

// ---------------------------------------------------------------------------
// Base for all ObjC wrapper types. Holds the raw id, provides typed
// objc_msgSend. Non-owning — callers pair creates with explicit release().
// The shared objc_msgSend pointer is populated once by ObjCRuntime::load().
// ---------------------------------------------------------------------------
struct Ref {
    id m_id = nullptr;

    Ref() = default;
    Ref(id i)
        : m_id(i)
    {
    }
    operator id() const { return m_id; }
    explicit operator bool() const { return m_id != nullptr; }

    void release()
    {
        if (m_id) msg<void>(s_release);
    }

    static void *s_msgSend;
    static SEL s_alloc;
    static SEL s_init;
    static SEL s_release;
    static SEL s_retain;
    static SEL s_description;

    template<typename R, typename... A>
    R msg(SEL op, A... a) const
    {
        return reinterpret_cast<R (*)(id, SEL, A...)>(s_msgSend)(m_id, op, a...);
    }
    template<typename R, typename... A>
    static R msgCls(Class cls, SEL op, A... a)
    {
        return reinterpret_cast<R (*)(Class, SEL, A...)>(s_msgSend)(cls, op, a...);
    }
};

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------
struct NSString : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_stringWithUTF8String;
    static SEL s_UTF8String;

    // Returns autoreleased; callers pass to ObjC methods that retain.
    static NSString fromWTF(const WTF::String &s)
    {
        WTF::CString utf8 = s.utf8();
        return msgCls<id>(cls, s_stringWithUTF8String, utf8.data());
    }
    WTF::String toWTF() const
    {
        if (!m_id) return WTF::String();
        const char *u = msg<const char *>(s_UTF8String);
        return u ? WTF::String::fromUTF8(u) : WTF::String();
    }
};

struct NSURL : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_URLWithString;
    static SEL s_fileURLWithPath_isDirectory;
    static SEL s_absoluteString;

    static NSURL fromString(NSString s) { return msgCls<id>(cls, s_URLWithString, s.m_id); }
    static NSURL fileURL(NSString path, bool isDir)
    {
        return msgCls<id>(cls, s_fileURLWithPath_isDirectory, path.m_id, (signed char)isDir);
    }
    WTF::String absoluteString() const { return NSString(msg<id>(s_absoluteString)).toWTF(); }
};

struct NSURLRequest : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_requestWithURL;

    static NSURLRequest fromURL(NSURL u) { return msgCls<id>(cls, s_requestWithURL, u.m_id); }
};

struct NSError : Ref {
    using Ref::Ref;
    static SEL s_localizedDescription;
    static SEL s_userInfo;

    WTF::String localizedDescription() const
    {
        return NSString(msg<id>(s_localizedDescription)).toWTF();
    }
    id userInfo() const { return msg<id>(s_userInfo); }
};

struct NSData : Ref {
    using Ref::Ref;
    static SEL s_bytes;
    static SEL s_length;

    const void *bytes() const { return msg<const void *>(s_bytes); }
    unsigned long length() const { return msg<unsigned long>(s_length); }
};

struct NSNumber : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_numberWithDouble;
    static NSNumber withDouble(double d) { return msgCls<id>(cls, s_numberWithDouble, d); }
};

struct NSDictionary : Ref {
    using Ref::Ref;
    static Class cls;
    // dictionaryWithObjects:forKeys:count: — non-variadic. The variadic
    // dictionaryWithObjectsAndKeys: puts all args on the stack on arm64
    // (variadic ABI), but msgCls<> casts to a fixed signature which puts
    // them in registers; the callee reads garbage.
    static SEL s_dictionaryWithObjects_forKeys_count;
    static SEL s_objectForKey;
    id objectForKey(id key) const { return msg<id>(s_objectForKey, key); }
    static NSDictionary with2(id v1, id k1, id v2, id k2)
    {
        id vs[2] = { v1, v2 };
        id ks[2] = { k1, k2 };
        return msgCls<id>(cls, s_dictionaryWithObjects_forKeys_count, vs, ks, (unsigned long)2);
    }
    static NSDictionary with3(id v1, id k1, id v2, id k2, id v3, id k3)
    {
        id vs[3] = { v1, v2, v3 };
        id ks[3] = { k1, k2, k3 };
        return msgCls<id>(cls, s_dictionaryWithObjects_forKeys_count, vs, ks, (unsigned long)3);
    }
};

struct NSObject : Ref {
    using Ref::Ref;
    // -description works on anything; toWTF() only on NSStrings.
    WTF::String describe() const { return NSString(msg<id>(s_description)).toWTF(); }
};

// ---------------------------------------------------------------------------
// AppKit
// ---------------------------------------------------------------------------
struct NSApplication : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_sharedApplication;
    static SEL s_setActivationPolicy;

    static void setActivationPolicyProhibited()
    {
        Ref app(msgCls<id>(cls, s_sharedApplication));
        app.msg<void>(s_setActivationPolicy, (long)2 /* NSApplicationActivationPolicyProhibited */);
    }
};

struct NSWindow : Ref {
    using Ref::Ref;
    static Class cls;
    // BunHostWindow — runtime-registered subclass with noResponderFor:
    // overridden to no-op. NSResponder's default beeps on unhandled
    // keyDown: (press("Escape") when the page doesn't preventDefault).
    static Class hostCls;
    static SEL s_initWithContentRect_styleMask_backing_defer;
    static SEL s_setReleasedWhenClosed;
    static SEL s_setContentView;
    static SEL s_setContentSize;
    static SEL s_close;

    // +1 retained. Borderless, buffered, offscreen.
    static NSWindow createOffscreen(double w, double h)
    {
        NSWindow win(msgCls<id>(hostCls, s_alloc));
        win.m_id = win.msg<id>(s_initWithContentRect_styleMask_backing_defer,
            CGRectMake(-10000, -10000, w, h),
            (unsigned long)0 /* NSWindowStyleMaskBorderless */,
            (unsigned long)2 /* NSBackingStoreBuffered */,
            (signed char)0 /* defer: NO */);
        win.msg<void>(s_setReleasedWhenClosed, (signed char)0);
        return win;
    }
    void setContentView(id view) { msg<void>(s_setContentView, view); }
    void setContentSize(double w, double h) { msg<void>(s_setContentSize, CGSizeMake(w, h)); }
    void close() { msg<void>(s_close); }

    static SEL s_orderFront;
    void orderFront() { msg<void>(s_orderFront, (id) nullptr); }

    static SEL s_windowNumber;
    long windowNumber() const { return msg<long>(s_windowNumber); }

    static SEL s_convertPointToScreen;
    CGPoint convertPointToScreen(double x, double y) const
    {
        return msg<CGPoint>(s_convertPointToScreen, CGPointMake(x, y));
    }
};

struct NSView : Ref {
    using Ref::Ref;
    static SEL s_setFrame;

    void setFrame(double w, double h) { msg<void>(s_setFrame, CGRectMake(0, 0, w, h)); }
};

struct NSBitmapImageRep : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_initWithCGImage;
    static SEL s_representationUsingType_properties;

    // Autoreleased NSData PNG bytes. rep is released before return.
    static NSData pngFromCGImage(id cgimage)
    {
        NSBitmapImageRep rep(msgCls<id>(cls, s_alloc));
        rep.m_id = rep.msg<id>(s_initWithCGImage, cgimage);
        id png = rep.msg<id>(s_representationUsingType_properties,
            (unsigned long)4 /* NSBitmapImageFileTypePNG */, (id) nullptr);
        rep.release();
        return png;
    }
};

struct NSImage : Ref {
    using Ref::Ref;
    static SEL s_CGImageForProposedRect_context_hints;

    // Interior pointer, no CF ownership transfer.
    id cgImage() const
    {
        return msg<id>(s_CGImageForProposedRect_context_hints,
            (void *)nullptr, (id) nullptr, (id) nullptr);
    }
};

// NSProcessInfo — we only need systemUptime for event timestamps. AppKit's
// event clock is uptime-relative, not wall-clock.
struct NSProcessInfo : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_processInfo;
    static SEL s_systemUptime;

    static double systemUptime()
    {
        Ref info(msgCls<id>(cls, s_processInfo));
        return info.msg<double>(s_systemUptime);
    }
};

// NSEvent synthesis. WKWebView's mouseDown:/keyDown:/scrollWheel: are NSResponder
// overrides — calling them directly dispatches to WebContent via XPC, trusted,
// no window key/firstResponder gate in the basic path (verified in
// WebViewImpl::keyDown / ::scrollWheel). The automation tag
// (objc_setAssociatedObject) is a tracker for embedders, not a gate.
//
// Wheel events are different: no +[NSEvent scrollWheelEvent...] class method
// exists. CGEventCreateScrollWheelEvent → [NSEvent eventWithCGEvent:] is the
// path (same as WebAutomationSessionMac.mm). CoreGraphics is a transitive
// dep of AppKit so dlsym RTLD_DEFAULT works after the AppKit dlopen.
//
// The 9- and 10-argument class method selectors are the only ObjC calls in the
// codebase that stress the varargs cast this hard. arm64 ABI: CGPoint passes
// as two consecutive doubles in fp registers, scalars in x registers; a single
// objc_msgSend function-pointer cast works without the stret variant.
struct NSEvent : Ref {
    using Ref::Ref;
    static Class cls;
    static SEL s_mouseEventWithType; // ...location:modifierFlags:timestamp:windowNumber:context:eventNumber:clickCount:pressure:
    static SEL s_keyEventWithType; // ...location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:
    static SEL s_eventWithCGEvent;
    static SEL s_eventRelativeToWindow; // _eventRelativeToWindow: (SPI)

    // CoreGraphics function pointers — dlsym'd in load(), not ObjC.
    // CGScrollEventUnitPixel = 0. wheelCount=2 for x+y; delta args are
    // (wheel1, wheel2, ...) = (deltaY, deltaX) — yes, y first.
    static void *(*s_CGEventCreateScrollWheelEvent)(void *source, uint32_t units, uint32_t wheelCount, int32_t wheel1, ...);
    static void (*s_CGEventSetLocation)(void *event, CGPoint location);
    static uint32_t (*s_CGMainDisplayID)();
    static CGRect (*s_CGDisplayBounds)(uint32_t displayID);
    static void (*s_CFRelease)(void *);

    // NSEventType — the ones we use.
    enum : unsigned long {
        LeftMouseDown = 1,
        LeftMouseUp = 2,
        RightMouseDown = 3,
        RightMouseUp = 4,
        KeyDown = 10,
        KeyUp = 11,
        OtherMouseDown = 25,
        OtherMouseUp = 26,
    };
    // NSEventModifierFlags — bits 16–20.
    enum : unsigned long {
        ModShift = 1ul << 17,
        ModControl = 1ul << 18,
        ModOption = 1ul << 19,
        ModCommand = 1ul << 20,
    };

    // Autoreleased. AppKit retains the event across sendEvent:/keyDown: so
    // the pool drain in the caller is sufficient.
    static NSEvent mouseEvent(unsigned long type, double x, double y,
        unsigned long modifierFlags, double timestamp, long windowNumber,
        long clickCount)
    {
        return msgCls<id>(cls, s_mouseEventWithType,
            type, CGPointMake(x, y), modifierFlags, timestamp,
            windowNumber, (id) nullptr /* context */,
            (long)0 /* eventNumber */, clickCount,
            (float)1.0 /* pressure */);
    }

    // Autoreleased. For text input, keyCode=0 + the character; WebContent
    // inserts the text. For virtual keys (Enter, Tab, Escape, arrows),
    // keyCode is the HID usage and characters is the corresponding control
    // character (\r, \t, \x1b, etc.).
    static NSEvent keyEvent(unsigned long type, unsigned long modifierFlags,
        double timestamp, long windowNumber, NSString characters,
        NSString charactersIgnoringModifiers, unsigned short keyCode)
    {
        return msgCls<id>(cls, s_keyEventWithType,
            type, CGPointMake(0, 0), modifierFlags, timestamp,
            windowNumber, (id) nullptr /* context */,
            characters.m_id, charactersIgnoringModifiers.m_id,
            (signed char)0 /* isARepeat */, keyCode);
    }

    // Autoreleased. Deltas are pixels; positive dy scrolls viewport DOWN
    // (content up), matching scrollBy() semantics.
    //
    // eventWithCGEvent: returns an NSEvent with no window, so
    // pointForEvent(event, view) reads a garbage locationInWindow and the
    // wheel event falls outside the view → dropped. The fix is the same
    // transform WebAutomationSessionMac::platformSimulateWheelInteraction
    // uses: set CGEvent location to window-local → screen → flipped for CG
    // top-left (compensates for eventWithCGEvent:'s internal flip — see
    // <rdar://problem/17180591>), then _eventRelativeToWindow: rehomes it.
    // The flip cancels out and locationInWindow lands exactly at (wx, wy).
    static NSEvent wheelEvent(float deltaX, float deltaY, NSWindow window, double wx, double wy)
    {
        void *cgEvent = s_CGEventCreateScrollWheelEvent(
            nullptr, /* kCGScrollEventUnitPixel */ 0, /* wheelCount */ 2,
            static_cast<int32_t>(lroundf(-deltaY)), static_cast<int32_t>(lroundf(-deltaX)));
        CGPoint screen = window.convertPointToScreen(wx, wy);
        double firstScreenH = s_CGDisplayBounds(s_CGMainDisplayID()).size.height;
        s_CGEventSetLocation(cgEvent, CGPointMake(screen.x, firstScreenH - screen.y));
        id ns = msgCls<id>(cls, s_eventWithCGEvent, cgEvent);
        s_CFRelease(cgEvent);
        return Ref(ns).msg<id>(s_eventRelativeToWindow, window.m_id);
    }
};

// ---------------------------------------------------------------------------
// WebKit
// ---------------------------------------------------------------------------
struct WKWebViewConfiguration : Ref {
    using Ref::Ref;
    static Class cls;
    static Class cls_WKWebsiteDataStore;
    static Class cls_WKWebsiteDataStoreConfiguration; // _WKWebsiteDataStoreConfiguration (SPI)
    static SEL s_nonPersistentDataStore;
    static SEL s_initWithDirectory; // macOS 15.2+ (SPI)
    static SEL s_initWithConfiguration; // _initWithConfiguration: (SPI)
    static SEL s_setWebsiteDataStore;

    // +1 retained.
    static WKWebViewConfiguration createEphemeral()
    {
        WKWebViewConfiguration cfg(msgCls<id>(cls, s_alloc));
        cfg.m_id = cfg.msg<id>(s_init);
        id store = msgCls<id>(cls_WKWebsiteDataStore, s_nonPersistentDataStore);
        cfg.msg<void>(s_setWebsiteDataStore, store);
        return cfg;
    }

    // +1 retained. All storage (localStorage, IndexedDB, cookies, cache)
    // lives under `directory`. The store is cached by path: each
    // WKWebsiteDataStore runs its own NetworkProcess session with its own
    // sqlite handle, so two instances pointing at the same directory
    // DON'T share state. Caching gives views with the same dir the
    // same store instance.
    static WKWebViewConfiguration createPersistent(const WTF::String &directory)
    {
        WKWebViewConfiguration cfg(msgCls<id>(cls, s_alloc));
        cfg.m_id = cfg.msg<id>(s_init);
        cfg.msg<void>(s_setWebsiteDataStore, persistentStoreForDirectory(directory));
        return cfg;
    }

private:
    static id persistentStoreForDirectory(const WTF::String &directory);
};

struct WKWebView : Ref {
    using Ref::Ref;
    static Class cls;
    static Class cls_WKSnapshotConfiguration;
    static SEL s_initWithFrame_configuration;
    static SEL s_setNavigationDelegate;
    static SEL s_loadRequest;
    static SEL s_stopLoading;
    static SEL s_reload;
    static SEL s_canGoBack;
    static SEL s_canGoForward;
    static SEL s_goBack;
    static SEL s_goForward;
    static SEL s_isLoading;
    static SEL s_URL;
    static SEL s_title;
    static SEL s_setAfterScreenUpdates;
    static SEL s_takeSnapshotWithConfiguration_completionHandler;

    // +1 retained. cfg is consumed (released).
    static WKWebView create(WKWebViewConfiguration cfg, double w, double h)
    {
        WKWebView web(msgCls<id>(cls, s_alloc));
        web.m_id = web.msg<id>(s_initWithFrame_configuration, CGRectMake(0, 0, w, h), cfg.m_id);
        cfg.release();
        return web;
    }
    void setNavigationDelegate(id d) { msg<void>(s_setNavigationDelegate, d); }
    static SEL s_setUIDelegate;
    void setUIDelegate(id d) { msg<void>(s_setUIDelegate, d); }
    void loadRequest(NSURLRequest r) { msg<void>(s_loadRequest, r.m_id); }

    // callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:
    // (public API, macOS 11.0+). The body is wrapped in an async function;
    // named keys in the args dict become named parameters. If the body
    // returns a thenable, WebKit awaits it — completion fires on resolve,
    // or with WKErrorJavaScriptAsyncFunctionResultRejected on reject, or
    // WKErrorJavaScriptAsyncFunctionResultUnreachable if the promise GCs
    // (page navigated away). No polling; the page-side Promise is the signal.
    static Class cls_WKContentWorld;
    static SEL s_pageWorld;
    static SEL s_callAsyncJavaScript;
    void callAsync(NSString body, id argsDict, void *block)
    {
        id world = msgCls<id>(cls_WKContentWorld, s_pageWorld);
        msg<void>(s_callAsyncJavaScript, body.m_id, argsDict, (id) nullptr /*frame*/, world, block);
    }
    void stopLoading() { msg<void>(s_stopLoading); }
    void reload() { msg<void>(s_reload); }
    bool canGoBack() const { return msg<signed char>(s_canGoBack) != 0; }
    bool canGoForward() const { return msg<signed char>(s_canGoForward) != 0; }
    void goBack() { msg<void>(s_goBack); }
    void goForward() { msg<void>(s_goForward); }
    bool isLoading() const { return msg<signed char>(s_isLoading) != 0; }
    NSURL url() const { return msg<id>(s_URL); }
    WTF::String title() const { return NSString(msg<id>(s_title)).toWTF(); }

    // NSResponder overrides. [window sendEvent:] requires makeKeyAndOrderFront:
    // (WebAutomationSessionMac.mm does it), which would show the window.
    // Calling these directly goes WKWebViewMac.mm → _impl->mouseDown/keyDown
    // → WebViewImpl → XPC to WebContent. No isKeyWindow gate in the basic path.
    static SEL s_mouseDown;
    static SEL s_mouseUp;
    static SEL s_rightMouseDown;
    static SEL s_rightMouseUp;
    static SEL s_otherMouseDown;
    static SEL s_otherMouseUp;
    static SEL s_keyDown;
    static SEL s_keyUp;
    void mouseDown(NSEvent e) { msg<void>(s_mouseDown, e.m_id); }
    void mouseUp(NSEvent e) { msg<void>(s_mouseUp, e.m_id); }
    void rightMouseDown(NSEvent e) { msg<void>(s_rightMouseDown, e.m_id); }
    void rightMouseUp(NSEvent e) { msg<void>(s_rightMouseUp, e.m_id); }
    void otherMouseDown(NSEvent e) { msg<void>(s_otherMouseDown, e.m_id); }
    void otherMouseUp(NSEvent e) { msg<void>(s_otherMouseUp, e.m_id); }
    void keyDown(NSEvent e) { msg<void>(s_keyDown, e.m_id); }
    void keyUp(NSEvent e) { msg<void>(s_keyUp, e.m_id); }

    static SEL s_scrollWheel;
    void scrollWheel(NSEvent e) { msg<void>(s_scrollWheel, e.m_id); }

    // TextChecker state is process-global; set once. Native keydown goes
    // through NSTextInputContext → smart quotes/dashes/replacement by
    // default — type("it's") would yield "it’s". Automation wants literal
    // characters. Spelling correction has no setter (toggle only).
    static SEL s_setAutomaticQuoteSubstitutionEnabled;
    static SEL s_setAutomaticDashSubstitutionEnabled;
    static SEL s_setAutomaticTextReplacementEnabled;
    void disableTextSubstitutions()
    {
        msg<void>(s_setAutomaticQuoteSubstitutionEnabled, (signed char)0);
        msg<void>(s_setAutomaticDashSubstitutionEnabled, (signed char)0);
        msg<void>(s_setAutomaticTextReplacementEnabled, (signed char)0);
    }

    // With the window offscreen and never orderFront'd, visibilityState is
    // "hidden" and requestAnimationFrame never fires — spec'd behavior,
    // the display link is gated on page visibility. orderFront: alone
    // doesn't help because WKWebView's occlusion detection (via
    // NSWindowDidChangeOcclusionStateNotification) correctly sees the
    // window at (-10000,-10000) is fully occluded. Disabling occlusion
    // detection + orderFront: = visibilityState "visible" + rAF ticks at
    // display rate. The window is still invisible to the user: borderless,
    // offscreen, ActivationPolicyProhibited means it can't be activated.
    static SEL s_setWindowOcclusionDetectionEnabled;
    void disableOcclusionDetection()
    {
        msg<void>(s_setWindowOcclusionDetectionEnabled, (signed char)0);
    }

    // Input completion SPIs. Both are the proper WebKit-owned barriers:
    // _executeEditCommand uses sendWithAsyncReplyToProcessContainingFrame —
    // the completion fires when WebContent has processed the command.
    // _doAfterProcessingAllPendingMouseEvents fires when the UIProcess
    // mouseEventQueue drains (WebContent has acked every sent mouse event).
    // No JSON, no evaluateJavaScript polling. macOS 10.13.4+ for both.
    static SEL s_executeEditCommand; // _executeEditCommand:argument:completion:
    static SEL s_doAfterPendingMouseEvents; // _doAfterProcessingAllPendingMouseEvents:
    void executeEditCommand(NSString cmd, NSString arg, void *completionBlock)
    {
        msg<void>(s_executeEditCommand, cmd.m_id, arg.m_id, completionBlock);
    }
    void doAfterPendingMouseEvents(void *block)
    {
        msg<void>(s_doAfterPendingMouseEvents, block);
    }

    // Fires after the next layer tree commit arrives in the UI process.
    // The scrolling tree is bundled with that commit, so this is the barrier
    // for the first scrollWheel: after a navigation — before it arrives,
    // RemoteScrollingCoordinatorProxy hits an empty tree and drops the event.
    // macOS 10.12+.
    static SEL s_doAfterNextPresentationUpdate;
    void doAfterNextPresentationUpdate(void *block)
    {
        msg<void>(s_doAfterNextPresentationUpdate, block);
    }

    void takeSnapshot(void *block)
    {
        Ref cfg(msgCls<id>(cls_WKSnapshotConfiguration, s_alloc));
        cfg.m_id = cfg.msg<id>(s_init);
        cfg.msg<void>(s_setAfterScreenUpdates, (signed char)1);
        msg<void>(s_takeSnapshotWithConfiguration_completionHandler, cfg.m_id, block);
        cfg.release();
    }
};

// Runtime-registered NSObject<WKNavigationDelegate> subclass. The associated
// object is the WebViewHost*.
struct NavigationDelegate : Ref {
    using Ref::Ref;
    static Class cls;
    static void (*s_setAssoc)(id, const void *, id, uintptr_t);
    static id (*s_getAssoc)(id, const void *);
    static char s_hostKey;

    // +1 retained.
    static NavigationDelegate create(WebViewHost *host)
    {
        NavigationDelegate d(msgCls<id>(cls, s_alloc));
        d.m_id = d.msg<id>(s_init);
        s_setAssoc(d.m_id, &s_hostKey, reinterpret_cast<id>(host), 0 /* OBJC_ASSOCIATION_ASSIGN */);
        return d;
    }
    void clearHost() { s_setAssoc(m_id, &s_hostKey, nullptr, 0); }
    WebViewHost *host() const { return reinterpret_cast<WebViewHost *>(s_getAssoc(m_id, &s_hostKey)); }
};

} // namespace objc

// ---------------------------------------------------------------------------
// Loader singleton. dlopens the frameworks, populates all wrapper statics,
// registers the delegate class, initializes the global blocks. Also owns
// the event-loop bridge and block correlation state.
// ---------------------------------------------------------------------------
class ObjCRuntime {
public:
    WTF::String m_loadError;
    bool m_loaded = false;

    static ObjCRuntime *tryLoad();

    // CFRunLoopRun in the host process doesn't install the NSApplication
    // autorelease-pool observer. Every stringWithUTF8String: etc. is
    // autoreleased; WebKit teardown also relies on autorelease for the
    // last strong ref drop → dealloc → XPC cancel. Bracket each dispatch.
    void *(*m_autoreleasePoolPush)();
    void (*m_autoreleasePoolPop)(void *);

    class ARPool {
        void *m_ctx;

    public:
        ARPool() { m_ctx = ObjCRuntime::tryLoad()->m_autoreleasePoolPush(); }
        ~ARPool() { ObjCRuntime::tryLoad()->m_autoreleasePoolPop(m_ctx); }
    };

    ObjCRuntime() = default;

private:
    bool load();
};


} // namespace Bun

#endif // OS(DARWIN)
