#include "config.h"
#include "Navigator.h"

#include "BunNavigator.h"
#include <JavaScriptCore/IntlObject.h>
#include <wtf/NumberOfCores.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Navigator);

Navigator::Navigator(Window& window)
    : WindowProperty(window)
    , m_plugins(DOMPluginArray::create(window))
    , m_mimeTypes(DOMMimeTypeArray::create(window))
{
}

Navigator::~Navigator() = default;

void Navigator::detachFromWindow()
{
    WindowProperty::detachFromWindow();
    m_plugins->detachFromWindow();
    m_mimeTypes->detachFromWindow();
}

String Navigator::userAgent()
{
    return Bun::navigatorUserAgent();
}

String Navigator::platform()
{
    return Bun::navigatorPlatform();
}

String Navigator::language(JSC::JSGlobalObject& globalObject)
{
    return JSC::defaultLocale(&globalObject);
}

unsigned Navigator::hardwareConcurrency()
{
    return WTF::numberOfProcessorCores();
}

} // namespace WebCore
