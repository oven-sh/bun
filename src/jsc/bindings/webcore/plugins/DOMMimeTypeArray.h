#pragma once

#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

// https://html.spec.whatwg.org/multipage/system-state.html#mimetypearray
class DOMMimeTypeArray final : public ScriptWrappable, public RefCounted<DOMMimeTypeArray>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(DOMMimeTypeArray);
public:
    static Ref<DOMMimeTypeArray> create(Window& window) { return adoptRef(*new DOMMimeTypeArray(window)); }

    unsigned length() const { return 0; }
    JSC::JSValue item(unsigned) const { return JSC::jsNull(); }
    JSC::JSValue namedItem(const String&) const { return JSC::jsNull(); }

private:
    explicit DOMMimeTypeArray(Window& window)
        : WindowProperty(window)
    {
    }
};

} // namespace WebCore
