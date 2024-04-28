#pragma once
#include "root.h"

#define POSIX_PATH_SEP_s "/"_s
#define POSIX_PATH_SEP '/'
#define WINDOWS_PATH_SEP_s "\\"_s
#define WINDOWS_PATH_SEP '\\'

#if OS(WINDOWS)
#define PLATFORM_SEP_s WINDOWS_PATH_SEP_s
#define PLATFORM_SEP WINDOWS_PATH_SEP
#else
#define PLATFORM_SEP_s POSIX_PATH_SEP_s
#define PLATFORM_SEP POSIX_PATH_SEP
#endif

ALWAYS_INLINE bool isAbsolutePath(WTF::String input)
{
#if OS(WINDOWS)
    if (input.is8Bit()) {
        auto len = input.length();
        if (len < 1)
            return false;
        const auto bytes = input.span8().data();
        if (bytes[0] == '/' || bytes[0] == '\\')
            return true;
        if (len < 2)
            return false;
        if (bytes[1] == ':' && (bytes[2] == '/' || bytes[2] == '\\'))
            return true;
        return false;
    } else {
        auto len = input.length();
        if (len < 1)
            return false;
        const auto bytes = input.span16().data();
        if (bytes[0] == '/' || bytes[0] == '\\')
            return true;
        if (len < 2)
            return false;
        if (bytes[1] == ':' && (bytes[2] == '/' || bytes[2] == '\\'))
            return true;
        return false;
    }
#else // OS(WINDOWS)
    return input.startsWith('/');
#endif
}

extern "C" BunString ResolvePath__joinAbsStringBufCurrentPlatformBunString(JSC::JSGlobalObject*, BunString);

/// CWD is determined by the global object's current cwd.
ALWAYS_INLINE WTF::String pathResolveWTFString(JSC::JSGlobalObject* globalToGetCwdFrom, WTF::String input)
{
    if (isAbsolutePath(input))
        return input;
    BunString in = Bun::toString(input);
    BunString out = ResolvePath__joinAbsStringBufCurrentPlatformBunString(globalToGetCwdFrom, in);
    return out.toWTFString();
}
