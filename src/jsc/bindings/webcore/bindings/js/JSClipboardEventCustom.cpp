#include "config.h"
#include "JSClipboardEvent.h"

#include "ClipboardEvent.h"

namespace WebCore {

template<typename Visitor>
void JSClipboardEvent::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().clipboardData().visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSClipboardEvent);

} // namespace WebCore
