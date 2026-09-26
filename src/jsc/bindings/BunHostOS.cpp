#include "root.h"
#include "BunHostOS.h"

#if defined(BUN_PORTABLE)

// The C library of the portable image says which operating system runs the image:
// 1 Linux, 2 Windows, 3 macOS (bun_core::host calls it once). This weak definition is what the link finds
// when the C library has no such function: an image that the Linux kernel runs.
//
// A linker takes a member out of libc.a only for a symbol that is still undefined. The definition in the
// C library therefore has to be in an object that every program links (the one that holds the host table),
// where it replaces this one.
extern "C" __attribute__((weak)) unsigned long __bun_host_os(void)
{
    return static_cast<unsigned long>(Bun::HostOS::Linux);
}

#endif
