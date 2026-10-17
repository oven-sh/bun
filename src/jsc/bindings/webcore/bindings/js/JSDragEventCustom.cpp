#include "config.h"
#include "JSDragEvent.h"

#include "DragEvent.h"

namespace WebCore {

template<typename Visitor>
void JSDragEvent::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().dataTransfer().visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSDragEvent);

} // namespace WebCore
