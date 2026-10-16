#pragma once

#include "ResizeObserverCallback.h"
#include "ResizeObserverOptions.h"
#include "ScriptWrappable.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class Element;

// https://drafts.csswg.org/resize-observer/
// An observation is reported when the box's size differs from the last one reported, which starts as 0 by 0. Without layout
// every box is 0 by 0, so the callback is never called and there is nothing to remember.
class ResizeObserver final : public ScriptWrappable, public RefCounted<ResizeObserver> {
    WTF_MAKE_TZONE_ALLOCATED(ResizeObserver);
public:
    static Ref<ResizeObserver> create(Ref<ResizeObserverCallback>&&) { return adoptRef(*new ResizeObserver); }

    void observe(Element&, const ResizeObserverOptions&) { }
    void unobserve(Element&) { }
    void disconnect() { }

private:
    ResizeObserver() = default;
};

} // namespace WebCore
