// Aggregated C includes for automatic translation into bindings.
// Prefer adding includes
// to this file instead of manually porting struct definitions.
// By using automatic translation, differences
// between platforms and subtle mistakes can be avoided.
//
// When this file is translated, these macros are defined:
// - WINDOWS
// - DARWIN
// - LINUX
// - FREEBSD
// - POSIX

// For `POSIX_SPAWN_SETSID` and some other non-POSIX extensions in glibc
#if LINUX
#define _GNU_SOURCE
#endif

// OnBeforeParseResult, etc...
#include "../packages/bun-native-bundler-plugin-api/bundler_plugin.h"

#if POSIX
#include <fcntl.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netdb.h>
#include <pwd.h>
#include <spawn.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

#if DARWIN
#include <copyfile.h>
#include <libproc.h>
#include <mach/mach_host.h>
#include <mach/processor_info.h>
#include <net/if_dl.h>
#include <sys/clonefile.h>
#include <sys/mount.h>
#include <sys/stdio.h>
#include <sys/sysctl.h>
#elif LINUX
#include <linux/fs.h>
#include <sys/statfs.h>
#include <sys/sysinfo.h>
#elif FREEBSD
#include <arpa/inet.h>
#include <dirent.h>
#include <net/if_dl.h>
#include <sys/event.h>
#include <sys/mount.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <sys/umtx.h>
#include <sys/user.h>
#include <sys/utsname.h>
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
