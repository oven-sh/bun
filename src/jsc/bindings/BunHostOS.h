#pragma once

// The operating system this process runs on: what process.platform names, and every decision that has to
// agree with it. The C++ view of bun_core::host (src/bun_core/host.rs).
//
// OS(WINDOWS), OS(DARWIN), OS(LINUX) say what the code is COMPILED for. In every build but one that is also
// where it runs, and the functions here are constants. The portable image (BUN_PORTABLE) is compiled for
// Linux and runs on Linux, macOS and Windows: there they read one byte that is written once at startup.

#include <wtf/Compiler.h>
#include <wtf/Platform.h>
#include <wtf/text/ASCIILiteral.h>
#include <cstdint>

#if defined(BUN_PORTABLE)
#include <atomic>

// Code for a Windows host is compiled where the target is Windows, and in the portable image.
#define BUN_HOST_MAY_BE_WINDOWS 1
#define BUN_HOST_MAY_BE_POSIX 1
#define BUN_HOST_OS_FUNCTION ALWAYS_INLINE
#else
#define BUN_HOST_MAY_BE_WINDOWS OS(WINDOWS)
#define BUN_HOST_MAY_BE_POSIX !OS(WINDOWS)
#define BUN_HOST_OS_FUNCTION constexpr
#endif

namespace Bun {

// The numbers are those of __bun_host_os() in the C library of the portable image.
enum class HostOS : uint8_t {
    Linux = 1,
    Windows = 2,
    Mac = 3,
    FreeBSD = 4,
};

#if defined(BUN_PORTABLE)

extern "C" std::atomic<uint8_t> Bun__hostOS;
extern "C" uint8_t Bun__readHostOS();

ALWAYS_INLINE HostOS hostOS()
{
    uint8_t os = Bun__hostOS.load(std::memory_order_relaxed);
    if (!os) [[unlikely]]
        os = Bun__readHostOS();
    return static_cast<HostOS>(os);
}

#else

constexpr HostOS hostOS()
{
#if OS(WINDOWS)
    return HostOS::Windows;
#elif OS(DARWIN)
    return HostOS::Mac;
#elif OS(FREEBSD)
    return HostOS::FreeBSD;
#else
    return HostOS::Linux;
#endif
}

#endif

BUN_HOST_OS_FUNCTION bool hostIsWindows() { return hostOS() == HostOS::Windows; }
BUN_HOST_OS_FUNCTION bool hostIsMac() { return hostOS() == HostOS::Mac; }
BUN_HOST_OS_FUNCTION bool hostIsLinux() { return hostOS() == HostOS::Linux; }

// The value of process.platform.
BUN_HOST_OS_FUNCTION ASCIILiteral hostPlatformName()
{
#if defined(__ANDROID__)
    return "android"_s;
#else
    switch (hostOS()) {
    case HostOS::Windows:
        return "win32"_s;
    case HostOS::Mac:
        return "darwin"_s;
    case HostOS::FreeBSD:
        return "freebsd"_s;
    case HostOS::Linux:
        break;
    }
    return "linux"_s;
#endif
}

} // namespace Bun

#undef BUN_HOST_OS_FUNCTION
