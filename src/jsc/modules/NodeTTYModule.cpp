#include "root.h"

#include "NodeTTYModule.h"

#if OS(WINDOWS)
#include <windows.h>

extern "C" void* Bun__getOSFHandle(int fd);
#endif

using namespace JSC;

namespace Zig {

bool isTTY(int fd)
{
#if !OS(WINDOWS)
    return isatty(fd);
#else
    // NUL is a character device too, but only a console has a console mode.
    HANDLE handle = fd >= 0 ? Bun__getOSFHandle(fd) : INVALID_HANDLE_VALUE;
    DWORD mode;
    return GetFileType(handle) == FILE_TYPE_CHAR && GetConsoleMode(handle, &mode);
#endif
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTty_isatty, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsBoolean(isTTY(fd)));
}

} // namespace Zig
