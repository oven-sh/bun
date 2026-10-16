#pragma once

#include "DOMMimeTypeArray.h"
#include "DOMPluginArray.h"
#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
}

namespace WebCore {

// https://html.spec.whatwg.org/multipage/system-state.html#the-navigator-object
// A window's `navigator`. The runtime's own is in BunNavigator.h: it says nothing about a browser, as in Node.
class Navigator final : public ScriptWrappable, public RefCounted<Navigator>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(Navigator);
public:
    static Ref<Navigator> create(Window& window) { return adoptRef(*new Navigator(window)); }
    ~Navigator();

    void detachFromWindow();

    static String appName() { return "Netscape"_s; }
    static String appVersion() { return "4.0"_s; }
    static String appCodeName() { return "Mozilla"_s; }
    static String product() { return "Gecko"_s; }
    static String productSub() { return "20030107"_s; }
    static String vendor() { return "Apple Computer, Inc."_s; }
    static String vendorSub() { return emptyString(); }

    // The same answers as the runtime's `navigator`.
    static String userAgent();
    static String platform();
    static String language(JSC::JSGlobalObject&);
    static bool onLine() { return true; }
    static unsigned hardwareConcurrency();

    static bool cookieEnabled() { return true; }
    static bool javaEnabled() { return false; }
    DOMPluginArray& plugins() { return m_plugins; }
    DOMMimeTypeArray& mimeTypes() { return m_mimeTypes; }

private:
    explicit Navigator(Window&);

    const Ref<DOMPluginArray> m_plugins;
    const Ref<DOMMimeTypeArray> m_mimeTypes;
};

} // namespace WebCore
