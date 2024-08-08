#include "config.h"
#include <wtf/PlatformCallingConventions.h>

namespace Bun {
namespace JS2Native {

JSC_DECLARE_HOST_FUNCTION(jsDollarLazy);

JSC_DECLARE_HOST_FUNCTION(jsDollarCpp);
JSC_DECLARE_HOST_FUNCTION(jsDollarZig);

} // namespace JS2Native
} // namespace Bun