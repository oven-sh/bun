#include "config.h"
#include "JSNavigator.h"

namespace WebCore {

// The frozen array of the runtime's `navigator`, so that every read gives the same object.
JSC::JSValue JSNavigator::languages(JSC::JSGlobalObject&) const
{
    return realm()->m_navigatorLanguages.getInitializedOnMainThread(realm());
}

} // namespace WebCore
