#include "config.h"
#include "Screen.h"

#include "Window.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Screen);

int Screen::width() const
{
    return window() ? window()->innerWidth() : 0;
}

int Screen::height() const
{
    return window() ? window()->innerHeight() : 0;
}

} // namespace WebCore
