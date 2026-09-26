/* For test/check-macos-host.ts, which compiles the branches of host/host_posix.c for macOS on a
   machine that has no headers of macOS: what those branches use of macOS and the headers of the
   libc of the image (musl, for Linux) do not have. Declarations and numbers are the ones of xnu
   (bsd/sys/errno.h, mount.h, stdio.h, fcntl.h, signal.h, stat.h). This checks that the host is C
   that a compiler takes, with these types. It does not check the host against macOS. */
#include <stdint.h>
#include <sys/types.h>

#define ENOATTR 93
#define EFTYPE 79
#define EAUTH 80
#define ENEEDAUTH 81
#define EPROCLIM 67
#define EBADRPC 72
#define ERPCMISMATCH 73
#define EPROGUNAVAIL 74
#define EPROGMISMATCH 75
#define EPROCUNAVAIL 76
#define EPWROFF 82
#define EDEVERR 83
#define EBADEXEC 85
#define EBADARCH 86
#define ESHLIBVERS 87
#define EBADMACHO 88
#define ENOPOLICY 103
#define EQFULL 106

#define SIGEMT 7
#define SIGINFO 29

typedef struct fsignatures {
  off_t fs_file_start;
  void *fs_blob_start;
  size_t fs_blob_size;
  size_t fs_fsignatures_size;
  char fs_cdhash[20];
  int fs_hash_type;
} fsignatures_t;
#define F_ADDFILESIGS_RETURN 97

/* struct stat of macOS names its times st_atimespec, and has the time of birth. */
#define st_atimespec st_atim
#define st_mtimespec st_mtim
#define st_ctimespec st_ctim
#define st_birthtimespec st_ctim

#define MFSTYPENAMELEN 16
#define MNT_RDONLY 0x00000001
#define MNT_SYNCHRONOUS 0x00000002
#define MNT_NOEXEC 0x00000004
#define MNT_NOSUID 0x00000008
#define MNT_NODEV 0x00000010
#define MNT_NOATIME 0x10000000
struct statfs {
  uint32_t f_bsize;
  int32_t f_iosize;
  uint64_t f_blocks, f_bfree, f_bavail, f_files, f_ffree;
  struct { int32_t val[2]; } f_fsid;
  uid_t f_owner;
  uint32_t f_type, f_flags, f_fssubtype;
  char f_fstypename[MFSTYPENAMELEN];
  char f_mntonname[1024], f_mntfromname[1024];
  uint32_t f_flags_ext, f_reserved[7];
};
int statfs(const char *, struct statfs *);
int fstatfs(int, struct statfs *);

#define RENAME_SWAP 0x00000002
#define RENAME_EXCL 0x00000004
int renameatx_np(int, const char *, int, const char *, unsigned int);

int sysctlbyname(const char *, void *, size_t *, void *, size_t);
