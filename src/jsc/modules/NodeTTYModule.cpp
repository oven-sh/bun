#include "root.h"

#include "NodeTTYModule.h"

using namespace JSC;

#if OS(WINDOWS)
extern "C" bool Bun__isatty(int32_t fd);
#endif

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionTty_isatty, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

#if !OS(WINDOWS)
    bool isTTY = isatty(fd);
#else
    bool isTTY = Bun__isatty(fd);
#endif

    return JSValue::encode(jsBoolean(isTTY));
}

} // namespace Zig
