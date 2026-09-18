#include "config.h"
#include "WebStreamsInternals.h"

#include "JSStreamsRuntime.h"
#include <JavaScriptCore/JSCInlines.h>

// Transferable streams are out of scope: Bun's structured clone never transfers a stream, so
// nothing ever sets up a cross-realm transform and this handler is never registered.

namespace WebCore {

JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onCrossRealmWritableBackpressureFulfilled, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

} // namespace WebCore
