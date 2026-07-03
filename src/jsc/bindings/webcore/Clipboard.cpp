#include "root.h"
#include "Clipboard.h"

#include "ClipboardEvent.h"
#include "EventNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Clipboard);

Clipboard::Clipboard(ScriptExecutionContext* context)
    : ContextDestructionObserver(context)
{
}

Clipboard::~Clipboard() = default;

void Clipboard::fireClipboardEvent(const AtomString& type)
{
    dispatchEvent(ClipboardEvent::create(type, EventInit {}, Event::IsTrusted::Yes));
}

} // namespace WebCore
