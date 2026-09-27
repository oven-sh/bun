/* For a check of the syntax and the types of host_posix.c for macOS on a machine that has no SDK of
   macOS (host/check.ts, launch/tools/build.ts): the headers of musl stand in for the SDK, and this
   file has what the macOS branches of host_posix.c use of macOS and what those headers do not have
   or spell in another way. It checks syntax, types and the inline assembly, and not one declaration
   of macOS. A host for macOS is built on a Mac, against the SDK.
   From xnu (bsd/sys/fcntl.h, bsd/sys/stat.h, bsd/sys/signal.h, bsd/sys/sysctl.h, bsd/sys/mman.h),
   libpthread (pthread.h) and libkern (OSCacheControl.h). */
#include <pthread.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>

typedef struct fsignatures {
	off_t           fs_file_start;
	void            *fs_blob_start;
	size_t          fs_blob_size;
	size_t          fs_fsignatures_size;
	char            fs_cdhash[20];
	int             fs_hash_type;
} fsignatures_t;
#define F_ADDFILESIGS_RETURN 97

/* struct stat of macOS has st_atimespec, st_mtimespec, st_ctimespec. */
#define st_atimespec st_atim
#define st_mtimespec st_mtim
#define st_ctimespec st_ctim

/* Signals that BSD has and Linux does not. */
#define SIGEMT 7
#define SIGINFO 29

int sysctlbyname(const char *, void *, size_t *, void *, size_t);

/* The stack of a thread that the image adopts. */
void *pthread_get_stackaddr_np(pthread_t);
size_t pthread_get_stacksize_np(pthread_t);

/* Memory that code is written to, on Apple Silicon. */
#define MAP_JIT 0x0800
void pthread_jit_write_protect_np(int);
void sys_icache_invalidate(void *, size_t);
