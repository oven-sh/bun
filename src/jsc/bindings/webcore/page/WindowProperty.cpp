#include "config.h"
#include "WindowProperty.h"

#include "Window.h"

namespace WebCore {

Document* WindowProperty::document() const
{
    return m_window ? m_window->document() : nullptr;
}

} // namespace WebCore
