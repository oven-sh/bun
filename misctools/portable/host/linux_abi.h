// The Linux ABI as the image sees it: request numbers, constants and the layout
// of every structure that crosses the host table. Both hosts include this file.
//
// Nothing here comes from a header of the host system. The image was compiled
// against the Linux headers of its libc, the host is compiled against whatever
// its own system has (glibc, the macOS SDK, the Windows SDK), and the two agree
// only where this file says so. Every structure has fields of explicit size,
// and its size is checked at compile time.
#ifndef BUN_HOST_LINUX_ABI_H
#define BUN_HOST_LINUX_ABI_H

#include <stddef.h>
#include <stdint.h>

#define AT_BUN_HOST 0x62756e00
/* Requests of the image that are not Linux syscalls. They arrive through the
   syscall entry of the host table like the others.
   N_set_tp(tp)               make tp the thread pointer of this thread (aarch64 images.
                              x86-64 images send arch_prctl(ARCH_SET_FS))
   N_main_stack(uint64_t[2])  the stack that the host made for the main thread: its lowest
                              address, and the address after its highest */
#define N_set_tp 0x62756e01
#define N_main_stack 0x62756e02

#define BUN_OS_LINUX 1
#define BUN_OS_WINDOWS 2
#define BUN_OS_MACOS 3

/* ---- request numbers. One that an architecture does not have is negative: it never arrives. ---- */
#if defined(__x86_64__) || defined(_M_X64)
#define L_ARCH_X86_64 1
enum {
  N_read = 0, N_write = 1, N_open = 2, N_close = 3, N_stat = 4, N_fstat = 5, N_lstat = 6, N_poll = 7, N_lseek = 8,
  N_mmap = 9, N_mprotect = 10, N_munmap = 11, N_brk = 12, N_rt_sigaction = 13, N_rt_sigprocmask = 14,
  N_rt_sigreturn = 15, N_ioctl = 16, N_pread64 = 17, N_pwrite64 = 18, N_readv = 19, N_writev = 20, N_access = 21,
  N_pipe = 22, N_sched_yield = 24, N_mremap = 25, N_madvise = 28, N_dup = 32, N_dup2 = 33, N_nanosleep = 35,
  N_getpid = 39, N_clone = 56, N_fork = 57, N_vfork = 58, N_execve = 59, N_exit = 60, N_wait4 = 61, N_kill = 62,
  N_uname = 63, N_fcntl = 72, N_fsync = 74, N_fdatasync = 75, N_ftruncate = 77, N_getdents = 78, N_getcwd = 79,
  N_chdir = 80, N_rename = 82, N_mkdir = 83, N_rmdir = 84, N_unlink = 87, N_readlink = 89, N_umask = 95,
  N_gettimeofday = 96, N_getrlimit = 97, N_getrusage = 98, N_sysinfo = 99, N_getuid = 102, N_getgid = 104,
  N_geteuid = 107, N_getegid = 108, N_getppid = 110, N_rt_sigpending = 127, N_rt_sigsuspend = 130,
  N_sigaltstack = 131, N_prctl = 157, N_arch_prctl = 158, N_setrlimit = 160, N_gettid = 186, N_tkill = 200,
  N_futex = 202, N_sched_setaffinity = 203, N_sched_getaffinity = 204, N_getdents64 = 217, N_set_tid_address = 218,
  N_clock_gettime = 228, N_clock_getres = 229, N_clock_nanosleep = 230, N_exit_group = 231, N_tgkill = 234,
  N_mbind = 237, N_openat = 257, N_mkdirat = 258, N_newfstatat = 262, N_unlinkat = 263, N_renameat = 264,
  N_readlinkat = 267, N_faccessat = 269, N_set_robust_list = 273, N_dup3 = 292, N_pipe2 = 293, N_prlimit64 = 302,
  N_getcpu = 309, N_sched_setattr = 314, N_sched_getattr = 315, N_getrandom = 318, N_membarrier = 324, N_statx = 332,
  N_faccessat2 = 439,
};
#define L_O_DIRECTORY 0x10000
#define L_O_NOFOLLOW 0x20000
#elif defined(__aarch64__) || defined(_M_ARM64)
#define L_ARCH_AARCH64 1
enum {
  N_getcwd = 17, N_dup = 23, N_dup3 = 24, N_fcntl = 25, N_ioctl = 29, N_mkdirat = 34, N_unlinkat = 35, N_renameat = 38,
  N_ftruncate = 46, N_faccessat = 48, N_chdir = 49, N_openat = 56, N_close = 57, N_pipe2 = 59, N_getdents64 = 61,
  N_lseek = 62, N_read = 63, N_write = 64, N_readv = 65, N_writev = 66, N_pread64 = 67, N_pwrite64 = 68,
  N_readlinkat = 78, N_newfstatat = 79, N_fstat = 80, N_fsync = 82, N_fdatasync = 83, N_exit = 93, N_exit_group = 94,
  N_set_tid_address = 96, N_futex = 98, N_set_robust_list = 99, N_nanosleep = 101, N_clock_gettime = 113,
  N_clock_getres = 114, N_clock_nanosleep = 115, N_sched_setaffinity = 122, N_sched_getaffinity = 123,
  N_sched_yield = 124, N_kill = 129, N_tkill = 130, N_tgkill = 131, N_sigaltstack = 132, N_rt_sigsuspend = 133,
  N_rt_sigaction = 134, N_rt_sigprocmask = 135, N_rt_sigpending = 136, N_rt_sigreturn = 139, N_uname = 160,
  N_getrlimit = 163, N_setrlimit = 164, N_getrusage = 165, N_umask = 166, N_prctl = 167, N_getcpu = 168,
  N_gettimeofday = 169, N_getpid = 172, N_getppid = 173, N_getuid = 174, N_geteuid = 175, N_getgid = 176,
  N_getegid = 177, N_gettid = 178, N_sysinfo = 179, N_brk = 214, N_munmap = 215, N_mremap = 216, N_clone = 220,
  N_execve = 221, N_mmap = 222, N_mprotect = 226, N_madvise = 233, N_mbind = 235, N_wait4 = 260, N_prlimit64 = 261,
  N_sched_setattr = 274, N_sched_getattr = 275, N_getrandom = 278, N_membarrier = 283, N_statx = 291,
  N_faccessat2 = 439,
  N_open = -1, N_access = -2, N_unlink = -3, N_arch_prctl = -4, N_stat = -5, N_lstat = -6, N_poll = -7, N_pipe = -8,
  N_dup2 = -9, N_fork = -10, N_vfork = -11, N_getdents = -12, N_rename = -13, N_mkdir = -14, N_rmdir = -15,
  N_readlink = -16,
};
#define L_O_DIRECTORY 0x4000
#define L_O_NOFOLLOW 0x8000
#else
#error "linux_abi.h: x86-64 or arm64"
#endif

/* ---- errno ---- */
enum {
  L_EPERM = 1, L_ENOENT = 2, L_ESRCH = 3, L_EINTR = 4, L_EIO = 5, L_ENXIO = 6, L_E2BIG = 7, L_ENOEXEC = 8, L_EBADF = 9,
  L_ECHILD = 10, L_EAGAIN = 11, L_ENOMEM = 12, L_EACCES = 13, L_EFAULT = 14, L_ENOTBLK = 15, L_EBUSY = 16,
  L_EEXIST = 17, L_EXDEV = 18, L_ENODEV = 19, L_ENOTDIR = 20, L_EISDIR = 21, L_EINVAL = 22, L_ENFILE = 23,
  L_EMFILE = 24, L_ENOTTY = 25, L_ETXTBSY = 26, L_EFBIG = 27, L_ENOSPC = 28, L_ESPIPE = 29, L_EROFS = 30,
  L_EMLINK = 31, L_EPIPE = 32, L_EDOM = 33, L_ERANGE = 34, L_EDEADLK = 35, L_ENAMETOOLONG = 36, L_ENOLCK = 37,
  L_ENOSYS = 38, L_ENOTEMPTY = 39, L_ELOOP = 40, L_EOVERFLOW = 75, L_ENOTSUP = 95, L_ETIMEDOUT = 110,
};

/* ---- files ---- */
enum {
  L_O_ACCMODE = 3, L_O_CREAT = 0x40, L_O_EXCL = 0x80, L_O_NOCTTY = 0x100, L_O_TRUNC = 0x200, L_O_APPEND = 0x400,
  L_O_NONBLOCK = 0x800, L_O_CLOEXEC = 0x80000,
  L_AT_FDCWD = -100, L_AT_SYMLINK_NOFOLLOW = 0x100, L_AT_REMOVEDIR = 0x200, L_AT_EMPTY_PATH = 0x1000,
  L_F_DUPFD = 0, L_F_GETFD = 1, L_F_SETFD = 2, L_F_GETFL = 3, L_F_SETFL = 4, L_F_DUPFD_CLOEXEC = 1030,
  L_FD_CLOEXEC = 1,
  L_S_IFMT = 0170000, L_S_IFIFO = 0010000, L_S_IFCHR = 0020000, L_S_IFDIR = 0040000, L_S_IFBLK = 0060000,
  L_S_IFREG = 0100000, L_S_IFLNK = 0120000, L_S_IFSOCK = 0140000,
  L_DT_UNKNOWN = 0, L_DT_FIFO = 1, L_DT_CHR = 2, L_DT_DIR = 4, L_DT_BLK = 6, L_DT_REG = 8, L_DT_LNK = 10, L_DT_SOCK = 12,
  L_TCGETS = 0x5401, L_TIOCGWINSZ = 0x5413, L_FIONREAD = 0x541b, L_FIONBIO = 0x5421, L_FIOCLEX = 0x5451,
};

struct l_timespec { int64_t sec, nsec; };
struct l_timeval { int64_t sec, usec; };
struct l_iovec { uint64_t base, len; };
struct l_winsize { uint16_t row, col, xpixel, ypixel; };
struct l_termios { uint32_t iflag, oflag, cflag, lflag; uint8_t line, cc[19]; };

#if defined(L_ARCH_X86_64)
struct l_stat {
  uint64_t dev, ino, nlink;
  uint32_t mode, uid, gid, pad0;
  uint64_t rdev;
  int64_t size, blksize, blocks;
  struct l_timespec atim, mtim, ctim;
  int64_t unused[3];
};
_Static_assert(sizeof(struct l_stat) == 144 && offsetof(struct l_stat, size) == 48, "struct stat of linux x86-64");
#else
struct l_stat {
  uint64_t dev, ino;
  uint32_t mode, nlink, uid, gid;
  uint64_t rdev, pad;
  int64_t size;
  int32_t blksize, pad2;
  int64_t blocks;
  struct l_timespec atim, mtim, ctim;
  uint32_t unused[2];
};
_Static_assert(sizeof(struct l_stat) == 128 && offsetof(struct l_stat, size) == 48, "struct stat of linux aarch64");
#endif

struct l_statx_timestamp { int64_t sec; uint32_t nsec; int32_t pad; };
struct l_statx {
  uint32_t mask, blksize;
  uint64_t attributes;
  uint32_t nlink, uid, gid;
  uint16_t mode, pad0;
  uint64_t ino, size, blocks, attributes_mask;
  struct l_statx_timestamp atime, btime, ctime, mtime;
  uint32_t rdev_major, rdev_minor, dev_major, dev_minor;
  uint64_t spare[14];
};
_Static_assert(sizeof(struct l_statx) == 256, "struct statx");

/* The name follows at offset 19, the record is padded to a multiple of 8. */
struct l_dirent64 { uint64_t ino; int64_t off; uint16_t reclen; uint8_t type; char name[5]; };
_Static_assert(offsetof(struct l_dirent64, name) == 19, "struct linux_dirent64");

/* ---- memory ---- */
enum {
  L_PROT_READ = 1, L_PROT_WRITE = 2, L_PROT_EXEC = 4,
  L_MAP_SHARED = 1, L_MAP_PRIVATE = 2, L_MAP_FIXED = 0x10, L_MAP_ANONYMOUS = 0x20, L_MAP_GROWSDOWN = 0x100,
  L_MAP_NORESERVE = 0x4000, L_MAP_POPULATE = 0x8000, L_MAP_STACK = 0x20000, L_MAP_HUGETLB = 0x40000,
  L_MAP_FIXED_NOREPLACE = 0x100000,
  L_MADV_NORMAL = 0, L_MADV_RANDOM = 1, L_MADV_SEQUENTIAL = 2, L_MADV_WILLNEED = 3, L_MADV_DONTNEED = 4,
  L_MADV_FREE = 8, L_MADV_DONTFORK = 10, L_MADV_DOFORK = 11, L_MADV_HUGEPAGE = 14, L_MADV_NOHUGEPAGE = 15,
  L_MADV_DONTDUMP = 16, L_MADV_DODUMP = 17,
};

/* ---- time, limits, system ---- */
enum {
  L_CLOCK_REALTIME = 0, L_CLOCK_MONOTONIC = 1, L_CLOCK_PROCESS_CPUTIME_ID = 2, L_CLOCK_THREAD_CPUTIME_ID = 3,
  L_CLOCK_MONOTONIC_RAW = 4, L_CLOCK_REALTIME_COARSE = 5, L_CLOCK_MONOTONIC_COARSE = 6, L_CLOCK_BOOTTIME = 7,
  L_RLIMIT_CPU = 0, L_RLIMIT_FSIZE = 1, L_RLIMIT_DATA = 2, L_RLIMIT_STACK = 3, L_RLIMIT_CORE = 4, L_RLIMIT_RSS = 5,
  L_RLIMIT_NPROC = 6, L_RLIMIT_NOFILE = 7, L_RLIMIT_MEMLOCK = 8, L_RLIMIT_AS = 9,
  L_RUSAGE_SELF = 0, L_RUSAGE_CHILDREN = -1, L_RUSAGE_THREAD = 1,
  L_PR_SET_NAME = 15, L_PR_GET_NAME = 16, L_PR_SET_VMA = 0x53564d41,
  L_ARCH_SET_GS = 0x1001, L_ARCH_SET_FS = 0x1002,
  L_FUTEX_WAIT = 0, L_FUTEX_WAKE = 1, L_FUTEX_REQUEUE = 3, L_FUTEX_CMP_REQUEUE = 4, L_FUTEX_WAIT_BITSET = 9,
  L_FUTEX_WAKE_BITSET = 10, L_FUTEX_PRIVATE = 128, L_FUTEX_CLOCK_REALTIME = 256,
  L_CLONE_PARENT_SETTID = 0x100000, L_CLONE_CHILD_CLEARTID = 0x200000,
};
#define L_RLIM_INFINITY (~0ull)

struct l_rlimit { uint64_t cur, max; };
struct l_rusage {
  struct l_timeval utime, stime;
  int64_t maxrss, ixrss, idrss, isrss, minflt, majflt, nswap, inblock, oublock, msgsnd, msgrcv, nsignals, nvcsw, nivcsw;
};
_Static_assert(sizeof(struct l_rusage) == 144, "struct rusage");
/* What the kernel writes: 112 bytes. The libc of the image has a larger structure around it. */
struct l_sysinfo {
  int64_t uptime;
  uint64_t loads[3], totalram, freeram, sharedram, bufferram, totalswap, freeswap;
  uint16_t procs, pad;
  uint32_t pad2;
  uint64_t totalhigh, freehigh;
  uint32_t mem_unit, pad3;
};
_Static_assert(sizeof(struct l_sysinfo) == 112, "struct sysinfo");
struct l_utsname { char sysname[65], nodename[65], release[65], version[65], machine[65], domainname[65]; };

/* ---- signals ---- */
enum {
  L_SIGHUP = 1, L_SIGINT = 2, L_SIGQUIT = 3, L_SIGILL = 4, L_SIGTRAP = 5, L_SIGABRT = 6, L_SIGBUS = 7, L_SIGFPE = 8,
  L_SIGKILL = 9, L_SIGUSR1 = 10, L_SIGSEGV = 11, L_SIGUSR2 = 12, L_SIGPIPE = 13, L_SIGALRM = 14, L_SIGTERM = 15,
  L_SIGSTKFLT = 16, L_SIGCHLD = 17, L_SIGCONT = 18, L_SIGSTOP = 19, L_SIGTSTP = 20, L_SIGTTIN = 21, L_SIGTTOU = 22,
  L_SIGURG = 23, L_SIGXCPU = 24, L_SIGXFSZ = 25, L_SIGVTALRM = 26, L_SIGPROF = 27, L_SIGWINCH = 28, L_SIGIO = 29,
  L_SIGPWR = 30, L_SIGSYS = 31, L_NSIG = 65,
  L_SIG_BLOCK = 0, L_SIG_UNBLOCK = 1, L_SIG_SETMASK = 2,
  L_SA_NOCLDSTOP = 1, L_SA_NOCLDWAIT = 2, L_SA_SIGINFO = 4, L_SA_RESTORER = 0x04000000, L_SA_ONSTACK = 0x08000000,
  L_SA_RESTART = 0x10000000, L_SA_NODEFER = 0x40000000,
  L_SS_ONSTACK = 1, L_SS_DISABLE = 2,
  L_SI_USER = 0, L_SI_KERNEL = 0x80, L_SI_TKILL = -6,
  L_SEGV_MAPERR = 1, L_SEGV_ACCERR = 2, L_BUS_ADRALN = 1, L_BUS_ADRERR = 2, L_BUS_OBJERR = 3,
  L_ILL_ILLOPC = 1, L_ILL_ILLOPN = 2, L_ILL_PRVOPC = 5, L_FPE_INTDIV = 1, L_FPE_INTOVF = 2, L_FPE_FLTDIV = 3,
  L_FPE_FLTOVF = 4, L_FPE_FLTUND = 5, L_FPE_FLTRES = 6, L_FPE_FLTINV = 7, L_TRAP_BRKPT = 1, L_TRAP_TRACE = 2,
};
#define L_SIG_DFL 0ull
#define L_SIG_IGN 1ull
#define L_SA_RESETHAND 0x80000000u

/* The signal set of the kernel: 64 bits, signal n is bit n - 1. */
typedef uint64_t l_sigset;
struct l_stack { uint64_t sp; int32_t flags, pad; uint64_t size; };
_Static_assert(sizeof(struct l_stack) == 24, "stack_t");

struct l_siginfo {
  int32_t signo, err, code, pad;
  union {
    uint8_t bytes[112];
    struct { int32_t pid; uint32_t uid; } kill;                       /* kill, tkill, tgkill */
    struct { uint64_t addr; } fault;                                  /* SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGTRAP */
    struct { int32_t pid; uint32_t uid; int32_t status; } child;      /* SIGCHLD */
  } u;
};
_Static_assert(sizeof(struct l_siginfo) == 128 && offsetof(struct l_siginfo, u) == 16, "siginfo_t");

#if defined(L_ARCH_X86_64)
/* What sigaction() of the libc hands to the kernel on x86-64. */
struct l_k_sigaction { uint64_t handler, flags, restorer; l_sigset mask; };
_Static_assert(sizeof(struct l_k_sigaction) == 32, "struct k_sigaction of linux x86-64");

enum {
  L_REG_R8, L_REG_R9, L_REG_R10, L_REG_R11, L_REG_R12, L_REG_R13, L_REG_R14, L_REG_R15, L_REG_RDI, L_REG_RSI,
  L_REG_RBP, L_REG_RBX, L_REG_RDX, L_REG_RAX, L_REG_RCX, L_REG_RSP, L_REG_RIP, L_REG_EFL, L_REG_CSGSFS,
  L_REG_ERR, L_REG_TRAPNO, L_REG_OLDMASK, L_REG_CR2, L_NGREG,
};
/* The FXSAVE area, which is also the start of what the kernel keeps of the floating point state. */
struct l_fpstate {
  uint16_t cwd, swd, ftw, fop;
  uint64_t rip, rdp;
  uint32_t mxcsr, mxcr_mask;
  uint8_t st[8][16];
  uint8_t xmm[16][16];
  uint32_t padding[24];
};
_Static_assert(sizeof(struct l_fpstate) == 512, "struct _fpstate of linux x86-64");
struct l_mcontext { int64_t gregs[L_NGREG]; uint64_t fpregs; uint64_t reserved[8]; };
_Static_assert(sizeof(struct l_mcontext) == 256, "mcontext_t of linux x86-64");
/* ucontext_t as the libc of the image declares it. The kernel has the same up to the signal
   mask, which has 8 bytes there and 128 here, and the floating point state follows. */
struct l_ucontext {
  uint64_t flags, link;
  struct l_stack stack;
  struct l_mcontext mcontext;
  l_sigset sigmask;
  uint64_t sigmask_rest[15];
  struct l_fpstate fpregs_mem;
};
_Static_assert(offsetof(struct l_ucontext, mcontext) == 40 && offsetof(struct l_ucontext, sigmask) == 296 && sizeof(struct l_ucontext) == 936, "ucontext_t of linux x86-64");
#else
/* aarch64: no restorer field in front of the mask. Signals are not delivered to aarch64 images yet. */
struct l_k_sigaction { uint64_t handler, flags; l_sigset mask; };
_Static_assert(sizeof(struct l_k_sigaction) == 24, "struct k_sigaction of linux aarch64");
#endif

/* ---- the start of the image ---- */
enum {
  L_AT_NULL = 0, L_AT_PHDR = 3, L_AT_PHENT = 4, L_AT_PHNUM = 5, L_AT_PAGESZ = 6, L_AT_BASE = 7, L_AT_ENTRY = 9,
  L_AT_UID = 11, L_AT_EUID = 12, L_AT_GID = 13, L_AT_EGID = 14, L_AT_HWCAP = 16, L_AT_SECURE = 23, L_AT_RANDOM = 25,
};
typedef struct { unsigned char ident[16]; uint16_t type, machine; uint32_t version; uint64_t entry, phoff, shoff; uint32_t flags; uint16_t ehsize, phentsize, phnum, shentsize, shnum, shstrndx; } Ehdr;
typedef struct { uint32_t type, flags; uint64_t offset, vaddr, paddr, filesz, memsz, align; } Phdr;
#if defined(L_ARCH_X86_64)
#define IMAGE_MACHINE 62
#else
#define IMAGE_MACHINE 183
#endif

/* ---- names, for the trace ---- */
static inline const char *l_request_name(long long n) {
  switch (n) {
#define L_NAME(x) case N_##x: return #x;
    L_NAME(read) L_NAME(write) L_NAME(open) L_NAME(close) L_NAME(stat) L_NAME(fstat) L_NAME(lstat) L_NAME(poll)
    L_NAME(lseek) L_NAME(mmap) L_NAME(mprotect) L_NAME(munmap) L_NAME(brk) L_NAME(rt_sigaction) L_NAME(rt_sigprocmask)
    L_NAME(rt_sigreturn) L_NAME(ioctl) L_NAME(pread64) L_NAME(pwrite64) L_NAME(readv) L_NAME(writev) L_NAME(access)
    L_NAME(pipe) L_NAME(sched_yield) L_NAME(mremap) L_NAME(madvise) L_NAME(dup) L_NAME(dup2) L_NAME(nanosleep)
    L_NAME(getpid) L_NAME(clone) L_NAME(fork) L_NAME(vfork) L_NAME(execve) L_NAME(exit) L_NAME(wait4) L_NAME(kill)
    L_NAME(uname) L_NAME(fcntl) L_NAME(fsync) L_NAME(fdatasync) L_NAME(ftruncate) L_NAME(getdents) L_NAME(getcwd)
    L_NAME(chdir) L_NAME(rename) L_NAME(mkdir) L_NAME(rmdir) L_NAME(unlink) L_NAME(readlink) L_NAME(umask)
    L_NAME(gettimeofday) L_NAME(getrlimit) L_NAME(getrusage) L_NAME(sysinfo) L_NAME(getuid) L_NAME(getgid)
    L_NAME(geteuid) L_NAME(getegid) L_NAME(getppid) L_NAME(rt_sigpending) L_NAME(rt_sigsuspend) L_NAME(sigaltstack)
    L_NAME(prctl) L_NAME(arch_prctl) L_NAME(setrlimit) L_NAME(gettid) L_NAME(tkill) L_NAME(futex)
    L_NAME(sched_setaffinity) L_NAME(sched_getaffinity) L_NAME(getdents64) L_NAME(set_tid_address)
    L_NAME(clock_gettime) L_NAME(clock_getres) L_NAME(clock_nanosleep) L_NAME(exit_group) L_NAME(tgkill) L_NAME(mbind)
    L_NAME(openat) L_NAME(mkdirat) L_NAME(newfstatat) L_NAME(unlinkat) L_NAME(renameat) L_NAME(readlinkat)
    L_NAME(faccessat) L_NAME(set_robust_list) L_NAME(dup3) L_NAME(pipe2) L_NAME(prlimit64) L_NAME(getcpu)
    L_NAME(sched_setattr) L_NAME(sched_getattr) L_NAME(getrandom) L_NAME(membarrier) L_NAME(statx) L_NAME(faccessat2)
    L_NAME(set_tp) L_NAME(main_stack)
#undef L_NAME
    default: return "?";
  }
}

#endif
