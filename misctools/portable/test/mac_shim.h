/* Syntax check only: the few macOS declarations that host_posix.c uses and
   that the musl headers do not have. Copied from xnu bsd/sys/fcntl.h. */
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
