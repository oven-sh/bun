/* For a check of the syntax and the types of host_posix.c for macOS on a machine that has no SDK of
   macOS (host/check.ts): the declarations of macOS that host_posix.c uses and that the headers of the
   check, the ones of musl, do not have. From xnu bsd/sys/fcntl.h and libpthread pthread.h. */
#include <pthread.h>
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
void *pthread_get_stackaddr_np(pthread_t);
size_t pthread_get_stacksize_np(pthread_t);
