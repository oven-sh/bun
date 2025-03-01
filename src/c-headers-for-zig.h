// This file is run through translate-c and exposed to Zig code
// under the namespace bun.c (lowercase c). Prefer adding includes
// to this file instead of manually porting struct definitions
// into Zig code. By using automatic translation, differences
// between platforms and subtle mistakes can be avoided.
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
#include "pwd.h"
#include <unistd.h>
#include <netdb.h>
#endif

#if DARWIN
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/fcntl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <sys/spawn.h>
#elif LINUX
#include <sys/statfs.h>
#include <sys/stat.h>
#include <spawn.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <linux/fs.h>
#endif
