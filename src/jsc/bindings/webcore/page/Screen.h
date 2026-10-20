#pragma once

#include "ScriptWrappable.h"
#include "WindowProperty.h"
#include <wtf/RefCounted.h>

namespace WebCore {

// https://drafts.csswg.org/cssom-view/#the-screen-interface
class Screen final : public ScriptWrappable, public RefCounted<Screen>, public WindowProperty {
    WTF_MAKE_TZONE_ALLOCATED(Screen);
public:
    static Ref<Screen> create(Window& window) { return adoptRef(*new Screen(window)); }

    int width() const;
    int height() const;
    unsigned colorDepth() const { return 24; }

private:
    explicit Screen(Window& window)
        : WindowProperty(window)
    {
    }
};

} // namespace WebCore
