/* For the Linux test host (host/host_posix.c includes this file where it finds it): a stand-in
   for the library "libSystem" of macOS, handed out with BUN_HOST_TEST=libsystem.

   The portable image has bun's code for macOS, and that code calls functions of macOS, with the
   arguments, the structures, the constants and the error numbers of macOS. On a Mac the host
   hands out the functions of macOS themselves. A Linux machine has none of them. The functions
   here take what a function of macOS takes and do the work with the system calls of Linux, so
   bun's code for macOS in the image runs on Linux (BUN_PORTABLE_HOST_OS=darwin makes the image
   take it).

   What macOS is comes from its headers: darwin_facts_<processor>.h, which
   bindings/darwin-headers.ts writes, and not from the definitions that the image has. A number
   that is no number of macOS stops the host with a message and exit code 96: a flag of open as
   Linux has it, the AT_FDCWD of Linux, a command of fcntl that macOS does not have. Finding
   such a number is what this is for.

   BUN_HOST_TEST=libsystem-noclone is the same on a file system that does not clone (one that is
   not APFS): clonefile, clonefileat and fclonefileat fail with ENOTSUP. With
   BUN_HOST_TEST_NOCLONE_UNDER=<directory> they fail so for a copy that is to be made under
   that directory, which stands for a volume of such a file system.

   A function of macOS that the image binds and that has no stand-in here has an address all the
   same, so that the image can bind every function it names (--imports): darwin_exports_<processor>.h
   has the names, from the list of what libSystem exports. Calling one stops the host.

   This is a test double and not macOS. It shows that the image hands macOS what macOS expects,
   and that it reads what macOS hands back where macOS puts it. What macOS answers is for a Mac
   to say. */
#if defined(__x86_64__)
#include "darwin_exports_x86_64.h"
#include "darwin_facts_x86_64.h"
#else
#include "darwin_exports_aarch64.h"
#include "darwin_facts_aarch64.h"
#endif

static int test_libsystem, test_libsystem_noclone;
static char noclone_under[4096];

/* A function that the image calls. On the arm64 test host x18 is the register that the image
   reads its thread pointer through, and the code of this host may overwrite it (see "x18" in
   host/host_posix.c): the image gets the address of an entry that keeps it. macOS never
   writes x18. */
#define D_FUNCTION __attribute__((used)) static
static __thread int d_errno;

__attribute__((noreturn, format(printf, 1, 2))) static void d_not_macos(const char *format, ...) {
  char line[600];
  int at = snprintf(line, sizeof line, "libsystem stand-in: ");
  va_list ap;
  va_start(ap, format);
  int n = vsnprintf(line + at, sizeof line - (size_t)at - 1, format, ap);
  va_end(ap);
  if (n > (int)sizeof line - at - 2) n = (int)sizeof line - at - 2;
  line[at + n] = '\n';
  if (write(2, line, (size_t)(at + n + 1)) < 0) _exit(96);
  _exit(96);
}

/* The error number of macOS for an error number of Linux, by the name. */
static int d_errno_of(int e) {
  switch (e) {
#define E(x) case x: return D_##x;
    E(EPERM) E(ENOENT) E(ESRCH) E(EINTR) E(EIO) E(ENXIO) E(E2BIG) E(ENOEXEC) E(EBADF) E(ECHILD) E(EAGAIN) E(ENOMEM)
    E(EACCES) E(EFAULT) E(ENOTBLK) E(EBUSY) E(EEXIST) E(EXDEV) E(ENODEV) E(ENOTDIR) E(EISDIR) E(EINVAL) E(ENFILE)
    E(EMFILE) E(ENOTTY) E(ETXTBSY) E(EFBIG) E(ENOSPC) E(ESPIPE) E(EROFS) E(EMLINK) E(EPIPE) E(EDOM) E(ERANGE)
    E(EDEADLK) E(ENAMETOOLONG) E(ENOLCK) E(ENOSYS) E(ENOTEMPTY) E(ELOOP) E(ENOMSG) E(EIDRM) E(ENOSTR) E(ENODATA)
    E(ETIME) E(ENOSR) E(EREMOTE) E(ENOLINK) E(EPROTO) E(EMULTIHOP) E(EBADMSG) E(EOVERFLOW) E(EILSEQ) E(EUSERS)
    E(ENOTSOCK) E(EDESTADDRREQ) E(EMSGSIZE) E(EPROTOTYPE) E(ENOPROTOOPT) E(EPROTONOSUPPORT) E(ESOCKTNOSUPPORT)
    E(EPFNOSUPPORT) E(EAFNOSUPPORT) E(EADDRINUSE) E(EADDRNOTAVAIL) E(ENETDOWN) E(ENETUNREACH)
    E(ENETRESET) E(ECONNABORTED) E(ECONNRESET) E(ENOBUFS) E(EISCONN) E(ENOTCONN) E(ESHUTDOWN) E(ETOOMANYREFS)
    E(ETIMEDOUT) E(ECONNREFUSED) E(EHOSTDOWN) E(EHOSTUNREACH) E(EALREADY) E(EINPROGRESS) E(ESTALE) E(EDQUOT)
    E(ECANCELED) E(EOWNERDEAD) E(ENOTRECOVERABLE)
#undef E
    /* One number on Linux, two on macOS: the file system functions of macOS answer ENOTSUP. */
    case ENOTSUP: return D_ENOTSUP;
    default: return D_EIO;
  }
}
static long d_ret(long r) {
  if (r < 0) d_errno = d_errno_of(errno);
  return r;
}
static long d_fail(int error_of_macos) {
  d_errno = error_of_macos;
  return -1;
}
D_FUNCTION int *d_error(void) { return &d_errno; }

D_FUNCTION void d_no_stand_in(void) { d_not_macos("the image called a function of macOS that has no stand-in here (BUN_HOST_TRACE=2 shows which it bound last)"); }

/* ---- what has nothing to translate ---- */
D_FUNCTION size_t d_strlen(const char *text) { return strlen(text); }
D_FUNCTION int d_getpid(void) { return (int)getpid(); }
D_FUNCTION void d_memset_pattern(void *to, const void *pattern, size_t length, size_t of) {
  for (size_t at = 0; at < length; at += of) memcpy((char *)to + at, pattern, length - at < of ? length - at : of);
}
D_FUNCTION void d_memset_pattern4(void *to, const void *pattern, size_t length) { d_memset_pattern(to, pattern, length, 4); }
D_FUNCTION void d_memset_pattern8(void *to, const void *pattern, size_t length) { d_memset_pattern(to, pattern, length, 8); }
D_FUNCTION void d_memset_pattern16(void *to, const void *pattern, size_t length) { d_memset_pattern(to, pattern, length, 16); }

/* ---- what arrives, in the numbers of macOS ---- */
static int l_dirfd(int fd, const char *function) {
  if (fd == D_AT_FDCWD) return AT_FDCWD;
  if (fd == AT_FDCWD) d_not_macos("%s: the directory is %d, the AT_FDCWD of Linux. macOS has %d", function, fd, D_AT_FDCWD);
  return fd;
}
static int l_open_flags(int d, const char *function) {
  const int known = D_O_ACCMODE | D_O_NONBLOCK | D_O_APPEND | D_O_SHLOCK | D_O_EXLOCK | D_O_ASYNC | D_O_SYNC | D_O_NOFOLLOW | D_O_CREAT |
                    D_O_TRUNC | D_O_EXCL | D_O_EVTONLY | D_O_NOCTTY | D_O_DIRECTORY | D_O_SYMLINK | D_O_DSYNC | D_O_CLOEXEC | D_O_NOFOLLOW_ANY;
  if (d & ~known) d_not_macos("%s: the flags %#x have bits that are no flags of open on macOS: %#x", function, d, d & ~known);
  if ((d & D_O_ACCMODE) == 3) d_not_macos("%s: the flags %#x ask for neither reading nor writing", function, d);
  int l = d & D_O_ACCMODE;
  if (d & D_O_NONBLOCK) l |= O_NONBLOCK;
  if (d & D_O_APPEND) l |= O_APPEND;
  if (d & D_O_SYNC) l |= O_SYNC;
  if (d & D_O_NOFOLLOW) l |= O_NOFOLLOW;
  if (d & D_O_CREAT) l |= O_CREAT;
  if (d & D_O_TRUNC) l |= O_TRUNC;
  if (d & D_O_EXCL) l |= O_EXCL;
  if (d & D_O_NOCTTY) l |= O_NOCTTY;
  if (d & D_O_DIRECTORY) l |= O_DIRECTORY;
  if (d & D_O_DSYNC) l |= O_DSYNC;
  if (d & D_O_CLOEXEC) l |= O_CLOEXEC;
  /* The link itself, and a descriptor that is for notifications only: the nearest that Linux has. */
  if (d & D_O_SYMLINK) l |= O_PATH | O_NOFOLLOW;
  if (d & D_O_EVTONLY) l |= O_PATH;
  return l;
}
static int d_status_flags(int l) {
  int d = l & O_ACCMODE;
  if (l & O_NONBLOCK) d |= D_O_NONBLOCK;
  if (l & O_APPEND) d |= D_O_APPEND;
  if ((l & O_SYNC) == O_SYNC) d |= D_O_SYNC;
  else if (l & O_DSYNC) d |= D_O_DSYNC;
  return d;
}
static int l_at_flags(int d, int allowed, const char *function) {
  if (d & ~allowed) d_not_macos("%s: the flags %#x have bits that this function of macOS does not take: %#x", function, d, d & ~allowed);
  return (d & D_AT_SYMLINK_NOFOLLOW ? AT_SYMLINK_NOFOLLOW : 0) | (d & D_AT_SYMLINK_FOLLOW ? AT_SYMLINK_FOLLOW : 0) |
         (d & D_AT_REMOVEDIR ? AT_REMOVEDIR : 0) | (d & D_AT_EACCESS ? AT_EACCESS : 0);
}
static void l_mode(long mode, const char *function) {
  if (mode & ~07777l) d_not_macos("%s: the mode %#lx has bits above the permissions", function, mode);
}

/* ---- struct stat of macOS ---- */
static void d_put(void *base, size_t offset, size_t size, uint64_t value) { memcpy((char *)base + offset, &value, size); }
#define D_PUT(type, field, base, value) d_put(base, D_OFFSET_##type##__##field, D_FIELD_SIZE_##type##__##field, (uint64_t)(value))
static long d_stat_at(int dirfd, const char *path, int flags, void *out) {
  struct statx s;
  if (statx(dirfd, path, flags, STATX_BASIC_STATS | STATX_BTIME, &s)) return d_ret(-1);
  memset(out, 0, D_SIZE_stat);
  D_PUT(stat, st_dev, out, (s.stx_dev_major << 24) | (s.stx_dev_minor & 0xffffff));
  D_PUT(stat, st_mode, out, s.stx_mode);
  D_PUT(stat, st_nlink, out, s.stx_nlink);
  D_PUT(stat, st_ino, out, s.stx_ino);
  D_PUT(stat, st_uid, out, s.stx_uid);
  D_PUT(stat, st_gid, out, s.stx_gid);
  D_PUT(stat, st_rdev, out, (s.stx_rdev_major << 24) | (s.stx_rdev_minor & 0xffffff));
  D_PUT(stat, st_atime, out, s.stx_atime.tv_sec);
  D_PUT(stat, st_atime_nsec, out, s.stx_atime.tv_nsec);
  D_PUT(stat, st_mtime, out, s.stx_mtime.tv_sec);
  D_PUT(stat, st_mtime_nsec, out, s.stx_mtime.tv_nsec);
  D_PUT(stat, st_ctime, out, s.stx_ctime.tv_sec);
  D_PUT(stat, st_ctime_nsec, out, s.stx_ctime.tv_nsec);
  /* A file system of Linux that keeps no time of birth: the file is as old as its last change. */
  struct statx_timestamp born = s.stx_mask & STATX_BTIME ? s.stx_btime : s.stx_mtime;
  D_PUT(stat, st_birthtime, out, born.tv_sec);
  D_PUT(stat, st_birthtime_nsec, out, born.tv_nsec);
  D_PUT(stat, st_size, out, s.stx_size);
  D_PUT(stat, st_blocks, out, s.stx_blocks);
  D_PUT(stat, st_blksize, out, s.stx_blksize);
  return 0;
}
D_FUNCTION int d_stat(const char *path, void *out) { return (int)d_stat_at(AT_FDCWD, path, 0, out); }
D_FUNCTION int d_lstat(const char *path, void *out) { return (int)d_stat_at(AT_FDCWD, path, AT_SYMLINK_NOFOLLOW, out); }
D_FUNCTION int d_fstat(int fd, void *out) { return (int)d_stat_at(fd, "", AT_EMPTY_PATH, out); }
D_FUNCTION int d_fstatat(int dirfd, const char *path, void *out, int flags) {
  return (int)d_stat_at(l_dirfd(dirfd, "fstatat"), path, l_at_flags(flags, D_AT_SYMLINK_NOFOLLOW, "fstatat"), out);
}

/* ---- files ---- */
D_FUNCTION int d_open(const char *path, int flags, int mode) {
  l_mode(mode, "open");
  return (int)d_ret(open(path, l_open_flags(flags, "open"), (mode_t)mode));
}
D_FUNCTION int d_openat(int dirfd, const char *path, int flags, int mode) {
  l_mode(mode, "openat");
  return (int)d_ret(openat(l_dirfd(dirfd, "openat"), path, l_open_flags(flags, "openat"), (mode_t)mode));
}
D_FUNCTION ssize_t d_read(int fd, void *buffer, size_t count) { return d_ret(read(fd, buffer, count)); }
D_FUNCTION ssize_t d_write(int fd, const void *buffer, size_t count) { return d_ret(write(fd, buffer, count)); }
D_FUNCTION ssize_t d_pread(int fd, void *buffer, size_t count, int64_t offset) { return d_ret(pread(fd, buffer, count, (off_t)offset)); }
D_FUNCTION ssize_t d_pwrite(int fd, const void *buffer, size_t count, int64_t offset) { return d_ret(pwrite(fd, buffer, count, (off_t)offset)); }
D_FUNCTION ssize_t d_readv(int fd, const struct iovec *parts, int count) { return d_ret(readv(fd, parts, count)); }
D_FUNCTION ssize_t d_writev(int fd, const struct iovec *parts, int count) { return d_ret(writev(fd, parts, count)); }
D_FUNCTION int d_close(int fd) { return (int)d_ret(close(fd)); }
D_FUNCTION int d_fsync(int fd) { return (int)d_ret(fsync(fd)); }
D_FUNCTION int d_ftruncate(int fd, int64_t length) { return (int)d_ret(ftruncate(fd, (off_t)length)); }
D_FUNCTION int d_truncate(const char *path, int64_t length) { return (int)d_ret(truncate(path, (off_t)length)); }
/* The mode is an integer of 16 bits on macOS, and the caller extends it to 32. */
D_FUNCTION int d_fchmod(int fd, unsigned mode) {
  l_mode(mode, "fchmod");
  return (int)d_ret(fchmod(fd, (mode_t)mode));
}
D_FUNCTION int d_lchmod(const char *path, unsigned mode) {
  l_mode(mode, "lchmod");
  struct stat s;
  if (lstat(path, &s)) return (int)d_ret(-1);
  /* Linux has no permissions of a link to change. */
  if (S_ISLNK(s.st_mode)) return 0;
  return (int)d_ret(chmod(path, (mode_t)mode));
}
D_FUNCTION int d_mkdirat(int dirfd, const char *path, unsigned mode) {
  l_mode(mode, "mkdirat");
  return (int)d_ret(mkdirat(l_dirfd(dirfd, "mkdirat"), path, (mode_t)mode));
}
D_FUNCTION int d_unlinkat(int dirfd, const char *path, int flags) {
  long r = unlinkat(l_dirfd(dirfd, "unlinkat"), path, l_at_flags(flags, D_AT_REMOVEDIR, "unlinkat"));
  /* macOS refuses to unlink a directory with EPERM, Linux with EISDIR. */
  if (r < 0 && errno == EISDIR) return (int)d_fail(D_EPERM);
  return (int)d_ret(r);
}
D_FUNCTION int d_faccessat(int dirfd, const char *path, int mode, int flags) {
  if (mode & ~(D_R_OK | D_W_OK | D_X_OK)) d_not_macos("faccessat: the mode %#x", mode);
  return (int)d_ret(faccessat(l_dirfd(dirfd, "faccessat"), path, mode, l_at_flags(flags, D_AT_EACCESS | D_AT_SYMLINK_NOFOLLOW, "faccessat")));
}
D_FUNCTION int d_renameatx_np(int from_fd, const char *from, int to_fd, const char *to, unsigned flags) {
  if (flags & ~(unsigned)(D_RENAME_SWAP | D_RENAME_EXCL)) d_not_macos("renameatx_np: the flags %#x", flags);
  unsigned l = (flags & D_RENAME_SWAP ? 2u /* RENAME_EXCHANGE */ : 0) | (flags & D_RENAME_EXCL ? 1u /* RENAME_NOREPLACE */ : 0);
  return (int)d_ret(syscall(SYS_renameat2, l_dirfd(from_fd, "renameatx_np"), from, l_dirfd(to_fd, "renameatx_np"), to, l));
}
D_FUNCTION char *d_realpath(const char *path, char *resolved) {
  char whole[4096];
  if (!resolved) d_not_macos("realpath: no buffer for the result (bun hands one)");
  if (!realpath(path, whole)) {
    d_errno = d_errno_of(errno);
    return 0;
  }
  size_t length = strlen(whole);
  if (length >= D_PATH_MAX) {
    d_errno = D_ENAMETOOLONG;
    return 0;
  }
  memcpy(resolved, whole, length + 1);
  return resolved;
}

/* ---- fcntl, with the commands of macOS ---- */
D_FUNCTION int d_fcntl(int fd, int command, long argument) {
  switch (command) {
    case D_F_DUPFD: return (int)d_ret(fcntl(fd, F_DUPFD, (int)argument));
    case D_F_DUPFD_CLOEXEC: return (int)d_ret(fcntl(fd, F_DUPFD_CLOEXEC, (int)argument));
    case D_F_GETFD: return (int)d_ret(fcntl(fd, F_GETFD));
    case D_F_SETFD:
      if (argument & ~1l) d_not_macos("fcntl(F_SETFD): the flags %#lx", argument);
      return (int)d_ret(fcntl(fd, F_SETFD, (int)argument));
    case D_F_GETFL: {
      int l = fcntl(fd, F_GETFL);
      return l < 0 ? (int)d_ret(-1) : d_status_flags(l);
    }
    case D_F_SETFL: return (int)d_ret(fcntl(fd, F_SETFL, l_open_flags((int)argument, "fcntl(F_SETFL)") & (O_APPEND | O_NONBLOCK)));
    case D_F_GETPATH:
    case D_F_GETPATH_NOFIRMLINK: {
      char link[64], path[4096];
      if (fcntl(fd, F_GETFD) < 0) return (int)d_ret(-1);
      snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
      ssize_t length = readlink(link, path, sizeof path - 1);
      if (length < 0) return (int)d_ret(-1);
      if (length >= D_MAXPATHLEN) return (int)d_fail(D_ENOSPC);
      memcpy((char *)argument, path, (size_t)length);
      ((char *)argument)[length] = 0;
      return 0;
    }
    case D_F_NOCACHE:
    case D_F_RDAHEAD:
      return fcntl(fd, F_GETFD) < 0 ? (int)d_ret(-1) : 0;
    case D_F_FULLFSYNC:
    case D_F_BARRIERFSYNC:
      return (int)d_ret(fsync(fd));
    case D_F_PREALLOCATE: {
      /* fstore_t: the length that is asked for, and the bytes that were set aside. */
      char *store = (char *)argument;
      int64_t length;
      memcpy(&length, store + D_OFFSET_fstore_t__fst_length, sizeof length);
      if (fcntl(fd, F_GETFD) < 0) return (int)d_ret(-1);
      d_put(store, D_OFFSET_fstore_t__fst_bytesalloc, D_FIELD_SIZE_fstore_t__fst_bytesalloc, (uint64_t)length);
      return 0;
    }
    default:
      d_not_macos("fcntl: the command %d, which is no command of macOS that this stand-in knows", command);
  }
}

/* ---- copies ---- */
static long copy_bytes(int from, int to) {
  char buffer[65536];
  for (;;) {
    ssize_t got = read(from, buffer, sizeof buffer);
    if (got < 0) return -1;
    if (!got) return 0;
    for (ssize_t done = 0; done < got;) {
      ssize_t put = write(to, buffer + done, (size_t)(got - done));
      if (put < 0) return -1;
      done += put;
    }
  }
}
/* Whether the file is to be made on what stands for a volume that does not clone. */
static int on_a_volume_that_does_not_clone(int dirfd, const char *path) {
  char whole[8192], directory[4096];
  if (test_libsystem_noclone) return 1;
  if (!*noclone_under) return 0;
  if (*path == '/') snprintf(whole, sizeof whole, "%s", path);
  else {
    ssize_t length;
    if (dirfd == AT_FDCWD) length = getcwd(directory, sizeof directory) ? (ssize_t)strlen(directory) : -1;
    else {
      char link[64];
      snprintf(link, sizeof link, "/proc/self/fd/%d", dirfd);
      length = readlink(link, directory, sizeof directory - 1);
    }
    if (length < 0) return 0;
    directory[length] = 0;
    snprintf(whole, sizeof whole, "%s/%s", directory, path);
  }
  size_t prefix = strlen(noclone_under);
  return !strncmp(whole, noclone_under, prefix) && (whole[prefix] == '/' || !whole[prefix]);
}
/* A clone of the open file `from`. The file system of Linux may not clone (ioctl FICLONE): then the
   bytes are copied, which gives a file that reads the same. */
static int d_clone_to(int from, int to_dirfd, const char *to, unsigned flags, const char *function) {
  if (flags & ~7u) d_not_macos("%s: the flags %#x", function, flags);
  struct stat s;
  if (fstat(from, &s)) return (int)d_ret(-1);
  if (on_a_volume_that_does_not_clone(to_dirfd, to)) return (int)d_fail(D_ENOTSUP);
  if (!S_ISREG(s.st_mode)) return (int)d_fail(D_ENOTSUP);
  int out = openat(to_dirfd, to, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, s.st_mode & 07777);
  if (out < 0) return (int)d_ret(-1);
  long r = ioctl(out, 0x40049409ul /* FICLONE */, from);
  if (r < 0) r = lseek(from, 0, SEEK_SET) < 0 ? -1 : copy_bytes(from, out);
  int e = errno;
  close(out);
  if (r < 0) {
    unlinkat(to_dirfd, to, 0);
    errno = e;
    return (int)d_ret(-1);
  }
  return 0;
}
D_FUNCTION int d_clonefileat(int from_dirfd, const char *from, int to_dirfd, const char *to, unsigned flags) {
  int in = openat(l_dirfd(from_dirfd, "clonefileat"), from, O_RDONLY | O_CLOEXEC | (flags & 1 ? O_NOFOLLOW : 0));
  if (in < 0) return (int)d_ret(-1);
  int r = d_clone_to(in, l_dirfd(to_dirfd, "clonefileat"), to, flags, "clonefileat");
  close(in);
  return r;
}
D_FUNCTION int d_clonefile(const char *from, const char *to, unsigned flags) { return d_clonefileat(D_AT_FDCWD, from, D_AT_FDCWD, to, flags); }
D_FUNCTION int d_fclonefileat(int from, int to_dirfd, const char *to, unsigned flags) {
  int in = dup(from);
  if (in < 0) return (int)d_ret(-1);
  int r = d_clone_to(in, l_dirfd(to_dirfd, "fclonefileat"), to, flags, "fclonefileat");
  close(in);
  return r;
}
D_FUNCTION int d_fcopyfile(int from, int to, void *state, unsigned flags) {
  const unsigned known = D_COPYFILE_ACL | D_COPYFILE_STAT | D_COPYFILE_XATTR | D_COPYFILE_DATA;
  if (state) d_not_macos("fcopyfile: a state, which this stand-in does not have");
  if (flags & ~known) d_not_macos("fcopyfile: the flags %#x", flags);
  if (flags & D_COPYFILE_STAT) {
    struct stat s;
    if (fstat(from, &s) || fchmod(to, s.st_mode & 07777)) return (int)d_ret(-1);
  }
  if (flags & D_COPYFILE_DATA) return (int)d_ret(copy_bytes(from, to));
  return 0;
}
D_FUNCTION int d_copyfile(const char *from, const char *to, void *state, unsigned flags) {
  const unsigned known = D_COPYFILE_ACL | D_COPYFILE_STAT | D_COPYFILE_XATTR | D_COPYFILE_DATA | D_COPYFILE_EXCL | D_COPYFILE_CLONE | D_COPYFILE_NOFOLLOW;
  if (state) d_not_macos("copyfile: a state, which this stand-in does not have");
  if (flags & ~known) d_not_macos("copyfile: the flags %#x", flags);
  int in = open(from, O_RDONLY | O_CLOEXEC);
  if (in < 0) return (int)d_ret(-1);
  struct stat s;
  if (fstat(in, &s)) {
    int e = errno;
    close(in);
    errno = e;
    return (int)d_ret(-1);
  }
  int out = open(to, O_WRONLY | O_CREAT | O_CLOEXEC | (flags & D_COPYFILE_EXCL ? O_EXCL : O_TRUNC), s.st_mode & 07777);
  if (out < 0) {
    int e = errno;
    close(in);
    errno = e;
    return (int)d_ret(-1);
  }
  long r = flags & D_COPYFILE_DATA ? copy_bytes(in, out) : 0;
  int e = errno;
  close(in);
  close(out);
  errno = e;
  return (int)d_ret(r);
}

/* ---- the entries of a directory, as macOS hands them out ---- */
D_FUNCTION ssize_t d_getdirentries64(int fd, void *buffer, size_t size, int64_t *position) {
  ssize_t k = mac_dirents(fd, buffer, size);
  if (k < 0) return d_ret(-1);
  off_t here = lseek(fd, 0, SEEK_CUR);
  if (position) *position = (int64_t)here;
  /* A buffer of 1024 bytes and more has, in its last 4 bytes, whether that was the end. */
  if (size >= 1024 && (size_t)k <= size - 4) {
    unsigned char more[1024];
    uint32_t end = syscall(SYS_getdents64, fd, more, sizeof more) == 0;
    if (!end) lseek(fd, here, SEEK_SET);
    memcpy((char *)buffer + size - 4, &end, 4);
  }
  return k;
}

#define D_FUNCTIONS(F) \
  F(d_no_stand_in) F(d_strlen) F(d_getpid) F(d_memset_pattern4) F(d_memset_pattern8) F(d_memset_pattern16) \
  F(d_error) F(d_open) F(d_openat) F(d_fcntl) F(d_read) F(d_write) F(d_pread) F(d_pwrite) F(d_readv) \
  F(d_writev) F(d_close) F(d_fsync) F(d_ftruncate) F(d_truncate) F(d_fchmod) F(d_lchmod) F(d_stat) \
  F(d_lstat) F(d_fstat) F(d_fstatat) F(d_mkdirat) F(d_unlinkat) F(d_faccessat) F(d_renameatx_np) \
  F(d_realpath) F(d_clonefile) F(d_clonefileat) F(d_fclonefileat) F(d_copyfile) F(d_fcopyfile) \
  F(d_getdirentries64)
#if X18_HOST
D_FUNCTIONS(IMAGE_ENTRY)
#define D(function) (void *)function##_entry
#else
#define D(function) (void *)function
#endif

static void *libsystem_on_linux(const char *symbol) {
  static const struct { const char *name; void *address; } functions[] = {
    {"__error", D(d_error)}, {"strlen", D(d_strlen)}, {"getpid", D(d_getpid)},
    {"memset_pattern4", D(d_memset_pattern4)}, {"memset_pattern8", D(d_memset_pattern8)}, {"memset_pattern16", D(d_memset_pattern16)},
    {"bun_host_darwin_open3", D(d_open)}, {"bun_host_darwin_open_nocancel3", D(d_open)},
    {"bun_host_darwin_openat4", D(d_openat)}, {"bun_host_darwin_openat_nocancel4", D(d_openat)},
    {"bun_host_darwin_fcntl3", D(d_fcntl)}, {"bun_host_darwin_fcntl_nocancel3", D(d_fcntl)},
    {"read", D(d_read)}, {"read$NOCANCEL", D(d_read)}, {"write", D(d_write)}, {"write$NOCANCEL", D(d_write)},
    {"pread", D(d_pread)}, {"pread$NOCANCEL", D(d_pread)}, {"pwrite", D(d_pwrite)}, {"pwrite$NOCANCEL", D(d_pwrite)},
    {"readv$NOCANCEL", D(d_readv)}, {"writev$NOCANCEL", D(d_writev)},
    {"close", D(d_close)}, {"close$NOCANCEL", D(d_close)}, {"fsync", D(d_fsync)},
    {"ftruncate", D(d_ftruncate)}, {"truncate", D(d_truncate)}, {"fchmod", D(d_fchmod)}, {"lchmod", D(d_lchmod)},
#if defined(__x86_64__)
    {"stat$INODE64", D(d_stat)}, {"lstat$INODE64", D(d_lstat)}, {"fstat$INODE64", D(d_fstat)}, {"fstatat$INODE64", D(d_fstatat)},
#else
    {"stat", D(d_stat)}, {"lstat", D(d_lstat)}, {"fstat", D(d_fstat)}, {"fstatat", D(d_fstatat)},
#endif
    {"mkdirat", D(d_mkdirat)}, {"unlinkat", D(d_unlinkat)}, {"faccessat", D(d_faccessat)}, {"renameatx_np", D(d_renameatx_np)},
    {"realpath$DARWIN_EXTSN", D(d_realpath)},
    {"clonefile", D(d_clonefile)}, {"clonefileat", D(d_clonefileat)}, {"fclonefileat", D(d_fclonefileat)},
    {"copyfile", D(d_copyfile)}, {"fcopyfile", D(d_fcopyfile)}, {"__getdirentries64", D(d_getdirentries64)},
  };
  for (size_t i = 0; i < sizeof functions / sizeof *functions; i++)
    if (!strcmp(symbol, functions[i].name)) return functions[i].address;
  for (size_t i = 0; i < sizeof d_exported / sizeof *d_exported; i++)
    if (!strcmp(symbol, d_exported[i])) return D(d_no_stand_in);
  return 0;
}
