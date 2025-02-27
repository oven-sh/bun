// This file is run through translate-c and exposed to Zig code
// under the namespace bun.C.translated. Prefer adding includes
// to this file instead of manually porting struct definitions
// into Zig code. By using automatic translation, differences
// in platforms can be avoided.
//
// When Zig is translating this file, it will define these macros:
// - WINDOWS
// - DARWIN
// - LINUX
// - POSIX

// OnBeforeParseResult, etc...
#include "../packages/bun-native-bundler-plugin-api/bundler_plugin.h"

#if POSIX
// passwd, getpwuid_r
#include "pwd.h"
// geteuid
#include <unistd.h>
// AI_ADDRCONFIG
#include <netdb.h>
#endif

#if DARWIN
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#elif LINUX
#include <sys/statfs.h>
#include <sys/stat.h>
#endif
