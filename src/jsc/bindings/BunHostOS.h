#pragma once

// The operating system this process runs on, in the portable image (BUN_PORTABLE): what process.platform
// names there, and every decision that has to agree with it. The C++ view of bun_core::host
// (src/bun_core/host.rs).
//
// OS(WINDOWS), OS(DARWIN), OS(LINUX) say what the code is COMPILED for. In every build but the portable
// image that is also where it runs, and such a build reads nothing of this file. The portable image is
// compiled for Linux and runs on Linux, macOS and Windows: the functions here read one byte that is written
// once at startup.

#if defined(BUN_PORTABLE)

#include <wtf/Compiler.h>
#include <wtf/Platform.h>
#include <wtf/text/ASCIILiteral.h>
#include <cstdint>

#include <atomic>

// The portable image has the code for a Windows host and the code for every other one.
#define BUN_HOST_MAY_BE_WINDOWS 1
#define BUN_HOST_MAY_BE_POSIX 1
#define BUN_HOST_OS_FUNCTION ALWAYS_INLINE

namespace Bun {

// The numbers are those of __bun_host_os() in the C library of the portable image.
enum class HostOS : uint8_t {
    Linux = 1,
    Windows = 2,
    Mac = 3,
    FreeBSD = 4,
};

extern "C" std::atomic<uint8_t> Bun__hostOS;
extern "C" uint8_t Bun__readHostOS();

ALWAYS_INLINE HostOS hostOS()
{
    uint8_t os = Bun__hostOS.load(std::memory_order_relaxed);
    if (!os) [[unlikely]]
        os = Bun__readHostOS();
    return static_cast<HostOS>(os);
}

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

#endif
