#pragma once

// File paths and file URLs in the flavour of the OS this process runs on (BunHostOS.h).
//
// WTF::URL::fileSystemPath() and WTF::URL::fileURLWithFileSystemPath() have the flavour of the OS that WebKit
// is compiled for. In every build but one that is the host, and the functions here are those two. WebKit of
// the portable image (BUN_PORTABLE) is compiled for Linux: on a Windows host the Windows flavour is made here.

#include "BunHostOS.h"
#include <wtf/URL.h>
#include <wtf/text/WTFString.h>

namespace Bun {

#if defined(BUN_PORTABLE)

// "C:\a\b" of "file:///C:/a/b", "\\server\share\a" of "file://server/share/a".
WTF::String windowsFileSystemPath(const WTF::URL&);
// "file:///C:/a/b" of "C:\a\b", "file://server/share/a" of "\\server\share\a".
WTF::URL fileURLWithWindowsFileSystemPath(WTF::StringView);

ALWAYS_INLINE WTF::String fileSystemPath(const WTF::URL& url)
{
    if (hostIsWindows()) [[unlikely]]
        return windowsFileSystemPath(url);
    return url.fileSystemPath();
}

ALWAYS_INLINE WTF::URL fileURLWithFileSystemPath(WTF::StringView path)
{
    if (hostIsWindows()) [[unlikely]]
        return fileURLWithWindowsFileSystemPath(path);
    return WTF::URL::fileURLWithFileSystemPath(path);
}

#else

ALWAYS_INLINE WTF::String fileSystemPath(const WTF::URL& url)
{
    return url.fileSystemPath();
}

ALWAYS_INLINE WTF::URL fileURLWithFileSystemPath(WTF::StringView path)
{
    return WTF::URL::fileURLWithFileSystemPath(path);
}

#endif

} // namespace Bun
