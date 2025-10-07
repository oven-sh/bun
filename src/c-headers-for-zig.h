// This file is run through translate-c and exposed to Zig code
// under the namespace bun.c (lowercase c). Prefer adding includes
// to this file instead of manually porting struct definitions
// into Zig code. By using automatic translation, differences
// between platforms and subtle mistakes can be avoided.
//
// One way to locate a definition for a given symbol is to open
// Zig's `lib` directory and run ripgrep on it. For example,
// `sockaddr_dl` is in `libc/include/any-macos-any/net/if_dl.h`
//
// When Zig is translating this file, it will define these macros:
// - WINDOWS
// - DARWIN
// - LINUX
// - POSIX

// For `POSIX_SPAWN_SETSID` and some other non-POSIX extensions in glibc
#if LINUX
#define _GNU_SOURCE
#endif

// OnBeforeParseResult, etc...
#include "../packages/bun-native-bundler-plugin-api/bundler_plugin.h"

#if POSIX
#include <ifaddrs.h>
#include <netdb.h>
#include <pwd.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#endif

#if DARWIN
#include <copyfile.h>
#include <mach/mach_host.h>
#include <mach/processor_info.h>
#include <net/if.h>
#include <net/if_dl.h>
#include <sys/clonefile.h>
#include <sys/fcntl.h>
#include <sys/mount.h>
#include <sys/socket.h>
#include <sys/spawn.h>
#include <sys/stat.h>
#include <sys/stdio.h>
#include <sys/sysctl.h>
#elif LINUX
#include <fcntl.h>
#include <linux/fs.h>
#include <net/if.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/sysinfo.h>
#endif

#if WINDOWS
#include <windows.h>
#include <winternl.h>
#endif

#undef lstat
#undef fstat
#undef stat

#include <zstd.h>
#include <zstd_errors.h>
