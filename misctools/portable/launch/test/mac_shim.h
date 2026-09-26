/* Stands in for the Apple SDK, for a COMPILE CHECK of the macOS branches of
   ../host/host_posix.c on a machine that has no SDK: the musl headers of the
   image sysroot provide the common POSIX declarations, and this file adds the
   macOS ones that host_posix.c uses. It checks syntax, types and the inline
   assembly, nothing else. A real macOS stub is linked on a Mac with cc
   against libSystem, where these come from the SDK headers.

   The fsignatures_t / F_ADDFILESIGS_RETURN part is from xnu bsd/sys/fcntl.h. */
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>

typedef struct fsignatures {
  off_t fs_file_start;
  void *fs_blob_start;
  size_t fs_blob_size;
  size_t fs_fsignatures_size;
  char fs_cdhash[20];
  int fs_hash_type;
} fsignatures_t;
#define F_ADDFILESIGS_RETURN 97

/* Apple names the timespec members of struct stat differently (xnu
   bsd/sys/stat.h); musl has the POSIX st_atim / st_mtim / st_ctim. */
#define st_atimespec st_atim
#define st_mtimespec st_mtim
#define st_ctimespec st_ctim

/* Signals that BSD has and Linux does not (xnu bsd/sys/signal.h). */
#define SIGEMT 7
#define SIGINFO 29

/* sysctlbyname, from the SDK's sys/sysctl.h. */
int sysctlbyname(const char *name, void *oldp, size_t *oldlenp, void *newp, size_t newlen);
