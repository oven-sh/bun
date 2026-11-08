#include "config.h"
#include <wtf/PlatformCallingConventions.h>

namespace Bun {
namespace JS2Native {

JSC_DECLARE_HOST_FUNCTION(jsDollarLazy);
JSC::JSValue nativeBinding(JSC::JSGlobalObject*, uint32_t index);

} // namespace JS2Native
} // namespace Bun
