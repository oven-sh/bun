#pragma once

#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// https://html.spec.whatwg.org/multipage/system-state.html#pluginarray
class DOMPluginArray final : public ScriptWrappable, public RefCounted<DOMPluginArray>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(DOMPluginArray);
public:
    static Ref<DOMPluginArray> create(Window& window) { return adoptRef(*new DOMPluginArray(window)); }

    unsigned length() const { return 0; }
    JSC::JSValue item(unsigned) const { return JSC::jsNull(); }
    JSC::JSValue namedItem(const String&) const { return JSC::jsNull(); }
    void refresh(bool) { }

private:
    explicit DOMPluginArray(Window& window)
        : WindowProperty(window)
    {
    }
};

} // namespace WebCore
