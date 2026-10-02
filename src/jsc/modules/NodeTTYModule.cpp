#include "root.h"

#include "NodeTTYModule.h"

#if OS(WINDOWS)
#include <windows.h>

// `_get_osfhandle`; INVALID_HANDLE_VALUE for an fd that has no HANDLE.
extern "C" void* Bun__crtGetOsfhandle(int fd);
#endif

using namespace JSC;

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
    // A character device that is not a console (NUL, a serial port) is not a tty.
    bool isTTY = false;
    if (fd >= 0) {
        HANDLE handle = Bun__crtGetOsfhandle(fd);
        DWORD mode;
        isTTY = GetFileType(handle) == FILE_TYPE_CHAR && GetConsoleMode(handle, &mode);
    }
#endif

    return JSValue::encode(jsBoolean(isTTY));
}

} // namespace Zig
