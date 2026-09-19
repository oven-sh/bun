#include "root.h"

#include "NodeTTYModule.h"

#if OS(WINDOWS)
#include <io.h>
#include <windows.h>
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
        HANDLE handle = reinterpret_cast<HANDLE>(_get_osfhandle(fd));
        DWORD mode;
        isTTY = GetFileType(handle) == FILE_TYPE_CHAR && GetConsoleMode(handle, &mode);
    }
#endif

    return JSValue::encode(jsBoolean(isTTY));
}

} // namespace Zig
